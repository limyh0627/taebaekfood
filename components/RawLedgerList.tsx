import React, { useMemo, useState } from 'react';
import { RawMaterialEntry } from '../types';
import { unitOf, kgToUnit } from '../src/constants/formula';

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

  const filtered = useMemo(() => entries.filter(e => {
    if (filter === '입고') return (e.received ?? 0) > 0;
    if (filter === '사용') return (e.used ?? 0) > 0 && e.type !== 'correction';
    if (filter === '정정') return e.type === 'correction';
    return true;
  }), [entries, filter]);

  // 같은 날짜 + 같은 원료를 하나로 통합 (원료수불부처럼). 입고합·사용합, 삭제는 그날 지울 항목이 딱 하나일 때만.
  //   날짜만으로 묶으면 안 된다 — 전체 목록(showMaterial)엔 여러 원료가 섞여 들어와서
  //   서로 다른 원료의 kg/L이 합산되고, 원료명·작성자도 남의 것이 붙는다.
  type DayRow = { date: string; received: number; used: number; material: string; notes: string[]; who: Set<string>; types: Set<string>; delIds: string[]; createdAt: string; mine: boolean };
  const dayRows = useMemo(() => {
    const map = new Map<string, DayRow>();
    for (const e of filtered) {
      const key = `${e.date ?? ''}|${e.material ?? ''}`;
      let g = map.get(key);
      if (!g) { g = { date: e.date ?? '', received: 0, used: 0, material: e.material, notes: [], who: new Set(), types: new Set(), delIds: [], createdAt: e.createdAt ?? e.date ?? '', mine: false }; map.set(key, g); }
      g.received += e.received ?? 0;
      g.used += e.used ?? 0;
      if (e.note) g.notes.push(e.note);
      if (e.addedBy) g.who.add(e.addedBy);
      g.types.add(e.type ?? 'manual');
      if (currentUserName && e.addedBy === currentUserName) g.mine = true;
      if (isAdmin && e.type !== 'auto' && e.id && onDelete) g.delIds.push(e.id);
      if ((e.createdAt ?? '') > g.createdAt) g.createdAt = e.createdAt ?? g.createdAt;
    }
    return [...map.values()].sort((a, b) => (b.date).localeCompare(a.date) || (a.material ?? '').localeCompare(b.material ?? ''));
  }, [filtered, currentUserName, isAdmin, onDelete]);

  const totalPages = Math.max(1, Math.ceil(dayRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = dayRows.slice((safePage - 1) * pageSize, safePage * pageSize);

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
          {paged.map(g => {
            const u = unitOf(g.material);                    // 표시 단위 (기름=L, 그 외=kg)
            const recv = Math.round(kgToUnit(g.received, g.material));  // 저장 kg → 표시단위
            const use  = Math.round(kgToUnit(g.used, g.material));
            const badge = g.types.has('correction')
              ? { label: '정정', cls: 'bg-amber-50 text-amber-700' }
              : (g.types.size === 1 && g.types.has('auto'))
                ? { label: '자동', cls: 'bg-blue-50 text-blue-600' }
                : { label: '수동', cls: 'bg-slate-50 text-slate-500' };
            const whoStr = Array.from(g.who).join(', ');
            const noteStr = Array.from(new Set(g.notes)).join(', ');
            const canDelete = g.delIds.length === 1;         // 그날 지울 항목이 딱 하나일 때만
            return (
              <li key={`${g.date}|${g.material}`} className="px-3 py-2 flex items-center gap-2 hover:bg-slate-50/60 transition-colors">
                <span className="w-12 shrink-0 text-[10px] font-bold text-slate-500">{g.date.slice(5)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    {showMaterial && <span className="text-[11px] font-black text-slate-800">{g.material}</span>}
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    {g.mine && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600">본인</span>}
                  </div>
                  {(whoStr || noteStr) && (
                    <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                      {whoStr && <span className="mr-1.5">{whoStr}</span>}
                      {noteStr && <span>{noteStr}</span>}
                    </p>
                  )}
                </div>
                <span className="flex items-center gap-1.5 shrink-0 text-[11px] font-black">
                  {recv > 0 && <span className="text-emerald-600">+{recv}{u}</span>}
                  {use !== 0 && <span className={use > 0 ? 'text-rose-500' : 'text-violet-600'}>{use > 0 ? '−' : '+'}{Math.abs(use)}{u}</span>}
                  {recv === 0 && use === 0 && <span className="text-slate-300">0{u}</span>}
                </span>
                {canDelete && (
                  <button onClick={(e) => { e.stopPropagation(); if (confirm('이 날짜 기록을 삭제할까요?')) onDelete!(g.delIds[0]); }}
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
