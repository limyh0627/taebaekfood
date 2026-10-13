import { autoVoucherDraft, scheduledCashAccountId } from './autoVoucherDraft';
import { recurringId } from './shared/recurringVoucher';
import { readCashCreationMutation } from './cashMutationReceipt';
import { readVoucherCounter, writeVoucherCounter } from './newScopeCounter';
import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { formatVoucherNo, voucherSequenceKey } from './voucherIssue';
import { planLoanMovement, type LoanCash, type LoanSnapshot } from './loanMovementPlan';
import { assertReleaseActive, assertVoucherDateAllowed, releaseGateRef } from './releaseGate';
import {readStatementTargetClaims,assertStatementTargetUnclaimed} from './statementIssueReceipt';

type Row = Record<string, any>;
export type LoanMovementInput = {
  operationId: string; loanId: string; tradeDate: string; cashAccountId: string;
  action: '차입' | '상환'; principal: number; interest: number;
  expectedRevision: number; releaseId: string; note?: string;
};
function fail(message: string): never { throw new HttpsError('failed-precondition', message); }
const bad = (message: string): never => { throw new HttpsError('invalid-argument', message); };
const companyOf = (row: Row) => row.companyId ?? 'taebaek';
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && !Number.isNaN(new Date(`${date}T00:00:00Z`).valueOf())
  && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
    : value;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

type ScheduledRequest = { templateId: string; yearMonth: string; loanCode: string; input: LoanMovementInput };

function validateLoanMovement(actorId: string, input: LoanMovementInput) {
  if (!actorId || !input || typeof input !== 'object') bad('대출 이동 요청이 잘못되었습니다.');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(input.operationId) || !input.loanId || !input.cashAccountId
    || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
    || !validDate(input.tradeDate) || !['차입', '상환'].includes(input.action)
    || !Number.isSafeInteger(input.principal) || input.principal < 0
    || !Number.isSafeInteger(input.interest) || input.interest < 0
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500))) bad('대출 원금·이자·작업 입력이 잘못되었습니다.');
}

