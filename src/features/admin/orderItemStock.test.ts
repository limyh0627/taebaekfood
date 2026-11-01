import * as catalogWriter from '../../shared/inventoryWriterProtocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item, Order } from '../../shared/types';
import type { OrderProductLotMutation } from './orderProductLots';

const memory = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  transactionCount: 0,
  updatePaths: [] as string[],
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
      update: (ref: Ref, patch: Record<string, unknown>) => {
        memory.updatePaths.push(ref.path);
        return pending.push({path: ref.path,data: { ...(memory.docs.get(ref.path) ?? {}), ...patch }});
      },
      set: (ref: Ref, data: Record<string, unknown>) => pending.push({path:ref.path,data}),
    });
    for (const write of pending) memory.docs.set(write.path, write.data);
    return result;
  };
  return { doc, getDoc, getDocFromServer:async(ref:Ref)=>({...await getDoc(ref),metadata:{fromCache:false,hasPendingWrites:false}}), runTransaction };
});

const { createOrderItemStockOperations } = await import('./orderItemStock');
const { createOrderStockEngine } = await import('./orderStockEngine');
const { OrderStatus } = await import('../../shared/types');

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
  memory.updatePaths = [];
});

describe('주문 품목 재고 DB 경계', () => {
  it.each(['gen0','gen1-reversal'] as const)('재고 만들기 체크 해제 %s는 정상 생성된 다른 주문 예약을 보존해야 한다', async mode => {
    const { buildBomIndex } = await import('../../shared/bomIndex');
    const { buildPackIndex } = await import('../../shared/packIndex');
    const { emptyRawInventory, inventoryDocId } = await import('../../shared/rawInventoryCore');
    const { executeRawInventoryCommand } = await import('../../shared/services/rawInventoryService');
    const items = [{id:'product',companyId:'taebaek',name:'기름',type:'product',unit:'개',stock:0,spec:'1L'}, {id:'raw',companyId:'taebaek',name:'참깨',rawMaterialName:'참깨',type:'raw',subtype:'벌크',unit:'kg',stock:10}] as Item[];
    const current = {id:'production',companyId:'taebaek',partnerName:'합성',purpose:'stock-production',status:OrderStatus.PENDING,items:[{itemId:'product',lineId:'line-1',name:'기름',quantity:3,checked:false}]} as Order;
    const raw=emptyRawInventory('taebaek','raw','참깨','2026-10-01T00:00:00Z');raw.stockKg=10;raw.activeLots=[{id:'raw-lot',material:'참깨',supplierName:'합성',receivedDate:'2026-10-01',qtyIn:0,kgIn:10,kgRemaining:10,status:'active',createdAt:'2026-10-01T00:00:00Z'}];
    items[1].lots=raw.activeLots;
    for(const value of items)memory.docs.set('items/'+value.id,value as unknown as Record<string,unknown>);
    memory.docs.set('orders/production',current as unknown as Record<string,unknown>);
    memory.docs.set('rawInventories/'+inventoryDocId('taebaek','raw'),raw as unknown as Record<string,unknown>);
    const inputs={bom:buildBomIndex(items,[{parent_id:'product',child_id:'raw',quantity:1}]),pack:buildPackIndex()};
    let reverseClaim=false;
    const engine=createOrderStockEngine({db:{} as never,allItems:items,submaterials:[],partners:[],allOrders:[current],orders:[current],orderUnitInputs:inputs,buildFormula:()=>[],getActorUid:()=> 'actor',retireRetainedRequestBeforeClaim:async()=>undefined,createProductionRecordsForOrder:async()=>{},claimOrderOperation:async(_id,_status,operation)=>{const inventoryOperation=reverseClaim&&mode==='gen1-reversal'?{...operation,contractVersion:1 as const,productionRecordContractVersion:1 as const,actorUid:'actor'}:operation;const live={...memory.docs.get('orders/production'),inventoryOperation};memory.docs.set('orders/production',live);return live as unknown as Order;},runRawInventoryJob:async input=>({job:{status:'complete'} as never,results:await Promise.all(input.commands.map(async row=>({input:row,result:await executeRawInventoryCommand(row.command,{...row.options,db:{} as never})})))}),updateItem:async(collection,id,data)=>{memory.docs.set(collection+'/'+id,{...memory.docs.get(collection+'/'+id),...data});},addItem:async()=>undefined});
    expect(memory.docs.get('items/product')?.stock).toBe(0);
    await engine.changeOrderItemCompletion('production',0,[{...current.items[0],checked:true}],OrderStatus.DISPATCHED);
    const completed=structuredClone(memory.docs.get('items/product')!);
    expect(completed.stock).toBe(3);expect(completed.inventoryReservations??[]).toEqual([]);
    const stock=createOrderItemStockOperations({db:{} as never,allItems:items,bomIndex:inputs.bom});
    await stock.reserveOrderStock(reservableOrder('other',['product']),'other-op',()=>new Map([['product',-1]]));
    const before=structuredClone(memory.docs.get('items/product')!);
    expect(before).toMatchObject({stock:3,inventoryReservations:[expect.objectContaining({orderId:'other',qty:1})]});
    const beforeAll=structuredClone([...memory.docs]);
    const saved=memory.docs.get('orders/production') as unknown as Order;
    reverseClaim=true;
    if(mode==='gen1-reversal'){vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{},removeItem:()=>{}});vi.doMock('../../shared/services/firebaseService',()=>({markOrderInventoryGenerationFailed:vi.fn(async()=>undefined)}));}
    try{await expect(engine.changeOrderItemCompletion('production',0,[{...saved.items[0],checked:false}],OrderStatus.PENDING)).rejects.toThrow('다른 주문 예약');}finally{if(mode==='gen1-reversal'){vi.unstubAllGlobals();vi.doUnmock('../../shared/services/firebaseService');}}
    const after=memory.docs.get('items/product')!,live=after.inventoryReservations as {qty:number}[];
    expect(after).toEqual(before);
    const oldRaw=beforeAll.find(([path])=>path==='rawInventories/'+inventoryDocId('taebaek','raw'))?.[1];expect(memory.docs.get('rawInventories/'+inventoryDocId('taebaek','raw'))).toEqual(oldRaw);
    expect(memory.docs.get('items/raw')).toEqual(beforeAll.find(([path])=>path==='items/raw')?.[1]);
    expect([...memory.docs].filter(([path])=>path.startsWith('rawMaterialLedger/')||path.startsWith('rawInventoryJobs/'))).toEqual(beforeAll.filter(([path])=>path.startsWith('rawMaterialLedger/')||path.startsWith('rawInventoryJobs/')));
    expect(memory.docs.get('orders/production')).toMatchObject({status:saved.status,items:saved.items});
    console.log('재고만들기 정상 경로 관측',JSON.stringify({initial:{stock:0,live:0},completed:{stock:completed.stock,live:0},before:{stock:before.stock,live:1},after:{stock:after.stock,live:live.reduce((sum,row)=>sum+row.qty,0)}}));
    console.log('재고만들기 합성 원문',JSON.stringify({before:beforeAll,after:[...memory.docs]}));
    expect(Number(after.stock)).toBeGreaterThanOrEqual(live.reduce((sum,row)=>sum+row.qty,0));
  });
  it('실제 상태 엔진은 다른 주문이 예약한 몫을 포함하면 부족한 출고를 차단한다', async () => {
    const goods = { id: 'a', name: '상품', type: '상품', stock: 10, unit: '개' } as Item;
    const current = { id: 'own', status: OrderStatus.DISPATCHED, producedAt: '2026-10-01', items: [{ itemId: 'a', quantity: 7 }] } as Order;
    memory.docs.set('items/a', { stock: 10 });
    memory.docs.set('orders/own', current as unknown as Record<string, unknown>);
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [goods] });
    await stock.reserveOrderStock(reservableOrder('other', ['a']), 'other-op', () => new Map([['a', -4]]));
    const before = structuredClone(memory.docs);
    const engine = createOrderStockEngine({ db: {} as never, allItems: [goods], submaterials: [], partners: [], allOrders: [current], orders: [current], buildFormula: () => [], updateItem: async () => undefined, addItem: async () => undefined });
    let error: unknown;
    try { await engine.reconcileOrderStock(current, OrderStatus.SHIPPED); } catch (caught) { error = caught; }
    const after = memory.docs.get('items/a')!;
    const live = after.inventoryReservations as { qty: number }[];
    expect(Number(after.stock)).toBeGreaterThanOrEqual(live.reduce((sum, row) => sum + row.qty, 0));
    expect(error).toBeInstanceOf(Error);
    expect(memory.docs).toEqual(before);
  });
  it('실제 상태 엔진의 출고는 다른 주문이 정상 예약한 몫을 남긴다', async () => {
    const goods = { id: 'a', name: '상품', type: '상품', stock: 10, unit: '개' } as Item;
    const current = { id: 'own', status: OrderStatus.DISPATCHED, producedAt: '2026-10-01', items: [{ itemId: 'a', quantity: 6 }] } as Order;
    memory.docs.set('items/a', { stock: 10 });
    memory.docs.set('orders/own', current as unknown as Record<string, unknown>);
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [goods] });
    await stock.reserveOrderStock(reservableOrder('other', ['a']), 'other-op', () => new Map([['a', -4]]));
    const engine = createOrderStockEngine({ db: {} as never, allItems: [goods], submaterials: [], partners: [], allOrders: [current], orders: [current], buildFormula: () => [], updateItem: async () => undefined, addItem: async () => undefined });
    await engine.reconcileOrderStock(current, OrderStatus.SHIPPED);
    expect(memory.docs.get('items/a')).toMatchObject({ stock: 4, inventoryReservations: [expect.objectContaining({ orderId: 'other', qty: 4 })] });
  });
  it('실제 상태 엔진의 작업완료 배정은 출고 실패 시 다른 주문 예약과 함께 복원된다', async () => {
    const goods = { id: 'a', name: '상품', type: '상품', stock: 10, unit: '개' } as Item;
    const current = { id: 'own', status: OrderStatus.PENDING, items: [{ itemId: 'a', quantity: 6 }] } as Order;
    memory.docs.set('items/a', { stock: 10 });
    memory.docs.set('orders/own', current as unknown as Record<string, unknown>);
    const stock = createOrderItemStockOperations({ db: {} as never, allItems: [goods] });
    await stock.reserveOrderStock(reservableOrder('other', ['a']), 'other-op', () => new Map([['a', -4]]));
    const engine = createOrderStockEngine({ db: {} as never, allItems: [goods], submaterials: [], partners: [], allOrders: [current], orders: [current], buildFormula: () => [], createProductionRecordsForOrder: async () => {}, updateItem: async () => undefined, addItem: async () => undefined });
    await engine.reconcileOrderStock(current, OrderStatus.DISPATCHED);
    const before = structuredClone(memory.docs.get('items/a'));
    expect(before).toMatchObject({ stock: 10, inventoryReservations: [expect.objectContaining({ orderId: 'other', qty: 4 }), expect.objectContaining({ orderId: 'own', qty: 6, state: 'allocated' })] });
    const completed = memory.docs.get('orders/own') as unknown as Order;
    await expect(engine.reconcileOrderStock(completed, OrderStatus.SHIPPED, undefined, false, undefined, undefined, stage => { if (stage === 'final-stock') throw Error('합성 실패'); })).rejects.toThrow('합성 실패');
    expect(memory.docs.get('items/a')).toEqual({ ...before, inventoryWriteRevision: Number(before?.inventoryWriteRevision) + 2 });
  });
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
it('최종 확정은 무소모 빈 예약24개를 쓰지 않고 실제 한 품목과 완료표만 함께 저장한다',async()=>{
 const ids=Array.from({length:25},(_,i)=>'final-noop-'+i),f=generationFixture(ids);
 for(const id of ids)memory.docs.get('items/'+id)!.inventoryReservations=[];
 const reservation=await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([[ids[0],-1]]),[],{generation:gen});
 const before=structuredClone(memory.docs);memory.updatePaths=[];
 expect(await f.stock.applyItemStockDeltas(new Map([[ids[0],-1]]),[],reservation,f.mutation)).toEqual([]);
 expect(memory.updatePaths.sort()).toEqual(['items/'+ids[0],'orders/order-a'].sort());
 for(const id of ids.slice(1))expect(memory.docs.get('items/'+id)).toEqual(before.get('items/'+id));
 expect(memory.docs.get('items/'+ids[0])?.stock).toBe(9);expect(memory.docs.get('orders/order-a')?.inventoryOperation).toBeNull();
 expect(memory.docs.get('orders/order-a')?.inventoryGenerationCompletion).toMatchObject({generation:gen,consumedLots:[]});
 const completed=structuredClone(memory.docs);memory.updatePaths=[];await f.stock.applyItemStockDeltas(new Map([[ids[0],-1]]),[],reservation,f.mutation);expect(memory.updatePaths).toEqual([]);expect(memory.docs).toEqual(completed);
});
it.each(['empty','missing','other'] as const)('최종 확정의 동일 %s 예약은 품목을 쓰지 않아도 완료표를 남긴다',async kind=>{
 const f=generationFixture(),row=memory.docs.get('items/a')!;
 if(kind==='empty')row.inventoryReservations=[];
 if(kind==='other')row.inventoryReservations=[{orderId:'other',operationId:'keep',qty:2,createdAt:'2000-01-01T00:00:00Z',state:'allocated',unknown:{preserve:true}}];
 const before=structuredClone(row),reservation=f.stock.orderStockReservationCleanup(f.order);memory.updatePaths=[];
 await f.stock.applyItemStockDeltas(new Map(),[],reservation,f.mutation);
 expect(memory.updatePaths).toEqual(['orders/order-a']);expect(memory.docs.get('items/a')).toEqual(before);expect(memory.docs.get('orders/order-a')?.inventoryGenerationCompletion).toMatchObject({generation:gen});
});
it('최종 확정은 만료예약 청소와 새 할당을 실제 저장하고 다른 예약 전문을 보존한다',async()=>{
 const f=generationFixture(),other={orderId:'other',operationId:'keep',qty:2,createdAt:'2000-01-01T00:00:00Z',state:'allocated',unknown:{preserve:true}},expired={orderId:'expired',operationId:'old',qty:1,createdAt:'2000-01-01T00:00:00Z',state:'processing'};
 memory.docs.get('items/a')!.inventoryReservations=[other,expired];
 const reservation=f.stock.orderStockReservationCleanup(f.order);reservation.allocationQuantities=new Map([['a',3]]);memory.updatePaths=[];
 await f.stock.applyItemStockDeltas(new Map(),[],reservation,f.mutation);
 expect(memory.updatePaths.sort()).toEqual(['items/a','orders/order-a'].sort());
 expect(memory.docs.get('items/a')?.inventoryReservations).toEqual([other,expect.objectContaining({orderId:'order-a',qty:3,state:'allocated',generation:gen})]);
});
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


