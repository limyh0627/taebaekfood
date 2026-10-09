/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import CashEntryModal from './CashEntryModal';
import { appConfirm } from '../../src/shared/components/appDialog';
import type { CashEntry } from '../../src/shared/types';
import { auth } from '../../src/shared/firebase';
vi.mock('../../src/shared/components/appDialog', () => ({ appConfirm: vi.fn(async () => true) }));
vi.mock('../../src/shared/firebase', () => ({ auth: { currentUser: { uid: 'test-uid' } } }));
afterEach(cleanup);
beforeEach(() => { vi.mocked(appConfirm).mockReset().mockResolvedValue(true); (auth.currentUser as { uid: string }).uid = 'test-uid'; });
const entry: CashEntry = { id: 'legacy', companyId: 'taebaek', cashAccountId: '', date: '2026-08-01', dir: '출금',
  amount: 110, createdAt: '', lines: [{ accountCode: '260', amount: 100 }, { accountCode: '951', amount: 10 }] };
const props = { mode: { kind: '수정' as const, entry }, companyId: 'taebaek' as const, partners: [], accountCodes: [],
  cashAccounts: [{ id: 'main', name: '확인된 통장', type: '통장' as const, openingDate: '2026-07-31' },
    { id: 'cash', name: '현금', type: '현금' as const }], accountId: 'main', onAccountId: vi.fn(),
  partnerBalances: new Map(), getBalance: () => 0, latestStatement: () => undefined,
  onClose: vi.fn(), onSettle: vi.fn(), onSaveEdit: vi.fn() };
const choose = () => fireEvent.change(screen.getByLabelText('계좌 미지정 · 통장 선택'), { target: { value: 'main' } });

it('기본 계좌를 추정하지 않고 명시 통장 선택 뒤 원문 그대로 한 번만 지정한다', async () => {
  let finish!: () => void;
  const assign = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<CashEntryModal {...props} onAssignCashAccount={assign} />);
  expect(screen.getByLabelText('계좌 미지정 · 통장 선택')).toHaveValue('');
  expect(screen.getByRole('button', { name: '계좌 지정' })).toBeDisabled();
  expect(screen.queryByRole('option', { name: '현금' })).toBeNull();
  choose(); fireEvent.click(screen.getByRole('button', { name: '계좌 지정' }));
  fireEvent.click(screen.getByRole('button', { name: '계좌 지정' }));
  expect(assign).toHaveBeenCalledExactlyOnceWith(entry, 'main');
  expect(props.onSaveEdit).not.toHaveBeenCalled();
  finish(); await waitFor(() => expect(screen.getByRole('button', { name: '계좌 지정' })).not.toBeDisabled());
});

it('서버 거절은 설명과 선택을 보존하여 같은 원문으로 재시도한다', async () => {
  const assign = vi.fn().mockRejectedValueOnce(new Error('활성 선급 적용을 먼저 확인해주세요.')).mockResolvedValue(undefined);
  render(<CashEntryModal {...props} onAssignCashAccount={assign} />); choose();
  fireEvent.click(screen.getByRole('button', { name: '계좌 지정' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('활성 선급 적용'));
  expect(screen.getByLabelText('계좌 미지정 · 통장 선택')).toHaveValue('main');
  fireEvent.click(screen.getByRole('button', { name: '계좌 지정' }));
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
  expect(assign.mock.calls[1]).toEqual([entry, 'main']);
});

it('기초일 이전 영향 안내를 확인하며 취소하면 송신하지 않는다', async () => {
  vi.mocked(appConfirm).mockResolvedValue(false);
  const assign = vi.fn();
  render(<CashEntryModal {...props} cashAccounts={[{ ...props.cashAccounts[0], openingDate: '2026-09-01' }]} onAssignCashAccount={assign} />);
  choose(); expect(screen.getByText(/계좌 원장 잔액에는 반영되지 않습니다/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '계좌 지정' }));
  await waitFor(() => expect(appConfirm).toHaveBeenCalledOnce());
  expect(assign).not.toHaveBeenCalled();
});

it('회사 변경 후 늦은 실패가 새 회사 화면에 표시되지 않는다', async () => {
  let fail!: (error: Error) => void;
  const assign = vi.fn(() => new Promise<void>((_, reject) => { fail = reject; }));
  const view = render(<CashEntryModal {...props} onAssignCashAccount={assign} />); choose();
  fireEvent.click(screen.getByRole('button', { name: '계좌 지정' }));
  view.rerender(<CashEntryModal {...props} companyId="punghoe" mode={{ kind: '수정', entry: { ...entry, companyId: 'punghoe' } }} onAssignCashAccount={assign} />);
  fail(new Error('이전 회사 오류')); await Promise.resolve();
  expect(screen.queryByText('이전 회사 오류')).toBeNull();
});

it('기초일 확인 중 로그인 사용자가 바뀌면 지정 요청을 보내지 않는다', async () => {
  let confirm!: (value: boolean) => void;
  vi.mocked(appConfirm).mockImplementation(() => new Promise(resolve => { confirm = resolve; }));
  const assign = vi.fn();
  render(<CashEntryModal {...props} cashAccounts={[{ ...props.cashAccounts[0], openingDate: '2026-09-01' }]} onAssignCashAccount={assign} />);
  choose(); fireEvent.click(screen.getByRole('button', { name: '계좌 지정' }));
  (auth.currentUser as { uid: string }).uid = 'other-uid'; confirm(true);
  await waitFor(() => expect(appConfirm).toHaveBeenCalledOnce());
  expect(assign).not.toHaveBeenCalled();
});

it('실제 전표 화면 handler는 exact 계좌 패치만 보내고 다른 상세의 늦은 닫기를 보존한다', async () => {
  const source = ts.createSourceFile('TradeStatement.tsx', readFileSync('components/TradeStatement.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler = '';
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'assignCashAccount') handler = node.initializer!.getText(source); ts.forEachChild(node, visit); };
  visit(source);
  const update = vi.fn().mockResolvedValue(undefined), close = vi.fn();
  const scope = { current: { alive: true, token: {} } }, auth = { currentUser: { uid: 'uid' } };
  const body = ts.transpile(`const actual = ${handler};`, { target: ts.ScriptTarget.ES2022 });
  const actual = new Function('auth', 'cashEditScope', 'companyOf', 'companyId', 'onUpdateCashEntry', 'activeCashAccounts', 'setCashModal', `${body}\nreturn actual;`)(auth, scope, () => 'taebaek', 'taebaek', update, props.cashAccounts, close);
  await actual(entry, 'main');
  expect(update).toHaveBeenCalledExactlyOnceWith('legacy', { cashAccountId: 'main' }, entry);
  const closeUpdater = close.mock.calls[0][0];
  expect(closeUpdater({ kind: '수정', entry })).toBeNull();
  const other = { kind: '수정', entry: { ...entry, id: 'other' } };
  expect(closeUpdater(other)).toBe(other);
  auth.currentUser.uid = '';
  await expect(actual(entry, 'main')).rejects.toThrow('현재 회사');
  expect(update).toHaveBeenCalledOnce();
  auth.currentUser.uid = 'uid';
  let finish!: () => void;
  update.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  close.mockClear();
  const pending = actual(entry, 'main');
  auth.currentUser.uid = 'new-uid'; finish(); await pending;
  expect(close).not.toHaveBeenCalled();
});
