import { verifyAdvanceStatements, type ReadonlyAdvanceOperation } from '../partnerAdvanceAudit';
import { useReturnAllocationSources, type ReturnAllocationOperation } from './useReturnAllocationSources';
import type { ReturnStockOperation } from '../returnStockMovement';
import { COL } from '../collections';
import type { ItemReceipt } from '../receipt';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Order, Item, Partner, PartnerItem, Post,
  PalletStock, PalletTransaction, Employee, LeaveRequest,
  AdjustmentRequest, ChatRoom, ChatMessage, RawMaterialEntry,
  AppNotification, IssuedStatement,
  ItemFormula, ItemBom, CompanyInfo, ReturnRequest,
  AccountCode, AccountGroup, FixedCostTemplate, InventorySnapshot, ProductionSalesLog,
  PendingStatementEdit, PurchaseOrder, ExpensePreset, CashFlowManual,
  CashAccount, CashEntry, Settlement, CompanyId, OrderStatus, companyOf,
} from '../types';
import { subscribeToCollection, subscribeToRecentCollection, fetchCollection, fetchDateRange } from '../services/firebaseService';
import type { OrderUnitInputs } from '../orderUnits';
import { buildBomIndex } from '../bomIndex';
import { buildPackIndex, type PackRow } from '../packIndex';
import { where, doc, getDoc } from 'firebase/firestore';
import { auth, db, authReady } from '../firebase';
import { dateOfLocal, kstDateRangeUtc } from '../day';
import { useCompanyInfoRead, type CompanyInfoRead } from './useCompanyInfoRead';

export interface WorkOrderItem {
  id: string;
  key: string;
  orderId: string;
  itemId: string;
  itemName: string;
  partnerName: string;
  qty: number;
  category: string;
  sortIndex: number;
  date?: string;
  /**
   * **주문 품목 줄의 이름표** — `참기름` 또는 같은 품목이 두 줄이면 `참기름#2`.
   * 만드는 곳은 [orderLine.lineKeyAt](../orderLine.ts). 자리(몇 번째)는 안 싣는다.
   */
  lineKey?: string;
  /**
   * **같이 만들 것끼리 묶은 표식**(2026-09-09 사장님). 배송의 '한 차' 와 같은 얼개다 —
   * 붙여 세우는 규칙은 [rowGroup](../rowGroup.ts) 한 곳이 안다.
   */
  groupId?: string;
  groupName?: string;
}

export interface AppData {
  advanceStatements?: readonly IssuedStatement[];
  orderUnitInputs?: OrderUnitInputs;
  // 주문
  orders: Order[];
  purchaseOrders: PurchaseOrder[];
  // 품목 (items 컬렉션)
  items: Item[];
  // 파트너-품목 매핑 (partner_item 컬렉션)
  partnerItems: PartnerItem[];
  setPartnerItems: React.Dispatch<React.SetStateAction<PartnerItem[]>>; // 낙관적 갱신용(라이브 구독 아님)
  // 파트너 (partners 컬렉션)
  partners: Partner[];
  employees: Employee[];
  leaveRequests: LeaveRequest[];
  // 재고 / 파렛트
  pallets: PalletStock[];
  palletTransactions: PalletTransaction[];
  adjustmentRequests: AdjustmentRequest[];
  // 공지 / 채팅
  noticePosts: Post[];
  chatRooms: ChatRoom[];
  chatMessages: ChatMessage[];
  // 원료
  rawMaterialLedger: RawMaterialEntry[];
  sesameInputLedger: { id: string; type: string; date: string; amount: number }[];
  // 알림
  appNotifications: AppNotification[];
  workOrderItems: WorkOrderItem[];
  issuedStatements: IssuedStatement[];
  itemFormulas: ItemFormula[];
  itemBoms: ItemBom[];
  /** 포장 환산표 — 박스로 주문할 수 있는 낱개 품목과 그 개입수 */
  itemPacks: PackRow[];
  returnRequests: ReturnRequest[];
  returnOperations: ReturnStockOperation[];
  returnAllocationOperations: ReturnAllocationOperation[];
  returnAllocationsLoaded: boolean;
  returnOperationsLoaded: boolean;
  itemReceipts: ItemReceipt[];
  companyInfo: CompanyInfo | null;
  companyInfoRead?: CompanyInfoRead;
  accountGroups: AccountGroup[];
  accountCodes: AccountCode[];
  fixedCostTemplates: FixedCostTemplate[];
  expensePresets: ExpensePreset[];
  cashFlowManual: CashFlowManual[];
  cashAccounts: CashAccount[];
  cashEntries: CashEntry[];
  settlements: Settlement[];
  inventorySnapshots: InventorySnapshot[];
  productionSalesLogs: ProductionSalesLog[];
  pendingStatementEdits: PendingStatementEdit[];
  isDataLoading: boolean;
  refreshStaticData: () => void;
  historicalOrders: Order[];
  loadHistoricalOrders: (start: string, end: string) => Promise<void>;
  isLoadingHistoricalOrders: boolean;
  ordersMonths: number;
  setOrdersMonths: (n: number) => void;
}

