/** @vitest-environment jsdom */
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TradeStatement from './TradeStatement';
import { today } from '../src/shared/day';
import type { IssuedStatement } from '../src/shared/types';
const mocks = vi.hoisted(() => ({ forget: vi.fn(), notice: vi.fn(async () => {}) }));
vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection: vi.fn(async () => []) }));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: vi.fn(async () => true), appPrompt: vi.fn(async () => null), appNotice: mocks.notice }));
vi.mock('../src/features/admin/useVoucherLedger', () => ({ useVoucherLedger: ({ issuedStatements }: any) => ({ mergedStatements: issuedStatements, journalBySource: new Map(), partnerBalances: new Map(), getBalance: () => 0, canSettle: () => false, isVouchered: () => false, isFetchingHistory: false, forgetStatement: mocks.forget }) }));
vi.mock('../src/features/statements/ui/StatementTradeRow', () => ({ StatementTradeTableRow: ({ statement, onOpen }: any) => <tr><td><button onClick={onOpen}>{statement.docNo} 열기</button></td></tr>, StatementTradeMobileRow: () => null }));
vi.mock('./CashLedger', () => ({ AccountModal: () => null }));
vi.mock('./voucher/VoucherComposer', () => ({ default: () => null }));
const stmt = (id: string) => ({ id, companyId: 'taebaek', type: '매출', docNo: id, partnerId: 'p', partnerName: id, tradeDate: today(), issuedAt: new Date().toISOString(), totalAmount: 1000, orderId: '', totalSupply: 1000, totalTax: 0, items: [{ name: '품목', qty: 1, price: 1000, supply: 1000, tax: 0, total: 1000 }] } as IssuedStatement);
function deferred() { let resolve!: () => void; let reject!: (e: Error) => void; const promise = new Promise<void>((a,b) => { resolve=a;reject=b; }); return { promise,resolve,reject }; }
function setup(remove?: (id: string) => Promise<void>) {
  const settlement = vi.fn();
  const props = { orders: [], allItems: [], partners: [], partnerItems: [], issuedStatements: [stmt('A'),stmt('B')], settlements: [{ id: 'settlement-a', cashEntryId: 'cash-a', statementId: 'A', amount: 100, createdAt: new Date().toISOString() }], onDeleteIssuedStatement: remove, onDeleteSettlement: settlement };
  const rendered = render(<TradeStatement {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'A 열기' }));
  return { ...rendered, props, settlement };
}
beforeEach(() => { vi.clearAllMocks(); });
it('삭제 대기와 실패는 전표 내용을 유지하며 중복 클릭은 한 번만 요청한다', async () => {
  const pending = deferred(); const remove = vi.fn(() => pending.promise); const { settlement } = setup(remove);
  fireEvent.click(screen.getByRole('button', { name: '삭제' }));
  await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(mocks.forget).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '삭제' }));
  await act(async () => { pending.reject(new Error('저장 권한 거부')); });
  expect(remove).toHaveBeenCalledOnce(); expect(mocks.forget).not.toHaveBeenCalled(); expect(settlement).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(mocks.notice).toHaveBeenCalledWith(expect.stringContaining('저장 권한 거부'));
});
it('원자 삭제 성공 후에만 전표를 잊고 같은 화면을 닫는다', async () => {
  const pending = deferred(); const remove = vi.fn(() => pending.promise); setup(remove);
  fireEvent.click(screen.getByRole('button', { name: '삭제' })); await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  await act(async () => pending.resolve());
  expect(mocks.forget).toHaveBeenCalledWith('A'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('삭제 콜백이 없으면 성공으로 처리하거나 내용을 닫지 않는다', async () => {
  setup(); fireEvent.click(screen.getByRole('button', { name: '삭제' }));
  await waitFor(() => expect(mocks.notice).toHaveBeenCalled());
  expect(mocks.forget).not.toHaveBeenCalled(); expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('삭제 대기 중 다른 전표를 열면 이전 완료가 새 전표 화면을 닫지 않는다', async () => {
  const pending = deferred(); const remove = vi.fn(() => pending.promise); setup(remove);
  fireEvent.click(screen.getByRole('button', { name: '삭제' })); await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '전표 작성 닫기' }));
  fireEvent.click(screen.getByRole('button', { name: 'B 열기' }));
  await act(async () => pending.resolve());
  expect(mocks.forget).toHaveBeenCalledWith('A');
  expect(screen.getByRole('dialog')).toHaveTextContent('B');
});
it('삭제 대기 중 회사가 바뀌면 새 회사 화면이나 원장을 변경하지 않는다', async () => {
  const pending = deferred(); const remove = vi.fn(() => pending.promise); const { rerender, props } = setup(remove);
  fireEvent.click(screen.getByRole('button', { name: '삭제' })); await waitFor(() => expect(remove).toHaveBeenCalledOnce());
  rerender(<TradeStatement {...props} companyId="punghoe" />);
  await act(async () => pending.resolve());
  expect(mocks.forget).not.toHaveBeenCalled(); expect(screen.getByRole('dialog')).toBeInTheDocument();
});
