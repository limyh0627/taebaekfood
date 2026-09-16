import { describe, expect, it } from 'vitest';
import { PRODUCT_FORMULA } from '../../constants/formula';
import type { ItemReceipt } from '../../shared/receipt';
import type {
  IssuedStatement, Item, Order, OrderInventorySnapshot, OrderItemInventoryState,
  OrderRawInventoryTrace, ProductionSalesLog, PurchaseOrder, RawMaterialEntry,
} from '../../shared/types';
import { auditDataIntegrity, expectedProductionDeltas, isStaleInventoryProcessing, PROCESSING_STALE_MS, type IntegrityAuditInput } from './dataIntegrityAudit';

const productItem = (over: Partial<Item> = {}): Item => ({
  id: 'item-1',
  name: '정상 품목',
  companyId: 'taebaek',
  isRawMaterial: false,
  type: 'product',
  stock: 0,
  minStock: 0,
  unit: '개',
  image: '',
  ...over,
} as Item);

const input = (over: Partial<IntegrityAuditInput> = {}): IntegrityAuditInput => ({
  companyId: 'taebaek',
  orders: [],
  items: [productItem()],
  itemBoms: [],
  purchaseOrders: [],
  itemReceipts: [],
  rawMaterialLedger: [],
  rawInventories: [],
  issuedStatements: [],
  productionSalesLogs: [],
  ...over,
});

interface AppliedLineOptions {
  production?: OrderInventorySnapshot;
  producedUnits?: OrderItemInventoryState['producedUnits'];
  autoBuilt?: OrderItemInventoryState['autoBuilt'];
  rawConsumedLots?: OrderRawInventoryTrace[];
}

const appliedOrder = (opts: AppliedLineOptions = {}): Order => ({
  id: 'order-1',
  companyId: 'taebaek',
  cardNo: 'ORD-1',
  partnerName: '거래처',
  status: 'PROCESSING',
  createdAt: '2026-09-16T00:00:00.000Z',
  deliveryDate: '2026-09-16',
  email: '',
  source: 'admin',
  totalAmount: 1000,
  items: [{ lineId: 'line-1', itemId: 'item-1', name: '정상 품목', quantity: 1, price: 1000, checked: true }],
  itemInventory: {
    'line-1': {
      version: 1,
      lineId: 'line-1',
      itemId: 'item-1',
      applied: true,
      attempt: 1,
      completedAt: '2026-09-16T01:00:00.000Z',
      rawConsumedLots: opts.rawConsumedLots ?? [],
      autoBuilt: opts.autoBuilt ?? [],
      producedUnits: opts.producedUnits ?? [],
      production: Object.prototype.hasOwnProperty.call(opts, 'production') ? opts.production : {
        capturedAt: '2026-09-16T01:00:00.000Z',
        stockDeltas: [],
        bomLines: [],
        rawConsumedLots: [],
        rawLedgerIds: [],
      },
    },
  },
} as unknown as Order);

const coherentSnapshot = (over: Partial<OrderInventorySnapshot> = {}): OrderInventorySnapshot => ({
  capturedAt: '2026-09-16T01:00:00.000Z',
  stockDeltas: [{ itemId: 'item-1', delta: 1 }],
  bomLines: [],
  rawConsumedLots: [],
  rawLedgerIds: [],
  ...over,
});

