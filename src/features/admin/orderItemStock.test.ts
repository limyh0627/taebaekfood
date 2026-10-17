import * as catalogWriter from '../../shared/inventoryWriterProtocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item, Order } from '../../shared/types';
import type { OrderProductLotMutation } from './orderProductLots';

const memory = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  transactionCount: 0,
}));

type Ref = { path: string };

vi.mock('firebase/firestore', () => {
  const doc = (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') });
  const snapshot = (ref: Ref) => {
    const data = memory.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  };
  const getDoc = async (ref: Ref) => snapshot(ref);
  const runTransaction = async (_db: unknown, callback: (tx: unknown) => Promise<unknown>) => {
    memory.transactionCount += 1;
    const pending: { path: string; data: Record<string, unknown> }[] = [];
    const result = await callback({
      get: async (ref: Ref) => snapshot(ref),
      update: (ref: Ref, patch: Record<string, unknown>) => pending.push({
        path: ref.path,
        data: { ...(memory.docs.get(ref.path) ?? {}), ...patch },
      }),
    });
    for (const write of pending) memory.docs.set(write.path, write.data);
    return result;
  };
  return { doc, getDoc, runTransaction };
});

const { createOrderItemStockOperations } = await import('./orderItemStock');

const item = (id: string): Item => ({ id, name: id, stock: 0 } as Item);
const order = (ids: string[]): Pick<Order, 'items'> => ({
  items: ids.map(itemId => ({ itemId, quantity: 1 } as never)),
});
const reservableOrder = (id: string, itemIds: string[]): Pick<Order, 'id' | 'items'> => ({
  id,
  ...order(itemIds),
});

beforeEach(() => {
  memory.docs.clear();
  memory.transactionCount = 0;
});

describe('주문 품목 재고 DB 경계', () => {
  it('여러 품목 증감을 한 transaction에서 함께 반영한다', async () => {
    memory.docs.set('items/a', { stock: 10 });
    memory.docs.set('items/b', { stock: 20 });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a'), item('b')] });

    await stock.applyItemStockDeltas(new Map([['a', -3], ['b', 5]]));

    expect(memory.transactionCount).toBe(1);
    expect(memory.docs.get('items/a')?.stock).toBe(7);
    expect(memory.docs.get('items/b')?.stock).toBe(25);
  });

  it('겹쳐 시작한 주문은 앞 주문 예약을 뺀 재고만 배정받는다', async () => {
    memory.docs.set('items/a', { stock: 10 });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const useAtMostEight = (snapshot: ReadonlyMap<string, number>) =>
      new Map([['a', -Math.min(8, snapshot.get('a') ?? 0)]]);

    // A가 원료를 처리하는 동안 아직 숫자 재고는 10이지만, 8개는 A 몫으로 예약돼 있다.
    const a = await stock.reserveOrderStock(reservableOrder('order-a', ['a']), 'op-a', useAtMostEight);
    const b = await stock.reserveOrderStock(reservableOrder('order-b', ['a']), 'op-b', useAtMostEight);

    expect(a.stockSnapshot.get('a')).toBe(10);
    expect(b.stockSnapshot.get('a')).toBe(2);
    expect(memory.docs.get('items/a')?.inventoryReservations).toEqual([
      expect.objectContaining({ operationId: 'op-a', orderId: 'order-a', qty: 8 }),
      expect.objectContaining({ operationId: 'op-b', orderId: 'order-b', qty: 2 }),
    ]);

    await stock.applyItemStockDeltas(new Map([['a', -8]]), [], a);
    await stock.applyItemStockDeltas(new Map([['a', -2]]), [], b);

    expect(memory.docs.get('items/a')).toMatchObject({ stock: 0, inventoryReservations: [] });
  });

  it('원료 처리 중 실패하면 잡아 둔 재고 예약을 해제한다', async () => {
    memory.docs.set('items/a', { stock: 10 });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const reservation = await stock.reserveOrderStock(
      reservableOrder('order-a', ['a']), 'op-a', () => new Map([['a', -7]]),
    );

    await stock.releaseOrderStockReservation(reservation);

    expect(memory.docs.get('items/a')?.stock).toBe(10);
    expect(memory.docs.get('items/a')?.inventoryReservations).toEqual([]);
  });

  it('작업완료한 주문 몫은 출고하거나 취소할 때까지 다음 주문에서 제외한다', async () => {
    memory.docs.set('items/a', { stock: 10 });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const first = await stock.reserveOrderStock(
      reservableOrder('order-a', ['a']), 'produce-a', () => new Map([['a', -10]]),
    );
    // 기존 10개와 새로 만든 2개 모두 이 주문이 출고할 물량이다.
    first.allocationQuantities = new Map([['a', 12]]);
    await stock.applyItemStockDeltas(new Map([['a', 2]]), [], first);

    const second = await stock.reserveOrderStock(
      reservableOrder('order-b', ['a']), 'produce-b', snapshot =>
        new Map([['a', -Math.min(8, snapshot.get('a') ?? 0)]]),
    );

    expect(memory.docs.get('items/a')?.stock).toBe(12);
    expect(second.stockSnapshot.get('a')).toBe(0);
    expect(memory.docs.get('items/a')?.inventoryReservations).toEqual([
      expect.objectContaining({ orderId: 'order-a', qty: 12, state: 'allocated' }),
    ]);
  });

  it('출고 시도 실패는 작업완료 때의 확정 배정을 되살린다', async () => {
    memory.docs.set('items/a', {
      stock: 12,
      inventoryReservations: [{
        operationId: 'produce-a', orderId: 'order-a', qty: 12,
        createdAt: new Date().toISOString(), state: 'allocated',
      }],
    });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const shipment = await stock.reserveOrderStock(
      reservableOrder('order-a', ['a']), 'ship-a', () => new Map([['a', -12]]),
    );

    await stock.releaseOrderStockReservation(shipment);

    expect(memory.docs.get('items/a')?.inventoryReservations).toEqual([
      expect.objectContaining({ operationId: 'produce-a', orderId: 'order-a', qty: 12, state: 'allocated' }),
    ]);
  });

  it('같은 주문의 다음 품목은 앞 품목 배정을 뺀 재고만 보고, 실패하면 앞 배정을 되살린다', async () => {
    memory.docs.set('items/a', {
      stock: 10,
      inventoryReservations: [{
        operationId: 'line-a', orderId: 'order-a', qty: 6,
        createdAt: new Date().toISOString(), state: 'allocated',
      }],
    });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const nextLine = await stock.reserveOrderStock(
      reservableOrder('order-a', ['a']),
      'line-b',
      snapshot => new Map([['a', -Math.min(3, snapshot.get('a') ?? 0)]]),
      [],
      { preserveOwnAllocation: true },
    );

    expect(nextLine.stockSnapshot.get('a')).toBe(4);
    expect(memory.docs.get('items/a')?.inventoryReservations).toEqual([
      expect.objectContaining({ operationId: 'line-b', orderId: 'order-a', qty: 9, state: 'processing' }),
    ]);

    await stock.releaseOrderStockReservation(nextLine);
    expect(memory.docs.get('items/a')?.inventoryReservations).toEqual([
      expect.objectContaining({ operationId: 'line-a', orderId: 'order-a', qty: 6, state: 'allocated' }),
    ]);
  });

  it('작업완료 취소는 재고 반영 transaction에서 확정 배정을 함께 지운다', async () => {
    memory.docs.set('items/a', {
      stock: 12,
      inventoryReservations: [{
        operationId: 'produce-a', orderId: 'order-a', qty: 12,
        createdAt: new Date().toISOString(), state: 'allocated',
      }],
    });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const cleanup = stock.orderStockReservationCleanup(reservableOrder('order-a', ['a']));

    await stock.applyItemStockDeltas(new Map(), [], cleanup);

    expect(memory.docs.get('items/a')).toMatchObject({ stock: 12, inventoryReservations: [] });
  });

  it('완제품 숫자 재고와 FIFO 로트를 같은 transaction에서 함께 반영한다', async () => {
    memory.docs.set('items/a', {
      stock: 10,
      lots: [{ id: 'lot-1', qtyRemaining: 10, kgRemaining: 10, status: 'active' }],
    });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const lotMutation: OrderProductLotMutation = {
      itemId: 'a',
      apply: lots => ({
        lots: lots.map(lot => ({ ...lot, qtyRemaining: 7, kgRemaining: 7 })),
        consumedLots: [{ itemId: 'a', lotId: 'lot-1', qty: 3 }],
      }),
    };

    const consumed = await stock.applyItemStockDeltas(new Map([['a', -3]]), [lotMutation]);

    expect(memory.transactionCount).toBe(1);
    expect(memory.docs.get('items/a')).toMatchObject({
      stock: 7,
      lots: [{ id: 'lot-1', qtyRemaining: 7, kgRemaining: 7 }],
    });
    expect(consumed).toEqual([{ itemId: 'a', lotId: 'lot-1', qty: 3 }]);
  });

  it('대상 문서 하나가 없으면 다른 품목도 전혀 쓰지 않는다', async () => {
    memory.docs.set('items/a', { stock: 10, lots: [{ id: 'lot-1', qtyRemaining: 10 }] });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a'), item('b')] });
    const lotMutation: OrderProductLotMutation = {
      itemId: 'a',
      apply: lots => ({ lots: lots.map(lot => ({ ...lot, qtyRemaining: 7 })), consumedLots: [] }),
    };

    await expect(stock.applyItemStockDeltas(new Map([['a', -3], ['b', 5]]), [lotMutation]))
      .rejects.toThrow('품목 문서를 찾을 수 없습니다: b');
    expect(memory.docs.get('items/a')).toEqual({ stock: 10, lots: [{ id: 'lot-1', qtyRemaining: 10 }] });
    expect(memory.docs.has('items/b')).toBe(false);
  });

  it('여러 품목 중 하나라도 부족하면 재고·로트·주문을 함께 쓰지 않는다', async () => {
    memory.docs.set('items/a', { stock: 10, lots: [{ id: 'lot-a', qtyRemaining: 10 }] });
    memory.docs.set('items/b', { stock: 2 });
    memory.docs.set('orders/o1', { status: 'before' });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a'), item('b')] });
    const lotMutation: OrderProductLotMutation = {
      itemId: 'a',
      apply: lots => ({ lots: lots.map(lot => ({ ...lot, qtyRemaining: 7 })), consumedLots: [] }),
    };

    await expect(stock.applyItemStockDeltas(
      new Map([['a', -3], ['b', -3]]), [lotMutation], undefined,
      { orderId: 'o1', patch: { status: 'after' } },
    )).rejects.toThrow('b 재고가 부족합니다');
    expect(memory.docs.get('items/a')).toEqual({ stock: 10, lots: [{ id: 'lot-a', qtyRemaining: 10 }] });
    expect(memory.docs.get('items/b')).toEqual({ stock: 2 });
    expect(memory.docs.get('orders/o1')).toEqual({ status: 'before' });
  });

  it('기존 음수 재고는 추가 차감을 막고 입고는 허용한다', async () => {
    memory.docs.set('items/a', { stock: -2 });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });

    await expect(stock.applyItemStockDeltas(new Map([['a', -1]]))).rejects.toThrow('a 재고가 부족합니다');
    expect(memory.docs.get('items/a')?.stock).toBe(-2);
    await stock.applyItemStockDeltas(new Map([['a', 1]]));
    expect(memory.docs.get('items/a')?.stock).toBe(-1);
  });

  it('출고 로트가 새 음수가 되거나 기존 음수가 더 내려가면 전체 거래를 거절한다', async () => {
    memory.docs.set('items/a', { stock: 10, lots: [{ id: 'lot-a', qtyRemaining: -1 }] });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    const lotMutation: OrderProductLotMutation = {
      itemId: 'a',
      apply: lots => ({ lots: [...lots, { ...lots[0]!, id: 'new-negative', qtyRemaining: -2 }], consumedLots: [] }),
    };

    await expect(stock.applyItemStockDeltas(new Map([['a', -1]]), [lotMutation]))
      .rejects.toThrow('a 로트 재고가 부족합니다: new-negative');
    expect(memory.docs.get('items/a')).toEqual({ stock: 10, lots: [{ id: 'lot-a', qtyRemaining: -1 }] });

    lotMutation.apply = lots => ({ lots: lots.map(lot => ({ ...lot, qtyRemaining: -2 })), consumedLots: [] });
    await expect(stock.applyItemStockDeltas(new Map([['a', -1]]), [lotMutation]))
      .rejects.toThrow('a 로트 재고가 부족합니다: lot-a');
  });

  it('예약에서도 다른 주문과 합쳐 부족하면 새 예약을 쓰지 않는다', async () => {
    memory.docs.set('items/a', { stock: 5 });
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [item('a')] });
    await stock.reserveOrderStock(reservableOrder('o1', ['a']), 'op1', () => new Map([['a', -4]]));

    await expect(stock.reserveOrderStock(reservableOrder('o2', ['a']), 'op2', () => new Map([['a', -2]])))
      .rejects.toThrow('a 재고가 부족합니다');
    expect(memory.docs.get('items/a')?.inventoryReservations).toEqual([
      expect.objectContaining({ operationId: 'op1', qty: 4 }),
    ]);
  });
});
import {planOrderStockReservation} from './orderItemStock';
it('공용 예약 판정은 모든 부족·다른 주문·기존 own 배정을 계산하고 원문은 바꾸지 않는다',()=>{
 const data=new Map([['a',{stock:5,inventoryReservations:[{orderId:'other',operationId:'other',qty:3,createdAt:'2026-10-12T00:00:00Z',state:'allocated'}]}],['b',{stock:1,inventoryReservations:[{orderId:'order',operationId:'own',qty:1,createdAt:'2026-10-12T00:00:00Z',state:'allocated'}]}]]);
 const before=structuredClone(data);const result=planOrderStockReservation('order',data,()=>new Map([['a',-4],['b',-1]]),{preserveOwnAllocation:true});
 expect(result.shortages).toHaveLength(2);expect(result.quantities.get('b')).toBe(2);expect(result.available.get('a')).toBe(2);expect(data).toEqual(before);
});
import {assertOrderInventoryGeneration,type OrderInventoryGeneration} from '../../shared/orderInventoryGeneration';
import {orderRawBatchOrderEvidence} from '../../shared/orderRawBatchAttempt';
import {orderProductionRecordId} from '../../shared/orderProductionRecordPlan';
const gen:OrderInventoryGeneration={contractVersion:1,companyId:'taebaek',orderId:'order-a',operationId:'same-op',startedAt:'2026-10-12T00:00:00Z',actorUid:'actor'};
function generationFixture(ids=['a']){
 let uid='actor';const saved={id:'order-a',companyId:'taebaek',status:'PENDING',items:ids.map(itemId=>({itemId,quantity:2})),inventoryOperation:{id:gen.operationId,contractVersion:1,actorUid:gen.actorUid,startedAt:gen.startedAt,state:'processing',kind:'line',lineId:'line-a',targetStatus:'DISPATCHED',actor:'직원',stage:'claim'}} as unknown as Order;
 memory.docs.set('orders/order-a',{...saved});for(const id of ids)memory.docs.set('items/'+id,{companyId:'taebaek',name:id,stock:10,lots:[{id:'lot-'+id,qtyRemaining:10,kgRemaining:10,status:'active'}]});
 const stock=createOrderItemStockOperations({db:{} as any,allItems:ids.map(item),getActorUid:()=>uid});
 return {stock,saved,setUid:(next:string)=>{uid=next;},order:{id:'order-a',items:saved.items},mutation:{orderId:'order-a',generation:gen,expectedOrderText:orderRawBatchOrderEvidence(saved),patch:{status:'DISPATCHED',inventoryOperation:null}}};
}
it('신규 예약은 수량이 없어도 주문을 읽고 claim→reservation을 같은 TX로 저장한다',async()=>{const f=generationFixture([]);await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map(),[],{generation:gen});expect(memory.docs.get('orders/order-a')?.inventoryOperation).toMatchObject({stage:'reservation',id:gen.operationId,startedAt:gen.startedAt});});
it.each(['startedAt','actorUid','missing-company'] as const)('같은 작업ID %s 다른 세대의 예약·복원·final은 쓰기0이다',async field=>{const f=generationFixture();const reservation=await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([['a',-2]]),[],{generation:gen});const live=memory.docs.get('orders/order-a')!;if(field==='missing-company')delete live.companyId;else (live.inventoryOperation as any)[field]=field==='startedAt'?'2026-10-13T00:00:00Z':'other';const before=structuredClone(memory.docs);await expect(f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([['a',-2]]),[],{generation:gen})).rejects.toThrow();await expect(f.stock.releaseOrderStockReservation(reservation)).rejects.toThrow();await expect(f.stock.applyItemStockDeltas(new Map([['a',-2]]),[],reservation,f.mutation)).rejects.toThrow();expect(memory.docs).toEqual(before);});
it('주문 세대가 같아도 item예약의 다른 startedAt·UID는 복원으로 삭제하지 않는다',async()=>{for(const field of ['startedAt','actorUid'] as const){memory.docs.clear();const f=generationFixture();const reservation=await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([['a',-2]]),[],{generation:gen});const row=(memory.docs.get('items/a')!.inventoryReservations as any[])[0];row.generation={...row.generation,[field]:field==='startedAt'?'2026-10-13T00:00:00Z':'other'};const before=structuredClone(memory.docs);await expect(f.stock.releaseOrderStockReservation(reservation)).rejects.toThrow();expect(memory.docs).toEqual(before);}});
it('UID 변경은 예약·빈 final·복원 모두 쓰기0이며 다른회사 item은 새 계약으로 확정하지 않는다',async()=>{const f=generationFixture();const reservation=await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map(),[],{generation:gen});f.setUid('other');const before=structuredClone(memory.docs);await expect(f.stock.releaseOrderStockReservation(reservation)).rejects.toThrow();await expect(f.stock.applyItemStockDeltas(new Map(),[],reservation,f.mutation)).rejects.toThrow();expect(memory.docs).toEqual(before);f.setUid('actor');memory.docs.get('items/a')!.companyId='punghoe';const foreign=structuredClone(memory.docs);await expect(f.stock.applyItemStockDeltas(new Map([['a',-1]]),[],reservation,f.mutation)).rejects.toThrow('명시 회사');expect(memory.docs).toEqual(foreign);});
it('빈 final도 주문 세대를 조회하고 완료표와 null을 함께 저장하며 exact 재전송은 쓰기0이다',async()=>{const f=generationFixture([]);await f.stock.applyItemStockDeltas(new Map(),[],undefined,f.mutation);const saved=memory.docs.get('orders/order-a') as unknown as Order;expect(saved.inventoryOperation).toBeNull();expect(saved.inventoryGenerationCompletion).toMatchObject({generation:gen,consumedLots:[]});const before=structuredClone(memory.docs);await f.stock.applyItemStockDeltas(new Map(),[],undefined,f.mutation);expect(memory.docs).toEqual(before);await expect(f.stock.applyItemStockDeltas(new Map(),[],undefined,{...f.mutation,patch:{status:'SHIPPED',inventoryOperation:null}})).rejects.toThrow('원문');expect(memory.docs).toEqual(before);});
it('동일세대에서 raw 이후 주문 business 원문 변경은 옛 patch로 덮지 않는다',async()=>{const f=generationFixture();(memory.docs.get('orders/order-a')!.items as any[])[0].quantity=5;const before=structuredClone(memory.docs);await expect(f.stock.applyItemStockDeltas(new Map([['a',-2]]),[],undefined,f.mutation)).rejects.toThrow('주문 원문');expect(memory.docs).toEqual(before);});
it('final은 실제 consumedLots 원문과 배정 원문이 같을 때만 duplicate를 반환한다',async()=>{const f=generationFixture();const reservation=await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([['a',-2]]),[],{generation:gen});reservation.allocationQuantities=new Map([['a',2]]);const mutation:OrderProductLotMutation={itemId:'a',apply:lots=>({lots:lots.map(lot=>({...lot,qtyRemaining:8,kgRemaining:8})),consumedLots:[{itemId:'a',lotId:'lot-a',qty:2}]})};const orderMutation={...f.mutation,patch:(consumed:NonNullable<Order['productConsumedLots']>)=>({status:'DISPATCHED',inventoryOperation:null,productConsumedLots:consumed})};const consumed=await f.stock.applyItemStockDeltas(new Map([['a',-2]]),[mutation],reservation,orderMutation);expect(consumed).toEqual([{itemId:'a',lotId:'lot-a',qty:2}]);const before=structuredClone(memory.docs);expect(await f.stock.applyItemStockDeltas(new Map([['a',-2]]),[mutation],reservation,orderMutation)).toEqual(consumed);expect(memory.docs).toEqual(before);reservation.allocationQuantities=new Map([['a',3]]);await expect(f.stock.applyItemStockDeltas(new Map([['a',-2]]),[mutation],reservation,orderMutation)).rejects.toThrow('원문');expect(memory.docs).toEqual(before);});
it('과거 완료표가 있어도 새 processing 표식이 있으면 옛 final 성공으로 처리하지 않는다',async()=>{const f=generationFixture([]);await f.stock.applyItemStockDeltas(new Map(),[],undefined,f.mutation);memory.docs.get('orders/order-a')!.inventoryOperation={...f.saved.inventoryOperation!,id:'new'};const before=structuredClone(memory.docs);await expect(f.stock.applyItemStockDeltas(new Map(),[],undefined,f.mutation)).rejects.toThrow('다른 작업');expect(memory.docs).toEqual(before);});
it('final의 비유한 변화량·class patch는 JSON null로 바꿔서 저장하지 않는다',async()=>{for(const value of [NaN,Infinity]){const f=generationFixture();const before=structuredClone(memory.docs);await expect(f.stock.applyItemStockDeltas(new Map([['a',value]]),[],undefined,f.mutation)).rejects.toThrow();expect(memory.docs).toEqual(before);}const f=generationFixture([]);await expect(f.stock.applyItemStockDeltas(new Map(),[],undefined,{...f.mutation,patch:{date:new Date()}})).rejects.toThrow('JSON');});

