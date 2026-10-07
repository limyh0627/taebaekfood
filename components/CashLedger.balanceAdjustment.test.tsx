import { saveConfirmedCashBalance } from '../src/shared/services/confirmedCashBalance';
/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CashLedger, { AccountModal } from './CashLedger';
import type { CashAccount, CashEntry } from '../src/shared/types';
import { today } from '../src/shared/day';
vi.mock('../src/shared/services/confirmedCashBalance', () => ({ saveConfirmedCashBalance: vi.fn() }));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: async () => true, appNotice: async () => {} }));
const account: CashAccount = { id: 'bank', companyId: 'taebaek', name: '메인통장', type: '통장', active: true, openingDate: '2026-07-31', openingBalance: 1000, createdAt: '' };
const cash = (id: string, date: string, amount: number): CashEntry => ({ id, companyId: 'taebaek', cashAccountId: 'bank', date, amount, dir: '출금', createdAt: '' });
const base = { companyId: 'taebaek' as const, accounts: [account], onClose: vi.fn(), onAdd: vi.fn(), onUpdate: vi.fn() };
const open = () => fireEvent.click(screen.getByRole('button', { name: /메인통장/ }));
const input = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: '잔액 조정 저장' }));
beforeEach(() => { localStorage.clear(); vi.mocked(saveConfirmedCashBalance).mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);
describe('실잔액 조정', () => {
  it('과거 조정일 잔액에서 차이를 계산하고 이후 거래와 기초잔액을 유지한다', async () => {
    const onAddEntry = vi.fn().mockResolvedValue(undefined), onCorrect = vi.fn();
    const entries = [cash('old', '2026-08-01', 100), cash('later', '2026-09-01', 50), { ...cash('other', '2026-08-01', 777), companyId: 'punghoe' as const }];
    render(<AccountModal {...base} cashEntries={entries} onAddEntry={onAddEntry} onCorrect={onCorrect} />);
    open(); input('조정일', '2026-08-01'); input('실제 잔액', '800'); input('조정 사유', '통장 대조'); save();
    await waitFor(() => expect(saveConfirmedCashBalance).toHaveBeenCalledWith('taebaek', account, '2026-08-01', 800, '통장 대조'));
    expect(onAddEntry).not.toHaveBeenCalled(); expect(account.openingBalance).toBe(1000); expect(onCorrect).not.toHaveBeenCalled();
  });
  it('음수 실잔액도 정수 차액으로 저장한다', async () => {
    const onAddEntry = vi.fn().mockResolvedValue(undefined);
    render(<AccountModal {...base} onAddEntry={onAddEntry} />); open();
    input('실제 잔액', '-200'); input('조정 사유', '마이너스통장'); save();
    await waitFor(() => expect(saveConfirmedCashBalance).toHaveBeenCalledWith('taebaek', account, today(), -200, '마이너스통장'));
    expect(onAddEntry).not.toHaveBeenCalled();
  });
  it('소수·unsafe 정수·잘못된 날짜·빈 사유는 요청하지 않는다', () => {
    const onAddEntry = vi.fn(); render(<AccountModal {...base} onAddEntry={onAddEntry} />); open();
    input('실제 잔액', '800'); input('실제 잔액', '800.5'); expect(screen.getByRole('button', { name: '잔액 조정 저장' })).toBeDisabled();
    input('실제 잔액', '9007199254740992'); save();
    input('실제 잔액', '800'); save(); input('조정 사유', '대조');
    input('조정일', '2026-07-01'); save(); input('조정일', '2099-01-01'); save();
    expect(onAddEntry).not.toHaveBeenCalled();
  });
  it('같은 잔액과 0원도 전표 없이 확정값으로 저장한다', async () => {
    const onAddEntry = vi.fn(); render(<AccountModal {...base} onAddEntry={onAddEntry} />); open();
    input('조정 사유', '확인'); save();
    await waitFor(() => expect(saveConfirmedCashBalance).toHaveBeenCalledWith('taebaek', account, today(), 1000, '확인'));
    expect(onAddEntry).not.toHaveBeenCalled();
  });
  it('이전 회사의 늦은 실패는 새 회사의 상세 화면을 변경하지 않는다', async () => {
    let reject!: (error: Error) => void;
    const onAddEntry = vi.fn(); vi.mocked(saveConfirmedCashBalance).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const { rerender } = render(<AccountModal {...base} onAddEntry={onAddEntry} />); open(); input('실제 잔액', '800'); input('조정 사유', '대조'); save();
    const other = { ...account, companyId: 'punghoe' as const, id: 'other', name: '풍회 통장' };
    rerender(<AccountModal {...base} companyId="punghoe" accounts={[other]} onAddEntry={onAddEntry} />);
    fireEvent.click(screen.getByRole('button', { name: /풍회 통장/ })); reject(new Error('늦은 오류'));
    await waitFor(() => expect(screen.getByLabelText('실제 잔액')).toHaveValue('1,000'));
    expect(screen.queryByRole('alert')).toBeNull(); expect(localStorage.getItem('cash-balance-adjustment:taebaek:bank')).toBeNull();
  });
  it.each([
    { before: 1000, target: 800, delta: -200, reason: 7 },
    { before: 1000, target: 800, delta: -100, reason: '대조' },
    { before: 1000, target: 800, delta: -200, reason: '대조', accountCode: '404' },
  ])('유효 JSON이라도 손상된 요청은 보존하고 재전송하지 않는다: %j', bad => {
    const { accountCode, ...meta } = bad as { before: number; target: number; delta: number; reason: string | number; accountCode?: string };
    const stored = JSON.stringify({ id: 'cash-adjust-old', companyId: 'taebaek', cashAccountId: 'bank', date: today(), createdAt: '', note: '조정', dir: '출금', amount: 200, balanceAdjustment: meta, ...(accountCode ? { accountCode } : {}) });
    localStorage.setItem('cash-balance-adjustment:taebaek:bank', stored);
    const onAddEntry = vi.fn(); render(<AccountModal {...base} onAddEntry={onAddEntry} />); open();
    expect(screen.getByRole('alert')).toHaveTextContent('저장된 조정 요청 확인이 필요합니다');
    expect(screen.getByRole('button', { name: '잔액 조정 저장' })).toBeDisabled();
    expect(localStorage.getItem('cash-balance-adjustment:taebaek:bank')).toBe(stored);
    expect(onAddEntry).not.toHaveBeenCalled();
  });
  it('기초잔액 수정은 별도 화면에서 기존 API를 사용한다', async () => {
    const onCorrect = vi.fn().mockResolvedValue(undefined), onAddEntry = vi.fn();
    render(<AccountModal {...base} onCorrect={onCorrect} onAddEntry={onAddEntry} />); open();
    fireEvent.click(screen.getByRole('button', { name: '기초잔액 수정' })); input('현재 잔액', '2000'); fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onCorrect).toHaveBeenCalledWith(account, account.name, account.openingDate, 2000)); expect(onAddEntry).not.toHaveBeenCalled();
  });
  it('원장은 조정 사유·별도 합계를 표시하고 전표 매칭을 차단한다', () => {
    const entry: CashEntry = { ...cash('adjust', today(), 200), balanceAdjustment: { before: 1000, target: 800, delta: -200, reason: '통장 대조' } };
    render(<CashLedger companyId="taebaek" cashAccounts={[account]} cashEntries={[entry]} accountCodes={[]} partners={[]} issuedStatements={[]} settlements={[]} onAddCashAccount={vi.fn()} onUpdateCashAccount={vi.fn()} onAddCashEntry={vi.fn()} onDeleteCashEntry={vi.fn()} onAddSettlement={vi.fn()} onDeleteSettlement={vi.fn()} />);
    expect(screen.getByText('잔액 조정 · 회계 미분류 — 통장 대조')).toBeInTheDocument();
    expect(screen.getByText('잔액 조정 합계: -200원')).toBeInTheDocument(); expect(screen.getByTitle('전표 매칭')).toBeDisabled();
  });
});

