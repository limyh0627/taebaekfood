import { describe, expect, it } from 'vitest';
import { allocatePartnerCash, partnerCashParts, partnerPaid } from './cashLedger';
import { journalizeCashEntry } from '../../shared/autoJournal';
import type { CashEntry, IssuedStatement } from '../../shared/types';
const cash=(extra:Partial<CashEntry>)=>({id:'c',date:'2026-10-08',dir:'출금',amount:100,companyId:'taebaek',cashAccountId:'bank',partnerId:'p',createdAt:'',...extra} as CashEntry);
const statement=(id:string,date:string)=>({id,companyId:'taebaek',partnerId:'p',type:'매입',tradeDate:date,totalAmount:80,totalSupply:80,totalTax:0,items:[{accountCode:'500',supply:80,tax:0,total:80}]} as IssuedStatement);
describe('거래처 표시와 FIFO의 실제 분개 투영',()=>{
  it('side 혼합 순액이 분개·거래처 지급·전표 FIFO에서 모두100이다',()=>{
    const row=cash({lines:[{accountCode:'251',amount:120,side:'차변',note:'총액'},{accountCode:'251',amount:-20,side:'대변',note:'되돌림'}]});
    const journal=journalizeCashEntry(row)!;
    const reduced=journal.lines.filter(l=>l.accountCode==='251').reduce((sum,l)=>sum+l.debit-l.credit,0);
    expect(reduced).toBe(100);
    expect(partnerPaid('p','매입',[row])).toBe(reduced);
    expect(partnerCashParts(row)).toEqual([{code:'251',reduce:120,note:'총액'},{code:'251',reduce:-20,note:'되돌림'}]);
    expect([...allocatePartnerCash('p','매입',[statement('old','2026-08-01'),statement('new','2026-09-01')],[row])]).toEqual([['old',0],['new',60]]);
  });
  it('반대 차대 상계는 증가로 표시하고 FIFO 지급으로 쓰지 않는다',()=>{
    const row=cash({dir:'대체',lines:[{accountCode:'251',amount:100,side:'대변'},{accountCode:'108',amount:100,side:'차변'}]});
    const journal=journalizeCashEntry(row)!;
    expect(journal.lines.find(l=>l.accountCode==='251')).toMatchObject({credit:100,debit:0});
    expect(partnerPaid('p','매입',[row])).toBe(-100);
    expect(partnerPaid('p','매출',[row])).toBe(-100);
    expect([...allocatePartnerCash('p','매입',[statement('old','2026-08-01')],[row])]).toEqual([['old',80]]);
  });
});
