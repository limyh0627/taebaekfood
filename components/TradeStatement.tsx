
import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { matchesSearch } from '../src/shared/hangul';
import {
  FileText, Printer, Search, ChevronDown, CalendarDays,
  Package, ClipboardList, ChevronRight, CheckCircle2, Edit2, Plus, X, ArrowLeft,
  Save, Download, CheckSquare,
  ChevronLeft, Share2, Check, Wallet, RotateCw, Trash2, Landmark
} from 'lucide-react';
import * as ExcelJS from 'exceljs';
import { Order, Item, Partner, PartnerItem, OrderStatus, IssuedStatement, CompanyInfo, PaymentMethod, AccountCode, AccountGroup, CashAccount, CashEntry, Settlement, FixedCostTemplate, CompanyId, COMPANIES } from '../types';
import { filterCodesForContext } from '../src/features/admin/financials';
import { fetchDateRange } from '../src/shared/services/firebaseService';
import { stampFor, timeOfLocal, issuedMs, nextDocNo } from '../src/shared/voucherStamp';
import { buildJournals } from '../src/shared/buildJournals';
import type { VoucherKind } from '../src/shared/vouchers';
import { boxDerivedUnitPrice, unpackComponent, isBoxStockItem } from '../src/shared/orderUnits';
import { bomOf } from '../src/shared/bomIndex';
import { PurchaseOrder, poLines, ExpensePreset } from '../src/shared/types';
import { totalCashOnHand, unsettledStatements, unmatchedCash, partnerBalanceFromJournals, allocatePartnerCash, partnerCashParts } from '../src/features/admin/cashLedger';
import { AR, AP, journalizeStatement, journalizeTransfer, journalizeCashEntry, settlementAccountCode } from '../src/shared/autoJournal';
import { CashTemplateModal, filterTemplates, activeTemplateId, activeTemplate, isCashDir, templateAccrRows, VOUCHER_DIRS, DIR_CHIP, DIR_HINT, CashTemplate, VoucherDir, SPLIT_MODES, splitModeOf } from '../src/shared/cashTemplates';
import { canAutoIssue, autoVoucherId } from '../src/shared/autoVoucher';
import { buildCashEditPatch, cashEditSplit, cashEditAmount } from '../src/shared/cashEntryEdit';
import { buildTransfer, splitTransfer, OverKind } from '../src/shared/interCompany';
import VoucherTemplateManager from './VoucherTemplateManager';
import type { JournalEntry } from '../src/shared/types';
import { AccountModal } from './CashLedger';
import PageHeader from './PageHeader';

interface TradeStatementProps {
  orders: Order[];
  allItems: Item[];
  partners: Partner[];
  partnerItems?: import('../src/shared/types').PartnerItem[];
  accountCodes?: AccountCode[];
  accountGroups?: AccountGroup[];
  // 자금원장 — 지불/수금처리가 여기에만 기록된다.
  cashAccounts?: CashAccount[];
  cashEntries?: CashEntry[];
  settlements?: Settlement[];
  onAddCashEntry?: (e: Omit<CashEntry, 'id'> & { id: string }) => void;
  onUpdateCashEntry?: (id: string, data: Partial<CashEntry>) => void;
  onAddSettlement?: (s: Omit<Settlement, 'id'> & { id: string }) => void;
  onUpdateSettlement?: (id: string, data: Partial<Settlement>) => void;
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
  onUpsertPartnerItem?: (ps: PartnerItem) => void | Promise<void>;
  onMarkInvoicePrinted?: (id: string, value: boolean) => void;
  onAddIssuedStatement?: (stmt: IssuedStatement) => void;
  /** 지금 보고 있는 회사 — 대납은 상대 회사 장부에도 써야 한다 */
  companyId?: CompanyId;
  /** 회사를 지정해서 저장(대납 전용) — 지금 회사가 아닌 장부에 쓴다 */
  onAddForCompany?: (companyId: CompanyId, payload: { cashEntry?: CashEntry; statement?: IssuedStatement }) => void;
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
const matchKo = (name: string, q: string) => matchesSearch(name, q);

/** 분류 대분류 색 — Tailwind은 클래스명을 조립하면 못 알아보므로 정적 문자열로 둔다 */
const AXIS_CLS: Record<string, string> = {
  '손익': 'bg-rose-600 text-white border-rose-600',
  '재무': 'bg-teal-600 text-white border-teal-600',
  '자금흐름': 'bg-indigo-600 text-white border-indigo-600',
};

const fmt = (n: number) => n.toLocaleString('ko-KR');

/**
 * 잔액이 뒤집혔을 때의 이름 — 매출인데 더 받았으면 **선수금**, 매입인데 더 냈으면 **선급금**.
 * 전엔 '줄돈'·'받을돈'이라 적었는데 잔액 칸에 말이 섞여 지저분하고 회계 용어도 아니었다.
 */
const overLabelOf = (type?: string) => (type === '매출' ? '선수금' : '선급금');

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
  onUpdateCashEntry,
  onAddSettlement,
  onUpdateSettlement,
  onDeleteCashEntry,
  onDeleteSettlement,
  onAddCashAccount,
  onUpdateCashAccount,
  fixedCostTemplates = [],
  companyId = 'taebaek',
  onAddForCompany,
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
  const [pricePanelEdits, setPricePanelEdits] = useState<Record<string, string>>({});
  const [priceSaveState, setPriceSaveState] = useState<Record<string, 'saving' | 'done' | 'error'>>({});

