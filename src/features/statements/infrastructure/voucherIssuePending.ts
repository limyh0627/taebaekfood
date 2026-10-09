import type {CashEntry,CompanyId,IssuedStatement} from '../../../shared/types';
import {isCalendarDay} from '../../../shared/day';
export type VoucherIssuePending = {version:1;companyId:CompanyId;userId:string;kind:'cashEntries';document:CashEntry}|{version:1;companyId:CompanyId;userId:string;kind:'issuedStatements';document:IssuedStatement};
export const voucherPendingKey=(companyId:CompanyId,userId:string)=>`voucher-composer-issue:${companyId}:${userId}`;
export function readVoucherPending(key:string,companyId:CompanyId,userId:string):VoucherIssuePending|null {
 const encoded=localStorage.getItem(key);if(!encoded)return null;
 let row:VoucherIssuePending;try{row=JSON.parse(encoded);}catch{throw new Error('저장 중이던 전표 내용을 확인해야 합니다. 새 전표를 발행하지 않았습니다.');}
 return validateVoucherPending(row,companyId,userId);
}
function validateVoucherPending(row:VoucherIssuePending,companyId:CompanyId,userId:string):VoucherIssuePending {
 const d=row?.document;
 if(!row||typeof row!=='object'||row.version!==1||row.companyId!==companyId||row.userId!==userId||!d||d.companyId!==companyId||typeof d.id!=='string'||!d.id||d.id.includes('/')
 || !['cashEntries','issuedStatements'].includes(row.kind) || ('note' in d && d.note!==undefined && typeof d.note!=='string') || ('memo' in d && d.memo!==undefined && typeof d.memo!=='string')||!isCalendarDay(row.kind==='cashEntries'?row.document.date:row.document.tradeDate)
 ||(row.kind==='cashEntries'? !['입금','출금'].includes(row.document.dir)||!Number.isSafeInteger(row.document.amount)||row.document.amount<=0||typeof row.document.cashAccountId!=='string'||!row.document.cashAccountId||!!row.document.loanId : !Array.isArray(row.document.items)||!row.document.items.length||!Number.isSafeInteger(row.document.totalAmount)||row.document.totalAmount<=0))throw new Error('저장 중이던 전표 내용을 확인해야 합니다. 새 전표를 발행하지 않았습니다.');
 if (row.kind==='cashEntries' && row.document.lines!==undefined && (!Array.isArray(row.document.lines)||row.document.lines.some(line=>!line||typeof line.accountCode!=='string'||line.note!==undefined&&typeof line.note!=='string'||!Number.isSafeInteger(line.amount)||line.amount<0||line.side!==undefined&&!['차변','대변'].includes(line.side)))) throw new Error('저장 중이던 전표 분개를 확인해야 합니다.');
 if(row.kind==='issuedStatements' && row.document.items.some(line=>!line||typeof line.name!=='string'||!Number.isFinite(line.total)||line.side!==undefined&&!['차변','대변'].includes(line.side)))throw new Error('저장 중이던 전표 분개를 확인해야 합니다.');
 return row;
}
export function storeVoucherPending(key:string,pending:VoucherIssuePending):string {
 validateVoucherPending(pending,pending.companyId,pending.userId);
 const encoded=JSON.stringify(pending),old=localStorage.getItem(key);
 if(old!==null&&old!==encoded)throw new Error('이전에 저장 중이던 전표를 먼저 재시도해 주세요.');
 localStorage.setItem(key,encoded);return encoded;
}
export function clearVoucherPending(key:string,encoded:string):void {if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);}
export function voucherNoWriteProof(error:unknown,pending:VoucherIssuePending):boolean {
 const p=(error as {details?:Record<string,unknown>})?.details;
 return p?.operationStatus==='rejected'&&p.version===1&&p.financialWrites===false&&p.companyId===pending.companyId&&p.operationId===pending.document.id;
}
