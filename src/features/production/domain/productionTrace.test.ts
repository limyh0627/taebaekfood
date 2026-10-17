import { orderProductionRecordId } from '../../../shared/orderProductionRecordPlan';
import { expect, it } from 'vitest';
import { OrderStatus, type Order, type Item, type ProductionRecord, type RawMaterialEntry } from '../../../shared/types';
import { buildConsumedByOrderId, buildLedgerByOrderId, buildOrderIdsWithData, buildLotConsumption, filterRecallResults, productionTraceOf, type ItemFormulaRow } from './productionTrace';
const order = (id: string, rawConsumedLots: Order['rawConsumedLots'] = []): Order => ({ id, partnerName: id, items: [], totalAmount: 0, status: OrderStatus.PENDING, createdAt: '', deliveryDate: '', email: '', source: '일반', rawConsumedLots });
const item: Item = { id: 'i', name: '합성제품', 품목: '합성서류명', type: 'product', stock: 0, minStock: 0, unit: '병', image: '', spec: '1kg' };
const record = (id: string, extra: Partial<ProductionRecord> = {}): ProductionRecord => ({ id, itemId: 'i', itemName: '합성제품', date: '2026-10-18', finishedQty: 3, createdAt: '', ...extra });
const explicitRecord = (orderId: string): ProductionRecord => { const generation = { contractVersion: 1 as const, companyId: 'taebaek' as const, orderId, operationId: 'op', actorUid: 'uid', startedAt: '2026-10-18T00:00:00Z' }; return record(orderProductionRecordId(generation, 'line'), { companyId: 'taebaek', orderId, lineId: 'line', generation }); };
const ledgerRow = (id: string, orderId: string, used: number): RawMaterialEntry => ({ id, orderId, material: '참깨', date: '', createdAt: '', received: 0, used, note: '자동 ▸ 원장공급처' });
const formulas: ItemFormulaRow[] = [{ parent_key: '합성서류명', child_name: '참깨', ratio: .5, yield_rate: 0 }, { parent_key: '다른품목', child_name: '들깨', ratio: 1 }];
it('최장 주문 ID를 우선 연결하고 스냅샷이 있으면 원장 출처를 섞지 않는다', () => {
 const orders: Order[] = [order('o', [{ material: '참깨', supplierName: '짧은ID', kg: 1 }]), order('o-long', [{ material: '참깨', supplierName: '긴ID', receivedDate: '2026-10-01', lotNo: 'L1', kg: 2 }])];
 const consumed = buildConsumedByOrderId(orders), ledger = buildLedgerByOrderId([ledgerRow('l', 'o-long', 10)]), ids = buildOrderIdsWithData(consumed, ledger);
 expect(ids).toEqual(['o-long', 'o']);
 expect(productionTraceOf(record('pr-o-long-i'), [item], formulas, consumed, ledger, ids)).toEqual([{ material: '참깨', kg: 1.5, detail: '긴ID (2026-10-01) lot L1' }]);
 expect(productionTraceOf(explicitRecord('o'), [item], formulas, consumed, ledger, ids)?.[0].detail).toBe('짧은ID');
});
it('명시된 주문은 접두어로 바꾸지 않으며 빈 스냅샷 상세도 원장비고로 대체하지 않는다', () => {
 const consumed = buildConsumedByOrderId([order('o', [{ material: '참깨', supplierName: '', kg: 1 }])]);
 const ledger = buildLedgerByOrderId([ledgerRow('a', 'o', 2), ledgerRow('zero', 'other', 0), ledgerRow('negative', 'other', -1)]);
 expect([...ledger.keys()]).toEqual(['o']);
 expect(productionTraceOf(record('pr-o-i'), [item], formulas, consumed, ledger, ['o'])?.[0].detail).toBe('');
 expect(productionTraceOf(explicitRecord('absent'), [item], formulas, consumed, ledger, ['o'])?.[0].detail).toBe('');
 expect(productionTraceOf(record('pr-o-i'), [item], formulas, new Map(), ledger, ['o'])?.[0].detail).toBe('원장공급처');
 expect(productionTraceOf(record('manual', { itemId: 'absent' }), [item], formulas, consumed, ledger, ['o'])).toBeUndefined();
});
it('로트 ID와 복합키별 합계·검색·원주문 객체를 보존하며 입력을 바꾸지 않는다', () => {
 const orders: Order[] = [order('a', [{ lotId: 'lot1', material: '참깨', supplierName: '공급 A', receivedDate: '2026-10-01', lotNo: 'LOT', kg: 1.25 }, { material: '들깨', supplierName: '공급 B', receivedDate: '2026-10-02', kg: 2 }]), order('b', [{ lotId: 'lot1', material: '참깨', supplierName: '공급 A', kg: .5 }])];
 const before = JSON.stringify(orders), groups = buildLotConsumption(orders);
 expect(groups.map(g => [g.key, g.totalKg])).toEqual([['들깨|공급 B|2026-10-02', 2], ['lot1', 1.75]]);
 expect(groups[1].entries[0].order).toBe(orders[0]); expect(filterRecallResults(groups, ' lot ')).toEqual([groups[1]]); expect(filterRecallResults(groups, '공급 b')).toEqual([groups[0]]); expect(filterRecallResults(groups, ' ')).toBe(groups); expect(JSON.stringify(orders)).toBe(before);
});
