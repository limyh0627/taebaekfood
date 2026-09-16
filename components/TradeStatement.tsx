
import { cardNoLabel } from '../src/shared/cardNo';
import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import DateChipButton from '../src/shared/components/DateChipButton';
import { settleStatus } from '../src/features/admin/voucherMerge';
import { evidenceChoices, evidenceOf } from '../src/features/statements/domain/evidence';
import { toggleSort, sortRank, sortSummary, type TimelineSortColumn } from '../src/shared/timelineColumnSort';
import { today, dateOfLocal, weekMonday, weekSunday } from '../src/shared/day';
import { matchesSearch } from '../src/shared/hangul';
import { buildTaxonomy } from '../src/shared/taxonomy';
import {
  FileText, Printer, Search, CalendarDays,
  Package, ClipboardList, CheckCircle2, Edit2, Plus, X, ArrowLeft,
  Save, Download, CheckSquare,
  ChevronLeft, Share2, Check, Wallet, RotateCw, RotateCcw, Landmark, ArrowUp, ArrowDown, ArrowUpDown
} from 'lucide-react';
import { Order, Item, Partner, PartnerItem, OrderStatus, IssuedStatement, CompanyInfo, PaymentMethod, AccountCode, AccountGroup, CashAccount, CashEntry, Settlement, FixedCostTemplate, CompanyId } from '../types';
import { filterCodesForContext } from '../src/features/admin/financials';
import { partnerPriceWrites } from '../src/shared/partnerPriceSync';
import { isLatestForPartner } from '../src/shared/latestStatement';
import { manualLines, orderLines, lineTotals, resolveOrderItem, orderItemPrice, type LineItem, type ManualRow } from '../src/shared/statementLines';
import { buildStatementCommand, checkStatementCommand, type StatementCommand, type StatementRejectionCode } from '../src/features/statements/domain/statementCommand';
import { 서류당사자ById, 서류당사자스냅샷우선 } from '../src/shared/docParty';
import { partnerOrders as 거래처주문, activeOrders as 진행주문, activePartnerIds, ACTIVE_STATUSES } from '../src/shared/statementOrders';
import { rowKind as 갈래, rowCodes as 계정들, rowName as 상대이름,
  classifyRow as 성격판정,
  type TimelineRow, type StmtRow, type PayRow, type CashRow } from '../src/shared/timelineRows';
