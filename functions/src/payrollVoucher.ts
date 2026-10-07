import * as admin from 'firebase-admin';
import { readVoucherCounter, writeVoucherCounter } from './newScopeCounter';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { formatVoucherNo, voucherSequenceKey } from './voucherIssue';
import { assertReleaseActive, assertVoucherDateAllowed, releaseGateRef } from './releaseGate';

type Mode = 'cash' | 'accrual';
type Line = { employeeId: string; employeeName: string; base: number; overtime?: number; allowance?: number;
  incomeTax?: number; localTax?: number; pension?: number; health?: number; employment?: number; otherDeduct?: number;
  department?: string; position?: string; note?: string };
type Input = { yearMonth: string; payDate: string; lines: Line[]; expectedRevision: number;
  mode: Mode; releaseId: string; cashAccountId?: string };
type DraftInput = Omit<Input, 'mode' | 'releaseId'>;
const REGION = 'asia-northeast3';
const fields = ['base', 'overtime', 'allowance', 'incomeTax', 'localTax', 'pension', 'health', 'employment', 'otherDeduct'] as const;
const deductions = ['incomeTax', 'localTax', 'pension', 'health', 'employment', 'otherDeduct'] as const;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const payrollId = (companyId: string, ym: string) => companyId === 'taebaek' ? `pay-${ym}` : `pay-${companyId}-${ym}`;
const operationId = (companyId: string, ym: string) => `payroll-${companyId}-${ym}-base`;
function voucherContent(kind: 'cashEntries' | 'issuedStatements', row: Record<string, any>) {
  const shared = { id: row.id, companyId: row.companyId, payrollId: row.payrollId,
    payrollRequestHash: row.payrollRequestHash, payrollFingerprint: row.payrollFingerprint, docNo: row.docNo };
  return kind === 'cashEntries'
    ? { ...shared, date: row.date, dir: row.dir, amount: row.amount, cashAccountId: row.cashAccountId,
        accountCode: row.accountCode ?? null, lines: row.lines ?? null, note: row.note }
    : { ...shared, issuedAt: row.issuedAt, tradeDate: row.tradeDate, type: row.type,
        partnerId: row.partnerId, partnerName: row.partnerName, orderId: row.orderId,
        totalSupply: row.totalSupply, totalTax: row.totalTax, totalAmount: row.totalAmount, items: row.items };
}
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf())
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function checked(companyId: string, input: DraftInput) {
  if (!input || typeof input !== 'object' || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(input.yearMonth) || !validDate(input.payDate)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || !Array.isArray(input.lines) || !input.lines.length) {
    throw new HttpsError('invalid-argument', '급여대장 입력이 잘못되었습니다.');
  }
  const ids = new Set<string>();
  const lines = input.lines.map(line => {
    if (!line || typeof line.employeeId !== 'string' || !line.employeeId || line.employeeId.includes('/'))
      throw new HttpsError('invalid-argument', '급여 대상 사원 ID가 잘못되었습니다.');
    if (ids.has(line.employeeId)) throw new HttpsError('invalid-argument', '같은 사원이 중복되었습니다.');
    ids.add(line.employeeId);
    if (typeof line.employeeName !== 'string' || !line.employeeName.trim())
      throw new HttpsError('invalid-argument', '급여 대상 사원 이름이 잘못되었습니다.');
    const clean: Line = { employeeId: line.employeeId, employeeName: line.employeeName, base: line.base,
      ...(typeof line.department === 'string' ? { department: line.department } : {}),
      ...(typeof line.position === 'string' ? { position: line.position } : {}),
      ...(typeof line.note === 'string' ? { note: line.note } : {}) };
    for (const field of fields) {
      const value = line[field] ?? 0;
      if (!Number.isSafeInteger(value) || value < 0) throw new HttpsError('invalid-argument', '급여 금액은 0 이상의 정수여야 합니다.');
      clean[field] = value;
    }
    return clean;
  });
  const totals = lines.reduce((sum, line) => {
    const gross = line.base + (line.overtime ?? 0) + (line.allowance ?? 0);
    const deduct = deductions.reduce((n, field) => n + (line[field] ?? 0), 0);
    if (deduct > gross) throw new HttpsError('invalid-argument', '공제액이 급여보다 큽니다.');
    return { gross: sum.gross + gross, deduct: sum.deduct + deduct, net: sum.net + gross - deduct };
  }, { gross: 0, deduct: 0, net: 0 });
  if (!Number.isSafeInteger(totals.gross) || !Number.isSafeInteger(totals.deduct)
    || !Number.isSafeInteger(totals.net) || totals.gross <= 0 || totals.gross !== totals.deduct + totals.net) {
    throw new HttpsError('invalid-argument', '급여 합계가 잘못되었습니다.');
  }
  return { id: payrollId(companyId, input.yearMonth), lines, totals };
}

