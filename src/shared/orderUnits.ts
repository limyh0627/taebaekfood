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
  // 완제품 구성품이 **딱 한 종류**이고 수량이 2 이상일 때만 박스로 본다.
  // 선물세트와 갈라내는 조건 — 세트는 서로 다른 완제품을 하나씩 담으므로 여기 안 걸린다.
  //   볶음참깨/20kg박스 ← 낱개/1kg ×20        → 박스 (같은 것의 묶음)
  //   참+들/스마트/300ml ← 참기름 ×1, 들기름 ×1 → 세트 (다른 것을 모음)
  const comps = (product?.submaterials ?? []).filter(x => x.category === 'product' || x.category === '완제품');
  if (comps.length === 1 && bomQty(comps[0]) > 1) return { itemId: comps[0].id, count: bomQty(comps[0]) };
  const legacy = product?.unpackTo;
  return legacy && legacy.count > 1 ? { itemId: legacy.itemId, count: legacy.count } : null;
}

/** 재고 단위가 박스인 품목인가 (BOM에 낱개 구성품이 물려 있는 것) */
export function isBoxStockItem(product: Pick<Item, 'submaterials' | 'unpackTo'> | undefined): boolean {
  return unpackComponent(product) !== null;
}

/**
 * 박스 품목의 거래처별 단가 = 낱개 단가 × 개입수 (파생, 저장 안 함).
 * 박스 품목엔 단가를 안 박고 낱개 단가만 관리 → 낱개만 고치면 박스가 따라온다.
 * 박스가 아니거나 낱개 단가가 없으면 undefined(호출부에서 기존 fallback).
 */
export function boxDerivedUnitPrice(
  product: Pick<Item, 'submaterials' | 'unpackTo'> | undefined,
  clientId: string,
  partnerItems: { itemId?: string; partnerId?: string; price?: number }[],
): number | undefined {
  const uc = unpackComponent(product);
  if (!uc) return undefined;
  const loose = partnerItems.find(pc => pc.itemId === uc.itemId && pc.partnerId === clientId);
  return typeof loose?.price === 'number' ? loose.price * uc.count : undefined;
}

/**
 * 낱개 품목과 짝지어진 박스 품목들을 찾는다 — 주문 화면 낱개↔박스 토글용.
 * 박스 품목의 BOM(unpackComponent)이 이 낱개를 가리키면 짝이다.
 * count 오름차순(10kg박스 < 20kg박스).
 */
export function boxSiblings<T extends Pick<Item, 'id' | 'submaterials' | 'unpackTo' | 'archived'>>(
  loose: Pick<Item, 'id'>, all: T[],
): { item: T; count: number }[] {
  return all
    .filter(p => !p.archived)
    .map(p => ({ item: p, count: unpackComponent(p)?.count ?? 0, target: unpackComponent(p)?.itemId }))
    .filter(x => x.count > 1 && x.target === loose.id)
    .sort((a, b) => a.count - b.count)
    .map(({ item, count }) => ({ item, count }));
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
