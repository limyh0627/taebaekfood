
import { plOfJournals } from '../src/features/admin/financials';
import { cardNoLabel } from '../src/shared/cardNo';
import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { today, dateOfLocal } from '../src/shared/day';
import { matchesSearch } from '../src/shared/hangul';
import { itemSummary } from '../src/shared/itemSummary';
import { buildTaxonomy, type TaxonomyRow } from '../src/shared/taxonomy';
import {
  FileText, Printer, Search, ChevronDown, CalendarDays,
  Package, ClipboardList, ChevronRight, CheckCircle2, Edit2, Plus, X, ArrowLeft,
  Save, Download, CheckSquare,
  ChevronLeft, Share2, Check, Wallet, RotateCw, Trash2, Landmark
} from 'lucide-react';
import * as ExcelJS from 'exceljs';
import { Order, Item, Partner, PartnerItem, OrderStatus, IssuedStatement, CompanyInfo, PaymentMethod, AccountCode, AccountGroup, CashAccount, CashEntry, Settlement, FixedCostTemplate, CompanyId } from '../types';
import { filterCodesForContext } from '../src/features/admin/financials';
import { fetchCollection } from '../src/shared/services/firebaseService';
import { partnerPriceWrites } from '../src/shared/partnerPriceSync';
import { manualLines, orderLines, lineTotals, resolveOrderItem, orderItemPrice, type LineItem, type ManualRow } from '../src/shared/statementLines';
import { withDocNames } from '../src/shared/docName';
import { 서류당사자ById } from '../src/shared/docParty';
import { partnerOrders as 거래처주문, activeOrders as 진행주문, activePartnerIds, ACTIVE_STATUSES } from '../src/shared/statementOrders';
import { rowKind as 갈래, rowCodes as 계정들, rowName as 상대이름, filterTimeline, sortTimeline, partnerNamesOf,
  classifyRow as 성격판정, timelineTotals,
  type TimelineRow, type StmtRow, type PayRow, type CashRow } from '../src/shared/timelineRows';
import { buildTimeline } from '../src/shared/timelineBuild';
import { groupByMonth as 월별묶기 } from '../src/shared/groupByMonth';
import OrderPicker from './OrderPicker';
import { STATUS_LABEL, STATUS_COLOR } from '../src/shared/orderStatusStyle';
import { weekMonday, weekSunday, monthStart, monthEnd, yearStart } from '../src/shared/day';
import { lineAmount, lineAmountOf, priceParts } from '../src/shared/lineAmount';
import { marginOf } from '../src/shared/margin';
import { splitPayment, owedNow } from '../src/shared/paymentSplit';
import { pickLines, linkWrites } from '../src/shared/itemPick';
import { useVoucherLedger } from '../src/features/admin/useVoucherLedger';
import CashEntryModal, { type CashModalMode, type SettleInput } from './voucher/CashEntryModal';
import RecurringModal from './voucher/RecurringModal';
import VoucherComposer from './voucher/VoucherComposer';
import { stampFor, timeOfLocal, issuedMs, nextDocNo, claimDocNo } from '../src/shared/voucherStamp';
import type { VoucherKind } from '../src/shared/vouchers';
import { boxDerivedUnitPrice, unpackComponent, isBoxStockItem } from '../src/shared/orderUnits';
import { bomOf } from '../src/shared/bomIndex';
import { PurchaseOrder, poLines, ExpensePreset, companyOf } from '../src/shared/types';
import VoucherSlip from '../src/shared/VoucherSlip';
import { unsettledStatements, unmatchedCash, partnerBalanceFromJournals, partnerCashParts } from '../src/features/admin/cashLedger';
import { AR, AP, journalizeStatement, journalizeTransfer, journalizeCashEntry, settlementAccountCode } from '../src/shared/autoJournal';
import { templateAccrRows } from '../src/shared/cashTemplates';
import { buildCashEditPatch, cashEditAmount, type CashEditForm, type CashEditLineDraft } from '../src/shared/cashEntryEdit';
import { PREPAID, ADVANCE_IN } from '../src/shared/interCompany';
import type { JournalEntry } from '../src/shared/types';
import { AccountModal } from './CashLedger';
import PageHeader from './PageHeader';
import { buysFrom, sellsTo } from '../src/shared/partnerRole';

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
  /** onlyId를 주면 그 템플릿 하나만 발행한다 — 줄마다 골라 낼 수 있어야 한다 */
  onGenerateRecurringCosts?: (yearMonth: string, onlyId?: string) => Promise<number>;
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
  onAddIssuedStatement?: (stmt: IssuedStatement) => void | Promise<unknown>;
  /** 지금 보고 있는 회사 — 대납은 상대 회사 장부에도 써야 한다 */
  companyId?: CompanyId;
  /** 회사를 지정해서 저장(대납 전용) — 지금 회사가 아닌 장부에 쓴다 */
  onAddForCompany?: (companyId: CompanyId, payload: { cashEntry?: CashEntry; statement?: IssuedStatement }) => void;
  onUpdateIssuedStatement?: (id: string, data: Partial<IssuedStatement>) => void | Promise<unknown>;
  onProposeEdit?: (id: string, data: Partial<IssuedStatement>, stmtType: '매출' | '매입', docNo: string, partnerName: string) => void;
  /** 거래처원장에서 전표번호를 눌러 넘어왔을 때 — 그 번호로 조회창을 연다 */
  focusDocNo?: string;
  onFocusHandled?: () => void;
  onDeleteIssuedStatement?: (id: string) => void;
  pendingInvoice?: { partnerId: string; partnerName: string; items: Array<{ itemId: string; name: string; spec: string; qty: number; price: number; isBox?: boolean }>; poIds?: string[] } | null;
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
  onUpdateItemCost?: (itemId: string, cost: number) => void | Promise<unknown>;
  onUpdateOrder?: (id: string, data: Partial<import('../types').Order>) => void;
  defaultTab?: 'history' | 'taxinvoice';
  expensePresets?: ExpensePreset[];
  onAddExpensePreset?: (p: Omit<ExpensePreset, 'id' | 'createdAt'>) => Promise<string>;
  onDeleteExpensePreset?: (id: string) => void;
}

type StatementType = '매출' | '매입' | '비용';

// 초성 검색: 한글 이름의 초성 추출 + 매칭(부분일치 or 초성일치)
const matchKo = (name: string, q: string) => matchesSearch(name, q);

/** 분류 대분류 색 — Tailwind은 클래스명을 조립하면 못 알아보므로 정적 문자열로 둔다 */
const AXIS_CLS: Record<string, string> = {
  '손익': 'bg-rose-600 text-white border-rose-600',
  '재무': 'bg-teal-600 text-white border-teal-600',
  '자금흐름': 'bg-indigo-600 text-white border-indigo-600',
};

const fmt = (n: number) => n.toLocaleString('ko-KR');
/** 인쇄 HTML에 사람이 친 글을 그대로 끼울 때 — <, & 가 태그로 새는 걸 막는다. */
const esc = (t: string) => t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

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