describe('auditDataIntegrity — 기존 검사', () => {
  it('processing은 1시간을 넘긴 잠금만 경고한다', () => {
    const now = Date.now();
    expect(isStaleInventoryProcessing(new Date(now - PROCESSING_STALE_MS + 1).toISOString(), now)).toBe(false);
    expect(isStaleInventoryProcessing(new Date(now - PROCESSING_STALE_MS).toISOString(), now)).toBe(true);

    const recent = { ...appliedOrder(), inventoryOperation: { state: 'processing', startedAt: new Date(now - 10 * 60 * 1000).toISOString() } } as unknown as Order;
    const stale = { ...appliedOrder(), id: 'order-stale', inventoryOperation: { state: 'processing', startedAt: new Date(now - 2 * PROCESSING_STALE_MS).toISOString() } } as unknown as Order;
    const ids = auditDataIntegrity(input({ orders: [recent, stale] })).map(issue => issue.id);
    expect(ids).not.toContain('op-processing:order-1');
    expect(ids).toContain('op-processing:order-stale');
  });

  it('작업 완료 줄에 생산 스냅샷이 없으면 찾는다', () => {
    const issues = auditDataIntegrity(input({ orders: [appliedOrder({ production: undefined as unknown as OrderInventorySnapshot })] }));

    expect(issues.map(issue => issue.id)).toContain('empty-snapshot:order-1:line-1');
  });

  it('입고 완료 발주에 itemReceipt가 없으면 찾는다', () => {
    const po = {
      id: 'po-1', companyId: 'taebaek', status: 'received', createdAt: '2026-09-16T00:00:00.000Z',
      itemId: 'item-1', itemName: '정상 품목', quantity: 3, unit: '개',
    } as unknown as PurchaseOrder;

    const issues = auditDataIntegrity(input({ purchaseOrders: [po] }));

    expect(issues.map(issue => issue.id)).toContain('po-no-receipt:po-1:item-1');
  });

  it('서류용 품목 연결과 용량이 빠진 줄을 각각 찾는다', () => {
    const formulaItem = Object.keys(PRODUCT_FORMULA)[0];
    const statement = {
      id: 'statement-1', companyId: 'taebaek', tradeDate: '2026-09-16', docNo: 'S-1',
      items: [{ itemId: '', name: '수기 품목', lineKind: 'item' }],
    } as unknown as IssuedStatement;
    const salesLog = {
      id: 'sales-1', date: '2026-09-16',
      salesRows: [{ 상호: '거래처', 품목: formulaItem, 용량: '', 수량: 1 }],
    } as unknown as ProductionSalesLog;

    const issues = auditDataIntegrity(input({ issuedStatements: [statement], productionSalesLogs: [salesLog] }));
    const ids = issues.map(issue => issue.id);

    expect(ids).toContain('stmt-no-item:statement-1:0');
    expect(ids).toContain('sales-capacity:sales-1:0');
  });

  it('연결 품목에는 규격이 있는데 전표 출력 규격이 비면 잡는다', () => {
    const statement = {
      id: 'statement-spec', companyId: 'taebaek', tradeDate: '2026-09-16', docNo: 'S-SPEC',
      items: [{ itemId: 'item-1', name: '정상 품목', spec: '', lineKind: 'item' }],
    } as unknown as IssuedStatement;
    const ids = auditDataIntegrity(input({ items: [productItem({ spec: '350ml' })], issuedStatements: [statement] })).map(issue => issue.id);
    expect(ids).toContain('stmt-spec:statement-spec:0');
  });

  it('선물세트 BOM 구성품이 삭제되면 판매일지 일부 누락으로 잡는다', () => {
    const set = productItem({ id: 'set-1', name: '선물세트', subtype: '선물세트' });
    const order = {
      ...appliedOrder(), status: 'DELIVERED', deliveredAt: '2026-09-16T00:00:00.000Z',
      items: [{ lineId: 'set-line', itemId: 'set-1', name: '선물세트', quantity: 1, price: 1000 }],
    } as unknown as Order;
    const issues = auditDataIntegrity(input({
      items: [set], orders: [order],
      itemBoms: [{ id: 'bom-missing', parent_id: 'set-1', child_id: 'deleted-product', quantity: 1 } as never],
    }));
    expect(issues.map(issue => issue.id)).toContain('doc-set-child-missing:order-1:set-line:deleted-product');
  });

  it('근거가 모두 연결된 정상 데이터는 문제로 잡지 않는다', () => {
    const po = {
      id: 'po-1', companyId: 'taebaek', status: 'received', createdAt: '2026-09-16T00:00:00.000Z',
      itemId: 'item-1', itemName: '정상 품목', quantity: 3, unit: '개',
    } as unknown as PurchaseOrder;
    const receipt = {
      id: 'receipt-1', companyId: 'taebaek', poId: 'po-1', itemId: 'item-1', itemName: '정상 품목',
      quantity: 3, partnerName: '거래처', date: '2026-09-16', createdAt: '2026-09-16T01:00:00.000Z',
    } as ItemReceipt;
    const statement = {
      id: 'statement-1', companyId: 'taebaek', tradeDate: '2026-09-16', docNo: 'S-1',
      items: [{ itemId: 'item-1', name: '정상 품목', lineKind: 'item' }],
    } as unknown as IssuedStatement;

    expect(auditDataIntegrity(input({
      orders: [appliedOrder({
        production: coherentSnapshot(),
        producedUnits: [{ itemId: 'item-1', qty: 1 }],
      })],
      purchaseOrders: [po],
      itemReceipts: [receipt],
      issuedStatements: [statement],
    }))).toEqual([]);
  });

  it('점검 날짜 밖의 전표와 입고 기록은 결과에서 제외한다', () => {
    const oldReceipt = {
      id: 'receipt-old', companyId: 'taebaek', itemId: 'missing-item', itemName: '삭제 품목',
      quantity: 0, partnerName: '거래처', date: '2026-09-15', createdAt: '2026-09-15T01:00:00.000Z',
    } as ItemReceipt;
    const futureStatement = {
      id: 'statement-future', companyId: 'taebaek', tradeDate: '2026-09-17', docNo: 'S-2',
      items: [{ itemId: '', name: '', lineKind: 'item' }],
    } as unknown as IssuedStatement;

    expect(auditDataIntegrity(input({
      dateFrom: '2026-09-16',
      dateTo: '2026-09-16',
      itemReceipts: [oldReceipt],
      issuedStatements: [futureStatement],
    }))).toEqual([]);
  });

  it('기존 재고를 써서 생산량이 0인 완료 줄은 빈 생산 스냅샷으로 오인하지 않는다', () => {
    const order = appliedOrder({
      production: {
        capturedAt: '2026-09-16T01:00:00.000Z',
        stockDeltas: [],
        bomLines: [],
        rawConsumedLots: [],
        rawLedgerIds: [],
      },
      producedUnits: [{ itemId: 'item-1', qty: 0 }],
    });

    const ids = auditDataIntegrity(input({ orders: [order] })).map(issue => issue.id);

    expect(ids).not.toContain('empty-snapshot:order-1:line-1');
    expect(ids).not.toContain('snapshot-arith:order-1:line-1:item-1');
  });
});

