
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { matchesSearch } from '../src/shared/hangul';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, BarChart2, DollarSign, Wallet, Users, ChevronLeft, ChevronRight, Save, Search, Package, X, CreditCard, Download, Archive, Clock, Pencil, Check } from 'lucide-react';
import { IssuedStatement, FixedCostEntry, FixedCostTemplate, Partner, PaymentMethod, Item, AccountCode, AccountGroup, AccountGroupPlLine, InventorySnapshot, CashFlowManual, CashEntry, Settlement, CompanyId, openingDocId, companyOf } from '../types';
import PageHeader from './PageHeader';
import CostManager from './CostManager';
import { makeCodeToGroup, computeMonthPLFromJournals, computeCashFlowMonth, computeCashFlowDirect, addMonthStr, SGNA_LEGACY_IDS, COMPUTED_GROUP_IDS } from '../src/features/admin/financials';
import { partnerBalanceFromJournals, partnerCarryOver, allocatePartnerCash, partnerCashParts } from '../src/features/admin/cashLedger';
import { buildJournals } from '../src/shared/buildJournals';
import type { OpeningBalance } from '../src/shared/autoJournal';
import { fetchCollection } from '../src/shared/services/firebaseService';
import { stampFor, rowStamp, issuedMs } from '../src/shared/voucherStamp';
import { vouchersOfMonth, VOUCHER_KIND_CHIP } from '../src/shared/vouchers';

type MainTab = 'analysis' | 'costs' | 'partners' | 'inventory-value' | 'account-settings' | 'cash-flow';

interface ProfitAnalysisProps {
  issuedStatements: IssuedStatement[];
  fixedCostTemplates?: FixedCostTemplate[];
  onAddTemplate?: (data: Omit<FixedCostTemplate, 'id'>) => Promise<void>;
  onUpdateTemplate?: (id: string, data: Partial<FixedCostTemplate>) => Promise<void>;
  onDeleteTemplate?: (id: string) => Promise<void>;
  partners?: Partner[];
  items?: Item[];
  /** 재고평가 단가 — BOM 롤업 제조원가(effectiveCost). 없으면 item.cost 폴백. */
  costOf?: (item: Item) => number;
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
  /**
   * 자금원장 — **손익에 반드시 필요하다.** 급여·이자비용처럼 전표 없이 자금으로만
   * 나가는 비용이 여기에만 있어서, 안 넘기면 그 계정들이 통째로 0이 된다.
   * 옛날엔 `?`라 안 넘겨도 조용히 빈 배열이 됐다 — 손익분석 화면이 실제로 그랬다.
   */
  cashEntries: CashEntry[];
  onAddCashEntry?: (e: CashEntry) => void;
  settlements?: Settlement[];
  /** 보고 있는 회사 — 기초잔액 문서가 회사별로 다르다 */
  companyId?: CompanyId;
  onAddSettlement?: (s: Settlement) => void;
  onDeleteSettlement?: (id: string) => void;
  initialTab?: MainTab;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');
const fmtM = (n: number) => {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (Math.abs(n) >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return String(n);
};

const MONTHS = 12;
/** 실지재고조사법에서 재고 조정이 실리는 비용 계정 — autoJournal의 PURCHASE와 같아야 한다 */
const INVENTORY_EXPENSE_CODE = '500';
// (전표 갈래 색은 shared/vouchers의 VOUCHER_KIND_CHIP 하나를 쓴다)

const ProfitAnalysis: React.FC<ProfitAnalysisProps> = ({ issuedStatements, fixedCostTemplates = [], onAddTemplate, onUpdateTemplate, onDeleteTemplate, partners = [], items: products = [], costOf, onUpdateIssuedStatement, accountGroups: rawAccountGroups = [], accountCodes = [], onUpdateAccountCode, onAddAccountCode, onDeleteAccountCode, onAddAccountGroup, onUpdateAccountGroup, onDeleteAccountGroup, inventorySnapshots = [], onSaveInventorySnapshot, onGenerateRecurringCosts, cashFlowManual = [], onSaveCashFlowManual, cashEntries, onAddCashEntry, settlements = [], onAddSettlement, onDeleteSettlement, companyId = 'taebaek', initialTab }) => {
  // 계산결과 그룹만 숨긴다. **id는 안 갈아끼운다** — 예전엔 판관비를 'ag-sgna'로 바꿔
  // 보여줬는데 설정 화면이 그 id를 그대로 저장해서, 없는 그룹을 가리키는 계정이 생겼다.
  // 그런 계정은 plLine을 못 찾아 손익에서 통째로 빠진다(운임·카드대금이 그랬다).
  const accountGroups = rawAccountGroups.filter(g => !COMPUTED_GROUP_IDS.has(g.id));
  const [mainTab, setMainTab] = useState<MainTab>(initialTab ?? 'analysis');
  // ── 기초잔액(openingBalances/main) — 재무제표 탭과 같은 문서를 쓴다.
  //    이게 없으면 기초재고가 0이라 첫 달 재고조정이 통째로 매입에서 빠져 매출원가가 망가진다. ──
  const [openingDoc, setOpeningDoc] = useState<{ id: string; date: string; amounts: Record<string, number> } | null>(null);
  useEffect(() => {
    fetchCollection<{ id: string; date: string; amounts: Record<string, number> }>('openingBalances')
      .then(rows => setOpeningDoc(rows.find(r => r.id === openingDocId(companyId)) ?? null)).catch(() => {});
  }, [companyId]);
  const opening: OpeningBalance | null = useMemo(() => {
    if (!openingDoc) return null;
    return {
      date: openingDoc.date, capitalAccount: '331',
      lines: Object.entries(openingDoc.amounts).filter(([, v]) => v).map(([accountCode, amount]) => ({ accountCode, amount })),
    };
  }, [openingDoc]);
  // 손익은 기초 다음 달부터 — 기초일(예: 2026-07-31) 이전은 기초잔액에 이미 녹아 있어 또 세면 이중이다
  const openingYm = openingDoc?.date?.slice(0, 7) ?? '';
  const isStandalone = initialTab === 'partners' || initialTab === 'cash-flow';
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [expandedInvCats, setExpandedInvCats] = useState<Set<string>>(new Set());
  const [expandedSnapId, setExpandedSnapId] = useState<string | null>(null);
  const [period, setPeriod] = useState<'1M' | '3M' | '6M' | '1Y' | 'custom'>('custom');
  const [selectedQuarter, setSelectedQuarter] = useState<1|2|3|4>(() => {
    const cm = new Date().getMonth() + 1;
    const avail = ([1,2,3,4] as const).find(q => cm > q * 3);
    return avail ?? 1;
  });
  const [selectedHalf, setSelectedHalf] = useState<1|2>(1);
  /*
   * 기본 기간 — **장부가 시작한 달부터 이번 달까지.**
   *
   * 전에는 1월 ~ `new Date().getMonth()`였다. getMonth()는 0부터라 8월에 7이 나와
   * **이번 달이 빠졌고**, 앞은 기초일(7/31) 이전이라 통째로 잘려서 화면이 전부 0이었다.
   * 유일하게 데이터가 있는 달이 8월인데 그 8월만 안 보였다.
   */
  /**
   * 기간은 **날짜로 고른다** — 전표 화면과 같은 모양. 셈은 달 단위라 고른 날짜가 걸친 달을 쓴다.
   * 월 드롭다운이던 시절엔 같은 해 안에서만 고를 수 있어 12월~1월처럼 해를 넘기지 못했다.
   */
  const [customStart, setCustomStart] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [newCodeForm, setNewCodeForm] = useState({ code: '', name: '', groupId: '' });
  const [newGroupForm, setNewGroupForm] = useState({ name: '', type: '수익' as AccountGroup['type'], plLine: undefined as AccountGroup['plLine'] });
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
    setCfEdit(doc ? { depreciation: doc.depreciation, prepaidInc: doc.prepaidInc, assetBuy: doc.assetBuy, assetSell: doc.assetSell, financeIn: doc.financeIn, debtRepay: doc.debtRepay, openingCash: doc.openingCash, closingCash: doc.closingCash } : {});
  }, [cfMonth, cashFlowManual]);
  // ── 계정그룹/계정과목 인라인 수정 ──
  // 손익 줄 접기 — 기본은 **전부 펼침**. 닫은 것만 기억한다(하나만 열리는 아코디언이 아니다).
  const [closedPlLines, setClosedPlLines] = useState<Set<string>>(new Set());
  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  const [editGroupForm, setEditGroupForm] = useState<{ name: string; type: AccountGroup['type']; plLine: AccountGroup['plLine'] | '' }>({ name: '', type: '비용', plLine: '' });
  const [editCodeId, setEditCodeId] = useState<string | null>(null);
  const [editCodeForm, setEditCodeForm] = useState({ code: '', name: '' });
  const GROUP_TYPES: AccountGroup['type'][] = ['수익', '비용', '자산', '부채', '자본'];
  /**
   * 손익계산서 어느 줄에 설 것인가. **비우면 손익에서 조용히 빠지거나 엉뚱한 줄로 간다** —
   * 비용은 전부 매출원가로 떨어지게 폴백이 걸려 있어, 판관비성 그룹을 만들어도 매출원가에 섞인다.
   * 재무상태표 계정(자산·부채·자본)은 손익에 안 서므로 비워 두는 게 맞다.
   */
  const PL_LINES: { value: AccountGroup['plLine'] | ''; label: string }[] = [
    { value: '', label: '손익 안 씀 (자산·부채·자본)' },
    { value: 'revenue', label: '매출' },
    { value: 'cogs', label: '매출원가' },
    { value: 'sgna', label: '판관비' },
    { value: 'other-income', label: '영업외수익' },
    { value: 'other-expense', label: '영업외비용' },
  ];

  // ── 거래처통계 탭 상태 ──
  const [statsClientId, setStatsClientId] = useState('');
  const [statsYear, setStatsYear] = useState(() => new Date().getFullYear());
  // 거래처 상세를 연 단위로 볼지 월 단위로 볼지. 월이면 '전월이월'이 앞에 붙는다.
  const [statsScope, setStatsScope] = useState<'year' | 'month'>('year');
  const [statsMonth, setStatsMonth] = useState(() => new Date().getMonth() + 1);
  // 미수 ↔ 미지급 상계 (같은 거래처에 받을 돈과 줄 돈이 같이 있을 때)
  const [offsetForm, setOffsetForm] = useState<{ id: string; name: string; max: number; amount: string; date: string } | null>(null);

  // ── 미수금 탭 상태 ──
  const [recClientId, setRecClientId] = useState('');
  const [recClientSearch, setRecClientSearch] = useState('');
  const [showPayModal, setShowPayModal] = useState(false);
  // 수금을 그 전표에 붙일지 — 끄면 오래된 전표부터 자동 배분(선입선출)
  const [pinToStmt, setPinToStmt] = useState(true);
  const [payTarget, setPayTarget] = useState<IssuedStatement | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', date: new Date().toISOString().slice(0, 10), method: '계좌이체' as PaymentMethod, note: '' });

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
  // 연도 목록 — 전표든 자금이든 기록이 있는 해는 다 고를 수 있어야 한다
  const years = useMemo(() => {
    const ys = new Set<number>();
    issuedStatements.forEach(s => ys.add(Number(s.tradeDate.slice(0, 4))));
    cashEntries.forEach(e => { const y = Number((e.date ?? '').slice(0, 4)); if (y) ys.add(y); });
    ys.add(now.getFullYear());
    return [...ys].sort((a, b) => b - a);
  }, [issuedStatements, cashEntries]);

