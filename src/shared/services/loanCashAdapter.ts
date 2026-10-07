import type { CashEntry } from '../types';
import { companyOf } from '../types';
import { STANDARD_ACCOUNT } from '../accountChart';
import type { LoanMovementInput } from './recordLoanMovement';

/** 기존 LoanManager/대출 양식의 현금입력만 전용 명령 입력으로 변환한다. */
export function loanCashInput(companyId: string, entry: CashEntry,
  contract: { id: string; companyId?: string; accountCode: string }): LoanMovementInput {
  if (companyOf(entry) !== companyId || (contract.companyId ?? 'taebaek') !== companyId
    || !entry.loanId || contract.id !== entry.loanId || !['260', '293'].includes(contract.accountCode)
    || !['입금', '출금'].includes(entry.dir) || !entry.cashAccountId
    || !Number.isSafeInteger(entry.amount) || entry.amount <= 0) throw new Error('대출·회사·통장·금액을 확인하세요.');
  const lines: NonNullable<CashEntry['lines']> = entry.lines?.length ? entry.lines : [{ accountCode: entry.accountCode ?? '', amount: entry.amount }];
  let principal = 0, interest = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.amount) || line.amount < 0 || line.side !== undefined)
      throw new Error('대출 금액 줄의 방향·금액을 확인하세요.');
    if (line.accountCode === contract.accountCode) principal += line.amount;
    else if (entry.dir === '출금' && line.accountCode === STANDARD_ACCOUNT.INTEREST) interest += line.amount;
    else throw new Error('대출 계약 원금계정과 이자계정이 맞지 않습니다.');
  }
  if (!Number.isSafeInteger(principal) || !Number.isSafeInteger(interest) || principal + interest !== entry.amount
    || entry.dir === '입금' && principal <= 0) throw new Error('대출 원금·이자 합계가 맞지 않습니다.');
  return { loanId: entry.loanId, tradeDate: entry.date, cashAccountId: entry.cashAccountId,
    action: entry.dir === '입금' ? '차입' : '상환', principal, interest, note: entry.note?.trim() ?? '' };
}
