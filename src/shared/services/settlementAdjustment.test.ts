import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ cash: null as null | Record<string, unknown>, statement: { companyId: 'punghoe', partnerId: 'p1' } as null | Record<string, unknown>, paymentState: null as null | Record<string, unknown>, writes: [] as unknown[] }));
vi.mock('../firebase', () => ({ db: {}, functions: {}, authReady: Promise.resolve(), auth: { currentUser: { getIdTokenResult: async () => ({ claims: { companyId: 'punghoe' } }) } } }));
vi.mock('firebase/firestore', async original => ({ ...await original<typeof import('firebase/firestore')>(),
  doc: (_db: unknown, collection: string, id: string) => ({ id, path: `${collection}/${id}` }),
  runTransaction: async (_db: unknown, run: (tx: unknown) => Promise<unknown>) => run({
    get: async (ref: { path: string }) => { const value = ref.path.startsWith('appMeta/') ? state.paymentState : ref.path.startsWith('issuedStatements/') ? state.statement : state.cash; return { exists: () => !!value, data: () => value }; },
    set: (_ref: unknown, data: unknown) => state.writes.push(data), update: (_ref: unknown, data: unknown) => state.writes.push(data),
  }),
}));
const { addItem } = await import('./firebaseService');
beforeEach(() => { state.cash = { companyId: 'punghoe' }; state.statement = { companyId: 'punghoe', partnerId: 'p1' }; state.writes = []; state.paymentState = null; });
const settlement = { id: 'match-1', companyId: 'punghoe', cashEntryId: 'cash-1', statementId: 'sale-1', amount: 100 };
it('잔액 조정을 거래처 전표에 연결하지 않는다', async () => {
  state.cash = { companyId: 'punghoe', balanceAdjustment: { delta: 100 } };
  await expect(addItem('settlements', settlement)).rejects.toThrow('잔액 조정');
  expect(state.writes).toEqual([]);
});
it('일반 자금 내역은 기존 회사 경계로 연결한다', async () => {
  await expect(addItem('settlements', settlement)).resolves.toBe('match-1');
  expect(state.writes).toEqual([expect.objectContaining({ companyId: 'punghoe', partnerId: 'p1', revision: 1 }), expect.objectContaining({ cashEntryId: 'cash-1', companyId: 'punghoe' })]);
});
it('없는 자금 내역과 다른 회사 자금은 연결하지 않는다', async () => {
  for (const cash of [null, { companyId: 'taebaek' }]) {
    state.cash = cash;
    await expect(addItem('settlements', settlement)).rejects.toThrow('자금 내역');
  }
  expect(state.writes).toEqual([]);
});
it('없는 전표나 다른 회사 전표에는 정산을 새로 만들지 않는다', async () => {
  for (const statement of [null, { companyId: 'taebaek' }]) {
    state.statement = statement;
    await expect(addItem('settlements', settlement)).rejects.toThrow('전표');
  }
  expect(state.writes).toEqual([]);
});
it('기존 정산 revision을 올리며 기존 메타 필드 전체를 덮지 않는다', async () => {
  state.paymentState = { companyId: 'punghoe', partnerId: 'p1', revision: 7, note: '유지' };
  await addItem('settlements', settlement);
  expect(state.writes[0]).toEqual({ revision: 8 });
});
it('거래처 없는 전표와 잘못된 정산 회사·revision은 연결하지 않는다', async () => {
  state.statement = { companyId: 'punghoe' };
  await expect(addItem('settlements', settlement)).rejects.toThrow('거래처');
  state.statement = { companyId: 'punghoe', partnerId: 'p1' };
  for (const paymentState of [{ companyId: 'taebaek', partnerId: 'p1', revision: 0 }, { companyId: 'punghoe', partnerId: 'p1', revision: -1 }]) {
    state.paymentState = paymentState;
    await expect(addItem('settlements', settlement)).rejects.toThrow();
  }
  expect(state.writes).toEqual([]);
});
