import { describe, expect, it } from 'vitest';
import { MANUAL_PURCHASE_UNIT_ID, parseManualPurchaseUnitKg, makeManualPurchaseUnitSnapshot, isManualPurchaseUnitSnapshot, makePurchaseUnitSnapshot, recalculatePurchaseUnitSnapshot, readPurchaseUnitSnapshot, validatePurchaseUnitRegistration, returnKgFromPurchaseSnapshot, type ItemPurchaseUnit } from './purchaseUnit';
const unit: ItemPurchaseUnit = { id: 'u', companyId: 'taebaek', itemId: 'raw', purchaseUnit: '자루', unitKg: 22.5, isDefault: false, active: true, createdAt: '2026-10-11', updatedAt: '2026-10-11' };
describe('매입 단위의 발행 당시 kg', () => {
  it.each([['kg',1],[' KG ',1],['20kg',20],[' 020.00 KG ',20],['22.5kg',22.5],['.5kg',0.5],['0.003kg',0.003],['20g',0.02],[' 020.00 G ',0.02],['500g',0.5],['1.5g',0.0015]])('직접 입력 %s는 명시 kg·g만 kg로 해석한다', (text,kg) => {
    expect(parseManualPurchaseUnitKg(text)).toBe(kg);
    const snapshot=makeManualPurchaseUnitSnapshot(String(text),2);
    expect(snapshot).toMatchObject({purchaseUnitId:MANUAL_PURCHASE_UNIT_ID,purchaseQty:2,unitKg:kg,inventoryQty:Number(kg)*2});
    expect(isManualPurchaseUnitSnapshot(snapshot)).toBe(true);
  });
  it.each(['', '포', '20', '20포', '20kg포', '20kg/포', 'kg20', '20 kg extra', '+20kg', '-20kg', '0kg', 'NaNkg', 'Infinitykg', '1e2kg', '1,000kg', '1 0kg', '20.kg', null, 20])('직접 입력 %s는 추정 없이 거절한다', value => {
    expect(parseManualPurchaseUnitKg(value)).toBeNull();
    expect(()=>makeManualPurchaseUnitSnapshot(value as string,2)).toThrow();
  });
  it('20kg 두 거래수량은 40kg로 고정하고 기본 kg·수량변경·부분반품도 공용 환산한다', () => {
    const snapshot=makeManualPurchaseUnitSnapshot(' 020.00 KG ',2);
    expect(snapshot).toEqual({purchaseUnitId:'manual-kg',purchaseUnit:'20kg',purchaseQty:2,unitKg:20,inventoryQty:40});
    expect(makeManualPurchaseUnitSnapshot('kg',2)).toEqual({...snapshot,purchaseUnit:'kg',unitKg:1,inventoryQty:2});
    expect(recalculatePurchaseUnitSnapshot(snapshot,3).inventoryQty).toBe(60);
    expect(returnKgFromPurchaseSnapshot(snapshot,0.5)).toBe(10);
    expect(returnKgFromPurchaseSnapshot(snapshot,1.5,0.5)).toBe(30);
    const fractional=makeManualPurchaseUnitSnapshot('3.3333kg',3);expect(fractional.inventoryQty).toBe(10);
  });
  it('g는 최초 선택 단위 문자열을 보존하고 kg3·부분반품·수량변경만 공용 환산한다',()=>{
    const snapshot=makeManualPurchaseUnitSnapshot(' 020.00 G ',2);
    expect(snapshot).toEqual({purchaseUnitId:'manual-kg',purchaseUnit:'20g',purchaseQty:2,unitKg:0.02,inventoryQty:0.04});
    expect(recalculatePurchaseUnitSnapshot(snapshot,3)).toEqual({...snapshot,purchaseQty:3,inventoryQty:0.06});
    expect(returnKgFromPurchaseSnapshot(snapshot,1)).toBe(0.02);
    expect(makeManualPurchaseUnitSnapshot('1.5g',3).inventoryQty).toBe(0.005);
    for(const change of [{purchaseUnit:'20kg'},{unitKg:20,inventoryQty:40},{purchaseUnit:'20mg'},{qty:3},{inventoryQty:0.041}])expect(()=>readPurchaseUnitSnapshot({...snapshot,...change})).toThrow();
    for(const unit of ['g','0g','-20g','NaNg','Infinityg','1e3g','20mg','20t','20L','0.01g',`${'9'.repeat(310)}g`])expect(()=>makeManualPurchaseUnitSnapshot(unit,1)).toThrow();
  });
  it('reserved 수동 ID는 단위와 kg 위조·부분필드·등록표 위장을 허용하지 않는다', () => {
    const snapshot=makeManualPurchaseUnitSnapshot('20kg',2);
    for(const change of [{purchaseUnit:'포'},{purchaseUnit:'25kg'},{unitKg:25,inventoryQty:50},{purchaseQty:1},{inventoryQty:40.001},{qty:3},{purchaseUnitId:undefined}])
      expect(()=>readPurchaseUnitSnapshot({...snapshot,...change})).toThrow();
    expect(()=>makePurchaseUnitSnapshot({...unit,id:MANUAL_PURCHASE_UNIT_ID,purchaseUnit:'20kg',unitKg:20},2)).toThrow();
    expect(()=>validatePurchaseUnitRegistration(snapshot,{...unit,id:MANUAL_PURCHASE_UNIT_ID,purchaseUnit:'20kg',unitKg:20},{companyId:'taebaek',itemId:'raw'})).toThrow('직접 입력');
    expect(isManualPurchaseUnitSnapshot(makePurchaseUnitSnapshot(unit,2))).toBe(false);
    for(const qty of [0,-1,NaN,Infinity])expect(()=>makeManualPurchaseUnitSnapshot('20kg',qty)).toThrow();
  });
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
