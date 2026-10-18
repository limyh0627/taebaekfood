/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TaxStatement from './TaxStatement';
import {fetchDateRange} from '../src/shared/services/firebaseService';
import {readTaxIssueHistory} from '../src/features/tax-documents/infrastructure/taxIssueHistory';
import {getPendingTaxIssue,resumeTaxIssue,type TaxIssueCommand} from '../src/features/tax-documents/infrastructure/applyTaxIssueWrites';
const historyAuth=vi.hoisted(()=>({currentUser:{uid:'tax-ui-uid'} as {uid:string}|null,listeners:new Set<(user:{uid:string}|null)=>void>()}));
beforeEach(()=>{historyAuth.currentUser={uid:'tax-ui-uid'};historyAuth.listeners.clear();vi.mocked(fetchDateRange).mockReset().mockResolvedValue([]);vi.mocked(getPendingTaxIssue).mockReturnValue(null);vi.mocked(resumeTaxIssue).mockReset().mockResolvedValue([]);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
import type { CompanyInfo, IssuedStatement, Partner } from '../src/shared/types';
import { where } from 'firebase/firestore';

vi.mock('../src/shared/firebase',()=>({auth:historyAuth}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:{uid:string}|null)=>void)=>{historyAuth.listeners.add(callback);callback(historyAuth.currentUser);return()=>historyAuth.listeners.delete(callback);}}));
vi.mock('../src/features/tax-documents/infrastructure/applyTaxIssueWrites',()=>({getPendingTaxIssue:vi.fn().mockReturnValue(null),resumeTaxIssue:vi.fn().mockResolvedValue([])}));
vi.mock('../src/shared/services/firebaseService', () => ({
  fetchDateRange: vi.fn().mockResolvedValue([]),
}));
// 아래 재출력 시험은 검증된 최초 원문을 서비스 경계에서 제공한다. legacy 검증은 별도 회귀로 확인한다.
vi.mock('../src/features/tax-documents/infrastructure/taxIssueHistory',()=>({readTaxIssueHistory:vi.fn()}));
beforeEach(()=>{vi.mocked(readTaxIssueHistory).mockReset().mockImplementation(async(_company,rows)=>({error:'',groups:rows.filter(row=>row.taxIssuedAt).map(row=>({key:row.id,stmts:[row],totalAmount:row.totalAmount,isBundle:false,issuedAt:row.taxIssuedAt!,partnerId:row.partnerId,partnerName:row.partnerName,kind:'taxable' as const,originalVerified:true,notice:''}))}));});

