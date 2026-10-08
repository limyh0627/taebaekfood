import { readClaimsAfterReturns } from './returnClaimReader';
import * as admin from 'firebase-admin';
import { cashMutationHash, cashOriginalHash } from './cashMutationReceipt';
export { cashMutationHash, cashOriginalHash } from './cashMutationReceipt';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertInterCompanyAuthority } from './interCompanyAuthority';
import { buildAccountLedger, type LedgerCashEntry } from './shared/cashAccountLedger';
import { kstDateOf } from './shared/calculation';
import { assertReleaseActive, releaseGateRef } from './releaseGate';
import { planCashEdit, planCashSettlements, planLoanCashMutation, validateCashSettlementLimits, type CashPatch, type CashRow } from './cashMutationPlan';
import { checkPayrollDraft, payrollVoucherContent, payrollVoucherHash, type PayrollDraftInput } from './payrollVoucher';
import type { LoanCash, LoanSnapshot } from './loanMovementPlan';
import { cashFromEntry, claimFromStatement } from './partnerPaymentCommand';
import { type ReturnApplication } from './partnerPaymentPlan';
type AuthClaims = { employeeId?: unknown; companyId?: unknown; isAdmin?: unknown };
export type TransferCashEdit = { counterpartId: string; expectedRevision: number; expectedCashHash: string; patch?: CashPatch };
export type CashMutationInput = { operationId: string; cashEntryId: string; action: 'edit' | 'delete';
  expectedRevision: number; expectedCashHash: string; releaseId: string; patch?: CashPatch; payrollEdit?: PayrollDraftInput; transferEdit?: TransferCashEdit };