/**
 * 로그인 직원의 소속 회사(`companyId`)에 잠긴 구독을 만든다.
 * 모든 업무 컬렉션 질의에 `where('companyId', '==', companyId)`를 붙여
 * 다른 회사 자료가 화면에 섞이지 않게 한다.
 *
 * **돈·인사·서류는 관리자만 구독한다**(2026-09-16 코덱스 검수 6번).
 *
 * 규칙이 그 컬렉션을 관리자 전용으로 잠그므로, 직원이 구독을 걸면 **그 순간
 * `permission-denied`** 가 난다. 화면에서 메뉴만 숨기고 구독은 그대로 두면 규칙을
 * 배포하는 날 직원 앱이 오류로 덮인다. 그래서 `isAdmin` 을 **조회 경계까지** 가져온다.
 *
 * 잠그는 컬렉션은 `firestore.rules.next` 의 `adminOnlyCollection()` 과 **같은 목록**이어야
 * 한다. 둘이 갈리면 한쪽은 구독하는데 다른 쪽이 막는 꼴이 된다.
 * (확인함: 이 컬렉션들은 관리자 화면에서만 쓰인다 — 직원 화면에는 한 곳도 없다)
 */
export function useAppData(enabled = true, companyId: CompanyId = 'taebaek', isAdmin = false): AppData {
  const [orders, setOrders] = useState<Order[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [partnerItems, setPartnerItems] = useState<PartnerItem[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [pallets, setPallets] = useState<PalletStock[]>([]);
  const [palletTransactions, setPalletTransactions] = useState<PalletTransaction[]>([]);
  const [adjustmentRequests, setAdjustmentRequests] = useState<AdjustmentRequest[]>([]);
  const [noticePosts, setNoticePosts] = useState<Post[]>([]);
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [rawMaterialLedger, setRawMaterialLedger] = useState<RawMaterialEntry[]>([]);
  const [sesameInputLedger, setSesameInputLedger] = useState<{ id: string; type: string; date: string; amount: number }[]>([]);
  const [appNotifications, setAppNotifications] = useState<AppNotification[]>([]);
  const [workOrderItems, setWorkOrderItems] = useState<WorkOrderItem[]>([]);
  const [issuedStatements, setIssuedStatements] = useState<IssuedStatement[]>([]);
  const [itemFormulas, setItemFormulas] = useState<ItemFormula[]>([]);
  const [itemBoms, setItemBoms] = useState<ItemBom[]>([]);
  //  포장 환산표 — 낱개로만 세는데 박스로 말하는 품목(향미유·고춧가루)의 개입수
  const [itemPacks, setItemPacks] = useState<PackRow[]>([]);
  const [returnOperationState, setReturnOperationState] = useState<{ companyId: CompanyId; rows: ReturnStockOperation[] } | null>(null);
  const [returnRequests, setReturnRequests] = useState<ReturnRequest[]>([]);
  //  사 온 기록 — 제품별원장이 '입고' 줄로 읽는다(2026-09-03부터)
  const [itemReceipts, setItemReceipts] = useState<ItemReceipt[]>([]);
  const companyInfoRead = useCompanyInfoRead({ companyId, enabled });
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [accountCodes, setAccountCodes] = useState<AccountCode[]>([]);
  const [fixedCostTemplates, setFixedCostTemplates] = useState<FixedCostTemplate[]>([]);
  const [expensePresets, setExpensePresets] = useState<ExpensePreset[]>([]);
  const [cashFlowManual, setCashFlowManual] = useState<CashFlowManual[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [cashEntries, setCashEntries] = useState<CashEntry[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [advanceOperationState,setAdvanceOperationState]=useState<{companyId:CompanyId;rows:ReadonlyAdvanceOperation[]}|null>(null);
  const [verifiedAdvances,setVerifiedAdvances]=useState<{companyId:CompanyId;uid?:string;statements:IssuedStatement[];operations:ReadonlyAdvanceOperation[];rows:IssuedStatement[]}|null>(null);
  useEffect(()=>{
    let cancelled=false;
    const uid=auth?.currentUser?.uid;
    if(enabled&&isAdmin&&advanceOperationState?.companyId===companyId){
      const parties=[...new Set(issuedStatements.filter(s=>companyOf(s)===companyId&&s.noncashApplication!==undefined).map(s=>s.partnerId))];
      // 한 거래처의 미확인 감사가 다른 거래처의 정상 미결까지 막지 않는다.
      Promise.all(parties.map(partnerId=>verifyAdvanceStatements(companyId,issuedStatements.filter(s=>s.partnerId===partnerId),advanceOperationState.rows).catch(()=>[]))).then(groups=>{if(!cancelled&&auth?.currentUser?.uid===uid)setVerifiedAdvances({companyId,uid,statements:issuedStatements,operations:advanceOperationState.rows,rows:groups.flat()});});
    }
    return()=>{cancelled=true;};
  },[enabled,isAdmin,companyId,issuedStatements,advanceOperationState,auth?.currentUser?.uid]);
  const [inventorySnapshots, setInventorySnapshots] = useState<InventorySnapshot[]>([]);
  const [productionSalesLogs, setProductionSalesLogs] = useState<ProductionSalesLog[]>([]);
  const [pendingStatementEdits, setPendingStatementEdits] = useState<PendingStatementEdit[]>([]);
  const [historicalState, setHistoricalState] = useState<{ scope: number; orders: Order[]; loading: boolean } | null>(null);
  const historicalMounted = useRef(true);
  const historicalAuthGeneration = useRef(0);
  const historicalObservedUid = useRef(auth?.currentUser?.uid ?? '');
  const [, setHistoricalActorGeneration] = useState(0);
  useEffect(() => {
    historicalMounted.current = true;
    setHistoricalActorGeneration(historicalAuthGeneration.current);
    const unsubscribe = auth?.onAuthStateChanged?.(user => {
      const uid = user?.uid ?? '';
      if (uid === historicalObservedUid.current) return;
      historicalObservedUid.current = uid;
      historicalAuthGeneration.current += 1;
      const current = historicalScopeRef.current;
      historicalScopeRef.current = { ...current, id: current.id + 1,
        key: historicalScopeKey(current.enabled, current.companyId, uid, historicalAuthGeneration.current) };
      setHistoricalActorGeneration(historicalAuthGeneration.current);
    });
    return () => { historicalMounted.current = false; historicalAuthGeneration.current += 1; unsubscribe?.(); };
  }, []);
  // 같은 탭에서 로그아웃→다른 회사 로그인 시 이전 요청이 늦게 돌아와도 새 세션에 쓰지 못한다.
  const historicalScopeKey = (enabled: boolean, company: CompanyId, uid: string, generation: number) =>
    JSON.stringify([enabled, company, uid, generation]);
  const scopeKey = historicalScopeKey(enabled, companyId, auth?.currentUser?.uid ?? '', historicalAuthGeneration.current);
  const historicalScopeRef = useRef({ key: scopeKey, id: 0, enabled, companyId });
  if (historicalScopeRef.current.key !== scopeKey) {
    historicalScopeRef.current = { key: scopeKey, id: historicalScopeRef.current.id + 1, enabled, companyId };
  }
  const historicalScope = historicalScopeRef.current.id;
  const historicalOrders = useMemo(
    () => enabled && historicalState?.scope === historicalScope
      ? historicalState.orders.filter(order => companyOf(order) === companyId) : [],
    [enabled, historicalState, historicalScope, companyId],
  );
  const visibleOrders = useMemo(
    () => enabled ? orders.filter(order => companyOf(order) === companyId) : [],
    [orders, enabled, companyId],
  );
  const isLoadingHistoricalOrders = enabled && historicalState?.scope === historicalScope
    ? historicalState.loading : false;
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [ordersMonths, setOrdersMonthsState] = useState<number>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('tb_orders_months') : null;
    const n = saved ? parseInt(saved, 10) : 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
  });
  const setOrdersMonths = useCallback((n: number) => {
    setOrdersMonthsState(n);
    try { localStorage.setItem('tb_orders_months', String(n)); } catch {}
  }, []);
  const loadedRef = useRef(new Set<string>());
  // 정적 데이터 새로고침 트리거
  const [staticRefreshKey, setStaticRefreshKey] = useState(0);
  const refreshStaticData = useCallback(() => setStaticRefreshKey(k => k + 1), []);

  const loadedHistoricalRangeRef = useRef<{ scope: number; start: string; end: string } | null>(null);
  const historicalRequestGeneration = useRef(0);
  const historicalInFlight = useRef<{ scope: number; start: string; end: string; promise: Promise<void> } | null>(null);
  const loadHistoricalOrders = useCallback((start: string, end: string): Promise<void> => {
    if (!enabled || !historicalMounted.current || historicalScopeRef.current.key !== historicalScopeKey(enabled, companyId, auth?.currentUser?.uid ?? '', historicalAuthGeneration.current)) return Promise.resolve();
    const scope = historicalScopeRef.current.id;
    const previous = loadedHistoricalRangeRef.current;
    if (previous?.scope === scope && previous.start <= start && previous.end >= end) return Promise.resolve();
    const inFlight = historicalInFlight.current;
    if (inFlight?.scope === scope && inFlight.start <= start && inFlight.end >= end) return inFlight.promise;
    const generation = ++historicalRequestGeneration.current;
    const authGeneration = historicalAuthGeneration.current;
    const uid = auth?.currentUser?.uid;
    const active = () => historicalMounted.current && historicalScopeRef.current.id === scope
      && historicalRequestGeneration.current === generation && historicalAuthGeneration.current === authGeneration
      && auth?.currentUser?.uid === uid;
    setHistoricalState(current => ({ scope, orders: current?.scope === scope ? current.orders : [], loading: true }));
    const promise = (async () => {
      try {
        const { where } = await import('firebase/firestore');
        const range = kstDateRangeUtc(start, end);
        const data = await fetchCollection<Order>('orders', [
          where('createdAt', '>=', range.startInclusive),
          where('createdAt', '<', range.endExclusive),
          where('companyId', '==', companyId),
        ]);
        if (!active()) return;
        setHistoricalState({ scope, orders: data, loading: false });
        loadedHistoricalRangeRef.current = { scope, start, end };
      } finally {
        if (active()) {
          historicalInFlight.current = null;
          setHistoricalState(current => current?.scope === scope ? { ...current, loading: false } : current);
        }
      }
    })();
    historicalInFlight.current = { scope, start, end, promise };
    return promise;
  }, [companyId, enabled, scopeKey]);

  const markLoaded = (key: string) => {
    loadedRef.current.add(key);
    if (loadedRef.current.has('orders') && loadedRef.current.has('items')) {
      setIsDataLoading(false);
    }
  };

  // 재무 구독은 업무 구독과 수명을 분리한다. 직원에게는 생성하지 않는다.
  useEffect(() => {
    if (!enabled || !isAdmin) return;
    setReturnOperationState(null);
    let cancelled = false;
    let unsubscribes: (() => void)[] = [];
    const co = [where('companyId', '==', companyId)];
    const guarded = <T,>(callback: (data: T[]) => void) => (data: T[]) => { if (!cancelled) callback(data); };
    const listen: typeof subscribeToCollection = (name, callback, constraints) => subscribeToCollection(name, guarded(callback), constraints);
    const listenRecent: typeof subscribeToRecentCollection = (name, field, days, callback, constraints) => subscribeToRecentCollection(name, field, days, guarded(callback), constraints);
    authReady.then(() => {
      if (cancelled) return;
      unsubscribes = [
        // 전표는 재무 원장(손익·현금흐름·미수금 원천) → 최근 며칠이 아니라 전체 로딩해야 월별/기간 집계가 맞음
        listen<IssuedStatement>(COL.issuedStatements, (data) => {
          setIssuedStatements(data.map(s => {
            if (!s.items || !s.tradeDate) {
              console.warn('[useAppData] issuedStatement 필드 누락:', { id: s.id, hasItems: !!s.items, hasTradeDate: !!s.tradeDate });
            }
            return {
              ...s,
              items: s.items ?? [],
              tradeDate: s.tradeDate ?? '',
              issuedAt: s.issuedAt ?? '',
            };
          }));
        }, co),
        // 자금 원장 — 전표와 같은 이유로 전체 로딩. 잔액은 첫 거래부터 누적해야 맞다.
        listen<CashAccount>(COL.cashAccounts, setCashAccounts, co),
        subscribeToCollection<ReturnStockOperation>('returnOperations', rows => {
          if (!cancelled) setReturnOperationState({ companyId, rows });
        }, co, () => { if (!cancelled) setReturnOperationState(null); }),
        listen<CashEntry>(COL.cashEntries, setCashEntries, co),
        listen<Settlement>(COL.settlements, setSettlements, co),
        subscribeToCollection<ReadonlyAdvanceOperation>(COL.partnerAdvanceOperations,rows=>{if(!cancelled)setAdvanceOperationState({companyId,rows});},co,()=>{if(!cancelled)setAdvanceOperationState(null);}),
        listen<InventorySnapshot>(COL.inventorySnapshots, setInventorySnapshots, co),
        listenRecent<ProductionSalesLog>(COL.productionSalesLogs, 'date', 7, setProductionSalesLogs, co),
        listenRecent<PendingStatementEdit>(COL.pendingStatementEdits, 'createdAt', 7, setPendingStatementEdits, co),
      ];

    });
    return () => { cancelled = true; unsubscribes.forEach(stop => stop()); };
  }, [enabled, companyId, isAdmin]);

  // ── 실시간 구독 (자주 바뀌는 데이터) ──
  useEffect(() => {
    if (!enabled) return;
    let unsubscribes: (() => void)[] = [];
    let cancelled = false;

    //  모든 업무 컬렉션은 로그인 회사에 잠근다. `companyId`가 안 붙은 옛 문서는
    //  이관 스크립트를 돌리기 전까지 목록에서 빠진다 — 이 훅이 아니라 데이터 이관으로 푼다.
    const co = [where('companyId', '==', companyId)];
    const guarded = <T,>(callback: (data: T[]) => void) => (data: T[]) => { if (!cancelled) callback(data); };
    const listen: typeof subscribeToCollection = (name, callback, constraints, onError) => subscribeToCollection(name, guarded(callback), constraints, onError);
    const listenRecent: typeof subscribeToRecentCollection = (name, field, days, callback, constraints) => subscribeToRecentCollection(name, field, days, guarded(callback), constraints);
    authReady.then(() => {
      if (cancelled) return;
      /**
       * **관리자만 거는 구독** — 전표·자금·재무·문서함. 직원 로그인이면 빈 배열로 둔다.
       * 규칙(`adminOnlyCollection`)과 짝이 맞아야 한다.
       */
      unsubscribes = [
        listen<Post>(COL.notices, setNoticePosts, co),
        listen<PalletStock>(COL.pallets, setPallets, co),
        listenRecent<PalletTransaction>(COL.palletTransactions, 'date', 7, setPalletTransactions, co),
        listen<Employee>(COL.employees, setEmployees, co),
        listen<LeaveRequest>(COL.leaveRequests, setLeaveRequests, co),
        listen<AdjustmentRequest>(COL.adjustmentRequests, setAdjustmentRequests, co),
        listen<PurchaseOrder>(COL.purchaseOrders, setPurchaseOrders, co),
        listen<Item>(COL.items, (data) => { setItems(data); markLoaded('items'); }, co),
        listen<Partner>(COL.partners, setPartners, co),
        listen<ChatRoom>(COL.chatRooms, setChatRooms, co),
        listenRecent<ChatMessage>(COL.chatMessages, 'createdAt', 7, setChatMessages, co),
        // rawMaterialLedger: 전역 구독 제거 — 원료수불부/재고관리 화면이 열릴 때만 fetchDateRange로 전체 조회(AdminApp).
        //   (앱 시작 시 모든 사용자가 7일치를 읽던 낭비 제거. 쓰기 시엔 ledgerReloadKey로 재조회.)
        listenRecent<{ id: string; type: string; date: string; amount: number }>(COL.sesameInputLedger, 'date', 7, setSesameInputLedger, co),
        listen<AppNotification>(COL.notifications, setAppNotifications, co),
        listen<WorkOrderItem>(COL.workOrderItems, (data) => setWorkOrderItems([...data].sort((a, b) => a.sortIndex - b.sortIndex)), co),
        listenRecent<ReturnRequest>(COL.returnRequests, 'createdAt', 7, setReturnRequests, co),
        listen<ItemReceipt>(COL.itemReceipts, setItemReceipts, co),
      ];
    });

    return () => {
      cancelled = true;
      unsubscribes.forEach(u => u());
    };
  }, [enabled, companyId, isAdmin]);

  // ── orders 구독 — ordersMonths 변경 시 재구독 ──
  useEffect(() => {
    if (!enabled) return;
    let unsub: (() => void) | null = null;
    let cancelled = false;
    authReady.then(() => {
      if (cancelled) return;
      const cutoff = dateOfLocal(new Date(Date.now() - ordersMonths * 30 * 86400000).toISOString());
      unsub = subscribeToCollection<Order>(
        'orders',
        (data) => {
          // 진행 중 주문은 오래됐어도 업무 대상이다. 구독 기간은 완료 이력에만 적용한다.
          if (cancelled) return;
          setOrders(data.filter(order => order.status !== OrderStatus.DELIVERED
            || dateOfLocal(order.deliveredAt || order.deliveryDate || order.createdAt) >= cutoff));
          markLoaded('orders');
        },
        [where('companyId', '==', companyId)],
        (error) => {
          console.error('[Firestore 구독 실패] orders', error);
          // 인덱스 생성 지연이나 일시 오류가 있어도 앱 전체가 무한 로딩에 갇히면
          // 로그인·다른 업무까지 못 하므로 로딩은 반드시 끝낸다.
          markLoaded('orders');
        },
      );
    });
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [enabled, ordersMonths, companyId]);

  // ── 1회 읽기 (거의 안 바뀌는 정적 데이터) — refreshStaticData() 호출 시 재로드 ──
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    //  정적 데이터도 회사에 잠근다. 옛 연결 문서(partner_item·item_bom·item_pack 등)에는
    //  companyId가 안 붙은 것이 많아 이관 전까지는 목록에서 빠진다.
    const co = [where('companyId', '==', companyId)];
    authReady.then(() => {
      Promise.all([
        fetchCollection<PartnerItem>('partner_item', co),
        fetchCollection<ItemBom>('item_bom', co),
        fetchCollection<PackRow & { id: string }>('item_pack', co),
        fetchCollection<ItemFormula>('item_formula', co),
        //  **계정과목·비용 기준정보는 관리자만 읽는다**(2026-09-16 코덱스 검수 6번).
        //  규칙이 관리자 전용이라, 직원이 부르면 `permission-denied` 가 난다.
        //  빈 배열로 두면 직원 화면은 예전과 똑같이 돈다 — 쓰는 화면이 관리자 것뿐이다.
        isAdmin ? fetchCollection<AccountGroup>('accountGroups', co) : Promise.resolve([] as AccountGroup[]),
        isAdmin ? fetchCollection<AccountCode>('accountCodes', co) : Promise.resolve([] as AccountCode[]),
        isAdmin ? fetchCollection<FixedCostTemplate>('fixedCostTemplates', co) : Promise.resolve([] as FixedCostTemplate[]),
        isAdmin ? fetchCollection<ExpensePreset>('expensePresets', co) : Promise.resolve([] as ExpensePreset[]),
        isAdmin ? fetchCollection<CashFlowManual>('cashFlowManual', co) : Promise.resolve([] as CashFlowManual[]),
      ]).then(([piData, bomData, packData, ifData, agData, acData, fctData, epData, cfmData]) => {
        // partner_item은 canonical(itemId/partnerId/price)만 쓴다. 레거시 대문자 별칭 주입 안 함.
        if (cancelled) return;
        setPartnerItems(piData);
        setItemBoms(bomData);
        setItemPacks(packData);
        setItemFormulas(ifData);
        setAccountGroups(agData);
        setAccountCodes(acData);
        setFixedCostTemplates(fctData);
        setExpensePresets(epData);
        setCashFlowManual(cfmData);
      });
    });
    return () => { cancelled = true; };
  }, [enabled, staticRefreshKey, companyId, isAdmin]);

  /**
   * BOM 단일원천 — item_bom을 유일 소스로 세운다.
   *
   * 예전엔 여기서 품목마다 `submaterials`를 만들어 붙였다(withDerivedSubmaterials).
   * 그 그림자 필드를 없애고 구성은 bomIndex에서만 읽는다 — 품목은 제 구성을 안 들고 다닌다.
   * useMemo에서 세우는 건 이 값이 **자식 렌더보다 먼저** 서야 하기 때문이다(같은 입력이면
   * 같은 인덱스라 여러 번 돌아도 결과가 같다).
   */
  const bomIndex = useMemo(() => buildBomIndex(enabled ? items.filter(row => companyOf(row) === companyId) : [], enabled ? itemBoms.filter(row => companyOf(row as { companyId?: CompanyId }) === companyId) : []), [enabled, companyId, items, itemBoms]);
  //  포장 환산표도 같은 방식으로 — 개입수의 근거는 BOM 아니면 이 표, 둘뿐이다
  const packIndex = useMemo(() => buildPackIndex(enabled ? itemPacks.filter(row => companyOf(row as { companyId?: CompanyId }) === companyId) : []), [enabled, companyId, itemPacks]);

  const loadedReturnOperations = enabled && isAdmin && returnOperationState?.companyId === companyId ? returnOperationState.rows : undefined;
  const loadReturnSources = useCallback(async (ids: string[], company: CompanyId) => {
    const rows = await Promise.all(ids.map(id => getDoc(doc(db, 'issuedStatements', id))));
    return rows.filter(row => row.exists()).map(row => {
      const statement = { ...row.data(), id: row.id } as IssuedStatement;
      if (companyOf(statement) !== company) throw new Error('반품 원전표 회사가 맞지 않습니다.');
      return statement;
    });
  }, []);
  const currentReturnUid = useCallback(() => auth.currentUser?.uid, []);
  const returnAllocationOperations = useReturnAllocationSources(companyId, enabled && isAdmin, loadedReturnOperations,
    issuedStatements, loadReturnSources, auth.currentUser?.uid, currentReturnUid, staticRefreshKey);
  const scopedData = useMemo(() => {
    const visibleRows = <T extends object,>(rows: T[]): T[] => enabled ? rows.filter(row => companyOf(row as { companyId?: CompanyId }) === companyId) : [];
    return {
      purchaseOrders: visibleRows(purchaseOrders),
      items: visibleRows(items),
      partnerItems: visibleRows(partnerItems),
      partners: visibleRows(partners),
      employees: visibleRows(employees),
      leaveRequests: visibleRows(leaveRequests),
      pallets: visibleRows(pallets),
      palletTransactions: visibleRows(palletTransactions),
      adjustmentRequests: visibleRows(adjustmentRequests),
      noticePosts: visibleRows(noticePosts),
      chatRooms: visibleRows(chatRooms),
      chatMessages: visibleRows(chatMessages),
      sesameInputLedger: visibleRows(sesameInputLedger),
      appNotifications: visibleRows(appNotifications),
      workOrderItems: visibleRows(workOrderItems),
      itemFormulas: visibleRows(itemFormulas),
      itemBoms: visibleRows(itemBoms),
      itemPacks: visibleRows(itemPacks),
      returnRequests: visibleRows(returnRequests),
      advanceStatements: enabled && isAdmin && verifiedAdvances?.companyId===companyId && verifiedAdvances.uid===auth?.currentUser?.uid && verifiedAdvances.statements===issuedStatements && verifiedAdvances.operations===advanceOperationState?.rows ? verifiedAdvances.rows : undefined,
      returnOperations: enabled && isAdmin && returnOperationState?.companyId === companyId ? returnOperationState.rows : [],
      returnOperationsLoaded: enabled && isAdmin && returnOperationState?.companyId === companyId,
      returnAllocationOperations: returnAllocationOperations ?? [],
      returnAllocationsLoaded: returnAllocationOperations !== undefined,
      itemReceipts: visibleRows(itemReceipts),
      issuedStatements: isAdmin ? visibleRows(issuedStatements) : [],
      accountGroups: isAdmin ? visibleRows(accountGroups) : [],
      accountCodes: isAdmin ? visibleRows(accountCodes) : [],
      fixedCostTemplates: isAdmin ? visibleRows(fixedCostTemplates) : [],
      expensePresets: isAdmin ? visibleRows(expensePresets) : [],
      cashFlowManual: isAdmin ? visibleRows(cashFlowManual) : [],
      inventorySnapshots: isAdmin ? visibleRows(inventorySnapshots) : [],
      cashAccounts: isAdmin ? visibleRows(cashAccounts) : [],
      cashEntries: isAdmin ? visibleRows(cashEntries) : [],
      settlements: isAdmin ? visibleRows(settlements) : [],
      productionSalesLogs: isAdmin ? visibleRows(productionSalesLogs) : [],
      pendingStatementEdits: isAdmin ? visibleRows(pendingStatementEdits) : [],
    };
  }, [enabled, companyId, isAdmin, verifiedAdvances, advanceOperationState, returnOperationState, returnAllocationOperations, purchaseOrders, items, partnerItems, partners, employees, leaveRequests, pallets, palletTransactions, adjustmentRequests, noticePosts, chatRooms, chatMessages, sesameInputLedger, appNotifications, workOrderItems, itemFormulas, itemBoms, itemPacks, returnRequests, itemReceipts, issuedStatements, accountGroups, accountCodes, fixedCostTemplates, expensePresets, cashFlowManual, inventorySnapshots, cashAccounts, cashEntries, settlements, productionSalesLogs, pendingStatementEdits]);
  return {
    ...scopedData,
    orderUnitInputs: { bom: bomIndex, pack: packIndex },
    orders: visibleOrders, setPartnerItems, rawMaterialLedger, companyInfo: companyInfoRead.value, companyInfoRead,
    isDataLoading, refreshStaticData, historicalOrders, loadHistoricalOrders, isLoadingHistoricalOrders, ordersMonths, setOrdersMonths,
  };
}
