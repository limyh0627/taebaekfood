import {doc,getDocFromServer} from 'firebase/firestore';
import {auth,authReady,db} from '../firebase';
import type {ChatMessage,CompanyId,Order} from '../types';
export type PendingSubmissionRead<T> = {kind:'found';record:T}|{kind:'missing'}|{kind:'unconfirmed';reason:string};
export interface PendingSubmissionScope {companyId:CompanyId;uid:string;employeeId:string;signal:AbortSignal;}
const validId=(value:unknown):value is string=>typeof value==='string'&&!!value&&value.trim()===value&&!value.includes('/');
async function read<T>(collection:'orders'|'chatMessages',scope:PendingSubmissionScope&{id:string},owns:(data:Record<string,unknown>)=>boolean):Promise<PendingSubmissionRead<T>>{
 const current=()=>scope.signal?.aborted===false&&validId(scope.uid)&&auth.currentUser?.uid===scope.uid;
 const unconfirmed=(reason:string):PendingSubmissionRead<T>=>({kind:'unconfirmed',reason});
 if(!validId(scope.id)||!validId(scope.employeeId)||!['taebaek','punghoe'].includes(scope.companyId)||!current())return unconfirmed('현재 로그인과 요청 번호를 확인해 주세요.');
 try{
  await authReady;if(!current())return unconfirmed('로그인 범위가 변경되었습니다.');
  const user=auth.currentUser!;const token=await user.getIdTokenResult();
  if(!current()||token.claims.companyId!==scope.companyId||token.claims.employeeId!==scope.employeeId)return unconfirmed('현재 로그인 범위를 확인하지 못했습니다.');
  const snapshot=await getDocFromServer(doc(db,collection,scope.id));
  if(!current())return unconfirmed('로그인 범위가 변경되었습니다.');
  if(snapshot.metadata?.fromCache!==false||snapshot.metadata?.hasPendingWrites!==false)return unconfirmed('서버에서 확정된 조회 결과를 받지 못했습니다.');
  if(snapshot.id!==scope.id)return unconfirmed('요청 번호와 조회 결과가 일치하지 않습니다.');
  if(!snapshot.exists())return {kind:'missing'};
  const data=snapshot.data();
  if(data.companyId!==scope.companyId||!owns(data))return unconfirmed('현재 요청에 해당하는 기록을 확인하지 못했습니다.');
  return {kind:'found',record:{...data,id:snapshot.id} as T};
 }catch{return unconfirmed('기록을 조회하지 못했습니다. 입력을 보존했습니다. 다시 조회해 주세요.');}
}
/** 부재도 원요청 취소나 미처리 확정으로 해석하지 않는다. */
export function readPendingOrder(scope:PendingSubmissionScope&{id:string;partnerId:string}):Promise<PendingSubmissionRead<Order>>{
 if(!validId(scope.partnerId))return Promise.resolve({kind:'unconfirmed',reason:'거래처를 확인해 주세요.'});
 return read<Order>('orders',scope,data=>data.partnerId===scope.partnerId);
}
export function readPendingChatMessage(scope:PendingSubmissionScope&{id:string;roomId:string;senderId:string}):Promise<PendingSubmissionRead<ChatMessage>>{
 if(!validId(scope.roomId)||!validId(scope.senderId)||scope.senderId!==scope.employeeId)return Promise.resolve({kind:'unconfirmed',reason:'대화방과 보낸 직원을 확인해 주세요.'});
 return read<ChatMessage>('chatMessages',scope,data=>data.roomId===scope.roomId&&data.senderId===scope.senderId);
}
