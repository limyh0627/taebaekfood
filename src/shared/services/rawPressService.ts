import { doc, getDocFromServer, runTransaction, type Firestore } from 'firebase/firestore';
import { COL } from '../collections';
import { commandHash, operationDocId, type RawInventoryJob, type RawInventoryCommand } from '../rawInventoryCore';
import { normalizeRawMovement, prepareRawCommand, readRawCommandInTransaction, writePreparedRawCommand } from './rawInventoryService';
import { clearRawPressAttempt, rawPressText, saveRawPressAttempt, validateRawPressRequest, type RawPressRequest } from '../rawPressAttempt';
import { auth, authReady, db } from '../firebase';
import { withClaimCompany } from '../companyWriteBoundary';
import { companyOf } from '../types';
import { clearRawPressCancellationAttempt, makeRawPressCancellationRequest, readRawPressCancellationAttempt, saveRawPressCancellationAttempt, validateRawPressCancellationRequest, type RawPressCancellationRequest } from '../rawPressAttempt';

export type RawPressOutcome = { status: 'applied' | 'duplicate'; sourceAppliedKg: number; derivedAppliedKg: number }
  | { status:'cancelled';reason:string }
  | { status: 'blocked'; sourceAppliedKg: 0; reason: string; retainPending: boolean };
type RawPressJob = RawInventoryJob & { actorUid: string; rawPressEvidence: RawPressRequest;
  sourceAppliedKg: number; derivedAppliedKg: number; derivedDisposition: 'received' | 'source-unapplied' | 'yield-zero';
  cancellation?:{request:RawPressCancellationRequest;companyId:string;actorUid:string;completedAt:string;sourceAppliedKg:number;derivedAppliedKg:number} };