it('확정 잔액 행은 뒤늦은 같은날 거래 후 실제 적용 차액과 확정 잔액을 표시한다', () => {
  const anchor: CashEntry = { ...cash('anchor', today(), 200), createdAt: `${today()}T20:00:00Z`, balanceAdjustment: { before: 1000, target: 800, delta: -200, reason: '통장 확정', confirmedBalance: true } };
  render(<CashLedger companyId="taebaek" cashAccounts={[account]} cashEntries={[anchor, cash('late', today(), 100)]} accountCodes={[]} partners={[]} issuedStatements={[]} settlements={[]} onAddCashAccount={vi.fn()} onUpdateCashAccount={vi.fn()} onAddCashEntry={vi.fn()} onDeleteCashEntry={vi.fn()} onAddSettlement={vi.fn()} onDeleteSettlement={vi.fn()} />);
  expect(screen.getByText('확정 잔액 · 회계 미분류 — 통장 확정')).toBeInTheDocument();
  expect(screen.getByText('900원 → 800원 · 조정 -100원')).toBeInTheDocument();
  expect(screen.getByText('잔액 조정 합계: -100원')).toBeInTheDocument();
});
it('기존 미확정 조정의 재시도는 플래그를 추가하지 않고 원본을 유지한다', async () => {
  const entry = { id: 'cash-adjust-legacy', companyId: 'taebaek', cashAccountId: 'bank', date: today(), createdAt: '', note: '기존 조정', dir: '출금', amount: 200, balanceAdjustment: { before: 1000, target: 800, delta: -200, reason: '기존 대조' } };
  localStorage.setItem('cash-balance-adjustment:taebaek:bank', JSON.stringify(entry));
  const onAddEntry = vi.fn().mockResolvedValue(undefined);
  render(<AccountModal {...base} onAddEntry={onAddEntry} />); open();
  fireEvent.click(screen.getByRole('button', { name: '조정 재시도' }));
  await waitFor(() => expect(onAddEntry).toHaveBeenCalledWith(entry));
});
it('확정 플래그가 손상된 복원 요청은 보존하고 전송하지 않는다', () => {
  const stored = JSON.stringify({ id: 'cash-adjust-invalid', companyId: 'taebaek', cashAccountId: 'bank', date: today(), createdAt: '', note: '조정', dir: '출금', amount: 200, balanceAdjustment: { before: 1000, target: 800, delta: -200, reason: '대조', confirmedBalance: 'true' } });
  localStorage.setItem('cash-balance-adjustment:taebaek:bank', stored);
  const onAddEntry = vi.fn(); render(<AccountModal {...base} onAddEntry={onAddEntry} />); open();
  expect(screen.getByRole('alert')).toHaveTextContent('저장된 조정 요청 확인이 필요합니다');
  expect(screen.getByRole('button', { name: '잔액 조정 저장' })).toBeDisabled();
  expect(localStorage.getItem('cash-balance-adjustment:taebaek:bank')).toBe(stored);
  expect(onAddEntry).not.toHaveBeenCalled();
});

