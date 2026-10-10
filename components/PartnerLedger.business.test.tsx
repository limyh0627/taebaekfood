/** @vitest-environment jsdom */
import React from 'react';
import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,within} from '@testing-library/react';
import PartnerLedger from './PartnerLedger';
import type {IssuedStatement,CashEntry,AccountCode,Partner} from "../src/shared/types";
vi.mock('./PartnerAdvanceModal',()=>({default:({companyId,partnerId,onClose}:any)=><div role="dialog" aria-label="합성 적용"><span>{companyId+':'+partnerId}</span><button onClick={onClose}>적용 닫기</button></div>}));
vi.mock("../src/features/statements/infrastructure/issueTradeStatementCommand",()=>({recordPartnerPayment:vi.fn()}));
const accounts:AccountCode[]=[['108','외상매출금','자산','debit'],['251','외상매입금','부채','credit'],['253','미지급금','부채','credit'],['133','선급금','자산','debit'],['254','선수금','부채','credit'],['500','상품매입','비용','debit'],['800','매출','수익','credit']].map(([code,name,type,normalBalance])=>({id:code,code,name,type,normalBalance} as AccountCode));
const st=(id:string,partnerId:string,type:'매입'|'매출',amount=100,date='2026-09-02'):IssuedStatement=>({id,companyId:'taebaek',partnerId,partnerName:partnerId,tradeDate:date,issuedAt:date+'T01:00:00Z',docNo:id,type,orderId:'',totalSupply:amount,totalTax:0,totalAmount:amount,items:[{name:id,spec:'',qty:1,price:amount,supply:amount,tax:0,total:amount,isTaxExempt:true,accountCode:type==='매입'?'500':'800'}]});
const cash:CashEntry={id:'pay',companyId:'taebaek',partnerId:'양방향',partnerName:'양방향',date:'2026-09-03',createdAt:'2026-09-03T01:00:00Z',dir:'출금',cashAccountId:'bank',amount:40,accountCode:'251',docNo:'PAY-40',note:'지불40'};
const partners:Partner[]=[{id:'등록매입',name:'등록매입',companyId:'taebaek',type:'일반',partnerType:'매입처'},{id:'등록매출',name:'등록매출',companyId:'taebaek',type:'일반',partnerType:'매출처'},{id:'foreign',name:'다른회사',companyId:'punghoe',type:'일반',partnerType:'매입처'}];
const props={companyId:'taebaek' as const,accountCodes:accounts,cashAccounts:[],partners,cashEntries:[cash],issuedStatements:[st('SALE-ONLY','에스제이엠','매출'),st('BUY-BOTH','양방향','매입'),st('SALE-BOTH','양방향','매출',70),st('BUY-LEGACY','삭제거래처','매입'),{...st('FOREIGN','풍회전용','매입'),companyId:'punghoe' as const}]};
describe('방향별 업무 원장',()=>{
 it('매입은 매출only 제외·등록매입과 삭제거래처 보존, 양방향은 탭별 원장만 표시한다',()=>{
 render(<PartnerLedger {...props}/>);fireEvent.click(screen.getByRole('button',{name:'전체'}));
 expect(screen.queryByRole('button',{name:'에스제이엠'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'등록매출'})).not.toBeInTheDocument();expect(screen.queryByText('다른회사')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'등록매입'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'삭제거래처'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'양방향'}));const ledger=screen.getByRole('table',{name:'거래처 업무 원장'});
 expect(within(ledger).getByRole('button',{name:'BUY-BOTH'})).toBeInTheDocument();expect(within(ledger).getByText('PAY-40')).toBeInTheDocument();expect(within(ledger).queryByText('SALE-BOTH')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'매출 (미수)'}));expect(screen.getByRole('button',{name:'에스제이엠'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'등록매입'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'양방향'}));expect(within(screen.getByRole('table',{name:'거래처 업무 원장'})).getByRole('button',{name:'SALE-BOTH'})).toBeInTheDocument();
 });
 it('발생·지불은 날짜순 누적잔액60과 원문 상세를 유지하고 계정감사는 접힌다',()=>{
 render(<PartnerLedger {...props}/>);fireEvent.click(screen.getByRole('button',{name:'전체'}));fireEvent.click(screen.getByRole('button',{name:'양방향'}));const ledger=screen.getByRole('table',{name:'거래처 업무 원장'});
 const rows=within(ledger).getAllByRole('row').slice(1);expect(rows.map(row=>within(row).getAllByRole('cell').at(3)?.textContent)).toEqual(['BUY-BOTH','PAY-40']);expect(within(rows[1]).getAllByRole('cell')[6]).toHaveTextContent('60');
 const details=screen.getByText('계정별 잔액·전체 전표 상세').closest('details');expect(details).not.toHaveAttribute('open');
 fireEvent.click(within(ledger).getByRole('button',{name:'BUY-BOTH'}));expect(screen.getByRole('dialog',{name:'전표 BUY-BOTH'})).toBeInTheDocument();
 });
 it('거래 없는 등록매입의 기간0기초는 다른 매출거래처를 매입으로 만들지 않는다',()=>{
 render(<PartnerLedger {...props} issuedStatements={[st('SALE-ONLY','에스제이엠','매출')]} cashEntries={[]}/>);expect(screen.getByRole('button',{name:'등록매입'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'에스제이엠'})).not.toBeInTheDocument();expect(screen.getByRole('table',{name:'거래처 업무 원장'})).toBeInTheDocument();
 });
});


