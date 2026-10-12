import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnpackPlan } from '../canUnpack';
import { inventoryDocId } from '../rawInventoryCore';
import type { CanUnpackRequest } from '../itemInventoryAttempt';
import { productStocktakeRequest, type ProductStocktakeRequest } from '../productStocktakeAttempt';

type Ref = { path: string };
const store = new Map<string, Record<string, unknown>>();
let writes = 0;
let reads = 0;
const actor=vi.hoisted(()=>({uid:'employee',companyId:'taebaek'}));

vi.mock('../firebase', () => ({ db: { __memory: true },authReady:Promise.resolve(),auth:{get currentUser(){return {uid:actor.uid,getIdTokenResult:async()=>({claims:{companyId:actor.companyId,employeeId:actor.uid}})};}} }));
vi.mock('../../constants/formula', () => ({ baseRawName: (name: string) => name }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]): Ref => ({ path: segments.join('/') }),
  getDoc: async (ref: Ref) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) }),
  runTransaction: async (_db: unknown, callback: (tx: unknown) => Promise<unknown>) => {
    const pending: { path: string; data: Record<string, unknown> }[] = [];
    const tx = {
      get: async (ref: Ref) => { reads++; return { exists: () => store.has(ref.path), data: () => store.get(ref.path) }; },
      update: (ref: Ref, data: Record<string, unknown>) => pending.push({ path: ref.path, data: { ...store.get(ref.path), ...data } }),
      set: (ref: Ref, data: Record<string, unknown>) => pending.push({ path: ref.path, data }),
    };
    const result = await callback(tx);
    for (const write of pending) { store.set(write.path, write.data); writes++; }
    return result;
  },
}));

const { unpack, stocktakeByQty,productStocktakeActor } = await import('./unpackService');
const countRequest=(patch:Partial<ProductStocktakeRequest>={})=>productStocktakeRequest({version:1,companyId:'taebaek',uid:'employee',itemId:'can-x',itemName:'캔',targetQty:5,minStock:2,unitKg:1,operationId:'stocktake-can-x-1',capturedAt:'2026-10-12T15:30:00.000Z',...patch,state:'prepared'});
const count=(request:ProductStocktakeRequest,mode:'apply'|'inspect'='apply')=>stocktakeByQty({...request,request,mode});
const plan: UnpackPlan = {
  canItemId: 'can-x', canName: '깨분참기름 캔', cans: 1,
  bulkItemId: 'raw-x', bulkName: '깨분참기름', bulkUnit: 'kg',
  perCan: 16.5, bulkQty: 16.5, discarded: [],
};

let canSequence=0;
const canRequest=(plan:UnpackPlan):CanUnpackRequest=>({version:1,kind:'can-unpack',companyId:'taebaek',uid:'employee',operationId:'can-fixture-'+(++canSequence),capturedAt:'2026-10-12T01:00:00.000Z',date:'2026-10-12',plan});
const canApply=(plan:UnpackPlan)=>unpack(plan,{request:canRequest(plan),mode:'apply',check:async()=>{await productStocktakeActor('taebaek','employee',true);}});
beforeEach(() => {
  store.clear(); canSequence=0;
  writes = 0; reads = 0; actor.uid='employee';actor.companyId='taebaek';
  store.set('items/can-x', { id: 'can-x', companyId: 'taebaek', stock: 3, lots: [] });
  store.set('items/raw-x', { id: 'raw-x', companyId: 'taebaek', name: '깨분참기름', stock: 100, lots: [] });
  store.set(`rawInventories/${inventoryDocId('taebaek', 'raw-x')}`, {
    id: inventoryDocId('taebaek', 'raw-x'), companyId: 'taebaek', rawItemId: 'raw-x',
    materialSnapshot: '깨분참기름', stockKg: 100, revision: 1, lastProcessedAt: '2026-09-01T00:00:00Z',
    activeLots: [{ id: 'bulk-1', material: '깨분참기름', supplierName: '청정', kgIn: 100, kgRemaining: 100,
      receivedDate: '2026-09-01', status: 'active', createdAt: '2026-09-01T00:00:00Z' }],
    recentDepletedLots: [],
  });
});

