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
  CashAccount, CashEntry, Settlement, CompanyId,
} from '../types';
import { subscribeToCollection, subscribeToRecentCollection, subscribeToDocument, fetchCollection, fetchDateRange } from '../services/firebaseService';
import { buildBomIndex, setBomIndex } from '../bomIndex';
import { buildPackIndex, setPackIndex, type PackRow } from '../packIndex';
import { where } from 'firebase/firestore';
import { authReady } from '../firebase';
import { kstDateRangeUtc } from '../day';
import { companySettingDocId } from '../companySettings';

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
      const range = kstDateRangeUtc(start, end);
      const data = await fetchCollection<Order>('orders', [
        where('createdAt', '>=', range.startInclusive),
        where('createdAt', '<', range.endExclusive),
        where('companyId', '==', companyId),
      ]);
      setHistoricalOrders(data);
      loadedHistoricalRangeRef.current = { start, end };
    } finally {
      setIsLoadingHistoricalOrders(false);
    }
  }, [companyId]);

  const markLoaded = (key: string) => {
    loadedRef.current.add(key);
    if (loadedRef.current.has('orders') && loadedRef.current.has('items')) {
      setIsDataLoading(false);
    }
  };

  // ── 실시간 구독 (자주 바뀌는 데이터) ──
  useEffect(() => {
    if (!enabled) return;
    let unsubscribes: (() => void)[] = [];
    let cancelled = false;

    //  모든 업무 컬렉션은 로그인 회사에 잠근다. `companyId`가 안 붙은 옛 문서는
    //  이관 스크립트를 돌리기 전까지 목록에서 빠진다 — 이 훅이 아니라 데이터 이관으로 푼다.
    const co = [where('companyId', '==', companyId)];
    authReady.then(() => {
      if (cancelled) return;
      /**
       * **관리자만 거는 구독** — 전표·자금·재무·문서함. 직원 로그인이면 빈 배열로 둔다.
       * 규칙(`adminOnlyCollection`)과 짝이 맞아야 한다.
       */
      const 관리자구독 = !isAdmin ? [] : [
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
        }, co),
        // 자금 원장 — 전표와 같은 이유로 전체 로딩. 잔액은 첫 거래부터 누적해야 맞다.
        subscribeToCollection<CashAccount>('cashAccounts', setCashAccounts, co),
        subscribeToCollection<CashEntry>('cashEntries', setCashEntries, co),
        subscribeToCollection<Settlement>('settlements', setSettlements, co),
        subscribeToCollection<InventorySnapshot>('inventorySnapshots', setInventorySnapshots, co),
        subscribeToRecentCollection<ProductionSalesLog>('productionSalesLogs', 'date', 7, setProductionSalesLogs, co),
        subscribeToRecentCollection<PendingStatementEdit>('pendingStatementEdits', 'createdAt', 7, setPendingStatementEdits, co),
      ];

      unsubscribes = [
        ...관리자구독,
        subscribeToCollection<Post>('notices', setNoticePosts, co),
        subscribeToCollection<PalletStock>('pallets', setPallets, co),
        subscribeToRecentCollection<PalletTransaction>('palletTransactions', 'date', 7, setPalletTransactions, co),
        subscribeToCollection<Employee>('employees', setEmployees, co),
        subscribeToCollection<LeaveRequest>('leaveRequests', setLeaveRequests, co),
        subscribeToCollection<AdjustmentRequest>('adjustmentRequests', setAdjustmentRequests, co),
        subscribeToCollection<PurchaseOrder>('purchaseOrders', setPurchaseOrders, co),
        subscribeToCollection<Item>('items', (data) => { setItems(data); markLoaded('items'); }, co),
        subscribeToCollection<Partner>('partners', setPartners, co),
        subscribeToCollection<ChatRoom>('chatRooms', setChatRooms, co),
        subscribeToRecentCollection<ChatMessage>('chatMessages', 'createdAt', 7, setChatMessages, co),
        // rawMaterialLedger: 전역 구독 제거 — 원료수불부/재고관리 화면이 열릴 때만 fetchDateRange로 전체 조회(AdminApp).
        //   (앱 시작 시 모든 사용자가 7일치를 읽던 낭비 제거. 쓰기 시엔 ledgerReloadKey로 재조회.)
        subscribeToRecentCollection<{ id: string; type: string; date: string; amount: number }>('sesameInputLedger', 'date', 7, setSesameInputLedger, co),
        subscribeToCollection<AppNotification>('notifications', setAppNotifications, co),
        subscribeToCollection<WorkOrderItem>('workOrderItems', (data) => setWorkOrderItems([...data].sort((a, b) => a.sortIndex - b.sortIndex)), co),
        subscribeToRecentCollection<ReturnRequest>('returnRequests', 'createdAt', 7, setReturnRequests, co),
        subscribeToCollection<ItemReceipt>('itemReceipts', setItemReceipts, co),
        //  회사별 설정 문서 — 문서 id 를 회사 id 로 둬 두 회사가 서로 덮어쓰지 않는다.
        subscribeToDocument<CompanyInfo>('settings', companySettingDocId(companyId, 'company'), setCompanyInfo),
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
      const cutoff = new Date(Date.now() - ordersMonths * 30 * 86400000).toISOString();
      unsub = subscribeToCollection<Order>(
        'orders',
        (data) => {
          setOrders(data.filter(order => String(order.createdAt ?? '') >= cutoff));
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
