import { companyOf } from '../../../shared/types';
import {httpsCallable} from 'firebase/functions';
import {auth,authReady,functions} from '../../../shared/firebase';
import type {CompanyId,IssuedStatement} from '../../../shared/types';
import {planTaxIssue,type TaxIssueScope} from '../domain/taxIssue';
export type TaxIssueCommand={companyId:CompanyId;operationId:string;statements:IssuedStatement[];scope:TaxIssueScope;issuedAt:string};
type Result={status:'applied'|'duplicate';companyId:CompanyId;operationId:string;actorId:string;requestHash:string;statementPatches:{id:string;data:Partial<IssuedStatement>}[]};
const running=new Set<string>();
const keyOf=(company:CompanyId,uid:string)=>`tax-issue:${company}:${uid}`;
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value.toMillis==='function'?{timestampMillis:value.toMillis()}:value instanceof Date?{dateISO:value.toISOString()}:value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const encoded=(value:unknown)=>JSON.stringify(canonical(value));
export async function taxIssueRequestHash(command:TaxIssueCommand):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encoded(command))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
const notify=()=>window.dispatchEvent(new Event('tax-issue-pending'));
export function getPendingTaxIssue(companyId:CompanyId):TaxIssueCommand|null{
 const uid=auth.currentUser?.uid;if(!uid)return null;const text=localStorage.getItem(keyOf(companyId,uid));if(text===null)return null;
 try{const row=JSON.parse(text) as TaxIssueCommand;
 if(!row||row.companyId!==companyId||typeof row.operationId!=='string'||!/^tax-[A-Za-z0-9_-]+$/.test(row.operationId)||!['all','taxable','exempt'].includes(row.scope)||typeof row.issuedAt!=='string'||!Number.isFinite(Date.parse(row.issuedAt))||!Array.isArray(row.statements)||!row.statements.length||row.statements.some(s=>!s||typeof s.id!=='string'||!s.id||!Array.isArray(s.items)||companyOf(s)!==companyId))throw Error();return row;
 }catch{throw new Error('보존된 세금계산서 발행 요청을 확인해주세요. 원문은 지우지 않았습니다.');}
}
/** 발행 기록과 대상 전표 표시를 서버 한 거래로 저장한다. */
export async function applyTaxIssueWrites(command:TaxIssueCommand):Promise<Result['statementPatches']>{
 const uid=auth.currentUser?.uid;if(!uid)throw new Error('로그인이 필요합니다.');const key=keyOf(command.companyId,uid);
 if(running.has(key))throw new Error('발행 결과를 확인 중입니다.');running.add(key);
 try{
 const check=async()=>{if(auth.currentUser?.uid!==uid)throw new Error('로그인 사용자가 바뀌었습니다.');const claims=(await auth.currentUser.getIdTokenResult()).claims;if(auth.currentUser?.uid!==uid||claims.companyId!==command.companyId||claims.isAdmin!==true)throw new Error('현재 회사 관리자 권한을 확인해주세요.');};
 await authReady;await check();
 const body=JSON.parse(encoded(command)) as TaxIssueCommand,text=encoded(body),old=localStorage.getItem(key);
 if(old!==null&&old!==text)throw new Error('이전 발행 결과를 먼저 확인해주세요.');
 const requestHash=await taxIssueRequestHash(body);await check();
 if(localStorage.getItem(key)!==old)throw new Error('다른 발행 요청이 진행 중입니다.');localStorage.setItem(key,text);notify();
 try{
 const expectedPatches=planTaxIssue({...body,actorId:uid}).statementPatches.map(p=>({...p,data:{...p.data,mutationRevision:(body.statements.find(s=>s.id===p.id)?.mutationRevision??0)+1}}));
 const reply=(await httpsCallable<TaxIssueCommand,Result>(functions,'recordTaxIssueCommand')(body)).data;await check();
 if(!reply||!['applied','duplicate'].includes(reply.status)||reply.companyId!==body.companyId||reply.operationId!==body.operationId||reply.actorId!==uid||reply.requestHash!==requestHash||encoded(reply.statementPatches)!==encoded(expectedPatches))throw new Error('발행 결과가 확인되지 않았습니다. 같은 요청으로 다시 확인해주세요.');
 if(localStorage.getItem(key)===text){localStorage.removeItem(key);notify();}return reply.statementPatches;
 }catch(error){await check();const proof=(error as {details?:Record<string,unknown>})?.details;
 if(proof?.version===1&&proof.operationStatus==='rejected'&&proof.terminalConfirmed===true&&proof.financialWrites===false&&proof.companyId===body.companyId&&proof.operationId===body.operationId&&proof.actorId===uid&&proof.requestHash===requestHash&&localStorage.getItem(key)===text){localStorage.removeItem(key);notify();}throw error;
 }
 }finally{running.delete(key);}
}
export async function resumeTaxIssue(companyId:CompanyId):Promise<Result['statementPatches']>{const saved=getPendingTaxIssue(companyId);if(!saved)throw new Error('보존된 발행 요청이 없습니다.');return applyTaxIssueWrites(saved);}
