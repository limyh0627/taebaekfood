/**
 * @shared-move  shared/src/hooks/useAppData.ts  (직원 공통 데이터)
 * 직원 앱에서 필요한 Firebase 실시간 구독 훅입니다.
 * Phase 2 분리 시 직원 앱 전용으로 이동합니다.
 * 관리자 전용 데이터는 useAdminData 훅을 참고하세요.
 */
import { useState, useEffect, useRef } from 'react';
import {
  Order, Product, Client, ProductClient, ProductSupplier, Post,
  PalletStock, PalletTransaction, Employee, LeaveRequest,
  AdjustmentRequest, ChatRoom, ChatMessage, RawMaterialEntry,
  AppNotification, OrderStatus, IssuedStatement,
  ItemBom, ItemCustomer, CompanyInfo,
} from '../../types';
import { subscribeToCollection, subscribeToDocument } from '../services/firebaseService';

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
  date?: string; // KST 날짜 YYYY-MM-DD
}

export interface AppData {
  // 주문
  orders: Order[];
  confirmedOrders: { id: string; quantity: number }[];
  orderRequests: { id: string; quantity: number; confirmedByUser?: boolean }[];
  // 상품
  products: Product[];
  submaterials: Product[];
  productClients: ProductClient[];
  productSuppliers: ProductSupplier[];
  // 거래처 / 직원
  clients: Client[];
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
  // 금일 작업순서
  workOrderItems: WorkOrderItem[];
  // 발행된 전표
  issuedStatements: IssuedStatement[];
  // BOM
  itemBoms: ItemBom[];
  itemCustomers: ItemCustomer[];
  // 회사 정보
  companyInfo: CompanyInfo | null;
  // 로딩 상태
  isDataLoading: boolean;
  // ※ fixedCosts, productionRecords 는 useAdminData 훅에서 별도 관리
}

export function useAppData(): AppData {
  const [orders, setOrders] = useState<Order[]>([]);
  const [confirmedOrders, setConfirmedOrders] = useState<{ id: string; quantity: number }[]>([]);
  const [orderRequests, setOrderRequests] = useState<{ id: string; quantity: number; confirmedByUser?: boolean }[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [submaterials, setSubmaterials] = useState<Product[]>([]);
  const [productClients, setProductClients] = useState<ProductClient[]>([]);
  const [productSuppliers, setProductSuppliers] = useState<ProductSupplier[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
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
  const [itemBoms, setItemBoms] = useState<ItemBom[]>([]);
  const [itemCustomers, setItemCustomers] = useState<ItemCustomer[]>([]);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const loadedRef = useRef(new Set<string>());

  const markLoaded = (key: string) => {
    loadedRef.current.add(key);
    if (loadedRef.current.has('orders') && loadedRef.current.has('products')) {
      setIsDataLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribes = [
      subscribeToCollection<Post>('notices', setNoticePosts),
      subscribeToCollection<PalletStock>('pallets', setPallets),
      subscribeToCollection<PalletTransaction>('palletTransactions', setPalletTransactions),
      subscribeToCollection<Employee>('employees', setEmployees),
      subscribeToCollection<LeaveRequest>('leaveRequests', setLeaveRequests),
      subscribeToCollection<AdjustmentRequest>('adjustmentRequests', setAdjustmentRequests),
      subscribeToCollection<{ id: string; quantity: number }>('confirmedOrders', setConfirmedOrders),
      subscribeToCollection<{ id: string; quantity: number; confirmedByUser?: boolean }>('orderRequests', setOrderRequests),
      subscribeToCollection<Order>('orders', (data) => { setOrders(data); markLoaded('orders'); }),
      subscribeToCollection<Product>('products', (data) => { setProducts(data); markLoaded('products'); }),
      subscribeToCollection<Product>('submaterials', setSubmaterials),
      subscribeToCollection<Client>('clients', setClients),
      subscribeToCollection<ProductClient>('productClients', setProductClients),
      subscribeToCollection<ProductSupplier>('productSuppliers', setProductSuppliers),
      subscribeToCollection<ChatRoom>('chatRooms', setChatRooms),
      subscribeToCollection<ChatMessage>('chatMessages', setChatMessages),
      subscribeToCollection<RawMaterialEntry>('rawMaterialLedger', setRawMaterialLedger),
      subscribeToCollection<{ id: string; type: string; date: string; amount: number }>('sesameInputLedger', setSesameInputLedger),
      subscribeToCollection<AppNotification>('notifications', setAppNotifications),
      subscribeToCollection<WorkOrderItem>('workOrderItems', (data) => setWorkOrderItems([...data].sort((a, b) => a.sortIndex - b.sortIndex))),
      subscribeToCollection<IssuedStatement>('issuedStatements', setIssuedStatements),
      subscribeToCollection<ItemBom>('item_bom', setItemBoms),
      subscribeToCollection<ItemCustomer>('item_customer', setItemCustomers),
      subscribeToDocument<CompanyInfo>('settings', 'company', setCompanyInfo),
    ];
    return () => unsubscribes.forEach(u => u());
  }, []);

  return {
    orders, confirmedOrders, orderRequests,
    products, submaterials, productClients, productSuppliers,
    clients, employees, leaveRequests,
    pallets, palletTransactions, adjustmentRequests,
    noticePosts, chatRooms, chatMessages,
    rawMaterialLedger, sesameInputLedger,
    appNotifications,
    workOrderItems,
    issuedStatements,
    itemBoms,
    itemCustomers,
    companyInfo,
    isDataLoading,
  };
}
