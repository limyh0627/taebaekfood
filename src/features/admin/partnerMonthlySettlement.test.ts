import { describe, expect, it } from 'vitest';
import type { CashEntry, IssuedStatement, JournalEntry } from '../../shared/types';
import { partnerMonthlySettlement } from './partnerMonthlySettlement';
import { settlementPages, type NamedSettlementRow } from './partnerMonthlyPdf';

const stmt = (id: string, partnerId: string, date: string, amount: number, docNo = '') =>
  ({ id, partnerId, tradeDate: date, totalAmount: amount, type: '매출', docNo } as IssuedStatement);
const cash = (id: string, partnerId: string, date: string, amount: number, dir: CashEntry['dir']) =>
  ({ id, partnerId, date, amount, dir, accountCode: '108', lines: [] } as unknown as CashEntry);
const journal = (id: string, partnerId: string, date: string, change: number, sourceType: JournalEntry['sourceType']) =>
  ({ id, sourceId: id, date, sourceType, lines: [{ partnerId, accountCode: '108', debit: Math.max(change, 0), credit: Math.max(-change, 0) }] } as JournalEntry);

describe('거래처별 월간 정산', () => {
  it('과거월 기초 이월, 매출, 현금 입금, 상계를 나눠 기말과 대조한다', () => {
    const statements = [
      stmt('opening', 'a', '2026-07-31', 100, '기초'),
      stmt('sale-aug', 'a', '2026-08-12', 50),
      stmt('sale-sep', 'a', '2026-09-03', 80),
      stmt('sale-b', 'b', '2026-09-04', 40),
      stmt('sale-oct', 'a', '2026-10-01', 999),
      stmt('opening-oct', 'a', '2026-10-31', 500, '기초'),
    ];
    const cashEntries = [cash('paid-aug', 'a', '2026-08-20', 20, '입금'),
      cash('paid-sep', 'a', '2026-09-07', 30, '입금'),
      cash('offset', 'a', '2026-09-08', 10, '대체'),
      cash('refund', 'a', '2026-09-09', 5, '출금')];
    const journals = [
      journal('opening', 'a', '2026-07-31', 100, '매출'),
      journal('sale-aug', 'a', '2026-08-12', 50, '매출'),
      journal('paid-aug', 'a', '2026-08-20', -20, '자금'),
      journal('sale-sep', 'a', '2026-09-03', 80, '매출'),
      journal('sale-b', 'b', '2026-09-04', 40, '매출'),
      journal('paid-sep', 'a', '2026-09-07', -30, '자금'),
      journal('offset', 'a', '2026-09-08', -10, '자금'),
      journal('refund', 'a', '2026-09-09', 5, '자금'),
      journal('sale-oct', 'a', '2026-10-01', 999, '매출'),
      journal('opening-oct', 'a', '2026-10-31', 500, '매출'),
    ];
    const rows = partnerMonthlySettlement('2026-09', statements, cashEntries, journals);
    expect(rows.find(r => r.partnerId === 'a')).toEqual({ partnerId: 'a', opening: 130,
      sales: 80, cashReceived: 30, cashRefunded: 5, nonCashDecrease: 10, receivableIncrease: 45,
      closing: 175, discrepancy: 0 });
    expect(rows.find(r => r.partnerId === 'b')).toEqual({ partnerId: 'b', opening: 0,
      sales: 40, cashReceived: 0, cashRefunded: 0, nonCashDecrease: 0, receivableIncrease: 40,
      closing: 40, discrepancy: 0 });
    expect(rows.reduce((sum, row) => sum + row.closing, 0)).toBe(215);
  });

  it('기초 전표가 선택 월에 있어도 기간매출에서 빠진다', () => {
    const rows = partnerMonthlySettlement('2026-07', [stmt('opening', 'a', '2026-07-31', 100, '기초')], [],
      [journal('opening', 'a', '2026-07-31', 100, '매출')]);
    expect(rows[0]).toMatchObject({ opening: 100, sales: 0, closing: 100, discrepancy: 0 });
  });

  it('조회월 뒤의 개시잔액은 과거월 이월에 넣지 않는다', () => {
    const opening = stmt('opening-later', 'a', '2026-10-31', 500, '기초');
    expect(partnerMonthlySettlement('2026-09', [opening], [],
      [journal('opening-later', 'a', '2026-10-31', 500, '매출')])).toEqual([]);
  });

  it('17행을 넘기면 다음 페이지로 나누고 빈 달에도 한 페이지를 만든다', () => {
    const row = { partnerId: 'a', name: '한글 거래처', opening: 0, sales: 0, cashReceived: 0, cashRefunded: 0,
      nonCashDecrease: 0, receivableIncrease: 0, closing: 0, discrepancy: 0 } satisfies NamedSettlementRow;
    expect(settlementPages(Array(18).fill(row)).map(page => page.length)).toEqual([17, 1]);
    expect(settlementPages([])).toEqual([[]]);
  });
});
