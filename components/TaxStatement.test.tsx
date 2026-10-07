/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TaxStatement from './TaxStatement';
import type { CompanyInfo, IssuedStatement, Partner } from '../src/shared/types';

vi.mock('../src/shared/services/firebaseService', () => ({
  fetchDateRange: vi.fn().mockResolvedValue([]),
}));

const 이번달 = new Date().toISOString().slice(0, 7);

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

  it('조회 탭 재출력도 전표의 partnerId에 해당하는 거래처 전체 정보를 표시한다', () => {
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

    const aDocumentNo = screen.getByText(/HIST-A-01/);
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
  it('편집 전 동일 ID 원본 갱신은 최신 금액을 보여 준다',()=>{
    const view=render(<TaxStatement {...props([original()])}/>);select();expect(screen.getByDisplayValue('10000')).toBeInTheDocument();view.rerender(<TaxStatement {...props([updated()])}/>);expect(screen.getByDisplayValue('12000')).toBeInTheDocument();
  });
  it('편집 중 동일 ID 원본 변경은 초안을 보존하고 초기화 전 발행·PDF·인쇄를 막는다',()=>{
    const issue=vi.fn().mockResolvedValue([]);const view=render(<TaxStatement {...props([original()],issue)}/>);select();fireEvent.change(screen.getByDisplayValue('10000'),{target:{value:'9000'}});view.rerender(<TaxStatement {...props([updated()],issue)}/>);
    expect(screen.getByDisplayValue('9000')).toBeInTheDocument();expect(screen.getByText(/원본 전표가 변경/)).toBeInTheDocument();for(const name of ['발행','PDF','인쇄'])expect(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name})).toBeDisabled();fireEvent.click(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name:'발행'}));expect(issue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'초기화'}));expect(screen.getByDisplayValue('12000')).toBeInTheDocument();expect(screen.queryByText(/원본 전표가 변경/)).not.toBeInTheDocument();for(const name of ['발행','PDF','인쇄'])expect(within(screen.getByRole('button',{name:'PDF'}).parentElement!).getByRole('button',{name})).toBeEnabled();
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