/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CashLedger from './CashLedger';
import { journalizeCashEntry } from '../src/shared/autoJournal';
import type { CashAccount, CashEntry } from '../src/shared/types';
import { today } from '../src/shared/day';

afterEach(cleanup);
const account: CashAccount = { id: 'bank', companyId: 'taebaek', name: '확인된 통장', type: '통장', active: true,
  openingBalance: 1000, openingDate: '2020-01-01', createdAt: '' };
const unknown: CashEntry = { id: 'legacy-loan', companyId: 'taebaek', loanId: 'loan', cashAccountId: '',
  date: '2020-08-05', createdAt: '', dir: '출금', amount: 110, note: '과거 대출 상환',
  lines: [{ accountCode: '260', amount: 100 }, { accountCode: '951', amount: 10 }] };
const props = { companyId: 'taebaek' as const, accountCodes: [], partners: [], issuedStatements: [], settlements: [],
  onAddCashAccount: vi.fn(), onUpdateCashAccount: vi.fn(), onAddCashEntry: vi.fn(), onDeleteCashEntry: vi.fn(),
  onAddSettlement: vi.fn(), onDeleteSettlement: vi.fn() };

it('실제 통장과 함께 공란 상환을 표시하되 실제 잔액에 합치지 않고103 분개를 보존한다', () => {
  render(<CashLedger {...props} cashAccounts={[account]} cashEntries={[unknown,
    { ...unknown, id: 'known', cashAccountId: 'bank', date: today(), amount: 20, note: '통장 거래', lines: undefined },
    { ...unknown, id: 'foreign', companyId: 'punghoe', note: '다른 회사 상환' }]} />);
  const section = screen.getByRole('region', { name: '계좌 미지정' });
  expect(within(section).getByText('과거 대출 상환')).toBeTruthy();
  expect(section.textContent).toContain('110');
  expect(section.textContent).not.toContain('다른 회사 상환');
  expect(section.textContent).not.toContain('현재 잔액');
  expect(screen.getByRole('button', { name: /확인된 통장/ }).textContent).toContain('980');
  expect(journalizeCashEntry(unknown)?.lines).toMatchObject([
    { accountCode: '260', debit: 100, credit: 0 }, { accountCode: '951', debit: 10, credit: 0 },
    { accountCode: '103', debit: 0, credit: 110 },
  ]);
});

it('계좌가 없어도 공란 기록을 숨기지 않으며 가상계좌 새입력 버튼을 만들지 않는다', () => {
  const view = render(<CashLedger {...props} cashAccounts={[]} cashEntries={[unknown]} />);
  expect(within(screen.getByRole('region', { name: '계좌 미지정' })).getByText('과거 대출 상환')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /입출금 기록/ })).toBeNull();
  expect(screen.getByRole('button', { name: '계좌 등록' })).toBeTruthy();
  view.rerender(<CashLedger {...props} companyId="punghoe" cashAccounts={[]} cashEntries={[unknown]} />);
  expect(screen.queryByText('과거 대출 상환')).toBeNull();
});
