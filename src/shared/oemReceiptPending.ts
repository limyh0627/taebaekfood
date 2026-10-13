import type {CompanyId,PurchaseOrder} from './types';
import type {OemCostEvidence} from './oemBatchCost';
export type OemReceiptScope={companyId:CompanyId;actorUid:string;poId:string};
export type OemReceiptRequest={poId:string;operationId:string;date:string;returns:{itemId:string;qty:number}[];
 unitPricePerKg?:number;oemCostEvidence?:OemCostEvidence;bulk?:{material:string;kg:number;rawItemId?:string}[];releaseId:string};
export type OemReceiptDraft={po:PurchaseOrder;returns:{itemId:string;qty:number}[];bulk:{material:string;kg:number}[];unitPricePerKg:number;date:string;oemCostEvidence?:OemCostEvidence};
type DraftRecord=OemReceiptScope&{version:1;input:OemReceiptDraft};
type PacketRecord=OemReceiptScope&{version:1;request:OemReceiptRequest};
export type OemReceiptEntry={scope:OemReceiptScope;draft:DraftRecord|null;packet:PacketRecord|null;draftText:string|null;packetText:string|null;legacyText:string|null;deleted:boolean;legacy:boolean;error:string};
const id=(value:unknown):value is string=>typeof value==='string'&&!!value.trim()&&!value.includes('/');
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function fail(message:string):never{throw Error(message);}
function assertScope(scope:OemReceiptScope){if(!['taebaek','punghoe'].includes(scope.companyId)||!id(scope.actorUid)||!id(scope.poId))fail('입고 요청의 회사·로그인 계정·배치를 확인해 주세요.');}
const suffix=(scope:OemReceiptScope)=>`${scope.companyId}:${encodeURIComponent(scope.actorUid)}:${encodeURIComponent(scope.poId)}`;
export const oemReceiptDraftKey=(scope:OemReceiptScope)=>'oem-receipt-draft-v1:'+suffix(scope);
export const oemReceiptPacketKey=(scope:OemReceiptScope)=>'oem-receipt-packet-v1:'+suffix(scope);
const stateKey=(scope:OemReceiptScope)=>'oem-receipt-state-v1:'+suffix(scope);
const legacyKey=(scope:OemReceiptScope)=>'oem-receipt-pending:'+scope.companyId+':'+scope.poId;
function legacyText(scope:OemReceiptScope):string|null{return sessionStorage.getItem(legacyKey(scope))??localStorage.getItem(legacyKey(scope));}
const ownersMatch=(row:any,scope:OemReceiptScope)=>row?.version===1&&row.companyId===scope.companyId&&row.actorUid===scope.actorUid&&row.poId===scope.poId;
function readRecord<T>(key:string,scope:OemReceiptScope,accept:(row:any)=>boolean):{value:T|null;text:string|null}{
 const text=localStorage.getItem(key);if(text===null)return {value:null,text};
 try{const row=JSON.parse(text);if(!ownersMatch(row,scope)||!accept(row))throw Error();return {value:row,text};}
 catch{fail('저장된 OEM 입고 원문이 손상되었거나 계정·회사·배치가 다릅니다. 원문을 보존했습니다.');}
}
const draftValid=(row:any)=>row?.input?.po?.id===row.poId&&(row.input.po.companyId??'taebaek')===row.companyId
 &&Array.isArray(row.input.returns)&&Array.isArray(row.input.bulk)&&typeof row.input.date==='string'&&Number.isFinite(row.input.unitPricePerKg);
const packetValid=(row:any)=>row?.request?.poId===row.poId&&row.request.operationId==='oem-receive:'+row.poId
 &&id(row.request.releaseId)&&typeof row.request.date==='string'&&Array.isArray(row.request.returns)
 &&row.request.returns.every((line:any)=>id(line?.itemId)&&Number.isFinite(line.qty)&&line.qty>0)
 &&(row.request.bulk===undefined||Array.isArray(row.request.bulk)&&row.request.bulk.every((line:any)=>typeof line?.material==='string'&&!!line.material.trim()&&id(line.rawItemId)&&Number.isFinite(line.kg)&&line.kg>0));
