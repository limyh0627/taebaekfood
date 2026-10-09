import type * as admin from 'firebase-admin';
import { readClaimsAfterReturns, projectClaimsAfterReturns } from './returnClaimReader';
import type { Claim, ReturnApplication } from './partnerPaymentPlan';
import { claimsAfterAdvance, isAdvanceStatement, type CompanyId } from './shared/partnerAdvance';
import { semanticHash, assertAdvanceOperation } from './shared/partnerAdvanceReceipt';
type Row = Record<string, any>;
const owner = (row: Row) => row.companyId ?? 'taebaek';
function proof(statement: Row, operation: Row | undefined) {
 if(!operation || typeof operation.createdBy!=='string' || !operation.createdBy
  || typeof operation.docNo!=='string' || !operation.docNo)
  throw new Error('선급·선수 적용 감사와 원전표가 다릅니다.');
 assertAdvanceOperation(statement,operation);
}
export function projectClaimsAfterAdvance(claims:Claim[],statements:Row[],operations:Row[]):Claim[] {
 const groups=new Set(claims.map(row=>JSON.stringify([row.companyId,row.partnerId])));
 const scoped=statements.filter(row=>groups.size===0||groups.has(JSON.stringify([owner(row),row.partnerId])));
 const tagged=scoped.filter(row=>row.noncashApplication!==undefined);
 for(const row of tagged) {
  isAdvanceStatement(row as any);
  const operation=operations.find(op=>op.id===row.noncashApplication.operationId);
  proof(row,operation);
  if(row.noncashApplication.kind==='advance-cancellation') {
   const original=tagged.find(original=>original.id===row.noncashApplication.applicationStatementId);
   const allocation=original?.noncashApplication?.allocations?.[0];
   if(!allocation || semanticHash(operation!.source ?? {})!==semanticHash(allocation.source)
    || operation!.targetStatementId!==allocation.statementId || operation!.amount!==allocation.amount)
    throw new Error('취소 감사의 원천·대상이 다릅니다.');
  }
 }
 let result=claims.filter(claim=>!tagged.some(row=>row.id===claim.id));
 const partners=new Map(tagged.map(row=>[JSON.stringify([owner(row),row.partnerId]),[owner(row),row.partnerId]]));
 for(const [companyId,partnerId] of partners.values()) {
  if(!['taebaek','punghoe'].includes(companyId)) throw new Error('적용 회사가 다릅니다.');
  result=claimsAfterAdvance(result,scoped as any,companyId as CompanyId,partnerId);
 }
 return result;
}
export function projectClaimsAfterReturnsAndAdvance(claims:Claim[],applications:(ReturnApplication&Row)[],statements:Row[],returnOperations:Row[],advanceOperations:Row[]) {
 const ordinary=claims.filter(claim=>!statements.some(row=>row.id===claim.id&&row.noncashApplication!==undefined));
 return projectClaimsAfterAdvance(projectClaimsAfterReturns(ordinary,applications,statements,returnOperations),statements,advanceOperations);
}
/** 모든 감사 조회를 첫 쓰기 전에 끝낸다. 원문 전표는 변경하지 않는다. */
export async function readClaimsAfterReturnsAndAdvance(db:admin.firestore.Firestore,tx:admin.firestore.Transaction,
 claims:Claim[],applications:(ReturnApplication&Row)[],statements:Row[]):Promise<Claim[]> {
 const tagged=statements.filter(row=>row.noncashApplication!==undefined);
 const operations=await Promise.all(tagged.map(async row=>{const snap=await tx.get(db.collection('partnerAdvanceOperations').doc(row.noncashApplication?.operationId));return {...snap.data(),id:snap.id};}));
 const ordinary=claims.filter(claim=>!tagged.some(row=>row.id===claim.id));
 const returned=await readClaimsAfterReturns(db,tx,ordinary,applications,statements);
 return projectClaimsAfterAdvance(returned,statements,operations);
}
