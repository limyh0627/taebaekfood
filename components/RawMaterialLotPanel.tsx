import React, { useState } from 'react';
import { ArrowUp, ArrowDown, Layers, Truck, Trash2, CornerDownRight, Tag, Check, X, History } from 'lucide-react';
import { Item, RawMaterialLot, RawMaterialEntry } from '../src/shared/types';
import { mutateRawMaterialLots, updateItem, addItem } from '../src/shared/services/firebaseService';
import { baseRawName, unitOf, kgToUnit, lotKgRemaining, lotStockInUnit } from '../src/constants/formula';
import RawLedgerList from './RawLedgerList';

interface Props {
  product: Item;        // 로트가 저장된 원료(raw) 품목
  isAdmin?: boolean;
  linkedNote?: string;  // 다른 SKU(캔/반제품)에서 펼친 경우 안내 문구
  ledgerEntries?: RawMaterialEntry[];        // 이 원료의 입출고(수불) 기록
  onDeleteEntry?: (id: string) => void;      // 기록 삭제(관리자)
  currentUserName?: string;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

/** 원료재고 로트 패널 — 배열 순서 = 선입선출(앞=먼저 사용). 기름은 L 표시(괄호 kg 병기). */
const RawMaterialLotPanel: React.FC<Props> = ({ product, isAdmin = false, linkedNote, ledgerEntries, onDeleteEntry, currentUserName }) => {
  const material = baseRawName(product.name);
  const isOil = unitOf(material) === 'L';
  const unitLabel = isOil ? 'L' : 'kg';

  const allLots: RawMaterialLot[] = product.lots ?? [];
  const active = allLots.filter(l => l.status === 'active');
  const depleted = allLots.filter(l => l.status !== 'active');
  const [showDepleted, setShowDepleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');

  // 기름 혼합 사용 설정 (상위 2개 로트 비율 배분)
  const mixEnabled = !!product.mixEnabled;
  const topPct = product.mixTopPercent ?? 50;
  const [pctDraft, setPctDraft] = useState<string>(String(topPct));
  React.useEffect(() => { setPctDraft(String(product.mixTopPercent ?? 50)); }, [product.mixTopPercent]);

  const totalKg = lotKgRemaining(active);
  const totalUnit = isOil ? kgToUnit(totalKg, material) : totalKg;

  const setMixEnabled = async (on: boolean) => {
    try { await updateItem('items', product.id, { mixEnabled: on, mixTopPercent: product.mixTopPercent ?? 50 }); }
    catch (err) { console.error('[혼합 설정 실패]', err); }
  };
  const commitPct = async () => {
    let v = parseInt(pctDraft, 10);
    if (isNaN(v)) v = 50;
    v = Math.max(0, Math.min(100, v));
    setPctDraft(String(v));
    if (v !== topPct) {
      try { await updateItem('items', product.id, { mixTopPercent: v }); }
      catch (err) { console.error('[혼합 비율 저장 실패]', err); }
    }
  };

  // active[i]와 active[i+dir]의 위치를 (id 기준으로) 전체 배열 안에서 교환 → 동시 입고와 충돌 방지
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (busy || j < 0 || j >= active.length) return;
    const aId = active[i].id;
    const bId = active[j].id;
    setBusy(true);
    try {
      await mutateRawMaterialLots(
        product.id,
        (cur) => {
          const arr = [...cur];
          const ia = arr.findIndex(l => l.id === aId);
          const ib = arr.findIndex(l => l.id === bId);
          if (ia >= 0 && ib >= 0) { const t = arr[ia]; arr[ia] = arr[ib]; arr[ib] = t; }
          return arr;
        },
        (lots) => lotStockInUnit(lots, material),
      );
    } catch (err) {
      console.error('[로트 순서변경 실패]', err);
    } finally {
      setBusy(false);
    }
  };

  // 로트 삭제 — 잔여 수량이 재고에서 빠짐 (테스트 입고 정리/오입력 정정용, 관리자 전용)
  const remove = async (lot: RawMaterialLot) => {
    const remUnit = isOil ? kgToUnit(lot.kgRemaining, material) : lot.kgRemaining;
    if (busy) return;
    if (!confirm(`[${lot.supplierName}] 로트를 삭제할까요?\n잔여 ${fmt(remUnit)}${unitLabel}가 재고에서 빠집니다. (되돌릴 수 없음)`)) return;
    setBusy(true);
    try {
      await mutateRawMaterialLots(
        product.id,
        (cur) => cur.filter(l => l.id !== lot.id),
        (lots) => lotStockInUnit(lots, material),
      );
      // 감사추적: 로트 삭제도 수불부에 남긴다 (예전엔 흔적 없이 재고가 빠져 원인 추적이 안 됐음)
      if (lot.kgRemaining > 0) {
        await addItem('rawMaterialLedger', {
          id: `rm-lotdel-${Date.now()}`,
          material,
          date: new Date().toISOString().slice(0, 10),
          received: 0,
          used: lot.kgRemaining,
          note: `로트 삭제: ${lot.supplierName}${lot.lotNo ? ` (${lot.lotNo})` : ''}${currentUserName ? ` · ${currentUserName}` : ''}`,
          createdAt: new Date().toISOString(),
          type: 'correction',
          unit: 'kg',
        });
      }
    } catch (err) {
      console.error('[로트 삭제 실패]', err);
    } finally {
      setBusy(false);
    }
  };

  // 로트번호 저장 — 캔/포대 라벨의 제조사 로트번호를 직접 입력 (빈 값이면 키 제거)
  const saveLotNo = async (lot: RawMaterialLot) => {
    const v = editVal.trim();
    setBusy(true);
    try {
      await mutateRawMaterialLots(
        product.id,
        (cur) => cur.map(l => {
          if (l.id !== lot.id) return l;
          if (v) return { ...l, lotNo: v };
          const { lotNo, ...rest } = l; // 빈 값이면 lotNo 키 제거
          return rest as RawMaterialLot;
        }),
        (lots) => lotStockInUnit(lots, material),
      );
      setEditingId(null);
    } catch (err) {
      console.error('[로트번호 저장 실패]', err);
    } finally {
      setBusy(false);
    }
  };

  const lotRow = (lot: RawMaterialLot, idx: number, total: number, dim: boolean) => {
    const remUnit = isOil ? kgToUnit(lot.kgRemaining, material) : lot.kgRemaining;
    const pkg = lot.packageKg && lot.qtyIn
      ? `${lot.packageKg}kg × ${lot.qtyIn}${lot.packageType ?? '개'}`
      : null;
    return (
      <div key={lot.id} className={`flex items-center gap-2 px-3 py-2.5 ${dim ? 'opacity-50' : ''} ${idx > 0 ? 'border-t border-emerald-50' : ''}`}>
        <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
          {lot.supplierName === '이월'
            ? <Layers size={13} className="text-emerald-600" />
            : <Truck size={13} className="text-emerald-600" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-black text-slate-800">{lot.supplierName}</span>
            {pkg && <span className="text-[10px] font-bold text-slate-400">{pkg}</span>}
            {/* 혼합 비율 배지 — 상위 2개 active 로트 */}
            {mixEnabled && !dim && idx < 2 && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">혼합 {idx === 0 ? topPct : 100 - topPct}%</span>
            )}
            {/* 로트번호 — 클릭(관리자)하면 인라인 편집 */}
            {editingId === lot.id ? (
              <span className="inline-flex items-center gap-1">
                <input
                  autoFocus
                  value={editVal}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveLotNo(lot); if (e.key === 'Escape') setEditingId(null); }}
                  placeholder="로트번호"
                  className="w-24 text-[10px] font-bold border border-slate-300 rounded-md px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-emerald-400"
                />
                <button disabled={busy} onClick={(e) => { e.stopPropagation(); saveLotNo(lot); }} className="p-0.5 text-emerald-600 hover:bg-emerald-50 rounded"><Check size={12} /></button>
                <button onClick={(e) => { e.stopPropagation(); setEditingId(null); }} className="p-0.5 text-slate-400 hover:bg-slate-100 rounded"><X size={12} /></button>
              </span>
            ) : lot.lotNo ? (
              <button
                onClick={(e) => { e.stopPropagation(); if (isAdmin && !dim) { setEditingId(lot.id); setEditVal(lot.lotNo ?? ''); } }}
                className={`text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 inline-flex items-center gap-0.5 ${isAdmin && !dim ? 'hover:bg-slate-200 cursor-pointer' : 'cursor-default'}`}
                title={isAdmin && !dim ? '로트번호 수정' : undefined}
              ><Tag size={9} /> {lot.lotNo}</button>
            ) : (isAdmin && !dim) ? (
              <button
                onClick={(e) => { e.stopPropagation(); setEditingId(lot.id); setEditVal(''); }}
                className="text-[9px] font-black px-1.5 py-0.5 rounded-full border border-dashed border-slate-300 text-slate-400 hover:border-emerald-300 hover:text-emerald-500 inline-flex items-center gap-0.5"
              ><Tag size={9} /> 로트번호</button>
            ) : null}
          </div>
          <span className="text-[10px] text-slate-400">입고 {lot.receivedDate}</span>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-black text-emerald-700">{fmt(remUnit)} {unitLabel}</div>
          {isOil && <div className="text-[10px] text-slate-400">{fmt(lot.kgRemaining)} kg</div>}
        </div>
        {!dim && (
          <div className="flex items-center gap-1 shrink-0">
            <div className="flex flex-col gap-0.5">
              <button
                disabled={busy || idx === 0}
                onClick={(e) => { e.stopPropagation(); move(idx, -1); }}
                className="p-1 rounded-md bg-white border border-emerald-200 text-emerald-600 disabled:opacity-30 hover:bg-emerald-50 transition-colors"
                title="먼저 사용 (위로)"
              ><ArrowUp size={12} /></button>
              <button
                disabled={busy || idx === total - 1}
                onClick={(e) => { e.stopPropagation(); move(idx, 1); }}
                className="p-1 rounded-md bg-white border border-emerald-200 text-emerald-600 disabled:opacity-30 hover:bg-emerald-50 transition-colors"
                title="나중에 사용 (아래로)"
              ><ArrowDown size={12} /></button>
            </div>
            {isAdmin && (
              <button
                disabled={busy}
                onClick={(e) => { e.stopPropagation(); remove(lot); }}
                className="p-1.5 rounded-md bg-white border border-rose-200 text-rose-400 disabled:opacity-30 hover:bg-rose-50 hover:text-rose-500 transition-colors"
                title="로트 삭제"
              ><Trash2 size={12} /></button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
      {linkedNote && (
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 bg-emerald-50 rounded-lg px-2.5 py-1.5">
          <CornerDownRight size={12} className="shrink-0" />
          <span>{linkedNote}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-black text-emerald-700 uppercase tracking-wide">입고 로트 {mixEnabled ? '(혼합 사용)' : '(선입선출)'}</span>
        <span className="text-sm font-black text-emerald-800">
          합계 {fmt(totalUnit)} {unitLabel}{isOil && <span className="text-[11px] font-bold text-emerald-500"> ({fmt(totalKg)} kg)</span>}
        </span>
      </div>

      {/* 기름 혼합 사용 — 상위 2개 로트를 비율대로 차감 (관리자, 기름만) */}
      {isOil && isAdmin && (
        <div className="flex items-center gap-2 flex-wrap bg-amber-50/60 border border-amber-100 rounded-xl px-3 py-2">
          <button
            onClick={(e) => { e.stopPropagation(); setMixEnabled(!mixEnabled); }}
            className={`text-[11px] font-black px-2.5 py-1 rounded-full transition-colors ${mixEnabled ? 'bg-amber-500 text-white' : 'bg-white text-amber-600 border border-amber-200'}`}
          >혼합 사용 {mixEnabled ? 'ON' : 'OFF'}</button>
          {mixEnabled && (
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-700">
              <span>상위 2개 로트 비율</span>
              <input
                type="number" min={0} max={100}
                value={pctDraft}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setPctDraft(e.target.value)}
                onBlur={commitPct}
                onKeyDown={(e) => { if (e.key === 'Enter') commitPct(); }}
                className="w-12 text-center border border-amber-300 rounded-md px-1 py-0.5 outline-none focus:ring-2 focus:ring-amber-400"
              />
              <span>: {100 - (parseInt(pctDraft, 10) || 0)}</span>
              {active.length < 2 && <span className="text-amber-400">(로트 2개 이상일 때 적용)</span>}
            </div>
          )}
        </div>
      )}

      {active.length === 0 ? (
        <div className="bg-white rounded-xl border border-emerald-100 px-3 py-6 text-center text-xs font-bold text-slate-300">
          등록된 로트가 없습니다. 거래처 입고 시 자동 생성됩니다.
        </div>
      ) : (
        <>
          <p className="text-[10px] font-bold text-emerald-500">↑ 위 로트부터 사용됩니다 · ▲▼로 순서 변경</p>
          <div className="bg-white rounded-xl border border-emerald-100 overflow-hidden">
            {active.map((lot, i) => lotRow(lot, i, active.length, false))}
          </div>
        </>
      )}

      {depleted.length > 0 && (
        <div>
          <button
            onClick={(e) => { e.stopPropagation(); setShowDepleted(v => !v); }}
            className="text-[10px] font-black text-slate-400 hover:text-slate-600 transition-colors"
          >
            {showDepleted ? '▼' : '▶'} 소진된 로트 {depleted.length}건
          </button>
          {showDepleted && (
            <div className="bg-white rounded-xl border border-slate-100 overflow-hidden mt-1.5">
              {depleted.map((lot, i) => lotRow(lot, i, depleted.length, true))}
            </div>
          )}
        </div>
      )}

      {/* 이 원료의 입출고(수불) 기록 — 수동/자동/정정 모두 */}
      {ledgerEntries && (
        <div className="pt-1">
          <div className="flex items-center gap-1.5 mb-1.5">
            <History size={12} className="text-slate-400" />
            <span className="text-[11px] font-black text-slate-600 uppercase tracking-wide">입출고 기록</span>
          </div>
          <RawLedgerList
            entries={ledgerEntries}
            isAdmin={isAdmin}
            currentUserName={currentUserName}
            onDelete={onDeleteEntry}
            pageSize={6}
            emptyText="이 원료의 입출고 기록이 없습니다"
          />
        </div>
      )}
    </div>
  );
};

export default RawMaterialLotPanel;