  // 오늘 연월 (미래 달 제외 기준)
  const todayYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonth = now.getMonth() + 1;
  const isCurrentYear = selectedYear === now.getFullYear();
  /*
   * 기간 버튼을 언제 열 것인가 — **시작한 기간은 연다.**
   *
   * 전에는 '끝난 기간만' 열었다(currentMonth > q*3). 8월이면 3분기(7~9월)가 잠겨서,
   * 정작 장부에 있는 달이 7·8월인데 그 기간을 고를 수가 없었다. 연간도 마찬가지로 잠겨 있었다.
   * 달 목록은 어차피 `ym <= todayYm`로 잘리니, 진행 중이면 지금까지만 보이면 된다.
   */
  const quarterAvailable = (q: 1|2|3|4) => !isCurrentYear || currentMonth >= (q - 1) * 3 + 1;
  const halfAvailable = (h: 1|2) => !isCurrentYear || currentMonth >= (h === 1 ? 1 : 7);
  const yearlyAvailable = true;

  // 연도를 바꿨을 때 못 고르는 기간이면 되돌린다 — 판정은 위 *Available 하나만 쓴다.
  // (전에는 여기서 규칙을 한 번 더 적어 둬서 버튼은 열려 있는데 여기서 튕기는 자리가 있었다)
  useEffect(() => {
    if (selectedYear !== now.getFullYear()) return;
    if (period === '3M' && !quarterAvailable(selectedQuarter)) {
      const avail = ([1,2,3,4] as const).find(quarterAvailable);
      if (avail) setSelectedQuarter(avail); else setPeriod('custom');
    }
    if (period === '6M' && !halfAvailable(selectedHalf)) {
      if (halfAvailable(1)) setSelectedHalf(1); else setPeriod('custom');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear]);

  // 기간별 월 목록 계산 — 기초일이 있으면 그 달까지는 잘라낸다(장부가 시작하기 전 달은 손익이 없다)
  const periodMonths = useMemo(() => {
    const cut = (ms: string[]) => openingYm ? ms.filter(ym => ym > openingYm) : ms;
    return cut(rawPeriodMonths());
    function rawPeriodMonths(): string[] {
    //  당월 — 이번 달 한 달. 지난 해를 고르면 그 해 12월(장부가 거기서 끝난다).
    if (period === '1M') {
      return [selectedYear === now.getFullYear() ? todayYm : `${selectedYear}-12`];
    }
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
    // custom: 고른 두 날짜가 걸친 달 전부 — 해를 넘겨도 된다
    const a = customStart.slice(0, 7), b = customEnd.slice(0, 7);
    const [from, to] = a <= b ? [a, b] : [b, a];
    const months: string[] = [];
    let [y, m] = from.split('-').map(Number);
    const cap = to > todayYm ? todayYm : to;      // 앞으로 올 달은 셀 게 없다
    for (let guard = 0; guard < 240; guard++) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      if (ym > cap) break;
      months.push(ym);
      if (++m > 12) { m = 1; y++; }
    }
    return months;
    }
  }, [period, selectedYear, selectedQuarter, selectedHalf, customStart, customEnd, todayYm, openingYm]);

  // ── 월별 실수금·실지불 (결제가 실제로 일어난 달 기준) ──
  // 결제는 자금원장 매칭(settlements)에서만 온다 — 전표에 매다는 옛 경로는 걷어냈다.
  // settlement엔 날짜가 없어서 연결된 cashEntry의 날짜를 쓴다. 자금기록이 지워졌으면 상계로 안 친다
  // (cashLedger.buildPartnerLedger와 같은 규칙).
  const paidByMonth = useMemo(() => {
    const entryById = new Map(cashEntries.map(e => [e.id, e]));
    const stmtById = new Map(issuedStatements.map(s => [s.id, s]));
    const acc = new Map<string, { inc: number; out: number }>();
    const bump = (ym: string, type: string, amt: number) => {
      if (!ym) return;
      const cur = acc.get(ym) ?? { inc: 0, out: 0 };
      if (type === '매출') cur.inc += amt; else cur.out += amt;
      acc.set(ym, cur);
    };
    for (const st of settlements) {
      const s = stmtById.get(st.statementId);
      if (!s || (s.type !== '매출' && s.type !== '매입')) continue;
      const e = entryById.get(st.cashEntryId);
      if (!e) continue;
      bump((e.date ?? '').slice(0, 7), s.type, st.amount);
    }
    return acc;
  }, [issuedStatements, settlements, cashEntries]);

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
  // 손익은 분개에서 파생한다 — 전표든 자금원장이든 분개를 한 번 거치므로 이중계상이 안 생기고,
  // 부가세는 예수금·대급금으로 빠져 손익에 안 섞인다. 재무제표 탭과 같은 소스라 숫자도 일치한다.
  const journalEntries = useMemo(
    () => buildJournals({ statements: issuedStatements, cashEntries, accounts: accountCodes, opening, inventorySnapshots }).entries,
    [issuedStatements, cashEntries, accountCodes, opening, inventorySnapshots]
  );
  const monthPL = useCallback(
    (ym: string) => computeMonthPLFromJournals(ym, journalEntries, accountCodes, codeToGroup),
    [journalEntries, accountCodes, codeToGroup]
  );

  // 월별 집계
  const monthlyData = useMemo(
    () => periodMonths.map(ym => ({ month: `${Number(ym.split('-')[1])}월`, ym, ...monthPL(ym) })),
    [periodMonths, monthPL]
  );

  /**
   * 손익 계정을 **계정과목별로** 쪼갠다 — 손익 숫자와 같은 분개에서 뽑으므로 합계가 어긋나지 않는다.
   *
   * 수익은 대변, 비용은 차변이 정상이라 계정의 normalBalance로 부호를 잡는다.
   * 그래야 매출 환입(차변)이나 비용 정정(대변)이 제대로 깎인다.
   */
  const plByCode = useMemo(() => {
    const ymSet = new Set(monthlyData.map(m => m.ym));
    /*
     * **손익 계정을 전부 먼저 0으로 깔아 둔다.**
     *
     * 분개에 나온 계정만 세면, 그 기간에 안 움직인 계정은 줄 자체가 사라진다.
     * 그러면 "이자비용이 빠진 건가, 0인 건가"를 화면에서 가릴 수 없다 — 실제로
     * 기간이 통째로 잘려 전부 0이 됐을 때 계정이 사라진 것처럼 보였다.
     * 0으로라도 서 있으면 '이 기간엔 없다'가 눈에 보인다.
     */
    const tally = new Map<string, number>();
    for (const a of accountCodes) {
      if (a.type === '비용' || a.type === '수익') tally.set(String(a.code), 0);
    }
    for (const e of journalEntries) {
      if (!ymSet.has((e.date ?? '').slice(0, 7))) continue;
      for (const l of e.lines ?? []) {
        const acc = accountCodes.find(a => String(a.code) === String(l.accountCode));
        if (acc?.type !== '비용' && acc?.type !== '수익') continue;
        const normal = acc.normalBalance ?? (acc.type === '수익' ? 'credit' : 'debit');
        const amt = normal === 'debit' ? (l.debit ?? 0) - (l.credit ?? 0) : (l.credit ?? 0) - (l.debit ?? 0);
        if (!amt) continue;
        tally.set(String(l.accountCode), (tally.get(String(l.accountCode)) ?? 0) + amt);
      }
    }
    return [...tally.entries()]
      .map(([code, amount]) => {
        const acc = accountCodes.find(a => String(a.code) === String(code));
        const g = codeToGroup(code);
        return { code, name: acc?.name ?? code, amount, plLine: g?.plLine, groupId: g?.id, groupName: g?.name };
      })
      .sort((a, b) => b.amount - a.amount);   // 0인 줄은 자연히 아래로 모인다
  }, [journalEntries, accountCodes, codeToGroup, monthlyData]);

  /**
   * 그룹별로 묶는다 — **묶는 근거는 계정그룹 하나뿐이다.**
   * 예전엔 여기 계정번호를 박아 뒀는데(원재료 500·501·503·505), 계정을 새로 만들면
   * 목록을 고치기 전까지 소계에서 조용히 빠졌다. 이제 계정에 그룹만 붙이면 따라온다.
   */
  const plByGroup = useMemo(() => {
    const m = new Map<string, { name: string; plLine?: string; amount: number; rows: typeof plByCode }>();
    for (const r of plByCode) {
      const key = r.groupId ?? '(그룹없음)';
      const cur = m.get(key) ?? { name: r.groupName ?? '그룹 없음', plLine: r.plLine, amount: 0, rows: [] };
      cur.amount += r.amount;
      cur.rows.push(r);
      m.set(key, cur);
    }
    return [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.amount - a.amount);
  }, [plByCode]);

  // 기간 합계 — 매출원가는 재고 증감 반영(기초 + 매입 − 기말). 스냅샷 있을 때만 조정.
  const summary = useMemo(() => {
    const base = monthlyData.reduce(
      (a, m) => ({
        sales: a.sales + m.sales,
        purchases: a.purchases + m.cogs,   // m.cogs = 당기 매입액
        sgna: a.sgna + m.sgna,
        otherIncome: a.otherIncome + m.otherIncome,
        otherExpense: a.otherExpense + m.otherExpense,
      }),
      { sales: 0, purchases: 0, sgna: 0, otherIncome: 0, otherExpense: 0 }
    );
    // 재고 조정은 분개(journalizeInventory)가 이미 매출원가에 반영했다 — 여기서 또 빼면 이중이다.
    const cogs = base.purchases;
    const grossProfit = base.sales - cogs;
    const operatingProfit = grossProfit - base.sgna;
    const netIncome = operatingProfit + base.otherIncome - base.otherExpense;
    return { ...base, cogs, grossProfit, operatingProfit, netIncome };
  }, [monthlyData, openingSnapshot, closingSnapshot]);

  // 월별 상세 표의 합계행은 summary(= 화면에 뜬 달들의 합)를 그대로 쓴다.
  // 예전엔 연도 전체를 전표에서 다시 더해, 표에 안 보이는 달과 재고조정이 빠져 줄 합과 안 맞았다.

  const pct = (curr: number, prev: number | undefined) => {
    if (!prev || prev === 0) return null;
    return Math.round((curr - prev) / Math.abs(prev) * 100);
  };


  const codeName = useMemo(() => new Map(accountCodes.map(c => [c.code, c.name])), [accountCodes]);
  /**
   * 그 달 전표 — **모으는 자리는 shared/vouchers 하나뿐이다.**
   * 화면마다 두 컬렉션을 각자 모으면 언젠가 한쪽을 빠뜨린다(실제로 그래서 급여·이자가 0이었다).
   */
  const monthVouchers = useCallback(
    (ym: string) => vouchersOfMonth(issuedStatements, cashEntries, ym, companyId),
    [issuedStatements, cashEntries, companyId],
  );

