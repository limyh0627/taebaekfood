import type {InventoryReferenceGuard,InventoryReferenceToken,InventoryNewSendGuard} from '../../shared/hooks/useInventoryReferenceGuard';
import {createOrderProductionPlanner,addDelta,type StockUseChoice,type StockUsePlan} from '../../shared/orderProductionPlanner';
export {perUnitOilKg} from '../../shared/orderProductionPlanner';
export type {StockUseChoice,StockUsePlan} from '../../shared/orderProductionPlanner';
import { isStockProduction } from '../../shared/orderPurpose';
import { prepareOrderInventoryCancellation, executeOrderInventoryCancellation, readOrderCancellationReceipt, type CancellationTicket, type CancellationAction } from './orderInventoryCancellation';
import { doc, getDoc, getDocFromServer, Firestore } from 'firebase/firestore';
import { isGoodsItem, holdsUnitStock } from '../../shared/itemTaxonomy';
import { goodsShipQty } from '../../shared/shipDeduction';
import { bomOf, getBomIndex } from '../../shared/bomIndex';
import { Order, OrderItem, Item, OrderStatus, AppNotification, Partner, OrderInventorySnapshot, OrderStatusAudit, OrderItemInventoryState, companyOf } from '../../shared/types';
import { runRawInventoryJob } from '../../shared/services/rawInventoryJob';
import { stockUnits, type OrderUnitInputs } from '../../shared/orderUnits';
import { getPackIndex } from '../../shared/packIndex';
import {dateOfLocal} from '../../shared/day';
import type { CollectionName } from '../../shared/collections';
import { buildRollbackPlan, type RollbackPlan } from './rollbackSummary';
import { canResumeFailedInventoryOperation, hasCompleteOrderItems, isWorkCompletedState, requiresCompleteItemsForStatusChange, workStatusFromItems } from '../../shared/orderCompletion';
import { applyOrderAtomicRawPlan,buildOrderRawCommands,buildOrderRawReversalPlan, createOrderRawInventoryOperations, rawLedgerDocIds } from './orderRawInventory';
import {generationFromOrder,hasOrderInventoryGenerationCompletion,type OrderInventoryGeneration} from '../../shared/orderInventoryGeneration';
import {clearOrderRawBatchAttempt,orderRawBatchOrderEvidence,readOrderRawBatchAttempt} from '../../shared/orderRawBatchAttempt';
import {rawPressText} from '../../shared/rawPressAttempt';
import {deriveNextProductionRecordIndex,validateOrderProductionRecordPlan,type OrderProductionRecordPlan} from '../../shared/orderProductionRecordPlan';
import { combineProductLotMutations, createOrderProductLotOperations, OrderInventoryPreconditionError,productionProductLotMutation, productionProductLots, reverseProductionProductLots, type OrderProductLotMutation } from './orderProductLots';
import { OrderReservationExecutionConflictError,createOrderItemStockOperations, orderStockTouchedIds } from './orderItemStock';
import { inspectOrderProduction, OrderProductionPreflightError } from './orderProductionPreflight';
import { aggregateOrderLineInventory, ensureOrderLineIds, completedLineAllocation as sharedCompletedLineAllocation } from '../../shared/orderLineInventory';

export interface OrderStatusChangeContext {
  referenceToken?:InventoryReferenceToken;
  approvedBy?: string;
  approvedAt?: string;
  approvedPlan?: RollbackPlan;
  approvedFromStatus?: OrderStatus;
  orderPatch?: Partial<Order>;
}

export interface PreparedOrderStatusChange {
  order: Order;
  plan: RollbackPlan;
}

/**
 * 생산/출고 분리 재고 엔진 (도메인 모듈).
 *  작업완료(DISPATCHED) = 생산처리: 완제품 원료·부자재 차감 + 완제품 재고 +생산분 (상품은 미변동)
 *  출고(SHIPPED)        = 완제품/상품 재고 −주문량
 *
 *  생산분은 **주문량 − 기존 재고로 충당한 몫**이다. 재고가 넉넉하면 생산이 0이고 출고만 빠져
 *  재고가 실제로 줄어든다(전에는 +주문량/−주문량이 상쇄돼 박스 재고가 그대로 남았다).
 *  얼마나 충당할지는 화면에서 사용자가 고른다 → StockUsePlan.
 *  되돌리기 = 뺀 만큼 그대로 복원(원료는 rawConsumedLots 스냅샷으로 로트에 +).
 *  reconcileOrderStock(order, target)이 목표 상태에 맞춰 자동 조정 → changeOrderStatus가 진입점.
 *
 * AdminApp에서 매 렌더 시점의 데이터·쓰기 함수를 주입해 생성한다(순수 로직 + 의존성 주입).
 */
export interface OrderStockEngineDeps {
  referenceGuard?:InventoryReferenceGuard;
  orderUnitInputs?: OrderUnitInputs;
  /**
   * **지금 이 일을 하는 사람** — 자동으로 찍히는 원료 원장 줄에 `addedBy` 로 남는다.
   *
   * 여태 자동 줄에는 아무 이름도 안 적혔다(2026-09-07 사장님: "누가했는지 하나도 안 나오내").
   * 손으로 넣는 길은 전부 이름을 남기는데 **제일 많은 자동 길만 비어 있었다** —
   * 재고가 왜 빠졌는지 되짚을 때 물어볼 사람이 없다.
   * 자동이라도 **버튼은 사람이 누른다.** 누른 사람을 적는다.
   */
  actorName?: string;
  getActorUid?:()=>string|undefined;
  allItems: Item[];
  submaterials: Item[];
  partners: Partner[];
  allOrders: Order[];
  orders: Order[];
  db: Firestore;
  buildFormula: (prodKey: string) => { raw: string; ratio: number }[];
  /** gen0 시험 주입만 호환한다. 실제 Admin은 새 순수 계획을 제공한다. */
  createProductionRecordsForOrder?: (order: Order, inputs?: OrderUnitInputs) => Promise<void>;
  createProductionRecordPlan?:(order:Order,inputs:OrderUnitInputs|undefined,generation:OrderInventoryGeneration)=>OrderProductionRecordPlan;
  updateItem: (collection: CollectionName, id: string, data: Record<string, any>) => Promise<any>;
  addItem: (collection: CollectionName, data: Record<string, any>) => Promise<any>;
  claimOrderOperation?: (orderId: string, expectedStatus: OrderStatus, operation: NonNullable<Order['inventoryOperation']>,referenceGuard?:InventoryNewSendGuard) => Promise<Order>;
  retireRetainedRequestBeforeClaim?:(order:Order)=>Promise<void|'archived-only'>;
  /** 시험에서는 인메모리 job을 주입한다. 운영 기본값은 공용 원자화 job 러너다. */
  runRawInventoryJob?: typeof runRawInventoryJob;
}

/** 처리 중인 주문 id — 같은 주문의 상태 변경이 겹쳐 들어오는 것을 막는다(중복 차감 방지).
 *  엔진은 렌더마다 새로 만들어지므로 모듈 스코프에 둬야 인스턴스 간에도 공유된다. */
const inFlightOrders = new Set<string>();

/** 구성품에 완제품이 있는가 — 박스·세트·재포장. 그 완제품이 자기 원료를 지니므로
 *  이런 품목에 품목 원료식을 또 적용하면 원료가 두 번 빠진다. */
export const hasProductComponent = (
  product: Pick<Item, 'id'> | undefined,
): boolean => bomOf(product?.id).some(l => l.child?.type === 'product' || l.child?.type === '완제품');

//  판정은 [itemTaxonomy](../../shared/itemTaxonomy.ts) 로 옮겼다(2026-09-15) — 여기서 받아 넘긴다.
//  이 이름으로 끌어다 쓰는 자리가 여럿이라 내보내기는 그대로 둔다.
export { isGoodsItem };

