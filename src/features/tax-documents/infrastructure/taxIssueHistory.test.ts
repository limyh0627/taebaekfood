import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { planTaxIssue } from '../domain/taxIssue';
import { projectTaxIssueHistory, readTaxIssueHistory } from './taxIssueHistory';
import { taxIssueRequestHash, type TaxIssueCommand } from './applyTaxIssueWrites';
import type { IssuedStatement } from '../../../shared/types';
const reads = vi.hoisted(() => ({ records:vi.fn(), operation:vi.fn() }));
vi.mock('../../../shared/firebase', () => ({ db:{},auth:{},functions:{} }));
vi.mock('firebase/firestore', () => ({collection:vi.fn(),doc:(_db:unknown,c:string,id:string)=>({c,id}),query:vi.fn(),where:vi.fn(),getDocsFromServer:reads.records,getDocFromServer:reads.operation}));
beforeEach(() => {vi.stubGlobal('crypto',webcrypto);reads.records.mockReset();reads.operation.mockReset();});
const statement = (id='s',partnerId='partner'):IssuedStatement => ({
 id,partnerId,partnerName:partnerId,companyId:'taebaek',type:'매출',tradeDate:'2025-02-28',issuedAt:'2025-02-28T00:00:00Z',orderId:'',docNo:id,
 totalSupply:150,totalTax:10,totalAmount:160,
 items:[{name:'과세 원문',spec:'',qty:1,price:100,supply:100,tax:10,total:110,isTaxExempt:false},{name:'면세 원문',spec:'',qty:1,price:50,supply:50,tax:0,total:50,isTaxExempt:true}],
});
async function evidence(scope:TaxIssueCommand['scope']='all',statements=[statement()]) {
 const command:TaxIssueCommand={companyId:'taebaek',operationId:'tax-evidence',scope,statements,issuedAt:'2025-03-01T00:00:00Z'};
 const records:Array<Record<string,unknown>&{id:string}>=planTaxIssue({...command,actorId:'employee'}).writes.filter(row=>row.collection==='taxIssueRecords').map(row=>({...row.data,id:row.id}));
 const operation={id:command.operationId,operationId:command.operationId,companyId:'taebaek',actorId:'employee',status:'applied',createdAt:command.issuedAt,command,requestHash:await taxIssueRequestHash(command)};
 return {records,operation,operations:new Map([[command.operationId,operation]])};
}
describe('발행 기록과 최초 원문의 이력 대조', () => {
 it.each(['taxable','exempt'] as const)('혼합 전표의 %s 단독 발행은 해당 원문·금액만 보여 준다',async kind=>{
  const source=statement(),data=await evidence(kind,[source]);
  const edited={...source,items:source.items.map(line=>({...line,name:'수정된 현재 품목',supply:999,total:999})),totalAmount:1998};
  const rows=await projectTaxIssueHistory('taebaek',[edited],data.records,data.operations);
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({kind,originalVerified:true,totalAmount:kind==='taxable'?110:50});
  expect(rows[0].stmts[0].items.map(line=>line.name)).toEqual([kind==='taxable'?'과세 원문':'면세 원문']);
 });
 it('두 scope와 서로 다른 거래처는 각각 별도 이력으로 남고 원문 전체 합계와 일치한다',async()=>{
  const statements=[statement(),statement('s2','other')],data=await evidence('all',statements);
  const rows=await projectTaxIssueHistory('taebaek',statements,data.records,data.operations);
  expect(rows).toHaveLength(4);expect(new Set(rows.map(row=>row.key)).size).toBe(4);
  expect(rows.every(row=>row.totalAmount!==null)).toBe(true);expect(rows.reduce((sum,row)=>sum+(row.totalAmount ?? 0),0)).toBe(320);
  rows.forEach(row=>expect(new Set(row.stmts.map(s=>s.partnerId)).size).toBe(1));
 });
 it.each(['hash','company','ids','amount','time','kind','missing'] as const)('%s 불일치는 이력을 숨기지 않고 재출력을 제한한다',async mode=>{
  const data=await evidence('taxable');
  if(mode==='hash')data.operation.requestHash='wrong';
  if(mode==='company')data.operation.companyId='punghoe';
  if(mode==='ids')data.records[0].statementIds=['s','unknown'];
  if(mode==='amount')data.records[0].amount=1;
  if(mode==='time')data.records[0].issuedAt='2025-03-02T00:00:00Z';
  if(mode==='kind')data.records[0].kind='exempt';
  if(mode==='missing')data.operations.clear();
  const rows=await projectTaxIssueHistory('taebaek',[statement()],data.records,data.operations);
  expect(rows).toHaveLength(1);expect(rows[0].originalVerified).toBe(false);expect(rows[0].notice).toContain('원본 확인 필요');
 });
 it('현재 조회 밖 원문 기록과 legacy 표시를 함께 보되 다른 회사를 제외한다',async()=>{
  const legacy={...statement(),taxIssuedAt:'2025-03-01T00:00:00Z'},data=await evidence('all',[statement('outside')]);
  const rows=await projectTaxIssueHistory('taebaek',[legacy,{...statement('foreign'),companyId:'punghoe'}],data.records,data.operations);
  expect(rows).toHaveLength(3);expect(rows.filter(row=>row.kind==='legacy')).toHaveLength(1);expect(rows.filter(row=>row.originalVerified)).toHaveLength(2);expect(rows.flatMap(row=>row.stmts).some(row=>row.id==='foreign')).toBe(false);
 });
 it('현재 전표 밖 operation도 고유 조회하고 일부 실패를 명시하며 정상 기록은 유지한다',async()=>{
  const data=await evidence();
  const failed={...data.records[0],id:'tax-failed_taxable',operationId:'tax-failed'};
  reads.records.mockResolvedValue({docs:[...data.records,failed,{...data.records[0],id:'other',operationId:'outside',statementIds:['outside']}].map(row=>({id:row.id,data:()=>row}))});
  reads.operation.mockResolvedValueOnce({id:data.operation.id,exists:()=>true,data:()=>data.operation}).mockRejectedValueOnce(new Error('조회 실패'));
  const result=await readTaxIssueHistory('taebaek',[statement()]);
  expect(reads.operation).toHaveBeenCalledTimes(3);expect(result.groups).toHaveLength(4);expect(result.error).toContain('2건');
  expect(result.groups.filter(row=>row.originalVerified)).toHaveLength(2);
  expect(result.groups.filter(row=>!row.originalVerified)).toHaveLength(2);expect(result.groups.find(row=>row.stmts.length===0)).toMatchObject({totalAmount:null,partnerId:'',originalVerified:false});
 });
 it('회사·인증 범위가 바뀌면 다음 원문 GET을 시작하지 않는다',async()=>{
  const data=await evidence();let current=true;
  reads.records.mockImplementation(async()=>{current=false;return {docs:data.records.map(row=>({id:row.id,data:()=>row}))};});
  await expect(readTaxIssueHistory('taebaek',[statement()],()=>current)).rejects.toThrow('조회 범위');
  expect(reads.operation).not.toHaveBeenCalled();
 });
});

