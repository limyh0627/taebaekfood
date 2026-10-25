import {useEffect,useRef,useState} from 'react';
import {auth} from '../../../shared/firebase';
import {useOutputScope} from '../../../shared/hooks/useOutputScope';
import {beginNewItemInventoryAttempt,listItemInventoryAttempts,assertItemInventoryAttempt,cancelPreparedItemInventoryAttempt,deleteItemInventoryAttempt,bindItemInventoryAttemptScope,ItemInventoryConflictError,type ItemInventoryRequest,type ItemInventoryRetained,type ItemInventoryOutcome} from '../../../shared/itemInventoryAttempt';
import {productStocktakeActor,durableCanUnpack} from '../../../shared/services/unpackService';
import {durableItemStockAdd} from '../../../shared/services/itemStockAddService';
import {durableBoxUnpack} from '../../../shared/services/boxUnpackService';
import {unpackSummary} from '../../../shared/canUnpack';
import {appConfirm} from '../../../shared/components/appDialog';
import type {CompanyId} from '../../../shared/types';

/** 재고 계산은 기존 writer가 맡고 최초 요청과 화면 실행 수명만 보관한다. */
export function useItemInventoryRecovery({companyId,notice}:{companyId:CompanyId;notice:(message:string)=>void}) {
  const mounted=useRef(true),scope=useRef({companyId,uid:auth.currentUser?.uid,epoch:0});
  if(scope.current.companyId!==companyId||scope.current.uid!==auth.currentUser?.uid)scope.current={companyId,uid:auth.currentUser?.uid,epoch:scope.current.epoch+1};
  const getSignal=useOutputScope(companyId,'item-inventory-recovery');
  const busyRef=useRef<symbol|null>(null);
  const [busy,setBusy]=useState(false),[,refresh]=useState(0);
  const [recoveryOpen,setRecoveryOpen]=useState(false),[selection,setSelection]=useState<ItemInventoryRetained|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setRecoveryOpen(false);setSelection(null);refresh(value=>value+1);const update=()=>refresh(value=>value+1);window.addEventListener('storage',update);return()=>window.removeEventListener('storage',update);},[companyId,auth.currentUser?.uid]);
  const pending=auth.currentUser?.uid?listItemInventoryAttempts(companyId,auth.currentUser.uid):[];
  const isCurrentActor=()=>auth.currentUser?.uid===scope.current.uid&&companyId===scope.current.companyId;
  const captureContextCurrent=()=>{const captured=scope.current,uid=auth.currentUser?.uid,signal=getSignal();return()=>mounted.current&&!signal.aborted&&scope.current===captured&&auth.currentUser?.uid===uid;};
  const invalidateAttemptContext=()=>{scope.current={...scope.current,epoch:scope.current.epoch+1};return scope.current;};
  const isContextCurrent=(token:unknown)=>scope.current===token&&isCurrentActor();
  const inventoryLabel = (kind: ItemInventoryRequest['kind']) => kind === 'stock-add' ? '재고 추가' : kind === 'can-unpack' ? '캔 개봉' : '박스 개봉';
  const inventoryRequestSummary = (request: ItemInventoryRequest) => request.kind === 'stock-add'
    ? request.rows.map(row => row.itemName + ' +' + row.deltaQty).join(', ')
    : request.kind === 'can-unpack' ? unpackSummary(request.plan) + ' (개당 ' + request.plan.perCan + 'kg)'
    : (request.boxItemName || '박스') + ' 1개 → ' + (request.unitItemName || '낱개') + ' +' + request.count + '개';
  const run = async (kind: ItemInventoryRequest['kind'], build?: () => Parameters<typeof beginNewItemInventoryAttempt>[0], selected?:ItemInventoryRetained) => {
    if (busyRef.current || !mounted.current) return false;
    const owner = Symbol(); busyRef.current = owner; setBusy(true);
    const uid = auth.currentUser?.uid, active = captureContextCurrent();
    if (!active()) { busyRef.current = null; setBusy(false); return false; }
    try {
      if (!uid) throw Error('로그인 후 재고 작업을 진행해 주세요.');
      if(!navigator.locks?.request)throw Error('이 브라우저는 창 간 안전 잠금을 지원하지 않습니다. 지원되는 브라우저에서 진행해 주세요.');
      if(build){await productStocktakeActor(companyId,uid,true);if(!active())return false;}
      const retained=selected??(build?await beginNewItemInventoryAttempt(build(),active):null);
      if(!retained||retained.request.kind!==kind)throw Error('실패 작업에서 확인할 최초 요청을 선택해 주세요.');
      assertItemInventoryAttempt(retained);      if (active()) refresh(value => value + 1);
      const {request} = retained;
      await productStocktakeActor(companyId,uid,true);
      if (!active()) return false;
      if (retained.state === 'prepared') {
        const accepted = await appConfirm(inventoryLabel(kind) + ' — ' + inventoryRequestSummary(request) + '\n보존된 최초 입력으로 처리할까요?');
        await productStocktakeActor(companyId,uid,true);
        if (!active()) return false;
        if (!accepted) { await cancelPreparedItemInventoryAttempt(retained,active); if (!active()) return false; refresh(value => value + 1); return false; }
      }
      if (!active()) return false;
      const release=bindItemInventoryAttemptScope(request,active);let result:ItemInventoryOutcome;
      try{result=request.kind === 'stock-add' ? await durableItemStockAdd(request)
        : request.kind === 'can-unpack' ? await durableCanUnpack(request) : await durableBoxUnpack(request);}finally{release();}
      if (!active()) return false;
      refresh(value => value + 1); notice(result.message);if(!result.ok&&result.retainPending){setSelection(listItemInventoryAttempts(companyId,uid).find(entry=>entry.retained?.request.operationId===request.operationId)?.retained??retained);setRecoveryOpen(true);}else if(result.ok)setSelection(null);
      return result.ok;
    } catch (error) {
      if (active()) { if(error instanceof ItemInventoryConflictError){setSelection(error.entries[0]?.retained??null);setRecoveryOpen(true);}notice(String(error)); refresh(value => value + 1); }
      return false;
    } finally {
      if (busyRef.current === owner) {
        busyRef.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  };

  let selectedValid=true;if(selection)try{assertItemInventoryAttempt(selection);}catch{selectedValid=false;}
  const hideSelected=async()=>{
    const retained=selection,active=captureContextCurrent();
    if(!retained||busyRef.current||!active()||auth.currentUser?.uid!==retained.request.uid||companyId!==retained.request.companyId)return;
    const owner=Symbol();busyRef.current=owner;setBusy(true);
    try{await deleteItemInventoryAttempt(retained,active);if(active()){refresh(value=>value+1);setSelection(null);}}
    catch(error){if(active())notice(String(error));}
    finally{if(busyRef.current===owner){busyRef.current=null;if(mounted.current)setBusy(false);}}
  };
  return {busy,recoveryOpen,selection,selectedValid,pending,run,hideSelected,
    openRecovery:()=>{setSelection(null);setRecoveryOpen(true);},selectAttempt:setSelection,
    closeRecovery:()=>{if(!busy){if(selection)setSelection(null);else setRecoveryOpen(false);}},
    invalidateAttemptContext,captureContextCurrent,isCurrentActor,isContextCurrent,contextToken:scope.current,
    inventoryLabel,inventoryRequestSummary};
}