describe('auditDataIntegrity — P0.1 스냅샷 산술 정합성', () => {
  it('producedUnits 를 하나 늘리면 스냅샷 산술 불일치를 잡는다', () => {
    const order = appliedOrder({
      producedUnits: [{ itemId: 'item-1', qty: 2 }],   // 뒤틀린 값: 실제 저장은 +1인데 여기는 +2
      production: coherentSnapshot({ stockDeltas: [{ itemId: 'item-1', delta: 1 }] }),
    });
    const ids = auditDataIntegrity(input({ orders: [order] })).map(issue => issue.id);
    expect(ids).toContain('snapshot-arith:order-1:line-1:item-1');
  });

  it('autoBuilt 로 만든 만큼 BOM 자식이 상쇄되지 않으면 잡는다', () => {
    const child = productItem({ id: 'child-1', name: '자식 완제품', type: 'product' });
    const order = appliedOrder({
      producedUnits: [{ itemId: 'item-1', qty: 1 }],
      autoBuilt: [{ itemId: 'child-1', qty: 1 }],
      production: {
        capturedAt: '2026-09-16T01:00:00.000Z',
        bomLines: [{ parentItemId: 'item-1', childItemId: 'child-1', quantity: 2 }],
        // 산술이 맞으려면 child 는 +1 (autoBuilt) − 1×2 (BOM) = -1 여야 한다. 여기 -2 로 뒤틀어둔다.
        stockDeltas: [{ itemId: 'item-1', delta: 1 }, { itemId: 'child-1', delta: -2 }],
        rawConsumedLots: [], rawLedgerIds: [],
      },
    });
    const ids = auditDataIntegrity(input({
      items: [productItem(), child],
      orders: [order],
    })).map(issue => issue.id);
    expect(ids).toContain('snapshot-arith:order-1:line-1:child-1');
  });

  it('벌크 자식은 stockDeltas 대상이 아니므로 어긋난 스냅샷으로 오인하지 않는다', () => {
    const bulk = productItem({ id: 'bulk-1', name: '통깨참기름', type: 'wip', subtype: '벌크', unit: 'kg' });
    // 엔진은 벌크 자식을 stockDeltas 에서 뺀다(원료수불부·로트로 흐름). 스냅샷에 -X 가 없어도 정상이다.
    const order = appliedOrder({
      producedUnits: [{ itemId: 'item-1', qty: 1 }],
      production: {
        capturedAt: '2026-09-16T01:00:00.000Z',
        stockDeltas: [{ itemId: 'item-1', delta: 1 }],
        bomLines: [{ parentItemId: 'item-1', childItemId: 'bulk-1', quantity: 0.3 }],
        rawConsumedLots: [], rawLedgerIds: [],
      },
    });
    const ids = auditDataIntegrity(input({
      items: [productItem(), bulk],
      orders: [order],
    })).map(issue => issue.id);
    expect(ids).not.toContain('snapshot-arith:order-1:line-1:bulk-1');
  });

  it('expectedProductionDeltas 는 저장 당시 스냅샷만 근거로 삼는다', () => {
    const itemById = new Map<string, Item>([['A', productItem({ id: 'A', name: 'A' })], ['B', productItem({ id: 'B', name: 'B' })]]);
    const expected = expectedProductionDeltas(
      { capturedAt: '2026-09-16', stockDeltas: [], bomLines: [{ parentItemId: 'A', childItemId: 'B', quantity: 2 }] },
      [{ itemId: 'A', qty: 3 }],
      [],
      itemById,
    );
    expect(expected.get('A')).toBe(3);
    expect(expected.get('B')).toBe(-6);
  });
});

