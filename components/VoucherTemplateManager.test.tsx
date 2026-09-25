/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoucherTemplateManager from './VoucherTemplateManager';
import type { AccountCode, FixedCostTemplate } from '../src/shared/types';

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
    await u.click(screen.getByTitle('이름·묶음·금액·발행 방식 수정'));
    await u.selectOptions(screen.getByLabelText('계정과목'), '951');
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onUpdate).toHaveBeenCalledWith('punghoe-interest', expect.objectContaining({ accountCode: '951' }));
  });
});
