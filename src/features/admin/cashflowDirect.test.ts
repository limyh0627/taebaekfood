import { describe, it, expect } from 'vitest';
import { computeCashFlowDirect } from './financials';
import type { AccountCode, AccountGroup, JournalEntry } from '../../shared/types';

const groups: AccountGroup[] = [
  { id: 'g-asset', name: '자산', type: '자산' },
  { id: 'g-liab', name: '부채', type: '부채' },
  { id: 'g-rev', name: '총매출', type: '수익', plLine: 'revenue' },
  { id: 'g-other-exp', name: '영업외비용', type: '비용', plLine: 'other-expense' },
  { id: 'g-sgna', name: '판관비', type: '비용', plLine: 'sgna' },
];
const accounts: AccountCode[] = [
  { id: '103', code: '103', name: '보통예금', type: '자산', normalBalance: 'debit', groupId: 'g-asset', isCash: true },
  { id: '101', code: '101', name: '현금', type: '자산', normalBalance: 'debit', groupId: 'g-asset', isCash: true },
  { id: '108', code: '108', name: '외상매출금', type: '자산', normalBalance: 'debit', groupId: 'g-asset' },
  { id: '206', code: '206', name: '기계장치', type: '자산', normalBalance: 'debit', groupId: 'g-asset' },
  { id: '260', code: '260', name: '단기차입금', type: '부채', normalBalance: 'credit', groupId: 'g-liab' },
  { id: '951', code: '951', name: '이자비용', type: '비용', normalBalance: 'debit', groupId: 'g-other-exp' },
  { id: '520', code: '520', name: '전력비', type: '비용', normalBalance: 'debit', groupId: 'g-sgna' },
] as AccountCode[];
const gById = new Map(groups.map(g => [g.id, g]));
const codeToGroup = (c?: string) => gById.get(accounts.find(a => a.code === c)?.groupId ?? '');

const je = (id: string, date: string, lines: { accountCode: string; debit?: number; credit?: number }[]): JournalEntry => ({
  id, date, sourceType: '자금', createdAt: '', lines: lines.map(l => ({ ...l, debit: l.debit ?? 0, credit: l.credit ?? 0 })),
});
const run = (entries: JournalEntry[]) => computeCashFlowDirect('2026-08', entries, accounts, codeToGroup);

describe('computeCashFlowDirect', () => {
  it('대출상환 — 한 분개의 원금은 재무, 이자는 영업으로 갈린다', () => {
    const r = run([je('1', '2026-08-08', [
      { accountCode: '260', debit: 30_000 },
      { accountCode: '951', debit: 3_000_000 },
      { accountCode: '103', credit: 3_030_000 },
    ])]);
    expect(r.finOut).toBe(30_000);
    expect(r.opOut).toBe(3_000_000);
    expect(r.net).toBe(-3_030_000);          // 실제 통장 증감과 일치
  });

  it('수금 — 외상매출금은 영업(자산이라고 투자로 가면 안 된다)', () => {
    const r = run([je('2', '2026-08-02', [
      { accountCode: '103', debit: 1_000_000 },
      { accountCode: '108', credit: 1_000_000 },
    ])]);
    expect(r.opIn).toBe(1_000_000);
    expect(r.invIn).toBe(0);
    expect(r.net).toBe(1_000_000);
  });

  it('기계 구입은 투자활동', () => {
    const r = run([je('3', '2026-08-03', [
      { accountCode: '206', debit: 5_000_000 },
      { accountCode: '103', credit: 5_000_000 },
    ])]);
    expect(r.invOut).toBe(5_000_000);
    expect(r.op).toBe(0);
  });

  it('현금이 안 움직인 분개(대체)는 아예 안 들어온다', () => {
    const r = run([je('4', '2026-08-04', [
      { accountCode: '951', debit: 500_000 },
      { accountCode: '260', credit: 500_000 },
    ])]);
    expect(r.net).toBe(0);
    expect(r.lines).toHaveLength(0);
  });

  it('계좌 간 이체는 순증감 0이라 제외된다', () => {
    const r = run([je('5', '2026-08-05', [
      { accountCode: '101', debit: 200_000 },
      { accountCode: '103', credit: 200_000 },
    ])]);
    expect(r.net).toBe(0);
    expect(r.lines).toHaveLength(0);
  });

  it('다른 달은 안 센다', () => {
    const r = run([je('6', '2026-07-31', [
      { accountCode: '520', debit: 100_000 },
      { accountCode: '103', credit: 100_000 },
    ])]);
    expect(r.net).toBe(0);
  });

  it('순현금흐름 = 영업+투자+재무, 상대계정별 내역도 나온다', () => {
    const r = run([
      je('7', '2026-08-01', [{ accountCode: '103', debit: 1_000_000 }, { accountCode: '108', credit: 1_000_000 }]),
      je('8', '2026-08-02', [{ accountCode: '520', debit: 300_000 }, { accountCode: '103', credit: 300_000 }]),
      je('9', '2026-08-03', [{ accountCode: '260', debit: 100_000 }, { accountCode: '103', credit: 100_000 }]),
    ]);
    expect(r.op).toBe(700_000);
    expect(r.fin).toBe(-100_000);
    expect(r.net).toBe(600_000);
    expect(r.net).toBe(r.op + r.inv + r.fin);
    expect(r.lines.map(l => l.accountCode)).toContain('520');
  });
});
