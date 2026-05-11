import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Order, Item, Partner, PartnerItem, Post,
  PalletStock, PalletTransaction, Employee, LeaveRequest,
  AdjustmentRequest, ChatRoom, ChatMessage, RawMaterialEntry,
  AppNotification, IssuedStatement,
  ItemBom, CompanyInfo, PendingReceipt, QrMapping, ReturnRequest,
  AccountCode, AccountGroup, FixedCostTemplate,
} from '../types';
import { subscribeToCollection, subscribeToDocument } from '../services/firebaseService';
import { authReady } from '../firebase';

export interface WorkOrderItem {
  id: string;
  key: string;
  orderId: string;
  productId: string;
  itemName: string;
  clientName: string;
  qty: number;
  category: string;
  sortIndex: number;
  date?: string;
}

export interface AppData {
  pendingReceipts: PendingReceipt[];
  qrMappings: QrMapping[];
  // 주문
  orders: Order[];
  confirmedOrders: { id: string; quantity: number }[];
  orderRequests: { id: string; quantity: number; confirmedByUser?: boolean }[];
  // 품목 (items 컬렉션 통합 — 완제품+부자재)
  items: Item[];
  products: Item[];        // items 중 완제품 (backward compat)
  submaterials: Item[];    // items 중 부자재 (backward compat)
  // 파트너-품목 매핑 (partner_item 컬렉션 통합)
  partnerItems: PartnerItem[];
  productClients: PartnerItem[];   // Direction='out' (backward compat)
  productSuppliers: PartnerItem[]; // Direction='in'  (backward compat)
  // 파트너 / 직원
  partners: Partner[];
  clients: Partner[];       // backward compat
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
  itemBoms: ItemBom[];
  returnRequests: ReturnRequest[];
  companyInfo: CompanyInfo | null;
  accountGroups: AccountGroup[];
  accountCodes: AccountCode[];
  fixedCostTemplates: FixedCostTemplate[];
  itemCustomers: PartnerItem[];
  isDataLoading: boolean;
}

export function useAppData(): AppData {
  const [orders, setOrders] = useState<Order[]>([]);
  const [confirmedOrders, setConfirmedOrders] = useState<{ id: string; quantity: number }[]>([]);
  const [orderRequests, setOrderRequests] = useState<{ id: string; quantity: number; confirmedByUser?: boolean }[]>([]);
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
  const [pendingReceipts, setPendingReceipts] = useState<PendingReceipt[]>([]);
  const [qrMappings, setQrMappings] = useState<QrMapping[]>([]);
  const [itemBoms, setItemBoms] = useState<ItemBom[]>([]);
  const [returnRequests, setReturnRequests] = useState<ReturnRequest[]>([]);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [accountGroups, setAccountGroups] = useState<AccountGroup[]>([]);
  const [accountCodes, setAccountCodes] = useState<AccountCode[]>([]);
  const [fixedCostTemplates, setFixedCostTemplates] = useState<FixedCostTemplate[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const loadedRef = useRef(new Set<string>());

  const markLoaded = (key: string) => {
    loadedRef.current.add(key);
    if (loadedRef.current.has('orders') && loadedRef.current.has('items')) {
      setIsDataLoading(false);
    }
  };

  useEffect(() => {
    let unsubscribes: (() => void)[] = [];
    let cancelled = false;

    authReady.then(() => {
      if (cancelled) return;
      unsubscribes = [
        subscribeToCollection<Post>('notices', setNoticePosts),
        subscribeToCollection<PalletStock>('pallets', setPallets),
        subscribeToCollection<PalletTransaction>('palletTransactions', setPalletTransactions),
        subscribeToCollection<Employee>('employees', setEmployees),
        subscribeToCollection<LeaveRequest>('leaveRequests', setLeaveRequests),
        subscribeToCollection<AdjustmentRequest>('adjustmentRequests', setAdjustmentRequests),
        subscribeToCollection<{ id: string; quantity: number }>('confirmedOrders', setConfirmedOrders),
        subscribeToCollection<{ id: string; quantity: number; confirmedByUser?: boolean }>('orderRequests', setOrderRequests),
        subscribeToCollection<Order>('orders', (data) => { setOrders(data); markLoaded('orders'); }),
        subscribeToCollection<Item>('items', (data) => { setItems(data); markLoaded('items'); }),
        subscribeToCollection<Partner>('partners', setPartners),
        subscribeToCollection<PartnerItem>('partner_item', (data) => {
          setPartnerItems(data.map(pi => ({
            ...pi,
            productId: pi.Item_ID,
            clientId:   pi.Direction === 'out' ? pi.Partner_ID : undefined,
            supplierId: pi.Direction === 'in'  ? pi.Partner_ID : undefined,
            price: pi.Standard_Price,
          })));
        }),
        subscribeToCollection<ChatRoom>('chatRooms', setChatRooms),
        subscribeToCollection<ChatMessage>('chatMessages', setChatMessages),
        subscribeToCollection<RawMaterialEntry>('rawMaterialLedger', setRawMaterialLedger),
        subscribeToCollection<{ id: string; type: string; date: string; amount: number }>('sesameInputLedger', setSesameInputLedger),
        subscribeToCollection<AppNotification>('notifications', setAppNotifications),
        subscribeToCollection<WorkOrderItem>('workOrderItems', (data) => setWorkOrderItems([...data].sort((a, b) => a.sortIndex - b.sortIndex))),
        subscribeToCollection<IssuedStatement>('issuedStatements', setIssuedStatements),
        subscribeToCollection<PendingReceipt>('pendingReceipts', setPendingReceipts),
        subscribeToCollection<QrMapping>('qrMappings', setQrMappings),
        subscribeToCollection<ItemBom>('item_bom', setItemBoms),
        subscribeToCollection<ReturnRequest>('returnRequests', setReturnRequests),
        subscribeToDocument<CompanyInfo>('settings', 'company', setCompanyInfo),
        subscribeToCollection<AccountGroup>('accountGroups', setAccountGroups),
        subscribeToCollection<AccountCode>('accountCodes', setAccountCodes),
        subscribeToCollection<FixedCostTemplate>('fixedCostTemplates', setFixedCostTemplates),
      ];
    });

    return () => {
      cancelled = true;
      unsubscribes.forEach(u => u());
    };
  }, []);

  // backward compat splits
  const products    = useMemo(() => items.filter(i => i.category === '완제품'), [items]);
  const submaterials = useMemo(() => items.filter(i => i.category !== '완제품'), [items]);
  const productClients   = useMemo(() => partnerItems.filter(pi => pi.Direction === 'out'), [partnerItems]);
  const productSuppliers = useMemo(() => partnerItems.filter(pi => pi.Direction === 'in'),  [partnerItems]);
  // itemCustomers: Direction='out' PartnerItem에 item_id/customer_id 별칭 주입
  const itemCustomers = useMemo(() =>
    productClients.map(pc => ({ ...pc, item_id: pc.Item_ID, customer_id: pc.Partner_ID })),
    [productClients]
  );

  return {
    orders, confirmedOrders, orderRequests,
    items, products, submaterials,
    partnerItems, productClients, productSuppliers,
    partners, clients: partners,
    employees, leaveRequests,
    pallets, palletTransactions, adjustmentRequests,
    noticePosts, chatRooms, chatMessages,
    rawMaterialLedger, sesameInputLedger,
    appNotifications, workOrderItems, issuedStatements,
    pendingReceipts, qrMappings, itemBoms, returnRequests,
    companyInfo, accountGroups, accountCodes, fixedCostTemplates,
    itemCustomers, isDataLoading,
  };
}
