import {collection,query,where,onSnapshot} from 'firebase/firestore';
import {db} from '../firebase';
import {isCalendarDay} from '../day';
import type {CompanyId,Order} from '../types';
export interface OrderListSnapshot {rows:Order[];metadata:{fromCache:boolean|undefined;hasPendingWrites:boolean|undefined}}
export function orderListReadError(error:unknown):{code:string;message:string}{
 const raw=error&&typeof error==='object'?(error as {code?:unknown}).code:undefined;
 const code=typeof raw==='string'?raw.replace(/^firestore\//,''):'unknown';
 const messages:Record<string,string>={'permission-denied':'현재 회사의 주문을 조회할 권한을 확인하지 못했습니다. 로그인과 권한을 확인한 뒤 다시 조회해 주세요.',unavailable:'연결이 원활하지 않아 주문을 조회하지 못했습니다. 연결을 확인한 뒤 다시 조회해 주세요.','failed-precondition':'조회 준비를 확인하지 못했습니다. 다시 조회해 주세요.','auth-ready':'로그인 확인을 마치지 못해 주문을 조회하지 못했습니다. 로그인 상태를 확인한 뒤 다시 조회해 주세요.',unauthenticated:'로그인 정보를 확인한 뒤 주문을 다시 조회해 주세요.'};
 return {code:messages[code]?code:'unknown',message:messages[code]??'주문을 조회하지 못했습니다. 보이는 자료를 보존했습니다. 다시 조회해 주세요.'};
}
export function subscribeOrderList(options:{companyId:CompanyId;mode:'legacy-full'|'candidate-v1';candidateFloor?:string},next:(snapshot:OrderListSnapshot)=>void,error:(error:unknown)=>void):()=>void {
 if(!['taebaek','punghoe'].includes(options.companyId)||!['legacy-full','candidate-v1'].includes(options.mode))throw Error('주문 조회 범위를 확인해 주세요.');
 const clauses=[where('companyId','==',options.companyId)];
 if(options.mode==='candidate-v1'){
  if(typeof options.candidateFloor!=='string'||!/^[1-9][0-9]{3}-\d{2}-\d{2}$/.test(options.candidateFloor)||!isCalendarDay(options.candidateFloor))throw Error('주문 조회 후보 하한이 올바르지 않습니다.');
  clauses.push(where('orderListProjection.candidateDay','>=',options.candidateFloor));
 }
 const cache=new Map<string,Order>();let active=true;
 const stop=onSnapshot(query(collection(db,'orders'),...clauses),{includeMetadataChanges:true},snapshot=>{
  if(!active)return;
  for(const change of snapshot.docChanges({includeMetadataChanges:true})){
   if(change.type==='removed')cache.delete(change.doc.id);else cache.set(change.doc.id,{id:change.doc.id,...change.doc.data()} as Order);
  }
  next({rows:[...cache.values()],metadata:{fromCache:typeof snapshot.metadata?.fromCache==='boolean'?snapshot.metadata.fromCache:undefined,hasPendingWrites:typeof snapshot.metadata?.hasPendingWrites==='boolean'?snapshot.metadata.hasPendingWrites:undefined}});
 },reason=>{if(!active)return;active=false;error(reason);});
 return()=>{active=false;stop();};
}
