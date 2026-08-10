import { describe, it, expect } from 'vitest';
import { journalizeTransfer } from './autoJournal';
import type { IssuedStatement } from './types';

// 실제 계정: 818 감가상각비(비용/차변), 203 감가상각누계액(자산차감/대변),
//            535 퇴직급여충당금(비용/차변), 295 퇴직급여충당부채(부채/대변)
const normalOf = (c: string) => (['818', '535'].includes(c) ? 'debit' : 'credit') as 'debit' | 'credit';

const line = (accountCode: string, total: number) =>
  ({ name: accountCode, spec: '', qty: 1, price: total, supply: total, tax: 0, total, isTaxExempt: true, accountCode });

const stmt = (items: ReturnType<typeof line>[]): IssuedStatement => ({
  id: 'stmt-1', issuedAt: '2026-08-31T00:00:00.000Z', tradeDate: '2026-08-31', type: '비용',
  partnerId: '', partnerName: '감가상각', orderId: '', docNo: '대체2026-08-0001',
  totalSupply: 0, totalTax: 0, totalAmount: 0, items,
} as unknown as IssuedStatement);

describe('journalizeTransfer (대체전표)', () => {
  it('감가상각 — 비용은 차변, 누계액은 대변', () => {
    const je = journalizeTransfer(stmt([line('818', 1_000_000), line('203', 1_000_000)]), normalOf)!;
    expect(je).not.toBeNull();
    expect(je.sourceType).toBe('대체');
    expect(je.lines).toEqual([
      { accountCode: '818', debit: 1_000_000, credit: 0 },
      { accountCode: '203', debit: 0, credit: 1_000_000 },
    ]);
    const d = je.lines.reduce((a, l) => a + l.debit, 0);
    const c = je.lines.reduce((a, l) => a + l.credit, 0);
    expect(d).toBe(c);
  });

  it('퇴직급여충당 — 비용/부채 양쪽이 선다', () => {
    const je = journalizeTransfer(stmt([line('535', 3_000_000), line('295', 3_000_000)]), normalOf)!;
    expect(je.lines.find(l => l.accountCode === '535')?.debit).toBe(3_000_000);
    expect(je.lines.find(l => l.accountCode === '295')?.credit).toBe(3_000_000);
  });

  it('한쪽만 적으면 분개를 만들지 않는다 — 시산표가 깨지므로', () => {
    expect(journalizeTransfer(stmt([line('818', 1_000_000)]), normalOf)).toBeNull();
  });

  it('차·대 금액이 다르면 만들지 않는다', () => {
    expect(journalizeTransfer(stmt([line('818', 1_000_000), line('203', 900_000)]), normalOf)).toBeNull();
  });

  it('계정 미지정 줄이 있으면 만들지 않는다', () => {
    const bad = { ...line('818', 1000), accountCode: undefined } as unknown as ReturnType<typeof line>;
    expect(journalizeTransfer(stmt([bad, line('203', 1000)]), normalOf)).toBeNull();
  });

  it('매출·매입 전표는 대상이 아니다', () => {
    const s = { ...stmt([line('818', 1000), line('203', 1000)]), type: '매입' } as IssuedStatement;
    expect(journalizeTransfer(s, normalOf)).toBeNull();
  });
});
