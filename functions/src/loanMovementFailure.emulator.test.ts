import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));

import { recordLoanMovement, recordLoanMovementCommand } from './loanMovementCommand';

const available = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8082';
const projectId = 'demo-taebaekfood-local';
const runId = `loan-${randomUUID()}`;
const releaseId = runId;
const date = '2026-10-03';
const counterId = `voucherNo_taebaek_${date}_general`;
const loanId = `${runId}-contract`, bankId = `${runId}-bank`;
let app: admin.app.App, db: admin.firestore.Firestore;
const owned = new Set<string>();
const ref = (group: string, id: string) => db.collection(group).doc(id);
async function put(group: string, id: string, data: Record<string, unknown>) {
  await ref(group, id).set({ ...data, testRunId: runId });
  owned.add(`${group}/${id}`);
}
async function clearFixture() {
  for (const group of ['cashEntries', 'loanMovementOperations']) {
    for (const row of (await db.collection(group).get()).docs) {
      if (row.id.startsWith(runId) && row.data().companyId === 'taebaek') await row.ref.delete();
    }
  }
}
async function seed(options: { cutover?: boolean; counter?: boolean; opening?: number } = {}) {
  await clearFixture();
  await Promise.all([
    put('loanContracts', loanId, { companyId: 'taebaek', name: '운전자금', lenderName: '은행',
      accountCode: '260', openingDate: '2026-09-01', openingPrincipal: options.opening ?? 1_000,
      movementRevision: 0 }),
    put('cashAccounts', bankId, { companyId: 'taebaek', type: '통장', active: true }),
    options.cutover === false ? ref('appMeta', 'loanMovementCutover_taebaek').delete() : put('appMeta', 'loanMovementCutover_taebaek',
      { companyId: 'taebaek', enabled: true, legacyWritersBlocked: true, auditPassed: true }),
    options.counter === false ? ref('appMeta', counterId).delete() : put('appMeta', counterId,
      { companyId: 'taebaek', tradeDate: date, prefix: '', last: 0 }),
    put('appMeta', 'releaseCutover', { releaseId, status: 'active', voucherNotBefore: { taebaek: date } }),
  ]);
}
const request = (label: string, action: '차입' | '상환', principal: number, interest = 0, expectedRevision = 0) => ({
  operationId: `${runId}-${label}`, loanId, tradeDate: date, cashAccountId: bankId,
  action, principal, interest, expectedRevision, releaseId,
});
const issue = (input: Parameters<typeof recordLoanMovement>[3]) => recordLoanMovement(db, 'taebaek', `${runId}-admin`, input);

