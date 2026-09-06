import { Item } from './types';
import { toKg, baseRawName, unitToKg } from '../constants/formula';
import { bomQty } from './bom';
import { VAT_UP } from './lineAmount';
import { docName } from './docName';

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
  /**
   * 품목키 → **직접 구성 한 단**(펼치지 않은, 수율 그대로). formulaRowsOf 래핑.
   * 제조 반제품 원가가 이걸 쓴다 — 수율은 곱하는 게 아니라 나누는 값이라 미리 곱한 값으론 못 푼다.
   * 안 넘기면 제조 반제품은 저장 원가만 본다(구 호출부 호환).
   */
  formulaRowsOf?: (prodKey: string) => { raw: string; ratio: number; yieldRate: number }[];
  /** 단위당 가공비(임가공 등). 없으면 0. */
  processingFeeOf?: (item: Item) => number;
  /** BOM 단일원천 — item_bom 그대로. 안 넘기면 구성 없는 품목으로 본다(폴백 없음). */
  itemBoms?: { parent_id: string; child_id: string; quantity?: number }[];
}

/** 종단 품목(자기 cost가 곧 원가, 롤업 안 함) */
const TERMINAL = new Set(['goods', 'raw', 'wip', 'submaterial', 'box']);

/**
 * 원료/반제품 1kg당 원가. name=원료명(예 '통깨참기름','볶음참깨').
 * cost는 2026-08-14부터 **언제나 kg당**이다(기름도 마찬가지) — 재고·BOM과 같은 단위.
 * 예전엔 기름만 L당이라 여기서 밀도로 나눴다. 재고가 kg인데 단가가 L당이면 재고평가가 9% 어긋난다.
 */
export function rawCostPerKg(name: string, byRawName: Map<string, Item>): number {
  const it = byRawName.get(name);
  return it?.cost ?? 0;
}

export interface CostFn {
  /** 이 품목의 원가 — costSource가 'manual'이면 손으로 넣은 값, 아니면 롤업. */
  (item: Item): number;
  /** @deprecated 이제 본체와 같다(품목이 제 출처를 정한다). 옛 호출부 호환용. */
  effective: (item: Item) => number;
  /**
   * **출처를 무시한 순수 롤업.** 'manual'로 못 박아 둔 품목도 계산값을 보여줘야 하는
   * 편집 화면(원가 토글)이 쓴다. 굴릴 게 없으면 저장값으로 떨어진다.
   */
  rollup: (item: Item) => number;
}

