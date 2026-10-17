import { describe, expect, it } from 'vitest';
import { rawLedgerExcelRows } from './rawLedgerExcel';

describe('원료수불부 엑셀 수식', () => {
  it('전재고가 앞 행 현재고를 잇고 현재고·합계가 수식으로 계산된다', () => {
    const rows = rawLedgerExcelRows('2026-08', {
      opening: 100, closing: 125, totalIn: 50, totalOut: 20, totalAdj: -5,
      rows: [
        { date: '2026-08-03', received: 50, used: 0, adj: 0, prevBalance: 100, currentBalance: 150, note: '입고' },
        { date: '2026-08-10', received: 0, used: 20, adj: -5, prevBalance: 150, currentBalance: 125, note: '사용·정정' },
      ],
    });

    expect(rows.opening[5]).toEqual({ formula: 'B2+C2-D2+E2', result: 100 });
    expect(rows.details[0][1]).toEqual({ formula: 'F2', result: 100 });
    expect(rows.details[1][1]).toEqual({ formula: 'F3', result: 150 });
    expect(rows.details[1][5]).toEqual({ formula: 'B4+C4-D4+E4', result: 125 });
    expect(rows.total[2]).toEqual({ formula: 'SUM(C3:C4)', result: 50 });
    expect(rows.total[3]).toEqual({ formula: 'SUM(D3:D4)', result: 20 });
    expect(rows.total[4]).toEqual({ formula: 'SUM(E3:E4)', result: -5 });
    expect(rows.total[5]).toEqual({ formula: 'F4', result: 125 });
  });
});

it('원료별 전체 시트의 기존 수식·서식과 열폭을 workbook으로 그대로 만든다',async()=>{
 const ExcelJS=await import('exceljs');const {buildRawLedgerWorkbook}=await import('./rawLedgerExcel');const sheet={opening:100,closing:90,totalIn:0,totalOut:10,totalAdj:0,rows:[{date:'2026-10-01',received:0,used:10,adj:0,prevBalance:100,currentBalance:90,note:'사용'}]};const book=buildRawLedgerWorkbook(ExcelJS,[{material:'참기름',sheet},{material:'들기름',sheet}],'2026-10');expect(book.worksheets.map(s=>s.name)).toEqual(['참기름','들기름']);const first=book.worksheets[0];expect(first.getColumn(7).width).toBe(30);expect(first.getCell('B3').value).toEqual({formula:'F2',result:100});expect(first.getCell('F3').value).toEqual({formula:'B3+C3-D3+E3',result:90});expect(first.getCell('F3').fill).toMatchObject({type:'pattern',fgColor:{argb:'FFEEF2FF'}});expect(sheet.rows[0].currentBalance).toBe(90);
});
