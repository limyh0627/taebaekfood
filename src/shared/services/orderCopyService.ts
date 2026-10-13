import {httpsCallable} from 'firebase/functions';
import {auth,authReady,functions} from '../firebase';
import {canonicalOrderInterpretation,type OrderInterpretationRequest,type OrderInterpretationScope} from '../orderInterpretation';
import {decodeOrderCopyAttempt,prepareOrderCopyAttempt,clearOrderCopyAttempt} from '../orderCopyAttempt';
import type {OrderCopyResult} from '../../../functions/src/orderCopyCommands';
export type {OrderCopyResult};
export interface PendingOrderCopy{key:string;text:string;request:OrderInterpretationRequest|null;deleted:boolean;error:string}
const prefix=(scope:OrderInterpretationScope)=>`order-copy-v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const keyOf=(request:OrderInterpretationRequest)=>prefix(request)+encodeURIComponent(request.requestId);
const marker=(key:string)=>`${key}:deleted`;
const active=async(scope:OrderInterpretationScope,adminOnly=false)=>{
 await authReady;const user=auth.currentUser;if(!user||user.uid!==scope.actorUid)throw Error('주문 요청의 로그인 계정이 변경되었습니다. 원문을 보존했습니다.');
 const claims=(await user.getIdTokenResult()).claims;if(auth.currentUser?.uid!==scope.actorUid||claims.companyId!==scope.companyId||typeof claims.employeeId!=='string'||adminOnly&&claims.isAdmin!==true)throw Error('현재 회사의 직원 권한을 확인해 주세요.');
};
async function locked<T>(scope:OrderInterpretationScope,work:()=>T):Promise<T>{
 if(!navigator.locks?.request)throw Error('이 환경은 여러 창의 요청 보호를 지원하지 않습니다. 지원 브라우저에서 다시 시도해 주세요.');
 return navigator.locks.request(prefix(scope),{mode:'exclusive'},async()=>{await active(scope);return work();});
}
export function listPendingOrderCopies(companyId:OrderInterpretationScope['companyId'],actorUid:string):PendingOrderCopy[]{
 const scope={companyId,actorUid},rows:PendingOrderCopy[]=[];
 for(const key of Object.keys(localStorage).filter(key=>key.startsWith(prefix(scope))&&!key.endsWith(':deleted'))){const text=localStorage.getItem(key)!;
  try{const request=decodeOrderCopyAttempt(text,scope);if(key!==keyOf(request))throw Error();rows.push({key,text,request,deleted:localStorage.getItem(marker(key))===text,error:''});}
  catch{rows.push({key,text,request:null,deleted:false,error:'최초 주문 원문이 손상되어 자동으로 다시 저장하지 않습니다.'});}}
 return rows;
}
export async function deletePendingOrderCopy(entry:PendingOrderCopy):Promise<void>{
 if(!entry.request)throw Error('최초 주문 원문을 확인한 뒤 삭제해 주세요.');
 await locked(entry.request,()=>{clearOrderCopyAttempt(localStorage.getItem(entry.key),entry.text);localStorage.setItem(marker(entry.key),entry.text);if(localStorage.getItem(marker(entry.key))!==entry.text)throw Error('실패 요청 삭제 표시를 확인하지 못했습니다.');});
}
async function hash(text:string):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
async function command(request:OrderInterpretationRequest,action:'submit'|'inspect'):Promise<OrderCopyResult>{
 await active(request);const key=keyOf(request),text=canonicalOrderInterpretation(request,request);
 if(action==='submit')await locked(request,()=>{const existing=localStorage.getItem(key),fixed=prepareOrderCopyAttempt(existing,request,request);if(existing===null)localStorage.setItem(key,fixed);if(localStorage.getItem(key)!==fixed)throw Error('최초 주문 원문 저장을 확인하지 못했습니다.');});
 const call=httpsCallable<Record<string,unknown>,OrderCopyResult>(functions,'submitOrderCopyCommand');
 const {getDoc,doc}=await import('firebase/firestore');const {db}=await import('../firebase');
 const gate=action==='submit'?(await getDoc(doc(db,'appMeta','releaseCutover'))).data():undefined;await active(request);
 const requestHash=await hash(text),result=(await call({action,requestText:text,requestHash,...(gate?{releaseId:gate.releaseId}:{})})).data;await active(request);
 if(!result||!['applied','duplicate','rejected','unknown'].includes(result.status)||result.requestId!==request.requestId||result.orderId!==request.confirmed.orderDraft.id||result.requestHash!==requestHash)throw Error('최초 주문 처리 응답을 확인하지 못했습니다. 원문을 보존했습니다.');
 if(['applied','duplicate','rejected'].includes(result.status))await locked(request,()=>{const current=localStorage.getItem(key);if(current!==null){clearOrderCopyAttempt(current,text);localStorage.removeItem(key);if(localStorage.getItem(marker(key))===text)localStorage.removeItem(marker(key));}});
 return result;
}
export const submitOrderCopy=(request:OrderInterpretationRequest)=>command(request,'submit');
export const inspectOrderCopy=(request:OrderInterpretationRequest)=>command(request,'inspect');
export interface OrderInterpretationRule{ruleId:string;companyId:OrderInterpretationScope['companyId'];partnerId:string;alias:string;itemId:string;status:'proposed'|'approved'|'stopped';revision:number;captureIds:string[];orderIds:string[];kind?:'alias'|'expression';scope?:'partner'|'company';target?:'note';value?:string}
export async function listOrderInterpretationRules(companyId:OrderInterpretationScope['companyId'],includeAll=false):Promise<OrderInterpretationRule[]>{
 await authReady;const scope={companyId,actorUid:auth.currentUser?.uid??''};await active(scope,includeAll);const call=httpsCallable<Record<string,unknown>,OrderInterpretationRule[]>(functions,'listOrderInterpretationRulesCommand');const result=(await call({companyId,includeAll})).data;await active(scope,includeAll);return result;
}
export async function reviewOrderInterpretationRule(input:{companyId:OrderInterpretationScope['companyId'];ruleId:string;expectedRevision:number;action:'approve'|'stop'}):Promise<OrderInterpretationRule>{
 await authReady;const scope={companyId:input.companyId,actorUid:auth.currentUser?.uid??''};await active(scope,true);const {getDoc,doc}=await import('firebase/firestore');const {db}=await import('../firebase');const gate=(await getDoc(doc(db,'appMeta','releaseCutover'))).data();await active(scope,true);
 const call=httpsCallable<Record<string,unknown>,OrderInterpretationRule>(functions,'reviewOrderInterpretationRuleCommand');const result=(await call({...input,releaseId:gate?.releaseId})).data;await active(scope,true);return result;
}
