import React, { useMemo, useState } from 'react';
import { RawMaterialEntry } from '../types';
import { unitOf, kgToUnit, DENSITY } from '../src/constants/formula';
import { ChevronRight } from 'lucide-react';

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
  /** 잔량 누적의 기준이 되는 전체 기록 — 기간·유형 필터를 걸기 전 원본.
   *  (필터된 entries만으로 누적하면 "최근 1개월"만 봤을 때 잔량이 0부터 다시 쌓여 엉뚱해진다) */
  allEntries?: RawMaterialEntry[];
}

/** 원료 입출고(수불) 기록 목록 — 유형 필터 + 페이지네이션. 원료별 패널·전체 목록에서 공용. */
const RawLedgerList: React.FC<Props> = ({
  entries, isAdmin = false, currentUserName, onDelete, showMaterial = false, pageSize = 8, emptyText = '기록 없음',
  allEntries,
}) => {
  const [filter, setFilter] = useState<FilterType>('전체');
  const [page, setPage] = useState(1);
  // 펼친 날짜(원료|날짜) — 그날 합계가 어떤 건들로 이뤄졌는지 보여준다
  const [openDay, setOpenDay] = useState<string | null>(null);

  // ── 묶음 만들기 + 잔량 누적 ────────────────────────────────────────────────
  // 원료·날짜로 묶되, **같은 날이라도 정정을 만나면 줄을 끊는다**(원료수불부와 같은 규칙).
  //   정정 전 입고·사용과 정정 후 입고·사용이 한 줄에 섞이면 무엇이 정정 대상인지 알 수 없다.
  //   → [정정 전 묶음] [정정 줄] [정정 후 묶음] 으로 남는다.
  // 잔량은 필터 이전의 전체 기록으로 처음부터 누적한다(기간·유형 필터가 잔량을 흔들면 안 된다).
  // 이 목록은 재고 원장 그대로다 — 수불부(서류)의 수율 파생입고·등급 분리는 여기 없다.
  type DayRow = {
    key: string; date: string; material: string;
    received: number; used: number; adj: number; prev: number; cur: number;
    notes: string[]; who: Set<string>; types: Set<string>; delIds: string[];
    mine: boolean; anchor?: number; rows: RawMaterialEntry[];
  };
  const allRows = useMemo(() => {
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const byMat = new Map<string, RawMaterialEntry[]>();
    for (const e of (allEntries ?? entries)) {
      const m = e.material ?? '';
      const arr = byMat.get(m); if (arr) arr.push(e); else byMat.set(m, [e]);
    }
    const out: DayRow[] = [];
    for (const [m, list] of byMat) {
      const density = DENSITY[m] ?? 1;
      // 날짜 → 같은 날은 기록된 시각 순 (그 묶음 첫 줄 직전 잔량 = 전일재고)
      list.sort((a, b) => (a.date ?? '') === (b.date ?? '')
        ? (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
        : (a.date ?? '').localeCompare(b.date ?? ''));
      let bal = 0, seg = 0, curDate = '';
      let g: DayRow | null = null;
      const flush = () => { if (g) { out.push(g); g = null; } };
      for (const e of list) {
        // 옛 기록(unit='L')은 L로 저장돼 있어 kg로 환산해야 나머지와 더해진다
        const toKg = (v: number) => (e.unit === 'L' && density !== 1 ? v * density : v);
        const isCorr = e.type === 'correction' || e.targetKg != null;
        const date = e.date ?? '';
        if (date !== curDate) { flush(); curDate = date; seg = 0; }
        const key = `${m}|${date}#${isCorr ? 'adj' : ''}${seg}`;
        if (!g || g.key !== key) {
          flush();
          g = { key, date, material: m, received: 0, used: 0, adj: 0, prev: bal, cur: bal,
                notes: [], who: new Set(), types: new Set(), delIds: [], mine: false, rows: [] };
        }
        const prev = bal;
        // 재고실사(targetKg)는 잔량을 실제로 센 값으로 리셋한다 —
        // 실사 이후 잔량은 장부 오차와 무관하게 실물 기준이 된다.
        bal = e.targetKg != null
          ? Number(e.targetKg)
          : r3(bal + toKg(e.received ?? 0) - toKg(e.used ?? 0));
        // 정정·실사는 입고·사용이 아니다 — 섞으면 사용량이 부풀려진다
        if (isCorr) g.adj = r3(g.adj + (bal - prev));
        else { g.received = r3(g.received + toKg(e.received ?? 0)); g.used = r3(g.used + toKg(e.used ?? 0)); }
        if (e.targetKg != null) g.anchor = Number(e.targetKg);
        if (e.note) g.notes.push(e.note);
        if (e.addedBy) g.who.add(e.addedBy);
        g.types.add(e.type ?? 'manual');
        if (currentUserName && e.addedBy === currentUserName) g.mine = true;
        if (isAdmin && e.type !== 'auto' && e.id && onDelete) g.delIds.push(e.id);
        g.cur = bal;
        g.rows.push(e);
        if (isCorr) { flush(); seg++; }   // 정정 뒤부터는 새 묶음
      }
      flush();
    }
    return out;
  }, [allEntries, entries, currentUserName, isAdmin, onDelete]);

  // 화면에 띄울 것만 — 기간(entries)·유형(filter) 조건에 걸리는 기록이 하나라도 있는 묶음
  const shownIds = useMemo(() => new Set(entries.map(e => e.id).filter(Boolean)), [entries]);
  const passes = (e: RawMaterialEntry) => {
    if (!shownIds.has(e.id)) return false;
    if (filter === '입고') return (e.received ?? 0) > 0;
    if (filter === '사용') return (e.used ?? 0) > 0 && e.type !== 'correction';
    if (filter === '정정') return e.type === 'correction';
    return true;
  };
  const filtered = useMemo(() => entries.filter(passes), [entries, filter, shownIds]);
  const dayRows = useMemo(
    () => allRows.filter(r => r.rows.some(passes))
      .sort((a, b) => b.date.localeCompare(a.date) || (a.material ?? '').localeCompare(b.material ?? '')),
    [allRows, filter, shownIds],
  );

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
        <div className="rounded-xl border border-slate-100 overflow-hidden bg-white">
        {/* 컬럼 머리 — 아래 줄들과 폭을 똑같이 맞춰야 숫자가 세로로 정렬된다 */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-wider">
          <span className="w-11 shrink-0">날짜</span>
          <span className="flex-1 min-w-0">내역</span>
          <span className="hidden lg:block w-20 text-right shrink-0">전일재고</span>
          <span className="w-16 text-right shrink-0">입고</span>
          <span className="w-16 text-right shrink-0">사용</span>
          <span className="w-16 text-right shrink-0">정정</span>
          <span className="w-24 text-right shrink-0">잔량</span>
          {isAdmin && onDelete && <span className="w-9 shrink-0" />}
        </div>
        <ul className="divide-y divide-slate-100">
          {paged.map(g => {
            const u = unitOf(g.material);                    // 표시 단위 (기름=L, 그 외=kg)
            const recv = Math.round(kgToUnit(g.received, g.material));  // 저장 kg → 표시단위
            const use  = Math.round(kgToUnit(g.used, g.material));
            const adj  = Math.round(kgToUnit(g.adj, g.material));
            // 전재고 ± 그 묶음 입출고 = 잔량 (기록 처음부터 누적한 값)
            const prevBal = Math.round(kgToUnit(g.prev, g.material));
            const curBal  = Math.round(kgToUnit(g.cur, g.material));
            const badge = g.types.has('correction')
              ? { label: '정정', cls: 'bg-amber-50 text-amber-700' }
              : (g.types.size === 1 && g.types.has('auto'))
                ? { label: '자동', cls: 'bg-blue-50 text-blue-600' }
                : { label: '수동', cls: 'bg-slate-50 text-slate-500' };
            const whoStr = Array.from(g.who).join(', ');
            // 비고를 다 이어붙이면 줄이 길어진다 — 첫 건만 보이고 나머지는 '외 N건'. 자세한 건 펼쳐서 본다.
            const uniqNotes = Array.from(new Set(g.notes.filter(Boolean)));
            const noteStr = uniqNotes.length === 0 ? ''
              : uniqNotes.length === 1 ? uniqNotes[0]
              : `${uniqNotes[0]} 외 ${uniqNotes.length - 1}건`;
            const canDelete = g.delIds.length === 1;         // 그날 지울 항목이 딱 하나일 때만
            const dayKey = g.key;
            const open = openDay === dayKey;
            return (
              <li key={dayKey}>
              <div
                onClick={() => setOpenDay(open ? null : dayKey)}
                className={`px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors tabular-nums ${open ? 'bg-slate-50' : 'hover:bg-slate-50/60'}`}
              >
                <span className="w-11 shrink-0 text-[10px] font-bold text-slate-500 flex items-center gap-0.5">
                  <ChevronRight size={10} className={`shrink-0 text-slate-300 transition-transform ${open ? 'rotate-90' : ''}`} />
                  {g.date.slice(5)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    {showMaterial && <span className="text-[11px] font-black text-slate-800">{g.material}</span>}
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    {g.mine && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600">본인</span>}
                    {/* 실사한 날은 잔량이 계산값이 아니라 실제로 센 값으로 바뀐다 — 숫자가 튀는 이유를 줄에 표시 */}
                    {g.anchor != null && (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                        실사 {Math.round(kgToUnit(g.anchor, g.material)).toLocaleString()}{u}
                      </span>
                    )}
                  </div>
                  {(whoStr || noteStr) && (
                    <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                      {whoStr && <span className="mr-1.5">{whoStr}</span>}
                      {noteStr && <span>{noteStr}</span>}
                    </p>
                  )}
                </div>
                <span className="hidden lg:block w-20 text-right shrink-0 text-[10px] font-bold text-slate-400">
                  {prevBal.toLocaleString()}{u}
                </span>
                <span className="w-16 text-right shrink-0 text-[11px] font-black text-emerald-600">
                  {recv > 0 ? `+${recv.toLocaleString()}` : ''}
                </span>
                <span className={`w-16 text-right shrink-0 text-[11px] font-black ${use > 0 ? 'text-rose-500' : 'text-violet-600'}`}>
                  {use !== 0 ? `${use > 0 ? '−' : '+'}${Math.abs(use).toLocaleString()}` : ''}
                </span>
                <span className="w-16 text-right shrink-0 text-[11px] font-black text-amber-600">
                  {adj !== 0 ? `${adj > 0 ? '+' : '−'}${Math.abs(adj).toLocaleString()}` : (g.anchor != null ? '실사' : '')}
                </span>
                <span className={`w-24 text-right shrink-0 text-[11px] font-black ${curBal < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                  {curBal.toLocaleString()}{u}
                </span>
                {isAdmin && onDelete && (
                  <span className="w-9 shrink-0">
                    {canDelete && (
                      <button onClick={(e) => { e.stopPropagation(); if (confirm('이 날짜 기록을 삭제할까요?')) onDelete!(g.delIds[0]); }}
                        className="px-2 py-1 rounded-lg text-[10px] font-black bg-slate-100 text-slate-400 hover:bg-rose-100 hover:text-rose-500 transition-colors">삭제</button>
                    )}
                  </span>
                )}
              </div>
              {/* 상세 — 그날 합계가 어떤 건들로 이뤄졌는지. 자동 차감은 어느 주문에서 왔는지까지 보인다. */}
              {open && (
                <div className="bg-slate-50/70 border-t border-slate-100 px-3 py-2 space-y-1">
                  {g.rows.slice().sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))).map((e, i) => {
                    const d = DENSITY[e.material ?? ''] ?? 1;
                    const toU = (v: number) => Math.round(kgToUnit(e.unit === 'L' && d !== 1 ? v * d : v, e.material) * 10) / 10;
                    const r = toU(e.received ?? 0), s = toU(e.used ?? 0);
                    const t = e.createdAt ? new Date(e.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
                    const kind = e.type === 'auto' ? { t: '자동', c: 'bg-blue-50 text-blue-600' }
                      : e.type === 'correction' ? { t: '정정', c: 'bg-amber-50 text-amber-700' }
                      : { t: '수동', c: 'bg-white text-slate-500 border border-slate-200' };
                    return (
                      <div key={e.id ?? i} className="flex items-start gap-2 text-[10px] tabular-nums">
                        <span className={`shrink-0 px-1.5 py-0.5 rounded-full font-black ${kind.c}`}>{kind.t}</span>
                        <span className="shrink-0 w-24 text-slate-400 font-bold">{t}</span>
                        <span className="flex-1 min-w-0 text-slate-500 break-words">
                          {e.note || '(비고 없음)'}
                          {e.addedBy && <span className="ml-1.5 text-slate-400">· {e.addedBy}</span>}
                          {e.targetKg != null && <span className="ml-1.5 font-black text-teal-700">실사 {Math.round(kgToUnit(Number(e.targetKg), e.material))}{u}</span>}
                        </span>
                        <span className="shrink-0 w-16 text-right font-black text-emerald-600">{r > 0 ? `+${r.toLocaleString()}` : ''}</span>
                        <span className={`shrink-0 w-16 text-right font-black ${s > 0 ? 'text-rose-500' : 'text-violet-600'}`}>
                          {s !== 0 ? `${s > 0 ? '−' : '+'}${Math.abs(s).toLocaleString()}` : ''}
                        </span>
                        {isAdmin && onDelete && (
                          <span className="shrink-0 w-9 text-right">
                            {e.type !== 'auto' && e.id && (
                              <button onClick={(ev) => { ev.stopPropagation(); if (confirm('이 기록을 삭제할까요?')) onDelete(e.id!); }}
                                className="px-1.5 py-0.5 rounded text-[9px] font-black text-slate-400 hover:bg-rose-100 hover:text-rose-500">삭제</button>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-[9px] text-slate-400 pt-1 border-t border-slate-200/70">
                    {g.rows.length}건 · 자동 차감은 주문 생산처리 시점에 찍힌다(서류의 문서일과 다를 수 있음)
                  </p>
                </div>
              )}
              </li>
            );
          })}
        </ul>
        </div>
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