describe('auditDataIntegrity — P0.2 원료 원장 대조', () => {
  const ledger = (over: Partial<RawMaterialEntry> & { source?: unknown; operationId?: string; reportedDeltaKg?: number; lotChanges?: unknown; kind?: string } = {}) => ({
    id: 'op_purchase_x', operationId: 'production:order-1::a1:raw-1',
    companyId: 'taebaek', rawItemId: 'raw-1', materialSnapshot: '볶음참깨',
    date: '2026-09-16', received: 0, used: 10, note: '', createdAt: '2026-09-16T01:00:00.000Z',
    material: '볶음참깨', effectiveAt: '2026-09-16T03:00:00+09:00', kind: 'consume',
    reportedDeltaKg: -10,
    lotChanges: [{ deltaKg: -10, beforeKg: 20, afterKg: 10 }],
    source: { type: 'production', id: 'order-1' },
    ...over,
  } as unknown as RawMaterialEntry);

  const traceOrder = (trace: OrderRawInventoryTrace, ledgerIds: string[]): Order => appliedOrder({
    producedUnits: [{ itemId: 'item-1', qty: 1 }],
    production: coherentSnapshot({
      stockDeltas: [{ itemId: 'item-1', delta: 1 }],
      rawConsumedLots: [trace],
      rawLedgerIds: ledgerIds,
    }),
    rawConsumedLots: [trace],
  });

  it('trace kg 와 원장 reportedDeltaKg 가 다르면 잡는다', () => {
    const trace: OrderRawInventoryTrace = { material: '볶음참깨', rawItemId: 'raw-1', operationId: 'production:order-1::a1:raw-1', supplierName: '거래처', kg: 12 };
    const issues = auditDataIntegrity(input({
      orders: [traceOrder(trace, ['op_purchase_x'])],
      rawMaterialLedger: [ledger()],
    }));
    const ids = issues.map(issue => issue.id);
    expect(ids).toContain('raw-ledger-mismatch:order-1:line-1:op_purchase_x');
  });

  it('원장 source.id 가 다른 주문을 가리키면 잡는다', () => {
    const trace: OrderRawInventoryTrace = { material: '볶음참깨', rawItemId: 'raw-1', operationId: 'production:order-1::a1:raw-1', supplierName: '거래처', kg: 10 };
    const issues = auditDataIntegrity(input({
      orders: [traceOrder(trace, ['op_purchase_x'])],
      rawMaterialLedger: [ledger({ source: { type: 'production', id: 'order-엉뚱한' } })],
    }));
    expect(issues.map(issue => issue.id)).toContain('raw-ledger-mismatch:order-1:line-1:op_purchase_x');
  });

  it('임가공 trace 는 로트 변화가 없어야 한다 — 있으면 잡는다', () => {
    const trace: OrderRawInventoryTrace = { material: '볶음참깨', rawItemId: 'raw-1', operationId: 'production-ledger:order-1::a1:raw-1', supplierName: '임가공', kg: 10, ledgerOnly: true };
    const issues = auditDataIntegrity(input({
      orders: [traceOrder(trace, ['op_oem_x'])],
      rawMaterialLedger: [ledger({ id: 'op_oem_x', operationId: 'production-ledger:order-1::a1:raw-1', kind: 'ledger-consume', source: { type: 'oem', id: 'order-1' }, lotChanges: [{ deltaKg: -10, beforeKg: 20, afterKg: 10 }] })],
    }));
    expect(issues.map(issue => issue.id)).toContain('raw-ledger-mismatch:order-1:line-1:op_oem_x');
  });

  it('trace 와 원장이 완전히 맞으면 문제로 잡지 않는다', () => {
    const trace: OrderRawInventoryTrace = { material: '볶음참깨', rawItemId: 'raw-1', operationId: 'production:order-1::a1:raw-1', supplierName: '거래처', kg: 10 };
    const issues = auditDataIntegrity(input({
      orders: [traceOrder(trace, ['op_purchase_x'])],
      rawMaterialLedger: [ledger()],
    }));
    expect(issues.map(issue => issue.id).filter(id => id.startsWith('raw-ledger-mismatch'))).toEqual([]);
  });

  it('같은 작업번호의 여러 로트 trace 는 합산해서 원장 한 건과 대조한다', () => {
    const operationId = 'production:order-1::a1:raw-1';
    const traces: OrderRawInventoryTrace[] = [
      { material: '볶음참깨', rawItemId: 'raw-1', operationId, supplierName: 'A', kg: 30 },
      { material: '볶음참깨', rawItemId: 'raw-1', operationId, supplierName: 'B', kg: 130 },
    ];
    const order = appliedOrder({
      producedUnits: [{ itemId: 'item-1', qty: 1 }],
      production: coherentSnapshot({ stockDeltas: [{ itemId: 'item-1', delta: 1 }], rawConsumedLots: traces, rawLedgerIds: ['op_purchase_x'] }),
      rawConsumedLots: traces,
    });
    const issues = auditDataIntegrity(input({
      orders: [order],
      rawMaterialLedger: [ledger({ reportedDeltaKg: -160, lotChanges: [{ deltaKg: -160, beforeKg: 200, afterKg: 40 }] })],
    }));
    expect(issues.map(issue => issue.id).filter(id => id.startsWith('raw-ledger-mismatch'))).toEqual([]);
  });

  it('음수 이월 로트는 현재고 오류가 아니라 생산 시점 부족 경고로 구분한다', () => {
    const trace: OrderRawInventoryTrace = { material: '볶음참깨', rawItemId: 'raw-1', operationId: 'production:order-1::a1:raw-1', supplierName: '이월', kg: 10 };
    const issues = auditDataIntegrity(input({
      orders: [traceOrder(trace, ['op_purchase_x'])],
      rawMaterialLedger: [ledger({ lotChanges: [{ lotId: 'carry-x', supplierName: '이월', deltaKg: -10, beforeKg: 0, afterKg: -10 }] })],
    }));
    const ids = issues.map(issue => issue.id);
    expect(ids.some(id => id.startsWith('raw-carry-shortage:'))).toBe(true);
    expect(ids.some(id => id.startsWith('raw-ledger-mismatch:'))).toBe(false);
  });

  it('일반 로트가 음수가 되면 원장 오류로 잡는다', () => {
    const trace: OrderRawInventoryTrace = { material: '볶음참깨', rawItemId: 'raw-1', operationId: 'production:order-1::a1:raw-1', supplierName: '거래처', kg: 10 };
    const issues = auditDataIntegrity(input({
      orders: [traceOrder(trace, ['op_purchase_x'])],
      rawMaterialLedger: [ledger({ lotChanges: [{ lotId: 'lot-normal', supplierName: '거래처', deltaKg: -10, beforeKg: 0, afterKg: -10 }] })],
    }));
    expect(issues.map(issue => issue.id).some(id => id.startsWith('raw-ledger-mismatch:'))).toBe(true);
  });
});