const prune = <T>(v: T): T => JSON.parse(JSON.stringify(v));
type Read = Awaited<ReturnType<typeof readRawCommandInTransaction>>;
const exists=(read:Read)=>read.movementSnap.exists()||!!read.oldMovementSnap?.exists();
const dual=(read:Read)=>read.movementSnap.exists()&&!!read.oldMovementSnap?.exists();
const movement=(read:Read)=>normalizeRawMovement((read.movementSnap.exists()?read.movementSnap:read.oldMovementSnap)!.data()!);
function receiptMatches(read:Read,command:RawInventoryCommand,applied:number,reported?:number):boolean {
  if(!exists(read)||dual(read))return false;
  const receipt=movement(read);
  const expected=reported??('kg' in command?Math.round(command.kg*1000)/1000*(command.kind==='consume-lot'?-1:1):NaN);
  return receipt.companyId===command.companyId&&receipt.rawItemId===command.rawItemId&&receipt.operationId===command.operationId
    &&receipt.kind===command.kind&&receipt.effectiveAt===command.effectiveAt&&receipt.source?.type===command.source.type&&receipt.source.id===command.source.id
    &&receipt.commandHash===commandHash(command)&&receipt.reportedDeltaKg===expected&&Number.isFinite(applied)&&Number.isFinite(receipt.appliedDeltaKg)
    &&receipt.appliedDeltaKg===applied&&(applied===0||applied===expected)
    &&(command.kind!=='reverse'||receipt.reversalOf===command.originalOperationId);
}
function pairProblem(job:RawPressJob,request:RawPressRequest,sourceRead:Read,derivedRead:Read):string|null {
  try{validateRawPressRequest(request);}catch{return '압착 최초 원문을 확인해 주세요.';}
  const source=request.sourceCommand,derived=request.derivedCommand;
  if([sourceRead,derivedRead].some(read=>!read.itemSnap.exists()||companyOf(read.itemSnap.data())!==request.companyId))return '압착 양 품목의 회사를 확인해 주세요.';
  if([[sourceRead,source],[derivedRead,derived]].some(([read,command])=>{const snapshot=(read as Read).stateSnap;const state=snapshot.data();return snapshot.exists()&&(state?.companyId!==request.companyId||state.rawItemId!==(command as RawInventoryCommand).rawItemId);}))return '압착 원료 상태의 회사와 품목을 확인해 주세요.';
  if(job.companyId!==request.companyId||job.actorUid!==request.actorUid||job.status!=='complete'||job.id!==`raw-press-${operationDocId(source.operationId)}`
    ||job.source?.type!=='production'||job.source.id!==request.entry.id||job.createdAt!==request.entry.createdAt||job.completedAt!==request.entry.createdAt
    ||rawPressText(job.rawPressEvidence)!==rawPressText(request)
    ||rawPressText(job.expectedOperationIds)!==rawPressText(job.derivedDisposition==='received'?[source.operationId,derived.operationId]:[source.operationId]))return '압착 완료 근거가 최초 원문과 일치하지 않습니다.';
  if(!receiptMatches(sourceRead,source,job.sourceAppliedKg))return '원료 사용 완료 근거를 확인해 주세요.';
  const disposition=job.sourceAppliedKg===0?'source-unapplied':derived.kg===0?'yield-zero':'received';
  if(job.derivedDisposition!==disposition)return '원료 적용량과 파생 입고 근거가 일치하지 않습니다.';
  if(disposition==='received')return receiptMatches(derivedRead,derived,job.derivedAppliedKg)?null:'파생 입고 완료 근거를 확인해 주세요.';
  return exists(derivedRead)||job.derivedAppliedKg!==0?'압착 미적용 근거를 확인해 주세요.':null;
}
const originalRead=(read:Read):Read=>({...read,movementSnap:read.originalSnap!,oldMovementSnap:read.oldOriginalSnap});
function cancellationMatches(job:RawPressJob,sourceRead:Read,derivedRead:Read):boolean {
  const saved=job.cancellation;if(!saved)return false;
  try{validateRawPressCancellationRequest(saved.request);}catch{return false;}
  const request=saved.request;
  if(saved.companyId!==job.companyId||saved.actorUid!==request.actorUid||saved.completedAt!==request.createdAt
    ||rawPressText(request.original)!==rawPressText(job.rawPressEvidence)||request.companyId!==job.companyId
    ||!receiptMatches(sourceRead,request.sourceReverse,saved.sourceAppliedKg,Math.round(request.original.sourceCommand.kg*1000)/1000)
    ||saved.sourceAppliedKg!==-job.sourceAppliedKg)return false;
  const guardMatches=(read:Read,command:typeof request.sourceReverse)=>{const guard=read.guardSnap?.data();return !!read.guardSnap?.exists()&&guard?.id===operationDocId(command.originalOperationId)&&guard.createdAt===request.createdAt&&guard.companyId===job.companyId&&guard.rawItemId===command.rawItemId&&guard.originalOperationId===command.originalOperationId&&guard.reverseOperationId===command.operationId;};
  if(!guardMatches(sourceRead,request.sourceReverse))return false;
  if(job.derivedDisposition==='received')return receiptMatches(derivedRead,request.derivedReverse,saved.derivedAppliedKg,-Math.round(request.original.derivedCommand.kg*1000)/1000)
    &&saved.derivedAppliedKg===-job.derivedAppliedKg&&guardMatches(derivedRead,request.derivedReverse);
  return saved.derivedAppliedKg===0&&!exists(derivedRead)&&!derivedRead.guardSnap?.exists();
}
/** 둘의 이력과 완료 근거를 함께 저장한다. 기존 순차 job을 복구 완료로 추정하지 않는다. */
export async function executeRawPressWithDb(database: Firestore, request: RawPressRequest, assertScope?: () => Promise<void>): Promise<RawPressOutcome> {
  validateRawPressRequest(request);
  const source = request.sourceCommand, derived = request.derivedCommand;
  const jobRef = doc(database, COL.rawInventoryJobs, `raw-press-${operationDocId(source.operationId)}`);
  return runTransaction(database, async tx => {
    await assertScope?.();
    const [jobSnap, sourceRead, derivedRead] = await Promise.all([
      tx.get(jobRef), readRawCommandInTransaction(tx, database, source), readRawCommandInTransaction(tx, database, derived),
    ]);
    const blocked = (reason: string, retainPending = true): RawPressOutcome => ({ status: 'blocked', sourceAppliedKg: 0, reason, retainPending });
    if (jobSnap.exists()) {
      const job = jobSnap.data() as RawPressJob;
      const problem=pairProblem(job,request,sourceRead,derivedRead);
      if(problem)return blocked(problem);
      if(job.cancellation!==undefined){
        try{validateRawPressCancellationRequest(job.cancellation.request);}catch{return blocked('압착 취소 완료 근거를 확인해 주세요.');}
        const [cancelSource,cancelDerived]=await Promise.all([readRawCommandInTransaction(tx,database,job.cancellation.request.sourceReverse),readRawCommandInTransaction(tx,database,job.cancellation.request.derivedReverse)]);
        if(!cancellationMatches(job,cancelSource,cancelDerived))return blocked('압착 취소 영수증을 확인해 주세요.');
        return {status:'cancelled',reason:'이미 취소된 압착입니다. 새 압착은 새 입력으로 등록해 주세요.'};
      }
      return { status: 'duplicate', sourceAppliedKg: job.sourceAppliedKg, derivedAppliedKg: job.derivedAppliedKg };
    }
    if (exists(sourceRead) || exists(derivedRead)) return blocked('기존 부분 처리 이력이 있습니다. 자동으로 압착을 보완하지 않았습니다.');
    const sr = prepareRawCommand(source, sourceRead, { now: request.entry.createdAt });
    if (sr.status !== 'applied') return blocked(sr.status === 'rejected' ? sr.message : '원료 사용 요청을 확인해 주세요.', false);
    if (!derivedRead.itemSnap.exists() || companyOf(derivedRead.itemSnap.data()) !== request.companyId) return blocked('파생 입고 품목 회사를 확인해 주세요.', false);
    const disposition = sr.movement.appliedDeltaKg === 0 ? 'source-unapplied' : derived.kg === 0 ? 'yield-zero' : 'received';
    const dr = disposition === 'received' ? prepareRawCommand(derived, derivedRead, { now: request.entry.createdAt, newLotId: `lot-yield-${request.entry.id}` }) : null;
    if (dr && dr.status !== 'applied') return blocked(dr.status === 'rejected' ? dr.message : '파생 입고 요청을 확인해 주세요.', false);
    const sourceAppliedKg = sr.movement.appliedDeltaKg, derivedAppliedKg = dr?.status === 'applied' ? dr.movement.appliedDeltaKg : 0;
    await assertScope?.();
    writePreparedRawCommand(tx, source, sourceRead, sr, { legacy: request.sourceLegacy });
    if (dr?.status === 'applied') writePreparedRawCommand(tx, derived, derivedRead, dr, { legacy: request.derivedLegacy });
    const job: RawPressJob = { id: jobRef.id, companyId: request.companyId, actorUid: request.actorUid,
      // job은 압착 생산 업무이고, 두 수불의 source는 사용자 수동 기록 원문 그대로다.
      source: { type: 'production', id: request.entry.id }, expectedOperationIds: disposition === 'received' ? [source.operationId, derived.operationId] : [source.operationId],
      status: 'complete', createdAt: request.entry.createdAt, completedAt: request.entry.createdAt,
      rawPressEvidence: request, sourceAppliedKg, derivedAppliedKg, derivedDisposition: disposition };
    tx.set(jobRef, prune(job));
    return { status: 'applied', sourceAppliedKg, derivedAppliedKg };
  });
}
export async function executeRawPress(request: RawPressRequest): Promise<RawPressOutcome> {
  await authReady;
  const uid = auth.currentUser?.uid;
  if (!uid || uid !== request.actorUid) throw Error('압착 요청 로그인 계정을 확인해 주세요.');
  const assertScope = async () => {
    if (auth.currentUser?.uid !== uid) throw Error('로그인 계정이 바뀌어 압착 완료 여부를 확인해야 합니다.');
    const token = await auth.currentUser.getIdTokenResult();
    withClaimCompany(COL.rawInventoryJobs, { companyId: request.companyId }, { companyId: token.claims.companyId });
    if (auth.currentUser?.uid !== uid) throw Error('로그인 계정이 바뀌어 압착 완료 여부를 확인해야 합니다.');
  };
  await assertScope();
  const pending = saveRawPressAttempt(request);
  const outcome = await executeRawPressWithDb(db, request, assertScope);
  await assertScope();
  if ((outcome.status !== 'blocked' || !outcome.retainPending) && auth.currentUser?.uid === uid) clearRawPressAttempt(request.companyId, uid, pending.encoded);
  return outcome;
}
export type RawPressCancellationOutcome={status:'cancelled'|'duplicate';sourceAppliedKg:number;derivedAppliedKg:number}
  |{status:'already-cancelled';reason:string}
  |{status:'blocked';reason:string;retainPending:boolean}|{status:'legacy'};
