
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, BarChart2, DollarSign, Wallet, Users, ChevronLeft, ChevronRight, Save, Search, Package, X, CreditCard, Download, Archive, Clock, Pencil, Check } from 'lucide-react';
import { IssuedStatement, FixedCostEntry, FixedCostTemplate, Partner, PaymentRecord, Item, AccountCode, AccountGroup, AccountGroupPlLine, InventorySnapshot, CashFlowManual, CashEntry, Settlement } from '../types';
import PageHeader from './PageHeader';
import CostManager from './CostManager';
import { makeCodeToGroup, computeMonthPL, computeCashFlowMonth, addMonthStr, SGNA_LEGACY_IDS, COMPUTED_GROUP_IDS } from '../src/features/admin/financials';

type MainTab = 'analysis' | 'costs' | 'partners' | 'inventory-value' | 'account-settings' | 'cash-flow';

interface ProfitAnalysisProps {
  issuedStatements: IssuedStatement[];
  fixedCosts: FixedCostEntry[];
  fixedCostTemplates?: FixedCostTemplate[];
  onAddCost: (entry: Omit<FixedCostEntry, 'id' | 'createdAt'>) => Promise<void>;
  onDeleteCost: (id: string) => Promise<void>;
  onAddTemplate?: (data: Omit<FixedCostTemplate, 'id'>) => Promise<void>;
  onUpdateTemplate?: (id: string, data: Partial<FixedCostTemplate>) => Promise<void>;
  onDeleteTemplate?: (id: string) => Promise<void>;
  partners?: Partner[];
  items?: Item[];
  onUpdateIssuedStatement?: (id: string, data: Partial<IssuedStatement>) => void;
  accountGroups?: AccountGroup[];
  accountCodes?: AccountCode[];
  onUpdateAccountCode?: (id: string, data: Partial<AccountCode>) => void;
  onAddAccountCode?: (data: Omit<AccountCode, 'id'>) => Promise<string>;
  onDeleteAccountCode?: (id: string) => void;
  onAddAccountGroup?: (data: Omit<AccountGroup, 'id'>) => Promise<string>;
  onUpdateAccountGroup?: (id: string, data: Partial<AccountGroup>) => void;
  onDeleteAccountGroup?: (id: string) => void;
  inventorySnapshots?: InventorySnapshot[];
  onSaveInventorySnapshot?: (data: Omit<InventorySnapshot, 'id'>) => Promise<void>;
  onGenerateRecurringCosts?: (yearMonth: string) => Promise<number>;
  cashFlowManual?: CashFlowManual[];
  onSaveCashFlowManual?: (month: string, data: Partial<CashFlowManual>) => Promise<void>;
  cashEntries?: CashEntry[];
  settlements?: Settlement[];
  initialTab?: MainTab;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');
const fmtM = (n: number) => {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (Math.abs(n) >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return String(n);
};

const MONTHS = 12;

const ProfitAnalysis: React.FC<ProfitAnalysisProps> = ({ issuedStatements, fixedCosts, fixedCostTemplates = [], onAddCost, onDeleteCost, onAddTemplate, onUpdateTemplate, onDeleteTemplate, partners = [], items: products = [], onUpdateIssuedStatement, accountGroups: rawAccountGroups = [], accountCodes = [], onUpdateAccountCode, onAddAccountCode, onDeleteAccountCode, onAddAccountGroup, onUpdateAccountGroup, onDeleteAccountGroup, inventorySnapshots = [], onSaveInventorySnapshot, onGenerateRecurringCosts, cashFlowManual = [], onSaveCashFlowManual, cashEntries = [], settlements = [], initialTab }) => {
  // 계산결과 그룹 숨김 + 구 판매비/관리비 → 판관비로 통합 표시
  const accountGroups = rawAccountGroups
    .filter(g => !COMPUTED_GROUP_IDS.has(g.id))
    .map(g => SGNA_LEGACY_IDS.has(g.id) ? { ...g, id: 'ag-sgna', name: '판관비' } : g)
    .filter((g, idx, arr) => arr.findIndex(x => x.id === g.id) === idx);
  const [mainTab, setMainTab] = useState<MainTab>(initialTab ?? 'analysis');
  const isStandalone = initialTab === 'partners' || initialTab === 'cash-flow';
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [expandedInvCats, setExpandedInvCats] = useState<Set<string>>(new Set());
  const [expandedSnapId, setExpandedSnapId] = useState<string | null>(null);
  const [period, setPeriod] = useState<'3M' | '6M' | '1Y' | 'custom'>('custom');
  const [selectedQuarter, setSelectedQuarter] = useState<1|2|3|4>(() => {
    const cm = new Date().getMonth() + 1;
    const avail = ([1,2,3,4] as const).find(q => cm > q * 3);
    return avail ?? 1;
  });
  const [selectedHalf, setSelectedHalf] = useState<1|2>(1);
  const [customStartMonth, setCustomStartMonth] = useState(1);
  const [customEndMonth, setCustomEndMonth] = useState(() => Math.max(1, new Date().getMonth()));
  const [newCodeForm, setNewCodeForm] = useState({ code: '', name: '', groupId: '' });
  const [newGroupForm, setNewGroupForm] = useState({ name: '', type: '수익' as AccountGroup['type'] });
  const [showAddCode, setShowAddCode] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);
  // ── 현금흐름표(간접법): 월별 / 기간 모드 ──
  const [cfMode, setCfMode] = useState<'month' | 'period'>('month');
  const [cfMonth, setCfMonth] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); // 기본: 전월
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [cfEdit, setCfEdit] = useState<Partial<CashFlowManual>>({});
  useEffect(() => {
    const doc = cashFlowManual.find(m => m.month === cfMonth);
    setCfEdit(doc ? { depreciation: doc.depreciation, prepaidInc: doc.prepaidInc, assetBuy: doc.assetBuy, assetSell: doc.assetSell, financeIn: doc.financeIn, debtRepay: doc.debtRepay, openingCash: doc.openingCash } : {});
  }, [cfMonth, cashFlowManual]);
  // ── 계정그룹/계정과목 인라인 수정 ──
  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  const [editGroupForm, setEditGroupForm] = useState<{ name: string; type: AccountGroup['type'] }>({ name: '', type: '비용' });
  const [editCodeId, setEditCodeId] = useState<string | null>(null);
  const [editCodeForm, setEditCodeForm] = useState({ code: '', name: '' });
  const GROUP_TYPES: AccountGroup['type'][] = ['수익', '비용', '자산', '부채', '자본'];

  // ── 거래처통계 탭 상태 ──
  const [statsClientId, setStatsClientId] = useState('');
  const [statsYear, setStatsYear] = useState(() => new Date().getFullYear());

  // ── 미수금 탭 상태 ──
  const [recClientId, setRecClientId] = useState('');
  const [recClientSearch, setRecClientSearch] = useState('');
  const [showPayModal, setShowPayModal] = useState(false);
  const [payTarget, setPayTarget] = useState<IssuedStatement | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', date: new Date().toISOString().slice(0, 10), method: '계좌이체' as PaymentRecord['method'], note: '' });

  // ── 미수금 상세 팝업 ──
  const [receivableDetailClient, setReceivableDetailClient] = useState<{ id: string; name: string } | null>(null);

  // ── 거래처 탭 서브탭 ──
  const [partnersSubTab, setClientsSubTab] = useState<'receivables' | 'stats'>('receivables');
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // 계정코드 → AccountGroup 조회 (구 판매비/관리비 ID도 판관비로 매핑)
  const codeToGroup = useMemo(
    () => makeCodeToGroup(accountCodes, accountGroups, rawAccountGroups),
    [accountCodes, accountGroups, rawAccountGroups]
  );

