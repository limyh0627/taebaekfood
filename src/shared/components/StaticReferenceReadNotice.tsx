import React,{useEffect,useRef,useState} from 'react';
import ModalShell from './ModalShell';
import type {StaticReferenceReadState} from '../hooks/useStaticReferenceRead';
const labels={core:'품목 구성·포장·원료식',terms:'거래처 품목 연결·단가',finance:'계정·비용 기준정보'};
export default function StaticReferenceReadNotice({read,onPrepareInventory}:{read:StaticReferenceReadState|undefined;onPrepareInventory?:()=>boolean|void|Promise<boolean|void>}){
 const prepareRun=useRef<symbol|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;prepareRun.current=null;};},[]);
 const latestOwner=useRef(read?.ownerKey);latestOwner.current=read?.ownerKey;
 const [prepareError,setPrepareError]=useState(''),[preparing,setPreparing]=useState(false);
 const [opened,setOpened]=useState<{owner:string}|null>(null),open=!!read&&opened?.owner===read.ownerKey;
 useEffect(()=>{prepareRun.current=null;setOpened(null);setPrepareError('');setPreparing(false);},[read?.ownerKey]);
 useEffect(()=>{if(read?.inventory?.reviewRequest)setOpened({owner:read.ownerKey});},[read?.ownerKey,read?.inventory?.reviewRequest]);
 if(!read)return null;
 const entries=(Object.keys(labels) as (keyof typeof labels)[]).filter(key=>key!=='finance'||read.groups.finance.status!=='idle'),errors=entries.filter(key=>read.groups[key].status==='error'),busy=entries.some(key=>['loading','refreshing'].includes(read.groups[key].status));
 const close=()=>{prepareRun.current=null;setOpened(null);setPreparing(false);};
 const prepare=async()=>{if(!onPrepareInventory||prepareRun.current)return;const run=Symbol();prepareRun.current=run;const owner=read.ownerKey,current=()=>alive.current&&latestOwner.current===owner&&prepareRun.current===run;setPreparing(true);setPrepareError('');try{const result=await onPrepareInventory();if(current()&&result!==false)setOpened(null);}catch{if(current())setPrepareError('기준정보가 다시 바뀌었거나 원래 작업을 확인하지 못했습니다. 선택은 유지했습니다. 다시 조회한 뒤 준비해 주세요.');}finally{if(current()){prepareRun.current=null;setPreparing(false);}}};
 const retry=()=>{void (read.inventory?.refresh??read.refresh)().catch(()=>{});};
 return <>{(errors.length>0||read.inventory?.items.status==='error'||read.inventory?.blocked)&&<div className="my-2 flex items-center gap-2 text-xs text-slate-600"><span>일부 기준정보를 갱신하지 못했습니다.</span><button type="button" onClick={()=>setOpened({owner:read.ownerKey})} className="rounded border border-slate-200 bg-white px-3 py-2 text-slate-800">기준정보 확인</button></div>}
 {open&&<ModalShell layer={2100} title="기준정보 조회 확인" onClose={close} footer={<div className="flex flex-wrap justify-end gap-2">{onPrepareInventory&&read.inventory?.items.status==='ready'&&read.groups.core.status==='ready'&&<button type="button" disabled={busy||preparing} onClick={()=>void prepare()} className="rounded border border-slate-200 px-4 py-2">재고 선택 다시 준비</button>}<button type="button" onClick={close} className="rounded border border-slate-200 px-4 py-2">작업으로 돌아가기</button><button type="button" disabled={busy||read.inventory?.items.status==='loading'} onClick={retry} className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">{busy||read.inventory?.items.status==='loading'?'조회 중…':'다시 조회'}</button></div>}>
 {prepareError&&<p role="alert" className="mb-3 text-sm text-slate-700">{prepareError}</p>}
 <p className="mb-4 text-sm text-slate-600">저장한 내용은 다시 전송하지 않습니다. 기준정보만 다시 불러옵니다.</p>
 {read.inventory&&<section className="border-t border-slate-200 py-3"><h4 className="text-sm font-semibold text-slate-900">품목 재고 기준정보</h4><p className="mt-1 text-sm text-slate-600">{read.inventory.items.status==='ready'?'서버에서 품목을 확인했습니다. 새로 작업을 준비해 주세요.':read.inventory.items.error||'아직 서버에서 품목을 확인하지 못했습니다.'}</p></section>}
 {entries.map(key=>{const group=read.groups[key];return <section key={key} className="border-t border-slate-200 py-3"><h4 className="text-sm font-semibold text-slate-900">{labels[key]}</h4><p className="mt-1 text-sm text-slate-600">{group.status==='ready'?'서버에서 조회를 완료했습니다.':group.status==='error'?group.error:busy?'조회하고 있습니다.':'아직 서버에서 확인하지 못했습니다.'}</p>{group.status!=='ready'&&<p className="mt-1 text-xs text-slate-500">{group.hasPrevious?'마지막으로 조회한 자료를 유지하고 있습니다.':'아직 확인된 자료가 없습니다. 빈 목록으로 확정하지 않았습니다.'}</p>}</section>;})}
 {read.serverReady&&(!read.inventory||read.inventory.items.status==='ready')&&<p role="status" className="mt-3 text-sm text-slate-700">조회가 완료됐습니다. 창을 닫고 하던 작업을 계속해 주세요.</p>}
 </ModalShell>}</>;
}
