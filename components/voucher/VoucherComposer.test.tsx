import {cloneElement} from 'react';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoucherComposer from './VoucherComposer';
import { auth } from '../../src/shared/firebase';
import type { AccountCode, AccountGroup, CashAccount, Partner, IssuedStatement } from '../../src/shared/types';
import {paymentHash,type StoredPartnerPaymentRequest} from '../../src/features/statements/infrastructure/partnerPaymentRecovery';
import {webcrypto} from 'node:crypto';

const paymentIo=vi.hoisted(()=>({command:vi.fn(),apply:vi.fn(),readGate:vi.fn(),scope:{companyId:'taebaek',actorUid:'test-auth-uid',partnerId:'p1'},server:new Map<string,any>(),listeners:new Set<(user:{uid:string}|null)=>void>()}));
vi.mock('../../src/shared/firebase',()=>({auth:{currentUser:{uid:'test-auth-uid'}},authReady:Promise.resolve(),functions:{}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:{currentUser:{uid:string}|null},listener:(user:{uid:string}|null)=>void)=>{paymentIo.listeners.add(listener);listener(_auth.currentUser);return()=>{paymentIo.listeners.delete(listener);};}}));
vi.mock('../../src/features/statements/infrastructure/issueTradeStatementCommand',()=>({recordPartnerPayment:vi.fn()}));
vi.mock('../../src/features/statements/infrastructure/partnerPaymentRecovery',async importOriginal=>{
 const actual=await importOriginal<typeof import('../../src/features/statements/infrastructure/partnerPaymentRecovery')>();
 const writes=actual.createPartnerPaymentRecovery({get storage(){return localStorage;},assertScope:async(scope,current)=>{if(!current())throw Error('화면 변경');paymentIo.scope={...scope};},command:paymentIo.command,apply:paymentIo.apply});
 return {...actual,readPartnerPaymentRecoveries:async(...args:Parameters<typeof writes.read>)=>{await paymentIo.readGate(args[0]);return writes.read(...args);},resolvePartnerPaymentRecovery:writes.resolve,retryPartnerPaymentRecovery:writes.retry,discardPartnerPaymentCopy:writes.discard,listPartnerPaymentHistory:writes.list};
});
Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});
vi.mock('../../src/shared/useLoanContracts',()=>({useLoanContracts:()=>[]}));
const transfer = vi.hoisted(()=>({prepare:vi.fn(),save:vi.fn(),resume:vi.fn()}));
vi.mock('../../src/shared/services/interCompanyTransferService',()=>({prepareTransferOptions:transfer.prepare,saveInterCompanyTransfer:transfer.save,resumeInterCompanyTransfer:transfer.resume,hasPendingTransfer:()=>false}));
beforeEach(()=>{localStorage.clear();transfer.prepare.mockReset().mockResolvedValue({from:{companyId:'taebaek',accounts:[{id:'bank1',name:'농협 주계좌',companyId:'taebaek',active:true,type:'통장'}],partners:[{id:'from-partner',name:'풍회유통',companyId:'taebaek',revision:0,available:0}]},to:{companyId:'punghoe',accounts:[{id:'actual-foreign-bank',name:'풍회 은행',companyId:'punghoe',active:true,type:'통장'}],partners:[{id:'actual-foreign-partner',name:'태백푸드',companyId:'punghoe',revision:0,available:0}]},releaseId:'test-release'});transfer.save.mockReset().mockResolvedValue({outDocNo:'out',inDocNo:'in'});});
beforeEach(()=>{
 paymentIo.server.clear();paymentIo.command.mockReset();paymentIo.apply.mockReset();paymentIo.readGate.mockReset().mockResolvedValue(undefined);
 paymentIo.command.mockImplementation(async input=>{
  const scope={...paymentIo.scope};
  if(input.mode==='list')return {version:1,companyId:scope.companyId,partnerId:scope.partnerId,actorUid:scope.actorUid,entries:[...paymentIo.server.values()],nextCursor:null};
  const prior=paymentIo.server.get(input.reference.operationId);if(prior)return prior;
  const result={version:1,reference:input.reference,actorUid:scope.actorUid,status:input.mode==='cancel'?'cancelled':'unknown',requestHash:null,message:input.mode==='cancel'?'미처리 요청 중단 확인':'서버에 아직 요청 기록이 없습니다.'};
  if(input.mode==='cancel')paymentIo.server.set(input.reference.operationId,result);return result;
 });
 paymentIo.apply.mockImplementation(async request=>{const result={version:1,reference:{companyId:paymentIo.scope.companyId,partnerId:request.partnerId,operationId:request.operationId},actorUid:paymentIo.scope.actorUid,status:'applied',requestHash:await paymentHash(request),message:'원래 수금 처리 확인',cashEntryId:request.operationId,docNo:'261001-001'};paymentIo.server.set(request.operationId,result);return {duplicate:false};});
});
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
    await 갈래(u, '매입');
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
    await 갈래(u, '매입');
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
      await u.click(screen.getByRole('button',{name:'이전 전표 재시도'}));
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
  it('대체의 통장 한 줄은 기존 정책대로 같은 금액의 자금전표로 저장한다', async () => {
    const u = userEvent.setup();
    const { onAddCashEntry, onAddIssuedStatement } = 띄우기({ initialDir: '대체', fixedCostTemplates: [템플릿({
      name: '통장 대체', dir: '대체', mode: '일반', statementType: '비용', amount: 10000,
      transferLines: [{ accountCode: '811', side: '차변' }, { accountCode: '103', side: '대변' }],
    })] });
    await 템플릿고르기(u, '통장 대체'); await 저장(u);
    expect(onAddCashEntry).toHaveBeenCalledWith(expect.objectContaining({ dir: '출금', amount: 10000, cashAccountId: 'bank1', accountCode: '811' }));
    expect(onAddIssuedStatement).not.toHaveBeenCalled();
  });
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

 it('응답 유실 뒤 닫고 다시 열어도 새 전표 대신 원문으로 재개한다',async()=>{
  const u=userEvent.setup(),onIssueCashEntry=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValueOnce({id:'saved'});
  const alertSpy=vi.spyOn(window,'alert').mockImplementation(()=>{});
  try {
   띄우기({fixedCostTemplates:[템플릿({name:'차량비',mode:'일반',dir:'출금',accountCode:'811',amount:10000})],onIssueCashEntry});
   await 템플릿고르기(u,'차량비');await 저장(u);await waitFor(()=>expect(onIssueCashEntry).toHaveBeenCalledTimes(1));
   expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('전표 저장 결과를 확인하지 못했습니다. 새로 발행하지 말고 이전 전표 재시도로 같은 요청 결과를 확인해 주세요.'));
   expect(alertSpy).not.toHaveBeenCalledWith(expect.stringContaining('전표가 저장되지 않았습니다.'));
   screen.getByRole('button',{name:'저장'});
   // 실제 모달 닫기와 재열기는 인스턴스의 ref를 새로 만든다.
   const {cleanup}=await import('@testing-library/react');cleanup();
   띄우기({onIssueCashEntry});
   await u.click(await screen.findByRole('button',{name:'이전 전표 재시도'}));
   await waitFor(()=>expect(onIssueCashEntry).toHaveBeenCalledTimes(2));
   expect(onIssueCashEntry.mock.calls[1][0]).toEqual(onIssueCashEntry.mock.calls[0][0]);
  } finally {alertSpy.mockRestore();localStorage.clear();}
 });

