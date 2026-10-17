import { captureOemCostEvidence, type OemCostEvidence } from '../../admin/oemCostEvidence';
import { useRef, useState } from 'react';
import { today } from '../../../shared/day';
import { Plus, X, ArrowRight } from 'lucide-react';
import ModalShell from '../../../shared/components/ModalShell';
import { Item, PurchaseOrder, type CompanyId } from '../../../shared/types';
import { sentKg, batchLoss, processingFee } from '../../admin/oem';
import { baseRawName } from '../../../constants/formula';
import { itemKg, OEM_DEFAULT_FEE_PER_KG } from '../../admin/oemEngine';
import { isBoxStockItem, type OrderUnitInputs } from '../../../shared/orderUnits';
import { formatNumberKo as fmt } from '../../../shared/numberDisplay';
import type { ReceiveInput } from '../domain/oemManager';

export function ReceiveModal({ pendingReceipt, pendingError, storageNotice, companyId, po, oemItems, bulkItems, busy, onClose, onSubmit, orderUnitInputs }: {
  pendingError?: string; storageNotice?: string;
  orderUnitInputs?: OrderUnitInputs;
  pendingReceipt: ReceiveInput|null; companyId: CompanyId; po: PurchaseOrder; oemItems: Item[]; bulkItems: Item[]; busy: boolean;
  onClose: () => void;
  onSubmit: (v: { returns: { itemId: string; qty: number }[]; bulk: { material: string; kg: number }[]; unitPricePerKg: number; date: string; oemCostEvidence?: OemCostEvidence }) => void;
}) {
  const [date, setDate] = useState(today());
  const [rawAmounts, setRawAmounts] = useState<string[]>(() => (po.oemSent ?? []).map(() => ''));
  const [packagingSupply, setPackagingSupply] = useState('');
  const [packagingConfirmed, setPackagingConfirmed] = useState(false);
  const capturedAt = useRef(new Date().toISOString());
  const sentRows = po.oemSent ?? [];
  const canCaptureEvidence = !po.oemCostEvidence && sentRows.length > 0 && sentRows.every(row => !!row.rawItemId && Number.isFinite(row.kg) && row.kg > 0);
  const receiptCost: ReturnType<typeof captureOemCostEvidence> = canCaptureEvidence ? captureOemCostEvidence(companyId, sentRows.map((row, i) => ({rawItemId: row.rawItemId, kg: row.kg, supplyAmount: rawAmounts[i] ?? ''})), packagingSupply, packagingConfirmed, capturedAt.current) : {status:'empty' as const};
  const [fee, setFee] = useState(String(po.oemFeePerKg ?? OEM_DEFAULT_FEE_PER_KG));
  // 임가공 품목이 여러 개면 처음부터 각 행으로 띄운다 — 돌아온 것만 수량 입력(빈 행은 저장 시 무시).
  const [rows, setRows] = useState<{ itemId: string; qty: string }[]>(
    () => oemItems.length > 0 ? oemItems.map(it => ({ itemId: it.id, qty: '' })) : [{ itemId: '', qty: '' }],
  );
  // 벌크(포장 안 하고 온 몫) — kg으로 받아 원료 로트에 그대로 쌓는다. 소분 품목이 여기서 빼간다.
  const [bulkRows, setBulkRows] = useState<{ material: string; kg: string }[]>([{ material: '', kg: '' }]);

  const returns = rows.filter(r => r.itemId && Number(r.qty) > 0).map(r => ({ itemId: r.itemId, qty: Number(r.qty) }));
  const bulk = bulkRows.filter(b => b.material && Number(b.kg) > 0).map(b => ({ material: b.material, kg: Number(b.kg) }));
  const packedKg = returns.reduce((a, r) => {
    const it = oemItems.find(i => i.id === r.itemId);
    return a + (it ? itemKg(it, orderUnitInputs) * r.qty : 0);
  }, 0);
  const bulkKg = bulk.reduce((a, b) => a + b.kg, 0);
  const receivedKg = packedKg + bulkKg;
  const s = sentKg(po.oemSent);
  const loss = batchLoss(po.oemSent, receivedKg);
  const money = processingFee(receivedKg, Number(fee) || 0);
  const canSave = (!!pendingReceipt || returns.length > 0 || bulk.length > 0) && !busy && !pendingError;

  return (
    <ModalShell title="가공입고" onClose={onClose} bodyClassName="space-y-4">
        {(pendingError || storageNotice) && <p role="alert" className="text-xs text-amber-800">{pendingError || storageNotice}</p>}
        {pendingReceipt && <p role="status" className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">이전 입고 요청의 완료 여부를 확인해야 합니다. 재개하면 당시 수량·날짜·원가 근거 그대로 다시 확인합니다. 화면에서 바꾼 입력은 재개 요청에 적용하지 않습니다.</p>}

        <div className="bg-slate-50 rounded-2xl px-4 py-3 flex items-center gap-3">
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
              <div key={i} className="flex items-center gap-1.5">
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
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">가공단가 (원/kg)</label>
          <input inputMode="numeric" value={fee} onChange={e => setFee(e.target.value.replace(/[^\d]/g, ''))}
            className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-right text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-violet-300" />
        </div>

        <div className="bg-slate-50 rounded-2xl px-4 py-3 space-y-1 text-xs">
          <div className="flex justify-between"><span className="text-slate-400 font-bold">받은 완제품</span><span className="font-black tabular-nums">{fmt(receivedKg)} kg</span></div>
          <div className="flex justify-between"><span className="text-slate-400 font-bold">송출·입고 차이 (추정, 손실 미확정)</span><span className="font-black tabular-nums text-rose-600">{fmt(loss)} kg</span></div>
          <div className="flex justify-between border-t border-slate-200 pt-1 mt-1">
            <span className="text-slate-400 font-bold">가공비 (예상)</span>
            <span className="font-black tabular-nums">{fmt(money.total)}원</span>
          </div>
        </div>
        <p className="text-[10px] text-slate-400 leading-snug">
          입고하면 완제품 재고가 늘고 외주재고가 정리됩니다. <b>가공비 전표는 확인사항으로 넘어갑니다</b> —
          확인사항에서 발행하세요.
        </p>

        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200">취소</button>
          <button onClick={() => onSubmit({ returns, bulk, unitPricePerKg: Number(fee) || 0, date, ...(receiptCost.evidence ? {oemCostEvidence: receiptCost.evidence} : {}) })} disabled={!canSave}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-black hover:bg-violet-700 disabled:opacity-30">
            {busy ? '처리 중…' : pendingReceipt ? '입고 요청 재개' : '가공입고'}
          </button>
        </div>
    </ModalShell>
  );
}
