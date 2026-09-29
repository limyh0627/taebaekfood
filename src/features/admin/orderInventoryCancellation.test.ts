import { executeRawInventoryCommand } from '../../shared/services/rawInventoryService';
import { inventoryDocId, operationDocId, legacyOperationDocId } from '../../shared/rawInventoryCore';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderStatus, type Order, type Item } from '../../shared/types';
import { cancellationEvidence, planOrderCancellation, prepareCancelledItem, prepareOrderInventoryCancellation, executeOrderInventoryCancellation, readOrderCancellationReceipt } from './orderInventoryCancellation';

const memory = vi.hoisted(() => ({ store: new Map<string, any>(), versions: new Map<string, number>(),
  failPath: '', loseResponse: false, readAfterWrite: 0, writes: [] as string[], failReads: false, beforeCommit: null as null | (() => Promise<void>), beforeRead: null as null | ((path: string) => void) }));
vi.mock('firebase/firestore', () => {
  const clone = (data: any) => data == null ? data : JSON.parse(JSON.stringify(data));
  const rejectUndefined = (data: any): void => {
    if (data === undefined) throw new Error('Firestore undefined 거절');
    if (data && typeof data === 'object') Object.values(data).forEach(rejectUndefined);
  };
  const doc = (_db: any, ...parts: string[]) => ({ path: parts.join('/') });
  const getDoc = async (ref: any) => {
    if (memory.failReads) throw new Error('네트워크 조회 실패');
    memory.beforeRead?.(ref.path);
    const data = clone(memory.store.get(ref.path));
    return { exists: () => data !== undefined, data: () => data };
  };
  const runTransaction = async (_db: any, callback: any) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const reads = new Map<string, number>();
      const writes: { path: string; data?: any; method: string }[] = [];
      const tx = {
        get: async (ref: any) => {
          if (writes.length) { memory.readAfterWrite++; throw new Error('쓰기 뒤 읽기'); }
          reads.set(ref.path, memory.versions.get(ref.path) ?? 0);
          return getDoc(ref);
        },
        set: (ref: any, data: any) => { rejectUndefined(data); if (memory.failPath && ref.path.startsWith(memory.failPath)) throw new Error('쓰기 실패'); writes.push({ path: ref.path, data: clone(data), method: 'set' }); },
        update: (ref: any, data: any) => { rejectUndefined(data); if (memory.failPath && ref.path.startsWith(memory.failPath)) throw new Error('쓰기 실패'); writes.push({ path: ref.path, data: clone(data), method: 'update' }); },
        delete: (ref: any) => { if (memory.failPath && ref.path.startsWith(memory.failPath)) throw new Error('삭제 실패'); writes.push({ path: ref.path, method: 'delete' }); },
      };
      const result = await callback(tx);
      if (memory.beforeCommit && writes.some(write => write.path.startsWith('orderStatusAudits/'))) await memory.beforeCommit();
      if ([...reads].some(([path, version]) => (memory.versions.get(path) ?? 0) !== version)) continue;
      for (const write of writes) {
        if (write.method === 'delete') memory.store.delete(write.path);
        else memory.store.set(write.path, write.method === 'update' ? { ...memory.store.get(write.path), ...write.data } : write.data);
        memory.versions.set(write.path, (memory.versions.get(write.path) ?? 0) + 1);
        memory.writes.push(write.path);
      }
      if (memory.loseResponse && writes.some(write => write.path.startsWith('orderStatusAudits/'))) {
        memory.loseResponse = false; throw new Error('커밋 응답 유실');
      }
      return result;
    }
    throw new Error('동시 변경 재시도 초과');
  };
  return { doc, getDoc, runTransaction };
});

const order = (patch: Partial<Order> = {}): Order => ({ id: 'o', companyId: 'taebaek', partnerName: '거래처',
  status: OrderStatus.DISPATCHED, items: [], producedAt: '2026-09-29',
  inventorySnapshots: { version: 1, production: { capturedAt: '2026-09-29', stockDeltas: [{ itemId: 'p', delta: 5 }], bomLines: [], rawConsumedLots: [] } }, ...patch } as Order);
