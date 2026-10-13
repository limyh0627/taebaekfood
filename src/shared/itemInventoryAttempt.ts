import type {CompanyId} from './types';
import type {UnpackPlan} from './canUnpack';
import {isCalendarDay,today} from './day';
import {rawPressText} from './rawPressAttempt';
type Base={version:1;operationId:string;companyId:CompanyId;uid:string;capturedAt:string;date:string};
export type ItemStockAddRequest=Base&{kind:'stock-add';rows:{itemId:string;itemName:string;deltaQty:number;unitKg:number;note:string}[]};
export type CanUnpackRequest=Base&{kind:'can-unpack';plan:UnpackPlan};
export type BoxUnpackRequest=Base&{kind:'box-unpack';boxItemId:string;unitItemId:string;boxItemName?:string;unitItemName?:string;count:number;unitKg:number};
export type ItemInventoryRequest=ItemStockAddRequest|CanUnpackRequest|BoxUnpackRequest;
export type ItemInventoryKind=ItemInventoryRequest['kind'];
export type ItemInventoryRetained={request:ItemInventoryRequest;state:'prepared'|'submitted';encoded:string;storageKey?:string;copies?:{key:string;encoded:string}[]};
export type ItemInventoryOutcome={ok:boolean;message:string;status:'applied'|'duplicate'|'rejected'|'unknown'|'blocked';retainPending:boolean};
type Initial<T>=T extends Base?Omit<T,'version'|'operationId'|'capturedAt'|'date'>&{operationId?:string}:never;
const kinds=['stock-add','can-unpack','box-unpack'];
export class ItemInventoryRejected extends Error {}
export const rejectItemInventory=(message:string):never=>{throw new ItemInventoryRejected(message);};
export function prepareItemInventory<T>(calculate:()=>T):T{try{return calculate();}catch(error){throw new ItemInventoryRejected(error instanceof Error?error.message:String(error));}}
/** SDK 제한보다 보수적인 문서/전체 요청 예산이며 분할 쓰기로 우회하지 않는다. */
export function assertItemInventoryWriteBudget(documents:readonly unknown[]):void{const finite=(value:unknown):void=>{if(typeof value==='number'&&!Number.isFinite(value))rejectItemInventory('재고 계산 결과가 유한하지 않아 저장하지 않았습니다.');if(Array.isArray(value))value.forEach(finite);else if(value&&typeof value==='object')Object.values(value).forEach(finite);};documents.forEach(finite);const sizes=documents.map(value=>new TextEncoder().encode(JSON.stringify(value)).byteLength);if(documents.length>500||sizes.some(size=>size>900_000)||sizes.reduce((sum,size)=>sum+size,0)>8_000_000)rejectItemInventory('재고 작업의 문서 또는 전체 쓰기 저장 한도를 초과했습니다.');}
const id=(v:unknown)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=512&&!v.includes('/');
export const itemInventoryRequestText=(request:ItemInventoryRequest)=>rawPressText(request);
export const itemInventoryResultText=(result:unknown)=>rawPressText(result);
export const itemInventoryRequestHash=async(request:ItemInventoryRequest)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(itemInventoryRequestText(request)))),b=>b.toString(16).padStart(2,'0')).join('');
export function validateItemInventoryRequest(request:ItemInventoryRequest):void{
 const walk=(v:unknown):void=>{if(v===null||typeof v==='string'||typeof v==='boolean')return;if(typeof v==='number'&&Number.isFinite(v))return;if(Array.isArray(v)){v.forEach(walk);return;}if(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype){Object.values(v).forEach(walk);return;}throw Error('재고 요청은 유한한 JSON 원문이어야 합니다.');};walk(request);
 if(request.version!==1||!kinds.includes(request.kind)||!['taebaek','punghoe'].includes(request.companyId)||!id(request.uid)||!id(request.operationId)||typeof request.capturedAt!=='string'||!Number.isFinite(Date.parse(request.capturedAt))||request.capturedAt!==new Date(request.capturedAt).toISOString()||!isCalendarDay(request.date))throw Error('재고 요청의 회사·로그인·최초 시각을 확인해 주세요.');
 const base=['version','operationId','companyId','uid','capturedAt','date','kind'];
 const extras=request.kind==='stock-add'?['rows']:request.kind==='can-unpack'?['plan']:['boxItemId','unitItemId','boxItemName','unitItemName','count','unitKg'];
 if(Object.keys(request).some(key=>!base.concat(extras).includes(key)))throw Error('재고 요청의 알 수 없는 원문 필드입니다.');
 if(request.kind==='stock-add'){
  if(!Array.isArray(request.rows)||!request.rows.length||request.rows.length+1>500||new Set(request.rows.map(row=>row.itemId)).size!==request.rows.length||request.rows.some(row=>!id(row.itemId)||typeof row.itemName!=='string'||!row.itemName.trim()||!Number.isFinite(row.deltaQty)||row.deltaQty<=0||!Number.isFinite(row.unitKg)||row.unitKg<0||typeof row.note!=='string'||Object.keys(row).some(key=>!['itemId','itemName','deltaQty','unitKg','note'].includes(key))))throw Error('추가할 전체 품목·수량을 확인해 주세요.');
 }else if(request.kind==='can-unpack'){
  const p=request.plan;if(!p||!id(p.canItemId)||!id(p.bulkItemId)||p.canItemId===p.bulkItemId||typeof p.canName!=='string'||!p.canName.trim()||typeof p.bulkName!=='string'||!p.bulkName.trim()||typeof p.bulkUnit!=='string'||!p.bulkUnit.trim()||!Number.isFinite(p.cans)||p.cans<1||!Number.isFinite(p.perCan)||p.perCan<=0||p.bulkQty!==Math.round(p.cans*p.perCan*1000)/1000||!Number.isFinite(p.bulkQty)||!Array.isArray(p.discarded)||Object.keys(p).some(key=>!['canItemId','canName','cans','bulkItemId','bulkName','bulkUnit','perCan','bulkQty','discarded'].includes(key))||p.discarded.some(row=>!id(row.itemId)||typeof row.name!=='string'||!row.name.trim()||!Number.isFinite(row.qty)||row.qty<=0||Object.keys(row).some(key=>!['itemId','name','qty'].includes(key))))throw Error('캔 개봉의 최초 품목·수량을 확인해 주세요.');
 }else if(!id(request.boxItemId)||!id(request.unitItemId)||request.boxItemId===request.unitItemId||!Number.isSafeInteger(request.count)||request.count<1||!Number.isFinite(request.unitKg)||request.unitKg<0||request.boxItemName!==undefined&&(typeof request.boxItemName!=='string'||!request.boxItemName.trim())||request.unitItemName!==undefined&&(typeof request.unitItemName!=='string'||!request.unitItemName.trim()))throw Error('박스 개봉의 최초 품목·수량을 확인해 주세요.');
 if(new TextEncoder().encode(JSON.stringify(request)).byteLength>700_000)throw Error('재고 요청 원문의 저장 한도를 초과했습니다.');
}
export const itemInventoryAttemptKey=(companyId:CompanyId,uid:string,kind:ItemInventoryKind)=>{if(!['taebaek','punghoe'].includes(companyId)||!id(uid)||!kinds.includes(kind))throw Error('재고 요청 범위를 확인해 주세요.');return `item-inventory:${companyId}:${encodeURIComponent(uid)}:${kind}`;};
export type ItemInventoryEntry={key:string;retained:ItemInventoryRetained|null;error:string;deleted:boolean};
export class ItemInventoryConflictError extends Error {constructor(public entries:ItemInventoryEntry[]){super('같은 품목의 이전 처리 결과를 확인해야 합니다. 실패 작업에서 최초 요청을 확인해 주세요.');}}
const operationKey=(r:ItemInventoryRequest)=>`item-inventory-v2:${r.companyId}:${encodeURIComponent(r.uid)}:${encodeURIComponent(r.operationId)}`;
const attemptScopes=new Map<string,()=>boolean>();
/** 서비스 계산은 바꾸지 않고 화면의 실제 UID·회사·세션 검사만 같은 최초 요청에 연결한다. */
export function bindItemInventoryAttemptScope(request:ItemInventoryRequest,current:()=>boolean):()=>void{const key=operationKey(request);if(attemptScopes.has(key)||!current())throw Error('같은 재고 요청을 확인 중이거나 화면이 변경되었습니다.');attemptScopes.set(key,current);return()=>{if(attemptScopes.get(key)===current)attemptScopes.delete(key);};}
const stateKey=(key:string)=>`item-inventory-state:${encodeURIComponent(key)}`;
const copiesOf=(retained:ItemInventoryRetained)=>retained.copies??[{key:retained.storageKey??itemInventoryAttemptKey(retained.request.companyId,retained.request.uid,retained.request.kind),encoded:retained.encoded}];
export const itemInventoryTargets=(r:ItemInventoryRequest):string[]=>r.kind==='stock-add'?r.rows.map(row=>row.itemId):r.kind==='box-unpack'?[r.boxItemId,r.unitItemId]:[r.plan.canItemId,r.plan.bulkItemId];
export function listItemInventoryAttempts(companyId:CompanyId,uid:string):ItemInventoryEntry[]{
 itemInventoryAttemptKey(companyId,uid,'stock-add');const prefix=`item-inventory-v2:${companyId}:${encodeURIComponent(uid)}:`;
 const keys=Object.keys(localStorage).filter(key=>key.startsWith(prefix)||kinds.some(kind=>key===itemInventoryAttemptKey(companyId,uid,kind as ItemInventoryKind))).sort(),entries:ItemInventoryEntry[]=[];
 for(const key of keys){const encoded=localStorage.getItem(key);if(encoded===null)continue;
  try{const value=JSON.parse(encoded);validateItemInventoryRequest(value.request);const r=value.request as ItemInventoryRequest;if(r.companyId!==companyId||r.uid!==uid||!['prepared','submitted'].includes(value.state)||Object.keys(value).some(k=>!['request','state'].includes(k))||key!==(key.startsWith(prefix)?operationKey(r):itemInventoryAttemptKey(companyId,uid,r.kind)))throw Error();
   let deleted=false;try{const marker=JSON.parse(localStorage.getItem(stateKey(key))??'null');deleted=marker?.deleted===true&&marker.encoded===encoded;}catch{/* 표식 손상은 숨김 근거가 아니다. */}
   const same=entries.find(entry=>entry.retained&&itemInventoryRequestText(entry.retained.request)===itemInventoryRequestText(r));
   if(same?.retained){same.retained.copies!.push({key,encoded});same.deleted=same.deleted&&deleted;if(value.state==='submitted'){same.retained.state='submitted';same.retained.encoded=encoded;same.retained.storageKey=key;}}
   else entries.push({key,retained:{request:r,state:value.state,encoded,storageKey:key,copies:[{key,encoded}]},deleted,error:''});
  }catch{entries.push({key,retained:null,deleted:false,error:'보존된 재고 요청이 손상됐습니다. 원문은 삭제하지 않았습니다.'});}
 }return entries;
}
export function itemInventoryConflicts(entries:ItemInventoryEntry[],request:ItemInventoryRequest):ItemInventoryEntry[]{const targets=itemInventoryTargets(request);return entries.filter(entry=>!entry.retained||entry.retained.request.operationId===request.operationId&&itemInventoryRequestText(entry.retained.request)!==itemInventoryRequestText(request)||entry.retained.request.operationId!==request.operationId&&itemInventoryTargets(entry.retained.request).some(target=>targets.includes(target)));}
async function inventoryLock<T>(companyId:CompanyId,uid:string,current:()=>boolean,work:()=>T|Promise<T>):Promise<T>{
 if(!current())throw Error('회사 또는 로그인 사용자가 변경되었습니다.');if(typeof navigator==='undefined'||!navigator.locks?.request)throw Error('이 브라우저는 창 간 안전 잠금을 지원하지 않습니다. 지원되는 브라우저에서 진행해 주세요.');
 return navigator.locks.request(`item-inventory-lock:${companyId}:${encodeURIComponent(uid)}`,{mode:'exclusive'},async()=>{if(!current())throw Error('회사 또는 로그인 사용자가 변경되었습니다.');return work();});
}
export async function beginNewItemInventoryAttempt(input:Initial<ItemInventoryRequest>,current:()=>boolean):Promise<ItemInventoryRetained>{
 const candidate={...input,version:1,operationId:input.operationId??`item-${input.kind}-${crypto.randomUUID()}`,capturedAt:new Date().toISOString(),date:today()} as ItemInventoryRequest;validateItemInventoryRequest(candidate);const request=JSON.parse(JSON.stringify(candidate)) as ItemInventoryRequest;
 return inventoryLock(request.companyId,request.uid,current,()=>{const entries=listItemInventoryAttempts(request.companyId,request.uid),conflicts=itemInventoryConflicts(entries,request);if(conflicts.length)throw new ItemInventoryConflictError(conflicts);
  if(entries.some(entry=>entry.retained?.request.operationId===request.operationId))throw Error('같은 작업의 최초 원문이 이미 있습니다. 결과를 확인해 주세요.');
  const key=operationKey(request),encoded=JSON.stringify({request,state:'prepared'});if(localStorage.getItem(key)!==null)throw Error('다른 창의 최초 원문을 보존했습니다.');localStorage.setItem(key,encoded);if(!current()||localStorage.getItem(key)!==encoded)throw Error('최초 재고 요청 저장을 확인하지 못했습니다. 원문을 보존했습니다.');return {request,state:'prepared',encoded,storageKey:key,copies:[{key,encoded}]};});
}
export async function deleteItemInventoryAttempt(retained:ItemInventoryRetained,current:()=>boolean):Promise<void>{const r=retained.request;await inventoryLock(r.companyId,r.uid,current,()=>{assertItemInventoryAttempt(retained);for(const copy of copiesOf(retained)){if(!current())throw Error('로그인 또는 회사가 변경되었습니다.');const marker=JSON.stringify({deleted:true,encoded:copy.encoded});localStorage.setItem(stateKey(copy.key),marker);if(localStorage.getItem(stateKey(copy.key))!==marker)throw Error('실패 요청 삭제를 확인하지 못했습니다.');}assertItemInventoryAttempt(retained);});}
export async function cancelPreparedItemInventoryAttempt(retained:ItemInventoryRetained,current:()=>boolean):Promise<void>{if(retained.state!=='prepared')throw Error('제출된 요청은 취소하지 않습니다.');await inventoryLock(retained.request.companyId,retained.request.uid,current,()=>clearItemInventoryAttempt(retained));}
export function readItemInventoryAttempt(companyId:CompanyId,uid:string,kind:ItemInventoryKind):ItemInventoryRetained|null{
 const encoded=localStorage.getItem(itemInventoryAttemptKey(companyId,uid,kind));if(encoded===null)return null;
 try{const value=JSON.parse(encoded);validateItemInventoryRequest(value.request);if(!['prepared','submitted'].includes(value.state)||Object.keys(value).some(key=>!['request','state'].includes(key))||value.request.companyId!==companyId||value.request.uid!==uid||value.request.kind!==kind)throw Error();return {...value,encoded};}catch{throw Error('보존된 재고 요청이 손상됐습니다. 원문은 삭제하지 않았습니다.');}
}
export function beginItemInventoryAttempt(input:Initial<ItemInventoryRequest>):ItemInventoryRetained{
 const previous=readItemInventoryAttempt(input.companyId,input.uid,input.kind);if(previous)return previous;
 const request={...input,version:1,operationId:input.operationId??`item-${input.kind}-${crypto.randomUUID()}`,capturedAt:new Date().toISOString(),date:today()} as ItemInventoryRequest;validateItemInventoryRequest(request);
 const encoded=JSON.stringify({request,state:'prepared'}),key=itemInventoryAttemptKey(request.companyId,request.uid,request.kind);if(localStorage.getItem(key)!==null)throw Error('다른 창의 최초 재고 요청을 보존했습니다.');localStorage.setItem(key,encoded);return {request,state:'prepared',encoded};
}
export function assertItemInventoryAttempt(retained:ItemInventoryRetained):void{if(copiesOf(retained).some(copy=>localStorage.getItem(copy.key)!==copy.encoded))throw Error('최초 재고 요청이 바뀌었습니다. 현재 원문을 보존했습니다.');}
export function clearItemInventoryAttempt(retained:ItemInventoryRetained):void{assertItemInventoryAttempt(retained);for(const copy of copiesOf(retained)){localStorage.removeItem(copy.key);const marker=localStorage.getItem(stateKey(copy.key));try{if(marker&&JSON.parse(marker).encoded===copy.encoded)localStorage.removeItem(stateKey(copy.key));}catch{/* 손상 표식 보존 */}}}
const running=new Set<string>();
/** 최초 제출만 실행하고 이후에는 영수증을 확인한다. 응답 유실을 쓰기0으로 추정하지 않는다. */
export async function runItemInventoryAttempt(request:ItemInventoryRequest,actor:()=>Promise<void>,execute:(mode:'apply'|'inspect',check:()=>Promise<void>,first:ItemInventoryRequest)=>Promise<ItemInventoryOutcome>):Promise<ItemInventoryOutcome>{
 try{validateItemInventoryRequest(request);request=JSON.parse(JSON.stringify(request)) as ItemInventoryRequest;}catch(error){return {ok:false,status:'unknown',retainPending:true,message:error instanceof Error?error.message:String(error)};}
 const key=operationKey(request);if(running.has(key))return {ok:false,status:'blocked',retainPending:true,message:'같은 재고 요청을 확인 중입니다.'};running.add(key);
 try{
  validateItemInventoryRequest(request);const entries=listItemInventoryAttempts(request.companyId,request.uid);if(entries.some(entry=>entry.retained?.request.operationId===request.operationId&&itemInventoryRequestText(entry.retained.request)!==itemInventoryRequestText(request)))throw Error('같은 작업의 최초 원문이 다릅니다.');let retained=entries.find(entry=>entry.retained&&itemInventoryRequestText(entry.retained.request)===itemInventoryRequestText(request))?.retained;if(!retained)throw Error('보존된 최초 재고 요청으로 다시 확인해 주세요.');
  const first=JSON.parse(JSON.stringify(retained.request)) as ItemInventoryRequest;
  const mode=retained.state==='prepared'?'apply':'inspect';assertItemInventoryAttempt(retained);
  const current=attemptScopes.get(key)??(()=>true);
  const check=async()=>{if(!current())throw Error('회사 또는 로그인 사용자가 변경되었습니다.');assertItemInventoryAttempt(retained!);await actor();if(!current())throw Error('회사 또는 로그인 사용자가 변경되었습니다.');assertItemInventoryAttempt(retained!);};await check();
  const locked=async<T>(work:()=>T)=>retained!.storageKey?.startsWith('item-inventory-v2:')||typeof navigator!=='undefined'&&typeof navigator.locks?.request==='function'?inventoryLock(request.companyId,request.uid,current,work):work();
  if(mode==='apply')await locked(()=>{assertItemInventoryAttempt(retained!);const fresh=listItemInventoryAttempts(request.companyId,request.uid);if(itemInventoryConflicts(fresh,request).length)throw Error('같은 품목의 이전 처리 결과를 확인해 주세요.');const encoded=JSON.stringify({request:retained!.request,state:'submitted'}),copies=copiesOf(retained!).map(copy=>{localStorage.setItem(copy.key,encoded);if(localStorage.getItem(copy.key)!==encoded)throw Error('제출 원문 저장을 확인하지 못했습니다.');return {key:copy.key,encoded};});retained={...retained!,state:'submitted',encoded,copies};});
  await check();const result=await execute(mode,check,first);await check();
  if(result.ok&&['applied','duplicate'].includes(result.status)||result.status==='rejected'&&mode==='apply'){await locked(()=>clearItemInventoryAttempt(retained!));return {...result,retainPending:false};}return {...result,retainPending:true};
 }catch(error){return {ok:false,status:'unknown',retainPending:true,message:error instanceof Error?error.message:String(error)};}finally{running.delete(key);}
}
