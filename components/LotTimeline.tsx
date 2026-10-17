import React, { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, ClipboardCheck, PackageOpen, Truck } from 'lucide-react';
import { companyOf, type Item, type RawMaterialEntry } from '../src/shared/types';
import type { ItemInventoryEntry } from '../src/features/admin/itemLedger';
import { isRawHolder } from '../src/shared/rawHolder';
import { buildLotTimelineRows, canLotForMove, type TimelineRow, type LotShipment } from '../src/features/items/domain/lotTimelineRows';

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString();

const recordedTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || value.length <= 10) return value.slice(0, 16).replace('T', ' ');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
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
  const rows = useMemo<TimelineRow[]>(() => buildLotTimelineRows(item, lotId, rawEntries, shipmentRows, fmt), [item, lotId, rawEntries, shipmentRows]);

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
              {row.delta != null && <span className={`text-[11px] font-black tabular-nums ${row.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{row.delta > 0 ? '+' : ''}{fmt(row.delta)}{isRawHolder(item) ? ' kg' : ' 개'}</span>}
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
