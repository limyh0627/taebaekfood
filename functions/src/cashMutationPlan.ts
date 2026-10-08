import type { Claim, PaymentCash } from './partnerPaymentPlan';
import { loanPrincipalBalance, LOAN_INTEREST_ACCOUNT, type LoanCash, type LoanSnapshot } from './loanMovementPlan';
/** Full cash edit normalization. The command supplies fresh company-owned originals. */
export type CashRow = Record<string, any>;
export type CashPatch = { amount?: number; date?: string; dir?: '입금' | '출금' | '대체';
  accountCode?: string; lines?: { accountCode: string; amount: number; side?: '차변' | '대변'; note?: string }[];
  note?: string; partnerId?: string; partnerName?: string };
const fields = new Set(['amount', 'date', 'dir', 'accountCode', 'lines', 'note', 'partnerId', 'partnerName']);
function fail(message: string): never { throw new Error(message); }
const integer = (n: unknown): n is number => Number.isSafeInteger(n);
export function validCashDate(date: unknown): date is string {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}
export function planCashEdit(current: CashRow, patch: CashPatch, codes: readonly string[],
  partner: CashRow | undefined, companyId: string): CashRow {
  if (!patch || Array.isArray(patch) || Object.keys(patch).some(key => !fields.has(key))) fail('수정할 수 없는 자금전표 필드입니다.');
  const next: CashRow = { ...current, ...patch };
  if ((current.companyId ?? 'taebaek') !== companyId || !validCashDate(next.date)
    || !integer(next.amount) || next.amount <= 0 || !['입금', '출금', '대체'].includes(next.dir)) fail('자금전표 회사·날짜·금액·방향이 잘못되었습니다.');
  if (current.dir === '대체' && next.dir !== '대체') fail('대체전표의 방향은 바꿀 수 없습니다.');
  if (next.note !== undefined && (typeof next.note !== 'string' || next.note.length > 500)) fail('메모가 잘못되었습니다.');
  if (patch.partnerName !== undefined && !Object.prototype.hasOwnProperty.call(patch, 'partnerId')) fail('거래처 이름만 바꿀 수 없습니다.');
  if (Object.prototype.hasOwnProperty.call(patch, 'partnerId')) {
    if (typeof patch.partnerId !== 'string') fail('거래처 입력이 잘못되었습니다.');
    if (patch.partnerId && (!partner || partner.id !== patch.partnerId || (partner.companyId ?? 'taebaek') !== companyId)) fail('현재 회사 거래처가 아닙니다.');
    next.partnerName = patch.partnerId ? partner!.name : '';
  }
  if (next.lines !== undefined && (!Array.isArray(next.lines) || next.lines.length > 100)) fail('분개 줄이 잘못되었습니다.');
  const lines = next.lines?.length ? next.lines : next.accountCode ? [{ accountCode: next.accountCode, amount: next.amount }] : [];
  let sum = 0, debit = 0, credit = 0;
  for (const line of lines) {
    if (!line || Object.keys(line).some(key => !['accountCode', 'amount', 'note', 'side'].includes(key))
      || typeof line.accountCode !== 'string' || !codes.includes(line.accountCode)
      || !integer(line.amount) || line.amount === 0
      || (line.side !== undefined && !['차변', '대변'].includes(line.side))
      || (line.note !== undefined && (typeof line.note !== 'string' || line.note.length > 500))) fail('회사 계정·분개 줄 금액을 확인해주세요.');
    const signed = line.side ? (line.side === (next.dir === '입금' ? '대변' : '차변') ? 1 : -1) * Math.abs(line.amount) : line.amount;
    sum += signed;
    if (signed > 0) debit += signed; else credit -= signed;
  }
  if (![sum, debit, credit].every(integer) || (lines.length && (next.dir === '대체' ? sum !== 0 || debit !== next.amount : sum !== next.amount))) fail('분개 줄과 자금전표 금액이 맞지 않습니다.');
  if (next.balanceAdjustment) {
    const meta = next.balanceAdjustment;
    if (lines.length || next.partnerId || next.loanId || next.linkedAccrualStatementId
      || ![meta.before, meta.target, meta.delta].every(integer) || meta.delta === 0
      || typeof meta.reason !== 'string' || !meta.reason.trim()
      || meta.target - meta.before !== meta.delta || Math.abs(meta.delta) !== next.amount
      || next.dir !== (meta.delta > 0 ? '입금' : '출금') || next.date !== current.date) fail('잔액 조정의 원래 금액·날짜·의미를 확인해주세요.');
  }
  return next;
}
export function planCashSettlements(current: CashRow, next: CashRow | null,
  settlements: CashRow[], statements: CashRow[], companyId: string): CashRow[] {
  if (settlements.some(row => (row.companyId ?? 'taebaek') !== companyId || !integer(row.amount) || row.amount <= 0)) fail('정산의 회사·금액이 잘못되었습니다.');
  if (!next) return [];
  const delta = next.amount - current.amount;
  const partnerChanged = (next.partnerId ?? '') !== (current.partnerId ?? '');
  if (settlements.length && partnerChanged && delta !== 0) fail('연결된 자금의 거래처와 금액을 동시에 바꿀 수 없습니다.');
  if (delta !== 0 && settlements.length > 1) fail('여러 전표에 배분된 자금은 삭제 후 다시 입력해주세요.');
  return settlements.map(row => {
    const statement = statements.find(statement => statement.id === row.statementId);
    if (!statement || (statement.companyId ?? 'taebaek') !== companyId || statement.partnerId !== next.partnerId) fail('연결 전표의 회사·거래처가 맞지 않습니다.');
    const amount = row.amount + delta;
    if (!integer(amount) || amount <= 0) fail('상계액보다 많이 줄일 수 없습니다.');
    return { ...row, amount };
  });
}

