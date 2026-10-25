import {randomUUID} from 'node:crypto';
import {createEmulatorTestPolicy,cleanupOwnedResources} from '../../test/emulatorTestPolicy';
let initializeTestEnvironment:typeof import('@firebase/rules-unit-testing').initializeTestEnvironment;
let doc:typeof import('firebase/firestore').doc;
let getDoc:typeof import('firebase/firestore').getDoc;
let setDoc:typeof import('firebase/firestore').setDoc;
let cashOpeningStatement:typeof import('../cashOpening').cashOpeningStatement;
let loanOpeningStatement:typeof import('../financialOpening').loanOpeningStatement;
let initializeApp:typeof import('firebase-admin/app').initializeApp;
let deleteApp:typeof import('firebase-admin/app').deleteApp;
let getFirestore:typeof import('firebase-admin/firestore').getFirestore;
let executeFinancialOpeningForActor:typeof import('../../../functions/src/financialOpeningCommand').executeFinancialOpeningForActor;
const policy=createEmulatorTestPolicy(process.env,'financialOpeningEdit',randomUUID);
async function loadRuntime(){
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(policy.projectId);
  ({initializeTestEnvironment}=await import('@firebase/rules-unit-testing'));
  ({doc,getDoc,setDoc}=await import('firebase/firestore'));
  ({cashOpeningStatement}=await import('../cashOpening'));
  ({loanOpeningStatement}=await import('../financialOpening'));
  ({initializeApp,deleteApp}=await import('firebase-admin/app'));
  ({getFirestore}=await import('firebase-admin/firestore'));
  ({executeFinancialOpeningForActor}=await import('../../../functions/src/financialOpeningCommand'));
  policy.assertCurrentEnvironment(process.env);
}
async function clearOwned(){
  policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
  if(app)policy.assertOwned(app.options.projectId!);
  await env.clearFirestore();
}
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type {RulesTestEnvironment} from '@firebase/rules-unit-testing';
import type {Firestore} from 'firebase/firestore';
import type { CashAccount, CashEntry } from '../types';
import type { LoanContract } from '../loanLedger';


vi.mock('../firebase', () => ({ db: null, functions: null, auth: { currentUser: null }, authReady: Promise.resolve() }));
vi.mock('firebase/functions',()=>({httpsCallable:()=>{throw new Error('이 시험은 callable 경로를 사용하지 않습니다.');}}));
import type {App} from 'firebase-admin/app';

