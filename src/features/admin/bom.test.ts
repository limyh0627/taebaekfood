import { describe, it, expect } from 'vitest';
import { buildFormula } from './bom';
import { PRODUCT_FORMULA } from '../../constants/formula';
import type { ItemFormula, Item } from '../../shared/types';

const f = (parent_key: string, child_name: string, yield_rate = 1, ratio = 1): ItemFormula =>
  ({ id: `${parent_key}-${child_name}`, parent_key, child_name, ratio, yield_rate });
const phantom = (name: string): Item => ({ id: name, name, category: 'wip', phantom: true } as Item);

describe('buildFormula — 배합식 전개', () => {
  it('단일레벨: item_formula의 ratio×yield_rate', () => {
    const out = buildFormula('통깨참기름', [f('통깨참기름', '참깨', 0.45)], []);
    expect(out).toEqual([{ raw: '참깨', ratio: 0.45 }]);
  });

  it('phantom 반제품은 하위 원료로 재귀 전개(비율 곱)', () => {
    const forms = [
      f('완제품X', '혼합원액', 1),
      f('혼합원액', '통깨참기름', 0.6),
      f('혼합원액', '옥수수유', 0.4),
    ];
    const out = buildFormula('완제품X', forms, [phantom('혼합원액')]);
    expect(out).toEqual([
      { raw: '통깨참기름', ratio: 0.6 },
      { raw: '옥수수유', ratio: 0.4 },
    ]);
  });

  it('phantom이 아니면 종단(전개 안 함)', () => {
    const forms = [
      f('완제품X', '통깨참기름', 1),
      f('통깨참기름', '참깨', 0.45), // 통깨참기름은 phantom 아님 → 참깨로 안 내려감
    ];
    const out = buildFormula('완제품X', forms, []);
    expect(out).toEqual([{ raw: '통깨참기름', ratio: 1 }]);
  });

  it('item_formula 없으면 PRODUCT_FORMULA 폴백', () => {
    expect(buildFormula('시골향참기름1', [], [])).toEqual([{ raw: '통깨참기름', ratio: 1 }]);
  });

  it('배합식 없으면 빈 배열', () => {
    expect(buildFormula('존재안함', [], [])).toEqual([]);
  });
});

// 서류(원료수불부) 사용량이 이 표 하나에서 나온다 — 값이 흔들리면 수불부가 조용히 틀어진다.
// 재고는 BOM(반제품)이 따로 정하므로 이 값과 다를 수 있고, 그게 정상이다.
describe('PRODUCT_FORMULA — 서류용 품목 배합 (2026-08-09 확정)', () => {
  const mix = (k: string) => Object.fromEntries(PRODUCT_FORMULA[k].map(r => [r.raw, r.ratio]));

  it('참기름', () => {
    expect(mix('시골향참기름1')).toEqual({ 통깨참기름: 1.0 });
    expect(mix('시골향참기름2')).toEqual({ 통깨참기름: 0.5, 깨분참기름: 0.5 });
    expect(mix('시골향참기름3')).toEqual({ 깨분참기름: 1.0 });
    expect(mix('시골향참기름4')).toEqual({ 통깨참기름: 0.1, 깨분참기름: 0.9 });
    expect(mix('하남댁참기름')).toEqual({ 통깨참기름: 1.0 });
    expect(mix('해달참기름')).toEqual({ 통깨참기름: 1.0 });
  });

  it('들기름', () => {
    expect(mix('시골향들기름1')).toEqual({ 통들깨들기름: 1.0 });
    expect(mix('시골향들기름2')).toEqual({ 수입들기름: 1.0 });   // 수입산 100% (2026-08-12)
    expect(mix('하남댁들기름')).toEqual({ 통들깨들기름: 0.25, 수입들기름: 0.75 });
    expect(mix('해달들기름')).toEqual({ 통들깨들기름: 0.2, 수입들기름: 0.8 });
    expect(mix('하남댁맑음들기름')).toEqual({ 생들기름: 1.0 });
  });

  it('각 품목의 비율 합은 1', () => {
    for (const [k, rows] of Object.entries(PRODUCT_FORMULA))
      expect(rows.reduce((s, r) => s + r.ratio, 0), k).toBeCloseTo(1, 6);
  });
});