  // (cogsByCode 삭제: 전표만 보고 매출원가를 따로 세던 곁길. 화면에 안 그려졌고,
  //  자금전표가 빠져 손익과 어긋나는 값이었다. 집계는 분개 하나로만 한다.)

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
        {/* 기간 갈래를 **왼쪽 맨 앞**에 둔다 — 화면이 어느 기간인지가 먼저 읽혀야 한다.
            제목에 '2026년 1월~8월'을 또 쓰지 않는다. 고른 값이 곧 제목이라 두 번 말하는 것이다. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
            {([['1M','당월'],['3M','분기'],['6M','반기'],['1Y','당년'],['custom','기간']] as const).map(([val,label]) => {
              const disabled =
                (val === '1Y' && !yearlyAvailable) ||
                (val === '6M' && !halfAvailable(1) && !halfAvailable(2)) ||
                (val === '3M' && !([1,2,3,4] as const).some(q => quarterAvailable(q)));
              return (
                <button key={val}
                  disabled={disabled}
                  onClick={() => !disabled && setPeriod(val)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${
                    disabled ? 'text-slate-300 cursor-not-allowed' :
                    period === val ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                  }`}>
                  {label}
                </button>
              );
            })}
          </div>
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
          {period === 'custom' && (
            /* 날짜로 고른다 — 전표 화면과 같은 모양. 셈은 달 단위라 고른 날짜가 걸친 달을 쓴다. */
            <div className="flex items-center gap-1">
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-black outline-none cursor-pointer"/>
              <span className="text-slate-400 text-xs font-black">~</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-black outline-none cursor-pointer"/>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setShowAccountSettings(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-black transition-all border border-amber-200"
          >
            <Wallet size={13}/>계정 설정
          </button>
        </div>
      </div>

      {/*
        손익계산서 — **한 줄기로 위에서 아래로.** 매출에서 시작해 빼 나가며 이익이 남는다.
        예전엔 카드 3개 → 매출원가 상세 → 비용 상세 → 영업이익 순이라, 결과를 보려면
        상세를 지나쳐 내려가야 했고 비용 상세 안에 판관비·영업외가 다 들어 있어
        그 아래 영업이익과 순서가 꼬였다. 이제 줄을 누르면 그 자리에서 펼쳐진다.
      */}
      {(() => {
        const pct = (v: number) => summary.sales > 0 ? `${Math.round(v / summary.sales * 100)}%` : '';
        const groupsOf = (...lines: string[]) => plByGroup.filter(g => lines.includes(g.plLine ?? ''));

        /** 펼쳐지는 줄 — 그룹 소계 밑에 계정과목 */
        const TONE = { green: 'text-emerald-600', red: 'text-rose-600' } as const;
        const Line = ({ label, amount, lines, sign, keyName, tone }: {
          label: string; amount: number; lines: string[]; sign: '+' | '−'; keyName: string; tone: keyof typeof TONE;
        }) => {
          const gs = groupsOf(...lines);
          const open = !closedPlLines.has(keyName);
          const toggle = () => setClosedPlLines(prev => {
            const next = new Set(prev);
            if (next.has(keyName)) next.delete(keyName); else next.add(keyName);
            return next;
          });
          return (
            <div className="border-b border-slate-100">
              <button onClick={toggle}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50/70 transition-colors text-left">
                <span className="flex items-center gap-1.5 text-sm font-bold text-slate-600">
                  <ChevronRight size={13} className={`text-slate-300 transition-transform ${open ? 'rotate-90' : ''}`} />
                  <span className="text-slate-300 w-3">{sign}</span>{label}
                </span>
                <span className={`text-base font-black tabular-nums ${TONE[tone]}`}>
                  {fmt(amount)}<span className="text-[10px] font-bold text-slate-400 ml-1.5 w-9 inline-block text-right">{pct(Math.abs(amount))}</span>
                </span>
              </button>
              {open && (
                <div className="bg-slate-50/60 px-5 pb-3 pt-1 space-y-2">
                  {gs.length === 0 && <p className="text-[11px] font-bold text-slate-300 py-2">이 줄에 붙은 계정그룹이 없습니다 — 계정 설정에서 손익 줄을 정해 주세요.</p>}
                  {gs.map(g => (
                    <div key={g.id}>
                      <div className="flex items-center justify-between text-[11px] font-black text-slate-600">
                        <span>{g.name}{!g.plLine && <span className="ml-1.5 text-[9px] text-amber-500">손익 줄 없음</span>}</span>
                        <span className="tabular-nums">{fmt(g.amount)}</span>
                      </div>
                      {g.rows.map(r => (
                        <React.Fragment key={r.code}>
                          <div className={`flex items-center justify-between pl-3 text-[11px] ${r.amount ? 'text-slate-400' : 'text-slate-300'}`}>
                            <span><span className="text-slate-300 mr-1.5 tabular-nums">{r.code}</span>{r.name}</span>
                            <span className="tabular-nums">{fmt(r.amount)}</span>
                          </div>
                          {/* 재고 조정은 이 계정 **안에** 실려 있다(분개: (차)146 재고자산 /(대)500 원료매입).
                              그래서 나란히가 아니라 이 줄 밑에 들여써서 어떻게 그 금액이 나왔는지 보여준다.
                              따로 빼 놓으면 매출원가에서 또 빼는 것처럼 읽힌다. */}
                          {r.code === INVENTORY_EXPENSE_CODE && (openingSnapshot || closingSnapshot) && (
                            <div className="pl-8 pb-1 space-y-0.5">
                              <div className="flex items-center justify-between text-[11px] text-slate-400">
                                <span>당기매입</span>
                                <span className="tabular-nums">{fmt(r.amount + ((closingSnapshot?.value ?? 0) - (openingSnapshot?.value ?? 0)))}</span>
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-slate-400">
                                <span>기초재고 (+)</span>
                                <span className="tabular-nums">{openingSnapshot ? fmt(openingSnapshot.value) : '실사 없음'}</span>
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-slate-400">
                                <span>기말재고 (−)</span>
                                <span className="tabular-nums">{closingSnapshot ? fmt(-closingSnapshot.value) : '실사 없음'}</span>
                              </div>
                            </div>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        };

        /** 남는 줄 — 소계. 굵게(strong)는 영업이익·당기순이익. */
        /**
         * 소계 줄 — 매출총이익·영업이익·당기순이익은 **셋 다 같은 급**이라 같은 모양으로 둔다.
         * 전엔 뒤 둘에만 회색 배경을 줬는데 그럴 근거가 없었다. 구분은 '='와 굵기로 충분하다.
         * 색은 안 쓴다: 초록·빨강은 더하는 줄·빼는 줄을 가리는 표시라, 결과에까지 칠하면 뜻이 흐려진다.
         */
        const Result = ({ label, amount }: { label: string; amount: number }) => (
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/70">
            <span className="text-sm font-black text-slate-800 pl-[18px]"><span className="text-slate-300 mr-1.5">=</span>{label}</span>
            <span className="text-right">
              <span className="text-base font-black tabular-nums text-slate-900">{fmt(amount)}</span>
              <span className="text-[10px] font-bold text-slate-400 ml-1.5 w-9 inline-block text-right">{pct(amount)}</span>
            </span>
          </div>
        );

        const other = summary.otherIncome - summary.otherExpense;
        return (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {/* 고른 기간이 통째로 장부 시작 이전이면 모든 줄이 0이 된다.
                아무 말 없이 0만 뜨면 '집계가 깨졌나' 싶다 — 왜 0인지 여기서 밝힌다. */}
            {periodMonths.length === 0 && (
              <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 text-[11px] font-bold text-amber-700 leading-snug">
                고른 기간이 <b>장부 시작({openingDoc?.date ?? '기초일'}) 이전</b>이라 잡힐 게 없습니다.
                그 이전 실적은 기초잔액에 녹아 있어 또 세면 이중이 됩니다 —
                기간을 <b>{openingYm ? `${Number(openingYm.slice(5))+1}월` : '장부 시작 다음 달'}</b> 이후로 잡으세요.
              </div>
            )}
            <Line label="매출" amount={summary.sales} lines={['revenue']} sign="+" keyName="revenue" tone="green" />
            <Line label="매출원가" amount={summary.cogs} lines={['cogs']} sign="−" keyName="cogs" tone="red" />
            <Result label="매출총이익" amount={summary.grossProfit} />
            <Line label="판매비와관리비" amount={summary.sgna} lines={['sgna']} sign="−" keyName="sgna" tone="red" />
            <Result label="영업이익" amount={summary.operatingProfit} />
            <Line label="기타손익 (영업외)" amount={other} lines={['other-income', 'other-expense']} sign={other >= 0 ? '+' : '−'} keyName="other" tone="green" />
            <Result label="당기순이익" amount={summary.netIncome} />
          </div>
        );
      })()}

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
                const isEmpty = m.sales === 0 && m.cogs === 0 && m.sgna === 0;
                const isExpanded = expandedMonth === m.ym;

                /*
                 * 그 달 **전표 전체** — 거래명세서와 자금전표를 한 줄기로 세운다.
                 * 전에는 issuedStatements만 봐서 급여·이자·리스료처럼 자금원장에만 있는
                 * 전표가 목록에서 통째로 빠졌다. 위 손익 숫자에는 들어 있는데 내역엔 없으니
                 * 금액이 어디서 나왔는지 대조할 수가 없었다.
                 */
                const monthStmts = monthVouchers(m.ym);

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
                      <td className="px-4 py-3 text-xs text-right text-slate-500">{m.sgna ? fmt(m.sgna) : '-'}</td>
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
                            ) : monthStmts.map(v => (
                              <div key={v.id} className="flex items-center gap-3 text-[11px]">
                                <span className={`shrink-0 w-11 text-center px-1.5 py-0.5 rounded-full font-black text-[9px] ${VOUCHER_KIND_CHIP[v.kind]}`}>{v.kind}</span>
                                <span className="text-slate-600 shrink-0">{v.date}</span>
                                <span className="font-bold text-slate-800 truncate">{v.partnerName ?? '(거래처 없음)'}</span>
                                <span className="text-slate-400 truncate">{[v.docNo, v.memo].filter(Boolean).join(' · ')}</span>
                                <span className="ml-auto font-black text-slate-700 shrink-0 tabular-nums">{fmt(v.amount)}원</span>
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
                <td className="px-4 py-3 text-xs text-right font-black text-blue-700">{fmt(summary.sales)}</td>
                <td className="px-4 py-3 text-xs text-right font-black text-amber-700">{fmt(summary.cogs)}</td>
                <td className="px-4 py-3 text-xs text-right font-black text-slate-700">{fmt(summary.grossProfit)}</td>
                <td className="px-4 py-3 text-xs text-right font-black text-slate-500">{fmt(summary.sgna)}</td>
                <td className={`px-4 py-3 text-xs text-right font-black ${summary.operatingProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(summary.operatingProfit)}</td>
                <td className="px-4 py-3 text-xs text-right font-black text-slate-500">
                  {summary.sales > 0 ? `${Math.round(summary.operatingProfit / summary.sales * 100)}%` : '-'}
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
        // 직접법 — 분개에서 현금계정이 실제로 움직인 것만. 추정이 없어 통장 증감과 그대로 맞는다.
        const directOf = (ym: string) => computeCashFlowDirect(ym, journalEntries, accountCodes, codeToGroup);
        const computeCF = (ym: string) => directOf(ym);
        const baseline = [...cashFlowManual].filter(m => m.openingCash != null || m.closingCash != null).map(m => m.month).sort()[0];
        const openingOf = (ym: string): number => {
          if (!baseline || ym <= baseline) return manualOf(ym).openingCash ?? 0;
          let cash = manualOf(baseline).openingCash || 0, cur = baseline;
          while (cur < ym) {
            const mc = manualOf(cur).closingCash;   // 그 달 실제 잔액 입력했으면 그걸로 재기준(이월오차 리셋)
            cash = mc != null ? mc : cash + computeCF(cur).net;
            cur = addMonth(cur, 1);
          }
          return cash;
        };
        const months = cfMode === 'month' ? [cfMonth] : periodMonths;
        const direct = months.map(directOf);
        const D = (sel: (r: typeof direct[number]) => number) => direct.reduce((a, r) => a + sel(r), 0);
        const dLines = (() => {
          const m = new Map<string, { code: string; section: string; inflow: number; outflow: number }>();
          for (const r of direct) for (const l of r.lines) {
            const cur = m.get(l.accountCode) ?? { code: l.accountCode, section: l.section, inflow: 0, outflow: 0 };
            cur.inflow += l.inflow; cur.outflow += l.outflow; m.set(l.accountCode, cur);
          }
          return [...m.values()].sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow));
        })();
        const nameOfCode = (c: string) => accountCodes.find(a => a.code === c)?.name ?? c;
        const dSection = (sec: string) => dLines.filter(l => l.section === sec);
        const dRow = (l: { code: string; inflow: number; outflow: number }) => {
          const net = l.inflow - l.outflow;
          return (
            <div key={l.code} className="px-5 py-2 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">{l.code} {nameOfCode(l.code)}</span>
              <span className={`text-xs font-black tabular-nums ${net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {net >= 0 ? '+' : ''}{fmt(net)}원
              </span>
            </div>
          );
        };
        const computedNet = D(r => r.net);   // 분개에서 실제로 움직인 현금
        const opening = months.length ? openingOf(months[0]) : 0;
        // 월말 실제 현금·예금 입력값(월별 모드) — 있으면 기말현금·총현금흐름을 이 값 기준으로
        const actualClosing = cfMode === 'month' ? (manualOf(cfMonth).closingCash ?? null) : null;
        const closing = actualClosing != null ? actualClosing : opening + computedNet;
        const netTotal = closing - opening;                 // 총현금흐름 = 기말 − 기초
        const unclassified = netTotal - computedNet;         // 기타(미분류) = 실제 − 계산
        const cfLabel = cfMode === 'month'
          ? `${Number(cfMonth.split('-')[0])}년 ${Number(cfMonth.split('-')[1])}월`
          : (period === '1Y' ? `${selectedYear}년 연간` : period === '3M' ? `${selectedYear}년 ${selectedQuarter}분기` : period === '6M' ? `${selectedYear}년 ${selectedHalf === 1 ? '상반기' : '하반기'}` : `${customStart} ~ ${customEnd}`);
        const editable = cfMode === 'month';
        const isBaselineMonth = !baseline || cfMonth <= baseline;
        const mVal = (f: keyof CashFlowManual) => (cfEdit[f] != null ? Number(cfEdit[f]).toLocaleString() : '');
        const setM = (f: keyof CashFlowManual, v: string) => { const n = v.replace(/[^\d]/g, ''); setCfEdit(prev => ({ ...prev, [f]: n === '' ? undefined : Number(n) })); };
        const saveCf = () => onSaveCashFlowManual?.(cfMonth, cfEdit);
        const cfLine = (label: string, amount: number, sign: '+' | '-' | '±', field?: keyof CashFlowManual) => {
          // '±'(양방향) 라인은 실제 금액 부호로 색·기호 결정 — +면 초록, −면 빨강
          const eff = sign === '±' ? (amount > 0 ? '+' : amount < 0 ? '-' : '±') : sign;
          return (
          <div className="flex items-center justify-between px-6 py-2.5">
            <span className="text-xs text-slate-600">
              <span className={`mr-2 text-[10px] font-black ${eff === '+' ? 'text-emerald-500' : eff === '-' ? 'text-rose-400' : 'text-slate-400'}`}>({eff})</span>{label}
            </span>
            {editable && field ? (
              <input value={mVal(field)} onChange={e => setM(field, e.target.value)} inputMode="numeric" placeholder="0"
                className="w-32 border border-slate-200 rounded-lg px-2 py-1 text-xs font-black text-right outline-none focus:ring-2 focus:ring-blue-300" />
            ) : (
              <span className={`text-xs font-black tabular-nums ${amount === 0 ? 'text-slate-300' : eff === '+' ? 'text-emerald-700' : eff === '-' ? 'text-rose-700' : 'text-slate-700'}`}>{amount === 0 ? '—' : fmt(amount) + '원'}</span>
            )}
          </div>
          );
        };

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
                  return (
                    /* 손익분석과 같은 모양 — 날짜로 고른다 */
                    <div className="flex items-center gap-1">
                      <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                        className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-black outline-none cursor-pointer"/>
                      <span className="text-slate-400 text-xs font-black">~</span>
                      <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                        className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-black outline-none cursor-pointer"/>
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

            {/* 현금흐름표 (직접법) — 분개에서 현금이 실제로 움직인 것만. 추정 없음. */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-4">
              <div className="px-5 py-3 bg-slate-800 flex items-center justify-between">
                <span className="text-sm font-black text-white">직접법 현금흐름 <span className="text-[10px] font-bold text-slate-400 ml-1">분개 기준 · 추정 없음</span></span>
                <span className={`text-sm font-black tabular-nums ${D(r => r.net) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {D(r => r.net) >= 0 ? '+' : ''}{fmt(D(r => r.net))}원
                </span>
              </div>
              {([['operating', '영업활동', D(r => r.op)], ['investing', '투자활동', D(r => r.inv)], ['financing', '재무활동', D(r => r.fin)]] as const).map(([sec, label, total]) => (
                <React.Fragment key={sec}>
                  <div className="px-5 py-2.5 bg-slate-50 border-y border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-black text-slate-600">{label}</span>
                    <span className={`text-xs font-black tabular-nums ${total > 0 ? 'text-emerald-600' : total < 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                      {total === 0 ? '—' : `${total > 0 ? '+' : ''}${fmt(total)}원`}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {dSection(sec).length ? dSection(sec).map(dRow)
                      : <div className="px-5 py-2 text-[11px] text-slate-300 font-bold">내역 없음</div>}
                  </div>
                </React.Fragment>
              ))}
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
                <span className="text-sm font-black text-blue-800">기말현금 {editable && <span className="text-[10px] font-bold text-blue-400">· 실제 현금·예금 직접 입력(선택)</span>}</span>
                {editable ? (
                  <input value={mVal('closingCash')} onChange={e => setM('closingCash', e.target.value)} inputMode="numeric" placeholder={fmt(opening + computedNet)}
                    className="w-40 border border-blue-300 rounded-lg px-2 py-1.5 text-base font-black text-right text-blue-700 outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
                ) : (
                  <span className="text-base font-black text-blue-700 tabular-nums">{fmt(closing)}원</span>
                )}
              </div>
            </div>

            {editable ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[11px] text-slate-400 max-w-md">투자·재무·감가상각은 <b>전표(비용/자금)로 기록하면 자동 집계</b>돼요(계정과목의 자산/부채/자본 그룹으로 분류). <b>월말 실제 현금·예금을 '기말현금'에 직접 입력</b>하면 그 값으로 재기준되고(이월 오차 리셋) 다음 달 기초로 이어져요. 안 넣으면 자동계산. 계산과 차이는 '기타(미분류)'로 표시.</p>
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
                    const spendOf = (m: string) =>
                      (paidByMonth.get(m)?.out ?? 0);
                    const inc = paidByMonth.get(ym)?.inc ?? 0;
                    const out = spendOf(ym);
                    const barMax = Math.max(...periodMonths.map(m => Math.max(paidByMonth.get(m)?.inc ?? 0, spendOf(m))), 1);
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
        // 수금·지불은 전표에 붙이지 않는다 — 거래처로 오간 채권·채무(108/251) 자금을 거래처 단위로 뺀다.
        // 전표별 매칭을 안 쓰므로 "어느 청구서를 갚았나"가 어긋날 자리가 없다(분개 108·251 잔액과 같은 규칙).
        const paidByPartner = new Map<string, { in: number; out: number }>();
        for (const e of cashEntries) {
          if (!e.partnerId) continue;
          const parts = (e.lines ?? []).filter(l => l.accountCode && l.amount > 0);
          const list = parts.length
            ? parts.map(l => ({ c: l.accountCode, a: l.amount }))
            : (e.accountCode ? [{ c: e.accountCode, a: e.amount }] : []);
          for (const p of list) {
            if (p.c !== '108' && p.c !== '251') continue;
            const cur = paidByPartner.get(e.partnerId) ?? { in: 0, out: 0 };
            if (p.c === '108') cur.in += e.dir === '입금' ? p.a : -p.a;
            else cur.out += e.dir === '출금' ? p.a : -p.a;
            paidByPartner.set(e.partnerId, cur);
          }
        }
        /**
         * 전표 한 장에 남은 금액 — 사람이 지정한 매칭 먼저, 나머지는 오래된 전표부터.
         * 규칙은 cashLedger.allocatePartnerCash 한 곳에 있다(전표 화면도 같은 것을 쓴다).
         */
        const openByStmt = (() => {
          const out = new Map<string, number>();
          const keys = new Set(issuedStatements
            .filter(s => s.type === '매출' || s.type === '매입')
            .map(s => `${s.partnerId}|${s.type}`));
          for (const key of keys) {
            const [pid, type] = key.split('|');
            for (const [id, open] of allocatePartnerCash(pid, type as '매출' | '매입', issuedStatements, cashEntries, settlements)) {
              out.set(id, open);
            }
          }
          return out;
        })();
        const getBalance = (s: IssuedStatement) => openByStmt.get(s.id) ?? s.totalAmount;
        /** 거래처 잔액 — 미수(매출) / 미지급(매입) */
        const partnerLeft = (partnerId: string, type: '매출' | '매입') =>
          partnerBalanceFromJournals(partnerId, type, journalEntries);

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
          // 거래처 잔액 기준 — 전표별 매칭이 아니라 "이 거래처에 얼마 남았나"
          const receivable = partnerLeft(id, '매출');
          const payable = partnerLeft(id, '매입');
          const yearSales = salesS.filter(s => s.tradeDate.startsWith(String(currentYear))).reduce((a, s) => a + s.totalAmount, 0);
          return { id, name, receivable, payable, yearSales };
        //  가나다순 — 잔액 큰 순으로 두니 찾는 거래처가 어디 있는지 매번 훑어야 했다.
        }).filter(c => matchesSearch(c.name, recClientSearch))
          .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

        const selId = statsClientId;
        const selName = selId ? resolveName(selId) : '';

        // ── 기간 ──────────────────────────────────────────────────────────
        // 연 보기는 'YYYY', 월 보기는 'YYYY-MM' 접두사 하나로 다 거른다.
        const periodPrefix = statsScope === 'month'
          ? `${statsYear}-${String(statsMonth).padStart(2, '0')}`
          : String(statsYear);
        const periodStart = statsScope === 'month' ? `${periodPrefix}-01` : `${statsYear}-01-01`;
        const periodLabel = statsScope === 'month' ? `${statsYear}년 ${statsMonth}월` : `${statsYear}년`;

        /**
         * 기초전표는 거래가 아니라 개시 잔액이다 — 늘 이월로만 센다.
         * 날짜가 2026-07-31이라 그냥 두면 7월 매출 5,600만으로 보인다.
         */
        const isOpening = (st: IssuedStatement) => String(st.docNo ?? '').includes('기초');

        /**
         * 전월(전년)이월 — **저장하지 않고 계산한다.**
         * 기간 시작 이전의 전표 합계에서 그 이전 수금을 뺀 것. 전표가 유일한 근거라
         * 원장을 고치면 이월도 저절로 따라온다(따로 적어 두면 어긋날 자리가 생긴다).
         */
        /**
         * 전월(전년)이월 — **기간 시작 전까지의 분개 108·251 잔액.**
         *
         * 전에는 전표를 `type`으로 거르고 자금을 따로 뺐다. 두 군데서 세니 규칙이 갈렸고,
         * 기초 전표를 대체로 옮기는 순간 type 필터에서 빠져 이월이 통째로 사라졌다.
         * 채권·채무가 움직인 곳은 분개의 108·251 줄뿐이다 — 거기 하나만 본다.
         * 잔액(partnerBalanceFromJournals)과 같은 근거라 화면끼리 저절로 맞는다.
         */
        /**
         * **기초 전표는 날짜가 기간 안이라도 이월로 센다.**
         *
         * 장부는 2026-07-31 기초로 시작한다. 연 2026을 보면 이월 조건(`날짜 < 2026-01-01`)에
         * 걸리는 분개가 하나도 없어 이월이 0이 되는데, 기초 전표는 `isOpening`으로
         * **기간매출에서도 빼고 있었다.** 그래서 개시잔액이 이월에도·기간발생에도 안 들어가
         * 통째로 사라졌다 — 거래처 44곳에서 미수가 139,859,460원 모자라게 보였다.
         * (목록은 전기간 분개 잔액이라 제 값이었고, 상세만 어긋났다)
         */
        const openingStmtIds = new Set(
          issuedStatements.filter(st => st.partnerId === selId && isOpening(st)).map(st => st.id));
        const carryOver = (type: '매출' | '매입') =>
          selId ? partnerCarryOver(selId, type, journalEntries, periodStart, openingStmtIds) : 0;
        const carrySale = carryOver('매출');
        const carryBuy = carryOver('매입');
        /**
         * 이월 라벨 — **기간 앞의 실제 근거**를 적는다.
         *
         * 기초전표(2026-07-31-기초)는 장부 개시잔액이라 늘 이월로 세는데, 날짜는 2026년 안에 있다.
         * 그래서 연 2026을 보면서 `statsYear - 1`로 라벨을 만들면 있지도 않은 '2025년말'이 찍힌다.
         * 이월이 그 기초로 이뤄져 있으면(= 기초 날짜가 이 기간 안이면) '기초이월'이라고 적는다.
         */
        const openingInPeriod = !!selId && issuedStatements.some(st =>
          st.partnerId === selId && isOpening(st) && st.tradeDate.startsWith(periodPrefix));
        const carryLabel = openingInPeriod ? '기초이월' : statsScope === 'month' ? '전월이월' : '전년이월';
        const carryHint = openingInPeriod
          ? '장부 개시잔액'
          : statsScope === 'month'
            ? `${statsMonth === 1 ? '전년말' : `${statsMonth - 1}월말`}`
            : `${statsYear - 1}년말`;
        const selSalesStmts = issuedStatements.filter(s => s.partnerId === selId && s.type === '매출').sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
        const selPurchaseStmts = issuedStatements.filter(s => s.partnerId === selId && s.type === '매입').sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
        // 기초전표는 거래가 아니므로 기간 매출에서 뺀다 — 위 이월에 이미 들어가 있다
        const yearSalesStmts = selSalesStmts.filter(s => !isOpening(s) && s.tradeDate.startsWith(periodPrefix));
        const yearSalesTotal = yearSalesStmts.reduce((a, s) => a + s.totalAmount, 0);
        const totalReceivable = selId ? partnerLeft(selId, '매출') : 0;
        const totalPayable = selId ? partnerLeft(selId, '매입') : 0;
        const months = Array.from({ length: 12 }, (_, i) => {
          const m = String(i + 1).padStart(2, '0');
          const rows = selSalesStmts.filter(s => !isOpening(s) && s.tradeDate.startsWith(`${statsYear}-${m}`));
          return { label: `${i + 1}월`, amount: rows.reduce((s, r) => s + r.totalAmount, 0), count: rows.length };
        });
        // ── 이 거래처의 자금 움직임(108 채권 / 251 채무) — 요약·차트·타임라인이 같이 쓴다 ──
        //   잔액이 이 합계를 빼서 나오므로, 화면 어디서든 같은 근거를 본다.
        const partnerCash = selId ? cashEntries
          .filter(e => e.partnerId === selId)
          .flatMap(e => partnerCashParts(e).map(p => ({
            id: `${e.id}-${p.code}`, date: e.date ?? '',
            // 그날 안의 자리 — 날짜만으로는 소급 기록이 앞에 끼어든다
            ts: rowStamp(e.date ?? '', e.createdAt),
            kind: (p.code === '108' ? '수금' : '지불') as '수금' | '지불',
            signed: p.reduce,   // 양수면 그만큼 줄었다(수금·지불·상계)
            note: p.note || e.note || '',
          }))) : [];
        const yearCash = partnerCash.filter(p => p.date.startsWith(periodPrefix));
        const yearCollected = yearCash.filter(p => p.kind === '수금').reduce((a, p) => a + p.signed, 0);
        const yearPaidOut = yearCash.filter(p => p.kind === '지불').reduce((a, p) => a + p.signed, 0);
        const yearPurchaseStmts = selId
          ? issuedStatements.filter(s => s.partnerId === selId && s.type === '매입' && !isOpening(s) && s.tradeDate.startsWith(periodPrefix))
          : [];
        const yearPurchaseTotal = yearPurchaseStmts.reduce((a, s) => a + s.totalAmount, 0);
        // 기간말 잔액 — 이월에 그 기간 발생·결제만 얹는다. 지난달을 보면 그달 말 잔액이 나온다.
        const closingReceivable = carrySale + yearSalesTotal - yearCollected;
        const closingPayable = carryBuy + yearPurchaseTotal - yearPaidOut;
        // 월별 수금 — 매출 막대 옆에 겹쳐 "팔린 것 대비 들어온 것"을 본다
        const monthCollected = Array.from({ length: 12 }, (_, i) => {
          const ym = `${statsYear}-${String(i + 1).padStart(2, '0')}`;
          return partnerCash.filter(p => p.kind === '수금' && p.date.startsWith(ym)).reduce((a, p) => a + p.signed, 0);
        });
        // 전표 목록 — 매출·매입·수금·지불을 한 줄로 섞어 월별로 묶는다(최신 월이 위).
        //   수금·지불은 자금원장(108/251) 한 곳에서만 온다.
        const yearStmts = selId
          ? issuedStatements.filter(s => s.partnerId === selId && s.tradeDate.startsWith(periodPrefix))
          : [];
        /*
         * 최신이 위로 오는 목록이다. **같은 날 안에서도 최신이 위**여야 읽힌다 —
         * 전에는 날짜만 보고 갈래 이름으로 tie를 깼더니, 8/19 매입을 상계한 그날 대체전표가
         * 매입 아래(= 더 이전)로 내려가 "상계를 매입보다 먼저 잡은 것"처럼 보였다.
         *
         * 시각은 stampFor가 찍어 둔 것을 그대로 쓴다 — 소급으로 끊은 전표는 23:59:59라
         * 그날 맨 뒤(목록에선 맨 위)에 선다. 동시각이면 전표를 뒤에 둬서 '발생 후 상계'로 읽힌다.
         */
        const timeline = selId ? [
          ...yearStmts.map(s => ({
            id: s.id, date: s.tradeDate, ts: rowStamp(s.tradeDate, s.issuedAt),
            kind: s.type as '매출' | '매입', amount: s.totalAmount,
            note: `${s.docNo ?? ''} ${s.items?.slice(0, 2).map(i => i.name).join(', ') ?? ''}${(s.items?.length ?? 0) > 2 ? ` 외 ${s.items!.length - 2}` : ''}`.trim(),
            stmt: s,
          })),
          ...yearCash.map(p => ({ id: p.id, date: p.date, ts: p.ts, kind: p.kind, amount: p.signed, note: p.note, stmt: null as IssuedStatement | null })),
        ].sort((a, b) =>
          b.ts.localeCompare(a.ts)
          || (a.stmt ? 0 : 1) - (b.stmt ? 0 : 1)          // 동시각이면 전표가 위(=나중)
          || issuedMs(b.id) - issuedMs(a.id)              // 그래도 같으면 나중에 끊은 게 위
        ) : [];
        // 월별로 묶기 — 최신 월이 위. 월 머리에 그달 매출·수금 합계를 띄운다.
        const timelineByMonth = (() => {
          const map = new Map<string, typeof timeline>();
          for (const t of timeline) {
            const ym = t.date.slice(0, 7);
            const arr = map.get(ym); if (arr) arr.push(t); else map.set(ym, [t]);
          }
          return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
        })();
        const maxAmt = Math.max(...months.map(m => m.amount), ...monthCollected, 1);
        const availableYears = Array.from(new Set(selSalesStmts.map(s => Number(s.tradeDate.slice(0, 4))))).sort((a, b) => b - a);
        const fmtS = (n: number) => n >= 100000000 ? `${(n / 100000000).toFixed(1)}억` : n >= 10000 ? `${Math.round(n / 10000).toLocaleString()}만` : n.toLocaleString();

        /**
         * 미수 ↔ 미지급 상계 — 같은 거래처에 받을 돈과 줄 돈이 같이 있으면 서로 턴다.
         *
         *   (차) 251 외상매입금 / (대) 108 외상매출금   — 현금은 안 움직인다.
         *
         * **대체전표 한 건**으로 끊는다. 예전엔 입금 108 + 출금 251 두 건으로 적었는데,
         * 분개를 만들 때 계좌가 비면 보통예금으로 폴백해서(autoJournal) 실제로 오간 적 없는
         * 금액이 103 원장에 차·대 두 줄로 남았다. 잔액은 상쇄돼 안 틀어져도 원장이 더러워진다.
         *
         * 자금원장에는 그대로 둔다 — 거래처 잔액이 여기 108/251을 보고 계산되기 때문이다.
         * dir='대체'면 통장 잔액(signedAmount)은 0이고, 잔액 계산은 두 줄을 양쪽 감소로 읽는다.
         */
        const saveOffset = () => {
          if (!offsetForm) return;
          const amt = Number(String(offsetForm.amount).replace(/,/g, ''));
          if (!Number.isFinite(amt) || amt <= 0) { alert('금액을 숫자로 입력하세요.'); return; }
          if (amt > offsetForm.max) { alert(`상계할 수 있는 최대 금액은 ${fmt(offsetForm.max)}원입니다.`); return; }
          onAddCashEntry?.({
            id: `cash-${Date.now()}-offset`,
            date: offsetForm.date, cashAccountId: '',
            dir: '대체', amount: amt,
            partnerId: offsetForm.id, partnerName: offsetForm.name,
            // 양수 = 차변, 음수 = 대변
            lines: [
              { accountCode: '251', amount: amt, side: '차변' as const },   // 외상매입금 — 줄 돈이 준다
              { accountCode: '108', amount: amt, side: '대변' as const },   // 외상매출금 — 받을 돈이 준다
            ],
            note: `${offsetForm.name} 미수·미지급 상계`,
            createdAt: stampFor(offsetForm.date),
          } as CashEntry);
          setOffsetForm(null);
        };

        const openPayModal = (stmt: IssuedStatement) => {
          setPayTarget(stmt);
          setPayForm({ amount: String(getBalance(stmt)), date: new Date().toISOString().slice(0, 10), method: '계좌이체', note: '' });
          setPinToStmt(true);
          setShowPayModal(true);
        };
        // 수금·지불은 **자금원장에 쓴다** — 전표에 붙이지 않는다.
        //   전표에 붙이면 "어느 청구서를 갚았나"가 어긋나고, 잔액 계산 근거가 둘로 갈린다.
        //   거래처 잔액은 '전표 합계 − 자금원장 108/251'로 나오므로 여기 한 줄이면 충분하다.
        const savePayment = () => {
          if (!payTarget || !payForm.amount) return;
          const amt = Number(payForm.amount);
          if (!Number.isFinite(amt) || amt <= 0) { alert('금액을 숫자로 입력하세요.'); return; }
          const isSale = payTarget.type === '매출';
          const entryId = `cash-${Date.now()}`;
          onAddCashEntry?.({
            id: entryId,
            date: payForm.date,
            cashAccountId: '',                       // 계좌는 관리하지 않는다(전표화면과 같은 규칙)
            dir: isSale ? '입금' : '출금',
            amount: amt,
            partnerId: payTarget.partnerId ?? '',
            partnerName: payTarget.partnerName ?? '',
            accountCode: isSale ? '108' : '251',     // 외상매출금 / 외상매입금
            note: [`${payTarget.partnerName ?? ''} ${isSale ? '수금' : '지불'}`, payForm.method, payForm.note.trim()]
              .filter(Boolean).join(' · '),
            createdAt: stampFor(payForm.date),
          });
          // 이 전표를 찍고 연 수금이면 **그 전표에 붙인다**(매칭). 금액이 아니라 연결만 붙는 것이라
          // 매칭이 틀려도 거래처 잔액은 안 흔들린다 — 어느 청구서냐만 바뀐다.
          if (pinToStmt && onAddSettlement) {
            onAddSettlement({
              id: `settle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              cashEntryId: entryId, statementId: payTarget.id,
              amount: Math.min(amt, getBalance(payTarget)),
              createdAt: new Date().toISOString(),
            });
          }
          setShowPayModal(false);
          setPayTarget(null);
        };

        const generateMonthlySummaryPdf = async () => {
          const month = new Date().toISOString().slice(0, 7);
          const [y, m] = month.split('-');
          const monthStmts = issuedStatements.filter(s => s.tradeDate.startsWith(month));
          const salesTotal = monthStmts.filter(s => s.type === '매출').reduce((a, s) => a + s.totalAmount, 0);
          const purchaseTotal = monthStmts.filter(s => s.type === '매입').reduce((a, s) => a + s.totalAmount, 0);
          const allReceivable = allClientList.filter(c => c.receivable > 0);
          const totalReceivableAll = allReceivable.reduce((a, c) => a + c.receivable, 0);
          // settlement엔 날짜가 없으므로 연결된 cashEntry의 날짜로 이번 달인지 판정한다.
          const entryById = new Map(cashEntries.map(e => [e.id, e]));
          const settledThisMonth = new Set<string>();
          for (const st of settlements) {
            const e = entryById.get(st.cashEntryId);
            if (e && (e.date ?? '').startsWith(month)) settledThisMonth.add(st.statementId);
          }
          const paidThisMonth = allClientList.filter(c => {
            const stmts = issuedStatements.filter(s => s.partnerId === c.id && s.type === '매출');
            return stmts.some(s => settledThisMonth.has(s.id));
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
                {/* 높이를 묶는다 — flex-1만 두면 거래처 수만큼 늘어나 화면 끝까지 내려간다 */}
                <div className="bg-white rounded-2xl border border-slate-200 flex-1 min-h-0 max-h-[calc(100vh-260px)] overflow-y-auto">
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
                          {c.payable > 0 && <span className="text-[9px] font-black text-rose-600">미지급 {fmtS(c.payable)}</span>}
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
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* 연 / 월 — 월로 보면 앞에 전월이월이 붙는다 */}
                        <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5 mr-1">
                          {([['year', '연'], ['month', '월']] as const).map(([v, lbl]) => (
                            <button key={v} onClick={() => setStatsScope(v)}
                              className={`px-3 py-1 rounded-md text-xs font-black transition-all ${statsScope === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}>
                              {lbl}
                            </button>
                          ))}
                        </div>
                        {statsScope === 'month' ? (
                          <>
                            <button onClick={() => { if (statsMonth === 1) { setStatsYear(y => y - 1); setStatsMonth(12); } else setStatsMonth(m => m - 1); }}
                              className="p-1.5 hover:bg-slate-100 rounded-lg"><ChevronLeft size={16}/></button>
                            <span className="text-sm font-black text-slate-800 min-w-[92px] text-center">{statsYear}년 {statsMonth}월</span>
                            <button onClick={() => { if (statsMonth === 12) { setStatsYear(y => y + 1); setStatsMonth(1); } else setStatsMonth(m => m + 1); }}
                              className="p-1.5 hover:bg-slate-100 rounded-lg"><ChevronRight size={16}/></button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => setStatsYear(y => y - 1)} className="p-1.5 hover:bg-slate-100 rounded-lg"><ChevronLeft size={16}/></button>
                            <span className="text-sm font-black text-slate-800 min-w-[52px] text-center">{statsYear}년</span>
                            <button onClick={() => setStatsYear(y => y + 1)} disabled={statsYear >= currentYear} className="p-1.5 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronRight size={16}/></button>
                            {availableYears.filter(y => y !== statsYear).map(y => (
                              <button key={y} onClick={() => setStatsYear(y)} className="px-2.5 py-1 rounded-lg text-xs font-black bg-slate-100 text-slate-500 hover:bg-slate-200">{y}</button>
                            ))}
                          </>
                        )}
                      </div>
                    </div>

                    {/* 요약 — '판 것 → 받은 것 → 남은 것' 흐름으로 읽히게 한 줄에 세운다.
                        매입이 있는 거래처는 아래 줄에 같은 모양으로 '산 것 → 준 것 → 남은 것'. */}
                    <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                      {/* 이월 + 기간매출 − 기간수금 = 기간말 미수. 네 칸이 한 줄로 읽히는 식이라
                          연·월 어느 쪽으로 봐도 전표 합계와 맞는다. 이월을 빼면 기초전표(개시잔액)만큼 어긋난다. */}
                      <div className="grid grid-cols-4 divide-x divide-slate-100">
                        <div className="px-5 py-3.5 bg-slate-50/70">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{carryLabel}</p>
                          <p className="text-xl font-black text-slate-500 mt-1 tabular-nums">{fmtS(carrySale)}</p>
                          <p className="text-[10px] font-bold text-slate-400 mt-0.5">{openingInPeriod ? carryHint : `${carryHint} 미수`}</p>
                        </div>
                        <div className="px-5 py-3.5">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">매출</p>
                          <p className="text-xl font-black text-slate-800 mt-1 tabular-nums">{fmtS(yearSalesTotal)}</p>
                          <p className="text-[10px] font-bold text-slate-400 mt-0.5">{yearSalesStmts.length}건</p>
                        </div>
                        <div className="px-5 py-3.5">
                          <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">수금</p>
                          <p className="text-xl font-black text-emerald-600 mt-1 tabular-nums">{fmtS(yearCollected)}</p>
                          <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                            {yearSalesTotal > 0 ? `${Math.round((yearCollected / yearSalesTotal) * 100)}% 회수` : '—'}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={totalReceivable <= 0}
                          onClick={() => setReceivableDetailClient({ id: selId, name: selName })}
                          className={`px-5 py-3.5 text-left transition-colors ${totalReceivable > 0 ? 'hover:bg-blue-50/60 cursor-pointer' : 'cursor-default'}`}
                        >
                          <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{statsScope === 'month' ? '월말 미수' : '연말 미수'}</p>
                          <p className={`text-xl font-black mt-1 tabular-nums ${closingReceivable > 0 ? 'text-blue-600' : 'text-slate-300'}`}>
                            {closingReceivable > 0 ? fmtS(closingReceivable) : '없음'}
                          </p>
                          <p className="text-[10px] font-bold text-slate-400 mt-0.5">{totalReceivable > 0 ? '눌러서 상세' : '전부 회수'}</p>
                        </button>
                      </div>
                      {(yearPurchaseTotal > 0 || totalPayable > 0 || carryBuy > 0) && (
                        <div className="grid grid-cols-4 divide-x divide-slate-100">
                          <div className="px-5 py-3.5 bg-slate-50/70">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{carryLabel}</p>
                            <p className="text-xl font-black text-slate-500 mt-1 tabular-nums">{fmtS(carryBuy)}</p>
                            <p className="text-[10px] font-bold text-slate-400 mt-0.5">{openingInPeriod ? carryHint : `${carryHint} 미지급`}</p>
                          </div>
                          <div className="px-5 py-3.5">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">매입</p>
                            <p className="text-xl font-black text-slate-800 mt-1 tabular-nums">{fmtS(yearPurchaseTotal)}</p>
                            <p className="text-[10px] font-bold text-slate-400 mt-0.5">{yearPurchaseStmts.length}건</p>
                          </div>
                          <div className="px-5 py-3.5">
                            <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">지불</p>
                            <p className="text-xl font-black text-orange-600 mt-1 tabular-nums">{fmtS(yearPaidOut)}</p>
                            <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                              {yearPurchaseTotal > 0 ? `${Math.round((yearPaidOut / yearPurchaseTotal) * 100)}% 지급` : '—'}
                            </p>
                          </div>
                          {/* 못 받은 돈은 파랑, 줘야 할 돈은 빨강 — 색만 보고 방향을 안다 */}
                          <div className="px-5 py-3.5">
                            <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">{statsScope === 'month' ? '월말 미지급' : '연말 미지급'}</p>
                            <p className={`text-xl font-black mt-1 tabular-nums ${closingPayable > 0 ? 'text-rose-600' : 'text-slate-300'}`}>
                              {closingPayable > 0 ? fmtS(closingPayable) : '없음'}
                            </p>
                            <p className="text-[10px] font-bold text-slate-400 mt-0.5">{totalPayable > 0 ? '갚을 돈' : '전부 지급'}</p>
                          </div>
                        </div>
                      )}
                      {/* 상계 — 같은 거래처에 받을 돈과 줄 돈이 같이 있으면 돈을 주고받을 필요가 없다.
                          현금은 안 움직이고 채권·채무만 서로 턴다. */}
                      {totalReceivable > 0 && totalPayable > 0 && (
                        <div className="px-5 py-3 flex items-center gap-3 flex-wrap bg-amber-50/60">
                          <span className="text-[11px] font-bold text-slate-500">
                            받을 돈 <b className="text-blue-600">{fmtS(totalReceivable)}</b>과
                            줄 돈 <b className="text-rose-600">{fmtS(totalPayable)}</b>이 같이 있습니다 —
                            <b className="text-slate-700"> {fmtS(Math.min(totalReceivable, totalPayable))}</b>까지 상계할 수 있습니다.
                          </span>
                          <button
                            onClick={() => setOffsetForm({
                              id: selId, name: selName,
                              max: Math.min(totalReceivable, totalPayable),
                              amount: String(Math.round(Math.min(totalReceivable, totalPayable))),
                              date: new Date().toISOString().slice(0, 10),
                            })}
                            className="ml-auto shrink-0 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-black transition-colors">
                            상계 처리
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 월별 매출 · 수금 — 나란히 세워 "판 달"과 "들어온 달"의 시차가 보이게 한다 */}
                    {(yearSalesStmts.length > 0 || yearCash.length > 0) && (
                      <div className="bg-white rounded-2xl border border-slate-200 p-5">
                        <div className="flex items-center justify-between mb-4">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">월별 매출 · 수금</p>
                          <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400">
                            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-200" />매출</span>
                            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />수금</span>
                          </div>
                        </div>
                        <div className="flex items-end gap-1.5 h-24">
                          {months.map(({ label, amount, count }, i) => {
                            const got = monthCollected[i];
                            return (
                              <div key={label} className="flex-1 flex flex-col items-center gap-1 group relative">
                                <div className="w-full flex items-end justify-center gap-0.5 h-[84px]">
                                  <div className="w-1/2 bg-indigo-200 rounded-t-sm group-hover:bg-indigo-400 transition-colors"
                                    style={{ height: `${Math.round((amount / maxAmt) * 84)}px`, minHeight: amount > 0 ? 3 : 0 }} />
                                  <div className="w-1/2 bg-emerald-400 rounded-t-sm group-hover:bg-emerald-500 transition-colors"
                                    style={{ height: `${Math.round((Math.max(0, got) / maxAmt) * 84)}px`, minHeight: got > 0 ? 3 : 0 }} />
                                </div>
                                {(amount > 0 || got !== 0) && (
                                  <div className="absolute bottom-full mb-1.5 bg-slate-800 text-white text-[9px] font-black px-2 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 left-1/2 -translate-x-1/2 space-y-0.5">
                                    <div>매출 {fmtS(amount)}원 · {count}건</div>
                                    <div className="text-emerald-300">수금 {fmtS(got)}원</div>
                                  </div>
                                )}
                                <span className="text-[8px] font-bold text-slate-400">{label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 거래 타임라인 — 전표와 수금·지불을 한 줄로 섞어 시간순.
                        예전엔 매출 내역과 수금이 따로 놀아, 잔액이 왜 그 값인지 짚으려면 화면을 오갔다. */}
                    {timeline.length > 0 && (
                      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{periodLabel} 전표 · 자금</p>
                          <span className="text-[10px] font-bold text-slate-400">{timeline.length}건</span>
                        </div>
                        <div className="max-h-[32rem] overflow-y-auto">
                        {timelineByMonth.map(([ym, rows]) => {
                          const mSale = rows.filter(r => r.kind === '매출').reduce((a, r) => a + r.amount, 0);
                          const mGot = rows.filter(r => r.kind === '수금').reduce((a, r) => a + r.amount, 0);
                          return (
                          <div key={ym}>
                            <div className="sticky top-0 z-10 px-5 py-2 bg-slate-50/95 backdrop-blur border-y border-slate-100 flex items-center gap-3">
                              <span className="text-[11px] font-black text-slate-600">{Number(ym.slice(5))}월</span>
                              <span className="text-[10px] font-bold text-slate-400">{rows.length}건</span>
                              <span className="ml-auto flex items-center gap-3 text-[10px] font-black tabular-nums">
                                {mSale > 0 && <span className="text-slate-500">매출 {fmtS(mSale)}</span>}
                                {mGot !== 0 && <span className="text-emerald-600">수금 {fmtS(mGot)}</span>}
                              </span>
                            </div>
                            <div className="divide-y divide-slate-50">
                          {rows.map(t => {
                            const style = t.kind === '매출' ? 'bg-blue-50 text-blue-600'
                              : t.kind === '매입' ? 'bg-violet-50 text-violet-600'
                              : t.kind === '수금' ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-orange-50 text-orange-700';
                            const isCash = t.kind === '수금' || t.kind === '지불';
                            const bal = t.stmt ? getBalance(t.stmt) : 0;
                            return (
                              <div key={t.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-slate-50/60 transition-colors">
                                <span className="w-14 shrink-0 text-[11px] font-bold text-slate-500 tabular-nums">{t.date.slice(2)}</span>
                                <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-black ${style}`}>{t.kind}</span>
                                <span className="flex-1 min-w-0 text-[11px] text-slate-400 truncate">{t.note || '—'}</span>
                                {/* 매출은 받을 돈(미수), 매입은 줄 돈(미지급) — 한쪽 말로 뭉뚱그리면 방향을 잘못 읽는다 */}
                                {t.stmt && bal > 0 && (
                                  <button onClick={() => openPayModal(t.stmt!)}
                                    className={`shrink-0 px-2 py-1 rounded-lg text-[9px] font-black transition-colors ${
                                      t.kind === '매입'
                                        ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                                        : 'bg-slate-100 text-slate-500 hover:bg-indigo-100 hover:text-indigo-600'
                                    }`}>
                                    {t.kind === '매입' ? '미지급' : '미수'} {fmtS(bal)}
                                  </button>
                                )}
                                <span className={`shrink-0 w-24 text-right text-[12px] font-black tabular-nums ${
                                  isCash ? (t.amount < 0 ? 'text-rose-500' : t.kind === '수금' ? 'text-emerald-600' : 'text-orange-600') : 'text-slate-700'
                                }`}>
                                  {isCash && t.amount >= 0 ? '' : isCash ? '−' : ''}{fmt(Math.abs(t.amount))}
                                </span>
                              </div>
                            );
                          })}
                            </div>
                          </div>
                          );
                        })}
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
              // 수금·지불 이력 — 잔액을 깎은 자금 움직임 그대로(108 채권 / 251 채무).
              //   잔액은 이 합계를 빼서 나오므로, 숫자가 이상하면 여기서 근거를 바로 볼 수 있다.
              const payHistory = cashEntries
                .filter(e => e.partnerId === receivableDetailClient.id)
                .flatMap(e => partnerCashParts(e).map(p => ({
                  id: `${e.id}-${p.code}`,
                  date: e.date ?? '',
                  kind: p.code === '108' ? '수금' : '지불',
                  signed: p.reduce,   // 양수면 그만큼 줄었다(수금·지불·상계)
                  note: p.note || e.note || '',
                  ts: rowStamp(e.date ?? '', e.createdAt),
                })))
                // 최신이 위 — 같은 날이면 그날 안의 시각, 동시각이면 나중에 끊은 것이 위
                .sort((a, b) => b.ts.localeCompare(a.ts) || issuedMs(b.id) - issuedMs(a.id));
              const payTotal = payHistory.reduce((a, p) => a + p.signed, 0);
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
                        <p className="py-8 text-center text-slate-300 text-sm font-bold">미수금 없음</p>
                      )}
                      {unpaidStmts.map(s => {
                        const bal = getBalance(s);
                        const paid = s.totalAmount - bal;   // 이 전표에 배분된 수금액
                        // 이 전표에 사람이 찍어 붙인 매칭 — 근거(자금기록)가 살아 있는 것만
                        const pins = settlements.filter(st => st.statementId === s.id && cashEntries.some(e => e.id === st.cashEntryId));
                        const pinned = pins.reduce((a, st) => a + (st.amount ?? 0), 0);
                        return (
                          <div key={s.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-black text-slate-700">{s.tradeDate}</span>
                                <span className="text-[10px] font-mono text-slate-400">{s.docNo}</span>
                                {pinned > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                                    지정 {fmt(pinned)}
                                    {onDeleteSettlement && (
                                      <button
                                        onClick={() => { if (window.confirm('이 전표에 지정한 수금 연결을 풀까요?\n\n금액은 그대로고, 오래된 전표부터 자동 배분으로 돌아갑니다.')) pins.forEach(st => onDeleteSettlement(st.id)); }}
                                        title="지정 해제 — 자동 배분으로 되돌린다"
                                        className="text-indigo-300 hover:text-rose-500">✕</button>
                                    )}
                                  </span>
                                )}
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
                      {/* 수금·지불 이력 — 이 거래처 잔액을 깎은 자금 움직임 */}
                      {payHistory.length > 0 && (
                        <div className="bg-slate-50/60">
                          <div className="px-5 py-2.5 flex items-center justify-between border-b border-slate-100">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">수금 · 지불 이력</span>
                            <span className="text-[11px] font-black text-slate-500 tabular-nums">
                              누계 {fmt(payTotal)}원 · {payHistory.length}건
                            </span>
                          </div>
                          {payHistory.map(p => (
                            <div key={p.id} className="px-5 py-2 flex items-center gap-3 border-b border-slate-100/70 last:border-0">
                              <span className="w-16 shrink-0 text-[11px] font-bold text-slate-500 tabular-nums">{p.date.slice(2)}</span>
                              <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black ${p.kind === '수금' ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
                                {p.kind}
                              </span>
                              <span className="flex-1 min-w-0 text-[11px] text-slate-400 truncate">{p.note || '—'}</span>
                              <span className={`shrink-0 text-[12px] font-black tabular-nums ${p.signed < 0 ? 'text-rose-500' : 'text-slate-700'}`}>
                                {p.signed < 0 ? '−' : ''}{fmt(Math.abs(p.signed))}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
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

            {/* 미수 ↔ 미지급 상계 모달 */}
            {offsetForm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4">
                  <h3 className="text-sm font-black text-slate-800">미수 · 미지급 상계</h3>
                  <div className="text-xs text-slate-400">{offsetForm.name}</div>
                  <div className="bg-slate-50 rounded-xl px-4 py-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">받을 돈 (미수금)</span>
                      <span className="font-black text-blue-600 tabular-nums">{fmt(totalReceivable)}원</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">줄 돈 (미지급금)</span>
                      <span className="font-black text-rose-600 tabular-nums">{fmt(totalPayable)}원</span>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                      <span className="text-slate-500">상계 가능</span>
                      <span className="font-black text-slate-800 tabular-nums">{fmt(offsetForm.max)}원</span>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">상계 금액</label>
                      <input type="text" inputMode="numeric" value={offsetForm.amount}
                        onChange={e => setOffsetForm(f => f && ({ ...f, amount: e.target.value.replace(/[^\d,]/g, '') }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-right text-xl font-black tabular-nums outline-none focus:ring-2 focus:ring-amber-300"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">일자</label>
                      <input type="date" value={offsetForm.date}
                        onChange={e => setOffsetForm(f => f && ({ ...f, date: e.target.value }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-amber-300"/>
                    </div>
                  </div>
                  {/* 현금이 안 움직인다는 걸 분개로 못박아 둔다 */}
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">이렇게 분개됩니다</div>
                    <div className="px-3 py-2 text-[11px] font-bold text-slate-600 space-y-0.5">
                      <div className="flex justify-between"><span>차변 <span className="font-mono text-slate-400">251</span> 외상매입금</span><span className="tabular-nums">{fmt(Number(String(offsetForm.amount).replace(/,/g, '')) || 0)}</span></div>
                      <div className="flex justify-between"><span>대변 <span className="font-mono text-slate-400">108</span> 외상매출금</span><span className="tabular-nums">{fmt(Number(String(offsetForm.amount).replace(/,/g, '')) || 0)}</span></div>
                      <p className="text-[10px] font-bold text-slate-400 pt-1">통장은 움직이지 않습니다 — 받을 돈과 줄 돈만 서로 줄어듭니다.</p>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setOffsetForm(null)} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
                    <button onClick={saveOffset} className="flex-[2] py-2.5 rounded-xl bg-amber-500 text-white text-xs font-black hover:bg-amber-600 flex items-center justify-center gap-1.5">
                      <Save size={12}/>상계 처리
                    </button>
                  </div>
                </div>
              </div>
            )}

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
                        {(['현금', '계좌이체', '어음', '카드', '기타'] as PaymentMethod[]).map(m => (
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
                    {/* 끄면 오래된 전표부터 자동으로 채워진다(선입선출) */}
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={pinToStmt} onChange={e => setPinToStmt(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-indigo-600 shrink-0"/>
                      <span className="text-[11px] font-bold text-slate-500 leading-snug">
                        이 전표에 지정 <span className="text-slate-400 font-normal">({payTarget.docNo || payTarget.tradeDate})</span>
                        <br/>
                        <span className="text-[10px] text-slate-400 font-normal">끄면 오래된 전표부터 자동으로 채워집니다.</span>
                      </span>
                    </label>
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
        const unitCost = (p: Item) => (costOf ? costOf(p) : (p.cost ?? 0));  // BOM 롤업 원가(완제품 자동)

        /*
         * **재고도 회사별이다.** 전표·자금은 진작 갈라 놨는데 재고만 한 덩이였다.
         * 풍회가 사서 짜 놓은 깨분이 태백 재고로 잡히면, 실지재고조사법이라
         * 풍회는 매입이 전액 비용으로 남고 태백은 없는 재고자산이 는다 — 양쪽이 같이 틀어진다.
         * 회사가 안 박힌 옛 품목은 태백 것으로 본다(companyOf).
         */
        /**
         * 재고 0인 줄은 안 보여준다 — **원료·반제품만 예외.**
         *   완제품·부자재는 수백 개라 0이 대부분이어서, 원가만 붙어 있으면 다 떠서 목록이 안 읽혔다.
         *   원료·반제품은 종류가 적고 0이어도 좇아야 하니 남긴다(음수는 어느 타입이든 보여준다).
         */
        const keepZero = (p: Item) => p.type === 'raw' || p.type === 'wip';
        const rows = products
          .filter(p => companyOf(p) === companyId)
          .map(p => { const c = unitCost(p); return { ...p, stock: getStock(p), unitCost: c, value: Math.round(getStock(p) * c) }; })
          .filter(p => p.stock !== 0 || keepZero(p))
          .sort((a, b) => b.value - a.value);

        const totalValue = rows.reduce((acc, p) => acc + p.value, 0);

        // 타입(영문/구한글) + 카테고리 → 한글 그룹 라벨
        //   상품·부자재는 타입만으론 뭔지 몰라서 카테고리(향미유·고춧가루·용기·라벨…)를 쓴다.
        const catLabel = (p: Item): string => {
          const c = p.type as string;
          const sub = p.category as string | undefined;
          if (c === 'product' || c === '완제품') return '완제품';
          if (c === 'wip') return '반제품';
          if (c === 'raw') return '원료';
          if (c === 'goods' || c === '향미유' || c === '고춧가루') return sub || '상품';
          if (c === 'submaterial') return sub || '부자재';
          if (['용기', '마개', '라벨', '박스', '테이프'].includes(c)) return c; // 구 한글 부자재
          return '기타';
        };
        /**
         * 화면 묶음은 **타입** 하나로 — 완제품·상품·반제품·원료·부자재.
         *   선물세트·배송은 타입이 아니라 완제품의 subtype이라 '완제품'에 함께 선다.
         *   예전엔 catLabel로 묶어서 향미유·용기·라벨·마개가 각각 한 덩이씩 서서
         *   표가 15개로 갈렸다. 스냅샷에 저장하는 값은 catLabel 그대로 둔다 —
         *   거기선 용기·라벨 구분이 있어야 나중에 되짚을 수 있다.
         */
        const TYPE_GROUP: Record<string, string> = {
          product: '완제품', goods: '상품', wip: '반제품', raw: '원료', submaterial: '부자재',
        };
        const typeLabel = (p: Item): string => TYPE_GROUP[String(p.type)] ?? catLabel(p);
        const groupOrder = ['완제품', '상품', '반제품', '원료', '부자재', '기타'];
        const byLabel = new Map<string, typeof rows>();
        for (const p of rows) {
          const l = typeLabel(p);
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
                      items: rows.map(p => ({ itemId: p.id, name: p.name, category: catLabel(p), qty: p.stock, value: p.value, ...(p.spec ? { spec: p.spec } : {}) })),
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
                        /**
         * 펼친 스냅샷도 **타입별로** 묶어 보여준다 — 500줄 평면 목록은 못 읽는다.
         * 저장된 category는 catLabel 값(완제품·향미유·용기…)이라 타입 층으로 되올린다.
         * 값 0인 줄은 뺀다(원료·반제품은 그래도 남긴다 — 위 목록과 같은 규칙).
         */
                        const SNAP_TO_TYPE: Record<string, string> = {
                          //  스냅샷에 저장된 옛 라벨을 되읽는 표다 — 지금 분류 이름이 아니라 그때 값을 본다.
                          완제품: '완제품', 반제품: '반제품', 원료: '원료', 선물세트: '선물세트', 배송: '배송',
                          상품: '상품', 향미유: '상품', 고춧가루: '상품',
                          용기: '부자재', 마개: '부자재', 라벨: '부자재', 박스: '부자재', 테이프: '부자재', 케이스: '부자재', 부자재: '부자재',
                        };
                        /**
                         * 되읽기 표에 없는 분류는 **품목의 지금 type으로 되올린다.**
                         * 표만 믿으면 새 분류가 생길 때마다 '기타'로 샌다 — '비닐' 4품목
                         * 296만원이 부자재 소계에서 빠져 따로 서 있었다. 표는 지워진 품목
                         * (되짚을 데가 없는 옛 기록)에만 쓴다.
                         */
                        const snapGroupOf = (it: { category?: string; itemId: string }): string => {
                          const cur = products.find(p => p.id === it.itemId);
                          if (cur) return TYPE_GROUP[String(cur.type)] ?? SNAP_TO_TYPE[String(it.category)] ?? '기타';
                          return SNAP_TO_TYPE[String(it.category)] ?? '기타';
                        };
                        const snapGroups = hasItems
                          ? (() => {
                              const m = new Map<string, { name: string; qty: number; value: number; spec?: string; itemId: string; category?: string }[]>();
                              for (const it of snap.items!) {
                                const g = snapGroupOf(it);
                                if (Number(it.value) === 0 && g !== '원료' && g !== '반제품') continue;
                                const arr = m.get(g) ?? [];
                                arr.push(it as never);
                                m.set(g, arr);
                              }
                              for (const arr of m.values()) arr.sort((a, b) => Number(b.value) - Number(a.value));
                              return [...m.entries()]
                                .sort((a, b) => {
                                  const oi = groupOrder.indexOf(a[0]), oj = groupOrder.indexOf(b[0]);
                                  return (oi === -1 ? 99 : oi) - (oj === -1 ? 99 : oj);
                                });
                            })()
                          : [];
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
                          {open && snapGroups.map(([g, list]) => (
                            <React.Fragment key={snap.id + '-g-' + g}>
                              <tr className="bg-slate-100/80">
                                <td className="pl-9 pr-4 py-1.5 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                  {g} <span className="text-slate-400 font-bold normal-case">{list.length}품목</span>
                                </td>
                                <td className="px-4 py-1.5 text-[11px] text-right font-black text-slate-600">
                                  {fmt(list.reduce((a, x) => a + Number(x.value || 0), 0))}원
                                </td>
                                <td className="px-4 py-1.5"></td>
                              </tr>
                              {list.map((it, i) => {
                                // 옛 기록엔 규격이 안 담겨 있다 — 품목에서 찾아 붙인다(지워진 품목이면 없는 대로)
                                const spec = it.spec ?? products.find(p => p.id === it.itemId)?.spec;
                                return (
                                  <tr key={snap.id + '-' + g + '-' + i} className="bg-slate-50/60">
                                    <td className="pl-12 pr-4 py-1.5 text-[11px] text-slate-600">
                                      {it.name}
                                      {spec && <span className="ml-1.5 text-[10px] font-black text-slate-400">{spec}</span>}
                                      <span className="text-slate-400 ml-1.5">× {it.qty}</span>
                                    </td>
                                    <td className="px-4 py-1.5 text-[11px] text-right font-bold text-slate-600">{fmt(it.value)}원</td>
                                    <td className="px-4 py-1.5"></td>
                                  </tr>
                                );
                              })}
                            </React.Fragment>
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
                            {/* 규격을 같이 안 적으면 **낱개와 박스를 못 가른다** — 이름이 똑같다.
                                350ml * 1(병)과 350ml * 20(박스)이 나란히 서는데 재고액은 20배 차이가 난다. */}
                            <td className="px-4 py-3 text-xs font-bold text-slate-700">
                              {p.name}
                              {p.spec && <span className="ml-1.5 text-[10px] font-black text-slate-400">{p.spec}</span>}
                            </td>
                            <td className="px-4 py-3 text-xs text-right text-slate-600">{p.stock.toLocaleString()} {p.unit}</td>
                            <td className="px-4 py-3 text-xs text-right text-slate-500">
                              {p.unitCost > 0
                                ? <>{fmt(Math.round(p.unitCost))}원{(p.cost == null || p.cost === 0) && <span className="ml-1 text-[9px] font-black text-teal-500" title="BOM 롤업 원가">롤업</span>}</>
                                : <span className="text-slate-300">-</span>}
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
                  {/* 손익 줄 — 안 고르면 비용이 전부 매출원가로 떨어진다 */}
                  <select value={newGroupForm.plLine ?? ''}
                    onChange={e => setNewGroupForm(p => ({...p, plLine: (e.target.value || undefined) as AccountGroup['plLine']}))}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-300">
                    {PL_LINES.map(l => <option key={l.value ?? ''} value={l.value ?? ''}>{l.label}</option>)}
                  </select>
                  <button
                    onClick={async () => {
                      if (!newGroupForm.name.trim()) return;
                      if (newGroupForm.type === '수익' || newGroupForm.type === '비용') {
                        if (!newGroupForm.plLine) { alert('손익 줄을 골라 주세요. 안 고르면 손익계산서 어디에 설지 몰라 비용은 전부 매출원가로 떨어집니다.'); return; }
                      }
                      await onAddAccountGroup?.({ name: newGroupForm.name.trim(), type: newGroupForm.type, ...(newGroupForm.plLine ? { plLine: newGroupForm.plLine } : {}) });
                      setNewGroupForm({ name: '', type: '수익', plLine: undefined });
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
                            <select value={editGroupForm.plLine ?? ''} onChange={e => setEditGroupForm(f => ({ ...f, plLine: (e.target.value || '') as AccountGroup['plLine'] | '' }))}
                              className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-bold outline-none">
                              {PL_LINES.map(l => <option key={l.value ?? ''} value={l.value ?? ''}>{l.label}</option>)}
                            </select>
                            <select value={editGroupForm.type} onChange={e => setEditGroupForm(f => ({ ...f, type: e.target.value as AccountGroup['type'] }))}
                              className="text-[11px] font-black bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-300">
                              {GROUP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <input autoFocus value={editGroupForm.name} onChange={e => setEditGroupForm(f => ({ ...f, name: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter' && editGroupForm.name.trim()) { onUpdateAccountGroup?.(group.id, { name: editGroupForm.name.trim(), type: editGroupForm.type, plLine: (editGroupForm.plLine || undefined) as AccountGroup['plLine'] }); setEditGroupId(null); } if (e.key === 'Escape') setEditGroupId(null); }}
                              className="flex-1 min-w-0 text-sm font-black bg-white border border-slate-200 rounded-lg px-2.5 py-1 outline-none focus:ring-2 focus:ring-blue-300" />
                            <button onClick={() => { if (editGroupForm.name.trim()) onUpdateAccountGroup?.(group.id, { name: editGroupForm.name.trim(), type: editGroupForm.type, plLine: (editGroupForm.plLine || undefined) as AccountGroup['plLine'] }); setEditGroupId(null); }}
                              className="text-emerald-500 hover:text-emerald-700"><Check size={15} /></button>
                            <button onClick={() => setEditGroupId(null)} className="text-slate-300 hover:text-slate-500"><X size={15} /></button>
                          </>
                        ) : (
                          <>
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${typeColor[group.type] ?? 'bg-slate-100 text-slate-600'}`}>{group.type}</span>
                            <span className="font-black text-slate-800">{group.name}</span>
                            {onUpdateAccountGroup && (
                              <button onClick={() => { setEditGroupId(group.id); setEditGroupForm({ name: group.name, type: group.type, plLine: group.plLine ?? '' }); }}
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

            {/* 정기 고정비 입력은 없앴다 — 전표를 안 거치고 손익에 끼어드는 옆길이었다.
                이제 손익은 전표(분개)와 계정과목으로만 집계한다. 정기적으로 나가는 돈은
                일반전표의 템플릿으로 끊는다(필요하면 자동 발행). */}
          </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfitAnalysis;
