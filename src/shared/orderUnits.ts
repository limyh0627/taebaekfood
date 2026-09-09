import type { Item, OrderItem } from './types';
import { bomOf, bomParentsOf } from './bomIndex';
import { packUnitsOf } from './packIndex';
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
/**
 * **묶음 갈래 — 이 품목이 다른 완제품을 담고 있나, 어떤 식으로.**
 *
 *   박스   같은 것의 묶음.   볶음참깨/20kg박스 ← 낱개/1kg ×20
 *   세트   다른 것을 모음.   참+들/스마트/300ml ← 참기름 ×1, 들기름 ×1
 *   null   그냥 낱개다.
 *
 * **둘은 서류에서 똑같이 다뤄진다**(2026-09-06 사장님: "박스품목 서류에 들어가는거랑
 * 통합해서 처리해") — 둘 다 **든 완제품으로 풀어서** 원료수불부·생산작업기록부·
 * 판매일지에 올린다. 그래서 둘 다 **자기 서류용 품목·규격이 없어도 된다.**
 *
 * 근거는 **구성**이다. 서브타입 이름('배송'·'선물세트')으로 견주면 분류 관리에서
 * 이름을 바꾸는 순간 그 자리들이 조용히 다 안 걸린다.
 *
 * 저장된 품목(BOM)과 편집 중인 폼(아직 저장 안 한 구성) 둘 다 이 함수로 판정한다 —
 * 판정이 갈리면 화면에서는 서류용 품목을 안 받고 서류에서는 안 풀리는 일이 생긴다.
 */
export type 묶음갈래 = '박스' | '세트' | null;

export function 묶음갈래of(완제품구성: readonly { qty: number }[]): 묶음갈래 {
  if (완제품구성.length > 1) return '세트';
  if (완제품구성.length === 1 && 완제품구성[0].qty > 1) return '박스';
  return null;
}

