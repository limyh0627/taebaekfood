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