async function checkEmployees(tx: admin.firestore.Transaction, db: admin.firestore.Firestore, companyId: string, lines: Line[]) {
  const snaps = await Promise.all(lines.map(line => tx.get(db.collection('employees').doc(line.employeeId))));
  snaps.forEach((snap, i) => {
    const row = snap.data();
    if (!row || (row.companyId ?? 'taebaek') !== companyId || row.status !== 'working'
      || row.name !== lines[i].employeeName) throw new HttpsError('failed-precondition', '급여 대상 사원 정보가 바뀌었습니다.');
  });
}

/** A new draft is marked; unmarked old payrolls need a cutover audit before issuance. */
export async function savePayrollDraft(db: admin.firestore.Firestore, companyId: string, input: DraftInput) {
  const { id, lines } = checked(companyId, input);
  const ref = db.collection('payrolls').doc(id);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const old = snap.data();
    if (old?.cashEntryId || old?.issueOperationId) throw new HttpsError('failed-precondition', '발행된 급여대장은 직접 수정할 수 없습니다.');
    if (old && old.payrollDraftVersion !== 1) throw new HttpsError('failed-precondition', '기존 급여대장은 발행 이력을 먼저 확인해야 합니다.');
    if ((old?.revision ?? 0) !== input.expectedRevision) throw new HttpsError('aborted', '급여대장이 다른 화면에서 변경되었습니다.');
    await checkEmployees(tx, db, companyId, lines);
    const now = new Date().toISOString();
    const row = { id, companyId, yearMonth: input.yearMonth, payDate: input.payDate, lines,
      payrollDraftVersion: 1, revision: input.expectedRevision + 1,
      createdAt: old?.createdAt ?? now, updatedAt: now };
    if (snap.exists) tx.update(ref, row); else tx.create(ref, row);
    return { revision: row.revision };
  });
}