const owner = (row: CashRow) => row.companyId ?? 'taebaek';
function fail(message: string): never { throw new HttpsError('failed-precondition', message); }
/** Basic full-cash branch. Special contracts are integrated before exposing the callable in index. */
export async function mutateCashEntry(db: admin.firestore.Firestore, companyId: string, actorId: string, input: CashMutationInput, authClaims?: AuthClaims) {
  if (!actorId || !['taebaek', 'punghoe'].includes(companyId) || !input
    || !/^[A-Za-z0-9_-]{1,160}$/.test(input.operationId) || !/^[A-Za-z0-9_-]{1,160}$/.test(input.cashEntryId)
    || !['edit', 'delete'].includes(input.action) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || !/^[a-f0-9]{64}$/.test(input.expectedCashHash) || !/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)
    || (input.action === 'edit' ? !input.patch : input.patch !== undefined)) throw new HttpsError('invalid-argument', '자금전표 변경 입력이 잘못되었습니다.');
  const operation = db.collection('voucherMutationOperations').doc(input.operationId);
  const cashRef = db.collection('cashEntries').doc(input.cashEntryId);
  const requestHash = cashMutationHash({ companyId, actorId, ...input });
  return db.runTransaction(async tx => {
    const [gate, prior, snap, linkedRows, codes, statements, settlements, cashRows, returns] = await Promise.all([
      tx.get(releaseGateRef(db)), tx.get(operation), tx.get(cashRef),
      tx.get(db.collection('settlements').where('cashEntryId', '==', input.cashEntryId)),
      tx.get(db.collection('accountCodes').where('companyId', '==', companyId)),
      tx.get(db.collection('issuedStatements')), tx.get(db.collection('settlements')),
      tx.get(db.collection('cashEntries')), tx.get(db.collection('returnApplications')),
    ]);
    assertReleaseActive(gate, input.releaseId);
    if (prior.exists) {
      const saved = prior.data()!;
      if (saved.companyId !== companyId || saved.createdBy !== actorId || saved.requestHash !== requestHash
        || saved.kind !== 'cashEntries' || saved.voucherId !== input.cashEntryId || saved.status !== 'applied') fail('기존 자금 변경 요청과 내용이 다릅니다.');
      return { ...saved.result, status: 'duplicate' as const };
    }
    const current = snap.data();
    if (!current || owner(current) !== companyId) fail('자금전표의 회사가 맞지 않습니다.');
    if ((current.mutationRevision ?? 0) !== input.expectedRevision || cashOriginalHash(current) !== input.expectedCashHash) fail('자금전표가 다른 화면에서 변경되었습니다.');
    // These branches retain their full semantics; they are not exposed until the linked contracts below are implemented.
    if (current.transferOperationId) return mutateTransferCash(tx, db, companyId, actorId, authClaims, input, current, operation, requestHash);
    if (input.transferEdit) fail('회사이체 원본이 없는 요청입니다.');
    const loanSnapshot = current.loanId ? await tx.get(db.collection('loanContracts').doc(current.loanId)) : null;
    const loanMovements = current.loanId ? await tx.get(db.collection('cashEntries').where('loanId', '==', current.loanId)) : null;
    const payrollSnapshot = current.payrollId ? await tx.get(db.collection('payrolls').doc(current.payrollId)) : null;
    const partnerId = input.patch?.partnerId === undefined ? current.partnerId : input.patch.partnerId;
    const partnerSnap = partnerId ? await tx.get(db.collection('partners').doc(partnerId)) : null;
    const adjustmentAccount = current.balanceAdjustment && current.cashAccountId ? await tx.get(db.collection('cashAccounts').doc(current.cashAccountId)) : null;
    let next: CashRow | null;
    let linked: CashRow[];
    const allStatements = statements.docs.map<CashRow>(doc => ({ ...doc.data(), id: doc.id }));
    try {
      let editable = current;
      if (current.balanceAdjustment && input.action === 'edit') {
        const account = adjustmentAccount?.data();
        const date = input.patch!.date ?? current.date, amount = input.patch!.amount ?? current.amount;
        const direction = input.patch!.dir ?? current.dir;
        if (!account || owner(account) !== companyId || date < account.openingDate || date > kstDateOf(new Date())
          || !['입금', '출금'].includes(direction) || !Number.isSafeInteger(amount) || amount <= 0) fail('잔액 조정 계좌·날짜·금액을 확인해주세요.');
        const entries = cashRows.docs.filter(doc => doc.id !== input.cashEntryId && owner(doc.data()) === companyId)
          .map(doc => ({ ...doc.data(), id: doc.id } as LedgerCashEntry));
        const before = buildAccountLedger({ ...account, id: adjustmentAccount!.id } as any, entries, '', date).closing;
        const delta = direction === '입금' ? amount : -amount;
        if (!Number.isSafeInteger(before) || !Number.isSafeInteger(before + delta)) fail('잔액 조정 계산 범위를 초과했습니다.');
        editable = { ...current, date, balanceAdjustment: { ...current.balanceAdjustment, before, delta, target: before + delta } };
      }
      next = input.action === 'delete' ? null : planCashEdit(editable, input.patch!, codes.docs.map(doc => doc.data().code),
        partnerSnap?.exists ? { ...partnerSnap.data(), id: partnerSnap.id } : undefined, companyId);
      linked = planCashSettlements(current, next, linkedRows.docs.map(doc => ({ ...doc.data(), id: doc.id })), allStatements, companyId);
    } catch (error) { fail(error instanceof Error ? error.message : '자금 수정 입력을 확인해주세요.'); }
    const now = new Date();
    if (next && next.date !== current.date) {
      const today = kstDateOf(now);
      next.createdAt = next.date === today ? now.toISOString()
        : new Date(`${next.date}T${next.date < today ? '23:59:59.999' : '00:00:00.000'}+09:00`).toISOString();
    }
    let loanUpdate: { principalBalance: number; movementRevision: number } | null = null;
    if (current.loanId) {
      const loan = loanSnapshot?.data();
      if (!loan || owner(loan) !== companyId || !Number.isSafeInteger(loan.movementRevision ?? 0)) fail('대출 계약의 회사·revision을 확인해주세요.');
      const movements = loanMovements!.docs.map(doc => ({ ...doc.data(), id: doc.id } as LoanCash));
      if (movements.some(row => (row.companyId ?? 'taebaek') !== companyId)) fail('대출 움직임에 다른 회사가 있습니다.');
      try {
        const plan = planLoanCashMutation({ ...loan, id: current.loanId, companyId } as LoanSnapshot, movements, input.cashEntryId, next, loan.principalBalance);
        loanUpdate = { principalBalance: plan.balanceAfter, movementRevision: (loan.movementRevision ?? 0) + 1 };
        if (!Number.isSafeInteger(loanUpdate.movementRevision)) fail('대출 revision 범위를 초과했습니다.');
      } catch (error) { fail(error instanceof Error ? error.message : '대출 원장 변경을 확인해주세요.'); }
    }
    let payrollUpdate: CashRow | null = null;
    if (current.payrollId) {
      const payroll = payrollSnapshot?.data();
      if (!payroll || owner(payroll) !== companyId || payroll.cashEntryId !== input.cashEntryId
        || payroll.issueKind !== 'cashEntries' || !Number.isSafeInteger(payroll.revision ?? 0)) fail('급여대장과 자금전표의 연결을 확인해주세요.');
      if (input.action === 'delete') {
        payrollUpdate = { revision: (payroll.revision ?? 0) + 1, issueCancelled: true,
          issueCancellationOperationId: input.operationId, updatedAt: now.toISOString() };
      } else {
        if (!input.payrollEdit || input.payrollEdit.yearMonth !== payroll.yearMonth || input.payrollEdit.expectedRevision !== (payroll.revision ?? 0)) fail('화면에서 읽은 급여대장과 revision이 필요합니다.');
        const checked = checkPayrollDraft(companyId, input.payrollEdit);
        if (checked.id !== current.payrollId || next!.date !== input.payrollEdit.payDate || next!.dir !== '출금'
          || next!.amount !== checked.totals.net || next!.partnerId || checked.totals.net <= 0) fail('급여대장과 현금 금액·일자·방향이 맞지 않습니다.');
        const employees = await Promise.all(checked.lines.map(line => tx.get(db.collection('employees').doc(line.employeeId))));
        employees.forEach((employee, index) => {
          const row = employee.data();
          if (!row || owner(row) !== companyId || row.name !== checked.lines[index].employeeName) fail('급여 대상 사원의 회사·이름이 맞지 않습니다.');
        });
        const salary = codes.docs.find(doc => doc.data().name === '급여')?.data().code;
        const withhold = codes.docs.find(doc => doc.data().name === '예수금')?.data().code;
        if (!salary || checked.totals.deduct > 0 && !withhold) fail('급여·예수금 계정을 확인해주세요.');
        const actual = next!.lines?.length ? next!.lines : [{ accountCode: next!.accountCode, amount: next!.amount }];
        const normalized = actual.map((line: CashRow) => ({ code: line.accountCode,
          amount: line.side === '대변' ? -Math.abs(line.amount) : line.side === '차변' ? Math.abs(line.amount) : line.amount }));
        const expected = [{ code: salary, amount: checked.totals.gross }, ...(checked.totals.deduct ? [{ code: withhold, amount: -checked.totals.deduct }] : [])];
        if (cashMutationHash(normalized) !== cashMutationHash(expected)) fail('급여대장 총액·공제와 자금 분개가 맞지 않습니다.');
        payrollUpdate = { lines: checked.lines, payDate: input.payrollEdit.payDate, note: next!.note ?? '', revision: (payroll.revision ?? 0) + 1,
          issueOriginalVoucherHash: payroll.issueOriginalVoucherHash ?? payroll.issueVoucherHash,
          issueVoucherHash: payrollVoucherHash(payrollVoucherContent('cashEntries', next!)), updatedAt: now.toISOString() };
      }
    } else if (input.payrollEdit) fail('급여 원전표가 없는 요청입니다.');
    if (current.linkedAccrualStatementId) {
      const source = allStatements.find(row => row.id === current.linkedAccrualStatementId);
      if (!source || owner(source) !== companyId || source.type !== '비용' || source.partnerId
        || !Array.isArray(source.items)) fail('미지급비용 발생 원전표가 맞지 않습니다.');
      const accrued = source.items.filter((line: CashRow) => line.accountCode === '275' && line.side === '대변')
        .reduce((sum: number, line: CashRow) => sum + line.total, 0);
      if (!Number.isSafeInteger(accrued) || accrued <= 0) fail('발생 원전표의 미지급비용 금액이 잘못되었습니다.');
      if (next && (next.dir !== '출금' || next.partnerId || next.lines?.length || next.accountCode !== '275')) fail('연결 지급은 미지급비용 출금 분개를 유지해야 합니다.');
      const others = cashRows.docs.filter(doc => doc.id !== input.cashEntryId && doc.data().linkedAccrualStatementId === current.linkedAccrualStatementId);
      if (others.some(doc => owner(doc.data()) !== companyId || doc.data().dir !== '출금'
        || doc.data().accountCode !== '275' || !Number.isSafeInteger(doc.data().amount) || doc.data().amount <= 0)) fail('발생 전표의 기존 지급 연결을 확인해주세요.');
      const paid = others.reduce((sum, doc) => sum + doc.data().amount, 0) + (next?.amount ?? 0);
      if (!Number.isSafeInteger(paid) || paid > accrued) fail('발생 전표의 미지급비용 잔액을 넘습니다.');
    }
    const affected = new Set<string>([current.partnerId, next?.partnerId].filter(Boolean));
    for (const row of linkedRows.docs) {
      const statement = allStatements.find(statement => statement.id === row.data().statementId);
      if (!statement || owner(statement) !== companyId) fail('연결 정산 원전표가 없습니다.');
      affected.add(statement.partnerId);
    }
    const stateRows = await Promise.all([...affected].map(async id => ({ id, snap: await tx.get(db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${id}`)) })));
    const companyCash = cashRows.docs.filter(doc => owner(doc.data()) === companyId && doc.id !== input.cashEntryId).map<CashRow>(doc => ({ ...doc.data(), id: doc.id }));
    if (next) companyCash.push({ ...next, id: input.cashEntryId });
    const claims = await readClaimsAfterReturns(db, tx, allStatements.filter(row => owner(row) === companyId && affected.has(row.partnerId)).map(row => claimFromStatement(row.id, row)).filter((row): row is NonNullable<typeof row> => row !== null),
      returns.docs.filter(doc => owner(doc.data()) === companyId && affected.has(doc.data().partnerId)).map(doc => ({ ...doc.data(), id: doc.id } as ReturnApplication)), allStatements);
    const companySettlements = settlements.docs.filter(doc => owner(doc.data()) === companyId && doc.data().cashEntryId !== input.cashEntryId).map<CashRow>(doc => ({ ...doc.data(), id: doc.id }));
    companySettlements.push(...linked as any);
    for (const partner of affected) {
      try { validateCashSettlementLimits(claims, companyCash.filter(row => row.partnerId === partner).map(row => cashFromEntry(row.id, row)).filter((row): row is NonNullable<typeof row> => row !== null), companySettlements, partner); }
      catch (error) { fail(error instanceof Error ? error.message : '정산 한도를 확인해주세요.'); }
    }
    for (const state of stateRows) if (!Number.isSafeInteger(state.snap.data()?.revision ?? 0) || (state.snap.data()?.revision ?? 0) < 0 || !Number.isSafeInteger((state.snap.data()?.revision ?? 0) + 1) || state.snap.exists && (state.snap.data()?.companyId !== companyId || state.snap.data()?.partnerId !== state.id)) fail('거래처 revision이 잘못되었습니다.');
    const revision = input.expectedRevision + 1;
    if (!Number.isSafeInteger(revision)) fail('자금 revision 범위를 초과했습니다.');
    const result = { id: input.cashEntryId, action: input.action, revision, docNo: current.docNo ?? '' };
    if (next) tx.update(cashRef, { ...input.patch, ...(Object.prototype.hasOwnProperty.call(input.patch, 'partnerId') ? { partnerName: next.partnerName ?? '' } : {}), ...(next.date !== current.date ? { createdAt: next.createdAt } : {}), ...(current.balanceAdjustment ? { balanceAdjustment: next.balanceAdjustment } : {}), mutationRevision: revision }); else tx.delete(cashRef);
    if (payrollUpdate) tx.update(payrollSnapshot!.ref, payrollUpdate);
    if (loanUpdate) tx.update(loanSnapshot!.ref, loanUpdate);
    for (const row of linkedRows.docs) {
      const updated = linked.find(next => next.id === row.id);
      if (!updated) tx.delete(row.ref); else if (updated.amount !== row.data().amount) tx.update(row.ref, { amount: updated.amount });
    }
    for (const state of stateRows) {
      const value = { companyId, partnerId: state.id, revision: (state.snap.data()?.revision ?? 0) + 1 };
      if (state.snap.exists) tx.update(state.snap.ref, value); else tx.create(state.snap.ref, value);
    }
    tx.create(operation, { companyId, kind: 'cashEntries', voucherId: input.cashEntryId, cashEntryIds: [input.cashEntryId], action: input.action,
      requestHash, status: 'applied', expectedRevision: input.expectedRevision, beforeHash: input.expectedCashHash, beforeSnapshot: current,
      afterHash: next ? cashOriginalHash({ ...next, mutationRevision: revision }) : null, result, createdBy: actorId, createdAt: new Date().toISOString() });
    return { ...result, status: 'applied' as const };
  });
}
export const cashMutationCommand = onCall({ region: 'asia-northeast3' }, async request => {
  const company = request.auth?.token.companyId;
  if (!request.auth || !request.auth.token.isAdmin || !['taebaek', 'punghoe'].includes(String(company))) throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  return mutateCashEntry(admin.firestore(), String(company), request.auth.uid, request.data as CashMutationInput, request.auth.token as AuthClaims);
});

async function readTransferPair(tx: admin.firestore.Transaction, db: admin.firestore.Firestore, companyId: string,
  actorId: string, claims: AuthClaims | undefined, cashId: string, current: CashRow) {
  if (!claims || typeof claims.employeeId !== 'string') fail('회사이체 직원 인증이 필요합니다.');
  const operation = await tx.get(db.collection('companyTransferOperations').doc(current.transferOperationId));
  const transfer = operation.data();
  if (!transfer || !['taebaek', 'punghoe'].includes(transfer.from) || !['taebaek', 'punghoe'].includes(transfer.to)
    || transfer.from === transfer.to || ![transfer.from, transfer.to].includes(companyId)
    || typeof transfer.outCashEntryId !== 'string' || typeof transfer.inCashEntryId !== 'string'
    || ![transfer.outCashEntryId, transfer.inCashEntryId].includes(cashId)) fail('회사이체 원본 operation이 맞지 않습니다.');
  const otherCompany = transfer.from === companyId ? transfer.to : transfer.from;
  const [out, incoming, grant, employee] = await Promise.all([
    tx.get(db.collection('cashEntries').doc(transfer.outCashEntryId)), tx.get(db.collection('cashEntries').doc(transfer.inCashEntryId)),
    tx.get(db.collection('companyTransferGrants').doc(actorId)), tx.get(db.collection('employees').doc(claims.employeeId)),
  ]);
  try { assertInterCompanyAuthority(claims, companyId, otherCompany, grant.data(), actorId); }
  catch { fail('양사 관리자 권한을 증명할 수 없습니다.'); }
  const staff = employee.data();
  if (!staff || staff.authUid !== actorId || staff.companyId !== companyId || staff.adminAccess !== true || staff.status === 'out') fail('현재 직원 관리자 권한이 없습니다.');
  const left = out.data(), right = incoming.data();
  if (!left || !right || owner(left) !== transfer.from || owner(right) !== transfer.to
    || left.transferOperationId !== current.transferOperationId || right.transferOperationId !== current.transferOperationId
    || left.issuePayloadHash !== transfer.requestHash || right.issuePayloadHash !== transfer.requestHash
    || left.dir !== '출금' || right.dir !== '입금' || left.amount !== right.amount || left.date !== right.date) fail('회사이체 양쪽 전표 연결이 맞지 않습니다.');
  if (transfer.latestCashMutationId) {
    const last = await tx.get(db.collection('voucherMutationOperations').doc(transfer.latestCashMutationId));
    if (last.data()?.status !== 'applied' || last.data()?.transferOperationId !== current.transferOperationId
      || last.data()?.transferAfterHashes?.[out.id] !== cashOriginalHash(left)
      || last.data()?.transferAfterHashes?.[incoming.id] !== cashOriginalHash(right)) fail('회사이체 변경 감사와 현재 양쪽 전표가 다릅니다.');
  } else {
    const business = (row: CashRow) => ({ companyId: row.companyId, partnerId: row.partnerId, date: row.date,
      amount: row.amount, note: row.note, cashAccountId: row.cashAccountId, dir: row.dir, lines: row.lines });
    if (cashMutationHash(business(left)) !== transfer.outHash || cashMutationHash(business(right)) !== transfer.inHash) fail('회사이체 원문 hash가 다릅니다.');
  }
  return { operation, transfer, out, incoming, other: cashId === out.id ? incoming : out };
}
/** Server-authorized read for the existing two-company editor; does not refresh the caller's original cash. */
export async function prepareTransferCashEdit(db: admin.firestore.Firestore, companyId: string, actorId: string,
  claims: AuthClaims, input: { cashEntryId: string; expectedCashHash: string; releaseId: string }) {
  if (!input || !/^[A-Za-z0-9_-]{1,160}$/.test(input.cashEntryId) || !/^[a-f0-9]{64}$/.test(input.expectedCashHash)) throw new HttpsError('invalid-argument', '회사이체 조회 입력이 잘못되었습니다.');
  return db.runTransaction(async tx => {
    const [gate, cash] = await Promise.all([tx.get(releaseGateRef(db)), tx.get(db.collection('cashEntries').doc(input.cashEntryId))]);
    assertReleaseActive(gate, input.releaseId);
    const original = cash.data();
    if (!original || owner(original) !== companyId || cashOriginalHash(original) !== input.expectedCashHash || !original.transferOperationId) fail('화면에서 읽은 회사이체 원문이 변경되었습니다.');
    const pair = await readTransferPair(tx, db, companyId, actorId, claims, cash.id, original);
    return { counterpart: { ...pair.other.data(), id: pair.other.id }, expectedRevision: pair.other.data()?.mutationRevision ?? 0,
      expectedCashHash: cashOriginalHash(pair.other.data()!) };
  });
}
async function mutateTransferCash(tx: admin.firestore.Transaction, db: admin.firestore.Firestore, companyId: string,
  actorId: string, claims: AuthClaims | undefined, input: CashMutationInput, current: CashRow,
  operation: admin.firestore.DocumentReference, requestHash: string) {
  const pair = await readTransferPair(tx, db, companyId, actorId, claims, input.cashEntryId, current);
  const other = pair.other.data()!, expected = input.transferEdit;
  if (!expected || expected.counterpartId !== pair.other.id || expected.expectedRevision !== (other.mutationRevision ?? 0)
    || expected.expectedCashHash !== cashOriginalHash(other) || !Number.isSafeInteger(expected.expectedRevision)
    || (input.action === 'edit' ? !expected.patch : expected.patch !== undefined)) fail('다른 회사 전표의 원문·revision·수정 입력이 필요합니다.');
  const [codes, statements, settlements, cashRows, returns] = await Promise.all([
    tx.get(db.collection('accountCodes')), tx.get(db.collection('issuedStatements')), tx.get(db.collection('settlements')),
    tx.get(db.collection('cashEntries')), tx.get(db.collection('returnApplications')),
  ]);
  const originals = [{ id: input.cashEntryId, row: current, patch: input.patch }, { id: pair.other.id, row: other, patch: expected.patch }];
  const nextRows: CashRow[] = [], nextSettlements: CashRow[] = [];
  const allStatements = statements.docs.map<CashRow>(doc => ({ ...doc.data(), id: doc.id }));
  const states: { id: string; companyId: string; partnerId: string; snap: admin.firestore.DocumentSnapshot }[] = [];
  for (const original of originals) {
    const company = owner(original.row), partnerId = original.row.partnerId;
    const [partner, state] = await Promise.all([tx.get(db.collection('partners').doc(partnerId)), tx.get(db.collection('appMeta').doc(`partnerPaymentState_${company}_${partnerId}`))]);
    states.push({ id: original.id, companyId: company, partnerId, snap: state });
    const linked = settlements.docs.filter(doc => doc.data().cashEntryId === original.id).map<CashRow>(doc => ({ ...doc.data(), id: doc.id }));
    try {
      const next = input.action === 'delete' ? null : planCashEdit(original.row, original.patch!, codes.docs.filter(doc => doc.data().companyId === company).map(doc => doc.data().code), partner.exists ? { ...partner.data(), id: partner.id } : undefined, company);
      if (next) {
        if (next.partnerId !== partnerId || next.dir !== original.row.dir) fail('회사이체의 상대회사와 입출금 방향은 양쪽 계약을 유지해야 합니다.');
        if (next.date !== original.row.date) next.createdAt = next.date === kstDateOf(new Date()) ? new Date().toISOString()
          : new Date(`${next.date}T${next.date < kstDateOf(new Date()) ? '23:59:59.999' : '00:00:00.000'}+09:00`).toISOString();
        nextRows.push({ ...next, id: original.id, mutationRevision: (original.row.mutationRevision ?? 0) + 1 });
      }
      nextSettlements.push(...planCashSettlements(original.row, next, linked, allStatements, company));
    } catch (error) { fail(error instanceof Error ? error.message : '양사 전표 수정을 확인해주세요.'); }
  }
  if (nextRows.length && (nextRows[0].amount !== nextRows[1].amount || nextRows[0].date !== nextRows[1].date)) fail('양사 이체 금액과 날짜는 같아야 합니다.');
  if (nextRows.length) {
    const out = nextRows.find(row => row.id === pair.out.id)!, incoming = nextRows.find(row => row.id === pair.incoming.id)!;
    const parts = (row: CashRow) => row.lines?.length ? row.lines : [{ accountCode: row.accountCode, amount: row.amount }];
    const outLines: CashRow[] = parts(out), inLines: CashRow[] = parts(incoming);
    if (outLines.some(row => !['251', '253', '133', '137'].includes(row.accountCode) || row.amount <= 0 || row.side)
      || inLines.some(row => !['108', '254', '267'].includes(row.accountCode) || row.amount <= 0 || row.side)) fail('회사이체의 채권·채무·선급·대여 계정을 확인해주세요.');
    const sum = (lines: CashRow[], codes: string[]) => lines.filter(row => codes.includes(row.accountCode)).reduce((value, row) => value + row.amount, 0);
    if (sum(outLines, ['251', '253']) !== sum(inLines, ['108']) || sum(outLines, ['133']) !== sum(inLines, ['254'])
      || sum(outLines, ['137']) !== sum(inLines, ['267'])) fail('양사 상계액과 선급·선수 또는 대여·차입 금액이 다릅니다.');
  }
  const removedIds = new Set(originals.map(row => row.id));
  const candidateCash = cashRows.docs.filter(doc => !removedIds.has(doc.id)).map<CashRow>(doc => ({ ...doc.data(), id: doc.id })).concat(nextRows);
  const candidateSettlements = settlements.docs.filter(doc => !removedIds.has(doc.data().cashEntryId)).map<CashRow>(doc => ({ ...doc.data(), id: doc.id })).concat(nextSettlements);
  for (const state of states) {
    if (!Number.isSafeInteger(state.snap.data()?.revision ?? 0) || (state.snap.data()?.revision ?? 0) < 0 || !Number.isSafeInteger((state.snap.data()?.revision ?? 0) + 1) || state.snap.exists && (state.snap.data()?.companyId !== state.companyId || state.snap.data()?.partnerId !== state.partnerId)) fail('양사 거래처 revision이 잘못되었습니다.');
    try {
      const claimRows = await readClaimsAfterReturns(db, tx, allStatements.filter(row => owner(row) === state.companyId && row.partnerId === state.partnerId)
        .map(row => claimFromStatement(row.id, row)).filter((row): row is NonNullable<typeof row> => row !== null), returns.docs.filter(doc => owner(doc.data()) === state.companyId && doc.data().partnerId === state.partnerId).map(doc => ({ ...doc.data(), id: doc.id } as ReturnApplication)), allStatements);
      const payments = candidateCash.filter(row => owner(row) === state.companyId && row.partnerId === state.partnerId).map(row => cashFromEntry(row.id, row)).filter((row): row is NonNullable<typeof row> => row !== null);
      validateCashSettlementLimits(claimRows, payments, candidateSettlements.filter(row => owner(row) === state.companyId), state.partnerId);
    } catch (error) { fail(error instanceof Error ? error.message : '양사 정산 한도를 확인해주세요.'); }
  }
  const result = { id: input.cashEntryId, action: input.action, revision: input.expectedRevision + 1, docNo: current.docNo ?? '' };
  const afterHashes: CashRow = {};
  for (const original of originals) {
    const ref = db.collection('cashEntries').doc(original.id), next = nextRows.find(row => row.id === original.id);
    if (next) { const { id: _id, ...data } = next; tx.update(ref, data); afterHashes[original.id] = cashOriginalHash(next); }
    else { tx.delete(ref); afterHashes[original.id] = null; }
  }
  for (const settlement of settlements.docs.filter(doc => removedIds.has(doc.data().cashEntryId))) {
    const next = nextSettlements.find(row => row.id === settlement.id);
    if (!next) tx.delete(settlement.ref); else if (next.amount !== settlement.data().amount) tx.update(settlement.ref, { amount: next.amount });
  }
  for (const state of states) {
    const data = { companyId: state.companyId, partnerId: state.partnerId, revision: (state.snap.data()?.revision ?? 0) + 1 };
    if (state.snap.exists) tx.update(state.snap.ref, data); else tx.create(state.snap.ref, data);
  }
  tx.update(pair.operation.ref, { latestCashMutationId: input.operationId });
  tx.create(operation, { companyId, kind: 'cashEntries', voucherId: input.cashEntryId, cashEntryIds: originals.map(row => row.id), action: input.action, requestHash,
    status: 'applied', result, transferOperationId: current.transferOperationId,
    transferBeforeSnapshots: Object.fromEntries(originals.map(row => [row.id, row.row])), transferAfterHashes: afterHashes,
    createdBy: actorId, createdAt: new Date().toISOString() });
  return { ...result, status: 'applied' as const };
}

export const prepareTransferCashEditCommand = onCall({ region: 'asia-northeast3' }, async request => {
  const company = request.auth?.token.companyId;
  if (!request.auth || !request.auth.token.isAdmin || !['taebaek', 'punghoe'].includes(String(company))) throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  return prepareTransferCashEdit(admin.firestore(), String(company), request.auth.uid, request.auth.token as AuthClaims, request.data);
});