const item = (patch: Partial<Item> = {}): Item => ({ id: 'p', companyId: 'taebaek', stock: 10, name: '품목', ...patch } as Item);

describe('당시 근거로만 삭제·출고취소를 계획한다', () => {
  it('단위 SKU 생산분은 다른 주문 몫을 남기고 수량으로 원복한다', () => {
    const o = order(); const plan = planOrderCancellation(o, 'delete');
    expect(plan.deltas.get('p')).toBe(-5);
    expect(prepareCancelledItem(o, item(), -5, 'delete', [])).toMatchObject({ stock: 5 });
  });
  it('출고완료에서 생산삭제를 실행하지 않는다', () => {
    expect(() => planOrderCancellation(order({ status: OrderStatus.SHIPPED }), 'delete')).toThrow('SHIPMENT_CANCEL_REQUIRED');
  });
  it('다른 주문에 배정된 몫을 침해하면 무쓰기 차단한다', () => {
    const reserved = { operationId: 'other', orderId: 'other', qty: 6, createdAt: new Date().toISOString(), state: 'allocated' as const };
    expect(() => prepareCancelledItem(order(), item({ inventoryReservations: [reserved] }), -5, 'delete', [])).toThrow('FOLLOWING_STOCK_ALLOCATED_OR_CONSUMED');
  });
  it('회사 경계를 먼저 검사한다', () => {
    expect(() => prepareCancelledItem(order(), item({ companyId: 'punghoe' }), -5, 'delete', [])).toThrow('COMPANY_MISMATCH');
  });
  it('줄별 applied만 합치고 aggregate 생산을 중복 복원하지 않는다', () => {
    const production = order().inventorySnapshots!.production!;
    const state = { version: 1 as const, lineId: 'l', itemId: 'p', applied: true, attempt: 1, rawConsumedLots: [], autoBuilt: [], producedUnits: [], production };
    const o = order({ itemInventory: { l: state, old: { ...state, applied: false } } });
    expect(planOrderCancellation(o, 'delete').deltas.get('p')).toBe(-5);
  });
  it('원자 명령 없는 원료 사용을 현재 BOM으로 추정하지 않는다', () => {
    const o = order(); o.inventorySnapshots!.production!.rawConsumedLots = [{ raw: '참깨', kg: 1 } as any];
    expect(() => planOrderCancellation(o, 'delete')).toThrow('RAW_OPERATION_MISSING');
  });
  it('승인 근거는 이름 편집과 객체 키 순서에 흔들리지 않지만 수량이 바뀌면 달라진다', () => {
    const a = order(); const b = order({ partnerName: '새 이름' });
    expect(cancellationEvidence(a, 'delete')).toBe(cancellationEvidence(b, 'delete'));
    b.inventorySnapshots!.production!.stockDeltas[0].delta = 6;
    expect(cancellationEvidence(a, 'delete')).not.toBe(cancellationEvidence(b, 'delete'));
  });
  it('추적 로트가 있는 생산품을 로트 근거 없이 수량만 줄이지 않는다', () => {
    expect(() => prepareCancelledItem(order(), item({ lots: [{ id: 'lot', qtyRemaining: 10 } as any] }), -5, 'delete', [])).toThrow('PRODUCTION_LOT_EVIDENCE_MISSING');
  });
  it('출고취소는 원래 로트에 같은 수량을 돌려준다', () => {
    const result = prepareCancelledItem(order(), item({ lots: [{ id: 'lot', qtyRemaining: 3, unitKg: 1 } as any] }), 2, 'cancel-shipment', [{ itemId: 'p', lotId: 'lot', qty: 2 }]);
    expect(result).toMatchObject({ stock: 12, lots: [{ id: 'lot', qtyRemaining: 5 }] });
  });
});


const db = {} as any;
beforeEach(() => {
  memory.store.clear(); memory.versions.clear(); memory.writes = [];
  memory.failPath = ''; memory.loseResponse = false; memory.readAfterWrite = 0; memory.failReads = false; memory.beforeCommit = null; memory.beforeRead = null;
});
const seed = (o = order(), p = item()) => { memory.store.set('orders/o', JSON.parse(JSON.stringify(o))); memory.store.set('items/p', JSON.parse(JSON.stringify(p))); };