describe('auditDataIntegrity — P0.3 발주 입고 라인별 대조', () => {
  it('멀티품목 발주에서 한 품목만 입고 기록이 있으면 나머지 품목을 잡는다', () => {
    const a = productItem({ id: 'A', name: '자재 A' });
    const b = productItem({ id: 'B', name: '자재 B' });
    const po = {
      id: 'po-multi', companyId: 'taebaek', status: 'received', createdAt: '2026-09-16T00:00:00.000Z',
      items: [
        { itemId: 'A', name: '자재 A', quantity: 3, unit: '개' },
        { itemId: 'B', name: '자재 B', quantity: 2, unit: '개' },
      ],
    } as unknown as PurchaseOrder;
    const receipt = {
      id: 'r-1', companyId: 'taebaek', poId: 'po-multi', itemId: 'A', itemName: '자재 A',
      quantity: 3, partnerName: '거래처', date: '2026-09-16', createdAt: '2026-09-16T01:00:00.000Z',
    } as ItemReceipt;

    const ids = auditDataIntegrity(input({
      items: [a, b],
      purchaseOrders: [po],
      itemReceipts: [receipt],
    })).map(issue => issue.id);
    expect(ids).toContain('po-no-receipt:po-multi:B');
    expect(ids).not.toContain('po-no-receipt:po-multi:A');
  });

  it('발주 수량과 입고 수량이 다르면 잡는다', () => {
    const po = {
      id: 'po-1', companyId: 'taebaek', status: 'received', createdAt: '2026-09-16T00:00:00.000Z',
      itemId: 'item-1', itemName: '정상 품목', quantity: 5, unit: '개',
    } as unknown as PurchaseOrder;
    const receipt = {
      id: 'r-1', companyId: 'taebaek', poId: 'po-1', itemId: 'item-1', itemName: '정상 품목',
      quantity: 3, partnerName: '거래처', date: '2026-09-16', createdAt: '2026-09-16T01:00:00.000Z',
    } as ItemReceipt;
    const ids = auditDataIntegrity(input({
      purchaseOrders: [po],
      itemReceipts: [receipt],
    })).map(issue => issue.id);
    expect(ids).toContain('po-receipt-qty:po-1:item-1');
  });

  it('개 단위 WIP(캔 반제품)는 원료로 오인해 원장을 요구하지 않는다', () => {
    // 이름이 RM_LIST 에 없어야 한다 — 캔은 완제품(참기름-캔) 이라 baseRawName 이 RM_LIST 에 없다.
    const can = productItem({ id: 'can-1', name: '시골향참기름1-캔', type: 'wip', subtype: '낱개', unit: '개' });
    const po = {
      id: 'po-can', companyId: 'taebaek', status: 'received', createdAt: '2026-09-16T00:00:00.000Z',
      itemId: 'can-1', itemName: '시골향참기름1-캔', quantity: 6, unit: '개',
    } as unknown as PurchaseOrder;
    const receipt = {
      id: 'r-can', companyId: 'taebaek', poId: 'po-can', itemId: 'can-1', itemName: '시골향참기름1-캔',
      quantity: 6, partnerName: '거래처', date: '2026-09-16', createdAt: '2026-09-16T01:00:00.000Z',
    } as ItemReceipt;
    const ids = auditDataIntegrity(input({
      items: [can], purchaseOrders: [po], itemReceipts: [receipt],
    })).map(issue => issue.id);
    // 원료 이동을 찾지 못했다는 오류가 나오면 안 된다.
    expect(ids).not.toContain('po-no-raw:po-can:can-1');
    expect(ids.filter(id => id.startsWith('po-'))).toEqual([]);
  });
});