const 이번달 = new Date().toISOString().slice(0, 7);
it('발행 조회 탭 다음 검색조건을 표시하고 조회 전환으로 발행 writer를 호출하지 않는다',()=>{
 const issue=vi.fn();render(<TaxStatement issuedStatements={[]} partners={[]} companyInfo={회사} onApplyTaxIssue={issue}/>);
 const title=screen.getByRole('heading',{name:'세금계산서'}),tab=screen.getByRole('button',{name:'발행'}),query=screen.getByRole('heading',{name:'검색조건'}),search=screen.getByRole('textbox',{name:'발행 거래처 검색'});
 expect(title.compareDocumentPosition(tab)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(tab.compareDocumentPosition(query)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(search).toHaveClass('h-10','bg-slate-50');expect(screen.getByLabelText('발행 월')).toHaveClass('h-10','bg-slate-50');
 const panel=search.closest('section')!;fireEvent.change(search,{target:{value:'다른조건'}});fireEvent.click(within(panel).getByRole('button',{name:'초기화'}));expect(search).toHaveValue('');expect(within(panel).queryByText('해당 월 거래처 없음')).toBeNull();
 fireEvent.change(search,{target:{value:'확인'}});fireEvent.click(screen.getByRole('button',{name:'조회'}));expect(screen.getByRole('textbox',{name:'조회 거래처 검색'})).toHaveClass('h-10');fireEvent.click(screen.getByRole('button',{name:'발행'}));expect(screen.getByRole('textbox',{name:'발행 거래처 검색'})).toHaveValue('확인');expect(issue).not.toHaveBeenCalled();
});

const 회사: CompanyInfo = {
  name: '태백식품',
  ceoName: '태백대표',
  bizNo: '999-88-77777',
  bizType: '제조업',
  bizItem: '식용유지',
  address: '충북 음성군 태백로 1',
  phone: '043-999-8888',
  fax: '043-999-7777',
};

/** 이름은 같고 서류 정보는 전부 다르다. 이름으로 찾으면 시험이 반드시 깨져야 한다. */
const 거래처A = {
  id: 'partner-same-a',
  name: '동명유통',
  type: '일반',
  bizNo: '111-11-11111',
  ownerName: '김첫째',
  address: '서울시 중구 세종대로 1',
  addressDetail: '가동 101호',
  tel: '02-1111-1111',
  fax: '02-1111-1112',
} as Partner;

const 거래처B = {
  id: 'partner-same-b',
  name: '동명유통',
  type: '일반',
  bizNo: '222-22-22222',
  ownerName: '이둘째',
  address: '부산시 중구 중앙대로 2',
  addressDetail: '나동 202호',
  tel: '051-2222-2222',
  fax: '051-2222-2223',
} as Partner;

const 거래처A값 = [
  거래처A.bizNo!,
  거래처A.ownerName!,
  `${거래처A.address} ${거래처A.addressDetail}`,
  거래처A.tel!,
  거래처A.fax!,
];

const 거래처B값 = [
  거래처B.bizNo!,
  거래처B.ownerName!,
  `${거래처B.address} ${거래처B.addressDetail}`,
  거래처B.tel!,
  거래처B.fax!,
];

function 전표(
  id: string,
  partnerId: string,
  docNo: string,
  taxIssuedAt?: string,
): IssuedStatement {
  return {
    id,
    issuedAt: `${이번달}-09T09:00:00+09:00`,
    tradeDate: `${이번달}-09`,
    type: '매출',
    partnerId,
    partnerName: '동명유통',
    orderId: `order-${id}`,
    docNo,
    totalSupply: 10_000,
    totalTax: 1_000,
    totalAmount: 11_000,
    items: [{
      itemId: 'sesame-oil', name: '참기름', spec: '300ml', qty: 1, price: 11_000,
      supply: 10_000, tax: 1_000, total: 11_000, isTaxExempt: false,
    }],
    taxIssuedAt,
  };
}

/** 정보 영역이 입력칸이든 일반 글씨든 사용자가 실제로 값을 볼 수 있어야 한다. */
function expectVisiblePartyValues(scope: HTMLElement, values: string[]) {
  for (const value of values) {
    const textMatches = within(scope).queryAllByText(value, { exact: true });
    const inputMatches = within(scope).queryAllByDisplayValue(value, { exact: true });
    expect(
      textMatches.length + inputMatches.length,
      `거래처관리 값 '${value}'이 화면에 표시되어야 합니다.`,
    ).toBeGreaterThan(0);
  }
}

function expectNoOtherPartnerValues(scope: HTMLElement, values: string[]) {
  for (const value of values) {
    expect(within(scope).queryByText(value, { exact: true })).not.toBeInTheDocument();
    expect(within(scope).queryByDisplayValue(value, { exact: true })).not.toBeInTheDocument();
  }
}

function taxDocument(): HTMLElement {
  const title = screen.getByRole('heading', { name: '세 금 계 산 서' });
  return title.parentElement?.parentElement ?? title;
}

describe('세금계산서 수량 표시 정밀도', () => {
  const cases = [
    { qty: 0.0001, label: '0.0001' },
    { qty: 1.2345, label: '1.2345' },
    { qty: 2, label: '2' },
    { qty: 1234567.890123, label: '1,234,567.890123' },
    { qty: Number.MAX_SAFE_INTEGER, label: '9,007,199,254,740,991' },
  ];
  it.each(cases.flatMap(value => ['현재 발행', '발행 내역'].map(mode => ({ ...value, mode }))))('$mode 과세·면세 수량 $label을 원문 그대로 표시하고 금액을 유지한다', async ({ qty, label, mode }) => {
    const statement = 전표('quantity-one', 거래처A.id, 'QTY-PRECISION-01', mode === '발행 내역' ? `${이번달}-09T10:00:00+09:00` : undefined);
    statement.items = [
      { itemId: 'quantity-taxable', name: '정밀 과세 품목', spec: '합성 규격', qty, price: 11000, supply: 10000, tax: 1000, total: 11000, isTaxExempt: false },
      { itemId: 'quantity-exempt', name: '정밀 면세 품목', spec: '합성 규격', qty, price: 20000, supply: 20000, tax: 0, total: 20000, isTaxExempt: true },
    ];
    statement.totalSupply = 30000; statement.totalTax = 1000; statement.totalAmount = 31000;
    const before = JSON.stringify(statement), issue = vi.fn().mockResolvedValue([]);
    render(<TaxStatement issuedStatements={[statement]} partners={[거래처A]} companyInfo={회사} onApplyTaxIssue={issue} />);
    if (mode === '발행 내역') {
      fireEvent.click(screen.getByRole('button', { name: '조회' }));
      const row = (await screen.findByText(/QTY-PRECISION-01/)).parentElement!.parentElement!;
      fireEvent.click(within(row).getByRole('button'));
    } else {
      fireEvent.click(screen.getByRole('button', { name: /동명유통/ }));
      fireEvent.click(screen.getByRole('button', { name: /QTY-PRECISION-01/ }));
    }
    const document = taxDocument();
    const taxable = within(document).getByText('정밀 과세 품목', { exact: true }).closest('tr')!;
    const exempt = within(document).getByText('정밀 면세 품목', { exact: true }).closest('tr')!;
    expect(Array.from(taxable.querySelectorAll('td')).map(td => td.textContent)).toEqual(['정밀 과세 품목', '합성 규격', label, '10,000', '1,000', '11,000']);
    expect(Array.from(exempt.querySelectorAll('td')).map(td => td.textContent)).toEqual(['정밀 면세 품목', '합성 규격', label, '20,000', '면세', '20,000']);
    expect(document).toHaveTextContent('31,000');
    expect(JSON.stringify(statement)).toBe(before);
    expect(issue).not.toHaveBeenCalled();
    expect(resumeTaxIssue).not.toHaveBeenCalled();
  });
});

describe('세금계산서 거래처 정보', () => {
  it('동명이인을 ID로 골라 거래처관리 값을 정보 영역과 발행 미리보기에 그대로 표시한다', () => {
    const statements = [
      전표('sale-a', 거래처A.id, 'A-260909-01'),
      전표('sale-b1', 거래처B.id, 'B-260909-01'),
      전표('sale-b2', 거래처B.id, 'B-260909-02'),
    ];
    render(
      <TaxStatement
        issuedStatements={statements}
        partners={[거래처B, 거래처A]}
        companyInfo={회사}
      />,
    );

    // 두 거래처의 상호는 같지만 A에 연결된 전표는 한 건이다. 이름 검색으로 첫 항목을
    // 임의 선택하지 않고, 그 ID에 계산된 건수가 붙은 거래처 행을 누른다.
    const partnerAButton = screen.getAllByRole('button', { name: /동명유통/ })
      .find(button => within(button).queryByText('미발행 1건'));
    expect(partnerAButton).toBeDefined();
    fireEvent.click(partnerAButton!);

    const infoHeading = screen.getByText(/공급받는자 정보/);
    const infoPanel = infoHeading.parentElement!;
    expectVisiblePartyValues(infoPanel, 거래처A값);
    expectNoOtherPartnerValues(infoPanel, 거래처B값);

    fireEvent.click(screen.getByRole('button', { name: /A-260909-01/ }));
    const document = taxDocument();
    expectVisiblePartyValues(document, 거래처A값);
    expectNoOtherPartnerValues(document, 거래처B값);
  });

  it('조회 탭 재출력도 전표의 partnerId에 해당하는 거래처 전체 정보를 표시한다', async () => {
    const issuedAtA = `${이번달}-09T10:00:00+09:00`;
    const issuedAtB = `${이번달}-09T11:00:00+09:00`;
    render(
      <TaxStatement
        issuedStatements={[
          전표('history-a', 거래처A.id, 'HIST-A-01', issuedAtA),
          전표('history-b', 거래처B.id, 'HIST-B-01', issuedAtB),
        ]}
        partners={[거래처B, 거래처A]}
        companyInfo={회사}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '조회' }));

    const aDocumentNo = await screen.findByText(/HIST-A-01/);
    const historyRow = aDocumentNo.parentElement?.parentElement!;
    const previewButton = within(historyRow).getByRole('button');
    fireEvent.click(previewButton);

    const document = taxDocument();
    expectVisiblePartyValues(document, 거래처A값);
    expectNoOtherPartnerValues(document, 거래처B값);
  });
});

