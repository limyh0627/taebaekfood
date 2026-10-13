import type {CompanyId} from './types';
import type {OemIssueInput} from '../features/admin/oemIssueJob';
import {rawPressText} from './rawPressAttempt';

export type OemIssueRequest={version:1;companyId:CompanyId;actorUid:string;input:OemIssueInput};
export type OemIssueRetained={request:OemIssueRequest;encoded:string;key:string};
export type OemIssueEntry={key:string;retained:OemIssueRetained|null;deleted:boolean;error:string;companyId:CompanyId;actorUid:string;legacyText?:string;legacyStore?:'session'|'local'};
const prefix=(company:CompanyId,uid:string)=>`oem-issue-v1:${company}:${encodeURIComponent(uid)}:`;
const stateKey=(key:string)=>key+':state';
const validId=(v:unknown)=>typeof v==='string'&&!!v.trim()&&!v.includes('/');
export function validateOemIssueRequest(r:OemIssueRequest){
 const i=r?.input;
 if(r?.version!==1||!['taebaek','punghoe'].includes(r.companyId)||!validId(r.actorUid)||i?.companyId!==r.companyId
  ||!validId(i.jobId)||!validId(i.partnerId)||typeof i.partnerName!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(i.date)
  ||!Array.isArray(i.sent)||!i.sent.length||new Set(i.sent.map(row=>row.rawItemId)).size!==i.sent.length
  ||i.sent.some(row=>!validId(row.rawItemId)||!row.material?.trim()||!Number.isFinite(row.kg)||row.kg<=0))throw Error('OEM 송출 최초 원문의 회사·계정·원료·수량·날짜를 확인해 주세요.');
}
export const oemIssueAttemptKey=(r:OemIssueRequest)=>prefix(r.companyId,r.actorUid)+encodeURIComponent(r.input.jobId);
export function listOemIssueAttempts(companyId:CompanyId,actorUid:string):OemIssueEntry[]{
 const entries:OemIssueEntry[]=Object.keys(localStorage).filter(key=>key.startsWith(prefix(companyId,actorUid))&&!key.endsWith(':state')).sort().map(key=>{
  const encoded=localStorage.getItem(key)!;
  try{const request=JSON.parse(encoded) as OemIssueRequest;validateOemIssueRequest(request);if(oemIssueAttemptKey(request)!==key)throw Error();
   let state:any;try{state=JSON.parse(localStorage.getItem(stateKey(key))??'null');}catch{/* 손상 표식은 원문을 숨기지 않는다. */}
   return {key,companyId,actorUid,retained:{request,encoded,key},deleted:state?.encoded===encoded&&state.deleted===true,error:state?.encoded===encoded&&typeof state.error==='string'?state.error:''};
  }catch{return {key,companyId,actorUid,retained:null,deleted:false,error:'보존된 OEM 송출 원문이 손상되었습니다. 원문을 유지했습니다.'};}
 });
 for(const legacyStore of ['session','local'] as const){const store=legacyStore==='session'?sessionStorage:localStorage,legacyText=store.getItem('oem-issue-pending:'+companyId);if(legacyText===null)continue;
  const key=`oem-issue-legacy-view:${companyId}:${encodeURIComponent(actorUid)}:${legacyStore}`;let marker:any;try{marker=JSON.parse(localStorage.getItem(stateKey(key))??'null');}catch{/* 원문은 숨기지 않는다. */}
  entries.push({key,companyId,actorUid,retained:null,legacyText,legacyStore,deleted:marker?.encoded===legacyText&&marker.deleted===true,error:'과거 송출 요청의 최초 계정과 정규화 원문을 확인할 수 없습니다. 원료 송출 이력을 확인해 주세요.'});
 }
 return entries;
}
export async function withOemIssueLock<T>(companyId:CompanyId,actorUid:string,current:()=>boolean,work:()=>T|Promise<T>):Promise<T>{
 if(!current())throw Error('OEM 송출 회사나 로그인 계정이 변경되었습니다.');
 if(typeof navigator==='undefined'||!navigator.locks?.request)throw Error('창 간 안전 잠금을 지원하는 브라우저에서 송출 요청을 확인해 주세요.');
 return navigator.locks.request(prefix(companyId,actorUid),{mode:'exclusive'},async()=>{if(!current())throw Error('OEM 송출 계정이 변경되었습니다.');return work();});
}
export function assertOemIssueAttempt(retained:OemIssueRetained){
 validateOemIssueRequest(retained.request);if(retained.key!==oemIssueAttemptKey(retained.request))throw Error('선택한 OEM 송출 저장 범위가 다릅니다.');
 if(localStorage.getItem(retained.key)!==retained.encoded||rawPressText(JSON.parse(retained.encoded))!==rawPressText(retained.request))throw Error('OEM 최초 송출 원문이 변경되어 요청을 중단했습니다.');
}
export async function beginOemIssueAttempt(input:OemIssueInput,actorUid:string,current:()=>boolean):Promise<OemIssueRetained>{
 const request=JSON.parse(JSON.stringify({version:1,companyId:input.companyId,actorUid,input})) as OemIssueRequest;validateOemIssueRequest(request);
 return withOemIssueLock(request.companyId,actorUid,current,()=>{
  const entries=listOemIssueAttempts(request.companyId,actorUid),targets=request.input.sent.map(row=>row.rawItemId);
  // 삭제 표식도 미확정 재고 근거다. 목록만 숨기고 관련 원료의 새 효과는 계속 막는다.
  for(const entry of entries){if(!entry.retained)throw Error(entry.error);const other=entry.retained.request;
   if(other.input.jobId===input.jobId){if(rawPressText(other)!==rawPressText(request))throw Error('같은 OEM 작업의 최초 원문이 다릅니다.');assertOemIssueAttempt(entry.retained);return entry.retained;}
   if(other.input.sent.some(row=>targets.includes(row.rawItemId)))throw Error('같은 원료의 이전 송출 결과를 먼저 확인해 주세요. 삭제한 실패 요청도 근거는 유지됩니다.');
  }
  const legacy=sessionStorage.getItem('oem-issue-pending:'+request.companyId);
  if(legacy!==null)throw Error('과거 송출 요청의 최초 계정과 원문을 확인할 수 없습니다. 원료 송출 이력을 확인해 주세요.');
  const key=oemIssueAttemptKey(request),encoded=JSON.stringify(request);localStorage.setItem(key,encoded);
  if(!current()||localStorage.getItem(key)!==encoded)throw Error('최초 송출 원문 저장을 확인하지 못했습니다. 원문을 보존했습니다.');return {request,encoded,key};
 });
}
export async function markOemIssueFailure(retained:OemIssueRetained,error:string,deleted:boolean,current:()=>boolean){
 await withOemIssueLock(retained.request.companyId,retained.request.actorUid,current,()=>{assertOemIssueAttempt(retained);const marker=JSON.stringify({encoded:retained.encoded,error,deleted});localStorage.setItem(stateKey(retained.key),marker);if(!current()||localStorage.getItem(stateKey(retained.key))!==marker)throw Error('송출 실패 상태를 저장하지 못했습니다.');});
}
export const deleteOemIssueAttempt=(retained:OemIssueRetained,current:()=>boolean)=>markOemIssueFailure(retained,'',true,current);
export async function deleteOemIssueEntry(entry:OemIssueEntry,current:()=>boolean){
 if(entry.retained)return deleteOemIssueAttempt(entry.retained,current);
 if(entry.legacyText===undefined||!entry.legacyStore)throw Error('손상된 송출 원문은 자동 삭제하지 않습니다.');
 await withOemIssueLock(entry.companyId,entry.actorUid,current,()=>{const store=entry.legacyStore==='session'?sessionStorage:localStorage;
  const key=`oem-issue-legacy-view:${entry.companyId}:${encodeURIComponent(entry.actorUid)}:${entry.legacyStore}`;
  if(entry.key!==key||store.getItem('oem-issue-pending:'+entry.companyId)!==entry.legacyText)throw Error('과거 송출 원문이 바뀌어 목록을 정리하지 않았습니다.');
  const marker=JSON.stringify({encoded:entry.legacyText,deleted:true});localStorage.setItem(stateKey(key),marker);if(!current()||localStorage.getItem(stateKey(key))!==marker)throw Error('과거 송출 실패 목록 삭제를 확인하지 못했습니다.');
 });
}
const completed=new Map<string,string>();
export function acknowledgeOemIssueAttempt(retained:OemIssueRetained){assertOemIssueAttempt(retained);completed.set(retained.key,retained.encoded);}
export async function clearOemIssueAttempt(retained:OemIssueRetained,current:()=>boolean){
 await withOemIssueLock(retained.request.companyId,retained.request.actorUid,current,()=>{assertOemIssueAttempt(retained);if(completed.get(retained.key)!==retained.encoded)throw Error('OEM 송출 완료를 확인하지 못해 최초 원문을 유지했습니다.');localStorage.removeItem(retained.key);localStorage.removeItem(stateKey(retained.key));completed.delete(retained.key);});
}
