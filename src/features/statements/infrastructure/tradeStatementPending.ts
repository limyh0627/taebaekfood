import {recoveryKeyIdentity,validateTradeStatementDraft} from '../domain/tradeStatementRecovery';
import type {CompanyId,IssuedStatement,PurchaseUnitSnapshot} from '../../../shared/types';
import type {StatementCommand} from '../domain/statementCommand';
import {isCalendarDay} from '../../../shared/day';
export type TradeStatementDraft={command:StatementCommand;statement:IssuedStatement;costUpdates:{itemId:string;price:number;beforeCost?:number;sourceLineIndex?:number;sourceLineIndices?:number[]}[];poIds:string[];newPoItems:({itemId:string;itemName:string;quantity:number;isBox:boolean;unit:string;sourceLineIndex?:number}&Partial<PurchaseUnitSnapshot>)[]};
export type TradeStatementPending={version:1;companyId:CompanyId;userId:string;input:TradeStatementDraft;payment?:{amount:number;cashAccountId:string;date:string}};
export const tradePendingKey=(companyId:CompanyId,userId:string,statementId?:string)=>statementId===undefined
 ?`trade-statement-issue:${companyId}:${userId}`:`trade-statement-issue-v2:${companyId}:${encodeURIComponent(userId)}:${encodeURIComponent(statementId)}`;
export const tradeRequestKey=(companyId:CompanyId,userId:string,operationId?:string)=>operationId===undefined
 ?`trade-statement-request:${companyId}:${userId}`:`trade-statement-request-v2:${companyId}:${encodeURIComponent(userId)}:${encodeURIComponent(operationId)}`;
export function readTradePending(key:string,companyId:CompanyId,userId:string):TradeStatementPending|null {
 const text=localStorage.getItem(key);if(text===null)return null;return parseTradePending(text,companyId,userId);
}
function parseTradePending(text:string,companyId:CompanyId,userId:string,allowZeroRecovery=false):TradeStatementPending {
 try {const p=JSON.parse(text) as TradeStatementPending;const i=p.input,s=i?.statement;
 if(!['taebaek','punghoe'].includes(companyId)||!userId||p.version!==1||p.companyId!==companyId||p.userId!==userId||!s||s.companyId!==companyId||typeof s.id!=='string'||!s.id||s.id.includes('/')||i.command?.statementId!==s.id||typeof i.command.operationId!=='string'||!i.command.operationId||i.command.operationId.includes('/')||typeof s.partnerName!=='string'||typeof s.partnerId!=='string'||!Array.isArray(i.command.orderIds)||i.command.orderIds.some(id=>typeof id!=='string')||!Array.isArray(i.command.lines)||!['매출','매입','비용'].includes(s.type)||!isCalendarDay(s.tradeDate)||!Array.isArray(s.items)||!s.items.length||s.items.some(line=>!line||typeof line.name!=='string'||!Number.isFinite(line.total))||!Number.isSafeInteger(s.totalAmount)||(s.totalAmount<0||s.totalAmount===0&&!allowZeroRecovery)||!Array.isArray(i.poIds)||i.poIds.some(id=>typeof id!=='string')||!Array.isArray(i.costUpdates)||i.costUpdates.some(c=>typeof c.itemId!=='string'||!Number.isFinite(c.price))||!Array.isArray(i.newPoItems)||i.newPoItems.some(c=>typeof c.itemId!=='string'||!Number.isFinite(c.quantity)||c.quantity<=0)||p.payment&&(!Number.isSafeInteger(p.payment.amount)||p.payment.amount<=0||typeof p.payment.cashAccountId!=='string'||!p.payment.cashAccountId||!isCalendarDay(p.payment.date)))throw Error();
 return p;}catch {throw new Error('저장 중이던 전표 내용을 확인해야 합니다. 원문은 보존했습니다.');}
}
export function storeTradePending(key:string,p:TradeStatementPending):string {const text=JSON.stringify(p);parseTradePending(text,p.companyId,p.userId);if(key!==tradePendingKey(p.companyId,p.userId)&&key!==tradePendingKey(p.companyId,p.userId,p.input.statement.id))throw new Error('전표 원문과 저장 키가 다릅니다.');const old=localStorage.getItem(key);if(old!==null&&old!==text)throw new Error('이전에 저장 중이던 전표를 먼저 재시도해 주세요.');localStorage.setItem(key,text);return text;}
export function clearTradePending(key:string,text:string):void {if(localStorage.getItem(key)===text)localStorage.removeItem(key);}

