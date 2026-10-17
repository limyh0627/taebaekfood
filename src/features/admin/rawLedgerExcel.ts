import {previewWorkbookOutput} from '../../shared/workbookOutput';
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

export function buildRawLedgerWorkbook(ExcelJS:typeof import('exceljs'),sheets:{material:string;sheet:RawLedgerExcelSheet}[],yearMonth:string){
 const wb=new ExcelJS.Workbook();
                    for (const {material: mat, sheet} of sheets) {
                      const ws = wb.addWorksheet(mat);
                      ws.columns = [
                        { width: 12 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 30 }
                      ];
                      // 수불부는 모든 원료를 kg로 통일 표시 (L 입력 데이터는 buildRawDocSheet에서 환산됨)
                      const hRow = ws.addRow(['날짜', '전재고(kg)', '입고량(kg)', '사용량(kg)', '정정량(kg)', '현재고(kg)', '비고']);
                      hRow.font = { bold: true, size: 9 };
                      const border = { top: { style: 'thin' as const }, bottom: { style: 'thin' as const }, left: { style: 'thin' as const }, right: { style: 'thin' as const } };
                      hRow.eachCell(c => { c.border = border; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; });
                      const excelRows = rawLedgerExcelRows(yearMonth, sheet);
                      // 전월이월 행 — 전달 마지막 현재고를 전재고로 (매달 1일)
                      const openRow = ws.addRow(excelRows.opening);
                      openRow.font = { size: 9, bold: true };
                      openRow.eachCell(c => { c.border = border; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }; });
                      excelRows.details.forEach((values) => {
                        const r = ws.addRow(values);
                        r.font = { size: 9 };
                        r.eachCell(c => { c.border = border; });
                        r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
                        r.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
                      });
                      // 합계 행 — 당월 총 입고·사용
                      const sumRow = ws.addRow(excelRows.total);
                      sumRow.font = { size: 9, bold: true };
                      sumRow.eachCell(c => { c.border = border; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }; });
                    }

 return wb;
}
export async function downloadRawLedgerExcel(sheets:{material:string;sheet:RawLedgerExcelSheet}[],yearMonth:string,signal:AbortSignal){
 if(signal.aborted)return;const snapshot=JSON.parse(JSON.stringify(sheets)) as typeof sheets;const ExcelJS=(await import('exceljs')).default;
 if(signal.aborted)return;await previewWorkbookOutput({workbook:buildRawLedgerWorkbook(ExcelJS,snapshot,yearMonth),fileName:`원료수불부_${yearMonth}.xlsx`,signal});
}
