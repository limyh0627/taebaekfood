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
  /**
   * **어디로 간 건인가** — 업체명 밑에 회색으로 붙는다(2026-09-16 사장님: "거래명세서
   * 화면에서 업체명 밑에 회색 글씨로 배송지명만 표시해주면 어떠냐").
   *
   * 배송지를 안 쓰는 거래처가 대부분이라 보통 비어 있다 — 그때는 줄을 아예 안 그린다.
   * 한 전표에 여럿이 섞이면 `포천 외 2`(`shipTo.shipToSummary`).
   */
  shipTo?: string;
  detail: string;
  note: string;
  amount: number;
  cumulative?: number;
  isReturn: boolean;
};

/** 데스크톱 표와 모바일 카드가 같은 전표를 다른 말로 표시하지 않도록 공통 표시값을 만든다. */
export function statementHistoryRowView(
  row: TimelineRow,
  codeNames: ReadonlyMap<string, string>,
  /** 그 줄이 어느 배송지로 갔나. 안 넘기면 안 그린다 — 배송지를 안 쓰는 화면도 있다. */
  shipToOfRow?: (row: TimelineRow) => string | undefined,
): StatementHistoryRowView {
  if (row.kind === 'cash') {
    const lines = (row.entry.lines ?? []).filter(line => line.accountCode && line.amount !== 0);
    const account = lines.length
      ? lines.map(line => `${line.note ? `${line.note} ` : ''}${codeNames.get(line.accountCode) ?? line.accountCode} ${line.amount < 0 ? '−' : ''}${Math.abs(line.amount).toLocaleString('ko-KR')}`).join(' · ')
      : row.accountCode ? (codeNames.get(row.accountCode) ?? row.accountCode) : '';
    return {
      key: row.entry.id, kind: 'cash', label: rowKind(row), date: row.date,
      createdAt: row.entry.createdAt, owner: row.entry.createdBy, partner: row.partnerName ?? '', shipTo: shipToOfRow?.(row),
      detail: account, note: row.note ?? '', amount: row.amount, cumulative: row.cumul, isReturn: false,
    };
  }
  if (row.kind === 'pay') {
    return {
      key: `${row.paymentId}__${row.stmtType}`, kind: 'pay',
      label: row.offset ? (row.stmtType === '매출' ? '미수상계' : '미지급상계') : row.stmtType === '매출' ? '수금' : '지불',
      date: row.date, createdAt: row.entry?.createdAt, owner: row.entry?.createdBy,
      partner: row.partnerName, shipTo: shipToOfRow?.(row), detail: row.method ?? '', note: row.note ?? '',
      amount: row.amount, cumulative: row.cumul, isReturn: false,
    };
  }
  const statement = row.data;
  const items = statement.items ?? [];
  return {
    key: statement.id, kind: 'stmt', label: statement.type, date: statement.tradeDate,
    createdAt: statement.issuedAt, owner: statement.createdBy, partner: statement.partnerName, shipTo: shipToOfRow?.(row),
    detail: itemSummary(items), note: statement.memo ?? '', amount: statement.totalAmount,
    cumulative: row.cumul, isReturn: items.some(item => item.qty < 0),
  };
}
