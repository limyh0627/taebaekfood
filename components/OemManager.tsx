import { captureOemCostEvidence, type OemCostEvidence } from '../src/features/admin/oemCostEvidence';
import { rawHolderByName } from '../src/shared/rawHolder';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { today } from '../src/shared/day';
import { isBulkItem } from '../src/shared/itemTaxonomy';
import { Plus, X, ArrowRight } from 'lucide-react';
import ModalShell from '../src/shared/components/ModalShell';
import { Item, Partner, PurchaseOrder, type CompanyId } from '../src/shared/types';
import { sentKg, batchLoss, processingFee } from '../src/features/admin/oem';
import { baseRawName } from '../src/constants/formula';
import { itemKg, OEM_DEFAULT_FEE_PER_KG } from '../src/features/admin/oemEngine';
import { reconcileOemBatch } from '../src/features/admin/oemReconciliation';
import { isBoxStockItem, type OrderUnitInputs } from '../src/shared/orderUnits';

/**
 * 임가공(OEM) 모달 호스트 — 목록은 기존 입고대기·입고이력에 녹아 있고,
 * 여기서는 발주/가공입고/가공비전표 모달만 띄운다. 열림 상태는 ItemList가 제어.
 */
interface Props {
  orderUnitInputs?: OrderUnitInputs;
  companyId: CompanyId;
  items: Item[];
  partners: Partner[];
  rawStockKg: (material: string) => number;
  issueDrafts: PurchaseOrder[];
  issueOpen: boolean;
  receiveTarget: PurchaseOrder | null;
  feeTarget: PurchaseOrder | null;
  onClose: () => void;
  onIssue: (input: { jobId: string; oemPartnerId: string; partnerName: string; sent: { material: string; kg: number }[]; date: string; note?: string; oemCostEvidence?: OemCostEvidence }) => Promise<void>;
  onReceive: (input: { po: PurchaseOrder; returns: { itemId: string; qty: number }[]; bulk: { material: string; kg: number }[]; unitPricePerKg: number; date: string; oemCostEvidence?: OemCostEvidence }) => Promise<void>;
  onIssueFee: (input: { po: PurchaseOrder; unitPricePerKg: number; date: string }) => Promise<void>;
}

type IssueInput = Parameters<Props['onIssue']>[0];
type ReceiveInput = Parameters<Props['onReceive']>[0];

const fmt = (n: number) => n.toLocaleString('ko-KR');

