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
export type ItemInventoryRetained={request:ItemInventoryRequest;state:'prepared'|'submitted';encoded:string};
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
export function readItemInventoryAttempt(companyId:CompanyId,uid:string,kind:ItemInventoryKind):ItemInventoryRetained|null{
 const encoded=localStorage.getItem(itemInventoryAttemptKey(companyId,uid,kind));if(encoded===null)return null;
 try{const value=JSON.parse(encoded);validateItemInventoryRequest(value.request);if(!['prepared','submitted'].includes(value.state)||Object.keys(value).some(key=>!['request','state'].includes(key))||value.request.companyId!==companyId||value.request.uid!==uid||value.request.kind!==kind)throw Error();return {...value,encoded};}catch{throw Error('보존된 재고 요청이 손상됐습니다. 원문은 삭제하지 않았습니다.');}
}
export function beginItemInventoryAttempt(input:Initial<ItemInventoryRequest>):ItemInventoryRetained{
 const previous=readItemInventoryAttempt(input.companyId,input.uid,input.kind);if(previous)return previous;
 const request={...input,version:1,operationId:input.operationId??`item-${input.kind}-${crypto.randomUUID()}`,capturedAt:new Date().toISOString(),date:today()} as ItemInventoryRequest;validateItemInventoryRequest(request);
 const encoded=JSON.stringify({request,state:'prepared'}),key=itemInventoryAttemptKey(request.companyId,request.uid,request.kind);if(localStorage.getItem(key)!==null)throw Error('다른 창의 최초 재고 요청을 보존했습니다.');localStorage.setItem(key,encoded);return {request,state:'prepared',encoded};
}
export function assertItemInventoryAttempt(retained:ItemInventoryRetained):void{const r=retained.request;if(localStorage.getItem(itemInventoryAttemptKey(r.companyId,r.uid,r.kind))!==retained.encoded)throw Error('최초 재고 요청이 바뀌었습니다. 현재 원문을 보존했습니다.');}
export function clearItemInventoryAttempt(retained:ItemInventoryRetained):void{assertItemInventoryAttempt(retained);const r=retained.request;localStorage.removeItem(itemInventoryAttemptKey(r.companyId,r.uid,r.kind));}
const running=new Set<string>();
/** 최초 제출만 실행하고 이후에는 영수증을 확인한다. 응답 유실을 쓰기0으로 추정하지 않는다. */
export async function runItemInventoryAttempt(request:ItemInventoryRequest,actor:()=>Promise<void>,execute:(mode:'apply'|'inspect',check:()=>Promise<void>,first:ItemInventoryRequest)=>Promise<ItemInventoryOutcome>):Promise<ItemInventoryOutcome>{
 const key=itemInventoryAttemptKey(request.companyId,request.uid,request.kind);if(running.has(key))return {ok:false,status:'blocked',retainPending:true,message:'같은 재고 요청을 확인 중입니다.'};running.add(key);
 try{
  validateItemInventoryRequest(request);let retained=readItemInventoryAttempt(request.companyId,request.uid,request.kind);if(!retained||itemInventoryRequestText(retained.request)!==itemInventoryRequestText(request))throw Error('보존된 최초 재고 요청으로 다시 확인해 주세요.');
  const first=JSON.parse(JSON.stringify(retained.request)) as ItemInventoryRequest;
  const mode=retained.state==='prepared'?'apply':'inspect';assertItemInventoryAttempt(retained);
  const check=async()=>{assertItemInventoryAttempt(retained!);await actor();assertItemInventoryAttempt(retained!);};await check();
  if(mode==='apply'){const encoded=JSON.stringify({request:retained.request,state:'submitted'});localStorage.setItem(key,encoded);retained={request:retained.request,state:'submitted',encoded};}
  await check();const result=await execute(mode,check,first);await check();
  if(result.ok&&['applied','duplicate'].includes(result.status)||result.status==='rejected'&&mode==='apply'){clearItemInventoryAttempt(retained);return {...result,retainPending:false};}return {...result,retainPending:true};
 }catch(error){return {ok:false,status:'unknown',retainPending:true,message:error instanceof Error?error.message:String(error)};}finally{running.delete(key);}
}
