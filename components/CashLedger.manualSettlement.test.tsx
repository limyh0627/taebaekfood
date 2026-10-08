/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MatchModal } from './CashLedger';
import type { CashEntry, IssuedStatement, Settlement } from '../src/shared/types';
const entry = { id: 'cash', companyId: 'taebaek', cashAccountId: 'bank', partnerId: 'p', partnerName: '합성 거래처', date: '2026-10-07', dir: '입금', amount: 100, accountCode: '108', createdAt: '' } as CashEntry;
const statement = { id: 'statement', companyId: 'taebaek', partnerId: 'p', partnerName: '합성 거래처', tradeDate: '2026-10-07', type: '매출', docNo: '261007-001', totalAmount: 100, totalSupply: 100, totalTax: 0, issuedAt: '', orderId: '', items: [{ name: '합성 상품', spec: '', qty: 1, price: 100, supply: 100, tax: 0, total: 100, accountCode: '800' }] } as IssuedStatement;
const settlement = { id: 'manual-existing', companyId: 'taebaek', cashEntryId: entry.id, statementId: statement.id, amount: 60, createdAt: '' } as Settlement;
const base = { entry, statements: [statement], settlements: [] as Settlement[], cashEntries: [entry], onClose: vi.fn(), onAdd: vi.fn(), onDelete: vi.fn() };
describe('수동 매칭 저장 UI', () => {
  it('attach는 저장을 기다리고 중복 클릭·닫기를 막으며 실패 후 같은 화면에서 재시도한다', async () => {
    let reject!: (value: Error) => void;
    const onAdd = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
    const onClose = vi.fn(); render(<MatchModal {...base} onAdd={onAdd} onClose={onClose} />);
    const attach = screen.getByRole('button', { name: /100 상계/ });
    fireEvent.click(attach); fireEvent.click(attach);
    expect(attach).toBeDisabled(); expect(onAdd).toHaveBeenCalledTimes(1);
    const close = screen.getAllByRole('button').find(button => button.getAttribute('aria-label')?.includes('닫기'));
    if (close) fireEvent.click(close);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => reject(new Error('정산 한도 변경')));
    expect(screen.getByRole('alert')).toHaveTextContent('정산 한도 변경'); expect(attach).toBeEnabled();
    fireEvent.click(attach); await waitFor(() => expect(attach).toBeEnabled());
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(onAdd.mock.calls[1][0]).toMatchObject({ cashEntryId: 'cash', statementId: 'statement', amount: 100 });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('해제는 실패하면 기존 매칭을 보존하고 동일 행으로 다시 시도한다', async () => {
    const onDelete = vi.fn().mockRejectedValueOnce(new Error('연결 변경')).mockResolvedValue(undefined);
    render(<MatchModal {...base} settlements={[settlement]} onDelete={onDelete} />);
    const remove = screen.getByRole('button', { name: '261007-001 매칭 해제' });
    fireEvent.click(remove);
    expect(await screen.findByRole('alert')).toHaveTextContent('연결 변경');
    expect(screen.getByText('60')).toBeInTheDocument();
    fireEvent.click(remove); await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2));
    expect(onDelete.mock.calls).toEqual([['manual-existing'], ['manual-existing']]);
  });
  it('회사 화면 종료 뒤 늦은 실패를 새 매칭 모달로 전달하지 않는다', async () => {
    let reject!: (value: Error) => void;
    const onAdd = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const { rerender } = render(<MatchModal key="taebaek:cash" {...base} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /100 상계/ }));
    rerender(<MatchModal key="punghoe:other" {...base} entry={{ ...entry, id: 'other', companyId: 'punghoe' }} />);
    await act(async () => reject(new Error('옛 회사 실패')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /100 상계/ })).toBeEnabled();
  });
});
