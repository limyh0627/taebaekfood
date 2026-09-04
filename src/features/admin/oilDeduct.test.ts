import { describe, it, expect } from 'vitest';
import { perUnitOilKg, hasProductComponent } from './orderStockEngine';
import { buildBomIndex, setBomIndex } from '../../shared/bomIndex';
import type { Item } from '../../shared/types';

describe('hasProductComponent — 품목 원료식을 또 적용하면 안 되는 품목', () => {
  //  구성은 품목에 안 붙는다 — item_bom을 세워 두고 판정이 id로 읽는다.
  const it_ = (id: string, type: string) =>
    ({ id, name: id, type, unit: '개', stock: 0, minStock: 0 }) as Item;
  const bom = (parent: string, child: string) => ({ parent_id: parent, child_id: child, quantity: 1 });
  const children = [
    it_('참기름300', 'product'), it_('들기름300', 'product'), it_('낱개', 'product'),
    it_('시골향참기름분1800', 'product'), it_('옛낱개', '완제품'),
    it_('박스', 'submaterial'), it_('용기', 'submaterial'), it_('마개', 'submaterial'), it_('라벨', 'submaterial'),
  ];
  const 세트 = it_('세트', 'product');
  const 박스품목 = it_('박스품목', 'product');
  const 재포장 = it_('재포장', 'product');
  const 병입 = it_('병입', 'product');
  const 빈것 = it_('빈것', 'product');
  const 옛것 = it_('옛것', 'product');

  setBomIndex(buildBomIndex([...children, 세트, 박스품목, 재포장, 병입, 빈것, 옛것], [
    bom('세트', '참기름300'), bom('세트', '들기름300'),
    bom('박스품목', '박스'), bom('박스품목', '낱개'),
    bom('재포장', '시골향참기름분1800'),
    bom('병입', '용기'), bom('병입', '마개'), bom('병입', '라벨'),
    bom('옛것', '옛낱개'),
  ]));

  it('세트(완제품 여러 개)는 true — 구성품이 자기 원료를 지님', () => {
    expect(hasProductComponent(세트)).toBe(true);
  });

  it('박스(낱개 ×N)도 true', () => {
    expect(hasProductComponent(박스품목)).toBe(true);
  });

  it('재포장(완제품 1개 ×1)도 true — 수량이 1이라 박스 판정은 안 되지만 이중차감은 막아야 한다', () => {
    expect(hasProductComponent(재포장)).toBe(true);
  });

  it('부자재·원료만 있으면 false — 원료식 폴백이 돌아야 한다', () => {
    expect(hasProductComponent(병입)).toBe(false);
    expect(hasProductComponent(빈것)).toBe(false);
    expect(hasProductComponent(undefined)).toBe(false);
  });

  it("legacy 라벨 '완제품'도 인식", () => {
    expect(hasProductComponent(옛것)).toBe(true);
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
