import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { cashOriginalHash, mutateCashEntry } from './cashMutationCommand';
import { issueVoucher, voucherSequenceKey } from './voucherIssue';
import { issuePayrollVoucher } from './payrollVoucher';
import { recordLoanMovement } from './loanMovementCommand';
import { recordInterCompanyTransfer } from './interCompanyTransferCommand';
import { replaceManualSettlementBatch } from './manualSettlementBatchCommand';
const projectId = 'demo-taebaekfood-local';
const run = `cashmut-${randomUUID()}`;
let app: App, db: Firestore;
const owned = new Set<string>();
async function seed(path: string, row: Record<string, unknown>) { owned.add(path); await db.doc(path).set(row); }
beforeAll(() => {
  if (!/^(localhost|127\.0\.0\.1):(8082|8182)$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Local demo Firestore emulator required');
  app = initializeApp({ projectId }, run); db = getFirestore(app);
});
afterAll(async () => {
  if (db) for (const path of owned) await db.doc(path).delete();
  if (app) await deleteApp(app);
});
async function setup(suffix: string) {
  const cashId = `${run}-${suffix}`, partnerId = `${cashId}-partner`, statementId = `${cashId}-statement`, settlementId = `${cashId}-settlement`;
  const original = { companyId: 'taebaek', date: '2026-10-03', dir: '출금', amount: 100, accountCode: '253', partnerId, docNo: '261003-001' };
  await seed('appMeta/releaseCutover', { status: 'active', releaseId: run });
  await seed(`cashEntries/${cashId}`, original);
  await seed(`accountCodes/${run}-expense`, { companyId: 'taebaek', code: '802', name: '급여' });
  await seed(`accountCodes/${run}-payable`, { companyId: 'taebaek', code: '253', name: '미지급금' });
  await seed(`partners/${partnerId}`, { companyId: 'taebaek', name: '합성 거래처' });
  await seed(`issuedStatements/${statementId}`, { companyId: 'taebaek', partnerId, type: '매입', tradeDate: '2026-10-03', totalSupply: 200, totalTax: 0, totalAmount: 200, items: [{ accountCode: '802', supply: 200, tax: 0, total: 200 }] });
  await seed(`settlements/${settlementId}`, { companyId: 'taebaek', statementId, cashEntryId: cashId, amount: 100, manual: true });
  owned.add(`appMeta/partnerPaymentState_taebaek_${partnerId}`);
  return { cashId, partnerId, statementId, settlementId, original };
}
describe('cash full mutation actual SDK', () => {
  it('split account allocations preserve owned rows and enforce the whole cash amount', async () => {
    const x = await setup('batch-split'), tradeId = `${x.cashId}-trade`, ownedId = `st-${x.cashId}`;
    const cash = { ...x.original, issueOperationId: `${x.cashId}-issue`, lines: [
      { accountCode: '251', amount: 60, side: '차변' }, { accountCode: '253', amount: 60, side: '차변' },
      { accountCode: '811', amount: 20, side: '대변' }] };
    await seed(`cashEntries/${x.cashId}`, cash);
    await seed(`issuedStatements/${tradeId}`, { companyId: 'taebaek', partnerId: x.partnerId, type: '매입', tradeDate: cash.date,
      totalSupply: 200, totalTax: 0, totalAmount: 200, items: [{ accountCode: '251', supply: 200, tax: 0, total: 200 }] });
    const ownedRow = { companyId: 'taebaek', cashEntryId: x.cashId, statementId: tradeId, amount: 60, serverOwned: true };
    await seed(`settlements/${ownedId}`, ownedRow);
    await seed('appMeta/partnerPaymentCutover_taebaek', { companyId: 'taebaek', enabled: true, legacyWritersBlocked: true, auditPassed: true });
    const operationId = `${x.cashId}-batch`; owned.add(`manualSettlementBatchOperations/${operationId}`);
    owned.add(`settlements/manual-${operationId}-${x.statementId}`);
    const input = { operationId, releaseId: run, cashEntryId: x.cashId, partnerId: x.partnerId,
      expectedPartnerRevision: 0, allocations: [{ statementId: x.statementId, amount: 60 }] };
    await expect(replaceManualSettlementBatch(db, 'taebaek', 'uid', input)).rejects.toThrow();
    expect((await db.doc(`manualSettlementBatchOperations/${operationId}`).get()).exists).toBe(false);
    input.allocations[0].amount = 40;
    await expect(replaceManualSettlementBatch(db, 'taebaek', 'uid', input)).resolves.toMatchObject({ status: 'applied' });
    expect((await db.doc(`settlements/${ownedId}`).get()).data()).toEqual(ownedRow);
    expect((await db.doc(`cashEntries/${x.cashId}`).get()).data()).toEqual(cash);
  });
  it('numbered signed cash replaces only manual allocations, preserves owned rows and replays without counters', async () => {
    const x = await setup('batch-owned');
    const cash = { ...x.original, issueOperationId: `${x.cashId}-issue`,
      lines: [{ accountCode: '253', amount: 120, side: '차변' }, { accountCode: '253', amount: 20, side: '대변' }] };
    await seed(`cashEntries/${x.cashId}`, cash);
    await seed('appMeta/partnerPaymentCutover_taebaek', { companyId: 'taebaek', enabled: true, legacyWritersBlocked: true, auditPassed: true });
    const ownedId = `st-${x.cashId}`;
    const ownedRow = { companyId: 'taebaek', cashEntryId: x.cashId, statementId: x.statementId, amount: 40, manual: true };
    await seed(`settlements/${ownedId}`, ownedRow);
    const counterId = voucherSequenceKey('taebaek', cash.date, ''); await seed(`appMeta/${counterId}`, { companyId: 'taebaek', tradeDate: cash.date, prefix: '', last: 7 });
    const operationId = `${x.cashId}-batch`;
    owned.add(`manualSettlementBatchOperations/${operationId}`);
    owned.add(`settlements/manual-${operationId}-${x.statementId}`);
    const input = { operationId, releaseId: run, cashEntryId: x.cashId, partnerId: x.partnerId,
      expectedPartnerRevision: 0, allocations: [{ statementId: x.statementId, amount: 61 }] };
    await expect(replaceManualSettlementBatch(db, 'taebaek', 'uid', input)).rejects.toThrow();
    expect((await db.doc(`settlements/${x.settlementId}`).get()).data()?.amount).toBe(100);
    input.allocations[0].amount = 60;
    await expect(replaceManualSettlementBatch(db, 'taebaek', 'uid', input)).resolves.toMatchObject({ status: 'applied', revision: 1 });
    await expect(replaceManualSettlementBatch(db, 'taebaek', 'uid', input)).resolves.toMatchObject({ status: 'duplicate', revision: 1 });
    expect((await db.doc(`settlements/${ownedId}`).get()).data()).toEqual(ownedRow);
    expect((await db.doc(`settlements/${x.settlementId}`).get()).exists).toBe(false);
    expect((await db.doc(`cashEntries/${x.cashId}`).get()).data()).toEqual(cash);
    expect((await db.doc(`appMeta/${counterId}`).get()).data()).toEqual({ companyId: 'taebaek', tradeDate: cash.date, prefix: '', last: 7 });
    await expect(replaceManualSettlementBatch(db, 'taebaek', 'other-user', input)).rejects.toThrow();
  });

  it('keeps the accrual source and enforces its fresh remaining amount before edit and delete', async () => {
    const id = `${run}-accrual-cash`, statementId = `${run}-accrual`, otherId = `${run}-accrual-other`;
    await seed('appMeta/releaseCutover', { status: 'active', releaseId: run });
    await seed(`accountCodes/${run}-accrued`, { companyId: 'taebaek', code: '275' });
    const source = { companyId: 'taebaek', type: '비용', partnerId: '', items: [{ accountCode: '275', side: '대변', total: 200 }] };
    await seed(`issuedStatements/${statementId}`, source);
    const cash = { companyId: 'taebaek', date: '2026-10-03', dir: '출금', amount: 100, accountCode: '275', linkedAccrualStatementId: statementId, docNo: '261003-001' };
    await seed(`cashEntries/${id}`, cash); await seed(`cashEntries/${otherId}`, { ...cash, amount: 50 });
    const bad = `${id}-bad`; owned.add(`voucherMutationOperations/${bad}`);
    await expect(mutateCashEntry(db, 'taebaek', 'uid', { operationId: bad, cashEntryId: id, action: 'edit', expectedRevision: 0,
      expectedCashHash: cashOriginalHash(cash), releaseId: run, patch: { amount: 151 } })).rejects.toThrow('잔액');
    expect((await db.doc(`cashEntries/${id}`).get()).data()).toEqual(cash);
    const edit = `${id}-edit`; owned.add(`voucherMutationOperations/${edit}`);
    await mutateCashEntry(db, 'taebaek', 'uid', { operationId: edit, cashEntryId: id, action: 'edit', expectedRevision: 0,
      expectedCashHash: cashOriginalHash(cash), releaseId: run, patch: { amount: 150 } });
    const revised = (await db.doc(`cashEntries/${id}`).get()).data()!;
    const deletion = `${id}-delete`; owned.add(`voucherMutationOperations/${deletion}`);
    await mutateCashEntry(db, 'taebaek', 'uid', { operationId: deletion, cashEntryId: id, action: 'delete', expectedRevision: 1,
      expectedCashHash: cashOriginalHash(revised), releaseId: run });
    expect((await db.doc(`issuedStatements/${statementId}`).get()).data()).toEqual(source);
    expect((await db.doc(`cashEntries/${otherId}`).get()).data()?.amount).toBe(50);
  });
  it('updates adjustment metadata against fresh history without changing confirmed account anchors', async () => {
    const id = `${run}-adjustment`, accountId = `${run}-adjustment-bank`, movementId = `${id}-movement`;
    await seed('appMeta/releaseCutover', { status: 'active', releaseId: run });
    const account = { companyId: 'taebaek', openingDate: '2026-07-31', openingBalance: 100,
      confirmedBalances: [{ date: '2026-09-30', balance: 200, recordedAt: '2026-10-01T00:00:00Z', reason: '합성 확정' }] };
    await seed(`cashAccounts/${accountId}`, account);
    await seed(`cashEntries/${movementId}`, { companyId: 'taebaek', cashAccountId: accountId, date: '2026-10-02', dir: '출금', amount: 50 });
    const cash = { companyId: 'taebaek', cashAccountId: accountId, date: '2026-10-03', dir: '입금', amount: 20, docNo: '261003-002',
      balanceAdjustment: { before: 150, target: 170, delta: 20, reason: '미분류' } };
    await seed(`cashEntries/${id}`, cash);
    const edit = `${id}-edit`; owned.add(`voucherMutationOperations/${edit}`);
    await mutateCashEntry(db, 'taebaek', 'uid', { operationId: edit, cashEntryId: id, action: 'edit', expectedRevision: 0,
      expectedCashHash: cashOriginalHash(cash), releaseId: run, patch: { date: '2026-10-04', amount: 30 } });
    expect((await db.doc(`cashEntries/${id}`).get()).data()).toMatchObject({ amount: 30, date: '2026-10-04',
      balanceAdjustment: { before: 150, target: 180, delta: 30, reason: '미분류' } });
    expect((await db.doc(`cashAccounts/${accountId}`).get()).data()).toEqual(account);
  });
  it('recomputes loan principal for edit and deletion without replaying the original repayment', async () => {
    const loanId = `${run}-loan`, cashId = `${run}-repayment`, bankId = `${run}-loan-bank`, date = '2026-10-09';
    await seed('appMeta/releaseCutover', { status: 'active', releaseId: run, voucherNotBefore: { taebaek: '2026-10-03' } });
    await seed('appMeta/loanMovementCutover_taebaek', { companyId: 'taebaek', enabled: true, legacyWritersBlocked: true, auditPassed: true });
    await seed(`appMeta/${voucherSequenceKey('taebaek', date)}`, { companyId: 'taebaek', tradeDate: date, prefix: '', last: 0 });
    await seed(`loanContracts/${loanId}`, { companyId: 'taebaek', name: '합성 대출', lenderName: '은행', accountCode: '260', openingDate: '2026-07-31', openingPrincipal: 1000, movementRevision: 0 });
    await seed(`cashAccounts/${bankId}`, { companyId: 'taebaek', active: true, type: '통장' });
    await seed(`accountCodes/${run}-loan-code`, { companyId: 'taebaek', code: '260' });
    await seed(`accountCodes/${run}-interest-code`, { companyId: 'taebaek', code: '931' });
    owned.add(`cashEntries/${cashId}`); owned.add(`loanMovementOperations/${cashId}`);
    const creation = { operationId: cashId, loanId, tradeDate: date, cashAccountId: bankId, action: '상환' as const, principal: 100, interest: 20, expectedRevision: 0, releaseId: run };
    await recordLoanMovement(db, 'taebaek', 'uid', creation);
    const current = (await db.doc(`cashEntries/${cashId}`).get()).data()!;
    const editId = `${cashId}-edit`; owned.add(`voucherMutationOperations/${editId}`);
    await mutateCashEntry(db, 'taebaek', 'uid', { operationId: editId, action: 'edit', cashEntryId: cashId, expectedRevision: 0,
      expectedCashHash: cashOriginalHash(current), releaseId: run, patch: { amount: 220, lines: [{ accountCode: '260', amount: 200 }, { accountCode: '931', amount: 20 }] } });
    expect((await db.doc(`loanContracts/${loanId}`).get()).data()?.principalBalance).toBe(800);
    expect(await recordLoanMovement(db, 'taebaek', 'uid', creation)).toMatchObject({ status: 'duplicate', balanceAfter: 900 });
    const revised = (await db.doc(`cashEntries/${cashId}`).get()).data()!;
    const deleteId = `${cashId}-delete`; owned.add(`voucherMutationOperations/${deleteId}`);
    await mutateCashEntry(db, 'taebaek', 'uid', { operationId: deleteId, action: 'delete', cashEntryId: cashId, expectedRevision: 1, expectedCashHash: cashOriginalHash(revised), releaseId: run });
    expect((await db.doc(`loanContracts/${loanId}`).get()).data()?.principalBalance).toBe(1000);
    expect(await recordLoanMovement(db, 'taebaek', 'uid', creation)).toMatchObject({ status: 'duplicate' });
    expect((await db.doc(`cashEntries/${cashId}`).get()).exists).toBe(false);
  });
  it('edits and cancels both authorized companies together and never restores their original issue', async () => {
    const id = `${run}-transfer`, uid = `${run}-uid`, employeeId = `${run}-admin`, date = '2026-10-10';
    const fromAccountId = `${run}-from-bank`, toAccountId = `${run}-to-bank`, fromPartnerId = `${run}-from-partner`, toPartnerId = `${run}-to-partner`;
    await seed('appMeta/releaseCutover', { status: 'active', releaseId: run, voucherNotBefore: { taebaek: '2026-10-03', punghoe: '2026-10-03' } });
    await seed(`employees/${employeeId}`, { authUid: uid, companyId: 'taebaek', adminAccess: true, status: 'working' });
    await seed(`companyTransferGrants/${uid}`, { authUid: uid, enabled: true, allowedPairs: ['taebaek>punghoe'], revision: 1, approvedBy: 'test', approvedAt: '2026-10-08' });
    for (const companyId of ['taebaek', 'punghoe']) {
      await seed(`appMeta/companyTransferCutover_${companyId}`, { companyId, enabled: true, legacyWritersBlocked: true, auditPassed: true });
      await seed(`appMeta/${voucherSequenceKey(companyId, date)}`, { companyId, tradeDate: date, prefix: '', last: 0 });
    }
    await seed(`cashAccounts/${fromAccountId}`, { companyId: 'taebaek', active: true, type: '통장' });
    await seed(`cashAccounts/${toAccountId}`, { companyId: 'punghoe', active: true, type: '통장' });
    await seed(`partners/${fromPartnerId}`, { companyId: 'taebaek', name: '풍회유통' });
    await seed(`partners/${toPartnerId}`, { companyId: 'punghoe', name: '태백푸드' });
    await seed(`accountCodes/${run}-from-advance`, { companyId: 'taebaek', code: '133' });
    await seed(`accountCodes/${run}-to-advance`, { companyId: 'punghoe', code: '254' });
    owned.add(`appMeta/partnerPaymentState_taebaek_${fromPartnerId}`); owned.add(`appMeta/partnerPaymentState_punghoe_${toPartnerId}`);
    owned.add(`companyTransferOperations/${id}`); owned.add(`cashEntries/${id}-out`); owned.add(`cashEntries/${id}-in`);
    const claims = { employeeId, companyId: 'taebaek', isAdmin: true };
    const creation = { operationId: id, from: 'taebaek' as const, to: 'punghoe' as const, tradeDate: date, amount: 120, overKind: '선급금' as const,
      fromAccountId, toAccountId, fromPartnerId, toPartnerId, expectedFromRevision: 0, expectedToRevision: 0, releaseId: run };
    const issued = await recordInterCompanyTransfer(db, uid, claims, creation);
    const outgoing = (await db.doc(`cashEntries/${id}-out`).get()).data()!, incoming = (await db.doc(`cashEntries/${id}-in`).get()).data()!;
    const editId = `${id}-edit`; owned.add(`voucherMutationOperations/${editId}`);
    const edit = { operationId: editId, action: 'edit' as const, cashEntryId: `${id}-out`, expectedRevision: 0, expectedCashHash: cashOriginalHash(outgoing), releaseId: run,
      patch: { amount: 150, lines: [{ accountCode: '133', amount: 150 }] }, transferEdit: { counterpartId: `${id}-in`, expectedRevision: 0,
        expectedCashHash: cashOriginalHash(incoming), patch: { amount: 150, lines: [{ accountCode: '254', amount: 150 }] } } };
    await expect(mutateCashEntry(db, 'taebaek', uid, edit, { ...claims, companyId: 'punghoe' })).rejects.toThrow();
    expect((await db.doc(`cashEntries/${id}-out`).get()).data()).toEqual(outgoing);
    await mutateCashEntry(db, 'taebaek', uid, edit, claims);
    expect((await db.doc(`cashEntries/${id}-in`).get()).data()?.amount).toBe(150);
    expect(await recordInterCompanyTransfer(db, uid, claims, creation)).toMatchObject({ status: 'duplicate', outDocNo: issued.outDocNo, inDocNo: issued.inDocNo });
    const latestOut = (await db.doc(`cashEntries/${id}-out`).get()).data()!, latestIn = (await db.doc(`cashEntries/${id}-in`).get()).data()!;
    const deleteId = `${id}-delete`; owned.add(`voucherMutationOperations/${deleteId}`);
    await mutateCashEntry(db, 'taebaek', uid, { operationId: deleteId, action: 'delete', cashEntryId: `${id}-out`, expectedRevision: 1,
      expectedCashHash: cashOriginalHash(latestOut), releaseId: run, transferEdit: { counterpartId: `${id}-in`, expectedRevision: 1, expectedCashHash: cashOriginalHash(latestIn) } }, claims);
    expect(await recordInterCompanyTransfer(db, uid, claims, creation)).toMatchObject({ status: 'duplicate' });
    expect((await db.doc(`cashEntries/${id}-out`).get()).exists).toBe(false);
    expect((await db.doc(`cashEntries/${id}-in`).get()).exists).toBe(false);
  });
  it('edits actual employee payroll lines and preserves the creation receipt after cancellation', async () => {
    const yearMonth = '2026-11', date = '2026-11-25', cashId = `payroll-taebaek-${yearMonth}-base`, employeeId = `${run}-employee`;
    await seed('appMeta/releaseCutover', { status: 'active', releaseId: run, voucherNotBefore: { taebaek: '2026-10-03' } });
    await seed('appMeta/payrollIssueCutover_taebaek', { companyId: 'taebaek', firstYearMonth: '2026-10' });
    await seed(`appMeta/${voucherSequenceKey('taebaek', date, '급여')}`, { companyId: 'taebaek', tradeDate: date, prefix: '급여', last: 0 });
    await seed(`accountCodes/${run}-salary`, { companyId: 'taebaek', code: '802', name: '급여' });
    await seed(`accountCodes/${run}-withhold`, { companyId: 'taebaek', code: '257', name: '예수금' });
    await seed(`cashAccounts/${run}-bank`, { companyId: 'taebaek', type: '통장', active: true });
    await seed(`employees/${employeeId}`, { companyId: 'taebaek', name: '합성 사원', status: 'working' });
    owned.add(`payrolls/pay-${yearMonth}`); owned.add(`cashEntries/${cashId}`);
    const lines = [{ employeeId, employeeName: '합성 사원', base: 100, incomeTax: 10 }];
    const creation = { yearMonth, payDate: date, expectedRevision: 0, lines, mode: 'cash' as const, releaseId: run, cashAccountId: `${run}-bank` };
    const issued = await issuePayrollVoucher(db, 'taebaek', creation);
    const cash = (await db.doc(`cashEntries/${cashId}`).get()).data()!;
    const editId = `${run}-payroll-edit`; owned.add(`voucherMutationOperations/${editId}`);
    await mutateCashEntry(db, 'taebaek', 'uid', { action: 'edit', operationId: editId, cashEntryId: cashId, expectedRevision: 0,
      expectedCashHash: cashOriginalHash(cash), releaseId: run,
      patch: { amount: 100, lines: [{ accountCode: '802', amount: 120 }, { accountCode: '257', amount: -20 }], note: '사원별 수정' },
      payrollEdit: { yearMonth, payDate: date, expectedRevision: 1, lines: [{ ...lines[0], base: 120, incomeTax: 20 }] } });
    expect((await db.doc(`payrolls/pay-${yearMonth}`).get()).data()?.lines[0].base).toBe(120);
    expect(await issuePayrollVoucher(db, 'taebaek', creation)).toEqual(issued);
    const revised = (await db.doc(`cashEntries/${cashId}`).get()).data()!;
    const deleteId = `${run}-payroll-delete`; owned.add(`voucherMutationOperations/${deleteId}`);
    await mutateCashEntry(db, 'taebaek', 'uid', { action: 'delete', operationId: deleteId, cashEntryId: cashId,
      expectedRevision: 1, expectedCashHash: cashOriginalHash(revised), releaseId: run });
    expect((await db.doc(`payrolls/pay-${yearMonth}`).get()).data()?.issueCancelled).toBe(true);
    expect(await issuePayrollVoucher(db, 'taebaek', creation)).toEqual(issued);
    expect((await db.doc(`cashEntries/${cashId}`).get()).exists).toBe(false);
    await expect(issuePayrollVoucher(db, 'taebaek', { ...creation, lines: [{ ...lines[0], base: 101 }] })).rejects.toThrow();
  });
  it('original issuance retry after edit and delete returns the old number without recreating cash', async () => {
    const cashId = `${run}-issued`, date = '2026-10-08';
    await seed('appMeta/releaseCutover', { status: 'active', releaseId: run, voucherNotBefore: { taebaek: '2026-10-03', punghoe: '2026-10-03' } });
    await seed(`appMeta/${voucherSequenceKey('taebaek', date)}`, { companyId: 'taebaek', tradeDate: date, prefix: '', last: 0 });
    await seed(`accountCodes/${run}-ordinary`, { companyId: 'taebaek', code: '802', name: '급여' });
    owned.add(`cashEntries/${cashId}`);
    const creation = { kind: 'cashEntries' as const, operationId: cashId, tradeDate: date, releaseId: run,
      document: { companyId: 'taebaek', date, dir: '출금', amount: 100, accountCode: '802', note: '원 발행' } };
    const issued = await issueVoucher(db, 'taebaek', creation);
    const source = (await db.doc(`cashEntries/${cashId}`).get()).data()!;
    const editId = `${cashId}-edit`; owned.add(`voucherMutationOperations/${editId}`);
    await mutateCashEntry(db, 'taebaek', 'uid', { action: 'edit', operationId: editId, cashEntryId: cashId,
      expectedRevision: 0, expectedCashHash: cashOriginalHash(source), releaseId: run, patch: { amount: 150 } });
    expect(await issueVoucher(db, 'taebaek', creation)).toEqual(issued);
    const revised = (await db.doc(`cashEntries/${cashId}`).get()).data()!;
    const deleteId = `${cashId}-delete`; owned.add(`voucherMutationOperations/${deleteId}`);
    await mutateCashEntry(db, 'taebaek', 'uid', { action: 'delete', operationId: deleteId, cashEntryId: cashId,
      expectedRevision: 1, expectedCashHash: cashOriginalHash(revised), releaseId: run });
    expect(await issueVoucher(db, 'taebaek', creation)).toEqual(issued);
    expect((await db.doc(`cashEntries/${cashId}`).get()).exists).toBe(false);
    expect((await db.doc(`appMeta/${voucherSequenceKey('taebaek', date)}`).get()).data()?.last).toBe(1);
    // Missing, altered and foreign evidence cannot authorize the same old request.
    const receipt = (await db.doc(`voucherMutationOperations/${editId}`).get()).data()!;
    await db.doc(`voucherMutationOperations/${editId}`).delete();
    await expect(issueVoucher(db, 'taebaek', creation)).rejects.toThrow();
    await db.doc(`voucherMutationOperations/${editId}`).set({ ...receipt, beforeHash: '0'.repeat(64) });
    await expect(issueVoucher(db, 'taebaek', creation)).rejects.toThrow();
    await db.doc(`voucherMutationOperations/${editId}`).set({ ...receipt, companyId: 'punghoe' });
    await expect(issueVoucher(db, 'taebaek', creation)).rejects.toThrow();
    await db.doc(`voucherMutationOperations/${editId}`).set(receipt);
    expect(await issueVoucher(db, 'taebaek', creation)).toEqual(issued);
  });
  it('commits cash plus settlement together, retries once, then deletes fresh allocations', async () => {
    const setupData = await setup('edit-delete');
    const operationId = `${setupData.cashId}-edit`; owned.add(`voucherMutationOperations/${operationId}`);
    const input = { operationId, cashEntryId: setupData.cashId, action: 'edit' as const, expectedRevision: 0, expectedCashHash: cashOriginalHash(setupData.original), releaseId: run, patch: { amount: 150 } };
    expect(await mutateCashEntry(db, 'taebaek', 'uid', input)).toMatchObject({ status: 'applied' });
    expect((await db.doc(`settlements/${setupData.settlementId}`).get()).data()?.amount).toBe(150);
    expect(await mutateCashEntry(db, 'taebaek', 'uid', input)).toMatchObject({ status: 'duplicate' });
    const latest = (await db.doc(`cashEntries/${setupData.cashId}`).get()).data()!;
    const deleteId = `${setupData.cashId}-delete`; owned.add(`voucherMutationOperations/${deleteId}`);
    const deletion = { operationId: deleteId, cashEntryId: setupData.cashId, action: 'delete' as const, expectedRevision: 1, expectedCashHash: cashOriginalHash(latest), releaseId: run };
    await mutateCashEntry(db, 'taebaek', 'uid', deletion);
    expect((await db.doc(`cashEntries/${setupData.cashId}`).get()).exists).toBe(false);
    expect((await db.doc(`settlements/${setupData.settlementId}`).get()).exists).toBe(false);
    expect(await mutateCashEntry(db, 'taebaek', 'uid', deletion)).toMatchObject({ status: 'duplicate' });
  });
  it('rolls back every financial write when fresh claim capacity is exceeded', async () => {
    const setupData = await setup('rollback');
    const operationId = `${setupData.cashId}-bad`; owned.add(`voucherMutationOperations/${operationId}`);
    await expect(mutateCashEntry(db, 'taebaek', 'uid', { operationId, cashEntryId: setupData.cashId, action: 'edit', expectedRevision: 0, expectedCashHash: cashOriginalHash(setupData.original), releaseId: run, patch: { amount: 201 } })).rejects.toThrow();
    expect((await db.doc(`cashEntries/${setupData.cashId}`).get()).data()).toEqual(setupData.original);
    expect((await db.doc(`settlements/${setupData.settlementId}`).get()).data()?.amount).toBe(100);
    expect((await db.doc(`voucherMutationOperations/${operationId}`).get()).exists).toBe(false);
  });
  it('a concurrent manual allocation cannot survive a committed cash delete as an orphan', async () => {
    const setupData = await setup('race');
    await seed('appMeta/partnerPaymentCutover_taebaek', { companyId: 'taebaek', enabled: true, legacyWritersBlocked: true, auditPassed: true });
    let signal!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { signal = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    const store = new Proxy(db, { get(target, key) {
      if (key === 'runTransaction') return (fn: any) => target.runTransaction(async tx => { const result = await fn(tx); if (first) { first = false; signal(); await wait; } return result; });
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const operationId = `${setupData.cashId}-delete`; owned.add(`voucherMutationOperations/${operationId}`);
    const deletion = mutateCashEntry(store, 'taebaek', 'uid', { operationId, cashEntryId: setupData.cashId, action: 'delete', expectedRevision: 0, expectedCashHash: cashOriginalHash(setupData.original), releaseId: run });
    await ready;
    const allocationId = `${setupData.cashId}-match`; owned.add(`manualSettlementBatchOperations/${allocationId}`);
    owned.add(`settlements/manual-${allocationId}-${setupData.statementId}`);
    const allocation = replaceManualSettlementBatch(db, 'taebaek', 'uid', { operationId: allocationId, cashEntryId: setupData.cashId,
      partnerId: setupData.partnerId, allocations: [{ statementId: setupData.statementId, amount: 100 }], expectedPartnerRevision: 0, releaseId: run });
    const outcome = allocation.then(() => 'applied', () => 'rejected');
    release(); await deletion;
    expect(await outcome).toBe('rejected');
    expect((await db.collection('settlements').where('cashEntryId', '==', setupData.cashId).get()).empty).toBe(true);
  });
});
