import { describe, it, expect } from 'vitest';
import { buildCostFn, rawCostPerKg } from './bomCost';
import { Item } from './types';

// 최소 필드만 채운 Item 헬퍼
const mk = (p: Partial<Item> & { id: string; name: string; type: string }): Item =>
  ({ stock: 0, ...p } as Item);

// 원료·반제품
const 볶음참깨 = mk({ id: 'raw-볶음참깨', name: '볶음참깨', type: 'wip', unit: 'kg', cost: 5100 });
// cost는 kg당(2026-08-14~). 예전 9187/L을 kg당으로 옮기면 9187/0.916 = 10029.48
const 통깨참기름 = mk({ id: 'raw-oil', name: '통깨참기름', type: 'raw', unit: 'L', density: 0.916, cost: 10029.48 });
const 참깨 = mk({ id: 'raw-참깨', name: '참깨', type: 'raw', unit: 'kg', cost: 4105 });

// 부자재
const 육호박스 = mk({ id: 'box6', name: '6호박스', type: 'submaterial', category: '박스', cost: 1045 });
const 테이프 = mk({ id: 'tape', name: '테이프-투명', type: 'submaterial', cost: 0 });
const 병 = mk({ id: 'bottle', name: '유리병-1750', type: 'submaterial', category: '용기', cost: 300 });

// 낱개 완제품 — 품목 원료식으로 원가
const 낱개 = mk({ id: 'loose', name: '볶음참깨-낱개/1kg', type: 'product', spec: '1kg', 품목: '시골향볶음참깨' });

// 박스 완제품 — 낱개×10 + 6호박스 + 테이프(0). 품목도 있지만 조립이라 원료식 skip 돼야
const 박스 = mk({
  id: 'box10', name: '볶음참깨/10kg박스', type: 'product', spec: '10kg', 품목: '시골향볶음참깨',
  unpackTo: { itemId: 'loose', count: 10 },
});

// 기름 완제품 — 1750ml 통깨참기름 + 병
const 참기름 = mk({
  id: 'oil-prod', name: '시골향 참기름/1750ml', type: 'product', spec: '1750ml', 품목: '시골향참기름1',
});

//  구성은 item_bom이 유일 원천이다 — 예전엔 품목의 submaterials에 달았다(폐기).
const bom = (parent: string, child: string, quantity: number) => ({ parent_id: parent, child_id: child, quantity });
const itemBoms = [
  bom('box10', 'loose', 10), bom('box10', 'box6', 1), bom('box10', 'tape', 0),
  bom('oil-prod', 'bottle', 1),
];

const allItems = [볶음참깨, 통깨참기름, 참깨, 육호박스, 테이프, 병, 낱개, 박스, 참기름];

const formulaOf = (key: string): { raw: string; ratio: number }[] => {
  const F: Record<string, { raw: string; ratio: number }[]> = {
    시골향볶음참깨: [{ raw: '볶음참깨', ratio: 1.0 }],
    시골향참기름1: [{ raw: '통깨참기름', ratio: 1.0 }],
  };
  return F[key] ?? [];
};

describe('bomCost — rawCostPerKg', () => {
  const byRaw = new Map<string, Item>([['볶음참깨', 볶음참깨], ['통깨참기름', 통깨참기름]]);
  it('kg 원료는 cost 그대로', () => {
    expect(rawCostPerKg('볶음참깨', byRaw)).toBe(5100);
  });
  it('기름도 cost를 그대로 쓴다 — 이미 kg당', () => {
    expect(rawCostPerKg('통깨참기름', byRaw)).toBe(10029.48);
  });
  it('없는 원료는 0', () => {
    expect(rawCostPerKg('없는것', byRaw)).toBe(0);
  });
});

