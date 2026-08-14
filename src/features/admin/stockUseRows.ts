import type { Item, Order } from '../../shared/types';
import { stockUnits, unpackComponent } from '../../shared/orderUnits';
import { isGoodsItem } from './orderStockEngine';

/**
 * 작업완료 때 "이미 있는 재고 쓸까요?"를 물어볼 주문 라인들.
 *
 * 규칙(사장님 확정):
 *  · 완제품(낱개·박스)만 대상. 재고가 0 이하면 안 묻고 전량 생산한다.
 *  · 재고가 있으면 기본값은 min(주문량, 재고) — 주문량이 재고 이상이면 재고 전량,
 *    재고가 더 많으면 주문량만큼. 사용자가 줄이거나 0(사용안함)으로 바꿀 수 있다.
 *  · 박스 품목은 박스 재고로 다 못 채울 때 낱개 재고도 같이 묻는다. 그러고도 모자란 건 전부 생산.
 *
 * 물어볼 게 하나도 없으면 빈 배열 → 모달 없이 그대로 작업완료.
 */
export interface StockUseRow {
  idx: number;            // order.items 인덱스 — 플랜의 키
  itemId: string;
  name: string;
  unitLabel: string;      // 재고 단위 표기 ('박스' | 품목 unit)
  ordered: number;        // 주문량 (재고 단위)
  stock: number;          // 현재 재고 (재고 단위)
  loose?: {               // 박스 품목의 낱개 구성품 — 부족분이 생길 때만 쓴다
    itemId: string;
    name: string;
    count: number;        // 박스 1개 = 낱개 count개
    stock: number;
    unitLabel: string;
  };
}

export function buildStockUseRows(order: Pick<Order, 'items'>, allItems: Item[]): StockUseRow[] {
  const rows: StockUseRow[] = [];
  order.items.forEach((item, idx) => {
    const product = allItems.find(p => p.id === item.itemId);
    if (!product || product.category !== 'product') return;
    if (isGoodsItem(product)) return;              // 생산을 안 하는 품목 — 물을 게 없다

    const uc = unpackComponent(product);
    const loose = uc ? allItems.find(p => p.id === uc.itemId) : undefined;
    const stock = Math.max(0, product.stock ?? 0);
    const looseStock = Math.max(0, loose?.stock ?? 0);

    // 자기 재고도 없고 (박스라면) 낱개 재고도 없으면 어차피 전량 생산 → 묻지 않는다.
    if (stock <= 0 && looseStock <= 0) return;

    rows.push({
      idx,
      itemId: product.id,
      name: product.name,
      unitLabel: uc ? '박스' : (product.unit || '개'),
      ordered: stockUnits(item, product),
      stock,
      ...(uc && loose && looseStock > 0
        ? { loose: { itemId: loose.id, name: loose.name, count: uc.count, stock: looseStock, unitLabel: loose.unit || '개' } }
        : {}),
    });
  });
  return rows;
}

/** 한 행의 화면 표시값 — 앞선 행이 같은 품목 재고를 먼저 가져간 것까지 반영한다. */
export interface StockUseRowState {
  row: StockUseRow;
  ownMax: number;         // 이 행이 쓸 수 있는 최대(주문량과 남은 재고 중 작은 쪽)
  own: number;            // 실제 사용량
  shortUnits: number;     // 생산해야 할 수량 = 주문량 − own
  loose?: { need: number; avail: number; max: number; value: number; short: number };
}

/**
 * 사용자 입력(override)을 받아 전 행의 사용량을 한 번에 확정한다.
 * 같은 품목이 여러 줄에 걸쳐 있어도(10개입·20개입이 같은 낱개를 노림) 재고를 나눠 쓰도록
 * 하나의 풀에서 차례로 빼며 계산한다. override가 없는 행은 기본값(가능한 만큼 사용).
 */
export function resolveStockUse(
  rows: StockUseRow[],
  ownOverride: Record<number, number> = {},
  looseOverride: Record<number, number> = {},
): StockUseRowState[] {
  const pool = new Map<string, number>();   // 품목별 남은 재고 — 낱개가 따로 주문된 경우까지 한 풀에서 센다
  const take = (itemId: string, initial: number, want: number) => {
    const avail = pool.has(itemId) ? pool.get(itemId)! : initial;
    const used = Math.max(0, Math.min(want, avail));
    pool.set(itemId, avail - used);
    return { avail, used };
  };

  return rows.map(row => {
    const ownWant = ownOverride[row.idx] ?? Math.min(row.ordered, row.stock);
    const { avail: ownAvail, used: own } = take(row.itemId, row.stock, Math.min(ownWant, row.ordered));
    const ownMax = Math.min(row.ordered, Math.max(0, ownAvail));
    const shortUnits = Math.round((row.ordered - own) * 1000) / 1000;

    if (!row.loose || shortUnits <= 0) return { row, ownMax, own, shortUnits };

    const need = Math.round(shortUnits * row.loose.count * 1000) / 1000;
    const looseWant = looseOverride[row.idx] ?? Math.min(need, row.loose.stock);
    const { avail: looseAvail, used: value } = take(row.loose.itemId, row.loose.stock, Math.min(looseWant, need));
    return {
      row, ownMax, own, shortUnits,
      loose: { need, avail: looseAvail, max: Math.min(need, Math.max(0, looseAvail)), value, short: Math.round((need - value) * 1000) / 1000 },
    };
  });
}

/** 확정된 행 상태 → 엔진에 넘길 플랜 */
export function toStockUsePlan(states: StockUseRowState[]): Record<number, { own: number; loose?: number }> {
  const plan: Record<number, { own: number; loose?: number }> = {};
  for (const s of states) {
    plan[s.row.idx] = { own: s.own, ...(s.row.loose ? { loose: s.loose?.value ?? 0 } : {}) };
  }
  return plan;
}
