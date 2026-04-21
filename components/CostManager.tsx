
import React, { useState, useMemo, useEffect } from 'react';
import {
  PlusCircle,
  Trash2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  BarChart2,
  X,
} from 'lucide-react';
import { FixedCostEntry, FixedCostCategory, IssuedStatement } from '../types';

interface CostManagerProps {
  fixedCosts: FixedCostEntry[];
  issuedStatements: IssuedStatement[];
  onAdd: (entry: Omit<FixedCostEntry, 'id' | 'createdAt'>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const CATEGORIES: FixedCostCategory[] = [
  '임차료', '보험료', '감가상각비', '대출이자', '공과금', '인건비', '기타',
];

const CATEGORY_COLORS: Record<FixedCostCategory, string> = {
  임차료:    'bg-violet-100 text-violet-700',
  보험료:    'bg-blue-100 text-blue-700',
  감가상각비: 'bg-sky-100 text-sky-700',
  대출이자:  'bg-orange-100 text-orange-700',
  공과금:   'bg-yellow-100 text-yellow-700',
  인건비:   'bg-rose-100 text-rose-700',
  기타:     'bg-slate-100 text-slate-600',
};

const fmt = (n: number) =>
  n.toLocaleString('ko-KR') + '원';

const pct = (a: number, b: number) =>
  b === 0 ? '—' : ((a / b) * 100).toFixed(1) + '%';

const CostManager: React.FC<CostManagerProps> = ({
  fixedCosts,
  issuedStatements,
  onAdd,
  onDelete,
}) => {
  // ── 현재 월 ──────────────────────────────────────────────────────────────
  const today = new Date();
  const [yearMonth, setYearMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  );

  const moveMonth = (delta: number) => {
    const [y, m] = yearMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYearMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    );
  };

  // ── 입력 폼 상태 ──────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{
    category: FixedCostCategory;
    label: string;
    amount: string;
    note: string;
  }>({ category: '임차료', label: '', amount: '', note: '' });
  const [saving, setSaving] = useState(false);

  // 월이 바뀌면 폼 닫기
  useEffect(() => { setShowForm(false); }, [yearMonth]);

  const handleAdd = async () => {
    const amount = Number(form.amount.replace(/,/g, ''));
    if (!form.label.trim() || !amount) return;
    setSaving(true);
    await onAdd({
      yearMonth,
      category: form.category,
      label: form.label.trim(),
      amount,
      note: form.note.trim() || undefined,
    });
    setForm({ category: '임차료', label: '', amount: '', note: '' });
    setShowForm(false);
    setSaving(false);
  };

  // ── 해당 월 데이터 필터 ───────────────────────────────────────────────────
  const monthCosts = useMemo(
    () => fixedCosts.filter((c) => c.yearMonth === yearMonth),
    [fixedCosts, yearMonth]
  );

  // ── 손익 계산 (issuedStatements 기반) ────────────────────────────────────
  const { revenue, purchase } = useMemo(() => {
    const stmts = issuedStatements.filter(
      (s) => s.tradeDate.startsWith(yearMonth)
    );
    const rev = stmts
      .filter((s) => s.type === '매출')
      .reduce((acc, s) => acc + s.totalAmount, 0);
    const pur = stmts
      .filter((s) => s.type === '매입')
      .reduce((acc, s) => acc + s.totalAmount, 0);
    return { revenue: rev, purchase: pur };
  }, [issuedStatements, yearMonth]);

  const totalFixed = useMemo(
    () => monthCosts.reduce((acc, c) => acc + c.amount, 0),
    [monthCosts]
  );

  const grossProfit = revenue - purchase;
  const operatingProfit = grossProfit - totalFixed;

  // ── 카테고리별 합계 ───────────────────────────────────────────────────────
  const byCategory = useMemo(() => {
    const map: Partial<Record<FixedCostCategory, number>> = {};
    for (const c of monthCosts) {
      map[c.category] = (map[c.category] ?? 0) + c.amount;
    }
    return map;
  }, [monthCosts]);

