/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoucherTemplateManager from './VoucherTemplateManager';
import { appNotice } from '../src/shared/components/appDialog';
import type { AccountCode, FixedCostTemplate } from '../src/shared/types';

const loan = vi.hoisted(() => ({ id: 'loan', companyId: 'taebaek', name: '운전자금', lenderName: '은행', accountCode: '260', openingDate: '2026-07-31', openingPrincipal: 1000 }));
vi.mock('../src/shared/useLoanContracts', () => ({ useLoanContracts: () => [loan] }));
vi.mock('../src/shared/components/appDialog', () => ({ appNotice: vi.fn(), appConfirm: vi.fn(), appPrompt: vi.fn() }));

const accounts = [
  { id: 'ac-951', code: '951', name: '이자비용' },
] as AccountCode[];
const template = {
  id: 'punghoe-interest', companyId: 'punghoe', name: '이자 (풍회)',
  amount: 0, category: '기타', active: false, kind: 'voucher',
  dir: '출금', mode: '일반', accountCode: '931',
} as FixedCostTemplate;

describe('풍회 전표 템플릿의 계정 복구', () => {
  it('없는 계정의 사유를 보여 주고 현재 회사 계정으로 바꿔 저장한다', async () => {
    const u = userEvent.setup();
    const onUpdate = vi.fn();
    render(<VoucherTemplateManager templates={[template]} accountCodes={accounts} onUpdate={onUpdate} />);

    expect(screen.getByText('계정 없음')).toBeInTheDocument();
    expect(screen.getByText('현재 회사 계정표에 931 없음')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: '이자 (풍회) 상세보기' }));
    await u.click(screen.getByTitle('이름·묶음·금액·발행 방식 수정'));
    await u.selectOptions(screen.getByLabelText('계정과목'), '951');
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onUpdate).toHaveBeenCalledWith('punghoe-interest', expect.objectContaining({ accountCode: '951' }));
  });
});


it('연결된 정상 상환 양식은 상세에서 사용자가 자동 발행을 직접 켠다', async () => {
  const u = userEvent.setup(), onUpdate = vi.fn();
  const linked = { ...template, id: 'loan-tpl', companyId: 'taebaek' as const, kind: 'recurring' as const, name: '월 상환', mode: '상환' as const, dir: '출금' as const,
    accountCode: '260', loanCode: '260', loanId: 'loan', principal: 100, interest: 10, amount: 110, autoIssue: false };
  render(<VoucherTemplateManager templates={[linked]} accountCodes={[{ id: '260', code: '260', name: '차입금' }, { id: '931', code: '931', name: '이자비용' }] as AccountCode[]} onUpdate={onUpdate} />);
  await u.click(screen.getByRole('button', { name: '월 상환 상세보기' }));
  await u.click(screen.getByRole('button', { name: '자동 발행 켜기' }));
  expect(onUpdate).toHaveBeenCalledWith('loan-tpl', { autoIssue: true });
});

it('다른 회사 계약이나 원금·이자 합계가 틀리면 자동 설정을 저장하지 않는다', async () => {
  const u = userEvent.setup(), onUpdate = vi.fn();
  render(<VoucherTemplateManager templates={[{ ...template, id: 'bad-loan', companyId: 'taebaek', kind: 'recurring', name: '잘못된 상환', mode: '상환', dir: '출금', accountCode: '260', loanCode: '260', loanId: 'loan', principal: 100, interest: 10, amount: 111, autoIssue: false }]}
    accountCodes={[{ id: '260', code: '260', name: '차입금' }, { id: '931', code: '931', name: '이자비용' }] as AccountCode[]} onUpdate={onUpdate} />);
  await u.click(screen.getByRole('button', { name: '잘못된 상환 상세보기' })); await u.click(screen.getByRole('button', { name: '자동 발행 켜기' }));
  expect(onUpdate).not.toHaveBeenCalled(); expect(appNotice).toHaveBeenCalled();
});


it('편집 폼에서도 연결 계약과 분할값을 확인하여 명시적으로 자동 상환을 저장한다', async () => {
  const u = userEvent.setup(), onUpdate = vi.fn();
  const linked = { ...template, id: 'edit-loan', companyId: 'taebaek' as const, kind: 'recurring' as const, name: '상환 편집', mode: '상환' as const, dir: '출금' as const,
    accountCode: '260', loanCode: '260', loanId: 'loan', principal: 100, interest: 10, amount: 110, autoIssue: false };
  render(<VoucherTemplateManager templates={[linked]} accountCodes={[{ id: '260', code: '260', name: '차입금' }, { id: '931', code: '931', name: '이자비용' }] as AccountCode[]} onUpdate={onUpdate} />);
  await u.click(screen.getByRole('button', { name: '상환 편집 상세보기' })); await u.click(screen.getByTitle('이름·묶음·금액·발행 방식 수정'));
  await u.click(screen.getByRole('checkbox', { name: /자동 발행/ }));
  expect(screen.getByRole('checkbox', { name: /자동 발행/ })).toBeChecked();
  await u.click(screen.getByRole('button', { name: '저장' }));
  expect(onUpdate).toHaveBeenCalledWith('edit-loan', expect.objectContaining({ loanId: 'loan', loanCode: '260', principal: 100, interest: 10, amount: 110, autoIssue: true }));
});
