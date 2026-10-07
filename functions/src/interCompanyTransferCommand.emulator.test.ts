import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));

import { recordInterCompanyTransfer, recordInterCompanyTransferCommand } from './interCompanyTransferCommand';

const available = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182'
  && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9198';
const projectId = 'demo-taebaekfood-local', runId = `transfer-${randomUUID()}`;
const releaseId = runId;
const date = '2026-10-03', uid = `${runId}-uid`, employeeId = `${runId}-employee`;
const fromPartnerId = `${runId}-from-partner`, toPartnerId = `${runId}-to-partner`;
const fromAccountId = `${runId}-from-bank`, toAccountId = `${runId}-to-bank`;
let app: admin.app.App, db: admin.firestore.Firestore, clientApp: FirebaseApp;
let token: Record<string, unknown>;
const owned = new Set<string>();
const ref = (group: string, id: string) => db.collection(group).doc(id);
async function put(group: string, id: string, data: Record<string, unknown>) {
  await ref(group, id).set({ ...data, testRunId: runId });
  owned.add(`${group}/${id}`);
}
const input = (label: string, amount = 120, expectedFromRevision = 0, expectedToRevision = 0) => ({
  operationId: `${runId}-${label}`, from: 'taebaek' as const, to: 'punghoe' as const,
  tradeDate: date, amount, overKind: '선급금' as const,
  fromAccountId, toAccountId, fromPartnerId, toPartnerId,
  expectedFromRevision, expectedToRevision,
  releaseId,
});
const issue = (request: Parameters<typeof recordInterCompanyTransfer>[3]) =>
  recordInterCompanyTransfer(db, uid, token, request);
async function clearFixture() {
  for (const group of ['cashEntries', 'settlements', 'companyTransferOperations']) {
    const rows = await db.collection(group).get();
    for (const row of rows.docs) {
      if (row.id.startsWith(runId) || row.data().operationId?.startsWith(runId)) await row.ref.delete();
    }
  }
  for (const company of ['taebaek', 'punghoe']) {
    const partnerId = company === 'taebaek' ? fromPartnerId : toPartnerId;
    const state = ref('appMeta', `partnerPaymentState_${company}_${partnerId}`);
    if ((await state.get()).data()?.partnerId === partnerId) await state.delete();
  }
}
async function seed(options: { grant?: boolean; counter?: boolean; cutover?: boolean } = {}) {
  await clearFixture();
  await Promise.all([
    put('employees', employeeId, { authUid: uid, companyId: 'taebaek', adminAccess: true, status: 'working' }),
    put('companyTransferGrants', uid, { authUid: uid, enabled: options.grant !== false,
      allowedPairs: ['taebaek>punghoe'], revision: 1, approvedBy: 'test-owner', approvedAt: '2026-10-03T00:00:00Z' }),
    put('appMeta', 'releaseCutover', { releaseId, status: 'active', voucherNotBefore: { taebaek: date, punghoe: date } }),
    put('cashAccounts', fromAccountId, { companyId: 'taebaek', active: true, type: '통장' }),
    put('cashAccounts', toAccountId, { companyId: 'punghoe', active: true, type: '통장' }),
    put('partners', fromPartnerId, { companyId: 'taebaek', name: '풍회유통' }),
    put('partners', toPartnerId, { companyId: 'punghoe', name: '태백푸드' }),
    ...(['taebaek', 'punghoe'] as const).flatMap(company => [
      options.counter === false && company === 'punghoe'
        ? ref('appMeta', `voucherNo_${company}_${date}_general`).delete()
        : put('appMeta', `voucherNo_${company}_${date}_general`, { companyId: company, tradeDate: date, prefix: '', last: 0 }),
      options.cutover === false && company === 'punghoe'
        ? ref('appMeta', `companyTransferCutover_${company}`).delete()
        : put('appMeta', `companyTransferCutover_${company}`, {
          companyId: company, enabled: true, legacyWritersBlocked: true, auditPassed: true }),
    ]),
    ...([['taebaek', '251'], ['taebaek', '253'], ['taebaek', '133'], ['taebaek', '137'],
      ['punghoe', '108'], ['punghoe', '254'], ['punghoe', '267']] as const)
      .map(([companyId, code]) => put('accountCodes', `${runId}-${companyId}-${code}`, { companyId, code })),
    put('issuedStatements', `${runId}-from-claim`, { companyId: 'taebaek', partnerId: fromPartnerId,
      type: '매입', tradeDate: date, totalAmount: 100, totalTax: 0,
      items: [{ accountCode: '500', supply: 100, tax: 0, total: 100 }] }),
    put('issuedStatements', `${runId}-to-claim`, { companyId: 'punghoe', partnerId: toPartnerId,
      type: '매출', tradeDate: date, totalAmount: 100, totalTax: 0,
      items: [{ accountCode: '404', supply: 100, tax: 0, total: 100 }] }),
  ]);
}

