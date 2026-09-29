import React, { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, ClipboardCheck, PackageOpen, Truck } from 'lucide-react';
import { companyOf, type Item, type RawMaterialEntry } from '../src/shared/types';
import type { ItemInventoryEntry } from '../src/features/admin/itemLedger';
import type { UnpackLotMove } from '../src/shared/unpackLots';
import { isRawHolder } from '../src/shared/rawHolder';
import type { LotShipment } from './ProductLotPanel';

type TimelineRow = {
  id: string; date: string; title: string; note: string;
  businessDate?: string; sequence?: number;
  delta?: number; balance?: number;
  details?: { id: string; partnerName: string; qty: number }[];
  kind: 'in' | 'out' | 'stocktake' | 'correction' | 'lot' | 'unpack' | 'merge';
};

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString();

// 옛 개봉 기록에는 캔 lotId가 없다. 번호·공급처·입고일이 유일하게 일치할 때만 연결한다.
const canLotForMove = (item: Item, move: UnpackLotMove) => {
  if (move.canLotId) return (item.lots ?? []).find(lot => lot.id === move.canLotId);
  if (!move.lotNo || !move.receivedDate || !move.supplierName) return undefined;
  const matches = (item.lots ?? []).filter(lot => lot.lotNo === move.lotNo
    && lot.supplierName === move.supplierName && lot.receivedDate === move.receivedDate);
  return matches.length === 1 ? matches[0] : undefined;
};

const recordedTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || value.length <= 10) return value.slice(0, 16).replace('T', ' ');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
};

const newestFirst = (a: TimelineRow, b: TimelineRow) => {
  const aTime = Date.parse(a.date);
  const bTime = Date.parse(b.date);
  return (Number.isFinite(aTime) && Number.isFinite(bTime) ? bTime - aTime : b.date.localeCompare(a.date))
    || Number(b.sequence ?? 0) - Number(a.sequence ?? 0)
    || b.id.localeCompare(a.id, undefined, { numeric: true });
};

