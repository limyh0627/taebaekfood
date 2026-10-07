import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import type { CashAccount, CashEntry } from '../types';
import type { LoanContract } from '../loanLedger';
import { cashOpeningStatement } from '../cashOpening';
import { loanOpeningStatement } from '../loanOpening';
vi.mock('../firebase', () => ({ db: null, auth: { currentUser: null }, authReady: Promise.resolve() }));
const { updateCashAccountOpeningWithDb } = await import('./cashAccountOpeningUpdate');
const { updateLoanOpeningWithDb } = await import('./firebaseService');
let env: RulesTestEnvironment;
const ready = await fetch('http://127.0.0.1:8082/', { signal: AbortSignal.timeout(1500) }).then(response => response.status < 500).catch(() => false);
describe.skipIf(!ready)('계좌·대출 수정 실제 Firestore 저장', () => {
beforeAll(async () => {
 env = await initializeTestEnvironment({ projectId: 'demo-financial-opening-edit', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8082 } });
 await env.clearFirestore();
}, 30000);
afterAll(async () => { await env?.cleanup(); });
const store = (companyId = 'punghoe', isAdmin = true) => env.authenticatedContext(`${companyId}-${isAdmin}`, { employeeId: 'editor', companyId, isAdmin }).firestore() as unknown as Firestore;
const account = (id: string): CashAccount => ({ id, companyId: 'punghoe', name: '농협', type: '통장', openingDate: '2026-07-31', openingBalance: 1000, active: true, createdAt: '2026-08-01T00:00:00Z' });
const loan = (id: string): LoanContract => ({ id, companyId: 'punghoe', name: '중진공', lenderName: '중진공', accountCode: '293', openingDate: '2026-07-31', openingPrincipal: 1000, createdAt: '2026-08-01T00:00:00Z' });
async function seed(rows: Array<[string, unknown]>) {
 await env.withSecurityRulesDisabled(async context => { for (const [path, value] of rows) await setDoc(doc(context.firestore(), path), value as Record<string, unknown>); });
}
it('실제 관리자 SDK로 전표 없는 기존 계좌와 대출의 날짜·잔액을 수정한다', async () => {
 const bank = account('legacy-bank'), contract = loan('legacy-loan');
 const { id: _bankId, ...storedBank } = bank;
 const { id: _loanId, ...storedLoan } = contract;
 await seed([[`cashAccounts/${bank.id}`, storedBank], [`loanContracts/${contract.id}`, storedLoan]]);
 await updateCashAccountOpeningWithDb(store(), 'punghoe', bank, '농협 메인', '2026-09-01', -500, '2026-10-07');
 await updateLoanOpeningWithDb(store(), 'punghoe', contract, '2026-09-01', 500);
 expect((await getDoc(doc(store(), 'cashAccounts', bank.id))).data()).toMatchObject({ name: '농협 메인', openingDate: '2026-09-01', openingBalance: -500 });
 expect((await getDoc(doc(store(), 'loanContracts', contract.id))).data()).toMatchObject({ openingDate: '2026-09-01', openingPrincipal: 500 });
 expect((await getDoc(doc(store(), 'issuedStatements', `opening-cash-punghoe-${bank.id}`))).exists()).toBe(false);
 expect((await getDoc(doc(store(), 'issuedStatements', `opening-loan-punghoe-${contract.id}`))).exists()).toBe(false);
});
it('실제 거래와 기초 전표가 있는 계좌를 같은 transaction으로 맞춘다', async () => {
 const bank = account('linked-bank');
 const entry = (id: string, date: string, dir: CashEntry['dir'], amount: number) => ({ id, companyId: 'punghoe', cashAccountId: bank.id, date, dir, amount, accountCode: '601', createdAt: `${date}T00:00:00Z` });
 await seed([[`cashAccounts/${bank.id}`, bank], [`issuedStatements/opening-cash-punghoe-${bank.id}`, cashOpeningStatement(bank)], ['cashEntries/bank-old', entry('bank-old', '2026-08-01', '출금', 200)], ['cashEntries/bank-new', entry('bank-new', '2026-09-01', '입금', 100)]]);
 await updateCashAccountOpeningWithDb(store(), 'punghoe', bank, '새 계좌명', '2026-08-10', 500, '2026-10-07');
 expect((await getDoc(doc(store(), 'cashAccounts', bank.id))).data()?.openingBalance).toBe(400);
 expect((await getDoc(doc(store(), 'issuedStatements', `opening-cash-punghoe-${bank.id}`))).data()).toMatchObject({ tradeDate: '2026-07-31', totalAmount: 600, docNo: `기초계좌-${bank.id}` });
});
it('대출 기초 전표와 서버 원금 버전을 함께 갱신한다', async () => {
 const contract = { ...loan('linked-loan'), movementRevision: 2, principalBalance: 700 };
 const entry = (id: string, date: string, amount: number) => ({ id, companyId: 'punghoe', loanId: contract.id, date, dir: '출금', amount, accountCode: '293', createdAt: `${date}T00:00:00Z` });
 await seed([[`loanContracts/${contract.id}`, contract], [`issuedStatements/opening-loan-punghoe-${contract.id}`, loanOpeningStatement(contract)], ['cashEntries/loan-old', entry('loan-old', '2026-08-01', 200)], ['cashEntries/loan-new', entry('loan-new', '2026-09-01', 100)]]);
 await updateLoanOpeningWithDb(store(), 'punghoe', contract, '2026-08-10', 500);
 expect((await getDoc(doc(store(), 'loanContracts', contract.id))).data()).toMatchObject({ openingPrincipal: 600, principalBalance: 500, movementRevision: 3 });
 expect((await getDoc(doc(store(), 'issuedStatements', `opening-loan-punghoe-${contract.id}`))).data()).toMatchObject({ tradeDate: '2026-07-31', totalAmount: 800 });
 await expect(updateLoanOpeningWithDb(store(), 'punghoe', contract, '2026-08-10', 400)).rejects.toThrow('변경');
 expect((await getDoc(doc(store(), 'loanContracts', contract.id))).data()?.principalBalance).toBe(500);
});
it('직원 또는 다른 회사 관리자에게 수정 권한이 없고 원본도 보존된다', async () => {
 const bank = account('protected-bank'), contract = loan('protected-loan');
 await seed([[`cashAccounts/${bank.id}`, bank], [`loanContracts/${contract.id}`, contract]]);
 await expect(updateCashAccountOpeningWithDb(store('punghoe', false), 'punghoe', bank, bank.name, bank.openingDate, 1)).rejects.toThrow();
 await expect(updateLoanOpeningWithDb(store('taebaek'), 'punghoe', contract, contract.openingDate, 1)).rejects.toThrow();
 expect((await getDoc(doc(store(), 'cashAccounts', bank.id))).data()?.openingBalance).toBe(1000);
 expect((await getDoc(doc(store(), 'loanContracts', contract.id))).data()?.openingPrincipal).toBe(1000);
});
});
