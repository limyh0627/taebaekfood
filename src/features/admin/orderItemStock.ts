import {runInventoryWriterTransaction,captureInventoryWriterContext} from '../../shared/inventoryWriterProtocol';
import {rawPressText} from '../../shared/rawPressAttempt';
import {protectInventoryWriterPatch,protectItemInventoryPatch} from '../../shared/inventoryWriterProtocol';
import {orderRawBatchOrderEvidence} from '../../shared/orderRawBatchAttempt';
import {validateProductionRecordIndex} from '../../shared/orderProductionRecordPlan';
import {advanceOrderInventoryStage,sameOrderInventoryGeneration,assertOrderInventoryGeneration,hasOrderInventoryGenerationCompletion,finalOrderInventoryRequestText,validateOrderInventoryConsumedLots,type OrderInventoryGeneration} from '../../shared/orderInventoryGeneration';
import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { bomOf, type BomIndex } from '../../shared/bomIndex';
import { pruneDepletedLots } from '../../shared/lotUtils';
import type { Item, ItemInventoryReservation, Order } from '../../shared/types';
import { OrderInventoryPreconditionError, type OrderProductLotMutation } from './orderProductLots';

export interface OrderItemStockDeps {
  db: Firestore;
  allItems: Item[];
  bomIndex?: BomIndex;
  getActorUid?:()=>string|undefined;
}

const stock3 = (value: number) => Math.round(value * 1000) / 1000;
const stripUndefined = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const RESERVATION_TTL_MS = 60 * 60 * 1000;

export interface OrderStockReservation {
  operationId: string;
  orderId: string;
  generation?:OrderInventoryGeneration;
  itemIds: string[];
  quantities: ReadonlyMap<string, number>;
  stockSnapshot: ReadonlyMap<string, number>;
  previousReservations: ReadonlyMap<string, readonly ItemInventoryReservation[]>;
  /** 작업완료 뒤 출고 전 상태라면 새로 만든 몫까지 포함한 주문 전체 출고량을 여기에 둔다. */
  allocationQuantities?: ReadonlyMap<string, number>;
  active: boolean;
}

export const liveItemInventoryReservations = (value: unknown, nowMs = Date.now()): ItemInventoryReservation[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is ItemInventoryReservation => {
    if (!row || typeof row !== 'object') return false;
    const candidate = row as Partial<ItemInventoryReservation>;
    const createdAt = Date.parse(candidate.createdAt ?? '');
    if (typeof candidate.operationId !== 'string' || typeof candidate.orderId !== 'string' ||
      !Number.isFinite(candidate.qty) || Number(candidate.qty) <= 0 || !Number.isFinite(createdAt)) return false;
    // 배정 완료분은 실제 출고나 주문 취소까지 주문 몫이다. 처리 중 브라우저가 닫힌 흔적만 만료한다.
    return candidate.state === 'allocated' || nowMs - createdAt < RESERVATION_TTL_MS;
  });
};

/** 화면과 transaction이 같은 가용 재고를 보여주기 위한 공용 셈. */
export const unreservedItemStock = (
  item: Pick<Item, 'stock' | 'inventoryReservations'>,
  nowMs = Date.now(),
) => stock3(Math.max(0, Number(item.stock ?? 0) - liveItemInventoryReservations(item.inventoryReservations, nowMs)
  .reduce((sum, row) => sum + Number(row.qty), 0)));

/**
 * **다른 주문이 잡아 둔 몫** — 현재고 − 쓸 수 있는 재고.
 *
 * 2026-09-14 사장님: "참진은 재고가 24개 있는데 왜 알람에선 0으로 뜨지 이미 잡아둔게 있어서
 * 그런거야?" 맞다. 그런데 화면에는 **0 이라고만** 떠서, 재고 24개가 보이는 사람에게는
 * 숫자가 어긋나 보인다. **얼마가 잡혀 있는지 같이 보여 주려고** 따로 뽑는다.
 *
 * 잡아 둔 것은 `allocated`(작업완료됐지만 출고 전) 과 처리 중인 것이다 — 이미 임자가 있는
 * 물건이라 다른 주문의 "재고 쓸까요"에 세어 주면 같은 물건을 둘이 나눠 쓴 셈이 된다.
 */
