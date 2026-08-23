import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * **재고는 DB에서 읽어 더한다.**
 *
 * `updateItem(col, id, { stock: 화면값 + delta })`는 클릭 순간의 React 상태에 더해 **덮어쓴다.**
 * 구독이 실시간이어도 소용없다 — 이미 출발한 실행 안의 변수는 안 바뀌고,
 * 자기가 방금 쓴 값도 Firestore 왕복 전엔 안 돌아온다.
 * 2026-08 완제품 22건이 음수로 간 경로가 이것이다(입고 7군데가 전부 이 꼴이었다).
 */
const dbx = vi.hoisted(() => ({ stock: new Map<string, number>(), reads: 0 }));
vi.mock('./firebase', () => ({ db: {}, storage: {}, auth: {}, authReady: Promise.resolve() }));
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), onSnapshot: () => () => {}, addDoc: async () => ({ id: 'x' }),
  updateDoc: async () => {}, deleteDoc: async () => {}, setDoc: async () => {},
  query: () => ({}), where: () => ({}), getDocs: async () => ({ docs: [] }),
  writeBatch: () => ({ set: () => {}, update: () => {}, commit: async () => {} }),
  getDoc: async () => ({ exists: () => false }),
  orderBy: () => ({}), limit: () => ({}), startAfter: () => ({}), documentId: () => 'id',
  doc: (_db: unknown, col?: string, id?: string) => ({ col, id }),
  runTransaction: async (_db: unknown, fn: (tx: any) => Promise<unknown>) => fn({
    get: async (ref: any) => { dbx.reads++; return { exists: () => dbx.stock.has(ref.id), data: () => ({ stock: dbx.stock.get(ref.id) }) }; },
    update: (ref: any, data: any) => { if (data.stock !== undefined) dbx.stock.set(ref.id, data.stock); },
  }),
}));

const { adjustItemStock } = await import('./services/firebaseService');

beforeEach(() => { dbx.stock.clear(); dbx.reads = 0; });

describe('adjustItemStock — 화면값이 낡아도 안 덮어쓴다', () => {
  it('연달아 더하면 전부 쌓인다 (화면값 + delta였다면 마지막 하나만 남았다)', async () => {
    dbx.stock.set('box', 10);
    // 화면값은 10에서 안 변한다 — 옛 코드는 셋 다 stock:10+n 으로 덮어썼다
    await adjustItemStock('items', 'box', 5);
    await adjustItemStock('items', 'box', 3);
    await adjustItemStock('items', 'box', 2);
    expect(dbx.stock.get('box')).toBe(20);   // 옛 코드였다면 12 (마지막 것만)
  });

  it('빼기도 누적된다 — 재고가 음수로 새지 않는다', async () => {
    dbx.stock.set('bottle', 100);
    await Promise.all([-30, -30, -30].map(d => adjustItemStock('items', 'bottle', d)));
    expect(dbx.stock.get('bottle')).toBe(10);  // 옛 코드였다면 70
  });

  it('반환값은 반영 뒤 재고', async () => {
    dbx.stock.set('a', 7);
    expect(await adjustItemStock('items', 'a', 3)).toBe(10);
  });

  it('delta 0이면 DB를 읽지도 않는다', async () => {
    dbx.stock.set('a', 7);
    expect(await adjustItemStock('items', 'a', 0)).toBeNull();
    expect(dbx.reads).toBe(0);
  });

  it('없는 문서는 null — 새로 만들지 않는다', async () => {
    expect(await adjustItemStock('items', '없음', 5)).toBeNull();
    expect(dbx.stock.has('없음')).toBe(false);
  });

  it('소수점 셋째 자리까지 — 0.1을 세 번 더해도 0.30000000000000004가 안 된다', async () => {
    dbx.stock.set('oil', 0);
    for (let i = 0; i < 3; i++) await adjustItemStock('items', 'oil', 0.1);
    expect(dbx.stock.get('oil')).toBe(0.3);
  });
});
