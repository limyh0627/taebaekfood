import type { CashEntry, CompanyId } from './types';
import { companyOf } from './types';
import { journalizeCashEntry } from './autoJournal';

/** 대출 계약별 보조원장. 시작 잔액은 회계 분개가 아니라 조회 기준점이다. */
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
