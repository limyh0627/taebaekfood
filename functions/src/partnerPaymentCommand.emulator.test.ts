import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));

import { recordPartnerPayment, recordPartnerPaymentCommand } from './partnerPaymentCommand';

const available = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const runId = `pay-${randomUUID()}`;
const projectId = 'demo-taebaekfood-local';
const date = '2026-10-03';
const counterId = `voucherNo_taebaek_${date}_general`;
const actorId = `${runId}-admin`;
const releaseId = runId;
let app: admin.app.App;
let db: admin.firestore.Firestore;
let clientApp: FirebaseApp;
const owned = new Set<string>();
const ref = (collection: string, id: string) => db.collection(collection).doc(id);
async function put(collection: string, id: string, value: Record<string, unknown>) {
  await ref(collection, id).set({ ...value, testRunId: runId });
  owned.add(`${collection}/${id}`);
}
const request = (id: string, statementId: string, amount = 100, expectedRevision = 0) => ({
  operationId: `${runId}-${id}`, tradeDate: date, partnerId: `${runId}-partner`, direction: '입금' as const,
  amount, cashAccountId: `${runId}-bank`, pin: true,
  allocations: [{ statementId, amount }], expectedRevision, releaseId,
});
async function clearFixture() {
  for (const collection of ['issuedStatements', 'cashEntries', 'settlements', 'partnerPaymentOperations']) {
    const snap = await db.collection(collection).get();
    for (const row of snap.docs) {
      if (row.id.startsWith(runId) && (row.data().testRunId === runId || row.data().companyId === 'taebaek')) await row.ref.delete();
      else if (collection === 'settlements' && row.data().operationId?.startsWith(runId)
        && row.data().companyId === 'taebaek') await row.ref.delete();
    }
  }
  const state = ref('appMeta', `partnerPaymentState_taebaek_${runId}-partner`);
  if ((await state.get()).data()?.partnerId === `${runId}-partner`) await state.delete();
}
async function seed(label: string, amount = 100, options: { cutover?: boolean; counter?: boolean } = {}) {
  await clearFixture();
  const partnerId = `${runId}-partner`, statementId = `${runId}-${label}-statement`;
  await Promise.all([
    put('partners', partnerId, { companyId: 'taebaek', name: '검증 거래처' }),
    put('cashAccounts', `${runId}-bank`, { companyId: 'taebaek', active: true, type: '통장' }),
    put('issuedStatements', statementId, { companyId: 'taebaek', partnerId, type: '매출', tradeDate: date,
      totalSupply: amount, totalTax: 0, totalAmount: amount,
      items: [{ accountCode: '800', supply: amount, tax: 0, total: amount }] }),
    options.cutover === false ? Promise.resolve() : put('appMeta', 'partnerPaymentCutover_taebaek',
      { companyId: 'taebaek', enabled: true, legacyWritersBlocked: true, auditPassed: true }),
    options.counter === false ? Promise.resolve() : put('appMeta', counterId,
      { companyId: 'taebaek', tradeDate: date, prefix: '', last: 0 }),
    put('appMeta', 'releaseCutover', { releaseId, status: 'active', voucherNotBefore: { taebaek: date } }),
  ]);
  return statementId;
}
const issue = (input: Parameters<typeof recordPartnerPayment>[3]) => recordPartnerPayment(db, 'taebaek', actorId, input);
async function noWrites(input: Parameters<typeof recordPartnerPayment>[3], counterLast: number | null) {
  expect((await ref('cashEntries', input.operationId).get()).exists).toBe(false);
  expect((await ref('partnerPaymentOperations', input.operationId).get()).exists).toBe(false);
  expect((await ref('appMeta', `partnerPaymentState_taebaek_${input.partnerId}`).get()).exists).toBe(false);
  expect((await ref('appMeta', counterId).get()).data()?.last ?? null).toBe(counterLast);
}

