/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoucherComposer from './VoucherComposer';
import type { AccountCode, FixedCostTemplate, Partner } from '../../src/shared/types';
import { appConfirm } from '../../src/shared/components/appDialog';

vi.mock('../../src/shared/useLoanContracts', () => ({ useLoanContracts: () => [] }));
vi.mock('../../src/shared/components/appDialog', () => ({
  appConfirm: vi.fn(), appNotice: vi.fn(), appPrompt: vi.fn().mockResolvedValueOnce('수협 일반전표').mockResolvedValueOnce('은행'),
}));

const accounts = [
  { id: 'expense', code: '828', name: '지급수수료', normalBalance: 'debit' },
  { id: 'payable', code: '253', name: '미지급금', normalBalance: 'credit' },
] as AccountCode[];
const partner = { id: 'bank', name: '수협은행' } as Partner;
function setup(statementType: '비용' | '매출' | '매입', overrides: Partial<FixedCostTemplate> = {}) {
  const onAddIssuedStatement = vi.fn(), onAddFixedCostTemplate = vi.fn();
  const t = { id: 'test-template', kind: 'voucher', name: '은행 템플릿', dir: '대체', mode: '일반',
    statementType, accountCode: '828', amount: 110_000, taxExempt: false, partnerId: 'bank', partnerName: '수협은행',
    ...(statementType === '비용' ? { transferLines: [{ accountCode: '828', side: '차변' }, { accountCode: '253', side: '대변' }] } : {}),
    ...overrides,
  } as FixedCostTemplate;
  render(<VoucherComposer companyId="taebaek" initialDir="대체" initialDate="2026-09-28"
    partners={[partner, { id: 'other-bank', name: '다른은행' } as Partner]} accountCodes={accounts} accountGroups={[]} cashAccounts={[]} fixedCostTemplates={[t]}
    cashEntries={[]} statements={[]} partnerBalances={new Map()} getBalance={s => s.totalAmount}
    cashAccountId="" onCashAccountId={vi.fn()} onClose={vi.fn()} onAddIssuedStatement={onAddIssuedStatement}
    onAddFixedCostTemplate={onAddFixedCostTemplate} recordPayment={vi.fn()} renderJournal={() => null} />);
  return { onAddIssuedStatement, onAddFixedCostTemplate };
}
async function pick(u: ReturnType<typeof userEvent.setup>) {
  await u.click(screen.getByRole('button', { name: /템플릿 ▾/ }));
  await u.click(await screen.findByRole('button', { name: /은행 템플릿/ }));
}

describe('종류와 거래처가 독립인 실제 전표 작성', () => {
  beforeEach(() => { vi.spyOn(window, 'alert').mockImplementation(() => {}); });
  it('대체 양식에서 거래처를 바꿔도 종류와 양변이 바뀌지 않는다', async () => {
    const u = userEvent.setup(); const { onAddIssuedStatement } = setup('비용'); await pick(u);
    const search = screen.getByPlaceholderText('업체명 검색...');
    await u.clear(search); await u.type(search, '다른은행');
    await u.click(screen.getByRole('button', { name: '다른은행' }));
    expect(screen.getByLabelText('전표종류')).toHaveValue('비용');
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onAddIssuedStatement).toHaveBeenCalledWith(expect.objectContaining({ type: '비용', partnerId: 'other-bank', totalAmount: 110000 }));
  });
  it('줄돈에 명시 매출 양식을 고르면 저장을 막고 수정할 내용을 보인다', async () => {
    const u = userEvent.setup(); const { onAddIssuedStatement } = setup('매출', { dir: '줄돈' }); await pick(u);
    expect(screen.getByRole('alert')).toHaveTextContent('줄돈은 매입전표');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(onAddIssuedStatement).not.toHaveBeenCalled();
  });
  it('거래처가 비어 있는 매입 템플릿도 과세 선택은 유지한다', async () => {
    const u = userEvent.setup(); setup('매입', { partnerId: '', partnerName: '' }); await pick(u);
    expect(screen.getByLabelText('전표종류')).toHaveValue('매입');
    expect(screen.getByRole('checkbox', { name: /면세/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });
  it('대체 양변을 매입으로 전환할 때 확인 전에는 유지하고 확인 뒤 비워 중복 합산을 막는다', async () => {
    const u = userEvent.setup(); const { onAddIssuedStatement } = setup('비용'); await pick(u);
    vi.mocked(appConfirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await u.selectOptions(screen.getByLabelText('전표종류'), '매입');
    expect(screen.getByLabelText('전표종류')).toHaveValue('비용');
    await u.selectOptions(screen.getByLabelText('전표종류'), '매입');
    expect(screen.getByLabelText('전표종류')).toHaveValue('매입');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(onAddIssuedStatement).not.toHaveBeenCalled();
  });
  it('거래처가 붙은 일반 대체 양식은 두 계정과 종류를 보존해 저장한다', async () => {
    const u = userEvent.setup(); const { onAddIssuedStatement } = setup('비용'); await pick(u);
    expect(screen.getByLabelText('전표종류')).toHaveValue('비용');
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onAddIssuedStatement).toHaveBeenCalledWith(expect.objectContaining({ type: '비용', partnerId: 'bank', totalTax: 0, totalAmount: 110_000,
      items: [expect.objectContaining({ accountCode: '828', side: '차변' }), expect.objectContaining({ accountCode: '253', side: '대변' })] }));
  });
  it('같은 거래처 템플릿에서 매출을 선택하면 과세 매출로 저장한다', async () => {
    const u = userEvent.setup(); const { onAddIssuedStatement } = setup('매입'); await pick(u);
    await u.selectOptions(screen.getByLabelText('전표종류'), '매출');
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onAddIssuedStatement).toHaveBeenCalledWith(expect.objectContaining({ type: '매출', totalSupply: 100_000, totalTax: 10_000, partnerId: 'bank' }));
  });
  it('전표에서 템플릿 저장 시 명시 종류와 차·대 양식·금액을 저장한다', async () => {
    const u = userEvent.setup(); const { onAddFixedCostTemplate } = setup('비용'); await pick(u);
    await u.click(screen.getByRole('button', { name: '템플릿 저장' }));
    expect(onAddFixedCostTemplate).toHaveBeenCalledWith(expect.objectContaining({ statementType: '비용', amount: 110_000, accountCode: '828',
      transferLines: [expect.objectContaining({ accountCode: '828', side: '차변' }), expect.objectContaining({ accountCode: '253', side: '대변' })] }));
  });
});
