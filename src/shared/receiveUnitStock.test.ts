import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ docs: new Map<string, any>(), fail: false }));
vi.mock('./firebase', () => ({ db: {}, authReady: Promise.resolve(), auth: { currentUser: {
  getIdTokenResult: async () => ({ claims: { companyId: 'taebaek' } }),
} } }));
vi.mock('firebase/firestore', () => ({
 collection: vi.fn(), onSnapshot: vi.fn(), addDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), setDoc: vi.fn(),
 query: vi.fn(), where: vi.fn(), getDocs: vi.fn(), writeBatch: vi.fn(), documentId: vi.fn(), arrayUnion: vi.fn(),
 doc: (_: any, col: string, id: string) => `${col}/${id}`,
 runTransaction: async (_: any, fn: any) => {
  const pending = new Map<string, any>();
  const out = await fn({
   get: async (key: string) => ({ exists: () => state.docs.has(key), data: () => state.docs.get(key) }),
   update: (key: string, patch: any) => pending.set(key, { ...state.docs.get(key), ...patch }),
   set: (key: string, data: any) => { if (state.fail) throw new Error('저장 실패'); pending.set(key, data); },
  });
  pending.forEach((v,k) => state.docs.set(k,v)); return out;
 },
}));
const { receiveUnitStock } = await import('./services/firebaseService');
const receipt = { id:'r1',itemId:'can',itemName:'깨분참기름-캔',quantity:31,partnerName:'풍회유통',date:'2026-09-28',createdAt:'2026-09-28T01:19:07.961Z',companyId:'taebaek' as const,poId:'po1' };
beforeEach(() => { state.docs.clear(); state.fail = false; state.docs.set('items/can', {
 name:receipt.itemName,type:'wip',subtype:'캔',unit:'개',spec:'16.5kg',companyId:'taebaek',stock:0,lots:[],
}); });
it('31캔/511.5kg와 입고기록이 함께 저장되고 같은 입고는 중복하지 않는다', async () => {
 expect(await receiveUnitStock(receipt)).toBe(true);
 expect(await receiveUnitStock(receipt)).toBe(false);
 expect(state.docs.get('items/can')).toMatchObject({stock:31,lots:[{qtyIn:31,qtyRemaining:31,kgRemaining:511.5,poId:'po1'}]});
 expect(state.docs.get('itemReceipts/r1')).toMatchObject({quantity:31});
});
it('입고기록 쓰기 실패는 재고와 로트도 남기지 않는다', async () => {
 state.fail=true;
 await expect(receiveUnitStock(receipt)).rejects.toThrow('저장 실패');
 expect(state.docs.get('items/can')).toMatchObject({stock:0,lots:[]});
});
it.each(['개','kg','L'])('상품 %s 입고는 자기 수량과 기존 공용 중량을 각각 보존한다',async unit=>{
 state.docs.set('items/can',{name:'참깨',type:'goods',unit,spec:'20kg',companyId:'taebaek',stock:0,lots:[]});
 expect(await receiveUnitStock(receipt)).toBe(true);const before=JSON.stringify([...state.docs]);
 const unitKg=unit==='kg'?1:unit==='L'?0:20;
 expect(state.docs.get('items/can')).toMatchObject({stock:31,lots:[{qtyIn:31,qtyRemaining:31,unitKg,kgRemaining:31*unitKg}]});
 expect(await receiveUnitStock(receipt)).toBe(false);expect(JSON.stringify([...state.docs])).toBe(before);
});
it('부자재와 명시 원료 별칭은 단독 수량 로트 입고 대상이 아니다',async()=>{
 for(const item of [{type:'submaterial',unit:'개'},{type:'goods',unit:'포',rawMaterialName:'참깨'}]){
  state.docs.set('items/can',{name:'참깨',companyId:'taebaek',stock:0,lots:[],...item});const before=JSON.stringify([...state.docs]);
  await expect(receiveUnitStock(receipt)).rejects.toThrow('분류');expect(JSON.stringify([...state.docs])).toBe(before);
 }
});
it('상품의 기존 재고·로트 차이는 새 입고로 자동 보충하지 않는다',async()=>{
 state.docs.set('items/can',{name:'상품',type:'goods',unit:'개',companyId:'taebaek',stock:10,lots:[{id:'known',qtyIn:3,qtyRemaining:3,kgRemaining:0,status:'active'}]});
 const before=JSON.stringify([...state.docs]);await expect(receiveUnitStock(receipt)).rejects.toThrow('로트 잔량');expect(JSON.stringify([...state.docs])).toBe(before);
});
it('L 상품은 등록 밀도만 새 로트 중량에 쓰고 수량은 그대로다',async()=>{
 state.docs.set('items/can',{name:'상품',type:'goods',unit:'L',spec:'20kg',density:0.9,companyId:'taebaek',stock:0,lots:[]});
 expect(await receiveUnitStock(receipt)).toBe(true);expect(state.docs.get('items/can')).toMatchObject({stock:31,lots:[{qtyIn:31,qtyRemaining:31,unitKg:0.9,kgRemaining:27.9}]});
});
it('다른 회사는 쓰기 전에 거절한다', async () => {
 state.docs.get('items/can').companyId='punghoe';
 await expect(receiveUnitStock(receipt)).rejects.toThrow('회사');
 expect(state.docs.has('itemReceipts/r1')).toBe(false);
});
it('기존 소진 로트는 보존하고 신규31캔을 별도로 추가한다', async () => {
 state.docs.get('items/can').lots=[{id:'old',status:'depleted',qtyRemaining:0,kgRemaining:0}];
 await receiveUnitStock(receipt);
 expect(state.docs.get('items/can').lots).toHaveLength(2);
});
it('기존 로트 불일치를 새입고로 덮어쓰지 않는다', async () => {
 Object.assign(state.docs.get('items/can'),{stock:5,lots:[{id:'old',qtyRemaining:0}]});
 await expect(receiveUnitStock(receipt)).rejects.toThrow('잔량');
 expect(state.docs.get('items/can').stock).toBe(5);
});
