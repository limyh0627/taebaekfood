import { afterAll, beforeAll, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { cashOriginalHash, mutateCashEntry } from './cashMutationCommand';
import { issueVoucher, voucherSequenceKey } from './voucherIssue';
import { buildAccountLedger } from './shared/cashAccountLedger';

const run = `cashbank-${randomUUID()}`;
let app: App, db: Firestore;
const owned = new Set<string>();
async function seed(path: string, row: Record<string, unknown>) { owned.add(path); await db.doc(path).set(row); }
beforeAll(async () => {
  if (!/^(localhost|127\.0\.0\.1):(8082|8182)$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Local demo emulator required');
  app = initializeApp({ projectId: 'demo-taebaekfood-local' }, run); db = getFirestore(app);
  await seed('appMeta/releaseCutover', { status: 'active', releaseId: run, voucherNotBefore: { taebaek: '2026-10-03' } });
});
afterAll(async () => { if (db) for (const path of owned) await db.doc(path).delete(); if (app) await deleteApp(app); });
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
  owned.add(`voucherMutationOperations/${op}`);
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
  owned.add(`cashEntries/${id}`); owned.add(`voucherMutationOperations/${op}`);
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
    owned.add(`voucherMutationOperations/${op}`);
    const rejected = (await db.doc(`voucherMutationOperations/${op}`).get()).data()!;
    expect(rejected).toMatchObject({ kind: 'cashAccountAssignment', status: 'rejected', createdBy: 'synthetic-uid', voucherId: id });
    expect(rejected.cashEntryIds).toBeUndefined();
    await db.doc(`cashAccounts/${bankId}`).update({ companyId: 'taebaek', active: true });
    await expect(mutateCashEntry(db, 'taebaek', 'synthetic-uid', command(id, original, bankId, op))).rejects.toThrow();
    const newOp = `${op}-new`; owned.add(`voucherMutationOperations/${newOp}`);
    expect(await mutateCashEntry(db, 'taebaek', 'synthetic-uid', command(id, original, bankId, newOp))).toMatchObject({ status: 'applied' });
  }
});
