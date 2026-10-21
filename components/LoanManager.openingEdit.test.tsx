/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import LoanManager from './LoanManager';
import type { CashEntry } from '../src/shared/types';
import type { LoanContract } from '../src/shared/loanLedger';

const calls = vi.hoisted(() => ({ fetch: vi.fn(), update: vi.fn(), create: vi.fn(), confirm: vi.fn(), notice: vi.fn(), auth: { currentUser: { uid: 'A' } as {uid:string}|null }, listeners: new Set<(user:{uid:string}|null)=>void>() }));
vi.mock('../src/shared/services/firebaseService', () => ({
  fetchWhere: calls.fetch, updateLoanOpening: calls.update, createLoanWithOpening: calls.create,
}));
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: calls.confirm, appNotice: calls.notice }));
vi.mock('../src/shared/firebase', () => ({ auth: Object.assign(calls.auth, { onAuthStateChanged: (listener:(user:{uid:string}|null)=>void) => {calls.listeners.add(listener);listener(calls.auth.currentUser);return()=>{calls.listeners.delete(listener);};} }), authReady: Promise.resolve(), db: {}, functions: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth:unknown, listener:(user:{uid:string}|null)=>void) => { calls.listeners.add(listener); listener(calls.auth.currentUser); return () => {calls.listeners.delete(listener);}; } }));
const loan: LoanContract = { id: 'loan', companyId: 'taebaek', name: '운전자금', lenderName: '은행', accountCode: '293',
  openingDate: '2026-09-01', openingPrincipal: 10_000, createdAt: '2026-09-01T00:00:00Z' };
const entries: CashEntry[] = [
  { id: 'draw', companyId: 'taebaek', loanId: loan.id, date: '2026-09-01', createdAt: '', dir: '입금', amount: 5_000, accountCode: '293', cashAccountId: 'bank' },
  { id: 'repay', companyId: 'taebaek', loanId: loan.id, date: '2026-09-02', createdAt: '', dir: '출금', amount: 1_100, cashAccountId: 'bank',
    lines: [{ accountCode: '293', amount: 1_000 }, { accountCode: '831', amount: 100 }] },
];
beforeEach(() => { calls.fetch.mockReset().mockResolvedValue([loan]); calls.update.mockReset(); calls.create.mockReset(); calls.confirm.mockReset().mockResolvedValue(true); calls.notice.mockReset(); calls.auth.currentUser = {uid:'A'}; });
async function openEditor(cashEntries = entries) {
  const view = render(<LoanManager companyId="taebaek" cashEntries={cashEntries} cashAccounts={[]} partners={[]} onAddCashEntry={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /운전자금/ }));
  fireEvent.click(screen.getByRole('button', { name: '시작일·원금 수정' }));
  return { date: screen.getByLabelText('시작일'), balance: screen.getByLabelText('현재 원금 잔액'), rerender: view.rerender };
}

it('기존 시작일·계산된 현재잔액을 채우고 새 날짜 이후 원금만 미리보기로 역산한다', async () => {
  const { date, balance } = await openEditor();
  expect(date).toHaveValue('2026-09-01');
  expect(balance).toHaveValue('14,000');
  expect(screen.getByText('시작 원금 미리보기:').parentElement).toHaveTextContent('10,000원');
  fireEvent.change(date, { target: { value: '2026-09-02' } });
  fireEvent.change(balance, { target: { value: '20000' } });
  expect(screen.getByText('시작 원금 미리보기:').parentElement).toHaveTextContent('21,000원');
});

it.each(['-100', '100.5'])('현재잔액의 잘못된 입력 %s는 원래값을 보존하고 저장을 막는다', async value => {
  const { balance } = await openEditor();
  fireEvent.change(balance, { target: { value } });
  expect(balance).toHaveValue('14,000');
  expect(screen.getByRole('alert')).toHaveTextContent('소수와 음수');
  expect(screen.getByRole('button', { name: '수정 저장' })).toBeDisabled();
  expect(calls.update).not.toHaveBeenCalled();
});

