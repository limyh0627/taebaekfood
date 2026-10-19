import type { AccountManagementReference } from '../../shared/accountManagementCommand';
import type { AccountCode, AccountGroup } from '../../shared/types';
import {prepareDirectoryDelete,confirmDirectoryDelete,inspectDirectoryDelete,cancelDirectoryDelete,pendingDirectoryDeletes,directoryDeleteReferences,type DirectoryDeleteInput,type DirectoryDeleteOutcome,type DirectoryDeletePrepared} from '../../shared/services/directoryDeleteWrites';
import type {DirectoryDeleteReference} from '../../shared/directoryDeleteCommand';
import {submitPartnerItemTerms,pendingPartnerItemTerms,partnerItemTermsReferences,inspectPartnerItemTerms,cancelPartnerItemTerms,type PartnerItemTermsInput,type PartnerItemTermsOutcome} from '../items/infrastructure/partnerItemTermsWrites';
import type {PartnerItemTermsReference} from '../../shared/partnerItemTermsCommand';
import {submitEmployeeEdit,pendingEmployeeEdits,employeeEditReferences,inspectEmployeeEdit,cancelEmployeeEdit,type EmployeeEditInput,type EmployeeEditScope} from '../hr/infrastructure/employeeEditWrites';
import type {EmployeeEditReference} from '../../shared/employeeEditCommand';
import type {ItemEditorProgress,ItemEditorSaveResult} from '../items/application/itemEditorSave';
import {captureItemEditorOpening,pendingItemEditorPlans,itemEditorReferences,submitItemEditorSave,inspectItemEditorSave,continueItemEditorSave,cancelItemEditorSave,discardItemEditorCopy,type ItemEditorSaveInput} from '../items/infrastructure/itemEditorWrites';
import {submitOrderEdit,pendingOrderEdits,orderEditReferences,inspectOrderEdit,cancelOrderEdit,discardOrderEditCopy} from '../orders/infrastructure/orderEditWrites';
import type { OrderEditSaveResult } from '../orders/hooks/useOrderEditorDraft';
import { saveOrderEdit, type OrderEdit } from '../orders/application/orderEditService';
import { primaryCommitted, type SaveOutcome } from '../../shared/saveOutcome';
import { saveAccountCodeEdit, saveAccountGroupEdit, saveAccountCodeCreate, saveAccountGroupCreate, deleteAccountCode, deleteAccountGroup, readAccountOperationReferences, inspectAccountOperation, retryAccountOperation, cancelAccountOperation, discardAccountOperationCopy, type AccountOperationContext, type AccountEditContext, type AccountCodeEditPatch, type AccountGroupEditPatch } from './infrastructure/accountManagementWrites';
import type { LeaveScope } from '../hr/infrastructure/leaveRequestWrites';
import { submitLeaveRequests, submitLeaveAction, inspectLeaveAction, cancelLeaveAction, pendingLeaveActions, pendingLeaveRequests, pendingLeaveGroups, inspectLeaveRequest, cancelLeaveRequest, listLeaveReferences, cancelLeaveReference } from '../hr/infrastructure/leaveRequestWrites';
import type { LeaveMutationAction } from '../../shared/leaveRequestCommand';
import { DATE_RANGE_LAYOUT_CLASS } from '../../shared/components/DateRangeInputs';
import QueryFilterPanel, {QUERY_FILTER_LABEL_CLASS,QUERY_FILTER_CONTROL_CLASS, QUERY_FILTER_FIELD_CLASS, QUERY_FILTER_SEARCH_CLASS, QUERY_FILTER_DATE_CLASS } from '../../shared/components/QueryFilterPanel';
import RawDocUsageDetailModal from '../../../components/RawDocUsageDetailModal';
import {collectRawDocOilUsage,rawDocNoteSummary,rawDocProductionReplacement,type RawDocLedgerRecord,type RawDocUsageSelection,type RawDocUsageContribution} from '../../shared/rawDocUsageDetail';
import { useMenuPreferencesController } from './hooks/useMenuPreferencesController';
import { AppTopBar } from './ui/AppTopBar';
import { useMenuIdentity } from './hooks/useMenuIdentity';
import ActionButton from '../../shared/components/ActionButton';
import { NavGroup, NavItem } from './ui/NavigationPrimitives';
import {buildOrderProductionRecordPlan} from '../../shared/orderProductionRecordPlan';
const HelpChat = React.lazy(() => import('../../../components/HelpChat'));
import {readOemReceiptEntry,markOemReceiptPreCallFailure} from '../../shared/oemReceiptPending';
import {getOemReceiptRecoveryContext} from '../../shared/services/firebaseService';
import type {OrderInventoryGeneration} from '../../shared/orderInventoryGeneration';
import { confirmPendingPurchaseOrder } from '../../shared/services/confirmPendingPurchaseOrderService';
import { sendSharedChatMessage } from '../../shared/services/sharedChatMessageService';
import OrderInventoryRecoveryPanel from '../../../components/OrderInventoryRecoveryPanel';
import {readPendingOrderInventoryRecoveries,type PendingOrderInventoryRecovery,clearRecoveredOrderCancellation} from '../../shared/services/orderInventoryRecoveryService';
import {normalizeViewAlias} from '../../shared/startView';
import FinancialOpeningResume from '../../../components/FinancialOpeningResume';
import { cancelOemIssue } from '../../shared/services/oemCancelService';
import { isStockProduction } from '../../shared/orderPurpose';
import { processReturn, resumePendingReturn } from './returnCommands';
import { mutateManualSettlement } from './manualSettlementCommands';
import { mutateCash, matchCashAllocations, resumeCashMutation, prepareTransferCash, type PayrollCashEdit, type TransferCashEdit } from './cashMutationCommands';
import ProductionWorkDocumentHost from '../production-documents/ui/ProductionWorkDocumentHost';
import { defaultCashAccountId } from '../../shared/defaultCashAccount';
import { appConfirm, appNotice as awaitNotice, appPrompt } from '../../shared/components/appDialog';
import ConfirmModal from '../../shared/components/ConfirmModal';
import { hasCompleteOrderItems, planOrderItemToggle, requiresCompleteItemsForStatusChange, workStatusFromItems } from '../../shared/orderCompletion';
import { ensureOrderLineIds } from '../../shared/orderLineInventory';
import { mergeCompanyOrders } from './companyOrders';
import { useProductionSalesHistory } from './useProductionSalesHistory';
import { updateCashAccountOpening } from '../../shared/services/cashAccountOpeningUpdate';
﻿
// ============================================================
// [ADMIN APP 경계 — 미래 분리 안내]
//
// 이 컴포넌트는 관리자/직원 ERP 앱 전체를 렌더링합니다.
// 추후 독립 앱으로 물리 분리 시 다음 단계를 따르세요:
//
//   1. 이 파일을 새 프로젝트의 App.tsx 로 복사
//   2. src/shared/ 폴더 전체를 함께 복사
//   3. Firebase 설정(.env)과 src/shared/firebase.ts 교체
//   4. src/features/admin/ 파일만 유지, staff/ 제거
//   5. 빌드 후 별도 Firebase 프로젝트에 배포
//
// Props 로 받는 것: currentUser, isAdmin, isAdminAuthenticated,
//   onAdminAuth, currentView, setCurrentView, onLogout, appData, adminData
// ============================================================

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { today, addMonths, endOfMonth } from '../../shared/day';
import { nextDocNo, stampFor, claimDocNo } from '../../shared/voucherStamp';
import { statementEditPatch } from '../../shared/statementEdit';
import { calcCost } from './costCalc';
import { isBulkItem, holdsUnitStock } from '../../shared/itemTaxonomy';
import { isSmartStoreItem } from '../../shared/partnerPrice';
import { rawHolderByName, resolveRawHolder, rawLedgerKeys } from '../../shared/rawHolder';
import { bomOf } from '../../shared/bomIndex';
import { orderLinesUsingRaw } from '../../shared/rawUsers';
import { executeEmployeeCommand } from '../../shared/services/employeeCommand';
import { executeRawInventoryCommand } from '../../shared/services/rawInventoryService';
import { executeRawPress, executeRawPressCancellation } from '../../shared/services/rawPressService';
import { beginNewRawPressAttempt, assertRawPressAttempt, listRawPressAttempts, rawPressText, rawPressYieldKg, type RawPressRequest } from '../../shared/rawPressAttempt';
import { derivedRawDocEntries } from '../../shared/derivedRawDocEntries';
import { adjustStockByQty, durableProductStocktake as stocktakeByQty } from '../../shared/services/unpackService';
import { STANDARD_ACCOUNT } from '../../shared/accountChart';
import { createPortal } from 'react-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Sparkles,
  Menu,
  Search,
  Truck,
  Users,
  Layers,
  Download,
  Bell,
  BellRing,
  Settings,
  Lock,
  ShieldCheck,
  UserCheck,
  CalendarCheck,
  LogOut,
  ExternalLink,
  Globe,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Tag,
  FileText,
  Receipt,
  FileSignature,
  Wallet,
  BarChart2,
  Factory,
  ClipboardList,
  PackageCheck,
  ScanLine,
  QrCode,
  ShoppingBag,
  RotateCcw,
  TrendingUp,
  Activity,
  Scale,
  ShieldAlert,
  UserPlus,
  FolderOpen,
  BookOpen,
  Plus,
  ClipboardPaste,
  Trash2,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { Order, Item, PartnerItem, ViewType, OrderStatus, Partner, Post, FileItem, PalletStock, Employee, LeaveRequest, PalletTransaction, OrderItem, AdjustmentRequest, ChatRoom, ChatMessage, RawMaterialEntry, AppNotification, ProductionRecord, ReturnRequest, PurchaseOrder, poLines, CompanyId, COMPANIES, TAEBAEK, companyOf, invSnapDocId, CashEntry, IssuedStatement, OrderItemEdit } from '../../shared/types';
import { updatePendingFlowQuantity } from '../../shared/services/pendingFlowQuantityService';
import { resetDailyWorkOrder } from '../../shared/services/workOrderResetService';
import { deleteIssuedStatement } from '../../shared/services/deleteIssuedStatementService';
import { issueRecurringVouchers } from './recurringVoucherIssue';
import PageHeader from '../../shared/components/PageHeader';
import OrderCreationModalHeader from '../../shared/components/OrderCreationModalHeader';
import LargeModalShell from '../../shared/components/LargeModalShell';
import ModalShell from '../../shared/components/ModalShell';
const Dashboard = React.lazy(() => import('../../../components/Dashboard'));
import OrdersList from '../../../components/OrdersList';
import ItemList from '../../../components/ItemList';
const BomIntegrityPanel = React.lazy(() => import('../../../components/BomIntegrityPanel'));
const AIConsultant = React.lazy(() => import('../../../components/AIConsultant'));
import AddOrderModal from '../../../components/AddOrderModal';
import PasteOrderModal,{type OrderCopyEvidence} from '../../../components/PasteOrderModal';
import OrderInterpretationRules from '../../../components/OrderInterpretationRules';
import {submitOrderCopy,inspectOrderCopy,listPendingOrderCopies,deletePendingOrderCopy,type PendingOrderCopy} from '../../shared/services/orderCopyService';
import {validateOrderInterpretation,type OrderInterpretationRequest} from '../../shared/orderInterpretation';
const PartnerManager = React.lazy(() => import('../../../components/PartnerManager'));
import DeliveryManager from '../../../components/DeliveryManager';
import PalletManager from '../../../components/PalletManager';
import AdminAuthModal from '../../../components/AdminAuthModal';
const HRManager = React.lazy(() => import('../../../components/HRManager'));
import LeaveManager from '../../../components/LeaveManager';
import ConfirmationItems from '../../../components/ConfirmationItems';
import ProductModal,{ItemEditorRecoveryList,type ItemEditorRecoveryEntry} from '../../../components/AddItemModal';
import { downloadSalesJournal,prepareSalesJournal,completeSalesJournalOutput,newSalesJournalProgress,saveSalesJournalArtifact,salesJournalLogMatches,type SalesJournalProgress,type SalesJournalData } from '../../shared/salesJournal';
import {confirmWorkbookOutput,previewPreparedWorkbookOutput,type WorkbookOutputArtifact} from '../../shared/workbookOutput';
import {useOutputScope} from '../../shared/hooks/useOutputScope';
import { sortLedger, isBackdated, latestAnchorDate } from '../../shared/rawLedgerBalance';
import { shipQtyOfLine } from '../../shared/shipDeduction';
import { registerPush, pushSupported } from '../../shared/push';
import { ledgerTrace, orderIndex } from '../../shared/ledgerTrace';
import { createOrderStockEngine, StockUsePlan, isGoodsItem } from './orderStockEngine';
import { ordersFarFromJournalDate, ordersPendingDocumentClose } from './salesJournalOrders';
import { buildRollbackPlan, buildStatusChangeAsk, buildOrderDeletePlan, type RollbackPlan } from './rollbackSummary';
import type { CancellationTicket } from './orderInventoryCancellation';
import type { AlertTone } from '../../shared/components/AlertModalShell';
import { statusLabel } from '../../shared/orderStatusStyle';
import { unreservedItemStock, reservedItemQty, reservedByOrders } from './orderItemStock';
import { buildStockUseRows, StockUseRow } from './stockUseRows';
import StockUseModal from './StockUseModal';
import {
  CATALOG_DELETE_BLOCKING_STATUSES,
  catalogItemDeleteBlockers,
  catalogItemDeleteBlockMessage,
  planCatalogItemDelete,
} from './catalogItemDelete';
import {
  newOrderCreationSession,
  resetOrderCreationSession,
  submitOrderCreation,
} from './orderCreation';
import { createOemEngine } from './oemEngine';
import { issueOemBatchJob, recoverableOemDrafts } from './oemIssueJob';
import {beginOemIssueAttempt,assertOemIssueAttempt,type OemIssueRetained} from '../../shared/oemIssuePending';
import { applyOemFeeStatement } from './oemFeeStatement';
import { buildFormula as buildFormulaBom, formulaRowsOf } from './bom';
import { buildCostFn } from '../../shared/bomCost';
import { checkLedgerLot, gapMessage } from '../../shared/ledgerLotCheck';
import NoticeBoard from '../../../components/NoticeBoard';
import ItemManager from '../../../components/ItemManager';
const TaxStatement = React.lazy(() => import('../../../components/TaxStatement'));
import OfficeTalk from '../../../components/OfficeTalk';
import { extractedOfficeTalkMessageIds } from '../../shared/officeTalkOrder';
import { notify, loadNotifyMode } from '../../shared/notify';
import { pickNewOrders, newOrderMessage } from '../../shared/newOrderAlert';
import { pickNewChats, chatMessage } from '../../shared/newChatAlert';
import { selectBellNotifications } from '../../shared/bellNotifications';
import { roomNameFor } from '../../shared/roomName';
import { leaveStatusPatch } from '../../shared/leave';
import AccountMenu from '../../../components/AccountMenu';
const MyPage = React.lazy(() => import('../../../components/MyPage'));
const AdminChecklist = React.lazy(() => import('../../../components/AdminChecklist'));
const PartnerSignupApproval = React.lazy(() => import('../../../components/PartnerSignupApproval'));
const DocumentManager = React.lazy(() => import('../../../components/DocumentManager'));
const QuotationManager = React.lazy(() => import('../../../components/QuotationManager'));
import type * as ExcelJSType from 'exceljs';

const QrLabelPrint = React.lazy(() => import('../../../components/QrLabelPrint'));
const SmartStoreAnalytics = React.lazy(() => import('../../../components/SmartStoreAnalytics'));
const HaccpChecklist = React.lazy(() => import('../../../components/HaccpChecklist'));
const BenzopyreneLog = React.lazy(() => import('../../../components/BenzopyreneLog'));
const SanitationChecklistView = React.lazy(() =>
  import('../../../components/HaccpChecklist').then(m => ({ default: m.StaffChecklistView }))
);
const ReturnManager = React.lazy(() => import('../../../components/ReturnManager'));
const ItemLedger = React.lazy(() => import('../../../components/ItemLedger'));
const ReceivingReturnsManager = React.lazy(() => import('../../../components/ReceivingReturnsManager'));
const ProductionManager = React.lazy(() => import('../../../components/ProductionManager'));
const TradeStatement = React.lazy(() => import('../../../components/TradeStatement'));
const ProfitAnalysis = React.lazy(() => import('../../../components/ProfitAnalysis'));
const FinancialReports = React.lazy(() => import('../../../components/FinancialReports'));
const LoanManager = React.lazy(() => import('../../../components/LoanManager'));
const CashLedger = React.lazy(() => import('../../../components/CashLedger'));
const PartnerLedger = React.lazy(() => import('../../../components/PartnerLedger'));

import { db, auth } from '../../shared/firebase';
import { PRODUCT_FORMULA, DENSITY, RM_LIST, toKg, unitOf, unitToKg, baseRawName, lotKgRemaining, parseSpecUnit } from '../../constants/formula';
import { docPumok, docOilKg, docSpec, addOilByRaw, docSaleLines, isSalesJournalProduct, journalSaleLines, docDateOf, findDocDrops, DOC_RECALC_RAWS, mixLabel, rawDocMaterials, rawDocTabs, rawDocTabLabel } from '../../shared/docOil';
import { deductFromLots, buildReceiveLot, withCarryOverLot, nextLotNo, lotMixSettingOf } from '../../shared/lotUtils';
import { rawLotTarget, adjustRawLots } from '../../shared/rawReceipt';
import { buildPaymentEntry } from '../../shared/payment';
import { nextOrderNo, nextPoNo, cardNoLabel } from '../../shared/cardNo';
import { bomQty } from '../../shared/bom';
import { stockUnits, unpackComponent, unitsPerBoxOf, type OrderUnitInputs } from '../../shared/orderUnits';
import { boxSpecUpdates } from '../../shared/boxSpec';
import {
  addItem,
  createOpeningAccountCode,
  updateItem,
  editIssuedStatementCommand,
  deleteItem,
  setProductClients,
  setProductSuppliers,
  setDocument,
  fetchCollection,
  fetchWhereIn,
  markNotificationForUser,
  claimOrderInventoryOperation,
  commitCompanyWrites,
  writeMany,
  confirmUnitPurchaseOrderReceipt,
  deletePendingPurchaseOrder,
  createCashAccountWithOpening,
  receiveOemFinishedGoodsCommand,
} from '../../shared/services/firebaseService';
import type { AppData } from '../../shared/hooks/useAppData';
import type { AdminData } from '../../hooks/useAdminData';
import { collection, getDocs, getDocFromServer, doc, deleteField, onSnapshot, query, where } from 'firebase/firestore';
import { vatOn } from '../../shared/lineAmount';
import { resolveOrderItem } from '../../shared/statementLines';
import { dateOfLocal } from '../../shared/day';
import { buysFrom } from '../../shared/partnerRole';
import { COL } from '../../shared/collections';
import { docName, findByDocName } from '../../shared/docName';
import { issueNumberedCashEntry, issueNumberedStatement, issueTradeStatementCommand } from '../statements/infrastructure/issueTradeStatementCommand';
import { recordLoanCashEntry } from '../../shared/services/recordLoanCashEntry';
import { companySettingDocId, companySettingPatch } from '../../shared/companySettings';
import { applyTaxIssueWrites } from '../tax-documents/infrastructure/applyTaxIssueWrites';
import { crossCompanyBoms, itemsOfCompany } from '../../shared/itemCompany';
import DataIntegrityMonitor from './DataIntegrityMonitor';
import type { RawInventoryState } from '../../shared/rawInventoryCore';
import { downloadRawLedgerExcel } from './rawLedgerExcel';

// 거래처 주문 포털(웹) URL — .env의 VITE_PARTNER_PORTAL_URL로 운영 도메인 지정 가능
const PARTNER_PORTAL_URL =
  (import.meta.env.VITE_PARTNER_PORTAL_URL as string | undefined) || 'http://localhost:3000';

const openPartnerPortal = () => {
  window.open(PARTNER_PORTAL_URL, '_blank', 'noopener,noreferrer');
};

interface AdminAppProps {
  currentUser: Employee;
  companyId: CompanyId;
  isAdmin: boolean;
  isAdminAuthenticated: boolean;
  onAdminAuth: (v: boolean) => void;
  currentView: ViewType;
  setCurrentView: (view: ViewType) => void;
  onLogout: () => void;
  appData: AppData;
  adminData: AdminData;
  onPreviewStaff?: () => void;
  onExitPreview?: () => void;
}

const AdminApp: React.FC<AdminAppProps> = ({
  currentUser,
  companyId,
  isAdmin,
  isAdminAuthenticated,
  onAdminAuth,
  currentView,
  setCurrentView,
  onLogout,
  appData,
  adminData,
  onPreviewStaff,
  onExitPreview,
}) => {
  const {
    orders, purchaseOrders,
    items, partnerItems, setPartnerItems,
    partners, employees, leaveRequests,
    pallets, palletTransactions, adjustmentRequests,
    noticePosts, chatRooms, chatMessages,
    rawMaterialLedger, sesameInputLedger,
    appNotifications, workOrderItems, issuedStatements: allIssuedStatements,
    itemFormulas, itemBoms, returnRequests, itemReceipts, companyInfo, inventorySnapshots, productionSalesLogs, isDataLoading,
    pendingStatementEdits, refreshStaticData,
    historicalOrders, loadHistoricalOrders, isLoadingHistoricalOrders,
    ordersMonths, setOrdersMonths,
  } = appData;

  /**
   * 보고 있는 회사 — 태백푸드 / 풍회유통. **별도 사업자라 장부를 섞으면 안 된다.**
   * 회사가 안 붙은 옛 기록은 전부 태백으로 본다.
   *
   * 전표·자금만 가른다. 거래처·품목·계정과목은 한 벌을 같이 쓴다 —
   * 나중에 회사별로 완전히 나눌 때 이 필드가 그대로 나누는 기준이 된다.
   */
  const issuedStatements = useMemo(
    () => allIssuedStatements.filter(s => companyOf(s) === companyId),
    [allIssuedStatements, companyId],
  );
  // 재고 스냅샷도 회사별 — 재고조정 분개가 500 원료매입을 만들기 때문에
  // 안 거르면 태백 재고 증감이 풍회 손익에 그대로 잡힌다(전표 하나 없이 3천만원).
  const companySnapshots = useMemo(
    () => inventorySnapshots.filter(s => companyOf(s) === companyId),
    [inventorySnapshots, companyId],
  );
  // 통장도 회사별 — 풍회 원장을 보려면 풍회 통장이 따로 있어야 한다
  const companyCashAccounts = useMemo(
    () => appData.cashAccounts.filter(a => companyOf(a) === companyId),
    [appData.cashAccounts, companyId],
  );
  const companyCashEntries = useMemo(
    () => appData.cashEntries.filter(e => companyOf(e) === companyId),
    [appData.cashEntries, companyId],
  );
  const company = COMPANIES.find(c => c.id === companyId)!;

  /**
   * 풍회 장부에서 쓸 수 있는 화면 — **회계 + 품목관리.**
   *
   * 주문·재고·생산·인사는 아직 태백 것이다. 그 데이터엔 회사 칸 자체가 없어서
   * (거래처 295건·주문 203건·발주 16건·partner_item 1208건 전부 회사 미지정)
   * 메뉴에 띄우면 풍회 화면에 태백 것이 그대로 보인다 — 어느 회사를 보고 있는지 흐려진다.
   * 품목은 companyId가 붙어 있어 갈라 볼 수 있으므로 연다.
   */
  /*
   * **회사로 화면을 막지 않는다** (2026-09-01 사장님 지시: "풍회에도 태백에 있는 전 메뉴 뜨게").
   *
   * 예전엔 풍회에서 열 수 있는 화면을 목록(PUNGHOE_VIEWS)으로 좁혀 뒀다. 그런데
   * 화면이 늘 때마다 목록에 넣는 걸 잊어서 "왜 풍회엔 없냐"가 반복됐다 —
   * 인사 관리·견적서가 그랬다.
   *
   * 화면은 다 열고, **데이터가 회사를 탄다.** 풍회에 주문·생산 기록이 없으면 그 화면은
   * 빈 목록으로 뜬다. 그게 "메뉴가 아예 없다"보다 낫다 — 없는 건지 못 여는 건지 알 수 있다.
   */
  const viewAllowed = (_v: ViewType) => true;
  const menuIdentity = useMenuIdentity();
  const [helpOpen, setHelpOpen] = useState<string|null>(null);

  // 활성 주문 + 불러온 이력 주문 통합 (id 중복 제거)
  const allOrders = useMemo(() => mergeCompanyOrders(orders, historicalOrders, companyId), [orders, historicalOrders, companyId]);
  const receivedOrders = purchaseOrders.filter(po => po.status === 'received' || po.status === 'cancelled');


  // items 컬렉션 카테고리별 분리
  const products     = useMemo(() => items.filter(i => i.type === 'product'), [items]);
  const submaterials = useMemo(() => items.filter(i => i.type !== 'product'), [items]);

  /**
   * 전표 한 장 고치기 — **다섯 화면이 다 이걸 쓴다.**
   * 예전엔 화면마다 `updateItem('issuedStatements', ...)` 을 인라인으로 부르고 있어서,
   * 거래일이 바뀌어도 시각 도장이 안 따라갔다(`shared/statementEdit` 참고).
   */
  const updateStatement = useCallback(
    (id: string, data: Partial<IssuedStatement>) => {
      const current = issuedStatements.find(s => s.id === id);
      if (!current) throw new Error('수정할 전표를 찾지 못했습니다. 화면을 새로고침해 주세요.');
      return editIssuedStatementCommand(id, statementEditPatch(data, current), Number((current as IssuedStatement & { mutationRevision?: number }).mutationRevision ?? 0), crypto.randomUUID());
    },
    [issuedStatements],
  );

  /** 화면에서 읽은 원문과 특수 입력을 함께 서버 원자 명령으로 보낸다. */
  const updateCash = useCallback(
    async (id: string, data: Partial<CashEntry>, original?: CashEntry, payrollEdit?: PayrollCashEdit, transferEdit?: TransferCashEdit) => {
      if (!original || original.id !== id || companyOf(original) !== companyId)
        throw new Error('화면에서 읽은 같은 회사의 자금 원문을 확인해 주세요.');
      await mutateCash(companyId, original, 'edit', data, payrollEdit, transferEdit);
    },
    [companyId],
  );

  // partner_item 컬렉션 Direction 기준 분리
  const partnerIn = useMemo(() => partnerItems.filter(pi => pi.Direction === 'in'),  [partnerItems]);
  const partnerOut   = useMemo(() => partnerItems.filter(pi => pi.Direction === 'out'), [partnerItems]);

  const termsActor=auth.currentUser?.uid;
  const termsScope=useRef({companyId,actorUid:termsActor});
  if(termsScope.current.companyId!==companyId||termsScope.current.actorUid!==termsActor)termsScope.current={companyId,actorUid:termsActor};
  const termsRenderScope=termsScope.current;
  const termsAlive=useRef(true);
  useEffect(()=>{termsAlive.current=true;return()=>{termsAlive.current=false;};},[]);
  const isCurrentPartnerTerms=()=>termsAlive.current&&!!termsActor&&auth.currentUser?.uid===termsActor&&termsScope.current===termsRenderScope;
  const runPartnerItemTerms=async(work:(scope:{companyId:CompanyId;actorUid:string})=>Promise<PartnerItemTermsOutcome>):Promise<PartnerItemTermsOutcome>=>{
    if(!isCurrentPartnerTerms()||!termsActor)return {status:'rejected',message:'회사 또는 로그인 정보가 바뀌어 거래조건 저장을 전송하지 않았습니다.',nextAction:'현재 회사에서 품목을 다시 열어 주세요.'};
    const result=await work({companyId,actorUid:termsActor});
    if(result.status==='saved'&&isCurrentPartnerTerms()){
      try{await refreshStaticData();}catch{if(isCurrentPartnerTerms())setAppNotice({message:'거래조건은 저장됐지만 화면을 갱신하지 못했습니다.',subMessage:'다시 저장하지 말고 새로고침해 주세요.'});}
    }
    return result;
  };
  const savePartnerItemTerms=(input:PartnerItemTermsInput)=>runPartnerItemTerms(scope=>submitPartnerItemTerms(scope,input,awaitNotice,isCurrentPartnerTerms));
  const inspectPartnerTerms=(reference:PartnerItemTermsReference)=>runPartnerItemTerms(scope=>inspectPartnerItemTerms(scope,reference,isCurrentPartnerTerms));
  const cancelPartnerTerms=(reference:PartnerItemTermsReference)=>runPartnerItemTerms(scope=>cancelPartnerItemTerms(scope,reference,isCurrentPartnerTerms));
  const readPendingPartnerTerms=()=>isCurrentPartnerTerms()&&termsActor?pendingPartnerItemTerms({companyId,actorUid:termsActor}):[];
  const readPartnerTermsReferences=()=>isCurrentPartnerTerms()&&termsActor?partnerItemTermsReferences({companyId,actorUid:termsActor}):[];
  const partnerTermsBindings={requestScopeKey:termsActor??'',onSavePartnerItemTerms:savePartnerItemTerms,onReadPendingPartnerItemTerms:readPendingPartnerTerms,onReadPartnerItemTermsReferences:readPartnerTermsReferences,onInspectPartnerItemTerms:inspectPartnerTerms,onCancelPartnerItemTerms:cancelPartnerTerms};

  // 저장 ACK와 목록 재조회 요청은 다른 단계다. 뒤의 오류를 주업무 미저장으로 바꾸지 않는다.
  const saveProfitAccountChange = async (id: string, context: AccountEditContext, save: () => Promise<SaveOutcome>): Promise<SaveOutcome> => {
    if (context.companyId !== companyId || !context.isCurrent()) return {
      status: 'rejected', message: '회사 또는 계정 관리 화면이 바뀌어 저장하지 않았습니다. 현재 화면에서 다시 열어 주세요.',
    };
    const result = await save();
    if (!primaryCommitted(result, id) || context.companyId !== companyId || !context.isCurrent()) return result;
    try { refreshStaticData(); }
    catch { return {
      status: 'partial', reason: 'followup-unconfirmed', committedIds: [id], unconfirmedIds: [],
      message: '계정 처리는 완료됐지만 목록 갱신을 시작하지 못했습니다.', nextAction: '다시 저장하지 말고 화면을 새로고침해 주세요.',
    }; }
    return result;
  };
  const updateProfitAccountCode = (id: string, patch: AccountCodeEditPatch, context: AccountEditContext): Promise<SaveOutcome> =>
    saveProfitAccountChange(id, context, () => saveAccountCodeEdit(id, patch, context));
  const updateProfitAccountGroup = (id: string, patch: AccountGroupEditPatch, context: AccountEditContext): Promise<SaveOutcome> =>
    saveProfitAccountChange(id, context, () => saveAccountGroupEdit(id, patch, context));

  const createProfitAccountCode = (data: AccountCode, context: AccountOperationContext): Promise<SaveOutcome> =>
    saveProfitAccountChange(data.id, context, () => saveAccountCodeCreate(data, context));
  const createProfitAccountGroup = (data: AccountGroup, context: AccountOperationContext): Promise<SaveOutcome> =>
    saveProfitAccountChange(data.id, context, () => saveAccountGroupCreate(data, context));
  const removeProfitAccountCode = (opening: AccountCode, context: AccountOperationContext): Promise<SaveOutcome> =>
    saveProfitAccountChange(opening.id, context, () => deleteAccountCode(opening, context));
  const removeProfitAccountGroup = (opening: AccountGroup, context: AccountOperationContext): Promise<SaveOutcome> =>
    saveProfitAccountChange(opening.id, context, () => deleteAccountGroup(opening, context));

  const readProfitAccountOperations = async (context: AccountEditContext) => {
    if (context.companyId !== companyId || !context.isCurrent() || auth.currentUser?.uid !== context.actorUid)
      throw new Error('회사 또는 로그인 계정이 바뀌었습니다. 현재 화면에서 다시 확인해 주세요.');
    return readAccountOperationReferences({companyId, actorUid:context.actorUid});
  };
  const inspectProfitAccountOperation = (reference: AccountManagementReference, context: AccountEditContext): Promise<SaveOutcome> =>
    saveProfitAccountChange(reference.targetId, context, () => inspectAccountOperation(reference, context));
  const retryProfitAccountOperation = (reference: AccountManagementReference, context: AccountEditContext): Promise<SaveOutcome> =>
    saveProfitAccountChange(reference.targetId, context, () => retryAccountOperation(reference, context));
  const cancelProfitAccountOperation = (reference: AccountManagementReference, context: AccountEditContext): Promise<SaveOutcome> =>
    saveProfitAccountChange(reference.targetId, context, () => cancelAccountOperation(reference, context));

  const discardProfitAccountOperationCopy = async (reference: AccountManagementReference, observedLocalText: string, context: AccountEditContext): Promise<SaveOutcome> => {
    if (reference.companyId !== companyId || context.companyId !== companyId || !context.isCurrent() || auth.currentUser?.uid !== context.actorUid)
      return {status:'rejected',message:'회사 또는 로그인 계정이 바뀌어 이 기기의 사본을 정리하지 않았습니다. 현재 화면에서 다시 확인해 주세요.'};
    // 기기 사본 정리는 등록·삭제 성공이 아니므로 업무 목록 갱신과 분리한다.
    return discardAccountOperationCopy(reference, observedLocalText, context);
  };

  // partners 컬렉션

  const { fixedCosts, productionRecords } = adminData;

  const [pendingInvoice, setPendingInvoice] = useState<{ partnerId: string; partnerName: string; items: Array<{ itemId: string; name: string; spec: string; qty: number; price: number; isBox?: boolean }>; poIds?: string[] } | null>(null);
  const [showInboundInvoice, setShowInboundInvoice] = useState(false);
  /**
   * 문서함에서 지금 고른 자리 — **생산판매기록부를 문서함에 얹기 위한 것.**
   * 그 화면은 서류관리 화면 안 커다란 IIFE 안에서 만들어져서 밖으로 못 뺀다.
   * 그래서 화면을 옮기는 대신 **문 위치를 옮겼다** — 문서함에서 서류관리 › 생산판매기록부를
   * 고르면 파일 목록 자리에 그 서류가 뜬다.
   */
  const [cabinetSel, setCabinetSel] = useState<{ cat: string; sub: string }>({ cat: '', sub: '' });
  //  거래처원장에서 전표번호를 누르면 전표 화면이 그 번호로 조회창을 연다
  const [focusDocNo, setFocusDocNo] = useState('');
  const [inboundDetailId, setInboundDetailId] = useState('');
  useEffect(() => { setInboundDetailId(''); }, [companyId]);

  /** 연결 정산과 특수 원장도 같은 서버 거래에서 삭제한다. */
  const deleteCashEntry = useCallback(async (id: string, original?: CashEntry, transferEdit?: TransferCashEdit) => {
    if (!original || original.id !== id || companyOf(original) !== companyId)
      throw new Error('화면에서 읽은 같은 회사의 자금 원문을 확인해 주세요.');
    const counterpart = transferEdit ?? ((original as CashEntry & { transferOperationId?: string }).transferOperationId ? await prepareTransferCash(companyId, original) : undefined);
    const transfer = counterpart && ('counterpart' in counterpart ? { counterpartId: counterpart.counterpart.id,
      expectedRevision: counterpart.expectedRevision, expectedCashHash: counterpart.expectedCashHash } : counterpart);
    await mutateCash(companyId, original, 'delete', undefined, undefined, transfer);
  }, [companyId]);
  const [docTab, setDocTab] = useState<'생산판매기록부' | '원료수불부' | '거래명세서' | '생산작업일지' | '벤조피렌' | 'haccp'>('생산판매기록부');
  const [docYearMonth, setDocYearMonth] = useState(() => new Date().toISOString().slice(0, 7));
  /**
   * 생산판매기록부 이력을 볼 달 — **기록이 있는 마지막 달**로 연다.
   * 이번 달로 열면 1일에 들어갔을 때 텅 빈 목록만 보고 "8월 것 어디 갔냐"가 된다.
   * 기록이 하나도 없으면 이번 달.
   */
  const [docLogMonth, setDocLogMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const docLogMonthTouched = useRef(false);
  /** 달을 손으로 움직이면 표식을 남긴다 — 그 뒤엔 자동으로 안 옮긴다 */
  const markDocLogMonth = (v: string) => { docLogMonthTouched.current = true; setDocLogMonth(v); };
  const [bulkMfgDate, setBulkMfgDate] = useState(() => today());
  const [productionDocumentDate, setProductionDocumentDate] = useState(() => today());
  const [, refreshProductionDocumentState] = useState(0);
  const productionDocumentScope = useRef({ key: '', generation: 0, selection: 0, dirty: false, busy: false });
  const productionDocumentKey = JSON.stringify([companyId, currentUser.id, auth.currentUser?.uid, productionDocumentDate]);
  if (productionDocumentScope.current.key !== productionDocumentKey) {
    productionDocumentScope.current = { key: productionDocumentKey, generation: productionDocumentScope.current.generation + 1, selection: 0, dirty: false, busy: false };
  }
  const productionDocumentSession = productionDocumentScope.current;
  const reportProductionDocumentState = (state: { dirty: boolean; busy: boolean }) => {
    const scope = productionDocumentScope.current;
    if (scope !== productionDocumentSession || (scope.dirty === state.dirty && scope.busy === state.busy)) return;
    scope.dirty = state.dirty; scope.busy = state.busy;
    refreshProductionDocumentState(value => value + 1);
  };
  const changeProductionDocumentDate = async (date: string) => {
    const scope = productionDocumentScope.current;
    const selection = ++scope.selection;
    const uid = auth.currentUser?.uid;
    if (!date || date === productionDocumentDate || scope.busy) return;
    if (scope.dirty && !await appConfirm({ title: '저장하지 않은 변경', message: '저장하지 않은 생산일지 내용이 있습니다. 현재 입력을 버리고 날짜를 바꿀까요?', confirmText: '날짜 변경' })) return;
    if (productionDocumentScope.current !== scope || scope.selection !== selection || auth.currentUser?.uid !== uid || scope.busy) return;
    setProductionDocumentDate(date);
  };
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [notifPanelPos, setNotifPanelPos] = useState({ top: 0, left: 0 });
  const notifBtnRef = useRef<HTMLButtonElement>(null);
  const [highlightOrderId, setHighlightOrderId] = useState<string | null>(null);
  const [openChatRoomId, setOpenChatRoomId] = useState<string | null>(null);
  const [rmActiveMaterial, setRmActiveMaterial] = useState('참깨');
  const [rawUsageDetail, setRawUsageDetail] = useState<RawDocUsageSelection | null>(null);
  useEffect(() => { setRawUsageDetail(null); }, [companyId, docYearMonth, rmActiveMaterial, currentView, docTab]);
  const [rmCorrectionTargetId, setRmCorrectionTargetId] = useState<string | null>(null);
  // mode: 'neg'|'pos' = 사용량 정정, 'stocktake' = 실사(잔량을 입력값으로 리셋). 수불부 전용 — 로트·재고는 안 건드림.
  const [rmCorrectionForm, setRmCorrectionForm] = useState<{ date: string; amount: string; isNegative: boolean; note: string; mode?: 'neg' | 'pos' | 'stocktake' }>(
    { date: today(), amount: '', isNegative: true, note: '', mode: 'neg' });
  const [isMobile, setIsMobile] = useState(false);
  const [showQrLabel, setShowQrLabel] = useState(false);
  const [selectedLog, setSelectedLog] = useState<import('../../shared/types').ProductionSalesLog | null>(null);
  const documentOutputSignal=useOutputScope(companyId,`${currentView}:${docTab}:${docYearMonth}:${bulkMfgDate}:${selectedLog?.id??''}`);
  const salesOutputBusy=useRef(false);
  const salesOutputSessions=useRef(new Map<string,{artifact:WorkbookOutputArtifact;logId:string;logPayload:Record<string,unknown>;journal:SalesJournalData;orders:{id:string;partnerName:string}[];progress:SalesJournalProgress}>());

  // 거래처 가입승인 대기 카운트 (web 홈페이지에서 가입한 users 중 status='pending')
  const [pendingSignupCount, setPendingSignupCount] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    const qy = query(collection(db, 'users'), where('companyId', '==', companyId), where('status', '==', 'pending'));
    const unsub = onSnapshot(qy, (snap) => setPendingSignupCount(snap.size), () => setPendingSignupCount(0));
    return unsub;
  }, [isAdmin, companyId]);

  // 라이브 구독은 7일치만 → 서류관리 > 생산판매기록부 월별 조회를 위해 24개월치 온디맨드 로드
  const mergedProductionSalesLogs = useProductionSalesHistory(companyId, productionSalesLogs);

  /*
   * 이력을 볼 달을 **기록이 있는 마지막 달**로 한 번 맞춘다.
   * 이번 달로 열면 1일에 들어갔을 때 빈 목록만 보인다(8월 것이 사라진 것처럼).
   * 사용자가 달을 직접 움직였으면(docLogMonthTouched) 다시 안 건드린다.
   */
  useEffect(() => {
    if (docLogMonthTouched.current || !mergedProductionSalesLogs.length) return;
    const last = mergedProductionSalesLogs
      .map(l => String(l.date ?? '').slice(0, 7)).filter(Boolean).sort().pop();
    if (last && last !== docLogMonth) setDocLogMonth(last);
  }, [mergedProductionSalesLogs]);

  // 라이브 구독은 7일치만(무료요금제 읽기 절약) → 원료수불부는 전재고(이월 잔고) 계산에 전체 이력이 필요.
  // 수불부 탭을 열 때만 1회 온디맨드 조회하여 라이브 7일 구독분과 merge. (다른 페이지는 7일 유지)
  const [extraRawMaterialLedger, setExtraRawMaterialLedger] = useState<import('../../shared/types').RawMaterialEntry[]>([]);
  const [rawInventoryStates, setRawInventoryStates] = useState<RawInventoryState[]>([]);
  const [integritySnapshot, setIntegritySnapshot] = useState<{
    items: Item[];
    ledger: import('../../shared/types').RawMaterialEntry[];
    states: RawInventoryState[];
    key: string;
  } | null>(null);
  const [ledgerReloadKey, setLedgerReloadKey] = useState(0);
  // 원료수불부/재고관리 화면에 들어올 때(또는 원장 쓰기로 reloadKey 변경 시)마다 전체 이력을 fresh하게 조회.
  //   전역 7일 구독을 제거했으므로, 이 화면 진입 시 재조회가 유일한 최신화 경로 —
  //   입고·반품·OEM·로트삭제 등 어디서 쓴 원장이든 진입 시점에 모두 반영된다.
  useEffect(() => {
    if (docTab !== '원료수불부' && currentView !== 'inventory' && currentView !== 'item-ledger' && currentView !== 'lot-management') return;
    let cancelled = false;
    const to = today();
    // 전체 이력이 필요한 화면이라 회사 범위만 서버에서 제한하고 날짜는 클라이언트에서 거른다.
    // companyId+date 복합 인덱스 배포 여부 때문에 원장이 통째로 비는 일을 피한다.
    fetchCollection<import('../../shared/types').RawMaterialEntry>(
      'rawMaterialLedger', [where('companyId', '==', companyId)],
    )
      .then(rows => { if (!cancelled) setExtraRawMaterialLedger(rows.filter(row => row.date >= '2020-01-01' && row.date <= to)); })
      .catch(e => { if (!cancelled) console.error('[AdminApp] 원료수불부 전체 이력 로드 실패:', e); });
    return () => { cancelled = true; };
  }, [docTab, currentView, ledgerReloadKey, companyId]);
  const integrityKey = `${companyId}:${ledgerReloadKey}`;
  useEffect(() => {
    if (currentView !== 'data-integrity') return;
    let cancelled = false;
    setIntegritySnapshot(null);
    Promise.all([
      fetchCollection<import('../../shared/types').RawMaterialEntry>('rawMaterialLedger', [where('companyId', '==', companyId)]),
      getDocs(query(collection(db, 'rawInventories'), where('companyId', '==', companyId))),
      getDocs(collection(db, 'items')),
    ]).then(([ledger, stateSnapshot, itemSnapshot]) => {
      if (cancelled) return;
      const states = stateSnapshot.docs.map(row => ({ id: row.id, ...row.data() } as RawInventoryState));
      const snapshotItems = itemSnapshot.docs.map(row => ({ id: row.id, ...row.data() } as Item));
      setExtraRawMaterialLedger(ledger);
      setRawInventoryStates(states);
      setIntegritySnapshot({ items: snapshotItems, ledger, states, key: integrityKey });
    }).catch(error => console.error('[AdminApp] 데이터 점검 묶음 로드 실패:', error));
    return () => { cancelled = true; };
  }, [currentView, companyId, ledgerReloadKey, integrityKey]);
  const mergedRawMaterialLedger = useMemo(() => {
    const map = new Map<string, import('../../shared/types').RawMaterialEntry>();
    extraRawMaterialLedger.forEach(e => map.set(e.id, e));
    rawMaterialLedger.forEach(e => map.set(e.id, e));
    // 원료 입출고도 회사별 — 풍회 창고에서 짠 깨분이 태백 수불부에 뜨면 안 된다
    return Array.from(map.values()).filter(e => companyOf(e) === companyId);
  }, [rawMaterialLedger, extraRawMaterialLedger, companyId]);
  const rawCancelScopeRef = useRef({companyId,uid:auth.currentUser?.uid});
  if(rawCancelScopeRef.current.companyId!==companyId||rawCancelScopeRef.current.uid!==auth.currentUser?.uid)rawCancelScopeRef.current={companyId,uid:auth.currentUser?.uid};
  const rawCancelScope=rawCancelScopeRef.current;
  const rawCancelAlive=useRef(true);
  useEffect(()=>{rawCancelAlive.current=true;return()=>{rawCancelAlive.current=false;};},[]);
  const cancelRawLedgerEntry = async (id:string) => {
    const active=()=>rawCancelAlive.current&&rawCancelScopeRef.current===rawCancelScope&&auth.currentUser?.uid===rawCancelScope.uid;
    if(!active()||!rawCancelScope.uid)return;
    const entry=mergedRawMaterialLedger.find(row=>row.id===id);
    const original=(entry as {operationId?:string}|undefined)?.operationId;
    if(!entry||!original){alert('옛 원장 기록은 원자 명령 번호가 없어 자동 취소할 수 없습니다. 정정으로 맞춰 주세요.');return;}
    try{
      const pair=await executeRawPressCancellation({companyId,actorUid:rawCancelScope.uid,originalOperationId:original});
      if(!active())return;
      if(pair.status==='blocked'){alert(`압착 취소 실패 — ${pair.reason}`);return;}
      if(pair.status==='already-cancelled')alert(pair.reason);
      if(pair.status!=='legacy'){setLedgerReloadKey(k=>k+1);return;}
      const holder=resolveRawHolder(allItems,{rawItemId:entry.rawItemId,material:entry.material,companyId:entry.companyId});
      if(!holder){alert('원료 홀더를 찾지 못했습니다.');return;}
      const result=await executeRawInventoryCommand({operationId:`reverse:${original}`,...rawLedgerKeys(holder),materialSnapshot:entry.material,
        effectiveAt:new Date().toISOString(),...(currentUser?.name?{actorName:currentUser.name}:{}),source:{type:'reversal',id:original},kind:'reverse',originalOperationId:original},
        {legacy:{note:`원장 기록 취소 (${entry.note??''})`.trim(),type:'correction',...(currentUser?.name?{addedBy:currentUser.name}:{})}});
      if(!active())return;
      if(result.status==='rejected'){alert(`취소 실패 — ${result.code}: ${result.message}`);return;}
      if(result.status==='conflict'){alert('같은 취소 번호의 내용이 다릅니다.');return;}
      setLedgerReloadKey(k=>k+1);
    }catch(error){if(active())alert(`취소 완료 여부를 확인하지 못했습니다. 같은 기록에서 재개해 주세요: ${(error as Error).message}`);}
  };

  // 원료수불부는 배송일 기준 월 조회이므로 생성일 창 밖의 경계 주문도 함께 조회한다.
  //   6월말 생성·7월초 배송 같은 경계 주문이 창 밖으로 빠져 누락. 해당 월 배송을 커버하도록
  //   이력 주문을 로드(생성일 버퍼: 전월 1일 ~ 당월 말일). allOrders에 병합돼 표시됨.
  useEffect(() => {
    if (docTab !== '원료수불부') return;
    const ym = docYearMonth;
    const [y, m] = ym.split('-').map(Number);
    if (!y || !m) return;
    const start = `${addMonths(`${y}-${String(m).padStart(2, '0')}`, -1)}-01`; // 전월 1일 (생성일 버퍼)
    const end = endOfMonth(`${y}-${String(m).padStart(2, '0')}`);               // 당월 말일
    loadHistoricalOrders(start, end);
  }, [docTab, docYearMonth, loadHistoricalOrders]);

  // 거래명세서(전표): 미발행 주문은 예전 배송완료까지 다 떠야 하므로 주문 전체를 로드한다.
  //   orders 날짜창은 읽기 몇 백 건 아끼자고 건 건데, 그 때문에 미발행이 안 보이면 손해라 여기선 전체 조회.
  useEffect(() => {
    if (currentView !== 'trade-statement') return;
    loadHistoricalOrders('2020-01-01', today());
  }, [currentView, loadHistoricalOrders]);

  // 모바일 감지
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1280);
      if (window.innerWidth < 1280) {
        setIsSidebarCollapsed(true); // 모바일에서는 기본적으로 사이드바 숨김
      }
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 품목→매출거래처 맵 — 오직 partner_item(out)에서. 품목의 저장 partnerIds는 죽은 필드라 안 본다.
  //   필드명이 데이터마다 itemId/itemId·partnerId/partnerId로 섞여 있어 둘 다 받는다(예전 itemId만 읽어 전부 누락되던 버그).
  const productClientMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const pc of partnerOut) {
      const iid = (pc as any).itemId ?? pc.itemId;
      const pid = (pc as any).partnerId ?? pc.partnerId;
      if (!iid || !pid) continue;
      const arr = map.get(iid) ?? [];
      if (!arr.includes(pid)) arr.push(pid);
      map.set(iid, arr);
    }
    return map;
  }, [partnerOut]);

  // Combined products for UI — 매출거래처는 partner_item(out)에서만 조인(저장 partnerIds fallback 제거)
  const allItems = useMemo<Item[]>(() =>
    [...products, ...submaterials].map(p => ({
      ...p,
      // 판매 연결로 배열을 바꾸기 전에 옛 채널 표식의 공용 판독 결과를 보존한다.
      isSmartStore: isSmartStoreItem(p),
      partnerIds: productClientMap.get(p.id) ?? [],
    })),
    [products, submaterials, productClientMap]
  );

  /**
   * 회사별 품목 — **재고를 보는 화면**이 쓰는 목록.
   *
   * BOM·주문·원가 엔진은 전체(allItems)를 그대로 쓴다. 구성품을 회사로 거르면
   * 남의 회사 품목을 물고 있는 BOM이 통째로 끊긴다 — 거기서 회사는 뜻이 없다.
   * 회사가 뜻을 갖는 건 "지금 이 창고에 뭐가 얼마 있나"를 셀 때뿐이다.
   */
  const companyItems = useMemo(
    () => itemsOfCompany(allItems, companyId),
    [allItems, companyId],
  );

  /**
   * 이 회사 장부에 뜨는 거래처 — 목록 화면이 쓴다.
   * 계산(잔액·전표)은 **거르지 않은 partners**를 계속 쓴다. 남의 회사 거래처가 섞여도
   * 그쪽 전표가 없으면 잔액이 0이라 해가 없고, 거르면 옛 전표의 이름이 안 붙는다.
   */
  /**
   * 이 회사에서 쓸 전표 템플릿 — **회사가 안 적힌 건 공용 뼈대라 다 보인다.**
   * 거래처·금액이 박힌 건 그 회사 것만 보인다. 안 거르면 풍회 화면에 태백 거래처가
   * 물린 템플릿이 떠서, 그걸로 끊은 전표가 엉뚱한 거래처에 붙는다.
   */
  const companyTemplates = useMemo(
    () => appData.fixedCostTemplates.filter(t => !t.companyId || t.companyId === companyId),
    [appData.fixedCostTemplates, companyId],
  );

  const companyPartners = useMemo(
    () => partners.filter(p => companyOf(p) === companyId),
    [partners, companyId],
  );

  // 수율(반제품 생산) 규칙 — 원재료(seed) → 파생 반제품 + 수율. item_formula에서 '부모가 원료홀더'인 행을 읽음.
  //   예: 통깨참기름 ← 참깨(0.45). 데이터가 없으면 기존 하드코딩값으로 폴백(무회귀).
  const yieldRules = useMemo(() => {
    const holderNames = new Set(
      allItems.filter(i => !i.phantom && isBulkItem(i))
        .map(i => baseRawName(i.name))
    );
    const map: Record<string, { product: string; rate: number }> = {};
    for (const f of itemFormulas) {
      if (f.parent_key && holderNames.has(f.parent_key) && f.child_name) {
        map[f.child_name] = { product: f.parent_key, rate: (f.yield_rate ?? f.ratio ?? 1) };
      }
    }
    const fallback: Record<string, { product: string; rate: number }> = {
      '참깨': { product: '통깨참기름', rate: 0.48 },
      '깨분': { product: '깨분참기름', rate: 0.45 },
      '들깨': { product: '통들깨들기름', rate: 0.37 },
      '검정깨': { product: '볶음검정참깨', rate: 0.95 },
    };
    for (const k of Object.keys(fallback)) if (!map[k]) map[k] = fallback[k];
    return map;
  }, [itemFormulas, allItems]);

  // 배합식 전개(재귀)는 순수 도메인 모듈(bom.ts)로 분리. 여기선 현재 데이터로 얇게 감싸 호출.
  const buildFormula = (prodKey: string) => buildFormulaBom(prodKey, itemFormulas, allItems);

  /**
   * 원장의 "어디 쓰였나" 칸에 **이 원료를 쓰는 줄만** 적기 위한 필터.
   *
   * 2026-09-10 사장님: "왜 볶음참깨 외 품목들이 보이냐". 원장 줄은 `orderId` 만 들고 있어
   * 그 주문에 담긴 품목을 통째로 적고 있었다 — 한 주문에 참기름과 들깨가루가 같이 있으면
   * 볶음참깨 줄에도 들깨가루가 떴다. 배합식으로 걸러 준다([rawUsers](../../shared/rawUsers.ts)).
   */
  const linesUsingRaw = useMemo(() => {
    const deps = { allItems, bomOf: (id: string) => appData.orderUnitInputs ? appData.orderUnitInputs.bom.of(id) : bomOf(id), buildFormula: (k: string) => buildFormulaBom(k, itemFormulas, allItems), baseRawName };
    return (order: Order, material: string) => orderLinesUsingRaw(order.items, material, deps);
  }, [allItems, itemFormulas, appData.orderUnitInputs]);

  // 재고평가·마진용 BOM 롤업 원가 (완제품 제조원가 자동). effectiveCost = 저장 cost 우선, 없으면 롤업.
  const inventoryCostOf = useMemo(
    () => buildCostFn({ allItems, itemBoms, formulaOf: (k) => buildFormulaBom(k, itemFormulas, allItems), formulaRowsOf: (k) => formulaRowsOf(k, itemFormulas) }),
    [allItems, itemBoms, itemFormulas],
  );

  /**
   * 편집 중인 품목의 **롤업 원가** — 저장 전 초안(BOM·분류)을 그대로 반영해 보여준다.
   * 출처가 '입력'인 품목도 계산값은 보여야 고를 수 있으므로 rollup()을 쓴다.
   */
  const rollupCostOf = useCallback((draft: Item, bomDraft?: { childId: string; qty: number }[]) => {
    const src = allItems.some(i => i.id === draft.id)
      ? allItems.map(i => (i.id === draft.id ? draft : i))
      : [...allItems, draft];
    const boms = bomDraft
      ? [...itemBoms.filter(b => b.parent_id !== draft.id),
         ...bomDraft.map(l => ({ id: `draft-${l.childId}`, parent_id: draft.id, child_id: l.childId, quantity: l.qty }))] as typeof itemBoms
      : itemBoms;
    return buildCostFn({
      allItems: src, itemBoms: boms,
      formulaOf: (k) => buildFormulaBom(k, itemFormulas, src),
      formulaRowsOf: (k) => formulaRowsOf(k, itemFormulas),
    }).rollup(draft);
  }, [allItems, itemBoms, itemFormulas]);

  /**
   * 원가 갱신 — 바뀐 품목의 cost를 저장하고, **그걸 재료로 쓰는 상위 품목 원가도 다시 굴려 저장**한다.
   * cost는 재고평가·스냅샷 등 여러 곳이 읽으므로 저장해두는데, 저장만 하면 원료 단가가 바뀌어도
   * 완제품 원가가 옛날 값에 굳는다. 그래서 바뀔 때마다 연쇄로 다시 계산한다.
   */
  const recomputeAllCosts = useCallback(async (
    src: Item[] = allItems,
    formulas: typeof itemFormulas = itemFormulas,
    boms: typeof itemBoms = itemBoms,
    isCurrent:()=>boolean=()=>true,
  ) => {
    const roll = buildCostFn({ allItems: src, itemBoms: boms, formulaOf: (k) => buildFormulaBom(k, formulas, src), formulaRowsOf: (k) => formulaRowsOf(k, formulas) });
    await Promise.all(src
      .map(i => ({ i, v: Math.round(roll(i)) }))
      .filter(({ i, v }) => v > 0 && Math.abs(v - (i.cost ?? 0)) > 0.5)
      .map(({ i, v }) => {if(!isCurrent())throw Error('회사 또는 품목 작성창이 바뀌어 원가 갱신을 중단했습니다.');return updateItem('items', i.id, { cost: v });}));
  }, [allItems, itemFormulas, itemBoms, updateItem]);

  /**
   * 낱개 → 박스 품목 생성. 품목 + item_bom(낱개×개입수 + 겉박스·테이프)을 함께 만든다.
   * 이름·id는 기존 규칙을 따른다: '{낱개} (N개입)' / box-{낱개id}-{N}. 단위는 '박스', 규격은 낱개 그대로.
   * 원가는 BOM 롤업으로 나오므로 저장 직후 재계산해 cost에 박는다.
   */
  const createBoxItem = useCallback(async (
    unit: Item,
    opts: { name: string; count: number; components: { id: string; qty: number }[] },
  ) => {
    const componentIds = new Set([unit.id, ...opts.components.map(component => component.id)]);
    const wrongCompany = allItems.filter(item => componentIds.has(item.id) && companyOf(item) !== companyId);
    if (wrongCompany.length > 0) {
      throw new Error(`다른 회사 품목은 BOM에 넣을 수 없습니다: ${wrongCompany.map(item => item.name).join(', ')}`);
    }
    const boxId = `box-${unit.id}-${opts.count}`;
    const { price: _legacyPrice, ...unitWithoutPrice } = unit as Item & { price?: number };
    const box: Item = {
      ...unitWithoutPrice,
      id: boxId,
      companyId,
      name: opts.name,
      unit: '박스',
      stock: 0,
      cost: 0,
      minStock: 0,
      lots: [],
    } as Item;
    // addItem을 거쳐야 옛 필드 이름이 DB의 새 이름(type/category/subtype)으로 변환된다
    await addItem('items', { ...box, id: boxId });

    const rows = [
      { child_id: unit.id, quantity: opts.count },
      ...opts.components.map(c => ({ child_id: c.id, quantity: c.qty })),
    ];
    await writeMany(rows.map(r => {
      const bid = `bom-${boxId}__${r.child_id}`.replace(/[/#$[\].]/g, '_');
      return { collection: COL.itemBom, id: bid, data: { parent_id: boxId, child_id: r.child_id, quantity: r.quantity } };
    }));
    refreshStaticData();

    // 방금 만든 구성으로 원가를 굴려 저장 — 구독 갱신을 기다리지 않는다.
    const nextItems = [...allItems, box];
    const nextBoms = [...itemBoms, ...rows.map(r => ({
      id: `bom-${boxId}__${r.child_id}`, parent_id: boxId, child_id: r.child_id, quantity: r.quantity,
    }))] as typeof itemBoms;
    await recomputeAllCosts(nextItems, itemFormulas, nextBoms);
  }, [allItems, companyId, itemBoms, itemFormulas, recomputeAllCosts, refreshStaticData]);

  const cascadeItemCost = useCallback(async (itemId: string, cost: number) => {
    await updateItem('items', itemId, { cost });
    await recomputeAllCosts(allItems.map(i => (i.id === itemId ? { ...i, cost } : i)));
  }, [allItems, updateItem, recomputeAllCosts]);

  const pendingPurchaseOrders = useMemo(() => purchaseOrders.filter(po => po.status === 'pending' && po.poType !== 'oem'), [purchaseOrders]);
  const recoverableOemOrders = useMemo(() => recoverableOemDrafts(purchaseOrders, companyId), [purchaseOrders, companyId]);
  const invoicedPurchaseOrders = useMemo(() => purchaseOrders.filter(po => po.status === 'invoiced'), [purchaseOrders]);

  const lowStockCount = allItems.filter(p =>
    p.type !== 'product' && p.minStock > 0 && p.stock < p.minStock
  ).length;

  // 판매 상품(완제품/향미유/고춧가루)은 products, 부자재는 submaterials
  //  품목이 갈려 있던 시절의 껍데기(`getProductCollection`)를 지웠다 — 늘 'items' 였다(2026-09-06)


  // 작업완료(생산됨·미출고) 주문분 — 지금 현재고에 얹혀 있는 완제품 수량(품목별 합).
  //   재고 현황 모달에서 '작업완료 vs 재고'를 쪼개 보여주는 데 쓴다(전체 = 현재고, 재고 = 현재고 − 작업완료).
  //   완사입·임가공은 작업완료 때 재고가 안 늘어나므로 제외 — orderStockEngine.produceOrder의 isGoodsItem/임가공 스킵과 동일 기준.
  const dispatchedQtyByItem = useMemo<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    const isGoods = (p: Item) => p.category === '향미유' || p.category === '고춧가루' ||
      p.type === '향미유' || p.type === '고춧가루' || (p.type as string) === 'goods' ||
      p.procureType === '완사입' || p.procureType === '임가공';
    for (const o of allOrders) {
      if (isStockProduction(o) || !o.producedAt || o.shippedOut) continue;   // 작업완료 & 미출고만
      for (const it of o.items) {
        const product = allItems.find(p => p.id === it.itemId);
        if (!product || !holdsUnitStock(product) || isGoods(product)) continue;
        m[it.itemId] = Math.round(((m[it.itemId] ?? 0) + stockUnits(it, product, appData.orderUnitInputs)) * 1000) / 1000;
      }
    }
    return m;
  }, [allOrders, allItems, appData.orderUnitInputs]);

  // 서류용 통깨/깨분 참기름 사용량 — **생산작업기록부 getOutflow 로직 단일 원천**.
  //  품목 그룹 배합비(시골향1=통깨100 / 2+해내음=50:50 / 3=깨분100 / 4+가득찬순=20:80 / 하남댁+새싹+해달=통깨100),
  //  캔(kg규격)=그대로, ml/L=×0.92, 서류일=배송완료일(deliveredAt), 출고+배송 상태.
  //  원료수불부·생산작업기록부가 전부 이걸 공유해서 숫자가 항상 일치한다.
  // 서류(원료수불부)용 기름 사용량 — 재고(BOM)와 **별개**로 판매분에서 다시 구한다.
  //   참기름: 아래 하드코딩 비율 (품목 원료식과 다른 값이 있어 손대지 않음)
  //   들기름: 품목 원료식(item_formula) 그대로 — 시골향들기름1=통들깨 100, 2=수입 9:통들깨 1 …
  const oilUsageDetail = useMemo(() => collectRawDocOilUsage(allOrders, allItems, appData.orderUnitInputs, productionRecords, companyId), [allOrders, allItems, appData.orderUnitInputs, productionRecords, companyId]);
  const oilOutflowByDate = oilUsageDetail.totals;

  // 서류용 통깨/깨분 **압착 입고** — rawMaterialLedger의 통깨참기름/깨분참기름 received(압착 rm-yield + 수동입고, 정정 제외).
  //  생산작업기록부/2의 입고를 sesameInputLedger(수동) 대신 자동 압착 입고로 채운다 = 원료수불부 입고와 같은 소스.
  const oilInflowByDate = useMemo<Record<string, { 통깨참기름: number; 깨분참기름: number }>>(() => {
    const isCorr = (e: { id?: string; note?: string; type?: string }) =>
      e.type === 'correction' || /^rm-(zero|stocktake)-/.test(e.id ?? '') || /^재고정정|^재고실사정정/.test(e.note ?? '');
    const out: Record<string, { 통깨참기름: number; 깨분참기름: number }> = {};
    for (const e of mergedRawMaterialLedger) {
      if ((e.material !== '통깨참기름' && e.material !== '깨분참기름') || !((e.received ?? 0) > 0) || isCorr(e)) continue;
      if (!e.date) continue;
      if (!out[e.date]) out[e.date] = { 통깨참기름: 0, 깨분참기름: 0 };
      out[e.date][e.material as '통깨참기름' | '깨분참기름'] += e.received ?? 0;
    }
    for (const ds in out) { out[ds].통깨참기름 = Math.round(out[ds].통깨참기름); out[ds].깨분참기름 = Math.round(out[ds].깨분참기름); }
    return out;
  }, [mergedRawMaterialLedger]);

  // 재고 발주 관련 상태 (orderRequests는 useAppData에서 Firebase로 관리)

  const [pendingAdminView, setPendingAdminView] = useState<ViewType | null>(null);
  const [isAdminAuthModalOpen, setIsAdminAuthModalOpen] = useState(false);
  const [isOrderCreateChooserOpen, setIsOrderCreateChooserOpen] = useState(false);
  const [isAddOrderOpen, setIsAddOrderOpen] = useState(false);
  const [orderCreateMode, setOrderCreateMode] = useState<'order' | 'stock'>('order');
  const [isPasteOrderOpen, setIsPasteOrderOpen] = useState(false);
  const [pasteOrderInitialText, setPasteOrderInitialText] = useState('');
  const [pasteOrderSourceMessageId, setPasteOrderSourceMessageId] = useState<string | null>(null);
  const [newOrderId, setNewOrderId] = useState<string | null>(null);
  const [copyDraftSource,setCopyDraftSource]=useState(''),[copyDraftVersion,setCopyDraftVersion]=useState(0);
  const copyDraftSourceRef=useRef('');
  const updateCopyDraftSource=useCallback((text:string)=>{copyDraftSourceRef.current=text;setCopyDraftSource(text);},[]);
  const directOrderCreation = useRef(newOrderCreationSession());
  const pasteOrderCreation = useRef(newOrderCreationSession());
  const copyPrepared=useRef<{body:string;request:OrderInterpretationRequest}|null>(null);
  const copyBusy=useRef(false);
  const [copySelected,setCopySelected]=useState<(PendingOrderCopy&{outcome?:'rejected'})|null>(null),[copyError,setCopyError]=useState(''),[copyWorking,setCopyWorking]=useState(false),[copyRulesOpen,setCopyRulesOpen]=useState(false);
  const [,setCopyRevision]=useState(0);
  const copyActor=auth.currentUser?.uid??'';
  const copyScope=useRef({companyId,actorUid:copyActor});
  if(copyScope.current.companyId!==companyId||copyScope.current.actorUid!==copyActor)copyScope.current={companyId,actorUid:copyActor};
  useEffect(()=>{copyPrepared.current=null;copyBusy.current=false;copyDraftSourceRef.current='';setCopyDraftSource('');setCopyWorking(false);setIsPasteOrderOpen(false);setCopySelected(null);setCopyRulesOpen(false);setCopyError('');},[companyId,copyActor]);
  useEffect(()=>{const update=()=>setCopyRevision(value=>value+1);window.addEventListener('storage',update);return()=>window.removeEventListener('storage',update);},[]);
  const copyEntries=copyActor?listPendingOrderCopies(companyId,copyActor):[];
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Item | null>(null);
  const [itemEditorRecovery,setItemEditorRecovery]=useState<ItemEditorRecoveryEntry|null>(null);
  const itemEditorActor=auth.currentUser?.uid;
  const itemEditorScope=useRef({companyId,actor:itemEditorActor,editing:editingProduct,open:isProductModalOpen,token:{}});
  if(itemEditorScope.current.companyId!==companyId||itemEditorScope.current.actor!==itemEditorActor||itemEditorScope.current.editing!==editingProduct||itemEditorScope.current.open!==isProductModalOpen)itemEditorScope.current={companyId,actor:itemEditorActor,editing:editingProduct,open:isProductModalOpen,token:{}};
  const itemEditorToken=itemEditorScope.current.token;
  const isCurrentItemEditor=()=>!!itemEditorActor&&auth.currentUser?.uid===itemEditorActor&&itemEditorScope.current.token===itemEditorToken;

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => window.innerWidth < 1280);
  const [ledgerTab, setLedgerTab] = useState<'cash' | 'partner'>('cash');


  /**
   * **하루 지난 것은 목록에서 감춘다 — 지우지 않는다.**
   *
   * 예전엔 이 자리에 `deleteItem` 을 부르는 effect 가 둘 있었다. 완료·반려된 확인사항과
   * 전표가 끊긴 선입고 이력을 **하루 뒤에 영구 삭제**했다.
   *
   * 목적은 "목록 누적 방지" 였다 — **안 보이게 하는 것**이지 없애는 게 아니었다.
   * 그런데 지워 버리니 —
   *   · 감사 근거가 사라진다. "그 발주 언제 들어왔지" 를 되짚을 수가 없다.
   *   · 화면을 **연 사람의 브라우저**가 지운다. 직원 앱도 결국 이걸 그리므로 관리자만의
   *     일이 아니고, 여러 기기가 같은 삭제를 되풀이한다.
   *   · 삭제 실패는 아무도 안 본다.
   *
   * 그래서 **읽는 쪽에서 거른다.** 데이터는 남고 화면은 그대로 깨끗하다.
   */
  const 하루전 = Date.now() - 24 * 60 * 60 * 1000;

  //  완료·반려하고 하루 지난 확인사항은 안 보인다.
  const 보이는확인사항 = useMemo(() => adjustmentRequests.filter(r => {
    const 끝났나 = r.status === 'processed' || r.status === 'rejected';
    if (!끝났나 || !r.processedAt) return true;
    return new Date(r.processedAt).getTime() >= 하루전;
  }), [adjustmentRequests, 하루전]);

  /**
   * 날짜가 바뀐 뒤 첫 접속에 작업순서를 비운다(주문 자료는 그대로).
   *
   * **다 지운 뒤에만 날짜를 적는다.** 예전엔 `Promise.all` 을 기다리지 않고 곧바로
   * `lastResetDate` 를 오늘로 썼다. 일부가 안 지워져도 그날은 **다시 시도하지 않아**
   * 어제 작업순서가 남은 채 하루를 갔다.
   *
   * **한 기기만 돌게 트랜잭션으로 자리를 잡는다.** 여러 기기가 같이 열면 셋 다 같은 삭제를
   * 되풀이했다. 날짜 도장을 트랜잭션에서 먼저 찍고, 찍은 기기만 지운다.
   * 지우다 실패하면 도장을 되돌려 다음 기기가 이어받는다.
   */
  useEffect(() => { void resetDailyWorkOrder(companyId); }, [companyId]);

  /**
   * **앱을 열 때 이 폰의 푸시 표를 받아 둔다.**
   *
   * 전에는 마이페이지에서만 받았다. 그래서 **마이페이지를 한 번도 안 연 사람은 표가 없어
   * 앱을 닫으면 알림이 아예 안 왔다** — 실제로 10명 중 4명이 표가 없었고, 그중 이은경 상무는
   * 새 주문 알림을 받아야 하는 사람이었다(2026-09-09 확인).
   *
   * 권한이 이미 켜져 있을 때만 받는다 — **여기서 권한을 묻지 않는다.** 묻는 자리는
   * 마이페이지 하나다(자동으로 물으면 그냥 닫아 버려 'default' 로 남고 매번 다시 뜬다).
   *
   * 표는 가끔 바뀐다(앱 재설치·기기 초기화). 열 때마다 받아 두면 저절로 갱신된다 —
   * 같은 표를 또 담아도 `arrayUnion` 이 한 번만 넣는다.
   */
  useEffect(() => {
    if (!currentUser?.id) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    pushSupported()
      .then(ok => { if (ok) return registerPush(currentUser.id); })
      .catch(() => { /* 알림이 안 되는 브라우저 — 앱은 그대로 굴러가야 한다 */ });
  }, [currentUser?.id]);

  /*  **새 주문이 들어오면 폰으로 알린다**(2026-09-03 사장님).
   *  주문 문서를 직접 본다 — 알림 문서(`notifications`)는 관리자 앱이 넣을 때만 쓰이고,
   *  직원 앱에서 들어온 주문은 안 남기기 때문이다.
   *  고르는 셈은 [newOrderAlert.ts](../../shared/newOrderAlert.ts) 에 있고 테스트가 붙어 있다. */
  const 본주문 = useRef(new Set<string>());
  const 주문받아봤나 = useRef(false);
  const 내가넣은주문 = useRef(new Set<string>());
  const 켠시각 = useRef(new Date().toISOString());

  useEffect(() => {
    if (!orders.length && !주문받아봤나.current) return;
    const 새것 = pickNewOrders(orders, 본주문.current, {
      seeded: 주문받아봤나.current,
      since: 켠시각.current,
      mine: 내가넣은주문.current,
    });
    주문받아봤나.current = true;
    if (!새것.length) return;
    const { title, body } = newOrderMessage(새것.map(o => o.partnerName || '거래처'));
    notify({ title, body, tag: 'new-order', mode: loadNotifyMode(), view: 'orders', whenFocused: true, onClick: () => setCurrentView('orders') });
  }, [orders]);

  /*  **오피스톡 알림은 어느 화면에 있어도 온다**(2026-09-03 사장님).
   *  전에는 감지가 OfficeTalk 안에 있어서 그 화면을 보고 있을 때만 왔다.
   *  고르는 셈은 [newChatAlert.ts](../../shared/newChatAlert.ts) 에 있고 테스트가 붙어 있다. */
  const 본방 = useRef(new Map<string, string>());
  useEffect(() => {
    const 새것 = pickNewChats(chatRooms, 본방.current, {
      userId: currentUser.id,
      openRoomId: currentView === 'officetalk' ? openChatRoomId : null,
      focused: currentView === 'officetalk' && document.hasFocus(),
    });
    for (const room of 새것) {
      const { title, body } = chatMessage(room, roomNameFor(room, currentUser.id, employees));
      notify({
        title, body, tag: room.id, mode: loadNotifyMode(), view: 'officetalk', whenFocused: true,
        onClick: () => { setCurrentView('officetalk'); setOpenChatRoomId(room.id); },
      });
    }
  }, [chatRooms]);

  /*  알림을 눌러 앱이 열렸을 때 그 화면으로 보낸다.
   *  꺼져 있었으면 주소로(`?notif=`), 열려 있었으면 서비스워커가 보낸 쪽지로 온다. */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('notif');
    if (q) { setCurrentView(normalizeViewAlias(q) as ViewType); window.history.replaceState(null, '', window.location.pathname); }

    const 쪽지 = (e: MessageEvent) => {
      if (e.data?.type === 'notif-open' && e.data.view) setCurrentView(normalizeViewAlias(e.data.view) as ViewType);
    };
    navigator.serviceWorker?.addEventListener('message', 쪽지);
    return () => navigator.serviceWorker?.removeEventListener('message', 쪽지);
  }, []);

  // 상위 상태에 남은 옛 탭 이름도 현재 화면으로 정리한다. 렌더 분기는 즉시 현재 화면을 사용한다.
  useEffect(() => {
    const resolved = normalizeViewAlias(currentView) as ViewType;
    if (resolved !== currentView) setCurrentView(resolved);
  }, [currentView, setCurrentView]);

  // 2주 지난 알림 자동 삭제
  useEffect(() => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    appNotifications.forEach(n => {
      if (n.createdAt < twoWeeksAgo) {
        deleteItem('notifications', n.id);
      }
    });
  }, [appNotifications]);

  // 신규 주문 등록 시 부자재 부족 여부 체크 후 확인사항 등록
  const checkAndAlertShortage = async (orderItems: Order['items'], partnerId?: string) => {
    const usage: Record<string, { name: string; needed: number; unit: string }> = {};
    const rawUsageKg: Record<string, number> = {}; // 원료식(BOM) 기반 원료 소요량(kg) — 홀더(벌크·1kg포) 재고와 비교
    for (const item of orderItems) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) continue;

      // 향미유: 재고는 박스 단위
      if (product.category === '향미유') {
        const sub = submaterials.find(s => s.id === product.id);
        if (sub) {
          const boxesNeeded = item.isBoxUnit && item.boxQuantity
            ? item.boxQuantity
            //  개입수는 품목이 안다(BOM 아니면 포장 환산표). 예전엔 `boxSize || 1` 이라
            //  그 필드를 걷어낸 뒤로 **36개 주문에 박스 자재 36개**를 잡고 있었다(3개가 맞다).
            : Math.ceil(item.quantity / (unitsPerBoxOf(product, appData.orderUnitInputs) || 1));
          usage[sub.id] = { name: sub.name, needed: (usage[sub.id]?.needed ?? 0) + boxesNeeded, unit: 'B' };
        }
        continue;
      }

      //  캔 같은 개수 반제품도 원료가 든다 — 빠지면 캔 주문에 원료 부족 경고가 안 뜬다.
      if (!holdsUnitStock(product)) continue;
      // 완사입=원료 무관, 임가공=외주가 볶아 옴(우리 원료 로트가 아님) → 둘 다 원료 부족 대상이 아니다
      if (product.procureType === '완사입' || product.procureType === '임가공') continue;

      const units = stockUnits(item, product, appData.orderUnitInputs);   // 박스 품목이면 박스 개수 (spec은 박스 1개 내용량)

      // 원료식(item_formula/PRODUCT_FORMULA) 기반 원료 kg 소요 집계 — 부자재와 별도 경로
      for (const f of buildFormula(docName(product))) {
        const kg = toKg(product.spec || '', f.raw, units) * f.ratio;
        if (kg > 0) rawUsageKg[f.raw] = (rawUsageKg[f.raw] ?? 0) + kg;
      }

      // 겉박스·테이프는 이제 **박스 품목 BOM**에 들어 있다 — 거래처별 포장설정(shipping_rule)은 폐기.
      // 그래서 여기서 따로 세지 않고 아래 BOM 순회가 통째로 맡는다.
      for (const line of (appData.orderUnitInputs ? appData.orderUnitInputs.bom.of(product.id) : bomOf(product.id))) {
        const sub = submaterials.find(sm => sm.id === line.childId);
        if (!sub) continue;
        // 원료 홀더(raw/wip)는 kg 단위라 '개' 집계가 틀림 → 위 원료식(kg) 경로에서 체크
        if (sub.type === 'raw' || sub.type === 'wip') continue;
        // 재고 1단위 × BOM 수량 — 이중캡 ×2, 180ml캡 ×3 같은 것
        usage[sub.id] = { name: sub.name, needed: (usage[sub.id]?.needed ?? 0) + units * line.qty, unit: '개' };
      }
    }

    for (const [subId, data] of Object.entries(usage)) {
      const sub = submaterials.find(s => s.id === subId);
      if (!sub || data.needed <= sub.stock) continue;

      const alreadyExists = adjustmentRequests.some(
        r => r.itemId === subId && r.type === 'reorder_alert' && r.status === 'pending'
      );
      if (alreadyExists) continue;

      const shortage = data.needed - sub.stock;
      await addItem('adjustmentRequests', {
        id: `REORDER-${subId}-${Date.now()}`,
        itemId: subId,
        itemName: data.name || sub.name || subId,
        originalQuantity: sub.stock,
        requestedQuantity: shortage,
        type: 'reorder_alert',
        unit: data.unit,
        reason: `신규 주문 소요량 ${data.needed}${data.unit}, 재고 ${sub.stock}${data.unit} → ${shortage}${data.unit} 부족. 발주 필요.`,
        status: 'pending',
        requestedAt: new Date().toISOString(),
      });
      await addItem('notifications', { type: 'confirmation', title: '확인사항 발생', body: `${data.name} ${shortage}${data.unit} 부족 — 발주 필요`, readBy: [], createdAt: new Date().toISOString() } as Omit<AppNotification,'id'>);
    }

    // 원료 홀더(벌크·1kg포 등) 부족 체크 — 원료식 kg 기준 (로트 합계 우선)
    const round1 = (n: number) => Math.round(n * 10) / 10;
    for (const [material, neededKg] of Object.entries(rawUsageKg)) {
      const holder = rawHolderByName(allItems, material, companyId);
      if (!holder) continue;
      const stockKg = holder.lots?.length ? lotKgRemaining(holder.lots) : (holder.stock ?? 0);
      if (neededKg <= stockKg) continue;
      const alreadyExists = adjustmentRequests.some(
        r => r.itemId === holder.id && r.type === 'reorder_alert' && r.status === 'pending'
      );
      if (alreadyExists) continue;
      const shortageKg = round1(neededKg - stockKg);
      await addItem('adjustmentRequests', {
        id: `REORDER-${holder.id}-${Date.now()}`,
        itemId: holder.id,
        itemName: holder.name,
        originalQuantity: round1(stockKg),
        requestedQuantity: shortageKg,
        type: 'reorder_alert',
        unit: 'kg',
        reason: `신규 주문 소요량 ${round1(neededKg)}kg, 재고 ${round1(stockKg)}kg → ${shortageKg}kg 부족. 발주 필요.`,
        status: 'pending',
        requestedAt: new Date().toISOString(),
      });
      await addItem('notifications', { type: 'confirmation', title: '확인사항 발생', body: `${holder.name} ${shortageKg}kg 부족 — 발주 필요`, readBy: [], createdAt: new Date().toISOString() } as Omit<AppNotification,'id'>);
    }
  };


  // --- 재고 관리 핸들러 (purchaseOrders 기반) ---
  const handleAddOrderRequest = async (id: string, quantity: number, isBox?: boolean) => {
    // append-only: 발주할 때마다 새 발주카드 추가
    const product = allItems.find(p => p.id === id);
    const ps = partnerIn.find(s => s.itemId === id || (s as any).itemId === id);
    const partnerId = ps?.partnerId || (ps as any)?.partnerId;
    const partnerName = partnerId ? partners.find(c => c.id === partnerId)?.name : undefined;
    await executeEmployeeCommand({ kind: 'create', collection: 'purchaseOrders', data: {
      id: `po-${Date.now()}`, cardNo: nextPoNo(today(), purchaseOrders), itemId: id, itemName: product?.name ?? '',
      //  **수량은 재고 단위로 저장한다.** 박스로 골랐으면 여기서 풀고 '몇 박스'만 따로 남긴다 —
      //  읽는 쪽마다 곱하면 한 곳만 빠뜨려도 재고가 어긋난다(판매 주문이 이미 이 방식이다).
      ...(() => {
        const per = unitsPerBoxOf(product, appData.orderUnitInputs);
        return isBox && per > 1
          ? { quantity: quantity * per, boxQuantity: quantity }
          : { quantity };
      })(),
      status: 'pending',
      confirmedByUser: true, createdAt: new Date().toISOString(),
      ...(partnerId ? { partnerId, partnerName } : {}),
    } });
  };

  const handleRemoveOrderRequest = async (id: string) => {
    await deleteItem('purchaseOrders', id);
  };

  const handleUpdateOrderRequestQty = async (id: string, quantity: number) => {
    await updateItem('purchaseOrders', id, { quantity });
  };

  // 묶음 발주카드(items[]) 내 품목 수량 수정 / 제거
  const handleUpdatePoItemQty = async (poId: string, index: number, quantity: number) => {
    const po = purchaseOrders.find(p => p.id === poId);
    if (!po) return;
    if (po.items && po.items.length > 0) {
      await updateItem('purchaseOrders', poId, { items: po.items.map((it, i) => i === index ? { ...it, quantity } : it) });
    } else {
      await updateItem('purchaseOrders', poId, { quantity });
    }
  };
  const handleRemovePoItem = async (poId: string, index: number) => {
    const po = purchaseOrders.find(p => p.id === poId);
    if (!po) return;
    if (po.items && po.items.length > 0) {
      const items = po.items.filter((_, i) => i !== index);
      if (items.length === 0) await deleteItem('purchaseOrders', poId);
      else await updateItem('purchaseOrders', poId, { items });
    } else {
      await deleteItem('purchaseOrders', poId);
    }
  };

  const handleToggleConfirmRequestQty = async (id: string) => {
    const po = purchaseOrders.find(po => po.id === id);
    if (po) await updateItem('purchaseOrders', id, { confirmedByUser: !po.confirmedByUser });
  };

  // 장바구니 확정 → 발주예정(pending) 생성
  // 주문카드처럼: 같은 거래처 품목은 묶어서 발주카드 1개(items[]), 제출할 때마다 새 카드 추가(append-only)
  const handleBulkAddConfirmedOrders = async (items: { id: string, quantity: number, boxQuantity?: number, partnerId?: string }[]) => {
    if (items.some(item => item.partnerId && (!partners.some(partner => partner.id === item.partnerId) || !partnerIn.some(link => link.itemId === item.id && link.partnerId === item.partnerId)))) throw new Error('선택한 매입 거래처 연결이 변경되었습니다. 다시 선택해 주세요.');
    const base = Date.now();
    const createdAt = new Date().toISOString();
    // 거래처별 묶음 (partnerId 없으면 품목별 개별 카드)
    const groups = new Map<string, { partnerId?: string; partnerName?: string; items: typeof items }>();
    items.forEach((item, idx) => {
      const ps = partnerIn.find(s => s.itemId === item.id || (s as any).itemId === item.id);
      const partnerId = item.partnerId || ps?.partnerId || (ps as any)?.partnerId;
      const partnerName = partnerId ? partners.find(c => c.id === partnerId)?.name : undefined;
      const key = partnerId || `__none_${idx}`;
      if (!groups.has(key)) groups.set(key, { partnerId, partnerName, items: [] });
      groups.get(key)!.items.push(item);
    });
    let gi = 0;
    for (const g of groups.values()) {
      const poItems = g.items.map(it => {
        const product = allItems.find(p => p.id === it.id);
        //  수량은 재고 단위로 이미 풀려 왔다 — 여기서 곱하지 않는다.
        //  boxQuantity 는 '몇 박스라고 말했는지'만 남긴다(명세서·목록 표시용).
        return { itemId: it.id, name: product?.name ?? '', quantity: it.quantity, unit: product?.unit ?? '개', ...(it.boxQuantity ? { boxQuantity: it.boxQuantity } : {}) };
      });
      await executeEmployeeCommand({ kind: 'create', collection: 'purchaseOrders', data: {
        id: `po-${base}-${gi++}`, cardNo: nextPoNo(today(), purchaseOrders), itemId: '', itemName: '', quantity: 0,
        items: poItems, status: 'pending', createdAt,
        ...(g.partnerId ? { partnerId: g.partnerId, partnerName: g.partnerName } : {}),
      } });
    }
  };

  // 발주예정 → 입고대기(invoiced)로 직접 확정 (전표 없이)
  // item.id는 PO 문서 ID (UUID 또는 itemId)
  const handleConfirmPendingToInvoiced = async (selected: { id: string, quantity: number }[]) => {
    const token = orderAskScope.current.token, uid = auth.currentUser?.uid;
    const active = () => orderAskScope.current.token === token && orderAskScope.current.companyId === companyId && auth.currentUser?.uid === uid;
    if (!uid || !active()) return;
    // 한 건을 기다리는 동안 구독이 갱신돼도 나머지 발주는 승인 당시 원문으로만 확인한다.
    const originals = selected.map(row => purchaseOrders.find(po => po.id === row.id));
    try {
      for (const original of originals) {
        if (!active()) return;
        if (!original) throw new Error('발주가 없거나 이미 삭제됐습니다. 새로 확인해주세요.');
        await confirmPendingPurchaseOrder(companyId, original);
      }
    } catch (error) {
      if (active()) await awaitNotice(error instanceof Error ? error.message : String(error), '발주확정 중단');
    }
  };


  const createProductionRecordPlan = (order: Order, inputs: OrderUnitInputs | undefined, generation: OrderInventoryGeneration) => buildOrderProductionRecordPlan(order, allItems, inputs, generation);

  // 역분개·재고·비현금 상계·처리 상태는 서버의 한 거래로 확정한다.
  const handleProcessReturn = async (req: ReturnRequest) => {
    if (!isAdmin || req.companyId !== companyId || orderAskScope.current.companyId !== companyId) throw new Error('관리자 회사 권한이 필요합니다.');
    const scope = orderAskScope.current.token;
    await processReturn(companyId, req);
    if (orderAskScope.current.token === scope) setLedgerReloadKey(k => k + 1);
  };

  const handleResumeReturn = async (requestId: string) => {
    if (!isAdmin || orderAskScope.current.companyId !== companyId) throw new Error('관리자 회사 권한이 필요합니다.');
    const scope = orderAskScope.current.token;
    await resumePendingReturn(companyId, requestId);
    if (orderAskScope.current.token === scope) setLedgerReloadKey(k => k + 1);
  };

  // ── 생산/출고 분리 재고 엔진 → 도메인 모듈(orderStockEngine)로 분리. 매 렌더 데이터/쓰기 함수 주입. ──
  const { changeOrderStatus, changeOrderItemCompletion, prepareOrderStatusChange,
    prepareOrderCancellation, executeOrderCancellation, readOrderCancellation } = createOrderStockEngine({
    actorName: currentUser?.name,
    allItems, submaterials, partners, allOrders, orders, db,
    buildFormula, createProductionRecordPlan, updateItem, addItem,
    orderUnitInputs: appData.orderUnitInputs,
    claimOrderOperation: claimOrderInventoryOperation,
  });

  // 품목 완료 진입점 — 생산품은 재고 유무와 관계없이 모달에서 재고 사용/전량 생산을 확인한다.
  // 드롭다운으로 바꾸든 품목 체크로 자동 이동하든 여기 하나를 지난다.
  /**
   * **임가공·완사입 품목을 완료할 때 묻는다**(2026-09-14 사장님: "재고가 있으면 재고
   * 사용할까요 뜨는거고 재고 부족하거나 없으면 재고가 부족합니다 … 음수가 됩니다").
   *
   * 볶음참깨/1kg 을 완료해도 **아무 말이 없었다.** 그 품목이 `procureType=임가공` 이라
   * 재고 사용 확인창(`buildStockUseRows`)이 통째로 건너뛰기 때문이다 — 우리가 만드는 게
   * 아니라 "재고를 쓸까 만들까"를 물을 게 없다는 판단이었다. 그런데 **묻지 않으니 재고가
   * 모자란 것도 모르고 지나간다.**
   *
   * 이 품목들은 생산이 없으므로 **출고할 때 재고에서 그대로 빠진다**(orderStockEngine
   * `shipOrder`). 모자라면 그때 음수가 된다 — 그래서 완료를 찍는 지금 알린다.
   */
  const [goodsStockAsk, setGoodsStockAsk] = useState<{
    scope: object; title: string; tone: AlertTone; message: string; subMessage: string; confirmText: string; onConfirm: () => void;
  } | null>(null);

  /**
   * **상태를 되돌릴 때 묻는 창**(2026-09-14 사장님: "작업완료 이후에 있던 주문들이 돌아올때는
   * 무조건 알람 띄워야지 … 차감된 원료 부자재 같은거 롤백해야 하는데").
   *
   * 되돌리기는 재고를 조용히 움직인다 — 출고취소로 완제품이 다시 채워지고, 생산취소로
   * BOM 구성품(병·캡·라벨·박스)과 원료 로트가 복원되며 원료수불부 줄이 지워진다.
   * 그동안은 **내릴 때 아무것도 안 물어서**, 눌러 놓고 나중에 "왜 재고가 늘었지"로 만나면
   * 되짚을 길이 없었다. 글은 `buildStatusChangeAsk` 가 만든다 — 여기는 띄우기만 한다.
   */
  const orderAskScope = useRef({ companyId, token: {} });
  if (orderAskScope.current.companyId !== companyId) orderAskScope.current = { companyId, token: {} };
  useEffect(() => () => { orderAskScope.current = { ...orderAskScope.current, token: {} }; }, []);
  const [rollbackAsk, setRollbackAsk] = useState<{
    scope: object;
    message: string; subMessage: string; confirmText: string; onConfirm: () => Promise<void>;
  } | null>(null);
  /**
   * **주문 상태 색** — 알림 머리의 아이콘 색을 카드와 맞춘다.
   * 색을 정하는 곳은 `orderStatusStyle` 이지만 그쪽은 Tailwind 클래스라 갈래 이름이 필요하다.
   */
  const 상태색: Record<string, AlertTone> = {
    [OrderStatus.PENDING]: 'amber', [OrderStatus.PROCESSING]: 'pink',
    [OrderStatus.DISPATCHED]: 'emerald', [OrderStatus.SHIPPED]: 'sky',
    [OrderStatus.DELIVERED]: 'slate', [OrderStatus.ON_HOLD]: 'amber',
  };
  const [rollbackBusy, setRollbackBusy] = useState<object | null>(null);
  const rollbackBusyRef = useRef<object | null>(null);
  const rollbackSaving = !!rollbackAsk && rollbackBusy === rollbackAsk;

  const [stockUseAsk, setStockUseAsk] = useState<{
    scope: object; mode: 'status'; orderId: string; partnerName: string; rows: StockUseRow[]; orderPatch?: Partial<Order>;
  } | {
    scope: object; mode: 'line'; orderId: string; partnerName: string; rows: StockUseRow[];
    onConfirm: (plan: StockUsePlan) => Promise<void>;
  } | null>(null);
  const orderAskCurrent = useRef<{ rollback: object | null; stock: object | null; goods: object | null }>({ rollback: null, stock: null, goods: null });
  orderAskCurrent.current = { rollback: rollbackAsk, stock: stockUseAsk, goods: goodsStockAsk };
  const [catalogDeleteAsk, setCatalogDeleteAsk] = useState<{
    scope: object;
    itemId: string;
    itemName: string;
    bomIds: string[];
    partnerItemIds: string[];
    subMessage: string;
  } | null>(null);
  const catalogDeleteCurrent = useRef<typeof catalogDeleteAsk>(null);
  catalogDeleteCurrent.current = catalogDeleteAsk;
  const catalogDeleteRequest = useRef<object | null>(null);
  const catalogDeleteBusy = useRef<object | null>(null);
  const [appNotice, setAppNotice] = useState<{
    title?: string;
    tone?: AlertTone;
    icon?: LucideIcon;
    message: string;
    subMessage: string;
  } | null>(null);

  const loadCatalogDeleteBlockers = async (itemId: string) => catalogItemDeleteBlockers(
    itemId,
    await fetchWhereIn<Order>('orders', 'status', CATALOG_DELETE_BLOCKING_STATUSES, companyId),
  );

  const requestCatalogItemDelete = async (itemId: string) => {
    const askScope = orderAskScope.current.token;
    const request = {};
    catalogDeleteRequest.current = request;
    const item = allItems.find(candidate => candidate.id === itemId);
    if (!item) return;
    try {
      const blockers = await loadCatalogDeleteBlockers(itemId);
      if (orderAskScope.current.token !== askScope || catalogDeleteRequest.current !== request) return;
      if (blockers.length > 0) {
        setAppNotice({
          message: '진행 중 주문이 있어 품목을 삭제할 수 없습니다',
          subMessage: catalogItemDeleteBlockMessage(item.name, blockers),
        });
        return;
      }
      const plan = planCatalogItemDelete(itemId, allItems, itemBoms, partnerItems);
      setCatalogDeleteAsk({ scope: askScope, itemId, itemName: item.name, ...plan });
    } catch (error) {
      if (orderAskScope.current.token !== askScope || catalogDeleteRequest.current !== request) return;
      console.error('품목 삭제 전 주문 확인 실패', error);
      setAppNotice({
        message: '품목 삭제 전 주문을 확인하지 못했습니다',
        subMessage: '안전하게 삭제를 중단했습니다. 잠시 뒤 다시 시도해 주세요.',
      });
    }
  };

  const confirmCatalogItemDelete = async () => {
    const ask = catalogDeleteAsk;
    if (!ask || ask.scope !== orderAskScope.current.token || catalogDeleteCurrent.current !== ask || catalogDeleteBusy.current === ask) return;
    catalogDeleteBusy.current = ask;
    const isCurrent = () => ask.scope === orderAskScope.current.token && catalogDeleteCurrent.current === ask;
    try {
      // 확인창이 열린 뒤 주문이 생길 수도 있으므로 실제 삭제 직전에 다시 읽는다.
      const blockers = await loadCatalogDeleteBlockers(ask.itemId);
      if (!isCurrent()) return;
      if (blockers.length > 0) {
        setCatalogDeleteAsk(current => current === ask ? null : current);
        setAppNotice({
          message: '진행 중 주문이 생겨 품목을 삭제하지 않았습니다',
          subMessage: catalogItemDeleteBlockMessage(ask.itemName, blockers),
        });
        return;
      }
      // 품목만 먼저 없어지면 BOM에 존재하지 않는 ID가 남아 생산 처리가 막힌다.
      // 품목과 현재 BOM·거래처 연결을 같은 batch에 넣어 전부 성공하거나 전부 실패하게 한다.
      await commitCompanyWrites([
        { kind: 'delete', collection: COL.items, id: ask.itemId },
        ...ask.bomIds.map(id => ({ kind: 'delete' as const, collection: COL.itemBom, id })),
        ...ask.partnerItemIds.map(id => ({ kind: 'delete' as const, collection: COL.partnerItem, id })),
      ]);
      if (!isCurrent()) return;
      setCatalogDeleteAsk(current => current === ask ? null : current);
      refreshStaticData();
    } catch (error) {
      if (!isCurrent()) return;
      console.error('품목과 BOM 연결 삭제 실패', error);
      const reason = error instanceof Error ? error.message : String(error);
      alert(`품목을 삭제하지 못했습니다.\n사유: ${reason}`);
    } finally {
      if (catalogDeleteBusy.current === ask) catalogDeleteBusy.current = null;
    }
  };

  type NewOrderDraft = Omit<Order, 'id' | 'status'>;
  const saveCopiedOrder=async(draft:NewOrderDraft,evidence?:OrderCopyEvidence)=>{
    if(copyBusy.current)return;
    const scope=copyScope.current;
    const current=()=>copyScope.current===scope&&auth.currentUser?.uid===scope.actorUid;
    if(!scope.actorUid||!evidence)throw Error('최초 주문 원문과 로그인 계정을 확인해 주세요.');
    const body=JSON.stringify({draft,evidence,sourceChatMessageId:pasteOrderSourceMessageId});
    let first=copyPrepared.current;
    const unresolved=listPendingOrderCopies(companyId,scope.actorUid).find(row=>row.request?.sourceText===evidence.sourceText);
    if(unresolved&&(!first||first.body!==body||first.request.requestId!==unresolved.request?.requestId)){
      setCopySelected(unresolved);setCopyError('이 내용으로 저장하던 주문이 있습니다. 결과를 확인하거나 같은 내용으로 다시 시도해 주세요.');return;
    }
    if(!first||first.body!==body){
      const requestId=crypto.randomUUID();
      const request=validateOrderInterpretation({version:1,requestId,companyId,actorUid:scope.actorUid,createdAt:new Date().toISOString(),sourceText:evidence.sourceText,firstAnalysis:evidence.firstAnalysis,
        confirmed:{inputLines:evidence.inputLines,...(evidence.expressionConfirmations?.length?{expressionConfirmations:evidence.expressionConfirmations}:{}),orderDraft:{...draft,id:`ORD-COPY-${requestId}`,cardNo:nextOrderNo(today(),allOrders),items:ensureOrderLineIds(draft.items),...(pasteOrderSourceMessageId?{sourceChatMessageId:pasteOrderSourceMessageId}:{})}}},scope);
      first={body,request};copyPrepared.current=first;
    }
    copyBusy.current=true;setCopyWorking(true);
    try{
      const result=await submitOrderCopy(first.request);if(!current())return;
      if(result.status==='unknown')throw Error(result.reason??'주문 처리 결과를 아직 확인하지 못했습니다.');
      if(result.status==='rejected'){if(copyPrepared.current===first)copyPrepared.current=null;const message=`이번 요청으로 주문을 저장하지 않았습니다. ${result.reason??'내용을 확인하고 다시 작성해 주세요.'}`;setCopySelected({key:'rejected:'+first.request.requestId,text:'',request:first.request,deleted:false,error:message,outcome:'rejected'});throw Error(message);}
      setNewOrderId(result.orderId);
      if(copyPrepared.current===first){copyPrepared.current=null;setIsPasteOrderOpen(false);setPasteOrderInitialText('');setPasteOrderSourceMessageId(null);}
      setCopyRevision(value=>value+1);
    }catch(error){if(current()){
      const message=error instanceof Error?error.message:String(error),own=listPendingOrderCopies(companyId,scope.actorUid).find(row=>row.request?.requestId===first!.request.requestId);
      setCopyError(message);setCopyRevision(value=>value+1);
      if(own){setCopySelected(own);}else throw error;
    }}finally{if(current()){copyBusy.current=false;setCopyWorking(false);}}
  };
  const actCopiedOrder=async(entry:PendingOrderCopy,action:'retry'|'inspect'|'delete',currentDraftSource?:string)=>{
    if(copyBusy.current)return;const scope=copyScope.current,current=()=>copyScope.current===scope&&auth.currentUser?.uid===scope.actorUid;
    const fresh=listPendingOrderCopies(companyId,scope.actorUid).find(row=>row.key===entry.key);
    if(!fresh||fresh.text!==entry.text){setCopyError('다른 창에서 저장 정보가 변경되었습니다. 해당 주문을 다시 선택해 주세요.');return;}
    copyBusy.current=true;setCopyWorking(true);
    try{
      if(action==='delete')await deletePendingOrderCopy(entry);
      else {
        if(!entry.request)throw Error(entry.error);
        const result=await(action==='inspect'?inspectOrderCopy(entry.request):submitOrderCopy(entry.request));if(!current())return;
        if(result.status==='unknown')throw Error('주문이 저장됐는지 아직 확인되지 않았습니다. 결과를 확인하거나 같은 내용으로 다시 시도해 주세요.');
        if(result.status==='rejected'){
          if(copyPrepared.current?.request.requestId===entry.request.requestId)copyPrepared.current=null;
          setCopySelected({...entry,outcome:'rejected'});setCopyError(`이번 요청으로 주문을 저장하지 않았습니다. ${result.reason??'내용을 확인하고 다시 작성해 주세요.'}`);setCopyRevision(value=>value+1);return;
        }
        setNewOrderId(result.orderId);
        const latestSource=copyDraftSourceRef.current;
        if(latestSource===''||latestSource===entry.request.sourceText){setIsPasteOrderOpen(false);setPasteOrderInitialText('');setPasteOrderSourceMessageId(null);}
      }
      if(current()){if(copyPrepared.current?.request.requestId===entry.request?.requestId)copyPrepared.current=null;setCopySelected(null);setCopyError('');setCopyRevision(value=>value+1);}
    }catch(error){if(current())setCopyError(error instanceof Error?error.message:String(error));}
    finally{if(current()){copyBusy.current=false;setCopyWorking(false);}}
  };
  const rewriteCopiedOrder=(entry:PendingOrderCopy&{outcome?:'rejected'})=>{
    if(copyBusy.current||entry.outcome!=='rejected'||!entry.request)return;
    const sourceMessageId=entry.request.confirmed.orderDraft.sourceChatMessageId;
    setPasteOrderInitialText(entry.request.sourceText);setPasteOrderSourceMessageId(typeof sourceMessageId==='string'?sourceMessageId:null);
    copyPrepared.current=null;setCopySelected(null);setCopyError('');setCopyDraftVersion(value=>value+1);
  };

  const saveNewOrder = async (kind: 'direct' | 'paste', draft: NewOrderDraft) => {
    const session = kind === 'direct' ? directOrderCreation.current : pasteOrderCreation.current;
    const label = kind === 'direct' ? 'AddOrder' : 'PasteOrder';
    const partnerName = partners.find(partner => partner.id === draft.partnerId)?.name
      || draft.partnerName || '거래처';
    try {
      const result = await submitOrderCreation(session, draft, {
        createIdentity: () => ({ id: `ORD-${Date.now()}`, cardNo: nextOrderNo(today(), allOrders) }),
        saveOrder: async (identity, order) => {
          // 응답만 끊기고 DB에는 저장됐을 수도 있어 재시도에서 같은 ID·카드번호를 다시 쓴다.
          내가넣은주문.current.add(identity.id);
          await executeEmployeeCommand({ kind: 'create', collection: 'orders', data: {
            ...order,
            items: ensureOrderLineIds(order.items),
            companyId,
            id: identity.id,
            cardNo: identity.cardNo,
            createdBy: currentUser.id,
            ...(kind === 'paste' && pasteOrderSourceMessageId ? { sourceChatMessageId: pasteOrderSourceMessageId } : {}),
            createdAt: order.createdAt || new Date().toISOString(),
            status: OrderStatus.PENDING,
          } });
        },
        followUps: [
          {
            label: '재고 부족 확인',
            run: async () => {
              try { if (!isStockProduction(draft)) await checkAndAlertShortage(draft.items, draft.partnerId); }
              catch (error) { console.error(`[${label}] 재고 부족 확인 실패`, error); throw error; }
            },
          },
          {
            label: '신규 주문 알림',
            run: async (identity) => {
              try {
                await addItem('notifications', {
                  type: 'new_order', title: isStockProduction(draft) ? '재고 만들기' : '신규 주문', body: `${partnerName} 주문이 등록되었습니다.`,
                  readBy: [], createdAt: new Date().toISOString(), senderId: currentUser.id,
                  linkedId: identity.id,
                } as Omit<AppNotification, 'id'>);
              } catch (error) { console.error(`[${label}] 신규 주문 알림 실패`, error); throw error; }
            },
          },
        ],
      });
      if (result.status === 'busy') return;
      setNewOrderId(result.identity.id);
      if (kind === 'direct') setIsAddOrderOpen(false);
      else {
        setIsPasteOrderOpen(false);
        setPasteOrderInitialText('');
        setPasteOrderSourceMessageId(null);
      }
      if (result.failedFollowUps.length > 0) {
        setAppNotice({
          message: '주문은 정상적으로 저장됐습니다',
          subMessage: `${result.failedFollowUps.join(', ')}을 처리하지 못했습니다. 주문을 다시 만들 필요는 없습니다.`,
        });
      }
    } catch (error) {
      console.error(`[${label}] 주문 본문 저장 실패`, error);
      const reason = error instanceof Error ? error.message : String(error);
      setAppNotice({
        message: '주문을 저장하지 못했습니다',
        subMessage: `${reason}\n다시 누르면 같은 주문번호로 재시도합니다.`,
      });
    }
  };

  const closeOrderCreation = (kind: 'direct' | 'paste', goBack = false) => {
    if(kind==='paste'&&copyBusy.current)return;
    const session = kind === 'direct' ? directOrderCreation.current : pasteOrderCreation.current;
    if (session.busy) return;
    resetOrderCreationSession(session);
    if (kind === 'direct') setIsAddOrderOpen(false);
    else {
      setIsPasteOrderOpen(false);
      setCopySelected(null);setCopyError('');setCopyRulesOpen(false);
      setCopyDraftSource('');
      setPasteOrderInitialText('');
      setPasteOrderSourceMessageId(null);
    }
    if (goBack) setIsOrderCreateChooserOpen(true);
  };

  const requestOrderStatus = async (id: string, requestedStatus: OrderStatus, orderPatch?: Partial<Order>) => {
    const askScope = orderAskScope.current.token;
    const prepared = await prepareOrderStatusChange(id, requestedStatus);
    if (orderAskScope.current.token !== askScope) return;
    const cur = prepared?.order ?? allOrders.find(o => o.id === id) ?? orders.find(o => o.id === id);
    const nextItems = orderPatch?.items ?? cur?.items ?? [];
    // 대기중·작업중·작업완료는 사람이 고르는 값이 아니다. 남아 있는 옛 호출 경로가 어떤
    // 상태를 요구해도 품목 체크 수에서 다시 정해 거산 주문 같은 불일치를 만들지 않는다.
    const status = [OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.DISPATCHED].includes(requestedStatus)
      ? workStatusFromItems(nextItems)
      : requestedStatus;
    if (cur && requiresCompleteItemsForStatusChange(cur.status, status) && !hasCompleteOrderItems(nextItems)) {
      alert('모든 주문 품목의 작업완료 여부를 확인한 뒤 상태를 변경해 주세요.');
      return;
    }
    // 작업완료 이후 → 대기중/작업중으로 되돌리면 품목 체크를 전부 푼다.
    //  OrdersList가 '전부 체크됨'을 보면 카드가 다시 그려질 때마다 작업완료로 자동 이동시켜서,
    //  체크를 남겨두면 되돌리는 즉시 원위치돼 되돌리기가 아예 안 되는 것처럼 보인다.
    const stockStage = (value: OrderStatus) => value === OrderStatus.SHIPPED || value === OrderStatus.DELIVERED
      ? 2 : value === OrderStatus.DISPATCHED ? 1 : 0;
    const isInventoryRollback = !!cur && (
      stockStage(status) < stockStage(cur.status) ||
      (!!cur.producedAt && cur.status === OrderStatus.PROCESSING && status === OrderStatus.PENDING)
    );
    if (cur && isInventoryRollback) {
      /*  부른 쪽이 **체크 상태를 직접 줬으면 그걸 쓴다**(2026-09-12).
       *  체크를 하나 푸는 길은 이미 '그 하나만 풀린' 목록을 들고 온다 — 여기서 전부 지워 버리면
       *  나머지 체크까지 날아간다. 전부 푸는 건 **상태를 직접 내릴 때**의 이야기다
       *  (그때는 목록을 안 들고 오고, 전부 체크된 채로 두면 카드가 도로 작업완료로 올라간다). */
      const shouldClearChecks = !orderPatch?.items
        && (status === OrderStatus.PENDING || status === OrderStatus.PROCESSING);
      const clearedItems = shouldClearChecks
        ? cur.items.map(({ checkedBy: _dropBy, checkedAt: _dropAt, ...rest }) => ({ ...rest, checked: false }))
        : cur.items;
      /*  **되돌릴 때는 반드시 묻는다**(2026-09-14 사장님). 한동안 묻지 않고 바로 원복했는데,
       *  그 사이 원료·부자재가 조용히 되돌아가 무슨 일이 있었는지 알 길이 없었다.
       *  되돌릴 것이 하나도 없는 건(전량 재고로 나가 생산이 없던 건)도 묻기는 한다 —
       *  다만 `buildStatusChangeAsk` 가 "되돌릴 원료·부자재가 없습니다"로 글을 바꾼다. */
      const 계획: RollbackPlan = prepared?.plan ?? buildRollbackPlan(cur, allItems, cur.status, status, appData.orderUnitInputs);
      const 최종패치 = { ...orderPatch, ...(shouldClearChecks ? { items: clearedItems } : {}) };
      /*  **작업완료에서 내릴 때만** 잡힘이 풀린다 — 출고까지 갔던 건은 재고가 이미 빠졌고,
          그건 위 `계획`(원복)이 되돌린다. 여기서 또 세면 두 번 말하는 셈이 된다. */
      const 풀릴것 = cur.status === OrderStatus.DISPATCHED
        ? cur.items.flatMap(줄 => {
            const 품목 = allItems.find(p => p.id === 줄.itemId);
            const 양 = shipQtyOfLine(줄, 품목, appData.orderUnitInputs);
            return 품목 && 양 > 0
              ? [{ name: 품목.name, qty: 양, unit: unpackComponent(품목, appData.orderUnitInputs) ? '박스' : (품목.unit || '개') }]
              : [];
          })
        : [];
      const 묻는글 = buildStatusChangeAsk({ partnerName: cur.partnerName, from: cur.status, to: status, plan: 계획, released: 풀릴것 });
      setRollbackAsk({
        scope: askScope, ...묻는글,
        onConfirm: () => changeOrderStatus(id, status, undefined, {
          approvedBy: currentUser?.name,
          approvedAt: new Date().toISOString(),
          //  승인한 계획과 지금 계획이 다르면 엔진이 막는다 — 창을 띄워 둔 사이 누가 바꿨을 수 있다.
          approvedPlan: 계획,
          approvedFromStatus: cur.status,
          orderPatch: 최종패치,
        }),
      });
      return;
    }

    /*  **대기중 ↔ 작업중도 묻는다**(2026-09-14 사장님: "작업중에서 대기중으로 가거나
        대기중에서 작업중으로 가거나 하는 것도 알람띄워 그냥"). 재고는 안 움직이지만,
        끌어 놓다가 잘못 떨어뜨리는 일이 잦아 한 번 물어 준다. */
    if (cur && cur.status !== status
      && (status === OrderStatus.PENDING || status === OrderStatus.PROCESSING)
      && (cur.status === OrderStatus.PENDING || cur.status === OrderStatus.PROCESSING)) {
      const 묻는글 = buildStatusChangeAsk({ partnerName: cur.partnerName, from: cur.status, to: status });
      setRollbackAsk({
        scope: askScope, ...묻는글,
        onConfirm: () => changeOrderStatus(id, status, undefined, { approvedBy: currentUser?.name, orderPatch }),
      });
      return;
    }

    if (status !== OrderStatus.DISPATCHED) return changeOrderStatus(id, status, undefined, { approvedBy: currentUser?.name, orderPatch });
    const order = cur;
    if (!order || order.producedAt || isStockProduction(order)) return changeOrderStatus(id, status, undefined, { approvedBy: currentUser?.name, orderPatch });   // 이미 생산됨 — 물을 것 없다
    const rows = buildStockUseRows(order, allItems, appData.orderUnitInputs);
    if (rows.length === 0) return changeOrderStatus(id, status, undefined, { approvedBy: currentUser?.name, orderPatch });            // 쓸 재고가 없다 → 전량 생산
    setStockUseAsk({ scope: askScope, mode: 'status', orderId: id, partnerName: order.partnerName, rows, orderPatch });
  };

  const deletingOrders = useRef(new Set<string>());
  const [processingCancellationIds, setProcessingCancellationIds] = useState<string[]>([]);
  const cancellationScope = useRef('');
  cancellationScope.current = `${companyId}:${currentUser.id}`;
  const [cancellationRevision, setCancellationRevision] = useState(0);
  const [pendingCancellations, setPendingCancellations] = useState<string[]>([]);
  const [pendingInventoryRecoveries,setPendingInventoryRecoveries] = useState<PendingOrderInventoryRecovery[]>([]);
  useEffect(() => {
    // 삭제 응답을 잃으면 주문 자체가 목록에서 사라질 수 있어 별도 재조회 진입점을 남긴다.
    const refresh = () => {
      const uid = auth.currentUser?.uid;
      if (!uid) { setPendingCancellations([]);setPendingInventoryRecoveries([]); return; }
      const prefix = `order-cancellation:${uid}:${companyId}:`;
      try {
        setPendingInventoryRecoveries(readPendingOrderInventoryRecoveries(companyId,uid));
        setPendingCancellations(Object.keys(localStorage).filter(key => key.startsWith(prefix))
          .map(key => key.slice(prefix.length)));
      } catch { setPendingCancellations([]);setPendingInventoryRecoveries([]); }
    };
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('order-inventory-recovery-pending',refresh);
    return () => {window.removeEventListener('storage', refresh);window.removeEventListener('order-inventory-recovery-pending',refresh);};
  }, [companyId, currentUser.id, cancellationRevision]);
  /** 확인과 삭제를 한 곳에서 맡아 목록의 이중 확인·실패 직후 닫기를 막는다. */
  const handleDeleteOrder = async (id: string): Promise<boolean> => {
    if (deletingOrders.current.has(id)) return false;
    deletingOrders.current.add(id);
    setProcessingCancellationIds([...deletingOrders.current]);
    try {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('로그인을 확인한 뒤 다시 처리하세요.');
    const initialScope = cancellationScope.current;
    const scope = `${uid}:${companyId}:${id}`;
    const key = `order-cancellation:${scope}`;
    const stillSameUser = () => auth.currentUser?.uid === uid && cancellationScope.current === initialScope;
    const saved = localStorage.getItem(key);
    let ticket: CancellationTicket | undefined;
    if (saved) {
      const value = JSON.parse(saved) as Partial<CancellationTicket> & { retryable?: boolean; code?: string };
      if (value.orderId !== id || value.companyId !== companyId
        || !['cancel-shipment', 'delete'].includes(value.action ?? '')
        || typeof value.evidence !== 'string' || typeof value.operationId !== 'string') {
        throw new Error('저장된 처리 정보가 일치하지 않습니다. 임의 재실행 없이 관리자에게 확인하세요.');
      }
      ticket = value as CancellationTicket;
      const receipt = await readOrderCancellation(ticket);
      if (!stillSameUser()) return false;
      if (receipt?.status === 'completed') {
        localStorage.removeItem(key);
        await awaitNotice(ticket.action === 'delete' ? '이미 주문 삭제가 완료되었습니다.'
          : '이미 출고 취소가 완료되었습니다. 주문은 유지되며 삭제는 별도로 승인해야 합니다.');
        return receipt.deleted;
      }
      if (value.retryable === false) {
        await awaitNotice(`완료 기록이 아직 없습니다. 재실행이 허용되지 않은 작업입니다.\n사유: ${value.code ?? '기록 확인 필요'}\n저장된 처리번호를 보존했습니다. 담당자에게 확인하세요.`, '처리 차단');
        return false;
      }
      // 완료표 부재만으로 미반영을 단정하지 않는다. 같은 작업번호만 사용자 확인 후 재시도한다.
      if (!await appConfirm({ title: '처리 결과 확인', message: '이전에 승인한 작업의 완료를 아직 확인하지 못했습니다.\n재고 반영 여부는 미확인입니다. 같은 작업번호로 완료 확인·재시도를 할까요?', confirmText: '같은 작업 확인', tone: 'amber' })) return false;
    }
    const order = allOrders.find(candidate => candidate.id === id) ?? orders.find(candidate => candidate.id === id);
    if (!ticket) {
      if (!order) throw new Error('주문을 찾지 못했습니다. 목록을 새로 조회하세요.');
      const prepared = await prepareOrderCancellation(id, companyId,
        order.status === OrderStatus.SHIPPED ? 'cancel-shipment' : 'delete');
      // 캐시의 예전주문 상태가 아닌 서비스의 최신 판정으로만 기록전용 삭제를 승인한다.
      const plan = prepared.recordOnly
        ? { allowed: true, action: 'delete', message: '예전 주문 기록만 삭제하며 재고·BOM은 원복하지 않습니다. 계속할까요?', subMessage: '삭제 직전 회사·상태·진행 중인 재고 작업을 다시 확인합니다.', confirmText: '기록 삭제', blockedReasons: [] }
        : buildOrderDeletePlan(prepared.order, allItems);
      if (!plan.allowed) throw new Error(plan.blockedReasons.join('\n'));
      if (!await appConfirm({ title: plan.action === 'cancel-shipment' ? '출고 취소' : '주문 삭제',
        message: `${plan.message}\n\n${plan.subMessage}`, confirmText: plan.confirmText, tone: 'rose' })) return false;
      if (!stillSameUser()) return false;
      ticket = prepared.ticket;
      // 브라우저 저장 실패 시 쓰기를 시작하지 않아 새로고침 후 근거 유실을 막는다.
      localStorage.setItem(key, JSON.stringify(ticket));
    }
    if (!stillSameUser()) return false;
    const result = await executeOrderCancellation(ticket);
    if (!stillSameUser()) return false;
    if (result.status === 'completed') {
      localStorage.removeItem(key);
      await awaitNotice(result.deleted ? '승인한 방식으로 주문 삭제가 완료되었습니다.'
        : '출고 취소가 완료되어 작업완료로 돌아갔습니다. 생산·원료 사용과 주문은 유지됩니다.');
      return result.deleted;
    }
    // 재고가 안 바뀌었어도 서버 작업 잠금이 남을 수 있어 실패 ticket을 임의 폐기하지 않는다.
    localStorage.setItem(key, JSON.stringify({ ...ticket, retryable: result.retryable, code: result.code }));
    await awaitNotice(`처리를 완료하지 못했습니다.\n${result.inventoryApplied === 'none' ? '재고 반영 없음' : '재고 반영 여부 미확인'}\n사유: ${result.code ?? '확인 필요'}\n${result.affectedItemIds.join(', ')}\n주문을 임의 삭제하지 않았습니다. ${result.retryable ? '다시 누르면 같은 작업의 결과부터 확인합니다.' : '원인을 확인한 뒤 다시 요청하세요.'}`, '처리 중단');
    return false;
    } catch (error) {
      await awaitNotice(`처리를 완료하지 못했습니다. 주문을 임의 삭제하지 않았습니다.\n${error instanceof Error ? error.message : '처리 결과를 다시 확인하세요.'}`, '확인 필요');
      return false;
    } finally {
      deletingOrders.current.delete(id);
      setProcessingCancellationIds([...deletingOrders.current]);
      setCancellationRevision(value => value + 1);
    }
  };

  // OEM(임가공) 엔진 — 외주 발주(원료 내보내기) / 가공입고(완제품 받기 + 가공비 전표)
  const oemReceiptSendTracker=useRef(new Map<string,{entered:boolean;uid:string}>());
  const oemIssueScopes=useRef(new Map<string,{actorUid:string;isCurrent:()=>boolean}>());
  const { issueOemBatch, receiveOemBatch, issueOemFeeStatement } = createOemEngine({
    orderUnitInputs: appData.orderUnitInputs,
    companyId, items: allItems, partners, adjustRawLots, updateItem, addItem, buildFormula,
    issueOemBatchJob: async input => {
      const scope=oemIssueScopes.current.get(input.jobId);
      if(!scope||!scope.isCurrent())throw Error('외주 송출의 최초 로그인 계정을 확인해 주세요.');
      const retained=await beginOemIssueAttempt(input,scope.actorUid,scope.isCurrent);
      return issueOemBatchJob(db,retained.request.input,{...scope,retained});
    },
    applyOemReceiptInventory: input => {
      const tracker=oemReceiptSendTracker.current.get(input.poId);if(tracker)tracker.entered=true;
      return receiveOemFinishedGoodsCommand({
      poId: input.poId, operationId: input.operationId, date: input.date,
      returns: input.items.map(row => ({ itemId: row.itemId, qty: row.qty })),
      unitPricePerKg: input.feeRequest.oemFeePerKg,
      ...(input.oemCostEvidence !== undefined ? { oemCostEvidence: input.oemCostEvidence } : {}),
      ...(input.bulk?.length ? { bulk: input.bulk } : {}),
      },companyId,tracker?.uid);
    },
    applyOemFeeStatement,
  });
  /** 원료 홀더의 현재 재고(kg) — 로트 합계 우선, 없으면 stock */
  const rawStockKg = (material: string): number => {
    const holder = rawHolderByName(allItems, material, companyId);
    if (!holder) return 0;
    return holder.lots?.length ? lotKgRemaining(holder.lots) : (holder.stock ?? 0);
  };

  const handleRemoveConfirmedOrder = async (id: string) => {
    await deletePendingPurchaseOrder(id);
  };

  const handleFinishConfirmedOrder = async (id: string) => {
    try {
      await executeEmployeeCommand({ kind: 'receive', poId: id, actorName: currentUser?.name, items: allItems, orderUnitInputs: appData.orderUnitInputs });
      setLedgerReloadKey(k => k + 1);
      return true;
    } catch (err) {
      await awaitNotice(err instanceof Error ? err.message : String(err), '입고확정 중단');
      return false;
    }
  };

  // 주문 복구는 해당 카드에서만 확인한다. 원 주문이 사라진 응답 유실 기록은 목록 기록카드로 남긴다.
  const recoveryDisplayScope=cancellationScope.current;
  const recoveryActorUid=auth.currentUser?.uid??'';
  const renderOrderRecoveryForId=(orderId:string,order?:Order):React.ReactNode=>{
    const pending=pendingInventoryRecoveries.filter(row=>row.companyId===companyId&&row.uid===recoveryActorUid&&row.orderId===orderId);
    const hasCancellation=pendingCancellations.includes(orderId)||processingCancellationIds.includes(orderId);
    if(!hasCancellation&&!pending.length&&order?.inventoryOperation?.state!=='failed')return null;
    return <div key={companyId+':'+recoveryActorUid+':'+orderId} aria-label={'주문 처리 확인 '+orderId}>
      {hasCancellation&&<button type="button" disabled={processingCancellationIds.includes(orderId)} className="mt-2 text-sm font-bold text-indigo-700 underline"
        onClick={()=>{if(auth.currentUser?.uid===recoveryActorUid&&cancellationScope.current===recoveryDisplayScope)void handleDeleteOrder(orderId);}}>{processingCancellationIds.includes(orderId)?'확인·처리 중':'처리 결과 확인'}</button>}
      <OrderInventoryRecoveryPanel companyId={companyId} actorUid={recoveryActorUid} orders={order?[order]:[]} pending={pending}
        isCurrentActor={()=>auth.currentUser?.uid===recoveryActorUid&&cancellationScope.current===recoveryDisplayScope} onRecovered={(result,expectedSaved)=>{
        if(auth.currentUser?.uid!==recoveryActorUid||cancellationScope.current!==recoveryDisplayScope||result.orderId!==orderId)return;
        clearRecoveredOrderCancellation(companyId,recoveryActorUid,result,expectedSaved);
        setCancellationRevision(value=>value+1);
      }}/>
    </div>;
  };
  const renderOrderRecovery=(order:Order):React.ReactNode=>companyOf(order)===companyId?renderOrderRecoveryForId(order.id,order):null;
  const orderRecoveryOrphanIds=[...new Set([...pendingCancellations,...processingCancellationIds,...pendingInventoryRecoveries.filter(row=>row.companyId===companyId&&row.uid===recoveryActorUid).map(row=>row.orderId)])]
    .filter(id=>!allOrders.some(order=>order.id===id&&companyOf(order)===companyId));
  const orderRecoveryOrphans=orderRecoveryOrphanIds.length>0?<>{orderRecoveryOrphanIds.map(id=><div key={id} className="rounded-lg border border-amber-200 p-2"><p className="text-xs font-bold">원 주문을 찾을 수 없는 처리 기록 · {id}</p>{renderOrderRecoveryForId(id)}</div>)}</>:null;

  // 입고대기 발주카드 수정: 새 수량으로 즉시 입고확정(received+재고 반영) + 연결된 매입전표 수정 요청 생성
  const handleRequestPoEdit = async (poId: string, newLines: { itemId: string; quantity: number }[], reason: string) => {
    const po = purchaseOrders.find(p => p.id === poId);
    if (!po) return;
    const qtyByItemId = new Map(newLines.map(l => [l.itemId, l.quantity]));

    // 연결된 매입전표가 있으면 회계 정정용 전표수정 요청 생성
    const stmt = po.linkedStatementId ? issuedStatements.find(s => s.id === po.linkedStatementId) : undefined;
    if (stmt) {
      const changes: { name: string; oldQty: number; newQty: number }[] = [];
      const newItems: typeof stmt.items = [];
      for (const it of stmt.items) {
        /*  **id 가 있으면 id 로 잇는다**(2026-09-13 사장님: "연결은 제대로 id로 하고 있는거지").
            여기만 저장된 전표 줄을 **이름**으로 되짚고 있었다. 이름이 같은 다른 품목이 있어서
            (`시골향참기름/A/1750ml` = p-106 빨강캡 · p-116 노랑캡) 엉뚱한 줄의 수량이
            바뀔 수 있었다. 이름은 **id 가 없는 옛 줄**에만 쓴다. */
        const product = (it.itemId ? allItems.find(p => p.id === it.itemId) : undefined)
          ?? findByDocName(allItems, it.name);
        const newQty = product ? qtyByItemId.get(product.id) : undefined;
        if (newQty === undefined || newQty === it.qty) { newItems.push(it); continue; }
        changes.push({ name: it.name, oldQty: it.qty, newQty });
        if (newQty <= 0) continue; // 0 = 품목 삭제
        const unitSupply = it.qty !== 0 ? it.supply / it.qty : 0;
        const supply = Math.round(unitSupply * newQty);
        const tax = vatOn(supply, it.isTaxExempt);
        newItems.push({ ...it, qty: newQty, supply, tax, total: supply + tax });
      }
      if (changes.length > 0) {
        const totalSupply = newItems.reduce((s, i) => s + i.supply, 0);
        const totalTax = newItems.reduce((s, i) => s + i.tax, 0);
        await addItem('pendingStatementEdits', {
          id: `pse-${Date.now()}`,
          statementId: stmt.id, statementDocNo: stmt.docNo, statementType: stmt.type,
          partnerName: stmt.partnerName,
          proposedData: {
            tradeDate: stmt.tradeDate, partnerId: stmt.partnerId, partnerName: stmt.partnerName,
            totalSupply, totalTax, totalAmount: totalSupply + totalTax, items: newItems,
          },
          createdAt: new Date().toISOString(), createdBy: currentUser.name, status: 'pending',
          reason, changes, sourcePoId: poId,
        });
      }
    }

    // 수정 요청은 전표 검토만 등록한다. 승인 전에 재고·발주 상태를 바꾸지 않는다.
    await awaitNotice('전표 수정 요청을 등록했습니다. 입고확정은 별도 버튼에서 처리해 주세요.');
  };

  const completionSaving = React.useRef(new Set<string>());
  /**
   * **송장 칸 한 번 누름 → 저장할 값.**
   *
   * 세 단계(`-`·출력·부착)를 새 칸 `invoiceStage` 에 적되, 옛 `invoicePrinted`(참/거짓)도
   * 같이 맞춰 쓴다 — 그 값을 읽는 자리가 여럿이라(출고완료 묶음·리스트 필터·배송 화면)
   * 한꺼번에 못 옮긴다. 둘이 어긋나면 같은 주문이 화면마다 다르게 보인다.
   */
  /**
   * **송장 양식(A~E) 저장** — 안 고름(`-`)은 칸을 지운다.
   * 빈 글자를 넣어 두면 나중에 `''` 와 `undefined` 둘을 다 따져야 한다.
   */
  const invoiceTypePatch = (value?: string) => ({ invoiceType: value ?? null });

  const invoicePatch = (value: boolean | 'printed' | 'attached' | undefined) =>
    typeof value === 'boolean'
      ? { invoicePrinted: value, invoiceStage: value ? 'printed' : null }
      : { invoicePrinted: value !== undefined, invoiceStage: value ?? null };

  const handleToggleItemChecked = async (orderId: string, itemIdx: number, checkedBy?: string) => {
    const askScope = orderAskScope.current.token;
    const order = allOrders.find(o => o.id === orderId);
    if (!order || completionSaving.current.has(orderId)) return;
    const normalizedOrder = { ...order, items: ensureOrderLineIds(order.items) };
    const plan = planOrderItemToggle(normalizedOrder, itemIdx, checkedBy || currentUser?.name, new Date().toISOString());
    if (!plan) return;
    const applying = plan.items[itemIdx]?.checked === true;
    const save = async (stockPlan?: StockUsePlan) => {
      if (orderAskScope.current.token !== askScope || completionSaving.current.has(orderId)) return;
      completionSaving.current.add(orderId);
      try {
        const lineId = plan.items[itemIdx]?.lineId;
        const isLegacyRollback = !applying && !!order.producedAt && (!lineId || !order.itemInventory?.[lineId]);
        if (isLegacyRollback) await requestOrderStatus(orderId, plan.status, { items: plan.items });
        else {
          await changeOrderItemCompletion(orderId, itemIdx, plan.items, plan.status, stockPlan);
          if (orderAskScope.current.token !== askScope) return;
          /*  **품목 알림 다음에 주문 알림**(2026-09-15 사장님: "품목단위 알람 다음에 주문 자체
           *  상태변환 알람뜨게해 이건 취소는 못하고 확인버튼만 누르게 … 주문이 대기중에서
           *  작업중으로 이동합니다 확인").
           *
           *  품목 하나를 찍으면 **주문 전체가 따라 움직인다**(체크한 수에 따라 대기중·작업중·
           *  작업완료). 그런데 그 움직임은 카드가 다른 칸으로 옮겨 가는 것으로만 보여서,
           *  보고 있지 않으면 주문이 어디로 갔는지 모른 채 지나갔다.
           *
           *  **되물리지 않는다 — 확인만 받는다.** 이미 저장이 끝난 뒤라 여기서 '취소'를
           *  주면 되돌릴 수 없는 것을 되돌릴 수 있는 척하게 된다. */
          if (plan.status !== order.status) {
            const 체크수 = plan.items.filter(줄 => 줄.checked).length;
            setAppNotice({
              title: statusLabel(plan.status),
              tone: 상태색[plan.status] ?? 'slate',
              icon: CheckCircle2,
              message: `주문이 ${statusLabel(order.status)}에서 ${statusLabel(plan.status)}(으)로 이동합니다`,
              subMessage: `${order.partnerName || '거래처 미지정'} · 품목 ${체크수}/${plan.items.length} 완료`,
            });
          }
        }
      } catch (error) {
        if (orderAskScope.current.token !== askScope) return;
        if (error instanceof Error && error.message === 'LEGACY_ORDER_ROLLBACK_REQUIRED') {
          await requestOrderStatus(orderId, plan.status, { items: plan.items });
          return;
        }
        console.error('작업 확인 저장 실패', error);
        const reason = error instanceof Error ? error.message : String(error);
        alert(`작업 확인을 저장하지 못했습니다.\n사유: ${reason}`);
      } finally { completionSaving.current.delete(orderId); }
    };
    const stockStage = (value: OrderStatus) => value === OrderStatus.SHIPPED || value === OrderStatus.DELIVERED
      ? 2 : value === OrderStatus.DISPATCHED ? 1 : 0;
    const isRollback = stockStage(plan.status) < stockStage(order.status);
    // 품목별 스냅샷이 있는 주문은 체크를 푼 그 줄만 즉시 원복한다.
    // 옛 주문만 줄 근거가 없어 기존 주문 전체 원복 승인창을 쓴다.
    if (isRollback && !order.itemInventory) return requestOrderStatus(orderId, plan.status, { items: plan.items });

    /*  **체크를 푸는 것도 되돌리기다 — 묻는다**(2026-09-14 사장님).
     *  줄 하나를 풀면 그 줄 몫의 원료 로트와 부자재(병·캡·라벨·박스)가 도로 채워지고
     *  원료수불부에 사용 취소가 붙는다. 주문 상태가 그대로(작업중)여도 재고는 움직인다 —
     *  그래서 `isRollback`(상태 단계 비교)이 아니라 **그 줄이 실제로 차감했는지**로 가른다. */
    const 푸는줄id = plan.items[itemIdx]?.lineId;
    const 줄상태 = 푸는줄id ? order.itemInventory?.[푸는줄id] : undefined;
    if (!applying && 줄상태?.applied) {
      const 줄계획 = buildRollbackPlan({
        items: [normalizedOrder.items[itemIdx]!],
        producedUnits: 줄상태.producedUnits,
        rawConsumedLots: 줄상태.rawConsumedLots,
        autoBuilt: 줄상태.autoBuilt,
        shippedOut: false,
        //  이 줄이 실제로 차감했다는 근거다. 없으면 '기록 없음'으로 잘못 겁준다.
        producedAt: 줄상태.completedAt ?? 줄상태.production?.capturedAt,
        inventorySnapshots: { production: 줄상태.production },
      } as Parameters<typeof buildRollbackPlan>[0], allItems, OrderStatus.DISPATCHED, OrderStatus.PROCESSING, appData.orderUnitInputs);
      const 줄이름 = allItems.find(p => p.id === plan.items[itemIdx]?.itemId)?.name ?? plan.items[itemIdx]?.name ?? '이 품목';
      /*  **되돌리면 이 주문 몫으로 잡아 둔 재고가 풀린다**(2026-09-15 사장님).
          작업완료로는 재고가 안 줄고 그 몫이 이 주문에 잡혀 있을 뿐이라, 생산이 없는
          사입·임가공 줄은 "되돌릴 게 없습니다" 만 떴다 — 실제로는 잡힘이 풀린다.
          얼마가 풀리는지는 출고 때 빠질 양과 같다(`shipQtyOfLine`) — 그 몫을 잡아 둔 것이니. */
      const 푸는품목 = allItems.find(p => p.id === normalizedOrder.items[itemIdx]?.itemId);
      const 풀릴양 = shipQtyOfLine(normalizedOrder.items[itemIdx]!, 푸는품목, appData.orderUnitInputs);
      const 묻는글 = buildStatusChangeAsk({
        partnerName: order.partnerName, from: order.status, to: plan.status, plan: 줄계획, lineName: 줄이름,
        released: 푸는품목 && 풀릴양 > 0
          ? [{ name: 줄이름, qty: 풀릴양, unit: unpackComponent(푸는품목, appData.orderUnitInputs) ? '박스' : (푸는품목.unit || '개') }]
          : [],
      });
      setRollbackAsk({ scope: askScope, ...묻는글, onConfirm: () => save() });
      return;
    }

    const lineRows = applying && !isStockProduction(order)
      ? buildStockUseRows({ items: [plan.items[itemIdx]!] }, allItems, appData.orderUnitInputs)
      : [];
    const startSave = () => {
      if (orderAskScope.current.token !== askScope) return;
      if (lineRows.length === 0) { void save(); return; }
      setStockUseAsk({
        scope: askScope, mode: 'line', orderId, partnerName: order.partnerName, rows: lineRows,
        onConfirm: save,
      });
    };

    /*  **완사입·임가공은 생산이 없다 — 재고로만 나간다.**
     *  그래서 `buildStockUseRows` 가 빼 버리는데, 그냥 지나가면 재고가 모자란 것도 모른다.
     *  여기서 재고와 주문량을 견줘 **쓸 수 있으면 쓴다고, 모자라면 음수가 된다고** 알린다. */
    const 완료줄 = plan.items[itemIdx];
    const 완료품목 = 완료줄 ? allItems.find(p => p.id === 완료줄.itemId) : undefined;
    if (applying && lineRows.length === 0 && 완료줄 && 완료품목 && isGoodsItem(완료품목)) {
      const 주문량 = stockUnits(완료줄, 완료품목, appData.orderUnitInputs);
      const 재고 = unreservedItemStock(완료품목);
      const 단위 = unpackComponent(완료품목, appData.orderUnitInputs) ? '박스' : (완료품목.unit || '개');
      const 모자란양 = Math.round((주문량 - 재고) * 1000) / 1000;
      /*  **얼마가 다른 주문에 잡혀 있는지 같이 보여 준다**(2026-09-14 사장님: "참진은 재고가
          24개 있는데 왜 알람에선 0으로 뜨지"). 화면에 0 이라고만 뜨면, 품목 재고 24개를 아는
          사람에게는 숫자가 어긋나 보인다. 잡아 둔 몫은 이미 임자가 있어 못 쓰는 것뿐이다. */
      const 잡힌양 = reservedItemQty(완료품목);
      const 잡은주문 = reservedByOrders(완료품목)
        .map(id => cardNoLabel(allOrders.find(o => o.id === id)) || id)
        .slice(0, 2);
      const 잡힘글 = 잡힌양 > 0
        ? `
재고 ${Math.round((재고 + 잡힌양) * 1000) / 1000}${단위} 중 ${잡힌양}${단위} 는 다른 주문`
          + `${잡은주문.length ? `(${잡은주문.join(', ')})` : ''}에 잡혀 있어 쓸 수 있는 건 ${재고}${단위} 입니다.`
        : '';
      /*  **'쓴다'가 아니라 '이 주문 몫으로 잡는다'**(2026-09-14 사장님: "재고 있는거 작업완료
          할때 쓴다는 표현은 좀 애매하고 현주문의 몫으로 할당되어 … 출고 시에 차감됩니다
          이런식의 표현이 맞지 않냐"). 맞다 — 작업완료로는 재고가 **안 줄어든다.**
          그 몫이 이 주문에 잡히고(`inventoryReservations`), 실제로 빠지는 것은 **출고할 때**다
          (`shipOrder`). "쓴다"고 하면 지금 줄어드는 줄 안다. */
      const 출고뒤 = Math.round((재고 - 주문량) * 1000) / 1000;
      setGoodsStockAsk(모자란양 > 0 ? {
        //  **분홍**(2026-09-15 사장님: "이 경우는 색 분홍색으로 해줘"). 노랑은 '재고를 다 쓴다'는
        //  알림에도 쓰고 있어, 재고가 모자라 음수가 될 이 경고와 한 색이면 갈리지 않았다.
        scope: askScope, title: '재고부족', tone: 'pink',
        message: `재고가 부족합니다 — “${완료품목.name}”`,
        subMessage: `재고 ${재고}${단위} · 주문 ${주문량}${단위}\n`
          + `이 주문 몫으로 ${주문량}${단위}를 잡으면, 출고할 때 재고가 ${출고뒤}${단위} 로 음수가 됩니다.\n`
          + `사 오거나 맡긴 물건이라 생산으로 채워지지 않습니다.${잡힘글}`,
        confirmText: '그래도 완료',
        onConfirm: () => { void save(); },
      } : {
        scope: askScope, title: '작업완료', tone: 'emerald',
        message: `“${완료품목.name}” ${주문량}${단위}를 이 주문 몫으로 잡습니다.`,
        subMessage: `재고에서는 출고할 때 빠집니다 — 지금 ${재고}${단위} → 출고 뒤 ${출고뒤}${단위}.\n`
          + `사 오거나 맡긴 물건이라 생산하지 않습니다.${잡힘글}`,
        confirmText: '완료',
        onConfirm: () => { void save(); },
      });
      return;
    }

    // 생산품은 주문 전체 상태와 관계없이 품목 하나를 완료할 때마다 재고 확인창을 거친다.
    startSave();
  };

  const handleToggleShipmentComplete = async (orderId: string, completed: boolean) => {
    const order = allOrders.find(candidate => candidate.id === orderId);
    if (!order || (completed ? order.status !== OrderStatus.DISPATCHED : order.status !== OrderStatus.SHIPPED)) return;

    if (completed) {
      await requestOrderStatus(orderId, OrderStatus.SHIPPED, {
        shipmentConfirmedBy: currentUser?.name || '미기록',
        shipmentConfirmedAt: new Date().toISOString(),
      });
      return;
    }

    // 출고 취소는 이미 생산된 주문의 출고만 되돌린다. 생산 승인 창을 다시 열지 않는다.
    await requestOrderStatus(orderId, OrderStatus.DISPATCHED, {
      shipmentConfirmedBy: null,
      shipmentConfirmedAt: null,
    });
  };

  const itemEditorRequestScope={companyId,actorUid:itemEditorActor??''};
  const saveItemEditorPrimary=async(input:ItemEditorSaveInput,progress:ItemEditorProgress,modalCurrent:()=>boolean):Promise<ItemEditorSaveResult>=>{
    const isCurrent=()=>isCurrentItemEditor()&&modalCurrent();
    const result=await submitItemEditorSave(itemEditorRequestScope,input,progress,isCurrent);
    if(isCurrent()&&progress.confirmedStageIds.length)refreshStaticData();
    return result;
  };
  let itemEditorRecoveryEntries:ItemEditorRecoveryEntry[]=[];
  let itemEditorRecoveryError='';
  try {
    if(itemEditorActor){
      const plans=pendingItemEditorPlans(itemEditorRequestScope);
      const references=itemEditorReferences(itemEditorRequestScope);
      if(references.some(row=>!row.reference))itemEditorRecoveryError='품목 저장 요청의 대상 번호를 읽지 못했습니다. 원문을 임의로 다시 보내지 않았습니다. 기기 저장소를 확인해 주세요.';
      itemEditorRecoveryEntries=references.flatMap(row=>row.reference?[{reference:row.reference,pending:plans.find(plan=>plan.reference.planId===row.reference?.planId),error:row.error,observedLocalText:row.observedLocalText}]:[]);
    }
  }catch {itemEditorRecoveryError='기기에 남은 품목 저장 요청을 읽지 못했습니다. 기기 저장소를 확인한 뒤 다시 열어 주세요.';}


  const orderEditRenderUid = auth.currentUser?.uid;
  const orderEditRenderToken = orderAskScope.current.token;
  const currentOrderEditScope = () => {
      if (!orderEditRenderUid || auth.currentUser?.uid !== orderEditRenderUid || orderAskScope.current.token !== orderEditRenderToken || orderAskScope.current.companyId !== companyId)
          return null;
      return { companyId, actorUid: orderEditRenderUid };
  };
  const orderEditScopeRejected = (): OrderEditSaveResult => ({ status: 'rejected', message: '회사 또는 로그인 정보가 바뀌어 주문 수정을 전송하지 않았습니다.', nextAction: '현재 회사에서 주문을 다시 열어 주세요.' });
  const runOrderEdit = async (opening: Order, edit: OrderEdit): Promise<OrderEditSaveResult> => {
      const scope = currentOrderEditScope();
      if (!scope)
          return orderEditScopeRejected();
      return saveOrderEdit({ order: opening, edit, companyId: scope.companyId, actorUid: scope.actorUid, actorName: currentUser?.name }, {
          isCurrent: () => currentOrderEditScope() !== null, confirm: appConfirm,
          submit: (order, change, confirmed) => submitOrderEdit(scope, order, change, confirmed),
      });
  };
  const handleSaveOrderEdit = runOrderEdit;
  const readPendingOrderEdits = () => { const scope = currentOrderEditScope(); return scope ? pendingOrderEdits(scope) : []; };
  const readOrderEditReferences = () => { const scope = currentOrderEditScope(); return scope ? orderEditReferences(scope) : []; };
  const handleInspectOrderEdit = (planId: string, targetId: string): Promise<OrderEditSaveResult> => {
      const scope = currentOrderEditScope();
      return scope ? inspectOrderEdit(scope, planId, targetId) : Promise.resolve(orderEditScopeRejected());
  };
  const handleCancelOrderEdit = (planId: string, targetId: string): Promise<OrderEditSaveResult> => {
      const scope = currentOrderEditScope();
      return scope ? cancelOrderEdit(scope, planId, targetId) : Promise.resolve(orderEditScopeRejected());
  };
  const handleDiscardOrderEditCopy = (planId:string,targetId:string,observedLocalText:string):Promise<OrderEditSaveResult> => {
    const scope=currentOrderEditScope();
    return scope ? discardOrderEditCopy(scope,planId,targetId,observedLocalText) : Promise.resolve(orderEditScopeRejected());
  };
  const orderEditBindings = { requestScopeKey: orderEditRenderUid ?? '', onSaveOrderEdit: handleSaveOrderEdit, onReadPendingOrderEdits: readPendingOrderEdits, onReadOrderEditReferences: readOrderEditReferences, onInspectOrderEdit: handleInspectOrderEdit, onCancelOrderEdit: handleCancelOrderEdit, onCancelOrderEditReference: handleCancelOrderEdit, onDiscardOrderEditCopy: handleDiscardOrderEditCopy };

  const leaveRenderUid = auth.currentUser?.uid;
  const leaveRenderToken = orderAskScope.current.token;
  const currentLeaveScope = (): LeaveScope | null => {
    if (!leaveRenderUid || auth.currentUser?.uid !== leaveRenderUid || orderAskScope.current.companyId !== companyId || orderAskScope.current.token !== leaveRenderToken) return null;
    return {companyId,actorUid:leaveRenderUid};
  };
  const leaveScopeRejected = (): SaveOutcome => ({
    status:'rejected',message:'현재 로그인과 회사의 휴가 저장 연결을 확인하지 못했습니다.',nextAction:'작성 내용은 그대로 두고 현재 회사와 로그인을 확인해 주세요.',
  });
  const runLeaveAction = async (action: (scope: LeaveScope) => Promise<SaveOutcome>): Promise<SaveOutcome> => {
    const scope = currentLeaveScope();
    if (!scope) return leaveScopeRejected();
    try { return await action(scope); }
    catch { return {status:'unknown',message:'휴가 요청의 처리 결과를 확인하지 못했습니다.',nextAction:'보관 요청의 결과 확인 또는 요청 중단을 선택해 주세요. 새로 신청하지 마세요.'}; }
  };
  const handleAddLeaveRequests = (requests: LeaveRequest[], notify = false): Promise<SaveOutcome> =>
    runLeaveAction(async scope => (await submitLeaveRequests(scope,requests,employees,notify)).outcome);
  const handleInspectLeaveRequest = (id: string) => runLeaveAction(scope => inspectLeaveRequest(scope,id,employees));
  const handleCancelLeaveRequest = (id: string) => runLeaveAction(scope => cancelLeaveRequest(scope,id));
  const handleInspectLeaveAction = (planId: string) => runLeaveAction(scope => inspectLeaveAction(scope,planId));
  const handleCancelLeaveAction = (planId: string) => runLeaveAction(scope => cancelLeaveAction(scope,planId));
  const handleCancelLeaveReference = (id: string) => runLeaveAction(scope => cancelLeaveReference(scope,id));
  const readPendingLeaveRequests = () => { const scope=currentLeaveScope();return scope ? pendingLeaveRequests(scope) : []; };
  const readPendingLeaveGroups = () => { const scope=currentLeaveScope();return scope ? pendingLeaveGroups(scope) : []; };
  const readLeaveReferences = () => { const scope=currentLeaveScope();return scope ? listLeaveReferences(scope) : []; };
  const handleLeaveAction = (row: LeaveRequest, action: LeaveMutationAction): Promise<SaveOutcome> =>
    runLeaveAction(async scope => (await submitLeaveAction(scope,row,action)).outcome);
  const readPendingLeaveActions = () => { const scope=currentLeaveScope();return scope ? pendingLeaveActions(scope) : []; };

  const employeeEditRenderUid=auth.currentUser?.uid;
  const employeeEditRenderToken=orderAskScope.current.token;
  const currentEmployeeEditScope=():EmployeeEditScope|null=>{
    if(!employeeEditRenderUid||auth.currentUser?.uid!==employeeEditRenderUid||orderAskScope.current.companyId!==companyId||orderAskScope.current.token!==employeeEditRenderToken)return null;
    return {companyId,actorUid:employeeEditRenderUid};
  };
  const runEmployeeEdit=async(work:(scope:EmployeeEditScope)=>Promise<SaveOutcome>):Promise<SaveOutcome>=>{
    const scope=currentEmployeeEditScope();
    if(!scope)return {status:'rejected',message:'회사 또는 로그인 정보가 바뀌어 직원 저장을 전송하지 않았습니다.',nextAction:'현재 회사에서 직원을 다시 열어 주세요.'};
    return work(scope);
  };
  const handleEmployeeEdit=(input:EmployeeEditInput)=>runEmployeeEdit(scope=>submitEmployeeEdit(scope,input));
  const handleInspectEmployeeEdit=(reference:EmployeeEditReference)=>runEmployeeEdit(scope=>inspectEmployeeEdit(scope,reference));
  const handleCancelEmployeeEdit=(reference:EmployeeEditReference)=>runEmployeeEdit(scope=>cancelEmployeeEdit(scope,reference));
  const readPendingEmployeeEdits=()=>{const scope=currentEmployeeEditScope();return scope?pendingEmployeeEdits(scope):[];};
  const readEmployeeEditReferences=()=>{const scope=currentEmployeeEditScope();return scope?employeeEditReferences(scope):[];};

  const isCurrentDirectoryDelete=()=>currentEmployeeEditScope()!==null;
  const directoryDeleteRejected=():DirectoryDeleteOutcome=>({status:'rejected',message:'회사 또는 로그인 정보가 바뀌어 삭제를 전송하지 않았습니다.',nextAction:'현재 회사에서 대상을 다시 열어 주세요.'});
  const handlePrepareDirectoryDelete=async(input:DirectoryDeleteInput):Promise<DirectoryDeletePrepared>=>{
    const scope=currentEmployeeEditScope();
    if(!scope)return {status:'rejected',outcome:directoryDeleteRejected()};
    return prepareDirectoryDelete(scope,input,isCurrentDirectoryDelete);
  };
  const runDirectoryDelete=async(work:(scope:EmployeeEditScope)=>Promise<DirectoryDeleteOutcome>):Promise<DirectoryDeleteOutcome>=>{
    const scope=currentEmployeeEditScope();
    if(!scope)return directoryDeleteRejected();
    return work(scope);
  };
  const handleConfirmDirectoryDelete=(reference:DirectoryDeleteReference)=>runDirectoryDelete(scope=>confirmDirectoryDelete(scope,reference,isCurrentDirectoryDelete));
  const handleInspectDirectoryDelete=(reference:DirectoryDeleteReference)=>runDirectoryDelete(scope=>inspectDirectoryDelete(scope,reference,isCurrentDirectoryDelete));
  const handleCancelDirectoryDelete=(reference:DirectoryDeleteReference)=>runDirectoryDelete(scope=>cancelDirectoryDelete(scope,reference,isCurrentDirectoryDelete));
  const readPendingDirectoryDeletes=()=>{const scope=currentEmployeeEditScope();return scope?pendingDirectoryDeletes(scope):[];};
  const readDirectoryDeleteReferences=()=>{const scope=currentEmployeeEditScope();return scope?directoryDeleteReferences(scope):[];};
  const directoryDeleteBindings={onPrepareDirectoryDelete:handlePrepareDirectoryDelete,onConfirmDirectoryDelete:handleConfirmDirectoryDelete,onInspectDirectoryDelete:handleInspectDirectoryDelete,onCancelDirectoryDelete:handleCancelDirectoryDelete,onReadPendingDirectoryDeletes:readPendingDirectoryDeletes,onReadDirectoryDeleteReferences:readDirectoryDeleteReferences};

  // PRODUCT_FORMULA → Firestore item_formula 시딩 (최초 1회)
  const seedItemFormulas = async () => {
    if (itemFormulas.length > 0) {
      alert(`이미 item_formula에 ${itemFormulas.length}개 항목이 있습니다.`);
      return;
    }
    const writes: { collection: typeof COL.itemFormula; id: string; data: Record<string, unknown> }[] = [];
    let count = 0;
    for (const [parentKey, rows] of Object.entries(PRODUCT_FORMULA)) {
      for (const row of rows) {
        const id = `formula-${parentKey}-${row.raw}`.replace(/\s/g, '_');
        writes.push({ collection: COL.itemFormula, id, data: {
          parent_key: parentKey,
          child_name: row.raw,
          ratio: row.ratio,
          yield_rate: 1.0,
        } });
        count++;
      }
    }
    await writeMany(writes);
    alert(`item_formula 시딩 완료: ${count}개 항목`);
  };

  /** 정기 고정비 → 자금(출금) 전표로 생성 (계정코드·기간 지정된 것만, id로 중복 방지).
   *  임대료·전기·통신 등 대부분 자동이체로 돈이 나가는 비용이라 자금(현금 출금)으로 잡는다.
   *  전표 탭과 정기비용 화면 양쪽에서 호출한다. */
  /**
   * 그 달 정기 전표를 만든다 — 스케줄러(functions)와 **같은 규칙**(shared/autoVoucher)을 쓴다.
   *
   *   합침 → 출금 자금전표 하나
   *   분리 → 매입전표(채무만 세움). 지불은 거래처 미지급금에서 따로 처리한다.
   *
   * 같은 달에 두 번 돌려도 id가 같아서 한 건이다. 옛 키(RC-…)로 만든 것도 중복으로 친다.
   */
  /**
   * 정기 전표 생성. `onlyId`를 주면 **그 템플릿 하나만** 만든다 —
   * 화면에서 줄마다 발행할 수 있어야 어느 것을 낼지 고를 수 있다.
   */
  /**
   * 자금전표를 넣는 **유일한 문** — 전표번호를 여기서 매긴다.
   *
   * 거래명세서 계열과 **같은 번호통**을 쓴다(회사별·날짜별). 같은 날 07번은 하나뿐이고,
   * 번호만으론 매입전표인지 출금전표인지 모른다 — 그건 전표 머리의 이름이 말한다.
   * 넣는 자리가 여럿이라 각자 번호를 매기면 같은 번호가 두 번 나온다. 그래서 문을 하나로 둔다.
   */
  const addCashEntry = async (e: Partial<CashEntry> & { date: string }, co: CompanyId = companyId) => {
    //  **담당자를 찍는다**(2026-09-15 사장님: "전표일자 다음에 담당자") — 자금이 들어오는 문이
    //  여기 하나라, 어느 화면에서 만들든 사람이 남는다. 이미 적힌 것은 안 덮는다.
    const entry = { ...e, ...(e.dir === '입금' || e.dir === '출금' ? { cashAccountId: e.cashAccountId || defaultCashAccountId(appData.cashAccounts, co) } : {}), companyId: co, createdBy: e.createdBy ?? currentUser?.name } as CashEntry;
    // 대출은 원금·현금·번호를 전용 명령에서 함께 확정한다.
    if (entry.loanId) return recordLoanCashEntry(co, entry);
    return issueNumberedCashEntry(entry);
  };

  const generateRecurringCosts = (ym: string, onlyId?: string): Promise<number> => issueRecurringVouchers({
    ym, onlyId, companyId, createdBy: currentUser?.name, templates: companyTemplates,
    cashEntries: companyCashEntries, issuedStatements, cashAccounts: companyCashAccounts,
    accountCodes: appData.accountCodes,
  });

  /** 문서함에서 '서류관리 › 생산판매기록부'를 펴 놓았나 */
  //  '전체'(중분류 미선택)도 친다 — 서류관리 밑엔 이 하나뿐이라, 대분류만 눌러도 서류가 떠야 한다.
  //  중분류를 눌러야만 뜨게 해 두면 파일도 없는 빈 화면을 먼저 보게 된다.
  const inCabinetDoc = currentView === 'file-cabinet' && cabinetSel.cat === '서류관리'
    && (cabinetSel.sub === '생산판매기록부' || cabinetSel.sub === '');
  useEffect(() => { if (inCabinetDoc) setDocTab('생산판매기록부'); }, [inCabinetDoc]);

  const handleNavClick = (view: ViewType) => {
    const adminOnlyViews: ViewType[] = ['hr', 'dashboard', 'data-integrity', 'ai-consultant', 'cost-management', 'profit-analysis', 'production', 'admin-checklist', 'smartstore-analytics', 'haccp-checklist', 'partner-stats', 'cash-flow', 'file-cabinet', 'ledger-cash', 'financial-reports', 'loan-management'];
    if (adminOnlyViews.includes(view) && !isAdminAuthenticated && !isAdmin) {
      setPendingAdminView(view);
      setIsAdminAuthModalOpen(true);
    } else {
      setCurrentView(view);
      // 모바일에서는 메뉴 클릭 시 사이드바 자동으로 닫기
      if (isMobile) {
        setIsSidebarCollapsed(true);
      }
    }
  };

  const onAdminAuthSuccess = () => {
    onAdminAuth(true);
    setIsAdminAuthModalOpen(false);
    if (pendingAdminView) {
      setCurrentView(pendingAdminView);
      setPendingAdminView(null);
    }
  };

  const adminPendingCount = leaveRequests.filter(r => r.status === 'pending' || r.status === 'cancel_pending' || r.status === 'approved' && r.modifyRequest?.status === 'pending').length + adjustmentRequests.filter(r => r.status === 'pending').length + receivedOrders.filter(r => r.status === 'received' && !r.linkedStatementId).length;
  const menuGroups = isAdmin ? [{"id":"dash","label":"대시보드"},{"id":"work","label":"업무 관리"},{"id":"master","label":"기준정보 관리"},{"id":"ledger","label":"장부 / 원장 관리"},{"id":"biz","label":"경영 분석 및 통계"},{"id":"special","label":"특수 관리"},{"id":"ext","label":"외부 서비스"}] : [{"id":"staff-work","label":"현장 운영"},{"id":"staff-ext","label":"외부 서비스"}];
  const menuEntries = (isAdmin ? [{id:"dashboard",label:"대시보드",groupId:"dash",element:(<NavItem icon={LayoutDashboard} label="대시보드" active={currentView === 'dashboard' || currentView === 'ai-consultant'} onClick={() => handleNavClick('dashboard')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('dashboard')} />)},
{id:"data-integrity",label:"데이터 점검",groupId:"dash",element:(<NavItem icon={ShieldCheck} label="데이터 점검" active={currentView === 'data-integrity'} onClick={() => handleNavClick('data-integrity')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('data-integrity')} />)},
{id:"officetalk",label:"오피스톡",groupId:"dash",element:(<NavItem icon={MessageSquare} label="오피스톡" active={currentView === 'officetalk'} onClick={() => handleNavClick('officetalk')} collapsed={isSidebarCollapsed} badge={chatRooms.filter(r => r.participantIds.includes(currentUser.id) && r.lastUpdatedAt > (r.lastReadBy?.[currentUser.id] ?? '')).length || undefined} hidden={!viewAllowed('officetalk')} />)},
{id:"orders",label:"주문·배송",groupId:"work",element:(<NavItem icon={ShoppingCart} label="주문·배송" active={currentView === 'orders'} onClick={() => handleNavClick('orders')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('orders') && !viewAllowed('shipping')} />)},
{id:"admin-checklist",label:"확인사항",groupId:"work",element:(<NavItem icon={ClipboardList} label="확인사항" active={currentView === 'admin-checklist'} onClick={() => handleNavClick('admin-checklist')} collapsed={isSidebarCollapsed} badge={adminPendingCount > 0 ? adminPendingCount : undefined} hidden={!viewAllowed('admin-checklist')} />)},
{id:"trade-statement",label:"전표",groupId:"work",element:(<NavItem icon={FileText} label="전표" active={currentView === 'trade-statement'} onClick={() => handleNavClick('trade-statement')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('trade-statement')} />)},
{id:"tax-statement",label:"세금계산서",groupId:"work",element:(<NavItem icon={Receipt} label="세금계산서" active={currentView === 'tax-statement'} onClick={() => handleNavClick('tax-statement')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('tax-statement')} />)},
{id:"quotation",label:"견적서",groupId:"work",element:(<NavItem icon={FileSignature} label="견적서" active={currentView === 'quotation'} onClick={() => handleNavClick('quotation')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('quotation')} />)},
{id:"inventory",label:"재고 관리",groupId:"master",element:(<NavItem icon={Package} label="재고 관리" active={currentView === 'inventory'} onClick={() => handleNavClick('inventory')} collapsed={isSidebarCollapsed} badge={(lowStockCount > 0 ? lowStockCount : 0) + returnRequests.filter(r => r.status === 'pending' && !r.cancelledAt).length + receivedOrders.filter(r => r.status === 'received' && !r.linkedStatementId).length || undefined} hidden={!viewAllowed('inventory')} />)},
{id:"lot-management",label:"생산 관리",groupId:"master",element:(<NavItem icon={Factory} label="생산 관리" active={currentView === 'lot-management'} onClick={() => handleNavClick('lot-management')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('lot-management')} />)},
{id:"item-management",label:"품목 관리",groupId:"master",element:(<NavItem icon={Package} label="품목 관리" active={currentView === 'item-management'} onClick={() => handleNavClick('item-management')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('item-management')} />)},
{id:"partners",label:"거래처 관리",groupId:"master",element:(<NavItem icon={Users} label="거래처 관리" active={currentView === 'partners'} onClick={() => handleNavClick('partners')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('partners')} />)},
{id:"hr",label:"인사 관리",groupId:"master",element:(<NavItem icon={UserCheck} label="인사 관리" active={currentView === 'hr'} onClick={() => handleNavClick('hr')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('hr')} />)},
{id:"notice",label:"공지사항",groupId:"master",element:(<NavItem icon={BellRing} label="공지사항" active={currentView === 'notice'} onClick={() => handleNavClick('notice')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('notice')} />)},
{id:"file-cabinet",label:"문서함",groupId:"master",element:(<NavItem icon={FolderOpen} label="문서함" active={currentView === 'file-cabinet'} onClick={() => handleNavClick('file-cabinet')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('file-cabinet')} />)},
{id:"qr-label",label:"QR 라벨 인쇄",groupId:"master",element:(<NavItem icon={QrCode} label="QR 라벨 인쇄" active={false} onClick={() => setShowQrLabel(true)} collapsed={isSidebarCollapsed} />)},
{id:"ledger-cash",label:"현금출납장",groupId:"ledger",element:(<NavItem icon={Wallet} label="현금출납장" active={currentView === 'ledger-cash' && ledgerTab === 'cash'} onClick={() => { setLedgerTab('cash'); handleNavClick('ledger-cash'); }} collapsed={isSidebarCollapsed} hidden={!viewAllowed('ledger-cash')} />)},
{id:"ledger-partner",label:"거래처원장",groupId:"ledger",element:(<NavItem icon={BookOpen} label="거래처원장" active={currentView === 'ledger-cash' && ledgerTab === 'partner'} onClick={() => { setLedgerTab('partner'); handleNavClick('ledger-cash'); }} collapsed={isSidebarCollapsed} hidden={!viewAllowed('ledger-cash')} />)},
{id:"item-ledger",label:"제품별원장",groupId:"ledger",element:(<NavItem icon={Package} label="제품별원장" active={currentView === 'item-ledger'} onClick={() => handleNavClick('item-ledger')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('item-ledger')} />)},
{id:"financial-reports",label:"재무제표",groupId:"ledger",element:(<NavItem icon={Scale} label="재무제표" active={currentView === 'financial-reports'} onClick={() => handleNavClick('financial-reports')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('financial-reports')} />)},
{id:"loan-management",label:"대출 관리",groupId:"ledger",element:(<NavItem icon={Wallet} label="대출 관리" active={currentView === 'loan-management'} onClick={() => handleNavClick('loan-management')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('loan-management')} />)},
{id:"profit-analysis",label:"손익 / 비용 분석",groupId:"biz",element:(<NavItem icon={BarChart2} label="손익 / 비용 분석" active={currentView === 'profit-analysis' || currentView === 'cost-management'} onClick={() => handleNavClick('profit-analysis')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('profit-analysis')} />)},
{id:"cash-flow",label:"현금흐름 분석",groupId:"biz",element:(<NavItem icon={Activity} label="현금흐름 분석" active={currentView === 'cash-flow'} onClick={() => handleNavClick('cash-flow')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('cash-flow')} />)},
{id:"partner-stats",label:"거래처통계",groupId:"biz",element:(<NavItem icon={TrendingUp} label="거래처통계" active={currentView === 'partner-stats'} onClick={() => handleNavClick('partner-stats')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('partner-stats')} />)},
{id:"production",label:"생산 실적",groupId:"biz",element:(<NavItem icon={Factory} label="생산 실적" active={currentView === 'production'} onClick={() => handleNavClick('production')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('production')} />)},
{id:"smartstore-analytics",label:"스마트스토어 분석",groupId:"biz",element:(<NavItem icon={ShoppingBag} label="스마트스토어 분석" active={currentView === 'smartstore-analytics'} onClick={() => handleNavClick('smartstore-analytics')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('smartstore-analytics')} />)},
{id:"haccp-checklist",label:"HACCP 체크리스트",groupId:"special",element:(<NavItem icon={ClipboardList} label="HACCP 체크리스트" active={currentView === 'haccp-checklist'} onClick={() => handleNavClick('haccp-checklist')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('haccp-checklist')} />)},
{id:"partner-signup",label:"거래처 가입승인",groupId:"ext",element:(<NavItem icon={UserPlus} label="거래처 가입승인" active={currentView === 'partner-signup'} onClick={() => handleNavClick('partner-signup')} collapsed={isSidebarCollapsed} badge={pendingSignupCount > 0 ? pendingSignupCount : undefined} hidden={!viewAllowed('partner-signup')} />)},
{id:"partner-portal",label:"거래처 주문 포털",groupId:"ext",element:(<button
                        onClick={openPartnerPortal}
                        title={isSidebarCollapsed ? "거래처 주문 포털" : undefined}
                        className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between px-4'} py-3 rounded-xl text-slate-500 hover:bg-cyan-50 hover:text-cyan-600 transition-all group`}
                      >
                        <div className="flex items-center space-x-3">
                          <Globe size={18} />
                          {!isSidebarCollapsed && <span className="text-sm font-medium">거래처 주문 포털</span>}
                        </div>
                        {!isSidebarCollapsed && <ExternalLink size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                      </button>)}] : [{id:"notice",label:"공지사항",groupId:"staff-work",element:(<NavItem icon={BellRing} label="공지사항" active={currentView === 'notice'} onClick={() => handleNavClick('notice')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('notice')} />)},
{id:"officetalk",label:"오피스톡",groupId:"staff-work",element:(<NavItem icon={MessageSquare} label="오피스톡" active={currentView === 'officetalk'} onClick={() => handleNavClick('officetalk')} collapsed={isSidebarCollapsed} badge={chatRooms.filter(r => r.participantIds.includes(currentUser.id) && r.lastUpdatedAt > (r.lastReadBy?.[currentUser.id] ?? '')).length || undefined} hidden={!viewAllowed('officetalk')} />)},
{id:"orders",label:"주문·배송",groupId:"staff-work",element:(<NavItem icon={ShoppingCart} label="주문·배송" active={currentView === 'orders'} onClick={() => handleNavClick('orders')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('orders') && !viewAllowed('shipping')} />)},
{id:"inventory",label:"재고 관리",groupId:"staff-work",element:(<NavItem icon={Package} label="재고 관리" active={currentView === 'inventory'} onClick={() => handleNavClick('inventory')} collapsed={isSidebarCollapsed} badge={(lowStockCount > 0 ? lowStockCount : 0) + returnRequests.filter(r => r.status === 'pending' && !r.cancelledAt).length + receivedOrders.filter(r => r.status === 'received' && !r.linkedStatementId).length || undefined} hidden={!viewAllowed('inventory')} />)},
{id:"lot-management",label:"생산 관리",groupId:"staff-work",element:(<NavItem icon={Factory} label="생산 관리" active={currentView === 'lot-management'} onClick={() => handleNavClick('lot-management')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('lot-management')} />)},
{id:"item-management",label:"품목 관리",groupId:"staff-work",element:(<NavItem icon={Package} label="품목 관리" active={currentView === 'item-management'} onClick={() => handleNavClick('item-management')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('item-management')} />)},
{id:"pallets",label:"파렛트 관리",groupId:"staff-work",element:(<NavItem icon={Layers} label="파렛트 관리" active={currentView === 'pallets'} onClick={() => handleNavClick('pallets')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('pallets')} />)},
{id:"leave-portal",label:"연차 신청",groupId:"staff-work",element:(<NavItem icon={CalendarCheck} label="연차 신청" active={currentView === 'leave-portal'} onClick={() => handleNavClick('leave-portal')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('leave-portal')} />)},
{id:"confirmation-items",label:"확인사항",groupId:"staff-work",element:(<NavItem icon={ShieldCheck} label="확인사항" active={currentView === 'confirmation-items'} onClick={() => handleNavClick('confirmation-items')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('confirmation-items')} />)},
{id:"sanitation-checklist",label:"작업장 위생점검",groupId:"staff-work",element:(<NavItem icon={ShieldAlert} label="작업장 위생점검" active={currentView === 'sanitation-checklist'} onClick={() => handleNavClick('sanitation-checklist')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('sanitation-checklist')} />)},
{id:"documents",label:"서류 관리",groupId:"staff-work",element:(<NavItem icon={FileText} label="서류 관리" active={currentView === 'documents'} onClick={() => handleNavClick('documents')} collapsed={isSidebarCollapsed} hidden={!viewAllowed('documents')} />)},
{id:"partner-portal",label:"거래처 주문 포털",groupId:"staff-ext",element:(<button
                      onClick={openPartnerPortal}
                      title={isSidebarCollapsed ? "거래처 주문 포털" : undefined}
                      className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between px-4'} py-3 rounded-xl text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 transition-all group`}
                    >
                      <div className="flex items-center space-x-3">
                        <Globe size={18} />
                        {!isSidebarCollapsed && <span className="text-sm font-medium">거래처 주문 포털</span>}
                      </div>
                      {!isSidebarCollapsed && <ExternalLink size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                    </button>)}]).filter(row => !(row.element.props as {hidden?:boolean}).hidden);
  const menuCatalog = menuEntries.map(({id,label,groupId}) => ({id,label,groupId}));
  const {key:menuKey,value:menuValue,error:menuError,change:changeMenu,reset:resetMenu} = useMenuPreferencesController({identity:menuIdentity,companyId,employeeId:currentUser.id,isAdmin,groups:menuGroups,items:menuCatalog});
  const helpSessionKey = menuKey ? `${menuKey}:${currentView}` : null;
  useEffect(()=>{setHelpOpen(null);},[helpSessionKey]);
  useEffect(()=>{
    const openHelp=(event:KeyboardEvent)=>{
      if(event.altKey&&!event.ctrlKey&&!event.metaKey&&(event.key==='/'||event.code==='Slash')&&helpSessionKey){event.preventDefault();setHelpOpen(helpSessionKey);}
    };
    window.addEventListener('keydown',openHelp);
    return()=>window.removeEventListener('keydown',openHelp);
  },[helpSessionKey]);


  return (
    <div className="flex overflow-hidden bg-slate-50" style={{ height: '100dvh' }}>
      {helpOpen && helpOpen === helpSessionKey && menuIdentity && <React.Suspense fallback={<p role="status">도움말을 여는 중입니다.</p>}><HelpChat key={helpSessionKey} companyId={companyId} userId={menuIdentity.uid} mode={isAdmin?'admin':'staff'} currentView={currentView} onClose={()=>setHelpOpen(null)} onNavigate={id=>{
        if(menuIdentity.uid!==auth.currentUser?.uid)return false;
        const editingDialog=Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')).some(node=>node.isConnected&&node.getAttribute('aria-labelledby')!=='help-chat-title'&&!node.closest('[hidden], [aria-hidden="true"]')&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden'&&node.getClientRects().length>0);
        if(editingDialog)return false;
        if(id==='mypage'){setCurrentView('mypage');setHelpOpen(null);return true;}
        const entry=menuEntries.find(row=>row.id===id);
        if(!entry)return false;
        entry.element.props.onClick();setHelpOpen(null);return true;
      }}/></React.Suspense>}
      {/* 모바일 오버레이 배경 — 항상 렌더, opacity로 fade 트랜지션 */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 xl:hidden ${
          isMobile && !isSidebarCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsSidebarCollapsed(true)}
      />

      <aside className={`fixed inset-y-0 left-0 z-50 bg-white border-r border-slate-200 overflow-hidden transition-all duration-300 ${
        isMobile
          ? (isSidebarCollapsed ? '-translate-x-full' : 'translate-x-0 w-64')
          : (isSidebarCollapsed ? 'w-20' : 'w-64')
      }`}>
        <div className={`flex flex-col h-full ${isSidebarCollapsed ? 'p-4' : 'p-6'}`} style={{ paddingTop: `max(${isSidebarCollapsed ? '1rem' : '1.5rem'}, env(safe-area-inset-top))`, paddingBottom: `max(${isSidebarCollapsed ? '1rem' : '1.5rem'}, env(safe-area-inset-bottom))` }}>
          <div className={`flex items-center ${isSidebarCollapsed ? 'flex-col gap-2' : 'px-2 justify-between'} mb-10`}>
            {/* 로그인 계정의 회사로 고정한다. 회사 전환을 허용하면 별도 사업자의 장부가 섞인다. */}
            <div className="flex items-center space-x-3"
              onClick={() => {
                if (!isAdmin) setCurrentView('orders');
              }}
              title={company.name}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg flex-shrink-0 ${
                companyId === TAEBAEK ? 'bg-cyan-600 shadow-cyan-200' : 'bg-orange-500 shadow-orange-200'}`}>
                <svg width="22" height="22" viewBox="0 0 32 32" fill="none"><path d="M4 16C4 16 8 8 16 8C24 8 28 16 28 16" stroke="white" strokeWidth="3" strokeLinecap="round"/><path d="M22 12L28 16L22 20" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><circle cx="16" cy="22" r="3" fill="white"/></svg>
              </div>
              <div className={`overflow-hidden transition-all duration-200 ${isSidebarCollapsed ? 'opacity-0 w-0' : 'opacity-100'}`}>
                <p className={`text-xs font-black uppercase tracking-widest leading-none ${companyId === TAEBAEK ? 'text-cyan-600' : 'text-orange-500'}`}>Flow-It</p>
                <p className="text-sm font-bold text-slate-700 leading-tight mt-0.5 whitespace-nowrap">
                  {isAdmin ? company.name : (companyInfo?.name ?? '태백식품')} {isAdmin ? '관리자 센터' : ''}
                </p>
              </div>
            </div>
            {!isMobile && (
              <button
                onClick={() => setIsSidebarCollapsed(prev => !prev)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all flex-shrink-0"
                title={isSidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
              >
                {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </button>
            )}
          </div>

          {/* 알림 벨 */}
          {(() => {
            const { unread } = selectBellNotifications(appNotifications, currentUser.id);
            return (
              <div className={`mb-2 ${isSidebarCollapsed ? 'flex justify-center' : 'px-1'}`}>
                <button
                  ref={notifBtnRef}
                  onClick={() => {
                    if (notifBtnRef.current) {
                      const rect = notifBtnRef.current.getBoundingClientRect();
                      setNotifPanelPos({ top: rect.top, left: rect.right + 8 });
                    }
                    setShowNotifPanel(p => !p);
                  }}
                  className={`relative flex items-center gap-2 w-full rounded-2xl px-3 py-2 hover:bg-slate-100 transition-all ${showNotifPanel ? 'bg-slate-100' : ''}`}
                >
                  <div className="relative shrink-0">
                    {unread.length > 0 ? <BellRing size={18} className="text-amber-500" /> : <Bell size={18} className="text-slate-400" />}
                    {unread.length > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">{unread.length > 99 ? '99+' : unread.length}</span>
                    )}
                  </div>
                  {!isSidebarCollapsed && <span className="text-xs font-bold text-slate-600">알림{unread.length > 0 ? ` (${unread.length})` : ''}</span>}
                </button>
              </div>
            );
          })()}

          {/* 직원 뷰 전환 버튼 (관리자 전용) */}
          {(isAdmin && onPreviewStaff || !isAdmin && onExitPreview) && (
            isSidebarCollapsed ? (
              <div className="mb-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => { isAdmin ? onPreviewStaff?.() : onExitPreview?.(); }}
                  aria-label={isAdmin ? '직원 뷰로 전환' : '관리자 뷰로 전환'}
                  title={isAdmin ? '현재 관리자 뷰 · 직원 뷰로 전환' : '현재 직원 뷰 · 관리자 뷰로 전환'}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 transition-colors hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  {isAdmin ? <ShieldCheck size={18} aria-hidden="true" /> : <UserCheck size={18} aria-hidden="true" />}
                </button>
              </div>
            ) : (
              <div className="mb-2 flex gap-0.5 rounded-xl bg-slate-100 p-0.5" role="group" aria-label="계정 뷰 선택">
                <button type="button" aria-pressed={isAdmin} onClick={() => { if (!isAdmin) onExitPreview?.(); }} className={`min-h-10 flex-1 rounded-[10px] px-2 text-[11px] font-bold transition-colors ${isAdmin ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>관리자 뷰</button>
                <button type="button" aria-pressed={!isAdmin} onClick={() => { if (isAdmin) onPreviewStaff?.(); }} className={`min-h-10 flex-1 rounded-[10px] px-2 text-[11px] font-bold transition-colors ${!isAdmin ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>직원 뷰</button>
              </div>
            )
          )}

          {/*  계정 메뉴 — 알림 권한·소리설정·로그아웃이 다 여기 있다.
               권한을 묻는 자리는 앱 전체에서 이 한 곳이다(2026-09-03 사장님). */}
          <AccountMenu currentUser={currentUser} collapsed={isSidebarCollapsed}
            active={currentView === 'mypage'} onOpen={() => setCurrentView('mypage')} />
          
          <div className="flex-1 min-h-0 space-y-8 overflow-y-auto no-scrollbar">

            {menuValue.groups.map(groupId => {
              const group=menuGroups.find(row=>row.id===groupId)!;
              const rows=menuValue.items.filter(row=>row.groupId===groupId&&!row.hidden);
              if(!rows.length)return null;
              return <NavGroup key={groupId} title={group.label} storageKey={groupId} collapsed={isSidebarCollapsed}><nav className="space-y-1">{rows.map(row=><React.Fragment key={row.id}>{menuEntries.find(entry=>entry.id===row.id)?.element}</React.Fragment>)}</nav></NavGroup>;
            })}
          </div>

        </div>
      </aside>

      <main className={`flex-1 flex flex-col min-w-0 overflow-hidden transition-all duration-300 ${isMobile ? '' : (isSidebarCollapsed ? 'ml-20' : 'ml-64')}`} style={{ height: '100dvh' }}>
        {/* 공통 상단 메뉴 */}
        <AppTopBar currentView={currentView} currentUser={currentUser}
          hasUnreadNotifications={appNotifications.some(n => !n.readBy.includes(currentUser.id) && (!n.targetId || n.targetId === currentUser.id))} helpAvailable={!!helpSessionKey}
          onOpenMenu={() => setIsSidebarCollapsed(false)} onOpenHelp={()=>setHelpOpen(helpSessionKey)}
          onOpenNotifications={event => { const rect = event.currentTarget.getBoundingClientRect(); setNotifPanelPos({ top: rect.bottom + 8, left: Math.max(8, window.innerWidth - 368) }); setShowNotifPanel(prev => !prev); }} />
        
        <div className="flex-1 overflow-auto p-3 md:p-4 lg:p-6 custom-scrollbar">
          <FinancialOpeningResume key={`${companyId}:${auth.currentUser?.uid ?? ''}`} companyId={companyId} onRecovered={refreshStaticData} />
          {/* 초기 데이터 로딩 스켈레톤 */}
          {isDataLoading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-8 bg-slate-200 rounded-xl w-48" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="bg-white rounded-2xl p-6 border border-slate-100 space-y-3">
                    <div className="w-10 h-10 bg-slate-200 rounded-xl" />
                    <div className="h-3 bg-slate-200 rounded w-2/3" />
                    <div className="h-6 bg-slate-200 rounded w-1/2" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-6 h-64" />
                <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-slate-200 rounded-full shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 bg-slate-200 rounded w-3/4" />
                        <div className="h-2.5 bg-slate-100 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
          <div className={(['orders', 'officetalk', 'leave-portal', 'inventory', 'partners', 'notice', 'pallets', 'confirmation-items', 'shipping', 'production', 'return-management', 'sanitation-checklist'].includes(currentView)) ? '' : 'h-full'}>
          {(currentView === 'dashboard' || currentView === 'ai-consultant') && (
            <div className="h-full flex flex-col overflow-hidden">
              <div className="shrink-0">
                {/* 헤더(제목) + 우측 탭 전환 — 공통 패턴 */}
                <PageHeader
                  title={currentView === 'dashboard' ? '비즈니스 현황' : 'AI 인사이트'}
                  subtitle={currentView === 'dashboard'
                    ? `${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })} 기준`
                    : 'AI 기반 비즈니스 분석 기능입니다.'}
                  right={
                    <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
                      <button
                        onClick={() => handleNavClick('dashboard')}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${currentView === 'dashboard' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                      >
                        <LayoutDashboard size={13} />비즈니스 현황
                      </button>
                      <button
                        onClick={() => handleNavClick('ai-consultant')}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black transition-all ${currentView === 'ai-consultant' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                      >
                        <Sparkles size={13} />AI 인사이트
                      </button>
                    </div>
                  }
                />
              </div>
              <div className="flex-1 overflow-y-auto pt-4">
                {currentView === 'dashboard' && (
                  <Dashboard
                    orders={allOrders}
                    items={allItems}
                    partners={partners}
                    partnerItems={partnerItems}
                    onNavigate={(view) => setCurrentView(view)}
                  />
                )}
                {currentView === 'ai-consultant' && (
                  <AIConsultant orders={allOrders} items={allItems} />
                )}
              </div>
            </div>
          )}
          {currentView === 'data-integrity' && (
            <DataIntegrityMonitor
              companyId={companyId}
              orders={allOrders}
              items={integritySnapshot?.items ?? []}
              itemBoms={itemBoms}
              purchaseOrders={purchaseOrders}
              itemReceipts={itemReceipts}
              returnOperations={appData.returnOperations}
              rawMaterialLedger={integritySnapshot?.ledger ?? []}
              rawInventories={integritySnapshot?.states ?? []}
              issuedStatements={issuedStatements}
              productionSalesLogs={mergedProductionSalesLogs}
              onRefresh={() => setLedgerReloadKey(key => key + 1)}
              loading={!integritySnapshot || integritySnapshot.key !== integrityKey || !appData.returnOperationsLoaded}
            />
          )}
          {currentView === 'shipping' && (
            <DeliveryManager
              renderOrderRecovery={renderOrderRecovery}
              orderRecoveryOrphans={orderRecoveryOrphans}
              companyId={companyId}
              orders={orders.filter(order => !isStockProduction(order))}
              partners={partners}
              items={allItems}
              partnerItems={partnerItems}
              palletStocks={pallets}

              itemBoms={itemBoms}
              currentUserName={currentUser?.name}
              onUpdateDeliveryDate={(id, date) => updateItem('orders', id, { deliveryDate: date })}
              onUpdateStatus={(id, status) => requestOrderStatus(id, status)}
              {...orderEditBindings}

              onUpdateNote={(id, note, important) => updateItem('orders', id, { note, noteImportant: !!note && important, noteBy: currentUser?.name || '미기록', noteAt: new Date().toISOString() })}
              onUpdatePallets={(id, nextPallets) => updateItem('orders', id, { pallets: nextPallets })}
              onToggleInvoicePrinted={(id, value) => updateItem('orders', id, invoicePatch(value))}
              onUpdateInvoiceType={(id, value) => updateItem('orders', id, invoiceTypePatch(value))}
              onToggleShipmentComplete={handleToggleShipmentComplete}
              onToggleItemChecked={handleToggleItemChecked}
              onDeleteOrder={handleDeleteOrder}
            />
          )}
          {currentView === 'orders' && (
            <OrdersList
              renderOrderRecovery={renderOrderRecovery}
              orderRecoveryOrphans={orderRecoveryOrphans}
              companyId={companyId}
              orderUnitInputs={appData.orderUnitInputs}
              //  주문 로그가 `createdBy`(사번)를 이름으로 풀 때 쓴다.
              employees={employees}
              /*  **캘린더 자리는 배송 캘린더가 채운다**(2026-09-11 사장님:
                  "캘린더는 배송관리쪽꺼 쓰고 나머지 리스트랑 보드는 주문관리쪽꺼 쓸거고").
                  탭바·검색·금일 작업순서는 주문 쪽 그대로 두고 캘린더만 갈아 끼운다 —
                  오전·오후 시간대, 배송 순서 번호, 주소까지 배송 쪽 기능이 다 따라온다. */
              calendarSlot={sort => (
                <DeliveryManager
                  renderOrderRecovery={renderOrderRecovery}
                  orderRecoveryOrphans={orderRecoveryOrphans}
                  companyId={companyId}
                  calendarOnly
                  sortMode={sort}
                  orders={orders.filter(order => !isStockProduction(order))}
                  partners={partners}
                  items={allItems}
                  partnerItems={partnerItems}
                  palletStocks={pallets}
                  itemBoms={itemBoms}
                  currentUserName={currentUser?.name}
                  onUpdateDeliveryDate={(id, date) => updateItem('orders', id, { deliveryDate: date })}
                  onUpdateStatus={(id, status) => requestOrderStatus(id, status)}
                  {...orderEditBindings}

                  onUpdateNote={(id, note, important) => updateItem('orders', id, { note, noteImportant: !!note && important, noteBy: currentUser?.name || '미기록', noteAt: new Date().toISOString() })}
                  onUpdatePallets={(id, nextPallets) => updateItem('orders', id, { pallets: nextPallets })}
                  onToggleInvoicePrinted={(id, value) => updateItem('orders', id, invoicePatch(value))}
                  onUpdateInvoiceType={(id, value) => updateItem('orders', id, invoiceTypePatch(value))}
                  onToggleShipmentComplete={handleToggleShipmentComplete}
                  onToggleItemChecked={handleToggleItemChecked}
                />
              )}
              orders={allOrders}
              partners={partners}
              items={allItems}
              partnerItems={partnerItems}
              itemBoms={itemBoms}
              isLoadingHistoricalOrders={isLoadingHistoricalOrders}
              onLoadHistoricalOrders={loadHistoricalOrders}
              ordersMonths={ordersMonths}
              onChangeOrdersMonths={setOrdersMonths}
              onDeleteOrder={handleDeleteOrder}
              onAddClick={() => setIsOrderCreateChooserOpen(true)}
              title="주문 관리"
              subtitle="전체 주문 현황"
              groupBy="status" 
              allowedStatuses={Object.values(OrderStatus)} 
              onUpdateStatus={(id, status) => requestOrderStatus(id, status)}
              onUpdateDeliveryDate={(id, date) => updateItem('orders', id, { deliveryDate: date })}
              onUpdatePallets={(id, p) => updateItem('orders', id, { pallets: p })}
              palletStocks={pallets}
              onToggleItemChecked={handleToggleItemChecked}
              {...orderEditBindings}
              onUpdateNote={(id, note, important) => updateItem('orders', id, { note, noteImportant: !!note && important, noteBy: currentUser?.name || '미기록', noteAt: new Date().toISOString() })}
              onUpdateDeliveryBoxes={(id, boxes) => updateItem('orders', id, { deliveryBoxes: boxes })}
              onToggleInvoicePrinted={(id, value) => updateItem('orders', id, invoicePatch(value))}
              onUpdateInvoiceType={(id, value) => updateItem('orders', id, invoiceTypePatch(value))}
              currentUserName={currentUser?.name}
              highlightOrderId={highlightOrderId}
              onHighlightClear={() => setHighlightOrderId(null)}
              newOrderId={newOrderId}
              onNewOrderIdClear={() => setNewOrderId(null)}
              workOrderItems={workOrderItems}
              onSetWorkOrderItems={async (items) => {
                // 남아 있는 항목은 순번(sortIndex)만 고친다.
                // 전엔 전체 삭제 후 전체 재생성이라, 구독이 '빈 목록 → 다시 채워짐'을 그대로 받아
                // 순서만 바꿔도 화면이 깜빡였고 문서 id가 매번 새로 생겨 목록 전체가 다시 그려졌다.
                // (목록은 useAppData에서 sortIndex로 정렬해 구독하므로 순번만 바꿔도 순서가 반영된다.)
                const prevByKey = new Map(workOrderItems.map(w => [w.key, w]));
                const nextKeys = new Set(items.map(i => i.key));
                const writes: Promise<unknown>[] = [];
                workOrderItems.forEach(w => {
                  if (!nextKeys.has(w.key)) writes.push(deleteItem('workOrderItems', w.id));
                });
                items.forEach((item, idx) => {
                  const prev = prevByKey.get(item.key);
                  if (!prev) { writes.push(addItem('workOrderItems', { ...item, id: `wo-${Date.now()}-${idx}`, sortIndex: idx })); return; }
                  /*
                   * **순번만 쓰던 것을 고친다**(2026-09-11 사장님: "작업순서에서 묶으면 뭐가
                   * 되는거냐 아무 변화도 없는 거 같아").
                   *
                   * 맞다 — 여기가 `sortIndex` 가 바뀐 줄만 저장했다. 묶기(`groupId`)는 자리를
                   * 안 바꾸는 일이라(이미 붙어 있는 둘을 묶으면 순번이 그대로다) **아무것도 안 쓰이고**
                   * 새로고침하면 묶음이 사라졌다. 작업 그룹(`workGroup`)도 같은 함정에 걸린다.
                   * 달라진 칸을 모아서 쓴다.
                   */
                  const patch: Record<string, unknown> = {};
                  if (prev.sortIndex !== idx) patch.sortIndex = idx;
                  for (const 칸 of ['groupId', 'groupName', 'workGroup'] as const) {
                    const 전 = (prev as unknown as Record<string, unknown>)[칸] ?? null;
                    const 후 = (item as unknown as Record<string, unknown>)[칸] ?? null;
                    //  Firestore 는 undefined 를 못 쓴다 — 지울 때는 null 로 적는다.
                    if (전 !== 후) patch[칸] = 후;
                  }
                  if (Object.keys(patch).length > 0) writes.push(updateItem('workOrderItems', prev.id, patch));
                });
                await Promise.all(writes);
              }}
            />
          )}
          {(currentView === 'inventory' || currentView === 'lot-management') && (
            <>
            {currentView === 'inventory' && <BomIntegrityPanel items={allItems} itemFormulas={itemFormulas} bomIndex={appData.orderUnitInputs!.bom} />}
            <ItemList
              orderUnitInputs={appData.orderUnitInputs}
              mode={currentView === 'lot-management' ? 'lots' : 'inventory'}
              companyId={companyId}
              items={companyItems}
              orders={allOrders}
              onUpdateItem={async (p) => {
                await updateItem(COL.items, p.id, p);
              }}
              onAddItem={(p) => addItem(COL.items, p)} 
              orderRequests={pendingPurchaseOrders}
              confirmedOrders={invoicedPurchaseOrders}
              dispatchedQtyByItem={dispatchedQtyByItem}
              onAddOrderRequest={handleAddOrderRequest}
              onRemoveOrderRequest={handleRemoveOrderRequest}
              onUpdateOrderRequestQty={handleUpdateOrderRequestQty}
              onUpdatePoItemQty={handleUpdatePoItemQty}
              onRemovePoItem={handleRemovePoItem}
              onRequestPoEdit={handleRequestPoEdit}
              onToggleConfirmRequestQty={handleToggleConfirmRequestQty}
              onConfirmRequest={(id: string) => handleConfirmPendingToInvoiced([{ id, quantity: pendingPurchaseOrders.find(row => row.id === id)?.quantity || 0 }])}
              onConfirmRequests={(ids: string[]) => handleConfirmPendingToInvoiced(pendingPurchaseOrders.filter(r => ids.includes(r.id)).map(r => ({ id: r.id, quantity: r.quantity })))}
              onBulkAddConfirmedOrders={handleBulkAddConfirmedOrders}
              onConfirmAllRequests={async () => { await handleConfirmPendingToInvoiced(pendingPurchaseOrders.map(r => ({ id: r.id, quantity: r.quantity }))); }}
              onFinishConfirmedOrder={handleFinishConfirmedOrder}
              onUpdateConfirmedQty={(id: string, qty: number) => updateItem('purchaseOrders', id, { quantity: qty })}
              onUpdatePendingFlowQty={(type, id, updates) => updatePendingFlowQuantity(companyId, type, id, updates)}
              onRemoveConfirmedOrder={handleRemoveConfirmedOrder}
              onEditProduct={(p) => { setItemEditorRecovery(null);setEditingProduct(p); setIsProductModalOpen(true); }}
              onDeleteItem={requestCatalogItemDelete}
              onAddAdjustmentRequest={(req) => addItem('adjustmentRequests', req)}
              inboundPartners={partners.filter(buysFrom)}
              partnerItems={partnerItems}
              partners={partners}
              currentUser={currentUser}
              isAdmin={isAdmin}
              issuedStatements={issuedStatements}
              onRequestPurchaseInvoice={(partnerId, partnerName, items, poIds) => {
                setPendingInvoice({ partnerId, partnerName, items, poIds });
                setShowInboundInvoice(true);
              }}
              onOpenVoucher={(_docNo, statementId) => setInboundDetailId(statementId)}
              rawMaterialLedger={mergedRawMaterialLedger}
              linesUsingRaw={linesUsingRaw}
              rawYieldRules={yieldRules}
              
              onAddRawMaterialEntry={async (entry,intent,retained) => {
                // 재개는 현재 수율·품목으로 다시 만들지 않고 최초 원문만 확인한다.
                if (entry.type === 'manual' && entry.used > 0 && entry.targetKg == null) {
                  const uid = auth.currentUser?.uid;
                  if (!uid) return { ok: false, reason: '로그인을 확인해 주세요.' };
                  const owner=rawCancelScopeRef.current;
                  const isCurrent=()=>rawCancelAlive.current&&rawCancelScopeRef.current===owner&&owner.companyId===companyId&&auth.currentUser?.uid===uid;
                  if (intent==='resume') {
                    if(!retained||retained.request.companyId!==companyId||retained.request.actorUid!==uid||rawPressText(retained.request.entry)!==rawPressText(entry))return {ok:false,reason:'선택한 최초 압착 요청과 로그인 범위를 확인해 주세요.'};
                    assertRawPressAttempt(retained);
                    const outcome=await executeRawPress(retained.request,{retained,isCurrent});
                    return outcome.status==='blocked'||outcome.status==='cancelled'?{ok:false,reason:outcome.reason}:{ok:true,appliedKg:outcome.sourceAppliedKg};
                  }
                  if (yieldRules[entry.material]) {
                    let request: RawPressRequest;
                    {
                      const source = rawHolderByName(allItems, entry.material, entry.companyId ?? companyId);
                      const rule = yieldRules[entry.material];
                      const derived = rawHolderByName(allItems, rule.product, companyId);
                      if (!source || !derived || source.id === derived.id) return { ok: false, reason: '서로 다른 원료와 파생 입고 품목을 확인해 주세요.', canEditRetry: true as const };
                      if (!entry.targetLotId || !entry.effectiveAt) return { ok: false, reason: '사용 로트와 최초 시각을 확인해 주세요.', canEditRetry: true as const };
                      request = {
                        version: 1, companyId, actorUid: uid, entry, yieldRule: rule,
                        sourceCommand: { ...rawLedgerKeys(source), operationId: entry.id, materialSnapshot: entry.material,
                          effectiveAt: entry.effectiveAt, source: { type: 'manual', id: entry.id }, kind: 'consume-lot', kg: entry.used, lotId: entry.targetLotId,
                          ...(entry.addedBy ? { actorName: entry.addedBy } : {}) },
                        derivedCommand: { ...rawLedgerKeys(derived), operationId: `yield:${entry.id}`, materialSnapshot: rule.product,
                          effectiveAt: entry.effectiveAt, source: { type: 'manual', id: entry.id }, kind: 'receive', kg: rawPressYieldKg(entry.used, rule.rate),
                          lot: { supplierName: `${entry.material} 압착`, qtyIn: 0 }, ...(entry.addedBy ? { actorName: entry.addedBy } : {}) },
                        sourceLegacy: { note: entry.note, type: entry.type, ...(entry.addedBy ? { addedBy: entry.addedBy } : {}),
                          ...(entry.originalAmount != null ? { originalAmount: entry.originalAmount } : {}), ...(entry.originalUnit ? { originalUnit: entry.originalUnit } : {}) },
                        derivedLegacy: { note: `${entry.material} 압착 (수율 ${rule.rate * 100}%)`, type: 'auto', ...(entry.addedBy ? { addedBy: entry.addedBy } : {}) },
                      };
                    }
                    let first;
                    try {first=await beginNewRawPressAttempt(request,isCurrent);}
                    catch(error){
                      if(!isCurrent())return {ok:false,reason:'압착 회사나 로그인 계정이 변경되었습니다.'};
                      const targets=[request.sourceCommand.rawItemId,request.derivedCommand.rawItemId];
                      const related=listRawPressAttempts(companyId,uid).find(row=>row.retained&&[row.retained.request.sourceCommand.rawItemId,row.retained.request.derivedCommand.rawItemId].some(id=>targets.includes(id)))?.retained;
                      return {ok:false,reason:error instanceof Error?error.message:String(error),...(related?{relatedRetained:related}:{})};
                    }
                    const outcome = await executeRawPress(first.request,{retained:first,isCurrent});
                    if(outcome.status==='cancelled')return {ok:false,reason:outcome.reason,canEditRetry:true as const};
                    return outcome.status === 'blocked' ? { ok: false, reason: outcome.reason, ...(!outcome.retainPending ? { canEditRetry: true as const } : {}) } : { ok: true, appliedKg: outcome.sourceAppliedKg };
                  }
                }
                /**
                 * **손입력·실사 — 로트와 원장을 한 트랜잭션에 넣는다**(설계 §6, 이관 5단계).
                 *
                 * 예전엔 여기서 원장만 쓰고, 로트는 부르는 화면(ItemList)이 **따로** 썼다.
                 * 로트 쓰기가 실패하면 `catch` 가 삼키고 토스트만 띄웠다 — 원장만 남았다.
                 * 이제 둘이 같이 성공하거나 같이 실패한다.
                 *
                 * **작업 id 는 `entry.id`** 다. 모달이 한 번 만든 값이라 재시도해도 같고,
                 * 그래서 같은 저장을 두 번 눌러도 수량은 한 번만 움직인다(§7).
                 *
                 * 소급 입력(마지막 실사보다 앞선 날짜) 판정도 명령 안에서 한다 —
                 * 화면이 들고 있는 배열이 아니라 **트랜잭션에서 읽은 상태**로 본다(§10).
                 */
                const 홀더 = rawHolderByName(allItems, entry.material, entry.companyId ?? companyId);
                if (!홀더) return { ok: false, reason: `원료 홀더를 못 찾았다: ${entry.material}` };
                if(entry.type==='manual'&&entry.used>0&&entry.targetKg==null){
                  const uid=auth.currentUser?.uid;
                  if(!uid)return {ok:false,reason:'로그인을 확인해 주세요.'};
                  const attempts=listRawPressAttempts(companyId,uid),invalid=attempts.find(row=>!row.retained);
                  if(invalid)return {ok:false,reason:invalid.error};
                  const related=attempts.find(row=>row.retained&&[row.retained.request.sourceCommand.rawItemId,row.retained.request.derivedCommand.rawItemId].includes(홀더.id))?.retained;
                  if(related)return {ok:false,reason:'이 원료의 이전 압착 처리 결과를 먼저 확인해 주세요. 수율 설정을 바꾸거나 실패 요청을 삭제해도 이전 처리 근거는 유지됩니다.',relatedRetained:related};
                }

                const 공통 = {
                  ...rawLedgerKeys(홀더),
                  materialSnapshot: entry.material,
                  effectiveAt: entry.targetKg != null
                    ? new Date().toISOString()
                    : (entry.effectiveAt ?? (entry.date === today() ? new Date().toISOString() : `${entry.date}T12:00:00+09:00`)),
                  ...(entry.addedBy ? { actorName: entry.addedBy } : {}),
                };
                const 옛칸 = {
                  ...(entry.note ? { note: entry.note } : {}),
                  ...(entry.type ? { type: entry.type } : {}),
                  ...(entry.addedBy ? { addedBy: entry.addedBy } : {}),
                  ...(entry.canSize ? { canSize: entry.canSize, canCount: entry.canCount } : {}),
                  ...(entry.canSizeTag ? { canSizeTag: entry.canSizeTag } : {}),
                  ...(entry.originalAmount != null ? { originalAmount: entry.originalAmount } : {}),
                  ...(entry.originalUnit ? { originalUnit: entry.originalUnit } : {}),
                };

                //  실사(targetKg)가 먼저다 — 잔량을 그 값으로 다시 잡는 앵커라 입고·사용과 다르다.
                const 명령 = entry.targetKg != null
                  ? entry.targetLotId
                    ? { ...공통, operationId: entry.id, source: { type: 'adjustment' as const, id: entry.id }, kind: 'adjust-lot' as const, lotId: entry.targetLotId, targetKg: entry.targetKg }
                    : { ...공통, operationId: entry.id, source: { type: 'stocktake' as const, id: entry.id }, kind: 'stocktake' as const, targetKg: entry.targetKg }
                  : (entry.received ?? 0) > 0
                    ? { ...공통, operationId: entry.id, source: { type: 'manual' as const, id: entry.id }, kind: 'receive' as const, kg: entry.received, lot: { supplierName: entry.note?.trim() || '직접입고', qtyIn: entry.canCount ?? 0, packageKg: entry.canSize, packageType: entry.canSizeTag } }
                    : (entry.used ?? 0) > 0
                      ? entry.targetLotId
                        ? { ...공통, operationId: entry.id, source: { type: 'manual' as const, id: entry.id }, kind: 'consume-lot' as const, kg: entry.used, lotId: entry.targetLotId }
                        : null
                      : null;
                if (!명령) return {
                  ok: false,
                  reason: (entry.used ?? 0) > 0 ? '사용할 로트를 선택해야 한다' : '수량이 0이다',
                };

                const r = await executeRawInventoryCommand(명령, {
                  newLotId: `lot-${entry.id}`, carryOverLotId: `carry-${entry.id}`, legacy: 옛칸,
                });
                if (r.status === 'rejected') return { ok: false, reason: r.message };
                if (r.status === 'conflict') return { ok: false, reason: '같은 작업 번호로 다른 내용이 이미 저장돼 있습니다.' };
                const applied = r.status === 'applied' ? r.movement.appliedDeltaKg : 0;

                return { ok: true, appliedKg: applied };
              }}
              onDeleteRawMaterialEntry={async (id) => { await cancelRawLedgerEntry(id); }}
              onLedgerChanged={() => setLedgerReloadKey(k => k + 1)}
              onUpdateSubmaterial={(id, data) => updateItem('items', id, data)}
              receivedOrders={receivedOrders}
              returnRequests={returnRequests}
              returnBadge={returnRequests.filter(r => r.status === 'pending' && !r.cancelledAt).length}
              onProcessReturn={handleProcessReturn}
              onResumeReturn={handleResumeReturn}
              returnContent={
                <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
                  <ReceivingReturnsManager
                    companyId={companyId}
                    issuedStatements={issuedStatements}
                    items={allItems}
                    partnerItems={partnerItems}
                    partners={partners}
                    orders={allOrders}
                    currentUser={{ id: currentUser.id, name: currentUser.name }}
                    isAdmin={isAdmin}
                    onProcessReturn={handleProcessReturn}
                  />
                </React.Suspense>
              }
              oemEnabled
              oemIssueDrafts={recoverableOemOrders}
              rawStockKg={rawStockKg}
              onOemIssue={async (v,intent?:'new'|'resume',expectedActorUid?:string,retained?:OemIssueRetained) => {
                const uid=expectedActorUid??auth.currentUser?.uid;
                const owner=rawCancelScopeRef.current;
                const isCurrent=()=>!!uid&&rawCancelAlive.current&&rawCancelScopeRef.current===owner&&owner.companyId===companyId&&auth.currentUser?.uid===uid;
                if(!isCurrent())throw Error('외주 송출 로그인 계정이 변경되었습니다.');
                const scope={actorUid:uid!,isCurrent};
                try {
                  if(intent==='resume'){
                    if(!retained||retained.request.companyId!==companyId||retained.request.actorUid!==uid)throw Error('최초 외주 송출 요청을 선택해 주세요.');
                    assertOemIssueAttempt(retained);
                    await issueOemBatchJob(db,retained.request.input,{...scope,retained});
                  }else{if(sessionStorage.getItem('oem-issue-pending:'+companyId)!==null||localStorage.getItem('oem-issue-pending:'+companyId)!==null)throw Error('과거 외주 출고의 최초 원문과 계정을 확인할 수 없습니다. 외주 출고 이력을 확인해주세요.');if(oemIssueScopes.current.has(v.jobId))throw Error('같은 외주 송출 요청을 확인 중입니다.');oemIssueScopes.current.set(v.jobId,scope);await issueOemBatch({ ...v, addedBy: currentUser?.name });}
                  if(isCurrent())setLedgerReloadKey(k => k + 1);
                }
                catch (e) { if(isCurrent())alert(`외주 발주 실패: ${(e as Error)?.message ?? String(e)}`); throw e; }
                finally{if(oemIssueScopes.current.get(v.jobId)===scope)oemIssueScopes.current.delete(v.jobId);}
              }}
              onOemCancel={async (po) => {
                await cancelOemIssue(db, companyId, po.id);
                setLedgerReloadKey(k => k + 1);
              }}
              onOemReceive={async (v,intent?:'new'|'resume',expectedActorUid?:string) => {
                const context=await getOemReceiptRecoveryContext(companyId,v.po.id,expectedActorUid);
                const tracker={entered:false,uid:context.scope.actorUid};
                if((v.po.companyId??'taebaek')!==companyId)throw Error('다른 회사의 OEM 입고 요청은 처리하지 않습니다.');
                if(context.entry.legacy)throw Error('과거 입고 요청의 최초 계정과 송신 원문을 확인할 수 없습니다. 배치 입고 이력과 재고를 확인해 주세요.');
                if(context.entry.deleted&&(intent!=='resume'||!context.entry.packet))throw Error('이 배치의 이전 입고 결과가 아직 미확인입니다. 최초 송신 요청으로 배치 입고 결과를 확인해 주세요.');
                oemReceiptSendTracker.current.set(v.po.id,tracker);
                try {
                  if(context.entry.packet){
                    if(intent!=='resume')throw Error('이 배치의 최초 입고 요청이 남아 있습니다. 실패 작업에서 같은 요청의 결과를 확인해 주세요.');
                    tracker.entered=true;
                    await receiveOemFinishedGoodsCommand(context.entry.packet.request,companyId,context.scope.actorUid);
                  }else await receiveOemBatch({ ...v, addedBy: currentUser?.name });
                  if(!context.isCurrent())throw Error('입고 요청의 로그인 계정이 변경되었습니다.');
                  setLedgerReloadKey(k => k + 1);
                } catch (e) {
                  if(!tracker.entered&&context.isCurrent()&&!context.entry.packet&&!readOemReceiptEntry(context.scope).packet)
                    markOemReceiptPreCallFailure(e,context.scope);
                  throw e;
                }finally{if(oemReceiptSendTracker.current.get(v.po.id)===tracker)oemReceiptSendTracker.current.delete(v.po.id);}
              }}
              onOemIssueFee={async (v) => {
                try { await issueOemFeeStatement(v); }
                catch (e) { alert(`가공비 전표 발행 실패: ${(e as Error)?.message ?? String(e)}`); throw e; }
              }}
            />
            </>
          )}
          {showQrLabel && (
            <React.Suspense fallback={null}>
              <QrLabelPrint
                submaterials={submaterials}
                onClose={() => setShowQrLabel(false)}
              />
            </React.Suspense>
          )}
          {/* 생산판매기록부 이력 보기 — 실물 서류와 같은 배치(좌: 생산 기름/깨·가루, 우: 판매).
              2026-08-14 이전 로그는 깨·가루·판매표를 저장하지 않아 그 자리에 안내만 뜬다. */}
          {selectedLog && (() => {
            const seedRows = selectedLog.seedRows ?? [];
            const salesRows = selectedLog.salesRows ?? [];
            const extraRows = selectedLog.extraRows ?? [];
            const isLegacy = !selectedLog.seedRows && !selectedLog.salesRows;
            const cell = 'border border-slate-200 px-2.5 py-1';
            return (
            <LargeModalShell title="생산작업판매일지" onClose={() => setSelectedLog(null)} className="h-[88vh]" bodyClassName="p-0">
                <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100 gap-3">
                  <div className="min-w-0">
                    <span className="text-sm font-black text-slate-700">{selectedLog.date}</span>
                    <span className="ml-2 text-xs text-slate-400">· {selectedLog.createdBy} · 주문 {selectedLog.orderCount}건</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => downloadSalesJournal({
                        date: selectedLog.date,
                        oilRows: selectedLog.productionRows,
                        seedRows, salesRows, extraRows,
                      }, documentOutputSignal())}
                      className="px-3 py-1.5 bg-emerald-500 text-white rounded-xl text-[11px] font-black hover:bg-emerald-600 transition-colors"
                    >엑셀로 저장</button>
                  </div>
                </div>

                {isLegacy && (
                  <div className="mx-6 mt-4 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-700">
                    이 기록은 옛 방식으로 저장돼 깨·가루 표와 판매표(상호·용량·소비기한)가 남아 있지 않습니다. 아래는 저장된 내용만 보여줍니다.
                  </div>
                )}

                <div className="overflow-auto p-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* 좌측 — 생산 */}
                    <div className="space-y-5">
                      <div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">생산 — 기름</div>
                        <table className="w-full text-[11px] border-collapse">
                          <thead>
                            <tr className="bg-slate-50">
                              {['품목(제품명)', '용량', '수량', '소비기한', '비 고'].map(h => (
                                <th key={h} className={`${cell} py-2 font-black text-slate-500 text-center whitespace-nowrap`}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {selectedLog.productionRows.map((r, i) => (
                              <tr key={i} className="hover:bg-blue-50/50">
                                <td className={`${cell} font-bold text-slate-800 ${r.groupLabel ? 'bg-blue-50/40' : ''}`}>{r.groupLabel}</td>
                                <td className={`${cell} text-center text-slate-600`}>{r.spec}</td>
                                <td className={`${cell} text-center font-black ${r.수량 > 0 ? 'text-indigo-700' : 'text-slate-300'}`}>{r.수량}</td>
                                <td className={`${cell} text-center text-slate-500 whitespace-nowrap`}>{r.소비기한}</td>
                                <td className={`${cell} text-slate-500 break-words`}>{r.비고}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">생산 — 참깨·들깨</div>
                        {seedRows.length === 0 ? (
                          <div className="py-6 text-center text-slate-300 text-[11px] border border-dashed border-slate-200 rounded-xl">저장된 내용 없음</div>
                        ) : (
                          <table className="w-full text-[11px] border-collapse">
                            <thead>
                              <tr className="bg-slate-50">
                                {['품목(제품명)', '용량', '수량', '소비기한', '비 고'].map(h => (
                                  <th key={h} className={`${cell} py-2 font-black text-slate-500 text-center whitespace-nowrap`}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {seedRows.map((r, i) => (
                                <tr key={i} className="hover:bg-blue-50/50">
                                  <td className={`${cell} font-bold text-slate-800`}>{r.품목}</td>
                                  <td className={`${cell} text-slate-600`}>{r.용량}</td>
                                  <td className={`${cell} text-center font-black ${r.수량 > 0 ? 'text-indigo-700' : 'text-slate-300'}`}>{r.수량}</td>
                                  <td className={`${cell} text-center text-slate-500 whitespace-nowrap`}>{r.소비기한}</td>
                                  <td className={`${cell} text-slate-500 break-words`}>{r.비고}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>

                    {/* 우측 — 판매 */}
                    <div>
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">판매</div>
                      {salesRows.length > 0 ? (
                        <table className="w-full text-[11px] border-collapse">
                          <thead>
                            <tr className="bg-slate-50">
                              {['상호', '품목', '용량', '수량', '소비기한'].map(h => (
                                <th key={h} className={`${cell} py-2 font-black text-slate-500 text-center whitespace-nowrap`}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {salesRows.map((r, i) => (
                              <tr key={i} className="hover:bg-emerald-50/40">
                                <td className={`${cell} font-bold text-slate-800`}>{r.상호}</td>
                                <td className={`${cell} text-slate-600`}>{r.품목}</td>
                                <td className={`${cell} text-center text-slate-600`}>{r.용량}</td>
                                <td className={`${cell} text-center font-black text-slate-800`}>{r.수량}</td>
                                <td className={`${cell} text-center text-slate-500 whitespace-nowrap`}>{r.소비기한}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        /* 옛 로그 — 거래처별 요약만 남아 있다 */
                        <div className="space-y-1">
                          {selectedLog.orderSummaries.map((s, i) => (
                            <div key={i} className="flex items-start gap-3 px-3 py-2 bg-slate-50 rounded-xl border border-slate-100 text-[11px]">
                              <span className="font-black text-slate-800 w-28 shrink-0">{s.partnerName}</span>
                              <span className="text-slate-500">{s.items.map(it => `${it.name} ${it.qty}개`).join(', ')}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {extraRows.length > 0 && (
                        <div className="mt-5">
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">기타 (템플릿 외 판매분)</div>
                          <table className="w-full text-[11px] border-collapse">
                            <tbody>
                              {extraRows.map((r, i) => (
                                <tr key={i}>
                                  <td className={`${cell} font-bold text-slate-700`}>{r.품목}</td>
                                  <td className={`${cell} text-slate-600`}>{r.용량 || '(미설정)'}</td>
                                  <td className={`${cell} text-center font-black text-slate-800`}>{r.수량}</td>
                                  <td className={`${cell} text-slate-500 break-words`}>{r.거래처}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
            </LargeModalShell>
            );
          })()}
          {/* 거래처 목록도 회사별 — 공용 거래처는 양쪽에 다 뜬다(companyIds 배열) */}
          {currentView === 'partners' && <PartnerManager key={companyId} requestScopeKey={employeeEditRenderUid??''} partners={companyPartners} onUpdateClient={(c) => updateItem('partners', c.id, c)} onAddClient={(c) => addItem('partners', { ...c, companyId }, { partnerRegistration: true })} {...directoryDeleteBindings} />}
          {currentView === 'quotation' && (
            <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
              <QuotationManager
                orderUnitInputs={appData.orderUnitInputs}
                items={companyItems}
                partners={companyPartners}
                partnerItems={partnerItems}
                companyId={companyId}
                companyInfo={companyInfo}
                currentUser={{ id: currentUser.id, name: currentUser.name }}
                /* 원가는 재고평가와 같은 롤업을 쓴다 — 견적에서 본 마진과 실제 마진이 갈리면 안 된다 */
                costOf={inventoryCostOf}
              />
            </React.Suspense>
          )}
          {currentView === 'file-cabinet' && (
            <DocumentManager
              currentUser={{ id: currentUser.id, name: currentUser.name, companyId }}
              seed={[{ category: '서류관리', subCategory: '생산판매기록부' }]}
              /* 같은 자리면 그대로 둔다 — 새 객체를 세우면 렌더가 한 번 더 돈다 */
              onSelect={(cat, sub) => setCabinetSel(p => (p.cat === cat && p.sub === sub ? p : { cat, sub }))}
              /* 서류가 뜨는 자리엔 파일 목록을 안 띄운다 — 아래 서류관리 화면이 그 자리를 쓴다 */
              hideDocs={inCabinetDoc}
            />
          )}
          {currentView === 'notice' && <NoticeBoard posts={noticePosts} companyId={companyId} onAddPost={isAdmin ? (post) => addItem('notices', post) : undefined} onUpdatePost={isAdmin ? (id, patch) => updateItem('notices', id, patch) : undefined} onDeletePost={isAdmin ? (id) => deleteItem('notices', id) : undefined} />}
          {currentView === 'pallets' && (
            <PalletManager
              key={companyId}
              companyId={companyId}
              pallets={pallets}
              orders={allOrders}
              partners={partners}
              palletTransactions={palletTransactions}
              onUpdatePallet={(p) => updateItem('pallets', p.id, p)} 
              onAddPalletTransaction={(t) => addItem('palletTransactions', t)}
            />
          )}
          {currentView === 'hr' && (
            <HRManager
              companyId={companyId}
              requestScopeKey={leaveRenderUid ?? ''}
              cashAccounts={companyCashAccounts}
              employees={employees}
              leaveRequests={leaveRequests}
              onSaveEmployeeEdit={handleEmployeeEdit}
              onReadPendingEmployeeEdits={readPendingEmployeeEdits}
              onInspectEmployeeEdit={handleInspectEmployeeEdit}
              onCancelEmployeeEdit={handleCancelEmployeeEdit}
              onReadEmployeeEditReferences={readEmployeeEditReferences}
              {...directoryDeleteBindings}
              onLeaveAction={handleLeaveAction}
              onReadPendingLeaveActions={readPendingLeaveActions}
              onInspectLeaveAction={handleInspectLeaveAction}
              onCancelLeaveAction={handleCancelLeaveAction}
              onAddLeaveRequests={requests => handleAddLeaveRequests(requests)}
              onReadPendingLeaveGroups={readPendingLeaveGroups}
              onInspectLeaveRequest={handleInspectLeaveRequest}
              onCancelLeaveRequest={handleCancelLeaveRequest}
              onReadLeaveReferences={readLeaveReferences}
              onCancelLeaveReference={handleCancelLeaveReference}
            />
          )}
          {currentView === 'admin-checklist' && (
            <AdminChecklist
              leaveRequests={leaveRequests}
              adjustmentRequests={보이는확인사항}
              employees={employees}
              returnRequests={returnRequests}
              onProcessReturn={handleProcessReturn}
              receivedOrders={receivedOrders.filter(po => po.status === 'received')}
              partners={partners}
              issuedStatements={issuedStatements}
              /*  **여기서 뜻을 뒤집지 않는다**(2026-09-04). 지금 상태를 보고 뒤집으려던
                   코드가 정반대로 썼다 — '취소 승인'은 rejected 로, **'반려'(취소 거절)는
                   cancelled 로** 들어가 연차가 사라졌다. 화면이 바라는 결과를 그대로 준다. */
              onLeaveAction={handleLeaveAction}
              requestScopeKey={companyId+':'+(leaveRenderUid??'')}
              onReadPendingLeaveActions={readPendingLeaveActions}
              onInspectLeaveAction={handleInspectLeaveAction}
              onCancelLeaveAction={handleCancelLeaveAction}
              onReadLeaveReferences={readLeaveReferences}
              onCancelLeaveReference={handleCancelLeaveReference}
              onUpdateAdjustmentStatus={(id, status) => updateItem('adjustmentRequests', id, { status, processedAt: new Date().toISOString() })}
              onDeleteAdjustmentRequest={(id) => deleteItem('adjustmentRequests', id)}
              onProcessAdjustment={async (req) => {
                // 가공비 전표 — OEM 배치에 외주가공비(540) 매입전표 발행
                if (req.type === 'oem_fee') {
                  const po = purchaseOrders.find(p => p.id === (req.oemPoId ?? req.itemId));
                  if (!po) { alert('OEM 배치를 찾을 수 없습니다.'); return; }
                  try { await issueOemFeeStatement({ po, unitPricePerKg: req.oemFeePerKg, date: today() }); }
                  catch (e) { alert(`가공비 전표 발행 실패: ${(e as Error)?.message ?? String(e)}`); return; }
                  await updateItem('adjustmentRequests', req.id, { status: 'processed', processedAt: new Date().toISOString() });
                  alert('가공비 전표를 발행했습니다.');
                  return;
                }
                const product = allItems.find(p => p.id === req.itemId);
                if (req.type === 'quantity_change' && product && req.requestedQuantity !== undefined) {
                  const target = rawLotTarget(allItems, product, product.name, companyId);
                  if (target) {
                    // 원료: 목표수량으로 lot 조정 (stock 직접 X)
                    // 요청 수량은 직원이 화면 단위(기름=L)로 넣은 값 → 저장 단위 kg으로
                    const reqKg = product.density ? req.requestedQuantity * product.density : req.requestedQuantity;
                    const deltaKg = reqKg - lotKgRemaining(product.lots);
                    await adjustRawLots({ companyId, material: target.baseName, rawItemId: target.rawItem.id, deltaKg, date: today(), note: '재고조정', addedBy: currentUser?.name });
                    setLedgerReloadKey(k => k + 1);
                  } else {
                    const result = await stocktakeByQty({
                      companyId, operationId: `stocktake-adjustment-${req.id}`,
                      itemId: product.id,
                      itemName: product.name,
                      targetQty: req.requestedQuantity,
                    });
                    if (!result.ok) { alert(result.message); return; }
                  }
                }
                await updateItem('adjustmentRequests', req.id, { status: 'processed', processedAt: new Date().toISOString() });
              }}
              pendingStatementEdits={pendingStatementEdits}
              onApproveStatementEdit={async (edit) => {
                const original = issuedStatements.find(statement => statement.id === edit.statementId);
                if (!original) throw new Error('원전표를 불러온 뒤 다시 승인해 주세요.');
                await editIssuedStatementCommand(edit.statementId, edit.proposedData,
                  Number((original as IssuedStatement & { mutationRevision?: number }).mutationRevision ?? 0),
                  `approve-${edit.id}`, edit);
              }}
              onRejectStatementEdit={async (id) => {
                await updateItem('pendingStatementEdits', id, { status: 'rejected' });
              }}
              orderRequests={pendingPurchaseOrders}
              items={allItems}
              partnerItems={partnerItems}
              onCreatePurchaseStatement={(data) => {
                setPendingInvoice(data);
                setCurrentView('trade-statement' as ViewType);
              }}
            />
          )}
          {currentView === 'partner-signup' && (
            <PartnerSignupApproval partners={partners} />
          )}
          {(currentView === 'documents' || inCabinetDoc) && (() => {
            // 원료만 있는 출고 주문도 서류 처리 뒤 이력으로 이동해야 한다. 품목 유형 필터는
            // 아래 판매 줄 생성에만 둔다. 예전에는 둘을 묶어 들깨 1000kg 주문이 영원히 남았다.
            const shippedOrders = ordersPendingDocumentClose(orders);

            // 소비기한 계산 헬퍼 (제조일자 + 1년)
            const calcExpiry = (mfgDate: string) => {
              if (!mfgDate) return '';
              const d = new Date(mfgDate);
              d.setDate(d.getDate() + 365);
              return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
            };

            // 우측: 완제품, (상호, 품목, 용량) 기준 그룹화
            type RightRow = { 상호: string; 품목: string; spec: string; 수량: number; 소비기한: string; 제조일자: string; orderItems: Array<{orderId: string; itemIdx: number}>; };
            const rightRowsRaw = shippedOrders.flatMap(order => {
              const partner = partners.find(c => c.id === order.partnerId);
              const partnerName = partner?.name || order.partnerName || '';
              return order.items.flatMap((item, itemIdx) => {
                let product = allItems.find(p => p.id === item.itemId);
                if (!isSalesJournalProduct(product)) return [];
                // 화면·저장·일일점검이 같은 공용 변환을 쓴다. 품목명이 비면 이름으로 대체하고,
                // 박스·선물세트는 실제 완제품 줄로 푼다.
                return journalSaleLines(product, item, id => allItems.find(p => p.id === id), appData.orderUnitInputs, bulkMfgDate || today()).map(row => ({
                  상호: partnerName, 품목: row.품목, 용량: row.spec, 수량: row.qty,
                  소비기한: calcExpiry(item.mfgDate || ''), 제조일자: item.mfgDate || '', orderId: order.id, itemIdx,
                }));
              });
            });
            const rightRows: RightRow[] = Object.values(
              rightRowsRaw.reduce((acc, row) => {
                const key = `${row.상호}||${row.품목}||${row.용량}`;
                if (!acc[key]) {
                  acc[key] = { 상호: row.상호, 품목: row.품목, spec: row.용량, 수량: row.수량, 소비기한: row.소비기한, 제조일자: row.제조일자, orderItems: [{ orderId: row.orderId, itemIdx: row.itemIdx }] };
                } else {
                  acc[key].수량 += row.수량;
                  acc[key].orderItems.push({ orderId: row.orderId, itemIdx: row.itemIdx });
                  if (row.제조일자 && (!acc[key].제조일자 || row.제조일자 < acc[key].제조일자)) {
                    acc[key].제조일자 = row.제조일자;
                    acc[key].소비기한 = calcExpiry(row.제조일자);
                  }
                }
                return acc;
              }, {} as Record<string, RightRow>)
            );

            // (품목, 용량) 집계 - 가장 빠른 제조일자, 거래처 "외 N" 형식
            // 하남댁참기름/들기름 리매핑: 새싹 계열 + 해피유통(00) 300ml 시골향 계열
            const remapSalesPumok = (상호: string, 품목: string, 용량: string): string => {
              if (품목 === '새싹참기름') return '하남댁참기름';
              if (품목 === '새싹들기름') return '하남댁들기름';
              if (상호 === '해피유통(00)' && 품목 === '시골향참기름1' && 용량 === '300ml') return '하남댁참기름';
              if (상호 === '해피유통(00)' && (품목 === '시골향들기름2' || 품목 === '시골향들기름3') && 용량 === '300ml') return '하남댁들기름';
              return 품목;
            };
            const agg: Record<string, { qty: number; mfgDates: string[]; partners: string[] }> = {};
            rightRows.forEach(r => {
              const mappedPumok = remapSalesPumok(r.상호, r.품목, r.spec ?? '');
              const key = `${mappedPumok}||${r.spec}`;
              if (!agg[key]) agg[key] = { qty: 0, mfgDates: [], partners: [] };
              agg[key].qty += r.수량;
              if (r.제조일자) agg[key].mfgDates.push(r.제조일자);
              if (r.상호 && !agg[key].partners.includes(r.상호)) agg[key].partners.push(r.상호);
            });

            // 좌측 하단 템플릿 (참깨/들깨 계열)
            const bottomTemplate: { 품목: string; 용량: string }[] = [
              { 품목: '시골향볶음참깨',    용량: '500g' },
              { 품목: '시골향볶음참깨',    용량: '1kg' },
              { 품목: '시골향들깨가루',    용량: '1kg' },
              { 품목: '시골향들깨가루',    용량: '4kg' },
              { 품목: '시골향들깨가루',    용량: '20kg' },
              { 품목: '시골향탈피들깨가루', 용량: '1kg' },
              { 품목: '시골향볶음검정참깨', 용량: '1kg' },
            ];

            // 좌측 상단 템플릿 — 기본값 유지 + 등록된 완제품에서 추가 자동 반영
            const labelMap: Record<string, string> = {
              '시골향참기름1': '시골향참기름①',
              '시골향참기름2': '시골향참기름②',
              '시골향참기름3': '시골향참기름③',
              '시골향참기름4': '시골향참기름④',
              '시골향들기름1': '시골향들기름①',
              '시골향들기름2': '시골향들기름②',
              '시골향들기름3': '시골향들기름③',
            };
            const pumokOrder = [
              '시골향참기름1','시골향참기름2','시골향참기름3','시골향참기름4',
              '시골향들기름1','시골향들기름2','시골향들기름3',
              '하남댁참기름','하남댁들기름','하남댁맑음들기름',
              '가득찬순참기름',
              '해달참기름','해달들기름',
              '시골집참기름(해내음)',
            ];
            // 기본 템플릿 (품목이 미등록이어도 항상 표시)
            const defaultTopTemplate: { key: string; volumes: string[] }[] = [
              { key: '시골향참기름1', volumes: ['180ml','300ml','350ml','1500ml','1750ml','1800ml','16.5kg'] },
              { key: '시골향참기름2', volumes: ['300ml','350ml','1500ml','1750ml','1800ml'] },
              { key: '시골향참기름3', volumes: ['300ml','350ml','1500ml','1750ml','1800ml','16.5kg'] },
              { key: '시골향참기름4', volumes: ['300ml','350ml','1500ml','1750ml','1800ml'] },
              { key: '시골향들기름1', volumes: ['270ml','350ml','1800ml','16.5kg'] },
              { key: '시골향들기름2', volumes: ['180ml','300ml','350ml','1500ml','1750ml','1800ml'] },
              // 2026-10-14 사장님: 9/28 서류부터 시골향들기름2 품목을 3으로 옮겼다 — ② 바로 아래 같은 칸으로.
              { key: '시골향들기름3', volumes: ['180ml','300ml','350ml','1500ml','1750ml','1800ml'] },
              { key: '하남댁참기름', volumes: ['300ml','1750ml'] },
              { key: '하남댁들기름', volumes: ['300ml','1750ml'] },
              { key: '하남댁맑음들기름', volumes: ['300ml'] },
              { key: '가득찬순참기름', volumes: ['300ml','1800ml'] },
              { key: '해달참기름', volumes: ['350ml'] },
              { key: '해달들기름', volumes: ['350ml'] },
              { key: '시골집참기름(해내음)', volumes: ['1800ml'] },
            ];
            const bottomPumokSet = new Set(bottomTemplate.map(t => t.품목));
            const volumeOrder = ['180ml','270ml','300ml','350ml','500ml','1kg','1500ml','1750ml','1800ml','4kg','16.5kg','20kg','25kg'];
            const sortVolumes = (vols: string[]) => [...vols].sort((a, b) => {
              const ia = volumeOrder.indexOf(a), ib = volumeOrder.indexOf(b);
              if (ia !== -1 && ib !== -1) return ia - ib;
              if (ia !== -1) return -1;
              if (ib !== -1) return 1;
              return a.localeCompare(b);
            });
            // 등록된 완제품에서 기본값에 없는 품목/용량 추가 반영
            const topTemplateMap = new Map<string, Set<string>>(
              defaultTopTemplate.map(t => [t.key, new Set(t.volumes)])
            );
            allItems
              .filter(p => p.type === 'product' && p.품목 && p.spec && !bottomPumokSet.has(p.품목))
              .forEach(p => {
                if (!topTemplateMap.has(p.품목!)) topTemplateMap.set(p.품목!, new Set());
                topTemplateMap.get(p.품목!)!.add(docSpec(p.spec));
              });
            const topTemplate: { label: string; key: string; volumes: string[] }[] = Array.from(topTemplateMap.entries())
              .map(([key, volSet]) => ({ label: labelMap[key] || key, key, volumes: sortVolumes(Array.from(volSet)) }))
              .sort((a, b) => {
                const ia = pumokOrder.indexOf(a.key);
                const ib = pumokOrder.indexOf(b.key);
                if (ia !== -1 && ib !== -1) return ia - ib;
                if (ia !== -1) return -1;
                if (ib !== -1) return 1;
                return 0;
              });

            // 소용량 → 1kg 환산 합산 규칙 (서류 표시용)
            // 예: 시골향볶음참깨 200g 40개 → 8kg → 1kg 행에 8개 추가
            const mergeIntoKg: { 품목: string; 기준용량: string; 소용량: string; 비율: number }[] = [
              { 품목: '시골향볶음참깨',     기준용량: '1kg', 소용량: '200g', 비율: 0.2 },
              { 품목: '시골향볶음참깨',     기준용량: '1kg', 소용량: '350g', 비율: 0.35 },
              { 품목: '시골향탈피들깨가루', 기준용량: '1kg', 소용량: '400g', 비율: 0.4 },
              { 품목: '시골향볶음참깨',     기준용량: '1kg', 소용량: '20kg', 비율: 20 },
              { 품목: '시골향볶음참깨',     기준용량: '1kg', 소용량: '25kg', 비율: 25 },
              { 품목: '시골향들깨가루',     기준용량: '1kg', 소용량: '20kg', 비율: 20 },
              { 품목: '시골향들깨가루',     기준용량: '1kg', 소용량: '25kg', 비율: 25 },
              { 품목: '시골향탈피들깨가루', 기준용량: '1kg', 소용량: '20kg', 비율: 20 },
              { 품목: '시골향탈피들깨가루', 기준용량: '1kg', 소용량: '25kg', 비율: 25 },
              { 품목: '시골향볶음검정참깨', 기준용량: '1kg', 소용량: '20kg', 비율: 20 },
              { 품목: '시골향볶음검정참깨', 기준용량: '1kg', 소용량: '25kg', 비율: 25 },
            ];
            const getBottomQty = (품목: string, 용량: string): number => {
              const base = agg[`${품목}||${용량}`]?.qty ?? 0;
              const extra = mergeIntoKg
                .filter(m => m.품목 === 품목 && m.기준용량 === 용량)
                .reduce((sum, m) => sum + Math.round((agg[`${m.품목}||${m.소용량}`]?.qty ?? 0) * m.비율 * 10) / 10, 0);
              return base + extra;
            };

            // 좌측 rows 생성
            const leftRows: { groupLabel: string; spec: string; 수량: number; 소비기한: string; 비고: string }[] = [];
            topTemplate.forEach(({ label, key, volumes }) => {
              volumes.forEach((vol, i) => {
                const a = agg[`${key}||${vol}`] || { qty: 0, mfgDates: [], partners: [] };
                const earliestMfg = a.mfgDates.length ? [...a.mfgDates].sort()[0] : '';
                const expiryStr = earliestMfg ? calcExpiry(earliestMfg) : '';
                const partnerNote = a.partners.join(', ');
                leftRows.push({ groupLabel: i === 0 ? label : '', spec: vol, 수량: a.qty, 소비기한: expiryStr, 비고: partnerNote });
              });
            });

            // 좌측 하단(깨·가루) rows — 화면·엑셀·저장이 같은 값을 쓴다.
            //  예전엔 이걸 안 만들고 화면과 엑셀이 따로 계산해서, 저장된 이력엔 통째로 빠져 있었다.
            const journalSeedRows = bottomTemplate.map(({ 품목, 용량 }) => {
              const a = agg[`${품목}||${용량}`] || { qty: 0, mfgDates: [], partners: [] };
              const earliestMfg = a.mfgDates.length ? [...a.mfgDates].sort()[0] : '';
              return {
                품목, 용량,
                수량: getBottomQty(품목, 용량),
                소비기한: earliestMfg ? calcExpiry(earliestMfg) : '',
                비고: a.partners.join(', '),
              };
            });

            // 좌측(상단 템플릿 + 하단 참깨·들깨 + 소용량 환산) 어디에도 매칭 안 되는 판매분 → 하단 '기타'로 표기(누락 방지)
            const matchedKeys = new Set<string>([
              ...topTemplate.flatMap(t => t.volumes.map(v => `${t.key}||${v}`)),
              ...bottomTemplate.map(t => `${t.품목}||${t.용량}`),
              ...mergeIntoKg.map(m => `${m.품목}||${m.소용량}`),
            ]);
            const extraSalesRows = Object.entries(agg)
              .filter(([k, a]) => a.qty > 0 && !matchedKeys.has(k))
              .map(([k, a]) => { const [품목, 용량] = k.split('||'); return { 품목, 용량, qty: a.qty, 거래처: a.partners.join(', ') }; })
              .sort((a, b) => a.품목.localeCompare(b.품목) || a.용량.localeCompare(b.용량));

            // 제조일자 미입력 완제품 체크
            const missingMfgDate = shippedOrders.flatMap(o =>
              o.items.filter(item => {
                const p = allItems.find(pr => pr.id === item.itemId);
                return holdsUnitStock(p) && !item.mfgDate;
              }).map(item => item.name)
            );

            const finishSalesOutput = async (session: {artifact:WorkbookOutputArtifact;logId:string;logPayload:Record<string,unknown>;journal:SalesJournalData;orders:{id:string;partnerName:string}[];progress:SalesJournalProgress},signal:AbortSignal) => {
              const result=await completeSalesJournalOutput({progress:session.progress,signal,
                writeLog:()=>addItem('productionSalesLogs',session.logPayload),
                verifyLog:async()=>{const snap=await getDocFromServer(doc(db,'productionSalesLogs',session.logId));return snap.exists()&&salesJournalLogMatches(session.logPayload,snap.data());},
                saveFile:()=>saveSalesJournalArtifact(session.artifact,`생산작업판매일지_${session.journal.date}.xlsx`,signal),
                closeOrders:async()=>{
              const deductFailures: string[] = [];
              for (const o of session.orders) {
                try {
                  // **여기서 고른 날짜(docDate)가 네 서류의 공통 기준일이다.**
                  //   deliveredAt에 그 날짜를 박으면 원료수불부·작업기록부 1·2가 같은 날에 잡힌다(docDateOf).
                  //   시각은 언제나 00:00:00.000Z — '처리한 순간'이 아니라 '어느 날짜 서류에 실렸나'를 담는다.
                  //   상태·재고·로트·수불부와 같은 작업 단위의 마지막 주문 패치에서 함께 저장한다.
                  //   예전엔 새벽에 뽑으면 서류는 8/10인데 deliveredAt은 8/11로 찍혀 하루씩 갈렸다.
                  await changeOrderStatus(o.id, OrderStatus.DELIVERED, undefined, {
                    approvedBy: currentUser?.name,
                    orderPatch: { deliveredAt: `${session.journal.date}T00:00:00.000Z` },
                  });
                } catch (e) {
                  console.error(`[주문 이력 이동] 재고 조정 실패 (주문 ${o.id}, ${o.partnerName}):`, e);
                  deductFailures.push(o.partnerName || o.id);
                }
              }

                  if(deductFailures.length)throw Error('일부 주문의 이력 이동 결과를 확인해 주세요.');
                }});
              if(signal.aborted)return;
              if(result==='log-unknown')alert('판매일지 저장 결과를 확인하지 못했습니다. 같은 요청 번호로 서버 기록을 다시 확인합니다. 새 기록을 만들지 않습니다.');
              if(result==='orders-pending')alert('판매일지는 저장되었지만 일부 주문의 이력 이동 결과를 확인해야 합니다. 해당 주문 상태를 확인해 주세요. 자동으로 다시 전환하지 않습니다.');
            };
                        const exportExcel = async () => {
              if(salesOutputBusy.current)return;const signal=documentOutputSignal();if(signal.aborted)return;
              const actorUid=auth.currentUser?.uid;if(!actorUid)return;const key=companyId+':'+actorUid;
              salesOutputBusy.current=true;
              try{
                const prior=salesOutputSessions.current.get(key);
                if(prior){
                  if(!prior.progress.done){await finishSalesOutput(prior,signal);return;}
                  if(JSON.stringify(prior.orders.map(o=>o.id))===JSON.stringify(shippedOrders.map(o=>o.id))){await previewPreparedWorkbookOutput({artifact:prior.artifact,fileName:`생산작업판매일지_${prior.journal.date}.xlsx`,signal});return;}
                  salesOutputSessions.current.delete(key);
                }
              const docDate = bulkMfgDate || today();
              const farOrders = ordersFarFromJournalDate(shippedOrders, docDate);
              if (farOrders.length > 0) {
                const examples = farOrders.slice(0, 5).map(o =>
                  `${o.partnerName || o.cardNo} · 주문 ${o.orderDate} → 서류 ${docDate} (${o.days}일 차이)`).join('\n');
                const proceed = await appConfirm(
                  `선택한 서류 날짜가 주문 생성일과 7일 넘게 다른 주문이 ${farOrders.length}건 있습니다.\n\n${examples}${farOrders.length > 5 ? `\n외 ${farOrders.length - 5}건` : ''}\n\n이 날짜로 판매일지를 저장할까요?`,
                );
                if (!proceed) return;
              }
              if (missingMfgDate.length > 0) {
                const proceed = await appConfirm(
                  `제조일자가 입력되지 않은 품목이 있습니다:\n${[...new Set(missingMfgDate)].join(', ')}\n\n계속 저장하시겠습니까?`
                );
                if (!proceed) return;
              }
              // 양식은 shared/salesJournal.ts 한 곳에만 둔다 — 이력 보기의 [엑셀로 저장]도 같은 함수를 쓴다.
              const journal = {
                date: docDate,
                oilRows: leftRows,
                seedRows: journalSeedRows,
                salesRows: rightRows.map(r => ({ 상호: r.상호, 품목: r.품목, 용량: r.spec, 수량: r.수량, 소비기한: r.소비기한 })),
                extraRows: extraSalesRows.map(r => ({ 품목: r.품목, 용량: r.용량, 수량: r.qty, 거래처: r.거래처 })),
              };

                const snapshot=JSON.parse(JSON.stringify(journal)) as SalesJournalData;
                const orderSnapshot=JSON.parse(JSON.stringify(shippedOrders)) as typeof shippedOrders;
                const artifact=await prepareSalesJournal(snapshot);if(signal.aborted)return;
                if(!await confirmWorkbookOutput({artifact,fileName:`생산작업판매일지_${docDate}.xlsx`,signal})||signal.aborted)return;
                const logId=`psl-${crypto.randomUUID()}`;
                const logPayload={id:logId,companyId,date:docDate,createdAt:new Date().toISOString(),createdBy:currentUser.name,orderCount:orderSnapshot.length,productionRows:snapshot.oilRows,seedRows:snapshot.seedRows,salesRows:snapshot.salesRows,extraRows:snapshot.extraRows,orderSummaries:orderSnapshot.map(o=>({partnerName:o.partnerName,items:o.items.map(i=>({name:i.name,qty:i.quantity??1}))}))};
                const session={artifact,logId,logPayload,journal:snapshot,orders:orderSnapshot.map(o=>({id:o.id,partnerName:o.partnerName})),progress:newSalesJournalProgress()};
                salesOutputSessions.current.set(key,session);await finishSalesOutput(session,signal);
              }catch(error){if(!signal.aborted)alert(error instanceof Error?error.message:'출력을 준비하지 못했습니다. 다시 시도해 주세요.');}finally{salesOutputBusy.current=false;}
            };

            return (
              <div className="space-y-5 animate-in slide-in-from-right-4 duration-500">
                <div className="flex flex-col gap-4">
                  {/* 문서함에서 열었으면 머리는 문서함이 이미 달았다 — 두 번 적지 않는다 */}
                  <div className={`${inCabinetDoc ? 'hidden' : 'hidden md:flex'} items-center justify-between pb-3 md:pb-4 border-b border-slate-200`}>
                    <div>
                      <h2 className="text-base md:text-lg font-black text-slate-800 leading-tight truncate">서류 관리</h2>
                      <p className="text-[11px] md:text-xs text-slate-400 mt-0.5 truncate">생산·원료·작업 관련 서류를 조회하세요.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className={`flex-wrap gap-1 bg-white p-1 rounded-2xl border border-slate-200 shadow-sm ${inCabinetDoc ? 'hidden' : 'flex'}`}>
                      {/*
                        서류는 **보는 사람 쪽에 둔다**(2026-09-01 사장님 지시).
                          직원뷰  생산판매기록부 · HACCP · 벤조피렌 · 원료수불부 · 생산작업기록부 — 현장에서 적고 보는 것
                          관리자뷰 거래명세서만 — 나머지는 직원뷰나 문서함에 있다
                          문서함  생산판매기록부 (서류관리 › 생산판매기록부) — **관리자가 보는 쪽**
                        생산작업기록부2는 안 쓰기로 해서 통째로 걷어냈다.

                        **생산판매기록부 탭은 직원뷰에 있어야 한다.** 그 자리를 문서함으로 옮기면서(b14e808)
                        탭 단추를 지웠는데 **직원뷰 화면(`docTab === '생산판매기록부' && !isAdmin`)은 그대로 남았다.**
                        문서함은 관리자 전용(`adminOnlyViews`)이라 직원은 그 화면에 닿을 길이 없어졌다 —
                        처음 켰을 때 기본값이라 잠깐 보이다가, 다른 탭을 한 번 누르면 영영 못 돌아왔다.
                        관리자뷰 문서함을 다녀오면 `docTab`이 바뀌어 다시 보이던 게 그 때문이다.
                      */}
                      {!isAdmin && (<>
                        <button
                          onClick={() => setDocTab('생산판매기록부')}
                          className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold transition-all ${docTab === '생산판매기록부' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                        >생산판매기록부</button>
                        <button
                          onClick={() => setDocTab('haccp')}
                          className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold transition-all ${docTab === 'haccp' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                        >HACCP 체크리스트</button>
                        <button
                          onClick={() => setDocTab('벤조피렌')}
                          className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold transition-all ${docTab === '벤조피렌' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                        >벤조피렌 검사성적서</button>
                        <button
                          onClick={() => setDocTab('원료수불부')}
                          className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold transition-all ${docTab === '원료수불부' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                        >원료수불부</button>

                        <button onClick={() => setDocTab('생산작업일지')} className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold ${docTab === '생산작업일지' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-50'}`}>생산작업일지</button>
                      </>)}
                    </div>
                    {/* 판매기록부 ↔ 원료수불부 대조 — 서류 기준일이 배송완료일 하나뿐이라,
                        비어 있으면 그 주문의 모든 줄이 네 서류에서 통째로 빠진다.
                        조용히 빠지면 못 찾으니 서류 화면 맨 위에서 드러낸다. */}
                    {(() => {
                      const drops = findDocDrops(allOrders as never[]);
                      if (drops.length === 0) return null;
                      const orderCount = new Set(drops.map(d => `${d.partnerName}|${d.itemName}`)).size;
                      return (
                        <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 px-4 py-3">
                          <p className="text-xs font-black text-rose-700">
                            서류에서 빠지는 판매 {drops.length}줄 — 배송완료일이 없습니다
                          </p>
                          <div className="mt-1.5 space-y-0.5 max-h-32 overflow-y-auto">
                            {drops.slice(0, 12).map((d, i) => (
                              <p key={i} className="text-[11px] font-bold text-rose-600">
                                {d.partnerName} · {d.itemName} <span className="text-rose-400">{d.qty}</span>
                              </p>
                            ))}
                            {drops.length > 12 && <p className="text-[11px] font-bold text-rose-400">외 {drops.length - 12}줄</p>}
                          </div>
                          <p className="text-[10px] text-rose-400 mt-1.5">
                            판매기록부·원료수불부·생산작업기록부 1·2 전부에 안 잡힙니다({orderCount}품목).
                            해당 주문을 배송완료로 다시 처리하면 그 날짜로 들어갑니다.
                          </p>
                        </div>
                      );
                    })()}
                    {docTab === '생산판매기록부' && !inCabinetDoc && (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-3 py-1.5 shadow-sm">
                          <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">서류 날짜</span>
                          <input
                            type="date"
                            value={bulkMfgDate}
                            onChange={e => {
                              setBulkMfgDate(e.target.value);
                              if (e.target.value) setDocYearMonth(e.target.value.slice(0, 7));
                            }}
                            className="text-xs font-bold text-slate-700 bg-transparent outline-none cursor-pointer"
                          />
                        </div>
                        {/*
                          **저장은 문서함에서만 감춘다.**
                          2026-09-01(7d6d889)에 "엑셀 저장 없애라"는 지시를 통째로 지우는 걸로 잘못 읽어
                          단추 자체를 걷어냈다. 사장님 뜻은 **문서함에 뜨는 것**을 없애라는 것이었다
                          (2026-09-03 확인). 그래서 직원뷰에서는 그날 서류를 저장할 길이 없어졌다.

                          이 단추는 두 가지를 같이 한다 — 엑셀 파일 내려받기 + `productionSalesLogs` 기록.
                          기록이 없으면 관리자 문서함에 그날 서류가 안 쌓인다.
                          **서류관리 메뉴에서는 이름 그대로 '엑셀 저장'이다**(2026-09-03 사장님).
                        */}
                        <button
                          onClick={exportExcel}
                          className="flex items-center space-x-2 bg-emerald-600 text-white px-5 py-2.5 rounded-2xl font-bold shadow hover:bg-emerald-700 transition-all text-sm"
                        >
                          <FileText size={16} />
                          <span>엑셀 저장</span>
                        </button>
                      </div>
                    )}

                  </div>
                </div>


                {docTab === '생산판매기록부' && isAdmin && (() => {
                  const allLogs = [...mergedProductionSalesLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
                  const logs = allLogs.filter(log => (log.date ?? '').slice(0, 7) === docLogMonth);
                  return (
                    <div className="space-y-3">
                        <span className="text-xs font-black text-slate-500 uppercase tracking-widest">생산판매기록부 이력 ({logs.length}건)</span>
                        <QueryFilterPanel ariaLabel="생산판매기록부 검색조건" onReset={() => markDocLogMonth(new Date().toISOString().slice(0,7))} dateRow={<>
<div className={QUERY_FILTER_DATE_CLASS}><span>조회 월</span><div className={DATE_RANGE_LAYOUT_CLASS}>
                          <input type="month" value={docLogMonth} onChange={e => markDocLogMonth(e.target.value)} aria-label="생산판매기록부 조회 월" className={QUERY_FILTER_CONTROL_CLASS + ' w-36 max-w-full'} /><span className="flex items-center gap-2"><button onClick={() => { const d = new Date(docLogMonth + '-01'); d.setMonth(d.getMonth() - 1); markDocLogMonth(d.toISOString().slice(0, 7)); }} className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 text-slate-500">‹</button><button onClick={() => { const d = new Date(docLogMonth + '-01'); d.setMonth(d.getMonth() + 1); markDocLogMonth(d.toISOString().slice(0, 7)); }} className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 text-slate-500">›</button></span>
                        </div></div>
</>} />
                      {logs.length === 0 ? (
                        <div className="py-16 text-center text-slate-300 text-sm">저장된 기록이 없습니다</div>
                      ) : (
                        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-slate-50">
                              <tr>
                                {['날짜', '작성자', '주문 수', '저장 일시', ''].map(h => (
                                  <th key={h} className="px-4 py-3 text-left font-black text-slate-500">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {logs.map(log => (
                                <tr key={log.id} className="hover:bg-slate-50">
                                  <td className="px-4 py-3 font-black text-slate-800">{log.date}</td>
                                  <td className="px-4 py-3 text-slate-600">{log.createdBy}</td>
                                  <td className="px-4 py-3 text-slate-600">{log.orderCount}건</td>
                                  <td className="px-4 py-3 text-slate-400 font-mono text-[11px]">{new Date(log.createdAt).toLocaleString('ko-KR')}</td>
                                  <td className="px-4 py-3"><button onClick={() => setSelectedLog(log)} className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-black hover:bg-indigo-100 transition-colors">보기</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {docTab === '생산판매기록부' && !isAdmin && (
                  <div className="space-y-4">

                    {/* 상단: 생산 내역(좌) + 판매 내역(우) */}
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
                      {(() => {
                        return (
                        <table className="text-xs border-collapse min-w-[900px] w-full">
                          <thead>
                            <tr>
                              <th colSpan={5} className="px-3 py-2.5 text-center text-[10px] font-black text-slate-500 bg-blue-50 border border-slate-200">생산 내역</th>
                              <th className="w-3 bg-slate-100 border-y border-slate-200" />
                              <th colSpan={6} className="px-3 py-2.5 text-center text-[10px] font-black text-slate-500 bg-indigo-50 border border-slate-200">판매 내역</th>
                            </tr>
                            <tr className="bg-slate-50">
                              {['품목(제품명)','용량','수량','소비기한','비고'].map(h => (
                                <th key={h} className="px-3 py-2 text-center text-[9px] font-black text-slate-400 uppercase border border-slate-200 whitespace-nowrap">{h}</th>
                              ))}
                              <th className="w-3 bg-slate-100 border-y border-slate-200" />
                              {['상호','품목','용량','수량','제조일자','소비기한'].map(h => (
                                <th key={h} className="px-3 py-2 text-center text-[9px] font-black text-slate-400 uppercase border border-slate-200 whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {Array.from({ length: Math.max(leftRows.length, rightRows.length) }).map((_, i) => {
                              const l = leftRows[i];
                              const r = rightRows[i];
                              const hasIssue = r && (!r.품목 || !r.spec || !r.제조일자);
                              return (
                                <tr key={i} className={`transition-colors ${hasIssue ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-slate-50/50'}`}>
                                  {/* 좌측 */}
                                  <td className={`px-3 py-1.5 border border-slate-200 font-bold whitespace-nowrap ${l?.groupLabel ? 'bg-blue-50 text-slate-800' : 'text-slate-400'}`}>{l?.groupLabel ?? ''}</td>
                                  <td className="px-3 py-1.5 border border-slate-200 text-center text-slate-600">{l?.spec ?? ''}</td>
                                  <td className={`px-3 py-1.5 border border-slate-200 text-center font-black ${l && l.수량 > 0 ? 'text-indigo-700' : 'text-slate-300'}`}>{l ? (l.수량 || 0) : ''}</td>
                                  <td className="px-3 py-1.5 border border-slate-200 text-center text-slate-500 whitespace-nowrap">{l?.소비기한 ?? ''}</td>
                                  <td className="px-3 py-1.5 border border-slate-200 text-slate-500 text-[10px] break-words max-w-[160px]">{l?.비고 ?? ''}</td>
                                  {/* 구분 */}
                                  <td className="w-3 bg-slate-100 border-y border-slate-200" />
                                  {/* 우측 */}
                                  <td className="px-3 py-1.5 border border-slate-200 font-bold text-slate-800 whitespace-nowrap">{r?.상호 ?? ''}</td>
                                  <td className="px-3 py-1.5 border border-slate-200 text-slate-700">{r?.품목 ?? ''}</td>
                                  <td className="px-3 py-1.5 border border-slate-200 text-center text-slate-600">{r?.spec ?? ''}</td>
                                  <td className={`px-3 py-1.5 border border-slate-200 text-center font-black ${r && r.수량 > 0 ? 'text-indigo-700' : 'text-slate-300'}`}>{r?.수량 ?? ''}</td>
                                  <td className="px-2 py-1 border border-slate-200">
                                    {r && (
                                      <input
                                        type="date"
                                        value={r.제조일자}
                                        onChange={(e) => {
                                          for (const { orderId, itemIdx } of r.orderItems) {
                                            const o = orders.find(ord => ord.id === orderId);
                                            if (!o) continue;
                                            const newItems = [...o.items];
                                            newItems[itemIdx] = { ...newItems[itemIdx], mfgDate: e.target.value };
                                            updateItem('orders', orderId, { items: newItems });
                                          }
                                        }}
                                        className="text-[10px] font-bold text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-0.5 cursor-pointer outline-none focus:ring-1 focus:ring-indigo-400 w-28"
                                      />
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 border border-slate-200 text-center text-slate-500 whitespace-nowrap">{r?.소비기한 ?? ''}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        );
                      })()}
                    </div>

                    {/* 하단: 참깨/들깨 계열 */}
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
                      <table className="text-xs border-collapse min-w-[500px] w-full">
                        <thead>
                          <tr>
                            <th colSpan={5} className="px-3 py-2.5 text-center text-[10px] font-black text-slate-500 bg-blue-50 border border-slate-200">생산 내역 (참깨·들깨)</th>
                          </tr>
                          <tr className="bg-slate-50">
                            {['품목(제품명)','용량','수량','소비기한','비고'].map(h => (
                              <th key={h} className="px-3 py-2 text-center text-[9px] font-black text-slate-400 uppercase border border-slate-200 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {bottomTemplate.map(({ 품목, 용량 }) => {
                            const a = agg[`${품목}||${용량}`] || { qty: 0, mfgDates: [], partners: [] };
                            const earliestMfg = a.mfgDates.length ? [...a.mfgDates].sort()[0] : '';
                            const expiryStr = earliestMfg ? calcExpiry(earliestMfg) : '';
                            const partnerNote = a.partners.join(', ');
                            const displayQty = getBottomQty(품목, 용량);
                            return (
                              <tr key={`${품목}${용량}`} className="hover:bg-slate-50/50">
                                <td className="px-3 py-1.5 border border-slate-200 font-bold text-slate-800">{품목}</td>
                                <td className="px-3 py-1.5 border border-slate-200 text-center text-slate-600">{용량}</td>
                                <td className={`px-3 py-1.5 border border-slate-200 text-center font-black ${displayQty > 0 ? 'text-indigo-700' : 'text-slate-300'}`}>{displayQty}</td>
                                <td className="px-3 py-1.5 border border-slate-200 text-center text-slate-500 whitespace-nowrap">{expiryStr}</td>
                                <td className="px-3 py-1.5 border border-slate-200 text-slate-500 text-[10px] break-words max-w-[160px]">{partnerNote}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* 기타 — 좌측 템플릿에 없는 판매분(용량 미설정 등). 누락 방지용. */}
                    {extraSalesRows.length > 0 && (
                      <div className="bg-white rounded-2xl border border-amber-200 overflow-x-auto">
                        <table className="text-xs border-collapse min-w-[500px] w-full">
                          <thead>
                            <tr>
                              <th colSpan={4} className="px-3 py-2.5 text-center text-[10px] font-black text-amber-700 bg-amber-50 border border-slate-200">기타 (좌측 템플릿에 없는 판매분 — 용량 미설정 등)</th>
                            </tr>
                            <tr className="bg-slate-50">
                              {['품목(제품명)', '용량', '수량', '거래처'].map(h => (
                                <th key={h} className="px-3 py-2 text-center text-[9px] font-black text-slate-400 uppercase border border-slate-200 whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {extraSalesRows.map((r, i) => (
                              <tr key={i} className="hover:bg-amber-50/50">
                                <td className="px-3 py-1.5 border border-slate-200 font-bold text-slate-800">{r.품목}</td>
                                <td className={`px-3 py-1.5 border border-slate-200 text-center ${r.용량 ? 'text-slate-600' : 'text-amber-500'}`}>{r.용량 || '(미설정)'}</td>
                                <td className="px-3 py-1.5 border border-slate-200 text-center font-black text-indigo-700">{r.qty}</td>
                                <td className="px-3 py-1.5 border border-slate-200 text-slate-500 text-[10px] break-words max-w-[200px]">{r.거래처}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {docTab === 'haccp' && (
                  <React.Suspense fallback={<div className="py-20 text-center text-slate-400">로딩 중...</div>}>
                    <HaccpChecklist companyId={companyId} currentUser={{ id: currentUser.id, name: currentUser.name }} isAdmin={isAdmin} />
                  </React.Suspense>
                )}

                {docTab === '벤조피렌' && (
                  <React.Suspense fallback={<div className="py-20 text-center text-slate-400">로딩 중...</div>}>
                    <BenzopyreneLog
                      companyId={companyId}
                      currentUserName={currentUser?.name}
                      isAdmin={isAdmin}
                    />
                  </React.Suspense>
                )}

                {docTab === '원료수불부' && (() => {
                  //  addedBy·orderId 를 여기서 떨어뜨리면 서류에도 '누가·어디'가 영영 안 뜬다
                  //  (2026-09-07 사장님: "원료수불부도 그렇고"). 원장 줄이 들고 온 것을 그대로 나른다.
                  type UsageRow = { date: string; received: number; used: number; note: string; type: 'auto' | 'manual' | 'correction'; id?: string; createdAt?: string; targetKg?: number; addedBy?: string; orderId?: string; material?: string; source?: unknown; reportedDeltaKg?: number; appliedDeltaKg?: number; replacement?: 'replace'|'keep'|'unconfirmed'; excluded?: boolean };
                  //  자동 줄이 어느 주문 때문인지 푸는 표. 원료 11개를 도는 엑셀 저장에서도 한 번만 만든다.
                  const orderById = orderIndex(allOrders);

                  // 수율: 원재료 사용 → 반제품 입고 자동 파생 (규칙은 yieldRules = item_formula 데이터)
                  const calcDerivedReceived = (material: string): UsageRow[] =>
                    derivedRawDocEntries(material, companyId, mergedRawMaterialLedger, yieldRules);

                  // 수불부에서만 합쳐 보는 원료. 실제 품목·재고·로트는 절대 합치지 않는다.
                  const RM_TABS = rawDocTabs(RM_LIST);
                  // 수불부 행 계산 — DB 데이터만 사용 (auto/manual/correction 모두 포함)
                  // 옛 데이터(unit==='L')는 표시 시점에 ×density 환산 → 모두 kg 단위로 통일
                  // ── 원료수불부(서류) 한 장 만들기 ── ⚠ 원장(rawMaterialLedger)과 다른 것이다.
                  //   사용량   : 배합표 원료(DOC_RECALC_RAWS)는 판매에서 되계산 — 원장의 rm-auto는 뺀다
                  //   입고     : 원장 그대로
                  //   실사     : **재고 화면 실사(rm-stocktake-)는 서류에 안 넣는다** — 아래 필터 참고
                  //   전월이월  : 원장의 전월말 누적
                  //   자세한 구분은 src/shared/docOil.ts 맨 위 주석 참고.
                  const buildRawDocSheet = (material: string) => {
                    const density = DENSITY[material] ?? 1.0;
                    const dbEntries: UsageRow[] = mergedRawMaterialLedger
                      .filter(e => rawDocMaterials(material).includes(e.material))
                      // 재고 화면 실사는 서류로 넘기지 않는다. 창고 재고를 실물에 맞춘 기록이지 수불 사실이 아니다.
                      //   특히 targetKg가 서류 잔량을 앵커해버려서, 관청에 내는 수불부가 창고 실사에 끌려다녔다.
                      //   (참깨 8월: 실사 줄이 서류 입고로 1,990kg 새어 들어와 있었다)
                      //   서류 쪽 정정이 필요하면 원료수불부 화면에서 따로 넣는다 — 재고 정정과 서류 정정은 별개다.
                      .filter(e => !/^rm-stocktake-/.test(e.id ?? ''))
                      .map(e => {
                        const evidence = e as RawDocLedgerRecord;
                        const isLegacyL = e.unit === 'L' && density !== 1.0;
                        const received = isLegacyL ? Math.round(e.received * density * 1000) / 1000 : e.received;
                        const used     = isLegacyL ? Math.round(e.used     * density * 1000) / 1000 : e.used;
                        return { date: e.date, received, used, note: e.note, type: (e.type || 'manual') as UsageRow['type'], id: e.id, createdAt: e.createdAt, targetKg: e.targetKg, addedBy: e.addedBy, orderId: e.orderId, material: e.material, source: evidence.source, reportedDeltaKg: evidence.reportedDeltaKg, appliedDeltaKg: evidence.appliedDeltaKg, replacement:rawDocProductionReplacement(evidence,mergedRawMaterialLedger,companyId) };
                      });
                    const derivedEntries = calcDerivedReceived(material);
                    // 같은 날짜 안에서는 기록 시각 순 — 실사(targetKg 앵커)와 당일 입출고의 순서가 잔량에 영향
                    const allEntries = [...dbEntries, ...derivedEntries].sort((a, b) =>
                      a.date === b.date ? (a.createdAt ?? '').localeCompare(b.createdAt ?? '') : a.date.localeCompare(b.date));
                    // 재고정정·실사정정(legacy) = 서류상 입고·사용도 아니고 잔량 이동도 아님(표시만).
                    //  rm-zero-/rm-stocktake- id 또는 note가 '재고정정'/'재고실사정정'으로 시작하는 것.
                    //  (targetKg 실사앵커, 정정UI(type=correction), 실제 주문사용은 제외 아님)
                    const isLegacyCorr = (e: UsageRow) =>
                      /^rm-(zero|stocktake)-/.test(e.id ?? '') || /^재고정정|^재고실사정정/.test(e.note ?? '');
                    // 잔량 누적: 재고실사정정(targetKg)은 잔량을 실사 절대값으로 리셋(앵커) —
                    // 과거 장부 오차·이중계상이 있어도 실사 이후 잔량은 실물 기준으로 맞는다
                    const applyRow = (bal: number, e: UsageRow) =>
                      e.targetKg != null ? e.targetKg
                      : isLegacyCorr(e) ? bal          // 재고정정/실사정정 legacy — 잔량 이동 안 함
                      : Math.round((bal + e.received - e.used) * 1000) / 1000;
                    // 전월이월 = 등급 원장(실물) 누적 → '전월말 재고'(월별 앵커). 원료수불부는 여기서 시작한다
                    //  (재고=원장=등급이라 전월말 잔량은 실물과 맞는다. 전기간 품목 재계산 불필요 = 월마다 끊김)
                    const prevBalance = allEntries
                      .filter(e => e.date < `${docYearMonth}-01`)
                      .reduce(applyRow, 0);
                    // 당월 행 — 등급 발산 원료(통깨/깨분)만 **품목** 재계산으로 대체, 나머지는 원장 그대로(회귀 없음).
                    //  통깨/깨분은 원장이 등급으로 빠지므로(rm-auto-) 그걸 빼고 oilOutflowByDate(품목)로 넣는다.
                    //  → 원료수불부(서류)=품목, 원장·재고=등급 분리. 입고·실사는 원장 그대로.
                    //  들기름도 같은 취급 — 재고는 반제품 '들기름'(8:2)로 통일했지만
                    //  서류는 품목별 배합(시골향들기름1=통들깨 100 …)으로 나눠야 한다.
                    //  배합표에 나오는 원료는 전부 판매에서 되계산한다 — 그래야 판매기록부와 같은 날·같은 양이 된다.
                    //  (원장 자동차감은 생산처리 시점에 찍혀 날짜가 다르다. 입고·실사는 원장 그대로 쓴다)
                    const isGradeMat = DOC_RECALC_RAWS.has(material);
                    const monthEntries: UsageRow[] = [
                      ...allEntries.filter(e => e.date.startsWith(docYearMonth) && !(isGradeMat && (e.id ?? '').startsWith('rm-auto-') && e.used > 0)).map(e=>isGradeMat&&e.replacement==='replace'?{...e,received:0,used:0,excluded:true}:e),
                      ...(isGradeMat
                        ? Object.entries(oilOutflowByDate)
                            .filter(([ds]) => ds.startsWith(docYearMonth))
                            .map(([ds, v]) => ({ date: ds, received: 0, used: v[material as '통깨참기름' | '깨분참기름'] ?? 0, note: '생산(서류)', type: 'auto' as const, id: `oil-${material}-${ds}`, createdAt: ds }))
                            .filter(e => e.used > 0)
                        : []),
                    ].sort((a, b) => a.date === b.date ? (a.createdAt ?? '').localeCompare(b.createdAt ?? '') : a.date.localeCompare(b.date));
                    let balance = prevBalance;
                    const r3 = (n: number) => Math.round(n * 1000) / 1000;
                    const groups = new Map<string, { date: string; received: number; used: number; adj: number; prevBalance: number; currentBalance: number; notes: string[]; who: Set<string>; wheres: Set<string>; types: Set<string>; delIds: string[]; usage: RawDocUsageContribution[] }>();
                    // 같은 날이라도 **정정을 만나면 줄을 끊는다.**
                    //   정정 전 입고·사용과 정정 후 입고·사용이 한 줄에 섞이면 무엇이 정정 대상이었는지 알 수 없다.
                    //   → [정정 전 묶음] [정정 줄] [정정 후 묶음] 순으로 따로 남는다.
                    let seg = 0;
                    let segDate = '';
                    for (const e of monthEntries) {
                      const prev = balance;
                      balance = applyRow(balance, e);
                      const isCorrCol = e.type === 'correction' || isLegacyCorr(e);
                      if (e.date !== segDate) { segDate = e.date; seg = 0; }
                      const key = isCorrCol ? `${e.date}#adj${seg}` : `${e.date}#${seg}`;
                      let g = groups.get(key);
                      if (!g) { g = { date: e.date, received: 0, used: 0, adj: 0, prevBalance: prev, currentBalance: balance, notes: [], who: new Set(), wheres: new Set(), types: new Set(), delIds: [], usage: [] }; groups.set(key, g); }
                      if (!isCorrCol) {
                        g.received = r3(g.received + e.received);
                        g.used = r3(g.used + e.used);
                        if (e.excluded) g.usage.push({kind:'excluded',itemName:e.material??material,rawKg:0,sources:[],recordId:e.id,material:e.material,source:e.source,note:e.note,orderId:e.orderId,reportedDeltaKg:e.reportedDeltaKg,appliedDeltaKg:e.appliedDeltaKg});
                        if (e.used !== 0 || e.replacement === 'unconfirmed') {
                          if (e.id === `oil-${material}-${e.date}`) g.usage.push(...(oilUsageDetail.contributions[e.date]?.[material] ?? []));
                          else g.usage.push({kind:'ledger',itemName:e.material ?? material,rawKg:e.used,sources:[],recordId:e.id,material:e.material,source:e.source,note:e.note,orderId:e.orderId,reportedDeltaKg:e.reportedDeltaKg,appliedDeltaKg:e.appliedDeltaKg,unconfirmed:e.replacement==='unconfirmed'});
                        }
                      } else {
                        // 정정·실사는 입고·사용이 아니다 — '정정' 칸에 실제 잔량 변화량으로 남긴다
                        const target = (e as { targetKg?: number }).targetKg;
                        g.adj = r3(g.adj + (target != null ? balance - prev : e.received - e.used));
                      }
                      g.currentBalance = balance;           // 그 묶음 마지막 잔량
                      //  누가·어디는 재고 원장 화면(RawLedgerList)과 **같은 함수**가 푼다
                      const tr = ledgerTrace(e, orderById, linesUsingRaw);
                      if (tr.note) g.notes.push(tr.note);
                      if (e.replacement === 'unconfirmed') g.notes.push('취소 원본 미확인 — 상세에서 확인');
                      if (tr.who) g.who.add(tr.who);
                      if (tr.where) g.wheres.add(tr.where);
                      g.types.add(isCorrCol ? 'correction' : e.type);
                      if (e.id && e.type !== 'auto') g.delIds.push(e.id);   // 수동/정정만 삭제 대상
                      if (isCorrCol) seg++;                 // 정정 뒤부터는 새 묶음
                    }
                    const rows = Array.from(groups.entries()).map(([key, g]) => ({
                      date: g.date,
                      usage: [...g.usage, ...(Math.abs(Math.round(g.used)-g.usage.reduce((sum,entry)=>sum+entry.rawKg,0))>1e-9?[{kind:'rounding' as const,itemName:'표시 반올림 조정',rawKg:Math.round(g.used)-g.usage.reduce((sum,entry)=>sum+entry.rawKg,0),sources:[]}]:[])],
                      received: Math.round(g.received),
                      used: Math.round(g.used),
                      adj: Math.round(g.adj),
                      prevBalance: Math.round(g.prevBalance),
                      currentBalance: Math.round(g.currentBalance),
                      note: Array.from(new Set(g.notes)).join(', '),
                      who: Array.from(g.who).join(', '),
                      where: Array.from(g.wheres).join(', '),
                      type: (g.types.has('correction') ? 'correction' : g.types.has('manual') ? 'manual' : 'auto') as UsageRow['type'],
                      id: key,                                             // 정정 UI 앵커 · React key (날짜+묶음)
                      delId: g.delIds.length === 1 ? g.delIds[0] : undefined, // 그날 삭제가능 항목이 딱 하나일 때만 삭제 노출
                    }));
                    // 전월이월 = 전달 마지막 현재고(월별 앵커), 당월 총 입고·사용 = 합계행
                    const opening = Math.round(prevBalance);
                    const closing = rows.length > 0 ? rows[rows.length - 1].currentBalance : opening;
                    const totalIn = rows.reduce((s, r) => s + r.received, 0);
                    const totalOut = rows.reduce((s, r) => s + r.used, 0);
                    const totalAdj = rows.reduce((s, r) => s + r.adj, 0);
                    return { rows, opening, closing, totalIn, totalOut, totalAdj };
                  };

                  // 원료수불부 Excel 저장
                  const exportRmExcel = async () => {
                    const signal=documentOutputSignal();if(signal.aborted)return;
                    await downloadRawLedgerExcel(RM_TABS.map(material=>({material,sheet:buildRawDocSheet(material)})),docYearMonth,signal);
                  };

                  const activeLedger = buildRawDocSheet(rmActiveMaterial);

                  return (
                    <div className="space-y-4">
                      {rawUsageDetail && rawUsageDetail.companyId === companyId && rawUsageDetail.month === docYearMonth && rawUsageDetail.material === rmActiveMaterial && <RawDocUsageDetailModal detail={rawUsageDetail} onClose={() => setRawUsageDetail(null)} />}
                      <QueryFilterPanel ariaLabel="원료수불부 검색조건" onReset={() => setDocYearMonth(new Date().toISOString().slice(0,7))} dateRow={<>
<label className={QUERY_FILTER_FIELD_CLASS}>조회 월
                          <input type="month" aria-label="원료수불부 조회 월" value={docYearMonth} onChange={e => setDocYearMonth(e.target.value)} className={QUERY_FILTER_CONTROL_CLASS}/>
                        </label>
</>} />
                      {/* 헤더 */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-400 font-bold">※ 환산: 참기름류 0.916kg/L, 들기름류 0.924kg/L (고정)</span>
                        </div>
                        <button onClick={exportRmExcel}
                          className="flex items-center space-x-2 bg-emerald-600 text-white px-5 py-2.5 rounded-2xl font-bold shadow hover:bg-emerald-700 transition-all text-sm">
                          <FileText size={16} /><span>엑셀 저장 (11시트)</span>
                        </button>
                      </div>
                      {/* 원료 탭 */}
                      <div className="flex flex-wrap gap-1.5">
                        {RM_TABS.map(m => (
                          <button key={m} onClick={() => setRmActiveMaterial(m)}
                            className={`px-3 py-1.5 rounded-xl text-[11px] font-black transition-all border ${rmActiveMaterial === m ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                            {rawDocTabLabel(m)}
                          </button>
                        ))}
                      </div>
                      {/* 테이블 — 칸이 아홉이라 폰에서는 옆으로 민다(table.ts 규칙). 칸을 감추지 않는다. */}
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full min-w-[900px] text-left">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100">
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">날짜</th>
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase text-right">전재고(kg)</th>
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase text-right">입고량(kg)</th>
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase text-right">사용량(kg)</th>
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase text-right">정정(kg)</th>
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase text-right">현재고(kg)</th>
                              {/*  '누가'는 서류(엑셀)에는 안 넣는다 — 관청 양식에 없는 칸이다.
                                   화면에서만 보여준다. 되짚을 때 물어볼 사람을 아는 게 목적이다. */}
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">누가</th>
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">비고</th>
                              <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {/* 전월이월 — 매달 1일, 전달 마지막 현재고를 전재고로 (거래 없어도 항상 표시) */}
                            <tr className="bg-slate-50/70">
                              <td className="px-4 py-2.5 text-[11px] font-bold text-slate-500">{docYearMonth}-01<span className="ml-1 text-[9px] text-slate-400 font-black">전월이월</span></td>
                              <td className="px-4 py-2.5 text-[11px] text-slate-400 text-right">{activeLedger.opening}</td>
                              <td className="px-4 py-2.5 text-[11px] text-slate-300 text-right">-</td>
                              <td className="px-4 py-2.5 text-[11px] text-slate-300 text-right">-</td>
                              <td className="px-4 py-2.5 text-[11px] text-slate-300 text-right">-</td>
                              <td className="px-4 py-2.5 text-[11px] font-black text-slate-700 text-right">{activeLedger.opening}</td>
                              <td className="px-4 py-2.5 text-[11px] text-slate-300">—</td>
                              <td className="px-4 py-2.5 text-[11px] text-slate-400">전월 말 현재고</td>
                              <td className="px-3 py-2.5"></td>
                            </tr>
                            {activeLedger.rows.map((row, i) => (
                              <React.Fragment key={row.id || i}>
                                <tr className={`hover:bg-slate-50 transition-colors ${row.type === 'correction' ? 'bg-amber-50/40' : row.type === 'auto' ? 'bg-blue-50/30' : ''}`}>
                                  <td className="px-4 py-2.5 text-[11px] font-bold text-slate-600">
                                    {row.date}
                                    {row.type === 'auto' && <span className="ml-1 text-[9px] text-blue-400 font-black">자동</span>}
                                    {row.type === 'correction' && <span className="ml-1 text-[9px] text-amber-500 font-black">정정</span>}
                                  </td>
                                  <td className="px-4 py-2.5 text-[11px] text-slate-500 text-right">{row.prevBalance}</td>
                                  <td className="px-4 py-2.5 text-[11px] font-black text-indigo-600 text-right">{row.received > 0 ? `+${row.received}` : '-'}</td>
                                  <td className="px-4 py-2.5 text-[11px] font-black text-rose-500 text-right">{row.used !== 0 || row.usage.length > 0 ? <button type="button" className="underline underline-offset-2" aria-label={`${row.date} ${rmActiveMaterial} 사용량 상세`} onClick={() => setRawUsageDetail({companyId,month:docYearMonth,material:rmActiveMaterial,date:row.date,segment:row.id,total:row.used,contributions:row.usage})}>{row.used > 0 ? `-${row.used}` : row.used < 0 ? `+${Math.abs(row.used)}` : '0'}</button> : '-'}</td>
                                  <td className="px-4 py-2.5 text-[11px] font-black text-amber-600 text-right">{row.adj !== 0 ? (row.adj > 0 ? `+${row.adj}` : `${row.adj}`) : '-'}</td>
                                  <td className="px-4 py-2.5 text-[11px] font-black text-slate-800 text-right">{row.currentBalance}</td>
                                  <td className={`px-4 py-2.5 text-[11px] font-bold ${row.who ? 'text-slate-600' : 'text-slate-300'}`}>{row.who || '—'}</td>
                                  <td className="px-4 py-2.5 text-[11px] text-slate-500">
                                    {row.where && <span className="font-bold text-slate-600">{rawDocNoteSummary(row.where)}</span>}
                                    {row.where && row.note ? <span className="mx-1 text-slate-300">·</span> : null}
                                    {rawDocNoteSummary(row.note) || (row.where ? '' : '-')}
                                  </td>
                                  <td className="px-3 py-2.5 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      {row.id && (
                                        <button
                                          onClick={() => { setRmCorrectionTargetId(rmCorrectionTargetId === row.id ? null : row.id!); setRmCorrectionForm({ date: today(), amount: '', isNegative: true, note: '' }); }}
                                          className="px-2 py-1 rounded-lg text-[10px] font-black bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                                        >정정</button>
                                      )}
                                      {row.delId && (
                                        <button
                                          onClick={async () => {
                                            //  **원장은 지우지 않고 취소 이력을 뒤에 쌓는다**(설계 §9).
                                            //  같은 취소가 두 번 눌려도 `ReversalGuard` 가 막는다.
                                            if (!await appConfirm('이 기록을 취소할까요? (지우지 않고 뒤에 취소 줄이 쌓입니다)')) return;
                                            await cancelRawLedgerEntry(row.delId!);
                                          }}
                                          className="px-2 py-1 rounded-lg text-[10px] font-black bg-slate-100 text-slate-400 hover:bg-rose-100 hover:text-rose-500 transition-colors"
                                        >취소</button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                                {rmCorrectionTargetId === row.id && (
                                  <tr className="bg-amber-50 border-t border-amber-200">
                                    <td colSpan={9} className="px-4 py-3">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-[11px] font-black text-amber-700">정정 추가</span>
                                        <input type="date" value={rmCorrectionForm.date}
                                          onChange={e => setRmCorrectionForm(f => ({ ...f, date: e.target.value }))}
                                          className="border border-amber-300 rounded-lg px-2 py-1 text-[11px] outline-none focus:border-amber-500" />
                                        {/* 실사 = 잔량을 실물 값으로 그대로 리셋(앵커). 과거 장부 오차를 따지지 않고 끊는다.
                                            수불부 전용 — 재고·로트는 안 건드린다(재고관리 화면에서 따로 맞춘다). */}
                                        <select value={rmCorrectionForm.mode ?? (rmCorrectionForm.isNegative ? 'neg' : 'pos')}
                                          onChange={e => setRmCorrectionForm(f => ({ ...f, mode: e.target.value as 'neg'|'pos'|'stocktake', isNegative: e.target.value !== 'pos' }))}
                                          className="border border-amber-300 rounded-lg px-2 py-1 text-[11px] outline-none focus:border-amber-500">
                                          <option value="neg">사용량 감소 (−)</option>
                                          <option value="pos">사용량 증가 (+)</option>
                                          <option value="stocktake">실사 — 잔량을 이 값으로</option>
                                        </select>
                                        <input type="number" min="0" step="0.001"
                                          placeholder={rmCorrectionForm.mode === 'stocktake' ? `실사 잔량(${unitOf(rmActiveMaterial)})` : `수량(${unitOf(rmActiveMaterial)})`}
                                          value={rmCorrectionForm.amount}
                                          onChange={e => setRmCorrectionForm(f => ({ ...f, amount: e.target.value }))}
                                          className="border border-amber-300 rounded-lg px-2 py-1 text-[11px] w-24 outline-none focus:border-amber-500" />
                                        <input type="text" placeholder="비고" value={rmCorrectionForm.note}
                                          onChange={e => setRmCorrectionForm(f => ({ ...f, note: e.target.value }))}
                                          className="border border-amber-300 rounded-lg px-2 py-1 text-[11px] flex-1 min-w-32 outline-none focus:border-amber-500" />
                                        <button
                                          onClick={async () => {
                                            const amt = parseFloat(rmCorrectionForm.amount);
                                            if (!amt || amt <= 0) return;
                                            // L 입력은 kg으로 환산해서 저장 (수불부 canonical 단위)
                                            const inputUnit = unitOf(rmActiveMaterial);
                                            const density = DENSITY[rmActiveMaterial] ?? 1.0;
                                            const amtKg = inputUnit === 'L' ? Math.round(amt * density * 1000) / 1000 : amt;
                                            const isStocktake = rmCorrectionForm.mode === 'stocktake';
                                            const correctionUsed = rmCorrectionForm.isNegative ? -amtKg : amtKg;
                                            const inputTag = inputUnit === 'L' ? ` · 사용자 입력: ${amt}L` : '';
                                            const baseNote = rmCorrectionForm.note
                                              || (isStocktake ? '수불부 실사정정' : `정정 (원본: ${row.id})`);
                                            /**
                                             * **정정·실사 — 로트와 원장을 한 트랜잭션에 넣는다**(설계 §6, 이관 5단계).
                                             *
                                             * 예전엔 원장 줄을 먼저 쓰고 `mutateRawMaterialLots` 로 로트를 따로 맞췄다.
                                             * 뒤가 실패하면 원장만 남았다. 이제 둘이 같이 성공하거나 같이 실패한다.
                                             *
                                             * 소급 판정(앵커보다 앞선 날짜)도 명령 안에서 한다 — 화면이 든 배열이 아니라
                                             * **트랜잭션에서 읽은 상태**의 실사 정보로 본다(§10).
                                             */
                                            const 정정홀더 = rawHolderByName(allItems, rmActiveMaterial, companyId);
                                            if (!정정홀더) { alert(`원료 홀더를 못 찾았다: ${rmActiveMaterial}`); return; }
                                            const opId = isStocktake ? `rm-stocktake-${Date.now()}` : `rm-corr-${Date.now()}`;
                                            const 공통정정 = {
                                              operationId: opId,
                                              ...rawLedgerKeys(정정홀더),
                                              materialSnapshot: rmActiveMaterial,
                                              effectiveAt: isStocktake
                                                ? new Date().toISOString()
                                                : (rmCorrectionForm.date === today() ? new Date().toISOString() : `${rmCorrectionForm.date}T12:00:00+09:00`),
                                              ...(currentUser?.name ? { actorName: currentUser.name } : {}),
                                            };
                                            const 정정옛칸 = {
                                              note: baseNote + inputTag,
                                              type: 'correction' as const,
                                              ...(currentUser?.name ? { addedBy: currentUser.name } : {}),
                                              originalAmount: amt,
                                              originalUnit: inputUnit as 'kg' | 'L',
                                            };
                                            //  실사는 목표 절대값으로 맞추는 앵커, 정정은 그 수량만큼 증감(used 양수 = 재고 감소).
                                            const 정정명령 = isStocktake
                                              ? { ...공통정정, source: { type: 'stocktake' as const, id: opId }, kind: 'stocktake' as const, targetKg: amtKg }
                                              : correctionUsed > 0
                                                ? { ...공통정정, source: { type: 'adjustment' as const, id: opId }, kind: 'consume' as const, kg: correctionUsed }
                                                : { ...공통정정, source: { type: 'adjustment' as const, id: opId }, kind: 'receive' as const, kg: -correctionUsed, lot: { supplierName: '정정', qtyIn: 0 } };
                                            const cr = await executeRawInventoryCommand(정정명령, {
                                              newLotId: `lot-${opId}`, carryOverLotId: `carry-${opId}`, legacy: 정정옛칸,
                                            });
                                            if (cr.status === 'rejected') { alert(`정정 실패 — ${cr.message}`); return; }
                                            if (cr.status === 'conflict') { alert('정정 실패 — 같은 작업 번호로 다른 내용이 이미 저장돼 있습니다.'); return; }
                                            if (cr.status === 'applied' && cr.movement.backdatedBeforeStocktake) {
                                              await awaitNotice('마지막 실사보다 앞선 날짜라 원장에만 남기고 재고·로트는 그대로 둡니다.');
                                            }
                                            setRmCorrectionTargetId(null);
                                            setLedgerReloadKey(k => k + 1);
                                          }}
                                          className="px-3 py-1 rounded-lg text-[11px] font-black bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                                        >저장</button>
                                        <button onClick={() => setRmCorrectionTargetId(null)}
                                          className="px-3 py-1 rounded-lg text-[11px] font-black bg-slate-200 text-slate-500 hover:bg-slate-300 transition-colors"
                                        >취소</button>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                            {/* 합계 — 당월 총 입고·사용 */}
                            <tr className="bg-slate-100 border-t-2 border-slate-200">
                              <td className="px-4 py-2.5 text-[11px] font-black text-slate-600">합계</td>
                              <td className="px-4 py-2.5 text-[11px] text-slate-300 text-right">-</td>
                              <td className="px-4 py-2.5 text-[11px] font-black text-indigo-600 text-right">{activeLedger.totalIn > 0 ? `+${activeLedger.totalIn}` : '-'}</td>
                              <td className="px-4 py-2.5 text-[11px] font-black text-rose-500 text-right">{activeLedger.totalOut !== 0 ? `-${activeLedger.totalOut}` : '-'}</td>
                              <td className="px-4 py-2.5 text-[11px] font-black text-amber-600 text-right">{activeLedger.totalAdj !== 0 ? (activeLedger.totalAdj > 0 ? `+${activeLedger.totalAdj}` : `${activeLedger.totalAdj}`) : '-'}</td>
                              <td className="px-4 py-2.5 text-[11px] font-black text-slate-800 text-right">{activeLedger.closing}</td>
                              <td className="px-4 py-2.5 text-[11px] text-slate-300">—</td>
                              <td className="px-4 py-2.5 text-[11px] text-slate-400 font-bold">당월 총 입고·사용</td>
                              <td className="px-3 py-2.5"></td>
                            </tr>
                          </tbody>
                        </table>
                        </div>
                      </div>
                    </div>
                  );
                })()}


                {docTab === '생산작업일지' && <div className="space-y-4">
                  <label className="text-sm font-bold">작성일 <input aria-label="생산작업일지 작성일" type="date" value={productionDocumentDate} disabled={productionDocumentScope.current.busy} onChange={event => { void changeProductionDocumentDate(event.target.value); }} className="rounded-lg border p-2" /></label>
                  <ProductionWorkDocumentHost key={productionDocumentKey} companyId={companyId} date={productionDocumentDate} actorId={currentUser.id} onStateChange={reportProductionDocumentState} />
                </div>}



              </div>
            );
          })()}
          {(currentView === 'trade-statement' || showInboundInvoice || inboundDetailId) && (
            <TradeStatement
              employees={employees}
              orderUnitInputs={appData.orderUnitInputs}
              detailStatementId={inboundDetailId}
              onDetailClose={() => setInboundDetailId('')}
              returnOperations={appData.returnAllocationsLoaded ? appData.returnAllocationOperations : undefined}
                  advanceStatements={appData.advanceStatements}
              currentUserId={currentUser.id}
              composerOnly={currentView !== 'trade-statement'}
              onComposerClose={() => { setShowInboundInvoice(false); setPendingInvoice(null); }}
              orders={allOrders}
              allItems={allItems}
              partners={partners}
              partnerItems={partnerItems}
              accountCodes={appData.accountCodes}
              accountGroups={appData.accountGroups}
              cashAccounts={companyCashAccounts}
              cashEntries={companyCashEntries}
              settlements={appData.settlements}
              onAddCashEntry={(e) => addCashEntry(e)}
              onIssueCashEntry={(entry) => issueNumberedCashEntry({ ...entry, companyId, createdBy: entry.createdBy ?? currentUser?.name })}
              onUpdateCashEntry={updateCash}
              onMatchCashAllocations={(entry, allocations) => matchCashAllocations(companyId, entry, allocations)}
              onResumeCashMutation={(id) => resumeCashMutation(companyId, id)}
              onUpdateSettlement={async (id, data) => {
                const row = appData.settlements.find(value => value.id === id);
                const cash = row && appData.cashEntries.find(value => value.id === row.cashEntryId);
                if (!row || !cash || !cash.partnerId || companyOf(cash) !== companyId)
                  throw new Error('수정할 같은 회사의 정산·자금 내역을 확인해 주세요.');
                await mutateManualSettlement(companyId, { action: 'update', partnerId: cash.partnerId,
                  cashEntryId: row.cashEntryId, statementId: row.statementId, settlementId: row.id,
                  amount: Number(data.amount), expectedAmount: row.amount });
              }}
              onDeleteCashEntry={deleteCashEntry}
              onAddCashAccount={(a) => createCashAccountWithOpening(companyId, { ...a, companyId })}
              onUpdateCashAccount={(id, data) => updateItem('cashAccounts', id, data)}
              fixedCostTemplates={companyTemplates}
              onGenerateRecurringCosts={generateRecurringCosts}
              onAddFixedCostTemplate={async (data) => { await addItem('fixedCostTemplates', { ...data, companyId, id: `fct-${Date.now()}` }); refreshStaticData(); }}
              onUpdateFixedCostTemplate={async (id, data) => { await updateItem('fixedCostTemplates', id, data); refreshStaticData(); }}
              onDeleteFixedCostTemplate={async (id) => { await deleteItem('fixedCostTemplates', id); refreshStaticData(); }}
              expensePresets={appData.expensePresets}
              onAddExpensePreset={async (p) => { const id = await addItem('expensePresets', { ...p, id: `exp-${Date.now()}`, createdAt: new Date().toISOString() }); refreshStaticData(); return id as string; }}
              onDeleteExpensePreset={(id) => { deleteItem('expensePresets', id); refreshStaticData(); }}
              issuedStatements={issuedStatements}
              onUpdateStatus={(id, status) => requestOrderStatus(id, status)}
              {...partnerTermsBindings}
              onUpdateOrder={(id, data) => updateItem('orders', id, data)}
              companyId={companyId}
              onAddIssuedStatement={(stmt) => issueNumberedStatement({ ...stmt, companyId, createdBy: stmt.createdBy ?? currentUser?.name })}
              /*  **전표 한 장을 한 덩이로 저장한다**(설계 §2, 3단계).
                  전에는 화면이 넷을 차례로 저장했다 — 전표 본문 → 거래처 단가·품목 원가 →
                  주문 발행표시 → 발주카드. 앞이 되고 뒤가 엎어지면 **주문에 발행표시가 안 찍혀
                  그 주문이 목록에 다시 뜨고, 다시 누르면 전표가 두 장** 나갔다.
                  이제 하나라도 실패하면 전부 안 들어간다. 두 번째 클릭은 `duplicate` 로 돌아온다.

                  발주카드 번호·id 는 여기서만 지을 수 있어(회사·기존 카드 목록이 필요하다)
                  계획을 세우는 것도 여기서 한다. 화면은 무엇을 팔았는지만 넘긴다. */
              onApplyStatement={async ({ command, statement, costUpdates, poIds, newPoItems }) => {
                const newPo = newPoItems.length ? {
                  id: `po-${command.statementId}`,
                  cardNo: nextPoNo(today(), purchaseOrders),
                  items: newPoItems,
                } : undefined;
                const 결과 = await issueTradeStatementCommand({
                  operationId: command.operationId,
                  statement: { ...statement, companyId, createdBy: statement.createdBy ?? currentUser?.name },
                  orderIds: command.orderIds, poIds, newPo,
                  costUpdates: costUpdates.map(c => ({
                    ...c, beforeCost: c.beforeCost ?? 0, sourceLineIndex: c.sourceLineIndex ?? -1,
                  })),
                });

                /*  **커밋 뒤** — 장부가 아니라 장부에서 다시 셀 수 있는 것만 한다.
                    원가 되말기는 언제 다시 돌려도 같은 답이라, 여기서 엎어져도 전표·주문은 짝이 맞다. */
                if (결과.status === 'applied' && costUpdates.length) {
                  const 바뀐원가 = new Map(costUpdates.map(c => [c.itemId, c.price]));
                  try {
                    await recomputeAllCosts(allItems.map(i => (바뀐원가.has(i.id) ? { ...i, cost: 바뀐원가.get(i.id)! } : i)));
                  } catch (error) {
                    console.error('전표 발행 후 품목 원가 재계산 실패', error);
                    alert(`전표 ${statement.docNo} 발행은 완료됐지만 품목 원가 재계산에 실패했습니다. 전표를 다시 발행하지 말고 원가를 확인해 주세요.`);
                  }
                }
                return 결과;
              }}
              onUpdateIssuedStatement={updateStatement}
              focusDocNo={focusDocNo}
              onFocusHandled={() => setFocusDocNo('')}
              onProposeEdit={(id, data, stmtType, docNo, partnerName) => {
                const stmt = issuedStatements.find(s => s.id === id);
                addItem('pendingStatementEdits', {
                  id: `pse-${Date.now()}`,
                  statementId: id,
                  statementDocNo: docNo,
                  statementType: stmtType,
                  partnerName,
                  proposedData: data,
                  createdAt: new Date().toISOString(),
                  createdBy: currentUser.name,
                  status: 'pending',
                });
              }}
              onDeleteIssuedStatement={async (id) => { await deleteIssuedStatement(companyId, id); refreshStaticData(); }}
              pendingInvoice={pendingInvoice}
              onClearPendingInvoice={() => setPendingInvoice(null)}
              purchaseUnitOrders={purchaseOrders.filter(po => companyOf(po) === companyId)}
              confirmedOrders={invoicedPurchaseOrders}
              orderRequests={pendingPurchaseOrders}
              onAddConfirmedOrder={async (item) => {
                const existing = purchaseOrders.find(po => po.id === item.id);
                if (existing) {
                  await updateItem('purchaseOrders', item.id, {
                    status: 'invoiced', quantity: item.quantity,
                    invoicedAt: new Date().toISOString(),
                    ...(item.partnerId ? { partnerId: item.partnerId, partnerName: item.partnerName } : {}),
                  });
                } else {
                  const product = allItems.find(p => p.id === item.id);
                  await executeEmployeeCommand({ kind: 'create', collection: 'purchaseOrders', data: {
                    id: item.id, cardNo: nextPoNo(today(), purchaseOrders), itemId: item.id, itemName: product?.name ?? '',
                    //  수량은 재고 단위 그대로 — 박스 표기는 담을 때 이미 풀렸다
                    quantity: item.quantity,
                    partnerId: item.partnerId, partnerName: item.partnerName,
                    status: 'invoiced', createdAt: new Date().toISOString(),
                    invoicedAt: new Date().toISOString(),
                  } });
                }
              }}
              onRemoveConfirmedOrder={handleRemoveConfirmedOrder}
              onRemoveOrderRequest={handleRemoveOrderRequest}
              companyInfo={companyInfo}
              onSaveCompanyInfo={info => setDocument(
                'settings',
                companySettingDocId(companyId, 'company'),
                companySettingPatch(companyId, { ...info }),
              )}
              onUpdateItemCost={(itemId, cost) => cascadeItemCost(itemId, cost)}
            />
          )}
          {currentView === 'tax-statement' && (
            <TaxStatement
              companyId={companyId}
              issuedStatements={issuedStatements}
              partners={partners}
              companyInfo={companyInfo}
              onApplyTaxIssue={async input => {
                return applyTaxIssueWrites({ ...input, companyId });
              }}
            />
          )}
          {(currentView === 'profit-analysis' || currentView === 'cost-management') && (
            <div className="h-full overflow-y-auto">
              <ProfitAnalysis
                returnOperations={appData.returnAllocationsLoaded ? appData.returnAllocationOperations : undefined}
                  advanceStatements={appData.advanceStatements}
                  companyId={companyId}
                issuedStatements={issuedStatements}
                fixedCostTemplates={companyTemplates}
                onAddTemplate={async (data) => { await addItem('fixedCostTemplates', { ...data, companyId, id: `fct-${Date.now()}` }); refreshStaticData(); }}
                onUpdateTemplate={async (id, data) => { await updateItem('fixedCostTemplates', id, data); refreshStaticData(); }}
                onDeleteTemplate={async (id) => { await deleteItem('fixedCostTemplates', id); refreshStaticData(); }}
                partners={partners}
                items={allItems}
                costOf={inventoryCostOf}
                onUpdateIssuedStatement={updateStatement}
                accountGroups={appData.accountGroups}
                accountCodes={appData.accountCodes}
                onUpdateAccountCode={updateProfitAccountCode}
                onAddAccountCode={createProfitAccountCode}
                onDeleteAccountCode={removeProfitAccountCode}
                onAddAccountGroup={createProfitAccountGroup}
                onUpdateAccountGroup={updateProfitAccountGroup}
                onDeleteAccountGroup={removeProfitAccountGroup}
                onReadAccountOperations={readProfitAccountOperations}
                onInspectAccountOperation={inspectProfitAccountOperation}
                onRetryAccountOperation={retryProfitAccountOperation}
                onCancelAccountOperation={cancelProfitAccountOperation}
                onDiscardAccountOperationCopy={discardProfitAccountOperationCopy}
                inventorySnapshots={companySnapshots}
                /* 회사를 안 박으면 풍회 기말재고가 **태백 것을 덮어쓴다** — id에도 회사가 들어가야 한다 */
                onSaveInventorySnapshot={async (data) => { await addItem('inventorySnapshots', { ...data, companyId, id: invSnapDocId(companyId, data.yearMonth) }); }}
                onGenerateRecurringCosts={generateRecurringCosts}
                cashEntries={companyCashEntries}
                settlements={appData.settlements}
              />
            </div>
          )}
          {currentView === 'partner-stats' && (
            <div className="h-full overflow-y-auto">
              <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
                <ProfitAnalysis
                  returnOperations={appData.returnAllocationsLoaded ? appData.returnAllocationOperations : undefined}
                  advanceStatements={appData.advanceStatements}
                  companyId={companyId}
                  initialTab="partners"
                  issuedStatements={issuedStatements}
                  fixedCostTemplates={companyTemplates}
                  partners={partners}
                  items={allItems}
                  costOf={inventoryCostOf}
                  onUpdateIssuedStatement={updateStatement}
                  accountGroups={appData.accountGroups}
                  accountCodes={appData.accountCodes}
                  inventorySnapshots={companySnapshots}
                  cashEntries={companyCashEntries}
                  onAddCashEntry={(e) => addCashEntry(e)}
                  settlements={appData.settlements}
                />
              </React.Suspense>
            </div>
          )}
          {currentView === 'item-ledger' && (
            <div className="h-auto lg:h-full flex flex-col lg:overflow-hidden">
              <PageHeader title="제품별원장" subtitle="품목별 기초·입고·생산·사용·출고·실사 기록" />
              <div className="flex-1 min-h-0 p-6">
                <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
              {!appData.returnOperationsLoaded ? <div className="p-4 text-slate-500">반품 원장을 확인하고 있습니다.</div> : <ItemLedger companyId={companyId} items={companyItems} orders={allOrders} receipts={appData.itemReceipts} rawEntries={mergedRawMaterialLedger} orderUnitInputs={appData.orderUnitInputs} returnOperations={appData.returnOperations} />}
                </React.Suspense>
              </div>
            </div>
          )}
          {currentView === 'ledger-cash' && (
            <div className="h-full overflow-y-auto">
              {/* 탭을 없앴다 — 메뉴에서 현금출납장·거래처원장을 각각 여는데 화면 안에 또 탭이
                  있으면 같은 일을 두 군데서 하게 된다. 어디를 눌러 왔는지도 헷갈린다.
                  제목이 곧 어느 장부인지 말한다. */}
              <PageHeader
                title={ledgerTab === 'cash' ? '현금출납장' : '거래처원장'}
                subtitle={ledgerTab === 'cash'
                  ? '통장·카드·현금의 실제 입출금과 잔액'
                  : '거래처별 채권·채무와 결제 내역'}
              />
              <div className="p-6">
                <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
                  {ledgerTab === 'partner' ? (
                    <PartnerLedger key={companyId}
                      partners={partners}
                      accountGroups={appData.accountGroups}
                      fixedCostTemplates={companyTemplates}
                      onAddCashEntry={addCashEntry}
                      onIssueCashEntry={addCashEntry}
                      onAddIssuedStatement={stmt => issueNumberedStatement({ ...stmt, companyId, createdBy: stmt.createdBy ?? currentUser?.name })}
                      onAddFixedCostTemplate={async data => { await addItem('fixedCostTemplates', { ...data, companyId, id: `fct-${Date.now()}` }); refreshStaticData(); }}
                      returnOperations={appData.returnAllocationsLoaded ? appData.returnAllocationOperations : undefined}
                  advanceStatements={appData.advanceStatements}
                      companyId={companyId}
                      issuedStatements={issuedStatements}
                      cashEntries={companyCashEntries}
                      cashAccounts={companyCashAccounts}
                      accountCodes={appData.accountCodes}
                      onOpenVoucher={(_id, docNo) => { setFocusDocNo(docNo); setCurrentView('trade-statement'); }}
                      settlements={appData.settlements}
                    />
                  ) : (
                  <CashLedger
              returnOperations={appData.returnAllocationsLoaded ? appData.returnAllocationOperations : undefined}
              advanceStatements={appData.advanceStatements}
                    companyId={companyId}
                    cashAccounts={companyCashAccounts}
                    cashEntries={companyCashEntries}
                    accountCodes={appData.accountCodes}
                    fixedCostTemplates={companyTemplates}
                    partners={partners}
                    issuedStatements={issuedStatements}
                    settlements={appData.settlements}
                    currentUser={currentUser}
                    onAddCashAccount={(a) => createCashAccountWithOpening(companyId, { ...a, companyId })}
                    onUpdateCashAccount={async (id, data) => {
                      await updateItem('cashAccounts', id, data);
                      refreshStaticData();
                    }}
                    onCorrectCashAccount={async (original, name, date, targetCurrentBalance) => {
                      await updateCashAccountOpening(companyId, original, name, date, targetCurrentBalance);
                      refreshStaticData();
                    }}
                    onAddCashEntry={(e) => issueNumberedCashEntry({ ...e, companyId, createdBy: e.createdBy ?? currentUser?.name })}
                    onDeleteCashEntry={deleteCashEntry}
                    onAddSettlement={(x) => {
                      const cash = appData.cashEntries.find(value => value.id === x.cashEntryId);
                      if (!cash?.partnerId || companyOf(cash) !== companyId)
                        throw new Error('같은 회사의 자금 내역과 거래처를 확인해 주세요.');
                      return mutateManualSettlement(companyId, { action: 'add', partnerId: cash.partnerId,
                        cashEntryId: x.cashEntryId, statementId: x.statementId, amount: x.amount });
                    }}
                    onDeleteSettlement={(id) => {
                      const row = appData.settlements.find(value => value.id === id);
                      const cash = row && appData.cashEntries.find(value => value.id === row.cashEntryId);
                      if (!row || !cash?.partnerId || companyOf(cash) !== companyId)
                        throw new Error('삭제할 같은 회사의 정산·자금 내역을 확인해 주세요.');
                      return mutateManualSettlement(companyId, { action: 'delete', partnerId: cash.partnerId,
                        cashEntryId: row.cashEntryId, statementId: row.statementId, settlementId: row.id, amount: row.amount });
                    }}
                  />
                  )}
                </React.Suspense>
              </div>
            </div>
          )}
          {currentView === 'cash-flow' && (
            <div className="h-full overflow-y-auto">
              <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
                <ProfitAnalysis
                  returnOperations={appData.returnAllocationsLoaded ? appData.returnAllocationOperations : undefined}
                  advanceStatements={appData.advanceStatements}
                  companyId={companyId}
                  initialTab="cash-flow"
                  issuedStatements={issuedStatements}
                  fixedCostTemplates={companyTemplates}
                  partners={partners}
                  items={allItems}
                  costOf={inventoryCostOf}
                  onUpdateIssuedStatement={updateStatement}
                  accountGroups={appData.accountGroups}
                  accountCodes={appData.accountCodes}
                  inventorySnapshots={companySnapshots}
                  cashEntries={companyCashEntries}
                  settlements={appData.settlements}
                  cashFlowManual={appData.cashFlowManual}
                  onSaveCashFlowManual={async (month, data) => {
                    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null));
                    await setDocument('cashFlowManual', month, { ...clean, id: month, month });
                    refreshStaticData();
                  }}
                />
              </React.Suspense>
            </div>
          )}
          {currentView === 'financial-reports' && (
            <div className="h-full overflow-y-auto">
              <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
                <FinancialReports
                  key={companyId}
                  companyId={companyId}
                  statements={issuedStatements}
                  cashEntries={companyCashEntries}
                  accounts={appData.accountCodes}
                  onAddAccountCode={async account => {
                    await createOpeningAccountCode(companyId, account);
                    refreshStaticData();
                  }}
                  cashAccounts={companyCashAccounts}
                  partners={companyPartners}
                  items={allItems}
                  inventorySnapshots={companySnapshots}
                />
              </React.Suspense>
            </div>
          )}
          {currentView === 'loan-management' && (
            <div className="h-full overflow-y-auto">
              <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
                <LoanManager key={companyId} companyId={companyId} cashEntries={companyCashEntries} cashAccounts={companyCashAccounts}
                  partners={partners} currentUserName={currentUser?.name} onAddCashEntry={addCashEntry} />
              </React.Suspense>
            </div>
          )}
          {currentView === 'smartstore-analytics' && (
            <SmartStoreAnalytics
              orders={allOrders}
              partners={partners}
              items={allItems}
              onUpdateItem={(id, data) => updateItem('items', id, data)}
            />
          )}
          {currentView === 'haccp-checklist' && (
            <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
              <HaccpChecklist companyId={companyId} currentUser={{ id: currentUser.id, name: currentUser.name }} isAdmin={isAdmin} />
            </React.Suspense>
          )}
          {currentView === 'return-management' && (
            <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
              <ReturnManager
                companyId={companyId}
                items={allItems}
                partners={partners}
                orders={allOrders}
                issuedStatements={issuedStatements}
                currentUser={{ id: currentUser.id, name: currentUser.name }}
                isAdmin={isAdmin}
                onProcessReturn={handleProcessReturn}
              />
            </React.Suspense>
          )}
          {currentView === 'production' && (
            <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
              <ProductionManager
                records={productionRecords}
                items={allItems}
                orders={allOrders}
                ledger={mergedRawMaterialLedger}
                itemFormulas={itemFormulas}
                onAdd={(record) => addItem('productionRecords', record)}
                onDelete={(id) => deleteItem('productionRecords', id)}
                onUpdate={(id, updates) => updateItem('productionRecords', id, updates)}
                currentUserName={currentUser?.name}
              />
            </React.Suspense>
          )}
          {currentView === 'confirmation-items' && (
            <ConfirmationItems
              requests={adjustmentRequests}
              items={allItems}
              isAdmin={isAdmin}
              onUpdateStatus={(id, status) => updateItem('adjustmentRequests', id, { status, processedAt: new Date().toISOString() })}
              onProcessAdjustment={async (req) => {
                // 가공비 전표 — 확인사항에서 발행. OEM 배치에 매입전표(외주가공비) 끊고 완료.
                if (req.type === 'oem_fee') {
                  const po = purchaseOrders.find(p => p.id === (req.oemPoId ?? req.itemId));
                  if (!po) { alert('OEM 배치를 찾을 수 없습니다.'); return; }
                  try {
                    await issueOemFeeStatement({ po, unitPricePerKg: req.oemFeePerKg, date: today() });
                  } catch (e) { alert(`가공비 전표 발행 실패: ${(e as Error)?.message ?? String(e)}`); return; }
                  await updateItem('adjustmentRequests', req.id, { status: 'processed', processedAt: new Date().toISOString() });
                  alert('가공비 전표를 발행했습니다.');
                  return;
                }
                // 실제 재고 반영 로직
                const product = allItems.find(p => p.id === req.itemId);
                if (product) {
                  const collectionName = COL.items;
                  if (req.type === 'quantity_change') {
                    // 수량 변동 승인 시, 요청된 수량만큼 재고에 더함
                    const target = rawLotTarget(allItems, product, product.name, companyId);
                    if (target) {
                      // 요청 수량은 화면 단위(기름=L) → 저장 단위 kg으로
                      const addKg = product.density ? (req.requestedQuantity || 0) * product.density : (req.requestedQuantity || 0);
                      await adjustRawLots({ companyId, material: target.baseName, rawItemId: target.rawItem.id, deltaKg: addKg, date: today(), note: '재고조정', addedBy: currentUser?.name });
                      setLedgerReloadKey(k => k + 1);
                    } else {
                      const result = await adjustStockByQty({
                        itemId: product.id,
                        itemName: product.name,
                        deltaQty: req.requestedQuantity || 0,
                        note: '재고조정 승인',
                      });
                      if (!result.ok) { alert(result.message); return; }
                    }
                  } else if (req.type === 'cancel_receipt') {
                    // 입고 취소 승인 시, 아무것도 하지 않음 (이미 반영 전이므로 리스트에서만 제거)
                    // 만약 이미 반영된 후에 취소하는 것이라면 stock에서 빼야 함.
                    // 하지만 여기서는 "입고 예정" 리스트에 있는 것을 처리하는 것이므로 stock 반영은 안 함.
                  }
                  
                  // 처리 완료 후 입고 예정 리스트(purchaseOrders)에서 제거
                  await deleteItem('purchaseOrders', req.itemId);
                }
                await updateItem('adjustmentRequests', req.id, { status: 'processed', processedAt: new Date().toISOString() });
                alert('처리가 완료되었습니다.');
              }}
              onDelete={(id) => deleteItem('adjustmentRequests', id)}
            />
          )}
          {currentView === 'sanitation-checklist' && (
            <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
              <SanitationChecklistView companyId={companyId} currentUser={currentUser ? { id: currentUser.id, name: currentUser.name } : undefined} isAdmin={isAdmin} />
            </React.Suspense>
          )}
          {currentView === 'leave-portal' && (
            <LeaveManager
              companyId={companyId}
              requestScopeKey={leaveRenderUid ?? ''}
              currentUser={currentUser}
              isAdmin={isAdmin}
              employees={employees}
              leaveRequests={leaveRequests}
              onAddLeaveRequest={request => handleAddLeaveRequests([request],true)}
              onReadPendingLeaveRequests={readPendingLeaveRequests}
              onInspectLeaveRequest={handleInspectLeaveRequest}
              onCancelLeaveRequest={handleCancelLeaveRequest}
              onReadLeaveReferences={readLeaveReferences}
              onCancelLeaveReference={handleCancelLeaveReference}
              onLeaveAction={handleLeaveAction}
              onReadPendingLeaveActions={readPendingLeaveActions}
              onInspectLeaveAction={handleInspectLeaveAction}
              onCancelLeaveAction={handleCancelLeaveAction}
            />
          )}
          {normalizeViewAlias(currentView) === 'item-management' && (
            <div className="flex flex-col h-full overflow-y-auto">
              {itemEditorRecoveryError&&<p role="status" className="text-sm text-slate-600">{itemEditorRecoveryError}</p>}
              <ItemEditorRecoveryList entries={itemEditorRecoveryEntries} onOpen={entry=>{setItemEditorRecovery(entry);setEditingProduct(null);setIsProductModalOpen(true);}}/>
              {true && (
                <ItemManager
                  onPartnerItemCleanupChanged={refreshStaticData}
                  companyId={companyId}
                  orderUnitInputs={appData.orderUnitInputs}
                  isAdmin={isAdmin}
                  onCreateBoxItem={createBoxItem}
                  /* 원가계산기 — **원료식·전체 품목을 여기서 물려 넘긴다.**
                     화면이 받는 items는 회사별로 걸러진 것이라 그걸로 굴리면 구성품을 못 찾고,
                     원료식이 없어 반제품 원가가 통째로 빠진다. 실제 원가와 같은 근거를 쓴다. */
                  onCalcCost={(rows, opts) => calcCost(rows, allItems, itemBoms, {
                    ...opts,
                    formulaOf: (k) => buildFormulaBom(k, itemFormulas, allItems),
                    formulaRowsOf: (k) => formulaRowsOf(k, itemFormulas),
                  })}
                  costOf={inventoryCostOf}
                  /* 목록과 BOM 표시는 현재 회사의 입력을 사용한다. */
                  items={companyItems}
                  partners={partners}
                  partnerItems={partnerItems}
                  accountCodes={appData.accountCodes}
                  accountGroups={appData.accountGroups}
                  onEditProduct={(p) => { setEditingProduct(p); setIsProductModalOpen(true); }}
                  onAddItem={() => { setItemEditorRecovery(null);setEditingProduct(null); setIsProductModalOpen(true); }}
                  onDeleteItem={requestCatalogItemDelete}
                  onLinkItem={async (itemId, partnerId) => {
                    try {
                      const current = partnerOut.filter(pc => pc.itemId === itemId).map(pc => pc.partnerId);
                      if (!current.includes(partnerId)) {
                        await setProductClients(itemId, [...current, partnerId]);
                        await refreshStaticData();
                      }
                    } catch (error: any) {
                      console.error('품목 연결 실패:', error);
                      alert(`품목을 연결하지 못했습니다.\n${error?.message ?? String(error)}`);
                    }
                  }}
                  onUnlinkItem={async (itemId, partnerId) => {
                    try {
                      const current = partnerOut.filter(pc => pc.itemId === itemId).map(pc => pc.partnerId);
                      await setProductClients(itemId, current.filter(id => id !== partnerId));
                      await refreshStaticData();
                    } catch (error: any) {
                      console.error('품목 연결 해제 실패:', error);
                      alert(`품목 연결을 해제하지 못했습니다.\n${error?.message ?? String(error)}`);
                    }
                  }}
                  onLinkSupplier={async (itemId, partnerId) => {
                    const current = partnerItems.filter(pi => pi.itemId === itemId && pi.Direction === 'in').map(pi => pi.partnerId);
                    if (!current.includes(partnerId)) {
                      await setProductSuppliers(itemId, [...current, partnerId]);
                      refreshStaticData();
                    }
                  }}
                  onUnlinkSupplier={async (itemId, partnerId) => {
                    const current = partnerItems.filter(pi => pi.itemId === itemId && pi.Direction === 'in').map(pi => pi.partnerId);
                    await setProductSuppliers(itemId, current.filter(id => id !== partnerId));
                    refreshStaticData();
                  }}
                  onMergeItems={async () => { await refreshStaticData(); }}
                  itemBoms={itemBoms}
                  {...partnerTermsBindings}
                  onSaveItemCustomer={async (ic: Partial<import('../../shared/types').PartnerItem> & { id: string }) => {
                    const { doc: fDoc, updateDoc: fUpdate } = await import('firebase/firestore');
                    const { db: fireDb } = await import('../../shared/firebase');
                    // canonical(itemId/partnerId/price)와 id는 저장 데이터에서 빼고 나머지만 업데이트
                    const { id, itemId, partnerId, price, ...rest } = ic as any;
                    void itemId; void partnerId; void price;
                    const data = Object.fromEntries(
                      Object.entries(rest).filter(([, v]) => v !== undefined)
                    );
                    await fUpdate(fDoc(fireDb, 'partner_item', id), data);
                    refreshStaticData();
                  }}
                />
              )}
            </div>
          )}

          {currentView === 'mypage' && (
            <React.Suspense fallback={<div className="p-8 text-center text-xs font-bold text-slate-300">불러오는 중…</div>}>
              <MyPage key={menuKey ?? `pending:${companyId}:${currentUser.id}:${isAdmin}`} currentUser={currentUser} onLogout={onLogout} menuSettings={{groups:menuGroups,items:menuCatalog,value:menuValue,enabled:!!menuKey,error:menuError,onChange:changeMenu,onReset:resetMenu}} />
            </React.Suspense>
          )}

          {currentView === 'officetalk' && (
            <OfficeTalk
              currentUser={currentUser}
              employees={employees}
              chatRooms={chatRooms}
              chatMessages={chatMessages}
              initialRoomId={openChatRoomId}
              onRoomOpened={() => setOpenChatRoomId(null)}
              onAddRoom={(room) => addItem('chatRooms', room)}
              onUpdateRoom={(id, data) => updateItem('chatRooms', id, data)}
              onDeleteRoom={(id) => deleteItem('chatRooms', id)}
              isAdmin={isAdmin || isAdminAuthenticated}
              onUpdateMessage={(id, data) => updateItem('chatMessages', id, data)}
              extractedMessageIds={extractedOfficeTalkMessageIds(allOrders, companyId)}
              onExtractOrder={(messageId, text) => {
                resetOrderCreationSession(pasteOrderCreation.current);
                setPasteOrderInitialText(text);
                setPasteOrderSourceMessageId(messageId);
                setIsOrderCreateChooserOpen(false);
                setIsAddOrderOpen(false);
                setIsPasteOrderOpen(true);
              }}
              onSendMessage={async (msg,sharedUUID,expectedUid) => {
                const originalText=JSON.stringify(msg),first=JSON.parse(originalText) as typeof msg;
                const actorUid=expectedUid??auth.currentUser?.uid;
                const assertScope=()=>{if(!actorUid||auth.currentUser?.uid!==actorUid||companyOf(first)!==companyId)throw Error('공유 전송의 로그인·회사 범위가 변경되었습니다.');};
                const ack=()=>({companyId,actorUid:actorUid!,shareId:sharedUUID!,messageText:originalText});
                if (sharedUUID) {
                  msg=first;assertScope();const result = await sendSharedChatMessage(first,sharedUUID,actorUid);assertScope();
                  if(!['created','duplicate'].includes(result))throw Error('최초 공유 전송의 완료 응답을 확인하지 못했습니다.');
                  if (result === 'duplicate') return ack();
                } else {
                  await addItem('chatMessages', msg);
                }
                // 공유 중복 확인에서는 방 요약·수신 알림도 다시 만들지 않는다.

                // 방 요약·수신 알림은 본문 저장과 별개다. 참여자가 많을수록 알림 쓰기를 전부
                // 기다리느라 전송 버튼이 수초간 잠겼다. 본문 성공 즉시 입력을 풀고 뒤에서 처리한다.
                void (async () => {
                  const room = chatRooms.find(r => r.id === msg.roomId);
                  if (room) {
                    const now = new Date().toISOString();
                    await updateItem('chatRooms', room.id, {
                      lastMessage: msg.text,
                      lastUpdatedAt: now,
                      lastReadBy: { ...(room.lastReadBy ?? {}), [msg.senderId]: now }
                    });

                    const recipients = room.participantIds.filter(id => id !== msg.senderId);
                    const roomName = room.name || (room.participantIds.length === 2
                      ? (employees.find(e => e.id === recipients[0])?.name ?? '알 수 없음')
                      : `단체 채팅`);
                    const preview = msg.text.length > 40 ? msg.text.slice(0, 40) + '…' : msg.text;
                    await Promise.all(recipients.map(recipientId =>
                      addItem('notifications', {
                        type: 'mention', title: `${msg.senderName} (${roomName})`, body: preview,
                        readBy: [], createdAt: new Date().toISOString(), senderId: msg.senderId,
                        linkedId: msg.roomId, targetId: recipientId,
                      } as Omit<AppNotification, 'id'> & { targetId: string })
                    ));
                  }

                  if (msg.text.includes('@관리자')) {
                    await addItem('adjustmentRequests', {
                      id: `MENTION-${Date.now()}`, itemId: 'chat-mention',
                      itemName: `[채팅 언급] ${msg.senderName}`, originalQuantity: 0,
                      type: 'chat_mention', reason: msg.text, status: 'pending',
                      requestedAt: new Date().toISOString()
                    } as AdjustmentRequest);
                  }
                })().catch(error => console.error('[오피스톡 부가 처리 실패]', error));
                if(sharedUUID){assertScope();return ack();}
              }}
            />
          )}
          </div>
          )}
        </div>
      </main>

      {isAdminAuthModalOpen && (
        <AdminAuthModal
          onClose={() => setIsAdminAuthModalOpen(false)}
          onSuccess={onAdminAuthSuccess}
          correctPassword={companyInfo?.adminPassword && companyInfo.adminPassword !== '0000'
            ? companyInfo.adminPassword
            : undefined}
        />
      )}
      {isOrderCreateChooserOpen && (
        <ModalShell title="주문 생성 방법" onClose={() => setIsOrderCreateChooserOpen(false)} className="max-w-md"
          footer={<button type="button" onClick={() => setIsOrderCreateChooserOpen(false)} className="ml-auto block rounded-lg px-4 py-2.5 text-xs font-black text-slate-500 hover:bg-slate-100">취소</button>}>
            <div className="grid gap-3">
              <button type="button" onClick={() => { setIsOrderCreateChooserOpen(false); setOrderCreateMode('order'); setIsAddOrderOpen(true); }} className="group flex min-h-20 items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition-colors group-hover:bg-slate-200 group-hover:text-slate-800"><Plus size={19} /></span>
                <span className="min-w-0">
                  <strong className="block text-sm font-black text-slate-900 group-hover:text-indigo-700">직접 선택</strong>
                  <span className="mt-1 block text-xs font-bold text-slate-500">거래처와 주문 품목을 직접 선택합니다.</span>
                </span>
              </button>
              <button type="button" onClick={() => { setIsOrderCreateChooserOpen(false); setPasteOrderInitialText(''); setPasteOrderSourceMessageId(null); setIsPasteOrderOpen(true); }} className="group flex min-h-20 items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition-colors group-hover:bg-slate-200 group-hover:text-slate-800"><ClipboardPaste size={19} /></span>
                <span className="min-w-0">
                  <strong className="block text-sm font-black text-slate-900 group-hover:text-indigo-700">주문 내역 붙여넣기</strong>
                  <span className="mt-1 block text-xs font-bold text-slate-500">문자나 메신저로 받은 주문 내용을 붙여넣습니다.</span>
                </span>
              </button>
              <button type="button" onClick={() => { setIsOrderCreateChooserOpen(false); setOrderCreateMode('stock'); setIsAddOrderOpen(true); }} className="group flex min-h-20 items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition-colors group-hover:bg-slate-200 group-hover:text-slate-800"><Package size={19} /></span><span className="min-w-0"><strong className="block text-sm font-black text-slate-900 group-hover:text-indigo-700">재고 만들기</strong><span className="mt-1 block text-xs font-bold text-slate-500">판매 주문 없이 필요한 수량을 추가 생산합니다.</span></span></button>
            </div>
        </ModalShell>
      )}
      {isAddOrderOpen && (
        <AddOrderModal
          mode={orderCreateMode}
          orderUnitInputs={appData.orderUnitInputs}
          items={allItems}
          orders={allOrders}
          partners={partners}
          partnerItems={partnerItems}
          palletStocks={pallets}
          submaterials={submaterials}
          onClose={() => closeOrderCreation('direct')}
          onBack={() => closeOrderCreation('direct', true)}
          onSave={(order) => saveNewOrder('direct', order)}
        />
      )}
      {copyRulesOpen&&<OrderInterpretationRules key={JSON.stringify([companyId,copyActor])} companyId={companyId} actorUid={copyActor} isAdmin={isAdmin} isCurrentActor={()=>auth.currentUser?.uid===copyActor&&copyScope.current.companyId===companyId} onClose={()=>setCopyRulesOpen(false)}/>}
      {isPasteOrderOpen && (<div hidden={copyRulesOpen}>
        <PasteOrderModal key={JSON.stringify([companyId,copyActor,copyDraftVersion])}
          orderUnitInputs={appData.orderUnitInputs}
          items={allItems}
          partners={partners}
          orders={orders}
          partnerItems={partnerItems}
          palletStocks={pallets}
          companyId={companyId}
          actorUid={copyActor}
          suspended={copyRulesOpen}
          onOpenRules={isAdmin?()=>setCopyRulesOpen(true):undefined}
          recoveryBusy={copyWorking}
          onSourceTextChange={updateCopyDraftSource}
          saveBlocked={copySelected?.outcome==='rejected'&&copySelected.request?.sourceText===copyDraftSource}
          saveRecovery={(copyEntries.length>0||copySelected||copyError)?<section aria-label="주문 저장 확인" className="space-y-2 text-sm">
            {copyError&&<p role="alert">{copyError}</p>}
            {copyEntries.length>0&&<><p>저장 결과를 확인할 주문이 있습니다.</p><div className="space-y-1">{copyEntries.map(entry=><button type="button" key={entry.key} disabled={copyWorking} onClick={()=>{setCopySelected(entry);setCopyError(entry.request?'주문이 저장됐는지 결과를 확인해 주세요.': '저장 정보를 읽을 수 없습니다. 주문 이력을 확인해 주세요.');}} className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs">{entry.request?`${entry.request.confirmed.orderDraft.partnerName} · ${(typeof entry.request.confirmed.orderDraft.deliveryDate==='string'?entry.request.confirmed.orderDraft.deliveryDate.slice(0,10):'날짜 확인 필요')}`:'저장 정보 확인 필요'}{entry.deleted?' · 이전에 닫은 확인 건':''}</button>)}</div></>}
            {copySelected&&<div className="space-y-2 border-t border-slate-200 pt-2"><p>{String(copySelected.request?.confirmed.orderDraft.partnerName??'주문 정보 확인 필요')}</p><details><summary>저장하던 주문 내용</summary><pre className="whitespace-pre-wrap break-words text-xs">{copySelected.request?.sourceText??'주문 이력에서 저장 여부를 확인해 주세요.'}</pre></details>
              {copySelected.outcome==='rejected'?<button type="button" disabled={copyWorking} onClick={()=>rewriteCopiedOrder(copySelected)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold">선택한 주문 내용으로 다시 작성</button>:<div className="flex flex-wrap gap-2"><button type="button" disabled={copyWorking||!copySelected.request} onClick={()=>void actCopiedOrder(copySelected,'inspect',copyDraftSource)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold">결과 확인</button><button type="button" disabled={copyWorking||!copySelected.request} onClick={()=>void actCopiedOrder(copySelected,'retry',copyDraftSource)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold">같은 내용 다시 시도</button></div>}
            </div>}
          </section>:undefined}
          isCurrentActor={()=>auth.currentUser?.uid===copyActor&&copyScope.current.companyId===companyId}
          initialText={pasteOrderInitialText}
          onClose={() => closeOrderCreation('paste')}
          onBack={() => closeOrderCreation('paste', true)}
          onSave={saveCopiedOrder}
        /></div>
      )}
      {isProductModalOpen && (
        <ProductModal
          key={companyId+':'+(itemEditorActor??'')+':'+(itemEditorRecovery?.reference.planId??editingProduct?.id??'new')}
          requestScopeKey={itemEditorActor??''}
          companyId={companyId}
          orderUnitInputs={appData.orderUnitInputs}
          initialData={editingProduct || undefined}
          allSubmaterials={itemsOfCompany(submaterials, companyId)}
          items={itemsOfCompany(products, companyId)}
          rawItems={companyItems.filter(i => i.type === 'raw' || i.type === 'wip')}
          itemFormulas={itemFormulas}
          rollupCostOf={rollupCostOf}
          partners={partners}
          partnerItems={partnerItems}
          onClose={() => {if(isCurrentItemEditor()){setIsProductModalOpen(false);setEditingProduct(null);}}}
          onAddSubmaterial={async (name, category) => {
            const unit = category === '라벨' ? '매' : '개';
            const id = await addItem('items', { name, category, stock: 0, minStock: 0, unit, image: '', companyId });
            return id as string;
          }}
          initialPending={itemEditorRecovery?.pending}
          initialReference={itemEditorRecovery?.reference}
          initialObservedLocalText={itemEditorRecovery?.observedLocalText}
          onDiscardItemEditorCopy={(reference,observed,current)=>discardItemEditorCopy(itemEditorRequestScope,reference,observed,()=>isCurrentItemEditor()&&current())}
          onCaptureItemEditorOpening={(targetId,current)=>captureItemEditorOpening(itemEditorRequestScope,targetId,()=>isCurrentItemEditor()&&current())}
          onInspectItemEditor={(reference,progress,current)=>inspectItemEditorSave(itemEditorRequestScope,reference,progress,()=>isCurrentItemEditor()&&current())}
          onContinueItemEditor={(reference,progress,current)=>continueItemEditorSave(itemEditorRequestScope,reference,progress,()=>isCurrentItemEditor()&&current())}
          onCancelItemEditor={(reference,progress,current)=>cancelItemEditorSave(itemEditorRequestScope,reference,progress,()=>isCurrentItemEditor()&&current())}
          onSave={saveItemEditorPrimary}
        />
      )}

      {/* 작업완료 전 재고 사용량 확인 — 확정되면 그 플랜으로 생산처리 */}
      {catalogDeleteAsk && catalogDeleteAsk.scope === orderAskScope.current.token && (
        <ConfirmModal
          title="품목 삭제" tone="rose" icon={Trash2}
          message={`“${catalogDeleteAsk.itemName}” 품목을 삭제할까요?`}
          subMessage={catalogDeleteAsk.subMessage}
          confirmText="삭제하기"
          onConfirm={() => { void confirmCatalogItemDelete(); }}
          onCancel={() => {
            if (catalogDeleteAsk.scope !== orderAskScope.current.token || catalogDeleteCurrent.current !== catalogDeleteAsk) return;
            catalogDeleteRequest.current = null;
            setCatalogDeleteAsk(current => current === catalogDeleteAsk ? null : current);
          }}
        />
      )}
      {/*  임가공·완사입 품목 완료 — 재고를 쓰는지, 모자라 음수가 되는지 알린다 */}
      {/*  **되돌리기 확인창** — 글은 `buildStatusChangeAsk` 가 만든다.
           누르는 동안 단추를 잠근다(두 번 눌러 두 번 원복되는 것을 막는다). */}
      {rollbackAsk && rollbackAsk.scope === orderAskScope.current.token && (
        <ConfirmModal
          title="되돌리기" tone="amber" icon={RotateCcw}
          message={rollbackAsk.message}
          subMessage={rollbackAsk.subMessage}
          confirmText={rollbackSaving ? '처리 중…' : rollbackAsk.confirmText}
          onCancel={() => { if (!rollbackSaving) setRollbackAsk(current => current === rollbackAsk ? null : current); }}
          onConfirm={async () => {
            const ask = rollbackAsk;
            if (ask.scope !== orderAskScope.current.token || orderAskCurrent.current.rollback !== ask || rollbackBusyRef.current === ask) return;
            rollbackBusyRef.current = ask;
            setRollbackBusy(ask);
            try {
              await ask.onConfirm();
              if (ask.scope === orderAskScope.current.token) setRollbackAsk(current => current === ask ? null : current);
            } catch (error) {
              if (ask.scope === orderAskScope.current.token && orderAskCurrent.current.rollback === ask) {
                console.error('주문 상태 되돌리기 실패', error);
                alert(error instanceof Error ? error.message : '되돌리지 못했습니다. 재고 작업 이력을 확인해 주세요.');
              }
            } finally {
              if (rollbackBusyRef.current === ask) rollbackBusyRef.current = null;
              setRollbackBusy(current => current === ask ? null : current);
            }
          }}
        />
      )}
      {goodsStockAsk && goodsStockAsk.scope === orderAskScope.current.token && (
        <ConfirmModal
          title={goodsStockAsk.title} tone={goodsStockAsk.tone} icon={Package}
          message={goodsStockAsk.message}
          subMessage={goodsStockAsk.subMessage}
          confirmText={goodsStockAsk.confirmText}
          onConfirm={() => {
            const ask = goodsStockAsk;
            if (ask.scope !== orderAskScope.current.token || orderAskCurrent.current.goods !== ask) return;
            setGoodsStockAsk(current => current === ask ? null : current);
            ask.onConfirm();
          }}
          onCancel={() => {
            const ask = goodsStockAsk;
            if (ask.scope !== orderAskScope.current.token || orderAskCurrent.current.goods !== ask) return;
            setGoodsStockAsk(current => current === ask ? null : current);
          }}
        />
      )}
      {appNotice && (
        <ConfirmModal
          title={appNotice.title} tone={appNotice.tone} icon={appNotice.icon}
          message={appNotice.message}
          subMessage={appNotice.subMessage}
          confirmText="확인"
          confirmOnly
          onConfirm={() => setAppNotice(null)}
          onCancel={() => setAppNotice(null)}
        />
      )}
      {stockUseAsk && stockUseAsk.scope === orderAskScope.current.token && (
        <StockUseModal
          partnerName={stockUseAsk.partnerName}
          rows={stockUseAsk.rows}
          completionLabel={stockUseAsk.mode === 'line' ? '품목 완료' : '작업완료'}
          onCancel={() => setStockUseAsk(current => current === stockUseAsk ? null : current)}
          onConfirm={async (plan: StockUsePlan) => {
            const ask = stockUseAsk;
            if (ask.scope !== orderAskScope.current.token || orderAskCurrent.current.stock !== ask) return;
            setStockUseAsk(current => current === ask ? null : current);
            if (ask.mode === 'line') {
              await ask.onConfirm(plan);
              return;
            }
            await changeOrderStatus(ask.orderId, OrderStatus.DISPATCHED, plan, { approvedBy: currentUser?.name, orderPatch: ask.orderPatch });
          }}
        />
      )}

      {/* 알림 패널 — aside overflow-hidden 우회용 포털 */}
      {showNotifPanel && createPortal(
        (() => {
          const { visible, unread } = selectBellNotifications(appNotifications, currentUser.id);
          const markForCurrentUser = async (
            notifications: AppNotification[],
            field: 'readBy' | 'dismissedBy',
          ) => {
            await Promise.all(notifications.map(n =>
              markNotificationForUser(n.id, field, currentUser.id)));
          };
          const markRead = async (id: string) => {
            const n = visible.find(x => x.id === id);
            if (!n || n.readBy.includes(currentUser.id)) return;
            await markForCurrentUser([n], 'readBy');
          };
          const markAll = async () => {
            await markForCurrentUser(unread, 'readBy');
          };
          const dismissAll = async () => {
            if (!await appConfirm('종 알림을 전부 삭제할까요?')) return;
            await markForCurrentUser(visible, 'dismissedBy');
          };
          const sorted = [...visible].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

          const handleNotifClick = async (n: AppNotification) => {
            await markRead(n.id);
            setShowNotifPanel(false);
            if (n.type === 'new_order' && n.linkedId) {
              setCurrentView('orders');
              setHighlightOrderId(n.linkedId);
            } else if (n.type === 'mention' && n.linkedId) {
              setCurrentView('officetalk');
              setOpenChatRoomId(n.linkedId);
            } else if (n.type === 'leave_request' || n.type === 'confirmation') {
              if (isAdmin || isAdminAuthenticated) setCurrentView('admin-checklist');
            } else if (n.type === 'inventory_shortage') {
              if (isAdmin || isAdminAuthenticated) setCurrentView('admin-checklist');
            }
          };

          const notifList = sorted.length === 0 ? (
            <p className="text-center text-slate-400 text-xs py-8">알림이 없습니다</p>
          ) : sorted.map(n => {
            const isUnread = !n.readBy.includes(currentUser.id);
            const isShortage = n.type === 'inventory_shortage';
            // 재고 부족 알림은 빨간색으로 강조
            const cardBg = isShortage
              ? (isUnread ? 'bg-rose-50' : 'bg-rose-50/40')
              : (isUnread ? 'bg-indigo-50/60' : '');
            const dotColor = isShortage
              ? (isUnread ? 'bg-rose-500' : 'bg-transparent')
              : (isUnread ? 'bg-indigo-500' : 'bg-transparent');
            const titleColor = isShortage
              ? (isUnread ? 'text-rose-700' : 'text-rose-500')
              : (isUnread ? 'text-slate-800' : 'text-slate-500');
            return (
              <div
                key={n.id}
                onClick={() => handleNotifClick(n)}
                className={`flex items-start gap-3 px-4 py-3 border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors ${cardBg}`}
              >
                <div className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${dotColor}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {isShortage && <span className="text-[9px] font-black bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded">⚠ 재고</span>}
                    <p className={`text-[11px] font-bold ${titleColor}`}>{n.title}</p>
                  </div>
                  <p className={`text-[10px] mt-0.5 leading-relaxed ${isShortage ? 'text-rose-600' : 'text-slate-500'}`}>
                    {n.type === 'new_order' && n.body.includes(' 주문이') ? (
                      <><span className="font-black text-slate-800 text-[11px]">{n.body.split(' 주문이')[0]}</span>{' '}주문이 등록되었습니다.</>
                    ) : n.body}
                  </p>
                  <p className="text-[9px] text-slate-300 mt-1">{new Date(n.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                {(n.type === 'new_order' || n.type === 'mention' || n.type === 'leave_request' || n.type === 'confirmation' || n.type === 'inventory_shortage') && (
                  <span className={`text-[9px] font-bold shrink-0 mt-0.5 ${isShortage ? 'text-rose-500' : 'text-indigo-400'}`}>바로가기 →</span>
                )}
              </div>
            );
          });

          if (isMobile) {
            return (
              /*  **아이폰에선 안전영역을 비켜야 한다**(2026-09-12 사장님: "알림 화면을 켜면
               *  ui가 깨져서 거기서 뒤로가기가 안 된다").
               *
               *  index.html 이 `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style:
               *  black-translucent` 라서 `fixed inset-0` 은 **시계·배터리 밑까지 깔린다.**
               *  머리줄이 통째로 상태바에 묻혀 ← 버튼이 안 보이고 눌리지도 않았다.
               *  홈 화면에 추가한 PWA 는 브라우저 뒤로가기도 없어서 **나갈 길이 아예 없었다.**
               *
               *  사이드바(1690)·모바일 머리줄(1911)은 이미 이렇게 비켜 두고 있다 — 같은 방식이다. */
              <div
                className="fixed inset-0 z-[1000] bg-white flex flex-col"
                style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
              >
                <div
                  className="flex items-center px-4 py-3 border-b border-slate-100 bg-white"
                  style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
                >
                  <button
                    onClick={() => setShowNotifPanel(false)}
                    className="p-1 rounded-xl hover:bg-slate-100 transition-colors mr-2"
                  >
                    <ChevronLeft size={20} className="text-slate-600" />
                  </button>
                  <span className="flex-1 text-sm font-black text-slate-700">알림</span>
                  <div className="flex items-center gap-1">
                    {unread.length > 0 && (
                      <button onClick={markAll} className="text-xs font-bold text-indigo-500 hover:text-indigo-700 transition-colors px-2 py-1">전부 읽음</button>
                    )}
                    {visible.length > 0 && (
                      <button onClick={dismissAll} className="text-xs font-bold text-rose-500 hover:text-rose-700 transition-colors px-2 py-1">전부 삭제</button>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                  {notifList}
                </div>
              </div>
            );
          }

          return (
            <>
              <div className="fixed inset-0 z-[999]" onClick={() => setShowNotifPanel(false)} />
              <div
                style={{ top: notifPanelPos.top, left: notifPanelPos.left }}
                className="fixed z-[1000] w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <span className="text-xs font-black text-slate-700">알림</span>
                  <div className="flex items-center gap-2">
                    {unread.length > 0 && (
                      <button onClick={markAll} className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 transition-colors">전부 읽음</button>
                    )}
                    {visible.length > 0 && (
                      <button onClick={dismissAll} className="text-[10px] font-bold text-rose-500 hover:text-rose-700 transition-colors">전부 삭제</button>
                    )}
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifList}
                </div>
              </div>
            </>
          );
        })(),
        document.body
      )}
    </div>
  );
};

/** hidden이면 아예 안 그린다 — 회사에 없는 화면을 메뉴에 남겨 두면 잘못 들어간다 */

export default AdminApp;
