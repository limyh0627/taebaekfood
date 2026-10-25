import {randomUUID} from 'node:crypto';
import {createEmulatorTestPolicy,cleanupOwnedResources} from '../../test/emulatorTestPolicy';
let initializeAdminApp:typeof import('firebase-admin/app').initializeApp;
let deleteAdminApp:typeof import('firebase-admin/app').deleteApp;
let getAdminFirestore:typeof import('firebase-admin/firestore').getFirestore;
let executeFinancialOpening:typeof import('../../../functions/src/financialOpeningCommand').executeFinancialOpening;
let assertFails:typeof import('@firebase/rules-unit-testing').assertFails;
let initializeTestEnvironment:typeof import('@firebase/rules-unit-testing').initializeTestEnvironment;
let doc:typeof import('firebase/firestore').doc;
let getDoc:typeof import('firebase/firestore').getDoc;
let setDoc:typeof import('firebase/firestore').setDoc;
let saveOpeningBalancesWithDb:typeof import('./firebaseService').saveOpeningBalancesWithDb;
const policy=createEmulatorTestPolicy(process.env,'loanOpening',randomUUID);
async function loadRuntime(){
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(policy.projectId);
  ({initializeApp:initializeAdminApp, deleteApp:deleteAdminApp}=await import('firebase-admin/app'));
  ({getFirestore:getAdminFirestore}=await import('firebase-admin/firestore'));
  ({executeFinancialOpening}=await import('../../../functions/src/financialOpeningCommand'));
  ({assertFails, initializeTestEnvironment}=await import('@firebase/rules-unit-testing'));
  ({doc, getDoc, setDoc}=await import('firebase/firestore'));
  ({saveOpeningBalancesWithDb}=await import('./firebaseService'));
  policy.assertCurrentEnvironment(process.env);
}
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';


import type { FinancialOpeningInput } from '../../../functions/src/financialOpeningCommand';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import type { LoanContract } from '../loanLedger';

vi.mock('../firebase', () => ({ db: null, functions: null, auth: { currentUser: null }, authReady: Promise.resolve() }));
vi.mock('firebase/functions',()=>({httpsCallable:()=>{throw new Error('이 시험은 callable 경로를 사용하지 않습니다.');}}));
let env: RulesTestEnvironment;
let admin:ReturnType<typeof initializeAdminApp>;
let adminDb:ReturnType<typeof getAdminFirestore>;
async function clearOwned(){
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
  if(admin)policy.assertOwned(admin.options.projectId!);
  await env.clearFirestore();
}
let attempt=0;
const releaseId='opening-test-release';
const createLoanOpening=(_store:Firestore,companyId:'taebaek'|'punghoe',loan: LoanContract)=>executeFinancialOpening(adminDb,companyId,'loan-admin',{...{kind:'loan-create',loan},companyId,operationId:'demo-loan-opening-'+(++attempt),releaseId} as FinancialOpeningInput);
const loan = (id: string, amount = 1_000_000): LoanContract => ({
  id, companyId: 'punghoe', name: '운전자금', lenderName: '은행', accountCode: '293',
  openingDate: '2026-07-31', openingPrincipal: amount, createdAt: '2026-08-01T00:00:00+09:00',
});