describe('실제 취소서비스의 단일 저장 경계', () => {
  it('생산 재고 원복·주문 삭제·완료표가 함께 확정된다', async () => {
    seed(); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed', deleted: true });
    expect(memory.store.has('orders/o')).toBe(false); expect(memory.store.get('items/p').stock).toBe(5);
    expect(await readOrderCancellationReceipt(db, ticket)).toMatchObject({ status: 'completed' });
    expect(memory.readAfterWrite).toBe(0);
  });
  it.each(['items/p', 'orderStatusAudits/', 'orders/o'])('%s 저장 실패는 전체 재고를 보존한다', async path => {
    seed(); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    memory.failPath = path;
    expect(await executeOrderInventoryCancellation(db, ticket)).not.toMatchObject({ status: 'completed' });
    expect(memory.store.get('items/p').stock).toBe(10); expect(memory.store.has('orders/o')).toBe(true);
    expect([...memory.store.keys()].some(key => key.startsWith('orderStatusAudits/'))).toBe(false);
  });
  it('commit 응답이 사라져도 완료표 재조회 후 성공을 판별하고 재시도에서 수량을 다시 안 바꾼다', async () => {
    seed(); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    memory.loseResponse = true;
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed' });
    expect(await executeOrderInventoryCancellation(db, JSON.parse(JSON.stringify(ticket)))).toMatchObject({ status: 'completed' });
    expect(memory.store.get('items/p').stock).toBe(5);
  });
  it('두 기기가 같은 ticket으로 실행해도 한 번만 원복한다', async () => {
    seed(); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    const results = await Promise.all([executeOrderInventoryCancellation(db, ticket), executeOrderInventoryCancellation(db, ticket)]);
    expect(results.every(result => result.status === 'completed')).toBe(true);
    expect(memory.store.get('items/p').stock).toBe(5);
    expect(memory.writes.filter(path => path === 'items/p')).toHaveLength(1);
  });
  it('완료표 읽기 직후 다른 기기가 삭제하면 완료표 재조회로 성공을 확인한다', async () => {
    seed(); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    await executeOrderInventoryCancellation(db, ticket);
    const auditPath = `orderStatusAudits/${ticket.operationId}`;
    const receipt = memory.store.get(auditPath);
    memory.store.delete(auditPath); seed(); memory.writes = [];
    memory.beforeRead = path => {
      if (path !== 'orders/o') return;
      memory.beforeRead = null;
      memory.store.set(auditPath, receipt);
      memory.store.delete('orders/o');
      memory.store.get('items/p').stock = 5;
    };
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed', deleted: true });
    expect(memory.store.get('items/p').stock).toBe(5);
    expect(memory.writes).toHaveLength(0);
  });
  it('후속 소진 차단은 실패 claim을 보존하고 새 승인으로 우회하지 못한다', async () => {
    seed(order({ items: [{ itemId: 'p', name: '품목', quantity: 3, price: 0 }] }), item({ stock: 4 }));
    const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'blocked',
      code: 'FOLLOWING_STOCK_ALLOCATED_OR_CONSUMED', retryable: false, deleted: false });
    expect(memory.store.get('orders/o').inventoryOperation).toMatchObject({ id: ticket.operationId, state: 'failed' });
    expect(memory.store.get('items/p').stock).toBe(4);
    memory.store.get('orders/o').items[0].quantity = 4;
    const { ticket: changed } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    expect(changed.operationId).not.toBe(ticket.operationId);
    expect(await executeOrderInventoryCancellation(db, changed)).toMatchObject({ status: 'blocked', code: 'OTHER_INVENTORY_OPERATION' });
    expect(memory.store.get('orders/o').inventoryOperation.id).toBe(ticket.operationId);
    expect(memory.store.get('items/p').stock).toBe(4);
    expect(memory.writes.every(path => path === 'orders/o')).toBe(true);
  });
  it('배송완료 과거 기록은 재고 원료 로트에 쓰지 않고 삭제와 완료표만 확정한다', async () => {
    seed(order({ status: OrderStatus.DELIVERED, shippedOut: true, items: [{ itemId: 'p', name: '품목', quantity: 3, price: 0 }],
      rawConsumedLots: [{ rawItemId: 'raw', operationId: 'old', kg: 9 }] as any }), item({ stock: 4 }));
    const prepared = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    expect(prepared).toMatchObject({ recordOnly: true, adjustments: [], rawOperationIds: [] });
    memory.loseResponse = true;
    expect(await executeOrderInventoryCancellation(db, prepared.ticket)).toMatchObject({ status: 'completed', deleted: true });
    expect(await executeOrderInventoryCancellation(db, prepared.ticket)).toMatchObject({ status: 'completed', deleted: true });
    expect(memory.store.has('orders/o')).toBe(false);
    expect(memory.store.get('items/p').stock).toBe(4);
    expect(memory.writes.filter(path => path === 'orders/o')).toHaveLength(2);
    expect(memory.writes.filter(path => path.startsWith('orderStatusAudits/'))).toHaveLength(1);
    expect(memory.writes.every(path => path === 'orders/o' || path.startsWith('orderStatusAudits/'))).toBe(true);
  });
  it.each(['status', 'companyId', 'inventoryOperation'])('배송완료 승인 이후 %s 변경은 삭제하지 않는다', async field => {
    seed(order({ status: OrderStatus.DELIVERED, shippedOut: true }));
    const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    const changes: Record<string, unknown> = { status: OrderStatus.SHIPPED, companyId: 'punghoe',
      inventoryOperation: { id: 'other', state: 'processing', targetStatus: OrderStatus.DISPATCHED } };
    memory.store.get('orders/o')[field] = changes[field];
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'blocked', deleted: false });
    expect(memory.store.has('orders/o')).toBe(true);
    expect(memory.writes).toHaveLength(0);
    expect(memory.store.get('items/p').stock).toBe(10);
  });
  it('배송완료 승인 뒤 작업완료로 바뀌어도 과거 기록 승인으로 생산을 취소하지 않는다', async () => {
    seed(order({ status: OrderStatus.DELIVERED, shippedOut: true }));
    const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    Object.assign(memory.store.get('orders/o'), { status: OrderStatus.DISPATCHED, shippedOut: false });
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'blocked', code: 'APPROVAL_EVIDENCE_CHANGED' });
    expect(memory.store.has('orders/o')).toBe(true);
    expect(memory.store.get('items/p').stock).toBe(10);
    expect(memory.writes).toHaveLength(0);
  });
  it('완료표 없는 주문 없음은 성공이 아니다', async () => {
    seed(); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    memory.store.delete('orders/o');
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'blocked', code: 'ORDER_NOT_FOUND' });
  });
  it('승인 뒤 출고완료로 바뀌면 삭제하지 않는다', async () => {
    seed(); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    memory.store.get('orders/o').status = OrderStatus.SHIPPED;
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'blocked', code: 'APPROVAL_EVIDENCE_CHANGED' });
    expect(memory.store.has('orders/o')).toBe(true); expect(memory.store.get('items/p').stock).toBe(10);
  });
  it.each(['itemId', 'quantity', 'isBoxUnit', 'boxQuantity', 'lineId'])('승인 뒤 주문 줄 %s 변경은 무쓰기 차단한다', async field => {
    seed();
    memory.store.get('orders/o').items = [{ itemId: 'p', quantity: 3, isBoxUnit: false, boxQuantity: 0, lineId: 'line' }];
    const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    const values: Record<string, unknown> = { itemId: 'q', quantity: 99, isBoxUnit: true, boxQuantity: 9, lineId: 'changed' };
    memory.store.get('orders/o').items[0][field] = values[field];
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'blocked', code: 'APPROVAL_EVIDENCE_CHANGED' });
    expect(memory.writes).toHaveLength(0);
    expect(memory.store.has('orders/o')).toBe(true);
    expect(memory.store.get('items/p').stock).toBe(10);
  });
  it('다른 회사나 다른 승인 근거로 완료표를 재사용할 수 없다', async () => {
    seed(); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    await executeOrderInventoryCancellation(db, ticket);
    expect(await executeOrderInventoryCancellation(db, { ...ticket, companyId: 'punghoe' })).toMatchObject({ status: 'blocked', code: 'CANCELLATION_RECEIPT_MISMATCH' });
  });
  it('조회도 실패하면 반영 여부를 unknown으로 반환한다', async () => {
    seed(); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete'); memory.failReads = true;
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'failed', inventoryApplied: 'unknown', retryable: true });
  });
  it('출고취소는 생산과 주문을 유지하고 출고수량만 복원한다', async () => {
    const o = order({ status: OrderStatus.SHIPPED, shippedOut: true });
    o.inventorySnapshots!.shipment = { capturedAt: '2026-09-29', stockDeltas: [{ itemId: 'p', delta: -3 }], bomLines: [], productConsumedLots: [] };
    seed(o); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'cancel-shipment');
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed', deleted: false, nextStatus: OrderStatus.DISPATCHED });
    expect(memory.store.get('items/p').stock).toBe(13);
    expect(memory.store.get('orders/o')).toMatchObject({ status: OrderStatus.DISPATCHED, producedAt: '2026-09-29', shippedOut: false });
    expect(memory.store.get('orders/o').inventorySnapshots.production).toEqual(o.inventorySnapshots!.production);
  });
});


