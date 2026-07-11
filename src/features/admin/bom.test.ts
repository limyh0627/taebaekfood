import { describe, it, expect } from 'vitest';
import { buildFormula } from './bom';
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
