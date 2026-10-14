import * as admin from 'firebase-admin';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {statementIssueIdentity,statementIssueTextHash,statementIssueRef,assertStatementIssueReceipt,STATEMENT_ISSUE_FENCE_GENERATION} from './statementIssueReceipt';
import {hash,statementBusiness,tradeStatementIssueHashes} from './tradeStatementIssue';
import {readStatementCreation} from './statementCreationReceipt';
import {readStatementDeletion} from './deleteIssuedStatementCommand';
import {fingerprint} from './partnerPaymentCommand';
import {readCashCreationMutation} from './cashMutationReceipt';

type Row=Record<string,any>;
export type InspectTradeStatementInput={companyId:string;requestText?:string;requestHash?:string;inspectionId:string;operationId?:string;statementId?:string;paymentRequestText?:string};
const invalid=():never=>{throw new HttpsError('invalid-argument','보관된 최초 요청 원문·회사·확인 ID를 확인해 주세요.');};
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
const failure=(row:Row)=>['invalid-argument','failed-precondition'].includes(row.failureCode)&&typeof row.failureMessage==='string'&&!!row.failureMessage;

/** 결과 확인은 새 영수증이나 거절 증명을 만들지 않는다. 비활성 전환도 과거 결과 조회를 막지 않는다. */
export async function inspectTradeStatement(db:admin.firestore.Firestore,companyId:string,actorId:string,input:InspectTradeStatementInput){
 if(!input||input.companyId!==companyId||!actorId||!identifier(input.inspectionId))invalid();
 let captured:ReturnType<typeof statementIssueIdentity>|undefined,capturedCommand:Row|undefined;
 if(input.requestText!==undefined){
  if(typeof input.requestText!=='string'||input.requestText.length>700000||statementIssueTextHash(input.requestText)!==input.requestHash)invalid();
  try{capturedCommand=JSON.parse(input.requestText);}catch{return invalid();}
  captured=statementIssueIdentity(companyId,actorId,{...capturedCommand,requestText:input.requestText});
  if(capturedCommand?.statement.companyId!==companyId
   ||(input.statementId!==undefined&&input.statementId!==captured.statementId)
   ||(input.operationId!==undefined&&input.operationId!==captured.operationId))invalid();
 }else if(input.requestHash!==undefined||!identifier(input.statementId)||input.operationId!==`${input.statementId}:ISSUE`)invalid();
 const target=captured??{companyId,operationId:input.operationId!,statementId:input.statementId!};
 let capturedPayment:Row|undefined;
 if(input.paymentRequestText!==undefined){
  if(typeof input.paymentRequestText!=='string'||input.paymentRequestText.length>700000)invalid();
  try{capturedPayment=JSON.parse(input.paymentRequestText);}catch{return invalid();}
  if(!capturedPayment||!identifier(capturedPayment.operationId)
   ||(capturedPayment.note!==undefined&&typeof capturedPayment.note!=='string')
   ||!Array.isArray(capturedPayment.allocations)||capturedPayment.allocations.some((row:Row)=>!row||!identifier(row.statementId)))invalid();
 }
 return db.runTransaction(async tx=>{
  const receipt=await tx.get(statementIssueRef(db,target));
  let identity=captured,command=capturedCommand;
  if(!identity&&receipt.exists){
   const stored=receipt.data()!;
   if(stored.companyId!==companyId||stored.actorId!==actorId)throw new HttpsError('permission-denied','다른 회사 또는 다른 사용자의 최초 요청은 확인할 수 없습니다.');
   if(typeof stored.requestText!=='string')invalid();
   try{command=JSON.parse(stored.requestText);}catch{return invalid();}
   identity=statementIssueIdentity(companyId,actorId,{...command,requestText:stored.requestText});
   if(identity.statementId!==target.statementId||identity.operationId!==target.operationId||command?.statement.companyId!==companyId)invalid();
  }
  const result:Row={companyId,actorId,operationId:target.operationId,statementId:target.statementId,
   requestHash:identity?.requestHash??'',inspectionId:input.inspectionId,status:'unknown',
   reason:'최초 요청의 처리 완료를 아직 확인하지 못했습니다. 원문을 보관하고 같은 요청의 결과를 다시 확인해 주세요.',currentStatement:'unverified'};
  if(!identity||!command)return result;
  if(!captured&&receipt.exists)result.serverRequestText=identity.requestText;
  const current=await tx.get(db.collection('issuedStatements').doc(identity.statementId));
  const cash=await tx.get(db.collection('cashEntries').doc(identity.statementId));
  const payment=capturedPayment;
  if(payment&&payment.partnerId!==command.statement.partnerId)invalid();
  if(receipt.exists){
   assertStatementIssueReceipt(receipt.data(),identity);
   const saved=receipt.data()!;
   if(saved.status==='rejected'&&saved.revision>=1&&failure(saved)
    &&saved.drainGeneration===STATEMENT_ISSUE_FENCE_GENERATION&&identifier(saved.drainReleaseId)
    &&typeof saved.rejectedAt==='string'&&Number.isFinite(Date.parse(saved.rejectedAt))&&Date.parse(saved.rejectedAt)<=Date.now()&&!current.exists&&!cash.exists){
    const related=await Promise.all([
     ['voucherMutationOperations','statementId','=='],['voucherMutationOperations','statementIds','array-contains'],
     ['voucherMutationOperations','cashEntryId','=='],['voucherMutationOperations','cashEntryIds','array-contains'],
     ['settlements','statementId','=='],['settlements','cashEntryId','=='],['orders','linkedStatementId','=='],['purchaseOrders','linkedStatementId','=='],
    ].map(([collection,field,operator])=>tx.get(db.collection(collection).where(field,operator as admin.firestore.WhereFilterOp,identity.statementId))));
    // 이 필드는 기존 서버가 원자적으로 봉쇄한 terminal 영수증에서만 복사한다.
    if(related.every(snapshot=>snapshot.empty)){
     result.status='rejected';result.reason=saved.failureMessage;
     result.rejection={...identity,operationStatus:'rejected',financialWrites:false,
     drainGeneration:saved.drainGeneration,drainReleaseId:saved.drainReleaseId,receiptRevision:saved.revision,
      failureCode:saved.failureCode,failureMessage:saved.failureMessage};
    }
   }else if(saved.status==='applied'&&saved.revision>=1&&typeof saved.docNo==='string'&&saved.docNo&&!cash.exists){
    try{
     const {statementHash,payloadHash}=tradeStatementIssueHashes(companyId,command as Parameters<typeof tradeStatementIssueHashes>[1]);
     const validates=(row:Row)=>row.companyId===companyId
      &&row.issueOperationId===identity.operationId&&['','추가'].includes(row.issuePrefix??'')
      &&row.issuePayloadHash===payloadHash&&row.issueStatementHash===statementHash
      &&hash(statementBusiness(row))===statementHash&&row.docNo===saved.docNo&&row.issueVoucherNo===saved.docNo;
     const deleted=await readStatementDeletion(db,tx,companyId,identity.statementId,current,validates);
     if(deleted){result.status='applied';result.currentStatement='deleted';result.reason='최초 요청은 발행된 뒤 삭제되었습니다. 삭제된 전표를 새로 만들지 않습니다.';}
     else if(current.exists){
      const row=current.data()!;
      await readStatementCreation(db,tx,companyId,identity.statementId,row,validates);
      if(row.companyId!==companyId||row.issueOperationId!==identity.operationId)throw Error('전표 식별 불일치');
      result.status='applied';result.currentStatement=(row.mutationRevision??0)>0?'changed':'present';
      result.statement={...row,id:identity.statementId};
      result.reason=result.currentStatement==='changed'?'최초 요청은 발행된 뒤 수정되었습니다. 현재 전표를 확인해 주세요.':'최초 요청의 전표 발행을 확인했습니다.';
     }
     if(result.status==='applied')result.docNo=saved.docNo;
    }catch(error){if(!(error instanceof HttpsError)&&!(error instanceof Error))throw error;}
   }
  }
  if(payment){
   const request=payment,requestHash=fingerprint({...request,note:request.note?.trim()??''});
   const proof:Row={status:'unknown',operationId:request.operationId,requestHash,reason:'수금·지불 결과를 아직 확인하지 못했습니다. 최초 수금 요청을 보관해 주세요.'};
   const operation=await tx.get(db.collection('partnerPaymentOperations').doc(request.operationId));
   const entry=await tx.get(db.collection('cashEntries').doc(request.operationId));
   const other=await tx.get(db.collection('issuedStatements').doc(request.operationId));
   if(operation.exists){
    const prior=operation.data()!;
    if(prior.companyId!==companyId||prior.createdBy!==actorId||prior.partnerId!==request.partnerId||prior.requestHash!==requestHash)
     throw new HttpsError('failed-precondition','보관된 수금 요청과 처리 영수증의 회사·사용자·원문이 다릅니다.');
    const settlements=await tx.get(db.collection('settlements').where('operationId','==',request.operationId));
    if(prior.status==='rejected'&&failure(prior)&&!entry.exists&&!other.exists&&settlements.empty){proof.status='rejected';proof.reason=prior.failureMessage;}
    else if((prior.status===undefined||prior.status==='applied')&&!other.exists&&typeof prior.docNo==='string'&&prior.docNo&&prior.cashEntryId===request.operationId){
     const validates=(row:Row)=>row.companyId===companyId&&row.partnerId===request.partnerId
      &&row.issueOperationId===request.operationId&&row.issuePayloadHash===requestHash
      &&row.issuePrefix===(prior.issuePrefix??'')&&row.docNo===prior.docNo
      &&fingerprint({companyId:row.companyId,partnerId:row.partnerId,date:row.date,cashAccountId:row.cashAccountId,
       dir:row.dir,amount:row.amount,lines:row.lines,note:row.note})===prior.entryHash;
     try{
      const original=await readCashCreationMutation(db,tx,companyId,request.operationId,entry,validates);
      const unchanged=entry.exists&&(entry.data()!.mutationRevision??0)===0&&validates(entry.data()!);
      const stored:Row[]=prior.settlements??[];
      const settlementMatch=Array.isArray(stored)&&settlements.size===stored.length&&stored.every(row=>{
       const document=settlements.docs.find(doc=>doc.id===`st-${request.operationId}-${row.statementId}`)?.data();
       return document&&document.companyId===companyId&&document.cashEntryId===request.operationId
        &&document.statementId===row.statementId&&document.amount===row.amount;
      });
      if(original||(unchanged&&settlementMatch)){proof.status='applied';proof.cashEntryId=request.operationId;proof.docNo=prior.docNo;proof.reason='최초 수금·지불 요청의 반영을 확인했습니다.';}
     }catch(error){if(!(error instanceof HttpsError))throw error;}
    }
   }
   result.payment=proof;
  }
  return result;
 });
}

export const inspectTradeStatementCommand=onCall({region:'asia-northeast3'},async request=>{
 if(!request.auth)throw new HttpsError('unauthenticated','로그인이 필요합니다.');
 const companyId=request.auth.token.companyId;
 if(request.auth.token.isAdmin!==true||(companyId!=='taebaek'&&companyId!=='punghoe'))
  throw new HttpsError('permission-denied','관리자 회사 권한이 필요합니다.');
 return inspectTradeStatement(admin.firestore(),companyId,request.auth.uid,request.data as InspectTradeStatementInput);
});