export const reservedItemQty = (
  item: Pick<Item, 'stock' | 'inventoryReservations'>,
  nowMs = Date.now(),
) => stock3(Math.max(0, Number(item.stock ?? 0) - unreservedItemStock(item, nowMs)));

/** 그 몫을 누가 잡고 있나 — 주문 id 들(많으면 앞에서 몇 개만). */
export const reservedByOrders = (
  item: Pick<Item, 'inventoryReservations'>,
  nowMs = Date.now(),
): string[] => [...new Set(liveItemInventoryReservations(item.inventoryReservations, nowMs).map(r => r.orderId))];

/** 주문 라인과 재귀 BOM이 건드릴 모든 품목 ID를 한 번만 모은다. */
export function orderStockTouchedIds(order: Pick<Order, 'items'>, bomIndex?: BomIndex): string[] {
  const seen = new Set<string>();
  const walk = (itemId: string, depth: number) => {
    if (depth > 5 || seen.has(itemId)) return;
    seen.add(itemId);
    for (const line of (bomIndex ? bomIndex.of(itemId) : bomOf(itemId))) walk(line.childId, depth + 1);
  };
  for (const row of order.items) walk(row.itemId, 0);
  return [...seen];
}

/**
 * 주문 생산 판단과 품목 재고 저장의 DB 경계.
 *
 * 예전에는 엔진 인스턴스의 `freshStock` Map을 주문들이 공유했다. 이제 예약 transaction이
 * 읽은 가용 재고를 호출자에게 돌려주며 주문 한 번의 지역 변수로만 보관한다.
 *
 * 저장도 품목별 transaction을 차례로 열지 않는다. 세 품목 중 둘만 반영된 뒤 셋째가 실패하면
 * 주문 재고가 반쪽만 움직이므로, 모든 문서를 먼저 읽고 한 transaction에서 함께 갱신한다.
 */
/** 예약과 사전검사가 같은 전체 가용량·부족 판정을 쓴다. 이 함수는 저장하지 않는다. */
export function planOrderStockReservation(orderId:string, dataByItem:ReadonlyMap<string,Record<string,any>>, planDeltas:(stock:ReadonlyMap<string,number>)=>ReadonlyMap<string,number>, options:{preserveOwnAllocation?:boolean;nowMs?:number}={}) {
 const activeByItem=new Map<string,ItemInventoryReservation[]>(),previousReservations=new Map<string,ItemInventoryReservation[]>(),available=new Map<string,number>();
 const nowMs=options.nowMs??Date.now();
 for(const [itemId,data] of dataByItem){
  const active=liveItemInventoryReservations(data.inventoryReservations,nowMs),own=active.filter(row=>row.orderId===orderId),others=active.filter(row=>row.orderId!==orderId);
  previousReservations.set(itemId,own);activeByItem.set(itemId,others);
  const ownAllocated=options.preserveOwnAllocation?own.filter(row=>row.state==='allocated').reduce((sum,row)=>sum+Number(row.qty),0):0;
  available.set(itemId,stock3(Math.max(0,Number(data.stock??0)-others.reduce((sum,row)=>sum+Number(row.qty),0)-ownAllocated)));
 }
 const planned=planDeltas(available),outside=[...planned.keys()].filter(id=>!available.has(id));
 if(outside.length)throw Error('주문 재고 예약 범위에 없는 품목이 계산되었습니다: '+outside.join(', '));
 const quantities=new Map<string,number>(),shortages:{itemId:string;current:number;other:number;required:number;missing:number}[]=[];
 for(const [itemId,data] of dataByItem){
  const previousQty=options.preserveOwnAllocation?(previousReservations.get(itemId)??[]).filter(row=>row.state==='allocated').reduce((sum,row)=>sum+Number(row.qty),0):0;
  const qty=stock3(previousQty+Math.max(0,-(planned.get(itemId)??0))),current=Number(data.stock??0),other=(activeByItem.get(itemId)??[]).reduce((sum,row)=>sum+Number(row.qty),0);
  if(qty>0){quantities.set(itemId,qty);if(stock3(current-other-qty)<0)shortages.push({itemId,current,other:stock3(other),required:qty,missing:stock3(qty+other-current)});}
 }
 return {activeByItem,previousReservations,available,quantities,shortages};
}

