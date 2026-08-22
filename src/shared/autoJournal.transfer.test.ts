import { describe, it, expect } from 'vitest';
import { journalizeTransfer } from './autoJournal';
import type { IssuedStatement } from './types';

// 실제 계정: 818 감가상각비(비용/차변), 203 감가상각누계액(자산차감/대변),
//            535 퇴직급여충당금(비용/차변), 295 퇴직급여충당부채(부채/대변)
const normalOf = (c: string) => (['818', '535'].includes(c) ? 'debit' : 'credit') as 'debit' | 'credit';

// 대체전표는 **차·대를 줄에 적는다.** 짐작하지 않는다 — 자본을 차변에 세우는 전표가 있다.
const line = (accountCode: string, total: number, side: '차변' | '대변') =>
  ({ name: accountCode, spec: '', qty: 1, price: total, supply: total, tax: 0, total, isTaxExempt: true, accountCode, side });

const stmt = (items: ReturnType<typeof line>[]): IssuedStatement => ({
  id: 'stmt-1', issuedAt: '2026-08-31T00:00:00.000Z', tradeDate: '2026-08-31', type: '비용',
  partnerId: '', partnerName: '감가상각', orderId: '', docNo: '대체2026-08-0001',
  totalSupply: 0, totalTax: 0, totalAmount: 0, items,
} as unknown as IssuedStatement);

describe('journalizeTransfer (대체전표)', () => {
  it('감가상각 — 비용은 차변, 누계액은 대변', () => {
    const je = journalizeTransfer(stmt([line('818', 1_000_000, '차변'), line('203', 1_000_000, '대변')]), normalOf)!;
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
    const je = journalizeTransfer(stmt([line('535', 3_000_000, '차변'), line('295', 3_000_000, '대변')]), normalOf)!;
    expect(je.lines.find(l => l.accountCode === '535')?.debit).toBe(3_000_000);
    expect(je.lines.find(l => l.accountCode === '295')?.credit).toBe(3_000_000);
  });

  it('한쪽만 적으면 분개를 만들지 않는다 — 시산표가 깨지므로', () => {
    expect(journalizeTransfer(stmt([line('818', 1_000_000, '차변')]), normalOf)).toBeNull();
  });

  it('차·대 금액이 다르면 만들지 않는다', () => {
    expect(journalizeTransfer(stmt([line('818', 1_000_000, '차변'), line('203', 900_000, '대변')]), normalOf)).toBeNull();
  });

  it('계정 미지정 줄이 있으면 만들지 않는다', () => {
    const bad = { ...line('818', 1000, '차변'), accountCode: undefined } as unknown as ReturnType<typeof line>;
    expect(journalizeTransfer(stmt([bad, line('203', 1000, '대변')]), normalOf)).toBeNull();
  });

  it('매출·매입 전표는 대상이 아니다', () => {
    const s = { ...stmt([line('818', 1000, '차변'), line('203', 1000, '대변')]), type: '매입' } as IssuedStatement;
    expect(journalizeTransfer(s, normalOf)).toBeNull();
  });

  it('차·대를 안 적은 줄이 있으면 만들지 않는다 — 짐작으로 메우면 조용히 틀린다', () => {
    const noSide = { ...line('818', 1000, '차변'), side: undefined } as unknown as ReturnType<typeof line>;
    expect(journalizeTransfer(stmt([noSide, line('203', 1000, '대변')]), normalOf)).toBeNull();
  });

  it('자본을 차변에 세울 수 있다 — 기초 미지급이 이 모양이다', () => {
    // (차) 375 이월이익잉여금 / (대) 251 외상매입금. 375는 자본이라 정상은 대변인데 차변에 선다.
    const je = journalizeTransfer(stmt([line('375', 500_000, '차변'), line('251', 500_000, '대변')]), normalOf)!;
    expect(je).not.toBeNull();
    expect(je.lines.find(l => l.accountCode === '375')?.debit).toBe(500_000);
    expect(je.lines.find(l => l.accountCode === '251')?.credit).toBe(500_000);
  });
});
