import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { Item } from '../types';
import { buildBomIndex, getBomIndex, setBomIndex } from '../bomIndex';
import { buildPackIndex } from '../packIndex';
const state = vi.hoisted(() => ({ docs: new Map<string, any>(), gate: undefined as Promise<void> | undefined, waiting: false, queries: [] as string[] }));
const raw = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../firebase', () => ({ db: {}, authReady: Promise.resolve(), auth: { currentUser: { getIdTokenResult: async () => ({ claims: { companyId: 'taebaek' } }) } } }));
vi.mock('./rawInventoryService', () => ({ readRawCommandInTransaction: raw.read, prepareRawCommand: vi.fn(), writePreparedRawCommand: vi.fn() }));
vi.mock('firebase/firestore', async original => ({ ...await original<typeof import('firebase/firestore')>(),
  doc: (_: unknown, col: string, id: string) => ({ path: `${col}/${id}`, id }),
  collection: (_: unknown, col: string) => col, query: (col: string) => col, where: vi.fn(),
  getDoc: async (ref: { path: string }) => ({ exists: () => state.docs.has(ref.path), data: () => state.docs.get(ref.path) }),
  getDocs: async (col: string) => { state.queries.push(col); return { empty: true, docs: [] }; },
  runTransaction: async (_: unknown, fn: any) => {
    const pending = new Map<string, unknown>();
    const result = await fn({
      get: async (ref: { path: string }) => {
        if (ref.path === 'items/box' && state.gate) { state.waiting = true; await state.gate; }
        return { exists: () => state.docs.has(ref.path), data: () => state.docs.get(ref.path) };
      },
      update: (ref: { path: string }, data: any) => pending.set(ref.path, { ...state.docs.get(ref.path), ...data }),
      set: (ref: { path: string }, data: unknown) => pending.set(ref.path, data),
    });
    pending.forEach((value, key) => state.docs.set(key, value)); return result;
  },
}));
const { confirmUnitPurchaseOrderReceiptWithDb } = await import('./firebaseService');
const items = [
  { id: 'box', companyId: 'taebaek', name: '볶음참깨 포장', type: 'product', spec: '1kg * 20', unit: '개', stock: 0, lots: [], rawMaterialName: '볶음참깨' },
  { id: 'loose', companyId: 'taebaek', name: '볶음참깨 낱개', type: 'product', spec: '1kg', unit: '개' },
  { id: 'holder', companyId: 'taebaek', name: '볶음참깨', type: 'wip', subtype: '벌크', unit: 'kg', stock: 0 },
] as Item[];
const inputs = { bom: buildBomIndex(items, [{ parent_id: 'box', child_id: 'loose', quantity: 20 }]), pack: buildPackIndex() };
const store = {} as Firestore;
const originalIndex = getBomIndex();
beforeEach(() => {
  state.docs.clear(); state.queries = []; state.gate = undefined; state.waiting = false;
  raw.read.mockReset().mockRejectedValue(new Error('원료 명령 관찰 종료'));
  state.docs.set('purchaseOrders/po', { companyId: 'taebaek', status: 'invoiced', partnerName: '공급자', items: [{ itemId: 'box', name: '볶음참깨 포장', quantity: 2, unit: '개' }] });
  state.docs.set('items/box', items[0]); setBomIndex(inputs.bom);
});
afterEach(() => setBomIndex(originalIndex));
it.each(['개','kg','L'])('상품 %s는 원료와 이름이 같아도 자기 SKU 수량 로트로 입고된다',async unit=>{
 const item={id:'box',companyId:'taebaek',name:'참깨',type:'goods',unit,stock:0,lots:[],spec:'1kg',minStock:0,image:''} as Item;
 state.docs.set('items/box',item);expect(await confirmUnitPurchaseOrderReceiptWithDb(store,'taebaek','po','관리자',[item],{bom:buildBomIndex([item],[]),pack:buildPackIndex()})).toBe(true);
 const unitKg=unit==='L'?0:1;
 expect(state.docs.get('items/box')).toMatchObject({stock:2,lots:[{qtyIn:2,qtyRemaining:2,unitKg,kgRemaining:2*unitKg}]});expect(raw.read).not.toHaveBeenCalled();
});
it('명시 원료 매입 별칭 상품은 기존 원료 홀더 경로를 유지한다',async()=>{
 state.docs.set('items/box',{...items[0],type:'goods',rawMaterialName:'볶음참깨'});
 await expect(confirmUnitPurchaseOrderReceiptWithDb(store,'taebaek','po','관리자',items,inputs)).rejects.toThrow('원료 명령 관찰 종료');
 expect(raw.read.mock.calls[0][2]).toMatchObject({rawItemId:'holder',kind:'receive',kg:40});
});
it('부자재는 기존 공급자 로트가 있어도 수량만 변경한다',async()=>{
 const lots=[{id:'supplier-old',qtyRemaining:3,kgRemaining:0,status:'active'}];state.docs.set('items/box',{...items[0],type:'submaterial',name:'캡',rawMaterialName:undefined,lots});
 expect(await confirmUnitPurchaseOrderReceiptWithDb(store,'taebaek','po','관리자',items,inputs)).toBe(true);
 expect(state.docs.get('items/box')).toMatchObject({stock:2,lots});
});

