import {useEffect,useRef,useState} from 'react';
import type {StaticReferenceSnapshot} from '../services/staticReferenceRead';
export interface InventoryReferenceToken {readonly owner:object;readonly items:object;readonly core:object}
export interface InventoryNewSendGuard {assertBeforeNewSend:()=>void}
export interface InventoryReferenceGuard {capture:()=>InventoryReferenceToken;assertCurrent:(token:InventoryReferenceToken)=>void}
export interface InventoryItemsReadState {status:'idle'|'loading'|'ready'|'error';error:string;hasPrevious:boolean}
/** 준비 때 관측한 자료만 승인한다. 송신 뒤 자기 재고 변경과 원래 ACK 수명에는 사용하지 않는다. */
export function useInventoryReferenceGuard(options:{ownerKey:string;enabled:boolean;isCurrent:()=>boolean;core:()=>object|null}){
 const blocked=useRef(false),reviewRequest=useRef(0);
 const waiters=useRef<{owner:object;resolve:()=>void;reject:(error:unknown)=>void}[]>([]);
 const identity=useRef({key:options.ownerKey,token:{}});if(identity.current.key!==options.ownerKey)identity.current={key:options.ownerKey,token:{}};
 const owner=identity.current.token,alive=useRef(true),observed=useRef<{owner:object;token:object|null;state:InventoryItemsReadState}>({owner,token:null,state:{status:'idle',error:'',hasPrevious:false}}),[,render]=useState(0);
 if(observed.current.owner!==owner){blocked.current=false;reviewRequest.current=0;observed.current={owner,token:null,state:{status:'idle',error:'',hasPrevious:false}};}
 for(const waiter of waiters.current)if(waiter.owner!==owner)waiter.reject(Error('회사 또는 로그인 상태가 바뀌어 품목 조회를 종료했습니다.'));waiters.current=waiters.current.filter(waiter=>waiter.owner===owner);
 const settle=(error?:unknown)=>{const pending=waiters.current.filter(waiter=>waiter.owner===owner);waiters.current=waiters.current.filter(waiter=>waiter.owner!==owner);for(const waiter of pending)error?waiter.reject(error):waiter.resolve();};
 const current=()=>alive.current&&identity.current.token===owner&&options.enabled&&options.isCurrent();
 const update=(state:InventoryItemsReadState,token:object|null)=>{if(!current())return;observed.current={owner,token,state};render(n=>n+1);};
 const itemsSnapshot=<T,>(snapshot:StaticReferenceSnapshot<T>)=>{if(!current())return;const confirmed=snapshot.metadata.fromCache===false&&snapshot.metadata.hasPendingWrites===false;update({status:confirmed?'ready':'error',error:confirmed?'':'품목을 서버에서 확인하지 못했습니다. 다시 조회한 뒤 작업을 준비해 주세요.',hasPrevious:true},confirmed?{}:null);settle(confirmed?undefined:Error('품목을 서버에서 확인하지 못했습니다. 다시 조회해 주세요.'));};
 const itemsError=(_reason:unknown)=>{if(!current())return;settle(Error('품목을 조회하지 못했습니다. 다시 조회해 주세요.'));update({status:'error',error:'품목을 조회하지 못했습니다. 연결·권한을 확인한 뒤 다시 조회해 주세요.',hasPrevious:observed.current.state.hasPrevious},null);};
 const invalidateItems=()=>update({...observed.current.state,status:'loading',error:''},null);
 const fail=()=>{if(current()){blocked.current=true;reviewRequest.current++;render(n=>n+1);}throw Object.assign(Error('품목·구성 기준정보가 바뀌었거나 서버 확인이 필요합니다. 기준정보를 다시 조회한 뒤 작업을 다시 준비해 주세요.'),{code:'inventory-reference-changed'});};
 const renderedItems=observed.current.token;
 const capture=():InventoryReferenceToken=>{const items=observed.current.token,core=options.core();if(!current()||!items||items!==renderedItems||!core)return fail();blocked.current=false;return {owner,items,core};};
 const assertCurrent=(token:InventoryReferenceToken)=>{if(!current()||token.owner!==owner||token.items!==observed.current.token||!token.core||token.core!==options.core())fail();};
 const refreshItems=(restart:()=>void)=>{invalidateItems();const promise=new Promise<void>((resolve,reject)=>{if(!current()){reject(Error('품목 조회 범위가 바뀌었습니다.'));return;}waiters.current.push({owner,resolve,reject});restart();});void promise.catch(()=>{});return promise;};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;observed.current.token=null;const pending=waiters.current;waiters.current=[];for(const waiter of pending)waiter.reject(Error('품목 조회가 종료됐습니다.'));};},[]);
 return {reviewRequest:reviewRequest.current,blocked:blocked.current,isCurrent:current,refreshItems,capture,assertCurrent,itemsSnapshot,itemsError,invalidateItems,items:observed.current.state};
}
