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

// 참기름 밀도 0.916 / 들기름 0.924 (constants/formula DENSITY)
const D = 0.916;
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

describe('perUnitOilKg — 완제품 1개당 오일 kg (BOM 수량만 본다)', () => {
  // 2026-08-14부터 BOM 수량은 kg으로 저장한다. 화면에서만 밀도로 나눠 L로 보여준다.
  // 그래서 여기서는 곱하지 않고 적힌 값을 그대로 쓴다.
  it('BOM에 적힌 kg이 곧 오일량', () => {
    near(perUnitOilKg(0.3206), 0.3206);      // 350ml × 0.916
    near(perUnitOilKg(1.6488), 1.6488);      // 1800ml × 0.916
    near(perUnitOilKg(1.6632), 1.6632);      // 1800ml × 0.924 (들기름)
  });

  it('밀도를 다시 곱하지 않는다 — 저장이 이미 kg', () => {
    expect(perUnitOilKg(1.6488)).not.toBeCloseTo(1.6488 * D, 4);
    expect(perUnitOilKg(1.6488)).toBe(1.6488);
  });

  it('인자는 BOM 수량 하나뿐 — 원료명·병 용량(spec)은 계산에 안 쓴다', () => {
    expect(perUnitOilKg.length).toBe(1);
  });

  it('이중 계산 회귀 방지 — 0.3206이 0.3206²으로 나오면 안 된다', () => {
    expect(perUnitOilKg(0.3206)).toBeGreaterThan(0.3206 * 0.3206);
  });

  it('알찬 실사례: 참기름/병/특/알찬/350ml 45개, 참기름특 = 깨분 0.75 / 통깨 0.25', () => {
    const bom = 0.35 * D;                    // BOM에 저장된 kg
    near(perUnitOilKg(bom) * 45 * 0.75, 10.8202);
    near(perUnitOilKg(bom) * 45 * 0.25, 3.6068);
  });
});
