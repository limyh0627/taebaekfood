import type * as admin from 'firebase-admin';
import {createHash} from 'crypto';
import {HttpsError} from 'firebase-functions/v2/https';
import {releaseGateRef} from './releaseGate';

type Row=Record<string,any>;
export const STATEMENT_ISSUE_FENCE_GENERATION='statement-issue-fence-v1-20261013';
export const STATEMENT_ISSUE_FENCE_WRITERS=['issueTradeStatementCommand','issueNumberedVoucher','recordLoanMovementCommand','recordPartnerPaymentCommand'] as const;
const fail=():never=>{throw new HttpsError('failed-precondition','최초 전표 요청 원문과 처리 영수증이 다릅니다.');};
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
export const statementIssueTextHash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function statementIssueIdentity(companyId:string,actorId:string,input:Row){
 const {requestText:provided,...command}=input??{};
 if(!actorId||!['taebaek','punghoe'].includes(companyId)||typeof command.statement?.id!=='string'
  ||!/^[A-Za-z0-9_-]{1,160}$/.test(command.statement.id)||command.operationId!==`${command.statement.id}:ISSUE`)fail();
 const requestText=provided===undefined?JSON.stringify(command):provided;
 if(typeof requestText!=='string'||requestText.length>700000)fail();
 let parsed:Row;try{parsed=JSON.parse(requestText);}catch{return fail();}
 if(JSON.stringify(canonical(parsed))!==JSON.stringify(canonical(command)))fail();
 return {version:2,companyId,actorId,operationId:command.operationId,statementId:command.statement.id,
  requestText,requestHash:statementIssueTextHash(requestText)};
}
export type StatementIssueIdentity=ReturnType<typeof statementIssueIdentity>;
export const statementIssueRef=(db:admin.firestore.Firestore,identity:Pick<StatementIssueIdentity,'companyId'|'operationId'>)=>db.collection('statementIssueOperations')
 .doc(statementIssueTextHash(JSON.stringify([identity.companyId,identity.operationId])));
