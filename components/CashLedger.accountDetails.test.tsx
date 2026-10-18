/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {today,monthStart} from '../src/shared/day';
import CashLedger, { AccountModal } from './CashLedger';
import type { CashAccount, CashEntry } from '../src/shared/types';
vi.mock('../src/shared/components/appDialog', () => ({ appConfirm: async () => true, appNotice: async () => {} }));
const account: CashAccount = { id: 'bank', companyId: 'taebaek', name: '메인통장', type: '통장', active: true, openingDate: '2026-07-31', openingBalance: 1000, createdAt: '' };
const entries = [{ id: 'cash', cashAccountId: 'bank', date: '2026-08-01', dir: '출금', amount: 110, createdAt: '' }] as CashEntry[];
const base = { companyId: 'taebaek' as const, accounts: [account], cashEntries: entries, onClose: vi.fn(), onAdd: vi.fn(), onUpdate: vi.fn() };
describe('계좌 추가·상세 분리', () => {
  it('사용 상태는 저장 성공 후에 바뀌고 실패하면 원래 상태와 초안을 유지한다', async () => {
    let reject!: (error: Error) => void;
    const onUpdate = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
    render(<AccountModal {...base} onUpdate={onUpdate} onCorrect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /메인통장/ }));
    fireEvent.change(screen.getByLabelText('계좌 이름'), { target: { value: '수정 초안' } });
    fireEvent.click(screen.getByRole('button', { name: '사용중' }));
    expect(screen.getByRole('button', { name: '사용중' })).toBeDisabled();
    reject(new Error('저장 실패'));
    expect(await screen.findByRole('alert')).toHaveTextContent('사용 상태를 변경하지 못했습니다');
    expect(screen.getByRole('button', { name: '사용중' })).toBeEnabled();
    expect(screen.getByLabelText('계좌 이름')).toHaveValue('수정 초안');
    fireEvent.click(screen.getByRole('button', { name: '사용중' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '보관' })).toBeEnabled());
    expect(onUpdate.mock.calls).toEqual([[account.id, { active: false }], [account.id, { active: false }]]);
  });
  it('대체 전표와 다른 회사 기록은 상세 잔액과 이름만 수정한 저장값에서 제외한다', async () => {
    const onCorrect = vi.fn().mockResolvedValue(undefined);
    render(<AccountModal {...base} cashEntries={[...entries, { ...entries[0], id: 'offset', dir: '대체', amount: 999 }, { ...entries[0], id: 'other', companyId: 'punghoe', amount: 777 }]} onCorrect={onCorrect} />);
    fireEvent.click(screen.getByRole('button', { name: /메인통장/ }));
    expect(screen.getByLabelText('현재 잔액')).toHaveValue('890');
    fireEvent.change(screen.getByLabelText('계좌 이름'), { target: { value: '농협 메인' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onCorrect).toHaveBeenCalledWith(account, '농협 메인', account.openingDate, 890));
  });
  it('목록에서 별도 추가 화면을 열고 기존 계좌는 상세에서 현재잔액을 수정한다', async () => {
    const onCorrect = vi.fn().mockResolvedValue(undefined);
    render(<AccountModal {...base} onCorrect={onCorrect} />);
    expect(screen.queryByPlaceholderText('기업은행 1234-56')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '계좌 추가' }));
    expect(screen.getByPlaceholderText('기업은행 1234-56')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '계좌 추가 닫기' }));
    fireEvent.click(screen.getByRole('button', { name: /메인통장/ }));
    expect(screen.getByLabelText('현재 잔액')).toHaveValue('890');
    fireEvent.change(screen.getByLabelText('계좌 이름'), { target: { value: '새 이름' } });
    fireEvent.change(screen.getByLabelText('잔액 기준일'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('현재 잔액'), { target: { value: '-200' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onCorrect).toHaveBeenCalledWith(account, '새 이름', '2026-08-01', -200));
  });
  it('저장 실패와 처리 중 입력을 보존하고 같은 원본으로 재시도한다', async () => {
    let reject!: (error: Error) => void;
    const onCorrect = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
    render(<AccountModal {...base} onCorrect={onCorrect} />);
    fireEvent.click(screen.getByRole('button', { name: /메인통장/ }));
    fireEvent.change(screen.getByLabelText('현재 잔액'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(screen.getByLabelText('현재 잔액')).toBeDisabled();
    expect(screen.getByRole('button', { name: '저장 중' })).toBeDisabled();
    reject(new Error('충돌'));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('현재 잔액')).toHaveValue('2,000');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onCorrect).toHaveBeenCalledTimes(2));
    expect(onCorrect.mock.calls[1]).toEqual(onCorrect.mock.calls[0]);
  });
  it('회사 전환은 상세 초안을 닫고 카드의 음수 현재잔액도 그대로 보인다', () => {
    const other = { ...account, id: 'card', companyId: 'punghoe' as const, type: '카드' as const, name: '풍회 카드', openingBalance: 0 };
    const { rerender } = render(<AccountModal {...base} onCorrect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /메인통장/ }));
    fireEvent.change(screen.getByLabelText('계좌 이름'), { target: { value: '태백 초안' } });
    rerender(<AccountModal {...base} companyId="punghoe" accounts={[other]} cashEntries={[{ ...entries[0], companyId: 'punghoe', cashAccountId: 'card' }]} onCorrect={vi.fn()} />);
    expect(screen.queryByDisplayValue('태백 초안')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /풍회 카드/ }));
    expect(screen.getByLabelText('현재 잔액')).toHaveValue('-110');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('신규 카드는 기초0을 유지하고 상세 unsafe 잔액은 저장하지 않는다', async () => {
    const onAdd = vi.fn();
    const onCorrect = vi.fn();
    const { unmount } = render(<AccountModal {...base} accounts={[]} onAdd={onAdd} />);
    fireEvent.change(screen.getByPlaceholderText('기업은행 1234-56'), { target: { value: '카드' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '카드' } });
    fireEvent.change(screen.getByPlaceholderText('기초 잔액'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(onAdd).not.toHaveBeenCalled();
    unmount();
    render(<AccountModal {...base} onCorrect={onCorrect} />);
    fireEvent.click(screen.getByRole('button', { name: /메인통장/ }));
    fireEvent.change(screen.getByLabelText('현재 잔액'), { target: { value: '9007199254740992' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('정수 잔액');
    expect(onCorrect).not.toHaveBeenCalled();
  });
});

describe('자금 합계와 계좌 카드의 오늘 기준',()=>{
 beforeEach(()=>vi.useFakeTimers({toFake:['Date']}));afterEach(()=>vi.useRealTimers());
 it.each([['2026-10-15','2026-10-16'],['2026-10-31','2026-11-01'],['2026-12-31','2027-01-01']])('%s에서 %s로 바뀌면 같은 배열의 합계와 개별 잔액이 함께 갱신된다',(first,next)=>{
  vi.setSystemTime(new Date(first+'T12:00:00+09:00'));const onWrite=vi.fn(),cashEntries=[{id:'future',companyId:'taebaek' as const,cashAccountId:account.id,date:next,dir:'입금' as const,amount:2000,createdAt:next+'T00:00:00+09:00'}];const props={companyId:'taebaek' as const,cashAccounts:[account],cashEntries,accountCodes:[],partners:[],issuedStatements:[],settlements:[],onAddCashAccount:onWrite,onUpdateCashAccount:onWrite,onAddCashEntry:onWrite,onDeleteCashEntry:onWrite,onAddSettlement:onWrite,onDeleteSettlement:onWrite};const view=render(<CashLedger {...props}/>);expect(screen.getByText('보유 자금 (통장+현금)').parentElement).toHaveTextContent('1,000원');expect(screen.getByRole('button',{name:/메인통장 1,000/})).toBeInTheDocument();const oldDates=Array.from(view.container.querySelectorAll('input[type="date"]'),input=>(input as HTMLInputElement).value);vi.setSystemTime(new Date(next+'T00:05:00+09:00'));view.rerender(<CashLedger {...props}/>);expect(screen.getByText('보유 자금 (통장+현금)').parentElement).toHaveTextContent('3,000원');expect(screen.getByRole('button',{name:/메인통장 3,000/})).toBeInTheDocument();expect(Array.from(view.container.querySelectorAll('input[type="date"]'),input=>(input as HTMLInputElement).value)).toEqual(oldDates);expect(onWrite).not.toHaveBeenCalled();
 });
 it('날짜가 지나도 열어 둔 계좌 수정 초안은 변경하지 않는다',()=>{vi.setSystemTime(new Date('2026-10-15T12:00:00+09:00'));const onCorrect=vi.fn(),view=render(<AccountModal {...base} onCorrect={onCorrect}/>);fireEvent.click(screen.getByRole('button',{name:/메인통장/}));fireEvent.change(screen.getByLabelText('계좌 이름'),{target:{value:'작성 중 이름'}});fireEvent.change(screen.getByLabelText('현재 잔액'),{target:{value:'2345'}});vi.setSystemTime(new Date('2026-10-16T00:05:00+09:00'));view.rerender(<AccountModal {...base} onCorrect={onCorrect}/>);expect(screen.getByLabelText('계좌 이름')).toHaveValue('작성 중 이름');expect(screen.getByLabelText('현재 잔액')).toHaveValue('2,345');expect(onCorrect).not.toHaveBeenCalled();});
});

it('자금 조회 초기화는 당월만 복원하며 일반전표 행동은 패널 밖에서 유지한다',()=>{const write=vi.fn();render(<CashLedger companyId="taebaek" cashAccounts={[account]} cashEntries={[]} accountCodes={[]} partners={[]} issuedStatements={[]} settlements={[]} onAddCashAccount={write} onUpdateCashAccount={write} onAddCashEntry={write} onDeleteCashEntry={write} onAddSettlement={write} onDeleteSettlement={write}/>);const query=screen.getByRole('region',{name:'검색조건'}),from=screen.getByLabelText('자금 조회 시작일'),to=screen.getByLabelText('자금 조회 종료일');expect(query).not.toContainElement(screen.getByRole('button',{name:'일반전표'}));fireEvent.change(from,{target:{value:'2025-01-01'}});fireEvent.click(screen.getByRole('button',{name:'초기화'}));expect(from).toHaveValue(monthStart());expect(to).toHaveValue(today());expect(write).not.toHaveBeenCalled();});
