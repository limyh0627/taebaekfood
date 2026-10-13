import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));

import { recordPartnerPayment, recordPartnerPaymentCommand } from './partnerPaymentCommand';
import {statementIssueRef} from './statementIssueReceipt';
import { journalizeStatement } from '../../src/shared/autoJournal';
import type { IssuedStatement } from '../../src/shared/types';

const available = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8082';
const runId = `pay-${randomUUID()}`;
const projectId = 'demo-payment-'+randomUUID().slice(0,8);
const date = '2026-10-03';
const counterId = `voucherNo_taebaek_${date}_general`;
const actorId = `${runId}-admin`;
const releaseId = runId;
let app: admin.app.App;
let authApp: admin.app.App;
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
async function seedMixedPurchase(label: string) {
  const goods = await seed(label, 100);
  const expense = `${runId}-${label}-expense`;
  for (const [id, accountCode] of [[goods, '500'], [expense, '819']]) {
    await put('issuedStatements', id, { companyId: 'taebaek', partnerId: `${runId}-partner`, type: '매입', tradeDate: date,
      totalSupply: 100, totalTax: 0, totalAmount: 100,
      items: [{ accountCode, supply: 100, tax: 0, total: 100 }] });
  }
  for (const [id, code] of [[goods, '251'], [expense, '253']]) {
    const statement = { ...(await ref('issuedStatements', id).get()).data(), id } as IssuedStatement;
    expect(journalizeStatement(statement)?.lines.find(line => line.accountCode === code)?.credit).toBe(100);
  }
  return { goods, expense };
}
async function noWrites(input: Parameters<typeof recordPartnerPayment>[3], counterLast: number | null, rejected = true) {
  expect((await ref('cashEntries', input.operationId).get()).exists).toBe(false);
  const operation = await ref('partnerPaymentOperations', input.operationId).get();
  expect(operation.exists).toBe(rejected);
  if (rejected) expect(operation.data()).toMatchObject({ companyId: 'taebaek', partnerId: input.partnerId, status: 'rejected', createdBy: actorId });
  expect((await ref('issuedStatements', input.operationId).get()).exists).toBe(false);
  expect((await db.collection('settlements').where('operationId', '==', input.operationId).get()).empty).toBe(true);
  expect((await ref('appMeta', `partnerPaymentState_taebaek_${input.partnerId}`).get()).exists).toBe(false);
  expect((await ref('appMeta', counterId).get()).data()?.last ?? null).toBe(counterLast);
}

