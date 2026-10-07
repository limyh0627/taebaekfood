import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { Item } from '../types';
import { buildBomIndex, getBomIndex, setBomIndex } from '../bomIndex';
import { buildPackIndex } from '../packIndex';
const state = vi.hoisted(() => ({ docs: new Map<string, any>(), gate: undefined as Promise<void> | undefined, waiting: false, queries: [] as string[] }));
const raw = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../firebase', () => ({ db: {}, authReady: Promise.resolve(), auth: { currentUser: { getIdTokenResult: async () => ({ claims: { companyId: 'taebaek' } }) } } }));
vi.mock('./rawInventoryService', () => ({ readRawCommandInTransaction: raw.read, prepareRawCommand: vi.fn(), writePreparedRawCommand: vi.fn() }));
vi.mock('firebase/firestore', async original => ({ ...await original<typeof import('firebase/firestore')>(),
  doc: (_: unknown, col: string, id: string) => ({ path: `${col}/${id}`, id }),
  collection: (_: unknown, col: string) => col, query: (col: string) => col, where: vi.fn(),
  getDoc: async (ref: { path: string }) => ({ exists: () => state.docs.has(ref.path), data: () => state.docs.get(ref.path) }),
  getDocs: async (col: string) => { state.queries.push(col); return { empty: true, docs: [] }; },
  runTransaction: async (_: unknown, fn: any) => {
    const pending = new Map<string, unknown>();
    const result = await fn({
      get: async (ref: { path: string }) => {
        if (ref.path === 'items/box' && state.gate) { state.waiting = true; await state.gate; }
        return { exists: () => state.docs.has(ref.path), data: () => state.docs.get(ref.path) };
      },
      update: (ref: { path: string }, data: any) => pending.set(ref.path, { ...state.docs.get(ref.path), ...data }),
      set: (ref: { path: string }, data: unknown) => pending.set(ref.path, data),
    });
    pending.forEach((value, key) => state.docs.set(key, value)); return result;
  },
}));
const { confirmUnitPurchaseOrderReceiptWithDb } = await import('./firebaseService');
const items = [
  { id: 'box', companyId: 'taebaek', name: '볶음참깨 포장', type: 'product', spec: '1kg * 20', unit: '개', stock: 0, lots: [], rawMaterialName: '볶음참깨' },
  { id: 'loose', companyId: 'taebaek', name: '볶음참깨 낱개', type: 'product', spec: '1kg', unit: '개' },
  { id: 'holder', companyId: 'taebaek', name: '볶음참깨', type: 'wip', subtype: '벌크', unit: 'kg', stock: 0 },
] as Item[];
const inputs = { bom: buildBomIndex(items, [{ parent_id: 'box', child_id: 'loose', quantity: 20 }]), pack: buildPackIndex() };
const store = {} as Firestore;
const originalIndex = getBomIndex();
beforeEach(() => {
  state.docs.clear(); state.queries = []; state.gate = undefined; state.waiting = false;
  raw.read.mockReset().mockRejectedValue(new Error('원료 명령 관찰 종료'));
  state.docs.set('purchaseOrders/po', { companyId: 'taebaek', status: 'invoiced', partnerName: '공급자', items: [{ itemId: 'box', name: '볶음참깨 포장', quantity: 2, unit: '개' }] });
  state.docs.set('items/box', items[0]); setBomIndex(inputs.bom);
});
afterEach(() => setBomIndex(originalIndex));

it('실제 품목 조회 대기 중 회사 색인이 바뀌어도 명시 BOM의 로트 중량을 유지한다', async () => {
  let finish!: () => void; state.gate = new Promise<void>(done => { finish = done; });
  const pending = confirmUnitPurchaseOrderReceiptWithDb(store, 'taebaek', 'po', '관리자', items, inputs);
  await vi.waitFor(() => expect(state.waiting).toBe(true));
  const foreign = buildBomIndex([], []); setBomIndex(foreign); finish();
  expect(await pending).toBe(true);
  expect(state.docs.get('items/box')).toMatchObject({ stock: 2, lots: [{ unitKg: 20, qtyIn: 2, kgIn: 40, kgRemaining: 40 }] });
  expect(state.docs.get('purchaseOrders/po').status).toBe('received');
  expect(state.queries).toEqual(['itemReceipts', 'rawMaterialLedger']);
  expect(getBomIndex()).toBe(foreign);
});

it('포장 원료 경로도 동일한 명시 BOM으로 원료 명령 kg를 계산한다', async () => {
  state.docs.set('items/box', { ...items[0], type: 'raw' });
  let finish!: () => void; state.gate = new Promise<void>(done => { finish = done; });
  const pending = confirmUnitPurchaseOrderReceiptWithDb(store, 'taebaek', 'po', '관리자', items, inputs);
  const rejected = expect(pending).rejects.toThrow('원료 명령 관찰 종료');
  await vi.waitFor(() => expect(state.waiting).toBe(true)); setBomIndex(buildBomIndex([], [])); finish(); await rejected;
  expect(raw.read.mock.calls[0][2]).toMatchObject({ companyId: 'taebaek', rawItemId: 'holder', kind: 'receive', kg: 40 });
  expect(state.docs.get('purchaseOrders/po').status).toBe('invoiced'); expect(state.docs.get('items/box').stock).toBe(0);
});

it('명시 입력이 없는 기존 호출도 조회 전에 색인을 고정하고 재시도는 중복 입고하지 않는다', async () => {
  let finish!: () => void; state.gate = new Promise<void>(done => { finish = done; });
  const pending = confirmUnitPurchaseOrderReceiptWithDb(store, 'taebaek', 'po', '관리자', items);
  await vi.waitFor(() => expect(state.waiting).toBe(true)); setBomIndex(buildBomIndex([], [])); finish();
  expect(await pending).toBe(true);
  expect(state.docs.get('items/box').lots[0].kgIn).toBe(40);
  expect(await confirmUnitPurchaseOrderReceiptWithDb(store, 'taebaek', 'po', '관리자', items, inputs)).toBe(false);
  expect(state.docs.get('items/box')).toMatchObject({ stock: 2, lots: [expect.objectContaining({ qtyIn: 2 })] });
});

it('다른 회사 발주는 명시 계산 입력이 있어도 입고 상태나 재고를 바꾸지 않는다', async () => {
  await expect(confirmUnitPurchaseOrderReceiptWithDb(store, 'punghoe', 'po', '관리자', items, inputs)).rejects.toThrow('발주 회사');
  expect(state.docs.get('purchaseOrders/po').status).toBe('invoiced');
  expect(state.docs.get('items/box').stock).toBe(0);
});
