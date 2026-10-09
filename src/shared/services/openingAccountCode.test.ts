import { beforeEach, expect, it, vi } from 'vitest';
import type { AccountCode } from '../types';
const mocks = vi.hoisted(() => ({ original: undefined as Record<string, unknown> | undefined, set: vi.fn(), token: vi.fn() }));
vi.mock('../firebase', () => ({ db: {}, functions: {}, authReady: Promise.resolve(), auth: { currentUser: { getIdTokenResult: mocks.token } } }));
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  runTransaction: async (_db: unknown, run: (tx: unknown) => unknown) => run({
    get: async () => ({ exists: () => mocks.original !== undefined, data: () => mocks.original }), set: mocks.set,
  }),
}));
const { createOpeningAccountCodeWithDb, createOpeningAccountCode } = await import('./firebaseService');
const account: AccountCode = { id: 'opening-account-punghoe-122', code: '122', name: '비품', type: '자산', normalBalance: 'debit' };
const store = {} as import('firebase/firestore').Firestore;
beforeEach(() => { vi.clearAllMocks(); mocks.original = undefined; mocks.token.mockResolvedValue({ claims: { companyId: 'punghoe' } }); });
it('명시 계정만 생성하고 동일 원문은 덮어쓰지 않는다', async () => {
  expect(await createOpeningAccountCodeWithDb(store, 'punghoe', account)).toBe('created');
  expect(mocks.set).toHaveBeenCalledWith({ collection: 'accountCodes', id: account.id }, { ...account, companyId: 'punghoe' });
  mocks.original = { ...account, companyId: 'punghoe', auditNote: '보존' }; mocks.set.mockClear();
  expect(await createOpeningAccountCodeWithDb(store, 'punghoe', account)).toBe('unchanged');
  expect(mocks.set).not.toHaveBeenCalled();
});
it('내용·회사 충돌을 거절한다', async () => {
  for (const original of [{ ...account, companyId: 'taebaek' }, { ...account, companyId: 'punghoe', name: '변경' }]) {
    mocks.original = original;
    await expect(createOpeningAccountCodeWithDb(store, 'punghoe', account)).rejects.toThrow('다른 회사 또는 내용');
  }
  expect(mocks.set).not.toHaveBeenCalled();
});
it('미분류·손익 계정·공백·잘못된 ID는 쓰기 전에 거절한다', async () => {
  for (const patch of [{ type: undefined }, { type: '비용' as const }, { normalBalance: undefined }, { code: ' 122' }, { name: ' ' }, { id: '122' }, { code: '331', id: 'opening-account-punghoe-331' }]) {
    await expect(createOpeningAccountCodeWithDb(store, 'punghoe', { ...account, ...patch })).rejects.toThrow('정보');
  }
  expect(mocks.set).not.toHaveBeenCalled();
});
it('공개 저장은 화면 회사가 아니라 실제 claim 회사와 일치해야 한다', async () => {
  await createOpeningAccountCode('punghoe', account);
  mocks.set.mockClear(); mocks.token.mockResolvedValue({ claims: { companyId: 'taebaek' } });
  await expect(createOpeningAccountCode('punghoe', account)).rejects.toThrow();
  expect(mocks.set).not.toHaveBeenCalled();
});