async function loanMovementInTransaction(db: admin.firestore.Firestore, tx: admin.firestore.Transaction, companyId: string, actorId: string, input: LoanMovementInput, scheduledRequest?: ScheduledRequest) {
  validateLoanMovement(actorId, input);
  const requestHash = hash({ ...input, note: input.note?.trim() ?? '', ...(scheduledRequest ? { scheduledRequest } : {}) });
  const operation = db.collection('loanMovementOperations').doc(input.operationId);
  const cash = db.collection('cashEntries').doc(input.operationId);
  const other = db.collection('issuedStatements').doc(input.operationId);
  const contract = db.collection('loanContracts').doc(input.loanId);
  const account = db.collection('cashAccounts').doc(input.cashAccountId);
  const counter = db.collection('appMeta').doc(voucherSequenceKey(companyId, input.tradeDate));
  const cutover = db.collection('appMeta').doc(`loanMovementCutover_${companyId}`);
  const releaseGate = releaseGateRef(db);
    const releaseSnap=await tx.get(releaseGate);
    const movementRows=await tx.get(db.collection('cashEntries').where('loanId','==',input.loanId));
    const creationAudit=await tx.get(db.collection('voucherMutationOperations').where('cashEntryIds','array-contains',input.operationId));
    const counterSnap=await tx.get(counter);
    const targetClaims=await readStatementTargetClaims(db,tx,companyId,input.operationId);
    const operationSnap = await tx.get(operation);
    const [cashSnap, otherSnap, contractSnap, accountSnap, cutoverSnap] = await Promise.all([
      tx.get(cash), tx.get(other), tx.get(contract), tx.get(account), tx.get(cutover),
    ]);
    const prior = operationSnap.data();
    if (operationSnap.exists && prior?.status === 'rejected') {
      if (prior.companyId !== companyId || prior.requestHash !== requestHash || prior.loanId !== input.loanId
        || cashSnap.exists || otherSnap.exists
        || !['invalid-argument', 'failed-precondition'].includes(prior.failureCode)
        || typeof prior.failureMessage !== 'string') fail('기존 거절 작업과 요청·금융문서가 다릅니다.');
      return { status: 'rejected' as const, failureCode: prior.failureCode as 'invalid-argument' | 'failed-precondition', failureMessage: prior.failureMessage as string };
    }
    let writesStarted = false;
    try {
    if (operationSnap.exists) {
      const prior = operationSnap.data()!, stored = cashSnap.data();
      if (creationAudit.docs.length && prior.companyId === companyId && prior.requestHash === requestHash && (!cashSnap.exists || (stored?.mutationRevision ?? 0) > 0)) {
        const original = await readCashCreationMutation(db, tx, companyId, input.operationId, cashSnap, row => {
          const business = { companyId: row.companyId, loanId: row.loanId, date: row.date,
            cashAccountId: row.cashAccountId, dir: row.dir, amount: row.amount,
            accountCode: row.accountCode ?? null, lines: row.lines ?? null, note: row.note };
          return row.loanId === input.loanId && row.issueOperationId === input.operationId && row.issuePayloadHash === requestHash
            && row.docNo === prior.docNo && hash(business) === prior.entryHash;
        });
        if (original) return { status: 'duplicate' as const, id: input.operationId, docNo: prior.docNo, balanceAfter: prior.balanceAfter };
      }
      const business = stored && { companyId: stored.companyId, loanId: stored.loanId, date: stored.date,
        cashAccountId: stored.cashAccountId, dir: stored.dir, amount: stored.amount,
        accountCode: stored.accountCode ?? null, lines: stored.lines ?? null, note: stored.note };
      if (prior.companyId !== companyId || prior.requestHash !== requestHash || !cashSnap.exists
        || stored?.docNo !== prior.docNo || stored?.issueOperationId !== input.operationId
        || stored?.issuePayloadHash !== requestHash || hash(business) !== prior.entryHash)
        fail('기존 대출 작업과 요청이 다릅니다.');
      return { status: 'duplicate' as const, id: input.operationId, docNo: prior.docNo, balanceAfter: prior.balanceAfter };
    }
    assertReleaseActive(releaseSnap, input.releaseId);
    assertVoucherDateAllowed(releaseSnap, companyId, input.tradeDate);
    assertStatementTargetUnclaimed(targetClaims);
    if (cashSnap.exists || otherSnap.exists) fail('작업 ID가 이미 사용 중입니다.');
    if (!cutoverSnap.exists || cutoverSnap.data()?.companyId !== companyId
      || cutoverSnap.data()?.enabled !== true || cutoverSnap.data()?.legacyWritersBlocked !== true
      || cutoverSnap.data()?.auditPassed !== true) fail('대출 writer 전환이 준비되지 않았습니다.');
    if (!contractSnap.exists || companyOf(contractSnap.data()!) !== companyId) fail('대출 계약의 회사가 맞지 않습니다.');
    const loanData = contractSnap.data()!;
    if ((scheduledRequest && loanData.accountCode !== scheduledRequest.loanCode)
      || !['260', '293'].includes(loanData.accountCode) || !validDate(loanData.openingDate)
      || input.tradeDate < loanData.openingDate) fail('대출 계약일·원금 계정이 맞지 않습니다.');
    const revision = loanData.movementRevision ?? 0;
    if (!Number.isSafeInteger(revision) || revision !== input.expectedRevision) fail('대출 계약이 변경되었습니다.');
    if (!accountSnap.exists || companyOf(accountSnap.data()!) !== companyId
      || accountSnap.data()?.active !== true || accountSnap.data()?.type !== '통장') fail('회사 통장 계좌가 맞지 않습니다.');
    const sequence = await readVoucherCounter(db, tx, counterSnap, releaseSnap, companyId, input.tradeDate, '');
    if (sequence.companyId !== companyId || sequence.tradeDate !== input.tradeDate || sequence.prefix !== ''
      || !Number.isSafeInteger(sequence.last) || sequence.last < 0) fail('전표 번호 카운터가 손상되었습니다.');
    const loan: LoanSnapshot = { id: input.loanId, companyId, accountCode: loanData.accountCode,
      openingDate: loanData.openingDate, openingPrincipal: loanData.openingPrincipal };
    const movements: LoanCash[] = movementRows.docs.map(doc => {
      const row = doc.data();
      if (companyOf(row) !== companyId) fail('다른 회사의 대출 연결 전표가 있습니다.');
      return { id: doc.id, companyId: companyOf(row), loanId: row.loanId, date: row.date, createdAt: row.createdAt,
        dir: row.dir, amount: row.amount, accountCode: row.accountCode,
        lines: Array.isArray(row.lines) ? row.lines.map((line: Row) => ({ accountCode: line.accountCode, amount: line.amount, side: line.side })) : undefined };
    });
    let plan: ReturnType<typeof planLoanMovement>;
    try { plan = planLoanMovement(loan, movements, input); }
    catch (error) {
      if (scheduledRequest && error instanceof Error) fail(error.message);
      throw error;
    }
    if (loanData.principalBalance !== undefined && loanData.principalBalance !== plan.balanceBefore)
      fail('대출 계약 잔액과 원장 합계가 다릅니다.');
    const next = sequence.last + 1;
    if (!Number.isSafeInteger(next)) fail('전표 번호 범위를 초과했습니다.');
    const docNo = formatVoucherNo(input.tradeDate, next);
    const business = { companyId, loanId: input.loanId, date: input.tradeDate,
      cashAccountId: input.cashAccountId, dir: plan.dir, amount: plan.amount,
      accountCode: plan.accountCode ?? null, lines: plan.lines ?? null, note: input.note?.trim() || `${loanData.name ?? '대출'} ${input.action}` };
    const createdAt = new Date().toISOString();
    writesStarted = true;
    writeVoucherCounter(tx, counterSnap, sequence, next);
    tx.update(contract, { movementRevision: revision + 1, principalBalance: plan.balanceAfter });
    tx.create(cash, { ...business, ...(business.accountCode ? { accountCode: business.accountCode } : {}),
      ...(business.lines ? { lines: business.lines } : {}), partnerId: loanData.partnerId ?? null,
      partnerName: loanData.lenderName ?? '', docNo, createdAt, createdBy: actorId,
      issueOperationId: input.operationId, issuePayloadHash: requestHash, issuePrefix: '' });
    tx.create(operation, { companyId, loanId: input.loanId, requestHash,
      entryHash: hash(business), balanceBefore: plan.balanceBefore, balanceAfter: plan.balanceAfter,
      principalDelta: plan.principalDelta, cashEntryId: input.operationId, docNo, createdAt, createdBy: actorId,
      ...(scheduledRequest ? { scheduledRequest } : {}) });
    return { status: 'applied' as const, id: input.operationId, docNo, balanceAfter: plan.balanceAfter };
    } catch (error) {
      if (!operationSnap.exists && !cashSnap.exists && !otherSnap.exists && !writesStarted
        && error instanceof HttpsError && ['invalid-argument', 'failed-precondition'].includes(error.code)) {
        const failureCode = error.code as 'invalid-argument' | 'failed-precondition';
        tx.create(operation, { companyId, loanId: input.loanId, requestHash, status: 'rejected',
          failureCode, failureMessage: error.message, createdAt: new Date().toISOString(), createdBy: actorId,
          ...(scheduledRequest ? { scheduledRequest } : {}) });
        return { status: 'rejected' as const, failureCode, failureMessage: error.message };
      }
      throw error;
    }
}