export async function executeRawPressCancellationWithDb(database:Firestore,request:RawPressCancellationRequest,assertScope?:()=>Promise<void>):Promise<RawPressCancellationOutcome>{
  validateRawPressCancellationRequest(request);
  const jobRef=doc(database,COL.rawInventoryJobs,`raw-press-${operationDocId(request.originalOperationId)}`);
  return runTransaction(database,async tx=>{
    await assertScope?.();
    const jobSnap=await tx.get(jobRef);
    const blocked=(reason:string,retainPending=true):RawPressCancellationOutcome=>({status:'blocked',reason,retainPending});
    if(!jobSnap.exists())return blocked('최초 압착 완료 근거가 없어 자동 취소하지 않았습니다.');
    const job=jobSnap.data() as RawPressJob;
    let readRequest=request;
    if(job.cancellation!==undefined){
      try{validateRawPressCancellationRequest(job.cancellation.request);}catch{return blocked('기존 압착 취소 원문을 확인해 주세요.');}
      if(job.cancellation.request.companyId!==request.companyId||rawPressText(job.cancellation.request.original)!==rawPressText(request.original))return blocked('기존 압착 취소 원문이 원 작업과 다릅니다.');
      readRequest=job.cancellation.request;
    }
    const [sourceRead,derivedRead]=await Promise.all([readRawCommandInTransaction(tx,database,readRequest.sourceReverse),readRawCommandInTransaction(tx,database,readRequest.derivedReverse)]);
    const problem=pairProblem(job,request.original,originalRead(sourceRead),originalRead(derivedRead));
    if(problem)return blocked(problem);
    if(job.cancellation!==undefined){
      if(!cancellationMatches(job,sourceRead,derivedRead))return blocked('기존 압착 취소 완료 근거를 확인해 주세요.');
      return rawPressText(job.cancellation.request)===rawPressText(request)
        ?{status:'duplicate',sourceAppliedKg:job.cancellation.sourceAppliedKg,derivedAppliedKg:job.cancellation.derivedAppliedKg}
        :{status:'already-cancelled',reason:'검증된 취소가 이미 완료되어 다시 실행하지 않았습니다.'};
    }
    if(exists(sourceRead)||exists(derivedRead)||sourceRead.guardSnap?.exists()||derivedRead.guardSnap?.exists())return blocked('기존 부분 취소 이력이 있어 자동 보완하지 않았습니다.');
    const source=prepareRawCommand(request.sourceReverse,sourceRead,{now:request.createdAt});
    const derived=job.derivedDisposition==='received'?prepareRawCommand(request.derivedReverse,derivedRead,{now:request.createdAt}):null;
    if(source.status!=='applied')return blocked(source.status==='rejected'?source.message:'원료 취소 요청을 확인해 주세요.',false);
    if(derived&&derived.status!=='applied')return blocked(derived.status==='rejected'?derived.message:'파생 입고 취소 요청을 확인해 주세요.',false);
    await assertScope?.();
    const legacy={type:'correction' as const,note:`압착 취소 (${request.original.entry.note??''})`};
    writePreparedRawCommand(tx,request.sourceReverse,sourceRead,source,{legacy});
    if(derived?.status==='applied')writePreparedRawCommand(tx,request.derivedReverse,derivedRead,derived,{legacy});
    const sourceAppliedKg=source.movement.appliedDeltaKg,derivedAppliedKg=derived?.status==='applied'?derived.movement.appliedDeltaKg:0;
    tx.update(jobRef,{cancellation:prune({request,companyId:request.companyId,actorUid:request.actorUid,completedAt:request.createdAt,sourceAppliedKg,derivedAppliedKg})});
    return {status:'cancelled',sourceAppliedKg,derivedAppliedKg};
  });
}
export async function executeRawPressCancellation(input:{companyId:RawPressRequest['companyId'];actorUid:string;originalOperationId:string}):Promise<RawPressCancellationOutcome>{
  await authReady;
  const uid=auth.currentUser?.uid;if(!uid||uid!==input.actorUid)throw Error('압착 취소 로그인 계정을 확인해 주세요.');
  const assertScope=async()=>{if(auth.currentUser?.uid!==uid)throw Error('압착 취소 계정이 바뀌어 완료 여부를 확인해야 합니다.');const token=await auth.currentUser.getIdTokenResult();withClaimCompany(COL.rawInventoryJobs,{companyId:input.companyId},{companyId:token.claims.companyId});if(auth.currentUser?.uid!==uid)throw Error('압착 취소 계정이 바뀌었습니다.');};
  await assertScope();
  let pending=readRawPressCancellationAttempt(input.companyId,uid,input.originalOperationId);
  if(!pending){
    const key=`raw-press-${operationDocId(input.originalOperationId)}`,snap=await getDocFromServer(doc(db,COL.rawInventoryJobs,key));await assertScope();
    if(!snap.exists())return {status:'legacy'};
    const job=snap.data() as RawPressJob;
    try{validateRawPressRequest(job.rawPressEvidence);}catch{return {status:'blocked',reason:'압착 완료 원문이 손상되어 자동 취소하지 않았습니다.',retainPending:true};}
    if(job.companyId!==input.companyId||job.rawPressEvidence.entry.id!==input.originalOperationId)return {status:'blocked',reason:'압착 완료 회사와 원문을 확인해 주세요.',retainPending:true};
    const request=makeRawPressCancellationRequest(job.rawPressEvidence,uid,`press-cancel:${crypto.randomUUID()}`,new Date().toISOString());
    pending=saveRawPressCancellationAttempt(request);
  }
  const outcome=await executeRawPressCancellationWithDb(db,pending.request,assertScope);await assertScope();
  if(outcome.status!=='blocked'||!outcome.retainPending)clearRawPressCancellationAttempt(pending.request,pending.encoded);
  return outcome;
}
