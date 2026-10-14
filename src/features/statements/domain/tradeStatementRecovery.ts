import type {CompanyId,IssuedStatement} from '../../../shared/types';
import {isCalendarDay} from '../../../shared/day';
import type {PendingEntry,TradeStatementDraft,TradeStatementPending} from '../infrastructure/tradeStatementPending';
export type RecoveryScope={companyId:CompanyId;actorUid:string};
export type RecoveryCopy={key:string;text:string};
export type RecoveryRequest={operationId:string;statement:IssuedStatement;orderIds:string[];poIds:string[];costUpdates:Record<string,unknown>[];releaseId:string;newPo?:{id:string;cardNo:string;items:Record<string,unknown>[]}};
export type RecoveryEntry=PendingEntry&{scope:RecoveryScope;upperCopies:RecoveryCopy[];lowerCopies:RecoveryCopy[];kind:'paired'|'upper-only'|'lower-only'|'conflict'|'invalid';request?:RecoveryRequest;metadata:{statementId?:string;operationId?:string;partnerName?:string;tradeDate?:string;totalAmount?:number};reason:string;paymentCopy?:RecoveryCopy;paymentRequestText?:string;paymentRequired?:boolean};
export type RecoveryInspection={companyId:string;actorId:string;operationId:string;statementId:string;requestHash:string;inspectionId:string;status:'unknown'|'applied'|'rejected';reason:string;docNo?:string;serverRequestText?:string;currentStatement:'present'|'changed'|'deleted'|'unverified';statement?:IssuedStatement;rejection?:Record<string,unknown>;payment?:{status:'unknown'|'applied'|'rejected';operationId:string;requestHash:string;reason:string;cashEntryId?:string;docNo?:string}};
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&!value.includes('/');
export function recoveryKeyIdentity(key:string,scope:RecoveryScope):{statementId?:string;operationId?:string}{
 for(const [kind,prefix] of [['statementId','trade-statement-issue-v2:'],['operationId','trade-statement-request-v2:']] as const){const head=prefix+scope.companyId+':'+encodeURIComponent(scope.actorUid)+':';if(!key.startsWith(head))continue;try{const encoded=key.slice(head.length),value=decodeURIComponent(encoded);if(id(value)&&encodeURIComponent(value)===encoded)return kind==='operationId'?{operationId:value,...(value.endsWith(':ISSUE')?{statementId:value.slice(0,-6)}:{})}:{statementId:value};}catch{}}
 return {};
}
export function parseRecoveryRequest(copy:RecoveryCopy,scope:RecoveryScope):RecoveryRequest|null{
 try{const r=JSON.parse(copy.text),legacy='trade-statement-request:'+scope.companyId+':'+scope.actorUid,identity=recoveryKeyIdentity(copy.key,scope);
 if(copy.key!==legacy&&identity.operationId!==r.operationId||!id(r.operationId)||!r.statement||r.statement.companyId!==scope.companyId||!id(r.statement.id)||r.operationId!==r.statement.id+':ISSUE'||typeof r.releaseId!=='string'||!r.releaseId||!Array.isArray(r.orderIds)||r.orderIds.some((x:unknown)=>!id(x))||!Array.isArray(r.poIds)||r.poIds.some((x:unknown)=>!id(x))||!Array.isArray(r.costUpdates))return null;return r;
 }catch{return null;}
}
export function validateTradeStatementPaymentInput(raw:string):number{const text=raw.replace(/[,\s원]/g,'');const amount=Number(text);if(!text||!Number.isSafeInteger(amount)||amount<=0)throw Error('수금·지불 금액은 0보다 큰 정수로 입력해 주세요.');return amount;}
export function validateTradeStatementDraft(draft:TradeStatementDraft,payment?:TradeStatementPending['payment']):void{
 if(!isCalendarDay(draft.statement.tradeDate))throw Error('거래일을 실제 달력 날짜로 입력해 주세요.');
 if(!Number.isSafeInteger(draft.statement.totalAmount)||draft.statement.totalAmount<=0)throw Error('전표 합계는 0보다 큰 정수여야 합니다. 수량과 단가를 확인해 주세요.');
 if(payment&&(!Number.isSafeInteger(payment.amount)||payment.amount<=0||!payment.cashAccountId||!isCalendarDay(payment.date)))throw Error('수금·지불 금액과 계좌·날짜를 확인해 주세요.');
}
export function buildRecoveryEntries(scope:RecoveryScope,uppers:PendingEntry[],lowers:RecoveryCopy[],matches:(p:TradeStatementPending,r:RecoveryRequest)=>boolean):RecoveryEntry[]{
 const remaining=new Set(lowers),result:RecoveryEntry[]=[];
 for(const upper of uppers){const p=upper.pending,meta=p?{statementId:p.input.statement.id,operationId:p.input.command.operationId,partnerName:p.input.statement.partnerName,tradeDate:p.input.statement.tradeDate,totalAmount:p.input.statement.totalAmount}:recoveryKeyIdentity(upper.key,scope);
 const linked=lowers.filter(copy=>{const r=parseRecoveryRequest(copy,scope),identity=recoveryKeyIdentity(copy.key,scope);return !!meta.operationId&&(r?.operationId===meta.operationId||identity.operationId===meta.operationId);});linked.forEach(copy=>remaining.delete(copy));const requests=linked.map(copy=>parseRecoveryRequest(copy,scope));
 const same=!!p&&requests.length>0&&requests.every(r=>r&&matches(p,r))&&linked.every(copy=>copy.text===linked[0].text);const kind=!p?'invalid':linked.length?(same?'paired':'conflict'):'upper-only';
 result.push({...upper,scope,upperCopies:upper.copies,lowerCopies:linked,kind,request:requests.length&&requests.every(r=>r)&&linked.every(copy=>copy.text===linked[0].text)?requests[0]!:undefined,metadata:meta,reason:kind==='conflict'?'작성 내용과 최초 송신 원문이 다릅니다. 자동으로 고르거나 덮어쓰지 않습니다.':kind==='invalid'?'보존한 원문을 읽을 수 없습니다. 진단 원문을 내려받아 확인해 주세요.':kind==='upper-only'?'작성 요청만 보존되어 있습니다. 송신 결과는 아직 확인되지 않았습니다.':'최초 송신 원문으로 처리 결과를 확인할 수 있습니다.'});}
 for(const copy of remaining){const r=parseRecoveryRequest(copy,scope);result.push({key:copy.key,text:copy.text,pending:null,archived:false,deleted:false,invalid:!r,copies:[copy],scope,upperCopies:[],lowerCopies:[copy],kind:r?'lower-only':'invalid',...(r?{request:r,...(r.statement.totalAmount===0?{recoveryReason:'zero-total' as const}:{})}:{}),metadata:r?{statementId:r.statement.id,operationId:r.operationId,partnerName:r.statement.partnerName,tradeDate:r.statement.tradeDate,totalAmount:r.statement.totalAmount}:recoveryKeyIdentity(copy.key,scope),reason:r?'최초 송신 요청이 남아 있습니다. 서버 처리 결과를 확인해 주세요.':'송신 원문을 읽을 수 없습니다. 진단 원문을 내려받아 확인해 주세요.'});}return result;
}

/** 수금 서버의 재귀 키 정렬 지문과 같은 JSON 표현을 만든다. */
export function canonicalRecoveryPayment(value:unknown):unknown{return Array.isArray(value)?value.map(canonicalRecoveryPayment):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>[key,canonicalRecoveryPayment(row)])):value;}