it.each(['qty','lotId','itemId','class','text'] as const)('손상 완료 consumed %s는 patch가소비값을안써도duplicate성공0이다',async field=>{const f=generationFixture();const mutation:OrderProductLotMutation={itemId:'a',apply:lots=>({lots,consumedLots:[{itemId:'a',lotId:'lot-a',qty:2}]})};await f.stock.applyItemStockDeltas(new Map([['a',-2]]),[mutation],undefined,f.mutation);const marker=(memory.docs.get('orders/order-a') as any).inventoryGenerationCompletion;if(field==='qty')marker.consumedLots[0].qty=NaN;if(field==='lotId')marker.consumedLots[0].lotId='';if(field==='itemId')marker.consumedLots[0].itemId='';if(field==='class')marker.consumedLots[0]=new Date();if(field==='text')marker.consumedLots[0].qty=3;const before=structuredClone(memory.docs);await expect(f.stock.applyItemStockDeltas(new Map([['a',-2]]),[mutation],undefined,f.mutation)).rejects.toThrow();expect(memory.docs).toEqual(before);});

it.each([0,-1,NaN])('소비qty %s가 canonical문자열과같이손상되어도양수유한량검증으로duplicate0이다',async qty=>{const f=generationFixture();const mutation:OrderProductLotMutation={itemId:'a',apply:lots=>({lots,consumedLots:[{itemId:'a',lotId:'lot-a',qty:2}]})};await f.stock.applyItemStockDeltas(new Map([['a',-2]]),[mutation],undefined,f.mutation);const marker=(memory.docs.get('orders/order-a') as any).inventoryGenerationCompletion;marker.consumedLots[0].qty=qty;marker.consumedLotsText=JSON.stringify(marker.consumedLots.map((row:any)=>({itemId:row.itemId,lotId:row.lotId,qty:row.qty})));const before=structuredClone(memory.docs);await expect(f.stock.applyItemStockDeltas(new Map([['a',-2]]),[mutation],undefined,f.mutation)).rejects.toThrow();expect(memory.docs).toEqual(before);});
it.each(['production-record','final-stock'] as const)('새 생산기록 %s 최종 확정은 기대 index 없으면 쓰기0이다',async stage=>{
 const f=generationFixture();Object.assign(memory.docs.get('orders/order-a')!.inventoryOperation!,{stage,productionRecordContractVersion:1});
 const before=structuredClone(memory.docs);await expect(f.stock.applyItemStockDeltas(new Map([['a',2]]),[],undefined,f.mutation)).rejects.toThrow('생산기록 연결');expect(memory.docs).toEqual(before);
});
it('생산기록 뒤 pointer 경합은 final 쓰기0이며 복원 후 같은 기대 원문만 duplicate한다',async()=>{
 const f=generationFixture();Object.assign(memory.docs.get('orders/order-a')!.inventoryOperation!,{stage:'production-record',productionRecordContractVersion:1});
 memory.docs.get('orders/order-a')!.productionRecordIndex={};const mutation={...f.mutation,expectedProductionRecordIndex:{}};
 memory.docs.get('orders/order-a')!.productionRecordIndex={changed:{recordId:'foreign'}};const before=structuredClone(memory.docs);
 await expect(f.stock.applyItemStockDeltas(new Map([['a',2]]),[],undefined,mutation)).rejects.toThrow('연결이 변경');expect(memory.docs).toEqual(before);
 memory.docs.get('orders/order-a')!.productionRecordIndex={};await f.stock.applyItemStockDeltas(new Map([['a',2]]),[],undefined,mutation);const finished=structuredClone(memory.docs);
 await f.stock.applyItemStockDeltas(new Map([['a',2]]),[],undefined,mutation);expect(memory.docs).toEqual(finished);
 await expect(f.stock.applyItemStockDeltas(new Map([['a',2]]),[],undefined,f.mutation)).rejects.toThrow('원문');expect(memory.docs).toEqual(finished);
});
it.each(['productionRecordIndex','productionRecordIndex.line.recordId'])('final patch %s는 검증한 연결을 다시 덮지 못하고 쓰기0이다',async key=>{
 const f=generationFixture();memory.docs.get('orders/order-a')!.productionRecordIndex={};const before=structuredClone(memory.docs);
 await expect(f.stock.applyItemStockDeltas(new Map([['a',2]]),[],undefined,{...f.mutation,expectedProductionRecordIndex:{},patch:{...f.mutation.patch,[key]:{}}})).rejects.toThrow('최종 재고 패치');expect(memory.docs).toEqual(before);
});
it('빈 생산기록 index 필드 삭제는 final·완료 duplicate를 복원 쓰기 없이 거절한다',async()=>{
 const f=generationFixture([]);Object.assign(memory.docs.get('orders/order-a')!.inventoryOperation!,{stage:'production-record',productionRecordContractVersion:1});
 const mutation={...f.mutation,expectedProductionRecordIndex:{}};const missing=structuredClone(memory.docs);
 await expect(f.stock.applyItemStockDeltas(new Map(),[],undefined,mutation)).rejects.toThrow('연결 필드');expect(memory.docs).toEqual(missing);
 memory.docs.get('orders/order-a')!.productionRecordIndex={};await f.stock.applyItemStockDeltas(new Map(),[],undefined,mutation);delete memory.docs.get('orders/order-a')!.productionRecordIndex;
 const before=structuredClone(memory.docs);await expect(f.stock.applyItemStockDeltas(new Map(),[],undefined,mutation)).rejects.toThrow('연결 필드');expect(memory.docs).toEqual(before);
 memory.docs.get('orders/order-a')!.productionRecordIndex={line:{recordId:orderProductionRecordId(gen,'line'),generation:gen,requestHash:'a'.repeat(64)}};
 const changed=structuredClone(memory.docs);await expect(f.stock.applyItemStockDeltas(new Map(),[],undefined,mutation)).rejects.toThrow('연결이 변경');expect(memory.docs).toEqual(changed);
});