describe('세금계산서 원본과 편집 세션', () => {
  const original = () => 전표('source-one', 거래처A.id, 'SOURCE-01');
  const updated = () => { const s = original(); return {...s, totalSupply:12_000,totalTax:1_200,totalAmount:13_200,items:s.items.map(i=>({...i,supply:12_000,tax:1_200,total:13_200}))}; };
  const props = (statements:IssuedStatement[],onApplyTaxIssue=vi.fn().mockResolvedValue([])) => ({issuedStatements:statements,partners:[거래처A],companyInfo:회사,onApplyTaxIssue});
  const select = () => { fireEvent.click(screen.getByRole('button',{name:/동명유통/}));fireEvent.click(screen.getByRole('button',{name:/SOURCE-01/})); };
  it.each(['월 선택','조회 초기화'])('%s로 발행 월을 바꾸면 이전 거래처·전표 선택을 함께 해제한다',mode=>{
    const current=original(),past={...original(),id:'past-source',docNo:'PAST-01',tradeDate:'2025-01-10'};
    render(<TaxStatement {...props([current,past])}/>);
    const month=screen.getByLabelText('발행 월');fireEvent.change(month,{target:{value:'2025-01'}});
    fireEvent.click(screen.getByRole('button',{name:/동명유통/}));fireEvent.click(screen.getByRole('button',{name:/PAST-01/}));expect(screen.getByDisplayValue('10000')).toBeInTheDocument();
    if(mode==='월 선택')fireEvent.change(month,{target:{value:이번달}});else fireEvent.click(within(screen.getByRole('region',{name:'검색조건'})).getByRole('button',{name:'초기화'}));
    expect(month).toHaveValue(이번달);expect(screen.getByText('거래처를 선택하세요')).toBeInTheDocument();expect(screen.queryByRole('heading',{name:'세 금 계 산 서'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:/동명유통/}));expect(screen.queryByRole('heading',{name:'세 금 계 산 서'})).toBeNull();
  });
  it('편집 전 동일 ID 원본 갱신은 최신 금액을 보여 준다',()=>{
    const view=render(<TaxStatement {...props([original()])}/>);select();expect(screen.getByDisplayValue('10000')).toBeInTheDocument();view.rerender(<TaxStatement {...props([updated()])}/>);expect(screen.getByDisplayValue('12000')).toBeInTheDocument();
  });
  it('편집 중 동일 ID 원본 변경은 초안을 보존하고 초기화 전 발행·PDF·인쇄를 막는다',()=>{
    const issue=vi.fn().mockResolvedValue([]);const view=render(<TaxStatement {...props([original()],issue)}/>);select();fireEvent.change(screen.getByDisplayValue('10000'),{target:{value:'9000'}});view.rerender(<TaxStatement {...props([updated()],issue)}/>);
    expect(screen.getByDisplayValue('9000')).toBeInTheDocument();expect(screen.getByText(/원본 전표가 변경/)).toBeInTheDocument();for(const name of ['발행','PDF','인쇄'])expect(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name})).toBeDisabled();fireEvent.click(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name:'발행'}));expect(issue).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button',{name:'초기화'}).find(button=>!button.closest('[aria-labelledby="tax-issue-query-title"]'))!);expect(screen.getByDisplayValue('12000')).toBeInTheDocument();expect(screen.queryByText(/원본 전표가 변경/)).not.toBeInTheDocument();for(const name of ['발행','PDF','인쇄'])expect(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name})).toBeEnabled();
  });
  it('마지막 편집 행 삭제는 빈 초안으로 유지한다',()=>{
    render(<TaxStatement {...props([original()])}/>);select();const input=screen.getByDisplayValue('참기름');const row=input.closest('tr')!;fireEvent.click(within(row).getByRole('button'));expect(screen.queryByDisplayValue('참기름')).not.toBeInTheDocument();
  });
  it('선택을 해제하고 다시 선택하면 최신 원본으로 새 편집 세션을 시작한다',()=>{
    const view=render(<TaxStatement {...props([original()])}/>);select();fireEvent.change(screen.getByDisplayValue('10000'),{target:{value:'9000'}});view.rerender(<TaxStatement {...props([updated()])}/>);fireEvent.click(screen.getByRole('button',{name:/SOURCE-01/}));fireEvent.click(screen.getByRole('button',{name:/SOURCE-01/}));expect(screen.getByDisplayValue('12000')).toBeInTheDocument();expect(screen.queryByText(/원본 전표가 변경/)).not.toBeInTheDocument();
  });
  it('월이 바뀌면 이전 초안을 종료하고 돌아올 때 원본으로 시작한다',()=>{
    const previousMonth='2026-01';const older={...original(),id:'old-one',docNo:'OLD-01',tradeDate:previousMonth+'-09'};render(<TaxStatement {...props([original(),older])}/>);select();fireEvent.change(screen.getByDisplayValue('10000'),{target:{value:'9000'}});fireEvent.change(screen.getByRole('combobox'),{target:{value:previousMonth}});fireEvent.change(screen.getByRole('combobox'),{target:{value:이번달}});select();expect(screen.getByDisplayValue('10000')).toBeInTheDocument();expect(screen.queryByDisplayValue('9000')).not.toBeInTheDocument();
  });
  it('거래처가 바뀌면 같은 금액의 이전 초안도 종료한다',()=>{
    const otherPartner={...거래처B,name:'다른 거래처'};const other=전표('other-one',otherPartner.id,'OTHER-01');render(<TaxStatement {...props([original(),other])} partners={[거래처A,otherPartner]}/>);select();fireEvent.change(screen.getByDisplayValue('10000'),{target:{value:'9000'}});fireEvent.click(screen.getByRole('button',{name:/다른 거래처/}));fireEvent.click(screen.getByRole('button',{name:/OTHER-01/}));expect(screen.getByDisplayValue('10000')).toBeInTheDocument();expect(screen.queryByDisplayValue('9000')).not.toBeInTheDocument();
  });
  it('품목 금액이 같아도 원본 전표 정보가 바뀌면 편집 중 출력을 막는다',()=>{
    const view=render(<TaxStatement {...props([original()])}/>);select();fireEvent.change(screen.getByDisplayValue('10000'),{target:{value:'9000'}});view.rerender(<TaxStatement {...props([{...original(),partnerName:'변경된 공급받는자'}])}/>);expect(screen.getByText(/원본 전표가 변경/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'PDF'})).toBeDisabled();
  });

  it('원본이 편집 시작 당시 값으로 돌아오면 초안을 보존하며 출력 차단을 해제한다',()=>{
    const view=render(<TaxStatement {...props([original()])}/>);select();fireEvent.change(screen.getByDisplayValue('10000'),{target:{value:'9000'}});view.rerender(<TaxStatement {...props([updated()])}/>);expect(screen.getByRole('button',{name:'PDF'})).toBeDisabled();view.rerender(<TaxStatement {...props([original()])}/>);expect(screen.getByDisplayValue('9000')).toBeInTheDocument();expect(screen.queryByText(/원본 전표가 변경/)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'PDF'})).toBeEnabled();
  });

});
 describe('발행 기록 저장 재개',()=>{
  const original=()=>전표('source-one',거래처A.id,'SOURCE-01');
  const select=()=>{fireEvent.click(screen.getByRole('button',{name:/동명유통/}));fireEvent.click(screen.getByRole('button',{name:/SOURCE-01/}));};
  const issueButton=()=>within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name:'발행'});
  it('unknown 후 닫기·재열기는 이전 전체 요청을 재개하고 새 발행을 하지 않는다',async()=>{
   vi.spyOn(window,'alert').mockImplementation(()=>{});let saved:TaxIssueCommand|null=null;
   vi.mocked(getPendingTaxIssue).mockImplementation(()=>saved);
   const issue=vi.fn(async (input:Omit<TaxIssueCommand,'companyId'>)=>{saved={...input,companyId:'taebaek'};throw new Error('unknown');});
   const props={issuedStatements:[original()],partners:[거래처A],companyInfo:회사,onApplyTaxIssue:issue};
   const view=render(<TaxStatement {...props}/>);select();fireEvent.click(issueButton());
   await waitFor(()=>expect(screen.getByRole('button',{name:'이전 발행 결과 확인'})).toBeInTheDocument());const before=saved;
   expect(issueButton()).toBeDisabled();view.unmount();render(<TaxStatement {...props}/>);
   expect(screen.getByText(/전표 1건/)).toBeInTheDocument();vi.mocked(resumeTaxIssue).mockImplementationOnce(async()=>{expect(saved).toEqual(before);saved=null;return [];});
   fireEvent.click(screen.getByRole('button',{name:'이전 발행 결과 확인'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'이전 발행 결과 확인'})).not.toBeInTheDocument());expect(issue).toHaveBeenCalledOnce();
  });
  it('빠른 두번 확인은 callback1회이고 늦은 완료가 새 회사 선택을 지우지 않는다',async()=>{
   let resolve!:(value:{id:string;data:{taxIssuedAt:string}}[])=>void;
   const issue=vi.fn(()=>new Promise<{id:string;data:{taxIssuedAt:string}}[]>(r=>{resolve=r;}));
   const props={issuedStatements:[original()],partners:[거래처A],companyInfo:회사,onApplyTaxIssue:issue};
   const view=render(<TaxStatement {...props}/>);select();const button=issueButton();fireEvent.click(button);fireEvent.click(button);expect(issue).toHaveBeenCalledOnce();
   view.rerender(<TaxStatement {...props} companyId="punghoe" issuedStatements={[{...original(),companyId:'punghoe'}]}/>);select();resolve([]);
   await waitFor(()=>expect(screen.getByRole('button',{name:/SOURCE-01/})).toBeInTheDocument());expect(screen.getByDisplayValue('10000')).toBeInTheDocument();
  });
 });

