/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CashLedger from './CashLedger';
import type { AccountCode, CashAccount, CashEntry, Partner } from '../src/shared/types';
const authentication = vi.hoisted(() => ({ currentUser: { uid: 'auth-admin', isAnonymous: false } }));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: async () => true, appNotice: async () => {} }));
vi.mock('../src/shared/useLoanContracts', () => ({ useLoanContracts: () => [{ id: 'loan-original', companyId: 'taebaek', accountCode: '260', name: '운영 대출', lenderName: '은행' }] }));
vi.mock('../src/shared/firebase', async importOriginal => ({ ...await importOriginal<object>(), auth: authentication, authReady: Promise.resolve() }));
const storageKey = 'cash-entry-issue:taebaek:auth-admin';
beforeEach(() => { authentication.currentUser.uid = 'auth-admin'; localStorage.clear(); vi.spyOn(window, 'alert').mockImplementation(() => {}); });
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
function props(onAdd: (entry: CashEntry) => void | Promise<unknown>, companyId: 'taebaek' | 'punghoe' = 'taebaek') {
  return { companyId, currentUser: { id: 'employee-admin', name: '관리자' },
    cashAccounts: [{ id: 'bank', companyId, name: '통장', active: true, type: '통장', openingBalance: 0, openingDate: '2026-01-01' } as CashAccount],
    cashEntries: [], accountCodes: ['108', '251', '253', '802', '254', '813'].map(code => ({ id: code, code,
      name: code === '802' ? '급여' : code === '254' ? '예수금' : code === '813' ? '이자비용' : '선택 계정' } as AccountCode)),
    partners: [{ id: 'partner', companyId, name: '선택 거래처' } as Partner], issuedStatements: [], settlements: [],
    onAddCashAccount: vi.fn(), onUpdateCashAccount: vi.fn(), onAddCashEntry: onAdd,
    onDeleteCashEntry: vi.fn(), onAddSettlement: vi.fn(), onDeleteSettlement: vi.fn() };
}
function fill(code = '251') {
  fireEvent.click(screen.getByRole('button', { name: '일반전표' }));
  fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '100' } });
  fireEvent.change(screen.getByRole('option', { name: `${code} · 선택 계정` }).parentElement!, { target: { value: code } });
}
function pending(entries: object[]) { return JSON.stringify({ companyId: 'taebaek', userId: 'auth-admin', entries }); }
const original = { id: 'cash-pending', date: '2026-10-03', dir: '출금', amount: 100, accountCode: '251', cashAccountId: 'bank' };
describe('선택 계정 신규 자금전표', () => {
  it.each(['108', '251', '253'])('%s를 임의 계정이나 자동 정산으로 바꾸지 않고 저장한다', async code => {
    const onAdd = vi.fn().mockResolvedValue(undefined); render(<CashLedger {...props(onAdd)} />); fill(code);
    fireEvent.change(screen.getByRole('option', { name: '선택 거래처' }).parentElement!, { target: { value: 'partner' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ accountCode: code, partnerId: 'partner', cashAccountId: 'bank', amount: 100 }));
    await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
  });
  it('응답 유실은 입력을 잠그고 닫기·재열기 뒤 같은 Auth UID 원문 ID로 재시도한다', async () => {
    const onAdd = vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValueOnce(undefined);
    render(<CashLedger {...props(onAdd)} />); fill(); fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '동일 요청 재시도' })).toBeEnabled());
    expect(screen.getByPlaceholderText('0')).toBeDisabled();
    const entry = onAdd.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    fireEvent.click(screen.getByRole('button', { name: '일반전표' }));
    expect(screen.getByPlaceholderText('0')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '동일 요청 재시도' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    expect(onAdd.mock.calls[1][0]).toEqual(entry);
    await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
  });
  it('최초 요청의 동일 회사·ID 쓰기0 서버 proof만 입력 수정을 다시 허용한다', async () => {
    const onAdd = vi.fn().mockImplementationOnce(async entry => { throw Object.assign(new Error('명확한 거절'), {
      details: { operationStatus: 'rejected', version: 1, financialWrites: false, companyId: 'taebaek', operationId: entry.id } });
    }).mockResolvedValueOnce(undefined);
    render(<CashLedger {...props(onAdd)} />); fill(); fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '저장' })).toBeEnabled());
    expect(localStorage.getItem(storageKey)).toBeNull(); expect(screen.getByPlaceholderText('0')).toBeEnabled();
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    expect(onAdd.mock.calls[1][0].amount).toBe(200);
  });
  it('이전 unknown 재시도에 거절 proof가 와도 이전 원문을 보존한다', async () => {
    const onAdd = vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockImplementationOnce(async entry => {
      throw Object.assign(new Error('거절'), { details: { operationStatus: 'rejected', version: 1,
        financialWrites: false, companyId: 'taebaek', operationId: entry.id } });
    });
    render(<CashLedger {...props(onAdd)} />); fill(); fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '동일 요청 재시도' })).toBeEnabled());
    const stored = localStorage.getItem(storageKey);
    fireEvent.click(screen.getByRole('button', { name: '동일 요청 재시도' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem(storageKey)).toBe(stored); expect(screen.getByPlaceholderText('0')).toBeDisabled();
  });
  it('손상된 유효 JSON 원문 대기는 보내거나 지우지 않는다', () => {
    const corrupted = pending([{ ...original, balanceAdjustment: { reason: 1 } }]);
    localStorage.setItem(storageKey, corrupted);
    const onAdd = vi.fn(); render(<CashLedger {...props(onAdd)} />);
    fireEvent.click(screen.getByRole('button', { name: '일반전표' }));
    expect(screen.getByRole('alert')).toHaveTextContent('저장된 발행 요청 확인이 필요');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(localStorage.getItem(storageKey)).toBe(corrupted); expect(onAdd).not.toHaveBeenCalled();
  });
  it('원문 대기 저장 실패는 서버 쓰기를 시작하지 않는다', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('저장공간 부족'); });
    const onAdd = vi.fn(); render(<CashLedger {...props(onAdd)} />); fill();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('저장공간 부족'));
    expect(onAdd).not.toHaveBeenCalled(); expect(screen.getByPlaceholderText('0')).toBeEnabled();
  });
  it('같은 회사·UID 다른 창의 원문이 생겼으면 덮어쓰거나 새 요청을 보내지 않는다', async () => {
    const onAdd = vi.fn(); render(<CashLedger {...props(onAdd)} />); fill();
    const other = pending([{ ...original, id: 'cash-other-tab' }]);
    localStorage.setItem(storageKey, other);
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('다른 창의 발행 요청'));
    expect(onAdd).not.toHaveBeenCalled(); expect(localStorage.getItem(storageKey)).toBe(other);
  });
  it('늦은 성공은 다른 창이 보존한 새로운 원문을 지우지 않는다', async () => {
    let resolve!: () => void;
    const onAdd = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    render(<CashLedger {...props(onAdd)} />); fill(); fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const other = pending([{ ...original, id: 'cash-other-tab' }]); localStorage.setItem(storageKey, other);
    await act(async () => resolve());
    expect(localStorage.getItem(storageKey)).toBe(other);
  });
  it('이자 단독 상환은 전용 서비스에 loanId를 전달하며 generic 원문 대기를 겹치지 않는다', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('전용 서비스 응답 유실'));
    render(<CashLedger {...props(onAdd)} />);
    fireEvent.click(screen.getByRole('button', { name: '일반전표' }));
    fireEvent.click(screen.getByRole('button', { name: /템플릿 ▾/ }));
    fireEvent.click(screen.getByRole('button', { name: /대출상환.*원금/ }));
    fireEvent.change(screen.getByRole('option', { name: '운영 대출 · 은행' }).parentElement!, { target: { value: 'loan-original' } });
    fireEvent.change(screen.getAllByPlaceholderText('0')[1], { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][0]).toMatchObject({ loanId: 'loan-original', amount: 100 });
    expect(localStorage.getItem(storageKey)).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: '저장' })).toBeEnabled());
  });
  it('복수 원문 첫 성공·둘째 실패 후 재시도는 두 ID를 모두 보존한다', async () => {
    const entries = [{ ...original, id: 'cash-g', accountCode: '802', amount: 120 }, { ...original, id: 'cash-w', accountCode: '254', amount: 20, dir: '입금' }];
    localStorage.setItem(storageKey, pending(entries));
    const onAdd = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValue(undefined);
    render(<CashLedger {...props(onAdd)} />); fireEvent.click(screen.getByRole('button', { name: '일반전표' }));
    fireEvent.click(screen.getByRole('button', { name: '동일 요청 재시도' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: '동일 요청 재시도' })).toBeEnabled());
    expect(screen.getByPlaceholderText('0')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '동일 요청 재시도' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(4));
    expect(onAdd.mock.calls.map(call => call[0])).toEqual([...entries, ...entries]);
  });
  it('회사 전환 뒤 늦은 첫 완료는 두 번째 원문 쓰기와 새 화면 닫기를 시작하지 않는다', async () => {
    localStorage.setItem(storageKey, pending([{ ...original, id: 'cash-a' }, { ...original, id: 'cash-b' }]));
    let resolve!: () => void;
    const onAdd = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const view = render(<CashLedger {...props(onAdd)} />); fireEvent.click(screen.getByRole('button', { name: '일반전표' }));
    fireEvent.click(screen.getByRole('button', { name: '동일 요청 재시도' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    view.rerender(<CashLedger {...props(onAdd, 'punghoe')} />);
    await act(async () => resolve());
    expect(onAdd).toHaveBeenCalledTimes(1); expect(localStorage.getItem(storageKey)).not.toBeNull();
  });
  it('React 재렌더보다 먼저 Auth UID가 바뀌어도 이전 복수 요청의 다음 쓰기를 보내지 않는다', async () => {
    localStorage.setItem(storageKey, pending([{ ...original, id: 'cash-a' }, { ...original, id: 'cash-b' }]));
    let resolve!: () => void;
    const onAdd = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    render(<CashLedger {...props(onAdd)} />); fireEvent.click(screen.getByRole('button', { name: '일반전표' }));
    fireEvent.click(screen.getByRole('button', { name: '동일 요청 재시도' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    authentication.currentUser.uid = 'different-uid';
    await act(async () => resolve());
    expect(onAdd).toHaveBeenCalledTimes(1); expect(localStorage.getItem(storageKey)).not.toBeNull();
  });
  it('실제 복수 급여 폼에서 첫 성공·둘째 실패는 수정 입력을 잠그고 같은 두 원문을 재시도한다', async () => {
    const onAdd = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValue(undefined);
    render(<CashLedger {...props(onAdd)} />);
    fireEvent.click(screen.getByRole('button', { name: '일반전표' }));
    fireEvent.click(screen.getByRole('button', { name: /템플릿 ▾/ }));
    fireEvent.click(screen.getByRole('button', { name: /급여.*총급여/ }));
    const amounts = screen.getAllByPlaceholderText('0');
    fireEvent.change(amounts[0], { target: { value: '120' } });
    fireEvent.change(amounts[1], { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: '동일 요청 재시도' })).toBeEnabled());
    expect(amounts[0]).toBeDisabled(); expect(amounts[1]).toBeDisabled();
    const entries = onAdd.mock.calls.map(call => call[0]);
    fireEvent.click(screen.getByRole('button', { name: '동일 요청 재시도' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(4));
    expect(onAdd.mock.calls.map(call => call[0])).toEqual([...entries, ...entries]);
  });
});
