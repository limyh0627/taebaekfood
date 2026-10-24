import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rows: new Map<string, any>(), writes: [] as string[], lost: false, reject: false,
  prepares: [] as string[], beforePrepare: async () => {}, afterCommit: () => {}, commitError: null as any, readError: null as any, user: null as any }));
vi.mock('../firebase', () => ({ authReady: Promise.resolve(), auth: { get currentUser() { return m.user; } }, db: {} }));
vi.mock('./firebaseService', () => ({ stripUndefined: (v: any) => JSON.parse(JSON.stringify(v)) }));
vi.mock('firebase/firestore', () => ({ doc: (_: unknown, c: string, id: string) => c + '/' + id,
  getDocFromServer: async (path: string) => { if (m.readError) throw m.readError; return snap(path); } }));
vi.mock('../inventoryWriterProtocol', () => ({
  captureInventoryWriterContext: async () => ({}),
  runInventoryWriterTransaction: async (_: unknown, _context: unknown, fn: any) => {
    const queued: [string, any][] = [];
    const result = await fn({ get: async (path: string) => { expect(queued).toHaveLength(0); return snap(path); },
      set: (path: string, data: any) => queued.push([path, data]) });
    if (m.commitError) throw m.commitError;
    if (m.reject) throw Error('커밋 거절');
    for (const [path, data] of queued) { m.rows.set(path, structuredClone(data)); m.writes.push(path); }
    m.afterCommit();
    if (m.lost) throw Error('응답 유실');
    return result;
  },
  prepareCatalogOrderCommit: async (_: unknown, tx: any, id: string, before: any, data: any, replace: boolean, collection: string) => {
    await tx.get('catalog/' + id); await m.beforePrepare(); m.prepares.push(id);
    expect(before).toBeUndefined(); expect(replace).toBe(true); expect(collection).toBe('purchaseOrders');
    return { ...data, catalogReferenceProofId: 'proof-' + id };
  },
}));
import { applyPurchaseOrderBatch, cancelPurchaseOrderBatch, inspectPurchaseOrderBatch, normalizePurchaseOrderBatchReference,
  normalizePurchaseOrderBatchRequest, planPurchaseOrderBatch, purchaseOrderBatchReference, serializePurchaseOrderBatchRequest } from './purchaseOrderBatchService';
function snap(path: string) { return { exists: () => m.rows.has(path), data: () => structuredClone(m.rows.get(path)) }; }
const scope = { companyId: 'taebaek' as const, actorUid: 'actor', isCurrent: () => true };
const plan = (count = 2) => planPurchaseOrderBatch({ scope, rows: Array.from({ length: count }, (_, i) => ({ id: 'i' + i, quantity: i + 1, boxQuantity: 2, partnerId: 'p' + i })),
  operationId: 'po-batch-unit', createdAt: '2026-10-24T00:00:00Z', date: '2026-10-24',
  items: Array.from({ length: count }, (_, i) => ({ id: 'i' + i, name: '품목' + i, unit: '개' })),
  partners: Array.from({ length: count }, (_, i) => ({ id: 'p' + i, name: '거래처' + i })),
  partnerIn: Array.from({ length: count }, (_, i) => ({ itemId: 'i' + i, partnerId: 'p' + i })), purchaseOrders: [] });
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); m.rows.clear(); m.writes = []; m.prepares = []; m.reject = false; m.lost = false;
  m.beforePrepare = async () => {}; m.afterCommit = () => {}; m.commitError = null; m.readError = null;
  m.user = { uid: 'actor', getIdTokenResult: async () => ({ claims: { employeeId: 'employee', companyId: 'taebaek' } }) }; });