describe('늦은 세금 발행 응답 원문 보존',()=>{
 it('조회만 다시 시도한 경우 같은 인증 세대의 정상 발행 ACK는 선택을 정리한다',async()=>{
  const live=전표('retry-ack',거래처A.id,'RETRY-ACK');vi.mocked(fetchDateRange).mockRejectedValueOnce(new Error('synthetic-read-failure')).mockResolvedValueOnce([]);
  let finish!:(rows:{id:string;data:Partial<IssuedStatement>}[])=>void;const issue=vi.fn(()=>new Promise<{id:string;data:Partial<IssuedStatement>}[]>(resolve=>{finish=resolve;}));const alert=vi.spyOn(window,'alert').mockImplementation(()=>{});
  render(<TaxStatement issuedStatements={[live]} partners={[거래처A]} companyInfo={회사} onApplyTaxIssue={issue}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'과거 전표 다시 불러오기'})).toBeInTheDocument());fireEvent.click(screen.getByRole('button',{name:/동명유통/}));fireEvent.click(screen.getByRole('button',{name:/RETRY-ACK/}));fireEvent.click(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name:'발행'}));
  fireEvent.click(screen.getByRole('button',{name:'과거 전표 다시 불러오기'}));await waitFor(()=>expect(fetchDateRange).toHaveBeenCalledTimes(2));
  await act(async()=>finish([]));expect(screen.queryByRole('button',{name:'PDF'})).not.toBeInTheDocument();expect(issue).toHaveBeenCalledOnce();expect(alert).not.toHaveBeenCalled();
 });
 it.each(['success','error'] as const)('한 배치의 인증 A→B→A 이후 옛 발행 %s는 선택·새 복구 작업·대기 정보를 갱신하지 않는다',async outcome=>{
  const original={...전표('auth-aba',거래처A.id,'AUTH-ABA'),mutationRevision:0};vi.mocked(fetchDateRange).mockResolvedValue([original]);
  let pending:TaxIssueCommand|null=null,finishOld!:(rows:{id:string;data:Partial<IssuedStatement>}[])=>void,rejectOld!:(error:Error)=>void,finishResume!:(rows:{id:string;data:Partial<IssuedStatement>}[])=>void;
  vi.mocked(getPendingTaxIssue).mockImplementation(()=>pending);const alert=vi.spyOn(window,'alert').mockImplementation(()=>{});
  const issue=vi.fn(()=>{pending={companyId:'taebaek',operationId:'tax-auth-aba',issuedAt:'2026-10-15T00:00:00Z',scope:'all',statements:[original]};return new Promise<{id:string;data:Partial<IssuedStatement>}[]>((resolve,reject)=>{finishOld=resolve;rejectOld=reject;});});
  vi.mocked(resumeTaxIssue).mockImplementationOnce(()=>new Promise(resolve=>{finishResume=resolve;}));
  render(<TaxStatement issuedStatements={[]} partners={[거래처A]} companyInfo={회사} onApplyTaxIssue={issue}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:/동명유통/})).toBeInTheDocument());fireEvent.click(screen.getByRole('button',{name:/동명유통/}));fireEvent.click(screen.getByRole('button',{name:/AUTH-ABA/}));fireEvent.click(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name:'발행'}));
  const readsBefore=vi.mocked(getPendingTaxIssue).mock.calls.length;
  await act(async()=>{for(const uid of ['other-actor','tax-ui-uid']){historyAuth.currentUser={uid};historyAuth.listeners.forEach(listener=>listener(historyAuth.currentUser));}});
  expect(vi.mocked(getPendingTaxIssue).mock.calls.length).toBe(readsBefore+1);
  const resume=screen.getByRole('button',{name:'이전 발행 결과 확인'});expect(resume).toBeEnabled();fireEvent.click(resume);expect(resume).toBeDisabled();
  const readsAfterAuth=vi.mocked(getPendingTaxIssue).mock.calls.length;
  await act(async()=>{if(outcome==='success')finishOld([{id:original.id,data:{taxIssuedAt:'2026-10-15T01:00:00Z',mutationRevision:1}}]);else rejectOld(new Error('old-auth-error'));});
  expect(screen.getByRole('button',{name:'PDF'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'이전 발행 결과 확인'})).toBeDisabled();expect(vi.mocked(getPendingTaxIssue).mock.calls.length).toBe(readsAfterAuth);expect(alert).not.toHaveBeenCalled();
  expect(within(screen.getByRole('button',{name:/AUTH-ABA/})).getByText('미발행',{exact:true})).toBeInTheDocument();
  await act(async()=>{pending=null;finishResume([{id:original.id,data:{taxIssuedAt:'2026-10-15T02:00:00Z',mutationRevision:1}}]);});
  expect(screen.queryByRole('button',{name:'PDF'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'이전 발행 결과 확인'})).not.toBeInTheDocument();expect(vi.mocked(getPendingTaxIssue).mock.calls.length).toBe(readsAfterAuth+1);expect(issue).toHaveBeenCalledOnce();expect(resumeTaxIssue).toHaveBeenCalledOnce();expect(alert).not.toHaveBeenCalled();
 });
 it('과거 전표 발행 ACK를 행과 다음 요청에 반영하고 선택을 해제하며 오류 안내를 띄우지 않는다',async()=>{
  const original={...전표('history-ack',거래처A.id,'HISTORY-ACK'),mutationRevision:0};
  vi.mocked(fetchDateRange).mockResolvedValueOnce([original]);const alert=vi.spyOn(window,'alert').mockImplementation(()=>{});
  const issuedAt='2026-10-14T15:30:00Z';
  const issue=vi.fn().mockResolvedValueOnce([{id:original.id,data:{taxIssuedAt:issuedAt,mutationRevision:1}}]).mockResolvedValue([]);
  render(<TaxStatement issuedStatements={[]} partners={[거래처A]} companyInfo={회사} onApplyTaxIssue={issue}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:/동명유통/})).toBeInTheDocument());fireEvent.click(screen.getByRole('button',{name:/동명유통/}));fireEvent.click(screen.getByRole('button',{name:/HISTORY-ACK/}));
  fireEvent.click(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name:'발행'}));
  await waitFor(()=>expect(within(screen.getByRole('button',{name:/HISTORY-ACK/})).getByText('발행',{exact:true})).toBeInTheDocument());
  expect(screen.queryByRole('button',{name:'PDF'})).not.toBeInTheDocument();expect(alert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:/HISTORY-ACK/}));fireEvent.click(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name:'발행'}));
  await waitFor(()=>expect(issue).toHaveBeenCalledTimes(2));expect(issue.mock.calls[1][0].statements[0]).toMatchObject({taxIssuedAt:issuedAt,mutationRevision:1});expect(alert).not.toHaveBeenCalled();
 });
 it('이전 응답 revision이 과거조회 최신 revision을 낮추지 않는다',async()=>{
  const current={...전표('source-one',거래처A.id,'SOURCE-01'),mutationRevision:2};
  vi.mocked(fetchDateRange).mockResolvedValueOnce([current]);
  let pending:TaxIssueCommand|null={companyId:'taebaek',operationId:'tax-old',scope:'all',issuedAt:'2026-10-09T00:00:00Z',statements:[{...current,mutationRevision:0}]};
  vi.mocked(getPendingTaxIssue).mockImplementation(()=>pending);
  vi.mocked(resumeTaxIssue).mockImplementationOnce(async()=>{pending=null;return [{id:current.id,data:{taxIssuedAt:'2026-10-09T00:00:00Z',mutationRevision:1}}];});
  const issue=vi.fn().mockResolvedValue([]);render(<TaxStatement issuedStatements={[]} partners={[거래처A]} companyInfo={회사} onApplyTaxIssue={issue}/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:/동명유통/})).toBeInTheDocument());fireEvent.click(screen.getByRole('button',{name:'이전 발행 결과 확인'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'이전 발행 결과 확인'})).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button',{name:/동명유통/}));fireEvent.click(screen.getByRole('button',{name:/SOURCE-01/}));fireEvent.click(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name:'발행'}));
  await waitFor(()=>expect(issue).toHaveBeenCalledOnce());expect(issue.mock.calls[0][0].statements[0].mutationRevision).toBe(2);
 });
 it('발행 대기 중 새로 고른 전표를 이전 성공이 해제하지 않는다',async()=>{
  const first=전표('source-one',거래처A.id,'SOURCE-01'),second=전표('source-two',거래처A.id,'SOURCE-02');
  let resolve!:(value:{id:string;data:Partial<IssuedStatement>}[])=>void;const issue=vi.fn((_input:{statements:IssuedStatement[]})=>new Promise<{id:string;data:Partial<IssuedStatement>}[]>(r=>{resolve=r;}));
  render(<TaxStatement issuedStatements={[first,second]} partners={[거래처A]} companyInfo={회사} onApplyTaxIssue={issue}/>);
  fireEvent.click(screen.getByRole('button',{name:/동명유통/}));fireEvent.click(screen.getByRole('button',{name:/SOURCE-01/}));fireEvent.click(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name:'발행'}));
  fireEvent.click(screen.getByRole('button',{name:/SOURCE-01/}));fireEvent.click(screen.getByRole('button',{name:/SOURCE-02/}));resolve([{id:first.id,data:{taxIssuedAt:'2026-10-09T00:00:00Z',mutationRevision:1}}]);
  await waitFor(()=>expect(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name:'발행'})).toBeEnabled());fireEvent.click(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name:'발행'}));expect(issue.mock.calls[1][0].statements.map((row:IssuedStatement)=>row.id)).toEqual([second.id]);
 });
});

