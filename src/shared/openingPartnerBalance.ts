import type { CompanyId, IssuedStatement, Partner } from './types';
import { journalizeTransfer } from './autoJournal';

export type OpeningPartnerCode = '108' | '251';

/** One opening receivable/payable is one balanced, partner-linked transfer voucher. */
export function openingPartnerStatement(companyId: CompanyId, date: string, partner: Partner, code: OpeningPartnerCode, amount: number): IssuedStatement {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(amount) || amount <= 0 || !partner.id || !partner.name) {
    throw new Error('기초일·거래처·0원 초과 정수 금액을 확인하세요.');
  }
  if (partner.companyId && partner.companyId !== companyId) throw new Error('다른 회사 거래처입니다.');
  const receivable = code === '108';
  const id = `opening-partner-${companyId}-${date}-${partner.id}-${code}`;
  const line = (accountCode: string, side: '차변' | '대변', name: string) => ({
    name, spec: '', qty: 1, price: amount, supply: amount, tax: 0, total: amount,
    isTaxExempt: true, accountCode, side, lineKind: 'account' as const,
  });
  const voucher: IssuedStatement = {
    id, companyId, issuedAt: `${date}T00:00:00+09:00`, tradeDate: date, type: '비용',
    partnerId: partner.id, partnerName: partner.name, orderId: '', docNo: `기초-${date.replaceAll('-', '')}-${partner.id}-${code}`,
    totalSupply: amount, totalTax: 0, totalAmount: amount,
    items: receivable
      ? [line('108', '차변', '기초 미수금(이월)'), line('375', '대변', '기초 이월이익잉여금')]
      : [line('375', '차변', '기초 이월이익잉여금'), line('251', '대변', '기초 미지급금(이월)')],
  };
  if (!journalizeTransfer(voucher)) throw new Error('기초 전표 차변·대변이 일치하지 않습니다.');
  return voucher;
}
