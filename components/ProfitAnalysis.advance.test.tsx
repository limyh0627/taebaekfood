// @vitest-environment jsdom
import React from 'react';
import {act,fireEvent,render,screen,within} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import ProfitAnalysis from './ProfitAnalysis';
import {planAdvanceApplication} from '../src/shared/partnerAdvance';
import {today} from '../src/shared/day';
import type {IssuedStatement} from '../src/shared/types';
vi.mock('../src/shared/services/firebaseService',()=>({fetchWhere:vi.fn().mockResolvedValue([])}));
it('비용형 253 원전표만 있는 거래처도 적용 후 실제 화면의 기간말 미지급은 40이다',async()=>{
 const date=today(),source={collection:'cashEntries' as const,id:'cash',lineKey:'133'};
 const target:IssuedStatement={id:'target',companyId:'taebaek',partnerId:'p',partnerName:'합성 거래처',type:'비용',tradeDate:date,issuedAt:date,orderId:'',docNo:'대체-원전표',totalSupply:100,totalTax:0,totalAmount:100,items:[{name:'비용',spec:'',qty:1,price:100,supply:100,tax:0,total:100,isTaxExempt:true,accountCode:'500',side:'차변'},{name:'미지급금',spec:'',qty:1,price:100,supply:100,tax:0,total:100,isTaxExempt:true,accountCode:'253',side:'대변'}]};
 const plan=planAdvanceApplication({companyId:'taebaek',partnerId:'p',complete:true,unattributedReduction:false,blockedSourceKeys:[],sources:[{key:source,companyId:'taebaek',partnerId:'p',code:'133',originalAmount:100,date,fingerprint:'s',purpose:'pair'}],targets:[{statementId:'target',companyId:'taebaek',partnerId:'p',accountCode:'253',remaining:100,date,fingerprint:'t',purpose:'pair'}],priorSourceUse:new Map()}, {operationId:'apply',date,purpose:'pair',allocations:[{source,statementId:'target',accountCode:'253',amount:60}]});
 const applied:IssuedStatement={...target,id:'application',docNo:'대체-적용',totalSupply:60,totalAmount:60,items:plan.items.map(item=>({...item,isTaxExempt:true})),noncashApplication:plan.metadata};
 render(<ProfitAnalysis companyId="taebaek" initialTab="partners" issuedStatements={[target,applied]} cashEntries={[]} advanceStatements={[applied]} returnOperations={[]} />);
 await act(async()=>{});
 fireEvent.click(screen.getByRole('button',{name:'합성 거래처'}));
 const label=screen.getByText(/^(월말|연말) 미지급$/);
 expect(within(label.parentElement!).getByText('40')).toBeTruthy();
 expect(within(label.parentElement!).queryByText('100')).toBeNull();
});