describe.skipIf(!available)('loan movement actual Admin SDK transaction', () => {
  beforeAll(async () => { app = admin.initializeApp({ projectId }, runId); db = admin.firestore(app); });
  afterAll(async () => {
    if (!db) return;
    for (const path of owned) {
      const [group, id] = path.split('/'), target = ref(group, id), snap = await target.get();
      if (snap.exists && snap.data()?.testRunId === runId) await target.delete();
    }
    await clearFixture();
    for (const path of owned) {
      const [group, id] = path.split('/'); expect((await ref(group, id).get()).exists).toBe(false);
    }
    for (const group of ['cashEntries', 'loanMovementOperations'])
      expect((await db.collection(group).get()).docs.filter(row => row.id.startsWith(runId))).toHaveLength(0);
    await app.delete();
  });

  it('same-operation parallel rejection shares one terminal result without financial writes', async () => {
    await seed({ cutover: false }); const input = request('parallel-reject', '상환', 100);
    const results = await Promise.allSettled([issue(input), issue(input)]);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason.details.loanMovementFailure.operationRejected).toBe(true);
    }
    expect((await ref('loanMovementOperations', input.operationId).get()).data()?.status).toBe('rejected');
    expect((await ref('cashEntries', input.operationId).get()).exists).toBe(false);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(0);
  });
  it('normal and policy-rejected requests sharing an ID commit only one terminal outcome', async () => {
    await seed(); const input = request('parallel-mixed', '상환', 100);
    const results = await Promise.allSettled([issue(input), issue({ ...input, expectedRevision: 1 })]);
    const op = (await ref('loanMovementOperations', input.operationId).get()).data()!;
    const cash = await ref('cashEntries', input.operationId).get();
    if (op.status === 'rejected') {
      expect(cash.exists).toBe(false); expect((await ref('appMeta', counterId).get()).data()?.last).toBe(0);
      expect(results.every(result => result.status === 'rejected')).toBe(true);
    } else {
      expect(cash.exists).toBe(true); expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    }
  });
  it('discarded response after actual commit retries as duplicate without another debit or number', async () => {
    await seed(); const input = request('commit-response-lost', '상환', 100);
    const lostDb = { collection: db.collection.bind(db), runTransaction: async (run: any) => {
      await db.runTransaction(run); throw new Error('intentional response discard after actual commit');
    } } as unknown as admin.firestore.Firestore;
    await expect(recordLoanMovement(lostDb, 'taebaek', `${runId}-admin`, input)).rejects.toThrow('response discard');
    expect((await issue(input)).status).toBe('duplicate');
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
    expect((await ref('loanContracts', loanId).get()).data()?.principalBalance).toBe(900);
  });

  it('safe preflight rejection has operation-absent detail and leaves all documents unchanged', async () => {
    await seed({ cutover: false });
    const input = request('safe-reject', '상환', 100);
    const before = (await ref('loanContracts', loanId).get()).data();
    await expect(issue(input)).rejects.toMatchObject({ details: { loanMovementFailure: {
      operationId: input.operationId, operationRejected: true, financialWrites: false,
    } } });
    expect((await ref('loanContracts', loanId).get()).data()).toEqual(before);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(0);
    expect((await ref('cashEntries', input.operationId).get()).exists).toBe(false);
    expect((await ref('loanMovementOperations', input.operationId).get()).data()?.status).toBe('rejected');
  });
  it('existing operation request mismatch remains ambiguous and keeps the stored result', async () => {
    await seed(); const input = request('existing-op', '상환', 100);
    await issue(input);
    const before = (await ref('cashEntries', input.operationId).get()).data();
    await expect(issue({ ...input, principal: 101 })).rejects.toMatchObject({ details: undefined });
    expect((await ref('cashEntries', input.operationId).get()).data()).toEqual(before);
  });
  it('checks callable auth and fails closed without cutover, counter or current revision', async () => {
    const callable = recordLoanMovementCommand as unknown as (request: unknown) => Promise<unknown>;
    const input = request('gates', '상환', 100);
    await expect(callable({ data: input })).rejects.toThrow('로그인');
    await expect(callable({ auth: { uid: 'staff', token: { isAdmin: false, companyId: 'taebaek' } }, data: input })).rejects.toThrow('관리자');
    await seed();
    await ref('appMeta', 'releaseCutover').update({ status: 'paused' });
    await expect(issue(input)).rejects.toThrow('활성화');
    await seed();
    await ref('appMeta', 'releaseCutover').update({ voucherNotBefore: { taebaek: '2099-01-01' } });
    await expect(issue(input)).rejects.toThrow('전표 발행 가능일');
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(0);
    await seed({ cutover: false });
    await expect(issue(input)).rejects.toThrow('전환');
    expect((await ref('cashEntries', input.operationId).get()).exists).toBe(false);
    await seed({ counter: false });
    await expect(issue(input)).rejects.toThrow('카운터');
    expect((await ref('loanContracts', loanId).get()).data()?.movementRevision).toBe(0);
    await seed();
    await expect(issue({ ...input, expectedRevision: 1 })).rejects.toThrow('변경');
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(0);
  }, 30_000);

  it('writes principal, interest 931, contract revision, operation and number atomically; retries reuse result', async () => {
    await seed();
    const draw = request('draw', '차입', 200);
    expect(await issue(draw)).toMatchObject({ status: 'applied', balanceAfter: 1_200, docNo: '261003-001' });
    const repay = request('repay', '상환', 300, 50, 1);
    const first = await issue(repay);
    expect(first).toMatchObject({ status: 'applied', balanceAfter: 900, docNo: '261003-002' });
    expect((await ref('cashEntries', repay.operationId).get()).data()?.lines).toEqual([
      { accountCode: '260', amount: 300, note: '원금' }, { accountCode: '931', amount: 50, note: '이자' },
    ]);
    expect((await ref('loanContracts', loanId).get()).data()).toMatchObject({ movementRevision: 2, principalBalance: 900 });
    await ref('appMeta', counterId).delete(); // simulate response lost after commit and unavailable counter
    expect(await issue(repay)).toMatchObject({ status: 'duplicate', docNo: first.docNo });
    await ref('appMeta', 'releaseCutover').update({ status: 'paused' });
    await expect(issue(repay)).rejects.toThrow('활성화');
    await ref('appMeta', 'releaseCutover').update({ status: 'active' });
    await expect(issue({ ...repay, interest: 51 })).rejects.toThrow('다릅니다');
  }, 30_000);

  it('keeps interest-only repayment principal unchanged and rejects over-repayment', async () => {
    await seed();
    const interest = request('interest', '상환', 0, 50);
    expect(await issue(interest)).toMatchObject({ balanceAfter: 1_000 });
    expect((await ref('cashEntries', interest.operationId).get()).data()?.lines).toEqual([
      { accountCode: '931', amount: 50, note: '이자' },
    ]);
    await expect(issue(request('over', '상환', 1_001, 0, 1))).rejects.toThrow('넘습니다');
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
  }, 25_000);

  it('serializes same ID retry and two different competing repayments', async () => {
    await seed();
    const same = request('same', '상환', 100);
    const results = await Promise.all([issue(same), issue(same)]);
    expect(results.map(row => row.status).sort()).toEqual(['applied', 'duplicate']);
    const a = request('race-a', '상환', 600, 0, 1), b = request('race-b', '상환', 500, 0, 1);
    const competing = await Promise.allSettled([issue(a), issue(b)]);
    expect(competing.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter(row => row.status === 'rejected')).toHaveLength(1);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(2);
    const aCash = await ref('cashEntries', a.operationId).get();
    const bCash = await ref('cashEntries', b.operationId).get();
    expect(Number(aCash.exists) + Number(bCash.exists)).toBe(1);
    const winner = aCash.exists ? a : b, loser = aCash.exists ? b : a;
    expect((await ref('loanContracts', loanId).get()).data()).toMatchObject({
      movementRevision: 2, principalBalance: 900 - winner.principal,
    });
    expect((await ref('loanMovementOperations', same.operationId).get()).exists).toBe(true);
    expect((await ref('loanMovementOperations', winner.operationId).get()).exists).toBe(true);
    expect((await ref('loanMovementOperations', loser.operationId).get()).data()?.status).toBe('rejected');
    expect((await ref('cashEntries', loser.operationId).get()).exists).toBe(false);
    expect((await ref('cashEntries', same.operationId).get()).exists).toBe(true);
  }, 30_000);

  it('rejects wrong-company contract/account and mismatched linked principal account', async () => {
    await seed();
    const input = request('wrong', '상환', 100);
    await put('cashAccounts', bankId, { companyId: 'punghoe', type: '통장', active: true });
    await expect(issue(input)).rejects.toThrow('계좌');
    await put('cashAccounts', bankId, { companyId: 'taebaek', type: '통장', active: true });
    await put('cashEntries', `${runId}-legacy`, { companyId: 'taebaek', loanId, date,
      createdAt: '2026-10-03T09:00:00Z', dir: '출금', amount: 100, accountCode: '293' });
    await expect(issue({ ...input, operationId: `${runId}-wrong-principal` })).rejects.toThrow('원금 계정');
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(0);
    await ref('cashEntries', `${runId}-legacy`).delete();
    await put('loanContracts', loanId, { companyId: 'punghoe', accountCode: '260', openingDate: '2026-09-01', openingPrincipal: 1_000 });
    await expect(issue({ ...input, operationId: `${runId}-wrong-company` })).rejects.toThrow('회사');
  }, 25_000);

  it('orders same-day Firestore Timestamp and timezone ISO, then rejects unknown legacy time without writes', async () => {
    await seed({ opening: 0 });
    await put('cashEntries', `${runId}-z-draw`, { companyId: 'taebaek', loanId, date,
      createdAt: admin.firestore.Timestamp.fromDate(new Date('2026-10-03T00:00:00Z')),
      dir: '입금', amount: 100, accountCode: '260' });
    await put('cashEntries', `${runId}-a-repay`, { companyId: 'taebaek', loanId, date,
      createdAt: '2026-10-03T10:00:00+09:00', dir: '출금', amount: 50, accountCode: '260' });
    expect(await issue(request('mixed-time', '상환', 0, 1))).toMatchObject({ balanceAfter: 50 });
    await put('cashEntries', `${runId}-unknown-time`, { companyId: 'taebaek', loanId, date,
      createdAt: null, dir: '출금', amount: 1, accountCode: '260' });
    await expect(issue(request('blocked-time', '상환', 0, 1, 1))).rejects.toThrow('생성 시각');
    expect((await ref('cashEntries', `${runId}-blocked-time`).get()).exists).toBe(false);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(1);
  }, 30_000);
});
