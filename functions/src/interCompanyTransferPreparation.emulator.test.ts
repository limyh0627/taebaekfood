import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string, public details?:unknown) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));

import {prepareInterCompanyTransfer} from './interCompanyTransferPreparation';
import {connectFirestoreEmulator,getFirestore,collection,query,where,getDocs,doc,getDoc} from 'firebase/firestore';
import { recordInterCompanyTransfer, recordInterCompanyTransferCommand } from './interCompanyTransferCommand';

const available = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8082'
  && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099';
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

const clients:FirebaseApp[]=[];const authUids:string[]=[];let web:ReturnType<typeof getFirestore>;
async function login(company:'taebaek'|'punghoe',suffix:string){const userId=runId+'-'+suffix,staffId=userId+'-staff',email=userId+'@example.test';await admin.auth(app).createUser({uid:userId,email,password:'TestOnly-12345678'});authUids.push(userId);await admin.auth(app).setCustomUserClaims(userId,{employeeId:staffId,companyId:company,isAdmin:true});await put('employees',staffId,{authUid:userId,companyId:company,adminAccess:true,status:'working'});await put('companyTransferGrants',userId,{authUid:userId,enabled:true,allowedPairs:[company+'>'+ (company==='taebaek'?'punghoe':'taebaek')],revision:1,approvedBy:'test-owner',approvedAt:date});const client=initializeClientApp({apiKey:'demo-key',projectId},userId);clients.push(client);const auth=getAuth(client);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});const signed=await signInWithEmailAndPassword(auth,email,'TestOnly-12345678');const claims=await admin.auth(app).verifyIdToken(await signed.user.getIdToken(true));const store=getFirestore(client);connectFirestoreEmulator(store,'127.0.0.1',8082);return {uid:userId,claims,store};}
describe.skipIf(!available)('회사이체 준비·저장과 실제 인증 Rules',{timeout:90000},()=>{
 beforeAll(async()=>{app=admin.initializeApp({projectId},runId);db=admin.firestore(app);await admin.auth(app).createUser({uid,email:uid+'@example.test',password:'TestOnly-12345678'});authUids.push(uid);await admin.auth(app).setCustomUserClaims(uid,{employeeId,companyId:'taebaek',isAdmin:true});clientApp=initializeClientApp({apiKey:'demo-key',projectId},runId+'-client');clients.push(clientApp);const a=getAuth(clientApp);connectAuthEmulator(a,'http://127.0.0.1:9099',{disableWarnings:true});const signed=await signInWithEmailAndPassword(a,uid+'@example.test','TestOnly-12345678');token=await admin.auth(app).verifyIdToken(await signed.user.getIdToken(true));web=getFirestore(clientApp);connectFirestoreEmulator(web,'127.0.0.1',8082);},90000);
 afterAll(async()=>{if(!db)return;await clearFixture();for(const path of owned){const r=db.doc(path);const snapshot=await r.get();if(snapshot.get('testRunId')===runId)await r.delete();}for(const id of authUids)await admin.auth(app).deleteUser(id);for(const client of clients)await deleteClientApp(client);await app.delete();});
 it('태백은 타회사 직접 목록을 읽지 못하지만 grant 확인 준비는 실제 양사 선택지를 반환하고 한 TX로 저장한다',async()=>{await seed();await expect(getDocs(query(collection(web,'cashAccounts'),where('companyId','==','punghoe')))).rejects.toMatchObject({code:'permission-denied'});const options=await prepareInterCompanyTransfer(db,uid,token,{from:'taebaek',to:'punghoe',tradeDate:date,releaseId});expect(options.from.accounts.map(x=>x.id)).toContain(fromAccountId);expect(options.to.accounts.map(x=>x.id)).toContain(toAccountId);expect(options.from.partners).toContainEqual(expect.objectContaining({id:fromPartnerId,available:100,revision:0}));expect(options.to.partners).toContainEqual(expect.objectContaining({id:toPartnerId,available:100}));const request=input('new-prepared');await issue(request);expect((await ref('cashEntries',request.operationId+'-out').get()).get('cashAccountId')).toBe(fromAccountId);expect((await ref('cashEntries',request.operationId+'-in').get()).get('cashAccountId')).toBe(toAccountId);expect((await ref('companyTransferOperations',request.operationId).get()).data()).toMatchObject({companyId:'taebaek',status:'applied',authUid:uid,command:request});expect((await getDoc(doc(web,'companyTransferOperations',request.operationId))).exists()).toBe(true);});
 it('풍회도 태백 직접 목록은 거절되며 실제 역방향 준비·권한 없는 준비는 금융을 쓰지 않는다',async()=>{await seed();const ph=await login('punghoe','ph-preparation');await expect(getDocs(query(collection(ph.store,'cashAccounts'),where('companyId','==','taebaek')))).rejects.toMatchObject({code:'permission-denied'});const options=await prepareInterCompanyTransfer(db,ph.uid,ph.claims,{from:'punghoe',to:'taebaek',tradeDate:date,releaseId});expect(options.from.accounts.map(x=>x.id)).toContain(toAccountId);expect(options.to.accounts.map(x=>x.id)).toContain(fromAccountId);await ref('companyTransferGrants',ph.uid).update({enabled:false});await expect(prepareInterCompanyTransfer(db,ph.uid,ph.claims,{from:'punghoe',to:'taebaek',tradeDate:date,releaseId})).rejects.toThrow('양사 관리자');expect((await db.collection('cashEntries').where('transferOperationId','==',runId+'-never').get()).empty).toBe(true);});
 it('풍회 사전 거절 감사는 실제 발신 Auth가 읽고 같은 요청은 안정적으로 거절되며 금융·번호는 불변이다',async()=>{await seed();const ph=await login('punghoe','ph-rejected');const request={...input('ph-rejected'),from:'punghoe' as const,to:'taebaek' as const,fromAccountId:toAccountId,toAccountId:fromAccountId,fromPartnerId:toPartnerId,toPartnerId:fromPartnerId,expectedFromRevision:9};await expect(recordInterCompanyTransfer(db,ph.uid,ph.claims,request)).rejects.toMatchObject({details:{operationStatus:'rejected',companyId:'punghoe',operationId:request.operationId}});const receipt=await ref('companyTransferOperations',request.operationId).get();expect(receipt.data()).toMatchObject({status:'rejected',companyId:'punghoe',authUid:ph.uid,createdBy:ph.claims.employeeId,command:request});expect((await getDoc(doc(ph.store,'companyTransferOperations',request.operationId))).exists()).toBe(true);await expect(getDoc(doc(web,'companyTransferOperations',request.operationId))).rejects.toMatchObject({code:'permission-denied'});await ref('appMeta','releaseCutover').update({status:'paused'});await expect(recordInterCompanyTransfer(db,ph.uid,ph.claims,request)).rejects.toMatchObject({details:{operationStatus:'rejected'}});expect((await receipt.ref.get()).updateTime!.isEqual(receipt.updateTime!)).toBe(true);for(const company of ['taebaek','punghoe'])expect((await ref('appMeta','voucherNo_'+company+'_'+date+'_general').get()).get('last')).toBe(0);expect((await ref('cashEntries',request.operationId+'-out').get()).exists).toBe(false);expect((await ref('cashEntries',request.operationId+'-in').get()).exists).toBe(false);});
});
