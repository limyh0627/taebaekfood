import { doc, getDoc, Firestore } from 'firebase/firestore';
import { isBulkItem, isGoodsItem, holdsUnitStock } from '../../shared/itemTaxonomy';
import { goodsShipQty, shipQtyOfLine } from '../../shared/shipDeduction';
import { bomOf } from '../../shared/bomIndex';
import { Order, OrderItem, Item, OrderStatus, AppNotification, Partner, OrderInventorySnapshot, OrderStatusAudit, OrderItemInventoryState } from '../../shared/types';
import { toKg, baseRawName, unitToKg } from '../../constants/formula';
import { runRawInventoryJob } from '../../shared/services/rawInventoryJob';
import { bomQty } from '../../shared/bom';
import { stockUnits, isBoxStockItem, unpackComponent, unitsPerBoxOf } from '../../shared/orderUnits';
import type { CollectionName } from '../../shared/collections';
import { docName } from '../../shared/docName';
import { buildRollbackPlan, type RollbackPlan } from './rollbackSummary';
import { hasCompleteOrderItems, isWorkCompletedState, requiresCompleteItemsForStatusChange } from '../../shared/orderCompletion';
import { createOrderRawInventoryOperations, oemLedgerKg, rawLedgerDocIds } from './orderRawInventory';
import { createOrderProductLotOperations, type OrderProductLotMutation } from './orderProductLots';
import { createOrderItemStockOperations, orderStockTouchedIds } from './orderItemStock';
import { aggregateOrderLineInventory, ensureOrderLineIds } from '../../shared/orderLineInventory';

/**
 * 작업완료 때 "이미 있는 재고를 얼마나 쓸까" — 주문 라인(order.items 인덱스)별 선택.
 * 화면(StockUseModal)이 만들어 넘긴다. 안 넘기면 쓸 수 있는 만큼 다 쓴다(모달 기본값과 같음).
 */
export interface StockUseChoice {
  /** 주문 품목 자신의 기존 재고에서 쓸 수량 — 재고 단위(박스 품목이면 박스 개수). 0이면 '사용안함' = 전량 생산. */
  own: number;
  /** 박스 품목일 때, 부족분 박스를 만드는 데 쓸 낱개 재고 수량(낱개 개수). 없으면 있는 만큼 다 쓴다. */
  loose?: number;
}
export type StockUsePlan = Record<number, StockUseChoice>;

export interface OrderStatusChangeContext {
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
  /**
   * **지금 이 일을 하는 사람** — 자동으로 찍히는 원료 원장 줄에 `addedBy` 로 남는다.
   *
   * 여태 자동 줄에는 아무 이름도 안 적혔다(2026-09-07 사장님: "누가했는지 하나도 안 나오내").
   * 손으로 넣는 길은 전부 이름을 남기는데 **제일 많은 자동 길만 비어 있었다** —
   * 재고가 왜 빠졌는지 되짚을 때 물어볼 사람이 없다.
   * 자동이라도 **버튼은 사람이 누른다.** 누른 사람을 적는다.
   */
  actorName?: string;
  allItems: Item[];
  submaterials: Item[];
  partners: Partner[];
  allOrders: Order[];
  orders: Order[];
  db: Firestore;
  buildFormula: (prodKey: string) => { raw: string; ratio: number }[];
  createProductionRecordsForOrder: (order: Order) => Promise<void>;
  updateItem: (collection: CollectionName, id: string, data: Record<string, any>) => Promise<any>;
  addItem: (collection: CollectionName, data: Record<string, any>) => Promise<any>;
  claimOrderOperation?: (orderId: string, expectedStatus: OrderStatus, operation: NonNullable<Order['inventoryOperation']>) => Promise<Order>;
  /** 시험에서는 인메모리 job을 주입한다. 운영 기본값은 공용 원자화 job 러너다. */
  runRawInventoryJob?: typeof runRawInventoryJob;
}

/**
 * 완제품 1개당 오일 kg = **BOM 수량 그대로**. 오직 BOM만 본다.
 *
 * BOM 수량은 2026-08-14부터 언제나 kg으로 저장한다(기름도 마찬가지). 화면에서만 L로 보여준다.
 * 병 용량(spec)으로 계산하던 경로는 없앴다 — 근거가 둘이면 곱해져서(0.35² 같은) 이중 계산이 난다.
 */
export const perUnitOilKg = (bomQuantity: number): number => bomQuantity;

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

