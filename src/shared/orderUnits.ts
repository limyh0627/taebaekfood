import type { Item, OrderItem } from './types';
import { bomOf, bomParentsOf } from './bomIndex';
import { parseSpecCount, parsePackageKg } from '../constants/formula';

/** 박스 판정에 쓰는 최소 정보 — id만 있으면 BOM은 bomIndex에서 읽는다. */
type BoxLike = Pick<Item, 'id' | 'unpackTo'>;

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
export function unpackComponent(product: BoxLike | undefined): { itemId: string; count: number } | null {
  // 완제품 구성품이 **딱 한 종류**이고 수량이 2 이상일 때만 박스로 본다.
  // 선물세트와 갈라내는 조건 — 세트는 서로 다른 완제품을 하나씩 담으므로 여기 안 걸린다.
  //   볶음참깨/20kg박스 ← 낱개/1kg ×20        → 박스 (같은 것의 묶음)
  //   참+들/스마트/300ml ← 참기름 ×1, 들기름 ×1 → 세트 (다른 것을 모음)
  const comps = bomOf(product?.id).filter(l => l.child?.type === 'product' || l.child?.type === '완제품');
  if (comps.length === 1 && comps[0].qty > 1) return { itemId: comps[0].childId, count: comps[0].qty };
  const legacy = product?.unpackTo;
  return legacy && legacy.count > 1 ? { itemId: legacy.itemId, count: legacy.count } : null;
}

/** 재고 단위가 박스인 품목인가 (BOM에 낱개 구성품이 물려 있는 것) */
export function isBoxStockItem(product: BoxLike | undefined): boolean {
  return unpackComponent(product) !== null;
}

/**
 * 박스 품목의 거래처별 단가 = 낱개 단가 × 개입수 (파생, 저장 안 함).
 * 박스 품목엔 단가를 안 박고 낱개 단가만 관리 → 낱개만 고치면 박스가 따라온다.
 * 박스가 아니거나 낱개 단가가 없으면 undefined(호출부에서 기존 fallback).
 */