describe('예약 배열이 실제 바뀌는 품목만 저장한다',()=>{
 const revision={inventoryWriterProtocolVersion:1,inventoryWriteRevision:7};
 const operations=()=>createOrderItemStockOperations({db:{} as never,allItems:[item('a')]});
 const reserve=(stock:ReturnType<typeof operations>,options:{preserveOwnAllocation?:boolean}={})=>stock.reserveOrderStock(reservableOrder('own',['a']),'next',()=>new Map(),[],options);
 it('무소모 빈 배열은 거래를 읽되 품목과 원 revision을 쓰지 않는다',async()=>{
  const before={stock:10,inventoryReservations:[],...revision};memory.docs.set('items/a',structuredClone(before));
  const result=await reserve(operations());
  expect(memory.transactionCount).toBe(1);expect(memory.updatePaths).toEqual([]);expect(memory.docs.get('items/a')).toEqual(before);
  expect(result.stockSnapshot.get('a')).toBe(10);expect(result.quantities.size).toBe(0);expect(result.previousReservations.get('a')).toEqual([]);
 });
 it('타 주문의 같은 활성 예약과 가용량을 그대로 보존하고 쓰지 않는다',async()=>{
  const other={operationId:'other-op',orderId:'other',qty:4,createdAt:new Date().toISOString(),state:'processing'};
  const before={stock:10,inventoryReservations:[other],...revision};memory.docs.set('items/a',structuredClone(before));const result=await reserve(operations());
  expect(memory.updatePaths).toEqual([]);expect(memory.docs.get('items/a')).toEqual(before);expect(result.stockSnapshot.get('a')).toBe(6);expect(result.previousReservations.get('a')).toEqual([]);
 });
 it('만료·무효 예약의 정리는 무소모여도 실제로 저장한다',async()=>{
  const other={operationId:'other-op',orderId:'other',qty:2,createdAt:new Date().toISOString(),state:'processing'};
  const expired={operationId:'expired',orderId:'old',qty:3,createdAt:new Date(Date.now()-2*60*60*1000).toISOString(),state:'processing'};
  memory.docs.set('items/a',{stock:10,inventoryReservations:[other,expired,{qty:'비정상'}],...revision});const result=await reserve(operations());
  expect(memory.updatePaths).toEqual(['items/a']);expect(memory.docs.get('items/a')).toEqual({stock:10,inventoryReservations:[other],inventoryWriterProtocolVersion:1,inventoryWriteRevision:8});expect(result.stockSnapshot.get('a')).toBe(8);
 });
 it('무소모 자기 예약 정리도 저장하고 복원 근거는 보존한다',async()=>{
  const own={operationId:'own-old',orderId:'own',qty:3,createdAt:new Date().toISOString(),state:'processing'};
  const other={operationId:'other-op',orderId:'other',qty:2,createdAt:new Date().toISOString(),state:'processing'};
  memory.docs.set('items/a',{stock:10,inventoryReservations:[other,own],...revision});const result=await reserve(operations());
  expect(memory.updatePaths).toEqual(['items/a']);expect(memory.docs.get('items/a')).toEqual({stock:10,inventoryReservations:[other],inventoryWriterProtocolVersion:1,inventoryWriteRevision:8});expect(result.previousReservations.get('a')).toEqual([own]);expect(result.stockSnapshot.get('a')).toBe(8);
 });
 it('추가 수량·새 시각·상태가 바뀐 예약은 정확한 새 원문으로 저장한다',async()=>{
  const time='2026-10-15T12:00:00.000Z';vi.useFakeTimers();vi.setSystemTime(new Date(time));try{
   const old={operationId:'next',orderId:'own',qty:2,createdAt:'2026-10-15T11:50:00.000Z',state:'allocated'};
   memory.docs.set('items/a',{stock:10,inventoryReservations:[old],...revision});const stock=operations(),result=await stock.reserveOrderStock(reservableOrder('own',['a']),'next',()=>new Map([['a',-3]]));
   expect(memory.updatePaths).toEqual(['items/a']);expect(memory.docs.get('items/a')).toEqual({stock:10,inventoryReservations:[{operationId:'next',orderId:'own',qty:3,createdAt:time,state:'processing',reservationAttemptId:expect.any(String)}],inventoryWriterProtocolVersion:1,inventoryWriteRevision:8});expect(result.previousReservations.get('a')).toEqual([old]);expect(result.quantities.get('a')).toBe(3);
  }finally{vi.useRealTimers();}
 });
 it.each([false,true])('자기 확정 배정 보존 %s의 수량·가용량·복원 원문은 유지한다',async preserveOwnAllocation=>{
  const own={operationId:'old',orderId:'own',qty:4,createdAt:new Date().toISOString(),state:'allocated'},other={operationId:'other-op',orderId:'other',qty:2,createdAt:new Date().toISOString(),state:'processing'};
  memory.docs.set('items/a',{stock:10,inventoryReservations:[other,own],...revision});const stock=operations();const result=await stock.reserveOrderStock(reservableOrder('own',['a']),'next',()=>new Map([['a',-2]]),[],{preserveOwnAllocation});
  expect(memory.updatePaths).toEqual(['items/a']);expect(result.stockSnapshot.get('a')).toBe(preserveOwnAllocation?4:8);expect(result.quantities.get('a')).toBe(preserveOwnAllocation?6:2);expect(result.previousReservations.get('a')).toEqual([own]);
  const current=memory.docs.get('items/a')!;expect(current.stock).toBe(10);expect(current.inventoryWriteRevision).toBe(8);expect(current.inventoryReservations).toEqual([other,{operationId:'next',orderId:'own',qty:preserveOwnAllocation?6:2,createdAt:expect.any(String),state:'processing',reservationAttemptId:expect.any(String)}]);
  await stock.releaseOrderStockReservation(result);expect(memory.docs.get('items/a')?.inventoryReservations).toEqual([other,own]);
 });
});
it.each(['release','final'] as const)('동일generation 새B예약 뒤 옛A %s는 실제 writer0이다',async mode=>{const f=generationFixture(['a','b']);const a=await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([['a',-2],['b',-2]]),[],{generation:gen});await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([['a',-4],['b',-4]]),[],{generation:gen});const before=structuredClone(memory.docs);memory.updatePaths=[];await expect(mode==='release'?f.stock.releaseOrderStockReservation(a):f.stock.applyItemStockDeltas(new Map([['a',-2],['b',-2]]),[],a,f.mutation)).rejects.toThrow('예약');expect(memory.docs).toEqual(before);expect(memory.updatePaths).toEqual([]);});
it('동일수량·동일clock 새호출은 다른 시도이고 옛 release/final은 원문 전체를 보존한다',async()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));try{const f=generationFixture();const a=await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([['a',-2]]),[],{generation:gen});const b=await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([['a',-2]]),[],{generation:gen});expect(a.executionEvidence?.reservationAttemptId).toEqual(expect.any(String));expect(b.executionEvidence?.reservationAttemptId).not.toBe(a.executionEvidence?.reservationAttemptId);expect(a.executionEvidence?.currentReservationsByItem[0][1][0].createdAt).toBe(b.executionEvidence?.currentReservationsByItem[0][1][0].createdAt);const before=structuredClone(memory.docs);memory.updatePaths=[];await expect(f.stock.releaseOrderStockReservation(a)).rejects.toThrow('예약');await expect(f.stock.applyItemStockDeltas(new Map([['a',-2]]),[],a,f.mutation)).rejects.toThrow('예약');expect(memory.updatePaths).toEqual([]);expect(memory.docs).toEqual(before);await f.stock.releaseOrderStockReservation(b);}finally{vi.useRealTimers();}});
it('예약 전문 unknownfield 한 품목 충돌은 복수품목 final/release 전체쓰기0이다',async()=>{const f=generationFixture(['a','b']),r=await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([['a',-2],['b',-2]]),[],{generation:gen});(memory.docs.get('items/b')!.inventoryReservations as any[])[0].unknown={changed:true};const before=structuredClone(memory.docs);memory.updatePaths=[];await expect(f.stock.releaseOrderStockReservation(r)).rejects.toThrow('예약');await expect(f.stock.applyItemStockDeltas(new Map([['a',-2],['b',-2]]),[],r,f.mutation)).rejects.toThrow('예약');expect(memory.updatePaths).toEqual([]);expect(memory.docs).toEqual(before);});
it('구실행증거 없는 미완료 destructive final은 거절하지만 같은 완료원문 duplicate는 먼저 인정한다',async()=>{const f=generationFixture(),r=await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([['a',-2]]),[],{generation:gen}),legacy={...r,executionEvidence:undefined};memory.updatePaths=[];await expect(f.stock.applyItemStockDeltas(new Map([['a',-2]]),[],legacy,f.mutation)).rejects.toThrow('예약');expect(memory.updatePaths).toEqual([]);await f.stock.applyItemStockDeltas(new Map([['a',-2]]),[],r,f.mutation);const before=structuredClone(memory.docs);memory.updatePaths=[];await f.stock.applyItemStockDeltas(new Map([['a',-2]]),[],legacy,f.mutation);expect(memory.updatePaths).toEqual([]);expect(memory.docs).toEqual(before);});
it('원own예약이 사라진 release는 이전배정을 되살리지 않으며 expired rawown변경은 final을 막는다',async()=>{const f=generationFixture(),r=await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([['a',-2]]),[],{generation:gen});memory.docs.get('items/a')!.inventoryReservations=[];memory.updatePaths=[];await f.stock.releaseOrderStockReservation(r);expect(memory.updatePaths).toEqual([]);await expect(f.stock.applyItemStockDeltas(new Map([['a',-2]]),[],r,f.mutation)).rejects.toThrow('예약');expect(memory.updatePaths).toEqual([]);});
it('만료된 own행의 전문 변경도 TTL필터로 숨기지 않고 allocated/타주문 원문을 보존한다',async()=>{const f=generationFixture(),r=await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([['a',-2]]),[],{generation:gen});const data=memory.docs.get('items/a')!,rows=data.inventoryReservations as any[];rows[0].createdAt='2000-01-01T00:00:00Z';rows.push({orderId:'other',operationId:'other',qty:1,createdAt:'2000-01-01T00:00:00Z',state:'allocated',unknown:{keep:true}});const before=structuredClone(memory.docs);memory.updatePaths=[];await expect(f.stock.releaseOrderStockReservation(r)).rejects.toThrow('예약');await expect(f.stock.applyItemStockDeltas(new Map([['a',-2]]),[],r,f.mutation)).rejects.toThrow('예약');expect(memory.updatePaths).toEqual([]);expect(memory.docs).toEqual(before);});
it('SDK transaction callback 재시도에서도 호출의 attempt 표식은 고정된다',async()=>{const sdk=await import('firebase/firestore'),original=sdk.runTransaction;let firstAttempt:string|undefined;const spy=vi.spyOn(sdk,'runTransaction').mockImplementationOnce(async(db:any,callback:any)=>{await callback({get:async(ref:Ref)=>({exists:()=>memory.docs.has(ref.path),data:()=>memory.docs.get(ref.path)}),update:(_ref:Ref,patch:any)=>{firstAttempt=patch.inventoryReservations?.[0]?.reservationAttemptId??firstAttempt;}});return original(db,callback);});try{const f=generationFixture(),r=await f.stock.reserveOrderStock(f.order,gen.operationId,()=>new Map([['a',-2]]),[],{generation:gen});expect(firstAttempt).toBeTruthy();expect(r.executionEvidence?.reservationAttemptId).toBe(firstAttempt);expect((memory.docs.get('items/a')!.inventoryReservations as any[])[0].reservationAttemptId).toBe(firstAttempt);}finally{spy.mockRestore();}});