export function buildCostFn(ctx: BomCostCtx): CostFn {
  const byId = new Map(ctx.allItems.map(i => [i.id, i]));
  // 원료명 → 원료/반제품 item.
  //  같은 원료명에 여러 품목이 걸릴 수 있다(원료 '깨분참기름' 7222/L vs 반제품 '깨분참기름/16.5kg' 120,000/드럼).
  //  원료식이 가리키는 건 벌크 원료 → **정확한 이름(규격접미사 없음) + raw** 를 우선한다.
  const byRawName = new Map<string, Item>();
  const rank = (it: Item, key: string) => (it.name === key ? 2 : 0) + (it.type === 'raw' ? 1 : 0);
  const rankOf = new Map<string, number>();
  for (const i of ctx.allItems) {
    if (i.type !== 'raw' && i.type !== 'wip') continue;
    const key = baseRawName(i.name);
    const r = rank(i, key);
    if (!byRawName.has(key) || r > (rankOf.get(key) ?? -1)) { byRawName.set(key, i); rankOf.set(key, r); }
  }
  /**
   * **면세 원료로 과세품을 만들면 매입세액을 못 뺀다** — 그만큼이 그대로 원가에 얹힌다.
   * 참깨·들깨(면세 농산물)로 참기름·들기름(과세)을 짜는 자리가 그렇다.
   * 원료가 과세면 매입세액을 빼므로 단가 그대로다.
   */
  const vatUp = (child: Item, parent: Item) =>
    (child.taxType === '면세' && parent.taxType !== '면세' ? VAT_UP : 1);
  const feeOf = ctx.processingFeeOf ?? (() => 0);
  const memo = new Map<string, number>();

  //  구성품은 item_bom만 본다. { id, stock } 모양은 아래 롤업이 bomQty로 읽던 자리와 같다.
  const bomByParent = new Map<string, { id: string; stock: number }[]>();
  for (const b of ctx.itemBoms ?? []) {
    const arr = bomByParent.get(b.parent_id) ?? [];
    arr.push({ id: b.child_id, stock: typeof b.quantity === 'number' ? b.quantity : 1 });
    bomByParent.set(b.parent_id, arr);
  }
  const componentsOf = (item: Item): { id: string; stock: number }[] => bomByParent.get(item.id) ?? [];

  const cost = (item: Item, seen: Set<string>): number => {
    const cached = memo.get(item.id);
    if (cached != null) return cached;
    if (seen.has(item.id)) return 0; // 순환 방어 (BOM 사이클)
    const s2 = new Set(seen).add(item.id);

    // 종단 품목 = 자기 cost가 원가 (매입·선제조 완료값)
    //   goods(완사입)·raw(원료)·wip(반제품)·submaterial(부자재)·box(겉박스)
    if (TERMINAL.has(item.type as string)) {
      const stored = item.cost ?? 0;
      /**
       * **제조 반제품은 저장 원가보다 원료식이 세다.**
       *
       * 참기름특A = 깨분참기름 0.5 + 통깨참기름 0.5처럼 사서 오는 게 아니라 섞어 만드는 것이다.
       * 예전엔 저장 cost가 있으면 그걸 그대로 썼는데, 원료값이 올라도 안 따라와서
       * 통들깨들기름이 들깨 5,795원 시절 값을 그대로 들고 있었다(실제 6,700원).
       * 원료식이 있으면 언제나 굴린다 — 매입 반제품(깨분참기름/16.5kg 등)은 원료식이 없어 안 걸린다.
       *
       * 수율은 **나눈다**. 37%는 "들깨 1kg에서 기름 0.37kg"이라 기름 1kg엔 들깨 1/0.37 = 2.7kg이 든다.
       * 곱하면 0.37kg으로 잡혀 원가가 7배 작아진다.
       */
      if (item.type === 'wip' && ctx.formulaRowsOf) {
        const rows = ctx.formulaRowsOf(docName(item));
        if (rows.length) {
          const blended = rows.reduce((sum, r) => {
            const src = byRawName.get(r.raw);
            const unit = src ? cost(src, s2) * vatUp(src, item) : 0;   // 중간 반제품도 제 원료식으로 굴린다(재귀)
            return sum + unit * r.ratio / (r.yieldRate || 1);
          }, 0);
          if (blended > 0) { memo.set(item.id, blended); return blended; }
        }
      }
      if (stored > 0) { memo.set(item.id, stored); return stored; }
      memo.set(item.id, stored);
      return stored;
    }

    const subs = componentsOf(item);
    // 조립 구성품(완제품/박스/반제품)을 품으면 그 구성품이 원료원가를 이미 지님 → 원료식 중복 skip
    //   참기름 병입은 '참기름특A 1.8L + 병 + 캡'이 실제 공정이다. 여기에 원료식(깨분·통깨)까지
    //   더하면 기름값이 두 번 잡힌다 — 반제품이 이미 그 기름을 담고 있기 때문.
    const hasAssembled = subs.some(s => {
      const c = byId.get(s.id);
      return !!c && (c.type === 'product' || c.type === 'box' || c.type === 'wip');
    });

    let total = 0;
    if (!hasAssembled) {
      for (const f of ctx.formulaOf(docName(item))) {
        const kg = toKg(item.spec || '', f.raw, 1) * f.ratio;
        const src = byRawName.get(f.raw);
        if (kg > 0) total += kg * rawCostPerKg(f.raw, byRawName) * (src ? vatUp(src, item) : 1);
      }
    }
    for (const s of subs) {
      const comp = byId.get(s.id);
      if (!comp) continue;
      if (comp.type === 'raw') continue;         // 원료는 원료식 경로
      // 겉박스·테이프도 BOM에 있으면 그대로 원가에 넣는다 — 예전엔 낱개의 겉박스를 코드로 건너뛰었지만,
      // 이제 낱개 BOM에 그것들을 안 둔다(박스 품목을 만들 때 그 BOM으로 잡힌다). BOM이 곧 구성이다.
      const q = bomQty(s);
      if (q <= 0) continue;                          // 테이프 등 0 = 원가 산입 안 함
      total += q * cost(comp, s2) * vatUp(comp, item);
    }
    total += feeOf(item);
    memo.set(item.id, total);
    return total;
  };

  /**
   * 손으로 못 박은 품목은 그 값이 곧 원가다 — 계산이 실제와 안 맞을 때 쓰는 탈출구.
   * 안 정했으면(기본) 롤업이 이긴다. 예전엔 저장값이 늘 우선이라 원료값이 올라도 안 따라왔다.
   */
  const rollup = (item: Item) => cost(item, new Set<string>());
  const fn = ((item: Item) =>
    (item.costSource === 'manual' && (item.cost ?? 0) > 0 ? item.cost! : rollup(item))) as CostFn;
  fn.effective = fn;
  fn.rollup = rollup;
  return fn;
}
