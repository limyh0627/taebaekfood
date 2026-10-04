import type { CashAccount, IssuedStatement } from './types';
import { BANK, journalizeTransfer } from './autoJournal';
import { STANDARD_ACCOUNT } from './accountChart';

export const openingCashAccountCode = (account: Pick<CashAccount, 'type'>): string =>
  account.type === '현금' ? STANDARD_ACCOUNT.CASH : BANK;

export function cashOpeningStatement(account: CashAccount): IssuedStatement {
  if (!account.id || !account.companyId || !/^\d{4}-\d{2}-\d{2}$/.test(account.openingDate) ||
      !Number.isInteger(account.openingBalance) || account.openingBalance <= 0 || account.type === '카드') {
    throw new Error('현금·통장 기초일과 0원 초과 정수 잔액을 확인하세요.');
  }
  const amount = account.openingBalance;
  const line = (accountCode: string, side: '차변' | '대변', name: string) => ({
    name, spec: '', qty: 1, price: amount, supply: amount, tax: 0, total: amount,
    isTaxExempt: true, accountCode, side, lineKind: 'account' as const,
  });
  const voucher: IssuedStatement = {
    id: `opening-cash-${account.companyId}-${account.id}`, companyId: account.companyId,
    issuedAt: `${account.openingDate}T00:00:00+09:00`, tradeDate: account.openingDate,
    type: '비용', partnerId: '', partnerName: '', orderId: '',
    docNo: `기초계좌-${account.id}`, totalSupply: amount, totalTax: 0, totalAmount: amount,
    items: [line(openingCashAccountCode(account), '차변', account.name), line('375', '대변', '기초 이월이익잉여금')],
  };
  if (!journalizeTransfer(voucher)) throw new Error('계좌 기초 전표 차변·대변이 일치하지 않습니다.');
  return voucher;
}
