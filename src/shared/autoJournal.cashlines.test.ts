import { describe, it, expect } from 'vitest';
import { journalizeCashEntry } from './autoJournal';
import type { CashEntry } from './types';

const entry = (over: Partial<CashEntry>): CashEntry => ({
  id: 'cash-1', date: '2026-08-05', cashAccountId: '', dir: '출금', amount: 0,
  createdAt: '2026-08-05T00:00:00.000Z', ...over,
} as CashEntry);

describe('journalizeCashEntry — 쪼갠 줄(대출상환)', () => {
  it('원금·이자를 각각 차변에 세우고 통장은 합계 한 줄', () => {
    const je = journalizeCashEntry(entry({
      amount: 1_965_899,
      lines: [
        { accountCode: '260', amount: 1_000_000, note: '원금' },
        { accountCode: '951', amount: 965_899, note: '이자' },
      ],
    }))!;
    expect(je.lines).toEqual([
      { accountCode: '260', debit: 1_000_000, credit: 0 },
      { accountCode: '951', debit: 965_899, credit: 0 },
      { accountCode: '103', debit: 0, credit: 1_965_899 },
    ]);
    const d = je.lines.reduce((a, l) => a + l.debit, 0);
    const c = je.lines.reduce((a, l) => a + l.credit, 0);
    expect(d).toBe(c);
  });

  it('입금이면 방향이 뒤집힌다', () => {
    const je = journalizeCashEntry(entry({
      dir: '입금', amount: 3_000_000,
      lines: [{ accountCode: '260', amount: 3_000_000, note: '대출 실행' }],
    }))!;
    expect(je.lines[0]).toEqual({ accountCode: '103', debit: 3_000_000, credit: 0 });
    expect(je.lines[1]).toEqual({ accountCode: '260', debit: 0, credit: 3_000_000 });
  });

  it('amount가 줄 합계와 어긋나도 분개는 줄 합계로 균형을 맞춘다', () => {
    const je = journalizeCashEntry(entry({
      amount: 999,   // 잘못 저장된 값
      lines: [{ accountCode: '951', amount: 500_000 }, { accountCode: '260', amount: 500_000 }],
    }))!;
    const d = je.lines.reduce((a, l) => a + l.debit, 0);
    const c = je.lines.reduce((a, l) => a + l.credit, 0);
    expect(d).toBe(c);
    expect(c).toBe(1_000_000);
  });

  it('줄이 없으면 기존 한 줄 방식 그대로', () => {
    const je = journalizeCashEntry(entry({ amount: 965_899, accountCode: '951' }))!;
    expect(je.lines).toEqual([
      { accountCode: '951', debit: 965_899, credit: 0 },
      { accountCode: '103', debit: 0, credit: 965_899 },
    ]);
  });

  it('거래처가 있으면 성격계정 줄에만 붙는다', () => {
    const je = journalizeCashEntry(entry({
      amount: 100, partnerId: 'C001',
      lines: [{ accountCode: '951', amount: 100 }],
    }))!;
    expect(je.lines[0]).toEqual({ accountCode: '951', partnerId: 'C001', debit: 100, credit: 0 });
    expect(je.lines[1].partnerId).toBeUndefined();
  });

  it('줄도 계정도 없으면 분개를 만들지 않는다', () => {
    expect(journalizeCashEntry(entry({ amount: 1000 }))).toBeNull();
  });
});
