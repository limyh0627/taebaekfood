import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import {appendFileSync,writeFileSync} from 'node:fs';
import { cashOriginalHash, mutateCashEntry } from './cashMutationCommand';
import { issueVoucher, voucherSequenceKey } from './voucherIssue';
import { buildAccountLedger } from './shared/cashAccountLedger';


describe.skipIf(process.env.FAILURE_REPAIR_SDK !== 'true')('격리 로컬 SDK', () => {
const run = `cashbank-${randomUUID()}`;
let app: App, db: Firestore;
const owned=new Set<string>(),planned=new Set<string>(),stem='work/failure-sdk-'+run,sentinelPath='items/'+run+'-sentinel';let sentinel:any;
function markIntent(path:string){appendFileSync(stem+'-paths.jsonl',JSON.stringify({intent:path})+'\n');}
function track(db0:Firestore):Firestore{return new Proxy(db0,{get(target,key){if(key==='runTransaction')return async(fn:any,...options:any[])=>{let writes:string[]=[];const result=await (target.runTransaction as any)(async(tx:any)=>{writes=[];const reads=new Map<string,any>();const wrapped=new Proxy(tx,{get(inner,k){if(k==='get')return async(ref:any)=>{const snap=await inner.get(ref);if(ref.path)reads.set(ref.path,snap);return snap;};if(['create','set','update','delete'].includes(String(k)))return(ref:any,...args:any[])=>{const path=ref.path,snap=reads.get(path);if(!owned.has(path)&&!planned.has(path)&&!path.includes(run))throw Error('unexpected write '+path);if(!owned.has(path)&&k!=='create'&&(!snap||snap.exists))throw Error('write path not proven absent '+path);markIntent(path);writes.push(path);return inner[k](ref,...args);};const v=inner[k];return typeof v==='function'?v.bind(inner):v;}});return fn(wrapped);},...options);for(const path of writes)owned.add(path);return result;};const v=(target as any)[key];return typeof v==='function'?v.bind(target):v;}}) as Firestore;}
async function seed(path:string,row:Record<string,unknown>){markIntent(path);const ref=db.doc(path);if(owned.has(path))await ref.set(row);else{if((await ref.get()).exists)throw Error('seed preexisting '+path);await ref.create(row);owned.add(path);}}
async function start(){if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082'||process.env.GCLOUD_PROJECT!=='demo-failure-repair-20261101'||process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_CONFIG)throw Error('isolated emulator required');writeFileSync(stem+'-paths.jsonl','',{flag:'wx'});app=initializeApp({projectId:'demo-failure-repair-20261101'},run);db=track(getFirestore(app));const ref=db.doc(sentinelPath);if((await ref.get()).exists)throw Error('sentinel exists');await ref.create({marker:run});sentinel=await ref.get();}
async function finish(){if(!db)return;for(const path of owned){await db.doc(path).delete();expect((await db.doc(path).get()).exists,path).toBe(false);}if(sentinel){const snap=await db.doc(sentinelPath).get();expect(snap.data()).toEqual(sentinel.data());expect(snap.updateTime).toEqual(sentinel.updateTime);await db.doc(sentinelPath).delete();expect((await db.doc(sentinelPath).get()).exists).toBe(false);}writeFileSync(stem+'-cleanup.json',JSON.stringify({run,projectId:'demo-failure-repair-20261101',owned:[...owned],planned:[...planned],sentinelPreserved:!!sentinel,allAbsent:true},null,2),{flag:'wx'});await deleteApp(app);}
beforeAll(async()=>{await start();await seed('appMeta/releaseCutover',{status:'active',releaseId:run,voucherNotBefore:{taebaek:'2026-10-03'}});});
afterAll(finish);
const command = (id: string, original: Record<string, unknown>, bank: string, operationId: string) => ({
  action: 'edit' as const, operationId, cashEntryId: id, expectedRevision: 0,
  expectedCashHash: cashOriginalHash(original), releaseId: run, patch: { cashAccountId: bank },
});

it('legacy 260/951 attribution preserves loan/settlement/account versions and confirmed balances', async () => {
  const id = `${run}-legacy`, bankId = `${run}-bank`, op = `${id}-mutation`;
  const original = { companyId: 'taebaek', date: '2026-10-03', dir: '출금', amount: 100, cashAccountId: '', docNo: '261003-legacy',
    lines: [{ accountCode: '260', amount: 80 }, { accountCode: '951', amount: 20 }] };
  const bank = { companyId: 'taebaek' as const, active: true, type: '통장', openingDate: '2026-07-31', openingBalance: 1000,
    confirmedBalances: [{ date: '2026-10-04', balance: 850, recordedAt: '2026-10-04T12:00:00Z', reason: '합성 확인' }] };
  await seed(`cashEntries/${id}`, original); await seed(`cashAccounts/${bankId}`, bank);
  await seed(`loanContracts/${id}`, { companyId: 'taebaek', principalBalance: 900, movementRevision: 5 });
  await seed(`settlements/${id}`, { companyId: 'taebaek', cashEntryId: id, statementId: 'synthetic-source', amount: 100 });
  const stable = await Promise.all([`cashAccounts/${bankId}`, `loanContracts/${id}`, `settlements/${id}`].map(path => db.doc(path).get()));
  planned.add(`voucherMutationOperations/${op}`);
  const input = command(id, original, bankId, op);
  expect(await mutateCashEntry(db, 'taebaek', 'synthetic-uid', input)).toMatchObject({ status: 'applied' });
  expect(await mutateCashEntry(db, 'taebaek', 'synthetic-uid', input)).toMatchObject({ status: 'duplicate' });
  const changed = (await db.doc(`cashEntries/${id}`).get()).data()!;
  expect(changed).toEqual({ ...original, cashAccountId: bankId, mutationRevision: 1 });
  for (const before of stable) { const after = await before.ref.get(); expect(after.data()).toEqual(before.data()); expect(after.updateTime!.isEqual(before.updateTime!)).toBe(true); }
  const account = { ...bank, id: bankId };
  expect(buildAccountLedger(account, [{ ...original, id }] as any, '', '2026-10-03').closing).toBe(1000);
  expect(buildAccountLedger(account, [{ ...changed, id }] as any, '', '2026-10-03').closing).toBe(900);
  expect(buildAccountLedger(account, [{ ...changed, id }] as any, '', '2026-10-04').closing).toBe(850);
});

it('numbered creation replay follows the original beforeSnapshot after assignment without counter changes', async () => {
  const date = '2026-10-05', id = `${run}-issued`, bankId = `${id}-bank`, op = `${id}-mutation`;
  const counter = `appMeta/${voucherSequenceKey('taebaek', date)}`;
  await seed(counter, { companyId: 'taebaek', tradeDate: date, prefix: '', last: 0 });
  await seed(`cashAccounts/${bankId}`, { companyId: 'taebaek', active: true, type: '통장' });
  planned.add(`cashEntries/${id}`); planned.add(`voucherMutationOperations/${op}`);
  const issue = { kind: 'cashEntries' as const, operationId: id, tradeDate: date, releaseId: run,
    document: { date, dir: '출금', amount: 100, cashAccountId: '', accountCode: '802', note: '합성', createdBy: 'synthetic-uid' } };
  const first = await issueVoucher(db, 'taebaek', issue);
  const original = (await db.doc(`cashEntries/${id}`).get()).data()!;
  const request = command(id, original, bankId, op);
  await mutateCashEntry(db, 'taebaek', 'synthetic-uid', request);
  const beforeReplay = await db.doc(counter).get();
  expect(await issueVoucher(db, 'taebaek', issue)).toEqual(first);
  expect(await mutateCashEntry(db, 'taebaek', 'synthetic-uid', request)).toMatchObject({ status: 'duplicate' });
  expect((await db.doc(counter).get()).updateTime!.isEqual(beforeReplay.updateTime!)).toBe(true);
  expect((await db.doc(`cashEntries/${id}`).get()).data()?.cashAccountId).toBe(bankId);
});

it('foreign or inactive account selection rejects without a mutation audit or cash changes', async () => {
  for (const [suffix, bank] of [['foreign', { companyId: 'punghoe', active: true }], ['inactive', { companyId: 'taebaek', active: false }]] as const) {
    const id = `${run}-${suffix}`, bankId = `${id}-bank`, op = `${id}-mutation`;
    const original = { companyId: 'taebaek', date: '2026-10-03', dir: '출금', amount: 100, cashAccountId: '', accountCode: '260' };
    await seed(`cashEntries/${id}`, original); await seed(`cashAccounts/${bankId}`, { ...bank, type: '통장' });
    const before = await db.doc(`cashEntries/${id}`).get();
    await expect(mutateCashEntry(db, 'taebaek', 'synthetic-uid', command(id, original, bankId, op))).rejects.toThrow();
    expect((await before.ref.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);
    planned.add(`voucherMutationOperations/${op}`);
    const rejected = (await db.doc(`voucherMutationOperations/${op}`).get()).data()!;
    expect(rejected).toMatchObject({ kind: 'cashAccountAssignment', status: 'rejected', createdBy: 'synthetic-uid', voucherId: id });
    expect(rejected.cashEntryIds).toBeUndefined();
    await db.doc(`cashAccounts/${bankId}`).update({ companyId: 'taebaek', active: true });
    await expect(mutateCashEntry(db, 'taebaek', 'synthetic-uid', command(id, original, bankId, op))).rejects.toThrow();
    const newOp = `${op}-new`; planned.add(`voucherMutationOperations/${newOp}`);
    expect(await mutateCashEntry(db, 'taebaek', 'synthetic-uid', command(id, original, bankId, newOp))).toMatchObject({ status: 'applied' });
  }
});

});
