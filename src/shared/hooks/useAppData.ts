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
  CashAccount, CashEntry, Settlement,
} from '../types';
import { subscribeToCollection, subscribeToRecentCollection, subscribeToDocument, fetchCollection, fetchDateRange } from '../services/firebaseService';
import { buildBomIndex, setBomIndex } from '../bomIndex';
import { buildPackIndex, setPackIndex, type PackRow } from '../packIndex';
import { where } from 'firebase/firestore';
import { authReady } from '../firebase';

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
   * **같이 만들 것끼리 묶은 표식**(2026-09-09 사장님). 배송의 '한 차' 와 같은 얼개다 —
   * 붙여 세우는 규칙은 [rowGroup](../rowGroup.ts) 한 곳이 안다.
   */
  groupId?: string;
  groupName?: string;
}

export interface AppData {
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
  itemReceipts: ItemReceipt[];
  companyInfo: CompanyInfo | null;
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

export function useAppData(): AppData {
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
  const [returnRequests, setReturnRequests] = useState<ReturnRequest[]>([]);
  //  사 온 기록 — 제품별원장이 '입고' 줄로 읽는다(2026-09-03부터)
  const [itemReceipts, setItemReceipts] = useState<ItemReceipt[]>([]);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [accountCodes, setAccountCodes] = useState<AccountCode[]>([]);
  const [fixedCostTemplates, setFixedCostTemplates] = useState<FixedCostTemplate[]>([]);
  const [expensePresets, setExpensePresets] = useState<ExpensePreset[]>([]);
  const [cashFlowManual, setCashFlowManual] = useState<CashFlowManual[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [cashEntries, setCashEntries] = useState<CashEntry[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [inventorySnapshots, setInventorySnapshots] = useState<InventorySnapshot[]>([]);
  const [productionSalesLogs, setProductionSalesLogs] = useState<ProductionSalesLog[]>([]);
  const [pendingStatementEdits, setPendingStatementEdits] = useState<PendingStatementEdit[]>([]);
  const [historicalOrders, setHistoricalOrders] = useState<Order[]>([]);
  const [isLoadingHistoricalOrders, setIsLoadingHistoricalOrders] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [ordersMonths, setOrdersMonthsState] = useState<number>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('tb_orders_months') : null;
    const n = saved ? parseInt(saved, 10) : 12;
    return Number.isFinite(n) && n > 0 ? n : 12;
  });
  const setOrdersMonths = useCallback((n: number) => {
    setOrdersMonthsState(n);
    try { localStorage.setItem('tb_orders_months', String(n)); } catch {}
  }, []);
  const loadedRef = useRef(new Set<string>());
  // 정적 데이터 새로고침 트리거
  const [staticRefreshKey, setStaticRefreshKey] = useState(0);
  const refreshStaticData = useCallback(() => setStaticRefreshKey(k => k + 1), []);

  const loadedHistoricalRangeRef = useRef<{ start: string; end: string } | null>(null);
  const loadHistoricalOrders = useCallback(async (start: string, end: string) => {
    // 이미 같거나 더 넓은 범위를 로드했으면 skip
    const prev = loadedHistoricalRangeRef.current;
    if (prev && prev.start <= start && prev.end >= end) return;
    setIsLoadingHistoricalOrders(true);
    try {
      const { where } = await import('firebase/firestore');
      const data = await fetchCollection<Order>('orders', [
        where('createdAt', '>=', start + 'T00:00:00.000Z'),
        where('createdAt', '<=', end + 'T23:59:59.999Z'),
      ]);
      setHistoricalOrders(data);
      loadedHistoricalRangeRef.current = { start, end };
    } finally {
      setIsLoadingHistoricalOrders(false);
    }
  }, []);

  const markLoaded = (key: string) => {
    loadedRef.current.add(key);
    if (loadedRef.current.has('orders') && loadedRef.current.has('items')) {
      setIsDataLoading(false);
    }
  };

  // ── 실시간 구독 (자주 바뀌는 데이터) ──
  useEffect(() => {
    let unsubscribes: (() => void)[] = [];
    let cancelled = false;

    authReady.then(() => {
      if (cancelled) return;
      unsubscribes = [
        subscribeToCollection<Post>('notices', setNoticePosts),
        subscribeToCollection<PalletStock>('pallets', setPallets),
        subscribeToRecentCollection<PalletTransaction>('palletTransactions', 'date', 7, setPalletTransactions),
        subscribeToCollection<Employee>('employees', setEmployees),
        subscribeToCollection<LeaveRequest>('leaveRequests', setLeaveRequests),
        subscribeToCollection<AdjustmentRequest>('adjustmentRequests', setAdjustmentRequests),
        subscribeToCollection<PurchaseOrder>('purchaseOrders', setPurchaseOrders),
        subscribeToCollection<Item>('items', (data) => { setItems(data); markLoaded('items'); }),
        subscribeToCollection<Partner>('partners', setPartners),
        subscribeToCollection<ChatRoom>('chatRooms', setChatRooms),
        subscribeToRecentCollection<ChatMessage>('chatMessages', 'createdAt', 7, setChatMessages),
        // rawMaterialLedger: 전역 구독 제거 — 원료수불부/재고관리 화면이 열릴 때만 fetchDateRange로 전체 조회(AdminApp).
        //   (앱 시작 시 모든 사용자가 7일치를 읽던 낭비 제거. 쓰기 시엔 ledgerReloadKey로 재조회.)
        subscribeToRecentCollection<{ id: string; type: string; date: string; amount: number }>('sesameInputLedger', 'date', 7, setSesameInputLedger),
        subscribeToCollection<AppNotification>('notifications', setAppNotifications),
        subscribeToCollection<WorkOrderItem>('workOrderItems', (data) => setWorkOrderItems([...data].sort((a, b) => a.sortIndex - b.sortIndex))),
        // 전표는 재무 원장(손익·현금흐름·미수금 원천) → 최근 며칠이 아니라 전체 로딩해야 월별/기간 집계가 맞음
        subscribeToCollection<IssuedStatement>('issuedStatements', (data) => {
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
        }),
        // 자금 원장 — 전표와 같은 이유로 전체 로딩. 잔액은 첫 거래부터 누적해야 맞다.
        subscribeToCollection<CashAccount>('cashAccounts', setCashAccounts),
        subscribeToCollection<CashEntry>('cashEntries', setCashEntries),
        subscribeToCollection<Settlement>('settlements', setSettlements),
        subscribeToRecentCollection<ReturnRequest>('returnRequests', 'createdAt', 7, setReturnRequests),
        subscribeToCollection<ItemReceipt>('itemReceipts', setItemReceipts),
        subscribeToDocument<CompanyInfo>('settings', 'company', setCompanyInfo),
        subscribeToCollection<InventorySnapshot>('inventorySnapshots', setInventorySnapshots),
        subscribeToRecentCollection<ProductionSalesLog>('productionSalesLogs', 'date', 7, setProductionSalesLogs),
        subscribeToRecentCollection<PendingStatementEdit>('pendingStatementEdits', 'createdAt', 7, setPendingStatementEdits),
      ];
    });

    return () => {
      cancelled = true;
      unsubscribes.forEach(u => u());
    };
  }, []);

  // ── orders 구독 — ordersMonths 변경 시 재구독 ──
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    authReady.then(() => {
      if (cancelled) return;
      const cutoff = new Date(Date.now() - ordersMonths * 30 * 86400000).toISOString();
      unsub = subscribeToCollection<Order>(
        'orders',
        (data) => { setOrders(data); markLoaded('orders'); },
        [where('createdAt', '>=', cutoff)],
      );
    });
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [ordersMonths]);

