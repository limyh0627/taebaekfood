import { describe, expect, it } from 'vitest';
import type { Order, OrderInventorySnapshot, OrderRawInventoryTrace } from '../../shared/types';
import type { LedgerMovement } from './dataIntegrityAudit';
import { auditSavedRawCalculation } from './savedRawCalculationAudit';
import { OrderStatus } from '../../shared/types';

const coherentSnapshot = (over: Partial<OrderInventorySnapshot> = {}): OrderInventorySnapshot => ({
  capturedAt: '2026-09-16T01:00:00.000Z', stockDeltas: [], bomLines: [], rawConsumedLots: [], rawLedgerIds: [], ...over,
});
const appliedOrder = (opts: { production?: OrderInventorySnapshot; rawConsumedLots?: OrderRawInventoryTrace[] } = {}): Order => ({
  id: 'order-1', companyId: 'taebaek', cardNo: 'ORD-1',
  partnerName: '거래처', totalAmount: 1000, status: OrderStatus.PROCESSING,
  createdAt: '2026-09-16T00:00:00.000Z', deliveryDate: '2026-09-16', email: '', source: '일반',
  items: [{ lineId: 'line-1', itemId: 'item-1', name: '품목', quantity: 1, price: 1000 }],
  itemInventory: { 'line-1': {
    version: 1, lineId: 'line-1', itemId: 'item-1', applied: true, attempt: 1,
    rawConsumedLots: opts.rawConsumedLots ?? [], autoBuilt: [], producedUnits: [],
    production: opts.production ?? coherentSnapshot(),
  } },
});


