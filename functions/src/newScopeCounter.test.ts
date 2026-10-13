import {describe,expect,it} from 'vitest';
import {readVoucherCounter,readVoucherScopeRows,type VoucherScopeRows} from './newScopeCounter';
type Row=Record<string,any>;
const day='2026-10-04';
const gate={exists:true,data:()=>({status:'active',releaseId:'release',oldWritersBlocked:true,oldWritersBlockedEvidence:'확인',voucherNotBefore:{taebaek:day,punghoe:day}}),get:(key:string)=>key==='status'?'active':'release'} as any;
function fixture(rows:Record<string,Row>={}){
 const calls:{collection:string;filters:[string,string,unknown][]}[]=[];
 const query=(collection:string,filters:[string,string,unknown][]=[]):any=>({collection,filters,where:(field:string,op:string,value:unknown)=>query(collection,[...filters,[field,op,value]])});
 const db={collection:(name:string)=>query(name)} as any;
 const tx={get:async(ref:any)=>{calls.push(ref);return {docs:Object.entries(rows).filter(([path,row])=>path.startsWith(ref.collection+'/')&&ref.filters.every(([field,op,value]:[string,string,any])=>op==='=='?row[field]===value:typeof row[field]==='string'&&(op==='>='?row[field]>=value:row[field]<value))).map(([path,row])=>({id:path.split('/')[1],data:()=>row}))};}} as any;
 return {db,tx,calls};
}
const missing={exists:false} as any;
describe('신규 번호 범위 후보 조회',()=>{
 it('두 원장의 세 단일필드 조회만 사용하고 중복 ID는 한 번 남긴다',async()=>{
  const f=fixture({'issuedStatements/three':{companyId:'taebaek',docNo:'261004-007',tradeDate:day,date:day},'cashEntries/other-day':{docNo:'261003-001',tradeDate:'2026-10-03'}});
  const rows=await readVoucherScopeRows(f.db,f.tx,'taebaek',day,'');
  expect(rows.statements.map(row=>row.id)).toEqual(['three']);expect(rows.cashEntries).toEqual([]);
  expect(f.calls.map(row=>[row.collection,row.filters])).toEqual(['issuedStatements','cashEntries'].flatMap(name=>[[name,[['docNo','>=','261004-'],['docNo','<','261004.']]],[name,[['tradeDate','==',day]]],[name,[['date','==',day]]]]));
 });
 it.each([
  ['현재 번호', {docNo:'261004-001',tradeDate:'2026-10-03'},true],
  ['옮겨진 업무일의 다른 날짜 정규 번호', {docNo:'261003-009',tradeDate:day},false],
  ['같은 업무일의 다른 접두사 정규 번호', {docNo:'가공261004-009',tradeDate:day},false],
  ['날짜 불명확 현재 번호', {docNo:'261004-099',tradeDate:'bad'},true],
  ['잘못된 현재 번호 suffix', {docNo:'261004-no-number',tradeDate:'old'},true],
  ['동일 업무일 잘못된 번호', {docNo:'잘못된번호',tradeDate:day},true],
  ['번호 없는 tradeDate', {tradeDate:day},true],
  ['번호 없는 cash date', {date:day},true],
  ['범위 밖 과거 기록', {docNo:'261003-001',tradeDate:'2026-10-03'},false],
  ['다른 회사 현재 번호', {companyId:'punghoe',docNo:'261004-001'},false],
 ] as const)('%s의 기존 전체 조회 거절 판정을 그대로 유지한다',async(_name,row,blocked)=>{
  for(const collection of ['issuedStatements','cashEntries']){
   const f=fixture({[collection+'/legacy']:{...row}}),promise=readVoucherCounter(f.db,f.tx,missing,gate,'taebaek',day,'');
   if(blocked)await expect(promise).rejects.toThrow('카운터');else await expect(promise).resolves.toMatchObject({last:0,initializedByRelease:'release'});
  }
 });
 it('가공 접두사 및 회사 없는 태백 번호도 범위 후보에서 빠지지 않는다',async()=>{
  const f=fixture({'cashEntries/legacy':{docNo:'가공261004-009',date:'bad'}});
  await expect(readVoucherCounter(f.db,f.tx,missing,gate,'taebaek',day,'가공')).rejects.toThrow('카운터');
  expect(f.calls[0].filters[0]).toEqual(['docNo','>=','가공261004-']);
 });
 it.each(['companyId','date','prefix'] as const)('미리 읽은 후보의 %s가 다르면 재사용하지 않는다',async field=>{
  const f=fixture(),scope=await readVoucherScopeRows(f.db,f.tx,'taebaek',day,'');
  const wrong={...scope,[field]:field==='companyId'?'punghoe':field==='date'?'2026-10-05':'가공'} as VoucherScopeRows;
  await expect(readVoucherCounter(f.db,f.tx,missing,gate,'taebaek',day,'',wrong)).rejects.toThrow('카운터');expect(f.calls).toHaveLength(6);
 });
 it('정확한 후보는 같은 거래 안에서 재조회하지 않으며 기존 카운터는 후보 조회0이다',async()=>{
  const f=fixture(),scope=await readVoucherScopeRows(f.db,f.tx,'taebaek',day,'');
  await expect(readVoucherCounter(f.db,f.tx,missing,gate,'taebaek',day,'',scope)).resolves.toMatchObject({last:0});expect(f.calls).toHaveLength(6);
  const existing={companyId:'taebaek',last:27};await expect(readVoucherCounter(f.db,f.tx,{exists:true,data:()=>existing} as any,gate,'taebaek',day,'')).resolves.toBe(existing);expect(f.calls).toHaveLength(6);
 });
 it.each([['foreign',day,''],['taebaek','2026-02-30',''],['taebaek',day,'추가']])('불명확 범위 %s/%s/%s는 조회0이다',async(company,date,prefix)=>{
  const f=fixture();await expect(readVoucherScopeRows(f.db,f.tx,company,date,prefix)).rejects.toThrow('카운터');expect(f.calls).toEqual([]);
 });
});
