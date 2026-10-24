import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ docs: new Map<string, any>(), writes: [] as string[], transactions: 0 }));
vi.mock('../firebase', () => ({ db: {}, authReady: Promise.resolve(), functions: {}, auth: { currentUser: { uid: 'actor', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', employeeId: 'employee' } }) } } }));
vi.mock('firebase/firestore', async original => ({ ...await original<typeof import('firebase/firestore')>(),
  doc: (_: unknown, col: string, id: string) => ({ path: col + '/' + id, id }),
  runTransaction: async (_: unknown, fn: any) => {
    m.transactions++; const queued: any[] = [];
    const result = await fn({ get: async (ref: any) => { expect(queued).toHaveLength(0); return { exists: () => m.docs.has(ref.path), data: () => structuredClone(m.docs.get(ref.path)) }; },
      set: (ref: any, data: any) => queued.push([ref.path, data]) });
    for (const [path, data] of queued) { m.docs.set(path, data); m.writes.push(path); } return result;
  },
}));
import { writeMany, prepareCompanyWriteOperations } from './firebaseService';
const operations = () => [{ collection: 'items' as const, id: 'box', createOnly: true as const, data: { name: '박스', stock: 0, lots: [], cost: 0, price: 9000 } },
  { collection: 'item_bom' as const, id: 'bom', createOnly: true as const, data: { parent_id: 'box', child_id: 'unit', quantity: 10 } }];
beforeEach(() => { m.docs.clear(); m.writes = []; m.transactions = 0; });
it.each(['items/box', 'item_bom/bom'])('create-only %s 존재는 다른 문서까지 쓰지 않고 기존 값을 보존한다', async path => {
  const original = { companyId: 'taebaek', name: '박스', stock: 0, lots: [], hidden: 7, parent_id: 'box', child_id: 'unit', quantity: 9 };
  m.docs.set(path, original);
  await expect(writeMany(operations())).rejects.toThrow('이미');
  expect(m.docs.get(path)).toEqual(original); expect(m.writes).toEqual([]);
});
it('박스와 BOM은 한 TX에서 원가0·수량·claim과 revision 정본을 보존한다', async () => {
  const original = operations(); await writeMany(original);
  expect(m.transactions).toBe(1); expect(m.writes).toEqual(['items/box', 'item_bom/bom']);
  expect(m.docs.get('items/box')).toEqual({ companyId: 'taebaek', name: '박스', stock: 0, lots: [], cost: 0, inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 1 });
  expect(m.docs.get('item_bom/bom')).toEqual({ companyId: 'taebaek', parent_id: 'box', child_id: 'unit', quantity: 10 });
  expect(original[0].data).toHaveProperty('price', 9000);
});
it('기존 createOnly 없는 writer는 기존 문서를 수정하는 호환을 유지한다', async () => {
  m.docs.set('items/box', { companyId: 'taebaek', name: '이전', stock: 0, lots: [], inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 3 });
  const [first] = operations(); const { createOnly: _flag, ...legacy } = first;
  await writeMany([legacy]); expect(m.docs.get('items/box').name).toBe('박스');
  expect(m.docs.get('items/box').inventoryWriteRevision).toBe(3);
});
it('같은 문서의 중복 create와 한 거래 한도 초과는 쓰기 전에 거절한다', () => {
  const [first] = operations(); expect(() => prepareCompanyWriteOperations([{ kind: 'set', ...first }, { kind: 'set', ...first }])).toThrow('같은 문서');
  expect(() => prepareCompanyWriteOperations(Array.from({ length: 501 }, (_, index) => ({ kind: 'set', ...first, id: 'box-' + index })))).toThrow('한도');
});
it('새 caller current 옵션이 false면 claim이나 TX를 기다리기 전 쓰기를 막는다', async () => {
  await expect(writeMany(operations(), { isCurrent: () => false })).rejects.toThrow('작성창'); expect(m.transactions).toBe(0); expect(m.writes).toEqual([]);
});
