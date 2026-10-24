/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, setDoc, deleteDoc, Timestamp, type Firestore } from 'firebase/firestore';
const m = vi.hoisted(() => ({ db: undefined as any, company: 'taebaek' }));
const user = { uid: 'box-writer', getIdTokenResult: async () => ({ claims: { companyId: m.company, employeeId: 'box-writer', isAdmin: false } }) };
vi.mock('../firebase', () => ({ get db() { return m.db; }, authReady: Promise.resolve(), functions: {}, auth: { get currentUser() { return user; } } }));
import { writeMany } from './firebaseService';

describe.skipIf(process.env.BOX_CREATE_SDK !== 'true')('박스 생성 실 Firestore SDK·현 Rules', () => {
  let env: RulesTestEnvironment;
  const projectId = 'demo-box-' + randomUUID().slice(0, 12), paths = new Set<string>();
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8182, rules: readFileSync('firestore.rules', 'utf8') } });
    m.db = env.authenticatedContext(user.uid, { companyId: 'taebaek', employeeId: 'box-writer', isAdmin: false }).firestore();
    await seed('catalogItemMergeState/taebaek', { companyId: 'taebaek', revision: 1 });
  }, 30000);
  afterAll(async () => {
    if (!env) return;
    await env.withSecurityRulesDisabled(async c => { for (const path of paths) await deleteDoc(doc(c.firestore(), path));
      for (const path of paths) expect((await getDocFromServer(doc(c.firestore(), path))).exists()).toBe(false); });
    writeFileSync('work/post-purchase-A-box-sdk-cleanup.json', JSON.stringify({ projectId, fixturesRemoved: paths.size, absentVerified: true, globalFlush: false, firestoreSdkReal: true, authClaimsSynthetic: true }, null, 2));
    await env.cleanup();
  }, 30000);
  async function seed(path: string, value: any) { paths.add(path); await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), path), value)); }
  const get = async (path: string) => (await getDocFromServer(doc(m.db, path))).data();
  async function fixture() {
    const suffix = randomUUID(), boxId = 'box-' + suffix, unitId = 'unit-' + suffix, labelId = 'label-' + suffix;
    await seed('items/' + unitId, { companyId: 'taebaek', name: '낱개', type: 'product', stock: 7, lots: [], cost: 700 });
    await seed('items/' + labelId, { companyId: 'taebaek', name: '라벨', type: 'submaterial', stock: 9, lots: [] });
    const ops = [{ collection: 'items' as const, id: boxId, createOnly: true as const, data: { companyId: 'taebaek', name: '낱개 (10개입)', type: 'product', stock: 0, lots: [], cost: 0, minStock: 0, price: 9900, unit: '박스' } },
      ...[unitId, labelId].map((id, index) => ({ collection: 'item_bom' as const, id: 'bom-' + boxId + '__' + id, createOnly: true as const, data: { parent_id: boxId, child_id: id, quantity: index === 0 ? 10 : 1 } }))];
    ops.forEach(op => paths.add(op.collection + '/' + op.id)); return { boxId, unitId, labelId, ops };
  }
  it('회사 직원의 박스와 모든 BOM은 epoch 활성 현 Rules getAfter 한 거래로 생성한다', async () => {
    const f = await fixture(); await writeMany(f.ops, { isCurrent: () => true });
    const box = await get('items/' + f.boxId); expect(box).toMatchObject({ stock: 0, lots: [], cost: 0, unit: '박스', inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 1 });
    expect(box).not.toHaveProperty('price');
    for (const op of f.ops.slice(1)) expect(await get(op.collection + '/' + op.id)).toMatchObject({ companyId: 'taebaek', ...op.data });
    expect((await get('items/' + f.unitId))?.stock).toBe(7);
  });
  it('마지막 BOM child가 없으면 Rules 거절로 박스와 앞 BOM도 남기지 않는다', async () => {
    const f = await fixture(); f.ops[2].data = { ...f.ops[2].data, child_id: 'missing-' + randomUUID() } as typeof f.ops[2]['data'];
    await expect(writeMany(f.ops)).rejects.toThrow();
    for (const op of f.ops) expect(await get(op.collection + '/' + op.id)).toBeUndefined();
  });
  it('이미 존재하는 박스는 stock lots Timestamp 숨은 필드와 버전을 전부 보존한다', async () => {
    const f = await fixture(), original = { companyId: 'taebaek', name: '원래 박스', stock: 7, lots: [{ qty: 7, unitCost: 900 }], hidden: { keep: 3 }, createdAt: Timestamp.fromMillis(123456), inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 5 };
    await seed('items/' + f.boxId, original);
    await expect(writeMany(f.ops)).rejects.toThrow('이미'); expect(await get('items/' + f.boxId)).toEqual(original);
    expect(await get('item_bom/' + f.ops[1].id)).toBeUndefined();
  });
  it('기존 BOM만 있어도 덮지 않고 새 박스 생성 전체를 거절한다', async () => {
    const f = await fixture(), path = 'item_bom/' + f.ops[1].id, original = { companyId: 'taebaek', parent_id: f.boxId, child_id: f.unitId, quantity: 99, keep: true };
    await seed(path, original); await expect(writeMany(f.ops)).rejects.toThrow('이미'); expect(await get(path)).toEqual(original);
    expect(await get('items/' + f.boxId)).toBeUndefined(); expect(await get('item_bom/' + f.ops[2].id)).toBeUndefined();
  });
  it('다른 회사 실제 Rules 인증은 박스와 BOM을 만들지 못한다', async () => {
    const f = await fixture(), previous = m.db;
    m.db = env.authenticatedContext('foreign', { companyId: 'punghoe', employeeId: 'foreign' }).firestore();
    try { await expect(writeMany(f.ops)).rejects.toThrow(); } finally { m.db = previous; }
    for (const op of f.ops) expect(await get(op.collection + '/' + op.id)).toBeUndefined();
  });
  it('동시 같은 ID 생성은 한 명만 성공하고 BOM을 추가로 덮지 않는다', async () => {
    const f = await fixture(), results = await Promise.allSettled([writeMany(f.ops), writeMany(f.ops)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect((await get('items/' + f.boxId))?.inventoryWriteRevision).toBe(1);
    expect((await get('item_bom/' + f.ops[1].id))?.quantity).toBe(10);
  });
  it('기존 tombstone의 삭제 버전 바닥을 재사용한다', async () => {
    const f = await fixture(); await seed('inventoryWriterDeletions/taebaek__' + f.boxId, { companyId: 'taebaek', itemId: f.boxId, inventoryWriterProtocolVersion: 1, deletionRevision: 1, beforeRevision: 3, lastDeletedItemRevision: 3, deletedAt: '2026-10-24T00:00:00Z' });
    await writeMany(f.ops); expect((await get('items/' + f.boxId))?.inventoryWriteRevision).toBe(4);
  });
});