describe('bomCost — buildCostFn', () => {
  const cost = buildCostFn({ allItems, formulaOf, itemBoms });

  it('원료·반제품은 자기 cost', () => {
    expect(cost(볶음참깨)).toBe(5100);
    expect(cost(통깨참기름)).toBe(10029.48);
  });

  it('낱개 완제품 = 원료식(볶음참깨 1kg)', () => {
    expect(cost(낱개)).toBe(5100);
  });

  it('박스 = 낱개×10 + 6호박스, 테이프(0) 제외, 원료식 이중계상 안 함', () => {
    // 51000 + 1045 = 52045  (원료식 10kg×5100=51000 이 또 더해지면 안 됨)
    expect(cost(박스)).toBe(52045);
  });

  it('기름 완제품 = 원료(1750ml) + 병', () => {
    const oilKg = 1.75 * 0.916;              // toKg('1750ml','통깨참기름',1)
    const expected = oilKg * 10029.48 + 300;   // kg × kg당단가
    expect(cost(참기름)).toBeCloseTo(expected, 2);
  });

  /**
   * 원가 출처는 **품목이 정한다**(costSource). 예전엔 저장 cost가 0만 아니면 무조건 이겨서,
   * 원료값이 올라도 완제품 원가가 옛 값에 굳었다.
   */
  it("costSource='manual'이면 손으로 넣은 값, 안 정하면 롤업", () => {
    const 못박음 = mk({ id: 'x', name: '완제품X', type: 'product', cost: 999, costSource: 'manual', 품목: '시골향볶음참깨', spec: '1kg' });
    const 그냥저장 = mk({ id: 'y', name: '완제품Y', type: 'product', cost: 999, 품목: '시골향볶음참깨', spec: '1kg' });
    const c = buildCostFn({ allItems: [...allItems, 못박음, 그냥저장], formulaOf, itemBoms });
    expect(c(못박음)).toBe(999);        // 못 박은 값
    expect(c(그냥저장)).toBe(5100);      // 저장값이 있어도 롤업이 이긴다
    expect(c(낱개)).toBe(5100);
  });

  it('rollup()은 못 박은 품목도 계산값을 준다 — 편집 화면의 토글이 쓴다', () => {
    const 못박음 = mk({ id: 'x', name: '완제품X', type: 'product', cost: 999, costSource: 'manual', 품목: '시골향볶음참깨', spec: '1kg' });
    const c = buildCostFn({ allItems: [...allItems, 못박음], formulaOf, itemBoms });
    expect(c(못박음)).toBe(999);
    expect(c.rollup(못박음)).toBe(5100);
  });

  it('가공비 hook 반영', () => {
    const c = buildCostFn({ allItems, formulaOf, itemBoms, processingFeeOf: it => (it.procureType === '임가공' ? 500 : 0) });
    const oem = mk({ id: 'oem', name: 'OEM낱개', type: 'product', spec: '1kg', 품목: '시골향볶음참깨', procureType: '임가공' });
    expect(c({ ...oem })).toBe(5100 + 500);
  });

  it('원료명 충돌 시 정확한 이름 + raw 우선 (드럼 반제품에 안 걸림)', () => {
    // '깨분참기름' 벌크원료(7884.72/kg) vs '깨분참기름/16.5kg' 드럼 반제품(120000)
    const 벌크 = mk({ id: 'bulk', name: '깨분참기름', type: 'raw', unit: 'L', density: 0.916, cost: 7884.72 });
    const 드럼 = mk({ id: 'drum', name: '깨분참기름/16.5kg', type: 'wip', unit: '개', cost: 120000 });
    const prod = mk({ id: 'p', name: '분참기름', type: 'product', spec: '1800ml', 품목: '분식' });
    const c = buildCostFn({
      allItems: [드럼, 벌크, prod],  // 드럼이 먼저 와도 벌크가 선택돼야
      formulaOf: k => (k === '분식' ? [{ raw: '깨분참기름', ratio: 1 }] : []),
    });
    // 1.8L × 0.916 kg/L × 7884.72/kg = 12999.6
    expect(c(prod)).toBeCloseTo(1.8 * 0.916 * 7884.72, 0);
  });

  it('순환 BOM도 무한루프 없이 종료', () => {
    const a = mk({ id: 'A', name: 'A', type: 'product' });
    const b = mk({ id: 'B', name: 'B', type: 'product' });
    const c = buildCostFn({ allItems: [a, b], formulaOf, itemBoms: [bom('A', 'B', 1), bom('B', 'A', 1)] });
    expect(() => c(a)).not.toThrow();
    expect(Number.isFinite(c(a))).toBe(true);
  });
});

/**
 * 수율은 **나눈다** — 사장님 지적으로 잡은 자리.
 * "37%는 들깨 1kg으로 기름 370g 나온다는 거지" → 기름 1kg엔 들깨 1/0.37 = 2.7kg.
 * 예전엔 buildFormula가 주는 `ratio × yield_rate`를 그대로 곱해서 6,700 × 0.37 = 2,479가 나왔다.
 */
