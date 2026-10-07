import { readVoucherCounter, writeVoucherCounter } from './newScopeCounter';
import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { formatVoucherNo, voucherSequenceKey } from './voucherIssue';
import { planLoanMovement, type LoanCash, type LoanSnapshot } from './loanMovementPlan';
import { assertReleaseActive, assertVoucherDateAllowed, releaseGateRef } from './releaseGate';

type Row = Record<string, any>;
type Input = {
  operationId: string; loanId: string; tradeDate: string; cashAccountId: string;
  action: '차입' | '상환'; principal: number; interest: number;
  expectedRevision: number; releaseId: string; note?: string;
};
const fail = (message: string): never => { throw new HttpsError('failed-precondition', message); };
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

export async function recordLoanMovement(db: admin.firestore.Firestore, companyId: string, actorId: string, input: Input) {
  if (!actorId || !input || typeof input !== 'object') bad('대출 이동 요청이 잘못되었습니다.');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(input.operationId) || !input.loanId || !input.cashAccountId
    || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
    || !validDate(input.tradeDate) || !['차입', '상환'].includes(input.action)
    || !Number.isSafeInteger(input.principal) || input.principal < 0
    || !Number.isSafeInteger(input.interest) || input.interest < 0
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500))) bad('대출 원금·이자·작업 입력이 잘못되었습니다.');
  const requestHash = hash({ ...input, note: input.note?.trim() ?? '' });
  const operation = db.collection('loanMovementOperations').doc(input.operationId);
  const cash = db.collection('cashEntries').doc(input.operationId);
  const other = db.collection('issuedStatements').doc(input.operationId);
  const contract = db.collection('loanContracts').doc(input.loanId);
  const account = db.collection('cashAccounts').doc(input.cashAccountId);
  const counter = db.collection('appMeta').doc(voucherSequenceKey(companyId, input.tradeDate));
  const cutover = db.collection('appMeta').doc(`loanMovementCutover_${companyId}`);
  const releaseGate = releaseGateRef(db);
  return db.runTransaction(async tx => {
    const [operationSnap, cashSnap, otherSnap, contractSnap, accountSnap, counterSnap, cutoverSnap, movementRows, releaseSnap] = await Promise.all([
      tx.get(operation), tx.get(cash), tx.get(other), tx.get(contract), tx.get(account), tx.get(counter), tx.get(cutover),
      tx.get(db.collection('cashEntries').where('loanId', '==', input.loanId)),
      tx.get(releaseGate),
    ]);
    assertReleaseActive(releaseSnap, input.releaseId);
    assertVoucherDateAllowed(releaseSnap, companyId, input.tradeDate);
    if (operationSnap.exists) {
      const prior = operationSnap.data()!, stored = cashSnap.data();
      const business = stored && { companyId: stored.companyId, loanId: stored.loanId, date: stored.date,
        cashAccountId: stored.cashAccountId, dir: stored.dir, amount: stored.amount,
        accountCode: stored.accountCode ?? null, lines: stored.lines ?? null, note: stored.note };
      if (prior.companyId !== companyId || prior.requestHash !== requestHash || !cashSnap.exists
        || stored?.docNo !== prior.docNo || stored?.issueOperationId !== input.operationId
        || stored?.issuePayloadHash !== requestHash || hash(business) !== prior.entryHash)
        fail('기존 대출 작업과 요청이 다릅니다.');
      return { status: 'duplicate' as const, id: input.operationId, docNo: prior.docNo, balanceAfter: prior.balanceAfter };
    }
    if (cashSnap.exists || otherSnap.exists) fail('작업 ID가 이미 사용 중입니다.');
    if (!cutoverSnap.exists || cutoverSnap.data()?.companyId !== companyId
      || cutoverSnap.data()?.enabled !== true || cutoverSnap.data()?.legacyWritersBlocked !== true
      || cutoverSnap.data()?.auditPassed !== true) fail('대출 writer 전환이 준비되지 않았습니다.');
    if (!contractSnap.exists || companyOf(contractSnap.data()!) !== companyId) fail('대출 계약의 회사가 맞지 않습니다.');
    const loanData = contractSnap.data()!;
    if (!['260', '293'].includes(loanData.accountCode) || !validDate(loanData.openingDate)
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
    const plan = planLoanMovement(loan, movements, input);
    if (loanData.principalBalance !== undefined && loanData.principalBalance !== plan.balanceBefore)
      fail('대출 계약 잔액과 원장 합계가 다릅니다.');
    const next = sequence.last + 1;
    if (!Number.isSafeInteger(next)) fail('전표 번호 범위를 초과했습니다.');
    const docNo = formatVoucherNo(input.tradeDate, next);
    const business = { companyId, loanId: input.loanId, date: input.tradeDate,
      cashAccountId: input.cashAccountId, dir: plan.dir, amount: plan.amount,
      accountCode: plan.accountCode ?? null, lines: plan.lines ?? null, note: input.note?.trim() || `${loanData.name ?? '대출'} ${input.action}` };
    const createdAt = new Date().toISOString();
    writeVoucherCounter(tx, counterSnap, sequence, next);
    tx.update(contract, { movementRevision: revision + 1, principalBalance: plan.balanceAfter });
    tx.create(cash, { ...business, ...(business.accountCode ? { accountCode: business.accountCode } : {}),
      ...(business.lines ? { lines: business.lines } : {}), partnerId: loanData.partnerId ?? null,
      partnerName: loanData.lenderName ?? '', docNo, createdAt, createdBy: actorId,
      issueOperationId: input.operationId, issuePayloadHash: requestHash, issuePrefix: '' });
    tx.create(operation, { companyId, loanId: input.loanId, requestHash,
      entryHash: hash(business), balanceBefore: plan.balanceBefore, balanceAfter: plan.balanceAfter,
      principalDelta: plan.principalDelta, cashEntryId: input.operationId, docNo, createdAt, createdBy: actorId });
    return { status: 'applied' as const, id: input.operationId, docNo, balanceAfter: plan.balanceAfter };
  });
}

export const recordLoanMovementCommand = onCall({ region: 'asia-northeast3' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const companyId = request.auth.token.companyId;
  if (!request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  return recordLoanMovement(admin.firestore(), companyId, request.auth.uid, request.data as Input);
});
