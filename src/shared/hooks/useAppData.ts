import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Order, Item, Partner, PartnerItem, Post,
  PalletStock, PalletTransaction, Employee, LeaveRequest,
  AdjustmentRequest, ChatRoom, ChatMessage, RawMaterialEntry,
  AppNotification, IssuedStatement,
  ItemFormula, ItemBom, ShippingRule, CompanyInfo, QrMapping, ReturnRequest,
  AccountCode, AccountGroup, FixedCostTemplate, InventorySnapshot, ProductionSalesLog,
  PendingStatementEdit, PurchaseOrder,
} from '../types';
import { subscribeToCollection, subscribeToDocument } from '../services/firebaseService';
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
        subscribeToCollection<PurchaseOrder>('purchaseOrders', setPurchaseOrders),
        subscribeToCollection<Order>('orders', (data) => { setOrders(data); markLoaded('orders'); }),
        subscribeToCollection<Item>('items', (data) => { setItems(data); markLoaded('items'); }),
        subscribeToCollection<Partner>('partners', setPartners),
        subscribeToCollection<PartnerItem>('partner_item', (data) => {
          setPartnerItems(data.map(pi => ({
            ...pi,
            itemId: pi.Item_ID,
            partnerId: pi.Partner_ID,
            price: pi.price ?? pi.Standard_Price,
          })));
        }),
        subscribeToCollection<ChatRoom>('chatRooms', setChatRooms),
        subscribeToCollection<ChatMessage>('chatMessages', setChatMessages),
        subscribeToCollection<RawMaterialEntry>('rawMaterialLedger', setRawMaterialLedger),
        subscribeToCollection<{ id: string; type: string; date: string; amount: number }>('sesameInputLedger', setSesameInputLedger),
        subscribeToCollection<AppNotification>('notifications', setAppNotifications),
        subscribeToCollection<WorkOrderItem>('workOrderItems', (data) => setWorkOrderItems([...data].sort((a, b) => a.sortIndex - b.sortIndex))),
        subscribeToCollection<IssuedStatement>('issuedStatements', (data) => {
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
        subscribeToCollection<QrMapping>('qrMappings', setQrMappings),
        subscribeToCollection<ItemFormula>('item_formula', setItemFormulas),
        subscribeToCollection<ItemBom>('item_bom', setItemBoms),
        subscribeToCollection<ShippingRule>('shipping_rule', setShippingRules),
        subscribeToCollection<ReturnRequest>('returnRequests', setReturnRequests),
        subscribeToDocument<CompanyInfo>('settings', 'company', setCompanyInfo),
        subscribeToCollection<AccountGroup>('accountGroups', setAccountGroups),
        subscribeToCollection<AccountCode>('accountCodes', setAccountCodes),
        subscribeToCollection<FixedCostTemplate>('fixedCostTemplates', setFixedCostTemplates),
        subscribeToCollection<InventorySnapshot>('inventorySnapshots', setInventorySnapshots),
        subscribeToCollection<ProductionSalesLog>('productionSalesLogs', setProductionSalesLogs),
        subscribeToCollection<PendingStatementEdit>('pendingStatementEdits', setPendingStatementEdits),
      ];
    });

    return () => {
      cancelled = true;
      unsubscribes.forEach(u => u());
    };
  }, []);

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
  };
}