describe.skipIf(!available)('partner payment actual Admin SDK and Auth/Firestore Emulator', () => {
  beforeAll(async () => {
    app = admin.initializeApp({ projectId });
    db = admin.firestore(app);
  });
  afterAll(async () => {
    if (!db) return;
    for (const path of owned) {
      const [collection, id] = path.split('/');
      const target = ref(collection, id);
      const snap = await target.get();
      if (snap.exists && snap.data()?.testRunId === runId) await target.delete();
    }
    for (const collection of ['cashEntries', 'settlements', 'partnerPaymentOperations']) {
      const snap = await db.collection(collection).get();
      for (const row of snap.docs) {
        if (row.id.startsWith(runId) && row.data().companyId === 'taebaek') await row.ref.delete();
        if (collection === 'settlements' && row.data().operationId?.startsWith(runId)
          && row.data().companyId === 'taebaek') await row.ref.delete();
      }
    }
    const state = ref('appMeta', `partnerPaymentState_taebaek_${runId}-partner`);
    if ((await state.get()).data()?.partnerId === `${runId}-partner`) await state.delete();
    if (clientApp) await deleteClientApp(clientApp);
    try { await admin.auth(app).deleteUser(`${runId}-auth`); } catch (error) {
      if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
    }
    await app.delete();
  });

  it('rejects missing auth, staff and foreign company before writing', async () => {
    const callable = recordPartnerPaymentCommand as unknown as (request: unknown) => Promise<unknown>;
    const input = request('auth', `${runId}-auth-statement`);
    await expect(callable({ data: input })).rejects.toThrow('로그인');
    await expect(callable({ auth: { uid: 'staff', token: { isAdmin: false, companyId: 'taebaek' } }, data: input })).rejects.toThrow('관리자');
    await expect(issue({ ...input, partnerId: `${runId}-foreign` })).rejects.toThrow('전환');
  });

  it('accepts a real Auth Emulator admin token through the callable auth boundary', async () => {
    const statementId = await seed('real-auth', 100);
    const uid = `${runId}-auth`;
    const email = `${runId}@example.test`;
    const password = `Demo-${randomUUID()}-pass`;
    await admin.auth(app).createUser({ uid, email, password });
    await admin.auth(app).setCustomUserClaims(uid, { companyId: 'taebaek', isAdmin: true });
    clientApp = initializeClientApp({ apiKey: 'demo-key', projectId }, `${runId}-client`);
    const auth = getAuth(clientApp);
    connectAuthEmulator(auth, 'http://127.0.0.1:9198', { disableWarnings: true });
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const token = await credential.user.getIdToken(true);
    const decoded = await admin.auth(app).verifyIdToken(token);
    expect(decoded.companyId).toBe('taebaek');
    expect(decoded.isAdmin).toBe(true);
    const callable = recordPartnerPaymentCommand as unknown as (request: unknown) => Promise<{ status: string }>;
    expect(await callable({ auth: { uid: decoded.uid, token: decoded }, data: request('real-auth', statementId) }))
      .toMatchObject({ status: 'applied' });
  }, 30_000);

  it('fails closed on unprepared cutover, absent counter and stale revision', async () => {
    const statementId = await seed('gates', 100);
    const input = request('gates', statementId);
    await ref('appMeta', 'releaseCutover').update({ status: 'paused' });
    await expect(issue(input)).rejects.toThrow('활성화');
    await noWrites(input, 0);
    await ref('appMeta', 'releaseCutover').update({ status: 'active' });
    await ref('appMeta', 'partnerPaymentCutover_taebaek').delete();
    await expect(issue(input)).rejects.toThrow('전환');
    await noWrites(input, 0);
    await put('appMeta', 'partnerPaymentCutover_taebaek',
      { companyId: 'taebaek', enabled: true, legacyWritersBlocked: true, auditPassed: true });
    await ref('appMeta', counterId).delete();
    await expect(issue(input)).rejects.toThrow('카운터');
    await noWrites(input, null);
    await put('appMeta', counterId, { companyId: 'taebaek', tradeDate: date, prefix: '', last: 0 });
    await expect(issue({ ...input, expectedRevision: 1 })).rejects.toThrow('변경');
    await noWrites(input, 0);
  }, 25_000);

  it('quarantines a partner with legacy settlement exceptions without creating a payment', async () => {
    const statementId = await seed('quarantined', 100);
    const data = request('quarantined', statementId);
    await ref('appMeta', 'partnerPaymentCutover_taebaek').update({ auditScope: 'unblocked-partners', blockedPartnerIds: [data.partnerId] });
    await expect(issue(data)).rejects.toThrow('과거 정산');
    await noWrites(data, 0);
  }, 25_000);

  it('commits all payment documents together and reuses a lost response without consuming a number', async () => {
    const statementId = await seed('normal', 100);
    const input = request('normal', statementId);
    const first = await issue(input);
    expect(first).toMatchObject({ status: 'applied', id: input.operationId, docNo: '261003-001' });
    expect((await ref('cashEntries', input.operationId).get()).data()?.lines).toEqual([{ accountCode: '108', amount: 100 }]);
    expect((await ref('settlements', `st-${input.operationId}-${statementId}`).get()).data()?.amount).toBe(100);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
    expect((await ref('appMeta', `partnerPaymentState_taebaek_${input.partnerId}`).get()).data()?.revision).toBe(1);
    expect(await issue(input)).toMatchObject({ status: 'duplicate', docNo: first.docNo });
    await ref('appMeta', 'releaseCutover').update({ status: 'paused' });
    await expect(issue(input)).rejects.toThrow('활성화');
    await ref('appMeta', 'releaseCutover').update({ status: 'active' });
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
    await expect(issue({ ...input, amount: 90, allocations: [{ statementId, amount: 90 }] })).rejects.toThrow('다릅니다');
  }, 25_000);

  it('serializes same and different operation IDs on the partner revision', async () => {
    const statementId = await seed('race', 100);
    const same = request('race-same', statementId);
    const results = await Promise.all([issue(same), issue(same)]);
    expect(results.map(row => row.status).sort()).toEqual(['applied', 'duplicate']);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
    const a = request('race-a', statementId, 1, 1), b = request('race-b', statementId, 1, 1);
    const competing = await Promise.allSettled([issue(a), issue(b)]);
    expect(competing.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter(row => row.status === 'rejected')).toHaveLength(1);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(2);
  }, 30_000);

  it('rejects foreign account and malformed legacy settlement without consuming a number', async () => {
    const statementId = await seed('malformed', 100);
    const input = request('malformed', statementId);
    await put('cashAccounts', `${runId}-bank`, { companyId: 'punghoe', active: true, type: '통장' });
    await expect(issue(input)).rejects.toThrow('계좌');
    await noWrites(input, 0);
    await put('cashAccounts', `${runId}-bank`, { companyId: 'taebaek', active: true, type: '통장' });
    await put('cashEntries', `${runId}-legacy-cash`, { companyId: 'taebaek', partnerId: input.partnerId,
      date, dir: '출금', amount: 100, accountCode: '251' });
    await put('settlements', `${runId}-malformed-settlement`, { companyId: 'taebaek',
      cashEntryId: `${runId}-legacy-cash`, statementId, amount: 100 });
    await expect(issue(input)).rejects.toThrow('방향·계정');
    await noWrites(input, 0);
  }, 25_000);
});
