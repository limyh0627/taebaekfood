import { Timestamp, DocumentReference, GeoPoint, Bytes } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../../../shared/firebase';
import { employeeEditExpected, normalizeEmployeeEditRequest, normalizeEmployeeEditReference, normalizeEmployeeEditResult, serializeEmployeeEditRequest, type EmployeeEditRequest, type EmployeeEditReference, type EmployeeEditCommand, type EmployeeProfileDraft, type EmployeeBalanceDraft, type CatalogValue } from '../../../shared/employeeEditCommand';
import { companyOf, type CompanyId, type Employee } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';
export interface EmployeeEditScope {
  companyId: CompanyId;
  actorUid: string;
}
export type EmployeeEditInput = {
  targetId: string;
} & ({
  kind: 'create';
  opening: null;
  profile: EmployeeProfileDraft;
} | {
  kind: 'profile';
  opening: Employee;
  profile: EmployeeProfileDraft;
} | {
  kind: 'balance';
  opening: Employee;
  balance: EmployeeBalanceDraft;
});
export interface EmployeeEditPlan {
  version: 1;
  actorUid: string;
  request: EmployeeEditRequest;
  requestHash: string;
}
export interface PendingEmployeeEdit {
  id: string;
  planId: string;
  reference: EmployeeEditReference;
  kind: EmployeeEditRequest['kind'];
  description: string;
}
export interface EmployeeEditStoredReference {
  reference: EmployeeEditReference | null;
  readable: boolean;
  key: string;
}
export type EmployeeEditSaveOutcome = SaveOutcome & {
  requiresReopen?: boolean;
};
export interface EmployeeEditBindings {
  requestScopeKey?: string;
  onSaveEmployeeEdit?: (input: EmployeeEditInput) => Promise<EmployeeEditSaveOutcome>;
  onReadPendingEmployeeEdits?: () => PendingEmployeeEdit[];
  onInspectEmployeeEdit?: (reference: EmployeeEditReference) => Promise<EmployeeEditSaveOutcome>;
  onCancelEmployeeEdit?: (reference: EmployeeEditReference) => Promise<EmployeeEditSaveOutcome>;
  onReadEmployeeEditReferences?: () => EmployeeEditStoredReference[];
}
export interface EmployeeEditWritePort {
  storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
  assertScope: (scope: EmployeeEditScope) => Promise<void>;
  exclusive: <T>(scope: EmployeeEditScope, targetId: string, work: () => Promise<T>) => Promise<T>;
  command: (command: EmployeeEditCommand) => Promise<unknown>;
  id: () => string;
}
const codec = {
  special(value: unknown): CatalogValue | undefined {
    if (value instanceof Date) {
      const time = Timestamp.fromDate(value);
      return ['timestamp', time.seconds, time.nanoseconds];
    }
    if (value instanceof Timestamp) return ['timestamp', value.seconds, value.nanoseconds];
    if (value instanceof DocumentReference) return ['reference', value.path];
    if (value instanceof GeoPoint) return ['geo', value.latitude, value.longitude];
    if (value instanceof Bytes) return ['bytes', [...value.toUint8Array()]];
    return undefined;
  }
};
const prefix = (scope: EmployeeEditScope) => `tb_employee_edit_v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const keyOf = (scope: EmployeeEditScope, reference: EmployeeEditReference) => prefix(scope) + encodeURIComponent(reference.targetId) + ':' + encodeURIComponent(reference.planId);
const refOf = (request: EmployeeEditRequest): EmployeeEditReference => ({
  companyId: request.companyId,
  targetId: request.targetId,
  planId: request.planId
});
const hash = async (request: EmployeeEditRequest) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeEmployeeEditRequest(request))))].map(value => value.toString(16).padStart(2, '0')).join('');
const unknown = (message = '직원 저장 결과를 확인하지 못했습니다.'): SaveOutcome => ({
  status: 'unknown',
  message,
  nextAction: '보관 요청의 결과 확인 또는 요청 중단을 선택해 주세요. 같은 내용을 새 요청으로 다시 보내지 마세요.'
});
export function createEmployeeEditWriter(port: EmployeeEditWritePort) {
  const read = (scope: EmployeeEditScope, reference: EmployeeEditReference): EmployeeEditPlan => {
    const text = port.storage.getItem(keyOf(scope, reference));
    if (text === null) throw Error('보관 원문이 없습니다.');
    const value = JSON.parse(text) as EmployeeEditPlan;
    const request = normalizeEmployeeEditRequest(value.request);
    if (value.version !== 1 || value.actorUid !== scope.actorUid || request.companyId !== scope.companyId || keyOf(scope, refOf(request)) !== keyOf(scope, reference) || !/^[a-f0-9]{64}$/.test(value.requestHash)) throw Error('직원 원문의 계정·회사·저장 위치가 다릅니다.');
    return {
      version: 1,
      actorUid: value.actorUid,
      request,
      requestHash: value.requestHash
    };
  };
  const references = (scope: EmployeeEditScope): EmployeeEditStoredReference[] => {
    const result: EmployeeEditStoredReference[] = [];
    for (let index = 0; index < port.storage.length; index++) {
      const key = port.storage.key(index);
      if (!key?.startsWith(prefix(scope))) continue;
      let reference: EmployeeEditReference | null = null,
        readable = false;
      try {
        const parts = key.slice(prefix(scope).length).split(':');
        if (parts.length !== 2) throw Error('저장 위치 손상');
        reference = normalizeEmployeeEditReference({
          companyId: scope.companyId,
          targetId: decodeURIComponent(parts[0]),
          planId: decodeURIComponent(parts[1])
        });
        read(scope, reference);
        readable = true;
      } catch {/* 손상 한 건 때문에 다른 직원의 정상 작업을 막지 않는다. */}
      result.push({
        key,
        reference,
        readable
      });
    }
    return result;
  };
  const pending = (scope: EmployeeEditScope): PendingEmployeeEdit[] => references(scope).filter(row => row.readable && row.reference).map(row => {
    const plan = read(scope, row.reference!);
    return {
      id: plan.request.targetId,
      planId: plan.request.planId,
      reference: refOf(plan.request),
      kind: plan.request.kind,
      description: plan.request.kind === 'balance' ? '연차 조정 · 대상 번호 ' + plan.request.targetId : '직원 저장 · ' + plan.request.profile.name
    };
  });
  const prepare = async (scope: EmployeeEditScope, input: EmployeeEditInput) => port.exclusive(scope, input.targetId, async () => {
    await port.assertScope(scope);
    if (input.opening && (input.opening.id !== input.targetId || companyOf(input.opening) !== scope.companyId)) throw Error('열 때 선택한 직원의 회사·번호가 다릅니다.');
    if (references(scope).some(row => row.reference?.targetId === input.targetId)) throw Error('이 직원의 보관 요청을 먼저 확인하거나 중단해 주세요.');
    const request = normalizeEmployeeEditRequest({
      version: 1,
      companyId: scope.companyId,
      planId: port.id(),
      targetId: input.targetId,
      kind: input.kind,
      expected: input.kind === 'create' ? null : employeeEditExpected({
        ...input.opening
      }, input.kind, codec),
      ...(input.kind === 'balance' ? {
        balance: input.balance
      } : {
        profile: input.profile
      })
    });
    const plan: EmployeeEditPlan = {
      version: 1,
      actorUid: scope.actorUid,
      request,
      requestHash: await hash(request)
    };
    await port.assertScope(scope);
    const key = keyOf(scope, refOf(request)),
      text = JSON.stringify(plan);
    if (port.storage.getItem(key) !== null) throw Error('이미 보관된 계획 번호입니다.');
    port.storage.setItem(key, text);
    if (port.storage.getItem(key) !== text) throw Error('최초 직원 원문의 보관을 확인하지 못했습니다.');
    return plan;
  });
  const run = async (scope: EmployeeEditScope, reference: EmployeeEditReference, mode: 'apply' | 'inspect' | 'cancel'): Promise<EmployeeEditSaveOutcome> => {
    try {
      normalizeEmployeeEditReference(reference);
      await port.assertScope(scope);
      if (reference.companyId !== scope.companyId) throw Error('회사 변경');
    } catch {
      return {
        status: 'cancelled',
        message: '회사나 계정이 바뀌어 요청을 시작하지 않았습니다.'
      };
    }
    let original: string | null,
      plan: EmployeeEditPlan | null = null;
    try {
      original = port.storage.getItem(keyOf(scope, reference));
      if (original !== null) {
        try {
          plan = read(scope, reference);
          if ((await hash(plan.request)) !== plan.requestHash) throw Error('원문 해시 변경');
        } catch {
          if (mode !== 'cancel') return unknown('보관 원문이 손상됐습니다. 원문은 유지하고 요청 중단으로 확인해 주세요.');
          plan = null;
        }
      }
      if (mode === 'apply' && !plan) return unknown('최초 원문이 없어 새 저장은 보내지 않았습니다.');
      await port.assertScope(scope);
      const command: EmployeeEditCommand = mode === 'apply' ? {
        mode,
        request: plan!.request
      } : {
        mode,
        reference,
        ...(plan ? {
          requestHash: plan.requestHash
        } : {})
      };
      const value = await port.command(command);
      await port.assertScope(scope);
      const result = normalizeEmployeeEditResult(value, reference, scope.actorUid, plan?.requestHash);
      if (result.status === 'unknown') return unknown(result.message);
      const committed = result.status === 'applied' || result.status === 'duplicate';
      const outcome: EmployeeEditSaveOutcome = committed ? {
        status: 'saved'
      } : {
        status: result.status as 'cancelled' | 'rejected',
        message: result.message,
        requiresReopen: true,
        nextAction: '창을 닫고 현재 직원을 다시 열어 필요한 내용을 작성해 주세요.'
      };
      try {
        await port.exclusive(scope, reference.targetId, async () => {
          await port.assertScope(scope);
          const key = keyOf(scope, reference),
            current = port.storage.getItem(key);
          if (current === null) return;
          if (current !== original) throw Error('다른 원문으로 바뀌어 정리하지 않았습니다.');
          port.storage.removeItem(key);
          if (port.storage.getItem(key) !== null) throw Error('보관 정리를 확인하지 못했습니다.');
        });
      } catch {
        return committed ? {
          status: 'partial',
          reason: 'followup-unconfirmed',
          committedIds: [reference.targetId],
          unconfirmedIds: [],
          message: '직원 저장은 확인됐지만 기기 보관 요청을 정리하지 못했습니다.',
          nextAction: '다시 저장하지 말고 같은 보관 요청의 결과를 확인해 주세요.'
        } : unknown('서버 결과는 받았지만 기기 보관 요청 정리를 확인하지 못했습니다.');
      }
      return outcome;
    } catch {
      return unknown();
    }
  };
  const submit = async (scope: EmployeeEditScope, input: EmployeeEditInput): Promise<EmployeeEditSaveOutcome> => {
    let plan: EmployeeEditPlan;
    try {
      plan = await prepare(scope, input);
    } catch (error) {
      return {
        status: 'rejected',
        message: error instanceof Error ? error.message : '직원 원문을 보관하지 못했습니다.',
        nextAction: '아직 전송하지 않았습니다. 작성 내용과 기기 저장소를 확인해 주세요.'
      };
    }
    return run(scope, refOf(plan.request), 'apply');
  };
  return {
    read,
    references,
    pending,
    prepare,
    run,
    submit
  };
}
async function active(scope: EmployeeEditScope) {
  if (auth.currentUser?.uid !== scope.actorUid) throw Error('계정 변경');
  await authReady;
  if (auth.currentUser?.uid !== scope.actorUid) throw Error('계정 변경');
  const {
    claims
  } = await auth.currentUser.getIdTokenResult();
  if (auth.currentUser?.uid !== scope.actorUid || claims.companyId !== scope.companyId || claims.isAdmin !== true || typeof claims.employeeId !== 'string') throw Error('관리자 회사 권한 변경');
}
const writer = () => createEmployeeEditWriter({
  storage: localStorage,
  assertScope: active,
  id: () => crypto.randomUUID(),
  exclusive: async (scope, targetId, work) => {
    if (!navigator.locks?.request) throw Error('여러 창의 요청 보호를 지원하는 브라우저가 필요합니다.');
    return navigator.locks.request(prefix(scope) + targetId, {
      mode: 'exclusive'
    }, work);
  },
  command: async command => (await httpsCallable<EmployeeEditCommand, unknown>(functions, 'employeeEditCommand')(command)).data
});
export const pendingEmployeeEdits = (scope: EmployeeEditScope) => writer().pending(scope);
export const employeeEditReferences = (scope: EmployeeEditScope) => writer().references(scope);
export const submitEmployeeEdit = (scope: EmployeeEditScope, input: EmployeeEditInput) => writer().submit(scope, input);
export const inspectEmployeeEdit = (scope: EmployeeEditScope, reference: EmployeeEditReference) => writer().run(scope, reference, 'inspect');
export const cancelEmployeeEdit = (scope: EmployeeEditScope, reference: EmployeeEditReference) => writer().run(scope, reference, 'cancel');
