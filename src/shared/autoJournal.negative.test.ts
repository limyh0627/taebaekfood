// 할인·반품 줄(단가 또는 수량이 마이너스)만 담긴 전표도 분개가 서야 한다.
//  발행 가드가 price<=0을 통째로 막던 시절엔 이런 전표를 아예 만들 수 없었다.
import { describe, it, expect } from 'vitest';
import { journalizeStatement } from './autoJournal';
import type { IssuedStatement } from './types';

// 할인/반품 단품 전표: 단가 -5,000 × 수량 10 (부가세 포함 단가)
const gross = -50000;
const supply = Math.round(gross / 1.1);      // -45455
const tax = gross - supply;                  // -4545

const stmt = {
  id: 'stmt-neg', issuedAt: '', tradeDate: '2026-08-19', type: '매출',
  partnerId: 'p1', partnerName: '테스트상사', docNo: '2026-08-0001',
  totalSupply: supply, totalTax: tax, totalAmount: gross,
  items: [{ name: '반품', spec: '', qty: 10, price: -5000, supply, tax, total: gross, isTaxExempt: false, accountCode: '800' }],
} as unknown as IssuedStatement;

describe('음수(할인·반품) 전표', () => {
  it('분개가 만들어지고 차변합=대변합', () => {
    const je = journalizeStatement(stmt);
    expect(je).not.toBeNull();
    const d = je!.lines.reduce((a, l) => a + l.debit, 0);
    const c = je!.lines.reduce((a, l) => a + l.credit, 0);
    console.log('  lines:', JSON.stringify(je!.lines));
    console.log(`  차변합=${d} 대변합=${c}`);
    expect(d).toBe(c);
  });

  it('매출·부가세 줄이 누락되지 않는다', () => {
    const je = journalizeStatement(stmt)!;
    expect(je.lines.find(l => l.accountCode === '800')).toBeTruthy();
    expect(je.lines.find(l => l.accountCode === '255')).toBeTruthy();
  });
});
