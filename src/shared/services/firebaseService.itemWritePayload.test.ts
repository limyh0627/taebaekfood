import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  writes: [] as { kind: string; ref: string; data: any; options?: any }[],
  claim: 'taebaek' as string | undefined,docs:new Map<string,any>(), reads:[] as string[],transactions:0,
}));
vi.mock('../firebase', () => ({ db: {}, authReady: Promise.resolve(), functions: undefined,
  auth: { currentUser: { getIdTokenResult: async () => ({ claims: { companyId: state.claim } }) } } }));
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  doc: (_db: any, collection?: any, id?: string) => ({path:collection===undefined?`${_db}/generated`:typeof collection==='string'?`${collection}/${id??'generated'}`:`${collection.path}/generated`,id:id??'generated'}),
  collection: (_db: unknown, collection: string) => collection,
  runTransaction:async (_db:unknown,fn:any)=>{state.transactions++;let wrote=false;return fn({get:async(ref:any)=>{if(wrote)throw Error('write 이후 read');state.reads.push(ref.path);return {exists:()=>state.docs.has(ref.path),data:()=>structuredClone(state.docs.get(ref.path)),id:ref.id};},set:(ref:any,data:any,options:any)=>{wrote=true;state.writes.push({kind:'set',ref:ref.path,data,options});state.docs.set(ref.path,options?.merge?{...state.docs.get(ref.path),...data}:data);},update:(ref:any,data:any)=>{wrote=true;state.writes.push({kind:'update',ref:ref.path,data});state.docs.set(ref.path,{...state.docs.get(ref.path),...data});},delete:(ref:any)=>{wrote=true;state.writes.push({kind:'delete',ref:ref.path,data:undefined});state.docs.delete(ref.path);}});},
  setDoc: async (ref: string, data: any, options?: any) => { state.writes.push({ kind: 'set', ref, data, options }); },
  updateDoc: async (ref: string, data: any) => { state.writes.push({ kind: 'update', ref, data }); },
  addDoc: async (ref: string, data: any) => { state.writes.push({ kind: 'add', ref, data }); return { id: 'generated' }; },
  writeBatch: () => ({ set: (ref: string, data: any, options?: any) => { state.writes.push({ kind: 'batch', ref, data, options }); }, commit: async () => {} }),
}));
import { addItem, updateItem, setDocument, commitCompanyWrites,prepareCompanyWriteOperations } from './firebaseService';
beforeEach(() => { state.writes = []; state.reads=[];state.transactions=0; state.claim = 'taebaek'; state.docs.clear();state.docs.set('items/item',{companyId:'taebaek'}); });
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

