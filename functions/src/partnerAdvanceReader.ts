import type * as admin from 'firebase-admin';
import type { CompanyId } from './shared/partnerAdvance';
import { releaseGateRef } from './releaseGate';

type Row = Record<string, any>;
const companyOf = (row: Row) => row.companyId ?? 'taebaek';
/** Internal full-history read set. Never accept this structure from the client.
 * Whole collection reads retain pre-company legacy documents; filter before returning.
 * All reads must finish before the command makes its first write.
 */
export async function readPartnerAdvanceSnapshot(db: admin.firestore.Firestore, tx: admin.firestore.Transaction,
 companyId: CompanyId, partnerId: string) {
 const names=['cashEntries','issuedStatements','settlements','returnApplications','returnOperations','partnerPaymentOperations','partnerAdvanceOperations'] as const;
 const [collections,partner,state,cutover,advanceGate,release]=await Promise.all([
  Promise.all(names.map(name=>tx.get(db.collection(name)))),
  tx.get(db.collection('partners').doc(partnerId)),
  tx.get(db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${partnerId}`)),
  tx.get(db.collection('appMeta').doc(`partnerPaymentCutover_${companyId}`)),
  tx.get(db.collection('appMeta').doc(`partnerAdvanceCutover_${companyId}`)),
  tx.get(releaseGateRef(db)),
 ]);
 const rows={} as Record<typeof names[number],Row[]>;
 names.forEach((name,index)=> {
  rows[name]=collections[index].docs.map(doc=>({...doc.data(),id:doc.id})).filter(row=>companyOf(row)===companyId);
 });
 return {companyId,partnerId,rows,partner,state,cutover,advanceGate,release};
}
export type PartnerAdvanceSnapshot = Awaited<ReturnType<typeof readPartnerAdvanceSnapshot>>;


import { HttpsError } from 'firebase-functions/v2/https';
import { claimFromStatement, cashFromEntry } from './partnerPaymentCommand';
import { openClaimBalances } from './partnerPaymentPlan';
import { projectClaimsAfterReturns } from './returnClaimReader';
import { readCashCreationMutation,cashOriginalHash } from './cashMutationReceipt';
import { projectCashLines } from './shared/cashLineProjection';
import { activeAdvanceApplications, claimsAfterAdvance, isAdvanceStatement, sourceKey,
 type SourceKey, type TargetCode, type VerifiedContext } from './shared/partnerAdvance';
import { assertAdvanceOperation, assertGenericCashOrigin, assertOriginReceipt, genericVoucherBusiness,
 semanticHash, statementBusiness } from './shared/partnerAdvanceReceipt';
function fail(message:string):never {throw new HttpsError('failed-precondition',message);}
const calendarDate=(date:unknown):date is string=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;

export function advanceClaims(snapshot:PartnerAdvanceSnapshot) {
 const {companyId,partnerId,rows}=snapshot;
 const statements=rows.issuedStatements.filter(row=>row.partnerId===partnerId);
 for(const row of statements.filter(row=>row.noncashApplication!==undefined)) {
  try {assertAdvanceOperation(row,rows.partnerAdvanceOperations.find(op=>op.id===row.noncashApplication.operationId)??{});}
  catch(error){fail(error instanceof Error?error.message:'적용 감사가 다릅니다.');}
 }
 const claims=statements.filter(row=>!isAdvanceStatement(row as any)).map(row=>claimFromStatement(row.id,row)).filter((row):row is NonNullable<typeof row>=>row!==null);
 const returned=projectClaimsAfterReturns(claims,rows.returnApplications.filter(row=>row.partnerId===partnerId) as any,statements,rows.returnOperations);
 return claimsAfterAdvance(returned,statements as any,companyId,partnerId);
}

/** Source and target are selected by an authenticated request, not client supplied balances. */
export async function resolveSelectedAdvance(db:admin.firestore.Firestore,tx:admin.firestore.Transaction,
 snapshot:PartnerAdvanceSnapshot,source:SourceKey,statementId:string,internal?:{pendingTargetEdit?:{beforeSnapshot:Row;afterSnapshot:Row;operation:Row}}) {
 const {companyId,partnerId,rows}=snapshot;
 if(source.collection!=='cashEntries'||!['133','254'].includes(source.lineKey)) fail('지원되는 원천 자금전표를 선택해 주세요.');
 const cash=rows.cashEntries.find(row=>row.id===source.id && row.partnerId===partnerId);
 const target=rows.issuedStatements.find(row=>row.id===statementId && row.partnerId===partnerId && !row.noncashApplication);
 if(!cash||!target) fail('선택한 원천과 대상 원문을 확인해 주세요.');
 if(cash.loanId||cash.payrollId||cash.transferOperationId||cash.returnOperationId||cash.balanceAdjustment) fail('전용 업무 자금전표는 이 적용 원천이 아닙니다.');
 const payment=rows.partnerPaymentOperations.find(row=>row.id===cash.issueOperationId);
 const verifies=(row:Row)=>{
  try {
   const original={...row,id:cash.id};
   if(payment) assertOriginReceipt('payment',original,payment,{companyId,partnerId,actorId:row.createdBy,operationId:row.issueOperationId});
   else assertGenericCashOrigin(original,{companyId,partnerId,id:cash.id});
   return true;
  } catch {return false;}
 };
 const current=await tx.get(db.collection('cashEntries').doc(source.id));
 const origin=await readCashCreationMutation(db,tx,companyId,source.id,current,verifies);
 if(!current.exists||!origin&&!verifies(cash)) fail('선택한 원천의 발행 증거를 확인해야 합니다.');
 if((cash.mutationRevision??0)>0&&!origin) fail('선택한 원천의 변경 감사가 없습니다.');
 await verifyAdvanceTarget(db,tx,snapshot,target,internal?.pendingTargetEdit);
 const projection=projectCashLines(cash as any,true);
 const originalAmount=projection.parts.filter(row=>row.accountCode===source.lineKey)
  .reduce((sum,row)=>sum+(source.lineKey==='133' ? (cash.dir==='입금'?-row.amount:row.amount) : (cash.dir==='입금'?row.amount:-row.amount)),0);
 if(!calendarDate(cash.date)||!Number.isSafeInteger(originalAmount)||originalAmount<=0) fail('선택한 원천에 미사용 선급·선수 증가액이 없습니다.');
 // Ambiguous historic reductions hold only the chosen account; clearly other partners are separate.
 for(const row of rows.cashEntries.filter(row=>!row.partnerId||row.partnerId===partnerId)) {
  if(row.balanceAdjustment||(!row.accountCode&&!row.lines?.length)) continue;
  const parts=projectCashLines(row as any,true).parts;
  const net=parts.filter(part=>part.accountCode===source.lineKey).reduce((sum,part)=>sum+(source.lineKey==='133'?(row.dir==='입금'?-part.amount:part.amount):(row.dir==='입금'?part.amount:-part.amount)),0);
  if(!Number.isSafeInteger(net)) fail('선택 계정의 감소액 범위를 확인해야 합니다.');
  if(net<0&&(!calendarDate(row.date)||row.date>=cash.date)) fail('선택 원천 이후의 미귀속 감소 이력을 확인해야 합니다.');
 }
 for(const row of rows.issuedStatements.filter(row=>(!row.partnerId||row.partnerId===partnerId)&&!row.noncashApplication&&row.type==='비용')) {
  const net=(Array.isArray(row.items)?row.items:[]).filter((line:Row)=>line.accountCode===source.lineKey)
   .reduce((sum:number,line:Row)=>sum+(source.lineKey==='133'?(line.side==='차변'?line.total:-line.total):(line.side==='대변'?line.total:-line.total)),0);
  if(!Number.isSafeInteger(net)) fail('선택 계정의 감소액 범위를 확인해야 합니다.');
  if(net<0&&(!calendarDate(row.tradeDate)||row.tradeDate>=cash.date)) fail('선택 원천 이후의 미귀속 감소 이력을 확인해야 합니다.');
 }
 const claims=advanceClaims(snapshot);
 const paymentCash=rows.cashEntries.filter(row=>row.partnerId===partnerId).map(row=>cashFromEntry(row.id,row)).filter((row):row is NonNullable<typeof row>=>row!==null);
 const remaining=new Map([...openClaimBalances({companyId,partnerId,direction:'입금',claims,cashEntries:paymentCash,settlements:rows.settlements as any}),
 ...openClaimBalances({companyId,partnerId,direction:'출금',claims,cashEntries:paymentCash,settlements:rows.settlements as any})]);
 const targetClaim=claims.find(row=>row.id===statementId);
 if(!targetClaim) fail('대상 전표의 채권·채무를 확인해야 합니다.');
 const sourceFingerprint=semanticHash(cash),targetFingerprint=semanticHash(target);
 const active=activeAdvanceApplications(rows.issuedStatements as any,companyId,partnerId);
 const priorSourceUse=new Map<string,number>();
 for(const row of active) {
  const meta=row.noncashApplication;
  if(meta.kind!=='advance-application') continue;
  for(const allocation of meta.allocations) {
   const key=sourceKey(allocation.source),next=(priorSourceUse.get(key)??0)+allocation.amount;
   if(!Number.isSafeInteger(next)) fail('원천 사용액이 범위를 넘습니다.');
   priorSourceUse.set(key,next);
  }
 }
 const purpose=JSON.stringify([sourceKey(source),statementId]);
 const context:VerifiedContext={companyId,partnerId,complete:true,unattributedReduction:false,blockedSourceKeys:[],priorSourceUse,
  sources:[{key:source,companyId,partnerId,code:source.lineKey as '133'|'254',originalAmount,date:cash.date,fingerprint:sourceFingerprint,purpose}],
  targets:[{statementId,companyId,partnerId,accountCode:targetClaim.accountCode as TargetCode,remaining:remaining.get(statementId)??0,date:target.tradeDate,fingerprint:targetFingerprint,purpose}]};
 return {context,purpose,sourceFingerprint,targetFingerprint,cash,target};
}

/** Verifies current target against its original semantic receipt and every edit revision. */
export async function verifyAdvanceTarget(db:admin.firestore.Firestore,tx:admin.firestore.Transaction,snapshot:PartnerAdvanceSnapshot,target:Row,pendingEdit?:{beforeSnapshot:Row;afterSnapshot:Row;operation:Row}) {
 const validOrigin=(row:Row)=> typeof row.createdBy==='string'&&!!row.createdBy&&typeof row.docNo==='string'&&!!row.docNo&&typeof row.issueOperationId==='string'&&!!row.issueOperationId
  &&(row.companyId??'taebaek')===snapshot.companyId&&row.partnerId===snapshot.partnerId
  &&(row.issueStatementHash ? row.issueStatementHash===semanticHash(statementBusiness(row)) : row.issuePayloadHash===semanticHash(genericVoucherBusiness(row)));
 const current=await tx.get(db.collection('issuedStatements').doc(target.id));
 if(!current.exists)fail('선택한 대상 원문이 없습니다.');
 const actual=current.data()!;
 const history=await tx.get(db.collection('voucherMutationOperations').where('statementId','==',target.id));
 const edits=history.docs.map(doc=>doc.data()).filter(row=>row.action==='edit-statement').sort((a,b)=>a.expectedRevision-b.expectedRevision);
 const validateEdit=(operation:Row,before:Row,afterHash:string)=>operation.kind==='issuedStatements'&&operation.status==='applied'&&operation.companyId===snapshot.companyId&&operation.statementId===target.id&&typeof operation.uid==='string'&&!!operation.uid
  &&operation.expectedRevision===(before.mutationRevision??0)&&operation.revision===operation.expectedRevision+1&&operation.beforeHash===cashOriginalHash(before)&&operation.afterHash===afterHash;
 let original=actual;
 if(edits.length){
  original=edits[0].beforeSnapshot;
  if(!original||(original.mutationRevision??0)!==0||!validOrigin(original))fail('대상 전표의 원 발행과 변경 근거를 확인해야 합니다.');
  for(let i=0;i<edits.length;i++){
   const row=edits[i],before=row.beforeSnapshot,next=edits[i+1]?.beforeSnapshot??actual;
   if(!before||row.expectedRevision!==i||!validateEdit(row,before,cashOriginalHash(next)))fail('대상 전표의 변경 감사 사슬이 다릅니다.');
  }
  if(actual.mutationRevision!==edits.length)fail('대상 전표의 최신 수정 근거가 다릅니다.');
 }else if((actual.mutationRevision??0)>0||!validOrigin(actual))fail('선택한 대상 전표의 발행 증거를 확인해야 합니다.');
 if(pendingEdit){
  if(cashOriginalHash(pendingEdit.beforeSnapshot)!==cashOriginalHash(actual)||cashOriginalHash(pendingEdit.afterSnapshot)!==cashOriginalHash(target)
   ||!validateEdit(pendingEdit.operation,actual,cashOriginalHash(target)))fail('진행 중인 전표 수정 원문과 적용 근거가 다릅니다.');
 }else if(cashOriginalHash(target)!==cashOriginalHash(actual))fail('선택한 대상 원문이 변경됐습니다.');
 return original;
}
