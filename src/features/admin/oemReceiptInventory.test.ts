import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawMaterialLot } from '../../shared/types';

const memory = vi.hoisted(() => ({
  docs: new Map<string, Record<string, any>>(),
  transactionCount: 0,
}));
type Ref = { path: string };

vi.mock('firebase/firestore', () => {
  const doc = (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') });
  const collection = (_db: unknown, name: string) => ({ path: name });
  const where = (field: string, _op: string, value: unknown) => ({ field, value });
  const query = (ref: Ref, ...filters: { field: string; value: unknown }[]) => ({ ...ref, filters });
  const getDocs = async (ref: Ref & { filters: { field: string; value: unknown }[] }) => ({
    docs: [...memory.docs.entries()]
      .filter(([path, data]) => path.startsWith(`${ref.path}/`) && ref.filters.every(filter =>
        (filter.field === '__name__' ? path.slice(ref.path.length + 1) : data[filter.field]) === filter.value))
      .map(([path]) => ({ id: path.slice(ref.path.length + 1) })),
  });
  const snapshot = (ref: Ref) => {
    const data = memory.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  };
  const runTransaction = async (_db: unknown, callback: (tx: any) => Promise<unknown>) => {
    memory.transactionCount += 1;
    const pending: { path: string; patch: Record<string, unknown>; replace?: boolean }[] = [];
    const result = await callback({
      get: async (ref: Ref) => snapshot(ref),
      update: (ref: Ref, patch: Record<string, unknown>) => pending.push({ path: ref.path, patch }),
      set: (ref: Ref, patch: Record<string, unknown>) => pending.push({ path: ref.path, patch, replace: true }),
    });
    for (const write of pending) {
      memory.docs.set(write.path, write.replace ? write.patch : { ...(memory.docs.get(write.path) ?? {}), ...write.patch });
    }
    return result;
  };
  return { collection, doc, getDocs, query, runTransaction, where };
});

const { applyOemReceiptInventory } = await import('./oemReceiptInventory');

const receivedLot = (itemId: string): RawMaterialLot => ({
  id: `lot-${itemId}-receipt`, itemId, material: '볶음참깨', supplierName: '푸미푸드',
  qtyIn: 5, qtyRemaining: 5, unitKg: 20, kgIn: 100, kgRemaining: 100,
  receivedDate: '2026-09-13', status: 'active', createdAt: '2026-09-13T12:00:00.000Z',
} as RawMaterialLot);

const input = () => ({
  companyId: 'taebaek' as const,
  poId: 'oem-1',
  operationId: 'oem-receive:oem-1',
  date: '2026-09-13',
  items: [{ itemId: 'box20', qty: 5, lot: receivedLot('box20'), material: '볶음참깨', unitKg: 20 }],
  poPatch: { status: 'received' as const, oemReceivedKg: 100 },
  feeRequest: {
    id: 'OEMFEE-oem-1', companyId: 'taebaek' as const,
    itemId: 'oem-1', itemName: '외주가공비', originalQuantity: 100,
    type: 'oem_fee' as const, reason: '가공비 전표 발행 필요', status: 'pending' as const,
    requestedAt: '2026-09-13T00:00:00Z', oemPoId: 'oem-1',
  },
});

beforeEach(() => {
  memory.docs.clear();
  memory.transactionCount = 0;
});

describe('OEM 가공입고 DB 경계', () => {
  it.each([-1, 0, Number.NaN, Number.POSITIVE_INFINITY])('잘못된 입고 수량 %s은 재고가 충분해도 쓰기 전에 거절한다', async qty => {
    memory.docs.set('purchaseOrders/oem-1', { status: 'invoiced', companyId: 'taebaek' });
    memory.docs.set('items/box20', { stock: 15, lots: [], companyId: 'taebaek' });
    const bad = { ...input(), items: [{ itemId: 'box20', qty }] };

    await expect(applyOemReceiptInventory({} as never, bad)).rejects.toThrow('입고 수량');

    expect(memory.transactionCount).toBe(0);
    expect(memory.docs.get('items/box20')?.stock).toBe(15);
    expect(memory.docs.get('purchaseOrders/oem-1')?.status).toBe('invoiced');
    expect(memory.docs.has('adjustmentRequests/OEMFEE-oem-1')).toBe(false);
  });

  it('완제품 stock·lots와 배치 완료를 한 transaction에서 함께 저장한다', async () => {
    memory.docs.set('purchaseOrders/oem-1', { status: 'invoiced' });
    memory.docs.set('items/box20', { stock: 15, lots: [] });

    const result = await applyOemReceiptInventory({} as never, input());

    expect(result).toBe('applied');
    expect(memory.transactionCount).toBe(1);
    expect(memory.docs.get('items/box20')).toMatchObject({
      stock: 20,
      lots: [
        { id: 'lot-carry-oem-oem-1-box20', qtyRemaining: 15 },
        { id: 'lot-box20-receipt', qtyRemaining: 5 },
      ],
    });
    expect(memory.docs.get('purchaseOrders/oem-1')).toMatchObject({
      status: 'received',
      oemReceivedKg: 100,
      oemReceiptOperationId: 'oem-receive:oem-1',
    });
    expect(memory.docs.get('adjustmentRequests/OEMFEE-oem-1')).toMatchObject({ type: 'oem_fee', companyId: 'taebaek' });
  });

  it('품목 하나가 없으면 다른 품목과 배치도 전혀 쓰지 않는다', async () => {
    memory.docs.set('purchaseOrders/oem-1', { status: 'invoiced' });
    memory.docs.set('items/box20', { stock: 15, lots: [] });
    const bad = { ...input(), items: [...input().items, { itemId: 'missing', qty: 1 }] };

    await expect(applyOemReceiptInventory({} as never, bad)).rejects.toThrow('missing');

    expect(memory.docs.get('items/box20')).toEqual({ stock: 15, lots: [] });
    expect(memory.docs.get('purchaseOrders/oem-1')).toEqual({ status: 'invoiced' });
    expect(memory.docs.has('adjustmentRequests/OEMFEE-oem-1')).toBe(false);
  });

  it('같은 작업 번호로 재시도하면 완제품을 다시 늘리지 않는다', async () => {
    memory.docs.set('purchaseOrders/oem-1', {
      status: 'received',
      oemReceiptOperationId: 'oem-receive:oem-1',
    });
    memory.docs.set('items/box20', { stock: 20, lots: [receivedLot('box20')] });

    await expect(applyOemReceiptInventory({} as never, input())).rejects.toThrow('관리자 복구');
    expect(memory.docs.get('items/box20')?.stock).toBe(20);
    expect(memory.docs.has('adjustmentRequests/OEMFEE-oem-1')).toBe(false);
    memory.docs.set('adjustmentRequests/OEMFEE-oem-1', input().feeRequest);
    expect(await applyOemReceiptInventory({} as never, input())).toBe('duplicate');
  });

  it('같은 ID의 기존 확인 요청을 덮어쓰지 않는다', async () => {
    memory.docs.set('purchaseOrders/oem-1', { status: 'invoiced', companyId: 'taebaek' });
    memory.docs.set('items/box20', { stock: 15, lots: [], companyId: 'taebaek' });
    const oldRequest = { ...input().feeRequest, reason: '기존 확인 요청' };
    memory.docs.set('adjustmentRequests/OEMFEE-oem-1', oldRequest);

    await expect(applyOemReceiptInventory({} as never, input())).rejects.toThrow('이미 있습니다');
    expect(memory.docs.get('adjustmentRequests/OEMFEE-oem-1')).toEqual(oldRequest);
    expect(memory.docs.get('items/box20')?.stock).toBe(15);
    expect(memory.docs.get('purchaseOrders/oem-1')?.status).toBe('invoiced');
  });

  it('다른 회사 배치 또는 품목이면 transaction 전체를 거절한다', async () => {
    memory.docs.set('purchaseOrders/oem-1', { status: 'invoiced', companyId: 'taebaek' });
    memory.docs.set('items/box20', { stock: 15, lots: [], companyId: 'punghoe' });
    await expect(applyOemReceiptInventory({} as never, input())).rejects.toThrow('다른 회사');
    expect(memory.docs.get('items/box20')?.stock).toBe(15);
    expect(memory.docs.get('purchaseOrders/oem-1')?.status).toBe('invoiced');

    memory.docs.set('items/box20', { stock: 15, lots: [], companyId: 'taebaek' });
    memory.docs.set('purchaseOrders/oem-1', { status: 'invoiced', companyId: 'punghoe' });
    await expect(applyOemReceiptInventory({} as never, input())).rejects.toThrow('다른 회사');
    expect(memory.docs.get('items/box20')?.stock).toBe(15);
  });
});
