import {useCallback,useEffect,useRef,useState} from 'react';
import type {Dispatch,SetStateAction} from 'react';
import type {AccountCode,AccountGroup,CashFlowManual,CompanyId,ExpensePreset,FixedCostTemplate,ItemBom,ItemFormula,PartnerItem} from '../types';
import type {PackRow} from '../packIndex';
import {authReady} from '../firebase';
import {readStaticReferenceCollection,staticReferenceServerRows} from '../services/staticReferenceRead';
export type StaticReferenceGroup='core'|'terms'|'finance';
export interface StaticReferenceRows{partnerItems:PartnerItem[];itemBoms:ItemBom[];itemPacks:PackRow[];itemFormulas:ItemFormula[];accountGroups:AccountGroup[];accountCodes:AccountCode[];fixedCostTemplates:FixedCostTemplate[];expensePresets:ExpensePreset[];cashFlowManual:CashFlowManual[]}
export interface StaticReferenceGroupState{status:'idle'|'loading'|'refreshing'|'ready'|'error';error:string;hasPrevious:boolean}
export interface StaticReferenceReadState{inventory?:{reviewRequest?:number;blocked?:boolean;items:import('./useInventoryReferenceGuard').InventoryItemsReadState;refresh:()=>Promise<void>};ownerKey:string;groups:Record<StaticReferenceGroup,StaticReferenceGroupState>;serverReady:boolean;refresh:()=>Promise<void>}
const emptyRows=():StaticReferenceRows=>({partnerItems:[],itemBoms:[],itemPacks:[],itemFormulas:[],accountGroups:[],accountCodes:[],fixedCostTemplates:[],expensePresets:[],cashFlowManual:[]});
const emptyGroups=():Record<StaticReferenceGroup,StaticReferenceGroupState>=>({core:{status:'idle',error:'',hasPrevious:false},terms:{status:'idle',error:'',hasPrevious:false},finance:{status:'idle',error:'',hasPrevious:false}});
type Run={coreEpoch:number;owner:object;started:boolean;done:boolean;promise:Promise<void>;resolve:()=>void;reject:(reason:unknown)=>void};
const cancelled=()=>Object.assign(Error('회사 또는 로그인 상태가 바뀌어 이전 기준정보 조회를 종료했습니다.'),{code:'cancelled'});
const failure=(reason:unknown)=>{const code=reason&&typeof reason==='object'?String((reason as {code?:unknown}).code??'').replace(/^firestore\//,''):'';return code==='permission-denied'?'현재 회사의 기준정보 조회 권한을 확인해 주세요.':code==='unavailable'?'연결이 원활하지 않습니다. 연결을 확인하고 다시 조회해 주세요.':code==='unconfirmed'?'기준정보를 서버에서 확인하지 못했습니다. 이전 자료를 유지합니다.':code==='cancelled'?'회사 또는 로그인 상태가 바뀌어 이전 조회를 종료했습니다.':'기준정보를 조회하지 못했습니다. 연결·권한을 확인한 뒤 다시 조회해 주세요.';};
export function useStaticReferenceRead(options:{companyId:CompanyId;enabled:boolean;isAdmin:boolean;ownerKey:string;isCurrent:()=>boolean}){
 const key=JSON.stringify([options.companyId,options.enabled,options.isAdmin,options.ownerKey]),identity=useRef({key,token:{}});
 if(identity.current.key!==key)identity.current={key,token:{}};
 const coreObservation=useRef<{owner:object;epoch:number;token:object|null}>({owner:identity.current.token,epoch:0,token:null});
 if(coreObservation.current.owner!==identity.current.token)coreObservation.current={owner:identity.current.token,epoch:0,token:null};
 const owner=identity.current.token,alive=useRef(true),runs=useRef<{active?:Run;queued?:Run}>({});
 const [snapshot,setSnapshot]=useState<{owner:object;rows:StaticReferenceRows;groups:Record<StaticReferenceGroup,StaticReferenceGroupState>}>(()=>({owner,rows:emptyRows(),groups:emptyGroups()}));
 const current=()=>alive.current&&identity.current.token===owner&&options.isCurrent();
 const visible=snapshot.owner===owner?snapshot:{owner,rows:emptyRows(),groups:emptyGroups()};
 const finish=(run:Run,error?:unknown,failed=error!==undefined)=>{if(run.done)return;run.done=true;failed?run.reject(error):run.resolve();};
 const update=(change:(previous:typeof snapshot)=>typeof snapshot)=>{if(current())setSnapshot(previous=>current()?change(previous.owner===owner?previous:{owner,rows:emptyRows(),groups:emptyGroups()}):previous);};
 const loadGroup=async(group:StaticReferenceGroup):Promise<Partial<StaticReferenceRows>>=>{
  const read=<T,>(name:Parameters<typeof readStaticReferenceCollection>[0])=>staticReferenceServerRows(readStaticReferenceCollection<T>(name,options.companyId));
  if(group==='core'){
   const [bom,pack,formula]=await Promise.allSettled([read<ItemBom>('item_bom'),read<PackRow>('item_pack'),read<ItemFormula>('item_formula')]);
   if(bom.status==='fulfilled'&&pack.status==='fulfilled'&&formula.status==='fulfilled')return {itemBoms:bom.value,itemPacks:pack.value,itemFormulas:formula.value};
   throw [bom,pack,formula].find(row=>row.status==='rejected')!.reason;
  }
  if(group==='terms'){const [terms]=await Promise.allSettled([read<PartnerItem>('partner_item')]);if(terms.status==='fulfilled')return {partnerItems:terms.value};throw terms.reason;}
  const [groups,codes,templates,presets,cash]=await Promise.allSettled([read<AccountGroup>('accountGroups'),read<AccountCode>('accountCodes'),read<FixedCostTemplate>('fixedCostTemplates'),read<ExpensePreset>('expensePresets'),read<CashFlowManual>('cashFlowManual')]);
  if(groups.status==='fulfilled'&&codes.status==='fulfilled'&&templates.status==='fulfilled'&&presets.status==='fulfilled'&&cash.status==='fulfilled')return {accountGroups:groups.value,accountCodes:codes.value,fixedCostTemplates:templates.value,expensePresets:presets.value,cashFlowManual:cash.value};
  throw [groups,codes,templates,presets,cash].find(row=>row.status==='rejected')!.reason;
 };
 const request=useCallback(()=>{
  if(!current()||!options.enabled){const p=Promise.reject<void>(cancelled());void p.catch(()=>{});return p;}
  coreObservation.current.token=null;
  const queue=runs.current;
  // 새 owner의 layout 요청이 옛 passive cleanup 뒤에 갇히지 않게 한다.
  for(const key of ['active','queued'] as const){const previous=queue[key];if(previous&&previous.owner!==owner){finish(previous,cancelled());delete queue[key];}}
  if(queue.active?.owner===owner&&!queue.active.started)return queue.active.promise;
  if(queue.queued?.owner===owner)return queue.queued.promise;
  let resolve!:()=>void,reject!:(reason:unknown)=>void;
  const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});void promise.catch(()=>{});
  const run:Run={coreEpoch:++coreObservation.current.epoch,owner,started:false,done:false,promise,resolve,reject};
  const start=async()=>{
   try{
    await authReady;if(!current()||run.done)throw cancelled();run.started=true;
    const groups:StaticReferenceGroup[]=options.isAdmin?['core','terms','finance']:['core','terms'];
    update(previous=>({...previous,groups:{...previous.groups,...Object.fromEntries(groups.map(group=>[group,{...previous.groups[group],status:previous.groups[group].hasPrevious?'refreshing':'loading',error:''}]))}}));
    const results=await Promise.allSettled(groups.map(async group=>{
     try{const rows=await loadGroup(group);if(!current()||run.done)return;if(group==='core'&&coreObservation.current.epoch===run.coreEpoch)coreObservation.current.token={};update(previous=>({...previous,rows:{...previous.rows,...rows},groups:{...previous.groups,[group]:{status:'ready',error:'',hasPrevious:true}}}));}
     catch(reason){if(current()&&!run.done)update(previous=>({...previous,groups:{...previous.groups,[group]:{...previous.groups[group],status:'error',error:failure(reason)}}}));throw reason;}
    }));
    if(!current()||run.done)throw cancelled();const rejected=results.find(row=>row.status==='rejected');if(rejected?.status==='rejected')finish(run,rejected.reason,true);else finish(run);
   }catch(reason){if(current()&&!run.done)update(previous=>({...previous,groups:{...previous.groups,core:{...previous.groups.core,status:'error',error:failure(reason)}}}));finish(run,reason,true);}
   finally{if(queue.active===run){queue.active=undefined;const next=queue.queued;queue.queued=undefined;if(next&&!next.done&&current()){queue.active=next;void Promise.resolve().then(()=>execute(next));}else if(next)finish(next,cancelled());}}
  };
  // 다음 run은 그 run을 만든 현재 호출의 load/owner를 사용한다.
  const execute=(candidate:Run)=>{if(candidate===run)return start();return starters.current.get(candidate)?.();};
  starters.current.set(run,start);
  if(queue.active&&!queue.active.done){queue.queued=run;}else{queue.active=run;void Promise.resolve().then(start);}return promise;
 },[owner,options.enabled,options.companyId,options.isAdmin]);
 const starters=useRef(new WeakMap<Run,()=>Promise<void>>());
 useEffect(()=>{alive.current=true;if(options.enabled)void request();return()=>{for(const run of [runs.current.active,runs.current.queued])if(run?.owner===owner)finish(run,cancelled());if(runs.current.active?.owner===owner)runs.current.active=undefined;if(runs.current.queued?.owner===owner)runs.current.queued=undefined;};},[owner,options.enabled,request]);
 useEffect(()=>()=>{alive.current=false;},[]);
 const setPartnerItems:Dispatch<SetStateAction<PartnerItem[]>>=useCallback(action=>{update(previous=>({...previous,rows:{...previous.rows,partnerItems:typeof action==='function'?action(previous.rows.partnerItems):action}}));},[owner]);
 const groups=visible.groups,serverReady=options.enabled&&groups.core.status==='ready'&&groups.terms.status==='ready'&&(!options.isAdmin||groups.finance.status==='ready');
 const renderedCore=coreObservation.current.token;
 const captureCore=()=>current()&&coreObservation.current.token===renderedCore?renderedCore:null;
 return {captureCore,rows:visible.rows,setPartnerItems,refresh:request,isCurrent:current,read:{ownerKey:key,groups,serverReady,refresh:request} as StaticReferenceReadState};
}
