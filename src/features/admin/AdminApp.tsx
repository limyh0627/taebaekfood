
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

import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  FileText,
  Receipt,
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
  ShieldAlert,
  UserPlus,
  FolderOpen,
} from 'lucide-react';
import { Order, Item, PartnerItem, ViewType, OrderStatus, Partner, Post, FileItem, PalletStock, Employee, LeaveRequest, PalletTransaction, OrderItem, AdjustmentRequest, ChatRoom, ChatMessage, RawMaterialEntry, AppNotification, ProductionRecord, ReturnRequest, PaymentRecord, ShippingRule, poLines } from '../../shared/types';
import PageHeader from '../../shared/components/PageHeader';
import Dashboard from '../../../components/Dashboard';
import OrdersList from '../../../components/OrdersList';
import ItemList from '../../../components/ItemList';
import BomIntegrityPanel from '../../../components/BomIntegrityPanel';
import AIConsultant from '../../../components/AIConsultant';
import AddOrderModal from '../../../components/AddOrderModal';
import PasteOrderModal from '../../../components/PasteOrderModal';
import PartnerManager from '../../../components/PartnerManager';
import DeliveryManager from '../../../components/DeliveryManager';
import PalletManager from '../../../components/PalletManager';
import AdminAuthModal from '../../../components/AdminAuthModal';
import HRManager from '../../../components/HRManager';
import LeaveManager from '../../../components/LeaveManager';
import ConfirmationItems from '../../../components/ConfirmationItems';
import ProductModal from '../../../components/AddItemModal';
import { createOrderStockEngine } from './orderStockEngine';
import { buildFormula as buildFormulaBom } from './bom';
import NoticeBoard from '../../../components/NoticeBoard';
import ItemManager from '../../../components/ItemManager';
import ItemPriceManager from '../../../components/ItemPriceManager';
import PriceManager from '../../../components/PriceManager';
import TaxStatement from '../../../components/TaxStatement';
import OfficeTalk from '../../../components/OfficeTalk';
import AdminChecklist from '../../../components/AdminChecklist';
import PartnerSignupApproval from '../../../components/PartnerSignupApproval';
import DocumentManager from '../../../components/DocumentManager';
import type * as ExcelJSType from 'exceljs';

const InboundScan = React.lazy(() => import('../../../components/InboundScan'));
const QrLabelPrint = React.lazy(() => import('../../../components/QrLabelPrint'));
const SmartStoreAnalytics = React.lazy(() => import('../../../components/SmartStoreAnalytics'));
const HaccpChecklist = React.lazy(() => import('../../../components/HaccpChecklist'));
const BenzopyreneLog = React.lazy(() => import('../../../components/BenzopyreneLog'));
const SanitationChecklistView = React.lazy(() =>
  import('../../../components/HaccpChecklist').then(m => ({ default: m.StaffChecklistView }))
);
const ReturnManager = React.lazy(() => import('../../../components/ReturnManager'));
const ReceivingReturnsManager = React.lazy(() => import('../../../components/ReceivingReturnsManager'));
const ProductionManager = React.lazy(() => import('../../../components/ProductionManager'));
const TradeStatement = React.lazy(() => import('../../../components/TradeStatement'));
const ProfitAnalysis = React.lazy(() => import('../../../components/ProfitAnalysis'));

import { db } from '../../shared/firebase';
import { PRODUCT_FORMULA, DENSITY, RM_LIST, toKg, unitOf, unitToKg, baseRawName, lotStockInUnit, lotKgRemaining } from '../../constants/formula';
import { deductFromLots, buildReceiveLot, withCarryOverLot, nextLotNo } from '../../shared/lotUtils';
import { rawLotTarget, recordRawMaterialReceipt, adjustRawLots } from '../../shared/rawReceipt';
import {
  addItem,
  updateItem,
  deleteItem,
  setProductClients,
  setProductSuppliers,
  setDocument,
  fetchDateRange,
  mutateRawMaterialLots,
} from '../../shared/services/firebaseService';
import type { AppData } from '../../shared/hooks/useAppData';
import type { AdminData } from '../../hooks/useAdminData';
import { collection, getDocs, writeBatch, doc, getDoc, setDoc, deleteDoc, onSnapshot, query, where } from 'firebase/firestore';

// 거래처 주문 포털(웹) URL — .env의 VITE_PARTNER_PORTAL_URL로 운영 도메인 지정 가능
const PARTNER_PORTAL_URL =
  (import.meta.env.VITE_PARTNER_PORTAL_URL as string | undefined) || 'http://localhost:3000';

const openPartnerPortal = () => {
  window.open(PARTNER_PORTAL_URL, '_blank', 'noopener,noreferrer');
};

