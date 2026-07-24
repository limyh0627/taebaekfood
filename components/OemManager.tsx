import React, { useMemo, useState } from 'react';
import { Plus, X, ArrowRight } from 'lucide-react';
import { Item, Partner, PurchaseOrder } from '../src/shared/types';
import { sentKg, batchLoss, processingFee } from '../src/features/admin/oem';
import { itemKg, OEM_DEFAULT_FEE_PER_KG } from '../src/features/admin/oemEngine';

/**
 * 임가공(OEM) 모달 호스트 — 목록은 기존 입고대기·입고이력에 녹아 있고,
 * 여기서는 발주/가공입고/가공비전표 모달만 띄운다. 열림 상태는 ItemList가 제어.
 */
interface Props {
  items: Item[];
  partners: Partner[];
  rawStockKg: (material: string) => number;
  issueOpen: boolean;
  receiveTarget: PurchaseOrder | null;
  feeTarget: PurchaseOrder | null;
  onClose: () => void;
  onIssue: (input: { oemPartnerId: string; partnerName: string; sent: { material: string; kg: number }[]; date: string; note?: string }) => Promise<void>;
  onReceive: (input: { po: PurchaseOrder; returns: { itemId: string; qty: number }[]; unitPricePerKg: number; date: string }) => Promise<void>;
  onIssueFee: (input: { po: PurchaseOrder; unitPricePerKg: number; date: string }) => Promise<void>;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');
const today = () => new Date().toISOString().slice(0, 10);

export default function OemManager({
  items, partners, rawStockKg, issueOpen, receiveTarget, feeTarget, onClose, onIssue, onReceive, onIssueFee,
}: Props) {
  const [busy, setBusy] = useState(false);

  const oemItems = useMemo(() => items.filter(i => !i.archived && i.procureType === '임가공'), [items]);
  const rawItems = useMemo(
    () => items.filter(i => !i.archived && !i.phantom && (i.category === 'raw' || (i.category === 'wip' && i.unit !== '개'))),
    [items],
  );

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); onClose(); } finally { setBusy(false); } };

  return (
    <>
      {issueOpen && (
        <IssueModal partners={partners} rawItems={rawItems} rawStockKg={rawStockKg} busy={busy}
          onClose={onClose} onSubmit={(v) => run(() => onIssue(v))} />
      )}
      {receiveTarget && (
        <ReceiveModal po={receiveTarget} oemItems={oemItems} busy={busy}
          onClose={onClose} onSubmit={(v) => run(() => onReceive({ po: receiveTarget, ...v }))} />
      )}
      {feeTarget && (
        <FeeModal po={feeTarget} busy={busy}
          onClose={onClose} onSubmit={(v) => run(() => onIssueFee({ po: feeTarget, ...v }))} />
      )}
    </>
  );
}

