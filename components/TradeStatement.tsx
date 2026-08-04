
import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  FileText, Printer, Search, ChevronDown, CalendarDays,
  Package, ClipboardList, ChevronRight, CheckCircle2, Edit2, Plus, X, ArrowLeft,
  Save, Download, CheckSquare,
  ChevronLeft, Share2, Check, Wallet, RotateCw, Trash2, Landmark
} from 'lucide-react';
import * as ExcelJS from 'exceljs';
import { Order, Item, Partner, PartnerItem, OrderStatus, IssuedStatement, CompanyInfo, PaymentRecord, AccountCode, AccountGroup, CashAccount, CashEntry, Settlement, FixedCostTemplate } from '../types';
import { filterCodesForContext } from '../src/features/admin/financials';
import { fetchDateRange } from '../src/shared/services/firebaseService';
import { boxDerivedUnitPrice, unpackComponent, isBoxStockItem } from '../src/shared/orderUnits';
import { PurchaseOrder, poLines, ExpensePreset } from '../src/shared/types';
import { totalCashOnHand } from '../src/features/admin/cashLedger';
import { AccountModal } from './CashLedger';
import PageHeader from './PageHeader';

interface TradeStatementProps {
  orders: Order[];
  allItems: Item[];
  partners: Partner[];
  partnerItems?: import('../src/shared/types').PartnerItem[];
  accountCodes?: AccountCode[];
  accountGroups?: AccountGroup[];
  // 자금원장 — 지불/수금처리가 여기에 기록된다. 없으면 구 payments[]로 폴백.
  cashAccounts?: CashAccount[];
  cashEntries?: CashEntry[];
  settlements?: Settlement[];
  onAddCashEntry?: (e: Omit<CashEntry, 'id'> & { id: string }) => void;
  onAddSettlement?: (s: Omit<Settlement, 'id'> & { id: string }) => void;
  onDeleteCashEntry?: (id: string) => void;
  onDeleteSettlement?: (id: string) => void;
  onAddCashAccount?: (a: Omit<CashAccount, 'id'> & { id: string }) => void;
  onUpdateCashAccount?: (id: string, data: Partial<CashAccount>) => void;
  // 정기 고정비 — 템플릿으로 해당 월 전표를 한 번에 생성 (중복 생성은 핸들러가 막는다)
  fixedCostTemplates?: FixedCostTemplate[];
  onGenerateRecurringCosts?: (yearMonth: string) => Promise<number>;
  onAddFixedCostTemplate?: (data: Omit<FixedCostTemplate, 'id'>) => Promise<void>;
  onUpdateFixedCostTemplate?: (id: string, data: Partial<FixedCostTemplate>) => Promise<void>;
  onDeleteFixedCostTemplate?: (id: string) => Promise<void>;
  // 전표 탭 모드 — 'trade'=거래명세서(매출/매입/수금지불) · 'adjust'=조정(대체/정기비용) · 'full'=전부(기본)
  voucherMode?: 'full' | 'trade' | 'adjust';
  embedded?: boolean;   // 상위(전표 탭)가 헤더·탭을 그림 → 여기선 헤더 생략, 내용만
  issuedStatements: IssuedStatement[];
  onUpdateStatus?: (id: string, status: OrderStatus) => void;
  onUpsertPartnerItem?: (ps: PartnerItem) => void;
  onMarkInvoicePrinted?: (id: string, value: boolean) => void;
  onAddIssuedStatement?: (stmt: IssuedStatement) => void;
  onUpdateIssuedStatement?: (id: string, data: Partial<IssuedStatement>) => void;
  onProposeEdit?: (id: string, data: Partial<IssuedStatement>, stmtType: '매출' | '매입', docNo: string, partnerName: string) => void;
  onDeleteIssuedStatement?: (id: string) => void;
  pendingInvoice?: { partnerId: string; partnerName: string; items: Array<{ name: string; spec: string; qty: number; price: number; isBox?: boolean }>; poIds?: string[] } | null;
  onClearPendingInvoice?: () => void;
  confirmedOrders?: PurchaseOrder[];
  orderRequests?: PurchaseOrder[];
  onAddConfirmedOrder?: (item: { id: string; quantity: number; isBox?: boolean; partnerId?: string; partnerName?: string }) => void;
  onRemoveConfirmedOrder?: (id: string) => void;
  onRemoveOrderRequest?: (id: string) => void;
  // 매입전표 발행 시: 발주카드 없으면 새로 생성(입고대기, 같은 거래처 품목 묶음), 있으면 발주카드에 전표 id 연결 + 입고대기 전환
  onCreateInboundPO?: (po: { partnerId: string; partnerName: string; statementId: string; items: { itemId: string; itemName: string; quantity: number; isBox?: boolean; unit: string }[] }) => void;
  onLinkPurchaseOrder?: (poId: string, statementId: string) => void;
  companyInfo?: CompanyInfo | null;
  onSaveCompanyInfo?: (info: CompanyInfo) => void;
  onUpdateItemCost?: (itemId: string, cost: number) => void;
  onUpdateOrder?: (id: string, data: Partial<import('../types').Order>) => void;
  defaultTab?: 'history' | 'taxinvoice';
  onAddProductClient?: (itemId: string, partnerId: string, price: number, taxType: '과세' | '면세') => void;
  expensePresets?: ExpensePreset[];
  onAddExpensePreset?: (p: Omit<ExpensePreset, 'id' | 'createdAt'>) => Promise<string>;
  onDeleteExpensePreset?: (id: string) => void;
}

type StatementType = '매출' | '매입' | '비용';

const STATUS_LABEL: Record<string, string> = {
  [OrderStatus.PENDING]: '대기중', [OrderStatus.PROCESSING]: '작업중',
  [OrderStatus.DISPATCHED]: '작업완료', [OrderStatus.SHIPPED]: '출고완료',
  [OrderStatus.DELIVERED]: '배송완료',
};
const STATUS_COLOR: Record<string, string> = {
  [OrderStatus.PENDING]: 'bg-slate-100 text-slate-500',
  [OrderStatus.PROCESSING]: 'bg-amber-100 text-amber-700',
  [OrderStatus.DISPATCHED]: 'bg-sky-100 text-sky-700',
  [OrderStatus.SHIPPED]: 'bg-indigo-100 text-indigo-700',
  [OrderStatus.DELIVERED]: 'bg-emerald-100 text-emerald-700',
};

const ACTIVE_STATUSES = new Set([OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.DISPATCHED, OrderStatus.SHIPPED]);

// 초성 검색: 한글 이름의 초성 추출 + 매칭(부분일치 or 초성일치)
const CHOSUNG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const toChosung = (s: string) => [...s].map(ch => {
  const c = ch.charCodeAt(0) - 0xAC00;
  return (c >= 0 && c <= 11171) ? CHOSUNG[Math.floor(c / 588)] : ch;
}).join('');
const matchKo = (name: string, q: string) => {
  const query = q.trim();
  if (!query) return true;
  if (name.toLowerCase().includes(query.toLowerCase())) return true;
  if (/^[ㄱ-ㅎ]+$/.test(query)) return toChosung(name).includes(query);
  return false;
};

const fmt = (n: number) => n.toLocaleString('ko-KR');

function buildSupplierGroups<T extends { id: string }>(
  orders: T[], allItems: Item[], partners: Partner[], psMap: Map<string, string>
): { partnerId: string; partnerName: string; items: { product: Item; item: T }[] }[] {
  const map = new Map<string, { partnerName: string; items: { product: Item; item: T }[] }>();
  for (const item of orders) {
    const itemId = (item as any).itemId ?? item.id;
    const product = allItems.find(p => p.id === itemId);
    const sid = product ? ((item as any).partnerId || psMap.get(product.id)) : undefined;
    if (!sid) continue;
    const sName = partners.find(c => c.id === sid)?.name ?? sid;
    if (!map.has(sid)) map.set(sid, { partnerName: sName, items: [] });
    map.get(sid)!.items.push({ product: product!, item });
  }
  return Array.from(map.entries()).map(([sid, v]) => ({ partnerId: sid, ...v }));
}

