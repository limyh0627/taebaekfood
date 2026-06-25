import React, { useMemo, useState } from 'react';
import { RawMaterialEntry } from '../types';
import { unitOf } from '../src/constants/formula';

type FilterType = '전체' | '입고' | '사용' | '정정';
const FILTERS: FilterType[] = ['전체', '입고', '사용', '정정'];

interface Props {
  entries: RawMaterialEntry[];
  isAdmin?: boolean;
  currentUserName?: string;
  onDelete?: (id: string) => void;
  showMaterial?: boolean;   // 전체 목록에서 원료명 표시
  pageSize?: number;
  emptyText?: string;
}

/** 원료 입출고(수불) 기록 목록 — 유형 필터 + 페이지네이션. 원료별 패널·전체 목록에서 공용. */
const RawLedgerList: React.FC<Props> = ({
  entries, isAdmin = false, currentUserName, onDelete, showMaterial = false, pageSize = 8, emptyText = '기록 없음',
}) => {
  const [filter, setFilter] = useState<FilterType>('전체');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const list = entries.filter(e => {
      if (filter === '입고') return (e.received ?? 0) > 0;
      if (filter === '사용') return (e.used ?? 0) > 0 && e.type !== 'correction';
      if (filter === '정정') return e.type === 'correction';
      return true;
    });
    return [...list].sort((a, b) => (b.createdAt ?? b.date ?? '').localeCompare(a.createdAt ?? a.date ?? ''));
  }, [entries, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const pick = (f: FilterType) => { setFilter(f); setPage(1); };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 flex-wrap">
        {FILTERS.map(f => (
          <button key={f} onClick={(e) => { e.stopPropagation(); pick(f); }}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-black border transition-colors ${filter === f ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>{f}</button>
        ))}
        <span className="ml-auto text-[10px] font-black text-slate-300">{filtered.length}건</span>
      </div>

      {paged.length === 0 ? (
        <div className="px-4 py-6 text-center text-[11px] font-bold text-slate-300">{emptyText}</div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 overflow-hidden bg-white">
          {paged.map(r => {
            const u = r.unit ?? unitOf(r.material);
            const isInbound = (r.received ?? 0) > 0;
            const isCorrectionNeg = (r.used ?? 0) < 0;
            const amt = isInbound ? (r.received ?? 0) : Math.abs(r.used ?? 0);
            const sign = isInbound || isCorrectionNeg ? '+' : '−';
            const tone = isInbound ? 'text-emerald-600' : isCorrectionNeg ? 'text-violet-600' : 'text-rose-500';
            const isMine = !!currentUserName && r.addedBy === currentUserName;
            const badge = r.type === 'auto'
              ? { label: '자동', cls: 'bg-blue-50 text-blue-600' }
              : r.type === 'correction'
                ? { label: '정정', cls: 'bg-amber-50 text-amber-700' }
                : { label: '수동', cls: 'bg-slate-50 text-slate-500' };
            const canDelete = !!isAdmin && r.type !== 'auto' && !!r.id && !!onDelete;
            return (
              <li key={r.id ?? `${r.date}-${r.createdAt}`} className="px-3 py-2 flex items-center gap-2 hover:bg-slate-50/60 transition-colors">
                <span className="w-12 shrink-0 text-[10px] font-bold text-slate-500">{(r.date ?? '').slice(5)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    {showMaterial && <span className="text-[11px] font-black text-slate-800">{r.material}</span>}
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    {isMine && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600">본인</span>}
                  </div>
                  {(r.addedBy || r.note) && (
                    <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                      {r.addedBy && <span className="mr-1.5">{r.addedBy}</span>}
                      {r.note && <span>{r.note}</span>}
                    </p>
                  )}
                </div>
                <span className={`text-[11px] font-black ${tone} shrink-0`}>{sign}{amt}{u}</span>
                {canDelete && (
                  <button onClick={(e) => { e.stopPropagation(); if (confirm('이 기록을 삭제할까요?')) onDelete!(r.id!); }}
                    className="ml-0.5 px-2 py-1 rounded-lg text-[10px] font-black bg-slate-100 text-slate-400 hover:bg-rose-100 hover:text-rose-500 transition-colors shrink-0">삭제</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 pt-1">
          <button onClick={(e) => { e.stopPropagation(); setPage(p => Math.max(1, p - 1)); }} disabled={safePage === 1}
            className="px-2.5 h-7 rounded-lg text-[10px] font-black text-slate-500 bg-white border border-slate-200 disabled:opacity-40 hover:bg-slate-50">이전</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={(e) => { e.stopPropagation(); setPage(p); }}
              className={`w-7 h-7 rounded-lg text-[10px] font-black transition-colors ${safePage === p ? 'bg-slate-700 text-white' : 'text-slate-400 bg-white border border-slate-200 hover:bg-slate-50'}`}>{p}</button>
          ))}
          <button onClick={(e) => { e.stopPropagation(); setPage(p => Math.min(totalPages, p + 1)); }} disabled={safePage === totalPages}
            className="px-2.5 h-7 rounded-lg text-[10px] font-black text-slate-500 bg-white border border-slate-200 disabled:opacity-40 hover:bg-slate-50">다음</button>
        </div>
      )}
    </div>
  );
};

export default RawLedgerList;