// ── 외주 발주 (원료 내보내기) ────────────────────────────────────────────────
function IssueModal({ partners, rawItems, rawStockKg, busy, onClose, onSubmit }: {
  partners: Partner[]; rawItems: Item[]; rawStockKg: (m: string) => number; busy: boolean;
  onClose: () => void;
  onSubmit: (v: { oemPartnerId: string; partnerName: string; sent: { material: string; kg: number }[]; date: string; note?: string }) => void;
}) {
  const [partnerId, setPartnerId] = useState('');
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<{ material: string; kg: string }[]>([{ material: '', kg: '' }]);
  const [note, setNote] = useState('');

  const partner = partners.find(p => p.id === partnerId);
  const sent = rows.filter(r => r.material && Number(r.kg) > 0).map(r => ({ material: r.material, kg: Number(r.kg) }));
  const shortage = sent.filter(s => s.kg > rawStockKg(s.material));
  const canSave = !!partnerId && sent.length > 0 && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-800">외주 발주 <span className="text-[11px] font-bold text-slate-400">· 원료 내보내기</span></h3>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-500"><X size={18} /></button>
        </div>
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
                <select value={r.material} onChange={e => setRows(p => p.map((x, j) => j === i ? { ...x, material: e.target.value } : x))}
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

        <input value={note} onChange={e => setNote(e.target.value)} placeholder="메모 (선택)"
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-300" />

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200">취소</button>
          <button onClick={() => onSubmit({ oemPartnerId: partnerId, partnerName: partner?.name ?? '', sent, date, note: note.trim() || undefined })}
            disabled={!canSave}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 text-white text-xs font-black hover:bg-slate-900 disabled:opacity-30">
            {busy ? '처리 중…' : '발주 (원료 내보내기)'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 가공입고 (완제품 받기) ───────────────────────────────────────────────────
function ReceiveModal({ po, oemItems, busy, onClose, onSubmit }: {
  po: PurchaseOrder; oemItems: Item[]; busy: boolean;
  onClose: () => void;
  onSubmit: (v: { returns: { itemId: string; qty: number }[]; unitPricePerKg: number; date: string }) => void;
}) {
  const [date, setDate] = useState(today());
  const [fee, setFee] = useState(String(po.oemFeePerKg ?? OEM_DEFAULT_FEE_PER_KG));
  const [rows, setRows] = useState<{ itemId: string; qty: string }[]>([{ itemId: '', qty: '' }]);

  const returns = rows.filter(r => r.itemId && Number(r.qty) > 0).map(r => ({ itemId: r.itemId, qty: Number(r.qty) }));
  const receivedKg = returns.reduce((a, r) => {
    const it = oemItems.find(i => i.id === r.itemId);
    return a + (it ? itemKg(it) * r.qty : 0);
  }, 0);
  const s = sentKg(po.oemSent);
  const loss = batchLoss(po.oemSent, receivedKg);
  const money = processingFee(receivedKg, Number(fee) || 0);
  const canSave = returns.length > 0 && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-800">가공입고</h3>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-500"><X size={18} /></button>
        </div>

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
            const kg = it ? itemKg(it) * (Number(r.qty) || 0) : 0;
            return (
              <div key={i} className="flex items-center gap-1.5">
                <select value={r.itemId} onChange={e => setRows(p => p.map((x, j) => j === i ? { ...x, itemId: e.target.value } : x))}
                  className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-300">
                  <option value="">— 품목 —</option>
                  {oemItems.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
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

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">가공단가 (원/kg)</label>
          <input inputMode="numeric" value={fee} onChange={e => setFee(e.target.value.replace(/[^\d]/g, ''))}
            className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-right text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-violet-300" />
        </div>

        <div className="bg-slate-50 rounded-2xl px-4 py-3 space-y-1 text-xs">
          <div className="flex justify-between"><span className="text-slate-400 font-bold">받은 완제품</span><span className="font-black tabular-nums">{fmt(receivedKg)} kg</span></div>
          <div className="flex justify-between"><span className="text-slate-400 font-bold">로스 (수율손실)</span><span className="font-black tabular-nums text-rose-600">{fmt(loss)} kg</span></div>
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
          <button onClick={() => onSubmit({ returns, unitPricePerKg: Number(fee) || 0, date })} disabled={!canSave}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-black hover:bg-violet-700 disabled:opacity-30">
            {busy ? '처리 중…' : '가공입고'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 가공비 전표 발행 (사용자 확인) ───────────────────────────────────────────
function FeeModal({ po, busy, onClose, onSubmit }: {
  po: PurchaseOrder; busy: boolean;
  onClose: () => void;
  onSubmit: (v: { unitPricePerKg: number; date: string }) => void;
}) {
  const [date, setDate] = useState(today());
  const [fee, setFee] = useState(String(po.oemFeePerKg ?? OEM_DEFAULT_FEE_PER_KG));
  const kg = po.oemReceivedKg ?? 0;
  const money = processingFee(kg, Number(fee) || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-800">가공비 전표 발행</h3>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-500"><X size={18} /></button>
        </div>
        <p className="text-[11px] text-slate-400 leading-snug">
          입고 내역을 확인하고 발행하세요. <b>가공비만</b> 매입전표로 끊깁니다 — 원료는 우리 것이라 금액에 없습니다.
        </p>

        <div className="bg-slate-50 rounded-2xl px-4 py-3 space-y-1 text-xs">
          <div className="flex justify-between"><span className="text-slate-400 font-bold">외주공장</span><span className="font-black">{po.partnerName}</span></div>
          <div className="flex justify-between"><span className="text-slate-400 font-bold">보낸 원료</span><span className="font-black tabular-nums">{fmt(sentKg(po.oemSent))} kg</span></div>
          <div className="flex justify-between"><span className="text-slate-400 font-bold">받은 완제품</span><span className="font-black tabular-nums">{fmt(kg)} kg</span></div>
          <div className="flex justify-between"><span className="text-slate-400 font-bold">로스</span><span className="font-black tabular-nums text-rose-600">{fmt(batchLoss(po.oemSent, kg))} kg</span></div>
        </div>

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
      </div>
    </div>
  );
}
