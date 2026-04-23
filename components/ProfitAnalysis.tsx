
import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react';
import { IssuedStatement, FixedCostEntry } from '../types';
import PageHeader from './PageHeader';

interface ProfitAnalysisProps {
  issuedStatements: IssuedStatement[];
  fixedCosts: FixedCostEntry[];
}

const fmt = (n: number) => n.toLocaleString('ko-KR');
const fmtM = (n: number) => {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (Math.abs(n) >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return String(n);
};

const MONTHS = 12;

const ProfitAnalysis: React.FC<ProfitAnalysisProps> = ({ issuedStatements, fixedCosts }) => {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // 연도 목록 (전표 기준)
  const years = useMemo(() => {
    const ys = new Set<number>();
    issuedStatements.forEach(s => ys.add(Number(s.tradeDate.slice(0, 4))));
    fixedCosts.forEach(c => ys.add(Number(c.yearMonth.slice(0, 4))));
    ys.add(now.getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [issuedStatements, fixedCosts]);

  // 월별 집계
  const monthlyData = useMemo(() => {
    return Array.from({ length: MONTHS }, (_, i) => {
      const mm = String(i + 1).padStart(2, '0');
      const ym = `${selectedYear}-${mm}`;

      const sales = issuedStatements
        .filter(s => s.type === '매출' && s.tradeDate.startsWith(ym))
        .reduce((a, s) => a + s.totalAmount, 0);

      const purchase = issuedStatements
        .filter(s => s.type === '매입' && s.tradeDate.startsWith(ym))
        .reduce((a, s) => a + s.totalAmount, 0);

      const fixed = fixedCosts
        .filter(c => c.yearMonth === ym)
        .reduce((a, c) => a + c.amount, 0);

      const grossProfit = sales - purchase;
      const operatingProfit = grossProfit - fixed;

      return { month: `${i + 1}월`, ym, sales, purchase, fixed, grossProfit, operatingProfit };
    });
  }, [issuedStatements, fixedCosts, selectedYear]);

  // 연간 합계
  const annual = useMemo(() => monthlyData.reduce(
    (a, m) => ({
      sales: a.sales + m.sales,
      purchase: a.purchase + m.purchase,
      fixed: a.fixed + m.fixed,
      grossProfit: a.grossProfit + m.grossProfit,
      operatingProfit: a.operatingProfit + m.operatingProfit,
    }),
    { sales: 0, purchase: 0, fixed: 0, grossProfit: 0, operatingProfit: 0 }
  ), [monthlyData]);

  // 이번 달 (또는 선택 연도의 마지막 데이터 있는 달)
  const currentMm = now.getFullYear() === selectedYear
    ? String(now.getMonth() + 1).padStart(2, '0')
    : '12';
  const currentMonth = monthlyData.find(m => m.ym === `${selectedYear}-${currentMm}`) ?? monthlyData[now.getMonth()];

  // 전월 비교
  const prevIdx = monthlyData.findIndex(m => m.ym === currentMonth.ym) - 1;
  const prevMonth = prevIdx >= 0 ? monthlyData[prevIdx] : null;

  const pct = (curr: number, prev: number | undefined) => {
    if (!prev || prev === 0) return null;
    return Math.round((curr - prev) / Math.abs(prev) * 100);
  };

  // 거래처별 매출 Top5
  const clientSales = useMemo(() => {
    const map = new Map<string, number>();
    issuedStatements
      .filter(s => s.type === '매출' && s.tradeDate.startsWith(String(selectedYear)))
      .forEach(s => map.set(s.clientName, (map.get(s.clientName) ?? 0) + s.totalAmount));
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, amount]) => ({ name, amount }));
  }, [issuedStatements, selectedYear]);

  const COLORS = ['#3b82f6', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6'];

  const TrendBadge = ({ curr, prev }: { curr: number; prev: number | undefined }) => {
    const p = pct(curr, prev);
    if (p === null) return <span className="text-[10px] text-slate-300">-</span>;
    if (p > 0) return <span className="flex items-center gap-0.5 text-[10px] font-black text-emerald-600"><TrendingUp size={10}/>{p}%</span>;
    if (p < 0) return <span className="flex items-center gap-0.5 text-[10px] font-black text-rose-500"><TrendingDown size={10}/>{Math.abs(p)}%</span>;
    return <span className="flex items-center gap-0.5 text-[10px] font-black text-slate-400"><Minus size={10}/>0%</span>;
  };

  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3 text-xs space-y-1">
        <div className="font-black text-slate-700 mb-2">{label}</div>
        {payload.map((p: any) => (
          <div key={p.name} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }}/>
            <span className="text-slate-500">{p.name}</span>
            <span className="font-black ml-auto">{fmt(p.value)}원</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <PageHeader
        title="손익 분석"
        subtitle="매출 · 매입 · 고정비 기반 영업이익을 월별로 분석합니다."
        right={
          <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-black outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer">
            {years.map(y => <option key={y} value={y}>{y}년</option>)}
          </select>
        }
      />

      {/* 연간 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: '연간 매출', value: annual.sales, color: 'bg-blue-50 border-blue-100', text: 'text-blue-700', sub: 'text-blue-400' },
          { label: '연간 매입', value: annual.purchase, color: 'bg-amber-50 border-amber-100', text: 'text-amber-700', sub: 'text-amber-400' },
          { label: '연간 고정비', value: annual.fixed, color: 'bg-slate-50 border-slate-200', text: 'text-slate-700', sub: 'text-slate-400' },
          { label: '매출총이익', value: annual.grossProfit, color: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-700', sub: 'text-emerald-400' },
          { label: '영업이익', value: annual.operatingProfit, color: annual.operatingProfit >= 0 ? 'bg-violet-50 border-violet-100' : 'bg-rose-50 border-rose-100', text: annual.operatingProfit >= 0 ? 'text-violet-700' : 'text-rose-700', sub: annual.operatingProfit >= 0 ? 'text-violet-400' : 'text-rose-400' },
        ].map(card => (
          <div key={card.label} className={`rounded-2xl border px-4 py-3.5 ${card.color}`}>
            <div className={`text-[10px] font-black uppercase tracking-widest mb-1 ${card.sub}`}>{card.label}</div>
            <div className={`text-xl font-black ${card.text}`}>{fmtM(card.value)}</div>
            <div className={`text-[10px] mt-0.5 ${card.sub}`}>{fmt(card.value)}원</div>
            {card.label === '영업이익' && annual.sales > 0 && (
              <div className={`text-[10px] font-black mt-1 ${card.sub}`}>
                이익률 {Math.round(annual.operatingProfit / annual.sales * 100)}%
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 차트 영역 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 월별 매출/매입/이익 바차트 */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5">
          <div className="text-xs font-black text-slate-600 mb-4">월별 매출 · 매입 · 영업이익</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyData} barGap={2} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
              <XAxis dataKey="month" tick={{ fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtM} width={45}/>
              <Tooltip content={customTooltip}/>
              <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700 }} iconSize={8}/>
              <Bar dataKey="sales" name="매출" fill="#3b82f6" radius={[3,3,0,0]}/>
              <Bar dataKey="purchase" name="매입" fill="#f59e0b" radius={[3,3,0,0]}/>
              <Bar dataKey="operatingProfit" name="영업이익" radius={[3,3,0,0]}>
                {monthlyData.map((m, i) => (
                  <Cell key={i} fill={m.operatingProfit >= 0 ? '#10b981' : '#ef4444'}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 거래처별 매출 Top5 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="text-xs font-black text-slate-600 mb-4">거래처별 매출 Top 5</div>
          {clientSales.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-300 text-sm">데이터 없음</div>
          ) : (
            <div className="space-y-3">
              {clientSales.map((c, i) => {
                const maxAmt = clientSales[0].amount;
                const barPct = maxAmt > 0 ? Math.round(c.amount / maxAmt * 100) : 0;
                return (
                  <div key={c.name}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-black w-4 text-center" style={{ color: COLORS[i] }}>{i + 1}</span>
                        <span className="text-xs font-black text-slate-700 truncate max-w-[100px]">{c.name}</span>
                      </div>
                      <span className="text-[11px] font-black text-slate-600">{fmtM(c.amount)}원</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full transition-all" style={{ width: `${barPct}%`, background: COLORS[i] }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 영업이익률 추이 라인 차트 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="text-xs font-black text-slate-600 mb-4">월별 영업이익률 추이 (%)</div>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={monthlyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
            <XAxis dataKey="month" tick={{ fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false}/>
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={38}/>
            <Tooltip formatter={(v: any, name: string) => [`${v}%`, name]} contentStyle={{ fontSize: 11 }}/>
            <Line
              dataKey={(d) => d.sales > 0 ? Math.round(d.operatingProfit / d.sales * 100) : 0}
              name="영업이익률"
              stroke="#8b5cf6"
              strokeWidth={2.5}
              dot={{ r: 3, fill: '#8b5cf6' }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 월별 상세 테이블 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <span className="text-xs font-black text-slate-600">월별 손익 상세</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50">
              <tr>
                {['월', '매출', '매입', '매출총이익', '고정비', '영업이익', '이익률', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap text-right first:text-left last:text-center">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {monthlyData.map(m => {
                const margin = m.sales > 0 ? Math.round(m.operatingProfit / m.sales * 100) : 0;
                const isEmpty = m.sales === 0 && m.purchase === 0 && m.fixed === 0;
                const isExpanded = expandedMonth === m.ym;

                // 해당 월 전표 목록
                const monthStmts = issuedStatements.filter(s => s.tradeDate.startsWith(m.ym));

                return (
                  <React.Fragment key={m.ym}>
                    <tr
                      className={`hover:bg-slate-50 transition-colors ${isEmpty ? 'opacity-40' : 'cursor-pointer'}`}
                      onClick={() => !isEmpty && setExpandedMonth(isExpanded ? null : m.ym)}
                    >
                      <td className="px-4 py-3 text-xs font-black text-slate-700">{m.month}</td>
                      <td className="px-4 py-3 text-xs text-right text-blue-700 font-bold">{m.sales ? fmt(m.sales) : '-'}</td>
                      <td className="px-4 py-3 text-xs text-right text-amber-700 font-bold">{m.purchase ? fmt(m.purchase) : '-'}</td>
                      <td className="px-4 py-3 text-xs text-right font-bold text-slate-700">{m.grossProfit ? fmt(m.grossProfit) : '-'}</td>
                      <td className="px-4 py-3 text-xs text-right text-slate-500">{m.fixed ? fmt(m.fixed) : '-'}</td>
                      <td className={`px-4 py-3 text-xs text-right font-black ${m.operatingProfit > 0 ? 'text-emerald-600' : m.operatingProfit < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                        {m.operatingProfit ? fmt(m.operatingProfit) : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-right">
                        {m.sales > 0 ? (
                          <span className={`font-black px-2 py-0.5 rounded-full text-[10px] ${margin >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                            {margin}%
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-300">
                        {!isEmpty && (isExpanded ? <ChevronUp size={13}/> : <ChevronDown size={13}/>)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="px-6 py-3 bg-slate-50">
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">전표 내역</div>
                          <div className="space-y-1">
                            {monthStmts.length === 0 ? (
                              <div className="text-xs text-slate-300">전표 없음</div>
                            ) : monthStmts.map(s => (
                              <div key={s.id} className="flex items-center gap-3 text-[11px]">
                                <span className={`px-1.5 py-0.5 rounded-full font-black text-[9px] ${s.type === '매출' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{s.type}</span>
                                <span className="text-slate-600">{s.tradeDate}</span>
                                <span className="font-bold text-slate-800">{s.clientName}</span>
                                <span className="ml-auto font-black text-slate-700">{fmt(s.totalAmount)}원</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            {/* 합계 행 */}
            <tfoot className="bg-slate-100 border-t-2 border-slate-200">
              <tr>
                <td className="px-4 py-3 text-xs font-black text-slate-700">합계</td>
                <td className="px-4 py-3 text-xs text-right font-black text-blue-700">{fmt(annual.sales)}</td>
                <td className="px-4 py-3 text-xs text-right font-black text-amber-700">{fmt(annual.purchase)}</td>
                <td className="px-4 py-3 text-xs text-right font-black text-slate-700">{fmt(annual.grossProfit)}</td>
                <td className="px-4 py-3 text-xs text-right font-black text-slate-500">{fmt(annual.fixed)}</td>
                <td className={`px-4 py-3 text-xs text-right font-black ${annual.operatingProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(annual.operatingProfit)}</td>
                <td className="px-4 py-3 text-xs text-right font-black text-slate-500">
                  {annual.sales > 0 ? `${Math.round(annual.operatingProfit / annual.sales * 100)}%` : '-'}
                </td>
                <td/>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ProfitAnalysis;
