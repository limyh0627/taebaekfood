export type ExcelListColumn = { header: string; width: number; number?: boolean };
export type ExcelListValue = string | number | null | undefined;

/** 화면에서 이미 회사·기간·검색으로 걸러진 행만 받는다. 다운로드가 DB를 다시 조회하지 않는다. */
export async function buildListWorkbook(input: {
  title: string;
  subtitle: string;
  columns: ExcelListColumn[];
  rows: ExcelListValue[][];
}): Promise<import('exceljs').Workbook> {
  // 목록을 보는 동안에는 ExcelJS를 싣지 않는다. 다운로드할 때만 읽는다.
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(input.title.slice(0, 31));
  sheet.columns = input.columns.map(column => ({ width: column.width }));
  sheet.mergeCells(1, 1, 1, input.columns.length);
  sheet.getCell(1, 1).value = input.title;
  sheet.getCell(1, 1).font = { bold: true, size: 16 };
  sheet.getRow(1).height = 30;
  sheet.mergeCells(2, 1, 2, input.columns.length);
  sheet.getCell(2, 1).value = input.subtitle;
  sheet.getCell(2, 1).font = { size: 10, color: { argb: 'FF64748B' } };
  const header = sheet.getRow(4);
  input.columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: 'FF1E293B' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    cell.alignment = { vertical: 'middle', horizontal: column.number ? 'right' : 'left' };
  });
  header.height = 22;
  input.rows.forEach(values => {
    const row = sheet.addRow(values.map(value => {
      // 거래처명·적요 등은 사용자 입력이다. Excel 수식으로 실행되지 않도록 문자열을 보호한다.
      if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(value)) return `'${value}`;
      return value ?? '';
    }));
    row.height = 19;
    input.columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      cell.alignment = { vertical: 'middle', horizontal: column.number ? 'right' : 'left' };
      if (column.number) cell.numFmt = '#,##0.###;[Red](#,##0.###)';
    });
  });
  sheet.views = [{ state: 'frozen', ySplit: 4 }];
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: input.columns.length } };
  return workbook;
}

export async function downloadListExcel(input: Parameters<typeof buildListWorkbook>[0] & { fileName: string }): Promise<void> {
  const workbook = await buildListWorkbook(input);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${input.fileName.replace(/[\\/:*?"<>|]/g, '_')}.xlsx`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
