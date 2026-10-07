import type { CashEntry, CompanyId } from './types';
import { companyOf } from './types';
import { journalizeCashEntry } from './autoJournal';
import { isCalendarDay } from './day';

/** 대출 계약별 보조원장. 새 기초원금 등록은 별도 기초 대체전표와 원자적으로 저장한다. */
export interface LoanContract {
  id: string;
  companyId: CompanyId;
  name: string;
  lenderName: string;
  partnerId?: string;
  accountCode: '260' | '293';
  openingDate: string;
  openingPrincipal: number;
  maturityDate?: string;
  note?: string;
  createdAt: string;
}

export interface LoanMovement {
  entry: CashEntry;
  /** 양수=차입 증가, 음수=원금상환. 이자 줄은 포함되지 않는다. */
  principalDelta: number;
}

export function loanMovements(loan: LoanContract, entries: CashEntry[]): LoanMovement[] {
  return entries
    .filter(e => e.loanId === loan.id && companyOf(e) === loan.companyId && e.date >= loan.openingDate)
    .map(entry => {
      // 자금전표와 똑같은 분개를 읽는다. 원금·이자 쪼개기를 여기서 다시 구현하면 셈이 갈린다.
      const journal = journalizeCashEntry(entry);
      const principalDelta = journal?.lines
        .filter(line => line.accountCode === loan.accountCode)
        .reduce((sum, line) => sum + line.credit - line.debit, 0) ?? 0;
      return { entry, principalDelta };
    })
    .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.createdAt.localeCompare(b.entry.createdAt));
}

export function loanBalance(loan: LoanContract, entries: CashEntry[]): number {
  return loanMovements(loan, entries).reduce((sum, row) => sum + row.principalDelta, loan.openingPrincipal);
}

/** 시작일을 바꿔도 사용자가 지정한 현재 원금 잔액이 되도록 시작 원금을 역산한다. */
export function loanOpeningPrincipalForBalance(loan: LoanContract, entries: CashEntry[], openingDate: string, currentBalance: number): number {
  if (!isCalendarDay(openingDate) || !Number.isSafeInteger(currentBalance) || currentBalance < 0) {
    throw new Error('시작일과 0원 이상의 정수 잔액을 확인하세요.');
  }
  const delta = loanMovements({ ...loan, openingDate }, entries).reduce((sum, row) => sum + row.principalDelta, 0);
  const principal = currentBalance - delta;
  if (!Number.isSafeInteger(principal) || principal < 0) {
    throw new Error('해당 시작일의 원금이 음수가 됩니다. 시작일과 현재 잔액을 확인하세요.');
  }
  return principal;
}

/** 거래처 이름만으로 계약을 추정하지 않고 회사·원금 계정을 함께 확인한다. */
export function matchingLoan(loans: LoanContract[], companyId: CompanyId, loanId: string, accountCode: string): LoanContract | undefined {
  return loans.find(loan => loan.id === loanId && loan.companyId === companyId && loan.accountCode === accountCode);
}
export const LINKED_LOAN_AUTO_NOTICE = '대출 계약에 연결된 상환 템플릿은 수동 발행만 가능합니다. 자동 발행을 꺼 주세요.';