function finishLoanMovement(outcome: Awaited<ReturnType<typeof loanMovementInTransaction>>, companyId: string, input: LoanMovementInput) {
  if (outcome.status === 'rejected') throw new HttpsError(outcome.failureCode, outcome.failureMessage, {
    loanMovementFailure: { version: 2, companyId, loanId: input.loanId, operationId: input.operationId,
      operationRejected: true, financialWrites: false },
  });
  return outcome;
}

export async function recordLoanMovement(db: admin.firestore.Firestore, companyId: string, actorId: string, input: LoanMovementInput) {
  validateLoanMovement(actorId, input);
  const outcome = await db.runTransaction(tx => loanMovementInTransaction(db, tx, companyId, actorId, input));
  return finishLoanMovement(outcome, companyId, input);
}

/** A monthly retry uses its captured request before reading a newer contract revision. */
export async function recordScheduledLoanMovement(db: admin.firestore.Firestore, templateId: string, companyId: string, yearMonth: string, issueDate: string, releaseId: string) {
  const operationId = recurringId(templateId, yearMonth);
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(operationId) || !['taebaek', 'punghoe'].includes(companyId)) bad('정기 대출 양식의 회사·작업이 잘못되었습니다.');
  return db.runTransaction<{ skip: string } | { outcome: Awaited<ReturnType<typeof loanMovementInTransaction>>; input: LoanMovementInput }>(async tx => {
    // 정기 발행도 계약·개별 영수증을 먼저 잡으면 일반 발행의 gate 대기와 순환할 수 있다.
    await tx.get(releaseGateRef(db));
    const operation = await tx.get(db.collection('loanMovementOperations').doc(operationId));
    if (operation.exists) {
      const prior = operation.data()!, saved = prior.scheduledRequest as ScheduledRequest | undefined;
      if (prior.companyId !== companyId || prior.createdBy !== 'system:dailyAutoVoucher'
        || !saved || saved.templateId !== templateId || saved.yearMonth !== yearMonth
        || saved.input?.operationId !== operationId || !validDate(saved.input.tradeDate) || saved.input.tradeDate.slice(0, 7) !== yearMonth
        || !['260', '293'].includes(saved.loanCode)) fail('기존 정기 대출 발행 원문이 다릅니다.');
      if (saved.input.tradeDate !== issueDate) return { skip: '발행일 아님' };
      const outcome = await loanMovementInTransaction(db, tx, companyId, 'system:dailyAutoVoucher', saved.input, saved);
      return { outcome, input: saved.input };
    }
    const template = await tx.get(db.collection('fixedCostTemplates').doc(templateId));
    if (!template.exists || template.data()?.companyId !== companyId) fail('정기 대출 양식의 회사가 맞지 않습니다.');
    const decision = autoVoucherDraft({ ...template.data(), id: templateId }, yearMonth, issueDate);
    if (!decision.loan) return { skip: decision.skip ?? '대출 연결 양식 아님' };
    const draft = decision.loan;
    const [contract, accounts] = await Promise.all([
      tx.get(db.collection('loanContracts').doc(draft.loanId)),
      tx.get(db.collection('cashAccounts')),
    ]);
    if (!contract.exists || companyOf(contract.data()!) !== companyId) fail('대출 계약의 회사가 맞지 않습니다.');
    const cashAccountId = scheduledCashAccountId(accounts.docs.filter(row => row.data().type === '통장').map(row => ({ id: row.id, companyId: row.data().companyId, active: row.data().active, type: row.data().type })), draft.companyId);
    if (!cashAccountId) fail('정기 대출 발행에 사용할 회사 통장이 없습니다.');
    const input: LoanMovementInput = { operationId, loanId: draft.loanId, tradeDate: draft.tradeDate, cashAccountId,
      action: '상환', principal: draft.principal, interest: draft.interest,
      expectedRevision: contract.data()!.movementRevision ?? 0, releaseId, note: draft.note };
    const saved: ScheduledRequest = { templateId, yearMonth, loanCode: draft.loanCode, input };
    const outcome = await loanMovementInTransaction(db, tx, companyId, 'system:dailyAutoVoucher', input, saved);
    // Return terminal rejection only after its transaction commits.
    return { outcome, input };
  }).then(value => 'outcome' in value ? { result: finishLoanMovement(value.outcome, companyId, value.input) } : value);
}

export const recordLoanMovementCommand = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const companyId = request.auth.token.companyId;
  if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  return recordLoanMovement(admin.firestore(), companyId, request.auth.uid, request.data as LoanMovementInput);
});