describe('캔 개봉도 품목 사본과 원자 상태가 일치해야 한다', () => {
  it('기존 이동 기록에 캔 로트 ID도 같은 거래로 저장하고 캔·벌크 수량은 그대로 한 번 움직인다', async () => {
    store.set('items/can-x', { id: 'can-x', companyId: 'taebaek', stock: 3, lots: [
      { id: 'can-source', supplierName: '공급처', qtyIn: 3, qtyRemaining: 3, kgIn: 49.5, kgRemaining: 49.5,
        unitKg: 16.5, status: 'active', receivedDate: '2026-09-01' },
    ] });
    const result = await canApply(plan);
    expect(result.ok).toBe(true);
    expect(writes).toBe(4);
    expect(store.get('items/can-x')?.stock).toBe(2);
    expect(store.get('items/raw-x')?.stock).toBe(116.5);
    const movements = [...store.entries()].filter(([key]) => key.startsWith('rawMaterialLedger/'));
    expect(movements).toHaveLength(1);
    expect(movements[0][1]).toMatchObject({
      source: { type: 'unpack', id: 'can-x' }, received: 0, used: 0,
      unpackMoves: [{ canLotId: 'can-source', cans: 1, bulkQty: 16.5 }],
    });
  });
  it.each([0.001, 0.5])('차이 %skg이면 캔·벌크·원장 어느 문서도 쓰지 않는다', async delta => {
    store.set('items/raw-x', { ...store.get('items/raw-x'), stock: 100 + delta });
    const before = JSON.stringify([...store.entries()]);
    const result = await canApply(plan);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('품목 재고와 원료 상태가 어긋나');
    expect(writes).toBe(0);
    expect(JSON.stringify([...store.entries()])).toBe(before);
    expect([...store.keys()].filter(key => key.startsWith('rawMaterialLedger/'))).toHaveLength(0);
  });

  it('캔 현재고보다 많이 까면 캔·벌크·원자 상태·원장에 아무것도 쓰지 않는다', async () => {
    const before = JSON.stringify([...store.entries()]);
    const result = await canApply({ ...plan, cans: 4, bulkQty: 66 });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('깨분참기름 캔 재고가 부족합니다');
    expect(writes).toBe(0);
    expect(JSON.stringify([...store.entries()])).toBe(before);
  });

  it('숫자 재고는 있어도 로트가 부족하면 거래 전체를 거절한다', async () => {
    store.set('items/can-x', {
      id: 'can-x', companyId: 'taebaek', stock: 3,
      lots: [{ id: 'can-lot-1', supplierName: '이월', qtyIn: 2, qtyRemaining: 2,
        kgIn: 33, kgRemaining: 33, unitKg: 16.5, status: 'active', receivedDate: '2026-09-01' }],
    });
    const before = JSON.stringify([...store.entries()]);
    const result = await canApply({ ...plan, cans: 3, bulkQty: 49.5 });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('캔 로트 재고가 부족합니다');
    expect(writes).toBe(0);
    expect(JSON.stringify([...store.entries()])).toBe(before);
  });
});

