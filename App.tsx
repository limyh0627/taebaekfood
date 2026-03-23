
import React, { useState, useEffect, useMemo } from 'react';
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
  Database as DatabaseIcon,
  Download,
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
  FileText
} from 'lucide-react';
import { Order, Product, ViewType, OrderStatus, Client, Post, FileItem, PalletStock, Employee, LeaveRequest, PalletTransaction, OrderItem, AdjustmentRequest, ChatRoom, ChatMessage, RawMaterialEntry } from './types';
import Dashboard from './components/Dashboard';
import OrdersList from './components/OrdersList';
import ProductList from './components/ProductList';
import AIConsultant from './components/AIConsultant';
import AddOrderModal from './components/AddOrderModal';
import ClientManager from './components/ClientManager';
import DeliveryManager from './components/DeliveryManager';
import PalletManager from './components/PalletManager';
import AdminAuthModal from './components/AdminAuthModal';
import HRManager from './components/HRManager';
import LeaveManager from './components/LeaveManager';
import ConfirmationItems from './components/ConfirmationItems';
import ProductModal from './components/AddProductModal'; 
import NoticeBoard from './components/NoticeBoard';
import DatabaseView from './components/DatabaseView';
import AuthPage from './components/AuthPage';
import ClientPortal from './components/ClientPortal';
import ItemManager from './components/ItemManager';
import TradeStatement from './components/TradeStatement';
import OfficeTalk from './components/OfficeTalk';
import ExcelJS from 'exceljs';