describe('auditDataIntegrity — P1.4 전체 원장으로 연결 검사', () => {
  it('기간 밖 원료 이동을 누락으로 오인하지 않는다', () => {
    const order = appliedOrder({
      producedUnits: [{ itemId: 'item-1', qty: 1 }],
      production: coherentSnapshot({
        stockDeltas: [{ itemId: 'item-1', delta: 1 }],
        rawLedgerIds: ['op_old_ledger'],
      }),
    });
    // 원장 문서는 어제 날짜(감사 기간 밖) — 여전히 배열에는 있으므로 참조를 찾을 수 있어야 한다.
    const oldLedger = {
      id: 'op_old_ledger', operationId: 'production:order-1::a1:raw-1',
      companyId: 'taebaek', rawItemId: 'raw-1', materialSnapshot: '볶음참깨',
      date: '2026-09-15', received: 0, used: 10, note: '', createdAt: '2026-09-15T01:00:00.000Z',
      material: '볶음참깨',
    } as unknown as RawMaterialEntry;

    const ids = auditDataIntegrity(input({
      dateFrom: '2026-09-16', dateTo: '2026-09-16',
      orders: [order],
      rawMaterialLedger: [oldLedger],
    })).map(issue => issue.id);
    expect(ids).not.toContain('raw-ledger-missing:order-1:line-1:op_old_ledger');
  });
});

