import { expect, it } from 'vitest';
import { computeCashFlowDirect, cfSectionOf } from './cashFlowDirect';
import type { AccountCode, AccountGroup, JournalEntry } from '../../../shared/types';
const accounts=[{id:'cash',code:'cash',name:'알수없는명칭',isCash:true},{id:'named',code:'named',name:'보통예금'},{id:'ar',code:'108',name:'매출채권'},{id:'machine',code:'machine',name:'기계'}] as AccountCode[];
const journal=(lines:any[],date='2026-10-01'):JournalEntry=>({id:date,date,sourceType:'자금',createdAt:'',lines});
const run=(entries:JournalEntry[],group:(code?:string)=>AccountGroup|undefined=()=>undefined)=>computeCashFlowDirect('2026-10',entries,accounts,group);
it('현금은 이름이 아닌 isCash로 고르고 절대증감 .005 미만만 생략한다',()=>{
 expect(run([journal([{accountCode:'named',debit:10},{accountCode:'sale',credit:10}])]).net).toBe(0);expect(run([journal([{accountCode:'cash',debit:.004},{accountCode:'sale',credit:.004}])]).lines).toEqual([]);expect(run([journal([{accountCode:'cash',debit:.005},{accountCode:'sale',credit:.005}])]).opIn).toBe(.005);
});
it('영업코드는 그룹 투자 설정보다 우선하고 나머지는 지정그룹·기본영업을 따른다',()=>{
 const entries=[journal([{accountCode:'cash',credit:30},{accountCode:'108',debit:10},{accountCode:'machine',debit:15},{accountCode:'unknown',debit:5}])],before=structuredClone(entries);const result=run(entries,c=>c==='108'||c==='machine'?{id:'asset',name:'자산',type:'자산'}:undefined);expect(result).toMatchObject({opOut:15,invOut:15,finOut:0,net:-30});expect(entries).toEqual(before);
});
it('동액 계정은 처음 삽입된 순서를 유지하고 반대 차대는 유입으로 집계한다',()=>{
 const result=run([journal([{accountCode:'cash',debit:20},{accountCode:'second',credit:10},{accountCode:'first',credit:10}]),journal([{accountCode:'cash',debit:999},{accountCode:'excluded',credit:999}],'2026-09-30')]);expect(result.lines.map(l=>l.accountCode)).toEqual(['second','first']);expect(result.opIn).toBe(20);expect(result.net).toBe(20);
});
it('그룹 현금흐름 명시값과 자산·부채·자본·나머지 fallback을 보존한다',()=>{
 expect(cfSectionOf()).toBeUndefined();expect(cfSectionOf({id:'a',name:'a',type:'자산',cfSection:'operating'})).toBe('operating');expect(cfSectionOf({id:'a',name:'a',type:'자산'})).toBe('investing');expect(cfSectionOf({id:'l',name:'l',type:'부채'})).toBe('financing');expect(cfSectionOf({id:'e',name:'e',type:'자본'})).toBe('financing');expect(cfSectionOf({id:'x',name:'x',type:'비용'})).toBe('operating');
});