  // ── 1회 읽기 (거의 안 바뀌는 정적 데이터) — refreshStaticData() 호출 시 재로드 ──
  useEffect(() => {
    authReady.then(() => {
      Promise.all([
        fetchCollection<PartnerItem>('partner_item'),
        fetchCollection<ItemBom>('item_bom'),
        fetchCollection<PackRow & { id: string }>('item_pack'),
        fetchCollection<ItemFormula>('item_formula'),
        fetchCollection<AccountGroup>('accountGroups'),
        fetchCollection<AccountCode>('accountCodes'),
        fetchCollection<FixedCostTemplate>('fixedCostTemplates'),
        fetchCollection<ExpensePreset>('expensePresets'),
        fetchCollection<CashFlowManual>('cashFlowManual'),
      ]).then(([piData, bomData, packData, ifData, agData, acData, fctData, epData, cfmData]) => {
        // partner_item은 canonical(itemId/partnerId/price)만 쓴다. 레거시 대문자 별칭 주입 안 함.
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
  }, [staticRefreshKey]);

  /**
   * BOM 단일원천 — item_bom을 유일 소스로 세운다.
   *
   * 예전엔 여기서 품목마다 `submaterials`를 만들어 붙였다(withDerivedSubmaterials).
   * 그 그림자 필드를 없애고 구성은 bomIndex에서만 읽는다 — 품목은 제 구성을 안 들고 다닌다.
   * useMemo에서 세우는 건 이 값이 **자식 렌더보다 먼저** 서야 하기 때문이다(같은 입력이면
   * 같은 인덱스라 여러 번 돌아도 결과가 같다).
   */
  const bomIndex = useMemo(() => buildBomIndex(items, itemBoms), [items, itemBoms]);
  setBomIndex(bomIndex);
  //  포장 환산표도 같은 방식으로 — 개입수의 근거는 BOM 아니면 이 표, 둘뿐이다
  const packIndex = useMemo(() => buildPackIndex(itemPacks), [itemPacks]);
  setPackIndex(packIndex);

  return {
    orders, purchaseOrders,
    items,
    partnerItems,
    setPartnerItems,
    partners,
    employees, leaveRequests,
    pallets, palletTransactions, adjustmentRequests,
    noticePosts, chatRooms, chatMessages,
    rawMaterialLedger, sesameInputLedger,
    appNotifications, workOrderItems, issuedStatements,
    itemFormulas, itemBoms, itemPacks, returnRequests, itemReceipts,
    companyInfo, accountGroups, accountCodes, fixedCostTemplates, expensePresets, cashFlowManual, inventorySnapshots,
    cashAccounts, cashEntries, settlements,
    productionSalesLogs, pendingStatementEdits,
    isDataLoading,
    refreshStaticData,
    historicalOrders,
    loadHistoricalOrders,
    isLoadingHistoricalOrders,
    ordersMonths,
    setOrdersMonths,
  };
}