async function seedRawProduction(ledgerOnly = false) {
  seed(); memory.store.set('items/raw', { id: 'raw', name: '참깨', companyId: 'taebaek', stock: 0 });
  const base = { companyId: 'taebaek' as const, rawItemId: 'raw', materialSnapshot: '참깨', effectiveAt: '2026-09-29T08:00:00Z' };
  await executeRawInventoryCommand({ ...base, operationId: 'receipt', kind: 'receive', source: { type: 'purchase', id: 'po' }, kg: 50, lot: { supplierName: '공급자' } }, { db });
  for (const [index, kg] of [10, 5].entries()) {
    const result = await executeRawInventoryCommand({ ...base, operationId: `consume-${index}`, kind: ledgerOnly ? 'ledger-consume' : 'consume', source: { type: ledgerOnly ? 'oem' : 'production', id: 'o' }, kg }, { db });
    expect(result.status).toBe('applied');
  }
  memory.store.get('orders/o').inventorySnapshots.production.rawConsumedLots = [10, 5].map((kg, index) => ({
    material: '참깨', rawItemId: 'raw', operationId: `consume-${index}`, kg, supplierName: '공급자', ledgerOnly,
  }));
  memory.writes = [];
}

describe('원료 다건과 제품·주문 삭제를 하나의 commit으로 확정한다', () => {
  it('동일 원료 두 명령은 역순 virtual state를 이어 최종 상태·mirror를 한번씩 쓴다', async () => {
    await seedRawProduction();
    const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed' });
    expect(memory.store.get('items/raw').stock).toBe(50);
    expect(memory.store.get(`rawInventories/${inventoryDocId('taebaek', 'raw')}`).stockKg).toBe(50);
    expect(memory.writes.filter(path => path === 'items/raw')).toHaveLength(1);
    expect(memory.writes.filter(path => path.startsWith('rawInventories/'))).toHaveLength(1);
    expect(memory.readAfterWrite).toBe(0);
  });
  it.each(['rawMaterialLedger/', 'items/p', 'orderStatusAudits/'])('%s에서 실패해도 원료·제품 모두 원복하지 않는다', async path => {
    await seedRawProduction(); const before = JSON.stringify(memory.store.get('items/raw'));
    const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete'); memory.failPath = path;
    expect(await executeOrderInventoryCancellation(db, ticket)).not.toMatchObject({ status: 'completed' });
    expect(JSON.stringify(memory.store.get('items/raw'))).toBe(before); expect(memory.store.get('items/p').stock).toBe(10);
    expect(memory.store.has('orders/o')).toBe(true);
    expect(memory.store.has(`rawMaterialLedger/${operationDocId('reverse:consume-0')}`)).toBe(false);
  });
  it('임가공 원장 전용 명령은 취소해도 실물 stock/lot을 바꾸지 않는다', async () => {
    await seedRawProduction(true); const before = JSON.stringify(memory.store.get('items/raw'));
    const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed' });
    expect(JSON.stringify(memory.store.get('items/raw'))).toBe(before);
    expect(memory.writes.filter(path => path === 'items/raw')).toHaveLength(0);
  });
  it('옛 문서 ID에 저장된 원본도 동일 operation ID로 취소한다', async () => {
    await seedRawProduction();
    const newPath = `rawMaterialLedger/${operationDocId('consume-0')}`;
    memory.store.set(`rawMaterialLedger/${legacyOperationDocId('consume-0')}`, memory.store.get(newPath)); memory.store.delete(newPath);
    const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed' });
    expect(memory.store.get('items/raw').stock).toBe(50);
  });
  it('당시 trace kg와 원본 명령이 다르면 양수 생산 없는 주문도 차단한다', async () => {
    await seedRawProduction();
    const o = memory.store.get('orders/o'); o.inventorySnapshots.production.stockDeltas = []; o.inventorySnapshots.production.rawConsumedLots[0].kg = 11;
    const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'blocked', code: 'RAW_TRACE_EVIDENCE_MISMATCH' });
    expect(memory.store.get('items/raw').stock).toBe(35); expect(memory.store.has('orders/o')).toBe(true);
  });
  it('작업량 예산 초과는 분할 취소 없이 무쓰기 차단한다', async () => {
    seed(); memory.store.get('orders/o').inventorySnapshots.production.stockDeltas = Array.from({ length: 201 }, (_, index) => ({ itemId: `p${index}`, delta: -1 }));
    const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'blocked', code: 'CANCELLATION_TRANSACTION_BUDGET' });
    expect(memory.store.has('orders/o')).toBe(true); expect(memory.writes.some(path => path.startsWith('items/'))).toBe(false);
  });
});


