import * as admin from 'firebase-admin';
import { HttpsError,onCall } from 'firebase-functions/v2/https';
import { readPartnerAdvanceSnapshot,resolveSelectedAdvance,type PartnerAdvanceSnapshot } from './partnerAdvanceReader';
import { activeAdvanceApplications,PartnerAdvanceValidationError,planAdvanceApplication,planAdvanceCancellation,
 sourceKey,type ApplyPartnerAdvanceInput,type CancelPartnerAdvanceInput,type CompanyId,type AdvanceStatement } from './shared/partnerAdvance';
import { assertAdvanceOperation,semanticHash,statementBusiness } from './shared/partnerAdvanceReceipt';
import { assertReleaseActive,assertVoucherDateAllowed } from './releaseGate';
import { partnerQuarantined } from './partnerCutover';
import { readVoucherCounter,writeVoucherCounter } from './newScopeCounter';
import { formatVoucherNo } from './shared/voucherNumber';
const voucherSequenceKey=(companyId:string,date:string,prefix:string)=>`voucherNo_${companyId}_${date}_${prefix||'general'}`;

type Row=Record<string,any>;
function fail(message:string):never {throw new HttpsError('failed-precondition',message);}
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(value);
const operationId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
const documentId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(value);
const validDate=(date:unknown):date is string=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
export type AdvanceWriteScope={companyId:CompanyId;partnerId:string;counter:admin.firestore.DocumentSnapshot;counterState:admin.firestore.DocumentData;last:number;initialLast:number;revision:number;revisionAfter:number;date:string;releaseId:string};
export type PreparedAdvanceMutation={statement:Row;operation:Row;statementRef:admin.firestore.DocumentReference;operationRef:admin.firestore.DocumentReference};
export function assertAdvanceAccess(snapshot:PartnerAdvanceSnapshot,expectedRevision?:number) {
 const {companyId,partnerId,partner,state,cutover,advanceGate}=snapshot;
 if(!partner.exists||(partner.data()?.companyId??'taebaek')!==companyId||partner.data()?.active===false) fail('선택한 거래처를 확인해 주세요.');
 const gate=advanceGate.data();
 if(!advanceGate.exists||gate?.companyId!==companyId||gate.enabled!==true||gate.auditPassed!==true) fail('선급·선수 적용이 아직 활성화되지 않았습니다.');
 const payment=cutover.data();
 if(!cutover.exists||payment?.companyId!==companyId||payment.enabled!==true||payment.auditPassed!==true||payment.legacyWritersBlocked!==true||partnerQuarantined(payment,partnerId)) fail('보류된 거래처에는 적용할 수 없습니다.');
 const value=state.data();
 const revision=value?.revision??0;
 if(value&&(value.companyId!==companyId||value.partnerId!==partnerId)||!Number.isSafeInteger(revision)||revision<0||!Number.isSafeInteger(revision+1)) fail('거래처 정산 상태를 확인해 주세요.');
 if(expectedRevision!==undefined&&revision!==expectedRevision) throw new HttpsError('aborted','거래처 장부가 변경됐습니다. 다시 확인해 주세요.');
 return revision;
}
export async function readPartnerAdvanceWriteScope(db:admin.firestore.Firestore,tx:admin.firestore.Transaction,snapshot:PartnerAdvanceSnapshot,date:string,releaseId:string,expectedRevision?:number):Promise<AdvanceWriteScope> {
 assertReleaseActive(snapshot.release,releaseId);assertVoucherDateAllowed(snapshot.release,snapshot.companyId,date);
 const revision=assertAdvanceAccess(snapshot,expectedRevision);
 const counter=await tx.get(db.collection('appMeta').doc(voucherSequenceKey(snapshot.companyId,date,'대체')));
 const counterState=await readVoucherCounter(db,tx,counter,snapshot.release,snapshot.companyId,date,'대체');
 if(counterState.companyId!==snapshot.companyId||counterState.tradeDate!==date||counterState.prefix!=='대체'||!Number.isSafeInteger(counterState.last)||counterState.last<0) fail('대체 전표 번호 상태가 다릅니다.');
 return {companyId:snapshot.companyId,partnerId:snapshot.partnerId,counter,counterState,last:counterState.last,initialLast:counterState.last,revision,revisionAfter:revision+1,date,releaseId};
}
async function prepareDocument(db:admin.firestore.Firestore,tx:admin.firestore.Transaction,snapshot:PartnerAdvanceSnapshot,scope:AdvanceWriteScope,actorId:string,action:'apply'|'cancel',command:Row,body:Row,source:Row,targetStatementId:string,amount:number):Promise<PreparedAdvanceMutation> {
 if(scope.companyId!==snapshot.companyId||scope.partnerId!==snapshot.partnerId||command.date!==scope.date||!actorId)fail('적용 준비 회사·거래처·날짜가 다릅니다.');
 const statementRef=db.collection('issuedStatements').doc(`advance-${command.operationId}`),operationRef=db.collection('partnerAdvanceOperations').doc(command.operationId);
 const [statement,other,operation]=await Promise.all([tx.get(statementRef),tx.get(db.collection('cashEntries').doc(statementRef.id)),tx.get(operationRef)]);
 if(statement.exists||other.exists||operation.exists) fail('같은 적용 작업의 원문이 이미 있습니다.');
 if(!Number.isSafeInteger(scope.last+1)) fail('전표 번호가 범위를 넘습니다.');
 const docNo=formatVoucherNo(scope.date,++scope.last,'대체'),createdAt=new Date().toISOString();
 const requestHash=semanticHash({companyId:snapshot.companyId,actorId,action,command});
 const payload={...body,companyId:snapshot.companyId,partnerId:snapshot.partnerId,partnerName:snapshot.partner.data()?.name??'',type:'비용',orderId:'',tradeDate:scope.date,totalSupply:amount,totalTax:0,totalAmount:amount,memo:action==='apply'?'선급·선수 적용':'선급·선수 적용 취소'};
 const statementHash=semanticHash(statementBusiness(payload));
 return {statementRef,operationRef,statement:{...payload,id:statementRef.id,docNo,issuedAt:createdAt,createdBy:actorId,issueOperationId:command.operationId,issuePayloadHash:requestHash,issueStatementHash:statementHash,issuePrefix:'대체'},
 operation:{id:command.operationId,companyId:snapshot.companyId,partnerId:snapshot.partnerId,createdBy:actorId,status:'applied',action,command,commandHash:semanticHash(command),requestHash,statementId:statementRef.id,statementHash,docNo,issuePrefix:'대체',createdAt,source,targetStatementId,amount,...(action==='cancel'?{applicationStatementId:command.applicationStatementId}:{})}};
}
export async function prepareAdvanceApplication(db:admin.firestore.Firestore,tx:admin.firestore.Transaction,snapshot:PartnerAdvanceSnapshot,scope:AdvanceWriteScope,actorId:string,input:ApplyPartnerAdvanceInput,internal?:{pendingTargetEdit?:{beforeSnapshot:Row;afterSnapshot:Row;operation:Row}}) {
 const resolved=await resolveSelectedAdvance(db,tx,snapshot,input.source,input.statementId,internal);
 if(input.expectedSourceFingerprint!==resolved.sourceFingerprint||input.expectedTargetFingerprint!==resolved.targetFingerprint) fail('선택한 원천 또는 대상이 변경됐습니다. 다시 확인해 주세요.');
 const plan=planAdvanceApplication(resolved.context,{operationId:input.operationId,date:input.date,purpose:resolved.purpose,allocations:[{source:input.source,statementId:input.statementId,accountCode:input.accountCode,amount:input.amount}]});
 return prepareDocument(db,tx,snapshot,scope,actorId,'apply',input,{items:plan.items,noncashApplication:plan.metadata},input.source,input.statementId,input.amount);
}
export async function prepareAdvanceCancellation(db:admin.firestore.Firestore,tx:admin.firestore.Transaction,snapshot:PartnerAdvanceSnapshot,applicationStatementId:string,input:{operationId:string;date:string;reason:string;actorId:string},scope:AdvanceWriteScope) {
 const application=snapshot.rows.issuedStatements.find(row=>row.id===applicationStatementId&&row.partnerId===snapshot.partnerId);
 if(!application) fail('취소할 적용 원문이 없습니다.');
 assertAdvanceOperation(application,snapshot.rows.partnerAdvanceOperations.find(row=>row.id===application.noncashApplication?.operationId)??{});
 if(!activeAdvanceApplications(snapshot.rows.issuedStatements as any,snapshot.companyId,snapshot.partnerId).some(row=>row.id===applicationStatementId)) fail('이미 취소됐거나 취소할 적용이 아닙니다.');
 const metadata=application.noncashApplication;
 if(metadata.allocations.length!==1) fail('단건 적용 원문을 확인해 주세요.');
 const allocation=metadata.allocations[0];
 const plan=planAdvanceCancellation(application as AdvanceStatement,input.operationId,input.reason);
 if(input.date<application.tradeDate||scope.date!==input.date) fail('적용일 이전에 취소할 수 없습니다.');
 const command:CancelPartnerAdvanceInput={operationId:input.operationId,date:input.date,partnerId:snapshot.partnerId,applicationStatementId,reason:input.reason,expectedRevision:scope.revision,releaseId:scope.releaseId};
 return prepareDocument(db,tx,snapshot,scope,input.actorId,'cancel',command,{items:plan.items,noncashApplication:plan.metadata},allocation.source,allocation.statementId,allocation.amount);
}
/** Parent command may own the one revision increment. Never opens another transaction. */
export function writePartnerAdvanceMutations(tx:admin.firestore.Transaction,snapshot:PartnerAdvanceSnapshot,scope:AdvanceWriteScope,prepared:PreparedAdvanceMutation[],options:{writePartnerRevision?:boolean}={}) {
 if(!prepared.length)return;
 if(scope.companyId!==snapshot.companyId||scope.partnerId!==snapshot.partnerId)fail('적용 저장 회사·거래처가 다릅니다.');
 if(scope.last-scope.initialLast!==prepared.length||prepared.length*2+2>500) fail('적용 전표 번호 예약이 다릅니다.');
 for(const plan of prepared){tx.create(plan.statementRef,plan.statement);tx.create(plan.operationRef,plan.operation);}
 writeVoucherCounter(tx,scope.counter,scope.counterState,scope.last);
 if(options.writePartnerRevision!==false) {
  if(snapshot.state.exists)tx.update(snapshot.state.ref,{revision:scope.revisionAfter});
  else tx.create(snapshot.state.ref,{companyId:snapshot.companyId,partnerId:snapshot.partnerId,revision:scope.revisionAfter});
 }
}
async function mutate(db:admin.firestore.Firestore,companyId:CompanyId,actorId:string,action:'apply'|'cancel',input:ApplyPartnerAdvanceInput|CancelPartnerAdvanceInput) {
 if(!actorId||!input||!operationId(input.operationId)||!id(input.partnerId)||!id(input.releaseId)||!validDate(input.date)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw new HttpsError('invalid-argument','적용 요청이 잘못되었습니다.');
 if(action==='apply'){const row=input as ApplyPartnerAdvanceInput;if(!row.source||row.source.collection!=='cashEntries'||!documentId(row.source.id)||!['133','254'].includes(row.source.lineKey)||!documentId(row.statementId)||!['108','251','253'].includes(row.accountCode)||!Number.isSafeInteger(row.amount)||row.amount<=0||![row.expectedSourceFingerprint,row.expectedTargetFingerprint].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)))throw new HttpsError('invalid-argument','원천·대상·적용액을 확인해 주세요.');}
 else {const row=input as CancelPartnerAdvanceInput;if(!documentId(row.applicationStatementId)||typeof row.reason!=='string'||!row.reason.trim()||row.reason.length>500)throw new HttpsError('invalid-argument','취소 원문·사유를 확인해 주세요.');}
 const command=JSON.parse(JSON.stringify(input)),requestHash=semanticHash({companyId,actorId,action,command});
 const result=await db.runTransaction(async tx=>{
  const prior=await tx.get(db.collection('partnerAdvanceOperations').doc(input.operationId));
  if(prior.exists){const op=prior.data()!;if(op.requestHash!==requestHash||op.commandHash!==semanticHash(command)||op.companyId!==companyId||op.createdBy!==actorId||op.action!==action)fail('이전 요청과 원문이 다릅니다.');
   if(op.status==='rejected'){if(!['invalid-argument','failed-precondition','aborted'].includes(op.failureCode)||typeof op.failureMessage!=='string')fail('이전 거절 근거가 다릅니다.');return {status:'rejected' as const,failureCode:op.failureCode,failureMessage:op.failureMessage};}
   const statement=await tx.get(db.collection('issuedStatements').doc(op.statementId));if(!statement.exists)fail('이전 요청 원문이 없습니다.');assertAdvanceOperation({...statement.data(),id:statement.id},{...op,id:prior.id});return {status:'duplicate' as const,id:statement.id,docNo:op.docNo};}
  let writesStarted=false;
  try {
  const snapshot=await readPartnerAdvanceSnapshot(db,tx,companyId,input.partnerId);
  const scope=await readPartnerAdvanceWriteScope(db,tx,snapshot,input.date,input.releaseId,input.expectedRevision);
  const prepared=action==='apply'?await prepareAdvanceApplication(db,tx,snapshot,scope,actorId,input as ApplyPartnerAdvanceInput):await prepareAdvanceCancellation(db,tx,snapshot,(input as CancelPartnerAdvanceInput).applicationStatementId,{operationId:input.operationId,date:input.date,reason:(input as CancelPartnerAdvanceInput).reason,actorId},scope);
  writesStarted=true;writePartnerAdvanceMutations(tx,snapshot,scope,[prepared]);
  return {status:'applied' as const,id:prepared.statement.id as string,docNo:prepared.statement.docNo as string};
  } catch(error) {
   if(error instanceof PartnerAdvanceValidationError)error=new HttpsError('failed-precondition',error.message);
   if(!writesStarted&&error instanceof HttpsError&&['invalid-argument','failed-precondition','aborted'].includes(error.code)){
    tx.create(prior.ref,{companyId,partnerId:input.partnerId,createdBy:actorId,status:'rejected',action,command,commandHash:semanticHash(command),requestHash,failureCode:error.code,failureMessage:error.message,createdAt:new Date().toISOString()});
    return {status:'rejected' as const,failureCode:error.code,failureMessage:error.message};
   }
   throw error;
  }
 });
 if(result.status==='rejected')throw new HttpsError(result.failureCode as 'invalid-argument'|'failed-precondition'|'aborted',result.failureMessage,{partnerAdvanceFailure:{version:1,companyId,partnerId:input.partnerId,operationId:input.operationId,operationRejected:true,financialWrites:false,actorId,command,requestHash,commandHash:semanticHash(command)}});
 return result;
}