export function createOrderStockEngine(deps: OrderStockEngineDeps) {
  const { actorName, allItems, submaterials, partners, allOrders, orders, db,
    buildFormula, createProductionRecordsForOrder, updateItem, addItem,
    claimOrderOperation, runRawInventoryJob: runRawJob = runRawInventoryJob } = deps;
  const { applyOrderRawUsage, reverseOrderRawUsage } = createOrderRawInventoryOperations({
    actorName, allItems, partners, db,
    addNotification: notification => addItem('notifications', notification),
    runRawInventoryJob: runRawJob,
  });
  const {
    reserveOrderStock,
    orderStockReservationCleanup,
    releaseOrderStockReservation,
    applyItemStockDeltas,
  } = createOrderItemStockOperations({ db, allItems });
  /** 원장 줄에 붙일 작성자 — 빈 이름은 아예 안 적는다(Firestore 에 빈 칸을 만들지 않는다) */
  const 작성자 = actorName ? { addedBy: actorName } : {};

  //  셈은 [shipDeduction](../../shared/shipDeduction.ts) 한 곳이다 — 화면의 출고 확인창도
  //  같은 함수를 본다. 여기 한 벌 더 적어 두면 **말과 실제가 갈린다**(2026-09-15).
  const addDelta = (m: Map<string, number>, id: string, d: number) => { if (d) m.set(id, (m.get(id) ?? 0) + d); };
  const deltaRows = (m: Map<string, number>) => [...m]
    .filter(([, delta]) => delta !== 0)
    .map(([itemId, delta]) => ({ itemId, delta: Math.round(delta * 1000) / 1000 }));
  const bomSnapshotOf = (order: Order): OrderInventorySnapshot['bomLines'] => orderStockTouchedIds(order).flatMap(parentItemId =>
    bomOf(parentItemId).map(line => ({ parentItemId, childItemId: line.childId, quantity: line.qty }))
  );

  // 겉박스·테이프는 BOM으로만 깎는다. 박스 품목을 만들 때 그 BOM에 들어 있고,
  // 낱개 BOM에는 애초에 두지 않는다 — 거래처별 배송규칙 경로는 폐기했다.

  // 원료 kg 적재 = **item_bom(BOM) 반제품** 기준(등급). 로트·원장 둘 다 이걸로.
  //  · phantom 반제품(참기름특A 등) → buildFormula로 통깨/깨분 leaf 전개
  //  · 홀더(통깨참기름·깨분참기름)   → 직접 차감(비율=BOM 개입수)
  //  · BOM에 반제품이 없으면 품목 원료식으로 폴백(미이관 품목).
  //  여기서 쓰는 건 **실제 원장**(rawMaterialLedger) — 실제로 차감이 일어난 시점의 기록이다.
  //  관청에 내는 원료수불부는 **서류용 원장**(rawDocEntries)으로 서류 탭에서 따로 만든다(docOil.ts).
  const accrueRaw = (product: Item, units: number, rawUsage: Record<string, number>) => {
    // 조립 반제품(개 단위 wip = 무라벨 병 등): 오일 구성품 수량은 그 오일의 단위(L)로 직접 입력한 값.
    // → L×밀도(unitToKg)로 환산. 일반 완제품은 기존대로 용량(spec)이 오일량을 준다.
    const isAssembly = product.type === 'wip' && product.unit === '개';
    const oilSubs = bomOf(product.id)
      .map(l => ({ l, comp: allItems.find(p => p.id === l.childId) }))
      // 개수(개) 단위 반제품은 오일이 아니라 '조립 반제품'(무라벨 병 등) → accrueBom이 생산·차감. 벌크 반제품(L/kg)만 오일.
      .filter(({ comp }) => comp && isBulkItem(comp));
    if (oilSubs.length > 0) {
      for (const { l, comp } of oilSubs) {
        const qty = l.qty;
        if (!comp || qty <= 0) continue;
        const perUnitKg = () => perUnitOilKg(qty);
        if (comp.phantom) {
          for (const f of buildFormula(comp.name)) {
            const kg = isAssembly
              ? qty * units * f.ratio                                // qty는 이미 kg
              : perUnitKg() * units * f.ratio;
            if (kg > 0) rawUsage[f.raw] = (rawUsage[f.raw] ?? 0) + kg;
          }
        } else {
          const raw = baseRawName(comp.name);
          const kg = isAssembly
            ? qty * units
            : perUnitKg() * units;
          if (kg > 0) rawUsage[raw] = (rawUsage[raw] ?? 0) + kg;
        }
      }
      return;
    }
    for (const f of buildFormula(docName(product))) {
      const kg = toKg(product.spec || '', f.raw, units) * f.ratio;
      if (kg > 0) rawUsage[f.raw] = (rawUsage[f.raw] ?? 0) + kg;
    }
  };

  /**
   * BOM 차감/복원 — **구성품 × 수량**만큼 그 품목 재고에서 뺀다. 부자재·완제품 구분 없다.
   *
   * 완제품 구성품(선물세트에 든 병 등)이 모자라면 그만큼 **먼저 만든다**: 재고를 채우고
   * 그 병의 BOM·원료까지 재귀로 내려간다. 만든 수량은 autoBuilt에 남겨 되돌리기 때 쓴다.
   * 겉박스·테이프는 박스 품목 BOM에 들어 있어 여기서 제외한다.
   * sign=-1 차감 / +1 복원.
   *
   * stockCap — 구성품 재고를 이만큼까지만 쓴다(사용자가 모달에서 정한 낱개 사용량). 없으면 있는 대로 다 쓴다.
   */
  const accrueBom = (
    order: Order, product: Item, units: number,
    deltas: Map<string, number>, rawUsage: Record<string, number>,
    sign: number, autoBuilt: { itemId: string; qty: number }[], depth = 0,
    stockCap?: Map<string, number>,
    stockOf?: (item: Item) => number,
  ) => {
    if (units <= 0 || depth > 4) return;   // depth — BOM 순환 방어
    for (const line of bomOf(product.id)) {
      const comp = allItems.find(p => p.id === line.childId);
      if (!comp) continue;
      // 겉박스·테이프도 BOM에 있으면 그대로 깎는다 — 낱개 BOM엔 그것들을 안 둔다
      // (박스 품목을 만들 때 그 BOM으로 잡힌다). BOM이 곧 구성이다.
      // 원료·벌크 반제품(L/kg)은 kg로 원료식 경로에서 처리. 개수(개) 단위 반제품(조립)은 완제품처럼 여기서 생산·차감.
      if (isBulkItem(comp)) continue;
      const need = Math.round(units * line.qty * 1000) / 1000;
      if (need <= 0) continue;

      // 완제품·개수단위 반제품(조립)이 모자라면 먼저 만든다(그 BOM·오일까지 재귀).
      // 재고를 얼마나 쓸지는 stockCap이 정한다(0이면 전부 새로 생산). 그래도 차감은 need 전액 —
      // 먼저 만든 short가 상쇄해서 순변화는 딱 '쓴 재고'만큼이 된다.
      //  판정은 `holdsUnitStock` 한 곳이다 — 여기 적혀 있던 `unit === '개'` 가 단위를
      //  '캔'으로 쓴 품목을 빠뜨렸다(시골향참기름1-캔).
      if (sign < 0 && holdsUnitStock(comp) && !isGoodsItem(comp)) {
        if (!stockOf) throw new Error(`생산 재고 스냅샷이 없습니다: ${comp.id}`);
        const onHand = stockOf(comp) + (deltas.get(comp.id) ?? 0);
        const cap = stockCap?.get(comp.id);
        const have = Math.max(0, cap === undefined ? onHand : Math.min(onHand, cap));
        const short = Math.round((need - have) * 1000) / 1000;
        if (short > 0) {
          addDelta(deltas, comp.id, short);
          autoBuilt.push({ itemId: comp.id, qty: short });
          accrueBom(order, comp, short, deltas, rawUsage, sign, autoBuilt, depth + 1, undefined, stockOf);
          accrueRaw(comp, short, rawUsage);
        }
      }
      addDelta(deltas, comp.id, sign * need);
    }
  };

  /** 실패한 재처리를 다시 시도할 때 DB에 남은 앞선 생산분을 계산판에서 먼저 제거한다. */
  const addPreviousProductionRollback = (order: Order, deltas: Map<string, number>) => {
    const already = order.rawConsumedLots ?? [];
    if (already.length === 0) return false;
    const previousProduction = order.inventorySnapshots?.production;
    if (!previousProduction) {
      throw new Error(`생산 재처리 중단: 이전 품목 재고 스냅샷이 없습니다 (주문 ${order.id})`);
    }
    previousProduction.stockDeltas.forEach(row => addDelta(deltas, row.itemId, -row.delta));
    return true;
  };

  /**
   * DB 쓰기 없이 생산량·원료 사용량·품목 증감을 계산한다.
   * 예약 transaction과 실제 생산이 반드시 같은 함수를 써야 둘의 배정량이 갈리지 않는다.
   */
  const planOrderProduction = (
    order: Order,
    deltas: Map<string, number>,
    stockSnapshot: ReadonlyMap<string, number>,
    plan?: StockUsePlan,
  ) => {
    const stockOf = (item: Item) => {
      const stock = stockSnapshot.get(item.id);
      if (stock === undefined) throw new Error(`주문 재고 스냅샷에 품목이 없습니다: ${item.id}`);
      return stock;
    };
    const rawUsage: Record<string, number> = {};
    const rawUsageLedgerOnly: Record<string, number> = {};   // 임가공 — 수불부에만
    const autoBuilt: { itemId: string; qty: number }[] = []; // 모자라서 먼저 만든 구성품
    const producedByItem = new Map<string, number>();        // 실제 생산량 — 되돌리기용
    for (const [idx, item] of order.items.entries()) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) throw new Error(`주문 품목 기준정보를 찾을 수 없습니다: ${item.itemId}`);
      /**
       * **벌크를 그대로 파는 주문** — 볶음참깨 20kg 자루 같은 것.
       *
       * 완제품이 아니라 예전엔 통째로 건너뛰었다. 주문 화면이 완제품만 띄우던 시절엔
       * 들어올 일이 없었는데, 연결된 품목이면 다 뜨게 바꾸면서 길이 열렸다.
       * 안 막으면 **팔아도 재고·로트·원장이 하나도 안 움직인다.**
       *
       * 원료식과 같은 길(rawUsage)로 보낸다 — 로트 FIFO 차감과 원장 기록이 저절로 따라온다.
       * 로트는 kg으로 세므로 L 단위 품목은 밀도로 환산한다.
       */
      if (isBulkItem(product)) {
        const raw = baseRawName(product.name);
        const usedKg = unitToKg(stockUnits(item, product), raw);
        if (usedKg > 0) {
          rawUsage[raw] = Math.round(((rawUsage[raw] ?? 0) + usedKg) * 1000) / 1000;
          //  **재고는 따로 안 뺀다** — 로트를 깎으면 `mutateRawMaterialLots` 가 stock 을
          //  로트 합계로 맞춘다(2026-09-16 `lotsAreTotal` 예외를 걷어냈다). 여기서 또
          //  빼면 **두 번 빠진다.**
        }
        continue;
      }
      //  **캔 같은 개수 반제품도 여기 든다**(2026-09-16) — 판정은 `holdsUnitStock` 한 곳.
      //  `type === 'product'` 로만 보다가 캔을 반제품으로 옮기면 생산이 조용히 멈춘다.
      if (!holdsUnitStock(product)) continue;
      const units = stockUnits(item, product);   // 박스 품목이면 박스 개수

      // 임가공(OEM): 완제품은 가공입고로 이미 재고에 있고 원료도 우리 로트가 아니다.
      // 재고는 아무것도 안 건드리되, 원료수불부에는 쓴 만큼 kg으로 남긴다(서류가 흐름을 봐야 함).
      if (product.procureType === '임가공') {
        for (const [raw, kg] of Object.entries(oemLedgerKg(product, units, buildFormula(docName(product)))))
          rawUsageLedgerOnly[raw] = (rawUsageLedgerOnly[raw] ?? 0) + kg;
        continue;
      }

      if (isGoodsItem(product)) continue;

      // 이 품목 자신의 재고로 충당할 몫. 앞선 라인이 이미 쓴 만큼(deltas)은 빠진 값으로 본다.
      const onHand = Math.max(0, stockOf(product) + (deltas.get(product.id) ?? 0));
      const choice = plan?.[idx];
      const own = Math.min(choice ? Math.max(0, choice.own) : onHand, onHand, units);
      const toProduce = Math.round((units - own) * 1000) / 1000;
      if (toProduce <= 0) continue;

      // 박스 품목이면 낱개 재고 사용량도 사용자가 정한 만큼으로 묶는다.
      const looseId = unpackComponent(product)?.itemId;
      const stockCap = looseId && choice?.loose !== undefined
        ? new Map([[looseId, Math.max(0, choice.loose)]]) : undefined;

      accrueBom(order, product, toProduce, deltas, rawUsage, -1, autoBuilt, 0, stockCap, stockOf);
      // 구성품에 완제품이 있으면 accrueBom이 그 완제품을 따라 내려가며 원료를 뺀다.
      if (!hasProductComponent(product)) accrueRaw(product, toProduce, rawUsage);
      addDelta(deltas, product.id, toProduce);
      producedByItem.set(product.id, (producedByItem.get(product.id) ?? 0) + toProduce);
    }
    return {
      rawUsage,
      rawUsageLedgerOnly,
      autoBuilt,
      producedUnits: [...producedByItem].map(([itemId, qty]) => ({ itemId, qty })),
    };
  };

  // 생산처리(작업완료): 원료·부자재 차감 + 완제품 재고 +(생산분). → 소비 로트 스냅샷 반환.
  // 순변화 = 쓴 재고만큼. 얼마나 쓸지는 plan(사용자 선택)이 정하고, 없으면 있는 만큼 다 쓴다.
  const produceOrder = async (
    order: Order,
    deltas: Map<string, number>,
    stockSnapshot: ReadonlyMap<string, number>,
    plan?: StockUsePlan,
  ) => {
    // **같은 주문은 원료를 한 번만 뺀다.**
    //   원장 줄은 id가 `rm-auto-{주문}-{원료}`로 고정이라 두 번째 처리 때 덮어써지는데,
    //   로트는 mutateRawMaterialLots가 부를 때마다 깎아서 한쪽만 이중이 됐다.
    //   (생들기름 775.98kg = 8/04 277.2 + 8/05 249.48 + 8/14 249.3 세 건이 각각 두 번씩 빠졌다)
    //   바깥 가드(`wantProduced && !order.producedAt`)는 **화면 상태**를 보므로 다른 탭·중복 클릭으로
    //   낡으면 그냥 통과한다 — 재고 음수를 만들던 것과 같은 낡은-상태 문제다.
    //   → DB의 지금 값을 직접 보고, 이미 빼둔 몫이 있으면 되돌린 뒤 새로 뺀다.
    //     (수량이 바뀐 재처리도 이 순서면 맞는 값으로 끝난다)
    const fresh = await getDoc(doc(db, 'orders', order.id));
    const freshOrder = fresh.exists() ? ({ ...order, ...(fresh.data() as Partial<Order>) } as Order) : order;
    if (freshOrder.producedAt) {
      return {
        consumedLots: freshOrder.rawConsumedLots ?? [],
        autoBuilt: freshOrder.autoBuilt ?? [],
        producedUnits: freshOrder.producedUnits ?? [],
        attempt: freshOrder.rawInventoryAttempt ?? 0,
        alreadyProduced: true,
      };
    }
    const already = freshOrder.rawConsumedLots ?? [];
    if (addPreviousProductionRollback(freshOrder, deltas)) {
      /*
       * 원료 작업만 되돌리고 새 수량을 계산하면, DB에 남아 있는 이전 완제품이 가용 재고로 잡혀
       * 새 생산량이 0이 된다. 이전 생산의 품목 델타도 같은 계산판에서 먼저 뒤집어야
       * `+1000 생산 → 수량 900으로 정정`이 `-1000 +900`으로 끝난다.
       */
      console.warn(`[생산 재처리] ${order.id} — 이미 기록된 원료 작업 ${already.length}건을 되돌리고 다시 처리한다`);
      await reverseOrderRawUsage(freshOrder);
    }
    const attempt = (freshOrder.rawInventoryAttempt ?? 0) + 1;
    const production = planOrderProduction(freshOrder, deltas, stockSnapshot, plan);
    const consumedLots = await applyOrderRawUsage(
      freshOrder, production.rawUsage, attempt, production.rawUsageLedgerOnly,
    );
    await createProductionRecordsForOrder(freshOrder);
    return { consumedLots, ...production, attempt, alreadyProduced: false };
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
          return { itemId: item.itemId, qty: p ? stockUnits(item, p) : 0 };
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
    await reverseOrderRawUsage(order);
  };

  /**
   * 출고 — **타입을 안 가리고 판 만큼 뺀다.**
   *
   * 예전엔 완제품(type='product')과 상품만 뺐다. 주문 화면이 완제품만 띄우던 시절의 규칙인데,
   * "연결된 품목이면 다 뜬다"로 바꾸면서 부자재·조립반제품도 팔 수 있게 됐다.
   * 안 빼면 **팔아도 재고가 그대로 남는다.**
   *
   * 벌크(L/kg 반제품·원료)만 예외다 — 그쪽은 생산처리에서 rawUsage로 로트·원장까지 함께
   * 빠지므로, 여기서 또 빼면 두 번 빠진다.
   */
  const shipOrder = (order: Order, deltas: Map<string, number>) => {
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) continue;
      addDelta(deltas, product.id, -shipQtyOfLine(item, product));
    }
  };

  // 출고 취소 — shipOrder와 같은 규칙이어야 되돌린 값이 맞는다.
  const unShipOrder = (order: Order, deltas: Map<string, number>) => {
    for (const item of order.items) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) continue;
      addDelta(deltas, product.id, shipQtyOfLine(item, product));
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
    isGoodsItem(product) ? goodsShipQty(item, product)
      //  캔 같은 개수 반제품도 출고 때 빠진다 — 안 그러면 팔아도 재고가 그대로 남는다.
      : holdsUnitStock(product) ? stockUnits(item, product) : 0;

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
  ) => {
    if (target === OrderStatus.ON_HOLD) return { patch: {} as Partial<Order>, stockAdjustments: [] as { itemId: string; delta: number }[] };
    const wantProduced = STATUS_WANT_PRODUCED.has(target);
    const wantShipped = STATUS_WANT_SHIPPED.has(target);
    const deltas = new Map<string, number>();
    const patch: Partial<Order> = {};
    let productLotMutations: OrderProductLotMutation[] = [];
    let shipmentStockDeltas: { itemId: string; delta: number }[] | undefined;
    const needsForwardProduction = wantProduced && !order.producedAt;
    const needsForwardShipment = wantShipped && !order.shippedOut;
    const wantsAllocationUntilShipment = wantProduced && !wantShipped;
    const reservationExtraItemIds = [
      ...(order.inventorySnapshots?.production?.stockDeltas.map(row => row.itemId) ?? []),
      ...(order.inventorySnapshots?.shipment?.stockDeltas.map(row => row.itemId) ?? []),
    ];
    const reservation = needsForwardProduction || needsForwardShipment || wantsAllocationUntilShipment
      ? await reserveOrderStock(
          order,
          inventoryOperationId ?? `order-inventory-${order.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          stockSnapshot => {
            const preview = new Map<string, number>();
            if (needsForwardProduction) {
              addPreviousProductionRollback(order, preview);
              planOrderProduction(order, preview, stockSnapshot, plan);
            }
            // 작업완료 상태에서도 실제 출고 전까지 이 주문 전체 물량을 잡아 둔다.
            // 생산분을 더한 뒤 출고한다고 가정한 순변화가 지금 재고에서 선점할 몫이다.
            if (needsForwardShipment || wantsAllocationUntilShipment) shipOrder(order, preview);
            return preview;
          },
          reservationExtraItemIds,
        )
      : undefined;
    if (reservation && wantsAllocationUntilShipment) {
      const shipment = new Map<string, number>();
      shipOrder(order, shipment);
      reservation.allocationQuantities = new Map(
        [...shipment].filter(([, delta]) => delta < 0).map(([itemId, delta]) => [itemId, -delta]),
      );
    }
    const reservationContext = reservation ?? orderStockReservationCleanup(order, reservationExtraItemIds);
    let stockCommitted = false;

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
          snapshot.stockDeltas.forEach(row => addDelta(deltas, row.itemId, -row.delta));
          await reverseOrderRawUsage({ ...order, rawConsumedLots: snapshot.rawConsumedLots ?? order.rawConsumedLots });
        } else await unProduceOrder(order, deltas);
        patch.producedAt = ''; patch.rawLotsDeducted = false; patch.rawConsumedLots = []; patch.autoBuilt = []; patch.producedUnits = [];
        if (order.itemInventory) {
          const reversedAt = new Date().toISOString();
          patch.itemInventory = Object.fromEntries(Object.entries(order.itemInventory).map(([lineId, state]) => [
            lineId, state.applied ? { ...state, applied: false, reversedAt } : state,
          ]));
        }
      }
      // 정방향: 생산 → 출고
      if (needsForwardProduction) {
        const productionDeltasBefore = new Map(deltas);
        if (!reservation) throw new Error(`주문 재고 예약이 없습니다: ${order.id}`);
        const { consumedLots, autoBuilt, producedUnits, attempt, alreadyProduced } = await produceOrder(
          order, deltas, reservation.stockSnapshot, plan,
        );
        if (!alreadyProduced) {
          patch.producedAt = new Date().toISOString(); patch.rawLotsDeducted = true;
          patch.rawInventoryAttempt = attempt;
          // 빈 결과여도 반드시 덮어쓴다 — 안 쓰면 이전 생산의 스냅샷이 남아, 취소 때
          // 이번에 빼지도 않은 양을 되돌려버린다(유령 복원).
          patch.rawConsumedLots = consumedLots;
          // 생산량도 마찬가지로 항상 쓴다. 빈 배열([])과 없음(undefined)은 뜻이 다르다 —
          // 없음은 '옛 주문(전량 생산)'이라 되돌리기가 주문량으로 계산한다.
          patch.producedUnits = producedUnits;
          if (autoBuilt.length > 0) patch.autoBuilt = autoBuilt;
          const productionDeltas = new Map<string, number>();
          for (const [itemId, value] of deltas) addDelta(productionDeltas, itemId, value - (productionDeltasBefore.get(itemId) ?? 0));
          patch.inventorySnapshots = {
            ...order.inventorySnapshots,
            version: 1,
            production: {
              capturedAt: new Date().toISOString(),
              stockDeltas: deltaRows(productionDeltas),
              bomLines: bomSnapshotOf(order),
              rawConsumedLots: consumedLots,
              rawLedgerIds: rawLedgerDocIds(consumedLots),
            },
          };
        }
      }
      if (needsForwardShipment) {
        const shipmentDeltasBefore = new Map(deltas);
        shipOrder(order, deltas); patch.shippedOut = true;
        productLotMutations = deductProductLotsForOrder(order);
        const shipmentDeltas = new Map<string, number>();
        for (const [itemId, value] of deltas) addDelta(shipmentDeltas, itemId, value - (shipmentDeltasBefore.get(itemId) ?? 0));
        shipmentStockDeltas = deltaRows(shipmentDeltas);
      }
      const productConsumedLots = await applyItemStockDeltas(deltas, productLotMutations, reservationContext);
      stockCommitted = true;
      if (shipmentStockDeltas) {
        // 빈 배열이어도 반드시 쓴다 — 안 쓰면 이전 출고의 스냅샷이 남아 취소 때 유령 복원이 된다.
        patch.productConsumedLots = productConsumedLots;
        patch.inventorySnapshots = {
          ...(patch.inventorySnapshots ?? order.inventorySnapshots),
          version: 1,
          shipment: {
            capturedAt: new Date().toISOString(),
            stockDeltas: shipmentStockDeltas,
            bomLines: [],
            productConsumedLots,
          },
        };
      }
      if (!deferOrderPatch && Object.keys(patch).length > 0) await updateItem('orders', order.id, patch);
      return { patch, stockAdjustments: deltaRows(deltas) };
    } catch (error) {
      if (reservation && !stockCommitted) {
        try {
          await releaseOrderStockReservation(reservation);
        } catch (releaseError) {
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

  /** 체크된 품목만 출고 전 배정으로 남긴다. 생산에 사용한 구성품은 이미 stock에서 빠져 있다. */
  const completedLineAllocation = (
    order: Order,
    items: readonly OrderItem[],
    states: Record<string, OrderItemInventoryState>,
  ) => {
    const completed = items.filter(item => !!item.lineId && states[item.lineId]?.applied);
    const shipment = new Map<string, number>();
    shipOrder({ ...order, items: completed }, shipment);
    return new Map([...shipment]
      .filter(([, delta]) => delta < 0)
      .map(([itemId, delta]) => [itemId, -delta]));
  };

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
  ) => {
    if (inFlightOrders.has(id)) return;
    inFlightOrders.add(id);
    let reservation: Awaited<ReturnType<typeof reserveOrderStock>> | undefined;
    let stockCommitted = false;
    let live: Order | undefined;
    try {
      const cached = allOrders.find(order => order.id === id) || orders.find(order => order.id === id);
      live = await getFreshOrder(id, true) ?? cached;
      if (!live) throw new Error('주문 정보를 확인할 수 없어 품목 작업을 저장할 수 없습니다.');

      let nextItems = ensureOrderLineIds(requestedItems);
      const after = nextItems[itemIndex];
      if (!after) throw new Error('주문 품목을 찾을 수 없습니다. 새로고침 후 다시 확인해 주세요.');
      const lineId = after.lineId!;
      const applying = after.checked === true;

      const now = new Date().toISOString();
      const operationId = `order-line-${id}-${lineId}-${Date.now()}`;
      const operation = {
        id: operationId, targetStatus: nextStatus, state: 'processing' as const,
        startedAt: now, actor: actorName ?? '미기록',
      };
      if (claimOrderOperation) live = await claimOrderOperation(id, live.status, operation);
      else await updateItem('orders', id, { inventoryOperation: operation });
      const operationOrder = live;

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
        const checkedCount = nextItems.filter(item => item.checked).length;
        effectiveStatus = checkedCount === nextItems.length ? OrderStatus.DISPATCHED
          : checkedCount > 0 ? OrderStatus.PROCESSING : OrderStatus.PENDING;
      }
      const currentStates = { ...(operationOrder.itemInventory ?? {}) };
      const previousState = currentStates[lineId];
      if (!!before.checked === applying && (!!previousState?.applied === applying || !applying)) {
        await updateItem('orders', id, { items: nextItems, status: effectiveStatus, inventoryOperation: null });
        return;
      }
      // 품목별 구조가 없는 옛 생산 주문은 한 줄만 정확히 분리할 근거가 없다.
      // 그 경우 기존 주문 전체 스냅샷 경로로만 되돌려야 한다.
      if (!applying && operationOrder.producedAt && !previousState) {
        await updateItem('orders', id, { inventoryOperation: null });
        throw new Error('LEGACY_ORDER_ROLLBACK_REQUIRED');
      }

      const pendingApplyRows = applying
        ? nextItems.map((item, index) => ({ item, index }))
            .filter(({ item }) => item.checked && !currentStates[item.lineId!]?.applied)
        : [];
      const inventoryOrder = { ...operationOrder, items: pendingApplyRows.length > 0 ? pendingApplyRows.map(row => row.item) : [after] };
      const extraItemIds = [
        ...orderStockTouchedIds({ items: nextItems.filter(item => item.checked) }),
        ...Object.values(currentStates).flatMap(state => state.production.stockDeltas.map(row => row.itemId)),
        ...(operationOrder.inventorySnapshots?.shipment?.stockDeltas.map(row => row.itemId) ?? []),
      ];
      reservation = await reserveOrderStock(
        inventoryOrder,
        operationId,
        stockSnapshot => {
          const preview = new Map<string, number>();
          if (applying) {
            for (const row of pendingApplyRows) {
              const single = { ...operationOrder, items: [row.item] };
              planOrderProduction(single, preview, stockSnapshot, row.index === itemIndex ? plan : undefined);
              // 생산 순변화만 예약하면 이 줄이 쓸 기존 완제품이 보호되지 않는다.
              shipOrder(single, preview);
            }
          }
          return preview;
        },
        extraItemIds,
        { preserveOwnAllocation: true },
      );

      const deltas = new Map<string, number>();
      const states = { ...currentStates };
      if (applying) {
        for (const row of pendingApplyRows) {
          const rowLineId = row.item.lineId!;
          const rowBefore = new Map(deltas);
          const previous = currentStates[rowLineId];
          const attempt = (previous?.attempt ?? 0) + 1;
          const single = { ...operationOrder, items: [row.item] };
          const production = planOrderProduction(
            single, deltas, reservation.stockSnapshot, row.index === itemIndex ? plan : undefined,
          );
          const consumedLots = await applyOrderRawUsage(
            single, production.rawUsage, attempt, production.rawUsageLedgerOnly, rowLineId,
          );
          await createProductionRecordsForOrder(single);
          const rowDeltas = new Map<string, number>();
          for (const [itemId, value] of deltas) addDelta(rowDeltas, itemId, value - (rowBefore.get(itemId) ?? 0));
          const snapshot: OrderInventorySnapshot = {
            capturedAt: now,
            stockDeltas: deltaRows(rowDeltas),
            bomLines: bomSnapshotOf(single),
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
          await updateItem('orders', id, { items: nextItems, status: effectiveStatus, inventoryOperation: null });
          await releaseOrderStockReservation(reservation);
          reservation = undefined;
          return;
        }
        previousState.production.stockDeltas.forEach(row => addDelta(deltas, row.itemId, -row.delta));
        await reverseOrderRawUsage({
          ...operationOrder,
          items: [after],
          rawConsumedLots: previousState.rawConsumedLots,
          rawInventoryAttempt: previousState.attempt,
        }, lineId);
        states[lineId] = { ...previousState, applied: false, reversedAt: now };
      }

      reservation.allocationQuantities = completedLineAllocation(operationOrder, nextItems, states);
      const aggregate = aggregateOrderLineInventory(operationOrder, states);
      const orderPatch: Record<string, unknown> = {
        items: nextItems,
        status: effectiveStatus,
        itemInventory: states,
        ...aggregate,
        inventoryOperation: null,
      };
      await applyItemStockDeltas(deltas, [], reservation, { orderId: id, patch: orderPatch });
      stockCommitted = true;

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
      if (reservation && !stockCommitted) {
        try { await releaseOrderStockReservation(reservation); }
        catch (releaseError) { console.error(`[품목 재고 예약 해제 실패] ${id}`, releaseError); }
      }
      // 이미 실패 잠금이 있는 주문을 다시 누르면 claim 단계가 막는다. 그 2차 오류로 최초 실패
      // 사유를 덮어쓰면 무엇을 고쳐야 하는지 영영 알 수 없으므로 기존 기록을 그대로 둔다.
      const existingFailure = live?.inventoryOperation?.state === 'failed';
      if (!existingFailure && error instanceof Error && error.message !== 'LEGACY_ORDER_ROLLBACK_REQUIRED') {
        await updateItem('orders', id, {
          inventoryOperation: {
            id: `order-line-failed-${Date.now()}`, targetStatus: nextStatus, state: 'failed',
            startedAt: new Date().toISOString(), actor: actorName ?? '미기록', error: error.message,
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
    return { order, plan: buildRollbackPlan(order, allItems, order.status, status) };
  };

  const changeOrderStatus = async (id: string, status: OrderStatus, plan?: StockUsePlan, context: OrderStatusChangeContext = {}) => {
    // 같은 주문이 동시에 두 번 생산 처리되는 것을 막는다.
    //  품목 체크가 연달아 들어오면 handleToggleItemChecked가 같은 틱에 작업완료를 여러 번 부르는데,
    //  producedAt 판정이 React 상태 기준이라 전부 통과해 원료가 배수로 빠졌다(수입들기름 3배).
    if (inFlightOrders.has(id)) return;
    inFlightOrders.add(id);
    try {
      const order = allOrders.find(o => o.id === id) || orders.find(o => o.id === id);
      if (!order) {
        if (isWorkCompletedState(status)) throw new Error('주문 정보를 확인할 수 없어 작업완료 상태로 변경할 수 없습니다.');
        await updateItem('orders', id, { status });
        return;
      }
      // producedAt·shippedOut은 DB에서 다시 읽는다 — React 상태는 같은 틱에 갱신되지 않아
      // 직전 호출이 이미 생산했는지 알 수 없다.
      let live = await getFreshOrder(id, !!context.approvedPlan) ?? order;
      if (live.status === status) {
        await updateItem('orders', id, { status });
        return;
      }
      const nextItems = context.orderPatch?.items ?? live.items;
      if (requiresCompleteItemsForStatusChange(live.status, status) && !hasCompleteOrderItems(nextItems)) {
        throw new Error('모든 주문 품목의 작업완료 여부를 확인한 뒤 상태를 변경해 주세요.');
      }
      const approvedAt = context.approvedAt ?? new Date().toISOString();
      const approvedBy = context.approvedBy ?? actorName ?? '미기록';
      const auditId = `order-status-${id}-${Date.now()}`;
      const operation = { id: auditId, targetStatus: status, state: 'processing' as const, startedAt: approvedAt, actor: approvedBy };
      if (claimOrderOperation) live = await claimOrderOperation(id, live.status, operation);
      else await updateItem('orders', id, { inventoryOperation: operation });
      if (context.approvedPlan) {
        const latestPlan = buildRollbackPlan(live, allItems, live.status, status);
        const approvedRows = JSON.stringify(context.approvedPlan.adjustments);
        const latestRows = JSON.stringify(latestPlan.adjustments);
        if (live.status !== context.approvedFromStatus || context.approvedPlan.legacyEvidenceWarning !== latestPlan.legacyEvidenceWarning || approvedRows !== latestRows) {
          await updateItem('orders', id, { inventoryOperation: null });
          throw new Error('승인 후 주문 상태 또는 재고 원복 계획이 변경되었습니다. 다시 확인해 주세요.');
        }
      }
      let result = { patch: {} as Partial<Order>, stockAdjustments: [] as { itemId: string; delta: number }[] };
      const initialAudit: OrderStatusAudit = {
        id: auditId, orderId: id, partnerName: live.partnerName, previousStatus: live.status, nextStatus: status,
        approvedBy, approvedAt, state: 'processing', legacyEvidenceWarning: !!context.approvedPlan?.legacyEvidenceWarning,
        stockAdjustments: context.approvedPlan?.adjustments.map(({ itemId, name, unit, delta }) => ({ itemId, name, unit, delta })) ?? [],
      };
      try {
        await addItem('orderStatusAudits', initialAudit);
        // 같은 상태 재저장만 재고를 건너뛴다. 예전 주문(DELIVERED)도 실제로 역행시키면
        // 출고·생산 스냅샷을 따라 반드시 원복돼야 한다.
        if (live.status !== status) result = await reconcileOrderStock(live, status, plan, true, operation.id);
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
        await updateItem('orders', id, { ...result.patch, ...context.orderPatch, status, inventoryOperation: null });
        await addItem('orderStatusAudits', { ...initialAudit, state: 'completed', completedAt: new Date().toISOString(), stockAdjustments: namedAdjustments });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateItem('orders', id, { inventoryOperation: { ...operation, state: 'failed', error: message } });
        await addItem('orderStatusAudits', { ...initialAudit, state: 'failed', completedAt: new Date().toISOString(), error: message });
        throw error;
      }
    } finally {
      inFlightOrders.delete(id);
    }
  };

  return { changeOrderStatus, changeOrderItemCompletion, reconcileOrderStock, prepareOrderStatusChange };
}
