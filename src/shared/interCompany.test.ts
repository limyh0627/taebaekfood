import { describe, it, expect } from 'vitest';
import {
  buildTransfer, splitTransfer, interCompanyBalance,
  AR, AP, PREPAID, ADVANCE_IN, LOAN_OUT, LOAN_IN,
} from './interCompany';
import { journalizeCashEntry } from './autoJournal';

const send = (amount: number, payable: number, overKind?: '선급금' | '대여금') => buildTransfer({
  from: 'taebaek', to: 'punghoe', date: '2026-08-20', amount,
  payableToTarget: payable, overKind,
  fromPartnerId: 'p-punghoe', fromPartnerName: '풍회유통',
  toPartnerId: 'p-taebaek', toPartnerName: '태백푸드',
});

const lineOf = (e: any, code: string) =>
  (e.lines ?? []).find((l: any) => l.accountCode === code)?.amount
  ?? (e.accountCode === code ? e.amount : 0);

describe('보낸 돈 가르기 — 미지급부터 턴다', () => {
  it('미지급보다 적으면 전액 상계', () => {
    expect(splitTransfer(5_000_000, 16_760_820)).toEqual({ offset: 5_000_000, over: 0, overKind: '선급금' });
  });
  it('미지급을 넘으면 넘는 만큼만 선급금', () => {
    expect(splitTransfer(20_000_000, 16_760_820)).toEqual({ offset: 16_760_820, over: 3_239_180, overKind: '선급금' });
  });
  it('미지급이 없으면 전액 선급금', () => {
    expect(splitTransfer(5_000_000, 0)).toEqual({ offset: 0, over: 5_000_000, overKind: '선급금' });
  });
});

describe('회사 간 이체 — 두 장부에 대칭으로', () => {
  it('미지급 상계 + 선급금', () => {
    const t = send(20_000_000, 16_760_820);
    expect(lineOf(t.out, AP)).toBe(16_760_820);       // 태백 채무가 준다
    expect(lineOf(t.out, PREPAID)).toBe(3_239_180);   // 넘는 건 미리 준 것
    expect(lineOf(t.in, AR)).toBe(16_760_820);        // 풍회 채권이 준다
    expect(lineOf(t.in, ADVANCE_IN)).toBe(3_239_180); // 넘는 건 미리 받은 것
  });

  it('대여금으로 고르면 양쪽이 대여·차입', () => {
    const t = send(5_000_000, 0, '대여금');
    expect(lineOf(t.out, LOAN_OUT)).toBe(5_000_000);
    expect(lineOf(t.in, LOAN_IN)).toBe(5_000_000);
  });

  it('두 건 다 차·대가 맞고 합계가 보낸 금액과 같다', () => {
    const t = send(20_000_000, 16_760_820);
    for (const e of [t.out, t.in]) {
      const je = journalizeCashEntry(e)!;
      const d = je.lines.reduce((a, l) => a + (l.debit ?? 0), 0);
      const c = je.lines.reduce((a, l) => a + (l.credit ?? 0), 0);
      expect(d).toBe(c);
      expect(d).toBe(20_000_000);
    }
  });

  it('채권·채무가 거래처에 붙는다 — 안 붙으면 잔액이 안 준다', () => {
    const t = send(5_000_000, 5_000_000);
    expect(t.out.partnerId).toBe('p-punghoe');
    expect(t.in.partnerId).toBe('p-taebaek');
  });

  it('회사가 각각 찍힌다', () => {
    const t = send(1_000_000, 0);
    expect(t.out.companyId).toBe('taebaek');
    expect(t.in.companyId).toBe('punghoe');
  });

  it('대여·차입 잔액은 양쪽이 같다 — 선급금은 안 센다', () => {
    const a = send(5_000_000, 0, '대여금');
    const b = send(3_000_000, 0, '선급금');
    const cash = [a.out, a.in, b.out, b.in];
    expect(interCompanyBalance('taebaek', cash)).toBe(5_000_000);
    expect(interCompanyBalance('punghoe', cash)).toBe(5_000_000);
  });
});
