/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen,waitFor,cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoucherComposer from './VoucherComposer';
import type { AccountCode, FixedCostTemplate, Partner } from '../../src/shared/types';
import { appConfirm } from '../../src/shared/components/appDialog';

vi.mock('../../src/shared/firebase',()=>({auth:{currentUser:{uid:'test-auth-uid'}},authReady:Promise.resolve(),functions:{}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(auth:{currentUser:{uid:string}|null},listener:(user:{uid:string}|null)=>void)=>{listener(auth.currentUser);return()=>{};}}));
vi.mock('../../src/features/statements/infrastructure/issueTradeStatementCommand',()=>({recordPartnerPayment:vi.fn()}));
vi.mock('../../src/features/statements/infrastructure/partnerPaymentRecovery',async importOriginal=>({...await importOriginal<typeof import('../../src/features/statements/infrastructure/partnerPaymentRecovery')>(),readPartnerPaymentRecoveries:vi.fn().mockResolvedValue([])}));
vi.mock('../../src/shared/useLoanContracts', () => ({ useLoanContracts: () => [] }));
vi.mock('../../src/shared/components/appDialog', () => ({
  appConfirm: vi.fn(), appNotice: vi.fn(), appPrompt: vi.fn().mockResolvedValueOnce('수협 일반전표').mockResolvedValueOnce('은행'),
}));

const accounts = [
  { id: 'expense', code: '828', name: '지급수수료', normalBalance: 'debit' },
  { id: 'payable', code: '253', name: '미지급금', normalBalance: 'credit' },
] as AccountCode[];
const partner = { id: 'bank', name: '수협은행' } as Partner;
function setup(statementType: '비용' | '매출' | '매입', overrides: Partial<FixedCostTemplate> = {},issue=vi.fn()) {
  const onAddIssuedStatement = issue, onAddFixedCostTemplate = vi.fn();
  const t = { id: 'test-template', kind: 'voucher', name: '은행 템플릿', dir: '대체', mode: '일반',
    statementType, accountCode: '828', amount: 110_000, taxExempt: false, partnerId: 'bank', partnerName: '수협은행',
    ...(statementType === '비용' ? { transferLines: [{ accountCode: '828', side: '차변' }, { accountCode: '253', side: '대변' }] } : {}),
    ...overrides,
  } as FixedCostTemplate;
  render(<VoucherComposer companyId="taebaek" initialDir={statementType === '매입' ? '줄돈' : statementType === '매출' ? '받을돈' : '대체'} initialDate="2026-09-28"
    partners={[partner, { id: 'other-bank', name: '다른은행' } as Partner]} accountCodes={accounts} accountGroups={[]} cashAccounts={[]} fixedCostTemplates={[t]}
    cashEntries={[]} statements={[]} partnerBalances={new Map()} getBalance={s => s.totalAmount}
    cashAccountId="" onCashAccountId={vi.fn()} onClose={vi.fn()} onAddIssuedStatement={onAddIssuedStatement}
    onAddFixedCostTemplate={onAddFixedCostTemplate} recordPayment={vi.fn()} renderJournal={() => null} />);
  return { onAddIssuedStatement, onAddFixedCostTemplate, template: t };
}
async function pick(u: ReturnType<typeof userEvent.setup>) {
  await u.click(screen.getByRole('button', { name: /템플릿 ▾/ }));
  await u.click(await screen.findByRole('button', { name: /은행 템플릿/ }));
}

