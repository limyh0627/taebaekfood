const outputApi=vi.hoisted(()=>({download:vi.fn(),stop:vi.fn(),actor:null as null|((user:{uid:string})=>void)}));
vi.mock('../src/shared/listExcel',()=>({downloadListExcel:outputApi.download}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,cb:(user:{uid:string})=>void)=>{outputApi.actor=cb;cb({uid:'test-user'});return outputApi.stop;}}));
/** @vitest-environment jsdom */
import React, {useState} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import PartnerLedger from './PartnerLedger';
import type {AccountCode, CashAccount, CashEntry, IssuedStatement, Partner} from '../src/shared/types';
vi.mock('../src/shared/firebase',()=>({auth:{currentUser:{uid:'test-user'}},authReady:Promise.resolve()}));
vi.mock('../src/shared/useLoanContracts',()=>({useLoanContracts:()=>[]}));
vi.mock('../src/features/statements/infrastructure/issueTradeStatementCommand',()=>({recordPartnerPayment:vi.fn()}));
vi.mock('../src/shared/services/interCompanyTransferService',()=>({hasPendingTransfer:()=>false}));
const accounts = [
 {id:'108',code:'108',name:'외상매출금',normalBalance:'debit',type:'자산'},
 {id:'800',code:'800',name:'제품매출',normalBalance:'credit',type:'수익'},
 {id:'133',code:'133',name:'선급금',normalBalance:'debit',type:'자산'},
 {id:'375',code:'375',name:'기초자본',normalBalance:'credit',type:'자본'},
 {id:'811',code:'811',name:'관리비',normalBalance:'debit',type:'비용'},
 {id:'103',code:'103',name:'보통예금',normalBalance:'debit',type:'자산'},
] as AccountCode[];
const partners=[{id:'a',name:'가 거래처',companyId:'taebaek'},{id:'b',name:'나 거래처',companyId:'taebaek'}] as Partner[];
const bank={id:'cashacct-temp-main',companyId:'taebaek',name:'메인통장',active:true,type:'통장',openingBalance:0,openingDate:'2026-07-31',createdAt:'2026-07-31'} as CashAccount;
const original=(partnerId:string):IssuedStatement=>({id:'old-'+partnerId,companyId:'taebaek',type:'매출',tradeDate:'2026-10-09',issuedAt:'2026-10-09',partnerId,partnerName:partners.find(p=>p.id===partnerId)!.name,orderId:'',docNo:'old-'+partnerId,totalAmount:100,totalSupply:100,totalTax:0,items:[{name:'기존매출',spec:'',qty:1,price:100,supply:100,tax:0,total:100,isTaxExempt:true,accountCode:'800'}]});
beforeEach(()=>{localStorage.clear();vi.spyOn(window,'alert').mockImplementation(()=>{});});
function setup(save=vi.fn().mockResolvedValue({id:'saved'}),cashSave=vi.fn().mockResolvedValue({id:'cash'})){
 function Host(){const [statements,setStatements]=useState([original('a'),original('b')]);const [entries,setEntries]=useState<CashEntry[]>([]);const [companyId,setCompanyId]=useState<'taebaek'|'punghoe'>('taebaek');return <><button onClick={()=>setCompanyId('punghoe')}>풍회로 전환</button><button onClick={()=>setCompanyId('taebaek')}>태백으로 전환</button><PartnerLedger key={companyId} companyId={companyId} partners={partners} issuedStatements={statements} cashEntries={entries} cashAccounts={[bank]} accountCodes={accounts} accountGroups={[]} onAddIssuedStatement={async statement=>{await save(statement);setStatements(rows=>[...rows,{...statement,docNo:'new-manual'}]);}} onIssueCashEntry={async entry=>{await cashSave(entry);setEntries(rows=>[...rows,entry]);}} onAddCashEntry={cashSave}/></>;}
 const view=render(<Host/>);fireEvent.click(screen.getByRole('button',{name:'매출 (미수)'}));return {...view,save,cashSave};
}
describe('거래처 원장의 작성 진입 제거', () => {
 it('거래처 선택과 회사 전환 후에도 수동전표와 독립 상계 버튼을 제공하지 않는다', () => {
 const {save,cashSave}=setup();
 expect(screen.queryByRole('button',{name:'수동 전표 작성'})).toBeNull();
 expect(screen.queryByRole('button',{name:'선급·선수금 적용'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'풍회로 전환'}));fireEvent.click(screen.getByRole('button',{name:'태백으로 전환'}));
 expect(screen.queryByRole('button',{name:'수동 전표 작성'})).toBeNull();expect(save).not.toHaveBeenCalled();expect(cashSave).not.toHaveBeenCalled();
 });
});

it('출력미리보기signal은인증교체·회사전환·unmount에중단한다',async()=>{const view=setup();await waitFor(()=>expect(outputApi.actor).not.toBeNull());fireEvent.click(screen.getByRole('button',{name:'엑셀 저장'}));expect(outputApi.download).toHaveBeenCalledTimes(1);const first=outputApi.download.mock.calls[0][0].signal as AbortSignal;expect(first.aborted).toBe(false);outputApi.actor!({uid:'other'});expect(first.aborted).toBe(true);fireEvent.click(screen.getByRole('button',{name:'풍회로 전환'}));expect(outputApi.stop).toHaveBeenCalled();view.unmount();});