import { db } from './src/firebase';
import { PRODUCT_FORMULA, DENSITY, RM_LIST, toKg } from './src/constants/formula';
import { 
  subscribeToCollection, 
  addItem, 
  updateItem, 
  deleteItem
} from './src/services/firebaseService';
import { collection, getDocs, writeBatch, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

// --- INITIAL DATA ---
const INITIAL_NOTICES: Post[] = [
  { id: 'n1', title: '2024년 상반기 향미유(참깨/들깨) 수급 안정화 공지', author: '구매팀', content: '최근 국산 참깨 작황 호조로 인해 매입 단가가 안정화되었습니다. 생산팀에서는 재고 확보에 유의해주시기 바랍니다.', date: '2024-03-28', tag: '공지' },
  { id: 'n2', title: '[필독] HACCP 정기 심사 대비 위생 점검', author: '품질관리', content: '다음 주 수요일 생산 라인 전체 위생 점검이 예정되어 있습니다. 복장 및 기록물 관리를 철저히 해주세요.', date: '2024-03-27', tag: '긴급' },
];

const INITIAL_BOARD_POSTS: Post[] = [
  { id: 'b1', title: '참기름 저온 압착 공정 최적화 매뉴얼', author: '생산기술', content: '벤조피렌 발생 억제를 위한 볶음 온도 200도 미만 유지 및 압착 압력 조절 가이드입니다.', date: '2024-03-15', tag: '매뉴얼' },
  { id: 'b2', title: '추석 선물세트 물량 예측 데이터 (2024)', author: '영업기획', content: '작년 대비 15% 성장 목표로 박스 및 쇼핑백 자재 선발주가 필요합니다.', date: '2024-03-12', tag: '업무' },
];

const INITIAL_FILES: FileItem[] = [
  { id: 'f1', name: '2024_상반기_제품_카탈로그.pdf', type: 'pdf', size: '5.4MB', date: '2024-03-20', uploader: '홍길동' },
  { id: 'f2', name: '자재_단가표_2024_03.xlsx', type: 'excel', size: '0.8MB', date: '2024-03-18', uploader: '김영희' },
];

const INITIAL_PALLETS: PalletStock[] = [
  { id: 'pal1', name: '플라스틱 파렛트 (1100*1100)', total: 850, inUse: 310, damaged: 8 },
  { id: 'pal2', name: '목재 파렛트 (유럽 규격)', total: 300, inUse: 85, damaged: 24 },
];

const INITIAL_EMPLOYEES: Employee[] = [
  { id: 'e1', name: '홍길동', username: 'admin', password: 'password', position: '과장', department: '생산관리팀', joinDate: '2022-01-10', status: 'working', phone: '010-1111-2222', annualLeave: { carryOverLeave: 2, bonusLeave: 0 }, manualAdjustment: 0 },
  { id: 'e2', name: '김태백', username: 'tb01', password: '1234', position: '대리', department: '물류팀', joinDate: '2023-11-01', status: 'working', phone: '010-3333-4444', annualLeave: { carryOverLeave: 0, bonusLeave: 1 }, manualAdjustment: 0 },
];

const INITIAL_PRODUCTS: Product[] = [
  { 
    id: 'p1', 
    name: '태백 저온참기름 (300ml)', 
    category: '완제품', 
    price: 18500, 
    stock: 450, 
    minStock: 100, 
    unit: '개',
    image: '',
    submaterials: [
      { id: 'p7', name: '골드캡 마개', stock: 1, unit: '개', category: '마개' },
      { id: 'sub-01', name: '300ml 유리용기', stock: 1, unit: '개', category: '용기' },
      { id: 'sub-02', name: '참기름 전용 박스', stock: 1, unit: '개', category: '박스' }
    ]
  },
  {
    id: 'p2',
    name: '태백 전통들기름 (300ml)',
    category: '완제품',
    price: 16500,
    stock: 220,
    minStock: 80,
    unit: '개',
    image: '',
    submaterials: [
      { id: 'p7', name: '골드캡 마개', stock: 1, unit: '개', category: '마개' },
      { id: 'sub-01', name: '300ml 유리용기', stock: 1, unit: '개', category: '용기' },
      { id: 'sub-03', name: '들기름 전용 박스', stock: 1, unit: '개', category: '박스' }
    ]
  },
  { id: 'p3', name: '생들기름 (180ml)', category: '완제품', price: 14000, stock: 15, minStock: 50, unit: '개', image: '' },
  { id: 'p7', name: '골드캡 마개', category: '마개', price: 80, stock: 120, minStock: 1000, unit: '개', image: '' },
  { id: 'p8', name: '태백 로고 테이프', category: '테이프', price: 1200, stock: 45, minStock: 20, unit: '롤', image: '' },
  { id: 'sub-01', name: '300ml 유리용기', category: '용기', price: 450, stock: 1200, minStock: 500, unit: '개', image: '' },
  { id: 'sub-02', name: '참기름 전용 박스', category: '박스', price: 300, stock: 800, minStock: 200, unit: '개', image: '' },
  { id: 'sub-03', name: '들기름 전용 박스', category: '박스', price: 300, stock: 600, minStock: 200, unit: '개', image: '' },
  { id: 'gck-1', name: '고춧가루 1kg', category: '고춧가루', price: 0, stock: 0, minStock: 0, unit: '개', image: '', boxSize: 20 },
  { id: 'gck-5', name: '고춧가루 5kg', category: '고춧가루', price: 0, stock: 0, minStock: 0, unit: '개', image: '', boxSize: 4 },
];

const INITIAL_CLIENTS: Client[] = [
  { id: 'c1', name: '태백유통 강원본부', email: 'tb_gw@tb.com', phone: '033-111-2222', type: '일반', region: '강원', partnerType: '매출처' },
  { id: 'sup-1', name: '형제프라콘', email: '', phone: '', type: '일반', partnerType: '매입처' },
  { id: 'sup-2', name: '호계', email: '', phone: '', type: '일반', partnerType: '매입처' },
  { id: 'sup-3', name: '밝은디자인', email: '', phone: '', type: '일반', partnerType: '매입처' },
];

const INITIAL_SUPPLIERS: Client[] = [];

const App: React.FC = () => {
  const loadData = <T,>(key: string, defaultValue: T): T => {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultValue;
  };

  const [currentUser, setCurrentUser] = useState<Employee | null>(() => {
    const saved = localStorage.getItem('tb_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [currentView, setCurrentView] = useState<ViewType>('orders');
  const [docTab, setDocTab] = useState<'생산판매기록부' | '원료수불부' | '거래명세서'>('생산판매기록부');
  const [docYearMonth, setDocYearMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [bulkMfgDate, setBulkMfgDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rmActiveMaterial, setRmActiveMaterial] = useState('참깨');
  const [rmCorrectionTargetId, setRmCorrectionTargetId] = useState<string | null>(null);
  const [rmCorrectionForm, setRmCorrectionForm] = useState({ date: new Date().toISOString().slice(0, 10), amount: '', isNegative: true, note: '' });
  const [isMobile, setIsMobile] = useState(false);

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
  
  const [noticePosts, setNoticePosts] = useState<Post[]>([]);
  const [pallets, setPallets] = useState<PalletStock[]>([]);
  const [palletTransactions, setPalletTransactions] = useState<PalletTransaction[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [adjustmentRequests, setAdjustmentRequests] = useState<AdjustmentRequest[]>([]);
  const [confirmedOrders, setConfirmedOrders] = useState<{id: string, quantity: number}[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [submaterials, setSubmaterials] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [rawMaterialLedger, setRawMaterialLedger] = useState<RawMaterialEntry[]>([]);

  // Combined products for UI
  const allProducts = useMemo(() => [...products, ...submaterials], [products, submaterials]);

  // 판매 상품(완제품/향미유/고춧가루)은 products, 부자재는 submaterials
  const getProductCollection = (category: string) =>
    ['완제품', '향미유', '고춧가루'].includes(category) ? 'products' : 'submaterials';

  // 원료 자동 사용량 (DELIVERED 주문 → 원료별·날짜별 집계)
  const autoRawMaterialUsage = useMemo<Array<{material: string; date: string; used: number; note: string}>>(() => {
    const dayMap: Record<string, Record<string, { used: number; clients: string[] }>> = {};
    for (const o of orders.filter(o => o.status === OrderStatus.DELIVERED && o.deliveredAt)) {
      const dateStr = o.deliveredAt!.slice(0, 10);
      const clientName = clients.find(c => c.id === o.clientId)?.name || o.customerName || '';
      for (const item of o.items) {
        const prod = allProducts.find(p => p.id === item.productId);
        if (!prod || prod.category !== '완제품') continue;
        const formula = PRODUCT_FORMULA[prod.품목 || prod.name];
        if (!formula) continue;
        for (const f of formula) {
          const usedKg = toKg(prod.용량 || '', f.raw, item.quantity) * f.ratio;
          if (usedKg <= 0) continue;
          if (!dayMap[f.raw]) dayMap[f.raw] = {};
          if (!dayMap[f.raw][dateStr]) dayMap[f.raw][dateStr] = { used: 0, clients: [] };
          dayMap[f.raw][dateStr].used += usedKg;
          if (clientName && !dayMap[f.raw][dateStr].clients.includes(clientName)) dayMap[f.raw][dateStr].clients.push(clientName);
        }
      }
    }
    const result: Array<{ material: string; date: string; used: number; note: string }> = [];
    for (const [mat, dates] of Object.entries(dayMap)) {
      for (const [date, { used, clients }] of Object.entries(dates)) {
        const note = clients.length === 0 ? '생산' : clients.length === 1 ? clients[0] : `${clients[0]} 외 ${clients.length - 1}`;
        result.push({ material: mat, date, used: Math.round(used * 1000) / 1000, note });
      }
    }
    return result;
  }, [orders, allProducts, clients]);

  // 재고 발주 관련 상태
  const [orderRequests, setOrderRequests] = useState<{id: string, quantity: number, confirmedByUser?: boolean}[]>(() => loadData('tb_order_requests', []));

  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [pendingAdminView, setPendingAdminView] = useState<ViewType | null>(null);
  const [isAdminAuthModalOpen, setIsAdminAuthModalOpen] = useState(false);
  const [isAddOrderOpen, setIsAddOrderOpen] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => window.innerWidth < 768);

  // --- Firebase Real-time Sync ---
  useEffect(() => {
    const unsubscribes = [
      subscribeToCollection<Post>('notices', setNoticePosts),
      subscribeToCollection<PalletStock>('pallets', setPallets),
      subscribeToCollection<PalletTransaction>('palletTransactions', setPalletTransactions),
      subscribeToCollection<Employee>('employees', setEmployees),
      subscribeToCollection<LeaveRequest>('leaveRequests', setLeaveRequests),
      subscribeToCollection<AdjustmentRequest>('adjustmentRequests', setAdjustmentRequests),
      subscribeToCollection<{id: string, quantity: number}>('confirmedOrders', setConfirmedOrders),
      subscribeToCollection<Order>('orders', setOrders),
      subscribeToCollection<Product>('products', setProducts),
      subscribeToCollection<Product>('submaterials', setSubmaterials),
      subscribeToCollection<Client>('clients', setClients),
      subscribeToCollection<ChatRoom>('chatRooms', setChatRooms),
      subscribeToCollection<ChatMessage>('chatMessages', setChatMessages),
      subscribeToCollection<RawMaterialEntry>('rawMaterialLedger', setRawMaterialLedger),
    ];

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, []);

  // 완료/반려 후 1일 지난 확인사항 자동 삭제
  useEffect(() => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    adjustmentRequests.forEach(r => {
      if ((r.status === 'processed' || r.status === 'rejected') && r.processedAt && r.processedAt < oneDayAgo) {
        deleteItem('adjustmentRequests', r.id);
      }
    });
  }, [adjustmentRequests]);

  // 신규 주문 등록 시 부자재 부족 여부 체크 후 확인사항 등록
  const checkAndAlertShortage = async (orderItems: Order['items']) => {
    const usage: Record<string, { name: string; needed: number; unit: string }> = {};
    for (const item of orderItems) {
      const product = allProducts.find(p => p.id === item.productId);
      if (!product) continue;

      // 향미유: 재고는 박스 단위
      if (product.category === '향미유') {
        const sub = submaterials.find(s => s.id === product.id);
        if (sub) {
          const boxesNeeded = item.isBoxUnit && item.boxQuantity
            ? item.boxQuantity
            : Math.ceil(item.quantity / (product.boxSize || 1));
          usage[sub.id] = { name: sub.name, needed: (usage[sub.id]?.needed ?? 0) + boxesNeeded, unit: 'B' };
        }
        continue;
      }

      if (product.category !== '완제품' || !product.submaterials) continue;

      let boxSize = 0;
      for (const s of product.submaterials) {
        const sub = submaterials.find(sm => sm.id === s.id);
        if (sub?.category === '박스' && (sub.boxSize ?? 0) > 0) { boxSize = sub.boxSize!; break; }
      }

      for (const s of product.submaterials) {
        const sub = submaterials.find(sm => sm.id === s.id);
        if (!sub || sub.category === '테이프') continue;
        const needed = sub.category === '박스' ? Math.ceil(item.quantity / (boxSize || 1)) : item.quantity;
        usage[sub.id] = { name: sub.name, needed: (usage[sub.id]?.needed ?? 0) + needed, unit: '개' };
      }
    }

    for (const [subId, data] of Object.entries(usage)) {
      const sub = submaterials.find(s => s.id === subId);
      if (!sub || data.needed <= sub.stock) continue;

      const alreadyExists = adjustmentRequests.some(
        r => r.productId === subId && r.type === 'reorder_alert' && r.status === 'pending'
      );
      if (alreadyExists) continue;

      const shortage = data.needed - sub.stock;
      await addItem('adjustmentRequests', {
        id: `REORDER-${subId}-${Date.now()}`,
        productId: subId,
        productName: data.name,
        originalQuantity: sub.stock,
        requestedQuantity: shortage,
        type: 'reorder_alert',
        unit: data.unit,
        reason: `신규 주문 소요량 ${data.needed}${data.unit}, 재고 ${sub.stock}${data.unit} → ${shortage}${data.unit} 부족. 발주 필요.`,
        status: 'pending',
        requestedAt: new Date().toISOString(),
      });
    }
  };


  // 향미유 제품 시딩
  useEffect(() => {
    const seedFlavoredOil = async () => {
      const items = [
        { id: 'f1',   name: '참진한기름',   category: '향미유', supplierId: 'C001', stock: 0, minStock: 10, price: 0, unit: '개', image: '' },
        { id: 'f2',   name: '참고소한기름', category: '향미유', supplierId: 'C001', stock: 0, minStock: 10, price: 0, unit: '개', image: '' },
        { id: 'f3',   name: '참향기름',     category: '향미유', supplierId: 'C001', stock: 0, minStock: 5,  price: 0, unit: '개', image: '' },
        { id: 'f4',   name: '맛기름',       category: '향미유', supplierId: 'C001', stock: 0, minStock: 10, price: 0, unit: '개', image: '' },
        { id: 'f5',   name: '들향기름',     category: '향미유', supplierId: 'C001', stock: 0, minStock: 5,  price: 0, unit: '개', image: '' },
        { id: 'f6',   name: '들향기름골드', category: '향미유', supplierId: 'C001', stock: 0, minStock: 1,  price: 0, unit: '개', image: '' },
        { id: 'f2-1', name: '참고소(연한)', category: '향미유', supplierId: 'C001', stock: 0, minStock: 0,  price: 0, unit: '개', image: '' },
      ];
      for (const item of items) {
        const ref = doc(db, 'products', item.id);  // 향미유는 products에 저장
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
      const snap = await getDocs(collection(db, 'submaterials'));
      for (const d of snap.docs) {
        if (d.id.startsWith('s-auto')) {
          await deleteDoc(doc(db, 'submaterials', d.id));
          console.log('삭제됨:', d.id);
        }
      }
    };
    cleanupDuplicates();
  }, []);

  // 초기 데이터 시딩 (데이터베이스가 비어있을 때만 실행 권장)
  const seedDatabase = async () => {
    const collections = [
      { name: 'notices', data: INITIAL_NOTICES },
      { name: 'boardPosts', data: INITIAL_BOARD_POSTS },
      { name: 'files', data: INITIAL_FILES },
      { name: 'pallets', data: INITIAL_PALLETS },
      { name: 'employees', data: INITIAL_EMPLOYEES },
      { name: 'products', data: INITIAL_PRODUCTS.filter((p: Product) => p.category === '완제품') },
      { name: 'submaterials', data: INITIAL_PRODUCTS.filter((p: Product) => p.category !== '완제품') },
      { name: 'clients', data: INITIAL_CLIENTS },
      { name: 'suppliers', data: INITIAL_SUPPLIERS },
    ];

    for (const col of collections) {
      const snapshot = await getDocs(collection(db, col.name));
      if (snapshot.empty) {
        const batch = writeBatch(db);
        for (const item of col.data) {
          const { id, ...rest } = item as any;
          const docRef = id ? doc(db, col.name, id) : doc(collection(db, col.name));
          batch.set(docRef, rest);
          
          // 서브컬렉션 데이터는 더 이상 사용하지 않고 메인 문서의 submaterials 필드(배열)로 관리합니다.
        }
        await batch.commit();
        console.log(`${col.name} seeded`);
      }
    }
    alert('기본 데이터가 Firebase에 성공적으로 저장되었습니다.');
  };

  // --- 자동 발주 감지 시스템 ---
  useEffect(() => {
    // 완제품은 자체 생산이므로 자동 발주 대상에서 제외
    // 향미유 및 기타 부자재는 재고 부족 시 자동 발주 요청함으로 이동
    const lowStockItems = allProducts.filter(p => p.category !== '완제품' && p.stock < p.minStock);
    
    const timer = setTimeout(() => {
      setOrderRequests(prev => {
        // 기존 요청 목록에서 완제품이 있다면 제거 (강제 정화)
        const cleanedPrev = prev.filter(r => {
          const product = allProducts.find(p => p.id === r.id);
          return product && product.category !== '완제품';
        });

        let updated = [...cleanedPrev];
        let hasChange = cleanedPrev.length !== prev.length;

        lowStockItems.forEach(item => {
          const isInRequests = updated.some(r => r.id === item.id);
          const isInConfirmed = confirmedOrders.some(c => c.id === item.id);
          if (!isInRequests && !isInConfirmed) {
            updated.push({ id: item.id, quantity: item.minStock * 2, confirmedByUser: false });
            hasChange = true;
          }
        });
        return hasChange ? updated : prev;
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [allProducts, confirmedOrders]);

  // 로컬 스토리지 저장 (세션 관련만 유지)
  useEffect(() => { localStorage.setItem('tb_order_requests', JSON.stringify(orderRequests)); }, [orderRequests]);

  // --- 재고 관리 핸들러 ---
  const handleAddOrderRequest = (id: string, quantity: number) => {
    setOrderRequests(prev => {
      const exists = prev.find(r => r.id === id);
      if (exists) return prev.map(r => r.id === id ? { ...r, quantity, confirmedByUser: true } : r);
      return [...prev, { id, quantity, confirmedByUser: true }];
    });
  };

  const handleRemoveOrderRequest = (id: string) => {
    setOrderRequests(prev => prev.filter(r => r.id !== id));
  };

  const handleUpdateOrderRequestQty = (id: string, quantity: number) => {
    setOrderRequests(prev => prev.map(r => r.id === id ? { ...r, quantity } : r));
  };

  const handleToggleConfirmRequestQty = (id: string) => {
    setOrderRequests(prev => prev.map(r => r.id === id ? { ...r, confirmedByUser: !r.confirmedByUser } : r));
  };

  const handleBulkAddConfirmedOrders = async (items: { id: string, quantity: number }[]) => {
    for (const item of items) {
      await addItem('confirmedOrders', item);
    }
    const idsToRemove = items.map(i => i.id);
    setOrderRequests(prev => prev.filter(r => !idsToRemove.includes(r.id)));
  };

  // 주문이 이력으로 이동할 때 부자재 차감 (완제품 재고는 변동 없음)
  const deductSubmaterialsForOrder = async (order: Order) => {
    for (const item of order.items) {
      const product = allProducts.find(p => p.id === item.productId);
      if (!product) continue;

      // 향미유/고춧가루: 박스 단위로 재고 차감
      if (product.category === '향미유' || product.category === '고춧가루') {
        const uPerBox = item.unitsPerBox || product.defaultBoxConfig?.unitsPerBox || product.boxSize || 1;
        const boxesUsed = item.isBoxUnit && item.boxQuantity
          ? item.boxQuantity
          : Math.ceil(item.quantity / uPerBox);
        const collection = products.find(p => p.id === product.id) ? 'products' : 'submaterials';
        await updateItem(collection, product.id, { stock: product.stock - boxesUsed });
        continue;
      }

      // 완제품: 부자재만 차감
      if (product.category !== '완제품' || !product.submaterials) continue;

      // 사용한 박스 수 계산
      const boxesUsed = item.isBoxUnit && item.boxQuantity
        ? item.boxQuantity
        : item.unitsPerBox
          ? Math.ceil(item.quantity / item.unitsPerBox)
          : null;

      // 박스 차감: boxSubId 직접 참조 → BOM 박스 순으로 폴백
      const boxSubToDeduct = (() => {
        if (item.boxSubId) {
          const byId = submaterials.find(sm => sm.id === item.boxSubId);
          if (byId) return byId;
        }
        for (const s of product.submaterials!) {
          const sub = submaterials.find(sm => sm.id === s.id && sm.category === '박스');
          if (sub) return sub;
        }
        return null;
      })();

      if (boxSubToDeduct) {
        const deductQty = boxesUsed ?? Math.ceil(item.quantity / (boxSubToDeduct.boxSize || 1));
        if (deductQty > 0) {
          await updateItem('submaterials', boxSubToDeduct.id, { stock: boxSubToDeduct.stock - deductQty });
        }
      }

      // 박스·테이프 외 부자재 차감 (낱개 수량 기준)
      for (const s of product.submaterials) {
        const actualSub = submaterials.find(sm => sm.id === s.id);
        if (!actualSub) continue;
        if (actualSub.category === '박스' || actualSub.category === '테이프') continue;
        await updateItem('submaterials', actualSub.id, { stock: actualSub.stock - item.quantity });
      }

      // 원료 사용량 → rawMaterialLedger 기록 (완제품 한정)
      const formula = PRODUCT_FORMULA[product.품목 || product.name];
      if (formula) {
        const dateStr = order.deliveredAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
        const clientName = clients.find(c => c.id === order.clientId)?.name || order.customerName || '';
        for (const f of formula) {
          const usedKg = toKg(product.용량 || '', f.raw, item.quantity) * f.ratio;
          if (usedKg <= 0) continue;
          const entryId = `rm-auto-${order.id}-${f.raw.replace(/\s/g, '_')}`;
          await setDoc(doc(db, 'rawMaterialLedger', entryId), {
            id: entryId,
            material: f.raw,
            date: dateStr,
            received: 0,
            used: Math.round(usedKg * 1000) / 1000,
            note: `자동: ${clientName}`,
            createdAt: new Date().toISOString(),
            type: 'auto',
            orderId: order.id,
          }, { merge: true });
        }
      }
    }
  };

  const handleFinishConfirmedOrder = async (id: string) => {
    const conf = confirmedOrders.find(c => c.id === id);
    if (!conf) return;
    const product = allProducts.find(p => p.id === id);
    if (product) {
      const collectionName = getProductCollection(product.category);
      await updateItem(collectionName, id, { stock: product.stock + conf.quantity });
    }
    await deleteItem('confirmedOrders', id);
  };

  const handleToggleItemChecked = (orderId: string, itemIdx: number) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const newItems = [...order.items];
    newItems[itemIdx] = { ...newItems[itemIdx], checked: !newItems[itemIdx].checked };
    const allChecked = newItems.every(i => i.checked);
    const wasNotDispatched = order.status !== OrderStatus.DISPATCHED && order.status !== OrderStatus.SHIPPED;
    if (allChecked && wasNotDispatched) {
      updateItem('orders', orderId, { items: newItems, status: OrderStatus.DISPATCHED });
    } else {
      updateItem('orders', orderId, { items: newItems });
    }
  };

  const handleUpdateItems = (orderId: string, items: OrderItem[]) => {
    updateItem('orders', orderId, { items });
  };

  const handleLogin = (user: Employee) => {
    setCurrentUser(user);
    localStorage.setItem('tb_user', JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('tb_user');
  };

  const isAdmin = currentUser?.id === 'admin';

  const handleNavClick = (view: ViewType) => {
    const adminOnlyViews: ViewType[] = ['hr', 'dashboard', 'ai-consultant'];
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
    setIsAdminAuthenticated(true);
    setIsAdminAuthModalOpen(false);
    if (pendingAdminView) {
      setCurrentView(pendingAdminView);
      setPendingAdminView(null);
    }
  };

  // 고객 포털 뷰가 활성화된 경우 (전체 화면 모드)
  if (currentView === 'client-portal') {
    return <ClientPortal clients={clients} products={allProducts} onOrderSubmit={(o) => addItem('orders', o)} onExit={() => setCurrentView('orders')} />;
  }

  if (!currentUser) {
    return <AuthPage onLogin={handleLogin} registeredEmployees={employees} onRegister={(e) => updateItem('employees', e.id, { username: e.username, password: e.password })} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* 모바일 오버레이 배경 */}
      {isMobile && !isSidebarCollapsed && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsSidebarCollapsed(true)}
        />
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 bg-white border-r border-slate-200 transition-all duration-300 ${
        isMobile
          ? (isSidebarCollapsed ? '-translate-x-full' : 'translate-x-0 w-64')
          : (isSidebarCollapsed ? 'w-20' : 'w-64')
      }`}>
        <div className={`flex flex-col h-full ${isSidebarCollapsed ? 'p-4' : 'p-6'}`}>
          <div className={`flex items-center ${isSidebarCollapsed ? 'flex-col gap-2' : 'px-2 justify-between'} mb-10`}>
            <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setCurrentView('orders')}>
              <div className="w-10 h-10 bg-pink-500 rounded-xl flex items-center justify-center text-white shadow-lg flex-shrink-0 font-black text-sm tracking-tight leading-none">태백</div>
              {!isSidebarCollapsed && <h1 className="text-xl font-bold uppercase tracking-tight text-indigo-600 break-words leading-tight">스마트오더</h1>}
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

          {/* 계정 정보 (클릭 → 로그아웃) */}
          <div
            className={`mb-6 cursor-pointer group ${isSidebarCollapsed ? 'flex justify-center' : ''}`}
            onClick={() => window.confirm(`${currentUser.name}님, 로그아웃 하시겠습니까?`) && handleLogout()}
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
          
          <div className="flex-1 space-y-8 overflow-y-auto no-scrollbar">
            <div>
              {!isSidebarCollapsed && <p className="px-4 mb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">운영 관리</p>}
              <nav className="space-y-1">
                <NavItem icon={MessageSquare} label="오피스톡" active={currentView === 'officetalk'} onClick={() => handleNavClick('officetalk')} collapsed={isSidebarCollapsed} />
                <NavItem icon={Truck} label="배송 관리" active={currentView === 'shipping'} onClick={() => handleNavClick('shipping')} collapsed={isSidebarCollapsed} />
                <NavItem icon={ShoppingCart} label="주문 관리" active={currentView === 'orders'} onClick={() => handleNavClick('orders')} collapsed={isSidebarCollapsed} />
                <NavItem icon={Package} label="재고 관리" active={currentView === 'inventory'} onClick={() => handleNavClick('inventory')} collapsed={isSidebarCollapsed} />
                <NavItem icon={Settings} label="품목 관리" active={currentView === 'item-management'} onClick={() => handleNavClick('item-management')} collapsed={isSidebarCollapsed} />
                <NavItem icon={Layers} label="파렛트 관리" active={currentView === 'pallets'} onClick={() => handleNavClick('pallets')} collapsed={isSidebarCollapsed} />
                <NavItem icon={CalendarCheck} label="연차 신청" active={currentView === 'leave-portal'} onClick={() => handleNavClick('leave-portal')} collapsed={isSidebarCollapsed} />
                <NavItem icon={Users} label="거래처 관리" active={currentView === 'clients'} onClick={() => handleNavClick('clients')} collapsed={isSidebarCollapsed} />
                <NavItem icon={ShieldCheck} label="확인사항" active={currentView === 'confirmation-items'} onClick={() => handleNavClick('confirmation-items')} collapsed={isSidebarCollapsed} />
                <NavItem icon={DatabaseIcon} label="데이터베이스" active={currentView === 'database'} onClick={() => handleNavClick('database')} collapsed={isSidebarCollapsed} />
                <NavItem icon={BellRing} label="공지사항" active={currentView === 'notice'} onClick={() => handleNavClick('notice')} collapsed={isSidebarCollapsed} />
              </nav>
            </div>

            {isAdmin && (
              <div>
                {!isSidebarCollapsed && <p className="px-4 mb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">분석 및 관리자</p>}
                <nav className="space-y-1">
                  <NavItem icon={LayoutDashboard} label="비즈니스 대시보드" active={currentView === 'dashboard'} onClick={() => handleNavClick('dashboard')} collapsed={isSidebarCollapsed} />
                  <NavItem icon={Sparkles} label="AI 인사이트" active={currentView === 'ai-consultant'} onClick={() => handleNavClick('ai-consultant')} collapsed={isSidebarCollapsed} />
                  <NavItem icon={UserCheck} label="인사/연차 관리" active={currentView === 'hr'} onClick={() => handleNavClick('hr')} collapsed={isSidebarCollapsed} />
                  <NavItem icon={FileText} label="서류 관리" active={currentView === 'documents'} onClick={() => handleNavClick('documents')} collapsed={isSidebarCollapsed} />
                </nav>
              </div>
            )}

            <div>
              {!isSidebarCollapsed && <p className="px-4 mb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">외부 서비스</p>}
              <nav className="space-y-1">
                <button 
                  onClick={() => setCurrentView('client-portal')}
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
          </div>

        </div>
      </aside>

      <main className={`flex-1 flex flex-col min-w-0 h-screen overflow-hidden transition-all duration-300 ${isMobile ? '' : (isSidebarCollapsed ? 'ml-20' : 'ml-64')}`}>
        {/* 모바일 헤더 */}
        <header className="md:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setIsSidebarCollapsed(false)}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
          >
            <Menu size={24} />
          </button>
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-pink-500 rounded-lg flex items-center justify-center text-white font-black text-xs tracking-tight leading-none">태백</div>
            <h1 className="text-sm font-bold text-indigo-600">스마트오더</h1>
          </div>
          <div className="w-10" /> {/* Spacer for centering */}
        </header>
        
        <div className="flex-1 overflow-auto p-3 md:p-4 lg:p-6 custom-scrollbar">
          <div className={(['orders', 'officetalk', 'leave-portal', 'inventory', 'clients', 'notice', 'pallets', 'confirmation-items'].includes(currentView)) ? '' : 'min-w-[720px] md:min-w-0 h-full'}>
          {currentView === 'dashboard' && <Dashboard orders={orders} products={allProducts} />}
          {currentView === 'shipping' && (
            <DeliveryManager 
              orders={orders} 
              clients={clients} 
              onUpdateDeliveryDate={(id, date) => updateItem('orders', id, { deliveryDate: date })}
            />
          )}
          {currentView === 'orders' && (
            <OrdersList 
              orders={orders} 
              clients={clients} 
              products={allProducts} 
              onDeleteOrder={(id) => deleteItem('orders', id)} 
              onAddClick={() => setIsAddOrderOpen(true)} 
              title="주문 관리" 
              subtitle="전체 주문 현황" 
              groupBy="status" 
              allowedStatuses={Object.values(OrderStatus)} 
              onUpdateStatus={async (id, status) => {
                if (status === OrderStatus.DELIVERED) {
                  const order = orders.find(o => o.id === id);
                  if (order) await deductSubmaterialsForOrder(order);
                  await updateItem('orders', id, { status, deliveredAt: new Date().toISOString() });
                } else {
                  await updateItem('orders', id, { status });
                }
              }}
              onUpdateDeliveryDate={(id, date) => updateItem('orders', id, { deliveryDate: date })} 
              onToggleItemChecked={handleToggleItemChecked}
              onUpdateItems={handleUpdateItems}
              onUpdateDeliveryBoxes={(id, boxes) => updateItem('orders', id, { deliveryBoxes: boxes })}
              onToggleInvoicePrinted={(id, value) => updateItem('orders', id, { invoicePrinted: value })}
            />
          )}
          {currentView === 'inventory' && (
            <ProductList 
              products={allProducts} 
              onUpdateProduct={(p) => updateItem(getProductCollection(p.category), p.id, p)} 
              onAddProduct={(p) => addItem(getProductCollection(p.category), p)} 
              orderRequests={orderRequests} 
              confirmedOrders={confirmedOrders} 
              onAddOrderRequest={handleAddOrderRequest} 
              onRemoveOrderRequest={handleRemoveOrderRequest} 
              onUpdateOrderRequestQty={handleUpdateOrderRequestQty} 
              onToggleConfirmRequestQty={handleToggleConfirmRequestQty} 
              onConfirmRequest={(id: string) => handleBulkAddConfirmedOrders([{ id, quantity: orderRequests.find(r => r.id === id)?.quantity || 0 }])} 
              onConfirmRequests={(ids: string[]) => handleBulkAddConfirmedOrders(orderRequests.filter(r => ids.includes(r.id)).map(r => ({id: r.id, quantity: r.quantity})))} 
              onBulkAddConfirmedOrders={handleBulkAddConfirmedOrders} 
              onConfirmAllRequests={() => handleBulkAddConfirmedOrders(orderRequests.map(r => ({id: r.id, quantity: r.quantity})))} 
              onFinishConfirmedOrder={handleFinishConfirmedOrder} 
              onFinishConfirmedOrders={(ids: string[]) => ids.forEach(handleFinishConfirmedOrder)} 
              onFinishAllConfirmedOrders={() => confirmedOrders.forEach(c => handleFinishConfirmedOrder(c.id))} 
              onUpdateConfirmedQty={(id: string, qty: number) => setConfirmedOrders(prev => prev.map(c => c.id === id ? { ...c, quantity: qty } : c))} 
              onEditProduct={(p) => { setEditingProduct(p); setIsProductModalOpen(true); }}
              onAddAdjustmentRequest={(req) => addItem('adjustmentRequests', req)}
              suppliers={clients.filter(c => c.partnerType === '매입처' || c.partnerType === '매출+매입처')}
              rawMaterialLedger={rawMaterialLedger}
              autoUsageEntries={autoRawMaterialUsage}
              onAddRawMaterialEntry={async (entry) => {
                await addItem('rawMaterialLedger', entry);
                // 수율 파생 입고 자동 추가
                // 참깨/들깨: 주 용도(압착)만 자동 연결. 직접 볶을 때(볶음참깨/볶음들깨)는 수동 입력
                // 검정깨: 주로 볶음검정참깨로 구매하나 직접 볶을 때 자동 연결
                const YIELD_AUTO: Record<string, { product: string; rate: number }> = {
                  '참깨': { product: '통깨참기름', rate: 0.45 },
                  '깨분': { product: '깨분참기름', rate: 0.45 },
                  '들깨': { product: '통들깨들기름', rate: 0.37 },
                  '검정깨': { product: '볶음검정참깨', rate: 0.95 },
                  // 참깨→볶음참깨(0.95), 들깨→볶음들깨(0.95): 직접 볶는 경우 수동 입력
                };
                if (entry.used > 0 && YIELD_AUTO[entry.material]) {
                  const { product, rate } = YIELD_AUTO[entry.material];
                  await addItem('rawMaterialLedger', {
                    id: `rm-yield-${Date.now()}`,
                    material: product,
                    date: entry.date,
                    received: Math.round(entry.used * rate * 1000) / 1000,
                    used: 0,
                    note: `${entry.material} 압착 (수율 ${rate * 100}%)`,
                    createdAt: new Date().toISOString(),
                  });
                }
              }}
              onDeleteRawMaterialEntry={(id) => deleteItem('rawMaterialLedger', id)}
            />
          )}
          {currentView === 'ai-consultant' && <AIConsultant orders={orders} products={allProducts} />}
          {currentView === 'clients' && <ClientManager clients={clients} onUpdateClient={(c) => updateItem('clients', c.id, c)} onAddClient={(c) => addItem('clients', c)} />}
          {currentView === 'database' && (
            <div className="space-y-6">
              <div className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-indigo-900">Firebase 데이터 마이그레이션</h3>
                  <p className="text-sm text-indigo-700">구글 시트 등에서 가져온 초기 데이터를 Firebase Firestore로 업로드합니다.</p>
                </div>
                <button 
                  onClick={seedDatabase}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all flex items-center space-x-2"
                >
                  <Download size={18} />
                  <span>데이터 업로드 시작</span>
                </button>
              </div>
              <DatabaseView onSync={async (data) => { 
                // Clients sync
                for (const c of data.clients) {
                  await addItem('clients', c);
                }
                
                // Products sync
                for (const p of data.products) {
                  const collectionName = getProductCollection(p.category);
                  await addItem(collectionName, p);
                }
                alert('동기화가 완료되었습니다.');
              }} />
            </div>
          )}
          {currentView === 'notice' && <NoticeBoard posts={noticePosts} onAddPost={(post) => addItem('notices', post)} />}
          {currentView === 'pallets' && (
            <PalletManager 
              pallets={pallets} 
              orders={orders} 
              clients={clients} 
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
              onDeleteLeaveRequest={(id) => deleteItem('leaveRequests', id)}
            />
          )}
          {currentView === 'documents' && (() => {
            const shippedOrders = orders.filter(o =>
              o.status === OrderStatus.SHIPPED &&
              o.items.some(item => {
                const p = allProducts.find(pr => pr.id === item.productId);
                return p?.category === '완제품';
              })
            );

            // 소비기한 계산 헬퍼 (제조일자 + 1년)
            const calcExpiry = (mfgDate: string) => {
              if (!mfgDate) return '';
              const d = new Date(mfgDate);
              d.setFullYear(d.getFullYear() + 1);
              return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
            };

            // 우측: 완제품만, (상호, 품목, 용량) 기준 그룹화
            type RightRow = { 상호: string; 품목: string; 용량: string; 수량: number; 소비기한: string; 제조일자: string; orderItems: Array<{orderId: string; itemIdx: number}>; };
            const rightRowsRaw = shippedOrders.flatMap(order => {
              const client = clients.find(c => c.id === order.clientId);
              const clientName = client?.name || order.customerName || '';
              return order.items.flatMap((item, itemIdx) => {
                const product = allProducts.find(p => p.id === item.productId);
                if (product?.category !== '완제품') return [];
                return [{ 상호: clientName, 품목: product?.품목 || item.name, 용량: product?.용량 || '', 수량: item.quantity, 소비기한: calcExpiry(item.mfgDate || ''), 제조일자: item.mfgDate || '', orderId: order.id, itemIdx }];
              });
            });
            const rightRows: RightRow[] = Object.values(
              rightRowsRaw.reduce((acc, row) => {
                const key = `${row.상호}||${row.품목}||${row.용량}`;
                if (!acc[key]) {
                  acc[key] = { 상호: row.상호, 품목: row.품목, 용량: row.용량, 수량: row.수량, 소비기한: row.소비기한, 제조일자: row.제조일자, orderItems: [{ orderId: row.orderId, itemIdx: row.itemIdx }] };
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
            const agg: Record<string, { qty: number; mfgDates: string[]; clients: string[] }> = {};
            rightRows.forEach(r => {
              const key = `${r.품목}||${r.용량}`;
              if (!agg[key]) agg[key] = { qty: 0, mfgDates: [], clients: [] };
              agg[key].qty += r.수량;
              if (r.제조일자) agg[key].mfgDates.push(r.제조일자);
              if (r.상호 && !agg[key].clients.includes(r.상호)) agg[key].clients.push(r.상호);
            });

            // 좌측 상단 템플릿 (참기름/들기름 계열)
            const topTemplate: { label: string; key: string; volumes: string[] }[] = [
              { label: '시골향참기름①', key: '시골향참기름1', volumes: ['180ml','300ml','350ml','1500ml','1750ml','1800ml','16.5kg'] },
              { label: '시골향참기름②', key: '시골향참기름2', volumes: ['300ml','350ml','1500ml','1750ml','1800ml'] },
              { label: '시골향참기름③', key: '시골향참기름3', volumes: ['300ml','350ml','1500ml','1750ml','1800ml','16.5kg'] },
              { label: '시골향참기름④', key: '시골향참기름4', volumes: ['300ml','350ml','1500ml','1750ml','1800ml'] },
              { label: '시골향들기름①', key: '시골향들기름1', volumes: ['270ml','350ml','1800ml','16.5kg'] },
              { label: '시골향들기름②', key: '시골향들기름2', volumes: ['180ml','300ml','350ml','1500ml','1750ml','1800ml'] },
              { label: '토마토참기름',  key: '토마토참기름',  volumes: ['1800ml'] },
              { label: '새싹참기름',   key: '새싹참기름',   volumes: ['300ml','350ml'] },
              { label: '새싹들기름',   key: '새싹들기름',   volumes: ['300ml','350ml'] },
            ];

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
            const leftRows: { groupLabel: string; 용량: string; 수량: number; 소비기한: string; 비고: string }[] = [];
            topTemplate.forEach(({ label, key, volumes }) => {
              volumes.forEach((vol, i) => {
                const a = agg[`${key}||${vol}`] || { qty: 0, mfgDates: [], clients: [] };
                const earliestMfg = a.mfgDates.length ? [...a.mfgDates].sort()[0] : '';
                const expiryStr = earliestMfg ? calcExpiry(earliestMfg) : '';
                const clientNote = a.clients.join(', ');
                leftRows.push({ groupLabel: i === 0 ? label : '', 용량: vol, 수량: a.qty, 소비기한: expiryStr, 비고: clientNote });
              });
            });

            // 제조일자 미입력 완제품 체크
            const missingMfgDate = shippedOrders.flatMap(o =>
              o.items.filter(item => {
                const p = allProducts.find(pr => pr.id === item.productId);
                return p?.category === '완제품' && !item.mfgDate;
              }).map(item => item.name)
            );

            const exportExcel = async () => {
              if (missingMfgDate.length > 0) {
                const proceed = window.confirm(
                  `제조일자가 입력되지 않은 품목이 있습니다:\n${[...new Set(missingMfgDate)].join(', ')}\n\n계속 저장하시겠습니까?`
                );
                if (!proceed) return;
              }
              const wb = new ExcelJS.Workbook();
              const ws = wb.addWorksheet('생산작업판매일지');

              // 열 너비
              ws.columns = [
                { width: 18 }, { width: 8 }, { width: 6 }, { width: 18 }, { width: 28 },
                { width: 2 },
                { width: 18 }, { width: 16 }, { width: 8 }, { width: 6 }, { width: 18 },
              ];

              const thinBorder: Partial<ExcelJS.Borders> = {
                top: { style: 'thin' }, bottom: { style: 'thin' },
                left: { style: 'thin' }, right: { style: 'thin' },
              };
              const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
              const groupFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };

              const applyHeader = (row: ExcelJS.Row, cols: number[]) => {
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
                  l?.groupLabel ?? '', l?.용량 ?? '', l ? (l.수량 || 0) : '', l?.소비기한 ?? '', l?.비고 ?? '',
                  '',
                  r?.상호 ?? '', r?.품목 ?? '', r?.용량 ?? '', r ? r.수량 : '', r?.소비기한 ?? '',
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
                const a = agg[`${품목}||${용량}`] || { qty: 0, mfgDates: [], clients: [] };
                const earliestMfg = a.mfgDates.length ? [...a.mfgDates].sort()[0] : '';
                const expiryStr = earliestMfg ? calcExpiry(earliestMfg) : '';
                const clientNote = a.clients.join(', ');
                const displayQty = getBottomQty(품목, 용량);
                const row = ws.addRow([품목, 용량, displayQty, expiryStr, clientNote]);
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

              // 파일 저장
              const buf = await wb.xlsx.writeBuffer();
              const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `생산작업판매일지_${bulkMfgDate || new Date().toISOString().slice(0, 10)}.xlsx`;
              a.click();
              URL.revokeObjectURL(url);

              // 출고(SHIPPED) 주문을 예전 주문이력(DELIVERED)으로 이동 + 부자재 차감
              for (const o of shippedOrders) {
                await deductSubmaterialsForOrder(o);
                await updateItem('orders', o.id, { status: OrderStatus.DELIVERED, deliveredAt: new Date().toISOString() });
              }
            };

            return (
              <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-3xl font-black text-slate-900 uppercase">서류 관리</h2>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
                      <button
                        onClick={() => setDocTab('생산판매기록부')}
                        className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${docTab === '생산판매기록부' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                      >생산판매기록부</button>
                      <button
                        onClick={() => setDocTab('원료수불부')}
                        className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${docTab === '원료수불부' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                      >원료수불부</button>
                      <button
                        onClick={() => setDocTab('거래명세서')}
                        className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${docTab === '거래명세서' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}
                      >거래명세서</button>
                    </div>
                    {docTab === '생산판매기록부' && (
                      <div className="flex items-center gap-2">
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
                            const cnt = orders.filter(o => o.status === OrderStatus.SHIPPED)
                              .flatMap(o => o.items.filter(item => allProducts.find(p => p.id === item.productId)?.category === '완제품')).length;
                            return cnt > 0 ? <span className="text-[10px] font-bold text-amber-500 whitespace-nowrap">{cnt}건</span> : null;
                          })()}
                          <button
                            onClick={async () => {
                              if (!bulkMfgDate) return;
                              type UnsetItem = { orderId: string; itemIdx: number; productName: string };
                              const unset: UnsetItem[] = [];
                              const targetOrders = orders.filter(o =>
                                o.status === OrderStatus.SHIPPED
                              );
                              for (const o of targetOrders) {
                                o.items.forEach((item, itemIdx) => {
                                  const p = allProducts.find(pr => pr.id === item.productId);
                                  if (p?.category === '완제품') {
                                    unset.push({ orderId: o.id, itemIdx, productName: p.품목 || item.name });
                                  }
                                });
                              }
                              if (unset.length === 0) { alert('적용할 항목이 없습니다.'); return; }
                              const uniqueProducts: string[] = [];
                              for (const { productName } of unset) {
                                if (!uniqueProducts.includes(productName)) uniqueProducts.push(productName);
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
                              for (const { orderId, itemIdx, productName } of unset) {
                                if (!byOrder[orderId]) byOrder[orderId] = [];
                                byOrder[orderId].push({ itemIdx, date: productDateMap[productName] });
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
                  </div>
                </div>

                {docTab === '생산판매기록부' && (
                  <div className="space-y-4">

                    {/* 상단: 생산 내역(좌) + 판매 내역(우) */}
                    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-x-auto">
                      {rightRows.length === 0 && leftRows.every(r => r.수량 === 0) ? (
                        <div className="flex flex-col items-center justify-center py-24 opacity-20">
                          <FileText size={40} />
                          <p className="text-xs font-bold mt-2">출고 주문이 없습니다</p>
                        </div>
                      ) : (
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
                              const hasIssue = r && (!r.품목 || !r.용량 || !r.제조일자);
                              return (
                                <tr key={i} className={`transition-colors ${hasIssue ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-slate-50/50'}`}>
                                  {/* 좌측 */}
                                  <td className={`px-3 py-1.5 border border-slate-200 font-bold whitespace-nowrap ${l?.groupLabel ? 'bg-blue-50 text-slate-800' : 'text-slate-400'}`}>{l?.groupLabel ?? ''}</td>
                                  <td className="px-3 py-1.5 border border-slate-200 text-center text-slate-600">{l?.용량 ?? ''}</td>
                                  <td className={`px-3 py-1.5 border border-slate-200 text-center font-black ${l && l.수량 > 0 ? 'text-indigo-700' : 'text-slate-300'}`}>{l ? (l.수량 || 0) : ''}</td>
                                  <td className="px-3 py-1.5 border border-slate-200 text-center text-slate-500 whitespace-nowrap">{l?.소비기한 ?? ''}</td>
                                  <td className="px-3 py-1.5 border border-slate-200 text-slate-500 text-[10px] break-words max-w-[160px]">{l?.비고 ?? ''}</td>
                                  {/* 구분 */}
                                  <td className="w-3 bg-slate-100 border-y border-slate-200" />
                                  {/* 우측 */}
                                  <td className="px-3 py-1.5 border border-slate-200 font-bold text-slate-800 whitespace-nowrap">{r?.상호 ?? ''}</td>
                                  <td className="px-3 py-1.5 border border-slate-200 text-slate-700">{r?.품목 ?? ''}</td>
                                  <td className="px-3 py-1.5 border border-slate-200 text-center text-slate-600">{r?.용량 ?? ''}</td>
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
                      )}
                    </div>

                    {/* 하단: 참깨/들깨 계열 */}
                    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-x-auto">
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
                            const a = agg[`${품목}||${용량}`] || { qty: 0, mfgDates: [], clients: [] };
                            const earliestMfg = a.mfgDates.length ? [...a.mfgDates].sort()[0] : '';
                            const expiryStr = earliestMfg ? calcExpiry(earliestMfg) : '';
                            const clientNote = a.clients.join(', ');
                            const displayQty = getBottomQty(품목, 용량);
                            return (
                              <tr key={`${품목}${용량}`} className="hover:bg-slate-50/50">
                                <td className="px-3 py-1.5 border border-slate-200 font-bold text-slate-800">{품목}</td>
                                <td className="px-3 py-1.5 border border-slate-200 text-center text-slate-600">{용량}</td>
                                <td className={`px-3 py-1.5 border border-slate-200 text-center font-black ${displayQty > 0 ? 'text-indigo-700' : 'text-slate-300'}`}>{displayQty}</td>
                                <td className="px-3 py-1.5 border border-slate-200 text-center text-slate-500 whitespace-nowrap">{expiryStr}</td>
                                <td className="px-3 py-1.5 border border-slate-200 text-slate-500 text-[10px] break-words max-w-[160px]">{clientNote}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {docTab === '원료수불부' && (() => {
                  type UsageRow = { date: string; received: number; used: number; note: string; type: 'auto' | 'manual' | 'correction'; id?: string };

                  // 수율: 원재료 사용 → 반제품 입고 자동 파생
                  const YIELD_MAP: Record<string, { product: string; yield: number }> = {
                    '참깨': { product: '통깨참기름', yield: 0.45 },
                    '깨분': { product: '깨분참기름', yield: 0.45 },
                    '들깨': { product: '통들깨들기름', yield: 0.37 },
                    '검정깨': { product: '볶음검정참깨', yield: 0.95 },
                  };

                  const calcDerivedReceived = (material: string): UsageRow[] => {
                    const rows: UsageRow[] = [];
                    const sourceEntry = Object.entries(YIELD_MAP).find(([, v]) => v.product === material);
                    if (!sourceEntry) return rows;
                    const [sourceMaterial, { yield: yieldRate }] = sourceEntry;
                    rawMaterialLedger
                      .filter(e => e.material === sourceMaterial && e.used > 0 && e.type !== 'auto')
                      .forEach(e => {
                        const derivedKg = Math.round(e.used * yieldRate * 1000) / 1000;
                        rows.push({ date: e.date, received: derivedKg, used: 0, note: `${sourceMaterial} 압착 (수율 ${yieldRate * 100}%)`, type: 'auto' as const });
                      });
                    return rows;
                  };

                  // 수불부 행 계산 — DB 데이터만 사용 (auto/manual/correction 모두 포함)
                  const buildLedger = (material: string) => {
                    const dbEntries: UsageRow[] = rawMaterialLedger
                      .filter(e => e.material === material)
                      .map(e => ({ date: e.date, received: e.received, used: e.used, note: e.note, type: (e.type || 'manual') as UsageRow['type'], id: e.id }));
                    const derivedEntries = calcDerivedReceived(material);
                    const allEntries = [...dbEntries, ...derivedEntries].sort((a, b) => a.date.localeCompare(b.date));
                    // 전재고 계산 (월 이전 누적)
                    const prevBalance = allEntries
                      .filter(e => e.date < `${docYearMonth}-01`)
                      .reduce((s, e) => s + e.received - e.used, 0);
                    // 월내 행
                    const monthEntries = allEntries.filter(e => e.date.startsWith(docYearMonth));
                    let balance = prevBalance;
                    return monthEntries.map(e => {
                      const prev = balance;
                      balance = Math.round((balance + e.received - e.used) * 1000) / 1000;
                      return { ...e, prevBalance: Math.round(prev * 1000) / 1000, currentBalance: balance };
                    });
                  };

                  // 원료수불부 Excel 저장
                  const exportRmExcel = async () => {
                    const wb = new ExcelJS.Workbook();
                    for (const mat of RM_LIST) {
                      const ws = wb.addWorksheet(mat);
                      ws.columns = [
                        { width: 12 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 30 }
                      ];
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
                                          onClick={() => { if (confirm('삭제할까요?')) deleteItem('rawMaterialLedger', row.id!); }}
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
                                        <input type="number" min="0" step="0.001" placeholder="수량(kg)" value={rmCorrectionForm.amount}
                                          onChange={e => setRmCorrectionForm(f => ({ ...f, amount: e.target.value }))}
                                          className="border border-amber-300 rounded-lg px-2 py-1 text-[11px] w-24 outline-none focus:border-amber-500" />
                                        <input type="text" placeholder="비고" value={rmCorrectionForm.note}
                                          onChange={e => setRmCorrectionForm(f => ({ ...f, note: e.target.value }))}
                                          className="border border-amber-300 rounded-lg px-2 py-1 text-[11px] flex-1 min-w-32 outline-none focus:border-amber-500" />
                                        <button
                                          onClick={async () => {
                                            const amt = parseFloat(rmCorrectionForm.amount);
                                            if (!amt || amt <= 0) return;
                                            const correctionUsed = rmCorrectionForm.isNegative ? -amt : amt;
                                            await addItem('rawMaterialLedger', {
                                              id: `rm-corr-${Date.now()}`,
                                              material: rmActiveMaterial,
                                              date: rmCorrectionForm.date,
                                              received: 0,
                                              used: correctionUsed,
                                              note: rmCorrectionForm.note || `정정 (원본: ${row.id})`,
                                              createdAt: new Date().toISOString(),
                                              type: 'correction',
                                            });
                                            setRmCorrectionTargetId(null);
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

                {docTab === '거래명세서' && (
                  <TradeStatement
                    orders={orders}
                    allProducts={allProducts}
                    clients={clients}
                  />
                )}
              </div>
            );
          })()}
          {currentView === 'confirmation-items' && (
            <ConfirmationItems 
              requests={adjustmentRequests}
              onUpdateStatus={(id, status) => updateItem('adjustmentRequests', id, { status, processedAt: new Date().toISOString() })}
              onProcessAdjustment={async (req) => {
                // 실제 재고 반영 로직
                const product = allProducts.find(p => p.id === req.productId);
                if (product) {
                  const collectionName = getProductCollection(product.category);
                  if (req.type === 'quantity_change') {
                    // 수량 변동 승인 시, 요청된 수량만큼 재고에 더함
                    await updateItem(collectionName, req.productId, { stock: product.stock + (req.requestedQuantity || 0) });
                  } else if (req.type === 'cancel_receipt') {
                    // 입고 취소 승인 시, 아무것도 하지 않음 (이미 반영 전이므로 리스트에서만 제거)
                    // 만약 이미 반영된 후에 취소하는 것이라면 stock에서 빼야 함.
                    // 하지만 여기서는 "입고 예정" 리스트에 있는 것을 처리하는 것이므로 stock 반영은 안 함.
                  }
                  
                  // 처리 완료 후 입고 예정 리스트(confirmedOrders)에서 제거
                  await deleteItem('confirmedOrders', req.productId);
                }
                await updateItem('adjustmentRequests', req.id, { status: 'processed', processedAt: new Date().toISOString() });
                alert('처리가 완료되었습니다.');
              }}
            />
          )}
          {currentView === 'leave-portal' && (
            <LeaveManager 
              currentUser={currentUser}
              employees={employees} 
              leaveRequests={leaveRequests} 
              onAddLeaveRequest={(req) => addItem('leaveRequests', req)} 
              onUpdateLeaveStatus={(id, status) => updateItem('leaveRequests', id, { status })} 
              onDeleteLeaveRequest={(id) => deleteItem('leaveRequests', id)} 
            />
          )}
          {currentView === 'item-management' && (
            <ItemManager
              products={allProducts}
              clients={clients}
              onEditProduct={(p) => { setEditingProduct(p); setIsProductModalOpen(true); }}
              onAddProduct={() => { setEditingProduct(null); setIsProductModalOpen(true); }}
              onDeleteProduct={(id, category) => deleteItem(getProductCollection(category), id)}
            />
          )}
          {currentView === 'officetalk' && (
            <OfficeTalk 
              currentUser={currentUser}
              employees={employees}
              chatRooms={chatRooms}
              chatMessages={chatMessages}
              onAddRoom={(room) => addItem('chatRooms', room)}
              onUpdateRoom={(id, data) => updateItem('chatRooms', id, data)}
              onDeleteRoom={(id) => deleteItem('chatRooms', id)}
              onSendMessage={async (msg) => {
                await addItem('chatMessages', msg);
                // Update last message in room
                const room = chatRooms.find(r => r.id === msg.roomId);
                if (room) {
                  await updateItem('chatRooms', room.id, { 
                    lastMessage: msg.text, 
                    lastUpdatedAt: new Date().toISOString() 
                  });
                }
                
                // Check for admin mention
                if (msg.text.includes('@관리자')) {
                  const adminRequest: AdjustmentRequest = {
                    id: `MENTION-${Date.now()}`,
                    productId: 'chat-mention',
                    productName: `[채팅 언급] ${msg.senderName}`,
                    originalQuantity: 0,
                    type: 'chat_mention',
                    reason: msg.text,
                    status: 'pending',
                    requestedAt: new Date().toISOString()
                  };
                  await addItem('adjustmentRequests', adminRequest);
                }
              }}
            />
          )}
          </div>
        </div>
      </main>

      {isAdminAuthModalOpen && <AdminAuthModal onClose={() => setIsAdminAuthModalOpen(false)} onSuccess={onAdminAuthSuccess} />}
      {isAddOrderOpen && <AddOrderModal products={allProducts} clients={clients} onClose={() => setIsAddOrderOpen(false)} onSave={async (o) => {
        await addItem('orders', {...o, id: `ORD-${Date.now()}`, createdAt: new Date().toISOString(), status: OrderStatus.PENDING});
        await checkAndAlertShortage(o.items);
        setIsAddOrderOpen(false);
      }} />}
      {isProductModalOpen && (
        <ProductModal
          initialData={editingProduct || undefined}
          allSubmaterials={submaterials}
          products={products}
          clients={clients}
          onClose={() => {setIsProductModalOpen(false); setEditingProduct(null);}} 
          onSave={async (p) => {
            const collectionName = getProductCollection(p.category);
            // 기존 컬렉션과 다른 경우(카테고리 변경) 이전 문서 삭제
            if (editingProduct) {
              const prevCollection = getProductCollection(editingProduct.category);
              if (prevCollection !== collectionName) {
                await deleteItem(prevCollection, p.id);
              }
            }
            // setDoc 기반 addItem으로 통일 (문서 없어도 생성, 있으면 덮어쓰기)
            await addItem(collectionName, p);
            setIsProductModalOpen(false);
            setEditingProduct(null);
          }} 
        />
      )}
    </div>
  );
};

const NavItem = ({ icon: Icon, label, active, onClick, collapsed }: { icon: any, label: string, active: boolean, onClick: () => void, collapsed?: boolean }) => (
  <button
    onClick={onClick}
    title={collapsed ? label : undefined}
    className={`w-full flex items-center ${collapsed ? 'justify-center' : 'space-x-3 px-4'} py-3 rounded-xl transition-all duration-200 ${
      active 
        ? 'bg-indigo-600 text-white shadow-lg font-bold' 
        : 'text-slate-500 hover:bg-slate-50'
    }`}
  >
    <Icon size={18} className="flex-shrink-0" />
    {!collapsed && <span className="text-sm whitespace-nowrap overflow-hidden">{label}</span>}
  </button>
);

export default App;