it('실제 품목 조회 대기 중 회사 색인이 바뀌어도 명시 BOM의 로트 중량을 유지한다', async () => {
  let finish!: () => void; state.gate = new Promise<void>(done => { finish = done; });
  const pending = confirmUnitPurchaseOrderReceiptWithDb(store, 'taebaek', 'po', '관리자', items, inputs);
  await vi.waitFor(() => expect(state.waiting).toBe(true));
  const foreign = buildBomIndex([], []); setBomIndex(foreign); finish();
  expect(await pending).toBe(true);
  expect(state.docs.get('items/box')).toMatchObject({ stock: 2, lots: [{ unitKg: 20, qtyIn: 2, kgIn: 40, kgRemaining: 40 }] });
  expect(state.docs.get('purchaseOrders/po').status).toBe('received');
  expect(state.queries).toEqual(['itemReceipts', 'rawMaterialLedger']);
  expect(getBomIndex()).toBe(foreign);
});

it('포장 원료 경로도 동일한 명시 BOM으로 원료 명령 kg를 계산한다', async () => {
  state.docs.set('items/box', { ...items[0], type: 'raw' });
  let finish!: () => void; state.gate = new Promise<void>(done => { finish = done; });
  const pending = confirmUnitPurchaseOrderReceiptWithDb(store, 'taebaek', 'po', '관리자', items, inputs);
  const rejected = expect(pending).rejects.toThrow('원료 명령 관찰 종료');
  await vi.waitFor(() => expect(state.waiting).toBe(true)); setBomIndex(buildBomIndex([], [])); finish(); await rejected;
  expect(raw.read.mock.calls[0][2]).toMatchObject({ companyId: 'taebaek', rawItemId: 'holder', kind: 'receive', kg: 40 });
  expect(state.docs.get('purchaseOrders/po').status).toBe('invoiced'); expect(state.docs.get('items/box').stock).toBe(0);
});

it('명시 입력이 없는 기존 호출도 조회 전에 색인을 고정하고 재시도는 중복 입고하지 않는다', async () => {
  let finish!: () => void; state.gate = new Promise<void>(done => { finish = done; });
  const pending = confirmUnitPurchaseOrderReceiptWithDb(store, 'taebaek', 'po', '관리자', items);
  await vi.waitFor(() => expect(state.waiting).toBe(true)); setBomIndex(buildBomIndex([], [])); finish();
  expect(await pending).toBe(true);
  expect(state.docs.get('items/box').lots[0].kgIn).toBe(40);
  expect(await confirmUnitPurchaseOrderReceiptWithDb(store, 'taebaek', 'po', '관리자', items, inputs)).toBe(false);
  expect(state.docs.get('items/box')).toMatchObject({ stock: 2, lots: [expect.objectContaining({ qtyIn: 2 })] });
});