describe.skipIf(!available)('partner payment actual Admin SDK and Auth/Firestore Emulator', () => {
  it.each(['prepared','rejected','applied','foreign'])('다른 전표 %s claim은 신규 지급·정산·revision만 봉쇄하고 다른 ID는 정상 처리한다',async mode=>{
    const statementId=await seed('claim-'+mode),input=request('claim-'+mode,statementId),owner=mode==='foreign'?'punghoe':'taebaek';
    const claim=statementIssueRef(db,{companyId:owner,operationId:input.operationId+':ISSUE'});
    await put('statementIssueOperations',claim.id,{companyId:owner,status:mode==='foreign'?'applied':mode,actorId:'다른담당'});
    const before=await Promise.all([ref('appMeta',counterId).get(),ref('issuedStatements',statementId).get(),claim.get()]);
    await expect(issue(input)).rejects.toThrow('최초 요청');await noWrites(input,0,false);
    const after=await Promise.all(before.map(snap=>snap.ref.get()));after.forEach((snap,index)=>expect(snap.updateTime!.isEqual(before[index].updateTime!)).toBe(true));
    await ref('appMeta','releaseCutover').update({statementIssueProtocol:{generation:'잘못된-none-세대'}});
    expect((await issue(request('normal-'+mode,statementId))).status).toBe('applied');
  });
  it('지급 자기 원문 duplicate는 뒤늦은 타회사 전표 claim에도 원래 정산을 유지한다',async()=>{
    const statementId=await seed('own-ack'),input=request('own-ack',statementId),first=await issue(input),claim=statementIssueRef(db,{companyId:'punghoe',operationId:input.operationId+':ISSUE'});
    await put('statementIssueOperations',claim.id,{status:'prepared',actorId:'다른담당'});
    const before=await Promise.all([ref('appMeta',counterId).get(),ref('cashEntries',input.operationId).get(),ref('appMeta',`partnerPaymentState_taebaek_${input.partnerId}`).get(),claim.get()]);
    expect(await issue(input)).toEqual({...first,status:'duplicate'});const after=await Promise.all(before.map(snap=>snap.ref.get()));after.forEach((snap,index)=>expect(snap.updateTime!.isEqual(before[index].updateTime!)).toBe(true));
  });
  beforeAll(async () => {
    app = admin.initializeApp({ projectId });
    db = admin.firestore(app);
    authApp=admin.initializeApp({projectId:'demo-taebaekfood-local'},runId+'-auth-app');
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
    try { await admin.auth(authApp).deleteUser(`${runId}-auth`); } catch (error) {
      if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
    }
    await app.delete();
    await authApp.delete();
  });

  it('rejects missing auth, staff and foreign company before writing', async () => {
    const callable = recordPartnerPaymentCommand as unknown as (request: unknown) => Promise<unknown>;
    const input = request('auth', `${runId}-auth-statement`);
    await expect(callable({ data: input })).rejects.toThrow('로그인');
    await expect(callable({ auth: { uid: 'staff', token: { isAdmin: false, companyId: 'taebaek' } }, data: input })).rejects.toThrow('관리자');
    await seed('auth');await expect(issue({ ...input, partnerId: `${runId}-foreign` })).rejects.toThrow('거래처');
  });

  it('accepts a real Auth Emulator admin token through the callable auth boundary', async () => {
    const statementId = await seed('real-auth', 100);
    const uid = `${runId}-auth`;
    const email = `${runId}@example.test`;
    const password = `Demo-${randomUUID()}-pass`;
    await admin.auth(authApp).createUser({ uid, email, password });
    await admin.auth(authApp).setCustomUserClaims(uid, { companyId: 'taebaek', isAdmin: true });
    clientApp = initializeClientApp({ apiKey: 'demo-key', projectId:'demo-taebaekfood-local' }, `${runId}-client`);
    const auth = getAuth(clientApp);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const token = await credential.user.getIdToken(true);
    const decoded = await admin.auth(authApp).verifyIdToken(token);
    expect(decoded.companyId).toBe('taebaek');
    expect(decoded.isAdmin).toBe(true);
    const callable = recordPartnerPaymentCommand as unknown as (request: unknown) => Promise<{ status: string }>;
    expect(await callable({ auth: { uid: decoded.uid, token: decoded }, data: request('real-auth', statementId) }))
      .toMatchObject({ status: 'applied' });
  }, 30_000);

  it('fails closed on unprepared cutover, absent counter and stale revision', async () => {
    const statementId = await seed('gates', 100);
    let input = request('gates-release', statementId);
    await ref('appMeta', 'releaseCutover').update({ status: 'paused' });
    await expect(issue(input)).rejects.toThrow('활성화');
    await noWrites(input, 0);
    await ref('appMeta', 'releaseCutover').update({ status: 'active' });
    await ref('appMeta', 'partnerPaymentCutover_taebaek').delete();
    input = request('gates-cutover', statementId);
    await expect(issue(input)).rejects.toThrow('전환');
    await noWrites(input, 0);
    await put('appMeta', 'partnerPaymentCutover_taebaek',
      { companyId: 'taebaek', enabled: true, legacyWritersBlocked: true, auditPassed: true });
    await ref('appMeta', counterId).delete();
    input = request('gates-counter', statementId);
    await expect(issue(input)).rejects.toThrow('카운터');
    await noWrites(input, null);
    await put('appMeta', counterId, { companyId: 'taebaek', tradeDate: date, prefix: '', last: 0 });
    input = request('gates-revision', statementId, 100, 1);
    await expect(issue(input)).rejects.toThrow('변경');
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
    expect(await issue(input)).toMatchObject({status:'duplicate',docNo:first.docNo});
    await ref('appMeta', 'releaseCutover').update({ status: 'active' });
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
    await expect(issue({ ...input, amount: 90, allocations: [{ statementId, amount: 90 }] })).rejects.toThrow('다릅니다');
  }, 25_000);
  it('이전 release·추가창 종료 뒤 지급 정확 ACK는 원래 정산과 revision을 유지한다',async()=>{
    const statementId=await seed('old-release'),input=request('old-release',statementId),first=await issue(input);
    await ref('appMeta','releaseCutover').update({releaseId:'new-release',voucherNotBefore:{taebaek:'2099-01-01'},catchUp:{companyId:'taebaek',fromDate:'2026-09-30',status:'closed'}});
    const before=await Promise.all([ref('cashEntries',input.operationId).get(),ref('appMeta',counterId).get(),ref('appMeta',`partnerPaymentState_taebaek_${input.partnerId}`).get(),ref('settlements',`st-${input.operationId}-${statementId}`).get()]);
    expect(await issue(input)).toEqual({...first,status:'duplicate'});const after=await Promise.all(before.map(snap=>snap.ref.get()));after.forEach((snap,index)=>expect(snap.updateTime!.isEqual(before[index].updateTime!)).toBe(true));
    await expect(issue(request('new-old-release',statementId))).rejects.toThrow('활성화');
  });

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

  it('atomically pays mixed 500→251 and 819→253 partially or with advance133, then replays the exact body', async () => {
    for (const over of [false, true]) {
      const { goods, expense } = await seedMixedPurchase(`mixed-${over}`);
      const input = { ...request(`mixed-${over}`, goods), direction: '출금' as const,
        amount: over ? 250 : 100, allocations: [
          { statementId: goods, amount: over ? 150 : 60 }, { statementId: expense, amount: over ? 100 : 40 },
        ] };
      const originals = await Promise.all([ref('issuedStatements', goods).get(), ref('issuedStatements', expense).get()]);
      const first = await issue(input);
      const cash = await ref('cashEntries', input.operationId).get();
      expect(cash.data()).toMatchObject({ dir: '출금', amount: input.amount, partnerId: input.partnerId,
        lines: over ? [{ accountCode: '251', amount: 100 }, { accountCode: '253', amount: 100 }, { accountCode: '133', amount: 50 }]
          : [{ accountCode: '251', amount: 60 }, { accountCode: '253', amount: 40 }] });
      const links = await db.collection('settlements').where('operationId', '==', input.operationId).get();
      expect(links.docs.map(row => ({ id: row.id, amount: row.get('amount') })).sort((a, b) => a.id.localeCompare(b.id)))
        .toEqual([{ id: `st-${input.operationId}-${goods}`, amount: over ? 100 : 60 },
          { id: `st-${input.operationId}-${expense}`, amount: over ? 100 : 40 }].sort((a, b) => a.id.localeCompare(b.id)));
      const state = await ref('appMeta', `partnerPaymentState_taebaek_${input.partnerId}`).get();
      const partner = await ref('partners', input.partnerId).get();
      expect(state.get('revision')).toBe(1);
      expect((await ref('appMeta', counterId).get()).get('last')).toBe(1);
      expect(await issue(input)).toMatchObject({ status: 'duplicate', docNo: first.docNo });
      for (const before of [cash, state, partner, ...links.docs, ...originals]) {
        expect((await before.ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
      }
      expect((await ref('appMeta', counterId).get()).get('last')).toBe(1);
    }
  }, 40_000);

  it('a settlement link failure rolls back mixed cash, both links, revision and counter; the same ID then succeeds once', async () => {
    const { goods, expense } = await seedMixedPurchase('mixed-link-failure');
    const input = { ...request('mixed-link-failure', goods), direction: '출금' as const, amount: 100,
      allocations: [{ statementId: goods, amount: 60 }, { statementId: expense, amount: 40 }] };
    const before = await Promise.all([ref('issuedStatements', goods).get(), ref('issuedStatements', expense).get(),
      ref('partners', input.partnerId).get(), ref('appMeta', counterId).get()]);
    const create = admin.firestore.Transaction.prototype.create;
    const injected = vi.spyOn(admin.firestore.Transaction.prototype, 'create').mockImplementation(function (this: admin.firestore.Transaction, target, value) {
      if (target.path === `settlements/st-${input.operationId}-${expense}`) throw new Error('injected settlement link failure');
      return create.call(this, target, value);
    });
    try { await expect(issue(input)).rejects.toThrow('injected settlement link failure'); }
    finally { injected.mockRestore(); }
    await noWrites(input, 0, false);
    for (const original of before) expect((await original.ref.get()).updateTime!.isEqual(original.updateTime!)).toBe(true);
    expect(await issue(input)).toMatchObject({ status: 'applied' });
    expect(await issue(input)).toMatchObject({ status: 'duplicate' });
    expect((await ref('appMeta', counterId).get()).get('last')).toBe(1);
    expect((await db.collection('settlements').where('operationId', '==', input.operationId).get()).size).toBe(2);
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
    const malformed = request('malformed-ledger', statementId);
    await expect(issue(malformed)).rejects.toThrow('방향·계정');
    await noWrites(malformed, 0);
  }, 25_000);
});