describe('한국 달력과 회사별 과거 전표 조회',()=>{
 const props={issuedStatements:[] as IssuedStatement[],partners:[거래처A],companyInfo:회사};
 const deferred=()=>{let resolve!:(rows:IssuedStatement[])=>void;const promise=new Promise<IssuedStatement[]>(r=>{resolve=r;});return {promise,resolve};};
 const emitAuth=(uid:string|null)=>act(()=>{historyAuth.currentUser=uid?{uid}:null;historyAuth.listeners.forEach(listener=>listener(historyAuth.currentUser));});
 const selectPartner=()=>fireEvent.click(screen.getByRole('button',{name:/동명유통/}));
 it.each([['2026-10-01T00:30:00+09:00','2026-10','2025-10-01'],['2027-01-01T00:30:00+09:00','2027-01','2026-01-01']])('한국 월초 %s의 선택월·현재월·12개월 조회시작일을 보존한다', (clock,month,start)=>{
  vi.stubEnv('TZ','Asia/Seoul');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(clock));
  const previousMonth=new Date(clock).toISOString().slice(0,7);
  const view=render(<TaxStatement {...props} issuedStatements={[
    {...전표('current-month',거래처A.id,'CURRENT-MONTH'),tradeDate:month+'-01'},
    {...전표('previous-month',거래처A.id,'PREVIOUS-MONTH'),tradeDate:previousMonth+'-15'},
  ]}/>);
  const option=screen.getByRole('option',{name:month.replace('-','년 ')+'월'});
  expect(option.closest('select')).toHaveValue(month);
  expect(vi.mocked(fetchDateRange).mock.calls[0]).toEqual(['issuedStatements','tradeDate',start,month+'-01',[where('companyId','==','taebaek')]]);
  view.unmount();
 });
 it('보존된 발행 시각은 한국 날짜로 안내한다',()=>{
  vi.stubEnv('TZ','Asia/Seoul');
  vi.mocked(getPendingTaxIssue).mockReturnValue({companyId:'taebaek',operationId:'tax-old',issuedAt:'2026-09-30T15:30:00Z',scope:'all',statements:[전표('p',거래처A.id,'P')]} as TaxIssueCommand);
  render(<TaxStatement {...props}/>);
  expect(screen.getByText(/발행 결과 확인이 필요합니다.*2026-10-01/)).toBeInTheDocument();
 });
 it('회사 A의 늦은 결과를 버리고 회사 B 조건으로 다시 조회한다',async()=>{
  const a=deferred(),b=deferred();vi.mocked(fetchDateRange).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const view=render(<TaxStatement {...props} companyId="taebaek"/>);view.rerender(<TaxStatement {...props} companyId="punghoe"/>);
  expect(vi.mocked(fetchDateRange).mock.calls[1][4]).toEqual([where('companyId','==','punghoe')]);
  await act(async()=>{a.resolve([{...전표('old',거래처A.id,'OLD-A'),companyId:'taebaek'}]);});
  expect(screen.queryByRole('button',{name:/동명유통/})).not.toBeInTheDocument();
  await act(async()=>{b.resolve([{...전표('new',거래처A.id,'NEW-B'),companyId:'punghoe'}]);});selectPartner();
  expect(screen.getByRole('button',{name:/NEW-B/})).toBeInTheDocument();expect(screen.queryByRole('button',{name:/OLD-A/})).not.toBeInTheDocument();
 });
 it('같은 회사의 실제 UID 구독 변경은 기존 결과를 숨기고 이전 UID의 늦은 응답을 버린다',async()=>{
  const old=deferred(),next=deferred();vi.mocked(fetchDateRange).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  render(<TaxStatement {...props}/>);expect(historyAuth.listeners.size).toBe(1);emitAuth('next-user');
  expect(fetchDateRange).toHaveBeenCalledTimes(2);
  await act(async()=>{next.resolve([전표('new',거래처A.id,'NEW-UID')]);});selectPartner();expect(screen.getByRole('button',{name:/NEW-UID/})).toBeInTheDocument();
  await act(async()=>{old.resolve([전표('old',거래처A.id,'OLD-UID')]);});
  expect(screen.queryByRole('button',{name:/OLD-UID/})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:/NEW-UID/})).toBeInTheDocument();
  emitAuth(null);expect(screen.queryByRole('button',{name:/NEW-UID/})).not.toBeInTheDocument();expect(fetchDateRange).toHaveBeenCalledTimes(2);
 });
 it('조회 실패를 안내하고 읽기만 다시 시도하며 최신 라이브 전표가 같은 ID 과거값보다 우선한다',async()=>{
  const live=전표('same',거래처A.id,'LIVE-NEW'),oldHistory={...live,docNo:'HISTORY-OLD'};const issue=vi.fn();vi.mocked(fetchDateRange).mockRejectedValueOnce(new Error('synthetic-denied')).mockResolvedValueOnce([oldHistory]);
  render(<TaxStatement {...props} issuedStatements={[live]} onApplyTaxIssue={issue}/>);selectPartner();fireEvent.click(screen.getByRole('button',{name:/LIVE-NEW/}));fireEvent.change(screen.getByDisplayValue('10000'),{target:{value:'9000'}});
  await waitFor(()=>expect(screen.getByRole('button',{name:'과거 전표 다시 불러오기'})).toBeInTheDocument());
  expect(screen.getByText(/과거 전표를 불러오지 못했습니다/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'과거 전표 다시 불러오기'}));
  await waitFor(()=>expect(fetchDateRange).toHaveBeenCalledTimes(2));
  expect(screen.getByDisplayValue('9000')).toBeInTheDocument();expect(screen.getByRole('button',{name:/LIVE-NEW/})).toBeInTheDocument();expect(screen.queryByRole('button',{name:/HISTORY-OLD/})).not.toBeInTheDocument();expect(issue).not.toHaveBeenCalled();
 });
 it('한 배치의 UID A→B→A도 새 세대로 조회하고 앞선 A 결과를 적용하지 않는다',async()=>{
  const old=deferred(),next=deferred();vi.mocked(fetchDateRange).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  render(<TaxStatement {...props}/>);
  act(()=>{for(const uid of ['other-user','tax-ui-uid']){historyAuth.currentUser={uid};historyAuth.listeners.forEach(listener=>listener(historyAuth.currentUser));}});
  expect(fetchDateRange).toHaveBeenCalledTimes(2);
  await act(async()=>{next.resolve([전표('new',거래처A.id,'NEW-ABA')]);});selectPartner();
  await act(async()=>{old.resolve([전표('old',거래처A.id,'OLD-ABA')]);});
  expect(screen.getByRole('button',{name:/NEW-ABA/})).toBeInTheDocument();expect(screen.queryByRole('button',{name:/OLD-ABA/})).not.toBeInTheDocument();
 });
 it('마운트 해제는 실제 인증 구독을 끊고 늦은 조회 결과를 적용하지 않는다',async()=>{
  const work=deferred();vi.mocked(fetchDateRange).mockReturnValueOnce(work.promise);const view=render(<TaxStatement {...props}/>);view.unmount();expect(historyAuth.listeners.size).toBe(0);
  await act(async()=>{work.resolve([전표('late',거래처A.id,'LATE-UNMOUNT')]);});expect(screen.queryByText(/LATE-UNMOUNT/)).not.toBeInTheDocument();
 });
});

