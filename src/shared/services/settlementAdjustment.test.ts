import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ cash: null as null | Record<string, unknown>, writes: [] as unknown[] }));
vi.mock('../firebase', () => ({ db: {}, functions: {}, authReady: Promise.resolve(), auth: { currentUser: { getIdTokenResult: async () => ({ claims: { companyId: 'punghoe' } }) } } }));
vi.mock('firebase/firestore', async original => ({ ...await original<typeof import('firebase/firestore')>(),
  doc: (_db: unknown, collection: string, id: string) => ({ id, path: `${collection}/${id}` }),
  runTransaction: async (_db: unknown, run: (tx: unknown) => Promise<unknown>) => run({
    get: async () => ({ exists: () => !!state.cash, data: () => state.cash }),
    set: (_ref: unknown, data: unknown) => state.writes.push(data),
  }),
}));
const { addItem } = await import('./firebaseService');
beforeEach(() => { state.cash = { companyId: 'punghoe' }; state.writes = []; });
const settlement = { id: 'match-1', companyId: 'punghoe', cashEntryId: 'cash-1', statementId: 'sale-1', amount: 100 };
it('잔액 조정을 거래처 전표에 연결하지 않는다', async () => {
  state.cash = { companyId: 'punghoe', balanceAdjustment: { delta: 100 } };
  await expect(addItem('settlements', settlement)).rejects.toThrow('잔액 조정');
  expect(state.writes).toEqual([]);
});
it('일반 자금 내역은 기존 회사 경계로 연결한다', async () => {
  await expect(addItem('settlements', settlement)).resolves.toBe('match-1');
  expect(state.writes).toEqual([expect.objectContaining({ cashEntryId: 'cash-1', companyId: 'punghoe' })]);
});
it('없는 자금 내역과 다른 회사 자금은 연결하지 않는다', async () => {
  for (const cash of [null, { companyId: 'taebaek' }]) {
    state.cash = cash;
    await expect(addItem('settlements', settlement)).rejects.toThrow('자금 내역');
  }
  expect(state.writes).toEqual([]);
});
