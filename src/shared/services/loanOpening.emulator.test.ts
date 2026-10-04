import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import type { LoanContract } from '../loanLedger';

vi.mock('../firebase', () => ({ db: null, auth: { currentUser: null }, authReady: Promise.resolve() }));
const { createLoanWithOpeningWithDb, saveOpeningBalancesWithDb } = await import('./firebaseService');
const ready = await fetch('http://127.0.0.1:8082/', { signal: AbortSignal.timeout(1500) }).then(r => r.status < 500).catch(() => false);
let env: RulesTestEnvironment;
const loan = (id: string, amount = 1_000_000): LoanContract => ({
  id, companyId: 'punghoe', name: '운전자금', lenderName: '은행', accountCode: '293',
  openingDate: '2026-07-31', openingPrincipal: amount, createdAt: '2026-08-01T00:00:00+09:00',
});

describe.skipIf(!ready)('대출 시작 원금 (Firestore Emulator)', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-loan-opening', firestore: {
      rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8082,
    } });
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
      const store = ctx.firestore();
      await setDoc(doc(store, 'openingBalances', 'main-punghoe'), { companyId: 'punghoe', date: '2026-07-31', amounts: {} });
      await setDoc(doc(store, 'partners', 'foreign'), { companyId: 'taebaek', name: '다른 회사 은행' });
    });
  }, 20_000);
  afterAll(async () => { await env?.cleanup(); });
  const store = () => env.authenticatedContext('loan-admin', { employeeId: 'admin', companyId: 'punghoe', isAdmin: true }).firestore() as unknown as Firestore;

  it('계약과 기초 전표를 함께 저장하고 동일 요청만 멱등 성공한다', async () => {
    const row = loan('opening-1');
    expect(await createLoanWithOpeningWithDb(store(), 'punghoe', row)).toBe('created');
    expect(await createLoanWithOpeningWithDb(store(), 'punghoe', row)).toBe('unchanged');
    await expect(createLoanWithOpeningWithDb(store(), 'punghoe', { ...row, openingPrincipal: 2_000_000 })).rejects.toThrow('다른 내용');
    expect((await getDoc(doc(store(), 'loanContracts', row.id))).data()?.openingPrincipal).toBe(1_000_000);
    expect((await getDoc(doc(store(), 'issuedStatements', `opening-loan-punghoe-${row.id}`))).data()?.totalAmount).toBe(1_000_000);
    expect((await getDoc(doc(store(), 'openingBalances', 'main-punghoe'))).data()?.hasLoanOpening).toBe(true);
    expect(await createLoanWithOpeningWithDb(store(), 'punghoe', loan('opening-2', 500_000))).toBe('created');
    expect((await getDoc(doc(store(), 'issuedStatements', 'opening-loan-punghoe-opening-2'))).data()?.totalAmount).toBe(500_000);
  });
  it('연결된 대출이 있으면 기초일과 대출 계정 합계를 바꾸지 못한다', async () => {
    await expect(saveOpeningBalancesWithDb(store(), 'punghoe', '2026-08-01', {})).rejects.toThrow('기준일');
    await expect(saveOpeningBalancesWithDb(store(), 'punghoe', '2026-07-31', { '293': 1_000_000 })).rejects.toThrow('직접 변경');
  });
  it('기초일 불일치·다른 회사 금융기관을 거절한다', async () => {
    await expect(createLoanWithOpeningWithDb(store(), 'punghoe', { ...loan('wrong-date'), openingDate: '2026-08-01' })).rejects.toThrow('회계 기초잔액');
    await expect(createLoanWithOpeningWithDb(store(), 'punghoe', { ...loan('foreign'), partnerId: 'foreign' })).rejects.toThrow('PERMISSION_DENIED');
    expect((await getDoc(doc(store(), 'loanContracts', 'wrong-date'))).exists()).toBe(false);
  });
  it('신규 차입용 시작 원금 0원은 계약만 저장한다', async () => {
    expect(await createLoanWithOpeningWithDb(store(), 'punghoe', loan('new-borrowing', 0))).toBe('created');
    expect((await getDoc(doc(store(), 'issuedStatements', 'opening-loan-punghoe-new-borrowing'))).exists()).toBe(false);
  });
});
