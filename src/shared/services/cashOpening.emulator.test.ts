import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import type { CashAccount } from '../types';

vi.mock('../firebase', () => ({ db: null, auth: { currentUser: null }, authReady: Promise.resolve() }));
const { createCashAccountWithOpeningWithDb, saveOpeningBalancesWithDb } = await import('./firebaseService');
const ready = await fetch('http://127.0.0.1:8082/', { signal: AbortSignal.timeout(1500) }).then(r => r.status < 500).catch(() => false);
let env: RulesTestEnvironment;
const account = (id: string, type: CashAccount['type'] = '통장', amount = 100_000): CashAccount => ({
  id, companyId: 'punghoe', name: id, type, openingDate: '2026-07-31',
  openingBalance: amount, active: true, createdAt: '2026-08-01T00:00:00+09:00',
});

describe.skipIf(!ready)('계좌 기초잔액 (Firestore Emulator)', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-cash-opening', firestore: {
      rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8082,
    } });
  }, 20_000);
  beforeEach(async () => { await env.clearFirestore(); });
  afterAll(async () => { await env?.cleanup(); });
  const store = () => env.authenticatedContext('cash-admin', { employeeId: 'admin', companyId: 'punghoe', isAdmin: true }).firestore() as unknown as Firestore;

  it('첫 계좌와 회계 기초일·전표를 함께 만들고 재시도는 중복되지 않는다', async () => {
    const row = account('bank1');
    expect(await createCashAccountWithOpeningWithDb(store(), 'punghoe', row)).toBe('created');
    expect(await createCashAccountWithOpeningWithDb(store(), 'punghoe', row)).toBe('unchanged');
    await expect(createCashAccountWithOpeningWithDb(store(), 'punghoe', { ...row, openingBalance: 200_000 })).rejects.toThrow('다른 내용');
    expect((await getDoc(doc(store(), 'cashAccounts', 'bank1'))).data()?.openingBalance).toBe(100_000);
    expect((await getDoc(doc(store(), 'issuedStatements', 'opening-cash-punghoe-bank1'))).data()?.totalAmount).toBe(100_000);
    const opening = (await getDoc(doc(store(), 'openingBalances', 'main-punghoe'))).data();
    expect(opening).toMatchObject({ date: '2026-07-31', amounts: {}, hasCashOpening: true });
    expect(await createCashAccountWithOpeningWithDb(store(), 'punghoe', account('cash1', '현금', 20_000))).toBe('created');
    expect((await getDoc(doc(store(), 'issuedStatements', 'opening-cash-punghoe-cash1'))).data()?.items?.[0]?.accountCode).toBe('102');
  });
  it('연결된 계좌가 있으면 기초일과 현금·예금 합계를 바꾸지 못한다', async () => {
    await createCashAccountWithOpeningWithDb(store(), 'punghoe', account('bank2'));
    await expect(saveOpeningBalancesWithDb(store(), 'punghoe', '2026-08-01', {})).rejects.toThrow('기준일');
    await expect(saveOpeningBalancesWithDb(store(), 'punghoe', '2026-07-31', { '103': 100_000 })).rejects.toThrow('직접 변경');
    await expect(createCashAccountWithOpeningWithDb(store(), 'punghoe', { ...account('late'), openingDate: '2026-08-01' })).rejects.toThrow('기초일');
  });
  it('기존 계좌가 있는데 회계 기초잔액이 없거나 수기 합계가 안 맞으면 멈춘다', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'cashAccounts', 'legacy'), account('legacy'));
    });
    await expect(createCashAccountWithOpeningWithDb(store(), 'punghoe', account('new'))).rejects.toThrow('기존 계좌');
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'openingBalances', 'main-punghoe'), { companyId: 'punghoe', date: '2026-07-31', amounts: { '103': 90_000 } });
    });
    await expect(createCashAccountWithOpeningWithDb(store(), 'punghoe', account('new'))).rejects.toThrow('합계');
    await saveOpeningBalancesWithDb(store(), 'punghoe', '2026-07-31', { '103': 100_000 });
    expect(await createCashAccountWithOpeningWithDb(store(), 'punghoe', account('new'))).toBe('created');
  });
  it('다른 회사 계좌와 카드 기초잔액을 거절한다', async () => {
    await expect(createCashAccountWithOpeningWithDb(store(), 'punghoe', { ...account('wrong'), companyId: 'taebaek' })).rejects.toThrow('회사');
    await expect(createCashAccountWithOpeningWithDb(store(), 'punghoe', account('card', '카드'))).rejects.toThrow('카드');
  });
});
