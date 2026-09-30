import type { CashEntry, IssuedStatement, JournalEntry } from '../../../types';
import { AR } from '../../shared/autoJournal';
import { partnerBalanceFromJournals, partnerCarryOver, partnerCashParts } from './cashLedger';

export interface PartnerMonthlyRow {
  partnerId: string;
  opening: number;
  sales: number;
  cashReceived: number;
  cashRefunded: number;
  nonCashDecrease: number;
  receivableIncrease: number;
  closing: number;
  discrepancy: number;
}

export function partnerMonthlySettlement(
  month: string,
  statements: IssuedStatement[],
  cashEntries: CashEntry[],
  journals: JournalEntry[],
): PartnerMonthlyRow[] {
  const periodStart = `${month}-01`;
  const [year, m] = month.split('-').map(Number);
  const periodEnd = `${year + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const openingIds = new Set(statements.filter(s => String(s.docNo ?? '').includes('기초')).map(s => s.id));
  const openingIdsToDate = new Set(statements.filter(s => openingIds.has(s.id) && s.tradeDate < periodEnd).map(s => s.id));
  const cashMovementIds = new Set(cashEntries.filter(e => e.dir !== '대체').map(e => e.id));
  const ids = new Set([
    ...statements.map(s => s.partnerId),
    ...cashEntries.map(e => e.partnerId),
    ...journals.flatMap(e => e.lines.map(l => l.partnerId)),
  ].filter((id): id is string => !!id));

  return [...ids].map(partnerId => {
    const opening = partnerCarryOver(partnerId, '매출', journals, periodStart, openingIdsToDate);
    const sales = statements.filter(s => s.partnerId === partnerId && s.type === '매출'
      && s.tradeDate.startsWith(month) && !openingIds.has(s.id))
      .reduce((sum, s) => sum + s.totalAmount, 0);
    const cashReceived = cashEntries.filter(e => e.partnerId === partnerId && (e.date ?? '').startsWith(month)
      && e.dir === '입금')
      .reduce((sum, e) => sum + partnerCashParts(e)
        .filter(p => p.code === AR).reduce((amount, p) => amount + p.reduce, 0), 0);
    const cashRefunded = cashEntries.filter(e => e.partnerId === partnerId && (e.date ?? '').startsWith(month)
      && e.dir === '출금')
      .reduce((sum, e) => sum - partnerCashParts(e)
        .filter(p => p.code === AR).reduce((amount, p) => amount + p.reduce, 0), 0);
    const nonCashDecrease = journals.filter(e => e.date >= periodStart && e.date < periodEnd
      && !openingIds.has(String(e.sourceId ?? '')) && e.sourceType !== '매출'
      && !cashMovementIds.has(String(e.sourceId ?? '')))
      .reduce((sum, e) => sum + e.lines.filter(l => String(l.accountCode) === AR && l.partnerId === partnerId)
        .reduce((amount, l) => amount + (l.credit ?? 0) - (l.debit ?? 0), 0), 0);
    const closing = partnerBalanceFromJournals(partnerId, '매출', journals.filter(e => e.date < periodEnd));
    const receivableIncrease = sales - cashReceived + cashRefunded - nonCashDecrease;
    const discrepancy = opening + receivableIncrease - closing;
    return { partnerId, opening, sales, cashReceived, cashRefunded, nonCashDecrease, receivableIncrease, closing, discrepancy };
  }).filter(r => r.opening || r.sales || r.cashReceived || r.cashRefunded || r.nonCashDecrease || r.closing || r.discrepancy);
}