export type PendingEntry={key:string;text:string;pending:TradeStatementPending|null;archived:boolean;deleted:boolean;invalid:boolean;recoveryReason?:'zero-total';identity?:{statementId?:string;operationId?:string};copies:{key:string;text:string}[]};
const pendingStateKey=(companyId:CompanyId,uid:string,key:string)=>`trade-statement-issue-state:${companyId}:${uid}:${encodeURIComponent(key)}`;
const belongs=(key:string,companyId:CompanyId,uid:string)=>key===tradePendingKey(companyId,uid)||key.startsWith(tradePendingKey(companyId,uid,''));
const samePending=(a:TradeStatementPending,b:TradeStatementPending)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function copyState(companyId:CompanyId,uid:string,key:string,text:string):{archived:boolean;deleted:boolean}{
 try{const row=JSON.parse(localStorage.getItem(pendingStateKey(companyId,uid,key))??'null');
  const archived=row?.version===1&&row.key===key&&row.text===text&&row.archived===true;
  return {archived,deleted:archived&&row.deleted===true};
 }catch{return {archived:false,deleted:false};}
}
/** 옛 단일 키도 삭제하지 않고 읽는다. 같은 본문은 한 항목으로 보여 주되 각 사본의 CAS 원문을 남긴다. */
export function listTradePendings(companyId:CompanyId,uid:string):PendingEntry[]{
 const entries:PendingEntry[]=[];
 for(const key of Object.keys(localStorage).filter(key=>belongs(key,companyId,uid)).sort()){
  const text=localStorage.getItem(key);if(text===null)continue;
  let pending:TradeStatementPending|null=null;try{pending=parseTradePending(text,companyId,uid,true);
   if(key!==tradePendingKey(companyId,uid)&&key!==tradePendingKey(companyId,uid,pending.input.statement.id))pending=null;
  }catch{/* 손상된 원문도 목록과 충돌 판정에 남긴다. */}
  const state=copyState(companyId,uid,key,text),same=pending?entries.find(row=>row.pending&&samePending(row.pending,pending!)):undefined;
  if(same){same.copies.push({key,text});same.archived=same.archived&&state.archived;same.deleted=same.deleted&&state.deleted;}
  else entries.push({key,text,pending,identity:recoveryKeyIdentity(key,{companyId,actorUid:uid}),archived:state.archived,deleted:pending!==null&&state.deleted,invalid:pending===null,...(pending?.input.statement.totalAmount===0?{recoveryReason:'zero-total' as const}:{}),copies:[{key,text}]});
 }
 return entries;
}
type PendingSources={statementId:string;operationId:string;orderIds:string[];poIds:string[]};
export function findTradePendingConflicts(entries:PendingEntry[],draft:TradeStatementDraft|PendingSources):PendingEntry[]{
 const source:PendingSources='command' in draft?{statementId:draft.statement.id,operationId:draft.command.operationId,orderIds:draft.command.orderIds,poIds:draft.poIds}:draft;
 return entries.filter(entry=>{
  if(!entry.pending)return !!(entry.identity?.statementId===source.statementId||entry.identity?.operationId===source.operationId);
  const input=entry.pending.input;
  if(entry.recoveryReason!=='zero-total'&&input.statement.id===source.statementId&&input.command.operationId===source.operationId)return false;
  return input.statement.id===source.statementId||input.command.operationId===source.operationId
   ||input.command.orderIds.some(id=>source.orderIds.includes(id))||input.poIds.some(id=>source.poIds.includes(id));
 });
}
export function tradePendingConflictMessage(entry:PendingEntry):string{
 const previous=entry.pending?.input.statement;
 if(!previous)return '판독할 수 없는 과거 전표 요청이 있습니다. 실패 작업에서 원문을 확인해 주세요.';
 const description=`${previous.partnerName} · ${previous.tradeDate} · ${previous.totalAmount.toLocaleString()}원`;
 if(entry.recoveryReason==='zero-total')return `${description} 이전 0원 요청과 같은 주문·발주입니다. 이 요청은 다시 발행할 수 없습니다. 이미 처리된 전표가 있는지 확인해 주세요.`;
 return entry.deleted?`${description} 실패 요청은 삭제되었습니다. 같은 주문·발주의 이전 처리 결과가 아직 확인되지 않아 새 발행을 막았습니다. 이미 처리된 주문·발주인지와 연결된 발행 전표를 확인해 주세요.`
  :`${description} 전표가 같은 주문·발주를 처리 중이거나 보관 중입니다. 실패 작업에서 기존 요청을 확인해 주세요.`;
}
/** 네트워크는 잠금 밖에서 호출한다. 탭 사이 최초 저장·보관·정리는 같은 회사와 UID 잠금으로 직렬화한다. */
export async function withTradeStatementLock<T>(companyId:CompanyId,uid:string,work:()=>T|Promise<T>,isCurrent:()=>boolean=()=>true):Promise<T>{
 if(!uid||!['taebaek','punghoe'].includes(companyId)||!isCurrent())throw new Error('회사 또는 로그인 사용자가 변경되어 전표 원문을 보존했습니다.');
 if(typeof navigator==='undefined'||!navigator.locks?.request)throw new Error('이 브라우저는 창 간 안전 잠금을 지원하지 않습니다. 지원되는 브라우저에서 전표 작업을 진행해 주세요.');
 return navigator.locks.request(`trade-statement-lock:${companyId}:${uid}`,{mode:'exclusive'},async()=>{
  if(!isCurrent())throw new Error('회사 또는 로그인 사용자가 변경되어 전표 원문을 보존했습니다.');
  return work();
 });
}
export async function storeTradePendingEntry(p:TradeStatementPending,isCurrent:()=>boolean=()=>true):Promise<PendingEntry>{
 const text=JSON.stringify(p);parseTradePending(text,p.companyId,p.userId);
 return withTradeStatementLock(p.companyId,p.userId,()=>{
  const entries=listTradePendings(p.companyId,p.userId),matches=entries.filter(entry=>entry.pending?.input.statement.id===p.input.statement.id),existing=matches[0];
  if(existing){if(matches.some(entry=>!entry.pending||!samePending(entry.pending,p)))throw new Error('같은 전표의 최초 원문이 다릅니다. 기존 요청을 보존했습니다.');return existing;}
  const conflicts=findTradePendingConflicts(entries,p.input);
  if(conflicts.length)throw new Error(tradePendingConflictMessage(conflicts[0]));
  const key=tradePendingKey(p.companyId,p.userId,p.input.statement.id);storeTradePending(key,p);
  if(!isCurrent()||localStorage.getItem(key)!==text)throw new Error('전표 원문 저장을 확인하지 못했습니다. 기록을 보존했습니다.');
  return {key,text,pending:parseTradePending(text,p.companyId,p.userId),archived:false,deleted:false,invalid:false,copies:[{key,text}]};
 },isCurrent);
}
async function setTradePendingArchive(key:string,text:string,companyId:CompanyId,uid:string,archived:boolean,isCurrent:()=>boolean,deleted?:boolean):Promise<void>{
 await withTradeStatementLock(companyId,uid,()=>{
  if(!belongs(key,companyId,uid)||localStorage.getItem(key)!==text)throw new Error('다른 창의 전표 원문이 변경되었습니다. 기존 요청을 보존했습니다.');
  const entry=listTradePendings(companyId,uid).find(row=>row.copies.some(copy=>copy.key===key&&copy.text===text));
  if(!entry?.pending)throw new Error('저장된 전표 원문을 판독할 수 없어 요청 상태를 바꾸지 않았습니다. 원문 확인이 필요합니다.');
  if(entry.deleted&&deleted===undefined)throw new Error('삭제된 실패 요청은 다시 표시하지 않습니다. 이전 처리 결과와 연결된 발행 전표를 확인해 주세요.');
  for(const copy of entry.copies){
   if(!isCurrent()||localStorage.getItem(copy.key)!==copy.text)throw new Error('전표 원문이 변경되어 보관 상태를 바꾸지 않았습니다.');
   const marker=JSON.stringify({version:1,key:copy.key,text:copy.text,archived,...(deleted!==undefined?{deleted}:{})});
   const stateKey=pendingStateKey(companyId,uid,copy.key);localStorage.setItem(stateKey,marker);
   if(localStorage.getItem(stateKey)!==marker||localStorage.getItem(copy.key)!==copy.text||!isCurrent())throw new Error('전표 보관을 확인하지 못했습니다. 원문을 보존했습니다.');
  }
 },isCurrent);
}
/** unknown 정리는 본문을 지우지 않는다. 본문을 함께 고정한 상태 표식만 쓰므로 지급 요청도 그대로 남는다. */
export const archiveTradePending=(key:string,text:string,companyId:CompanyId,uid:string,isCurrent:()=>boolean=()=>true)=>setTradePendingArchive(key,text,companyId,uid,true,isCurrent);
export const restoreTradePending=(key:string,text:string,companyId:CompanyId,uid:string,isCurrent:()=>boolean=()=>true)=>setTradePendingArchive(key,text,companyId,uid,false,isCurrent);
/** 실패 목록에서는 삭제한다. 미확인 원문은 중복 처리를 막는 내부 보호 자료로만 남긴다. */
export const deleteTradePendingEntry=(key:string,text:string,companyId:CompanyId,uid:string,isCurrent:()=>boolean=()=>true)=>setTradePendingArchive(key,text,companyId,uid,true,isCurrent,true);
export async function clearTradePendingEntry(key:string,text:string,companyId:CompanyId,uid:string,isCurrent:()=>boolean=()=>true):Promise<void>{
 await withTradeStatementLock(companyId,uid,()=>{
  if(!belongs(key,companyId,uid)||localStorage.getItem(key)!==text)return;
  const entry=listTradePendings(companyId,uid).find(row=>row.copies.some(copy=>copy.key===key&&copy.text===text));
  if(!entry?.pending)return;
  for(const copy of entry.copies){if(!isCurrent())return;clearTradePending(copy.key,copy.text);
   const stateKey=pendingStateKey(companyId,uid,copy.key),state=localStorage.getItem(stateKey);
   try{if(state&&JSON.parse(state).text===copy.text&&localStorage.getItem(stateKey)===state)localStorage.removeItem(stateKey);}catch{/* 손상된 보관 표식은 보존한다. */}
  }
 },isCurrent);
}
type IssueRequest={operationId:string;statement:Record<string,unknown>;orderIds:string[];poIds:string[];costUpdates:Record<string,unknown>[];newPo?:{items:Record<string,unknown>[]}};
const verifiedRejections=new WeakMap<object,{companyId:string;userId:string;operationId:string;business:string}>();
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const requestBusiness=(request:IssueRequest)=>{
 const {createdBy:_createdBy,...statement}=request.statement;
 return JSON.stringify(canonical({statement,orderIds:request.orderIds,poIds:request.poIds,costUpdates:request.costUpdates,newPoItems:request.newPo?.items??[]}));
};
export function tradePendingMatchesRequest(p:TradeStatementPending,request:IssueRequest):boolean{
 return p.input.command.operationId===request.operationId&&requestBusiness(request)===requestBusiness({operationId:p.input.command.operationId,
  statement:p.input.statement as unknown as Record<string,unknown>,orderIds:p.input.command.orderIds,poIds:p.input.poIds,
  costUpdates:p.input.costUpdates.map(c=>({...c,beforeCost:c.beforeCost??0,sourceLineIndex:c.sourceLineIndex??-1})),
  ...(p.input.newPoItems.length?{newPo:{items:p.input.newPoItems}}:{})});
}
/** 서버 원문 SHA와 실제 송신 원문을 검증한 오류 객체만 화면 해제에 사용할 수 있다. */
export async function verifyTradeServerRejection(error:unknown,request:IssueRequest,requestText:string,companyId:string,userId:string,isCurrent:()=>boolean=()=>true):Promise<boolean>{
 const d=(error as {details?:Record<string,unknown>})?.details;
 if(!error||typeof error!=='object'||d?.version!==2||d.operationStatus!=='rejected'||d.financialWrites!==false
  ||d.companyId!==companyId||d.actorId!==userId||d.operationId!==request.operationId||d.statementId!==request.statement.id
  ||d.requestText!==requestText||typeof d.requestHash!=='string'||!Number.isSafeInteger(d.receiptRevision)||Number(d.receiptRevision)<1)return false;
 try{if(requestBusiness(JSON.parse(requestText))!==requestBusiness(request))return false;}catch{return false;}
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(requestText));
 if(Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')!==d.requestHash||!isCurrent())return false;
 verifiedRejections.set(error,{companyId,userId,operationId:request.operationId,business:requestBusiness(request)});return true;
}
export function tradeNoWriteProof(error:unknown,p:TradeStatementPending,allowLocalPreCall=true):boolean {
 const d=(error as {details?:Record<string,unknown>})?.details;
 if(allowLocalPreCall&&d?.operationStatus==='rejected'&&d.version===1&&d.financialWrites===false&&d.companyId===p.companyId&&d.operationId===p.input.command.operationId)return true;
 if(!error||typeof error!=='object')return false;const verified=verifiedRejections.get(error);if(!verified)return false;
 return verified.companyId===p.companyId&&verified.userId===p.userId&&verified.operationId===p.input.command.operationId
  &&verified.business===requestBusiness({operationId:p.input.command.operationId,statement:p.input.statement as unknown as Record<string,unknown>,
   orderIds:p.input.command.orderIds,poIds:p.input.poIds,costUpdates:p.input.costUpdates.map(c=>({...c,beforeCost:c.beforeCost??0,sourceLineIndex:c.sourceLineIndex??-1})),
   ...(p.input.newPoItems.length?{newPo:{items:p.input.newPoItems}}:{})});
}
