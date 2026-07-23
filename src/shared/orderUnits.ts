import type { Item, OrderItem } from './types';
import { bomQty } from './bom';

/**
 * 박스 품목의 낱개 구성 — **BOM에서 읽는다.**
 *   볶음참깨/20kg박스 의 BOM에 든 `볶음참깨-낱개/1kg × 20` → { itemId: 낱개, count: 20 }
 *
 * BOM에 완제품(product)이 들어있다는 건 "이 품목 1개 = 저 품목 count개"라는 등가 관계다.
 * 재고 차감 대상이 아니다 — 별개 품목이라 박스가 나가도 낱개 재고는 건드리지 않는다.
 * 쓰이는 곳은 두 군데:
 *   · 개봉(박스 −1 → 낱개 +count)
 *   · 재고 단위 환산 (주문 quantity가 낱개로 들어와도 재고는 박스로 뺀다)
 *
 * 옛 `unpackTo` 필드는 BOM에 구성품이 없을 때만 본다(이전 데이터 호환).
 */
export function unpackComponent(product: Pick<Item, 'submaterials' | 'unpackTo'> | undefined): { itemId: string; count: number } | null {
  const s = (product?.submaterials ?? []).find(x => x.category === 'product' || x.category === '완제품');
  if (s) {
    const count = bomQty(s);
    if (count > 1) return { itemId: s.id, count };
  }
  const legacy = product?.unpackTo;
  return legacy && legacy.count > 1 ? { itemId: legacy.itemId, count: legacy.count } : null;
}

/** 재고 단위가 박스인 품목인가 (BOM에 낱개 구성품이 물려 있는 것) */
export function isBoxStockItem(product: Pick<Item, 'submaterials' | 'unpackTo'> | undefined): boolean {
  return unpackComponent(product) !== null;
}

/**
 * 주문 라인이 재고에서 빼는 수량 — **재고 1단위 기준**.
 *
 * 대부분의 품목은 재고 단위가 곧 주문 단위라 quantity 그대로다.
 * 박스 품목만, 지금은 quantity가 낱개(kg)로 들어온다:
 *   20kg박스 5B 주문 → quantity=100, boxQuantity=5 → 재고에서 뺄 건 5
 * 박스 개수는 boxQuantity에 이미 정확히 들어있으니 그걸 쓴다. quantity를 per로 나누지 않는다
 * — 주문 입력이 박스 기준으로 바뀌면(quantity 자체가 박스 개수) 나누기가 오히려 틀리기 때문.
 *
 * 이 값이 모든 환산의 출발점이다. spec("20kg")은 "재고 1단위의 내용량"이므로
 * 원료 kg = toKg(spec, stockUnits) 가 된다 — 20kg × 5B = 100kg.
 * quantity를 그대로 넣으면 20kg × 100 = 2,000kg으로 20배가 된다.
 */
export function stockUnits(
  item: Pick<OrderItem, 'quantity' | 'isBoxUnit' | 'boxQuantity'>,
  product: Pick<Item, 'submaterials' | 'unpackTo'> | undefined,
): number {
  if (!isBoxStockItem(product)) return item.quantity;
  return item.isBoxUnit && item.boxQuantity ? item.boxQuantity : item.quantity;
}
