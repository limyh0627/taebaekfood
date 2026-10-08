import {cloneElement} from 'react';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoucherComposer from './VoucherComposer';
import type { AccountCode, AccountGroup, CashAccount, Partner, IssuedStatement } from '../../src/shared/types';

const transfer = vi.hoisted(()=>({prepare:vi.fn(),save:vi.fn(),resume:vi.fn()}));
vi.mock('../../src/shared/services/interCompanyTransferService',()=>({prepareTransferOptions:transfer.prepare,saveInterCompanyTransfer:transfer.save,resumeInterCompanyTransfer:transfer.resume,hasPendingTransfer:()=>false}));
beforeEach(()=>{transfer.prepare.mockReset().mockResolvedValue({from:{companyId:'taebaek',accounts:[{id:'bank1',name:'농협 주계좌',companyId:'taebaek',active:true,type:'통장'}],partners:[{id:'from-partner',name:'풍회유통',companyId:'taebaek',revision:0,available:0}]},to:{companyId:'punghoe',accounts:[{id:'actual-foreign-bank',name:'풍회 은행',companyId:'punghoe',active:true,type:'통장'}],partners:[{id:'actual-foreign-partner',name:'태백푸드',companyId:'punghoe',revision:0,available:0}]},releaseId:'test-release'});transfer.save.mockReset().mockResolvedValue({outDocNo:'out',inDocNo:'in'});});
/**
 * **한 번 나간 돈의 성격이 둘 이상일 때 갈라 적는가.**
 *
 * 이 창의 값어치는 거기 있다. 대출상환을 전액 이자비용으로 몰면 손익이 그만큼 줄고,
 * 4대보험을 전액 비용으로 몰면 예수금이 영영 안 줄고, 세금을 비용으로 몰면
 * 부가세예수금이 그대로 남는다. **통장에서는 한 번 나가지만 전표는 두 줄이다.**
 *
 * 그림(어느 칸이 어디 있나)은 안 잠근다. 잠그면 화면을 못 고친다.
 * 잠그는 건 **넘어가는 값**이다.
 */
const 계정: AccountCode[] = [
  { id: 'a1', code: '260', name: '단기차입금', normalBalance: 'credit' },
  { id: 'a2', code: '293', name: '장기차입금', normalBalance: 'credit' },
  { id: 'a3', code: '951', name: '이자비용', normalBalance: 'debit' },
  { id: 'a4', code: '801', name: '급여', normalBalance: 'debit' },
  { id: 'a5', code: '254', name: '예수금', normalBalance: 'credit' },
  { id: 'a6', code: '530', name: '사대보험', normalBalance: 'debit' },
  { id: 'a7', code: '255', name: '부가세예수금', normalBalance: 'credit' },
  { id: 'a8', code: '338', name: '인출금', normalBalance: 'debit' },
  { id: 'a9', code: '811', name: '차량유지비', normalBalance: 'debit' },
  { id: 'a10', code: '103', name: '보통예금', normalBalance: 'debit' },
] as AccountCode[];
const 분류: AccountGroup[] = [
  { id: 'g1', name: '비용', type: '비용' }, { id: 'g2', name: '부채', type: '부채' },
] as AccountGroup[];
const 통장: CashAccount[] = [{ id: 'bank1', name: '농협 주계좌', active: true }] as CashAccount[];
const 거래처: Partner[] = [{ id: 'p1', name: '청양식품' }] as Partner[];

/** 저장된 템플릿 — `kind: 'voucher'` 라야 이 창의 목록에 오른다 */
const 템플릿 = (over: Record<string, unknown>) => ({
  id: 't-' + (over.name as string), kind: 'voucher', name: '이름', amount: 0, ...over,
} as never);

