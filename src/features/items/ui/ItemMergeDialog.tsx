import React, { useEffect, useRef, useState } from 'react';
import type { CompanyId } from '../../../shared/types';
import ModalShell from '../../../shared/components/ModalShell';
import { appConfirm } from '../../../shared/components/appDialog';
import type { CatalogItemMergeRequest } from '../../../shared/services/catalogItemMergeCommands';
type Service = typeof import('../../../shared/services/catalogItemMergeCommands');
type Props = { companyId: CompanyId; keepId: string; donorIds: string[]; itemName?: string; onClose: () => void; onApplied: (request: CatalogItemMergeRequest | null) => void | Promise<void> };
export function ItemMergeDialog(props: Props) {
 const [service,setService]=useState<Service|null>(null),[uid,setUid]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let live=true,stop=()=>{};void import('../../../shared/services/catalogItemMergeCommands').then(module=>{if(live){setService(module);stop=module.watchCatalogItemMergeActor(value=>{if(live)setUid(value);});}}).catch(()=>{if(live)setError('통합 확인창을 열지 못했습니다. 닫고 다시 시도하세요.');});return()=>{live=false;stop();};},[]);
 if(!service||!uid)return <ModalShell title="중복 품목 통합 확인" onClose={props.onClose}><p>{error||'현재 회사의 관리자 로그인 상태를 확인하고 있습니다.'}</p></ModalShell>;
 return <MergeBody key={props.companyId+':'+uid+':'+props.keepId+':'+props.donorIds.join(',')} {...props} service={service} uid={uid}/>;
}
const actionText:Record<string,string>={'review-item':'품목 관리에서 유형·단위·거래처 연결을 확인하세요.','review-inventory':'재고·로트·예약 내역을 먼저 확인하세요.','review-orders':'진행 주문·발주·반품 업무를 먼저 정리하세요.','review-bom':'배합·포장 구성을 먼저 확인하세요.',reload:'목록을 다시 읽고 통합 대상을 줄여 확인하세요.'};
const fieldName:Record<string,string>={price:'단가',taxType:'세금',packing:'포장',box:'박스',tape:'테이프',shipToIds:'배송지'};
const display=(value:unknown)=>value===undefined?'미설정':typeof value==='string'?value:JSON.stringify(value);
function MergeBody({companyId,keepId,donorIds,itemName,onClose,onApplied,service,uid}:Props&{service:Service;uid:string}) {
 const scope={companyId,actorUid:uid};
 const [preview,setPreview]=useState<Awaited<ReturnType<Service['previewCatalogItemMerge']>>|null>(null),[choices,setChoices]=useState<Record<string,string>>({});
 const [attempts,setAttempts]=useState<ReturnType<Service['listCatalogItemMergeAttempts']>>([]),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[applied,setApplied]=useState(false);
 const live=useRef(true),lock=useRef(false);
 const current=()=>live.current;
 const refresh=()=>{if(current())setAttempts(service.listCatalogItemMergeAttempts(scope));};
 async function run(work:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work();}catch(failure){if(current())setError(failure instanceof Error?failure.message:'처리 결과를 확인하지 못했습니다. 최초 요청을 보존했습니다.');}finally{lock.current=false;if(current()){setBusy(false);try{refresh();}catch{setError('보관 요청을 읽지 못했습니다. 원문을 보존하고 관리자에게 확인하세요.');}}}}
 async function inspect(){await run(async()=>{const rows=service.listCatalogItemMergeAttempts(scope);if(!current())return;setAttempts(rows);if(rows.some(entry=>service.catalogItemMergeAttemptBlocks(entry,keepId,donorIds))){setMessage('선택한 품목과 겹치거나 범위를 확인할 수 없는 이전 요청입니다. 결과를 먼저 확인하거나 요청을 중단하세요.');return;}const result=await service.previewCatalogItemMerge(scope,keepId,donorIds,current);if(current()){setPreview(result);setChoices({});setMessage('서버에서 확인한 현재 상태입니다. 연결 원문과 통합할 품목을 확인하세요.');}});}
 useEffect(()=>{live.current=true;void inspect();return()=>{live.current=false;};},[]);
 const close=()=>{live.current=false;onClose();};
 async function acknowledge(result:Awaited<ReturnType<Service['applyCatalogItemMerge']>>,request:CatalogItemMergeRequest|null){if(!current())return;setMessage(result.message);if(result.status==='applied'){setApplied(true);try{await onApplied(request);if(current())close();}catch{if(current())setError('통합은 완료됐지만 목록을 갱신하지 못했습니다. 다시 통합하지 말고 창을 닫아 목록을 새로 확인하세요.');}}else if(result.status==='unknown')setMessage(result.message+' 처리되지 않았다고 단정하지 마세요. 아래에서 같은 요청을 확인하거나 중단할 수 있습니다.');}
 const blockingAttempts=attempts.filter(entry=>service.catalogItemMergeAttemptBlocks(entry,keepId,donorIds));
 const canApply=!!preview?.releaseId&&!busy&&!applied&&!blockingAttempts.length&&preview.plan.phase!=='blocked'&&!preview.plan.blockers.length&&preview.plan.groups.every(group=>!!(choices[group.destinationKey]||group.selectedSourceLinkId));
 async function apply(){if(!canApply||!preview)return;await run(async()=>{if(!await appConfirm(`남길 품목 ${itemName||keepId}에 선택한 ${donorIds.length}개 품목의 거래처 연결을 통합합니까?\n남길 품목의 재고와 과거 거래 내역은 바꾸지 않습니다. 통합 대상 품목은 삭제되며 되돌리기는 제공하지 않습니다.`)||!current())return;const request:CatalogItemMergeRequest={version:1,companyId,operationId:crypto.randomUUID(),releaseId:preview.releaseId!,keepId,donorIds,snapshotDigest:preview.snapshotDigest,resolutions:Object.entries(choices).map(([destinationKey,sourceLinkId])=>({destinationKey,sourceLinkId}))};await acknowledge(await service.applyCatalogItemMerge(scope,request,current),request);});}
 async function recover(entry:ReturnType<Service['listCatalogItemMergeAttempts']>[number],mode:'inspect-request'|'apply'|'discard-request'){await run(async()=>{if(mode==='discard-request'&&!await appConfirm('이 통합 요청을 중단합니까? 서버에서 늦은 적용을 봉쇄한 뒤 보관 원문을 정리합니다. 이미 통합된 품목은 복원하지 않습니다.'))return;if(!current())return;const result=await service.recoverCatalogItemMerge(scope,entry,mode,current);await acknowledge(result,entry.request);if(current()&&mode==='discard-request'&&result.status!=='unknown'){setPreview(null);setChoices({});setMessage(result.message+' 보관 요청이 정리되면 현재 상태를 다시 확인하세요.');}});}
 return <ModalShell title="중복 품목 통합 확인" subtitle={itemName||'서버 확인 후 통합'} onClose={close}>
  <div className="space-y-4 text-sm [&_button]:min-h-10 [&_button]:rounded-lg [&_button]:border [&_button]:border-gray-300 [&_button]:px-3 [&_button:disabled]:opacity-40">
   <p>남길 품목은 유지하고 통합 대상 {donorIds.length}개를 정리합니다. 단가·세금·포장이 다르면 남길 연결 원문을 직접 선택하세요.</p>
   <details><summary>선택한 품목 번호</summary><p>남길 품목: {keepId}</p><p>통합 대상: {donorIds.join(', ')}</p></details>
   {error&&<p role="alert" className="whitespace-pre-wrap text-red-700">{error}</p>}{message&&<p role="status" className="whitespace-pre-wrap">{message}</p>}
   {preview&&<>
    {!!preview.plan.blockers.length&&<section aria-label="통합을 막는 원인" className="space-y-2">{preview.plan.blockers.map((row,index)=><div key={index} className="border-t border-gray-200 pt-2"><p>{row.message}</p><p className="text-gray-600">{actionText[row.nextAction]}</p><details><summary>관련 번호</summary>{row.itemId} · {row.documentIds.join(', ')}</details></div>)}</section>}
    {preview.plan.groups.map(group=><fieldset key={group.destinationKey} disabled={busy||applied||!!blockingAttempts.length} className="min-w-0 space-y-2 border-t border-gray-200 pt-3"><legend className="max-w-full break-words font-semibold">{preview.candidateLinks.find(row=>row.partnerId===group.partnerId)?.partnerName||'거래처 이름 미확인'} · {group.direction==='in'?'매입':'매출'}</legend>
      <p>{group.differingFields.length?'차이가 있는 항목: '+group.differingFields.map(field=>fieldName[field]||field).join(', '):'연결 내용이 같습니다. 같은 원문 한 건을 유지합니다.'}</p>
      {group.candidateLinkIds.map(id=>{const candidate=preview.candidateLinks.find(row=>row.id===id);return candidate&&<label key={id} className="block rounded-lg border border-gray-200 p-3"><input type="radio" name={group.destinationKey} aria-label={'남길 연결 '+id} checked={(choices[group.destinationKey]||group.selectedSourceLinkId)===id} onChange={()=>setChoices(previous=>({...previous,[group.destinationKey]:id}))}/> {candidate.itemName||candidate.itemId}{candidate.itemId===keepId?' · 남길 품목':' · 통합 대상'}<p>단가: {display(candidate.business.price)} · 세금: {display(candidate.business.taxType)}</p><p className="break-words">포장: {display(candidate.business.packing)}</p><details><summary>연결 원문·기타 설정</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(candidate.business,null,2)}</pre></details></label>;})}
    </fieldset>)}
    {!preview.releaseId&&<p>현재 배포 상태를 확인할 수 없습니다. 잠시 후 다시 확인하세요.</p>}
   </>}
   <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||applied||!!blockingAttempts.length} onClick={()=>void inspect()}>현재 상태 다시 확인</button><button type="button" disabled={!canApply} onClick={()=>void apply()}>{busy?'처리 중…':'확인하고 통합'}</button></div>
   <section aria-label="이전 통합 요청" className="space-y-3 border-t border-gray-200 pt-3"><h4 className="font-semibold">이전 통합 요청</h4>{!attempts.length&&<p>보관 요청 없음</p>}{attempts.map(entry=><div key={entry.key} className="space-y-2 border-t border-gray-200 pt-2"><p>{entry.error||'처리 결과를 확인할 요청이 있습니다.'}</p><p>거절된 요청은 ‘요청 중단·정리’로 정리한 뒤 새로 확인할 수 있습니다. 미확정 요청은 서버 확인 전 삭제하지 않습니다.</p><div className="flex flex-wrap gap-2"><button disabled={busy||!entry.reference} onClick={()=>void recover(entry,'inspect-request')}>처리 결과 확인</button>{entry.request&&<button disabled={busy} onClick={()=>void recover(entry,'apply')}>같은 원문으로 재시도</button>}<button disabled={busy||!entry.reference} onClick={()=>void recover(entry,'discard-request')}>요청 중단·정리</button></div><details><summary>작업 번호·보낸 원문</summary><p>{entry.reference?.operationId||'번호 미확인'}</p><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{entry.text}</pre></details></div>)}</section>
  </div>
 </ModalShell>;
}
