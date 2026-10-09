import * as admin from 'firebase-admin';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {cashOriginalHash} from './cashMutationReceipt';
import {planReturnReversal,planStandaloneReturn,type ReturnRow,type Source} from './returnReversalPlan';
import {ReturnValidationError} from './returnValidationError';
type Row=Record<string,any>;
export type ReturnSubmissionInput={companyId:'taebaek'|'punghoe';requestId:string;request:Row};
export type ReturnSubmissionResult={status:'created'|'duplicate';requestId:string;actorId:string;requestHash:string};
const fail=(message:string):never=>{throw new HttpsError('failed-precondition',message);};
const id=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(value);
/** 접수만 저장한다. 재고·번호·상계는 기존 처리 명령의 책임이다. */
export async function submitReturnRequest(db:admin.firestore.Firestore,companyId:string,actorId:string,input:ReturnSubmissionInput):Promise<ReturnSubmissionResult>{
 if(!actorId||!input||input.companyId!==companyId||!['taebaek','punghoe'].includes(companyId)||!id(input.requestId)||!input.request||Array.isArray(input.request))fail('반품 접수 회사·원문을 확인해주세요.');
 const body=input.request;
 const requestHash=cashOriginalHash(body),ref=db.collection('returnRequests').doc(input.requestId),audit=db.collection('returnSubmissionOperations').doc(input.requestId);
 const outcome=await db.runTransaction(async tx=>{
  const receiptSnap=await tx.get(audit),prior=await tx.get(ref);
  if(receiptSnap.exists){const receipt=receiptSnap.data()!;if(receipt.companyId!==companyId||receipt.requestId!==input.requestId||receipt.actorId!==actorId||receipt.requestHash!==requestHash||!receipt.request||cashOriginalHash(receipt.request)!==requestHash||!['accepted','rejected'].includes(receipt.status))fail('기존 반품 접수와 원문이 다릅니다.');
   if(receipt.status==='rejected'){if(prior.exists||!['failed-precondition','invalid-argument'].includes(receipt.failureCode)||typeof receipt.failureMessage!=='string'||!receipt.failureMessage)fail('기존 반품 거절 원문을 확인해주세요.');return {status:'rejected' as const,failureCode:receipt.failureCode as 'failed-precondition'|'invalid-argument',failureMessage:receipt.failureMessage};}
   const stored=prior.data()?.submissionReceipt;if(!prior.exists||prior.data()?.companyId!==companyId||stored?.version!==1||stored.requestId!==input.requestId||stored.actorId!==actorId||stored.requestHash!==requestHash||!stored.request||cashOriginalHash(stored.request)!==requestHash)fail('기존 반품 접수 원문이 변경되었습니다.');
   return {status:'duplicate' as const,requestId:input.requestId,actorId,requestHash};
  }
  if(prior.exists)fail('기존 반품 접수와 원문이 다릅니다.');
  let writesStarted=false;
  try{
 const allowed=new Set(['companyId','partnerId','partnerName','returnType','linkedStatementId','status','totalAmount','items','createdAt','createdBy','note','payableAccountCode']);
 if(Object.keys(body).some(key=>!allowed.has(key))||body.companyId!==companyId||body.status!=='pending'||!id(body.partnerId)||!['매출','매입'].includes(body.returnType)||typeof body.partnerName!=='string'||!body.partnerName.trim()||typeof body.createdAt!=='string'||!Number.isFinite(Date.parse(body.createdAt))||(body.note!==undefined&&typeof body.note!=='string')||(body.createdBy!==undefined&&typeof body.createdBy!=='string')||(body.linkedStatementId!==undefined&&!id(body.linkedStatementId)))fail('반품 접수 원문 형식을 확인해주세요.');
  const partner=await tx.get(db.collection('partners').doc(body.partnerId));
  if(!partner.exists||(partner.data()?.companyId??'taebaek')!==companyId)fail('반품 거래처의 회사를 확인해주세요.');
  if(!Array.isArray(body.items)||!body.items.length||body.items.some((item:Row)=>!item||Array.isArray(item)||(item.name!==undefined&&typeof item.name!=='string')||(item.reason!==undefined&&typeof item.reason!=='string')))fail('반품 품목을 입력해주세요.');
  const items=await Promise.all(body.items.map((item:Row)=>{if(!id(item.itemId))fail('반품 품목을 확인해주세요.');return tx.get(db.collection('items').doc(item.itemId));}));
  if(items.some(item=>!item.exists||(item.data()?.companyId??'taebaek')!==companyId))fail('반품 품목의 회사를 확인해주세요.');
  let plan:ReturnType<typeof planStandaloneReturn>;
  try{if(body.linkedStatementId){const source=await tx.get(db.collection('issuedStatements').doc(body.linkedStatementId));if(!source.exists)fail('선택한 원전표가 없어졌습니다. 다시 확인해주세요.');plan=planReturnReversal(companyId,{...body,id:input.requestId} as ReturnRow,{...source.data(),id:source.id} as Source,[]);}else{if(body.items.some((item:Row)=>['108','251','253','135','255'].includes(item.accountCode)))fail('반품 발생 계정과 채권·채무·세금 계정을 구분해주세요.');plan=planStandaloneReturn(body as Parameters<typeof planStandaloneReturn>[0]);}}
  catch(error){if(error instanceof ReturnValidationError)throw new HttpsError('failed-precondition',error.message);throw error;}
  const codes=await tx.get(db.collection('accountCodes').where('companyId','==',companyId));const activeCodes=new Set(codes.docs.map(code=>code.data().code));if(plan.journalLines.some(line=>!activeCodes.has(line.accountCode)))fail('반품 분개 계정을 확인해주세요.');
  writesStarted=true;
  tx.create(ref,{...body,submissionReceipt:{version:1,requestId:input.requestId,actorId,requestHash,request:body}});
  tx.create(audit,{companyId,requestId:input.requestId,actorId,requestHash,request:body,status:'accepted',createdAt:new Date().toISOString()});
  return {status:'created' as const,requestId:input.requestId,actorId,requestHash};
  }catch(error){if(writesStarted||!(error instanceof HttpsError)||!['failed-precondition','invalid-argument'].includes(error.code))throw error;
   tx.create(audit,{companyId,requestId:input.requestId,actorId,requestHash,request:body,status:'rejected',failureCode:error.code,failureMessage:error.message,createdAt:new Date().toISOString()});
   return {status:'rejected' as const,failureCode:error.code as 'failed-precondition'|'invalid-argument',failureMessage:error.message};}
 });
 if(outcome.status==='rejected')throw new HttpsError(outcome.failureCode,outcome.failureMessage,{version:1,operationStatus:'rejected',submissionRejected:true,terminalConfirmed:true,receiptStatus:'rejected',submissionWrites:false,financialWrites:false,companyId,requestId:input.requestId,actorId,requestHash});
 return outcome;
}
export const submitReturnRequestCommand=onCall({region:'asia-northeast3'},async request=>{const companyId=request.auth?.token.companyId;if(!request.auth||typeof request.auth.token.employeeId!=='string'||!['taebaek','punghoe'].includes(String(companyId)))throw new HttpsError('permission-denied','현재 회사 직원만 반품을 접수할 수 있습니다.');return submitReturnRequest(admin.firestore(),String(companyId),request.auth.uid,request.data as ReturnSubmissionInput);});