it('현재 전표가 없어도 서버 기록과 검증된 최초 원문을 표시한다',async()=>{
 const data=await evidence('taxable',[statement('old')]);reads.records.mockResolvedValue({docs:data.records.map(row=>({id:row.id,data:()=>row}))});reads.operation.mockResolvedValue({id:data.operation.id,exists:()=>true,data:()=>data.operation});
 const result=await readTaxIssueHistory('taebaek',[]);expect(reads.records).toHaveBeenCalledOnce();expect(result.groups).toHaveLength(1);expect(result.groups[0]).toMatchObject({originalVerified:true,totalAmount:110});expect(result.groups[0].stmts[0].id).toBe('old');
});
it('저장 발행일 범위를 회사 기록에 적용한 뒤 그 원문만 읽고 legacy도 같은 범위로 거른다',async()=>{
 const data=await evidence('taxable');const outside={...data.records[0],id:'outside',operationId:'outside',issuedAt:'2023-01-01T00:00:00Z'};reads.records.mockResolvedValue({docs:[...data.records,outside].map(row=>({id:row.id,data:()=>row}))});reads.operation.mockResolvedValue({id:data.operation.id,exists:()=>true,data:()=>data.operation});const result=await readTaxIssueHistory('taebaek',[{...statement('legacy'),taxIssuedAt:'2023-01-01T00:00:00Z'}],()=>true,{from:'2025-03-01',to:'2025-03-01'});expect(reads.operation).toHaveBeenCalledTimes(1);expect(result.groups).toHaveLength(1);expect(result.groups[0].stmts[0].id).toBe('s');
});
it('원문과 현재 전표가 없고 조회가 실패한 기록은 금액 미확인과 재출력 금지로 남긴다',async()=>{const data=await evidence('taxable');reads.records.mockResolvedValue({docs:data.records.map(row=>({id:row.id,data:()=>row}))});reads.operation.mockRejectedValue(new Error('offline'));const result=await readTaxIssueHistory('taebaek',[]);expect(result.groups).toHaveLength(1);expect(result.groups[0]).toMatchObject({stmts:[],totalAmount:null,originalVerified:false,partnerId:''});expect(result.error).toContain('1건');});

it('발행일을 확인할 수 없는 기록은 전체에서 남기고 선택기간에서 제외 수를 알린다',async()=>{const data=await evidence('taxable');const invalid={...data.records[0],issuedAt:''};reads.records.mockResolvedValue({docs:[invalid].map(row=>({id:row.id,data:()=>row}))});reads.operation.mockResolvedValue({id:data.operation.id,exists:()=>true,data:()=>data.operation});const all=await readTaxIssueHistory('taebaek',[]);expect(all.groups).toHaveLength(1);const dated=await readTaxIssueHistory('taebaek',[],()=>true,{from:'2025-01-01',to:'2025-12-31'});expect(dated.groups).toHaveLength(0);expect(dated.dateUnknownCount).toBe(1);});

it('저장된 UTC 시각을 한국 날짜로 해석하여 발행일 경계에 포함한다',async()=>{const previous=process.env.TZ;process.env.TZ='Asia/Seoul';try{const data=await evidence('taxable');data.records[0].issuedAt='2025-02-28T15:30:00Z';reads.records.mockResolvedValue({docs:data.records.map(row=>({id:row.id,data:()=>row}))});reads.operation.mockResolvedValue({id:data.operation.id,exists:()=>true,data:()=>data.operation});const result=await readTaxIssueHistory('taebaek',[],()=>true,{from:'2025-03-01',to:'2025-03-01'});expect(reads.operation).toHaveBeenCalledOnce();expect(result.groups).toHaveLength(1);}finally{process.env.TZ=previous;}});

it.each([{from:'2026-02-30',to:''},{from:'2026-12-01',to:'2026-01-01'},{from:'',to:'not-date'}])('잘못된 발행일 범위는 서버 조회 전에 안내한다 %#',async range=>{await expect(readTaxIssueHistory('taebaek',[],()=>true,range)).rejects.toThrow('발행일 시작일과 종료일을 올바르게 확인해 주세요.');expect(reads.records).not.toHaveBeenCalled();expect(reads.operation).not.toHaveBeenCalled();});
