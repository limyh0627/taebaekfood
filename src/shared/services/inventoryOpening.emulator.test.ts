import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { createInventoryOpening } from '../../../functions/src/inventoryOpeningCommand';
import { executeFinancialOpening, type FinancialOpeningInput } from '../../../functions/src/financialOpeningCommand';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { operationDocId } from '../rawInventoryCore';
import { buildJournals } from '../buildJournals';
import { trialBalance } from '../journal';
import type { CashAccount, IssuedStatement, AccountCode } from '../types';
import type { LoanContract } from '../loanLedger';

vi.mock('../firebase', () => ({ db: null, auth: { currentUser: null }, authReady: Promise.resolve() }));
const { saveOpeningBalancesWithDb, createOpeningAccountCodeWithDb } = await import('./firebaseService');
const ready = await fetch('http://127.0.0.1:8082/', { signal: AbortSignal.timeout(1500) }).then(r => r.status < 500).catch(() => false);
let env: RulesTestEnvironment;
let admin: ReturnType<typeof initializeAdminApp>;
let adminDb: ReturnType<typeof getAdminFirestore>;
const releaseId='mixed-opening-test';
const inventory=(_store:Firestore,companyId:'taebaek'|'punghoe',date:string,itemId:string,quantity:number,value:number)=>createInventoryOpening(adminDb,{uid:'inventory-admin',token:{companyId,isAdmin:true}},{companyId,date,itemId,quantity,value,releaseId});
const financial=(input:Omit<FinancialOpeningInput,'companyId'|'operationId'|'releaseId'>)=>executeFinancialOpening(adminDb,'punghoe','inventory-admin',{...input,companyId:'punghoe',operationId:'mixed-'+input.kind,releaseId} as FinancialOpeningInput);
const createCashAccountWithOpeningWithDb=(_store:Firestore,_company:string,account:CashAccount)=>financial({kind:'account-create',account} as any);
const createOpeningPartnerBalanceWithDb=(_store:Firestore,_company:string,date:string,partnerId:string,code:'108',amount:number)=>financial({kind:'partner-create',date,partnerId,code,amount} as any);
const createLoanWithOpeningWithDb=(_store:Firestore,_company:string,loan:LoanContract)=>financial({kind:'loan-create',loan} as any);
const date = '2026-07-31';

