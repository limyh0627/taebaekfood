/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoucherComposer from './VoucherComposer';
import VoucherTemplateManager from '../VoucherTemplateManager';
import { CashTemplateModal } from '../../src/shared/cashTemplates';
import { matchingLoan, loanBalance, type LoanContract } from '../../src/shared/loanLedger';
import { canAutoIssue } from '../../src/shared/autoVoucher';
import type { AccountCode, FixedCostTemplate } from '../../src/shared/types';

const state = vi.hoisted(() => ({ loans: [] as LoanContract[], notice: vi.fn() }));
vi.mock('../../src/shared/useLoanContracts', () => ({ useLoanContracts: () => state.loans }));
vi.mock('../../src/shared/components/appDialog', () => ({ appNotice: state.notice, appConfirm: async () => true, appPrompt: async () => '저장한 상환' }));
const loan: LoanContract = { id: 'l1', companyId: 'taebaek', name: '운전자금', lenderName: '농협', accountCode: '260', openingDate: '2026-01-01', openingPrincipal: 10000, createdAt: '2026-01-01' };
const accounts = [{ id: '260', code: '260', name: '단기차입금', type: '부채' }, { id: '293', code: '293', name: '장기차입금', type: '부채' }, { id: '951', code: '951', name: '이자비용', type: '비용' }] as AccountCode[];
const template = (extra: Partial<FixedCostTemplate> = {}): FixedCostTemplate => ({ id: 't1', companyId: 'taebaek', name: '계약 상환', kind: 'voucher', category: '기타', active: false, amount: 1100, accountCode: '260', mode: '상환', dir: '출금', principal: 1000, interest: 100, loanCode: '260', loanId: 'l1', ...extra });
beforeEach(() => { state.loans = [loan]; state.notice.mockReset().mockResolvedValue(undefined); vi.spyOn(window, 'alert').mockImplementation(() => {}); });
function view(templates = [template()], save = vi.fn(), close = vi.fn(), create = vi.fn(), bank = 'bank') {
  render(<VoucherComposer companyId="taebaek" initialDir="출금" initialDate="2026-09-27" partners={[]} accountCodes={accounts} accountGroups={[]} cashAccounts={[{ id: 'bank', name: '농협', active: true } as never]} fixedCostTemplates={templates} cashEntries={[]} statements={[]} partnerBalances={new Map()} getBalance={() => 0} cashAccountId={bank} onCashAccountId={() => {}} onClose={close} onAddCashEntry={save} onAddFixedCostTemplate={create} recordPayment={() => {}} renderJournal={() => null} />);
  return { save, close, create };
}
async function pick(u: ReturnType<typeof userEvent.setup>, name = '계약 상환') {
  await u.click(screen.getByRole('button', { name: /템플릿 ▾/ }));
  await u.click(screen.getByRole('button', { name: new RegExp(name) }));
}
describe('계약 상환 연결', () => {
  it('출금 계좌를 선택하지 않은 상환은 기록하지 않는다', async () => {
    const u = userEvent.setup(); const save = vi.fn(), close = vi.fn();
    view([template()], save, close, vi.fn(), ''); await pick(u);
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('계좌를 선택'));
  });
  it('동일 회사·원금계정 계약만 연결하고 원금만 잔액에서 뺀다', async () => {
    state.loans.push({ ...loan, id: 'foreign', companyId: 'punghoe' }, { ...loan, id: 'long', accountCode: '293' });
    const u = userEvent.setup(); const { save } = view(); await pick(u);
    expect(screen.getByLabelText('대출 건 연결')).toHaveValue('l1');
    expect(within(screen.getByLabelText('대출 건 연결')).getAllByRole('option').map(o => (o as HTMLOptionElement).value)).toEqual(['', 'l1']);
    await u.click(screen.getByRole('button', { name: '저장' }));
    const entry = save.mock.calls[0][0];
    expect(entry.loanId).toBe('l1'); expect(entry.companyId).toBe('taebaek');
    expect(entry.amount).toBe(1100); expect(entry.lines.map((l: { amount: number }) => l.amount)).toEqual([1000, 100]);
    expect(loanBalance(loan, [entry])).toBe(9000);
  });
  it.each(['없는계약', '다른회사', '다른계정'])('잘못된 연결 %s는 발행을 막고 입력을 유지한다', async kind => {
    state.loans = kind === '없는계약' ? [] : [{ ...loan, ...(kind === '다른회사' ? { companyId: 'punghoe' as const } : { accountCode: '293' as const }) }];
    const u = userEvent.setup(); const { save, close } = view(); await pick(u);
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('다시 선택'));
  });
  it('계약 없는 옛 템플릿을 고르면 앞 계약 연결을 지운다', async () => {
    const u = userEvent.setup(); const { save } = view([template(), template({ id: 'old', name: '옛 상환', loanId: '' })]);
    await pick(u); await pick(u, '옛 상환');
    expect(screen.getByLabelText('대출 건 연결')).toHaveValue('');
    await u.click(screen.getByRole('button', { name: '저장' })); expect(save.mock.calls[0][0].loanId).toBeUndefined();
  });
  it('저장 응답 전 중복클릭을 막고 실패 재시도는 같은 ID를 보존한다', async () => {
    let reject!: (e: Error) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise((_r, j) => { reject = j; })).mockResolvedValue(undefined);
    const u = userEvent.setup(); const { close } = view([template()], save); await pick(u);
    const button = screen.getByRole('button', { name: '저장' }); fireEvent.click(button); fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled();
    reject(new Error('응답 실패')); await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(screen.getByLabelText('원금')).toHaveValue('1,000');
    expect(screen.getByLabelText('이자')).toHaveValue('100');
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(save).toHaveBeenCalledTimes(2); expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]); expect(close).toHaveBeenCalledTimes(1);
  });
  it('템플릿 저장은 원금·이자·계약을 보존하고 자동발행은 끈다', async () => {
    const u = userEvent.setup(); const { create } = view(); await pick(u);
    await u.click(screen.getByRole('button', { name: '템플릿 저장' }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ amount: 1100, principal: 1000, interest: 100, loanId: 'l1', loanCode: '260', autoIssue: false }));
  });
  it('계약 연결 템플릿은 자동 발행 대상이 되지 않는다', () => {
    expect(canAutoIssue(template({ autoIssue: true }), '2026-09')).toBe(false);
    expect(canAutoIssue(template({ autoIssue: true, loanId: '' }), '2026-09')).toBe(true);
    expect(matchingLoan(state.loans, 'punghoe', 'l1', '260')).toBeUndefined();
  });
  it('관리 화면에서도 자동 켜기와 잘못된 연결 저장을 차단한다', async () => {
    const u = userEvent.setup(); const update = vi.fn();
    render(<VoucherTemplateManager companyId="taebaek" templates={[template()]} accountCodes={accounts} onUpdate={update} />);
    await u.click(screen.getByRole('button', { name: '계약 상환 상세보기' }));
    await u.click(screen.getByTitle('자동 발행 켜기'));
    await waitFor(() => expect(screen.getByTitle('자동 발행 켜기')).not.toBeDisabled());
    expect(update).not.toHaveBeenCalled();
    await u.click(screen.getByTitle('이름·묶음·금액·발행 방식 수정'));
    await u.click(screen.getByRole('checkbox', { name: /자동 발행/ }));
    expect(screen.getByRole('checkbox', { name: /자동 발행/ })).not.toBeChecked();
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(update).toHaveBeenCalledWith('t1', expect.objectContaining({ loanId: 'l1', principal: 1000, interest: 100, autoIssue: false }));
  });
  it('관리 화면은 사라진 계약과 이미 켜진 자동발행을 저장하지 않는다', async () => {
    state.loans = [];
    const u = userEvent.setup(); const update = vi.fn();
    render(<VoucherTemplateManager companyId="taebaek" templates={[template({ autoIssue: true })]} accountCodes={accounts} onUpdate={update} />);
    await u.click(screen.getByRole('button', { name: '계약 상환 상세보기' }));
    await u.click(screen.getByTitle('이름·묶음·금액·발행 방식 수정'));
    await u.click(screen.getByRole('button', { name: '저장' })); expect(update).not.toHaveBeenCalled();
    state.loans = [loan];
    await u.selectOptions(screen.getByLabelText('대출 건 연결'), '');
    await u.selectOptions(screen.getByLabelText('대출 건 연결'), 'l1');
    await u.click(screen.getByRole('button', { name: '저장' })); expect(update).not.toHaveBeenCalled();
    expect(state.notice).toHaveBeenLastCalledWith(expect.stringContaining('수동 발행'));
  });
  it('선택 모달은 그룹·방향·즐겨찾기·검색을 함께 적용하고 높이를 유지한다', async () => {
    const u = userEvent.setup(); render(<CashTemplateModal templates={[
      { id: '1', label: '농협 상환', group: '대출', favorite: true, mode: '상환', dir: '출금' },
      { id: '2', label: '기업 상환', group: '대출', mode: '상환', dir: '출금' },
      { id: '3', label: '보험료', group: '보험', favorite: true, mode: '일반', dir: '출금' },
      { id: '4', label: '대출 실행', group: '대출', mode: '일반', dir: '입금' },
    ]} accountCodes={accounts} activeId={null} onPick={() => {}} onDirect={() => {}} onClose={() => {}} />);
    await u.selectOptions(screen.getByLabelText('템플릿 그룹'), '대출'); await u.click(screen.getByRole('button', { name: '출금' }));
    expect(screen.queryByRole('button', { name: /보험료/ })).toBeNull(); expect(screen.queryByRole('button', { name: /대출 실행/ })).toBeNull();
    await u.click(screen.getByRole('button', { name: '★' })); expect(screen.queryByRole('button', { name: /기업 상환/ })).toBeNull();
    await u.type(screen.getByPlaceholderText('이름·거래처·계정 검색'), '없음'); expect(screen.queryByRole('button', { name: /농협 상환/ })).toBeNull();
    expect(screen.getByRole('dialog')).toHaveClass('h-[80dvh]');
  });
});