it('저장 실패는 수정 날짜·금액을 보존하고 같은 입력으로 다시 저장할 수 있다', async () => {
  calls.update.mockRejectedValueOnce(new Error('원본 변경'));
  const { date, balance } = await openEditor();
  fireEvent.change(date, { target: { value: '2026-08-01' } });
  fireEvent.change(balance, { target: { value: '25000' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(calls.notice).toHaveBeenCalledWith(expect.stringContaining('원본 변경'), '처리 결과 확인 필요'));
  expect(date).toHaveValue('2026-08-01');
  expect(balance).toHaveValue('25,000');
  calls.update.mockImplementationOnce(async () => { calls.fetch.mockResolvedValue([{ ...loan, openingDate: '2026-08-01', openingPrincipal: 21_000 }]); });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '수정 저장' })).toBeNull());
  expect(calls.update).toHaveBeenNthCalledWith(1, 'taebaek', loan, '2026-08-01', 25_000);
  expect(calls.update).toHaveBeenNthCalledWith(2, 'taebaek', loan, '2026-08-01', 25_000);
  expect(calls.fetch).toHaveBeenCalledTimes(2);
  expect(screen.getAllByText('25,000원').length).toBeGreaterThan(0);
});

it('저장 중 버튼과 입력을 잠그며 연결 거래 없는 계약도 새 시작일로 수정한다', async () => {
  let resolve!: () => void;
  calls.update.mockReturnValue(new Promise<void>(done => { resolve = done; }));
  const { date, balance } = await openEditor([]);
  fireEvent.change(date, { target: { value: '2025-01-01' } });
  fireEvent.change(balance, { target: { value: '100000000' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(calls.update).toHaveBeenCalledWith('taebaek', loan, '2025-01-01', 100_000_000));
  expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();
  expect(date).toBeDisabled();
  expect(balance).toBeDisabled();
  await act(async () => { resolve(); });
  expect(screen.queryByRole('button', { name: '수정 저장' })).toBeNull();
});

it.each(['성공', '실패'])('이전 회사 저장의 늦은 %s는 새 회사 수정창과 조회를 건드리지 않는다', async outcome => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  calls.update.mockReturnValue(new Promise<void>((done, fail) => { resolve = done; reject = fail; }));
  const { rerender } = await openEditor();
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(calls.update).toHaveBeenCalledTimes(1));
  const otherLoan = { ...loan, id: 'other-loan', name: '풍회 대출', companyId: 'punghoe', openingDate: '2025-01-01', openingPrincipal: 30_000 };
  calls.fetch.mockResolvedValue([otherLoan]);
  rerender(<LoanManager companyId="punghoe" cashEntries={[]} cashAccounts={[]} partners={[]} onAddCashEntry={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /풍회 대출/ }));
  fireEvent.click(screen.getByRole('button', { name: '시작일·원금 수정' }));
  await act(async () => { if (outcome === '성공') resolve(); else reject(new Error('태백 저장 실패')); });
  expect(screen.getByLabelText('시작일')).toHaveValue('2025-01-01');
  expect(screen.getByLabelText('현재 원금 잔액')).toHaveValue('30,000');
  expect(screen.getByRole('button', { name: '수정 저장' })).toBeEnabled();
  expect(calls.fetch).toHaveBeenCalledTimes(2);
  expect(calls.notice).not.toHaveBeenCalled();
});


it('시작 원금 직접 수정은 연결 원금만 반영해 현재잔액을 바꾸고 기존 API로 저장한다', async () => {
  const { balance } = await openEditor();
  const opening = screen.getByLabelText('시작일 원금 잔액');
  expect(opening).toHaveValue('10,000');
  fireEvent.change(opening, { target: { value: '20000' } });
  expect(balance).toHaveValue('24,000');
  fireEvent.change(balance, { target: { value: '30000' } });
  expect(opening).toHaveValue('26,000');
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(calls.update).toHaveBeenCalledWith('taebaek', loan, loan.openingDate, 30_000));
});


