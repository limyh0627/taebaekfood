import { describe, expect, it } from 'vitest';
import type { Item } from '../../shared/types';
import { auditDataIntegrity, type IntegrityAuditInput } from './dataIntegrityAudit';

const base = (items: Item[], rawInventories: IntegrityAuditInput['rawInventories'] = []): IntegrityAuditInput => ({
  companyId: 'taebaek', orders: [], items, itemBoms: [], purchaseOrders: [], itemReceipts: [],
  rawMaterialLedger: [], rawInventories, issuedStatements: [], productionSalesLogs: [],
});

describe('재고 4축 점검', () => {
  it('원료 items.stock과 원자화 상태 차이를 찾는다', () => {
    const item = { id: 'raw-x', name: '원료X', companyId: 'taebaek', type: 'wip', stock: 11, lots: [] } as unknown as Item;
    const state = { id: 'taebaek__raw-x', companyId: 'taebaek', rawItemId: 'raw-x', materialSnapshot: '원료X', stockKg: 10, activeLots: [{ kgRemaining: 10 }], lastProcessedAt: '2026-09-16' } as IntegrityAuditInput['rawInventories'][number];
    expect(auditDataIntegrity(base([item], [state])).map(x => x.id)).toContain('raw-item-state-gap:taebaek__raw-x');
  });

  it('개수 품목의 stock과 제품 로트 합계 차이를 찾는다', () => {
    const item = { id: 'product-x', name: '볶음참깨-낱개/1kg', companyId: 'taebaek', type: 'product', stock: 30, unit: '개', lots: [{ id: 'lot-1', qtyRemaining: 14, kgRemaining: 14, status: 'active' }] } as unknown as Item;
    expect(auditDataIntegrity(base([item])).map(x => x.id)).toContain('item-lot-gap:product-x');
  });

  it('stock과 로트가 같은 음수여도 각각 오류로 찾는다', () => {
    const item = { id: 'negative-product', name: '음수 완제품', companyId: 'taebaek', type: 'product', stock: -4, unit: '개', lots: [{ id: 'carry', qtyRemaining: -4, kgRemaining: -4, status: 'active' }] } as unknown as Item;
    const ids = auditDataIntegrity(base([item])).map(x => x.id);
    expect(ids).toContain('item-stock-negative:negative-product');
    expect(ids).toContain('item-lot-negative:negative-product');
    expect(ids).not.toContain('item-lot-gap:negative-product');
  });
});
