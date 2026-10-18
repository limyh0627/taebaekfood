/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StatementHistorySearchFields, { type StatementAccountChoice } from './StatementHistorySearchFields';

const accounts: StatementAccountChoice[] = [
  { value: 'group:sales', label: '매출', path: '손익 › 이익', axis: '손익', branch: '이익', isGroup: true, groupId: 'sales' },
  { value: 'code:401', label: '401 상품매출', path: '손익 › 이익 › 매출', axis: '손익', branch: '이익', groupId: 'sales' },
];

function baseProps() {
  return {
    partner: '', partnerOpen: false, partnerQuery: '', partnerShown: ['해피유통'],
    onPartnerOpen: vi.fn(), onPartnerQuery: vi.fn(), onPartner: vi.fn(),
    account: '', accountOpen: false, accountQuery: '', accountAxis: '' as const, accountBranch: '', accountGroup: '',
    accountShown: accounts, accountItems: accounts,
    onAccountOpen: vi.fn(), onAccountQuery: vi.fn(), onAccountAxis: vi.fn(), onAccountBranch: vi.fn(), onAccountGroup: vi.fn(), onAccount: vi.fn(),
    search: '', onSearch: vi.fn(),
  };
}

describe('전표 거래처·계정 검색기', () => {
  it('거래처 창과 전체 검색 변경을 부모로 전달한다', () => {
    const props = baseProps();
    render(<StatementHistorySearchFields {...props}/>);
    fireEvent.click(screen.getByRole('button', { name: '거래처 선택' }));
    fireEvent.change(screen.getByPlaceholderText('업체명 · 문서번호 · 계정과목 검색'), { target: { value: '해피' } });
    expect(props.onPartnerOpen).toHaveBeenCalledWith(true);
    expect(props.onPartnerQuery).toHaveBeenCalledWith('');
    expect(props.onSearch).toHaveBeenCalledWith('해피');
  });

  it('계정 묶음은 한 층 내려가고 계정은 필터로 확정한다', () => {
    const props = { ...baseProps(), accountOpen: true, accountAxis: '손익' as const, accountBranch: '이익' };
    render(<StatementHistorySearchFields {...props}/>);
    fireEvent.click(screen.getByRole('button', { name: /매출.*이 묶음 전체/ }));
    expect(props.onAccountGroup).toHaveBeenCalledWith('sales');
    fireEvent.click(screen.getByRole('button', { name: /^401 상품매출/ }));
    expect(props.onAccount).toHaveBeenCalledWith('code:401');
    expect(props.onAccountOpen).toHaveBeenCalledWith(false);
  });
});

it('전체검색은 주문 조회 규격이고 열린 선택기는 기존 40px 규격을 유지한다',()=>{
 const props={...baseProps(),partnerOpen:true,accountOpen:true};render(<StatementHistorySearchFields {...props}/>);
 for(const name of ['거래처 선택','계정 선택'])expect(screen.getByRole('button',{name})).toHaveClass('h-10','bg-slate-50');
 expect(screen.getByPlaceholderText('업체명 · 문서번호 · 계정과목 검색')).toHaveClass('h-10','bg-slate-50','rounded-md');
 for(const placeholder of ['거래처 이름으로 찾기','계정 이름·번호·묶음(재료비·판관비)'])expect(screen.getByPlaceholderText(placeholder)).toHaveClass('h-10','bg-white');
 for(const input of [screen.getByPlaceholderText('거래처 이름으로 찾기'),screen.getByPlaceholderText('계정 이름·번호·묶음(재료비·판관비)')])expect(input.parentElement?.parentElement).toHaveClass('max-w-full','sm:max-w-none');
});

it('전표 조건과 전체검색은 고정 순서의 별도 행이며 원래 검색 값은 보존한다',()=>{const props=baseProps(),view=render(<StatementHistorySearchFields {...props}/>);const rows=Array.from(view.container.querySelectorAll('[data-query-row]')).map(row=>row.getAttribute('data-query-row'));expect(rows).toEqual(['condition','search']);const search=screen.getByPlaceholderText('업체명 · 문서번호 · 계정과목 검색');expect(search.closest('[data-query-row="search"]')).not.toBeNull();for(const name of ['거래처 선택','계정 선택']){const button=screen.getByRole('button',{name});expect(button).toHaveClass('w-full');expect(button.parentElement).toHaveClass('static','sm:relative');expect(button.closest('[data-query-row="condition"]')).toHaveClass('relative');}fireEvent.change(search,{target:{value:'보존 검색'}});expect(props.onSearch).toHaveBeenCalledWith('보존 검색');});
