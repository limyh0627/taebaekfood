import { describe, it, expect } from 'vitest';
import { journalizeStatement, journalizeCashEntry, buildOpeningEntry, settlementAccountCode, AR, AP, VAT_PAYABLE, VAT_RECEIVABLE, BANK } from './autoJournal';
import { isBalanced } from './journal';
import type { IssuedStatement, CashEntry } from './types';

const item = (o: Partial<IssuedStatement['items'][0]>): IssuedStatement['items'][0] =>
  ({ name: '', spec: '', qty: 1, price: 0, supply: 0, tax: 0, total: 0, isTaxExempt: false, ...o });

const stmt = (o: Partial<IssuedStatement>): IssuedStatement =>
  ({ id: 's1', issuedAt: '', tradeDate: '2026-07-01', type: '매출', partnerId: 'A', partnerName: '거래처', orderId: '', docNo: 'D1',
     totalSupply: 0, totalTax: 0, totalAmount: 0, items: [], ...o });

describe('매출 전표 → 분개', () => {
  const s = stmt({ type: '매출', totalSupply: 1_000_000, totalTax: 100_000, totalAmount: 1_100_000,
    items: [item({ accountCode: '800', supply: 1_000_000, tax: 100_000, total: 1_100_000 })] });
  const je = journalizeStatement(s)!;
  it('차 외상매출금 / 대 매출+부가세예수금, 차대 일치', () => {
    expect(isBalanced(je)).toBe(true);
    const ar = je.lines.find(l => l.accountCode === AR)!;
    expect(ar.debit).toBe(1_100_000);
    expect(ar.partnerId).toBe('A');
    expect(je.lines.find(l => l.accountCode === '800')!.credit).toBe(1_000_000);
    expect(je.lines.find(l => l.accountCode === VAT_PAYABLE)!.credit).toBe(100_000);
  });
  it('현금매출이면 채권 대신 통장', () => {
    const j = journalizeStatement(s, { cashAccountCode: '103' })!;
    expect(j.lines.find(l => l.accountCode === '103')!.debit).toBe(1_100_000);
    expect(j.lines.some(l => l.accountCode === AR)).toBe(false);
  });
});

describe('매입 전표 → 분개', () => {
  const s = stmt({ type: '매입', partnerId: 'B', totalSupply: 1_000_000, totalTax: 100_000, totalAmount: 1_100_000,
    items: [item({ accountCode: '500', supply: 1_000_000, tax: 100_000, total: 1_100_000 })] });
  const je = journalizeStatement(s)!;
  it('차 매입+부가세대급금 / 대 외상매입금, 차대 일치', () => {
    expect(isBalanced(je)).toBe(true);
    expect(je.lines.find(l => l.accountCode === '500')!.debit).toBe(1_000_000);
    expect(je.lines.find(l => l.accountCode === VAT_RECEIVABLE)!.debit).toBe(100_000);
    const ap = je.lines.find(l => l.accountCode === AP)!;
    expect(ap.credit).toBe(1_100_000);
    expect(ap.partnerId).toBe('B');
  });
});

describe('여러 계정·면세·미지정', () => {
  it('계정 여러개 묶고 차대 맞음', () => {
    const s = stmt({ type: '매입', totalSupply: 300, totalTax: 30, totalAmount: 330, items: [
      item({ accountCode: '500', supply: 100, tax: 10, total: 110 }),
      item({ accountCode: '505', supply: 200, tax: 20, total: 220 }),
    ] });
    const je = journalizeStatement(s)!;
    expect(isBalanced(je)).toBe(true);
    expect(je.lines.find(l => l.accountCode === '500')!.debit).toBe(100);
    expect(je.lines.find(l => l.accountCode === '505')!.debit).toBe(200);
  });
  it('면세(세액 0)면 부가세 줄 없음', () => {
    const s = stmt({ type: '매출', totalSupply: 1000, totalTax: 0, totalAmount: 1000,
      items: [item({ accountCode: '800', supply: 1000, tax: 0, total: 1000, isTaxExempt: true })] });
    const je = journalizeStatement(s)!;
    expect(je.lines.some(l => l.accountCode === VAT_PAYABLE)).toBe(false);
    expect(isBalanced(je)).toBe(true);
  });
  it('계정 미지정 라인 있으면 null', () => {
    const s = stmt({ type: '매입', items: [item({ supply: 100, total: 110 })] });
    expect(journalizeStatement(s)).toBeNull();
  });
  it('비용 타입 전표는 대상 아님', () => {
    expect(journalizeStatement(stmt({ type: '비용' as any }))).toBeNull();
  });
});

