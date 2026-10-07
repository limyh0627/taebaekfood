/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoucherTemplateManager from './VoucherTemplateManager';
import type { AccountCode, FixedCostTemplate } from '../src/shared/types';
import { appNotice } from '../src/shared/components/appDialog';

vi.mock('../src/shared/useLoanContracts', () => ({ useLoanContracts: () => [] }));
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
  it('구형 비지원 대체는 이름만 저장해도 자동 발행을 활성화하지 않는다', async () => {
    const u = userEvent.setup(); const onUpdate = vi.fn();
    render(<VoucherTemplateManager templates={[{ ...template, dir: '대체', amount: 100, accountCode: '951', autoIssue: true,
      transferLines: [{ accountCode: '951', side: '차변' }, { accountCode: '253', side: '대변' }] }]}
      accountCodes={[...accounts, { id: '253', code: '253', name: '미지급금' } as AccountCode]} onUpdate={onUpdate} />);
    await u.click(screen.getByRole('button', { name: '이자 (풍회) 상세보기' }));
    await u.click(screen.getByTitle('이름·묶음·금액·발행 방식 수정'));
    expect(screen.getByRole('checkbox', { name: /자동 발행/ })).not.toBeChecked();
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onUpdate).toHaveBeenCalledWith(template.id, expect.objectContaining({ statementType: '비용', autoIssue: false }));
  });
  it('구형 비지원 대체도 사용자가 직접 자동 발행을 선택하면 저장한다', async () => {
    const u = userEvent.setup(); const onUpdate = vi.fn();
    render(<VoucherTemplateManager templates={[{ ...template, dir: '대체', amount: 100, accountCode: '951', autoIssue: true,
      transferLines: [{ accountCode: '951', side: '차변' }, { accountCode: '253', side: '대변' }] }]}
      accountCodes={[...accounts, { id: '253', code: '253', name: '미지급금' } as AccountCode]} onUpdate={onUpdate} />);
    await u.click(screen.getByRole('button', { name: '이자 (풍회) 상세보기' }));
    await u.click(screen.getByTitle('이름·묶음·금액·발행 방식 수정'));
    const toggle = screen.getByRole('checkbox', { name: /자동 발행/ });
    expect(toggle).not.toBeChecked(); await u.click(toggle);
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onUpdate).toHaveBeenCalledWith(template.id, expect.objectContaining({ statementType: '비용', autoIssue: true }));
  });
  it('구형 자동 발행 가능한 매입 양식의 체크는 보존한다', async () => {
    const u = userEvent.setup(); const onUpdate = vi.fn();
    render(<VoucherTemplateManager templates={[{ ...template, dir: '줄돈', amount: 100, accountCode: '951', partnerId: 'bank', autoIssue: true }]}
      accountCodes={accounts} onUpdate={onUpdate} />);
    await u.click(screen.getByRole('button', { name: '이자 (풍회) 상세보기' }));
    await u.click(screen.getByTitle('이름·묶음·금액·발행 방식 수정'));
    expect(screen.getByRole('checkbox', { name: /자동 발행/ })).toBeChecked();
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onUpdate).toHaveBeenCalledWith(template.id, expect.objectContaining({ statementType: '매입', autoIssue: true }));
  });
  it('줄돈과 다른 명시 종류는 저장하지 않고 바로잡도록 안내한다', async () => {
    const u = userEvent.setup(); const onUpdate = vi.fn();
    render(<VoucherTemplateManager templates={[{ ...template, dir: '줄돈', statementType: '매입', accountCode: '951', partnerId: 'bank' }]}
      accountCodes={accounts} onUpdate={onUpdate} />);
    await u.click(screen.getByRole('button', { name: '이자 (풍회) 상세보기' }));
    await u.click(screen.getByTitle('이름·묶음·금액·발행 방식 수정'));
    await u.selectOptions(screen.getByLabelText('전표종류'), '매출');
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(appNotice).toHaveBeenCalledWith('줄돈은 매입전표를 선택해 주세요.');
  });
  it('일반 대체 복제는 명시 종류와 양변 양식을 함께 보존한다', async () => {
    const u = userEvent.setup(); const onCreate = vi.fn();
    const transferLines = [{ accountCode: '951', side: '차변' as const }, { accountCode: '253', side: '대변' as const }];
    render(<VoucherTemplateManager templates={[{ ...template, dir: '대체', statementType: '비용', accountCode: '951', transferLines }]}
      accountCodes={accounts} onCreate={onCreate} />);
    await u.click(screen.getByRole('button', { name: '이자 (풍회) 상세보기' }));
    await u.click(screen.getByRole('button', { name: '복제' }));
    await u.click(screen.getByRole('button', { name: '만들기' }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ statementType: '비용', transferLines }));
  });
  it('거래처 없는 균형 대체 양식도 상세에서 자동 발행을 켤 수 있다', async () => {
    const u = userEvent.setup(); const onUpdate = vi.fn();
    render(<VoucherTemplateManager templates={[{ ...template, dir: '대체', statementType: '비용', amount: 100, accountCode: '951',
      transferLines: [{ accountCode: '951', side: '차변' }, { accountCode: '253', side: '대변' }] }]}
      accountCodes={[...accounts, { id: '253', code: '253', name: '미지급금' } as AccountCode]} onUpdate={onUpdate} />);
    await u.click(screen.getByRole('button', { name: '이자 (풍회) 상세보기' }));
    await u.click(screen.getByTitle('자동 발행 켜기'));
    expect(onUpdate).toHaveBeenCalledWith(template.id, { autoIssue: true });
  });
  it('거래처 연결을 유지한 채 일반 대체 종류를 명시해 저장한다', async () => {
    const u = userEvent.setup(); const onUpdate = vi.fn();
    render(<VoucherTemplateManager templates={[{ ...template, dir: '대체', accountCode: '951', partnerId: 'bank', partnerName: '수협은행' }]}
      accountCodes={accounts} onUpdate={onUpdate} />);
    await u.click(screen.getByRole('button', { name: '이자 (풍회) 상세보기' }));
    await u.click(screen.getByTitle('이름·묶음·금액·발행 방식 수정'));
    expect(screen.getByLabelText('전표종류')).toHaveValue('매입');
    await u.selectOptions(screen.getByLabelText('전표종류'), '비용');
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onUpdate).toHaveBeenCalledWith(template.id, expect.objectContaining({ statementType: '비용', partnerId: 'bank' }));
  });
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