describe('재접속·조회와 commit 사이 경쟁', () => {
  it('read null 직후 commit이 도착해도 같은 ticket은 한번만 실행된다', async () => {
    seed(); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    let release!: () => void; let entered!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    memory.beforeCommit = async () => { entered(); await paused; };
    const executing = executeOrderInventoryCancellation(db, ticket); await waiting;
    expect(await readOrderCancellationReceipt(db, ticket)).toBeNull();
    release(); expect(await executing).toMatchObject({ status: 'completed' });
    expect(await executeOrderInventoryCancellation(db, JSON.parse(JSON.stringify(ticket)))).toMatchObject({ status: 'completed' });
    expect(memory.store.get('items/p').stock).toBe(5);
    expect(memory.writes.filter(path => path === 'items/p')).toHaveLength(1);
  });
  it('실패한 raw commit을 새 instance가 같은 ticket으로 다시 시작해도 한번만 복원한다', async () => {
    await seedRawProduction(); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    memory.failPath = 'items/p';
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'failed' });
    expect(memory.store.get('orders/o').inventoryOperation.state).toBe('failed');
    memory.failPath = '';
    expect(await executeOrderInventoryCancellation(db, JSON.parse(JSON.stringify(ticket)))).toMatchObject({ status: 'completed' });
    expect(memory.store.get('items/raw').stock).toBe(50); expect(memory.store.get('items/p').stock).toBe(5);
  });
  it('raw 포함 commit의 응답 유실도 완료표로 판별한다', async () => {
    await seedRawProduction(); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete'); memory.loseResponse = true;
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed' });
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed' });
    expect(memory.store.get('items/raw').stock).toBe(50);
    expect(memory.writes.filter(path => path === 'items/raw')).toHaveLength(1);
  });
  it('출고취소된 주문 몫은 작업완료 배정으로 남긴다', async () => {
    const o = order({ status: OrderStatus.SHIPPED, shippedOut: true });
    o.inventorySnapshots!.shipment = { capturedAt: '2026-09-29', stockDeltas: [{ itemId: 'p', delta: -3 }], bomLines: [] };
    seed(o); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'cancel-shipment');
    await executeOrderInventoryCancellation(db, ticket);
    expect(memory.store.get('items/p').inventoryReservations).toMatchObject([{ orderId: 'o', qty: 3, state: 'allocated' }]);
  });
});