export function unpackComponent(product: BoxLike | undefined): { itemId: string; count: number } | null {
  const comps = bomOf(product?.id).filter(l => l.child?.type === 'product' || l.child?.type === '완제품');
  if (묶음갈래of(comps) === '박스') return { itemId: comps[0].childId, count: comps[0].qty };
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
 * 전표의 미발행 주문 두 목록에 적을 수량 — 어느 화면에서 보든 같은 말을 쓰게 한다.
 *
 * 박스로 받은 주문은 `quantity`에 낱개 수량, `boxQuantity`에 주문한 박스 수가 든다.
 * 박스 수만 보이면 실제 출고량을 모르고, 낱개 수만 보이면 몇 박스를 주문했는지 모른다.
 * 둘 다 있는 주문은 `2박스 (24개)`처럼 함께 적는다.
 */
export function orderItemQuantityLabel(
  item: Pick<OrderItem, 'quantity' | 'isBoxUnit' | 'boxQuantity' | 'unitsPerBox'>,
  unit = '개',
): string {
  if (item.isBoxUnit && item.boxQuantity) {
    const each = item.unitsPerBox ? ` (${item.quantity}개)` : '';
    return `${item.boxQuantity}박스${each}`;
  }
  return `${item.quantity}${unit || '개'}`;
}

/**
 * 한 박스에 낱개가 몇 개 드는가.
 *
 * **근거는 BOM 하나다.** 박스 품목의 BOM에 `낱개 × 20`이 들어 있는 것이 개입수다.
 * 규격 글자(`1kg * 20`)는 사람이 읽으라고 **따라 적는 것**이지 근거가 아니다 —
 * 품목 편집창도 BOM 수량을 고칠 때 규격을 따라 쓴다.
 *
 * 예전엔 규격 글자를 먼저 읽었는데, 그러면 **글자가 안 따라간 품목에서 0이 나온다.**
 * 실제로 다섯 품목이 그 상태였다(참기름/병/분/엘생명 40개입 · 시골향참기름/원액 10개입 등).
 * BOM엔 40·10이 멀쩡히 있는데 규격이 비어 있어 "박스가 아니다"로 읽혔다.
 *
 * 근거가 둘이고, 둘은 서로 다른 것을 뜻한다.
 *
 *   ① BOM              **박스를 별개 품목으로 두는 것.** 박스째 쌓아 두고 박스로 센다.
 *                      겉박스·테이프까지 그 BOM에 달려 있다(129/136).
 *   ② 포장 환산표       **낱개로만 세는데 박스로 말하는 것.** 향미유·고춧가루가 그렇다.
 *                      재고는 개로 두고 주문 입력만 박스로 받는다(`item_pack`).
 *
 * **길은 이 둘뿐이다.** 예전엔 `boxSize` 필드 · 규격 글자 · 코드에 박은 '향미유면 12'까지
 * 넷이었는데, 근거가 넷이면 어느 게 맞는지 아무도 못 믿는다. 실제로 갈려 있었다
 * (규격이 안 따라간 다섯 품목에서 0이 나왔다). 셋을 걷어내고 표로 옮겼다 —
 * 규격 글자는 **한 품목도 안 쓰고 있었고**(131개가 전부 BOM 도 갖고 있었다),
 * `boxSize`와 '향미유 12'는 goods 아홉 품목뿐이었다.
 */
export function unitsPerBoxOf(product: BoxLike | undefined): number {
  if (!product) return 0;
  const packed = unpackComponent(product);
  if (packed) return packed.count;
  return packUnitsOf(product.id);
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
 * **낱개 재고를 박스로 환산해 적는다** — 재고 목록에 곁들이는 줄.
 *
 *   packBreakdown(300, 12)  →  '(12개입)25B'
 *   packBreakdown(308, 12)  →  '(12개입)25B+8개'
 *   packBreakdown(300, 0)   →  ''            개입수를 모르면 아무것도 안 적는다
 *
 * **낱개 수가 진짜다.** 환산은 창고에서 세기 편하라고 곁들이는 것이라, 화면에서도
 * 낱개를 크게 두고 이걸 작게 붙인다. 예전엔 `25B(300개)`로 박스를 앞에 뒀는데,
 * 재고 단위가 개인 품목에서 박스가 먼저 보이면 어느 게 재고인지 헷갈린다.
 *
 * 음수도 그대로 적는다(반품·마이너스 재고). `-48`이면 `(12개입)-4B`다 —
 * 마이너스를 감추면 어긋난 재고를 못 본다.
 */
export function packBreakdown(stock: number, perBox: number): string {
  const per = Number(perBox) || 0;
  if (per <= 1) return '';
  const n = Number(stock) || 0;
  //  음수는 0 쪽으로 자른다 — -48개 12개입이면 -4B 이지 -5B+12개가 아니다
  const boxes = n < 0 ? Math.ceil(n / per) : Math.floor(n / per);
  const rem = n - boxes * per;
  if (rem === 0) return `(${per}개입)${boxes}B`;
  //  나머지가 음수면 부호를 겹쳐 쓰지 않는다 — '+-1개'가 아니라 '-1개'
  return `(${per}개입)${boxes}B${rem > 0 ? '+' : ''}${rem}개`;
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

/**
 * **이 품목 재고 1단위가 몇 kg인가.**
 *
 * 낱개면 규격에서 읽고(`1kg` → 1), **박스면 개입수까지 곱한다**(`1kg` 낱개 20개입 → 20).
 * 규격에 kg 이 안 적혔으면 undefined — 알 수 없는 걸 0으로 치면 총량이 조용히 줄어든다.
 *
 * 재고 화면이 **박스도 kg 으로 더해 보여주려고** 쓴다(2026-09-06 사장님:
 * "박스로 들어온 애들도 총량이 kg으로 더해져야지").
 *
 * @param findItem 낱개를 찾는 함수 — 박스는 제 규격이 아니라 낱개 규격으로 센다
 */
export function kgPerStockUnit(
  product: (BoxLike & { spec?: string }) | undefined,
  findItem: (id: string) => { spec?: string } | undefined,
): number | undefined {
  if (!product) return undefined;
  const uc = unpackComponent(product);
  if (!uc) return parsePackageKg(product.spec);
  //  박스 규격(`1kg * 20`)에서 읽으면 1이 나온다 — 낱개 규격 × 개입수가 맞다
  const looseKg = parsePackageKg(findItem(uc.itemId)?.spec);
  return looseKg === undefined ? undefined : looseKg * uc.count;
}

/** 재고 수량 → kg. 못 알면 undefined(0 으로 치지 않는다). */
export function stockKg(
  qty: number,
  product: (BoxLike & { spec?: string }) | undefined,
  findItem: (id: string) => { spec?: string } | undefined,
): number | undefined {
  const per = kgPerStockUnit(product, findItem);
  return per === undefined ? undefined : Math.round(qty * per * 1000) / 1000;
}