describe('종류와 거래처가 독립인 실제 전표 작성', () => {
  beforeEach(() => {localStorage.clear(); vi.spyOn(window, 'alert').mockImplementation(() => {}); });
  it('명시 종류 없는 옛 대체 양식은 거래처가 있어도 수동 대체로 저장하고 원양식을 바꾸지 않는다', async () => {
    const u = userEvent.setup();
    const legacy = { statementType: undefined, transferLines: [{ accountCode: '828', side: '차변' as const }, { accountCode: '253', side: '대변' as const }] };
    const { onAddIssuedStatement, onAddFixedCostTemplate, template } = setup('비용', legacy);
    const original = structuredClone(template);
    await pick(u);
    expect(screen.getByRole('button', { name: /^대체$/ })).toHaveAttribute('aria-pressed', 'true');
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onAddIssuedStatement).toHaveBeenCalledWith(expect.objectContaining({ type: '비용', partnerId: 'bank', totalTax: 0, totalAmount: 110000,
      items: [expect.objectContaining({ side: '차변', accountCode: '828' }), expect.objectContaining({ side: '대변', accountCode: '253' })] }));
    expect(template).toEqual(original); expect(onAddFixedCostTemplate).not.toHaveBeenCalled();
  });
  it('대체 양식에서 거래처를 바꿔도 종류와 양변이 바뀌지 않는다', async () => {
    const u = userEvent.setup(); const { onAddIssuedStatement } = setup('비용'); await pick(u);
    const search = screen.getByPlaceholderText('업체명 검색...');
    await u.clear(search); await u.type(search, '다른은행');
    await u.click(screen.getByRole('button', { name: '다른은행' }));
    expect(screen.getByRole('button', { name: /^대체$/ })).toHaveAttribute('aria-pressed', 'true');
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onAddIssuedStatement).toHaveBeenCalledWith(expect.objectContaining({ type: '비용', partnerId: 'other-bank', totalAmount: 110000 }));
  });
  it('현재 매입 갈래에는 명시 매출 양식을 보여주지 않는다', async () => {
    const u = userEvent.setup(); const { onAddIssuedStatement } = setup('매출');
    await u.click(screen.getByRole('button', { name: /^매입$/ }));
    await u.click(screen.getByRole('button', { name: /템플릿 ▾/ }));
    expect(screen.queryByRole('button', { name: /은행 템플릿/ })).toBeNull();
    expect(onAddIssuedStatement).not.toHaveBeenCalled();
  });
  it('명시 매출과 줄돈 방향이 모순인 양식은 매출 갈래에서도 숨긴다', async () => {
    const u = userEvent.setup(); setup('매출', { dir: '줄돈' });
    await u.click(screen.getByRole('button', { name: /템플릿 ▾/ }));
    expect(screen.queryByRole('button', { name: /은행 템플릿/ })).toBeNull();
  });
  it('상단 여섯 갈래를 직접 고르며 같은 갈래 클릭은 양식과 거래처를 유지한다', async () => {
    const u = userEvent.setup(); const { onAddIssuedStatement } = setup('비용'); await pick(u);
    for (const name of ['매입', '매출', '대체', '입금', '출금', '회사이체']) expect(screen.getByRole('button', { name: new RegExp(`^${name}$`) })).toBeInTheDocument();
    expect(screen.queryByLabelText('전표종류')).toBeNull();
    await u.click(screen.getByRole('button', { name: /^대체$/ }));
    expect(screen.getByPlaceholderText('업체명 검색...')).toHaveValue('수협은행');
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onAddIssuedStatement).toHaveBeenCalledWith(expect.objectContaining({ type: '비용', partnerId: 'bank', totalAmount: 110000 }));
  });
  it('거래처가 비어 있는 매입 템플릿도 과세 선택은 유지한다', async () => {
    const u = userEvent.setup(); setup('매입', { partnerId: '', partnerName: '' }); await pick(u);
    expect(screen.getByRole('button', { name: /^매입$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox', { name: /면세/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });
  it('대체 양변을 매입으로 전환할 때 확인 전에는 유지하고 확인 뒤 비워 중복 합산을 막는다', async () => {
    const u = userEvent.setup(); const { onAddIssuedStatement } = setup('비용'); await pick(u);
    const formValues = () => [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')].map(el => el.value);
    const originalValues = formValues();
    vi.mocked(appConfirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await u.click(screen.getByRole('button', { name: /^매입$/ }));
    expect(screen.getByRole('button', { name: /^대체$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(formValues()).toEqual(originalValues);
    expect(screen.getByPlaceholderText('업체명 검색...')).toHaveValue('수협은행');
    await u.click(screen.getByRole('button', { name: /^매입$/ }));
    expect(screen.getByRole('button', { name: /^매입$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByPlaceholderText('업체명 검색...')).toHaveValue('');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(onAddIssuedStatement).not.toHaveBeenCalled();
  });
  it('거래처가 붙은 일반 대체 양식은 두 계정과 종류를 보존해 저장한다', async () => {
    const u = userEvent.setup(); const { onAddIssuedStatement } = setup('비용'); await pick(u);
    expect(screen.getByRole('button', { name: /^대체$/ })).toHaveAttribute('aria-pressed', 'true');
    await u.click(screen.getByRole('button', { name: '저장' }));
    expect(onAddIssuedStatement).toHaveBeenCalledWith(expect.objectContaining({ type: '비용', partnerId: 'bank', totalTax: 0, totalAmount: 110_000,
      items: [expect.objectContaining({ accountCode: '828', side: '차변' }), expect.objectContaining({ accountCode: '253', side: '대변' })] }));
  });
  it('같은 거래처 템플릿에서 매출을 선택하면 과세 매출로 저장한다', async () => {
    const u = userEvent.setup(); const { onAddIssuedStatement } = setup('매출'); await pick(u);
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

it('대체 원문도 응답유실 뒤 재열기에서 같은 ID·양변·금액으로 재개한다',async()=>{localStorage.clear();const u=userEvent.setup(),save=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValueOnce({id:'saved'});vi.spyOn(window,'alert').mockImplementation(()=>{});setup('비용',{},save);await pick(u);await u.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));cleanup();setup('비용',{},save);await u.click(await screen.findByRole('button',{name:'이전 전표 재시도'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);expect(localStorage.length).toBe(0);});