  // 연도 목록 (전표 기준)
  const years = useMemo(() => {
    const ys = new Set<number>();
    issuedStatements.forEach(s => ys.add(Number(s.tradeDate.slice(0, 4))));
    fixedCosts.forEach(c => ys.add(Number(c.yearMonth.slice(0, 4))));
    ys.add(now.getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [issuedStatements, fixedCosts]);

  // 오늘 연월 (미래 달 제외 기준)
  const todayYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonth = now.getMonth() + 1;
  const isCurrentYear = selectedYear === now.getFullYear();
  const quarterAvailable = (q: 1|2|3|4) => !isCurrentYear || currentMonth > q * 3;
  const halfAvailable = (h: 1|2) => !isCurrentYear || (h === 1 && currentMonth > 6);
  const yearlyAvailable = !isCurrentYear;

  // 연도 변경 시 유효하지 않은 기간 자동 초기화
  useEffect(() => {
    if (selectedYear !== now.getFullYear()) return;
    if (period === '1Y') { setPeriod('custom'); return; }
    if (period === '3M') {
      const avail = ([1,2,3,4] as const).find(q => currentMonth > q * 3);
      if (!avail) { setPeriod('custom'); return; }
      if (!(currentMonth > selectedQuarter * 3)) setSelectedQuarter(avail);
    }
    if (period === '6M') {
      if (currentMonth <= 6) { setPeriod('custom'); return; }
      if (selectedHalf === 2) setSelectedHalf(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear]);

  // 기간별 월 목록 계산
  const periodMonths = useMemo(() => {
    if (period === '1Y') {
      const all = Array.from({ length: 12 }, (_, i) => `${selectedYear}-${String(i + 1).padStart(2, '0')}`);
      return selectedYear === now.getFullYear() ? all.filter(ym => ym <= todayYm) : all;
    }
    if (period === '3M') {
      const sm = (selectedQuarter - 1) * 3 + 1;
      const all = Array.from({ length: 3 }, (_, i) => `${selectedYear}-${String(sm + i).padStart(2, '0')}`);
      return selectedYear === now.getFullYear() ? all.filter(ym => ym <= todayYm) : all;
    }
    if (period === '6M') {
      const sm = selectedHalf === 1 ? 1 : 7;
      const all = Array.from({ length: 6 }, (_, i) => `${selectedYear}-${String(sm + i).padStart(2, '0')}`);
      return selectedYear === now.getFullYear() ? all.filter(ym => ym <= todayYm) : all;
    }
    // custom: 같은 연도 내 월 범위
    const maxMonth = selectedYear === now.getFullYear() ? now.getMonth() + 1 : 12;
    const end = Math.min(customEndMonth, maxMonth);
    const months: string[] = [];
    for (let m = customStartMonth; m <= end; m++) {
      months.push(`${selectedYear}-${String(m).padStart(2, '0')}`);
    }
    return months;
  }, [period, selectedYear, selectedQuarter, selectedHalf, customStartMonth, customEndMonth, todayYm]);

  // ── 재고 스냅샷 → 기초/기말재고 (손익분석 COGS 패널용) ──
  const openingSnapshot = useMemo(() => {
    if (periodMonths.length === 0) return null;
    const [sy, sm] = periodMonths[0].split('-').map(Number);
    let py = sy, pm = sm - 1;
    if (pm === 0) { pm = 12; py -= 1; }
    const prevYm = `${py}-${String(pm).padStart(2, '0')}`;
    return inventorySnapshots.find(s => s.yearMonth === prevYm) ?? null;
  }, [periodMonths, inventorySnapshots]);

  const closingSnapshot = useMemo(() => {
    if (periodMonths.length === 0) return null;
    const lastYm = periodMonths[periodMonths.length - 1];
    return inventorySnapshots.find(s => s.yearMonth === lastYm) ?? null;
  }, [periodMonths, inventorySnapshots]);

  // 임의 월(YYYY-MM)의 손익 — monthlyData·현금흐름표 공용. cogs = 당기 매입액(재고 미반영).
  const monthPL = useCallback(
    (ym: string) => computeMonthPL(ym, issuedStatements, fixedCosts, codeToGroup),
    [issuedStatements, fixedCosts, codeToGroup]
  );

  // 월별 집계
  const monthlyData = useMemo(
    () => periodMonths.map(ym => ({ month: `${Number(ym.split('-')[1])}월`, ym, ...monthPL(ym) })),
    [periodMonths, monthPL]
  );

  // 기간 합계 — 매출원가는 재고 증감 반영(기초 + 매입 − 기말). 스냅샷 있을 때만 조정.
  const summary = useMemo(() => {
    const base = monthlyData.reduce(
      (a, m) => ({
        sales: a.sales + m.sales,
        purchases: a.purchases + m.cogs,   // m.cogs = 당기 매입액
        sgna: a.sgna + m.sgna,
        fixed: a.fixed + m.fixed,
        otherIncome: a.otherIncome + m.otherIncome,
        otherExpense: a.otherExpense + m.otherExpense,
      }),
      { sales: 0, purchases: 0, sgna: 0, fixed: 0, otherIncome: 0, otherExpense: 0 }
    );
    const cogs = (openingSnapshot || closingSnapshot)
      ? (openingSnapshot?.value ?? 0) + base.purchases - (closingSnapshot?.value ?? 0)
      : base.purchases;
    const grossProfit = base.sales - cogs;
    const operatingProfit = grossProfit - base.sgna - base.fixed;
    const netIncome = operatingProfit + base.otherIncome - base.otherExpense;
    return { ...base, cogs, grossProfit, operatingProfit, netIncome };
  }, [monthlyData, openingSnapshot, closingSnapshot]);

  // 연간 합계 (월별 상세 테이블 합계행용, 항상 selectedYear 기준)
  const annual = useMemo(() => {
    let sales = 0, cogs = 0, sgna = 0, fixed = 0, otherIncome = 0, otherExpense = 0;
    issuedStatements
      .filter(s => s.tradeDate.startsWith(String(selectedYear)))
      .forEach(s => {
        s.items.forEach(item => {
          const group = codeToGroup(item.accountCode);
          const pl = group?.plLine;
          if (pl === 'revenue') sales += item.total;
          else if (pl === 'cogs') cogs += item.total;
          else if (pl === 'sgna') sgna += item.total;
          else if (pl === 'other-income') otherIncome += item.total;
          else if (pl === 'other-expense') otherExpense += item.total;
          else if (!pl && group?.type === '수익') sales += item.total;
          else if (!pl && group?.type === '비용') cogs += item.total;
          else if (!group) {
            if (s.type === '매출') sales += item.total;
            else if (s.type === '비용') sgna += item.total;
            else if (s.type === '매입') cogs += item.total;
          }
        });
      });
    fixedCosts
      .filter(c => c.yearMonth.startsWith(String(selectedYear)))
      .forEach(c => { fixed += c.amount; });
    const grossProfit = sales - cogs;
    const operatingProfit = grossProfit - sgna - fixed;
    const netIncome = operatingProfit + otherIncome - otherExpense;
    return { sales, cogs, sgna, fixed, grossProfit, operatingProfit, otherIncome, otherExpense, netIncome };
  }, [issuedStatements, fixedCosts, selectedYear, codeToGroup]);

  const pct = (curr: number, prev: number | undefined) => {
    if (!prev || prev === 0) return null;
    return Math.round((curr - prev) / Math.abs(prev) * 100);
  };


  // COGS 계정코드별 집계
  const cogsByCode = useMemo(() => {
    const map = new Map<string, { code: string; name: string; total: number }>();
    issuedStatements
      .filter(s => periodMonths.some(ym => s.tradeDate.startsWith(ym)))
      .forEach(s => {
        s.items.forEach(item => {
          if (!item.accountCode) return;
          const group = codeToGroup(item.accountCode);
          if (!group) return;
          const isCogs = group.plLine === 'cogs' || (!group.plLine && group.type === '비용');
          if (!isCogs) return;
          const ac = accountCodes.find(c => c.code === item.accountCode);
          const key = item.accountCode;
          if (!map.has(key)) map.set(key, { code: key, name: ac?.name ?? key, total: 0 });
          map.get(key)!.total += item.total;
        });
      });
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [issuedStatements, periodMonths, codeToGroup, accountCodes]);

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
    <div className="space-y-4 animate-in fade-in duration-300">
      {!isStandalone && (
        <>
          <PageHeader
            title="손익 / 비용 관리"
            subtitle="매출 · 매입 · 고정비 기반 영업이익을 분석하고 비용을 관리합니다."
            right={
              <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
                <button onClick={() => setMainTab('analysis')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${mainTab === 'analysis' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                  <BarChart2 size={13}/>손익분석
                </button>
                <button onClick={() => setMainTab('inventory-value')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${mainTab === 'inventory-value' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                  <Package size={13}/>재고액
                </button>
              </div>
            }
          />
        </>
      )}
      {isStandalone && mainTab === 'partners' && (
        <PageHeader title="거래처 현황" subtitle="거래처별 매출 통계, 미수금 · 미지급금 조회" />
      )}
      {isStandalone && mainTab === 'cash-flow' && (
        <PageHeader title="현금흐름 분석" subtitle="간접법 현금흐름표 — 순이익에서 운전자본·투자·재무를 조정합니다." />
      )}

      {mainTab === 'analysis' && <>

      {/* ── 제목 + 기간 컨트롤 ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-base font-black text-slate-800">
            {selectedYear}년{' '}
            {period === '1Y'
              ? `연간 (1월~${periodMonths.length > 0 ? Number(periodMonths[periodMonths.length - 1].split('-')[1]) : 12}월)`
              : period === '3M' ? `${selectedQuarter}분기`
              : period === '6M' ? (selectedHalf === 1 ? '상반기' : '하반기')
              : `${customStartMonth}월~${Math.min(customEndMonth, selectedYear === now.getFullYear() ? now.getMonth() + 1 : 12)}월`}{' '}
            손익분석
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">매출 · 매입 · 고정비 기반 손익구조 분석</div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
          <button
            onClick={() => setShowAccountSettings(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-black transition-all border border-amber-200"
          >
            <Wallet size={13}/>계정 설정
          </button>
          {period !== 'custom' && (
            <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
              className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-black outline-none cursor-pointer">
              {years.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
          )}
          {period === '3M' && (
            <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
              {([1,2,3,4] as const).filter(q => quarterAvailable(q)).map(q => (
                <button key={q} onClick={() => setSelectedQuarter(q)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all ${selectedQuarter === q ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400'}`}>
                  {q}분기
                </button>
              ))}
            </div>
          )}
          {period === '6M' && (
            <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
              {([1,2] as const).filter(h => halfAvailable(h)).map(h => (
                <button key={h} onClick={() => setSelectedHalf(h)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all ${selectedHalf === h ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400'}`}>
                  {h === 1 ? '상반기' : '하반기'}
                </button>
              ))}
            </div>
          )}
          {period === 'custom' && (() => {
            const maxM = selectedYear === now.getFullYear() ? now.getMonth() + 1 : 12;
            return (
              <div className="flex items-center gap-1">
                <select value={customStartMonth} onChange={e => { const v = Number(e.target.value); setCustomStartMonth(v); if (v > customEndMonth) setCustomEndMonth(v); }}
                  className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-black outline-none cursor-pointer">
                  {Array.from({ length: maxM }, (_, i) => i + 1).map(m => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
                <span className="text-slate-400 text-xs font-black">~</span>
                <select value={Math.min(customEndMonth, maxM)} onChange={e => setCustomEndMonth(Number(e.target.value))}
                  className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-black outline-none cursor-pointer">
                  {Array.from({ length: maxM - customStartMonth + 1 }, (_, i) => customStartMonth + i).map(m => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
              </div>
            );
          })()}
          <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
            {([['3M','분기'],['6M','반기'],['1Y','연간'],['custom','기간']] as const).map(([val,label]) => {
              const disabled =
                (val === '1Y' && !yearlyAvailable) ||
                (val === '6M' && !halfAvailable(1) && !halfAvailable(2)) ||
                (val === '3M' && !([1,2,3,4] as const).some(q => quarterAvailable(q)));
              return (
                <button key={val}
                  disabled={disabled}
                  onClick={() => !disabled && setPeriod(val)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all ${
                    disabled ? 'text-slate-300 cursor-not-allowed' :
                    period === val ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                  }`}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ① 총매출 · 총매출원가 · 매출총이익 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">총매출</div>
          <div className="text-2xl font-black text-slate-800 leading-tight">{fmtM(summary.sales)}</div>
          <div className="text-[10px] text-slate-400 mt-1">{fmt(summary.sales)}원</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">총매출원가</div>
          <div className="text-2xl font-black text-slate-800 leading-tight">{fmtM(summary.cogs)}</div>
          <div className="text-[10px] text-slate-400 mt-1">{fmt(summary.cogs)}원</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">매출총이익</div>
          <div className={`text-2xl font-black leading-tight ${summary.grossProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtM(summary.grossProfit)}</div>
          <div className="text-[10px] text-slate-400 mt-1">
            {fmt(summary.grossProfit)}원
            {summary.sales > 0 && ` · ${Math.round(summary.grossProfit / summary.sales * 100)}%`}
          </div>
        </div>
      </div>

      {/* ② 매출원가 및 재고 상세 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="text-xs font-black text-slate-700 mb-3">매출원가 및 재고 상세</div>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between font-black text-slate-800">
            <span>총매출원가 (COGS)</span>
            <span>{fmtM(summary.cogs)}</span>
          </div>
          <div className="flex items-center justify-between pl-4 text-slate-600">
            <span><span className="mr-1.5 text-slate-200">├</span>기초상품재고액 (+)</span>
            {openingSnapshot
              ? <span className="font-bold text-teal-600">{fmtM(openingSnapshot.value)}</span>
              : <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-lg">스냅샷 없음</span>}
          </div>
          <div className="flex items-center justify-between pl-4 text-slate-600 font-bold">
            <span><span className="mr-1.5 text-slate-200">├</span>당기상품매입액 (+)</span>
            <span>{fmtM(summary.purchases)}</span>
          </div>
          {cogsByCode.map((item, idx) => (
            <div key={item.code} className="flex items-center justify-between pl-10 text-slate-500">
              <span>
                <span className="mr-1.5 text-slate-200">{idx === cogsByCode.length - 1 ? '└' : '├'}</span>
                {item.code} {item.name}
              </span>
              <span>{fmtM(item.total)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between pl-4 text-slate-600">
            <span><span className="mr-1.5 text-slate-200">└</span>기말상품재고액 (-)</span>
            {closingSnapshot
              ? <span className="font-bold text-teal-600">{fmtM(closingSnapshot.value)}</span>
              : <span className="text-[10px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-lg">스냅샷 없음</span>}
          </div>
          {!openingSnapshot && !closingSnapshot && (
            <p className="text-[10px] text-slate-400 pt-1">※ 기초/기말 재고 스냅샷이 없어 매출원가 = 당기 매입액으로 계산됩니다. 재고액 탭에서 기말재고를 기록하세요.</p>
          )}
        </div>
      </div>

      {/* ④ 판관비 상세 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="text-xs font-black text-slate-700 mb-3">판매비와관리비 상세 (SG&A)</div>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between font-black text-slate-800">
            <span>판관비 합계</span>
            <span>{fmtM(summary.sgna + summary.fixed)}</span>
          </div>
          <div className="flex items-center justify-between pl-4 text-slate-500">
            <span><span className="mr-1.5 text-slate-200">├</span>고정비 (임대료, 인건비 등)</span>
            <span>{fmtM(summary.fixed)}</span>
          </div>
          <div className="flex items-center justify-between pl-4 text-slate-500">
            <span><span className="mr-1.5 text-slate-200">└</span>변동비 (광고비, 포장비 등)</span>
            <span>{summary.sgna ? fmtM(summary.sgna) : '0원'}</span>
          </div>
        </div>
      </div>

      {/* ③⑤ 영업이익 · 당기순이익 — 같은 행 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border-2 border-slate-200 px-5 py-4 flex flex-col justify-between">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">영업이익</div>
          <div>
            <div className={`text-2xl font-black ${summary.operatingProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmtM(summary.operatingProfit)}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {fmt(summary.operatingProfit)}원
              {summary.sales > 0 && ` · ${Math.round(summary.operatingProfit / summary.sales * 100)}%`}
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border-2 border-slate-200 px-5 py-4 flex flex-col justify-between">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">당기순이익</div>
          <div>
            <div className={`text-2xl font-black ${summary.netIncome >= 0 ? 'text-slate-800' : 'text-rose-600'}`}>{fmtM(summary.netIncome)}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{fmt(summary.netIncome)}원</div>
          </div>
        </div>
      </div>

      {/* ⑥ 기타 손익 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
        <div className="text-xs font-black text-slate-700 mb-1">기타 손익 (영업외)</div>
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span><span className="mr-1.5 text-slate-200">├</span>영업외수익</span>
          <span className="font-bold text-emerald-600">{summary.otherIncome ? `+${fmt(summary.otherIncome)}원` : '—'}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span><span className="mr-1.5 text-slate-200">└</span>영업외비용</span>
          <span className="font-bold text-rose-600">{summary.otherExpense ? `-${fmt(summary.otherExpense)}원` : '—'}</span>
        </div>
        <div className="border-t border-slate-100 pt-2 flex items-center justify-between text-xs">
          <span className="text-slate-400">기타 손익 합계</span>
          <span className={`font-black ${(summary.otherIncome - summary.otherExpense) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {summary.otherIncome - summary.otherExpense >= 0 ? '+' : ''}{fmt(summary.otherIncome - summary.otherExpense)}원
          </span>
        </div>
      </div>

      {/* 차트 영역 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="text-xs font-black text-slate-600 mb-4">월별 매출 · 매입 · 영업이익</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthlyData} barGap={2} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
            <XAxis dataKey="month" tick={{ fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false}/>
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtM} width={45}/>
            <Tooltip content={customTooltip}/>
            <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700 }} iconSize={8}/>
            <Bar dataKey="sales" name="매출" fill="#3b82f6" radius={[3,3,0,0]}/>
            <Bar dataKey="cogs" name="매출원가" fill="#f59e0b" radius={[3,3,0,0]}/>
            <Bar dataKey="operatingProfit" name="영업이익" radius={[3,3,0,0]}>
              {monthlyData.map((m, i) => (
                <Cell key={i} fill={m.operatingProfit >= 0 ? '#10b981' : '#ef4444'}/>
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
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
                {['월', '매출', '매출원가', '매출총이익', '판관비', '영업이익', '이익률', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap text-right first:text-left last:text-center">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {monthlyData.map(m => {
                const margin = m.sales > 0 ? Math.round(m.operatingProfit / m.sales * 100) : 0;
                const isEmpty = m.sales === 0 && m.cogs === 0 && m.sgna === 0 && m.fixed === 0;
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
                      <td className="px-4 py-3 text-xs text-right text-amber-700 font-bold">{m.cogs ? fmt(m.cogs) : '-'}</td>
                      <td className="px-4 py-3 text-xs text-right font-bold text-slate-700">{m.grossProfit ? fmt(m.grossProfit) : '-'}</td>
                      <td className="px-4 py-3 text-xs text-right text-slate-500">{(m.sgna + m.fixed) ? fmt(m.sgna + m.fixed) : '-'}</td>
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
                                <span className="font-bold text-slate-800">{s.partnerName}</span>
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
                <td className="px-4 py-3 text-xs text-right font-black text-amber-700">{fmt(annual.cogs)}</td>
                <td className="px-4 py-3 text-xs text-right font-black text-slate-700">{fmt(annual.grossProfit)}</td>
                <td className="px-4 py-3 text-xs text-right font-black text-slate-500">{fmt(annual.sgna + annual.fixed)}</td>
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

      {/* ── 현금흐름표 ── */}
      {mainTab === 'cash-flow' && (() => {
        // 간접법 현금흐름표 — 월별/기간. 계산은 순수 모듈(financials.computeCashFlowMonth)에 위임.
        const addMonth = addMonthStr;
        const manualOf = (ym: string): Partial<CashFlowManual> => ym === cfMonth ? { ...(cashFlowManual.find(m => m.month === ym) ?? {}), ...cfEdit } : (cashFlowManual.find(m => m.month === ym) ?? {});
        const computeCF = (ym: string) => computeCashFlowMonth(ym, manualOf(ym), { issuedStatements, inventorySnapshots, monthPL, codeToGroup, accountCodes, cashEntries, settlements });
        const baseline = [...cashFlowManual].filter(m => m.openingCash != null).map(m => m.month).sort()[0];
        const openingOf = (ym: string): number => {
          if (!baseline || ym <= baseline) return manualOf(ym).openingCash ?? 0;
          let cash = manualOf(baseline).openingCash || 0, cur = baseline;
          while (cur < ym) { cash += computeCF(cur).net; cur = addMonth(cur, 1); }
          return cash;
        };
        const months = cfMode === 'month' ? [cfMonth] : periodMonths;
        const rows = months.map(computeCF);
        const S = (sel: (r: typeof rows[number]) => number) => rows.reduce((a, r) => a + sel(r), 0);
        const opTotal = S(r => r.op), invTotal = S(r => r.inv), finTotal = S(r => r.fin), netTotal = S(r => r.net);
        const opening = months.length ? openingOf(months[0]) : 0;
        const closing = opening + netTotal;
        const cfLabel = cfMode === 'month'
          ? `${Number(cfMonth.split('-')[0])}년 ${Number(cfMonth.split('-')[1])}월`
          : (period === '1Y' ? `${selectedYear}년 연간` : period === '3M' ? `${selectedYear}년 ${selectedQuarter}분기` : period === '6M' ? `${selectedYear}년 ${selectedHalf === 1 ? '상반기' : '하반기'}` : `${selectedYear}년 ${customStartMonth}월~${customEndMonth}월`);
        const editable = cfMode === 'month';
        const isBaselineMonth = !baseline || cfMonth <= baseline;
        const mVal = (f: keyof CashFlowManual) => (cfEdit[f] != null ? Number(cfEdit[f]).toLocaleString() : '');
        const setM = (f: keyof CashFlowManual, v: string) => { const n = v.replace(/[^\d]/g, ''); setCfEdit(prev => ({ ...prev, [f]: n === '' ? undefined : Number(n) })); };
        const saveCf = () => onSaveCashFlowManual?.(cfMonth, cfEdit);
        const cfLine = (label: string, amount: number, sign: '+' | '-' | '±', field?: keyof CashFlowManual) => (
          <div className="flex items-center justify-between px-6 py-2.5">
            <span className="text-xs text-slate-600">
              <span className={`mr-2 text-[10px] font-black ${sign === '+' ? 'text-emerald-500' : sign === '-' ? 'text-rose-400' : 'text-slate-400'}`}>({sign})</span>{label}
            </span>
            {editable && field ? (
              <input value={mVal(field)} onChange={e => setM(field, e.target.value)} inputMode="numeric" placeholder="0"
                className="w-32 border border-slate-200 rounded-lg px-2 py-1 text-xs font-black text-right outline-none focus:ring-2 focus:ring-blue-300" />
            ) : (
              <span className={`text-xs font-black tabular-nums ${amount === 0 ? 'text-slate-300' : sign === '+' ? 'text-emerald-700' : sign === '-' ? 'text-rose-700' : 'text-slate-700'}`}>{amount === 0 ? '—' : fmt(amount) + '원'}</span>
            )}
          </div>
        );

        return (
          <div className="space-y-4">
            {/* 모드/기간 컨트롤 */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-base font-black text-slate-800">{cfLabel} 현금흐름표 <span className="text-[11px] font-bold text-slate-400">(간접법)</span></div>
                <div className="text-[11px] text-slate-400 mt-0.5">순이익 → 운전자본 조정 · 투자/재무 반영</div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
                  {([['month','월별'],['period','기간']] as const).map(([val,label]) => (
                    <button key={val} onClick={() => setCfMode(val)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all ${cfMode===val ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400'}`}>{label}</button>
                  ))}
                </div>
                {cfMode === 'month' ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => setCfMonth(m => addMonth(m, -1))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronLeft size={16}/></button>
                    <input type="month" value={cfMonth} onChange={e => e.target.value && setCfMonth(e.target.value)}
                      className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-black outline-none cursor-pointer"/>
                    <button onClick={() => setCfMonth(m => addMonth(m, 1))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronRight size={16}/></button>
                  </div>
                ) : (<>
                {period !== 'custom' && (
                  <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
                    className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-black outline-none cursor-pointer">
                    {years.map(y => <option key={y} value={y}>{y}년</option>)}
                  </select>
                )}
                {period === '3M' && (
                  <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
                    {([1,2,3,4] as const).filter(q => quarterAvailable(q)).map(q => (
                      <button key={q} onClick={() => setSelectedQuarter(q)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all ${selectedQuarter === q ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400'}`}>
                        {q}분기
                      </button>
                    ))}
                  </div>
                )}
                {period === '6M' && (
                  <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
                    {([1,2] as const).filter(h => halfAvailable(h)).map(h => (
                      <button key={h} onClick={() => setSelectedHalf(h)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all ${selectedHalf === h ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400'}`}>
                        {h === 1 ? '상반기' : '하반기'}
                      </button>
                    ))}
                  </div>
                )}
                {period === 'custom' && (() => {
                  const maxM = selectedYear === now.getFullYear() ? now.getMonth() + 1 : 12;
                  return (
                    <div className="flex items-center gap-1">
                      <select value={customStartMonth} onChange={e => { const v = Number(e.target.value); setCustomStartMonth(v); if (v > customEndMonth) setCustomEndMonth(v); }}
                        className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-black outline-none cursor-pointer">
                        {Array.from({ length: maxM }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
                      </select>
                      <span className="text-slate-400 text-xs font-black">~</span>
                      <select value={Math.min(customEndMonth, maxM)} onChange={e => setCustomEndMonth(Number(e.target.value))}
                        className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-black outline-none cursor-pointer">
                        {Array.from({ length: maxM - customStartMonth + 1 }, (_, i) => customStartMonth + i).map(m => <option key={m} value={m}>{m}월</option>)}
                      </select>
                    </div>
                  );
                })()}
                <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
                  {([['3M','분기'],['6M','반기'],['1Y','연간'],['custom','기간']] as const).map(([val, label]) => {
                    const disabled =
                      (val === '1Y' && !yearlyAvailable) ||
                      (val === '6M' && !halfAvailable(1) && !halfAvailable(2)) ||
                      (val === '3M' && !([1,2,3,4] as const).some(q => quarterAvailable(q)));
                    return (
                      <button key={val} disabled={disabled} onClick={() => !disabled && setPeriod(val)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all ${
                          period === val ? 'bg-white text-blue-700 shadow-sm' :
                          disabled ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-slate-600'
                        }`}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                </>)}
              </div>
            </div>

            {/* 현금흐름표 (간접법) */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              {/* 영업활동 */}
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm font-black text-slate-700">영업활동 현금흐름</span>
                <span className={`text-sm font-black tabular-nums ${opTotal >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{opTotal >= 0 ? '+' : ''}{fmt(opTotal)}원</span>
              </div>
              <div className="divide-y divide-slate-50">
                {cfLine('당기순이익', S(r => r.netAdj), '+')}
                {cfLine('감가상각비 (전표 자동)', S(r => r.dep), '+')}
                {cfLine('재고자산 증가', S(r => r.invInc), '-')}
                {cfLine('매출채권 증가', S(r => r.arInc), '-')}
                {cfLine('매입채무 증감', S(r => r.apChg), '±')}
                {cfLine('선급금 증가', S(r => r.prepaid), '-', 'prepaidInc')}
              </div>

              {/* 투자활동 */}
              <div className="px-5 py-3 bg-slate-50 border-t border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm font-black text-slate-700">투자활동 현금흐름</span>
                <span className={`text-sm font-black tabular-nums ${invTotal > 0 ? 'text-emerald-600' : invTotal < 0 ? 'text-rose-600' : 'text-slate-400'}`}>{invTotal === 0 ? '—' : (invTotal > 0 ? '+' : '') + fmt(invTotal) + '원'}</span>
              </div>
              <div className="divide-y divide-slate-50">
                {cfLine('자산취득 (전표 자동)', S(r => r.assetBuy), '-')}
                {cfLine('자산매각 (전표 자동)', S(r => r.assetSell), '+')}
              </div>

              {/* 재무활동 */}
              <div className="px-5 py-3 bg-slate-50 border-t border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm font-black text-slate-700">재무활동 현금흐름</span>
                <span className={`text-sm font-black tabular-nums ${finTotal > 0 ? 'text-emerald-600' : finTotal < 0 ? 'text-rose-600' : 'text-slate-400'}`}>{finTotal === 0 ? '—' : (finTotal > 0 ? '+' : '') + fmt(finTotal) + '원'}</span>
              </div>
              <div className="divide-y divide-slate-50">
                {cfLine('자본조달 (증자·차입) (전표 자동)', S(r => r.finIn), '+')}
                {cfLine('부채상환 (전표 자동)', S(r => r.debtRepay), '-')}
              </div>

              {/* 총 현금흐름 */}
              <div className="px-5 py-3.5 flex items-center justify-between border-t-2 border-slate-200 bg-slate-50">
                <span className="text-sm font-black text-slate-700">총 현금흐름</span>
                <span className={`text-lg font-black ${netTotal >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{netTotal >= 0 ? '+' : ''}{fmt(netTotal)}원</span>
              </div>
              {/* 기초/기말현금 */}
              <div className="flex items-center justify-between px-6 py-2.5 border-t border-slate-100">
                <span className="text-xs text-slate-600">기초현금 {editable && !isBaselineMonth && <span className="text-[10px] text-slate-400">· 전월 이월</span>}</span>
                {editable && isBaselineMonth ? (
                  <input value={mVal('openingCash')} onChange={e => setM('openingCash', e.target.value)} inputMode="numeric" placeholder="기초현금 입력"
                    className="w-32 border border-slate-200 rounded-lg px-2 py-1 text-xs font-black text-right outline-none focus:ring-2 focus:ring-blue-300" />
                ) : (
                  <span className="text-xs font-black tabular-nums text-slate-700">{fmt(opening)}원</span>
                )}
              </div>
              <div className="flex items-center justify-between px-6 py-3 bg-blue-50">
                <span className="text-sm font-black text-blue-800">기말현금</span>
                <span className="text-base font-black text-blue-700 tabular-nums">{fmt(closing)}원</span>
              </div>
            </div>

            {editable ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[11px] text-slate-400 max-w-md">투자·재무·감가상각은 <b>전표(비용/자금)로 기록하면 자동 집계</b>돼요(계정과목의 자산/부채/자본 그룹으로 분류). 선급금·기초현금만 여기서 입력. 저장하면 기말현금이 다음 달 기초로 이어져요.</p>
                <button onClick={saveCf} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700 shadow-sm shrink-0 flex items-center gap-1.5"><Save size={13}/>이 달 저장</button>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">기간 합계예요. 감가상각·투자·재무 등 수동 항목 입력은 <b>월별 모드</b>에서 하세요.</p>
            )}

            {/* 기간별 월 차트 (실수금·지출) */}
            {cfMode === 'period' && periodMonths.length > 1 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">월별 실수금 · 실지출</p>
                <div className="flex items-end gap-1 h-28">
                  {periodMonths.map(ym => {
                    const inc = issuedStatements.filter(s => s.type === '매출').flatMap(s => s.payments ?? []).filter(p => p.date.startsWith(ym)).reduce((a, p) => a + p.amount, 0);
                    const out = issuedStatements.filter(s => s.type === '매입').flatMap(s => s.payments ?? []).filter(p => p.date.startsWith(ym)).reduce((a, p) => a + p.amount, 0)
                              + fixedCosts.filter(c => c.yearMonth === ym).reduce((a, c) => a + c.amount, 0);
                    const barMax = Math.max(...periodMonths.map(m => {
                      const i2 = issuedStatements.filter(s => s.type === '매출').flatMap(s => s.payments ?? []).filter(p => p.date.startsWith(m)).reduce((a, p) => a + p.amount, 0);
                      const o2 = issuedStatements.filter(s => s.type === '매입').flatMap(s => s.payments ?? []).filter(p => p.date.startsWith(m)).reduce((a, p) => a + p.amount, 0) + fixedCosts.filter(c => c.yearMonth === m).reduce((a, c) => a + c.amount, 0);
                      return Math.max(i2, o2);
                    }), 1);
                    const label = `${Number(ym.slice(5))}월`;
                    return (
                      <div key={ym} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                        <div className="absolute bottom-full mb-2 bg-slate-800 text-white text-[9px] font-black px-2 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 left-1/2 -translate-x-1/2 text-center space-y-0.5">
                          <div className="text-emerald-400">수금 {fmtM(inc)}</div>
                          <div className="text-rose-400">지출 {fmtM(out)}</div>
                          <div className={(inc - out) >= 0 ? 'text-teal-300' : 'text-amber-300'}>순 {fmtM(inc - out)}</div>
                        </div>
                        <div className="w-full flex gap-0.5">
                          <div className="flex-1 bg-emerald-400 rounded-t-sm" style={{ height: `${Math.round((inc / barMax) * 96)}px`, minHeight: inc > 0 ? 2 : 0 }}/>
                          <div className="flex-1 bg-rose-400 rounded-t-sm" style={{ height: `${Math.round((out / barMax) * 96)}px`, minHeight: out > 0 ? 2 : 0 }}/>
                        </div>
                        <span className="text-[8px] font-bold text-slate-400">{label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 mt-3">
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-emerald-400"/><span className="text-[10px] text-slate-500">수금</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-rose-400"/><span className="text-[10px] text-slate-500">지출</span></div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── 거래처 통계 탭 (미수금 + 미지급금 + 통계 통합) ── */}
      {mainTab === 'partners' && (() => {
        const getPaid = (s: IssuedStatement) => (s.payments ?? []).reduce((a, p) => a + p.amount, 0);
        const getBalance = (s: IssuedStatement) => s.totalAmount - getPaid(s);

        // ── 전체 거래처 목록 (매출 + 매입 포함) ──
        const currentYear = new Date().getFullYear();
        // 거래처 마스터를 우선 사용 → 전표에 박제된 옛 이름/오타 방지
        const partnerById = new Map(partners.map(p => [p.id, p]));
        // 일부 전표는 partnerName 필드에 literal ID(c-1778504018504 등)가 잘못 저장돼 있음 → ID 형태면 무시
        const looksLikeId = (s: string) => !s || /^(c|p|pt|po|stmt)-\d+/.test(s.trim());
        const resolveName = (id: string) => {
          const master = partnerById.get(id)?.name;
          if (master && !looksLikeId(master)) return master;
          const fromStmt = issuedStatements.find(s => s.partnerId === id && s.partnerName && !looksLikeId(s.partnerName))?.partnerName;
          if (fromStmt) return fromStmt;
          return master || '(이름 미지정)';
        };
        const allClientIds = new Set(issuedStatements.map(s => s.partnerId).filter(Boolean));
        const allClientList = [...allClientIds].map(id => {
          const name = resolveName(id);
          const salesS = issuedStatements.filter(s => s.partnerId === id && s.type === '매출');
          const purchaseS = issuedStatements.filter(s => s.partnerId === id && s.type === '매입');
          const receivable = salesS.reduce((a, s) => a + getBalance(s), 0);
          const payable = purchaseS.reduce((a, s) => a + getBalance(s), 0);
          const yearSales = salesS.filter(s => s.tradeDate.startsWith(String(currentYear))).reduce((a, s) => a + s.totalAmount, 0);
          return { id, name, receivable, payable, yearSales };
        }).filter(c => !recClientSearch || c.name.includes(recClientSearch))
          .sort((a, b) => (b.receivable + b.payable) - (a.receivable + a.payable));

        const selId = statsClientId;
        const selName = selId ? resolveName(selId) : '';
        const selSalesStmts = issuedStatements.filter(s => s.partnerId === selId && s.type === '매출').sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
        const selPurchaseStmts = issuedStatements.filter(s => s.partnerId === selId && s.type === '매입').sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
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
            createdAt: new Date().toISOString(),
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
                          <span>{p.date}{p.createdAt ? ` ${p.createdAt.slice(11,16)}` : ''}</span><span>{p.method}</span>
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

        const generateMonthlySummaryPdf = async () => {
          const month = new Date().toISOString().slice(0, 7);
          const [y, m] = month.split('-');
          const monthStmts = issuedStatements.filter(s => s.tradeDate.startsWith(month));
          const salesTotal = monthStmts.filter(s => s.type === '매출').reduce((a, s) => a + s.totalAmount, 0);
          const purchaseTotal = monthStmts.filter(s => s.type === '매입').reduce((a, s) => a + s.totalAmount, 0);
          const allReceivable = allClientList.filter(c => c.receivable > 0);
          const totalReceivableAll = allReceivable.reduce((a, c) => a + c.receivable, 0);
          const paidThisMonth = allClientList.filter(c => {
            const stmts = issuedStatements.filter(s => s.partnerId === c.id && s.type === '매출');
            return stmts.some(s => (s.payments ?? []).some(p => p.date.startsWith(month)));
          });
          const jsPDF = (await import('jspdf')).default;
          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
          const fmtNum = (n: number) => n.toLocaleString('ko-KR');
          let y2 = 20;
          const line = (text: string, x = 15, size = 10, bold = false) => {
            pdf.setFontSize(size); pdf.setFont('helvetica', bold ? 'bold' : 'normal');
            pdf.text(text, x, y2); y2 += size * 0.5 + 2;
          };
          const rule = () => { pdf.setDrawColor(200); pdf.line(15, y2, 195, y2); y2 += 4; };
          line(`${y}년 ${m}월 정산 요약`, 15, 18, true);
          line(`발행일: ${new Date().toLocaleDateString('ko-KR')}`, 15, 9);
          y2 += 4; rule();
          line('▶ 이번 달 거래 현황', 15, 12, true); y2 += 2;
          line(`  매출 합계:  ${fmtNum(salesTotal)}원`, 15, 10);
          line(`  매입 합계:  ${fmtNum(purchaseTotal)}원`, 15, 10);
          line(`  거래 건수:  ${monthStmts.length}건`, 15, 10);
          y2 += 4; rule();
          line('▶ 미수금 현황 (전체)', 15, 12, true); y2 += 2;
          line(`  총 미수금:  ${fmtNum(totalReceivableAll)}원  (${allReceivable.length}개 거래처)`, 15, 10);
          y2 += 2;
          allReceivable.slice(0, 20).forEach(c => {
            line(`  • ${c.name}:  ${fmtNum(c.receivable)}원`, 18, 9);
          });
          if (allReceivable.length > 20) line(`  ... 외 ${allReceivable.length - 20}개 거래처`, 18, 9);
          y2 += 4; rule();
          line('▶ 이번 달 수금 처리 거래처', 15, 12, true); y2 += 2;
          if (paidThisMonth.length === 0) {
            line('  이번 달 수금 기록 없음', 18, 9);
          } else {
            paidThisMonth.forEach(c => line(`  • ${c.name}`, 18, 9));
          }
          pdf.save(`정산요약_${y}년${m}월.pdf`);
        };

        return (
          <>
            <div className="flex gap-4 min-h-[600px]">
              {/* 좌측: 거래처 목록 */}
              <div className="w-64 shrink-0 flex flex-col gap-3">
                <button
                  onClick={generateMonthlySummaryPdf}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-black rounded-xl transition-colors"
                >
                  <Download size={13} /> 이번 달 정산 요약 PDF
                </button>
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
                          {c.receivable > 0 && (
                            <span
                              onClick={e => { e.stopPropagation(); setReceivableDetailClient({ id: c.id, name: c.name }); }}
                              className="text-[9px] font-black text-blue-500 underline underline-offset-2 cursor-pointer hover:text-blue-700"
                            >미수 {fmtS(c.receivable)}</span>
                          )}
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
                      <div
                        className={`bg-indigo-50 border border-indigo-100 rounded-2xl p-4 ${totalReceivable > 0 ? 'cursor-pointer hover:bg-indigo-100 transition-colors' : ''}`}
                        onClick={() => totalReceivable > 0 && setReceivableDetailClient({ id: selId, name: selName })}
                      >
                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">미수금</p>
                        <p className={`text-xl font-black mt-1 ${totalReceivable > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{totalReceivable > 0 ? fmtS(totalReceivable) : '없음'}</p>
                        {totalReceivable > 0 && <p className="text-[9px] text-indigo-400 mt-0.5">클릭하여 상세 보기</p>}
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

            {/* 미수금 상세 팝업 */}
            {receivableDetailClient && (() => {
              const unpaidStmts = issuedStatements
                .filter(s => s.partnerId === receivableDetailClient.id && s.type === '매출' && getBalance(s) > 0)
                .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
              const detailTotal = unpaidStmts.reduce((a, s) => a + getBalance(s), 0);
              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                  <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                      <div>
                        <h3 className="font-black text-slate-800">{receivableDetailClient.name} · 미수금 상세</h3>
                        <p className="text-sm font-black text-rose-600 mt-0.5">총 {fmt(detailTotal)}원 미수</p>
                      </div>
                      <button onClick={() => setReceivableDetailClient(null)} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400">
                        <X size={18} />
                      </button>
                    </div>
                    <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
                      {unpaidStmts.length === 0 && (
                        <p className="py-12 text-center text-slate-300 text-sm font-bold">미수금 없음</p>
                      )}
                      {unpaidStmts.map(s => {
                        const bal = getBalance(s);
                        const paid = getPaid(s);
                        return (
                          <div key={s.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-black text-slate-700">{s.tradeDate}</span>
                                <span className="text-[10px] font-mono text-slate-400">{s.docNo}</span>
                              </div>
                              <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                                {s.items.slice(0, 2).map(i => i.name).join(', ')}{s.items.length > 2 ? ` 외 ${s.items.length - 2}건` : ''}
                              </p>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                청구 {fmt(s.totalAmount)}원{paid > 0 && ` · 수금 ${fmt(paid)}원`}
                                {' · '}잔액 <span className="text-rose-600 font-black">{fmt(bal)}원</span>
                              </p>
                            </div>
                            <button
                              onClick={() => { setReceivableDetailClient(null); openPayModal(s); }}
                              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black rounded-xl transition-colors"
                            >
                              <CreditCard size={12} /> 입금 처리
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {unpaidStmts.length > 1 && (
                      <div className="px-5 py-3 border-t border-slate-100 shrink-0">
                        <button
                          onClick={() => { setReceivableDetailClient(null); openPayModal(unpaidStmts[0]); }}
                          className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black rounded-xl transition-colors flex items-center justify-center gap-2"
                        >
                          <CreditCard size={14} /> 가장 오래된 전표부터 입금 처리
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 수금/지불 등록 모달 */}
            {showPayModal && payTarget && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4">
                  <h3 className="text-sm font-black text-slate-800">{payTarget.type === '매출' ? '수금 등록 — 미수금 감소' : '지불 등록 — 미지급금 감소'}</h3>
                  <div className="text-xs text-slate-400">{resolveName(payTarget.partnerId)} · {payTarget.tradeDate}</div>
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
        const getStock = (p: Item) => p.stock ?? 0;

        const rows = products
          .map(p => ({ ...p, stock: getStock(p), value: Math.round(getStock(p) * (p.cost ?? 0)) }))
          .filter(p => p.stock > 0 || (p.cost ?? 0) > 0)
          .sort((a, b) => b.value - a.value);

        const totalValue = rows.reduce((acc, p) => acc + p.value, 0);

        // category(영문/구한글) + subtype → 한글 그룹 라벨
        const catLabel = (p: Item): string => {
          const c = p.category as string;
          const sub = (p as any).subtype as string | undefined;
          if (c === 'product' || c === '완제품') return '완제품';
          if (c === 'wip') return '반제품';
          if (c === 'raw') return '원료';
          if (c === 'giftset' || c === '선물세트') return '선물세트';
          if (c === 'goods' || c === '향미유' || c === '고춧가루') return sub || '상품';
          if (c === 'shipping') return '배송';
          if (c === 'submaterial') return sub || '부자재';
          if (['용기', '마개', '라벨', '박스', '테이프'].includes(c)) return c; // 구 한글 부자재
          return '기타';
        };
        const groupOrder = ['완제품', '반제품', '상품', '향미유', '고춧가루', '원료', '선물세트', '배송', '용기', '마개', '라벨', '박스', '테이프', '부자재', '기타'];
        const byLabel = new Map<string, typeof rows>();
        for (const p of rows) {
          const l = catLabel(p);
          if (!byLabel.has(l)) byLabel.set(l, []);
          byLabel.get(l)!.push(p);
        }
        const grouped = [...byLabel.entries()]
          .sort((a, b) => {
            const ai = groupOrder.indexOf(a[0]); const bi = groupOrder.indexOf(b[0]);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          })
          .map(([cat, items]) => ({ cat, items }));

        const currentYm = todayYm;
        const existingSnap = inventorySnapshots.find(s => s.yearMonth === currentYm);
        const sortedSnapshots = [...inventorySnapshots].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

        return (
          <div className="space-y-4">
            {/* 재고총액 + 기말재고 기록 */}
            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 bg-teal-50 border border-teal-200 rounded-2xl px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package size={18} className="text-teal-600" />
                  <span className="text-sm font-black text-teal-700">현재 재고총액 (기말재고액)</span>
                </div>
                <span className="text-2xl font-black text-teal-700">{fmt(totalValue)}원</span>
              </div>
              {onSaveInventorySnapshot && (
                <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex flex-col gap-2 min-w-[220px]">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{currentYm} 기말재고 기록</p>
                  {existingSnap ? (
                    <div className="flex items-center gap-2">
                      <Archive size={14} className="text-teal-500 shrink-0"/>
                      <span className="text-sm font-black text-teal-700">{fmt(existingSnap.value)}원 기록됨</span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">현재 재고총액으로 기록합니다</span>
                  )}
                  <button
                    onClick={() => onSaveInventorySnapshot({
                      yearMonth: currentYm, value: totalValue, recordedAt: new Date().toISOString(),
                      items: rows.map(p => ({ itemId: p.id, name: p.name, category: catLabel(p), qty: p.stock, value: p.value })),
                    })}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all ${existingSnap ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-teal-600 text-white hover:bg-teal-700'}`}>
                    <Archive size={12}/>{existingSnap ? '덮어쓰기' : '기말재고 기록'}
                  </button>
                </div>
              )}
            </div>

            {/* 스냅샷 이력 */}
            {sortedSnapshots.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                  <Clock size={14} className="text-slate-400"/>
                  <span className="text-xs font-black text-slate-600">기말재고 기록 이력</span>
                  <span className="text-[10px] text-slate-400 ml-1">— 전월 기말재고 = 당월 기초재고</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        {['연월', '기말재고액 (= 다음달 기초재고)', '기록일시'].map((h, i) => (
                          <th key={h} className={`px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest ${i === 0 ? '' : 'text-right'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {sortedSnapshots.map(snap => {
                        const hasItems = Array.isArray(snap.items) && snap.items.length > 0;
                        const open = expandedSnapId === snap.id;
                        const snapItems = hasItems ? [...snap.items!].sort((a, b) => b.value - a.value) : [];
                        return (
                          <React.Fragment key={snap.id}>
                          <tr onClick={() => hasItems && setExpandedSnapId(open ? null : snap.id)}
                            className={`transition-colors ${hasItems ? 'cursor-pointer hover:bg-slate-50' : ''} ${snap.yearMonth === currentYm ? 'bg-teal-50/50' : ''}`}>
                            <td className="px-4 py-3 text-xs font-black text-slate-700">
                              {hasItems && <span className="mr-1.5 text-slate-300">{open ? '▾' : '▸'}</span>}
                              {snap.yearMonth}
                              {snap.yearMonth === currentYm && <span className="ml-2 text-[9px] bg-teal-100 text-teal-600 px-1.5 py-0.5 rounded-full">이번달</span>}
                              {hasItems && <span className="ml-2 text-[9px] text-slate-400">{snap.items!.length}품목</span>}
                            </td>
                            <td className="px-4 py-3 text-xs text-right font-black text-teal-700">{fmt(snap.value)}원</td>
                            <td className="px-4 py-3 text-[10px] text-right text-slate-400">{snap.recordedAt.slice(0, 16).replace('T', ' ')}</td>
                          </tr>
                          {open && snapItems.map((it, i) => (
                            <tr key={snap.id + '-' + i} className="bg-slate-50/60">
                              <td className="pl-9 pr-4 py-1.5 text-[11px] text-slate-600">
                                <span className="text-slate-400 text-[9px] mr-1.5">{it.category}</span>{it.name}
                                <span className="text-slate-400 ml-1.5">× {it.qty}</span>
                              </td>
                              <td className="px-4 py-1.5 text-[11px] text-right font-bold text-slate-600">{fmt(it.value)}원</td>
                              <td className="px-4 py-1.5"></td>
                            </tr>
                          ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 카테고리별 테이블 */}
            {grouped.map(({ cat, items }) => {
              const catTotal = items.reduce((acc, p) => acc + p.value, 0);
              const isExpanded = expandedInvCats.has(cat);
              const visibleItems = isExpanded ? items : items.slice(0, 10);
              const hiddenCount = items.length - visibleItems.length;
              return (
                <div key={cat} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-black text-slate-600">{cat} <span className="text-slate-300 font-bold">{items.length}</span></span>
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
                        {visibleItems.map(p => (
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
                  {items.length > 10 && (
                    <button
                      onClick={() => setExpandedInvCats(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n; })}
                      className="w-full py-2.5 text-[11px] font-black text-teal-600 hover:bg-teal-50 border-t border-slate-100 transition-colors"
                    >
                      {isExpanded ? '접기' : `+ ${hiddenCount}개 더 보기`}
                    </button>
                  )}
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

      {/* ── 계정설정 오버레이 ── */}
      {showAccountSettings && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-50 overflow-hidden">
          {/* 헤더 */}
          <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <Wallet size={18} className="text-amber-600"/>
              <span className="text-base font-black text-slate-800">계정 설정</span>
              <span className="text-[11px] text-slate-400">전표 라인별 계정코드 및 고정비 관리</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setShowAddGroup(false); setShowAddCode(v => !v); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${showAddCode ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
                + 계정과목
              </button>
              <button onClick={() => { setShowAddCode(false); setShowAddGroup(v => !v); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${showAddGroup ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
                + 계정그룹
              </button>
              <button onClick={() => setShowAccountSettings(false)}
                className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-600 transition-all">
                <X size={18}/>
              </button>
            </div>
          </div>
          {(showAddCode || showAddGroup) && (
            <div className="bg-white border-b border-slate-200 px-6 py-3 shrink-0">
              {showAddCode && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-black text-slate-500 mr-1">계정과목 추가</span>
                  <input type="text" placeholder="코드 (예: 501)" value={newCodeForm.code}
                    onChange={e => setNewCodeForm(p => ({...p, code: e.target.value}))}
                    className="w-28 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-300"/>
                  <input type="text" placeholder="계정명 (예: 부재료매입)" value={newCodeForm.name}
                    onChange={e => setNewCodeForm(p => ({...p, name: e.target.value}))}
                    className="w-40 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-300"/>
                  <select value={newCodeForm.groupId}
                    onChange={e => setNewCodeForm(p => ({...p, groupId: e.target.value}))}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-300">
                    <option value="">그룹 선택</option>
                    {accountGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <button
                    onClick={async () => {
                      if (!newCodeForm.code.trim() || !newCodeForm.name.trim()) return;
                      await onAddAccountCode?.({ code: newCodeForm.code.trim(), name: newCodeForm.name.trim(), groupId: newCodeForm.groupId || undefined });
                      setNewCodeForm({ code: '', name: '', groupId: '' });
                    }}
                    className="px-4 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-black hover:bg-amber-600 transition-all flex items-center gap-1">
                    <Save size={12}/>추가
                  </button>
                </div>
              )}
              {showAddGroup && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-black text-slate-500 mr-1">계정그룹 추가</span>
                  <input type="text" placeholder="그룹명 (예: 영업외수익)" value={newGroupForm.name}
                    onChange={e => setNewGroupForm(p => ({...p, name: e.target.value}))}
                    className="w-44 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-300"/>
                  <select value={newGroupForm.type}
                    onChange={e => setNewGroupForm(p => ({...p, type: e.target.value as AccountGroup['type']}))}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-300">
                    {GROUP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button
                    onClick={async () => {
                      if (!newGroupForm.name.trim()) return;
                      await onAddAccountGroup?.({ name: newGroupForm.name.trim(), type: newGroupForm.type });
                      setNewGroupForm({ name: '', type: '수익' });
                    }}
                    className="px-4 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-black hover:bg-amber-600 transition-all flex items-center gap-1">
                    <Save size={12}/>추가
                  </button>
                </div>
              )}
            </div>
          )}
          {/* 내용 (스크롤) */}
          <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6 max-w-4xl mx-auto">
            {/* 계정그룹별 코드 목록 */}
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm font-black text-slate-800">계정그룹 · 계정과목</span>
                <span className="text-[10px] text-slate-400">전표 라인별 계정코드가 여기 기준으로 집계됩니다</span>
              </div>
              <div className="divide-y divide-slate-50">
                {accountGroups.map(group => {
                  const codes = accountCodes.filter(c => c.groupId === group.id)
                    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
                  const typeColor: Record<string, string> = {
                    '수익': 'bg-blue-100 text-blue-700',
                    '비용': 'bg-rose-100 text-rose-700',
                    '자산': 'bg-teal-100 text-teal-700',
                    '부채': 'bg-amber-100 text-amber-700',
                    '자본': 'bg-violet-100 text-violet-700',
                  };
                  return (
                    <div key={group.id} className="px-5 py-4">
                      <div className="flex items-center gap-2 mb-3">
                        {editGroupId === group.id ? (
                          <>
                            <select value={editGroupForm.type} onChange={e => setEditGroupForm(f => ({ ...f, type: e.target.value as AccountGroup['type'] }))}
                              className="text-[11px] font-black bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-300">
                              {GROUP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <input autoFocus value={editGroupForm.name} onChange={e => setEditGroupForm(f => ({ ...f, name: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter' && editGroupForm.name.trim()) { onUpdateAccountGroup?.(group.id, { name: editGroupForm.name.trim(), type: editGroupForm.type }); setEditGroupId(null); } if (e.key === 'Escape') setEditGroupId(null); }}
                              className="flex-1 min-w-0 text-sm font-black bg-white border border-slate-200 rounded-lg px-2.5 py-1 outline-none focus:ring-2 focus:ring-blue-300" />
                            <button onClick={() => { if (editGroupForm.name.trim()) onUpdateAccountGroup?.(group.id, { name: editGroupForm.name.trim(), type: editGroupForm.type }); setEditGroupId(null); }}
                              className="text-emerald-500 hover:text-emerald-700"><Check size={15} /></button>
                            <button onClick={() => setEditGroupId(null)} className="text-slate-300 hover:text-slate-500"><X size={15} /></button>
                          </>
                        ) : (
                          <>
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${typeColor[group.type] ?? 'bg-slate-100 text-slate-600'}`}>{group.type}</span>
                            <span className="font-black text-slate-800">{group.name}</span>
                            {onUpdateAccountGroup && (
                              <button onClick={() => { setEditGroupId(group.id); setEditGroupForm({ name: group.name, type: group.type }); }}
                                className="text-slate-200 hover:text-blue-400 transition-colors"><Pencil size={12} /></button>
                            )}
                            {onDeleteAccountGroup && (
                              <button onClick={() => onDeleteAccountGroup(group.id)}
                                className="ml-auto text-slate-200 hover:text-rose-400 transition-colors">
                                <X size={14}/>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {codes.map(ac => (
                          <div key={ac.id} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                            {editCodeId === ac.id ? (
                              <>
                                <input autoFocus value={editCodeForm.code} onChange={e => setEditCodeForm(f => ({ ...f, code: e.target.value }))} placeholder="코드"
                                  className="w-12 text-[11px] font-black bg-white border border-slate-200 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-blue-300" />
                                <input value={editCodeForm.name} onChange={e => setEditCodeForm(f => ({ ...f, name: e.target.value }))} placeholder="계정명"
                                  onKeyDown={e => { if (e.key === 'Enter' && editCodeForm.name.trim()) { onUpdateAccountCode?.(ac.id, { code: editCodeForm.code.trim(), name: editCodeForm.name.trim() }); setEditCodeId(null); } if (e.key === 'Escape') setEditCodeId(null); }}
                                  className="w-24 text-[11px] bg-white border border-slate-200 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-blue-300" />
                                <button onClick={() => { if (editCodeForm.name.trim()) onUpdateAccountCode?.(ac.id, { code: editCodeForm.code.trim(), name: editCodeForm.name.trim() }); setEditCodeId(null); }}
                                  className="text-emerald-500 hover:text-emerald-700"><Check size={12} /></button>
                                <button onClick={() => setEditCodeId(null)} className="text-slate-300 hover:text-slate-500"><X size={12} /></button>
                              </>
                            ) : (
                              <>
                                <span className="text-[11px] font-black text-slate-700">{ac.code}</span>
                                <span className="text-[11px] text-slate-500">{ac.name}</span>
                                {onUpdateAccountCode && (
                                  <button onClick={() => { setEditCodeId(ac.id); setEditCodeForm({ code: ac.code, name: ac.name }); }}
                                    className="text-slate-200 hover:text-blue-400 transition-colors"><Pencil size={11} /></button>
                                )}
                                {onUpdateAccountCode && (
                                  <select
                                    value={ac.groupId ?? ''}
                                    onChange={e => onUpdateAccountCode(ac.id, { groupId: e.target.value })}
                                    className="ml-1 text-[10px] bg-white border border-slate-200 rounded px-1 outline-none focus:ring-1 focus:ring-blue-300">
                                    <option value="">그룹 없음</option>
                                    {accountGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                  </select>
                                )}
                                {onDeleteAccountCode && (
                                  <button onClick={() => onDeleteAccountCode(ac.id)}
                                    className="text-slate-200 hover:text-rose-400 transition-colors">
                                    <X size={12}/>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                        {codes.length === 0 && <span className="text-[11px] text-slate-300">배정된 코드 없음</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 그룹에 배정 안 된 코드 */}
            {(() => {
              const ungrouped = accountCodes.filter(c => !c.groupId || !accountGroups.find(g => g.id === c.groupId))
                .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
              if (ungrouped.length === 0) return null;
              return (
                <div className="bg-white rounded-2xl border border-dashed border-slate-200 px-5 py-4">
                  <p className="text-xs font-black text-slate-400 mb-3">미분류 계정과목</p>
                  <div className="flex flex-wrap gap-2">
                    {ungrouped.map(ac => (
                      <div key={ac.id} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                        {editCodeId === ac.id ? (
                          <>
                            <input autoFocus value={editCodeForm.code} onChange={e => setEditCodeForm(f => ({ ...f, code: e.target.value }))} placeholder="코드"
                              className="w-12 text-[11px] font-black bg-white border border-slate-200 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-blue-300" />
                            <input value={editCodeForm.name} onChange={e => setEditCodeForm(f => ({ ...f, name: e.target.value }))} placeholder="계정명"
                              onKeyDown={e => { if (e.key === 'Enter' && editCodeForm.name.trim()) { onUpdateAccountCode?.(ac.id, { code: editCodeForm.code.trim(), name: editCodeForm.name.trim() }); setEditCodeId(null); } if (e.key === 'Escape') setEditCodeId(null); }}
                              className="w-24 text-[11px] bg-white border border-slate-200 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-blue-300" />
                            <button onClick={() => { if (editCodeForm.name.trim()) onUpdateAccountCode?.(ac.id, { code: editCodeForm.code.trim(), name: editCodeForm.name.trim() }); setEditCodeId(null); }}
                              className="text-emerald-500 hover:text-emerald-700"><Check size={12} /></button>
                            <button onClick={() => setEditCodeId(null)} className="text-slate-300 hover:text-slate-500"><X size={12} /></button>
                          </>
                        ) : (
                          <>
                            <span className="text-[11px] font-black text-slate-700">{ac.code}</span>
                            <span className="text-[11px] text-slate-500">{ac.name}</span>
                            {onUpdateAccountCode && (
                              <button onClick={() => { setEditCodeId(ac.id); setEditCodeForm({ code: ac.code, name: ac.name }); }}
                                className="text-slate-200 hover:text-blue-400 transition-colors"><Pencil size={11} /></button>
                            )}
                            {onUpdateAccountCode && (
                              <select value={ac.groupId ?? ''}
                                onChange={e => onUpdateAccountCode(ac.id, { groupId: e.target.value })}
                                className="ml-1 text-[10px] bg-white border border-slate-200 rounded px-1 outline-none focus:ring-1 focus:ring-blue-300">
                                <option value="">그룹 선택</option>
                                {accountGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                              </select>
                            )}
                            {onDeleteAccountCode && (
                              <button onClick={() => onDeleteAccountCode(ac.id)}
                                className="text-slate-200 hover:text-rose-400 transition-colors">
                                <X size={12}/>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* 고정비 입력 */}
            <CostManager
              fixedCosts={fixedCosts}
              fixedCostTemplates={fixedCostTemplates}
              issuedStatements={issuedStatements}
              accountCodes={accountCodes}
              onAdd={onAddCost}
              onDelete={onDeleteCost}
              onAddTemplate={onAddTemplate}
              onUpdateTemplate={onUpdateTemplate}
              onDeleteTemplate={onDeleteTemplate}
              onGenerateRecurringCosts={onGenerateRecurringCosts}
            />
          </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfitAnalysis;
