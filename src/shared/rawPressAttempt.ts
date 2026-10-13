import type { CompanyId, RawMaterialEntry } from './types';
import type { RawInventoryCommand } from './rawInventoryCore';
import type { LegacyLedgerFields } from './services/rawInventoryService';

export interface RawPressRequest {
  version: 1;
  companyId: CompanyId;
  actorUid: string;
  entry: RawMaterialEntry;
  yieldRule: { product: string; rate: number };
  sourceCommand: Extract<RawInventoryCommand, { kind: 'consume-lot' }>;
  derivedCommand: Extract<RawInventoryCommand, { kind: 'receive' }>;
  sourceLegacy: LegacyLedgerFields;
  derivedLegacy: LegacyLedgerFields;
}
export function rawPressText(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().filter(key => v[key] !== undefined).map(key => [key, canonical(v[key])])) : v;
  return JSON.stringify(canonical(value));
}
/** 기존 압착 수율 셈을 안내·저장·원문 검증이 함께 사용한다. kg를 다시 환산하지 않는다. */
export const rawPressYieldKg = (usedKg: number, rate: number): number => Math.round(usedKg * rate * 1000) / 1000;
export function validateRawPressRequest(request: RawPressRequest): void {
  const r = request, source = r?.sourceCommand, derived = r?.derivedCommand;
  if (r?.version !== 1 || !['taebaek', 'punghoe'].includes(r.companyId) || !r.actorUid
    || !r.entry?.id || !r.entry.effectiveAt || !Number.isFinite(Date.parse(r.entry.effectiveAt))
    || !r.entry.createdAt || !Number.isFinite(Date.parse(r.entry.createdAt))
    || r.entry.type !== 'manual' || r.entry.targetKg != null || r.entry.received !== 0
    || !Number.isFinite(r.entry.used) || r.entry.used <= 0 || !r.entry.targetLotId
    || !r.yieldRule?.product || !Number.isFinite(r.yieldRule.rate) || r.yieldRule.rate <= 0
    || source?.kind !== 'consume-lot' || derived?.kind !== 'receive'
    || source.companyId !== r.companyId || derived.companyId !== r.companyId
    || source.rawItemId === derived.rawItemId || !source.rawItemId || !derived.rawItemId
    || source.operationId !== r.entry.id || derived.operationId !== `yield:${r.entry.id}`
    || source.source?.type !== 'manual' || source.source.id !== r.entry.id
    || derived.source?.type !== 'manual' || derived.source.id !== r.entry.id
    || source.kg !== r.entry.used || source.lotId !== r.entry.targetLotId
    || source.effectiveAt !== r.entry.effectiveAt || derived.effectiveAt !== r.entry.effectiveAt
    || derived.kg !== rawPressYieldKg(r.entry.used, r.yieldRule.rate)
    || !Number.isFinite(derived.kg) || derived.kg < 0
    || source.materialSnapshot !== r.entry.material || derived.materialSnapshot !== r.yieldRule.product
    || (r.entry.companyId !== undefined && r.entry.companyId !== r.companyId)) throw Error('압착 최초 요청 원문을 확인해 주세요.');
}
export const rawPressAttemptKey = (companyId: CompanyId, actorUid: string) => `raw-press:${encodeURIComponent(actorUid)}:${companyId}`;
export type RawPressRetained={request:RawPressRequest;encoded:string;storageKey?:string;state?:'prepared'|'submitted'};
export type RawPressEntry={key:string;retained:RawPressRetained|null;deleted:boolean;error:string};
const pressPrefix=(companyId:CompanyId,uid:string)=>`raw-press-v2:${companyId}:${encodeURIComponent(uid)}:`;
const pressKey=(r:RawPressRequest)=>pressPrefix(r.companyId,r.actorUid)+encodeURIComponent(r.entry.id);
const pressStateKey=(key:string)=>key+':state';
export function listRawPressAttempts(companyId:CompanyId,uid:string):RawPressEntry[]{
 const prefix=pressPrefix(companyId,uid),legacy=rawPressAttemptKey(companyId,uid);
 return Object.keys(localStorage).filter(key=>key===legacy||key.startsWith(prefix)&&!key.endsWith(':state')).sort().map(key=>{
  const encoded=localStorage.getItem(key)!;
  try{const value=JSON.parse(encoded),request=(key===legacy?value:value.request) as RawPressRequest;validateRawPressRequest(request);
   if(request.companyId!==companyId||request.actorUid!==uid||key!==legacy&&(pressKey(request)!==key||!['prepared','submitted'].includes(value.state)))throw Error();
   let marker:any;try{marker=JSON.parse(localStorage.getItem(pressStateKey(key))??'null');}catch{/* 손상 표식으로 원문을 숨기지 않는다. */}
   return {key,retained:{request,encoded,storageKey:key,state:key===legacy?'submitted':value.state},deleted:marker?.encoded===encoded&&marker.deleted===true,error:''};
  }catch{return {key,retained:null,deleted:false,error:'보존된 압착 최초 원문이 손상되었습니다. 원문을 유지했습니다.'};}
 });
}
export async function withRawPressLock<T>(company:CompanyId,uid:string,current:()=>boolean,work:()=>T|Promise<T>):Promise<T>{
 if(!current())throw Error('압착 회사나 로그인 계정이 변경되었습니다.');if(typeof navigator==='undefined'||!navigator.locks?.request)throw Error('창 간 안전 잠금을 지원하는 브라우저에서 압착 요청을 확인해 주세요.');
 return navigator.locks.request(pressPrefix(company,uid),{mode:'exclusive'},async()=>{if(!current())throw Error('압착 로그인 계정이 변경되었습니다.');return work();});
}
export function assertRawPressAttempt(retained:RawPressRetained){
 const key=retained.storageKey??rawPressAttemptKey(retained.request.companyId,retained.request.actorUid);
 if(key!==pressKey(retained.request)&&key!==rawPressAttemptKey(retained.request.companyId,retained.request.actorUid))throw Error('선택한 압착 저장 범위가 다릅니다.');
 if(localStorage.getItem(key)!==retained.encoded)throw Error('압착 최초 원문이 변경되었습니다. 현재 원문을 보존했습니다.');
 const parsed=JSON.parse(retained.encoded),request=key.startsWith('raw-press-v2:')?parsed.request:parsed;
 if(key.startsWith('raw-press-v2:')&&parsed.state!==retained.state)throw Error('압착 제출 상태가 최초 저장 원문과 다릅니다.');
 if(!key.startsWith('raw-press-v2:')&&retained.state!==undefined&&retained.state!=='submitted')throw Error('과거 압착 요청은 결과 확인만 가능합니다.');
 if(rawPressText(request)!==rawPressText(retained.request))throw Error('선택한 압착 요청이 최초 원문과 다릅니다.');
}
export async function beginNewRawPressAttempt(input:RawPressRequest,current:()=>boolean):Promise<RawPressRetained>{
 const request=JSON.parse(JSON.stringify(input)) as RawPressRequest;validateRawPressRequest(request);
 return withRawPressLock(request.companyId,request.actorUid,current,()=>{
  const entries=listRawPressAttempts(request.companyId,request.actorUid),targets=[request.sourceCommand.rawItemId,request.derivedCommand.rawItemId];
  for(const entry of entries){if(!entry.retained)throw Error(entry.error);const other=entry.retained.request;
   if(other.entry.id===request.entry.id)throw Error('같은 압착 최초 요청을 실패 목록에서 선택해 확인해 주세요.');
   if([other.sourceCommand.rawItemId,other.derivedCommand.rawItemId].some(id=>targets.includes(id)))throw Error('같은 원료나 파생 품목의 이전 압착 결과를 먼저 확인해 주세요. 삭제한 실패 요청도 근거는 유지됩니다.');
  }
  const storageKey=pressKey(request),encoded=JSON.stringify({request,state:'prepared'});localStorage.setItem(storageKey,encoded);
  if(!current()||localStorage.getItem(storageKey)!==encoded)throw Error('압착 최초 원문 저장을 확인하지 못했습니다.');return {request,encoded,storageKey,state:'prepared'};
 });
}
export async function deleteRawPressAttempt(retained:RawPressRetained,current:()=>boolean){
 await withRawPressLock(retained.request.companyId,retained.request.actorUid,current,()=>{assertRawPressAttempt(retained);const key=retained.storageKey??rawPressAttemptKey(retained.request.companyId,retained.request.actorUid),marker=JSON.stringify({encoded:retained.encoded,deleted:true});localStorage.setItem(pressStateKey(key),marker);if(!current()||localStorage.getItem(pressStateKey(key))!==marker)throw Error('압착 실패 목록 삭제를 확인하지 못했습니다.');});
}
export async function submitRawPressAttempt(retained:RawPressRetained,current:()=>boolean):Promise<RawPressRetained>{
 return withRawPressLock(retained.request.companyId,retained.request.actorUid,current,()=>{assertRawPressAttempt(retained);if(retained.state!=='prepared')return retained;
  const targets=[retained.request.sourceCommand.rawItemId,retained.request.derivedCommand.rawItemId];
  if(listRawPressAttempts(retained.request.companyId,retained.request.actorUid).some(entry=>entry.key!==retained.storageKey&&(!entry.retained||[entry.retained.request.sourceCommand.rawItemId,entry.retained.request.derivedCommand.rawItemId].some(id=>targets.includes(id)))))throw Error('같은 원료나 파생 품목의 이전 요청을 확인해 주세요.');
  const key=retained.storageKey!,encoded=JSON.stringify({request:retained.request,state:'submitted'});localStorage.setItem(key,encoded);if(!current()||localStorage.getItem(key)!==encoded)throw Error('압착 제출 원문 저장을 확인하지 못했습니다.');return {...retained,encoded,state:'submitted'};
 });
}
export function clearSelectedRawPressAttempt(retained:RawPressRetained){assertRawPressAttempt(retained);const key=retained.storageKey??rawPressAttemptKey(retained.request.companyId,retained.request.actorUid);localStorage.removeItem(key);localStorage.removeItem(pressStateKey(key));}
export function readRawPressAttempt(companyId: CompanyId, actorUid: string): { request: RawPressRequest; encoded: string } | null {
  const encoded = localStorage.getItem(rawPressAttemptKey(companyId, actorUid));
  if (encoded === null) return null;
  try {
    const request = JSON.parse(encoded) as RawPressRequest;
    validateRawPressRequest(request);
    if (request.companyId !== companyId || request.actorUid !== actorUid) throw Error();
    return { request, encoded };
  } catch { throw Error('저장된 압착 요청이 손상되었습니다. 원문을 보존했으니 확인이 필요합니다.'); }
}
export function hasRawPressAttempt(companyId: CompanyId, actorUid: string): boolean { return readRawPressAttempt(companyId, actorUid) !== null; }
export function saveRawPressAttempt(request: RawPressRequest): { request: RawPressRequest; encoded: string } {
  validateRawPressRequest(request);
  const existing = readRawPressAttempt(request.companyId, request.actorUid);
  if (existing) {
    if (rawPressText(existing.request) !== rawPressText(request)) throw Error('이전에 완료 여부를 확인하지 못한 압착 요청을 먼저 재개해 주세요.');
    return existing;
  }
  const key = rawPressAttemptKey(request.companyId, request.actorUid), encoded = JSON.stringify(request);
  if (localStorage.getItem(key) !== null) throw Error('다른 압착 요청을 먼저 재개해 주세요.');
  localStorage.setItem(key, encoded);
  return { request, encoded };
}
export function clearRawPressAttempt(companyId: CompanyId, actorUid: string, encoded: string): void {
  const key = rawPressAttemptKey(companyId, actorUid);
  if (localStorage.getItem(key) !== encoded) throw Error('압착 재개 원문이 달라 정리하지 않았습니다.');
  localStorage.removeItem(key);
}
export interface RawPressCancellationRequest {
  version:1; companyId:CompanyId; actorUid:string; originalOperationId:string;
  cancellationId:string; effectiveAt:string; createdAt:string; original:RawPressRequest;
  sourceReverse:Extract<RawInventoryCommand,{kind:'reverse'}>;
  derivedReverse:Extract<RawInventoryCommand,{kind:'reverse'}>;
}
export function makeRawPressCancellationRequest(original:RawPressRequest,actorUid:string,cancellationId:string,effectiveAt:string):RawPressCancellationRequest {
  const reverse=(command:RawInventoryCommand,side:string):Extract<RawInventoryCommand,{kind:'reverse'}>=>({
    kind:'reverse',companyId:original.companyId,rawItemId:command.rawItemId,materialSnapshot:command.materialSnapshot,
    operationId:`${cancellationId}:${side}`,effectiveAt,source:{type:'reversal',id:command.operationId},originalOperationId:command.operationId,
  });
  return {version:1,companyId:original.companyId,actorUid,originalOperationId:original.entry.id,cancellationId,effectiveAt,createdAt:effectiveAt,original,
    sourceReverse:reverse(original.sourceCommand,'source'),derivedReverse:reverse(original.derivedCommand,'derived')};
}
export function validateRawPressCancellationRequest(request:RawPressCancellationRequest):void {
  validateRawPressRequest(request?.original);
  if(request.version!==1||request.companyId!==request.original.companyId||!request.actorUid||!request.cancellationId
    ||request.originalOperationId!==request.original.entry.id||!Number.isFinite(Date.parse(request.effectiveAt))||request.createdAt!==request.effectiveAt
    ||rawPressText(request)!==rawPressText(makeRawPressCancellationRequest(request.original,request.actorUid,request.cancellationId,request.effectiveAt)))throw Error('압착 취소 최초 원문을 확인해 주세요.');
}
export const rawPressCancellationAttemptKey=(companyId:CompanyId,actorUid:string,originalOperationId:string)=>`raw-press-cancel:${encodeURIComponent(actorUid)}:${companyId}:${encodeURIComponent(originalOperationId)}`;
export function readRawPressCancellationAttempt(companyId:CompanyId,actorUid:string,originalOperationId:string):{request:RawPressCancellationRequest;encoded:string}|null {
  const encoded=localStorage.getItem(rawPressCancellationAttemptKey(companyId,actorUid,originalOperationId));
  if(encoded===null)return null;
  try{const request=JSON.parse(encoded);validateRawPressCancellationRequest(request);if(request.companyId!==companyId||request.actorUid!==actorUid||request.originalOperationId!==originalOperationId)throw Error();return {request,encoded};}
  catch{throw Error('저장된 압착 취소 요청이 손상되었습니다. 최초 원문을 보존했습니다.');}
}
export function saveRawPressCancellationAttempt(request:RawPressCancellationRequest):{request:RawPressCancellationRequest;encoded:string} {
  validateRawPressCancellationRequest(request);
  const existing=readRawPressCancellationAttempt(request.companyId,request.actorUid,request.originalOperationId);
  if(existing){if(rawPressText(existing.request)!==rawPressText(request))throw Error('이전 압착 취소 요청을 먼저 재개해 주세요.');return existing;}
  const key=rawPressCancellationAttemptKey(request.companyId,request.actorUid,request.originalOperationId),encoded=JSON.stringify(request);
  if(localStorage.getItem(key)!==null)throw Error('다른 압착 취소 요청이 있습니다.');
  localStorage.setItem(key,encoded);return {request,encoded};
}
export function clearRawPressCancellationAttempt(request:RawPressCancellationRequest,encoded:string):void {
  const key=rawPressCancellationAttemptKey(request.companyId,request.actorUid,request.originalOperationId);
  if(localStorage.getItem(key)!==encoded)throw Error('압착 취소 원문이 달라 정리하지 않았습니다.');localStorage.removeItem(key);
}
