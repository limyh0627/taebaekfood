/** @vitest-environment jsdom */
import React, {useState} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import PartnerLedger from './PartnerLedger';
import type {AccountCode, CashAccount, CashEntry, IssuedStatement, Partner} from '../src/shared/types';
vi.mock('../src/shared/firebase',()=>({auth:{currentUser:{uid:'manual-ui-user'}}}));
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
 return {...render(<Host/>),save,cashSave};
}
async function enter(debit='133',credit='375'){
 fireEvent.click(screen.getByRole('button',{name:'수동 전표 작성'}));
 await screen.findByRole('button',{name:'저장'}, {timeout:5000});
 fireEvent.change(screen.getByPlaceholderText('0'),{target:{value:'100'}});
 const selects=screen.getAllByRole('combobox').filter(element=>within(element).queryByRole('option',{name:'계정 —'}));
 fireEvent.change(selects[0],{target:{value:debit}});fireEvent.change(selects[1],{target:{value:credit}});
}
describe('거래처 원장의 실제 수동 전표 작성',()=>{
 it('회사 전환은 작성창을 재마운트하여 이전 회사 창이 돌아오지 않는다',async()=>{
  setup();await enter();fireEvent.click(screen.getByRole('button',{name:'풍회로 전환'}));expect(screen.queryByRole('button',{name:'저장'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'태백으로 전환'}));expect(screen.queryByRole('button',{name:'저장'})).toBeNull();
 });
 it('선택 거래처의 차대 원문을 저장하고 같은 원장에 반영한다',async()=>{
  const {save,cashSave}=setup();await enter();fireEvent.click(screen.getByRole('button',{name:'저장'}));
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).toMatchObject({partnerId:'a',companyId:'taebaek',type:'비용',totalAmount:100,items:[{accountCode:'133',side:'차변',total:100},{accountCode:'375',side:'대변',total:100}]});
  expect(cashSave).not.toHaveBeenCalled();await waitFor(()=>expect(screen.queryByRole('button',{name:'저장'})).toBeNull());
  expect(within(screen.getByRole('table',{name:'거래처 전체 전표'})).getByText('new-manual')).toBeTruthy();
  expect(within(screen.getByRole('table',{name:'거래처 계정별 잔액'})).getByText(/133 선급금/)).toBeTruthy();
 });
 it('unknown 원문은 다른 거래처 초기 선택에도 덮이지 않고 그대로 재시도한다',async()=>{
  const save=vi.fn().mockRejectedValueOnce(new Error('응답 유실')).mockResolvedValue({id:'saved'});setup(save);await enter();fireEvent.click(screen.getByRole('button',{name:'저장'}));await screen.findByRole('button',{name:'이전 전표 재시도'});
  const first=save.mock.calls[0][0];fireEvent.click(screen.getByRole('button',{name:'일반전표 발행 닫기'}));fireEvent.change(screen.getByPlaceholderText('거래처명'),{target:{value:'나 거래처'}});fireEvent.click(screen.getByRole('button',{name:'수동 전표 작성'}));await screen.findByRole('button',{name:'이전 전표 재시도'});fireEvent.click(screen.getByRole('button',{name:'이전 전표 재시도'}));await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));expect(save.mock.calls[1][0]).toEqual(first);expect(first.partnerId).toBe('a');await waitFor(()=>expect(localStorage.length).toBe(0));
 });
 it('통장 대변은 기존 현금 발행 콜백으로 보내고 비현금 전표를 중복 생성하지 않는다',async()=>{
  const {save,cashSave}=setup();fireEvent.click(screen.getByRole('button',{name:'수동 전표 작성'}));await screen.findByRole('button',{name:'저장'});fireEvent.click(screen.getByRole('button',{name:'출금'}));fireEvent.change(screen.getByPlaceholderText('업체명 검색...'),{target:{value:'가 거래처'}});fireEvent.mouseDown(within(screen.getByRole('dialog')).getByRole('button',{name:'가 거래처'}));fireEvent.change(screen.getAllByPlaceholderText('0')[0],{target:{value:'100'}});const select=screen.getAllByRole('combobox').find(element=>within(element).queryByRole('option',{name:'계정 —'}))!;fireEvent.change(select,{target:{value:'811'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));await waitFor(()=>expect(cashSave).toHaveBeenCalledTimes(1));expect(cashSave.mock.calls[0][0]).toMatchObject({dir:'출금',amount:100,partnerId:'a',cashAccountId:bank.id,accountCode:'811'});expect(save).not.toHaveBeenCalled();
 });
});