export function createOrderItemStockOperations(deps: OrderItemStockDeps) {
  const { db, allItems, bomIndex } = deps;
  const assertActor=(generation?:OrderInventoryGeneration)=>{if(generation&&deps.getActorUid?.()!==generation.actorUid)throw Error('주문 재고 작업 로그인 계정이 바뀌었습니다.');};
  const readGeneration=async(tx:import('firebase/firestore').Transaction,generation:OrderInventoryGeneration,allowFailed=false)=>{
    assertActor(generation);const ref=doc(db,'orders',generation.orderId),snap=await tx.get(ref);if(!snap.exists())throw Error('주문을 찾을 수 없습니다.');
    const order={...snap.data(),id:generation.orderId} as Order;assertOrderInventoryGeneration(order,generation,{allowFailed});assertActor(generation);return {ref,order};
  };

  /**
   * 생산량을 정하기 전에 가용 재고를 주문 작업 ID로 선점한다.
   *
   * 실제 stock은 원료 차감까지 끝난 뒤 움직여야 하므로 여기서는 건드리지 않는다. 대신 같은
   * transaction 안에서 다른 살아 있는 예약을 빼고 계산한 스냅샷을 계획 함수에 넘긴 뒤, 그
   * 계획이 실제로 기존 재고에서 쓸 양만 기록한다. Firestore가 transaction을 재시도하면 계획도
   * 새 스냅샷으로 다시 계산된다.
   */
  const reserveOrderStock = async (
    order: Pick<Order, 'id' | 'items'>,
    operationId: string,
    planDeltas: (stockSnapshot: ReadonlyMap<string, number>) => ReadonlyMap<string, number>,
    extraItemIds: readonly string[] = [],
    options: { preserveOwnAllocation?: boolean;generation?:OrderInventoryGeneration } = {},
  ): Promise<OrderStockReservation> => {
    const generation=options.generation;
    if(generation&&(generation.orderId!==order.id||generation.operationId!==operationId))throw Error('주문 예약의 최초 세대가 다릅니다.');
    assertActor(generation);
    const ids = [...new Set([...orderStockTouchedIds(order, bomIndex), ...extraItemIds])];
    const now = new Date();
    const nowMs = now.getTime();
    const createdAt = now.toISOString();

    return runInventoryWriterTransaction(db,await captureInventoryWriterContext(db,{requestIdentity:rawPressText({generation,operationId,orderId:order.id,ids}),companyId:generation?.companyId,isStillCurrent:()=>{assertActor(generation);return true;}}), async tx => {
      const current=generation?await readGeneration(tx,generation):null;
      const refs = ids.map(itemId => doc(db, 'items', itemId));
      const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
      const missing = ids.filter((_, index) => !snapshots[index]!.exists());
      if (missing.length > 0) {
        throw new Error(`주문 재고 예약 중 품목을 찾을 수 없습니다: ${missing.join(', ')}`);
      }

      assertActor(generation);
      if(generation&&snapshots.some(snapshot=>snapshot.data()?.companyId!==generation.companyId))throw Error('예약 품목의 명시 회사가 다릅니다.');
      const {activeByItem,previousReservations,available,quantities,shortages}=planOrderStockReservation(order.id,new Map(ids.map((id,index)=>[id,snapshots[index]!.data()??{}])),planDeltas,{...options,nowMs});
      if(shortages.length){const row=shortages[0],item=allItems.find(candidate=>candidate.id===row.itemId);throw new OrderInventoryPreconditionError(`${item?.name??row.itemId} 재고가 부족합니다. 현재 ${row.current}, 다른 주문 예약 ${row.other}, 이번 주문 ${row.required}`);}

      ids.forEach((itemId, index) => {
        const data = snapshots[index]!.data() ?? {};
        const active = activeByItem.get(itemId) ?? [];
        const qty = quantities.get(itemId) ?? 0;
        const next = qty > 0
          ? [...active, { operationId, orderId: order.id, qty, createdAt, state: 'processing' as const,...(generation?{generation}:{}) }]
          : active;
        // 만료되었거나 같은 작업의 낡은 예약도 이 transaction에서 걷어낸다.
        if (qty > 0 || Array.isArray(data.inventoryReservations)) {
          tx.update(refs[index]!, protectItemInventoryPatch(data,{ inventoryReservations: next }));
        }
      });

      if(current)tx.update(current.ref,protectInventoryWriterPatch(current.order,{inventoryOperation:{...current.order.inventoryOperation!,stage:advanceOrderInventoryStage(current.order.inventoryOperation?.stage,'reservation')}}));
      return {
        operationId,
        orderId: order.id,
        ...(generation?{generation}:{}),
        itemIds: ids,
        quantities,
        stockSnapshot: available,
        previousReservations,
        active: true,
      };
    });
  };

  /** 역방향 전환에서도 그 주문의 출고 전 배정을 최종 재고 저장과 함께 지우기 위한 문맥. */
  const orderStockReservationCleanup = (
    order: Pick<Order, 'id' | 'items'>,
    extraItemIds: readonly string[] = [],
  ): OrderStockReservation => ({
    operationId: '',
    orderId: order.id,
    itemIds: [...new Set([...orderStockTouchedIds(order, bomIndex), ...extraItemIds])],
    quantities: new Map(),
    stockSnapshot: new Map(),
    previousReservations: new Map(),
    active: false,
  });

  /** 원료 작업 등이 실패해 최종 재고 반영까지 가지 못한 예약을 풀어 준다. */
  const releaseOrderStockReservation = async (reservation: OrderStockReservation): Promise<void> => {
    const generation=reservation.generation;assertActor(generation);
    if (reservation.itemIds.length === 0&&!generation) return;
    const nowMs = Date.now();
    await runInventoryWriterTransaction(db,await captureInventoryWriterContext(db,{requestIdentity:rawPressText({generation,operationId:reservation.operationId,orderId:reservation.orderId,action:'release'}),companyId:generation?.companyId,isStillCurrent:()=>{assertActor(generation);return true;}}), async tx => {
      if(generation)await readGeneration(tx,generation,true);
      const refs = reservation.itemIds.map(itemId => doc(db, 'items', itemId));
      const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
      assertActor(generation);
      if(generation&&snapshots.some(snapshot=>!snapshot.exists()||snapshot.data()?.companyId!==generation.companyId))throw Error('예약 복원 품목의 명시 회사·원문을 확인해 주세요.');
      if(generation&&snapshots.some(snapshot=>liveItemInventoryReservations(snapshot.data()?.inventoryReservations,nowMs).some(row=>row.orderId===reservation.orderId&&(row.operationId!==reservation.operationId||!sameOrderInventoryGeneration((row as ItemInventoryReservation&{generation?:OrderInventoryGeneration}).generation,generation)))))throw Error('같은 주문의 다른 세대 예약은 복원하지 않습니다.');
      snapshots.forEach((snapshot, index) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data() ?? {};
        const active = liveItemInventoryReservations(data.inventoryReservations, nowMs);
        const hasCurrent = active.some(row => row.orderId === reservation.orderId && row.operationId === reservation.operationId);
        if (!hasCurrent) return;
        const otherOrders = active.filter(row => row.orderId !== reservation.orderId);
        const previous = reservation.previousReservations.get(reservation.itemIds[index]!) ?? [];
        tx.update(refs[index]!, protectItemInventoryPatch(data,{ inventoryReservations: [...otherOrders, ...previous] }));
      });
    });
  };

  const applyItemStockDeltas = async (
    deltas: ReadonlyMap<string, number>,
    lotMutations: readonly OrderProductLotMutation[] = [],
    reservation?: OrderStockReservation,
    orderMutation?: { orderId: string; generation?:OrderInventoryGeneration; expectedOrderText?:string; expectedProductionRecordIndex?:NonNullable<Order['productionRecordIndex']>; patch: Record<string, unknown> | ((consumedLots: NonNullable<Order['productConsumedLots']>) => Record<string, unknown>) },
  ): Promise<NonNullable<Order['productConsumedLots']>> => {
    const generation=orderMutation?.generation??reservation?.generation;
    const validateFinalPatch=(patch:Record<string,unknown>)=>{
      if(generation&&Object.keys(patch).some(key=>key==='productionRecordIndex'||key.startsWith('productionRecordIndex.')))throw Error('생산기록 연결은 최종 재고 패치로 변경할 수 없습니다.');
    };
    if(generation&&orderMutation?.expectedProductionRecordIndex!==undefined)validateProductionRecordIndex(orderMutation.expectedProductionRecordIndex,generation.companyId,generation.orderId);
    if(generation&&(!orderMutation||orderMutation.orderId!==generation.orderId||typeof orderMutation.expectedOrderText!=='string'||!orderMutation.expectedOrderText))throw Error('재고 확정 주문과 최초 세대가 다릅니다.');
    assertActor(generation);
    const reservationData=reservation?{operationId:reservation.operationId,orderId:reservation.orderId,generation:reservation.generation,itemIds:[...reservation.itemIds].sort(),quantities:[...reservation.quantities].sort(([a],[b])=>a.localeCompare(b)),allocationQuantities:reservation.allocationQuantities?[...reservation.allocationQuantities].sort(([a],[b])=>a.localeCompare(b)):null}:undefined;
    const reservationEvidence={reservation:reservationData,expectedOrderText:orderMutation?.expectedOrderText,...(orderMutation?.expectedProductionRecordIndex!==undefined?{expectedProductionRecordIndex:orderMutation.expectedProductionRecordIndex}:{})};
    const lotMutationByItem = new Map<string, OrderProductLotMutation>();
    for (const mutation of lotMutations) {
      if (lotMutationByItem.has(mutation.itemId)) {
        throw new Error(`한 주문에서 같은 품목의 로트 변경이 중복되었습니다: ${mutation.itemId}`);
      }
      lotMutationByItem.set(mutation.itemId, mutation);
    }
    const itemIds = new Set([
      ...[...deltas].filter(([, delta]) => delta !== 0).map(([itemId]) => itemId),
      ...lotMutationByItem.keys(),
      ...(reservation?.itemIds ?? []),
    ]);
    const rows = [...itemIds]
      .map(itemId => ({
        itemId,
        delta: deltas.get(itemId) ?? 0,
        lotMutation: lotMutationByItem.get(itemId),
        item: allItems.find(item => item.id === itemId),
      }));
    if (rows.length === 0&&!generation) {
      if (orderMutation) await runInventoryWriterTransaction(db,await captureInventoryWriterContext(db,{requestIdentity:rawPressText({orderId:orderMutation.orderId,patch:orderMutation.patch})}), async tx => {
        const ref=doc(db,'orders',orderMutation.orderId),snap=await tx.get(ref);if(!snap.exists())throw Error('주문을 찾을 수 없습니다.');
        tx.update(ref,protectInventoryWriterPatch(snap.data(),stripUndefined(typeof orderMutation.patch === 'function' ? orderMutation.patch([]) : orderMutation.patch)));
      });
      return [];
    }

    const missingCatalog = rows.filter(row => !row.item).map(row => row.itemId);
    if (missingCatalog.length > 0) {
      throw new Error(`재고 반영 중 품목 기준정보를 찾을 수 없습니다: ${missingCatalog.join(', ')}`);
    }

    const changed = await runInventoryWriterTransaction(db,await captureInventoryWriterContext(db,{requestIdentity:rawPressText({generation,deltas:[...deltas],lotMutations,reservationId:reservation?.operationId,rows}),companyId:generation?.companyId,isStillCurrent:()=>{assertActor(generation);return true;}}), async tx => {
      let current:{ref:ReturnType<typeof doc>;order:Order}|null=null;
      if(generation){
        assertActor(generation);const ref=doc(db,'orders',generation.orderId),snap=await tx.get(ref);if(!snap.exists())throw Error('주문을 찾을 수 없습니다.');
        const order={...snap.data(),id:generation.orderId} as Order;assertActor(generation);
        if(orderMutation!.expectedProductionRecordIndex!==undefined){
          if(!Object.prototype.hasOwnProperty.call(order,'productionRecordIndex')||order.productionRecordIndex===undefined)throw Error('확정한 생산기록 연결 필드가 없습니다.');
          if(rawPressText(order.productionRecordIndex)!==rawPressText(orderMutation!.expectedProductionRecordIndex))throw Error('최종 확정 전에 생산기록 연결이 변경되었습니다.');
          validateProductionRecordIndex(order.productionRecordIndex,generation.companyId,generation.orderId);
        }
        if(hasOrderInventoryGenerationCompletion(order,generation)){
          if(order.inventoryOperation!=null)throw Error('완료 뒤 다른 작업 표식이 있어 이전 확정을 성공으로 처리하지 않았습니다.');
          const marker=order.inventoryGenerationCompletion!,patch=typeof orderMutation!.patch==='function'?orderMutation!.patch(marker.consumedLots):orderMutation!.patch;
          validateFinalPatch(patch);
          if(finalOrderInventoryRequestText(generation,deltas,lotMutations.map(row=>row.itemId),patch,reservationEvidence)!==marker.requestText)throw Error('같은 세대의 최종 재고 요청 원문이 다릅니다.');
          return marker.consumedLots;
        }
        assertOrderInventoryGeneration(order,generation);if(orderRawBatchOrderEvidence(order)!==orderMutation!.expectedOrderText)throw Error('같은 세대의 주문 원문이 변경되었습니다.');
        if(order.inventoryOperation?.productionRecordContractVersion===1&&['production-record','final-stock'].includes(order.inventoryOperation.stage!)&&orderMutation!.expectedProductionRecordIndex===undefined)throw Error('최초 생산기록 연결의 최종 확정 근거가 없습니다.');
        current={ref,order};
      }
      else if(orderMutation){const ref=doc(db,'orders',orderMutation.orderId),snap=await tx.get(ref);if(!snap.exists())throw Error('주문을 찾을 수 없습니다.');current={ref,order:{...snap.data(),id:orderMutation.orderId} as Order};}
      const refs = rows.map(row => doc(db, 'items', row.itemId));
      // Firestore transaction은 첫 write 전에 모든 read가 끝나야 한다.
      const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
      const missingDocs = rows.filter((_, index) => !snapshots[index]!.exists()).map(row => row.itemId);
      if (missingDocs.length > 0) {
        throw new Error(`재고 반영 중 품목 문서를 찾을 수 없습니다: ${missingDocs.join(', ')}`);
      }

      assertActor(generation);
      if(generation&&snapshots.some(snapshot=>snapshot.data()?.companyId!==generation.companyId))throw Error('재고 확정 품목의 명시 회사가 다릅니다.');
      const updates = rows.map((row, index) => {
        const data = snapshots[index]!.data() ?? {};
        const before = Number(data.stock ?? 0);
        const lotResult = row.lotMutation?.apply(Array.isArray(data.lots) ? data.lots : [], before);
        const patch: { stock?: number; lots?: unknown[]; inventoryReservations?: ItemInventoryReservation[] } = {};
        if (row.delta !== 0) {
          patch.stock = stock3(before + row.delta);
          if (row.delta < 0 && patch.stock < 0) {
            throw new OrderInventoryPreconditionError(`${row.item!.name} 재고가 부족합니다. 현재 ${before}, 차감 ${stock3(-row.delta)}`);
          }
        }
        if (lotResult) {
          const beforeLots = new Map((Array.isArray(data.lots) ? data.lots : [])
            .map((lot: { id: string; qtyRemaining?: number }) => [lot.id, Number(lot.qtyRemaining ?? 0)]));
          const worsened = lotResult.lots.find(lot =>
            Number(lot.qtyRemaining ?? 0) < 0 &&
            Number(lot.qtyRemaining ?? 0) < (beforeLots.get(lot.id) ?? 0));
          if (worsened) {
            throw new OrderInventoryPreconditionError(`${row.item!.name} 로트 재고가 부족합니다: ${worsened.lotNo ?? worsened.id}`);
          }
        }
        if (lotResult) patch.lots = stripUndefined(pruneDepletedLots(lotResult.lots));
        if (reservation) {
          const next = liveItemInventoryReservations(data.inventoryReservations, Date.now())
            .filter(entry => entry.orderId !== reservation.orderId);
          const allocatedQty = reservation.allocationQuantities?.get(row.itemId) ?? 0;
          if (allocatedQty > 0) {
            next.push({
              operationId: reservation.operationId,
              orderId: reservation.orderId,
              qty: stock3(allocatedQty),
              createdAt: new Date().toISOString(),
              state: 'allocated',
              ...(generation?{generation}:{}),
            });
          }
          if (allocatedQty > 0 || Array.isArray(data.inventoryReservations)) {
            patch.inventoryReservations = next;
          }
        }
        return {
          ...row,
          before,
          after: patch.stock ?? before,
          consumedLots: lotResult?.consumedLots ?? [],
          patch,
          ref: refs[index]!,
        };
      });
      const consumed=updates.flatMap(row=>row.consumedLots),patch=orderMutation?(typeof orderMutation.patch==='function'?orderMutation.patch(consumed):orderMutation.patch):null;
      if(patch)validateFinalPatch(patch);
      if(generation)validateOrderInventoryConsumedLots(consumed);
      const requestText=generation?finalOrderInventoryRequestText(generation,deltas,lotMutations.map(row=>row.itemId),patch!,reservationEvidence):null;
      if(generation&&patch?.inventoryOperation!=null)throw Error('최종 확정에서 다른 작업 표식을 만들 수 없습니다.');
      assertActor(generation);
      for(const [index,update] of updates.entries())if(Object.keys(update.patch).length>0)tx.update(update.ref,protectItemInventoryPatch(snapshots[index].data(),update.patch));
      if(current&&generation)tx.update(current.ref,protectInventoryWriterPatch(current.order,stripUndefined({...patch,inventoryOperation:null,inventoryGenerationCompletion:{generation,completedAt:new Date().toISOString(),requestText,consumedLotsText:rawPressText(consumed),consumedLots:consumed}})));
      else if(current&&orderMutation)tx.update(current.ref,protectInventoryWriterPatch(current.order,stripUndefined(patch!)));
      return consumed;
    });

    return changed;
  };

  return {
    reserveOrderStock,
    orderStockReservationCleanup,
    releaseOrderStockReservation,
    applyItemStockDeltas,
  };
}
