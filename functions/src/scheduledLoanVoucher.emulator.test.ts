import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { issueScheduledVoucher } from './autoVoucherCommand';
import { recordLoanMovement } from './loanMovementCommand';
import { cashOriginalHash, mutateCashEntry } from './cashMutationCommand';
import { planLoanMovement } from './loanMovementPlan';
import { voucherSequenceKey } from './voucherIssue';

// Dedicated demo project: no production credentials, no shared gate/counter modifications.
const available = ['127.0.0.1:8082', '127.0.0.1:8182'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '');
const runId = randomUUID();
const projectId = `demo-scheduled-loan-${runId}`;
const releaseId = 'scheduled-loan-sdk';
const date = '2026-10-09';
let app: admin.app.App, db: admin.firestore.Firestore;
const groups = ['appMeta', 'fixedCostTemplates', 'loanContracts', 'cashAccounts', 'cashEntries', 'issuedStatements', 'loanMovementOperations', 'accountCodes', 'voucherMutationOperations'];
const template = (companyId: 'taebaek' | 'punghoe', id: string, principal = 100, interest = 10) => ({
  id, companyId, autoIssue: true, name: '상환', mode: '상환', dir: '출금', accountCode: '260', loanCode: '260',
  loanId: `${companyId}-loan`, principal, interest, amount: principal + interest, issueDay: 9,
});
const row = (group: string, id: string) => db.collection(group).doc(id);
async function clear() {
  for (const group of groups) for (const doc of (await db.collection(group).get()).docs) await doc.ref.delete();
}
async function seed(t: ReturnType<typeof template>) {
  await row('fixedCostTemplates', t.id).set(t);
  await row('loanContracts', t.loanId).set({ companyId: t.companyId, name: '대출', accountCode: '260',
    openingDate: '2026-09-01', openingPrincipal: 1000, principalBalance: 1000, movementRevision: 0 });
}
async function balance(companyId: string) { return (await row('loanContracts', `${companyId}-loan`).get()).data(); }
async function count(companyId: string) { return (await row('appMeta', voucherSequenceKey(companyId, date)).get()).data()?.last; }
const issue = (t: ReturnType<typeof template>) => issueScheduledVoucher(db, t, '2026-10', date, releaseId);