import { groupByMonth as 월별묶기 } from '../src/shared/groupByMonth';
import OrderPicker from './OrderPicker';
import { STATUS_LABEL, STATUS_COLOR } from '../src/shared/orderStatusStyle';
import { lineAmountOf } from '../src/shared/lineAmount';
import { splitPayment, owedNow } from '../src/shared/paymentSplit';
import { pickLines, linkWrites } from '../src/shared/itemPick';
import { useVoucherLedger } from '../src/features/admin/useVoucherLedger';
import CashEntryModal, { type CashModalMode, type SettleInput } from './voucher/CashEntryModal';
import RecurringModal from './voucher/RecurringModal';
import VoucherComposer from './voucher/VoucherComposer';
import StatementCompanyDialog from '../src/features/statements/ui/StatementCompanyDialog';
import StatementHistoryFilters from '../src/features/statements/ui/StatementHistoryFilters';
import StatementHistoryActions from '../src/features/statements/ui/StatementHistoryActions';
import StatementHistoryPagination from '../src/features/statements/ui/StatementHistoryPagination';
import StatementComposerHeader from '../src/features/statements/ui/StatementComposerHeader';
import StatementOrderDateFilter from '../src/features/statements/ui/StatementOrderDateFilter';
import StatementHistorySearchFields from '../src/features/statements/ui/StatementHistorySearchFields';
import { statementHistoryRowView } from '../src/features/statements/domain/statementHistoryRowView';
import { shipToOf, shipToSummary } from '../src/shared/shipTo';
import { StatementPaymentMobileRow, StatementPaymentTableRow } from '../src/features/statements/ui/StatementPaymentRow';
import { StatementCashMobileRow, StatementCashTableRow } from '../src/features/statements/ui/StatementCashRow';
import { StatementTradeMobileRow, StatementTradeTableRow } from '../src/features/statements/ui/StatementTradeRow';
import StatementPartnerBar from '../src/features/statements/ui/StatementPartnerBar';
import StatementQuickItemBar, { type StatementQuickItemResult } from '../src/features/statements/ui/StatementQuickItemBar';
import StatementItemPicker, { type StatementItemPickerRow } from '../src/features/statements/ui/StatementItemPicker';
import StatementOrderItemRows from '../src/features/statements/ui/StatementOrderItemRows';
import StatementManualItemRows, { type StatementManualSearchResult } from '../src/features/statements/ui/StatementManualItemRows';
import StatementActionBar from '../src/features/statements/ui/StatementActionBar';
import StatementSettlementSummary from '../src/features/statements/ui/StatementSettlementSummary';
import StatementExpensePresetRow from '../src/features/statements/ui/StatementExpensePresetRow';
import StatementDuplicateWarning from '../src/features/statements/ui/StatementDuplicateWarning';
import { useStatementItemEditor } from '../src/features/statements/hooks/useStatementItemEditor';
import { useStatementComposerSession } from '../src/features/statements/hooks/useStatementComposerSession';
import { useStatementHistoryFilters } from '../src/features/statements/hooks/useStatementHistoryFilters';
import { useStatementTimeline } from '../src/features/statements/hooks/useStatementTimeline';
import { useStatementJournal } from '../src/features/statements/hooks/useStatementJournal';
import { buildReceiptHtml, buildStatementPrintHtml, printStatementViaIframe } from '../src/features/statements/infrastructure/statementPrint';
import { buildIssuedStatementDraft } from '../src/features/statements/domain/statementDraft';
import { downloadStatementExcel } from '../src/features/statements/infrastructure/statementExcel';
import { quickItemMetrics } from '../src/features/statements/domain/quickItemModel';
import { stampFor, timeOfLocal, issuedMs, nextDocNo, claimDocNo } from '../src/shared/voucherStamp';
import type { VoucherKind } from '../src/shared/vouchers';
import { boxDerivedUnitPrice, unpackComponent, isBoxStockItem } from '../src/shared/orderUnits';
import { bomOf } from '../src/shared/bomIndex';
import { PurchaseOrder, poLines, ExpensePreset, companyOf } from '../src/shared/types';
import { unsettledStatements, unmatchedCash, partnerBalanceFromJournals, partnerCashParts } from '../src/features/admin/cashLedger';
import { AR, AP, journalizeCashEntry, settlementAccountCode } from '../src/shared/autoJournal';
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
  onAddIssuedStatement?: (stmt: IssuedStatement) => void | Promise<unknown>;
  /**
   * **전표 한 장을 한 덩이로 저장한다**(설계 §2, 3단계).
   *
   * 전표 본문·주문 발행표시·품목 원가·발주카드를 **하나라도 실패하면 전부 안 들어가게** 쓴다.
   * 전에는 넷을 차례로 저장해서, 전표는 들어갔는데 주문에 발행표시가 안 찍히면 그 주문이
   * 목록에 다시 떠 **전표가 두 장** 나갔다. 같은 명령을 두 번 보내면 두 번째는 `duplicate` 다.
   */
  onApplyStatement?: (input: {
    command: StatementCommand;
    statement: IssuedStatement;
    costUpdates: { itemId: string; price: number; beforeCost?: number; sourceLineIndex?: number }[];
    poIds: string[];
    newPoItems: { itemId: string; itemName: string; quantity: number; isBox: boolean; unit: string }[];
  }) => Promise<'applied' | 'duplicate'>;
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
  onAddIssuedStatement,
  onApplyStatement,
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
  const {
    editablePrices, setEditablePrices, taxExemptOverrides, setTaxExemptOverrides,
    pricePanelEdits, setPricePanelEdits, priceSaveState, setPriceSaveState,
    manualMode, setManualMode, manualItems, setManualItems, activeSearchRow, setActiveSearchRow,
    accountCodeOverrides, setAccountCodeOverrides, selectedItemIdx, setSelectedItemIdx,
    quickItemId, setQuickItemId, quickName, setQuickName, quickSpec, setQuickSpec,
    quickQty, setQuickQty, quickPrice, setQuickPrice, quickNote, setQuickNote,
    quickSearchOpen, setQuickSearchOpen, quickIsTaxExempt, setQuickIsTaxExempt,
    showItemPicker, setShowItemPicker, pickerSearch, setPickerSearch, pickerQtys, setPickerQtys,
    noLinkIds, setNoLinkIds,
  } = useStatementItemEditor();
  const {
    createMode, setCreateMode, selectedClientId, setSelectedClientId, selectedOrderIds, setSelectedOrderIds,
    partnerSearch, setPartnerSearch, onlyActive, setOnlyActive, activeVisible, setActiveVisible,
    dateFrom, setDateFrom, dateTo, setDateTo, orderDateQuick, setOrderDateQuick,
    tradeDate, setTradeDate, showPreview, setShowPreview, stmtMemo, setStmtMemo,
    loadedPoIds, setLoadedPoIds, manageExpense, setManageExpense, tradeNote, setTradeNote,
    issuePay, setIssuePay, issuePayAmount, setIssuePayAmount,
  } = useStatementComposerSession();
  const {
    mainTab, setMainTab, histFrom, setHistFrom, histTo, setHistTo, histKind, setHistKind,
    histAccount, setHistAccount, taxonomyRows, acctPickerOpen, setAcctPickerOpen,
    acctQuery, setAcctQuery, histSearch, setHistSearch, histPartner, setHistPartner,
    partnerPickerOpen, setPartnerPickerOpen, partnerQuery, setPartnerQuery,
    acctAxis, setAcctAxis, acctBranch, setAcctBranch, acctGroup, setAcctGroup,
    histQuick, setHistQuick, historyPage, setHistoryPage, histSort, setHistSort,
    setQuickRange, moveRange: moveHistoryRange, resetFilters: resetHistoryFilters,
  } = useStatementHistoryFilters(defaultTab ?? 'history');

  // ── 전표 생성 오버레이 ──

  // ── 거래처/주문 선택 ──
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
  const selectedOrderId = selectedOrderIds[0] ?? '';

  // ── 기간 필터 (주문 선택) ── 금주(월~일) 디폴트

  // ── 거래 일자 ──


  // ── 미리보기 ──

  // ── 인라인 단가 수정 ──

  // ── 과세/면세 수동 오버라이드 (undefined = PC 기본값 사용) ──

  // ── 단가 DB 관리 패널 ──

  // ── 직접 입력 모드 ──
  /** 전표 비고 — 합계 밑에 적는다. 품목이 아니라 전표 전체에 붙는 말이다. */
  /**
   * `side`가 달린 줄 = **양변 전표(일반전표)**. 기초이월·감가상각처럼 차·대를 직접 세우는 것.
   * 안 실어 나르면 저장 한 번에 side가 사라지고, autoJournal이 짐작을 안 하므로
   * 그 전표의 분개가 통째로 안 선다(미광팩 기초 미지급이 그렇게 비어 있었다).
   */
  // ── 매입: 선택해서 불러온 발주카드 id 목록. 발행 시 이 PO들의 linkedStatementId에 전표 id 연결 + 입고대기 전환 ──
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
  /**
   * **저장이 안 됐을 때 뜻이 통하는 말로 바꾼다.**
   *
   * 2026-09-11 사장님이 받은 창에는 `Missing or insufficient permissions.` 만 적혀 있었다.
   * 그건 **로그인이 풀렸다**는 뜻인데(규칙은 인증만 되면 다 열려 있다) 글만 봐서는 알 수 없어
   * "왜 실패하는거야" 가 된다. 무엇을 하면 되는지까지 적어 준다.
   */
  const 저장실패문구 = (error: any): string => {
    const 원문 = String(error?.message ?? error ?? '');
    const 로그인풀림 = /permission|insufficient|unauthenticated/i.test(원문);
    return 로그인풀림
      ? [
          '로그인이 풀려서 저장하지 못했습니다.',
          '',
          '입력 내용은 그대로 있습니다. 화면을 새로고침(F5)한 뒤 다시 저장해 주세요.',
          '계속 이러면 인터넷 연결을 확인해 주세요.',
        ].join('\n')
      : ['전표 또는 거래처 단가 저장에 실패했습니다. 입력 내용은 유지됩니다. 다시 저장해 주세요.', 원문].join('\n');
  };

  // ── 주문 불러오기 모드 계정코드 오버라이드 (key → code) ──
  // ── 자주 쓰는 비용 항목(택배비·상차비·기타) 프리셋 관리 모드 ──
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

  // ── 빠른 품목 입력 행 ──

  // ── 품목 선택 팝업 ──
  // 팝업 내 수량 임시 입력: { [itemId]: qty }
  //  피커에서 "연결할까요?"에 **아니요**를 누른 품목 — 이번 전표에만 쓰고 거래처엔 안 붙인다.
  //  발행할 때 단가·계정을 거래처에 자동 저장하는 길이 따로 있어서, 여기 적어 두지 않으면
  //  아니요를 눌러도 발행하는 순간 결국 붙어 버린다.

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

  /**
   * **전표일자 칸** — 눌러서 그 자리에서 날짜를 바꾼다(2026-09-15 사장님:
   * "전표일자에 일자 캘린더 버튼으로 달아서 그냥 날짜 변경할 수 있게 해줘").
   *
   * 달력 단추는 **주문 리스트가 쓰던 것 그대로**다(`DateChipButton`) — 같은 날 사장님:
   * "캘린더도 주문 쪽에서 쓰던거 그대로 들고오지". 비슷한 것을 여기 새로 그려 두면
   * 같은 일이 두 모양이 된다.
   *
   * **달을 넘기면 한 번 묻는다.** 분개는 전표에서 그때그때 세우므로 날짜를 따라 저절로 옮겨
   * 가고 전표번호 도장도 받는 쪽이 다시 찍지만(`statementEditPatch`·`cashEditPatch`),
   * 달이 바뀌면 **부가세 신고 달과 월 마감이 같이 바뀐다** — 조용히 넘길 일이 아니다.
   *
   * 시각은 단추 밖 아랫줄이다(사장님: "전표일자 뒤에 시간은 캘린더에서 빼고 밑에 줄로 넣어") —
   * 눌러서 바꾸는 건 날짜뿐이라, 단추 안에 있으면 시각도 바뀌는 줄 안다.
   */
  const 전표일자칸 = (
    날짜: string,
    바꾸기: (다음: string) => void,
    고칠수있나: boolean,
    찍힌시각?: string,
  ) => {
    const 날 = String(날짜 ?? '').slice(0, 10);
    const 시각 = 찍힌시각 ? String(찍힌시각).slice(11, 16) : '';
    const 시각줄 = 시각 ? <span className="mt-0.5 block font-mono text-[11px] text-slate-400">{시각}</span> : null;
    if (!고칠수있나) return <span className="font-mono text-slate-500">{날}{시각줄}</span>;
    return (
      <span className="inline-block">
        <DateChipButton
          label="전표일자"
          value={날}
          text={날}
          onChange={다음 => {
            if (!다음 || 다음 === 날) return;
            /*  **언제나 묻는다**(2026-09-15 사장님: "날짜 바꾸면 알람띄워서 확정 받고 바꿔").
                처음엔 달이 바뀔 때만 물었는데, 달력은 손이 스치기만 해도 날이 바뀐다 —
                같은 달 안이라도 전표일자가 틀리면 그 날 장부가 어긋난다.
                달을 넘길 때는 **왜 더 큰일인지** 한 줄 더 붙인다. */
            const 달바뀜 = 다음.slice(0, 7) !== 날.slice(0, 7);
            const 물음 = `전표일자를 ${날} → ${다음} 로 바꿉니다.`
              + (달바뀜 ? '\n\n달이 바뀌어 부가세 신고 달과 월 마감이 함께 달라집니다.' : '')
              + '\n\n바꿀까요?';
            if (!window.confirm(물음)) return;
            바꾸기(다음);
          }}
        />
        {시각줄}
      </span>
    );
  };

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
  /**
   * **그 전표가 어느 배송지로 간 건인가**(2026-09-16 사장님: "업체명 밑에 회색 글씨로
   * 배송지명만 표시해주면 어떠냐").
   *
   * 전표는 `orderId` 로 주문과 이어진다(쉼표로 여럿 담는다). 그 주문들의 배송지를 모아
   * 적는다 — 하나면 그 이름, 섞이면 `포천 외 2`. 사장님이 A 로 정하셨다: "실무에서 C로
   * 거진 처리하기 때문에 A로 해놔도 될거 같아"(C = 배송지별로 끊는다).
   *
   * 자금·수금 줄은 주문이 없어 빈 글자가 되고, 그때는 줄을 아예 안 그린다.
   */
  const 줄배송지 = useCallback((row: TimelineRow): string | undefined => {
    if (row.kind !== 'stmt') return undefined;
    const 전표 = row.data;
    const 그거래처 = partners.find(p => p.id === 전표.partnerId);
    if (!그거래처?.shipTos?.length || !전표.orderId) return undefined;
    const 이름들 = String(전표.orderId).split(/[,\s]+/).filter(Boolean)
      .map(id => shipToOf(그거래처, orders.find(o => o.id === id)?.shipToId)?.name);
    return shipToSummary(이름들) || undefined;
  }, [partners, orders]);

  const classifyRow = useCallback((row: TimelineRow) => 성격판정(row, codeType), [codeType]);

  const { expandedJournal, journalOfStmt, renderJournal, journalTr, journalToggle } =
    useStatementJournal(accountCodes, partners, codeName);
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
  // 계좌 관리 모달 (장부에서 흡수)
  // ── 회사 설정 모달 ──
  const [showCompanyModal, setShowCompanyModal] = useState(false);

  // ── 세금계산서 탭 ──
  const taxPrintRef = useRef<HTMLDivElement>(null);

  // ── 발행내역 필터 ──
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
  /**
   * 계정과목 필터 — **한 값**으로 든다. '' | axis:손익 | group:<id> | type:자산 | code:<코드>
   *
   * 드릴다운으로 층을 내려가게 했더니, 이름을 아는 계정 하나를 찾는 데도 세 번을 골라야 했다.
   * 계정은 수십 개지만 **찾는 사람은 이름을 안다.** 그래서 검색되는 목록 하나로 바꿨고,
   * 계층은 줄마다 경로로 보여 준다(손익 › 영업외비용 › 951 이자비용).
   */
  //  분류(itemTaxonomy) — 품목 선택 피커를 목록 화면과 같은 순서로 세우는 데 쓴다.
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
  /**
   * 계정 고르는 층 — 손익 > 이익·비용 > 계정,  재무 > 자산·부채·자본 > 계정.
   * '…전체'로 한 층을 통째로 고르는 항목은 뒀더니 무엇으로 걸렀는지 안 읽혔다.
   * 층을 눌러 좁히고, 마지막에 계정 하나를 고른다.
   */
  //  묶음(재료비·판관비…) 층 — 갈래를 고른 뒤 여기서 한 번 더 좁힌다. 계정과목은 그 다음이다.
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
  // 발행내역 페이지네이션
  const HIST_PAGE_SIZE = 50;

  /**
   * **장부는 훅이 들고 있다** — 어디까지 떠오고 잔액을 어떻게 세는지는 `useVoucherLedger`.
   * 이 화면의 모든 기능이 같은 목록·같은 잔액을 봐야 해서 한 군데로 모았다.
   */
  const {
    mergedStatements, journalBySource, partnerBalances,
    getBalance, canSettle, isVouchered, isFetchingHistory, forgetStatement,
  } = useVoucherLedger({ companyId, issuedStatements, cashEntries, settlements, accountCodes, histFrom, histTo });

  /**
   * **표 머리를 눌러 세운다**(2026-09-15 사장님: "업체명이랑 이런거 눌러서 정렬 거는거
   * 아직도 안되노"). 셈은 `timelineColumnSort` 한 곳이 한다 — 줄 갈래가 셋이라 칸마다
   * 값을 꺼내는 길이 다른데, 그 길은 `timelineRows` 가 이미 안다.
   *
   * 위쪽 조회조건(기간·갈래·거래처)은 **무엇을 불러올지**를 정하고, 여기 머리는
   * **불러온 것을 어떻게 세울지**만 정한다. 둘은 겹치지 않는다.
   */

  /** 화면이 셈해 그리는 칸(수금/지불·증빙)은 그 글자로 세운다 — 표에 보이는 대로 서야 한다. */
  const 정렬글 = useCallback((row: TimelineRow, column: TimelineSortColumn): string | undefined => {
    if (row.kind !== 'stmt') return column === 'settle' || column === 'evidence' ? '\uffff' : undefined;
    if (column === 'settle') return settleStatus(row.data, getBalance(row.data)).label;
    if (column === 'evidence') return evidenceChoices(row.data.type).length ? evidenceOf(row.data) : '\uffff';
    return undefined;
  }, [getBalance]);

  /**
   * 머리 한 칸 — 누르면 **뒤에 붙는다**(겹치기). 이미 걸린 칸을 누르면 방향만 뒤집는다.
   * 몇 번째로 걸렸는지 숫자로 보여 준다 — 안 보이면 왜 이 차례인지 알 수가 없다.
   */
  const 머리 = (column: TimelineSortColumn, label: string, extra = '') => {
    const 차례 = sortRank(histSort, column);
    const 걸림 = 차례 > 0;
    const 지금 = histSort.find(s => s.column === column);
    return (
      <button
        type="button"
        onClick={() => { setHistSort(이전 => toggleSort(이전, column)); setHistoryPage(1); }}
        title={걸림 ? `${label} ${지금?.dir === 'asc' ? '오름' : '내림'} — 눌러서 뒤집기` : `눌러서 ${label} 순 더하기`}
        className={`-mx-1 flex min-w-0 items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-slate-200/70 ${걸림 ? 'text-indigo-700' : ''} ${extra}`}
      >
        <span className="truncate whitespace-nowrap">{label}</span>
        {걸림 ? (<>
          {지금?.dir === 'asc' ? <ArrowUp size={11} className="shrink-0" /> : <ArrowDown size={11} className="shrink-0" />}
          {/*  **몇 번째인지** — 겹쳐 걸면 순서가 결과를 바꾼다. 하나만 걸렸으면 숫자가 군더더기다. */}
          {histSort.length > 1 && <span className="shrink-0 rounded bg-indigo-100 px-1 text-[9px] tabular-nums text-indigo-700">{차례}</span>}
        </>) : <ArrowUpDown size={11} className="shrink-0 text-slate-300" />}
      </button>
    );
  };


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
    if (manualMode) {
      //  드롭다운에서 안 고르고 이름만 친 줄도, 그 거래처 연결 품목과 **정확히 같으면** 이어 준다.
      //  안 이으면 `partnerPriceWrites` 가 그 줄을 건너뛰어 단가·과세면세가 조용히 안 저장된다.
      const 연결 = stmtType === '매입' ? partnerIn : partnerOut;
      const 연결품목 = allItems
        //  박스는 뺀다 — 낱개와 이름이 같으면 낱개 단가가 박스에 붙는다(해피유통 300ml 사고).
        .filter(p => !isBoxStockItem(p) && 연결.some(pc => pc.itemId === p.id && pc.partnerId === selectedClientId))
        .map(p => ({ itemId: p.id, name: p.name }));
      return manualLines(manualItems, stmtType, 연결품목);
    }
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
  const partySnapshot = useMemo(() => {
    const { sup, buy } = 서류당사자ById({
      isSale: stmtType === '매출', companyInfo, partners,
      partnerId: selectedClientId, partnerName: selectedClient?.name,
    });
    return { supplier: sup, buyer: buy };
  }, [stmtType, companyInfo, partners, selectedClientId, selectedClient]);

  // ── 발행 처리 ──
  /**
   * **막는 규칙을 한 곳에서 묻는다**(설계 §2, 2026-09-13).
   *
   * 전에는 `handleIssue` 가 묻고 `markIssued` 가 한 번 더 막는 것이 **두 벌로 쓰여 있었다.**
   * 한쪽만 고치면 다른 쪽이 남아, 화면에서는 막혔는데 인쇄·세금계산서 경로로는 나가는 식이
   * 된다. 규칙은 [statementCommand](../src/features/statements/domain/statementCommand.ts) 의
   * 순수 함수가 정하고, 여기서는 **그 답으로 말투만 고른다.** 막는 것 자체는 전과 똑같다.
   */
  const 발행검사 = useMemo(() => checkStatementCommand(buildStatementCommand({
    statementId: issueIdentityRef.current?.id ?? 'preview',
    partnerId: selectedClientId, partnerName: selectedClient?.name,
    tradeDate, type: stmtType, docNo, memo: stmtMemo,
    orderIds: selectedOrderIds, lines: lineItems, partySnapshot,
  })), [selectedClientId, selectedClient, tradeDate, stmtType, docNo, stmtMemo, selectedOrderIds, lineItems, partySnapshot]);
  const 걸린줄들 = (code: StatementRejectionCode) =>
    발행검사.rejections.find(r => r.code === code)?.lineNames ?? [];
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
    /*
     * **옛 전표를 고칠 때는 거래처 단가를 안 건드린다**(2026-09-09 사장님).
     * 거래처 단가는 "지금 파는 값"이라, 6월 전표의 오타를 고쳤다고 오늘 값이 6월로
     * 돌아가면 안 된다. 지금 고치는 게 그 거래처의 마지막 거래일 때만 되민다.
     */
    const 이번전표 = { id: editingStmt?.id, partnerId: selectedClientId, type, tradeDate };
    const { upserts, costUpdates } = partnerPriceWrites({
      type, partnerId: 이번전표.partnerId, lines: lineItems, items: allItems,
      partnerItems: [...partnerOut, ...partnerIn], noLinkIds,
      isLatest: isLatestForPartner({ this: 이번전표, all: mergedStatements }),
    });
    for (const u of upserts) await onUpsertPartnerItem(u);
    for (const c of costUpdates) await onUpdateItemCost?.(c.itemId, c.price);
  }, [onUpsertPartnerItem, onUpdateItemCost, selectedClientId, lineItems, allItems, partnerOut, partnerIn, noLinkIds, editingStmt, tradeDate, mergedStatements]);

  /** 전표를 만들고 **그 전표를 돌려준다** — 발행하면서 바로 수금·지불하려면 그 객체가 필요하다. */
  const markIssued = async (): Promise<IssuedStatement | null> => {
    if (!selectedClientId || lineItems.length === 0) return null;
    // 발행 차단(백스톱) — 인쇄·세금계산서·엑셀 경로에서도 계정 미설정/단가 0이면 발행 기록 안 함
    if (걸린줄들('NO_ACCOUNT_CODE').length) { alert('계정과목이 설정되지 않은 품목이 있어 발행할 수 없습니다.'); return null; }
    if (걸린줄들('ZERO_PRICE').length) { alert('단가가 0인 품목이 있어 발행할 수 없습니다.'); return null; }
    //  고른 주문 **전부**에 발행 표시를 찍는다 — 한 건만 찍으면 나머지가 목록에 다시 뜬다
    if (!onApplyStatement) throw new Error('전표 저장 기능이 연결되지 않았습니다.');
    const identity = issueIdentityRef.current ?? {
      id: `stmt-${Date.now()}`, docNo: claimDocNo(tradeDate, mergedStatements),
    };
    issueIdentityRef.current = identity;
    const stmt = buildIssuedStatementDraft({
      identity, tradeDate, type: stmtType, partnerId: selectedClientId,
      partnerName: selectedClient?.name || '', orderIds: selectedOrderIds, memo: stmtMemo,
      totals: { supply: totalSupply, tax: totalTax, amount: totalAmount },
      partySnapshot, lines: lineItems, allItems,
    });    /*  **한 덩이로 저장한다**(설계 §2, 2026-09-13).
     *
     *  전에는 여기서 넷을 차례로 저장했다 — 전표 본문 → 거래처 단가·품목 원가 →
     *  주문 발행표시 → 발주카드. 앞이 되고 뒤가 엎어지면 **주문에 발행표시가 안 찍혀
     *  그 주문이 목록에 다시 뜨고, 다시 누르면 전표가 두 장 나간다.**
     *  이제 하나라도 실패하면 전부 안 들어가고, 같은 명령을 두 번 보내면 두 번째는 그냥 돌아온다.
     *
     *  **거래처 단가만 커밋 뒤에 민다** — 그 길에는 박스 품목을 등록하면 낱개도 같이 등록하는
     *  규칙이 붙어 있어 통째로 옮기면 그 규칙이 사라진다. 단가는 "지금 파는 값"의 스냅샷이라
     *  늦게 반영돼도 전표·주문의 짝은 이미 맞다. */
    //  매입이면 발주카드도 같이 — 고른 카드가 있으면 잇고, 없으면 새 입고대기 카드를 세운다.
    //  비용 줄(택배비·상차비)은 발주·입고 대상이 아니라 뺀다.
    const newPoItems = stmtType === '매입' && loadedPoIds.length === 0 && selectedClientId
      ? lineItems
          .map(item => {
            const product = allItems.find(p => p.id === item.itemId);
            return product ? { itemId: product.id, itemName: item.name, quantity: item.qty, isBox: false, unit: product.unit || '개' } : null;
          })
          .filter((it): it is NonNullable<typeof it> => it !== null)
      : [];

    const command = buildStatementCommand({
      statementId: stmt.id, partnerId: selectedClientId, partnerName: selectedClient?.name,
      tradeDate, type: stmtType, docNo: stmt.docNo, memo: stmtMemo,
      orderIds: selectedOrderIds, lines: lineItems, partySnapshot,
    });
    //  전표에 찍힌 단가·계정이 품목 원가로 가는 것(매입)은 명령과 같이 커밋한다.
    const { costUpdates: 계산된원가 } = partnerPriceWrites({
      type: stmtType, partnerId: selectedClientId, lines: lineItems, items: allItems,
      partnerItems: [...partnerOut, ...partnerIn], noLinkIds,
      isLatest: isLatestForPartner({ this: { id: editingStmt?.id, partnerId: selectedClientId, type: stmtType, tradeDate }, all: mergedStatements }),
    });

    const costUpdates = 계산된원가.map(c => ({
      ...c,
      beforeCost: Number(allItems.find(i => i.id === c.itemId)?.cost ?? 0),
      sourceLineIndex: lineItems.findIndex(line => line.itemId === c.itemId),
    }));
    const 결과 = await onApplyStatement({
      command, statement: stmt, costUpdates,
      poIds: stmtType === '매입' ? loadedPoIds : [],
      newPoItems,
    });
    //  두 번째 클릭이면 아무것도 안 들어갔다 — 단가까지 또 밀 이유가 없다.
    if (결과 === 'applied') await applyPriceSync(stmtType);
    //  전표에 찍힌 단가·계정을 거래처 단가로 되민다 — 발행이든 수정이든 같은 셈이다
    //  (shared/partnerPriceSync). 예전엔 세 벌로 쓰여 있어 서로 갈렸다.
    // (원본 주문 자동반영 기능 제거됨 — 전표 편집은 원본 주문을 건드리지 않는다.
    //  박스→낱개 변환 때문에 낱개가 주문에 이중으로 붙는 문제도 함께 방지.)
    return stmt;
  };

  const handleIssue = async () => {
    if (saveBusyRef.current) return;
    // 계정과목 미설정 품목이 있으면 발행 차단 (매출은 800 기본이라 대개 매입에서 걸림)
    const 계정없음 = 걸린줄들('NO_ACCOUNT_CODE');
    if (계정없음.length > 0) {
      alert(`계정과목이 설정되지 않은 품목이 ${계정없음.length}건 있습니다.\n(${계정없음.slice(0, 3).join(', ')}${계정없음.length > 3 ? ' 외' : ''})\n계정을 설정해야 발행할 수 있습니다.`);
      return;
    }
    // 단가 0(미입력) 품목이 있으면 발행 차단.
    //  ※ 0만 막는다. 음수는 통과 — 할인·반품 줄(단가 또는 수량이 마이너스)이
    //    전표 한 장에 단독으로 설 수 있어야 한다.
    const 단가0 = 걸린줄들('ZERO_PRICE');
    if (단가0.length > 0) {
      alert(`단가가 0인 품목이 ${단가0.length}건 있습니다.\n(${단가0.slice(0, 3).join(', ')}${단가0.length > 3 ? ' 외' : ''})\n단가를 입력해야 발행할 수 있습니다.`);
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
      alert(저장실패문구(e));
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
      partySnapshot,
      items: lineItems.map(i => ({
        ...(i.itemId ? { itemId: i.itemId } : {}),
        ...(i.lineKind ? { lineKind: i.lineKind } : {}),
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
      alert(저장실패문구(e));
    } finally {
      saveBusyRef.current = false;
      setIsSaving(false);
    }
  };

  const handlePrint = () => {
    const html = buildStatementPrintHtml(lineItems, totalSupply, totalTax, totalAmount, stmtType, selectedClient?.name || '', docNo, dateStr, stmtMemo.trim(), selectedClient?.id || '', partySnapshot, { companyInfo, partners, allItems });
    printStatementViaIframe(html, `${stmtType}전표`);
    // 인쇄는 '출력'만 — 발행(저장)은 '저장' 버튼(markIssued) 한 곳에서만. 저장된 전표만 인쇄 가능.
  };

  const handleDetailPrint = (stmt: IssuedStatement) => {
    const d = new Date(stmt.tradeDate + 'T00:00:00');
    const ds = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
    const html = buildStatementPrintHtml(stmt.items as any, stmt.totalSupply, stmt.totalTax, stmt.totalAmount, stmt.type, stmt.partnerName, stmt.docNo, ds, stmt.memo ?? '', stmt.partnerId, stmt.partySnapshot, { companyInfo, partners, allItems });
    printStatementViaIframe(html, `${stmt.type}전표`);
  };

  const handleReceipt = () => printStatementViaIframe(buildReceiptHtml({
    companyInfo, tradeDate, docNo, partnerName: selectedClient?.name || '', items: lineItems,
    totals: { supply: totalSupply, tax: totalTax, amount: totalAmount },
  }), '영수증');
  const handleExcel = () => downloadStatementExcel({
    type: stmtType, docNo, dateLabel: dateStr, tradeDate,
    partnerName: selectedClient?.name || '', items: lineItems,
    totals: { supply: totalSupply, tax: totalTax, amount: totalAmount },
  });
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
      /*  **셋으로 돈다** — 미설정(`-`) → 과세 → 면세 → 미설정(2026-09-14 사장님).
          전에는 면세↔과세 둘뿐이라, **정한 적 없는 것을 한 번 누르면 '과세'로 굳었다.**
          되돌릴 길이 없어서 "안 정했다"는 상태가 조용히 사라졌다. */
      const 다음: '과세' | '면세' | null = !pc.taxType ? '과세' : pc.taxType === '과세' ? '면세' : null;
      await onUpsertPartnerItem?.({ ...pc, Direction: pc.Direction ?? (createMode === '매입' ? 'in' : 'out'), taxType: 다음 });
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

  /**
   * **누적잔액을 세울 때 쓰는 방향** — 받을 돈 `+1`, 줄 돈 `-1`(2026-09-15 사장님:
   * "거래처 누적잔액이 절대값으로 하면 되냐" → "B로 해").
   *
   * 잔액은 거래처별·방향별로 따로 쌓여 **매입도 양수로 남는다.** 그냥 세우면 매출 미수와
   * 매입 미지급이 같은 자리에 서는데, 정반대 뜻이라 잔액순으로 훑는 뜻이 없어진다.
   * **화면에 찍히는 숫자는 그대로 두고 세울 때만 뒤집는다** — 한 번 내림차순으로
   * `받을 돈 많은 곳 → … → 줄 돈 많은 곳` 이 된다.
   *
   * 채권이냐 채무냐는 **분개가 이미 안다**(`arapOf`) — 갈래(type)로 가르면 기초 이월처럼
   * '대체'로 적힌 미수가 통째로 샌다.
   * 자금 줄은 제 전표가 없어 분개로 못 가린다 — 그 거래처가 여태 어느 쪽이었는지로 본다.
   */
  const 거래처방향 = useMemo(() => {
    const 표 = new Map<string, '채권' | '채무'>();
    for (const st of mergedStatements) {
      const side = arapOf(st).side;
      if (side && st.partnerId && !표.has(st.partnerId)) 표.set(st.partnerId, side);
    }
    return 표;
  }, [mergedStatements, arapOf]);

  const 잔액방향 = useCallback((row: TimelineRow): 1 | -1 => {
    if (row.kind === 'stmt') return arapOf(row.data).side === '채무' ? -1 : 1;
    if (row.kind === 'pay') return row.stmtType === '매입' ? -1 : 1;
    return 거래처방향.get(row.entry.partnerId ?? '') === '채무' ? -1 : 1;
  }, [arapOf, 거래처방향]);


  const {
    allRows: allTimelineRows,
    filteredRows: filteredHistory,
    kindCounts: historyKindCounts,
    shownPartnerNames: partnerShown,
    pageRows: pagedHistory,
    totalPages: historyTotalPages,
    totals: histTotals,
    receivableSummary,
  } = useStatementTimeline({
    statements: mergedStatements, cashEntries, arapOf,
    from: histFrom, to: histTo, kind: histKind, account: histAccount,
    partner: histPartner, search: histSearch, matchAccount, codeName,
    sort: histSort, sortText: 정렬글, balanceSign: 잔액방향,
    page: historyPage, setPage: setHistoryPage, partnerQuery,
    journalBySource, accountCodes, codeType, partnerBalances,
  });
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

  const selectStatementPartner = (partnerId: string) => {
    setSelectedClientId(partnerId); setSelectedOrderIds([]); setEditablePrices({});
    setTaxExemptOverrides({}); setSelectedConfirmedIds([]);
  };
  const clearStatementPartner = () => {
    setSelectedClientId(''); setSelectedOrderIds([]); setEditablePrices({}); setTaxExemptOverrides({});
    setManualItems([{ name: '', spec: '', qty: '', price: '', isTaxExempt: false }]); setSelectedConfirmedIds([]);
  };
  const changeStatementInputMode = (manual: boolean) => {
    setManualMode(manual);
    if (manual) return;
    // 주문 목록으로 돌아갈 때 앞서 불러온 줄이 남으면 다른 주문에 섞여 다시 발행된다.
    setSelectedOrderIds([]); setLoadedPoIds([]);
    setManualItems([{ name: '', spec: '', qty: '', price: '', isTaxExempt: false }]);
    setEditablePrices({}); setTaxExemptOverrides({}); setAccountCodeOverrides({}); setSelectedConfirmedIds([]);
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

      {/*  세금계산서 발행은 [TaxStatement](TaxStatement.tsx) 가 한다.
           여기 있던 364줄은 `{false && ...}` 로 꺼둔 채 남아 있었다 — 지웠다(2026-09-05).
           꺼진 코드를 남겨 두면 **살아 있는 줄 알고 고치게 된다** (실제로 그랬다). */}

      {/* ── 회사 정보 설정 모달 ── */}
      {showCompanyModal && <StatementCompanyDialog initial={companyInfo}
        onClose={() => setShowCompanyModal(false)} onSave={onSaveCompanyInfo}/>}

      {mainTab === 'history' && <>

      {/* 보유자금·계좌 잔액은 여기 안 띄운다 — 장부(현금출납장)가 그걸 쥔다.
          전표 화면은 전표를 끊는 곳이다. 같은 숫자를 두 곳에 두면 어느 쪽이 진짜인지 흐려진다. */}

      {/* 주문 목록과 같은 순서로 찾는다: 검색조건 → 거래유형 → 조회 결과 → 표. */}
      <StatementHistoryFilters
        quickRange={histQuick} from={histFrom} to={histTo} kind={histKind} kindCounts={historyKindCounts}
        onQuickRange={setQuickRange}
        onFrom={date => { setHistFrom(date); setHistQuick(''); }}
        onTo={date => { setHistTo(date); setHistQuick(''); }}
        onMove={moveHistoryRange} onKind={setHistKind} onReset={resetHistoryFilters}>
        <StatementHistorySearchFields
          partner={histPartner} partnerOpen={partnerPickerOpen} partnerQuery={partnerQuery} partnerShown={partnerShown}
          onPartnerOpen={setPartnerPickerOpen} onPartnerQuery={setPartnerQuery} onPartner={setHistPartner}
          account={histAccount} accountOpen={acctPickerOpen} accountQuery={acctQuery}
          accountAxis={acctAxis} accountBranch={acctBranch} accountGroup={acctGroup}
          accountPicked={acctPicked} accountShown={acctShown} accountItems={accountItems}
          onAccountOpen={setAcctPickerOpen} onAccountQuery={setAcctQuery} onAccountAxis={setAcctAxis}
          onAccountBranch={setAcctBranch} onAccountGroup={setAcctGroup} onAccount={setHistAccount}
          search={histSearch} onSearch={setHistSearch}/>
      </StatementHistoryFilters>

      <StatementHistoryActions
        resultCount={filteredHistory.length}
        fetching={isFetchingHistory}
        onCreateSale={() => openCreate('매출')}
        onCreatePurchase={() => openCreate('매입')}
        onCreateCash={() => openCashModal('출금')}
        onOpenRecurring={onGenerateRecurringCosts ? () => setShowRecurring(true) : undefined}
        onOpenCompany={() => setShowCompanyModal(true)}
      />

      {/*  **무엇으로 세워 뒀는지 적고, 푸는 길을 옆에 둔다**(2026-09-15 사장님: "얘도 무슨 정렬인지
           보이고 초기화 버튼 있어야지"). 머리를 여러 번 눌러 겹쳐 두면 왜 이 차례인지 잊는다.
           머리를 눌러서는 정렬이 안 빠진다 — 푸는 것은 여기 하나다. */}
      {histSort.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-[11px] font-bold text-slate-400">정렬</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
            {sortSummary(histSort)}
          </span>
          <button
            type="button"
            onClick={() => { setHistSort([]); setHistoryPage(1); }}
            className="inline-flex min-h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] font-black text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            <RotateCcw size={11} aria-hidden="true" />정렬 해제
          </button>
        </div>
      )}

      {/* ── 발행내역 테이블 ── */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        {filteredHistory.length === 0 ? (
          <div className="py-16 text-center text-slate-300 text-sm font-bold">
            <FileText size={32} className="mx-auto mb-2 opacity-40"/>
            발행된 전표가 없습니다
          </div>
        ) : (<>
          <table className="hidden w-full min-w-[980px] text-left md:table [&_th:not(:last-child)]:border-r [&_th:not(:last-child)]:border-slate-300 [&_td:not(:last-child)]:border-r [&_td:not(:last-child)]:border-slate-200">
            <thead>
              {/*  **구분은 상자 없이 글자만**(2026-09-15 사장님: "구분에서 매출 이런것도 박스에서
                   꺼내 답답하다"). 알약 딱지가 좁은 칸 안에서 양옆 여백까지 먹어 글자가 눌렸다 —
                   갈래는 **색만으로도** 읽힌다(매출 파랑 · 매입 빨강 · 입금 초록 · 지불 주황).

                   **칸 차례는 사장님이 정한다**(2026-09-15: "업체명 거래내역 금액 거래처누적잔액
                   비고 이런식으로 가자"). 무엇을 거래했는지를 금액보다 앞에 두어, 줄을 왼쪽에서
                   오른쪽으로 읽으면 "누가 · 무엇을 · 얼마에 · 남은 잔액" 순으로 읽힌다.

                   **구분 칸은 글자 너비만큼만**(사장님: "지금 구분칸이 너무 넓고") — 폭을 안 주면
                   표가 남는 자리를 여기 다 몰아줘서, 정작 긴 업체명·거래내역이 눌렸다.
                   `w-px` + `whitespace-nowrap` 이 "내용만큼만" 이라는 뜻이다. */}
              <tr className="border-b-2 border-slate-400 bg-slate-100">
                <th className="w-px px-3 py-2.5 text-[13px] font-black text-slate-600 whitespace-nowrap">{머리('date', '전표일자')}</th>
                {/*  **담당자**(2026-09-15 사장님) — 누가 끊었나. 예전 전표는 비어 있다.
                     자금 줄은 `cashEntries.createdBy`, 전표 줄은 `issuedStatements.createdBy`. */}
                <th className="w-px px-3 py-2.5 text-[13px] font-black text-slate-600 whitespace-nowrap">{머리('owner', '담당자')}</th>
                <th className="w-px px-3 py-2.5 text-[13px] font-black text-slate-600 whitespace-nowrap">{머리('kind', '구분')}</th>
                {/*  **업체명·거래내역은 너비를 묶는다**(2026-09-15 사장님: "업체명 너비 좀 줄이고",
                     "거래내역 열도 너비 좀 줄여"). 폭을 안 주면 표가 남는 자리를 이 둘에 다 몰아줘
                     한 줄이 화면을 가로지른다. 넘치는 글자는 잘리고 마우스를 올리면 전문이 뜬다. */}
                <th className="w-[180px] px-3 py-2.5 text-[13px] font-black text-slate-600">{머리('partner', '업체명')}</th>
                <th className="w-[240px] px-3 py-2.5 text-[13px] font-black text-slate-600">거래내역</th>
                {/*  **숫자 칸은 널널하게**(2026-09-15 사장님: "금액이랑 누적잔액 칸을 조금 널널하게 둬") —
                     `w-px`(내용만큼)로 조여 두니 자릿수 많은 금액이 칸 끝에 딱 붙어 읽기 답답했다.
                     너비를 정해 두면 줄마다 숫자 오른쪽 끝이 세로로 맞아 눈으로 크기를 견줄 수 있다. */}
                <th className="w-[150px] px-4 py-2.5 text-[13px] font-black text-slate-600 whitespace-nowrap">{머리('amount', '금액', 'ml-auto')}</th>
                <th className="w-[160px] px-4 py-2.5 text-[13px] font-black text-slate-600 whitespace-nowrap">{머리('cumul', '거래처 누적잔액', 'ml-auto')}</th>
                {/*  **수금 상태를 글자로 세운다**(사장님: "수금 상태 (미수 / 완료 / 부분수금) …
                     이거 열로 하나 추가하자"). 전에는 `수금처리` 단추가 붙었는지로만 짐작해야 했다 —
                     단추가 없으면 다 낸 것인지, 애초에 받을 것이 없는 전표인지 가릴 수 없었다. */}
                <th className="w-px px-3 py-2.5 text-[13px] font-black text-slate-600 whitespace-nowrap">{머리('settle', '수금/지불')}</th>
                {/*  **세무 증빙**(2026-09-15 사장님: "매출에 대한 세무 증빙 처리 여부를 즉시
                     확인하여 누락을 방지합니다"). 끊었는지 안 끊었는지가 표에 안 보여,
                     신고 때가 되어야 빠진 것을 찾았다. 그 자리에서 골라 바꾼다. */}
                <th className="w-px px-3 py-2.5 text-[13px] font-black text-slate-600 whitespace-nowrap">{머리('evidence', '증빙')}</th>
                {/*  **비고는 반으로**(2026-09-15 사장님: "비고 반토막 나게 나머지들 더 키워") —
                     폭을 안 주면 남는 자리를 비고가 다 먹는데, 정작 거기 적힌 글은 짧다.
                     자리를 업체명·거래내역·숫자 칸에 넘긴다. */}
                <th className="w-[110px] px-3 py-2.5 text-[13px] font-black text-slate-600">{머리('note', '비고')}</th>
                {/*  **작업 칸은 내용만큼 벌어져야 한다**(2026-09-15 사장님: "이렇게 안되게 하고") —
                     `w-px` 만 주고 줄바꿈을 안 막았더니 '수금처리' 가 한 글자씩 세로로 쪼개졌다.
                     `w-px` 는 "제일 좁게"라는 뜻이라, 안 쪼개진다고 알려 줘야(`whitespace-nowrap`)
                     비로소 글자 너비만큼 벌어진다. */}
                {/*  **삭제 칸은 없앴다**(2026-09-15 사장님: "삭제버튼은 없애 열에서") —
                     줄마다 휴지통이 서 있어 눈이 그리로 갔고, 표를 훑다 잘못 누르기도 쉬웠다.
                     지우는 일은 줄을 눌러 여는 창에서 한다(자금은 수정창, 전표는 상세창). */}
              </tr>
            </thead>
            {/*  **몸통 글씨는 여기 한 번**(12px) — 칸마다 따로 적어 12px·11px 이 섞여 있었다.
                 한 번 10px 로 줄였다가 사장님이 "조금씩만 더 키워 20% 정도만" 하셔서 12px 이다
                 (머리는 13px). 한 곳에서 정하니 이렇게 통째로 키울 수 있다. 바탕색은 안 깐다. */}
            <tbody className="divide-y divide-slate-200 text-[12px]">
              {pagedHistory.map(row => {
                const view = statementHistoryRowView(row, codeName, 줄배송지);
                if (row.kind === 'cash') {
                  const lines = (row.entry.lines ?? []).filter(line => line.accountCode && line.amount !== 0);
                  const portion = accountPortion(row);
                  const shownAmount = portion != null && portion !== row.amount ? portion : row.amount;
                  const partial = portion != null && portion !== row.amount;
                  const kindOf = (code?: string, amount = 1): string | null => {
                    const type = code ? codeType.get(code) : undefined;
                    if (type === '비용' || type === '수익') return type;
                    const shrink = row.dir === '출금' ? amount > 0 : amount < 0;
                    if (type === '부채') {
                      const loan = /차입금/.test(codeName.get(code!) ?? '');
                      return shrink ? (loan ? '상환' : '반환') : (loan ? '차입' : '예수');
                    }
                    if (type === '자산') return shrink ? '처분' : '자산';
                    return null;
                  };
                  const parts = lines.length ? lines.map(line => ({ code: line.accountCode, amount: line.amount }))
                    : row.accountCode ? [{ code: row.accountCode, amount: row.amount }] : [];
                  const classifications = [...new Set(parts.map(part => kindOf(part.code, part.amount)).filter((label): label is string => !!label))];
                  const unallocated = row.entry.partnerId && !lines.length && !row.accountCode
                    ? Math.max(0, unmatchedCash(row.entry, settlements)) : 0;
                  return <StatementCashTableRow key={`cash__${view.key}`} view={view} direction={row.dir}
                    shownAmount={shownAmount} partial={partial} unallocated={unallocated} classifications={classifications}
                    dateCell={전표일자칸(row.date, 날짜 => onUpdateCashEntry?.(row.entry.id, { date: 날짜 }), !!onUpdateCashEntry, row.entry.createdAt)}
                    journalToggle={journalToggle(view.key)} onOpen={onUpdateCashEntry ? () => openEditCash(row.entry) : undefined}
                    journalPreview={expandedJournal.has(view.key)
                      ? journalTr(`je__cash__${view.key}`, journalizeCashEntry(row.entry), { kind: rowKind(row), docNo: row.entry.docNo, date: row.date, headPartner: row.partnerName })
                      : undefined}/>;
                }
                if (row.kind === 'pay') {
                  const payEntry = row.entry;
                  return <StatementPaymentTableRow key={`pay__${view.key}`} view={view} statementType={row.stmtType}
                    dateCell={전표일자칸(row.date, 날짜 => payEntry && onUpdateCashEntry?.(payEntry.id, { date: 날짜 }), !!payEntry && !!onUpdateCashEntry, payEntry?.createdAt)}
                    journalToggle={journalToggle(view.key)} onOpen={() => openPayTimelineRow(row.paymentId, row.src)}
                    journalPreview={expandedJournal.has(view.key) && payEntry
                      ? journalTr(`je__pay__${view.key}`, journalizeCashEntry(payEntry),
                          { kind: payEntry.dir, docNo: payEntry.docNo, date: row.date, headPartner: row.partnerName })
                      : undefined}/>;
                }
                const stmt = row.data;
                const portion = accountPortion(row);
                const partial = portion != null && portion !== stmt.totalAmount;
                const settle = settleStatus(stmt, getBalance(stmt));
                const choices = evidenceChoices(stmt.type);
                return <StatementTradeTableRow key={view.key} statement={stmt} view={view}
                  shownAmount={partial ? portion! : view.amount} partial={partial} settle={settle} canSettle={canSettle(stmt)}
                  evidenceChoices={choices} evidence={evidenceOf(stmt)}
                  dateCell={전표일자칸(stmt.tradeDate, 날짜 => onUpdateIssuedStatement?.(stmt.id, { tradeDate: 날짜 }), !!onUpdateIssuedStatement, stmt.issuedAt)}
                  journalToggle={journalToggle(view.key)} onOpen={() => openEdit(stmt)} onSettle={() => openPayModal(stmt)}
                  onEvidence={onUpdateIssuedStatement ? evidence => onUpdateIssuedStatement(stmt.id, { evidence }) : undefined}
                  journalPreview={expandedJournal.has(view.key)
                    ? journalTr(`je__${view.key}`, journalOfStmt(stmt), { kind: stmt.type === '비용' ? '대체' : stmt.type, docNo: stmt.docNo, date: stmt.tradeDate, headPartner: stmt.partnerName })
                    : undefined}/>;
              })}
            </tbody>
          </table>

          {/* ── 모바일 카드 목록 ── */}
          <div className="md:hidden divide-y divide-slate-100">
            {pagedHistory.map(row => {
              const view = statementHistoryRowView(row, codeName, 줄배송지);
              if (row.kind === 'cash') {
                return <StatementCashMobileRow key={`m-cash-${view.key}`} view={view} direction={row.dir}
                  journalToggle={journalToggle(view.key)} onOpen={onUpdateCashEntry ? () => openEditCash(row.entry) : undefined}
                  onDelete={onDeleteCashEntry ? () => { if (window.confirm('이 자금 전표를 삭제할까요?')) onDeleteCashEntry(row.entry.id); } : undefined}
                  journalPreview={expandedJournal.has(view.key)
                    ? <div className="mt-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70" onClick={event => event.stopPropagation()}>{renderJournal(journalizeCashEntry(row.entry), true)}</div>
                    : undefined}/>;
              }
              if (row.kind === 'pay') {
                return <StatementPaymentMobileRow key={`m-pay-${view.key}`} view={view} statementType={row.stmtType}
                  journalToggle={journalToggle(view.key)} onOpen={() => openPayTimelineRow(row.paymentId, row.src)}
                  onDelete={() => deletePayTimelineRow(row.paymentId, row.src)}
                  journalPreview={expandedJournal.has(view.key) && row.entry
                    ? <div className="mt-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70" onClick={event => event.stopPropagation()}>{renderJournal(journalizeCashEntry(row.entry), true)}</div>
                    : undefined}/>;
              }
              const stmt = row.data;
              const issuedDate = new Date(stmt.issuedAt);
              const dateLabel = `${view.date} ${String(issuedDate.getHours()).padStart(2, '0')}:${String(issuedDate.getMinutes()).padStart(2, '0')}`;
              return <StatementTradeMobileRow key={`m-${view.key}`} statement={stmt} view={view} dateLabel={dateLabel}
                canSettle={canSettle(stmt)} journalToggle={journalToggle(view.key)}
                onOpen={() => openEdit(stmt)} onSettle={() => openPayModal(stmt)}
                journalPreview={expandedJournal.has(view.key)
                  ? <div className="mt-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70" onClick={event => event.stopPropagation()}>{renderJournal(journalOfStmt(stmt), true)}</div>
                  : undefined}/>;
            })}
          </div>
        </>)}
        {/* ── 하단 합계 (현재 필터·기간 기준) — 매출·매입·수금·지불 항상 표시 ── */}
        {filteredHistory.length > 0 && (() => {
          //  발생 손익은 분개에서 센다(financials.plOfJournals) — 갈래로 세면 대체전표가
          //  빠지고, 전표 총액으로 세면 부가세가 섞인다. 손익 화면과 같은 근거다.
          const sale = histTotals.incomeCash;
          const buy  = histTotals.costCash;
          /*  **숫자는 다 검정이다**(2026-09-15 사장님: "숫자는 다 검정색으로 써라").
              매출 파랑·매입 빨강·수금 연두·지불 주황으로 칠해 놓으니 합계 줄이 색판이 됐고,
              **빨간 숫자가 손실처럼 읽혔다** — 매입은 손실이 아니라 그냥 산 돈이다.
              이름표에만 색을 남긴다. 무엇의 합계인지는 이름이 알려 주면 된다. */
          const cell = (label: string, val: number, cls: string) => (
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-black uppercase tracking-widest ${cls}`}>{label}</span>
              <span className="text-sm font-black text-slate-800">{fmt(val)}</span>
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
        <StatementHistoryPagination page={historyPage} totalPages={historyTotalPages}
          totalCount={filteredHistory.length} pageSize={HIST_PAGE_SIZE} onPage={setHistoryPage}/>
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

            <StatementComposerHeader mode={createMode} twoSided={isTwoSided}
              editingDocNo={editingStmt?.docNo} editMode={isEditMode}
              partnerName={selectedClient?.name} partnerPhone={selectedClient?.phone}
              //  셈은 `allPartnerBalances`(분개 기준) 한 곳 — 거래처 원장과 같은 숫자여야 한다.
              balance={selectedClient ? partnerBalances.get(selectedClient.id) : undefined}
              tradeDate={tradeDate} onTradeDate={setTradeDate}
              onNew={() => { closeCreate(); setTimeout(() => setCreateMode(stmtType), 50); }} onClose={closeCreate}/>

            <StatementPartnerBar partners={availableClients} selectedPartnerId={selectedClientId}
              search={partnerSearch} sale={createMode === '매출'} editing={!!editingStmt}
              onlyActive={onlyActive} manualMode={manualMode} onSearch={setPartnerSearch}
              onSelect={selectStatementPartner} onClear={clearStatementPartner}
              onOnlyActive={() => setOnlyActive(value => !value)} onManualMode={changeStatementInputMode}/>

            {/* ── 날짜 필터 (거래처 선택 전 개요) — 거래처 선택 시 UI와 통일 ── */}
            {createMode === '매출' && !selectedClientId && (
              <StatementOrderDateFilter quick={orderDateQuick} from={dateFrom} to={dateTo}
                onChange={(from, to, quick) => { setDateFrom(from); setDateTo(to); setOrderDateQuick(quick); }}/>
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
              const qQty = parseFloat(quickQty)||0;
              const qPrc = parseFloat(quickPrice)||0;
              const metrics = quickItemMetrics({ quantity: qQty, unitPrice: qPrc, cost: productCost, taxExempt: quickIsTaxExempt });
              const qAmt = metrics.supply, qTax = metrics.tax;
              const quickResults: StatementQuickItemResult[] = quickSearchOpen ? (() => {
                if (!quickName.trim()) return [];
                const q = quickName.toLowerCase();
                const partnerMatches = searchableRows.filter(r => {
                  const docN = r.product!.name.toLowerCase();
                  return matchesSearch(docN, q) || matchesSearch(r.product!.name, q);
                });
                if (partnerMatches.length > 0) {
                  return partnerMatches.map(row => ({ pc: row.pc, product: row.product! }));
                }
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
              return <StatementQuickItemBar name={quickName} spec={quickSpec} quantity={quickQty} price={quickPrice}
                note={quickNote} searchOpen={quickSearchOpen} results={quickResults} productCost={productCost}
                salePrice={salePrice} unitSupply={metrics.unitSupply} supply={qAmt} tax={qTax}
                marginRate={metrics.marginRate} showUnitSupply={metrics.showUnitSupply} formatAmount={fmt}
                onNameChange={value=>{setQuickItemId(undefined);setQuickName(value);setQuickSearchOpen(true);}}
                onNameFocus={()=>setQuickSearchOpen(true)} onNameBlur={()=>setTimeout(()=>setQuickSearchOpen(false),150)}
                onSpecChange={setQuickSpec} onQuantityChange={setQuickQty} onPriceChange={setQuickPrice}
                onNoteChange={setQuickNote} onSelect={r=>{
                  const price = r.pc.price ?? 0;
                  setQuickItemId(r.product.id);setQuickName(r.product.name);setQuickSpec(r.product.spec||'');
                  setQuickPrice(String(price||''));setQuickIsTaxExempt(r.pc.taxType==='면세');setQuickSearchOpen(false);
                }} onAdd={addQuickItem}
                onOpenPicker={()=>{setShowItemPicker(true);setPickerSearch('');setPickerQtys({});}}/>;
            })()}

            {/* ── 품목 선택 팝업 ── */}
            {showItemPicker && (() => {
              // 검색어 없으면 등록 품목만(깔끔), 검색하면 전품목 대상(반제품·원료·부자재 포함)
              const q=pickerSearch.trim().toLowerCase();
              const filtered: StatementItemPickerRow[] = (!q
                ? searchableRows
                : pickerRows.filter(r=>matchesSearch((r.product!.name)+' '+(r.product!.품목??''), q)))
                .map(row => ({ pc: row.pc, product: row.product! }));
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
              return <StatementItemPicker rows={filtered} search={pickerSearch} quantities={pickerQtys}
                priceEdits={pricePanelEdits} priceSaveState={priceSaveState} onSearchChange={setPickerSearch}
                onToggleItem={itemId=>setPickerQtys(prev=>{const next={...prev};if(next[itemId])delete next[itemId];else next[itemId]='1';return next;})}
                onQuantityChange={(itemId,value)=>setPickerQtys(prev=>({...prev,[itemId]:value}))}
                onPriceChange={(id,value)=>{setPricePanelEdits(prev=>({...prev,[id]:value}));setPriceSaveState(state=>{const next={...state};delete next[id];return next;});}}
                onSavePrice={savePcPrice} onToggleTax={togglePcTax} onClose={()=>setShowItemPicker(false)} onConfirm={confirmPick}/>;
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
                        <StatementManualItemRows rows={activeRows} readOnly={ro} selectedIndex={selectedItemIdx}
                          activeSearchIndex={activeSearchRow} statementType={stmtType} accountCodes={stmtCodes}
                          formatAmount={fmt} searchResults={row=>{
                            if (!row.name.trim()) return [];
                            const query = row.name.toLowerCase();
                            const linked = searchableRows.filter(result => matchesSearch(result.product!.name, query));
                            if (linked.length > 0) return linked.map(result => ({ pc: result.pc, product: result.product! }));
                            const source = createMode === '매입' ? partnerIn : partnerOut;
                            return allItems.filter(item => !isBoxStockItem(item) && matchesSearch(item.name + ' ' + (item.품목 ?? ''), query))
                              .map(item => {
                                const existing = source.find(pc => pc.itemId === item.id && pc.partnerId === selectedClientId);
                                return { pc: { id: existing?.id ?? item.id, price: existing?.price, taxType: existing?.taxType }, product: item } as StatementManualSearchResult;
                              });
                          }} onSelect={setSelectedItemIdx}
                          onChange={(index,patch)=>setManualItems(prev=>prev.map((row,i)=>i===index?{...row,...patch}:row))}
                          onSearchFocus={setActiveSearchRow} onSearchBlur={()=>setTimeout(()=>setActiveSearchRow(null),150)}
                          onChooseProduct={(index,result)=>{setManualItems(prev=>prev.map((row,i)=>i===index?{...row,itemId:result.product.id,name:result.product.name,spec:result.product.spec||'',price:String(result.pc.price??0),isTaxExempt:result.pc.taxType==='면세'}:row));setActiveSearchRow(null);}}
                          onRemove={index=>setManualItems(prev=>prev.filter((_,i)=>i!==index))}/>
                        {!ro && <StatementExpensePresetRow presets={expensePresets} managing={manageExpense}
                          canAdd={!!onAddExpensePreset} canDelete={!!onDeleteExpensePreset} onAddRow={addExpenseRow}
                          onDeletePreset={id=>onDeleteExpensePreset?.(id)} onToggleManaging={()=>setManageExpense(value=>!value)}
                          onAddBlankRow={()=>setManualItems(prev=>[...prev,{name:'',spec:'',qty:'',price:'',isTaxExempt:false}])}
                          onCreatePreset={async()=>{
                            const name=window.prompt('비용 항목 이름 (예: 택배비)')?.trim();
                            if(!name||!onAddExpensePreset)return;
                            const priceText=window.prompt(`'${name}' 기본 단가 (없으면 비워두기)`,'')?.replace(/[^\d.]/g,'')??'';
                            const price=priceText?Number(priceText):undefined;
                            const exempt=window.confirm('면세 항목인가요?\n확인=면세, 취소=과세');
                            await onAddExpensePreset({name,...(price?{price}:{}),taxType:exempt?'면세':'과세'});
                          }}/>}
                      </>);
                    })() : <StatementOrderItemRows items={lineItems} selectedIndex={selectedItemIdx}
                      editablePrices={editablePrices} accountCodes={stmtCodes} formatAmount={fmt}
                      onSelect={setSelectedItemIdx}
                      onPriceChange={(key,value)=>setEditablePrices(prev=>({...prev,[key]:value}))}
                      onTaxChange={(key,value)=>setTaxExemptOverrides(prev=>({...prev,[key]:value}))}
                      onAccountChange={(key,code)=>setAccountCodeOverrides(prev=>({...prev,[key]:code}))}/>}
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

            {/* ── 이 전표의 수금/지불 ── */}
            {editingStmt && !isEditMode && (() => {
              const balance = getBalance(editingStmt);
              return <StatementSettlementSummary type={editingStmt.type as '매출'|'매입'} totalAmount={editingStmt.totalAmount}
                balance={balance} formatAmount={fmt} overLabel={overLabelOf(editingStmt.type)}
                onSettle={()=>{setCreateMode(null);openPayModal(editingStmt);}}/>;
            })()}
            {/* ── 하단 액션 바 ── */}
            {(manualMode || editingStmt) && <StatementActionBar editing={!!editingStmt} editMode={isEditMode}
              canIssue={canIssue} saving={isSaving} mode={createMode} issuePay={issuePay}
              issuePayAmount={issuePayAmount} totalAmount={totalAmount}
              onIssuePayChange={checked=>{setIssuePay(checked);if(checked)setIssuePayAmount(String(Math.round(totalAmount)));}}
              onIssuePayAmountChange={setIssuePayAmount} onSaveEdit={handleSaveEdit}
              onDelete={()=>{if(editingStmt&&window.confirm('이 전표를 삭제하시겠습니까?')){deleteStatement(editingStmt.id);closeCreate();}}}
              onEdit={()=>setIsEditMode(true)} onPrint={handlePrint} onIssue={handleIssue} onExcel={handleExcel}/>}
            <style>{`@media print{.no-print{display:none!important;}}`}</style>

          </fieldset>
        </div>
      )}


      {/* ── 중복 발행 경고 모달 ── */}
      {warnDuplicate && <StatementDuplicateWarning statement={warnDuplicate.stmt} formatAmount={fmt}
        onOpenExisting={()=>{openEdit(warnDuplicate.stmt);setWarnDuplicate(null);}}
        onClose={()=>setWarnDuplicate(null)} onReissue={()=>{
          const order=warnDuplicate.order;
          const purchaseOrder=warnDuplicate.po;
          setWarnDuplicate(null);
          if(purchaseOrder){
            setManualItems([...poToManualRows(purchaseOrder),{name:'',spec:'',qty:'',price:'',isTaxExempt:false}]);
            setLoadedPoIds(prev=>Array.from(new Set([...prev,(purchaseOrder as any).id].filter(Boolean))));
            setTradeDate(today());setManualMode(true);
          }else if(order){
            setSelectedOrderIds([order.id]);setTradeDate(today());setShowPreview(false);setEditablePrices({});setTaxExemptOverrides({});
          }
        }}/>}
      </>}

    </div>
  );
};

export default TradeStatement;