export default function OemManager({
  companyId, items, partners, rawStockKg, issueDrafts, issueOpen, receiveTarget, feeTarget, onClose, onIssue, onReceive, onIssueFee, orderUnitInputs,
}: Props) {
  const receiptKey = 'oem-receipt-pending:'+companyId+':'+(receiveTarget?.id ?? '');
  const [pendingReceipt, setPendingReceipt] = useState<ReceiveInput|null>(()=>{try{return JSON.parse(sessionStorage.getItem(receiptKey)??'null');}catch{return null;}});
  useEffect(()=>{try{setPendingReceipt(JSON.parse(sessionStorage.getItem(receiptKey)??'null'));}catch{setPendingReceipt(null);}},[receiptKey]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pendingKey = `oem-issue-pending:${companyId}`;
  const [pendingIssue, setPendingIssue] = useState<IssueInput | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null') as IssueInput | null; } catch { return null; }
  });
  useEffect(() => {
    try { setPendingIssue(JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null') as IssueInput | null); }
    catch { setPendingIssue(null); }
  }, [pendingKey]);

  const oemItems = useMemo(() => items.filter(i => !i.archived && i.procureType === '임가공'), [items]);
  const rawItems = useMemo(
    () => items.filter(i => !i.archived && !i.phantom && isBulkItem(i)),
    [items],
  );

  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; // React 재렌더 전의 연속 클릭도 같은 작업으로 묶는다.
    setBusy(true);
    try { await fn(); onClose(); } catch { /* 호출부가 오류를 알려 준다. 초안은 남겨 재개한다. */ }
    finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <>
      {issueOpen && (
        <IssueModal companyId={companyId} partners={partners} rawItems={rawItems} rawStockKg={rawStockKg} issueDrafts={issueDrafts} pendingIssue={pendingIssue} busy={busy}
          onClose={() => { if (!busyRef.current) onClose(); }} onSubmit={(v) => {
            if (busyRef.current) return;
            setPendingIssue(v);
            sessionStorage.setItem(pendingKey, JSON.stringify(v));
            run(async () => {
              try {
                await onIssue(v);
                setPendingIssue(null);
                sessionStorage.removeItem(pendingKey);
              } catch (error) {
                // 이 오류는 발주 초안을 만들기 전의 입력 검사에서만 나온다.
                // 네트워크/부분 출고 실패는 상태가 불확실하므로 작업번호를 그대로 보존한다.
                const message = error instanceof Error ? error.message : String(error);
                if (/^(내보낼 원료가 없습니다|다른 회사이거나 없는 OEM 거래처입니다|현재 회사의 원료 홀더를 찾을 수 없습니다)/.test(message)) {
                  setPendingIssue(null);
                  sessionStorage.removeItem(pendingKey);
                }
                throw error;
              }
            });
          }} />
      )}
      {receiveTarget && (
        <>
        <ReceiveModal companyId={companyId} po={receiveTarget} oemItems={oemItems} bulkItems={rawItems} busy={busy} orderUnitInputs={orderUnitInputs}
          pendingReceipt={pendingReceipt} onClose={onClose} onSubmit={(v) => {
            if (busyRef.current) return;
            const payload=pendingReceipt ?? {po:receiveTarget,...v};
            setPendingReceipt(payload);
            sessionStorage.setItem(receiptKey,JSON.stringify(payload));
            run(async()=>{await onReceive(payload);setPendingReceipt(null);sessionStorage.removeItem(receiptKey);});
          }} />
        </>
      )}
      {feeTarget && (
        <FeeModal po={feeTarget} items={items} companyId={companyId} busy={busy} orderUnitInputs={orderUnitInputs}
          onClose={onClose} onSubmit={(v) => run(() => onIssueFee({ po: feeTarget, ...v }))} />
      )}
    </>
  );
}