it('선급133·선수254와 기초251은 해당방향만 포함하고 회사전환은 원문을 노출하지 않는다',()=>{
 const opening={...st('기초-251','기초공급','매입',80),type:'비용' as const,items:[{...st('x','x','매입').items[0],accountCode:'375',side:'차변' as const,supply:80,total:80},{...st('x','x','매입').items[0],accountCode:'251',side:'대변' as const,supply:80,total:80}]};
 const prepaid={...cash,id:'prepaid',partnerId:'선급만',partnerName:'선급만',accountCode:'133',amount:30};const advance={...cash,id:'advance',partnerId:'선수만',partnerName:'선수만',dir:'입금' as const,accountCode:'254',amount:20};
 const view=render(<PartnerLedger {...props} issuedStatements={[opening]} cashEntries={[prepaid,advance]}/>);
 expect(screen.getByRole('button',{name:'기초공급'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'선급만'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'선수만'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'매출 (미수)'}));expect(screen.getByRole('button',{name:'선수만'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'선급만'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'기초공급'})).not.toBeInTheDocument();
 view.rerender(<PartnerLedger {...props} companyId="punghoe" issuedStatements={[opening]} cashEntries={[prepaid,advance]}/>);expect(screen.queryByRole('button',{name:'선수만'})).not.toBeInTheDocument();expect(screen.queryByText('기초공급')).not.toBeInTheDocument();
});


it('첫 표시 거래처와 검색·방향·회사 fallback은 남은 금액과 적용 모달에 같은 ID를 사용한다',()=>{
 const rows=[st('AUTO-A','가','매입',100),st('AUTO-B','나','매입',80),st('AUTO-SALE','다','매출',70),{...st('AUTO-FOREIGN','풍회','매입',40),companyId:'punghoe' as const}];
 const view=render(<PartnerLedger {...props} partners={[]} issuedStatements={rows} cashEntries={[]} returnOperations={[]} advanceStatements={[]}/>);fireEvent.click(screen.getByRole('button',{name:'전체'}));
 expect(within(screen.getByRole('table',{name:'거래처 업무 원장'})).getByRole('button',{name:'100 지불'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'선급·선수금 적용'}));expect(screen.getByText('taebaek:가')).toBeInTheDocument();
 fireEvent.change(screen.getByPlaceholderText('거래처명'),{target:{value:'나'}});expect(screen.getByText('taebaek:나')).toBeInTheDocument();expect(within(screen.getByRole('table',{name:'거래처 업무 원장'})).getByRole('button',{name:'80 지불'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'적용 닫기'}));fireEvent.change(screen.getByPlaceholderText('거래처명'),{target:{value:''}});fireEvent.click(screen.getByRole('button',{name:'매출 (미수)'}));expect(within(screen.getByRole('table',{name:'거래처 업무 원장'})).getByRole('button',{name:'70 수금'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'선급·선수금 적용'}));expect(screen.getByText('taebaek:다')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'적용 닫기'}));
 fireEvent.click(screen.getByRole('button',{name:'매입 (미지급)'}));view.rerender(<PartnerLedger {...props} companyId="punghoe" partners={[]} issuedStatements={rows} cashEntries={[]} returnOperations={[]} advanceStatements={[]}/>);expect(within(screen.getByRole('table',{name:'거래처 업무 원장'})).getByRole('button',{name:'40 지불'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'선급·선수금 적용'}));expect(screen.getByText('punghoe:풍회')).toBeInTheDocument();expect(screen.queryByText('taebaek:가')).not.toBeInTheDocument();
});
