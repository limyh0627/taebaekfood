import { useEffect, useMemo } from 'react';
import type { AccountCode, CashEntry, IssuedStatement, JournalEntry } from '../../../../types';
import { plOfJournals } from '../../admin/financials';
import { buildTimeline } from '../../../shared/timelineBuild';
import {
  filterTimeline, partnerNamesOf, rowKind, sortTimeline, timelineTotals,
  type TimelineRow,
} from '../../../shared/timelineRows';
import { sortByColumns, type TimelineSort, type TimelineSortColumn } from '../../../shared/timelineColumnSort';
import type { VoucherKind } from '../../../shared/vouchers';
import { matchesSearch } from '../../../shared/hangul';

const PAGE_SIZE = 50;

interface Input {
  statements: IssuedStatement[];
  cashEntries: CashEntry[];
  arapOf: (statement: IssuedStatement) => { side: '채권' | '채무' | null; delta: number };
  from: string;
  to: string;
  kind: '전체' | VoucherKind;
  account: string;
  partner: string;
  search: string;
  matchAccount: (codes: string[]) => boolean;
  codeName: ReadonlyMap<string, string>;
  sort: TimelineSort[];
  sortText: (row: TimelineRow, column: TimelineSortColumn) => string | undefined;
  balanceSign: (row: TimelineRow) => 1 | -1;
  page: number;
  setPage: (page: number) => void;
  partnerQuery: string;
  journalBySource: ReadonlyMap<string, JournalEntry>;
  accountCodes: AccountCode[];
  codeType: ReadonlyMap<string, AccountCode['type']>;
  partnerBalances: ReadonlyMap<string, { receivable: number; payable: number }>;
}

/** 전표·수금·자금 행을 하나의 조회 목록으로 만들고 필터·정렬·합계를 계산한다. */
export function useStatementTimeline(input: Input) {
  const allRows = useMemo(
    () => buildTimeline({ statements: input.statements, cashEntries: input.cashEntries, arapOf: input.arapOf }),
    [input.statements, input.cashEntries, input.arapOf],
  );

  const filteredRows = useMemo(() => sortTimeline(filterTimeline(allRows, {
    from: input.from, to: input.to, kind: input.kind, partner: input.partner, search: input.search,
  }, {
    matchAccount: input.account ? input.matchAccount : undefined,
    codeName: input.codeName,
  })), [allRows, input.from, input.to, input.kind, input.partner, input.search, input.account, input.matchAccount, input.codeName]);

  const kindCounts = useMemo(() => {
    const rows = filterTimeline(allRows, {
      from: input.from, to: input.to, kind: '전체', partner: input.partner, search: input.search,
    }, {
      matchAccount: input.account ? input.matchAccount : undefined,
      codeName: input.codeName,
    });
    const counts = new Map<string, number>([['전체', rows.length]]);
    for (const row of rows) counts.set(rowKind(row), (counts.get(rowKind(row)) ?? 0) + 1);
    return counts;
  }, [allRows, input.from, input.to, input.partner, input.search, input.account, input.matchAccount, input.codeName]);

  useEffect(() => { input.setPage(1); }, [input.from, input.to, input.kind, input.account, input.partner, input.search]);

  const partnerNames = useMemo(() => partnerNamesOf(allRows), [allRows]);
  const shownPartnerNames = useMemo(() => {
    const query = input.partnerQuery.trim().toLowerCase();
    return query ? partnerNames.filter(name => matchesSearch(name, query)) : partnerNames;
  }, [partnerNames, input.partnerQuery]);

  const sortedRows = useMemo(
    () => sortByColumns(filteredRows, input.sort, { textOf: input.sortText, signOf: input.balanceSign }),
    [filteredRows, input.sort, input.sortText, input.balanceSign],
  );
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (input.page - 1) * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [sortedRows, input.page]);

  const totals = useMemo(() => {
    const journals = filteredRows
      .map(row => row.kind === 'stmt' ? row.data.id : row.entry?.id)
      .map(id => id ? input.journalBySource.get(id) : undefined)
      .filter((entry): entry is JournalEntry => !!entry);
    const { income: incomeCash, cost: costCash } = plOfJournals(journals, input.accountCodes);
    return { ...timelineTotals(filteredRows, input.codeType), costCash, incomeCash };
  }, [filteredRows, input.journalBySource, input.accountCodes, input.codeType]);

  const receivableSummary = useMemo(() => {
    let totalReceivable = 0, countReceivable = 0, totalPayable = 0, countPayable = 0;
    input.partnerBalances.forEach(({ receivable, payable }) => {
      if (receivable > 0) { totalReceivable += receivable; countReceivable++; }
      if (payable > 0) { totalPayable += payable; countPayable++; }
    });
    return { totalReceivable, countReceivable, totalPayable, countPayable };
  }, [input.partnerBalances]);

  return {
    allRows, filteredRows, kindCounts, partnerNames, shownPartnerNames,
    sortedRows, pageRows, totalPages, totals, receivableSummary,
  };
}
