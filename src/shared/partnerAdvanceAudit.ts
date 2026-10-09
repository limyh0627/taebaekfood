import { assertAdvanceOperationProof, advanceStatementBusiness } from '../../functions/src/shared/partnerAdvanceAudit';
import { activeAdvanceApplications, isAdvanceStatement } from './partnerAdvance';
import { companyOf, type CompanyId, type IssuedStatement } from './types';
export type ReadonlyAdvanceOperation = Record<string, any> & {id:string;companyId:CompanyId};
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value))))),byte=>byte.toString(16).padStart(2,'0')).join('');
/** 관리자 회사 구독에서 받은 감사와 원문을 같은 서버 순수 검증으로 대조한다. */
export async function verifyAdvanceStatements(companyId:CompanyId,statements:IssuedStatement[],operations:readonly ReadonlyAdvanceOperation[]):Promise<IssuedStatement[]> {
 const tagged=statements.filter(row=>companyOf(row)===companyId&&isAdvanceStatement(row));
 for(const statement of tagged){
  const operation=operations.find(row=>row.id===statement.noncashApplication?.operationId&&row.companyId===companyId);
  if(!operation)throw new Error('선급·선수 적용 원문을 확인하고 있습니다.');
  const [commandHash,requestHash,statementHash]=await Promise.all([hash(operation.command),hash({companyId:operation.companyId,actorId:operation.createdBy,action:operation.action,command:operation.command}),hash(advanceStatementBusiness(statement))]);
  assertAdvanceOperationProof(statement,operation,{commandHash,requestHash,statementHash});
 }
 for(const partnerId of new Set(tagged.map(row=>row.partnerId)))activeAdvanceApplications(tagged,companyId,partnerId);
 return tagged;
}
