import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { bomOf } from '../../shared/bomIndex';
import { pruneDepletedLots } from '../../shared/lotUtils';
import type { Item, ItemInventoryReservation, Order } from '../../shared/types';
import type { OrderProductLotMutation } from './orderProductLots';

export interface OrderItemStockDeps {
  db: Firestore;
  allItems: Item[];
}

const stock3 = (value: number) => Math.round(value * 1000) / 1000;
const stripUndefined = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const RESERVATION_TTL_MS = 60 * 60 * 1000;

export interface OrderStockReservation {
  operationId: string;
  orderId: string;
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
export function orderStockTouchedIds(order: Pick<Order, 'items'>): string[] {
  const seen = new Set<string>();
  const walk = (itemId: string, depth: number) => {
    if (depth > 5 || seen.has(itemId)) return;
    seen.add(itemId);
    for (const line of bomOf(itemId)) walk(line.childId, depth + 1);
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
export function createOrderItemStockOperations(deps: OrderItemStockDeps) {
  const { db, allItems } = deps;

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
    options: { preserveOwnAllocation?: boolean } = {},
  ): Promise<OrderStockReservation> => {
    const ids = [...new Set([...orderStockTouchedIds(order), ...extraItemIds])];
    const now = new Date();
    const nowMs = now.getTime();
    const createdAt = now.toISOString();

    return runTransaction(db, async tx => {
      const refs = ids.map(itemId => doc(db, 'items', itemId));
      const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
      const missing = ids.filter((_, index) => !snapshots[index]!.exists());
      if (missing.length > 0) {
        throw new Error(`주문 재고 예약 중 품목을 찾을 수 없습니다: ${missing.join(', ')}`);
      }

      const activeByItem = new Map<string, ItemInventoryReservation[]>();
      const previousReservations = new Map<string, ItemInventoryReservation[]>();
      const available = new Map<string, number>();
      ids.forEach((itemId, index) => {
        const data = snapshots[index]!.data() ?? {};
        const active = liveItemInventoryReservations(data.inventoryReservations, nowMs);
        const own = active.filter(row => row.orderId === order.id);
        const others = active.filter(row => row.orderId !== order.id);
        previousReservations.set(itemId, own);
        activeByItem.set(itemId, others);
        const ownAllocated = options.preserveOwnAllocation
          ? own.filter(row => row.state === 'allocated').reduce((sum, row) => sum + Number(row.qty), 0)
          : 0;
        const reserved = others.reduce((sum, row) => sum + Number(row.qty), 0) + ownAllocated;
        available.set(itemId, stock3(Math.max(0, Number(data.stock ?? 0) - reserved)));
      });

      const planned = planDeltas(available);
      const outside = [...planned.keys()].filter(itemId => !available.has(itemId));
      if (outside.length > 0) {
        throw new Error(`주문 재고 예약 범위에 없는 품목이 계산되었습니다: ${outside.join(', ')}`);
      }
      const quantities = new Map<string, number>();
      ids.forEach(itemId => {
        const previousQty = options.preserveOwnAllocation
          ? (previousReservations.get(itemId) ?? [])
              .filter(row => row.state === 'allocated')
              .reduce((sum, row) => sum + Number(row.qty), 0)
          : 0;
        const qty = stock3(previousQty + Math.max(0, -(planned.get(itemId) ?? 0)));
        if (qty > 0) quantities.set(itemId, qty);
      });

      ids.forEach((itemId, index) => {
        const data = snapshots[index]!.data() ?? {};
        const active = activeByItem.get(itemId) ?? [];
        const qty = quantities.get(itemId) ?? 0;
        const next = qty > 0
          ? [...active, { operationId, orderId: order.id, qty, createdAt, state: 'processing' as const }]
          : active;
        // 만료되었거나 같은 작업의 낡은 예약도 이 transaction에서 걷어낸다.
        if (qty > 0 || Array.isArray(data.inventoryReservations)) {
          tx.update(refs[index]!, { inventoryReservations: next });
        }
      });

      return {
        operationId,
        orderId: order.id,
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
    itemIds: [...new Set([...orderStockTouchedIds(order), ...extraItemIds])],
    quantities: new Map(),
    stockSnapshot: new Map(),
    previousReservations: new Map(),
    active: false,
  });

  /** 원료 작업 등이 실패해 최종 재고 반영까지 가지 못한 예약을 풀어 준다. */
  const releaseOrderStockReservation = async (reservation: OrderStockReservation): Promise<void> => {
    if (reservation.itemIds.length === 0) return;
    const nowMs = Date.now();
    await runTransaction(db, async tx => {
      const refs = reservation.itemIds.map(itemId => doc(db, 'items', itemId));
      const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
      snapshots.forEach((snapshot, index) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data() ?? {};
        const active = liveItemInventoryReservations(data.inventoryReservations, nowMs);
        const hasCurrent = active.some(row => row.orderId === reservation.orderId && row.operationId === reservation.operationId);
        if (!hasCurrent) return;
        const otherOrders = active.filter(row => row.orderId !== reservation.orderId);
        const previous = reservation.previousReservations.get(reservation.itemIds[index]!) ?? [];
        tx.update(refs[index]!, { inventoryReservations: [...otherOrders, ...previous] });
      });
    });
  };

  const applyItemStockDeltas = async (
    deltas: ReadonlyMap<string, number>,
    lotMutations: readonly OrderProductLotMutation[] = [],
    reservation?: OrderStockReservation,
    orderMutation?: { orderId: string; patch: Record<string, unknown> },
  ): Promise<NonNullable<Order['productConsumedLots']>> => {
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
    if (rows.length === 0) return [];

    const missingCatalog = rows.filter(row => !row.item).map(row => row.itemId);
    if (missingCatalog.length > 0) {
      throw new Error(`재고 반영 중 품목 기준정보를 찾을 수 없습니다: ${missingCatalog.join(', ')}`);
    }

    const changed = await runTransaction(db, async tx => {
      const refs = rows.map(row => doc(db, 'items', row.itemId));
      // Firestore transaction은 첫 write 전에 모든 read가 끝나야 한다.
      const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
      const missingDocs = rows.filter((_, index) => !snapshots[index]!.exists()).map(row => row.itemId);
      if (missingDocs.length > 0) {
        throw new Error(`재고 반영 중 품목 문서를 찾을 수 없습니다: ${missingDocs.join(', ')}`);
      }

      const updates = rows.map((row, index) => {
        const data = snapshots[index]!.data() ?? {};
        const before = Number(data.stock ?? 0);
        const lotResult = row.lotMutation?.apply(Array.isArray(data.lots) ? data.lots : []);
        const patch: { stock?: number; lots?: unknown[]; inventoryReservations?: ItemInventoryReservation[] } = {};
        if (row.delta !== 0) patch.stock = stock3(before + row.delta);
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
      for (const update of updates) {
        if (Object.keys(update.patch).length > 0) tx.update(update.ref, update.patch);
      }
      // 품목별 완료에서는 재고 숫자와 그 근거인 주문 줄 스냅샷이 한 transaction이어야 한다.
      // 둘 사이에서 브라우저가 닫히면 재시도 때 같은 BOM을 또 뺄 수 있다.
      if (orderMutation) tx.update(doc(db, 'orders', orderMutation.orderId), orderMutation.patch);
      return updates.map(({ itemId, delta, before, after, consumedLots }) => ({ itemId, delta, before, after, consumedLots }));
    });

    // 음수 재고는 이 사업장의 정상 흐름일 수 있어 종 알림을 만들지 않는다. 재고 화면과 로그에서 본다.
    for (const row of changed) {
      if (row.delta === 0 || row.after >= 0) continue;
      const item = allItems.find(candidate => candidate.id === row.itemId);
      console.warn(`[재고 부족] ${item?.name ?? row.itemId}: ${row.before} → ${row.after}`);
    }
    return changed.flatMap(row => row.consumedLots);
  };

  return {
    reserveOrderStock,
    orderStockReservationCleanup,
    releaseOrderStockReservation,
    applyItemStockDeltas,
  };
}
