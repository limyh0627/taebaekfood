import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnpackPlan } from '../canUnpack';
import { inventoryDocId } from '../rawInventoryCore';

type Ref = { path: string };
const store = new Map<string, Record<string, unknown>>();
let writes = 0;

vi.mock('../firebase', () => ({ db: { __memory: true } }));
vi.mock('../../constants/formula', () => ({ baseRawName: (name: string) => name }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]): Ref => ({ path: segments.join('/') }),
  getDoc: async (ref: Ref) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) }),
  runTransaction: async (_db: unknown, callback: (tx: unknown) => Promise<unknown>) => {
    const pending: { path: string; data: Record<string, unknown> }[] = [];
    const tx = {
      get: async (ref: Ref) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) }),
      update: (ref: Ref, data: Record<string, unknown>) => pending.push({ path: ref.path, data: { ...store.get(ref.path), ...data } }),
      set: (ref: Ref, data: Record<string, unknown>) => pending.push({ path: ref.path, data }),
    };
    const result = await callback(tx);
    for (const write of pending) { store.set(write.path, write.data); writes++; }
    return result;
  },
}));

const { unpack } = await import('./unpackService');
const plan: UnpackPlan = {
  canItemId: 'can-x', canName: '깨분참기름 캔', cans: 1,
  bulkItemId: 'raw-x', bulkName: '깨분참기름', bulkUnit: 'kg',
  perCan: 16.5, bulkQty: 16.5, discarded: [],
};

beforeEach(() => {
  store.clear();
  writes = 0;
  store.set('items/can-x', { id: 'can-x', companyId: 'taebaek', stock: 3, lots: [] });
  store.set('items/raw-x', { id: 'raw-x', companyId: 'taebaek', name: '깨분참기름', stock: 100, lots: [] });
  store.set(`rawInventories/${inventoryDocId('taebaek', 'raw-x')}`, {
    id: inventoryDocId('taebaek', 'raw-x'), companyId: 'taebaek', rawItemId: 'raw-x',
    materialSnapshot: '깨분참기름', stockKg: 100, revision: 1, lastProcessedAt: '2026-09-01T00:00:00Z',
    activeLots: [{ id: 'bulk-1', material: '깨분참기름', supplierName: '청정', kgIn: 100, kgRemaining: 100,
      receivedDate: '2026-09-01', status: 'active', createdAt: '2026-09-01T00:00:00Z' }],
    recentDepletedLots: [],
  });
});

describe('캔 개봉도 품목 사본과 원자 상태가 일치해야 한다', () => {
  it.each([0.001, 0.5])('차이 %skg이면 캔·벌크·원장 어느 문서도 쓰지 않는다', async delta => {
    store.set('items/raw-x', { ...store.get('items/raw-x'), stock: 100 + delta });
    const before = JSON.stringify([...store.entries()]);
    const result = await unpack(plan);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('품목 재고와 원료 상태가 어긋나');
    expect(writes).toBe(0);
    expect(JSON.stringify([...store.entries()])).toBe(before);
    expect([...store.keys()].filter(key => key.startsWith('rawMaterialLedger/'))).toHaveLength(0);
  });
});
