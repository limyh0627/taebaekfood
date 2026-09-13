import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawMaterialLot } from '../../shared/types';

const memory = vi.hoisted(() => ({
  docs: new Map<string, Record<string, any>>(),
  transactionCount: 0,
}));
type Ref = { path: string };

vi.mock('firebase/firestore', () => {
  const doc = (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') });
  const snapshot = (ref: Ref) => {
    const data = memory.docs.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  };
  const runTransaction = async (_db: unknown, callback: (tx: any) => Promise<unknown>) => {
    memory.transactionCount += 1;
    const pending: { path: string; patch: Record<string, unknown> }[] = [];
    const result = await callback({
      get: async (ref: Ref) => snapshot(ref),
      update: (ref: Ref, patch: Record<string, unknown>) => pending.push({ path: ref.path, patch }),
    });
    for (const write of pending) {
      memory.docs.set(write.path, { ...(memory.docs.get(write.path) ?? {}), ...write.patch });
    }
    return result;
  };
  return { doc, runTransaction };
});

const { applyOemReceiptInventory } = await import('./oemReceiptInventory');

const receivedLot = (itemId: string): RawMaterialLot => ({
  id: `lot-${itemId}-receipt`, itemId, material: '볶음참깨', supplierName: '푸미푸드',
  qtyIn: 5, qtyRemaining: 5, unitKg: 20, kgIn: 100, kgRemaining: 100,
  receivedDate: '2026-09-13', status: 'active', createdAt: '2026-09-13T12:00:00.000Z',
} as RawMaterialLot);

const input = () => ({
  poId: 'oem-1',
  operationId: 'oem-receive:oem-1',
  date: '2026-09-13',
  items: [{ itemId: 'box20', qty: 5, lot: receivedLot('box20'), material: '볶음참깨', unitKg: 20 }],
  poPatch: { status: 'received' as const, oemReceivedKg: 100 },
});

beforeEach(() => {
  memory.docs.clear();
  memory.transactionCount = 0;
});

describe('OEM 가공입고 DB 경계', () => {
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
  });

  it('품목 하나가 없으면 다른 품목과 배치도 전혀 쓰지 않는다', async () => {
    memory.docs.set('purchaseOrders/oem-1', { status: 'invoiced' });
    memory.docs.set('items/box20', { stock: 15, lots: [] });
    const bad = { ...input(), items: [...input().items, { itemId: 'missing', qty: 1 }] };

    await expect(applyOemReceiptInventory({} as never, bad)).rejects.toThrow('missing');

    expect(memory.docs.get('items/box20')).toEqual({ stock: 15, lots: [] });
    expect(memory.docs.get('purchaseOrders/oem-1')).toEqual({ status: 'invoiced' });
  });

  it('같은 작업 번호로 재시도하면 완제품을 다시 늘리지 않는다', async () => {
    memory.docs.set('purchaseOrders/oem-1', {
      status: 'received',
      oemReceiptOperationId: 'oem-receive:oem-1',
    });
    memory.docs.set('items/box20', { stock: 20, lots: [receivedLot('box20')] });

    const result = await applyOemReceiptInventory({} as never, input());

    expect(result).toBe('duplicate');
    expect(memory.docs.get('items/box20')?.stock).toBe(20);
  });
});
