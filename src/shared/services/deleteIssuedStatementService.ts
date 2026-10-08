import {doc,getDoc} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {auth,authReady,db,functions} from '../firebase';
import {companyOf,type CompanyId} from '../types';
import {requireActiveReleaseId} from '../releaseGate';
type Command={operationId:string;statementId:string;releaseId:string;expectedRevision:number;expectedOriginalHash:string};
const running=new Set<string>();
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value.toMillis==='function'?{timestampMillis:value.toMillis()}:value instanceof Date?{dateISO:value.toISOString()}:value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value))))),byte=>byte.toString(16).padStart(2,'0')).join('');
/** 원문·작업 ID를 보관해 응답이 유실되어도 같은 서버 삭제만 재시도한다. */
export async function deleteIssuedStatement(companyId:CompanyId,id:string):Promise<void>{
 await authReady;const user=auth.currentUser;
 const assertActor=async()=>{if(!user||auth.currentUser?.uid!==user.uid)throw new Error('로그인이 만료되었습니다.');const claims=(await user.getIdTokenResult()).claims;if(auth.currentUser?.uid!==user.uid||claims.companyId!==companyId||claims.isAdmin!==true)throw new Error('관리자 회사 권한이 없습니다.');};
 await assertActor();const key=`statement-delete:${companyId}:${user!.uid}:${id}`;
 if(running.has(key))throw new Error('이 전표를 삭제 중입니다.');running.add(key);
 try{
 let input:Command;let saved=localStorage.getItem(key);
 if(saved!==null){try{input=JSON.parse(saved);}catch{throw new Error('보관된 삭제 요청을 확인할 수 없습니다.');}
  if(!input||input.statementId!==id||typeof input.operationId!=='string'||typeof input.releaseId!=='string'||typeof input.expectedOriginalHash!=='string'||!/^[A-Za-z0-9_-]{1,150}$/.test(input.operationId)||!/^[A-Za-z0-9_-]{1,100}$/.test(input.releaseId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!/^[a-f0-9]{64}$/.test(input.expectedOriginalHash)||Object.keys(input).sort().join(',')!=='expectedOriginalHash,expectedRevision,operationId,releaseId,statementId')throw new Error('보관된 삭제 요청이 손상되었습니다.');
 }else{const original=await getDoc(doc(db,'issuedStatements',id));await assertActor();if(!original.exists())throw new Error('대상 전표를 찾을 수 없습니다.');const row=original.data();if(companyOf(row)!==companyId)throw new Error('다른 회사의 전표는 삭제할 수 없습니다.');const gate=await getDoc(doc(db,'appMeta','releaseCutover'));await assertActor();input={operationId:`delete-${crypto.randomUUID()}`,statementId:id,releaseId:requireActiveReleaseId(gate.data()),expectedRevision:row.mutationRevision??0,expectedOriginalHash:await hash(Object.fromEntries(Object.entries(row).filter(([key])=>key!=='id')))};await assertActor();saved=JSON.stringify(input);localStorage.setItem(key,saved);}
 const requestHash=await hash({companyId,actorId:user!.uid,...input});
 const verify=async()=>{const snap=await getDoc(doc(db,'voucherMutationOperations',input.operationId));await assertActor();if(!snap.exists())return null;const row=snap.data();if(row.companyId!==companyId||row.createdBy!==user!.uid||row.kind!=='issuedStatements'||row.action!=='delete'||!['applied','rejected'].includes(row.status)||row.voucherId!==id||row.requestHash!==requestHash||!row.command||await hash(row.command)!==await hash(input))throw new Error('삭제 감사가 원 요청과 일치하지 않습니다.');
  if(row.status==='rejected'){if(!['invalid-argument','failed-precondition'].includes(row.failureCode)||typeof row.failureMessage!=='string')throw new Error('삭제 거절 감사를 확인할 수 없습니다.');await assertActor();return {status:'rejected' as const,message:row.failureMessage};}
  if(row.beforeHash!==input.expectedOriginalHash||!row.beforeSnapshot||companyOf(row.beforeSnapshot)!==companyId||await hash(Object.fromEntries(Object.entries(row.beforeSnapshot).filter(([key])=>key!=='id')))!==row.beforeHash||row.afterHash!==null)throw new Error('삭제 완료 감사가 원 요청과 일치하지 않습니다.');await assertActor();return {status:'applied' as const,message:''};};
 const clear=async()=>{await assertActor();if(localStorage.getItem(key)===saved)localStorage.removeItem(key);};
 await assertActor();let callError:unknown;
 try{await httpsCallable(functions,'deleteIssuedStatementCommand')(input);}catch(error){callError=error;}
 const receipt=await verify();
 if(!receipt){if(callError)throw callError;throw new Error('삭제 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.');}
 await clear();if(receipt.status==='rejected')throw new Error(receipt.message);
 }finally{running.delete(key);}
}