describe('저장 원료 계산의 정확한 생산 이벤트 대조', () => {
  const operationId = 'production:order-1:line-1:a1:raw-1';
  const trace: OrderRawInventoryTrace = { operationId, rawItemId: 'raw-1', material: '참깨', supplierName: '공급처', kg: 2, ledgerId: 'ledger-1' };
  const snapshot = (): OrderInventorySnapshot => coherentSnapshot({ rawCalculationEvidence: [{ productId: 'item-1', spec: '옛 규격', units: 1, raw: '참깨', kg: 2, path: 'bom-direct', bomQuantityKg: 2 }], rawConsumedLots: [trace], rawLedgerIds: ['ledger-1'] });
  const ledger = (): LedgerMovement => ({ id: 'ledger-1', companyId: 'taebaek', rawItemId: 'raw-1', material: '참깨', materialSnapshot: '참깨', date: '2026-09-16', createdAt: '2026-09-16T01:00:00.000Z', received: 0, used: 2, note: '', operationId, kind: 'consume', reportedDeltaKg: -2, appliedDeltaKg: -2, source: { type: 'production', id: 'order-1' } });
  const run = (order: Order, rows = [ledger()]) => auditSavedRawCalculation(order, rows, () => true);
  it('현재 BOM과 무관하게 저장 결과와 정확 원장만 비교하고 applied 0을 과거 사용 0으로 바꾸지 않는다', () => {
    const order = appliedOrder({ production: snapshot(), rawConsumedLots: [trace] });
    expect(run(order, [{ ...ledger(), appliedDeltaKg: 0 }])).toEqual([]);
    order.itemInventory!['line-1'].production.rawCalculationEvidence![0].kg = 1;
    expect(run(order).some(issue => issue.severity === 'error' && issue.detail.includes('당시 계산 1kg'))).toBe(true);
  });
  it('다른 회사·주문 원장과 중복 operation은 비교 성공으로 취급하지 않는다', () => {
    const order = appliedOrder({ production: snapshot(), rawConsumedLots: [trace] });
    for (const rows of [[{ ...ledger(), companyId: 'punghoe' as const }], [{ ...ledger(), source: { type: 'production', id: 'other-order' } }], [ledger(), { ...ledger(), id: 'duplicate-ledger' }]]) {
      expect(run(order, rows).some(issue => issue.id.endsWith(':unconfirmed'))).toBe(true);
    }
  });
  it('전체·부분 및 취소 미러를 합산하지 않고 취소 기록의 원래 계산은 유지한다', () => {
    const order = appliedOrder({ production: snapshot(), rawConsumedLots: [trace] });
    order.inventorySnapshots = { version: 1, production: snapshot() };
    order.itemInventory!['line-1'].applied = false;
    const issues = run(order);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toContain(':whole:mirror');
    order.itemInventory!['line-1'].production.rawCalculationEvidence![0].kg = 1;
    expect(run(order).find(issue => issue.severity === 'error')?.detail).toContain('취소된 생산의 당시 기록');
  });
  it('근거 없는 과거는 미확인, 명시 빈 생산은 0, 원료 기록이 있는 빈 계산은 불일치다', () => {
    const old = appliedOrder();
    expect(run(old).some(issue => issue.title === '당시 원료 계산 근거 미기록')).toBe(true);
    old.itemInventory!['line-1'].production.rawCalculationEvidence = [];
    expect(run(old)).toEqual([]);
    old.itemInventory!['line-1'].production = { ...snapshot(), rawCalculationEvidence: [] };
    expect(run(old).some(issue => issue.severity === 'error')).toBe(true);
  });

  it('FIFO로 여러 로트를 쓴 같은 작업은 원장 한 줄과 합계로 대조한다', () => {
    const snap = snapshot();
    snap.rawConsumedLots = [{ ...trace, lotId: 'lot-1', kg: 0.8 }, { ...trace, lotId: 'lot-2', kg: 1.2 }];
    expect(run(appliedOrder({ production: snap }))).toEqual([]);
  });
  it('전체 주문 생산과 임가공 원장 전용 작업은 실제 operation 형식으로 연결한다', () => {
    for (const ledgerOnly of [false, true]) {
      const id = `${ledgerOnly ? 'production-ledger' : 'production'}:order-1:a3:raw-1`;
      const order = appliedOrder();
      delete order.itemInventory;
      order.producedAt = '2026-09-16T01:00:00.000Z';
      order.inventorySnapshots = { version: 1, production: { ...snapshot(), rawConsumedLots: [{ ...trace, operationId: id, ledgerOnly }] } };
      const row: LedgerMovement = { ...ledger(), operationId: id, kind: ledgerOnly ? 'ledger-consume' : 'consume', source: { type: ledgerOnly ? 'oem' : 'production', id: order.id } };
      expect(run(order, [row])).toEqual([]);
    }
  });
  it('품목 줄·attempt·원료 ID·원장 문서가 다르거나 빠지면 비교하지 않는다', () => {
    for (const bad of [{ ...trace, ledgerId: undefined }, { ...trace, ledgerId: 'other' }, { ...trace, operationId: 'production:order-1:line-1:a2:raw-1' }, { ...trace, rawItemId: 'raw-2' }]) {
      expect(run(appliedOrder({ production: { ...snapshot(), rawConsumedLots: [bad] } })).some(issue => issue.id.endsWith(':unconfirmed'))).toBe(true);
    }
    const wrongLine = appliedOrder({ production: snapshot() });
    wrongLine.itemInventory!['line-1'].itemId = 'other-item';
    expect(run(wrongLine).some(issue => issue.id.endsWith(':unconfirmed'))).toBe(true);
    expect(auditSavedRawCalculation(appliedOrder({ production: snapshot() }), [ledger()], () => false)).toEqual([]);
  });
  it('일부만 겹치는 전체 스냅샷을 완전 미러로 덮어 숨기지 않는다', () => {
    const order = appliedOrder({ production: snapshot() });
    order.inventorySnapshots = { version: 1, production: { ...snapshot(), rawConsumedLots: [trace, { ...trace, operationId: 'production:order-1:a1:raw-2', rawItemId: 'raw-2' }] } };
    expect(run(order).some(issue => issue.title === '일부만 겹치는 생산 원료 스냅샷')).toBe(true);
  });
  it('같은 operation의 계산·trace·원장 목록이 다른 미러는 숨기지 않는다', () => {
    for (const field of ['calculation', 'trace', 'ledger']) {
      const order = appliedOrder({ production: snapshot() });
      const mirror = snapshot();
      if (field === 'calculation') mirror.rawCalculationEvidence = [{ ...mirror.rawCalculationEvidence![0], kg: 1 }];
      if (field === 'trace') mirror.rawConsumedLots = [{ ...trace, kg: 1 }];
      if (field === 'ledger') mirror.rawLedgerIds = ['other-ledger'];
      order.inventorySnapshots = { version: 1, production: mirror };
      const issues = run(order);
      expect(issues.some(issue => issue.title === '동일 생산 작업의 스냅샷 원문 불일치')).toBe(true);
      expect(issues.some(issue => issue.id.endsWith(':mirror'))).toBe(false);
    }
  });
  it('trace 또는 원장 목록이 미기록인 저장 계산을 실제 사용 0으로 비교하지 않는다', () => {
    for (const field of ['rawConsumedLots', 'rawLedgerIds'] as const) {
      const snap = snapshot();
      delete snap[field];
      const issues = run(appliedOrder({ production: snap }));
      expect(issues).toHaveLength(1);
      expect(issues[0].id.endsWith(':unconfirmed')).toBe(true);
      expect(issues[0].severity).toBe('warning');
    }
  });
});