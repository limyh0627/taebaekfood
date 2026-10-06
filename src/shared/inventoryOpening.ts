import { isCalendarDay } from './day';
import type { CompanyId, IssuedStatement, Item } from './types';
import { INVENTORY, journalizeTransfer } from './autoJournal';

/** 한 품목의 기초 수량과 평가액을 회계 장부에서도 찾을 수 있는 대체전표로 남긴다. */
export function inventoryOpeningStatement(companyId: CompanyId, date: string, item: Item, quantity: number, value: number): IssuedStatement {
  if (!item.id || !item.name?.trim() || !isCalendarDay(date) ||
      !Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(value) || value <= 0) {
    throw new Error('기초 재고의 품목·날짜·수량·평가금액을 확인하세요.');
  }
  const line = (accountCode: string, side: '차변' | '대변', name: string) => ({
    name, spec: item.spec ?? '', qty: 1, price: value, supply: value, tax: 0, total: value,
    isTaxExempt: true, accountCode, side, lineKind: 'account' as const,
  });
  const voucher: IssuedStatement = {
    id: `opening-inventory-${companyId}-${item.id}`, companyId,
    openingItemId: item.id, openingQuantity: quantity,
    issuedAt: `${date}T00:00:00+09:00`, tradeDate: date, type: '비용',
    partnerId: '', partnerName: '', orderId: '', docNo: `기초재고-${item.id}`,
    totalSupply: value, totalTax: 0, totalAmount: value,
    memo: `${item.name} ${quantity}${item.unit || ''} 기초 재고`,
    items: [line(INVENTORY, '차변', item.name), line('375', '대변', '기초 이월이익잉여금')],
  };
  if (!journalizeTransfer(voucher)) throw new Error('기초 재고 전표 차변·대변이 일치하지 않습니다.');
  return voucher;
}
