import { describe, expect, it } from 'vitest';
import { autoVoucherDraft, scheduledAccountName, scheduledCashAccountId } from './autoVoucherDraft';
import { buildCashVoucher, buildStatementVoucher, canAutoIssue } from '../../src/shared/autoVoucher';
import { defaultCashAccountId } from '../../src/shared/defaultCashAccount';
import type { AccountCode, CashAccount, FixedCostTemplate } from '../../src/shared/types';

const base = { id: 'rent', companyId: 'taebaek', name: '임대료', amount: 1_000_001, accountCode: '520',
  autoIssue: true, issueDay: 31, partnerId: 'owner', partnerName: '임대인', dir: '줄돈' };
const day = '2026-09-30';
const app = (t: typeof base) => t as FixedCostTemplate;

describe('scheduled voucher contract', () => {
  it('matches app taxable amount, tax, kind and monthly ID on the last day', () => {
    const decision = autoVoucherDraft(base, '2026-09', day);
    expect(decision.draft).toBeDefined();
    const draft = decision.draft!;
    const expected = buildStatementVoucher(app(base), '2026-09');
    expect(canAutoIssue(app(base), '2026-09')).toBe(true);
    expect(draft.kind).toBe('issuedStatements');
    expect(draft.operationId).toBe(expected.id);
    expect(draft.tradeDate).toBe(expected.tradeDate);
    expect(draft.document).toMatchObject({ type: expected.type, totalSupply: expected.totalSupply,
      totalTax: expected.totalTax, totalAmount: expected.totalAmount, items: expected.items });
    expect(Number(draft.document.totalSupply) + Number(draft.document.totalTax)).toBe(base.amount);
  });
  it('matches exempt and receivable app statements', () => {
    const t = { ...base, dir: '받을돈', taxExempt: true };
    const draft = autoVoucherDraft(t, '2026-09', day).draft!;
    const expected = buildStatementVoucher(t as FixedCostTemplate, '2026-09');
    expect(draft.document).toMatchObject({ type: '매출', totalSupply: expected.totalSupply, totalTax: 0,
      totalAmount: expected.totalAmount });
  });
  it('matches legacy split mode and cash voucher amount and ID', () => {
    const legacy = { ...base, dir: undefined, postMode: '분리' };
    expect(autoVoucherDraft(legacy, '2026-09', day).draft?.kind).toBe('issuedStatements');
    const cash = { ...base, dir: '출금' };
    const draft = autoVoucherDraft(cash, '2026-09', day).draft!;
    const expected = buildCashVoucher(cash as FixedCostTemplate, '2026-09');
    expect(draft.kind).toBe('cashEntries');
    expect(draft.operationId).toBe(expected.id);
    expect(draft.document).toMatchObject({ date: expected.date, dir: expected.dir, amount: expected.amount,
      accountCode: expected.accountCode });
  });
  it.each([
    [{ ...base, companyId: undefined }, '회사 미지정'],
    [{ ...base, amount: Number.POSITIVE_INFINITY }, '유효하지 않은 원화 총액'],
    [{ ...base, dir: '회사이체' }, '회사이체 원자 명령 필요'],
    [{ ...base, mode: '상환' }, '대출 상환 분할 필요'],
    [{ ...base, transferLines: [{ accountCode: '108', side: '차변' }] }, '대체 분개 줄 필요'],
    [{ ...base, partnerId: undefined }, '대체 분개 줄 필요'],
    [{ ...base, kind: 'voucher' }, '수동 전표 양식'],
  ])('skips unsupported templates with a reason', (template, reason) => {
    expect(autoVoucherDraft(template, '2026-09', day)).toEqual({ skip: reason });
  });
  it('separates companies and issue dates', () => {
    expect(autoVoucherDraft({ ...base, companyId: 'punghoe' }, '2026-09', day).draft?.companyId).toBe('punghoe');
    expect(autoVoucherDraft(base, '2026-09', '2026-09-29')).toEqual({ skip: '발행일 아님' });
  });
  it('preserves app input order and scheduler ID order when main is absent', () => {
    const accounts = [
      { id: 'z-card', companyId: 'taebaek', active: true, type: '카드' },
      { id: 'b-bank', companyId: 'taebaek', active: true, type: '통장' },
      { id: 'a-cash', companyId: 'taebaek', active: true, type: '현금' },
      { id: 'other', companyId: 'punghoe', active: true, type: '통장' },
    ];
    const appAccounts = accounts.filter(a => a.companyId === 'taebaek') as CashAccount[];
    expect(defaultCashAccountId(appAccounts, 'taebaek')).toBe('b-bank');
    expect(scheduledCashAccountId([...accounts].reverse(), 'taebaek')).toBe('a-cash');
    expect(scheduledCashAccountId(accounts, 'punghoe')).toBe('other');
  });
  it('preserves different duplicate-code selectors but shares explicit resolved names', () => {
    const codes = [
      { id: 'z', companyId: 'taebaek', code: '520', name: '늦은 이름' },
      { id: 'a', companyId: 'taebaek', code: '520', name: '임대비' },
      { id: '0', companyId: 'punghoe', code: '520', name: '다른 회사' },
    ];
    const appName = (codes.filter(c => c.companyId === 'taebaek') as AccountCode[]).find(c => c.code === '520')?.name;
    expect(appName).toBe('늦은 이름');
    expect(scheduledAccountName(codes, 'taebaek', '520')).toBe('임대비');
    const draft = autoVoucherDraft(base, '2026-09', day, '', appName).draft!;
    const expected = buildStatementVoucher(app(base), '2026-09', { docNo: '', accountName: appName });
    expect(draft.document.items).toEqual(expected.items);
    expect(autoVoucherDraft({ ...base, itemName: '직접 지정' }, '2026-09', day, '', appName).draft?.document.items)
      .toMatchObject([{ name: '직접 지정' }]);
  });
  it('uses the approved active main account in both actual paths', () => {
    const accounts = [
      { id:'a-bank',companyId:'taebaek' as const,active:true,type:'통장' as const },
      { id:'cashacct-temp-main',companyId:'taebaek' as const,active:true,type:'통장' as const },
      { id:'other',companyId:'punghoe' as const,active:true,type:'통장' as const },
    ];
    expect(defaultCashAccountId(accounts,'taebaek')).toBe('cashacct-temp-main');
    expect(scheduledCashAccountId(accounts,'taebaek')).toBe('cashacct-temp-main');
    expect(scheduledCashAccountId(accounts,'punghoe')).toBe('other');
    expect(scheduledCashAccountId(accounts.map(a=>a.id==='cashacct-temp-main'?{...a,active:false}:a),'taebaek')).toBe('a-bank');
  });
});