it('검증 proof는 최종 커밋에만 붙고 완료표 최초 원문과 완료 재시도는 바꾸지 않는다',async()=>{const spy=vi.spyOn(catalogWriter,'prepareCatalogOrderCommit').mockImplementation(async(_db,_tx,_id,_before,patch)=>({...patch,catalogReferenceProofId:'proof-one'}));try{const f=generationFixture([]),original=structuredClone(f.mutation.patch);await f.stock.applyItemStockDeltas(new Map(),[],undefined,f.mutation);const saved=memory.docs.get('orders/order-a')!;expect(saved.catalogReferenceProofId).toBe('proof-one');expect(JSON.parse((saved.inventoryGenerationCompletion as any).requestText).patch).toEqual(original);expect(f.mutation.patch).toEqual(original);spy.mockClear();await f.stock.applyItemStockDeltas(new Map(),[],undefined,f.mutation);expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}});
it('옛 세대의 재고 증감 없는 주문 변경도 실제 마지막 TX에서 별도 proof 메타를 받는다',async()=>{
 const before={companyId:'taebaek',status:'DELIVERED',items:[]};memory.docs.set('orders/legacy',before);
 const patch={status:'PENDING',items:[{itemId:'a'}]},original=structuredClone(patch);
 const spy=vi.spyOn(catalogWriter,'prepareCatalogOrderCommit').mockImplementation(async(_db,_tx,_id,_before,value)=>({...value,catalogReferenceProofId:'legacy-proof'}));
 try{const stock=createOrderItemStockOperations({db:{} as never,allItems:[]});await stock.applyItemStockDeltas(new Map(),[],undefined,{orderId:'legacy',patch});expect(spy).toHaveBeenCalledOnce();expect(spy.mock.calls[0].slice(2)).toEqual(['legacy',before,original]);expect(memory.docs.get('orders/legacy')).toMatchObject({status:'PENDING',catalogReferenceProofId:'legacy-proof'});expect(patch).toEqual(original);}finally{spy.mockRestore();}
});
