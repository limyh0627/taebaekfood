/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoucherTemplateManager from './VoucherTemplateManager';
import type { FixedCostTemplate, AccountCode } from '../src/shared/types';
const dialogs = vi.hoisted(() => ({ notice: vi.fn(), confirm: vi.fn() }));
vi.mock('../src/shared/components/appDialog', () => ({ appNotice: dialogs.notice, appConfirm: dialogs.confirm, appPrompt: vi.fn() }));
vi.mock('../src/shared/useLoanContracts', () => ({ useLoanContracts: () => [] }));
const template = { id: 't', name: '보험료', companyId: 'taebaek', amount: 1000, category: '기타', active: false, kind: 'voucher', dir: '출금', mode: '일반', accountCode: '951' } as FixedCostTemplate;
const accounts = [{ id: 'a', code: '951', name: '이자비용' }] as AccountCode[];
beforeEach(() => {
  dialogs.notice.mockReset().mockResolvedValue(undefined);
  dialogs.confirm.mockReset().mockResolvedValue(true);
});
describe('템플릿 상세보기', () => {
  it('목록에는 조작이 없고 행을 열어도 쓰지 않는다', async () => {
    const update = vi.fn();
    const remove = vi.fn();
    render(<VoucherTemplateManager templates={[template]} accountCodes={accounts} onUpdate={update} onDelete={remove} />);
    expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();
    expect(screen.queryByRole('button', { name: '수정' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '보험료 상세보기' }));
    expect(screen.getByText('템플릿 상세보기')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it('기본 템플릿 삭제를 막고 숨기기는 허용한다', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn();
    render(<VoucherTemplateManager templates={[{ ...template, builtin: '기본' }]} accountCodes={accounts} onUpdate={update} onDelete={remove} />);
    await userEvent.click(screen.getByRole('button', { name: '보험료 상세보기' }));
    expect(screen.getByRole('button', { name: '삭제' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    await userEvent.click(screen.getByRole('button', { name: '숨기기' }));
    expect(update).toHaveBeenCalledWith('t', { hidden: true });
    expect(remove).not.toHaveBeenCalled();
  });
  it('상세는 갱신된 props를 보여 준다', async () => {
    const props = { accountCodes: accounts, onUpdate: vi.fn() };
    const view = render(<VoucherTemplateManager {...props} templates={[template]} />);
    await userEvent.click(screen.getByRole('button', { name: '보험료 상세보기' }));
    view.rerender(<VoucherTemplateManager {...props} templates={[{ ...template, name: '수정 보험', amount: 2300, favorite: true }]} />);
    expect(screen.getByRole('button', { name: '즐겨찾기 해제' })).toBeInTheDocument();
    expect(screen.getAllByText('2,300원').length).toBeGreaterThan(0);
  });
  it('응답 전 중복 실행을 막고 실패해도 상세를 유지한다', async () => {
    let reject!: (error: Error) => void;
    const update = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    render(<VoucherTemplateManager templates={[template]} accountCodes={accounts} onUpdate={update} />);
    await userEvent.click(screen.getByRole('button', { name: '보험료 상세보기' }));
    const button = screen.getByRole('button', { name: '즐겨찾기 추가' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(update).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    reject(new Error('실패'));
    await waitFor(() => expect(dialogs.notice).toHaveBeenCalled());
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.getByText('템플릿 상세보기')).toBeInTheDocument();
  });
  it('편집과 복제를 열면 상세는 닫히고 취소하면 상세로 돌아온다', async () => {
    render(<VoucherTemplateManager templates={[template]} accountCodes={accounts} onUpdate={vi.fn()} onCreate={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '보험료 상세보기' }));
    await userEvent.click(screen.getByRole('button', { name: '수정' }));
    expect(screen.queryByText('템플릿 상세보기')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.getByText('템플릿 상세보기')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '복제' }));
    expect(screen.getByText('새 템플릿 만들기')).toBeInTheDocument();
    expect(screen.queryByText('템플릿 상세보기')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.getByText('템플릿 상세보기')).toBeInTheDocument();
  });
});
