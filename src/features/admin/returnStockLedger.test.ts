import { describe, expect, it } from 'vitest';
import { buildItemLedger } from './itemLedger';
import { auditDataIntegrity, type IntegrityAuditInput } from './dataIntegrityAudit';
import type { Item, IssuedStatement } from '../../shared/types';
import type { ReturnStockOperation } from '../../shared/returnStockMovement';

const item = { id: 'goods', companyId: 'taebaek', name: '상품', type: 'goods', stock: 4,
  stocktakeAnchors: [{ id: 'stocktake-start', date: '2026-10-01', createdAt: '2026-10-01T00:00:00Z', targetQty: 5 }] } as Item;
const operation: ReturnStockOperation = { id: 'return-one', companyId: 'taebaek', sourceStatementId: 'purchase',
  returnRequestId: 'request', journalId: 'journal', createdAt: '2026-10-03T00:00:00Z',
  stockMovements: [{ itemId: item.id, companyId: 'taebaek', partnerId: 'supplier', operationId: 'return-one',
    quantityDelta: -1, date: '2026-10-03', createdAt: '2026-10-03T00:00:00Z' }] };
const source = { id: 'purchase', companyId: 'taebaek', partnerId: 'supplier', type: '매입', items: [], tradeDate: '2026-10-01' } as unknown as IssuedStatement;
const journal = { id: 'journal', companyId: 'taebaek', partnerId: 'supplier', type: '비용',
  returnOperationId: operation.id, items: [], tradeDate: '2026-10-03' } as unknown as IssuedStatement;
const auditInput: IntegrityAuditInput = { companyId: 'taebaek', items: [item], orders: [], itemBoms: [],
  purchaseOrders: [], itemReceipts: [], rawMaterialLedger: [], rawInventories: [], issuedStatements: [source, journal],
  productionSalesLogs: [], returnOperations: [operation] };
const returnIssues = (input: IntegrityAuditInput) => auditDataIntegrity(input).filter(row => row.id.startsWith('return-stock:'));

describe('매입 반품 출고 원장과 감사', () => {
  it('실사 5에서 매입 반품 1을 차감하여 현재 재고 4와 일치한다', () => {
    const ledger = buildItemLedger(item.id, [], [item], [], [], undefined, [operation]);
    expect(ledger.rows).toContainEqual(expect.objectContaining({ kind: '출고', qty: -1, note: '매입 반품', balance: 4 }));
    expect(ledger.gap).toBe(0);
    expect(returnIssues(auditInput)).toEqual([]);
  });
  it('다른 회사 출고는 원장과 감사에 섞이지 않는다', () => {
    const foreign = { ...operation, companyId: 'punghoe' as const };
    expect(buildItemLedger(item.id, [], [item], [], [], undefined, [foreign]).rows.some(row => row.note === '매입 반품')).toBe(false);
    expect(returnIssues({ ...auditInput, returnOperations: [foreign] })).toEqual([]);
  });
  it('잘못된 수량, 회사, operation 연결은 반영하지 않고 감사 오류로 남긴다', () => {
    for (const patch of [{ quantityDelta: 1 }, { quantityDelta: -0.0001 }, { companyId: 'punghoe' as const }, { operationId: 'other' }]) {
      const invalid = { ...operation, stockMovements: [{ ...operation.stockMovements![0], ...patch }] };
      expect(buildItemLedger(item.id, [], [item], [], [], undefined, [invalid]).rows.some(row => row.note === '매입 반품')).toBe(false);
      expect(returnIssues({ ...auditInput, returnOperations: [invalid] })).toHaveLength(1);
    }
  });
  it('역분개 누락, 출고 근거 누락, 입고 중복을 발견한다', () => {
    expect(returnIssues({ ...auditInput, issuedStatements: [source] })).toHaveLength(1);
    expect(returnIssues({ ...auditInput, returnOperations: [{ ...operation, stockMovements: [] }] })).toHaveLength(1);
    expect(returnIssues({ ...auditInput, itemReceipts: [{ id: 'bad', itemId: item.id, itemName: item.name,
      companyId: 'taebaek', partnerName: '공급처', quantity: -1, date: '2026-10-03', createdAt: operation.createdAt,
      returnOperationId: operation.id } as never] })).toHaveLength(1);
  });
});