it('계좌 확정 기준 행은 전표 매칭과 거래 삭제 버튼을 제공하지 않는다', () => {
 const confirmed = { ...account, confirmedBalances: [{date: today(), balance: 0, recordedAt: new Date().toISOString(), reason: '은행 확인'}] };
 render(<CashLedger companyId="taebaek" cashAccounts={[confirmed]} cashEntries={[]} accountCodes={[]} partners={[]} issuedStatements={[]} settlements={[]} onAddCashAccount={vi.fn()} onUpdateCashAccount={vi.fn()} onAddCashEntry={vi.fn()} onDeleteCashEntry={vi.fn()} onAddSettlement={vi.fn()} onDeleteSettlement={vi.fn()} />);
 expect(screen.queryByTitle('전표 매칭')).toBeNull(); expect(screen.queryByLabelText('거래 삭제')).toBeNull();
 expect(screen.getByText(/은행 확인/)).toBeInTheDocument();
});

it('0원 확정값 저장 실패는 초안을 보존하고 같은 입력으로 재시도한다', async () => {
 vi.mocked(saveConfirmedCashBalance).mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
 const onAddEntry=vi.fn(); render(<AccountModal {...base} onAddEntry={onAddEntry} />); open(); input('실제 잔액','0'); input('조정 사유','0원 확인'); save();
 await screen.findByRole('alert'); expect(screen.getByLabelText('실제 잔액')).toHaveValue('0'); expect(screen.getByLabelText('조정 사유')).toHaveValue('0원 확인');
 save(); await waitFor(() => expect(saveConfirmedCashBalance).toHaveBeenCalledTimes(2));
 expect(vi.mocked(saveConfirmedCashBalance).mock.calls[1]).toEqual(['taebaek',account,today(),0,'0원 확인']); expect(onAddEntry).not.toHaveBeenCalled();
});