  // ── 직접 입력 모드 ──
  const [manualMode, setManualMode] = useState(false);
  /**
   * `side`가 달린 줄 = **양변 전표(일반전표)**. 기초이월·감가상각처럼 차·대를 직접 세우는 것.
   * 안 실어 나르면 저장 한 번에 side가 사라지고, autoJournal이 짐작을 안 하므로
   * 그 전표의 분개가 통째로 안 선다(미광팩 기초 미지급이 그렇게 비어 있었다).
   */
  type ManualRow = { name: string; spec: string; qty: string; price: string; isTaxExempt: boolean; note?: string; isBoxUnit?: boolean; boxSize?: number; accountCode?: string; side?: '차변' | '대변' };
  const [manualItems, setManualItems] = useState<ManualRow[]>([
    { name: '', spec: '', qty: '', price: '', isTaxExempt: false, note: '' },
  ]);
  // ── 매입: 선택해서 불러온 발주카드 id 목록. 발행 시 이 PO들의 linkedStatementId에 전표 id 연결 + 입고대기 전환 ──
  const [loadedPoIds, setLoadedPoIds] = useState<string[]>([]);
  // 발주카드(PurchaseOrder) → 직접입력 행들로 변환 (묶음 items[] 펼침, 카드 섹션·재발행 공용)
  //
  // 매출(주문 불러오기)과 **같은 규칙으로 박스를 낱개로 푼다** — 전표는 낱개 기준이다.
  //   20개입 박스 3장 → 낱개 60개, 단가도 낱개 매입단가.
  // 예전엔 여기서 안 풀고 박스 수량·박스명을 그대로 넣은 뒤 boxSize를 12로 박아 뒀다.
  // 개입수가 10·20·40인 품목이 전부 12로 잡혀 수량이 어긋났다.
  const poToManualRows = (po: PurchaseOrder): ManualRow[] =>
    poLines(po).map(line => {
      let product = allItems.find(p => p.id === line.itemId);
      let qty = line.quantity;
      const uc = unpackComponent(product);
      if (uc) {
        const loose = allItems.find(p => p.id === uc.itemId);
        if (loose) { product = loose; qty = line.quantity * uc.count; }
      }
      // 단가는 바뀐 품목(낱개) 기준으로 다시 찾는다. 없으면 박스 단가 ÷ 개입수로 파생.
      const ps = (partnerItems ?? []).find((s: any) =>
        s.Direction === 'in' && s.itemId === (product?.id ?? line.itemId) && s.partnerId === selectedClientId);
      const boxPs = uc ? (partnerItems ?? []).find((s: any) =>
        s.Direction === 'in' && s.itemId === line.itemId && s.partnerId === selectedClientId) : undefined;
      const unitPrice = ps?.price ?? (boxPs?.price && uc ? Math.round(boxPs.price / uc.count) : undefined);
      return {
        name: product?.name || line.name || '',
        spec: product?.spec || line.unit || '',
        qty: String(qty),
        price: unitPrice ? String(unitPrice) : '',
        isTaxExempt: (ps ?? boxPs)?.taxType === '면세',
        accountCode: (ps ?? boxPs)?.Account_Code,
      };
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
      //  빈 행은 안 붙인다 — 누를 때마다 하나씩 딸려 나와 지우는 일이 됐다. 필요하면 '행 추가'가 있다.
      return [...rows,
        { name: p.name, spec: '', qty: '1', price: p.price ? String(p.price) : '', isTaxExempt: p.taxType === '면세', note: '' }];
    });
  };
  // ── 비용 전표 발행 모달 (거래처 없이 계정과목+금액) ──
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
  const [payForm, setPayForm] = useState<{ amount: string; date: string; method: PaymentMethod; note: string }>({
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


  // ── 자금(입출금) 전표 수정 모달 ──
  const [editCash, setEditCash] = useState<CashEntry | null>(null);
  const [editCashForm, setEditCashForm] = useState<{ amount: string; date: string; dir: '입금'|'출금'; accountCode: string; note: string }>({ amount:'', date:'', dir:'출금', accountCode:'', note:'' });
  /**
   * 쪼개진 줄(CashEntry.lines) — 모달이 이걸 안 들고 있다가 저장 한 번에 눈앞에서 사라졌다.
   * 쓰는 쪽이 accountCode 한 줄만 보내서, 대출상환(원금+이자)·급여(총액+원천공제) 같은 전표를
   * 열었다 닫기만 해도 자금원장 금액과 분개(줄 합)가 따로 놀았다.
   */
  const [editCashLines, setEditCashLines] = useState<{ accountCode: string; amount: string; note: string }[]>([]);
  //  상계(대체)는 방향을 고를 수 있는 게 아니다 — 모달 기본값만 출금으로 두고, 저장 때 dir은 안 건드린다.
  const openEditCash = (e: CashEntry) => {
    setEditCash(e);
    setEditCashForm({ amount: String(e.amount), date: e.date, dir: e.dir === '대체' ? '출금' : e.dir, accountCode: e.accountCode ?? '', note: e.note ?? '' });
    setEditCashLines((e.lines ?? []).map(l => ({ accountCode: l.accountCode, amount: String(l.amount), note: l.note ?? '' })));
  };
  const closeEditCash = () => { setEditCash(null); setEditCashLines([]); };
  //  판정은 shared/cashEntryEdit이 쥔다 — 화면 조각이라 테스트가 안 닿던 자리였다.
  const editCashIsOffset = editCash?.dir === '대체';
  const editCashSplit = cashEditSplit(editCashLines);
  const editCashSplitSum = editCashSplit.reduce((a, l) => a + l.amount, 0);
  const editCashAmt = cashEditAmount(editCashForm, editCashLines, editCashIsOffset);
  const saveEditCash = () => {
    if (!editCash || !onUpdateCashEntry) return;
    const amt = editCashAmt;
    if (amt <= 0) return;
    // 전표에 상계된 자금이면 상계액(settlement)도 같은 폭으로 옮겨야 미수/미지급 잔액이 안 틀어진다.
    const linked = settlements.filter(s => s.cashEntryId === editCash.id);
    const delta = amt - editCash.amount;
    if (linked.length && delta !== 0) {
      if (linked.length > 1 || !onUpdateSettlement) {
        window.alert('이 자금은 여러 전표에 나눠 상계돼 있어 금액을 여기서 못 고칩니다.\n수금/지불을 삭제한 뒤 다시 잡아주세요.');
        return;
      }
      const next = linked[0].amount + delta;
      if (next <= 0) {
        window.alert(`상계된 금액(${linked[0].amount.toLocaleString()}원)보다 많이 줄일 수 없습니다.\n수금/지불을 삭제한 뒤 다시 입력해 주세요.`);
        return;
      }
      onUpdateSettlement(linked[0].id, { amount: next });
    }
    const patch = buildCashEditPatch(editCash, editCashForm, editCashLines);
    const updated: CashEntry = { ...editCash, ...patch };
    onUpdateCashEntry(editCash.id, patch);
    // 상계액을 방금 옮겼으면 settlements가 최신이 아니라 매칭 계산이 어긋난다 → 그때만 건너뛴다.
    if (!(linked.length && delta !== 0)) autoMatchCashToStatements(updated);
    closeEditCash();
  };

  // ── 빠른 수금/지불 모달 ──
  const [showQuickPay, setShowQuickPay] = useState(false);
  const [quickPayClientId, setQuickPayClientId] = useState('');
  const [quickPayClientSearch, setQuickPayClientSearch] = useState('');
  const [quickPayDate, setQuickPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [quickPayAmount, setQuickPayAmount] = useState('');
  const [quickPayMethod, setQuickPayMethod] = useState<PaymentMethod>('계좌이체');
  const [quickPayNote, setQuickPayNote] = useState('');
  const [quickPayDropOpen, setQuickPayDropOpen] = useState(false);
  const [quickPayOverWarn, setQuickPayOverWarn] = useState(false);
  // 입출금 모달 확장 — 일반/상환/급여 + 방향 + 계정과목 (장부 흡수)
  const [qpMode, setQpMode] = useState<'일반' | '상환' | '급여' | '보험' | '세금'>('일반');
  // 4대보험 — 회사부담(비용)과 근로자부담(맡아둔 예수금)을 갈라 넣는다
  const [qpInsCorp, setQpInsCorp] = useState('');
  const [qpInsEmp, setQpInsEmp] = useState('');
  // 세금 — 부가세·소득세를 한 번에 내도 성격이 달라 갈라 적는다
  const [qpVat, setQpVat] = useState('');
  const [qpIncomeTax, setQpIncomeTax] = useState('');
  /**
   * 아직 안 낸 원천공제(예수금 254 잔액) — 급여에서 뗐지만 아직 공단에 안 낸 돈.
   * 4대보험 낼 때 근로자부담분이 보통 이 금액이다. 템플릿 적용과 화면 버튼이
   * **같은 값**을 봐야 해서 여기 한 곳에서만 센다.
   */
  const heldWithholding = useMemo(() => {
    const code = accountCodes.find(c => c.name === '예수금')?.code ?? '254';
    return cashEntries.reduce((a, e) => {
      const parts = (e.lines ?? []).filter(l => l.accountCode === code);
      const v = parts.length ? parts.reduce((b, l) => b + l.amount, 0) : (e.accountCode === code ? e.amount : 0);
      if (!v) return a;
      return a + (e.dir === '입금' ? v : -v);
    }, 0);
  }, [cashEntries, accountCodes]);
  const [qpDir, setQpDir] = useState<VoucherDir>('출금');
  const [qpAccountCode, setQpAccountCode] = useState('');
  /**
   * 일반전표를 **여러 계정으로 쪼갠 줄.** 통장 쪽(반대변)은 dir·cashAccountId가 이미 정하므로
   * 반대편만 줄로 적는다 — CashEntry.lines가 바로 이 모양이다(대출상환 원금+이자와 같은 자리).
   * 켜기 전엔 계정 하나(qpAccountCode)로 끊는다 — 대부분이 그 꼴이라 기본은 단순하게 둔다.
   */
  const [qpSplitOn, setQpSplitOn] = useState(false);
  const [qpCashRows, setQpCashRows] = useState<{ note: string; accountCode?: string; price: string }[]>(
    [{ note: '', price: '' }, { note: '', price: '' }]);
  const [qpPickerOpen, setQpPickerOpen] = useState(false);
  // 발생(돈 안 움직임) — 계정 여러 줄. 옛 대체전표 입력을 여기로 흡수했다.
  // 대체전표 줄 — **차·대를 손으로 고른다.** 짐작하지 않는다(자본을 차변에 세우는 전표가 있다).
  /**
   * 차·대를 손으로 고칠 것인가 — **기본은 안 보인다.**
   *
   * 전표에 차·대는 늘 있지만, 사용자가 고를 일은 거의 없다. 템플릿이 양식을 알고 있고
   * 급여 발생·상계·기초는 버튼이 알아서 끊는다. 회계를 아는 사람만 쓸 수 있는 화면이 되면 안 된다.
   * 중고 기계 매각처럼 계정이 여러 개 얽히는 특수 전표에서만 펼쳐 쓴다.
   */
  const [qpShowSides, setQpShowSides] = useState(false);
  const [qpAccrRows, setQpAccrRows] = useState<
    { name: string; accountCode?: string; price: string; side: '차변' | '대변' }[]
  >([{ name: '', price: '', side: '차변' }]);
  // 회사 간 이체 — 우리 통장에서 다른 회사 통장으로 보낼 때. 양쪽에 한 건씩 선다.
  const [qpAdvCompany, setQpAdvCompany] = useState<CompanyId>('punghoe');
  const [qpAdvAmount, setQpAdvAmount] = useState('');
  // 미지급을 넘는 몫의 성격 — 물건을 받을 것이면 선급금, 그냥 빌려준 것이면 대여금
  const [qpAdvOver, setQpAdvOver] = useState<OverKind>('선급금');
  //  기본은 **장기차입금**(293) — 사업자 대출은 대개 1년을 넘긴다.
  //  1년 안에 갚는 건만 단기차입금(260)이다. 템플릿에 박아 두면 그게 이긴다.
  const [qpLoanCode, setQpLoanCode] = useState('293');
  const [qpPrincipal, setQpPrincipal] = useState('');
  const [qpInterest, setQpInterest] = useState('');
  const [qpGross, setQpGross] = useState('');
  const [qpDeduction, setQpDeduction] = useState('');
  /**
   * 방금 고른 템플릿 — **id로 기억한다.**
   *
   * 예전엔 계정과목으로 되찾았는데(activeTemplateId), 같은 계정을 쓰는 템플릿이 둘 이상이면
   * 먼저 오는 게 잡혔다. '리스료'를 골라도 목록엔 '리스료 (안사장)'이 눌린 것처럼 보였다.
   * 값은 고른 대로 들어갔지만 이름이 딴 것이라 무슨 전표를 쓰는 중인지 못 믿게 된다.
   */
  const [qpTemplateId, setQpTemplateId] = useState<string | null>(null);
  const openCashModal = (dir: '입금' | '출금') => {
    setQpMode('일반'); setQpDir(dir); setQpAccountCode(''); setQpPickerOpen(false);
    setQpSplitOn(false); setQpCashRows([{ note: '', price: '' }, { note: '', price: '' }]);
    setQpInsCorp(''); setQpInsEmp(''); setQpVat(''); setQpIncomeTax(''); setQpTemplateId(null);
    setQpAccrRows([{ name: '', price: '', side: '차변' }]); setQpShowSides(false);
    setQpAdvCompany(companyId === 'taebaek' ? 'punghoe' : 'taebaek');
    setQpAdvAmount(''); setQpAdvOver('선급금');
    setQpPrincipal(''); setQpInterest(''); setQpGross(''); setQpDeduction(''); setQpLoanCode('260');
    setShowQuickPay(true); setQuickPayOverWarn(false);
    setQuickPayClientId(''); setQuickPayClientSearch(''); setQuickPayAmount(''); setQuickPayNote('');
    setQuickPayDate(new Date().toISOString().slice(0, 10));
    setQuickPayAccountId(prev => prev || activeCashAccounts[0]?.id || '');
  };

  const activeCashAccounts = useMemo(() => cashAccounts.filter(a => a.active), [cashAccounts]);
  const codeName = useMemo(() => new Map(accountCodes.map(c => [c.code, c.name])), [accountCodes]);
  // 고른 방향의 템플릿만. 카드를 누르면 모드·계정과목·비고가 한 번에 채워진다.
  // 방향으로 안 거른다 — 고른 템플릿이 방향을 정한다(템플릿 화면과 같은 목록이 보여야 한다)
  const qpTemplates = useMemo(
    () => filterTemplates(accountCodes, fixedCostTemplates),
    [accountCodes, fixedCostTemplates],
  );
  /**
   * 템플릿을 고르면 **양식 전체가 그 템플릿이 된다** — 계정·거래처·금액·품목까지.
   * 매달 같은 곳에 같은 금액을 넣는 전표가 대부분이라, 그게 실제로 시간을 줄인다.
   *
   * 안 채우는 칸을 남겨 두면 안 된다. 앞서 고른 템플릿의 값이 그대로 남아
   * **딴 전표 금액으로 끊긴다** — 없는 값은 비우는 것까지가 '가져오는' 것이다.
   */
  const pickTemplate = (t: CashTemplate) => {
    setQpTemplateId(t.id);    // 고른 것을 id로 붙든다 — 계정만으로는 같은 계정 템플릿이 섞인다
    setQpDir(t.dir);          // 방향은 템플릿이 정한다
    setQpMode(t.mode);
    setQpAccountCode(t.accountCode ?? '');
    // 비고는 품목명 > 템플릿 비고 순 — 전표에 그대로 남는 글이라 품목명이 먼저다
    setQuickPayNote(t.itemName || t.note || '');
    if (t.partnerId) { setQuickPayClientId(t.partnerId); setQuickPayClientSearch(''); }
    else { setQuickPayClientId(''); setQuickPayClientSearch(''); }
    setQuickPayAmount(t.amount && t.amount > 0 ? String(t.amount) : '');
    /*
     * 비현금 갈래(대체·줄돈·받을돈)는 금액칸이 아니라 **'계정 · 금액' 줄**을 쓴다.
     * 리스료·임대료처럼 대체로 끊는 템플릿이 여기 걸린다 — 이 줄을 안 채우면
     * 금액과 계정을 들고 있는 템플릿을 골라도 빈 양식이 떴다.
     */
    setQpAccrRows(templateAccrRows(t));
    setQpShowSides(false);   // 템플릿이 차·대를 안다 — 손댈 일이 없다
    // 두 줄로 갈리는 갈래(보험·상환·급여·세금)는 금액칸을 안 쓴다 — 템플릿에 박아 둔 두 값을 그대로 채운다.
    // 먼저 넷을 다 비우고 고른 갈래만 채운다. 안 그러면 앞 템플릿의 원금·공제가 남는다.
    setQpInsCorp(''); setQpInsEmp(''); setQpPrincipal(''); setQpInterest('');
    setQpGross(''); setQpDeduction(''); setQpVat(''); setQpIncomeTax('');
    //  4대보험만 폴백을 둔다: 옛 템플릿엔 총액 하나뿐이라, 미납 예수금만큼을 근로자부담으로
    //  떼고 나머지를 회사부담으로 짐작한다. 짐작이라 그대로 고쳐 쓰면 된다.
    const sm = splitModeOf(t.mode);
    if (sm) {
      const S = SPLIT_MODES[sm];
      const a = (t as Record<string, any>)[S.a], b = (t as Record<string, any>)[S.b];
      const setters: Record<string, [(v: string) => void, (v: string) => void]> = {
        보험: [setQpInsCorp, setQpInsEmp],
        상환: [setQpPrincipal, setQpInterest],
        급여: [setQpGross, setQpDeduction],
        세금: [setQpVat, setQpIncomeTax],
      };
      if (sm === '상환' && t.loanCode) setQpLoanCode(t.loanCode);
      const [setA, setB] = setters[sm];
      if (a != null || b != null) { setA(a ? String(a) : ''); setB(b ? String(b) : ''); }
      else if (sm === '보험' && (t.amount ?? 0) > 0) {
        const total = t.amount ?? 0;
        const emp = Math.max(0, Math.min(Math.round(heldWithholding), total));
        setQpInsEmp(emp > 0 ? String(emp) : '');
        setQpInsCorp(String(total - emp));
      }
    }
    setQpPickerOpen(false);
  };
  /**
   * 거래처 칸을 눌렀을 때 — **고른 거래처를 지우지 않는다.**
   *
   * 전에는 focus에서 지웠다(빈 칸이라야 검색어를 친다고 봤다). 그런데 템플릿이 넣어 준
   * 거래처가 맞는지 **확인하려고 누른 것만으로** 사라져, 템플릿이 거래처를 안 가져온 것처럼 보였다.
   * 대신 글자를 통째로 잡아 둔다 — 바꾸려면 그냥 치면 덮이고, 안 치면 그대로 남는다.
   */
  const onPartnerFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.select();
    setQuickPayDropOpen(true);
  };
  /** 지금 쓰는 템플릿 — 고른 id가 있으면 그것, 없으면(전표 수정 등) 계정으로 짐작한다. */
  const currentTemplate = (list: CashTemplate[]) =>
    (qpTemplateId ? list.find(t => t.id === qpTemplateId) : undefined)
      ?? activeTemplate(list, { mode: qpMode, accountCode: qpAccountCode });

  // 계정 5분류 — 자금 전표가 비용인지 수익인지 가려 매입/매출 합계에 반영하는 데 쓴다.
  const codeType = useMemo(() => new Map(accountCodes.map(c => [c.code, c.type])), [accountCodes]);

  /**
   * 전표 구분 — 축이 둘이고, 한 줄이 양쪽에 걸릴 수도 있다.
   *
   *   손익축   수익 ⊃ 매출      비용 ⊃ 매입        (손익계산서에 잡히는 것)
   *   자금축   입금 ⊃ 수금      출금 ⊃ 지불        (통장이 움직인 것)
   *
   * 수금은 **입금 아래지 수익이 아니다.** 매출은 전표를 끊을 때 이미 수익으로 잡혔고,
   * 수금은 그 채권을 현금으로 턴 것뿐이라 또 세면 매출이 두 번 잡힌다.
   * 반대로 이자비용처럼 전표 없이 자금으로만 생긴 손익은 두 축에 함께 걸린다
   * (통장에서 나갔으니 출금이고, 전표가 없었으니 여기서 비용이 발생한 것).
   */
  const classifyRow = useCallback((row: TimelineRow): {
    pl?: '수익' | '비용'; plAmount: number; cash?: '입금' | '출금'; transfer?: boolean;
  } => {
    if (row.kind === 'stmt') {
      if (row.data.type === '매출') return { pl: '수익', plAmount: row.data.totalAmount };
      if (row.data.type === '매입') return { pl: '비용', plAmount: row.data.totalAmount };
      return { transfer: true, plAmount: 0 };                       // 대체전표
    }
    if (row.kind === 'pay') {
      return { cash: row.stmtType === '매출' ? '입금' : '출금', plAmount: 0 };
    }
    const want = row.dir === '입금' ? '수익' : '비용';
    const parts = (row.entry.lines ?? []).filter(l => l.accountCode && l.amount > 0);
    const plAmount = parts.length
      ? parts.reduce((a, l) => a + (codeType.get(l.accountCode) === want ? l.amount : 0), 0)
      : (row.accountCode && codeType.get(row.accountCode) === want ? row.amount : 0);
    return { cash: row.dir, plAmount, ...(plAmount > 0 ? { pl: want } : {}) };
  }, [codeType]);
  // ── 분개 펼침 ── 목록의 모든 줄(매출·매입·대체·수금/지불·자금)이 같은 방식으로 열린다.
  // 계산은 재무제표·손익분석이 쓰는 journalize* 함수 그대로라 화면끼리 숫자가 어긋날 수 없다.
  const [expandedJournal, setExpandedJournal] = useState<Set<string>>(new Set());
  const toggleJournal = (id: string) => setExpandedJournal(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const normalOf = useCallback(
    (code: string): 'debit' | 'credit' =>
      accountCodes.find(a => String(a.code) === String(code))?.normalBalance ?? 'debit',
    [accountCodes]);
  // 대체전표(type '비용')는 차·대를 직접 세우므로 journalizeTransfer로 간다
  const journalOfStmt = (s: IssuedStatement): JournalEntry | null =>
    s.type === '비용' ? journalizeTransfer(s, normalOf) : journalizeStatement(s);
  /** 분개 미리보기 — 표(compact=false)와 모바일 카드(compact=true) 공용. */
  const renderJournal = (je: JournalEntry | null, compact = false) => {
    if (!je) return (
      <p className={`${compact ? 'px-2.5 py-2' : ''} text-[11px] font-black text-amber-600`}>
        계정이 지정되지 않아 분개를 만들 수 없습니다 — 손익·재무제표에 안 잡힙니다.
      </p>
    );
    const totalD = je.lines.reduce((a, l) => a + (l.debit ?? 0), 0);
    const totalC = je.lines.reduce((a, l) => a + (l.credit ?? 0), 0);
    if (compact) return (
      <>
        {je.lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white last:border-0 text-[11px]">
            <span className={`shrink-0 font-black ${l.debit ? 'text-slate-600' : 'text-slate-400'}`}>{l.debit ? '차변' : '대변'}</span>
            <span className="flex-1 min-w-0 truncate font-bold text-slate-700">
              <span className="text-slate-400 font-mono mr-1">{l.accountCode}</span>{codeName.get(l.accountCode) ?? ''}
            </span>
            <span className="shrink-0 font-black tabular-nums text-slate-700">{fmt(l.debit || l.credit)}</span>
          </div>
        ))}
      </>
    );
    return (
      <div className="inline-block min-w-[380px] rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="grid grid-cols-[46px_1fr_110px_110px] bg-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-widest">
          <span className="px-2 py-1.5">구분</span>
          <span className="px-2 py-1.5">계정</span>
          <span className="px-2 py-1.5 text-right">차변</span>
          <span className="px-2 py-1.5 text-right">대변</span>
        </div>
        {je.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[46px_1fr_110px_110px] border-t border-slate-50 text-[11px]">
            <span className={`px-2 py-1.5 font-black ${l.debit ? 'text-slate-600' : 'text-slate-400'}`}>{l.debit ? '차변' : '대변'}</span>
            <span className="px-2 py-1.5 font-bold text-slate-700">
              <span className="text-slate-400 font-mono mr-1">{l.accountCode}</span>
              {codeName.get(l.accountCode) ?? ''}
            </span>
            <span className="px-2 py-1.5 text-right font-black tabular-nums text-slate-700">{l.debit ? fmt(l.debit) : ''}</span>
            <span className="px-2 py-1.5 text-right font-black tabular-nums text-slate-700">{l.credit ? fmt(l.credit) : ''}</span>
          </div>
        ))}
        <div className="grid grid-cols-[46px_1fr_110px_110px] border-t-2 border-slate-200 bg-slate-50 text-[11px]">
          <span className="px-2 py-1.5" />
          <span className="px-2 py-1.5 font-black text-slate-400">합계</span>
          <span className="px-2 py-1.5 text-right font-black tabular-nums text-slate-800">{fmt(totalD)}</span>
          <span className="px-2 py-1.5 text-right font-black tabular-nums text-slate-800">{fmt(totalC)}</span>
        </div>
      </div>
    );
  };
  /** 표에서 분개를 담는 줄 — 첫 칸은 비우고 나머지를 통으로 쓴다. */
  const journalTr = (key: string, je: JournalEntry | null) => (
    <tr key={key} className="bg-slate-50/80">
      <td />
      <td colSpan={6} className="px-4 pt-1 pb-3">{renderJournal(je)}</td>
    </tr>
  );
  /** 펼치기 화살표 — 행 클릭(편집)과 겹치지 않게 이벤트를 끊는다. */
  const journalToggle = (id: string) => (
    <button onClick={e => { e.stopPropagation(); toggleJournal(id); }}
      title={expandedJournal.has(id) ? '분개 접기' : '분개 보기 — 차변/대변'}
      className="shrink-0 text-slate-300 hover:text-slate-700 transition-colors">
      {expandedJournal.has(id) ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
    </button>
  );
  // 계좌별 현재 잔액 + 보유자금 총액 (장부 흡수 — 전표 화면에서 잔액 확인)
  const cashBalances = useMemo(() => {
    const active = cashAccounts.filter(a => a.active);
    const perAccount = active.map(a => ({ acct: a, bal: totalCashOnHand([a], cashEntries, today()) }));
    const total = totalCashOnHand(active.filter(a => a.type !== '카드'), cashEntries, today());
    return { perAccount, total };
  }, [cashAccounts, cashEntries]);
  const cashEntryById = useMemo(() => new Map(cashEntries.map(e => [e.id, e])), [cashEntries]);

  // 수금·지불은 **자금원장 한 곳**에만 적힌다. 전표에 매달던 payments[]는 2026-08-16에
  // 남은 1건까지 이관하고 걷어냈다 — 근거가 두 갈래면 같은 거래처가 화면마다 다른 잔액으로 보인다.
  //
  // 전표 한 장의 잔액은 "어느 청구서를 갚았나"가 기록에 없으므로 거래처 수금을 오래된 전표부터
  // 채워 나눈다(합계는 거래처 잔액과 같다). 자금기록이 지워진 상계는 안 친다 — 근거가 사라졌으니 안 받은 돈이다.
  const openByStmt = useMemo(() => {
    const out = new Map<string, number>();
    const keys = new Set(issuedStatements
      .filter(st => st.type === '매출' || st.type === '매입')
      .map(st => `${st.partnerId}|${st.type}`));
    for (const key of keys) {
      const [pid, type] = key.split('|');
      for (const [id, open] of allocatePartnerCash(pid, type as '매출' | '매입', issuedStatements, cashEntries, settlements)) {
        out.set(id, open);
      }
    }
    return out;
  }, [issuedStatements, cashEntries, settlements]);
  const getBalance = (s: IssuedStatement) => openByStmt.get(s.id) ?? s.totalAmount;


  /** 결제 기록 — 자금원장에 출금/입금 1건을 만든다. */
  const recordPayment = (
    allocations: { stmt: IssuedStatement; amount: number }[],
    opts: { date: string; method?: PaymentMethod; note?: string; cashAccountId?: string },
  ) => {
    const total = allocations.reduce((a, x) => a + x.amount, 0);
    if (total <= 0) return;
    if (!onAddCashEntry) return;
    // 계좌를 안 쓰기로 함 → 계좌 없어도 cashAccountId=''(미지정)로 자금원장에 기록.
    const acctId = opts.cashAccountId || cashAccounts.find(a => a.active)?.id || '';
    const first = allocations[0].stmt;

    // 상대계정 판정은 settlementAccountCode 한 곳에 있다(테스트로 잠가 뒀다).
    const groupTypeOf = (code: string) =>
      accountGroups.find(g => g.id === accountCodes.find(c => c.code === code)?.groupId)?.type;
    const itemCodes = allocations.flatMap(({ stmt }) =>
      (stmt.items ?? []).map(i => i.accountCode).filter(Boolean) as string[]);
    const payCode = settlementAccountCode(first.type, itemCodes, groupTypeOf);

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
      createdAt: stampFor(opts.date),
    });
    // 전표 매칭(settlement)은 만들지 않는다 — 잔액은 거래처 단위로만 본다.
    // 어느 청구서를 갚았는지 연결하지 않으니 매칭이 어긋나거나 고아가 될 자리가 없다.
  };

  const openPayModal = (stmt: IssuedStatement) => {
    setPayOverWarn(false);
    setPayTarget(stmt);
    // 기본값은 이 전표 금액 — 안 고치면 전표 금액 그대로 수금/지불된다.
    setPayForm({ amount: String(Math.round(stmt.totalAmount)), date: new Date().toISOString().slice(0, 10), method: '계좌이체', note: '' });
    setPayAccountId(prev => prev || activeCashAccounts[0]?.id || '');
  };

  const savePayment = (forceOver = false) => {
    if (!payTarget || !payForm.amount) return;
    const amount = Number(payForm.amount);
    if (amount <= 0) return;
    // 초과 판정은 거래처 잔액 기준 — 돈은 전표가 아니라 거래처 채권·채무에서 빠진다.
    const liveStmt = issuedStatements.find(s => s.id === payTarget.id) ?? payTarget;
    const pb = partnerBalances.get(liveStmt.partnerId);
    const bal = liveStmt.type === '매입' ? (pb?.payable ?? 0) : (pb?.receivable ?? 0);
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

  // 타임라인의 수금/지불 행 삭제 — 그 cashEntry와 거기 붙은 settlement를 전부 지운다(잔액이 정확히 되돌려짐).
  //
  // paymentId에는 **자금기록 id**가 들어온다(타임라인이 `paymentId: e.id`로 만든다).
  // 예전엔 이걸 settlement id로 알고 찾아서 늘 못 찾고 아무것도 안 지웠다 — 삭제가 안 되던 원인.
  const deletePayTimelineRow = (paymentId: string, _src: IssuedStatement) => {
    if (!window.confirm('이 수금/지불을 삭제할까요?')) return;
    // 자금기록 id로 바로 찾고, 못 찾으면 settlement id로도 한 번 더 본다(옛 행 대비)
    const ceId = cashEntries.some(c => c.id === paymentId)
      ? paymentId
      : settlements.find(s => s.id === paymentId)?.cashEntryId;
    if (!ceId) { alert('이 수금 기록을 찾지 못했습니다. 자금원장에서 지워 주세요.'); return; }
    settlements.filter(s => s.cashEntryId === ceId).forEach(s => onDeleteSettlement?.(s.id));
    onDeleteCashEntry?.(ceId);
  };

  /** 외상매출금(108)·외상매입금(251)으로 잡은 자금은 전표에 붙어야 미수/미지급이 줄어든다.
   *  계정만 바꾸면 분개만 맞고 잔액은 그대로이므로, 아직 안 붙은 금액을 그 거래처의
   *  미결제 전표에 오래된 순으로 매칭한다. 붙인 금액을 돌려준다. */
  const autoMatchCashToStatements = (entry: CashEntry): number => {
    if (!onAddSettlement || !entry.partnerId) return 0;
    const type = entry.accountCode === AR ? '매출' : entry.accountCode === AP ? '매입' : null;
    if (!type) return 0;
    let left = unmatchedCash(entry, settlements);
    if (left <= 0) return 0;
    const targets = unsettledStatements(mergedStatements, settlements, { type, partnerId: entry.partnerId });
    if (!targets.length) return 0;
    const willMatch = Math.min(left, targets.reduce((a, t) => a + t.open, 0));
    if (!window.confirm(
      `${entry.accountCode === AR ? '외상매출금' : '외상매입금'}으로 잡힌 ${fmt(left)}원을\n` +
      `이 거래처의 미결제 전표에 오래된 순으로 ${fmt(willMatch)}원 매칭할까요?\n\n` +
      `매칭해야 미수금/미지급금이 줄어듭니다.`)) return 0;
    let used = 0;
    for (const t of targets) {
      if (left <= 0) break;
      const amount = Math.min(left, t.open);
      if (amount <= 0) continue;
      onAddSettlement({
        id: `settle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        cashEntryId: entry.id, statementId: t.stmt.id, amount, createdAt: new Date().toISOString(),
      });
      left -= amount; used += amount;
    }
    return used;
  };

  // 타임라인의 수금/지불 행 클릭 — 수금/지불은 결국 자금원장 한 줄이므로 그 뒤의
  // 자금 전표(cashEntry)를 연다.
  const openPayTimelineRow = (paymentId: string, _src: IssuedStatement) => {
    if (!onUpdateCashEntry) return;
    // paymentId에는 **자금기록 id**가 들어온다(타임라인이 `paymentId: e.id`로 만든다).
    // 예전엔 settlement id로만 찾아서 늘 못 찾고 아무것도 안 열렸다 — 삭제 쪽은 고쳤는데 여기가 남아 있었다.
    // 옛 행은 settlement id로 들어올 수 있어 그쪽도 한 번 더 본다.
    const entry = cashEntries.find(c => c.id === paymentId)
      ?? cashEntries.find(c => c.id === settlements.find(s => s.id === paymentId)?.cashEntryId);
    if (entry) openEditCash(entry);
    else alert('이 수금/지불의 자금 전표를 찾지 못했습니다. 자금원장에서 확인해 주세요.');
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
  const [histFrom, setHistFrom] = useState(today);
  const [histTo, setHistTo]     = useState(today);
  /**
   * 유형 필터 — **전표 종류 한 축**이다. 전표 하나가 정확히 한 곳에만 속한다.
   *
   * 전엔 수익·비용(손익축) + 자금(자금축) + 대체(전표종류)를 섞어 놨다. 그래서
   * 전기세 출금이 비용에도 자금에도 뜨고, 기계구입·대출상환은 어느 손익 탭에도
   * 안 잡혀 사각지대가 됐다. 손익으로 보고 싶으면 손익분석·재무제표 화면이 따로 있다.
   */
  /**
   * 행 하나가 어느 유형인가 — **정확히 하나**에만 속한다(겹치지도 빠지지도 않는다).
   *
   *   매출·매입·대체   전표(issuedStatement)
   *   수금·지불        거래처 채권·채무를 턴 자금(108/251)
   *   이체             회사 간 대여·차입(137/267)
   *   입금·출금        그 밖의 자금
   */
  /**
   * 전표 갈래 — **다섯 가지뿐이다.** 매출 · 매입 · 대체 · 입금 · 출금.
   *
   * 예전엔 수금·지불·이체까지 여덟 가지를 썼는데, 그건 갈래가 아니라 **무슨 돈이냐**다.
   * 돈이 들어왔으면 입금이고, 나갔으면 출금이다. 수금이냐 이자냐는 계정과목이 말해 준다.
   * 갈래를 늘릴수록 필터가 갈리고, 한 전표가 여러 갈래에 걸치면 어디에도 안 잡힌다.
   *
   * **줄이 여럿이어도 갈래는 하나다.** 대출상환은 (차)차입금+이자 /(대)통장 —
   * 대변이 통장 하나이므로 출금전표다. 차변이 여럿인 건 갈래와 상관없다.
   */
  const rowKind = useCallback((row: TimelineRow): VoucherKind => {
    if (row.kind === 'stmt') {
      return row.data.type === '매출' ? '매출' : row.data.type === '매입' ? '매입' : '대체';
    }
    if (row.kind === 'pay') return row.stmtType === '매출' ? '입금' : '출금';
    if (row.entry.dir === '대체') return '대체';
    return row.dir === '입금' ? '입금' : '출금';
  }, []);

  /*
   * 갈래(매출·매입·대체·입금·출금)는 **필터가 아니라 표시**다.
   *
   * 갈래로 거르면 복합 전표가 통째로 빠진다 — 대출상환은 출금전표인데 안에 이자비용이 있고,
   * 급여 발생은 대체전표인데 인건비다. "이번 달 나간 비용"을 갈래로 찾으면 못 찾는다.
   * 무엇을 찾을 때 쓰는 건 **성격(줄의 계정)**이고, 갈래는 행의 배지로만 보여준다.
   */
  /**
   * 전표 화면은 **"이 계정에 무슨 전표가 끊겼나"**를 보는 자리다. 손익 요약은 손익분석이 한다.
   * 그래서 필터가 둘이고, 성질이 달라 모양도 다르다.
   *
   *   갈래   매출 · 매입 · 대체 · 입금 · 출금        다섯 개 고정 → 버튼
   *   계정   대분류 › 계정그룹 › 계정과목            계층이 깊고 수십 개 → 드롭다운
   *
   * 계정은 **줄의 계정**으로 거른다. 전표 머리(갈래)로 보면 복합 전표가 통째로 빠진다 —
   * 대출상환은 출금전표인데 안에 이자비용과 차입금이 같이 있다.
   */
  const [histKind, setHistKind] = useState<'전체' | VoucherKind>('전체');
  /**
   * 계정과목 필터 — **한 값**으로 든다. '' | axis:손익 | group:<id> | type:자산 | code:<코드>
   *
   * 드릴다운으로 층을 내려가게 했더니, 이름을 아는 계정 하나를 찾는 데도 세 번을 골라야 했다.
   * 계정은 수십 개지만 **찾는 사람은 이름을 안다.** 그래서 검색되는 목록 하나로 바꿨고,
   * 계층은 줄마다 경로로 보여 준다(손익 › 영업외비용 › 951 이자비용).
   */
  const [histAccount, setHistAccount] = useState('');
  const [acctPickerOpen, setAcctPickerOpen] = useState(false);
  const [acctQuery, setAcctQuery] = useState('');
  const [histSearch, setHistSearch] = useState('');
  /** 거래처 필터 — 이 거래처 전표만. 빈 값이면 안 거른다. */
  const [histPartner, setHistPartner] = useState('');
  const [partnerPickerOpen, setPartnerPickerOpen] = useState(false);
  const [partnerQuery, setPartnerQuery] = useState('');
  /**
   * 계정 고르는 층 — 손익 > 이익·비용 > 계정,  재무 > 자산·부채·자본 > 계정.
   * '…전체'로 한 층을 통째로 고르는 항목은 뒀더니 무엇으로 걸렀는지 안 읽혔다.
   * 층을 눌러 좁히고, 마지막에 계정 하나를 고른다.
   */
  const [acctAxis, setAcctAxis] = useState<'' | '손익' | '재무'>('');
  const [acctBranch, setAcctBranch] = useState('');
  const groupOfCode = useCallback(
    (code?: string) => accountGroups.find(x => x.id === accountCodes.find(c => c.code === code)?.groupId),
    [accountCodes, accountGroups]);
  /** 손익 계정인가 — 그룹의 plLine이 먼저고, 없으면 계정 5분류로 폴백한다 */
  const isPlCode = useCallback((code?: string) => {
    const g = groupOfCode(code);
    if (g?.plLine) return true;
    const t = codeType.get(code ?? '');
    return t === '수익' || t === '비용';
  }, [groupOfCode, codeType]);
  /** 재무 계정인가 */
  const bsTypeOf = useCallback((code?: string) => {
    const t = codeType.get(code ?? '');
    return t === '자산' || t === '부채' || t === '자본' ? t : null;
  }, [codeType]);
  /** 계정 하나가 손익인가 재무인가 — 드롭다운 묶음의 근거 */
  const axisOfCode = useCallback((code?: string): '손익' | '재무' | null => {
    if (isPlCode(code)) return '손익';
    return bsTypeOf(code) ? '재무' : null;
  }, [isPlCode, bsTypeOf]);
  /**
   * 고를 수 있는 계정 자리 전부 — 크게 · 그룹 · 계정과목을 한 목록으로 편다.
   * 목록을 손으로 안 적는다. 계정·그룹을 만들면 저절로 늘어난다.
   */
  /** 손익 계정의 갈래 — 수익이면 '이익', 비용이면 '비용'. 둘 다 아니면 손익이 아니다. */
  const plBranchOf = useCallback((code?: string): '이익' | '비용' | null => {
    const t = codeType.get(code ?? '');
    return t === '수익' ? '이익' : t === '비용' ? '비용' : null;
  }, [codeType]);
  /**
   * 고를 수 있는 **계정과목**들 — 층('…전체')은 목록에 안 넣는다.
   * 목록을 손으로 안 적는다. 계정·그룹을 만들면 저절로 늘어난다.
   */
  const accountItems = useMemo(() => {
    const codes = [...accountCodes].sort((a, b) =>
      String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
    const out: { value: string; label: string; path: string; axis: '손익' | '재무'; branch: string }[] = [];
    for (const c of codes) {
      const pl = plBranchOf(c.code);
      if (pl) {
        const g = groupOfCode(c.code);
        out.push({ value: `code:${c.code}`, label: `${c.code} ${c.name}`, axis: '손익', branch: pl,
          path: `손익 › ${pl}${g ? ` › ${g.name}` : ''}` });
        continue;
      }
      const bs = bsTypeOf(c.code);
      if (bs) out.push({ value: `code:${c.code}`, label: `${c.code} ${c.name}`, axis: '재무', branch: bs, path: `재무 › ${bs}` });
    }
    return out;
  }, [accountCodes, groupOfCode, plBranchOf, bsTypeOf]);
  const acctPicked = useMemo(
    () => accountItems.find(i => i.value === histAccount),
    [accountItems, histAccount]);
  /** 이름·코드·경로 아무거나로 찾는다 — 찾는 사람은 대개 계정 이름을 안다 */
  const acctShown = useMemo(() => {
    const q = acctQuery.trim().toLowerCase();
    //  검색은 층을 무시하고 전부 뒤진다 — 이름을 아는 계정은 두 번 안 눌러도 나와야 한다.
    if (q) return accountItems.filter(i => matchesSearch(i.label, q) || matchesSearch(i.path, q));
    if (!acctAxis || !acctBranch) return [];
    return accountItems.filter(i => i.axis === acctAxis && i.branch === acctBranch);
  }, [accountItems, acctQuery, acctAxis, acctBranch]);
  /** 고른 자리에 이 계정이 걸리는가 */
  const acctHit = useCallback((c?: string): boolean => {
    if (!histAccount) return true;
    const [kind, val] = histAccount.split(':');
    if (kind === 'axis') return axisOfCode(c) === val;      // 옛 저장값 호환
    if (kind === 'group') return groupOfCode(c)?.id === val;
    if (kind === 'pl') return plBranchOf(c) === val;
    if (kind === 'type') return bsTypeOf(c) === val;
    return String(c) === val;
  }, [histAccount, axisOfCode, groupOfCode, bsTypeOf, plBranchOf]);
  const matchAccount = useCallback(
    (codes: string[]) => !histAccount || codes.some(acctHit),
    [histAccount, acctHit]);
  /**
   * 그 전표가 건드리는 계정 전부 — 복합 전표라도 하나만 걸리면 잡힌다.
   *
   * 전표(거래명세서)는 품목 줄에 **손익 계정만** 있다. 상대변(외상매출금·외상매입금·부가세)은
   * 저장돼 있지 않고 분개할 때 생긴다. 그대로 두면 '재무'로 걸러도 매출·매입 전표가
   * 하나도 안 잡혀서, 재무 필터가 사실상 자금전표만 고르는 꼴이 됐다(자금흐름과 똑같아졌다).
   * 그래서 분개가 세우는 상대계정을 여기서 같이 넣는다 — journalizeStatement와 같은 규칙.
   */
  const rowCodes = useCallback((row: TimelineRow): string[] => {
    if (row.kind === 'stmt') {
      const items = (row.data.items ?? []).map(i => i.accountCode ?? '').filter(Boolean);
      if (row.data.type === '비용') return items;          // 대체전표는 차·대가 줄에 다 있다
      // 채권·채무만 넣는다. 부가세(255 예수금·135 대급금)는 **일부러 뺀다** —
      // 회계로는 매출전표가 부채(255)를, 매입전표가 자산(135)을 건드리는 게 맞지만,
      // 그걸 넣으면 과세 전표가 죄다 자산·부채에 걸려 필터가 무용지물이 된다.
      // 부가세는 신고 때 부가세 화면에서 본다.
      return [...items, row.data.type === '매출' ? AR : AP];
    }
    if (row.kind === 'pay') return [row.stmtType === '매출' ? AR : AP];
    const ls = (row.entry.lines ?? []).map(l => l.accountCode).filter(Boolean) as string[];
    return ls.length ? ls : (row.accountCode ? [row.accountCode] : []);
  }, []);
  const [histQuick, setHistQuick] = useState<'당일'|'금주'|'당월'|'당년'|'ALL'|''>('당일');
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
          tradeDate: s.tradeDate ?? '',
          issuedAt: s.issuedAt ?? '',
        })));
        fetchedRangeRef.current = { from, to };
      })
      .finally(() => setIsFetchingHistory(false));
  }, [histFrom, histTo, sevenDaysAgoCutoff]);

  // 방금 지운 전표 — extraStatements는 한 번 떠온 스냅샷이라 삭제가 안 비친다.
  // 지운 id를 여기 담아 두고 합칠 때 걸러 낸다(다시 떠와도 안 되살아난다).
  const [deletedStmtIds, setDeletedStmtIds] = useState<Set<string>>(new Set());
  /** 전표 삭제 — 서버에 지우고 화면에서도 즉시 뺀다.
   *  붙어 있던 매칭(settlement)도 같이 지운다. 안 지우면 없는 전표를 가리킨 채 남아
   *  그 거래처 잔액이 갚은 것으로 계속 깎인다. */
  const deleteStatement = (id: string) => {
    settlements.filter(s => s.statementId === id).forEach(s => onDeleteSettlement?.(s.id));
    onDeleteIssuedStatement?.(id);
    setDeletedStmtIds(prev => new Set(prev).add(id));
    setExtraStatements(prev => prev.filter(s => s.id !== id));
  };

  // props(전체 구독) + 온디맨드 fetch 데이터 합치기 (id 기준 dedup, props 우선)
  //
  // **회사로 한 번 더 거른다.** props는 이미 걸러져 오지만 extraStatements는 이 화면이
  // 직접 떠온 것이라 안 걸러져 있다 — 그래서 풍회로 바꿔도 태백 전표가 다 보였다.
  const mergedStatements = useMemo(() => {
    const map = new Map<string, IssuedStatement>();
    extraStatements.forEach(s => map.set(s.id, s));
    issuedStatements.forEach(s => map.set(s.id, s));
    for (const id of deletedStmtIds) map.delete(id);
    return Array.from(map.values()).filter(s => (s.companyId ?? 'taebaek') === companyId);
  }, [issuedStatements, extraStatements, deletedStmtIds, companyId]);

  /**
   * **전표가 실제로 걸린 주문 id** — `invoicePrinted` 플래그가 아니라 전표를 근거로 본다.
   *
   * 플래그는 전표를 만들 때 세우는데, 전표를 지우거나 발행이 중간에 엎어져도 그대로 남는다.
   * 그러면 전표가 없는데도 목록에서 숨어 영영 안 보인다(2026-08 기준 3건이 그 상태였다:
   * 일성상회 08-18 · 세화식품 08-13 · 글로벌유통 08-05).
   *
   * 뱃지(5300줄 근처)는 진작 전표를 같이 보고 있었는데 **목록 필터만 플래그를 봐서**,
   * "미발행이라고 찍히는데 목록엔 안 뜨는" 상태였다. 둘을 하나로 맞춘다.
   *
   * 한 전표가 여러 주문을 묶기도 해서 콤마·공백으로 갈라 담는다.
   */
  const voucherOrderIds = useMemo(() => {
    const set = new Set<string>();
    for (const st of mergedStatements)
      for (const v of String(st.orderId ?? '').split(/[,\s]+/)) if (v) set.add(v);
    return set;
  }, [mergedStatements]);

  /** 전표까지 실제로 있는가 — 플래그만으로는 발행완료로 안 친다. */
  const isVouchered = useCallback(
    (o: { id: string; invoicePrinted?: boolean }) => !!o.invoicePrinted && voucherOrderIds.has(o.id),
    [voucherOrderIds],
  );

  /**
   * 거래처별 잔액 — 전표 총액에서 그 거래처로 오간 채권·채무(108/251) 자금을 뺀다.
   * **전표에 안 붙인다.** 받은 돈이 어느 청구서를 갚았는지 따지지 않고 "이 거래처에 얼마 남았나"만 본다.
   * 분개(108·251 잔액)와 같은 규칙이라 전표화면·거래처통계·재무제표가 저절로 같은 숫자를 낸다.
   * 마이너스면 더 받은 것 = 선수금.
   */

  // 잔액은 **분개의 108·251**에서 센다 — 전표 갈래(type)로 세면 갈래를 바꿀 때 잔액이 사라진다.
  // 기초잔액은 거래처가 없으니 안 넘겨도 결과가 같다.
  const partnerJournals = useMemo(
    () => buildJournals({ statements: mergedStatements, cashEntries, accounts: accountCodes }).entries,
    [mergedStatements, cashEntries, accountCodes]);
  /** 전표 id → 그 전표의 분개. 몫을 셀 때 쓴다. */
  const journalBySource = useMemo(() => {
    const m = new Map<string, JournalEntry>();
    for (const je of partnerJournals) if (je.sourceId) m.set(je.sourceId, je);
    return m;
  }, [partnerJournals]);
  /**
   * 계정으로 걸렀을 때 **그 계정 몫**이 얼마인가 — 분개에서 센다.
   *
   * 대출상환은 통장에서 3,064,357이 나가지만 손익에 잡히는 건 이자 294,357뿐이다.
   * 나머지 2,770,000은 차입금(재무)이다. 전액을 띄우면 손익과 안 맞아 보인다.
   *
   * **분개에서 세는 이유**: 전표 품목만 더하면 부가세가 섞인다. 매출전표 1,070,000 중
   * 손익(800 일반매출)은 공급가 1,000,000이고 70,000은 부가세예수금(부채)이다.
   * 손익 화면과 같은 근거를 써야 숫자가 저절로 맞는다.
   */
  const accountPortion = useCallback((row: TimelineRow): number | null => {
    if (!histAccount) return null;
    const srcId = row.kind === 'stmt' ? row.data.id : row.entry?.id;
    const je = srcId ? journalBySource.get(srcId) : undefined;
    if (!je) return null;
    return (je.lines ?? [])
      .filter(l => acctHit(String(l.accountCode)))
      .reduce((a, l) => a + Math.abs((l.debit ?? 0) - (l.credit ?? 0)), 0);
  }, [histAccount, journalBySource, acctHit]);
  const partnerBalances = useMemo(() => {
    const map = new Map<string, { receivable: number; payable: number }>();
    for (const id of new Set(mergedStatements.map(s => s.partnerId).filter(Boolean))) {
      map.set(id, {
        receivable: partnerBalanceFromJournals(id, '매출', partnerJournals),
        payable: partnerBalanceFromJournals(id, '매입', partnerJournals),
      });
    }
    return map;
  }, [mergedStatements, partnerJournals]);

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
  // 발생(거래처 없음) = 대체전표 — 감가상각비·감가상각누계액처럼 차·대를 직접 세우는 계정들
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
        side: (i as { side?: '차변' | '대변' }).side,
      })),
      //  빈 줄은 안 붙인다 — 양변 전표에 빈 줄이 끼면 차·대가 안 맞아 분개가 안 선다.
    ]);
    setEditablePrices({});
    setTaxExemptOverrides({});
    setClientSearch('');
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
  /**
   * 거래처 미선택 화면의 목록 — **진행 주문 + 전표 안 걸린 배송완료 주문.**
   *
   * 예전엔 ACTIVE_STATUSES(대기·작업·출고)만 담아서, 배송완료(DELIVERED)로 넘어간 주문은
   * 전표를 안 끊었어도 여기 영영 안 떴다. 거래처를 콕 집어 골라야만 보였다.
   * 배송이 끝났다고 전표가 선 건 아니다 — 오히려 그쪽이 놓치면 아픈 건이다.
   *
   * 전표가 걸린 배송완료 주문은 계속 뺀다(발행내역에서 본다).
   */
  const activeOrders = useMemo(() =>
    orders
      .filter(o => o.partnerName !== '생산기록')
      .filter(o => ACTIVE_STATUSES.has(o.status as OrderStatus) || !isVouchered(o))
      .sort((a, b) => {
        const aP = isVouchered(a), bP = isVouchered(b);
        if (aP !== bP) return aP ? 1 : -1;
        return new Date(a.deliveryDate || a.createdAt).getTime() - new Date(b.deliveryDate || b.createdAt).getTime();
      }),
    [orders, isVouchered]
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
      // 진행주문 = 미발행(배송완료·예전주문이어도 전표가 안 걸렸으면 표시) + 진행중 상태.
      // 발행완료는 발행내역에서 본다. **판정은 전표 실물** — 플래그만 남고 전표가 없는 건 여기 떠야 한다.
      list = list.filter(o => !isVouchered(o) || ACTIVE_STATUSES.has(o.status as OrderStatus));
      list = [...list].sort((a, b) => {
        const aP = isVouchered(a), bP = isVouchered(b);
        if (aP !== bP) return aP ? 1 : -1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }
    // 미발행(진행) 전표는 날짜 무관하게 다 보인다 (배송완료·예전주문이어도). 날짜필터는 발행완료 건에만.
    if (dateFrom) list = list.filter(o => !isVouchered(o) || (o.createdAt || '').slice(0, 10) >= dateFrom);
    if (dateTo)   list = list.filter(o => !isVouchered(o) || (o.createdAt || '').slice(0, 10) <= dateTo);
    return list;
  }, [orders, selectedClientId, onlyActive, dateFrom, dateTo, isVouchered]);

  const selectedOrder  = partnerOrders.find(o => o.id === selectedOrderId);
  const selectedClient = partners.find(c => c.id === selectedClientId);

  // ── 품목 행 계산 ──
  type LineItem = {
    key: string; no: number; name: string; spec: string;
    qty: number; price: number; supply: number; tax: number; total: number;
    isTaxExempt: boolean; isBoxUnit?: boolean; boxSize?: number; accountCode?: string;
    /** 차·대를 직접 세운 줄 — 있으면 양변 전표(일반전표)다. 합계는 차변 합만 센다. */
    side?: '차변' | '대변';
    /** 주문의 품목을 못 찾음 — 박스가 안 풀렸을 수 있어 화면에 경고를 단다 */
    unknownItem?: boolean;
  };

  const lineItems = useMemo((): LineItem[] => {
    if (manualMode) {
      return manualItems
        .filter(i => i.name.trim())
        .map((item, idx) => {
          const qty = parseFloat(item.qty) || 0;
          const price = parseFloat(item.price) || 0;
          /**
           * 단가는 부가세 포함 → 공급가액 역산 (주문 기반 경로 및 품목행 표시와 동일 규칙).
           * **원 단위로 반올림한다** — 수량이 소수인 줄(0.277kg 같은 것)이 끼면 공급가·세액에
           * 소수점이 남아 합계가 1원씩 어긋나고, 전표에 '1,234.56원'이 찍힌다.
           */
          const gross = Math.round(qty * price);
          const supply = item.isTaxExempt ? gross : Math.round(gross / 1.1);
          const tax = item.isTaxExempt ? 0 : gross - supply;
          return { key: `manual-${idx}`, no: idx + 1, name: item.name, spec: item.spec, qty, price, supply, tax, total: supply + tax, isTaxExempt: item.isTaxExempt, isBoxUnit: item.isBoxUnit, boxSize: item.boxSize, side: item.side, accountCode: item.accountCode || (stmtType === '매출' ? '800' : undefined) };
        });
    }
    if (!selectedOrder) return [];
    const itemMap: Record<string, LineItem> = {};
    let no = 1;
    selectedOrder.items.forEach(item => {
      // 품목이 지워졌거나 id가 바뀌면 못 찾는다 → 박스가 안 풀리고 박스 수량 그대로 들어간다.
      // 이름으로 한 번 더 찾아보고, 그래도 없으면 아래에서 경고 표시를 단다(조용히 넘기지 않는다).
      let product = allItems.find(p => p.id === item.itemId)
        ?? (item.name ? allItems.find(p => !p.archived && p.name === item.name) : undefined);
      const unknownItem = !product;
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
      //  금액은 원 단위로 반올림한다 — 소수 수량이 끼면 합계가 1원씩 어긋난다.
      if (isTaxExempt) {
        displayPrice = unitPrice;
        supply = Math.round(unitPrice * qtyUnits);
        tax = 0;
      } else {
        // 부가세 포함 단가 → 공급가액 = round(단가/1.1)*수량
        displayPrice = Math.round(unitPrice / 1.1);
        supply = Math.round(displayPrice * qtyUnits);
        tax = Math.round(unitPrice * qtyUnits) - supply;
      }
      if (itemMap[key]) {
        itemMap[key].qty += qtyUnits;
        itemMap[key].supply += supply;
        itemMap[key].tax += tax;
        itemMap[key].total += supply + tax;
      } else {
        // 우선순위: 이번에 고른 값 > 전에 끊었던 계정(pcEntry) > 매출이면 800 기본. 빈값('')도 800으로.
        const acCode = accountCodeOverrides[key] || pcEntry?.Account_Code || (stmtType === '매출' ? '800' : undefined);
        itemMap[key] = { key, no: no++, name: displayName, spec, qty: qtyUnits, price: unitPrice, supply, tax, total: supply + tax, isTaxExempt, accountCode: acCode, ...(unknownItem ? { unknownItem: true } : {}) };
      }
    });
    return Object.values(itemMap);
  }, [manualMode, manualItems, selectedOrder, allItems, partnerOut, partnerIn, selectedClientId, editablePrices, taxExemptOverrides, accountCodeOverrides, stmtType]);

  /**
   * 양변 전표(일반전표)인가 — 줄마다 차·대를 직접 세운 것.
   *
   * 이런 전표는 **차변 합만이 전표 금액**이다. 품목표처럼 전 줄을 더하면 차·대가 겹쳐
   * 두 배가 된다 — 거산농산 기초이월 1,230,000이 2,460,000으로 떴다.
   */
  const isTwoSided = lineItems.some(r => r.side === '차변' || r.side === '대변');
  const sumOf = (pick: (r: typeof lineItems[number]) => number) =>
    isTwoSided
      ? lineItems.filter(r => r.side === '차변').reduce((s, r) => s + pick(r), 0)
      : lineItems.reduce((s, r) => s + pick(r), 0);
  const totalSupply = sumOf(r => r.supply);
  const totalTax    = sumOf(r => r.tax);
  const totalAmount = totalSupply + totalTax;

  const tradeDateObj = new Date(tradeDate + 'T00:00:00');
  const dateStr = `${tradeDateObj.getFullYear()}년 ${tradeDateObj.getMonth() + 1}월 ${tradeDateObj.getDate()}일`;
  const docNo   = nextDocNo(tradeDate, issuedStatements);

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
      // 시각은 전표 날짜에 맞춰 잡는다 — 소급이면 그날 맨 뒤, 미리 끊으면 맨 앞.
      issuedAt: stampFor(tradeDate),
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
        ...(i.side ? { side: i.side } : {}),   // 양변 전표 — 없으면 분개가 안 선다
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
          //  전표에 찍힌 과세/면세를 거래처 단가와 **같이** 저장한다 — 예전엔 옛 값을 그대로
        //  물려주기만 해서, 전표에서 면세로 끊어도 거래처엔 과세로 남아 다음 전표가 또 과세로 열렸다.
        onUpsertPartnerItem({ ...(pc ?? {}), id: pcId, itemId: product.id, partnerId: selectedClientId, Direction: 'out' as const, price: item.price, taxType: item.isTaxExempt ? '면세' : '과세', Account_Code: item.accountCode || pc?.Account_Code });
        }
      }
    }
    // (원본 주문 자동반영 기능 제거됨 — 전표 편집은 원본 주문을 건드리지 않는다.
    //  박스→낱개 변환 때문에 낱개가 주문에 이중으로 붙는 문제도 함께 방지.)
    // 매입전표 발행 시 원가/계정 자동 저장 (partner_item canonical price = 원가, items.cost 동기화)
    // 가드 없이 항상 동기화 — 구독(partnerIn) 지연으로 직전 저장값과 비교가 빗나가 누락되는 문제 방지
    if (stmtType === '매입' && onUpsertPartnerItem) {
      for (const item of lineItems) {
        if (!item.price || item.price <= 0) continue;
        const product = allItems.find(p => p.name === item.name || p.품목 === item.name);
        if (!product || !selectedClientId) continue;
        const existing = partnerIn.find(s => (s.itemId) === product.id && (s.partnerId) === selectedClientId);
        const psId = existing?.id ?? `${product.id}_${selectedClientId}_in`;
        //  전표에 찍힌 과세/면세를 거래처 단가와 **같이** 저장한다 — 예전엔 옛 값을 그대로
        //  물려주기만 해서, 전표에서 면세로 끊어도 거래처엔 과세로 남아 다음 전표가 또 과세로 열렸다.
        onUpsertPartnerItem({ ...(existing ?? {}), id: psId, itemId: product.id, partnerId: selectedClientId, Direction: 'in' as const, price: item.price, taxType: item.isTaxExempt ? '면세' : '과세', Account_Code: item.accountCode || existing?.Account_Code });
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
        ...(i.side ? { side: i.side } : {}),   // 양변 전표 — 없으면 분개가 안 선다
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
        //  전표에 찍힌 과세/면세를 거래처 단가와 **같이** 저장한다 — 예전엔 옛 값을 그대로
        //  물려주기만 해서, 전표에서 면세로 끊어도 거래처엔 과세로 남아 다음 전표가 또 과세로 열렸다.
        onUpsertPartnerItem({ ...(existing ?? {}), id: psId, itemId: product.id, partnerId: selectedClientId, Direction: 'in' as const, price: item.price, taxType: item.isTaxExempt ? '면세' : '과세', Account_Code: item.accountCode || existing?.Account_Code });
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

    const MAX_ROWS = 11;
    const itemList = items as any[];
    const totalQty = itemList.reduce((s,i)=>s+(Number(i.qty)||0),0);

    const makePage = (borderColor: string, pageLabel: string, stripeColor: string) => {
      const BC = borderColor;
      const SC = stripeColor;
      const LB = '#efefef';

      // ── 헤더 (테두리 바깥) ──
      const headerHtml = `
<div style="display:flex;align-items:flex-end;margin-bottom:0.5mm;">
  <span style="flex:1;font-size:10px;"></span>
  <span style="font-size:22px;font-weight:bold;letter-spacing:6px;color:${BC};">거&nbsp;&nbsp;래&nbsp;&nbsp;명&nbsp;&nbsp;세&nbsp;&nbsp;서</span>
  <span style="flex:1;font-size:10px;text-align:right;">[재발행]</span>
</div>
<div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;margin-bottom:0.5mm;">
  <span>전표일자 : <strong>${dateLabel}</strong></span>
  <span style="color:${BC};font-weight:bold;font-size:12px;">${pageLabel}</span>
  <span>전표NO. : <strong>${docNoStr}</strong></span>
</div>`;

      // ── 회사 정보 ──
      const V = (t:string, extra='') =>
        `<td style="border:1px solid ${BC};padding:1px 4px;font-size:10px;overflow:hidden;white-space:nowrap;${extra}">${t}</td>`;
      const L = (t:string) =>
        `<td style="border:1px solid ${BC};background:${LB};padding:1px 4px;font-size:9.5px;font-weight:bold;white-space:nowrap;text-align:center;">${t}</td>`;

      const infoHtml = `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup>
    <col style="width:6mm;"/><col style="width:18mm;"/><col/>
    <col style="width:6mm;"/><col style="width:18mm;"/><col/>
  </colgroup>
  <tbody>
    <tr style="height:5.5mm;">
      <td rowspan="5" style="border:1px solid ${BC};background:${LB};text-align:center;vertical-align:middle;writing-mode:vertical-rl;letter-spacing:3px;font-size:10px;font-weight:bold;color:${BC};">공급받는자</td>
      ${L('상&nbsp;&nbsp;호')}${V(buyName,'font-weight:bold;font-size:11px;')}
      <td rowspan="5" style="border:1px solid ${BC};background:${LB};text-align:center;vertical-align:middle;writing-mode:vertical-rl;letter-spacing:3px;font-size:10px;font-weight:bold;color:${BC};">공급자</td>
      ${L('상&nbsp;&nbsp;호')}${V(supName,'font-weight:bold;font-size:11px;')}
    </tr>
    <tr style="height:5mm;">
      ${L('대&nbsp;&nbsp;표')}${V(buyCeo,'font-weight:bold;')}
      ${L('대&nbsp;&nbsp;표')}${V(supCeo,'font-weight:bold;')}
    </tr>
    <tr style="height:5mm;">
      ${L('사업자번호')}${V(buyBizNo)}
      ${L('사업자번호')}${V(supBizNo)}
    </tr>
    <tr style="height:5mm;">
      ${L('주&nbsp;&nbsp;소')}${V(buyAddr,'font-size:9.5px;')}
      ${L('주&nbsp;&nbsp;소')}${V(supAddr,'font-size:9.5px;')}
    </tr>
    <tr style="height:5mm;">
      ${L('전화번호')}${V((buyPhone?buyPhone:'')+(buyFax?'&nbsp;&nbsp;FAX:'+buyFax:''),'font-size:9.5px;')}
      ${L('전화번호')}${V(supPhone+(supFax?'&nbsp;&nbsp;FAX:'+supFax:''),'font-size:9.5px;')}
    </tr>
  </tbody>
</table>`;

      // ── 품목 테이블 ──
      const TH = (t:string) =>
        `<th style="border:1px solid ${BC};background:${SC};padding:2px 2px;font-size:10px;text-align:center;font-weight:bold;">${t}</th>`;

      const iRows = itemList.map((item:any, idx:number) => {
        const bg = idx%2===0 ? '#ffffff' : SC;
        return `<tr style="height:5.5mm;background:${bg};">
          <td style="border:1px solid ${BC};text-align:center;font-size:10px;padding:0 1px;">${idx+1}</td>
          <td style="border:1px solid ${BC};font-size:11px;font-weight:bold;padding:0 3px;overflow:hidden;white-space:nowrap;">${item.name||''}</td>
          <td style="border:1px solid ${BC};text-align:center;font-size:9.5px;padding:0 2px;">${item.spec||''}</td>
          <td style="border:1px solid ${BC};text-align:center;font-size:10px;padding:0 2px;">${(item as any).unit||'개'}</td>
          <td style="border:1px solid ${BC};text-align:right;font-size:10.5px;padding:0 3px;">${(item as any).isBoxUnit ? `${item.qty}BOX(${item.qty*12}개)` : fmt(item.qty)}</td>
          <td style="border:1px solid ${BC};text-align:right;font-size:10.5px;padding:0 3px;">${fmt(item.price)}</td>
          <td style="border:1px solid ${BC};text-align:right;font-size:10.5px;padding:0 3px;">${fmt(item.total)}</td>
        </tr>`;
      }).join('');

      // **** 이하여백 **** — 마지막 아이템 바로 다음
      const blankBg0 = itemList.length%2===0 ? '#ffffff' : SC;
      const blankRow = `<tr style="height:5.5mm;background:${blankBg0};">
        <td style="border:1px solid ${BC};text-align:center;font-size:10px;padding:0;"></td>
        <td colspan="6" style="border:1px solid ${BC};font-size:10px;padding:0 3px;color:${BC};">*&nbsp;*&nbsp;*&nbsp;*&nbsp;&nbsp;이&nbsp;하&nbsp;여&nbsp;백&nbsp;&nbsp;*&nbsp;*&nbsp;*&nbsp;*</td>
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

      // ── 합계 (합계 1행) ──
      const totalsHtml = `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup>
    <col style="width:14mm;"/><col style="width:12mm;"/>
    <col style="width:14mm;"/><col style="width:14mm;"/>
    <col style="width:18mm;"/><col style="width:14mm;"/>
    <col style="width:18mm;"/><col style="width:12mm;"/><col/>
  </colgroup>
  <tr style="height:6mm;background:${SC};">
    <td style="border:1px solid ${BC};text-align:center;font-size:9.5px;font-weight:bold;">합&nbsp;&nbsp;&nbsp;계</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:9.5px;">수량</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:11px;font-weight:bold;padding:0 3px;">${fmt(totalQty)}</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:9.5px;">공급가</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:11px;font-weight:bold;padding:0 3px;">${fmt(sup)}</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:9.5px;">부가세</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:11px;font-weight:bold;padding:0 3px;">${fmt(tax)}</td>
    <td style="border:1px solid ${BC};text-align:center;font-size:9.5px;">합계</td>
    <td style="border:1px solid ${BC};text-align:right;font-size:11px;font-weight:bold;padding:0 3px;">${fmt(amt)}</td>
  </tr>
</table>`;

      // ── 하단: (좌) 미수금 표 + 비고 / (우) 인수확인 ──
      const now = new Date();
      const h = now.getHours(); const mn = now.getMinutes(); const sc2 = now.getSeconds();
      const ampm = h<12?'오전':'오후'; const hh = h%12||12;

      const bottomHtml = `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup><col/><col style="width:28mm;"/></colgroup>
  <tr>
    <td style="border:1px solid ${BC};padding:0;vertical-align:top;">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <colgroup><col style="width:22mm;"/><col/></colgroup>
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:9.5px;padding:1.5px 4px;white-space:nowrap;">전일미수</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:9.5px;padding:1.5px 5px;">0</td></tr>
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:9.5px;padding:1.5px 4px;">금일판매</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:9.5px;padding:1.5px 5px;">${fmt(amt)}</td></tr>
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:9.5px;padding:1.5px 4px;">금일입금</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:9.5px;padding:1.5px 5px;">0</td></tr>
        <tr><td style="border-bottom:1px solid ${BC};border-right:1px solid ${BC};font-size:9.5px;font-weight:bold;padding:1.5px 4px;">금일미수</td>
            <td style="border-bottom:1px solid ${BC};text-align:right;font-size:11px;font-weight:bold;padding:1.5px 5px;">${fmt(amt)}</td></tr>
        <tr><td colspan="2" style="font-size:9.5px;font-weight:bold;padding:2px 4px;height:10mm;vertical-align:top;">비&nbsp;고</td></tr>
      </table>
    </td>
    <td style="border:1px solid ${BC};text-align:center;vertical-align:middle;font-size:11px;font-weight:bold;letter-spacing:3px;">인<br/>수<br/>확<br/>인</td>
  </tr>
</table>
<div style="display:flex;justify-content:space-between;font-size:9px;margin-top:0.5mm;color:#555;padding:0 1mm;">
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
<div style="width:210mm;height:297mm;overflow:hidden;box-sizing:border-box;padding:5mm 6mm;display:flex;flex-direction:column;font-family:'맑은 고딕',sans-serif;">
  <div style="flex:1 1 0;min-height:0;display:flex;flex-direction:column;justify-content:center;">
    ${makePage('#cc0000','(공급자용)','#f5d8b0')}
  </div>
  <div style="flex:0 0 auto;display:flex;align-items:center;gap:2mm;padding:1mm 0;color:#666;">
    <span style="flex:1;border-top:1.2px dashed #999;"></span>
    <span style="font-size:8px;white-space:nowrap;letter-spacing:2px;">✂&nbsp;&nbsp;절&nbsp;취&nbsp;선</span>
    <span style="flex:1;border-top:1.2px dashed #999;"></span>
  </div>
  <div style="flex:1 1 0;min-height:0;display:flex;flex-direction:column;justify-content:center;">
    ${makePage('#0044cc','(공급받는자용)','#c4d4f0')}
  </div>
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
  // 저장은 비동기다 — 성공/실패를 화면에 표시하지 않으면 "눌러도 아무 일도 안 난다"로 보인다.
  const savePcPrice = async (pc: PartnerItem) => {
    const raw = (pricePanelEdits[pc.id] ?? (pc.price !== undefined ? String(pc.price) : '')).trim();
    const val = Number(raw.replace(/[,\s원]/g, ''));   // "12,000" · "12000원" 도 허용
    if (!raw || !Number.isFinite(val) || val < 0) { alert('단가를 숫자로 입력하세요.'); return; }
    setPriceSaveState(s => ({ ...s, [pc.id]: 'saving' }));
    try {
      await onUpsertPartnerItem?.({ ...pc, Direction: pc.Direction ?? (createMode === '매입' ? 'in' : 'out'), price: val });
      setPricePanelEdits(prev => ({ ...prev, [pc.id]: String(val) }));
      setPriceSaveState(s => ({ ...s, [pc.id]: 'done' }));
      setTimeout(() => setPriceSaveState(s => { const n = { ...s }; if (n[pc.id] === 'done') delete n[pc.id]; return n; }), 1500);
    } catch (e: any) {
      setPriceSaveState(s => ({ ...s, [pc.id]: 'error' }));
      alert('단가 저장 실패: ' + (e?.message ?? String(e)));
    }
  };

  // 과세/면세 토글도 같은 경로 — 실패 시 조용히 넘어가지 않는다.
  const togglePcTax = async (pc: PartnerItem) => {
    setPriceSaveState(s => ({ ...s, [pc.id]: 'saving' }));
    try {
      await onUpsertPartnerItem?.({ ...pc, Direction: pc.Direction ?? (createMode === '매입' ? 'in' : 'out'), taxType: pc.taxType === '면세' ? '과세' : '면세' });
      setPriceSaveState(s => { const n = { ...s }; delete n[pc.id]; return n; });
    } catch (e: any) {
      setPriceSaveState(s => ({ ...s, [pc.id]: 'error' }));
      alert('과세구분 저장 실패: ' + (e?.message ?? String(e)));
    }
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
                   /** 상계 — 받을 것과 줄 것을 맞바꾼 것. 미수·미지급 양쪽에 한 줄씩 선다. */
                   offset?: boolean;
                   date: string; amount: number; method?: string; note?: string;
                   paymentId: string; cumul: number; dateKey: string; ts: string; src: IssuedStatement;
                   /** 이 수금·지불의 자금원장 원본 */
                   entry?: CashEntry };
  // 자금 입출금 전표 — 전표에 상계되지 않은 순수 현금 이동(전기요금·급여·상환·기계구입 등)
  type CashRow = { kind: 'cash'; entry: CashEntry; dir: '입금'|'출금'; amount: number;
                   accountCode?: string; note?: string; partnerName?: string;
                   /** 그 시점 이 거래처의 채권·채무 잔액. 거래처가 없거나 잔액 자취가 없으면 undefined */
                   cumul?: number;
                   date: string; ts: string; dateKey: string };
  type TimelineRow = StmtRow | PayRow | CashRow;

  // 화면 표시값 기준 정렬용 시각 (로컬 HH:MM:SS) — 규칙은 voucherStamp 한 곳에 둔다
  const timeOf = timeOfLocal;

  /**
   * 이 전표가 그 거래처의 **채권이냐 채무냐**, 그리고 얼마를 움직이나 — 분개에서 센다.
   *
   * 전표 갈래(type)로 가르면 안 된다. 기초 미수는 갈래가 '비용'(대체)이라
   * 같은 거래처인데도 매출과 다른 묶음이 됐고, 그래서 두 가지가 한꺼번에 어긋났다.
   *
   *   · 같은 수금 자금전표를 **두 묶음이 각자 끌어가** 한 줄이 두 줄로 보였다.
   *     (유)에스제이엠 8/18 수금 2,094,950이 '수금'과 '지불'로 나란히 떴다 —
   *     분개는 둘 다 (차)103 /(대)108인데 딱지만 달랐다.
   *   · 누적잔액도 갈렸다. 매출 묶음은 기초 미수를 안 더한 채 수금만 빼서
   *     2,376,880이어야 할 잔액을 281,930으로 보였다.
   *
   * 채권·채무는 **계정(108·251)이 정하는 것**이지 전표 갈래가 정하는 게 아니다.
   */
  const arapOf = useCallback((s: IssuedStatement): { side: '채권' | '채무' | null; delta: number } => {
    let ar = 0, ap = 0;
    for (const l of journalBySource.get(s.id)?.lines ?? []) {
      const c = String(l.accountCode);
      if (c === AR) ar += (l.debit ?? 0) - (l.credit ?? 0);        // 채권은 차변이 느는 것
      else if (c === AP) ap += (l.credit ?? 0) - (l.debit ?? 0);   // 채무는 대변이 느는 것
    }
    if (ar !== 0 && Math.abs(ar) >= Math.abs(ap)) return { side: '채권', delta: ar };
    if (ap !== 0) return { side: '채무', delta: ap };
    return { side: null, delta: 0 };   // 감가상각처럼 거래처 빚이 없는 대체
  }, [journalBySource]);

  const allTimelineRows = useMemo((): TimelineRow[] => {
    const rows: TimelineRow[] = [];
    const grouped = new Map<string, IssuedStatement[]>();
    const arap = new Map<string, { side: '채권' | '채무' | null; delta: number }>();
    mergedStatements.forEach(s => {
      const a = arapOf(s);
      arap.set(s.id, a);
      const key = `${s.partnerId}__${a.side ?? '기타'}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(s);
    });
    grouped.forEach((stmts, key) => {
      const side = key.slice(key.indexOf('__') + 2) as '채권' | '채무' | '기타';
      type Ev =
        | { kind: 'stmt'; s: IssuedStatement; date: string; ts: string }
        | { kind: 'pay';  date: string; ts: string; amount: number; method?: string; note?: string; paymentId: string; src: IssuedStatement; entry?: CashEntry };
      const evs: Ev[] = [];
      stmts.forEach(s => {
        evs.push({ kind: 'stmt', s, date: s.tradeDate, ts: `${s.tradeDate}T${timeOf(s.issuedAt)}` });
      });
      // 수금/지불 — 전표에 붙이지 않는다. 그 거래처로 오간 채권·채무(108/251) 자금을 그대로 뺀다.
      //  "어느 청구서를 갚았나"를 안 따지므로 매칭이 어긋날 자리가 없다. 분개(108·251 잔액)와 같은 방식.
      const pid = stmts[0]?.partnerId;
      if (pid && side !== '기타') for (const e of cashEntries) {
        if (e.partnerId !== pid) continue;
        const want = side === '채무' ? AP : AR;
        /*
         * 얼마를 갚았나는 **partnerCashParts 한 곳**에서 센다(자금원장·거래처잔액과 같은 함수).
         * 여기서 따로 세다가 상계를 통째로 놓쳤다 — 상계는 dir이 '대체'라 방향으로 못 거르고,
         * 줄 하나가 음수다(한중교역 8/19: 251 +9,370,000 / 108 −9,370,000).
         * 그래서 채권 쪽은 음수라 걸러지고 채무 쪽은 방향에서 걸려, 미수·미지급이 나란히
         * 9,370,000씩 안 줄었다. 자금 행으로도 안 떴다(상계분을 뺀 나머지가 0이라).
         */
        const amt = partnerCashParts(e)
          .filter(x => x.code === want)
          .reduce((a, x) => a + x.reduce, 0);
        if (amt <= 0.5) continue;
        evs.push({ kind: 'pay', date: e.date, ts: `${e.date}T${timeOf(e.createdAt)}`,
          amount: amt, method: e.dir === '대체' ? '상계' : '계좌이체', note: e.note, paymentId: e.id, src: stmts[0], entry: e });
      }
      // 실제 발생시각(ts) 오름차순으로 누적잔액 계산. 동시각이면 전표 먼저(매출 가산 후 수금 차감).
      //  그래도 동률이면 **번호순**으로 못 박는다 — 안 그러면 읽어온 순서를 그대로 쓰게 돼
      //  새로고침할 때마다 순서가 달라질 수 있다. 소급 전표는 전부 23:59:59라 자주 부딪힌다.
      const idOf = (e: Ev) => e.kind === 'stmt' ? e.s.id : e.paymentId;
      evs.sort((a, b) => {
        const d = (a.ts ?? '').localeCompare(b.ts ?? '');
        if (d !== 0) return d;
        if (a.kind === 'stmt' && b.kind === 'pay') return -1;
        if (a.kind === 'pay' && b.kind === 'stmt') return 1;
        return issuedMs(idOf(a)) - issuedMs(idOf(b))
          || String(idOf(a)).localeCompare(String(idOf(b)), undefined, { numeric: true });
      });
      let running = 0;
      evs.forEach(e => {
        if (e.kind === 'stmt') {
          // 잔액에 얹는 건 **분개가 세운 채권·채무**다. 매출·매입은 전표 총액과 같고,
          // 기초 이월(대체)도 제자리를 찾는다. 거래처 빚이 없는 대체는 0이라 잔액을 안 흔든다.
          running += arap.get(e.s.id)?.delta ?? e.s.totalAmount;
          rows.push({ kind: 'stmt', data: e.s, cumul: running, dateKey: `${e.date}__${e.ts}`, ts: e.ts });
        } else {
          running -= e.amount;
          rows.push({ kind: 'pay', partnerId: e.src.partnerId, partnerName: e.src.partnerName,
            // 딱지는 묶음이 정한다 — 기초 이월(대체)이 맨 앞에 선 묶음이라도 '수금'은 수금이다
            stmtType: side === '채무' ? '매입' : '매출', offset: e.entry?.dir === '대체',
            date: e.date, amount: e.amount, method: e.method, note: e.note,
            paymentId: e.paymentId, cumul: running, dateKey: `${e.date}__${e.ts}`, ts: e.ts, src: e.src, entry: e.entry });
        }
      });
    });
    /**
     * 거래처별 잔액 자취 — **자금 행에도 누적잔액을 달기 위한 것.**
     *
     * 입금·출금 행은 그 거래처 잔액을 안 보여줬다. 잔액이 안 움직이는 돈(비용·상환)이라도
     * "이 거래처가 지금 얼마 남았나"는 같이 보여야 읽힌다.
     * 위에서 이미 계산한 cumul을 그대로 쓰므로 수금/지불 행과 숫자가 저절로 맞는다.
     */
    const balTrail = new Map<string, { ts: string; cumul: number }[]>();
    for (const r of rows) {
      if (r.kind !== 'stmt' && r.kind !== 'pay') continue;      // 자금 행은 아직 안 만들었다
      const pid = r.kind === 'stmt' ? r.data.partnerId : r.partnerId;
      if (!pid) continue;
      const arr = balTrail.get(pid) ?? [];
      arr.push({ ts: r.ts, cumul: r.cumul });
      balTrail.set(pid, arr);
    }
    for (const arr of balTrail.values()) arr.sort((a, b) => a.ts.localeCompare(b.ts));
    /** 그 시각까지의 마지막 잔액. 그 앞에 아무 것도 없으면 undefined(잔액을 아직 세울 수 없음) */
    const balanceAt = (pid: string | undefined, ts: string): number | undefined => {
      const arr = pid ? balTrail.get(pid) : undefined;
      if (!arr?.length) return undefined;
      let out: number | undefined;
      for (const x of arr) { if (x.ts <= ts) out = x.cumul; else break; }
      return out;
    };

    // ── 자금 입출금 전표 ── 거래처 채권·채무(108/251)로 나간 부분은 이미 수금/지불 행으로 보였다.
    // 나머지(계정이 붙은 비용·차입금·선수금 등)만 자금 행으로 띄운다.
    cashEntries.forEach(e => {
      const parts = (e.lines ?? []).filter(l => l.accountCode && l.amount > 0);
      const arap = e.partnerId
        ? (parts.length
            ? parts.reduce((a, l) => a + (l.accountCode === AR || l.accountCode === AP ? l.amount : 0), 0)
            : (e.accountCode === AR || e.accountCode === AP ? e.amount : 0))
        : 0;
      const rest = e.amount - arap;
      if (rest <= 0.5) return;            // 전액이 거래처 상계분 → 수금/지불 행으로만
      const ts = `${e.date}T${timeOf(e.createdAt)}`;
      rows.push({
        kind: 'cash', entry: e, dir: e.dir === '대체' ? '출금' : e.dir, amount: rest,
        accountCode: e.accountCode, note: e.note, partnerName: e.partnerName,
        cumul: balanceAt(e.partnerId, ts),
        date: e.date, ts, dateKey: `${e.date}`,
      });
    });
    return rows;
  }, [mergedStatements, cashEntries, arapOf]);

  const filteredHistory = useMemo((): TimelineRow[] => {
    return allTimelineRows
      .filter(row => {
        const d = row.kind === 'stmt' ? row.data.tradeDate : row.date;
        const name = (row.kind === 'stmt' ? row.data.partnerName : row.kind === 'pay' ? row.partnerName : (row.partnerName ?? '')) || '';
        const cashCodes = row.kind === 'cash'
          ? ((row.entry.lines ?? []).filter(l => l.accountCode && l.amount !== 0).map(l => l.accountCode)
             .concat(row.accountCode ? [row.accountCode] : []))
          : [];
        const docNo = row.kind === 'stmt' ? row.data.docNo : '';
        const note  = row.kind === 'cash' ? (row.note ?? '') : '';
        if (histFrom && d < histFrom) return false;
        if (histTo   && d > histTo)   return false;
        // rowKind가 이미 다섯 갈래라 그대로 견준다 — 예전엔 여기서 수금→입금으로 또 옮겨
        // 매핑이 두 군데에 있었고, 한쪽만 고치면 엉뚱한 탭이 걸렸다.
        if (histKind !== '전체' && rowKind(row) !== histKind) return false;
        if (histPartner && name !== histPartner) return false;
        // 계정은 **줄**로 본다 — 전표 머리로 보면 복합 전표가 통째로 빠진다
        if (histAccount && !matchAccount(rowCodes(row))) return false;
        if (histSearch.trim()) {
          const q = histSearch.toLowerCase();
          // 계정과목·품목까지 검색 대상 — "이자"로 이번 달 이자비용만 뽑아보려면 이게 있어야 한다.
          // 자금 행은 계정명이 화면에만 있고 적요엔 없어서, 이게 없으면 계정으로 못 찾는다.
          const acctText = row.kind === 'cash'
            ? cashCodes.map(c => `${c} ${codeName.get(c) ?? ''}`).join(' ')
              + ' ' + (row.entry.lines ?? []).map(l => l.note ?? '').join(' ')
            : row.kind === 'stmt'
              ? (row.data.items ?? []).map(i => `${i.accountCode ?? ''} ${codeName.get(i.accountCode ?? '') ?? ''} ${i.name ?? ''}`).join(' ')
              : '';
          if (!matchesSearch(name, q) && !docNo.includes(q)
            && !matchesSearch(note, q) && !matchesSearch(acctText, q)) return false;
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
        // 그래도 같으면 **끊은 순서** — 소급 전표는 시각이 전부 23:59:59라 여기서 갈린다
        const ida = a.kind === 'stmt' ? a.data.id : a.kind === 'pay' ? a.paymentId : a.entry.id;
        const idb = b.kind === 'stmt' ? b.data.id : b.kind === 'pay' ? b.paymentId : b.entry.id;
        return issuedMs(ida) - issuedMs(idb)
          || String(ida).localeCompare(String(idb), undefined, { numeric: true });
      }); // 오래된→최신
  }, [allTimelineRows, histFrom, histTo, histKind, histAccount, histPartner, histSearch, codeType, codeName, classifyRow, rowKind, rowCodes, matchAccount]);

  // 페이지네이션: 필터 변경 시 1페이지로 리셋, 최신 페이지부터 보여줌
  useEffect(() => { setHistoryPage(1); }, [histFrom, histTo, histKind, histAccount, histPartner, histSearch]);
  /** 거래처 목록 — 실제로 전표가 있는 이름만. 없는 이름을 고르게 하면 빈 목록만 본다. */
  const histPartnerNames = useMemo(() => {
    const set = new Set<string>();
    for (const row of allTimelineRows) {
      const n = (row.kind === 'stmt' ? row.data.partnerName : row.kind === 'pay' ? row.partnerName : (row.partnerName ?? '')) || '';
      if (n) set.add(n);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [allTimelineRows]);
  const partnerShown = useMemo(() => {
    const q = partnerQuery.trim().toLowerCase();
    return q ? histPartnerNames.filter(n => matchesSearch(n, q)) : histPartnerNames;
  }, [histPartnerNames, partnerQuery]);
  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / HIST_PAGE_SIZE));
  const pagedHistory = useMemo(() => {
    // 최신순(역방향)으로 표시하기 위해 뒤에서부터 슬라이싱
    const reversed = [...filteredHistory].reverse();
    const start = (historyPage - 1) * HIST_PAGE_SIZE;
    return reversed.slice(start, start + HIST_PAGE_SIZE);
  }, [filteredHistory, historyPage]);

  // 하단 합계 — 현재 필터·기간에 걸린 전표/수금/지불 총액 (검색·날짜와 무관하게 항상 합계 표시)
  const histTotals = useMemo(() => {
    let stmtSum = 0, stmtCnt = 0, receiveSum = 0, paySum = 0, receiveCnt = 0, payCnt = 0;
    // 전표 없이 자금원장으로만 나간 손익 — 이자비용·전력비 등. 매입/매출 합계에 같이 세야
    // "이번 달 얼마 썼나"가 맞는다(대출상환의 이자 줄이 여기로 온다).
    let costCash = 0, incomeCash = 0;
    for (const r of filteredHistory) {
      const c = classifyRow(r);                      // 구분 판정은 한 곳에서만 — 필터와 같은 규칙
      if (r.kind === 'stmt') { stmtSum += r.data.totalAmount; stmtCnt++; }
      if (c.cash === '입금') { receiveSum += r.kind === 'cash' ? r.amount : (r as { amount: number }).amount; receiveCnt++; incomeCash += c.plAmount; }
      else if (c.cash === '출금') { paySum += r.kind === 'cash' ? r.amount : (r as { amount: number }).amount; payCnt++; costCash += c.plAmount; }
    }
    return { stmtSum, stmtCnt, receiveSum, paySum, receiveCnt, payCnt, costCash, incomeCash };
  }, [filteredHistory, classifyRow]);

  // 거래처별 미수금/미지급금 — 전표별 매칭이 아니라 거래처 잔액 기준(partnerBalances).
  const partnerBalanceMap = partnerBalances;


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
        // 전표일자는 **발행하는 날**이 기본이다(주문 접수일이 아니라).
        //  주문은 며칠 전에 들어와도 전표는 오늘 끊는 게 보통이라, 접수일을 물려받으면
        //  매번 손으로 고쳐야 했다. 필요하면 날짜칸에서 바꾸면 된다.
        setTradeDate(today());
        setShowPreview(false);
        setEditablePrices({});
        setTaxExemptOverrides({});
        // 주문 품목을 편집 가능한 형태로 미리 채움. 박스 품목은 낱개로 변환(수량 = 박스개수×개입, 낱개 단가).
        const rows: ManualRow[] = o.items.map(item => {
          let product = allItems.find(p => p.id === item.itemId);
          let qty = item.quantity;
          const uc = unpackComponent(product);
          if (uc) {
            const loose = allItems.find(p => p.id === uc.itemId);
            if (loose) {
              const boxCount = item.isBoxUnit && item.boxQuantity ? item.boxQuantity : item.quantity;
              product = loose;
              qty = boxCount * uc.count;
            }
          }
          const displayName = product?.name || item.name;
          const spec = uc ? (product?.spec || item.displaySize || '') : (item.displaySize || product?.spec || '');
          const pcEntry = partnerOut.find(pc => pc.itemId === product?.id && pc.partnerId === o.partnerId);
          const price = pcEntry?.price ?? item.price ?? product?.price ?? 0;
          const isTaxExempt = pcEntry?.taxType === '면세';
          return { name: displayName, spec, qty: String(qty), price: String(price), isTaxExempt, note: '', accountCode: pcEntry?.Account_Code };
        });
        // 빈 행 자동 추가 안 함 — 주문 품목만 그대로. 더 넣으려면 '+ 행 추가' 사용.
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
        {/* 2행 — 거래유형·계정과목·검색 한 줄.
            버튼을 늘어놓으니 계정이 수십 개라 줄이 세 겹으로 접혔다. 고르는 값이 많고
            계층이 깊은 건 드롭다운이 맞다. 지금 무엇으로 거르는지는 옆 숨길에 적어 둔다. */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest w-10 shrink-0">필터</span>

          {/* 거래유형 — 다섯 갈래 고정 */}
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">거래유형</span>
            <select value={histKind} onChange={e => setHistKind(e.target.value as typeof histKind)}
              className={`${'border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] font-black bg-white text-slate-600 outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer'} ${histKind !== '전체' ? 'border-indigo-300 text-indigo-700' : ''}`}>
              {(['전체','매출','매입','대체','입금','출금'] as const).map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>

          {/* 거래처 — 전표가 실제로 있는 이름만. 수백 곳이라 검색으로 찾는다(목록 높이는 고정). */}
          <div className="relative">
            <button type="button" onClick={() => { setPartnerPickerOpen(v => !v); setPartnerQuery(''); }}
              className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 text-[11px] font-black bg-white outline-none transition-all max-w-[200px] ${
                histPartner ? 'border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
              <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest shrink-0">거래처</span>
              <span className="truncate">{histPartner || '거래처 선택'}</span>
              <ChevronDown size={12} className="shrink-0 opacity-50"/>
            </button>
            {partnerPickerOpen && (<>
              <div className="fixed inset-0 z-40" onClick={() => setPartnerPickerOpen(false)}/>
              <div className="absolute left-0 top-full mt-1 z-50 w-[240px] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                <div className="p-2 border-b border-slate-100">
                  <input autoFocus value={partnerQuery} onChange={e => setPartnerQuery(e.target.value)}
                    placeholder="거래처 이름으로 찾기"
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
                </div>
                <div className="h-[260px] overflow-y-auto py-1">
                  {histPartner && (
                    <button type="button" onClick={() => { setHistPartner(''); setPartnerPickerOpen(false); }}
                      className="w-full text-left px-3 py-1.5 text-xs font-black text-slate-400 hover:bg-slate-50">필터 해제</button>
                  )}
                  {partnerShown.length === 0 && (
                    <p className="px-3 py-6 text-center text-[11px] font-bold text-slate-300">찾는 거래처가 없습니다</p>
                  )}
                  {partnerShown.map(n => (
                    <button key={n} type="button" onClick={() => { setHistPartner(n); setPartnerPickerOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs font-black hover:bg-slate-50 transition-colors ${
                        histPartner === n ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}>{n}</button>
                  ))}
                </div>
              </div>
            </>)}
          </div>

          {/* 계정과목 — **검색되는 목록 하나.** 계정은 수십 개지만 찾는 사람은 이름을 안다.
              층을 훑어 내려가게 하면 이자비용 하나 찾는 데도 세 번을 골라야 한다.
              계층은 줄마다 경로로 보여 준다 — 손익 › 영업외비용 › 951 이자비용. */}
          <div className="relative">
            <button type="button" onClick={() => { setAcctPickerOpen(v => !v); setAcctQuery(''); }}
              className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 text-[11px] font-black bg-white outline-none transition-all max-w-[260px] ${
                histAccount ? 'border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
              <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest shrink-0">계정과목</span>
              <span className="truncate">
                {acctPicked ? <>
                  <span className="text-slate-400 font-bold">{acctPicked.path} › </span>{acctPicked.label}
                </> : '계정 선택'}
              </span>
              <ChevronDown size={12} className="shrink-0 opacity-50"/>
            </button>
            {acctPickerOpen && (<>
              <div className="fixed inset-0 z-40" onClick={() => setAcctPickerOpen(false)}/>
              <div className="absolute left-0 top-full mt-1 z-50 w-[320px] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
                <div className="p-2 border-b border-slate-100">
                  <input autoFocus value={acctQuery} onChange={e => setAcctQuery(e.target.value)}
                    placeholder="계정 이름·번호로 찾기"
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
                </div>
                {/* 층으로 좁힌다 — 손익 › 이익·비용,  재무 › 자산·부채·자본. 검색하면 층을 건너뛴다. */}
                {!acctQuery.trim() && (
                  <div className="px-2 py-2 space-y-1.5 border-b border-slate-100">
                    <div className="flex gap-1">
                      {(['손익', '재무'] as const).map(a => (
                        <button key={a} type="button"
                          onClick={() => { setAcctAxis(a); setAcctBranch(''); }}
                          className={`flex-1 py-1.5 rounded-lg text-[11px] font-black border transition-all ${
                            acctAxis === a ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>{a}</button>
                      ))}
                    </div>
                    {acctAxis && (
                      <div className="flex gap-1">
                        {(acctAxis === '손익' ? ['이익', '비용'] : ['자산', '부채', '자본']).map(b => (
                          <button key={b} type="button"
                            onClick={() => setAcctBranch(b)}
                            className={`flex-1 py-1.5 rounded-lg text-[11px] font-black border transition-all ${
                              acctBranch === b ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>{b}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="h-[260px] overflow-y-auto py-1">
                  {histAccount && (
                    <button type="button"
                      onClick={() => { setHistAccount(''); setAcctAxis(''); setAcctBranch(''); setAcctPickerOpen(false); }}
                      className="w-full text-left px-3 py-1.5 text-xs font-black text-slate-400 hover:bg-slate-50">필터 해제</button>
                  )}
                  {acctShown.length === 0 && (
                    <p className="px-3 py-6 text-center text-[11px] font-bold text-slate-300">
                      {acctQuery.trim() ? '찾는 계정이 없습니다' : !acctAxis ? '손익 · 재무 중에서 고르세요' : '갈래를 고르세요'}
                    </p>
                  )}
                  {acctShown.map(it => (
                    <button key={it.value} type="button"
                      onClick={() => { setHistAccount(it.value); setAcctPickerOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-slate-50 transition-colors ${
                        histAccount === it.value ? 'bg-indigo-50' : ''}`}>
                      <span className={`text-xs font-black ${histAccount === it.value ? 'text-indigo-700' : 'text-slate-700'}`}>{it.label}</span>
                      <span className="block text-[10px] font-bold text-slate-300 leading-tight">{it.path}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>)}
          </div>

          <div className="relative flex-1 max-w-xs ml-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
            <input type="text" placeholder="업체명 · 문서번호 · 계정과목(예: 이자)" value={histSearch}
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
          title="일반전표 — 돈이 실제로 오간 것. 전기·임대 같은 비용, 수금·지불(미수/미지급 상계), 대출상환·급여"
        >
          <Plus size={13} strokeWidth={3}/>일반전표
        </button>
        {onGenerateRecurringCosts && (
          <button
            onClick={() => { setShowRecurring(true); setRecurringYm(today().slice(0, 7)); setRecurringMsg(''); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-violet-600 text-white hover:bg-violet-500 shadow-sm shadow-violet-200 transition-all"
            title="전표 템플릿 — 목록 관리 · 매달 자동 발행 설정"
          >
            <RotateCw size={13} strokeWidth={3}/>템플릿
          </button>
        )}

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
                  // 쪼갠 줄(대출상환 원금+이자)은 계정 칸에 "원금 차입금 1,000,000 · 이자 …"로 펼친다.
                  // 줄 금액은 부호를 가진다 — 음수는 통장과 같은 편(급여의 원천공제 등)
                  const split = (row.entry.lines ?? []).filter(l => l.accountCode && l.amount !== 0);
                  const acct = split.length
                    ? split.map(l => `${l.note ? l.note + ' ' : ''}${codeName.get(l.accountCode) ?? l.accountCode} ${l.amount < 0 ? '−' : ''}${fmt(Math.abs(l.amount))}`).join(' · ')
                    : (row.accountCode ? `${codeName.get(row.accountCode) ?? row.accountCode}` : '');
                  const detail = [acct, row.note].filter(Boolean).join(' · ');
                  // 자금기록 한 건은 줄도 하나다. 다만 성격이 둘이면 배지를 둘 단다 — [출금][비용].
                  // 예전엔 자금축·손익축을 별개 줄로 뽑아 대출상환 한 건이 두 줄로 보였다.
                  const plKind = row.dir === '입금' ? '수익' : '비용';
                  const plParts = split.length
                    ? split.filter(l => codeType.get(l.accountCode) === plKind)
                        .map(l => ({ code: l.accountCode, amount: l.amount }))
                    : (row.accountCode && codeType.get(row.accountCode) === plKind
                        ? [{ code: row.accountCode, amount: row.amount }] : []);
                  const plAmt = plParts.reduce((a, p) => a + p.amount, 0);
                  // 자금 행은 언제나 통장에서 오간 전액을 보여준다.
                  // (예전엔 손익 탭에서 그 성격의 금액만 보여줬는데, 이제 자금전표는
                  //  매출·매입 탭에 아예 안 오므로 가릴 이유가 없다.)
                  // 계정을 콕 집어 걸렀으면 **그 계정 몫**을 보여준다 — 안 그러면 손익과 안 맞아 보인다
                  const portion = accountPortion(row);
                  const shownAmt = portion != null && portion !== row.amount ? portion : row.amount;
                  const partial = portion != null && portion !== row.amount;
                  // 성격 배지 — 계정의 종류에서 뽑는다. 한 건에 성격이 여럿이면 배지도 여럿.
                  //   대출상환 = [출금] + 원금(부채↓) [상환] + 이자(비용) [비용]
                  // Tailwind은 클래스명을 조립하면 못 알아보므로 정적 문자열로 둔다.
                  const KIND_CLS: Record<string, string> = {
                    비용: 'bg-rose-100 text-rose-700', 수익: 'bg-blue-100 text-blue-700',
                    상환: 'bg-violet-100 text-violet-700', 차입: 'bg-violet-100 text-violet-700',
                    예수: 'bg-amber-100 text-amber-700', 반환: 'bg-amber-100 text-amber-700',
                    자산: 'bg-teal-100 text-teal-700', 처분: 'bg-teal-100 text-teal-700',
                  };
                  // 부채는 줄지 느는지에 따라 말이 다르다 — 줄 금액의 부호로 가른다.
                  //   대출상환 원금(+, 출금) = 부채 감소 → 상환 / 급여 원천공제(−, 출금) = 부채 증가 → 예수
                  const kindOf = (code?: string, amount = 1): string | null => {
                    const t = code ? codeType.get(code) : undefined;
                    if (t === '비용' || t === '수익') return t;
                    const shrink = row.dir === '출금' ? amount > 0 : amount < 0;   // 그 계정이 줄어드는가
                    if (t === '부채') {
                      const isLoan = /차입금/.test(codeName.get(code!) ?? '');
                      return shrink ? (isLoan ? '상환' : '반환') : (isLoan ? '차입' : '예수');
                    }
                    if (t === '자산') return shrink ? '처분' : '자산';
                    return null;
                  };
                  const kindParts = split.length
                    ? split.map(l => ({ code: l.accountCode, amount: l.amount }))
                    : (row.accountCode ? [{ code: row.accountCode, amount: row.amount }] : []);
                  const kinds = [...new Set(kindParts.map(p => kindOf(p.code, p.amount)).filter((k): k is string => !!k))];
                  const isOpen = expandedJournal.has(row.entry.id);
                  // 거래처가 붙은 돈인데 전표 매칭도 계정도 없으면 '미배분' — 받았지만 어느 청구서에
                  // 넣을지 안 정한 돈이다. 계정이 있으면 성격이 정해진 것이라 정상(이자·차입금 등).
                  const matchedAmt = settlements
                    .filter(s => s.cashEntryId === row.entry.id)
                    .reduce((a, s) => a + s.amount, 0);
                  const unallocated = row.entry.partnerId && !split.length && !row.accountCode
                    ? Math.max(0, row.entry.amount - matchedAmt) : 0;
                  return (
                  <React.Fragment key={`cash__${row.entry.id}`}>
                    <tr
                      onClick={() => onUpdateCashEntry && openEditCash(row.entry)}
                      className={`transition-colors ${onUpdateCashEntry ? 'cursor-pointer' : ''} ${row.dir === '입금' ? 'bg-emerald-50/60 hover:bg-emerald-100/60' : 'bg-slate-50/60 hover:bg-slate-100/60'}`}>
                      <td className="px-4 py-2 text-[11px] font-mono text-slate-500 whitespace-nowrap">{row.date}{row.entry.createdAt ? ` ${row.entry.createdAt.slice(11,16)}` : ''}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 align-middle">
                          {journalToggle(row.entry.id)}
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${row.dir === '입금' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{rowKind(row)}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs font-bold text-slate-700">{row.partnerName || <span className="text-slate-300">—</span>}</td>
                      <td className={`px-4 py-2 text-xs text-right font-black ${row.dir === '입금' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {fmt(shownAmt)}
                        {/* 계정으로 걸렀을 땐 그 계정 몫을 띄우되, 통장에서 나간 전액도 같이 밝힌다 */}
                        {partial && (
                          <span className="block text-[10px] font-bold text-slate-400">통장 {fmt(row.amount)}</span>
                        )}
                        {/* 성격이 섞인 건 — 통장에서 나간 전액과 그중 손익분이 다르다 */}
                        {!partial && plAmt > 0 && plAmt !== row.amount && (
                          <span className="block text-[10px] font-bold text-rose-400">그중 {plKind} {fmt(plAmt)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-right">
                        {/* 거래처는 붙었는데 전표에도 안 붙고 계정도 없는 돈 = 어디 쓸지 안 정한 돈.
                            완도식품처럼 조용히 떠 있으면 미수금이 안 맞는데 원인을 못 찾는다. */}
                        {/* 거래처가 붙은 돈이면 그 시점 잔액도 같이 — 수금/지불 행과 같은 근거(cumul) */}
                        {row.cumul !== undefined && (
                          <span className={`block font-black tabular-nums ${row.cumul === 0 ? 'text-slate-300' : row.cumul < 0 ? 'text-amber-600' : 'text-slate-600'}`}>
                            {row.cumul === 0 ? '0' : row.cumul < 0 ? `−${fmt(Math.abs(row.cumul))}` : fmt(row.cumul)}
                          </span>
                        )}
                        {unallocated > 0
                          ? <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">
                              미배분 {fmt(unallocated)}
                            </span>
                          : row.cumul === undefined && <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-2 text-[11px] text-slate-500 max-w-[180px] truncate">
                        {/* 쪼갠 줄로 계정이 붙은 건도 지정된 것 — accountCode만 보면 '미지정'으로 잘못 뜬다.
                            쪼갠 건은 계정별 금액을 그대로 보여준다 — "원금 차입금 1,000,000 · 이자 이자비용 284,169" */}
                        {(split.length || row.accountCode)
                          ? detail
                          : <span className="text-amber-500 font-bold">계정 미지정{row.note ? ` · ${row.note}` : ''}</span>}
                      </td>
                      <td className="px-4 py-2">
                        {onDeleteCashEntry && (
                          <button onClick={(e) => { e.stopPropagation(); if (window.confirm('이 자금 전표를 삭제할까요?')) onDeleteCashEntry(row.entry.id); }}
                            className="text-slate-300 hover:text-rose-500 transition-all"><Trash2 size={13}/></button>
                        )}
                      </td>
                    </tr>
                    {/* 분개 — 쪼갠 줄(대출상환 원금+이자)도 여기서 계정별로 갈려 보인다.
                        전에는 쪼갠 줄만 따로 폈는데, 통장 쪽 상대계정이 안 보여 반쪽이었다. */}
                    {isOpen && journalTr(`je__cash__${row.entry.id}`, journalizeCashEntry(row.entry))}
                  </React.Fragment>
                  );
                }
                if (row.kind === 'pay') {
                  // ── 수금/지불 행 ──
                  // 라벨은 수금·지불(무슨 돈인지 알아야 하니까). 다만 분류는 자금(입금·출금)이라
                  // 수익·비용 탭에는 안 뜬다 — 매출·매입은 전표 끊을 때 이미 잡혔기 때문.
                  const label = row.offset ? '상계' : row.stmtType === '매출' ? '수금' : '지불';
                  const cumul = row.cumul;
                  const payEntry = row.entry;
                  return (
                    <React.Fragment key={`pay__${row.paymentId}`}>
                    <tr
                      className={`cursor-pointer transition-colors ${row.stmtType === '매출' ? 'bg-lime-50/80 hover:bg-lime-100/80' : 'bg-orange-50/80 hover:bg-orange-100/80'}`}
                      onClick={() => openPayTimelineRow(row.paymentId, row.src)}>
                      <td className="px-4 py-2 text-[11px] font-mono text-slate-500 whitespace-nowrap">{row.date}{payEntry?.createdAt ? ` ${payEntry.createdAt.slice(11,16)}` : ''}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1 align-middle">
                          {journalToggle(row.paymentId)}
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${row.stmtType === '매출' ? 'bg-lime-100 text-lime-700' : 'bg-orange-100 text-orange-700'}`}>{label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs font-bold text-slate-800">{row.partnerName}</td>
                      <td className="px-4 py-2 text-xs text-right font-black text-slate-800">{fmt(row.amount)}</td>
                      <td className="px-4 py-2 text-xs text-right">
                        {cumul === 0
                          ? <span className="font-black text-slate-400">0</span>
                          : cumul < 0
                            ? <span className="font-black text-slate-500 whitespace-nowrap">
                              −{fmt(Math.abs(cumul))}
                              <span className="ml-1 text-[9px] font-black px-1 py-0.5 rounded bg-slate-100 text-slate-500 align-middle">{overLabelOf(row.stmtType)}</span>
                            </span>
                            : <span className={`font-black ${row.stmtType === '매출' ? 'text-blue-600' : 'text-rose-600'}`}>{fmt(cumul)}</span>
                        }
                      </td>
                      <td className="px-4 py-2 text-[11px] text-slate-400 max-w-[180px] truncate">
                        {[row.method, row.note].filter(Boolean).join(' · ')}
                      </td>
                      <td className="px-4 py-2">
                        <button onClick={e => { e.stopPropagation(); deletePayTimelineRow(row.paymentId, row.src); }}
                          className="text-slate-300 hover:text-rose-500 transition-all" title="수금/지불 삭제"><Trash2 size={13}/></button>
                      </td>
                    </tr>
                    {/* 수금·지불은 손익이 아니라 채권·채무를 현금으로 상계하는 것 — 분개로 보면 분명하다 */}
                    {expandedJournal.has(row.paymentId) && payEntry &&
                      journalTr(`je__pay__${row.paymentId}`, journalizeCashEntry(payEntry))}
                    </React.Fragment>
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
                const jOpen = expandedJournal.has(stmt.id);
                // 계정을 콕 집어 걸렀으면 **그 계정 몫**을 보여준다 — 전표 총액을 띄우면
                // 손익과 안 맞아 보인다(매출전표 안에 잡이익이 섞인 것처럼).
                const stPortion = accountPortion(row);
                const stPartial = stPortion != null && stPortion !== stmt.totalAmount;
                return (
                  <React.Fragment key={stmt.id}>
                  <tr className={`transition-colors cursor-pointer ${isReturn ? 'bg-rose-50 hover:bg-rose-100' : 'hover:bg-slate-50'}`}
                    onClick={() => openEdit(stmt)}>
                    <td className="px-4 py-3 text-[11px] font-mono text-slate-600 whitespace-nowrap">{dateLabel}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {journalToggle(stmt.id)}
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          stmt.type === '매출' ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'
                        }`}>{stmt.type}</span>
                        {isReturn && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">반품</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-800">{stmt.partnerName}</td>
                    <td className={`px-4 py-3 text-xs text-right font-black ${isReturn ? 'text-rose-600' : 'text-slate-800'}`}>
                      {fmt(stPartial ? stPortion! : stmt.totalAmount)}
                      {stPartial && <span className="block text-[10px] font-bold text-slate-400">전표 {fmt(stmt.totalAmount)}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-right">
                      {cumul === 0
                        ? <span className="font-black text-slate-400">0</span>
                        : cumul < 0
                          ? <span className="font-black text-slate-500 whitespace-nowrap">
                              −{fmt(Math.abs(cumul))}
                              <span className="ml-1 text-[9px] font-black px-1 py-0.5 rounded bg-slate-100 text-slate-500 align-middle">{overLabelOf(stmt.type)}</span>
                            </span>
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
                  {/* ── 분개 미리보기 ── 매출 한 건도 채권·매출·부가세로 갈리므로 줄로 편다 */}
                  {jOpen && journalTr(`je__${stmt.id}`, journalOfStmt(stmt))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {/* ── 모바일 카드 목록 ── */}
          <div className="md:hidden divide-y divide-slate-100">
            {pagedHistory.map(row => {
              if (row.kind === 'cash') {
                const split = (row.entry.lines ?? []).filter(l => l.accountCode && l.amount !== 0);
                const acct = split.length
                  ? split.map(l => `${l.note ? l.note + ' ' : ''}${codeName.get(l.accountCode) ?? l.accountCode} ${fmt(l.amount)}`).join(' · ')
                  : (row.accountCode ? (codeName.get(row.accountCode) ?? row.accountCode) : '');
                const detail = [acct, row.note].filter(Boolean).join(' · ');
                // 자금 행은 언제나 전액. 매출·매입 탭에는 자금전표가 안 온다.
                const mPl: '수익' | '비용' | null = null;
                if (mPl) {
                  const parts = split.length
                    ? split.filter(l => codeType.get(l.accountCode) === mPl).map(l => ({ code: l.accountCode, amount: l.amount }))
                    : (row.accountCode && codeType.get(row.accountCode) === mPl
                        ? [{ code: row.accountCode, amount: row.amount }] : []);
                  if (!parts.length) return null;
                  const badge = mPl === '비용' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700';
                  const amtC = mPl === '비용' ? 'text-rose-600' : 'text-blue-600';
                  return (
                    <React.Fragment key={`m-cash-${row.entry.id}`}>
                      {parts.map((p, i) => (
                        <div key={`m-cashpl-${row.entry.id}-${i}`}
                          onClick={() => onUpdateCashEntry && openEditCash(row.entry)}
                          className={`px-4 py-3 flex flex-col gap-1.5 ${onUpdateCashEntry ? 'cursor-pointer' : ''}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1">
                              {journalToggle(`${row.entry.id}#pl`)}
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${badge}`}>{mPl}</span>
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">{row.date}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-slate-700 truncate">{row.partnerName || (codeName.get(p.code) ?? p.code)}</span>
                            <span className={`text-sm font-black shrink-0 ${amtC}`}>{fmt(p.amount)}</span>
                          </div>
                          <p className="text-[11px] text-slate-400 truncate">
                            {[`${p.code} ${codeName.get(p.code) ?? ''}`, row.note].filter(Boolean).join(' · ')}
                          </p>
                          {expandedJournal.has(`${row.entry.id}#pl`) && (
                            <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50/70 overflow-hidden" onClick={e => e.stopPropagation()}>
                              {renderJournal(journalizeCashEntry(row.entry), true)}
                            </div>
                          )}
                        </div>
                      ))}
                    </React.Fragment>
                  );
                }
                return (
                  <div key={`m-cash-${row.entry.id}`}
                    onClick={() => onUpdateCashEntry && openEditCash(row.entry)}
                    className={`px-4 py-3 flex flex-col gap-1.5 ${onUpdateCashEntry ? 'cursor-pointer' : ''} ${row.dir === '입금' ? 'bg-emerald-50/60' : 'bg-slate-50/60'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1">
                        {journalToggle(row.entry.id)}
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${row.dir === '입금' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{rowKind(row)}</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-400">{row.date}</span>
                        {onDeleteCashEntry && <button onClick={(e)=>{e.stopPropagation(); if(window.confirm('이 자금 전표를 삭제할까요?')) onDeleteCashEntry(row.entry.id);}} className="text-slate-300 hover:text-rose-500" title="삭제"><Trash2 size={13}/></button>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-700 truncate">{row.partnerName || (acct || '자금')}</span>
                      <span className={`text-sm font-black shrink-0 ${row.dir === '입금' ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(row.amount)}</span>
                    </div>
                    {detail && <p className="text-[11px] text-slate-400 truncate">{detail}</p>}
                    {expandedJournal.has(row.entry.id) && (
                      <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50/70 overflow-hidden" onClick={e => e.stopPropagation()}>
                        {renderJournal(journalizeCashEntry(row.entry), true)}
                      </div>
                    )}
                  </div>
                );
              }
              if (row.kind === 'pay') {
                const label = row.offset ? '상계' : row.stmtType === '매출' ? '수금' : '지불';
                const cumul = row.cumul;
                const memo = [row.method, row.note].filter(Boolean).join(' · ');
                return (
                  <div key={`m-pay-${row.paymentId}`}
                    onClick={() => openPayTimelineRow(row.paymentId, row.src)}
                    className={`w-full px-4 py-3 flex flex-col gap-1.5 cursor-pointer ${row.stmtType === '매출' ? 'bg-lime-50/70' : 'bg-orange-50/70'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1">
                        {journalToggle(row.paymentId)}
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${row.stmtType === '매출' ? 'bg-lime-100 text-lime-700' : 'bg-orange-100 text-orange-700'}`}>{label}</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-400">{row.date}</span>
                        <button onClick={e => { e.stopPropagation(); deletePayTimelineRow(row.paymentId, row.src); }} className="text-slate-300 hover:text-rose-500" title="삭제"><Trash2 size={13}/></button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-800 truncate">{row.partnerName}</span>
                      <span className="text-sm font-black text-slate-800 shrink-0">{fmt(row.amount)}</span>
                    </div>
                    {memo && <p className="text-[11px] text-slate-400 truncate">{memo}</p>}
                    {expandedJournal.has(row.paymentId) && row.entry && (
                      <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50/70 overflow-hidden" onClick={e => e.stopPropagation()}>
                        {renderJournal(journalizeCashEntry(row.entry), true)}
                      </div>
                    )}
                  </div>
                );
              }
              const stmt = row.data;
              const issuedDate = new Date(stmt.issuedAt);
              const dateLabel = `${stmt.tradeDate} ${String(issuedDate.getHours()).padStart(2,'0')}:${String(issuedDate.getMinutes()).padStart(2,'0')}`;
              const stmtItems = stmt.items ?? [];
              const summary = stmtItems.slice(0, 2).map(i => i.name).join(', ') + (stmtItems.length > 2 ? ` 외 ${stmtItems.length - 2}건` : '');
              const isReturn = stmtItems.some(i => i.qty < 0);
              const cumul = row.cumul;
              const mJOpen = expandedJournal.has(stmt.id);
              return (
                <div key={`m-${stmt.id}`} onClick={() => openEdit(stmt)}
                  className={`px-4 py-3 flex flex-col gap-1.5 cursor-pointer ${isReturn ? 'bg-rose-50' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      {journalToggle(stmt.id)}
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
                        ? <span className="text-[11px] font-black shrink-0 text-slate-500 whitespace-nowrap">
                            −{fmt(Math.abs(cumul))}
                            <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-slate-100 align-middle">{overLabelOf(stmt.type)}</span>
                          </span>
                        : <span className={`text-[11px] font-black shrink-0 ${stmt.type === '매출' ? 'text-blue-600' : 'text-rose-600'}`}>잔액 {fmt(cumul)}</span>
                    )}
                  </div>
                  {getBalance(stmt) > 0 && (
                    <button onClick={e => { e.stopPropagation(); openPayModal(stmt); }}
                      className={`self-start mt-0.5 text-[10px] font-black px-2.5 py-1 rounded-lg flex items-center gap-1 ${stmt.type === '매입' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
                      <Save size={10}/>{stmt.type === '매입' ? '지불처리' : '수금처리'}
                    </button>
                  )}
                  {/* 분개 미리보기 — 표와 같은 내용, 좁은 화면이라 줄만 세로로 쌓는다 */}
                  {mJOpen && (
                    <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50/70 overflow-hidden" onClick={e => e.stopPropagation()}>
                      {renderJournal(journalOfStmt(stmt), true)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>)}
        {/* ── 하단 합계 (현재 필터·기간 기준) — 매출·매입·수금·지불 항상 표시 ── */}
        {filteredHistory.length > 0 && (() => {
          const stmts = filteredHistory.filter((r): r is Extract<TimelineRow, { kind: 'stmt' }> => r.kind === 'stmt');
          // 전표분 + 자금원장으로만 나간 손익(이자비용 등). 대출상환의 이자 줄이 매입 합계에 들어온다.
          const sale = stmts.filter(r => r.data.type === '매출').reduce((s, r) => s + (r.data.totalAmount || 0), 0)
                     + histTotals.incomeCash;
          const buy  = stmts.filter(r => r.data.type === '매입').reduce((s, r) => s + (r.data.totalAmount || 0), 0)
                     + histTotals.costCash;
          const cell = (label: string, val: number, cls: string) => (
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-black uppercase tracking-widest ${cls}`}>{label}</span>
              <span className={`font-black text-sm ${cls}`}>{fmt(val)}</span>
            </div>
          );
          // 탭이 보는 것의 합계만 띄운다 — 매출 탭에 지불 합계가 뜨면 뭘 보는 건지 흐려진다.
          // 갈래 필터를 없앴으니 합계도 가릴 이유가 없다 — 보이는 목록의 합계를 그대로 띄운다
          const showIncome = true, showCost = true, showCash = true;
          const anyPl = (showIncome && sale > 0) || (showCost && buy > 0);
          const anyCash = showCash && (histTotals.receiveSum > 0 || histTotals.paySum > 0);
          return (
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-end gap-x-5 gap-y-1.5">
              {/* 발생 = 이번 기간에 생긴 손익, 현금 = 이번 기간에 오간 돈. 외상이 있는 한 둘은 안 맞는다. */}
              {anyPl && (
                <span className="text-[9px] font-black text-slate-400 tracking-widest">발생</span>
              )}
              {showIncome && sale > 0 && cell('수익', sale, 'text-blue-600')}
              {showCost && buy > 0 && cell('비용', buy, 'text-rose-600')}
              {anyCash && (
                <span className="text-[9px] font-black text-slate-400 tracking-widest border-l border-slate-200 pl-5">현금</span>
              )}
              {showCash && histTotals.receiveSum > 0 && cell('수금', histTotals.receiveSum, 'text-lime-600')}
              {showCash && histTotals.paySum > 0 && cell('지불', histTotals.paySum, 'text-orange-600')}
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
            {/* 전표 금액과 거래처 누적잔액을 나란히 — 둘 중 하나를 전액으로 찍어 넣을 수 있다.
                돈은 전표에 붙지 않고 거래처 잔액에서 빠지므로, 어느 쪽을 골라도 결과는 잔액 차감이다. */}
            {(() => {
              const bal = partnerBalances.get(payTarget.partnerId);
              const partnerLeft = payTarget.type === '매입' ? (bal?.payable ?? 0) : (bal?.receivable ?? 0);
              const box = (label: string, amount: number, hint: string) => (
                <button onClick={() => setPayForm(p => ({ ...p, amount: String(Math.round(amount)) }))}
                  className="flex-1 text-left bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl px-3 py-2.5 transition-all">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</div>
                  <div className={`font-black text-base ${amount <= 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
                    {amount <= 0 ? '없음' : `${fmt(Math.round(amount))}원`}
                  </div>
                  <div className="text-[10px] text-slate-400">{hint}</div>
                </button>
              );
              return (
                <div className="flex gap-2">
                  {box('이 전표', payTarget.totalAmount, '눌러서 전액 입력')}
                  {box('거래처 잔액', partnerLeft, `${payTarget.partnerName} 전체`)}
                </div>
              );
            })()}
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
                  {(['현금', '계좌이체', '어음', '카드', '기타'] as PaymentMethod[]).map(m => (
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
              const overLabel = overLabelOf(payTarget?.type);
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

      {/* ── 자금(입출금) 전표 수정 모달 ── */}
      {editCash && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={closeEditCash}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-800">자금 전표 수정</h3>
                {/* 거래처를 안 보여줘서 어느 거래처 돈인지 모르고 고쳤다. 잔액도 같이 띄운다. */}
                {editCash.partnerName ? (() => {
                  const bal = editCash.partnerId ? partnerBalances.get(editCash.partnerId) : undefined;
                  const ar = bal?.receivable ?? 0, ap = bal?.payable ?? 0;
                  return (
                    <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                      {editCash.partnerName}
                      {ar !== 0 && <span className="ml-1.5 text-blue-600">미수 {fmt(ar)}</span>}
                      {ap !== 0 && <span className="ml-1.5 text-rose-600">미지급 {fmt(ap)}</span>}
                    </p>
                  );
                })() : <p className="text-[11px] font-bold text-slate-300 mt-0.5">거래처 없음</p>}
              </div>
              <button onClick={closeEditCash} className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={16}/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">구분</label>
                <div className="flex gap-1.5">
                  {(['입금','출금'] as const).map(d => (
                    <button key={d} disabled={editCashIsOffset} onClick={() => setEditCashForm(p => ({ ...p, dir: d }))}
                      className={`flex-1 py-2 rounded-xl text-xs font-black border transition-all ${editCashForm.dir === d ? (d==='입금'?'bg-emerald-600 text-white border-emerald-600':'bg-rose-600 text-white border-rose-600') : 'bg-white text-slate-500 border-slate-200'}`}>{d}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">
                  금액{editCashSplit.length > 0 && !editCashIsOffset && <span className="ml-1 text-blue-400 normal-case">= 줄 합계</span>}
                </label>
                {/* 쪼갠 전표의 금액은 줄 합이다 — 여기서 따로 고치면 자금원장과 분개가 갈라진다. */}
                <input type="text" inputMode="decimal"
                  value={editCashSplit.length > 0 && !editCashIsOffset ? String(editCashSplitSum) : editCashForm.amount}
                  readOnly={editCashSplit.length > 0 && !editCashIsOffset}
                  onChange={e => setEditCashForm(p => ({ ...p, amount: e.target.value.replace(/[^\d.]/g,'') }))}
                  className={`w-full border rounded-xl px-3 py-2 text-sm font-bold text-right outline-none focus:ring-2 focus:ring-blue-300 ${editCashSplit.length > 0 && !editCashIsOffset ? 'border-slate-100 bg-slate-50 text-slate-500' : 'border-slate-200'}`}/>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">일자</label>
                <input type="date" value={editCashForm.date}
                  onChange={e => setEditCashForm(p => ({ ...p, date: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase">
                    {editCashLines.length > 0 ? '쪼갠 줄' : '계정과목'}
                  </label>
                  <button
                    onClick={() => setEditCashLines(p => [...p,
                      // 첫 줄은 지금 화면의 계정·금액을 그대로 물려받는다 — 한 줄짜리를 쪼개는 흔한 경우.
                      p.length === 0
                        ? { accountCode: editCashForm.accountCode, amount: editCashForm.amount, note: '' }
                        : { accountCode: '', amount: '', note: '' }])}
                    className="text-[10px] font-black text-blue-600 hover:bg-blue-50 px-2 py-0.5 rounded-lg">+ 줄 추가</button>
                </div>
                {editCashLines.length === 0 ? (
                  <select value={editCashForm.accountCode}
                    onChange={e => setEditCashForm(p => ({ ...p, accountCode: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                    <option value="">계정 미지정(영업)</option>
                    {[...accountCodes].sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true})).map(ac => (
                      <option key={ac.id} value={ac.code}>{ac.code} {ac.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="space-y-1.5">
                    {editCashLines.map((l, i) => (
                      <div key={i} className="flex gap-1.5 items-center">
                        <select value={l.accountCode}
                          onChange={e => setEditCashLines(p => p.map((x, j) => j === i ? { ...x, accountCode: e.target.value } : x))}
                          className="flex-1 min-w-0 border border-slate-200 rounded-xl px-2 py-2 text-[11px] font-bold outline-none focus:ring-2 focus:ring-blue-300 bg-white">
                          <option value="">계정 선택</option>
                          {[...accountCodes].sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true})).map(ac => (
                            <option key={ac.id} value={ac.code}>{ac.code} {ac.name}</option>
                          ))}
                        </select>
                        {/* 상계(대체)는 반대편 줄이 음수라 빼기 부호를 지우면 안 된다. */}
                        <input type="text" inputMode="decimal" value={l.amount} placeholder="금액"
                          onChange={e => setEditCashLines(p => p.map((x, j) => j === i ? { ...x, amount: e.target.value.replace(/[^\d.-]/g,'') } : x))}
                          className="w-24 shrink-0 border border-slate-200 rounded-xl px-2 py-2 text-[11px] font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>
                        <input type="text" value={l.note} placeholder="적요"
                          onChange={e => setEditCashLines(p => p.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
                          className="w-16 shrink-0 border border-slate-200 rounded-xl px-2 py-2 text-[11px] font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
                        <button onClick={() => setEditCashLines(p => p.filter((_, j) => j !== i))}
                          className="p-1 shrink-0 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg"><X size={13}/></button>
                      </div>
                    ))}
                    {!editCashIsOffset ? (
                      <p className="text-[10px] font-bold text-slate-400 text-right">줄 합계 {fmt(editCashSplitSum)}</p>
                    ) : (
                      <p className="text-[10px] font-bold text-amber-600">상계(대체) 전표 — 줄이 부호를 가져 합은 0, 방향은 못 바꿉니다.</p>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">비고</label>
                <input type="text" value={editCashForm.note}
                  onChange={e => setEditCashForm(p => ({ ...p, note: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              {onDeleteCashEntry && (
                <button onClick={() => { if (window.confirm('이 자금 전표를 삭제할까요?')) { onDeleteCashEntry(editCash.id); closeEditCash(); } }}
                  className="flex items-center gap-1 px-3 py-2.5 rounded-xl bg-red-50 text-red-600 text-xs font-black hover:bg-red-100 border border-red-200"><Trash2 size={12}/>삭제</button>
              )}
              <button onClick={closeEditCash} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
              <button onClick={saveEditCash} disabled={editCashAmt <= 0}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-1.5"><Save size={12}/>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 빠른 수금/지불 모달 ── */}

      {/* ── 정기 고정비 생성 모달 ── */}
      {showRecurring && (() => {
        // 자동 발행 대상 — AdminApp·스케줄러와 같은 판정(shared/autoVoucher)
        const due = fixedCostTemplates.filter(t => canAutoIssue(t, recurringYm));
        const alreadyDone = (t: FixedCostTemplate) => {
          const key = autoVoucherId(t, recurringYm);
          return issuedStatements.some(s => s.id === key || (s as any).orderId === key)
            || cashEntries.some(e => e.id === key);
        };
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
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl p-6 space-y-4 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-slate-800">템플릿</h3>
                <button onClick={() => setShowRecurring(false)} className="text-slate-300 hover:text-slate-500"><X size={18} /></button>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                일반전표 발행에서 고르는 <b>템플릿</b> 목록입니다. 스위치를 켜면 매달 정한 날에
                저절로 발행됩니다(앱을 안 켜도 됩니다). 새 템플릿은 일반전표 발행에서 <b>[템플릿으로 저장]</b>으로 만듭니다.
              </p>

              {/* 목록·수정은 한 곳에서만 — 여러 화면에 두면 어느 게 진짜인지 흐려진다 */}
              <VoucherTemplateManager
                templates={fixedCostTemplates}
                accountCodes={accountCodes}
                partners={partners}
                onUpdate={onUpdateFixedCostTemplate}
                onDelete={onDeleteFixedCostTemplate}
                onCreate={onAddFixedCostTemplate}
                compact
              />

              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">대상 월</label>
                <input type="month" value={recurringYm}
                  onChange={e => { setRecurringYm(e.target.value); setRecurringMsg(''); }}
                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-300" />
              </div>

              {due.length === 0 ? (
                <p className="text-[11px] font-bold text-amber-700 bg-amber-50 rounded-xl px-4 py-3">
                  이 달에 자동 발행할 것이 없습니다. 위 목록에서 스위치를 켜세요.
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
                  {recurringBusy ? '발행 중…' : `${recurringYm} 지금 발행`}
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
          date: quickPayDate, cashAccountId: quickPayAccountId, createdAt: stampFor(quickPayDate),
          ...(quickPayClientId ? { partnerId: quickPayClientId, partnerName: selectedClientObj?.name ?? '' } : {}),
        });

        // 상계에 쓸 전표 배분 — 오래된 것부터 채운다. 저장과 미리보기가 같은 값을 봐야 한다.
        const offsetAllocations = () => {
          if (offsetAmt <= 0) return [] as { stmt: IssuedStatement; amount: number }[];
          const unpaid = issuedStatements
            .filter(s => s.partnerId === quickPayClientId && s.type === stmtTypeForPay && getBalance(s) > 0)
            .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
          const out: { stmt: IssuedStatement; amount: number }[] = [];
          let rem = offsetAmt;
          for (const st of unpaid) {
            if (rem <= 0) break;
            const apply = Math.min(rem, getBalance(st));
            if (apply > 0) out.push({ stmt: st, amount: apply });
            rem -= apply;
          }
          return out;
        };

        // 일반 저장 — 거래처 미수/미지급 상계 우선, 남는 금액은 계정과목 자금전표로.
        const doGeneralSave = () => {
          if (amt <= 0) return;
          const allocations = offsetAllocations();
          if (allocations.length) recordPayment(allocations, { date: quickPayDate, method: quickPayMethod, note: quickPayNote.trim() || undefined, cashAccountId: quickPayAccountId });
          if (plainAmt > 0) {
            // 쪼갠 줄이 있으면 lines로 끊는다 — amount는 줄 합이고 accountCode는 안 쓴다(types.ts CashEntry 주석).
            onAddCashEntry?.({
              id: `cash-${Date.now()}`, dir: qpDir, amount: plainAmt,
              ...(cashSplitOk ? { lines: cashSplitLines } : qpAccountCode ? { accountCode: qpAccountCode } : {}),
              ...(quickPayNote.trim() ? { note: quickPayNote.trim() } : {}), ...base(),
            } as any);
          }
          setShowQuickPay(false); setQuickPayOverWarn(false);
        };
        // 통장에서는 한 번 나가도 전표는 두 줄로 끊는다 — 원금은 차입금(부채 감소, 재무상태표),
        // 이자는 이자비용(손익계산서). 줄마다 계정·금액이 따로 보여야 손익이 깔끔하게 갈린다.
        // 통장에서 나간 건 원금+이자 합계 한 번. 자금은 그 금액으로 한 건 만들고,
        // 그 안에서 원금(차입금=부채 감소)과 이자(비용)를 줄로 가른다.
        // → 지불 합계엔 6만원 전부, 비용 합계엔 이자 3만원만 잡힌다.
        const loanEntry = (): CashEntry | null => {
          const memo = quickPayNote.trim() || '대출 상환';
          const lines = [
            ...(prin > 0 ? [{ accountCode: qpLoanCode, amount: prin, note: '원금' }] : []),
            ...(intr > 0 ? [{ accountCode: INTEREST_CODE, amount: intr, note: '이자' }] : []),
          ];
          if (!lines.length) return null;
          return {
            id: `cash-${Date.now()}`, dir: '출금', amount: prin + intr,
            ...(lines.length > 1 ? { lines } : { accountCode: lines[0].accountCode }),
            note: lines.length > 1 ? memo : `${memo} (${lines[0].note})`,
            ...base(),
          } as CashEntry;
        };
        const doLoanSave = () => {
          const e = loanEntry();
          if (!e) return;
          onAddCashEntry?.(e as any);
          setShowQuickPay(false);
        };
        // 급여도 대출상환과 같은 방식 — 전표는 한 건, 그 안에서 성격을 줄로 가른다.
        //   총급여는 비용(+), 원천공제는 우리가 맡아둔 돈이라 부채 증가(−).
        //   통장에서 실제로 나간 건 실지급액(net)이고, 줄 합계도 net으로 맞는다.
        // 예전엔 출금(총급여)·입금(예수금) 두 건으로 끊어 목록에 두 줄로 보였다.
        const insCorp = Number((qpInsCorp || '').replace(/,/g, '')) || 0;
        const insEmp = Number((qpInsEmp || '').replace(/,/g, '')) || 0;
        const insTotal = insCorp + insEmp;
        const INS_CODE = accountCodes.find(c => c.name === '사대보험')?.code ?? '530';

        /**
         * 4대보험 — 통장에서 한 번 나가지만 성격은 둘이다.
         *   회사부담분    비용(530)
         *   근로자부담분  급여에서 떼어 맡아둔 돈 → 예수금(254)을 턴다
         * 전액을 530으로 몰면 비용이 부풀고 예수금이 영영 안 줄어든다.
         */
        const insuranceEntry = (): CashEntry => {
          const memo = quickPayNote.trim() || '4대보험';
          const lines = [
            ...(insCorp > 0 ? [{ accountCode: INS_CODE, amount: insCorp, note: '회사부담' }] : []),
            ...(insEmp > 0 ? [{ accountCode: WITHHOLD_CODE, amount: insEmp, note: '근로자부담(예수금)' }] : []),
          ];
          return {
            id: `cash-${Date.now()}`, dir: '출금', amount: insTotal,
            ...(lines.length > 1 ? { lines } : { accountCode: lines[0].accountCode }),
            note: lines.length > 1 ? memo : `${memo} (${lines[0].note})`,
            ...base(),
          } as CashEntry;
        };
        /**
         * 세금 — 한 번에 내지만 **둘 다 비용이 아니다.**
         *   부가세    손님한테 받아 맡아둔 돈 → 255 부가세예수금(부채)을 턴다
         *   소득세    사업이 아니라 사장님 개인에게 매기는 세금 → 338 인출금(자본)
         * 전액을 비용으로 몰면 이익이 그만큼 줄어 보이고, 부가세예수금은 영영 안 줄어든다.
         */
        const vat = Number((qpVat || '').replace(/,/g, '')) || 0;
        const incomeTax = Number((qpIncomeTax || '').replace(/,/g, '')) || 0;
        const taxTotal = vat + incomeTax;
        const VAT_CODE = accountCodes.find(c => c.name === '부가세예수금')?.code ?? '255';
        const DRAW_CODE = accountCodes.find(c => c.name === '인출금')?.code ?? '338';
        const taxEntry = (): CashEntry => {
          const memo = quickPayNote.trim() || '세금 납부';
          const lines = [
            ...(vat > 0 ? [{ accountCode: VAT_CODE, amount: vat, note: '부가세' }] : []),
            ...(incomeTax > 0 ? [{ accountCode: DRAW_CODE, amount: incomeTax, note: '소득세' }] : []),
          ];
          return {
            id: `cash-${Date.now()}`, dir: '출금', amount: taxTotal,
            ...(lines.length > 1 ? { lines } : { accountCode: lines[0].accountCode }),
            note: lines.length > 1 ? memo : `${memo} (${lines[0].note})`,
            ...base(),
          } as CashEntry;
        };
        const doTaxSave = () => {
          if (taxTotal <= 0) return;
          onAddCashEntry?.(taxEntry() as any);
          setShowQuickPay(false);
        };
        const doInsuranceSave = () => {
          if (insTotal <= 0) return;
          onAddCashEntry?.(insuranceEntry() as any);
          setShowQuickPay(false);
        };

        /**
         * 발생 — 돈이 안 움직인 전표. **거래처가 있으면 매입전표, 없으면 대체전표**로 끊는다.
         *
         *   거래처 있음   (차) 비용 / (대) 251 외상매입금   → 그 거래처 미지급금이 는다. 나중에 [지불]
         *   거래처 없음   (차) 비용 / (대) 감가상각누계액 등  → 대체전표(type '비용'), 차·대를 직접 세운다
         *
         * 부가세 신고에 들어가려면 공급자가 있어야 하고, 미지급금을 걸려면 걸 상대가 있어야 한다 —
         * 그래서 거래처 하나로 갈린다. 사용자는 거래처만 고르면 되고 어느 전표인지는 앱이 정한다.
         */
        // 갈래가 전표 종류를 정한다 — 거래처를 고르면 매입전표(미지급금이 선다),
        // 안 고르면 순수 대체(차·대를 직접 세운다)
        const accrType: '매출' | '매입' | '비용' = quickPayClientId ? '매입' : '비용';
        const accrLines = qpAccrRows
          .filter(r => r.accountCode && Number(String(r.price).replace(/,/g, '')) > 0)
          .map(r => {
            const a = Number(String(r.price).replace(/,/g, '')) || 0;
            return {
              name: r.name.trim() || (codeName.get(r.accountCode!) ?? ''),
              spec: '', qty: 1, price: a, supply: a, tax: 0, total: a,
              isTaxExempt: true, accountCode: r.accountCode!, side: r.side,
            };
          });
        // 차·대를 따로 센다. 대체전표는 **둘이 같아야** 끊을 수 있다.
        const accrDebit  = accrLines.filter(l => l.side === '차변').reduce((a, r) => a + r.total, 0);
        const accrCredit = accrLines.filter(l => l.side === '대변').reduce((a, r) => a + r.total, 0);
        // 매입전표(거래처 있음)는 차·대가 갈래로 정해지므로 한 변의 합이 총액이다
        const accrTotal = accrType === '비용' ? accrDebit : accrLines.reduce((a, r) => a + r.total, 0);
        const accrBalanced = accrType !== '비용' || (accrDebit > 0 && accrDebit === accrCredit);

        const doAccrualSave = () => {
          if (!accrLines.length || !accrBalanced) return;   // 차·대가 안 맞으면 안 끊는다
          const d = new Date(quickPayDate + 'T00:00:00');
          // 대체는 따로 센다 — 매입·매출과 번호가 섞이면 어느 갈래인지 번호로 못 읽는다
          const accrDocNo = nextDocNo(quickPayDate, issuedStatements, accrType === '비용' ? '대체' : '');
          const stmt: IssuedStatement = {
            id: `stmt-${Date.now()}`,
            issuedAt: stampFor(quickPayDate),
            tradeDate: quickPayDate,
            type: accrType,
            partnerId: quickPayClientId || '',
            partnerName: quickPayClientId ? (selectedClientObj?.name ?? '') : (accrLines[0].name || '대체'),
            orderId: '',
            docNo: accrDocNo,
            totalSupply: accrTotal, totalTax: 0, totalAmount: accrTotal,
            items: accrLines,
          };
          onAddIssuedStatement?.(stmt);
          setShowQuickPay(false);
        };

        /**
         * 회사 간 이체 — 우리 통장에서 상대 회사 통장으로 보낸다.
         * 보낸 쪽은 대여금(자산), 받은 쪽은 차입금(부채). 한쪽만 적으면 두 장부가 어긋나므로
         * 한 번에 두 건을 같이 만든다(shared/interCompany).
         */
        const advAmt = Number((qpAdvAmount || '').replace(/,/g, '')) || 0;
        // 상대 회사를 가리키는 거래처 — 채권·채무가 이 거래처로 잡혀야 잔액이 준다.
        // 이름으로 찾는다(태백푸드 / 풍회유통). 없으면 상계를 못 하고 전액 선급금이 된다.
        const advTargetName = COMPANIES.find(c => c.id === qpAdvCompany)?.name ?? '';
        const advMyName = COMPANIES.find(c => c.id === companyId)?.name ?? '';
        const advTargetPartner = partners.find(p => p.name === advTargetName);
        const advMyPartner = partners.find(p => p.name === advMyName);
        // 내가 상대에게 진 미지급 — 이만큼 먼저 턴다
        const advPayable = advTargetPartner
          ? Math.max(0, partnerBalances.get(advTargetPartner.id)?.payable ?? 0)
          : 0;
        const advSplit = splitTransfer(advAmt, advPayable, qpAdvOver);

        const doTransferSave = () => {
          if (advAmt <= 0 || !onAddForCompany) return;
          const t = buildTransfer({
            from: companyId, to: qpAdvCompany,
            date: quickPayDate, amount: advAmt,
            payableToTarget: advPayable, overKind: qpAdvOver,
            fromAccountId: quickPayAccountId,
            fromPartnerId: advTargetPartner?.id, fromPartnerName: advTargetPartner?.name,
            toPartnerId: advMyPartner?.id, toPartnerName: advMyPartner?.name,
            note: quickPayNote.trim() || undefined,
          });
          onAddForCompany(companyId, { cashEntry: t.out });
          onAddForCompany(qpAdvCompany, { cashEntry: t.in });
          setShowQuickPay(false);
        };

        const salaryEntry = (): CashEntry => {
          const memo = quickPayNote.trim() || '급여';
          const lines = [
            { accountCode: SALARY_CODE, amount: grs, note: '총급여' },
            ...(ded > 0 ? [{ accountCode: WITHHOLD_CODE, amount: -ded, note: '원천공제' }] : []),
          ];
          return {
            id: `cash-${Date.now()}`, dir: '출금', amount: net,
            ...(lines.length > 1 ? { lines } : { accountCode: SALARY_CODE }),
            note: memo, ...base(),
          } as CashEntry;
        };
        const doSalarySave = () => {
          onAddCashEntry?.(salaryEntry() as any);
          setShowQuickPay(false);
        };

        /**
         * 저장하면 어떤 자금전표가 생기는지 — 아래 분개 미리보기가 이걸 그대로 분개한다.
         * 저장 경로와 같은 함수를 써서 만든다. 갈라 두면 "보인 것과 저장된 것"이 달라진다.
         */
        const previewEntries = (): CashEntry[] => {
          if (qpMode === '상환') { const e = loanEntry(); return e ? [e] : []; }
          if (qpMode === '급여') return grs > 0 ? [salaryEntry()] : [];
          if (qpMode === '보험') return insTotal > 0 ? [insuranceEntry()] : [];
          if (qpMode === '세금') return taxTotal > 0 ? [taxEntry()] : [];
          if (qpDir === '회사이체') {
            if (advAmt <= 0) return [];
            const t = buildTransfer({
              from: companyId, to: qpAdvCompany, date: quickPayDate, amount: advAmt,
              payableToTarget: advPayable, overKind: qpAdvOver,
              fromAccountId: quickPayAccountId,
              fromPartnerId: advTargetPartner?.id, fromPartnerName: advTargetPartner?.name,
              toPartnerId: advMyPartner?.id, toPartnerName: advMyPartner?.name,
              note: quickPayNote.trim() || undefined,
            });
            return [t.out, t.in];
          }
          if (!isCashDir(qpDir)) return [];   // 비현금 갈래는 전표(매입·매출·대체)라 아래에서 따로 미리보기
          if (amt <= 0) return [];
          const out: CashEntry[] = [];
          const allocations = offsetAllocations();
          if (allocations.length) {
            // recordPayment이 만드는 것과 같은 한 건 — 상대계정도 같은 함수로 고른다
            const first = allocations[0].stmt;
            const groupTypeOf = (code: string) =>
              accountGroups.find(g => g.id === accountCodes.find(c => c.code === code)?.groupId)?.type;
            const itemCodes = allocations.flatMap(({ stmt }) => (stmt.items ?? []).map(i => i.accountCode).filter(Boolean) as string[]);
            const payCode = settlementAccountCode(first.type, itemCodes, groupTypeOf);
            out.push({
              id: 'preview-offset', ...(payCode ? { accountCode: payCode } : {}),
              date: quickPayDate, cashAccountId: quickPayAccountId,
              dir: first.type === '매입' ? '출금' : '입금',
              amount: allocations.reduce((a, x) => a + x.amount, 0),
              note: quickPayNote.trim() || `${first.partnerName ?? ''} ${first.type === '매입' ? '지불' : '수금'}`.trim(),
              createdAt: '',
            } as CashEntry);
          }
          if (plainAmt > 0) {
            out.push({
              id: 'preview-plain', dir: qpDir, amount: plainAmt,
              ...(cashSplitOk ? { lines: cashSplitLines } : qpAccountCode ? { accountCode: qpAccountCode } : {}),
              date: quickPayDate, cashAccountId: quickPayAccountId,
              note: quickPayNote.trim(), createdAt: '',
            } as CashEntry);
          }
          return out;
        };

        /**
         * 쪼갠 줄 — 계정이 붙고 금액이 있는 줄만. 합이 통장에서 움직인 금액(plainAmt)과 같아야 끊는다.
         * 안 맞는 전표는 시산표를 조용히 망가뜨린다(발생 쪽 차·대 검사와 같은 이유).
         */
        const cashSplitLines = qpSplitOn
          ? qpCashRows
              .map(r => ({ accountCode: r.accountCode ?? '', amount: Number(r.price || 0), note: r.note.trim() || undefined }))
              .filter(l => l.accountCode && l.amount > 0)
          : [];
        const cashSplitSum = cashSplitLines.reduce((a, l) => a + l.amount, 0);
        const cashSplitOk = qpSplitOn && cashSplitLines.length > 0 && Math.abs(cashSplitSum - plainAmt) < 0.5;

        const canSave = qpDir === '회사이체' ? (advAmt > 0 && !!onAddForCompany)
          : !isCashDir(qpDir) ? (accrLines.length > 0 && accrBalanced)   // 차·대가 맞아야 끊는다
          : qpMode === '상환' ? (prin > 0 || intr > 0)
          : qpMode === '보험' ? insTotal > 0
          : qpMode === '세금' ? taxTotal > 0
          : qpMode === '급여' ? (grs > 0 && ded >= 0 && net >= 0)
          // 일반: 전액 상계면 계정 불필요. 쪼갠 줄을 켰으면 합이 맞아야, 아니면 계정 하나 필수
          : (amt > 0 && (offsetAmt >= amt || (qpSplitOn ? cashSplitOk : !!qpAccountCode)));

        const handleQuickPaySave = () => {
          if (qpDir === '회사이체') { doTransferSave(); return; }
          if (!isCashDir(qpDir)) { if (accrBalanced) doAccrualSave(); return; }
          if (qpMode === '상환') { if (prin > 0 || intr > 0) doLoanSave(); return; }
          if (qpMode === '보험') { doInsuranceSave(); return; }
          if (qpMode === '세금') { doTaxSave(); return; }
          if (qpMode === '급여') { if (grs > 0 && ded >= 0 && net >= 0) doSalarySave(); return; }
          if (!canSave) return;
          // 상계 초과분(줄돈/받을돈 전환) 경고 — 거래처 있고 상계보다 많은데 계정도 없으면 canSave가 막음
          doGeneralSave();
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => { setShowQuickPay(false); setQuickPayOverWarn(false); }}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* 방향은 제목 줄에 둔다 — 들어오는 돈과 나가는 돈은 쓰는 계정이 아예 달라서
                  고를 수 있는 전표가 통째로 바뀐다. */}
              <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 shrink-0">
                <h3 className="text-sm font-black text-slate-800 shrink-0">일반전표 발행</h3>
                {/* 일자는 제목 옆에 — 전표를 끊을 때 제일 먼저 확인하는 값이라 맨 위에 둔다 */}
                <input type="date" value={quickPayDate} onChange={e => setQuickPayDate(e.target.value)}
                  className="shrink-0 border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                {/* 출금·입금은 돈이 움직인 것, 발생은 안 움직인 것(채무 발생·대체).
                    표준 전표 체계의 출금·입금·대체와 같은 갈래다. */}
                <div className="flex gap-1 ml-auto flex-wrap justify-end">
                  {VOUCHER_DIRS.map(d => (
                    <button key={d} type="button"
                      onClick={() => { setQpDir(d); setQpMode('일반'); setQpAccountCode(''); setQuickPayClientId(''); setQuickPayClientSearch(''); }}
                      title={DIR_HINT[d]}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${qpDir === d
                        ? `${DIR_CHIP[d]} border-transparent shadow-sm`
                        : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                      {d}
                    </button>
                  ))}
                </div>
                <button onClick={() => { setShowQuickPay(false); setQuickPayOverWarn(false); }}
                  className="p-1.5 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all shrink-0"><X size={18}/></button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">

              {/* 기본은 직접입력. 목록은 고를 때만 창을 열어 보여준다 —
                  늘 펼쳐 두면 정작 금액 칸이 아래로 밀린다. */}
              {(() => {
                const cur = currentTemplate(qpTemplates);
                const picked = !!cur && !cur.id.startsWith('free');
                return (
                  <button type="button" onClick={() => setQpPickerOpen(true)}
                    className={`w-full flex items-center gap-2 px-4 py-3 rounded-xl border text-left transition-all ${
                      picked ? 'bg-indigo-50 border-indigo-200 hover:border-indigo-400' : 'bg-slate-50 border-slate-200 hover:border-slate-400'
                    }`}>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0">전표</span>
                    <span className={`text-sm font-black truncate ${picked ? 'text-indigo-700' : 'text-slate-600'}`}>{cur?.label ?? '직접입력'}</span>
                    {cur && <span className="text-[10px] font-bold text-slate-400 truncate">{cur.hint ?? `${cur.accountCode} ${codeName.get(cur.accountCode ?? '') ?? ''}`}</span>}
                    <span className="ml-auto text-[11px] font-black text-indigo-600 shrink-0">템플릿 ▾</span>
                  </button>
                );
              })()}

              {/* 계좌 + 일자 */}
              {/* 비현금 갈래는 통장이 안 움직이므로 계좌 칸을 안 띄운다 */}
              {isCashDir(qpDir) && (
                <div className="w-1/2 pr-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">계좌</label>
                  <select value={quickPayAccountId} onChange={e => setQuickPayAccountId(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300">
                    {activeCashAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}

              {qpDir === '회사이체' ? (
                <>
                  {/* 회사 간 이체 — 별도 사업자끼리 돈을 옮기는 것. 비용이 아니라 빌려주는 것이다.
                      그 돈으로 뭘 샀는지는 **받은 회사 장부에서 평범한 출금**으로 따로 적는다. */}
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">보내는 곳 → 받는 곳</label>
                    <div className="flex items-center gap-2">
                      <span className="flex-1 px-3 py-2.5 rounded-xl bg-slate-100 text-sm font-black text-slate-600 text-center">
                        {COMPANIES.find(c => c.id === companyId)?.name}
                      </span>
                      <span className="text-slate-300 font-black">→</span>
                      <select value={qpAdvCompany} onChange={e => setQpAdvCompany(e.target.value as CompanyId)}
                        className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-purple-300">
                        {COMPANIES.filter(c => c.id !== companyId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">금액</label>
                    <div className="relative">
                      <input inputMode="numeric" placeholder="0" value={qpAdvAmount}
                        onChange={e => setQpAdvAmount(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl pl-3 pr-9 py-3 text-right text-2xl font-black tabular-nums outline-none focus:ring-2 focus:ring-purple-300"/>
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-300 pointer-events-none">원</span>
                    </div>
                  </div>
                  {/* 밀린 미지급부터 턴다 — 무턱대고 대여금으로 잡으면 미지급이 영영 안 준다 */}
                  {advPayable > 0 && (
                    <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] font-bold text-slate-500 leading-snug">
                      {advTargetName}에 밀린 미지급 <b className="text-rose-600 tabular-nums">{fmt(advPayable)}원</b>
                      <button type="button" onClick={() => setQpAdvAmount(String(Math.round(advPayable)))}
                        className="ml-1.5 text-indigo-600 hover:underline">— 눌러서 채우기</button>
                    </div>
                  )}
                  {advAmt > 0 && (
                    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden text-[11px] font-bold">
                      {advSplit.offset > 0 && (
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-slate-500">미지급 상계</span>
                          <span className="tabular-nums text-slate-800">{fmt(advSplit.offset)}</span>
                        </div>
                      )}
                      {advSplit.over > 0 && (
                        <div className="px-3 py-2 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">넘는 몫</span>
                            <span className="tabular-nums text-slate-800">{fmt(advSplit.over)}</span>
                          </div>
                          <div className="flex gap-1.5">
                            {(['선급금', '대여금'] as const).map(k => (
                              <button key={k} type="button" onClick={() => setQpAdvOver(k)}
                                title={k === '선급금' ? '물건을 받을 것 — 매입전표가 끊기면 저절로 상계된다' : '돈으로 돌려받을 것'}
                                className={`flex-1 py-1.5 rounded-lg text-[11px] font-black border transition-all ${qpAdvOver === k
                                  ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                                {k}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="rounded-xl bg-purple-50 text-purple-700 px-3 py-2.5 text-[11px] font-bold leading-snug">
                    밀린 미지급부터 털고, 넘는 몫만 {qpAdvOver}으로 잡습니다. <b>비용이 아닙니다.</b>
                    <br/>그 돈으로 무엇을 샀는지는 <b>{advTargetName} 장부</b>에서 따로 적으세요.
                  </div>
                </>
              ) : !isCashDir(qpDir) ? (
                <>
                  {/* 발생 — 돈이 안 움직인다. 거래처를 고르면 매입전표(미지급금이 선다),
                      안 고르면 대체전표(감가상각·퇴직충당). 어느 전표인지는 앱이 정한다. */}
                  <div className="relative">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
                      거래처 <span className="normal-case text-slate-300">(고르면 미지급금이 섭니다 · 비우면 순수 대체)</span>
                    </label>
                    <input type="text" placeholder="업체명 검색..."
                      value={selectedClientObj ? selectedClientObj.name : quickPayClientSearch}
                      onFocus={onPartnerFocus}
                      onChange={e => { setQuickPayClientSearch(e.target.value); setQuickPayClientId(''); setQuickPayDropOpen(true); }}
                      onBlur={() => setTimeout(() => setQuickPayDropOpen(false), 150)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-amber-300"/>
                    {quickPayDropOpen && dropClients.length > 0 && (
                      <div className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-10 overflow-hidden">
                        {dropClients.map(c => (
                          <button key={c.id}
                            onMouseDown={() => { setQuickPayClientId(c.id); setQuickPayClientSearch(''); setQuickPayDropOpen(false); }}
                            className="w-full text-left px-3 py-2.5 text-xs font-black text-slate-800 hover:bg-amber-50 transition-colors border-b border-slate-50 last:border-0">
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">계정 · 금액</label>
                    {qpAccrRows.map((r, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        {/* 차·대는 **대체전표에만** 있다. 매입전표(거래처 있음)는 갈래가 이미 정한다
                            — 품목은 차변, 미지급금은 대변. 3전표제에서 대체만 칸이 있는 이유다. */}
                        {!quickPayClientId && qpShowSides && (
                          <div className="flex shrink-0 rounded-lg overflow-hidden border border-slate-200">
                            {(['차변', '대변'] as const).map(sd => (
                              <button key={sd} type="button"
                                onClick={() => setQpAccrRows(prev => prev.map((x, i) => i === idx ? { ...x, side: sd } : x))}
                                className={`px-2 py-2 text-[11px] font-black transition-all ${
                                  r.side === sd
                                    ? sd === '차변' ? 'bg-slate-700 text-white' : 'bg-amber-500 text-white'
                                    : 'bg-white text-slate-300 hover:text-slate-500'
                                }`}>{sd}</button>
                            ))}
                          </div>
                        )}
                        {!quickPayClientId && !qpShowSides && (
                          <span className={`shrink-0 w-8 text-center text-[11px] font-black ${
                            r.side === '차변' ? 'text-slate-500' : 'text-amber-600'}`}>{r.side}</span>
                        )}
                        <input value={r.name} placeholder="적요 (비우면 계정명)"
                          onChange={e => setQpAccrRows(prev => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                          className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-amber-300"/>
                        <select value={r.accountCode || ''}
                          onChange={e => setQpAccrRows(prev => prev.map((x, i) => i === idx ? { ...x, accountCode: e.target.value || undefined } : x))}
                          className="w-36 shrink-0 border border-slate-200 rounded-lg px-1.5 py-2 text-[11px] font-bold bg-slate-50 outline-none focus:ring-2 focus:ring-amber-300">
                          <option value="">계정 —</option>
                          {(quickPayClientId ? expenseCodes : expCodes).map(ac => <option key={ac.id} value={ac.code}>{ac.code} {ac.name}</option>)}
                        </select>
                        <input value={r.price} placeholder="금액" inputMode="numeric"
                          onChange={e => setQpAccrRows(prev => prev.map((x, i) => i === idx ? { ...x, price: e.target.value.replace(/[^\d]/g, '') } : x))}
                          className="w-28 shrink-0 border border-slate-200 rounded-lg px-2 py-2 text-sm font-black text-right tabular-nums outline-none focus:ring-2 focus:ring-amber-300"/>
                        {qpAccrRows.length > 1 && (
                          <button type="button" onClick={() => setQpAccrRows(prev => prev.filter((_, i) => i !== idx))}
                            className="shrink-0 text-slate-300 hover:text-rose-400"><X size={14}/></button>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => setQpAccrRows(prev => [...prev, { name: '', price: '', side: prev.length % 2 ? '대변' : '차변' }])}
                        className="flex items-center gap-1 text-xs font-black text-slate-500 hover:text-slate-700">
                        <Plus size={12} strokeWidth={3}/>행 추가
                      </button>
                      {/* 차·대가 맞아야 끊을 수 있다 — 안 맞는 전표는 시산표를 조용히 망가뜨린다 */}
                      {!quickPayClientId && !qpShowSides && (
                        <button type="button" onClick={() => setQpShowSides(true)}
                          className="text-[11px] font-black text-slate-300 hover:text-slate-500">차·대 고치기</button>
                      )}
                      {!quickPayClientId && (accrDebit > 0 || accrCredit > 0) && (
                        <span className={`ml-auto text-[11px] font-black tabular-nums ${
                          accrBalanced ? 'text-emerald-600' : 'text-rose-500'}`}>
                          차 {fmt(accrDebit)} · 대 {fmt(accrCredit)}
                          {accrBalanced ? ' ✓' : ` · 차이 ${fmt(accrDebit - accrCredit)}`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={`rounded-xl px-3 py-2.5 text-[11px] font-bold leading-snug ${qpDir === '대체' ? 'bg-slate-50 text-slate-500' : 'bg-amber-50 text-amber-700'}`}>
                    {quickPayClientId
                      ? <>매입전표로 끊습니다 — <b>{selectedClientObj?.name}</b> 미지급금이 {fmt(accrTotal)}원 늘어납니다. 실제로 낼 때 거래처 화면에서 [지불]하세요.</>
                      : <>대체전표로 끊습니다 — 차·대를 직접 세웁니다(감가상각비·퇴직급여충당금). 손익에는 잡히고 현금흐름에서는 순이익에 다시 가산됩니다.</>}
                  </div>
                </>
              ) : qpMode === '일반' ? (
                <>
                  {/* 거래처 (선택) */}
                  <div className="relative">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">거래처 <span className="normal-case text-slate-300">(선택 · {qpDir === '입금' ? '매출 미수 상계' : '매입 미지급 상계'})</span></label>
                    <input type="text" placeholder="업체명 검색..."
                      value={selectedClientObj ? selectedClientObj.name : quickPayClientSearch}
                      onFocus={onPartnerFocus}
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

                  {/* 금액 — 제일 자주 손대는 칸이라 글씨는 크게, 대신 폭은 절반만.
                      칸이 화면 끝까지 늘어나면 숫자와 단위가 멀어져 오히려 읽기 나쁘다. */}
                  <div className="w-1/2 pr-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">금액</label>
                    <div className="relative">
                      <input type="text" inputMode="numeric" placeholder="0" value={quickPayAmount}
                        onChange={e => setQuickPayAmount(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl pl-3 pr-9 py-3 text-right text-2xl font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-300 pointer-events-none">원</span>
                    </div>
                  </div>

                  {/* 상계 안내 */}
                  {offsetAmt > 0 && (
                    <div className="text-[11px] font-bold text-slate-500 bg-slate-50 rounded-xl px-3 py-2 leading-snug">
                      {fmt(offsetAmt)}원은 {selectedClientObj?.name}의 {qpDir === '입금' ? '미수금' : '미지급금'} 상계.
                      {plainAmt > 0 && <> 남는 <b className="text-slate-700">{fmt(plainAmt)}원</b>은 아래 계정과목의 자금으로 잡힙니다.</>}
                    </div>
                  )}

                  {/* 계정과목 — 전액 상계일 때만 자리를 비운다.
                      전엔 `plainAmt > 0`이라 **금액을 넣기 전에도 숨었다**. 템플릿으로 계정을 고르고도
                      그게 뭔지 안 보이니 매번 확인이 안 됐다. 금액이 0이면 그냥 빈 채로 보여 준다. */}
                  {amt > 0 && plainAmt <= 0 ? (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 text-[11px] font-bold text-slate-500">
                      전액 {selectedClientObj?.name} {qpDir === '입금' ? '미수' : '미지급'} 상계라 계정과목이 필요 없습니다
                      <span className="text-slate-400"> — {qpDir === '입금' ? '외상매출금' : '외상매입금'}이 그만큼 줄어듭니다.</span>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">계정과목 <span className="text-rose-400">*</span> <span className="normal-case text-slate-300">({qpDir === '입금' ? '이 돈의 성격' : '전기·임대·기계구입 등'})</span></label>
                        {/* 한 번 나간 돈의 성격이 둘 이상일 때 — 통장 쪽은 dir이 정하므로 반대편만 줄로 적는다 */}
                        <button type="button" onClick={() => setQpSplitOn(v => !v)}
                          className={`text-[11px] font-black transition-colors ${qpSplitOn ? 'text-emerald-600' : 'text-slate-300 hover:text-slate-500'}`}>
                          {qpSplitOn ? '한 계정으로' : '여러 계정으로 쪼개기'}
                        </button>
                      </div>
                      {!qpSplitOn ? (
                        <>
                          <select value={qpAccountCode} onChange={e => setQpAccountCode(e.target.value)}
                            className={`w-full border rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300 ${qpAccountCode ? 'border-slate-200' : 'border-amber-300 bg-amber-50'}`}>
                            <option value="">— 선택하세요 —</option>
                            {expenseCodes.map(c => <option key={c.id} value={c.code}>{c.code} · {c.name}</option>)}
                          </select>
                          {!qpAccountCode && <p className="text-[10px] font-bold text-amber-600 mt-1">계정과목이 없으면 손익·현금흐름 어디에도 못 잡힙니다.</p>}
                        </>
                      ) : (
                        <div className="space-y-2">
                          {qpCashRows.map((r, idx) => (
                            <div key={idx} className="flex items-center gap-1.5">
                              <input value={r.note} placeholder="적요 (비우면 계정명)"
                                onChange={e => setQpCashRows(prev => prev.map((x, i) => i === idx ? { ...x, note: e.target.value } : x))}
                                className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                              <select value={r.accountCode || ''}
                                onChange={e => setQpCashRows(prev => prev.map((x, i) => i === idx ? { ...x, accountCode: e.target.value || undefined } : x))}
                                className="w-36 shrink-0 border border-slate-200 rounded-lg px-1.5 py-2 text-[11px] font-bold bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-300">
                                <option value="">계정 —</option>
                                {expenseCodes.map(c => <option key={c.id} value={c.code}>{c.code} {c.name}</option>)}
                              </select>
                              <input value={r.price} placeholder="금액" inputMode="numeric"
                                onChange={e => setQpCashRows(prev => prev.map((x, i) => i === idx ? { ...x, price: e.target.value.replace(/[^\d]/g, '') } : x))}
                                className="w-28 shrink-0 border border-slate-200 rounded-lg px-2 py-2 text-sm font-black text-right tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                              {qpCashRows.length > 1 && (
                                <button type="button" onClick={() => setQpCashRows(prev => prev.filter((_, i) => i !== idx))}
                                  className="shrink-0 text-slate-300 hover:text-rose-400"><X size={14}/></button>
                              )}
                            </div>
                          ))}
                          <div className="flex items-center justify-between gap-3">
                            <button type="button" onClick={() => setQpCashRows(prev => [...prev, { note: '', price: '' }])}
                              className="flex items-center gap-1 text-xs font-black text-slate-500 hover:text-slate-700">
                              <Plus size={12} strokeWidth={3}/>행 추가
                            </button>
                            {/* 합이 통장에서 움직인 금액과 같아야 끊는다 — 안 맞는 전표는 시산표를 조용히 망가뜨린다 */}
                            <span className={`text-[11px] font-black tabular-nums ${cashSplitOk ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {cashSplitOk
                                ? `합 ${fmt(cashSplitSum)} — 맞음`
                                : `합 ${fmt(cashSplitSum)} / 통장 ${fmt(plainAmt)}  (${cashSplitSum > plainAmt ? '초과' : '부족'} ${fmt(Math.abs(plainAmt - cashSplitSum))})`}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : qpMode === '보험' ? (
                <>
                  {/* 4대보험 — 통장에서 한 번 나가지만 성격이 둘이다.
                      회사부담분은 비용(530), 근로자부담분은 급여에서 떼어 맡아둔 예수금(254)을 터는 것.
                      전액을 530으로 몰면 비용이 부풀고 예수금이 영영 안 줄어든다. */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">회사부담 <span className="normal-case text-slate-300">(비용)</span></label>
                      <input inputMode="numeric" value={qpInsCorp} placeholder="0"
                        onChange={e => setQpInsCorp(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">근로자부담 <span className="normal-case text-slate-300">(예수금)</span></label>
                      <input inputMode="numeric" value={qpInsEmp} placeholder="0"
                        onChange={e => setQpInsEmp(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                  </div>
                  {/* 아직 안 낸 원천공제 — 근로자부담분은 보통 이 잔액만큼 나간다 */}
                  {(() => {
                    const held = heldWithholding;
                    return held > 0 ? (
                      <button type="button" onClick={() => setQpInsEmp(String(Math.round(held)))}
                        className="w-full text-left rounded-xl bg-slate-50 hover:bg-indigo-50 px-3 py-2 text-[11px] font-bold text-slate-500 transition-colors">
                        아직 안 낸 원천공제 <b className="text-slate-800 tabular-nums">{fmt(held)}원</b>
                        <span className="text-indigo-500 ml-1">— 눌러서 채우기</span>
                      </button>
                    ) : null;
                  })()}
                  <div className="flex items-center justify-between rounded-xl px-3 py-2 text-[11px] font-black bg-slate-50 text-slate-500">
                    <span>통장에서 나가는 총액</span>
                    <span className="tabular-nums text-slate-800">{fmt(insTotal)}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    회사부담은 <b>비용</b>, 근로자부담은 급여에서 떼어 맡아둔 <b>예수금</b>을 터는 것입니다.
                    한 건으로 끊고 안에서 두 줄로 갈립니다.
                  </p>
                </>
              ) : qpMode === '세금' ? (
                <>
                  {/* 부가세·소득세를 한 번에 내도 성격이 다르다.
                      부가세는 손님한테 받아 맡아둔 돈이라 부채(255)를 터는 것이고,
                      종합소득세는 사업이 아니라 사장님 개인에게 매기는 세금이라 인출금(338)이다.
                      비용으로 몰면 이익이 그만큼 줄어 보이고 부가세예수금이 영영 안 줄어든다. */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">부가세 <span className="normal-case text-slate-300">(부가세예수금)</span></label>
                      <input inputMode="numeric" value={qpVat} placeholder="0"
                        onChange={e => setQpVat(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-right text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">소득세 <span className="normal-case text-slate-300">(인출금)</span></label>
                      <input inputMode="numeric" value={qpIncomeTax} placeholder="0"
                        onChange={e => setQpIncomeTax(e.target.value.replace(/[^\d,]/g, ''))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-right text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                  </div>
                  {/* 아직 안 낸 부가세 — 맡아둔 예수금 잔액. 보통 이 금액만큼 나간다 */}
                  {(() => {
                    const code = accountCodes.find(c => c.name === '부가세예수금')?.code ?? '255';
                    const held = cashEntries.reduce((a, e) => {
                      const parts = (e.lines ?? []).filter(l => l.accountCode === code);
                      const v = parts.length ? parts.reduce((b, l) => b + l.amount, 0) : (e.accountCode === code ? e.amount : 0);
                      if (!v) return a;
                      return a + (e.dir === '입금' ? v : -v);
                    }, 0);
                    return held > 0 ? (
                      <button type="button" onClick={() => setQpVat(String(Math.round(held)))}
                        className="w-full text-left rounded-xl bg-slate-50 hover:bg-emerald-50 px-3 py-2 text-[11px] font-bold text-slate-500 transition-colors">
                        아직 안 낸 부가세 <b className="text-slate-800 tabular-nums">{fmt(held)}원</b>
                        <span className="text-emerald-600 ml-1">— 눌러서 채우기</span>
                      </button>
                    ) : null;
                  })()}
                  <div className="flex items-center justify-between rounded-xl px-3 py-2 text-[11px] font-black bg-slate-50 text-slate-500">
                    <span>한 번에 내는 총액</span>
                    <span className="tabular-nums text-slate-800">{fmt(taxTotal)}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    둘 다 <b>비용이 아닙니다.</b> 부가세는 받아서 맡아둔 돈을 넘기는 것이고,
                    종합소득세는 사장님 개인 세금이라 <b>인출금</b>입니다. 한 건으로 끊고 안에서 두 줄로 갈립니다.
                  </p>
                </>
              ) : qpMode === '상환' ? (
                <>
                  {/* 은행 — 원금·이자 두 줄 모두에 붙는다. 어느 대출인지 나중에 못 찾으면 소용없다. */}
                  <div className="relative">
                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">은행 <span className="text-slate-300">(선택)</span></label>
                    <input type="text" placeholder="은행명 검색..."
                      value={selectedClientObj ? selectedClientObj.name : quickPayClientSearch}
                      onFocus={onPartnerFocus}
                      onChange={e => { setQuickPayClientSearch(e.target.value); setQuickPayClientId(''); setQuickPayDropOpen(true); }}
                      onBlur={() => setTimeout(() => setQuickPayDropOpen(false), 150)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                    {quickPayDropOpen && dropClients.length > 0 && (
                      <div className="absolute left-0 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-10 overflow-hidden">
                        {dropClients.map(c => (
                          <button key={c.id}
                            onMouseDown={() => { setQuickPayClientId(c.id); setQuickPayClientSearch(''); setQuickPayDropOpen(false); }}
                            className="w-full text-left px-3 py-2.5 text-xs hover:bg-emerald-50 transition-colors border-b border-slate-50 last:border-0 font-black text-slate-800">
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">대출 계정 <span className="text-rose-400">*</span></label>
                    <select value={qpLoanCode} onChange={e => setQpLoanCode(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300">
                      {(loanAccounts.length ? loanAccounts : [{ id: '293', code: '293', name: '장기차입금' }, { id: '260', code: '260', name: '단기차입금' }]).map(c => (
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

              {/* 비고 — 비현금 갈래(대체·줄돈)에는 안 띄운다.
                  그쪽은 전표라 적요가 '계정 · 금액' 줄에 붙고, 여기 적은 글은 저장되지 않는다.
                  안 남는 칸을 띄워 두면 적어 놓고 사라진 줄 모른다. */}
              {(isCashDir(qpDir) || qpDir === '회사이체') && (
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">비고</label>
                  <input type="text" placeholder={qpMode === '일반' ? '예: 7월 전기요금' : qpMode === '상환' ? '예: 기업은행 시설자금' : '예: 7월 급여'}
                    value={quickPayNote} onChange={e => setQuickPayNote(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-300"/>
                </div>
              )}

              {/* ── 이렇게 분개됩니다 ──
                  자금전표는 성격계정 하나만 고르면 나머지 한 변(통장)은 자동이라, 무엇이 어디로
                  잡히는지 저장 전에는 안 보였다. 계정을 잘못 고르면 손익이 통째로 어긋나는 화면이라
                  **저장 버튼 바로 위에서** 결과를 먼저 보여 준다. 저장 경로와 같은 함수로 만든다. */}
              {/* 발생은 자금전표가 아니라 매입·대체전표라 미리보기를 따로 만든다 */}
              {!isCashDir(qpDir) && accrLines.length > 0 && (() => {
                const preview: IssuedStatement = {
                  id: 'preview-accr', issuedAt: '', tradeDate: quickPayDate,
                  type: accrType,
                  partnerId: quickPayClientId || '', partnerName: quickPayClientId ? (selectedClientObj?.name ?? '') : (accrLines[0].name || '대체'),
                  orderId: '', docNo: '',
                  totalSupply: accrTotal, totalTax: 0, totalAmount: accrTotal, items: accrLines,
                } as IssuedStatement;
                const je = accrType === '비용' ? journalizeTransfer(preview, normalOf) : journalizeStatement(preview);
                return (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 overflow-hidden">
                    <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">이렇게 분개됩니다</span>
                      <span className="text-[10px] font-bold text-amber-600">{accrType === '비용' ? '대체전표' : `${accrType}전표`}</span>
                    </div>
                    <div className="px-4 py-2.5">
                      {je ? renderJournal(je) : (
                        <p className="text-[11px] font-black text-amber-600">
                          차·대가 안 맞거나 상대계정이 없어 분개를 만들 수 없습니다 — 계정과목 설정을 확인하세요.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {(() => {
                const entries = previewEntries();
                if (!entries.length) return null;
                return (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 overflow-hidden">
                    <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">이렇게 분개됩니다</span>
                      {entries.length > 1 && <span className="text-[10px] font-bold text-slate-400">자금전표 {entries.length}건</span>}
                    </div>
                    <div className="divide-y divide-slate-200">
                      {entries.map(e => {
                        const je = journalizeCashEntry(e);
                        return (
                          <div key={e.id} className="px-4 py-2.5">
                            {je ? (
                              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                <div className="grid grid-cols-[42px_1fr_100px_100px] bg-slate-100 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                  <span className="px-2 py-1.5">구분</span>
                                  <span className="px-2 py-1.5">계정</span>
                                  <span className="px-2 py-1.5 text-right">차변</span>
                                  <span className="px-2 py-1.5 text-right">대변</span>
                                </div>
                                {je.lines.map((l, i) => (
                                  <div key={i} className="grid grid-cols-[42px_1fr_100px_100px] border-t border-slate-50 text-[11px]">
                                    <span className={`px-2 py-1.5 font-black ${l.debit ? 'text-slate-600' : 'text-slate-400'}`}>{l.debit ? '차변' : '대변'}</span>
                                    <span className="px-2 py-1.5 font-bold text-slate-700 truncate">
                                      <span className="text-slate-400 font-mono mr-1">{l.accountCode}</span>{codeName.get(l.accountCode) ?? ''}
                                    </span>
                                    <span className="px-2 py-1.5 text-right font-black tabular-nums text-slate-700">{l.debit ? fmt(l.debit) : ''}</span>
                                    <span className="px-2 py-1.5 text-right font-black tabular-nums text-slate-700">{l.credit ? fmt(l.credit) : ''}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] font-black text-amber-600">
                                계정과목이 없어 분개를 만들 수 없습니다 — 손익·재무제표 어디에도 안 잡힙니다.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 지금 입력한 그대로를 템플릿으로 굳힌다 — 이름·거래처·금액·계정까지.
                  매달 같은 곳에 같은 금액을 넣는 전표가 대부분이라 다음 달엔 고르기만 하면 된다. */}

              <div className="flex gap-2 pt-1">
              {onAddFixedCostTemplate && (
                <button
                  onClick={async () => {
                    const cur = currentTemplate(qpTemplates);
                    const suggest = quickPayNote.trim()
                      || (qpAccountCode ? codeName.get(qpAccountCode) ?? '' : '')
                      || (cur && !(cur.builtin ?? '').startsWith('free') ? cur.label : '');
                    const name = window.prompt('템플릿 이름을 정하세요.\n\n다음부터 [템플릿]에서 고르면\n계정·거래처·금액이 한 번에 채워집니다.', suggest);
                    if (name === null) return;
                    if (!name.trim()) { alert('이름을 입력하세요.'); return; }
                    const group = window.prompt('묶음 이름(비우면 분류없음)', cur?.group || '');
                    if (group === null) return;
                    await onAddFixedCostTemplate({
                      name: name.trim(), amount: amt > 0 ? amt : 0, category: '기타',
                      active: false, kind: 'voucher', hidden: false,
                      group: group.trim() || '분류없음',
                      dir: qpDir, mode: qpMode,
                      ...(qpAccountCode ? { accountCode: qpAccountCode } : {}),
                      ...(quickPayClientId ? { partnerId: quickPayClientId, partnerName: selectedClientObj?.name ?? '' } : {}),
                      ...(quickPayNote.trim() ? { note: quickPayNote.trim() } : {}),
                    } as any);
                    alert(`'${name.trim()}' 템플릿으로 저장했습니다.\n\n정기비용 화면에서 이름·거래처·금액을 고치거나 숨길 수 있습니다.`);
                  }}
                  className="shrink-0 px-3 py-2 rounded-lg border border-dashed border-slate-300 text-slate-500 text-[11px] font-black whitespace-nowrap hover:border-indigo-400 hover:text-indigo-600 transition-all flex items-center justify-center gap-1">
                  <Save size={11}/>템플릿 저장
                </button>
              )}
                <button onClick={() => { setShowQuickPay(false); setQuickPayOverWarn(false); }}
                  className="shrink-0 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
                <button onClick={handleQuickPaySave} disabled={!canSave}
                  className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
                  <Save size={12}/>저장
                </button>
              </div>

              </div>
            </div>

            {qpPickerOpen && (
              <CashTemplateModal
                templates={qpTemplates} accountCodes={accountCodes}
                activeId={currentTemplate(qpTemplates)?.id ?? null}
                onPick={pickTemplate}
                onDirect={() => { setQpTemplateId(null); setQpMode('일반'); setQpAccountCode(''); setQuickPayClientId(''); setQuickPayClientSearch(''); setQpPickerOpen(false); }}
                onClose={() => setQpPickerOpen(false)}
              />
            )}
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
                <button onClick={()=>{if(window.confirm('이 전표를 삭제하시겠습니까?')){deleteStatement(detailStmt.id);setDetailStmt(null);}}}
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
                      <td className="border border-slate-200 px-3 py-2 text-[11px] text-center font-bold text-slate-700">{item.spec}</td>
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
              {/* 양변 전표는 매출도 매입도 아니다 — 차·대를 직접 세운 일반전표다 */}
              <span className={`text-xs font-black px-2.5 py-1 rounded-full ${
                isTwoSided ? 'bg-amber-100 text-amber-700' : createMode==='매출'?'bg-blue-100 text-blue-700':'bg-rose-100 text-rose-700'}`}>
                {isTwoSided ? '일반' : createMode==='매출'?'매출':'매입'}전표
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
                <button onClick={()=>{setSelectedClientId('');setSelectedOrderId('');setEditablePrices({});setTaxExemptOverrides({});setManualItems([{name:'',spec:'',qty:'',price:'',isTaxExempt:false}]);setSelectedConfirmedIds([]);}}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-100 transition-all shrink-0">
                  <ChevronLeft size={12}/>거래처 변경
                </button>
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
                              const alreadyIssued = isVouchered(o);   // 목록 필터와 같은 기준
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
                    setTradeDate(today());   // 발주일이 아니라 발행하는 날
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
              const listOrders = (onlyActive ? activeOrders.filter(o => !isVouchered(o)) : activeOrders)
                // 스마트스토어 거래처 제외 (전표 발행 대상 아님)
                .filter(o => (partners.find(c => c.id === o.partnerId)?.type ?? o.source) !== '스마트스토어')
                .filter(o => matchKo(partners.find(c => c.id === o.partnerId)?.name || '', partnerSearch))
                //  납품일이 비어 있으면 배송일·생성일로 물러선다 — 옛 주문은 deliveryDate가 없는 게 많아
                //  날짜필터를 걸면 통째로 사라졌다.
                .filter(o => {
                  const d = ((o.deliveryDate || (o as { deliveredAt?: string }).deliveredAt || o.createdAt) || '').slice(0, 10);
                  return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
                });
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
                          {isVouchered(o)
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
                  return matchesSearch(docN, q) || matchesSearch(r.product!.name, q);
                });
                if (partnerMatches.length > 0) return partnerMatches;
                return allItems
                  .filter(p => !isBoxStockItem(p) && matchesSearch(p.name + ' ' + (p.품목 ?? ''), q))
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
                            const sub = bomOf(r.product!.id);
                            const 용기 = sub.find(l=>l.child?.category==='용기')?.child?.name;
                            const 마개 = sub.find(l=>l.child?.category==='마개')?.child?.name;
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
                : pickerRows.filter(r=>matchesSearch((r.product!.name)+' '+(r.product!.품목??''), q));
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
                  return [...existing,...toAdd];   // 빈 행은 안 붙인다 — 필요하면 '행 추가'
                });
                setShowItemPicker(false);setPickerSearch('');setPickerQtys({});
              };
              return (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                  onKeyDown={e=>{if(e.key==='Enter')confirmPick();if(e.key==='Escape')setShowItemPicker(false);}}>
                  {/* 크기 고정 — 검색으로 줄 수가 줄어도 창이 안 흔들린다(검색할 때 가변 크기 금지) */}
                  <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl h-[70vh] flex flex-col overflow-hidden mx-4">
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
                                <td className="px-4 py-2.5 text-[11px] font-bold text-slate-700">{r.product!.spec||''}</td>
                                {/* 단가·과세를 여기서 바로 고친다 — 따로 있던 단가관리 패널을 이 자리로 합쳤다.
                                    고르는 화면과 고치는 화면이 갈려 있으면 단가 하나 바꾸려고 창을 두 번 연다. */}
                                <td className="px-4 py-2.5" onClick={e=>e.stopPropagation()}>
                                  <div className="flex items-center gap-1 justify-end">
                                    <input type="text" inputMode="decimal" placeholder="미설정"
                                      value={pricePanelEdits[r.pc.id]??(r.pc.price!==undefined?String(r.pc.price):'')}
                                      onChange={e=>{setPricePanelEdits(prev=>({...prev,[r.pc.id]:e.target.value}));setPriceSaveState(st=>{const n={...st};delete n[r.pc.id];return n;});}}
                                      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();savePcPrice(r.pc);}}}
                                      className="w-20 text-right bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-300"/>
                                    <button type="button" onClick={()=>savePcPrice(r.pc)} disabled={priceSaveState[r.pc.id]==='saving'}
                                      title="단가 저장"
                                      className={`px-1.5 py-1 rounded-lg text-[10px] font-black text-white transition-all disabled:opacity-60 ${priceSaveState[r.pc.id]==='done'?'bg-emerald-500':priceSaveState[r.pc.id]==='error'?'bg-rose-500':'bg-violet-600 hover:bg-violet-700'}`}>
                                      {priceSaveState[r.pc.id]==='saving'?'…':priceSaveState[r.pc.id]==='done'?'✓':'저장'}
                                    </button>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-center" onClick={e=>e.stopPropagation()}>
                                  <button type="button" onClick={()=>togglePcTax(r.pc)} disabled={priceSaveState[r.pc.id]==='saving'}
                                    className={`text-[10px] font-black px-2 py-1 rounded-lg border transition-all disabled:opacity-50 ${r.pc.taxType==='면세'?'bg-indigo-500 text-white border-indigo-500':'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                                    {r.pc.taxType==='면세'?'면세':'과세'}
                                  </button>
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
                  주문 불러옴 — 박스는 낱개로 변환됨. 여기서 고쳐도 원본 주문은 안 바뀝니다
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
                            const linked = searchableRows.filter(r => matchesSearch(r.product!.name, qq));
                            if (linked.length > 0) return linked;
                            // 거래처에 등록 안 된 품목도 전체에서 검색 (반제품·원료·부자재 포함)
                            const src = createMode === '매입' ? partnerIn : partnerOut;
                            return allItems
                              .filter(p => !isBoxStockItem(p) && matchesSearch(p.name + ' ' + (p.품목 ?? ''), qq))
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
                                        const sub2 = bomOf(r.product!.id);
                                        const 용기2 = sub2.find(l=>l.child?.category==='용기')?.child?.name;
                                        const 마개2 = sub2.find(l=>l.child?.category==='마개')?.child?.name;
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
                                {ro ? <span className="font-bold text-slate-700">{row.spec}</span>
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
                              {/* 반품은 수량이 음수라 공급가·세액·합계가 다 음수다 — >0으로 걸러 세 칸이 통째로 '-'였다. */}
                              <td className="px-3 py-2 text-right text-slate-700">{sup!==0?fmt(sup):'-'}</td>
                              <td className="px-3 py-2 text-center">
                                {ro ? (
                                  <span className={`text-[10px] font-black ${row.isTaxExempt?'text-indigo-600':''}`}>
                                    {row.isTaxExempt?'면세':tax!==0?fmt(tax):'-'}
                                  </span>
                                ) : (
                                  <button onClick={e=>{e.stopPropagation();setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,isTaxExempt:!r.isTaxExempt}:r));}}
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-black border transition-all ${row.isTaxExempt?'bg-indigo-100 text-indigo-700 border-indigo-200':'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}>
                                    {row.isTaxExempt?'면세':tax!==0?fmt(tax):'-'}
                                  </button>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-black text-slate-800">{(sup+tax)!==0?fmt(sup+tax):'-'}</td>
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
                              {/* 품목을 못 찾으면 박스가 안 풀린 채 들어간다 — 발행 전에 알아야 한다 */}
                              {item.unknownItem && (
                                <span className="mt-0.5 inline-block text-[9px] font-black text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                  title="주문의 품목이 삭제됐거나 id가 바뀌었습니다. 박스 품목이면 낱개로 안 풀리니 수량·단가를 확인하세요.">
                                  품목 없음 — 수량 확인
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-[11px] font-bold text-slate-700">{item.spec}</td>
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
                        {fmt(sumOf(r => r.qty || 0))}
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
              // 수금은 거래처 단위로 자금원장에 적힌다 — 전표 한 장에 얼마가 붙었는지는
              // 오래된 전표부터 채운 결과(getBalance)로 보고, 목록은 그 거래처의 자금 움직임 그대로 띄운다.
              const bal = getBalance(editingStmt);
              const paid = editingStmt.totalAmount - bal;
              const label = editingStmt.type === '매출' ? '수금' : '지불';
              const want = editingStmt.type === '매입' ? AP : AR;
              const payments = cashEntries
                .filter(e => e.partnerId && e.partnerId === editingStmt.partnerId
                  && ((e.lines ?? []).some(l => l.accountCode === want) || e.accountCode === want))
                .sort((a, b) => a.date.localeCompare(b.date));
              return (
                <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label} 내역 <span className="normal-case text-slate-300">(거래처 기준)</span></span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-slate-500">합계 <b className="text-slate-800">{fmt(editingStmt.totalAmount)}</b></span>
                      <span className="text-slate-500">{label} <b className="text-emerald-700">{fmt(paid)}</b></span>
                      <span className={`font-black ${bal < 0 ? (editingStmt.type === '매출' ? 'text-rose-600' : 'text-blue-600') : bal === 0 ? 'text-slate-400' : (editingStmt.type === '매출' ? 'text-blue-600' : 'text-rose-600')}`}>
                        {bal < 0
                          ? `${overLabelOf(editingStmt.type)} ${fmt(Math.abs(bal))}`
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
                          <span className={`text-xs font-black flex-1 ${p.dir === '입금' ? 'text-slate-800' : 'text-rose-600'}`}>
                            {p.dir === (editingStmt.type === '매입' ? '입금' : '출금') ? '−' : ''}{fmt(p.amount)}원
                          </span>
                          <span className="text-[10px] text-slate-400 truncate">{p.note}</span>
                          <button onClick={() => openEditCash(p)}
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
                    <button onClick={()=>{if(window.confirm('이 전표를 삭제하시겠습니까?')){deleteStatement(editingStmt!.id);closeCreate();}}}
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
                  setTradeDate(today());
                  setManualMode(true);
                } else if (o) {
                  setSelectedOrderId(o.id);
                  setTradeDate(today());
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