it.each(['-1', '100.5', '9007199254740992'])('시작 원금의 잘못된 입력 %s는 저장을 막고 현재잔액을 보존한다', async value => {
  const { balance } = await openEditor();
  fireEvent.change(screen.getByLabelText('시작일 원금 잔액'), { target: { value } });
  if (value !== '9007199254740992') expect(balance).toHaveValue('14,000');
  expect(screen.getByRole('button', { name: '수정 저장' })).toBeDisabled();
  expect(calls.update).not.toHaveBeenCalled();
});

it('시작일 변경은 현재 잔액을 유지하고 직접 입력 0원도 기존 거래로 현재액을 계산한다', async () => {
  const { date, balance } = await openEditor();
  fireEvent.change(screen.getByLabelText('시작일 원금 잔액'), { target: { value: '20000' } });
  expect(balance).toHaveValue('24,000');
  fireEvent.change(date, { target: { value: '2026-09-02' } });
  expect(balance).toHaveValue('24,000');
  expect(screen.getByLabelText('시작일 원금 잔액')).toHaveValue('25,000');
  fireEvent.change(screen.getByLabelText('시작일 원금 잔액'), { target: { value: '500' } });
  expect(balance).toHaveValue('-500');
  expect(screen.getByRole('button', { name: '수정 저장' })).toBeDisabled();
  fireEvent.change(balance, { target: { value: '24000' } });
  fireEvent.change(date, { target: { value: '2026-09-01' } });
  fireEvent.change(screen.getByLabelText('시작일 원금 잔액'), { target: { value: '0' } });
  expect(balance).toHaveValue('4,000');
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(calls.update).toHaveBeenCalledWith('taebaek', loan, '2026-09-01', 4000));
});


it('상환 거래가 있어도 시작 원금을 비우고 한 자리씩 다시 입력할 수 있다', async () => {
  const user = userEvent.setup();
  const repayments: CashEntry[] = [{ ...entries[1], amount: 2000, lines: [{ accountCode: '293', amount: 2000 }] }];
  const { balance } = await openEditor(repayments);
  const opening = screen.getByLabelText('시작일 원금 잔액');
  await user.clear(opening);
  expect(opening).toHaveValue(''); expect(screen.getByRole('button', { name: '수정 저장' })).toBeDisabled();
  await user.type(opening, '12000');
  expect(opening).toHaveValue('12,000'); expect(balance).toHaveValue('10,000');
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  await waitFor(() => expect(calls.update).toHaveBeenCalledWith('taebaek', loan, loan.openingDate, 10000));
});

