import { type OemCostEvidence } from '../../admin/oemCostEvidence';
import {useOemReceiptDraft} from '../hooks/useOemReceiptDraft';
import { Plus, X, ArrowRight } from 'lucide-react';
import ModalShell from '../../../shared/components/ModalShell';
import { Item, PurchaseOrder, type CompanyId } from '../../../shared/types';
import { baseRawName } from '../../../constants/formula';
import { itemKg } from '../../admin/oemEngine';
import { isBoxStockItem, type OrderUnitInputs } from '../../../shared/orderUnits';
import { formatNumberKo as fmt } from '../../../shared/numberDisplay';
import type { OemReceiptTermsV2 } from '../../../shared/partnerEditCommand';
import type { OemFeeTermsV2, OemFeeRateV2 } from '../../../shared/oemFeePlan';
import type { ReceiveInput } from '../domain/oemManager';

export function ReceiveModal({ pendingReceipt, pendingError, storageNotice, companyId, actorUid, preset, po, oemItems, bulkItems, busy, onClose, onSubmit, orderUnitInputs }: {
  pendingError?: string; storageNotice?: string; actorUid?: string; preset?: OemReceiptTermsV2;
  orderUnitInputs?: OrderUnitInputs;
  pendingReceipt: ReceiveInput|null; companyId: CompanyId; po: PurchaseOrder; oemItems: Item[]; bulkItems: Item[]; busy: boolean;
  onClose: () => void;
  onSubmit: (v: { returns: { itemId: string; qty: number }[]; bulk: { material: string; kg: number }[]; unitPricePerKg: number; date: string; feeTermsV2?: OemFeeTermsV2; oemCostEvidence?: OemCostEvidence }) => void;
}) {
  const draft=useOemReceiptDraft({companyId,actorUid,preset,po,oemItems,busy,pendingReceipt,pendingError,orderUnitInputs});
  const {date,setDate,rawAmounts,setRawAmounts,packagingSupply,setPackagingSupply,packagingConfirmed,setPackagingConfirmed,receiptCost,canCaptureEvidence,sentRows,fee,setFee,rows,setRows,bulkRows,setBulkRows,bulkKg,receivedKg,s,loss,money,terms,setRate,termsConfirmed,setTermsConfirmed,nonDuplicatePackagingConfirmed,setNonDuplicatePackagingConfirmed,needsPackagingConfirmation,bulkTaxExempt,setBulkTaxExempt,previewPlan,termsError,canSave}=draft;
  const close=()=>{if(!busy&&draft.isCurrent())onClose();};
  return (
    <ModalShell title="가공입고" onClose={close} bodyClassName="space-y-4">
        {(pendingError || storageNotice) && <p role="alert" className="text-xs text-amber-800">{pendingError || storageNotice}</p>}
        {pendingReceipt && <p role="status" className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">이전 입고 요청의 완료 여부를 확인해야 합니다. 재개하면 당시 수량·날짜·원가 근거 그대로 다시 확인합니다. 화면에서 바꾼 입력은 재개 요청에 적용하지 않습니다.</p>}

        <fieldset disabled={busy} className="contents"><div className="bg-slate-50 rounded-2xl px-4 py-3 flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-800 truncate">{po.partnerName}</p>
            <p className="text-[11px] text-slate-400">{(po.oemSentAt ?? '').slice(0, 10)} 출고</p>
          </div>
          <ArrowRight size={14} className="text-slate-300 shrink-0" />
          <p className="text-sm font-black text-slate-700 tabular-nums shrink-0">보낸 원료 {fmt(s)} kg</p>
        </div>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">일자</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-300" />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase block">돌아온 완제품</label>
          {oemItems.length === 0 && (
            <p className="text-[11px] font-bold text-amber-700 bg-amber-50 rounded-xl px-4 py-2.5">
              임가공 품목이 없습니다. 품목의 조달방식을 '임가공'으로 지정해주세요.
            </p>
          )}
          {rows.map((r, i) => {
            const it = oemItems.find(x => x.id === r.itemId);
            const kg = it ? itemKg(it, orderUnitInputs) * (Number(r.qty) || 0) : 0;
            return (
              <div key={i} className="space-y-2"><div className="flex items-center gap-1.5">
                <select value={r.itemId} onChange={e => setRows(p => p.map((x, j) => j === i ? { ...x, itemId: e.target.value } : x))}
                  className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-300">
                  <option value="">— 품목 —</option>
                  {oemItems.map(x => <option key={x.id} value={x.id}>{[x.name, x.spec, isBoxStockItem(x, orderUnitInputs) ? '박스' : x.unit].filter(Boolean).join(' · ')}</option>)}
                </select>
                <input inputMode="numeric" value={r.qty} placeholder="수량"
                  onChange={e => setRows(p => p.map((x, j) => j === i ? { ...x, qty: e.target.value.replace(/[^\d]/g, '') } : x))}
                  className="w-20 shrink-0 border border-slate-200 rounded-lg px-2 py-2 text-sm font-black text-right outline-none focus:ring-2 focus:ring-violet-300" />
                <span className="text-[10px] font-bold text-slate-400 shrink-0 w-16 text-right">{kg ? `${fmt(kg)}kg` : ''}</span>
                {rows.length > 1 && <button onClick={() => setRows(p => p.filter((_, j) => j !== i))} className="text-slate-300 hover:text-rose-400 shrink-0"><X size={14} /></button>}
              </div>
              {r.itemId && Number(r.qty)>0 && (terms[r.itemId] ? <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">{(['processing','vendorPackaging'] as const).map(key => {const rate=terms[r.itemId]![key]; return <div key={key} className="space-y-1 text-xs"><strong>{key==='processing'?'가공비':'업체부자재비'}</strong><div className="grid grid-cols-3 gap-2"><label className="min-w-0">기준<select aria-label={r.itemId+' '+key+' 단위'} className="mt-1 h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2" value={rate.unit} onChange={e=>setRate(r.itemId,key,{...rate,unit:e.target.value as OemFeeRateV2['unit']})}><option value="kg">kg</option><option value="piece">개</option><option value="box">박스</option></select></label><label className="min-w-0">단가 (원)<input aria-label={r.itemId+' '+key+' 단가'} className="mt-1 h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-right" inputMode="decimal" value={Number.isFinite(rate.grossUnitPrice)?rate.grossUnitPrice:''} onChange={e=>setRate(r.itemId,key,{...rate,grossUnitPrice:e.target.value.trim()?Number(e.target.value):NaN})} /></label><label className="min-w-0">과세<select aria-label={r.itemId+' '+key+' 과세'} className="mt-1 h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2" value={rate.taxExempt?'exempt':'taxable'} onChange={e=>setRate(r.itemId,key,{...rate,taxExempt:e.target.value==='exempt'})}><option value="taxable">과세</option><option value="exempt">면세</option></select></label></div></div>})}</div> : <div className="text-xs text-amber-700"><p>생산 관리 → 외주 발주 → OEM 조건 관리에서 외주공장과 입고 품목의 가공비·업체부자재비를 설정한 뒤 가공입고를 다시 열어 주세요. 닫으면 이 화면의 미송신 입력은 사라집니다.</p><button type="button" className="underline font-bold" onClick={close}>닫기</button></div>)} 
              </div>
            );
          })}
          <button onClick={() => setRows(p => [...p, { itemId: '', qty: '' }])}
            className="flex items-center gap-1 text-xs font-black text-slate-500 hover:text-slate-700"><Plus size={12} strokeWidth={3} />품목 추가</button>
        </div>

        {/* 벌크 — 포장 안 하고 kg으로 돌아온 몫. 원료 로트에 쌓여 소분 품목이 여기서 빼간다. */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase block">벌크로 받은 몫 (kg)</label>
          {bulkRows.map((b, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select value={b.material} onChange={e => setBulkRows(p => p.map((x, j) => j === i ? { ...x, material: e.target.value } : x))}
                className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-300">
                <option value="">— 원료 —</option>
                {bulkItems.map(x => <option key={x.id} value={baseRawName(x.name)}>{baseRawName(x.name)}</option>)}
              </select>
              <input inputMode="decimal" value={b.kg} placeholder="kg"
                onChange={e => setBulkRows(p => p.map((x, j) => j === i ? { ...x, kg: e.target.value.replace(/[^\d.]/g, '') } : x))}
                className="w-20 shrink-0 border border-slate-200 rounded-lg px-2 py-2 text-sm font-black text-right outline-none focus:ring-2 focus:ring-violet-300" />
              <span className="text-[10px] font-bold text-slate-400 shrink-0 w-16 text-right">kg</span>
              {bulkRows.length > 1 && <button onClick={() => setBulkRows(p => p.filter((_, j) => j !== i))} className="text-slate-300 hover:text-rose-400 shrink-0"><X size={14} /></button>}
            </div>
          ))}
          <button onClick={() => setBulkRows(p => [...p, { material: '', kg: '' }])}
            className="flex items-center gap-1 text-xs font-black text-slate-500 hover:text-slate-700"><Plus size={12} strokeWidth={3} />벌크 추가</button>
          {bulkKg > 0 && (
            <p className="text-[10px] font-bold text-violet-600">벌크 {fmt(bulkKg)}kg은 원료 재고(로트)로 들어갑니다.</p>
          )}
        </div>


        {po.oemCostEvidence ? <p className="text-xs text-slate-500">발주 시 확인한 원가 근거를 그대로 사용합니다.</p> : canCaptureEvidence ? <details className="rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-bold">원가 근거 기록 (선택)</summary>
          <p className="mt-2 text-xs text-slate-500">현재 회사 소유 원료의 실제 공급가액 총액을 확인해 입력하세요. 발주할 때 몰랐던 금액은 입고 시 기록할 수 있습니다.</p>
          {sentRows.map((row,i)=><label key={i} className="mt-2 flex items-center justify-between gap-2 text-xs">{row.material} · {fmt(row.kg)}kg 공급가액 (총액)<input aria-label={'입고 '+(i+1)+'행 원료 공급가액'} inputMode="numeric" value={rawAmounts[i]??''} onChange={e=>setRawAmounts(values=>values.map((value,index)=>index===i?e.target.value.replace(/[^\d]/g,''):value))} className="w-32 rounded-lg border border-slate-200 px-2 py-2 text-right" /></label>)}
          <label className="mt-2 flex items-center justify-between gap-2 text-xs">부자재 공급가액 (총액)<input aria-label="입고 부자재 공급가액" inputMode="numeric" value={packagingSupply} onChange={e=>setPackagingSupply(e.target.value.replace(/[^\d]/g,''))} className="w-32 rounded-lg border border-slate-200 px-2 py-2 text-right" /></label>
          <label className="mt-2 flex items-center gap-2 text-xs"><input aria-label="입고 부자재 공급가액 확인" type="checkbox" checked={packagingConfirmed} onChange={e=>setPackagingConfirmed(e.target.checked)} />부자재 공급가액을 확인했습니다 (0원 포함)</label>
          {receiptCost.status==='incomplete' && <p className="mt-2 text-xs text-amber-700">입력한 원가 근거가 미완성입니다. 입고는 진행되지만 이번 원가 근거는 저장하지 않습니다.</p>}
        </details> : <p className="text-xs text-amber-700">원료 품목 ID가 없는 과거 발주는 원가 근거 미확인으로 입고합니다. 품목명으로 원료를 추정하지 않습니다.</p>}
        {bulkKg > 0 && <div>
          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">벌크 가공단가 (원/kg)</label>
          <input inputMode="numeric" value={fee} onChange={e => setFee(e.target.value.replace(/[^\d]/g, ''))}
            className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-right text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-violet-300" />
        </div>}

        {bulkKg > 0 && <label className="text-xs"><input type="checkbox" checked={bulkTaxExempt} onChange={e=>setBulkTaxExempt(e.target.checked)} /> 벌크 가공비 면세</label>}
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={termsConfirmed} onChange={e=>setTermsConfirmed(e.target.checked)} /> 선택 품목의 단위·단가·과세 조건을 확인했습니다.</label>
        {needsPackagingConfirmation && <label className="flex gap-2 text-xs"><input type="checkbox" checked={nonDuplicatePackagingConfirmed} onChange={e=>setNonDuplicatePackagingConfirmed(e.target.checked)} /> 기존 부자재는 업체청구와 별도 비용입니다.</label>}
        {!pendingReceipt && !pendingError && (rows.some(r=>r.itemId && Number(r.qty)>0) || bulkKg>0) && termsError && <p role="alert" className="text-xs text-amber-700">{termsError}</p>}
        <div className="border border-slate-200 bg-white rounded-2xl px-4 py-3 space-y-1 text-xs">
          <div className="flex justify-between"><span className="text-slate-400 font-bold">받은 완제품</span><span className="font-black tabular-nums">{fmt(receivedKg)} kg</span></div>
          <div className="flex justify-between"><span className="text-slate-400 font-bold">송출·입고 차이 (추정, 손실 미확정)</span><span className="font-black tabular-nums text-rose-600">{fmt(loss)} kg</span></div>
          {previewPlan && <div className="border-t border-slate-200 pt-1 mt-1 space-y-1"><strong>입고 조건 예상 금액</strong>{previewPlan.lines.map((line,i)=><div key={i} className="flex justify-between gap-2"><span>{line.name} ({line.isTaxExempt?'면세':'과세'})</span><span>{fmt(line.total)}원</span></div>)}<div>공급가 {fmt(previewPlan.totalSupply)}원 + 세액 {fmt(previewPlan.totalTax)}원</div><div className="font-black">합계 {fmt(previewPlan.totalAmount)}원</div></div>}
        </div>
        <p className="text-[10px] text-slate-400 leading-snug">
          입고하면 완제품 재고가 늘고 외주재고가 정리됩니다. {previewPlan?.totalAmount===0 ? <b>총액이 0원이므로 전표 발행은 불필요합니다.</b> : <><b>가공비 전표는 확인사항으로 넘어갑니다</b> — 확인사항에서 발행하세요.</>}
        </p>

        </fieldset><div className="flex gap-2">
          <button onClick={close} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200">취소</button>
          <button onClick={() => canSave && draft.isCurrent() && onSubmit(draft.payload())} disabled={!canSave}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-black hover:bg-violet-700 disabled:opacity-30">
            {busy ? '처리 중…' : pendingReceipt ? '입고 요청 재개' : '가공입고'}
          </button>
        </div>
    </ModalShell>
  );
}