function createScopedOrderStockEngine(deps: OrderStockEngineDeps, inputs: OrderUnitInputs) {
  const bomOf = (id: string | undefined) => id ? inputs.bom.of(id) : [];
  const { actorName, allItems, submaterials, partners, allOrders, orders, db,
    buildFormula, createProductionRecordsForOrder,createProductionRecordPlan, updateItem, addItem,
    claimOrderOperation, runRawInventoryJob: runRawJob = runRawInventoryJob } = deps;
  const {planOrderProduction,accrueBom,shipOrder,unShipOrder}=createOrderProductionPlanner({allItems,inputs,buildFormula});
  let actorAuth:typeof import('../../shared/firebase').auth|undefined;
  const ensureGenerationActor=async(generation:OrderInventoryGeneration|null)=>{if(generation&&!deps.getActorUid)actorAuth=(await import('../../shared/firebase')).auth;};
  const clearOrderInventoryGeneration:typeof import('../../shared/services/firebaseService').clearOrderInventoryGeneration=async(...args)=>(await import('../../shared/services/firebaseService')).clearOrderInventoryGeneration(...args);
  const guardedUpdateOrderInventoryGeneration:typeof import('../../shared/services/firebaseService').guardedUpdateOrderInventoryGeneration=async(...args)=>(await import('../../shared/services/firebaseService')).guardedUpdateOrderInventoryGeneration(...args);
  const markOrderInventoryGenerationFailed:typeof import('../../shared/services/firebaseService').markOrderInventoryGenerationFailed=async(...args)=>(await import('../../shared/services/firebaseService')).markOrderInventoryGenerationFailed(...args);
  const { applyOrderRawUsage } = createOrderRawInventoryOperations({
    actorName, allItems, partners, db,
    addNotification: notification => addItem('notifications', notification),
    runRawInventoryJob: runRawJob,
  });
  const {
    reserveOrderStock,
    orderStockReservationCleanup,
    releaseOrderStockReservation,
    applyItemStockDeltas,
  } = createOrderItemStockOperations({ db, allItems, bomIndex: inputs.bom,getActorUid:deps.getActorUid??(()=>actorAuth?.currentUser?.uid) });
  const generationOf=(order:Order)=>generationFromOrder(order);
  const requireLegacyOrder=(order:Order)=>{if(Object.prototype.hasOwnProperty.call(order,'orderProductionRefsV1'))throw Error('이 주문은 부분 생산 방식으로 관리됩니다. 주문의 생산·출고 작업에서 다시 확인해 주세요.');};
  const readConfirmedGen0Order=async(orderId:string)=>{const snap=await getDocFromServer(doc(db,'orders',orderId));if(snap.metadata?.fromCache!==false||snap.metadata?.hasPendingWrites!==false)throw Error('서버에서 확정된 원주문을 확인할 수 없어 자동 재생산하지 않았습니다.');return snap;};
  const retireRetainedRequestBeforeClaim=deps.retireRetainedRequestBeforeClaim??(async(order:Order)=>(await import('../../shared/services/orderRequestRetirementService')).retireRetainedOrderRequestBeforeClaim(order));
  const expectedRecordIndex=async(generation:OrderInventoryGeneration,fallback:Order['productionRecordIndex'])=>{
    const first=readOrderRawBatchAttempt(generation.companyId,generation.actorUid,generation.orderId);
    if(!first)return fallback;
    const plan=first.request.plan.productionRecords as OrderProductionRecordPlan;
    validateOrderProductionRecordPlan(plan);
    const {orderRawBatchRequestHash}=await import('../../shared/services/orderRawBatchService');
    return deriveNextProductionRecordIndex(plan,await orderRawBatchRequestHash(first.request));
  };
  const fixedTime=(order:Order)=>generationOf(order)?.startedAt??new Date().toISOString();
  const plain=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
  const rawItemSelectionText=(items:readonly OrderItem[])=>rawPressText(items.map(row=>({itemId:row.itemId,lineId:row.lineId,quantity:row.quantity,boxQuantity:row.boxQuantity,checked:row.checked})));
  const requireRecordContract=(order:Order,generation:OrderInventoryGeneration|null)=>{
    if(generation&&order.inventoryOperation?.productionRecordContractVersion!==1)throw Error('이전 작업에는 최초 생산기록 계약이 없습니다. 원문을 보존했습니다.');
    if(generation&&!createProductionRecordPlan)throw Error('최초 생산기록 계획 제공자가 없어 원료를 쓰지 않았습니다.');
    if(!generation&&!createProductionRecordsForOrder)throw Error('옛 생산기록 경로는 지원하지 않습니다. 원료를 쓰지 않았습니다.');
  };
  const recordPlan=(order:Order,generation:OrderInventoryGeneration,stored?:unknown)=>{
    const plan=stored as OrderProductionRecordPlan|undefined;
    if(stored===undefined)throw Error('이전 원료 요청에는 최초 생산기록 계획이 없습니다. 새 원문을 추정하지 않았습니다.');
    validateOrderProductionRecordPlan(plan!);if(rawPressText(plan!.generation)!==rawPressText(generation))throw Error('최초 생산기록 계획의 세대가 다릅니다.');return plan!;
  };
  const writeProductionRecords=async(request:Parameters<typeof import('../../shared/services/orderProductionRecordService').executeOrderProductionRecords>[0])=>{
    const result=await (await import('../../shared/services/orderProductionRecordService')).executeOrderProductionRecords(request);
    if(result.status==='blocked')throw Error(result.reason??'생산기록 완료를 확인하지 못했습니다.');return result;
  };
  const saveReservation=(value:NonNullable<Awaited<ReturnType<typeof reserveOrderStock>>>)=>{const {executionEvidence,...business}=value;return plain({...business,quantities:[...value.quantities],stockSnapshot:[...value.stockSnapshot],previousReservations:[...value.previousReservations],allocationQuantities:value.allocationQuantities?[...value.allocationQuantities]:[]});};
  const restoreReservation=(value:ReturnType<typeof saveReservation>)=>({...value,quantities:new Map(value.quantities),stockSnapshot:new Map(value.stockSnapshot),previousReservations:new Map(value.previousReservations),allocationQuantities:new Map(value.allocationQuantities)}) as NonNullable<Awaited<ReturnType<typeof reserveOrderStock>>>;
  /** 원장 줄에 붙일 작성자 — 빈 이름은 아예 안 적는다(Firestore 에 빈 칸을 만들지 않는다) */
  const 작성자 = actorName ? { addedBy: actorName } : {};
  const deltaRows = (m: Map<string, number>) => [...m]
    .filter(([, delta]) => delta !== 0)
    .map(([itemId, delta]) => ({ itemId, delta: Math.round(delta * 1000) / 1000 }));
  type FrozenProductLots={operationId:string;catalog:Item[];mutationItemIds:string[];negative:{itemId:string;delta:number}[];positive:{itemId:string;lot:NonNullable<Item['lots']>[number]}[]};
  const freezeProductLots=(deltas:Map<string,number>,operationId:string,time:string):FrozenProductLots=>{
    const built=productionProductLots(allItems,deltas,operationId,inputs);
    const positive=built.mutations.filter(row=>(deltas.get(row.itemId)??0)>0).map(row=>{
      const lot=row.apply([],0).lots.find(lot=>lot.id===`production-${operationId}-${row.itemId}`)!;
      return {itemId:row.itemId,lot:{...lot,createdAt:time,receivedDate:dateOfLocal(time)}};
    });
    return plain({operationId,mutationItemIds:built.mutations.map(row=>row.itemId),catalog:allItems.filter(item=>deltas.has(item.id)).map(item=>({id:item.id,type:item.type,name:item.name})),negative:deltaRows(new Map([...deltas].filter(([,qty])=>qty<0))),positive}) as FrozenProductLots;
  };
  const replayProductLots=(frozen:FrozenProductLots)=>{
    const negative=productionProductLots(frozen.catalog,new Map(frozen.negative.map(row=>[row.itemId,row.delta])),frozen.operationId,inputs);
    const positive=frozen.positive.map(({itemId,lot})=>productionProductLotMutation(itemId,lot));
    return {mutations:[...negative.mutations,...positive],traces:frozen.positive.map(({itemId,lot})=>({itemId,lotId:lot.id,qty:lot.qtyIn??0})),consumedLots:negative.consumedLots};
  };
  const bomSnapshotOf = (order: Order): OrderInventorySnapshot['bomLines'] => orderStockTouchedIds(order, inputs.bom).flatMap(parentItemId =>
    bomOf(parentItemId).map(line => ({ parentItemId, childItemId: line.childId, quantity: line.qty }))
  );

  /** claim 앞에서도 예약과 실제 생산의 공용 셈을 쓴다. 역변경은 기존 저장 스냅샷 경로다. */
  const preflightProduction = async (order:Order, rows:readonly {item:OrderItem;index:number}[], plan?:StockUsePlan, selectedIndex?:number) => {
    const targets={...order,items:rows.map(row=>row.item)};
    const extra=Object.values(order.itemInventory??{}).flatMap(state=>state.production.stockDeltas.map(row=>row.itemId));
    const problems=await inspectOrderProduction({db,order,itemIds:[...orderStockTouchedIds(order,inputs.bom),...extra],preserveOwnAllocation:selectedIndex!==undefined,
      preview:stock=>{
        const deltas=new Map<string,number>(),commands:import('../../shared/services/rawInventoryJob').JobCommandInput[]=[],mutations:OrderProductLotMutation[]=[];
        if(selectedIndex===undefined){
          const production=planOrderProduction(targets,deltas,stock,plan);
          commands.push(...buildOrderRawCommands({order:targets,physicalUsage:production.rawUsage,ledgerOnlyUsage:production.rawUsageLedgerOnly,attempt:(order.rawInventoryAttempt??0)+1,allItems,partners,actorName}).commands);
          mutations.push(...productionProductLots(allItems,deltas,'preflight-'+order.id,inputs).mutations);
          if(!isStockProduction(order))shipOrder(targets,deltas);
        }else{
          const allocated=new Map<string,number>();
          for(const row of rows){
            const single={...order,items:[row.item]},before=new Map(deltas);
            const production=planOrderProduction(single,deltas,stock,row.index===selectedIndex?plan:undefined,allocated);
            const difference=new Map<string,number>();for(const [id,value] of deltas)addDelta(difference,id,value-(before.get(id)??0));
            mutations.push(...productionProductLots(allItems,difference,'preflight-'+order.id+'-'+row.item.lineId,inputs).mutations);
            commands.push(...buildOrderRawCommands({order:single,physicalUsage:production.rawUsage,ledgerOnlyUsage:production.rawUsageLedgerOnly,attempt:(order.itemInventory?.[row.item.lineId!]?.attempt??0)+1,lineId:row.item.lineId,allItems,partners,actorName}).commands);
          }
          if(!isStockProduction(order))for(const row of rows)shipOrder({...order,items:[row.item]},deltas);
        }
        return {deltas,commands,lotMutations:mutations};
      }});
    if(problems.length)throw new OrderProductionPreflightError(problems);
  };

  // 생산처리(작업완료): 원료·부자재 차감 + 완제품 재고 +(생산분). → 소비 로트 스냅샷 반환.
  // 순변화 = 쓴 재고만큼. 얼마나 쓸지는 plan(사용자 선택)이 정하고, 없으면 있는 만큼 다 쓴다.
  const produceOrder = async (
    order: Order,
    deltas: Map<string, number>,
    stockSnapshot: ReadonlyMap<string, number>,
    plan?: StockUsePlan,
    reservationDeltas?:{itemId:string;delta:number}[],
    finalPlan?:Record<string,unknown>,
    onStage?:(stage:NonNullable<Order['inventoryOperation']>['stage'])=>void,
  ) => {
    // **같은 주문은 원료를 한 번만 뺀다.**
    //   원장 줄은 id가 `rm-auto-{주문}-{원료}`로 고정이라 두 번째 처리 때 덮어써지는데,
    //   로트는 mutateRawMaterialLots가 부를 때마다 깎아서 한쪽만 이중이 됐다.
    //   (생들기름 775.98kg = 8/04 277.2 + 8/05 249.48 + 8/14 249.3 세 건이 각각 두 번씩 빠졌다)
    //   바깥 가드(`wantProduced && !order.producedAt`)는 **화면 상태**를 보므로 다른 탭·중복 클릭으로
    //   낡으면 그냥 통과한다 — 재고 음수를 만들던 것과 같은 낡은-상태 문제다.
    //   → DB의 지금 값을 직접 보고 이미 완료했으면 중복을 막는다.
    //     구형 부분 생산은 분리 거래로 되돌리지 않고 원문 확인을 요청한다.
    const fresh = generationOf(order)?await getDoc(doc(db, 'orders', order.id)):await readConfirmedGen0Order(order.id);
    if(!fresh.exists()&&!generationOf(order))throw Error('원주문을 확인할 수 없어 자동 재생산하지 않았습니다.');
    const freshOrder = fresh.exists() ? ({ ...order, ...(fresh.data() as Partial<Order>) } as Order) : order;
    if (freshOrder.producedAt) {
      return {
        consumedLots: freshOrder.rawConsumedLots ?? [],
        autoBuilt: freshOrder.autoBuilt ?? [],
        producedUnits: freshOrder.producedUnits ?? [],
        attempt: freshOrder.rawInventoryAttempt ?? 0,
        alreadyProduced: true,
        rawCalculationEvidence: freshOrder.inventorySnapshots?.production?.rawCalculationEvidence,
        productionDeltas: undefined,
        frozenProductLots:undefined,firstBomLines:undefined,frozenShipment:undefined,
      };
    }
    const already = freshOrder.rawConsumedLots ?? [];
    const generation=generationOf(freshOrder);
    requireRecordContract(freshOrder,generation);
    if(generation&&already.length)throw Error('기존 부분 생산의 원료 근거를 새 일괄 작업으로 자동 보완하지 않습니다.');
    if(!generation&&already.length)throw Error('기존 생산 근거가 남아 자동 재생산하지 않았습니다. 원주문과 원료 처리 결과를 확인해 주세요.');
    const retained=generation?readOrderRawBatchAttempt(generation.companyId,generation.actorUid,generation.orderId):null;
    if(generation&&retained)recordPlan(freshOrder,generation,retained.request.plan.productionRecords);
    const attempt = retained?Number(retained.request.plan.attempt):(freshOrder.rawInventoryAttempt ?? 0) + 1;
    const beforeProduction = new Map(deltas);
    let production = retained?retained.request.plan.production as ReturnType<typeof planOrderProduction>:planOrderProduction(freshOrder, deltas, stockSnapshot, plan);
    const productionDeltas = new Map<string, number>();
    for (const [itemId, value] of deltas) addDelta(productionDeltas, itemId, value - (beforeProduction.get(itemId) ?? 0));
    if(retained)for(const row of retained.request.plan.productionDeltas as {itemId:string;delta:number}[]){addDelta(deltas,row.itemId,row.delta);addDelta(productionDeltas,row.itemId,row.delta);}
    let consumedLots:NonNullable<Order['rawConsumedLots']>;
    onStage?.('raw-inventory');
    let frozenProductLots:FrozenProductLots|undefined,firstBomLines:OrderInventorySnapshot['bomLines']|undefined;
    let frozenShipment:{itemId:string;delta:number}[]|undefined;
    if(generation){
      const built=retained?{commands:retained.request.commands}:buildOrderRawCommands({order:freshOrder,physicalUsage:production.rawUsage,ledgerOnlyUsage:production.rawUsageLedgerOnly,attempt,allItems,partners,actorName});
      const shipment=new Map<string,number>();if(!retained)shipOrder(freshOrder,shipment);
      const productLots=retained?.request.plan.productLots??freezeProductLots(productionDeltas,`${freshOrder.id}-${attempt}`,generation.startedAt);
      const normalizedItems=retained?.request.plan.normalizedItems??ensureOrderLineIds((finalPlan?.completionPatch as Partial<Order>|undefined)?.items??freshOrder.items);
      const productionRecords=retained?recordPlan(freshOrder,generation,retained.request.plan.productionRecords):createProductionRecordPlan!({...freshOrder,items:ensureOrderLineIds(freshOrder.items)},inputs,generation);
      validateOrderProductionRecordPlan(productionRecords);
      const shipped=[OrderStatus.SHIPPED,OrderStatus.DELIVERED].includes(freshOrder.inventoryOperation!.targetStatus!);
      const storedPlan=retained?.request.plan??plain({production,productionRecords,normalizedItems,productionDeltas:deltaRows(productionDeltas),reservationDeltas:reservationDeltas??[],attempt,productLots,bomLines:bomSnapshotOf(freshOrder),shipmentDeltas:deltaRows(shipment),finalPlan,finalLotItemIds:[...new Set([...(productLots as FrozenProductLots).mutationItemIds,...(shipped?deductProductLotsForOrder(freshOrder).map(row=>row.itemId):[])])]});
      const applied=await applyOrderAtomicRawPlan({order:freshOrder,generation,selection:plain({kind:'status',targetStatus:freshOrder.inventoryOperation!.targetStatus,stockUsePlan:plan??null}),plan:storedPlan,commands:built.commands,legacyJobIds:[`production:${freshOrder.id}:a${attempt}`]});
      production=applied.request.plan.production as typeof production;
      deltas.clear();beforeProduction.forEach((value,key)=>deltas.set(key,value));productionDeltas.clear();
      for(const row of applied.request.plan.productionDeltas as {itemId:string;delta:number}[]){addDelta(deltas,row.itemId,row.delta);addDelta(productionDeltas,row.itemId,row.delta);}
      consumedLots=applied.traces.flat();
      frozenProductLots=applied.request.plan.productLots as FrozenProductLots;firstBomLines=applied.request.plan.bomLines as OrderInventorySnapshot['bomLines'];frozenShipment=applied.request.plan.shipmentDeltas as typeof frozenShipment;
      onStage?.('production-record');await writeProductionRecords(applied.request);
    }else consumedLots=await applyOrderRawUsage(freshOrder,production.rawUsage,attempt,production.rawUsageLedgerOnly);
    if(!generation){onStage?.('production-record');await createProductionRecordsForOrder!(freshOrder, inputs);}
    return { consumedLots, ...production, attempt, alreadyProduced: false, productionDeltas,frozenProductLots,firstBomLines,frozenShipment };
  };

  // 생산처리 취소: BOM 구성품·원료 복원 + 완제품 재고 −(생산분). 먼저 만든 것도 되돌린다.
  //  **뺄 건 주문량이 아니라 그때 실제로 생산한 양**(producedUnits). 기존 재고로 충당했던 몫은
  //  애초에 만든 적이 없으니 되돌릴 것도 없다 — 출고취소가 이미 +주문량으로 되돌려 놨다.
  const unProduceOrder = async (order: Order, deltas: Map<string, number>) => {
    const drop: Record<string, number> = {};   // 복원 경로에선 원료를 다시 안 센다
    // producedUnits가 없는 옛 주문 = 주문량 전량을 생산하던 시절 → 그때 규칙대로 되돌린다.
    const produced = Array.isArray(order.producedUnits)
      ? order.producedUnits
      : order.items.map(item => {
          const p = allItems.find(x => x.id === item.itemId);
          return { itemId: item.itemId, qty: p ? stockUnits(item, p, inputs) : 0 };
        });
    for (const { itemId, qty } of produced) {
      const product = allItems.find(p => p.id === itemId);
      if (!product || !holdsUnitStock(product)) continue;
      if (product.procureType === '임가공') continue;   // 재고 미변동 — 수불부만 restore에서 지운다
      if (isGoodsItem(product)) continue;
      if (qty <= 0) continue;
      accrueBom(order, product, qty, deltas, drop, +1, []);
      addDelta(deltas, product.id, -qty); // 완제품 재고 되돌림
    }
    // 모자라서 먼저 만들었던 구성품 — 만든 만큼 빼고 그것의 BOM도 되돌린다
    for (const b of (order.autoBuilt ?? [])) {
      const comp = allItems.find(p => p.id === b.itemId);
      if (!comp) continue;
      addDelta(deltas, comp.id, -b.qty);
      accrueBom(order, comp, b.qty, deltas, drop, +1, [], 1);
    }
  };

  // ── 완제품 로트 ─────────────────────────────────────────────────────────
  //  박스에도 로트를 매겨 어느 로트가 어느 거래처로 나갔는지 남긴다(회수·클레임 역추적).
  //  재고 숫자는 종전대로 deltas가 움직이고, 로트는 **그 옆에서 같은 수량으로** 따라 빠진다.
  //  로트에 재고 권한을 주지 않는 이유: 실사·개봉·주문취소 등 재고를 건드리는 길이 여럿이라
  //  로트를 유일한 근거로 삼으면 아직 안 태운 경로에서 재고가 통째로 날아간다.
  //  대신 어긋나면 '이월(미상)' 버킷이 음수로 받아 **보이게** 둔다(벌크 로트와 같은 규칙).

  /** 출고 수량 — shipOrder와 같은 규칙이어야 로트와 재고가 안 갈린다. */
  const shipQtyOf = (item: OrderItem, product: Item) =>
    isGoodsItem(product) ? goodsShipQty(item, product, inputs)
      //  캔 같은 개수 반제품도 출고 때 빠진다 — 안 그러면 팔아도 재고가 그대로 남는다.
      : holdsUnitStock(product) ? stockUnits(item, product, inputs) : 0;

  const { deductProductLotsForOrder, restoreProductLotsForOrder } = createOrderProductLotOperations({
    allItems,
    shipQtyOf,
  });

  const STATUS_WANT_PRODUCED = new Set<OrderStatus>([OrderStatus.DISPATCHED, OrderStatus.SHIPPED, OrderStatus.DELIVERED]);
  const STATUS_WANT_SHIPPED = new Set<OrderStatus>([OrderStatus.SHIPPED, OrderStatus.DELIVERED]);

  // 목표 상태에 맞춰 재고 상태를 조정(생산/출고/취소 자동). ON_HOLD은 재고 미변동.
  const reconcileOrderStock = async (
    order: Order,
    target: OrderStatus,
    plan?: StockUsePlan,
    deferOrderPatch = false,
    inventoryOperationId?: string,
    completionPatch?: Record<string, unknown>,
    onStage?:(stage:NonNullable<Order['inventoryOperation']>['stage'])=>void,
    recovery?:{actorUid:string;now:string;after:Order},
  ) => {
    requireLegacyOrder(order);
    const generation=generationOf(order);
    const initialRecordIndex=order.productionRecordIndex===undefined?undefined:plain(order.productionRecordIndex);
    await ensureGenerationActor(generation);
    const capturedAt=recovery?.now??fixedTime(order);
    if (target === OrderStatus.ON_HOLD) return { patch: {} as Partial<Order>, stockAdjustments: [] as { itemId: string; delta: number }[] };
    const wantProduced = STATUS_WANT_PRODUCED.has(target);
    const wantShipped = !isStockProduction(order) && STATUS_WANT_SHIPPED.has(target);
    const isReversing=(!wantProduced&&!!order.producedAt)||(!wantShipped&&!!order.shippedOut);
    const deltas = new Map<string, number>();
    const patch: Partial<Order> = {};
    let productLotMutations: OrderProductLotMutation[] = [];
    let shipmentStockDeltas: { itemId: string; delta: number }[] | undefined;
    let firstShipmentDeltas:typeof shipmentStockDeltas;
    const needsForwardProduction = wantProduced && !order.producedAt;
    if(needsForwardProduction)requireRecordContract(order,generation);
    if(needsForwardProduction&&!generation){
      const fresh=await readConfirmedGen0Order(order.id);
      if(!fresh.exists())throw Error('원주문을 확인할 수 없어 자동 재생산하지 않았습니다.');
      const current=fresh.data() as Partial<Order>;
      if(!current.producedAt&&(current.rawConsumedLots??[]).length)throw Error('기존 생산 근거가 남아 자동 재생산하지 않았습니다. 원주문과 원료 처리 결과를 확인해 주세요.');
    }
    const needsForwardShipment = wantShipped && !order.shippedOut;
    const wantsAllocationUntilShipment = !isStockProduction(order) && wantProduced && !wantShipped;
    const reservationExtraItemIds = [
      ...(order.inventorySnapshots?.production?.stockDeltas.map(row => row.itemId) ?? []),
      ...(order.inventorySnapshots?.shipment?.stockDeltas.map(row => row.itemId) ?? []),
    ];
    const retained=generation?readOrderRawBatchAttempt(generation.companyId,generation.actorUid,order.id):null;
    if(generation&&retained)recordPlan(order,generation,retained.request.plan.productionRecords);
    const normalizedItems=generation?retained?.request.plan.normalizedItems as OrderItem[]|undefined??ensureOrderLineIds((completionPatch?.items as OrderItem[]|undefined)??order.items):undefined;
    const firstCompletionPatch=generation?retained?(retained.request.plan.finalPlan as {completionPatch:Record<string,unknown>}).completionPatch:{...completionPatch,items:normalizedItems}:completionPatch;
    let firstReservationDeltas:{itemId:string;delta:number}[]=[];
    onStage?.('reservation');
    const reservation = needsForwardProduction || needsForwardShipment || wantsAllocationUntilShipment
      ? await reserveOrderStock(
          order,
          inventoryOperationId ?? `order-inventory-${order.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          stockSnapshot => {
            if(retained){firstReservationDeltas=retained.request.plan.reservationDeltas as typeof firstReservationDeltas;return new Map(firstReservationDeltas.map(row=>[row.itemId,row.delta]));}
            const preview = new Map<string, number>();
            if (needsForwardProduction) {
              planOrderProduction(order, preview, stockSnapshot, plan);
            }
            // 작업완료 상태에서도 실제 출고 전까지 이 주문 전체 물량을 잡아 둔다.
            // 생산분을 더한 뒤 출고한다고 가정한 순변화가 지금 재고에서 선점할 몫이다.
            if (needsForwardShipment || wantsAllocationUntilShipment) shipOrder(order, preview);
            firstReservationDeltas=deltaRows(preview);
            return preview;
          },
          reservationExtraItemIds,
          generation?{generation}:undefined,
        )
      : undefined;
    if (reservation && wantsAllocationUntilShipment) {
      if(retained){const first=retained.request.plan.finalPlan as {reservation:ReturnType<typeof saveReservation>};reservation.allocationQuantities=new Map(first.reservation.allocationQuantities);}
      else{
      const shipment = new Map<string, number>();
      shipOrder(order, shipment);
      reservation.allocationQuantities = new Map(
        [...shipment].filter(([, delta]) => delta < 0).map(([itemId, delta]) => [itemId, -delta]),
      );
      }
    }
    const reservationContext = reservation ?? orderStockReservationCleanup(order, reservationExtraItemIds);
    if(recovery)reservationContext.recoveryActorUid=recovery.actorUid;
    let stockCommitted = false;
    let inventoryMayHaveChanged = false;
    let rawReversal:ReturnType<typeof buildOrderRawReversalPlan>;

    try {
      // 역방향(되돌리기): 출고취소 → 생산취소
      if (!wantShipped && order.shippedOut) {
        const snapshot = order.inventorySnapshots?.shipment;
        if (snapshot) snapshot.stockDeltas.forEach(row => addDelta(deltas, row.itemId, -row.delta));
        else unShipOrder(order, deltas);
        patch.shippedOut = false;
        productLotMutations = restoreProductLotsForOrder(order); patch.productConsumedLots = [];
      }
      if (!wantProduced && order.producedAt) {
        const snapshot = order.inventorySnapshots?.production;
        if (snapshot) {
          if(snapshot.rawLedgerIds?.length&&!(snapshot.rawConsumedLots??order.rawConsumedLots)?.length)throw Error('원료 원장과 소비 근거가 달라 자동 역처리하지 않습니다.');
          productLotMutations.push(...reverseProductionProductLots(snapshot.productProducedLots));
          productLotMutations.push(...restoreProductLotsForOrder({ ...order, productConsumedLots: snapshot.productConsumedLots ?? [] }));
          snapshot.stockDeltas.forEach(row => addDelta(deltas, row.itemId, -row.delta));
          rawReversal=buildOrderRawReversalPlan({order:{...order,rawConsumedLots:snapshot.rawConsumedLots??order.rawConsumedLots},allItems,actorName,effectiveAt:capturedAt});
        } else {await unProduceOrder(order,deltas);rawReversal=buildOrderRawReversalPlan({order,allItems,actorName,effectiveAt:capturedAt});}
        patch.producedAt = ''; patch.rawLotsDeducted = false; patch.rawConsumedLots = []; patch.autoBuilt = []; patch.producedUnits = [];
        if (order.itemInventory) {
          const reversedAt = new Date().toISOString();
          patch.itemInventory = recovery?.after.itemInventory??Object.fromEntries(Object.entries(order.itemInventory).map(([lineId, state]) => [
            lineId, state.applied ? { ...state, applied: false, reversedAt } : state,
          ]));
        }
      }
      // 정방향: 생산 → 출고
      if (needsForwardProduction) {
        inventoryMayHaveChanged = true;
        if (!reservation) throw new Error(`주문 재고 예약이 없습니다: ${order.id}`);
        const { consumedLots, autoBuilt, producedUnits, rawCalculationEvidence, attempt, alreadyProduced, productionDeltas,frozenProductLots,firstBomLines,frozenShipment } = await produceOrder(
          order, deltas, reservation.stockSnapshot, plan,firstReservationDeltas,plain({kind:'status',order,target,completionPatch:firstCompletionPatch??{},reservation:saveReservation(reservation)}),onStage,
        );
        if (!alreadyProduced) {
          patch.producedAt = capturedAt; patch.rawLotsDeducted = true;
          patch.rawInventoryAttempt = attempt;
          // 빈 결과여도 반드시 덮어쓴다 — 안 쓰면 이전 생산의 스냅샷이 남아, 취소 때
          // 이번에 빼지도 않은 양을 되돌려버린다(유령 복원).
          patch.rawConsumedLots = consumedLots;
          // 생산량도 마찬가지로 항상 쓴다. 빈 배열([])과 없음(undefined)은 뜻이 다르다 —
          // 없음은 '옛 주문(전량 생산)'이라 되돌리기가 주문량으로 계산한다.
          patch.producedUnits = producedUnits;
          if (autoBuilt.length > 0) patch.autoBuilt = autoBuilt;
          const productLots = frozenProductLots?replayProductLots(frozenProductLots):productionProductLots(allItems, productionDeltas!, `${order.id}-${attempt}`, inputs);
          firstShipmentDeltas=frozenShipment;
          productLotMutations.push(...productLots.mutations);
          patch.inventorySnapshots = {
            ...order.inventorySnapshots,
            version: 1,
            production: {
              capturedAt,
              stockDeltas: deltaRows(productionDeltas!),
              productProducedLots: productLots.traces,
              productConsumedLots: productLots.consumedLots,
              rawCalculationEvidence: rawCalculationEvidence ?? [],
              bomLines:firstBomLines??bomSnapshotOf(order),
              rawConsumedLots: consumedLots,
              rawLedgerIds: rawLedgerDocIds(consumedLots),
            },
          };
        }
      }
      if (needsForwardShipment) {
        const shipmentDeltasBefore = new Map(deltas);
        if(firstShipmentDeltas)firstShipmentDeltas.forEach(row=>addDelta(deltas,row.itemId,row.delta));else shipOrder(order, deltas); patch.shippedOut = true;
        productLotMutations.push(...deductProductLotsForOrder(order));
        const shipmentDeltas = new Map<string, number>();
        for (const [itemId, value] of deltas) addDelta(shipmentDeltas, itemId, value - (shipmentDeltasBefore.get(itemId) ?? 0));
        shipmentStockDeltas = deltaRows(shipmentDeltas);
      }
      const finalizePatch = (productConsumedLots: NonNullable<Order['productConsumedLots']>) => {
      if (shipmentStockDeltas) {
        // 빈 배열이어도 반드시 쓴다 — 안 쓰면 이전 출고의 스냅샷이 남아 취소 때 유령 복원이 된다.
        patch.productConsumedLots = productConsumedLots;
        patch.inventorySnapshots = {
          ...(patch.inventorySnapshots ?? order.inventorySnapshots),
          version: 1,
          shipment: {
            capturedAt,
            stockDeltas: shipmentStockDeltas,
            bomLines: [],
            productConsumedLots,
          },
        };
      }
      return { ...patch, ...firstCompletionPatch };
      };
      const orderCommitted = !deferOrderPatch || !!completionPatch;
      if(rawReversal&&!orderCommitted)throw Error('원료 역처리는 주문 저장과 함께 확정해야 합니다.');
      onStage?.('final-stock');
      const productConsumedLots = await applyItemStockDeltas(deltas, combineProductLotMutations(productLotMutations), reservationContext,
        orderCommitted ? { orderId: order.id, patch: finalizePatch,...(generation?{generation,expectedOrderText:orderRawBatchOrderEvidence(order),expectedProductionRecordIndex:await expectedRecordIndex(generation,initialRecordIndex)}:isReversing?{expectedOrderText:orderRawBatchOrderEvidence(order)}:{}) } : undefined,rawReversal);
      stockCommitted = true;
      if (!orderCommitted) finalizePatch(productConsumedLots);
      return { patch, stockAdjustments: deltaRows(deltas), orderCommitted };
    } catch (error) {
      if(error instanceof OrderReservationExecutionConflictError)throw error;
      if (error instanceof OrderInventoryPreconditionError && (inventoryMayHaveChanged || stockCommitted)) error.inventoryUnchanged = false;
      if (reservation && !stockCommitted) {
        try {
          await releaseOrderStockReservation(reservation);
        } catch (releaseError) {
          if(releaseError instanceof OrderReservationExecutionConflictError)throw releaseError;
          if (error instanceof OrderInventoryPreconditionError) error.inventoryUnchanged = false;
          // 원래 실패 원인을 바꾸면 주문 감사 기록이 엉뚱한 오류를 남긴다. 남은 processing 예약은
          // 1시간 뒤 만료되므로 여기서는 둘 다 로그로 드러내고 최초 오류를 유지한다.
          console.error(`[주문 재고 예약 해제 실패] ${order.id}`, releaseError);
        }
      }
      throw error;
    }
  };

  // 주문 상태 변경 진입점 — 재고 조정 후 상태 저장. 이미 이력(DELIVERED)이면 재고 조정 없이 상태만.
  const getFreshOrder = async (id: string, required = false): Promise<Order | undefined> => {
    const cached = allOrders.find(o => o.id === id) || orders.find(o => o.id === id);
    try {
      const snap = await getDoc(doc(db, 'orders', id));
      if (snap.exists()) return { ...cached, ...(snap.data() as Partial<Order>), id } as Order;
    } catch (error) {
      if (required) throw new Error(`DB 최신 주문을 확인하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
      /* 일반 상태 저장은 화면의 최신 구독값으로 폴백한다. */
    }
    return cached;
  };
  /** 완료 응답 유실은 원료 영수증과 최초 최종 요청만 재확인한다. 생산기록이나 예약을 새로 쓰지 않는다. */
  const confirmCompletedAtomicRaw=async(live:Order,selection:Record<string,unknown>,requestedItem?:OrderItem):Promise<boolean>=>{
    const marker=live.inventoryGenerationCompletion;
    if(!marker||live.inventoryOperation!=null||!hasOrderInventoryGenerationCompletion(live,marker.generation))return false;
    await ensureGenerationActor(marker.generation);
    const uid=(deps.getActorUid??(()=>actorAuth?.currentUser?.uid))();
    if(!uid)return false;
    const retained=readOrderRawBatchAttempt(marker.generation.companyId,uid,live.id);if(!retained)return false;
    if(uid!==marker.generation.actorUid)throw Error('최초 주문 작업의 로그인 사용자를 확인해 주세요.');
    const request=retained.request;
    if(rawPressText(request.generation)!==rawPressText(marker.generation)||rawPressText(request.business.selection)!==rawPressText(selection))throw Error('최초 주문 원료 작업의 결과부터 확인해 주세요.');
    const finalPlan=request.plan.finalPlan as {kind:'status'|'line';order:Order;target?:OrderStatus;nextItems?:OrderItem[];effectiveStatus?:OrderStatus;completionPatch?:Record<string,unknown>;reservation:ReturnType<typeof saveReservation>};
    if(!finalPlan?.reservation)throw Error('최초 최종 재고 계획이 없습니다. 원문을 보존했습니다.');
    if(requestedItem){const saved=finalPlan.nextItems?.find(row=>row.lineId===requestedItem.lineId);const itemText=(row:OrderItem|undefined)=>rawPressText(row&&{itemId:row.itemId,lineId:row.lineId,quantity:row.quantity,boxQuantity:row.boxQuantity,checked:row.checked});if(itemText(saved)!==itemText(requestedItem))throw Error('최초 품목 수량과 선택이 달라 원문을 보존했습니다.');}
    const {executeOrderRawBatch}=await import('../../shared/services/orderRawBatchService');
    const raw=await executeOrderRawBatch(request);if(raw.status!=='duplicate')throw Error(raw.reason??'원료 완료 영수증을 확인하지 못했습니다.');
    recordPlan(finalPlan.order,request.generation,request.plan.productionRecords);
    const productionAck=await writeProductionRecords(request);if(productionAck.status!=='acknowledged')throw Error('최종 완료에 대응하는 생산기록 완료 근거를 확인하지 못했습니다.');
    const latest=await getFreshOrder(live.id,true);
    if(!latest||latest.inventoryOperation!=null||!hasOrderInventoryGenerationCompletion(latest,request.generation))throw Error('완료 확인 중 주문 작업이 바뀌었습니다.');
    let payload:{patch:Record<string,unknown>};try{payload=JSON.parse(latest.inventoryGenerationCompletion!.requestText);}catch{throw Error('최종 완료 원문이 손상되었습니다.');}
    const deltas=new Map<string,number>();
    if(finalPlan.kind==='line')for(const line of request.plan.lines as {rowDeltas:{itemId:string;delta:number}[]}[])for(const row of line.rowDeltas)addDelta(deltas,row.itemId,row.delta);
    else{for(const row of request.plan.productionDeltas as {itemId:string;delta:number}[])addDelta(deltas,row.itemId,row.delta);if([OrderStatus.SHIPPED,OrderStatus.DELIVERED].includes(finalPlan.target!)&&!isStockProduction(finalPlan.order))for(const row of request.plan.shipmentDeltas as {itemId:string;delta:number}[])addDelta(deltas,row.itemId,row.delta);}
    const target=finalPlan.kind==='line'?finalPlan.effectiveStatus:finalPlan.target;if(payload.patch.status!==target)throw Error('최종 완료 상태가 최초 계획과 다릅니다.');
    if(finalPlan.kind==='line'&&rawPressText(payload.patch.items)!==rawPressText(finalPlan.nextItems))throw Error('최종 완료 품목이 최초 계획과 다릅니다.');
    if(finalPlan.kind==='status'&&rawPressText(payload.patch.items)!==rawPressText(request.plan.normalizedItems))throw Error('최종 완료 줄 번호와 품목이 최초 계획과 다릅니다.');
    const approvedPatch=finalPlan.kind==='status'?finalPlan.completionPatch:{items:finalPlan.nextItems,status:finalPlan.effectiveStatus,inventoryOperation:null};
    if(!approvedPatch||Object.entries(approvedPatch).some(([key,value])=>rawPressText(value)!==rawPressText(payload.patch[key])))throw Error('최종 완료의 승인 내용이 최초 원문과 다릅니다.');
    const mutations=(request.plan.finalLotItemIds as string[]).map(itemId=>({itemId,apply:()=>{throw Error('완료 재확인에서는 재고를 다시 쓰지 않습니다.');}}));
    const {orderRawBatchRequestHash}=await import('../../shared/services/orderRawBatchService');
    const expectedProductionRecordIndex=deriveNextProductionRecordIndex(request.plan.productionRecords as OrderProductionRecordPlan,await orderRawBatchRequestHash(request));
    await applyItemStockDeltas(deltas,mutations,restoreReservation(finalPlan.reservation),{orderId:live.id,generation:request.generation,expectedOrderText:request.business.orderText as string,expectedProductionRecordIndex,patch:payload.patch});
    if((deps.getActorUid??(()=>actorAuth?.currentUser?.uid))()!==uid)throw Error('완료 확인 중 로그인 사용자가 바뀌었습니다.');
    clearOrderRawBatchAttempt(request,retained.encoded);return true;
  };
  /** 서버 첫claim의 완료 ACK는 null 잠금으로 legacy 재고 셈에 내려가지 않는다. */
  const reviewPreviousClaim=async(order:Order)=>{const service=await import('../../shared/services/orderRequestRetirementService');await service.requirePreviousRetirementClaimReview(order.id,companyOf(order),(deps.getActorUid??(()=>actorAuth?.currentUser?.uid))()??'');};
  const confirmCompletedFirstClaim=async(live:Order,selection:Record<string,unknown>,requestedItem?:OrderItem):Promise<boolean>=>{
    if(live.inventoryOperation!=null||typeof (live as Order&{retirementId?:unknown}).retirementId!=='string')return false;
    const marker=live.inventoryGenerationCompletion;
    if(!marker||!hasOrderInventoryGenerationCompletion(live,marker.generation))throw Error('첫 claim의 정확한 완료 세대를 확인하지 못했습니다.');
    await ensureGenerationActor(marker.generation);
    if((deps.getActorUid??(()=>actorAuth?.currentUser?.uid))()!==marker.generation.actorUid)throw Error('첫 claim 완료의 최초 로그인 계정이 다릅니다.');
    await confirmCompletedAtomicRaw(live,selection,requestedItem);
    return true;
  };

  /** 체크된 품목만 출고 전 배정으로 남긴다. 생산에 사용한 구성품은 이미 stock에서 빠져 있다. */
  const completedLineAllocation = (order: Order, items: readonly OrderItem[], states: Record<string, OrderItemInventoryState>) => sharedCompletedLineAllocation(order, items, states, shipOrder);

  /**
   * 주문 품목 한 줄의 작업완료/취소 경계.
   * 재고와 `itemInventory[lineId]`를 같은 transaction에 써서 저장 중 브라우저가 닫혀도
   * 같은 BOM이 재시도에서 두 번 빠지지 않게 한다.
   */
  const changeOrderItemCompletion = async (
    id: string,
    itemIndex: number,
    requestedItems: OrderItem[],
    nextStatus: OrderStatus,
    plan?: StockUsePlan,
    approvedReferenceToken?:InventoryReferenceToken,
  ) => {
    if (inFlightOrders.has(id)) return;
    inFlightOrders.add(id);
    let reservation: Awaited<ReturnType<typeof reserveOrderStock>> | undefined;
    let stockCommitted = false;
    let claimed = false;
    let live: Order | undefined;
    let resumeLegacyReverse=false;
    let operationGeneration:OrderInventoryGeneration|null=null;
    let failureStage: NonNullable<Order['inventoryOperation']>['stage'] = 'claim';
    try {
      const cached = allOrders.find(order => order.id === id) || orders.find(order => order.id === id);
      live = await getFreshOrder(id, true) ?? cached;
      if (!live) throw new Error('주문 정보를 확인할 수 없어 품목 작업을 저장할 수 없습니다.');
      requireLegacyOrder(live);

      let nextItems = ensureOrderLineIds(requestedItems);
      const after = nextItems[itemIndex];
      if (!after) throw new Error('주문 품목을 찾을 수 없습니다. 새로고침 후 다시 확인해 주세요.');
      const lineId = after.lineId!;
      const applying = after.checked === true;
      await reviewPreviousClaim(live);
      if(await retireRetainedRequestBeforeClaim(live)==='archived-only'){await getFreshOrder(id,true);return;}
      if(await confirmCompletedAtomicRaw(live,plain({kind:'line',lineId,applying,itemsText:rawItemSelectionText(nextItems),stockUsePlan:plan??null}),after))return;

      const initialItems=ensureOrderLineIds(live.items);
      const beforeClaim=initialItems[itemIndex];
      if(!beforeClaim||beforeClaim.itemId!==after.itemId||beforeClaim.lineId!==after.lineId)throw Error('주문 품목 순서가 이미 변경되었습니다.');
      const existing=live.inventoryOperation;
      const recoveryUid=(deps.getActorUid??(()=>actorAuth?.currentUser?.uid))();
      const recoveryKey=recoveryUid?'raw-reverse-group-v1:'+companyOf(live)+':'+encodeURIComponent(recoveryUid)+':order-reversal:'+encodeURIComponent(id):'';
      if(!applying&&typeof localStorage!=='undefined'&&typeof localStorage.key==='function'){
        const prefix='raw-reverse-group-v1:'+companyOf(live)+':',suffix=':order-reversal:'+encodeURIComponent(id);
        for(let index=0;index<localStorage.length;index++){const key=localStorage.key(index);if(key?.startsWith(prefix)&&key.endsWith(suffix)&&key!==recoveryKey)throw new OrderReservationExecutionConflictError('이전 원료 요청의 계정 또는 화면 상태를 확인해 주세요.');}
      }
      if(!applying&&recoveryKey&&typeof localStorage!=='undefined'&&localStorage.getItem(recoveryKey)){
        const helper=await import('../../shared/services/rawReverseGroupPermit');
        let retained:Awaited<ReturnType<typeof helper.recoverRawReverseGroup>>;
        try{retained=await helper.recoverRawReverseGroup(companyOf(live),'order-reversal',id,{assertScope:async()=>{if(deps.getActorUid?.()!==recoveryUid)throw Error('화면 또는 계정이 변경되었습니다.');}});}catch{throw new OrderReservationExecutionConflictError('이전 원료 묶음의 계정과 상태를 확인할 수 없어 최초 요청과 예약을 보존했습니다.');}
        if(retained){
          const snapshot=await getDocFromServer(doc(db,'orders',id)),codec=helper.rawGroupCodec(db),afterText=retained.request.business.afterNativeText;
          if(!snapshot.exists()||typeof afterText!=='string')throw new OrderReservationExecutionConflictError('이전 원료 묶음의 주문 원문을 확인하지 못했습니다.');
          const afterOrder=codec.decode(afterText) as Order;
          if(rawPressText(ensureOrderLineIds(afterOrder.items))!==rawPressText(nextItems))throw new OrderReservationExecutionConflictError('이전 원료 묶음과 선택한 주문 품목이 다릅니다.');
          if(retained.state==='applied'){
            const beforeOrder=codec.decode(retained.request.business.beforeNativeText) as Order,prior=beforeOrder.itemInventory?.[lineId],originalNow=retained.request.commands[0]?.options.now;
            const originalPlan=prior&&originalNow?buildOrderRawReversalPlan({order:{...beforeOrder,id,items:[after],rawConsumedLots:prior.rawConsumedLots,rawInventoryAttempt:prior.attempt},lineId,allItems,actorName,effectiveAt:originalNow}):null;
            const job=originalPlan?await getDocFromServer(doc(db,'rawInventoryJobs',originalPlan.jobId)):null,data=job?.data();
            if(codec.text(snapshot.data())!==afterText||!job?.exists()||data?.id!==originalPlan?.jobId||data?.companyId!==retained.request.companyId||data?.source?.type!=='production-reversal'||data?.source?.id!==id||data?.status!=='complete'||data?.createdAt!==originalNow||data?.completedAt!==originalNow||rawPressText(data?.expectedOperationIds)!==rawPressText(retained.request.commands.map(row=>row.command.operationId)))throw new OrderReservationExecutionConflictError('완료된 주문 또는 원료 작업 원문이 달라 확인이 필요합니다.');
            if(deps.getActorUid?.()!==recoveryUid)throw new OrderReservationExecutionConflictError('최초 계정 또는 화면 상태가 변경되었습니다.');helper.clearRawReverseGroup(retained);return;
          }
          if(retained.state!=='prepared'||codec.text(snapshot.data())!==retained.request.business.beforeNativeText||existing?.state!=='processing'||existing.kind!=='line'||existing.lineId!==lineId||existing.startedAt!==retained.request.commands[0]?.options.now)throw new OrderReservationExecutionConflictError('이전 주문 작업과 원료 묶음의 최초 원문이 다릅니다.');
          resumeLegacyReverse=true;
        }
      }
      const blockedExisting=existing?.state==='processing'||(existing?.state==='failed'&&!canResumeFailedInventoryOperation(existing,{kind:'line'} as NonNullable<Order['inventoryOperation']>));
      const referenceToken=!existing?(approvedReferenceToken??deps.referenceGuard?.capture()):undefined;
      const newSendGuard=referenceToken?{assertBeforeNewSend:()=>deps.referenceGuard?.assertCurrent(referenceToken)}:undefined;
      newSendGuard?.assertBeforeNewSend();
      const knownLineResume=existing?.state==='failed'&&canResumeFailedInventoryOperation(existing,{kind:'line'} as NonNullable<Order['inventoryOperation']>);
      // 이전 실패의 부분 수불은 부족 사전검사로 새 작업처럼 판정하지 않는다. 기존 claim/재개 계약으로 넘긴다.
      if(!blockedExisting&&!knownLineResume&&applying&&(!live.producedAt||!!live.itemInventory)){
        const checked=initialItems.map((item,index)=>({item:index===itemIndex?after:item,index})).filter(row=>row.item.checked&&!live!.itemInventory?.[row.item.lineId!]?.applied);
        if(checked.length)await preflightProduction(live,checked,plan,itemIndex);
      }
      let now = resumeLegacyReverse?existing!.startedAt:new Date().toISOString();
      let operationId = resumeLegacyReverse?existing!.id:`order-line-${id}-${lineId}-${Date.now()}`;
      const operation = {
        id: operationId, kind: 'line' as const, lineId, stage: 'claim' as const,
        targetStatus: nextStatus, state: 'processing' as const, startedAt: now, actor: actorName ?? '미기록',
      };
      newSendGuard?.assertBeforeNewSend();
      if(!resumeLegacyReverse){if (claimOrderOperation) live = await claimOrderOperation(id, live.status, operation, newSendGuard);
      else await updateItem('orders', id, { inventoryOperation: operation });
      if(claimOrderOperation&&await confirmCompletedFirstClaim(live,plain({kind:'line',lineId,applying,itemsText:rawItemSelectionText(nextItems),stockUsePlan:plan??null}),after))return;}
      claimed = true;
      const operationOrder = live;
      const generation=generationOf(operationOrder);
      const initialRecordIndex=operationOrder.productionRecordIndex===undefined?undefined:plain(operationOrder.productionRecordIndex);
      await ensureGenerationActor(generation);
      operationGeneration=generation;
      if(generation){now=generation.startedAt;operationId=generation.operationId;}

      // claim이 돌려준 DB 최신 줄과 스냅샷으로 다시 판정한다. 다른 창이 같은 상태 안에서
      // 다른 품목을 먼저 완료했어도 그 기록을 덮어쓰면 안 된다.
      const liveItems = ensureOrderLineIds(operationOrder.items);
      const before = liveItems[itemIndex];
      if (!before || before.itemId !== after.itemId || before.lineId !== after.lineId) {
        throw new Error('주문 품목 순서가 이미 변경되었습니다. 새로고침 후 다시 확인해 주세요.');
      }
      nextItems = liveItems.map((item, index) => index === itemIndex ? after : item);
      let effectiveStatus = nextStatus;
      if (operationOrder.status === OrderStatus.PENDING || operationOrder.status === OrderStatus.PROCESSING || operationOrder.status === OrderStatus.DISPATCHED) {
        effectiveStatus = workStatusFromItems(nextItems);
      }
      const currentStates = { ...(operationOrder.itemInventory ?? {}) };
      const previousState = currentStates[lineId];
      if (!!before.checked === applying && (!!previousState?.applied === applying || !applying)) {
        if(generation){await guardedUpdateOrderInventoryGeneration(generation,{items:nextItems,status:effectiveStatus});await clearOrderInventoryGeneration(generation,{mode:'pre-reservation-noop'});}
        else await updateItem('orders', id, { items: nextItems, status: effectiveStatus, inventoryOperation: null });
        return;
      }
      // 품목별 구조가 없는 옛 생산 주문은 한 줄만 정확히 분리할 근거가 없다.
      // 그 경우 기존 주문 전체 스냅샷 경로로만 되돌려야 한다.
      if (!applying && operationOrder.producedAt && !previousState) {
        if(generation)await clearOrderInventoryGeneration(generation,{mode:'pre-reservation-noop'});else await updateItem('orders', id, { inventoryOperation: null });
        throw new Error('LEGACY_ORDER_ROLLBACK_REQUIRED');
      }

      const pendingApplyRows = applying
        ? nextItems.map((item, index) => ({ item, index }))
            .filter(({ item }) => item.checked && !currentStates[item.lineId!]?.applied)
        : [];
      const inventoryOrder = { ...operationOrder, items: pendingApplyRows.length > 0 ? pendingApplyRows.map(row => row.item) : [after] };
      const extraItemIds = [
        ...orderStockTouchedIds({ items: nextItems.filter(item => item.checked) }, inputs.bom),
        ...Object.values(currentStates).flatMap(state => state.production.stockDeltas.map(row => row.itemId)),
        ...(operationOrder.inventorySnapshots?.shipment?.stockDeltas.map(row => row.itemId) ?? []),
      ];
      failureStage = 'reservation';
      const retainedRaw=generation?readOrderRawBatchAttempt(generation.companyId,generation.actorUid,id):null;
      if(applying)requireRecordContract(operationOrder,generation);
      if(generation&&retainedRaw)recordPlan(operationOrder,generation,retainedRaw.request.plan.productionRecords);
      let firstReservationDeltas:{itemId:string;delta:number}[]=[];
      reservation = await reserveOrderStock(
        inventoryOrder,
        operationId,
        stockSnapshot => {
          if(retainedRaw){firstReservationDeltas=retainedRaw.request.plan.reservationDeltas as typeof firstReservationDeltas;return new Map(firstReservationDeltas.map(row=>[row.itemId,row.delta]));}
          const preview = new Map<string, number>();
          if(!applying&&previousState?.applied){
            previousState.production.stockDeltas.forEach(row=>addDelta(preview,row.itemId,-row.delta));
            const remainingStates={...currentStates,[lineId]:{...previousState,applied:false}};
            if(!isStockProduction(operationOrder))for(const [itemId,qty] of completedLineAllocation(operationOrder,nextItems,remainingStates))addDelta(preview,itemId,-qty);
          }
          if (applying) {
            const allocated=new Map<string,number>();
            for (const row of pendingApplyRows) {
              const single = { ...operationOrder, items: [row.item] };
              planOrderProduction(single, preview, stockSnapshot, row.index === itemIndex ? plan : undefined,allocated);
              // 생산 순변화만 예약하면 이 줄이 쓸 기존 완제품이 보호되지 않는다.
            }
            if(!isStockProduction(operationOrder))for(const row of pendingApplyRows)shipOrder({...operationOrder,items:[row.item]},preview);
          }
          firstReservationDeltas=deltaRows(preview);
          return preview;
        },
        extraItemIds,
        { preserveOwnAllocation: applying,...(generation?{generation}:{}),...(resumeLegacyReverse?{resumeExisting:true,recoveryActorUid:recoveryUid}:{}) },
      );

      const deltas = new Map<string, number>();
      const productLotMutations: OrderProductLotMutation[] = [];
      const states = { ...currentStates };
      const allocatedOutput=new Map<string,number>();
      let rawReversal:ReturnType<typeof buildOrderRawReversalPlan>;
      if (applying) {
        type SavedLinePlan={lineId:string;production:ReturnType<typeof planOrderProduction>;rowDeltas:{itemId:string;delta:number}[];attempt:number;commandIndices:number[];productLots:FrozenProductLots;bomLines:OrderInventorySnapshot['bomLines']};
        let atomicPlans:SavedLinePlan[]|undefined,atomicTraces:NonNullable<Order['rawConsumedLots']>[]=[];
        if(generation){
          const retained=readOrderRawBatchAttempt(generation.companyId,generation.actorUid,id);
          let planned:SavedLinePlan[],commands:ReturnType<typeof buildOrderRawCommands>['commands'];
          if(retained){planned=retained.request.plan.lines as SavedLinePlan[];commands=retained.request.commands;}
          else{
            planned=[];commands=[];const preview=new Map<string,number>(),allocated=new Map<string,number>();
            for(const row of pendingApplyRows){
              const rowBefore=new Map(preview),single={...operationOrder,items:[row.item]},attempt=(currentStates[row.item.lineId!]?.attempt??0)+1;
              const production=planOrderProduction(single,preview,reservation.stockSnapshot,row.index===itemIndex?plan:undefined,allocated),rowDeltas=new Map<string,number>();
              for(const [key,value] of preview)addDelta(rowDeltas,key,value-(rowBefore.get(key)??0));
              const built=buildOrderRawCommands({order:single,physicalUsage:production.rawUsage,ledgerOnlyUsage:production.rawUsageLedgerOnly,attempt,lineId:row.item.lineId,allItems,partners,actorName});
              const commandIndices=built.commands.map((_,index)=>commands.length+index);commands.push(...built.commands);
              planned.push({lineId:row.item.lineId!,production,rowDeltas:deltaRows(rowDeltas),attempt,commandIndices,productLots:freezeProductLots(rowDeltas,`${id}-${row.item.lineId}-${attempt}`,generation.startedAt),bomLines:bomSnapshotOf(single)});
            }
          }
          const appliedStates={...currentStates,...Object.fromEntries(planned.map(row=>[row.lineId,{applied:true}]))} as Record<string,OrderItemInventoryState>;
          const finalAllocation=isStockProduction(operationOrder)?new Map<string,number>():completedLineAllocation(operationOrder,nextItems,appliedStates);
          const finalPlan=retained?.request.plan.finalPlan??plain({kind:'line',order:operationOrder,nextItems,currentStates,effectiveStatus,reservation:saveReservation({...reservation,allocationQuantities:finalAllocation})});
          const productionRecords=retained?recordPlan(operationOrder,generation,retained.request.plan.productionRecords):createProductionRecordPlan!({...operationOrder,items:pendingApplyRows.map(row=>row.item)},inputs,generation);
          validateOrderProductionRecordPlan(productionRecords);
          failureStage='raw-inventory';
          const result=await applyOrderAtomicRawPlan({order:operationOrder,generation,selection:plain({kind:'line',lineId,applying,itemsText:rawItemSelectionText(nextItems),stockUsePlan:plan??null}),plan:plain({lines:planned,productionRecords,reservationDeltas:firstReservationDeltas,finalPlan,finalLotItemIds:[...new Set(planned.flatMap(row=>row.productLots.mutationItemIds))]}),commands,legacyJobIds:planned.map(row=>`production:${id}:${row.lineId}:a${row.attempt}`)});
          atomicPlans=result.request.plan.lines as SavedLinePlan[];atomicTraces=result.traces;
          failureStage='production-record';await writeProductionRecords(result.request);
        }
        for (const row of pendingApplyRows) {
          const rowLineId = row.item.lineId!;
          const rowBefore = new Map(deltas);
          const previous = currentStates[rowLineId];
          const savedPlan=atomicPlans?.find(saved=>saved.lineId===rowLineId);
          const attempt = savedPlan?.attempt??(previous?.attempt ?? 0) + 1;
          const single = { ...operationOrder, items: [row.item] };
          const production = savedPlan?.production??planOrderProduction(
            single, deltas, reservation.stockSnapshot, row.index === itemIndex ? plan : undefined,allocatedOutput,
          );
          failureStage = 'raw-inventory';
          const consumedLots = savedPlan?savedPlan.commandIndices.flatMap(index=>atomicTraces[index]):await applyOrderRawUsage(
            single, production.rawUsage, attempt, production.rawUsageLedgerOnly, rowLineId,
          );
          failureStage = 'production-record';
          if(!generation)await createProductionRecordsForOrder!(single, inputs);
          const rowDeltas = new Map<string, number>();
          if(savedPlan)for(const row of savedPlan.rowDeltas){addDelta(deltas,row.itemId,row.delta);addDelta(rowDeltas,row.itemId,row.delta);}
          else for (const [itemId, value] of deltas) addDelta(rowDeltas, itemId, value - (rowBefore.get(itemId) ?? 0));
          const productLots = savedPlan?replayProductLots(savedPlan.productLots):productionProductLots(allItems, rowDeltas, `${id}-${rowLineId}-${attempt}`, inputs);
          productLotMutations.push(...productLots.mutations);
          const snapshot: OrderInventorySnapshot = {
            capturedAt: now,
            stockDeltas: deltaRows(rowDeltas),
            productProducedLots: productLots.traces,
            productConsumedLots: productLots.consumedLots,
            rawCalculationEvidence: production.rawCalculationEvidence,
            bomLines: savedPlan?.bomLines??bomSnapshotOf(single),
            rawConsumedLots: consumedLots,
            rawLedgerIds: rawLedgerDocIds(consumedLots),
          };
          states[rowLineId] = {
            version: 1, lineId: rowLineId, itemId: row.item.itemId, applied: true, attempt,
            completedAt: now, rawConsumedLots: consumedLots,
            autoBuilt: production.autoBuilt, producedUnits: production.producedUnits,
            production: snapshot,
          };
        }
      } else {
        if (!previousState?.applied) {
          if(generation)await applyItemStockDeltas(new Map(),[],reservation,{orderId:id,patch:{items:nextItems,status:effectiveStatus,inventoryOperation:null},generation,expectedOrderText:orderRawBatchOrderEvidence(operationOrder),expectedProductionRecordIndex:await expectedRecordIndex(generation,initialRecordIndex)});
          else{await updateItem('orders', id, { items: nextItems, status: effectiveStatus, inventoryOperation: null });await releaseOrderStockReservation(reservation);}
          reservation = undefined;
          return;
        }
        if(previousState.production.rawLedgerIds?.length&&!previousState.rawConsumedLots?.length)throw Error('원료 원장과 소비 근거가 달라 자동 역처리하지 않습니다.');
        previousState.production.stockDeltas.forEach(row => addDelta(deltas, row.itemId, -row.delta));
        productLotMutations.push(...reverseProductionProductLots(previousState.production.productProducedLots));
        productLotMutations.push(...restoreProductLotsForOrder({ ...operationOrder, productConsumedLots: previousState.production.productConsumedLots ?? [] }));
        rawReversal=buildOrderRawReversalPlan({order:{...operationOrder,items:[after],rawConsumedLots:previousState.rawConsumedLots,rawInventoryAttempt:previousState.attempt},lineId,allItems,actorName,effectiveAt:now});
        states[lineId] = { ...previousState, applied: false, reversedAt: now };
      }

      const firstFinalPlan=generation?readOrderRawBatchAttempt(generation.companyId,generation.actorUid,id)?.request.plan.finalPlan as {reservation:ReturnType<typeof saveReservation>}|undefined:undefined;
      reservation.allocationQuantities = firstFinalPlan?new Map(firstFinalPlan.reservation.allocationQuantities):isStockProduction(operationOrder) ? new Map() : completedLineAllocation(operationOrder, nextItems, states);
      const aggregate = aggregateOrderLineInventory(operationOrder, states);
      const orderPatch: Record<string, unknown> = {
        items: nextItems,
        status: effectiveStatus,
        itemInventory: states,
        ...aggregate,
        inventoryOperation: null,
      };
      failureStage = 'final-stock';
      await applyItemStockDeltas(deltas, combineProductLotMutations(productLotMutations), reservation, { orderId: id, patch: () => ({ ...orderPatch, ...aggregateOrderLineInventory(operationOrder, states) }),...(generation?{generation,expectedOrderText:orderRawBatchOrderEvidence(operationOrder),expectedProductionRecordIndex:await expectedRecordIndex(generation,initialRecordIndex)}:!applying?{expectedOrderText:orderRawBatchOrderEvidence(operationOrder)}:{}) },rawReversal);
      stockCommitted = true;
      if(generation&&readOrderRawBatchAttempt(generation.companyId,generation.actorUid,id)){const completed=await getFreshOrder(id,true);if(!completed||!await confirmCompletedAtomicRaw(completed,plain({kind:'line',lineId,applying,itemsText:rawItemSelectionText(nextItems),stockUsePlan:plan??null}),after))throw Error('최종 완료 근거를 확인하지 못해 최초 원문을 보존했습니다.');}

      const namedAdjustments = deltaRows(deltas).map(row => {
        const item = allItems.find(candidate => candidate.id === row.itemId);
        return { ...row, name: item?.name ?? row.itemId, unit: item?.unit ?? '개' };
      });
      try {
        await addItem('orderStatusAudits', {
          id: operationId, orderId: id, partnerName: operationOrder.partnerName,
          previousStatus: operationOrder.status, nextStatus: effectiveStatus, approvedBy: actorName ?? '미기록',
          approvedAt: now, completedAt: new Date().toISOString(), state: 'completed',
          legacyEvidenceWarning: false, stockAdjustments: namedAdjustments,
        } satisfies OrderStatusAudit);
      } catch (auditError) {
        // 재고와 주문 스냅샷은 이미 한 transaction으로 확정됐다. 감사 로그 실패 때문에
        // 완료된 재고 작업을 실패로 덮으면 재처리 판단이 더 위험해진다.
        console.error(`[품목 작업 감사 기록 실패] ${id}/${lineId}`, auditError);
      }
    } catch (error) {
      if(error instanceof OrderReservationExecutionConflictError)throw error;
      if(resumeLegacyReverse&&!stockCommitted)throw new OrderReservationExecutionConflictError('기존 원료 묶음을 안전하게 재개하지 못해 최초 요청과 예약을 보존했습니다.');
      if (reservation && !stockCommitted) {
        try { await releaseOrderStockReservation(reservation); }
        catch (releaseError) { if(releaseError instanceof OrderReservationExecutionConflictError)throw releaseError;console.error(`[품목 재고 예약 해제 실패] ${id}`, releaseError); }
      }
      // 재개 가능한 품목 작업은 새 실패 단계까지 남겨, 다음 재시도가 어디부터 이어지는지 알 수 있게 한다.
      const existingFailure = live?.inventoryOperation?.state === 'failed';
      if(operationGeneration&&claimed)await markOrderInventoryGenerationFailed(operationGeneration,error instanceof Error?error.message:String(error),failureStage);
      else if (claimed && !(error instanceof OrderProductionPreflightError) && !existingFailure && error instanceof Error && error.message !== 'LEGACY_ORDER_ROLLBACK_REQUIRED') {
        await updateItem('orders', id, {
          inventoryOperation: {
            id: `order-line-failed-${Date.now()}`, kind: 'line', lineId: requestedItems[itemIndex]?.lineId,
            stage: failureStage, targetStatus: nextStatus, state: 'failed', startedAt: new Date().toISOString(),
            actor: actorName ?? '미기록', error: error.message,
          },
        });
      }
      throw error;
    } finally {
      inFlightOrders.delete(id);
    }
  };

  const prepareOrderStatusChange = async (id: string, status: OrderStatus): Promise<PreparedOrderStatusChange | undefined> => {
    const order = await getFreshOrder(id, true);
    if (!order) return undefined;
    requireLegacyOrder(order);
    await reviewPreviousClaim(order);
    const referenceToken=deps.referenceGuard?.capture();
    if(referenceToken)deps.referenceGuard?.assertCurrent(referenceToken);
    return { order, plan: buildRollbackPlan(order, allItems, order.status, status, inputs) };
  };

  const changeOrderStatus = async (id: string, status: OrderStatus, plan?: StockUsePlan, context: OrderStatusChangeContext = {}) => {
    // 같은 주문이 동시에 두 번 생산 처리되는 것을 막는다.
    //  품목 체크가 연달아 들어오면 handleToggleItemChecked가 같은 틱에 작업완료를 여러 번 부르는데,
    //  producedAt 판정이 React 상태 기준이라 전부 통과해 원료가 배수로 빠졌다(수입들기름 3배).
    if (inFlightOrders.has(id)) return;
    inFlightOrders.add(id);
    try {
      let order = allOrders.find(o => o.id === id) || orders.find(o => o.id === id);
      if (!order) order = await getFreshOrder(id, true);
      if (!order) {
        if (isWorkCompletedState(status)) throw new Error('주문 정보를 확인할 수 없어 작업완료 상태로 변경할 수 없습니다.');
        throw new Error('주문 정보를 확인할 수 없어 상태를 변경할 수 없습니다.');
      }
      requireLegacyOrder(order);
      // producedAt·shippedOut은 DB에서 다시 읽는다 — React 상태는 같은 틱에 갱신되지 않아
      // 직전 호출이 이미 생산했는지 알 수 없다.
      let live = await getFreshOrder(id, true) ?? order;
      requireLegacyOrder(live);
      await reviewPreviousClaim(live);
      if(await retireRetainedRequestBeforeClaim(live)==='archived-only'){await getFreshOrder(id,true);return;}
      if(await confirmCompletedAtomicRaw(live,plain({kind:'status',targetStatus:status,stockUsePlan:plan??null})))return;
      let recovery:{actorUid:string;now:string;after:Order}|undefined;
      let recoveryAudit:OrderStatusAudit|undefined;
      const recoveryUid=(deps.getActorUid??(()=>actorAuth?.currentUser?.uid))(),recoveryPrefix='raw-reverse-group-v1:'+companyOf(live)+':',recoverySuffix=':order-reversal:'+encodeURIComponent(id),recoveryKey=recoveryUid?recoveryPrefix+encodeURIComponent(recoveryUid)+recoverySuffix:'';
      if(typeof localStorage!=='undefined'&&typeof localStorage.key==='function')for(let index=0;index<localStorage.length;index++){const key=localStorage.key(index);if(key?.startsWith(recoveryPrefix)&&key.endsWith(recoverySuffix)&&key!==recoveryKey)throw new OrderReservationExecutionConflictError('이전 원료 요청의 계정 또는 화면 상태를 확인해 주세요.');}
      if(recoveryKey&&typeof localStorage!=='undefined'&&localStorage.getItem(recoveryKey)){
        const helper=await import('../../shared/services/rawReverseGroupPermit');let retained:Awaited<ReturnType<typeof helper.recoverRawReverseGroup>>;
        try{retained=await helper.recoverRawReverseGroup(companyOf(live),'order-reversal',id,{assertScope:async()=>{if(deps.getActorUid?.()!==recoveryUid)throw Error('화면 또는 계정이 변경되었습니다.');}});}catch{throw new OrderReservationExecutionConflictError('이전 원료 묶음의 계정과 상태를 확인할 수 없어 최초 요청을 보존했습니다.');}
        if(retained){const codec=helper.rawGroupCodec(db),snapshot=await getDocFromServer(doc(db,'orders',id)),afterText=retained.request.business.afterNativeText;if(!snapshot.exists()||typeof afterText!=='string')throw new OrderReservationExecutionConflictError('이전 주문 원문을 확인하지 못했습니다.');const after=codec.decode(afterText) as Order,before=codec.decode(retained.request.business.beforeNativeText) as Order,now=retained.request.commands[0]?.options.now;
          if(after.status!==status||!now||Object.entries(context.orderPatch??{}).some(([key,value])=>rawPressText((after as any)[key])!==rawPressText(value)))throw new OrderReservationExecutionConflictError('이전 상태 변경과 현재 선택이 다릅니다.');
          if(retained.state==='applied'){const rawConsumedLots=before.inventorySnapshots?.production?.rawConsumedLots??before.rawConsumedLots,originalPlan=buildOrderRawReversalPlan({order:{...before,id,rawConsumedLots},allItems,actorName,effectiveAt:now}),job=originalPlan?await getDocFromServer(doc(db,'rawInventoryJobs',originalPlan.jobId)):null,data=job?.data(),originalOperation=before.inventoryOperation,audit=originalOperation?await getDocFromServer(doc(db,'orderStatusAudits',originalOperation.id)):null,auditData=audit?.data();if(codec.text(snapshot.data())!==afterText||!job?.exists()||data?.id!==originalPlan?.jobId||data?.companyId!==retained.request.companyId||data?.source?.type!=='production-reversal'||data?.source?.id!==id||data?.status!=='complete'||data?.createdAt!==now||data?.completedAt!==now||rawPressText(data?.expectedOperationIds)!==rawPressText(retained.request.commands.map(row=>row.command.operationId))||!audit?.exists()||auditData?.id!==originalOperation?.id||auditData?.companyId!==retained.request.companyId||auditData?.orderId!==id||auditData?.state!=='completed'||auditData?.approvedAt!==originalOperation?.startedAt||auditData?.approvedBy!==originalOperation?.actor||auditData?.previousStatus!==before.status||auditData?.nextStatus!==status)throw new OrderReservationExecutionConflictError('완료된 주문·원료 작업 또는 감사 원문이 다릅니다.');if(deps.getActorUid?.()!==recoveryUid)throw new OrderReservationExecutionConflictError('최초 계정 또는 화면 상태가 변경되었습니다.');helper.clearRawReverseGroup(retained);return;}
          const operation=live.inventoryOperation;if(retained.state!=='prepared'||generationOf(live)||codec.text(snapshot.data())!==retained.request.business.beforeNativeText||operation?.state!=='processing'||operation.kind!=='status'||operation.targetStatus!==status)throw new OrderReservationExecutionConflictError('이전 주문 작업과 원료 묶음의 최초 원문이 다릅니다.');
          const audit=await getDocFromServer(doc(db,'orderStatusAudits',operation.id)),auditData=audit.data();if(!audit.exists()||auditData?.id!==operation.id||auditData?.companyId!==retained.request.companyId||auditData?.orderId!==id||auditData?.state!=='processing'||auditData?.approvedAt!==operation.startedAt||auditData?.approvedBy!==operation.actor||auditData?.previousStatus!==before.status||auditData?.nextStatus!==status||(context.approvedAt!==undefined&&context.approvedAt!==operation.startedAt)||(context.approvedBy!==undefined&&context.approvedBy!==operation.actor))throw new OrderReservationExecutionConflictError('이전 상태 작업의 감사 원문이 다릅니다.');if(deps.getActorUid?.()!==recoveryUid)throw new OrderReservationExecutionConflictError('최초 계정 또는 화면 상태가 변경되었습니다.');recoveryAudit=auditData as OrderStatusAudit;recovery={actorUid:recoveryUid!,now,after};
        }
      }
      if (live.status === status) {
        await updateItem('orders', id, { status });
        return;
      }
      if (isStockProduction(live) && [OrderStatus.SHIPPED, OrderStatus.DELIVERED].includes(status)) {
        throw new Error('재고 만들기는 출고하지 않습니다.');
      }
      const referenceToken=!live.inventoryOperation?(context.referenceToken??deps.referenceGuard?.capture()):undefined;
      const newSendGuard=referenceToken?{assertBeforeNewSend:()=>deps.referenceGuard?.assertCurrent(referenceToken)}:undefined;
      newSendGuard?.assertBeforeNewSend();
      const nextItems = context.orderPatch?.items ?? live.items;
      if (requiresCompleteItemsForStatusChange(live.status, status) && !hasCompleteOrderItems(nextItems)) {
        throw new Error('모든 주문 품목의 작업완료 여부를 확인한 뒤 상태를 변경해 주세요.');
      }
      if (live.status === OrderStatus.SHIPPED && status === OrderStatus.DISPATCHED) {
        const prepared = await prepareOrderInventoryCancellation(db, id, companyOf(live), 'cancel-shipment');
        if (context.approvedPlan) {
          const latest = buildRollbackPlan(prepared.order, allItems, prepared.order.status, status, inputs);
          if (prepared.order.status !== context.approvedFromStatus || JSON.stringify(latest.adjustments) !== JSON.stringify(context.approvedPlan.adjustments)) {
            throw new Error('승인 후 출고 취소 계획이 변경되었습니다. 다시 확인해 주세요.');
          }
        }
        const result = await executeOrderInventoryCancellation(db, prepared.ticket, context.approvedBy ?? actorName);
        if (result.status !== 'completed') throw new Error(`출고 취소에 실패했습니다: ${result.code ?? result.status}`);
        return;
      }
      if(STATUS_WANT_PRODUCED.has(status)&&!live.producedAt&&live.inventoryOperation?.state!=='failed'&&live.inventoryOperation?.state!=='processing')await preflightProduction(live,live.items.map((item,index)=>({item,index})),plan);
      let approvedAt = recovery?live.inventoryOperation!.startedAt:context.approvedAt ?? new Date().toISOString();
      const approvedBy = recovery?live.inventoryOperation!.actor:context.approvedBy ?? actorName ?? '미기록';
      let auditId = recovery?live.inventoryOperation!.id:`order-status-${id}-${Date.now()}`;
      const operation = { id: auditId, kind: 'status' as const, targetStatus: status, state: 'processing' as const, startedAt: approvedAt, actor: approvedBy };
      newSendGuard?.assertBeforeNewSend();
      if (!recovery&&claimOrderOperation) live = await claimOrderOperation(id, live.status, operation,newSendGuard);
      else if(!recovery)await updateItem('orders', id, { inventoryOperation: operation });
      if(!recovery&&claimOrderOperation&&await confirmCompletedFirstClaim(live,plain({kind:'status',targetStatus:status,stockUsePlan:plan??null})))return;
      const generation=generationOf(live);
      await ensureGenerationActor(generation);
      if(generation){approvedAt=generation.startedAt;auditId=generation.operationId;}
      if (context.approvedPlan) {
        const latestPlan = buildRollbackPlan(live, allItems, live.status, status, inputs);
        const approvedRows = JSON.stringify(context.approvedPlan.adjustments);
        const latestRows = JSON.stringify(latestPlan.adjustments);
        if (live.status !== context.approvedFromStatus || context.approvedPlan.legacyEvidenceWarning !== latestPlan.legacyEvidenceWarning || approvedRows !== latestRows) {
          if(recovery)throw new OrderReservationExecutionConflictError('이전 상태 변경의 승인 계획이 달라 최초 요청을 보존했습니다.');
          if(generation)await clearOrderInventoryGeneration(generation,{mode:'pre-reservation-noop'});else await updateItem('orders', id, { inventoryOperation: null });
          throw new Error('승인 후 주문 상태 또는 재고 원복 계획이 변경되었습니다. 다시 확인해 주세요.');
        }
      }
      let result: { patch: Partial<Order>; stockAdjustments: { itemId: string; delta: number }[]; orderCommitted?: boolean } = { patch: {}, stockAdjustments: [] };
      const initialAudit: OrderStatusAudit = recoveryAudit??{
        id: auditId, orderId: id, partnerName: live.partnerName, previousStatus: live.status, nextStatus: status,
        approvedBy, approvedAt, state: 'processing', legacyEvidenceWarning: !!context.approvedPlan?.legacyEvidenceWarning,
        stockAdjustments: context.approvedPlan?.adjustments.map(({ itemId, name, unit, delta }) => ({ itemId, name, unit, delta })) ?? [],
      };
      let statusFailureStage:NonNullable<Order['inventoryOperation']>['stage']='claim';
      try {
        if(!recovery)await addItem('orderStatusAudits', initialAudit);
        // 같은 상태 재저장만 재고를 건너뛴다. 예전 주문(DELIVERED)도 실제로 역행시키면
        // 출고·생산 스냅샷을 따라 반드시 원복돼야 한다.
        if (live.status !== status) result = await reconcileOrderStock(live, status, plan, true, generation?.operationId??operation.id,
          { ...context.orderPatch, status, inventoryOperation: null },stage=>{statusFailureStage=stage;},recovery);
      // 배송완료일은 **여기서 만들어 넣지 않는다.** 서류 네 종의 유일한 기준일이라,
      // '지금 시각'으로 채우면 새벽에 처리한 건이 다음 날짜로 새서 서류가 갈린다.
      // 판매기록부를 뽑는 쪽이 서류 날짜로 미리 박아 준다. 비어 있으면 알림으로 드러낸다.
      if (status === OrderStatus.DELIVERED && !live.deliveredAt) {
        console.error(`[배송완료일 없음] 주문 ${id} (${live.partnerName ?? ''}) — 서류에서 빠집니다`);
        await addItem('notifications', {
          type: 'inventory_shortage',
          title: '배송완료일 없는 주문',
          body: `${live.partnerName ?? id} 주문에 배송완료일이 없어 원료수불부·판매기록부에서 빠집니다. 주문을 열어 날짜를 넣어 주세요.`,
          linkedId: id, readBy: [], createdAt: new Date().toISOString(),
        } as Omit<AppNotification, 'id'>);
      }
        const namedAdjustments = result.stockAdjustments.map(row => {
          const item = allItems.find(candidate => candidate.id === row.itemId);
          return { ...row, name: item?.name ?? row.itemId, unit: item?.unit ?? '개' };
        });
        if (!result.orderCommitted){if(generation){await guardedUpdateOrderInventoryGeneration(generation,{...result.patch,...context.orderPatch,status});await clearOrderInventoryGeneration(generation,{mode:'pre-reservation-noop'});}else await updateItem('orders', id, { ...result.patch, ...context.orderPatch, status, inventoryOperation: null });}
        if(generation&&result.orderCommitted&&readOrderRawBatchAttempt(generation.companyId,generation.actorUid,id)){const completed=await getFreshOrder(id,true);if(!completed||!await confirmCompletedAtomicRaw(completed,plain({kind:'status',targetStatus:status,stockUsePlan:plan??null})))throw Error('최종 완료 근거를 확인하지 못해 최초 원문을 보존했습니다.');}
        await addItem('orderStatusAudits', { ...initialAudit, state: 'completed', completedAt: new Date().toISOString(), stockAdjustments: namedAdjustments });
      } catch (error) {
        if(error instanceof OrderReservationExecutionConflictError)throw error;
        if(recovery&&!result.orderCommitted)throw new OrderReservationExecutionConflictError('이전 상태 작업을 재개하지 못해 최초 요청을 보존했습니다.');
        if (result.orderCommitted) { console.error(`[완료된 주문 후속 기록 실패] ${id}`, error); return; }
        const message = error instanceof Error ? error.message : String(error);
        if(generation)await markOrderInventoryGenerationFailed(generation,message,statusFailureStage);else await updateItem('orders', id, { inventoryOperation: error instanceof OrderInventoryPreconditionError && error.inventoryUnchanged
          ? null : { ...operation, state: 'failed', error: message } });
        await addItem('orderStatusAudits', { ...initialAudit, state: 'failed', completedAt: new Date().toISOString(), error: message });
        throw error;
      }
    } finally {
      inFlightOrders.delete(id);
    }
  };

  const prepareOrderCancellation = async (id: string, companyId: ReturnType<typeof import('../../shared/types').companyOf>, action: CancellationAction) => {
    const order=await getFreshOrder(id,true);if(!order)throw Error('주문 정보를 확인할 수 없습니다.');requireLegacyOrder(order);
    return prepareOrderInventoryCancellation(db, id, companyId, action);
  };
  const executeOrderCancellation = async (ticket: CancellationTicket) => {
    if (inFlightOrders.has(ticket.orderId)) return { status: 'blocked' as const, operationId: ticket.operationId,
      code: 'OTHER_INVENTORY_OPERATION', affectedItemIds: [], inventoryApplied: 'none' as const, retryable: true, deleted: false };
    inFlightOrders.add(ticket.orderId);
    try { const order=await getFreshOrder(ticket.orderId,true);if(!order)throw Error('주문 정보를 확인할 수 없습니다.');requireLegacyOrder(order);return await executeOrderInventoryCancellation(db, ticket, actorName); }
    finally { inFlightOrders.delete(ticket.orderId); }
  };
  const readOrderCancellation = (ticket: CancellationTicket) => readOrderCancellationReceipt(db, ticket);
  return { changeOrderStatus, changeOrderItemCompletion, reconcileOrderStock, prepareOrderStatusChange,
    prepareOrderCancellation, executeOrderCancellation, readOrderCancellation };
}