  // ── 연도 전체 월별 영업이익 트렌드 ──────────────────────────────────────
  const year = yearMonth.slice(0, 4);
  const trendData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
      const stmts = issuedStatements.filter((s) => s.tradeDate.startsWith(ym));
      const rev = stmts.filter((s) => s.type === '매출').reduce((a, s) => a + s.totalAmount, 0);
      const pur = stmts.filter((s) => s.type === '매입').reduce((a, s) => a + s.totalAmount, 0);
      const fixed = fixedCosts.filter((c) => c.yearMonth === ym).reduce((a, c) => a + c.amount, 0);
      return { ym, month: i + 1, profit: rev - pur - fixed };
    });
  }, [issuedStatements, fixedCosts, year]);

  const maxAbs = Math.max(...trendData.map((d) => Math.abs(d.profit)), 1);

  const [ymLabel] = (() => {
    const [y, m] = yearMonth.split('-');
    return [`${y}년 ${Number(m)}월`];
  })();

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">

      {/* ── 헤더 ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800">비용 관리</h1>
          <p className="text-xs text-slate-400 mt-0.5">고정비 입력 · 손익 계산서 · 월별 트렌드</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => moveMonth(-1)}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-black text-slate-700 min-w-[80px] text-center">{ymLabel}</span>
          <button
            onClick={() => moveMonth(1)}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* ── 손익 요약 카드 ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: '매출액',
            value: revenue,
            icon: <TrendingUp size={16} />,
            color: 'text-emerald-600',
            bg: 'bg-emerald-50',
          },
          {
            label: '매입비용',
            value: purchase,
            icon: <TrendingDown size={16} />,
            color: 'text-rose-500',
            bg: 'bg-rose-50',
          },
          {
            label: '고정비 합계',
            value: totalFixed,
            icon: <BarChart2 size={16} />,
            color: 'text-orange-500',
            bg: 'bg-orange-50',
          },
          {
            label: '영업이익',
            value: operatingProfit,
            icon: <DollarSign size={16} />,
            color: operatingProfit >= 0 ? 'text-indigo-600' : 'text-rose-600',
            bg: operatingProfit >= 0 ? 'bg-indigo-50' : 'bg-rose-50',
          },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
            <div className={`inline-flex items-center gap-1.5 text-xs font-bold ${card.color} ${card.bg} px-2 py-1 rounded-lg mb-2`}>
              {card.icon}
              {card.label}
            </div>
            <p className={`text-lg font-black ${card.color}`}>
              {fmt(card.value)}
            </p>
          </div>
        ))}
      </div>

      {/* ── 손익 계산서 요약 ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <h2 className="text-sm font-black text-slate-700 mb-4">손익 계산서 — {ymLabel}</h2>
        <div className="space-y-2 text-sm">
          {[
            { label: '매출액', value: revenue, bold: false, indent: false },
            { label: '  매입비용 (−)', value: -purchase, bold: false, indent: true },
            { label: '매출총이익', value: grossProfit, bold: true, indent: false, divider: true },
            { label: '  고정비 합계 (−)', value: -totalFixed, bold: false, indent: true },
            { label: '영업이익', value: operatingProfit, bold: true, indent: false, divider: true, highlight: true },
          ].map((row, i) => (
            <div key={i}>
              {row.divider && <div className="border-t border-slate-100 my-2" />}
              <div className="flex justify-between items-center">
                <span className={`${row.indent ? 'pl-4 text-slate-400' : ''} ${row.bold ? 'font-black text-slate-800' : 'text-slate-600'}`}>
                  {row.label}
                </span>
                <span className={`font-bold tabular-nums ${row.highlight ? (row.value >= 0 ? 'text-indigo-600' : 'text-rose-600') : row.value < 0 ? 'text-rose-500' : 'text-slate-800'}`}>
                  {row.value < 0 ? '−' + fmt(-row.value) : fmt(row.value)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* 마진율 */}
        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-4 text-xs text-slate-500">
          <span>매출총이익률 <span className="font-black text-slate-700">{pct(grossProfit, revenue)}</span></span>
          <span>영업이익률 <span className="font-black text-slate-700">{pct(operatingProfit, revenue)}</span></span>
          <span>고정비 비중 <span className="font-black text-slate-700">{pct(totalFixed, revenue)}</span></span>
        </div>
      </div>

      {/* ── 고정비 입력 / 목록 ───────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-black text-slate-700">고정비 항목 — {ymLabel}</h2>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition"
          >
            {showForm ? <X size={14} /> : <PlusCircle size={14} />}
            {showForm ? '닫기' : '항목 추가'}
          </button>
        </div>

        {/* 입력 폼 */}
        {showForm && (
          <div className="mb-5 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">분류</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as FixedCostCategory })}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400 transition"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">세부 항목명</label>
                <input
                  type="text"
                  placeholder="예: 공장 임대료"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400 transition"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">금액 (원)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="예: 1500000"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9]/g, '') })}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400 transition"
                />
                {form.amount && (
                  <p className="text-[11px] text-indigo-500 font-bold mt-1 ml-1">
                    {Number(form.amount).toLocaleString('ko-KR')}원
                  </p>
                )}
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">비고 (선택)</label>
                <input
                  type="text"
                  placeholder="메모"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400 transition"
                />
              </div>
            </div>
            <button
              onClick={handleAdd}
              disabled={saving || !form.label.trim() || !form.amount}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-black hover:bg-indigo-700 disabled:opacity-40 transition"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        )}

        {/* 카테고리별 소계 */}
        {Object.keys(byCategory).length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {CATEGORIES.filter((c) => byCategory[c]).map((c) => (
              <span key={c} className={`text-xs font-bold px-2.5 py-1 rounded-lg ${CATEGORY_COLORS[c]}`}>
                {c} {fmt(byCategory[c]!)}
              </span>
            ))}
          </div>
        )}

        {/* 항목 목록 */}
        {monthCosts.length === 0 ? (
          <div className="text-center py-10 text-slate-300">
            <BarChart2 size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-xs font-bold">이 달에 입력된 고정비가 없습니다</p>
          </div>
        ) : (
          <div className="space-y-2">
            {monthCosts.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between bg-slate-50 hover:bg-slate-100 rounded-xl px-4 py-3 transition group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-xs font-black px-2 py-0.5 rounded-lg shrink-0 ${CATEGORY_COLORS[entry.category]}`}>
                    {entry.category}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700 truncate">{entry.label}</p>
                    {entry.note && (
                      <p className="text-[11px] text-slate-400 truncate">{entry.note}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-2">
                  <span className="text-sm font-black text-slate-800 tabular-nums">
                    {fmt(entry.amount)}
                  </span>
                  <button
                    onClick={() => onDelete(entry.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            <div className="flex justify-end pt-2 border-t border-slate-100">
              <span className="text-sm font-black text-slate-700">
                합계 <span className="text-orange-600 ml-2">{fmt(totalFixed)}</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── 연간 월별 영업이익 트렌드 ─────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <h2 className="text-sm font-black text-slate-700 mb-4">{year}년 월별 영업이익 트렌드</h2>
        <div className="flex items-end gap-1 h-36">
          {trendData.map((d) => {
            const isSelected = d.ym === yearMonth;
            const barH = maxAbs === 0 ? 0 : (Math.abs(d.profit) / maxAbs) * 100;
            const positive = d.profit >= 0;
            return (
              <div
                key={d.ym}
                className="flex-1 flex flex-col items-center gap-1 cursor-pointer"
                onClick={() =>
                  setYearMonth(d.ym)
                }
              >
                <div className="w-full flex flex-col justify-end" style={{ height: '112px' }}>
                  <div
                    className={`w-full rounded-t-md transition-all ${
                      isSelected
                        ? positive ? 'bg-indigo-600' : 'bg-rose-500'
                        : positive ? 'bg-indigo-200' : 'bg-rose-200'
                    }`}
                    style={{ height: `${Math.max(barH, 2)}%` }}
                  />
                </div>
                <span className={`text-[9px] font-bold ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`}>
                  {d.month}월
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-3 text-[11px] text-slate-400 font-bold">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-200 inline-block" /> 흑자</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-200 inline-block" /> 적자</span>
        </div>
      </div>

    </div>
  );
};

export default CostManager;
