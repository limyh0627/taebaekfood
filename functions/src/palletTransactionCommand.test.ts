import { beforeEach, expect, it } from 'vitest';
import type * as admin from 'firebase-admin';
import { executePalletTransactionForActor } from './palletTransactionCommand';
import type { PalletTransactionRequest, PalletExchangeCompletionRequest, PalletStockEditRequest } from './shared/palletTransactionCommand';
const actor = { uid: 'u', token: { employeeId: '', companyId: 'taebaek', isAdmin: false } };
const make = (transfer = false): PalletTransactionRequest => ({ version: 1, reference: { companyId: 'taebaek', operationId: 'op', transactionId: 'tx' }, transaction: { partnerId: 'partner', palletId: 'pallet', type: 'out', quantity: 3, date: '2026-10-21', note: '', ...(transfer ? { isTransfer: true } : {}) }, ...(transfer ? { transfer: { originalTotal: 2, expectedVersion: '1:000000001' } } : {}) });
let rows: Map<string, Record<string, unknown>>;
let writes: number;
function store(): admin.firestore.Firestore {
  const snap = (path: string) => ({ exists: rows.has(path), data: () => rows.get(path), updateTime: rows.has(path) ? { seconds: 1, nanoseconds: 1 } : undefined });
  const ref = (path: string) => ({ path, get: async () => snap(path) });
  return { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }), runTransaction: async (run: (tx: unknown) => Promise<unknown>) => {
    const staged: Array<() => void> = [];
    const answer = await run({ get: async (r: { path: string }) => snap(r.path),
      create: (r: { path: string }, value: Record<string, unknown>) => staged.push(() => { if (rows.has(r.path)) throw Error('exists'); rows.set(r.path, value); writes++; }),
      update: (r: { path: string }, value: Record<string, unknown>) => staged.push(() => { rows.set(r.path, { ...rows.get(r.path), ...value }); writes++; }) });
    staged.forEach(fn => fn()); return answer;
  } } as unknown as admin.firestore.Firestore;
}
beforeEach(() => { rows = new Map([['partners/partner', { companyId: 'taebaek' }], ['pallets/pallet', { companyId: 'taebaek', total: 2, hidden: '보존' }]]); writes = 0; });
it('직원 open과 부재 inspect는 읽기 전용이며 원 total 불일치를 거절한다', async () => {
  const request = make(true), db = store();
  expect(await executePalletTransactionForActor(db, actor, { mode: 'open', reference: request.reference, palletId: 'pallet', originalTotal: 2 })).toMatchObject({ expectedVersion: '1:000000001', actorUid: 'u' });
  await expect(executePalletTransactionForActor(db, actor, { mode: 'open', reference: request.reference, palletId: 'pallet', originalTotal: 3 })).rejects.toThrow('변경');
  expect(await executePalletTransactionForActor(db, actor, { mode: 'inspect', reference: request.reference })).toMatchObject({ status: 'unknown' }); expect(writes).toBe(0);
});
it('일반·교체는 재고를 쓰지 않고 이전 거래를 덮지 않는다', async () => {
  const request = make(); request.transaction.status = '교체중'; request.transaction.exchangeReturnQty = 0;
  expect(await executePalletTransactionForActor(store(), actor, { mode: 'apply', request })).toMatchObject({ status: 'applied' });
  expect(rows.get('pallets/pallet')?.total).toBe(2); expect(writes).toBe(2);
  const other = make(); other.reference.operationId = 'other';
  await expect(executePalletTransactionForActor(store(), actor, { mode: 'apply', request: other })).rejects.toMatchObject({ details: { operationStatus: 'rejected', writes: false } });
  expect(rows.get('palletTransactions/tx')?.status).toBe('교체중');
});
it('이동은 clamp total만 갱신하고 완료 재송신·완료 중단은 추가 쓰기0이다', async () => {
  const request = make(true), db = store();
  await executePalletTransactionForActor(db, actor, { mode: 'apply', request });
  expect(rows.get('pallets/pallet')).toEqual({ companyId: 'taebaek', total: 0, hidden: '보존' });
  rows.delete('palletTransactions/tx'); rows.delete('pallets/pallet'); const count = writes;
  expect(await executePalletTransactionForActor(db, actor, { mode: 'apply', request })).toMatchObject({ status: 'applied' });
  expect(await executePalletTransactionForActor(db, actor, { mode: 'cancel', reference: request.reference })).toMatchObject({ status: 'applied' });
  expect(writes).toBe(count); expect(rows.has('palletTransactions/tx')).toBe(false);
});
it('중단 fence는 늦은 apply를 막고 같은 op의 원문교체를 거절한다', async () => {
  const request = make(), db = store();
  await executePalletTransactionForActor(db, actor, { mode: 'cancel', reference: request.reference });
  await expect(executePalletTransactionForActor(db, actor, { mode: 'apply', request })).rejects.toMatchObject({ details: { operationStatus: 'cancelled' } });
  expect(rows.has('palletTransactions/tx')).toBe(false);
});
it('회사·UID·버전·원total·손상 영수증 충돌은 쓰기0으로 거절한다', async () => {
  const request = make(true), db = store();
  for (const who of [undefined, { ...actor, token: { companyId: 'taebaek' } }, { ...actor, token: { employeeId: 'e', companyId: 'punghoe' } }])
    await expect(executePalletTransactionForActor(db, who, { mode: 'apply', request })).rejects.toThrow();
  const stale = structuredClone(request); stale.transfer!.expectedVersion = '2:000000001';
  await expect(executePalletTransactionForActor(db, actor, { mode: 'apply', request: stale })).rejects.toThrow('변경');
  rows.set('partners/partner', { companyId: 'punghoe' });
  await expect(executePalletTransactionForActor(db, actor, { mode: 'apply', request })).rejects.toThrow('거래처');
  expect(writes).toBe(0);
  rows.set('palletTransactionOperations/op', { status: 'applied' });
  await expect(executePalletTransactionForActor(db, actor, { mode: 'inspect', reference: request.reference })).rejects.toThrow('기록');
});
it('이동 덧셈의 안전 정수 초과를 clamp 전에 거절하고 최대값 차감은 그대로 처리한다', async () => {
  const request = make(true); request.transaction.type = 'in'; request.transaction.quantity = 1; request.transfer!.originalTotal = Number.MAX_SAFE_INTEGER;
  rows.set('pallets/pallet', { companyId: 'taebaek', total: Number.MAX_SAFE_INTEGER });
  await expect(executePalletTransactionForActor(store(), actor, { mode: 'apply', request })).rejects.toMatchObject({ details: { operationStatus: 'rejected', writes: false } });
  expect(writes).toBe(0);
  request.transaction.type = 'out'; request.transaction.quantity = Number.MAX_SAFE_INTEGER;
  await executePalletTransactionForActor(store(), actor, { mode: 'apply', request });
  expect(rows.get('pallets/pallet')?.total).toBe(0);
});
function completion(returnQuantity?: number): PalletExchangeCompletionRequest {
  const source = { ...make().transaction, status: '교체중' as const, ...(returnQuantity !== undefined ? { exchangeReturnQty: returnQuantity } : {}) };
  rows.set('palletTransactions/source', { companyId: 'taebaek', ...source, hidden: { saved: true } });
  return { version: 2, action: 'complete-exchange', reference: make().reference, sourceTransactionId: 'source', source, expectedVersion: '1:000000001', returnDate: '2026-10-22' };
}
it('교체 열기는 source 원문을 비교하고 native만 반환하며 불일치는 쓰기0이다', async () => {
  const request = completion(0), db = store();
  expect(await executePalletTransactionForActor(db, actor, { mode: 'open-exchange', reference: request.reference, sourceTransactionId: 'source', source: request.source })).toMatchObject({ source: request.source, expectedVersion: request.expectedVersion });
  await expect(executePalletTransactionForActor(db, actor, { mode: 'open-exchange', reference: request.reference, sourceTransactionId: 'source', source: { ...request.source, note: '변경' } })).rejects.toThrow('변경');
  expect(writes).toBe(0);
});
it.each([0, 2, undefined])('교체완료 회수 %s는 상태만 patch하고 양수일 때만 고정 회수행을 만든다', async quantity => {
  const request = completion(quantity); rows.delete('partners/partner'); rows.delete('pallets/pallet');
  await executePalletTransactionForActor(store(), actor, { mode: 'apply', request });
  expect(rows.get('palletTransactions/source')).toEqual({ companyId: 'taebaek', ...request.source, status: '교체완료', hidden: { saved: true } });
  if (quantity === 0) { expect(rows.has('palletTransactions/tx')).toBe(false); expect(writes).toBe(2); }
  else { expect(rows.get('palletTransactions/tx')).toEqual({ companyId: 'taebaek', partnerId: 'partner', palletId: 'pallet', type: 'in', quantity: quantity ?? 3, date: '2026-10-22', note: '교체완료 회수' }); expect(writes).toBe(3); }
});
it('교체 회수0도 target충돌을 거절하고 완료 source의 다른 op는 재완료하지 않는다', async () => {
  const request = completion(0), db = store(); rows.set('palletTransactions/tx', { companyId: 'punghoe', note: '보존' });
  await expect(executePalletTransactionForActor(db, actor, { mode: 'apply', request })).rejects.toThrow('이미'); expect(writes).toBe(0);
  rows.delete('palletTransactions/tx'); await executePalletTransactionForActor(db, actor, { mode: 'apply', request });
  const other = structuredClone(request); other.reference.operationId = 'other'; other.reference.transactionId = 'other-return';
  await expect(executePalletTransactionForActor(db, actor, { mode: 'apply', request: other })).rejects.toMatchObject({ details: { operationStatus: 'rejected', writes: false } });
  const count = writes; rows.delete('palletTransactions/source');
  expect(await executePalletTransactionForActor(db, actor, { mode: 'apply', request })).toMatchObject({ status: 'applied' }); expect(writes).toBe(count);
});
it('교체 source의 회사·버전·선택값 오염과 중단 fence는 업무 쓰기0이다', async () => {
  const request = completion(2), db = store();
  await expect(executePalletTransactionForActor(db, actor, { mode: 'apply', request: { ...request, expectedVersion: '2:000000001' } })).rejects.toThrow('변경');
  rows.set('palletTransactions/source', { companyId: 'punghoe', ...request.source });
  await expect(executePalletTransactionForActor(db, actor, { mode: 'apply', request })).rejects.toThrow('회사'); expect(writes).toBe(0);
  await executePalletTransactionForActor(db, actor, { mode: 'cancel', reference: request.reference });
  await expect(executePalletTransactionForActor(db, actor, { mode: 'apply', request })).rejects.toMatchObject({ details: { operationStatus: 'cancelled' } });
  expect(rows.has('palletTransactions/tx')).toBe(false);
});
function editRequest(): PalletStockEditRequest {
  rows.set('pallets/pallet', { companyId: 'taebaek', name: ' 원래 ', total: 2, damaged: 1, hidden: true, inUse: 5, unknown: { keep: true } });
  return { version: 3, action: 'edit-pallet', reference: { kind: 'pallet-edit', companyId: 'taebaek', operationId: 'edit-op', palletId: 'pallet' },
    original: { name: ' 원래 ', total: 2, damaged: 1 }, expectedVersion: '1:000000001', patch: { name: '' } };
}
it('편집 open은 최초 세 필드 동치와 native를 읽고 stale원문을 새버전으로 세탁하지 않는다', async () => {
  const request = editRequest(), db = store();
  expect(await executePalletTransactionForActor(db, actor, { mode: 'open-edit', reference: request.reference, original: request.original })).toMatchObject({ original: request.original, expectedVersion: request.expectedVersion });
  await expect(executePalletTransactionForActor(db, actor, { mode: 'open-edit', reference: request.reference, original: { ...request.original, total: 10 } })).rejects.toThrow('변경');
  expect(writes).toBe(0);
});
it('편집은 dirty 필드만 patch하고 숨은값·미소유 필드를 보존하며 완료 삭제 후 재생성0이다', async () => {
  const request = editRequest(), db = store(), before = rows.get('pallets/pallet');
  await executePalletTransactionForActor(db, actor, { mode: 'apply', request });
  expect(rows.get('pallets/pallet')).toEqual({ ...before, name: '' }); expect(writes).toBe(2);
  rows.delete('pallets/pallet'); const count = writes;
  expect(await executePalletTransactionForActor(db, actor, { mode: 'apply', request })).toMatchObject({ status: 'applied' });
  expect(await executePalletTransactionForActor(db, actor, { mode: 'cancel', reference: request.reference })).toMatchObject({ status: 'applied' });
  expect(writes).toBe(count); expect(rows.has('pallets/pallet')).toBe(false);
});
it('편집 native·원문·회사 충돌은 명시 무쓰기이고 emptydirty도 영수증을 만들지 않는다', async () => {
  const request = editRequest(), db = store();
  for (const input of [{ ...request, expectedVersion: '2:000000001' }, { ...request, original: { ...request.original, total: 9 } }])
    await expect(executePalletTransactionForActor(db, actor, { mode: 'apply', request: input })).rejects.toMatchObject({ details: { operationStatus: 'rejected', writes: false } });
  await expect(executePalletTransactionForActor(db, actor, { mode: 'apply', request: { ...request, patch: {} } })).rejects.toThrow('없습니다');
  rows.set('pallets/pallet', { ...rows.get('pallets/pallet'), companyId: 'punghoe' });
  await expect(executePalletTransactionForActor(db, actor, { mode: 'apply', request })).rejects.toMatchObject({ details: { operationStatus: 'rejected', writes: false } }); expect(writes).toBe(0);
});
it('편집 cancel fence와 다른종류·다른 대상·UID의 영수증 충돌은 업무를 쓰지 않는다', async () => {
  const request = editRequest(), db = store();
  expect(await executePalletTransactionForActor(db, actor, { mode: 'cancel', reference: request.reference })).toMatchObject({
    message: '이 요청의 미처리 중단을 확인했습니다. 이미 처리된 내용을 되돌린 것이 아닙니다.',
  });
  await expect(executePalletTransactionForActor(db, actor, { mode: 'apply', request })).rejects.toMatchObject({ details: { operationStatus: 'cancelled' } });
  for (const reference of [{ ...request.reference, palletId: 'other' }, { companyId: 'taebaek', operationId: 'edit-op', transactionId: 'pallet' }])
    await expect(executePalletTransactionForActor(db, actor, { mode: 'inspect', reference })).rejects.toThrow('기록');
  await expect(executePalletTransactionForActor(db, { ...actor, uid: 'other' }, { mode: 'inspect', reference: request.reference })).rejects.toThrow('기록');
  expect(rows.get('pallets/pallet')?.name).toBe(' 원래 ');
});
