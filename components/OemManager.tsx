import type { Props, IssueInput, ReceiveInput } from '../src/features/oem/domain/oemManager';
import { formatNumberKo as fmt } from '../src/shared/numberDisplay';
import { IssueModal } from '../src/features/oem/ui/OemIssueModal';
import { ReceiveModal } from '../src/features/oem/ui/OemReceiveModal';
import { FeeModal } from '../src/features/oem/ui/OemFeeModal';
export {OemExternalEvidenceRows} from '../src/features/oem/ui/OemIssueModal';
import React, { useMemo, useRef, useState } from 'react';
import { isBulkItem } from '../src/shared/itemTaxonomy';
import ModalShell from '../src/shared/components/ModalShell';
import { PurchaseOrder } from '../src/shared/types';
import { OEM_DEFAULT_FEE_PER_KG } from '../src/features/admin/oemEngine';
import { listOemReceiptEntries, readOemReceiptEntry, storeOemReceiptDraft, clearOemReceiptAttempt, markOemReceiptFailure, isOemReceiptPreCallFailure, type OemReceiptEntry } from '../src/shared/oemReceiptPending';
import { listOemIssueAttempts, assertOemIssueAttempt, deleteOemIssueEntry, markOemIssueFailure, type OemIssueRetained, type OemIssueEntry } from '../src/shared/oemIssuePending';
export default function OemManager(props: Props) {
  // 닫았다 같은 배치를 다시 열어도 이전 요청과 새 화면은 다른 세대다.
  // 품목 조회 갱신만으로 입력을 버리지 않도록 업무 진입 키만 사용한다.
  const sessionKey = JSON.stringify([props.companyId, props.actorUid, props.issueOpen, props.receiveTarget?.id ?? null, props.feeTarget?.id ?? null]);
  return <OemSession key={sessionKey} {...props} />;
}
function OemSession({
  companyId, actorUid='', isCurrentActor, items, partners, rawStockKg, issueDrafts, purchaseOrders, issueOpen, receiveTarget, feeTarget, onClose, onIssue, onReceive, onIssueFee, orderUnitInputs,
}: Props) {
  const [,setReceiptRevision]=useState(0);
  const [recoveryOpen,setRecoveryOpen]=useState(false);
  const [selectedReceipt,setSelectedReceipt]=useState<OemReceiptEntry|null>(null);
  const [selectedIssueEntry,setSelectedIssueEntry]=useState<OemIssueEntry|null>(null);
  const selectedIssue=selectedIssueEntry?.retained??null;
  const legacyIssueSelected=!!selectedIssueEntry&&!selectedIssue;
  const issues=actorUid?listOemIssueAttempts(companyId,actorUid):[];
  const receipts=actorUid?listOemReceiptEntries(companyId,actorUid):[];
  React.useEffect(()=>{const update=()=>setReceiptRevision(value=>value+1);window.addEventListener('storage',update);return()=>window.removeEventListener('storage',update);},[]);
  const [storageNotice, setStorageNotice] = useState({ message: '', blocked: false });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const current=()=>alive.current&&!!actorUid&&(!isCurrentActor||isCurrentActor());
  // 새 화면이 커밋되는 순간 이전 세대를 닫아, 늦은 Promise가 화면 정리를 먼저 하지 못하게 한다.
  React.useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const close = () => { if (alive.current && !busyRef.current) onClose(); };
  const oemItems = useMemo(() => items.filter(i => !i.archived && i.procureType === '임가공'), [items]);
  const rawItems = useMemo(
    () => items.filter(i => !i.archived && !i.phantom && isBulkItem(i)),
    [items],
  );

  const run = async (fn: () => Promise<void | boolean>) => {
    if (!alive.current || busyRef.current) return;
    busyRef.current = true; // React 재렌더 전의 연속 클릭도 같은 작업으로 묶는다.
    setBusy(true);
    try {
      const cleaned = await fn();
      if (alive.current && cleaned !== false) onClose();
    } catch { /* 호출부가 오류를 알려 준다. 초안은 남겨 재개한다. */ }
    finally { if (alive.current) { busyRef.current = false; setBusy(false); } }
  };

  const submitReceipt=async(input:ReceiveInput,intent:'new'|'resume',selected?:OemReceiptEntry)=>{
    if(busyRef.current||!current())return;busyRef.current=true;setBusy(true);let original=selected;
    const scope=selected?.scope??{companyId,actorUid,poId:input.po.id};
    try{
      if(intent==='new'){
        const before=readOemReceiptEntry(scope);
        if(before.draft||before.packet||before.legacy){setSelectedReceipt(before);setRecoveryOpen(true);throw Error('이 배치의 이전 입고 결과를 확인해야 합니다. 이전 처리 결과를 확인해 주세요.');}
        original=await storeOemReceiptDraft(scope,input,current);
      }
      if(!original||original.scope.companyId!==companyId||original.scope.actorUid!==actorUid||original.legacy)throw Error('과거 요청의 최초 계정과 송신 원문을 확인할 수 없습니다. 배치 입고 이력과 실제 재고를 확인해 주세요.');
      const before=readOemReceiptEntry(scope);
      if(before.draftText!==original.draftText||before.packetText!==original.packetText)throw Error('다른 창에서 최초 입고 요청이 변경되었습니다. 목록에서 다시 선택해 주세요.');
      await onReceive(intent==='new'?original.draft!.input:input,intent,scope.actorUid);if(!current())return;
      const fresh=readOemReceiptEntry(scope);
      await clearOemReceiptAttempt({...fresh,draftText:original.draftText},current);if(!current())return;
      setReceiptRevision(value=>value+1);setSelectedReceipt(null);if(intent==='new')onClose();
    }catch(error){if(!current())return;const message=error instanceof Error?error.message:String(error);
      try{const fresh=readOemReceiptEntry(scope);if(original&&isOemReceiptPreCallFailure(error,scope)){await clearOemReceiptAttempt({...fresh,draftText:original.draftText},current);setSelectedReceipt(null);}
        else if(fresh.draft||fresh.packet||fresh.legacy){const expected={...fresh,draftText:original?.draftText??fresh.draftText};await markOemReceiptFailure(expected,message,fresh.deleted,current);setSelectedReceipt(readOemReceiptEntry(scope));setRecoveryOpen(true);}else window.alert(message);
      }catch{setStorageNotice({message:'보존된 입고 원문이 변경되었습니다. 원문을 유지했습니다. 목록에서 다시 확인해 주세요.',blocked:false});setRecoveryOpen(true);}
      if(current())setReceiptRevision(value=>value+1);
    }finally{if(current()){busyRef.current=false;setBusy(false);}}
  };
  const resumeReceipt=(entry:OemReceiptEntry)=>{
    if(entry.legacy||!entry.draft&&!entry.packet)return;
    const r=entry.packet?.request;
    const input=entry.draft?.input??{po:purchaseOrders?.find(po=>po.id===entry.scope.poId)??{id:entry.scope.poId,companyId:entry.scope.companyId} as PurchaseOrder,returns:r!.returns,bulk:r!.bulk??[],date:r!.date,unitPricePerKg:r!.unitPricePerKg??OEM_DEFAULT_FEE_PER_KG,...(r!.oemCostEvidence?{oemCostEvidence:r!.oemCostEvidence}:{})};
    void submitReceipt(input,'resume',entry);
  };
  const removeReceipt=async(entry:OemReceiptEntry)=>{
    if(busyRef.current||!current())return;busyRef.current=true;setBusy(true);
    try{await markOemReceiptFailure(entry,entry.error,true,current);if(current()){setReceiptRevision(value=>value+1);setSelectedReceipt(null);}}
    catch(error){if(current())setStorageNotice({message:error instanceof Error?error.message:String(error),blocked:false});}
    finally{if(current()){busyRef.current=false;setBusy(false);}}
  };
  const issueDisplay=(retained:OemIssueRetained):IssueInput=>({jobId:retained.request.input.jobId,oemPartnerId:retained.request.input.partnerId,partnerName:retained.request.input.partnerName,sent:retained.request.input.sent.map(row=>({material:row.material,kg:row.kg})),date:retained.request.input.date,...(retained.request.input.note?{note:retained.request.input.note}:{}),...(retained.request.input.oemCostEvidence?{oemCostEvidence:retained.request.input.oemCostEvidence}:{})});
  const submitIssue=async(input:IssueInput,intent:'new'|'resume',retained?:OemIssueRetained)=>{
    if(busyRef.current||!current())return;busyRef.current=true;setBusy(true);
    try{
      if(retained)assertOemIssueAttempt(retained);
      else {const unsafe=listOemIssueAttempts(companyId,actorUid).find(entry=>!entry.retained);if(unsafe)throw Error(unsafe.error); }
      await onIssue(input,intent,actorUid,retained);
      if(current()){setSelectedIssueEntry(null);setReceiptRevision(v=>v+1);setStorageNotice({message:'처리 결과를 확인했습니다.',blocked:false});if(intent==='new')onClose();}
    }catch(error){if(current()){
      const message=error instanceof Error?error.message:String(error);
      const fresh=listOemIssueAttempts(companyId,actorUid);
      const own=retained??fresh.find(e=>e.retained?.request.input.jobId===input.jobId)?.retained;
      if(own){try{await markOemIssueFailure(own,message,fresh.find(e=>e.key===own.key)?.deleted??false,current);}catch{/* 원문이 바뀌면 새 요청에 실패표식을 덮어쓰지 않는다. */}}
      if(!current())return;
      const related=own??fresh.find(e=>e.retained?.request.input.sent.some(row=>input.sent.some(other=>other.material===row.material)))?.retained;
      setSelectedReceipt(null);setSelectedIssueEntry(fresh.find(e=>e.retained?.key===related?.key)??fresh.find(e=>!e.retained)??null);setStorageNotice({message,blocked:false});setRecoveryOpen(true);setReceiptRevision(v=>v+1);
    }}finally{if(current()){busyRef.current=false;setBusy(false);}}
  };
  const removeIssue=async(entry:OemIssueEntry)=>{
    if(busyRef.current||!current())return;busyRef.current=true;setBusy(true);
    try{await deleteOemIssueEntry(entry,current);if(current()){setSelectedIssueEntry(null);setStorageNotice({message:'',blocked:false});setReceiptRevision(v=>v+1);}}
    catch(error){if(current())setStorageNotice({message:error instanceof Error?error.message:String(error),blocked:false});}
    finally{if(current()){busyRef.current=false;setBusy(false);}}
  };
  const recoveryButton='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold disabled:opacity-50';
  return (
    <>
      <button type="button" className={recoveryButton} onClick={()=>{setReceiptRevision(value=>value+1);setSelectedReceipt(null);setSelectedIssueEntry(null);setRecoveryOpen(true);}}>OEM 실패 작업 {receipts.filter(entry=>!entry.deleted).length+issues.filter(entry=>!entry.deleted).length}</button>
      {recoveryOpen&&<ModalShell title={selectedReceipt||selectedIssue||legacyIssueSelected?'OEM 실패 작업 상세':'OEM 실패 작업 목록'} layer={1300} onClose={()=>{if(!busyRef.current){if(selectedReceipt||selectedIssue||legacyIssueSelected){setSelectedReceipt(null);setSelectedIssueEntry(null);}else setRecoveryOpen(false);}}}>
        {selectedIssue?<div className="space-y-4"><p className="font-bold">{selectedIssue.request.input.partnerName} · {selectedIssue.request.input.date}</p>
          <p>{storageNotice.message||'외주 원료 출고 결과를 아직 확인하지 못했습니다.'}</p><p>확인할 내용: 최초 원료·수량·날짜와 외주 출고 이력, 각 원료의 실제 재고를 확인해주세요.</p>
          <ul>{selectedIssue.request.input.sent.map(row=><li key={row.rawItemId}>{row.material} · {row.kg}kg</li>)}</ul>
          <div className="flex gap-2"><button type="button" className={recoveryButton} disabled={busy} onClick={()=>void submitIssue(issueDisplay(selectedIssue),'resume',selectedIssue)}>같은 내용 다시 시도</button><button type="button" className={recoveryButton} disabled={busy} onClick={()=>void removeIssue(selectedIssueEntry!)}>실패 요청 삭제</button></div>
          <p>실패 목록에서 요청을 삭제합니다. 실제 외주 출고·발주·재고는 바뀌지 않습니다. 관련 원료는 이전 처리 결과를 확인해야 합니다.</p>
        </div>:legacyIssueSelected?<div className="space-y-3"><p>{selectedIssueEntry?.error||'과거 외주 요청의 최초 계정과 원료 송신 원문을 확인할 수 없습니다. 자동으로 다시 출고하지 않습니다.'}</p><p>외주 출고 이력과 원료 재고를 확인해주세요.</p><button type="button" className={recoveryButton} disabled={busy} onClick={()=>void removeIssue(selectedIssueEntry!)}>실패 요청 삭제</button></div>:!selectedReceipt?<><p>최초 출고·입고 요청을 선택해 처리 결과와 확인할 내용을 살펴보세요.</p>{storageNotice.message&&<p>{storageNotice.message}</p>}
          {!receipts.some(entry=>!entry.deleted)&&!issues.some(entry=>!entry.deleted)&&<p>확인할 실패 작업이 없습니다.</p>}
          {issues.filter(e=>!e.deleted).map(e=><button type="button" key={e.key} className="block w-full border-b border-slate-200 py-3 text-left" onClick={()=>{setSelectedIssueEntry(e);setStorageNotice({message:e.error,blocked:false});}}>{e.retained?`${e.retained.request.input.partnerName} · ${e.retained.request.input.date} · 외주 출고 처리 결과 미확인`:e.error}</button>)}
          {receipts.filter(entry=>!entry.deleted).map(entry=><button type="button" key={entry.scope.poId} className="block w-full border-b border-slate-200 py-3 text-left" onClick={()=>setSelectedReceipt(entry)}>{entry.draft?.input.po.partnerName??purchaseOrders?.find(po=>po.id===entry.scope.poId)?.partnerName??'OEM 배치'} · 가공 입고 · {entry.scope.poId} · {entry.draft?.input.date??entry.packet?.request.date??'일자 확인 필요'} · {entry.legacy?'과거 요청 확인 필요':'처리 결과 미확인'}</button>)}
        </>: (()=>{let matches=false;try{const fresh=readOemReceiptEntry(selectedReceipt.scope);matches=fresh.draftText===selectedReceipt.draftText&&fresh.packetText===selectedReceipt.packetText&&fresh.legacy===selectedReceipt.legacy;}catch{/* 판독 불가 원문은 임의 선택하지 않는다. */}
          const input=selectedReceipt.draft?.input,packet=selectedReceipt.packet?.request;
          return <div className="space-y-4"><p className="font-bold">{input?.po.partnerName??'OEM 배치'} · {selectedReceipt.scope.poId} · {input?.date??packet?.date??'일자 확인 필요'}</p>
            {storageNotice.message&&<p>{storageNotice.message}</p>}
            <p>{!matches?'다른 창에서 원문이 변경되었습니다. 목록에서 다시 선택해 주세요.':selectedReceipt.legacy?'과거 요청의 최초 계정과 송신 원문을 확인할 수 없습니다. 자동으로 다시 입고하지 않습니다.':selectedReceipt.error||'입고 처리 결과를 아직 확인하지 못했습니다.'}</p>
            <p>확인할 내용: 배치 입고 이력, 최초 품목·수량·날짜·원가 근거와 실제 원료·완제품 재고를 확인해 주세요.</p>
            <ul>{(input?.returns??packet?.returns??[]).map(row=><li key={row.itemId}>{row.itemId} · 수량 {row.qty}</li>)}{(input?.bulk??packet?.bulk??[]).map(row=><li key={row.material}>{row.material} · {row.kg}kg</li>)}</ul>
            {selectedReceipt.deleted&&!packet&&<p>최초 송신 기록이 없어 다시 입고하지 않습니다. 배치 입고 이력과 실제 원료·완제품 재고를 확인해 주세요.</p>}
            <div className="flex flex-wrap gap-2"><button type="button" className={recoveryButton} disabled={busy||!matches||selectedReceipt.legacy||selectedReceipt.deleted&&!packet||!input&&!packet} onClick={()=>resumeReceipt(selectedReceipt)}>같은 내용 다시 시도</button><button type="button" className={recoveryButton} disabled={busy||!matches} onClick={()=>void removeReceipt(selectedReceipt)}>실패 요청 삭제</button></div>
            <p>삭제는 실패 목록에서 요청을 제거합니다. 실제 입고·재고·가공비는 바뀌지 않습니다. 같은 배치는 이전 처리 결과를 확인해야 다시 입고할 수 있습니다.</p>
          </div>;
        })()}
      </ModalShell>}
      {issueOpen&&<div hidden={recoveryOpen}><IssueModal companyId={companyId} partners={partners} rawItems={rawItems} rawStockKg={rawStockKg} issueDrafts={[]} purchaseOrders={purchaseOrders} busy={busy}
        onClose={close} onSubmit={v=>void submitIssue(v,'new')} /></div>}
      {receiveTarget && <div hidden={recoveryOpen}><ReceiveModal companyId={companyId} po={receiveTarget} oemItems={oemItems} bulkItems={rawItems} busy={busy} orderUnitInputs={orderUnitInputs} pendingReceipt={null} onClose={close} onSubmit={v=>void submitReceipt({po:receiveTarget,...v},'new')} /></div>}      {feeTarget && (
        <FeeModal po={feeTarget} items={items} companyId={companyId} busy={busy} orderUnitInputs={orderUnitInputs}
          onClose={close} onSubmit={(v) => run(() => onIssueFee({ po: feeTarget, ...v }))} />
      )}
    </>
  );
}
