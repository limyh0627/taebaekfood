import {describe,it,expect} from 'vitest';
import type {AccountCode,AccountGroup,JournalEntry} from '../../shared/types';
import {buildProfitAccountProjection} from './profitAccountProjection';
const accountCodes:AccountCode[]=[
 {id:'400',code:'400',name:'매출',type:'수익',groupId:'sales'},
 {id:'500',code:'500',name:'매입',type:'비용',groupId:'cost'},
 {id:'510',code:'510',name:'비용차감',type:'비용',normalBalance:'credit',groupId:'cost'},
 {id:'520',code:'520',name:'이자비용',type:'비용',groupId:'interest'},
 {id:'600',code:'600',name:'미분류비용',type:'비용'},
 {id:'103',code:'103',name:'통장',type:'자산'},
];
const groups:AccountGroup[]=[{id:'sales',name:'매출그룹',type:'수익',plLine:'revenue'},{id:'cost',name:'원가그룹',type:'비용',plLine:'cogs'},{id:'interest',name:'이자그룹',type:'비용',plLine:'other-expense'}];
const codeToGroup=(code:string)=>groups.find(group=>group.id===accountCodes.find(account=>account.code===code)?.groupId);
const entry=(date:string,lines:JournalEntry['lines']):JournalEntry=>({id:date,date,lines,sourceType:'수동',createdAt:date});
const journalEntries=[entry('2026-09-01',[
 {accountCode:'400',debit:100,credit:1000},{accountCode:'500',debit:500,credit:25},
 {accountCode:'510',debit:10,credit:80},{accountCode:'600',debit:20,credit:0},
 {accountCode:'103',debit:20000,credit:0},{accountCode:'missing',debit:10000,credit:0},
]),entry('2026-08-31',[{accountCode:'400',debit:0,credit:5000}]),entry('',[{accountCode:'400',debit:0,credit:7000}])];
const run=()=>buildProfitAccountProjection({journalEntries,accountCodes,codeToGroup,periodMonths:['2026-09']});
describe('손익 계정·그룹 기존 투영',()=>{
 it('매출 환입·비용 정정과 명시 normalBalance를 보존한다',()=>{expect(run().plByCode.map(row=>[row.code,row.amount])).toEqual([['400',900],['500',475],['510',70],['600',20],['520',0]]);});
 it('그룹 없는 계정도 합산하며 0 계정과 그룹을 유지한다',()=>{const result=run();expect(result.plByGroup.map(group=>[group.id,group.amount,group.rows.map(row=>row.code)])).toEqual([['sales',900,['400']],['cost',545,['500','510']],['(그룹없음)',20,['600']],['interest',0,['520']]]);expect(result.plByCode.find(row=>row.code==='520')).toMatchObject({name:'이자비용',amount:0,plLine:'other-expense'});});
 it('빈 기간은 손익 계정 전체를 0으로 표시하고 자산·미등록 계정은 제외한다',()=>{const result=buildProfitAccountProjection({journalEntries,accountCodes,codeToGroup,periodMonths:[]});expect(result.plByCode).toHaveLength(5);expect(result.plByCode.every(row=>row.amount===0)).toBe(true);});
 it('회사별 입력을 교대해도 다른 회사 결과와 원문은 변하지 않는다',()=>{const original=structuredClone({journalEntries,accountCodes,groups});const first=run();const other=buildProfitAccountProjection({journalEntries:[entry('2026-09-01',[{accountCode:'400',debit:0,credit:12}])],accountCodes:[{id:'other',code:'400',name:'다른회사 매출',type:'수익'}],codeToGroup:()=>undefined,periodMonths:['2026-09']});expect(other.plByCode[0]).toMatchObject({name:'다른회사 매출',amount:12});expect(run()).toEqual(first);expect({journalEntries,accountCodes,groups}).toEqual(original);});
 it('조회 월 범위만 바뀌면 그 월의 금액만 집계한다',()=>{expect(buildProfitAccountProjection({journalEntries,accountCodes,codeToGroup,periodMonths:['2026-08']}).plByCode.find(row=>row.code==='400')?.amount).toBe(5000);});
});
