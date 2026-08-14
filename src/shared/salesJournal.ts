import type * as ExcelJSType from 'exceljs';

/**
 * 생산작업판매일지 엑셀 한 장.
 *
 * 실시간 저장(서류관리 > 생산판매기록부)과 **이력 보기의 [엑셀로 저장]**이 이 함수 하나를 쓴다.
 * 예전엔 양식이 화면·엑셀에 흩어져 있어서, 저장된 이력에는 좌측 하단(깨·가루)이 아예
 * 안 담기고 우측 판매도 "품목 N개" 문자열로만 남아 보기와 실물 서류가 달랐다.
 *
 * 배치 — 좌측은 생산(품목/용량/수량/소비기한/비고), 우측은 그날 판매(상호/품목/용량/수량/소비기한).
 *   1행    헤더(좌 1~5, 우 7~11)
 *   3행~   좌: 기름 템플릿 · 우: 판매 목록 (긴 쪽에 맞춰 나란히)
 *   그 뒤  좌측 하단 표 — 깨·가루 (한 줄 띄고 한 행씩)
 *   맨 뒤  기타 — 템플릿 어디에도 안 붙은 판매분(누락 방지)
 */

/** 좌측 상단 — 기름. groupLabel은 그룹 첫 줄에만 있고 나머지는 ''(엑셀에서 세로 병합처럼 보이게) */
export interface JournalOilRow {
  groupLabel: string;
  spec: string;
  수량: number;
  소비기한: string;
  비고: string;
}

/** 좌측 하단 — 깨·가루. 품목마다 한 행 */
export interface JournalSeedRow {
  품목: string;
  용량: string;
  수량: number;
  소비기한: string;
  비고: string;
}

/** 우측 — 그날 판매 */
export interface JournalSalesRow {
  상호: string;
  품목: string;
  용량: string;
  수량: number;
  소비기한: string;
}

/** 맨 아래 기타 — 좌측 어느 자리에도 안 붙은 판매분 */
export interface JournalExtraRow {
  품목: string;
  용량: string;
  수량: number;
  거래처: string;
}

export interface SalesJournalData {
  date: string;                  // 서류 날짜 'YYYY-MM-DD'
  oilRows: JournalOilRow[];
  seedRows: JournalSeedRow[];
  salesRows: JournalSalesRow[];
  extraRows: JournalExtraRow[];
}

/** ExcelJS는 무거워서 호출부에서 동적 import 해 넘긴다(번들 분리 유지). */
export function buildSalesJournalWorkbook(
  ExcelJS: typeof import('exceljs'),
  data: SalesJournalData,
): ExcelJSType.Workbook {
  const { oilRows, seedRows, salesRows, extraRows } = data;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('생산작업판매일지');

  ws.columns = [
    { width: 18 }, { width: 8 }, { width: 6 }, { width: 18 }, { width: 28 },
    { width: 2 },
    { width: 18 }, { width: 16 }, { width: 8 }, { width: 6 }, { width: 18 },
  ];

  const thinBorder: Partial<ExcelJSType.Borders> = {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
  };
  const headerFill: ExcelJSType.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  const groupFill: ExcelJSType.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };

  const applyHeader = (row: ExcelJSType.Row, cols: number[]) => {
    cols.forEach(c => {
      const cell = row.getCell(c);
      cell.font = { bold: true, size: 9 };
      cell.fill = headerFill;
      cell.border = thinBorder;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  };

  const hRow = ws.addRow(['품목(제품명)', '용량', '수량', '소비기한', '비 고', '', '상호', '품목', '용량', '수량', '소비기한']);
  hRow.height = 18;
  applyHeader(hRow, [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]);
  ws.addRow([]);

  // 좌우 나란히 — 둘 중 긴 쪽에 맞춘다
  const maxRows = Math.max(oilRows.length, salesRows.length);
  for (let i = 0; i < maxRows; i++) {
    const l = oilRows[i];
    const r = salesRows[i];
    const row = ws.addRow([
      l?.groupLabel ?? '', l?.spec ?? '', l ? (l.수량 || 0) : '', l?.소비기한 ?? '', l?.비고 ?? '',
      '',
      r?.상호 ?? '', r?.품목 ?? '', r?.용량 ?? '', r ? r.수량 : '', r?.소비기한 ?? '',
    ]);
    row.height = 16;

    if (l) {
      [1, 2, 3, 4, 5].forEach(c => {
        const cell = row.getCell(c);
        cell.border = thinBorder;
        cell.font = { size: 9 };
        cell.alignment = { horizontal: c === 1 ? 'left' : 'center', vertical: 'middle', wrapText: c === 5 };
        if (c === 1 && l.groupLabel) {
          cell.font = { bold: true, size: 9 };
          cell.fill = groupFill;
        }
        if (c === 3) {
          cell.font = { bold: l.수량 > 0, size: 9, color: l.수량 > 0 ? { argb: 'FF1E3A5F' } : { argb: 'FF999999' } };
        }
      });
    }
    if (r) {
      [7, 8, 9, 10, 11].forEach(c => {
        const cell = row.getCell(c);
        cell.border = thinBorder;
        cell.font = { size: 9 };
        cell.alignment = { horizontal: c === 10 ? 'center' : 'left', vertical: 'middle' };
      });
    }
  }

  // 좌측 하단 — 깨·가루
  ws.addRow([]);
  const bHRow = ws.addRow(['품목(제품명)', '용량', '수량', '소비기한', '비 고']);
  bHRow.height = 18;
  applyHeader(bHRow, [1, 2, 3, 4, 5]);
  ws.addRow([]);

  seedRows.forEach(s => {
    const row = ws.addRow([s.품목, s.용량, s.수량, s.소비기한, s.비고]);
    row.height = 16;
    [1, 2, 3, 4, 5].forEach(c => {
      const cell = row.getCell(c);
      cell.border = thinBorder;
      cell.font = { bold: c === 1, size: 9 };
      cell.alignment = { horizontal: c <= 2 ? 'left' : 'center', vertical: 'middle', wrapText: c === 5 };
      if (c === 3 && s.수량 > 0) cell.font = { bold: true, size: 9, color: { argb: 'FF1E3A5F' } };
    });
    ws.addRow([]);
  });

  // 기타 — 좌측 자리에 없는 판매분
  if (extraRows.length > 0) {
    ws.addRow([]);
    const hdr = ws.addRow(['기타 (템플릿 외 판매분)', '', '', '', '']);
    hdr.getCell(1).font = { bold: true, size: 9 };
    extraRows.forEach(r => {
      const row = ws.addRow([r.품목, r.용량 || '(미설정)', r.수량, '', r.거래처]);
      row.height = 16;
      [1, 2, 3, 4, 5].forEach(c => {
        const cell = row.getCell(c);
        cell.border = thinBorder;
        cell.font = { bold: c === 1, size: 9 };
        cell.alignment = { horizontal: c <= 2 ? 'left' : 'center', vertical: 'middle', wrapText: c === 5 };
      });
    });
  }

  return wb;
}

/** 워크북을 만들어 브라우저에서 내려받기까지. 파일명은 서류 날짜 기준. */
export async function downloadSalesJournal(data: SalesJournalData): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = buildSalesJournalWorkbook(ExcelJS as unknown as typeof import('exceljs'), data);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `생산작업판매일지_${data.date}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
