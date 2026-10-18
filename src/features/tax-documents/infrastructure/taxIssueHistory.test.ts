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
  expect(rows.reduce((sum,row)=>sum+row.totalAmount,0)).toBe(320);
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
 it('원문 없는 legacy 표시와 다른 회사·현재 조회 밖 전표를 구분한다',async()=>{
  const legacy={...statement(),taxIssuedAt:'2025-03-01T00:00:00Z'},data=await evidence('all',[statement('outside')]);
  const rows=await projectTaxIssueHistory('taebaek',[legacy,{...statement('foreign'),companyId:'punghoe'}],data.records,data.operations);
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({kind:'legacy',originalVerified:false});
 });
 it('연결된 operation만 고유 조회하고 일부 실패를 명시하며 정상 기록은 유지한다',async()=>{
  const data=await evidence();
  const failed={...data.records[0],id:'tax-failed_taxable',operationId:'tax-failed'};
  reads.records.mockResolvedValue({docs:[...data.records,failed,{...data.records[0],id:'other',operationId:'outside',statementIds:['outside']}].map(row=>({id:row.id,data:()=>row}))});
  reads.operation.mockResolvedValueOnce({id:data.operation.id,exists:()=>true,data:()=>data.operation}).mockRejectedValueOnce(new Error('조회 실패'));
  const result=await readTaxIssueHistory('taebaek',[statement()]);
  expect(reads.operation).toHaveBeenCalledTimes(2);expect(result.groups).toHaveLength(3);expect(result.error).toContain('1건');
  expect(result.groups.filter(row=>row.originalVerified)).toHaveLength(2);
  expect(result.groups.filter(row=>!row.originalVerified)).toHaveLength(1);
 });
 it('회사·인증 범위가 바뀌면 다음 원문 GET을 시작하지 않는다',async()=>{
  const data=await evidence();let current=true;
  reads.records.mockImplementation(async()=>{current=false;return {docs:data.records.map(row=>({id:row.id,data:()=>row}))};});
  await expect(readTaxIssueHistory('taebaek',[statement()],()=>current)).rejects.toThrow('조회 범위');
  expect(reads.operation).not.toHaveBeenCalled();
 });
});