it('claim 뒤 다른 상태가 바뀌면 transaction 재검사에서 삭제를 차단한다', async () => {
  seed(); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
  memory.beforeRead = path => {
    if (path !== 'items/p') return;
    memory.beforeRead = null;
    memory.store.get('orders/o').status = OrderStatus.SHIPPED;
    memory.versions.set('orders/o', (memory.versions.get('orders/o') ?? 0) + 1);
  };
  expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'blocked', code: 'APPROVAL_EVIDENCE_CHANGED' });
  expect(memory.store.has('orders/o')).toBe(true); expect(memory.store.get('items/p').stock).toBe(10);
});


describe('일부완료와 미작업 주문 삭제 경계', () => {
  it.each([OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.ON_HOLD])('%s도 실제 적용 줄만 원복한다', async status => {
    const o = order({ status }); const production = o.inventorySnapshots!.production!;
    const state = { version: 1 as const, lineId: 'active', itemId: 'p', applied: true, attempt: 1, rawConsumedLots: [], autoBuilt: [], producedUnits: [], production };
    o.itemInventory = { active: state, inactive: { ...state, lineId: 'inactive', applied: false } };
    seed(o); const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed', deleted: true });
    expect(memory.store.get('items/p').stock).toBe(5);
  });
  it('흔적 없는 미작업 주문은 재고를 쓰지 않고 주문과 완료표만 저장한다', async () => {
    seed(order({ status: OrderStatus.PENDING, producedAt: '', inventorySnapshots: undefined }));
    const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed', deleted: true });
    expect(memory.store.get('items/p').stock).toBe(10); expect(memory.writes.some(path => path.startsWith('items/'))).toBe(false);
  });
  it('raw 흔적이 있는데 스냅샷이 없으면 단순삭제로 우회하지 않는다', async () => {
    seed(order({ status: OrderStatus.PENDING, inventorySnapshots: undefined, rawLotsDeducted: true }));
    await expect(prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete')).rejects.toThrow('PRODUCTION_EVIDENCE_MISSING');
    expect(memory.store.has('orders/o')).toBe(true);
  });
  it('알 수 없는 action은 prepare/execute/read 모두 무쓰기 거절한다', async () => {
    seed(); await expect(prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'corrupt' as any)).rejects.toThrow('CANCELLATION_ACTION_INVALID');
    const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    const invalid = { ...ticket, action: 'corrupt' as any };
    expect(await executeOrderInventoryCancellation(db, invalid)).toMatchObject({ status: 'blocked', code: 'CANCELLATION_ACTION_INVALID' });
    await expect(readOrderCancellationReceipt(db, invalid)).rejects.toThrow('CANCELLATION_ACTION_INVALID');
    expect(memory.writes).toHaveLength(0);
  });
  it('거래처 이름이 없는 옛 주문도 undefined 저장 없이 삭제한다', async () => {
    seed(order({ partnerName: undefined }));
    const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
    expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed' });
  });
});


it('생산량 0으로 기존 재고만 배정된 주문 삭제도 배정을 해제한다', async () => {
  const o = order({ items: [{ itemId: 'p', name: '품목', quantity: 3 } as any] });
  o.inventorySnapshots!.production!.stockDeltas = [];
  seed(o, item({ inventoryReservations: [{ orderId: 'o', operationId: 'allocated', qty: 3, state: 'allocated', createdAt: new Date().toISOString() }] }));
  const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
  expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed' });
  expect(memory.store.get('items/p')).toMatchObject({ stock: 10, inventoryReservations: [] });
});
it('벌크 주문 품목이 원료 mirror와 같아도 zero delta 예약정리가 mirror를 덮지 않는다', async () => {
  await seedRawProduction(); const o = memory.store.get('orders/o'); o.items = [{ itemId: 'raw', name: '참깨', quantity: 15 }];
  const { ticket } = await prepareOrderInventoryCancellation(db, 'o', 'taebaek', 'delete');
  expect(await executeOrderInventoryCancellation(db, ticket)).toMatchObject({ status: 'completed' });
  expect(memory.store.get('items/raw').stock).toBe(50);
  expect(memory.writes.filter(path => path === 'items/raw')).toHaveLength(1);
});
