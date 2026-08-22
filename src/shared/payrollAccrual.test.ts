import { describe, it, expect } from 'vitest';
import { journalizeTransfer } from './autoJournal';
import type { AccountCode, IssuedStatement } from './types';

/**
 * 급여 발생 전표 — **그 달 비용으로 세우고 지급은 나중에.**
 *
 *   (차) 515 급여 지급계   (대) 254 예수금 공제계 + 263 미지급급여 실지급계
 *
 * 지급일이 사람마다 달라도 발생은 그 달 말일 한 번이다. 그래야 그 달 인건비가 온전히 잡히고,
 * 실제로 줄 때는 263을 터는 출금 한 줄이면 된다(나가는 대로 쪼개도 잔액이 맞는다).
 */
const CODES: Record<string, 'debit' | 'credit'> = {
  '515': 'debit',    // 급여 (비용)
  '254': 'credit',   // 예수금 (부채)
  '263': 'credit',   // 미지급급여 (부채)
  '103': 'debit',    // 보통예금 (자산)
};
const normalOf = (c: string) => CODES[c] ?? 'debit';

const accrual = (gross: number, deduct: number): IssuedStatement => ({
  id: 'stmt-payroll-2026-08-taebaek', companyId: 'taebaek',
  issuedAt: '2026-08-31T14:59:59.000Z', tradeDate: '2026-08-31', type: '비용',
  partnerId: '', partnerName: '급여', orderId: '', docNo: '급여260831-01',
  totalSupply: gross, totalTax: 0, totalAmount: gross,
  items: [
    { name: '급여', spec: '', qty: 1, price: gross, supply: gross, tax: 0, total: gross, isTaxExempt: true, accountCode: '515' },
    { name: '예수금(원천공제)', spec: '', qty: 1, price: deduct, supply: deduct, tax: 0, total: deduct, isTaxExempt: true, accountCode: '254' },
    { name: '미지급급여', spec: '', qty: 1, price: gross - deduct, supply: gross - deduct, tax: 0, total: gross - deduct, isTaxExempt: true, accountCode: '263' },
  ],
} as IssuedStatement);

describe('급여 발생 전표', () => {
  const je = journalizeTransfer(accrual(19_314_620, 1_608_610), normalOf)!;

  it('대체전표로 끊긴다 — 돈이 안 움직인다', () => {
    expect(je).not.toBeNull();
    expect(je.sourceType).toBe('대체');
    expect(je.lines.some(l => l.accountCode === '103')).toBe(false);   // 통장 줄이 없다
  });

  it('급여는 차변, 예수금·미지급급여는 대변', () => {
    expect(je.lines.find(l => l.accountCode === '515')!.debit).toBe(19_314_620);
    expect(je.lines.find(l => l.accountCode === '254')!.credit).toBe(1_608_610);
    expect(je.lines.find(l => l.accountCode === '263')!.credit).toBe(17_706_010);
  });

  it('차·대가 맞는다 — 지급계 = 공제계 + 실지급계', () => {
    const d = je.lines.reduce((a, l) => a + (l.debit ?? 0), 0);
    const c = je.lines.reduce((a, l) => a + (l.credit ?? 0), 0);
    expect(d).toBe(c);
    expect(d).toBe(19_314_620);
  });

  it('공제가 없으면 전액이 미지급급여로 간다', () => {
    const je2 = journalizeTransfer(accrual(2_800_000, 0), normalOf)!;
    // 0원 줄은 안 세운다
    expect(je2.lines.find(l => l.accountCode === '254')).toBeUndefined();
    expect(je2.lines.find(l => l.accountCode === '263')!.credit).toBe(2_800_000);
  });

  it('지급은 263을 터는 것 — 나가는 대로 쪼개도 합이 맞는다', () => {
    const 실지급 = 17_706_010;
    const 쪼갬 = [2_740_840, 3_200_000, 2_800_000, 500_000];
    const 남은것 = 실지급 - 쪼갬.reduce((a, b) => a + b, 0);
    expect(쪼갬.reduce((a, b) => a + b, 0) + 남은것).toBe(실지급);
  });
});
