import { describe, it, expect } from 'vitest';
import { perUnitOilKg, hasProductComponent } from './orderStockEngine';

describe('hasProductComponent — 품목 원료식을 또 적용하면 안 되는 품목', () => {
  const sub = (category: string, id = 'x') => ({ id, name: id, category, quantity: 1 } as any);

  it('세트(완제품 여러 개)는 true — 구성품이 자기 원료를 지님', () => {
    expect(hasProductComponent({ submaterials: [sub('product', '참기름300'), sub('product', '들기름300')] })).toBe(true);
  });

  it('박스(낱개 ×N)도 true', () => {
    expect(hasProductComponent({ submaterials: [sub('박스'), sub('product', '낱개')] })).toBe(true);
  });

  it('재포장(완제품 1개 ×1)도 true — 수량이 1이라 박스 판정은 안 되지만 이중차감은 막아야 한다', () => {
    expect(hasProductComponent({ submaterials: [sub('product', '시골향참기름분1800')] })).toBe(true);
  });

  it('부자재·원료만 있으면 false — 원료식 폴백이 돌아야 한다', () => {
    expect(hasProductComponent({ submaterials: [sub('용기'), sub('마개'), sub('라벨')] })).toBe(false);
    expect(hasProductComponent({ submaterials: [] })).toBe(false);
    expect(hasProductComponent(undefined)).toBe(false);
  });

  it("legacy 라벨 '완제품'도 인식", () => {
    expect(hasProductComponent({ submaterials: [sub('완제품', '낱개')] })).toBe(true);
  });
});

// 참기름 밀도 0.916 (constants/formula DENSITY)
const D = 0.916;
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

describe('perUnitOilKg — 완제품 1개당 오일 kg (BOM 수량만 본다)', () => {
  it('BOM에 적힌 용량(L)이 곧 오일량', () => {
    near(perUnitOilKg(0.35, '깨분참기름'), 0.35 * D);
    near(perUnitOilKg(1.8, '통깨참기름'), 1.8 * D);
    near(perUnitOilKg(1.75, '통깨참기름'), 1.75 * D);
    near(perUnitOilKg(0.3, '깨분참기름'), 0.3 * D);
  });

  it('밀도가 원료별로 적용된다', () => {
    near(perUnitOilKg(1.8, '통들깨들기름'), 1.8 * 0.924);
    near(perUnitOilKg(1.8, '수입들기름'), 1.8 * 0.924);
  });

  it('병 용량(spec)은 계산에 안 쓴다 — 인자가 BOM 수량과 원료명뿐', () => {
    expect(perUnitOilKg.length).toBe(2);
  });

  it('이중 계산 회귀 방지 — 350ml×0.35 가 0.35²(0.1225L)로 나오면 안 된다', () => {
    const wrong = 0.35 * D * 0.35;
    expect(perUnitOilKg(0.35, '깨분참기름')).toBeGreaterThan(wrong);
    near(perUnitOilKg(0.35, '깨분참기름'), wrong / 0.35);
  });

  it('이중 계산 회귀 방지 — 1800ml×1.8 이 3.24L로 나오면 안 된다', () => {
    expect(perUnitOilKg(1.8, '통깨참기름')).toBeLessThan(1.8 * D * 1.8);
  });

  it('알찬 실사례: 참기름/병/특/알찬/350ml 45개, 참기름특 = 깨분 0.75 / 통깨 0.25', () => {
    near(perUnitOilKg(0.35, '깨분참기름') * 45 * 0.75, 10.8202);
    near(perUnitOilKg(0.35, '통깨참기름') * 45 * 0.25, 3.6068);
    // 버그 시절 스냅샷(DB에 3자리로 반올림돼 있다: 3.787 / 1.262)은 정확히 0.35배였다
    expect(perUnitOilKg(0.35, '깨분참기름') * 45 * 0.75 * 0.35).toBeCloseTo(3.787, 3);
    expect(perUnitOilKg(0.35, '통깨참기름') * 45 * 0.25 * 0.35).toBeCloseTo(1.262, 3);
  });
});
