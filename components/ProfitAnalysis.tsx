
import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, BarChart2, DollarSign, Wallet, Users, ChevronLeft, ChevronRight, Save, Search, Package } from 'lucide-react';
import { IssuedStatement, FixedCostEntry, Client, PaymentRecord, Product } from '../types';
import PageHeader from './PageHeader';
import CostManager from './CostManager';

interface ProfitAnalysisProps {
  issuedStatements: IssuedStatement[];
  fixedCosts: FixedCostEntry[];
  onAddCost: (entry: Omit<FixedCostEntry, 'id' | 'createdAt'>) => Promise<void>;
  onDeleteCost: (id: string) => Promise<void>;
  clients?: Client[];
  products?: Product[];
  onUpdateIssuedStatement?: (id: string, data: Partial<IssuedStatement>) => void;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');
const fmtM = (n: number) => {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (Math.abs(n) >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return String(n);
};

const MONTHS = 12;

const ProfitAnalysis: React.FC<ProfitAnalysisProps> = ({ issuedStatements, fixedCosts, onAddCost, onDeleteCost, clients = [], products = [], onUpdateIssuedStatement }) => {
  const [mainTab, setMainTab] = useState<'analysis' | 'costs' | 'clients' | 'inventory-value'>('analysis');
  const [period, setPeriod] = useState<'3M' | '6M' | '1Y'>('1Y');

  // ── 거래처통계 탭 상태 ──
  const [statsClientId, setStatsClientId] = useState('');
  const [statsYear, setStatsYear] = useState(() => new Date().getFullYear());

  // ── 미수금 탭 상태 ──
  const [recClientId, setRecClientId] = useState('');
  const [recClientSearch, setRecClientSearch] = useState('');
  const [showPayModal, setShowPayModal] = useState(false);
  const [payTarget, setPayTarget] = useState<IssuedStatement | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', date: new Date().toISOString().slice(0, 10), method: '계좌이체' as PaymentRecord['method'], note: '' });

  // ── 거래처 탭 서브탭 ──
  const [clientsSubTab, setClientsSubTab] = useState<'receivables' | 'stats'>('receivables');
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

  // 기간별 월 목록 계산
  const periodMonths = useMemo(() => {
    if (period === '1Y') {
      return Array.from({ length: 12 }, (_, i) => `${selectedYear}-${String(i + 1).padStart(2, '0')}`);
    }
    const count = period === '3M' ? 3 : 6;
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  }, [period, selectedYear]);

  // 월별 집계
  const monthlyData = useMemo(() => {
    return periodMonths.map(ym => {
      const [y, m] = ym.split('-');
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
      return { month: `${Number(m)}월`, ym, sales, purchase, fixed, grossProfit, operatingProfit };
    });
  }, [issuedStatements, fixedCosts, periodMonths]);

  // 기간 합계
  const summary = useMemo(() => monthlyData.reduce(
    (a, m) => ({
      sales: a.sales + m.sales,
      purchase: a.purchase + m.purchase,
      fixed: a.fixed + m.fixed,
      grossProfit: a.grossProfit + m.grossProfit,
      operatingProfit: a.operatingProfit + m.operatingProfit,
    }),
    { sales: 0, purchase: 0, fixed: 0, grossProfit: 0, operatingProfit: 0 }
  ), [monthlyData]);

  // 연간 합계 (거래처통계용, 항상 selectedYear 기준)
  const annual = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const ym = `${selectedYear}-${String(i + 1).padStart(2, '0')}`;
      return {
        sales: issuedStatements.filter(s => s.type === '매출' && s.tradeDate.startsWith(ym)).reduce((a, s) => a + s.totalAmount, 0),
        purchase: issuedStatements.filter(s => s.type === '매입' && s.tradeDate.startsWith(ym)).reduce((a, s) => a + s.totalAmount, 0),
        fixed: fixedCosts.filter(c => c.yearMonth === ym).reduce((a, c) => a + c.amount, 0),
      };
    }).reduce((a, m) => ({
      sales: a.sales + m.sales, purchase: a.purchase + m.purchase, fixed: a.fixed + m.fixed,
      grossProfit: a.sales + m.sales - (a.purchase + m.purchase),
      operatingProfit: a.sales + m.sales - (a.purchase + m.purchase) - (a.fixed + m.fixed),
    }), { sales: 0, purchase: 0, fixed: 0, grossProfit: 0, operatingProfit: 0 });
  }, [issuedStatements, fixedCosts, selectedYear]);

  const pct = (curr: number, prev: number | undefined) => {
    if (!prev || prev === 0) return null;
    return Math.round((curr - prev) / Math.abs(prev) * 100);
  };

  // 거래처별 매출 Top5 (기간 기준)
  const clientSales = useMemo(() => {
    const map = new Map<string, number>();
    issuedStatements
      .filter(s => s.type === '매출' && periodMonths.some(ym => s.tradeDate.startsWith(ym)))
      .forEach(s => map.set(s.clientName, (map.get(s.clientName) ?? 0) + s.totalAmount));
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, amount]) => ({ name, amount }));
  }, [issuedStatements, periodMonths]);

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
        title="손익 / 비용 관리"
        subtitle="매출 · 매입 · 고정비 기반 영업이익을 분석하고 비용을 관리합니다."
        right={
          <div className="flex items-center gap-2">
            {mainTab === 'analysis' && (
              <div className="flex items-center gap-2">
                {period === '1Y' && (
                  <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
                    className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-black outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer">
                    {years.map(y => <option key={y} value={y}>{y}년</option>)}
                  </select>
                )}
                <div className="flex bg-slate-100 rounded-xl p-1 gap-0.5">
                  {([['3M', '분기'], ['6M', '반기'], ['1Y', '연간']] as const).map(([val, label]) => (
                    <button key={val} onClick={() => setPeriod(val)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${period === val ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
              <button onClick={() => setMainTab('analysis')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${mainTab === 'analysis' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                <BarChart2 size={13}/>손익분석
              </button>
              <button onClick={() => setMainTab('costs')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${mainTab === 'costs' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                <DollarSign size={13}/>고정비 입력
              </button>
              <button onClick={() => setMainTab('clients')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${mainTab === 'clients' ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                <Users size={13}/>거래처통계
              </button>
              <button onClick={() => setMainTab('inventory-value')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${mainTab === 'inventory-value' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                <Package size={13}/>재고액
              </button>
            </div>
          </div>
        }
      />

      {mainTab === 'costs' && (
        <CostManager
          fixedCosts={fixedCosts}
          issuedStatements={issuedStatements}
          onAdd={onAddCost}
          onDelete={onDeleteCost}
        />
      )}

      {mainTab === 'analysis' && <>


      {/* 요약 카드 — 상단: 투입, 하단: 이익 */}
      <div className="space-y-2">
        {/* 투입 지표 */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: '총매출', value: summary.sales, color: 'bg-blue-50 border-blue-100', text: 'text-blue-700', sub: 'text-blue-400' },
            { label: '총매입', value: summary.purchase, color: 'bg-amber-50 border-amber-100', text: 'text-amber-700', sub: 'text-amber-400' },
            { label: '고정비', value: summary.fixed, color: 'bg-slate-50 border-slate-200', text: 'text-slate-700', sub: 'text-slate-400' },
          ].map(card => (
            <div key={card.label} className={`rounded-2xl border px-4 py-3.5 ${card.color}`}>
              <div className={`text-[10px] font-black uppercase tracking-widest mb-1 ${card.sub}`}>{card.label}</div>
              <div className={`text-xl font-black ${card.text}`}>{fmtM(card.value)}</div>
              <div className={`text-[10px] mt-0.5 ${card.sub}`}>{fmt(card.value)}원</div>
            </div>
          ))}
        </div>
        {/* 이익 지표 */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: '매출총이익', value: summary.grossProfit, desc: '총매출 − 총매입', color: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-700', sub: 'text-emerald-400' },
            { label: '영업이익', value: summary.operatingProfit, desc: '매출총이익 − 고정비', color: summary.operatingProfit >= 0 ? 'bg-violet-50 border-violet-100' : 'bg-rose-50 border-rose-100', text: summary.operatingProfit >= 0 ? 'text-violet-700' : 'text-rose-700', sub: summary.operatingProfit >= 0 ? 'text-violet-400' : 'text-rose-400' },
            { label: '당기순이익', value: summary.operatingProfit, desc: '영업외 손익 미반영', color: summary.operatingProfit >= 0 ? 'bg-indigo-50 border-indigo-100' : 'bg-rose-50 border-rose-100', text: summary.operatingProfit >= 0 ? 'text-indigo-700' : 'text-rose-700', sub: summary.operatingProfit >= 0 ? 'text-indigo-400' : 'text-rose-400' },
          ].map(card => (
            <div key={card.label} className={`rounded-2xl border px-4 py-3.5 ${card.color}`}>
              <div className={`text-[10px] font-black uppercase tracking-widest mb-1 ${card.sub}`}>{card.label}</div>
              <div className={`text-xl font-black ${card.text}`}>{fmtM(card.value)}</div>
              <div className={`text-[10px] mt-0.5 ${card.sub}`}>{fmt(card.value)}원</div>
              <div className={`text-[10px] mt-1 ${card.sub} opacity-70`}>{card.desc}</div>
              {card.label === '영업이익' && summary.sales > 0 && (
                <div className={`text-[10px] font-black mt-0.5 ${card.sub}`}>
                  이익률 {Math.round(summary.operatingProfit / summary.sales * 100)}%
                </div>
              )}
            </div>
          ))}
        </div>
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

      </>}

      {/* ── 거래처 통계 탭 (미수금 + 미지급금 + 통계 통합) ── */}
      {mainTab === 'clients' && (() => {
        const getPaid = (s: IssuedStatement) => (s.payments ?? []).reduce((a, p) => a + p.amount, 0);
        const getBalance = (s: IssuedStatement) => s.totalAmount - getPaid(s);

        // ── 전체 거래처 목록 (매출 + 매입 포함) ──
        const currentYear = new Date().getFullYear();
        const allClientIds = new Set(issuedStatements.map(s => s.clientId));
        const allClientList = [...allClientIds].map(id => {
          const name = issuedStatements.find(s => s.clientId === id)?.clientName ?? id;
          const salesS = issuedStatements.filter(s => s.clientId === id && s.type === '매출');
          const purchaseS = issuedStatements.filter(s => s.clientId === id && s.type === '매입');
          const receivable = salesS.reduce((a, s) => a + getBalance(s), 0);
          const payable = purchaseS.reduce((a, s) => a + getBalance(s), 0);
          const yearSales = salesS.filter(s => s.tradeDate.startsWith(String(currentYear))).reduce((a, s) => a + s.totalAmount, 0);
          return { id, name, receivable, payable, yearSales };
        }).filter(c => !recClientSearch || c.name.includes(recClientSearch))
          .sort((a, b) => (b.receivable + b.payable) - (a.receivable + a.payable));

        const selId = statsClientId;
        const selName = allClientList.find(c => c.id === selId)?.name ?? '';
        const selSalesStmts = issuedStatements.filter(s => s.clientId === selId && s.type === '매출').sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
        const selPurchaseStmts = issuedStatements.filter(s => s.clientId === selId && s.type === '매입').sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
        const yearSalesStmts = selSalesStmts.filter(s => s.tradeDate.startsWith(String(statsYear)));
        const yearSalesTotal = yearSalesStmts.reduce((a, s) => a + s.totalAmount, 0);
        const totalReceivable = selSalesStmts.reduce((a, s) => a + getBalance(s), 0);
        const totalPayable = selPurchaseStmts.reduce((a, s) => a + getBalance(s), 0);
        const months = Array.from({ length: 12 }, (_, i) => {
          const m = String(i + 1).padStart(2, '0');
          const rows = yearSalesStmts.filter(s => s.tradeDate.startsWith(`${statsYear}-${m}`));
          return { label: `${i + 1}월`, amount: rows.reduce((s, r) => s + r.totalAmount, 0), count: rows.length };
        });
        const maxAmt = Math.max(...months.map(m => m.amount), 1);
        const availableYears = Array.from(new Set(selSalesStmts.map(s => Number(s.tradeDate.slice(0, 4))))).sort((a, b) => b - a);
        const fmtS = (n: number) => n >= 100000000 ? `${(n / 100000000).toFixed(1)}억` : n >= 10000 ? `${Math.round(n / 10000).toLocaleString()}만` : n.toLocaleString();

        const openPayModal = (stmt: IssuedStatement) => {
          setPayTarget(stmt);
          setPayForm({ amount: String(getBalance(stmt)), date: new Date().toISOString().slice(0, 10), method: '계좌이체', note: '' });
          setShowPayModal(true);
        };
        const savePayment = () => {
          if (!payTarget || !payForm.amount) return;
          const newPayment: PaymentRecord = {
            id: Date.now().toString(),
            amount: Number(payForm.amount),
            date: payForm.date,
            method: payForm.method,
            ...(payForm.note.trim() ? { note: payForm.note.trim() } : {}),
          };
          onUpdateIssuedStatement?.(payTarget.id, { payments: [...(payTarget.payments ?? []), newPayment] });
          setShowPayModal(false);
          setPayTarget(null);
        };

        const StmtRow = ({ stmt, labelColor }: { stmt: IssuedStatement; labelColor: string }) => {
          const bal = getBalance(stmt);
          const paid = getPaid(stmt);
          const isPaid = bal <= 0;
          return (
            <div className="px-5 py-3 hover:bg-slate-50 transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-slate-700">{stmt.tradeDate}</span>
                    <span className="text-[10px] font-mono text-slate-400">{stmt.docNo}</span>
                    {isPaid
                      ? <span className="text-[9px] bg-emerald-100 text-emerald-700 font-black px-1.5 py-0.5 rounded">완납</span>
                      : <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${labelColor}`}>{stmt.type === '매출' ? '미수' : '미지급'}</span>}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">{stmt.items.slice(0, 2).map(i => i.name).join(', ')}{stmt.items.length > 2 ? ` 외 ${stmt.items.length - 2}건` : ''}</p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    청구 {fmt(stmt.totalAmount)}원 · 처리 {fmt(paid)}원
                    {!isPaid && <span className="text-rose-600 font-black"> · 잔액 {fmt(bal)}원</span>}
                  </p>
                  {(stmt.payments ?? []).length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {stmt.payments!.map(p => (
                        <div key={p.id} className="text-[9px] text-slate-400 flex gap-2">
                          <span>{p.date}</span><span>{p.method}</span>
                          <span className="font-black text-emerald-600">+{fmt(p.amount)}원</span>
                          {p.note && <span>{p.note}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {!isPaid && (
                  <button onClick={() => openPayModal(stmt)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all shrink-0 ml-3 ${stmt.type === '매출' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-rose-600 text-white hover:bg-rose-700'}`}>
                    <Save size={10}/>{stmt.type === '매출' ? '수금 등록' : '지불 등록'}
                  </button>
                )}
              </div>
            </div>
          );
        };

        return (
          <>
            <div className="flex gap-4 min-h-[600px]">
              {/* 좌측: 거래처 목록 */}
              <div className="w-64 shrink-0 flex flex-col gap-3">
                <div className="relative">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                  <input type="text" placeholder="거래처 검색..." value={recClientSearch}
                    onChange={e => setRecClientSearch(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 flex-1 overflow-y-auto">
                  {allClientList.length === 0 && <div className="py-8 text-center text-slate-300 text-xs font-bold">전표 없음</div>}
                  {allClientList.map(c => {
                    const isActive = selId === c.id;
                    return (
                      <button key={c.id} onClick={() => { setStatsClientId(c.id); setStatsYear(currentYear); }}
                        className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-all ${isActive ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : 'hover:bg-slate-50'}`}>
                        <p className={`text-xs font-black truncate ${isActive ? 'text-indigo-700' : 'text-slate-700'}`}>{c.name}</p>
                        <div className="flex gap-2 mt-0.5">
                          {c.receivable > 0 && <span className="text-[9px] font-black text-blue-500">미수 {fmtS(c.receivable)}</span>}
                          {c.payable > 0 && <span className="text-[9px] font-black text-rose-500">미지급 {fmtS(c.payable)}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 우측: 선택 거래처 상세 */}
              <div className="flex-1 space-y-4 overflow-y-auto">
                {!selId ? (
                  <div className="flex flex-col items-center justify-center h-full bg-white rounded-2xl border border-dashed border-slate-200 py-20">
                    <Users size={36} className="text-slate-200 mb-3"/>
                    <p className="text-slate-400 text-sm font-bold">거래처를 선택하세요</p>
                  </div>
                ) : (
                  <>
                    {/* 헤더 + 연도 선택 */}
                    <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 flex items-center justify-between flex-wrap gap-3">
                      <h3 className="text-sm font-black text-slate-800">{selName}</h3>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setStatsYear(y => y - 1)} className="p-1.5 hover:bg-slate-100 rounded-lg"><ChevronLeft size={16}/></button>
                        <span className="text-sm font-black text-slate-800 min-w-[52px] text-center">{statsYear}년</span>
                        <button onClick={() => setStatsYear(y => y + 1)} disabled={statsYear >= currentYear} className="p-1.5 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronRight size={16}/></button>
                        {availableYears.filter(y => y !== statsYear).map(y => (
                          <button key={y} onClick={() => setStatsYear(y)} className="px-2.5 py-1 rounded-lg text-xs font-black bg-slate-100 text-slate-500 hover:bg-slate-200">{y}</button>
                        ))}
                      </div>
                    </div>

                    {/* 요약 카드 */}
                    <div className="grid grid-cols-4 gap-3">
                      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">연간 매출</p>
                        <p className="text-xl font-black text-blue-700 mt-1">{fmtS(yearSalesTotal)}</p>
                      </div>
                      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
                        <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest">거래 횟수</p>
                        <p className="text-xl font-black text-amber-700 mt-1">{yearSalesStmts.length}건</p>
                      </div>
                      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">미수금</p>
                        <p className={`text-xl font-black mt-1 ${totalReceivable > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{totalReceivable > 0 ? fmtS(totalReceivable) : '없음'}</p>
                      </div>
                      <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4">
                        <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest">미지급금</p>
                        <p className={`text-xl font-black mt-1 ${totalPayable > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{totalPayable > 0 ? fmtS(totalPayable) : '없음'}</p>
                      </div>
                    </div>

                    {/* 월별 매출 차트 */}
                    {yearSalesStmts.length > 0 && (
                      <div className="bg-white rounded-2xl border border-slate-200 p-5">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">월별 매출</p>
                        <div className="flex items-end gap-1 h-24">
                          {months.map(({ label, amount, count }) => (
                            <div key={label} className="flex-1 flex flex-col items-center gap-1 group relative">
                              <div className="w-full bg-indigo-100 rounded-t-md hover:bg-indigo-300 transition-all" style={{ height: `${Math.round((amount / maxAmt) * 84)}px`, minHeight: amount > 0 ? 4 : 0 }}/>
                              {amount > 0 && (
                                <div className="absolute bottom-full mb-1.5 bg-slate-800 text-white text-[9px] font-black px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 left-1/2 -translate-x-1/2">
                                  {fmtS(amount)}원 · {count}건
                                </div>
                              )}
                              <span className="text-[8px] font-bold text-slate-400">{label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 매출 내역 (미수금) */}
                    {selSalesStmts.length > 0 && (
                      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                          <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">매출 내역 · 미수금</p>
                          {totalReceivable > 0 && <span className="text-xs font-black text-rose-600">잔액 {fmt(totalReceivable)}원</span>}
                        </div>
                        <div className="divide-y divide-slate-50">
                          {selSalesStmts.map(s => <StmtRow key={s.id} stmt={s} labelColor="bg-blue-100 text-blue-600"/>)}
                        </div>
                      </div>
                    )}

                    {/* 매입 내역 (미지급금) */}
                    {selPurchaseStmts.length > 0 && (
                      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                          <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">매입 내역 · 미지급금</p>
                          {totalPayable > 0 && <span className="text-xs font-black text-rose-600">잔액 {fmt(totalPayable)}원</span>}
                        </div>
                        <div className="divide-y divide-slate-50">
                          {selPurchaseStmts.map(s => <StmtRow key={s.id} stmt={s} labelColor="bg-rose-100 text-rose-600"/>)}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* 수금/지불 등록 모달 */}
            {showPayModal && payTarget && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4">
                  <h3 className="text-sm font-black text-slate-800">{payTarget.type === '매출' ? '수금 등록 — 미수금 감소' : '지불 등록 — 미지급금 감소'}</h3>
                  <div className="text-xs text-slate-400">{payTarget.clientName} · {payTarget.tradeDate}</div>
                  <div className="bg-slate-50 rounded-xl px-4 py-3 text-xs text-center">
                    <span className="text-slate-500">잔여 {payTarget.type === '매출' ? '미수금' : '미지급금'} </span>
                    <span className="font-black text-rose-600 text-base">{fmt(getBalance(payTarget))}원</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">금액</label>
                      <input type="number" value={payForm.amount}
                        onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">일자</label>
                      <input type="date" value={payForm.date}
                        onChange={e => setPayForm(p => ({ ...p, date: e.target.value }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">결제 방법</label>
                      <div className="flex gap-1.5 flex-wrap">
                        {(['현금', '계좌이체', '어음', '카드', '기타'] as PaymentRecord['method'][]).map(m => (
                          <button key={String(m)} onClick={() => setPayForm(p => ({ ...p, method: m }))}
                            className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${payForm.method === m ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">비고</label>
                      <input type="text" placeholder="예: 1차 분할" value={payForm.note}
                        onChange={e => setPayForm(p => ({ ...p, note: e.target.value }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setShowPayModal(false)} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
                    <button onClick={savePayment} disabled={!payForm.amount || Number(payForm.amount) <= 0}
                      className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 disabled:opacity-40 flex items-center justify-center gap-1.5">
                      <Save size={12}/>저장
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        );
      })()}
      {/* ── 재고액 탭 ── */}
      {mainTab === 'inventory-value' && (() => {
        const getStock = (p: Product) => {
          if (p.itemType === 'FINISHED') return p.finishedStock ?? 0;
          if (p.itemType === 'WIP') return p.wipStock ?? 0;
          return p.stock ?? 0;
        };

        const rows = products
          .map(p => ({ ...p, stock: getStock(p), value: getStock(p) * (p.cost ?? 0) }))
          .filter(p => p.stock > 0 || (p.cost ?? 0) > 0)
          .sort((a, b) => b.value - a.value);

        const totalValue = rows.reduce((acc, p) => acc + p.value, 0);

        const categoryOrder = ['완제품', '향미유', '고춧가루', '용기', '마개', '테이프', '박스', '라벨'];
        const grouped = categoryOrder
          .map(cat => ({ cat, items: rows.filter(p => p.category === cat) }))
          .filter(g => g.items.length > 0);

        const otherItems = rows.filter(p => !categoryOrder.includes(p.category));
        if (otherItems.length > 0) grouped.push({ cat: '기타', items: otherItems });

        return (
          <div className="space-y-4">
            {/* 재고총액 요약 */}
            <div className="bg-teal-50 border border-teal-200 rounded-2xl px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package size={18} className="text-teal-600" />
                <span className="text-sm font-black text-teal-700">재고총액</span>
              </div>
              <span className="text-2xl font-black text-teal-700">{fmt(totalValue)}원</span>
            </div>

            {/* 카테고리별 테이블 */}
            {grouped.map(({ cat, items }) => {
              const catTotal = items.reduce((acc, p) => acc + p.value, 0);
              return (
                <div key={cat} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-black text-slate-600">{cat}</span>
                    <span className="text-xs font-black text-teal-600">{fmt(catTotal)}원</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50">
                        <tr>
                          {['품목명', '재고', '원가', '재고액'].map((h, i) => (
                            <th key={h} className={`px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest ${i === 0 ? '' : 'text-right'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {items.map(p => (
                          <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 text-xs font-bold text-slate-700">{p.name}</td>
                            <td className="px-4 py-3 text-xs text-right text-slate-600">{p.stock.toLocaleString()} {p.unit}</td>
                            <td className="px-4 py-3 text-xs text-right text-slate-500">
                              {p.cost ? `${fmt(p.cost)}원` : <span className="text-slate-300">-</span>}
                            </td>
                            <td className={`px-4 py-3 text-xs text-right font-black ${p.value > 0 ? 'text-teal-700' : 'text-slate-300'}`}>
                              {p.value > 0 ? `${fmt(p.value)}원` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            {rows.length === 0 && (
              <div className="bg-white rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-300">
                <Package size={36} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm font-bold">재고 데이터가 없습니다</p>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};

export default ProfitAnalysis;
