import { itemSummary } from '../../../shared/itemSummary';
import { rowKind, type TimelineRow } from '../../../shared/timelineRows';

export type StatementHistoryRowView = {
  key: string;
  kind: 'cash' | 'pay' | 'stmt';
  label: string;
  date: string;
  createdAt?: string;
  owner?: string;
  partner: string;
  detail: string;
  note: string;
  amount: number;
  cumulative?: number;
  isReturn: boolean;
};

/** 데스크톱 표와 모바일 카드가 같은 전표를 다른 말로 표시하지 않도록 공통 표시값을 만든다. */
export function statementHistoryRowView(row: TimelineRow, codeNames: ReadonlyMap<string, string>): StatementHistoryRowView {
  if (row.kind === 'cash') {
    const lines = (row.entry.lines ?? []).filter(line => line.accountCode && line.amount !== 0);
    const account = lines.length
      ? lines.map(line => `${line.note ? `${line.note} ` : ''}${codeNames.get(line.accountCode) ?? line.accountCode} ${line.amount < 0 ? '−' : ''}${Math.abs(line.amount).toLocaleString('ko-KR')}`).join(' · ')
      : row.accountCode ? (codeNames.get(row.accountCode) ?? row.accountCode) : '';
    return {
      key: row.entry.id, kind: 'cash', label: rowKind(row), date: row.date,
      createdAt: row.entry.createdAt, owner: row.entry.createdBy, partner: row.partnerName ?? '',
      detail: account, note: row.note ?? '', amount: row.amount, cumulative: row.cumul, isReturn: false,
    };
  }
  if (row.kind === 'pay') {
    return {
      key: `${row.paymentId}__${row.stmtType}`, kind: 'pay',
      label: row.offset ? (row.stmtType === '매출' ? '미수상계' : '미지급상계') : row.stmtType === '매출' ? '수금' : '지불',
      date: row.date, createdAt: row.entry?.createdAt, owner: row.entry?.createdBy,
      partner: row.partnerName, detail: row.method ?? '', note: row.note ?? '',
      amount: row.amount, cumulative: row.cumul, isReturn: false,
    };
  }
  const statement = row.data;
  const items = statement.items ?? [];
  return {
    key: statement.id, kind: 'stmt', label: statement.type, date: statement.tradeDate,
    createdAt: statement.issuedAt, owner: statement.createdBy, partner: statement.partnerName,
    detail: itemSummary(items), note: statement.memo ?? '', amount: statement.totalAmount,
    cumulative: row.cumul, isReturn: items.some(item => item.qty < 0),
  };
}
