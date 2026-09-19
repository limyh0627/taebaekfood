import React, { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, ClipboardCheck, Truck } from 'lucide-react';
import type { Item, RawMaterialEntry } from '../src/shared/types';
import type { LotShipment } from './ProductLotPanel';
import { sortLedger } from '../src/shared/rawLedgerBalance';

type TimelineRow = {
  id: string; date: string; title: string; note: string;
  delta?: number; balance?: number;
  kind: 'in' | 'out' | 'stocktake' | 'lot';
};

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString();

/** 로트 상세는 원장 표를 복제하지 않고, 해당 품목에서 실제로 일어난 사건만 시간순으로 보여준다. */
const LotTimeline: React.FC<{
  item: Item;
  lotId: string;
  rawEntries?: RawMaterialEntry[];
  shipmentRows?: Array<LotShipment & { lotId: string }>;
}> = ({ item, lotId, rawEntries = [], shipmentRows = [] }) => {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo<TimelineRow[]>(() => {
    if (rawEntries.length) {
      return sortLedger(rawEntries).flatMap<TimelineRow>(entry => {
        const change = (entry as any).lotChanges?.find((row: any) => row.lotId === lotId);
        if (!change) return [];
        const delta = Math.round(Number(change.deltaKg ?? 0) * 1000) / 1000;
        const stocktake = entry.targetKg != null || (entry as any).kind === 'stocktake';
        return {
          id: entry.id || `${entry.date}-${entry.createdAt}`,
          date: entry.recordedAt || entry.createdAt || entry.date,
          title: stocktake ? '재고 실사' : delta >= 0 ? '입고' : '사용',
          note: entry.note || entry.addedBy || '', delta, balance: Number(change.afterKg ?? 0),
          kind: stocktake ? 'stocktake' : delta >= 0 ? 'in' : 'out',
        };
      }).reverse();
    }
    const packed: TimelineRow[] = [];
    for (const lot of (item.lots ?? []).filter(row => row.id === lotId)) {
      if (lot.id.startsWith('anchor-') || lot.id.startsWith('adjust-')) continue;
      packed.push({
        id: `lot-${lot.id}`, date: lot.createdAt || lot.receivedDate || '',
        title: lot.supplierName === '실사조정' ? '재고 실사' : '로트 입고',
        note: [lot.supplierName, lot.lotNo].filter(Boolean).join(' · '),
        delta: lot.qtyIn ?? undefined,
        kind: lot.supplierName === '실사조정' ? 'stocktake' : 'lot',
      });
    }
    for (const shipment of shipmentRows.filter(row => row.lotId === lotId)) packed.push({
      id: `ship-${shipment.lotId}-${shipment.orderId}`, date: shipment.date,
      title: '출고', note: shipment.partnerName, delta: -shipment.qty, kind: 'out',
    });
    return packed.sort((a, b) => b.date.localeCompare(a.date));
  }, [item, lotId, rawEntries, shipmentRows]);

  if (!rows.length) return <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-[11px] font-bold text-slate-400">아직 남은 이력이 없습니다.</div>;
  const style = {
    in: { icon: ArrowUpRight, dot: 'bg-emerald-500', text: 'text-emerald-600' },
    out: { icon: ArrowDownRight, dot: 'bg-rose-500', text: 'text-rose-600' },
    stocktake: { icon: ClipboardCheck, dot: 'bg-violet-500', text: 'text-violet-600' },
    lot: { icon: Truck, dot: 'bg-sky-500', text: 'text-sky-600' },
  } as const;

  const visible = showAll ? rows : rows.slice(0, 5);
  return <>
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
              {row.delta != null && <span className={`text-[11px] font-black tabular-nums ${row.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{row.delta > 0 ? '+' : ''}{fmt(row.delta)}{rawEntries.length ? ' kg' : ` ${item.unit || '개'}`}</span>}
            </div>
            <p className="mt-0.5 text-[10px] font-bold text-slate-400">{row.date ? row.date.slice(0, 16).replace('T', ' ') : '-'}{row.note ? ` · ${row.note}` : ''}</p>
            {row.balance != null && <p className="mt-1 text-[10px] font-black text-slate-500">처리 후 {fmt(row.balance)} kg</p>}
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
