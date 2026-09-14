import type { Item, OrderItem } from './types';
import { isBulkItem, isGoodsItem } from './itemTaxonomy';
import { boxCountOf, isBoxStockItem, stockUnits, unitsPerBoxOf } from './orderUnits';

/**
 * **출고하면 재고에서 얼마가 빠지나** — 셈은 여기 하나다.
 *
 * 재고 엔진(`orderStockEngine.shipOrder`)이 이 함수를 쓰고, 화면의 확인창도 이 함수를 쓴다.
 * 2026-09-15 사장님이 카드에서 바로 출고할 수 있게 하라시면서 "재고가 ~~~차감됩니다" 를
 * 띄우라고 하셨는데, 화면이 따로 세면 **말과 실제가 갈린다.** 규칙이 은근히 까다로워서
 * 한 번 갈리면 알아채기도 어렵다:
 *
 *   · **벌크(kg·L 원료·반제품)는 안 뺀다** — 생산처리에서 로트·원장까지 이미 빠졌다.
 *     여기서 또 빼면 두 번 빠진다.
 *   · **사입·임가공**은 박스 개입수로 환산해서 뺀다(`goodsShipQty`).
 *   · 나머지는 재고 단위로 뺀다(`stockUnits` — 박스 품목이면 박스 개수).
 */

/**
 * 사입·임가공 완제품이 출고에서 빠지는 수량.
 *
 * 박스 품목(BOM에 낱개가 물린 것)은 재고 단위가 박스라 박스 개수로 뺀다.
 * 개입수는 **주문 줄에 박힌 값이 먼저**고(그때 판 조건), 없으면 품목이 안다
 * — BOM 아니면 포장 환산표. 예전엔 `|| 12` 로 물러섰는데, 박스 품목 140개 중
 * 102개가 12개입이 아니라 **출고 차감이 그만큼 어긋날 자리**였다.
 */
export const goodsShipQty = (item: OrderItem, product: Item): number => {
  if (isBoxStockItem(product)) return stockUnits(item, product);
  const uPerBox = item.unitsPerBox || unitsPerBoxOf(product) || 1;
  //  **몇 박스인가는 `boxCountOf` 만 답한다** — 여기서 또 따지면 재고와 전표가 갈린다
  //  (`boxCount.test.ts` 가 막는다). 여기서 내는 값은 박스 수가 아니라 **낱개 수**다.
  return item.isBoxUnit && item.boxQuantity ? boxCountOf(item) * uPerBox : item.quantity;
};

/** 이 줄이 출고에서 재고에 낼 몫. **0 이면 안 뺀다**(벌크·모르는 품목). */
export const shipQtyOfLine = (item: OrderItem, product: Item | undefined): number => {
  if (!product || isBulkItem(product)) return 0;
  return isGoodsItem(product) ? goodsShipQty(item, product) : stockUnits(item, product);
};

export interface ShipDeductionRow {
  itemId: string;
  name: string;
  unit: string;
  /** 빠지는 양(양수) */
  qty: number;
  /** 지금 재고 */
  before: number;
  /** 빼고 난 재고 — 음수면 모자란 것이다 */
  after: number;
}

/**
 * 이 주문을 출고하면 무엇이 얼마나 빠지나 — 사람에게 보여 줄 목록.
 *
 * **같은 품목이 여러 줄이면 합쳐 센다** — 줄마다 따로 보이면 "3개 빠지고 또 2개 빠진다"로
 * 읽혀 남는 재고를 못 셈한다. 순서는 주문에 적힌 차례 그대로다.
 */
export function shipDeductions(
  order: Pick<{ items: OrderItem[] }, 'items'>,
  allItems: readonly Item[],
): ShipDeductionRow[] {
  const 모음 = new Map<string, ShipDeductionRow>();
  for (const line of order.items ?? []) {
    const product = allItems.find(candidate => candidate.id === line.itemId);
    const qty = shipQtyOfLine(line, product);
    if (!product || qty <= 0) continue;
    const 있던것 = 모음.get(product.id);
    if (있던것) {
      있던것.qty = Math.round((있던것.qty + qty) * 1000) / 1000;
      있던것.after = Math.round((있던것.before - 있던것.qty) * 1000) / 1000;
      continue;
    }
    const before = Number(product.stock ?? 0);
    모음.set(product.id, {
      itemId: product.id,
      name: product.name,
      //  박스로 세는 품목은 '개' 라고 하면 거짓말이 된다.
      unit: isBoxStockItem(product) ? '박스' : (product.unit || '개'),
      qty: Math.round(qty * 1000) / 1000,
      before,
      after: Math.round((before - qty) * 1000) / 1000,
    });
  }
  return [...모음.values()];
}
