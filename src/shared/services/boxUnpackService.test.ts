import { beforeEach, describe, expect, it, vi } from 'vitest';

type Ref = { path: string };
const store = new Map<string, Record<string, unknown>>();
let writes = 0;
vi.mock('../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]): Ref => ({ path: parts.join('/') }),
  runTransaction: async (_db: unknown, callback: (tx: unknown) => Promise<unknown>) => {
    const pending: Array<{ path: string; data: Record<string, unknown> }> = [];
    const tx = {
      get: async (ref: Ref) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) }),
      update: (ref: Ref, patch: Record<string, unknown>) => pending.push({ path: ref.path, data: { ...store.get(ref.path), ...patch } }),
      set: (ref: Ref, data: Record<string, unknown>) => pending.push({ path: ref.path, data }),
    };
    const result = await callback(tx);
    for (const write of pending) { store.set(write.path, write.data); writes++; }
    return result;
  },
}));
const { unpackBoxStock } = await import('./boxUnpackService');
const request = { boxItemId: 'box', unitItemId: 'unit', count: 10, operationId: 'open-1' };
const lot = { id: 'source', supplierName: '푸미푸드', lotNo: 'B-1', receivedDate: '2026-10-01',
  qtyIn: 2, qtyRemaining: 2, unitKg: 10, kgIn: 20, kgRemaining: 20, status: 'active' };

beforeEach(() => {
  store.clear(); writes = 0;
  store.set('items/box', { companyId: 'taebaek', name: '볶음참깨 박스', stock: 2, lots: [{ ...lot }] });
  store.set('items/unit', { companyId: 'taebaek', name: '볶음참깨 낱개', spec: '1kg', stock: 0, lots: [] });
});

describe('박스 개봉', () => {
  it('박스와 낱개 재고·로트·이동 근거를 한 거래로 저장하고 재시도는 중복 차감하지 않는다', async () => {
    expect((await unpackBoxStock(request)).ok).toBe(true);
    expect(store.get('items/box')?.stock).toBe(1);
    expect(store.get('items/unit')?.stock).toBe(10);
    expect((store.get('items/box')?.lots as typeof lot[])[0].qtyRemaining).toBe(1);
    expect((store.get('items/unit')?.lots as typeof lot[])[0]).toMatchObject({
      supplierName: '푸미푸드', lotNo: 'B-1', qtyRemaining: 10,
    });
    expect(store.get('itemUnpackMovements/open-1')).toMatchObject({
      boxItemId: 'box', unitItemId: 'unit', count: 10,
      sourceLots: [{ lotId: 'source', qty: 1 }],
    });
    expect(writes).toBe(3);
    expect((await unpackBoxStock(request)).ok).toBe(true);
    expect(writes).toBe(3);
  });

  it('재고와 로트가 어긋나면 두 품목 모두 변경하지 않는다', async () => {
    store.set('items/box', { ...store.get('items/box'), stock: 3 });
    const before = JSON.stringify([...store.entries()]);
    const result = await unpackBoxStock(request);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('실사');
    expect(JSON.stringify([...store.entries()])).toBe(before);
    expect(writes).toBe(0);
  });

  it('회사가 다르거나 같은 작업번호를 다른 요청에 쓰면 거절한다', async () => {
    store.set('items/unit', { ...store.get('items/unit'), companyId: 'punghoe' });
    expect((await unpackBoxStock(request)).ok).toBe(false);
    expect(writes).toBe(0);
    store.set('items/unit', { ...store.get('items/unit'), companyId: 'taebaek' });
    expect((await unpackBoxStock(request)).ok).toBe(true);
    expect((await unpackBoxStock({ ...request, count: 12 })).ok).toBe(false);
    expect(writes).toBe(3);
  });
});
