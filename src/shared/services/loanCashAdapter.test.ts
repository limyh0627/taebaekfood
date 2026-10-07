import { expect, it } from 'vitest';
import type { CashEntry } from '../types';
import { loanCashInput } from './loanCashAdapter';
const contract = { id: 'loan-a', companyId: 'taebaek', accountCode: '293' };
const base = { id: 'cash-a', companyId: 'taebaek', loanId: 'loan-a', date: '2026-10-07', cashAccountId: 'bank-a', dir: '출금', amount: 105,
  lines: [{ accountCode: '293', amount: 100 }, { accountCode: '931', amount: 5 }] } as CashEntry;
it('상환 분할 입력은 실제 계약 원금과 표준 이자로 분리한다', () => {
  expect(loanCashInput('taebaek', base, contract)).toMatchObject({ action: '상환', principal: 100, interest: 5 });
});
it('차입 단일 원금 입력은 이자를 만들지 않는다', () => {
  expect(loanCashInput('taebaek', { ...base, dir: '입금', lines: undefined, accountCode: '293', amount: 100 }, contract)).toMatchObject({ action: '차입', principal: 100, interest: 0 });
});
for (const [name, entry, loan] of [
  ['다른 회사', { ...base, companyId: 'punghoe' }, contract],
  ['다른 계약계정', base, { ...contract, accountCode: '260' }],
  ['합계 불일치', { ...base, amount: 106 }, contract],
  ['다른 계정', { ...base, lines: [{ accountCode: '806', amount: 105 }] }, contract],
  ['입금 이자', { ...base, dir: '입금' }, contract],
  ['대체', { ...base, dir: '대체' }, contract],
] as const) it(`${name}는 추측 변환 없이 거절한다`, () => expect(() => loanCashInput('taebaek', entry as CashEntry, loan)).toThrow());