describe('auditDataIntegrity — P1.5 판매일지 회사 구분', () => {
  const badRow = { 상호: '거래처', 품목: '', 용량: '', 수량: 1 };

  it('회사 미기록 판매일지는 태백 감사에서만 보고한다', () => {
    const salesLog = { id: 'sales-orphan', date: '2026-09-16', salesRows: [badRow] } as unknown as ProductionSalesLog;

    const taebaek = auditDataIntegrity(input({ companyId: 'taebaek', productionSalesLogs: [salesLog] }));
    const punghoe = auditDataIntegrity(input({ companyId: 'punghoe', productionSalesLogs: [salesLog] }));
    expect(taebaek.map(i => i.id)).toContain('sales-name:sales-orphan:0');
    expect(punghoe.map(i => i.id)).not.toContain('sales-name:sales-orphan:0');
  });

  it('회사가 붙은 판매일지는 그 회사 감사에서만 보고한다', () => {
    const punghoeLog = { id: 'sales-punghoe', date: '2026-09-16', companyId: 'punghoe', salesRows: [badRow] } as unknown as ProductionSalesLog;
    const taebaek = auditDataIntegrity(input({ companyId: 'taebaek', productionSalesLogs: [punghoeLog] }));
    const punghoe = auditDataIntegrity(input({ companyId: 'punghoe', productionSalesLogs: [punghoeLog] }));
    expect(taebaek.map(i => i.id)).not.toContain('sales-name:sales-punghoe:0');
    expect(punghoe.map(i => i.id)).toContain('sales-name:sales-punghoe:0');
  });
});

describe('auditDataIntegrity — 주문·판매일지·서류수불부 대조', () => {
  const formulaItem = Object.keys(PRODUCT_FORMULA)[0];
  const journalItem = productItem({ 품목: formulaItem, spec: '350ml' } as Partial<Item>);
  const deliveredOrder = (): Order => ({
    ...appliedOrder(),
    status: 'DELIVERED',
    deliveredAt: '2026-09-16T00:00:00.000Z',
    items: [{ lineId: 'line-1', itemId: journalItem.id, name: journalItem.name, quantity: 2, price: 1000, checked: false }],
  } as unknown as Order);
  const matchingLog = (qty = 2): ProductionSalesLog => ({
    id: 'sales-1', companyId: 'taebaek', date: '2026-09-16', createdAt: '2026-09-16T10:00:00.000Z',
    createdBy: '관리자', orderCount: 1, productionRows: [], seedRows: [], extraRows: [],
    salesRows: [{ 상호: '거래처', 품목: formulaItem, 용량: '350ml', 수량: qty, 소비기한: '' }],
    orderSummaries: [],
  } as unknown as ProductionSalesLog);

  it('배송완료 주문에 저장된 생산판매일지가 없으면 잡는다', () => {
    const ids = auditDataIntegrity(input({ items: [journalItem], orders: [deliveredOrder()] })).map(issue => issue.id);
    expect(ids).toContain('sales-log-missing:2026-09-16');
  });

  it('주문을 서류 품목으로 환산한 수량과 저장 일지 수량이 다르면 잡는다', () => {
    const ids = auditDataIntegrity(input({
      items: [journalItem], orders: [deliveredOrder()], productionSalesLogs: [matchingLog(1)],
    })).map(issue => issue.id);
    expect(ids.some(id => id.startsWith('sales-log-qty:2026-09-16:'))).toBe(true);
  });

  it('거래처·서류품목·용량·수량과 주문 건수가 모두 맞으면 일지 대조 오류가 없다', () => {
    const ids = auditDataIntegrity(input({
      items: [journalItem], orders: [deliveredOrder()], productionSalesLogs: [matchingLog()],
    })).map(issue => issue.id);
    expect(ids.filter(id => id.startsWith('sales-log-'))).toEqual([]);
  });

  it('판매 kg가 서류 원료 배합비로 내려가지 않으면 잡는다', () => {
    const unmapped = productItem({ 품목: '배합비없는기름', spec: '1kg' } as Partial<Item>);
    const order = { ...deliveredOrder(), items: [{ lineId: 'line-1', itemId: unmapped.id, name: unmapped.name, quantity: 5, price: 1000, checked: false }] } as unknown as Order;
    const ids = auditDataIntegrity(input({ items: [unmapped], orders: [order] })).map(issue => issue.id);
    expect(ids).toContain('doc-raw-ratio:2026-09-16');
  });
});
