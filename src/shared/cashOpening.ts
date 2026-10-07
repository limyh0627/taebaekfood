import { isCalendarDay, today } from './day';
import { companyOf, type CashAccount, type CashEntry, type IssuedStatement } from './types';
import { totalCashOnHand } from '../features/admin/cashLedger';
import { BANK, journalizeTransfer } from './autoJournal';
import { STANDARD_ACCOUNT } from './accountChart';

export const openingCashAccountCode = (account: Pick<CashAccount, 'type'>): string =>
  account.type === '현금' ? STANDARD_ACCOUNT.CASH : BANK;

/** 입력한 현재 잔액에서 새 기준일 이후 실제 입출금을 빼서 기초 잔액을 구한다. */
export function cashOpeningBalanceForCurrent(account: CashAccount, entries: CashEntry[], newDate: string, currentBalance: number, asOf = today()): number {
  if (!isCalendarDay(newDate) || !isCalendarDay(asOf) || !Number.isSafeInteger(currentBalance)) throw new Error('계좌 기준일과 정수 잔액을 확인하세요.');
  const mine = entries.filter(entry => companyOf(entry) === companyOf(account));
  if (mine.some(entry => entry.cashAccountId === account.id && entry.date >= newDate && entry.date <= asOf && !Number.isSafeInteger(entry.amount))) throw new Error('계좌 연결 전표의 금액을 확인하세요.');
  const movement = totalCashOnHand([{ ...account, openingDate: newDate, openingBalance: 0 }], mine, asOf);
  const opening = currentBalance - movement;
  if (!Number.isSafeInteger(opening)) throw new Error('계좌 기초 잔액이 계산 범위를 벗어났습니다.');
  return opening;
}

export function cashOpeningStatement(account: CashAccount): IssuedStatement {
  if (!account.id || !account.companyId || !isCalendarDay(account.openingDate) ||
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