//  기간 빠른선택(금주·당월·당년)은 shared/day 에 있다 — 화면마다 '금주'가 다르면 안 된다

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
  focusDocNo,
  onFocusHandled,
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
  /**
   * **고른 주문들** — 여러 건을 한 전표로 묶어 끊을 수 있다.
   *
   * 같은 거래처에 이틀치 주문이 쌓이면 명세서를 두 장 끊는 게 아니라 한 장으로 보낸다.
   * 줄은 **합치지 않는다**(사장님 확정) — 같은 품목이 두 주문에 있으면 두 줄로 선다.
   * 어느 주문 몫인지 종이에서 보여야 하고, 단가가 다를 수도 있다.
   *
   * 전표의 `orderId` 는 쉼표로 이어 담는다 — 읽는 쪽이 진작 그렇게 갈라 읽고 있었다
   * (`voucherOrderIds`).
   */
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const selectedOrderId = selectedOrderIds[0] ?? '';
  const [partnerSearch, setPartnerSearch] = useState('');
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
  /** 전표 비고 — 합계 밑에 적는다. 품목이 아니라 전표 전체에 붙는 말이다. */
  const [stmtMemo, setStmtMemo] = useState('');
  /**
   * `side`가 달린 줄 = **양변 전표(일반전표)**. 기초이월·감가상각처럼 차·대를 직접 세우는 것.
   * 안 실어 나르면 저장 한 번에 side가 사라지고, autoJournal이 짐작을 안 하므로
   * 그 전표의 분개가 통째로 안 선다(미광팩 기초 미지급이 그렇게 비어 있었다).
   */
  const [manualItems, setManualItems] = useState<ManualRow[]>([
    { name: '', spec: '', qty: '', price: '', isTaxExempt: false, note: '' },
  ]);
  // ── 매입: 선택해서 불러온 발주카드 id 목록. 발행 시 이 PO들의 linkedStatementId에 전표 id 연결 + 입고대기 전환 ──
  const [loadedPoIds, setLoadedPoIds] = useState<string[]>([]);
  // 발주카드(PurchaseOrder) → 직접입력 행들로 변환 (묶음 items[] 펼침, 카드 섹션·재발행 공용)
  //
  // 매출(주문 불러오기)과 **같은 규칙으로 박스를 낱개로 푼다** — 전표는 낱개 기준이다.
  //   20개입 박스 3장 → 낱개 60개, 단가도 낱개 매입단가.
  // 예전엔 여기서 안 풀고 박스 수량·박스명을 그대로 넣은 뒤 개입수를 12로 박아 뒀다.
  // 개입수가 10·20·40인 품목이 전부 12로 잡혀 수량이 어긋났다.
  // **전표에 박스 표기는 아예 없다**(2026-09-02) — 박스로 판다면 그건 박스 품목이고
  // 재고·단가가 다 박스다. 낱개 품목의 전표에 '박스'를 적을 자리가 없다.
  const poToManualRows = (po: PurchaseOrder): ManualRow[] =>
    poLines(po).map(line => {
      //  푸는 것은 [statementLines](../src/shared/statementLines.ts) 와 같은 함수를 쓴다
      const r = resolveOrderItem({ itemId: line.itemId, name: line.name, quantity: line.quantity } as any, allItems);
      const 박스였나 = r.perBox > 1;
      // 단가는 바뀐 품목(낱개) 기준으로 다시 찾는다. 없으면 박스 단가 ÷ 개입수로 파생.
      const ps = (partnerItems ?? []).find((s: any) =>
        s.Direction === 'in' && s.itemId === (r.product?.id ?? line.itemId) && s.partnerId === selectedClientId);
      const boxPs = 박스였나 ? (partnerItems ?? []).find((s: any) =>
        s.Direction === 'in' && s.itemId === line.itemId && s.partnerId === selectedClientId) : undefined;
      const unitPrice = ps?.price ?? (boxPs?.price ? Math.round(boxPs.price / r.perBox) : undefined);
      return {
        itemId: r.product?.id ?? line.itemId,
        name: r.product?.name || line.name || '',
        spec: r.product?.spec || line.unit || '',
        qty: String(r.qty),
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
  const [quickItemId, setQuickItemId] = useState<string | undefined>();
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
  //  피커에서 "연결할까요?"에 **아니요**를 누른 품목 — 이번 전표에만 쓰고 거래처엔 안 붙인다.
  //  발행할 때 단가·계정을 거래처에 자동 저장하는 길이 따로 있어서, 여기 적어 두지 않으면
  //  아니요를 눌러도 발행하는 순간 결국 붙어 버린다.
  const [noLinkIds, setNoLinkIds] = useState<Set<string>>(new Set());

  // 현재 전표 세션에서 이미 issuedStatement에 저장했는지 추적 (인쇄 중복 방지)
  const hasIssuedRef = useRef(false);
  const saveBusyRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  // 전표 저장 뒤 단가 저장만 실패해도 재시도는 같은 전표에 쓴다. 새 ID면 중복 발행된다.
  const issueIdentityRef = useRef<{ id: string; docNo: string } | null>(null);

  /**
   * **자금 전표 창 하나** — 수금·지불도, 이미 난 전표를 고치는 것도 여기로 연다.
   * 수금은 입금이고 지불은 출금이다. 상대계정이 108·251로 정해지고 전표에 상계로
   * 붙는 것만 다르다. 창을 둘로 나누면 같은 것을 두 번 만들게 되고 한쪽만 고쳐진 채 갈린다.
   */
  const [cashModal, setCashModal] = useState<CashModalMode | null>(null);
  const [payAccountId, setPayAccountId] = useState('');
  const [quickPayAccountId, setQuickPayAccountId] = useState('');

  //  템플릿 창 — 열고 닫는 것만 화면이 쥔다. 대상 월·진행 상태는 창 안의 일이다.
  const [showRecurring, setShowRecurring] = useState(false);
  /**
   * **발행하면서 바로 수금·지불한다.** 현금·계좌로 그 자리에서 받는 거래가 많은데,
   * 전표를 끊고 목록에서 다시 찾아 수금처리를 누르는 건 같은 일을 두 번 하는 것이다.
   * 금액은 전표 총액이 기본이고 고칠 수 있다(일부만 받는 거래).
   */
  const [issuePay, setIssuePay] = useState(false);
  const [issuePayAmount, setIssuePayAmount] = useState('');


  /**
   * **고친 자금 전표를 저장한다** — 폼은 창이 쥐고, 돈이 얽힌 뒷일은 여기서 푼다.
   * 판정 자체는 shared/cashEntryEdit이 쥔다(화면 조각이라 테스트가 안 닿던 자리였다).
   */
  const saveEditCash = (entry: CashEntry, form: CashEditForm, lines: CashEditLineDraft[]) => {
    if (!onUpdateCashEntry) return;
    const amt = cashEditAmount(form, lines, entry.dir === '대체');
    if (amt <= 0) return;
    // 전표에 상계된 자금이면 상계액(settlement)도 같은 폭으로 옮겨야 미수/미지급 잔액이 안 틀어진다.
    const linked = settlements.filter(s => s.cashEntryId === entry.id);
    const delta = amt - entry.amount;
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
    const patch = buildCashEditPatch(entry, form, lines);
    onUpdateCashEntry(entry.id, patch);
    // 상계액을 방금 옮겼으면 settlements가 최신이 아니라 매칭 계산이 어긋난다 → 그때만 건너뛴다.
    if (!(linked.length && delta !== 0)) autoMatchCashToStatements({ ...entry, ...patch });
    setCashModal(null);
  };

  //  일반전표 창 — 여는 것만 화면이 쥔다. 양식 안의 값은 전부 창 안의 일이다.
  const [showQuickPay, setShowQuickPay] = useState(false);
  const openCashModal = (_dir: '입금' | '출금') => {
    setShowQuickPay(true);
    setQuickPayAccountId(prev => prev || activeCashAccounts[0]?.id || '');
  };

  const activeCashAccounts = useMemo(() => cashAccounts.filter(a => a.active), [cashAccounts]);
  const codeName = useMemo(() => new Map(accountCodes.map(c => [c.code, c.name])), [accountCodes]);

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
  //  줄의 성격(수익·비용·입금·출금)은 [shared/timelineRows](../src/shared/timelineRows.ts) 가 안다.
  //  자금전표를 **줄로** 보는 규칙이 거기 있다 — 대출상환은 원금이 아니라 이자만 비용이다.
  const classifyRow = useCallback((row: TimelineRow) => 성격판정(row, codeType), [codeType]);

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
  /** 거래처id → 이름. 전표 양식의 '거래처명' 칸이 쓴다. */
  const partnerNameById = useMemo(() => new Map(partners.map(p => [p.id, p.name])), [partners]);
  /**
   * 펼친 분개 — **표준 전표 양식**으로 그린다(거래명세서만 예외).
   * compact는 모바일 카드 안에 접어 넣는 자리라 예전 두 줄 모양 그대로 둔다.
   */
  const renderJournal = (
    je: JournalEntry | null,
    compact = false,
    meta: { kind?: string; docNo?: string; date?: string; headPartner?: string } = {},
  ) => {
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
      <VoucherSlip je={je} codeName={codeName} partnerName={partnerNameById}
        kind={meta.kind} docNo={meta.docNo} date={meta.date} headPartner={meta.headPartner} />
    );
  };
  /** 표에서 분개를 담는 줄 — 첫 칸은 비우고 나머지를 통으로 쓴다. */
  const journalTr = (
    key: string, je: JournalEntry | null,
    meta: { kind?: string; docNo?: string; date?: string; headPartner?: string } = {},
  ) => (
    <tr key={key} className="bg-slate-50/80">
      <td />
      <td colSpan={6} className="px-4 pt-1 pb-3 overflow-x-auto">{renderJournal(je, false, meta)}</td>
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
  const cashEntryById = useMemo(() => new Map(cashEntries.map(e => [e.id, e])), [cashEntries]);

  // 수금·지불은 **자금원장 한 곳**에만 적힌다. 전표에 매달던 payments[]는 2026-08-16에
  // 남은 1건까지 이관하고 걷어냈다 — 근거가 두 갈래면 같은 거래처가 화면마다 다른 잔액으로 보인다.
  //
  // 전표 한 장의 잔액은 "어느 청구서를 갚았나"가 기록에 없으므로 거래처 수금을 오래된 전표부터
  // 채워 나눈다(합계는 거래처 잔액과 같다). 자금기록이 지워진 상계는 안 친다 — 근거가 사라졌으니 안 받은 돈이다.


  /** 결제 기록 — 자금원장에 출금/입금 1건을 만든다. */
  const recordPayment = (
    allocations: { stmt: IssuedStatement; amount: number }[],
    opts: { date: string; method?: PaymentMethod; note?: string; cashAccountId?: string; pin?: boolean },
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

    /*
     * **갚을 것보다 많이 받았으면 그 초과분은 채권 상계가 아니다.**
     *
     * 매출 초과 → 259 선수금(미리 받은 돈, 부채) · 매입 초과 → 131 선급금(미리 준 돈, 자산).
     * 예전엔 전액을 108/251에 몰아서 채권·채무가 음수로 밀렸다 —
     * "안 진 빚을 갚았다"가 되는 자리다. 화면은 "초과분은 선수금으로 전환됩니다"라고
     * 적어 놓고 실제로는 안 그랬으니, 안내가 거짓말을 하고 있었다.
     *
     * 초과 판정은 **거래처 잔액**으로 한다 — 돈은 전표가 아니라 거래처 채권·채무에서 빠진다.
     */
    const isSale = first.type !== '매입';
    const pb0 = partnerBalances.get(first.partnerId);
    /**
     * **방금 끊은 전표는 아직 거래처 잔액에 안 잡혔다.**
     *
     * 거래명세서를 끊으면서 같은 클릭으로 수금하면 `partnerBalances`는 그 전표를 모른다
     * (화면 상태가 아직 안 돌았다). 그래서 받을 돈이 0으로 보이고 **전액이 초과수금**으로 갔다 —
     * 피쉬메이저 632,000이 그렇게 259 선수금에 앉았다. 같은 날 외상매출금 632,000과 함께
     * 양쪽에 남아, 상계돼야 할 것이 둘 다 살아 있었다.
     *
     * 목록에서 수금할 때는 그 전표가 이미 잔액에 있으므로 더할 게 없다(pending = 0).
     */
    const pending = allocations
      .filter(({ stmt }) => !mergedStatements.some(s => s.id === stmt.id))
      .reduce((a, { stmt }) => a + Math.max(0, Math.round(stmt.totalAmount ?? 0)), 0);
    const owed = owedNow(isSale ? pb0?.receivable : pb0?.payable, pending);
    const { settled, over } = splitPayment(total, owed);
    const overCode = isSale ? ADVANCE_IN : PREPAID;

    const entryId = `cash-${Date.now()}`;
    onAddCashEntry({
      id: entryId,
      //  초과가 없으면 예전과 똑같은 한 줄짜리 모양 — 목록·분개·수정 어디서도 안 갈린다
      ...(over > 0 && payCode
        ? { lines: [
            ...(settled > 0 ? [{ accountCode: payCode, amount: settled, note: isSale ? '미수 상계' : '미지급 상계' }] : []),
            { accountCode: overCode, amount: over, note: isSale ? '초과수금 — 선수금' : '초과지급 — 선급금' },
          ] }
        : payCode ? { accountCode: payCode } : {}),
      date: opts.date,
      cashAccountId: acctId,
      dir: first.type === '매입' ? '출금' : '입금',
      amount: total,
      ...(first.partnerId ? { partnerId: first.partnerId, partnerName: first.partnerName ?? '' } : {}),
      note: opts.note || `${first.partnerName ?? ''} ${first.type === '매입' ? '지불' : '수금'}`.trim(),
      createdAt: stampFor(opts.date),
    });
    /**
     * **누른 전표에 붙인다(settlement).**
     *
     * 안 붙이면 그 돈이 거래처 잔액에만 들어가고, allocatePartnerCash가 **오래된 전표부터**
     * 채운다 — 500,000짜리 전표에 100,000만 넣었는데 엉뚱한 옛 전표가 완납으로 잡혀
     * 그쪽 수금/지불 버튼이 사라졌다. 누른 전표에 그만큼만 붙어야 남은 금액이 남는다.
     *
     * 고아가 될 자리는 없다 — allocatePartnerCash는 `liveCash`에 있는 자금기록만 보고,
     * 자금기록을 지우면 deletePayTimelineRow가 붙은 settlement도 같이 지운다.
     */
    //  pin=false면 안 붙인다 — 그때는 오래된 전표부터 채워지는 게 사장님이 고른 뜻이다.
    if (opts.pin !== false) {
      for (const { stmt, amount } of allocations) {
        if (amount > 0) onAddSettlement?.({ id: `st-${entryId}-${stmt.id}`, cashEntryId: entryId, statementId: stmt.id, amount, createdAt: new Date().toISOString() });
      }
    }
  };

  const openPayModal = (stmt: IssuedStatement) => {
    setCashModal({ kind: '수금지불', stmt });
    setPayAccountId(prev => prev || activeCashAccounts[0]?.id || '');
  };
  const openEditCash = (entry: CashEntry) => setCashModal({ kind: '수정', entry });

  /**
   * **한 번 누르면 한 건만.** 저장은 비동기라 state가 바뀌기 전에 또 눌리면 두 건이 들어간다.
   * 자금기록 id가 `cash-${Date.now()}`라 밀리초만 달라도 다른 문서가 되어 막을 데가 없다.
   */
  const paySaving = useRef(false);
  const savePayment = (stmt: IssuedStatement, input: SettleInput) => {
    if (paySaving.current) return;
    recordPayment([{ stmt, amount: input.amount }], {
      date: input.date, method: input.method, note: input.note || undefined,
      cashAccountId: payAccountId,
      //  '거래처 잔액'을 골랐으면 전표에 안 붙인다 — 오래된 전표부터 채워진다.
      pin: input.scope === 'stmt',
    });
    paySaving.current = true;
    setCashModal(null);
    //  창이 닫힌 뒤 잠깐 잠근다 — 같은 클릭 묶음에서 두 번 새는 것만 막으면 된다
    setTimeout(() => { paySaving.current = false; }, 800);
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
    const targets = unsettledStatements(mergedStatements, settlements, { type, partnerId: entry.partnerId, cashEntries });
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
  const rowKind = 갈래;

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
  //  분류(itemTaxonomy) — 품목 선택 피커를 목록 화면과 같은 순서로 세우는 데 쓴다.
  const [taxonomyRows, setTaxonomyRows] = useState<TaxonomyRow[]>([]);
  useEffect(() => { fetchCollection<TaxonomyRow>('itemTaxonomy').then(setTaxonomyRows).catch(() => {}); }, []);
  const [acctPickerOpen, setAcctPickerOpen] = useState(false);
  const [acctQuery, setAcctQuery] = useState('');
  const [histSearch, setHistSearch] = useState('');
  /**
   * 밖에서 전표번호를 찍어 주면(거래처원장에서 번호를 누르면) 그 번호로 조회창을 연다.
   * 기간도 함께 넓힌다 — 기본 창이 최근이라, 옛 전표를 찍으면 걸러져서 안 보인다.
   */
  useEffect(() => {
    if (!focusDocNo) return;
    setHistSearch(focusDocNo);
    setHistKind('전체');
    setHistFrom('2020-01-01');
    setHistTo(today());
    onFocusHandled?.();
  }, [focusDocNo]);   // eslint-disable-line react-hooks/exhaustive-deps
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
  //  묶음(재료비·판관비…) 층 — 갈래를 고른 뒤 여기서 한 번 더 좁힌다. 계정과목은 그 다음이다.
  const [acctGroup, setAcctGroup] = useState('');
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
   * 고를 수 있는 자리 — **계정그룹(재료비·판관비…)과 계정과목**을 한 목록으로 편다.
   *
   * 그룹은 예전엔 경로 글자(`손익 › 비용 › 재료비`)로만 있어서, '재료비'로 검색하면
   * 그 밑 계정들이 낱개로 줄줄이 나올 뿐 **묶어서 고를 수가 없었다.**
   * 판정(acctHit)은 진작 `group:` 을 알아듣고 있었는데 목록에 없었을 뿐이다.
   *
   * 목록을 손으로 안 적는다. 계정·그룹을 만들면 저절로 늘어난다.
   */
  const accountItems = useMemo(() => {
    const out: { value: string; label: string; path: string; axis: '손익' | '재무'; branch: string; isGroup?: boolean; groupId?: string }[] = [];

    //  ① 계정그룹 — 그 밑 계정이 실제로 있는 것만(빈 그룹은 골라 봐야 아무것도 안 걸린다).
    //     '매출총이익'·'영업이익'처럼 계산용 그룹이 그렇다.
    const codesOfGroup = new Map<string, string[]>();
    for (const c of accountCodes) {
      const gid = groupOfCode(c.code)?.id;
      if (!gid) continue;
      (codesOfGroup.get(gid) ?? codesOfGroup.set(gid, []).get(gid)!).push(c.code);
    }
    for (const g of accountGroups) {
      const kids = codesOfGroup.get(g.id) ?? [];
      if (!kids.length) continue;
      const pl = plBranchOf(kids[0]);
      const axis: '손익' | '재무' = pl ? '손익' : '재무';
      const branch = pl ?? bsTypeOf(kids[0]) ?? '';
      if (!branch) continue;
      out.push({ value: `group:${g.id}`, label: g.name, axis, branch, isGroup: true, groupId: g.id,
        path: `${axis} › ${branch}` });
    }

    //  ② 계정과목
    const codes = [...accountCodes].sort((a, b) =>
      String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
    for (const c of codes) {
      const pl = plBranchOf(c.code);
      if (pl) {
        const g = groupOfCode(c.code);
        out.push({ value: `code:${c.code}`, label: `${c.code} ${c.name}`, axis: '손익', branch: pl,
          groupId: g?.id, path: `손익 › ${pl}${g ? ` › ${g.name}` : ''}` });
        continue;
      }
      const bs = bsTypeOf(c.code);
      if (bs) {
        const g = groupOfCode(c.code);
        out.push({ value: `code:${c.code}`, label: `${c.code} ${c.name}`, axis: '재무', branch: bs,
          groupId: g?.id, path: `재무 › ${bs}${g ? ` › ${g.name}` : ''}` });
      }
    }
    return out;
  }, [accountCodes, accountGroups, groupOfCode, plBranchOf, bsTypeOf]);
  const acctPicked = useMemo(
    () => accountItems.find(i => i.value === histAccount),
    [accountItems, histAccount]);
  /** 이름·코드·경로 아무거나로 찾는다 — 찾는 사람은 대개 계정 이름을 안다 */
  const acctShown = useMemo(() => {
    const q = acctQuery.trim().toLowerCase();
    //  검색은 층을 무시하고 전부 뒤진다 — 이름을 아는 계정은 두 번 안 눌러도 나와야 한다.
    if (q) return accountItems.filter(i => matchesSearch(i.label, q) || matchesSearch(i.path, q));
    if (!acctAxis || !acctBranch) return [];
    const inBranch = accountItems.filter(i => i.axis === acctAxis && i.branch === acctBranch);
    /**
     * **묶음 → 계정과목** 순으로 한 층씩 내려간다.
     * 묶음을 고르기 전엔 계정과목을 안 띄운다 — 수십 개가 한꺼번에 쏟아지면 못 읽는다.
     * 이름을 아는 계정은 검색으로 바로 간다(위 q 분기가 층을 통째로 건너뛴다).
     */
    if (!acctGroup) return inBranch.filter(i => i.isGroup);
    return inBranch.filter(i => !i.isGroup && i.groupId === acctGroup);
  }, [accountItems, acctQuery, acctAxis, acctBranch, acctGroup]);
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
  const rowCodes = 계정들;
  const [histQuick, setHistQuick] = useState<'당일'|'금주'|'당월'|'당년'|'ALL'|''>('당일');
  // 발행내역 페이지네이션
  const HIST_PAGE_SIZE = 50;
  const [historyPage, setHistoryPage] = useState(1);

  /**
   * **장부는 훅이 들고 있다** — 어디까지 떠오고 잔액을 어떻게 세는지는 `useVoucherLedger`.
   * 이 화면의 모든 기능이 같은 목록·같은 잔액을 봐야 해서 한 군데로 모았다.
   */
  const {
    mergedStatements, journalBySource, partnerBalances,
    getBalance, canSettle, isVouchered, isFetchingHistory, forgetStatement,
  } = useVoucherLedger({ companyId, issuedStatements, cashEntries, settlements, accountCodes, histFrom, histTo });

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

  /** 전표 삭제 — 서버에 지우고 화면에서도 즉시 뺀다.
   *  붙어 있던 매칭(settlement)도 같이 지운다. 안 지우면 없는 전표를 가리킨 채 남아
   *  그 거래처 잔액이 갚은 것으로 계속 깎인다. */
  const deleteStatement = (id: string) => {
    settlements.filter(s => s.statementId === id).forEach(s => onDeleteSettlement?.(s.id));
    onDeleteIssuedStatement?.(id);
    forgetStatement(id);
  };

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

  // ── 생성 오버레이 열기/닫기 ──
  const openCreate = (type: StatementType) => {
    issueIdentityRef.current = null;
    setPricePanelEdits({});
    setCreateMode(type);
    setSelectedClientId('');
    setSelectedOrderIds([]);
    setShowPreview(false);
    setEditablePrices({});
    setTaxExemptOverrides({});
    setTradeDate(today());
    setPartnerSearch('');
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
  const closeCreate = () => { if (saveBusyRef.current) return; issueIdentityRef.current = null; setCreateMode(null); setEditingStmt(null); setIsEditMode(false); setTradeNote(''); setStmtMemo(''); setSelectedItemIdx(null); setQuickItemId(undefined); setQuickName(''); setQuickSpec(''); setQuickQty(''); setQuickPrice(''); setQuickNote(''); setQuickSearchOpen(false); setQuickIsTaxExempt(false); setShowItemPicker(false); setPickerSearch(''); setPickerQtys({}); setPricePanelEdits({}); setNoLinkIds(new Set()); setAccountCodeOverrides({}); setLoadedPoIds([]); setIssuePay(false); setIssuePayAmount(''); hasIssuedRef.current = false; };

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
      ...pendingInvoice.items.map(item => {
        const resolved = resolveOrderItem({ itemId: item.itemId, name: item.name, quantity: item.qty } as any, allItems);
        const itemId = resolved.product?.id ?? item.itemId;
        const pc = partnerIn.find(p => p.itemId === itemId && p.partnerId === pendingInvoice.partnerId);
        return {
          itemId,
          name: resolved.product?.name ?? item.name,
          spec: resolved.product?.spec ?? item.spec,
          qty: String(resolved.qty),
          price: String(orderItemPrice(resolved, item, pc?.price) || ''),
          isTaxExempt: pc?.taxType === '면세',
          accountCode: pc?.Account_Code,
        };
      }),
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
      const live = mergedStatements.find(s => s.id === editingStmt.id);
      if (live) setEditingStmt(live);
    }
  }, [mergedStatements, isEditMode]);

  const openEdit = (stmt: IssuedStatement) => {
    setEditingStmt(stmt);
    setIsEditMode(false);
    setCreateMode(stmt.type);
    setSelectedClientId(stmt.partnerId);
    setSelectedOrderIds(String(stmt.orderId ?? '').split(/[,\s]+/).filter(Boolean));
    setTradeDate(stmt.tradeDate);
    setStmtMemo(stmt.memo ?? '');
    setManualMode(true);
    setManualItems([
      ...stmt.items.map(i => ({
        itemId: i.itemId,
        name: i.name,
        spec: i.spec,
        qty: String(i.qty),
        // 저장된 단가(부가세 포함)를 그대로 사용 — 수동입력 모드 supply=round(qty*price/1.1)와 일치
        price: String(i.price || (i.qty > 0 ? Math.round(i.total / i.qty) : 0)),
        isTaxExempt: i.isTaxExempt,
        accountCode: i.accountCode,
        side: (i as { side?: '차변' | '대변' }).side,
      })),
      //  빈 줄은 안 붙인다 — 양변 전표에 빈 줄이 끼면 차·대가 안 맞아 분개가 안 선다.
    ]);
    setEditablePrices({});
    setTaxExemptOverrides({});
    setPartnerSearch('');
    setActiveSearchRow(null);
  };


  // ── 매입전표 발행된 발주 품목 ID 집합 (발행완료/미발행 뱃지) ──
  const issuedPurchaseOrderIds = useMemo(() => {
    const s = new Set<string>();
    mergedStatements
      .filter(st => st.type === '매입')
      .forEach(st => ((st as any).purchaseOrderIds ?? (st as any).confirmedProductIds ?? []).forEach((id: string) => s.add(id)));
    return s;
  }, [mergedStatements]);

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
  const activeOrders = useMemo(() => 진행주문(orders, isVouchered), [orders, isVouchered]);

  // ── 선택된 발주항목(확정+예정) → 매입전표 직접 입력 모드 ──
  const loadSelectedToManual = () => {
    const rows: ManualRow[] = [];
    selectedConfirmedIds.forEach(id => {
      const product = allItems.find(p => p.id === id);
      if (!product) return;
      const co = confirmedOrders.find(c => c.id === id);
      if (co) {
        rows.push({ itemId: product.id, name: product.name, spec: product.spec || product.unit || '', qty: String(co.quantity), price: '', isTaxExempt: false });
        return;
      }
      const req = orderRequests?.find((r: { id: string; quantity: number; isBox?: boolean }) => r.id === id);
      if (req) {
        const ps = partnerIn.find(s => s.itemId === id && s.partnerId === selectedClientId);
        rows.push({ itemId: product.id, name: product.name, spec: product.spec || product.unit || '', qty: String(req.quantity), price: ps?.price ? String(ps.price) : '', isTaxExempt: ps?.taxType === '면세' });
      }
    });
    if (rows.length === 0) return;
    setManualItems(rows);   // 빈 행은 안 붙인다 — 필요하면 '행 추가'
    setSelectedConfirmedIds([]);
    setManualMode(true);
  };

  // ── 거래처 목록 ──
  const activeClientIds = useMemo(() => activePartnerIds(orders), [orders]);
  const availableClients = useMemo(() => {
    /*
     * **고르는 목록은 이 회사 거래처만.** 계산(잔액·분개)은 아래에서 거르지 않은 partners를
     * 그대로 쓴다 — 남의 회사 거래처가 섞여도 회사별로 거른 전표만 보므로 값이 안 흔들린다.
     * 그런데 **고르는 목록**은 다르다. 태백과 풍회가 같은 이름의 사본을 하나씩 갖고 있어서
     * (카프코·한전·농협은행 등 10곳) 안 거르면 같은 이름이 두 줄로 뜨고,
     * 어느 쪽을 골랐느냐에 따라 전표가 엉뚱한 회사 장부에 붙는다.
     */
    let base = partners.filter(c => companyOf(c) === companyId).filter(c => {
      if (createMode === '매입') {
        // 매입전표: 매입처 또는 매출+매입처
        return buysFrom(c);
      }
      // 매출전표: 매출처(기본) 또는 매출+매입처 — 채널(일반/택배/스마트스토어)·미설정 무관하게 모두 노출
      // (예전엔 type==='일반'||'택배'만 허용해 스마트스토어·type 미설정 거래처가 검색에서 누락됐음)
      return sellsTo(c);
    });
    // 검색 중이면 진행주문 필터(onlyActive)를 무시하고 해당 유형 전체 거래처에서 찾는다.
    // 매입은 '주문(orders=매출)' 개념이 없어 진행주문 필터를 아예 안 건다 — 매입처 전체를 노출.
    // (주문 없는 거래처도 검색으로 잡히게 — 매출/매입 전체 거래처 검색).
    if (onlyActive && !partnerSearch.trim() && createMode !== '매입') base = base.filter(c => activeClientIds.has(c.id));
    if (!partnerSearch.trim()) return base;
    return base.filter(c => matchKo(c.name, partnerSearch));
  }, [partners, partnerSearch, onlyActive, activeClientIds, createMode, companyId]);

  // ── 주문 목록 ──
  //  셈은 [shared/statementOrders](../src/shared/statementOrders.ts) 에 있다.
  //  날짜 필터가 **발행완료 건에만** 걸린다는 규칙이 거기 있고 시험이 붙어 있다.
  const partnerOrders = useMemo(
    () => 거래처주문({ orders, partnerId: selectedClientId, isVouchered, onlyActive, dateFrom, dateTo }),
    [orders, selectedClientId, onlyActive, dateFrom, dateTo, isVouchered]);

  const selectedOrder  = partnerOrders.find(o => o.id === selectedOrderId);
  const selectedClient = partners.find(c => c.id === selectedClientId);

  // ── 품목 행 계산 ──
  //  셈은 [shared/statementLines](../src/shared/statementLines.ts) 한 곳에 있다.
  //  박스↔낱개, 단가·과세·계정 우선순위, 같은 품목 합치기가 다 거기 있고 시험이 붙어 있다.
  //  여기서는 지금 화면 상태를 넘겨 받아 쓰기만 한다(2026-09-05).
  const lineItems = useMemo((): LineItem[] => {
    if (manualMode) return manualLines(manualItems, stmtType);
    if (!selectedOrder) return [];
    return orderLines({
      order: selectedOrder,
      stmtType,
      allItems,
      partnerItems: stmtType === '매출' ? partnerOut : partnerIn,
      partnerId: selectedClientId,
      editablePrices,
      taxExemptOverrides,
      accountCodeOverrides,
    });
  }, [manualMode, manualItems, selectedOrder, allItems, partnerOut, partnerIn, selectedClientId, editablePrices, taxExemptOverrides, accountCodeOverrides, stmtType]);

  const 합계 = lineTotals(lineItems);
  const isTwoSided = 합계.isTwoSided;
  //  양변 전표는 차변만 센다 — 수량처럼 합계에 없는 값을 더할 때도 같은 규칙을 따라야 한다
  const sumOf = (pick: (r: LineItem) => number) =>
    (isTwoSided ? lineItems.filter(r => r.side === '차변') : lineItems).reduce((s, r) => s + pick(r), 0);
  const totalSupply = 합계.supply;
  const totalTax    = 합계.tax;
  const totalAmount = 합계.amount;

  const tradeDateObj = new Date(tradeDate + 'T00:00:00');
  const dateStr = `${tradeDateObj.getFullYear()}년 ${tradeDateObj.getMonth() + 1}월 ${tradeDateObj.getDate()}일`;
  //  번호는 **그날 전표 전부**를 보고 매긴다 — 7일 밖으로 소급하면 겹친다
  //  미리보기용 — 실제 발행 때는 claimDocNo 로 다시 받는다(그 사이 다른 전표가 나갔을 수 있다)
  const docNo   = nextDocNo(tradeDate, mergedStatements);

  const inboundPartnerLabel = stmtType === '매출' ? '【 공급자 】' : `【 공급자 】　${selectedClient?.name||''}`;
  const receiverLabel = stmtType === '매출' ? `【 공급받는자 】　${selectedClient?.name||''}` : '【 공급받는자 】';

  // ── 발행 처리 ──
  const missingAccountCodes = lineItems.filter(i => !i.accountCode);
  const canIssue = lineItems.length > 0 && !!selectedClientId && (manualMode || !!selectedOrderId);

  /**
   * 전표에 찍힌 단가·계정을 **거래처 단가로 되민다.**
   *
   * 셈은 `shared/partnerPriceSync` 한 곳에 있다. 여기서는 그 답을 쓰기만 한다 —
   * 예전엔 발행-매출 · 발행-매입 · 수정-매입 세 벌로 쓰여 있었고 셋이 서로 달랐다.
   * (수정이 "이번 전표에만"을 무시했고, 수정에는 매출이 통째로 없었다.)
   */
  const applyPriceSync = useCallback(async (type: string) => {
    if (!onUpsertPartnerItem) return;
    const { upserts, costUpdates } = partnerPriceWrites({
      type, partnerId: selectedClientId, lines: lineItems, items: allItems,
      partnerItems: [...partnerOut, ...partnerIn], noLinkIds,
    });
    for (const u of upserts) await onUpsertPartnerItem(u);
    for (const c of costUpdates) await onUpdateItemCost?.(c.itemId, c.price);
  }, [onUpsertPartnerItem, onUpdateItemCost, selectedClientId, lineItems, allItems, partnerOut, partnerIn, noLinkIds]);

  /** 전표를 만들고 **그 전표를 돌려준다** — 발행하면서 바로 수금·지불하려면 그 객체가 필요하다. */
  const markIssued = async (): Promise<IssuedStatement | null> => {
    if (!selectedClientId || lineItems.length === 0) return null;
    // 발행 차단(백스톱) — 인쇄·세금계산서·엑셀 경로에서도 계정 미설정/단가 0이면 발행 기록 안 함
    if (lineItems.some(i => !i.accountCode)) { alert('계정과목이 설정되지 않은 품목이 있어 발행할 수 없습니다.'); return null; }
    if (lineItems.some(i => !i.price)) { alert('단가가 0인 품목이 있어 발행할 수 없습니다.'); return null; }
    //  고른 주문 **전부**에 발행 표시를 찍는다 — 한 건만 찍으면 나머지가 목록에 다시 뜬다
    if (!onAddIssuedStatement) throw new Error('전표 저장 기능이 연결되지 않았습니다.');
    const identity = issueIdentityRef.current ?? {
      id: `stmt-${Date.now()}`, docNo: claimDocNo(tradeDate, mergedStatements),
    };
    issueIdentityRef.current = identity;
    const stmt: IssuedStatement = {
      id: identity.id,
      // 시각은 전표 날짜에 맞춰 잡는다 — 소급이면 그날 맨 뒤, 미리 끊으면 맨 앞.
      issuedAt: stampFor(tradeDate),
      tradeDate,
      type: stmtType,
      partnerId: selectedClientId,
      partnerName: selectedClient?.name || '',
      //  여러 주문을 한 전표로 묶으면 쉼표로 이어 담는다 — 읽는 쪽이 그렇게 갈라 읽는다
      orderId: selectedOrderIds.join(','),
      //  **번호는 여기서 받아 간다**(claimDocNo). 위쪽 `docNo` 는 미리보기용이라
      //  화면에 떠 있는 동안 다른 전표가 나갔으면 낡아 있다. 받아 가면 이번 판에서
      //  다시 안 나온다 — 연달아 발행해도 목록 갱신을 안 기다린다.
      docNo: identity.docNo,
      ...(stmtMemo.trim() ? { memo: stmtMemo.trim() } : {}),
      totalSupply,
      totalTax,
      totalAmount,
      items: lineItems.map(i => ({
        ...(i.itemId ? { itemId: i.itemId } : {}),
        name: i.name, spec: i.spec, qty: i.qty, price: i.price,
        supply: i.supply, tax: i.tax, total: i.total, isTaxExempt: i.isTaxExempt,
        accountCode: i.accountCode || undefined,
        ...(i.side ? { side: i.side } : {}),   // 양변 전표 — 없으면 분개가 안 선다
      })),
      // 매입전표: 발주된 품목 ID 목록 (purchaseOrders 연결용)
      ...(stmtType === '매입' ? {
        purchaseOrderIds: lineItems
          .map(i => allItems.find(p => p.id === i.itemId))
          .filter(Boolean)
          .map(p => p!.id),
      } : {}),
    };
    await onAddIssuedStatement(stmt);
    await applyPriceSync(stmtType);
    for (const id of selectedOrderIds) await onMarkInvoicePrinted?.(id, true);
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
            const product = allItems.find(p => p.id === item.itemId);
            return product ? { itemId: product.id, itemName: item.name, quantity: item.qty, isBox: false, unit: product.unit || '개' } : null;
          })
          .filter((it): it is NonNullable<typeof it> => it !== null);
        if (newItems.length > 0) {
          onCreateInboundPO?.({ partnerId: selectedClientId, partnerName: selectedClient?.name || '', statementId: stmt.id, items: newItems });
        }
      }
    }
    //  전표에 찍힌 단가·계정을 거래처 단가로 되민다 — 발행이든 수정이든 같은 셈이다
    //  (shared/partnerPriceSync). 예전엔 세 벌로 쓰여 있어 서로 갈렸다.
    // (원본 주문 자동반영 기능 제거됨 — 전표 편집은 원본 주문을 건드리지 않는다.
    //  박스→낱개 변환 때문에 낱개가 주문에 이중으로 붙는 문제도 함께 방지.)
    return stmt;
  };

  const handleIssue = async () => {
    if (saveBusyRef.current) return;
    // 계정과목 미설정 품목이 있으면 발행 차단 (매출은 800 기본이라 대개 매입에서 걸림)
    if (missingAccountCodes.length > 0) {
      alert(`계정과목이 설정되지 않은 품목이 ${missingAccountCodes.length}건 있습니다.\n(${missingAccountCodes.slice(0, 3).map(i => i.name).join(', ')}${missingAccountCodes.length > 3 ? ' 외' : ''})\n계정을 설정해야 발행할 수 있습니다.`);
      return;
    }
    // 단가 0(미입력) 품목이 있으면 발행 차단.
    //  ※ 0만 막는다. 음수는 통과 — 할인·반품 줄(단가 또는 수량이 마이너스)이
    //    전표 한 장에 단독으로 설 수 있어야 한다.
    const zeroPriceItems = lineItems.filter(i => !i.price);
    if (zeroPriceItems.length > 0) {
      alert(`단가가 0인 품목이 ${zeroPriceItems.length}건 있습니다.\n(${zeroPriceItems.slice(0, 3).map(i => i.name).join(', ')}${zeroPriceItems.length > 3 ? ' 외' : ''})\n단가를 입력해야 발행할 수 있습니다.`);
      return;
    }
    // ── 중복 발행 가드 — 발행 직전 같은 거래가 이미 발행됐는지 확인 ──
    //   · 주문 기반: 같은 주문(orderId)으로 이미 발행됨
    //   · 수동/매입: 같은 거래처+거래일+합계로 이미 발행됨 (주문 없는 매입 중복 방지)
    //   확정이 아니라 확인(confirm) — 정당하게 같은 금액이 반복될 수 있으니 사용자가 넘길 수 있게.
    const dup = mergedStatements.find(s =>
      s.type === stmtType && s.id !== editingStmt?.id && s.id !== issueIdentityRef.current?.id && (
        //  고른 주문 중 **하나라도** 이미 전표에 물려 있으면 묻는다
        (selectedOrderIds.length > 0 && selectedOrderIds.some(id =>
          String(s.orderId ?? '').split(/[,\s]+/).includes(id))) ||
        (selectedOrderIds.length === 0 && !!selectedClientId && s.partnerId === selectedClientId &&
          s.tradeDate === tradeDate && Math.abs((s.totalAmount ?? 0) - totalAmount) < 1)
      )
    );
    if (dup) {
      const ok = window.confirm(
        `⚠️ 이미 발행된 전표가 있습니다.\n\n· ${dup.partnerName} / ${dup.tradeDate} / ${Number(dup.totalAmount ?? 0).toLocaleString()}원\n· 문서번호 ${dup.docNo}\n\n중복 발행일 수 있습니다. 그래도 발행할까요?`
      );
      if (!ok) return;
    }
    saveBusyRef.current = true;
    setIsSaving(true);
    try {
      const stmt = await markIssued();
      if (!stmt) return;
      //  발행과 같은 클릭에서 수금·지불까지. 전표에 붙여(pin) 그 전표부터 갚아지게 한다.
      if (issuePay) {
        const amt = Number((issuePayAmount || '').replace(/[,\s원]/g, '')) || 0;
        if (amt > 0) {
          recordPayment([{ stmt, amount: amt }], {
            date: tradeDate, method: '계좌이체', cashAccountId: activeCashAccounts[0]?.id ?? '', pin: true,
          });
        }
      }
      setIssuePay(false); setIssuePayAmount('');
      saveBusyRef.current = false;
      closeCreate();
    } catch (e: any) {
      alert('전표 또는 거래처 단가 저장에 실패했습니다. 입력 내용은 유지됩니다. 다시 저장해 주세요.\n' + (e?.message ?? String(e)));
    } finally {
      saveBusyRef.current = false;
      setIsSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (saveBusyRef.current) return;
    if (!editingStmt || lineItems.length === 0) return;
    const proposed: Partial<IssuedStatement> = {
      tradeDate,
      memo: stmtMemo.trim(),
      partnerId: selectedClientId,
      partnerName: selectedClient?.name || '',
      totalSupply,
      totalTax,
      totalAmount,
      items: lineItems.map(i => ({
        ...(i.itemId ? { itemId: i.itemId } : {}),
        name: i.name, spec: i.spec, qty: i.qty, price: i.price,
        supply: i.supply, tax: i.tax, total: i.total, isTaxExempt: i.isTaxExempt,
        accountCode: i.accountCode || undefined,
        ...(i.side ? { side: i.side } : {}),   // 양변 전표 — 없으면 분개가 안 선다
      })),
    };
    // 거래명세서 탭에서의 수정은 즉시 반영 (확인사항 안 거침)
    // ※ 입고대기 발주카드 수정 → 연결된 전표 수정요청은 AdminApp.handleRequestPoEdit 경로(별도)
    saveBusyRef.current = true;
    setIsSaving(true);
    try {
      if (!onUpdateIssuedStatement) throw new Error('전표 수정 기능이 연결되지 않았습니다.');
      await onUpdateIssuedStatement(editingStmt.id, proposed);
      await applyPriceSync(editingStmt.type);
      saveBusyRef.current = false;
      closeCreate();
      alert('전표가 수정되었습니다.');
    } catch (e: any) {
      alert('전표 또는 거래처 단가 저장에 실패했습니다. 입력 내용은 유지됩니다. 다시 저장해 주세요.\n' + (e?.message ?? String(e)));
    } finally {
      saveBusyRef.current = false;
      setIsSaving(false);
    }
  };

  const buildPrintHtml = (items: LineItem[] | IssuedStatement['items'], sup: number, tax: number, amt: number, type: StatementType, partner: string, docNoStr: string, dateString: string, memoText = '', partnerIdStr = '') => {
    const m = dateString.match(/(\d+)년\s*(\d+)월\s*(\d+)일/);
    const yyyy = m ? m[1] : '';
    const mmN  = m ? m[2] : '';
    const dd   = m ? m[3] : '';
    const dateLabel = `${yyyy}-${mmN.padStart(2,'0')}-${dd.padStart(2,'0')}`;

    const ci = companyInfo;
    const isSale = type === '매출';

    //  **거래처 칸을 저장된 값으로 채운다**(2026-09-06 사장님: "저장된 거래처 정보가
    //  다 안 들어가냐"). 전에는 거래처 쪽이 이름과 전화만이었고 사업자번호·대표자·
    //  주소·팩스가 빈 문자열로 박혀 있었다. shared/docParty 가 양쪽을 같은 규칙으로 낸다.
    //  거래처는 **id 로 찾는다** — 이름으로 찾으면 같은 이름이 둘일 때 엉뚱한 곳이 걸린다.
    const { sup: 파는쪽, buy: 사는쪽 } = 서류당사자ById({
      isSale, companyInfo: ci, partners, partnerId: partnerIdStr, partnerName: partner,
    });
    const supName = 파는쪽.name, supCeo = 파는쪽.ceo, supBizNo = 파는쪽.bizNo;
    const supBizType = 파는쪽.bizType, supBizItem = 파는쪽.bizItem;
    const supAddr = 파는쪽.addr, supPhone = 파는쪽.tel, supFax = 파는쪽.fax;
    const buyName = 사는쪽.name, buyCeo = 사는쪽.ceo, buyBizNo = 사는쪽.bizNo;
    const buyBizType = 사는쪽.bizType, buyBizItem = 사는쪽.bizItem;
    const buyAddr = 사는쪽.addr, buyPhone = 사는쪽.tel, buyFax = 사는쪽.fax;

    const MAX_ROWS = 11;
    //  **인쇄에만** 서류용 품목명으로 바꾼다 — 화면·저장은 실제 이름 그대로다.
    //  (2026-09-06 사장님) 원료수불부·생산작업기록부가 그 이름으로 나가서, 전표도 맞춰야
    //  서류끼리 대조가 된다. shared/statementLines 의 withDocNames 참고.
    const itemList = withDocNames(items as any[], allItems);
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
          <td style="border:1px solid ${BC};text-align:right;font-size:10.5px;padding:0 3px;">${fmt(item.qty)}</td>
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
        <tr><td colspan="2" style="font-size:9.5px;font-weight:bold;padding:2px 4px;height:10mm;vertical-align:top;">비&nbsp;고${memoText ? `<div style="font-weight:normal;font-size:9px;white-space:pre-wrap;margin-top:1px;">${esc(memoText)}</div>` : ''}</td></tr>
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
    const html = buildPrintHtml(lineItems, totalSupply, totalTax, totalAmount, stmtType, selectedClient?.name || '', docNo, dateStr, stmtMemo.trim(), selectedClient?.id || '');
    printViaIframe(html, `${stmtType}전표`);
    // 인쇄는 '출력'만 — 발행(저장)은 '저장' 버튼(markIssued) 한 곳에서만. 저장된 전표만 인쇄 가능.
  };

  const handleDetailPrint = (stmt: IssuedStatement) => {
    const d = new Date(stmt.tradeDate + 'T00:00:00');
    const ds = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
    const html = buildPrintHtml(stmt.items as any, stmt.totalSupply, stmt.totalTax, stmt.totalAmount, stmt.type, stmt.partnerName, stmt.docNo, ds, stmt.memo ?? '', stmt.partnerId);
    printViaIframe(html, `${stmt.type}전표`);
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

  /**
   * **분류 순서** — 목록 화면(재고관리·품목관리)과 같은 근거(itemTaxonomy)로 줄을 세운다.
   * 저장본이 없으면 buildTaxonomy가 기본값을 준다. 여기 없는 분류는 맨 뒤로 보낸다.
   */
  const pickerOrder = useMemo(() => {
    const taxo = buildTaxonomy(taxonomyRows);
    const typeRank = new Map(taxo.types.map((t, i) => [t.key, i]));
    const catRank = new Map<string, number>();
    let n = 0;
    for (const t of taxo.allTypes) for (const c of taxo.categoriesOf(t.key)) if (!catRank.has(c)) catRank.set(c, n++);
    return (p?: Item): [number, number, string] => [
      typeRank.get(String(p?.type)) ?? 99,
      catRank.get(String(p?.category)) ?? 999,
      String(p?.name ?? ''),
    ];
  }, [taxonomyRows]);
  /** 분류 → 분류 안에서는 이름 — 표에서 같은 갈래가 붙어 있어야 눈으로 찾는다 */
  const byTaxonomy = useCallback((a?: Item, b?: Item) => {
    const [at, ac, an] = pickerOrder(a);
    const [bt, bc, bn] = pickerOrder(b);
    return at - bt || ac - bc || an.localeCompare(bn, 'ko');
  }, [pickerOrder]);

  // 품목 선택 피커 전체 풀 — 거래처에 등록된 품목 + 미등록 전체 품목(반제품·원료·부자재 포함). 검색 시 전품목 대상.
  const pickerRows = useMemo(() => {
    const linkedIds = new Set(searchableRows.map(r => r.product!.id));
    const src = createMode === '매입' ? partnerIn : partnerOut;
    const extra = allItems
      //  **이 회사 품목만.** 회사를 안 가리니 같은 이름의 풍회 사본이 태백 전표 피커에
      //  같이 떠서 "깨분참기름/16.5kg가 왜 두 개냐"가 됐다. 어느 쪽을 골랐는지에 따라
      //  단가도 재고도 다른 품목에 붙는다.
      .filter(p => companyOf(p) === companyId)
      .filter(p => !linkedIds.has(p.id) && !isBoxStockItem(p))   // 박스 품목은 전표 피커에서 제외(낱개만)
      .map(p => {
        const ex = src.find(pc => (pc.itemId) === p.id && (pc.partnerId) === selectedClientId);
        return { pc: { id: ex?.id ?? p.id, itemId: p.id, partnerId: selectedClientId, price: ex?.price, taxType: ex?.taxType }, product: p };
      });
    //  **분류로 줄을 세운다.** 거래처에 등록된 품목을 앞에 두는 것은 그대로 — 자주 쓰는 게 위에 와야 한다.
    const sorted = (rows: typeof searchableRows) =>
      [...rows].sort((x, y) => byTaxonomy(x.product as Item | undefined, y.product as Item | undefined));
    return [...sorted(searchableRows), ...sorted(extra as unknown as typeof searchableRows)] as unknown as typeof searchableRows;
  }, [searchableRows, allItems, createMode, partnerIn, partnerOut, selectedClientId, byTaxonomy, companyId]);

  //  거래처를 바꾸면 '이번만 쓰기'도 없던 일이 된다 — 다른 거래처 얘기다
  useEffect(() => { setNoLinkIds(new Set()); }, [selectedClientId]);

  //  거래처에 이미 붙어 있는 품목 — 피커에서 "연결할까요?"를 물을지 가르는 기준
  const linkedItemIds = useMemo(
    () => new Set(searchableRows.map(r => r.product!.id)),
    [searchableRows],
  );

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
      //  빈 행은 안 붙인다 — 누를 때마다 하나씩 딸려 나와 지우는 일이 된다. 필요하면 '행 추가'가 있다.
      return [
        ...filled,
        { itemId: pc.product!.id, name: pc.product!.name, spec: pc.product!.spec || '', qty: '1', price: String(pc.pc.price ?? 0), isTaxExempt: pc.pc.taxType === '면세' },
      ];
    });
  }, []);

  // ── 전표 통합 타임라인 (거래명세서 + 수금/지불 + 자금 입출금) ──
  //  cumul이 undefined = 잔액이라는 게 없는 줄(거래처가 안 붙은 전표). 화면은 —로 띄운다.
  //  줄 모양·갈래·계정 셈은 [shared/timelineRows](../src/shared/timelineRows.ts) 에 있다.

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

  //  줄을 만들고 누적잔액을 굴리는 셈은 [shared/timelineBuild](../src/shared/timelineBuild.ts) 에 있다.
  //  돈이 걸린 자리라 그동안 난 사고가 거기 주석으로 남아 있다.
  const allTimelineRows = useMemo(
    (): TimelineRow[] => buildTimeline({ statements: mergedStatements, cashEntries, arapOf }),
    [mergedStatements, cashEntries, arapOf]);

  //  거르기·줄 세우기 셈은 [shared/timelineRows](../src/shared/timelineRows.ts) 에 있다.
  //  계정을 **줄**로 보는 것과, 소급 전표 정렬(시각이 전부 23:59:59)이 거기 있고 시험이 붙어 있다.
  const filteredHistory = useMemo((): TimelineRow[] => sortTimeline(
    filterTimeline(allTimelineRows,
      { from: histFrom, to: histTo, kind: histKind, partner: histPartner, search: histSearch },
      { matchAccount: histAccount ? matchAccount : undefined, codeName })),
    [allTimelineRows, histFrom, histTo, histKind, histAccount, histPartner, histSearch, codeName, matchAccount]);

  // 페이지네이션: 필터 변경 시 1페이지로 리셋, 최신 페이지부터 보여줌
  useEffect(() => { setHistoryPage(1); }, [histFrom, histTo, histKind, histAccount, histPartner, histSearch]);
  /** 거래처 목록 — 실제로 전표가 있는 이름만. 없는 이름을 고르게 하면 빈 목록만 본다. */
  const histPartnerNames = useMemo(() => partnerNamesOf(allTimelineRows), [allTimelineRows]);
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
    /*
     * **발생 손익은 분개에서 센다** — 셈은 `financials.plOfJournals` 하나다.
     *
     * 예전엔 `type === '매입'` 인 전표만 더했다. 그러면 **대체전표가 통째로 빠진다** —
     * 급여 발생·감가상각·퇴직급여충당은 갈래가 '비용'이라 한 푼도 안 잡혔다
     * (2026-08 급여 19,314,620원이 하단 합계에서 사라져 있었다, 2026-09-03 사장님 발견).
     * 여기 있던 `costCash`·`incomeCash` 는 **아무 데서도 안 더해서 늘 0이었다.**
     *
     * 분개로 세면 갈래와 상관없이 맞고 부가세도 저절로 빠진다. 손익 화면과 같은 근거다.
     */
    const 고른분개 = filteredHistory
      .map(r => (r.kind === 'stmt' ? r.data.id : r.entry?.id))
      .map(id => (id ? journalBySource.get(id) : undefined))
      .filter((je): je is NonNullable<typeof je> => !!je);
    const { income: incomeCash, cost: costCash } = plOfJournals(고른분개, accountCodes);
    return { ...timelineTotals(filteredHistory, codeType), costCash, incomeCash };
  }, [filteredHistory, codeType, journalBySource, accountCodes]);

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
  /**
   * 주문 한 건을 전표 줄로 편다 — 박스 품목은 낱개로(수량 = 박스 × 개입수).
   *
   * 푸는 것과 단가 고르는 것은 [statementLines](../src/shared/statementLines.ts) 와
   * **같은 함수**를 쓴다. 예전엔 여기 따로 적혀 있어서, 박스 단가를 개입수로 나누는
   * 고침이 저쪽에만 들어가고 여기는 **열 배로 남아 있었다**(2026-09-05).
   */
  const orderToRows = (o: Order): ManualRow[] => o.items.map(item => {
    const r = resolveOrderItem(item, allItems);
    const pcEntry = partnerOut.find(pc => pc.itemId === r.product?.id && pc.partnerId === o.partnerId);
    //  규격은 박스를 풀었을 때만 품목 것을 앞세운다 — 낱개는 주문에 적힌 표시규격이 맞다
    const spec = r.perBox > 1
      ? (r.product?.spec || item.displaySize || '')
      : (item.displaySize || r.product?.spec || '');
    return {
      itemId: r.product?.id ?? item.itemId,
      name: r.product?.name || item.name,
      spec,
      qty: String(r.qty),
      price: String(orderItemPrice(r, item, pcEntry?.price)),
      isTaxExempt: pcEntry?.taxType === '면세',
      note: '',
      accountCode: pcEntry?.Account_Code || undefined,
    } as ManualRow;
  });

  const handleOrderClick = (o: Order) => {
    const existing = mergedStatements.find(s => s.orderId === o.id);
    if (existing && o.invoicePrinted) { setWarnDuplicate({ order: o, stmt: existing }); return; }
    //  누른 것을 넣거나 뺀다. 고른 게 하나도 안 남으면 직접입력을 접는다.
    const next = selectedOrderIds.includes(o.id)
      ? selectedOrderIds.filter(id => id !== o.id)
      : [...selectedOrderIds, o.id];
    setSelectedOrderIds(next);
    if (next.length === 0) {
      setManualMode(false);
      setManualItems([{ name: '', spec: '', qty: '', price: '', isTaxExempt: false }]);
      return;
    }
    //  전표일자는 **발행하는 날**이 기본이다(주문 접수일이 아니라).
    //  주문은 며칠 전에 들어와도 전표는 오늘 끊는 게 보통이라, 접수일을 물려받으면
    //  매번 손으로 고쳐야 했다. 필요하면 날짜칸에서 바꾸면 된다.
    setTradeDate(today());
    setShowPreview(false);
    setEditablePrices({});
    setTaxExemptOverrides({});
    //  고른 순서대로 줄을 이어 붙인다 — **합치지 않는다.**
    //  빈 행은 자동으로 안 넣는다. 더 넣으려면 '+ 행 추가'.
    //
    //  **주문은 `orders` 전체에서 찾는다.** `partnerOrders` 는 고른 거래처로 걸러 놓은 것이라,
    //  미발행 목록에서 거래처를 안 고르고 바로 누르면 비어 있다 — 그쪽은 같은 틱에
    //  `setSelectedClientId` 를 부르지만 React 상태는 그 틱에 안 바뀐다.
    //  그래서 품목이 한 줄도 안 들어왔다(2026-09-03 사장님 발견).
    const pick = next.map(id => orders.find(x => x.id === id)).filter((x): x is Order => !!x);
    setManualItems(pick.flatMap(orderToRows));
    //  **목록에 남는다.** 예전엔 여기서 바로 양식으로 넘어갔는데(단건이라 그게 맞았다),
    //  여러 건을 묶게 되면서 그러면 둘째를 고를 수가 없다 — 첫 클릭에 목록이 사라진다.
    //  줄은 이미 담겼으니, 다 골랐으면 아래 '전표 작성' 으로 넘어간다.
  };

  /** 고르기를 끝내고 양식으로 — 목록 아래 단추가 부른다 */
  const goCompose = () => setManualMode(true);

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

      {/*  세금계산서 발행은 [TaxStatement](TaxStatement.tsx) 가 한다.
           여기 있던 364줄은 `{false && ...}` 로 꺼둔 채 남아 있었다 — 지웠다(2026-09-05).
           꺼진 코드를 남겨 두면 **살아 있는 줄 알고 고치게 된다** (실제로 그랬다). */}

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

      {/* 보유자금·계좌 잔액은 여기 안 띄운다 — 장부(현금출납장)가 그걸 쥔다.
          전표 화면은 전표를 끊는 곳이다. 같은 숫자를 두 곳에 두면 어느 쪽이 진짜인지 흐려진다. */}

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
          {/*  좁으면 한 줄을 통째로 쓴다 — 안 접히면 날짜 두 개가 카드 밖으로 나간다(2026-09-04 사장님) */}
          <div className="flex items-center gap-1.5 w-full sm:w-auto sm:ml-1">
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
                    placeholder="계정 이름·번호·묶음(재료비·판관비)"
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
                </div>
                {/* 층으로 좁힌다 — 손익 › 이익·비용,  재무 › 자산·부채·자본. 검색하면 층을 건너뛴다. */}
                {!acctQuery.trim() && (
                  <div className="px-2 py-2 space-y-1.5 border-b border-slate-100">
                    <div className="flex gap-1">
                      {(['손익', '재무'] as const).map(a => (
                        <button key={a} type="button"
                          onClick={() => { setAcctAxis(a); setAcctBranch(''); setAcctGroup(''); }}
                          className={`flex-1 py-1.5 rounded-lg text-[11px] font-black border transition-all ${
                            acctAxis === a ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>{a}</button>
                      ))}
                    </div>
                    {acctAxis && (
                      <div className="flex gap-1">
                        {(acctAxis === '손익' ? ['이익', '비용'] : ['자산', '부채', '자본']).map(b => (
                          <button key={b} type="button"
                            onClick={() => { setAcctBranch(b); setAcctGroup(''); }}
                            className={`flex-1 py-1.5 rounded-lg text-[11px] font-black border transition-all ${
                              acctBranch === b ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>{b}</button>
                        ))}
                      </div>
                    )}
                    {/* 고른 묶음 — 눌러서 되돌아간다(계정과목 층에서 묶음 층으로) */}
                    {acctBranch && acctGroup && (
                      <button type="button" onClick={() => setAcctGroup('')}
                        className="w-full flex items-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-all">
                        <ChevronDown size={11} className="rotate-90 shrink-0"/>
                        {accountItems.find(i => i.isGroup && i.groupId === acctGroup)?.label ?? '묶음'}
                        <span className="ml-auto text-[10px] font-bold text-indigo-400">묶음 다시 고르기</span>
                      </button>
                    )}
                  </div>
                )}
                <div className="h-[260px] overflow-y-auto py-1">
                  {histAccount && (
                    <button type="button"
                      onClick={() => { setHistAccount(''); setAcctAxis(''); setAcctBranch(''); setAcctGroup(''); setAcctPickerOpen(false); }}
                      className="w-full text-left px-3 py-1.5 text-xs font-black text-slate-400 hover:bg-slate-50">필터 해제</button>
                  )}
                  {acctShown.length === 0 && (
                    <p className="px-3 py-6 text-center text-[11px] font-bold text-slate-300">
                      {acctQuery.trim() ? '찾는 계정이 없습니다'
                        : !acctAxis ? '손익 · 재무 중에서 고르세요'
                        : !acctBranch ? '갈래를 고르세요'
                        : acctGroup ? '이 묶음에 딸린 계정이 없습니다' : '묶음을 고르세요'}
                    </p>
                  )}
                  {acctShown.map(it => (
                    <button key={it.value} type="button"
                      onClick={() => {
                        //  묶음은 **한 층 내려가는 것**이 먼저다(그 밑 계정을 본다).
                        //  묶음 통째로 거르고 싶으면 오른쪽 '이 묶음 전체' 배지를 누른다.
                        //  검색 결과에서는 층이 없으므로 바로 걸린다.
                        if (it.isGroup && !acctQuery.trim()) { setAcctGroup(it.groupId ?? ''); return; }
                        setHistAccount(it.value); setAcctPickerOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-slate-50 transition-colors ${
                        histAccount === it.value ? 'bg-indigo-50' : ''}`}>
                      <span className={`text-xs font-black ${histAccount === it.value ? 'text-indigo-700' : 'text-slate-700'}`}>
                        {it.label}
                        {/* 묶음 줄은 눌러서 내려가고, 통째로 거르려면 오른쪽 배지를 누른다 */}
                        {it.isGroup && (
                          <span role="button" tabIndex={0}
                            onClick={e => { e.stopPropagation(); setHistAccount(it.value); setAcctPickerOpen(false); }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).click(); }}
                            className="float-right text-[9px] font-black px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 hover:bg-indigo-200 cursor-pointer">
                            이 묶음 전체
                          </span>
                        )}
                      </span>
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
            onClick={() => setShowRecurring(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-violet-600 text-white hover:bg-violet-500 shadow-sm shadow-violet-200 transition-all"
            title="전표 템플릿 — 목록 관리 · 매달 자동 발행 설정"
          >
            <RotateCw size={13} strokeWidth={3}/>템플릿
          </button>
        )}

        {/* 구분선 */}
        <div className="w-px h-6 bg-slate-200 mx-1 self-center"/>

        {/* ── 도구 (soft) ── */}
        {/* 계좌 관리 버튼은 뺐다 — 장부(현금출납장)가 계좌를 쥔다.
            한 가지를 두 곳에서 고칠 수 있으면 어느 쪽이 진짜인지 흐려진다. */}
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
                  //  **셈은 cashLedger.unmatchedCash 하나다.** 여기 손으로 한 벌 더
                  //  적혀 있었는데(2026-09-03 사장님 지적), 그러면 규칙이 바뀔 때
                  //  이 자리만 안 따라온다 — 실제로 '자금줄 생사를 본다'가 그랬다.
                  const unallocated = row.entry.partnerId && !split.length && !row.accountCode
                    ? Math.max(0, unmatchedCash(row.entry, settlements)) : 0;
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
                        {/* '그중 비용 …'은 안 붙인다 — 안 물어봤는데 늘 따라다녀 줄만 어지럽다.
                            계정으로 걸렀을 때 그 몫이 위 shownAmt로 뜨는 것으로 충분하다(partial). */}
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
                    {isOpen && journalTr(`je__cash__${row.entry.id}`, journalizeCashEntry(row.entry),
                      { kind: rowKind(row), docNo: row.entry.docNo, date: row.date, headPartner: row.partnerName })}
                  </React.Fragment>
                  );
                }
                if (row.kind === 'pay') {
                  // ── 수금/지불 행 ──
                  // 라벨은 수금·지불(무슨 돈인지 알아야 하니까). 다만 분류는 자금(입금·출금)이라
                  // 수익·비용 탭에는 안 뜬다 — 매출·매입은 전표 끊을 때 이미 잡혔기 때문.
                  const label = row.offset ? (row.stmtType === '매출' ? '미수상계' : '미지급상계')
                    : row.stmtType === '매출' ? '수금' : '지불';
                  const cumul = row.cumul;
                  const payEntry = row.entry;
                  /*
                   * **행 열쇠는 자금전표 id만으로 모자란다.**
                   * 상계 하나가 미수와 미지급을 같이 줄이면 채권 묶음·채무 묶음에서 각각
                   * 한 줄씩 나온다(가득찬식품 8/31 24,604,700). 둘 다 paymentId가 같아
                   * key가 겹쳤고, React가 같은 열쇠를 둘로 보고 지운 줄을 못 지워
                   * "필터에 안 맞는데도 남아 있는" 행이 됐다. 방향을 열쇠에 붙여 가른다.
                   */
                  const payKey = `${row.paymentId}__${row.stmtType}`;
                  return (
                    <React.Fragment key={`pay__${payKey}`}>
                    <tr
                      className={`cursor-pointer transition-colors ${row.stmtType === '매출' ? 'bg-lime-50/80 hover:bg-lime-100/80' : 'bg-orange-50/80 hover:bg-orange-100/80'}`}
                      onClick={() => openPayTimelineRow(row.paymentId, row.src)}>
                      <td className="px-4 py-2 text-[11px] font-mono text-slate-500 whitespace-nowrap">{row.date}{payEntry?.createdAt ? ` ${payEntry.createdAt.slice(11,16)}` : ''}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1 align-middle">
                          {journalToggle(payKey)}
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
                    {expandedJournal.has(payKey) && payEntry &&
                      journalTr(`je__pay__${payKey}`, journalizeCashEntry(payEntry),
                        { kind: payEntry.dir, docNo: payEntry.docNo, date: row.date, headPartner: row.partnerName })}
                    </React.Fragment>
                  );
                }
                // ── 전표 행 ──
                const stmt = row.data;
                const issuedDate = new Date(stmt.issuedAt);
                const dateLabel  = `${stmt.tradeDate} ${String(issuedDate.getHours()).padStart(2,'0')}:${String(issuedDate.getMinutes()).padStart(2,'0')}`;
                const stmtItems  = stmt.items ?? [];
                const summary    = itemSummary(stmtItems);
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
                      {cumul == null
                        ? <span className="font-black text-slate-300" title="거래처가 없는 전표 — 잔액이라는 게 없다">—</span>
                        : cumul === 0
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
                        {canSettle(stmt) && (
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
                  {jOpen && journalTr(`je__${stmt.id}`, journalOfStmt(stmt),
                    { kind: stmt.type === '비용' ? '대체' : stmt.type, docNo: stmt.docNo, date: stmt.tradeDate, headPartner: stmt.partnerName })}
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
                const label = row.offset ? (row.stmtType === '매출' ? '미수상계' : '미지급상계')
                  : row.stmtType === '매출' ? '수금' : '지불';
                const cumul = row.cumul;
                const memo = [row.method, row.note].filter(Boolean).join(' · ');
                const payKey = `${row.paymentId}__${row.stmtType}`;   // 상계는 채권·채무 두 줄 — 데스크탑과 같은 이유
                return (
                  <div key={`m-pay-${payKey}`}
                    onClick={() => openPayTimelineRow(row.paymentId, row.src)}
                    className={`w-full px-4 py-3 flex flex-col gap-1.5 cursor-pointer ${row.stmtType === '매출' ? 'bg-lime-50/70' : 'bg-orange-50/70'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1">
                        {journalToggle(payKey)}
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
                    {expandedJournal.has(payKey) && row.entry && (
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
              const summary = itemSummary(stmtItems);
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
                    {cumul == null
                      ? <span className="text-[11px] font-black shrink-0 text-slate-300" title="거래처가 없는 전표">—</span>
                      : cumul !== 0 && (
                      cumul < 0
                        ? <span className="text-[11px] font-black shrink-0 text-slate-500 whitespace-nowrap">
                            −{fmt(Math.abs(cumul))}
                            <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-slate-100 align-middle">{overLabelOf(stmt.type)}</span>
                          </span>
                        : <span className={`text-[11px] font-black shrink-0 ${stmt.type === '매출' ? 'text-blue-600' : 'text-rose-600'}`}>잔액 {fmt(cumul)}</span>
                    )}
                  </div>
                  {canSettle(stmt) && (
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
          //  발생 손익은 분개에서 센다(financials.plOfJournals) — 갈래로 세면 대체전표가
          //  빠지고, 전표 총액으로 세면 부가세가 섞인다. 손익 화면과 같은 근거다.
          const sale = histTotals.incomeCash;
          const buy  = histTotals.costCash;
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
              {/*  **줄과 맞는 합계를 먼저 놓는다**(2026-09-07 사장님: "덧셈이 틀린거같다").
                   줄은 총액(세 포함)인데 손익은 공급가액이라, 손익만 띄워 두면 화면의 어느
                   숫자와도 안 맞아 덧셈이 틀린 걸로 보였다. 뜻이 다르니 둘 다 낸다. */}
              {(histTotals.saleSum > 0 || histTotals.buySum > 0) && (
                <span className="text-[9px] font-black text-slate-400 tracking-widest">전표</span>
              )}
              {histTotals.saleSum > 0 && cell('매출', histTotals.saleSum, 'text-blue-700')}
              {histTotals.buySum > 0 && cell('매입', histTotals.buySum, 'text-rose-700')}
              {/*  **'발생' 부터 한 줄 내린다**(2026-09-07 사장님). 전표(총액)와 발생(공급가액)은
                   뜻이 다른 값이라 한 줄에 이어 두면 같은 줄기로 읽힌다. 줄을 갈라 놓는다. */}
              {anyPl && <span className="basis-full h-0" aria-hidden />}
              {anyPl && (
                <span className="text-[9px] font-black text-slate-400 tracking-widest">
                  발생<span className="ml-1 font-bold normal-case tracking-normal text-slate-300">공급가액</span>
                </span>
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
      {/**
        * **자금 전표 창** — 수금·지불(전표에서 연 입출금)도, 이미 난 전표를 고치는 것도 하나다.
        * `key`로 열 때마다 새로 마운트한다 — 그래야 창이 폼을 되씻는 effect 없이 초기값만 읽는다.
        */}
      {cashModal && (
        <CashEntryModal
          key={cashModal.kind === '수정' ? cashModal.entry.id : cashModal.stmt.id}
          mode={cashModal}
          accountCodes={accountCodes}
          cashAccounts={activeCashAccounts}
          accountId={payAccountId}
          onAccountId={setPayAccountId}
          partnerBalances={partnerBalances}
          getBalance={getBalance}
          latestStatement={id => mergedStatements.find(s => s.id === id)}
          onClose={() => setCashModal(null)}
          onSettle={savePayment}
          onSaveEdit={saveEditCash}
          onDeleteEntry={onDeleteCashEntry}
        />
      )}

      {/* ── 빠른 수금/지불 모달 ── */}

      {/* ── 정기 고정비 생성 모달 ── */}
      {showRecurring && (
        <RecurringModal
          templates={fixedCostTemplates}
          accountCodes={accountCodes}
          partners={partners}
          //  같은 열쇠로 전표·자금 양쪽을 본다 — 어느 쪽으로 났든 두 번 내면 안 된다
          isIssued={key => mergedStatements.some(s => s.id === key || s.orderId === key)
            || cashEntries.some(e => e.id === key)}
          onClose={() => setShowRecurring(false)}
          onGenerate={onGenerateRecurringCosts}
          onCreateTemplate={onAddFixedCostTemplate}
          onUpdateTemplate={onUpdateFixedCostTemplate}
          onDeleteTemplate={onDeleteFixedCostTemplate}
        />
      )}

      {/**
        * **일반전표 발행 창** — 갈래가 여섯이라 화면이 통째로 바뀐다(출금·입금·대체·줄돈·받을돈·회사이체).
        * 무엇을 적었는지 정리해서 넘겨 주면, 실제로 쓰는 일은 여기(화면)가 한다.
        */}
      {showQuickPay && (
        <VoucherComposer
          companyId={companyId}
          initialDir='출금'
          partners={partners}
          accountCodes={accountCodes}
          accountGroups={accountGroups}
          cashAccounts={activeCashAccounts}
          fixedCostTemplates={fixedCostTemplates}
          cashEntries={cashEntries}
          statements={mergedStatements}
          partnerBalances={partnerBalances}
          getBalance={getBalance}
          cashAccountId={quickPayAccountId}
          onCashAccountId={setQuickPayAccountId}
          onClose={() => setShowQuickPay(false)}
          onAddCashEntry={onAddCashEntry}
          onAddIssuedStatement={onAddIssuedStatement}
          onAddFixedCostTemplate={onAddFixedCostTemplate}
          onAddForCompany={onAddForCompany}
          recordPayment={recordPayment}
          renderJournal={renderJournal}
        />
      )}

      {/* ── 계좌 관리 모달 (장부 흡수) ── */}
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
          <fieldset disabled={isSaving} aria-busy={isSaving} className="relative min-w-0 m-0 p-0 border-0 w-full h-[100dvh] sm:h-[80vh] sm:max-w-7xl flex flex-col bg-white sm:rounded-3xl shadow-2xl overflow-hidden">

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
                    onChange={e=>setPartnerSearch(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg pl-7 pr-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-40"/>
                </div>
                <select value={selectedClientId}
                  onChange={e=>{setSelectedClientId(e.target.value);setSelectedOrderIds([]);setEditablePrices({});setTaxExemptOverrides({});setSelectedConfirmedIds([]);}}
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
                <button onClick={()=>{setSelectedClientId('');setSelectedOrderIds([]);setEditablePrices({});setTaxExemptOverrides({});setManualItems([{name:'',spec:'',qty:'',price:'',isTaxExempt:false}]);setSelectedConfirmedIds([]);}}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-100 transition-all shrink-0">
                  <ChevronLeft size={12}/>거래처 변경
                </button>
                {createMode==='매출' && !editingStmt && (
                  <div className="ml-auto flex bg-slate-200 rounded-lg p-0.5 gap-0.5">
                    <button onClick={()=>{
                        // 주문 불러오기 = 주문 목록으로 복귀 (불러온 주문·수동행·로드상태 초기화, 거래처는 유지)
                        setManualMode(false);
                        setSelectedOrderIds([]);
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

            {/*  ── 주문/발주 고르기 ──
                 **양식이 아니라 워크플로**라 [OrderPicker](OrderPicker.tsx) 로 뺐다(2026-09-05).
                 붙들고 있는 화면 상태가 서른 개라, 평평하게 넘기지 않고 뜻으로 묶어 다섯으로 준다. */}
            <OrderPicker
              mode={{ createMode, manualMode, editingStmt }}
              pick={{ selectedClientId, selectedOrderId, selectedOrderIds }}
              filter={{ onlyActive, dateFrom, dateTo, orderDateQuick, activeVisible, partnerSearch }}
              data={{ activeOrders, partnerOrders, confirmedBySupplier, orderRequestsBySupplier,
                      confirmedOrders, orderRequests, mergedStatements, allItems, partners, isVouchered }}
              on={{ setSelectedClientId, setSelectedOrderIds, setManualMode, setManualItems,
                    setDateFrom, setDateTo, setOrderDateQuick, setActiveVisible, setTradeDate,
                    setLoadedPoIds, setWarnDuplicate, goCompose, handleOrderClick, poToManualRows }}
            />

            {/* ── 빠른 품목 입력 바 ── */}
            {/*  양식 쪽 문지기 — [OrderPicker](OrderPicker.tsx) 의 목록과 **정반대**여야 한다.
                 셋이 짝이라 한쪽만 고치면 목록과 양식이 같이 뜬다(2026-09-07). */}
            {selectedClientId && (manualMode || editingStmt) && (!editingStmt || isEditMode) && (() => {
              const qProduct = allItems.find(p => p.id === quickItemId);
              const selRow = selectedItemIdx!==null&&manualMode ? manualItems[selectedItemIdx] : null;
              const selItem = selectedItemIdx!==null&&!manualMode ? lineItems[selectedItemIdx] : null;
              const infoProduct = quickName ? qProduct
                : selRow ? allItems.find(p => p.id === selRow.itemId)
                : selItem ? allItems.find(p => p.id === selItem.itemId)
                : null;
              const productCost = infoProduct?.cost ?? 0;
              const salePrice = quickName ? (parseFloat(quickPrice)||0)
                : selRow ? (parseFloat(selRow.price)||0)
                : selItem ? selItem.price : 0;
              //  마진은 **공급가에서** 센다 — 부가세는 받아서 그대로 내는 돈이라 남는 게 아니다.
              //  세포함 단가로 나누면 부풀어 보인다(5,600/5,510 이 +1.6% 로 보이는데 실제는 −8.2%).
              const margin = (marginOf(salePrice, productCost, quickIsTaxExempt).marginRate * 100).toFixed(1);
              const qQty = parseFloat(quickQty)||0;
              const qPrc = parseFloat(quickPrice)||0;
              const { supply: qAmt, tax: qTax } = lineAmount(qQty, qPrc, quickIsTaxExempt);
              const quickResults = quickSearchOpen ? (() => {
                if (!quickName.trim()) return [];
                const q = quickName.toLowerCase();
                const partnerMatches = searchableRows.filter(r => {
                  const docN = r.product!.name.toLowerCase();
                  return matchesSearch(docN, q) || matchesSearch(r.product!.name, q);
                });
                if (partnerMatches.length > 0) return partnerMatches;
                return allItems
                  .filter(p => companyOf(p) === companyId && !isBoxStockItem(p) && matchesSearch(p.name + ' ' + (p.품목 ?? ''), q))
                  .map(p => {
                    const existingPc = (createMode === '매입' ? partnerIn : partnerOut).find(pc => pc.itemId === p.id && pc.partnerId === selectedClientId);
                    return {
                      pc: { id: existingPc?.id ?? p.id, itemId: p.id, partnerId: selectedClientId, price: existingPc?.price, taxType: existingPc?.taxType },
                      product: p,
                    };
                  });
              })() : [];
              const addQuickItem = () => {
                if (!quickName.trim()) return;
                const newRow: ManualRow = {itemId:quickItemId,name:quickName,spec:quickSpec,qty:quickQty.trim()||'1',price:quickPrice,isTaxExempt:quickIsTaxExempt,note:quickNote};
                setManualMode(true);
                setManualItems(prev=>{
                  const rows = prev.filter(r=>r.name.trim());
                  return [...rows,newRow];   // 빈 행은 안 붙인다 — 필요하면 '행 추가'
                });
                setQuickItemId(undefined);setQuickName('');setQuickSpec('');setQuickQty('');setQuickPrice('');setQuickNote('');setQuickSearchOpen(false);setQuickIsTaxExempt(false);
              };
              return (
                <div className="flex-shrink-0 border-b border-slate-100 px-5 py-2.5 bg-white space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <input type="text" value={quickName} placeholder="품목명..."
                        onChange={e=>{setQuickItemId(undefined);setQuickName(e.target.value);setQuickSearchOpen(true);}}
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
                                  const price = r.pc.price ?? 0;
                                  const taxType: '과세'|'면세' = r.pc.taxType === '면세' ? '면세' : '과세';
                                  // 선택 순간의 기본값을 따로 저장하면 최종 단가와 경합한다. 발행 경로에서 함께 쓴다.
                                  setQuickItemId(r.product!.id);setQuickName(docN);setQuickSpec(r.product!.spec||'');setQuickPrice(String(price||''));setQuickIsTaxExempt(taxType==='면세');setQuickSearchOpen(false);
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
                    {/*  **마진을 견주는 값을 같이 보인다**(2026-09-07 사장님: "마진율이 이상하다").
                         마진은 공급가액에서 세는데 옆에 세포함 단가만 보이니, 원가 4,021 · 단가 4,000
                         인데 −10.6% 로 떠서 셈이 틀린 것처럼 읽혔다(견주는 값은 3,636 이다). */}
                    <span>매출단가 <b className="text-slate-600">{salePrice>0?fmt(salePrice):'-'}</b>
                      {(() => {
                        if (!(salePrice > 0)) return null;
                        const { supply, showSupply } = priceParts(salePrice, quickIsTaxExempt);
                        return showSupply
                          ? <span className="ml-1 text-slate-400">(공급가 <b className="text-slate-500">{fmt(supply)}</b>)</span>
                          : null;
                      })()}
                    </span>
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
              const confirmPick = async () => {
                //  고른 것을 줄로 옮기는 셈은 shared/itemPick 에 있다 — 화면은 묻고 쓰기만 한다
                const { toAdd, unlinked } = pickLines(pickerQtys, pickerRows, linkedItemIds, pricePanelEdits);
                if (toAdd.length === 0) { setShowItemPicker(false); return; }
                /* **거래처에 안 붙은 품목을 골랐으면 물어본다.**
                   예 → 거래처 품목으로 붙인다(단가·과세도 같이). 다음부터 검색 없이 뜬다.
                   아니요 → 이번 전표에만 쓴다. 발행할 때 자동으로 붙는 길도 막는다. */
                if (unlinked.length && selectedClientId) {
                  const names = unlinked.map(r => `· ${r.product!.name}${r.product!.spec ? ` (${r.product!.spec})` : ''}`).join(String.fromCharCode(10));
                  const ok = window.confirm(
                    `${selectedClient?.name ?? '이 거래처'}에 연결된 품목이 아닙니다.

${names}

거래처에 연결할까요?

예 = 거래처 품목으로 등록(다음부터 바로 뜸)
아니요 = 이번 전표에만 추가`
                  );
                  if (ok) {
                    const dir = createMode === '매입' ? 'in' as const : 'out' as const;
                    for (const w of linkWrites(unlinked, selectedClientId, dir, pricePanelEdits)) {
                      await onUpsertPartnerItem?.(w);
                    }
                  } else {
                    setNoLinkIds(prev => { const n = new Set(prev); for (const r of unlinked) n.add(r.product!.id); return n; });
                  }
                }
                setManualMode(true);
                setManualItems(prev => {
                  const existing = prev.filter(r => r.name.trim());
                  return [...existing, ...toAdd];   // 빈 행은 안 붙인다 — 필요하면 '행 추가'
                });
                setShowItemPicker(false); setPickerSearch(''); setPickerQtys({});
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
            {selectedClientId && (manualMode || editingStmt) ? (
              <div className="flex-1 overflow-auto">
                {(!editingStmt || isEditMode) && lineItems.some(i => !i.itemId) && (
                  <p className="px-5 py-2 text-[11px] text-slate-500">
                    직접 적은 줄과 예전 전표는 품목을 목록에서 선택해야 단가·과세구분이 거래처에 저장됩니다.
                  </p>
                )}
                {/*  **칸 폭을 글자에 맞춘다**(2026-09-03 사장님) — 비율(%)로 두니 720px 안에서
                     품목명이 158px 밖에 안 돼 '참기름/병/분/전통/350ml' 이 잘렸다.
                     어차피 옆으로 미는 표다. 미는 김에 안 잘리는 게 맞다. */}
                <table className="w-full min-w-[1004px] text-left border-collapse table-fixed">
                  <colgroup>
                    <col style={{width:'40px'}}/>
                    <col style={{width:'240px'}}/>{/* 품목명 */}
                    <col style={{width:'84px'}}/>{/* 규격 */}
                    <col style={{width:'72px'}}/>{/* 수량 */}
                    <col style={{width:'88px'}}/>{/* 단가 */}
                    <col style={{width:'100px'}}/>{/* 공급가액 */}
                    <col style={{width:'88px'}}/>{/* 세액 */}
                    <col style={{width:'104px'}}/>{/* 합계 */}
                    <col style={{width:'148px'}}/>{/* 계정 — '800 일반매출' + 화살표가 들어가야 한다 */}
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
                          //  셈은 shared/lineAmount 한 곳에 있다 — 화면은 그리기만 한다
                          const { supply: sup, tax } = lineAmountOf(row.qty, row.price, row.isTaxExempt);
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
                                return { pc: { id: ex?.id ?? p.id, itemId: p.id, partnerId: selectedClientId, price: ex?.price, taxType: ex?.taxType }, product: p };
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
                                    onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,itemId:undefined,name:e.target.value}:r))}
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
                                            onMouseDown={()=>{setManualItems(prev=>prev.map((item,i)=>i===idx?{...item,itemId:r.product!.id,name:docN,spec:r.product!.spec||'',price:String(r.pc.price??0),isTaxExempt:r.pc.taxType==='면세'}:item));setActiveSearchRow(null);}}
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
                                      {row.qty}
                                    </span>
                                  : <div className="flex items-center gap-1">
                                      <input type="text" inputMode="decimal" placeholder="0" value={row.qty}
                                        onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,qty:e.target.value}:r))}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>
                                    </div>}
                              </td>
                              <td className="px-3 py-2 w-24">
                                {ro ? <span className="block text-right font-bold">{fmt(Number(row.price) || 0)}</span>
                                  : <input type="text" inputMode="decimal" placeholder="0" value={row.price}
                                      onChange={e=>setManualItems(prev=>prev.map((r,i)=>i===idx?{...r,price:e.target.value}:r))}
                                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>}
                              </td>
                              <td className={`px-3 py-2 text-right ${sup<0?'text-rose-600 font-bold':'text-slate-700'}`}>{sup!==0?fmt(sup):'-'}</td>
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
                              <td className={`px-3 py-2 text-right font-black ${(sup+tax)<0?'text-rose-600':'text-slate-800'}`}>{(sup+tax)!==0?fmt(sup+tax):'-'}</td>
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
                              {/*  **아직 아무도 안 정한 품목은 `-` 로 둔다**(2026-09-06 사장님).
                                   거래처–품목 연결에 taxType 이 없으면 그냥 과세로 떨어뜨리고 있었는데,
                                   정한 적 없는 것과 과세로 정한 것이 똑같이 보여서 안 정한 채로 나가도 몰랐다.
                                   누르면 과세 → 면세 → 과세 로 돈다. 한 번 누르면 그때부터 정해진 것이다. */}
                              <button onClick={()=>setTaxExemptOverrides(prev=>({...prev,[item.key]:item.taxUnknown?false:!item.isTaxExempt}))}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-black border transition-all ${
                                  item.taxUnknown?'bg-amber-50 text-amber-600 border-amber-300 hover:bg-amber-100'
                                  :item.isTaxExempt?'bg-indigo-100 text-indigo-700 border-indigo-200'
                                  :'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}
                                title={item.taxUnknown?'과세·면세를 정한 적이 없습니다 — 눌러서 정하세요':undefined}>
                                {item.taxUnknown?'-':item.isTaxExempt?'면세':fmt(item.tax)}
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
                  {/*  **전표 비고** — 합계 바로 밑(2026-09-03 사장님). 품목 줄이 아니라
                       전표 전체에 붙는 말이라 결제 조건·납기 같은 걸 적는다. 인쇄물에도 나간다. */}
                  <div className="min-w-[1004px] px-3 py-2.5 border-t border-slate-100 bg-slate-50/50">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">비고</p>
                    <textarea
                      value={stmtMemo}
                      onChange={e => setStmtMemo(e.target.value)}
                      placeholder="결제 조건, 납기 등 (선택)"
                      rows={2}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-400 resize-y" />
                  </div>
              </div>
            ) : (!selectedClientId && activeOrders.length === 0) ? (
              <div className="flex-1 flex items-center justify-center text-slate-200 bg-slate-50">
                <span className="text-2xl font-black">-</span>
              </div>
            ) : null}

            {/* ── 이 전표의 수금/지불 (전표 조회 시) — 한 줄 요약 ── */}
            {editingStmt && !isEditMode && (() => {
              // 수금은 거래처 단위로 자금원장에 적힌다. 이 전표에 얼마가 붙었는지는
              // 붙인 매칭(settlement)과 오래된 순 배분을 합친 결과(getBalance)로 본다.
              const bal = getBalance(editingStmt);
              const paid = editingStmt.totalAmount - bal;
              const label = editingStmt.type === '매출' ? '수금' : '지불';
              return (
                <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">이 전표 {label}</span>
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
                  {/* 내역 목록은 안 띄운다 — 거래처 기준이라 줄이 수십 개가 되어 전표를 통째로 가렸다.
                      그 거래처의 수금·지불을 훑는 건 장부(거래처원장)가 할 일이다.
                      여기선 이 전표에 얼마가 붙었는지(위 요약 한 줄)만 보면 된다. */}
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
            {(manualMode || editingStmt) && (
            <div className="flex items-center gap-4 px-5 py-3 border-t border-slate-100 bg-white flex-shrink-0 flex-wrap">
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                {editingStmt ? (
                  isEditMode ? (<>
                    <button onClick={handleSaveEdit} disabled={isSaving}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-700 transition-all">
                      <Save size={13}/>{isSaving ? '저장 중…' : '저장'}
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
                  {/* **발행하면서 바로 수금·지불.** 그 자리에서 받는 거래가 많은데, 전표를 끊고
                      목록에서 다시 찾아 누르는 건 같은 일을 두 번 하는 것이다.
                      금액은 전표 총액이 기본이고 고칠 수 있다(일부만 받는 거래). */}
                  <label className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-[11px] font-black cursor-pointer transition-all ${
                    issuePay ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-400'}`}>
                    <input type="checkbox" checked={issuePay}
                      onChange={e => { setIssuePay(e.target.checked); if (e.target.checked) setIssuePayAmount(String(Math.round(totalAmount))); }}
                      className="accent-emerald-600"/>
                    {createMode === '매출' ? '수금' : '지불'}도 함께
                  </label>
                  {issuePay && (
                    <div className="flex items-center gap-1">
                      <input inputMode="numeric" value={issuePayAmount}
                        onChange={e => setIssuePayAmount(e.target.value.replace(/[^\d]/g, ''))}
                        className="w-28 text-right border border-emerald-300 rounded-xl px-2.5 py-2 text-xs font-black tabular-nums outline-none focus:ring-2 focus:ring-emerald-300"/>
                      <span className="text-[10px] font-black text-slate-400">원</span>
                      {Math.round(Number(issuePayAmount) || 0) !== Math.round(totalAmount) && (
                        <button type="button" onClick={() => setIssuePayAmount(String(Math.round(totalAmount)))}
                          className="text-[10px] font-black text-emerald-600 hover:underline">전액</button>
                      )}
                    </div>
                  )}
                  <button onClick={handleIssue} disabled={isSaving}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all ${createMode==='매출'?'bg-blue-600 text-white hover:bg-blue-700':'bg-rose-600 text-white hover:bg-rose-700'}`}>
                    <Plus size={13} strokeWidth={3}/>{isSaving ? '저장 중…' : '저장'}
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

          </fieldset>
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
                  setSelectedOrderIds([o.id]);
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
