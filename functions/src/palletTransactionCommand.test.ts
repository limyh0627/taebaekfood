import { beforeEach, expect, it } from 'vitest';
import type * as admin from 'firebase-admin';
import { executePalletTransactionForActor } from './palletTransactionCommand';
import type { PalletTransactionRequest } from './shared/palletTransactionCommand';
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