/** Recomputes the entire dated principal history rather than applying a guessed delta. */
export function planLoanCashMutation(loan: LoanSnapshot, entries: LoanCash[], cashId: string, next: CashRow | null,
  storedBalance?: number) {
  const before = loanPrincipalBalance(loan, entries);
  if (storedBalance !== undefined && storedBalance !== before) fail('대출 계약 잔액과 원장이 다릅니다.');
  if (next) {
    if (next.loanId !== loan.id || next.date < loan.openingDate || !['입금', '출금'].includes(next.dir)) fail('대출 원본·시작일·방향을 확인해주세요.');
    const lines = next.lines?.length ? next.lines : next.accountCode ? [{ accountCode: next.accountCode, amount: next.amount }] : [];
    if (!lines.length || lines.some((line: CashRow) => ![loan.accountCode, LOAN_INTEREST_ACCOUNT].includes(line.accountCode)
      || line.amount <= 0 || line.side !== undefined && line.side !== (next.dir === '입금' ? '대변' : '차변')
      || next.dir === '입금' && line.accountCode !== loan.accountCode)) fail('대출 원금·이자 분리를 확인해주세요.');
  }
  const movements = entries.filter(entry => entry.id !== cashId);
  if (next) movements.push({ ...next, id: cashId } as LoanCash);
  return { balanceBefore: before, balanceAfter: loanPrincipalBalance(loan, movements) };
}

export function validateCashSettlementLimits(claims: Claim[], cashEntries: PaymentCash[], settlements: CashRow[], partner: string) {
  const usedClaims = new Map<string, number>(), usedCash = new Map<string, number>();
  for (const row of settlements) {
    const claim = claims.find(claim => claim.id === row.statementId);
    const cash = cashEntries.find(cash => cash.id === row.cashEntryId);
    if (claim?.partnerId !== partner && cash?.partnerId !== partner) continue;
    if (!claim || !cash || claim.partnerId !== partner || cash.partnerId !== partner || !integer(row.amount) || row.amount <= 0) fail('정산 원본 연결이 불명확합니다.');
    const limit = cash.parts.filter(part => part.accountCode === claim.accountCode).reduce((sum, part) => sum + part.reduce, 0);
    const claimTotal = (usedClaims.get(claim.id) ?? 0) + row.amount;
    const key = `${cash.id}:${claim.accountCode}`, cashTotal = (usedCash.get(key) ?? 0) + row.amount;
    if (!integer(claimTotal) || claimTotal > claim.amount || !integer(cashTotal) || cashTotal > limit) fail('전표 잔액 또는 자금 한도를 넘습니다.');
    usedClaims.set(claim.id, claimTotal); usedCash.set(key, cashTotal);
  }
}
