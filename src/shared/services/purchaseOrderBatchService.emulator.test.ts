/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, webcrypto, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, setDoc, deleteDoc, type Firestore } from 'firebase/firestore';
const m = vi.hoisted(() => ({ db: undefined as any, makeProof: null as any, uid: 'writer' }));
vi.mock('../firebase', () => ({ get db() { return m.db; }, functions: {}, authReady: Promise.resolve(), auth: {
  get currentUser() { return user; },
} }));
const user = { get uid() { return m.uid; }, getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', employeeId: 'writer' } }) };
vi.mock('./firebaseService', () => ({ stripUndefined: (value: any) => JSON.parse(JSON.stringify(value)) }));
// Callable transport만 합성한다. 실제 catalog prepare의 epoch/proof 읽기와 현 Rules 판정은 그대로 실행한다.
vi.mock('firebase/functions', () => ({ httpsCallable: () => async (request: any) => ({ data: await m.makeProof(request) }) }));
import { decodeCatalogValue, type CatalogValueAdapter } from '../../../functions/src/shared/catalogOrderReferenceProof';
import { applyPurchaseOrderBatch, cancelPurchaseOrderBatch, inspectPurchaseOrderBatch, planPurchaseOrderBatch, purchaseOrderBatchReference } from './purchaseOrderBatchService';

describe.skipIf(process.env.PURCHASE_BATCH_SDK !== 'true')('발주 묶음 실제 Firestore SDK·현 Rules', () => {
  let env: RulesTestEnvironment;
  const projectId = 'demo-po-batch-' + randomUUID().slice(0, 8), paths = new Set<string>();
  const scope = { companyId: 'taebaek' as const, actorUid: 'writer', isCurrent: () => true };
  const rules = readFileSync('firestore.rules', 'utf8');
  const adapter: CatalogValueAdapter = { special: () => undefined, timestamp: () => { throw Error('fixture timestamp'); },
    reference: () => { throw Error('fixture ref'); }, geo: () => { throw Error('fixture geo'); }, bytes: () => { throw Error('fixture bytes'); } };
  beforeAll(async () => {
    vi.stubGlobal('crypto', webcrypto);
    env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8182, rules } });
    m.db = env.authenticatedContext('writer', { companyId: 'taebaek', employeeId: 'writer', isAdmin: false }).firestore();
    m.makeProof = async (request: any) => {
      const proofId = 'fixture-' + createHash('sha256').update(JSON.stringify({ ...request, uid: m.uid })).digest('hex');
      const path = 'catalogOrderReferenceProofs/' + proofId; paths.add(path);
      const data = { ...request, actorUid: m.uid, beforeProjection: decodeCatalogValue(request.beforeProjection, adapter), nextProjection: decodeCatalogValue(request.nextProjection, adapter) };
      await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), path), data));
      return { proofId, catalogRevision: request.catalogRevision };
    };
    await seed('catalogItemMergeState/taebaek', { companyId: 'taebaek', revision: 7 });
  }, 30000);
  afterAll(async () => {
    if (!env) return;
    await env.withSecurityRulesDisabled(async c => { for (const path of paths) await deleteDoc(doc(c.firestore(), path));
      for (const path of paths) expect((await getDocFromServer(doc(c.firestore(), path))).exists()).toBe(false); });
    writeFileSync('work/purchase-batch-A-sdk-fixture-cleanup.json', JSON.stringify({ projectId, paths: paths.size, ownFixturesRemoved: true, globalFlush: false, authSdk: false, callableTransportSynthetic: true, firestoreRulesReal: true }, null, 2));
    await env.cleanup();
  }, 30000);
  async function seed(path: string, value: any) { paths.add(path); await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), path), value)); }
  function request(count = 2) {
    const r = planPurchaseOrderBatch({ scope, rows: Array.from({ length: count }, (_, i) => ({ id: 'i' + i, quantity: i + 1, boxQuantity: 2, partnerId: 'p' + i })),
      operationId: 'po-batch-' + randomUUID(), createdAt: '2026-10-24T00:00:00Z', date: '2026-10-24',
      items: Array.from({ length: count }, (_, i) => ({ id: 'i' + i, name: '품목' + i, unit: '개' })), partners: Array.from({ length: count }, (_, i) => ({ id: 'p' + i })),
      partnerIn: Array.from({ length: count }, (_, i) => ({ itemId: 'i' + i, partnerId: 'p' + i })), purchaseOrders: [] });
    r.orders.forEach(o => paths.add('purchaseOrders/' + o.id)); paths.add('purchaseOrderBatchAudits/' + r.operationId); return r;
  }
  const get = async (path: string) => (await getDocFromServer(doc(m.db, path))).data();
  it('proof 활성·일반 직원 5그룹은 실제 prepare와 Rules를 통과해 전체+receipt 저장한다', async () => {
    const r = request(5); expect((await applyPurchaseOrderBatch(scope, r)).status).toBe('applied');
    for (const order of r.orders) { const stored = await get('purchaseOrders/' + order.id);
      expect(stored).toMatchObject(order.data); expect(stored?.catalogReferenceProofId).toMatch(/^fixture-/);
      expect(stored).not.toHaveProperty('inventoryWriteRevision'); expect(stored).not.toHaveProperty('inventoryWriterProtocolVersion'); }
    expect((await get('purchaseOrderBatchAudits/' + r.operationId))?.request).toEqual(r);
  }, 30000);
  it('동일 회사 관리자도 같은 경계를 쓰고 새 admin 전용 조건을 요구하지 않는다', async () => {
    const r = request(1), admin = env.authenticatedContext('writer', { companyId: 'taebaek', employeeId: 'writer', isAdmin: true }).firestore();
    expect((await applyPurchaseOrderBatch(scope, r, admin as unknown as Firestore)).status).toBe('applied');
  });
  it('타회사 Rules 인증은 회사 PO와 receipt를 만들지 못한다', async () => {
    const r = request(), foreign = env.authenticatedContext('foreign', { companyId: 'punghoe', employeeId: 'foreign' }).firestore();
    await expect(applyPurchaseOrderBatch(scope, r, foreign as unknown as Firestore)).rejects.toThrow();
    for (const order of r.orders) expect(await get('purchaseOrders/' + order.id)).toBeUndefined();
  });
  it('후행 target이 이미 있으면 원문을 보존하고 앞 PO와 receipt도 만들지 않는다', async () => {
    const r = request(); await seed('purchaseOrders/' + r.orders[1].id, { companyId: 'taebaek', hidden: 9 });
    await expect(applyPurchaseOrderBatch(scope, r)).rejects.toThrow('이미');
    expect(await get('purchaseOrders/' + r.orders[0].id)).toBeUndefined(); expect(await get('purchaseOrderBatchAudits/' + r.operationId)).toBeUndefined();
    expect((await get('purchaseOrders/' + r.orders[1].id))?.hidden).toBe(9);
  });
  it('동일 요청 중복은 원 PO 삭제 뒤에도 재생성하지 않는다', async () => {
    const r = request(); await applyPurchaseOrderBatch(scope, r); await env.withSecurityRulesDisabled(async c => { for (const o of r.orders) await deleteDoc(doc(c.firestore(), 'purchaseOrders', o.id)); });
    expect((await applyPurchaseOrderBatch(scope, r)).status).toBe('applied');
    for (const o of r.orders) expect(await get('purchaseOrders/' + o.id)).toBeUndefined();
  });
  it('ref-only cancel은 nullrequest fence를 남기고 lateapply를 막는다', async () => {
    const r = request(), ref = await purchaseOrderBatchReference(r);
    expect((await inspectPurchaseOrderBatch(scope, ref)).status).toBe('not-found');
    expect((await cancelPurchaseOrderBatch(scope, ref)).status).toBe('cancelled');
    expect((await get('purchaseOrderBatchAudits/' + r.operationId))?.request).toBeNull();
    expect((await applyPurchaseOrderBatch(scope, r)).status).toBe('cancelled');
    for (const o of r.orders) expect(await get('purchaseOrders/' + o.id)).toBeUndefined();
  });
  it('apply와 refcancel 동시 경합은 receipt 한 결과로 수렴한다', async () => {
    const r = request(), ref = await purchaseOrderBatchReference(r);
    const results = await Promise.all([applyPurchaseOrderBatch(scope, r), cancelPurchaseOrderBatch(scope, ref)]);
    expect(results[0].status).toBe(results[1].status);
    for (const o of r.orders) expect(!!await get('purchaseOrders/' + o.id)).toBe(results[0].status === 'applied');
  }, 30000);
  it('같은 operation 다른 digest나 UID는 terminal로 채택하지 않는다', async () => {
    const r = request(), ref = await purchaseOrderBatchReference(r); await cancelPurchaseOrderBatch(scope, ref);
    await expect(inspectPurchaseOrderBatch(scope, { ...ref, requestHash: 'f'.repeat(64) })).rejects.toThrow('다른 요청');
    await expect(cancelPurchaseOrderBatch(scope, { ...ref, actorUid: 'other' })).rejects.toThrow('다른');
  });
  it('후행 PO Rules 거절은 앞 그룹과 receipt까지 원자 rollback한다', async () => {
    const r = request(), blocked = r.orders[1].id;
    const faultRules = rules.replace("allow create, update: if isEmployee() && createUpdateOk() && inventoryQuantityOk('purchaseOrders')", "allow create, update: if id != '" + blocked + "' && isEmployee() && createUpdateOk() && inventoryQuantityOk('purchaseOrders')");
    const fault = await initializeTestEnvironment({ projectId: projectId + '-fault', firestore: { host: '127.0.0.1', port: 8182, rules: faultRules } });
    const store = fault.authenticatedContext('writer', { companyId: 'taebaek', employeeId: 'writer' }).firestore();
    try {
      await expect(applyPurchaseOrderBatch(scope, r, store as unknown as Firestore)).rejects.toThrow();
      for (const o of r.orders) expect((await getDocFromServer(doc(store, 'purchaseOrders', o.id))).exists()).toBe(false);
      expect((await getDocFromServer(doc(store, 'purchaseOrderBatchAudits', r.operationId))).exists()).toBe(false);
    } finally { await fault.cleanup(); }
  });
});
