import { expect, it } from 'vitest';
import { plMovement, plOfJournals, computeMonthPLFromJournals } from './profitLoss';
import type { AccountCode, AccountGroup, JournalEntry } from '../../../shared/types';
const accounts=[{id:'r',code:'R',name:'수익',type:'수익'},{id:'c',code:'C',name:'비용',type:'비용'},{id:'a',code:'A',name:'자산',type:'자산'}] as AccountCode[];
const journal=(date:string,lines:any[]):JournalEntry=>({id:date,date,sourceType:'자금',createdAt:'',lines});
it('손익 계정만 정상방향과 기존 폴백으로 소수·음수 증감을 계산한다',()=>{
 expect(plMovement(accounts[0],2.5,10)).toBe(7.5);expect(plMovement(accounts[1],2.5,10)).toBe(-7.5);expect(plMovement({...accounts[0],normalBalance:'debit'},2.5,10)).toBe(-7.5);expect(plMovement({...accounts[1],normalBalance:'credit'},2.5,10)).toBe(7.5);expect(plMovement(accounts[2],100,0)).toBe(0);expect(plMovement(undefined,100,0)).toBe(0);
});
it('분개 합계는 누락 차대0·미상계정·역분개를 보존하고 입력을 바꾸지 않는다',()=>{
 const entries=[journal('2026-10-01',[{accountCode:'R',credit:10.5},{accountCode:'C',debit:3.25},{accountCode:'C',credit:1},{accountCode:'A',debit:500},{accountCode:'unknown',debit:50}])],before=structuredClone(entries);expect(plOfJournals(entries,accounts)).toEqual({income:10.5,cost:2.25});expect(entries).toEqual(before);
});
it('월 prefix와 plLine·없는그룹 fallback을 그대로 집계한다',()=>{
 const entries=[journal('2026-10-01',[{accountCode:'R',credit:100.5},{accountCode:'C',debit:20.25}]),journal('2026-09-30',[{accountCode:'R',credit:999}])];const group=(code?:string)=>code==='C'?{id:'sgna',name:'판관비',type:'비용',plLine:'sgna'} as AccountGroup:undefined;expect(computeMonthPLFromJournals('2026-10',entries,accounts,group)).toEqual({sales:100.5,cogs:0,sgna:20.25,grossProfit:100.5,operatingProfit:80.25,otherIncome:0,otherExpense:0,netIncome:80.25});expect(computeMonthPLFromJournals('2026-1',entries,accounts,()=>undefined).cogs).toBe(20.25);
});