describe('품목 실사와 최소 수량은 함께 저장한다', () => {
  it('같은 요청의 재시도는 중복 기록하지 않고 새 요청은 같은 수량이어도 새 실사로 남긴다', async () => {
    const first = countRequest();
    expect((await count(first)).ok).toBe(true);
    expect(store.get('items/can-x')).toMatchObject({ stock: 5, minStock: 2 });
    expect((store.get('items/can-x')?.stocktakeAnchors as unknown[])).toHaveLength(1);
    expect((store.get('items/can-x')?.stocktakeAnchors as any[])[0]).toMatchObject({date:'2026-10-13',createdAt:first.capturedAt,request:first});
    const afterFirst = writes;
    expect((await count(first)).ok).toBe(true);
    expect(writes).toBe(afterFirst);
    expect((store.get('items/can-x')?.stocktakeAnchors as unknown[])).toHaveLength(1);
    expect((await count(countRequest({operationId:'stocktake-can-x-2'}))).ok).toBe(true);
    expect((store.get('items/can-x')?.stocktakeAnchors as unknown[])).toHaveLength(2);
  });

  it('잘못된 최소 수량과 같은 ID로 바꾼 요청은 둘 다 아무것도 저장하지 않는다', async () => {
    expect((await stocktakeByQty({...countRequest(),minStock:-1,request:countRequest(),mode:'apply'})).ok).toBe(false);
    expect(writes).toBe(0);
    const first = countRequest();
    expect((await count(first)).ok).toBe(true);
    const afterFirst = writes;
    expect((await stocktakeByQty({...first,targetQty:6,request:first,mode:'apply'})).ok).toBe(false);
    expect(writes).toBe(afterFirst);
    expect(store.get('items/can-x')).toMatchObject({ stock: 5, minStock: 2 });
  });
});
it('새 캔 원문은 첫 시각·FIFO 결과를 보존하고 품목 삭제 후 inspect 쓰기0이다',async()=>{
 const request={version:1 as const,kind:'can-unpack' as const,operationId:'can-first',companyId:'taebaek' as const,uid:'employee',capturedAt:'2026-10-12T15:30:00.000Z',date:'2026-10-12',plan};
 const check=async()=>{};expect((await unpack(plan,{request,mode:'apply',check})).status).toBe('applied');
 store.delete('items/can-x');store.delete('items/raw-x');const before=JSON.stringify([...store]),count=writes;
 expect((await unpack(plan,{request,mode:'inspect',check})).status).toBe('duplicate');expect(writes).toBe(count);expect(JSON.stringify([...store])).toBe(before);
});
it('새 캔 부족·미러 불일치는 확실한 쓰기전 거절이고 inspect 부재는 미확인이다',async()=>{
 const request={version:1 as const,kind:'can-unpack' as const,operationId:'can-rejected',companyId:'taebaek' as const,uid:'employee',capturedAt:'2026-10-12T15:30:00.000Z',date:'2026-10-12',plan};const check=async()=>{};
 store.set('items/raw-x',{...store.get('items/raw-x'),stock:99});expect((await unpack(plan,{request,mode:'apply',check})).status).toBe('rejected');expect(writes).toBe(0);
 expect((await unpack(plan,{request,mode:'inspect',check})).status).toBe('unknown');expect(writes).toBe(0);
});
it('새 캔 receipt의 result 숫자 손상은 자기복사 text가 있어도 성공0이다',async()=>{
 const request={version:1 as const,kind:'can-unpack' as const,operationId:'can-broken',companyId:'taebaek' as const,uid:'employee',capturedAt:'2026-10-12T15:30:00.000Z',date:'2026-10-12',plan};const check=async()=>{};
 await unpack(plan,{request,mode:'apply',check});const receipt=[...store.entries()].find(([key])=>key.startsWith('rawMaterialLedger/'))![1] as any;receipt.inventoryResult.canAfter=99;const count=writes;expect((await unpack(plan,{request,mode:'inspect',check})).status).toBe('unknown');expect(writes).toBe(count);
});
it('나눠진 소수 로트는 기존 행별 반올림 결과를 유지하고 같은 원문 inspect한다',async()=>{
 store.set('items/can-x',{...store.get('items/can-x'),stock:2,lots:[{id:'a',supplierName:'공급처',qtyRemaining:1,kgRemaining:1,unitKg:1,status:'active'},{id:'b',supplierName:'공급처',qtyRemaining:1,kgRemaining:1,unitKg:1,status:'active'}]});
 const split={...plan,cans:2,perCan:0.33335,bulkQty:0.667};const request={version:1 as const,kind:'can-unpack' as const,operationId:'can-split',companyId:'taebaek' as const,uid:'employee',capturedAt:'2026-10-12T15:30:00.000Z',date:'2026-10-12',plan:split};const check=async()=>{};
 expect((await unpack(split,{request,mode:'apply',check})).ok).toBe(true);expect(store.get('items/raw-x')!.stock).toBe(100.666);expect((await unpack(split,{request,mode:'inspect',check})).status).toBe('duplicate');
});

it('요청과 실행방식이 없는 예전 호출은 읽기·쓰기 전에 거절한다',async()=>{
 const before=JSON.stringify([...store]);
 // 옛 호출이 남았을 때의 런타임 입력을 의도적으로 시험한다.
 expect((await stocktakeByQty({itemId:'can-x',itemName:'캔',targetQty:0,operationId:'old-call'} as unknown as Parameters<typeof stocktakeByQty>[0])).ok).toBe(false);
 const request=countRequest();expect((await stocktakeByQty({...request,request} as unknown as Parameters<typeof stocktakeByQty>[0])).ok).toBe(false);
 expect(reads).toBe(0);expect(writes).toBe(0);expect(JSON.stringify([...store])).toBe(before);
});
it.each(['company','uid','raw-holder'] as const)('명시 요청의 %s가 맞지 않으면 원문을 보존한다',async scenario=>{
 if(scenario==='company')store.set('items/can-x',{...store.get('items/can-x'),companyId:'punghoe'});
 if(scenario==='uid')actor.uid='other';
 if(scenario==='raw-holder')store.set('items/can-x',{...store.get('items/can-x'),type:'raw',subtype:'벌크',unit:'kg'});
 const before=JSON.stringify([...store]);expect((await count(countRequest())).ok).toBe(false);expect(writes).toBe(0);expect(JSON.stringify([...store])).toBe(before);
});
it('영수증 없는 inspect는 새 실사로 대신하지 않고 같은 최초 요청을 유지한다',async()=>{
 const request=countRequest(),text=JSON.stringify(request),before=JSON.stringify([...store]);expect((await count(request,'inspect')).ok).toBe(false);expect(JSON.stringify(request)).toBe(text);expect(writes).toBe(0);expect(JSON.stringify([...store])).toBe(before);
});

it('최초 context 없는 캔 개봉은 런타임에서도 읽기·쓰기 전에 거절한다',async()=>{
 const before=JSON.stringify([...store]);
 // 이미 캐시된 옛 호출을 재현하며 새 최초 요청을 임의 생성하지 않아야 한다.
 expect((await unpack(plan,undefined as unknown as Parameters<typeof unpack>[1])).ok).toBe(false);
 expect(reads).toBe(0);expect(writes).toBe(0);expect(JSON.stringify([...store])).toBe(before);
});
