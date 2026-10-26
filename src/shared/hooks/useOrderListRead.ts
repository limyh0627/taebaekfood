import {useCallback,useEffect,useRef,useState} from 'react';
import {authReady} from '../firebase';
import {dateOfLocal} from '../day';
import {companyOf,OrderStatus,type CompanyId,type Order} from '../types';
import {subscribeOrderList,orderListReadError} from '../services/orderListRead';
export interface OrderListReadState {status:'idle'|'loading'|'refreshing'|'ready'|'error';source:'none'|'cache'|'server';hasPendingWrites:boolean;serverReady:boolean;hasObserved:boolean;errorCode:string;error:string;retry():void}
export interface OrderListOwner {scope:number;uid:string;isCurrent:()=>boolean}
type State={key:string;rows:Order[];read:Omit<OrderListReadState,'retry'>};
const initial=(key:string,enabled:boolean):State=>({key,rows:[],read:{status:enabled?'loading':'idle',source:'none',hasPendingWrites:false,serverReady:false,hasObserved:false,errorCode:'',error:''}});
export function useOrderListRead({companyId,enabled,ordersMonths,owner,onSettled}:{companyId:CompanyId;enabled:boolean;ordersMonths:number;owner:OrderListOwner;onSettled?:()=>void}){
 const ownerKey=JSON.stringify([companyId,enabled,owner.scope,owner.uid]);
 const key=JSON.stringify([ownerKey,ordersMonths]);
 const captured=useRef({key,companyId,enabled,ordersMonths,owner});if(captured.current.key!==key)captured.current={key,companyId,enabled,ordersMonths,owner};
 const selected=captured.current, mounted=useRef(false),run=useRef<object|null>(null),unsubscribe=useRef<(()=>void)|null>(null),settled=useRef(new Set<string>()),settledCallback=useRef(onSettled);settledCallback.current=onSettled;
 const [revision,setRevision]=useState(0),[state,setState]=useState(()=>initial(ownerKey,enabled&&!!owner.uid)),observed=useRef(state);
 const publish=(next:State)=>{observed.current=next;setState(next);};
 const currentOwner=()=>mounted.current&&captured.current===selected&&selected.enabled&&!!selected.owner.uid&&selected.owner.isCurrent();
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;run.current=null;unsubscribe.current?.();unsubscribe.current=null;};},[]);
 useEffect(()=>{
  const token={};run.current=token;let live=true;const current=()=>live&&run.current===token&&currentOwner();
  const previous=observed.current.key===ownerKey?observed.current:initial(ownerKey,enabled&&!!owner.uid);
  publish({...previous,read:{...previous.read,status:enabled&&owner.uid?(previous.read.hasObserved||previous.read.status==='refreshing'?'refreshing':'loading'):'idle',serverReady:false}});
  if(!enabled||!owner.uid)return()=>{live=false;if(run.current===token)run.current=null;};
  const finish=()=>{if(!current())return;const id=JSON.stringify([companyId,owner.scope,owner.uid]);if(!settled.current.has(id)){settled.current.add(id);settledCallback.current?.();}};
  const failed=(reason:unknown)=>{if(!current())return;const issue=orderListReadError(reason);publish({...observed.current,read:{...observed.current.read,status:'error',serverReady:false,errorCode:issue.code,error:issue.message}});finish();live=false;unsubscribe.current?.();unsubscribe.current=null;};
  void authReady.then(()=>{
   if(!current())return;
   const cutoff=dateOfLocal(new Date(Date.now()-ordersMonths*30*86400000).toISOString());
   const stop=subscribeOrderList({companyId,mode:'legacy-full'},snapshot=>{
    if(!current())return;
    const rows=snapshot.rows.filter(order=>order.status!==OrderStatus.DELIVERED||dateOfLocal(order.deliveredAt||order.deliveryDate||order.createdAt)>=cutoff).filter(order=>companyOf(order)===companyId);
    const {fromCache,hasPendingWrites}=snapshot.metadata;
    publish({key:ownerKey,rows,read:{status:'ready',source:fromCache===false?'server':fromCache===true?'cache':'none',hasPendingWrites:hasPendingWrites===true,serverReady:fromCache===false&&hasPendingWrites===false,hasObserved:true,errorCode:'',error:''}});finish();
   },failed);
   if(current())unsubscribe.current=stop;else stop();
  },()=>failed({code:'auth-ready'})).catch(failed);
  return()=>{live=false;if(run.current===token){run.current=null;unsubscribe.current?.();unsubscribe.current=null;}};
 },[selected,revision]);
 const retry=useCallback(()=>{if(!currentOwner()||observed.current.key!==ownerKey||['loading','refreshing'].includes(observed.current.read.status))return;run.current=null;unsubscribe.current?.();unsubscribe.current=null;publish({...observed.current,read:{...observed.current.read,status:'refreshing',serverReady:false}});setRevision(value=>value+1);},[selected]);
 const visible=state.key===ownerKey&&currentOwner()?state:initial(ownerKey,enabled&&!!owner.uid);
 return {rows:visible.rows,read:{...visible.read,retry} as OrderListReadState};
}
