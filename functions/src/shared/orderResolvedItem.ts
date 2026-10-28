import { unpackComponent, unitsPerBoxOf, type OrderStockUnitInputs } from './orderStockUnits';
import { boxCountOf } from './orderEditUnits';

export interface ResolvedOrderItem<T extends { id: string }> {
  product?: T;
  qty: number;
  perBox: number;
  unknownItem: boolean;
}

export function resolveOrderItem<T extends { id: string }>(
  item: { itemId?: string; quantity: number; isBoxUnit?: boolean; boxQuantity?: number; unitsPerBox?: number },
  allItems: readonly T[], inputs: OrderStockUnitInputs,
): ResolvedOrderItem<T> {
  let product = item.itemId ? allItems.find(p => p.id === item.itemId) : undefined;
  const unknownItem = !product;

  const uc = unpackComponent(product, inputs);
  let qty = item.quantity;
  let perBox = 1;
  if (uc) {
    const loose = allItems.find(p => p.id === uc.itemId);
    if (loose) {
      //  몇 박스인가는 **orderUnits.boxCountOf 한 곳**이 답한다 — 재고 차감(stockUnits)과 같은 답이라야
      //  전표에 찍힌 낱개 수와 재고에서 빠진 양이 안 갈린다.
      const boxCount = boxCountOf(item);
      product = loose;
      qty = boxCount * uc.count;
      perBox = uc.count;
    }
  } else if (item.isBoxUnit && item.boxQuantity) {
    // 향미유처럼 재고는 낱개지만 주문은 박스로 받는 품목. 복사 주문의 옛 줄은
    // quantity에도 박스 수가 들어가 있으므로 환산표를 읽어 전표에서 낱개로 바로잡는다.
    const pack = item.unitsPerBox ?? unitsPerBoxOf(product, inputs);
    if (pack > 1) {
      qty = item.boxQuantity * pack;
      perBox = pack;
    }
  }
  return { product, qty, perBox, unknownItem };
}