const outputMocks=vi.hoisted(()=>({html:vi.fn().mockResolvedValue(undefined),pdf:vi.fn().mockResolvedValue(undefined),capture:vi.fn(),notice:vi.fn().mockResolvedValue(undefined)}));
vi.mock('../src/shared/components/appDialog',()=>({appNotice:outputMocks.notice}));
vi.mock('../src/shared/htmlPrintOutput',()=>({previewHtmlPrint:outputMocks.html}));
vi.mock('../src/shared/rasterPdfOutput',()=>({previewRasterPdf:outputMocks.pdf,snapshotOutputElement:(el:HTMLElement)=>{const element=el.cloneNode(true) as HTMLElement;document.body.append(element);return{element,dispose:()=>element.remove()};}}));
vi.mock('html2canvas',()=>({default:outputMocks.capture}));
describe('세금계산서 명시적 출력',()=>{
 beforeEach(()=>{outputMocks.html.mockClear();outputMocks.pdf.mockClear();outputMocks.capture.mockReset().mockResolvedValue({width:100,height:100,toDataURL:()=> 'data:image/png;base64,QA'});});
 it.each([['현재',100],['내역',300]] as const)('%s 문서만 HTML/PDF 미리보기로 보내고 회사전환이 출력을 취소한다',async (mode,height)=>{
  outputMocks.capture.mockResolvedValue({width:100,height,toDataURL:()=> 'data:image/png;base64,QA'});
  const issue=vi.fn(),st=전표('OUTPUT',거래처A.id,'OUTPUT',mode==='내역'?이번달+'-09T10:00:00+09:00':undefined);
  const view=render(<TaxStatement issuedStatements={[st]} partners={[거래처A]} companyInfo={회사} onApplyTaxIssue={issue}/>);
  if(mode==='내역'){fireEvent.click(screen.getByRole('button',{name:'조회'}));fireEvent.click(within((await screen.findByText(/OUTPUT/)).parentElement!.parentElement!).getByRole('button'));}
  else{fireEvent.click(screen.getByRole('button',{name:/동명유통/}));fireEvent.click(screen.getByRole('button',{name:/OUTPUT/}));}
  fireEvent.click(screen.getByRole('button',{name:'인쇄'}));expect(outputMocks.html).toHaveBeenCalledOnce();const html=outputMocks.html.mock.calls[0][0];expect(html.html).toContain('참기름');expect(html.html).toContain('<style>');expect(html.signal.aborted).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'PDF'}));await waitFor(()=>expect(outputMocks.pdf).toHaveBeenCalledOnce());const pdf=outputMocks.pdf.mock.calls[0][0];expect(pdf.pages).toEqual([{width:210,height:297,draws:[{image:'data:image/png;base64,QA',x:10,y:height===100?53.5:10,width:190,height:height*1.9}]}]);expect(issue).not.toHaveBeenCalled();
  view.rerender(<TaxStatement companyId="punghoe" issuedStatements={[]} partners={[]} companyInfo={회사}/>);expect(html.signal.aborted).toBe(true);expect(pdf.signal.aborted).toBe(true);
 });
 it('캡처대기중 unmount하면 PDF전달 없이 복제문서를 정리한다',async()=>{
  let finish!:(value:unknown)=>void;outputMocks.capture.mockReturnValue(new Promise(r=>finish=r));
  const view=render(<TaxStatement issuedStatements={[전표('LATE',거래처A.id,'LATE')]} partners={[거래처A]} companyInfo={회사}/>);fireEvent.click(screen.getByRole('button',{name:/동명유통/}));fireEvent.click(screen.getByRole('button',{name:/LATE/}));fireEvent.click(screen.getByRole('button',{name:'PDF'}));await waitFor(()=>expect(outputMocks.capture).toHaveBeenCalledOnce());const snapshot=outputMocks.capture.mock.calls[0][0];view.unmount();await act(async()=>finish({width:100,height:300,toDataURL:()=>''}));expect(outputMocks.pdf).not.toHaveBeenCalled();expect(snapshot.isConnected).toBe(false);
 });
});

