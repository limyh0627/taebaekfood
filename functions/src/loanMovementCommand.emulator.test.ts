import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';

vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
  onCall: (_options: unknown, handler: unknown) => handler,
}));

import { recordLoanMovement, recordLoanMovementCommand } from './loanMovementCommand';
import {statementIssueRef} from './statementIssueReceipt';

const available = ['127.0.0.1:8082','127.0.0.1:8182'].includes(process.env.FIRESTORE_EMULATOR_HOST ?? '');
const projectId = 'demo-loan-'+randomUUID().slice(0,8);
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
    await app.delete();
  });
  it.each(['prepared','rejected','applied','foreign'])('다른 전표 %s claim은 신규 대출·번호·계약 쓰기를 막고 다른 ID는 정상 처리한다',async mode=>{
    await seed();const input=request('claim-'+mode,'상환',100),owner=mode==='foreign'?'punghoe':'taebaek';
    const claim=statementIssueRef(db,{companyId:owner,operationId:input.operationId+':ISSUE'});
    await put('statementIssueOperations',claim.id,{companyId:owner,statementId:input.operationId,status:mode==='foreign'?'applied':mode,actorId:'다른담당'});
    const before=await Promise.all([ref('loanContracts',loanId).get(),ref('appMeta',counterId).get(),claim.get()]);
    await expect(issue(input)).rejects.toThrow('최초 요청');expect((await ref('cashEntries',input.operationId).get()).exists).toBe(false);expect((await ref('loanMovementOperations',input.operationId).get()).exists).toBe(false);
    const after=await Promise.all([ref('loanContracts',loanId).get(),ref('appMeta',counterId).get(),claim.get()]);after.forEach((snap,index)=>expect(snap.updateTime!.isEqual(before[index].updateTime!)).toBe(true));
    await ref('appMeta','releaseCutover').update({statementIssueProtocol:{generation:'잘못된-none-세대'}});
    expect((await issue(request('normal-'+mode,'상환',100))).status).toBe('applied');
  });
  it('대출 자기 원문 duplicate는 뒤늦은 타회사 일반 전표 claim으로 막지 않는다',async()=>{
    await seed();const input=request('own-ack','상환',100),first=await issue(input),claim=statementIssueRef(db,{companyId:'punghoe',operationId:input.operationId+':ISSUE'});
    await put('statementIssueOperations',claim.id,{status:'prepared',actorId:'다른담당'});
    const before=await Promise.all([ref('loanContracts',loanId).get(),ref('appMeta',counterId).get(),ref('cashEntries',input.operationId).get(),claim.get()]);
    expect(await issue(input)).toEqual({...first,status:'duplicate'});const after=await Promise.all(before.map(snap=>snap.ref.get()));after.forEach((snap,index)=>expect(snap.updateTime!.isEqual(before[index].updateTime!)).toBe(true));
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
    expect(await issue(repay)).toMatchObject({status:'duplicate',docNo:first.docNo});
    await ref('appMeta', 'releaseCutover').update({ status: 'active' });
    await expect(issue({ ...repay, interest: 51 })).rejects.toThrow('다릅니다');
  }, 30_000);
  it('이전 release·발행 가능일 변경 뒤 대출 정확 ACK는 계약·번호·원문을 쓰지 않는다',async()=>{
    await seed();const input=request('old-release','상환',100),first=await issue(input);
    await ref('appMeta','releaseCutover').update({releaseId:'new-release',voucherNotBefore:{taebaek:'2099-01-01'}});
    const before=await Promise.all([ref('loanContracts',loanId).get(),ref('appMeta',counterId).get(),ref('cashEntries',input.operationId).get(),ref('loanMovementOperations',input.operationId).get()]);
    expect(await issue(input)).toEqual({...first,status:'duplicate'});const after=await Promise.all(before.map(snap=>snap.ref.get()));after.forEach((snap,index)=>expect(snap.updateTime!.isEqual(before[index].updateTime!)).toBe(true));
    await expect(issue(request('new-old-release','상환',100))).rejects.toThrow('활성화');
  });

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
    const rejected = await ref('loanMovementOperations', loser.operationId).get();
    expect(rejected.data()).toMatchObject({ companyId: 'taebaek', loanId, status: 'rejected',
      createdBy: `${runId}-admin`, failureCode: 'failed-precondition', failureMessage: '대출 계약이 변경되었습니다.' });
    const loserBody = { ...loser, note: '' };
    const canonicalLoser = Object.fromEntries(Object.keys(loserBody).sort().map(key => [key, loserBody[key as keyof typeof loserBody]]));
    expect(rejected.data()?.requestHash).toBe(createHash('sha256').update(JSON.stringify(canonicalLoser)).digest('hex'));
    expect((await ref('issuedStatements', loser.operationId).get()).exists).toBe(false);
    const preserved = await Promise.all([ref('loanContracts', loanId).get(), ref('appMeta', counterId).get(), rejected.ref.get()]);
    await expect(issue(loser)).rejects.toThrow('대출 계약이 변경되었습니다.');
    const afterReplay = await Promise.all([ref('loanContracts', loanId).get(), ref('appMeta', counterId).get(), rejected.ref.get()]);
    expect(afterReplay.map(row => row.data())).toEqual(preserved.map(row => row.data()));
    expect((await ref('cashEntries', loser.operationId).get()).exists).toBe(false);
    expect((await ref('cashEntries', same.operationId).get()).exists).toBe(true);
  }, 30_000);

  it('rejects wrong-company contract/account and mismatched linked principal account', async () => {
    await seed();
    const input = request('wrong', '상환', 100);
    await put('cashAccounts', bankId, { companyId: 'punghoe', type: '통장', active: true });
    await expect(issue(input)).rejects.toThrow('계좌');
    await put('cashAccounts', bankId, { companyId: 'taebaek', type: '통장', active: true });
    const rejected = await ref('loanMovementOperations', input.operationId).get();
    await expect(issue(input)).rejects.toThrow('계좌');
    expect((await rejected.ref.get()).data()).toEqual(rejected.data());
    expect((await ref('cashEntries', input.operationId).get()).exists).toBe(false);
    expect((await ref('issuedStatements', input.operationId).get()).exists).toBe(false);
    expect((await ref('loanContracts', loanId).get()).data()?.movementRevision).toBe(0);
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(0);
    await put('cashEntries', `${runId}-legacy`, { companyId: 'taebaek', loanId, date,
      createdAt: '2026-10-03T09:00:00Z', dir: '출금', amount: 100, accountCode: '293' });
    await expect(issue(request('wrong-principal', '상환', 100))).rejects.toThrow('원금 계정');
    expect((await ref('appMeta', counterId).get()).data()?.last).toBe(0);
    await ref('cashEntries', `${runId}-legacy`).delete();
    await put('loanContracts', loanId, { companyId: 'punghoe', accountCode: '260', openingDate: '2026-09-01', openingPrincipal: 1_000 });
    await expect(issue(request('wrong-contract-company', '상환', 100))).rejects.toThrow('회사');
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
