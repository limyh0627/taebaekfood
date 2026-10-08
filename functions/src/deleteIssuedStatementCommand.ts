import * as admin from 'firebase-admin';
import {createHash} from 'crypto';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {assertReleaseActive,releaseGateRef} from './releaseGate';
type Row=Record<string,any>;
type Link={kind:'orders'|'purchaseOrders'|'settlements';id:string;data:Row};
type Input={operationId:string;statementId:string;releaseId:string;expectedRevision:number;expectedOriginalHash:string};
const fail=(message:string):never=>{throw new HttpsError('failed-precondition',message);};
function canonical(value:any):any {
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value.toMillis==='function')return {timestampMillis:value.toMillis()};
 if(value instanceof Date)return {dateISO:value.toISOString()};
 return value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
}
export const statementDeletionHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const statementOriginalHash=(row:Row)=>statementDeletionHash(Object.fromEntries(Object.entries(row).filter(([key])=>key!=='id')));
export const statementSourceIds=(row:Row,kind:'orders'|'purchaseOrders'):string[]=>{
 const values=kind==='orders'?String(row.orderId??'').split(/[\s,]+/):[...(Array.isArray(row.purchaseOrderIds)?row.purchaseOrderIds:[]),...(Array.isArray(row.confirmedProductIds)?row.confirmedProductIds:[]),row.sourcePoId];
 return [...new Set(values.filter((value):value is string=>typeof value==='string'&&!!value))].sort();
};
/** 기존 삭제 계약: 연결 두 필드·정산·전표만 삭제하고 재고·상태·번호는 건드리지 않는다. */
export function planStatementDeletion(companyId:string,statementId:string,statement:Row,links:Link[],state:Row|null){
 if((statement.companyId??'taebaek')!==companyId)fail('다른 회사의 전표는 삭제할 수 없습니다.');
 for(const row of links)if((row.data.companyId??'taebaek')!==companyId)fail('다른 회사의 연결 문서가 있습니다.');
 const partnerId=statement.partnerId;
 if(partnerId!==undefined&&partnerId!==''&&(typeof partnerId!=='string'||partnerId.includes('/')))fail('전표 거래처 연결이 잘못되었습니다.');
 const revision=state?.revision??0;
 if(state&&(state.companyId!==companyId||state.partnerId!==partnerId))fail('거래처 정산 회사가 일치하지 않습니다.');
 if(!Number.isSafeInteger(revision)||revision<0||!Number.isSafeInteger(revision+1))fail('거래처 정산 상태가 손상되었습니다.');
 const clear=links.filter(row=>row.kind!=='settlements'&&row.data.linkedStatementId===statementId);
 const remove=links.filter(row=>row.kind==='settlements'&&row.data.statementId===statementId);
 if(clear.length+remove.length+(partnerId?3:2)>500)fail('연결 문서가 너무 많아 삭제할 수 없습니다.');
 return {clear,remove,partnerId:partnerId||null,revision,revisionAfter:partnerId?revision+1:null};
}
/** 삭제된 발행 ID는 원 발행 증거에 맞는 감사가 있을 때만 기존 번호를 반환한다. */
export async function readStatementDeletion(db:admin.firestore.Firestore,tx:admin.firestore.Transaction,companyId:string,
 statementId:string,current:admin.firestore.DocumentSnapshot,validatesCreation:(row:Row)=>boolean):Promise<Row|null>{
 const rows=await tx.get(db.collection('voucherMutationOperations').where('statementIds','array-contains',statementId));
 if(!rows.size)return null;
 if(rows.size!==1||current.exists)fail('삭제된 전표의 발행 감사와 현재 원문이 다릅니다.');
 const receipt=rows.docs[0].data(),before=receipt.beforeSnapshot;
 if(receipt.companyId!==companyId||receipt.kind!=='issuedStatements'||receipt.action!=='delete'||receipt.status!=='applied'
  ||receipt.voucherId!==statementId||typeof receipt.createdBy!=='string'||!receipt.createdBy||!before
  ||(before.companyId??'taebaek')!==companyId||receipt.beforeHash!==statementOriginalHash(before)||receipt.afterHash!==null
  ||!validatesCreation(before))fail('원 발행과 전표 삭제 감사가 맞지 않습니다.');
 return before;
}
export async function deleteIssuedStatement(db:admin.firestore.Firestore,companyId:string,actorId:string,input:Input){
 if(!actorId||!input||!/^[A-Za-z0-9_-]{1,150}$/.test(input.operationId)||!/^[A-Za-z0-9_-]{1,160}$/.test(input.statementId)
  ||!/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0
  ||!/^[a-f0-9]{64}$/.test(input.expectedOriginalHash))throw new HttpsError('invalid-argument','전표 삭제 입력이 잘못되었습니다.');
 const requestHash=statementDeletionHash({companyId,actorId,...input});
 const statementRef=db.collection('issuedStatements').doc(input.statementId),operationRef=db.collection('voucherMutationOperations').doc(input.operationId);
 const result=await db.runTransaction(async tx=>{
  const gate=await tx.get(releaseGateRef(db));
  const [prior,statement]=await Promise.all([tx.get(operationRef),tx.get(statementRef)]);
  if(prior.exists&&prior.data()!.status==='rejected'){
   const receipt=prior.data()!;
   if(receipt.companyId!==companyId||receipt.createdBy!==actorId||receipt.kind!=='issuedStatements'||receipt.action!=='delete'
    ||receipt.voucherId!==input.statementId||receipt.requestHash!==requestHash||statementDeletionHash(receipt.command)!==statementDeletionHash(input)
    ||!['invalid-argument','failed-precondition'].includes(receipt.failureCode)||typeof receipt.failureMessage!=='string')fail('기존 삭제 거절 감사와 요청이 다릅니다.');
   return {status:'rejected' as const,failureCode:receipt.failureCode as 'invalid-argument'|'failed-precondition',failureMessage:receipt.failureMessage as string};
  }
  let writesStarted=false;
  try{
  assertReleaseActive(gate,input.releaseId);
  const partnerAtRead=statement.exists?statement.data()!.partnerId:prior.data()?.beforeSnapshot?.partnerId;
  if(partnerAtRead!==undefined&&partnerAtRead!==''&&(typeof partnerAtRead!=='string'||partnerAtRead.includes('/')))fail('전표 거래처 연결이 잘못되었습니다.');
  const stateRef=partnerAtRead?db.collection('appMeta').doc(`partnerPaymentState_${companyId}_${partnerAtRead}`):null;
  const state=stateRef?await tx.get(stateRef):null;
  const groups=['orders','purchaseOrders','settlements'] as const;
  const linked=await Promise.all(groups.map(kind=>tx.get(db.collection(kind).where('companyId','==',companyId).where(kind==='settlements'?'statementId':'linkedStatementId','==',input.statementId))));
  if(prior.exists){const receipt=prior.data()!;
   if(receipt.kind!=='issuedStatements'||receipt.action!=='delete'||receipt.status!=='applied'||receipt.companyId!==companyId
    ||receipt.createdBy!==actorId||receipt.requestHash!==requestHash||receipt.voucherId!==input.statementId
    ||receipt.beforeHash!==input.expectedOriginalHash||!receipt.beforeSnapshot||statementOriginalHash(receipt.beforeSnapshot)!==receipt.beforeHash
    ||receipt.afterHash!==null||statement.exists||linked.some(rows=>!rows.empty))fail('기존 전표 삭제 작업과 요청이 다릅니다.');
   return {status:'duplicate' as const,id:input.statementId};
  }
  if(!statement.exists)fail('대상 전표를 찾을 수 없습니다.');
  const original=statement.data()!;
  if(statementOriginalHash(original)!==input.expectedOriginalHash||(original.mutationRevision??0)!==input.expectedRevision)fail('전표가 변경되었습니다. 다시 확인해 주세요.');
  const partnerId=original.partnerId;
  const refs=groups.map((kind,index)=>{
   const ids=new Set(linked[index].docs.map(doc=>doc.id));if(kind!=='settlements')statementSourceIds(original,kind).forEach(id=>ids.add(id));
   return [...ids].map(id=>{if(id.includes('/'))fail('전표 연결 ID가 잘못되었습니다.');return db.collection(kind).doc(id);});
  });
  const snapshots=await Promise.all(refs.flat().map(ref=>tx.get(ref)));
  const links:Link[]=snapshots.filter(snap=>snap.exists).map(snap=>({kind:snap.ref.parent.id as Link['kind'],id:snap.id,data:snap.data()!}));
  const plan=planStatementDeletion(companyId,input.statementId,original,links,state?.exists?state.data()!:null);
  writesStarted=true;
  for(const row of plan.clear)tx.update(db.collection(row.kind).doc(row.id),{linkedStatementId:admin.firestore.FieldValue.delete(),linkedStatementAt:admin.firestore.FieldValue.delete()});
  for(const row of plan.remove)tx.delete(db.collection('settlements').doc(row.id));
  if(stateRef){if(state?.exists)tx.update(stateRef,{revision:plan.revisionAfter});else tx.create(stateRef,{companyId,partnerId,revision:plan.revisionAfter});}
  tx.delete(statementRef);
  tx.create(operationRef,{companyId,kind:'issuedStatements',action:'delete',status:'applied',voucherId:input.statementId,statementIds:[input.statementId],
   requestHash,command:input,expectedRevision:input.expectedRevision,beforeSnapshot:original,beforeHash:input.expectedOriginalHash,afterHash:null,
   clearedLinks:plan.clear.map(row=>({kind:row.kind,id:row.id,companyId:row.data.companyId??companyId,linkedStatementId:row.data.linkedStatementId,...(row.data.linkedStatementAt!==undefined?{linkedStatementAt:row.data.linkedStatementAt}:{})})),deletedSettlements:plan.remove,partnerId:plan.partnerId,revisionBefore:plan.revision,revisionAfter:plan.revisionAfter,createdBy:actorId,createdAt:new Date().toISOString()});
  return {status:'applied' as const,id:input.statementId};
  }catch(error){
   if(prior.exists||writesStarted||!(error instanceof HttpsError)||!['invalid-argument','failed-precondition'].includes(error.code))throw error;
   tx.create(operationRef,{companyId,kind:'issuedStatements',action:'delete',status:'rejected',voucherId:input.statementId,
    command:input,requestHash,createdBy:actorId,createdAt:new Date().toISOString(),failureCode:error.code,failureMessage:error.message});
   return {status:'rejected' as const,failureCode:error.code as 'invalid-argument'|'failed-precondition',failureMessage:error.message};
  }
 });
 if(result.status==='rejected')throw new HttpsError(result.failureCode,result.failureMessage,{operationStatus:'rejected',operationId:input.operationId,statementId:input.statementId,companyId,requestHash});
 return result;
}
export const deleteIssuedStatementCommand=onCall({region:'asia-northeast3'},async request=>{
 const companyId=request.auth?.token.companyId;
 if(!request.auth)throw new HttpsError('unauthenticated','로그인이 필요합니다.');
 if(request.auth.token.isAdmin!==true||!['taebaek','punghoe'].includes(String(companyId)))throw new HttpsError('permission-denied','관리자 회사 권한이 필요합니다.');
 return deleteIssuedStatement(admin.firestore(),companyId as string,request.auth.uid,request.data as Input);
});
