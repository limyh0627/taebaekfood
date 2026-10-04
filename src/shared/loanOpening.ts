import type { CompanyId, IssuedStatement } from './types';
import type { LoanContract } from './loanLedger';
import { journalizeTransfer } from './autoJournal';

export function loanOpeningStatement(loan: LoanContract): IssuedStatement {
  if (!loan.id || !loan.companyId || !/^\d{4}-\d{2}-\d{2}$/.test(loan.openingDate) ||
      !Number.isInteger(loan.openingPrincipal) || loan.openingPrincipal <= 0 ||
      (loan.accountCode !== '260' && loan.accountCode !== '293')) {
    throw new Error('대출 기초일·계정·0원 초과 정수 원금을 확인하세요.');
  }
  const amount = loan.openingPrincipal;
  const line = (accountCode: string, side: '차변' | '대변', name: string) => ({
    name, spec: '', qty: 1, price: amount, supply: amount, tax: 0, total: amount,
    isTaxExempt: true, accountCode, side, lineKind: 'account' as const,
  });
  const voucher: IssuedStatement = {
    id: `opening-loan-${loan.companyId}-${loan.id}`, companyId: loan.companyId as CompanyId,
    issuedAt: `${loan.openingDate}T00:00:00+09:00`, tradeDate: loan.openingDate,
    type: '비용', partnerId: loan.partnerId ?? '', partnerName: loan.lenderName,
    orderId: '', docNo: `기초대출-${loan.id}`,
    totalSupply: amount, totalTax: 0, totalAmount: amount,
    items: [line('375', '차변', '기초 이월이익잉여금'), line(loan.accountCode, '대변', loan.name)],
  };
  if (!journalizeTransfer(voucher)) throw new Error('대출 기초 전표 차변·대변이 일치하지 않습니다.');
  return voucher;
}
