import type {CompanyId,IssuedStatement,PurchaseUnitSnapshot} from '../../../shared/types';
import type {StatementCommand} from '../domain/statementCommand';
import {isCalendarDay} from '../../../shared/day';
export type TradeStatementDraft={command:StatementCommand;statement:IssuedStatement;costUpdates:{itemId:string;price:number;beforeCost?:number;sourceLineIndex?:number;sourceLineIndices?:number[]}[];poIds:string[];newPoItems:({itemId:string;itemName:string;quantity:number;isBox:boolean;unit:string;sourceLineIndex?:number}&Partial<PurchaseUnitSnapshot>)[]};
export type TradeStatementPending={version:1;companyId:CompanyId;userId:string;input:TradeStatementDraft;payment?:{amount:number;cashAccountId:string;date:string}};
export const tradePendingKey=(companyId:CompanyId,userId:string)=>`trade-statement-issue:${companyId}:${userId}`;
export const tradeRequestKey=(companyId:CompanyId,userId:string)=>`trade-statement-request:${companyId}:${userId}`;
export function readTradePending(key:string,companyId:CompanyId,userId:string):TradeStatementPending|null {
 const text=localStorage.getItem(key);if(!text)return null;
 try {const p=JSON.parse(text) as TradeStatementPending;const i=p.input,s=i?.statement;
 if(p.version!==1||p.companyId!==companyId||p.userId!==userId||!s||s.companyId!==companyId||typeof s.id!=='string'||!s.id||s.id.includes('/')||i.command?.statementId!==s.id||typeof i.command.operationId!=='string'||!i.command.operationId||i.command.operationId.includes('/')||typeof s.partnerName!=='string'||typeof s.partnerId!=='string'||!Array.isArray(i.command.orderIds)||i.command.orderIds.some(id=>typeof id!=='string')||!Array.isArray(i.command.lines)||!['매출','매입','비용'].includes(s.type)||!isCalendarDay(s.tradeDate)||!Array.isArray(s.items)||!s.items.length||s.items.some(line=>!line||typeof line.name!=='string'||!Number.isFinite(line.total))||!Number.isSafeInteger(s.totalAmount)||s.totalAmount<=0||!Array.isArray(i.poIds)||i.poIds.some(id=>typeof id!=='string')||!Array.isArray(i.costUpdates)||i.costUpdates.some(c=>typeof c.itemId!=='string'||!Number.isFinite(c.price))||!Array.isArray(i.newPoItems)||i.newPoItems.some(c=>typeof c.itemId!=='string'||!Number.isFinite(c.quantity)||c.quantity<=0)||p.payment&&(!Number.isSafeInteger(p.payment.amount)||p.payment.amount<=0||typeof p.payment.cashAccountId!=='string'||!p.payment.cashAccountId||!isCalendarDay(p.payment.date)))throw Error();
 return p;}catch {throw new Error('저장 중이던 전표 내용을 확인해야 합니다. 원문은 보존했습니다.');}
}
export function storeTradePending(key:string,p:TradeStatementPending):string {const text=JSON.stringify(p),old=localStorage.getItem(key);if(old!==null&&old!==text)throw new Error('이전에 저장 중이던 전표를 먼저 재시도해 주세요.');localStorage.setItem(key,text);return text;}
export function clearTradePending(key:string,text:string):void {if(localStorage.getItem(key)===text)localStorage.removeItem(key);}
type IssueRequest={operationId:string;statement:Record<string,unknown>;orderIds:string[];poIds:string[];costUpdates:Record<string,unknown>[];newPo?:{items:Record<string,unknown>[]}};
const verifiedRejections=new WeakMap<object,{companyId:string;userId:string;operationId:string;business:string}>();
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const requestBusiness=(request:IssueRequest)=>{
 const {createdBy:_createdBy,...statement}=request.statement;
 return JSON.stringify(canonical({statement,orderIds:request.orderIds,poIds:request.poIds,costUpdates:request.costUpdates,newPoItems:request.newPo?.items??[]}));
};
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
