import React, { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, ClipboardCheck, Package, Truck } from 'lucide-react';
import type { Item, RawMaterialEntry } from '../src/shared/types';
import type { LotShipment } from './ProductLotPanel';
import { applyLedgerRow, sortLedger } from '../src/shared/rawLedgerBalance';

type TimelineRow = {
  id: string; date: string; title: string; note: string;
  delta?: number; balance?: number;
  kind: 'in' | 'out' | 'stocktake' | 'lot';
};

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString();

/** 로트 상세는 원장 표를 복제하지 않고, 해당 품목에서 실제로 일어난 사건만 시간순으로 보여준다. */
const LotTimeline: React.FC<{
  item: Item;
  rawEntries?: RawMaterialEntry[];
  shipmentRows?: Array<LotShipment & { lotId: string }>;
}> = ({ item, rawEntries = [], shipmentRows = [] }) => {
  const rows = useMemo<TimelineRow[]>(() => {
    if (rawEntries.length) {
      let balance = 0;
      return sortLedger(rawEntries).map<TimelineRow>(entry => {
        const before = balance;
        balance = applyLedgerRow(balance, entry);
        const delta = Math.round((balance - before) * 1000) / 1000;
        const stocktake = entry.targetKg != null;
        return {
          id: entry.id || `${entry.date}-${entry.createdAt}`,
          date: entry.recordedAt || entry.createdAt || entry.date,
          title: stocktake ? '재고 실사' : delta >= 0 ? '입고' : '사용',
          note: entry.note || entry.addedBy || '', delta, balance,
          kind: stocktake ? 'stocktake' : delta >= 0 ? 'in' : 'out',
        };
      }).reverse();
    }
    const packed: TimelineRow[] = [];
    for (const lot of item.lots ?? []) {
      if (lot.id.startsWith('anchor-') || lot.id.startsWith('adjust-')) continue;
      packed.push({
        id: `lot-${lot.id}`, date: lot.createdAt || lot.receivedDate || '',
        title: lot.supplierName === '실사조정' ? '재고 실사' : '로트 입고',
        note: [lot.supplierName, lot.lotNo].filter(Boolean).join(' · '),
        delta: lot.qtyIn ?? undefined,
        kind: lot.supplierName === '실사조정' ? 'stocktake' : 'lot',
      });
    }
    for (const anchor of item.stocktakeAnchors ?? []) packed.push({
      id: anchor.id, date: anchor.createdAt || anchor.date,
      title: anchor.note ? '재고 조정' : '재고 실사', note: anchor.note || '',
      delta: anchor.deltaQty, balance: anchor.targetQty, kind: 'stocktake',
    });
    for (const shipment of shipmentRows) packed.push({
      id: `ship-${shipment.lotId}-${shipment.orderId}`, date: shipment.date,
      title: '출고', note: shipment.partnerName, delta: -shipment.qty, kind: 'out',
    });
    return packed.sort((a, b) => b.date.localeCompare(a.date));
  }, [item, rawEntries, shipmentRows]);

  if (!rows.length) return <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-[11px] font-bold text-slate-400">아직 남은 이력이 없습니다.</div>;
  const style = {
    in: { icon: ArrowUpRight, dot: 'bg-emerald-500', text: 'text-emerald-600' },
    out: { icon: ArrowDownRight, dot: 'bg-rose-500', text: 'text-rose-600' },
    stocktake: { icon: ClipboardCheck, dot: 'bg-violet-500', text: 'text-violet-600' },
    lot: { icon: Truck, dot: 'bg-sky-500', text: 'text-sky-600' },
  } as const;

  return <ol className="relative ml-2 border-l border-slate-200 pl-5 space-y-5">
    {rows.slice(0, 50).map(row => {
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
    {rows.length > 50 && <li className="text-[10px] font-bold text-slate-400"><Package size={11} className="inline mr-1" />최근 50건만 표시합니다.</li>}
  </ol>;
};

export default LotTimeline;
