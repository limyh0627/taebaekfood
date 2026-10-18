import { Timestamp, DocumentReference, GeoPoint, Bytes } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../../../shared/firebase';
import { normalizeOrderEditRequest, serializeOrderEditRequest, normalizeOrderEditReference, normalizeOrderEditResult, orderEditExpected, type OrderEditRequest, type OrderEditReference, type OrderEditCommand, type CatalogValue } from '../../../shared/orderEditCommand';
import { companyOf, type CompanyId, type Order } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';
import type { OrderEdit } from '../application/orderEditService';
export interface OrderEditScope {
  companyId: CompanyId;
  actorUid: string;
}
export interface OrderEditPlan {
  version: 1;
  actorUid: string;
  request: OrderEditRequest;
  requestHash: string;
}
export interface OrderEditWritePort {
  storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
  assertScope: (scope: OrderEditScope) => Promise<void>;
  exclusive: <T>(scope: OrderEditScope, targetId: string, work: () => Promise<T>) => Promise<T>;
  command: (command: OrderEditCommand) => Promise<unknown>;
  id: () => string;
}
const adapter = {
  special(value: unknown): CatalogValue | undefined {
    if (value instanceof Date) {
      const t = Timestamp.fromDate(value);
      return ['timestamp', t.seconds, t.nanoseconds];
    }
    if (value instanceof Timestamp) return ['timestamp', value.seconds, value.nanoseconds];
    if (value instanceof DocumentReference) return ['reference', value.path];
    if (value instanceof GeoPoint) return ['geo', value.latitude, value.longitude];
    if (value instanceof Bytes) return ['bytes', [...value.toUint8Array()]];
    return undefined;
  }
};
const prefix = (scope: OrderEditScope) => `tb_order_edit_v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const keyOf = (scope: OrderEditScope, reference: OrderEditReference) => prefix(scope) + encodeURIComponent(reference.targetId) + ':' + encodeURIComponent(reference.planId);
const refOf = (request: OrderEditRequest): OrderEditReference => ({
  companyId: request.companyId,
  targetId: request.targetId,
  planId: request.planId
});
const hash = async (request: OrderEditRequest) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeOrderEditRequest(request))))].map(n => n.toString(16).padStart(2, '0')).join('');
const unknown = (message = '주문 저장 결과를 확인하지 못했습니다.'): SaveOutcome => ({
  status: 'unknown',
  message,
  nextAction: '보관 요청에서 결과 확인 또는 요청 중단을 선택해 주세요. 같은 주문을 새 요청으로 다시 저장하지 마세요.'
});
export function createOrderEditWriter(port: OrderEditWritePort) {
  const references = (scope: OrderEditScope) => {
    const rows: {
      reference: OrderEditReference;
      readable: boolean;
    }[] = [];
    for (let i = 0; i < port.storage.length; i++) {
      const key = port.storage.key(i);
      if (!key?.startsWith(prefix(scope))) continue;
      const [target, plan, ...extra] = key.slice(prefix(scope).length).split(':');
      if (extra.length) throw Error('보관 요청의 저장 위치를 확인해 주세요.');
      const reference = normalizeOrderEditReference({
        companyId: scope.companyId,
        targetId: decodeURIComponent(target),
        planId: decodeURIComponent(plan)
      });
      let readable = true;
      try {
        read(scope, reference);
      } catch {
        readable = false;
      }
      rows.push({
        reference,
        readable
      });
    }
    return rows;
  };
  const read = (scope: OrderEditScope, reference: OrderEditReference): OrderEditPlan => {
    const raw = port.storage.getItem(keyOf(scope, reference));
    if (raw === null) throw Error('보관 원문이 없습니다.');
    const plan = JSON.parse(raw) as OrderEditPlan;
    const request = normalizeOrderEditRequest(plan.request);
    if (plan.version !== 1 || plan.actorUid !== scope.actorUid || request.companyId !== scope.companyId || keyOf(scope, refOf(request)) !== keyOf(scope, reference) || typeof plan.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(plan.requestHash)) throw Error('보관 원문과 회사·계정·계획 번호가 다릅니다.');
    return {
      ...plan,
      request
    };
  };
  const remove = (scope: OrderEditScope, reference: OrderEditReference, original: string | null) => {
    const key = keyOf(scope, reference);
    if (port.storage.getItem(key) !== original) throw Error('보관 원문이 바뀌어 정리하지 않았습니다.');
    port.storage.removeItem(key);
    if (port.storage.getItem(key) !== null) throw Error('보관 요청 정리를 확인하지 못했습니다.');
  };
  const prepare = async (scope: OrderEditScope, opening: Order, edit: OrderEdit, confirmedAddedToDispatched: boolean) => port.exclusive(scope, opening.id, async () => {
    await port.assertScope(scope);
    if (companyOf(opening) !== scope.companyId) throw Error('현재 회사의 주문이 아닙니다.');
    if (references(scope).some(p => p.reference.targetId === opening.id)) throw Error('이 주문의 보관 요청을 먼저 확인하거나 중단해 주세요.');
    const request = normalizeOrderEditRequest({
      version: 1,
      companyId: scope.companyId,
      planId: port.id(),
      targetId: opening.id,
      expected: orderEditExpected({
        ...opening
      }, adapter),
      edit,
      confirmedAddedToDispatched
    });
    const plan: OrderEditPlan = {
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
    if (port.storage.getItem(key) !== text) throw Error('최초 주문 원문의 보관을 확인하지 못해 전송하지 않았습니다.');
    return plan;
  });
  const run = async (scope: OrderEditScope, reference: OrderEditReference, mode: 'apply' | 'inspect' | 'cancel'): Promise<SaveOutcome> => {
    try {
      await port.assertScope(scope);
      normalizeOrderEditReference(reference);
      if (reference.companyId !== scope.companyId) throw Error('회사 불일치');
    } catch {
      return {
        status: 'cancelled',
        message: '계정이나 회사가 달라 저장을 시작하지 않았습니다.'
      };
    }
    const key = keyOf(scope, reference),
      original = port.storage.getItem(key);
    let plan: OrderEditPlan | null = null;
    if (original !== null) {
      try {
        plan = read(scope, reference);
        if ((await hash(plan.request)) !== plan.requestHash) throw Error('보관 원문의 해시가 다릅니다.');
      } catch {
        if (mode !== 'cancel') return unknown('보관 원문이 손상됐습니다. 원문을 유지하고 요청 중단으로 확인해 주세요.');
        plan = null;
      }
    }
    if (mode === 'apply' && !plan) return unknown('최초 주문 원문을 찾지 못해 전송하지 않았습니다.');
    try {
      const command: OrderEditCommand = mode === 'apply' ? {
        mode,
        request: plan!.request
      } : {
        mode,
        reference,
        ...(plan ? {
          requestHash: plan.requestHash
        } : {})
      };
      await port.assertScope(scope);
      const value = await port.command(command);
      await port.assertScope(scope);
      const result = normalizeOrderEditResult(value, reference, scope.actorUid, plan?.requestHash);
      if (result.status === 'unknown') return unknown(result.message);
      const outcome: SaveOutcome = result.status === 'applied' || result.status === 'duplicate' ? {
        status: 'saved'
      } : result.status === 'cancelled' ? {
        status: 'cancelled',
        message: result.message,
        nextAction: '주문을 다시 열어 필요한 내용을 작성해 주세요.'
      } : {
        status: 'rejected',
        message: result.message,
        nextAction: '창을 닫고 주문을 다시 열어 현재 내용을 확인한 뒤 수정해 주세요.'
      };
      try {
        await port.exclusive(scope, reference.targetId, async () => {
          await port.assertScope(scope);
          remove(scope, reference, original);
        });
      } catch {
        return result.status === 'applied' || result.status === 'duplicate' ? {
          status: 'partial',
          reason: 'followup-unconfirmed',
          committedIds: [reference.targetId],
          unconfirmedIds: [],
          message: '주문과 수정 이력은 저장됐지만 기기 보관 요청을 정리하지 못했습니다.',
          nextAction: '다시 저장하지 말고 보관 요청의 결과를 확인해 주세요.'
        } : unknown('서버 결과를 받았지만 기기 원문 정리를 확인하지 못했습니다.');
      }
      return outcome;
    } catch {
      return unknown();
    }
  };
  return {
    prepare,
    read,
    references,
    run
  };
}
async function active(scope: OrderEditScope) {
  await authReady;
  const user = auth.currentUser;
  if (!user || user.uid !== scope.actorUid) throw Error('로그인 변경');
  const {
    claims
  } = await user.getIdTokenResult();
  if (auth.currentUser?.uid !== scope.actorUid || claims.companyId !== scope.companyId || typeof claims.employeeId !== 'string') throw Error('회사·계정 권한 변경');
}
const writer = () => createOrderEditWriter({
  storage: localStorage,
  assertScope: active,
  id: () => crypto.randomUUID(),
  exclusive: async (scope, targetId, work) => {
    if (!navigator.locks?.request) throw Error('여러 창의 요청 보호를 지원하는 브라우저가 필요합니다.');
    return navigator.locks.request(prefix(scope) + targetId, {
      mode: 'exclusive'
    }, work);
  },
  command: async command => (await httpsCallable<OrderEditCommand, unknown>(functions, 'orderEditCommand')(command)).data
});
export function pendingOrderEdits(scope: OrderEditScope) {
  const service = writer();
  return service.references(scope).filter(p => p.readable).map(p => ({
    id: p.reference.targetId,
    planId: p.reference.planId,
    description: '보관된 주문 수정 요청'
  }));
}
export function orderEditReferences(scope: OrderEditScope) {
  return writer().references(scope).map(p => ({
    id: p.reference.targetId,
    planId: p.reference.planId,
    readable: p.readable
  }));
}
export const inspectOrderEdit = (scope: OrderEditScope, planId: string, targetId: string) => writer().run(scope, {
  companyId: scope.companyId,
  planId,
  targetId
}, 'inspect');
export const cancelOrderEdit = (scope: OrderEditScope, planId: string, targetId: string) => writer().run(scope, {
  companyId: scope.companyId,
  planId,
  targetId
}, 'cancel');
export async function submitOrderEdit(scope: OrderEditScope, opening: Order, edit: OrderEdit, confirmedAddedToDispatched: boolean): Promise<SaveOutcome> {
  const service = writer();
  let plan: OrderEditPlan;
  try {
    plan = await service.prepare(scope, opening, edit, confirmedAddedToDispatched);
  } catch (error) {
    return {
      status: 'rejected',
      message: error instanceof Error ? error.message : '주문 원문을 보관하지 못했습니다.',
      nextAction: '아직 전송하지 않았습니다. 보관 요청과 기기 저장소를 확인해 주세요.'
    };
  }
  return service.run(scope, refOf(plan.request), 'apply');
}
