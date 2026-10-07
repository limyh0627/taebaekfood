import { beforeEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { CashEntry } from '../types';
import type { LoanContract } from '../loanLedger';
import { loanOpeningStatement } from '../loanOpening';

const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), writes: [] as Array<{ path: string; patch: Record<string, unknown> }>, afterQuery: null as null | (() => void), claim: 'punghoe', queries: [] as unknown[] }));
vi.mock('../firebase', () => ({ db: {}, functions: {}, authReady: Promise.resolve(), auth: { currentUser: { getIdTokenResult: async () => ({ claims: { companyId: state.claim } }) } } }));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  const snapshot = (ref: { path: string; id: string }) => ({ ref, id: ref.id, exists: () => state.rows.has(ref.path), data: () => state.rows.get(ref.path) });
  return { ...actual,
    doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}`, id }),
    collection: (_db: unknown, name: string) => name,
    where: (field: string, op: string, value: unknown) => ({ field, op, value }),
    query: (name: string, ...clauses: Array<{ field: string; value: unknown }>) => ({ name, clauses }),
    getDocs: async (query: { name: string; clauses: Array<{ field: string; value: unknown }> }) => {
      state.queries.push(query);
      const docs = [...state.rows].filter(([path, row]) => path.startsWith(`${query.name}/`) && query.clauses.every(clause => row[clause.field] === clause.value))
        .map(([path]) => snapshot({ path, id: path.split('/')[1] }));
      state.afterQuery?.();
      return { docs };
    },
    runTransaction: async (_db: unknown, run: (tx: unknown) => Promise<unknown>) => {
      const pending: typeof state.writes = [];
      const result = await run({
        get: async (ref: { path: string; id: string }) => { if (pending.length) throw new Error('write before read'); return snapshot(ref); },
        update: (ref: { path: string }, patch: Record<string, unknown>) => pending.push({ path: ref.path, patch }),
        set: () => { throw new Error('new documents prohibited'); }, delete: () => { throw new Error('delete prohibited'); },
      });
      for (const write of pending) state.rows.set(write.path, { ...state.rows.get(write.path), ...write.patch });
      state.writes.push(...pending);
      return result;
    },
  };
});
const { updateLoanOpening, updateLoanOpeningWithDb } = await import('./firebaseService');
const store = {} as Firestore;
const loan: LoanContract = { id: 'loan-test', companyId: 'punghoe', name: '운전자금', lenderName: '은행', accountCode: '293', openingDate: '2026-07-31', openingPrincipal: 100_000_000, createdAt: '2026-08-01T00:00:00Z' };
const path = `loanContracts/${loan.id}`;
const voucherPath = `issuedStatements/opening-loan-punghoe-${loan.id}`;
const cash = (id: string, date: string, amount: number): CashEntry => ({ id, companyId: 'punghoe', loanId: loan.id, cashAccountId: 'bank-test', date, dir: '출금', amount, accountCode: '293', createdAt: `${date}T00:00:00Z` });
beforeEach(() => { state.rows.clear(); state.rows.set(path, { ...loan }); state.writes.length = 0; state.queries.length = 0; state.afterQuery = null; state.claim = 'punghoe'; });

it('전표 없는 옛 계약은 시작일과 원금만 고치며 회계 문서를 생성하지 않는다', async () => {
  await updateLoanOpeningWithDb(store, 'punghoe', loan, '2026-08-10', 70_000_000);
  expect(state.rows.get(path)).toMatchObject({ openingDate: '2026-08-10', openingPrincipal: 70_000_000 });
  expect(state.writes.map(row => row.path)).toEqual([path]);
  expect(state.rows.has(voucherPath)).toBe(false);
});

it('공용 addItem처럼 본문에 id를 저장하지 않은 옛 계약도 문서 주소로 확인하여 정정한다', async () => {
  const { id: _id, ...data } = loan;
  state.rows.set(path, data);
  await updateLoanOpeningWithDb(store, 'punghoe', loan, '2026-08-10', 70_000_000);
  expect(state.rows.get(path)).toMatchObject({ openingDate: '2026-08-10', openingPrincipal: 70_000_000 });
  expect(state.rows.get(path)).not.toHaveProperty('id');
  expect(state.writes.map(row => row.path)).toEqual([path]);
});

it('연결 전표를 transaction에서 다시 읽어 최신 원금 상환을 역산한다', async () => {
  state.rows.set('cashEntries/pay', cash('pay', '2026-08-15', 10_000_000) as unknown as Record<string, unknown>);
  state.afterQuery = () => state.rows.set('cashEntries/pay', cash('pay', '2026-08-15', 20_000_000) as unknown as Record<string, unknown>);
  await updateLoanOpeningWithDb(store, 'punghoe', loan, '2026-08-01', 70_000_000);
  expect(state.rows.get(path)?.openingPrincipal).toBe(90_000_000);
});

it('기존 기초 전표는 원래 회계일·번호·정체성을 보존하고 그 날짜부터 원금 delta를 반영한다', async () => {
  const voucher = loanOpeningStatement(loan);
  state.rows.set(voucherPath, voucher as unknown as Record<string, unknown>);
  state.rows.set('cashEntries/old', cash('old', '2026-08-01', 10_000_000) as unknown as Record<string, unknown>);
  state.rows.set('cashEntries/new', cash('new', '2026-09-01', 20_000_000) as unknown as Record<string, unknown>);
  await updateLoanOpeningWithDb(store, 'punghoe', loan, '2026-08-10', 70_000_000);
  expect(state.rows.get(path)?.openingPrincipal).toBe(90_000_000);
  expect(state.rows.get(voucherPath)).toMatchObject({ id: voucher.id, docNo: voucher.docNo, issuedAt: voucher.issuedAt, tradeDate: voucher.tradeDate, totalAmount: 100_000_000, totalSupply: 100_000_000 });
});

it('0원으로 정정해도 기존 기초 전표를 지우지 않고 양측 금액을 동기한다', async () => {
  state.rows.set(voucherPath, loanOpeningStatement(loan) as unknown as Record<string, unknown>);
  await updateLoanOpeningWithDb(store, 'punghoe', loan, '2026-08-10', 0);
  expect(state.rows.get(voucherPath)?.totalAmount).toBe(0);
  expect((state.rows.get(voucherPath)?.items as Array<{ supply: number }>).map(row => row.supply)).toEqual([0, 0]);
});

it('server revision 계약은 잔액과 revision을 함께 갱신하고 옛 revision을 거절한다', async () => {
  const original = { ...loan, movementRevision: 2, principalBalance: 100_000_000 };
  state.rows.set(path, original);
  await updateLoanOpeningWithDb(store, 'punghoe', original, '2026-08-10', 70_000_000);
  expect(state.rows.get(path)).toMatchObject({ movementRevision: 3, principalBalance: 70_000_000 });
  await expect(updateLoanOpeningWithDb(store, 'punghoe', original, '2026-08-10', 60_000_000)).rejects.toThrow('변경');
  expect(state.writes).toHaveLength(1);
});

it('revision 없이 현재잔액 필드만 있는 계약도 잔액 캐시를 동기한다', async () => {
  const original = { ...loan, principalBalance: 100_000_000 };
  state.rows.set(path, original);
  await updateLoanOpeningWithDb(store, 'punghoe', original, '2026-08-10', 70_000_000);
  expect(state.rows.get(path)?.principalBalance).toBe(70_000_000);
  expect(state.rows.get(path)).not.toHaveProperty('movementRevision');
});

it.each(['companyId', 'name', 'accountCode', 'openingDate', 'openingPrincipal'])('최신 계약 %s 변경을 덮어쓰지 않는다', async field => {
  state.rows.set(path, { ...loan, [field]: 'changed' });
  await expect(updateLoanOpeningWithDb(store, 'punghoe', loan, '2026-08-10', 70_000_000)).rejects.toThrow('변경');
  expect(state.writes).toHaveLength(0);
});

it('동일 ID에 일반 전표나 잘못된 총합이 있으면 계약도 변경하지 않는다', async () => {
  state.rows.set(voucherPath, { ...loanOpeningStatement(loan), totalAmount: 1 });
  await expect(updateLoanOpeningWithDb(store, 'punghoe', loan, '2026-08-10', 70_000_000)).rejects.toThrow('기초 전표');
  expect(state.writes).toHaveLength(0);
});

it('잘못된 날짜·소수 잔액 및 다른 로그인 회사는 조회·쓰기 전에 거절한다', async () => {
  await expect(updateLoanOpeningWithDb(store, 'punghoe', loan, '2026-02-30', 1)).rejects.toThrow();
  await expect(updateLoanOpeningWithDb(store, 'punghoe', loan, '2026-08-10', 1.1)).rejects.toThrow();
  state.claim = 'taebaek';
  await expect(updateLoanOpening('punghoe', loan, '2026-08-10', 1)).rejects.toThrow('다른 회사');
  expect(state.queries).toHaveLength(0);
  expect(state.writes).toHaveLength(0);
});