it('품목·박스규격·BOM을 한 거래로 읽고 같은 품목 수정은 합쳐 사진과 재고를 보존한다',async()=>{
 state.docs.set('items/item',{companyId:'taebaek',name:'원래',type:'product',stock:3,lots:[{id:'lot',quantity:3}],imageUrl:'기존사진',inventoryWriterProtocolVersion:1,inventoryWriteRevision:9});
 state.docs.set('item_bom/old',{companyId:'taebaek',parent_id:'item',child_id:'old',quantity:1});
 await commitCompanyWrites([
  {kind:'update',collection:'items',id:'item',data:{name:'수정',cost:0}},
  {kind:'update',collection:'items',id:'item',data:{spec:'1kg * 12'}},
  {kind:'delete',collection:'item_bom',id:'old'},
  {kind:'set',collection:'item_bom',id:'new',data:{parent_id:'item',child_id:'child',quantity:12}},
 ]);
 expect(state.transactions).toBe(1);expect(state.writes).toHaveLength(3);
 expect(state.reads).toEqual(['items/item','item_bom/old','item_bom/new']);
 expect(state.writes[0]).toMatchObject({kind:'update',ref:'items/item',data:{name:'수정',spec:'1kg * 12',cost:0,inventoryWriteRevision:9}});
 expect(state.docs.get('items/item')).toMatchObject({imageUrl:'기존사진',stock:3,lots:[{id:'lot',quantity:3}]});
});
it('사라진 수정 대상·타회사·품목 사본의 옛 재고는 모든 연결 쓰기를 시작하기 전에 거절한다',async()=>{
 for(const mode of ['missing','foreign','stock'] as const){
  state.writes=[];state.reads=[];state.docs.set('items/item',{companyId:mode==='foreign'?'punghoe':'taebaek',stock:4});if(mode==='missing')state.docs.delete('items/item');
  await expect(commitCompanyWrites([{kind:'set',collection:'item_bom',id:'first',data:{parent_id:'item'}},{kind:'update',collection:'items',id:'item',data:mode==='stock'?{name:'수정',stock:1}:{name:'수정'}}])).rejects.toThrow();
  expect(state.writes).toEqual([]);expect(state.docs.has('item_bom/first')).toBe(false);
 }
});
it('같은 단건 정본으로 SMARTSTORE 표식만 정리하고 거래처 배열을 입력에 섞지 않는다',async()=>{
 const {arrayRemove}=await import('firebase/firestore');
 const original={companyId:'taebaek',type:'product',partnerIds:['SMARTSTORE','다른거래처'],stock:2,inventoryWriterProtocolVersion:1,inventoryWriteRevision:4};
 state.docs.set('items/item',original);
 await updateItem('items','item',{isSmartStore:false},{reconcileSmartStoreMarker:true});
 const single=state.writes[0].data;state.writes=[];state.docs.set('items/item',original);
 await commitCompanyWrites([{kind:'update',collection:'items',id:'item',data:{isSmartStore:false},options:{reconcileSmartStoreMarker:true}}]);
 expect(state.writes[0].data).toEqual(single);expect(state.writes[0].data.partnerIds).toEqual(arrayRemove('SMARTSTORE'));expect(state.writes[0].data.inventoryWriteRevision).toBe(4);
 state.writes=[];await expect(commitCompanyWrites([{kind:'update',collection:'items',id:'item',data:{isSmartStore:false,partnerIds:[]},options:{reconcileSmartStoreMarker:true}}])).rejects.toThrow('거래처');expect(state.writes).toEqual([]);
});
it('거래 한도 초과는 읽기·쓰기 전에 거절하며 서로 다른 저장 종류 중복도 추정하지 않는다',async()=>{
 await expect(commitCompanyWrites(Array.from({length:501},(_,i)=>({kind:'set' as const,collection:'items' as const,id:'item-'+i,data:{cost:0}})))).rejects.toThrow('한도');expect(state.reads).toEqual([]);expect(state.transactions).toBe(0);
 await expect(commitCompanyWrites([{kind:'update',collection:'items',id:'item',data:{name:'수정'}},{kind:'set',collection:'items',id:'item',data:{spec:'규격'},merge:true}])).rejects.toThrow('종류');expect(state.writes).toEqual([]);
});
it('같은 품목 중복 update는 실제 재고 효과가 있어도 revision을 한 번만 올린다',async()=>{
 state.docs.set('items/item',{companyId:'taebaek',stock:1,inventoryWriterProtocolVersion:1,inventoryWriteRevision:4});
 await commitCompanyWrites([{kind:'update',collection:'items',id:'item',data:{stock:2}},{kind:'update',collection:'items',id:'item',data:{cost:3}}]);
 expect(state.writes).toHaveLength(1);expect(state.writes[0].kind).toBe('update');expect(state.writes[0].data).toMatchObject({stock:2,cost:3,inventoryWriteRevision:5});
});
it('새 품목 set 뒤 규격 update와 BOM delete 뒤 대체 set은 최종 한 번만 저장한다',async()=>{
 state.docs.set('item_bom/bom',{companyId:'taebaek',old:true});
 await commitCompanyWrites([{kind:'set',collection:'items',id:'new-item',data:{name:'신규',stock:0}},{kind:'update',collection:'items',id:'new-item',data:{spec:'12개입'}},{kind:'delete',collection:'item_bom',id:'bom'},{kind:'set',collection:'item_bom',id:'bom',data:{parent_id:'new-item',child_id:'child',quantity:12}}]);
 expect(state.writes).toHaveLength(2);expect(state.docs.get('items/new-item')).toMatchObject({name:'신규',spec:'12개입',inventoryWriteRevision:1});expect(state.docs.get('item_bom/bom')).not.toHaveProperty('old');
});
it('화면 preflight는 writer와 같은 순수 정본으로 정규화하고 한도 오류를 전송 전에 돌려준다',()=>{
 const input=[{kind:'update' as const,collection:'items' as const,id:'item',data:{name:'수정'}},{kind:'update' as const,collection:'items' as const,id:'item',data:{spec:'규격'}}];
 expect(prepareCompanyWriteOperations(input)).toEqual([{...input[0],data:{name:'수정',spec:'규격'},options:undefined}]);
 expect(()=>prepareCompanyWriteOperations(Array.from({length:501},(_,i)=>({kind:'delete',collection:'items',id:'item-'+i})))).toThrow('한도');
 expect(state.transactions).toBe(0);expect(state.writes).toEqual([]);expect(input[0].data).toEqual({name:'수정'});
});