describe.skipIf(!ready)('품목별 기초 재고 (Firestore Emulator)', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-inventory-opening', firestore: {
      rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8082,
    } });
    admin=initializeAdminApp({projectId:'demo-inventory-opening'},'mixed-opening-admin');adminDb=getAdminFirestore(admin);
  }, 90_000);
  beforeEach(async () => {
    await env.clearFirestore();
    await adminDb.doc('appMeta/releaseCutover').set({status:'active',releaseId});
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'openingBalances', 'main-punghoe'), {
        id: 'main-punghoe', companyId: 'punghoe', date, amounts: {},
      });
      await setDoc(doc(ctx.firestore(), 'items', 'can1'), {
        id: 'can1', companyId: 'punghoe', name: '참기름 캔', type: 'wip', unit: '캔', spec: '16.5kg', stock: 0, lots: [],
      });
      await setDoc(doc(ctx.firestore(), 'items', 'raw1'), {
        id: 'raw1', companyId: 'punghoe', name: '참깨', type: 'raw', subtype: '벌크', unit: 'kg', stock: 0, lots: [],
      });
    });
  });
  afterAll(async () => { await env?.cleanup();if(admin)await deleteAdminApp(admin); });
  const store = () => env.authenticatedContext('inventory-admin', { employeeId: 'admin', companyId: 'punghoe', isAdmin: true }).firestore() as unknown as Firestore;

  it('빈 회사의 명시 계정 등록·재시도·충돌·권한과 실제 122 기초 장부를 연결한다', async () => {
    await env.clearFirestore();
    const account: AccountCode = { id: 'opening-account-punghoe-122', code: '122', name: '비품', type: '자산', normalBalance: 'debit' };
    expect(await createOpeningAccountCodeWithDb(store(), 'punghoe', account)).toBe('created');
    await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'accountCodes', account.id), { auditNote: '보존' }, { merge: true }); });
    expect(await createOpeningAccountCodeWithDb(store(), 'punghoe', account)).toBe('unchanged');
    await expect(createOpeningAccountCodeWithDb(store(), 'punghoe', { ...account, name: '다른 이름' })).rejects.toThrow('다른 회사 또는 내용');
    const foreign = env.authenticatedContext('foreign-admin', { employeeId: 'foreign', companyId: 'taebaek', isAdmin: true }).firestore() as unknown as Firestore;
    const staff = env.authenticatedContext('staff', { employeeId: 'staff', companyId: 'punghoe', isAdmin: false }).firestore() as unknown as Firestore;
    await expect(createOpeningAccountCodeWithDb(foreign, 'punghoe', account)).rejects.toThrow();
    await expect(createOpeningAccountCodeWithDb(staff, 'punghoe', { ...account, id: 'opening-account-punghoe-123', code: '123' })).rejects.toThrow();
    await saveOpeningBalancesWithDb(store(), 'punghoe', date, { '122': 50000 });
    const saved = (await getDoc(doc(store(), 'accountCodes', account.id))).data()!;
    expect(saved).toEqual({ ...account, companyId: 'punghoe', auditNote: '보존' });
    const opening = (await getDoc(doc(store(), 'openingBalances', 'main-punghoe'))).data()!;
    const journal = buildJournals({ statements: [], accounts: [account], opening: { date: opening.date, lines: [{ accountCode: '122', amount: opening.amounts['122'] }] } });
    expect(trialBalance(journal.entries, [account]).rows.find(row => row.accountCode === '122')?.balance).toBe(50000);
  });

  it('캔 수량·로트·실사 앵커·회계 전표를 함께 만들고 같은 요청은 중복하지 않는다', async () => {
    expect(await inventory(store(), 'punghoe', date, 'can1', 15, 247_500)).toBe('created');
    expect(await inventory(store(), 'punghoe', date, 'can1', 15, 247_500)).toBe('unchanged');
    await expect(inventory(store(), 'punghoe', date, 'can1', 16, 247_500)).rejects.toThrow('다른 내용');
    const item = (await getDoc(doc(store(), 'items', 'can1'))).data()!;
    expect(item.stock).toBe(15);
    expect(item.lots[0].qtyRemaining).toBe(15);
    expect(item.stocktakeAnchors[0]).toMatchObject({ date, targetQty: 15, note: '기초 재고' });
    expect((await getDoc(doc(store(), 'issuedStatements', 'opening-inventory-punghoe-can1'))).data()?.totalAmount).toBe(247_500);
    expect((await getDoc(doc(store(), 'openingBalances', 'main-punghoe'))).data()?.hasInventoryOpening).toBe(true);
    await expect(saveOpeningBalancesWithDb(store(), 'punghoe', '2026-08-01', {})).rejects.toThrow('기준일');
    await expect(saveOpeningBalancesWithDb(store(), 'punghoe', date, { '146': 247_500 })).rejects.toThrow('146');
  });

  it('벌크 원료 상태·로트·실제 원장과 회계 전표를 같은 작업으로 만든다', async () => {
    expect(await inventory(store(), 'punghoe', date, 'raw1', 80, 160_000)).toBe('created');
    expect(await inventory(store(), 'punghoe', date, 'raw1', 80, 160_000)).toBe('unchanged');
    await expect(inventory(store(), 'punghoe', date, 'raw1', 81, 160_000)).rejects.toThrow('다른 내용');
    const item = (await getDoc(doc(store(), 'items', 'raw1'))).data()!;
    const state = (await getDoc(doc(store(), 'rawInventories', 'punghoe__raw1'))).data()!;
    const ledger = (await getDoc(doc(store(), 'rawMaterialLedger', operationDocId('opening-inventory:punghoe:raw1')))).data()!;
    expect(item.stock).toBe(80);
    expect(state.stockKg).toBe(80);
    expect(state.activeLots[0].kgRemaining).toBe(80);
    expect(ledger).toMatchObject({ kind: 'opening', received: 80, balanceAfterKg: 80, rawItemId: 'raw1' });
    expect((await getDoc(doc(store(), 'issuedStatements', 'opening-inventory-punghoe-raw1'))).data()?.totalAmount).toBe(160_000);
  });

  it('기존 재고·수기 146 금액·다른 회사를 거절하며 문서를 일부만 남기지 않는다', async () => {
    await expect(inventory(store(), 'taebaek', date, 'can1', 1, 10)).rejects.toThrow('회사');
    await expect(inventory(store(), 'punghoe', date, 'can1', 1.5, 10)).rejects.toThrow('정수');
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'items', 'can1'), { stock: 2 }, { merge: true });
    });
    await expect(inventory(store(), 'punghoe', date, 'can1', 1, 10)).rejects.toThrow('이미 재고');
    expect((await getDoc(doc(store(), 'issuedStatements', 'opening-inventory-punghoe-can1'))).exists()).toBe(false);
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'items', 'can1'), { stock: 0 }, { merge: true });
      await setDoc(doc(ctx.firestore(), 'openingBalances', 'main-punghoe'), { amounts: { '146': 10 } }, { merge: true });
    });
    await expect(inventory(store(), 'punghoe', date, 'can1', 1, 10)).rejects.toThrow('이중계상');
  });

  it('빈 회사에서 계좌·거래처·대출·재고 기초를 앱 명령으로 연결하면 장부 차대가 일치한다', async () => {
    await env.clearFirestore();
    await adminDb.doc('appMeta/releaseCutover').set({status:'active',releaseId});
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'partners', 'p1'), { id: 'p1', companyId: 'punghoe', name: '기초 거래처' });
      await setDoc(doc(ctx.firestore(), 'items', 'can1'), {
        id: 'can1', companyId: 'punghoe', name: '참기름 캔', type: 'wip', unit: '캔', stock: 0, lots: [],
      });
    });
    const bank: CashAccount = { id: 'bank1', companyId: 'punghoe', name: '운영 통장', type: '통장', openingDate: date,
      openingBalance: 100_000, active: true, createdAt: '2026-08-01T00:00:00+09:00' };
    const loan: LoanContract = { id: 'loan1', companyId: 'punghoe', name: '운전자금', lenderName: '은행',
      accountCode: '293', openingDate: date, openingPrincipal: 200_000, createdAt: '2026-08-01T00:00:00+09:00' };
    expect(await createCashAccountWithOpeningWithDb(store(), 'punghoe', bank)).toBe('created');
    expect(await createOpeningPartnerBalanceWithDb(store(), 'punghoe', date, 'p1', '108', 50_000)).toBe('created');
    expect(await createLoanWithOpeningWithDb(store(), 'punghoe', loan)).toBe('created');
    expect(await inventory(store(), 'punghoe', date, 'can1', 5, 75_000)).toBe('created');
    const ids = ['opening-cash-punghoe-bank1', `opening-partner-punghoe-${date}-p1-108`,
      'opening-loan-punghoe-loan1', 'opening-inventory-punghoe-can1'];
    const statements = await Promise.all(ids.map(async id => (await getDoc(doc(store(), 'issuedStatements', id))).data() as IssuedStatement));
    const journal = buildJournals({ statements, accounts: [], opening: { date, lines: [] } });
    const balance = trialBalance(journal.entries, [] as AccountCode[]);
    expect(journal.skipped).toEqual([]);
    expect(balance.balanced).toBe(true);
    expect(balance.rows.find(row => row.accountCode === '146')?.balance).toBe(75_000);
    expect(balance.rows.find(row => row.accountCode === '108')?.balance).toBe(50_000);
    expect(balance.rows.find(row => row.accountCode === '293')?.credit).toBe(200_000);
    expect((await getDoc(doc(store(), 'openingBalances', 'main-punghoe'))).data()).toMatchObject({
      date, hasCashOpening: true, hasPartnerOpening: true, hasLoanOpening: true, hasInventoryOpening: true,
    });
  });
});
