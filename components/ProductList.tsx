
import React, { useState, useMemo } from 'react';
import {
  Package,
  Edit,
  Box,
  Grape,
  Cylinder,
  Disc,
  StickyNote,
  Inbox,
  X,
  ShoppingCart,
  ClipboardCheck,
  Trash2,
  Search,
  LayoutGrid,
  ListPlus,
  AlertCircle,
  Tag,
  Building2
} from 'lucide-react';
import { Product, InventoryCategory, AdjustmentRequest, AdjustmentType, RawMaterialEntry } from '../types';
import AddProductModal from './AddProductModal';
import ConfirmModal from './ConfirmModal';

interface OrderRequest {
  id: string;
  quantity: number;
  confirmedByUser?: boolean;
}

interface ProductListProps {
  products: Product[];
  orderRequests: OrderRequest[];
  confirmedOrders: { id: string; quantity: number }[];
  onUpdateProduct: (product: Product) => void;
  onAddProduct: (product: Product) => void;
  onAddOrderRequest: (id: string, qty: number) => void;
  onRemoveOrderRequest: (id: string) => void;
  onUpdateOrderRequestQty: (id: string, qty: number) => void;
  onToggleConfirmRequestQty: (id: string) => void;
  onConfirmRequest: (id: string) => void;
  onConfirmRequests: (ids: string[]) => void;
  onBulkAddConfirmedOrders: (items: { id: string, quantity: number }[]) => void;
  onConfirmAllRequests: () => void;
  onFinishConfirmedOrder: (id: string) => void;
  onFinishConfirmedOrders: (ids: string[]) => void;
  onFinishAllConfirmedOrders: () => void;
  onUpdateConfirmedQty: (id: string, qty: number) => void;
  onEditProduct: (product: Product) => void;
  onDeleteProduct: (id: string) => void;
  onAddAdjustmentRequest: (req: AdjustmentRequest) => void;
  suppliers: { id: string; name: string }[];
  rawMaterialLedger: RawMaterialEntry[];
  autoUsageEntries?: Array<{ material: string; date: string; used: number; note: string }>;
  onAddRawMaterialEntry: (entry: RawMaterialEntry) => void;
  onDeleteRawMaterialEntry: (id: string) => void;
  currentUser?: { name: string; id: string } | null;
}

const RAW_MATERIALS = ['참깨','들깨','검정깨','탈피들깨가루','깨분','볶음참깨','볶음들깨','볶음검정참깨','통깨참기름','깨분참기름','통들깨들기름','수입들기름'];

type MainTab = 'requests' | 'history' | 'master';
type TopTab = 'product' | 'rawmaterial';

