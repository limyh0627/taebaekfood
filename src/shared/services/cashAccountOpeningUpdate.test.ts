import { beforeEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { CashAccount, CashEntry } from '../types';
import { cashOpeningStatement, cashOpeningBalanceForCurrent } from '../cashOpening';
import { totalCashOnHand } from '../../features/admin/cashLedger';
const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), writes: [] as Array<{ path: string; patch: Record<string, unknown> }>, afterQuery: null as null | (() => void), claim: 'punghoe', admin: true }));
vi.mock('../firebase', () => ({ db: {}, authReady: Promise.resolve(), auth: { currentUser: { getIdTokenResult: async () => ({ claims: { companyId: state.claim, isAdmin: state.admin } }) } } }));
vi.mock('firebase/firestore', async importOriginal => {
 const actual = await importOriginal<typeof import('firebase/firestore')>();
 const snapshot = (ref: { path: string; id: string }) => ({ ref, id: ref.id, exists: () => state.rows.has(ref.path), data: () => state.rows.get(ref.path) });
 return { ...actual,
  doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}`, id }), collection: (_db: unknown, name: string) => name,
  where: (field: string, op: string, value: unknown) => ({ field, op, value }), query: (name: string, ...clauses: Array<{ field: string; value: unknown }>) => ({ name, clauses }),
  getDocs: async (query: { name: string; clauses: Array<{ field: string; value: unknown }> }) => {
   const docs = [...state.rows].filter(([path, row]) => path.startsWith(`${query.name}/`) && query.clauses.every(clause => row[clause.field] === clause.value)).map(([path]) => snapshot({ path, id: path.split('/')[1] }));
   state.afterQuery?.(); return { docs };
  },
  runTransaction: async (_db: unknown, run: (tx: unknown) => Promise<void>) => {
   const pending: typeof state.writes = [];
   await run({ get: async (ref: { path: string; id: string }) => { if (pending.length) throw new Error('read after write'); return snapshot(ref); }, update: (ref: { path: string }, patch: Record<string, unknown>) => pending.push({ path: ref.path, patch }), set: () => { throw new Error('unexpected create'); }, delete: () => { throw new Error('unexpected delete'); } });
   for (const row of pending) state.rows.set(row.path, { ...state.rows.get(row.path), ...row.patch }); state.writes.push(...pending);
  },
 };
});
const { updateCashAccountOpening, updateCashAccountOpeningWithDb } = await import('./cashAccountOpeningUpdate');
const store = {} as Firestore;
const account: CashAccount = { id: 'bank-main', companyId: 'punghoe', name: '농협', type: '통장', openingDate: '2026-07-31', openingBalance: 1000, active: true, createdAt: '2026-08-01T00:00:00Z' };
const accountPath = `cashAccounts/${account.id}`;
const voucherPath = `issuedStatements/opening-cash-punghoe-${account.id}`;
const cash = (id: string, date: string, dir: CashEntry['dir'], amount: number) => ({ id, companyId: 'punghoe', cashAccountId: account.id, date, dir, amount, accountCode: '601', createdAt: `${date}T00:00:00Z` } as CashEntry);
beforeEach(() => { state.rows.clear(); state.rows.set(accountPath, { ...account }); state.writes.length = 0; state.afterQuery = null; state.claim = 'punghoe'; state.admin = true; });
it('공용 저장 경로의 원본처럼 data.id가 없어도 같은 문서 주소를 수정한다', async () => {
 const { id: _id, ...stored } = account; state.rows.set(accountPath, stored);
 await updateCashAccountOpeningWithDb(store, 'punghoe', account, account.name, account.openingDate, 300, '2026-10-07');
 expect(state.rows.get(accountPath)?.openingBalance).toBe(300);
 expect(state.rows.get(accountPath)?.id).toBeUndefined();
 expect(state.writes[0].path).toBe(accountPath);
});
it('계좌 이름·기준일·현재잔액을 수정해도 ID와 과거 전표를 유지한다', async () => {
 state.rows.set('cashEntries/out', cash('out', '2026-09-01', '출금', 200) as unknown as Record<string, unknown>);
 await updateCashAccountOpeningWithDb(store, 'punghoe', account, ' 농협 메인 ', '2026-08-01', 500, '2026-10-07');
 expect(state.rows.get(accountPath)).toMatchObject({ id: account.id, name: '농협 메인', openingDate: '2026-08-01', openingBalance: 700, active: true, type: '통장' });
 expect(totalCashOnHand([state.rows.get(accountPath) as unknown as CashAccount], [cash('out', '2026-09-01', '출금', 200)], '2026-10-07')).toBe(500);
 expect(state.writes.map(row => row.path)).toEqual([accountPath]); expect(state.rows.has(voucherPath)).toBe(false);
});
it('기준일 전 거래·미래 거래·다른 회사와 대체 전표는 현재 잔액에서 제외한다', () => {
 const entries = [cash('before', '2026-07-01', '입금', 100), cash('future', '2026-11-01', '입금', 100), cash('transfer', '2026-09-01', '대체', 999), { ...cash('other', '2026-09-01', '입금', 100), companyId: 'taebaek' as const }, cash('in', '2026-09-01', '입금', 30)];
 expect(cashOpeningBalanceForCurrent(account, entries, '2026-08-01', 100, '2026-10-07')).toBe(70);
});
it('이미 읽은 거래가 변경되면 최신 거래 금액으로 잔액을 역산한다', async () => {
 state.rows.set('cashEntries/out', cash('out', '2026-09-01', '출금', 100) as unknown as Record<string, unknown>);
 state.afterQuery = () => state.rows.set('cashEntries/out', cash('out', '2026-09-01', '출금', 200) as unknown as Record<string, unknown>);
 await updateCashAccountOpeningWithDb(store, 'punghoe', account, account.name, '2026-08-01', 500, '2026-10-07');
 expect(state.rows.get(accountPath)?.openingBalance).toBe(700);
});
it('기초 전표는 원래 회계일·번호를 유지하고 그 회계일 기준 금액으로 동기한다', async () => {
 const voucher = cashOpeningStatement(account); state.rows.set(voucherPath, voucher as unknown as Record<string, unknown>);
 state.rows.set('cashEntries/old', cash('old', '2026-08-01', '출금', 200) as unknown as Record<string, unknown>);
 await updateCashAccountOpeningWithDb(store, 'punghoe', account, '새 통장명', '2026-09-01', 500, '2026-10-07');
 expect(state.rows.get(accountPath)?.openingBalance).toBe(500);
 expect(state.rows.get(voucherPath)).toMatchObject({ id: voucher.id, docNo: voucher.docNo, tradeDate: voucher.tradeDate, issuedAt: voucher.issuedAt, totalAmount: 700 });
 expect(state.writes).toHaveLength(2);
});
it.each([0, -500])('%i원 잔액도 전표를 삭제하지 않고 올바른 차대로 동기한다', async amount => {
 state.rows.set(voucherPath, cashOpeningStatement(account) as unknown as Record<string, unknown>);
 await updateCashAccountOpeningWithDb(store, 'punghoe', account, account.name, account.openingDate, amount, '2026-10-07');
 const voucher = state.rows.get(voucherPath)!;
 expect(voucher.totalAmount).toBe(Math.abs(amount));
 expect((voucher.items as Array<{ side: string }>).map(line => line.side)).toEqual(amount < 0 ? ['대변', '차변'] : ['차변', '대변']);
 expect(state.rows.get(accountPath)?.openingBalance).toBe(amount);
});
it('카드의 음수 잔액도 보조원장에 그대로 반영한다', async () => {
 const card = { ...account, type: '카드' as const, openingBalance: 0 }; state.rows.set(accountPath, card);
 await updateCashAccountOpeningWithDb(store, 'punghoe', card, card.name, card.openingDate, -300, '2026-10-07');
 expect(state.rows.get(accountPath)?.openingBalance).toBe(-300); expect(state.writes).toHaveLength(1);
});
it.each(['companyId', 'name', 'openingBalance', 'openingDate', 'active'])('계좌 %s 동시변경은 덮어쓰지 않는다', async key => {
 state.rows.set(accountPath, { ...account, [key]: 'changed' });
 await expect(updateCashAccountOpeningWithDb(store, 'punghoe', account, account.name, account.openingDate, 100, '2026-10-07')).rejects.toThrow('변경');
 expect(state.writes).toHaveLength(0);
});
it('잘못된 연결 기초 전표는 계약과 함께 저장하지 않는다', async () => {
 state.rows.set(voucherPath, { ...cashOpeningStatement(account), totalAmount: 999 });
 await expect(updateCashAccountOpeningWithDb(store, 'punghoe', account, account.name, account.openingDate, 100, '2026-10-07')).rejects.toThrow('기초 전표');
 expect(state.writes).toHaveLength(0);
});
it('잘못된 날짜·소수 잔액·다른 회사 및 직원 권한은 저장하지 않는다', async () => {
 await expect(updateCashAccountOpeningWithDb(store, 'punghoe', account, account.name, '2026-02-30', 100, '2026-10-07')).rejects.toThrow();
 await expect(updateCashAccountOpeningWithDb(store, 'punghoe', account, account.name, account.openingDate, 100.1, '2026-10-07')).rejects.toThrow();
 state.claim = 'taebaek'; await expect(updateCashAccountOpening('punghoe', account, account.name, account.openingDate, 100)).rejects.toThrow('관리자');
 state.claim = 'punghoe'; state.admin = false; await expect(updateCashAccountOpening('punghoe', account, account.name, account.openingDate, 100)).rejects.toThrow('관리자');
 expect(state.writes).toHaveLength(0);
});

it('화면을 연 뒤 추가된 확정 기준점은 최신 transaction 계좌로 검사하여 기초와 전표를 모두 보존한다', async () => {
  for (const linked of [false, true]) {
    state.rows.set(accountPath, { ...account }); state.writes.length = 0;
    if (linked) state.rows.set(voucherPath, cashOpeningStatement(account) as unknown as Record<string, unknown>);
    else state.rows.delete(voucherPath);
    state.afterQuery = () => state.rows.set(accountPath, { ...account, confirmedBalances: [{ date: '2026-08-31', balance: 500, recordedAt: '2026-10-07T11:00:00Z', reason: '동시 통장 확인' }] });
    await expect(updateCashAccountOpeningWithDb(store, 'punghoe', account, account.name,
      linked ? '2026-09-01' : '2026-08-01', 700, '2026-10-07')).rejects.toThrow('확정 잔액 기준점');
    expect(state.writes).toHaveLength(0); expect(state.rows.get(accountPath)?.openingBalance).toBe(account.openingBalance);
    if (linked) expect(state.rows.get(voucherPath)?.totalAmount).toBe(account.openingBalance);
  }
});
