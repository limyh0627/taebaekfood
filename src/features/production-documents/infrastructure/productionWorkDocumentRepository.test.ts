import { describe, expect, it, vi } from 'vitest';
import type { Item, Order } from '../../../shared/types';
vi.mock('../../../shared/services/firebaseService', () => ({ fetchWhere: vi.fn() }));
vi.mock('../../../shared/services/productionWorkDocumentService', () => ({ replaceProductionWorkDocument: vi.fn() }));
import { productionEvidenceFromRecords } from './productionWorkDocumentRepository';
const time = '2026-10-07T01:00:00.000Z';
const item = { id: 'p1', companyId: 'taebaek', name: '제품', unit: '개', spec: '1kg' } as unknown as Item;
const state = { version: 1, lineId: 'l1', itemId: 'p1', applied: true, attempt: 1, completedAt: time,
  producedUnits: [{ itemId: 'p1', qty: 20 }], rawConsumedLots: [], autoBuilt: [],
  production: { capturedAt: time, stockDeltas: [], bomLines: [], productProducedLots: [{ itemId: 'p1', lotId: 'produced-lot', qty: 20 }] } };
const order = (patch: Record<string, unknown> = {}) => ({ id: 'o1', companyId: 'taebaek', items: [{ lineId: 'l1', itemId: 'p1', name: '제품' }], ...patch } as unknown as Order);
const read = (orders: Order[]) => productionEvidenceFromRecords('taebaek', '2026-10-07', orders, [], [item]);
describe('현재 저장 실적만 생산 서류로 투영', () => {
  it('전체 생산과 품목별 생산을 각각 읽으며 근거 없는 항목은 공란이다', () => {
    const whole = order({ producedAt: time, producedUnits: state.producedUnits, inventorySnapshots: { production: state.production } });
    for (const row of [read([whole])[0], read([order({ itemInventory: { l1: state } })])[0]]) {
      expect(row.fields.productionQty).toBe(20);
      expect(row.fields.manufacturingLotNo).toBe(''); expect(row.fields.expiryDate).toBe(''); expect(row.fields.workerNameSnapshot).toBe('');
    }
  });
  it('동일 생산 lot trace가 두 경로에 남아 있어도 한 번만 가져온다', () => {
    expect(read([order({ itemInventory: { l1: state }, producedAt: time, producedUnits: state.producedUnits,
      inventorySnapshots: { production: state.production } })])).toHaveLength(1);
  });
  it('취소 뒤 남은 snapshot과 생산량 없는 구형 주문을 추정하지 않는다', () => {
    expect(read([order({ producedAt: '', producedUnits: [], inventorySnapshots: { production: state.production },
      itemInventory: { l1: { ...state, applied: false, reversedAt: time } } }), order({ producedAt: time })])).toEqual([]);
  });
  it('다른 회사와 진행 중인 재고 작업은 수입하지 않는다', () => {
    expect(read([order({ companyId: 'punghoe', itemInventory: { l1: state } }),
      order({ itemInventory: { l1: state }, inventoryOperation: { id: 'busy' } })])).toEqual([]);
  });
  it('원료 operation과 lot delta를 검증하고 같은 원료 trace는 한 번만 연결한다', () => {
    const trace = { rawItemId: 'r1', lotId: 'lot1', operationId: 'op1', ledgerId: 'ledger1', kg: 2 };
    const movement = { id: 'ledger1', companyId: 'taebaek', rawItemId: 'r1', operationId: 'op1', kind: 'consume-lot',
      date: '2026-10-07', material: '원료', materialSnapshot: '당시 원료', lotChanges: [{ lotId: 'lot1', lotNo: '실제 원료 LOT', deltaKg: -2 }] };
    const rows = productionEvidenceFromRecords('taebaek', '2026-10-07', [order({ itemInventory: { l1: { ...state, rawConsumedLots: [trace, trace] } } })],
      [movement] as unknown as Parameters<typeof productionEvidenceFromRecords>[3], [item]);
    expect(rows).toHaveLength(1); expect(rows[0].fields.rawUsedKg).toBe(2); expect(rows[0].fields.rawLotNoSnapshot).toBe('실제 원료 LOT');
    const mismatched = productionEvidenceFromRecords('taebaek', '2026-10-07', [order({ itemInventory: { l1: { ...state, rawConsumedLots: [{ ...trace, kg: 3 }] } } })],
      [movement] as unknown as Parameters<typeof productionEvidenceFromRecords>[3], [item]);
    expect(mismatched.find(row => row.source.kind === 'production')?.fields.rawUsedKg).toBeNull();
  });
  it('다제품 생산의 원료 배분과 현재 BOM을 추정하지 않는다', () => {
    const rows = read([order({ itemInventory: { l1: { ...state, producedUnits: [{ itemId: 'p1', qty: 20 }, { itemId: 'p2', qty: 10 }],
      rawConsumedLots: [{ rawItemId: 'r1', lotId: 'lot1', operationId: 'op1', kg: 5 }] } } })]);
    expect(rows.map(row => row.fields.productionQty)).toEqual([20, 10]); expect(rows.every(row => row.fields.rawUsedKg === null)).toBe(true);
  });

});
