import { AR, AP, OTHER_PAYABLE } from '../../../shared/autoJournal';
import { httpsCallable } from 'firebase/functions';
import { auth,authReady,functions } from '../../../shared/firebase';
import type { CompanyId,ApplyPartnerAdvanceInput,CancelPartnerAdvanceInput,PreparedPartnerAdvance } from '../../../shared/partnerAdvance';
export type PartnerAdvanceResult={status:'applied'|'duplicate';id:string;docNo:string};
export type PendingPartnerAdvance={version:1;companyId:CompanyId;actorId:string;action:'apply'|'cancel';input:ApplyPartnerAdvanceInput|CancelPartnerAdvanceInput};
const key=(companyId:CompanyId,actorId:string)=>`erp:partner-advance:${companyId}:${actorId}`;
const validId=(value:unknown,max=180)=>typeof value==='string'&&new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`).test(value);
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
function validInput(action:string,input:any):boolean {
 if(!input||!validId(input.operationId,120)||!validId(input.partnerId,150)||!validId(input.releaseId,150)||typeof input.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!Number.isFinite(Date.parse(input.date+'T00:00:00Z'))||new Date(input.date+'T00:00:00Z').toISOString().slice(0,10)!==input.date||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)return false;
 return action==='apply'?input.source?.collection==='cashEntries'&&validId(input.source.id)&&['133','254'].includes(input.source.lineKey)&&validId(input.statementId)&&[AR,AP,OTHER_PAYABLE].includes(input.accountCode)&&Number.isSafeInteger(input.amount)&&input.amount>0&&[input.expectedSourceFingerprint,input.expectedTargetFingerprint].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))
 :action==='cancel'&&validId(input.applicationStatementId)&&typeof input.reason==='string'&&!!input.reason.trim()&&input.reason.length<=500;
}
export function readPendingPartnerAdvance(companyId:CompanyId):PendingPartnerAdvance|null {
 const actorId=auth.currentUser?.uid;if(!actorId)return null;
 const encoded=sessionStorage.getItem(key(companyId,actorId));if(!encoded)return null;
 let pending:PendingPartnerAdvance;try{pending=JSON.parse(encoded);}catch{throw new Error('저장된 적용 요청을 확인해 주세요.');}
 if(pending.version!==1||pending.companyId!==companyId||pending.actorId!==actorId||!['apply','cancel'].includes(pending.action)||!validInput(pending.action,pending.input))throw new Error('저장된 적용 요청을 확인해 주세요.');
 return pending;
}
async function actor(companyId:CompanyId){await authReady;const user=auth.currentUser;if(!user)throw new Error('로그인이 필요합니다.');const claims=(await user.getIdTokenResult()).claims;if(auth.currentUser?.uid!==user.uid||claims.companyId!==companyId||claims.isAdmin!==true)throw new Error('현재 회사의 관리자 권한을 확인해 주세요.');return user.uid;}
export async function preparePartnerAdvance(companyId:CompanyId,partnerId:string):Promise<PreparedPartnerAdvance>{const actorId=await actor(companyId);const result=(await httpsCallable<{partnerId:string},PreparedPartnerAdvance>(functions,'preparePartnerAdvanceCommand')({partnerId})).data;if(await actor(companyId)!==actorId)throw new Error('로그인 정보가 변경됐습니다.');return result;}
async function mutate(companyId:CompanyId,action:'apply'|'cancel',input:ApplyPartnerAdvanceInput|CancelPartnerAdvanceInput):Promise<PartnerAdvanceResult>{
 if(!validInput(action,input))throw new Error('적용 요청 입력을 확인해 주세요.');
 const actorId=await actor(companyId),storageKey=key(companyId,actorId);
 const pending:PendingPartnerAdvance={version:1,companyId,actorId,action,input:JSON.parse(JSON.stringify(input))};
 const encoded=JSON.stringify(pending),existing=sessionStorage.getItem(storageKey);
 if(existing&&existing!==encoded)throw new Error('결과를 확인하지 못한 이전 적용 요청을 먼저 재시도해 주세요.');
 sessionStorage.setItem(storageKey,encoded);
 if(auth.currentUser?.uid!==actorId)throw new Error('로그인 정보가 변경됐습니다. 이전 요청은 보존했습니다.');
 let result:PartnerAdvanceResult;
 try {result=(await httpsCallable<unknown,PartnerAdvanceResult>(functions,action==='apply'?'applyPartnerAdvanceCommand':'cancelPartnerAdvanceCommand')(pending.input)).data;}
 catch(error){
  if(await actor(companyId)!==actorId)throw new Error('로그인 정보가 변경됐습니다. 이전 요청은 보존했습니다.');
  const proof=(error as {details?:{partnerAdvanceFailure?:any}})?.details?.partnerAdvanceFailure;
  if(proof?.version===1&&proof.companyId===companyId&&proof.partnerId===input.partnerId&&proof.operationId===input.operationId&&proof.actorId===actorId&&proof.operationRejected===true&&proof.financialWrites===false&&typeof proof.commandHash==='string'&&/^[a-f0-9]{64}$/.test(proof.commandHash)&&JSON.stringify(canonical(proof.command))===JSON.stringify(canonical(pending.input))&&sessionStorage.getItem(storageKey)===encoded)sessionStorage.removeItem(storageKey);
  throw error;
 }
 if(await actor(companyId)!==actorId)throw new Error('로그인 정보가 변경됐습니다. 이전 요청은 보존했습니다.');
 if(!['applied','duplicate'].includes(result.status)||!result.id||!result.docNo)throw new Error('적용 결과를 확인하지 못했습니다. 같은 요청으로 재시도해 주세요.');
 if(sessionStorage.getItem(storageKey)===encoded)sessionStorage.removeItem(storageKey);
 return result;
}
export const applyPartnerAdvance=(companyId:CompanyId,input:ApplyPartnerAdvanceInput)=>mutate(companyId,'apply',input);
export const cancelPartnerAdvance=(companyId:CompanyId,input:CancelPartnerAdvanceInput)=>mutate(companyId,'cancel',input);