function 띄우기(over: Partial<Parameters<typeof VoucherComposer>[0]> = {}) {
  const onAddCashEntry = vi.fn(), onAddIssuedStatement = vi.fn(), onClose = vi.fn(), recordPayment = vi.fn();
  const element=<VoucherComposer
    companyId="taebaek"
    initialDir="출금"
    initialDate="2026-08-10"
    partners={거래처}
    accountCodes={계정}
    accountGroups={분류}
    cashAccounts={통장}
    fixedCostTemplates={[]}
    cashEntries={[]}
    statements={[] as IssuedStatement[]}
    partnerBalances={new Map()}
    getBalance={s => s.totalAmount}
    cashAccountId="bank1"
    onCashAccountId={vi.fn()}
    onClose={onClose}
    onAddCashEntry={onAddCashEntry}
    onAddIssuedStatement={onAddIssuedStatement}
    recordPayment={recordPayment}
    renderJournal={() => null}
    {...over}
  />;
  const view=render(element);
  return { onAddCashEntry, onAddIssuedStatement, onClose, recordPayment,rerenderCompany:(companyId:'taebaek'|'punghoe')=>view.rerender(cloneElement(element,{companyId})) };
}

describe('거래처 템플릿 과세·면세 발행', () => {
  const 비용템플릿 = (exempt: boolean) => 템플릿({
    name: exempt ? '면세 기장료' : '과세 기장료', dir: '줄돈', mode: '일반',
    accountCode: '811', partnerId: 'p1', partnerName: '청양식품',
    amount: 110_000, taxExempt: exempt,
  });

  it('과세면 미리보기와 저장 전표 모두 공급가 100,000원·세액 10,000원이다', async () => {
    const u = userEvent.setup();
    const { onAddIssuedStatement } = 띄우기({ fixedCostTemplates: [비용템플릿(false)] });
    await 템플릿고르기(u, '과세 기장료');
    expect(screen.getByText(/공급가 100,000 · 세액 10,000 · 합계 110,000/)).toBeTruthy();
    await 저장(u);
    const stmt = onAddIssuedStatement.mock.calls[0][0] as IssuedStatement;
    expect([stmt.totalSupply, stmt.totalTax, stmt.totalAmount]).toEqual([100_000, 10_000, 110_000]);
    expect([stmt.items[0].supply, stmt.items[0].tax, stmt.items[0].isTaxExempt]).toEqual([100_000, 10_000, false]);
  });

  it('면세 설정을 가져오고, 이번 전표에서 과세로 바꾸면 저장값도 따라 바뀐다', async () => {
    const u = userEvent.setup();
    const { onAddIssuedStatement } = 띄우기({ fixedCostTemplates: [비용템플릿(true)] });
    await 템플릿고르기(u, '면세 기장료');
    expect(screen.getByText(/공급가 110,000 · 세액 0 · 합계 110,000/)).toBeTruthy();
    await u.click(screen.getByRole('checkbox', { name: /면세/ }));
    expect(screen.getByText(/공급가 100,000 · 세액 10,000 · 합계 110,000/)).toBeTruthy();
    await 저장(u);
    const stmt = onAddIssuedStatement.mock.calls[0][0] as IssuedStatement;
    expect([stmt.totalSupply, stmt.totalTax, stmt.totalAmount]).toEqual([100_000, 10_000, 110_000]);
  });
});

/** 갈래 단추 — 제목 줄에 있다(출금·입금·대체·줄돈·받을돈·회사이체) */
const 갈래 = async (u: ReturnType<typeof userEvent.setup>, name: string) =>
  u.click(screen.getByRole('button', { name }));
/**
 * **갈래 안의 갈래(상환·급여·보험·세금)는 단추가 없다 — 템플릿을 골라야 들어간다.**
 * 그게 실제 경로다. 템플릿이 갈래·계정·금액을 다 들고 있어서, 사용자는 이름만 고른다.
 */
