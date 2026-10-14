import * as admin from 'firebase-admin';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {releaseGateRef} from './releaseGate';
import {statementIssueRef,statementIssueDrainReady,readStatementIssueEffects,STATEMENT_ISSUE_FENCE_GENERATION} from './statementIssueReceipt';
import {inspectTradeStatement} from './inspectTradeStatementCommand';
type Row=Record<string,any>;
export type CancelTradeStatementInput={companyId:string;statementId:string;operationId:string;inspectionId:string;cancellationId:string};
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
export async function cancelTradeStatement(db:admin.firestore.Firestore,companyId:string,actorId:string,input:CancelTradeStatementInput){
 if(!input||input.companyId!==companyId||!actorId||!['taebaek','punghoe'].includes(companyId)
  ||!/^stmt-\d{13}$/.test(input.statementId)||input.operationId!==`${input.statementId}:ISSUE`
  ||!identifier(input.inspectionId)||!identifier(input.cancellationId))throw new HttpsError('invalid-argument','취소할 전표와 사용자 확인 정보를 다시 확인해 주세요.');
 const result:Row=await db.runTransaction(async tx=>{
  const ref=statementIssueRef(db,input),receipt=await tx.get(ref),gate=await tx.get(releaseGateRef(db));
  const other=await tx.get(statementIssueRef(db,{companyId:companyId==='taebaek'?'punghoe':'taebaek',operationId:input.operationId}));
  if(other.exists)throw new HttpsError('permission-denied','다른 회사가 사용한 전표 요청은 취소할 수 없습니다.');
  const row=receipt.data();
  if(row&&(row.companyId!==companyId||row.actorId!==actorId||row.operationId!==input.operationId||row.statementId!==input.statementId))
   throw new HttpsError('permission-denied','다른 회사 또는 다른 사용자의 전표 요청은 취소할 수 없습니다.');
  const common={companyId,actorId,statementId:input.statementId,operationId:input.operationId,inspectionId:input.inspectionId,
   cancellationId:input.cancellationId,requestHash:row?.requestHash??'',currentStatement:'unverified',...(typeof row?.requestText==='string'?{serverRequestText:row.requestText}:{})};
  if(row?.status==='cancelled'){
   if(row.cancellationId!==input.cancellationId)throw new HttpsError('failed-precondition','다른 취소 요청으로 이미 취소되었습니다. 서버 결과를 다시 확인해 주세요.');
   if(!Number.isSafeInteger(row.revision)||row.revision<1||row.drainGeneration!==STATEMENT_ISSUE_FENCE_GENERATION||!identifier(row.drainReleaseId)
    ||typeof row.cancelledAt!=='string'||!Number.isFinite(Date.parse(row.cancelledAt))||Date.parse(row.cancelledAt)>Date.now())
    throw new HttpsError('failed-precondition','이전 취소 결과의 확인 근거가 완전하지 않습니다.');
   return {...common,status:'cancelled',reason:'이전 요청을 취소했습니다. 사본을 삭제하고 새 전표로 다시 작성할 수 있습니다.',
    cancellation:{cancellationId:row.cancellationId,receiptRevision:row.revision,drainGeneration:row.drainGeneration,drainReleaseId:row.drainReleaseId}};
  }
  const hasEffects=await readStatementIssueEffects(db,tx,input.statementId);
  if(row?.status==='applied'||hasEffects)return {...common,status:'unknown',reason:'전표 또는 관련 처리 기록이 있습니다. 기존 전표를 확인한 뒤 정리해 주세요.',needsInspection:true};
  if(!statementIssueDrainReady(gate.data()))return {...common,status:'unknown',reason:'이전 요청이 뒤늦게 저장되지 않는다는 서버 확인이 아직 준비되지 않았습니다. 사본은 유지되며 무관한 새 전표는 작성할 수 있습니다. 새로 읽기를 누른 뒤 다시 삭제해 주세요. 같은 안내가 계속되면 관리자에게 실패 요청 취소 준비 확인을 요청해 주세요.'};
  if(row&&!['prepared','rejected'].includes(row.status))throw new HttpsError('failed-precondition','기존 요청 상태를 확인하지 못했습니다.');
  if(row&&(!Number.isSafeInteger(row.revision)||row.revision<0))throw new HttpsError('failed-precondition','기존 요청의 처리 이력이 완전하지 않습니다.');
  const revision=(row?.revision??0)+1,proof={cancellationId:input.cancellationId,receiptRevision:revision,
   drainGeneration:STATEMENT_ISSUE_FENCE_GENERATION,drainReleaseId:gate.data()!.releaseId};
  const terminal={companyId,actorId,statementId:input.statementId,operationId:input.operationId,status:'cancelled',revision,
   cancellationId:input.cancellationId,cancelledAt:new Date().toISOString(),drainGeneration:proof.drainGeneration,drainReleaseId:proof.drainReleaseId};
  // 같은 영수증을 읽고 봉인해야 이미 시작한 발행도 경합 재시도에서 취소를 확인한다.
  if(receipt.exists)tx.update(ref,terminal);else tx.create(ref,{version:2,...terminal});
  return {...common,status:'cancelled',reason:'이전 요청을 취소했습니다. 사본을 삭제하고 새 전표로 다시 작성할 수 있습니다.',cancellation:proof};
 });
 if(result.needsInspection){
  const inspected=await inspectTradeStatement(db,companyId,actorId,{companyId,statementId:input.statementId,operationId:input.operationId,inspectionId:input.inspectionId});
  if(inspected.status==='applied')return {...inspected,cancellationId:input.cancellationId};
 }
 delete result.needsInspection;return result;
}
export const cancelTradeStatementCommand=onCall({region:'asia-northeast3'},async request=>{
 if(!request.auth)throw new HttpsError('unauthenticated','로그인이 필요합니다.');
 const companyId=request.auth.token.companyId;
 if(request.auth.token.isAdmin!==true||(companyId!=='taebaek'&&companyId!=='punghoe'))throw new HttpsError('permission-denied','관리자 회사 권한이 필요합니다.');
 return cancelTradeStatement(admin.firestore(),companyId,request.auth.uid,request.data as CancelTradeStatementInput);
});