/** 전표와 자금전표의 ID는 회사별 컬렉션이 아니다. 양사의 먼저 고정된 요청을 모두 읽어 늦은 다른 writer를 막는다. */
export async function readStatementTargetClaims(db:admin.firestore.Firestore,tx:admin.firestore.Transaction,companyId:string,id:string){
 const companies=companyId==='taebaek'?['taebaek','punghoe']:['taebaek',companyId];
 const receipts:admin.firestore.DocumentSnapshot[]=[];
 for(const owner of companies)receipts.push(await tx.get(statementIssueRef(db,{companyId:owner,operationId:`${id}:ISSUE`})));
 return receipts;
}
export function assertStatementTargetUnclaimed(receipts:admin.firestore.DocumentSnapshot[]){
 if(receipts.some(snap=>snap.exists))throw new HttpsError('already-exists','이 작업 ID는 먼저 저장된 일반 전표 요청이 사용 중입니다. 최초 요청을 확인해 주세요.');
}
export function assertStatementIssueReceipt(row:Row|undefined,identity:StatementIssueIdentity){
 if(!row||Object.entries(identity).some(([key,value])=>row[key]!==value)
  ||!['prepared','applied','rejected'].includes(row.status)||!Number.isSafeInteger(row.revision)||row.revision<0)fail();
}
export async function prepareStatementIssue(db:admin.firestore.Firestore,identity:StatementIssueIdentity){
 return db.runTransaction(async tx=>{const ref=statementIssueRef(db,identity),snap=await tx.get(ref);
  if(snap.exists){assertStatementIssueReceipt(snap.data(),identity);return;}
  tx.create(ref,{...identity,status:'prepared',revision:0,createdAt:new Date().toISOString()});
 });
}
/** SDK 봉쇄와 옛 서버 종료는 서로 다른 근거다. 종료 확인 전에는 조회0을 거절 증명으로 쓰지 않는다. */
export function statementIssueDrainReady(gate:Row|undefined){
 const protocol=gate?.statementIssueProtocol;
 const time=(value:unknown):number=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))return NaN;
  const parsed=Date.parse(value);return Number.isFinite(parsed)&&new Date(parsed).toISOString().replace('.000Z','Z')===value.replace('.000Z','Z')?parsed:NaN;
 };
 const confirmed=time(protocol?.oldServerDrainConfirmedAt);
 return gate?.status==='active'&&typeof gate.releaseId==='string'&&!!gate.releaseId&&protocol?.releaseId===gate.releaseId
  &&gate.oldWritersBlocked===true&&typeof gate.oldWritersBlockedEvidence==='string'
  &&!!gate.oldWritersBlockedEvidence.trim()&&protocol?.version===1&&protocol.status==='active'
  &&protocol.generation===STATEMENT_ISSUE_FENCE_GENERATION&&protocol.oldServerDrained===true
  &&Number.isFinite(confirmed)&&confirmed<=Date.now()
  &&STATEMENT_ISSUE_FENCE_WRITERS.every(name=>{
   const evidence=protocol.writerEvidence?.[name],deployed=time(evidence?.deployedAt),drained=time(evidence?.oldRevisionDrainedAt);
   return evidence?.generation===STATEMENT_ISSUE_FENCE_GENERATION&&typeof evidence.evidence==='string'&&!!evidence.evidence.trim()
    &&Number.isFinite(deployed)&&Number.isFinite(drained)&&deployed<=drained&&drained<=confirmed;
  });
}
export async function rejectStatementIssue(db:admin.firestore.Firestore,identity:StatementIssueIdentity,error:unknown){
 // 전용 OEM·반품·급여 writer는 각자 다른 접두사다. 일반 작성창의 실제 ID만 무반영 증명을 발급한다.
 if(!/^stmt-\d{13}$/.test(identity.statementId))return null;
 if(!(error instanceof HttpsError)||!['invalid-argument','failed-precondition'].includes(error.code))return null;
 return db.runTransaction(async tx=>{
  const ref=statementIssueRef(db,identity),id=identity.statementId;
  const gate=await tx.get(releaseGateRef(db)),receipt=await tx.get(ref);
  const [statement,cash,...evidence]=await Promise.all([
   tx.get(db.collection('issuedStatements').doc(id)),tx.get(db.collection('cashEntries').doc(id)),
   ...[['voucherMutationOperations','statementId','=='],['voucherMutationOperations','statementIds','array-contains'],
    ['voucherMutationOperations','cashEntryId','=='],['voucherMutationOperations','cashEntryIds','array-contains'],
    ['settlements','statementId','=='],['settlements','cashEntryId','=='],['orders','linkedStatementId','=='],
    ['purchaseOrders','linkedStatementId','==']].map(([collection,field,operator])=>
     tx.get(db.collection(collection).where(field,operator as admin.firestore.WhereFilterOp,id))),
  ]);
  assertStatementIssueReceipt(receipt.data(),identity);const row=receipt.data()!;
  if(!statementIssueDrainReady(gate.data())||statement.exists||cash.exists||evidence.some(snap=>!snap.empty)||row.status==='applied')return null;
  if(row.status==='prepared')tx.update(ref,{status:'rejected',revision:row.revision+1,
   failureCode:error.code,failureMessage:error.message,rejectedAt:new Date().toISOString(),
   drainGeneration:STATEMENT_ISSUE_FENCE_GENERATION,drainReleaseId:gate.data()!.releaseId});
  else if(!['invalid-argument','failed-precondition'].includes(row.failureCode)||typeof row.failureMessage!=='string'
   ||row.drainGeneration!==STATEMENT_ISSUE_FENCE_GENERATION||row.drainReleaseId!==gate.data()!.releaseId)return null;
  return {...identity,operationStatus:'rejected',financialWrites:false,
   drainGeneration:STATEMENT_ISSUE_FENCE_GENERATION,drainReleaseId:gate.data()!.releaseId,
   receiptRevision:row.status==='prepared'?row.revision+1:row.revision,
   failureCode:row.status==='prepared'?error.code:row.failureCode,failureMessage:row.status==='prepared'?error.message:row.failureMessage};
 });
}