it('최초 명확한 쓰기0 거절은 원문 대기를 풀어 입력을 수정할 수 있다',async()=>{const u=userEvent.setup(),save=vi.fn().mockImplementationOnce(async(entry)=>{throw Object.assign(new Error('계좌 없음'),{details:{operationStatus:'rejected',version:1,financialWrites:false,companyId:'taebaek',operationId:entry.id}})}).mockResolvedValue({id:'saved'});const alertSpy=vi.spyOn(window,'alert').mockImplementation(()=>{});try{띄우기({fixedCostTemplates:[템플릿({name:'차량비',mode:'일반',dir:'출금',accountCode:'811',amount:10000})],onIssueCashEntry:save});await 템플릿고르기(u,'차량비');await 저장(u);await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));expect(screen.queryByRole('button',{name:'이전 전표 재시도'})).toBeNull();const amount=screen.getByDisplayValue('10,000');await u.clear(amount);await u.type(amount,'20000');await 저장(u);await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));expect(save.mock.calls[1][0].amount).toBe(20000);}finally{alertSpy.mockRestore();}});
it('unknown 뒤에는 원문 입력이 잠기며 재시도 거절 proof도 이전 원문을 지우지 않는다',async()=>{const u=userEvent.setup(),save=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockImplementationOnce(async(entry)=>{throw Object.assign(new Error('권한'),{details:{operationStatus:'rejected',version:1,financialWrites:false,companyId:'taebaek',operationId:entry.id}})});const alertSpy=vi.spyOn(window,'alert').mockImplementation(()=>{});try{띄우기({fixedCostTemplates:[템플릿({name:'차량비',mode:'일반',dir:'출금',accountCode:'811',amount:10000})],onIssueCashEntry:save});await 템플릿고르기(u,'차량비');await 저장(u);await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));expect(screen.getByDisplayValue('10,000')).toBeDisabled();await u.click(screen.getByRole('button',{name:'이전 전표 재시도'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));expect(screen.getByRole('button',{name:'이전 전표 재시도'})).toBeEnabled();expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);expect(localStorage.length).toBe(1);}finally{alertSpy.mockRestore();}});

