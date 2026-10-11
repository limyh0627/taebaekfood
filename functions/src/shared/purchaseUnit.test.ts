import { describe, expect, it } from 'vitest';
import { makePurchaseUnitSnapshot, recalculatePurchaseUnitSnapshot, readPurchaseUnitSnapshot, validatePurchaseUnitRegistration, returnKgFromPurchaseSnapshot, type ItemPurchaseUnit } from './purchaseUnit';
const unit: ItemPurchaseUnit = { id: 'u', companyId: 'taebaek', itemId: 'raw', purchaseUnit: '자루', unitKg: 22.5, isDefault: false, active: true, createdAt: '2026-10-11', updatedAt: '2026-10-11' };
describe('매입 단위의 발행 당시 kg', () => {
  it('임의 등록 kg를 곱하고 거래 수량은 그대로 보존한다', () => {
    expect(makePurchaseUnitSnapshot(unit, 3)).toEqual({ purchaseUnitId: 'u', purchaseUnit: '자루', purchaseQty: 3, unitKg: 22.5, inventoryQty: 67.5 });
    expect(makePurchaseUnitSnapshot({ ...unit, unitKg: 7.1234 }, 2).inventoryQty).toBe(14.247);
  });
  it('옛 기록 전체 부재는 null이며 5필드 중 일부만 있으면 실패한다', () => {
    expect(readPurchaseUnitSnapshot({ qty: 3 })).toBeNull();
    expect(() => readPurchaseUnitSnapshot({ purchaseUnit: '자루' })).toThrow();
  });
  it('0·음수·NaN·Infinity·틀린 kg 및 원거래 수량은 거절한다', () => {
    const snapshot = makePurchaseUnitSnapshot(unit, 3);
    for (const value of [0, -1, NaN, Infinity]) expect(() => makePurchaseUnitSnapshot(unit, value)).toThrow();
    for (const change of [{ unitKg: 0 }, { inventoryQty: 0 }, { inventoryQty: 67.501 }, { purchaseQty: 2 }, { qty: 2 }, { quantity: 2 }, { purchaseUnitId: '' }]) expect(() => readPurchaseUnitSnapshot({ ...snapshot, ...change })).toThrow();
  });
  it('등록표 회사·품목·거래처와 신규 발행 snapshot이 같아야 한다', () => {
    const snapshot = makePurchaseUnitSnapshot(unit, 3), scope = { companyId: 'taebaek' as const, itemId: 'raw', partnerId: 'partner' };
    expect(() => validatePurchaseUnitRegistration(snapshot, unit, scope)).not.toThrow();
    expect(() => validatePurchaseUnitRegistration(snapshot, { ...unit, partnerId: 'partner' }, scope)).not.toThrow();
    for (const change of [{ companyId: 'punghoe' as const }, { itemId: 'other' }, { partnerId: 'other' }, { active: false }, { unitKg: 25 }, { purchaseUnit: '통' }, { id: 'other' }]) expect(() => validatePurchaseUnitRegistration(snapshot, { ...unit, ...change }, scope)).toThrow();
  });
  it('부분·전체 반품은 과거 확정 kg를 비례하며 오늘 등록 변경은 영향을 주지 않는다', () => {
    const snapshot = makePurchaseUnitSnapshot(unit, 3);
    expect(returnKgFromPurchaseSnapshot(snapshot, 1)).toBe(22.5);
    expect(returnKgFromPurchaseSnapshot(snapshot, 3)).toBe(67.5);
    unit.unitKg = 25;
    expect(returnKgFromPurchaseSnapshot(snapshot, 1)).toBe(22.5);
    unit.unitKg = 22.5;
    for (const qty of [-1, 4, Infinity, NaN]) expect(() => returnKgFromPurchaseSnapshot(snapshot, qty)).toThrow();
  });
  it('반복 부분 반품은 누적 kg 차분으로 전량까지 정확히 복원한다', () => {
    const snapshot = makePurchaseUnitSnapshot({ ...unit, unitKg: 10 / 3 }, 3);
    const parts = [0, 1, 2].map(previous => returnKgFromPurchaseSnapshot(snapshot, 1, previous));
    expect(parts).toEqual([3.333, 3.334, 3.333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(snapshot.inventoryQty);
    expect(() => returnKgFromPurchaseSnapshot(snapshot, 1, 3)).toThrow();
    expect(() => returnKgFromPurchaseSnapshot(snapshot, 1, NaN)).toThrow();
  });
  it('등록한 20·22.5·25kg 포장 및 부분 포대는 각각 원거래 수량을 보존한다', () => {
    const snapshots = [20, 22.5, 25].map(unitKg => makePurchaseUnitSnapshot({ ...unit, unitKg }, 1.5));
    expect(snapshots.map(row => row.inventoryQty)).toEqual([30, 33.75, 37.5]);
    expect(snapshots.map(row => row.purchaseQty)).toEqual([1.5, 1.5, 1.5]);
    expect(snapshots.reduce((sum, row) => sum + row.inventoryQty, 0)).toBe(101.25);
  });
  it('작성 중 수량 변경은 선택 당시 kg만 유지하고 빈 수량 저장은 거절한다', () => {
    const before = makePurchaseUnitSnapshot(unit, 3);
    const after = recalculatePurchaseUnitSnapshot(before, 2);
    expect(after).toEqual({ ...before, purchaseQty: 2, inventoryQty: 45 });
    expect(before.purchaseQty).toBe(3);
    expect(() => recalculatePurchaseUnitSnapshot(before, 0)).toThrow();
  });
});
