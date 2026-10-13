import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));
import { issueNumberedVoucher, issueVoucher, voucherSequenceKey } from './voucherIssue';
import { cashOriginalHash, mutateCashEntry } from './cashMutationCommand';
import {statementIssueRef} from './statementIssueReceipt';
const available = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8082'
  && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099';
const projectId = 'demo-protected-'+randomUUID().slice(0,8), run = `protected-${randomUUID()}`, date = '2026-10-03';
let app: admin.app.App, authApp: admin.app.App, db: admin.firestore.Firestore;
const clients: FirebaseApp[] = [], uids: string[] = [], owned = new Set<string>();
const claims: Record<string, { uid: string; token: admin.auth.DecodedIdToken }> = {};
async function put(path: string, row: Record<string, unknown>) { owned.add(path); await db.doc(path).set(row); }
const partner = (company: string) => `${run}-${company}-partner`;
const bank = (company: string) => `${run}-${company}-bank`;
const state = (company: string) => `appMeta/partnerPaymentState_${company}_${partner(company)}`;
function input(company: string, suffix: string) {
  const operationId = `${run}-${company}-${suffix}`;
  owned.add(`cashEntries/${operationId}`);
  return { kind: 'cashEntries' as const, operationId, tradeDate: date, releaseId: run,
    document: { companyId: company, date, dir: '출금', amount: 100, cashAccountId: bank(company), partnerId: partner(company),
      lines: [{ accountCode: '251', amount: 60, side: '차변' as const },
        { accountCode: '253', amount: 60, side: '차변' as const }, { accountCode: '811', amount: 20, side: '대변' as const }] } };
}
const invoke = (actor: string, request: ReturnType<typeof input>) =>
  (issueNumberedVoucher as unknown as (request: unknown) => Promise<{ id: string; docNo: string }>)({ auth: claims[actor], data: request });
