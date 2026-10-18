/** @vitest-environment jsdom */
import React from 'react';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ProfitAnalysis from './ProfitAnalysis';
vi.mock('../src/shared/services/firebaseService',()=>({fetchWhere:vi.fn().mockResolvedValue([])}));
vi.mock('recharts',()=>{const Empty=()=>null;return {BarChart:Empty,Bar:Empty,LineChart:Empty,Line:Empty,XAxis:Empty,YAxis:Empty,CartesianGrid:Empty,Tooltip:Empty,ResponsiveContainer:Empty,Legend:Empty,Cell:Empty};});
afterEach(cleanup);
const props={companyId:'taebaek' as const,issuedStatements:[],cashEntries:[]};
it('손익은 보기탭 다음 계정설정 행동과 기간 조회를 분리한다',()=>{
 const {container}=render(<ProfitAnalysis {...props}/>);const tabs=container.querySelector('[data-page-header-slot="tabs"]')!,actions=screen.getByRole('group',{name:'손익 / 비용 관리 작업'}),query=screen.getByRole('region',{name:'손익 검색조건'});
 expect(tabs).not.toBeNull();expect(tabs.compareDocumentPosition(actions)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(actions.compareDocumentPosition(query)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(within(query).getByLabelText('조회 시작일')).toBeInTheDocument();fireEvent.change(within(query).getByLabelText('조회 시작일'),{target:{value:'2026-08-01'}});expect(within(query).getByLabelText('조회 시작일')).toHaveValue('2026-08-01');fireEvent.click(within(query).getByRole('button',{name:'초기화'}));expect(within(query).getByLabelText('조회 시작일')).not.toHaveValue('2026-08-01');
 fireEvent.click(within(actions).getByRole('button',{name:'계정 설정'}));expect(screen.getByRole('dialog',{name:'계정 설정'})).toBeInTheDocument();
});
it('거래처 현황은 PDF행동을 위에 두고 월과 검색을 조회 패널에 둔다',()=>{
 render(<ProfitAnalysis {...props} initialTab="partners"/>);const actions=screen.getByRole('group',{name:'거래처 현황 작업'}),query=screen.getByRole('region',{name:'거래처 현황 검색조건'});
 expect(within(actions).getByRole('button',{name:'거래처별 월간 정산 PDF'})).toHaveClass('h-9');expect(actions.compareDocumentPosition(query)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 const month=within(query).getByLabelText('거래처별 정산 PDF 월 선택'),search=within(query).getByPlaceholderText('거래처 검색...');expect(month).toHaveClass('h-10');expect(search).toHaveClass('h-10');
 fireEvent.change(search,{target:{value:'없는거래처'}});expect(search).toHaveValue('없는거래처');fireEvent.click(within(query).getByRole('button',{name:'초기화'}));expect(search).toHaveValue('');expect(screen.queryByRole('button',{name:'계정 설정'})).toBeNull();
});
it('현금흐름의 월별·기간 전환은 원래 조회 상태를 유지한다',()=>{
 render(<ProfitAnalysis {...props} initialTab="cash-flow"/>);const query=screen.getByRole('region',{name:'현금흐름 검색조건'});
 fireEvent.click(within(query).getByRole('button',{name:'월별'}));const month=query.querySelector('input[type="month"]')!;fireEvent.change(month,{target:{value:'2026-07'}});expect(month).toHaveValue('2026-07');
 fireEvent.click(within(query).getByRole('button',{name:'기간'}));
 expect(query.querySelector('input[type="month"]')).toBeNull();expect(screen.queryByRole('group',{name:/작업/})).toBeNull();
});