describe('제조 반제품 — 수율을 나눈다', () => {
  const 들깨 = mk({ id: 'raw-들깨', name: '들깨', type: 'raw', unit: 'kg', cost: 6700 });
  const 통들깨들기름 = mk({ id: 'wip-통들깨', name: '통들깨들기름', type: 'wip', unit: 'L', density: 0.924, cost: 15663 });
  const 수입들기름 = mk({ id: 'wip-수입', name: '수입들기름', type: 'wip', unit: 'L', cost: 11467 });
  const 들기름 = mk({ id: 'wip-들기름', name: '들기름', type: 'wip', unit: 'L' });
  const items = [들깨, 통들깨들기름, 수입들기름, 들기름];
  const ROWS: Record<string, { raw: string; ratio: number; yieldRate: number }[]> = {
    통들깨들기름: [{ raw: '들깨', ratio: 1, yieldRate: 0.37 }],
    들기름: [{ raw: '수입들기름', ratio: 0.8, yieldRate: 1 }, { raw: '통들깨들기름', ratio: 0.2, yieldRate: 1 }],
  };
  const c = buildCostFn({
    allItems: items, itemBoms: [],
    formulaOf: () => [],
    formulaRowsOf: k => ROWS[k] ?? [],
  });

  it('들깨 6,700 · 수율 37% → 18,108원/kg (곱하면 2,479로 7배 작다)', () => {
    expect(c(통들깨들기름)).toBeCloseTo(6700 / 0.37, 0);
    expect(c(통들깨들기름)).toBeGreaterThan(6700);   // 원료보다 비싸야 한다 — 짜면 줄어드니까
  });

  it('저장 원가가 있어도 원료식이 세다 — 원료값이 오르면 따라와야 한다', () => {
    expect(통들깨들기름.cost).toBe(15663);          // 들깨 5,795원 시절 값
    expect(c(통들깨들기름)).not.toBeCloseTo(15663, 0);
  });

  it('중간 반제품을 거쳐도 재귀로 굴린다 — 들기름 = 수입 0.8 + 통들깨 0.2', () => {
    expect(c(들기름)).toBeCloseTo(11467 * 0.8 + (6700 / 0.37) * 0.2, 0);
  });

  it('수율 100%(배합)은 그냥 비율대로', () => {
    const 반반 = mk({ id: 'wip-반반', name: '반반', type: 'wip' });
    const c2 = buildCostFn({
      allItems: [...items, 반반], itemBoms: [], formulaOf: () => [],
      formulaRowsOf: k => (k === '반반' ? [{ raw: '수입들기름', ratio: 0.5, yieldRate: 1 }, { raw: '들깨', ratio: 0.5, yieldRate: 1 }] : ROWS[k] ?? []),
    });
    expect(c2(반반)).toBeCloseTo(11467 * 0.5 + 6700 * 0.5, 0);
  });

  it('원료식이 없는 매입 반제품은 저장 원가가 종단', () => {
    expect(c(수입들기름)).toBe(11467);
  });
});

/**
 * 면세 원료 → 과세품. 매입세액을 못 빼니 그만큼 원가에 얹힌다.
 * 사장님 지적 — "통깨는 참깨가 면세고 통깨참기름은 과세여서 참깨에 1.1곱해서 해야할걸".
 */
/**
 * **원가는 공급가액으로만 본다**(2026-09-06 사장님: "아예 면세로만 원가 보는게 fm 아니야?").
 *
 * 전에는 면세 원료로 과세품을 만들면 원가에 ×1.1을 얹었다. 틀린 셈이었다 —
 * 면세 농산물은 살 때 부가세를 **애초에 안 낸다.** 못 빼는 매입세액이 없으니 얹을 것도 없다.
 * 과세 원료는 낸 부가세를 매출세액에서 공제받으므로 역시 원가가 아니다.
 *
 * 마진도 판매가의 공급가액과 견주므로(shared/margin) 이제 양쪽 기준이 같다 —
 * 전에는 분자에서만 세금을 빼고 분모(원가)엔 세금이 든 채라 마진이 나쁘게 나왔다.
 */
describe('원가는 부가세를 안 얹는다', () => {
  const 참깨 = mk({ id: 'raw-참깨', name: '참깨', type: 'raw', unit: 'kg', cost: 4105 });
  const 깨분 = mk({ id: 'raw-깨분', name: '깨분', type: 'raw', unit: 'kg', cost: 2970 });   // 과세
  const 통깨참기름 = mk({ id: 'wip-통깨', name: '통깨참기름', type: 'wip', unit: 'L' });
  const 깨분참기름 = mk({ id: 'wip-깨분', name: '깨분참기름', type: 'wip', unit: 'L' });
  const ROWS: Record<string, { raw: string; ratio: number; yieldRate: number }[]> = {
    통깨참기름: [{ raw: '참깨', ratio: 1, yieldRate: 0.48 }],
    깨분참기름: [{ raw: '깨분', ratio: 1, yieldRate: 0.45 }],
  };
  const c = buildCostFn({
    allItems: [참깨, 깨분, 통깨참기름, 깨분참기름], itemBoms: [],
    formulaOf: () => [], formulaRowsOf: k => ROWS[k] ?? [],
  });

  it('면세 원료도 단가 그대로 — 살 때 부가세를 안 냈으니 얹을 게 없다', () => {
    expect(c(통깨참기름)).toBeCloseTo(4105 / 0.48, 0);
  });

  it('과세 원료도 단가 그대로 — 낸 부가세는 공제받으니 원가가 아니다', () => {
    expect(c(깨분참기름)).toBeCloseTo(2970 / 0.45, 0);
  });

  it('만드는 물건이 과세든 면세든 원가는 같다', () => {
    const 면세품 = mk({ id: 'wip-면세', name: '면세품', type: 'wip' });
    const 과세품 = mk({ id: 'wip-과세', name: '과세품', type: 'wip' });
    const c2 = buildCostFn({
      allItems: [참깨, 면세품, 과세품], itemBoms: [], formulaOf: () => [],
      formulaRowsOf: k => (k === '면세품' || k === '과세품' ? [{ raw: '참깨', ratio: 1, yieldRate: 0.5 }] : []),
    });
    expect(c2(면세품)).toBeCloseTo(4105 / 0.5, 0);
    expect(c2(과세품)).toBeCloseTo(4105 / 0.5, 0);
  });
});