export function readOemReceiptEntry(scope:OemReceiptScope):OemReceiptEntry{
 assertScope(scope);const old=legacyText(scope);
 const draft=readRecord<DraftRecord>(oemReceiptDraftKey(scope),scope,draftValid),packet=readRecord<PacketRecord>(oemReceiptPacketKey(scope),scope,packetValid);
 let marker:any=null;try{marker=JSON.parse(localStorage.getItem(stateKey(scope))??'null');}catch{/* 손상된 상태 표식으로 원문을 숨기지 않는다. */}
 const current=ownersMatch(marker,scope)&&marker.draftText===draft.text&&marker.packetText===packet.text&&marker.legacyText===old;
 return {scope,draft:draft.value,packet:packet.value,draftText:draft.text,packetText:packet.text,legacyText:old,legacy:old!==null,
  deleted:!!current&&marker.deleted===true,error:current&&typeof marker.error==='string'?marker.error:''};
}
export function listOemReceiptEntries(companyId:CompanyId,actorUid:string):OemReceiptEntry[]{
 const poIds=new Set<string>();
 for(const prefix of ['oem-receipt-draft-v1:','oem-receipt-packet-v1:']){
  const start=prefix+companyId+':'+encodeURIComponent(actorUid)+':';
  for(const key of Object.keys(localStorage).filter(key=>key.startsWith(start)))try{poIds.add(decodeURIComponent(key.slice(start.length)));}catch{/* 판독할 수 없는 키는 삭제하지 않는다. */}
 }
 const old='oem-receipt-pending:'+companyId+':';
 for(const store of [sessionStorage,localStorage])for(const key of Object.keys(store).filter(key=>key.startsWith(old)))poIds.add(key.slice(old.length));
 return [...poIds].map(poId=>{const scope={companyId,actorUid,poId};try{return readOemReceiptEntry(scope);}catch(error){return {scope,draft:null,packet:null,draftText:localStorage.getItem(oemReceiptDraftKey(scope)),packetText:localStorage.getItem(oemReceiptPacketKey(scope)),legacyText:legacyText(scope),legacy:legacyText(scope)!==null,deleted:false,error:error instanceof Error?error.message:String(error)};}});
}
export async function withOemReceiptLock<T>(scope:OemReceiptScope,work:()=>T|Promise<T>,isCurrent:()=>boolean):Promise<T>{
 assertScope(scope);if(!isCurrent())fail('입고 요청의 로그인 계정이나 회사가 변경되었습니다.');
 if(typeof navigator==='undefined'||!navigator.locks?.request)fail('이 브라우저는 안전한 창 간 잠금을 지원하지 않습니다. 지원되는 브라우저에서 입고 요청을 확인해 주세요.');
 return navigator.locks.request('oem-receipt-lock:'+scope.companyId+':'+scope.actorUid,{mode:'exclusive'},async()=>{
  if(!isCurrent())fail('입고 요청의 로그인 계정이나 회사가 변경되었습니다.');return work();
 });
}
function assertNewAllowed(entry:OemReceiptEntry){
 if(entry.legacy)fail('과거 입고 요청의 최초 계정과 송신 원문을 확인할 수 없습니다. 같은 배치의 입고 이력·재고를 확인해 주세요. 원문은 보존했습니다.');
 if(entry.deleted)fail('이 배치의 이전 입고 결과가 아직 확인되지 않아 새 입고를 막았습니다. 배치 입고 이력과 원료·완제품 재고를 확인해 주세요.');
}
export async function storeOemReceiptDraft(scope:OemReceiptScope,input:OemReceiptDraft,isCurrent:()=>boolean):Promise<OemReceiptEntry>{
 return withOemReceiptLock(scope,()=>{
  const entry=readOemReceiptEntry(scope);assertNewAllowed(entry);
  if(entry.draft){if(!same(entry.draft.input,input))fail('이 배치의 최초 입고 입력이 다릅니다. 실패 작업에서 같은 요청을 확인해 주세요.');return entry;}
  if(entry.packet)fail('이 배치의 최초 송신 요청이 남아 있습니다. 실패 작업에서 동일 요청으로 확인해 주세요.');
  const row={version:1,...scope,input},text=JSON.stringify(row);if(!draftValid(JSON.parse(text)))fail('입고 초안의 배치·수량·날짜를 확인해 주세요.');
  localStorage.setItem(oemReceiptDraftKey(scope),text);
  if(localStorage.getItem(oemReceiptDraftKey(scope))!==text||!isCurrent())fail('입고 원문 저장을 확인하지 못했습니다. 기록은 보존했습니다.');
  return readOemReceiptEntry(scope);
 },isCurrent);
}
export async function pinOemReceiptPacket(scope:OemReceiptScope,request:OemReceiptRequest,isCurrent:()=>boolean):Promise<OemReceiptEntry>{
 return withOemReceiptLock(scope,()=>{
  const entry=readOemReceiptEntry(scope);assertNewAllowed(entry);
  if(entry.packet){if(!same(entry.packet.request,request))fail('이 배치의 최초 송신 원문이 다릅니다. 원문을 보존했습니다.');return entry;}
  const row={version:1,...scope,request},text=JSON.stringify(row);if(!packetValid(JSON.parse(text)))fail('OEM 입고 송신 요청의 배치·품목·원료 홀더를 확인해 주세요.');
  localStorage.setItem(oemReceiptPacketKey(scope),text);
  if(localStorage.getItem(oemReceiptPacketKey(scope))!==text||!isCurrent())fail('최초 OEM 송신 원문 저장을 확인하지 못했습니다.');
  return readOemReceiptEntry(scope);
 },isCurrent);
}
const acknowledgements=new Map<string,string>();
/** 실제 callable 응답을 검증한 서비스만 완료 승인을 기록한다. 저장된 임의 상태 필드는 완료 증거가 아니다. */
export function acknowledgeOemReceiptPacket(entry:OemReceiptEntry){if(entry.packetText)acknowledgements.set(oemReceiptPacketKey(entry.scope),entry.packetText);}
export async function clearOemReceiptAttempt(entry:OemReceiptEntry,isCurrent:()=>boolean):Promise<void>{
 await withOemReceiptLock(entry.scope,()=>{
  const current=readOemReceiptEntry(entry.scope);
  if(current.legacy||current.draftText!==entry.draftText||current.packetText!==entry.packetText)fail('보존된 요청이 변경되었습니다. 원문을 유지했습니다. 다시 열어 확인해 주세요.');
  const key=oemReceiptPacketKey(entry.scope);
  if(current.packetText&&acknowledgements.get(key)!==current.packetText)fail('입고 완료 응답이 확인되지 않아 원문을 유지했습니다.');
  if(!isCurrent())fail('입고 요청의 로그인 계정이나 회사가 변경되었습니다.');
  if(current.packetText)localStorage.removeItem(key);
  if(current.draftText)localStorage.removeItem(oemReceiptDraftKey(entry.scope));
  localStorage.removeItem(stateKey(entry.scope));acknowledgements.delete(key);
 },isCurrent);
}
export async function markOemReceiptFailure(entry:OemReceiptEntry,error:string,deleted:boolean,isCurrent:()=>boolean):Promise<void>{
 await withOemReceiptLock(entry.scope,()=>{
  const current=readOemReceiptEntry(entry.scope),old=legacyText(entry.scope);
  if(current.draftText!==entry.draftText||current.packetText!==entry.packetText||current.legacyText!==entry.legacyText)fail('보존된 입고 원문이 변경되어 요청 상태를 바꾸지 않았습니다.');
  if(!current.draft&&!current.packet&&!current.legacy)fail('보존된 입고 요청을 확인할 수 없습니다.');
  const text=JSON.stringify({version:1,...entry.scope,draftText:current.draftText,packetText:current.packetText,legacyText:old,error,deleted});
  localStorage.setItem(stateKey(entry.scope),text);
  if(localStorage.getItem(stateKey(entry.scope))!==text||!isCurrent())fail('실패 요청 상태 저장을 확인하지 못했습니다. 원문을 보존했습니다.');
 },isCurrent);
}
const preCallFailures=new WeakMap<object,OemReceiptScope>();
export function markOemReceiptPreCallFailure(error:unknown,scope:OemReceiptScope):void{if(error&&typeof error==='object')preCallFailures.set(error,scope);}
export function isOemReceiptPreCallFailure(error:unknown,scope:OemReceiptScope):boolean{return !!error&&typeof error==='object'&&same(preCallFailures.get(error),scope);}