describe.skipIf(!policy.enabled)('대출 시작 원금 (Firestore Emulator)', () => {
  beforeAll(async () => {
    await loadRuntime();
    env = await initializeTestEnvironment({ projectId:policy.projectId, firestore: {
      rules: readFileSync('firestore.rules', 'utf8'), host:policy.host, port:policy.port,
    } });
    policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
    admin=initializeAdminApp({projectId:policy.projectId},policy.appName);policy.assertOwned(admin.options.projectId!);adminDb=getAdminFirestore(admin);
    await clearOwned();
    await adminDb.doc('appMeta/releaseCutover').set({status:'active',releaseId});
    await env.withSecurityRulesDisabled(async ctx => {
      const store = ctx.firestore();
      await setDoc(doc(store, 'openingBalances', 'main-punghoe'), { companyId: 'punghoe', date: '2026-07-31', amounts: {} });
      await setDoc(doc(store, 'partners', 'foreign'), { companyId: 'taebaek', name: '다른 회사 은행' });
    });
  }, 90_000);
  afterAll(async () => {await cleanupOwnedResources([async()=>{if(env)await clearOwned();},()=>env?.cleanup(),()=>admin&&deleteAdminApp(admin)]);});
  const store = () => env.authenticatedContext('loan-admin', { employeeId: 'admin', companyId: 'punghoe', isAdmin: true }).firestore() as unknown as Firestore;

  it('계약과 기초 전표를 함께 저장하고 동일 요청만 멱등 성공한다', async () => {
    const row = loan('opening-1');
    expect(await createLoanOpening(store(), 'punghoe', row)).toBe('created');
    const replay={...{kind:'loan-create',loan:row},companyId:'punghoe',operationId:'demo-loan-opening-'+attempt,releaseId} as FinancialOpeningInput;
    expect(await executeFinancialOpening(adminDb,'punghoe','loan-admin',replay)).toBe('created');
    const proof=(await getDoc(doc(store(),'financialOpeningOperations',replay.operationId))).data();
    expect(proof).toMatchObject({companyId:'punghoe',createdBy:'loan-admin',kind:replay.kind,status:'applied',result:'created'});
    await expect(executeFinancialOpening(adminDb,'punghoe','other-user',replay)).rejects.toThrow('원문이 다릅니다');
    expect(await createLoanOpening(store(), 'punghoe', row)).toBe('unchanged');
    await expect(createLoanOpening(store(), 'punghoe', { ...row, openingPrincipal: 2_000_000 })).rejects.toThrow('다른 내용');
    expect((await getDoc(doc(store(), 'loanContracts', row.id))).data()?.openingPrincipal).toBe(1_000_000);
    expect((await getDoc(doc(store(), 'issuedStatements', `opening-loan-punghoe-${row.id}`))).data()?.totalAmount).toBe(1_000_000);
    expect((await getDoc(doc(store(), 'openingBalances', 'main-punghoe'))).data()?.hasLoanOpening).toBe(true);
    expect(await createLoanOpening(store(), 'punghoe', loan('opening-2', 500_000))).toBe('created');
    expect((await getDoc(doc(store(), 'issuedStatements', 'opening-loan-punghoe-opening-2'))).data()?.totalAmount).toBe(500_000);
  });
  it('연결된 대출이 있으면 기초일과 대출 계정 합계를 바꾸지 못한다', async () => {
    await expect(saveOpeningBalancesWithDb(store(), 'punghoe', '2026-08-01', {})).rejects.toThrow('기준일');
    await expect(saveOpeningBalancesWithDb(store(), 'punghoe', '2026-07-31', { '293': 1_000_000 })).rejects.toThrow('직접 변경');
  });
  it('기초일 불일치·다른 회사 금융기관을 거절한다', async () => {
    await expect(createLoanOpening(store(), 'punghoe', { ...loan('wrong-date'), openingDate: '2026-08-01' })).rejects.toThrow('회계 기초잔액');
    await expect(createLoanOpening(store(), 'punghoe', { ...loan('foreign'), partnerId: 'foreign' })).rejects.toThrow('다른 회사 금융기관');
    await assertFails(getDoc(doc(store(),'partners','foreign')));
    expect((await getDoc(doc(store(), 'loanContracts', 'wrong-date'))).exists()).toBe(false);
  });
  it('신규 차입용 시작 원금 0원은 계약만 저장한다', async () => {
    expect(await createLoanOpening(store(), 'punghoe', loan('new-borrowing', 0))).toBe('created');
    expect((await getDoc(doc(store(), 'issuedStatements', 'opening-loan-punghoe-new-borrowing'))).exists()).toBe(false);
  });
});