/**
 * 수금·지불이 물릴 계정 — 잘못 고르면 "수금했는데 미수가 그대로"가 된다.
 * 2026-08-13 논두렁 건이 기초전표(375 이월이익잉여금)를 그대로 물어 그렇게 됐다.
 */
describe('settlementAccountCode — 수금/지불 상대계정', () => {
  const G: Record<string, string> = { '800': '수익', '500': '비용', '375': '자본', '208': '자산', '108': '자산', '251': '부채' };
  const gt = (c: string) => G[c];

  it('매출 수금은 외상매출금, 매입 지불은 외상매입금', () => {
    expect(settlementAccountCode('매출', ['800'], gt)).toBe(AR);
    expect(settlementAccountCode('매입', ['500'], gt)).toBe(AP);
  });
  it('기초전표(375 자본)도 채권·채무로 상계한다 — 자본계정을 물면 미수가 안 준다', () => {
    expect(settlementAccountCode('매출', ['375'], gt)).toBe(AR);
    expect(settlementAccountCode('매입', ['375'], gt)).toBe(AP);
  });
  it('비유동자산만 달린 전표(기계 구입)는 그 자산계정을 유지한다 — 투자활동', () => {
    expect(settlementAccountCode('매입', ['208'], gt)).toBe('208');
  });
  it('자산이 섞여 있어도 계정이 여럿이면 미지정으로 둔다', () => {
    expect(settlementAccountCode('매입', ['208', '108'], gt)).toBe(AP);   // 채권·채무가 섞이면 상계
    expect(settlementAccountCode('매입', ['208', '146'], gt)).toBe(AP);   // 146은 그룹 미상 → 예외 아님
  });
  it('계정을 하나도 모르면 채권·채무로 간다', () => {
    expect(settlementAccountCode('매출', [], gt)).toBe(AR);
  });
});

describe('자금원장 CashEntry → 분개', () => {
  const ce = (o: Partial<CashEntry>): CashEntry => ({ id: 'c1', date: '2026-07-09', cashAccountId: 'main', dir: '출금', amount: 0, createdAt: '', ...o });
  it('출금(전기세): 차 전기세 / 대 보통예금', () => {
    const je = journalizeCashEntry(ce({ dir: '출금', amount: 1_200_000, accountCode: '520' }))!;
    expect(isBalanced(je)).toBe(true);
    expect(je.lines.find(l => l.accountCode === '520')!.debit).toBe(1_200_000);
    expect(je.lines.find(l => l.accountCode === BANK)!.credit).toBe(1_200_000);
  });
  it('입금: 차 보통예금 / 대 성격계정', () => {
    const je = journalizeCashEntry(ce({ dir: '입금', amount: 3_000_000, accountCode: '800' }))!;
    expect(je.lines.find(l => l.accountCode === BANK)!.debit).toBe(3_000_000);
    expect(je.lines.find(l => l.accountCode === '800')!.credit).toBe(3_000_000);
  });
  it('통장별 계정 매핑', () => {
    const je = journalizeCashEntry(ce({ dir: '출금', amount: 100, accountCode: '520', cashAccountId: 'card1' }), { card1: '650' })!;
    expect(je.lines.find(l => l.accountCode === '650')!.credit).toBe(100);
  });
  it('계정 없으면 null', () => {
    expect(journalizeCashEntry(ce({ amount: 100 }))).toBeNull();
  });
});

describe('기초분개', () => {
  const normalOf = (c: string) => (['103', '108'].includes(c) ? 'debit' : 'credit') as 'debit' | 'credit';
  it('자산−부채 차액을 자본으로 메워 균형', () => {
    const je = buildOpeningEntry({ date: '2026-07-01', lines: [
      { accountCode: '103', amount: 30_000_000 },   // 보통예금(자산)
      { accountCode: '108', amount: 20_000_000 },   // 외상매출금(자산)
      { accountCode: '251', amount: 10_000_000 },   // 외상매입금(부채)
    ] }, normalOf);
    expect(isBalanced(je)).toBe(true);
    // 자본 = 자산50 − 부채10 = 40
    expect(je.lines.find(l => l.accountCode === '331')!.credit).toBe(40_000_000);
  });
});
