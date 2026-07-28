import { Item } from './types';
import { toKg, baseRawName, unitToKg } from '../constants/formula';
import { bomQty } from './bom';
import { isBoxStockItem } from './orderUnits';

/**
 * BOM 원가 롤업 — 순수 함수(DI).
 *
 * 완제품의 제조원가를 원료·부자재·가공비 합산으로 계산한다. 재고 차감 로직
 * (orderStockEngine의 accrueRaw/accrueBom)을 **원가 버전으로 미러링**한다:
 *   · 원료식(품목→buildFormula)      → 원료 kg × 원료단가
 *   · 부자재/구성품(submaterials)     → bomQty × 구성품원가 (재귀)
 *   · 가공비(임가공 등)               → processingFeeOf (선택)
 *
 * 이중계상 방지: 박스처럼 **조립 구성품(완제품/박스)** 을 submaterials로 품는 품목은
 * 그 구성품이 이미 원료원가를 지니므로 원료식(품목)을 타지 않는다.
 * 원료·반제품·완사입(goods)은 자기 cost가 곧 원가(종단).
 */
export interface BomCostCtx {
  allItems: Item[];
  /** 품목키 → 원료 배합 [{raw, ratio}]. buildFormula(k, itemFormulas, allItems) 래핑. 없으면 []. */
  formulaOf: (prodKey: string) => { raw: string; ratio: number }[];
  /** 단위당 가공비(임가공 등). 없으면 0. */
  processingFeeOf?: (item: Item) => number;
}

/** 종단 품목(자기 cost가 곧 원가, 롤업 안 함) */
const TERMINAL = new Set(['goods', 'raw', 'wip', 'submaterial', 'box']);

/** 낱개 완제품의 겉박스(출고 시 shipping_rule로 별도 차감)인가 */
const isShippingBox = (i: Item): boolean =>
  i.category === 'box' || (i.category === 'submaterial' && i.subtype === '박스');

/**
 * 원료/반제품 1kg당 원가. name=원료명(예 '통깨참기름','볶음참깨').
 * 원료 cost는 운영단위(기름=L, 그 외 kg)당 값 → kg당으로 환산.
 */
export function rawCostPerKg(name: string, byRawName: Map<string, Item>): number {
  const it = byRawName.get(name);
  if (!it || it.cost == null) return 0;
  const kgPerUnit = unitToKg(1, name); // L이면 밀도(kg/L), kg이면 1
  return kgPerUnit > 0 ? it.cost / kgPerUnit : it.cost;
}

export interface CostFn {
  (item: Item): number;
  /** 저장된 cost 우선, 없거나 0이면 롤업값 */
  effective: (item: Item) => number;
}

export function buildCostFn(ctx: BomCostCtx): CostFn {
  const byId = new Map(ctx.allItems.map(i => [i.id, i]));
  // 원료명 → 원료/반제품 item.
  //  같은 원료명에 여러 품목이 걸릴 수 있다(원료 '깨분참기름' 7222/L vs 반제품 '깨분참기름/16.5kg' 120,000/드럼).
  //  원료식이 가리키는 건 벌크 원료 → **정확한 이름(규격접미사 없음) + raw** 를 우선한다.
  const byRawName = new Map<string, Item>();
  const rank = (it: Item, key: string) => (it.name === key ? 2 : 0) + (it.category === 'raw' ? 1 : 0);
  const rankOf = new Map<string, number>();
  for (const i of ctx.allItems) {
    if (i.category !== 'raw' && i.category !== 'wip') continue;
    const key = baseRawName(i.name);
    const r = rank(i, key);
    if (!byRawName.has(key) || r > (rankOf.get(key) ?? -1)) { byRawName.set(key, i); rankOf.set(key, r); }
  }
  const feeOf = ctx.processingFeeOf ?? (() => 0);
  const memo = new Map<string, number>();

  const cost = (item: Item, seen: Set<string>): number => {
    const cached = memo.get(item.id);
    if (cached != null) return cached;
    if (seen.has(item.id)) return 0; // 순환 방어 (BOM 사이클)
    const s2 = new Set(seen).add(item.id);

    // 종단 품목 = 자기 cost가 원가 (매입·선제조 완료값)
    //   goods(완사입)·raw(원료)·wip(반제품)·submaterial(부자재)·box(겉박스)
    if (TERMINAL.has(item.category as string)) {
      const c = item.cost ?? 0;
      memo.set(item.id, c);
      return c;
    }

    const isBox = isBoxStockItem(item);
    const subs = item.submaterials ?? [];
    // 조립 구성품(완제품/박스)을 품으면 그 구성품이 원료원가를 이미 지님 → 원료식 중복 skip
    const hasAssembled = subs.some(s => {
      const c = byId.get(s.id);
      return !!c && (c.category === 'product' || c.category === 'box');
    });

    let total = 0;
    if (!hasAssembled) {
      for (const f of ctx.formulaOf(item.품목 || item.name)) {
        const kg = toKg(item.spec || '', f.raw, 1) * f.ratio;
        if (kg > 0) total += kg * rawCostPerKg(f.raw, byRawName);
      }
    }
    for (const s of subs) {
      const comp = byId.get(s.id);
      if (!comp) continue;
      if (comp.category === 'raw') continue;         // 원료는 원료식 경로
      if (isShippingBox(comp) && !isBox) continue;   // 낱개의 겉박스는 출고 시 shipping_rule
      const q = bomQty(s);
      if (q <= 0) continue;                          // 테이프 등 0 = 원가 산입 안 함
      total += q * cost(comp, s2);
    }
    total += feeOf(item);
    memo.set(item.id, total);
    return total;
  };

  const fn = ((item: Item) => cost(item, new Set<string>())) as CostFn;
  fn.effective = (item: Item) => (item.cost != null && item.cost > 0 ? item.cost : fn(item));
  return fn;
}
