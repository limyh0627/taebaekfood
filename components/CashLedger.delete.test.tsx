/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { appConfirm } from '../src/shared/components/appDialog';
import { today } from '../src/shared/day';
import type { CashEntry } from '../types';
import CashLedger from './CashLedger';
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: vi.fn(), appNotice: vi.fn() }));
vi.mock('../src/shared/useLoanContracts', () => ({ useLoanContracts: () => [] }));

it('자금원장의 같은 행을 연속 삭제해도 확인과 삭제는 한 번씩 실행한다', async () => {
  let resolve!: (answer: boolean) => void;
  vi.mocked(appConfirm).mockImplementation(() => new Promise(done => { resolve = done; }));
  const remove = vi.fn();
  render(<CashLedger companyId="taebaek" cashAccounts={[{ id: 'bank', name: '통장', type: '통장',
    openingBalance: 0, openingDate: '2026-01-01', active: true, createdAt: '2026-01-01' }]}
    cashEntries={[{ id: 'cash1', date: today(), dir: '입금', amount: 100, cashAccountId: 'bank',
      accountCode: '108', note: '수금 시험' } as CashEntry]} accountCodes={[]} partners={[]}
    issuedStatements={[]} settlements={[]} onAddCashAccount={vi.fn()} onUpdateCashAccount={vi.fn()}
    onAddCashEntry={vi.fn()} onDeleteCashEntry={remove} onAddSettlement={vi.fn()} onDeleteSettlement={vi.fn()} />);
  const button = screen.getByRole('button', { name: '거래 삭제' });
  fireEvent.click(button); fireEvent.click(button);
  expect(appConfirm).toHaveBeenCalledOnce();
  await act(async () => resolve(true));
  expect(remove).toHaveBeenCalledExactlyOnceWith('cash1');
});