it('원문 BOX 수량·거래처 묶음·누적 카드번호·불변 ID를 고정한다', () => {
  const r = plan(); expect(r.orders.map(o => o.data.cardNo)).toEqual(['PO-261024-001', 'PO-261024-002']);
  expect(r.orders[0].data.items).toEqual([{ itemId: 'i0', name: '품목0', quantity: 1, unit: '개', boxQuantity: 2 }]);
  expect(r.orders[0].data).not.toHaveProperty('id'); expect(r.orders[0].data).not.toHaveProperty('inventoryWriteRevision');
  expect(Object.isFrozen(r.orders[0].data.items)).toBe(true);
});
it('동일 거래처는 한 카드·미지정 거래처 품목은 각각 카드로 보존한다', () => {
  const r = planPurchaseOrderBatch({ scope, rows: [{ id: 'i', quantity: 1 }, { id: 'i', quantity: 2 }], operationId: 'po-batch-groups',
    createdAt: '2026-10-24T00:00:00Z', date: '2026-10-24', items: [], partners: [], partnerIn: [], purchaseOrders: [] });
  expect(r.orders).toHaveLength(2); expect(r.orders[0].data.items).toEqual([{ itemId: 'i', name: '', quantity: 1, unit: '개' }]);
  const grouped = planPurchaseOrderBatch({ scope, rows: [{ id: 'i', quantity: 1 }, { id: 'i', quantity: 2 }], operationId: 'po-batch-groups',
    createdAt: '2026-10-24T00:00:00Z', date: '2026-10-24', items: [], partners: [{ id: 'p' }], partnerIn: [{ itemId: 'i', partnerId: 'p' }], purchaseOrders: [] });
  expect(grouped.orders).toHaveLength(1); expect(grouped.orders[0].data.items).toHaveLength(2);
});
it('다른 partner 연결·양수 아닌 수량·초과 묶음·과대 요청은 쓰기 전 차단한다', () => {
  expect(() => plan(6)).toThrow('1~5');
  const r = JSON.parse(JSON.stringify(plan())); r.orders[0].data.items[0].quantity = 0;
  expect(() => normalizePurchaseOrderBatchRequest(r)).toThrow('수량');
  r.orders[0].data.items[0].quantity = 1; r.orders[0].data.note = '가'.repeat(180000);
  expect(() => normalizePurchaseOrderBatchRequest(r)).toThrow('너무 큽니다');
  expect(m.writes).toEqual([]);
});
it('키 순서와 무관한 한 SHA 정본이며 다른 원문은 다른 reference이다', async () => {
  const r = plan(), reordered = Object.fromEntries(Object.entries(r).reverse());
  expect(await purchaseOrderBatchReference(r)).toEqual(await purchaseOrderBatchReference(reordered as any));
  expect(serializePurchaseOrderBatchRequest(r)).toBe(serializePurchaseOrderBatchRequest(reordered as any));
  const next = JSON.parse(JSON.stringify(r)); next.orders[0].data.items[0].quantity++;
  expect((await purchaseOrderBatchReference(next)).requestHash).not.toBe((await purchaseOrderBatchReference(r)).requestHash);
});
it('모든 target/proof 읽기 뒤 전체 그룹과 receipt만 한 번 쓰며 PO revision을 추가하지 않는다', async () => {
  const r = plan(5); expect((await applyPurchaseOrderBatch(scope, r)).status).toBe('applied');
  expect(m.prepares).toHaveLength(5); expect(m.writes).toHaveLength(6);
  for (const order of r.orders) { expect(m.rows.get('purchaseOrders/' + order.id)).not.toHaveProperty('inventoryWriteRevision'); }
  expect(m.writes.every(path => path.startsWith('purchaseOrders/') || path.startsWith('purchaseOrderBatchAudits/'))).toBe(true);
});
it('후행 proof 거절·전체 commit 거절은 모든 업무 문서와 receipt를 남기지 않는다', async () => {
  const r = plan(); let count = 0; m.beforePrepare = async () => { if (++count === 2) throw Error('후행 proof'); };
  await expect(applyPurchaseOrderBatch(scope, r)).rejects.toThrow(); expect(m.rows.size).toBe(0);
  m.beforePrepare = async () => {}; m.reject = true;
  await expect(applyPurchaseOrderBatch(scope, r)).rejects.toMatchObject({ outcome: 'unknown' }); expect(m.rows.size).toBe(0);
});
it('기존 ID는 회사·같은 원문과 무관하게 덮기 없이 충돌한다', async () => {
  const r = plan(); m.rows.set('purchaseOrders/' + r.orders[1].id, { companyId: 'taebaek', keep: 7 });
  await expect(applyPurchaseOrderBatch(scope, r)).rejects.toThrow('이미'); expect(m.writes).toEqual([]);
  expect(m.rows.get('purchaseOrders/' + r.orders[1].id).keep).toBe(7);
});
it('ACK 유실 뒤 receipt-first 재시도는 원 PO가 삭제돼도 재생성하지 않는다', async () => {
  const r = plan(); m.lost = true; await expect(applyPurchaseOrderBatch(scope, r)).rejects.toMatchObject({ outcome: 'unknown' });
  m.lost = false; r.orders.forEach(o => m.rows.delete('purchaseOrders/' + o.id)); const count = m.writes.length;
  expect((await applyPurchaseOrderBatch(scope, r)).status).toBe('applied'); expect(m.writes).toHaveLength(count);
  expect((await inspectPurchaseOrderBatch(scope, await purchaseOrderBatchReference(r))).status).toBe('applied');
});
it('ref-only 부재 조회는 쓰지 않고 nullrequest cancel fence는 늦은 apply를 막는다', async () => {
  const r = plan(), ref = await purchaseOrderBatchReference(r);
  expect((await inspectPurchaseOrderBatch(scope, ref)).status).toBe('not-found'); expect(m.writes).toEqual([]);
  expect((await cancelPurchaseOrderBatch(scope, ref)).status).toBe('cancelled');
  expect(m.rows.get('purchaseOrderBatchAudits/' + ref.operationId).request).toBeNull();
  expect((await applyPurchaseOrderBatch(scope, r)).status).toBe('cancelled'); expect(m.writes).toHaveLength(1);
});
it('applied 뒤 cancel은 rollback하지 않고 손상·다른 digest receipt는 거절한다', async () => {
  const r = plan(), ref = await purchaseOrderBatchReference(r); await applyPurchaseOrderBatch(scope, r);
  expect((await cancelPurchaseOrderBatch(scope, ref)).status).toBe('applied'); expect(m.writes).toHaveLength(3);
  await expect(inspectPurchaseOrderBatch(scope, { ...ref, requestHash: 'a'.repeat(64) })).rejects.toThrow('다른 요청');
  m.rows.get('purchaseOrderBatchAudits/' + ref.operationId).request = null;
  await expect(inspectPurchaseOrderBatch(scope, ref)).rejects.toThrow();
});
it('회사·UID·employee claim 및 await 중 실제 User 교체는 송신하지 않는다', async () => {
  const r = plan(), ref = await purchaseOrderBatchReference(r);
  await expect(inspectPurchaseOrderBatch({ ...scope, actorUid: 'other' }, ref)).rejects.toThrow('다른');
  m.user.getIdTokenResult = async () => ({ claims: { companyId: 'punghoe', employeeId: 'e' } });
  await expect(applyPurchaseOrderBatch(scope, r)).rejects.toThrow('회사');
  m.user.getIdTokenResult = async () => ({ claims: { companyId: 'taebaek' } });
  await expect(applyPurchaseOrderBatch(scope, r)).rejects.toThrow('직원');
  m.user.getIdTokenResult = async () => { m.user = { uid: 'actor' }; return { claims: { companyId: 'taebaek', employeeId: 'e' } }; };
  await expect(applyPurchaseOrderBatch(scope, r)).rejects.toThrow('회사'); expect(m.writes).toEqual([]);
});
it('commit 뒤 owner 상실을 notstarted로 오분류하지 않는다', async () => {
  m.afterCommit = () => { m.user = null; };
  await expect(applyPurchaseOrderBatch(scope, plan())).rejects.toMatchObject({ outcome: 'unknown' }); expect(m.writes).toHaveLength(3);
});
it('엄격 reference는 추가필드·잘못된 prefix·회사없는 옛자료를 채택하지 않는다', async () => {
  const ref = await purchaseOrderBatchReference(plan());
  expect(() => normalizePurchaseOrderBatchReference({ ...ref, extra: 1 })).toThrow();
  expect(() => normalizePurchaseOrderBatchReference({ ...ref, operationId: 'other' })).toThrow();
  expect(() => normalizePurchaseOrderBatchRequest({ ...plan(), companyId: undefined })).toThrow();
});
it.each([
  ['unavailable', '서버 연결이 원활하지 않아'],
  ['permission-denied', '회사 또는 발주 처리 권한'],
  ['deadline-exceeded', '응답 대기 시간이 지나'],
  ['unknown-new-code', '발주 처리 결과를 확인하지 못했습니다'],
])('송신 %s 원인은 한국어 다음 행동과 원cause로만 보존한다', async (code, expected) => {
  const request = plan(), encoded = serializePurchaseOrderBatchRequest(request);
  const original = Object.assign(Error('Firebase private raw reason'), { code }); m.commitError = original;
  const caught = await applyPurchaseOrderBatch(scope, request).catch(error => error);
  expect(caught).toMatchObject({ outcome: 'unknown', cause: original });
  expect(caught.message).toContain(expected); expect(caught.message).toContain('조회');
  expect(caught.message).not.toContain('Firebase private raw reason');
  expect(serializePurchaseOrderBatchRequest(request)).toBe(encoded);
});
it('ref-only 중단의 Firebase 권한 오류도 실패 원인과 조회 안내를 보존한다', async () => {
  const original = Object.assign(Error('Firebase internal permission detail'), { code: 'firestore/permission-denied' });
  m.commitError = original;
  const caught = await cancelPurchaseOrderBatch(scope, await purchaseOrderBatchReference(plan())).catch(error => error);
  expect(caught).toMatchObject({ outcome: 'unknown', cause: original }); expect(caught.message).toContain('권한');
  expect(caught.message).not.toContain('Firebase internal'); expect(m.writes).toEqual([]);
});
it('조회 unavailable은 notfound로 승격하지 않고 한국어 이유·원cause·다음 조회 행동을 남긴다', async () => {
  const original = Object.assign(Error('Firebase raw read failure'), { code: 'unavailable' }); m.readError = original;
  const caught = await inspectPurchaseOrderBatch(scope, await purchaseOrderBatchReference(plan())).catch(error => error);
  expect(caught).toMatchObject({ outcome: 'unknown', cause: original });
  expect(caught.message).toContain('서버 연결'); expect(caught.message).toContain('조회');
  expect(caught.message).not.toContain('Firebase raw'); expect(caught).not.toHaveProperty('status'); expect(m.writes).toEqual([]);
});
