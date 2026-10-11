import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  writes: [] as { kind: string; ref: string; data: any; options?: any }[],
  claim: 'taebaek' as string | undefined,
}));
vi.mock('../firebase', () => ({ db: {}, authReady: Promise.resolve(), functions: undefined,
  auth: { currentUser: { getIdTokenResult: async () => ({ claims: { companyId: state.claim } }) } } }));
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  collection: (_db: unknown, collection: string) => collection,
  setDoc: async (ref: string, data: any, options?: any) => { state.writes.push({ kind: 'set', ref, data, options }); },
  updateDoc: async (ref: string, data: any) => { state.writes.push({ kind: 'update', ref, data }); },
  addDoc: async (ref: string, data: any) => { state.writes.push({ kind: 'add', ref, data }); return { id: 'generated' }; },
  writeBatch: () => ({ set: (ref: string, data: any, options?: any) => { state.writes.push({ kind: 'batch', ref, data, options }); }, commit: async () => {} }),
}));
import { addItem, updateItem, setDocument, commitCompanyWrites } from './firebaseService';
beforeEach(() => { state.writes = []; state.claim = 'taebaek'; });
const writers = [
  ['생성', (collection: any, data: any) => addItem(collection, { id: 'item', ...data })],
  ['수정', (collection: any, data: any) => updateItem(collection, 'item', data)],
  ['병합', (collection: any, data: any) => setDocument(collection, 'item', data)],
  ['배치', (collection: any, data: any) => commitCompanyWrites([{ kind: 'set', collection, id: 'item', data }])],
] as const;
it.each(writers)('%s 실제 소비자는 가격을 재전송하지 않고 원가0·회사·중첩 거래값을 보존한다', async (_name, write) => {
  const original = { price: 9000, cost: 0, stock: 4, nested: { price: 7, absent: undefined }, absent: undefined };
  await write('items', original);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].data).toEqual({ cost: 0, stock: 4, nested: { price: 7 }, companyId: 'taebaek' });
  expect(original).toHaveProperty('price', 9000);
  expect(original.nested).toHaveProperty('absent');
});
it.each(writers)('%s 실제 소비자는 가격을 원가로 추정하지 않는다', async (_name, write) => {
  await write('items', { price: 5, stock: 0 });
  expect(state.writes[0].data).toEqual({ stock: 0, companyId: 'taebaek' });
});
it.each(writers)('%s 거래처 거래 단가는 그대로 저장한다', async (_name, write) => {
  await write('partner_item', { price: 7 });
  expect(state.writes[0].data).toEqual({ price: 7, companyId: 'taebaek' });
});
it.each(writers)('%s 품목 dotted 가격도 재유입 없이 원문과 다른 필드를 보존한다', async (_name, write) => {
  const original = Object.freeze({ 'price.foo': 7, 'price.foo.bar': 8, cost: 0, 'nested.price': 6, prices: 9 });
  await write('items', original);
  expect(state.writes[0].data).toEqual({ cost: 0, 'nested.price': 6, prices: 9, companyId: 'taebaek' });
  expect(original['price.foo']).toBe(7);
});
it.each(writers)('%s 거래 컬렉션 dotted 가격은 변경하지 않는다', async (_name, write) => {
  await write('partner_item', { 'price.foo': 7 });
  expect(state.writes[0].data).toEqual({ 'price.foo': 7, companyId: 'taebaek' });
});
it.each(writers)('%s 회사가 다른 입력은 기존 claim 경계에서 쓰기 전에 거절한다', async (_name, write) => {
  await expect(write('items', { price: 7, companyId: 'punghoe' })).rejects.toThrow('다른 회사');
  expect(state.writes).toEqual([]);
});
it.each(writers)('%s 회사 claim이 없으면 쓰지 않는다', async (_name, write) => {
  state.claim = undefined;
  await expect(write('items', { price: 7 })).rejects.toThrow('회사 정보');
  expect(state.writes).toEqual([]);
});
it('자동 ID 생성도 같은 품목 payload를 쓴다', async () => {
  expect(await addItem('items', { price: 7, cost: 9 })).toBe('generated');
  expect(state.writes[0].data).toEqual({ cost: 9, companyId: 'taebaek' });
});
