import { describe, it, expect } from 'vitest';
import { issueDateOf, isIssueDay, autoVoucherId, canAutoIssue, buildCashVoucher, buildPurchaseVoucher } from './autoVoucher';
import type { FixedCostTemplate } from './types';

const tpl = (over: Partial<FixedCostTemplate> = {}): FixedCostTemplate => ({
  id: 'fct-rent', name: '임대료', amount: 2_500_000, category: '기타',
  active: false, kind: 'voucher', dir: '출금', mode: '일반',
  accountCode: '510', autoIssue: true, issueDay: 15, ...over,
} as FixedCostTemplate);

describe('발행일', () => {
  it('그 달의 그 날짜', () => {
    expect(issueDateOf('2026-08', 15)).toBe('2026-08-15');
  });
  it('31일은 말일로 — 2월도 30일인 달도 안 넘어간다', () => {
    expect(issueDateOf('2026-02', 31)).toBe('2026-02-28');
    expect(issueDateOf('2026-04', 31)).toBe('2026-04-30');
    expect(issueDateOf('2026-08', 31)).toBe('2026-08-31');
  });
  it('오늘이 발행일인지', () => {
    expect(isIssueDay('2026-08-15', tpl())).toBe(true);
    expect(isIssueDay('2026-08-14', tpl())).toBe(false);
  });
  it('같은 달엔 같은 id — 두 번 돌아도 한 건', () => {
    expect(autoVoucherId(tpl(), '2026-08')).toBe('AUTO-fct-rent-2026-08');
    expect(autoVoucherId(tpl(), '2026-09')).not.toBe(autoVoucherId(tpl(), '2026-08'));
  });
});

describe('자동 발행 대상 판정', () => {
  it('켜져 있고 금액이 있으면 나간다', () => {
    expect(canAutoIssue(tpl(), '2026-08')).toBe(true);
  });
  it('금액이 0이면 안 나간다 — 매달 다른 전기세를 자동으로 만들면 틀린 숫자가 남는다', () => {
    expect(canAutoIssue(tpl({ amount: 0 }), '2026-08')).toBe(false);
  });
  it('스위치가 꺼져 있으면 안 나간다', () => {
    expect(canAutoIssue(tpl({ autoIssue: false }), '2026-08')).toBe(false);
  });
  it('기간 밖이면 안 나간다', () => {
    expect(canAutoIssue(tpl({ startYm: '2026-09' }), '2026-08')).toBe(false);
    expect(canAutoIssue(tpl({ endYm: '2026-07' }), '2026-08')).toBe(false);
  });
  it('분리 발행인데 거래처가 없으면 안 나간다 — 미지급금을 걸 곳이 없다', () => {
    expect(canAutoIssue(tpl({ postMode: '분리' }), '2026-08')).toBe(false);
    expect(canAutoIssue(tpl({ postMode: '분리', partnerId: 'p1' }), '2026-08')).toBe(true);
  });
});

describe('합침 — 출금 자금전표', () => {
  it('(차) 비용 / (대) 통장 한 건', () => {
    const e = buildCashVoucher(tpl(), '2026-08');
    expect(e.id).toBe('AUTO-fct-rent-2026-08');
    expect(e.date).toBe('2026-08-15');
    expect(e.dir).toBe('출금');
    expect(e.amount).toBe(2_500_000);
    expect(e.accountCode).toBe('510');
  });
});

describe('분리 — 매입전표(채무만 세운다)', () => {
  it('과세면 금액에서 부가세를 갈라 잡는다', () => {
    const s = buildPurchaseVoucher(tpl({ postMode: '분리', partnerId: 'p1', partnerName: '㈜한성' }), '2026-08', { docNo: '2026-08-0099' });
    expect(s.type).toBe('매입');
    expect(s.totalAmount).toBe(2_500_000);
    expect(s.totalSupply).toBe(2_272_727);
    expect(s.totalTax).toBe(227_273);
    expect(s.totalSupply + s.totalTax).toBe(s.totalAmount);
    expect(s.partnerId).toBe('p1');
    expect(s.items[0].accountCode).toBe('510');
  });
  it('면세면 세액 0', () => {
    const s = buildPurchaseVoucher(tpl({ postMode: '분리', partnerId: 'p1', taxExempt: true }), '2026-08', { docNo: 'x' });
    expect(s.totalTax).toBe(0);
    expect(s.totalSupply).toBe(2_500_000);
  });
  it('자금전표와 id가 같다 — 어느 쪽으로 냈든 그 달 한 번', () => {
    const a = buildCashVoucher(tpl(), '2026-08');
    const b = buildPurchaseVoucher(tpl({ postMode: '분리', partnerId: 'p1' }), '2026-08', { docNo: 'x' });
    expect(a.id).toBe(b.id);
  });
});
