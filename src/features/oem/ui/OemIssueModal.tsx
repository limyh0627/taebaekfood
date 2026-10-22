import {useOemIssueDraft} from '../hooks/useOemIssueDraft';
import React, { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import ModalShell from '../../../shared/components/ModalShell';
import { Item, Partner, PurchaseOrder, type CompanyId } from '../../../shared/types';
import { readOemExternalStockEvidence, type OemExternalStockEvidenceRow } from '../../../shared/services/oemExternalStockEvidence';
import type { OemExternalRow } from '../../admin/oemExternalStock';
import type {IssueInput} from '../domain/oemManager';
import {formatNumberKo as fmt} from '../../../shared/numberDisplay';

// ── 외주 발주 (원료 내보내기) ────────────────────────────────────────────────
export function IssueModal({ companyId, partners, rawItems, rawStockKg, issueDrafts, purchaseOrders, busy, onClose, onSubmit }: {
  companyId:CompanyId; partners: Partner[]; rawItems: Item[]; rawStockKg: (m: string) => number; issueDrafts: PurchaseOrder[]; busy: boolean;
  purchaseOrders?: PurchaseOrder[];
  onClose: () => void;
  onSubmit: (v: IssueInput) => void;
}) {
  const {partnerId,setPartnerId,date,setDate,rows,setRows,note,setNote,packagingSupply,setPackagingSupply,packagingConfirmed,setPackagingConfirmed,costStatus,shortage,canSave,submit,close}=useOemIssueDraft({companyId,partners,rawItems,rawStockKg,busy,onClose,onSubmit});

  return (
    <ModalShell title="외주 발주 · 원료 내보내기" onClose={close} bodyClassName="space-y-4">
        <ExternalDispatchEvidence companyId={companyId} orders={purchaseOrders ?? issueDrafts} />
        <fieldset disabled={busy} className="contents"><p className="text-[11px] text-slate-400 leading-snug">
          우리 원료를 외주공장에 보냅니다. <b>본재고에서 빠지고 외주로 나갑니다</b>(전표 없음 — 우리 것의 이동).
          발주하면 <b>입고대기</b>에 뜨고, 돌아오면 거기서 가공입고 하시면 됩니다.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">외주공장</label>
            <select value={partnerId} onChange={e => setPartnerId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-300">
              <option value="">— 선택 —</option>
              {/* 외주공장으로 표시된 거래처만 (isOemFactory). 없으면 하위호환으로 전체. */}
              {(partners.some(p => p.isOemFactory) ? partners.filter(p => p.isOemFactory) : partners)
                .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">일자</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase block">내보낼 원료</label>
          {rows.map((r, i) => {
            const stock = r.material ? rawStockKg(r.material) : 0;
            const over = r.material && Number(r.kg) > stock;
            return (
              <div key={i} className="flex items-center gap-1.5">
                <select value={r.material} onChange={e => setRows(p => p.map((x, j) => j === i ? { ...x, material: e.target.value, supplyAmount: undefined } : x))}
                  className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-300">
                  <option value="">— 원료 —</option>
                  {rawItems.map(it => <option key={it.id} value={it.name.split('/')[0].trim()}>{it.name}</option>)}
                </select>
                <input inputMode="decimal" value={r.kg} placeholder="kg"
                  onChange={e => setRows(p => p.map((x, j) => j === i ? { ...x, kg: e.target.value.replace(/[^\d.]/g, '') } : x))}
                  className={`w-24 shrink-0 border rounded-lg px-2 py-2 text-sm font-black text-right outline-none focus:ring-2 focus:ring-violet-300 ${over ? 'border-rose-300 bg-rose-50' : 'border-slate-200'}`} />
                {r.material && <span className="text-[10px] font-bold text-slate-400 shrink-0 w-20">재고 {fmt(Math.round(stock))}</span>}
                {rows.length > 1 && <button onClick={() => setRows(p => p.filter((_, j) => j !== i))} className="text-slate-300 hover:text-rose-400 shrink-0"><X size={14} /></button>}
              </div>
            );
          })}
          <button onClick={() => setRows(p => [...p, { material: '', kg: '' }])}
            className="flex items-center gap-1 text-xs font-black text-slate-500 hover:text-slate-700"><Plus size={12} strokeWidth={3} />원료 추가</button>
        </div>

        {shortage.length > 0 && (
          <p className="text-[11px] font-bold text-rose-600 bg-rose-50 rounded-xl px-4 py-2.5">
            재고보다 많이 내보냅니다: {shortage.map(s => `${s.material} ${fmt(s.kg)}kg`).join(', ')} — 그대로 진행하면 재고가 음수가 됩니다.
          </p>
        )}

        <details className="rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-bold text-slate-700">원가 근거 기록 (선택)</summary>
          <div className="mt-3 space-y-3 text-xs">
            <p className="text-slate-500">원물 소유: 현재 회사. 보낸 원료와 부자재의 직접 확인한 공급가액만 적어 주세요. 현재 품목 원가는 자동으로 가져오지 않습니다.</p>
            {rows.map((row,index)=>row.material && Number(row.kg)>0 && <label key={index} className="block">{row.material} · {row.kg}kg 원료 공급가액 (총액)<input aria-label={index+1+'행 원료 공급가액'} disabled={busy} inputMode="numeric" value={row.supplyAmount??''} onChange={e=>setRows(previous=>previous.map((r,i)=>i===index?{...r,supplyAmount:e.target.value}:r))} placeholder="직접 확인한 공급가액" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"/></label>)}
            <label className="block">부자재 공급가액 (총액)<input aria-label="부자재 공급가액" disabled={busy} inputMode="numeric" value={packagingSupply} onChange={e=>{setPackagingSupply(e.target.value);setPackagingConfirmed(false);}} placeholder="사용하지 않았다면 0을 입력" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"/></label>
            <label className="flex items-center gap-2"><input type="checkbox" aria-label="부자재 공급가액 확인" disabled={busy} checked={packagingConfirmed} onChange={e=>setPackagingConfirmed(e.target.checked)}/>부자재 공급가액을 확인했습니다 (0원도 확인 필요)</label>
            {costStatus.status==='incomplete' && <p role="status" className="text-amber-700">원가 근거가 아직 완성되지 않았습니다. 발주는 그대로 진행하며, 이번 원가 근거는 저장하지 않습니다.</p>}
            {costStatus.status==='complete' && <p className="text-emerald-700">확인한 원가 근거를 이 발주에 함께 저장합니다.</p>}
          </div>
        </details>

        <input value={note} onChange={e => setNote(e.target.value)} placeholder="메모 (선택)"
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-300" />

        </fieldset><div className="flex gap-2">
          <button onClick={close} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200 disabled:opacity-40">취소</button>
          <button onClick={submit}
            disabled={!canSave}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 text-white text-xs font-black hover:bg-slate-900 disabled:opacity-30">
            {busy ? '처리 중…' : '발주 (원료 내보내기)'}
          </button>
        </div>
    </ModalShell>
  );
}

function ExternalDispatchEvidence({ companyId, orders }: { companyId: CompanyId; orders: PurchaseOrder[] }) {
  const [state, setState] = useState<{busy:boolean;rows:OemExternalStockEvidenceRow[];error:string}>({busy:false,rows:[],error:''});
  const generation = useRef(0);
  const inFlight = useRef(false);
  const key = JSON.stringify([companyId, orders]);
  React.useLayoutEffect(() => { generation.current++; inFlight.current=false;setState({busy:false,rows:[],error:''});return()=>{generation.current++;}; }, [key]);
  const inspect = async () => {
    if(inFlight.current)return;
    inFlight.current=true; const captured=generation.current;
    setState({busy:true,rows:[],error:''});
    try {
      const rows=await readOemExternalStockEvidence(companyId,orders);
      if(captured===generation.current)setState({busy:false,rows,error:''});
    } catch(error) {
      if(captured===generation.current)setState({busy:false,rows:[],error:error instanceof Error?error.message:'송출 근거 조회 실패'});
    } finally { if(captured===generation.current)inFlight.current=false; }
  };

  return <section aria-label="외주송출근거현황" className="rounded-xl border border-slate-200 p-3 space-y-2 text-xs">
    <div className="flex items-center justify-between gap-2"><strong>외주송출근거현황</strong><button type="button" disabled={state.busy} onClick={inspect} className="rounded-lg border px-3 py-2">{state.busy?'조회 중':'송출 근거 조회'}</button></div>
    <p className="text-slate-500">장부 송출 증거를 확인합니다. 물리 창고의 실측량이나 소유재고 잔량 확정이 아닙니다. 표시 금액은 개별 근거 후보이며 확정 재고자산·합계·월말 평가가 아닙니다.</p>
    {state.error&&<p role="alert">{state.error} · 근거 미확인</p>}
    <OemExternalEvidenceRows rows={state.rows} />
  </section>;
}

export function OemExternalEvidenceRows({ rows }: { rows: OemExternalStockEvidenceRow[] }) {
  const labels:Record<OemExternalRow['state'],string>={confirmed:'송출 근거 확인',partial:'일부 확인',unknown:'미확인',cancelled:'취소 근거 확인',received:'PO 입고 완료 표시 · 송출 근거 확인'};
  return <>{rows.map(row=><div key={row.poId} className="border-t border-slate-200 py-2"><strong>{row.partnerName} · {row.poId} · {labels[row.state]}</strong>
            {row.costDiagnostic && <p>{row.costDiagnostic.classification === 'candidate' ? `송출 당시 확인 원물 금액: ${row.costDiagnostic.rawSupplyAmountCandidate?.toLocaleString('ko-KR')}원 · 개별 후보 금액` : row.costDiagnostic.reason === 'receipt-cost-only' ? '입고 때 확인 원가 · 송출 당시 원물 금액 근거는 미확인' : row.costDiagnostic.classification === 'excluded' ? '현재 미입고 대상 밖 · 금액 평가 제외' : '원가 근거 미확인 · 송출 당시 입력 근거와 처리 원문을 확인한 뒤 다시 조회하세요.'}</p>}
      {row.reason&&<p>{row.reason}</p>}{row.rows.map(raw=><p key={raw.rawItemId}>{raw.material} · 요청 {raw.requestedKg}kg · {raw.reportedKg===undefined?'송출 미확인':`장부 송출 ${raw.reportedKg}kg · 당시 재고 반영 ${raw.appliedKg}kg`}{raw.reason?` · ${raw.reason}`:''}</p>)}</div>)}</>;
}