export const applyPartnerAdvance=(db:admin.firestore.Firestore,companyId:CompanyId,actorId:string,input:ApplyPartnerAdvanceInput)=>mutate(db,companyId,actorId,'apply',input);
export const cancelPartnerAdvance=(db:admin.firestore.Firestore,companyId:CompanyId,actorId:string,input:CancelPartnerAdvanceInput)=>mutate(db,companyId,actorId,'cancel',input);
const companyAuth=(request:{auth?:{uid:string;token:Row}})=>{if(!request.auth)throw new HttpsError('unauthenticated','로그인이 필요합니다.');const companyId=request.auth.token.companyId;if(request.auth.token.isAdmin!==true||!['taebaek','punghoe'].includes(companyId))throw new HttpsError('permission-denied','관리자 회사 권한이 필요합니다.');return {companyId:companyId as CompanyId,actorId:request.auth.uid};};
export const applyPartnerAdvanceCommand=onCall({region:'asia-northeast3'},async request=>{const actor=companyAuth(request);return applyPartnerAdvance(admin.firestore(),actor.companyId,actor.actorId,request.data);});
export const cancelPartnerAdvanceCommand=onCall({region:'asia-northeast3'},async request=>{const actor=companyAuth(request);return cancelPartnerAdvance(admin.firestore(),actor.companyId,actor.actorId,request.data);});

