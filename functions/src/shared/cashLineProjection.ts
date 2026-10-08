export type CashProjectionInput = { dir: string; amount?: number; accountCode?: string; note?: string;
  lines?: { accountCode?: string; amount: number; side?: '차변' | '대변'; note?: string }[] };
export class CashLineProjectionError extends Error {}
/** 기본값은 앱의 기존 소수 둘째 자리 반올림·빈 줄 fallback이다. strict는 서버 입력 검증이다. */
export function projectCashLines(entry: CashProjectionInput, strict = false) {
  const round = (n: number) => strict ? n : Math.round((n ?? 0) * 100) / 100;
  const positiveSide = entry.dir === '입금' ? '대변' : '차변';
  const signed = (line: NonNullable<CashProjectionInput['lines']>[number]) =>
    line.side ? (line.side === positiveSide ? 1 : -1) * Math.abs(round(line.amount)) : round(line.amount);
  if (strict && (!['입금', '출금', '대체'].includes(entry.dir) || !Number.isSafeInteger(entry.amount) || entry.amount! <= 0
    || (entry.lines ?? []).some(line => typeof line.accountCode !== 'string' || !line.accountCode
      || !Number.isSafeInteger(line.amount) || (line.side !== undefined && !['차변', '대변'].includes(line.side)))))
    throw new CashLineProjectionError('기존 자금전표 줄 금액이 잘못되었습니다.');
  const split = (entry.lines ?? []).filter(line => line.accountCode && signed(line) !== 0);
  const parts = split.length ? split.map(line => ({ accountCode: line.accountCode!, amount: signed(line), note: line.note }))
    : entry.accountCode ? [{ accountCode: entry.accountCode, amount: round(entry.amount ?? 0), note: entry.note }] : [];
  const total = round(parts.reduce((sum, part) => sum + part.amount, 0));
  if (strict) {
    const debit = parts.reduce((sum, part) => sum + Math.max(part.amount, 0), 0);
    const credit = parts.reduce((sum, part) => sum + Math.max(-part.amount, 0), 0);
    if (!parts.length || !Number.isSafeInteger(total) || !Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)
      || (entry.dir === '대체' ? debit <= 0 || debit !== credit : total !== entry.amount))
      throw new CashLineProjectionError('자금전표 줄 순액이 원본 금액과 맞지 않습니다.');
  }
  return { parts, total };
}

/** 줄의 실제 차대에서 채권/채무가 감소한 몫을 계산한다. */
export function cashLineReduction(dir: string, accountCode: string, signedAmount: number): number {
  const debitSigned = dir === '입금' ? -signedAmount : signedAmount;
  return accountCode === '108' ? -debitSigned : debitSigned;
}
