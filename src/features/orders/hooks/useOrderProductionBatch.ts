import { useCallback, useEffect, useRef, useState } from 'react';
import type { BatchIntent, BatchOpenResponse, BatchReversalOpenResult, BatchLocator, BatchResult } from '../../../../functions/src/shared/orderProductionBatchContract';
import type { BatchScope, RetainedBatch, createOrderProductionBatchWrites } from '../../../shared/services/orderProductionBatchWrites';

type Writes=ReturnType<typeof createOrderProductionBatchWrites>;
type State={opening:BatchOpenResponse|BatchReversalOpenResult|null;entry:RetainedBatch|null;retained:RetainedBatch[];issues:number;result:BatchResult|null;busy:boolean;error:string;unknown:boolean};
const empty=():State=>({opening:null,entry:null,retained:[],issues:0,result:null,busy:false,error:'',unknown:false});
/** 같은 계정·회사·선택 세대의 응답만 화면에 반영한다. */
export function useOrderProductionBatch(scope:BatchScope,writes:Writes) {
  const owner=`${scope.companyId}\0${scope.actorUid}\0${scope.generation}`;
  const ownerRef=useRef(owner), epoch=useRef(0), lock=useRef(false);
  const [state,setState]=useState<State>(empty);
  const ownerChanged=ownerRef.current!==owner;
  if(ownerChanged){ownerRef.current=owner;epoch.current++;lock.current=false;}
  useEffect(()=>{setState(empty());return()=>{epoch.current++;lock.current=false}},[owner,writes]);
  const run=useCallback(async<T,>(work:()=>Promise<T>,success:(value:T)=>void,unknownOnFailure=false)=>{
    if(lock.current||ownerRef.current!==owner)return;lock.current=true;const token=epoch.current,expectedOwner=owner;setState(old=>({...old,busy:true,error:''}));
    try{const value=await work();if(epoch.current===token&&ownerRef.current===expectedOwner)success(value);}
    catch(error){if(epoch.current===token&&ownerRef.current===expectedOwner)setState(old=>({...old,error:error instanceof Error?error.message:String(error),unknown:unknownOnFailure||old.unknown}));}
    finally{if(epoch.current===token&&ownerRef.current===expectedOwner){lock.current=false;setState(old=>({...old,busy:false}));}}
  },[owner]);
  const open=useCallback((orderId:string,ids:string[])=>run(()=>writes.open(scope,orderId,ids),opening=>setState(old=>({...old,opening}))),[run,writes,scope]);
  const openReversal=useCallback((source:BatchLocator,batchId:string)=>run(async()=>{const opening=await writes.openReversal(scope,source);if(opening.reversibleBatches.length!==1||opening.reversibleBatches[0].batchId!==batchId)throw Error('선택한 생산 내역이 바뀌었습니다. 다시 확인해 주세요.');return opening;},opening=>setState(old=>({...old,opening}))),[run,writes,scope]);
  const start=useCallback((intent:BatchIntent)=>run(async()=>{if(state.entry||(state.opening?.state==='open'&&state.opening.activeRequest)||state.opening?.state==='active')throw Error('이전 요청의 결과를 먼저 확인해 주세요.');if(!state.opening||state.opening.companyId!==scope.companyId||(state.opening.state==='open'?state.opening.orderId!==intent.reference.orderId:(intent.action!=='reverse-production-batch'||JSON.stringify(state.opening.source)!==JSON.stringify(intent.reversalSource)||state.opening.source.reference.orderId!==intent.reference.orderId||!state.opening.reversibleBatches.some(row=>row.batchId===intent.batchId)))||state.opening.opening.token!==intent.opening.token||!state.opening.allowedActions.includes(intent.action as never))throw Error('현재 주문의 서버 확인 내용을 다시 불러와 주세요.');const token=epoch.current;const entry=await writes.retain(scope,intent);if(ownerRef.current!==owner||epoch.current!==token)throw Error('계정 또는 선택이 바뀌었습니다.');setState(old=>({...old,entry,unknown:true}));return writes.prepare(scope,entry)},result=>setState(old=>({...old,result,unknown:result.state==='unknown'}))),[run,writes,scope,state.entry,state.opening,owner]);
  const refresh=useCallback(()=>run(()=>writes.readRetained(scope),found=>setState(old=>({...old,retained:found.entries,issues:found.issues.length}))),[run,writes,scope]);
  const select=useCallback((entry:RetainedBatch)=>{if(lock.current)return;setState(old=>old.retained.some(item=>item.key===entry.key&&item.original===entry.original)?{...old,entry,result:null,error:'',unknown:true}:old)},[]);
  const inspect=useCallback(()=>state.entry&&run(()=>writes.inspect(scope,state.entry!),result=>setState(old=>({...old,result,unknown:result.state==='unknown'})),true),[run,writes,scope,state.entry]);
  const cancel=useCallback(()=>state.entry&&run(()=>writes.cancel(scope,state.entry!),result=>setState(old=>({...old,result,unknown:result.state==='unknown'})),true),[run,writes,scope,state.entry]);
  const cleanup=useCallback(()=>state.entry&&run(()=>writes.clearVerified(scope,state.entry!),receipt=>setState(old=>({...old,entry:null,result:old.result?.state==='applied'||old.result?.state==='cancelled'?old.result:receipt,unknown:false,retained:old.retained.filter(row=>row.key!==state.entry!.key)}))),[run,writes,scope,state.entry]);
  const apply=useCallback(()=>state.entry&&state.result?.state==='reserved'&&state.result.canApply&&state.result.planHash&&run(()=>writes.apply(scope,state.entry!,state.result!.planHash!),result=>setState(old=>({...old,result,unknown:result.state==='unknown'})),true),[run,writes,scope,state.entry,state.result]);
  return {...(ownerChanged?empty():state),open,openReversal,start,refresh,select,inspect,cancel,cleanup,apply};
}