const waitForOpening = <T,>() => { let resolve!: (value: T) => void, reject!: (error:Error)=>void; const promise = new Promise<T>((ok,fail) => {resolve=ok;reject=fail;}); return {promise,resolve,reject}; };
async function createDraft() {
  const view=render(<LoanManager companyId="taebaek" cashEntries={[]} cashAccounts={[]} partners={[]} onAddCashEntry={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'대출 등록'}));
  fireEvent.change(screen.getByPlaceholderText('예: 운전자금 대출 1호'),{target:{value:'새 대출'}});
  fireEvent.change(screen.getByPlaceholderText('은행명'),{target:{value:'농협'}});
  return view;
}
it.each(['company','unmount'] as const)('등록 확인 대기 중 %s 변경 뒤 승인돼도 저장하지 않는다',async mode=>{
  const confirmation=waitForOpening<boolean>();calls.confirm.mockReturnValue(confirmation.promise);
  const view=await createDraft();fireEvent.click(screen.getByRole('button',{name:'등록'}));
  if(mode==='unmount')view.unmount();else view.rerender(<LoanManager companyId="punghoe" cashEntries={[]} cashAccounts={[]} partners={[]} onAddCashEntry={vi.fn()}/>);
  await act(async()=>{confirmation.resolve(true);});expect(calls.create).not.toHaveBeenCalled();
});
it('등록 확인을 기다리는 같은 tick의 두 제출은 확인을 한 번만 연다',async()=>{
  const confirmation=waitForOpening<boolean>();calls.confirm.mockReturnValue(confirmation.promise);
  await createDraft();const button=screen.getByRole('button',{name:'등록'});fireEvent.click(button);fireEvent.click(button);
  expect(calls.confirm).toHaveBeenCalledTimes(1);await act(async()=>{confirmation.resolve(false);});
});
it('이전 수정 ACK의 finally가 새 회사 수정 중 잠금을 풀지 않는다',async()=>{
  const old=waitForOpening<void>(),fresh=waitForOpening<void>();calls.update.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const {rerender}=await openEditor();fireEvent.click(screen.getByRole('button',{name:'수정 저장'}));await waitFor(()=>expect(calls.update).toHaveBeenCalledTimes(1));
  const other={...loan,id:'other',companyId:'punghoe',name:'풍회 대출'};calls.fetch.mockResolvedValue([other]);
  rerender(<LoanManager companyId="punghoe" cashEntries={[]} cashAccounts={[]} partners={[]} onAddCashEntry={vi.fn()}/>);
  fireEvent.click(await screen.findByRole('button',{name:/풍회 대출/}));fireEvent.click(screen.getByRole('button',{name:'시작일·원금 수정'}));fireEvent.click(screen.getByRole('button',{name:'수정 저장'}));await waitFor(()=>expect(calls.update).toHaveBeenCalledTimes(2));
  await act(async()=>{old.resolve();});expect(screen.getByLabelText('시작일')).toBeDisabled();
  await act(async()=>{fresh.resolve();});
});
it.each(['resolve','reject'] as const)('저장 ACK 뒤 목록 갱신 중 UID 변경 후 %s되어도 로딩이 끝난다',async outcome=>{
  const oldList=waitForOpening<LoanContract[]>();
  await openEditor();calls.fetch.mockReturnValueOnce(oldList.promise);
  fireEvent.click(screen.getByRole('button',{name:'수정 저장'}));await waitFor(()=>expect(calls.fetch).toHaveBeenCalledTimes(2));
  await act(async()=>{calls.auth.currentUser={uid:'B'};calls.listeners.forEach(listener=>listener({uid:'B'}));});
  expect(screen.getByText('불러오는 중…')).toBeInTheDocument();calls.notice.mockClear();
  await act(async()=>{if(outcome==='resolve')oldList.resolve([{...loan,name:'옛 계정 목록'}]);else oldList.reject(Error('옛 목록 오류'));});
  expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/옛 계정 목록/})).not.toBeInTheDocument();expect(calls.notice).not.toHaveBeenCalled();
});
it('이전 목록 조회 finally는 나중에 시작한 목록의 로딩을 끄지 않는다',async()=>{
  const oldList=waitForOpening<LoanContract[]>(),newList=waitForOpening<LoanContract[]>();
  await openEditor();calls.fetch.mockReturnValueOnce(oldList.promise).mockReturnValueOnce(newList.promise);
  fireEvent.click(screen.getByRole('button',{name:'수정 저장'}));await waitFor(()=>expect(calls.fetch).toHaveBeenCalledTimes(2));
  fireEvent.click(document.querySelector('svg.lucide-refresh-cw')!.closest('button')!);await waitFor(()=>expect(calls.fetch).toHaveBeenCalledTimes(3));
  await act(async()=>{oldList.resolve([loan]);});expect(screen.getByText('불러오는 중…')).toBeInTheDocument();
  await act(async()=>{newList.resolve([{...loan,name:'최신 목록'}]);});expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument();expect(screen.getByText('최신 목록',{selector:'strong'})).toBeInTheDocument();
});
