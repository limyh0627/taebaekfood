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
export function tradeNoWriteProof(error:unknown,p:TradeStatementPending):boolean {const d=(error as {details?:Record<string,unknown>})?.details;return d?.operationStatus==='rejected'&&d.version===1&&d.financialWrites===false&&d.companyId===p.companyId&&d.operationId===p.input.command.operationId;}