/** Payroll, voucher and the shared number commit together or not at all. */
export async function issuePayrollVoucher(db: admin.firestore.Firestore, companyId: string, input: Input) {
  if (input?.mode !== 'cash' && input?.mode !== 'accrual') throw new HttpsError('invalid-argument', '급여 전표 종류가 잘못되었습니다.');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)) throw new HttpsError('invalid-argument', '배포 전환 ID가 필요합니다.');
  if (input.cashAccountId !== undefined && (input.mode !== 'cash' || typeof input.cashAccountId !== 'string' || !input.cashAccountId || input.cashAccountId.includes('/'))) throw new HttpsError('invalid-argument', '급여 지급 계좌가 잘못되었습니다.');
  const { id, lines, totals } = checked(companyId, input);
  if (input.mode === 'cash' && totals.net <= 0) throw new HttpsError('invalid-argument', '실지급액이 0원입니다.');
  const date = input.mode === 'accrual' ? (() => {
    const [year, month] = input.yearMonth.split('-').map(Number);
    return `${input.yearMonth}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
  })() : input.payDate;
  const opId = operationId(companyId, input.yearMonth);
  const requestHash = hash({ mode: input.mode, yearMonth: input.yearMonth, payDate: input.payDate, lines,
    expectedRevision: input.expectedRevision, ...(input.cashAccountId !== undefined ? { cashAccountId: input.cashAccountId } : {}) });
  const payroll = db.collection('payrolls').doc(id);
  const cash = db.collection('cashEntries').doc(opId);
  const stmt = db.collection('issuedStatements').doc(opId);
  const counter = db.collection('appMeta').doc(voucherSequenceKey(companyId, date, '급여'));
  const cutover = db.collection('appMeta').doc(`payrollIssueCutover_${companyId}`);
  const releaseGate = releaseGateRef(db);
  return db.runTransaction(async tx => {
    const [paySnap, cashSnap, stmtSnap, counterSnap, cutoverSnap, accountsSnap, banksSnap, releaseSnap, ...employees] = await Promise.all([
      tx.get(payroll), tx.get(cash), tx.get(stmt), tx.get(counter), tx.get(cutover),
      tx.get(db.collection('accountCodes').where('companyId', '==', companyId)),
      tx.get(db.collection('cashAccounts').where('companyId', '==', companyId)),
      tx.get(releaseGate),
      ...lines.map(line => tx.get(db.collection('employees').doc(line.employeeId))),
    ]);
    assertReleaseActive(releaseSnap, input.releaseId);
    assertVoucherDateAllowed(releaseSnap, companyId, date);
    const existing = cashSnap.exists ? cashSnap : stmtSnap.exists ? stmtSnap : null;
    if (cashSnap.exists && stmtSnap.exists) throw new HttpsError('failed-precondition', '급여 전표가 중복 저장되었습니다.');
    if (existing) {
      const data = existing.data()!;
      if (data.payrollRequestHash !== requestHash || data.payrollId !== id || data.companyId !== companyId)
        throw new HttpsError('already-exists', '다른 급여 내용으로 이미 전표가 발행되었습니다.');
      const linked = paySnap.data();
      if (!linked || linked.issueOperationId !== opId || linked.cashEntryId !== opId
        || linked.issueKind !== (cashSnap.exists ? 'cashEntries' : 'issuedStatements')
        || linked.issueDocNo !== data.docNo
        || linked.issueVoucherHash !== hash(voucherContent(linked.issueKind, data))) {
        throw new HttpsError('failed-precondition', '급여대장과 원전표 연결을 확인해야 합니다.');
      }
      return { id: opId, docNo: data.docNo as string, kind: cashSnap.exists ? 'cashEntries' : 'issuedStatements' };
    }
    const old = paySnap.data();
    const gate = cutoverSnap.data();
    if (!gate || gate.companyId !== companyId || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(gate.firstYearMonth)
      || input.yearMonth < gate.firstYearMonth) {
      throw new HttpsError('failed-precondition', '급여 과거 발행 이력과 전환월을 먼저 확인해야 합니다.');
    }
    if (old?.cashEntryId || old?.issueOperationId || (old && old.payrollDraftVersion !== 1))
      throw new HttpsError('failed-precondition', '기존 급여 발행 이력을 먼저 확인해야 합니다.');
    if ((old?.revision ?? 0) !== input.expectedRevision) throw new HttpsError('aborted', '급여대장이 다른 화면에서 변경되었습니다.');
    employees.forEach((snap, i) => {
      const row = snap.data();
      if (!row || (row.companyId ?? 'taebaek') !== companyId || row.status !== 'working'
        || row.name !== lines[i].employeeName) throw new HttpsError('failed-precondition', '급여 대상 사원 정보가 바뀌었습니다.');
    });
    const accounts = accountsSnap.docs.map(snap => {
      const data = snap.data();
      return { id: snap.id, name: data.name as string, code: data.code as string };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const code = (name: string) => {
      const found = accounts.find(row => row.name === name && typeof row.code === 'string');
      if (!found) throw new HttpsError('failed-precondition', `${name} 계정과목이 없습니다.`);
      return found.code;
    };
    const salary = code('급여');
    const withhold = totals.deduct > 0 ? code('예수금') : '';
    const accrued = input.mode === 'accrual' && totals.net > 0 ? code('미지급비용') : '';
    const bank = input.mode === 'cash' ? banksSnap.docs.map(snap => {
      const data = snap.data();
      return { id: snap.id, active: data.active as boolean, type: data.type as string };
    }).filter(row => row.active && row.type === '통장').sort((a, b) => a.id.localeCompare(b.id)).find(row => input.cashAccountId === undefined || row.id === input.cashAccountId) : undefined;
    if (input.mode === 'cash' && !bank) throw new HttpsError('failed-precondition', '활성 급여 지급 계좌가 없습니다.');
    const state = await readVoucherCounter(db, tx, counterSnap, releaseSnap, companyId, date, '급여');
    if (!state || state.companyId !== companyId || state.tradeDate !== date || state.prefix !== '급여'
      || !Number.isSafeInteger(state.last) || state.last < 0) {
      throw new HttpsError('failed-precondition', '급여 전표 번호 카운터가 없거나 손상되었습니다.');
    }
    const next = state.last + 1;
    if (!Number.isSafeInteger(next)) throw new HttpsError('resource-exhausted', '급여 전표 번호 범위를 초과했습니다.');
    const docNo = formatVoucherNo(date, next, '급여');
    const now = new Date().toISOString();
    const payrollFingerprint = hash({ requestHash, salary, withhold, accrued, bankId: bank?.id ?? '' });
    const common = { id: opId, companyId, payrollId: id, payrollRequestHash: requestHash, payrollFingerprint, docNo,
      createdBy: '급여대장', createdAt: now };
    const kind = input.mode === 'cash' ? 'cashEntries' : 'issuedStatements';
    const voucher = input.mode === 'cash'
      ? { ...common, date, dir: '출금', amount: totals.net, cashAccountId: bank!.id,
        ...(totals.deduct > 0 ? { lines: [
          { accountCode: salary, amount: totals.gross, note: '총급여' },
          { accountCode: withhold, amount: totals.deduct, side: '대변', note: '원천공제' },
        ] } : { accountCode: salary }), note: `${input.yearMonth} 급여` }
      : { ...common, issuedAt: now, tradeDate: date, type: '비용',
        partnerId: '', partnerName: '급여', orderId: '',
        totalSupply: totals.gross, totalTax: 0, totalAmount: totals.gross,
        items: [
          { name: '총급여', spec: '', qty: 1, price: totals.gross, supply: totals.gross, tax: 0, total: totals.gross,
            isTaxExempt: true, accountCode: salary, side: '차변' },
          ...(totals.deduct > 0 ? [{ name: '예수금(원천공제)', spec: '', qty: 1, price: totals.deduct,
            supply: totals.deduct, tax: 0, total: totals.deduct, isTaxExempt: true, accountCode: withhold, side: '대변' }] : []),
          ...(totals.net > 0 ? [{ name: '미지급비용', spec: '', qty: 1, price: totals.net,
            supply: totals.net, tax: 0, total: totals.net, isTaxExempt: true, accountCode: accrued, side: '대변' }] : []),
        ] };
    tx.create(input.mode === 'cash' ? cash : stmt, voucher);
    const nextPayroll = { id, companyId, yearMonth: input.yearMonth, payDate: input.payDate, lines,
      payrollDraftVersion: 1, revision: input.expectedRevision + 1,
      cashEntryId: opId, issueOperationId: opId,
      issueKind: kind, issueDocNo: docNo, issueVoucherHash: hash(voucherContent(kind, voucher)),
      issueExpectedRevision: input.expectedRevision, ...(input.cashAccountId !== undefined ? { issueCashAccountId: input.cashAccountId } : {}), createdAt: old?.createdAt ?? now, updatedAt: now };
    if (paySnap.exists) tx.update(payroll, nextPayroll); else tx.create(payroll, nextPayroll);
    writeVoucherCounter(tx, counterSnap, state, next);
    return { id: opId, docNo, kind: nextPayroll.issueKind };
  });
}

export const savePayrollDraftCommand = onCall({ region: REGION }, async request => {
  const companyId = request.auth?.token.companyId;
  if (!request.auth || !request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  return savePayrollDraft(admin.firestore(), companyId, request.data as DraftInput);
});

export const issuePayrollVoucherCommand = onCall({ region: REGION }, async request => {
  const companyId = request.auth?.token.companyId;
  if (!request.auth || !request.auth.token.isAdmin || (companyId !== 'taebaek' && companyId !== 'punghoe'))
    throw new HttpsError('permission-denied', '관리자 회사 권한이 필요합니다.');
  return issuePayrollVoucher(admin.firestore(), companyId, request.data as Input);
});