export function boxDerivedUnitPrice(
  product: BoxLike | undefined,
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
export function boxSiblings<T extends Pick<Item, 'id' | 'unpackTo' | 'archived'>>(
  loose: Pick<Item, 'id'>, all: T[],
): { item: T; count: number }[] {
  //  BOM 역방향으로 이 낱개를 문 부모만 본다 — 예전엔 전 품목을 훑으며 unpackComponent를
  //  두 번씩 불렀다(품목 수 × 2회). 옛 unpackTo 품목은 인덱스에 안 잡히므로 그쪽은 그대로 훑는다.
  const byId = new Map(all.map(p => [p.id, p]));
  const hits = new Map<string, { item: T; count: number }>();
  for (const { parentId } of bomParentsOf(loose.id)) {
    const item = byId.get(parentId);
    if (!item || item.archived) continue;
    const uc = unpackComponent(item);
    if (uc && uc.count > 1 && uc.itemId === loose.id) hits.set(parentId, { item, count: uc.count });
  }
  for (const p of all) {
    if (p.archived || hits.has(p.id)) continue;
    const legacy = p.unpackTo;
    if (legacy && legacy.count > 1 && legacy.itemId === loose.id) hits.set(p.id, { item: p, count: legacy.count });
  }
  return [...hits.values()].sort((a, b) => a.count - b.count);
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
  product: BoxLike | undefined,
): number {
  if (!isBoxStockItem(product)) return item.quantity;
  return item.isBoxUnit && item.boxQuantity ? item.boxQuantity : item.quantity;
}

/**
 * 향미유·고춧가루처럼 **낱개로 세지만 박스로도 주문하는** 품목의 한 박스 개입수.
 *
 * 근거는 품목 자신이다 — 예전엔 '향미유면 12'로 코드에 박아 둬서, 고춧가루처럼
 * 규격마다 개입수가 다른 것(1kg 20개 · 5kg 4개, 둘 다 20kg 박스)을 담을 수 없었다.
 *
 *   boxSize            품목에 직접 박아 둔 값이 가장 세다
 *   규격의 개입수       '1kg * 20' → 20
 *   향미유             옛 기본값 12 (규격이 없는 품목이 아직 있다)
 *   그 외              0 = 박스 주문 안 함
 */
export function unitsPerBoxOf(
  product: (Pick<Item, 'boxSize' | 'spec' | 'category' | 'type'>) | undefined,
): number {
  if (!product) return 0;
  if (product.boxSize && product.boxSize > 1) return product.boxSize;
  const bySpec = parseSpecCount(product.spec);
  if (bySpec > 1) return bySpec;
  const isFlavorOil = product.category === '향미유' || product.type === '향미유';
  return isFlavorOil ? 12 : 0;
}

/**
 * **박스 수량을 낱개로 편다.**
 *
 * 개입수는 품목이 안다(`unitsPerBoxOf`). 그런데 화면 일곱 군데가 **12를 손으로 박아** 놓고
 * 있었다 — 인쇄 두 곳, 거래명세서 품목표, 품목목록 세 곳, 그리고 **입고 재고를 더하는 자리**.
 *
 * 지금 박스 품목 140개 중 **102개가 12개입이 아니다**(20개입만 52품목). 마침 향미유가
 * 전부 12개입이고 박스로 담긴 주문이 아직 없어서 안 틀렸을 뿐, 쓰는 날 바로 틀린다.
 * 재고를 더하는 자리가 틀리면 재고가 통째로 어긋난다.
 */
export function unpackQty(qty: number, product: Parameters<typeof unitsPerBoxOf>[0], isBox?: boolean): number {
  const n = Number(qty) || 0;
  if (!isBox) return n;
  const per = unitsPerBoxOf(product);
  return per > 1 ? n * per : n;
}

/**
 * `3BOX(60개)`처럼 적는다 — **개입수를 모르면 개수를 안 적는다.**
 * 모르면서 12라고 적는 건 틀린 값을 확신에 차서 보여주는 것이다.
 */
export function boxQtyLabel(qty: number | string, perBox?: number, boxWord = 'BOX'): string {
  const n = Number(qty) || 0;
  const per = Number(perBox) || 0;
  return per > 1 ? `${n}${boxWord}(${n * per}개)` : `${n}${boxWord}`;
}

/**
 * **재고 1단위**가 몇 kg인지 — 박스 품목이면 1박스, 낱개 품목이면 1개.
 *
 * 규격은 "낱개 용량 * 개입수" 꼴이라(`1kg * 20`) 앞자리만 읽으면 낱개 용량이다.
 * 재고 단위가 박스면 개입수를 곱해야 1박스당 kg이 된다.
 *
 * 예전엔 품목명이 '볶음참깨/20kg박스'라 parsePackageKg(name)이 20을 집어 맞았는데,
 * 이름이 '볶음참깨/1kg'으로 정리되면서 1kg으로 읽혔다 — 가공입고 kg·로스·가공비가
 * 한꺼번에 10~20배 작게 잡히던 자리다. 근거를 이름이 아니라 규격+단위로 옮긴다.
 */
export function itemKg(item: Item): number {
  if (item.packageKg) return item.packageKg;
  const perUnit = parsePackageKg(item.spec) ?? parsePackageKg(item.name) ?? 0;
  const isBox = isBoxStockItem(item) || item.unit === '박스';
  return perUnit * (isBox ? parseSpecCount(item.spec) : 1);
}

/**
 * 낱개 밑에 박스 품목을 붙여 정렬한다 — 목록에서 둘이 떨어져 있으면 같은 물건인 줄 모른다.
 * 박스(unpackComponent)의 낱개가 목록에 있으면 그 아래로, 없으면(orphan) 단독으로 둔다.
 */
export function groupLooseBoxRows<T extends Pick<Item, 'id' | 'unpackTo'>>(arr: T[]): { p: T; isChild: boolean }[] {
  const inList = new Set(arr.map(p => p.id));
  const boxByParent = new Map<string, T[]>();
  const looseOrOrphan: T[] = [];
  for (const p of arr) {
    const uc = unpackComponent(p);
    if (uc && inList.has(uc.itemId)) {
      const cur = boxByParent.get(uc.itemId);
      if (cur) cur.push(p); else boxByParent.set(uc.itemId, [p]);
    } else {
      looseOrOrphan.push(p);
    }
  }
  const out: { p: T; isChild: boolean }[] = [];
  for (const p of looseOrOrphan) {
    out.push({ p, isChild: false });
    for (const b of (boxByParent.get(p.id) ?? [])) out.push({ p: b, isChild: true });
  }
  return out;
}