export async function preparePartnerAdvance(db:admin.firestore.Firestore,companyId:CompanyId,partnerId:string):Promise<import('./shared/partnerAdvance').PreparedPartnerAdvance> {
 if(!id(partnerId))throw new HttpsError('invalid-argument','거래처를 선택해 주세요.');
 return db.runTransaction(async tx=>{
  // One initial await establishes the transaction before collection reads.
  await tx.get(db.collection('partners').doc(partnerId));
  const snapshot=await readPartnerAdvanceSnapshot(db,tx,companyId,partnerId);
  const result:import('./shared/partnerAdvance').PreparedPartnerAdvance={enabled:false,revision:snapshot.state.data()?.revision??0,releaseId:snapshot.release.data()?.releaseId??'',sources:[],targets:[],applications:[],diagnostics:[]};
  try{assertAdvanceAccess(snapshot);assertReleaseActive(snapshot.release,result.releaseId);result.enabled=true;}
  catch(error){result.blockedReason=error instanceof Error?error.message:'적용 준비 상태를 확인해 주세요.';return result;}
  const statements=snapshot.rows.issuedStatements.filter(row=>row.partnerId===partnerId&&!row.noncashApplication);
  for(const cash of snapshot.rows.cashEntries.filter(row=>row.partnerId===partnerId)) {
   for(const code of ['133','254'] as const) {
    if(cash.accountCode!==code&&!cash.lines?.some((line:Row)=>line.accountCode===code))continue;
    const key={collection:'cashEntries' as const,id:cash.id,lineKey:code};
    let found=false,lastError='선택 가능한 대상 원전표가 없습니다.';
    for(const target of statements){
     try {
      const resolved=await resolveSelectedAdvance(db,tx,snapshot,key,target.id);
      const source=resolved.context.sources[0],destination=resolved.context.targets[0];
      if(!(code==='254'?destination.accountCode==='108':['251','253'].includes(destination.accountCode)))continue;
      if(!result.sources.some(row=>sourceKey(row.key)===sourceKey(key)))result.sources.push({key,code,originalAmount:source.originalAmount,remaining:source.originalAmount-(resolved.context.priorSourceUse.get(sourceKey(key))??0),date:source.date,docNo:cash.docNo,note:cash.note??'',fingerprint:resolved.sourceFingerprint});
      if(!result.targets.some(row=>row.statementId===target.id))result.targets.push({statementId:target.id,accountCode:destination.accountCode,remaining:destination.remaining,date:destination.date,docNo:target.docNo,fingerprint:resolved.targetFingerprint});
      found=true;
     }catch(error){lastError=error instanceof Error?error.message:'원문 증거를 확인해 주세요.';}
    }
    if(!found)result.diagnostics.push({id:cash.id,reason:lastError});
   }
  }
  for(const application of activeAdvanceApplications(snapshot.rows.issuedStatements as any,companyId,partnerId)){
   const meta=application.noncashApplication;
   if(meta.kind!=='advance-application'||meta.allocations.length!==1)continue;
   const operation=snapshot.rows.partnerAdvanceOperations.find(row=>row.id===meta.operationId)??{};
   assertAdvanceOperation(application as any,operation);
   const allocation=meta.allocations[0];
   const raw=snapshot.rows.issuedStatements.find(row=>row.id===application.id)!;
   result.applications.push({statementId:application.id,amount:allocation.amount,date:application.tradeDate,docNo:raw.docNo,source:allocation.source,targetStatementId:allocation.statementId});
  }
  result.sources.sort((a,b)=>a.date.localeCompare(b.date)||a.docNo.localeCompare(b.docNo)||sourceKey(a.key).localeCompare(sourceKey(b.key)));
  result.targets.sort((a,b)=>a.date.localeCompare(b.date)||a.docNo.localeCompare(b.docNo)||a.statementId.localeCompare(b.statementId));
  return result;
 });
}
export const preparePartnerAdvanceCommand=onCall({region:'asia-northeast3'},async request=>{const actor=companyAuth(request);return preparePartnerAdvance(admin.firestore(),actor.companyId,request.data?.partnerId);});
