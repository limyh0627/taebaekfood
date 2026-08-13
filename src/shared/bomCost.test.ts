import { describe, it, expect } from 'vitest';
import { buildCostFn, rawCostPerKg } from './bomCost';
import { Item } from './types';

// 최소 필드만 채운 Item 헬퍼
const mk = (p: Partial<Item> & { id: string; name: string; category: string }): Item =>
  ({ stock: 0, ...p } as Item);

// 원료·반제품
const 볶음참깨 = mk({ id: 'raw-볶음참깨', name: '볶음참깨', category: 'wip', unit: 'kg', cost: 5100 });
// cost는 kg당(2026-08-14~). 예전 9187/L을 kg당으로 옮기면 9187/0.916 = 10029.48
const 통깨참기름 = mk({ id: 'raw-oil', name: '통깨참기름', category: 'raw', unit: 'L', density: 0.916, cost: 10029.48 });
const 참깨 = mk({ id: 'raw-참깨', name: '참깨', category: 'raw', unit: 'kg', cost: 4105 });

// 부자재
const 육호박스 = mk({ id: 'box6', name: '6호박스', category: 'submaterial', subtype: '박스', cost: 1045 });
const 테이프 = mk({ id: 'tape', name: '테이프-투명', category: 'submaterial', cost: 0 });
const 병 = mk({ id: 'bottle', name: '유리병-1750', category: 'submaterial', subtype: '용기', cost: 300 });

// 낱개 완제품 — 품목 원료식으로 원가
const 낱개 = mk({ id: 'loose', name: '볶음참깨-낱개/1kg', category: 'product', spec: '1kg', 품목: '시골향볶음참깨' });

// 박스 완제품 — 낱개×10 + 6호박스 + 테이프(0). 품목도 있지만 조립이라 원료식 skip 돼야
const 박스 = mk({
  id: 'box10', name: '볶음참깨/10kg박스', category: 'product', spec: '10kg', 품목: '시골향볶음참깨',
  unpackTo: { itemId: 'loose', count: 10 },
  submaterials: [
    { id: 'loose', name: '볶음참깨-낱개/1kg', category: 'product', stock: 10 } as any,
    { id: 'box6', name: '6호박스', category: 'submaterial', stock: 1 } as any,
    { id: 'tape', name: '테이프-투명', category: 'submaterial', stock: 0 } as any,
  ],
});

// 기름 완제품 — 1750ml 통깨참기름 + 병
const 참기름 = mk({
  id: 'oil-prod', name: '시골향 참기름/1750ml', category: 'product', spec: '1750ml', 품목: '시골향참기름1',
  submaterials: [{ id: 'bottle', name: '유리병-1750', category: 'submaterial', stock: 1 } as any],
});

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
  const cost = buildCostFn({ allItems, formulaOf });

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

  it('effective: 저장 cost 우선, 없으면 롤업', () => {
    const withCost = mk({ id: 'x', name: '완제품X', category: 'product', cost: 999, 품목: '시골향볶음참깨', spec: '1kg' });
    const c = buildCostFn({ allItems: [...allItems, withCost], formulaOf });
    expect(c.effective(withCost)).toBe(999);   // 저장값
    expect(c.effective(낱개)).toBe(5100);        // 롤업
  });

  it('가공비 hook 반영', () => {
    const c = buildCostFn({ allItems, formulaOf, processingFeeOf: it => (it.procureType === '임가공' ? 500 : 0) });
    const oem = mk({ id: 'oem', name: 'OEM낱개', category: 'product', spec: '1kg', 품목: '시골향볶음참깨', procureType: '임가공' });
    expect(c({ ...oem })).toBe(5100 + 500);
  });

  it('원료명 충돌 시 정확한 이름 + raw 우선 (드럼 반제품에 안 걸림)', () => {
    // '깨분참기름' 벌크원료(7884.72/kg) vs '깨분참기름/16.5kg' 드럼 반제품(120000)
    const 벌크 = mk({ id: 'bulk', name: '깨분참기름', category: 'raw', unit: 'L', density: 0.916, cost: 7884.72 });
    const 드럼 = mk({ id: 'drum', name: '깨분참기름/16.5kg', category: 'wip', unit: '개', cost: 120000 });
    const prod = mk({ id: 'p', name: '분참기름', category: 'product', spec: '1800ml', 품목: '분식' });
    const c = buildCostFn({
      allItems: [드럼, 벌크, prod],  // 드럼이 먼저 와도 벌크가 선택돼야
      formulaOf: k => (k === '분식' ? [{ raw: '깨분참기름', ratio: 1 }] : []),
    });
    // 1.8L × 0.916 kg/L × 7884.72/kg = 12999.6
    expect(c(prod)).toBeCloseTo(1.8 * 0.916 * 7884.72, 0);
  });

  it('순환 BOM도 무한루프 없이 종료', () => {
    const a = mk({ id: 'A', name: 'A', category: 'product', submaterials: [{ id: 'B', name: 'B', category: 'product', stock: 1 } as any] });
    const b = mk({ id: 'B', name: 'B', category: 'product', submaterials: [{ id: 'A', name: 'A', category: 'product', stock: 1 } as any] });
    const c = buildCostFn({ allItems: [a, b], formulaOf });
    expect(() => c(a)).not.toThrow();
    expect(Number.isFinite(c(a))).toBe(true);
  });
});
