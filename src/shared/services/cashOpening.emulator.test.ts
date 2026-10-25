import {randomUUID} from 'node:crypto';
import {createEmulatorTestPolicy,cleanupOwnedResources} from '../../test/emulatorTestPolicy';
let initializeAdminApp:typeof import('firebase-admin/app').initializeApp;
let deleteAdminApp:typeof import('firebase-admin/app').deleteApp;
let getAdminFirestore:typeof import('firebase-admin/firestore').getFirestore;
let executeFinancialOpening:typeof import('../../../functions/src/financialOpeningCommand').executeFinancialOpening;
let initializeTestEnvironment:typeof import('@firebase/rules-unit-testing').initializeTestEnvironment;
let doc:typeof import('firebase/firestore').doc;
let getDoc:typeof import('firebase/firestore').getDoc;
let setDoc:typeof import('firebase/firestore').setDoc;
let saveOpeningBalancesWithDb:typeof import('./firebaseService').saveOpeningBalancesWithDb;
const policy=createEmulatorTestPolicy(process.env,'cashOpening',randomUUID);
async function loadRuntime(){
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(policy.projectId);
  ({initializeApp:initializeAdminApp, deleteApp:deleteAdminApp}=await import('firebase-admin/app'));
  ({getFirestore:getAdminFirestore}=await import('firebase-admin/firestore'));
  ({executeFinancialOpening}=await import('../../../functions/src/financialOpeningCommand'));
  ({initializeTestEnvironment}=await import('@firebase/rules-unit-testing'));
  ({doc, getDoc, setDoc}=await import('firebase/firestore'));
  ({saveOpeningBalancesWithDb}=await import('./firebaseService'));
  policy.assertCurrentEnvironment(process.env);
}
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';


import type { FinancialOpeningInput } from '../../../functions/src/financialOpeningCommand';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import type { CashAccount } from '../types';

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
const createCashOpening=(_store:Firestore,companyId:'taebaek'|'punghoe',account: CashAccount)=>executeFinancialOpening(adminDb,companyId,'cash-admin',{...{kind:'account-create',account},companyId,operationId:'demo-cash-opening-'+(++attempt),releaseId} as FinancialOpeningInput);
const account = (id: string, type: CashAccount['type'] = '통장', amount = 100_000): CashAccount => ({
  id, companyId: 'punghoe', name: id, type, openingDate: '2026-07-31',
  openingBalance: amount, active: true, createdAt: '2026-08-01T00:00:00+09:00',
});

