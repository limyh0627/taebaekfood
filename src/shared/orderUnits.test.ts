import { describe, it, expect } from 'vitest';
import { stockUnits, isBoxStockItem, unpackComponent } from './orderUnits';
import { toKg } from '../constants/formula';

const 낱개ID = 'PLDhkjOgcPIhO1hhReHm';
const bomSub = (id: string, qty: number, category = 'submaterial') =>
  ({ id, name: id, category, stock: qty, unit: '개' });

// 실제 데이터 모양 — 박스 품목 BOM에 완제품(낱개)이 수량과 함께 들어있다
const 박스20 = { submaterials: [bomSub(낱개ID, 20, 'product')] };
const 박스10 = { submaterials: [bomSub(낱개ID, 10, 'product')] };
const 참기름300 = { submaterials: [bomSub('container-300', 1), bomSub('cap-300', 2)] };
const 낱개 = { submaterials: [] };

describe('unpackComponent — BOM에서 읽는다', () => {
  it('BOM에 든 완제품 구성품이 낱개', () => {
    expect(unpackComponent(박스20)).toEqual({ itemId: 낱개ID, count: 20 });
    expect(unpackComponent(박스10)).toEqual({ itemId: 낱개ID, count: 10 });
  });
  it('부자재만 있으면 박스 품목이 아니다', () => {
    expect(unpackComponent(참기름300)).toBeNull();
    expect(unpackComponent(낱개)).toBeNull();
    expect(unpackComponent(undefined)).toBeNull();
  });
  it('BOM에 없으면 옛 unpackTo로 폴백', () => {
    expect(unpackComponent({ submaterials: [], unpackTo: { itemId: 낱개ID, count: 20 } }))
      .toEqual({ itemId: 낱개ID, count: 20 });
  });
  it('BOM이 우선 — unpackTo와 다르면 BOM을 쓴다', () => {
    expect(unpackComponent({ ...박스20, unpackTo: { itemId: 'x', count: 99 } }))
      .toEqual({ itemId: 낱개ID, count: 20 });
  });
});

describe('stockUnits', () => {
  it('일반 품목은 quantity 그대로', () => {
    expect(stockUnits({ quantity: 100 }, 참기름300)).toBe(100);
    expect(stockUnits({ quantity: 12, isBoxUnit: true, boxQuantity: 1 }, 참기름300)).toBe(12);
  });
  it('박스 품목은 박스 개수', () => {
    // 서래농산 20kg박스 5B → quantity=100(낱개kg), boxQuantity=5
    expect(stockUnits({ quantity: 100, isBoxUnit: true, boxQuantity: 5 }, 박스20)).toBe(5);
    // 무경유통 10kg박스 40B
    expect(stockUnits({ quantity: 400, isBoxUnit: true, boxQuantity: 40 }, 박스10)).toBe(40);
  });
  it('박스 개수로 들어오면 그대로 — 품목 들어간 수량만큼 빠진다', () => {
    // 주문 입력이 박스 기준으로 바뀐 뒤: quantity 자체가 박스 개수
    expect(stockUnits({ quantity: 5 }, 박스20)).toBe(5);
    expect(stockUnits({ quantity: 5, isBoxUnit: true, boxQuantity: 5 }, 박스20)).toBe(5);
  });
});

describe('원료 kg 환산 — spec은 재고 1단위의 내용량', () => {
  it('박스 품목: 20kg × 5B = 100kg', () => {
    const q = stockUnits({ quantity: 100, isBoxUnit: true, boxQuantity: 5 }, 박스20);
    expect(toKg('20kg', '볶음참깨', q)).toBe(100);
  });
  it('quantity를 그대로 넣으면 20배가 된다 (고치기 전 동작)', () => {
    expect(toKg('20kg', '볶음참깨', 100)).toBe(2000);
  });
  it('일반 완제품은 영향 없음 — 300ml 참기름 100병', () => {
    const q = stockUnits({ quantity: 100 }, 참기름300);
    expect(toKg('300ml', '통깨참기름', q)).toBeCloseTo(27.48, 6);
  });
});

describe('isBoxStockItem', () => {
  it('BOM에 낱개가 물려 있으면 박스 재고 품목', () => {
    expect(isBoxStockItem(박스20)).toBe(true);
    expect(isBoxStockItem(참기름300)).toBe(false);
    expect(isBoxStockItem({ submaterials: [bomSub(낱개ID, 1, 'product')] })).toBe(false); // ×1은 박스 아님
  });
});