it('다른 회사 발주는 명시 계산 입력이 있어도 입고 상태나 재고를 바꾸지 않는다', async () => {
  await expect(confirmUnitPurchaseOrderReceiptWithDb(store, 'punghoe', 'po', '관리자', items, inputs)).rejects.toThrow('발주 회사');
  expect(state.docs.get('purchaseOrders/po').status).toBe('invoiced');
  expect(state.docs.get('items/box').stock).toBe(0);
});
it('취소된 일반·원료 발주는 received duplicate 반환보다 먼저 거절하고 원문을 보존한다',async()=>{
 for(const type of ['product','raw']){
  state.docs.set('items/box',{...items[0],type});state.docs.set('purchaseOrders/po',{companyId:'taebaek',status:'cancelled',items:[{itemId:'box',quantity:2}]});
  const before=JSON.stringify([...state.docs]);await expect(confirmUnitPurchaseOrderReceiptWithDb(store,'taebaek','po','관리자',items,inputs)).rejects.toThrow('취소된 발주');expect(JSON.stringify([...state.docs])).toBe(before);expect(raw.read).not.toHaveBeenCalled();
 }
});

it.each([20,22.5,25])('원료 %skg 포 선택 스냅샷으로 입고 kg와 포장 로트를 준비한다',async unitKg=>{
 const holder={id:'holder',companyId:'taebaek',name:'볶음참깨',type:'wip',subtype:'벌크',unit:'kg',stock:0,packageKg:999} as Item;
 const snapshot={sourceLineIndex:0,purchaseUnitId:'registered',purchaseUnit:'포',purchaseQty:2,unitKg,inventoryQty:2*unitKg};
 state.docs.set('items/holder',holder);
 state.docs.set('purchaseOrders/po',{companyId:'taebaek',status:'invoiced',partnerName:'공급자',items:[{itemId:'holder',name:holder.name,quantity:2,unit:'kg',...snapshot}]});
 await expect(confirmUnitPurchaseOrderReceiptWithDb(store,'taebaek','po','관리자',[holder],inputs)).rejects.toThrow('원료 명령 관찰 종료');
 expect(raw.read.mock.calls[0][2]).toMatchObject({rawItemId:'holder',kg:2*unitKg,lot:{packageType:'포',packageKg:unitKg,qtyIn:2}});
 expect(state.queries).toEqual(['itemReceipts','rawMaterialLedger']);
});
it('L 원료도 저장 inventoryQty kg를 밀도로 다시 곱하지 않는다',async()=>{
 const holder={id:'holder',companyId:'taebaek',name:'깨분참기름',type:'wip',subtype:'벌크',unit:'L',density:0.9,stock:0} as Item;
 state.docs.set('items/holder',holder);
 state.docs.set('purchaseOrders/po',{companyId:'taebaek',status:'invoiced',items:[{itemId:'holder',quantity:2,unit:'L',sourceLineIndex:0,purchaseUnitId:'registered',purchaseUnit:'L통',purchaseQty:2,unitKg:0.9,inventoryQty:1.8}]});
 await expect(confirmUnitPurchaseOrderReceiptWithDb(store,'taebaek','po','관리자',[holder],inputs)).rejects.toThrow('원료 명령 관찰 종료');
 expect(raw.read.mock.calls[0][2].kg).toBe(1.8);
});
it('개수 재고나 부분 스냅샷은 원료 단위 선택으로 입고하지 않는다',async()=>{
 const po=state.docs.get('purchaseOrders/po'); po.items[0]={...po.items[0],sourceLineIndex:0,purchaseUnitId:'registered',purchaseUnit:'포',purchaseQty:2,unitKg:20,inventoryQty:40};
 const original=JSON.stringify([...state.docs]);
 await expect(confirmUnitPurchaseOrderReceiptWithDb(store,'taebaek','po','관리자',items,inputs)).rejects.toThrow('원료 품목');
 expect(JSON.stringify([...state.docs])).toBe(original); expect(raw.read).not.toHaveBeenCalled();
 delete po.items[0].unitKg;
 await expect(confirmUnitPurchaseOrderReceiptWithDb(store,'taebaek','po','관리자',items,inputs)).rejects.toThrow();
 expect(raw.read).not.toHaveBeenCalled();
});
