import { describe, expect, it } from 'vitest';
import { buildListWorkbook } from './listExcel';

describe('조회 목록 엑셀', () => {
  it('필터된 행만 숫자 그대로 기록하고 사용자 문자열은 수식으로 실행하지 않는다', async () => {
    const workbook = await buildListWorkbook({
      title: '전표내역', subtitle: '2026-09-01 ~ 2026-09-30 · 1건',
      columns: [{ header: '거래처', width: 20 }, { header: '금액', width: 15, number: true }],
      rows: [['=HYPERLINK("x")', 12345]],
    });
    const sheet = workbook.getWorksheet('전표내역')!;
    expect(sheet.getCell('A2').value).toContain('2026-09-01');
    expect(sheet.getCell('A5').value).toBe('\'=HYPERLINK("x")');
    expect(sheet.getCell('B5').value).toBe(12345);
    expect(sheet.getCell('B5').numFmt).toContain('#,##0');
    expect(sheet.rowCount).toBe(5);
  }, 15000);
});
