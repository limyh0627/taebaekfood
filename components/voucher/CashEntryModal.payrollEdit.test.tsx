// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CashEntryModal from './CashEntryModal';
import type { CashEntry, AccountCode } from '../../src/shared/types';
const entry = { id: 'cash', companyId: 'taebaek', dir: '출금', date: '2026-10-08', amount: 9000,
  note: '급여', lines: [{ accountCode: '802', amount: 10000 }, { accountCode: '254', amount: -1000 }] } as CashEntry;
const draft = { yearMonth: '2026-10', payDate: entry.date, expectedRevision: 4,
  lines: [{ employeeId: 'employee', employeeName: '합성 사원', base: 10000, incomeTax: 1000 }] };
function open(save = vi.fn(async () => {}), extra: Partial<React.ComponentProps<typeof CashEntryModal>> = {}) {
  const close = vi.fn();
  render(<CashEntryModal mode={{ kind: '수정', entry }} companyId="taebaek" partners={[]}
    accountCodes={[{ id: 'salary', code: '802', name: '급여' }] as AccountCode[]}
    cashAccounts={[]} accountId="" onAccountId={vi.fn()} partnerBalances={new Map()} getBalance={() => 0}
    latestStatement={() => undefined} onClose={close} onSettle={vi.fn()} onSaveEdit={save} payrollEdit={draft} {...extra} />);
  return { save, close };
}
describe('cash payroll editing retains the complete source draft', () => {
  it('confirms the saved request instead of resubmitting the reopened editor draft', async () => {
    const resume = vi.fn(async () => {});
    const { save, close } = open(undefined, { onResumeEntry: resume, hasPendingRequest: () => true });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '이전 변경 결과 확인' })); });
    expect(resume).toHaveBeenCalledWith(entry.id);
    expect(save).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
  it('sends employee edits and the originally read revision, with the chosen payment date', async () => {
    const { save } = open();
    const row = screen.getByText('합성 사원').closest('tr')!;
    fireEvent.change(within(row).getAllByRole('textbox')[0], { target: { value: '12,000' } });
    fireEvent.change(document.querySelector('input[type=date]')!, { target: { value: '2026-10-09' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '저장' })); });
    expect(save).toHaveBeenCalledWith(entry, expect.objectContaining({ date: '2026-10-09' }), expect.any(Array),
      { ...draft, payDate: '2026-10-09', lines: [{ ...draft.lines[0], base: 12000 }] }, undefined);
    expect(screen.getByDisplayValue('11000')).toHaveProperty('readOnly', true);
  });
  it('keeps the employee draft on failure and prevents a second save while pending', async () => {
    let reject!: (error: Error) => void;
    const save = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const notice = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { close } = open(save);
    const row = screen.getByText('합성 사원').closest('tr')!;
    fireEvent.change(within(row).getAllByRole('textbox')[0], { target: { value: '15,000' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { reject(new Error('확인 필요')); });
    expect(screen.getByDisplayValue('15,000')).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('확인 필요'));
    notice.mockRestore();
  });
});
describe('two-company cash editor keeps the authorized counterpart snapshot', () => {
  it('sends both sides with one date and amount while retaining the counterpart revision and hash', async () => {
    const source = { ...entry, amount: 10000, accountCode: '133', lines: [] };
    const counterpart = { ...source, id: 'other', companyId: 'punghoe' as const, dir: '입금' as const,
      partnerName: '상대 회사', lines: [{ accountCode: '254', amount: 10000 }] };
    const prepared = { counterpart, expectedRevision: 3, expectedCashHash: 'a'.repeat(64) };
    const { save } = open(undefined, { mode: { kind: '수정', entry: source }, payrollEdit: undefined, transferEdit: prepared });
    fireEvent.change(screen.getAllByDisplayValue('10000').find(input => !input.hasAttribute('aria-label'))!, { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText('상대 분개 1 금액'), { target: { value: '12000' } });
    fireEvent.change(document.querySelector('input[type=date]')!, { target: { value: '2026-10-09' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '저장' })); });
    expect(save).toHaveBeenCalledWith(source, expect.objectContaining({ amount: '12000', date: '2026-10-09' }), [], undefined,
      { counterpartId: 'other', expectedRevision: 3, expectedCashHash: 'a'.repeat(64), patch: {
        amount: 12000, date: '2026-10-09', note: '급여', accountCode: '', lines: [{ accountCode: '254', amount: 12000, note: undefined }] } });
  });
});
