import { AR, AP } from '../autoJournal';
import {doc,getDoc} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {auth,authReady,db,functions} from '../firebase';
import type {CompanyId} from '../types';
import type {FinancialOpeningInput} from '../../../functions/src/financialOpeningCommand';
export type FinancialOpeningPending={version:1;companyId:CompanyId;userId:string;request:FinancialOpeningInput};
export type FinancialOpeningDraft=FinancialOpeningInput extends infer T?T extends FinancialOpeningInput?Omit<T,'companyId'|'operationId'|'releaseId'>:never:never;
const keyOf=(company:CompanyId,uid:string)=>`financial-opening:${company}:${uid}`;
const notify=()=>window.dispatchEvent(new Event('financial-opening-pending'));
const currentUid=()=>auth.currentUser?.uid;
export function getPendingFinancialOpening(companyId:CompanyId):FinancialOpeningPending|null {
 const uid=currentUid();if(!uid)return null;const text=localStorage.getItem(keyOf(companyId,uid));if(!text)return null;
 try{const p=JSON.parse(text) as FinancialOpeningPending,r=p.request;
 if(p.version!==1||p.companyId!==companyId||p.userId!==uid||!r||r.companyId!==companyId||typeof r.operationId!=='string'||!r.operationId||typeof r.releaseId!=='string'||!r.releaseId||!['partner-create','loan-create','loan-update','account-create','account-update'].includes(r.kind))throw Error();
 const row=r.kind==='loan-create'?r.loan:r.kind==='account-create'?r.account:r.kind==='loan-update'||r.kind==='account-update'?r.original:undefined;
 if(r.kind!=='partner-create'&&(!row||typeof row!=='object'||Array.isArray(row)||typeof row.id!=='string'||!row.id||row.companyId!==companyId||typeof row.name!=='string'))throw Error();
 if(r.kind==='partner-create'&&(typeof r.partnerId!=='string'||typeof r.date!=='string'||![AR,AP].includes(r.code)||!Number.isSafeInteger(r.amount)))throw Error();
 return p;}catch{throw new Error('저장 중인 기초 금융 원문을 확인해야 합니다. 원문은 보존했습니다.');}
}
function clear(key:string,text:string){if(localStorage.getItem(key)===text){localStorage.removeItem(key);notify();}}
const proof=(error:unknown,p:FinancialOpeningPending)=>{const d=(error as {details?:Record<string,unknown>})?.details;return d?.operationStatus==='rejected'&&d.version===1&&d.financialWrites===false&&d.companyId===p.companyId&&d.operationId===p.request.operationId;};
async function send(p:FinancialOpeningPending,previous:boolean):Promise<'created'|'unchanged'|'updated'> {
 const assertActor=()=>{if(currentUid()!==p.userId)throw new Error('로그인 사용자가 변경되었습니다. 기초 금융 원문은 보존했습니다.');};
 const key=keyOf(p.companyId,p.userId),text=JSON.stringify(p);
 assertActor();const old=localStorage.getItem(key);if(old!==null&&old!==text)throw new Error('이전 기초 금융 요청을 먼저 확인하세요.');localStorage.setItem(key,text);notify();
 try{assertActor();const call=httpsCallable<unknown,{result:'created'|'unchanged'|'updated'}>(functions,'financialOpeningCommand');const result=await call(p.request);assertActor();if(!result.data||!['created','unchanged','updated'].includes(result.data.result))throw new Error('기초 금융 저장 결과를 확인하지 못했습니다. 원문은 보존했습니다.');clear(key,text);return result.data.result;}
 catch(error){if(!previous&&currentUid()===p.userId&&proof(error,p))clear(key,text);throw error;}
}
async function authorize(companyId:CompanyId,uid:string){const check=()=>{if(!uid||currentUid()!==uid)throw new Error('로그인 사용자가 변경되었습니다. 기초 금융을 보내지 않았습니다.');};await authReady;check();const token=await auth.currentUser!.getIdTokenResult();check();if(token.claims.companyId!==companyId||token.claims.isAdmin!==true)throw new Error('현재 회사 관리자만 기초 금융을 저장할 수 있습니다.');return check;}
export async function runFinancialOpening(companyId:CompanyId,draft:FinancialOpeningDraft):Promise<'created'|'unchanged'|'updated'> {
 const uid=currentUid();if(!uid)throw new Error('로그인을 확인해 주세요.');const check=await authorize(companyId,uid);const prior=getPendingFinancialOpening(companyId);
 if(prior){const {operationId:_,releaseId:__,companyId:___,...body}=prior.request;if(JSON.stringify(body)!==JSON.stringify(draft))throw new Error('이전에 저장 중이던 기초 금융 원문을 먼저 재시도해 주세요.');return send(prior,true);}
 const gate=(await getDoc(doc(db,'appMeta','releaseCutover'))).data();check();if(gate?.status!=='active'||typeof gate.releaseId!=='string')throw new Error('기초 금융 저장 서버가 준비되지 않았습니다.');
 return send({version:1,companyId,userId:uid,request:{...JSON.parse(JSON.stringify(draft)),companyId,operationId:`opening-${crypto.randomUUID()}`,releaseId:gate.releaseId}},false);
}
export async function resumeFinancialOpening(companyId:CompanyId):Promise<'created'|'unchanged'|'updated'> {const p=getPendingFinancialOpening(companyId);if(!p)throw new Error('다시 확인할 기초 금융 요청이 없습니다.');await authorize(companyId,p.userId);return send(p,true);}
