import {useEffect,useRef,useState} from 'react';
import {auth} from '../../../shared/firebase';
import {useOutputScope} from '../../../shared/hooks/useOutputScope';
import {registerSessionWork,isSessionWorkChecking} from '../../../shared/sessionWorkCheckpoint';
import {today} from '../../../shared/day';
import {DENSITY,unitOf} from '../../../constants/formula';
import {rawHolderByName,rawLedgerKeys} from '../../../shared/rawHolder';
import type {CompanyId,Item} from '../../../shared/types';
import {rawManualCorrection,type RawManualCorrectionRequest,type RawManualCorrectionResult} from '../../../shared/services/rawManualCorrectionService';
import {checkpointRawManualDraft,readRawManualAttempt,readRawManualOriginal,listRawManualAttempts,prepareRawManualAttempt,submitRawManualAttempt,recordRawManualResult,newRawManualDraft,RawManualCasConflict,type RawManualOwner,type RawManualDraft,type RawManualCopy} from '../rawManualCorrectionAttempt';
export type RawManualContext={companyId:CompanyId;employeeId:string;actorName?:string;material:string;originalId:string|null;items:Item[]};
export const initialRawManualDraft=(originalId:string,material:string):RawManualDraft=>({originalId,material,date:today(),amount:'',isNegative:true,note:'',mode:'neg'});
/** 원래 정정 처리기의 계산식을 그대로 두고 최초 번호·시각만 한 번 고정한다. */
export function buildRawManualCorrection(context:RawManualContext,rmCorrectionForm:RawManualDraft,uid:string):RawManualCorrectionRequest{
 const {companyId,items:allItems,material:rmActiveMaterial}=context,currentUser={name:context.actorName},row={id:rmCorrectionForm.originalId};
 const amt = parseFloat(rmCorrectionForm.amount);
 if (!amt || amt <= 0) throw Error('정정 수량은 0보다 커야 합니다.');
 const inputUnit = unitOf(rmActiveMaterial);
 const density = DENSITY[rmActiveMaterial] ?? 1.0;
 const amtKg = inputUnit === 'L' ? Math.round(amt * density * 1000) / 1000 : amt;
 const isStocktake = rmCorrectionForm.mode === 'stocktake';
 const correctionUsed = rmCorrectionForm.isNegative ? -amtKg : amtKg;
 const inputTag = inputUnit === 'L' ? ` · 사용자 입력: ${amt}L` : '';
 const baseNote = rmCorrectionForm.note
   || (isStocktake ? '수불부 실사정정' : `정정 (원본: ${row.id})`);
 const 정정홀더 = rawHolderByName(allItems, rmActiveMaterial, companyId);
 if (!정정홀더) throw Error(`원료 홀더를 못 찾았다: ${rmActiveMaterial}`);
 const opId = `raw-manual-v1-${crypto.randomUUID()}`;
 const now=new Date().toISOString();
 const 공통정정 = {
   operationId: opId,
   ...rawLedgerKeys(정정홀더),
   materialSnapshot: rmActiveMaterial,
   effectiveAt: isStocktake
     ? now
     : (rmCorrectionForm.date === today() ? now : `${rmCorrectionForm.date}T12:00:00+09:00`),
   ...(currentUser?.name ? { actorName: currentUser.name } : {}),
 };
 const 정정옛칸 = {
   note: baseNote + inputTag,
   type: 'correction' as const,
   ...(currentUser?.name ? { addedBy: currentUser.name } : {}),
   originalAmount: amt,
   originalUnit: inputUnit as 'kg' | 'L',
 };
 const 정정명령 = isStocktake
   ? { ...공통정정, source: { type: 'stocktake' as const, id: opId }, kind: 'stocktake' as const, targetKg: amtKg }
   : correctionUsed > 0
     ? { ...공통정정, source: { type: 'adjustment' as const, id: opId }, kind: 'consume' as const, kg: correctionUsed }
     : { ...공통정정, source: { type: 'adjustment' as const, id: opId }, kind: 'receive' as const, kg: -correctionUsed, lot: { supplierName: '정정', qtyIn: 0 } };
 return{version:1,companyId,actorUid:uid,employeeId:context.employeeId,operationId:opId,command:정정명령,options:{now,newLotId:`lot-${opId}`,carryOverLotId:`carry-${opId}`,legacy:정정옛칸},display:{originalId:row.id,material:rmActiveMaterial,amount:rmCorrectionForm.amount,unit:inputUnit as 'kg'|'L',date:rmCorrectionForm.date,note:rmCorrectionForm.note,mode:isStocktake?'stocktake':rmCorrectionForm.isNegative?'neg':'pos'}};
}
type Handle={actor:{uid:string|undefined;companyId:CompanyId;employeeId:string};owner:RawManualOwner|null;draft:RawManualDraft;copy:RawManualCopy|null;error:string;queue:Promise<void>;preSendEpoch:number};
export function useRawManualCorrection(context:RawManualContext&{onApplied?:()=>void;onBackdated?:()=>Promise<unknown>;onOpenDraft?:(material:string,originalId:string)=>void}){
 const [,paint]=useState(0),mounted=useRef(true),uid=auth.currentUser?.uid;
 const getSignal=useOutputScope(context.companyId,'raw-manual:'+context.employeeId);
 const latest=useRef(context);latest.current=context;
 const scope=useRef({companyId:context.companyId,employeeId:context.employeeId,uid});
 if(scope.current.companyId!==context.companyId||scope.current.employeeId!==context.employeeId||scope.current.uid!==uid)scope.current={companyId:context.companyId,employeeId:context.employeeId,uid};
 const actorScope=scope.current,holder=rawHolderByName(context.items,context.material,context.companyId);
 const uiScope=useRef(actorScope);
 const holderKey=JSON.stringify([actorScope,holder?.id??null,context.material]);
 const selectionRef=useRef({holderKey,originalId:context.originalId,generation:0});
 if(selectionRef.current.holderKey!==holderKey||selectionRef.current.originalId!==context.originalId)selectionRef.current={holderKey,originalId:context.originalId,generation:selectionRef.current.generation+1};
 const selection=selectionRef.current,uiSelection=useRef(selection);
 const handleRef=useRef<{key:string;value:Handle}|null>(null);
 const readInitial=():Handle=>{
  const owner=holder&&uid?{companyId:context.companyId,actorUid:uid,employeeId:context.employeeId,rawItemId:holder.id}:null;
  const h:Handle={actor:{uid,companyId:context.companyId,employeeId:context.employeeId},owner,draft:initialRawManualDraft(context.originalId??'',context.material),copy:null,error:'',queue:Promise.resolve(),preSendEpoch:0};
  try{if(owner){h.copy=readRawManualAttempt(owner);if(h.copy)h.draft=structuredClone(h.copy.entry.draft);}}catch(error){h.error=String(error);}return h;
 };
 if(!handleRef.current||handleRef.current.key!==holderKey)handleRef.current={key:holderKey,value:readInitial()};
 const h=handleRef.current.value;
 const handles=useRef(new Set<Handle>());handles.current.add(h);
 const checkpointBlocked=()=>!!actorScope.uid&&isSessionWorkChecking({uid:actorScope.uid,companyId:actorScope.companyId,employeeId:actorScope.employeeId});
 useEffect(()=>{if(!actorScope.uid)return;return registerSessionWork({uid:actorScope.uid,companyId:actorScope.companyId,employeeId:actorScope.employeeId},{name:'원료 수동정정',flush:async retry=>{
  const failures:string[]=[];
  await Promise.all([...handles.current].filter(handle=>handle.actor.uid===actorScope.uid&&handle.actor.companyId===actorScope.companyId&&handle.actor.employeeId===actorScope.employeeId).map(async handle=>{
   handle.preSendEpoch++;
   await handle.queue;
   if(retry&&handle.error&&handle.owner){try{handle.copy=await checkpointRawManualDraft(handle.owner,handle.copy?.encoded??null,structuredClone(handle.draft));handle.error='';}catch(error){handle.error=String(error);}}
   if(handle.error)failures.push(handle.error);
  }));
  if(failures.length)throw Error(failures.join('\n'));
 }});},[actorScope]);
 if(!h.copy&&!h.draft.originalId&&context.originalId)h.draft={...h.draft,originalId:context.originalId};
 const runOwner=useRef<symbol|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [recoveryOpen,setRecoveryOpen]=useState(false),[selected,setSelected]=useState<RawManualCopy|null>(null),[damagedText,setDamagedText]=useState('');
 const [confirmed,setConfirmed]=useState<{copy:RawManualCopy;result:RawManualCorrectionResult}|null>(null);
 const activeActor=()=>mounted.current&&scope.current===actorScope&&auth.currentUser?.uid===actorScope.uid;
 const refresh=()=>{if(activeActor())paint(n=>n+1);};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{uiScope.current=actorScope;runOwner.current=null;setBusy(false);setRecoveryOpen(false);setSelected(null);setDamagedText('');setConfirmed(null);setNotice('');},[actorScope]);
 useEffect(()=>{uiSelection.current=selection;runOwner.current=null;setBusy(false);setRecoveryOpen(false);setSelected(null);setDamagedText('');setNotice('');},[selection]);
 useEffect(()=>{const update=()=>refresh();window.addEventListener('storage',update);return()=>window.removeEventListener('storage',update);},[actorScope]);
 let entries:ReturnType<typeof listRawManualAttempts>=[];try{if(uid)entries=listRawManualAttempts({companyId:context.companyId,actorUid:uid,employeeId:context.employeeId});}catch(error){h.error=String(error);}
 const checkpoint=(draft:RawManualDraft)=>{
  const fixed=structuredClone(draft);h.draft=fixed;
  h.queue=h.queue.catch(()=>{}).then(async()=>{if(!h.owner)throw Error('원료 홀더와 로그인 계정을 확인한 뒤 다시 보관해 주세요.');const saved=await checkpointRawManualDraft(h.owner,h.copy?.encoded??null,fixed);h.copy=saved;h.error='';}).catch(error=>{h.error=String(error);}).then(()=>{if(activeActor()&&handleRef.current?.value===h)refresh();});
  refresh();return h.queue;
 };
 const updateDraft=(patch:Partial<RawManualDraft>)=>{if(checkpointBlocked()||!activeActor()||runOwner.current||h.copy&&h.copy.entry.state!=='draft')return;void checkpoint({...h.draft,...patch});};
 const flushDraft=async()=>{await h.queue;if(h.error)throw Error(h.error);};
 const readAgain=()=>{
  if(checkpointBlocked()||runOwner.current||!activeActor())return;
  try{if(h.owner){const copy=readRawManualAttempt(h.owner);h.copy=copy;const differs=copy?JSON.stringify(copy.entry.draft)!==JSON.stringify(h.draft):true;if(!h.error&&copy)h.draft=structuredClone(copy.entry.draft);else if(differs){h.error='현재 입력과 기기에 보관된 초안이 다릅니다. 입력은 보존했습니다. 현재 입력을 다시 보관한 뒤 저장해 주세요.';}else h.error='';}if(selected)setSelected(readRawManualAttempt(selected.entry.owner));setNotice('기기에 보관된 요청을 다시 읽었습니다. 현재 입력의 보관 상태와 처리 결과 조회는 별도로 확인해 주세요.');}catch(error){h.error=String(error);}refresh();
 };
 const run=async(action:'apply'|'inspect'|'cancel',source?:RawManualCopy)=>{
  if(checkpointBlocked()||runOwner.current||!activeActor())return;
  const owner=Symbol(),signal=getSignal();if(signal.aborted)return;runOwner.current=owner;setBusy(true);setNotice('');
  const targetHandle=h,runScope=actorScope,runSelection=selection;
  const current=()=>mounted.current&&scope.current===runScope&&selectionRef.current===runSelection&&handleRef.current?.value===targetHandle&&auth.currentUser?.uid===runScope.uid&&!signal.aborted;
  const preSendEpoch=h.preSendEpoch,canSend=()=>current()&&!checkpointBlocked()&&h.preSendEpoch===preSendEpoch;
  const blockedNotice=()=>{if(current()){setNotice('로그아웃 보관 확인이 시작되어 새 정정 요청을 전송하지 않았습니다. 입력과 보관 원문은 유지했습니다. '+(!h.copy||h.copy.entry.state==='draft'?'작업으로 돌아간 뒤 명시적으로 다시 저장할 수 있습니다.':'보관된 요청의 결과 조회 또는 명시 작업을 선택해 주세요.'));setRecoveryOpen(true);refresh();}};
  const beforeSend=()=>{if(action==='inspect'?current():canSend())return true;blockedNotice();return false;};
  let sent=false;
  try{
   await h.queue;if(!beforeSend())return;if(h.error&&!source)throw Error(h.error);
   let copy=source??h.copy;
   if(!copy){if(action!=='apply')throw Error('보관된 최초 요청을 먼저 선택해 주세요.');await checkpoint(h.draft);if(!beforeSend())return;if(h.error)throw Error(h.error);copy=h.copy;}
   if(!copy)throw Error('요청 보관을 확인하지 못했습니다.');
   if(copy.entry.owner.actorUid!==runScope.uid||copy.entry.owner.companyId!==runScope.companyId||copy.entry.owner.employeeId!==runScope.employeeId)throw Error('현재 계정의 보관 요청을 선택해 주세요.');
   if(copy.entry.state==='draft'){
    if(action!=='apply')throw Error('전송 전 초안입니다. 저장하거나 입력을 계속할 수 있습니다.');
    if(copy.entry.owner.rawItemId===h.owner?.rawItemId&&JSON.stringify(copy.entry.draft)!==JSON.stringify(h.draft))throw Error('현재 입력과 보관된 초안이 다릅니다. 현재 입력을 다시 보관한 뒤 저장해 주세요.');
    const request=buildRawManualCorrection(latest.current,copy.entry.draft,runScope.uid!);
    copy=await prepareRawManualAttempt(copy.entry.owner,copy,request,canSend);if(!beforeSend())return;h.copy=copy;
   }
   if(copy.entry.state==='terminal'&&action==='apply')throw Error('이미 처리 결과를 확인했습니다. 새 정정은 명시적으로 새 작업을 시작해 주세요.');
   const packet=copy.entry.request;if(!packet)throw Error('최초 송신 원문이 없습니다.');
   if((action==='apply'||action==='cancel')&&copy.entry.state!=='terminal')copy=await submitRawManualAttempt(copy.entry.owner,copy,canSend);
   if(!beforeSend())return;if(copy.entry.owner.rawItemId===h.owner?.rawItemId)h.copy=copy;
   setSelected(copy);refresh();
   const result=await rawManualCorrection(action,packet,{signal,isCurrent:current,beforeSend:()=>{if(!current()||action!=='inspect'&&!canSend())throw Error('로그아웃 보관 확인 또는 화면 변경으로 아직 요청을 전송하지 않았습니다.');sent=true;}});if(!current())return;
   let saved:RawManualCopy;
   try{saved=await recordRawManualResult(copy.entry.owner,copy,result,current);}
   catch(error){if(!current())return;if(!(error instanceof RawManualCasConflict)&&['applied','cancelled','rejected'].includes(result.status)){setConfirmed({copy,result});setSelected(copy);setNotice(result.message+' 서버 처리 결과는 확인했지만 기기 기록을 갱신하지 못했습니다. 원문은 보존했습니다. 결과 조회 또는 확인 결과 다시 보관을 선택해 주세요.');setRecoveryOpen(true);return;}throw error;}
   if(!current())return;setConfirmed(null);
   if(saved.entry.owner.rawItemId===h.owner?.rawItemId)h.copy=saved;
   setSelected(saved);setNotice(result.message);setRecoveryOpen(true);refresh();
   if(result.status==='applied'){
    if(result.movement?.backdatedBeforeStocktake){await latest.current.onBackdated?.();if(!current())return;}
    if(!latest.current.originalId||latest.current.originalId===packet.display.originalId)latest.current.onApplied?.();
   }
  }catch(error){if(current()){if(!sent&&action!=='inspect'&&!canSend())blockedNotice();else{setNotice(sent?'정정 요청의 처리 결과를 확인하지 못했습니다. '+String(error)+' 입력과 최초 요청 번호는 보존했습니다. 보관된 요청에서 결과 조회를 선택해 주세요.':String(error));setRecoveryOpen(true);refresh();}}}
  finally{if(runOwner.current===owner){runOwner.current=null;if(mounted.current&&scope.current===runScope)setBusy(false);}}
 };
 const startNew=async(copy:RawManualCopy)=>{
  if(checkpointBlocked()||runOwner.current||!activeActor())return;
  const owner=Symbol();runOwner.current=owner;setBusy(true);
  const signal=getSignal(),capturedSelection=selection,current=()=>activeActor()&&selectionRef.current===capturedSelection&&!signal.aborted;
  try{const draft={...copy.entry.draft,originalId:context.originalId??copy.entry.draft.originalId};const saved=await newRawManualDraft(copy.entry.owner,copy,draft,current);if(!current())return;if(h.owner?.rawItemId===saved.entry.owner.rawItemId){h.copy=saved;h.draft=structuredClone(saved.entry.draft);}latest.current.onOpenDraft?.(saved.entry.draft.material,saved.entry.draft.originalId);setSelected(saved);setRecoveryOpen(false);setNotice('보관된 입력을 새 초안으로 열었습니다. 다음 저장은 새 정정 요청입니다.');refresh();}catch(error){if(current())setNotice(String(error));}
  finally{if(runOwner.current===owner){runOwner.current=null;if(activeActor())setBusy(false);}}
 };
 const retryConfirmed=async()=>{if(checkpointBlocked()||!confirmed||runOwner.current||!activeActor())return;const symbol=Symbol();runOwner.current=symbol;setBusy(true);const signal=getSignal(),capturedSelection=selection,current=()=>activeActor()&&selectionRef.current===capturedSelection&&!signal.aborted;try{const actual=readRawManualAttempt(confirmed.copy.entry.owner);if(!actual?.entry.request||JSON.stringify(actual.entry.request)!==JSON.stringify(confirmed.copy.entry.request))throw new RawManualCasConflict('다른 창의 새 요청을 덮지 않았습니다. 보관 요청을 다시 읽어 주세요.');const saved=await recordRawManualResult(actual.entry.owner,actual,confirmed.result,current);if(!current())return;if(h.owner?.rawItemId===saved.entry.owner.rawItemId)h.copy=saved;setSelected(saved);setConfirmed(null);setNotice('확인된 서버 결과를 이 기기에 보관했습니다.');refresh();}catch(error){if(current()){if(error instanceof RawManualCasConflict)setConfirmed(null);setNotice(String(error));}}finally{if(runOwner.current===symbol){runOwner.current=null;if(activeActor())setBusy(false);}}};
 const showUI=uiScope.current===actorScope&&uiSelection.current===selection;
 const sameOwner=(copy:RawManualCopy)=>copy.entry.owner.companyId===actorScope.companyId&&copy.entry.owner.actorUid===actorScope.uid&&copy.entry.owner.employeeId===actorScope.employeeId;
 return{draft:h.draft,busy:showUI&&busy,notice:showUI?notice:'',storageError:h.error,copy:h.copy,entries,recoveryOpen:showUI&&recoveryOpen,selected:showUI&&selected&&sameOwner(selected)?selected:null,damagedText:showUI?damagedText:'',confirmed:showUI&&confirmed&&sameOwner(confirmed.copy)?confirmed:null,retryConfirmed,
  updateDraft,flushDraft,retryCheckpoint:()=>checkpoint(h.draft),readAgain,run,startNew,
  openRecovery:()=>{if(activeActor()){setSelected(null);setRecoveryOpen(true);}},closeRecovery:()=>{if(!busy&&activeActor())setRecoveryOpen(false);},
  select:(copy:RawManualCopy|null,encoded='')=>{if(!busy&&activeActor()){setSelected(copy);setDamagedText(encoded);}},
  openDraft:(copy:RawManualCopy)=>{if(!busy&&activeActor()&&copy.entry.state==='draft'){latest.current.onOpenDraft?.(copy.entry.draft.material,copy.entry.draft.originalId);setRecoveryOpen(false);}},
  originalText:()=>{try{return h.owner?readRawManualOriginal(h.owner)||JSON.stringify(h.draft):JSON.stringify(h.draft);}catch{return JSON.stringify(h.draft);}},
  localDraftText:JSON.stringify(h.draft),editable:!busy&&(!h.copy||h.copy.entry.state==='draft')};
}