// ── 외주 발주 (원료 내보내기) ────────────────────────────────────────────────
function IssueModal({ companyId, partners, rawItems, rawStockKg, issueDrafts, pendingIssue, busy, onClose, onSubmit }: {
  companyId:CompanyId; partners: Partner[]; rawItems: Item[]; rawStockKg: (m: string) => number; issueDrafts: PurchaseOrder[]; pendingIssue: IssueInput | null; busy: boolean;
  onClose: () => void;
  onSubmit: (v: IssueInput) => void;
}) {
  const [jobId] = useState(() => `oem-${crypto.randomUUID()}`);
  const [partnerId, setPartnerId] = useState('');
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<{ material: string; kg: string; supplyAmount?:string }[]>([{ material: '', kg: '' }]);
  const [note, setNote] = useState('');
  const [packagingSupply,setPackagingSupply]=useState('');
  const [packagingConfirmed,setPackagingConfirmed]=useState(false);
  const costRows=rows.filter(row=>row.material && Number(row.kg)>0).map(row=>({rawItemId:rawHolderByName(rawItems,row.material,companyId)?.id,kg:Number(row.kg),supplyAmount:row.supplyAmount??''}));
  const costStatus=captureOemCostEvidence(companyId,costRows,packagingSupply,packagingConfirmed,new Date().toISOString());

  const partner = partners.find(p => p.id === partnerId);
  const sent = rows.filter(r => r.material && Number(r.kg) > 0).map(r => ({ material: r.material, kg: Number(r.kg) }));
  const shortage = sent.filter(s => s.kg > rawStockKg(s.material));
  const canSave = !!partnerId && sent.length > 0 && !busy;

  return (
    <ModalShell title="외주 발주 · 원료 내보내기" onClose={onClose} bodyClassName="space-y-4">
        {(issueDrafts.length > 0 || pendingIssue) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
            <p className="text-xs font-bold text-amber-900">{busy ? '외주 발주 처리 중입니다. 완료될 때까지 기다려 주세요.' : '완료되지 않은 외주 발주가 있습니다. 새로 발주하기 전에 기존 작업을 재개하세요.'}</p>
            {pendingIssue && !issueDrafts.some(draft => draft.id === pendingIssue.jobId) && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-slate-700">{pendingIssue.partnerName} · {pendingIssue.date} · 원료 {pendingIssue.sent.length}종</span>
                <button type="button" disabled={busy} onClick={() => onSubmit(pendingIssue)} className="shrink-0 rounded-lg bg-amber-700 px-2 py-1 font-bold text-white disabled:opacity-40">재개</button>
              </div>
            )}
            {issueDrafts.map(draft => (
              <div key={draft.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-slate-700">{draft.partnerName} · {draft.oemIssueDate} · 원료 {draft.oemSent?.length ?? 0}종</span>
                <button type="button" disabled={busy} onClick={() => onSubmit({
                  jobId: draft.id, oemPartnerId: draft.oemPartnerId ?? draft.partnerId ?? '', partnerName: draft.partnerName ?? '',
                  sent: (draft.oemSent ?? []).map(row => ({ material: row.material, kg: row.kg })),
                  ...(draft.oemCostEvidence ? {oemCostEvidence:draft.oemCostEvidence} : {}),
                  date: draft.oemIssueDate ?? '', note: draft.note,
                })} className="shrink-0 rounded-lg bg-amber-700 px-2 py-1 font-bold text-white disabled:opacity-40">재개</button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-slate-400 leading-snug">
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

        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200 disabled:opacity-40">취소</button>
          <button onClick={() => onSubmit({ jobId, oemPartnerId: partnerId, partnerName: partner?.name ?? '', sent, date, note: note.trim() || undefined, ...(costStatus.evidence ? {oemCostEvidence:costStatus.evidence} : {}) })}
            disabled={!canSave || issueDrafts.length > 0 || !!pendingIssue}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 text-white text-xs font-black hover:bg-slate-900 disabled:opacity-30">
            {busy ? '처리 중…' : '발주 (원료 내보내기)'}
          </button>
        </div>
    </ModalShell>
  );
}

// ── 가공입고 (완제품 받기) ───────────────────────────────────────────────────
function ReceiveModal({ pendingReceipt, companyId, po, oemItems, bulkItems, busy, onClose, onSubmit, orderUnitInputs }: {
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
  const canSave = (!!pendingReceipt || returns.length > 0 || bulk.length > 0) && !busy;

  return (
    <ModalShell title="가공입고" onClose={onClose} bodyClassName="space-y-4">
        {pendingReceipt && <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">이전 입고 요청의 완료 여부를 확인해야 합니다. 재개하면 당시 수량·날짜·원가 근거 그대로 다시 확인합니다. 화면에서 바꾼 입력은 재개 요청에 적용하지 않습니다.</p>}

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
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200">취소</button>
          <button onClick={() => onSubmit({ returns, bulk, unitPricePerKg: Number(fee) || 0, date, ...(receiptCost.evidence ? {oemCostEvidence: receiptCost.evidence} : {}) })} disabled={!canSave}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-black hover:bg-violet-700 disabled:opacity-30">
            {busy ? '처리 중…' : pendingReceipt ? '입고 요청 재개' : '가공입고'}
          </button>
        </div>
    </ModalShell>
  );
}

// ── 가공비 전표 발행 (사용자 확인) ───────────────────────────────────────────
function FeeModal({ po, items, companyId, busy, onClose, onSubmit, orderUnitInputs }: {
  orderUnitInputs?: OrderUnitInputs;
  po: PurchaseOrder; items: Item[]; companyId: CompanyId; busy: boolean;
  onClose: () => void;
  onSubmit: (v: { unitPricePerKg: number; date: string }) => void;
}) {
  const [date, setDate] = useState(today());
  const [fee, setFee] = useState(String(po.oemFeePerKg ?? OEM_DEFAULT_FEE_PER_KG));
  const kg = po.oemReceivedKg ?? 0;
  const money = processingFee(kg, Number(fee) || 0);
  const reconciliation = reconcileOemBatch(po, items, companyId, orderUnitInputs);

  return (
    <ModalShell title="가공비 전표 발행" onClose={onClose} bodyClassName="space-y-4">
        <p className="text-[11px] text-slate-400 leading-snug">
          입고 내역을 확인하고 발행하세요. <b>가공비만</b> 매입전표로 끊깁니다 — 원료는 우리 것이라 금액에 없습니다.
        </p>

        <div className="bg-slate-50 rounded-2xl px-4 py-3 space-y-1 text-xs">
          <div className="flex justify-between"><span className="text-slate-400 font-bold">외주공장</span><span className="font-black">{po.partnerName}</span></div>
          <div className="flex justify-between"><span className="text-slate-400 font-bold">보낸 원료</span><span className="font-black tabular-nums">{fmt(sentKg(po.oemSent))} kg</span></div>
          <div className="flex justify-between"><span className="text-slate-400 font-bold">총회수 중량 (저장값)</span><span className="font-black tabular-nums">{po.oemReceivedKg === undefined ? '자료 없음' : `${fmt(po.oemReceivedKg)} kg`}</span></div>
          <div className="flex justify-between"><span className="text-slate-400 font-bold">{reconciliation?.productWeightBasis === 'saved-receipt' ? '제품 중량 (저장된 원입고 기준)' : reconciliation?.productWeightBasis === 'unconfirmed' ? '제품 중량 (입고 근거 미확인)' : '제품 중량 (현재 품목 기준 환산)'}</span><span className="font-black tabular-nums">{reconciliation?.unallocatedProductKg === undefined ? '자료 없음' : `${fmt(reconciliation.unallocatedProductKg)} kg`}</span></div>
          {reconciliation?.materials.map(material => <div key={material.material} className="flex justify-between"><span className="text-slate-400 font-bold">{material.material} 벌크 회수</span><span className="font-black tabular-nums">{material.returnedBulkKg === undefined ? '자료 없음' : `${fmt(material.returnedBulkKg)} kg`}</span></div>)}
          <div className="flex justify-between"><span className="text-slate-400 font-bold">산술 차이 · 손실 미확정</span><span className="font-black tabular-nums text-rose-600">{reconciliation?.unresolvedBatchKg === undefined ? '미확정' : `${fmt(reconciliation.unresolvedBatchKg)} kg`}</span></div>
          {reconciliation?.issues.map(issue => <p key={issue} className="text-amber-700">{issue}</p>)}
        </div>

        <OemCostSummary po={po}/>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">
              가공단가 (원/kg) <span className="text-slate-300 normal-case font-bold">· 부가세 포함</span>
            </label>
            <input inputMode="numeric" value={fee} onChange={e => setFee(e.target.value.replace(/[^\d]/g, ''))}
              className="w-28 border border-slate-200 rounded-xl px-3 py-2 text-right text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-amber-300" />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">전표일자</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-amber-300" />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-400">공급가 {fmt(money.supply)} + 세액 {fmt(money.tax)}</span>
          <span className="text-base font-black text-slate-800">{fmt(money.total)}원</span>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200">취소</button>
          <button onClick={() => onSubmit({ unitPricePerKg: Number(fee) || 0, date })} disabled={busy || kg <= 0}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white text-xs font-black hover:bg-amber-600 disabled:opacity-30">
            {busy ? '발행 중…' : '전표 발행'}
          </button>
        </div>
    </ModalShell>
  );
}

function OemCostSummary({po}:{po:PurchaseOrder}) {
 const cost=po.oemBatchCost;
 if(!cost || cost.status==='blocked') return <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">OEM 원가 미확인 · {cost?.reason==='yield-unconfirmed' ? '받은 중량이 보낸 중량보다 많아 확인이 필요합니다.' : cost?.reason==='fee-changed' ? '가공비 전표 변경으로 재확인이 필요합니다.' : cost?.reason==='fee-deleted' ? '가공비 전표 삭제로 재확인이 필요합니다.' : !cost || cost.reason==='missing-evidence' ? '직접 확인한 원료·부자재 원가 근거가 없습니다.' : '원가 근거 확인이 필요합니다.'}</p>;
 return <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-1">
   <strong>OEM 원가 {cost.status==='confirmed' ? '확정' : '가공비 공급가액 확인 대기'}</strong>
   <p>원료 공급가액 {fmt(cost.rawSupplyAmount)}원 · 부자재 공급가액 {fmt(cost.packagingSupplyAmount)}원</p>
   <p>회수 중량 {fmt(cost.receivedKg)}kg · 손실 {fmt(cost.lossKg)}kg</p>
   {cost.status==='confirmed' && <><p>가공비 공급가액 {fmt(cost.feeSupplyAmount)}원 · 총 공급원가 {fmt(cost.totalSupplyAmount)}원</p><p>확정 원가 {fmt(cost.costPerKg)}원/kg</p></>}
 </div>;
}
