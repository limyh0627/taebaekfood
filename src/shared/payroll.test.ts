import { describe, it, expect } from 'vitest';
import { payrollGross, payrollDeduct, payrollNet, payrollTotals } from './types';
import type { PayrollLine } from './types';
import { journalizeCashEntry } from './autoJournal';
import type { CashEntry } from './types';

const line = (over: Partial<PayrollLine> = {}): PayrollLine => ({
  employeeId: 'e1', employeeName: '이지영', base: 2_800_000, ...over,
});

describe('급여대장 계산', () => {
  it('지급계 = 기본급 + 연장 + 수당', () => {
    expect(payrollGross(line({ overtime: 120_000, allowance: 100_000 }))).toBe(3_020_000);
  });

  it('공제계 = 세목 합', () => {
    const l = line({ incomeTax: 62_000, localTax: 6_200, pension: 135_900, health: 107_000, employment: 27_180 });
    expect(payrollDeduct(l)).toBe(338_280);
  });

  it('실지급 = 지급계 − 공제계', () => {
    const l = line({ overtime: 120_000, allowance: 100_000, incomeTax: 62_000, localTax: 6_200,
      pension: 135_900, health: 107_000, employment: 27_180 });
    expect(payrollNet(l)).toBe(3_020_000 - 338_280);
  });

  it('빈 항목은 0으로 본다', () => {
    expect(payrollNet(line())).toBe(2_800_000);
  });

  it('합계는 줄별 합과 같다', () => {
    const ls = [line({ incomeTax: 50_000 }), line({ employeeId: 'e2', base: 3_000_000, pension: 135_000 })];
    const t = payrollTotals(ls);
    expect(t.gross).toBe(5_800_000);
    expect(t.deduct).toBe(185_000);
    expect(t.net).toBe(5_615_000);
  });
});

describe('급여대장 → 전표', () => {
  it('지급계는 차변, 공제계는 대변, 통장은 실지급계 — 차·대가 맞는다', () => {
    const ls = [
      line({ overtime: 120_000, incomeTax: 62_000, pension: 135_900 }),
      line({ employeeId: 'e2', employeeName: '아브라함', base: 3_000_000, incomeTax: 80_000, health: 110_000 }),
    ];
    const t = payrollTotals(ls);
    const entry: CashEntry = {
      id: 'cash-pay-2026-08', date: '2026-08-25', cashAccountId: '', dir: '출금',
      amount: t.net, createdAt: '2026-08-25T00:00:00.000Z',
      lines: [
        { accountCode: '515', amount: t.gross, note: '총급여' },
        { accountCode: '254', amount: -t.deduct, note: '원천공제' },
      ],
    } as CashEntry;
    const je = journalizeCashEntry(entry)!;
    expect(je.lines).toEqual([
      { accountCode: '515', debit: t.gross, credit: 0 },
      { accountCode: '254', debit: 0, credit: t.deduct },
      { accountCode: '103', debit: 0, credit: t.net },
    ]);
    const d = je.lines.reduce((a, l) => a + l.debit, 0);
    const c = je.lines.reduce((a, l) => a + l.credit, 0);
    expect(d).toBe(c);
    expect(d).toBe(t.gross);
  });
});