interface AdminAppProps {
  currentUser: Employee;
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
    appNotifications, workOrderItems, issuedStatements,
    itemFormulas, itemBoms, shippingRules, returnRequests, companyInfo, inventorySnapshots, productionSalesLogs, isDataLoading,
    pendingStatementEdits, refreshStaticData,
    historicalOrders, loadHistoricalOrders, isLoadingHistoricalOrders,
    ordersMonths, setOrdersMonths,
  } = appData;

  // 활성 주문 + 불러온 이력 주문 통합 (id 중복 제거)
  const allOrders = useMemo(() => {
    const map = new Map<string, typeof orders[number]>();
    for (const o of historicalOrders) map.set(o.id, o);
    for (const o of orders) map.set(o.id, o); // 실시간이 더 최신이므로 덮어씀
    return Array.from(map.values());
  }, [orders, historicalOrders]);
  const receivedOrders = purchaseOrders.filter(po => po.status === 'received');


  // items 컬렉션 카테고리별 분리
  const products     = useMemo(() => items.filter(i => i.category === 'product'), [items]);
  const submaterials = useMemo(() => items.filter(i => i.category !== 'product'), [items]);

  // partner_item 컬렉션 Direction 기준 분리
  const partnerIn = useMemo(() => partnerItems.filter(pi => pi.Direction === 'in'),  [partnerItems]);
  const partnerOut   = useMemo(() => partnerItems.filter(pi => pi.Direction === 'out'), [partnerItems]);

  // partner_item upsert — Firestore 쓰기 + 로컬 낙관적 갱신(라이브 구독 아님 → 새로고침 없이 즉시 반영)
  const handleUpsertPartnerItem = (ps: PartnerItem, defaultDir: 'in' | 'out' = 'out') => {
    // canonical camelCase(itemId/partnerId/price)로 정규화 — 레거시 필드는 DB에 저장 안 함
    const { Item_ID, Partner_ID, Standard_Price, item_id, customer_id, price: _p, ...rest } = ps as any;
    const itemId = ps.itemId ?? Item_ID;
    const partnerId = ps.partnerId ?? Partner_ID;
    const price = ps.price ?? Standard_Price;
    const docData = { ...rest, itemId, partnerId, Direction: ps.Direction ?? defaultDir,
      ...(price !== undefined ? { price } : {}) } as PartnerItem;
    addItem('partner_item', docData);
    setPartnerItems(prev => {
      // 로컬 state는 읽기 호환 위해 레거시 별칭도 함께 주입(메모리 내 157개 read 대비)
      const merged = { ...docData, Item_ID: itemId, Partner_ID: partnerId,
        ...(price !== undefined ? { Standard_Price: price } : {}) } as PartnerItem;
      const idx = prev.findIndex(p => p.id && p.id === docData.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = { ...prev[idx], ...merged }; return n; }
      return [...prev, merged];
    });
  };

  // partners 컬렉션

  const { fixedCosts, productionRecords } = adminData;

  const [pendingInvoice, setPendingInvoice] = useState<{ partnerId: string; partnerName: string; items: Array<{ name: string; spec: string; qty: number; price: number; isBox?: boolean }>; poIds?: string[] } | null>(null);
  const [docTab, setDocTab] = useState<'생산판매기록부' | '원료수불부' | '거래명세서' | '생산작업기록부' | '생산작업기록부2' | '벤조피렌' | 'haccp'>('생산판매기록부');
  const [docYearMonth, setDocYearMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [docLogMonth, setDocLogMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [bulkMfgDate, setBulkMfgDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [productionWorkCat, setProductionWorkCat] = useState('시골향참기름1');
  const [productionWorkMonth, setProductionWorkMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [prodLedger2Month, setProdLedger2Month] = useState(() => new Date().toISOString().slice(0, 7));
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [notifPanelPos, setNotifPanelPos] = useState({ top: 0, left: 0 });
  const notifBtnRef = useRef<HTMLButtonElement>(null);
  const [highlightOrderId, setHighlightOrderId] = useState<string | null>(null);
  const [openChatRoomId, setOpenChatRoomId] = useState<string | null>(null);
  const [rmActiveMaterial, setRmActiveMaterial] = useState('참깨');
  const [rmCorrectionTargetId, setRmCorrectionTargetId] = useState<string | null>(null);
  const [rmCorrectionForm, setRmCorrectionForm] = useState({ date: new Date().toISOString().slice(0, 10), amount: '', isNegative: true, note: '' });
  const [isMobile, setIsMobile] = useState(false);
  const [showQrLabel, setShowQrLabel] = useState(false);
  const [selectedLog, setSelectedLog] = useState<import('../../shared/types').ProductionSalesLog | null>(null);

  // 거래처 가입승인 대기 카운트 (web 홈페이지에서 가입한 users 중 status='pending')
  const [pendingSignupCount, setPendingSignupCount] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    const qy = query(collection(db, 'users'), where('status', '==', 'pending'));
    const unsub = onSnapshot(qy, (snap) => setPendingSignupCount(snap.size), () => setPendingSignupCount(0));
    return unsub;
  }, [isAdmin]);

  // 라이브 구독은 7일치만 → 서류관리 > 생산판매기록부 월별 조회를 위해 24개월치 온디맨드 로드
  const [extraProductionLogs, setExtraProductionLogs] = useState<import('../../shared/types').ProductionSalesLog[]>([]);
  useEffect(() => {
    const to = new Date().toISOString().slice(0, 10);
    const fromDate = new Date(); fromDate.setMonth(fromDate.getMonth() - 24);
    const from = fromDate.toISOString().slice(0, 10);
    fetchDateRange<import('../../shared/types').ProductionSalesLog>('productionSalesLogs', 'date', from, to)
      .then(setExtraProductionLogs)
      .catch(e => console.error('[AdminApp] 과거 생산판매기록 로드 실패:', e));
  }, []);
  const mergedProductionSalesLogs = useMemo(() => {
    const map = new Map<string, import('../../shared/types').ProductionSalesLog>();
    extraProductionLogs.forEach(l => map.set(l.id, l));
    productionSalesLogs.forEach(l => map.set(l.id, l));
    return Array.from(map.values());
  }, [productionSalesLogs, extraProductionLogs]);

  // 라이브 구독은 7일치만(무료요금제 읽기 절약) → 원료수불부는 전재고(이월 잔고) 계산에 전체 이력이 필요.
  // 수불부 탭을 열 때만 1회 온디맨드 조회하여 라이브 7일 구독분과 merge. (다른 페이지는 7일 유지)
  const [extraRawMaterialLedger, setExtraRawMaterialLedger] = useState<import('../../shared/types').RawMaterialEntry[]>([]);
  const [ledgerReloadKey, setLedgerReloadKey] = useState(0);
  // 읽기 절약: 탭 재진입마다 전체 이력을 다시 읽지 않고, 같은 reloadKey면 1회만 조회(캐시).
  // 최근 변경분은 라이브 7일 구독(rawMaterialLedger)으로 들어와 mergedRawMaterialLedger에 반영됨.
  const ledgerFetchedKeyRef = useRef<number | null>(null);
  useEffect(() => {
    if (docTab !== '원료수불부') return;
    if (ledgerFetchedKeyRef.current === ledgerReloadKey) return; // 이미 이 reloadKey로 로드함 → 재조회 생략
    ledgerFetchedKeyRef.current = ledgerReloadKey;
    const to = new Date().toISOString().slice(0, 10);
    fetchDateRange<import('../../shared/types').RawMaterialEntry>('rawMaterialLedger', 'date', '2020-01-01', to)
      .then(setExtraRawMaterialLedger)
      .catch(e => { console.error('[AdminApp] 원료수불부 전체 이력 로드 실패:', e); ledgerFetchedKeyRef.current = null; }); // 실패 시 다음 진입에 재시도
  }, [docTab, ledgerReloadKey]);
  const mergedRawMaterialLedger = useMemo(() => {
    const map = new Map<string, import('../../shared/types').RawMaterialEntry>();
    extraRawMaterialLedger.forEach(e => map.set(e.id, e));
    rawMaterialLedger.forEach(e => map.set(e.id, e));
    return Array.from(map.values());
  }, [rawMaterialLedger, extraRawMaterialLedger]);

  // 지난달 기말재고 스냅샷 자동 저장 (없을 때만)
  useEffect(() => {
    if (isDataLoading || !isAdmin) return;
    const now = new Date();
    let py = now.getFullYear(), pm = now.getMonth(); // getMonth()는 0-indexed → 이전 달
    if (pm === 0) { pm = 12; py -= 1; }
    const prevYm = `${py}-${String(pm).padStart(2, '0')}`;
    const already = inventorySnapshots.some(s => s.yearMonth === prevYm);
    if (already) return;
    const valued = allItems.filter(p => (p.stock ?? 0) > 0 || (p.cost ?? 0) > 0);
    const totalValue = valued.reduce((sum, p) => sum + (p.stock ?? 0) * (p.cost ?? 0), 0);
    addItem('inventorySnapshots', {
      id: `inv-snap-${prevYm}`,
      yearMonth: prevYm,
      value: totalValue,
      recordedAt: new Date().toISOString(),
      items: valued.map(p => ({ itemId: p.id, name: p.name, category: p.category as string, qty: p.stock ?? 0, value: Math.round((p.stock ?? 0) * (p.cost ?? 0)) })),
    });
  }, [isDataLoading]);

  // 모바일 감지
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth < 768) {
        setIsSidebarCollapsed(true); // 모바일에서는 기본적으로 사이드바 숨김
      }
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // partnerOut로부터 itemId → partnerIds[] 맵 생성
  const productClientMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const pc of partnerOut) {
      if (!pc.Item_ID || !pc.Partner_ID) continue;
      const arr = map.get(pc.Item_ID) ?? [];
      arr.push(pc.Partner_ID);
      map.set(pc.Item_ID, arr);
    }
    return map;
  }, [partnerOut]);

  // Combined products for UI — clientIds를 partnerOut 기반으로 조인
  const allItems = useMemo(() =>
    [...products, ...submaterials].map(p => ({
      ...p,
      partnerIds: productClientMap.get(p.id) ?? p.partnerIds ?? [],
    })),
    [products, submaterials, productClientMap]
  );

  // 수율(반제품 생산) 규칙 — 원재료(seed) → 파생 반제품 + 수율. item_formula에서 '부모가 원료홀더'인 행을 읽음.
  //   예: 통깨참기름 ← 참깨(0.45). 데이터가 없으면 기존 하드코딩값으로 폴백(무회귀).
  const yieldRules = useMemo(() => {
    const holderNames = new Set(
      allItems.filter(i => !i.phantom && (i.category === 'raw' || (i.category === 'wip' && i.unit !== '개')))
        .map(i => baseRawName(i.name))
    );
    const map: Record<string, { product: string; rate: number }> = {};
    for (const f of itemFormulas) {
      if (f.parent_key && holderNames.has(f.parent_key) && f.child_name) {
        map[f.child_name] = { product: f.parent_key, rate: (f.yield_rate ?? f.ratio ?? 1) };
      }
    }
    const fallback: Record<string, { product: string; rate: number }> = {
      '참깨': { product: '통깨참기름', rate: 0.45 },
      '깨분': { product: '깨분참기름', rate: 0.45 },
      '들깨': { product: '통들깨들기름', rate: 0.37 },
      '검정깨': { product: '볶음검정참깨', rate: 0.95 },
    };
    for (const k of Object.keys(fallback)) if (!map[k]) map[k] = fallback[k];
    return map;
  }, [itemFormulas, allItems]);

  // 배합식 전개(재귀)는 순수 도메인 모듈(bom.ts)로 분리. 여기선 현재 데이터로 얇게 감싸 호출.
  const buildFormula = (prodKey: string) => buildFormulaBom(prodKey, itemFormulas, allItems);

  const pendingPurchaseOrders = useMemo(() => purchaseOrders.filter(po => po.status === 'pending'), [purchaseOrders]);
  const invoicedPurchaseOrders = useMemo(() => purchaseOrders.filter(po => po.status === 'invoiced'), [purchaseOrders]);

  const lowStockCount = allItems.filter(p =>
    p.category !== 'product' && p.minStock > 0 && p.stock < p.minStock
  ).length;

  // 판매 상품(완제품/향미유/고춧가루)은 products, 부자재는 submaterials
  const getProductCollection = (_category: string) => 'items';

  // 원료 자동 사용량 (DELIVERED 주문 → 원료별·날짜별 집계)
  // itemFormulas가 있으면 Firestore item_formula 사용, 없으면 PRODUCT_FORMULA fallback
  const autoRawMaterialUsage = useMemo<Array<{material: string; date: string; used: number; note: string}>>(() => {
    const dayMap: Record<string, Record<string, { used: number; partners: string[] }>> = {};
    for (const o of allOrders.filter(o => o.status === OrderStatus.DELIVERED && o.deliveredAt)) {
      const dateStr = o.deliveredAt!.slice(0, 10);
      const partnerName = partners.find(c => c.id === o.partnerId)?.name || o.partnerName || '';
      for (const item of o.items) {
        const prod = allItems.find(p => p.id === item.itemId);
        if (!prod || prod.category !== 'product') continue;
        const prodKey = prod.품목 || prod.name;
        // Firestore BOM 우선, 없으면 하드코딩 fallback. phantom 반제품은 원료로 재귀 전개.
        const formula = buildFormula(prodKey);
        if (formula.length === 0) continue;
        for (const f of formula) {
          const usedKg = toKg(prod.spec || '', f.raw, item.quantity) * f.ratio;
          if (usedKg <= 0) continue;
          if (!dayMap[f.raw]) dayMap[f.raw] = {};
          if (!dayMap[f.raw][dateStr]) dayMap[f.raw][dateStr] = { used: 0, partners: [] };
          dayMap[f.raw][dateStr].used += usedKg;
          if (partnerName && !dayMap[f.raw][dateStr].partners.includes(partnerName)) dayMap[f.raw][dateStr].partners.push(partnerName);
        }
      }
    }
    const result: Array<{ material: string; date: string; used: number; note: string }> = [];
    for (const [mat, dates] of Object.entries(dayMap)) {
      for (const [date, { used, partners }] of Object.entries(dates)) {
        const note = partners.length === 0 ? '생산' : partners.length === 1 ? partners[0] : `${partners[0]} 외 ${partners.length - 1}`;
        result.push({ material: mat, date, used: Math.round(used * 1000) / 1000, note });
      }
    }
    return result;
  }, [orders, allItems, partners, itemFormulas]);

  // 재고 발주 관련 상태 (orderRequests는 useAppData에서 Firebase로 관리)

  const [pendingAdminView, setPendingAdminView] = useState<ViewType | null>(null);
  const [isAdminAuthModalOpen, setIsAdminAuthModalOpen] = useState(false);
  const [isAddOrderOpen, setIsAddOrderOpen] = useState(false);
  const [isPasteOrderOpen, setIsPasteOrderOpen] = useState(false);
  const [newOrderId, setNewOrderId] = useState<string | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Item | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => window.innerWidth < 768);


  // 완료/반려 후 1일 지난 확인사항 자동 삭제
  useEffect(() => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    adjustmentRequests.forEach(r => {
      if ((r.status === 'processed' || r.status === 'rejected') && r.processedAt && r.processedAt < oneDayAgo) {
        deleteItem('adjustmentRequests', r.id);
      }
    });
  }, [adjustmentRequests]);

  // 전표 발행된 선입고 이력은 발행 1일 뒤 자동 삭제 (목록 누적 방지 — 발행 시엔 유지)
  useEffect(() => {
    const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
    receivedOrders.forEach(po => {
      if (!po.linkedStatementId) return;
      const at = po.linkedStatementAt || issuedStatements.find(s => s.id === po.linkedStatementId)?.issuedAt;
      if (at && new Date(at).getTime() < oneDayAgoMs) deleteItem('purchaseOrders', po.id);
    });
  }, [receivedOrders, issuedStatements]);

  // 날짜가 바뀐 뒤 첫 접속 시 작업순서 자동 초기화 (주문 데이터는 유지)
  // Firestore에 초기화 날짜를 저장해 모든 기기에서 하루 1회만 실행
  useEffect(() => {
    const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }).replace(/\. /g, '-').replace('.', '');
    const resetRef = doc(db, 'appMeta', 'workOrderReset');
    getDoc(resetRef).then(snap => {
      const lastReset = snap.exists() ? snap.data().date : null;
      if (lastReset !== today) {
        getDocs(collection(db, 'workOrderItems')).then(snap => {
          Promise.all(snap.docs.map(d => deleteItem('workOrderItems', d.id)));
        });
        setDoc(resetRef, { date: today });
      }
    });
  }, []);

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
    for (const item of orderItems) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) continue;

      // 향미유: 재고는 박스 단위
      if (product.subtype === '향미유') {
        const sub = submaterials.find(s => s.id === product.id);
        if (sub) {
          const boxesNeeded = item.isBoxUnit && item.boxQuantity
            ? item.boxQuantity
            : Math.ceil(item.quantity / (product.boxSize || 1));
          usage[sub.id] = { name: sub.name, needed: (usage[sub.id]?.needed ?? 0) + boxesNeeded, unit: 'B' };
        }
        continue;
      }

      if (product.category !== 'product') continue;

      // 거래처별 포장 설정에서 박스/테이프 조회 (shippingRules 기반)
      const rule = partnerId ? shippingRules.find(r => r.item_id === product.id && r.partner_id === partnerId) : null;
      const unitsPerBox = rule?.qty_per_box || item.unitsPerBox || 1;
      const boxesNeeded = item.isBoxUnit && item.boxQuantity
        ? item.boxQuantity
        : Math.ceil(item.quantity / unitsPerBox);

      // 박스 부족 체크 (shippingRules 기반)
      if (rule?.box_item_id) {
        const boxSub = submaterials.find(sm => sm.id === rule.box_item_id);
        if (boxSub) {
          usage[boxSub.id] = { name: boxSub.name, needed: (usage[boxSub.id]?.needed ?? 0) + boxesNeeded, unit: '개' };
        }
      }

      // (테이프는 재고 차감·부족 경고 대상에서 제외 — 사용자 요청)

      // 박스·테이프 외 부자재 (BOM 기반)
      for (const s of (product.submaterials || [])) {
        const sub = submaterials.find(sm => sm.id === s.id);
        if (!sub || sub.category === 'box' || sub.category === 'tape' ||
            (sub.category === 'submaterial' && (sub.subtype === '박스' || sub.subtype === '테이프'))) continue;
        usage[sub.id] = { name: sub.name, needed: (usage[sub.id]?.needed ?? 0) + item.quantity, unit: '개' };
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
  };


  // 향미유 제품 시딩
  useEffect(() => {
    const seedFlavoredOil = async () => {
      const items = [
        { id: 'f1',   name: '참진한기름',   category: 'product', subtype: '향미유', partnerId: 'C001', stock: 0, minStock: 10, price: 0, unit: '개', image: '' },
        { id: 'f2',   name: '참고소한기름', category: 'product', subtype: '향미유', partnerId: 'C001', stock: 0, minStock: 10, price: 0, unit: '개', image: '' },
        { id: 'f3',   name: '참향기름',     category: 'product', subtype: '향미유', partnerId: 'C001', stock: 0, minStock: 5,  price: 0, unit: '개', image: '' },
        { id: 'f4',   name: '맛기름',       category: 'product', subtype: '향미유', partnerId: 'C001', stock: 0, minStock: 10, price: 0, unit: '개', image: '' },
        { id: 'f5',   name: '들향기름',     category: 'product', subtype: '향미유', partnerId: 'C001', stock: 0, minStock: 5,  price: 0, unit: '개', image: '' },
        { id: 'f6',   name: '들향기름골드', category: 'product', subtype: '향미유', partnerId: 'C001', stock: 0, minStock: 1,  price: 0, unit: '개', image: '' },
        { id: 'f2-1', name: '참고소(연한)', category: 'product', subtype: '향미유', partnerId: 'C001', stock: 0, minStock: 0,  price: 0, unit: '개', image: '' },
      ];
      for (const item of items) {
        const ref = doc(db, 'items', item.id);  // 향미유는 products에 저장
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          const { id, ...rest } = item;
          await setDoc(ref, rest);
        }
      }
    };
    seedFlavoredOil();
  }, []);

  // s-auto 접두사 중복 문서 정리
  useEffect(() => {
    const cleanupDuplicates = async () => {
      const snap = await getDocs(collection(db, 'items'));
      for (const d of snap.docs) {
        if (d.id.startsWith('s-auto')) {
          await deleteDoc(doc(db, 'items', d.id));
          console.log('삭제됨:', d.id);
        }
      }
    };
    cleanupDuplicates();
  }, []);

  // --- 재고 관리 핸들러 (purchaseOrders 기반) ---
  const handleAddOrderRequest = async (id: string, quantity: number, isBox?: boolean) => {
    // append-only: 발주할 때마다 새 발주카드 추가
    const product = allItems.find(p => p.id === id);
    const ps = partnerIn.find(s => s.Item_ID === id || (s as any).itemId === id);
    const partnerId = ps?.Partner_ID || (ps as any)?.partnerId;
    const partnerName = partnerId ? partners.find(c => c.id === partnerId)?.name : undefined;
    await addItem('purchaseOrders', {
      id: `po-${Date.now()}`, itemId: id, itemName: product?.name ?? '',
      quantity, isBox: isBox ?? false, status: 'pending',
      confirmedByUser: true, createdAt: new Date().toISOString(),
      ...(partnerId ? { partnerId, partnerName } : {}),
    });
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
  const handleBulkAddConfirmedOrders = async (items: { id: string, quantity: number, isBox?: boolean }[]) => {
    const base = Date.now();
    const createdAt = new Date().toISOString();
    // 거래처별 묶음 (partnerId 없으면 품목별 개별 카드)
    const groups = new Map<string, { partnerId?: string; partnerName?: string; items: typeof items }>();
    items.forEach((item, idx) => {
      const ps = partnerIn.find(s => s.Item_ID === item.id || (s as any).itemId === item.id);
      const partnerId = ps?.Partner_ID || (ps as any)?.partnerId;
      const partnerName = partnerId ? partners.find(c => c.id === partnerId)?.name : undefined;
      const key = partnerId || `__none_${idx}`;
      if (!groups.has(key)) groups.set(key, { partnerId, partnerName, items: [] });
      groups.get(key)!.items.push(item);
    });
    let gi = 0;
    for (const g of groups.values()) {
      const poItems = g.items.map(it => {
        const product = allItems.find(p => p.id === it.id);
        return { itemId: it.id, name: product?.name ?? '', quantity: it.quantity, unit: product?.unit ?? '개', isBox: it.isBox ?? false };
      });
      await addItem('purchaseOrders', {
        id: `po-${base}-${gi++}`, itemId: '', itemName: '', quantity: 0,
        items: poItems, status: 'pending', createdAt,
        ...(g.partnerId ? { partnerId: g.partnerId, partnerName: g.partnerName } : {}),
      });
    }
  };

  // 발주예정 → 입고대기(invoiced)로 직접 확정 (전표 없이)
  // item.id는 PO 문서 ID (UUID 또는 itemId)
  const handleConfirmPendingToInvoiced = async (items: { id: string, quantity: number, isBox?: boolean }[]) => {
    for (const item of items) {
      const po = purchaseOrders.find(po => po.id === item.id);
      if (!po) continue;
      const ps = partnerIn.find(s => s.Item_ID === (po.itemId ?? po.id) || (s as any).itemId === (po.itemId ?? po.id));
      const partnerId = ps?.Partner_ID || (ps as any)?.partnerId;
      const partnerName = partnerId ? partners.find(c => c.id === partnerId)?.name : undefined;
      await updateItem('purchaseOrders', item.id, {
        status: 'invoiced', invoicedAt: new Date().toISOString(),
        ...(partnerId && !po.partnerId ? { partnerId, partnerName } : {}),
      });
    }
  };

  const handleUpdateOrderRequestIsBox = async (id: string, isBox: boolean) => {
    await updateItem('purchaseOrders', id, { isBox });
  };

  // 출고 완료 시 완제품 품목별로 생산 실적 자동 기록
  const createProductionRecordsForOrder = async (order: Order) => {
    const finishedItems = order.items.filter(item => {
      const p = allItems.find(pr => pr.id === item.itemId);
      return p && p.category === 'product';
    });
    for (const item of finishedItems) {
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) continue;
      const record: ProductionRecord = {
        id: `pr-${order.id}-${item.itemId}-${Date.now()}`,
        date: (order.deliveredAt ?? new Date().toISOString()).slice(0, 10),
        itemId: item.itemId,
        itemName: product.name,
        finishedQty: item.quantity,
        ...(product.cost !== undefined ? { cost: product.cost } : {}),
        note: `주문 자동 연동 (${order.partnerName})`,
        createdAt: new Date().toISOString(),
      };
      await addItem('productionRecords', record);
    }
  };

  // 반품 처리: 재판매 가능 품목 재고 복귀 + 전표 미수금 차감
  const handleProcessReturn = async (req: ReturnRequest) => {
    for (const item of req.items) {
      if (!item.isResellable) continue;
      const product = allItems.find(p => p.id === item.itemId);
      if (!product) continue;
      const target = rawLotTarget(allItems, product, product.name);
      if (target) {
        // 원료 반품 재입고: 입고 로트 + 수불부 (stock 직접 X)
        const nowIso = new Date().toISOString();
        await recordRawMaterialReceipt({ allItems, product, itemName: product.name, quantity: item.quantity, unit: product.unit, partnerName: '반품', dateStr: nowIso.slice(0, 10), nowIso, addedBy: currentUser?.name });
      } else {
        const col = getProductCollection(product.category as string);
        await updateItem(col, product.id, { stock: product.stock + item.quantity });
      }
    }

    if (req.linkedStatementId && req.totalAmount > 0) {
      const stmt = issuedStatements.find(s => s.id === req.linkedStatementId);
      if (stmt) {
        const newPayment: PaymentRecord = {
          id: `return-${req.id}-${Date.now()}`,
          amount: -req.totalAmount,
          date: new Date().toISOString().slice(0, 10),
          method: '기타',
          note: `반품 처리 (${req.items.map(i => i.name).join(', ')})`,
        };
        await updateItem('issuedStatements', stmt.id, {
          payments: [...(stmt.payments ?? []), newPayment],
        });
      }
    }

    await updateItem('returnRequests', req.id, {
      status: 'processed',
      processedAt: new Date().toISOString(),
      processedBy: currentUser.name,
    });
  };

  // ── 생산/출고 분리 재고 엔진 → 도메인 모듈(orderStockEngine)로 분리. 매 렌더 데이터/쓰기 함수 주입. ──
  const { changeOrderStatus } = createOrderStockEngine({
    allItems, shippingRules, submaterials, partners, allOrders, orders, db,
    buildFormula, createProductionRecordsForOrder, mutateRawMaterialLots, updateItem, addItem,
  });

  const handleRemoveConfirmedOrder = async (id: string) => {
    await deleteItem('purchaseOrders', id);
  };

  const handleClearAllConfirmedOrders = async () => {
    for (const po of invoicedPurchaseOrders) {
      await deleteItem('purchaseOrders', po.id);
    }
  };

  const handleFinishConfirmedOrder = async (id: string) => {
    const po = purchaseOrders.find(po => po.id === id);
    if (!po) return;
    const nowIso = new Date().toISOString();
    const dateStr = nowIso.slice(0, 10);
    // 묶음/단일 품목 모두 처리: 원료(raw)에 귀속되면 로트+수불부, 아니면 SKU 재고 가산
    for (const line of poLines(po)) {
      const product = allItems.find(p => p.id === line.itemId);
      if (!product) continue;
      const isRawLinked = !!rawLotTarget(allItems, product, product.name);
      if (isRawLinked) {
        // 원료 로트가 재고를 소유 → SKU stock 누적 안 하고 로트+수불부로 기록
        try {
          await recordRawMaterialReceipt({
            allItems, product, itemName: product.name, quantity: line.quantity, unit: product.unit,
            partnerId: po.partnerId, partnerName: po.partnerName || '거래처', dateStr, nowIso, poId: id, addedBy: currentUser?.name,
          });
        } catch (err) {
          console.error('[입고확인] 원료 로트/수불부 기록 실패:', product.name, err);
          alert(`⚠️ "${product.name}" 원료 재고/수불부 기록 실패\n사유: ${(err as Error)?.message ?? String(err)}\n\n입고확인은 됐지만 원료 로트가 안 잡혔습니다. (Firebase 한도 초과 등) 잠시 후 다시 시도하거나 관리자에게 알려주세요.`);
        }
      } else {
        const collectionName = getProductCollection(product.category);
        const addQty = (product.subtype === '향미유' || product.category === '향미유') && line.isBox ? line.quantity * 12 : line.quantity;
        await updateItem(collectionName, product.id, { stock: (product.stock ?? 0) + addQty });
      }
    }
    await updateItem('purchaseOrders', id, { status: 'received', receivedAt: new Date().toISOString() });
  };

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
        const product = allItems.find(p => (p.품목 || p.name) === it.name);
        const newQty = product ? qtyByItemId.get(product.id) : undefined;
        if (newQty === undefined || newQty === it.qty) { newItems.push(it); continue; }
        changes.push({ name: it.name, oldQty: it.qty, newQty });
        if (newQty <= 0) continue; // 0 = 품목 삭제
        const unitSupply = it.qty !== 0 ? it.supply / it.qty : 0;
        const supply = Math.round(unitSupply * newQty);
        const tax = it.isTaxExempt ? 0 : Math.round(supply * 0.1);
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

    // 즉시 입고확정: 새 수량으로 원료 로트/수불부 또는 SKU 재고 반영 + received 전환
    const newPoItems = poLines(po)
      .map(l => ({ ...l, quantity: qtyByItemId.get(l.itemId) ?? l.quantity }))
      .filter(l => l.quantity > 0);
    const nowIso2 = new Date().toISOString();
    const dateStr2 = nowIso2.slice(0, 10);
    for (const line of newPoItems) {
      const product = allItems.find(p => p.id === line.itemId);
      if (!product) continue;
      if (rawLotTarget(allItems, product, product.name)) {
        try {
          await recordRawMaterialReceipt({
            allItems, product, itemName: product.name, quantity: line.quantity, unit: product.unit,
            partnerId: po.partnerId, partnerName: po.partnerName || '거래처', dateStr: dateStr2, nowIso: nowIso2, poId, addedBy: currentUser?.name,
          });
        } catch (err) {
          console.error('[입고확정-수정] 원료 로트/수불부 기록 실패:', product.name, err);
          alert(`⚠️ "${product.name}" 원료 재고/수불부 기록 실패\n사유: ${(err as Error)?.message ?? String(err)}\n\n입고확정은 됐지만 원료 로트가 안 잡혔습니다. (Firebase 한도 초과 등) 잠시 후 다시 시도하세요.`);
        }
      } else {
        const collectionName = getProductCollection(product.category);
        const addQty = (product.subtype === '향미유' || product.category === '향미유') && line.isBox ? line.quantity * 12 : line.quantity;
        await updateItem(collectionName, product.id, { stock: (product.stock ?? 0) + addQty });
      }
    }
    await updateItem('purchaseOrders', poId, { items: newPoItems, status: 'received', receivedAt: new Date().toISOString() });
  };

  const handleToggleItemChecked = async (orderId: string, itemIdx: number, checkedBy?: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const newItems = [...order.items];
    const isChecking = !newItems[itemIdx].checked;
    const { checkedBy: _old, ...baseItem } = newItems[itemIdx];
    newItems[itemIdx] = isChecking
      ? { ...baseItem, checked: true, ...(checkedBy ? { checkedBy } : {}) }
      : { ...baseItem, checked: false };
    const allChecked = newItems.every(i => i.checked);
    const wasNotDispatched = order.status !== OrderStatus.DISPATCHED && order.status !== OrderStatus.SHIPPED && order.status !== OrderStatus.ON_HOLD;
    if (allChecked && wasNotDispatched) {
      // 모두 체크 → 작업완료 자동 이동 + 생산처리(원료·부자재 차감, 완제품 재고 +N).
      await updateItem('orders', orderId, { items: newItems });
      await changeOrderStatus(orderId, OrderStatus.DISPATCHED);
    } else {
      updateItem('orders', orderId, { items: newItems });
    }
  };

  const handleUpdateItems = (orderId: string, items: OrderItem[]) => {
    updateItem('orders', orderId, { items });
  };

  // PRODUCT_FORMULA → Firestore item_formula 시딩 (최초 1회)
  const seedItemFormulas = async () => {
    if (itemFormulas.length > 0) {
      alert(`이미 item_formula에 ${itemFormulas.length}개 항목이 있습니다.`);
      return;
    }
    const batch = writeBatch(db);
    let count = 0;
    for (const [parentKey, rows] of Object.entries(PRODUCT_FORMULA)) {
      for (const row of rows) {
        const id = `formula-${parentKey}-${row.raw}`.replace(/\s/g, '_');
        batch.set(doc(db, 'item_formula', id), {
          parent_key: parentKey,
          child_name: row.raw,
          ratio: row.ratio,
          yield_rate: 1.0,
        });
        count++;
      }
    }
    await batch.commit();
    alert(`item_formula 시딩 완료: ${count}개 항목`);
  };

  const handleNavClick = (view: ViewType) => {
    const adminOnlyViews: ViewType[] = ['hr', 'dashboard', 'ai-consultant', 'cost-management', 'profit-analysis', 'production', 'admin-checklist', 'smartstore-analytics', 'haccp-checklist', 'partner-stats', 'cash-flow', 'file-cabinet'];
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

  return (
    <div className="flex overflow-hidden bg-slate-50" style={{ height: '100dvh' }}>
      {/* 모바일 오버레이 배경 — 항상 렌더, opacity로 fade 트랜지션 */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 md:hidden ${
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
            <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setCurrentView(isAdmin ? 'dashboard' : 'orders')}>
              <div className="w-10 h-10 bg-cyan-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-cyan-200 flex-shrink-0">
                <svg width="22" height="22" viewBox="0 0 32 32" fill="none"><path d="M4 16C4 16 8 8 16 8C24 8 28 16 28 16" stroke="white" strokeWidth="3" strokeLinecap="round"/><path d="M22 12L28 16L22 20" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><circle cx="16" cy="22" r="3" fill="white"/></svg>
              </div>
              <div className={`overflow-hidden transition-all duration-200 ${isSidebarCollapsed ? 'opacity-0 w-0' : 'opacity-100'}`}>
                <p className="text-xs font-black uppercase tracking-widest text-cyan-600 leading-none">Flow-It</p>
                <p className="text-sm font-bold text-slate-700 leading-tight mt-0.5 whitespace-nowrap">{companyInfo?.name ?? '태백식품'} {isAdmin ? '관리자 센터' : ''}</p>
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
            const unread = appNotifications.filter(n => !n.readBy.includes(currentUser.id) && (!n.targetId || n.targetId === currentUser.id));
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
          {isAdmin && onPreviewStaff && (
            <div className={`mb-2 ${isSidebarCollapsed ? 'flex justify-center' : ''}`}>
              {isSidebarCollapsed ? (
                <button onClick={onPreviewStaff} title="직원 뷰로 보기"
                  className="w-9 h-9 rounded-xl bg-cyan-50 hover:bg-cyan-100 flex items-center justify-center transition-colors">
                  <ExternalLink size={15} className="text-cyan-600" />
                </button>
              ) : (
                <button onClick={onPreviewStaff}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 text-cyan-700 text-xs font-bold transition-colors">
                  <ExternalLink size={13} />
                  직원 뷰로 보기
                </button>
              )}
            </div>
          )}

          {/* 직원 뷰 미리보기 종료 배너 */}
          {!isAdmin && onExitPreview && (
            <div className={`mb-2 ${isSidebarCollapsed ? 'flex justify-center' : ''}`}>
              {isSidebarCollapsed ? (
                <button onClick={onExitPreview} title="관리자로 돌아가기"
                  className="w-9 h-9 rounded-xl bg-amber-50 hover:bg-amber-100 flex items-center justify-center transition-colors">
                  <ShieldCheck size={15} className="text-amber-600" />
                </button>
              ) : (
                <button onClick={onExitPreview}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-xs font-bold transition-colors">
                  <ShieldCheck size={13} />
                  관리자로 돌아가기
                </button>
              )}
            </div>
          )}

          {/* 계정 정보 (클릭 → 로그아웃) */}
          <div
            className={`mb-6 cursor-pointer group ${isSidebarCollapsed ? 'flex justify-center' : ''}`}
            onClick={() => window.confirm(`${currentUser.name}님, 로그아웃 하시겠습니까?`) && onLogout()}
            title="클릭하여 로그아웃"
          >
            {isSidebarCollapsed ? (
              <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-sm overflow-hidden group-hover:ring-2 group-hover:ring-rose-400 transition-all">
                <img src={`https://picsum.photos/seed/${currentUser.id}/36/36`} alt="profile" />
              </div>
            ) : (
              <div className="flex items-center space-x-3 bg-slate-50 group-hover:bg-rose-50 rounded-2xl px-3 py-2.5 border border-slate-100 group-hover:border-rose-200 transition-all">
                <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-sm overflow-hidden shrink-0">
                  <img src={`https://picsum.photos/seed/${currentUser.id}/32/32`} alt="profile" />
                </div>
                <div className="overflow-hidden flex-1">
                  <p className="text-xs font-bold text-slate-700 truncate group-hover:text-rose-600 transition-colors">{currentUser.name}</p>
                  <p className="text-[9px] text-slate-400 font-medium uppercase tracking-tighter truncate">{currentUser.department} · {currentUser.position}</p>
                </div>
                <LogOut size={13} className="text-slate-300 group-hover:text-rose-400 shrink-0 transition-colors" />
              </div>
            )}
          </div>
          
          <div className="flex-1 min-h-0 space-y-8 overflow-y-auto no-scrollbar">

            {/* ── 사장님(Admin) 전용: 경영 현황 ── */}
            {isAdmin && (() => {
              const adminPendingCount =
                leaveRequests.filter(r => r.status === 'pending' || r.status === 'cancel_pending' || r.modifyRequest?.status === 'pending').length +
                adjustmentRequests.filter(r => r.status === 'pending').length +
                receivedOrders.filter(r => !r.linkedStatementId).length;
              return (
                <>
                  <div>
                    {!isSidebarCollapsed && <p className="px-4 mb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">경영 현황</p>}
                    <nav className="space-y-1">
                      <NavItem icon={LayoutDashboard} label="대시보드" active={currentView === 'dashboard' || currentView === 'ai-consultant'} onClick={() => handleNavClick('dashboard')} collapsed={isSidebarCollapsed} />
                      <NavItem icon={BarChart2} label="손익 / 비용 분석" active={currentView === 'profit-analysis' || currentView === 'cost-management'} onClick={() => handleNavClick('profit-analysis')} collapsed={isSidebarCollapsed} />
                      <NavItem icon={TrendingUp} label="거래처통계" active={currentView === 'partner-stats'} onClick={() => handleNavClick('partner-stats')} collapsed={isSidebarCollapsed} />
                      <NavItem icon={Activity} label="현금흐름 분석" active={currentView === 'cash-flow'} onClick={() => handleNavClick('cash-flow')} collapsed={isSidebarCollapsed} />
                      <NavItem icon={Factory} label="생산 실적" active={currentView === 'production'} onClick={() => handleNavClick('production')} collapsed={isSidebarCollapsed} />
                      <NavItem icon={ShoppingBag} label="스마트스토어 분석" active={currentView === 'smartstore-analytics'} onClick={() => handleNavClick('smartstore-analytics')} collapsed={isSidebarCollapsed} />
                      <NavItem icon={ClipboardList} label="HACCP 체크리스트" active={currentView === 'haccp-checklist'} onClick={() => handleNavClick('haccp-checklist')} collapsed={isSidebarCollapsed} />
                    </nav>
                  </div>
                  <div>
                    {!isSidebarCollapsed && <p className="px-4 mb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">업무 관리</p>}
                    <nav className="space-y-1">
                      <NavItem icon={FileText} label="거래명세서" active={currentView === 'trade-statement'} onClick={() => handleNavClick('trade-statement')} collapsed={isSidebarCollapsed} />
                      <NavItem icon={Receipt} label="세금계산서" active={currentView === 'tax-statement'} onClick={() => handleNavClick('tax-statement')} collapsed={isSidebarCollapsed} />
                      <NavItem icon={Package} label="품목 관리" active={currentView === 'item-management'} onClick={() => handleNavClick('item-management')} collapsed={isSidebarCollapsed} />
                      <NavItem icon={UserCheck} label="인사 관리" active={currentView === 'hr'} onClick={() => handleNavClick('hr')} collapsed={isSidebarCollapsed} />
                      <NavItem icon={FileText} label="서류 관리" active={currentView === 'documents'} onClick={() => handleNavClick('documents')} collapsed={isSidebarCollapsed} />
                      <NavItem icon={FolderOpen} label="문서함" active={currentView === 'file-cabinet'} onClick={() => handleNavClick('file-cabinet')} collapsed={isSidebarCollapsed} />
                      <NavItem icon={Users} label="거래처 관리" active={currentView === 'partners'} onClick={() => handleNavClick('partners')} collapsed={isSidebarCollapsed} />
                      <NavItem icon={UserPlus} label="거래처 가입승인" active={currentView === 'partner-signup'} onClick={() => handleNavClick('partner-signup')} collapsed={isSidebarCollapsed} badge={pendingSignupCount > 0 ? pendingSignupCount : undefined} />
                      <NavItem icon={ClipboardList} label="확인사항" active={currentView === 'admin-checklist'} onClick={() => handleNavClick('admin-checklist')} collapsed={isSidebarCollapsed} badge={adminPendingCount > 0 ? adminPendingCount : undefined} />
                      <NavItem icon={QrCode} label="QR 라벨 인쇄" active={false} onClick={() => setShowQrLabel(true)} collapsed={isSidebarCollapsed} />
                    </nav>
                  </div>
                  <div>
                    {!isSidebarCollapsed && <p className="px-4 mb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">외부 서비스</p>}
                    <nav className="space-y-1">
                      <button
                        onClick={openPartnerPortal}
                        title={isSidebarCollapsed ? "거래처 주문 포털" : undefined}
                        className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between px-4'} py-3 rounded-xl text-slate-500 hover:bg-cyan-50 hover:text-cyan-600 transition-all group`}
                      >
                        <div className="flex items-center space-x-3">
                          <Globe size={18} />
                          {!isSidebarCollapsed && <span className="text-sm font-medium">거래처 주문 포털</span>}
                        </div>
                        {!isSidebarCollapsed && <ExternalLink size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                      </button>
                    </nav>
                  </div>
                </>
              );
            })()}

            {/* ── 일반 직원: 현장 운영 메뉴 ── */}
            {!isAdmin && (
              <>
                <div>
                  {!isSidebarCollapsed && <p className="px-4 mb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">운영 관리</p>}
                  <nav className="space-y-1">
                    <NavItem icon={BellRing} label="공지사항" active={currentView === 'notice'} onClick={() => handleNavClick('notice')} collapsed={isSidebarCollapsed} />
                    <NavItem icon={MessageSquare} label="오피스톡" active={currentView === 'officetalk'} onClick={() => handleNavClick('officetalk')} collapsed={isSidebarCollapsed} badge={chatRooms.filter(r => r.participantIds.includes(currentUser.id) && r.lastUpdatedAt > (r.lastReadBy?.[currentUser.id] ?? '')).length || undefined} />
                    <NavItem icon={Truck} label="배송 관리" active={currentView === 'shipping'} onClick={() => handleNavClick('shipping')} collapsed={isSidebarCollapsed} />
                    <NavItem icon={ShoppingCart} label="주문 관리" active={currentView === 'orders'} onClick={() => handleNavClick('orders')} collapsed={isSidebarCollapsed} />
                    <NavItem icon={Package} label="재고 관리" active={currentView === 'inventory'} onClick={() => handleNavClick('inventory')} collapsed={isSidebarCollapsed} badge={(lowStockCount > 0 ? lowStockCount : 0) + returnRequests.filter(r => r.status === 'pending').length + receivedOrders.filter(r => !r.linkedStatementId).length || undefined} />
                    <NavItem icon={Package} label="품목 관리" active={currentView === 'item-management'} onClick={() => handleNavClick('item-management')} collapsed={isSidebarCollapsed} />
                    <NavItem icon={Layers} label="파렛트 관리" active={currentView === 'pallets'} onClick={() => handleNavClick('pallets')} collapsed={isSidebarCollapsed} />
                    <NavItem icon={CalendarCheck} label="연차 신청" active={currentView === 'leave-portal'} onClick={() => handleNavClick('leave-portal')} collapsed={isSidebarCollapsed} />
                    <NavItem icon={ShieldCheck} label="확인사항" active={currentView === 'confirmation-items'} onClick={() => handleNavClick('confirmation-items')} collapsed={isSidebarCollapsed} />
                    <NavItem icon={ShieldAlert} label="작업장 위생점검" active={currentView === 'sanitation-checklist'} onClick={() => handleNavClick('sanitation-checklist')} collapsed={isSidebarCollapsed} />
                    <NavItem icon={FileText} label="서류 관리" active={currentView === 'documents'} onClick={() => handleNavClick('documents')} collapsed={isSidebarCollapsed} />
                  </nav>
                </div>
                <div>
                  {!isSidebarCollapsed && <p className="px-4 mb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">외부 서비스</p>}
                  <nav className="space-y-1">
                    <button
                      onClick={openPartnerPortal}
                      title={isSidebarCollapsed ? "거래처 주문 포털" : undefined}
                      className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between px-4'} py-3 rounded-xl text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 transition-all group`}
                    >
                      <div className="flex items-center space-x-3">
                        <Globe size={18} />
                        {!isSidebarCollapsed && <span className="text-sm font-medium">거래처 주문 포털</span>}
                      </div>
                      {!isSidebarCollapsed && <ExternalLink size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
                    </button>
                  </nav>
                </div>
              </>
            )}

          </div>

        </div>
      </aside>

      <main className={`flex-1 flex flex-col min-w-0 overflow-hidden transition-all duration-300 ${isMobile ? '' : (isSidebarCollapsed ? 'ml-20' : 'ml-64')}`} style={{ height: '100dvh' }}>
        {/* 모바일 헤더 */}
        <header className="md:hidden bg-white border-b border-slate-200 px-3 flex items-center gap-2" style={{ paddingTop: `max(0.75rem, env(safe-area-inset-top))`, paddingBottom: '0.75rem' }}>
          <button
            onClick={() => setIsSidebarCollapsed(false)}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 shrink-0"
          >
            <Menu size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-slate-800 truncate">
              {(({
                'dashboard': '비즈니스 현황', 'ai-consultant': 'AI 인사이트',
                'orders': '주문 관리', 'shipping': '배송 관리', 'inventory': '재고 관리',
                'pallets': '파렛트 관리', 'hr': '인사 관리', 'partners': '거래처 관리',
                'notice': '공지사항', 'documents': '서류 관리', 'trade-statement': '거래명세서', 'tax-statement': '세금계산서',
                'profit-analysis': '손익 / 비용 분석', 'cost-management': '비용 관리', 'partner-stats': '거래처통계', 'cash-flow': '현금흐름 분석',
                'production': '생산 실적', 'admin-checklist': '확인사항',
                'leave-portal': '연차 신청', 'confirmation-items': '확인사항',
                'item-management': '품목 관리', 'item-price-management': '품목 관리',
                'inbound-scan': '입고 스캔', 'partner-portal': '거래처 포털',
                'officetalk': '오피스톡', 'smartstore-analytics': '스마트스토어 분석',
                'haccp-checklist': 'HACCP 체크리스트', 'return-management': '반품 관리',
                'inbound-returns': '입고 / 반품', 'sanitation-checklist': '작업장 위생점검표',
              } as Record<string, string>)[currentView]) ?? ''}
            </p>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-3 md:p-4 lg:p-6 custom-scrollbar">
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
          <div className={(['orders', 'officetalk', 'leave-portal', 'inventory', 'partners', 'notice', 'pallets', 'confirmation-items', 'shipping', 'production', 'inbound-scan', 'return-management', 'sanitation-checklist'].includes(currentView)) ? '' : 'h-full'}>
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
          {currentView === 'shipping' && (
            <DeliveryManager
              orders={orders}
              partners={partners}
              items={allItems}
              onUpdateDeliveryDate={(id, date) => updateItem('orders', id, { deliveryDate: date })}
              onUpdateStatus={(id, status) => changeOrderStatus(id, status)}
              onUpdateItems={handleUpdateItems}
              onToggleItemChecked={handleToggleItemChecked}
              onDeleteOrder={(id) => {
                const o = orders.find(x => x.id === id);
                if (o?.status === OrderStatus.DELIVERED) { alert('예전 주문은 삭제할 수 없습니다.'); return; }
                deleteItem('orders', id);
              }}
            />
          )}
          {currentView === 'orders' && (
            <OrdersList
              orders={allOrders}
              partners={partners}
              items={allItems}
              partnerItems={partnerItems}
              shippingRules={shippingRules}
              itemBoms={itemBoms}
              isLoadingHistoricalOrders={isLoadingHistoricalOrders}
              onLoadHistoricalOrders={loadHistoricalOrders}
              ordersMonths={ordersMonths}
              onChangeOrdersMonths={setOrdersMonths}
              onDeleteOrder={(id) => {
                const o = allOrders.find(x => x.id === id);
                if (o?.status === OrderStatus.DELIVERED) { alert('예전 주문은 삭제할 수 없습니다.'); return; }
                deleteItem('orders', id);
              }}
              onAddClick={() => setIsAddOrderOpen(true)}
              onPasteClick={() => setIsPasteOrderOpen(true)}
              title="주문 관리"
              subtitle="전체 주문 현황"
              groupBy="status" 
              allowedStatuses={Object.values(OrderStatus)} 
              onUpdateStatus={(id, status) => changeOrderStatus(id, status)}
              onUpdateDeliveryDate={(id, date) => updateItem('orders', id, { deliveryDate: date })}
              onUpdatePallets={(id, p) => updateItem('orders', id, { pallets: p })}
              palletStocks={pallets}
              onToggleItemChecked={handleToggleItemChecked}
              onUpdateItems={handleUpdateItems}
              onUpdateDeliveryBoxes={(id, boxes) => updateItem('orders', id, { deliveryBoxes: boxes })}
              onToggleInvoicePrinted={(id, value) => updateItem('orders', id, { invoicePrinted: value })}
              currentUserName={currentUser?.name}
              highlightOrderId={highlightOrderId}
              onHighlightClear={() => setHighlightOrderId(null)}
              newOrderId={newOrderId}
              onNewOrderIdClear={() => setNewOrderId(null)}
              workOrderItems={workOrderItems}
              onSetWorkOrderItems={async (items) => {
                // 기존 항목 전체 삭제 후 새 항목 저장
                await Promise.all(workOrderItems.map(w => deleteItem('workOrderItems', w.id)));
                await Promise.all(items.map((item, idx) =>
                  addItem('workOrderItems', { ...item, id: `wo-${Date.now()}-${idx}`, sortIndex: idx })
                ));
              }}
            />
          )}
          {currentView === 'inventory' && (
            <>
            <BomIntegrityPanel items={allItems} itemFormulas={itemFormulas} />
            <ItemList
              items={allItems}
              onUpdateItem={async (p) => {
                await updateItem(getProductCollection(p.category), p.id, p);
              }}
              onAddItem={(p) => addItem(getProductCollection(p.category), p)} 
              orderRequests={pendingPurchaseOrders}
              confirmedOrders={invoicedPurchaseOrders}
              onAddOrderRequest={handleAddOrderRequest}
              onRemoveOrderRequest={handleRemoveOrderRequest}
              onUpdateOrderRequestQty={handleUpdateOrderRequestQty}
              onUpdatePoItemQty={handleUpdatePoItemQty}
              onRemovePoItem={handleRemovePoItem}
              onRequestPoEdit={handleRequestPoEdit}
              onUpdateOrderRequestIsBox={handleUpdateOrderRequestIsBox}
              onToggleConfirmRequestQty={handleToggleConfirmRequestQty}
              onConfirmRequest={(id: string) => { const r = pendingPurchaseOrders.find(r => r.id === id); handleConfirmPendingToInvoiced([{ id, quantity: r?.quantity || 0, isBox: r?.isBox }]); }}
              onConfirmRequests={(ids: string[]) => handleConfirmPendingToInvoiced(pendingPurchaseOrders.filter(r => ids.includes(r.id)).map(r => ({id: r.id, quantity: r.quantity, isBox: r.isBox})))}
              onBulkAddConfirmedOrders={handleBulkAddConfirmedOrders}
              onConfirmAllRequests={async () => { await handleConfirmPendingToInvoiced(pendingPurchaseOrders.map(r => ({id: r.id, quantity: r.quantity, isBox: r.isBox}))); }}
              onFinishConfirmedOrder={handleFinishConfirmedOrder}
              onFinishConfirmedOrders={(ids: string[]) => ids.forEach(handleFinishConfirmedOrder)}
              onFinishAllConfirmedOrders={() => invoicedPurchaseOrders.forEach(c => handleFinishConfirmedOrder(c.id))}
              onUpdateConfirmedQty={(id: string, qty: number) => updateItem('purchaseOrders', id, { quantity: qty })}
              onRemoveConfirmedOrder={handleRemoveConfirmedOrder}
              onClearAllConfirmedOrders={handleClearAllConfirmedOrders}
              onEditProduct={(p) => { setEditingProduct(p); setIsProductModalOpen(true); }}
              onDeleteItem={(id) => {
                const inProducts = items.some(p => p.id === id);
                deleteItem(inProducts ? 'items' : 'items', id);
              }}
              onAddAdjustmentRequest={(req) => addItem('adjustmentRequests', req)}
              inboundPartners={partners.filter(c => c.partnerType === '매입처' || c.partnerType === '매출+매입처')}
              partnerItems={partnerItems}
              partners={partners}
              currentUser={currentUser}
              isAdmin={isAdmin}
              issuedStatements={issuedStatements}
              onMarkStatementReceived={async (id) => {
                const stmt = issuedStatements.find(s => s.id === id);
                if (stmt && stmt.type === '매입') {
                  for (const item of stmt.items) {
                    const product = allItems.find(p => p.name === item.name);
                    if (product) {
                      const col = getProductCollection(product.category);
                      const addQty = item.isBoxUnit ? item.qty * (item.boxSize || 12) : item.qty;
                      await updateItem(col, product.id, { stock: product.stock + addQty });
                      // purchaseOrder도 received 상태로 업데이트
                      const po = purchaseOrders.find(po => po.itemId === product.id && po.status === 'invoiced');
                      if (po) await updateItem('purchaseOrders', po.id, { status: 'received', receivedAt: new Date().toISOString() });
                    }
                  }
                }
                await updateItem('issuedStatements', id, { receivedAt: new Date().toISOString() });
              }}
              onRequestPurchaseInvoice={(partnerId, partnerName, items) => {
                setPendingInvoice({ partnerId, partnerName, items });
                setCurrentView('trade-statement');
              }}
              rawMaterialLedger={rawMaterialLedger}
              autoUsageEntries={autoRawMaterialUsage}
              onAddRawMaterialEntry={async (entry) => {
                await addItem('rawMaterialLedger', entry);
                // 수율 파생 입고 자동 추가 — 규칙은 item_formula 데이터(yieldRules)에서 읽음(하드코딩 폴백).
                //   참깨/들깨/깨분: 압착 사용 시 파생 오일 자동 생성. 볶음(볶음참깨/볶음들깨)은 수동 입력.
                // 수율 자동입고는 '실제 사용(압착)'에만 — 재고실사/조정/로트삭제 등 correction은 제외.
                //   (예전엔 note==='재고실사정정'만 막아 다른 note의 실사조정이 phantom 입고를 만들었음)
                if (entry.used > 0 && yieldRules[entry.material] && entry.type !== 'correction') {
                  const { product, rate } = yieldRules[entry.material];
                  // entry.used가 이미 kg 단위(modal이 변환해서 저장)이므로 수율 곱한 결과도 kg
                  const derivedKg = Math.round(entry.used * rate * 1000) / 1000;
                  await addItem('rawMaterialLedger', {
                    id: `rm-yield-${Date.now()}`,
                    material: product,
                    date: entry.date,
                    received: derivedKg,
                    used: 0,
                    note: `${entry.material} 압착 (수율 ${rate * 100}%)`,
                    createdAt: new Date().toISOString(),
                    type: 'auto', // 자동 파생 — 수불부 표시 파생행과 이중계상 방지 판별에도 사용
                    unit: 'kg', // canonical
                  });
                  // 파생 원료(통깨참기름 등)에도 로트 생성 → 수불부와 로트/재고 일치 (안 만들면 출고 시 로트 부족)
                  const derivedRaw = allItems.find(i => (i.category === 'raw' || (i.category === 'wip' && i.unit !== '개')) && baseRawName(i.name) === product);
                  if (derivedRaw && derivedKg > 0) {
                    const lot = buildReceiveLot({ material: product, supplierName: `${entry.material} 압착`, qtyIn: 0, kgIn: derivedKg, receivedDate: entry.date });
                    try {
                      await mutateRawMaterialLots(
                        derivedRaw.id,
                        (lots, stock) => [...withCarryOverLot(lots, stock, product), { ...lot, lotNo: nextLotNo(lots, lot.receivedDate) }],
                        (lots) => lotStockInUnit(lots, product),
                      );
                    } catch (err) {
                      console.error('[수율 자동입고] 파생 원료 로트 생성 실패:', product, err);
                    }
                  }
                }
              }}
              onDeleteRawMaterialEntry={(id) => deleteItem('rawMaterialLedger', id)}
              onUpdateSubmaterial={(id, data) => updateItem('items', id, data)}
              receivedOrders={receivedOrders}
              inboundBadge={receivedOrders.filter(r => !r.linkedStatementId).length}
              inboundContent={
                <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
                  <ReceivingReturnsManager
                    items={allItems}
                    partners={partners}
                    partnerItems={partnerItems}
                    orders={allOrders}
                    issuedStatements={issuedStatements}
                    currentUser={{ id: currentUser.id, name: currentUser.name }}
                    isAdmin={isAdmin}
                    onUpdateSubmaterial={(id, data) => updateItem('items', id, data)}
                    onProcessReturn={handleProcessReturn}
                    initialTab="입고"
                  />
                </React.Suspense>
              }
              returnBadge={returnRequests.filter(r => r.status === 'pending').length}
              returnContent={
                <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
                  <ReceivingReturnsManager
                    items={allItems}
                    partners={partners}
                    partnerItems={partnerItems}
                    orders={allOrders}
                    issuedStatements={issuedStatements}
                    currentUser={{ id: currentUser.id, name: currentUser.name }}
                    isAdmin={isAdmin}
                    onUpdateSubmaterial={(id, data) => updateItem('items', id, data)}
                    onProcessReturn={handleProcessReturn}
                    initialTab="반품"
                  />
                </React.Suspense>
              }
            />
            </>
          )}
          {currentView === 'inbound-scan' && (
            <InboundScan
              allItems={allItems}
              confirmedOrders={invoicedPurchaseOrders}
              qrMappings={appData.qrMappings}
              currentUser={{ id: currentUser.id, name: currentUser.name }}
              onUpdateSubmaterial={(id, data) => updateItem('items', id, data)}
              onFinishConfirmedOrder={handleFinishConfirmedOrder}
              onClose={() => setCurrentView('inventory')}
            />
          )}
          {showQrLabel && (
            <React.Suspense fallback={null}>
              <QrLabelPrint
                submaterials={submaterials}
                onClose={() => setShowQrLabel(false)}
              />
            </React.Suspense>
          )}
          {selectedLog && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedLog(null)}>
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                  <div>
                    <span className="text-base font-black text-slate-800">생산판매기록부</span>
                    <span className="ml-3 text-sm text-slate-500">{selectedLog.date}</span>
                    <span className="ml-2 text-xs text-slate-400">· {selectedLog.createdBy}</span>
                  </div>
                  <button onClick={() => setSelectedLog(null)} className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 text-lg font-black">✕</button>
                </div>
                <div className="overflow-y-auto p-6 space-y-5">
                  <div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">생산 내역</div>
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50">
                          {['품목', '용량', '수량', '소비기한', '비고'].map(h => (
                            <th key={h} className="border border-slate-200 px-3 py-2 font-black text-slate-500 text-center">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedLog.productionRows.map((r, i) => (
                          <tr key={i} className="hover:bg-blue-50">
                            <td className="border border-slate-200 px-3 py-1.5 font-bold text-slate-800">{r.groupLabel}</td>
                            <td className="border border-slate-200 px-3 py-1.5 text-center text-slate-600">{r.spec}</td>
                            <td className="border border-slate-200 px-3 py-1.5 text-right font-black text-blue-700">{r.수량}</td>
                            <td className="border border-slate-200 px-3 py-1.5 text-center text-slate-500">{r.소비기한}</td>
                            <td className="border border-slate-200 px-3 py-1.5 text-slate-400">{r.비고}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">판매 내역</div>
                    <div className="space-y-1">
                      {selectedLog.orderSummaries.map((s, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                          <span className="font-black text-slate-800 w-28 shrink-0">{s.partnerName}</span>
                          <span className="text-slate-500">{s.items.map(it => `${it.name} ${it.qty}개`).join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {currentView === 'partners' && <PartnerManager partners={partners} onUpdateClient={(c) => updateItem('partners', c.id, c)} onAddClient={(c) => addItem('partners', c)} onDeleteClient={(id) => deleteItem('partners', id)} />}
          {currentView === 'file-cabinet' && <DocumentManager currentUser={{ id: currentUser.id, name: currentUser.name }} />}
          {currentView === 'notice' && <NoticeBoard posts={noticePosts} onAddPost={(post) => addItem('notices', post)} />}
          {currentView === 'pallets' && (
            <PalletManager
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
              employees={employees}
              leaveRequests={leaveRequests}
              onUpdateEmployee={(emp) => updateItem('employees', emp.id, emp)}
              onAddEmployee={(emp) => addItem('employees', emp)}
              onDeleteEmployee={(id) => deleteItem('employees', id)}
              onUpdateLeaveStatus={(id, status) => updateItem('leaveRequests', id, { status })}
              onUpdateLeave={(id, updates) => updateItem('leaveRequests', id, updates)}
              onDeleteLeaveRequest={(id) => deleteItem('leaveRequests', id)}
            />
          )}
          {currentView === 'admin-checklist' && (
            <AdminChecklist
              leaveRequests={leaveRequests}
              adjustmentRequests={adjustmentRequests}
              employees={employees}
              returnRequests={returnRequests}
              receivedOrders={receivedOrders}
              partners={partners}
              issuedStatements={issuedStatements}
              onUpdateLeaveStatus={(id, status) => {
                if (status === 'approved') {
                  const req = leaveRequests.find(r => r.id === id);
                  if (req?.status === 'cancel_pending') {
                    updateItem('leaveRequests', id, { status: 'cancelled' });
                  } else {
                    updateItem('leaveRequests', id, { status: 'approved' });
                  }
                } else {
                  updateItem('leaveRequests', id, { status: 'rejected' });
                }
              }}
              onUpdateAdjustmentStatus={(id, status) => updateItem('adjustmentRequests', id, { status, processedAt: new Date().toISOString() })}
              onDeleteAdjustmentRequest={(id) => deleteItem('adjustmentRequests', id)}
              onProcessAdjustment={async (req) => {
                const product = allItems.find(p => p.id === req.itemId);
                if (req.type === 'quantity_change' && product && req.requestedQuantity !== undefined) {
                  const target = rawLotTarget(allItems, product, product.name);
                  if (target) {
                    // 원료: 목표수량으로 lot 조정 (stock 직접 X)
                    const deltaKg = unitToKg(req.requestedQuantity, target.baseName) - lotKgRemaining(product.lots);
                    await adjustRawLots({ material: target.baseName, rawItemId: target.rawItem.id, deltaKg, date: new Date().toISOString().slice(0, 10), note: '재고조정', addedBy: currentUser?.name });
                  } else {
                    await updateItem('items', req.itemId, { stock: req.requestedQuantity });
                  }
                }
                await updateItem('adjustmentRequests', req.id, { status: 'processed', processedAt: new Date().toISOString() });
              }}
              pendingStatementEdits={pendingStatementEdits}
              onApproveStatementEdit={async (edit) => {
                // 재고/PO는 수정 시점에 즉시 반영됨 → 승인은 매입전표(회계)만 정정
                await updateItem('issuedStatements', edit.statementId, edit.proposedData);
                await updateItem('pendingStatementEdits', edit.id, { status: 'approved' });
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
          {currentView === 'documents' && (() => {
            const SUB_ONLY_CATS = new Set(['container', 'cap', 'tape', 'box', 'label', 'raw']);
            const shippedOrders = orders.filter(o =>
              o.status === OrderStatus.SHIPPED &&
              o.partnerName !== '생산기록' &&
              o.items.some(item => {
                const p = allItems.find(pr => pr.id === item.itemId);
                // 제품 ID가 DB에 없으면(삭제 후 재등록 등) 완제품으로 간주
                // 명확히 부자재인 경우만 제외
                return !p || !SUB_ONLY_CATS.has(p.category);
              })
            );

            // 소비기한 계산 헬퍼 (제조일자 + 1년)
            const calcExpiry = (mfgDate: string) => {
              if (!mfgDate) return '';
              const d = new Date(mfgDate);
              d.setFullYear(d.getFullYear() + 1);
              return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
            };

            // 우측: 완제품, (상호, 품목, 용량) 기준 그룹화
            type RightRow = { 상호: string; 품목: string; spec: string; 수량: number; 소비기한: string; 제조일자: string; orderItems: Array<{orderId: string; itemIdx: number}>; };
            const rightRowsRaw = shippedOrders.flatMap(order => {
              const partner = partners.find(c => c.id === order.partnerId);
              const partnerName = partner?.name || order.partnerName || '';
              return order.items.flatMap((item, itemIdx) => {
                const product = allItems.find(p => p.id === item.itemId);
                if (product && SUB_ONLY_CATS.has(product.category)) return [];
                const 용량 = product?.spec || product?.용량 || item.displaySize || '';
                return [{ 상호: partnerName, 품목: product?.품목 || item.name, 용량, 수량: item.quantity, 소비기한: calcExpiry(item.mfgDate || ''), 제조일자: item.mfgDate || '', orderId: order.id, itemIdx }];
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
              if (상호 === '해피유통(00)' && 품목 === '시골향들기름2' && 용량 === '300ml') return '하남댁들기름';
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
            };
            const pumokOrder = [
              '시골향참기름1','시골향참기름2','시골향참기름3','시골향참기름4',
              '시골향들기름1','시골향들기름2',
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
              .filter(p => p.category === 'product' && p.품목 && p.spec && !bottomPumokSet.has(p.품목))
              .forEach(p => {
                if (!topTemplateMap.has(p.품목!)) topTemplateMap.set(p.품목!, new Set());
                topTemplateMap.get(p.품목!)!.add(p.spec!);
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
                return p?.category === 'product' && !item.mfgDate;
              }).map(item => item.name)
            );

            const exportExcel = async () => {
              if (missingMfgDate.length > 0) {
                const proceed = window.confirm(
                  `제조일자가 입력되지 않은 품목이 있습니다:\n${[...new Set(missingMfgDate)].join(', ')}\n\n계속 저장하시겠습니까?`
                );
                if (!proceed) return;
              }
              const ExcelJS = (await import('exceljs')).default;
              const wb = new ExcelJS.Workbook();
              const ws = wb.addWorksheet('생산작업판매일지');

              // 열 너비
              ws.columns = [
                { width: 18 }, { width: 8 }, { width: 6 }, { width: 18 }, { width: 28 },
                { width: 2 },
                { width: 18 }, { width: 16 }, { width: 8 }, { width: 6 }, { width: 18 },
              ];

              const thinBorder: Partial<ExcelJSType.Borders> = {
                top: { style: 'thin' }, bottom: { style: 'thin' },
                left: { style: 'thin' }, right: { style: 'thin' },
              };
              const headerFill: ExcelJSType.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
              const groupFill: ExcelJSType.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };

              const applyHeader = (row: ExcelJSType.Row, cols: number[]) => {
                cols.forEach(c => {
                  const cell = row.getCell(c);
                  cell.font = { bold: true, size: 9 };
                  cell.fill = headerFill;
                  cell.border = thinBorder;
                  cell.alignment = { horizontal: 'center', vertical: 'middle' };
                });
              };

              // 헤더 행
              const hRow = ws.addRow(['품목(제품명)', '용량', '수량', '소비기한', '비 고', '', '상호', '품목', '용량', '수량', '소비기한']);
              hRow.height = 18;
              applyHeader(hRow, [1,2,3,4,5,7,8,9,10,11]);
              ws.addRow([]);

              // 좌우 데이터
              let currentGroup = '';
              const maxRows = Math.max(leftRows.length, rightRows.length);
              for (let i = 0; i < maxRows; i++) {
                const l = leftRows[i];
                const r = rightRows[i];
                const row = ws.addRow([
                  l?.groupLabel ?? '', l?.spec ?? '', l ? (l.수량 || 0) : '', l?.소비기한 ?? '', l?.비고 ?? '',
                  '',
                  r?.상호 ?? '', r?.품목 ?? '', r?.spec ?? '', r ? r.수량 : '', r?.소비기한 ?? '',
                ]);
                row.height = 16;

                // 좌측 서식
                if (l) {
                  const isNewGroup = l.groupLabel !== '' && l.groupLabel !== currentGroup;
                  if (isNewGroup) currentGroup = l.groupLabel;

                  [1,2,3,4,5].forEach(c => {
                    const cell = row.getCell(c);
                    cell.border = thinBorder;
                    cell.font = { size: 9 };
                    cell.alignment = { horizontal: c === 1 ? 'left' : 'center', vertical: 'middle', wrapText: c === 5 };
                    if (c === 1 && l.groupLabel) {
                      cell.font = { bold: true, size: 9 };
                      cell.fill = groupFill;
                    }
                    if (c === 3) {
                      cell.font = { bold: l.수량 > 0, size: 9, color: l.수량 > 0 ? { argb: 'FF1E3A5F' } : { argb: 'FF999999' } };
                    }
                  });
                }

                // 우측 서식
                if (r) {
                  [7,8,9,10,11].forEach(c => {
                    const cell = row.getCell(c);
                    cell.border = thinBorder;
                    cell.font = { size: 9 };
                    cell.alignment = { horizontal: c === 10 ? 'center' : 'left', vertical: 'middle' };
                  });
                }
              }

              // 하단 섹션
              ws.addRow([]);
              const bHRow = ws.addRow(['품목(제품명)', '용량', '수량', '소비기한', '비 고']);
              bHRow.height = 18;
              applyHeader(bHRow, [1,2,3,4,5]);
              ws.addRow([]);

              bottomTemplate.forEach(({ 품목, 용량 }) => {
                const a = agg[`${품목}||${용량}`] || { qty: 0, mfgDates: [], partners: [] };
                const earliestMfg = a.mfgDates.length ? [...a.mfgDates].sort()[0] : '';
                const expiryStr = earliestMfg ? calcExpiry(earliestMfg) : '';
                const partnerNote = a.partners.join(', ');
                const displayQty = getBottomQty(품목, 용량);
                const row = ws.addRow([품목, 용량, displayQty, expiryStr, partnerNote]);
                row.height = 16;
                [1,2,3,4,5].forEach(c => {
                  const cell = row.getCell(c);
                  cell.border = thinBorder;
                  cell.font = { bold: c === 1, size: 9 };
                  cell.alignment = { horizontal: c <= 2 ? 'left' : 'center', vertical: 'middle', wrapText: c === 5 };
                  if (c === 3 && displayQty > 0) cell.font = { bold: true, size: 9, color: { argb: 'FF1E3A5F' } };
                });
                ws.addRow([]);
              });

              // 기타 — 좌측 템플릿에 없는 판매분(용량 미설정 등) 누락 방지
              if (extraSalesRows.length > 0) {
                ws.addRow([]);
                const hdr = ws.addRow(['기타 (템플릿 외 판매분)', '', '', '', '']);
                hdr.getCell(1).font = { bold: true, size: 9 };
                extraSalesRows.forEach(r => {
                  const row = ws.addRow([r.품목, r.용량 || '(미설정)', r.qty, '', r.거래처]);
                  row.height = 16;
                  [1, 2, 3, 4, 5].forEach(c => {
                    const cell = row.getCell(c);
                    cell.border = thinBorder;
                    cell.font = { bold: c === 1, size: 9 };
                    cell.alignment = { horizontal: c <= 2 ? 'left' : 'center', vertical: 'middle', wrapText: c === 5 };
                  });
                });
              }

              // 파일 저장
              const buf = await wb.xlsx.writeBuffer();
              const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              const docDate = bulkMfgDate || new Date().toISOString().slice(0, 10);
              a.download = `생산작업판매일지_${docDate}.xlsx`;
              a.click();
              URL.revokeObjectURL(url);

              // 생산판매기록 로그 저장 (관리자 서류 조회용)
              const logId = `psl-${Date.now()}`;
              await addItem('productionSalesLogs', {
                id: logId,
                date: docDate,
                createdAt: new Date().toISOString(),
                createdBy: currentUser.name,
                orderCount: shippedOrders.length,
                productionRows: leftRows,
                orderSummaries: shippedOrders.map(o => ({
                  partnerName: o.partnerName,
                  items: o.items.map(i => ({ name: i.name, qty: i.quantity ?? 1 })),
                })),
              });

              // 출고(SHIPPED) 주문을 예전 주문이력(DELIVERED)으로 이동.
              // 재고 조정(생산/출고)은 이미 각 상태 전환 때 반영됨 — 여기선 상태만 이동하되,
              // 혹시 생산/출고 미반영 주문(레거시·스킵)이면 changeOrderStatus가 그때 정리한다(부수효과).
              const deductFailures: string[] = [];
              for (const o of shippedOrders) {
                try {
                  await changeOrderStatus(o.id, OrderStatus.DELIVERED);
                } catch (e) {
                  console.error(`[주문 이력 이동] 재고 조정 실패 (주문 ${o.id}, ${o.partnerName}):`, e);
                  deductFailures.push(o.partnerName || o.id);
                  await updateItem('orders', o.id, { status: OrderStatus.DELIVERED, deliveredAt: new Date().toISOString() });
                }
              }
              // 참고: 향미유/고춧가루만 있는 출고 주문도 위 shippedOrders 루프가 이미 처리한다
              // (SUB_ONLY_CATS에 향미유/고춧가루가 없으므로 some(...) 조건을 만족).
              // 과거에는 SUB_ONLY_CATS에 향미유가 포함돼 별도 루프가 필요했으나, 영문 카테고리
              // 전환(e237fc4) 이후 중복 차감을 유발해 제거함.
              if (deductFailures.length > 0) {
                alert(`주문 ${deductFailures.length}건은 이력으로 이동했지만 재고/원료 차감 중 오류가 발생했습니다:\n${[...new Set(deductFailures)].join(', ')}\n\n해당 품목의 재고/원료 로트를 확인해 주세요.`);
              }
            };

            return (
              <div className="space-y-5 animate-in slide-in-from-right-4 duration-500">
                <div className="flex flex-col gap-4">
                  <div className="hidden md:flex items-center justify-between pb-3 md:pb-4 border-b border-slate-200">
                    <div>
                      <h2 className="text-base md:text-lg font-black text-slate-800 leading-tight truncate">서류 관리</h2>
                      <p className="text-[11px] md:text-xs text-slate-400 mt-0.5 truncate">생산·원료·작업 관련 서류를 조회하세요.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex flex-wrap gap-1 bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
                      <button
                        onClick={() => setDocTab('생산판매기록부')}
                        className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold transition-all ${docTab === '생산판매기록부' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                      >생산판매기록부</button>
                      {!isAdmin && (
                        <button
                          onClick={() => setDocTab('haccp')}
                          className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold transition-all ${docTab === 'haccp' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                        >HACCP 체크리스트</button>
                      )}
                      {isAdmin && (<>
                        <button
                          onClick={() => setDocTab('원료수불부')}
                          className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold transition-all ${docTab === '원료수불부' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                        >원료수불부</button>
                        <button
                          onClick={() => setDocTab('생산작업기록부')}
                          className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold transition-all ${docTab === '생산작업기록부' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                        >생산작업기록부</button>
                        <button
                          onClick={() => setDocTab('생산작업기록부2')}
                          className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold transition-all ${docTab === '생산작업기록부2' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                        >생산작업기록부2</button>
                        <button
                          onClick={() => setDocTab('벤조피렌')}
                          className={`px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold transition-all ${docTab === '벤조피렌' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                        >벤조피렌 검사성적서</button>
                      </>)}
                    </div>
                    {docTab === '생산판매기록부' && (
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
                          <span className="text-[10px] text-slate-400 whitespace-nowrap">→ 제조 -3일 ±1</span>
                          {(() => {
                            const cnt = orders.filter(o => o.status === OrderStatus.SHIPPED && o.partnerName !== '생산기록')
                              .flatMap(o => o.items.filter(item => allItems.find(p => p.id === item.itemId)?.category === 'product')).length;
                            return cnt > 0 ? <span className="text-[10px] font-bold text-amber-500 whitespace-nowrap">{cnt}건</span> : null;
                          })()}
                          <button
                            onClick={async () => {
                              if (!bulkMfgDate) return;
                              type UnsetItem = { orderId: string; itemIdx: number; itemName: string };
                              const unset: UnsetItem[] = [];
                              const targetOrders = orders.filter(o =>
                                o.status === OrderStatus.SHIPPED && o.partnerName !== '생산기록'
                              );
                              for (const o of targetOrders) {
                                o.items.forEach((item, itemIdx) => {
                                  const p = allItems.find(pr => pr.id === item.itemId);
                                  if (p?.category === 'product') {
                                    unset.push({ orderId: o.id, itemIdx, itemName: p.품목 || item.name });
                                  }
                                });
                              }
                              if (unset.length === 0) { alert('적용할 항목이 없습니다.'); return; }
                              const uniqueProducts: string[] = [];
                              for (const { itemName } of unset) {
                                if (!uniqueProducts.includes(itemName)) uniqueProducts.push(itemName);
                              }
                              // 서류날짜 - 3일 base, 품목별 index % 3 → -1, 0, +1 분산
                              const offsets = [-1, 0, 1];
                              const productDateMap: Record<string, string> = {};
                              uniqueProducts.forEach((name, idx) => {
                                const d = new Date(bulkMfgDate);
                                d.setDate(d.getDate() - 3 + offsets[idx % 3]);
                                productDateMap[name] = d.toISOString().slice(0, 10);
                              });
                              const byOrder: Record<string, { itemIdx: number; date: string }[]> = {};
                              for (const { orderId, itemIdx, itemName } of unset) {
                                if (!byOrder[orderId]) byOrder[orderId] = [];
                                byOrder[orderId].push({ itemIdx, date: productDateMap[itemName] });
                              }
                              for (const [orderId, updates] of Object.entries(byOrder)) {
                                const o = orders.find(ord => ord.id === orderId);
                                if (!o) continue;
                                const newItems = [...o.items];
                                for (const { itemIdx, date } of updates) {
                                  newItems[itemIdx] = { ...newItems[itemIdx], mfgDate: date };
                                }
                                await updateItem('orders', orderId, { items: newItems, documentDate: bulkMfgDate });
                              }
                            }}
                            className="text-[11px] font-black text-white bg-amber-500 hover:bg-amber-600 px-3 py-1 rounded-xl transition-all whitespace-nowrap"
                          >미입력 일괄 적용</button>
                        </div>
                        <button
                          onClick={exportExcel}
                          className="flex items-center space-x-2 bg-emerald-600 text-white px-5 py-2.5 rounded-2xl font-bold shadow hover:bg-emerald-700 transition-all text-sm"
                        >
                          <FileText size={16} />
                          <span>엑셀 저장</span>
                        </button>
                      </div>
                    )}
                    {docTab === '생산작업기록부' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-3 py-1.5 shadow-sm">
                          <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">년월</span>
                          <input
                            type="month"
                            value={productionWorkMonth}
                            onChange={e => setProductionWorkMonth(e.target.value)}
                            className="text-xs font-bold text-slate-700 bg-transparent outline-none cursor-pointer"
                          />
                        </div>
                        <button
                          onClick={async () => {
                            const ExcelJS = (await import('exceljs')).default;
                            const wb = new ExcelJS.Workbook();
                            const ALL_CATS = [
                              '시골향참기름1', '시골향참기름2', '시골향참기름3', '시골향참기름4',
                              '하남댁참기름', '시골향들기름1', '시골향들기름2', '하남댁들기름',
                            ];
                            const CATEGORY_DISPLAY: Record<string, string> = {
                              '시골향참기름1': '시골향참기름① (통깨 100%)',
                              '시골향참기름2': '시골향참기름② (통깨 100%)',
                              '시골향참기름3': '시골향참기름③ (통깨 100%)',
                              '시골향참기름4': '시골향참기름④ (통깨 100%)',
                              '하남댁참기름': '하남댁참기름',
                              '시골향들기름1': '시골향들기름①',
                              '시골향들기름2': '시골향들기름②',
                              '하남댁들기름': '하남댁들기름',
                            };
                            const parseVolumeLiter = (vol: string): number => {
                              if (vol.endsWith('ml')) return parseFloat(vol) / 1000;
                              if (vol.endsWith('l')) return parseFloat(vol);
                              if (vol.endsWith('kg')) return parseFloat(vol);
                              return 0;
                            };
                            const [wy, wm] = productionWorkMonth.split('-').map(Number);
                            const daysInMonth = new Date(wy, wm, 0).getDate();
                            const thin: Partial<ExcelJSType.Borders> = {
                              top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'}
                            };
                            const hFill: ExcelJSType.Fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD9E1F2'} };
                            const center = { horizontal: 'center' as const, vertical: 'middle' as const };
                            const left = { horizontal: 'left' as const, vertical: 'middle' as const };

                            for (const cat of ALL_CATS) {
                              type WRow = { spec: string; 수량: number; mfgDate: string };
                              const dayMap: Record<number, WRow[]> = {};
                              orders
                                .filter(o => [OrderStatus.SHIPPED, OrderStatus.DELIVERED].includes(o.status as OrderStatus))
                                .forEach(order => {
                                  const docStr = order.documentDate || order.deliveryDate;
                                  if (!docStr) return;
                                  const d = new Date(docStr);
                                  if (d.getFullYear() !== wy || d.getMonth() + 1 !== wm) return;
                                  const day = d.getDate();
                                  order.items.forEach(item => {
                                    const p = allItems.find(pr => pr.id === item.itemId);
                                    const remappedPumok = p?.품목 === '새싹참기름' ? '하남댁참기름' : p?.품목 === '새싹들기름' ? '하남댁들기름' : p?.품목;
                                    if (!p || remappedPumok !== cat) return;
                                    if (!dayMap[day]) dayMap[day] = [];
                                    const existing = dayMap[day].find(r => r.spec === (p.spec || ''));
                                    if (existing) existing.수량 += item.quantity;
                                    else dayMap[day].push({ spec: p.spec || '', 수량: item.quantity, mfgDate: item.mfgDate || '' });
                                  });
                                });
                              const ws = wb.addWorksheet(cat);
                              ws.columns = [
                                { width: 6 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 14 }, { width: 10 },
                              ];
                              ws.pageSetup = {
                                paperSize: 9, orientation: 'portrait',
                                fitToPage: true, fitToWidth: 1, fitToHeight: 1,
                                margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
                              };
                              // 헤더 행 추가 후 셀 병합
                              const r1 = ws.addRow([`년 월 : ${wy}년 ${wm}월`, '', '', '', '', `관리자 : 임 기 주`, '']);
                              ws.mergeCells(`A1:E1`);
                              ws.mergeCells(`F1:G1`);
                              r1.getCell(1).alignment = left; r1.getCell(1).font = { bold: true, size: 9 };
                              r1.getCell(6).alignment = center; r1.getCell(6).font = { bold: true, size: 9 };

                              const r2 = ws.addRow([`품 목 : ${CATEGORY_DISPLAY[cat] || cat}`, '', '', '', '', '', '']);
                              ws.mergeCells(`A2:G2`);
                              r2.getCell(1).alignment = left; r2.getCell(1).font = { bold: true, size: 9 };

                              const r3 = ws.addRow([`담당자 : 이 은 경`, '', '', '', '', `( 단 위 : Kg )`, '']);
                              ws.mergeCells(`A3:E3`);
                              ws.mergeCells(`F3:G3`);
                              r3.getCell(1).alignment = left; r3.getCell(1).font = { bold: true, size: 9 };
                              r3.getCell(6).alignment = center; r3.getCell(6).font = { size: 9 };

                              ws.addRow([]);
                              const hRow = ws.addRow(['일 자', '투입량(Kg)', '생산품목', '생산수량(개)', '생산량', '유통기한', '비고']);
                              hRow.eachCell(cell => {
                                cell.font = { bold: true, size: 9 };
                                cell.fill = hFill;
                                cell.border = thin;
                                cell.alignment = center;
                              });
                              hRow.height = 18;
                              let totalInput = 0;
                              for (let d = 1; d <= daysInMonth; d++) {
                                const rows = (dayMap[d] || []).sort((a, b) => a.spec.localeCompare(b.spec));
                                if (rows.length === 0) {
                                  const r = ws.addRow([d, '-', '', '', '-', '', '']);
                                  r.eachCell((cell, col) => {
                                    cell.border = thin;
                                    cell.alignment = col === 1 ? center : left;
                                    cell.font = { size: 9 };
                                  });
                                } else {
                                  rows.forEach((row, i) => {
                                    const vol = parseVolumeLiter(row.spec);
                                    const inputKg = Math.round(vol * row.수량 * 0.92);
                                    totalInput += inputKg;
                                    const dv = row.spec.endsWith('ml') && parseFloat(row.spec) >= 1000
                                      ? `${parseFloat(row.spec)/1000}l` : row.spec;
                                    const sobiDisp = row.mfgDate ? row.mfgDate.replace(/-/g, '.') : '';
                                    const r = ws.addRow([i === 0 ? d : '', inputKg, dv, row.수량, inputKg, sobiDisp, '']);
                                    r.eachCell((cell, col) => {
                                      cell.border = thin;
                                      cell.alignment = [1,2,4,5].includes(col) ? center : left;
                                      cell.font = { size: 9 };
                                    });
                                  });
                                }
                              }
                              const totRow = ws.addRow(['총 량', totalInput, '', '', '', '', '']);
                              totRow.eachCell(cell => {
                                cell.border = thin;
                                cell.font = { bold: true, size: 9 };
                                cell.fill = hFill;
                                cell.alignment = center;
                              });
                            }
                            const buf = await wb.xlsx.writeBuffer();
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
                            a.download = `생산작업기록부_${productionWorkMonth}.xlsx`;
                            a.click();
                          }}
                          className="flex items-center space-x-2 bg-emerald-600 text-white px-5 py-2.5 rounded-2xl font-bold shadow hover:bg-emerald-700 transition-all text-sm"
                        >
                          <FileText size={16} />
                          <span>엑셀 저장</span>
                        </button>
                      </div>
                    )}
                    {docTab === '생산작업기록부2' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-3 py-1.5 shadow-sm">
                          <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">년월</span>
                          <input
                            type="month"
                            value={prodLedger2Month}
                            onChange={e => setProdLedger2Month(e.target.value)}
                            className="text-xs font-bold text-slate-700 bg-transparent outline-none cursor-pointer"
                          />
                        </div>
                        <button
                          onClick={async () => {
                            const ExcelJSMod = (await import('exceljs')).default;
                            const wb2 = new ExcelJSMod.Workbook();
                            const [xl2Year, xl2Month] = prodLedger2Month.split('-').map(Number);
                            const xl2Days = new Date(xl2Year, xl2Month, 0).getDate();
                            const parseVolL2 = (vol: string): number => {
                              if (!vol) return 0;
                              const v = vol.toLowerCase();
                              if (v.endsWith('ml')) return parseFloat(v) / 1000;
                              if (v.endsWith('l')) return parseFloat(v);
                              return 0;
                            };
                            const getDayKg2 = (day: number, catKey: string): number => {
                              let total = 0;
                              orders.filter(o => [OrderStatus.SHIPPED, OrderStatus.DELIVERED].includes(o.status as OrderStatus))
                                .forEach(order => {
                                  const docStr = order.documentDate || order.deliveryDate;
                                  if (!docStr) return;
                                  const d = new Date(docStr);
                                  if (d.getFullYear() !== xl2Year || d.getMonth() + 1 !== xl2Month || d.getDate() !== day) return;
                                  order.items.forEach(item => {
                                    const p = allItems.find(pr => pr.id === item.itemId);
                                    if (!p || p.품목 !== catKey) return;
                                    total += Math.round(parseVolL2(p.spec || '') * item.quantity * 0.92);
                                  });
                                });
                              return total;
                            };
                            const getOutflow2 = (day: number, type: string): number => {
                              const kg1 = getDayKg2(day, '시골향참기름1');
                              const kg2 = getDayKg2(day, '시골향참기름2');
                              const kg3 = getDayKg2(day, '시골향참기름3');
                              if (type === '통깨참기름') return kg1 + Math.round(kg2 / 2);
                              return kg3 + Math.round(kg2 / 2);
                            };
                            const getLEntry = (type: string, date: string) =>
                              sesameInputLedger.find(e => e.type === type && e.date === date);
                            const getInflow2 = (day: number, type: string): number =>
                              getLEntry(type, `${prodLedger2Month}-${String(day).padStart(2, '0')}`)?.amount || 0;
                            const getInit2 = (type: string): number =>
                              getLEntry(type, `${prodLedger2Month}-init`)?.amount || 0;
                            const tStocks2: number[] = new Array(xl2Days + 1).fill(0);
                            const gStocks2: number[] = new Array(xl2Days + 1).fill(0);
                            let tSt2 = getInit2('통깨참기름'), gSt2 = getInit2('깨분참기름');
                            let totTIn2 = 0, totTOut2 = 0, totGIn2 = 0, totGOut2 = 0;
                            for (let day = 1; day <= xl2Days; day++) {
                              const tIn = getInflow2(day, '통깨참기름');
                              const tOut = getOutflow2(day, '통깨참기름');
                              const gIn = getInflow2(day, '깨분참기름');
                              const gOut = getOutflow2(day, '깨분참기름');
                              tSt2 = tSt2 + tIn - tOut;
                              gSt2 = gSt2 + gIn - gOut;
                              tStocks2[day] = tSt2;
                              gStocks2[day] = gSt2;
                              totTIn2 += tIn; totTOut2 += tOut;
                              totGIn2 += gIn; totGOut2 += gOut;
                            }
                            // A:일자 B:통깨입고 C:통깨출고 D:통깨재고 E:깨분입고 F:깨분출고 G:깨분재고 H:총입고 I:총출고 J:총재고
                            const ws2 = wb2.addWorksheet('참기름수불부');
                            ws2.columns = [
                              { width: 6 }, { width: 7 }, { width: 7 }, { width: 7 },
                              { width: 7 }, { width: 7 }, { width: 7 },
                              { width: 7 }, { width: 7 }, { width: 7 },
                            ];
                            ws2.pageSetup = {
                              paperSize: 9, orientation: 'landscape',
                              fitToPage: true, fitToWidth: 1, fitToHeight: 1,
                              margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
                            };
                            const thin2: Partial<ExcelJSType.Borders> = {
                              top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'}
                            };
                            const hFill2: ExcelJSType.Fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD9E1F2'} };
                            const center2 = { horizontal: 'center' as const, vertical: 'middle' as const };
                            // 제목 (행1)
                            const titleRow = ws2.addRow([`참기름 원료 수불부  ${xl2Year}년 ${xl2Month}월`, '', '', '', '', '', '', '', '', '']);
                            ws2.mergeCells('A1:J1');
                            titleRow.getCell(1).font = { bold: true, size: 12 };
                            titleRow.getCell(1).alignment = center2;
                            titleRow.height = 22;
                            ws2.addRow([]); // 행2 빈 줄
                            // 헤더 행1 (행3): 일자 | 통깨참기름(3) | 깨분참기름(3) | 참기름총량(3)
                            const h1 = ws2.addRow(['일자', '통깨참기름 (Kg)', '', '', '깨분참기름 (Kg)', '', '', '참기름 총량 (Kg)', '', '']);
                            ws2.mergeCells('B3:D3'); ws2.mergeCells('E3:G3'); ws2.mergeCells('H3:J3');
                            h1.eachCell(cell => { cell.font = { bold: true, size: 9 }; cell.fill = hFill2; cell.border = thin2; cell.alignment = center2; });
                            h1.getCell(1).border = thin2;
                            // 헤더 행2 (행4)
                            const h2 = ws2.addRow(['', '입고', '출고', '재고', '입고', '출고', '재고', '입고', '출고', '재고']);
                            h2.eachCell(cell => { cell.font = { bold: true, size: 9 }; cell.fill = hFill2; cell.border = thin2; cell.alignment = center2; });
                            // 전기이월 (행5)
                            const tInit = getInit2('통깨참기름');
                            const gInit = getInit2('깨분참기름');
                            const initRow = ws2.addRow(['전기이월', 0, 0, tInit, 0, 0, gInit, 0, 0, { formula: `D5+G5`, result: tInit + gInit }]);
                            initRow.eachCell((cell, col) => { cell.border = thin2; cell.alignment = center2; cell.font = { size: 9, bold: true }; });
                            // 데이터 행 (행6~)
                            for (let day = 1; day <= xl2Days; day++) {
                              const rn = day + 5; // 행 번호
                              const prevRn = rn - 1;
                              const tIn = getInflow2(day, '통깨참기름');
                              const tOut = getOutflow2(day, '통깨참기름');
                              const gIn = getInflow2(day, '깨분참기름');
                              const gOut = getOutflow2(day, '깨분참기름');
                              const tSt = tStocks2[day];
                              const gSt = gStocks2[day];
                              const r = ws2.addRow([
                                day,
                                tIn || 0,
                                tOut || 0,
                                { formula: `D${prevRn}+B${rn}-C${rn}`, result: tSt },
                                gIn || 0,
                                gOut || 0,
                                { formula: `G${prevRn}+E${rn}-F${rn}`, result: gSt },
                                { formula: `B${rn}+E${rn}`, result: tIn + gIn },
                                { formula: `C${rn}+F${rn}`, result: tOut + gOut },
                                { formula: `D${rn}+G${rn}`, result: tSt + gSt },
                              ]);
                              r.eachCell((cell, col) => { cell.border = thin2; cell.alignment = center2; cell.font = { size: 9 }; });
                            }
                            // 총량 행
                            const lastDataRn = xl2Days + 5;
                            const firstDataRn = 6;
                            const totRow2 = ws2.addRow([
                              '총 량',
                              { formula: `SUM(B${firstDataRn}:B${lastDataRn})`, result: totTIn2 },
                              { formula: `SUM(C${firstDataRn}:C${lastDataRn})`, result: totTOut2 },
                              tStocks2[xl2Days],
                              { formula: `SUM(E${firstDataRn}:E${lastDataRn})`, result: totGIn2 },
                              { formula: `SUM(F${firstDataRn}:F${lastDataRn})`, result: totGOut2 },
                              gStocks2[xl2Days],
                              { formula: `SUM(H${firstDataRn}:H${lastDataRn})`, result: totTIn2 + totGIn2 },
                              { formula: `SUM(I${firstDataRn}:I${lastDataRn})`, result: totTOut2 + totGOut2 },
                              { formula: `D${lastDataRn + 1}+G${lastDataRn + 1}`, result: tStocks2[xl2Days] + gStocks2[xl2Days] },
                            ]);
                            totRow2.eachCell(cell => { cell.border = thin2; cell.font = { bold: true, size: 9 }; cell.fill = hFill2; cell.alignment = center2; });
                            const buf2 = await wb2.xlsx.writeBuffer();
                            const a2 = document.createElement('a');
                            a2.href = URL.createObjectURL(new Blob([buf2], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
                            a2.download = `참기름수불부_${prodLedger2Month}.xlsx`;
                            a2.click();
                          }}
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
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-xs font-black text-slate-500 uppercase tracking-widest">생산판매기록부 이력 ({logs.length}건)</span>
                        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5 shadow-sm">
                          <button onClick={() => { const d = new Date(docLogMonth + '-01'); d.setMonth(d.getMonth() - 1); setDocLogMonth(d.toISOString().slice(0, 7)); }} className="text-slate-400 hover:text-indigo-500 font-black text-sm px-1">‹</button>
                          <input type="month" value={docLogMonth} onChange={e => setDocLogMonth(e.target.value)} className="text-xs font-bold text-slate-700 bg-transparent outline-none cursor-pointer" />
                          <button onClick={() => { const d = new Date(docLogMonth + '-01'); d.setMonth(d.getMonth() + 1); setDocLogMonth(d.toISOString().slice(0, 7)); }} className="text-slate-400 hover:text-indigo-500 font-black text-sm px-1">›</button>
                        </div>
                      </div>
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
                    <HaccpChecklist currentUser={{ id: currentUser.id, name: currentUser.name }} isAdmin={isAdmin} />
                  </React.Suspense>
                )}

                {docTab === '벤조피렌' && (
                  <React.Suspense fallback={<div className="py-20 text-center text-slate-400">로딩 중...</div>}>
                    <BenzopyreneLog
                      currentUserName={currentUser?.name}
                      isAdmin={isAdmin}
                    />
                  </React.Suspense>
                )}

                {docTab === '원료수불부' && (() => {
                  type UsageRow = { date: string; received: number; used: number; note: string; type: 'auto' | 'manual' | 'correction'; id?: string; createdAt?: string; targetKg?: number };

                  // 수율: 원재료 사용 → 반제품 입고 자동 파생 (규칙은 yieldRules = item_formula 데이터)
                  const calcDerivedReceived = (material: string): UsageRow[] => {
                    const rows: UsageRow[] = [];
                    const sourceEntry = Object.entries(yieldRules).find(([, v]) => v.product === material);
                    if (!sourceEntry) return rows;
                    const [sourceMaterial, { rate: yieldRate }] = sourceEntry;
                    mergedRawMaterialLedger
                      // 수율 파생은 '실제 사용(압착=manual)'에만 — correction(재고실사/조정/로트삭제)은 제외.
                      // (예전엔 note==='재고실사정정'만 막아, 다른 note의 실사조정이 파생입고를 만들었음)
                      .filter(e => e.material === sourceMaterial && e.used > 0 && e.type !== 'auto' && e.type !== 'correction')
                      .forEach(e => {
                        const derivedKg = Math.round(e.used * yieldRate * 1000) / 1000;
                        // YIELD_AUTO(rm-yield-*)가 DB에 실제 파생입고를 이미 기록한 경우 표시용 파생행을 만들면
                        // 같은 압착이 두 번 잡힌다(이중계상) → DB에 동일 건이 있으면 건너뜀
                        const storedExists = mergedRawMaterialLedger.some(x =>
                          x.material === material && x.date === e.date &&
                          (x.note ?? '').startsWith(`${sourceMaterial} 압착`) &&
                          Math.abs((x.received ?? 0) - derivedKg) < 0.005);
                        if (storedExists) return;
                        rows.push({ date: e.date, received: derivedKg, used: 0, note: `${sourceMaterial} 압착 (수율 ${yieldRate * 100}%)`, type: 'auto' as const, createdAt: e.createdAt });
                      });
                    return rows;
                  };

                  // 수불부 행 계산 — DB 데이터만 사용 (auto/manual/correction 모두 포함)
                  // 옛 데이터(unit==='L')는 표시 시점에 ×density 환산 → 모두 kg 단위로 통일
                  const buildLedger = (material: string) => {
                    const density = DENSITY[material] ?? 1.0;
                    const dbEntries: UsageRow[] = mergedRawMaterialLedger
                      .filter(e => e.material === material)
                      .map(e => {
                        const isLegacyL = e.unit === 'L' && density !== 1.0;
                        const received = isLegacyL ? Math.round(e.received * density * 1000) / 1000 : e.received;
                        const used     = isLegacyL ? Math.round(e.used     * density * 1000) / 1000 : e.used;
                        return { date: e.date, received, used, note: e.note, type: (e.type || 'manual') as UsageRow['type'], id: e.id, createdAt: e.createdAt, targetKg: e.targetKg };
                      });
                    const derivedEntries = calcDerivedReceived(material);
                    // 같은 날짜 안에서는 기록 시각 순 — 실사(targetKg 앵커)와 당일 입출고의 순서가 잔량에 영향
                    const allEntries = [...dbEntries, ...derivedEntries].sort((a, b) =>
                      a.date === b.date ? (a.createdAt ?? '').localeCompare(b.createdAt ?? '') : a.date.localeCompare(b.date));
                    // 잔량 누적: 재고실사정정(targetKg)은 잔량을 실사 절대값으로 리셋(앵커) —
                    // 과거 장부 오차·이중계상이 있어도 실사 이후 잔량은 실물 기준으로 맞는다
                    const applyRow = (bal: number, e: UsageRow) =>
                      e.targetKg != null ? e.targetKg : Math.round((bal + e.received - e.used) * 1000) / 1000;
                    // 전재고 계산 (월 이전 누적)
                    const prevBalance = allEntries
                      .filter(e => e.date < `${docYearMonth}-01`)
                      .reduce(applyRow, 0);
                    // 월내 행
                    const monthEntries = allEntries.filter(e => e.date.startsWith(docYearMonth));
                    let balance = prevBalance;
                    return monthEntries.map(e => {
                      const prev = balance;
                      balance = applyRow(balance, e);
                      return { ...e, prevBalance: Math.round(prev * 1000) / 1000, currentBalance: balance };
                    });
                  };

                  // 원료수불부 Excel 저장
                  const exportRmExcel = async () => {
                    const ExcelJS = (await import('exceljs')).default;
                    const wb = new ExcelJS.Workbook();
                    for (const mat of RM_LIST) {
                      const ws = wb.addWorksheet(mat);
                      ws.columns = [
                        { width: 12 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 30 }
                      ];
                      // 수불부는 모든 원료를 kg로 통일 표시 (L 입력 데이터는 buildLedger에서 환산됨)
                      const hRow = ws.addRow(['날짜', '전재고(kg)', '입고량(kg)', '사용량(kg)', '현재고(kg)', '비고']);
                      hRow.font = { bold: true, size: 9 };
                      const border = { top: { style: 'thin' as const }, bottom: { style: 'thin' as const }, left: { style: 'thin' as const }, right: { style: 'thin' as const } };
                      hRow.eachCell(c => { c.border = border; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; });
                      const ledger = buildLedger(mat);
                      ledger.forEach((row, idx) => {
                        const dataRowNum = idx + 2; // 헤더가 1행
                        const r = ws.addRow([
                          row.date,
                          idx === 0 ? (row.prevBalance || 0) : { formula: `E${dataRowNum - 1}` },
                          row.received || 0,
                          row.used || 0,
                          { formula: `B${dataRowNum}+C${dataRowNum}-D${dataRowNum}` },
                          row.note || ''
                        ]);
                        r.font = { size: 9 };
                        r.eachCell(c => { c.border = border; });
                        // 수식 셀 배경 연하게
                        r.getCell(2).fill = idx === 0 ? { type: 'pattern', pattern: 'none' } : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
                        r.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
                      });
                    }
                    const buf = await wb.xlsx.writeBuffer();
                    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `원료수불부_${docYearMonth}.xlsx`;
                    a.click();
                    URL.revokeObjectURL(url);
                  };

                  const activeLedger = buildLedger(rmActiveMaterial);

                  return (
                    <div className="space-y-4">
                      {/* 헤더 */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <input type="month" value={docYearMonth} onChange={e => setDocYearMonth(e.target.value)}
                            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400" />
                          <span className="text-xs text-slate-400 font-bold">※ 환산: 참기름류 0.916kg/L, 들기름류 0.924kg/L (고정)</span>
                        </div>
                        <button onClick={exportRmExcel}
                          className="flex items-center space-x-2 bg-emerald-600 text-white px-5 py-2.5 rounded-2xl font-bold shadow hover:bg-emerald-700 transition-all text-sm">
                          <FileText size={16} /><span>엑셀 저장 (11시트)</span>
                        </button>
                      </div>
                      {/* 원료 탭 */}
                      <div className="flex flex-wrap gap-1.5">
                        {RM_LIST.map(m => (
                          <button key={m} onClick={() => setRmActiveMaterial(m)}
                            className={`px-3 py-1.5 rounded-xl text-[11px] font-black transition-all border ${rmActiveMaterial === m ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                            {m}
                          </button>
                        ))}
                      </div>
                      {/* 테이블 */}
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100">
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">날짜</th>
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase text-right">전재고(kg)</th>
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase text-right">입고량(kg)</th>
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase text-right">사용량(kg)</th>
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase text-right">현재고(kg)</th>
                              <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">비고</th>
                              <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {activeLedger.length === 0 ? (
                              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-300 text-sm font-bold">데이터 없음</td></tr>
                            ) : activeLedger.map((row, i) => (
                              <React.Fragment key={row.id || i}>
                                <tr className={`hover:bg-slate-50 transition-colors ${row.type === 'correction' ? 'bg-amber-50/40' : row.type === 'auto' ? 'bg-blue-50/30' : ''}`}>
                                  <td className="px-4 py-2.5 text-[11px] font-bold text-slate-600">
                                    {row.date}
                                    {row.type === 'auto' && <span className="ml-1 text-[9px] text-blue-400 font-black">자동</span>}
                                    {row.type === 'correction' && <span className="ml-1 text-[9px] text-amber-500 font-black">정정</span>}
                                  </td>
                                  <td className="px-4 py-2.5 text-[11px] text-slate-500 text-right">{row.prevBalance}</td>
                                  <td className="px-4 py-2.5 text-[11px] font-black text-indigo-600 text-right">{row.received > 0 ? `+${row.received}` : '-'}</td>
                                  <td className="px-4 py-2.5 text-[11px] font-black text-rose-500 text-right">{row.used !== 0 ? (row.used > 0 ? `-${row.used}` : `+${Math.abs(row.used)}`) : '-'}</td>
                                  <td className="px-4 py-2.5 text-[11px] font-black text-slate-800 text-right">{row.currentBalance}</td>
                                  <td className="px-4 py-2.5 text-[11px] text-slate-500">{row.note || '-'}</td>
                                  <td className="px-3 py-2.5 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      {row.id && (
                                        <button
                                          onClick={() => { setRmCorrectionTargetId(rmCorrectionTargetId === row.id ? null : row.id!); setRmCorrectionForm({ date: new Date().toISOString().slice(0, 10), amount: '', isNegative: true, note: '' }); }}
                                          className="px-2 py-1 rounded-lg text-[10px] font-black bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                                        >정정</button>
                                      )}
                                      {row.id && row.type !== 'auto' && (
                                        <button
                                          onClick={async () => { if (confirm('삭제할까요?')) { await deleteItem('rawMaterialLedger', row.id!); setLedgerReloadKey(k => k + 1); } }}
                                          className="px-2 py-1 rounded-lg text-[10px] font-black bg-slate-100 text-slate-400 hover:bg-rose-100 hover:text-rose-500 transition-colors"
                                        >삭제</button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                                {rmCorrectionTargetId === row.id && (
                                  <tr className="bg-amber-50 border-t border-amber-200">
                                    <td colSpan={7} className="px-4 py-3">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-[11px] font-black text-amber-700">정정 추가</span>
                                        <input type="date" value={rmCorrectionForm.date}
                                          onChange={e => setRmCorrectionForm(f => ({ ...f, date: e.target.value }))}
                                          className="border border-amber-300 rounded-lg px-2 py-1 text-[11px] outline-none focus:border-amber-500" />
                                        <select value={rmCorrectionForm.isNegative ? 'neg' : 'pos'}
                                          onChange={e => setRmCorrectionForm(f => ({ ...f, isNegative: e.target.value === 'neg' }))}
                                          className="border border-amber-300 rounded-lg px-2 py-1 text-[11px] outline-none focus:border-amber-500">
                                          <option value="neg">사용량 감소 (−)</option>
                                          <option value="pos">사용량 증가 (+)</option>
                                        </select>
                                        <input type="number" min="0" step="0.001" placeholder={`수량(${unitOf(rmActiveMaterial)})`} value={rmCorrectionForm.amount}
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
                                            const correctionUsed = rmCorrectionForm.isNegative ? -amtKg : amtKg;
                                            const baseNote = rmCorrectionForm.note || `정정 (원본: ${row.id})`;
                                            const inputTag = inputUnit === 'L' ? ` · 사용자 입력: ${amt}L` : '';
                                            await addItem('rawMaterialLedger', {
                                              id: `rm-corr-${Date.now()}`,
                                              material: rmActiveMaterial,
                                              date: rmCorrectionForm.date,
                                              received: 0,
                                              used: correctionUsed,
                                              note: baseNote + inputTag,
                                              createdAt: new Date().toISOString(),
                                              type: 'correction',
                                              unit: 'kg',
                                              originalAmount: amt,
                                              originalUnit: inputUnit,
                                            });
                                            // 로트/재고 연동 — 예전엔 수불부 문서만 쓰고 로트를 안 건드려
                                            // 정정이 실재고에 반영 안 됐음(수불부-재고 괴리 원인 중 하나)
                                            const rawItem = allItems.find(i => (i.category === 'raw' || (i.category === 'wip' && i.unit !== '개')) && baseRawName(i.name) === rmActiveMaterial);
                                            if (rawItem) {
                                              try {
                                                if (correctionUsed > 0) {
                                                  // 사용량 증가 = 재고 차감 (FIFO, 기존재고 이월 보존)
                                                  await mutateRawMaterialLots(
                                                    rawItem.id,
                                                    (lots, stock) => deductFromLots(withCarryOverLot(lots, stock, rmActiveMaterial), correctionUsed).lots,
                                                    (lots) => lotStockInUnit(lots, rmActiveMaterial),
                                                  );
                                                } else if (correctionUsed < 0) {
                                                  // 사용량 감소 = 재고 복원 (정정 로트 추가)
                                                  const lot = buildReceiveLot({ material: rmActiveMaterial, supplierName: '수불부 정정', qtyIn: 0, kgIn: -correctionUsed, receivedDate: rmCorrectionForm.date });
                                                  await mutateRawMaterialLots(
                                                    rawItem.id,
                                                    (lots, stock) => { const base = withCarryOverLot(lots, stock, rmActiveMaterial); return [...base, { ...lot, lotNo: nextLotNo(base, lot.receivedDate) }]; },
                                                    (lots) => lotStockInUnit(lots, rmActiveMaterial),
                                                  );
                                                }
                                              } catch (err) {
                                                console.error('[수불부 정정] 로트/재고 반영 실패:', err);
                                                alert('정정 기록은 저장됐지만 재고(로트) 반영에 실패했습니다. 재고를 확인해 주세요.');
                                              }
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
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}


                {docTab === '생산작업기록부' && (() => {
                  const PRODUCTION_CATEGORIES = [
                    '시골향참기름1', '시골향참기름2', '시골향참기름3', '시골향참기름4',
                    '하남댁참기름', '시골향들기름1', '시골향들기름2', '하남댁들기름',
                  ];
                  const CATEGORY_DISPLAY: Record<string, string> = {
                    '시골향참기름1': '시골향참기름① (통깨 100%)',
                    '시골향참기름2': '시골향참기름② (통깨 100%)',
                    '시골향참기름3': '시골향참기름③ (통깨 100%)',
                    '시골향참기름4': '시골향참기름④ (통깨 100%)',
                    '하남댁참기름': '하남댁참기름',
                    '시골향들기름1': '시골향들기름①',
                    '시골향들기름2': '시골향들기름②',
                    '하남댁들기름': '하남댁들기름',
                  };
                  const parseVolumeLiter = (vol: string): number => {
                    if (vol.endsWith('ml')) return parseFloat(vol) / 1000;
                    if (vol.endsWith('l')) return parseFloat(vol);
                    if (vol.endsWith('kg')) return parseFloat(vol);
                    return 0;
                  };
                  const displayVol = (vol: string) =>
                    vol.endsWith('ml') && parseFloat(vol) >= 1000
                      ? `${parseFloat(vol) / 1000}l` : vol;
                  const calcExpiry = (mfgDate: string) => {
                    if (!mfgDate) return '';
                    const d = new Date(mfgDate);
                    d.setFullYear(d.getFullYear() + 1);
                    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
                  };
                  const [wy, wm] = productionWorkMonth.split('-').map(Number);
                  const daysInMonth = new Date(wy, wm, 0).getDate();
                  // 해당 카테고리 + 해당 월의 데이터 수집
                  type WRow = { spec: string; 수량: number; mfgDate: string };
                  const dayMap: Record<number, WRow[]> = {};
                  orders
                    .filter(o => [OrderStatus.SHIPPED, OrderStatus.DELIVERED].includes(o.status as OrderStatus))
                    .forEach(order => {
                      const docStr = order.documentDate || order.deliveryDate;
                      if (!docStr) return;
                      const d = new Date(docStr);
                      if (d.getFullYear() !== wy || d.getMonth() + 1 !== wm) return;
                      const day = d.getDate();
                      order.items.forEach(item => {
                        const p = allItems.find(pr => pr.id === item.itemId);
                        const remappedPumok = p?.품목 === '새싹참기름' ? '하남댁참기름' : p?.품목 === '새싹들기름' ? '하남댁들기름' : p?.품목;
                        if (!p || remappedPumok !== productionWorkCat) return;
                        if (!dayMap[day]) dayMap[day] = [];
                        const existing = dayMap[day].find(r => r.spec === (p.spec || ''));
                        if (existing) existing.수량 += item.quantity;
                        else dayMap[day].push({ spec: p.spec || '', 수량: item.quantity, mfgDate: item.mfgDate || '' });
                      });
                    });
                  let totalInput = 0;
                  let totalQty = 0;
                  return (
                    <div className="space-y-4">
                      {/* 카테고리 탭 */}
                      <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm flex-wrap gap-1">
                        {PRODUCTION_CATEGORIES.map(cat => (
                          <button
                            key={cat}
                            onClick={() => setProductionWorkCat(cat)}
                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${productionWorkCat === cat ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                      {/* 문서 헤더 */}
                      <div className="bg-white rounded-2xl border border-slate-200 p-6">
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-sm font-bold text-slate-700">년 월 : {wy}년 {wm}월</span>
                          <span className="text-sm font-bold text-slate-700">관리자 : 임 기 주</span>
                        </div>
                        <div className="text-sm font-bold text-slate-700 mb-1">품 목 : {CATEGORY_DISPLAY[productionWorkCat] || productionWorkCat}</div>
                        <div className="flex justify-between items-start">
                          <span className="text-sm font-bold text-slate-700">담당자 : 이 은 경</span>
                          <span className="text-xs text-slate-400 font-bold">( 단 위 : Kg )</span>
                        </div>
                      </div>
                      {/* 테이블 */}
                      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
                        <table className="text-xs border-collapse w-full min-w-[640px]">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                              {['일 자', '투입량(Kg)', '생산품목', '생산수량(개)', '생산량', '유통기한', '비고'].map(h => (
                                <th key={h} className="px-3 py-2.5 text-center text-[10px] font-black text-slate-500 border border-slate-200">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {Array.from({ length: daysInMonth }, (_, i) => i + 1).flatMap(day => {
                              const rows = (dayMap[day] || []).sort((a, b) => a.spec.localeCompare(b.spec));
                              if (rows.length === 0) {
                                return [(
                                  <tr key={day} className="border-b border-slate-100">
                                    <td className="px-3 py-1.5 text-center font-bold text-slate-600 border border-slate-100 w-12">{day}</td>
                                    <td className="px-3 py-1.5 text-center text-slate-300 border border-slate-100">-</td>
                                    <td className="border border-slate-100" />
                                    <td className="border border-slate-100" />
                                    <td className="px-3 py-1.5 text-center text-slate-300 border border-slate-100">-</td>
                                    <td className="border border-slate-100" />
                                    <td className="border border-slate-100" />
                                  </tr>
                                )];
                              }
                              return rows.map((row, i) => {
                                const vol = parseVolumeLiter(row.spec);
                                const inputKg = Math.round(vol * row.수량 * 0.92);
                                totalInput += inputKg;
                                const sobiDisp = row.mfgDate ? row.mfgDate.replace(/-/g, '.') : '';
                                return (
                                  <tr key={`${day}-${i}`} className="border-b border-slate-100 hover:bg-slate-50/50">
                                    <td className="px-3 py-1.5 text-center font-bold text-slate-600 border border-slate-100">
                                      {i === 0 ? day : ''}
                                    </td>
                                    <td className="px-3 py-1.5 text-center font-bold text-indigo-700 border border-slate-100">{inputKg}</td>
                                    <td className="px-3 py-1.5 text-center text-slate-700 border border-slate-100">{displayVol(row.spec)}</td>
                                    <td className="px-3 py-1.5 text-center text-slate-700 border border-slate-100">{row.수량}</td>
                                    <td className="px-3 py-1.5 text-center font-bold text-indigo-700 border border-slate-100">{inputKg}</td>
                                    <td className="px-3 py-1.5 text-center text-slate-600 border border-slate-100">{sobiDisp}</td>
                                    <td className="border border-slate-100" />
                                  </tr>
                                );
                              });
                            })}
                            <tr className="bg-slate-50 font-bold">
                              <td className="px-3 py-2 text-center text-slate-700 border border-slate-200">총 량</td>
                              <td className="px-3 py-2 text-center text-indigo-800 border border-slate-200">{totalInput}</td>
                              <td className="border border-slate-200" />
                              <td className="border border-slate-200" />
                              <td className="border border-slate-200" />
                              <td className="border border-slate-200" />
                              <td className="border border-slate-200" />
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {docTab === '생산작업기록부2' && (() => {
                  const [lm2Year, lm2Month] = prodLedger2Month.split('-').map(Number);
                  const daysInMonth2 = new Date(lm2Year, lm2Month, 0).getDate();

                  const parseVolL = (vol: string): number => {
                    if (!vol) return 0;
                    const v = vol.toLowerCase();
                    if (v.endsWith('ml')) return parseFloat(v) / 1000;
                    if (v.endsWith('l')) return parseFloat(v);
                    return 0;
                  };

                  const getDayKg = (day: number, catKey: string): number => {
                    let total = 0;
                    orders
                      .filter(o => [OrderStatus.SHIPPED, OrderStatus.DELIVERED].includes(o.status as OrderStatus))
                      .forEach(order => {
                        const docStr = order.documentDate || order.deliveryDate;
                        if (!docStr) return;
                        const d = new Date(docStr);
                        if (d.getFullYear() !== lm2Year || d.getMonth() + 1 !== lm2Month || d.getDate() !== day) return;
                        order.items.forEach(item => {
                          const p = allItems.find(pr => pr.id === item.itemId);
                          if (!p || p.품목 !== catKey) return;
                          total += Math.round(parseVolL(p.spec || '') * item.quantity * 0.92);
                        });
                      });
                    return total;
                  };

                  const getOutflow = (day: number, type: '통깨참기름' | '깨분참기름'): number => {
                    const kg1 = getDayKg(day, '시골향참기름1');
                    const kg2 = getDayKg(day, '시골향참기름2');
                    const kg3 = getDayKg(day, '시골향참기름3');
                    if (type === '통깨참기름') return kg1 + Math.round(kg2 / 2);
                    return kg3 + Math.round(kg2 / 2);
                  };

                  const getLedgerEntry = (type: string, date: string) =>
                    sesameInputLedger.find(e => e.type === type && e.date === date);

                  const getInflow = (day: number, type: string): number =>
                    getLedgerEntry(type, `${prodLedger2Month}-${String(day).padStart(2, '0')}`)?.amount || 0;

                  const getInitStock = (type: string): number =>
                    getLedgerEntry(type, `${prodLedger2Month}-init`)?.amount || 0;

                  const saveEntry = async (type: string, date: string, amount: number) => {
                    const existing = getLedgerEntry(type, date);
                    if (existing) {
                      await updateItem('sesameInputLedger', existing.id, { amount });
                    } else {
                      await addItem('sesameInputLedger', { type, date, amount });
                    }
                  };

                  const tongkaeStocks: number[] = new Array(daysInMonth2 + 1).fill(0);
                  const gaebbunStocks: number[] = new Array(daysInMonth2 + 1).fill(0);
                  let tStock = getInitStock('통깨참기름');
                  let gStock = getInitStock('깨분참기름');
                  for (let day = 1; day <= daysInMonth2; day++) {
                    tStock = tStock + getInflow(day, '통깨참기름') - getOutflow(day, '통깨참기름');
                    gStock = gStock + getInflow(day, '깨분참기름') - getOutflow(day, '깨분참기름');
                    tongkaeStocks[day] = tStock;
                    gaebbunStocks[day] = gStock;
                  }

                  let totalTIn = 0, totalTOut = 0, totalGIn = 0, totalGOut = 0;
                  for (let day = 1; day <= daysInMonth2; day++) {
                    totalTIn += getInflow(day, '통깨참기름');
                    totalTOut += getOutflow(day, '통깨참기름');
                    totalGIn += getInflow(day, '깨분참기름');
                    totalGOut += getOutflow(day, '깨분참기름');
                  }

                  return (
                    <div className="space-y-4">
                      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                          <span className="text-sm font-bold text-slate-700">참기름 원료 수불부</span>
                          <span className="text-sm font-bold text-slate-500">{lm2Year}년 {lm2Month}월</span>
                        </div>
                        <table className="text-xs border-collapse w-full min-w-[720px]">
                          <thead>
                            <tr className="bg-slate-50">
                              <th rowSpan={2} className="px-3 py-2.5 text-center text-[10px] font-black text-slate-500 border border-slate-200 w-12">일자</th>
                              <th colSpan={3} className="px-3 py-2 text-center text-[10px] font-black text-slate-500 border border-slate-200">통깨참기름 (Kg)</th>
                              <th colSpan={3} className="px-3 py-2 text-center text-[10px] font-black text-slate-500 border border-slate-200">깨분참기름 (Kg)</th>
                              <th colSpan={3} className="px-3 py-2 text-center text-[10px] font-black text-slate-500 border border-slate-200">참기름 총량 (Kg)</th>
                            </tr>
                            <tr className="bg-slate-50">
                              {['입고', '출고', '재고', '입고', '출고', '재고', '입고', '출고', '재고'].map((h, i) => (
                                <th key={i} className="px-3 py-1.5 text-center text-[10px] font-black text-slate-400 border border-slate-200">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr key={`init-${prodLedger2Month}`} className="bg-amber-50">
                              <td className="px-3 py-1.5 text-center font-bold text-slate-600 border border-slate-200 text-[10px] whitespace-nowrap">전기이월</td>
                              <td className="border border-slate-200" />
                              <td className="border border-slate-200" />
                              <td className="border border-slate-200 p-0">
                                <input
                                  key={`ti-${prodLedger2Month}-${getInitStock('통깨참기름')}`}
                                  type="number"
                                  defaultValue={getInitStock('통깨참기름') || ''}
                                  onBlur={e => saveEntry('통깨참기름', `${prodLedger2Month}-init`, Number(e.target.value))}
                                  className="w-full text-center text-xs font-bold text-amber-800 bg-transparent outline-none px-2 py-1.5"
                                  placeholder="0"
                                />
                              </td>
                              <td className="border border-slate-200" />
                              <td className="border border-slate-200" />
                              <td className="border border-slate-200 p-0">
                                <input
                                  key={`gi-${prodLedger2Month}-${getInitStock('깨분참기름')}`}
                                  type="number"
                                  defaultValue={getInitStock('깨분참기름') || ''}
                                  onBlur={e => saveEntry('깨분참기름', `${prodLedger2Month}-init`, Number(e.target.value))}
                                  className="w-full text-center text-xs font-bold text-amber-800 bg-transparent outline-none px-2 py-1.5"
                                  placeholder="0"
                                />
                              </td>
                              <td className="border border-slate-200" />
                              <td className="border border-slate-200" />
                              <td className="px-3 py-1.5 text-center font-bold text-amber-800 border border-slate-200">{getInitStock('통깨참기름') + getInitStock('깨분참기름') || ''}</td>
                            </tr>
                            {Array.from({ length: daysInMonth2 }, (_, i) => i + 1).map(day => {
                              const dateStr = `${prodLedger2Month}-${String(day).padStart(2, '0')}`;
                              const tIn = getInflow(day, '통깨참기름');
                              const tOut = getOutflow(day, '통깨참기름');
                              const tSt = tongkaeStocks[day];
                              const gIn = getInflow(day, '깨분참기름');
                              const gOut = getOutflow(day, '깨분참기름');
                              const gSt = gaebbunStocks[day];
                              return (
                                <tr key={`${prodLedger2Month}-${day}`} className="border-b border-slate-100 hover:bg-slate-50/50">
                                  <td className="px-3 py-1.5 text-center font-bold text-slate-600 border border-slate-100">{day}</td>
                                  <td className="border border-slate-100 p-0">
                                    <input
                                      key={`t-in-${dateStr}-${tIn}`}
                                      type="number"
                                      defaultValue={tIn || ''}
                                      onBlur={e => saveEntry('통깨참기름', dateStr, Number(e.target.value))}
                                      className="w-full text-center text-xs text-slate-700 bg-transparent outline-none px-2 py-1.5"
                                      placeholder="-"
                                    />
                                  </td>
                                  <td className="px-3 py-1.5 text-center text-slate-700 border border-slate-100">{tOut > 0 ? tOut : '-'}</td>
                                  <td className="px-3 py-1.5 text-center font-bold text-indigo-700 border border-slate-100">{tSt}</td>
                                  <td className="border border-slate-100 p-0">
                                    <input
                                      key={`g-in-${dateStr}-${gIn}`}
                                      type="number"
                                      defaultValue={gIn || ''}
                                      onBlur={e => saveEntry('깨분참기름', dateStr, Number(e.target.value))}
                                      className="w-full text-center text-xs text-slate-700 bg-transparent outline-none px-2 py-1.5"
                                      placeholder="-"
                                    />
                                  </td>
                                  <td className="px-3 py-1.5 text-center text-slate-700 border border-slate-100">{gOut > 0 ? gOut : '-'}</td>
                                  <td className="px-3 py-1.5 text-center font-bold text-indigo-700 border border-slate-100">{gSt}</td>
                                  <td className="px-3 py-1.5 text-center text-slate-700 border border-slate-100">{tIn + gIn > 0 ? tIn + gIn : '-'}</td>
                                  <td className="px-3 py-1.5 text-center text-slate-700 border border-slate-100">{tOut + gOut > 0 ? tOut + gOut : '-'}</td>
                                  <td className="px-3 py-1.5 text-center font-bold text-indigo-800 border border-slate-100">{tSt + gSt}</td>
                                </tr>
                              );
                            })}
                            <tr className="bg-slate-50 font-bold border-t-2 border-slate-300">
                              <td className="px-3 py-2 text-center text-slate-700 border border-slate-200">총 량</td>
                              <td className="px-3 py-2 text-center text-slate-800 border border-slate-200">{totalTIn || '-'}</td>
                              <td className="px-3 py-2 text-center text-slate-800 border border-slate-200">{totalTOut || '-'}</td>
                              <td className="px-3 py-2 text-center text-indigo-800 border border-slate-200">{tongkaeStocks[daysInMonth2]}</td>
                              <td className="px-3 py-2 text-center text-slate-800 border border-slate-200">{totalGIn || '-'}</td>
                              <td className="px-3 py-2 text-center text-slate-800 border border-slate-200">{totalGOut || '-'}</td>
                              <td className="px-3 py-2 text-center text-indigo-800 border border-slate-200">{gaebbunStocks[daysInMonth2]}</td>
                              <td className="px-3 py-2 text-center text-slate-800 border border-slate-200">{(totalTIn + totalGIn) || '-'}</td>
                              <td className="px-3 py-2 text-center text-slate-800 border border-slate-200">{(totalTOut + totalGOut) || '-'}</td>
                              <td className="px-3 py-2 text-center text-indigo-800 border border-slate-200">{tongkaeStocks[daysInMonth2] + gaebbunStocks[daysInMonth2]}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}
          {currentView === 'trade-statement' && (
            <TradeStatement
              orders={allOrders}
              allItems={allItems}
              partners={partners}
              partnerItems={partnerItems}
              accountCodes={appData.accountCodes}
              expensePresets={appData.expensePresets}
              onAddExpensePreset={async (p) => { const id = await addItem('expensePresets', { ...p, id: `exp-${Date.now()}`, createdAt: new Date().toISOString() }); refreshStaticData(); return id as string; }}
              onDeleteExpensePreset={(id) => { deleteItem('expensePresets', id); refreshStaticData(); }}
              issuedStatements={issuedStatements}
              onUpdateStatus={(id, status) => changeOrderStatus(id, status)}
              onUpsertPartnerItem={(ps) => handleUpsertPartnerItem(ps, 'out')}
              onMarkInvoicePrinted={(id, value) => updateItem('orders', id, { invoicePrinted: value })}
              onUpdateOrder={(id, data) => updateItem('orders', id, data)}
              onAddIssuedStatement={(stmt) => addItem('issuedStatements', stmt).catch(e => { console.error('전표 저장 실패:', e); alert('전표 저장 실패: ' + (e?.message ?? String(e))); })}
              onUpdateIssuedStatement={(id, data) => updateItem('issuedStatements', id, data)}
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
              onDeleteIssuedStatement={(id) => deleteItem('issuedStatements', id)}
              pendingInvoice={pendingInvoice}
              onClearPendingInvoice={() => setPendingInvoice(null)}
              confirmedOrders={invoicedPurchaseOrders}
              orderRequests={pendingPurchaseOrders}
              onAddConfirmedOrder={async (item) => {
                const existing = purchaseOrders.find(po => po.id === item.id);
                if (existing) {
                  await updateItem('purchaseOrders', item.id, {
                    status: 'invoiced', quantity: item.quantity,
                    isBox: item.isBox ?? false, invoicedAt: new Date().toISOString(),
                    ...(item.partnerId ? { partnerId: item.partnerId, partnerName: item.partnerName } : {}),
                  });
                } else {
                  const product = allItems.find(p => p.id === item.id);
                  await addItem('purchaseOrders', {
                    id: item.id, itemId: item.id, itemName: product?.name ?? '',
                    quantity: item.quantity, isBox: item.isBox ?? false,
                    partnerId: item.partnerId, partnerName: item.partnerName,
                    status: 'invoiced', createdAt: new Date().toISOString(),
                    invoicedAt: new Date().toISOString(),
                  });
                }
              }}
              onRemoveConfirmedOrder={(id) => deleteItem('purchaseOrders', id)}
              onRemoveOrderRequest={handleRemoveOrderRequest}
              onLinkPurchaseOrder={(poId, statementId) => {
                // 선입고(received)는 이미 입고완료 → status 유지하고 전표만 연결.
                // 발주예정(pending) 등은 입고대기(invoiced)로 전환.
                const po = purchaseOrders.find(p => p.id === poId);
                const isReceived = po?.status === 'received';
                // 선입고: 상태 유지 + 발행시각 기록(1일 뒤 자동삭제 기준). 발주예정: 입고대기로 전환.
                updateItem('purchaseOrders', poId, { linkedStatementId: statementId, ...(isReceived ? { linkedStatementAt: new Date().toISOString() } : { status: 'invoiced', invoicedAt: new Date().toISOString() }) });
              }}
              onCreateInboundPO={(po) =>
                addItem('purchaseOrders', {
                  id: `po-${Date.now()}`, itemId: '', itemName: '', quantity: 0,
                  partnerId: po.partnerId, partnerName: po.partnerName,
                  items: po.items, status: 'invoiced',
                  invoicedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
                  linkedStatementId: po.statementId,
                })}
              companyInfo={companyInfo}
              onSaveCompanyInfo={(info) => setDocument('settings', 'company', info)}
              onUpdateItemCost={(itemId, cost) => updateItem('items', itemId, { cost })}
              onAddProductClient={(itemId, partnerId, price, taxType) =>
                addItem('partner_item', {
                  id: `${itemId}_${partnerId}_out`,
                  itemId, partnerId,
                  Direction: 'out' as const,
                  price, taxType,
                })
              }
            />
          )}
          {currentView === 'tax-statement' && (
            <TaxStatement
              issuedStatements={issuedStatements}
              partners={partners}
              companyInfo={companyInfo}
              onUpdateIssuedStatement={(id, data) => updateItem('issuedStatements', id, data)}
            />
          )}
          {(currentView === 'profit-analysis' || currentView === 'cost-management') && (
            <div className="h-full overflow-y-auto">
              <ProfitAnalysis
                issuedStatements={issuedStatements}
                fixedCosts={fixedCosts}
                fixedCostTemplates={appData.fixedCostTemplates}
                onAddCost={async (entry) => {
                  const { note, ...rest } = entry;
                  await addItem('fixedCosts', {
                    ...rest,
                    ...(note ? { note } : {}),
                    id: `fc-${Date.now()}`,
                    createdAt: new Date().toISOString(),
                  });
                }}
                onDeleteCost={(id) => deleteItem('fixedCosts', id)}
                onAddTemplate={async (data) => { await addItem('fixedCostTemplates', { ...data, id: `fct-${Date.now()}` }); refreshStaticData(); }}
                onUpdateTemplate={async (id, data) => { await updateItem('fixedCostTemplates', id, data); refreshStaticData(); }}
                onDeleteTemplate={async (id) => { await deleteItem('fixedCostTemplates', id); refreshStaticData(); }}
                partners={partners}
                items={allItems}
                onUpdateIssuedStatement={(id, data) => updateItem('issuedStatements', id, data)}
                accountGroups={appData.accountGroups}
                accountCodes={appData.accountCodes}
                onUpdateAccountCode={(id, data) => { updateItem('accountCodes', id, data); refreshStaticData(); }}
                onAddAccountCode={async (data) => { const id = await addItem('accountCodes', { ...data, id: `ac-${Date.now()}` }); refreshStaticData(); return id; } }
                onDeleteAccountCode={(id) => { deleteItem('accountCodes', id); refreshStaticData(); }}
                onAddAccountGroup={async (data) => { const id = await addItem('accountGroups', { ...data, id: `ag-${Date.now()}` }); refreshStaticData(); return id; }}
                onUpdateAccountGroup={(id, data) => { updateItem('accountGroups', id, data); refreshStaticData(); }}
                onDeleteAccountGroup={(id) => { deleteItem('accountGroups', id); refreshStaticData(); }}
                inventorySnapshots={inventorySnapshots}
                onSaveInventorySnapshot={async (data) => { await addItem('inventorySnapshots', { ...data, id: `inv-snap-${data.yearMonth}` }); }}
                onGenerateRecurringCosts={async (ym) => {
                  // 정기 고정비 → '비용' 전표로 생성 (계정코드·기간 지정된 것만, 중복 방지)
                  const tpls = appData.fixedCostTemplates.filter(t => t.active && t.accountCode
                    && (!t.startYm || t.startYm <= ym) && (!t.endYm || ym <= t.endYm));
                  let created = 0;
                  for (const t of tpls) {
                    const rcKey = `RC-${t.id}-${ym}`;
                    if (issuedStatements.some(s => (s as any).orderId === rcKey)) continue;
                    const code = appData.accountCodes.find(c => c.code === t.accountCode);
                    const amt = t.amount;
                    await addItem('issuedStatements', {
                      issuedAt: new Date().toISOString(), tradeDate: `${ym}-01`, type: '비용' as const,
                      partnerId: '', partnerName: t.partnerName || t.name, orderId: rcKey,
                      docNo: `정기${ym}-${t.id.slice(-4)}`, totalSupply: amt, totalTax: 0, totalAmount: amt,
                      items: [{ name: code?.name || t.name, spec: '', qty: 1, price: amt, supply: amt, tax: 0, total: amt, isTaxExempt: true, accountCode: t.accountCode }],
                    } as any);
                    created++;
                  }
                  return created;
                }}
              />
            </div>
          )}
          {currentView === 'partner-stats' && (
            <div className="h-full overflow-y-auto">
              <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
                <ProfitAnalysis
                  initialTab="partners"
                  issuedStatements={issuedStatements}
                  fixedCosts={fixedCosts}
                  fixedCostTemplates={appData.fixedCostTemplates}
                  onAddCost={async (entry) => {
                    const { note, ...rest } = entry;
                    await addItem('fixedCosts', { ...rest, ...(note ? { note } : {}), id: `fc-${Date.now()}`, createdAt: new Date().toISOString() });
                  }}
                  onDeleteCost={(id) => deleteItem('fixedCosts', id)}
                  partners={partners}
                  items={allItems}
                  onUpdateIssuedStatement={(id, data) => updateItem('issuedStatements', id, data)}
                  accountGroups={appData.accountGroups}
                  accountCodes={appData.accountCodes}
                  inventorySnapshots={inventorySnapshots}
                />
              </React.Suspense>
            </div>
          )}
          {currentView === 'cash-flow' && (
            <div className="h-full overflow-y-auto">
              <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
                <ProfitAnalysis
                  initialTab="cash-flow"
                  issuedStatements={issuedStatements}
                  fixedCosts={fixedCosts}
                  fixedCostTemplates={appData.fixedCostTemplates}
                  onAddCost={async (entry) => {
                    const { note, ...rest } = entry;
                    await addItem('fixedCosts', { ...rest, ...(note ? { note } : {}), id: `fc-${Date.now()}`, createdAt: new Date().toISOString() });
                  }}
                  onDeleteCost={(id) => deleteItem('fixedCosts', id)}
                  partners={partners}
                  items={allItems}
                  onUpdateIssuedStatement={(id, data) => updateItem('issuedStatements', id, data)}
                  accountGroups={appData.accountGroups}
                  accountCodes={appData.accountCodes}
                  inventorySnapshots={inventorySnapshots}
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
              <HaccpChecklist currentUser={{ id: currentUser.id, name: currentUser.name }} isAdmin={isAdmin} />
            </React.Suspense>
          )}
          {currentView === 'return-management' && (
            <React.Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩중...</div>}>
              <ReturnManager
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
                // 실제 재고 반영 로직
                const product = allItems.find(p => p.id === req.itemId);
                if (product) {
                  const collectionName = getProductCollection(product.category);
                  if (req.type === 'quantity_change') {
                    // 수량 변동 승인 시, 요청된 수량만큼 재고에 더함
                    const target = rawLotTarget(allItems, product, product.name);
                    if (target) {
                      await adjustRawLots({ material: target.baseName, rawItemId: target.rawItem.id, deltaKg: unitToKg(req.requestedQuantity || 0, target.baseName), date: new Date().toISOString().slice(0, 10), note: '재고조정', addedBy: currentUser?.name });
                    } else {
                      await updateItem(collectionName, req.itemId, { stock: product.stock + (req.requestedQuantity || 0) });
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
              <SanitationChecklistView currentUser={currentUser ? { id: currentUser.id, name: currentUser.name } : undefined} isAdmin={isAdmin} />
            </React.Suspense>
          )}
          {currentView === 'leave-portal' && (
            <LeaveManager
              currentUser={currentUser}
              employees={employees}
              leaveRequests={leaveRequests}
              onAddLeaveRequest={async (req) => {
                await addItem('leaveRequests', req);
                const admin = employees.find(e => e.id === 'admin');
                await addItem('notifications', {
                  type: 'leave_request',
                  title: '신규 연차 신청',
                  body: `${req.employeeName}님이 ${req.type} (${req.startDate}${req.startDate !== req.endDate ? ` ~ ${req.endDate}` : ''}, ${req.daysUsed}일)을 신청했습니다.`,
                  readBy: [],
                  createdAt: new Date().toISOString(),
                  senderId: req.employeeId,
                  targetId: admin?.id ?? 'admin',
                  linkedId: req.id,
                } as Omit<AppNotification, 'id'>);
              }}
              onUpdateLeaveStatus={(id, status) => updateItem('leaveRequests', id, { status })}
              onUpdateLeave={(id, updates) => updateItem('leaveRequests', id, updates)}
            />
          )}
          {currentView === 'item-management' && (
            <div className="flex flex-col h-full overflow-y-auto">
              {true && (
                <ItemManager
                  isAdmin={isAdmin}
                  items={allItems}
                  partners={partners}
                  partnerItems={partnerItems}
                  onEditProduct={(p) => { setEditingProduct(p); setIsProductModalOpen(true); }}
                  onAddItem={() => { setEditingProduct(null); setIsProductModalOpen(true); }}
                  onDeleteItem={(id) => {
                    const inProducts = items.some(p => p.id === id);
                    deleteItem(inProducts ? 'items' : 'items', id);
                  }}
                  onLinkItem={async (itemId, partnerId) => {
                    const current = partnerOut.filter(pc => pc.Item_ID === itemId).map(pc => pc.Partner_ID);
                    if (!current.includes(partnerId)) {
                      await setProductClients(itemId, [...current, partnerId]);
                      refreshStaticData();
                    }
                  }}
                  onUnlinkItem={async (itemId, partnerId) => {
                    const current = partnerOut.filter(pc => pc.Item_ID === itemId).map(pc => pc.Partner_ID);
                    await setProductClients(itemId, current.filter(id => id !== partnerId));
                    refreshStaticData();
                  }}
                  onLinkSupplier={async (itemId, partnerId) => {
                    const current = partnerItems.filter(pi => pi.Item_ID === itemId && pi.Direction === 'in').map(pi => pi.Partner_ID);
                    if (!current.includes(partnerId)) {
                      await setProductSuppliers(itemId, [...current, partnerId]);
                      refreshStaticData();
                    }
                  }}
                  onUnlinkSupplier={async (itemId, partnerId) => {
                    const current = partnerItems.filter(pi => pi.Item_ID === itemId && pi.Direction === 'in').map(pi => pi.Partner_ID);
                    await setProductSuppliers(itemId, current.filter(id => id !== partnerId));
                    refreshStaticData();
                  }}
                  onMergeItems={async (keepId, deleteIds) => {
                    const { getDocs, query: q, collection: col, where, writeBatch: wb, doc: d } = await import('firebase/firestore');
                    const { db: fireDb } = await import('../../shared/firebase');
                    const batch = wb(fireDb);

                    for (const delId of deleteIds) {
                      const snap = await getDocs(q(col(fireDb, 'partner_item'), where('itemId', '==', delId)));
                      for (const docSnap of snap.docs) {
                        const data = docSnap.data();
                        const dir = data.Direction ?? 'out';
                        const pId = data.partnerId ?? data.Partner_ID;
                        const newId = `${keepId}_${pId}_${dir}`;
                        const newRef = d(fireDb, 'partner_item', newId);
                        const existing = partnerItems.find(pi => (pi.itemId ?? pi.Item_ID) === keepId && (pi.partnerId ?? pi.Partner_ID) === pId && pi.Direction === dir);
                        if (!existing) {
                          const { Item_ID, Partner_ID, Standard_Price, ...cleanData } = data as any;
                          batch.set(newRef, { ...cleanData, itemId: keepId, id: newId });
                        }
                        batch.delete(docSnap.ref);
                      }
                      batch.delete(d(fireDb, 'items', delId));
                    }
                    await batch.commit();
                  }}
                  shippingRules={shippingRules}
                  itemBoms={itemBoms}
                  onUpsertPartnerItem={(ps) => handleUpsertPartnerItem(ps, 'out')}
                  onSaveItemCustomer={async (ic: Partial<import('../../shared/types').PartnerItem> & { id: string }) => {
                    const { doc: fDoc, updateDoc: fUpdate } = await import('firebase/firestore');
                    const { db: fireDb } = await import('../../shared/firebase');
                    const { id, itemId, partnerId, price, item_id, customer_id, Item_ID, Partner_ID, Standard_Price, ...rest } = ic as any;
                    const data = Object.fromEntries(
                      Object.entries(rest).filter(([, v]) => v !== undefined)
                    );
                    await fUpdate(fDoc(fireDb, 'partner_item', id), data);
                    refreshStaticData();
                  }}
                  onSaveShippingRule={async (rule: Partial<import('../../shared/types').ShippingRule> & { id: string }) => {
                    const { doc: fDoc, updateDoc: fUpdate } = await import('firebase/firestore');
                    const { db: fireDb } = await import('../../shared/firebase');
                    const { id, ...data } = rule;
                    await fUpdate(fDoc(fireDb, 'shipping_rule', id), data);
                    refreshStaticData();
                  }}
                  onAddShippingRule={async (rule: Omit<import('../../shared/types').ShippingRule, 'id'>) => {
                    const { addDoc, collection: col } = await import('firebase/firestore');
                    const { db: fireDb } = await import('../../shared/firebase');
                    await addDoc(col(fireDb, 'shipping_rule'), rule);
                    refreshStaticData();
                  }}
                />
              )}
            </div>
          )}

          {currentView === 'item-price-management' && (
            <ItemPriceManager
              items={allItems}
              onEditProduct={(p) => { setEditingProduct(p); setIsProductModalOpen(true); }}
              onAddItem={() => { setEditingProduct(null); setIsProductModalOpen(true); }}
              onDeleteItem={(id) => deleteItem('items', id)}
              onUpdateCost={(itemId, cost) => updateItem('items', itemId, { cost })}
              onUpdatePrice={(itemId, price) => updateItem('items', itemId, { price })}
            />
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
              onSendMessage={async (msg) => {
                // 메시지 저장 (핵심 동작 — 실패 시 에러 전파)
                await addItem('chatMessages', msg);

                // 대화방 마지막 메시지 업데이트 (부가 동작 — 실패해도 메시지 저장은 유지)
                const room = chatRooms.find(r => r.id === msg.roomId);
                if (room) {
                  const now = new Date().toISOString();
                  updateItem('chatRooms', room.id, {
                    lastMessage: msg.text,
                    lastUpdatedAt: now,
                    lastReadBy: { ...(room.lastReadBy ?? {}), [msg.senderId]: now }
                  }).catch(console.error);

                  // 채팅 알림 — 본인 제외 참여자에게 전송
                  const recipients = room.participantIds.filter(id => id !== msg.senderId);
                  const roomName = room.name || (room.participantIds.length === 2
                    ? (employees.find(e => e.id === recipients[0])?.name ?? '알 수 없음')
                    : `단체 채팅`);
                  const preview = msg.text.length > 40 ? msg.text.slice(0, 40) + '…' : msg.text;
                  await Promise.all(recipients.map(recipientId =>
                    addItem('notifications', {
                      type: 'mention',
                      title: `${msg.senderName} (${roomName})`,
                      body: preview,
                      readBy: [],
                      createdAt: new Date().toISOString(),
                      senderId: msg.senderId,
                      linkedId: msg.roomId,
                      targetId: recipientId,
                    } as Omit<AppNotification, 'id'> & { targetId: string })
                  )).catch(console.error);
                }

                // @관리자 멘션 처리 (부가 동작)
                if (msg.text.includes('@관리자')) {
                  const adminRequest: AdjustmentRequest = {
                    id: `MENTION-${Date.now()}`,
                    itemId: 'chat-mention',
                    itemName: `[채팅 언급] ${msg.senderName}`,
                    originalQuantity: 0,
                    type: 'chat_mention',
                    reason: msg.text,
                    status: 'pending',
                    requestedAt: new Date().toISOString()
                  };
                  addItem('adjustmentRequests', adminRequest).catch(console.error);
                }
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
          correctPassword={companyInfo?.adminPassword || '0000'}
        />
      )}
      {isAddOrderOpen && <AddOrderModal items={allItems} partners={partners} partnerItems={partnerItems} shippingRules={shippingRules} palletStocks={pallets} submaterials={submaterials} onClose={() => setIsAddOrderOpen(false)} onSave={async (o) => {
        try {
          console.log('[AddOrder] 저장 시작', o);
          const orderId = `ORD-${Date.now()}`;
          await addItem('orders', {...o, id: orderId, createdAt: new Date().toISOString(), status: OrderStatus.PENDING});
          console.log('[AddOrder] orders 저장 완료', orderId);
          await checkAndAlertShortage(o.items, o.partnerId);
          const partnerName = partners.find(c => c.id === o.partnerId)?.name || o.partnerName || '거래처';
          await addItem('notifications', { type: 'new_order', title: '신규 주문', body: `${partnerName} 주문이 등록되었습니다.`, readBy: [], createdAt: new Date().toISOString(), senderId: currentUser.id, linkedId: orderId } as Omit<AppNotification,'id'>);
          setNewOrderId(orderId);
          setIsAddOrderOpen(false);
          console.log('[AddOrder] 완료');
        } catch (err) {
          console.error('[AddOrder] 저장 실패:', err);
          alert(`주문 저장 실패: ${err instanceof Error ? err.message : String(err)}`);
        }
      }} />}
      {isPasteOrderOpen && <PasteOrderModal items={allItems} partners={partners} partnerItems={partnerItems} onClose={() => setIsPasteOrderOpen(false)} onSave={async (o) => {
        try {
          console.log('[PasteOrder] 저장 시작', o);
          const orderId = `ORD-${Date.now()}`;
          await addItem('orders', {...o, id: orderId, createdAt: new Date().toISOString(), status: OrderStatus.PENDING});
          console.log('[PasteOrder] orders 저장 완료', orderId);
          await checkAndAlertShortage(o.items, o.partnerId);
          const partnerName = partners.find(c => c.id === o.partnerId)?.name || o.partnerName || '거래처';
          await addItem('notifications', { type: 'new_order', title: '신규 주문', body: `${partnerName} 주문이 등록되었습니다.`, readBy: [], createdAt: new Date().toISOString(), senderId: currentUser.id, linkedId: orderId } as Omit<AppNotification,'id'>);
          setNewOrderId(orderId);
          setIsPasteOrderOpen(false);
          console.log('[PasteOrder] 완료');
        } catch (err) {
          console.error('[PasteOrder] 저장 실패:', err);
          alert(`주문 저장 실패: ${err instanceof Error ? err.message : String(err)}`);
        }
      }} />}
      {isProductModalOpen && (
        <ProductModal
          initialData={editingProduct || undefined}
          allSubmaterials={submaterials}
          items={products}
          rawItems={allItems.filter(i => i.category === 'raw' || i.category === 'wip')}
          itemFormulas={itemFormulas}
          onSaveItemFormula={async (parentKey, rows, prevKey) => {
            const batch = writeBatch(db);
            const keys = new Set([parentKey, prevKey].filter(Boolean) as string[]);
            itemFormulas.filter(f => keys.has(f.parent_key)).forEach(f => batch.delete(doc(db, 'item_formula', f.id)));
            rows.forEach(r => {
              const id = `formula-${parentKey}-${r.child_name}`.replace(/\s/g, '_');
              batch.set(doc(db, 'item_formula', id), { parent_key: parentKey, child_name: r.child_name, ratio: r.ratio ?? 1, yield_rate: r.yield_rate });
            });
            await batch.commit();
            refreshStaticData();
          }}
          partners={partners}
          partnerItems={partnerItems}
          shippingRules={shippingRules}
          onClose={() => {setIsProductModalOpen(false); setEditingProduct(null);}}
          onSaveShippingRule={async (rule: Partial<ShippingRule> & { id: string }) => {
            const { doc: fDoc, updateDoc: fUpdate } = await import('firebase/firestore');
            const { db: fireDb } = await import('../../shared/firebase');
            const { id, ...data } = rule;
            await fUpdate(fDoc(fireDb, 'shipping_rule', id), data);
            refreshStaticData();
          }}
          onAddShippingRule={async (rule: Omit<ShippingRule, 'id'>) => {
            const { addDoc, collection: col } = await import('firebase/firestore');
            const { db: fireDb } = await import('../../shared/firebase');
            await addDoc(col(fireDb, 'shipping_rule'), rule);
            refreshStaticData();
          }}
          onUpsertPartnerItem={(ps: PartnerItem) => handleUpsertPartnerItem(ps, 'in')}
          onDeletePartnerItem={(id: string) => { deleteItem('partner_item', id); refreshStaticData(); }}
          onAddSubmaterial={async (name, category) => {
            const unit = category === '라벨' ? '매' : '개';
            const id = await addItem('items', { name, category, stock: 0, minStock: 0, unit, price: 0, image: '' });
            return id as string;
          }}
          onSave={async (p) => {
            const collectionName = getProductCollection(p.category);
            // 기존 컬렉션과 다른 경우(카테고리 변경) 이전 문서 삭제
            if (editingProduct) {
              const prevCollection = getProductCollection(editingProduct.category);
              if (prevCollection !== collectionName) {
                await deleteItem(prevCollection, p.id);
              }
            }
            // 품목 저장(순수 쓰기)을 최우선으로 — 거래처 매핑(setProductClients)은 getDocs(읽기)가
            // 필요해 읽기 한도(429) 시 throw 되는데, 예전엔 그게 품목 저장 자체를 막아 "저장이 안 됨"
            // 으로 보였다. 품목부터 저장하고 매핑은 부수효과로 분리한다(Blaze 후에도 유지할 순서).
            const { partnerIds: _cids, ...productData } = p;
            if (editingProduct) {
              // 기존 품목은 필드 병합(updateDoc)으로만 수정 — addItem(setDoc 전체교체)을 쓰면
              // 폼이 모르는 필드(원료 lots·mixEnabled 등)가 통째로 지워진다(6/29 원료 로트 소실 사고 원인).
              // stock도 모달 열 때 스냅샷이라 저장 시점 값과 다를 수 있어(로트 차감 등) 수정 시엔 건드리지 않는다.
              const { stock: _staleStock, ...safeData } = productData;
              await updateItem(collectionName, p.id, safeData);
            } else {
              await addItem(collectionName, productData);
            }
            // partnerOut 컬렉션 거래처 매핑 — 실패해도 품목 저장은 유지(읽기 한도 등).
            try {
              await setProductClients(p.id, p.partnerIds ?? []);
            } catch (e) {
              console.error('[품목 저장] 거래처 매핑 저장 실패 (품목 자체는 저장됨):', e);
              alert('품목은 저장됐지만, 거래처 연결 저장은 실패했습니다 (읽기 한도 등).\n거래처 연결은 잠시 후 다시 시도해 주세요.');
            }
            setIsProductModalOpen(false);
            setEditingProduct(null);
          }} 
        />
      )}

      {/* 알림 패널 — aside overflow-hidden 우회용 포털 */}
      {showNotifPanel && createPortal(
        (() => {
          const unread = appNotifications.filter(n => !n.readBy.includes(currentUser.id) && (!n.targetId || n.targetId === currentUser.id));
          const markRead = async (id: string) => {
            const n = appNotifications.find(x => x.id === id);
            if (!n || n.readBy.includes(currentUser.id)) return;
            await updateItem('notifications', id, { readBy: [...n.readBy, currentUser.id] });
          };
          const markAll = async () => {
            await Promise.all(unread.map(n => updateItem('notifications', n.id, { readBy: [...n.readBy, currentUser.id] })));
          };
          const sorted = [...appNotifications].filter(n => !n.targetId || n.targetId === currentUser.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
              <div className="fixed inset-0 z-[1000] bg-white flex flex-col">
                <div className="flex items-center px-4 py-3 border-b border-slate-100 bg-white">
                  <button
                    onClick={() => setShowNotifPanel(false)}
                    className="p-1 rounded-xl hover:bg-slate-100 transition-colors mr-2"
                  >
                    <ChevronLeft size={20} className="text-slate-600" />
                  </button>
                  <span className="flex-1 text-sm font-black text-slate-700">알림</span>
                  {unread.length > 0 && (
                    <button onClick={markAll} className="text-xs font-bold text-indigo-500 hover:text-indigo-700 transition-colors px-2 py-1">전부 읽음</button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto">
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
                  {unread.length > 0 && (
                    <button onClick={markAll} className="text-[10px] font-bold text-indigo-500 hover:text-indigo-700 transition-colors">전부 읽음</button>
                  )}
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

const NavItem = ({ icon: Icon, label, active, onClick, collapsed, badge }: { icon: any, label: string, active: boolean, onClick: () => void, collapsed?: boolean, badge?: number }) => (
  <button
    onClick={onClick}
    title={collapsed ? label : undefined}
    className={`w-full flex items-center ${collapsed ? 'justify-center' : 'space-x-3 px-4'} py-3 rounded-xl transition-all duration-200 ${
      active
        ? 'bg-indigo-600 text-white shadow-lg font-bold'
        : 'text-slate-500 hover:bg-slate-50'
    }`}
  >
    <div className="relative flex-shrink-0">
      <Icon size={18} />
      {badge != null && badge > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] bg-rose-500 text-white text-[8px] font-black rounded-full flex items-center justify-center px-0.5 leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </div>
    <span className={`text-sm whitespace-nowrap overflow-hidden transition-all duration-200 ${collapsed ? 'opacity-0 w-0' : 'opacity-100'}`}>{label}</span>
  </button>
);

export default AdminApp;