import type {FinancialOpeningInput} from '../../../functions/src/financialOpeningCommand';
let app:App;
const actors=new WeakMap<Firestore,{uid:string;token:{companyId:string;isAdmin:boolean}}>();
const execute=(store:Firestore,companyId:'taebaek'|'punghoe',body:Omit<Extract<FinancialOpeningInput,{kind:'loan-update'}>,'companyId'|'operationId'|'releaseId'>|Omit<Extract<FinancialOpeningInput,{kind:'account-update'}>,'companyId'|'operationId'|'releaseId'>)=>executeFinancialOpeningForActor(getFirestore(app),actors.get(store),{...body,companyId,operationId:crypto.randomUUID(),releaseId:'release'});
const updateLoanOpeningWithDb=(store:Firestore,companyId:'taebaek'|'punghoe',original:LoanContract,newDate:string,targetBalance:number)=>execute(store,companyId,{kind:'loan-update',original,newDate,targetBalance});
const updateCashAccountOpeningWithDb=(store:Firestore,companyId:'taebaek'|'punghoe',original:CashAccount,name:string,newDate:string,targetBalance:number,asOf='2026-10-09')=>execute(store,companyId,{kind:'account-update',original,name,newDate,targetBalance,asOf});
let env: RulesTestEnvironment;
describe.skipIf(!policy.enabled)('계좌·대출 수정 실제 Firestore 저장', () => {
beforeAll(async () => {
 await loadRuntime();
 env = await initializeTestEnvironment({ projectId:policy.projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8'), host:policy.host, port:policy.port } });
 policy.assertCurrentEnvironment(process.env);policy.assertOwned(env.projectId);
 app=initializeApp({projectId:policy.projectId},policy.appName);policy.assertOwned(app.options.projectId!);
 await clearOwned();
 await getFirestore(app).doc('appMeta/releaseCutover').set({status:'active',releaseId:'release'});
}, 30000);
afterAll(async () => {await cleanupOwnedResources([async()=>{if(env)await clearOwned();},()=>env?.cleanup(),()=>app&&deleteApp(app)]);});
const store = (companyId = 'punghoe', isAdmin = true) => {const store=env.authenticatedContext(`${companyId}-${isAdmin}`, { employeeId: 'editor', companyId, isAdmin }).firestore() as unknown as Firestore;actors.set(store,{uid:`${companyId}-${isAdmin}`,token:{companyId,isAdmin}});return store;};
const account = (id: string): CashAccount => ({ id, companyId: 'punghoe', name: '농협', type: '통장', openingDate: '2026-07-31', openingBalance: 1000, active: true, createdAt: '2026-08-01T00:00:00Z' });
const loan = (id: string): LoanContract => ({ id, companyId: 'punghoe', name: '중진공', lenderName: '중진공', accountCode: '293', openingDate: '2026-07-31', openingPrincipal: 1000, createdAt: '2026-08-01T00:00:00Z' });
async function seed(rows: Array<[string, unknown]>) {
 await env.withSecurityRulesDisabled(async context => { for (const [path, value] of rows) await setDoc(doc(context.firestore(), path), value as Record<string, unknown>); });
}
it('실제 관리자 SDK로 전표 없는 기존 계좌와 대출의 날짜·잔액을 수정한다', async () => {
 const bank = account('legacy-bank'), contract = loan('legacy-loan');
 const { id: _bankId, ...storedBank } = bank;
 const { id: _loanId, ...storedLoan } = contract;
 await seed([[`cashAccounts/${bank.id}`, storedBank], [`loanContracts/${contract.id}`, storedLoan]]);
 await updateCashAccountOpeningWithDb(store(), 'punghoe', bank, '농협 메인', '2026-09-01', -500, '2026-10-07');
 await updateLoanOpeningWithDb(store(), 'punghoe', contract, '2026-09-01', 500);
 expect((await getDoc(doc(store(), 'cashAccounts', bank.id))).data()).toMatchObject({ name: '농협 메인', openingDate: '2026-09-01', openingBalance: -500 });
 expect((await getDoc(doc(store(), 'loanContracts', contract.id))).data()).toMatchObject({ openingDate: '2026-09-01', openingPrincipal: 500 });
 expect((await getDoc(doc(store(), 'issuedStatements', `opening-cash-punghoe-${bank.id}`))).exists()).toBe(false);
 expect((await getDoc(doc(store(), 'issuedStatements', `opening-loan-punghoe-${contract.id}`))).exists()).toBe(false);
});
it('실제 거래와 기초 전표가 있는 계좌를 같은 transaction으로 맞춘다', async () => {
 const bank = account('linked-bank');
 const entry = (id: string, date: string, dir: CashEntry['dir'], amount: number) => ({ id, companyId: 'punghoe', cashAccountId: bank.id, date, dir, amount, accountCode: '601', createdAt: `${date}T00:00:00Z` });
 await seed([[`cashAccounts/${bank.id}`, bank], [`issuedStatements/opening-cash-punghoe-${bank.id}`, cashOpeningStatement(bank)], ['cashEntries/bank-old', entry('bank-old', '2026-08-01', '출금', 200)], ['cashEntries/bank-new', entry('bank-new', '2026-09-01', '입금', 100)]]);
 await updateCashAccountOpeningWithDb(store(), 'punghoe', bank, '새 계좌명', '2026-08-10', 500, '2026-10-07');
 expect((await getDoc(doc(store(), 'cashAccounts', bank.id))).data()?.openingBalance).toBe(400);
 expect((await getDoc(doc(store(), 'issuedStatements', `opening-cash-punghoe-${bank.id}`))).data()).toMatchObject({ tradeDate: '2026-07-31', totalAmount: 600, docNo: `기초계좌-${bank.id}` });
});
it('대출 기초 전표와 서버 원금 버전을 함께 갱신한다', async () => {
 const contract = { ...loan('linked-loan'), movementRevision: 2, principalBalance: 700 };
 const entry = (id: string, date: string, amount: number) => ({ id, companyId: 'punghoe', loanId: contract.id, date, dir: '출금', amount, accountCode: '293', createdAt: `${date}T00:00:00Z` });
 await seed([[`loanContracts/${contract.id}`, contract], [`issuedStatements/opening-loan-punghoe-${contract.id}`, loanOpeningStatement(contract)], ['cashEntries/loan-old', entry('loan-old', '2026-08-01', 200)], ['cashEntries/loan-new', entry('loan-new', '2026-09-01', 100)]]);
 await updateLoanOpeningWithDb(store(), 'punghoe', contract, '2026-08-10', 500);
 expect((await getDoc(doc(store(), 'loanContracts', contract.id))).data()).toMatchObject({ openingPrincipal: 600, principalBalance: 500, movementRevision: 3 });
 expect((await getDoc(doc(store(), 'issuedStatements', `opening-loan-punghoe-${contract.id}`))).data()).toMatchObject({ tradeDate: '2026-07-31', totalAmount: 800 });
 await expect(updateLoanOpeningWithDb(store(), 'punghoe', contract, '2026-08-10', 400)).rejects.toThrow('변경');
 expect((await getDoc(doc(store(), 'loanContracts', contract.id))).data()?.principalBalance).toBe(500);
});
it('직원 또는 다른 회사 관리자에게 수정 권한이 없고 원본도 보존된다', async () => {
 const bank = account('protected-bank'), contract = loan('protected-loan');
 await seed([[`cashAccounts/${bank.id}`, bank], [`loanContracts/${contract.id}`, contract]]);
 await expect(updateCashAccountOpeningWithDb(store('punghoe', false), 'punghoe', bank, bank.name, bank.openingDate, 1)).rejects.toThrow();
 await expect(updateLoanOpeningWithDb(store('taebaek'), 'punghoe', contract, contract.openingDate, 1)).rejects.toThrow();
 expect((await getDoc(doc(store(), 'cashAccounts', bank.id))).data()?.openingBalance).toBe(1000);
 expect((await getDoc(doc(store(), 'loanContracts', contract.id))).data()?.openingPrincipal).toBe(1000);
});
});
