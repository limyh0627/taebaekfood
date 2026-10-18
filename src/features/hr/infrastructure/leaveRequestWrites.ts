import { doc, runTransaction } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, db, functions } from '../../../shared/firebase';
import { canEnterAdmin } from '../../../shared/adminAccess';
import { companyOf, type CompanyId, type Employee, type LeaveRequest } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';
import { normalizeLeaveBatchRequest, normalizeLeaveBatchReference, normalizeLeaveBatchResult, serializeLeaveBatchRequest, leaveRequestBusinessIds, leaveRequestExpected, leaveActionLabel, type LeaveMutationAction, type LeaveCreateRequest, type LeaveBatchRequest, type LeaveBatchCommand, type LeaveBatchResult } from '../../../shared/leaveRequestCommand';
export interface LeaveScope {
  companyId: CompanyId;
  actorUid: string;
}
export interface LeavePlan {
  version: 1;
  scope: LeaveScope;
  planId: string;
  request: LeaveBatchRequest;
  requestHash: string;
  state: 'prepared' | 'unknown';
  notify: boolean;
  createdAt: string;
}
export interface LeaveWriteResult {
  outcome: SaveOutcome;
  plan: LeavePlan | null;
  confirmedIds: string[];
  unconfirmedIds: string[];
}
export interface LeaveWritePort {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
  assertScope: (scope: LeaveScope) => Promise<void>;
  command: (scope: LeaveScope, command: LeaveBatchCommand) => Promise<unknown>;
  notify: (scope: LeaveScope, id: string, data: Record<string, unknown>) => Promise<void>;
  now: () => string;
  id: () => string;
}
const text = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const prefix = (scope: LeaveScope) => `tb_leave_plan_v2:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const keyOf = (plan: LeavePlan) => prefix(plan.scope) + plan.planId;
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join('');
const unknownOutcome = (message = '휴가 저장 결과를 확인하지 못했습니다. 최초 요청은 보관했습니다.'): SaveOutcome => ({
  status: 'unknown',
  message,
  nextAction: '보관 요청에서 결과 확인 또는 요청 중단을 선택해 주세요. 확인 전에는 새로 등록하지 마세요.'
});
function parsePlan(raw: string | null, scope: LeaveScope): LeavePlan {
  try {
    const plan = JSON.parse(raw ?? '') as LeavePlan;
    if (plan.version !== 1 || text(plan.scope) !== text(scope) || !['prepared', 'unknown'].includes(plan.state) || typeof plan.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(plan.requestHash) || typeof plan.notify !== 'boolean') throw Error();
    const request = normalizeLeaveBatchRequest(plan.request);
    if (request.companyId !== scope.companyId || request.planId !== plan.planId) throw Error();
    return {
      ...plan,
      request
    };
  } catch {
    throw Error('보관된 휴가 원문이 손상됐습니다. 원문은 보존했습니다. 요청 중단으로 서버 상태를 확인해 주세요.');
  }
}
export function createLeaveRequestWriter(port: LeaveWritePort) {
  const read = (scope: LeaveScope, planId: string) => {
    const plan = parsePlan(port.storage.getItem(prefix(scope) + planId), scope);
    if (plan.planId !== planId) throw Error('보관 요청의 저장 위치와 계획 번호가 다릅니다. 원문을 보존하고 요청 중단으로 확인해 주세요.');
    return plan;
  };
  const list = (scope: LeaveScope) => {
    const plans: LeavePlan[] = [];
    for (let i = 0; i < port.storage.length; i++) {
      const key = port.storage.key(i);
      if (key?.startsWith(prefix(scope))) {
        try {
          plans.push(read(scope, key.slice(prefix(scope).length)));
        } catch {/* 손상본은 별도 reference 목록에서 중단할 수 있도록 보존한다. */}
      }
    }
    return plans;
  };
  const persist = (plan: LeavePlan) => {
    parsePlan(JSON.stringify(plan), plan.scope);
    const key = keyOf(plan),
      old = port.storage.getItem(key);
    if (old) {
      const prior = parsePlan(old, plan.scope);
      if (serializeLeaveBatchRequest(prior.request) !== serializeLeaveBatchRequest(plan.request) || prior.requestHash !== plan.requestHash || prior.notify !== plan.notify) throw Error('최초 휴가 원문이 달라 덮어쓰지 않았습니다.');
    }
    const value = JSON.stringify(plan);
    port.storage.setItem(key, value);
    if (port.storage.getItem(key) !== value) throw Error('휴가 요청을 이 기기에 보관하지 못해 전송하지 않았습니다.');
  };
  const remove = (scope: LeaveScope, planId: string) => {
    const key = prefix(scope) + planId;
    port.storage.removeItem(key);
    if (port.storage.getItem(key) !== null) throw Error('완료된 휴가 요청의 기기 보관본을 정리하지 못했습니다.');
  };
  const prepare = async (scope: LeaveScope, requests: LeaveRequest[], employees: readonly Employee[], notify = false) => {
    if (!scope.actorUid || requests.some(row => !employees.some(e => e.id === row.employeeId && companyOf(e) === scope.companyId))) throw Error('현재 회사의 신청 직원과 로그인 계정을 확인해 주세요.');
    const rows = requests.map(row => {
      const {
        id,
        employeeId,
        employeeName,
        type,
        startDate,
        endDate,
        reason,
        status,
        requestedAt,
        daysUsed,
        deductsLeave
      } = row;
      return {
        id,
        employeeId,
        employeeName,
        type,
        startDate,
        endDate,
        reason,
        status,
        requestedAt,
        daysUsed,
        ...(deductsLeave === undefined ? {} : {
          deductsLeave
        })
      };
    });
    const prior = list(scope).find(plan => plan.request.version === 1 && plan.request.rows.some(row => rows.some(r => r.id === row.id)));
    if (prior) {
      if (prior.request.version !== 1 || text(prior.request.rows) !== text(rows)) throw Error('보관된 최초 휴가 요청과 입력이 다릅니다. 먼저 보관 요청을 확인해 주세요.');
      return prior;
    }
    const request = normalizeLeaveBatchRequest({
      version: 1,
      companyId: scope.companyId,
      planId: port.id(),
      rows
    });
    const plan: LeavePlan = {
      version: 1,
      scope: clean(scope),
      planId: request.planId,
      request,
      requestHash: await digest(serializeLeaveBatchRequest(request)),
      state: 'prepared',
      notify,
      createdAt: port.now()
    };
    persist(plan);
    return plan;
  };
  const prepareAction = async (scope: LeaveScope, row: LeaveRequest, action: LeaveMutationAction) => {
    if (!scope.actorUid) throw Error('현재 로그인 계정을 확인해 주세요.');
    // 같은 휴가의 앞선 미확정 원문을 다른 화면에서 새 계획으로 덮지 않는다.
    if (list(scope).some(plan => plan.request.version === 2 && leaveRequestBusinessIds(plan.request).includes(row.id))) throw Error('이 휴가의 보관 요청이 있습니다. 결과 확인 또는 요청 중단을 먼저 선택해 주세요.');
    const request = normalizeLeaveBatchRequest({
      version: 2,
      kind: 'mutation',
      companyId: scope.companyId,
      planId: port.id(),
      targetId: row.id,
      expected: leaveRequestExpected(row),
      ...action
    });
    const plan: LeavePlan = {
      version: 1,
      scope: clean(scope),
      planId: request.planId,
      request,
      requestHash: await digest(serializeLeaveBatchRequest(request)),
      state: 'prepared',
      notify: false,
      createdAt: port.now()
    };
    persist(plan);
    return plan;
  };
  const complete = async (plan: LeavePlan, response: unknown, employees: readonly Employee[] = []): Promise<LeaveWriteResult> => {
    const ids = leaveRequestBusinessIds(plan.request);
    const result = normalizeLeaveBatchResult(response, {
      companyId: plan.scope.companyId,
      planId: plan.planId
    }, plan.scope.actorUid, plan.requestHash, ids);
    if (result.status === 'unknown') return {
      outcome: unknownOutcome(result.message),
      plan,
      confirmedIds: [],
      unconfirmedIds: ids
    };
    if (result.status === 'cancelled' || result.status === 'rejected') {
      // 거절·중단은 서버가 최초 writer를 봉쇄한 명시 ACK일 때만 새 작성을 허용한다.
      remove(plan.scope, plan.planId);
      return {
        outcome: {
          status: result.status === 'cancelled' ? 'cancelled' : 'rejected',
          message: result.message,
          nextAction: plan.request.version === 2 ? '창을 닫고 해당 휴가를 다시 열어 현재 내용을 확인한 뒤 필요한 작업을 선택해 주세요.' : '작성 내용을 확인한 뒤 새 요청으로 등록할 수 있습니다.'
        },
        plan,
        confirmedIds: [],
        unconfirmedIds: []
      };
    }
    let outcome: SaveOutcome = {
      status: 'saved'
    };
    try {
      remove(plan.scope, plan.planId);
    } catch {
      outcome = {
        status: 'partial',
        reason: 'followup-unconfirmed',
        committedIds: ids,
        unconfirmedIds: [],
        message: '휴가 저장은 완료됐지만 기기의 보관본 정리를 확인하지 못했습니다.',
        nextAction: '휴가 목록을 확인해 주세요. 다시 신청하지 마세요.'
      };
    }
    if (plan.notify && plan.request.version === 1 && plan.request.rows.length === 1) {
      const row = plan.request.rows[0],
        recipient = employees.find(e => companyOf(e) === plan.scope.companyId && canEnterAdmin(e));
      try {
        if (!recipient) throw Error();
        await port.assertScope(plan.scope);
        await port.notify(plan.scope, `leave-notice-${row.id}`, {
          companyId: plan.scope.companyId,
          type: 'leave_request',
          title: '신규 연차 신청',
          body: `${row.employeeName}님이 ${row.type} (${row.startDate}${row.startDate !== row.endDate ? ` ~ ${row.endDate}` : ''}, ${row.daysUsed}일)을 신청했습니다.`,
          readBy: [],
          createdAt: plan.createdAt,
          senderId: row.employeeId,
          targetId: recipient.id,
          linkedId: row.id
        });
      } catch {
        outcome = {
          status: 'partial',
          reason: 'followup-unconfirmed',
          committedIds: ids,
          unconfirmedIds: [],
          message: '휴가 신청은 저장됐지만 관리자 알림은 확인하지 못했습니다.',
          nextAction: '다시 신청하지 말고 휴가 목록을 확인해 주세요. 관리자 알림 대상·수신 상태는 별도로 확인해 주세요.'
        };
      }
    }
    return {
      outcome,
      plan,
      confirmedIds: ids,
      unconfirmedIds: []
    };
  };
  const run = async (scope: LeaveScope, planId: string, mode: 'apply' | 'inspect' | 'cancel', employees: readonly Employee[] = []) => {
    const plan = read(scope, planId);
    await port.assertScope(scope);
    if ((await digest(serializeLeaveBatchRequest(plan.request))) !== plan.requestHash) {
      // 손상된 본문으로 apply/inspect하지 않는다. 명시 중단은 원문 대신 같은 계정의 reference로 fence를 확인한다.
      if (mode === 'cancel') {
        const outcome = await cancelReference(scope, planId);
        return {
          outcome,
          plan,
          confirmedIds: [],
          unconfirmedIds: outcome.status === 'unknown' ? leaveRequestBusinessIds(plan.request) : []
        } as LeaveWriteResult;
      }
      throw Error('보관된 휴가 원문의 해시가 다릅니다. 삭제하지 말고 요청 중단으로 확인해 주세요.');
    }
    // 첫 전송 여부와 무관하게 서버 receipt/fence가 같은 plan을 판정한다. 새 번호를 만들지 않는다.
    plan.state = 'unknown';
    persist(plan);
    try {
      const command: LeaveBatchCommand = mode === 'apply' ? {
        mode,
        request: plan.request
      } : {
        mode,
        reference: {
          companyId: scope.companyId,
          planId
        },
        requestHash: plan.requestHash
      };
      const response = await port.command(scope, command);
      await port.assertScope(scope);
      return await complete(plan, response, employees);
    } catch {
      return {
        outcome: unknownOutcome(),
        plan,
        confirmedIds: [],
        unconfirmedIds: leaveRequestBusinessIds(plan.request)
      } as LeaveWriteResult;
    }
  };
  const cancelReference = async (scope: LeaveScope, planId: string): Promise<SaveOutcome> => {
    const reference = normalizeLeaveBatchReference({
      companyId: scope.companyId,
      planId
    });
    await port.assertScope(scope);
    try {
      const response = await port.command(scope, {
        mode: 'cancel',
        reference
      });
      await port.assertScope(scope);
      const result = normalizeLeaveBatchResult(response, reference, scope.actorUid);
      if (result.status === 'cancelled' || result.status === 'rejected') {
        remove(scope, planId);
        return {
          status: 'cancelled',
          message: result.message,
          nextAction: '작성 내용을 확인해 새 요청으로 등록할 수 있습니다.'
        };
      }
      if (result.status === 'applied' || result.status === 'duplicate') {
        remove(scope, planId);
        return {
          status: 'saved'
        };
      }
      return unknownOutcome(result.message);
    } catch {
      return unknownOutcome();
    }
  };
  return {
    prepare,
    prepareAction,
    read,
    list,
    persist,
    execute: (s: LeaveScope, id: string, e: readonly Employee[] = []) => run(s, id, 'apply', e),
    inspect: (s: LeaveScope, id: string, e: readonly Employee[] = []) => run(s, id, 'inspect', e),
    cancel: (s: LeaveScope, id: string) => run(s, id, 'cancel'),
    cancelReference
  };
}
async function assertScope(scope: LeaveScope) {
  await authReady;
  const user = auth.currentUser;
  if (!user || user.uid !== scope.actorUid) throw Error('로그인 계정이 바뀌었습니다. 원래 계정에서 보관 요청을 확인해 주세요.');
  const token = await user.getIdTokenResult();
  if (auth.currentUser?.uid !== scope.actorUid || token.claims.companyId !== scope.companyId || typeof token.claims.employeeId !== 'string') throw Error('휴가 요청의 회사·로그인 권한을 확인해 주세요.');
}
async function sendLeaveCommand(scope: LeaveScope, command: LeaveBatchCommand): Promise<LeaveBatchResult> {
  await assertScope(scope);
  return (await httpsCallable<LeaveBatchCommand, LeaveBatchResult>(functions, 'leaveRequestCommand')(command)).data;
}
const writer = () => createLeaveRequestWriter({
  storage: localStorage,
  assertScope,
  now: () => new Date().toISOString(),
  id: () => crypto.randomUUID(),
  command: sendLeaveCommand,
  notify: async (scope, id, data) => {
    await assertScope(scope);
    await runTransaction(db, async tx => {
      const ref = doc(db, 'notifications', id),
        snap = await tx.get(ref);
      await assertScope(scope);
      if (snap.exists()) {
        if (text(snap.data()) !== text(data)) throw Error('기존 알림 원문이 다릅니다.');
      } else tx.set(ref, data);
    });
  }
});
export const listLeavePlans = (scope: LeaveScope) => writer().list(scope);
export const inspectLeavePlan = (scope: LeaveScope, planId: string, employees: readonly Employee[] = []) => writer().inspect(scope, planId, employees);
export const cancelLeavePlan = (scope: LeaveScope, planId: string) => writer().cancel(scope, planId);
export const cancelLeaveReference = (scope: LeaveScope, planId: string) => writer().cancelReference(scope, planId);
export async function submitLeaveRequests(scope: LeaveScope, requests: LeaveRequest[], employees: readonly Employee[], notify = false): Promise<LeaveWriteResult> {
  const service = writer();
  try {
    await assertScope(scope);
  } catch {
    return {
      outcome: {
        status: 'cancelled',
        message: '전송 전에 로그인 계정이나 회사가 바뀌어 저장을 시작하지 않았습니다.',
        nextAction: '현재 계정을 확인한 뒤 다시 작성해 주세요.'
      },
      plan: null,
      confirmedIds: [],
      unconfirmedIds: []
    };
  }
  let plan: LeavePlan;
  try {
    if (listLeaveReferences(scope).some(reference => !reference.readable)) throw Error('손상된 보관 요청을 먼저 중단 확인해 주세요.');
    plan = await service.prepare(scope, requests, employees, notify);
  } catch (error) {
    let uncertain = false;
    try {
      uncertain = listLeaveReferences(scope).some(reference => !reference.readable) || service.list(scope).some(prior => leaveRequestBusinessIds(prior.request).some(id => requests.some(request => request.id === id)));
    } catch {/* 읽을 수 없는 저장소에는 새 요청도 전송하지 않았다. */}
    return {
      outcome: uncertain ? unknownOutcome(error instanceof Error ? error.message : undefined) : {
        status: 'rejected',
        message: error instanceof Error ? error.message : '휴가 입력을 확인해 주세요.',
        nextAction: '아직 전송하지 않았습니다. 입력과 기기 저장 공간을 확인한 뒤 다시 작성해 주세요.'
      },
      plan: null,
      confirmedIds: [],
      unconfirmedIds: uncertain ? requests.map(row => row.id) : []
    };
  }
  return service.execute(scope, plan.planId, employees);
}
export const pendingLeaveRequests = (scope: LeaveScope): LeaveRequest[] => listLeavePlans(scope).flatMap(plan => plan.request.version === 1 ? plan.request.rows.filter(row => row.status === 'pending') : []);
export async function inspectLeaveRequest(scope: LeaveScope, requestId: string, employees: readonly Employee[] = []): Promise<SaveOutcome> {
  const service = writer(),
    plan = service.list(scope).find(p => p.request.version === 1 && leaveRequestBusinessIds(p.request).includes(requestId));
  return plan ? (await service.inspect(scope, plan.planId, employees)).outcome : unknownOutcome('보관된 최초 휴가 원문을 찾지 못했습니다.');
}
export async function cancelLeaveRequest(scope: LeaveScope, requestId: string): Promise<SaveOutcome> {
  const service = writer(),
    plan = service.list(scope).find(p => p.request.version === 1 && leaveRequestBusinessIds(p.request).includes(requestId));
  return plan ? (await service.cancel(scope, plan.planId)).outcome : unknownOutcome('보관된 최초 휴가 요청을 찾지 못했습니다.');
}
export interface PendingLeaveGroup {
  id: string;
  requests: LeaveRequest[];
}
export const pendingLeaveGroups = (scope: LeaveScope): PendingLeaveGroup[] => listLeavePlans(scope).filter((plan): plan is LeavePlan & {
  request: LeaveCreateRequest;
} => plan.request.version === 1 && plan.request.rows.every(row => row.status === 'approved')).map(plan => ({
  id: plan.request.rows[0].id,
  requests: plan.request.rows
}));
export interface LeavePlanReference {
  planId: string;
  readable: boolean;
}
export function listLeaveReferences(scope: LeaveScope): LeavePlanReference[] {
  const rows: LeavePlanReference[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix(scope))) {
      const planId = key.slice(prefix(scope).length);
      normalizeLeaveBatchReference({
        companyId: scope.companyId,
        planId
      });
      let readable = true;
      try {
        writer().read(scope, planId);
      } catch {
        readable = false;
      }
      rows.push({
        planId,
        readable
      });
    }
  }
  return rows;
}
export interface PendingLeaveAction {
  id: string;
  planId?: string;
  action: LeaveMutationAction;
  description: string;
  row?: LeaveRequest;
}
export const pendingLeaveActions = (scope: LeaveScope): PendingLeaveAction[] => listLeavePlans(scope).flatMap(plan => {
  const request = plan.request;
  if (request.version !== 2) return [];
  const action: LeaveMutationAction = request.action === 'request-modify' ? {
    action: request.action,
    modifyRequest: request.modifyRequest
  } : request.action === 'cancel' ? {
    action: request.action,
    ...(request.reason === undefined ? {} : {
      reason: request.reason
    })
  } : {
    action: request.action
  };
  return [{
    id: request.targetId,
    planId: plan.planId,
    action,
    description: String(request.expected.employeeName ?? '직원') + ' · ' + String(request.expected.startDate ?? '날짜 확인 필요') + ' · ' + leaveActionLabel(request.action)
  }];
});
export async function submitLeaveAction(scope: LeaveScope, row: LeaveRequest, action: LeaveMutationAction): Promise<LeaveWriteResult> {
  const service = writer();
  try {
    await assertScope(scope);
  } catch {
    return {
      outcome: {
        status: 'cancelled',
        message: '전송 전에 로그인 계정이나 회사가 바뀌어 저장을 시작하지 않았습니다.',
        nextAction: '현재 계정을 확인한 뒤 다시 처리해 주세요.'
      },
      plan: null,
      confirmedIds: [],
      unconfirmedIds: []
    };
  }
  let plan: LeavePlan;
  try {
    if (listLeaveReferences(scope).some(reference => !reference.readable)) throw Error('손상된 보관 요청을 먼저 중단 확인해 주세요.');
    plan = await service.prepareAction(scope, row, action);
  } catch (error) {
    let uncertain = false;
    try {
      uncertain = listLeaveReferences(scope).some(reference => !reference.readable) || service.list(scope).some(prior => prior.request.version === 2 && leaveRequestBusinessIds(prior.request).includes(row.id));
    } catch {}
    return {
      outcome: uncertain ? unknownOutcome(error instanceof Error ? error.message : undefined) : {
        status: 'rejected',
        message: error instanceof Error ? error.message : '휴가 변경 내용을 확인해 주세요.',
        nextAction: '아직 전송하지 않았습니다. 입력과 기기 저장 공간을 확인한 뒤 다시 처리해 주세요.'
      },
      plan: null,
      confirmedIds: [],
      unconfirmedIds: uncertain ? [row.id] : []
    };
  }
  return service.execute(scope, plan.planId);
}

/** 변경 요청은 휴가 ID가 아닌 최초 계획 ID로만 복구한다. */
export async function inspectLeaveAction(scope: LeaveScope, planId: string): Promise<SaveOutcome> {
  const service = writer();
  let plan: LeavePlan | null = null;
  try {
    if (localStorage.getItem(prefix(scope) + planId) !== null) plan = service.read(scope, planId);
  } catch {
    return unknownOutcome('보관 원문이 손상됐습니다. 원문을 유지하고 요청 중단으로 서버 상태를 확인해 주세요.');
  }
  if (plan) return plan.request.version === 2 ? (await service.inspect(scope, planId)).outcome : unknownOutcome('변경 요청이 아닌 생성 계획입니다.');
  // 다른 화면에서 로컬 원문을 정리했어도 같은 영수증의 결과만 조회한다.
  try {
    await assertScope(scope);
    const reference = normalizeLeaveBatchReference({
      companyId: scope.companyId,
      planId
    });
    const response = await sendLeaveCommand(scope, {
      mode: 'inspect',
      reference
    });
    await assertScope(scope);
    const result = normalizeLeaveBatchResult(response, reference, scope.actorUid);
    if (result.status === 'applied' || result.status === 'duplicate') return {
      status: 'saved'
    };
    if (result.status === 'cancelled') return {
      status: 'cancelled',
      message: '보관 요청이 중단됐습니다.'
    };
    if (result.status === 'rejected') return {
      status: 'rejected',
      message: result.message,
      nextAction: '휴가 목록에서 현재 상태를 확인한 뒤 필요한 작업을 다시 선택해 주세요.'
    };
    return unknownOutcome(result.message);
  } catch {
    return unknownOutcome('보관 요청의 서버 결과를 확인하지 못했습니다.');
  }
}
export async function cancelLeaveAction(scope: LeaveScope, planId: string): Promise<SaveOutcome> {
  const service = writer();
  let plan: LeavePlan | null = null;
  try {
    if (localStorage.getItem(prefix(scope) + planId) !== null) plan = service.read(scope, planId);
  } catch {
    return service.cancelReference(scope, planId);
  }
  return plan ? plan.request.version === 2 ? (await service.cancel(scope, planId)).outcome : unknownOutcome('변경 요청이 아닌 생성 계획입니다.') : service.cancelReference(scope, planId);
}
