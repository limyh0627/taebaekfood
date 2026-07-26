import { describe, it, expect } from 'vitest';
import { journalizeStatement, AR, AP, VAT_PAYABLE, VAT_RECEIVABLE } from './autoJournal';
import { isBalanced } from './journal';
import type { IssuedStatement } from './types';

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
