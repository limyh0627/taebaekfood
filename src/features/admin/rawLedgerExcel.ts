export interface RawLedgerExcelSheet {
  opening: number;
  closing: number;
  totalIn: number;
  totalOut: number;
  totalAdj: number;
  rows: Array<{
    date: string;
    received: number;
    used: number;
    adj: number;
    prevBalance: number;
    currentBalance: number;
    note: string;
  }>;
}

export type FormulaCell = { formula: string; result: number };
export type RawLedgerExcelValue = string | number | FormulaCell;

/**
 * 원료수불부 엑셀의 값·수식을 만든다.
 * 사용자가 입고·사용·정정값을 고치면 전재고와 현재고가 뒤 행까지 연쇄 계산돼야 한다.
 */
export function rawLedgerExcelRows(yearMonth: string, sheet: RawLedgerExcelSheet): {
  opening: RawLedgerExcelValue[];
  details: RawLedgerExcelValue[][];
  total: RawLedgerExcelValue[];
} {
  const openingRowNo = 2;
  const firstDetailRowNo = 3;
  const opening: RawLedgerExcelValue[] = [
    `${yearMonth}-01 (전월이월)`, sheet.opening, 0, 0, 0,
    { formula: `B${openingRowNo}+C${openingRowNo}-D${openingRowNo}+E${openingRowNo}`, result: sheet.opening },
    '전월 말 현재고',
  ];
  const details = sheet.rows.map((row, index): RawLedgerExcelValue[] => {
    const rowNo = firstDetailRowNo + index;
    return [
      row.date,
      { formula: `F${rowNo - 1}`, result: row.prevBalance },
      row.received,
      row.used,
      row.adj,
      { formula: `B${rowNo}+C${rowNo}-D${rowNo}+E${rowNo}`, result: row.currentBalance },
      row.note || '',
    ];
  });
  const lastDetailRowNo = firstDetailRowNo + details.length - 1;
  const totalRowNo = firstDetailRowNo + details.length;
  const sum = (column: 'C' | 'D' | 'E', result: number): RawLedgerExcelValue => details.length
    ? { formula: `SUM(${column}${firstDetailRowNo}:${column}${lastDetailRowNo})`, result }
    : 0;
  const total: RawLedgerExcelValue[] = [
    '합계', '',
    sum('C', sheet.totalIn),
    sum('D', sheet.totalOut),
    sum('E', sheet.totalAdj),
    { formula: `F${details.length ? lastDetailRowNo : openingRowNo}`, result: sheet.closing },
    '당월 총 입고·사용·정정',
  ];
  void totalRowNo;
  return { opening, details, total };
}
