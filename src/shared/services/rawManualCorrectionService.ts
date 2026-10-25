import {auth,authReady,functions} from '../firebase';
import {httpsCallable} from 'firebase/functions';
import {inventoryWriterSame} from '../../../functions/src/shared/inventoryWriterProtocol';
import type {RawManualCorrectionRequest,RawManualCorrectionResult} from '../../../functions/src/rawManualCorrectionCommand';
export type {RawManualCorrectionRequest,RawManualCorrectionResult};
export type RawManualCorrectionAction='apply'|'inspect'|'cancel';
type Scope={signal:AbortSignal;isCurrent?:()=>boolean};
/** 서버가 직렬화한 원문을 검증한다. 클라이언트에 별도 canonical 직렬화 규칙을 만들지 않는다. */
export async function verifyRawManualCorrectionResult(value:unknown,request:RawManualCorrectionRequest):Promise<RawManualCorrectionResult>{
 const row=value as RawManualCorrectionResult;
 if(!row||row.version!==1||row.operationId!==request.operationId||row.companyId!==request.companyId||row.actorUid!==request.actorUid||row.employeeId!==request.employeeId||!['applied','cancelled','rejected','unknown','conflict'].includes(row.status)||typeof row.message!=='string'||typeof row.requestText!=='string'||!/^[a-f0-9]{64}$/.test(row.requestHash))throw Error('정정 응답의 대상과 처리 상태를 확인하지 못했습니다. 최초 원문을 보존했습니다.');
 const text=row.requestText;let parsed:unknown;try{parsed=JSON.parse(text);}catch{throw Error('정정 응답 원문을 읽지 못했습니다. 최초 요청을 보존했습니다.');}
 if(!inventoryWriterSame(parsed,request))throw Error('정정 응답의 최초 원문이 다릅니다. 요청을 보존했습니다.');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
 if(digest!==row.requestHash)throw Error('정정 응답 원문의 해시가 다릅니다. 요청을 보존했습니다.');
 if(row.status==='applied'&&(!row.movement||row.movement.operationId!==request.operationId||row.movement.companyId!==request.companyId||row.movement.rawItemId!==request.command.rawItemId||!Number.isFinite(row.movement.appliedDeltaKg)||!Number.isFinite(row.movement.balanceAfterKg)))throw Error('정정 적용 근거를 확인하지 못했습니다. 요청을 보존했습니다.');
 return row;
}
/** 로그아웃은 서버 취소가 아니다. 이미 전송한 명령은 계속 처리되며 현재 화면 반영만 차단한다. */
export async function rawManualCorrection(action:RawManualCorrectionAction,request:RawManualCorrectionRequest,scope:Scope):Promise<RawManualCorrectionResult>{
 const fixed=structuredClone(request);
 const current=()=>!scope.signal.aborted&&(!scope.isCurrent||scope.isCurrent())&&auth.currentUser?.uid===fixed.actorUid;
 const check=()=>{if(!current())throw Error('정정 요청의 로그인 또는 화면이 변경되었습니다. 보관된 요청에서 결과를 확인해 주세요.');};
 check();await authReady;check();
 const user=auth.currentUser!;
 const token=await user.getIdTokenResult();check();
 if(token.claims.companyId!==fixed.companyId||token.claims.employeeId!==fixed.employeeId)throw Error('최초 정정과 같은 회사·직원 계정으로 확인해 주세요. 요청은 보존했습니다.');
 const call=httpsCallable<{action:RawManualCorrectionAction;request:RawManualCorrectionRequest},RawManualCorrectionResult>(functions,'rawManualCorrectionCommand');
 check();const response=await call({action,request:fixed});check();
 const result=await verifyRawManualCorrectionResult(response.data,fixed);check();return result;
}