const ProductList: React.FC<ProductListProps> = ({
  products,
  orderRequests,
  confirmedOrders,
  onAddProduct,
  onUpdateProduct,
  onAddOrderRequest,
  onRemoveOrderRequest,
  onBulkAddConfirmedOrders,
  onFinishConfirmedOrder,
  onUpdateConfirmedQty,
  onEditProduct,
  onDeleteProduct,
  onAddAdjustmentRequest,
  suppliers,
  rawMaterialLedger,
  autoUsageEntries = [],
  onAddRawMaterialEntry,
  onDeleteRawMaterialEntry,
  currentUser,
}) => {
  const [topTab, setTopTab] = useState<TopTab>('product');
  const [activeTab, setActiveTab] = useState<MainTab>('master');
  const [rmMaterial, setRmMaterial] = useState(RAW_MATERIALS[0]);
  const [rmDate, setRmDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [rmReceived, setRmReceived] = useState('');
  const [rmUsed, setRmUsed] = useState('');
  const [rmNote, setRmNote] = useState('');
  const [rmFilter, setRmFilter] = useState('전체');
  const [rmOpenBalance, setRmOpenBalance] = useState('');
  const [rmOpenDate, setRmOpenDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; });
  const [rmOpenMaterial, setRmOpenMaterial] = useState(RAW_MATERIALS[0]);
  const [activeSubCategory, setActiveSubCategory] = useState<InventoryCategory | '전체' | string>('전체');
  const [filterMode, setFilterMode] = useState<null | 'supplier' | 'category'>(null);

  const toggleFilterMode = (mode: 'supplier' | 'category') => {
    setFilterMode(prev => prev === mode ? null : mode);
    setActiveSubCategory('전체');
  };
  const [searchTerm, setSearchTerm] = useState('');
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draftOrders, setDraftOrders] = useState<{ id: string, quantity: number }[]>([]);
  const [editingStockId, setEditingStockId] = useState<string | null>(null);
  const [editingStockVal, setEditingStockVal] = useState<string>('');
  const [rowEditProduct, setRowEditProduct] = useState<Product | null>(null);
  const [rowEditForm, setRowEditForm] = useState<Partial<Product>>({});

  React.useEffect(() => {
    if (!rowEditProduct) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setRowEditProduct(null); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rowEditProduct]);
  
  const [expandedReqId, setExpandedReqId] = useState<string | null>(null);
  const [reqEditQty, setReqEditQty] = useState<number>(0);
  const [reqNote, setReqNote] = useState<string>('');
  const [inlineCartId, setInlineCartId] = useState<string | null>(null);
  const [inlineCartQty, setInlineCartQty] = useState<number>(0);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [showRmSheet, setShowRmSheet] = useState(false);
  const [rmSheetTab, setRmSheetTab] = useState<'new' | 'carryover'>('new');
  const [cart, setCart] = useState<{ id: string; qty: number }[]>([]);
  const [showCartPanel, setShowCartPanel] = useState(false);

  const addToCart = (productId: string, defaultQty: number) => {
    setCart(prev => prev.some(c => c.id === productId) ? prev : [...prev, { id: productId, qty: defaultQty }]);
  };
  const removeFromCart = (id: string) => setCart(prev => prev.filter(c => c.id !== id));
  const updateCartQty = (id: string, qty: number) => setCart(prev => prev.map(c => c.id === id ? { ...c, qty: Math.max(1, qty) } : c));
  const submitCart = () => {
    onBulkAddConfirmedOrders(cart.map(item => ({ id: item.id, quantity: item.qty })));
    setCart([]);
    setShowCartPanel(false);
  };

  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; onConfirm: () => void } | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 24;

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    orderRequests.forEach(req => {
      const product = products.find(p => p.id === req.id);
      if (product) {
        counts[product.category] = (counts[product.category] || 0) + 1;
      }
    });
    return counts;
  }, [orderRequests, products]);

  const [adjustmentModal, setAdjustmentModal] = useState<{
    isOpen: boolean;
    productId: string;
    productName: string;
    originalQuantity: number;
    type: AdjustmentType;
  } | null>(null);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [adjustmentQty, setAdjustmentQty] = useState<number>(0);

  const subCategories: { id: InventoryCategory | '전체', label: string, icon: any }[] = [
    { id: '완제품', label: '완제품', icon: Package },
    { id: '향미유', label: '향미유', icon: Grape },
    { id: '고춧가루', label: '고춧가루', icon: Tag },
    { id: '용기', label: '용기', icon: Cylinder },
    { id: '마개', label: '마개', icon: Disc },
    { id: '테이프', label: '테이프', icon: StickyNote },
    { id: '박스', label: '박스', icon: Inbox },
    { id: '라벨', label: '라벨', icon: Tag },
  ];

  const filteredProducts = useMemo(() => {
    let result: Product[] = [];
    if (activeTab === 'requests') {
      result = products.filter(p => orderRequests.some(r => r.id === p.id));
    } else if (activeTab === 'history') {
      result = products.filter(p => confirmedOrders.some(c => c.id === p.id));
    } else {
      result = products;
    }
    const isSupplierFilter = suppliers.some(s => s.id === activeSubCategory);
    if (activeSubCategory !== '전체') {
      if (isSupplierFilter) {
        result = result.filter(p => (p as any).supplierId === activeSubCategory);
      } else if (activeSubCategory === '박스') {
        result = result.filter(p => p.category === '박스' || p.id.startsWith('GS-'));
      } else {
        result = result.filter(p => p.category === activeSubCategory);
      }
    }
    if (searchTerm.trim()) {
      result = result.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    
    const CATEGORY_ORDER = ['완제품', '향미유', '고춧가루', '용기', '마개', '테이프', '박스', '라벨'];
    return [...result].sort((a, b) => {
      const aCritical = a.category !== '완제품' && a.stock < a.minStock ? 0 : 1;
      const bCritical = b.category !== '완제품' && b.stock < b.minStock ? 0 : 1;
      if (aCritical !== bCritical) return aCritical - bCritical;
      const aCatIdx = CATEGORY_ORDER.indexOf(a.category);
      const bCatIdx = CATEGORY_ORDER.indexOf(b.category);
      const aIdx = aCatIdx === -1 ? 99 : aCatIdx;
      const bIdx = bCatIdx === -1 ? 99 : bCatIdx;
      return aIdx - bIdx;
    });
  }, [products, activeTab, activeSubCategory, searchTerm, orderRequests, confirmedOrders, suppliers]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedProducts = filteredProducts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);



  // 원료별 현재 잔량 계산 (오래된 순으로 순방향 누적)
  const rawMaterialBalances = useMemo(() => {
    const result: Record<string, number> = {};
    for (const material of RAW_MATERIALS) {
      const entries = [
        ...rawMaterialLedger.filter(e => e.material === material),
        ...autoUsageEntries.filter(e => e.material === material).map(e => ({
          id: '', material: e.material, date: e.date,
          received: 0, used: e.used, note: e.note, createdAt: e.date,
        })),
      ].sort((a, b) => a.date.localeCompare(b.date));

      let balance = 0;
      for (const entry of entries) {
        if (entry.note === '전월이월') {
          balance = entry.received;
        } else {
          balance += entry.received - entry.used;
        }
      }
      result[material] = Math.round(balance * 1000) / 1000;
    }
    return result;
  }, [rawMaterialLedger, autoUsageEntries]);

  const updateDraftQty = (id: string, qty: number) => {
    setDraftOrders(prev => prev.map(d => d.id === id ? { ...d, quantity: Math.max(0, qty) } : d));
  };

  const removeFromDraft = (id: string) => {
    setDraftOrders(prev => prev.filter(d => d.id !== id));
    const next = new Set(selectedIds);
    next.delete(id);
    setSelectedIds(next);
  };

  const submitDraftToHistory = () => {
    if (draftOrders.length > 0) {
      onBulkAddConfirmedOrders(draftOrders);
      setDraftOrders([]);
      setSelectedIds(new Set());
      setActiveTab('history');
      alert('발주 확정되어 [발주 내역]으로 이동했습니다.');
    }
  };




  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500 h-full flex flex-col relative">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 uppercase">재고 및 물류 관리</h2>
          <p className="text-slate-500 text-sm font-medium">실시간 재고 현황을 파악하고 부족한 자재를 즉시 발주하세요.</p>
        </div>
        {/* 상위 탭 */}
        <div className="bg-slate-200/50 p-1.5 rounded-3xl flex items-center shadow-inner self-start border border-slate-200 shrink-0">
          <button
            onClick={() => setTopTab('product')}
            className={`px-5 py-2.5 rounded-2xl flex items-center space-x-2 transition-all text-xs font-black ${topTab === 'product' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Box size={16} />
            <span>상품·부자재</span>
          </button>
          <button
            onClick={() => setTopTab('rawmaterial')}
            className={`px-5 py-2.5 rounded-2xl flex items-center space-x-2 transition-all text-xs font-black ${topTab === 'rawmaterial' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Grape size={16} />
            <span>원료 재고</span>
          </button>
        </div>
        </div>
      </div>

      <div className="flex flex-col space-y-4">

        {/* 하위 탭 + 검색 */}
        {topTab === 'product' && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="bg-slate-100/50 p-1 rounded-2xl flex items-center self-start border border-slate-200">
              <button
                onClick={() => setActiveTab('master')}
                className={`px-5 py-2 rounded-xl flex items-center space-x-2 transition-all text-xs font-black ${activeTab === 'master' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Box size={16} />
                <span>재고 현황</span>
              </button>
              <button
                onClick={() => setActiveTab('requests')}
                className={`px-5 py-2 rounded-xl flex items-center space-x-2 transition-all text-xs font-black relative ${activeTab === 'requests' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <ClipboardCheck size={16} />
                <span>발주 내역</span>
                {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-rose-500 text-white w-5 h-5 flex items-center justify-center rounded-full text-[10px] shadow-lg">{cart.length}</span>}
              </button>
            </div>
            <div className="relative w-36 md:w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={15} />
              <input
                type="text"
                placeholder="품목 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-2xl pl-9 pr-4 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 shadow-sm transition-all"
              />
            </div>
          </div>
        )}

        {topTab === 'product' && <div className="flex flex-col gap-2">
          {/* 품목별 필터 */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => toggleFilterMode('category')}
              className={`flex items-center space-x-2 px-4 py-2.5 rounded-2xl border text-[11px] font-black transition-all ${filterMode === 'category' ? 'bg-indigo-50 border-indigo-200 text-indigo-600 ring-2 ring-indigo-50' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
            >
              <LayoutGrid size={14} />
              <span>품목별</span>
            </button>
            {filterMode === 'category' && subCategories.map((sub) => {
              const Icon = sub.icon;
              const isActive = activeSubCategory === sub.id;
              const count = categoryCounts[sub.id] || 0;
              return (
                <button
                  key={sub.id}
                  onClick={() => setActiveSubCategory(isActive ? '전체' : sub.id)}
                  className={`flex items-center space-x-2 px-4 py-2.5 rounded-2xl transition-all whitespace-nowrap border text-[11px] font-black uppercase relative ${isActive ? 'bg-white border-indigo-200 text-indigo-600 shadow-sm ring-2 ring-indigo-50' : 'bg-white border-slate-100 text-slate-400 hover:border-slate-300'}`}
                >
                  <Icon size={14} />
                  <span>{sub.label}</span>
                  {count > 0 && (
                    <span className="absolute -top-1 -right-1 bg-rose-500 text-white w-4 h-4 flex items-center justify-center rounded-full text-[9px] shadow-lg border border-white">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
          {/* 거래처별 필터 */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => toggleFilterMode('supplier')}
              className={`flex items-center space-x-2 px-4 py-2.5 rounded-2xl border text-[11px] font-black transition-all ${filterMode === 'supplier' ? 'bg-orange-50 border-orange-200 text-orange-500 ring-2 ring-orange-50' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
            >
              <Building2 size={14} />
              <span>거래처별</span>
            </button>
            {filterMode === 'supplier' && suppliers.map((supplier) => {
              const isActive = activeSubCategory === supplier.id;
              return (
                <button
                  key={supplier.id}
                  onClick={() => setActiveSubCategory(isActive ? '전체' : supplier.id)}
                  className={`flex items-center space-x-2 px-4 py-2.5 rounded-2xl transition-all whitespace-nowrap border text-[11px] font-black relative ${isActive ? 'bg-white border-orange-200 text-orange-500 shadow-sm ring-2 ring-orange-50' : 'bg-white border-slate-100 text-slate-400 hover:border-slate-300'}`}
                >
                  <Building2 size={14} />
                  <span>{supplier.name}</span>
                </button>
              );
            })}
          </div>
        </div>}
      </div>

      {topTab === 'product' && <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        {activeTab === 'requests' && draftOrders.length > 0 && (
          <div className="mb-8 bg-indigo-50/50 border border-indigo-100 rounded-[32px] p-6">
            <div className="flex items-center justify-between mb-6 px-2">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600">
                  <ListPlus size={18} />
                </div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">발주 확정 대기 리스트</h3>
                <span className="bg-indigo-200 text-indigo-800 text-[10px] font-black px-2 py-0.5 rounded-full">{draftOrders.length}</span>
              </div>
              <button 
                onClick={submitDraftToHistory}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
              >
                최종 발주 확정
              </button>
            </div>
            <div className="space-y-3">
              {draftOrders.map(draft => {
                const product = products.find(p => p.id === draft.id);
                if (!product) return null;
                return (
                  <div key={draft.id} className="bg-white border border-slate-100 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 shrink-0">
                        <Package size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-slate-800 truncate">{product.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">{product.category}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 sm:gap-8 justify-between sm:justify-end">
                      <div className="text-left sm:text-center">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-0.5">현재 재고</p>
                        <p className="text-sm font-black text-slate-900">
                          {product.category === '향미유' ? `${product.stock}B` : `${product.stock}${product.unit}`}
                        </p>
                      </div>

                      <div className="text-left sm:text-center">
                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter mb-0.5">발주 예정 수량</p>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={draft.quantity}
                            onChange={(e) => updateDraftQty(draft.id, parseInt(e.target.value) || 0)}
                            className="w-16 text-center text-sm font-black text-indigo-600 bg-white border border-indigo-100 rounded-lg py-1 outline-none focus:border-indigo-500"
                          />
                          <span className="text-[10px] font-black text-indigo-400">{product.unit}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => removeFromDraft(draft.id)}
                        className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all shrink-0"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* ── 재고 현황: 테이블 뷰 ── */}
        {activeTab === 'master' && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-4">
            <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">카테고리</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">품목명</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">현재 재고</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right hidden sm:table-cell">최소 수량</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center hidden sm:table-cell">상태</th>
                  <th className="px-4 py-3 hidden sm:table-cell"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pagedProducts.map(product => {
                  const isCritical = product.category !== '완제품' && product.stock < product.minStock;
                  const confInfo = confirmedOrders.find(c => c.id === product.id);
                  const inCart = cart.some(c => c.id === product.id);
                  const isExpanded = expandedRowId === product.id;
                  const statusBadge = product.category === '완제품' ? (
                    <span className="text-[9px] font-black text-slate-300">자체생산</span>
                  ) : confInfo ? (
                    <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full whitespace-nowrap">입고대기 {confInfo.quantity}{product.unit}</span>
                  ) : inCart ? (
                    <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full whitespace-nowrap">발주요청</span>
                  ) : isCritical ? (
                    <span className="text-[9px] font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">재고부족</span>
                  ) : (
                    <span className="text-[9px] font-black text-slate-300">정상</span>
                  );
                  return (
                    <React.Fragment key={product.id}>
                    <tr
                      className={`transition-colors cursor-pointer sm:cursor-default ${inCart ? 'bg-indigo-50/40' : isCritical ? 'bg-rose-50/30 hover:bg-rose-50/50' : 'hover:bg-slate-50/50'}`}
                      onClick={() => setExpandedRowId(isExpanded ? null : product.id)}
                    >
                      <td className="px-4 py-3">
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${
                          product.category === '완제품' ? 'bg-indigo-50 text-indigo-600' :
                          product.category === '향미유' ? 'bg-purple-50 text-purple-600' :
                          product.category === '고춧가루' ? 'bg-red-50 text-red-500' :
                          product.category === '용기' ? 'bg-sky-50 text-sky-600' :
                          product.category === '라벨' ? 'bg-amber-50 text-amber-600' :
                          product.category === '박스' ? 'bg-emerald-50 text-emerald-600' :
                          'bg-slate-100 text-slate-500'
                        }`}>{product.category}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-800">{product.name}</span>
                          {isCritical && <AlertCircle size={12} className="text-rose-500 shrink-0" />}
                          <button onClick={e => { e.stopPropagation(); onEditProduct(product); }} className="text-slate-200 hover:text-indigo-500 transition-all shrink-0 hidden sm:inline-flex">
                            <Edit size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editingStockId === product.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              autoFocus
                              type="number"
                              value={editingStockVal}
                              onChange={e => setEditingStockVal(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const val = parseInt(editingStockVal);
                                  if (!isNaN(val) && val >= 0) onUpdateProduct({ ...product, stock: val });
                                  setEditingStockId(null);
                                }
                                if (e.key === 'Escape') setEditingStockId(null);
                              }}
                              onBlur={() => {
                                const val = parseInt(editingStockVal);
                                if (!isNaN(val) && val >= 0) onUpdateProduct({ ...product, stock: val });
                                setEditingStockId(null);
                              }}
                              onClick={e => e.stopPropagation()}
                              className="w-20 text-right text-sm font-black border border-indigo-300 rounded-lg py-1 px-2 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                            />
                            <span className="text-[10px] text-slate-400">{product.category === '향미유' ? 'B' : product.unit}</span>
                          </div>
                        ) : (
                          <button
                            onClick={e => { e.stopPropagation(); setEditingStockId(product.id); setEditingStockVal(String(product.stock)); }}
                            className={`text-base font-black hover:underline hover:text-indigo-600 transition-colors cursor-pointer ${isCritical ? 'text-rose-600' : 'text-slate-800'}`}
                            title="클릭하여 수량 수정"
                          >
                            {product.stock}
                          </button>
                        )}
                        {editingStockId !== product.id && (
                          <span className="text-[10px] text-slate-400 ml-1">{product.category === '향미유' ? 'B' : product.unit}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell">
                        {product.category !== '완제품'
                          ? <span className="text-xs font-bold text-slate-400">{product.minStock} {product.unit}</span>
                          : <span className="text-[10px] text-slate-200">-</span>}
                      </td>
                      <td className="px-4 py-3 text-center hidden sm:table-cell">
                        {statusBadge}
                      </td>
                      <td className="px-3 py-3 text-right hidden sm:table-cell">
                        <div className="flex items-center justify-end gap-1.5">
                          {product.category !== '완제품' && (
                            inCart ? (
                              <button
                                onClick={e => { e.stopPropagation(); removeFromCart(product.id); }}
                                className="text-[10px] font-black px-2.5 py-1.5 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 transition-all shadow-sm"
                              >담김 ✓</button>
                            ) : inlineCartId === product.id ? (
                              <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                                <input
                                  autoFocus
                                  type="number"
                                  value={inlineCartQty}
                                  onChange={e => setInlineCartQty(parseInt(e.target.value) || 1)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') { addToCart(product.id, inlineCartQty); setInlineCartId(null); }
                                    if (e.key === 'Escape') setInlineCartId(null);
                                  }}
                                  className="w-14 text-center text-xs font-black border border-indigo-300 rounded-lg py-1 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                                />
                                <span className="text-[10px] text-slate-400">{product.unit}</span>
                                <button
                                  onClick={() => { addToCart(product.id, inlineCartQty); setInlineCartId(null); }}
                                  className="text-[10px] font-black px-2 py-1 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-all"
                                >담기</button>
                                <button onClick={() => setInlineCartId(null)} className="text-slate-300 hover:text-slate-500"><X size={12} /></button>
                              </div>
                            ) : (
                              <button
                                onClick={e => { e.stopPropagation(); setInlineCartId(product.id); setInlineCartQty(product.minStock * 2 || 20); }}
                                className="text-[10px] font-black px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all border border-slate-200"
                              >+ 담기</button>
                            )
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); setRowEditProduct(product); setRowEditForm({ name: product.name, category: product.category, stock: product.stock, minStock: product.minStock, unit: product.unit }); }}
                            className="text-[10px] font-black px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200 transition-all border border-slate-200"
                          >수정</button>
                        </div>
                      </td>
                    </tr>
                    {/* 모바일 펼침 행 */}
                    {isExpanded && (
                      <tr className="sm:hidden bg-slate-50/80">
                        <td colSpan={3} className="px-4 py-3">
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-slate-400 uppercase">최소수량</span>
                              <span className="text-xs font-bold text-slate-500">
                                {product.category !== '완제품' ? `${product.minStock} ${product.unit}` : '-'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-slate-400 uppercase">상태</span>
                              <div>{statusBadge}</div>
                            </div>
                            <div className="flex items-center gap-2 pt-1" onClick={e => e.stopPropagation()}>
                              {product.category !== '완제품' && (
                                inCart ? (
                                  <button
                                    onClick={() => removeFromCart(product.id)}
                                    className="flex-1 text-[11px] font-black py-2 rounded-xl bg-indigo-500 text-white"
                                  >담김 ✓</button>
                                ) : inlineCartId === product.id ? (
                                  <div className="flex-1 flex items-center gap-1">
                                    <input
                                      autoFocus
                                      type="number"
                                      value={inlineCartQty}
                                      onChange={e => setInlineCartQty(parseInt(e.target.value) || 1)}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') { addToCart(product.id, inlineCartQty); setInlineCartId(null); setExpandedRowId(null); }
                                        if (e.key === 'Escape') setInlineCartId(null);
                                      }}
                                      className="flex-1 text-center text-xs font-black border border-indigo-300 rounded-lg py-1.5 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                                    />
                                    <span className="text-[10px] text-slate-400">{product.unit}</span>
                                    <button
                                      onClick={() => { addToCart(product.id, inlineCartQty); setInlineCartId(null); setExpandedRowId(null); }}
                                      className="text-[11px] font-black px-3 py-1.5 rounded-xl bg-indigo-500 text-white"
                                    >담기</button>
                                    <button onClick={() => setInlineCartId(null)} className="text-slate-300"><X size={14} /></button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => { setInlineCartId(product.id); setInlineCartQty(product.minStock * 2 || 20); }}
                                    className="flex-1 text-[11px] font-black py-2 rounded-xl bg-slate-100 text-slate-500 border border-slate-200"
                                  >+ 발주담기</button>
                                )
                              )}
                              <button
                                onClick={() => { setRowEditProduct(product); setRowEditForm({ name: product.name, category: product.category, stock: product.stock, minStock: product.minStock, unit: product.unit }); setExpandedRowId(null); }}
                                className="flex-1 text-[11px] font-black py-2 rounded-xl bg-slate-100 text-slate-500 border border-slate-200"
                              >수정</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
                {pagedProducts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-300">
                        <Package size={32} strokeWidth={1.5} />
                        <p className="text-sm font-bold">등록된 품목이 없습니다</p>
                        <p className="text-xs font-medium">상단의 + 버튼으로 품목을 추가해보세요</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* ── 행 수정 모달 ── */}
        {rowEditProduct && (
          <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setRowEditProduct(null)} />
            <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-base font-black text-slate-900">품목 수정</h3>
                <button onClick={() => setRowEditProduct(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
              </div>
              <div className="p-5 space-y-4">
                {/* 카테고리 */}
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">카테고리</label>
                  <select
                    value={rowEditForm.category as string || ''}
                    onChange={e => setRowEditForm(f => ({ ...f, category: e.target.value as any }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  >
                    {['완제품','향미유','고춧가루','용기','마개','테이프','박스','라벨'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                {/* 품목명 */}
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">품목명</label>
                  <input
                    type="text"
                    value={rowEditForm.name || ''}
                    onChange={e => setRowEditForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  />
                </div>
                {/* 현재 재고 + 최소 수량 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">현재 재고</label>
                    <input
                      type="number"
                      value={rowEditForm.stock ?? ''}
                      onChange={e => setRowEditForm(f => ({ ...f, stock: parseInt(e.target.value) || 0 }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">최소 수량</label>
                    <input
                      type="number"
                      value={rowEditForm.minStock ?? ''}
                      onChange={e => setRowEditForm(f => ({ ...f, minStock: parseInt(e.target.value) || 0 }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                    />
                  </div>
                </div>
                {/* 단위 */}
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">단위</label>
                  <input
                    type="text"
                    value={rowEditForm.unit || ''}
                    onChange={e => setRowEditForm(f => ({ ...f, unit: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  />
                </div>
              </div>
              <div className="p-5 border-t border-slate-100 flex gap-2">
                <button
                  onClick={() => setConfirmModal({
                    message: `'${rowEditProduct.name}'을(를) 삭제하시겠습니까?`,
                    subMessage: '삭제 후 복구할 수 없습니다.',
                    onConfirm: () => { onDeleteProduct(rowEditProduct.id); setRowEditProduct(null); setConfirmModal(null); },
                  })}
                  className="px-4 py-2.5 bg-rose-50 text-rose-500 font-black rounded-xl text-xs hover:bg-rose-100 transition-all border border-rose-100 flex items-center gap-1"
                >
                  <Trash2 size={13} />삭제
                </button>
                <button onClick={() => setRowEditProduct(null)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm">취소</button>
                <button
                  onClick={() => {
                    onUpdateProduct({ ...rowEditProduct, ...rowEditForm } as Product);
                    setRowEditProduct(null);
                  }}
                  className="flex-1 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-sm hover:bg-indigo-700 transition-all"
                >저장</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 발주 내역 (카트 + 이력) ── */}
        {activeTab === 'requests' && (
          <div className="space-y-4 pb-32">
            {/* 장바구니 섹션 */}
            {cart.length > 0 && (
              <>
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShoppingCart size={16} className="text-indigo-500" />
                      <span className="font-black text-sm text-slate-800">발주 예정 목록</span>
                      <span className="text-[10px] font-black bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">{cart.length}건</span>
                    </div>
                    <button onClick={() => setCart([])} className="text-[10px] font-bold text-slate-400 hover:text-rose-500 transition-all">전체 비우기</button>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {cart.map(item => {
                      const product = products.find(p => p.id === item.id);
                      if (!product) return null;
                      return (
                        <div key={item.id} className="px-5 py-3 flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{product.name}</p>
                            <p className="text-[10px] text-slate-400">현재 재고 {product.stock} {product.unit}</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button onClick={() => updateCartQty(item.id, item.qty - 1)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-black transition-all">-</button>
                            <input
                              type="number"
                              value={item.qty}
                              onChange={e => updateCartQty(item.id, parseInt(e.target.value) || 1)}
                              className="w-14 text-center text-sm font-black border border-slate-200 rounded-xl py-1.5 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                            />
                            <button onClick={() => updateCartQty(item.id, item.qty + 1)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-black transition-all">+</button>
                            <span className="text-[11px] text-slate-400 w-6 shrink-0">{product.unit}</span>
                          </div>
                          <button onClick={() => removeFromCart(item.id)} className="text-slate-300 hover:text-rose-400 transition-all shrink-0 ml-1"><X size={15} /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <button
                  onClick={submitCart}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-sm font-black shadow-lg hover:bg-indigo-700 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                >
                  <ShoppingCart size={16} />
                  발주 확정 ({cart.length}건)
                </button>
              </>
            )}

            {/* 발주 내역 — 입고대기 목록 */}
            {confirmedOrders.length > 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-50">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck size={16} className="text-emerald-500" />
                    <span className="font-black text-sm text-slate-800">입고 대기</span>
                    <span className="text-[10px] font-black bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">{confirmedOrders.length}건</span>
                  </div>
                </div>
                <div className="divide-y divide-slate-50">
                  {confirmedOrders.map(conf => {
                    const product = products.find(p => p.id === conf.id);
                    if (!product) return null;
                    const isExpanded = expandedReqId === conf.id;
                    return (
                      <div key={conf.id}>
                        <div className="px-5 py-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{product.name}</p>
                            <p className="text-[10px] text-slate-400">{product.category}</p>
                          </div>
                          <span className="text-xs font-black text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-xl shrink-0">입고대기 {conf.quantity}{product.unit}</span>
                          <button
                            onClick={() => {
                              if (isExpanded) { setExpandedReqId(null); }
                              else { setExpandedReqId(conf.id); setReqEditQty(conf.quantity); setReqNote(''); }
                            }}
                            className={`text-[10px] font-black px-2.5 py-1.5 rounded-xl transition-all shrink-0 border ${isExpanded ? 'bg-slate-100 text-slate-500 border-slate-200' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'}`}
                          >{isExpanded ? '닫기' : '수정'}</button>
                          <button
                            onClick={() => onFinishConfirmedOrder(product.id)}
                            className="text-[10px] font-black px-2.5 py-1.5 rounded-xl bg-slate-800 text-white hover:bg-slate-900 transition-all shrink-0"
                          >입고확인</button>
                        </div>
                        {isExpanded && (
                          <div className="px-5 py-4 bg-slate-50/60 space-y-3 animate-in slide-in-from-top-1 duration-150">
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] font-black text-slate-500 w-16 shrink-0">수량 변경</span>
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => setReqEditQty(q => Math.max(1, q - 1))} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 font-black hover:bg-slate-100 transition-all">-</button>
                                <input
                                  type="number"
                                  value={reqEditQty}
                                  onChange={e => setReqEditQty(parseInt(e.target.value) || 1)}
                                  className="w-16 text-center text-sm font-black border border-slate-200 rounded-xl py-1.5 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                                />
                                <button onClick={() => setReqEditQty(q => q + 1)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 font-black hover:bg-slate-100 transition-all">+</button>
                                <span className="text-[11px] text-slate-400">{product.unit}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] font-black text-slate-500 w-16 shrink-0">사유</span>
                              <input
                                type="text"
                                value={reqNote}
                                onChange={e => setReqNote(e.target.value)}
                                placeholder="수량 수정 사유 (선택)"
                                className="flex-1 text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                              />
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => {
                                  onUpdateConfirmedQty(conf.id, reqEditQty);
                                  setExpandedReqId(null);
                                }}
                                className="flex-1 py-2 bg-white border border-indigo-200 text-indigo-600 rounded-xl text-xs font-black hover:bg-indigo-50 transition-all"
                              >수량 저장</button>
                              <button
                                onClick={() => { onFinishConfirmedOrder(conf.id); setExpandedReqId(null); }}
                                className="flex-1 py-2 bg-slate-800 text-white rounded-xl text-xs font-black hover:bg-slate-900 transition-all"
                              >입고 확인</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : cart.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 py-20 flex flex-col items-center justify-center gap-3 opacity-30">
                <ClipboardCheck size={40} />
                <p className="text-sm font-bold">발주 내역이 없습니다</p>
              </div>
            ) : null}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 py-5">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-white disabled:opacity-30 transition-all">←</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${safePage === p ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:bg-white'}`}>
                {p}
              </button>
            ))}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-white disabled:opacity-30 transition-all">→</button>
          </div>
        )}
      </div>}

      {/* 원료 재고 탭 */}
      {topTab === 'rawmaterial' && (
        <div className="space-y-4 animate-in slide-in-from-right-4 duration-500">
          {/* Bottom Sheet */}
          {showRmSheet && (
            <div className="fixed inset-0 z-[200] flex flex-col justify-end sm:justify-center sm:items-center">
              {/* 배경 */}
              <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowRmSheet(false)} />
              {/* 시트 */}
              <div className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
                {/* 핸들바 */}
                <div className="flex justify-center pt-3 pb-1 sm:hidden">
                  <div className="w-10 h-1 rounded-full bg-slate-200" />
                </div>
                {/* 헤더 */}
                <div className="px-5 pt-3 pb-0 flex items-center justify-between sm:pt-5">
                  <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                    <button
                      onClick={() => setRmSheetTab('new')}
                      className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${rmSheetTab === 'new' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >새 기록</button>
                    <button
                      onClick={() => setRmSheetTab('carryover')}
                      className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${rmSheetTab === 'carryover' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >전월이월</button>
                  </div>
                  <button onClick={() => setShowRmSheet(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl transition-all">
                    <X size={18} />
                  </button>
                </div>

                {/* 새 기록 탭 */}
                {rmSheetTab === 'new' && (
                  <div className="px-5 pt-4 pb-6 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">원료명</label>
                        <select value={rmMaterial} onChange={e => setRmMaterial(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400">
                          {RAW_MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">날짜</label>
                        <input type="date" value={rmDate} onChange={e => setRmDate(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400 cursor-pointer" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">입고량 (kg)</label>
                        <input type="number" placeholder="0" value={rmReceived} onChange={e => setRmReceived(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400" />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">사용량 (kg)</label>
                        <input type="number" placeholder="0" value={rmUsed} onChange={e => setRmUsed(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">비고</label>
                      <input type="text" placeholder="거래처명, 메모 등" value={rmNote} onChange={e => setRmNote(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400" />
                    </div>
                    {currentUser && (
                      <div className="flex items-center gap-2 px-1">
                        <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">작성자</span>
                        <span className="text-xs font-bold text-slate-500">{currentUser.name}</span>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        if (!rmDate) return;
                        onAddRawMaterialEntry({
                          id: `rm-${Date.now()}`,
                          material: rmMaterial,
                          date: rmDate,
                          received: Number(rmReceived) || 0,
                          used: Number(rmUsed) || 0,
                          note: rmNote,
                          createdAt: new Date().toISOString(),
                          addedBy: currentUser?.name,
                        });
                        setRmReceived(''); setRmUsed(''); setRmNote('');
                        setShowRmSheet(false);
                      }}
                      className="w-full py-3 bg-emerald-600 text-white rounded-2xl text-sm font-black hover:bg-emerald-700 active:scale-[0.99] transition-all"
                    >
                      추가
                    </button>
                  </div>
                )}

                {/* 전월이월 탭 */}
                {rmSheetTab === 'carryover' && (
                  <div className="px-5 pt-4 pb-6 space-y-3">
                    <p className="text-xs text-slate-400 font-bold">매월 1일 기준 전월 마감 잔량을 입력하세요.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">원료명</label>
                        <select value={rmOpenMaterial} onChange={e => setRmOpenMaterial(e.target.value)}
                          className="w-full bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-400">
                          {RAW_MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">기준일</label>
                        <input type="date" value={rmOpenDate} onChange={e => setRmOpenDate(e.target.value)}
                          className="w-full bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-400 cursor-pointer" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">전월 마감 잔량 (kg)</label>
                      <input type="number" placeholder="0" value={rmOpenBalance} onChange={e => setRmOpenBalance(e.target.value)}
                        className="w-full bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-amber-400" />
                    </div>
                    <button
                      onClick={() => {
                        if (!rmOpenDate || !rmOpenBalance) return;
                        onAddRawMaterialEntry({
                          id: `rm-open-${Date.now()}`,
                          material: rmOpenMaterial,
                          date: rmOpenDate,
                          received: Number(rmOpenBalance),
                          used: 0,
                          note: '전월이월',
                          createdAt: new Date().toISOString(),
                        });
                        setRmOpenBalance('');
                        setShowRmSheet(false);
                      }}
                      className="w-full py-3 bg-amber-500 text-white rounded-2xl text-sm font-black hover:bg-amber-600 active:scale-[0.99] transition-all"
                    >
                      전월이월 저장
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 헤더: 기록 추가 버튼 */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">원료별 현재고</p>
            <button
              onClick={() => { setRmSheetTab('new'); setShowRmSheet(true); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 active:scale-95 transition-all shadow-sm"
            >
              <span className="text-base leading-none">+</span> 기록 추가
            </button>
          </div>

          {/* 원료별 잔량 요약 카드 */}
          <div className="overflow-x-auto pb-1 no-scrollbar">
            <div className="flex gap-2 min-w-max">
              {RAW_MATERIALS.map(m => {
                const bal = rawMaterialBalances[m] ?? 0;
                const hasData = rawMaterialLedger.some(e => e.material === m);
                if (!hasData) return null;
                const isLow = bal < 20;
                return (
                  <button
                    key={m}
                    onClick={() => setRmFilter(m)}
                    className={`flex flex-col items-start px-4 py-3 rounded-2xl border transition-all min-w-[110px] ${
                      rmFilter === m
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-md'
                        : isLow
                        ? 'bg-rose-50 border-rose-200 text-slate-700 hover:border-rose-400'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-emerald-300 hover:shadow-sm'
                    }`}
                  >
                    <span className={`text-[10px] font-black uppercase tracking-wide truncate w-full text-left ${rmFilter === m ? 'text-emerald-100' : isLow ? 'text-rose-400' : 'text-slate-400'}`}>
                      {m}
                    </span>
                    <span className={`text-lg font-black mt-0.5 leading-tight ${rmFilter === m ? 'text-white' : isLow ? 'text-rose-600' : 'text-slate-800'}`}>
                      {bal.toLocaleString('ko-KR')}
                      <span className={`text-[10px] font-bold ml-0.5 ${rmFilter === m ? 'text-emerald-200' : 'text-slate-400'}`}>kg</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 필터 — 가로 스크롤 chip */}
          <div className="flex items-center gap-2">
            <div className="overflow-x-auto no-scrollbar flex-1">
              <div className="flex gap-1.5 min-w-max">
                {['전체', ...RAW_MATERIALS].map(m => (
                  <button key={m} onClick={() => setRmFilter(m)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-all border whitespace-nowrap ${
                      rmFilter === m
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                    }`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {/* select 병행 - 모바일에서 빠른 선택용 */}
            <select
              value={rmFilter}
              onChange={e => setRmFilter(e.target.value)}
              className="shrink-0 bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-[11px] font-black outline-none focus:border-emerald-400 sm:hidden"
            >
              {['전체', ...RAW_MATERIALS].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* 테이블: 전재고+입고-사용=현재고 */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {rmFilter === '전체' && <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">원료명</th>}
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">날짜</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">전재고</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">입고량</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">사용량</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">현재고</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">비고</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest hidden sm:table-cell">작성자</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(() => {
                  // auto 사용량 항목 (isAuto: true, id 없음)
                  type DisplayEntry = { id?: string; material: string; date: string; received: number; used: number; note: string; isAuto: boolean; addedBy?: string };
                  const manualEntries: DisplayEntry[] = (rmFilter === '전체' ? rawMaterialLedger : rawMaterialLedger.filter(e => e.material === rmFilter))
                    .map(e => ({ id: e.id, material: e.material, date: e.date, received: e.received, used: e.used, note: e.note, isAuto: false, addedBy: e.addedBy }));
                  const autoEntries: DisplayEntry[] = (rmFilter === '전체' ? autoUsageEntries : autoUsageEntries.filter(e => e.material === rmFilter))
                    .map(e => ({ material: e.material, date: e.date, received: 0, used: e.used, note: e.note, isAuto: true }));
                  const sorted = [...manualEntries, ...autoEntries].sort((a, b) => b.date.localeCompare(a.date) || (a.isAuto ? 1 : -1));

                  // 특정 원료 선택 시 running balance 계산
                  if (rmFilter !== '전체') {
                    let balance = 0;
                    return sorted.map((entry, idx) => {
                      const isOpen = !entry.isAuto && entry.note === '전월이월';
                      if (isOpen) {
                        balance = entry.received;
                        return (
                          <tr key={entry.id || `auto-${idx}`} className="hover:bg-amber-50 bg-amber-50/50 transition-colors">
                            <td className="px-4 py-2.5 text-[11px] font-bold text-slate-500">{entry.date}</td>
                            <td className="px-4 py-2.5 text-[11px] font-black text-amber-600 text-right">{entry.received}</td>
                            <td className="px-4 py-2.5 text-[11px] text-slate-300 text-right">-</td>
                            <td className="px-4 py-2.5 text-[11px] text-slate-300 text-right">-</td>
                            <td className="px-4 py-2.5 text-[11px] font-black text-amber-600 text-right">{entry.received}</td>
                            <td className="px-4 py-2.5 text-[11px] text-amber-500 font-bold">전월이월</td>
                            <td className="px-4 py-2.5 hidden sm:table-cell">
                              {entry.addedBy && <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md">{entry.addedBy}</span>}
                            </td>
                            <td className="px-4 py-2.5">
                              {entry.id && <button onClick={() => setConfirmModal({
                                  message: '이 기록을 삭제하시겠습니까?',
                                  subMessage: `${entry.material} · ${entry.date} · ${entry.received}kg (전월이월)`,
                                  onConfirm: () => { onDeleteRawMaterialEntry(entry.id!); setConfirmModal(null); },
                                })}
                                className="p-1 text-slate-300 hover:text-rose-400 hover:bg-rose-50 rounded transition-all">
                                <Trash2 size={12} />
                              </button>}
                            </td>
                          </tr>
                        );
                      }
                      const prev = Math.round(balance * 1000) / 1000;
                      balance += entry.received - entry.used;
                      const curr = Math.round(balance * 1000) / 1000;
                      return (
                        <tr key={entry.id || `auto-${idx}`} className={`transition-colors ${entry.isAuto ? 'hover:bg-indigo-50/30 bg-indigo-50/10' : 'hover:bg-slate-50'}`}>
                          <td className="px-4 py-2.5 text-[11px] font-bold text-slate-500">{entry.date}</td>
                          <td className="px-4 py-2.5 text-[11px] text-slate-400 text-right">{prev}</td>
                          <td className="px-4 py-2.5 text-[11px] font-black text-indigo-600 text-right">{entry.received > 0 ? `+${entry.received}` : '-'}</td>
                          <td className="px-4 py-2.5 text-[11px] font-black text-rose-500 text-right">{entry.used > 0 ? `-${entry.used}` : '-'}</td>
                          <td className="px-4 py-2.5 text-[11px] font-black text-slate-800 text-right">{curr}</td>
                          <td className="px-4 py-2.5 text-[11px] text-slate-500">
                            {entry.isAuto
                              ? <span className="text-indigo-400">{entry.note}</span>
                              : (entry.note || '-')}
                          </td>
                          <td className="px-4 py-2.5 hidden sm:table-cell">
                            {entry.addedBy
                              ? <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md">{entry.addedBy}</span>
                              : entry.isAuto ? <span className="text-[10px] text-slate-200">자동</span> : null}
                          </td>
                          <td className="px-4 py-2.5">
                            {!entry.isAuto && entry.id && <button onClick={() => setConfirmModal({
                                message: '이 기록을 삭제하시겠습니까?',
                                subMessage: `${entry.date} · 입고 ${entry.received > 0 ? entry.received + 'kg' : '-'} / 사용 ${entry.used > 0 ? entry.used + 'kg' : '-'}${entry.note ? ' · ' + entry.note : ''}`,
                                onConfirm: () => { onDeleteRawMaterialEntry(entry.id!); setConfirmModal(null); },
                              })}
                              className="p-1 text-slate-300 hover:text-rose-400 hover:bg-rose-50 rounded transition-all">
                              <Trash2 size={12} />
                            </button>}
                          </td>
                        </tr>
                      );
                    });
                  }
                  // 전체 필터: 원료명 표시, 전재고/현재고 없음
                  return sorted.map((entry, idx) => (
                    <tr key={entry.id || `auto-${idx}`} className={`transition-colors ${entry.isAuto ? 'hover:bg-indigo-50/30 bg-indigo-50/10' : 'hover:bg-slate-50'}`}>
                      <td className="px-4 py-2.5"><span className="text-[11px] font-black text-slate-800 bg-emerald-50 px-2 py-0.5 rounded-lg">{entry.material}</span></td>
                      <td className="px-4 py-2.5 text-[11px] font-bold text-slate-500">{entry.date}</td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-300 text-right">-</td>
                      <td className="px-4 py-2.5 text-[11px] font-black text-indigo-600 text-right">{entry.received > 0 ? `+${entry.received}` : '-'}</td>
                      <td className="px-4 py-2.5 text-[11px] font-black text-rose-500 text-right">{entry.used > 0 ? `-${entry.used}` : '-'}</td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-300 text-right">-</td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-500">
                        {entry.isAuto
                          ? <span className="text-indigo-400">{entry.note}</span>
                          : (entry.note || '-')}
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell">
                        {entry.addedBy
                          ? <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md">{entry.addedBy}</span>
                          : entry.isAuto ? <span className="text-[10px] text-slate-200">자동</span> : null}
                      </td>
                      <td className="px-4 py-2.5">
                        {!entry.isAuto && entry.id && <button onClick={() => setConfirmModal({
                            message: '이 기록을 삭제하시겠습니까?',
                            subMessage: `${entry.material} · ${entry.date} · 입고 ${entry.received > 0 ? entry.received + 'kg' : '-'} / 사용 ${entry.used > 0 ? entry.used + 'kg' : '-'}${entry.note ? ' · ' + entry.note : ''}`,
                            onConfirm: () => { onDeleteRawMaterialEntry(entry.id!); setConfirmModal(null); },
                          })}
                          className="p-1 text-slate-300 hover:text-rose-400 hover:bg-rose-50 rounded transition-all">
                          <Trash2 size={12} />
                        </button>}
                      </td>
                    </tr>
                  ));
                })()}
                {rawMaterialLedger.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-300 text-sm font-bold">기록이 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Draft Orders Floating Button removed as requested */}

      {/* ── 플로팅 카트 아이콘 ── */}
      {topTab === 'product' && cart.length > 0 && (
        <button
          onClick={() => setShowCartPanel(true)}
          className="fixed bottom-8 right-6 z-40 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded-2xl shadow-xl transition-all active:scale-95 animate-in fade-in zoom-in-95 duration-300"
        >
          <ShoppingCart size={20} />
          <span className="font-black text-sm">발주 내역</span>
          <span className="w-6 h-6 bg-white text-indigo-600 text-xs font-black rounded-full flex items-center justify-center shadow-sm">{cart.length}</span>
        </button>
      )}

      {/* ── 발주 장바구니 패널 ── */}
      {showCartPanel && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setShowCartPanel(false)} />
          <div className="relative bg-white w-full max-w-sm h-full flex flex-col shadow-2xl animate-in slide-in-from-right-4 duration-300">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-indigo-600 text-white"><ShoppingCart size={18} /></div>
                <div>
                  <h3 className="font-black text-slate-900">발주 내역</h3>
                  <p className="text-[11px] text-slate-400 font-medium">{cart.length}개 품목</p>
                </div>
              </div>
              <button onClick={() => setShowCartPanel(false)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 transition-all">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full opacity-30 gap-3">
                  <ShoppingCart size={36} />
                  <p className="text-sm font-bold">담긴 품목이 없습니다</p>
                </div>
              ) : cart.map(item => {
                const product = products.find(p => p.id === item.id);
                if (!product) return null;
                return (
                  <div key={item.id} className="bg-slate-50 rounded-2xl border border-slate-100 p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{product.name}</p>
                      <p className="text-[10px] text-slate-400 font-medium">현재 재고 {product.stock}{product.unit}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => updateCartQty(item.id, item.qty - 1)} className="w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 text-sm font-black transition-all">-</button>
                      <input
                        type="number"
                        value={item.qty}
                        onChange={e => updateCartQty(item.id, parseInt(e.target.value) || 1)}
                        className="w-12 text-center text-sm font-black border border-slate-200 rounded-lg py-1 outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                      />
                      <button onClick={() => updateCartQty(item.id, item.qty + 1)} className="w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 text-sm font-black transition-all">+</button>
                      <span className="text-[10px] text-slate-400 w-6">{product.unit}</span>
                    </div>
                    <button onClick={() => removeFromCart(item.id)} className="text-slate-300 hover:text-rose-400 transition-all shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="p-4 border-t border-slate-100 space-y-2">
              <button
                disabled={cart.length === 0}
                onClick={submitCart}
                className="w-full py-3.5 bg-indigo-600 text-white rounded-2xl text-sm font-black shadow-lg hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-2"
              >
                <ShoppingCart size={16} />
                발주 확정 ({cart.length}건)
              </button>
              <button
                onClick={() => setCart([])}
                className="w-full py-2.5 text-xs font-bold text-slate-400 hover:text-slate-600 transition-all"
              >전체 비우기</button>
            </div>
          </div>
        </div>
      )}

      {isAddModalOpen && (
        <AddProductModal onClose={() => setIsAddModalOpen(false)} onSave={(newProduct) => { onAddProduct(newProduct); setIsAddModalOpen(false); }} />
      )}

      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          subMessage={confirmModal.subMessage}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {adjustmentModal?.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8">
              <div className="flex items-center space-x-4 mb-6">
                <div className="p-3 bg-amber-50 rounded-2xl text-amber-500">
                  <AlertCircle size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900">수량 변동 및 취소 요청</h3>
                  <p className="text-sm text-slate-500 font-medium">{adjustmentModal.productName}</p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="text-xs font-bold text-slate-500">기존 입고 예정 수량</span>
                  <span className="text-lg font-black text-slate-900">{adjustmentModal.originalQuantity}</span>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">요청 유형</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => setAdjustmentModal({...adjustmentModal, type: 'quantity_change'})}
                      className={`py-3 rounded-xl text-xs font-black border transition-all ${
                        adjustmentModal.type === 'quantity_change' 
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' 
                          : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      수량 변경
                    </button>
                    <button 
                      onClick={() => setAdjustmentModal({...adjustmentModal, type: 'cancel_receipt'})}
                      className={`py-3 rounded-xl text-xs font-black border transition-all ${
                        adjustmentModal.type === 'cancel_receipt' 
                          ? 'bg-rose-500 border-rose-500 text-white shadow-lg' 
                          : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      입고 취소
                    </button>
                  </div>
                </div>

                {adjustmentModal.type === 'quantity_change' && (
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">변경할 수량</label>
                    <div className="flex items-center space-x-3 bg-slate-50 border border-slate-200 p-2 rounded-2xl">
                      <input 
                        type="number" 
                        value={adjustmentQty}
                        onChange={(e) => setAdjustmentQty(parseInt(e.target.value) || 0)}
                        className="flex-1 bg-transparent text-center font-black text-lg outline-none"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">변동 사유</label>
                  <textarea 
                    value={adjustmentReason}
                    onChange={(e) => setAdjustmentReason(e.target.value)}
                    placeholder="사유를 입력해주세요 (예: 오발주, 수량 오기입 등)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-medium outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all h-24 resize-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-8">
                <button 
                  onClick={() => setAdjustmentModal(null)}
                  className="py-4 bg-slate-100 text-slate-500 rounded-2xl text-sm font-black hover:bg-slate-200 transition-all"
                >
                  닫기
                </button>
                <button 
                  disabled={!adjustmentReason.trim()}
                  onClick={() => {
                    onAddAdjustmentRequest({
                      id: `ADJ-${Date.now()}`,
                      productId: adjustmentModal.productId,
                      productName: adjustmentModal.productName,
                      originalQuantity: adjustmentModal.originalQuantity,
                      requestedQuantity: adjustmentModal.type === 'quantity_change' ? adjustmentQty : 0,
                      type: adjustmentModal.type,
                      reason: adjustmentReason,
                      status: 'pending',
                      requestedAt: new Date().toISOString()
                    });
                    setAdjustmentModal(null);
                    alert('변동 요청이 관리자에게 전달되었습니다.');
                  }}
                  className="py-4 bg-indigo-600 text-white rounded-2xl text-sm font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  요청 전송
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductList;