const 템플릿고르기 = async (u: ReturnType<typeof userEvent.setup>, label: string) => {
  await u.click(screen.getByRole('button', { name: /템플릿/ }));
  await u.click(await screen.findByRole('button', { name: new RegExp(label) }));
};
/** 라벨에 괄호 설명이 붙는 칸이 있다(회사부담 (비용) 처럼) — 앞부분으로 찾는다 */
const 채우기 = async (u: ReturnType<typeof userEvent.setup>, label: string, v: string) => {
  const el = screen.getByLabelText(new RegExp('^' + label)) as HTMLInputElement;
  await u.clear(el); await u.type(el, v);
};
const 저장 = async (u: ReturnType<typeof userEvent.setup>) =>
  u.click(screen.getByRole('button', { name: '저장' }));

describe('한 번 나간 돈을 성격대로 가른다', () => {
  it('일반 자금전표는 서버 발행이 실패하면 입력을 유지하고 같은 ID로 재시도한다', async () => {
    const u = userEvent.setup();
    const onIssueCashEntry = vi.fn().mockRejectedValueOnce(new Error('서버 오류')).mockResolvedValueOnce({ id: 'saved' });
    const onClose = vi.fn();
    const onAddCashEntry = vi.fn();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    try {
      띄우기({ fixedCostTemplates: [템플릿({ name: '차량비', mode: '일반', dir: '출금', accountCode: '811', amount: 10000 })],
        onIssueCashEntry, onAddCashEntry, onClose });
      await 템플릿고르기(u, '차량비');
      await 저장(u);
      await waitFor(() => expect(alertSpy).toHaveBeenCalled());
      expect(onClose).not.toHaveBeenCalled();
      expect(onAddCashEntry).not.toHaveBeenCalled();
      await 저장(u);
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onIssueCashEntry.mock.calls[0][0].id).toBe(onIssueCashEntry.mock.calls[1][0].id);
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('대출상환 — 원금은 차입금, 이자는 이자비용. 통장은 합계만큼 나간다', async () => {
    const u = userEvent.setup();
    const { onAddCashEntry } = 띄우기({ fixedCostTemplates: [템플릿({ name: '차 할부금', mode: '상환', dir: '출금', accountCode: '260' })] });
    await 템플릿고르기(u, '차 할부금');
    await 채우기(u, '원금', '440000');
    await 채우기(u, '이자', '30280');
    expect(screen.getByLabelText(/^원금/)).toHaveValue('440,000');
    expect(screen.getByLabelText(/^이자/)).toHaveValue('30,280');
    await 저장(u);
    const e = onAddCashEntry.mock.calls[0][0];
    expect(e.dir).toBe('출금');
    expect(e.amount).toBe(470_280);                    // 통장에서 나간 건 한 번, 합계만큼
    expect(e.lines).toEqual([
      { accountCode: '260', amount: 440_000, note: '원금' },
      { accountCode: '951', amount: 30_280, note: '이자' },
    ]);
  });

  it('이자만 있으면 줄을 안 쪼갠다 — 줄이 하나면 옛 전표와 같은 모양이어야 한다', async () => {
    const u = userEvent.setup();
    const { onAddCashEntry } = 띄우기({ fixedCostTemplates: [템플릿({ name: '차 할부금', mode: '상환', dir: '출금', accountCode: '260' })] });
    await 템플릿고르기(u, '차 할부금');
    await 채우기(u, '이자', '30280');
    await 저장(u);
    const e = onAddCashEntry.mock.calls[0][0];
    expect(e.lines).toBeUndefined();
    expect(e.accountCode).toBe('951');
    expect(e.note).toContain('이자');
  });

  it('4대보험 — 회사부담은 비용, 근로자부담은 예수금을 턴다', async () => {
    const u = userEvent.setup();
    const { onAddCashEntry } = 띄우기({ fixedCostTemplates: [템플릿({ name: '4대보험', mode: '보험', dir: '출금', accountCode: '530' })] });
    await 템플릿고르기(u, '4대보험');
    await 채우기(u, '회사부담', '500000');
    await 채우기(u, '근로자부담', '300000');
    await 저장(u);
    const e = onAddCashEntry.mock.calls[0][0];
    expect(e.amount).toBe(800_000);
    expect(e.lines).toEqual([
      { accountCode: '530', amount: 500_000, note: '회사부담' },
      { accountCode: '254', amount: 300_000, note: '근로자부담(예수금)' },
    ]);
  });

  it('세금 — 부가세는 예수금(부채), 소득세는 인출금(자본). **둘 다 비용이 아니다**', async () => {
    const u = userEvent.setup();
    const { onAddCashEntry } = 띄우기({ fixedCostTemplates: [템플릿({ name: '세금 납부', mode: '세금', dir: '출금', accountCode: '255' })] });
    await 템플릿고르기(u, '세금 납부');
    await 채우기(u, '부가세', '1200000');
    await 채우기(u, '소득세', '400000');
    await 저장(u);
    const e = onAddCashEntry.mock.calls[0][0];
    expect(e.amount).toBe(1_600_000);
    expect(e.lines).toEqual([
      { accountCode: '255', amount: 1_200_000, note: '부가세' },
      { accountCode: '338', amount: 400_000, note: '소득세' },
    ]);
    //  비용 계정이 한 줄도 없어야 한다 — 전액 비용으로 몰면 이익이 그만큼 줄어 보인다
    expect(e.lines.map((l: { accountCode: string }) => l.accountCode)).not.toContain('530');
  });
});

describe('돈이 안 움직이는 갈래', () => {
  it('대체는 차·대가 안 맞으면 못 낸다', async () => {
    const u = userEvent.setup();
    const { onAddCashEntry } = 띄우기();
    await 갈래(u, '대체');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });
});

describe('회사 간 이체 — 두 장부에 한 건씩', () => {
  it('보내는 회사와 받는 회사 양쪽에 선다', async () => {
    const u = userEvent.setup();
    const { onClose,onAddCashEntry } = 띄우기();
    await 갈래(u, '회사이체');
    await waitFor(()=>expect(transfer.prepare).toHaveBeenCalled());
    await 채우기(u, '금액', '5000000');
    await 저장(u);
    await waitFor(()=>expect(transfer.save).toHaveBeenCalledTimes(1));
    expect(transfer.save).toHaveBeenCalledWith(expect.objectContaining({from:'taebaek',to:'punghoe',amount:5000000,fromAccountId:'bank1',toAccountId:'actual-foreign-bank',fromPartnerId:'from-partner',toPartnerId:'actual-foreign-partner'}),'test-release');
    expect(onAddCashEntry).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('회사이체 저장 결과와 입력 보존',()=>{
 it('저장 완료 전에는 닫지 않고 한 명령만 보낸다',async()=>{
  const u=userEvent.setup();let finish!:(value:unknown)=>void;transfer.save.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const {onClose}=띄우기();await 갈래(u,'회사이체');await screen.findByRole('combobox',{name:'받는 통장'});await 채우기(u,'금액','123');await 저장(u);expect(transfer.save).toHaveBeenCalledTimes(1);expect(onClose).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();await act(async()=>finish({outDocNo:'a',inDocNo:'b'}));expect(onClose).toHaveBeenCalledTimes(1);
 });
 it('거절되면 금액과 계좌를 보존하고 오류를 보여 준다',async()=>{
  const u=userEvent.setup();transfer.save.mockRejectedValueOnce(new Error('이체 권한 확인 실패'));const {onClose}=띄우기();await 갈래(u,'회사이체');await screen.findByRole('combobox',{name:'받는 통장'});await 채우기(u,'금액','321');await 저장(u);expect(await screen.findByRole('alert')).toHaveTextContent('이체 권한 확인 실패');expect(screen.getByLabelText('금액')).toHaveValue('321');expect(screen.getByRole('combobox',{name:'받는 통장'})).toHaveValue('actual-foreign-bank');expect(onClose).not.toHaveBeenCalled();
 });
 it('양사 권한 조회 실패에 기존 직접 저장으로 우회하지 않는다',async()=>{
  const u=userEvent.setup();transfer.prepare.mockRejectedValueOnce(new Error('양사 관리자 권한 없음'));const {onAddCashEntry,onClose}=띄우기();await 갈래(u,'회사이체');expect(await screen.findByRole('alert')).toHaveTextContent('양사 관리자 권한 없음');await 채우기(u,'금액','100');expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(transfer.save).not.toHaveBeenCalled();expect(onAddCashEntry).not.toHaveBeenCalled();expect(onClose).not.toHaveBeenCalled();
 });
});

describe('회사이체 늦은 회사 응답 격리',()=>{
 it('이전 회사의 준비 응답은 새 회사 선택지를 덮지 않는다',async()=>{
  const u=userEvent.setup();let finish!:(v:unknown)=>void;transfer.prepare.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const {rerenderCompany}=띄우기();await 갈래(u,'회사이체');await waitFor(()=>expect(transfer.prepare).toHaveBeenCalledTimes(1));transfer.prepare.mockResolvedValueOnce({from:{companyId:'punghoe',accounts:[{id:'b-own',name:'새 회사 통장',companyId:'punghoe',type:'통장',active:true}],partners:[{id:'b-partner',name:'태백푸드',available:0,revision:0}]},to:{companyId:'taebaek',accounts:[{id:'a-other',name:'태백 통장',companyId:'taebaek',type:'통장',active:true}],partners:[{id:'a-partner',name:'풍회유통',available:0,revision:0}]},releaseId:'release'});rerenderCompany('punghoe');await waitFor(()=>expect(screen.getByRole('combobox',{name:'받는 통장'})).toHaveValue('a-other'));await act(async()=>finish({from:{companyId:'taebaek',accounts:[],partners:[]},to:{companyId:'punghoe',accounts:[{id:'old-bank',name:'이전 통장'}],partners:[]},releaseId:'old'}));expect(screen.getByRole('combobox',{name:'받는 통장'})).toHaveValue('a-other');expect(screen.queryByText('이전 통장')).not.toBeInTheDocument();
 });
 it('이전 회사 저장 완료는 새 회사 창을 닫지 않는다',async()=>{
  const u=userEvent.setup();let finish!:(v:unknown)=>void;transfer.save.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const {onClose,rerenderCompany}=띄우기();await 갈래(u,'회사이체');await screen.findByRole('combobox',{name:'받는 통장'});await 채우기(u,'금액','100');await 저장(u);rerenderCompany('punghoe');await act(async()=>finish({outDocNo:'old',inDocNo:'old'}));expect(onClose).not.toHaveBeenCalled();expect(screen.getByLabelText('금액')).toHaveValue('');
 });
});

describe('닫기', () => {
  it('내고 나면 창이 닫힌다', async () => {
    const u = userEvent.setup();
    const { onClose } = 띄우기({ fixedCostTemplates: [템플릿({ name: '차 할부금', mode: '상환', dir: '출금', accountCode: '260' })] });
    await 템플릿고르기(u, '차 할부금');
    await 채우기(u, '이자', '1000');
    await 저장(u);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('회사 계정표에 없는 템플릿', () => {
  it('사라지지 않고 원인을 알리며, 유효한 템플릿은 계속 고를 수 있다', async () => {
    const u = userEvent.setup();
    띄우기({
      companyId: 'punghoe',
      fixedCostTemplates: [
        템플릿({ id: 'missing', name: '이자 (풍회)', dir: '출금', mode: '일반', accountCode: '931' }),
        템플릿({ id: 'valid', name: '풍회 차량유지비', dir: '출금', mode: '일반', accountCode: '811' }),
      ],
    });
    await u.click(screen.getByRole('button', { name: /템플릿/ }));
    const unavailable = screen.getByRole('button', { name: /이자 \(풍회\)/ });
    expect(unavailable).toBeDisabled();
    expect(within(unavailable).getByText(/현재 회사 계정표에 931 없음/)).toBeInTheDocument();
    const valid = screen.getByRole('button', { name: /풍회 차량유지비/ });
    expect(valid).toBeEnabled();
    await u.click(valid);
    expect(screen.queryByText(/현재 회사 계정표에 931 없음/)).not.toBeInTheDocument();
  });
});