it('PDF 캡처 실패는 저장하지 않고 재시도 안내 후 같은 작성내용을 유지한다',async()=>{
 outputMocks.capture.mockRejectedValueOnce(new Error('capture'));outputMocks.pdf.mockClear();outputMocks.notice.mockClear();
 render(<TaxStatement issuedStatements={[전표('FAILPDF',거래처A.id,'FAILPDF')]} partners={[거래처A]} companyInfo={회사}/>);fireEvent.click(screen.getByRole('button',{name:/동명유통/}));fireEvent.click(screen.getByRole('button',{name:/FAILPDF/}));fireEvent.click(screen.getByRole('button',{name:'PDF'}));await waitFor(()=>expect(outputMocks.notice).toHaveBeenCalledOnce());expect(outputMocks.pdf).not.toHaveBeenCalled();expect(taxDocument()).toHaveTextContent('참기름');expect(screen.getByRole('button',{name:'PDF'})).toBeEnabled();
});

describe('최초 발행 원문 조회 경계',()=>{
 it('조회 탭에서만 읽고 원본 미확인 항목은 이유를 보여 주며 재출력을 막는다',async()=>{
  const row=전표('legacy-original',거래처A.id,'LEGACY-ORIGINAL',이번달+'-09T10:00:00+09:00');
  vi.mocked(readTaxIssueHistory).mockResolvedValue({error:'',groups:[{key:'legacy',stmts:[row],totalAmount:row.totalAmount,isBundle:false,issuedAt:row.taxIssuedAt!,partnerId:row.partnerId,kind:'legacy',originalVerified:false,notice:'원본 확인 필요: 최초 발행 원문이 없습니다.'}]});
  const writer=vi.fn();render(<TaxStatement issuedStatements={[row]} partners={[거래처A]} onApplyTaxIssue={writer}/>);
  expect(readTaxIssueHistory).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'조회'}));
  expect(await screen.findByText('원본 확인 필요: 최초 발행 원문이 없습니다.')).toBeVisible();
  expect(screen.getByRole('button',{name:'원본 확인 필요'})).toBeDisabled();expect(screen.queryByRole('button',{name:'인쇄'})).toBeNull();
  fireEvent.change(screen.getByRole('textbox',{name:'조회 거래처 검색'}),{target:{value:'동명'}});expect(readTaxIssueHistory).toHaveBeenCalledTimes(1);expect(writer).not.toHaveBeenCalled();
 });
 it('불러오기 실패는 빈 이력으로 단정하지 않고 읽기만 다시 시도한다',async()=>{
  vi.mocked(readTaxIssueHistory).mockRejectedValueOnce(new Error('네트워크'));
  const writer=vi.fn();render(<TaxStatement issuedStatements={[전표('retry',거래처A.id,'RETRY')]} partners={[거래처A]} onApplyTaxIssue={writer}/>);
  fireEvent.click(screen.getByRole('button',{name:'조회'}));
  expect(await screen.findByText('발행 기록 조회를 완료하지 못했습니다')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'발행 기록 다시 불러오기'}));await waitFor(()=>expect(readTaxIssueHistory).toHaveBeenCalledTimes(2));expect(writer).not.toHaveBeenCalled();
 });
 it('다른 회사로 이동한 뒤 늦은 원문 응답은 이전 회사 이력을 노출하지 않는다',async()=>{
  let finish!:(value:Awaited<ReturnType<typeof readTaxIssueHistory>>)=>void;
  const row=전표('late',거래처A.id,'LATE-ORIGINAL');
  vi.mocked(readTaxIssueHistory).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<TaxStatement issuedStatements={[row]} partners={[거래처A]}/>);fireEvent.click(screen.getByRole('button',{name:'조회'}));
  view.rerender(<TaxStatement companyId="punghoe" issuedStatements={[]} partners={[거래처A]}/>);
  await act(async()=>finish({error:'',groups:[{key:'late',stmts:[row],totalAmount:110,isBundle:false,issuedAt:이번달+'-09',partnerId:row.partnerId,kind:'taxable',originalVerified:true,notice:''}]}));
  expect(screen.queryByText(/LATE-ORIGINAL/)).toBeNull();expect(screen.queryByRole('button',{name:'최초 발행 원문 보기'})).toBeNull();
 });
});

it('발행 월 변경은 이전 출력 수명을 중단한다',()=>{
 outputMocks.html.mockClear();const now=전표('MONTHNOW',거래처A.id,'MONTHNOW'),previous=전표('MONTHPREV',거래처A.id,'MONTHPREV');const d=new Date(이번달+'-15T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);const month=d.toISOString().slice(0,7);previous.tradeDate=month+'-09';
 render(<TaxStatement issuedStatements={[now,previous]} partners={[거래처A]} companyInfo={회사}/>);fireEvent.click(screen.getByRole('button',{name:/동명유통/}));fireEvent.click(screen.getByRole('button',{name:/MONTHNOW/}));fireEvent.click(screen.getByRole('button',{name:'인쇄'}));const input=outputMocks.html.mock.calls[0][0];expect(input.signal.aborted).toBe(false);fireEvent.change(screen.getByRole('combobox'),{target:{value:month}});expect(input.signal.aborted).toBe(true);
});
