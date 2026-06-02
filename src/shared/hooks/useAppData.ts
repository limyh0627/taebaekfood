import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Order, Item, Partner, PartnerItem, Post,
  PalletStock, PalletTransaction, Employee, LeaveRequest,
  AdjustmentRequest, ChatRoom, ChatMessage, RawMaterialEntry,
  AppNotification, IssuedStatement,
  ItemFormula, ItemBom, ShippingRule, CompanyInfo, QrMapping, ReturnRequest,
  AccountCode, AccountGroup, FixedCostTemplate, InventorySnapshot, ProductionSalesLog,
  PendingStatementEdit, PurchaseOrder,
} from '../types';
import { subscribeToCollection, subscribeToRecentCollection, subscribeToDocument, fetchCollection, fetchDateRange } from '../services/firebaseService';
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
}

export interface AppData {
  qrMappings: QrMapping[];
  // 주문
  orders: Order[];
  purchaseOrders: PurchaseOrder[];
  // 품목 (items 컬렉션)
  items: Item[];
  // 파트너-품목 매핑 (partner_item 컬렉션)
  partnerItems: PartnerItem[];
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
  shippingRules: ShippingRule[];
  returnRequests: ReturnRequest[];
  companyInfo: CompanyInfo | null;
  accountGroups: AccountGroup[];
  accountCodes: AccountCode[];
  fixedCostTemplates: FixedCostTemplate[];
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
  const [qrMappings, setQrMappings] = useState<QrMapping[]>([]);
  const [itemFormulas, setItemFormulas] = useState<ItemFormula[]>([]);
  const [itemBoms, setItemBoms] = useState<ItemBom[]>([]);
  const [shippingRules, setShippingRules] = useState<ShippingRule[]>([]);
  const [returnRequests, setReturnRequests] = useState<ReturnRequest[]>([]);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [accountCodes, setAccountCodes] = useState<AccountCode[]>([]);
  const [fixedCostTemplates, setFixedCostTemplates] = useState<FixedCostTemplate[]>([]);
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
        subscribeToRecentCollection<RawMaterialEntry>('rawMaterialLedger', 'date', 7, setRawMaterialLedger),
        subscribeToRecentCollection<{ id: string; type: string; date: string; amount: number }>('sesameInputLedger', 'date', 7, setSesameInputLedger),
        subscribeToCollection<AppNotification>('notifications', setAppNotifications),
        subscribeToCollection<WorkOrderItem>('workOrderItems', (data) => setWorkOrderItems([...data].sort((a, b) => a.sortIndex - b.sortIndex))),
        subscribeToRecentCollection<IssuedStatement>('issuedStatements', 'tradeDate', 7, (data) => {
          setIssuedStatements(data.map(s => {
            if (!s.items || !s.tradeDate) {
              console.warn('[useAppData] issuedStatement 필드 누락:', { id: s.id, hasItems: !!s.items, hasTradeDate: !!s.tradeDate });
            }
            return {
              ...s,
              items: s.items ?? [],
              payments: s.payments ?? [],
              tradeDate: s.tradeDate ?? '',
              issuedAt: s.issuedAt ?? '',
            };
          }));
        }),
        subscribeToRecentCollection<ReturnRequest>('returnRequests', 'createdAt', 7, setReturnRequests),
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
        fetchCollection<ShippingRule>('shipping_rule'),
        fetchCollection<ItemBom>('item_bom'),
        fetchCollection<ItemFormula>('item_formula'),
        fetchCollection<AccountGroup>('accountGroups'),
        fetchCollection<AccountCode>('accountCodes'),
        fetchCollection<FixedCostTemplate>('fixedCostTemplates'),
        fetchCollection<QrMapping>('qrMappings'),
      ]).then(([piData, srData, bomData, ifData, agData, acData, fctData, qrData]) => {
        setPartnerItems(piData.map(pi => ({
          ...pi,
          itemId: pi.Item_ID,
          partnerId: pi.Partner_ID,
          price: pi.price ?? pi.Standard_Price,
        })));
        setShippingRules(srData);
        setItemBoms(bomData);
        setItemFormulas(ifData);
        setAccountGroups(agData);
        setAccountCodes(acData);
        setFixedCostTemplates(fctData);
        setQrMappings(qrData);
      });
    });
  }, [staticRefreshKey]);

  return {
    orders, purchaseOrders,
    items,
    partnerItems,
    partners,
    employees, leaveRequests,
    pallets, palletTransactions, adjustmentRequests,
    noticePosts, chatRooms, chatMessages,
    rawMaterialLedger, sesameInputLedger,
    appNotifications, workOrderItems, issuedStatements,
    qrMappings, itemFormulas, itemBoms, shippingRules, returnRequests,
    companyInfo, accountGroups, accountCodes, fixedCostTemplates, inventorySnapshots,
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
