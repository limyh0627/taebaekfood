import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  writes: [] as { kind: string; ref: string; data: any; options?: any }[],
  claim: 'taebaek' as string | undefined,docs:new Map<string,any>(),
}));
vi.mock('../firebase', () => ({ db: {}, authReady: Promise.resolve(), functions: undefined,
  auth: { currentUser: { getIdTokenResult: async () => ({ claims: { companyId: state.claim } }) } } }));
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  doc: (_db: any, collection?: any, id?: string) => ({path:collection===undefined?`${_db}/generated`:typeof collection==='string'?`${collection}/${id??'generated'}`:`${collection.path}/generated`,id:id??'generated'}),
  collection: (_db: unknown, collection: string) => collection,
  runTransaction:async (_db:unknown,fn:any)=>fn({get:async(ref:any)=>({exists:()=>state.docs.has(ref.path),data:()=>structuredClone(state.docs.get(ref.path)),id:ref.id}),set:(ref:any,data:any,options:any)=>{state.writes.push({kind:'set',ref:ref.path,data,options});state.docs.set(ref.path,options?.merge?{...state.docs.get(ref.path),...data}:data);},update:(ref:any,data:any)=>{state.writes.push({kind:'update',ref:ref.path,data});state.docs.set(ref.path,{...state.docs.get(ref.path),...data});},delete:(ref:any)=>{state.writes.push({kind:'delete',ref:ref.path,data:undefined});state.docs.delete(ref.path);}}),
  setDoc: async (ref: string, data: any, options?: any) => { state.writes.push({ kind: 'set', ref, data, options }); },
  updateDoc: async (ref: string, data: any) => { state.writes.push({ kind: 'update', ref, data }); },
  addDoc: async (ref: string, data: any) => { state.writes.push({ kind: 'add', ref, data }); return { id: 'generated' }; },
  writeBatch: () => ({ set: (ref: string, data: any, options?: any) => { state.writes.push({ kind: 'batch', ref, data, options }); }, commit: async () => {} }),
}));
import { addItem, updateItem, setDocument, commitCompanyWrites } from './firebaseService';
beforeEach(() => { state.writes = []; state.claim = 'taebaek'; state.docs.clear();state.docs.set('items/item',{companyId:'taebaek'}); });
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
  expect(state.writes[0].data).toEqual({ cost: 0, stock: 4, nested: { price: 7 }, companyId: 'taebaek',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1 });
  expect(original).toHaveProperty('price', 9000);
  expect(original.nested).toHaveProperty('absent');
});
it.each(writers)('%s 실제 소비자는 가격을 원가로 추정하지 않는다', async (_name, write) => {
  await write('items', { price: 5, stock: 0 });
  expect(state.writes[0].data).toEqual({ stock: 0, companyId: 'taebaek',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1 });
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
  expect(state.writes[0].data).toEqual({ cost: 9, companyId: 'taebaek',inventoryWriterProtocolVersion:1,inventoryWriteRevision:1 });
});

