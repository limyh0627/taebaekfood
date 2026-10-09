import { doc, runTransaction } from 'firebase/firestore';
import { db, auth, authReady, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import type { CompanyId, PurchaseOrder, ReturnRequest } from '../types';
import { pendingFlowQuantityPatch } from '../pendingFlowQuantity';

/** 최신 대기 기록과 원본 수량을 확인한 뒤 수량만 저장한다. */
export async function updatePendingFlowQuantity(
  companyId: CompanyId,
  type: '입고' | '반품',
  id: string,
  updates: { itemId: string; previousQuantity: number; quantity: number }[],
): Promise<void> {
  if (type === '반품') return updateReturnQuantity(companyId,id,updates);
  const ref = doc(db, 'purchaseOrders', id);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('대상 기록을 찾을 수 없습니다.');
    tx.update(ref, pendingFlowQuantityPatch(type, snap.data() as PurchaseOrder | ReturnRequest, updates, companyId));
  });
}

/** 불명확한 수량 수정은 같은 작업ID와 원문으로만 재개한다. */
async function updateReturnQuantity(companyId:CompanyId,requestId:string,updates:{itemId:string;previousQuantity:number;quantity:number}[]):Promise<void>{
 if(!Array.isArray(updates)||!updates.length||updates.some(row=>!row||!row.itemId||!Number.isFinite(row.previousQuantity)||!Number.isFinite(row.quantity)||row.quantity<=0||Math.abs(Math.round(row.quantity*1000)-row.quantity*1000)>1e-6))throw new Error('반품 수량을 확인해주세요.');
 await authReady;
 const user=auth.currentUser;if(!user)throw new Error('로그인이 필요합니다.');
 const actorId=user.uid;
 const check=async()=>{const claims=(await user.getIdTokenResult()).claims;if(auth.currentUser?.uid!==actorId||claims.companyId!==companyId||claims.isAdmin!==true)throw new Error('현재 회사 관리자 권한을 확인해주세요.');};
 await check();
 const key='erp:return-quantity:'+companyId+':'+actorId+':'+requestId;
 const previous=localStorage.getItem(key);
 let command:{companyId:CompanyId;requestId:string;operationId:string;updates:typeof updates};
 if(previous){try{command=JSON.parse(previous);}catch{throw new Error('저장된 반품 수량 요청을 확인해주세요.');}
  if(!command||command.companyId!==companyId||command.requestId!==requestId||typeof command.operationId!=='string'||!/^rq-[A-Za-z0-9_-]+$/.test(command.operationId)||JSON.stringify(command.updates)!==JSON.stringify(updates))throw new Error('결과가 확인되지 않은 이전 수량 요청을 먼저 재시도해주세요.');
 }else command={companyId,requestId,operationId:'rq-'+crypto.randomUUID(),updates:JSON.parse(JSON.stringify(updates))};
 const encoded=JSON.stringify(command);
 const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
 const requestHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(command))))),byte=>byte.toString(16).padStart(2,'0')).join('');
 await check();
 if(localStorage.getItem(key)!==previous)throw new Error('다른 수량 수정 요청이 진행 중입니다.');
 localStorage.setItem(key,encoded);
 await check();
 try{
  const reply=(await httpsCallable<typeof command,{status:string;requestId:string;operationId:string;requestHash:string}>(functions,'updatePendingReturnQuantityCommand')(command)).data;
  await check();
  if(!reply||!['updated','duplicate'].includes(reply.status)||reply.requestId!==requestId||reply.operationId!==command.operationId||reply.requestHash!==requestHash)throw new Error('수량 수정 결과를 확인하지 못했습니다. 같은 요청으로 재시도해주세요.');
  if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);
 }catch(error){
  await check();
  const proof=(error as {details?:{quantityRejected?:any}})?.details?.quantityRejected;
  if(proof?.version===1&&proof.terminalConfirmed===true&&proof.status==='rejected'&&proof.companyId===companyId&&proof.actorId===actorId&&proof.requestId===requestId&&proof.operationId===command.operationId&&proof.requestHash===requestHash&&JSON.stringify(proof.command)===encoded&&localStorage.getItem(key)===encoded)localStorage.removeItem(key);
  throw error;
 }
}

export function hasPendingReturnQuantity(companyId:CompanyId,requestId:string):boolean {
 const uid=auth.currentUser?.uid;return !!uid&&localStorage.getItem('erp:return-quantity:'+companyId+':'+uid+':'+requestId)!==null;
}
export async function resumePendingReturnQuantity(companyId:CompanyId,requestId:string):Promise<void>{
 const uid=auth.currentUser?.uid;if(!uid)throw new Error('로그인이 필요합니다.');
 const text=localStorage.getItem('erp:return-quantity:'+companyId+':'+uid+':'+requestId);if(!text)throw new Error('보존된 수량 수정 요청이 없습니다.');
 let pending:any;try{pending=JSON.parse(text);}catch{throw new Error('저장된 반품 수량 요청을 확인해주세요.');}
 await updateReturnQuantity(companyId,requestId,pending?.updates);
}
