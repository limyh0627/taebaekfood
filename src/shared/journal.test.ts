import { describe, it, expect } from 'vitest';
import {
  validateEntry, isBalanced, tallyByAccount, accountBalance, trialBalance,
  balancesByType, incomeStatement, balanceSheet, partnerBalance,
} from './journal';
import type { JournalEntry, AccountCode } from './types';

const acc: AccountCode[] = [
  { id: '103', code: '103', name: '보통예금', type: '자산', normalBalance: 'debit', isCash: true },
  { id: '108', code: '108', name: '외상매출금', type: '자산', normalBalance: 'debit' },
  { id: '251', code: '251', name: '외상매입금', type: '부채', normalBalance: 'credit' },
  { id: '255', code: '255', name: '부가세예수금', type: '부채', normalBalance: 'credit' },
  { id: '331', code: '331', name: '자본금', type: '자본', normalBalance: 'credit' },
  { id: '500', code: '500', name: '원료매입', type: '비용', normalBalance: 'debit' },
  { id: '800', code: '800', name: '매출', type: '수익', normalBalance: 'credit' },
];

const je = (id: string, date: string, sourceType: JournalEntry['sourceType'], lines: JournalEntry['lines']): JournalEntry =>
  ({ id, date, sourceType, lines, createdAt: '' });

// 매출 110만(부가세 10만) 외상
const sale = je('s1', '2026-07-01', '매출', [
  { accountCode: '108', debit: 1_100_000, credit: 0, partnerId: 'A' },
  { accountCode: '800', debit: 0, credit: 1_000_000 },
  { accountCode: '255', debit: 0, credit: 100_000 },
]);
// 원료매입 100만 외상(면세)
const purchase = je('p1', '2026-07-02', '매입', [
  { accountCode: '500', debit: 1_000_000, credit: 0 },
  { accountCode: '251', debit: 0, credit: 1_000_000, partnerId: 'B' },
]);
// 자본금 1000만 납입
const capital = je('c1', '2026-07-01', '자금', [
  { accountCode: '103', debit: 10_000_000, credit: 0 },
  { accountCode: '331', debit: 0, credit: 10_000_000 },
]);

describe('validateEntry', () => {
  it('차대 맞으면 통과', () => {
    expect(validateEntry(sale)).toEqual([]);
    expect(isBalanced(sale)).toBe(true);
  });
  it('차대 안 맞으면 잡는다', () => {
    const bad = je('x', '2026-07-01', '수동', [
      { accountCode: '108', debit: 100, credit: 0 },
      { accountCode: '800', debit: 0, credit: 90 },
    ]);
    expect(validateEntry(bad).some(e => /불일치/.test(e))).toBe(true);
  });
  it('한 줄에 차·대 동시면 잡는다', () => {
    const bad = je('x', '2026-07-01', '수동', [{ accountCode: '108', debit: 100, credit: 100 }, { accountCode: '800', debit: 0, credit: 100 }]);
    expect(validateEntry(bad).some(e => /동시/.test(e))).toBe(true);
  });
  it('2줄 미만이면 잡는다', () => {
    expect(validateEntry({ lines: [{ accountCode: '108', debit: 100, credit: 0 }] }).some(e => /최소 2줄/.test(e))).toBe(true);
  });
});

describe('tally · balance', () => {
  it('계정별 차대 집계', () => {
    const t = tallyByAccount([sale, purchase, capital]);
    expect(t.get('108')).toEqual({ accountCode: '108', debit: 1_100_000, credit: 0 });
    expect(t.get('800')).toEqual({ accountCode: '800', debit: 0, credit: 1_000_000 });
  });
  it('normalBalance 방향 순액', () => {
    expect(accountBalance({ accountCode: '108', debit: 1_100_000, credit: 0 }, 'debit')).toBe(1_100_000);
    expect(accountBalance({ accountCode: '251', debit: 0, credit: 1_000_000 }, 'credit')).toBe(1_000_000);
    expect(accountBalance({ accountCode: '103', debit: 100, credit: 30 }, 'debit')).toBe(70);
  });
});

describe('시산표', () => {
  it('차변총계 == 대변총계', () => {
    const tb = trialBalance([sale, purchase, capital], acc);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.totalDebit).toBe(1_100_000 + 1_000_000 + 10_000_000);
  });
  it('계정별 잔액', () => {
    const tb = trialBalance([sale, purchase, capital], acc);
    const by = Object.fromEntries(tb.rows.map(r => [r.accountCode, r.balance]));
    expect(by['108']).toBe(1_100_000);  // 외상매출금 자산
    expect(by['251']).toBe(1_000_000);  // 외상매입금 부채
    expect(by['800']).toBe(1_000_000);  // 매출 수익
  });
});

describe('보고서', () => {
  it('손익 = 수익 − 비용', () => {
    const is = incomeStatement([sale, purchase, capital], acc);
    expect(is.revenue).toBe(1_000_000);
    expect(is.expense).toBe(1_000_000);
    expect(is.netIncome).toBe(0);
  });
  it('재무상태표 균형 (자산 = 부채+자본+순이익)', () => {
    const bs = balanceSheet([sale, purchase, capital], acc);
    // 자산: 보통예금1000만 + 외상매출금110만 = 1110만
    // 부채: 외상매입금100만 + 부가세예수금10만 = 110만
    // 자본: 1000만 · 순이익: 0
    expect(bs.asset).toBe(11_100_000);
    expect(bs.liability).toBe(1_100_000);
    expect(bs.equity).toBe(10_000_000);
    expect(bs.balanced).toBe(true);
  });
  it('type별 잔액', () => {
    const b = balancesByType([sale, purchase, capital], acc);
    expect(b.자산).toBe(11_100_000);
    expect(b.부채).toBe(1_100_000);
  });
});

describe('거래처 원장', () => {
  it('외상매출금 거래처별', () => {
    expect(partnerBalance([sale], '108', 'A', 'debit')).toBe(1_100_000);
    expect(partnerBalance([sale], '108', 'B', 'debit')).toBe(0);
  });
  it('외상매입금 거래처별', () => {
    expect(partnerBalance([purchase], '251', 'B', 'credit')).toBe(1_000_000);
  });
});