it('낡은 전체 품목 사본은 새 revision으로 재고를 덮지 않는다',async()=>{state.docs.set('items/item',{companyId:'taebaek',name:'현재',stock:5,lots:[],inventoryWriterProtocolVersion:1,inventoryWriteRevision:4});await expect(updateItem('items','item',{name:'변경',stock:3,lots:[]})).rejects.toThrow('사본');expect(state.writes).toEqual([]);});
it('일반 원가 metadata는 기존 fence와 stock을 보존한다',async()=>{state.docs.set('items/item',{companyId:'taebaek',stock:5,inventoryWriterProtocolVersion:1,inventoryWriteRevision:4});await updateItem('items','item',{cost:0});expect(state.docs.get('items/item')).toMatchObject({stock:5,cost:0,inventoryWriteRevision:4});});
it('삭제와 연결문서는 함께 지우고 재생성은 영구 삭제 floor를 넘는다',async()=>{state.docs.set('items/item',{companyId:'taebaek',stock:5,inventoryWriterProtocolVersion:1,inventoryWriteRevision:4});state.docs.set('partner_item/link',{companyId:'taebaek'});await commitCompanyWrites([{kind:'delete',collection:'items',id:'item'},{kind:'delete',collection:'partner_item',id:'link'}]);expect(state.docs.has('items/item')).toBe(false);expect(state.docs.has('partner_item/link')).toBe(false);expect(state.docs.get('inventoryWriterDeletions/taebaek__item')).toMatchObject({deletionRevision:1,beforeRevision:4,lastDeletedItemRevision:4});await addItem('items',{id:'item',name:'재생성',stock:0});expect(state.docs.get('items/item')).toMatchObject({inventoryWriterProtocolVersion:1,inventoryWriteRevision:5});await commitCompanyWrites([{kind:'delete',collection:'items',id:'item'}]);expect(state.docs.get('inventoryWriterDeletions/taebaek__item')).toMatchObject({deletionRevision:2,beforeRevision:5});});
it('주문 일반 저장은 서버 retirement 표시를 보존하고 변조를 거절한다',async()=>{state.docs.set('orders/order',{companyId:'taebaek',retirementId:'receipt',retirementClaimPending:true,inventoryWriterProtocolVersion:1,inventoryWriteRevision:3});await setDocument('orders','order',{memo:'수정'});expect(state.docs.get('orders/order')).toMatchObject({retirementId:'receipt',retirementClaimPending:true,inventoryWriteRevision:3});state.writes=[];await expect(updateItem('orders','order',{retirementClaimPending:false})).rejects.toThrow('서버');expect(state.writes).toEqual([]);});
it.each(writers)('%s 폐기 필드는 해당 컬렉션에서만 제외하며 기존 문서를 삭제하지 않는다', async (_name, write) => {
  const original = Object.freeze({ lotsAreTotal: true, 'lotsAreTotal.old': true, inUse: 7, 'inUse.old': 8, nested: { lotsAreTotal: true, inUse: 9 }, lotsAreTotals: 3, inUser: 4 });
  await write('items', original);
  expect(state.writes[0].data).not.toHaveProperty('lotsAreTotal');
  expect(Object.keys(state.writes[0].data)).not.toContain('lotsAreTotal.old');
  expect(state.writes[0].data).toMatchObject({ inUse: 7, 'inUse.old': 8, nested: original.nested, lotsAreTotals: 3, inUser: 4 });
  state.writes=[];
  await write('pallets', original);
  expect(state.writes[0].data).not.toHaveProperty('inUse');
  expect(Object.keys(state.writes[0].data)).not.toContain('inUse.old');
  expect(state.writes[0].data).toMatchObject({ lotsAreTotal: true, 'lotsAreTotal.old': true, nested: original.nested });
  state.writes=[];
  await write('partners', original);
  expect(state.writes[0].data).toMatchObject(original);
  expect(original.inUse).toBe(7); expect(original.lotsAreTotal).toBe(true);
});
it('서비스 전처리는 공식 SDK 값만 보존하고 임의 클래스·일반 객체의 기존 처리를 유지한다', async () => {
  const { Timestamp, GeoPoint, Bytes, arrayUnion, vector } = await import('firebase/firestore');
  class Custom { keep = 1; absent = undefined; }
  const timestamp = new Timestamp(123, 456789123), point = new GeoPoint(37, 127), bytes = Bytes.fromBase64String('AQID');
  const date = new Date(123), sentinel = arrayUnion('값'), embedding = vector([1, 2]);
  const original = { timestamp, point, bytes, date, sentinel, embedding, nested: { timestamp, absent: undefined }, values: [point], custom: new Custom(), nullPrototype: Object.assign(Object.create(null), { keep: 2, absent: undefined }) };
  await updateItem('pallets', 'item', original);
  const saved = state.writes[0].data;
  for (const key of ['timestamp', 'point', 'bytes', 'date', 'sentinel', 'embedding'] as const) expect(saved[key]).toBe(original[key]);
  expect(saved.nested.timestamp).toBe(timestamp); expect(saved.values[0]).toBe(point);
  expect(saved.nested).not.toHaveProperty('absent'); expect(original.nested).toHaveProperty('absent');
  expect(saved.custom).toEqual({ keep: 1 }); expect(saved.custom).not.toBeInstanceOf(Custom);
  expect(saved.nullPrototype).toEqual({ keep: 2 }); expect(original.nullPrototype).toHaveProperty('absent');
});
