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
  { id: '263', code: '263', name: '미지급급여', type: '부채', normalBalance: 'credit', groupId: 'g-liab' },
  { id: '261', code: '261', name: '미지급세금', type: '부채', normalBalance: 'credit', groupId: 'g-liab' },
  { id: '259', code: '259', name: '선수금', type: '부채', normalBalance: 'credit', groupId: 'g-liab' },
  { id: '295', code: '295', name: '퇴직급여충당부채', type: '부채', normalBalance: 'credit', groupId: 'g-liab' },
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

describe('영업부채는 재무가 아니다 — 부채라고 다 재무로 찍으면 안 된다', () => {
  /**
   * cfSectionOf는 그룹 성격만 봐서 부채=재무로 찍는다. 그래서 급여를 지급하면
   * 12,860,310원이 **재무활동**에 섰다(2026-08 실제 데이터). 갚을 상대가 있느냐가
   * 아니라 **무엇 때문에 생긴 빚이냐**가 갈래를 정한다 — 급여·세금·선수금은 영업이다.
   */
  it('미지급급여 지급은 영업활동', () => {
    const r = run([je('j1', '2026-08-10', [
      { accountCode: '263', debit: 12_860_310 },
      { accountCode: '103', credit: 12_860_310 },
    ])]);
    expect(r.op).toBe(-12_860_310);
    expect(r.fin).toBe(0);
  });

  it('미지급세금·선수금·퇴직급여충당부채도 영업활동', () => {
    const r = run([
      je('j2', '2026-08-11', [{ accountCode: '261', debit: 3_000_000 }, { accountCode: '103', credit: 3_000_000 }]),
      je('j3', '2026-08-12', [{ accountCode: '103', debit: 1_000_000 }, { accountCode: '259', credit: 1_000_000 }]),
      je('j4', '2026-08-13', [{ accountCode: '295', debit: 500_000 }, { accountCode: '103', credit: 500_000 }]),
    ]);
    expect(r.op).toBe(-2_500_000);   // −3,000,000 +1,000,000 −500,000
    expect(r.fin).toBe(0);
  });

  it('차입금은 그대로 재무 — 영업으로 끌어오지 않는다', () => {
    const r = run([je('j5', '2026-08-14', [
      { accountCode: '260', debit: 2_770_000 },
      { accountCode: '103', credit: 2_770_000 },
    ])]);
    expect(r.fin).toBe(-2_770_000);
    expect(r.op).toBe(0);
  });

  it('총 현금흐름은 갈래를 어떻게 나눠도 현금계정 증감과 같다', () => {
    const r = run([
      je('j6', '2026-08-15', [{ accountCode: '263', debit: 1_000_000 }, { accountCode: '103', credit: 1_000_000 }]),
      je('j7', '2026-08-16', [{ accountCode: '260', debit: 2_000_000 }, { accountCode: '103', credit: 2_000_000 }]),
      je('j8', '2026-08-17', [{ accountCode: '206', debit: 3_000_000 }, { accountCode: '103', credit: 3_000_000 }]),
    ]);
    expect(r.net).toBe(-6_000_000);
    expect(r.op + r.inv + r.fin).toBe(r.net);
  });
});
