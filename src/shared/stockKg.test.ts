import { describe, it, expect } from 'vitest';
import { kgPerStockUnit, stockKg } from './orderUnits';
import { resetBomIndex, setBomIndex } from './bomIndex';

const 낱개 = { id: 'loose', spec: '1kg' };
const 박스10 = { id: 'b10', spec: '1kg * 10', unpackTo: { itemId: 'loose', count: 10 } } as any;
const 박스20 = { id: 'b20', spec: '1kg * 20', unpackTo: { itemId: 'loose', count: 20 } } as any;
const 찾기 = (id: string) => ({ loose: 낱개 } as any)[id];

describe('kgPerStockUnit — 재고 1단위가 몇 kg', () => {
  it('낱개는 규격에서 읽는다', () => {
    expect(kgPerStockUnit(낱개 as any, 찾기)).toBe(1);
  });

  it('**박스는 낱개 규격 × 개입수** — 박스 규격에서 읽으면 1이 나온다', () => {
    expect(kgPerStockUnit(박스10, 찾기)).toBe(10);
    expect(kgPerStockUnit(박스20, 찾기)).toBe(20);
  });

  it('규격에 kg 이 없으면 모른다 — 0 으로 치면 총량이 조용히 준다', () => {
    expect(kgPerStockUnit({ id: 'x', spec: '500ml' } as any, 찾기)).toBeUndefined();
    expect(kgPerStockUnit({ id: 'x' } as any, 찾기)).toBeUndefined();
    expect(kgPerStockUnit(undefined, 찾기)).toBeUndefined();
  });

  it('박스인데 낱개를 못 찾으면 모른다', () => {
    expect(kgPerStockUnit(박스10, () => undefined)).toBeUndefined();
  });

  it('소수 규격도 읽는다 — 16.5kg 포대', () => {
    expect(kgPerStockUnit({ id: 'x', spec: '16.5kg' } as any, 찾기)).toBe(16.5);
  });
});

describe('stockKg — 재고 수량 → kg', () => {
  it('낱개 5개 = 5kg', () => {
    expect(stockKg(5, 낱개 as any, 찾기)).toBe(5);
  });

  it('**20개입 박스 3개 = 60kg**', () => {
    expect(stockKg(3, 박스20, 찾기)).toBe(60);
  });

  it('10개입 박스 45개 = 450kg', () => {
    expect(stockKg(45, 박스10, 찾기)).toBe(450);
  });

  it('음수 재고도 그대로 — 가리면 못 찾는다', () => {
    expect(stockKg(-12, 박스20, 찾기)).toBe(-240);
  });

  it('모르면 undefined — 0 이 아니다', () => {
    expect(stockKg(5, { id: 'x', spec: '500ml' } as any, 찾기)).toBeUndefined();
  });

  it('소수는 g 자리까지만 — 부동소수 찌꺼기를 남기지 않는다', () => {
    expect(stockKg(3, { id: 'x', spec: '16.5kg' } as any, 찾기)).toBe(49.5);
  });
});

describe('BOM 이 근거다 — unpackTo 가 없어도 BOM 으로 푼다', () => {
  it('BOM 에 낱개 × 20 이 있으면 20kg', () => {
    setBomIndex({
      of: (id: string) => id === 'bomBox'
        ? [{ parentId: 'bomBox', childId: 'loose', qty: 20,
             child: { id: 'loose', name: '낱개', type: 'product', spec: '1kg' } } as any]
        : [],
      parentsOf: () => [],
    });
    expect(kgPerStockUnit({ id: 'bomBox', spec: '1kg * 20' } as any, 찾기)).toBe(20);
    resetBomIndex();
  });
});