describe.skipIf(!policy.enabled)('계좌 기초잔액 (Firestore Emulator)', () => {
  beforeAll(async () => {
    await loadRuntime();
    env = await initializeTestEnvironment({ projectId:policy.projectId, firestore: {
      rules: readFileSync('firestore.rules', 'utf8'), host:policy.host, port:policy.port,
    } });
    policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
    admin=initializeAdminApp({projectId:policy.projectId},policy.appName);policy.assertOwned(admin.options.projectId!);adminDb=getAdminFirestore(admin);
  }, 90_000);
  beforeEach(async () => { await clearOwned();await adminDb.doc('appMeta/releaseCutover').set({status:'active',releaseId}); });
  afterAll(async () => {await cleanupOwnedResources([async()=>{if(env)await clearOwned();},()=>env?.cleanup(),()=>admin&&deleteAdminApp(admin)]);});
  const store = () => env.authenticatedContext('cash-admin', { employeeId: 'admin', companyId: 'punghoe', isAdmin: true }).firestore() as unknown as Firestore;

  it('첫 계좌와 회계 기초일·전표를 함께 만들고 재시도는 중복되지 않는다', async () => {
    const row = account('bank1');
    expect(await createCashOpening(store(), 'punghoe', row)).toBe('created');
    const replay={...{kind:'account-create',account:row},companyId:'punghoe',operationId:'demo-cash-opening-'+attempt,releaseId} as FinancialOpeningInput;
    expect(await executeFinancialOpening(adminDb,'punghoe','cash-admin',replay)).toBe('created');
    const proof=(await getDoc(doc(store(),'financialOpeningOperations',replay.operationId))).data();
    expect(proof).toMatchObject({companyId:'punghoe',createdBy:'cash-admin',kind:replay.kind,status:'applied',result:'created'});
    await expect(executeFinancialOpening(adminDb,'punghoe','other-user',replay)).rejects.toThrow('원문이 다릅니다');
    expect(await createCashOpening(store(), 'punghoe', row)).toBe('unchanged');
    await expect(createCashOpening(store(), 'punghoe', { ...row, openingBalance: 200_000 })).rejects.toThrow('다른 내용');
    expect((await getDoc(doc(store(), 'cashAccounts', 'bank1'))).data()?.openingBalance).toBe(100_000);
    expect((await getDoc(doc(store(), 'issuedStatements', 'opening-cash-punghoe-bank1'))).data()?.totalAmount).toBe(100_000);
    const opening = (await getDoc(doc(store(), 'openingBalances', 'main-punghoe'))).data();
    expect(opening).toMatchObject({ date: '2026-07-31', amounts: {}, hasCashOpening: true });
    expect(await createCashOpening(store(), 'punghoe', account('cash1', '현금', 20_000))).toBe('created');
    expect((await getDoc(doc(store(), 'issuedStatements', 'opening-cash-punghoe-cash1'))).data()?.items?.[0]?.accountCode).toBe('102');
  });
  it('연결된 계좌가 있으면 기초일과 현금·예금 합계를 바꾸지 못한다', async () => {
    await createCashOpening(store(), 'punghoe', account('bank2'));
    await expect(saveOpeningBalancesWithDb(store(), 'punghoe', '2026-08-01', {})).rejects.toThrow('기준일');
    await expect(saveOpeningBalancesWithDb(store(), 'punghoe', '2026-07-31', { '103': 100_000 })).rejects.toThrow('직접 변경');
    await expect(createCashOpening(store(), 'punghoe', { ...account('late'), openingDate: '2026-08-01' })).rejects.toThrow('기초일');
  });
  it('기존 계좌가 있는데 회계 기초잔액이 없거나 수기 합계가 안 맞으면 멈춘다', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'cashAccounts', 'legacy'), account('legacy'));
    });
    await expect(createCashOpening(store(), 'punghoe', account('new'))).rejects.toThrow('기존 계좌');
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'openingBalances', 'main-punghoe'), { companyId: 'punghoe', date: '2026-07-31', amounts: { '103': 90_000 } });
    });
    await expect(createCashOpening(store(), 'punghoe', account('new'))).rejects.toThrow('합계');
    await saveOpeningBalancesWithDb(store(), 'punghoe', '2026-07-31', { '103': 100_000 });
    expect(await createCashOpening(store(), 'punghoe', account('new'))).toBe('created');
  });
  it('없는 날짜는 계좌와 수기 기초잔액 양쪽에서 거절하고 문서를 남기지 않는다', async () => {
    await expect(createCashOpening(store(), 'punghoe', {
      ...account('invalid-day'), openingDate: '2026-02-29', openingBalance: 0,
    })).rejects.toThrow('기초일');
    await expect(saveOpeningBalancesWithDb(store(), 'punghoe', '2026-04-31', {})).rejects.toThrow('기초일');
    expect((await getDoc(doc(store(), 'cashAccounts', 'invalid-day'))).exists()).toBe(false);
    expect((await getDoc(doc(store(), 'openingBalances', 'main-punghoe'))).exists()).toBe(false);
  });

  it('다른 회사 계좌와 카드 기초잔액을 거절한다', async () => {
    await expect(createCashOpening(store(), 'punghoe', { ...account('wrong'), companyId: 'taebaek' })).rejects.toThrow('회사');
    await expect(createCashOpening(store(), 'punghoe', account('card', '카드'))).rejects.toThrow('카드');
  });
});
