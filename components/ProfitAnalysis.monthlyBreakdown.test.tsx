/** @vitest-environment jsdom */
import React from 'react';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import ProfitAnalysis from './ProfitAnalysis';
import {today} from '../src/shared/day';
import type {AccountCode,AccountGroup,CashEntry,IssuedStatement} from '../src/shared/types';
vi.mock('../src/shared/services/firebaseService',()=>({fetchWhere:vi.fn().mockResolvedValue([])}));
vi.mock('recharts',()=>{const Empty=()=>null;return {BarChart:Empty,Bar:Empty,LineChart:Empty,Line:Empty,XAxis:Empty,YAxis:Empty,CartesianGrid:Empty,Tooltip:Empty,ResponsiveContainer:Empty,Legend:Empty,Cell:Empty};});
afterEach(cleanup);
const groups=[{id:'revenue',name:'매출 그룹',type:'수익',plLine:'revenue'},{id:'cost',name:'원가 그룹',type:'비용',plLine:'cogs'},{id:'sgna',name:'관리 그룹',type:'비용',plLine:'sgna'},{id:'oi',name:'기타 수익 그룹',type:'수익',plLine:'other-income'},{id:'oe',name:'기타 비용 그룹',type:'비용',plLine:'other-expense'}] as AccountGroup[];
const accounts=[{id:'400',code:'400',name:'매출계정',type:'수익',groupId:'revenue'},{id:'500',code:'500',name:'매입계정',type:'비용',groupId:'cost'},{id:'520',code:'520',name:'급여계정',type:'비용',groupId:'sgna'},{id:'710',code:'710',name:'이자수익',type:'수익',groupId:'oi'},{id:'720',code:'720',name:'이자비용',type:'비용',groupId:'oe'},{id:'600',code:'600',name:'미분류비용',type:'비용'},{id:'103',code:'103',name:'자산계정',type:'자산'}] as AccountCode[];
const ym=today().slice(0,7),day=today();
const stmt=(id:string,type:'매출'|'매입',supply:number,tax:number,date=day):IssuedStatement=>({id,companyId:'taebaek',type,tradeDate:date,issuedAt:date,partnerId:'p',partnerName:'전표거래처',orderId:'',docNo:'전표-'+id,totalSupply:supply,totalTax:tax,totalAmount:supply+tax,items:[{name:'합성품',spec:'',qty:1,price:supply,supply,tax,total:supply+tax,accountCode:type==='매출'?'400':'500'}]} as IssuedStatement);
const cash=(id:string,accountCode:string,amount:number,dir:'입금'|'출금'):CashEntry=>({id,companyId:'taebaek',date:day,dir,amount,accountCode,cashAccountId:'bank',note:'합성-'+id,createdAt:''});
const open=()=>{fireEvent.click(screen.getByRole('button',{name:`${ym} 손익 상세 보기`}));return screen.getByRole('region',{name:`${ym} 손익 분석`});};
const amount=(root:HTMLElement,label:string)=>within(root).getByText(label,{exact:true}).parentElement;
it('분개 손익을 해당 월의 요약과 계정별로 표시하고 VAT·자산·전표목록을 포함하지 않는다',()=>{
 const statements=[stmt('sale','매출',1000,100),stmt('buy','매입',300,0)];
 render(<ProfitAnalysis companyId="taebaek" issuedStatements={statements} cashEntries={[cash('pay','520',200,'출금'),cash('interest-in','710',70,'입금'),cash('interest-out','720',50,'출금'),cash('unknown','600',60,'출금')]} accountCodes={accounts} accountGroups={groups}/>);
 const row=screen.getByRole('button',{name:`${ym} 손익 상세 보기`}).closest('tr')!;expect(within(row).getByText('1,000')).toBeInTheDocument();expect(within(row).getByText('360')).toBeInTheDocument();expect(within(row).getByText('440')).toBeInTheDocument();
 const detail=open();expect(amount(detail,'매출총이익')).toHaveTextContent('640원');expect(amount(detail,'영업이익')).toHaveTextContent('440원');expect(amount(detail,'영업외손익')).toHaveTextContent('20원');expect(amount(detail,'순이익')).toHaveTextContent('460원');
 const table=detail.closest('table')!,scroll=table.parentElement!;expect(scroll.style.containerType).toBe('inline-size');expect(detail.style.width).toContain('100cqw');expect(detail.style.width).toContain('2.5rem');expect(detail).toHaveClass('sticky','left-0','max-w-full');
 expect(amount(detail,'400 매출계정')).toHaveTextContent('1,000원');expect(amount(detail,'600 미분류비용')).toHaveTextContent('60원');expect(within(detail).getByText('그룹 없음 · 미분류')).toBeInTheDocument();expect(within(detail).queryByText('103 자산계정')).toBeNull();expect(within(detail).queryByText('전표 내역')).toBeNull();expect(within(detail).queryByText('전표-sale')).toBeNull();
});
it('영업외만 있는 월과 상쇄로 합계 0이 된 월도 펼친다',()=>{
 render(<ProfitAnalysis companyId="taebaek" issuedStatements={[]} cashEntries={[cash('interest','720',50,'출금'),cash('plus','710',10,'입금'),cash('minus','710',10,'출금')]} accountCodes={accounts} accountGroups={groups}/>);
 const detail=open();expect(amount(detail,'영업외손익')).toHaveTextContent('-50원');expect(amount(detail,'710 이자수익')).toHaveTextContent('0원');expect(amount(detail,'720 이자비용')).toHaveTextContent('50원');
});
it('다른 달과 분리하고 반품·재고 분개를 한 번만 반영한다',()=>{
 const [year,month]=ym.split('-').map(Number),prevDate=new Date(year,month-2,1),prevYm=`${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,'0')}`;
 render(<ProfitAnalysis companyId="taebaek" issuedStatements={[stmt('past','매출',9999,0,prevYm+'-01'),stmt('return','매출',-100,0),stmt('buy','매입',300,0)]} cashEntries={[]} accountCodes={accounts} accountGroups={groups} inventorySnapshots={[{id:'previous',yearMonth:prevYm,value:1000,recordedAt:prevYm+'-28'},{id:'current',yearMonth:ym,value:900,recordedAt:day}]}/>);
 fireEvent.change(screen.getByLabelText('조회 시작일'),{target:{value:prevYm+'-01'}});
 const detail=open();expect(amount(detail,'400 매출계정')).toHaveTextContent('-100원');expect(amount(detail,'500 매입계정')).toHaveTextContent('400원');expect(amount(detail,'매출총이익')).toHaveTextContent('-500원');expect(within(detail).queryByText('9,999원')).toBeNull();
});
it('모든 합계가 0으로 상쇄된 월도 펼쳐 계정 원문을 확인할 수 있다',()=>{
 render(<ProfitAnalysis companyId="taebaek" issuedStatements={[]} cashEntries={[cash('income','710',50,'입금'),cash('reverse','710',50,'출금')]} accountCodes={accounts} accountGroups={groups}/>);
 const detail=open();expect(amount(detail,'순이익')).toHaveTextContent('0원');expect(amount(detail,'710 이자수익')).toHaveTextContent('0원');
});
