/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProfitAnalysis from './ProfitAnalysis';
import type { CashEntry, IssuedStatement } from '../src/shared/types';

vi.mock('../src/shared/services/firebaseService',()=>({fetchWhere:vi.fn().mockResolvedValue([])}));
vi.mock('recharts',()=>{
 const EmptyChart=()=>null;
 return {BarChart:EmptyChart,Bar:EmptyChart,LineChart:EmptyChart,Line:EmptyChart,XAxis:EmptyChart,YAxis:EmptyChart,CartesianGrid:EmptyChart,Tooltip:EmptyChart,ResponsiveContainer:EmptyChart,Legend:EmptyChart,Cell:EmptyChart};
});
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-12-31T12:00:00+09:00'));});
afterEach(()=>vi.useRealTimers());
const statement:IssuedStatement={id:'past-statement',companyId:'taebaek',type:'매출',partnerId:'p',partnerName:'합성 거래처',tradeDate:'2025-05-01',issuedAt:'2025-05-01',orderId:'',docNo:'SYNTHETIC-2025',items:[],totalSupply:0,totalTax:0,totalAmount:0};
const cash:CashEntry={id:'past-cash',companyId:'taebaek',date:'2024-05-01',createdAt:'2024-05-01T00:00:00Z',dir:'입금',cashAccountId:'synthetic-cash-account',amount:0,accountCode:'800',note:'합성 이전 연도'};
const props={companyId:'taebaek' as const,issuedStatements:[statement],cashEntries:[cash]};
const yearPicker=()=>screen.getAllByRole('combobox').find(element=>within(element).queryAllByRole('option').some(option=>/^\d{4}년$/.test(option.textContent??'')))!;

it('같은 전표·현금 배열로 새해에 재렌더되면 새 연도를 추가하고 기존 선택 연도는 바꾸지 않는다',async()=>{
 const emptyProps={companyId:'taebaek' as const,issuedStatements:[] as IssuedStatement[],cashEntries:[] as CashEntry[]};
 const view=render(<ProfitAnalysis {...emptyProps}/>);await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'당년'}));
 const select=yearPicker();expect(select).toHaveValue('2026');expect(within(select).queryByRole('option',{name:'2027년'})).not.toBeInTheDocument();
 vi.setSystemTime(new Date('2027-01-01T00:30:00+09:00'));view.rerender(<ProfitAnalysis {...emptyProps}/>);
 expect(within(yearPicker()).getByRole('option',{name:'2027년'})).toBeInTheDocument();expect(yearPicker()).toHaveValue('2026');
});

it('사용자가 고른 과거 연도와 전표·현금의 연도 선택지를 새해에도 보존한다',async()=>{
 const view=render(<ProfitAnalysis {...props}/>);await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'당년'}));const select=yearPicker();
 expect(within(select).getByRole('option',{name:'2025년'})).toBeInTheDocument();expect(within(select).getByRole('option',{name:'2024년'})).toBeInTheDocument();
 fireEvent.change(select,{target:{value:'2025'}});expect(yearPicker()).toHaveValue('2025');
 vi.setSystemTime(new Date('2027-01-01T00:30:00+09:00'));view.rerender(<ProfitAnalysis {...props}/>);
 expect(Array.from(yearPicker().querySelectorAll('option'),option=>option.value)).toEqual(['2027','2025','2024']);
 expect(yearPicker()).toHaveValue('2025');
});

it.each(['당월','분기','반기','당년'])('%s 빠른기간은 같은 달 다음날 재렌더에서 종료일을 갱신한다',async label=>{
 vi.setSystemTime(new Date('2026-10-15T12:00:00+09:00'));const view=render(<ProfitAnalysis {...props}/>);await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:label}));if(label==='분기')fireEvent.click(screen.getByRole('button',{name:'4분기'}));if(label==='반기')fireEvent.click(screen.getByRole('button',{name:'하반기'}));expect(screen.getByLabelText('조회 종료일')).toHaveValue('2026-10-15');vi.setSystemTime(new Date('2026-10-16T12:00:00+09:00'));view.rerender(<ProfitAnalysis {...props}/>);expect(screen.getByLabelText('조회 종료일')).toHaveValue('2026-10-16');
});
it('직접 입력한 기간은 다음날 재렌더에도 보존한다',async()=>{
 vi.setSystemTime(new Date('2026-10-15T12:00:00+09:00'));const view=render(<ProfitAnalysis {...props}/>);await act(async()=>{});fireEvent.change(screen.getByLabelText('조회 시작일'),{target:{value:'2026-08-03'}});fireEvent.change(screen.getByLabelText('조회 종료일'),{target:{value:'2026-09-07'}});vi.setSystemTime(new Date('2026-10-16T12:00:00+09:00'));view.rerender(<ProfitAnalysis {...props}/>);expect(screen.getByLabelText('조회 시작일')).toHaveValue('2026-08-03');expect(screen.getByLabelText('조회 종료일')).toHaveValue('2026-09-07');
});
it.each(['과거연도','완료분기'])('%s 빠른기간은 다음날에도 확정된 종료일을 유지한다',async kind=>{
 vi.setSystemTime(new Date('2026-10-15T12:00:00+09:00'));const view=render(<ProfitAnalysis {...props}/>);await act(async()=>{});if(kind==='과거연도'){fireEvent.click(screen.getByRole('button',{name:'당년'}));fireEvent.change(yearPicker(),{target:{value:'2025'}});}else{fireEvent.click(screen.getByRole('button',{name:'분기'}));fireEvent.click(screen.getByRole('button',{name:'1분기'}));}const expected=kind==='과거연도'?'2025-12-31':'2026-03-31';expect(screen.getByLabelText('조회 종료일')).toHaveValue(expected);vi.setSystemTime(new Date('2026-10-16T12:00:00+09:00'));view.rerender(<ProfitAnalysis {...props}/>);expect(screen.getByLabelText('조회 종료일')).toHaveValue(expected);
});