describe.skipIf(!available)('scheduled loan actual Admin SDK', { timeout: 30000 }, () => {
  beforeAll(() => { app = admin.initializeApp({ projectId }, projectId); db = app.firestore(); });
  beforeEach(async () => {
    await clear();
    await row('appMeta', 'releaseCutover').set({ releaseId, status: 'active',
      voucherNotBefore: { taebaek: date, punghoe: date }, oldWritersBlocked: true, oldWritersBlockedEvidence: 'demo' });
    for (const companyId of ['taebaek', 'punghoe']) {
      await row('appMeta', `loanMovementCutover_${companyId}`).set({ companyId, enabled: true, legacyWritersBlocked: true, auditPassed: true });
      await row('cashAccounts', `${companyId}-bank`).set({ companyId, type: '통장', active: true });
      await row('cashAccounts', `${companyId}-cash`).set({ companyId, type: '현금', active: true });
      await row('appMeta', voucherSequenceKey(companyId, date)).set({ companyId, tradeDate: date, prefix: '', last: 0 });
    }
  });
  afterAll(async () => { if (db) await clear(); if (app) await app.delete(); });

  it('splits both companies exactly like manual repayment and keeps each counter independent', async () => {
    for (const companyId of ['taebaek', 'punghoe'] as const) {
      const t = template(companyId, `${companyId}-repay`); await seed(t);
      const result = await issue(t); expect(result).toMatchObject({ result: { id: `AUTO-${t.id}-2026-10`, docNo: '261009-001', balanceAfter: 900 } });
      const cash = (await row('cashEntries', `AUTO-${t.id}-2026-10`).get()).data()!;
      const manual = planLoanMovement({ id: t.loanId, companyId, accountCode: '260', openingDate: '2026-09-01', openingPrincipal: 1000 }, [],
        { action: '상환', principal: 100, interest: 10 });
      expect(cash).toMatchObject({ companyId, loanId: t.loanId, dir: manual.dir, amount: manual.amount,
        lines: manual.lines, cashAccountId: `${companyId}-bank` });
      expect(await balance(companyId)).toMatchObject({ principalBalance: 900, movementRevision: 1 });
      expect(await count(companyId)).toBe(1);
      expect((await db.collection('issuedStatements').get()).empty).toBe(true);
    }
  });

  it('replays stored revision/body after a manual movement and a changed or disabled template', async () => {
    const t = template('taebaek', 'retry'); await seed(t); await issue(t);
    await recordLoanMovement(db, 'taebaek', 'manual-admin', { operationId: 'manual-after', loanId: t.loanId, tradeDate: date,
      cashAccountId: 'taebaek-bank', action: '상환', principal: 50, interest: 0, expectedRevision: 1, releaseId });
    await row('fixedCostTemplates', t.id).update({ autoIssue: false, principal: 999, interest: 0, amount: 999 });
    expect(await issue({ ...t, autoIssue: false, principal: 999, amount: 999 })).toMatchObject({ result: { status: 'duplicate', balanceAfter: 900 } });
    expect(await balance('taebaek')).toMatchObject({ principalBalance: 850, movementRevision: 2 });
    expect(await count('taebaek')).toBe(2);
    const receipt = (await row('loanMovementOperations', 'AUTO-retry-2026-10').get()).data()!;
    expect(receipt.scheduledRequest.input).toMatchObject({ principal: 100, interest: 10, expectedRevision: 0 });
  });

  it('skips the day after an issued monthly loan without another movement or an error', async () => {
    const t = template('taebaek', 'next-day'); await seed(t); await issue(t);
    expect(await issueScheduledVoucher(db, t, '2026-10', '2026-10-10', releaseId)).toEqual({ skip: '발행일 아님' });
    expect(await count('taebaek')).toBe(1);
    expect(await balance('taebaek')).toMatchObject({ principalBalance: 900, movementRevision: 1 });
  });

  it('replays the scheduled creation receipt after actual cash edit and delete without recreation', async () => {
    const t = template('taebaek', 'mutated'); await seed(t); await issue(t);
    const id = 'AUTO-mutated-2026-10';
    for (const code of ['260', '931']) await row('accountCodes', code).set({ companyId: 'taebaek', code, name: code });
    const original = (await row('cashEntries', id).get()).data()!;
    await mutateCashEntry(db, 'taebaek', 'admin', { operationId: 'scheduled-edit', cashEntryId: id, action: 'edit',
      expectedRevision: 0, expectedCashHash: cashOriginalHash(original), releaseId, patch: { note: '수정된 메모' } });
    const edited = (await row('cashEntries', id).get()).data()!;
    expect(await issue(t)).toMatchObject({ result: { status: 'duplicate', docNo: original.docNo } });
    expect((await row('cashEntries', id).get()).data()).toEqual(edited);
    await mutateCashEntry(db, 'taebaek', 'admin', { operationId: 'scheduled-delete', cashEntryId: id, action: 'delete',
      expectedRevision: 1, expectedCashHash: cashOriginalHash(edited), releaseId });
    const afterDelete = await balance('taebaek');
    expect(await issue(t)).toMatchObject({ result: { status: 'duplicate', docNo: original.docNo } });
    expect((await row('cashEntries', id).get()).exists).toBe(false);
    expect(await balance('taebaek')).toEqual(afterDelete);
    expect(afterDelete?.principalBalance).toBe(1000);
    expect(await count('taebaek')).toBe(1);
  });

  it('serializes simultaneous monthly calls into one movement, one number and one revision', async () => {
    const t = template('taebaek', 'race'); await seed(t);
    const results = await Promise.all([issue(t), issue(t)]);
    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ result: expect.objectContaining({ status: 'applied' }) }), expect.objectContaining({ result: expect.objectContaining({ status: 'duplicate' }) })]));
    expect(await count('taebaek')).toBe(1);
    expect(await balance('taebaek')).toMatchObject({ movementRevision: 1, principalBalance: 900 });
    expect((await db.collection('cashEntries').get()).size).toBe(1);
  });

  it('keeps an over-principal rejection durable with no cash, counter or balance change', async () => {
    const t = template('taebaek', 'over', 1001, 0); await seed(t);
    await expect(issue(t)).rejects.toThrow(); await expect(issue(t)).rejects.toThrow();
    expect(await count('taebaek')).toBe(0);
    expect(await balance('taebaek')).toMatchObject({ principalBalance: 1000, movementRevision: 0 });
    expect((await db.collection('cashEntries').get()).empty).toBe(true);
    expect((await row('loanMovementOperations', 'AUTO-over-2026-10').get()).data()).toMatchObject({ status: 'rejected', scheduledRequest: { input: { expectedRevision: 0 } } });
  });

  it('retains cutover/release and contract principal-code checks without creating generic fallback cash', async () => {
    const t = template('taebaek', 'blocked'); await seed(t);
    await row('appMeta', 'loanMovementCutover_taebaek').update({ enabled: false });
    await expect(issue(t)).rejects.toThrow();
    const next = template('taebaek', 'wrong-code'); await row('appMeta', 'loanMovementCutover_taebaek').update({ enabled: true });
    await seed(next); await row('loanContracts', next.loanId).update({ accountCode: '293' });
    await expect(issue(next)).rejects.toThrow();
    const release = template('taebaek', 'release'); await seed(release);
    await row('appMeta', 'releaseCutover').update({ status: 'held' }); await expect(issue(release)).rejects.toThrow();
    expect(await count('taebaek')).toBe(0); expect((await db.collection('cashEntries').get()).empty).toBe(true);
  });

  it('uses the latest transactional template, and interest-only leaves principal unchanged', async () => {
    const t = template('taebaek', 'latest'); await seed(t);
    await row('fixedCostTemplates', t.id).update({ principal: 0, interest: 25, amount: 25 });
    await issue(t);
    expect((await row('cashEntries', 'AUTO-latest-2026-10').get()).data()).toMatchObject({ amount: 25, lines: [{ accountCode: '931', amount: 25, note: '이자' }] });
    expect(await balance('taebaek')).toMatchObject({ principalBalance: 1000, movementRevision: 1 });
  });
});