describe.skipIf(!available)('intercompany transfer actual Auth/Firestore transaction', () => {
  beforeAll(async () => {
    app = admin.initializeApp({ projectId }, runId); db = admin.firestore(app);
    const email = `${runId}@example.test`, password = 'TestOnly-12345678';
    await admin.auth(app).createUser({ uid, email, password });
    await admin.auth(app).setCustomUserClaims(uid, { employeeId, companyId: 'taebaek', isAdmin: true });
    clientApp = initializeClientApp({ apiKey: 'demo-key', projectId }, `${runId}-client`);
    const auth = getAuth(clientApp);
    connectAuthEmulator(auth, 'http://127.0.0.1:9198', { disableWarnings: true });
    const credential = await signInWithEmailAndPassword(auth, email, password);
    token = await admin.auth(app).verifyIdToken(await credential.user.getIdToken(true));
  });
  afterAll(async () => {
    if (!db) return;
    await clearFixture();
    for (const path of owned) {
      const [group, id] = path.split('/'), target = ref(group, id), snap = await target.get();
      if (snap.exists && snap.data()?.testRunId === runId) await target.delete();
    }
    try { await admin.auth(app).deleteUser(uid); } catch (error) {
      if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
    }
    if (clientApp) await deleteClientApp(clientApp);
    await app.delete();
  });

  it('requires the current server grant, employee, direction and both account IDs', async () => {
    await seed({ grant: false });
    const request = input('no-grant');
    const callable = recordInterCompanyTransferCommand as unknown as (request: unknown) => Promise<unknown>;
    await expect(callable({ data: request })).rejects.toThrow('로그인');
    await expect(issue(request)).rejects.toThrow('양사 관리자');
    expect((await ref('cashEntries', `${request.operationId}-out`).get()).exists).toBe(false);
    await seed();
    await expect(recordInterCompanyTransfer(db, `${runId}-other-uid`, token, request)).rejects.toThrow('양사 관리자');
    await put('companyTransferGrants', uid, { authUid: uid, enabled: true,
      allowedPairs: ['punghoe>taebaek'], revision: 2, approvedBy: 'owner', approvedAt: date });
    await expect(issue(request)).rejects.toThrow('양사 관리자');
    await seed();
    await put('employees', employeeId, { authUid: uid, companyId: 'taebaek', adminAccess: false, status: 'working' });
    await expect(issue(request)).rejects.toThrow('직원 관리자');
    await seed();
    await put('cashAccounts', toAccountId, { companyId: 'taebaek', active: true, type: '통장' });
    await expect(issue(request)).rejects.toThrow('통장 계좌');
    await expect(issue({ ...request, toAccountId: '' })).rejects.toThrow('입력');
  }, 35_000);

  it('fails atomically when either counter or cutover is missing or one half already exists', async () => {
    await seed();
    const request = input('gates');
    await ref('appMeta', 'releaseCutover').update({ status: 'paused' });
    await expect(issue(request)).rejects.toThrow('활성화');
    for (const company of ['taebaek', 'punghoe'] as const) {
      await seed();
      await ref('appMeta', 'releaseCutover').update({ voucherNotBefore: {
        taebaek: company === 'taebaek' ? '2099-01-01' : date,
        punghoe: company === 'punghoe' ? '2099-01-01' : date,
      } });
      await expect(issue(request)).rejects.toThrow('전표 발행 가능일');
      expect((await ref('appMeta', `voucherNo_taebaek_${date}_general`).get()).data()?.last).toBe(0);
      expect((await ref('appMeta', `voucherNo_punghoe_${date}_general`).get()).data()?.last).toBe(0);
    }
    await seed({ counter: false });
    await expect(issue(request)).rejects.toThrow('카운터');
    expect((await ref('appMeta', `voucherNo_taebaek_${date}_general`).get()).data()?.last).toBe(0);
    await seed({ cutover: false });
    await expect(issue(request)).rejects.toThrow('전환');
    await seed();
    await put('cashEntries', `${request.operationId}-out`, { companyId: 'taebaek', amount: 1 });
    await expect(issue(request)).rejects.toThrow('한쪽 전표');
    expect((await ref('cashEntries', `${request.operationId}-in`).get()).exists).toBe(false);
  }, 35_000);

  it('commits two numbered entries, mirrored applications, counters and revisions once', async () => {
    await seed();
    const request = input('paired');
    const applied = await issue(request);
    expect(applied).toMatchObject({ status: 'applied', outDocNo: '261003-001', inDocNo: '261003-001' });
    const out = (await ref('cashEntries', `${request.operationId}-out`).get()).data()!;
    const incoming = (await ref('cashEntries', `${request.operationId}-in`).get()).data()!;
    expect(out.lines).toEqual([{ accountCode: '251', amount: 100 }, { accountCode: '133', amount: 20 }]);
    expect(incoming.lines).toEqual([{ accountCode: '108', amount: 100 }, { accountCode: '254', amount: 20 }]);
    expect((await ref('settlements', `st-${request.operationId}-out-${runId}-from-claim`).get()).data()?.amount).toBe(100);
    expect((await ref('settlements', `st-${request.operationId}-in-${runId}-to-claim`).get()).data()?.amount).toBe(100);
    expect((await ref('appMeta', `partnerPaymentState_taebaek_${fromPartnerId}`).get()).data()?.revision).toBe(1);
    expect((await ref('appMeta', `partnerPaymentState_punghoe_${toPartnerId}`).get()).data()?.revision).toBe(1);
    await ref('appMeta', `voucherNo_taebaek_${date}_general`).delete();
    expect(await issue(request)).toMatchObject({ status: 'duplicate', outDocNo: applied.outDocNo, inDocNo: applied.inDocNo });
    await ref('appMeta', 'releaseCutover').update({ status: 'paused' });
    await expect(issue(request)).rejects.toThrow('활성화');
    await ref('appMeta', 'releaseCutover').update({ status: 'active' });
    await expect(issue({ ...request, amount: 121 })).rejects.toThrow('다릅니다');
    await put('companyTransferGrants', uid, { authUid: uid, enabled: false,
      allowedPairs: ['taebaek>punghoe'], revision: 2, approvedBy: 'owner', approvedAt: date });
    await expect(issue(request)).rejects.toThrow('양사 관리자');
  }, 35_000);

  it('serializes same ID retry and different ID contention on both counters and states', async () => {
    await seed();
    const same = input('same');
    const results = await Promise.all([issue(same), issue(same)]);
    expect(results.map(result => result.status).sort()).toEqual(['applied', 'duplicate']);
    const races = await Promise.allSettled([issue(input('race-a', 20, 1, 1)), issue(input('race-b', 20, 1, 1))]);
    expect(races.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(races.filter(result => result.status === 'rejected')).toHaveLength(1);
    for (const company of ['taebaek', 'punghoe'])
      expect((await ref('appMeta', `voucherNo_${company}_${date}_general`).get()).data()?.last).toBe(2);
  }, 35_000);

  it('rejects unmatched cross-company claims without consuming either number', async () => {
    await seed();
    await ref('issuedStatements', `${runId}-to-claim`).delete();
    await expect(issue(input('unmatched'))).rejects.toThrow('상계액');
    for (const company of ['taebaek', 'punghoe'])
      expect((await ref('appMeta', `voucherNo_${company}_${date}_general`).get()).data()?.last).toBe(0);
  }, 30_000);

  it('keeps 251 and 253 separately and can classify symmetric overage as 137/267', async () => {
    await seed();
    await put('issuedStatements', `${runId}-from-other-payable`, { companyId: 'taebaek',
      partnerId: fromPartnerId, type: '비용', tradeDate: date, totalAmount: 100,
      items: [{ accountCode: '530', side: '차변', total: 100 }, { accountCode: '253', side: '대변', total: 100 }] });
    await put('issuedStatements', `${runId}-to-more-receivable`, { companyId: 'punghoe',
      partnerId: toPartnerId, type: '매출', tradeDate: date, totalAmount: 100, totalTax: 0,
      items: [{ accountCode: '404', supply: 100, tax: 0, total: 100 }] });
    const request = { ...input('multi-code', 220), overKind: '대여금' as const };
    expect(await issue(request)).toMatchObject({ status: 'applied' });
    const out = (await ref('cashEntries', `${request.operationId}-out`).get()).data()!;
    const incoming = (await ref('cashEntries', `${request.operationId}-in`).get()).data()!;
    expect(out.lines).toEqual([{ accountCode: '251', amount: 100 }, { accountCode: '253', amount: 100 },
      { accountCode: '137', amount: 20 }]);
    expect(incoming.lines).toEqual([{ accountCode: '108', amount: 200 }, { accountCode: '267', amount: 20 }]);
    expect((await ref('settlements', `st-${request.operationId}-out-${runId}-from-other-payable`).get()).data()?.amount).toBe(100);
  }, 30_000);
});
