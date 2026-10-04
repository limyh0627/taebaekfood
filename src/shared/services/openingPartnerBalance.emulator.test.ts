import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
vi.mock('../firebase', () => ({ db: null, auth: { currentUser: null }, authReady: Promise.resolve() }));
const { createOpeningPartnerBalanceWithDb, saveOpeningBalancesWithDb } = await import('./firebaseService');
const ready = await fetch('http://127.0.0.1:8082/', { signal: AbortSignal.timeout(1500) }).then(r => r.status < 500).catch(() => false);
let env: RulesTestEnvironment;

describe.skipIf(!ready)('거래처별 기초 전표 (Firestore Emulator)', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-opening-partner-balance', firestore: {
      rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8082,
    } });
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'partners', 'p1'), { companyId: 'punghoe', name: '거래처1', type: '일반' });
      await setDoc(doc(db, 'partners', 'foreign'), { companyId: 'taebaek', name: '다른 회사', type: '일반' });
      await setDoc(doc(db, 'openingBalances', 'main-punghoe'), { companyId: 'punghoe', date: '2026-07-31', amounts: {} });
    });
  }, 20_000);
  afterAll(async () => { await env?.cleanup(); });
  const db = () => env.authenticatedContext('opening-admin', { employeeId: 'admin', companyId: 'punghoe', isAdmin: true }).firestore() as unknown as Firestore;

  it('저장·재시도는 한 장이고 다른 금액 충돌은 거절한다', async () => {
    expect(await createOpeningPartnerBalanceWithDb(db(), 'punghoe', '2026-07-31', 'p1', '108', 700000)).toBe('created');
    expect(await createOpeningPartnerBalanceWithDb(db(), 'punghoe', '2026-07-31', 'p1', '108', 700000)).toBe('unchanged');
    await expect(createOpeningPartnerBalanceWithDb(db(), 'punghoe', '2026-07-31', 'p1', '108', 1)).rejects.toThrow('다른 내용');
    expect((await getDoc(doc(db(), 'issuedStatements', 'opening-partner-punghoe-2026-07-31-p1-108'))).data()?.totalAmount).toBe(700000);
  });
  it('기초계정 합계와 거래처분이 동시에 저장되지 않는다', async () => {
    await expect(saveOpeningBalancesWithDb(db(), 'punghoe', '2026-07-31', { '108': 700000 })).rejects.toThrow('직접 변경');
    await expect(saveOpeningBalancesWithDb(db(), 'punghoe', '2026-08-01', {})).rejects.toThrow('기준일');
    const opening = await getDoc(doc(db(), 'openingBalances', 'main-punghoe'));
    expect(opening.data()?.amounts?.['108']).toBeUndefined();
    await saveOpeningBalancesWithDb(db(), 'punghoe', '2026-07-31', { '103': 100 });
    await saveOpeningBalancesWithDb(db(), 'punghoe', '2026-07-31', {});
    expect((await getDoc(doc(db(), 'openingBalances', 'main-punghoe'))).data()?.amounts).toEqual({});
  });
  it('다른 회사 거래처와 기준일 불일치는 거절한다', async () => {
    await expect(createOpeningPartnerBalanceWithDb(db(), 'punghoe', '2026-07-31', 'foreign', '251', 100)).rejects.toThrow('PERMISSION_DENIED');
    await expect(createOpeningPartnerBalanceWithDb(db(), 'punghoe', '2026-08-01', 'p1', '251', 100)).rejects.toThrow('기초잔액');
  });
});