it('정상 발행 중에는 이전 실패 복구 대신 저장 중임을 표시하고 완료 뒤 닫는다', async () => {
  const u = userEvent.setup(); let finish!: (value: unknown) => void;
  const save = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const { onClose } = 띄우기({ fixedCostTemplates: [템플릿({ name: '차량비', mode: '일반', dir: '출금', accountCode: '811', amount: 10000 })], onIssueCashEntry: save });
  await 템플릿고르기(u, '차량비'); await 저장(u);
  expect(screen.getByRole('status')).toHaveTextContent('전표를 저장 중입니다.');
  expect(screen.queryByRole('region', { name: '저장 중이던 전표' })).toBeNull();
  expect(screen.queryByRole('button', { name: '이전 전표 재시도' })).toBeNull();
  expect(onClose).not.toHaveBeenCalled(); expect(localStorage.length).toBe(1);
  await act(async () => finish({ id: 'saved' }));
  expect(onClose).toHaveBeenCalledOnce(); expect(localStorage.length).toBe(0);
  expect(screen.queryByRole('button', { name: '이전 전표 재시도' })).toBeNull();
});

it('이전 계정의 늦은 발행 완료는 새 계정 창이나 원문을 정리하지 않는다', async () => {
  const u = userEvent.setup(); let finish!: (value: unknown) => void;
  const save = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const { onClose } = 띄우기({ fixedCostTemplates: [템플릿({ name: '차량비', mode: '일반', dir: '출금', accountCode: '811', amount: 10000 })], onIssueCashEntry: save });
  try {
    await 템플릿고르기(u, '차량비'); await 저장(u);
    (auth.currentUser as { uid: string }).uid = 'other-auth-uid';
    await act(async () => finish({ id: 'saved' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(localStorage.getItem('voucher-composer-issue:taebaek:test-auth-uid')).not.toBeNull();
  } finally { (auth.currentUser as { uid: string }).uid = 'test-auth-uid'; }
});

it('이전 회사 발행 완료는 새 회사 창을 닫거나 대기 원문을 지우지 않는다',async()=>{const u=userEvent.setup();let finish!:(v:unknown)=>void;const save=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const {rerenderCompany,onClose}=띄우기({fixedCostTemplates:[템플릿({name:'차량비',mode:'일반',dir:'출금',accountCode:'811',amount:10000})],onIssueCashEntry:save});await 템플릿고르기(u,'차량비');await 저장(u);await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));rerenderCompany('punghoe');await act(async()=>finish({id:'saved'}));expect(onClose).not.toHaveBeenCalled();expect(localStorage.getItem('voucher-composer-issue:taebaek:test-auth-uid')).not.toBeNull();});

it('일반 현금전표는 거래처 계좌 금액 순서로 입력하고 금액 형식을 유지한다',async()=>{띄우기();const partner=screen.getByRole('textbox',{name:'거래처'}),bank=screen.getByRole('combobox',{name:'계좌'}),amount=screen.getByRole('textbox',{name:'금액'});expect(partner.compareDocumentPosition(bank)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(bank.compareDocumentPosition(amount)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(screen.getAllByRole('combobox',{name:'계좌'})).toHaveLength(1);await userEvent.type(amount,'12345');expect(amount).toHaveValue('12,345');});

it.each(['출금','입금'] as const)('일반 %s는 금액 입력 전에도 자동 반대편 계정을 표시하고 저장은 막는다',dir=>{
 띄우기({initialDir:dir});const dialog=screen.getByRole('dialog',{name:'일반전표 발행'});
 expect(within(dialog).getByText('103 보통예금')).toBeInTheDocument();
 const bankRow=within(dialog).getByText('103 보통예금').parentElement!;
 expect(bankRow).toHaveTextContent(dir==='출금'?'대변':'차변');expect(bankRow).toHaveTextContent('0');
 expect(within(dialog).getByRole('button',{name:/^저장$/})).toBeDisabled();
});
it('주문 수정과 같은 하단 푸터에 취소와 저장만 두고 취소 콜백을 유지한다',async()=>{
 const {onClose}=띄우기({onAddFixedCostTemplate:vi.fn()});const footer=screen.getByRole('button',{name:/^저장$/}).closest('footer')!;
 expect(footer).not.toBeNull();expect(within(footer).getAllByRole('button')).toHaveLength(2);
 expect(within(footer).getByRole('button',{name:/^저장$/})).toHaveClass('bg-indigo-600');
 expect(screen.getByRole('button',{name:'템플릿 저장'}).closest('footer')).toBeNull();
 await userEvent.click(within(footer).getByRole('button',{name:'취소'}));expect(onClose).toHaveBeenCalledOnce();
});

const sjmStatement:IssuedStatement={id:'current-statement',issuedAt:'2026-10-07T00:00:00Z',orderId:'current-order',docNo:'261007-010',partnerId:'p1',partnerName:'(유)에스제이엠',type:'매출',tradeDate:'2026-10-07',totalAmount:2891460,totalSupply:2891460,totalTax:0,items:[{name:'현재 미수',accountCode:'108',side:'차변',spec:'',qty:1,price:2891460,supply:2891460,tax:0,total:2891460,isTaxExempt:false}]};
function sjm(over:Partial<Parameters<typeof VoucherComposer>[0]>={}){
 return 띄우기({initialDir:'입금',initialDate:'2026-10-19',initialPartnerId:'p1',partners:[{id:'p1',name:'(유)에스제이엠',companyId:'taebaek'} as Partner],statements:[sjmStatement],partnerBalances:new Map([['p1',{receivable:2891460,payable:0}]]),...over});
}
async function oldPayment(status:'applied'|'unknown'='applied'){
 const business={tradeDate:'2026-10-01',partnerId:'p1',direction:'입금' as const,amount:5718790,cashAccountId:'old-bank',pin:false,allocations:[],note:'지난 수금 원문'};
 const request:StoredPartnerPaymentRequest={...business,operationId:'partner-payment-old',expectedRevision:0,releaseId:'legacy-release'};
 localStorage.setItem('partner-payment-pending:taebaek:p1:test-auth-uid',JSON.stringify({version:2,fingerprint:JSON.stringify(business),request}));
 if(status==='applied')paymentIo.server.set(request.operationId,{version:1,reference:{companyId:'taebaek',partnerId:'p1',operationId:request.operationId},actorUid:'test-auth-uid',status:'applied',requestHash:await paymentHash(request),message:'지난 5,718,790원 수금 반영 확인',cashEntryId:request.operationId,docNo:'261001-001'});
 return request;
}
it('사진의 현재 입금2891460 초안은 과거5718790 서버완료 확인 뒤에도 보존되고 명시 새저장만 원배분을 보낸다',async()=>{
 await oldPayment();const u=userEvent.setup(),view=sjm();await 채우기(u,'금액','2891460');const note=screen.getByPlaceholderText('예: 7월 전기요금') as HTMLInputElement;await u.type(note,'이번 수금 비고');
 expect(await screen.findByText(/원래 요청: 5,718,790원/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(view.recordPayment).not.toHaveBeenCalled();
 await u.click(screen.getByRole('button',{name:'결과 확인'}));await waitFor(()=>expect(screen.getByRole('button',{name:'저장'})).toBeEnabled());
 expect(screen.getByLabelText('금액')).toHaveValue('2,891,460');expect(screen.getByRole('combobox',{name:'계좌'})).toHaveValue('bank1');expect(note).toHaveValue('이번 수금 비고');expect(document.querySelector('input[type="date"]')).toHaveValue('2026-10-19');expect(view.onClose).not.toHaveBeenCalled();expect(view.recordPayment).not.toHaveBeenCalled();expect(paymentIo.apply).not.toHaveBeenCalled();
 await 저장(u);await waitFor(()=>expect(view.recordPayment).toHaveBeenCalledOnce());expect(view.recordPayment).toHaveBeenCalledWith([{stmt:sjmStatement,amount:2891460}],{date:'2026-10-19',method:'계좌이체',note:'이번 수금 비고',cashAccountId:'bank1'});expect(view.recordPayment.mock.calls[0][1].pin).not.toBe(false);
});
it('이전 요청 unknown은 현재 신규저장을 막고 원자 중단 확인 뒤에도 초안을 바꾸거나 자동송신하지 않는다',async()=>{
 await oldPayment('unknown');const u=userEvent.setup(),view=sjm();await 채우기(u,'금액','2891460');await screen.findByText(/원래 요청: 5,718,790원/);await u.click(screen.getByRole('button',{name:'결과 확인'}));expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();
 await u.click(screen.getByRole('button',{name:'미처리 요청 중단'}));await waitFor(()=>expect(screen.getByRole('button',{name:'저장'})).toBeEnabled());expect(screen.getByLabelText('금액')).toHaveValue('2,891,460');expect(view.recordPayment).not.toHaveBeenCalled();expect(view.onClose).not.toHaveBeenCalled();expect(paymentIo.apply).not.toHaveBeenCalled();
});
it('최초 보관 읽기 대기에는 현재 저장을 시작하지 않고 읽기가 끝난 뒤에만 명시 저장한다',async()=>{
 let release!:()=>void;paymentIo.readGate.mockReturnValueOnce(new Promise<void>(resolve=>{release=resolve;}));const u=userEvent.setup(),view=sjm();await 채우기(u,'금액','2891460');expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();expect(view.recordPayment).not.toHaveBeenCalled();
 await act(async()=>release());await waitFor(()=>expect(screen.getByRole('button',{name:'저장'})).toBeEnabled());await 저장(u);await waitFor(()=>expect(view.recordPayment).toHaveBeenCalledOnce());
});
it('복구 결과 확인의 동기 busy는 같은 tick 신규저장 호출을 차단한다',async()=>{
 await oldPayment();const original=paymentIo.command.getMockImplementation()!;let finish!:(value:unknown)=>void;paymentIo.command.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const u=userEvent.setup(),view=sjm();await 채우기(u,'금액','2891460');await screen.findByText(/원래 요청: 5,718,790원/);
 const inspect=screen.getByRole('button',{name:'결과 확인'}),save=screen.getByRole('button',{name:'저장'});await act(async()=>{inspect.click();save.click();});expect(view.recordPayment).not.toHaveBeenCalled();
 await act(async()=>finish(await original({mode:'inspect',reference:{companyId:'taebaek',partnerId:'p1',operationId:'partner-payment-old'}})));expect(view.onClose).not.toHaveBeenCalled();
});
it('입금 대체 출금 전환은 같은 hook 순서를 유지하고 보관 요청을 현재 전표로 저장하지 않는다',async()=>{
 const u=userEvent.setup(),view=sjm();await waitFor(()=>expect(screen.getByRole('button',{name:'저장'})).toBeDisabled());await 갈래(u,'대체');expect(screen.getByRole('dialog',{name:'일반전표 발행'})).toBeInTheDocument();await 갈래(u,'출금');expect(screen.getByLabelText('금액')).toBeInTheDocument();expect(view.recordPayment).not.toHaveBeenCalled();expect(paymentIo.apply).not.toHaveBeenCalled();
});
it('새 저장 직전에 다른 탭의 과거 사본 가드가 생기면 같은 창의 복구 패널로 이어지고 초안은 보존된다',async()=>{
 const record=vi.fn().mockImplementationOnce(async()=>{await oldPayment();throw Error('이전 수금·지불 저장 결과가 불확실합니다. 같은 내용으로만 재시도할 수 있습니다.');}).mockResolvedValue(undefined);
 const u=userEvent.setup(),view=sjm({recordPayment:record});await 채우기(u,'금액','2891460');await waitFor(()=>expect(screen.getByRole('button',{name:'저장'})).toBeEnabled());await 저장(u);
 expect(await screen.findByRole('alert')).toHaveTextContent('이전 요청 패널');expect(await screen.findByText(/원래 요청: 5,718,790원/)).toBeInTheDocument();expect(record).toHaveBeenCalledOnce();expect(view.onClose).not.toHaveBeenCalled();expect(screen.getByLabelText('금액')).toHaveValue('2,891,460');expect(screen.getByRole('button',{name:'저장'})).toBeDisabled();
 await u.click(screen.getByRole('button',{name:'결과 확인'}));await waitFor(()=>expect(screen.getByRole('button',{name:'저장'})).toBeEnabled());expect(record).toHaveBeenCalledOnce();expect(view.onClose).not.toHaveBeenCalled();
});
it('옛 UID의 늦은 수금 조회는 현재 일반전표를 닫거나 현재 금액을 바꾸지 않는다',async()=>{
 await oldPayment();let finish!:(value:unknown)=>void;paymentIo.command.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));const u=userEvent.setup(),view=sjm();await 채우기(u,'금액','2891460');await screen.findByText(/원래 요청: 5,718,790원/);await u.click(screen.getByRole('button',{name:'결과 확인'}));
 try{
  await act(async()=>{(auth.currentUser as {uid:string}).uid='new-auth-uid';paymentIo.listeners.forEach(listener=>listener(auth.currentUser));});
  await act(async()=>finish(paymentIo.server.get('partner-payment-old')));
  expect(screen.queryByRole('region',{name:'이전 수금·지불 원문과 복구'})).toBeNull();expect(screen.getByLabelText('금액')).toHaveValue('2,891,460');expect(view.onClose).not.toHaveBeenCalled();expect(view.recordPayment).not.toHaveBeenCalled();expect(localStorage.getItem('partner-payment-pending:taebaek:p1:test-auth-uid')).not.toBeNull();
 }finally{(auth.currentUser as {uid:string}).uid='test-auth-uid';}
});

describe('일반 발행 저장 중 닫기', () => {
  it.each(['일반', '급여', '보험', '세금'] as const)('%s 저장 응답 전에는 X와 취소가 닫지 않고 ACK 뒤에만 닫는다', async mode => {
    const u = userEvent.setup();
    let finish!: (value: unknown) => void;
    const save = vi.fn(() => new Promise<unknown>(resolve => { finish = resolve; }));
    const { onClose } = 띄우기({
      fixedCostTemplates: [템플릿({ name: '닫기 보호', mode, dir: '출금', accountCode: '811', amount: 10000 })],
      onIssueCashEntry: save,
    });
    await 템플릿고르기(u, '닫기 보호');
    if (mode === '급여') await 채우기(u, '총급여', '10000');
    if (mode === '보험') await 채우기(u, '회사부담', '10000');
    if (mode === '세금') await 채우기(u, '부가세', '10000');
    await 저장(u);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
    await u.click(screen.getByRole('button', { name: '일반전표 발행 닫기' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ id: 'saved' }); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('voucher-composer-issue:taebaek:test-auth-uid')).toBeNull();
  });

  it('응답 실패 뒤에는 닫을 수 있고 재마운트 원문 재시도 중에는 다시 닫기를 막는다', async () => {
    const u = userEvent.setup();
    let finish!: (value: unknown) => void;
    const save = vi.fn().mockRejectedValueOnce(new Error('응답 유실'))
      .mockImplementationOnce(() => new Promise<unknown>(resolve => { finish = resolve; }));
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    try {
      const first = 띄우기({ fixedCostTemplates: [템플릿({ name: '재시도 보호', mode: '일반', dir: '출금', accountCode: '811', amount: 10000 })], onIssueCashEntry: save });
      await 템플릿고르기(u, '재시도 보호');
      await 저장(u);
      await screen.findByRole('button', { name: '이전 전표 재시도' });
      const original = structuredClone(save.mock.calls[0][0]);
      await u.click(screen.getByRole('button', { name: '일반전표 발행 닫기' }));
      expect(first.onClose).toHaveBeenCalledTimes(1);
      const { cleanup } = await import('@testing-library/react');
      cleanup();
      const second = 띄우기({ onIssueCashEntry: save });
      await u.click(await screen.findByRole('button', { name: '이전 전표 재시도' }));
      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1][0]).toEqual(original);
      expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
      await u.click(screen.getByRole('button', { name: '일반전표 발행 닫기' }));
      expect(second.onClose).not.toHaveBeenCalled();
      await act(async () => { finish({ id: 'saved' }); });
      expect(second.onClose).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('voucher-composer-issue:taebaek:test-auth-uid')).toBeNull();
    } finally { alertSpy.mockRestore(); }
  });
});

it('실제 인증 A→B→A 뒤 이전 발행 ACK는 창을 닫거나 보관 원문을 지우지 않는다', async () => {
  const u = userEvent.setup();
  let finish!: (value: unknown) => void;
  const save = vi.fn(() => new Promise<unknown>(resolve => { finish = resolve; }));
  const { onClose } = 띄우기({ fixedCostTemplates: [템플릿({ name: '인증 왕복', mode: '일반', dir: '출금', accountCode: '811', amount: 10000 })], onIssueCashEntry: save });
  await 템플릿고르기(u, '인증 왕복');
  await 저장(u);
  expect(save).toHaveBeenCalledTimes(1);
  const key = 'voucher-composer-issue:taebaek:test-auth-uid';
  const original = localStorage.getItem(key);
  const emit = (uid: string) => { Object.assign(auth, { currentUser: { uid } }); paymentIo.listeners.forEach(listener => listener({ uid })); };
  await act(async () => { emit('other-admin'); });
  await act(async () => { emit('test-auth-uid'); });
  await act(async () => { finish({ id: 'saved' }); });
  expect(onClose).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).toBe(original);
});