/** 로트 상세는 원장 표를 복제하지 않고, 해당 품목에서 실제로 일어난 사건만 시간순으로 보여준다. */
const LotTimeline: React.FC<{
  item: Item;
  lotId: string;
  rawEntries?: RawMaterialEntry[];
  shipmentRows?: Array<LotShipment & { lotId: string }>;
}> = ({ item, lotId, rawEntries = [], shipmentRows = [] }) => {
  const [showAll, setShowAll] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const rows = useMemo<TimelineRow[]>(() => {
    const raw = isRawHolder(item);
    const packed: TimelineRow[] = [];
    let hasReceipt = false;
    if (raw && rawEntries.length) {
      for (const entry of rawEntries as ItemInventoryEntry[]) {
        if (companyOf(entry) !== companyOf(item) || (entry.rawItemId && entry.rawItemId !== item.id)) continue;
        const change = entry.lotChanges?.find(row => row.lotId === lotId);
        if (!change) continue;
        const delta = Math.round(Number(change.deltaKg ?? 0) * 1000) / 1000;
        const stocktake = entry.targetKg != null || entry.kind === 'stocktake';
        const correction = entry.type === 'correction' || entry.kind === 'adjust-lot'
          || entry.kind === 'merge-lots' || entry.kind === 'deplete-lot';
        const unpack = entry.kind === 'unpack' || entry.source?.type === 'unpack';
        const merge = entry.kind === 'merge-lots';
        // 정정·사용만 남은 옛 로트는 최초 입고를 로트 정보에서 보충한다. 실제 입고·개봉과 중복하지 않는다.
        hasReceipt ||= delta > 0 && (entry.kind === 'receive' || entry.kind === 'opening' || unpack
          || (!entry.kind && !correction && !stocktake && Number(entry.received ?? 0) > 0));
        const counterpart = merge ? entry.lotChanges?.filter(row => row.lotId !== lotId)
          .map(row => row.lotSnapshot?.lotNo || row.lotNo || row.lotId).join(', ') : '';
        const timestamp = entry.recordedAt || entry.createdAt || entry.effectiveAt || entry.date;
        const afterKg = Number(change.afterKg ?? (change as { kgAfter?: number }).kgAfter);
        packed.push({
          id: entry.id || `${entry.date}-${entry.createdAt}`,
          date: timestamp,
          businessDate: entry.date || entry.effectiveAt?.slice(0, 10), sequence: entry.sequence,
          title: merge ? '로트 합치기' : unpack ? '캔 개봉' : correction ? '재고 정정' : stocktake ? '재고 실사' : delta >= 0 ? '입고' : '사용',
          note: merge ? [`로트 잔량 이동 ${delta > 0 ? '+' : ''}${fmt(delta)} kg · 총재고 증감 0kg`, counterpart && `상대 로트 ${counterpart}`, entry.note].filter(Boolean).join(' · ') : entry.note || entry.addedBy || '',
          delta: merge ? 0 : delta,
          balance: Number.isFinite(afterKg) ? afterKg : undefined,
          kind: merge ? 'merge' : unpack ? 'unpack' : correction ? 'correction' : stocktake ? 'stocktake' : delta >= 0 ? 'in' : 'out',
        });
      }
    }
    if (!raw) for (const row of rawEntries as ItemInventoryEntry[]) {
      if (companyOf(row) !== companyOf(item) || row.source?.type !== 'unpack' || row.source.id !== item.id) continue;
      const moves = (row.unpackMoves ?? []).filter(move => canLotForMove(item, move)?.id === lotId);
      if (!moves.length) continue;
      packed.push({
        id: row.id, date: row.recordedAt || row.createdAt || row.effectiveAt || row.date,
        businessDate: row.date, sequence: row.sequence, title: '캔 개봉', kind: 'unpack',
        delta: -moves.reduce((sum, move) => sum + move.cans, 0),
        note: `벌크 ${fmt(moves.reduce((sum, move) => sum + move.bulkQty, 0))} kg로 이동`,
      });
    }
    for (const lot of (item.lots ?? []).filter(row => row.id === lotId)) {
      if (raw && hasReceipt) continue;
      if (lot.id.startsWith('anchor-') || lot.id.startsWith('adjust-')) continue;
      // 원료의 qtyIn은 포·캔 개수다. kgIn과 섞으면 2.5포 입고가 2.5kg으로 보인다.
      const receiptQty = raw ? Number(lot.kgIn) : Number(lot.qtyIn);
      packed.push({
        id: `lot-${lot.id}`, date: lot.createdAt || lot.receivedDate || '',
        title: lot.supplierName === '실사조정' ? '재고 실사' : '로트 입고',
        note: [lot.supplierName, lot.lotNo].filter(Boolean).join(' · '),
        delta: Number.isFinite(receiptQty) ? receiptQty : undefined,
        kind: lot.supplierName === '실사조정' ? 'stocktake' : 'lot',
      });
    }
    if (raw) return packed.sort(newestFirst);
    const byDate = new Map<string, { qty: number; rows: Array<LotShipment & { lotId: string }> }>();
    for (const shipment of shipmentRows.filter(row => row.lotId === lotId)) {
      const date = shipment.date?.slice(0, 10) || '-';
      const grouped = byDate.get(date) ?? { qty: 0, rows: [] };
      grouped.qty += Number(shipment.qty ?? 0);
      grouped.rows.push(shipment);
      byDate.set(date, grouped);
    }
    for (const [date, grouped] of byDate) packed.push({
      id: `ship-${lotId}-${date}`, date,
      title: '출고', note: `${new Set(grouped.rows.map(row => row.partnerName).filter(Boolean)).size}개 거래처`,
      delta: -grouped.qty, kind: 'out',
      details: grouped.rows.map((row, index) => ({
        id: `${row.orderId}-${index}`, partnerName: row.partnerName || '거래처 미입력', qty: Number(row.qty ?? 0),
      })),
    });
    return packed.sort(newestFirst);
  }, [item, lotId, rawEntries, shipmentRows]);

  const unlinkedUnpack = !isRawHolder(item) && (rawEntries as ItemInventoryEntry[]).some(row =>
    companyOf(row) === companyOf(item) && row.source?.type === 'unpack' && row.source.id === item.id
    && (!row.unpackMoves?.length || row.unpackMoves.some(move => !canLotForMove(item, move))));
  const unlinkedNotice = unlinkedUnpack && <p className="mb-3 text-[11px] text-slate-500">로트를 특정할 수 없는 개봉 기록은 품목 원장에서 확인하세요.</p>;
  if (!rows.length) return <>{unlinkedNotice}<div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-[11px] font-bold text-slate-400">아직 남은 이력이 없습니다.</div></>;
  const style = {
    in: { icon: ArrowUpRight, dot: 'bg-emerald-500', text: 'text-emerald-600' },
    out: { icon: ArrowDownRight, dot: 'bg-rose-500', text: 'text-rose-600' },
    stocktake: { icon: ClipboardCheck, dot: 'bg-violet-500', text: 'text-violet-600' },
    correction: { icon: ClipboardCheck, dot: 'bg-amber-500', text: 'text-amber-600' },
    lot: { icon: Truck, dot: 'bg-sky-500', text: 'text-sky-600' },
    unpack: { icon: PackageOpen, dot: 'bg-blue-500', text: 'text-blue-600' },
    merge: { icon: ClipboardCheck, dot: 'bg-blue-500', text: 'text-blue-600' },
  } as const;

  const visible = showAll ? rows : rows.slice(0, 5);
  return <>
  {unlinkedNotice}
  <ol className="relative ml-2 border-l border-slate-200 pl-5 space-y-5">
    {visible.map(row => {
      const s = style[row.kind]; const Icon = s.icon;
      return <li key={row.id} className="relative">
        <span className={`absolute -left-[25px] top-1 w-2 h-2 rounded-full ring-4 ring-white ${s.dot}`} />
        <div className="flex items-start gap-2">
          <span className={`mt-0.5 ${s.text}`}><Icon size={13} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-black text-slate-700">{row.title}</span>
              {row.delta != null && <span className={`text-[11px] font-black tabular-nums ${row.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{row.delta > 0 ? '+' : ''}{fmt(row.delta)}{isRawHolder(item) ? ' kg' : ` ${item.unit || '개'}`}</span>}
            </div>
            <p className="mt-0.5 text-[10px] font-bold text-slate-400">
              {row.date ? `${row.businessDate ? '기록 ' : ''}${recordedTime(row.date)}` : '-'}
              {row.businessDate ? ` · 업무일 ${row.businessDate}` : ''}
              {row.note ? ` · ${row.note}` : ''}
            </p>
            {row.balance != null && <p className="mt-1 text-[10px] font-black text-slate-500">기록 직후 로트 잔량 {fmt(row.balance)} kg</p>}
            {row.details && row.details.length > 0 && <>
              <button type="button" onClick={() => setExpandedRows(current => {
                const next = new Set(current);
                if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
                return next;
              })} className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-black text-indigo-500">
                {expandedRows.has(row.id) ? <><ChevronUp size={11} />상세 닫기</> : <><ChevronDown size={11} />거래처별 상세보기</>}
              </button>
              {expandedRows.has(row.id) && <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-100 bg-slate-50 px-2.5">
                {row.details.map(detail => <div key={detail.id} className="flex items-center justify-between gap-3 py-1.5 text-[10px] font-bold">
                  <span className="truncate text-slate-500">{detail.partnerName}</span>
                  <span className="shrink-0 tabular-nums text-rose-600">-{fmt(detail.qty)} {item.unit || '개'}</span>
                </div>)}
              </div>}
            </>}
          </div>
        </div>
      </li>;
    })}
  </ol>
  {rows.length > 5 && <button type="button" onClick={() => setShowAll(value => !value)}
    className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-[11px] font-black text-slate-600 hover:bg-slate-100">
    {showAll ? <><ChevronUp size={13} />최근 5개만 보기</> : <><ChevronDown size={13} />나머지 {rows.length - 5}개 펼쳐 보기</>}
  </button>}
  </>;
};

export default LotTimeline;