describe.skipIf(!available)('선택 계정 발행 실제 Auth와 Firestore TX', { timeout: 90000 }, () => {
  beforeAll(async () => {
    app = admin.initializeApp({ projectId }); db = admin.firestore(app);
    // Auth SDK는 공유 emulator의 API key 프로젝트를 쓴다. Firestore fixture만 별도 프로젝트로 격리한다.
    authApp=admin.initializeApp({projectId:'demo-taebaekfood-local'},run+'-auth');
    await put('appMeta/releaseCutover', { status: 'active', releaseId: run, voucherNotBefore: { taebaek: date, punghoe: date } });
    for (const company of ['taebaek', 'punghoe']) {
      await put(`appMeta/${voucherSequenceKey(company, date)}`, { companyId: company, tradeDate: date, prefix: '', last: 0 });
      await put(`partners/${partner(company)}`, { companyId: company, name: '합성 거래처', revision: 0 });
      await put(`cashAccounts/${bank(company)}`, { companyId: company, active: true, type: '통장' });
      owned.add(state(company));
      for (const code of ['108', '251', '253', '811']) await put(`accountCodes/${run}-${company}-${code}`, { companyId: company, code });
    }
    for (const [actor, companyId, isAdmin] of [['taebaek', 'taebaek', true], ['punghoe', 'punghoe', true], ['staff', 'taebaek', false]] as const) {
      const uid = `${run}-${actor}`, email = `${uid}@example.test`, password = 'TestOnly-12345678';
      await admin.auth(authApp).createUser({ uid, email, password }); uids.push(uid);
      await admin.auth(authApp).setCustomUserClaims(uid, { companyId, isAdmin });
      const client = initializeApp({ projectId:'demo-taebaekfood-local', apiKey: 'demo-key' }, uid); clients.push(client);
      const auth = getAuth(client); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      const signed = await signInWithEmailAndPassword(auth, email, password);
      claims[actor] = { uid, token: await admin.auth(authApp).verifyIdToken(await signed.user.getIdToken(true)) };
    }
  }, 90000);
  afterAll(async () => {
    if (db) for (const path of owned) await db.doc(path).delete();
    if (authApp) for (const uid of uids) await admin.auth(authApp).deleteUser(uid);
    for (const client of clients) await deleteApp(client);
    if (app) await app.delete();
    if (authApp) await authApp.delete();
  });
  it('양사 관리자 신규발행은 원문 혼합 분개를 유지하고 정산을 만들지 않으며 재시도는 쓰지 않는다', async () => {
    for (const company of ['taebaek', 'punghoe']) {
      const request = input(company, 'first');
      const result = await invoke(company, request);
      const cash = await db.doc(`cashEntries/${request.operationId}`).get();
      expect(cash.data()).toMatchObject(request.document);
      expect((await db.collection('settlements').where('cashEntryId', '==', request.operationId).get()).empty).toBe(true);
      const counter = await db.doc(`appMeta/${voucherSequenceKey(company, date)}`).get();
      const revision = await db.doc(state(company)).get();
      const originalPartner = await db.doc(`partners/${partner(company)}`).get();
      expect(await invoke(company, request)).toEqual(result);
      for (const original of [cash, counter, revision, originalPartner])
        expect((await original.ref.get()).updateTime!.isEqual(original.updateTime!)).toBe(true);
    }
  });
  it('실제 직원 및 다른 회사 계좌·거래처 요청은 번호와 원문을 쓰지 않는다', async () => {
    const request = input('taebaek', 'denied');
    await expect(invoke('staff', request)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(invoke('punghoe', request)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(invoke('taebaek', { ...request, document: { ...request.document, cashAccountId: bank('punghoe') } })).rejects.toMatchObject({
      details: { operationStatus: 'rejected', version: 1, financialWrites: false, companyId: 'taebaek', operationId: request.operationId } });
    await expect(invoke('taebaek', { ...request, document: { ...request.document, partnerId: partner('punghoe') } })).rejects.toThrow('거래처');
    expect((await db.doc(`cashEntries/${request.operationId}`).get()).exists).toBe(false);
    expect((await db.doc(`appMeta/${voucherSequenceKey('taebaek', date)}`).get()).get('last')).toBe(1);
  });
  it('같은 거래처 동시 신규발행은 실제 TX 재시도로 번호와 두 revision을 모두 보존한다', async () => {
    const counterBefore=(await db.doc(`appMeta/${voucherSequenceKey('taebaek',date)}`).get()).get('last')??0;
    const stateBefore=(await db.doc(state('taebaek')).get()).get('revision')??0;
    const partnerBefore=(await db.doc(`partners/${partner('taebaek')}`).get()).get('revision')??0;
    const requests = [input('taebaek', 'concurrent-a'), input('taebaek', 'concurrent-b')];
    const results = await Promise.all(requests.map(request => issueVoucher(db, 'taebaek', request)));
    expect(new Set(results.map(result => result.docNo)).size).toBe(2);
    expect((await db.doc(state('taebaek')).get()).get('revision')).toBe(stateBefore+2);
    expect((await db.doc(`partners/${partner('taebaek')}`).get()).get('revision')).toBe(partnerBefore+2);
    expect((await db.doc(`appMeta/${voucherSequenceKey('taebaek', date)}`).get()).get('last')).toBe(counterBefore+2);
  });
  it('삭제 감사 이후 원 발행 재시도는 삭제를 유지하고 번호와 거래처 revision을 증가시키지 않는다', async () => {
    const request = input('taebaek', 'deleted'); await invoke('taebaek', request);
    const cashRef = db.doc(`cashEntries/${request.operationId}`), row = (await cashRef.get()).data()!;
    const operationId = `${run}-delete`; owned.add(`voucherMutationOperations/${operationId}`);
    await mutateCashEntry(db, 'taebaek', 'test-uid', { operationId, cashEntryId: request.operationId,
      action: 'delete', releaseId: run, expectedRevision: 0, expectedCashHash: cashOriginalHash(row) });
    const counter = await db.doc(`appMeta/${voucherSequenceKey('taebaek', date)}`).get();
    const revision = await db.doc(state('taebaek')).get();
    const gateRef=db.doc('appMeta/releaseCutover'),gate=(await gateRef.get()).data()!;
    try{
      await gateRef.set({...gate,releaseId:run+'-next',voucherNotBefore:{taebaek:'2026-10-04',punghoe:'2026-10-04'}});
      expect(await invoke('taebaek', request)).toMatchObject({ id: request.operationId, docNo: row.docNo });
      await expect(invoke('taebaek',input('taebaek','old-release-new'))).rejects.toThrow();
    }finally{await gateRef.set(gate);}
    expect((await cashRef.get()).exists).toBe(false);
    expect((await counter.ref.get()).updateTime!.isEqual(counter.updateTime!)).toBe(true);
    expect((await revision.ref.get()).updateTime!.isEqual(revision.updateTime!)).toBe(true);
  });
  it.each(['prepared','rejected','applied','foreign'])('실제 Auth generic의 다른 전표 %s claim은 신규쓰기만 막는다',async mode=>{
    const request=input('taebaek','claim-'+mode),owner=mode==='foreign'?'punghoe':'taebaek',claim=statementIssueRef(db,{companyId:owner,operationId:request.operationId+':ISSUE'});
    await put(claim.path,{status:mode==='foreign'?'applied':mode,companyId:owner,actorId:'다른담당'});
    const before=await Promise.all([db.doc(`appMeta/${voucherSequenceKey('taebaek',date)}`).get(),db.doc(state('taebaek')).get(),db.doc(`partners/${partner('taebaek')}`).get(),claim.get()]);
    await expect(invoke('taebaek',request)).rejects.toThrow('최초 요청');expect((await db.doc('cashEntries/'+request.operationId).get()).exists).toBe(false);
    const after=await Promise.all(before.map(snap=>snap.ref.get()));after.forEach((snap,index)=>expect(snap.updateTime!.isEqual(before[index].updateTime!)).toBe(true));
  });
});
