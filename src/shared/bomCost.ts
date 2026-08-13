import { Item } from './types';
import { toKg, baseRawName, unitToKg } from '../constants/formula';
import { bomQty } from './bom';

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
  /**
   * BOM 단일원천 — item_bom을 그대로 읽는다. 넘기면 `item.submaterials`(레거시 파생)를 안 본다.
   * 안 넘기면 예전처럼 submaterials로 폴백(구 호출부·테스트 호환).
   */
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

  // 구성품 조회 — item_bom을 주면 그걸 단일원천으로 쓰고, 없으면 레거시 submaterials.
  //   item_bom의 quantity와 submaterials의 stock은 같은 뜻이라 { id, stock }으로 맞춰 돌려준다.
  const bomByParent = new Map<string, { id: string; stock: number }[]>();
  for (const b of ctx.itemBoms ?? []) {
    const arr = bomByParent.get(b.parent_id) ?? [];
    arr.push({ id: b.child_id, stock: typeof b.quantity === 'number' ? b.quantity : 1 });
    bomByParent.set(b.parent_id, arr);
  }
  const componentsOf = (item: Item): { id: string; stock: number }[] =>
    ctx.itemBoms
      ? (bomByParent.get(item.id) ?? [])
      : ((item.submaterials ?? []) as unknown as { id: string; stock: number }[]);

  const cost = (item: Item, seen: Set<string>): number => {
    const cached = memo.get(item.id);
    if (cached != null) return cached;
    if (seen.has(item.id)) return 0; // 순환 방어 (BOM 사이클)
    const s2 = new Set(seen).add(item.id);

    // 종단 품목 = 자기 cost가 원가 (매입·선제조 완료값)
    //   goods(완사입)·raw(원료)·wip(반제품)·submaterial(부자재)·box(겉박스)
    if (TERMINAL.has(item.category as string)) {
      const stored = item.cost ?? 0;
      if (stored > 0) { memo.set(item.id, stored); return stored; }
      // **제조 반제품**은 저장 원가가 없으면 원료식으로 굴린다.
      //   참기름특A = 깨분참기름 0.5 + 통깨참기름 0.5 처럼 사서 오는 게 아니라 섞어 만드는 것.
      //   (매입 반제품 — 깨분참기름/16.5kg 등 — 은 저장 cost가 종단이라 여기 안 걸린다: stored>0)
      //   완제품과 달리 용량(spec)이 없으므로 toKg 경로가 아니라 '단위 1당 비율 합'으로 계산한다.
      if (item.category === 'wip') {
        const f = ctx.formulaOf(item.품목 || item.name);
        if (f.length) {
          // 배합 반제품 1kg당 원가 = 구성 원료의 kg당 원가를 비율로 섞은 값. 단위 환산 없음(전부 kg).
          const blended = f.reduce((s, r) => s + rawCostPerKg(r.raw, byRawName) * r.ratio, 0);
          if (blended > 0) { memo.set(item.id, blended); return blended; }
        }
      }
      memo.set(item.id, stored);
      return stored;
    }

    const subs = componentsOf(item);
    // 조립 구성품(완제품/박스/반제품)을 품으면 그 구성품이 원료원가를 이미 지님 → 원료식 중복 skip
    //   참기름 병입은 '참기름특A 1.8L + 병 + 캡'이 실제 공정이다. 여기에 원료식(깨분·통깨)까지
    //   더하면 기름값이 두 번 잡힌다 — 반제품이 이미 그 기름을 담고 있기 때문.
    const hasAssembled = subs.some(s => {
      const c = byId.get(s.id);
      return !!c && (c.category === 'product' || c.category === 'box' || c.category === 'wip');
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
      // 겉박스·테이프도 BOM에 있으면 그대로 원가에 넣는다 — 예전엔 낱개의 겉박스를 코드로 건너뛰었지만,
      // 이제 낱개 BOM에 그것들을 안 둔다(박스 품목을 만들 때 그 BOM으로 잡힌다). BOM이 곧 구성이다.
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
