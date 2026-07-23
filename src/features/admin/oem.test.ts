import { describe, it, expect } from 'vitest';
import { sentKg, batchLoss, yieldRate, processingFee, outstandingKg, subcontractStockByMaterial } from './oem';
import type { PurchaseOrder } from '../../shared/types';

const oemPo = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po1', itemId: '', itemName: '', quantity: 0, status: 'received',
  poType: 'oem', oemSent: [{ material: '참깨', kg: 1000 }], createdAt: '', ...over,
});

describe('sentKg', () => {
  it('여러 원료를 합산한다', () => {
    expect(sentKg([{ material: '참깨', kg: 1000 }, { material: '검정깨', kg: 200 }])).toBe(1200);
  });
  it('빈 값은 0', () => {
    expect(sentKg(undefined)).toBe(0);
    expect(sentKg([])).toBe(0);
  });
});

describe('batchLoss', () => {
  it('보낸 1000 − 받은 950 = 로스 50', () => {
    expect(batchLoss([{ material: '참깨', kg: 1000 }], 950)).toBe(50);
  });
  it('받은 게 더 많으면 0으로 클램프 (음수 로스 없음)', () => {
    expect(batchLoss([{ material: '참깨', kg: 1000 }], 1010)).toBe(0);
  });
  it('다종 원료는 총량 기준', () => {
    expect(batchLoss([{ material: '참깨', kg: 800 }, { material: '검정깨', kg: 200 }], 950)).toBe(50);
  });
});

describe('yieldRate', () => {
  it('950/1000 = 95%', () => {
    expect(yieldRate([{ material: '참깨', kg: 1000 }], 950)).toBe(95);
  });
  it('보낸 게 0이면 undefined', () => {
    expect(yieldRate([], 0)).toBeUndefined();
  });
});

// 단가는 부가세 포함 — 앱의 다른 전표와 같은 규칙. 넣은 금액이 곧 합계다.
describe('processingFee', () => {
  it('500원/kg × 1kg → 합계 500 (550 아님)', () => {
    expect(processingFee(1, 500)).toEqual({ supply: 455, tax: 45, total: 500 });
  });
  it('과세: 950kg × 2000 = 합계 1,900,000에서 공급가 역산', () => {
    expect(processingFee(950, 2000)).toEqual({ supply: 1_727_273, tax: 172_727, total: 1_900_000 });
  });
  it('면세: 전액 공급가, 세액 0', () => {
    expect(processingFee(950, 2000, false)).toEqual({ supply: 1_900_000, tax: 0, total: 1_900_000 });
  });
  it('공급가+세액은 항상 합계와 맞는다 (반올림 오차 없음)', () => {
    for (const [kg, price] of [[333, 1500], [7, 333], [1, 500], [12.5, 777]]) {
      const f = processingFee(kg, price);
      expect(f.supply + f.tax).toBe(f.total);
    }
  });
});

describe('outstandingKg', () => {
  it('열린 배치(sent)는 보낸 전량이 외주재고', () => {
    expect(outstandingKg(oemPo({ status: 'invoiced' }))).toBe(1000);
    expect(outstandingKg(oemPo({ status: 'pending' }))).toBe(1000);
  });
  it('닫힌 배치(received)는 0', () => {
    expect(outstandingKg(oemPo({ status: 'received' }))).toBe(0);
  });
  it('OEM 아닌 발주카드는 0', () => {
    expect(outstandingKg({ ...oemPo(), poType: undefined })).toBe(0);
  });
});

describe('subcontractStockByMaterial', () => {
  it('열린 OEM 배치만 원료별로 합산', () => {
    const pos: PurchaseOrder[] = [
      oemPo({ id: 'a', status: 'invoiced', oemSent: [{ material: '참깨', kg: 1000 }] }),
      oemPo({ id: 'b', status: 'invoiced', oemSent: [{ material: '참깨', kg: 500 }, { material: '들깨', kg: 300 }] }),
      oemPo({ id: 'c', status: 'received', oemSent: [{ material: '참깨', kg: 9999 }] }), // 닫힘 → 제외
      { ...oemPo({ id: 'd' }), poType: undefined },                                       // OEM 아님 → 제외
    ];
    expect(subcontractStockByMaterial(pos)).toEqual({ 참깨: 1500, 들깨: 300 });
  });
});