const today = () => new Date().toISOString().slice(0, 10);
// 금주 = 이번 주 월요일 ~ 이번 주 일요일 (로컬 기준, 고정 범위)
const fmtLocalDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const weekMonday = () => { const d = new Date(); const diff = d.getDay() === 0 ? -6 : 1 - d.getDay(); d.setDate(d.getDate() + diff); return fmtLocalDate(d); };
const weekSunday = () => { const d = new Date(); const diff = d.getDay() === 0 ? 0 : 7 - d.getDay(); d.setDate(d.getDate() + diff); return fmtLocalDate(d); };
// 당월 = 이번 달 1일 ~ 말일 (로컬 기준, 고정 범위)
const monthStart = () => { const d = new Date(); return fmtLocalDate(new Date(d.getFullYear(), d.getMonth(), 1)); };
const monthEnd = () => { const d = new Date(); return fmtLocalDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
const yearStart  = () => new Date().getFullYear() + '-01-01';

const TradeStatement: React.FC<TradeStatementProps> = ({
  orders, allItems, partners, partnerItems,
  accountCodes = [],
  accountGroups = [],
  cashAccounts = [],
  cashEntries = [],
  settlements = [],
  onAddCashEntry,
  onAddSettlement,
  onDeleteCashEntry,
  onDeleteSettlement,
  onAddCashAccount,
  onUpdateCashAccount,
  fixedCostTemplates = [],
  onGenerateRecurringCosts,
  onAddFixedCostTemplate, onUpdateFixedCostTemplate, onDeleteFixedCostTemplate,
  voucherMode = 'full',
  issuedStatements, onUpdateStatus, onUpsertPartnerItem,
  onMarkInvoicePrinted, onAddIssuedStatement,
  onUpdateIssuedStatement,
  onProposeEdit,
  onDeleteIssuedStatement,
  pendingInvoice,
  onClearPendingInvoice,
  confirmedOrders = [],
  orderRequests = [],
  onAddConfirmedOrder,
  onRemoveConfirmedOrder,
  onRemoveOrderRequest,
  onCreateInboundPO,
  onLinkPurchaseOrder,
  companyInfo,
  onSaveCompanyInfo,
  onUpdateItemCost,
  onUpdateOrder,
  defaultTab = 'history',
  onAddProductClient,
  expensePresets = [],
  onAddExpensePreset,
  onDeleteExpensePreset,
}) => {
  const partnerIn = (partnerItems ?? []).filter((pi: any) => pi.Direction === 'in');
  const partnerOut = (partnerItems ?? []).filter((pi: any) => pi.Direction === 'out');

  // ── 전표 생성 오버레이 ──
  const [createMode, setCreateMode] = useState<StatementType | null>(null);

  // ── 거래처/주문 선택 ──
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [partnerSearch, setClientSearch] = useState('');
  const [onlyActive, setOnlyActive] = useState(true); // 진행주문(미발행) 디폴트 ON
  const [activeVisible, setActiveVisible] = useState(30);

  // ── 기간 필터 (주문 선택) ── 금주(월~일) 디폴트
  const [dateFrom, setDateFrom] = useState(weekMonday);
  const [dateTo, setDateTo] = useState(weekSunday);
  const [orderDateQuick, setOrderDateQuick] = useState<'당일'|'금주'|'당월'|'전체'|''>('금주');

  // ── 거래 일자 ──
  const [tradeDate, setTradeDate] = useState(today);


  // ── 미리보기 ──
  const [showPreview, setShowPreview] = useState(false);

  // ── 인라인 단가 수정 ──
  const [editablePrices, setEditablePrices] = useState<Record<string, string>>({});

  // ── 과세/면세 수동 오버라이드 (undefined = PC 기본값 사용) ──
  const [taxExemptOverrides, setTaxExemptOverrides] = useState<Record<string, boolean>>({});

  // ── 단가 DB 관리 패널 ──
  const [showPricePanel, setShowPricePanel] = useState(false);
  const [pricePanelEdits, setPricePanelEdits] = useState<Record<string, string>>({});

  // ── 직접 입력 모드 ──
  const [manualMode, setManualMode] = useState(false);
  type ManualRow = { name: string; spec: string; qty: string; price: string; isTaxExempt: boolean; note?: string; isBoxUnit?: boolean; boxSize?: number; accountCode?: string };
  const [manualItems, setManualItems] = useState<ManualRow[]>([
    { name: '', spec: '', qty: '', price: '', isTaxExempt: false, note: '' },
  ]);
  // ── 매입: 선택해서 불러온 발주카드 id 목록. 발행 시 이 PO들의 linkedStatementId에 전표 id 연결 + 입고대기 전환 ──
  const [loadedPoIds, setLoadedPoIds] = useState<string[]>([]);
  // 발주카드(PurchaseOrder) → 직접입력 행들로 변환 (묶음 items[] 펼침, 카드 섹션·재발행 공용)
  const poToManualRows = (po: PurchaseOrder): ManualRow[] =>
    poLines(po).map(line => {
      const product = allItems.find(p => p.id === line.itemId);
      const ps = (partnerItems ?? []).find((s: any) => s.Direction === 'in' && (s.itemId === line.itemId || s.itemId === line.itemId) && (s.partnerId === selectedClientId || s.partnerId === selectedClientId));
      const isBox = line.isBox ?? false;
      return { name: line.name || product?.name || '', spec: product?.spec || line.unit || '', qty: String(line.quantity), price: ps?.price ? String(ps.price) : (ps?.price ? String(ps.price) : ''), isTaxExempt: ps?.taxType === '면세', isBoxUnit: isBox, boxSize: isBox ? 12 : undefined, accountCode: ps?.Account_Code };
    });
  // ── 품목명 드롭다운 검색 ──
  const [activeSearchRow, setActiveSearchRow] = useState<number | null>(null);
  // ── 주문 불러오기 모드 계정코드 오버라이드 (key → code) ──
  const [accountCodeOverrides, setAccountCodeOverrides] = useState<Record<string, string>>({});
  // ── 자주 쓰는 비용 항목(택배비·상차비·기타) 프리셋 관리 모드 ──
  const [manageExpense, setManageExpense] = useState(false);
  // 프리셋 클릭 → 직접입력 행으로 추가 (품목 아님 → 재고·발주 영향 없음)
  const addExpenseRow = (p: ExpensePreset) => {
    setManualMode(true);
    setManualItems(prev => {
      const rows = prev.filter(r => r.name.trim());
      return [...rows,
        { name: p.name, spec: '', qty: '1', price: p.price ? String(p.price) : '', isTaxExempt: p.taxType === '면세', note: '' },
        { name: '', spec: '', qty: '', price: '', isTaxExempt: false, note: '' }];
    });
  };
  // ── 비용 전표 발행 모달 (거래처 없이 계정과목+금액) ──
  const [showExpense, setShowExpense] = useState(false);
  const [expDate, setExpDate] = useState(today());
  const [expRows, setExpRows] = useState<ManualRow[]>([{ name: '', spec: '', qty: '1', price: '', isTaxExempt: false }]);
  // ── 전표 추가 필드 ──
  const [tradeNote, setTradeNote] = useState('');       // 전표비고
  const [selectedItemIdx, setSelectedItemIdx] = useState<number | null>(null); // 선택된 품목 행

  // ── 빠른 품목 입력 행 ──
  const [quickName, setQuickName] = useState('');
  const [quickSpec, setQuickSpec] = useState('');
  const [quickQty, setQuickQty] = useState('');
  const [quickPrice, setQuickPrice] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [quickIsTaxExempt, setQuickIsTaxExempt] = useState(false);

  // ── 품목 선택 팝업 ──
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  // 팝업 내 수량 임시 입력: { [itemId]: qty }
  const [pickerQtys, setPickerQtys] = useState<Record<string,string>>({});

  // 현재 전표 세션에서 이미 issuedStatement에 저장했는지 추적 (인쇄 중복 방지)
  const hasIssuedRef = useRef(false);

  // ── 지불/수불 처리 모달 ──
  const [payTarget, setPayTarget] = useState<IssuedStatement | null>(null);
  const [payForm, setPayForm] = useState<{ amount: string; date: string; method: PaymentRecord['method']; note: string }>({
    amount: '', date: new Date().toISOString().slice(0, 10), method: '계좌이체', note: '',
  });
  const [payAccountId, setPayAccountId] = useState('');
  const [quickPayAccountId, setQuickPayAccountId] = useState('');

  // ── 정기 고정비 생성 ──
  const [showRecurring, setShowRecurring] = useState(false);
  const [recurringYm, setRecurringYm] = useState(today().slice(0, 7));
  const [recurringMsg, setRecurringMsg] = useState('');
  const [recurringBusy, setRecurringBusy] = useState(false);
  // 정기비용 템플릿 추가 폼 (거래명세서 안에서 바로 관리)
  const [tplForm, setTplForm] = useState<{ name: string; amount: string; accountCode: string; partnerId: string; startYm: string }>({ name: '', amount: '', accountCode: '', partnerId: '', startYm: '' });
  const [tplBusy, setTplBusy] = useState(false);
  const [tplEditId, setTplEditId] = useState<string | null>(null);
  const [tplEditAmt, setTplEditAmt] = useState('');
  const [payOverWarn, setPayOverWarn] = useState(false);

  // ── 수금/지불 내역 상세/수정 모달 ──
  const [editPayInfo, setEditPayInfo] = useState<{ stmt: IssuedStatement; payment: PaymentRecord } | null>(null);
  const [editPayEditable, setEditPayEditable] = useState(false);
  const [editPayForm, setEditPayForm] = useState<{ amount: string; date: string; method: PaymentRecord['method']; note: string }>({
    amount: '', date: '', method: '계좌이체', note: '',
  });

  // ── 빠른 수금/지불 모달 ──
  const [showQuickPay, setShowQuickPay] = useState(false);
  const [quickPayClientId, setQuickPayClientId] = useState('');
  const [quickPayClientSearch, setQuickPayClientSearch] = useState('');
  const [quickPayDate, setQuickPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [quickPayAmount, setQuickPayAmount] = useState('');
  const [quickPayMethod, setQuickPayMethod] = useState<PaymentRecord['method']>('계좌이체');
  const [quickPayNote, setQuickPayNote] = useState('');
  const [quickPayDropOpen, setQuickPayDropOpen] = useState(false);
  const [quickPayOverWarn, setQuickPayOverWarn] = useState(false);
  // 입출금 모달 확장 — 일반/상환/급여 + 방향 + 계정과목 (장부 흡수)
  const [qpMode, setQpMode] = useState<'일반' | '상환' | '급여'>('일반');
  const [qpDir, setQpDir] = useState<'입금' | '출금'>('출금');
  const [qpAccountCode, setQpAccountCode] = useState('');
  const [qpLoanCode, setQpLoanCode] = useState('260');
  const [qpPrincipal, setQpPrincipal] = useState('');
  const [qpInterest, setQpInterest] = useState('');
  const [qpGross, setQpGross] = useState('');
  const [qpDeduction, setQpDeduction] = useState('');
  const openCashModal = (dir: '입금' | '출금') => {
    setQpMode('일반'); setQpDir(dir); setQpAccountCode('');
    setQpPrincipal(''); setQpInterest(''); setQpGross(''); setQpDeduction(''); setQpLoanCode('260');
    setShowQuickPay(true); setQuickPayOverWarn(false);
    setQuickPayClientId(''); setQuickPayClientSearch(''); setQuickPayAmount(''); setQuickPayNote('');
    setQuickPayDate(new Date().toISOString().slice(0, 10));
    setQuickPayAccountId(prev => prev || activeCashAccounts[0]?.id || '');
  };

  const activeCashAccounts = useMemo(() => cashAccounts.filter(a => a.active), [cashAccounts]);
  const codeName = useMemo(() => new Map(accountCodes.map(c => [c.code, c.name])), [accountCodes]);
  // 계좌별 현재 잔액 + 보유자금 총액 (장부 흡수 — 전표 화면에서 잔액 확인)
  const cashBalances = useMemo(() => {
    const active = cashAccounts.filter(a => a.active);
    const perAccount = active.map(a => ({ acct: a, bal: totalCashOnHand([a], cashEntries, today()) }));
    const total = totalCashOnHand(active.filter(a => a.type !== '카드'), cashEntries, today());
    return { perAccount, total };
  }, [cashAccounts, cashEntries]);
  const cashEntryById = useMemo(() => new Map(cashEntries.map(e => [e.id, e])), [cashEntries]);

  // 결제는 구 payments[]와 자금원장 매칭(settlements) 양쪽에서 온다. 둘 다 빼야 잔액이 맞는다.
  const getPaid = (s: IssuedStatement) =>
    (s.payments ?? []).reduce((a, p) => a + p.amount, 0)
    + settlements.filter(st => st.statementId === s.id).reduce((a, st) => a + st.amount, 0);
  const getBalance = (s: IssuedStatement) => s.totalAmount - getPaid(s);

  /** 결제 기록 — 자금원장에 출금/입금 1건을 만들고, 전표들에 매칭을 붙인다.
   *  계좌가 없거나 핸들러가 없으면 구 payments[] 방식으로 폴백한다. */
  const recordPayment = (
    allocations: { stmt: IssuedStatement; amount: number }[],
    opts: { date: string; method?: PaymentRecord['method']; note?: string; cashAccountId?: string },
  ) => {
    const total = allocations.reduce((a, x) => a + x.amount, 0);
    if (total <= 0) return;
    // 계좌를 안 쓰기로 함 → 계좌 없어도 cashAccountId=''(미지정)로 자금원장에 기록. 핸들러 없을 때만 구 방식 폴백.
    const acctId = opts.cashAccountId || cashAccounts.find(a => a.active)?.id || '';
    const first = allocations[0].stmt;

    if (!onAddCashEntry || !onAddSettlement) {
      // 폴백: 자금 계좌가 없으면 예전처럼 전표에 결제를 매단다
      allocations.forEach(({ stmt, amount }, i) => {
        const live = issuedStatements.find(s => s.id === stmt.id) ?? stmt;
        const p: PaymentRecord = {
          id: `pay-${Date.now()}-${i}-${stmt.id}`, amount, date: opts.date,
          method: opts.method, ...(opts.note ? { note: opts.note } : {}),
          createdAt: new Date().toISOString(),
        };
        onUpdateIssuedStatement?.(stmt.id, { payments: [...(live.payments ?? []), p] });
      });
      return;
    }

    // 전표의 계정과목을 자금 기록에 물려준다 — 이게 있어야 현금흐름표가 성격을 안다.
    // 기계 구입(206 기계장치) 지불이면 투자활동으로, 원료 매입(500)이면 영업활동으로 간다.
    // 여러 계정이 섞인 전표면 성격을 하나로 못 정하므로 비워둔다(= 영업).
    const allCodes = new Set(
      allocations.flatMap(({ stmt }) => (stmt.items ?? []).map(i => i.accountCode).filter(Boolean)),
    );
    const payCode = allCodes.size === 1 ? [...allCodes][0] : undefined;

    const entryId = `cash-${Date.now()}`;
    onAddCashEntry({
      id: entryId,
      ...(payCode ? { accountCode: payCode } : {}),
      date: opts.date,
      cashAccountId: acctId,
      dir: first.type === '매입' ? '출금' : '입금',
      amount: total,
      ...(first.partnerId ? { partnerId: first.partnerId, partnerName: first.partnerName ?? '' } : {}),
      note: opts.note || `${first.partnerName ?? ''} ${first.type === '매입' ? '지불' : '수금'}`.trim(),
      createdAt: new Date().toISOString(),
    });
    allocations.forEach(({ stmt, amount }, i) => {
      onAddSettlement({
        id: `settle-${Date.now()}-${i}`,
        cashEntryId: entryId, statementId: stmt.id, amount,
        createdAt: new Date().toISOString(),
      });
    });
  };

  const openPayModal = (stmt: IssuedStatement) => {
    setPayOverWarn(false);
    setPayTarget(stmt);
    const liveStmt = issuedStatements.find(s => s.id === stmt.id) ?? stmt;
    const bal = getBalance(liveStmt);
    setPayForm({ amount: bal > 0 ? String(bal) : '', date: new Date().toISOString().slice(0, 10), method: '계좌이체', note: '' });
    setPayAccountId(prev => prev || activeCashAccounts[0]?.id || '');
  };

  const savePayment = (forceOver = false) => {
    if (!payTarget || !payForm.amount) return;
    const amount = Number(payForm.amount);
    if (amount <= 0) return;
    // live 데이터로 잔액 계산 (stale payTarget 방지)
    const liveStmt = issuedStatements.find(s => s.id === payTarget.id) ?? payTarget;
    const bal = getBalance(liveStmt);
    if (amount > bal && !forceOver) {
      setPayOverWarn(true);
      return;
    }
    setPayOverWarn(false);
    recordPayment([{ stmt: liveStmt, amount }], {
      date: payForm.date, method: payForm.method, note: payForm.note.trim() || undefined,
      cashAccountId: payAccountId,
    });
    setPayTarget(null);
  };

  const openEditPay = (stmt: IssuedStatement, payment: PaymentRecord) => {
    setEditPayInfo({ stmt, payment });
    setEditPayForm({ amount: String(payment.amount), date: payment.date, method: payment.method ?? '계좌이체', note: payment.note ?? '' });
    setEditPayEditable(false);
  };

  const saveEditPay = () => {
    if (!editPayInfo || !editPayForm.amount || Number(editPayForm.amount) <= 0) return;
    const updated = (editPayInfo.stmt.payments ?? []).map(p =>
      p.id === editPayInfo.payment.id
        ? { ...p, amount: Number(editPayForm.amount), date: editPayForm.date, method: editPayForm.method, note: editPayForm.note.trim() || undefined }
        : p
    );
    onUpdateIssuedStatement?.(editPayInfo.stmt.id, { payments: updated });
    setEditPayInfo(null);
  };

  const deleteEditPay = () => {
    if (!editPayInfo) return;
    if (!window.confirm('이 수금/지불 내역을 삭제하시겠습니까?')) return;
    const updated = (editPayInfo.stmt.payments ?? []).filter(p => p.id !== editPayInfo.payment.id);
    onUpdateIssuedStatement?.(editPayInfo.stmt.id, { payments: updated });
    setEditPayInfo(null);
  };

  // ── 메인 탭 ──
  const [mainTab, setMainTab] = useState<'history' | 'taxinvoice'>(defaultTab ?? 'history');
  // 계좌 관리 모달 (장부에서 흡수)
  const [showAccounts, setShowAccounts] = useState(false);
  // 거래명세서(매출/매입) 생성 드롭다운
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!createMenuOpen) return;
    const h = (e: MouseEvent) => { if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) setCreateMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [createMenuOpen]);

  // ── 회사 설정 모달 ──
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [companyForm, setCompanyForm] = useState<CompanyInfo>({
    name: '', ceoName: '', bizNo: '', bizType: '', bizItem: '', address: '', phone: '', fax: '', email: '',
  });

  // ── 세금계산서 탭 ──
  const [taxClientId, setTaxClientId] = useState('');
  const [taxClientSearch, setTaxClientSearch] = useState('');
  const [taxStmtIds, setTaxStmtIds] = useState<string[]>([]);
  const [taxBuyerInfo, setTaxBuyerInfo] = useState({ bizNo: '', ceoName: '', bizType: '', bizItem: '', address: '' });
  const taxPrintRef = useRef<HTMLDivElement>(null);

  // ── 발행내역 필터 ──
  const [histFrom, setHistFrom] = useState(monthStart);
  const [histTo, setHistTo]     = useState(today);
  const [histTypeFilter, setHistTypeFilter] = useState<'전체' | '매출' | '매입' | '비용' | '자금'>('전체');
  const [histSearch, setHistSearch] = useState('');
  const [histQuick, setHistQuick] = useState<'당일'|'금주'|'당월'|'당년'|'ALL'|''>('당월');
  // 발행내역 페이지네이션
  const HIST_PAGE_SIZE = 50;
  const [historyPage, setHistoryPage] = useState(1);

  // ── 발행내역 온디맨드 fetch (7일 이전 데이터) ──
  const [extraStatements, setExtraStatements] = useState<IssuedStatement[]>([]);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
  const fetchedRangeRef = useRef<{ from: string; to: string } | null>(null);

  const sevenDaysAgoCutoff = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }, []);

  useEffect(() => {
    const from = histFrom || '2020-01-01';
    const to   = histTo   || today();
    // 7일 이내면 props 데이터로 충분
    if (from >= sevenDaysAgoCutoff) {
      setExtraStatements([]);
      fetchedRangeRef.current = null;
      return;
    }
    // 동일 범위 재요청 방지
    if (fetchedRangeRef.current?.from === from && fetchedRangeRef.current?.to === to) return;
    setIsFetchingHistory(true);
    fetchDateRange<IssuedStatement>('issuedStatements', 'tradeDate', from, to)
      .then(data => {
        setExtraStatements(data.map(s => ({
          ...s,
          items: s.items ?? [],
          payments: s.payments ?? [],
          tradeDate: s.tradeDate ?? '',
          issuedAt: s.issuedAt ?? '',
        })));
        fetchedRangeRef.current = { from, to };
      })
      .finally(() => setIsFetchingHistory(false));
  }, [histFrom, histTo, sevenDaysAgoCutoff]);

  // props 7일치 + 온디맨드 fetch 데이터 합치기 (id 기준 dedup, props 우선)
  const mergedStatements = useMemo(() => {
    const map = new Map<string, IssuedStatement>();
    extraStatements.forEach(s => map.set(s.id, s));
    issuedStatements.forEach(s => map.set(s.id, s));
    return Array.from(map.values());
  }, [issuedStatements, extraStatements]);

  // ── 발행내역 상세 보기 ──
  const [detailStmt, setDetailStmt] = useState<IssuedStatement | null>(null);

  // ── 발주확정 선택 / 매입 품목 검색 ──
  const [selectedConfirmedIds, setSelectedConfirmedIds] = useState<string[]>([]);
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [showPurchasePicker, setShowPurchasePicker] = useState(false);

  // ── 중복발행 경고 ──
  const [warnDuplicate, setWarnDuplicate] = useState<{ order?: Order; po?: PurchaseOrder; stmt: IssuedStatement } | null>(null);

  // ── 기존 전표 수정 ──
  const [editingStmt, setEditingStmt] = useState<IssuedStatement | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);

  // ── 전표 유형 (createMode 파생) ──
  const stmtType: StatementType = createMode || '매출';

  // 전표 타입에 맞는 계정과목만 — 매출전표에 '단기차입금'이 뜨면 안 된다.
  const stmtCodes = useMemo(
    () => filterCodesForContext(accountCodes, accountGroups, stmtType === '매출' ? '매출' : '매입'),
    [accountCodes, accountGroups, stmtType],
  );
  // 대체전표는 비현금 계정만 — 감가상각·퇴직충당금. 현금이 오간 건 자금원장(장부 탭)으로 간다.
  const expCodes = useMemo(
    () => filterCodesForContext(accountCodes, accountGroups, '대체'),
    [accountCodes, accountGroups],
  );

  // ── 생성 오버레이 열기/닫기 ──
  const openCreate = (type: StatementType) => {
    setCreateMode(type);
    setSelectedClientId('');
    setSelectedOrderId('');
    setShowPreview(false);
    setEditablePrices({});
    setTaxExemptOverrides({});
    setTradeDate(today());
    setClientSearch('');
    setDateFrom('');
    setDateTo('');
    setOrderDateQuick(type === '매출' ? '전체' : '');
    setShowPricePanel(false);
    setSelectedConfirmedIds([]);
    setPurchaseSearch('');
    setShowPurchasePicker(false);
    setActiveSearchRow(null);
    setManualMode(false);
    setManualItems([{ name: '', spec: '', qty: '', price: '', isTaxExempt: false }]);
    setLoadedPoIds([]);
  };
  const closeCreate = () => { setCreateMode(null); setEditingStmt(null); setIsEditMode(false); setTradeNote(''); setSelectedItemIdx(null); setQuickName(''); setQuickSpec(''); setQuickQty(''); setQuickPrice(''); setQuickNote(''); setQuickSearchOpen(false); setQuickIsTaxExempt(false); setShowItemPicker(false); setPickerSearch(''); setPickerQtys({}); setAccountCodeOverrides({}); setLoadedPoIds([]); hasIssuedRef.current = false; };

  // pendingInvoice가 오면 자동으로 매입전표 생성 모달 열기
  useEffect(() => {
    if (!pendingInvoice) return;
    openCreate('매입');
    setManualMode(true);
    // 거래처 설정 (supplierId로 매입처 찾기)
    const matchedClient = partners.find(c => c.id === pendingInvoice.partnerId);
    if (matchedClient) setSelectedClientId(matchedClient.id);
    // 품목 채우기
    setManualItems([
      ...pendingInvoice.items.map(item => ({
        name: item.name,
        spec: item.spec,
        qty: String(item.qty),
        price: String(item.price || ''),
        isTaxExempt: false,
        isBoxUnit: item.isBox ?? false,
        boxSize: item.isBox ? 12 : undefined,
      })),
      { name: '', spec: '', qty: '', price: '', isTaxExempt: false },
    ]);
    // 선입고/발주에서 넘어온 소스 PO들 — 발행 시 linkedStatementId 연결 + 입고대기 전환
    setLoadedPoIds(pendingInvoice.poIds ?? []);
    onClearPendingInvoice?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInvoice]);

  // 매출: 거래처 선택 여부와 무관하게 금주(월~일) 디폴트
  useEffect(() => {
    if (createMode !== '매출' || editingStmt) return;
    setDateFrom(weekMonday()); setDateTo(weekSunday()); setOrderDateQuick('금주');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId, createMode]);

  // editingStmt를 live issuedStatements와 동기화 (수금처리 후 즉시 반영) — 편집 중에는 제외
  useEffect(() => {
    if (editingStmt && !isEditMode) {
      const live = issuedStatements.find(s => s.id === editingStmt.id);
      if (live) setEditingStmt(live);
    }
  }, [issuedStatements, isEditMode]);

  const openEdit = (stmt: IssuedStatement) => {
    setEditingStmt(stmt);
    setIsEditMode(false);
    setCreateMode(stmt.type);
    setSelectedClientId(stmt.partnerId);
    setSelectedOrderId(stmt.orderId || '');
    setTradeDate(stmt.tradeDate);
    setManualMode(true);
    setManualItems([
      ...stmt.items.map(i => ({
        name: i.name,
        spec: i.spec,
        qty: String(i.qty),
        // 저장된 단가(부가세 포함)를 그대로 사용 — 수동입력 모드 supply=round(qty*price/1.1)와 일치
        price: String(i.price || (i.qty > 0 ? Math.round(i.total / i.qty) : 0)),
        isTaxExempt: i.isTaxExempt,
        accountCode: i.accountCode,
        isBoxUnit: i.isBoxUnit,
        boxSize: i.boxSize,
      })),
      { name: '', spec: '', qty: '', price: '', isTaxExempt: false },
    ]);
    setEditablePrices({});
    setTaxExemptOverrides({});
    setClientSearch('');
    setShowPricePanel(false);
    setActiveSearchRow(null);
  };


  // ── 매입전표 발행된 발주 품목 ID 집합 (발행완료/미발행 뱃지) ──
  const issuedPurchaseOrderIds = useMemo(() => {
    const s = new Set<string>();
    issuedStatements
      .filter(st => st.type === '매입')
      .forEach(st => ((st as any).purchaseOrderIds ?? (st as any).confirmedProductIds ?? []).forEach((id: string) => s.add(id)));
    return s;
  }, [issuedStatements]);

  // partnerIn → itemId:partnerId 빠른 조회 맵
  const psMap = useMemo(() => new Map(
    partnerIn.filter(ps => ps.itemId && ps.partnerId).map(ps => [ps.itemId!, ps.partnerId!])
  ), [partnerIn]);

  // ── 발주확정 공급처별 그룹 ──
  const confirmedBySupplier = useMemo(
    () => buildSupplierGroups(confirmedOrders, allItems, partners, psMap)
      .map(g => ({ ...g, items: g.items.map(({ product, item }) => ({ product, co: item as { id: string; quantity: number } })) })),
    [confirmedOrders, allItems, partners, psMap]
  );

  // ── 발주예정 공급처별 그룹 ──
  const orderRequestsBySupplier = useMemo(
    () => buildSupplierGroups(orderRequests, allItems, partners, psMap)
      .map(g => ({ ...g, items: g.items.map(({ product, item }) => ({ product, req: item as { id: string; quantity: number; confirmedByUser?: boolean } })) })),
    [orderRequests, allItems, partners, psMap]
  );

  // ── 발주예정 전체 그룹 (psMap 의존 없이 partnerIn 직접 조회, 미지정 포함) ──
  const orderRequestsAllGroups = useMemo(() => {
    const map = new Map<string, { partnerId: string; partnerName: string; items: { product: Item; req: { id: string; quantity: number; confirmedByUser?: boolean; isBox?: boolean } }[] }>();
    for (const req of (orderRequests ?? [])) {
      const product = allItems.find(p => p.id === req.id);
      if (!product) continue;
      // itemId/itemId 모두 확인 (필드명 불일치 대응)
      const ps = partnerIn.find(s =>
        (s.itemId === req.id || (s as any).itemId === req.id) && s.Direction === 'in'
      );
      const partnerId = ps ? (ps.partnerId || (ps as any).partnerId || '') : '';
      const partnerName = partnerId
        ? (partners.find(c => c.id === partnerId)?.name ?? partnerId)
        : '거래처 미지정';
      const key = partnerId || '__unmapped__';
      if (!map.has(key)) map.set(key, { partnerId, partnerName, items: [] });
      map.get(key)!.items.push({ product, req: req as any });
    }
    return Array.from(map.values());
  }, [orderRequests, allItems, partnerIn, partners]);

  // ── 매입 품목 선택 패널용: partnerIn 연결된 품목 전체 (공급처별 그룹) ──
  const purchasableBySupplier = useMemo(() => {
    const term = purchaseSearch.toLowerCase().trim();
    const map = new Map<string, { partnerName: string; items: Item[] }>();
    for (const ps of partnerIn) {
      const partnerId = ps.partnerId;
      const itemId = ps.itemId;
      if (!partnerId || !itemId) continue;
      const p = allItems.find(x => x.id === itemId);
      if (!p || (term && !p.name.toLowerCase().includes(term))) continue;
      const sName = partners.find(c => c.id === partnerId)?.name ?? partnerId;
      if (!map.has(partnerId)) map.set(partnerId, { partnerName: sName, items: [] });
      map.get(partnerId)!.items.push(p);
    }
    return Array.from(map.entries()).map(([sid, v]) => ({ partnerId: sid, ...v }));
  }, [allItems, partners, partnerIn, purchaseSearch]);

  // ── 현재 진행 주문 (매출전표 현재 주문만 패널용) ──
  const activeOrders = useMemo(() =>
    orders
      .filter(o => ACTIVE_STATUSES.has(o.status as OrderStatus) && o.partnerName !== '생산기록')
      .sort((a, b) => {
        const aP = !!a.invoicePrinted, bP = !!b.invoicePrinted;
        if (aP !== bP) return aP ? 1 : -1;
        return new Date(a.deliveryDate || a.createdAt).getTime() - new Date(b.deliveryDate || b.createdAt).getTime();
      }),
    [orders]
  );

  // ── 선택된 발주항목(확정+예정) → 매입전표 직접 입력 모드 ──
  const loadSelectedToManual = () => {
    const rows: ManualRow[] = [];
    selectedConfirmedIds.forEach(id => {
      const product = allItems.find(p => p.id === id);
      if (!product) return;
      const co = confirmedOrders.find(c => c.id === id);
      if (co) {
        const isBox = product.category === '향미유' && (co as any).isBox;
        rows.push({ name: product.name, spec: product.spec || product.unit || '', qty: String(co.quantity), price: '', isTaxExempt: false, isBoxUnit: isBox, boxSize: isBox ? 12 : undefined });
        return;
      }
      const req = orderRequests?.find((r: { id: string; quantity: number; isBox?: boolean }) => r.id === id);
      if (req) {
        const ps = partnerIn.find(s => s.itemId === id && s.partnerId === selectedClientId);
        const isBox = product.category === '향미유' && (req as any).isBox;
        rows.push({ name: product.name, spec: product.spec || product.unit || '', qty: String(req.quantity), price: ps?.price ? String(ps.price) : '', isTaxExempt: ps?.taxType === '면세', isBoxUnit: isBox, boxSize: isBox ? 12 : undefined });
      }
    });
    if (rows.length === 0) return;
    setManualItems([...rows, { name: '', spec: '', qty: '', price: '', isTaxExempt: false }]);
    setSelectedConfirmedIds([]);
    setManualMode(true);
  };

  // ── 거래처 목록 ──
  const activeClientIds = useMemo(() =>
    new Set(orders.filter(o => ACTIVE_STATUSES.has(o.status as OrderStatus)).map(o => o.partnerId)),
    [orders]
  );
  const availableClients = useMemo(() => {
    let base = partners.filter(c => {
      if (createMode === '매입') {
        // 매입전표: 매입처 또는 매출+매입처
        return c.partnerType === '매입처' || c.partnerType === '매출+매입처';
      }
      // 매출전표: 매출처(기본) 또는 매출+매입처 — 채널(일반/택배/스마트스토어)·미설정 무관하게 모두 노출
      // (예전엔 type==='일반'||'택배'만 허용해 스마트스토어·type 미설정 거래처가 검색에서 누락됐음)
      return c.partnerType === undefined || c.partnerType === '매출처' || c.partnerType === '매출+매입처';
    });
    // 검색 중이면 진행주문 필터(onlyActive)를 무시하고 해당 유형 전체 거래처에서 찾는다.
    // 매입은 '주문(orders=매출)' 개념이 없어 진행주문 필터를 아예 안 건다 — 매입처 전체를 노출.
    // (주문 없는 거래처도 검색으로 잡히게 — 매출/매입 전체 거래처 검색).
    if (onlyActive && !partnerSearch.trim() && createMode !== '매입') base = base.filter(c => activeClientIds.has(c.id));
    if (!partnerSearch.trim()) return base;
    return base.filter(c => matchKo(c.name, partnerSearch));
  }, [partners, partnerSearch, onlyActive, activeClientIds, createMode]);

  // ── 주문 목록 ──
  const partnerOrders = useMemo(() => {
    let list = orders
      .filter(o => o.partnerId === selectedClientId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (onlyActive) {
      // 진행주문 = 미발행(배송완료여도 미발행이면 표시) + 진행중 상태. 발행완료(invoicePrinted)는 발행내역에서 본다.
      list = list.filter(o => !o.invoicePrinted || ACTIVE_STATUSES.has(o.status as OrderStatus));
      list = [...list].sort((a, b) => {
        const aP = !!a.invoicePrinted, bP = !!b.invoicePrinted;
        if (aP !== bP) return aP ? 1 : -1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }
    // 미발행(진행) 전표는 날짜 무관하게 다 보인다 (배송완료·예전주문이어도). 날짜필터는 발행완료 건에만.
    if (dateFrom) list = list.filter(o => !o.invoicePrinted || (o.createdAt || '').slice(0, 10) >= dateFrom);
    if (dateTo)   list = list.filter(o => !o.invoicePrinted || (o.createdAt || '').slice(0, 10) <= dateTo);
    return list;
  }, [orders, selectedClientId, onlyActive, dateFrom, dateTo]);

  const selectedOrder  = partnerOrders.find(o => o.id === selectedOrderId);
  const selectedClient = partners.find(c => c.id === selectedClientId);

  // ── 품목 행 계산 ──
  type LineItem = {
    key: string; no: number; name: string; spec: string;
    qty: number; price: number; supply: number; tax: number; total: number;
    isTaxExempt: boolean; isBoxUnit?: boolean; boxSize?: number; accountCode?: string;
  };

  const lineItems = useMemo((): LineItem[] => {
    if (manualMode) {
      return manualItems
        .filter(i => i.name.trim())
        .map((item, idx) => {
          const qty = parseFloat(item.qty) || 0;
          const price = parseFloat(item.price) || 0;
          // 단가는 부가세 포함 → 공급가액 역산 (주문 기반 경로 및 품목행 표시와 동일 규칙)
          const gross = qty * price;
          const supply = item.isTaxExempt ? gross : Math.round(gross / 1.1);
          const tax = item.isTaxExempt ? 0 : gross - supply;
          return { key: `manual-${idx}`, no: idx + 1, name: item.name, spec: item.spec, qty, price, supply, tax, total: supply + tax, isTaxExempt: item.isTaxExempt, isBoxUnit: item.isBoxUnit, boxSize: item.boxSize, accountCode: item.accountCode || (stmtType === '매출' ? '800' : undefined) };
        });
    }
    if (!selectedOrder) return [];
    const itemMap: Record<string, LineItem> = {};
    let no = 1;
    selectedOrder.items.forEach(item => {
      let product = allItems.find(p => p.id === item.itemId);
      // 박스 품목 → 낱개로 변환 (전표는 낱개 기준). 수량 = 박스개수 × 개입 = 낱개 수량으로 환산.
      const uc = unpackComponent(product);
      let qtyUnits = item.quantity;
      if (uc) {
        const loose = allItems.find(p => p.id === uc.itemId);
        if (loose) {
          const boxCount = item.isBoxUnit && item.boxQuantity ? item.boxQuantity : item.quantity;
          product = loose;
          qtyUnits = boxCount * uc.count;
        }
      }
      const displayName = product?.name || item.name;
      const spec = product?.spec || item.displaySize || '';
      const key  = `${displayName}||${spec}`;
      const piList = stmtType === '매출' ? partnerOut : partnerIn;
      const pcEntry = piList.find(
        pc => pc.itemId === product?.id && pc.partnerId === selectedClientId
      );
      // 낱개 단가 (박스는 위에서 낱개로 바꿔 조회 → 낱개 partner_item 단가)
      const pcPrice   = pcEntry?.price ?? boxDerivedUnitPrice(product, selectedClientId, piList);
      const pcTaxType = pcEntry?.taxType; // '과세' | '면세' | undefined(=과세 기본)
      const defaultPrice = pcPrice ?? item.price ?? product?.price ?? 0;
      const unitPrice    = editablePrices[key] !== undefined
        ? (parseFloat(editablePrices[key]) || 0) : defaultPrice;
      // 면세 여부: 수동 오버라이드 > PC taxType (undefined이면 과세 기본)
      const isTaxExempt  = key in taxExemptOverrides
        ? taxExemptOverrides[key]
        : pcTaxType === '면세';
      // 과세: 단가는 부가세 포함 → 공급가액 역산
      let supply: number, tax: number, displayPrice: number;
      if (isTaxExempt) {
        displayPrice = unitPrice;
        supply = unitPrice * qtyUnits;
        tax = 0;
      } else {
        // 부가세 포함 단가 → 공급가액 = round(단가/1.1)*수량
        displayPrice = Math.round(unitPrice / 1.1);
        supply = displayPrice * qtyUnits;
        tax = unitPrice * qtyUnits - supply;
      }
      if (itemMap[key]) {
        itemMap[key].qty += qtyUnits;
        itemMap[key].supply += supply;
        itemMap[key].tax += tax;
        itemMap[key].total += supply + tax;
      } else {
        // 우선순위: 이번에 고른 값 > 전에 끊었던 계정(pcEntry) > 매출이면 800 기본. 빈값('')도 800으로.
        const acCode = accountCodeOverrides[key] || pcEntry?.Account_Code || (stmtType === '매출' ? '800' : undefined);
        itemMap[key] = { key, no: no++, name: displayName, spec, qty: qtyUnits, price: unitPrice, supply, tax, total: supply + tax, isTaxExempt, accountCode: acCode };
      }
    });
    return Object.values(itemMap);
  }, [manualMode, manualItems, selectedOrder, allItems, partnerOut, partnerIn, selectedClientId, editablePrices, taxExemptOverrides, accountCodeOverrides, stmtType]);

  const totalSupply = lineItems.reduce((s, r) => s + r.supply, 0);
  const totalTax    = lineItems.reduce((s, r) => s + r.tax, 0);
  const totalAmount = totalSupply + totalTax;

  const tradeDateObj = new Date(tradeDate + 'T00:00:00');
  const dateStr = `${tradeDateObj.getFullYear()}년 ${tradeDateObj.getMonth() + 1}월 ${tradeDateObj.getDate()}일`;
  const docNo   = `${tradeDateObj.getFullYear()}-${String(tradeDateObj.getMonth() + 1).padStart(2, '0')}-${String(issuedStatements.length + 1).padStart(4, '0')}`;

  const inboundPartnerLabel = stmtType === '매출' ? '【 공급자 】' : `【 공급자 】　${selectedClient?.name||''}`;
  const receiverLabel = stmtType === '매출' ? `【 공급받는자 】　${selectedClient?.name||''}` : '【 공급받는자 】';

  // ── 발행 처리 ──
  const missingAccountCodes = lineItems.filter(i => !i.accountCode);
  const canIssue = lineItems.length > 0 && !!selectedClientId && (manualMode || !!selectedOrderId);

  const markIssued = useCallback(() => {
    if (!selectedClientId || lineItems.length === 0) return;
    // 발행 차단(백스톱) — 인쇄·세금계산서·엑셀 경로에서도 계정 미설정/단가 0이면 발행 기록 안 함
    if (lineItems.some(i => !i.accountCode)) { alert('계정과목이 설정되지 않은 품목이 있어 발행할 수 없습니다.'); return; }
    if (lineItems.some(i => !i.price || i.price <= 0)) { alert('단가가 0인 품목이 있어 발행할 수 없습니다.'); return; }
    if (selectedOrderId) {
      onMarkInvoicePrinted?.(selectedOrderId, true);
    }
    const stmt: IssuedStatement = {
      id: `stmt-${Date.now()}`,
      issuedAt: new Date().toISOString(),
      tradeDate,
      type: stmtType,
      partnerId: selectedClientId,
      partnerName: selectedClient?.name || '',
      orderId: selectedOrderId,
      docNo,
      totalSupply,
      totalTax,
      totalAmount,
      items: lineItems.map(i => ({
        name: i.name, spec: i.spec, qty: i.qty, price: i.price,
        supply: i.supply, tax: i.tax, total: i.total, isTaxExempt: i.isTaxExempt,
        isBoxUnit: i.isBoxUnit, boxSize: i.boxSize, accountCode: i.accountCode || undefined,
      })),
      // 매입전표: 발주된 품목 ID 목록 (purchaseOrders 연결용)
      ...(stmtType === '매입' ? {
        purchaseOrderIds: lineItems
          .map(i => allItems.find(p => p.name === i.name))
          .filter(Boolean)
          .map(p => p!.id),
      } : {}),
    };
    onAddIssuedStatement?.(stmt);
    // 매입전표 발행 시 발주카드 처리:
    //  - 발주카드 선택해서 발행 → 그 PO들의 linkedStatementId에 전표 id 연결 + 입고대기 전환
    //  - 발주카드 없이 직접입력 발행 → 같은 거래처로 품목 묶어 새 입고대기 카드 1개 생성(전표 id 연결)
    if (stmtType === '매입') {
      if (loadedPoIds.length > 0) {
        loadedPoIds.forEach(poId => onLinkPurchaseOrder?.(poId, stmt.id));
      } else if (selectedClientId) {
        // 품목에 매칭되는 줄만 발주카드로 — 비용 항목(택배비·상차비·기타)은 발주/입고 대상 아님 → 제외
        const newItems = lineItems
          .map(item => {
            const product = allItems.find(p => p.name === item.name || p.품목 === item.name);
            return product ? { itemId: product.id, itemName: item.name, quantity: item.qty, isBox: item.isBoxUnit, unit: product.unit || '개' } : null;
          })
          .filter((it): it is NonNullable<typeof it> => it !== null);
        if (newItems.length > 0) {
          onCreateInboundPO?.({ partnerId: selectedClientId, partnerName: selectedClient?.name || '', statementId: stmt.id, items: newItems });
        }
      }
    }
    // 매출전표 발행 시 매출단가/계정 자동 저장 (partner_item canonical price = 매출단가)
    if (stmtType === '매출' && onUpsertPartnerItem) {
      for (const item of lineItems) {
        if (!item.price || item.price <= 0) continue;
        const product = allItems.find(p => p.name === item.name || p.품목 === item.name);
        if (!product || !selectedClientId) continue;
        const pc = partnerOut.find(p => (p.itemId) === product.id && (p.partnerId) === selectedClientId);
        const pcId = pc?.id ?? `${product.id}_${selectedClientId}_out`;
        const priceChanged = !pc || pc.price !== item.price;
        const accountChanged = !!(item.accountCode && pc?.Account_Code !== item.accountCode);
        if (priceChanged || accountChanged) {
          onUpsertPartnerItem({ ...(pc ?? {}), id: pcId, itemId: product.id, partnerId: selectedClientId, Direction: 'out' as const, price: item.price, taxType: pc?.taxType, Account_Code: item.accountCode || pc?.Account_Code });
        }
      }
    }
    // 주문 기반 전표에서 품목/수량 변경 시 원본 주문 업데이트 (반품=음수 수량이면 주문 카드 영향 없음)
    const hasReturn = manualItems.some(r => (parseFloat(r.qty) || 0) < 0);
    if (manualMode && selectedOrderId && onUpdateOrder && selectedOrder && !hasReturn) {
      // 기존 주문 품목 이름 집합 (매칭용)
      const existingItemNames = new Set(selectedOrder.items.map(oi => {
        const product = allItems.find(p => p.id === oi.itemId);
        return (product?.name ||oi.name).trim();
      }));
      // 기존 품목: 수량 업데이트
      const updatedItems = selectedOrder.items.map(oi => {
        const product = allItems.find(p => p.id === oi.itemId);
        const displayName = product?.name ||oi.name;
        const row = manualItems.find(r => r.name.trim() === displayName.trim());
        if (row) return { ...oi, quantity: parseFloat(row.qty) || oi.quantity };
        return oi;
      });
      // 새로 추가된 품목: 기존 주문에 없는 항목 추가
      for (const row of manualItems) {
        const name = row.name.trim();
        if (!name || existingItemNames.has(name)) continue;
        const qty = parseFloat(row.qty) || 0;
        if (qty <= 0) continue;
        const product = allItems.find(p => p.name === name || p.품목 === name);
        updatedItems.push({
          itemId: product?.id || '',
          name,
          quantity: qty,
          price: parseFloat(row.price) || 0,
        });
      }
      onUpdateOrder(selectedOrderId, { items: updatedItems });
    }
    // 매입전표 발행 시 원가/계정 자동 저장 (partner_item canonical price = 원가, items.cost 동기화)
    // 가드 없이 항상 동기화 — 구독(partnerIn) 지연으로 직전 저장값과 비교가 빗나가 누락되는 문제 방지
    if (stmtType === '매입' && onUpsertPartnerItem) {
      for (const item of lineItems) {
        if (!item.price || item.price <= 0) continue;
        const product = allItems.find(p => p.name === item.name || p.품목 === item.name);
        if (!product || !selectedClientId) continue;
        const existing = partnerIn.find(s => (s.itemId) === product.id && (s.partnerId) === selectedClientId);
        const psId = existing?.id ?? `${product.id}_${selectedClientId}_in`;
        onUpsertPartnerItem({ ...(existing ?? {}), id: psId, itemId: product.id, partnerId: selectedClientId, Direction: 'in' as const, price: item.price, taxType: existing?.taxType, Account_Code: item.accountCode || existing?.Account_Code });
        onUpdateItemCost?.(product.id, item.price);
      }
    }
  }, [manualMode, selectedOrderId, selectedClientId, tradeDate, stmtType, selectedClient, docNo, totalSupply, totalTax, totalAmount, lineItems, onMarkInvoicePrinted, onAddIssuedStatement, onAddConfirmedOrder, onRemoveConfirmedOrder, onRemoveOrderRequest, onCreateInboundPO, onLinkPurchaseOrder, loadedPoIds, allItems, confirmedOrders, orderRequests, partnerOut, partnerIn, onUpsertPartnerItem, onUpdateItemCost, onUpdateOrder, selectedOrder, manualItems]);

  const handleIssue = () => {
    // 계정과목 미설정 품목이 있으면 발행 차단 (매출은 800 기본이라 대개 매입에서 걸림)
    if (missingAccountCodes.length > 0) {
      alert(`계정과목이 설정되지 않은 품목이 ${missingAccountCodes.length}건 있습니다.\n(${missingAccountCodes.slice(0, 3).map(i => i.name).join(', ')}${missingAccountCodes.length > 3 ? ' 외' : ''})\n계정을 설정해야 발행할 수 있습니다.`);
      return;
    }
    // 단가 0(미입력) 품목이 있으면 발행 차단
    const zeroPriceItems = lineItems.filter(i => !i.price || i.price <= 0);
    if (zeroPriceItems.length > 0) {
      alert(`단가가 0인 품목이 ${zeroPriceItems.length}건 있습니다.\n(${zeroPriceItems.slice(0, 3).map(i => i.name).join(', ')}${zeroPriceItems.length > 3 ? ' 외' : ''})\n단가를 입력해야 발행할 수 있습니다.`);
      return;
    }
    // ── 중복 발행 가드 — 발행 직전 같은 거래가 이미 발행됐는지 확인 ──
    //   · 주문 기반: 같은 주문(orderId)으로 이미 발행됨
    //   · 수동/매입: 같은 거래처+거래일+합계로 이미 발행됨 (주문 없는 매입 중복 방지)
    //   확정이 아니라 확인(confirm) — 정당하게 같은 금액이 반복될 수 있으니 사용자가 넘길 수 있게.
    const dup = mergedStatements.find(s =>
      s.type === stmtType && s.id !== editingStmt?.id && (
        (!!selectedOrderId && s.orderId === selectedOrderId) ||
        (!selectedOrderId && !!selectedClientId && s.partnerId === selectedClientId &&
          s.tradeDate === tradeDate && Math.abs((s.totalAmount ?? 0) - totalAmount) < 1)
      )
    );
    if (dup) {
      const ok = window.confirm(
        `⚠️ 이미 발행된 전표가 있습니다.\n\n· ${dup.partnerName} / ${dup.tradeDate} / ${Number(dup.totalAmount ?? 0).toLocaleString()}원\n· 문서번호 ${dup.docNo}\n\n중복 발행일 수 있습니다. 그래도 발행할까요?`
      );
      if (!ok) return;
    }
    markIssued();
    closeCreate();
  };

  const handleSaveEdit = useCallback(() => {
    if (!editingStmt || lineItems.length === 0) return;
    const proposed: Partial<IssuedStatement> = {
      tradeDate,
      partnerId: selectedClientId,
      partnerName: selectedClient?.name || '',
      totalSupply,
      totalTax,
      totalAmount,
      items: lineItems.map(i => ({
        name: i.name, spec: i.spec, qty: i.qty, price: i.price,
        supply: i.supply, tax: i.tax, total: i.total, isTaxExempt: i.isTaxExempt,
        isBoxUnit: i.isBoxUnit, boxSize: i.boxSize, accountCode: i.accountCode || undefined,
      })),
    };
    // 거래명세서 탭에서의 수정은 즉시 반영 (확인사항 안 거침)
    // ※ 입고대기 발주카드 수정 → 연결된 전표 수정요청은 AdminApp.handleRequestPoEdit 경로(별도)
    onUpdateIssuedStatement?.(editingStmt.id, proposed);
    // 매입전표면 원가/매입단가 동기화 (markIssued와 동일)
    if (editingStmt.type === '매입' && onUpsertPartnerItem) {
      for (const item of lineItems) {
        if (!item.price || item.price <= 0) continue;
        const product = allItems.find(p => p.name === item.name || p.품목 === item.name);
        if (!product || !selectedClientId) continue;
        const existing = partnerIn.find(s => (s.itemId) === product.id && (s.partnerId) === selectedClientId);
        const psId = existing?.id ?? `${product.id}_${selectedClientId}_in`;
        // 가드 없이 항상 동기화 (구독 지연으로 인한 누락 방지)
        onUpsertPartnerItem({ ...(existing ?? {}), id: psId, itemId: product.id, partnerId: selectedClientId, Direction: 'in' as const, price: item.price, taxType: existing?.taxType, Account_Code: item.accountCode || existing?.Account_Code });
        onUpdateItemCost?.(product.id, item.price);
      }
    }
    setIsEditMode(false);
    closeCreate();
    alert('전표가 수정되었습니다.');
  }, [editingStmt, tradeDate, selectedClientId, selectedClient, totalSupply, totalTax, totalAmount, lineItems, onUpdateIssuedStatement, onUpsertPartnerItem, onUpdateItemCost, allItems, partnerIn]);

  const buildPrintHtml = (items: LineItem[] | IssuedStatement['items'], sup: number, tax: number, amt: number, type: StatementType, partner: string, docNoStr: string, dateString: string) => {
    const m = dateString.match(/(\d+)년\s*(\d+)월\s*(\d+)일/);
    const yyyy = m ? m[1] : '';
    const mmN  = m ? m[2] : '';
    const dd   = m ? m[3] : '';
    const dateLabel = `${yyyy}-${mmN.padStart(2,'0')}-${dd.padStart(2,'0')}`;

    const ci = companyInfo;
    const isSale = type === '매출';

    const supName    = isSale ? (ci?.name || '') : partner;
    const supCeo     = isSale ? (ci?.ceoName || '') : '';
    const supBizNo   = isSale ? (ci?.bizNo || '') : '';
    const supBizType = isSale ? (ci?.bizType || '') : '';
    const supBizItem = isSale ? (ci?.bizItem || '') : '';
    const supAddr    = isSale ? (ci?.address || '') : '';
    const supPhone   = isSale ? (ci?.phone || '') : '';
    const supFax     = isSale ? (ci?.fax || '') : '';

    const buyName    = isSale ? partner : (ci?.name || '');
    const buyCeo     = isSale ? '' : (ci?.ceoName || '');
    const buyBizNo   = isSale ? '' : (ci?.bizNo || '');
    const buyBizType = isSale ? '' : (ci?.bizType || '');
    const buyBizItem = isSale ? '' : (ci?.bizItem || '');
    const buyAddr    = isSale ? '' : (ci?.address || '');
    const buyPhone   = isSale ? (partners.find(c => c.name === partner)?.phone || '') : (ci?.phone || '');
    const buyFax   = isSale ? '' : (ci?.fax||'');

    const MAX_ROWS = 9;
    const itemList = items as any[];
    const totalQty = itemList.reduce((s,i)=>s+(Number(i.qty)||0),0);

    const makePage = (borderColor: string, pageLabel: string, stripeColor: string) => {
      const BC = borderColor;
      const SC = stripeColor;
      const LB = '#efefef';

      // ── 헤더 (테두리 바깥) ──
      const headerHtml = `
<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:0.5mm;">
  <span style="font-size:8px;">[순백지 출력_FA15출]</span>
  <span style="font-size:20px;font-weight:bold;letter-spacing:6px;color:${BC};">거&nbsp;&nbsp;래&nbsp;&nbsp;명&nbsp;&nbsp;세&nbsp;&nbsp;서</span>
  <span style="font-size:8px;">[재발행]</span>
</div>
<div style="display:flex;justify-content:space-between;align-items:center;font-size:8px;margin-bottom:0.5mm;">
  <span>전표일자 : <strong>${dateLabel}</strong></span>
  <span style="color:${BC};font-weight:bold;">${pageLabel}</span>
  <span>전표NO. : <strong>${docNoStr}</strong></span>
</div>`;

      // ── 회사 정보 ──
      const V = (t:string, extra='') =>
        `<td style="border:1px solid ${BC};padding:1px 4px;font-size:8px;${extra}">${t}</td>`;
      const L = (t:string) =>
        `<td style="border:1px solid ${BC};background:${LB};padding:1px 4px;font-size:7.5px;font-weight:bold;white-space:nowrap;text-align:center;">${t}</td>`;

      const infoHtml = `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup>
    <col style="width:5.5mm;"/>
    <col style="width:13mm;"/><col/>
    <col style="width:5.5mm;"/>
    <col style="width:11mm;"/><col style="width:26mm;"/>
    <col style="width:13mm;"/><col style="width:22mm;"/>
  </colgroup>
  <tbody>
    <tr style="height:5.5mm;">
      <td rowspan="5" style="border:1px solid ${BC};background:${LB};text-align:center;vertical-align:middle;writing-mode:vertical-rl;letter-spacing:3px;font-size:8px;font-weight:bold;color:${BC};">공급받는자</td>
      ${L('상&nbsp;&nbsp;호')}${V(buyName,'font-weight:bold;font-size:9px;')}
      <td rowspan="5" style="border:1px solid ${BC};background:${LB};text-align:center;vertical-align:middle;writing-mode:vertical-rl;letter-spacing:3px;font-size:8px;font-weight:bold;color:${BC};">공급자</td>
      ${L('대&nbsp;&nbsp;표')}${V(supCeo,'font-weight:bold;')}${L('상&nbsp;&nbsp;호')}${V(supName,'font-weight:bold;font-size:9px;')}
    </tr>
    <tr style="height:5mm;">
      ${L('대&nbsp;&nbsp;표')}${V(buyCeo)}
      ${L('주&nbsp;&nbsp;소')}${V(supAddr,'font-size:7.5px;')} ${L('')}${V('')}
    </tr>
    <tr style="height:5mm;">
      ${L('사업자번호')}${V(buyBizNo)}
      ${L('전화번호')}${V(supPhone+(supFax?'&nbsp;&nbsp;FAX:'+supFax:''),'font-size:7.5px;')} ${L('')}${V('')}
    </tr>
    <tr style="height:5mm;">
      ${L('주&nbsp;&nbsp;소')}${V(buyAddr,'font-size:7.5px;')}
      ${L('사업번호')}${V(supBizNo)}${L('페이지')}${V('1 / 1','text-align:center;')}
    </tr>
    <tr style="height:5mm;">
      ${L('전화번호')}${V((buyPhone?buyPhone:'')+(buyFax?'&nbsp;&nbsp;FAX:'+buyFax:''),'font-size:7.5px;')}
      ${L('')}${V('')}${L('')}${V('')}
    </tr>
  </tbody>
</table>`;

      // ── 품목 테이블 ──
      const TH = (t:string) =>
        `<th style="border:1px solid ${BC};background:${SC};padding:1px 2px;font-size:8px;text-align:center;font-weight:bold;">${t}</th>`;

      const iRows = itemList.map((item:any, idx:number) => {
        const bg = idx%2===0 ? '#ffffff' : SC;
        return `<tr style="height:5.5mm;background:${bg};">
          <td style="border:1px solid ${BC};text-align:center;font-size:8px;padding:0 1px;">${idx+1}</td>
          <td style="border:1px solid ${BC};font-size:8px;padding:0 3px;overflow:hidden;white-space:nowrap;">${item.name||''}</td>
          <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;padding:0 2px;">${item.spec||''}</td>
          <td style="border:1px solid ${BC};text-align:center;font-size:8px;padding:0 2px;">${(item as any).unit||'개'}</td>
          <td style="border:1px solid ${BC};text-align:right;font-size:8px;padding:0 3px;">${(item as any).isBoxUnit ? `${item.qty}BOX(${item.qty*12}개)` : fmt(item.qty)}</td>
          <td style="border:1px solid ${BC};text-align:right;font-size:8px;padding:0 3px;">${fmt(item.price)}</td>
          <td style="border:1px solid ${BC};text-align:right;font-size:8px;padding:0 3px;">${fmt(item.total)}</td>
        </tr>`;
      }).join('');

      // **** 이하여백 **** — 마지막 아이템 바로 다음
      const blankBg0 = itemList.length%2===0 ? '#ffffff' : SC;
      const blankRow = `<tr style="height:5.5mm;background:${blankBg0};">
        <td style="border:1px solid ${BC};text-align:center;font-size:8px;padding:0;"></td>
        <td colspan="6" style="border:1px solid ${BC};font-size:8px;padding:0 3px;color:${BC};">*&nbsp;*&nbsp;*&nbsp;*&nbsp;&nbsp;이&nbsp;하&nbsp;여&nbsp;백&nbsp;&nbsp;*&nbsp;*&nbsp;*&nbsp;*</td>
      </tr>`;

      const emptyCount = Math.max(0, MAX_ROWS - itemList.length - 1);
      const eRows = Array.from({length:emptyCount}).map((_,idx)=>{
        const bg = (itemList.length+1+idx)%2===0 ? '#ffffff' : SC;
        return `<tr style="height:5.5mm;background:${bg};">
          <td style="border:1px solid ${BC};"></td><td style="border:1px solid ${BC};"></td>
          <td style="border:1px solid ${BC};"></td><td style="border:1px solid ${BC};"></td>
          <td style="border:1px solid ${BC};"></td><td style="border:1px solid ${BC};"></td>
          <td style="border:1px solid ${BC};"></td>
        </tr>`;
      }).join('');

      const itemsHtml = `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup>
    <col style="width:7mm;"/><col/><col style="width:19mm;"/>
    <col style="width:11mm;"/><col style="width:14mm;"/>
    <col style="width:19mm;"/><col style="width:23mm;"/>
  </colgroup>
  <thead>
    <tr style="background:${SC};">${TH('순번')}${TH('제&nbsp;&nbsp;&nbsp;품&nbsp;&nbsp;&nbsp;명')}${TH('규&nbsp;&nbsp;격')}${TH('단&nbsp;&nbsp;위')}${TH('수&nbsp;&nbsp;량')}${TH('단&nbsp;&nbsp;가')}${TH('금&nbsp;&nbsp;액')}</tr>
  </thead>
  <tbody>${iRows}${blankRow}${eRows}</tbody>
</table>`;

      // ── 합계 (전표소계 + 합계 2행) ──
      const totalsHtml = `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup>
    <col style="width:14mm;"/><col style="width:12mm;"/>
    <col style="width:14mm;"/><col style="width:14mm;"/>
    <col style="width:18mm;"/><col style="width:14mm;"/>
    <col style="width:18mm;"/><col style="width:12mm;"/><col/>
  </colgroup>
  <tr style="height:5mm;background:${SC};">
    <td colspan="2" style="border:1px solid ${BC};text-align:center;font-size:7.5px;font-weight:bold;">전표소계&nbsp;수량</td>
    <td style="border:1px solid ${BC};"></td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;font-weight:bold;">공급가</td>
    <td style="border:1px solid ${BC};"></td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;font-weight:bold;">부가세</td>
    <td style="border:1px solid ${BC};"></td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;font-weight:bold;">합&nbsp;계</td>
    <td style="border:1px solid ${BC};"></td>
  </tr>
  <tr style="height:5mm;background:${SC};">
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;font-weight:bold;">합&nbsp;&nbsp;&nbsp;계</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;">수량</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:8px;font-weight:bold;padding:0 3px;">${fmt(totalQty)}</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;">공급가</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:8px;font-weight:bold;padding:0 3px;">${fmt(sup)}</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;">부가세</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:8px;font-weight:bold;padding:0 3px;">${fmt(tax)}</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:7.5px;">합계</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:8px;font-weight:bold;padding:0 3px;">${fmt(amt)}</td>
  </tr>
</table>`;

      // ── 하단: 비고 | 인수 | 미수금 ──
      const now = new Date();
      const h = now.getHours(); const mn = now.getMinutes(); const sc2 = now.getSeconds();
      const ampm = h<12?'오전':'오후'; const hh = h%12||12;

      const bottomHtml = `
<table style="width:100%;border-collapse:collapse;">
  <tr>
    <td style="border:1px solid ${BC};width:5.5mm;text-align:center;vertical-align:top;font-size:9px;font-weight:bold;padding:2px 1px;">비</td>
    <td rowspan="2" style="border:1px solid ${BC};vertical-align:bottom;padding:2px 4px;font-size:7.5px;min-height:14mm;"></td>
    <td rowspan="2" style="border:1px solid ${BC};width:18mm;text-align:center;vertical-align:middle;font-size:8px;font-weight:bold;padding:2px;">인<br/><br/>수<br/><br/>확<br/><br/>인</td>
    <td rowspan="2" style="border:1px solid ${BC};padding:0;vertical-align:top;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:7.5px;padding:1px 3px;white-space:nowrap;">전일미수</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:7.5px;padding:1px 4px;min-width:24mm;">0</td></tr>
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:7.5px;padding:1px 3px;">금일판매</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:7.5px;padding:1px 4px;">${fmt(amt)}</td></tr>
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:7.5px;padding:1px 3px;">금일입금</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:7.5px;padding:1px 4px;">0</td></tr>
        <tr><td style="border-right:1px solid ${BC};font-size:7.5px;font-weight:bold;padding:1px 3px;">금일미수</td>
            <td style="text-align:right;font-size:8px;font-weight:bold;padding:1px 4px;">${fmt(amt)}</td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="border:1px solid ${BC};width:5.5mm;text-align:center;vertical-align:bottom;font-size:9px;font-weight:bold;padding:2px 1px;">고</td>
  </tr>
</table>
<div style="display:flex;justify-content:space-between;font-size:7px;margin-top:0.5mm;color:#555;padding:0 1mm;">
  <span>발행일시 : ${dateLabel} ${ampm} ${hh}:${String(mn).padStart(2,'0')}:${String(sc2).padStart(2,'0')}</span>
  <span>${ci?.name||''}&nbsp;/&nbsp;${ci?.phone||''}</span>
</div>`;

      return `
<div style="font-family:'맑은 고딕',sans-serif;color:#000;box-sizing:border-box;">
  ${headerHtml}
  <div style="border:1.5px solid ${BC};">${infoHtml}${itemsHtml}${totalsHtml}${bottomHtml}</div>
</div>`;
    };

    return `
<div style="width:210mm;display:flex;flex-direction:column;gap:3mm;padding:5mm 6mm;box-sizing:border-box;">
  ${makePage('#cc0000','(공급자용)','#f5d8b0')}
  ${makePage('#0044cc','(공급받는자용)','#c4d4f0')}
</div>`;
  };

  const printViaIframe = (html: string, title: string) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open();
    doc.write(`<html><head><title>${title}</title>
      <style>
        @page{size:A4 portrait;margin:0;}
        *{margin:0;padding:0;box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
        body{font-family:'맑은 고딕',sans-serif;font-size:8px;color:#000;}
        table{border-collapse:collapse;}
      </style></head><body>${html}</body></html>`);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => { document.body.removeChild(iframe); }, 1000);
    }, 400);
  };

  const handlePrint = () => {
    const html = buildPrintHtml(lineItems, totalSupply, totalTax, totalAmount, stmtType, selectedClient?.name || '', docNo, dateStr);
    printViaIframe(html, `${stmtType}전표`);
    // 인쇄는 '출력'만 — 발행(저장)은 '저장' 버튼(markIssued) 한 곳에서만. 저장된 전표만 인쇄 가능.
  };

  const handleDetailPrint = (stmt: IssuedStatement) => {
    const d = new Date(stmt.tradeDate + 'T00:00:00');
    const ds = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
    const html = buildPrintHtml(stmt.items as any, stmt.totalSupply, stmt.totalTax, stmt.totalAmount, stmt.type, stmt.partnerName, stmt.docNo, ds);
    printViaIframe(html, `${stmt.type}전표`);
  };

  const handleTaxInvoice = () => {
    const ci = companyInfo;
    const isSale = stmtType === '매출';
    const partnerObj = selectedClient;
    const taxableItems = lineItems.filter(i => !i.isTaxExempt);
    const exemptItems  = lineItems.filter(i => i.isTaxExempt);
    const taxSupply = taxableItems.reduce((s,i)=>s+i.supply, 0);
    const taxAmt    = taxableItems.reduce((s,i)=>s+i.tax, 0);
    const exSupply  = exemptItems.reduce((s,i)=>s+i.supply, 0);

    const supName  = isSale ? (ci?.name||'') : (partnerObj?.name||'');
    const supBizNo = isSale ? (ci?.bizNo||'') : '';
    const supCeo   = isSale ? (ci?.ceoName||'') : '';
    const supAddr  = isSale ? (ci?.address||'') : (partnerObj?.region||'');
    const supBizType = isSale ? (ci?.bizType||'') : '';
    const supBizItem = isSale ? (ci?.bizItem||'') : '';
    const buyName  = isSale ? (partnerObj?.name||'') : (ci?.name||'');
    const buyBizNo = isSale ? '' : (ci?.bizNo||'');
    const buyCeo   = isSale ? '' : (ci?.ceoName||'');
    const buyAddr  = isSale ? (partnerObj?.region||'') : (ci?.address||'');
    const buyBizType = isSale ? '' : (ci?.bizType||'');
    const buyBizItem = isSale ? '' : (ci?.bizItem||'');

    const d = new Date(tradeDate+'T00:00:00');
    const yyyy = d.getFullYear(), mm = d.getMonth()+1, dd = d.getDate();

    const fmt2 = (n:number) => n.toLocaleString('ko-KR');

    const makeInfoTable = (title: string, bizNo: string, name: string, ceo: string, addr: string, bizType: string, bizItem: string) => `
<table style="border-collapse:collapse;width:100%;font-size:8px;">
  <tr>
    <td rowspan="4" style="border:1px solid #000;padding:2px 4px;font-weight:bold;text-align:center;width:16px;writing-mode:vertical-rl;letter-spacing:2px;">${title}</td>
    <td style="border:1px solid #000;padding:1px 4px;background:#f0f0f0;font-weight:bold;white-space:nowrap;">등록번호</td>
    <td colspan="3" style="border:1px solid #000;padding:1px 4px;font-weight:bold;letter-spacing:2px;">${bizNo}</td>
  </tr>
  <tr>
    <td style="border:1px solid #000;padding:1px 4px;background:#f0f0f0;font-weight:bold;white-space:nowrap;">상&nbsp;&nbsp;&nbsp;호</td>
    <td style="border:1px solid #000;padding:1px 4px;width:30%;">${name}</td>
    <td style="border:1px solid #000;padding:1px 4px;background:#f0f0f0;font-weight:bold;white-space:nowrap;">성&nbsp;&nbsp;&nbsp;명</td>
    <td style="border:1px solid #000;padding:1px 4px;">${ceo}</td>
  </tr>
  <tr>
    <td style="border:1px solid #000;padding:1px 4px;background:#f0f0f0;font-weight:bold;white-space:nowrap;">사업장주소</td>
    <td colspan="3" style="border:1px solid #000;padding:1px 4px;">${addr}</td>
  </tr>
  <tr>
    <td style="border:1px solid #000;padding:1px 4px;background:#f0f0f0;font-weight:bold;white-space:nowrap;">업&nbsp;&nbsp;&nbsp;태</td>
    <td style="border:1px solid #000;padding:1px 4px;">${bizType}</td>
    <td style="border:1px solid #000;padding:1px 4px;background:#f0f0f0;font-weight:bold;white-space:nowrap;">종&nbsp;&nbsp;&nbsp;목</td>
    <td style="border:1px solid #000;padding:1px 4px;">${bizItem}</td>
  </tr>
</table>`;

    const itemRows = lineItems.map(item => `
<tr>
  <td style="border:1px solid #000;padding:1px 3px;text-align:center;">${mm}</td>
  <td style="border:1px solid #000;padding:1px 3px;text-align:center;">${dd}</td>
  <td style="border:1px solid #000;padding:1px 3px;">${item.name}</td>
  <td style="border:1px solid #000;padding:1px 3px;text-align:center;">${item.spec||''}</td>
  <td style="border:1px solid #000;padding:1px 3px;text-align:right;">${item.isBoxUnit ? `${item.qty}BOX(${item.qty*12}개)` : fmt2(item.qty)}</td>
  <td style="border:1px solid #000;padding:1px 3px;text-align:right;">${fmt2(item.price)}</td>
  <td style="border:1px solid #000;padding:1px 3px;text-align:right;">${fmt2(item.supply)}</td>
  <td style="border:1px solid #000;padding:1px 3px;text-align:right;">${item.isTaxExempt?'면세':fmt2(item.tax)}</td>
  <td style="border:1px solid #000;padding:1px 3px;"></td>
</tr>`).join('');

    const emptyRows = Math.max(0, 9 - lineItems.length);
    const blankRows = Array(emptyRows).fill(`<tr>${Array(9).fill('<td style="border:1px solid #000;height:14px;"></td>').join('')}</tr>`).join('');

    const makePage = (copyLabel: string) => `
<div style="page-break-after:always;padding:6mm;font-family:'맑은 고딕',sans-serif;font-size:8px;color:#000;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2mm;">
    <div style="font-size:7px;">※ 이 계산서는 부가가치세법 제32조 규정에 의하여 작성한 것입니다.</div>
    <div style="font-size:18px;font-weight:900;letter-spacing:6px;">세&nbsp;금&nbsp;계&nbsp;산&nbsp;서</div>
    <div style="font-size:9px;font-weight:bold;border:1px solid #000;padding:2px 8px;">${copyLabel}</div>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1mm;font-size:8px;">
    <span>작성일자: <strong>${yyyy}년 ${mm}월 ${dd}일</strong></span>
    <span>공급가액: <strong style="font-size:10px;">${fmt2(taxSupply+exSupply)}</strong>원</span>
    <span>세&nbsp;&nbsp;&nbsp;&nbsp;액: <strong style="font-size:10px;">${fmt2(taxAmt)}</strong>원</span>
    <span>전표No: <strong>${docNo}</strong></span>
  </div>
  <div style="display:flex;gap:4mm;margin-bottom:2mm;">
    <div style="flex:1;">${makeInfoTable('공급자', supBizNo, supName, supCeo, supAddr, supBizType, supBizItem)}</div>
    <div style="flex:1;">${makeInfoTable('공급받는자', buyBizNo, buyName, buyCeo, buyAddr, buyBizType, buyBizItem)}</div>
  </div>
  <table style="border-collapse:collapse;width:100%;font-size:8px;">
    <thead>
      <tr style="background:#f0f0f0;">
        <th style="border:1px solid #000;padding:2px 3px;width:18px;">월</th>
        <th style="border:1px solid #000;padding:2px 3px;width:18px;">일</th>
        <th style="border:1px solid #000;padding:2px 3px;">품&nbsp;&nbsp;&nbsp;&nbsp;목</th>
        <th style="border:1px solid #000;padding:2px 3px;width:50px;">규격</th>
        <th style="border:1px solid #000;padding:2px 3px;width:35px;">수량</th>
        <th style="border:1px solid #000;padding:2px 3px;width:60px;">단가</th>
        <th style="border:1px solid #000;padding:2px 3px;width:70px;">공급가액</th>
        <th style="border:1px solid #000;padding:2px 3px;width:60px;">세액</th>
        <th style="border:1px solid #000;padding:2px 3px;width:50px;">비고</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}${blankRows}
    </tbody>
    <tfoot>
      <tr style="background:#f0f0f0;font-weight:bold;">
        <td colspan="2" style="border:1px solid #000;padding:2px 3px;text-align:center;">합계</td>
        <td style="border:1px solid #000;"></td>
        <td style="border:1px solid #000;"></td>
        <td style="border:1px solid #000;padding:2px 3px;text-align:right;">${fmt2(lineItems.reduce((s,i)=>s+i.qty,0))}</td>
        <td style="border:1px solid #000;"></td>
        <td style="border:1px solid #000;padding:2px 3px;text-align:right;">${fmt2(taxSupply+exSupply)}</td>
        <td style="border:1px solid #000;padding:2px 3px;text-align:right;">${fmt2(taxAmt)}</td>
        <td style="border:1px solid #000;"></td>
      </tr>
    </tfoot>
  </table>
  <div style="margin-top:2mm;display:flex;justify-content:space-between;font-size:8px;">
    <span>합계금액(공급가액+세액): <strong style="font-size:11px;">${fmt2(taxSupply+exSupply+taxAmt)}</strong>원</span>
    ${exSupply>0?`<span style="color:#555;">면세공급가액: ${fmt2(exSupply)}원 포함</span>`:''}
    <span style="color:#888;">※ 국세청 홈택스(www.hometax.go.kr) 전자세금계산서 발급 시 이 서류를 참고하세요</span>
  </div>
</div>`;

    const html = makePage('공급자 보관용') + makePage('공급받는자 보관용');
    printViaIframe(html, '세금계산서');   // 출력만 — 발행은 '저장'에서만
  };

  const handleReceipt = () => {
    const ci = companyInfo;
    const fmt2 = (n:number) => n.toLocaleString('ko-KR');
    const d = new Date(tradeDate+'T00:00:00');
    const ds = `${d.getFullYear()}.${d.getMonth()+1}.${d.getDate()}`;
    const html = `
<div style="font-family:'맑은 고딕',sans-serif;font-size:9px;color:#000;width:80mm;margin:0 auto;padding:4mm;">
  <div style="text-align:center;font-size:16px;font-weight:900;border-bottom:2px solid #000;padding-bottom:3mm;margin-bottom:3mm;">영&nbsp;&nbsp;수&nbsp;&nbsp;증</div>
  <div style="display:flex;justify-content:space-between;margin-bottom:1mm;">
    <span>일자: <strong>${ds}</strong></span>
    <span>No: ${docNo}</span>
  </div>
  <div style="margin-bottom:3mm;border-bottom:1px solid #ccc;padding-bottom:2mm;">
    <div>공급자: <strong>${ci?.name||''}</strong></div>
    <div>사업자: ${ci?.bizNo||''}</div>
    <div>주소: ${ci?.address||''}</div>
    <div>대표: ${ci?.ceoName||''}</div>
  </div>
  <div style="margin-bottom:1mm;border-bottom:1px solid #000;padding-bottom:1mm;font-weight:bold;">
    <span>거래처: ${selectedClient?.name||''}</span>
  </div>
  <table style="border-collapse:collapse;width:100%;margin-bottom:2mm;font-size:8px;">
    <thead>
      <tr style="background:#f0f0f0;">
        <th style="border:1px solid #ccc;padding:1px 3px;text-align:left;">품목</th>
        <th style="border:1px solid #ccc;padding:1px 3px;text-align:center;">수량</th>
        <th style="border:1px solid #ccc;padding:1px 3px;text-align:right;">금액</th>
      </tr>
    </thead>
    <tbody>
      ${lineItems.map(i=>`<tr>
        <td style="border:1px solid #ccc;padding:1px 3px;">${i.name}${i.spec?' ('+i.spec+')':''}</td>
        <td style="border:1px solid #ccc;padding:1px 3px;text-align:center;">${fmt2(i.qty)}</td>
        <td style="border:1px solid #ccc;padding:1px 3px;text-align:right;">${fmt2(i.total)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div style="border-top:2px solid #000;padding-top:2mm;">
    <div style="display:flex;justify-content:space-between;"><span>공급가액</span><span>${fmt2(totalSupply)}원</span></div>
    <div style="display:flex;justify-content:space-between;"><span>부가세</span><span>${fmt2(totalTax)}원</span></div>
    <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:900;margin-top:1mm;border-top:1px solid #000;padding-top:1mm;">
      <span>합계</span><span>${fmt2(totalAmount)}원</span>
    </div>
  </div>
  <div style="margin-top:4mm;text-align:center;font-size:7px;color:#888;">위 금액을 정히 영수합니다</div>
  <div style="margin-top:6mm;text-align:right;">서&nbsp;&nbsp;명:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div>
</div>`;
    printViaIframe(html, '영수증');
  };

  const handleExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`${stmtType}전표`);
    const border: Partial<ExcelJS.Borders> = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
    const hFill: ExcelJS.Fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD9E1F2'} };
    ws.columns = [{width:5},{width:20},{width:10},{width:8},{width:12},{width:14},{width:12},{width:14}];
    ws.mergeCells('A1:H1');
    const t = ws.getCell('A1');
    t.value = stmtType === '매출' ? '거  래  명  세  서' : '거  래  명  세  서 (매입)';
    t.font = {bold:true,size:18}; t.alignment={horizontal:'center',vertical:'middle'}; ws.getRow(1).height=36;
    ws.mergeCells('A2:D2'); ws.getCell('A2').value=`문서번호: ${docNo}`;
    ws.mergeCells('E2:H2'); ws.getCell('E2').value=`거래일자: ${dateStr}`; ws.getCell('E2').alignment={horizontal:'right'}; ws.getRow(2).height=18;
    ws.getRow(3).height=16; ws.mergeCells('A3:D3');
    ws.getCell('A3').value = stmtType==='매출' ? '【 공급자 】' : `【 공급자 】  ${selectedClient?.name||''}`;
    ws.getCell('A3').fill=hFill; ws.getCell('A3').font={bold:true}; ws.getCell('A3').border=border;
    ws.mergeCells('E3:H3');
    ws.getCell('E3').value = stmtType==='매출' ? `【 공급받는자 】  ${selectedClient?.name||''}` : '【 공급받는자 】';
    ws.getCell('E3').fill=hFill; ws.getCell('E3').font={bold:true}; ws.getCell('E3').border=border;
    ws.addRow([]);
    const hRow = ws.addRow(['No','품목명','규격','수량','단가','공급가액','세액','합계']);
    hRow.height=18; hRow.eachCell(c=>{c.font={bold:true,size:9};c.fill=hFill;c.border=border;c.alignment={horizontal:'center',vertical:'middle'};});
    lineItems.forEach(item=>{
      const r=ws.addRow([item.no,item.name,item.spec,item.qty,item.price,item.supply,item.isTaxExempt?'면세':item.tax,item.total]);
      r.height=16; r.eachCell((c,col)=>{c.border=border;c.font={size:9};c.alignment={horizontal:col<=3?'left':'right',vertical:'middle'};if(col>=4&&col!==7)c.numFmt='#,##0';});
    });
    const em=Math.max(0,10-lineItems.length);
    for(let i=0;i<em;i++){const r=ws.addRow(['','','','','','','','']);r.height=14;r.eachCell(c=>{c.border=border;});}
    const sr=ws.addRow(['합계','','','','',totalSupply,totalTax,totalAmount]);
    sr.height=18; sr.eachCell((c,col)=>{c.border=border;c.font={bold:true,size:9};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEFF6FF'}};c.alignment={horizontal:col<=3?'center':'right',vertical:'middle'};if(col>=5)c.numFmt='#,##0';});
    ws.mergeCells(`A${sr.number}:E${sr.number}`);
    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=`${stmtType}전표_${selectedClient?.name||''}_${tradeDate}.xlsx`; a.click();
    URL.revokeObjectURL(url);
    // 엑셀은 '저장(내보내기)'만 — 발행은 '저장' 버튼에서만
  };

  // ── 단가 패널 / 등록 품목 ──
  // 매출 전표용: partnerOut 테이블 기반 (거래처별 단가 포함)
  const partnerItemRows = useMemo(() =>
    partnerOut.filter(pc=>pc.partnerId===selectedClientId)
      .map(pc=>({ pc, product: allItems.find(p=>p.id===pc.itemId) }))
      .filter(r=>r.product && !isBoxStockItem(r.product)),   // 박스 품목은 전표에서 제외(낱개만)
    [partnerOut, selectedClientId, allItems]
  );

  // 매입 전표용: supplierId로 연결된 품목 + PartnerItem 단가
  // pc는 PartnerItem 호환 shim (searchableRows 공통 사용을 위해)
  const inboundPartnerItemRows = useMemo(() =>
    allItems
      // partnerIn 직접 조회 — 한 품목에 매입처가 여러 개여도, 대/소문자 필드 혼재여도 정상 매칭
      .filter(p => !isBoxStockItem(p) && partnerIn.some(ps => (ps.itemId) === p.id && (ps.partnerId) === selectedClientId))   // 박스 제외(낱개만)
      .map(p => {
        const ps = partnerIn.find(s => (s.itemId) === p.id && (s.partnerId) === selectedClientId)
          ?? { id: `${p.id}_${selectedClientId}`, itemId: p.id, partnerId: selectedClientId } as PartnerItem;
        return { pc: ps, ps, product: p };
      }),
    [allItems, selectedClientId, partnerIn]
  );

  // 현재 모드에 따른 검색 소스
  const searchableRows = createMode === '매입' ? inboundPartnerItemRows : partnerItemRows;

  // 품목 선택 피커 전체 풀 — 거래처에 등록된 품목 + 미등록 전체 품목(반제품·원료·부자재 포함). 검색 시 전품목 대상.
  const pickerRows = useMemo(() => {
    const linkedIds = new Set(searchableRows.map(r => r.product!.id));
    const src = createMode === '매입' ? partnerIn : partnerOut;
    const extra = allItems
      .filter(p => !linkedIds.has(p.id) && !isBoxStockItem(p))   // 박스 품목은 전표 피커에서 제외(낱개만)
      .map(p => {
        const ex = src.find(pc => (pc.itemId) === p.id && (pc.partnerId) === selectedClientId);
        return { pc: { id: ex?.id ?? p.id, itemId: p.id, partnerId: selectedClientId, price: ex?.price ?? ex?.price ?? p.price, taxType: ex?.taxType }, product: p };
      });
    return [...searchableRows, ...extra] as unknown as typeof searchableRows;
  }, [searchableRows, allItems, createMode, partnerIn, partnerOut, selectedClientId]);

  // 단가 저장 (매출: price, 매입: price)
  const savePcPrice = (pc: PartnerItem) => {
    const val = parseFloat(pricePanelEdits[pc.id] || '');
    if (!isNaN(val) && val >= 0) onUpsertPartnerItem?.({ ...pc, price: val });
  };

  const savePsPrice = (ps: PartnerItem, newPrice: number) => {
    if (isNaN(newPrice) || newPrice < 0) return;
    onUpsertPartnerItem?.({ ...ps, price: newPrice });
    const itemId = ps.itemId;
    if (itemId) onUpdateItemCost?.(itemId, newPrice);
  };

  // ── 등록 품목 추가 (직접입력 모드) ──
  const addProductRow = useCallback((pc: typeof partnerItemRows[0]) => {
    setManualItems(prev => {
      const filled = prev.filter(r => r.name.trim());
      return [
        ...filled,
        { name: pc.product!.name, spec: pc.product!.spec || '', qty: '1', price: String(pc.pc.price ?? pc.product!.price ?? 0), isTaxExempt: false },
        { name: '', spec: '', qty: '', price: '', isTaxExempt: false },
      ];
    });
  }, []);

  // ── 전표 통합 타임라인 (거래명세서 + 수금/지불 + 자금 입출금) ──
  type StmtRow = { kind: 'stmt'; data: IssuedStatement; cumul: number; dateKey: string; ts: string };
  type PayRow  = { kind: 'pay';  partnerId: string; partnerName: string; stmtType: '매출'|'매입';
                   date: string; amount: number; method?: string; note?: string;
                   paymentId: string; cumul: number; dateKey: string; ts: string; src: IssuedStatement };
  // 자금 입출금 전표 — 전표에 상계되지 않은 순수 현금 이동(전기요금·급여·상환·기계구입 등)
  type CashRow = { kind: 'cash'; entry: CashEntry; dir: '입금'|'출금'; amount: number;
                   accountCode?: string; note?: string; partnerName?: string;
                   date: string; ts: string; dateKey: string };
  type TimelineRow = StmtRow | PayRow | CashRow;

  // 화면 표시값 기준 정렬용 시각 (로컬 HH:MM:SS)
  const timeOf = (iso?: string) => {
    if (!iso) return '00:00:00';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  };

  const allTimelineRows = useMemo((): TimelineRow[] => {
    const rows: TimelineRow[] = [];
    const grouped = new Map<string, IssuedStatement[]>();
    mergedStatements.forEach(s => {
      const key = `${s.partnerId}__${s.type}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(s);
    });
    grouped.forEach(stmts => {
      type Ev =
        | { kind: 'stmt'; s: IssuedStatement; date: string; ts: string }
        | { kind: 'pay';  date: string; ts: string; amount: number; method?: string; note?: string; paymentId: string; src: IssuedStatement };
      const evs: Ev[] = [];
      stmts.forEach(s => {
        evs.push({ kind: 'stmt', s, date: s.tradeDate, ts: `${s.tradeDate}T${timeOf(s.issuedAt)}` });
        // 구 payments[]
        (s.payments ?? []).forEach(p =>
          evs.push({ kind: 'pay', date: p.date, ts: `${p.date}T${timeOf(p.createdAt)}`, amount: p.amount, method: p.method, note: p.note, paymentId: p.id, src: s })
        );
        // 자금원장 매칭 — 지불/수금처리가 이제 여기로 들어온다. 자금 기록이 지워졌으면 상계로 치지 않는다.
        settlements.filter(st => st.statementId === s.id).forEach(st => {
          const e = cashEntryById.get(st.cashEntryId);
          if (!e) return;
          evs.push({ kind: 'pay', date: e.date, ts: `${e.date}T${timeOf(e.createdAt)}`, amount: st.amount, method: '계좌이체', note: e.note, paymentId: st.id, src: s });
        });
      });
      // 실제 발생시각(ts) 오름차순으로 누적잔액 계산. 동시각이면 전표 먼저(매출 가산 후 수금 차감)
      evs.sort((a, b) => {
        const d = (a.ts ?? '').localeCompare(b.ts ?? '');
        if (d !== 0) return d;
        if (a.kind === 'stmt' && b.kind === 'pay') return -1;
        if (a.kind === 'pay' && b.kind === 'stmt') return 1;
        return 0;
      });
      let running = 0;
      evs.forEach(e => {
        if (e.kind === 'stmt') {
          running += e.s.totalAmount;
          rows.push({ kind: 'stmt', data: e.s, cumul: running, dateKey: `${e.date}__${e.ts}`, ts: e.ts });
        } else {
          running -= e.amount;
          rows.push({ kind: 'pay', partnerId: e.src.partnerId, partnerName: e.src.partnerName,
            stmtType: e.src.type as '매출' | '매입', date: e.date, amount: e.amount, method: e.method, note: e.note,
            paymentId: e.paymentId, cumul: running, dateKey: `${e.date}__${e.ts}`, ts: e.ts, src: e.src });
        }
      });
    });
    // ── 자금 입출금 전표 ── 전표에 상계된 부분은 이미 pay 행으로 보이므로, 미상계 잔액만 자금 행으로.
    const settledByEntry = new Map<string, number>();
    settlements.forEach(st => settledByEntry.set(st.cashEntryId, (settledByEntry.get(st.cashEntryId) ?? 0) + st.amount));
    cashEntries.forEach(e => {
      const settled = settledByEntry.get(e.id) ?? 0;
      const unmatched = e.amount - settled;
      if (unmatched <= 0.5) return; // 전액 전표 상계 → pay 행으로만 (부동소수 여유)
      rows.push({
        kind: 'cash', entry: e, dir: e.dir, amount: unmatched,
        accountCode: e.accountCode, note: e.note, partnerName: e.partnerName,
        date: e.date, ts: `${e.date}T${timeOf(e.createdAt)}`, dateKey: `${e.date}`,
      });
    });
    return rows;
  }, [mergedStatements, settlements, cashEntryById, cashEntries]);

  const filteredHistory = useMemo((): TimelineRow[] => {
    return allTimelineRows
      .filter(row => {
        const d = row.kind === 'stmt' ? row.data.tradeDate : row.date;
        const name = (row.kind === 'stmt' ? row.data.partnerName : row.kind === 'pay' ? row.partnerName : (row.partnerName ?? '')) || '';
        // 필터 유형: 매출/매입 전표, 비용(대체=type '비용'), 자금(입출금 cash 행)
        const type = row.kind === 'stmt' ? row.data.type : row.kind === 'pay' ? row.stmtType : '자금';
        const docNo = row.kind === 'stmt' ? row.data.docNo : '';
        const note  = row.kind === 'cash' ? (row.note ?? '') : '';
        if (histFrom && d < histFrom) return false;
        if (histTo   && d > histTo)   return false;
        // 자금 필터 = 실제 돈 이동 전부(수금/지불 pay 행 + 입출금 cash 행). 매출/매입/비용은 기존대로.
        if (histTypeFilter !== '전체') {
          const ok = histTypeFilter === '자금'
            ? (row.kind === 'pay' || row.kind === 'cash')
            : type === histTypeFilter;
          if (!ok) return false;
        }
        if (histSearch.trim()) {
          const q = histSearch.toLowerCase();
          if (!name.toLowerCase().includes(q) && !docNo.includes(q) && !note.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // 실제 발생시각(ts) 오래된→최신 — 전표·지불 통합 정렬
        const d = a.ts.localeCompare(b.ts);
        if (d !== 0) return d;
        // 동시각이면 전표를 위로(매출 가산 후 수금 차감 순)
        if (a.kind === 'stmt' && b.kind === 'pay') return -1;
        if (a.kind === 'pay' && b.kind === 'stmt') return 1;
        return 0;
      }); // 오래된→최신
  }, [allTimelineRows, histFrom, histTo, histTypeFilter, histSearch]);

  // 페이지네이션: 필터 변경 시 1페이지로 리셋, 최신 페이지부터 보여줌
  useEffect(() => { setHistoryPage(1); }, [histFrom, histTo, histTypeFilter, histSearch]);
  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / HIST_PAGE_SIZE));
  const pagedHistory = useMemo(() => {
    // 최신순(역방향)으로 표시하기 위해 뒤에서부터 슬라이싱
    const reversed = [...filteredHistory].reverse();
    const start = (historyPage - 1) * HIST_PAGE_SIZE;
    return reversed.slice(start, start + HIST_PAGE_SIZE);
  }, [filteredHistory, historyPage]);

  // 거래처별 미수금/미지급금 총합 맵 (전체 전표 기준)
  const partnerBalanceMap = useMemo(() => {
    const map = new Map<string, { receivable: number; payable: number }>();
    mergedStatements.forEach(s => {
      const bal = s.totalAmount - (s.payments ?? []).reduce((a, p) => a + p.amount, 0);
      if (bal <= 0) return;
      const key = s.partnerId;
      const cur = map.get(key) ?? { receivable: 0, payable: 0 };
      if (s.type === '매출') cur.receivable += bal;
      else cur.payable += bal;
      map.set(key, cur);
    });
    return map;
  }, [issuedStatements]);


  // 전체 미수금/미지급금 (필터 무관, 항상 전체 기준)
  const receivableSummary = useMemo(() => {
    let totalReceivable = 0, countReceivable = 0;
    let totalPayable = 0, countPayable = 0;
    partnerBalanceMap.forEach(({ receivable, payable }) => {
      if (receivable > 0) { totalReceivable += receivable; countReceivable++; }
      if (payable > 0) { totalPayable += payable; countPayable++; }
    });
    return { totalReceivable, countReceivable, totalPayable, countPayable };
  }, [partnerBalanceMap]);

  const setQuickRange = (preset: '당일'|'금주'|'당월'|'당년'|'ALL') => {
    setHistQuick(preset);
    if (preset === 'ALL') { setHistFrom(''); setHistTo(''); return; }
    const t = today();
    if (preset === '당일')  { setHistFrom(t); setHistTo(t); }
    if (preset === '금주')  { setHistFrom(weekMonday()); setHistTo(weekSunday()); } // 월~일 고정
    if (preset === '당월')  { setHistFrom(monthStart()); setHistTo(monthEnd()); }   // 1일~말일 고정
    if (preset === '당년')  { setHistFrom(yearStart()); setHistTo(t); }
  };

  // ── 주문 클릭 처리 (중복 발행 감지) ──
  const handleOrderClick = (o: Order) => {
    const existing = issuedStatements.find(s => s.orderId === o.id);
    if (existing && o.invoicePrinted) {
      setWarnDuplicate({ order: o, stmt: existing });
    } else {
      if (o.id === selectedOrderId) {
        setSelectedOrderId('');
        setManualMode(false);
        setManualItems([{ name: '', spec: '', qty: '', price: '', isTaxExempt: false }]);
      } else {
        setSelectedOrderId(o.id);
        setTradeDate(o.createdAt.slice(0, 10));
        setShowPreview(false);
        setEditablePrices({});
        setTaxExemptOverrides({});
        // 주문 품목을 편집 가능한 형태로 미리 채움
        const rows: ManualRow[] = o.items.map(item => {
          const product = allItems.find(p => p.id === item.itemId);
          const displayName = product?.name || item.name;
          const spec = item.displaySize || product?.spec || '';
          const pcEntry = partnerOut.find(pc => pc.itemId === item.itemId && pc.partnerId === o.partnerId);
          const price = pcEntry?.price ?? item.price ?? product?.price ?? 0;
          const isTaxExempt = pcEntry?.taxType === '면세';
          return { name: displayName, spec, qty: String(item.quantity), price: String(price), isTaxExempt, note: '', accountCode: pcEntry?.Account_Code };
        });
        rows.push({ name: '', spec: '', qty: '', price: '', isTaxExempt: false, note: '' });
        setManualItems(rows);
        setManualMode(true);
      }
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">

      <PageHeader
        title="거래명세서"
        subtitle="발행된 전표를 조회하거나 새 전표를 생성합니다."
        right={
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1 overflow-x-auto no-scrollbar">
            {([
              { id: 'history', icon: ClipboardList, label: '전표내역' },
            ] as const).map(t => (
              <button key={t.id}
                onClick={() => setMainTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all whitespace-nowrap ${mainTab === t.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <t.icon size={13}/>{t.label}
              </button>
            ))}
          </div>
        }
      />

      {/* ── 세금계산서 탭 (TaxStatement 컴포넌트로 이동) ── */}
      {false && (() => {
        const taxClients = partners
          .filter(c => mergedStatements.some(s => s.partnerId === c.id && s.type === '매출'))
          .filter(c => !taxClientSearch || c.name.includes(taxClientSearch))
          .sort((a, b) => a.name.localeCompare(b.name));

        const partnerStmts = taxClientId
          ? mergedStatements.filter(s => s.partnerId === taxClientId && s.type === '매출')
              .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
          : [];

        // 월별 그룹
        const byMonth = new Map<string, IssuedStatement[]>();
        partnerStmts.forEach(s => {
          const ym = s.tradeDate.slice(0, 7);
          if (!byMonth.has(ym)) byMonth.set(ym, []);
          byMonth.get(ym)!.push(s);
        });
        const months = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));

        // 선택된 전표들
        const selectedStmts = partnerStmts.filter(s => taxStmtIds.includes(s.id));

        // 선택 전표 품목 합산 (과세/면세 분리)
        type MergedItem = { name: string; spec: string; qty: number; supply: number; tax: number; total: number; isTaxExempt: boolean };
        const mergedMap = new Map<string, MergedItem>();
        selectedStmts.forEach(stmt => {
          stmt.items.forEach(item => {
            const k = `${item.name}||${item.spec}||${item.isTaxExempt}`;
            const ex = mergedMap.get(k);
            if (ex) { ex.qty += item.qty; ex.supply += item.supply; ex.tax += item.tax; ex.total += item.total; }
            else mergedMap.set(k, { name: item.name, spec: item.spec, qty: item.qty, supply: item.supply, tax: item.tax, total: item.total, isTaxExempt: !!item.isTaxExempt });
          });
        });
        const allCombined = [...mergedMap.values()];
        const taxableItems = allCombined.filter(i => !i.isTaxExempt);
        const exemptItems  = allCombined.filter(i => i.isTaxExempt);
        const taxSupply  = taxableItems.reduce((s, i) => s + i.supply, 0);
        const taxAmt     = taxableItems.reduce((s, i) => s + i.tax, 0);
        const exemptSup  = exemptItems.reduce((s, i) => s + i.supply, 0);
        const grandTotal = taxSupply + taxAmt + exemptSup;

        const toggleStmt = (id: string) =>
          setTaxStmtIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

        const toggleMonth = (ym: string) => {
          const ids = (byMonth.get(ym) || []).map(s => s.id);
          const allSel = ids.every(id => taxStmtIds.includes(id));
          setTaxStmtIds(prev => allSel ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
        };

        const selectedClient = partners.find(c => c.id === taxClientId);
        const sup = companyInfo;
        const tradeMonth = selectedStmts.length > 0 ? selectedStmts[selectedStmts.length - 1].tradeDate.slice(0, 7) : '';

        const handleTaxPdf = async () => {
          if (!taxPrintRef.current || selectedStmts.length === 0) return;
          const html2canvas = (await import('html2canvas')).default;
          const jsPDF = (await import('jspdf')).default;
          const canvas = await html2canvas(taxPrintRef.current, { scale: 2, useCORS: true });
          const imgData = canvas.toDataURL('image/png');
          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
          const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
          const imgW = pageW - 20, imgH = canvas.height * imgW / canvas.width;
          const yOffset = imgH < pageH ? (pageH - imgH) / 2 : 10;
          pdf.addImage(imgData, 'PNG', 10, yOffset, imgW, imgH);
          pdf.save(`세금계산서_${selectedClient?.name}_${tradeMonth}.pdf`);
          selectedStmts.forEach(s => onUpdateIssuedStatement?.(s.id, { taxIssuedAt: new Date().toISOString() }));
        };

        const handleTaxShare = async () => {
          if (!taxPrintRef.current || selectedStmts.length === 0) return;
          const html2canvas = (await import('html2canvas')).default;
          const jsPDF = (await import('jspdf')).default;
          const canvas = await html2canvas(taxPrintRef.current, { scale: 2, useCORS: true });
          const imgData = canvas.toDataURL('image/png');
          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
          const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
          const imgW = pageW - 20, imgH = canvas.height * imgW / canvas.width;
          pdf.addImage(imgData, 'PNG', 10, imgH < pageH ? (pageH - imgH) / 2 : 10, imgW, imgH);
          const filename = `거래명세서_${selectedClient?.name}_${tradeMonth}.pdf`;
          const blob = pdf.output('blob');
          const file = new File([blob], filename, { type: 'application/pdf' });
          if (navigator.share && navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: `거래명세서 - ${selectedClient?.name}` });
          } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename; a.click();
            URL.revokeObjectURL(url);
          }
        };

        const handleTaxIssue = () => {
          if (selectedStmts.length === 0) return;
          const issuedAt = new Date().toISOString();
          selectedStmts.forEach(s => onUpdateIssuedStatement?.(s.id, { taxIssuedAt: issuedAt }));
          setTaxStmtIds([]);
        };

        const handleTaxPrint = () => {
          if (!taxPrintRef.current || selectedStmts.length === 0) return;
          const win = window.open('', '_blank', 'width=900,height=700');
          if (!win) return;
          win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>세금계산서</title>
            <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:10px;background:#fff;padding:12px;}
            .wrap{border:2px solid #000;width:100%;}.title-row{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #000;padding:6px 10px;}
            .title-row h1{font-size:18px;font-weight:900;letter-spacing:6px;}.info-grid{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #000;}
            .info-box{padding:6px 8px;border-right:1px solid #000;}.info-box:last-child{border-right:none;}
            .info-box h3{font-size:9px;font-weight:900;color:#333;margin-bottom:4px;border-bottom:1px solid #eee;padding-bottom:2px;}
            .info-row{display:flex;gap:4px;margin-bottom:2px;font-size:9px;}.info-row label{color:#666;width:64px;}
            .items-table{width:100%;border-collapse:collapse;font-size:9px;}
            .items-table th{background:#f5f5f5;border:1px solid #ccc;padding:4px 6px;font-weight:900;text-align:center;}
            .items-table td{border:1px solid #ccc;padding:4px 6px;text-align:right;}.items-table td.left{text-align:left;}.items-table td.center{text-align:center;}
            .section-header{background:#e8f0fe;font-weight:900;font-size:9px;padding:3px 6px;border:1px solid #ccc;}
            .total-row{display:flex;justify-content:flex-end;gap:16px;padding:8px 10px;border-top:2px solid #000;font-size:11px;font-weight:900;}
            @media print{body{padding:0;}@page{margin:8mm;}}</style></head><body>`);
          win.document.write(taxPrintRef.current.innerHTML);
          win.document.write('</body></html>');
          win.document.close(); win.focus();
          setTimeout(() => win.print(), 500);
        };

        const fmt2 = (n: number) => n.toLocaleString('ko-KR');
        const buyer = selectedClient;

        return (
          <div className="flex gap-4 min-h-[600px]">
            {/* 좌측: 거래처 + 월별 전표 선택 */}
            <div className="w-64 shrink-0 flex flex-col gap-3">
              {/* 거래처 목록 */}
              <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden" style={{maxHeight:280}}>
                <div className="px-3 pt-3 pb-2 border-b border-slate-100">
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                    <input type="text" placeholder="거래처 검색..." value={taxClientSearch}
                      onChange={e => setTaxClientSearch(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                  {taxClients.map(c => (
                    <button key={c.id} onClick={() => { setTaxClientId(c.id); setTaxStmtIds([]); }}
                      className={`w-full text-left px-3 py-2.5 transition-all hover:bg-emerald-50 ${taxClientId === c.id ? 'bg-emerald-50 border-r-2 border-emerald-500' : ''}`}>
                      <span className={`text-xs font-black ${taxClientId === c.id ? 'text-emerald-700' : 'text-slate-700'}`}>{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 선택 요약 */}
              {taxStmtIds.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 space-y-1.5">
                  <div className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">{taxStmtIds.length}건 선택</div>
                  {taxSupply > 0 && <div className="text-xs text-slate-600">과세 공급가: <b>{fmt2(taxSupply)}</b>원</div>}
                  {taxAmt > 0 && <div className="text-xs text-slate-600">세액: <b>{fmt2(taxAmt)}</b>원</div>}
                  {exemptSup > 0 && <div className="text-xs text-slate-600">면세 공급가: <b>{fmt2(exemptSup)}</b>원</div>}
                  <div className="text-sm font-black text-emerald-700 border-t border-emerald-200 pt-1.5">합계 {fmt2(grandTotal)}원</div>
                  <div className="flex gap-1.5 pt-1">
                    <button onClick={handleTaxIssue}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-black hover:bg-emerald-700">
                      <Check size={10}/>발행
                    </button>
                    <button onClick={handleTaxPdf}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-700">
                      <Download size={10}/>PDF
                    </button>
                    <button onClick={handleTaxPrint}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-slate-600 text-white rounded-lg text-[11px] font-black hover:bg-slate-700">
                      <Printer size={10}/>인쇄
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 우측: 월별 전표 목록 + 미리보기 */}
            <div className="flex-1 flex flex-col gap-3 min-w-0">
              {!taxClientId ? (
                <div className="flex flex-col items-center justify-center h-full bg-white rounded-2xl border border-dashed border-slate-200 py-20">
                  <FileText size={36} className="text-slate-200 mb-3"/>
                  <p className="text-slate-400 text-sm font-bold">거래처를 선택하세요</p>
                </div>
              ) : partnerStmts.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400 text-sm font-bold">발행된 전표가 없습니다</div>
              ) : (<>
                {/* 공급받는자 정보 */}
                <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">공급받는자 정보 (선택)</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: 'bizNo', label: '사업자번호', placeholder: '000-00-00000' },
                      { key: 'ceoName', label: '대표자명', placeholder: '홍길동' },
                      { key: 'bizType', label: '업태', placeholder: '제조업' },
                      { key: 'bizItem', label: '종목', placeholder: '식품' },
                      { key: 'address', label: '주소', placeholder: '사업장 주소' },
                    ].map(f => (
                      <div key={f.key}>
                        <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">{f.label}</label>
                        <input type="text" placeholder={f.placeholder}
                          value={(taxBuyerInfo as any)[f.key]}
                          onChange={e => setTaxBuyerInfo(prev => ({ ...prev, [f.key]: e.target.value }))}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 월별 전표 선택 */}
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  {months.map(ym => {
                    const stmts = byMonth.get(ym)!;
                    const allSel = stmts.every(s => taxStmtIds.includes(s.id));
                    const someSel = stmts.some(s => taxStmtIds.includes(s.id));
                    return (
                      <div key={ym}>
                        <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 border-b border-slate-100 sticky top-0">
                          <button onClick={() => toggleMonth(ym)}
                            className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${allSel ? 'bg-emerald-600 border-emerald-600' : someSel ? 'bg-emerald-200 border-emerald-400' : 'border-slate-300'}`}>
                            {(allSel || someSel) && <CheckSquare size={10} className="text-white"/>}
                          </button>
                          <span className="text-[11px] font-black text-slate-700">{ym.replace('-', '년 ')}월</span>
                          <span className="text-[10px] text-slate-400">{stmts.length}건</span>
                          <span className="ml-auto text-[11px] font-black text-slate-600">
                            {fmt2(stmts.reduce((s, r) => s + r.totalAmount, 0))}원
                          </span>
                        </div>
                        {stmts.map(s => {
                          const isSel = taxStmtIds.includes(s.id);
                          const isIssued = !!s.taxIssuedAt;
                          return (
                            <button key={s.id} onClick={() => toggleStmt(s.id)}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 text-left transition-all ${isSel ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}>
                              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${isSel ? 'bg-emerald-600 border-emerald-600' : 'border-slate-300'}`}>
                                {isSel && <CheckSquare size={10} className="text-white"/>}
                              </div>
                              <span className="text-xs font-black text-slate-700">{s.tradeDate}</span>
                              <span className="text-[10px] text-slate-400 font-mono">{s.docNo}</span>
                              <span className="text-[10px] text-slate-400 flex-1 truncate">
                                {s.items.slice(0,2).map(i=>i.name).join(', ')}{s.items.length>2?` 외 ${s.items.length-2}건`:''}
                              </span>
                              {isIssued && <span className="text-[9px] font-black bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full shrink-0">발행</span>}
                              <span className={`text-xs font-black shrink-0 ${isSel ? 'text-emerald-700' : 'text-slate-700'}`}>{fmt2(s.totalAmount)}원</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* 선택 전표 세금계산서 미리보기 */}
                {taxStmtIds.length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">세금계산서 미리보기</span>
                    </div>
                    {/* 과세/면세 총액 요약 카드 */}
                    <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-4">
                      {taxableItems.length > 0 && (
                        <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
                          <span className="text-[11px] font-black text-blue-600">과세</span>
                          <span className="text-xs text-slate-600">공급가 <b className="text-slate-900">{fmt2(taxSupply)}</b></span>
                          <span className="text-xs text-slate-600">세액 <b className="text-slate-900">{fmt2(taxAmt)}</b></span>
                          <span className="text-sm font-black text-blue-700">{fmt2(taxSupply+taxAmt)}원</span>
                        </div>
                      )}
                      {exemptItems.length > 0 && (
                        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5">
                          <span className="text-[11px] font-black text-indigo-600">면세</span>
                          <span className="text-xs text-slate-600">공급가 <b className="text-slate-900">{fmt2(exemptSup)}</b></span>
                          <span className="text-sm font-black text-indigo-700">{fmt2(exemptSup)}원</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5 ml-auto">
                        <span className="text-[11px] font-black text-emerald-600">합계</span>
                        <span className="text-lg font-black text-emerald-700">{fmt2(grandTotal)}원</span>
                      </div>
                    </div>
                    <div className="p-4 overflow-x-auto">
                      <div ref={taxPrintRef}>
                        <div className="wrap border-2 border-black" style={{fontFamily:"'Malgun Gothic','맑은 고딕',sans-serif",minWidth:640,fontSize:'11px'}}>
                          <div className="flex items-center justify-between border-b-2 border-black px-4 py-3">
                            <h1 style={{fontSize:'22px',fontWeight:900,letterSpacing:'6px'}}>세 금 계 산 서</h1>
                            <div className="text-right" style={{fontSize:'10px',color:'#666'}}>
                              <div>거래처: {buyer?.name}</div>
                              <div>발행기간: {tradeMonth}</div>
                            </div>
                          </div>
                          {/* 공급자 / 공급받는자 */}
                          <div className="grid grid-cols-2 border-b border-black">
                            <div className="p-3 border-r border-black">
                              <h3 style={{fontSize:'10px',fontWeight:900,marginBottom:'6px',paddingBottom:'4px',borderBottom:'1px solid #eee',color:'#444'}}>공 급 자</h3>
                              {[['등록번호', sup?.bizNo||''], ['상    호', sup?.name||''], ['대 표 자', sup?.ceoName||''], ['사업장주소', sup?.address||''], ['업    태', sup?.bizType||''], ['종    목', sup?.bizItem||'']].map(([label, value]) => (
                                <div key={label} style={{display:'flex',gap:'8px',marginBottom:'3px',fontSize:'10px'}}>
                                  <span style={{color:'#666',width:'60px',flexShrink:0}}>{label}</span>
                                  <span style={{fontWeight:700}}>{value}</span>
                                </div>
                              ))}
                            </div>
                            <div className="p-3">
                              <h3 style={{fontSize:'10px',fontWeight:900,marginBottom:'6px',paddingBottom:'4px',borderBottom:'1px solid #eee',color:'#444'}}>공급받는자</h3>
                              {[['등록번호', taxBuyerInfo.bizNo||''], ['상    호', buyer?.name||''], ['대 표 자', taxBuyerInfo.ceoName||''], ['사업장주소', taxBuyerInfo.address||''], ['업    태', taxBuyerInfo.bizType||''], ['종    목', taxBuyerInfo.bizItem||'']].map(([label, value]) => (
                                <div key={label} style={{display:'flex',gap:'8px',marginBottom:'3px',fontSize:'10px'}}>
                                  <span style={{color:'#666',width:'60px',flexShrink:0}}>{label}</span>
                                  <span style={{fontWeight:700}}>{value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          {/* 품목표 */}
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px'}}>
                            <thead>
                              <tr>
                                {['품목', '규격', '수량', '공급가액', '세액', '합계'].map(h => (
                                  <th key={h} style={{border:'1px solid #ccc',background:'#f5f5f5',padding:'6px 8px',fontWeight:900,textAlign:'center'}}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {taxableItems.length > 0 && (<>
                                <tr><td colSpan={6} style={{padding:'4px 8px',background:'#dbeafe',fontWeight:900,color:'#1d4ed8',border:'1px solid #ccc',fontSize:'10px'}}>▶ 과세 품목</td></tr>
                                {taxableItems.map((item, i) => (
                                  <tr key={i}>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',fontWeight:700}}>{item.name}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center'}}>{item.spec}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt2(item.qty)}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt2(item.supply)}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt2(item.tax)}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900}}>{fmt2(item.total)}</td>
                                  </tr>
                                ))}
                                <tr style={{background:'#eff6ff'}}>
                                  <td colSpan={3} style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>과세 소계</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt2(taxSupply)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt2(taxAmt)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#1d4ed8'}}>{fmt2(taxSupply+taxAmt)}</td>
                                </tr>
                              </>)}
                              {exemptItems.length > 0 && (<>
                                <tr><td colSpan={6} style={{padding:'4px 8px',background:'#e0e7ff',fontWeight:900,color:'#4338ca',border:'1px solid #ccc',fontSize:'10px'}}>▶ 면세 품목</td></tr>
                                {exemptItems.map((item, i) => (
                                  <tr key={i}>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',fontWeight:700}}>{item.name}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center'}}>{item.spec}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt2(item.qty)}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right'}}>{fmt2(item.supply)}</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'center',color:'#666'}}>면세</td>
                                    <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900}}>{fmt2(item.supply)}</td>
                                  </tr>
                                ))}
                                <tr style={{background:'#eef2ff'}}>
                                  <td colSpan={3} style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>면세 소계</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>{fmt2(exemptSup)}</td>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px'}}/>
                                  <td style={{border:'1px solid #ccc',padding:'5px 8px',textAlign:'right',fontWeight:900,color:'#4338ca'}}>{fmt2(exemptSup)}</td>
                                </tr>
                              </>)}
                              <tr style={{background:'#f1f5f9'}}>
                                <td colSpan={3} style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900,fontSize:'12px'}}>합 계</td>
                                <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900}}>{fmt2(taxSupply+exemptSup)}</td>
                                <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900}}>{fmt2(taxAmt)}</td>
                                <td style={{border:'1px solid #ccc',padding:'7px 8px',textAlign:'right',fontWeight:900,color:'#059669',fontSize:'13px'}}>{fmt2(grandTotal)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>)}
            </div>
          </div>
        );
      })()}

      {/* ── 회사 정보 설정 모달 ── */}
      {showCompanyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <span className="font-black text-slate-900">회사 정보 설정</span>
              <button onClick={() => setShowCompanyModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18}/></button>
            </div>
            <div className="px-6 py-5 space-y-3">
              {([
                { key: 'name', label: '상호 (회사명)', placeholder: '(주)회사명' },
                { key: 'bizNo', label: '사업자등록번호', placeholder: '000-00-00000' },
                { key: 'ceoName', label: '대표자명', placeholder: '홍길동' },
                { key: 'address', label: '사업장 주소', placeholder: '경기도 ...' },
                { key: 'bizType', label: '업태', placeholder: '제조업' },
                { key: 'bizItem', label: '종목', placeholder: '식품 제조·판매' },
                { key: 'phone', label: '전화번호', placeholder: '031-000-0000' },
                { key: 'fax', label: '팩스번호', placeholder: '031-000-0000' },
                { key: 'email', label: '이메일', placeholder: 'info@company.com' },
              ] as { key: keyof CompanyInfo; label: string; placeholder: string }[]).map(f => (
                <div key={f.key} className="grid grid-cols-3 items-center gap-3">
                  <label className="text-xs font-black text-slate-500 text-right">{f.label}</label>
                  <input type="text" placeholder={f.placeholder}
                    value={companyForm[f.key] ?? ''}
                    onChange={e => setCompanyForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="col-span-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                </div>
              ))}
            </div>
            <div className="flex gap-2 px-6 pb-5">
              <button onClick={() => setShowCompanyModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
              <button onClick={() => { onSaveCompanyInfo?.(companyForm); setShowCompanyModal(false); }}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 flex items-center justify-center gap-1.5">
                <Save size={13}/>저장
              </button>
            </div>
          </div>
        </div>
      )}

      {mainTab === 'history' && <>

      {/* ── 계좌 잔액 스트립 (보유자금 + 계좌별 현재잔액) ── */}
      {cashAccounts.length > 0 && (
        <div className="flex items-stretch gap-2 overflow-x-auto pb-1 mb-3">
          <div className="shrink-0 bg-slate-800 text-white rounded-2xl px-4 py-2.5">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-wide">보유자금 (통장+현금)</p>
            <p className="text-lg font-black tabular-nums leading-tight mt-0.5">{fmt(cashBalances.total)}<span className="text-[10px] ml-0.5 text-slate-400">원</span></p>
          </div>
          {cashBalances.perAccount.map(({ acct, bal }) => (
            <div key={acct.id} className="shrink-0 bg-white border border-slate-100 rounded-2xl px-4 py-2.5 min-w-[120px]">
              <p className="text-[9px] font-black text-slate-400 truncate flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-300"/>{acct.name}<span className="text-slate-300">· {acct.type}</span>
              </p>
              <p className={`text-sm font-black tabular-nums leading-tight mt-0.5 ${bal < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{fmt(bal)}</p>
            </div>
          ))}
          {onAddCashAccount && (
            <button onClick={() => setShowAccounts(true)}
              className="shrink-0 rounded-2xl px-3 border border-dashed border-slate-200 text-slate-300 hover:text-slate-500 hover:border-slate-400 transition-all"
              title="계좌 관리">
              <Landmark size={15}/>
            </button>
          )}
        </div>
      )}

      {/* ── 필터 바 + 액션 버튼 (같은 행: 필터 좌측 · 버튼 우측) ── */}
      <div className="flex flex-col md:flex-row md:items-start gap-3">
      <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200 px-4 py-3 space-y-2.5">
        {/* 1행: 기간 퀵버튼 + 날짜 직접입력 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest w-10 shrink-0">기간</span>
          {(['당일','금주','당월','당년','ALL'] as const).map(p => (
            <button key={p} onClick={()=>setQuickRange(p)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-black border transition-all ${
                histQuick===p
                  ? 'bg-slate-700 text-white border-slate-700'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400 hover:text-slate-700'
              }`}>{p}</button>
          ))}
          <div className="flex items-center gap-1.5 ml-1">
            <input type="date" value={histFrom}
              onChange={e=>{setHistFrom(e.target.value);setHistQuick('');}}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
            <span className="text-slate-300 text-xs">~</span>
            <input type="date" value={histTo}
              onChange={e=>{setHistTo(e.target.value);setHistQuick('');}}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
          </div>
        </div>
        <div className="border-t border-slate-100"/>
        {/* 2행: 유형 + 검색 + 건수 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest w-10 shrink-0">유형</span>
          {([['전체','전체'],['매출','매출'],['매입','매입'],['자금','자금'],['비용','대체']] as const).map(([val,label]) => (
            <button key={val} onClick={()=>setHistTypeFilter(val)}
              className={`px-3.5 py-1.5 rounded-lg text-[11px] font-black border transition-all ${
                histTypeFilter===val
                  ? val==='매출' ? 'bg-blue-600 text-white border-blue-600'
                    : val==='매입' ? 'bg-rose-600 text-white border-rose-600'
                    : val==='자금' ? 'bg-emerald-600 text-white border-emerald-600'
                    : val==='비용' ? 'bg-slate-500 text-white border-slate-500'
                    : 'bg-slate-700 text-white border-slate-700'
                  : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400 hover:text-slate-600'
              }`}>{label}</button>
          ))}
          <div className="relative flex-1 max-w-xs ml-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
            <input type="text" placeholder="업체명 또는 문서번호" value={histSearch}
              onChange={e=>setHistSearch(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"/>
          </div>
          {isFetchingHistory
            ? <span className="text-[11px] text-indigo-400 font-bold shrink-0 animate-pulse">불러오는 중…</span>
            : <span className="text-[11px] text-slate-400 font-bold shrink-0">{filteredHistory.length}건</span>
          }
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        {/* ── 전표 발행 (solid) ── */}
        {/* 거래명세서 — 매출/매입을 한 버튼에서 고른다 */}
        <div className="relative" ref={createMenuRef}>
          <button
            onClick={() => setCreateMenuOpen(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm shadow-indigo-200 transition-all"
          >
            <Plus size={13} strokeWidth={3}/>거래명세서<ChevronDown size={12} strokeWidth={3} className="-ml-0.5 opacity-80"/>
          </button>
          {createMenuOpen && (
            <div className="absolute left-0 top-full mt-1 z-20 bg-white rounded-xl shadow-xl border border-slate-100 p-1 w-28">
              <button onClick={() => { setCreateMenuOpen(false); openCreate('매출'); }} className="w-full text-left px-3 py-2 rounded-lg text-xs font-black text-blue-600 hover:bg-blue-50">매출전표</button>
              <button onClick={() => { setCreateMenuOpen(false); openCreate('매입'); }} className="w-full text-left px-3 py-2 rounded-lg text-xs font-black text-rose-600 hover:bg-rose-50">매입전표</button>
            </div>
          )}
        </div>
        <button
          onClick={() => openCashModal('출금')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-teal-600 text-white hover:bg-teal-500 shadow-sm shadow-teal-200 transition-all"
          title="입출금 — 수금·지불(미수/미지급 상계), 비용·대출상환·급여"
        >
          <Wallet size={13}/>입출금
        </button>
        {onGenerateRecurringCosts && (
          <button
            onClick={() => { setShowRecurring(true); setRecurringYm(today().slice(0, 7)); setRecurringMsg(''); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-violet-600 text-white hover:bg-violet-500 shadow-sm shadow-violet-200 transition-all"
            title="정기 고정비 템플릿으로 해당 월 전표를 한 번에 생성"
          >
            <RotateCw size={13} strokeWidth={3}/>정기비용
          </button>
        )}
        <button
          onClick={() => { setShowExpense(true); setExpDate(today()); setExpRows([{ name: '', spec: '', qty: '1', price: '', isTaxExempt: true }]); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-slate-700 text-white hover:bg-slate-600 shadow-sm shadow-slate-200 transition-all"
          title="현금도 거래처도 없는 손익 계상 — 감가상각비·퇴직급여충당금"
        >
          <Plus size={13} strokeWidth={3}/>대체전표
        </button>

        {/* 구분선 */}
        <div className="w-px h-6 bg-slate-200 mx-1 self-center"/>

        {/* ── 도구 (soft) ── */}
        {onAddCashAccount && (
          <button
            onClick={() => setShowAccounts(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-all"
            title="자금 계좌 관리 (통장·카드·현금)"
          >
            <Landmark size={13}/>계좌
          </button>
        )}
        <button
          onClick={() => { setShowCompanyModal(true); setCompanyForm(companyInfo ?? { name:'',ceoName:'',bizNo:'',bizType:'',bizItem:'',address:'',phone:'',fax:'',email:'' }); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-all"
          title="회사 정보 설정"
        >
          <Save size={13}/>회사정보
        </button>
      </div>
      </div>

      {/* ── 발행내역 테이블 ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {filteredHistory.length === 0 ? (
          <div className="py-16 text-center text-slate-300 text-sm font-bold">
            <FileText size={32} className="mx-auto mb-2 opacity-40"/>
            발행된 전표가 없습니다
          </div>
        ) : (<>
          <table className="w-full text-left hidden md:table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 whitespace-nowrap">전표일자</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 whitespace-nowrap">구분</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400">업체명</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 text-right whitespace-nowrap">금액</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 text-right whitespace-nowrap">거래처 누적잔액</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400">거래내역</th>
                <th className="px-4 py-3"/>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {pagedHistory.map(row => {
                if (row.kind === 'cash') {
                  // ── 자금 입출금 전표 행 ──
                  const acct = row.accountCode ? `${codeName.get(row.accountCode) ?? row.accountCode}` : '';
                  const detail = [acct, row.note].filter(Boolean).join(' · ');
                  return (
                    <tr key={`cash__${row.entry.id}`}
                      className={`transition-colors ${row.dir === '입금' ? 'bg-emerald-50/60 hover:bg-emerald-100/60' : 'bg-slate-50/60 hover:bg-slate-100/60'}`}>
                      <td className="px-4 py-2 text-[11px] font-mono text-slate-500 whitespace-nowrap">{row.date}{row.entry.createdAt ? ` ${row.entry.createdAt.slice(11,16)}` : ''}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${row.dir === '입금' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{row.dir}</span>
                      </td>
                      <td className="px-4 py-2 text-xs font-bold text-slate-700">{row.partnerName || <span className="text-slate-300">—</span>}</td>
                      <td className={`px-4 py-2 text-xs text-right font-black ${row.dir === '입금' ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(row.amount)}</td>
                      <td className="px-4 py-2 text-xs text-right text-slate-300">—</td>
                      <td className="px-4 py-2 text-[11px] text-slate-500 max-w-[180px] truncate">
                        {row.accountCode
                          ? detail
                          : <span className="text-amber-500 font-bold">계정 미지정{row.note ? ` · ${row.note}` : ''}</span>}
                      </td>
                      <td className="px-4 py-2">
                        {onDeleteCashEntry && (
                          <button onClick={() => { if (window.confirm('이 자금 전표를 삭제할까요?')) onDeleteCashEntry(row.entry.id); }}
                            className="text-slate-300 hover:text-rose-500 transition-all"><Trash2 size={13}/></button>
                        )}
                      </td>
                    </tr>
                  );
                }
                if (row.kind === 'pay') {
                  // ── 수금/지불 행 ──
                  const label = row.stmtType === '매출' ? '수금' : '지불';
                  const cumul = row.cumul;
                  return (
                    <tr key={`pay__${row.paymentId}`}
                      className={`cursor-pointer transition-colors ${row.stmtType === '매출' ? 'bg-lime-50/80 hover:bg-lime-100/80' : 'bg-orange-50/80 hover:bg-orange-100/80'}`}
                      onClick={() => { const p = row.src.payments?.find(p => p.id === row.paymentId); if (p) openEditPay(row.src, p); }}>
                      <td className="px-4 py-2 text-[11px] font-mono text-slate-500 whitespace-nowrap">{row.date}{(() => { const p = row.src.payments?.find(p => p.id === row.paymentId); return p?.createdAt ? ` ${p.createdAt.slice(11,16)}` : ''; })()}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${row.stmtType === '매출' ? 'bg-lime-100 text-lime-700' : 'bg-orange-100 text-orange-700'}`}>{label}</span>
                      </td>
                      <td className="px-4 py-2 text-xs font-bold text-slate-800">{row.partnerName}</td>
                      <td className="px-4 py-2 text-xs text-right font-black text-slate-800">{fmt(row.amount)}</td>
                      <td className="px-4 py-2 text-xs text-right">
                        {cumul === 0
                          ? <span className="font-black text-slate-400">0</span>
                          : cumul < 0
                            ? row.stmtType === '매출'
                              ? <span className="font-black text-rose-600">줄돈 {fmt(Math.abs(cumul))}</span>
                              : <span className="font-black text-blue-600">받을돈 {fmt(Math.abs(cumul))}</span>
                            : <span className={`font-black ${row.stmtType === '매출' ? 'text-blue-600' : 'text-rose-600'}`}>{fmt(cumul)}</span>
                        }
                      </td>
                      <td className="px-4 py-2 text-[11px] text-slate-400 max-w-[180px] truncate">
                        {[row.method, row.note].filter(Boolean).join(' · ')}
                      </td>
                      <td className="px-4 py-2"></td>
                    </tr>
                  );
                }
                // ── 전표 행 ──
                const stmt = row.data;
                const issuedDate = new Date(stmt.issuedAt);
                const dateLabel  = `${stmt.tradeDate} ${String(issuedDate.getHours()).padStart(2,'0')}:${String(issuedDate.getMinutes()).padStart(2,'0')}`;
                const stmtItems  = stmt.items ?? [];
                const summary    = stmtItems.slice(0, 2).map(i => i.name).join(', ') + (stmtItems.length > 2 ? ` 외 ${stmtItems.length - 2}건` : '');
                const isReturn   = stmtItems.some(i => i.qty < 0);
                const cumul = row.cumul;
                return (
                  <tr key={stmt.id} className={`transition-colors cursor-pointer ${isReturn ? 'bg-rose-50 hover:bg-rose-100' : 'hover:bg-slate-50'}`}
                    onClick={() => openEdit(stmt)}>
                    <td className="px-4 py-3 text-[11px] font-mono text-slate-600 whitespace-nowrap">{dateLabel}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          stmt.type === '매출' ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'
                        }`}>{stmt.type}</span>
                        {isReturn && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">반품</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-800">{stmt.partnerName}</td>
                    <td className={`px-4 py-3 text-xs text-right font-black ${isReturn ? 'text-rose-600' : 'text-slate-800'}`}>{fmt(stmt.totalAmount)}</td>
                    <td className="px-4 py-3 text-xs text-right">
                      {cumul === 0
                        ? <span className="font-black text-slate-400">0</span>
                        : cumul < 0
                          ? stmt.type === '매출'
                            ? <span className="font-black text-rose-600">줄돈 {fmt(Math.abs(cumul))}</span>
                            : <span className="font-black text-blue-600">받을돈 {fmt(Math.abs(cumul))}</span>
                          : <span className={`font-black ${stmt.type === '매출' ? 'text-blue-600' : 'text-rose-600'}`}>{fmt(cumul)}</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-400 max-w-[180px] truncate">{summary}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {getBalance(stmt) > 0 && (
                          <button onClick={e=>{e.stopPropagation();openPayModal(stmt);}}
                            className={`text-[10px] font-black px-2 py-1 rounded-lg transition-all flex items-center gap-1 ${
                              stmt.type === '매입'
                                ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                                : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                            }`}>
                            <Save size={10}/>{stmt.type === '매입' ? '지불처리' : '수금처리'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* ── 모바일 카드 목록 ── */}
          <div className="md:hidden divide-y divide-slate-100">
            {pagedHistory.map(row => {
              if (row.kind === 'cash') {
                const acct = row.accountCode ? (codeName.get(row.accountCode) ?? row.accountCode) : '';
                const detail = [acct, row.note].filter(Boolean).join(' · ');
                return (
                  <div key={`m-cash-${row.entry.id}`}
                    className={`px-4 py-3 flex flex-col gap-1.5 ${row.dir === '입금' ? 'bg-emerald-50/60' : 'bg-slate-50/60'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${row.dir === '입금' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{row.dir}</span>
                      <span className="text-[10px] font-mono text-slate-400">{row.date}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-700 truncate">{row.partnerName || (acct || '자금')}</span>
                      <span className={`text-sm font-black shrink-0 ${row.dir === '입금' ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(row.amount)}</span>
                    </div>
                    {detail && <p className="text-[11px] text-slate-400 truncate">{detail}</p>}
                  </div>
                );
              }
              if (row.kind === 'pay') {
                const label = row.stmtType === '매출' ? '수금' : '지불';
                const cumul = row.cumul;
                const memo = [row.method, row.note].filter(Boolean).join(' · ');
                return (
                  <button key={`m-pay-${row.paymentId}`}
                    onClick={() => { const p = row.src.payments?.find(p => p.id === row.paymentId); if (p) openEditPay(row.src, p); }}
                    className={`w-full text-left px-4 py-3 flex flex-col gap-1.5 ${row.stmtType === '매출' ? 'bg-lime-50/70' : 'bg-orange-50/70'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${row.stmtType === '매출' ? 'bg-lime-100 text-lime-700' : 'bg-orange-100 text-orange-700'}`}>{label}</span>
                      <span className="text-[10px] font-mono text-slate-400">{row.date}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-800 truncate">{row.partnerName}</span>
                      <span className="text-sm font-black text-slate-800 shrink-0">{fmt(row.amount)}</span>
                    </div>
                    {memo && <p className="text-[11px] text-slate-400 truncate">{memo}</p>}
                  </button>
                );
              }
              const stmt = row.data;
              const issuedDate = new Date(stmt.issuedAt);
              const dateLabel = `${stmt.tradeDate} ${String(issuedDate.getHours()).padStart(2,'0')}:${String(issuedDate.getMinutes()).padStart(2,'0')}`;
              const stmtItems = stmt.items ?? [];
              const summary = stmtItems.slice(0, 2).map(i => i.name).join(', ') + (stmtItems.length > 2 ? ` 외 ${stmtItems.length - 2}건` : '');
              const isReturn = stmtItems.some(i => i.qty < 0);
              const cumul = row.cumul;
              return (
                <div key={`m-${stmt.id}`} onClick={() => openEdit(stmt)}
                  className={`px-4 py-3 flex flex-col gap-1.5 cursor-pointer ${isReturn ? 'bg-rose-50' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${stmt.type === '매출' ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'}`}>{stmt.type}</span>
                      {isReturn && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">반품</span>}
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">{dateLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-800 truncate">{stmt.partnerName}</span>
                    <span className={`text-sm font-black shrink-0 ${isReturn ? 'text-rose-600' : 'text-slate-800'}`}>{fmt(stmt.totalAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400 truncate flex-1 min-w-0">{summary}</span>
                    {cumul !== 0 && (
                      cumul < 0
                        ? <span className={`text-[11px] font-black shrink-0 ${stmt.type === '매출' ? 'text-rose-600' : 'text-blue-600'}`}>{stmt.type === '매출' ? '줄돈' : '받을돈'} {fmt(Math.abs(cumul))}</span>
                        : <span className={`text-[11px] font-black shrink-0 ${stmt.type === '매출' ? 'text-blue-600' : 'text-rose-600'}`}>잔액 {fmt(cumul)}</span>
                    )}
                  </div>
                  {getBalance(stmt) > 0 && (
                    <button onClick={e => { e.stopPropagation(); openPayModal(stmt); }}
                      className={`self-start mt-0.5 text-[10px] font-black px-2.5 py-1 rounded-lg flex items-center gap-1 ${stmt.type === '매입' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
                      <Save size={10}/>{stmt.type === '매입' ? '지불처리' : '수금처리'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>)}
        {/* ── 매출/매입 합계 (현재 필터 기준) ── */}
        {filteredHistory.some(r => r.kind === 'stmt') && (() => {
          const stmts = filteredHistory.filter((r): r is Extract<TimelineRow, { kind: 'stmt' }> => r.kind === 'stmt');
          const sale = stmts.filter(r => r.data.type === '매출').reduce((s, r) => s + (r.data.totalAmount || 0), 0);
          const buy  = stmts.filter(r => r.data.type === '매입').reduce((s, r) => s + (r.data.totalAmount || 0), 0);
          return (
            <div className="flex items-center justify-end gap-6 px-4 py-3 border-t border-slate-200 bg-slate-50/60">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">매출 합계</span>
                <span className="font-black text-blue-700 text-sm">{fmt(sale)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest">매입 합계</span>
                <span className="font-black text-rose-700 text-sm">{fmt(buy)}</span>
              </div>
            </div>
          );
        })()}
        {/* 페이지네이션 */}
        {filteredHistory.length > HIST_PAGE_SIZE && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/40">
            <span className="text-[11px] text-slate-400 font-bold">
              {(historyPage - 1) * HIST_PAGE_SIZE + 1}–{Math.min(historyPage * HIST_PAGE_SIZE, filteredHistory.length)} / {filteredHistory.length}건
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setHistoryPage(1)}
                disabled={historyPage === 1}
                className="px-2.5 py-1 rounded-lg text-[11px] font-black border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
                « 최신
              </button>
              <button
                onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                disabled={historyPage === 1}
                className="px-2.5 py-1 rounded-lg text-[11px] font-black border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
                ‹ 이전
              </button>
              <span className="px-2.5 py-1 rounded-lg text-[11px] font-black bg-slate-700 text-white">
                {historyPage} / {historyTotalPages}
              </span>
              <button
                onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))}
                disabled={historyPage === historyTotalPages}
                className="px-2.5 py-1 rounded-lg text-[11px] font-black border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
                다음 ›
              </button>
              <button
                onClick={() => setHistoryPage(historyTotalPages)}
                disabled={historyPage === historyTotalPages}
                className="px-2.5 py-1 rounded-lg text-[11px] font-black border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed">
                과거 »
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 지불/수불 처리 모달 ── */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-black text-slate-800">
              {payTarget.type === '매입' ? '지불 처리' : '수금 처리'}
            </h3>
            <div className="text-xs text-slate-400">{payTarget.partnerName} · {payTarget.tradeDate}</div>
            <div className="bg-slate-50 rounded-xl px-4 py-3 text-xs flex items-center justify-between gap-3">
              <div>
                <span className="text-slate-500">잔액 </span>
                <span className={`font-black text-base ${getBalance(payTarget) <= 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
                  {getBalance(payTarget) <= 0 ? '완납' : `${fmt(getBalance(payTarget))}원`}
                </span>
              </div>
              {getBalance(payTarget) > 0 && (
                <button
                  onClick={() => setPayForm(p => ({ ...p, amount: String(getBalance(payTarget)) }))}
                  className="text-[10px] font-black px-2 py-1 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-all shrink-0">
                  전액
                </button>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">금액</label>
                <input type="text" inputMode="decimal" value={payForm.amount}
                  onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
              </div>
              {activeCashAccounts.length > 0 && (
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">
                    {payTarget.type === '매입' ? '출금 계좌' : '입금 계좌'}
                  </label>
                  <select value={payAccountId} onChange={e => setPayAccountId(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300">
                    {activeCashAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">현금출납장에 자동으로 기록되고 이 전표에 매칭됩니다.</p>
                </div>
              )}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">일자</label>
                <input type="date" value={payForm.date}
                  onChange={e => setPayForm(p => ({ ...p, date: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">결제 방법</label>
                <div className="flex gap-1.5 flex-wrap">
                  {(['현금', '계좌이체', '어음', '카드', '기타'] as PaymentRecord['method'][]).map(m => (
                    <button key={String(m)} onClick={() => setPayForm(p => ({ ...p, method: m }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${payForm.method === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">비고</label>
                <input type="text" placeholder="예: 1차 분할" value={payForm.note}
                  onChange={e => setPayForm(p => ({ ...p, note: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
              </div>
            </div>
            {payOverWarn && (() => {
              const liveStmt = issuedStatements.find(s => s.id === payTarget?.id) ?? payTarget;
              const bal = liveStmt ? getBalance(liveStmt) : 0;
              const overLabel = payTarget?.type === '매출' ? '줄돈' : '받을돈';
              return (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs space-y-2">
                  <p className="font-black text-amber-700">
                    입력금액이 잔액({fmt(bal)}원)을 초과합니다. 초과분은 {overLabel}으로 전환됩니다.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setPayOverWarn(false)}
                      className="flex-1 py-1.5 rounded-lg bg-slate-200 text-slate-600 font-black">취소</button>
                    <button onClick={() => savePayment(true)}
                      className="flex-1 py-1.5 rounded-lg bg-amber-500 text-white font-black">계속 진행</button>
                  </div>
                </div>
              );
            })()}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setPayTarget(null); setPayOverWarn(false); }}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
              <button onClick={() => savePayment(false)}
                disabled={!payForm.amount || Number(payForm.amount) <= 0}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-1.5">
                <Save size={12}/>저장
              </button>
            </div>
          </div>
        </div>
      )}

      {editPayInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800">
                {editPayInfo.stmt.type === '매입' ? '지불' : '수금'} 내역{editPayEditable ? ' 수정' : ''}
              </h3>
              <button onClick={() => setEditPayInfo(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg">
                <X size={16}/>
              </button>
            </div>
            <div className="text-xs text-slate-400">{editPayInfo.stmt.partnerName} · {editPayInfo.stmt.tradeDate}</div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">금액</label>
                <input type="text" inputMode="decimal" value={editPayForm.amount}
                  onChange={e => setEditPayForm(p => ({ ...p, amount: e.target.value }))}
                  disabled={!editPayEditable}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-slate-50 disabled:text-slate-500"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">일자</label>
                <input type="date" value={editPayForm.date}
                  onChange={e => setEditPayForm(p => ({ ...p, date: e.target.value }))}
                  disabled={!editPayEditable}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-slate-50 disabled:text-slate-500"/>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">결제 방법</label>
                <div className="flex gap-1.5 flex-wrap">
                  {(['현금', '계좌이체', '어음', '카드', '기타'] as PaymentRecord['method'][]).map(m => (
                    <button key={String(m)}
                      onClick={() => editPayEditable && setEditPayForm(p => ({ ...p, method: m }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${editPayForm.method === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200'} ${editPayEditable ? 'hover:border-slate-400' : 'cursor-default opacity-70'}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">비고</label>
                <input type="text" placeholder="예: 1차 분할" value={editPayForm.note}
                  onChange={e => setEditPayForm(p => ({ ...p, note: e.target.value }))}
                  disabled={!editPayEditable}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 disabled:bg-slate-50 disabled:text-slate-500"/>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              {editPayEditable ? (
                <>
                  <button onClick={deleteEditPay}
                    className="flex items-center gap-1 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 text-xs font-black hover:bg-red-100 border border-red-200">
                    <X size={12}/>삭제
                  </button>
                  <button onClick={() => setEditPayEditable(false)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
                  <button onClick={saveEditPay}
                    disabled={!editPayForm.amount || Number(editPayForm.amount) <= 0}
                    className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-1.5">
                    <Save size={12}/>저장
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setEditPayInfo(null)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">닫기</button>
                  <button onClick={() => setEditPayEditable(true)}
                    className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700">수정</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 빠른 수금/지불 모달 ── */}
      {showExpense && (() => {
        // 대체전표 — 현금도 세금계산서도 없다. 계정과목 필수, 부가세 없음(전액 공급가).
        const expLines = expRows
          .filter(r => r.accountCode && Number(String(r.price).replace(/,/g, '')) > 0)
          .map(r => {
            const amt = Number(String(r.price).replace(/,/g, '')) || 0;
            const codeName = accountCodes.find(c => c.code === r.accountCode)?.name ?? '';
            return {
              name: r.name.trim() || codeName, spec: '', qty: 1, price: amt,
              supply: amt, tax: 0, total: amt, isTaxExempt: true, accountCode: r.accountCode!,
            };
          });
        const eTotal = expLines.reduce((s, r) => s + r.total, 0);
        const addRow = () => setExpRows(prev => [...prev, { name: '', spec: '', qty: '1', price: '', isTaxExempt: true }]);
        const issue = () => {
          if (expLines.length === 0) return;
          const d = new Date(expDate + 'T00:00:00');
          const stmt: IssuedStatement = {
            id: `stmt-${Date.now()}`, issuedAt: new Date().toISOString(), tradeDate: expDate, type: '비용',
            partnerId: '', partnerName: expLines[0].name, orderId: '',
            docNo: `대체${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(issuedStatements.length + 1).padStart(4, '0')}`,
            totalSupply: eTotal, totalTax: 0, totalAmount: eTotal, items: expLines,
          };
          onAddIssuedStatement?.(stmt);
          setShowExpense(false);
        };
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowExpense(false)}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-800">대체전표 <span className="text-[11px] font-bold text-slate-400">· 현금 없음 · 거래처 없음</span></h3>
                <button onClick={() => setShowExpense(false)} className="text-slate-300 hover:text-slate-500"><X size={18} /></button>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                현금이 오가지 않는 손익 계상 — <b>감가상각비 · 퇴직급여충당금</b>. 손익에는 잡히고, 현금흐름표에서는 순이익에 다시 가산됩니다.
                <br />
                실제로 <b>돈이 움직인 건</b>(기계 구입·차입·상환·이자·공과금) <b>장부 → 현금출납장</b>에 적으세요.
              </p>

              {expCodes.length === 0 && (
                <p className="text-[11px] font-bold text-amber-700 bg-amber-50 rounded-xl px-4 py-2.5">
                  비현금 계정과목이 없습니다. 손익/비용 분석 → 계정 설정에서 감가상각비·퇴직급여충당금을 만들어주세요.
                </p>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">일자</label>
                  <input type="date" value={expDate} onChange={e => setExpDate(e.target.value)}
                    className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300" />
                </div>
              </div>

              <div className="space-y-2">
                {expRows.map((r, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input value={r.name} onChange={e => setExpRows(prev => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} placeholder="적요 (비우면 계정명)"
                      className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300" />
                    <select value={r.accountCode || ''} onChange={e => setExpRows(prev => prev.map((x, i) => i === idx ? { ...x, accountCode: e.target.value || undefined } : x))}
                      className="w-24 shrink-0 border border-slate-200 rounded-lg px-1.5 py-2 text-[11px] font-bold bg-slate-50 outline-none focus:ring-2 focus:ring-slate-300">
                      <option value="">계정-</option>
                      {expCodes.map(ac => <option key={ac.id} value={ac.code}>{ac.name}</option>)}
                    </select>
                    <input value={r.price} onChange={e => setExpRows(prev => prev.map((x, i) => i === idx ? { ...x, price: e.target.value.replace(/[^\d]/g, '') } : x))} placeholder="금액" inputMode="numeric"
                      className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-2 text-sm font-black text-right outline-none focus:ring-2 focus:ring-slate-300" />
                    {expRows.length > 1 && <button type="button" onClick={() => setExpRows(prev => prev.filter((_, i) => i !== idx))} className="shrink-0 text-slate-300 hover:text-rose-400"><X size={14} /></button>}
                  </div>
                ))}
                <button type="button" onClick={addRow} className="flex items-center gap-1 text-xs font-black text-slate-500 hover:text-slate-700"><Plus size={12} strokeWidth={3} />행 추가</button>
              </div>

              <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                <div className="text-[11px] font-bold text-slate-400">부가세 없음 · 현금 이동 없음</div>
                <div className="text-base font-black text-slate-800">합계 {eTotal.toLocaleString()}원</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowExpense(false)} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200 transition-all">취소</button>
                <button onClick={issue} disabled={expLines.length === 0} className="flex-1 py-2.5 rounded-xl bg-slate-700 text-white text-xs font-black hover:bg-slate-800 disabled:opacity-40 transition-all">발행</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 정기 고정비 생성 모달 ── */}
      {showRecurring && (() => {
        // 해당 월에 유효한 활성 템플릿 (계정과목·기간 조건은 핸들러와 동일하게 판정)
        const due = fixedCostTemplates.filter(t =>
          t.active && t.accountCode
          && (!t.startYm || t.startYm <= recurringYm)
          && (!t.endYm || recurringYm <= t.endYm)
        );
        const alreadyDone = (t: FixedCostTemplate) =>
          issuedStatements.some(s => (s as any).orderId === `RC-${t.id}-${recurringYm}`);
        const pending = due.filter(t => !alreadyDone(t));
        const total = pending.reduce((a, t) => a + t.amount, 0);

        const run = async () => {
          if (!onGenerateRecurringCosts || pending.length === 0) return;
          setRecurringBusy(true);
          try {
            const n = await onGenerateRecurringCosts(recurringYm);
            setRecurringMsg(n > 0 ? `${n}건 생성했습니다.` : '새로 생성할 게 없습니다.');
          } catch (e) {
            setRecurringMsg(`생성 실패: ${(e as Error)?.message ?? String(e)}`);
          } finally {
            setRecurringBusy(false);
          }
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowRecurring(false)}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-800">정기 고정비 전표 생성</h3>
                <button onClick={() => setShowRecurring(false)} className="text-slate-300 hover:text-slate-500"><X size={18} /></button>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                등록한 템플릿으로 해당 월 전표를 한 번에 끊습니다. 이미 생성된 건 건너뜁니다.
                감가상각비·퇴직급여충당금도 등록해두면 매달 자동으로 끊깁니다.
              </p>

              {/* 템플릿 관리 — 추가/수정/삭제 (거래명세서 안에서) */}
              {onAddFixedCostTemplate && (
                <div className="border border-slate-150 rounded-2xl overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">정기비용 항목</div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-slate-50">
                    {fixedCostTemplates.length === 0 && <p className="px-3 py-4 text-[11px] font-bold text-slate-300 text-center">등록된 정기비용이 없습니다. 아래에서 추가하세요.</p>}
                    {fixedCostTemplates.map(t => {
                      const ac = accountCodes.find(c => c.code === t.accountCode);
                      const editing = tplEditId === t.id;
                      return (
                        <div key={t.id} className={`flex items-center gap-2 px-3 py-2 ${t.active ? '' : 'opacity-45'}`}>
                          <button onClick={() => onUpdateFixedCostTemplate?.(t.id, { active: !t.active })} title={t.active ? '집계 제외' : '집계 포함'}
                            className={`w-2 h-2 rounded-full shrink-0 ${t.active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-black text-slate-800 truncate">{t.name || ac?.name}</p>
                            <p className="text-[10px] text-slate-400">{t.accountCode} {ac?.name ?? ''}{t.partnerName ? ` · ${t.partnerName}` : ''}{t.startYm ? ` · ${t.startYm}~` : ''}</p>
                          </div>
                          {editing ? (
                            <input autoFocus inputMode="numeric" value={tplEditAmt} onChange={e => setTplEditAmt(e.target.value.replace(/[^\d]/g, ''))}
                              onKeyDown={e => { if (e.key === 'Enter') { onUpdateFixedCostTemplate?.(t.id, { amount: Number(tplEditAmt) || 0 }); setTplEditId(null); } }}
                              className="w-24 text-right text-xs font-black tabular-nums border border-indigo-300 rounded-lg px-2 py-1 outline-none" />
                          ) : (
                            <button onClick={() => { setTplEditId(t.id); setTplEditAmt(String(t.amount)); }} className="text-xs font-black text-slate-700 tabular-nums shrink-0 hover:text-indigo-600">{fmt(t.amount)}</button>
                          )}
                          {editing ? (
                            <button onClick={() => { onUpdateFixedCostTemplate?.(t.id, { amount: Number(tplEditAmt) || 0 }); setTplEditId(null); }} className="p-1 text-emerald-500 shrink-0"><Check size={13} /></button>
                          ) : (
                            <button onClick={() => onDeleteFixedCostTemplate?.(t.id)} className="p-1 text-slate-300 hover:text-rose-500 shrink-0"><Trash2 size={12} /></button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* 추가 폼 */}
                  <div className="p-2.5 bg-slate-50/60 border-t border-slate-100 space-y-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <input value={tplForm.name} onChange={e => setTplForm(f => ({ ...f, name: e.target.value }))} placeholder="항목명 (예: 공장 임대료)"
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-300" />
                      <input inputMode="numeric" value={tplForm.amount} onChange={e => setTplForm(f => ({ ...f, amount: e.target.value.replace(/[^\d]/g, '') }))} placeholder="금액"
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-black text-right tabular-nums outline-none focus:ring-2 focus:ring-violet-300" />
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <select value={tplForm.accountCode} onChange={e => setTplForm(f => ({ ...f, accountCode: e.target.value }))}
                        className={`border rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-300 ${tplForm.accountCode ? 'border-slate-200' : 'border-amber-300 bg-amber-50'}`}>
                        <option value="">계정과목 *</option>
                        {accountCodes.filter(c => c.type === '비용').sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true })).map(c => <option key={c.id} value={c.code}>{c.code} · {c.name}</option>)}
                      </select>
                      <select value={tplForm.partnerId} onChange={e => setTplForm(f => ({ ...f, partnerId: e.target.value }))}
                        className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-300">
                        <option value="">거래처 (선택)</option>
                        {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-1.5">
                      <input type="month" value={tplForm.startYm} onChange={e => setTplForm(f => ({ ...f, startYm: e.target.value }))} title="시작월(선택)"
                        className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-300" />
                      <button
                        disabled={!tplForm.accountCode || !(Number(tplForm.amount) > 0) || tplBusy}
                        onClick={async () => {
                          setTplBusy(true);
                          try {
                            const p = tplForm.partnerId ? partners.find(x => x.id === tplForm.partnerId) : null;
                            const ac = accountCodes.find(c => c.code === tplForm.accountCode);
                            await onAddFixedCostTemplate!({
                              name: tplForm.name.trim() || ac?.name || '정기비용', amount: Number(tplForm.amount) || 0,
                              category: '기타', active: true, accountCode: tplForm.accountCode,
                              ...(p ? { partnerId: p.id, partnerName: p.name } : {}),
                              ...(tplForm.startYm ? { startYm: tplForm.startYm } : {}),
                            } as Omit<FixedCostTemplate, 'id'>);
                            setTplForm({ name: '', amount: '', accountCode: '', partnerId: '', startYm: '' });
                          } finally { setTplBusy(false); }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-black disabled:opacity-30">추가</button>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">대상 월</label>
                <input type="month" value={recurringYm}
                  onChange={e => { setRecurringYm(e.target.value); setRecurringMsg(''); }}
                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-300" />
              </div>

              {due.length === 0 ? (
                <p className="text-[11px] font-bold text-amber-700 bg-amber-50 rounded-xl px-4 py-3">
                  이 달에 해당하는 정기비용이 없습니다. 위에서 추가하세요.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {due.map(t => {
                    const done = alreadyDone(t);
                    const ac = accountCodes.find(c => c.code === t.accountCode);
                    return (
                      <div key={t.id} className={`flex items-center gap-3 rounded-xl px-4 py-2.5 ${done ? 'bg-slate-50 opacity-50' : 'bg-violet-50/60'}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black text-slate-800 truncate">{t.name}</p>
                          <p className="text-[10px] text-slate-400">
                            {t.accountCode} {ac?.name ?? ''}{t.partnerName ? ` · ${t.partnerName}` : ''}
                          </p>
                        </div>
                        <p className="text-xs font-black text-slate-700 tabular-nums shrink-0">{fmt(t.amount)}</p>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded shrink-0 ${done ? 'bg-slate-200 text-slate-500' : 'bg-violet-600 text-white'}`}>
                          {done ? '생성됨' : '생성 예정'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {pending.length > 0 && (
                <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-[11px] font-bold text-slate-400">{pending.length}건 생성 예정</span>
                  <span className="text-base font-black text-slate-800">합계 {fmt(total)}원</span>
                </div>
              )}

              {recurringMsg && (
                <p className="text-[11px] font-black text-emerald-700 bg-emerald-50 rounded-xl px-4 py-2.5">{recurringMsg}</p>
              )}

              <div className="flex gap-2">
                <button onClick={() => setShowRecurring(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200 transition-all">닫기</button>
                <button onClick={run} disabled={pending.length === 0 || recurringBusy}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-black hover:bg-violet-700 disabled:opacity-40 transition-all">
                  {recurringBusy ? '생성 중…' : `${recurringYm} 전표 생성`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showQuickPay && (() => {
        // 방향으로 상계 대상 전표 유형 결정 — 입금→매출(미수), 출금→매입(미지급)
        const stmtTypeForPay = qpDir === '입금' ? '매출' : '매입';
        const selectedClientObj = quickPayClientId ? partners.find(c => c.id === quickPayClientId) : null;
        const partnerTotal = quickPayClientId
          ? issuedStatements
              .filter(s => s.partnerId === quickPayClientId && s.type === stmtTypeForPay)
              .reduce((sum, s) => sum + getBalance(s), 0)
          : 0;
        const dropClients = quickPayClientSearch.trim()
          ? partners.filter(c => c.name.includes(quickPayClientSearch.trim())).slice(0, 8)
          : [];

        const amt = Number((quickPayAmount || '').replace(/,/g, '')) || 0;
        const offsetAmt = quickPayClientId && partnerTotal > 0 ? Math.min(amt, partnerTotal) : 0; // 거래처 미수/미지급 상계분
        const plainAmt = amt - offsetAmt;   // 상계 후 남는 순수 자금
        // 상환/급여 파생
        const prin = Number((qpPrincipal || '').replace(/,/g, '')) || 0;
        const intr = Number((qpInterest || '').replace(/,/g, '')) || 0;
        const grs  = Number((qpGross || '').replace(/,/g, '')) || 0;
        const ded  = Number((qpDeduction || '').replace(/,/g, '')) || 0;
        const net  = grs - ded;
        const loanAccounts = accountCodes.filter(c => c.type === '부채' && /차입금/.test(c.name));
        const INTEREST_CODE = accountCodes.find(c => /이자비용/.test(c.name))?.code ?? '951';
        const SALARY_CODE = accountCodes.find(c => c.name === '급여')?.code ?? '515';
        const WITHHOLD_CODE = accountCodes.find(c => c.name === '예수금')?.code ?? '254';
        const expenseCodes = accountCodes.filter(c => ['비용', '자산', '부채', '자본'].includes(c.type as string)).sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

        const base = () => ({
          date: quickPayDate, cashAccountId: quickPayAccountId, createdAt: new Date().toISOString(),
          ...(quickPayClientId ? { partnerId: quickPayClientId, partnerName: selectedClientObj?.name ?? '' } : {}),
        });

        // 일반 저장 — 거래처 미수/미지급 상계 우선, 남는 금액은 계정과목 자금전표로.
        const doGeneralSave = () => {
          if (amt <= 0) return;
          if (offsetAmt > 0) {
            const allClientStmts = issuedStatements
              .filter(s => s.partnerId === quickPayClientId && s.type === stmtTypeForPay)
              .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
            const unpaid = allClientStmts.filter(s => getBalance(s) > 0);
            const allocations: { stmt: IssuedStatement; amount: number }[] = [];
            let rem = offsetAmt;
            for (const s of unpaid) { if (rem <= 0) break; const apply = Math.min(rem, getBalance(s)); if (apply > 0) allocations.push({ stmt: s, amount: apply }); rem -= apply; }
            if (allocations.length) recordPayment(allocations, { date: quickPayDate, method: quickPayMethod, note: quickPayNote.trim() || undefined, cashAccountId: quickPayAccountId });
          }
          if (plainAmt > 0) {
            onAddCashEntry?.({ id: `cash-${Date.now()}`, dir: qpDir, amount: plainAmt, ...(qpAccountCode ? { accountCode: qpAccountCode } : {}), ...(quickPayNote.trim() ? { note: quickPayNote.trim() } : {}), ...base() } as any);
          }
          setShowQuickPay(false); setQuickPayOverWarn(false);
        };
        const doLoanSave = () => {
          const memo = quickPayNote.trim() || '대출 상환';
          if (prin > 0) onAddCashEntry?.({ id: `cash-${Date.now()}-p`, dir: '출금', amount: prin, accountCode: qpLoanCode, note: `${memo} (원금)`, ...base() } as any);
          if (intr > 0) onAddCashEntry?.({ id: `cash-${Date.now()}-i`, dir: '출금', amount: intr, accountCode: INTEREST_CODE, note: `${memo} (이자)`, ...base() } as any);
          setShowQuickPay(false);
        };
        const doSalarySave = () => {
          const memo = quickPayNote.trim() || '급여';
          onAddCashEntry?.({ id: `cash-${Date.now()}-g`, dir: '출금', amount: grs, accountCode: SALARY_CODE, note: `${memo} (총급여)`, ...base() } as any);
          if (ded > 0) onAddCashEntry?.({ id: `cash-${Date.now()}-w`, dir: '입금', amount: ded, accountCode: WITHHOLD_CODE, note: `${memo} (원천공제 예수)`, ...base() } as any);
          setShowQuickPay(false);
        };

        const canSave = qpMode === '상환' ? (prin > 0 || intr > 0)
          : qpMode === '급여' ? (grs > 0 && ded >= 0 && net >= 0)
          : (amt > 0 && (offsetAmt >= amt || !!qpAccountCode)); // 일반: 전액 상계면 계정 불필요, 아니면 계정 필수

        const handleQuickPaySave = () => {
          if (qpMode === '상환') { if (prin > 0 || intr > 0) doLoanSave(); return; }
          if (qpMode === '급여') { if (grs > 0 && ded >= 0 && net >= 0) doSalarySave(); return; }
          if (!canSave) return;
          // 상계 초과분(줄돈/받을돈 전환) 경고 — 거래처 있고 상계보다 많은데 계정도 없으면 canSave가 막음
          doGeneralSave();
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => { setShowQuickPay(false); setQuickPayOverWarn(false); }}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-black text-slate-800">입출금 기록</h3>

              {/* 모드 — 일반 / 대출 상환 / 급여 지급 */}
              <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
                {([['일반', '일반'], ['상환', '대출 상환'], ['급여', '급여']] as const).map(([m, label]) => (
                  <button key={m} type="button" onClick={() => setQpMode(m)}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-black transition-all ${qpMode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* 계좌 + 일자 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">계좌</label>
                  <select value={quickPayAccountId} onChange={e => setQuickPayAccountId(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300">
                    {activeCashAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">일자</label>
                  <input type="date" value={quickPayDate} onChange={e => setQuickPayDate(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                </div>
              </div>

              {qpMode === '일반' ? (
                <>
                  {/* 방향 */}
                  <div className="flex gap-2">
                    {(['입금', '출금'] as const).map(d => (
                      <button key={d} onClick={() => { setQpDir(d); setQuickPayClientId(''); setQuickPayClientSearch(''); }}
                        className={`flex-1 py-2 rounded-xl text-xs font-black border transition-all ${qpDir === d
                          ? d === '입금' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-rose-600 text-white border-rose-600'
                          : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                        {d === '입금' ? '입금 (수금·기타)' : '출금 (지불·비용)'}
                      </button>
                    ))}
                  </div>

                  {/* 거래처 (선택) */}
                  <div className="relative">
                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">거래처 <span className="text-slate-300">(선택 · {qpDir === '입금' ? '매출 미수 상계' : '매입 미지급 상계'})</span></label>
                    <input type="text" placeholder="업체명 검색..."
                      value={selectedClientObj ? selectedClientObj.name : quickPayClientSearch}
                      onFocus={() => { setQuickPayClientId(''); setQuickPayDropOpen(true); }}
                      onChange={e => { setQuickPayClientSearch(e.target.value); setQuickPayClientId(''); setQuickPayDropOpen(true); }}
                      onBlur={() => setTimeout(() => setQuickPayDropOpen(false), 150)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                    {quickPayDropOpen && dropClients.length > 0 && (
                      <div className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-10 overflow-hidden">
                        {dropClients.map(c => {
                          const bal = issuedStatements.filter(s => s.partnerId === c.id && s.type === stmtTypeForPay).reduce((sum, s) => sum + getBalance(s), 0);
                          return (
                            <button key={c.id}
                              onMouseDown={() => { setQuickPayClientId(c.id); setQuickPayClientSearch(''); setQuickPayDropOpen(false); }}
                              className="w-full flex items-center justify-between px-3 py-2.5 text-xs hover:bg-emerald-50 transition-colors border-b border-slate-50 last:border-0">
                              <span className="font-black text-slate-800">{c.name}</span>
                              {bal > 0 && <span className={`font-black ${qpDir === '입금' ? 'text-blue-600' : 'text-rose-600'}`}>{fmt(bal)}원</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {quickPayClientId && (
                      <div className="mt-2 px-3 py-2 bg-slate-50 rounded-xl flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">{qpDir === '입금' ? '미수금' : '미지급금'}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-black ${partnerTotal > 0 ? (qpDir === '입금' ? 'text-blue-600' : 'text-rose-600') : 'text-emerald-600'}`}>
                            {partnerTotal > 0 ? `${fmt(partnerTotal)}원` : '없음'}
                          </span>
                          {partnerTotal > 0 && (
                            <button onClick={() => setQuickPayAmount(String(partnerTotal))}
                              className="text-[10px] font-black px-2 py-1 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-all">완불처리</button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 금액 */}
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">금액</label>
                    <input type="text" inputMode="numeric" placeholder="0" value={quickPayAmount}
                      onChange={e => setQuickPayAmount(e.target.value.replace(/[^\d,]/g, ''))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-lg font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                  </div>

                  {/* 상계 안내 */}
                  {offsetAmt > 0 && (
                    <div className="text-[11px] font-bold text-slate-500 bg-slate-50 rounded-xl px-3 py-2 leading-snug">
                      {fmt(offsetAmt)}원은 {selectedClientObj?.name}의 {qpDir === '입금' ? '미수금' : '미지급금'} 상계.
                      {plainAmt > 0 && <> 남는 <b className="text-slate-700">{fmt(plainAmt)}원</b>은 아래 계정과목의 자금으로 잡힙니다.</>}
                    </div>
                  )}

                  {/* 계정과목 — 상계로 전액 처리되면 불필요 */}
                  {plainAmt > 0 && (
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">계정과목 <span className="text-rose-400">*</span> <span className="text-slate-300">({qpDir === '입금' ? '이 돈의 성격' : '전기·임대·기계구입 등'})</span></label>
                      <select value={qpAccountCode} onChange={e => setQpAccountCode(e.target.value)}
                        className={`w-full border rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300 ${qpAccountCode ? 'border-slate-200' : 'border-amber-300 bg-amber-50'}`}>
                        <option value="">— 선택하세요 —</option>
                        {expenseCodes.map(c => <option key={c.id} value={c.code}>{c.code} · {c.name}</option>)}
                      </select>
                      {!qpAccountCode && <p className="text-[10px] font-bold text-amber-600 mt-1">계정과목이 없으면 손익·현금흐름 어디에도 못 잡힙니다.</p>}
                    </div>
                  )}
                </>
              ) : qpMode === '상환' ? (
                <>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">대출 계정 <span className="text-rose-400">*</span></label>
                    <select value={qpLoanCode} onChange={e => setQpLoanCode(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300">
                      {(loanAccounts.length ? loanAccounts : [{ id: '260', code: '260', name: '단기차입금' }, { id: '293', code: '293', name: '장기차입금' }]).map(c => (
                        <option key={c.id} value={c.code}>{c.code} · {c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">원금</label>
                      <input inputMode="numeric" value={qpPrincipal} placeholder="0"
                        onChange={e => setQpPrincipal(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">이자</label>
                      <input inputMode="numeric" value={qpInterest} placeholder="0"
                        onChange={e => setQpInterest(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                  </div>
                  <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2 text-[11px] font-black text-slate-500">
                    <span>통장에서 나가는 총액</span>
                    <span className="tabular-nums text-slate-800">{fmt(prin + intr)}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">원금은 차입금 감소, 이자는 비용으로 <b>자금 두 줄</b> 자동 기록됩니다.</p>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">총급여</label>
                      <input inputMode="numeric" value={qpGross} placeholder="0"
                        onChange={e => setQpGross(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">공제 <span className="text-slate-300">(원천·4대보험)</span></label>
                      <input inputMode="numeric" value={qpDeduction} placeholder="0"
                        onChange={e => setQpDeduction(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                  </div>
                  <div className={`flex items-center justify-between rounded-xl px-3 py-2 text-[11px] font-black ${net < 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-500'}`}>
                    <span>실지급 (통장에서 나감)</span>
                    <span className="tabular-nums text-slate-800">{fmt(net)}{net < 0 ? ' · 공제가 총급여보다 큼' : ''}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">급여(비용) + 예수금(원천공제) + 실지급으로 자동 분리됩니다.</p>
                </>
              )}

              {/* 비고 */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">비고</label>
                <input type="text" placeholder={qpMode === '일반' ? '예: 7월 전기요금' : qpMode === '상환' ? '예: 기업은행 시설자금' : '예: 7월 급여'}
                  value={quickPayNote} onChange={e => setQuickPayNote(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowQuickPay(false); setQuickPayOverWarn(false); }}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
                <button onClick={handleQuickPaySave} disabled={!canSave}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
                  <Save size={12}/>저장
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 계좌 관리 모달 (장부 흡수) ── */}
      {showAccounts && onAddCashAccount && onUpdateCashAccount && (
        <AccountModal accounts={cashAccounts} onClose={() => setShowAccounts(false)}
          onAdd={onAddCashAccount} onUpdate={onUpdateCashAccount} />
      )}

      {/* ── 발행내역 상세 모달 ── */}
      {detailStmt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto"
            onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-black px-2.5 py-1 rounded-full ${detailStmt.type==='매출'?'bg-blue-100 text-blue-700':'bg-rose-100 text-rose-700'}`}>{detailStmt.type}</span>
                <span className="font-black text-slate-900">{detailStmt.partnerName}</span>
                <span className="text-xs text-slate-400">{detailStmt.tradeDate}</span>
                <span className="text-[10px] text-slate-300 font-mono">{detailStmt.docNo}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={()=>handleDetailPrint(detailStmt)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 text-white rounded-xl text-xs font-black hover:bg-slate-800">
                  <Printer size={12}/>인쇄
                </button>
                <button onClick={()=>{if(window.confirm('이 전표를 삭제하시겠습니까?')){onDeleteIssuedStatement?.(detailStmt.id);setDetailStmt(null);}}}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-500 text-white rounded-xl text-xs font-black hover:bg-red-600">
                  <X size={12}/>삭제
                </button>
                <button onClick={()=>setDetailStmt(null)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl">✕</button>
              </div>
            </div>
            <div className="p-6 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50">
                    {['No','품목명','규격','수량','단가','공급가액','세액','합계'].map(h=>(
                      <th key={h} className="border border-slate-200 px-3 py-2 text-[10px] font-black text-slate-500 text-center whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detailStmt.items.map((item, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-center">{i+1}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] font-bold">{item.name}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-center">{item.spec}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-right">{fmt(item.qty)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-right">{fmt(item.price)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-right">{fmt(item.supply)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-right">{item.isTaxExempt?'면세':fmt(item.tax)}</td>
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-right font-black">{fmt(item.total)}</td>
                    </tr>
                  ))}
                  <tr className="bg-blue-50">
                    <td colSpan={5} className="border border-slate-200 px-3 py-2 text-xs font-black text-center">합계</td>
                    <td className="border border-slate-200 px-3 py-2 text-xs font-black text-right">{fmt(detailStmt.totalSupply)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-xs font-black text-right">{fmt(detailStmt.totalTax)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-xs font-black text-right text-indigo-800">{fmt(detailStmt.totalAmount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════ 전표 생성 모달 ══════════════════════════════════════ */}
      {createMode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeCreate}/>
          <div className="relative w-full h-[100dvh] sm:h-[80vh] sm:max-w-7xl flex flex-col bg-white sm:rounded-3xl shadow-2xl overflow-hidden">

            {/* ── 헤더 ── */}
            <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3 border-b border-slate-100 flex-shrink-0 flex-wrap">
              <span className={`text-xs font-black px-2.5 py-1 rounded-full ${createMode==='매출'?'bg-blue-100 text-blue-700':'bg-rose-100 text-rose-700'}`}>
                {createMode==='매출'?'매출':'매입'}전표
              </span>
              {editingStmt && (
                <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">[수정중] {editingStmt.docNo}</span>
              )}
              {selectedClient
                ? <span className="font-black text-slate-900">{selectedClient.name}</span>
                : <span className="text-slate-400 font-bold text-sm">거래처를 선택하세요</span>
              }
              {selectedClient?.phone && <span className="text-xs text-slate-400">{selectedClient.phone}</span>}
              <span className="text-slate-200">·</span>
              {editingStmt && !isEditMode
                ? <span className="text-xs font-black text-slate-700 bg-slate-100 px-2.5 py-1.5 rounded-lg">{tradeDate}</span>
                : <input type="date" value={tradeDate} onChange={e=>setTradeDate(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer"/>}
              <div className="ml-auto flex items-center gap-2">
                <button onClick={()=>{closeCreate();setTimeout(()=>setCreateMode(stmtType),50);}}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200 transition-all">
                  새 전표
                </button>
                <button onClick={closeCreate} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-all">
                  <X size={18}/>
                </button>
              </div>
            </div>

            {/* ── 거래처 선택 / 모드 전환 바 ── */}
            <div className="flex items-center gap-2 px-5 py-2.5 border-b border-slate-100 flex-shrink-0 bg-slate-50 flex-wrap">
              {!selectedClientId ? (<>
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                  <input type="text" placeholder="거래처 검색..." value={partnerSearch}
                    onChange={e=>setClientSearch(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg pl-7 pr-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-40"/>
                </div>
                <select value={selectedClientId}
                  onChange={e=>{setSelectedClientId(e.target.value);setSelectedOrderId('');setEditablePrices({});setTaxExemptOverrides({});setSelectedConfirmedIds([]);}}
                  className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 min-w-[180px]">
                  <option value="">— 거래처 선택 —</option>
                  {availableClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {createMode==='매출' && (
                  <button onClick={()=>setOnlyActive(v=>!v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${onlyActive?'bg-blue-600 text-white border-blue-600':'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                    미발행
                  </button>
                )}
              </>) : (<>
                <button onClick={()=>{setSelectedClientId('');setSelectedOrderId('');setEditablePrices({});setTaxExemptOverrides({});setShowPricePanel(false);setManualItems([{name:'',spec:'',qty:'',price:'',isTaxExempt:false}]);setSelectedConfirmedIds([]);}}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-100 transition-all shrink-0">
                  <ChevronLeft size={12}/>거래처 변경
                </button>
                {searchableRows.length>0 && (
                  <button onClick={()=>setShowPricePanel(v=>!v)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${showPricePanel?'bg-violet-600 text-white border-violet-600':'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                    단가관리
                  </button>
                )}
                {createMode==='매출' && !editingStmt && (
                  <div className="ml-auto flex bg-slate-200 rounded-lg p-0.5 gap-0.5">
                    <button onClick={()=>{
                        // 주문 불러오기 = 주문 목록으로 복귀 (불러온 주문·수동행·로드상태 초기화, 거래처는 유지)
                        setManualMode(false);
                        setSelectedOrderId('');
                        setLoadedPoIds([]);
                        setManualItems([{ name: '', spec: '', qty: '', price: '', isTaxExempt: false }]);
                        setEditablePrices({});
                        setTaxExemptOverrides({});
                        setAccountCodeOverrides({});
                        setSelectedConfirmedIds([]);
                      }}
                      className={`px-3 py-1 rounded-md text-xs font-black transition-all ${!manualMode?'bg-white text-slate-800 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>
                      주문 불러오기
                    </button>
                    <button onClick={()=>setManualMode(true)}
                      className={`px-3 py-1 rounded-md text-xs font-black transition-all ${manualMode?'bg-white text-slate-800 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>
                      직접 입력
                    </button>
                  </div>
                )}
              </>)}
            </div>

            {/* ── 날짜 필터 (거래처 선택 전 개요) — 거래처 선택 시 UI와 통일 ── */}
            {createMode==='매출' && !selectedClientId && (
              <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-slate-100 bg-slate-50 flex-wrap flex-shrink-0">
                {(['당일','금주','당월','전체'] as const).map(p=>(
                  <button key={p} onClick={()=>{
                    if(p==='전체'){setDateFrom('');setDateTo('');setOrderDateQuick('전체');return;}
                    if(p==='금주'){setDateFrom(weekMonday());setDateTo(weekSunday());setOrderDateQuick('금주');return;} // 월~일 고정
                    if(p==='당월'){setDateFrom(monthStart());setDateTo(monthEnd());setOrderDateQuick('당월');return;} // 1일~말일 고정
                    const t=today();
                    setDateFrom(t);setDateTo(t);setOrderDateQuick(p); // 당일
                  }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-black border transition-all ${orderDateQuick===p?'bg-slate-700 text-white border-slate-700':'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>{p}</button>
                ))}
                <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setOrderDateQuick('');}}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
                <span className="text-slate-300 text-xs">~</span>
                <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setOrderDateQuick('');}}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
              </div>
            )}

            {/* ── 단가관리 패널 ── */}
            {showPricePanel && selectedClientId && searchableRows.length > 0 && (
              <div className="flex-shrink-0 border-b border-slate-100 max-h-36 overflow-y-auto">
                <div className="px-5 py-2 bg-violet-50 sticky top-0">
                  <span className="text-[10px] font-black text-violet-600 uppercase tracking-widest">단가·과세 관리 ({searchableRows.length}품목)</span>
                </div>
                <div className="divide-y divide-slate-50">
                  {searchableRows.map(({pc,product})=>(
                    <div key={pc.id} className="flex items-center gap-3 px-5 py-2">
                      <span className="text-xs font-black text-slate-700 flex-1 truncate">{product!.name}</span>
                      {product!.spec && <span className="text-[10px] text-slate-400">{product!.spec}</span>}
                      <input type="text" inputMode="decimal" placeholder="단가"
                        value={pricePanelEdits[pc.id]??(pc.price!==undefined?String(pc.price):'')}
                        onChange={e=>setPricePanelEdits(prev=>({...prev,[pc.id]:e.target.value}))}
                        className="w-24 text-right bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-300"/>
                      <button onClick={()=>onUpsertPartnerItem?.({...pc,taxType:pc.taxType==='면세'?'과세':'면세'})}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-black border transition-all ${pc.taxType==='면세'?'bg-indigo-500 text-white border-indigo-500':'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                        {pc.taxType==='면세'?'면세':'과세'}
                      </button>
                      <button onClick={()=>savePcPrice(pc)}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-violet-600 text-white hover:bg-violet-700 transition-all">
                        저장
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 중간 단계: 주문/발주 선택 ── */}
            {selectedClientId && !(selectedOrderId || manualMode || editingStmt) && (
              <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0 flex-wrap">
                  <span className="text-xs font-black text-slate-600">{createMode==='매출'?'주문 선택':'발주 선택'}</span>
                  {createMode==='매출' && <span className="text-xs text-slate-400">{partnerOrders.length}건</span>}
                  {createMode==='매출' && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(['당일','금주','당월'] as const).map(p=>(
                        <button key={p} onClick={()=>{
                          if(p==='금주'){setDateFrom(weekMonday());setDateTo(weekSunday());setOrderDateQuick('금주');return;} // 월~일 고정
                          if(p==='당월'){setDateFrom(monthStart());setDateTo(monthEnd());setOrderDateQuick('당월');return;} // 1일~말일 고정
                          const t=today();
                          setDateFrom(t);setDateTo(t);setOrderDateQuick(p); // 당일
                        }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-black border transition-all ${orderDateQuick===p?'bg-slate-700 text-white border-slate-700':'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>{p}</button>
                      ))}
                      <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setOrderDateQuick('');}}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
                      <span className="text-slate-300 text-xs">~</span>
                      <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setOrderDateQuick('');}}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
                      {(dateFrom||dateTo)&&!orderDateQuick&&(
                        <button onClick={()=>{setDateFrom('');setDateTo('');setOrderDateQuick('');}}
                          className="text-xs text-slate-400 hover:text-slate-700 font-black">전체</button>
                      )}
                    </div>
                  )}
                  {createMode==='매입' && (
                    <>
                      <span className="text-xs text-slate-400">
                        {(confirmedBySupplier.find(s=>s.partnerId===selectedClientId)?.items.length??0) + (orderRequestsBySupplier.find(s=>s.partnerId===selectedClientId)?.items.length??0)}건
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        <button onClick={()=>setManualMode(true)}
                          className="px-3 py-1.5 rounded-lg text-xs font-black bg-slate-700 text-white hover:bg-slate-800 transition-all">
                          직접 입력
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {createMode==='매출' && (()=>{
                  if(partnerOrders.length===0) return (
                    <div className="flex flex-col items-center justify-center flex-1 py-12 text-slate-300">
                      <ClipboardList size={36} strokeWidth={1.5} className="mb-2"/>
                      <p className="text-xs font-bold text-slate-400">해당 조건의 주문이 없습니다</p>
                    </div>
                  );
                  const byMonth: Record<string,Order[]>={};
                  partnerOrders.forEach(o=>{
                    const m=(o.deliveryDate||o.createdAt||'').slice(0,7);
                    if(!byMonth[m])byMonth[m]=[];
                    byMonth[m].push(o);
                  });
                  const months=Object.keys(byMonth).sort().reverse();
                  return (
                    <div className="divide-y divide-slate-100">
                      {months.map(month=>(
                        <div key={month}>
                          <div className="px-5 py-2 bg-slate-50 flex items-center gap-2 sticky top-0 z-10">
                            <span className="text-[11px] font-black text-slate-500">{month}</span>
                            <span className="text-[10px] text-slate-400">{byMonth[month].length}건</span>
                          </div>
                          <div className="divide-y divide-slate-50">
                            {byMonth[month].map(o=>{
                              const alreadyIssued=!!o.invoicePrinted&&!!issuedStatements.find(s=>s.orderId===o.id);
                              return (
                                <button key={o.id} onClick={()=>handleOrderClick(o)}
                                  className={`w-full flex items-center gap-3 text-left px-5 py-3 text-xs transition-all ${alreadyIssued?'bg-emerald-50 hover:bg-emerald-100':'hover:bg-pink-50'}`}>
                                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                    <span className="font-black text-slate-800">납품: {o.deliveryDate?.slice(0,10)||'미정'}</span>
                                    <span className="text-slate-400">주문일 {o.createdAt?.slice(0,10)} · {o.items.length}품목</span>
                                  </div>
                                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${STATUS_COLOR[o.status]||'bg-slate-100 text-slate-500'}`}>{STATUS_LABEL[o.status]||o.status}</span>
                                  {alreadyIssued
                                    ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">발행완료</span>
                                    : <span className="text-[10px] font-black text-pink-500 bg-pink-100 px-1.5 py-0.5 rounded-full">미발행</span>}
                                  <ChevronRight size={14} className="text-slate-300 shrink-0"/>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {createMode==='매입' && (()=>{
                  // 원본 PO(묶음 items[] 포함)를 거래처별로 직접 조회 — 주문카드와 동일 구조
                  const myConfirmed = confirmedOrders.filter(po => po.partnerId === selectedClientId);
                  const myRequests  = orderRequests.filter(po => po.partnerId === selectedClientId);
                  if(myConfirmed.length===0 && myRequests.length===0) return (
                    <div className="flex flex-col items-center justify-center flex-1 py-12 text-slate-300">
                      <ClipboardList size={36} strokeWidth={1.5} className="mb-2"/>
                      <p className="text-xs font-bold text-slate-400">발주 항목이 없습니다</p>
                      <p className="text-xs text-slate-300 mt-1">직접 입력으로 전표를 작성하세요</p>
                    </div>
                  );

                  const loadCard = (po: PurchaseOrder) => {
                    setManualItems([...poToManualRows(po), {name:'',spec:'',qty:'',price:'',isTaxExempt:false}]);
                    setLoadedPoIds(prev => Array.from(new Set([...prev, po.id].filter(Boolean))));
                    setManualMode(true);
                  };
                  // 발주카드 클릭: 이 카드에 연결된 전표(linkedStatementId)가 있으면 중복 경고, 아니면 로드
                  const clickCard = (po: PurchaseOrder) => {
                    const linked = po.linkedStatementId ? issuedStatements.find(s => s.id === po.linkedStatementId) : undefined;
                    if (linked) { setWarnDuplicate({ po, stmt: linked }); return; }
                    loadCard(po);
                  };
                  // 카드 요약: 품목명 나열
                  const summarize = (po: PurchaseOrder) => {
                    const lines = poLines(po);
                    const first = lines[0]?.name || (allItems.find(p=>p.id===lines[0]?.itemId)?.name) || '품목';
                    return lines.length > 1 ? `${first} 외 ${lines.length-1}건` : first;
                  };
                  const totalQty = (po: PurchaseOrder) => poLines(po).reduce((s,l)=>s+(l.quantity||0),0);

                  // 월별 그룹 (주문카드와 동일 구조)
                  const groupByMonth = (pos: PurchaseOrder[]) => {
                    const m: Record<string, PurchaseOrder[]> = {};
                    [...pos].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).forEach(po=>{
                      const k = (po.createdAt||'').slice(0,7)||'미정';
                      (m[k] ??= []).push(po);
                    });
                    return m;
                  };
                  const confByMonth = groupByMonth(myConfirmed);
                  const confMonths = Object.keys(confByMonth).sort().reverse();
                  const reqByMonth = groupByMonth(myRequests);
                  const reqMonths = Object.keys(reqByMonth).sort().reverse();

                  return (
                    <div className="divide-y divide-slate-100">
                      {myConfirmed.length>0 && confMonths.map(month=>(
                        <div key={month}>
                          <div className="px-5 py-2 bg-slate-50 flex items-center gap-2 sticky top-0 z-10">
                            <span className="text-[11px] font-black text-slate-500">{month}</span>
                            <span className="text-[10px] text-slate-400">{confByMonth[month].length}건</span>
                          </div>
                          <div className="divide-y divide-slate-50">
                            {confByMonth[month].map(po=>{
                              const alreadyIssued = !!po.linkedStatementId;
                              const receivedDate = (po.receivedAt||po.invoicedAt||po.createdAt||'').slice(0,10);
                              const createdDate  = (po.createdAt||'').slice(0,10);
                              return (
                                <button key={po.id} onClick={()=>clickCard(po)}
                                  className={`w-full flex items-center gap-3 text-left px-5 py-3 text-xs transition-all ${alreadyIssued?'bg-emerald-50 hover:bg-emerald-100':'hover:bg-pink-50'}`}>
                                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                    <span className="font-black text-slate-800">입고: {receivedDate||'미정'}</span>
                                    <span className="text-slate-400">발주일 {createdDate} · {summarize(po)}</span>
                                  </div>
                                  <span className="text-slate-600 font-bold shrink-0">{totalQty(po)}개</span>
                                  {alreadyIssued
                                    ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">발행완료</span>
                                    : <span className="text-[10px] font-black text-pink-500 bg-pink-100 px-1.5 py-0.5 rounded-full">미발행</span>}
                                  <ChevronRight size={14} className="text-slate-300 shrink-0"/>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {myRequests.length>0 && reqMonths.map(month=>(
                        <div key={`req-${month}`}>
                          <div className="px-5 py-2 bg-indigo-50 flex items-center gap-2 sticky top-0 z-10">
                            <span className="text-[11px] font-black text-indigo-600">발주예정 {month}</span>
                            <span className="text-[10px] text-indigo-400">{reqByMonth[month].length}건</span>
                          </div>
                          <div className="divide-y divide-slate-50">
                            {reqByMonth[month].map(po=>{
                              const alreadyIssued = !!po.linkedStatementId;
                              const createdDate = (po.createdAt||'').slice(0,10);
                              return (
                                <button key={po.id} onClick={()=>clickCard(po)}
                                  className={`w-full flex items-center gap-3 text-left px-5 py-3 text-xs transition-all ${alreadyIssued?'bg-emerald-50 hover:bg-emerald-100':'hover:bg-indigo-50'}`}>
                                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                    <span className="font-black text-slate-800">발주: {createdDate||'미정'}</span>
                                    <span className="text-slate-400">{summarize(po)} · {totalQty(po)}개</span>
                                  </div>
                                  {alreadyIssued
                                    ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">발행완료</span>
                                    : <span className="text-[10px] font-black text-indigo-500 bg-indigo-100 px-1.5 py-0.5 rounded-full">미발행</span>}
                                  <ChevronRight size={14} className="text-slate-300 shrink-0"/>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── 진행 주문 목록 (매출·진행주문만·거래처 미선택) ── */}
            {createMode==='매출' && !selectedClientId && activeOrders.length > 0 && (() => {
              const listOrders = (onlyActive ? activeOrders.filter(o => !o.invoicePrinted) : activeOrders)
                // 스마트스토어 거래처 제외 (전표 발행 대상 아님)
                .filter(o => (partners.find(c => c.id === o.partnerId)?.type ?? o.source) !== '스마트스토어')
                .filter(o => matchKo(partners.find(c => c.id === o.partnerId)?.name || '', partnerSearch))
                .filter(o => { const d = (o.deliveryDate || '').slice(0, 10); return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo); });
              return (
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="px-5 py-2 bg-slate-50 flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{onlyActive ? '미발행 주문' : '진행 주문'}</span>
                  <span className="text-[10px] text-slate-400">{listOrders.length}건</span>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                  {listOrders.slice(0, activeVisible).map(o => {
                    const cl = partners.find(c => c.id === o.partnerId);
                    return (
                      <button key={o.id}
                        onClick={() => { setSelectedClientId(o.partnerId ?? ''); setManualMode(false); handleOrderClick(o); }}
                        className="w-full flex items-center gap-2 text-left px-5 py-2.5 text-xs hover:bg-blue-50 transition-colors">
                        <span className="font-black text-slate-800 w-32 truncate shrink-0">{cl?.name || o.partnerId}</span>
                        <span className={`w-16 text-center shrink-0 text-[10px] font-black px-1.5 py-0.5 rounded-full ${STATUS_COLOR[o.status] || 'bg-slate-100 text-slate-500'}`}>
                          {STATUS_LABEL[o.status] || o.status}
                        </span>
                        <span className="w-28 shrink-0 text-slate-400">납품 {o.deliveryDate?.slice(5,10) || '미정'}</span>
                        <span className="w-14 shrink-0 text-center">
                          {o.invoicePrinted
                            ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">발행</span>
                            : <span className="text-[10px] font-black text-pink-500 bg-pink-100 px-1.5 py-0.5 rounded-full">미발행</span>}
                        </span>
                        <span className="ml-auto shrink-0 text-slate-400">{o.items.length}품목</span>
                      </button>
                    );
                  })}
                  {listOrders.length > activeVisible && (
                    <button onClick={() => setActiveVisible(v => v + 15)}
                      className="w-full py-2 text-[11px] font-black text-blue-600 hover:bg-blue-50 transition-colors">
                      + {listOrders.length - activeVisible}건 더 보기
                    </button>
                  )}
                </div>
              </div>
              );
            })()}


            {/* ── 빠른 품목 입력 바 ── */}
            {selectedClientId && (selectedOrderId || manualMode || editingStmt) && (!editingStmt || isEditMode) && (() => {
              const qProduct = searchableRows.find(r=>(r.product!.name)===quickName)?.product as any;
              const selRow = selectedItemIdx!==null&&manualMode ? manualItems[selectedItemIdx] : null;
              const selItem = selectedItemIdx!==null&&!manualMode ? lineItems[selectedItemIdx] : null;
              const infoProduct = quickName ? qProduct
                : selRow ? (searchableRows.find(r=>(r.product!.name)===selRow.name)?.product as any)
                : selItem ? (allItems.find(p=>p.name===selItem.name||p.품목===selItem.name) as any)
                : null;
              const productCost = infoProduct?.cost ?? 0;
              const salePrice = quickName ? (parseFloat(quickPrice)||0)
                : selRow ? (parseFloat(selRow.price)||0)
                : selItem ? selItem.price : 0;
              const margin = salePrice>0 ? ((salePrice-productCost)/salePrice*100).toFixed(1) : '0.0';
              const qQty = parseFloat(quickQty)||0;
              const qPrc = parseFloat(quickPrice)||0;
              const qAmt = quickIsTaxExempt ? qQty*qPrc : Math.round(qQty*qPrc/1.1);
              const qTax = quickIsTaxExempt ? 0 : qQty*qPrc-qAmt;
              const quickResults = quickSearchOpen ? (() => {
                if (!quickName.trim()) return [];
                const q = quickName.toLowerCase();
                const partnerMatches = searchableRows.filter(r => {
                  const docN = r.product!.name.toLowerCase();
                  return docN.includes(q) || r.product!.name.toLowerCase().includes(q);
                });
                if (partnerMatches.length > 0) return partnerMatches;
                return allItems
                  .filter(p => !isBoxStockItem(p) && (p.name + ' ' + (p.품목 ?? '')).toLowerCase().includes(q))
                  .map(p => {
                    const existingPc = partnerOut.find(pc => pc.itemId === p.id && pc.partnerId === selectedClientId);
                    return {
                      pc: { id: existingPc?.id ?? p.id, itemId: p.id, partnerId: selectedClientId, price: existingPc?.price ?? p.price, taxType: existingPc?.taxType },
                      product: p,
                    };
                  });
              })() : [];
              const addQuickItem = () => {
                if (!quickName.trim()) return;
                const newRow: ManualRow = {name:quickName,spec:quickSpec,qty:quickQty.trim()||'1',price:quickPrice,isTaxExempt:quickIsTaxExempt,note:quickNote};
                setManualMode(true);
                setManualItems(prev=>{
                  const rows = prev.filter(r=>r.name.trim());
                  return [...rows,newRow,{name:'',spec:'',qty:'',price:'',isTaxExempt:false,note:''}];
                });
                setQuickName('');setQuickSpec('');setQuickQty('');setQuickPrice('');setQuickNote('');setQuickSearchOpen(false);setQuickIsTaxExempt(false);
              };
              return (
                <div className="flex-shrink-0 border-b border-slate-100 px-5 py-2.5 bg-white space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <input type="text" value={quickName} placeholder="품목명..."
                        onChange={e=>{setQuickName(e.target.value);setQuickSearchOpen(true);
                          const match=searchableRows.find(r=>(r.product!.name)===e.target.value);
                          if(match){setQuickSpec(match.product!.spec||'');setQuickPrice(String(match.pc.price??match.product!.price??''));setQuickIsTaxExempt(match.pc.taxType==='면세');}
                        }}
                        onFocus={()=>setQuickSearchOpen(true)}
                        onBlur={()=>setTimeout(()=>setQuickSearchOpen(false),150)}
                        className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-40"/>
                      {quickResults.length > 0 && (
                        <div className="absolute left-0 top-full z-50 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                          <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                            <span className="text-[10px] font-black text-slate-500">품목 선택</span>
                          </div>
                          <div className="h-60 overflow-y-auto">
                          {quickResults.slice(0,50).map(r=>{
                            const docN=r.product!.name;
                            const sub = r.product!.submaterials ?? [];
                            const 용기 = sub.find(s=>s.category==='용기')?.name;
                            const 마개 = sub.find(s=>s.category==='마개')?.name;
                            const 정보 = r.product!.oil || r.product!.spec || '';
                            const tags = [용기, 마개, 정보].filter(Boolean).join(' · ');
                            return (
                              <button key={r.pc.id}
                                onMouseDown={()=>{
                                  const price = r.pc.price ?? (r.product as any)?.price ?? 0;
                                  const taxType: '과세'|'면세' = r.pc.taxType === '면세' ? '면세' : '과세';
                                  const isLinked = searchableRows.some(sr => sr.product!.id === r.product!.id);
                                  if (!isLinked && selectedClientId && r.product!.id && createMode === '매출') {
                                    onAddProductClient?.(r.product!.id, selectedClientId, price, taxType);
                                  }
                                  setQuickName(docN);setQuickSpec(r.product!.spec||'');setQuickPrice(String(price||''));setQuickIsTaxExempt(taxType==='면세');setQuickSearchOpen(false);
                                }}
                                className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-blue-50 text-left transition-colors">
                                <span className="font-black text-slate-800">{docN}</span>
                                <span className="text-slate-400 text-[10px]">{tags}</span>
                              </button>
                            );
                          })}
                          </div>
                        </div>
                      )}
                    </div>
                    <input type="text" value={quickSpec} placeholder="규격" onChange={e=>setQuickSpec(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-20"/>
                    <input type="text" inputMode="decimal" value={quickQty} placeholder="수량" onChange={e=>setQuickQty(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-20 text-right"/>
                    <input type="text" inputMode="decimal" value={quickPrice} placeholder="단가" onChange={e=>setQuickPrice(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-24 text-right"/>
                    <input type="text" value={quickNote||''} placeholder="비고" onChange={e=>setQuickNote(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-28"/>
                    <button type="button" onClick={addQuickItem}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-black hover:bg-slate-200 transition-all">
                      직접 추가
                    </button>
                    <button type="button" onClick={()=>{setShowItemPicker(true);setPickerSearch('');setPickerQtys({});}}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-black hover:bg-blue-700 transition-all">
                      <Plus size={11} strokeWidth={3}/>품목 선택
                    </button>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-slate-400">
                    <span>원가 <b className="text-slate-600">{fmt(productCost)}</b></span>
                    <span>매출단가 <b className="text-slate-600">{salePrice>0?fmt(salePrice):'-'}</b></span>
                    {qAmt>0 && <span>공급가액 <b className="text-blue-600">{fmt(qAmt)}</b></span>}
                    {qTax>0 && <span>세액 <b className="text-slate-600">{fmt(qTax)}</b></span>}
                    {salePrice>0 && <span>마진율 <b className={parseFloat(margin)>0?'text-emerald-600':'text-rose-600'}>{margin}%</b></span>}
                  </div>
                </div>
              );
            })()}

            {/* ── 품목 선택 팝업 ── */}
            {showItemPicker && (() => {
              // 검색어 없으면 등록 품목만(깔끔), 검색하면 전품목 대상(반제품·원료·부자재 포함)
              const q=pickerSearch.trim().toLowerCase();
              const filtered = !q
                ? searchableRows
                : pickerRows.filter(r=>((r.product!.name)+' '+(r.product!.품목??'')).toLowerCase().includes(q));
              const confirmPick = () => {
                const toAdd: ManualRow[] = [];
                for (const [itemId,qtyStr] of Object.entries(pickerQtys)) {
                  const qty=parseFloat(qtyStr);
                  if(!qty) continue;
                  const row=pickerRows.find(r=>r.product!.id===itemId);
                  if(!row) continue;
                  const docN=row.product!.name;
                  toAdd.push({name:docN,spec:row.product!.spec||'',qty:String(qty),price:String(row.pc.price??row.product!.price??''),isTaxExempt:row.pc.taxType==='면세',note:''});
                }
                if(toAdd.length===0){setShowItemPicker(false);return;}
                setManualMode(true);
                setManualItems(prev=>{
                  const existing=prev.filter(r=>r.name.trim());
                  return [...existing,...toAdd,{name:'',spec:'',qty:'',price:'',isTaxExempt:false,note:''}];
                });
                setShowItemPicker(false);setPickerSearch('');setPickerQtys({});
              };
              return (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                  onKeyDown={e=>{if(e.key==='Enter')confirmPick();if(e.key==='Escape')setShowItemPicker(false);}}>
                  <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden mx-4">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                      <div>
                        <div className="font-black text-slate-900">품목 선택</div>
                        <div className="text-[10px] text-slate-400">{filtered.length}품목</div>
                      </div>
                      <button type="button" onClick={()=>setShowItemPicker(false)}
                        className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={16}/></button>
                    </div>
                    <div className="px-5 py-3 border-b border-slate-100">
                      <div className="relative">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
                        <input autoFocus type="text" value={pickerSearch} onChange={e=>setPickerSearch(e.target.value)}
                          placeholder="품목명 검색..."
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                      <table className="w-full text-left">
                        <thead className="sticky top-0 bg-slate-50 z-10">
                          <tr>
                            {['품목명','규격','단가','과세','수량'].map(h=>(
                              <th key={h} className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {filtered.length===0 ? (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">품목이 없습니다</td></tr>
                          ) : filtered.map((r,idx)=>{
                            const docN=r.product!.name;
                            const itemId=r.product!.id;
                            const qty=pickerQtys[itemId]||'';
                            const hasQty=!!parseFloat(qty);
                            return (
                              <tr key={itemId}
                                className={`cursor-pointer transition-colors ${hasQty?'bg-blue-50':idx%2===0?'hover:bg-slate-50':'bg-slate-50/50 hover:bg-slate-100'}`}
                                onClick={()=>setPickerQtys(prev=>{const u={...prev};if(u[itemId])delete u[itemId];else u[itemId]='1';return u;})}>
                                <td className="px-4 py-2.5">
                                  <span className="text-xs font-black text-slate-800">{docN}</span>
                                </td>
                                <td className="px-4 py-2.5 text-[11px] text-slate-400">{r.product!.spec||''}</td>
                                <td className="px-4 py-2.5 text-xs text-right font-black text-slate-700">
                                  {r.pc.price!==undefined ? fmt(r.pc.price)+'원' : <span className="text-slate-300 font-normal">미설정</span>}
                                </td>
                                <td className="px-4 py-2.5 text-center">
                                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${r.pc.taxType==='면세'?'bg-indigo-100 text-indigo-700':'bg-slate-100 text-slate-500'}`}>
                                    {r.pc.taxType==='면세'?'면세':'과세'}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5" onClick={e=>e.stopPropagation()}>
                                  <input type="text" inputMode="decimal" value={qty}
                                    onChange={e=>setPickerQtys(prev=>({...prev,[itemId]:e.target.value}))}
                                    placeholder="수량"
                                    className={`w-20 text-right text-xs font-bold border rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-300 ${hasQty?'bg-blue-50 border-blue-200':'bg-white border-slate-200'}`}/>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
                      <span className="text-xs text-slate-500">
                        선택 <b className="text-blue-600">{Object.values(pickerQtys).filter(q=>parseFloat(q)>0).length}</b>품목
                      </span>
                      <div className="flex gap-2">
                        <button type="button" onClick={()=>setShowItemPicker(false)}
                          className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
                        <button type="button" onClick={confirmPick}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700">
                          <Plus size={12} strokeWidth={3}/>추가
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── 주문 연결 안내 배너 ── */}
            {manualMode && selectedOrderId && !editingStmt && (
              <div className="flex-shrink-0 flex items-center gap-2 px-5 py-2 bg-blue-50 border-b border-blue-100">
                <CheckCircle2 size={13} className="text-blue-500 shrink-0"/>
                <span className="text-[11px] font-black text-blue-700">
                  주문 기반 편집 — 품목 추가·수량 변경이 원본 주문에도 반영됩니다
                </span>
              </div>
            )}

            {/* ── 품목 테이블 ── */}
            {selectedClientId && (selectedOrderId || manualMode || editingStmt) ? (
              <div className="flex-1 overflow-auto">
                <table className="w-full min-w-[720px] text-left border-collapse table-fixed">
                  <colgroup>
                    <col style={{width:'40px'}}/>
                    <col style={{width:'22%'}}/>
                    <col style={{width:'13%'}}/>
                    <col style={{width:'10%'}}/>
                    <col style={{width:'12%'}}/>
                    <col style={{width:'12%'}}/>
                    <col style={{width:'9%'}}/>
                    <col style={{width:'12%'}}/>
                    <col style={{width:'10%'}}/>
                    <col style={{width:'36px'}}/>
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="border-b border-slate-200">
                      {[
                        {h:'No',a:'text-center'},
                        {h:'품목명',a:'text-left'},
                        {h:'규격',a:'text-left'},
                        {h:'수량',a:'text-right'},
                        {h:'단가',a:'text-right'},
                        {h:'공급가액',a:'text-right'},
                        {h:'세액',a:'text-center'},
                        {h:'합계',a:'text-right'},
                        {h:'계정',a:'text-left'},
                        {h:'',a:'text-center'},
                      ].map((c,i)=>(
                        <th key={i} className={`px-3 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap ${c.a}`}>{c.h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {manualMode ? (() => {
                      const ro=!!(editingStmt&&!isEditMode);
                      const activeRows=ro?manualItems.filter(r=>r.name.trim()):manualItems;
                      return (<>
                        {activeRows.map((row,idx)=>{
                          const q=parseFloat(row.qty)||0,p=parseFloat(row.price)||0;
                          const sup=row.isTaxExempt?q*p:Math.round(q*p/1.1);
                          const tax=row.isTaxExempt?0:q*p-sup;
                          const searchResults = ro ? [] : (() => {
                            if (!row.name.trim()) return [] as typeof searchableRows;
                            const qq = row.name.toLowerCase();
                            const linked = searchableRows.filter(r => r.product!.name.toLowerCase().includes(qq));
                            if (linked.length > 0) return linked;
                            // 거래처에 등록 안 된 품목도 전체에서 검색 (반제품·원료·부자재 포함)
                            const src = createMode === '매입' ? partnerIn : partnerOut;
                            return allItems
                              .filter(p => !isBoxStockItem(p) && (p.name + ' ' + (p.품목 ?? '')).toLowerCase().includes(qq))
                              .map(p => {
                                const ex = src.find(pc => (pc.itemId) === p.id && (pc.partnerId) === selectedClientId);
                                return { pc: { id: ex?.id ?? p.id, itemId: p.id, partnerId: selectedClientId, price: ex?.price ?? ex?.price ?? p.price, taxType: ex?.taxType }, product: p };
                              }) as unknown as typeof searchableRows;
                          })();
                          const isSel=selectedItemIdx===idx;
                          const isNegQty=(parseFloat(row.qty)||0)<0;
                          return (
                            <tr key={idx}
                              onClick={()=>setSelectedItemIdx(isSel?null:idx)}
                              className={`cursor-pointer transition-colors text-xs ${isSel?'bg-blue-50':isNegQty?'bg-rose-50 hover:bg-rose-100':'hover:bg-slate-50'}`}>
                              <td className="px-3 py-2 text-slate-400 text-center w-8">{idx+1}</td>
                              <td className="px-3 py-2 relative min-w-[120px]">
                                {ro ? <span className="font-black text-slate-800">{row.name}</span> : (<>
                                  <input type="text" placeholder="제품명..." value={row.name}
                                    onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,name:e.target.value}:r))}
                                    onFocus={()=>setActiveSearchRow(idx)}
                                    onBlur={()=>setTimeout(()=>setActiveSearchRow(null),150)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 min-w-[120px]"/>
                                  {activeSearchRow===idx && searchResults.length>0 && (
                                    <div className="absolute left-0 top-full z-50 mt-1 w-64 h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl">
                                      {searchResults.slice(0,50).map(r=>{
                                        const docN=r.product!.name;
                                        const sub2 = r.product!.submaterials ?? [];
                                        const 용기2 = sub2.find(s=>s.category==='용기')?.name;
                                        const 마개2 = sub2.find(s=>s.category==='마개')?.name;
                                        const 정보2 = r.product!.oil || r.product!.spec || '';
                                        const tags2 = [용기2, 마개2, 정보2].filter(Boolean).join(' · ');
                                        return (
                                          <button key={r.pc.id}
                                            onMouseDown={()=>{setManualItems(prev=>prev.map((item,i)=>i===idx?{...item,name:docN,spec:r.product!.spec||'',price:String(r.pc.price??r.product!.price??0),isTaxExempt:r.pc.taxType==='면세'}:item));setActiveSearchRow(null);}}
                                            className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-blue-50 text-left transition-colors">
                                            <span className="font-black text-slate-800">{docN}</span>
                                            <span className="text-slate-400 text-[10px]">{tags2}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </>)}
                              </td>
                              <td className="px-3 py-2 w-20">
                                {ro ? <span className="text-slate-500">{row.spec}</span>
                                  : <input type="text" placeholder="규격" value={row.spec}
                                      onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,spec:e.target.value}:r))}
                                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>}
                              </td>
                              <td className="px-3 py-2 w-16">
                                {ro
                                  ? <span className="block text-right font-bold">
                                      {row.isBoxUnit ? `${row.qty}BOX(${parseFloat(row.qty as string)*12}개)` : row.qty}
                                    </span>
                                  : <div className="flex items-center gap-1">
                                      <input type="text" inputMode="decimal" placeholder="0" value={row.qty}
                                        onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,qty:e.target.value}:r))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>
                                      {row.isBoxUnit && <span className="text-[10px] text-blue-600 font-bold whitespace-nowrap">BOX</span>}
                                    </div>}
                              </td>
                              <td className="px-3 py-2 w-24">
                                {ro ? <span className="block text-right font-bold">{fmt(p)}</span>
                                  : <input type="text" inputMode="decimal" placeholder="0" value={row.price}
                                      onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,price:e.target.value}:r))}
                                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-700">{sup>0?fmt(sup):'-'}</td>
                              <td className="px-3 py-2 text-center">
                                {ro ? (
                                  <span className={`text-[10px] font-black ${row.isTaxExempt?'text-indigo-600':''}`}>
                                    {row.isTaxExempt?'면세':tax>0?fmt(tax):'-'}
                                  </span>
                                ) : (
                                  <button onClick={e=>{e.stopPropagation();setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,isTaxExempt:!r.isTaxExempt}:r));}}
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-black border transition-all ${row.isTaxExempt?'bg-indigo-100 text-indigo-700 border-indigo-200':'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}>
                                    {row.isTaxExempt?'면세':tax>0?fmt(tax):'-'}
                                  </button>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-black text-slate-800">{(sup+tax)>0?fmt(sup+tax):'-'}</td>
                              <td className="px-3 py-2 w-24">
                                {ro
                                  ? <span className="text-[10px] font-black text-slate-500">{row.accountCode || (stmtType === '매출' ? '800' : '-')}</span>
                                  : <select value={row.accountCode || (stmtType === '매출' ? '800' : '')}
                                      onClick={e=>e.stopPropagation()}
                                      onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,accountCode:e.target.value}:r))}
                                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-300">
                                      <option value="">-</option>
                                      {stmtCodes.map(ac=>(
                                        <option key={ac.id} value={ac.code}>{ac.code} {ac.name}</option>
                                      ))}
                                    </select>}
                              </td>
                              <td className="px-3 py-2 w-8 text-center">
                                {!ro && manualItems.length>1 && (
                                  <button onClick={e=>{e.stopPropagation();setManualItems(prev=>prev.filter((_,i)=>i!==idx));}}
                                    className="text-slate-300 hover:text-rose-400 transition-colors">
                                    <X size={14}/>
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {!ro && (
                          <tr className="hover:bg-slate-50 transition-colors">
                            <td colSpan={10} className="px-3 py-2">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                <button onClick={()=>setManualItems(prev=>[...prev,{name:'',spec:'',qty:'',price:'',isTaxExempt:false}])}
                                  className="flex items-center gap-1.5 text-xs font-black text-blue-500 hover:text-blue-700 transition-colors">
                                  <Plus size={12} strokeWidth={3}/>행 추가
                                </button>
                                {/* ── 자주 쓰는 비용 (택배비·상차비·기타) ── */}
                                <span className="text-slate-200">|</span>
                                <span className="text-[10px] font-black text-slate-400">빠른 비용</span>
                                {expensePresets.map(p => (
                                  <span key={p.id} className="inline-flex items-center">
                                    <button type="button" onClick={()=>addExpenseRow(p)}
                                      className="inline-flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-black hover:bg-indigo-100 transition-all">
                                      {p.name}{p.price ? <span className="text-indigo-400 font-bold">{p.price.toLocaleString()}</span> : null}
                                    </button>
                                    {manageExpense && (
                                      <button type="button" onClick={()=>onDeleteExpensePreset?.(p.id)}
                                        title="삭제" className="ml-0.5 text-slate-300 hover:text-rose-500 transition-colors">
                                        <X size={12}/>
                                      </button>
                                    )}
                                  </span>
                                ))}
                                {onAddExpensePreset && (
                                  <button type="button"
                                    onClick={async ()=>{
                                      const name = window.prompt('비용 항목 이름 (예: 택배비)')?.trim();
                                      if (!name) return;
                                      const priceStr = window.prompt(`'${name}' 기본 단가 (없으면 비워두기)`, '')?.replace(/[^\d.]/g,'') ?? '';
                                      const price = priceStr ? Number(priceStr) : undefined;
                                      const exempt = window.confirm('면세 항목인가요?\n확인=면세, 취소=과세');
                                      await onAddExpensePreset({ name, ...(price ? { price } : {}), taxType: exempt ? '면세' : '과세' });
                                    }}
                                    className="inline-flex items-center gap-0.5 px-2 py-1 rounded-full border border-dashed border-slate-300 text-slate-400 text-[11px] font-black hover:border-indigo-300 hover:text-indigo-600 transition-all">
                                    <Plus size={11} strokeWidth={3}/>항목 저장
                                  </button>
                                )}
                                {expensePresets.length > 0 && onDeleteExpensePreset && (
                                  <button type="button" onClick={()=>setManageExpense(v=>!v)}
                                    className={`text-[10px] font-black transition-colors ${manageExpense ? 'text-rose-500' : 'text-slate-300 hover:text-slate-500'}`}>
                                    {manageExpense ? '완료' : '관리'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>);
                    })() : (
                      lineItems.length>0 ? lineItems.map((item,idx)=>{
                        const isSel2=selectedItemIdx===idx;
                        const noCode = !item.accountCode;
                        return (
                          <tr key={item.key}
                            onClick={()=>setSelectedItemIdx(isSel2?null:idx)}
                            className={`cursor-pointer transition-colors text-xs ${isSel2?'bg-blue-50':noCode?'bg-amber-50 hover:bg-amber-100':'hover:bg-slate-50'}`}>
                            <td className="px-3 py-2 text-slate-400 text-center w-8">{item.no}</td>
                            <td className="px-3 py-2 text-[11px] font-black text-slate-800 max-w-[140px]">
                              <span className="block truncate">{item.name}</span>
                            </td>
                            <td className="px-3 py-2 text-[11px] text-slate-400">{item.spec}</td>
                            <td className="px-3 py-2 text-right text-[11px] w-12">{fmt(item.qty)}</td>
                            <td className="px-3 py-2 w-28 shrink-0" onClick={e=>e.stopPropagation()}>
                              <input type="text" inputMode="decimal" placeholder={String(item.price)} value={editablePrices[item.key]??''}
                                onChange={e=>setEditablePrices(prev=>({...prev,[item.key]:e.target.value}))}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-700">{fmt(item.supply)}</td>
                            <td className="px-3 py-2 text-center" onClick={e=>e.stopPropagation()}>
                              <button onClick={()=>setTaxExemptOverrides(prev=>({...prev,[item.key]:!item.isTaxExempt}))}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-black border transition-all ${item.isTaxExempt?'bg-indigo-100 text-indigo-700 border-indigo-200':'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}>
                                {item.isTaxExempt?'면세':fmt(item.tax)}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-right font-black text-slate-800">{fmt(item.total)}</td>
                            <td className="px-3 py-2 w-24" onClick={e=>e.stopPropagation()}>
                              <select
                                value={item.accountCode||''}
                                onChange={e=>{
                                  const code=e.target.value;
                                  setTaxExemptOverrides(prev=>({...prev})); // force rerender trick
                                  // lineItems는 useMemo라 직접 못 바꾸므로 editablePrices와 같은 방식으로 별도 override 관리
                                  setAccountCodeOverrides(prev=>({...prev,[item.key]:code}));
                                }}
                                className={`w-full border rounded-lg px-1.5 py-1 text-[10px] font-bold outline-none focus:ring-2 focus:ring-amber-300 ${!item.accountCode?'bg-amber-50 border-amber-300 text-amber-700':'bg-slate-50 border-slate-200'}`}>
                                <option value="">계정 선택 ⚠</option>
                                {stmtCodes.map(ac=>(
                                  <option key={ac.id} value={ac.code}>{ac.code} {ac.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 w-8"/>
                          </tr>
                        );
                      }) : (
                        <tr><td colSpan={11} className="px-3 py-12 text-center text-sm text-slate-300">주문을 선택하면 품목이 표시됩니다</td></tr>
                      )
                    )}
                    {/* 합계 행 */}
                    <tr className="bg-slate-50 border-t-2 border-slate-200">
                      <td colSpan={3} className="px-3 py-2.5 text-center text-xs font-black text-slate-600">합 계</td>
                      <td className="px-3 py-2.5 text-right text-xs font-black text-slate-700">
                        {fmt(manualMode
                          ? manualItems.reduce((s,r)=>s+(parseFloat(r.qty)||0),0)
                          : lineItems.reduce((s,i)=>s+(i.qty||0),0))}
                      </td>
                      <td/>
                      <td className="px-3 py-2.5 text-right text-xs font-black text-slate-700">{fmt(totalSupply)}</td>
                      <td className="px-3 py-2.5 text-right text-xs font-black text-slate-700">{fmt(totalTax)}</td>
                      <td className="px-3 py-2.5 text-right text-xs font-black text-slate-900">{fmt(totalAmount)}</td>
                      <td colSpan={2}/>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (!selectedClientId && activeOrders.length === 0) ? (
              <div className="flex-1 flex items-center justify-center text-slate-200 bg-slate-50">
                <span className="text-2xl font-black">-</span>
              </div>
            ) : null}

            {/* ── 수금/지불 내역 (전표 조회 시) ── */}
            {editingStmt && !isEditMode && (() => {
              const payments = editingStmt.payments ?? [];
              const paid = payments.reduce((s, p) => s + p.amount, 0);
              const bal = editingStmt.totalAmount - paid;
              const label = editingStmt.type === '매출' ? '수금' : '지불';
              return (
                <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label} 내역</span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-slate-500">합계 <b className="text-slate-800">{fmt(editingStmt.totalAmount)}</b></span>
                      <span className="text-slate-500">{label} <b className="text-emerald-700">{fmt(paid)}</b></span>
                      <span className={`font-black ${bal < 0 ? (editingStmt.type === '매출' ? 'text-rose-600' : 'text-blue-600') : bal === 0 ? 'text-slate-400' : (editingStmt.type === '매출' ? 'text-blue-600' : 'text-rose-600')}`}>
                        {bal < 0
                          ? `${editingStmt.type === '매출' ? '줄돈' : '받을돈'} ${fmt(Math.abs(bal))}`
                          : `잔액 ${fmt(bal)}`}
                      </span>
                    </div>
                  </div>
                  {payments.length === 0 ? (
                    <p className="text-[11px] text-slate-400 py-1">{label} 내역 없음</p>
                  ) : (
                    <div className="space-y-1">
                      {payments.map(p => (
                        <div key={p.id}
                          className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-slate-200">
                          <span className="text-[10px] font-mono text-slate-400 shrink-0">
                            {p.date}{p.createdAt ? ` ${p.createdAt.slice(11,16)}` : ''}
                          </span>
                          <span className="text-xs font-black text-slate-800 flex-1">{fmt(p.amount)}원</span>
                          <span className="text-[10px] text-slate-400">{[p.method, p.note].filter(Boolean).join(' · ')}</span>
                          <button onClick={() => openEditPay(editingStmt, p)}
                            className="text-[10px] font-black text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded-lg transition-all shrink-0">
                            수정
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {bal > 0 && (
                    <button onClick={() => { setCreateMode(null); openPayModal(editingStmt); }}
                      className={`text-[10px] font-black px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${editingStmt.type === '매입' ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}>
                      <Save size={10}/>{label} 처리
                    </button>
                  )}
                </div>
              );
            })()}

            {/* ── 하단 액션 바 ── */}
            {(selectedOrderId || manualMode || editingStmt) && (
            <div className="flex items-center gap-4 px-5 py-3 border-t border-slate-100 bg-white flex-shrink-0 flex-wrap">
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                {editingStmt ? (
                  isEditMode ? (<>
                    <button onClick={handleSaveEdit}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 transition-all">
                      <Save size={13}/>저장
                    </button>
                    <button onClick={handlePrint}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-700 text-white text-xs font-black hover:bg-slate-800 transition-all">
                      <Printer size={13}/>거래명세서
                    </button>
                  </>) : (<>
                    <button onClick={()=>{if(window.confirm('이 전표를 삭제하시겠습니까?')){onDeleteIssuedStatement?.(editingStmt!.id);closeCreate();}}}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 text-white text-xs font-black hover:bg-red-600 transition-all">
                      <X size={13}/>삭제
                    </button>
                    <button onClick={()=>setIsEditMode(true)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white text-xs font-black hover:bg-amber-600 transition-all">
                      <Edit2 size={13}/>수정
                    </button>
                    <button onClick={handlePrint}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-700 text-white text-xs font-black hover:bg-slate-800 transition-all">
                      <Printer size={13}/>거래명세서
                    </button>
                  </>)
                ) : canIssue ? (<>
                  <button onClick={handleIssue}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all ${createMode==='매출'?'bg-blue-600 text-white hover:bg-blue-700':'bg-rose-600 text-white hover:bg-rose-700'}`}>
                    <Plus size={13} strokeWidth={3}/>저장
                  </button>
                  <span className="text-[10px] text-slate-400 font-bold self-center ml-1">저장 후 인쇄·엑셀 가능</span>
                </>) : null}
                {editingStmt && !isEditMode && (
                <button onClick={handleExcel}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200 transition-all">
                  <Download size={13}/>엑셀
                </button>
                )}
              </div>
            </div>
            )}

            <style>{`@media print{.no-print{display:none!important;}}`}</style>

          </div>
        </div>
      )}


      {/* ── 중복 발행 경고 모달 ── */}
      {warnDuplicate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={()=>setWarnDuplicate(null)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 size={20} className="text-amber-600"/>
              </div>
              <div>
                <p className="font-black text-slate-800 text-sm">이미 발행된 전표입니다</p>
                <p className="text-[11px] text-slate-400 mt-0.5">중복 발행 대신 기존 전표를 확인하세요.</p>
              </div>
            </div>
            <div className="bg-amber-50 rounded-2xl px-4 py-3 space-y-1">
              <p className="text-[11px] font-bold text-amber-800">{warnDuplicate.stmt.partnerName} · {warnDuplicate.stmt.tradeDate}</p>
              <p className="text-[10px] text-amber-600">문서번호: {warnDuplicate.stmt.docNo}</p>
              <p className="text-[10px] text-amber-600">합계: {fmt(warnDuplicate.stmt.totalAmount)}원</p>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>{openEdit(warnDuplicate.stmt);setWarnDuplicate(null);}}
                className="flex-1 py-2.5 rounded-xl bg-slate-700 text-white text-xs font-black hover:bg-slate-800">
                기존 전표 보기
              </button>
              <button onClick={()=>{
                const o = warnDuplicate.order;
                const poCard = warnDuplicate.po;
                setWarnDuplicate(null);
                if (poCard) {
                  // 매입 발주카드 재발행: 직접입력으로 로드
                  setManualItems([...poToManualRows(poCard), {name:'',spec:'',qty:'',price:'',isTaxExempt:false}]);
                  setLoadedPoIds(prev => Array.from(new Set([...prev, (poCard as any).id].filter(Boolean))));
                  setManualMode(true);
                } else if (o) {
                  setSelectedOrderId(o.id);
                  setShowPreview(false);
                  setEditablePrices({});
                  setTaxExemptOverrides({});
                }
              }}
                className="flex-1 py-2.5 rounded-xl bg-rose-100 text-rose-700 text-xs font-black hover:bg-rose-200">
                그래도 재발행
              </button>
            </div>
            <button onClick={()=>setWarnDuplicate(null)} className="w-full text-center text-[11px] text-slate-400 hover:text-slate-600">취소</button>
          </div>
        </div>
      )}

      </>}

    </div>
  );
};

export default TradeStatement;