/** 작업별 입력을 고정해 await 중 회사 전환과 중첩 작업의 색인 교체를 분리한다. */
export function createOrderStockEngine(deps: OrderStockEngineDeps) {
  const start = () => createScopedOrderStockEngine(deps, deps.orderUnitInputs ?? { bom: getBomIndex(), pack: getPackIndex() });
  type Engine = ReturnType<typeof createScopedOrderStockEngine>;
  return {
    changeOrderStatus: (...args: Parameters<Engine['changeOrderStatus']>) => start().changeOrderStatus(...args),
    changeOrderItemCompletion: (...args: Parameters<Engine['changeOrderItemCompletion']>) => start().changeOrderItemCompletion(...args),
    reconcileOrderStock: (...args: Parameters<Engine['reconcileOrderStock']>) => start().reconcileOrderStock(...args),
    prepareOrderStatusChange: (...args: Parameters<Engine['prepareOrderStatusChange']>) => start().prepareOrderStatusChange(...args),
    prepareOrderCancellation: (...args: Parameters<Engine['prepareOrderCancellation']>) => start().prepareOrderCancellation(...args),
    executeOrderCancellation: (...args: Parameters<Engine['executeOrderCancellation']>) => start().executeOrderCancellation(...args),
    readOrderCancellation: (...args: Parameters<Engine['readOrderCancellation']>) => start().readOrderCancellation(...args),
  };
}
