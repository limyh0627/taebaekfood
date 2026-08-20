import { describe, it, expect } from 'vitest';
import { journalizeCashEntry } from './autoJournal';
import { partnerPaid, signedAmount } from '../features/admin/cashLedger';
import type { CashEntry } from './types';

/**
 * 미수 ↔ 미지급 상계 — 대체전표 한 건.
 *
 *   (차) 251 외상매입금 / (대) 108 외상매출금.  현금은 안 움직인다.
 *
 * 예전엔 입금 108 + 출금 251 **두 건**으로 적었다. 계좌를 안 붙였는데도 분개가
 * 계좌 빈 자리를 보통예금으로 메워서, 실제로 오간 적 없는 금액이 103 원장에
 * 차·대 두 줄로 남았다. 잔액은 상쇄돼 안 틀어져도 원장이 더러워진다.
 */

const offset = (amt: number): CashEntry => ({
  id: 'cash-1-offset', date: '2026-08-19', cashAccountId: '',
  dir: '대체', amount: amt,
  partnerId: 'p-han', partnerName: '한중교역',
  lines: [
    { accountCode: '251', amount: amt },    // 차변
    { accountCode: '108', amount: -amt },   // 대변
  ],
  note: '한중교역 미수·미지급 상계',
  createdAt: '2026-08-19T08:04:23.248Z',
} as CashEntry);

describe('상계 — 분개', () => {
  it('통장 줄이 없다 — 보통예금이 안 나온다', () => {
    const je = journalizeCashEntry(offset(9370000))!;
    expect(je.lines).toHaveLength(2);
    expect(je.lines.some(l => l.accountCode === '103')).toBe(false);
  });

  it('(차) 251 외상매입금 / (대) 108 외상매출금', () => {
    const je = journalizeCashEntry(offset(9370000))!;
    expect(je.lines).toEqual([
      expect.objectContaining({ accountCode: '251', debit: 9370000, credit: 0, partnerId: 'p-han' }),
      expect.objectContaining({ accountCode: '108', debit: 0, credit: 9370000, partnerId: 'p-han' }),
    ]);
  });

  it('차·대가 안 맞으면 분개를 안 만든다 — 반쪽 전표가 더 나쁘다', () => {
    const broken = { ...offset(100), lines: [{ accountCode: '251', amount: 100 }, { accountCode: '108', amount: -60 }] } as CashEntry;
    expect(journalizeCashEntry(broken)).toBeNull();
  });

  it('옛 방식(입금 108, 계좌 없음)은 보통예금으로 폴백한다 — 이게 고친 이유', () => {
    const old = { id: 'c-old', date: '2026-08-19', cashAccountId: '', dir: '입금', amount: 9370000, accountCode: '108', createdAt: '' } as CashEntry;
    const je = journalizeCashEntry(old)!;
    expect(je.lines[0]).toMatchObject({ accountCode: '103', debit: 9370000 });
  });
});

describe('상계 — 잔액', () => {
  it('통장 잔액은 안 건드린다', () => {
    expect(signedAmount(offset(9370000))).toBe(0);
  });

  it('미수와 미지급이 **양쪽 다** 준다 — 한 건으로 둘을 턴다', () => {
    const es = [offset(9370000)];
    expect(partnerPaid('p-han', '매출', es)).toBe(9370000);   // 받을 돈 감소
    expect(partnerPaid('p-han', '매입', es)).toBe(9370000);   // 줄 돈 감소
  });

  it('다른 거래처는 안 건드린다', () => {
    expect(partnerPaid('p-other', '매출', [offset(9370000)])).toBe(0);
  });

  it('보통 수금·지불은 그대로다 — 한쪽만 준다', () => {
    const pay = { id: 'c2', date: '2026-08-19', cashAccountId: 'bank1', dir: '입금', amount: 500000, accountCode: '108', partnerId: 'p-han', createdAt: '' } as CashEntry;
    expect(partnerPaid('p-han', '매출', [pay])).toBe(500000);
    expect(partnerPaid('p-han', '매입', [pay])).toBe(0);
    expect(signedAmount(pay)).toBe(500000);
  });
});
