import React, { useState } from 'react';
import { ArrowUp, ArrowDown, Layers, Truck, Trash2, CornerDownRight, Tag, Check, X, History } from 'lucide-react';
import { Item, Order, RawMaterialLot, RawMaterialEntry } from '../src/shared/types';
import { updateItem } from '../src/shared/services/firebaseService';
import { updateRawInventoryLotMetadata } from '../src/shared/services/rawInventoryService';
import { baseRawName, unitOf, kgToUnit, lotKgRemaining } from '../src/constants/formula';
import { rawLedgerKeys } from '../src/shared/rawHolder';
import { executeRawInventoryCommand } from '../src/shared/services/rawInventoryService';
import RawLedgerList from './RawLedgerList';

interface Props {
  /** 그 주문에서 이 원료를 쓰는 줄만 골라 준다 — RawLedgerList 로 그대로 넘긴다. */
  linesUsingRaw?: (order: Order, material: string) => Order['items'] | undefined;
  /** 로트 관리 상세에서는 원장 표 대신 별도 타임라인을 쓴다. */
  showLedger?: boolean;
  product: Item;        // 로트가 저장된 원료(raw) 품목
  isAdmin?: boolean;
  linkedNote?: string;  // 다른 SKU(캔/반제품)에서 펼친 경우 안내 문구
  ledgerEntries?: RawMaterialEntry[];        // 이 원료의 입출고(수불) 기록
  orders?: Order[];                          // 자동 줄이 어느 주문 때문인지 풀 때 쓴다
  /** 로트 목록과 입출고 기록 **사이**에 끼울 것 — 박스 로트 판이 여기 온다 */
  박스로트?: React.ReactNode;
  onDeleteEntry?: (id: string) => void;      // 기록 삭제(관리자)
  currentUserName?: string;
  onLotChanged?: () => void;                 // 로트 삭제 등 원장 쓰기 후 상위 화면 재조회 트리거
  /** 로트 상세 화면에서 눌러 들어온 로트를 강조한다. 차감 순서 조정을 위해 활성 목록은 모두 보여준다. */
  focusLotId?: string;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

/** 원료재고 로트 패널 — 배열 순서 = 선입선출(앞=먼저 사용). 기름은 L 표시(괄호 kg 병기). */
const RawMaterialLotPanel: React.FC<Props> = ({ product, isAdmin = false, linkedNote, ledgerEntries, orders, onDeleteEntry, currentUserName, onLotChanged, 박스로트, linesUsingRaw, showLedger = true, focusLotId }) => {
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
  const initialMixDraft = () => {
    const saved = (product.mixLotRatios ?? []).filter(row => active.some(lot => lot.id === row.lotId));
    if (product.mixLotRatios !== undefined) return Object.fromEntries(saved.map(row => [row.lotId, String(row.percent)]));
    const firstTwo = active.slice(0, 2);
    if (firstTwo.length < 2) return {};
    const top = product.mixTopPercent ?? 50;
    return { [firstTwo[0].id]: String(top), [firstTwo[1].id]: String(100 - top) };
  };
  const [mixDraft, setMixDraft] = useState<Record<string, string>>(initialMixDraft);
  React.useEffect(() => { setMixDraft(initialMixDraft()); }, [product.mixLotRatios, product.mixTopPercent, product.lots]);

  const selectedMixIds = active.filter(lot => mixDraft[lot.id] != null).map(lot => lot.id);
  const mixTotal = selectedMixIds.reduce((sum, id) => sum + (Number(mixDraft[id]) || 0), 0);
  const equalMix = (ids: string[]) => Object.fromEntries(ids.map((id, index) => {
    const base = Math.floor(10000 / ids.length) / 100;
    return [id, String(index === ids.length - 1 ? Math.round((100 - base * index) * 100) / 100 : base)];
  }));

  const totalKg = lotKgRemaining(active);
  const totalUnit = isOil ? kgToUnit(totalKg, material) : totalKg;

  //  **'로트=통합재고' 스위치는 걷어냈다**(2026-09-16 사장님: "lotaretotal은 이제
  //  안쓰는거 아니야?"). 재고는 언제나 로트 합계다 — 품목마다 로트를 나눠 다는 이관이
  //  끝나서 예외가 필요 없어졌다. 켜 둔 품목만 장부가 깨져 있었다(`shared/types` 참고).

  const setMixEnabled = async (on: boolean) => {
    if (on && active.length < 2) { alert('혼합하려면 잔량이 있는 로트가 2개 이상 필요합니다.'); return; }
    // 켜는 순간에는 FIFO 1번만 선택한다. 두 번째부터는 사용자가 직접 혼합 대상을 고른다.
    const ratios = on && active[0] ? [{ lotId: active[0].id, percent: 100 }] : [];
    if (on) setMixDraft(Object.fromEntries(ratios.map(row => [row.lotId, String(row.percent)])));
    try { await updateItem('items', product.id, { mixEnabled: on, ...(on ? { mixLotRatios: ratios } : {}) }); }
    catch (err) { console.error('[혼합 설정 실패]', err); }
  };
  const toggleMixLot = (lotId: string) => {
    const ids = selectedMixIds.includes(lotId) ? selectedMixIds.filter(id => id !== lotId) : [...selectedMixIds, lotId];
    setMixDraft(ids.length ? equalMix(ids) : {});
  };
  const saveMixRatios = async () => {
    if (selectedMixIds.length < 2) { alert('혼합할 로트를 2개 이상 선택해 주세요.'); return; }
    if (selectedMixIds.some(id => !(Number(mixDraft[id]) > 0)) || Math.abs(mixTotal - 100) > 0.01) {
      alert('각 비율은 0보다 커야 하고 합계는 100%여야 합니다.'); return;
    }
    setBusy(true);
    try {
      await updateItem('items', product.id, {
        mixEnabled: true,
        mixLotRatios: selectedMixIds.map(lotId => ({ lotId, percent: Number(mixDraft[lotId]) })),
      });
    } catch (err) { console.error('[혼합 비율 저장 실패]', err); }
    finally { setBusy(false); }
  };

  // active[i]와 active[i+dir]의 위치를 (id 기준으로) 전체 배열 안에서 교환 → 동시 입고와 충돌 방지
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (busy || j < 0 || j >= active.length) return;
    const aId = active[i].id;
    const bId = active[j].id;
    setBusy(true);
    try {
      await updateRawInventoryLotMetadata({
        ...rawLedgerKeys(product),
        transform: (cur) => {
          const arr = [...cur];
          const ia = arr.findIndex(l => l.id === aId);
          const ib = arr.findIndex(l => l.id === bId);
          if (ia >= 0 && ib >= 0) { const t = arr[ia]; arr[ia] = arr[ib]; arr[ib] = t; }
          return arr;
        },
      });
    } catch (err) {
      console.error('[로트 순서변경 실패]', err);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 로트 소진 — **`deplete-lot` 공용 명령**으로 상태·이력·품목을 한 트랜잭션에 쓴다(설계 §9).
   *
   * 예전엔 `mutateRawMaterialLots` 로 로트를 빼고 `addItem('rawMaterialLedger')` 로 감사 원장을
   * 따로 남겼다. 뒤가 실패하면 로트만 사라지고 원장에 흔적이 없었다. 이제 이력은 지우지 않고
   * `deplete-lot` 하나로 표시된다 — 감사·되돌리기가 모두 이력의 `lotSnapshot` 을 근거로 한다.
   */
  const remove = async (lot: RawMaterialLot) => {
    const remUnit = isOil ? kgToUnit(lot.kgRemaining, material) : lot.kgRemaining;
    if (busy) return;
    if (!confirm(`[${lot.supplierName}] 로트를 소진 처리할까요?\n잔여 ${fmt(remUnit)}${unitLabel}가 재고에서 빠지고 이력에 남습니다.`)) return;
    setBusy(true);
    try {
      const opId = `deplete-lot:${product.id}:${lot.id}`;
      const r = await executeRawInventoryCommand({
        operationId: opId,
        ...rawLedgerKeys(product),
        materialSnapshot: material,
        effectiveAt: new Date().toISOString(),
        ...(currentUserName ? { actorName: currentUserName } : {}),
        source: { type: 'lot-delete', id: lot.id },
        kind: 'deplete-lot', lotId: lot.id,
      }, {
        legacy: {
          note: `로트 삭제: ${lot.supplierName}${lot.lotNo ? ` (${lot.lotNo})` : ''}`,
          type: 'correction',
          ...(currentUserName ? { addedBy: currentUserName } : {}),
        },
      });
      if (r.status === 'rejected') { alert(`로트 소진 거절 — ${r.code}: ${r.message}`); return; }
      if (r.status === 'conflict') { alert('같은 작업 번호로 다른 내용이 이미 저장돼 있습니다.'); return; }
      onLotChanged?.();
    } catch (err) {
      console.error('[로트 소진 실패]', err);
    } finally {
      setBusy(false);
    }
  };

  // 로트번호 저장 — 캔/포대 라벨의 제조사 로트번호를 직접 입력 (빈 값이면 키 제거)
  const saveLotNo = async (lot: RawMaterialLot) => {
    const v = editVal.trim();
    setBusy(true);
    try {
      await updateRawInventoryLotMetadata({
        ...rawLedgerKeys(product),
        transform: (cur) => cur.map(l => {
          if (l.id !== lot.id) return l;
          if (v) return { ...l, lotNo: v };
          const { lotNo, ...rest } = l; // 빈 값이면 lotNo 키 제거
          return rest as RawMaterialLot;
        }),
      });
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
      <div key={lot.id} className={`flex items-center gap-2 px-3 py-2.5 ${dim ? 'opacity-50' : ''} ${idx > 0 ? 'border-t border-slate-100' : ''} ${focusLotId === lot.id ? 'bg-indigo-50/70 ring-1 ring-inset ring-indigo-200' : ''}`}>
        {!dim && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-black text-white">{idx + 1}</span>}
        <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
          {lot.supplierName === '이월'
            ? <Layers size={13} className="text-slate-500" />
            : <Truck size={13} className="text-slate-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-black text-slate-800">{lot.supplierName}</span>
            {pkg && <span className="text-[10px] font-bold text-slate-400">{pkg}</span>}
            {/* 선택한 모든 혼합 로트의 실제 저장 예정 비율을 같은 자리에서 확인한다. */}
            {mixEnabled && !dim && mixDraft[lot.id] != null && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">혼합 {mixDraft[lot.id]}%</span>
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
          <div className="text-sm font-black text-slate-800">{fmt(remUnit)} {unitLabel}</div>
          {isOil && <div className="text-[10px] text-slate-400">{fmt(lot.kgRemaining)} kg</div>}
        </div>
        {!dim && (
          <div className="flex items-center gap-1 shrink-0">
            {mixEnabled && (
              <label className="mr-1 inline-flex items-center gap-1 text-[9px] font-black text-blue-600">
                <input type="checkbox" checked={mixDraft[lot.id] != null} onChange={() => toggleMixLot(lot.id)} />
                {mixDraft[lot.id] != null && <input type="number" min="0.01" max="100" step="0.01" value={mixDraft[lot.id]}
                  onClick={e => e.stopPropagation()} onChange={e => setMixDraft(current => ({ ...current, [lot.id]: e.target.value }))}
                  className="w-14 rounded-md border border-blue-200 bg-white px-1 py-0.5 text-right text-[10px] outline-none focus:ring-2 focus:ring-blue-200" />}
                {mixDraft[lot.id] != null && '%'}
              </label>
            )}
            <div className="flex flex-col gap-0.5">
              <button
                disabled={busy || idx === 0}
                onClick={(e) => { e.stopPropagation(); move(idx, -1); }}
                className="p-1 rounded-md bg-white border border-slate-200 text-slate-500 disabled:opacity-30 hover:bg-slate-50 transition-colors"
                title="먼저 사용 (위로)"
              ><ArrowUp size={12} /></button>
              <button
                disabled={busy || idx === total - 1}
                onClick={(e) => { e.stopPropagation(); move(idx, 1); }}
                className="p-1 rounded-md bg-white border border-slate-200 text-slate-500 disabled:opacity-30 hover:bg-slate-50 transition-colors"
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
        <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-bold text-slate-600">
          <CornerDownRight size={12} className="shrink-0" />
          <span>{linkedNote}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">입고 로트 {mixEnabled ? '(혼합 사용)' : '(선입선출)'}</span>
        <span className="text-sm font-black text-slate-800">
          합계 {fmt(totalUnit)} {unitLabel}{isOil && <span className="text-[11px] font-bold text-slate-400"> ({fmt(totalKg)} kg)</span>}
        </span>
      </div>

      {/* 포장 종류별 잔량 요약 — 박스/자루 규격이 여럿일 때 (예: 10kg박스 vs 20kg박스 얼마 남았는지) */}
      {(() => {
        const byPkg = new Map<number, { kg: number; type: string }>();
        active.forEach(l => {
          if (!l.packageKg || (l.kgRemaining ?? 0) <= 0) return;
          const cur = byPkg.get(l.packageKg) ?? { kg: 0, type: l.packageType ?? '개' };
          cur.kg += l.kgRemaining ?? 0;
          byPkg.set(l.packageKg, cur);
        });
        if (byPkg.size < 2) return null;
        return (
          <div className="flex flex-wrap gap-1.5">
            {[...byPkg.entries()].sort((a, b) => a[0] - b[0]).map(([pkgKg, v]) => (
              <span key={pkgKg} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-600">
                {pkgKg}kg{v.type} 잔량 {fmt(v.kg)}kg (≈{Math.floor(v.kg / pkgKg * 10) / 10}{v.type})
              </span>
            ))}
          </div>
        );
      })()}

      {/* 원료 혼합 사용 — 원료 종류와 무관하게 선택한 여러 로트를 저장 비율대로 차감한다. */}
      {isAdmin && (
        <div className="flex items-center gap-2 flex-wrap px-1 py-1">
          <button
            onClick={(e) => { e.stopPropagation(); setMixEnabled(!mixEnabled); }}
            className={`text-[11px] font-black px-2.5 py-1 rounded-full transition-colors ${mixEnabled ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 border border-blue-200'}`}
          >혼합 사용 {mixEnabled ? 'ON' : 'OFF'}</button>
          {mixEnabled && (
            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
              <span>로트 <b className="text-blue-600">{selectedMixIds.length}</b>개 선택 · 합계 {Math.round(mixTotal * 100) / 100}%</span>
              <button disabled={busy} onClick={saveMixRatios} className="px-1 py-1 font-black text-blue-600 hover:text-blue-700 disabled:opacity-40">비율 저장</button>
            </div>
          )}
        </div>
      )}

      {active.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-6 text-center text-xs font-bold text-slate-300">
          등록된 로트가 없습니다. 거래처 입고 시 자동 생성됩니다.
        </div>
      ) : (
        <>
          <p className="text-[10px] font-bold text-slate-400">↑ 위 로트부터 사용됩니다 · ▲▼로 순서 변경</p>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
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

      {/*  **박스 로트는 입출고 기록보다 위다**(2026-09-06 사장님).
           로트끼리(벌크·박스) 먼저 보이고, 그 밑에 기록이 온다. 전에는 이 판이 통째로
           박스 판 위에 있어서 입출고 기록이 박스 로트를 가로막고 있었다. */}
      {박스로트}

      {/* 이 원료의 입출고(수불) 기록 — 수동/자동/정정 모두 */}
      {showLedger && ledgerEntries && (
        <div className="pt-1">
          <div className="flex items-center gap-1.5 mb-1.5">
            <History size={12} className="text-slate-400" />
            <span className="text-[11px] font-black text-slate-600 uppercase tracking-wide">입출고 기록</span>
          </div>
          <RawLedgerList
            linesUsingRaw={linesUsingRaw}
            entries={ledgerEntries}
            orders={orders}
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
