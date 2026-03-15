
import React, { useState, useMemo } from 'react';
import {
  Package,
  Plus,
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
  CheckCircle,
  Search,
  LayoutGrid,
  ListPlus,
  AlertCircle,
  RotateCcw,
  Tag,
  RefreshCw,
  Building2
} from 'lucide-react';
import { Product, InventoryCategory, AdjustmentRequest, AdjustmentType, RawMaterialEntry } from '../types';
import AddProductModal from './AddProductModal';

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
  onAddAdjustmentRequest: (req: AdjustmentRequest) => void;
  suppliers: { id: string; name: string }[];
  rawMaterialLedger: RawMaterialEntry[];
  autoUsageEntries?: Array<{ material: string; date: string; used: number; note: string }>;
  onAddRawMaterialEntry: (entry: RawMaterialEntry) => void;
  onDeleteRawMaterialEntry: (id: string) => void;
}

const RAW_MATERIALS = ['참깨','들깨','검정깨','탈피들깨가루','깨분','볶음참깨','볶음들깨','볶음검정참깨','통깨참기름','깨분참기름','통들깨들기름','수입들기름'];

type MainTab = 'requests' | 'history' | 'master';
type TopTab = 'product' | 'rawmaterial';

const ProductList: React.FC<ProductListProps> = ({
  products,
  orderRequests,
  confirmedOrders,
  onAddProduct,
  onAddOrderRequest,
  onRemoveOrderRequest,
  onUpdateOrderRequestQty,
  onToggleConfirmRequestQty,
  onBulkAddConfirmedOrders,
  onFinishConfirmedOrder,
  onEditProduct,
  onAddAdjustmentRequest,
  suppliers,
  rawMaterialLedger,
  autoUsageEntries = [],
  onAddRawMaterialEntry,
  onDeleteRawMaterialEntry,
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
  const [activeSubCategory, setActiveSubCategory] = useState<InventoryCategory | '전체' | string>('전체');
  const [filterMode, setFilterMode] = useState<null | 'supplier' | 'category'>(null);

  const toggleFilterMode = (mode: 'supplier' | 'category') => {
    setFilterMode(prev => prev === mode ? null : mode);
    setActiveSubCategory('전체');
  };
  const [searchTerm, setSearchTerm] = useState('');
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draftOrders, setDraftOrders] = useState<{ id: string, quantity: number }[]>([]);
  
  const [requestingProductId, setRequestingProductId] = useState<string | null>(null);
  const [requestingQty, setRequestingQty] = useState<number>(0);

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
    { id: '전체', label: '전체 품목', icon: LayoutGrid },
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
    
    // 현재고가 0이 아닌 품목을 위쪽으로 정렬
    return [...result].sort((a, b) => {
      if (a.stock > 0 && b.stock === 0) return -1;
      if (a.stock === 0 && b.stock > 0) return 1;
      return 0;
    });
  }, [products, activeTab, activeSubCategory, searchTerm, orderRequests, confirmedOrders, suppliers]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedProducts = filteredProducts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);



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

  const startRequestInput = (product: Product) => {
    setRequestingProductId(product.id);
    setRequestingQty(product.minStock * 2 || 20);
  };

  const cancelRequestInput = () => {
    setRequestingProductId(null);
  };

  const confirmRequestInput = (id: string) => {
    onAddOrderRequest(id, requestingQty);
    setRequestingProductId(null);
  };

  const moveRequestToDraft = (req: OrderRequest) => {
    setDraftOrders(prev => {
      const exists = prev.find(d => d.id === req.id);
      if (exists) {
        return prev.map(d => d.id === req.id ? { ...d, quantity: d.quantity + req.quantity } : d);
      }
      return [...prev, { id: req.id, quantity: req.quantity }];
    });
    setSelectedIds(prev => new Set(prev).add(req.id));
    onRemoveOrderRequest(req.id);
  };



  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500 h-full flex flex-col relative">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 uppercase">재고 및 물류 관리</h2>
          <p className="text-slate-500 text-sm font-medium">실시간 재고 현황을 파악하고 부족한 자재를 즉시 발주하세요.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button 
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center justify-center space-x-2 bg-indigo-600 text-white px-6 py-3.5 rounded-2xl font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
          >
            <Plus size={20} />
            <span>품목 추가</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col space-y-4">
        {/* 상위 탭 */}
        <div className="bg-slate-200/50 p-1.5 rounded-3xl flex items-center shadow-inner self-start border border-slate-200">
          <button
            onClick={() => setTopTab('product')}
            className={`px-6 py-3 rounded-2xl flex items-center space-x-2.5 transition-all text-xs font-black ${topTab === 'product' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Box size={18} />
            <span>상품 및 부자재 재고</span>
          </button>
          <button
            onClick={() => setTopTab('rawmaterial')}
            className={`px-6 py-3 rounded-2xl flex items-center space-x-2.5 transition-all text-xs font-black ${topTab === 'rawmaterial' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Grape size={18} />
            <span>원료 재고</span>
          </button>
        </div>

        {/* 하위 탭 (상품 및 부자재 재고 선택 시) */}
        {topTab === 'product' && (
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
              className={`px-5 py-2 rounded-xl flex items-center space-x-2 transition-all text-xs font-black relative ${activeTab === 'requests' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <ShoppingCart size={16} />
              <span>발주 요청</span>
              {orderRequests.length > 0 && <span className="absolute -top-1 -right-1 bg-rose-500 text-white w-5 h-5 flex items-center justify-center rounded-full text-[10px] shadow-lg">{orderRequests.length}</span>}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-5 py-2 rounded-xl flex items-center space-x-2 transition-all text-xs font-black ${activeTab === 'history' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <ClipboardCheck size={16} />
              <span>발주 내역</span>
              {confirmedOrders.length > 0 && <span className="ml-2 bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full text-[10px]">{confirmedOrders.length}</span>}
            </button>
          </div>
        )}

        {topTab === 'product' && <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => toggleFilterMode('supplier')}
              className={`flex items-center space-x-2 px-4 py-2.5 rounded-2xl border text-[11px] font-black transition-all ${filterMode === 'supplier' ? 'bg-orange-50 border-orange-200 text-orange-500 ring-2 ring-orange-50' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
            >
              <Building2 size={14} />
              <span>거래처별</span>
            </button>
            <button
              onClick={() => toggleFilterMode('category')}
              className={`flex items-center space-x-2 px-4 py-2.5 rounded-2xl border text-[11px] font-black transition-all ${filterMode === 'category' ? 'bg-indigo-50 border-indigo-200 text-indigo-600 ring-2 ring-indigo-50' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
            >
              <LayoutGrid size={14} />
              <span>품목별</span>
            </button>
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
          {filterMode === 'supplier' && (
            <div className="flex flex-wrap gap-2 animate-in fade-in duration-150">
              {suppliers.map((supplier) => {
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
          )}
          {filterMode === 'category' && (
            <div className="flex flex-wrap gap-2 animate-in fade-in duration-150">
              {subCategories.map((sub) => {
                const Icon = sub.icon;
                const isActive = activeSubCategory === sub.id;
                const count = sub.id === '전체' ? orderRequests.length : categoryCounts[sub.id] || 0;
                return (
                  <button
                    key={sub.id}
                    onClick={() => setActiveSubCategory(sub.id)}
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
          )}
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
                  <div key={draft.id} className="bg-white border border-slate-100 rounded-2xl p-4 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center space-x-4 flex-1 min-w-0">
                      <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 shrink-0">
                        <Package size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-slate-800 truncate">{product.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">{product.category}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-12 ml-6">
                      <div className="text-center w-24">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-0.5">현재 재고</p>
                        <p className="text-sm font-black text-slate-900">
                          {product.category === '향미유' ? `${product.stock}B` : `${product.stock}${product.unit}`}
                        </p>
                      </div>
                      
                      <div className="text-center w-32">
                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter mb-0.5">발주 예정 수량</p>
                        <div className="flex items-center justify-center space-x-2">
                           <div className="flex items-center space-x-1">
                             <input 
                               type="number"
                               value={draft.quantity}
                               onChange={(e) => updateDraftQty(draft.id, parseInt(e.target.value) || 0)}
                               className="w-16 text-center text-sm font-black text-indigo-600 bg-white border border-indigo-100 rounded-lg py-1 outline-none focus:border-indigo-500"
                             />
                             <span className="text-[10px] font-black text-indigo-400">{product.unit}</span>
                           </div>
                        </div>
                      </div>

                      <button 
                        onClick={() => removeFromDraft(draft.id)}
                        className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
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
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3 pb-32">
          {pagedProducts.map((product) => {
            const isSelected = selectedIds.has(product.id);
            const reqInfo = orderRequests.find(r => r.id === product.id);
            const confInfo = confirmedOrders.find(c => c.id === product.id);
            const isCritical = product.category !== '완제품' && product.stock < product.minStock;
            
            const isAlreadyRequested = !!reqInfo;
            const isAlreadyConfirmed = !!confInfo;
            const isRequestingNow = requestingProductId === product.id;

            return (
              <div 
                key={product.id} 
                className={`bg-white rounded-2xl shadow-sm border transition-all duration-300 flex flex-col h-full relative group/card ${
                  isSelected ? 'ring-4 ring-indigo-500/20 border-indigo-500 shadow-xl scale-[1.02] z-10' : 'border-slate-100 hover:border-indigo-200'
                }`}
              >
                <div className={`p-3 flex flex-col items-center justify-center border-b transition-colors relative pt-8 ${isSelected ? 'bg-indigo-50 border-indigo-100' : 'bg-slate-50/50 border-slate-100'}`}>
                   <div className="absolute top-2 left-3 text-[7px] font-black px-1.5 py-0.5 rounded-full bg-white border border-slate-200 text-slate-400 uppercase tracking-widest shadow-sm">
                      {product.category}
                   </div>
                   <button
                     onClick={(e) => { e.stopPropagation(); onEditProduct(product); }}
                     className="absolute top-2 right-3 p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                   >
                     <Edit size={12} />
                   </button>
                   {isCritical && (
                     <div className="absolute top-0 left-1/2 -translate-x-1/2 flex items-center space-x-1 px-2 py-0.5 bg-rose-600 text-white rounded-b-xl text-[9px] font-black shadow-lg z-20">
                        <AlertCircle size={10} />
                        <span>재고 부족</span>
                     </div>
                   )}
                   <div className="h-8 flex items-center justify-center w-full">
                     <h3 className={`font-black text-center px-2 leading-tight text-xs line-clamp-2 ${isSelected ? 'text-indigo-900' : 'text-slate-800'}`}>{product.name}</h3>
                   </div>
                </div>

                <div className="p-3 space-y-2">
                  <div className={`flex flex-col items-center justify-center p-2 rounded-xl ${isCritical ? 'bg-rose-50 border border-rose-100' : 'bg-slate-50 border border-slate-100'}`}>
                    <span className={`text-[7px] font-black uppercase tracking-tighter mb-0.5 ${isCritical ? 'text-rose-400' : 'text-slate-400'}`}>현재 재고</span>
                    <div className="flex items-baseline space-x-1">
                      <span className={`text-lg font-black ${isCritical ? 'text-rose-600' : 'text-slate-900'}`}>{product.stock}</span>
                      <span className={`text-[9px] font-bold ${isCritical ? 'text-rose-400' : 'text-slate-400'}`}>{product.category === '향미유' ? 'B' : product.unit}</span>
                    </div>
                    {product.category !== '완제품' && (
                      <div className="mt-0.5 pt-0.5 border-t border-slate-200/50 w-full flex justify-center items-center space-x-1.5">
                        <span className="text-[7px] font-black text-slate-300 uppercase tracking-tighter">최소</span>
                        <span className="text-[9px] font-black text-amber-600">{product.minStock}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5 min-h-[24px]">
                    {isAlreadyConfirmed && activeTab !== 'history' && (
                      <div className="flex items-center space-x-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100 shadow-sm animate-in zoom-in-95">
                        <CheckCircle size={10} />
                        <span className="text-[9px] font-black">확정: {confInfo.quantity}{product.unit}</span>
                      </div>
                    )}
                    {isAlreadyRequested && activeTab !== 'history' && (
                      <div className="flex items-center gap-1 w-full animate-in zoom-in-95">
                        <div className={`flex items-center space-x-1 px-2 py-1 rounded-lg border ${reqInfo.confirmedByUser ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                          <ShoppingCart size={10} />
                          <span className="text-[9px] font-black">{reqInfo.confirmedByUser ? '확정' : '요청'}: {reqInfo.quantity}{product.unit}</span>
                        </div>
                        {activeTab === 'requests' && (
                          <button
                            onClick={() => onRemoveOrderRequest(product.id)}
                            className="ml-auto p-1 text-rose-400 hover:bg-rose-50 rounded-lg transition-all"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="pt-1">
                    {activeTab === 'master' && (
                      product.category === '완제품' ? (
                        <div className="py-2 text-center text-[8px] font-black text-slate-300 uppercase tracking-widest bg-slate-50/50 rounded-xl border border-slate-100/50">
                          자체 생산
                        </div>
                      ) : isRequestingNow ? (
                        <div className="space-y-2 animate-in fade-in duration-300">
                          <div className="flex items-center justify-center bg-white rounded-xl p-1.5 border border-amber-200 shadow-inner">
                            <div className="flex items-center space-x-1 font-black">
                              <input 
                                type="number" 
                                value={requestingQty}
                                onChange={(e) => setRequestingQty(parseInt(e.target.value) || 0)}
                                className="w-20 text-center text-xs outline-none text-slate-800 bg-transparent"
                              />
                              <span className="text-[8px] text-slate-400">{product.unit}</span>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <button onClick={cancelRequestInput} className="py-2 rounded-xl text-[8px] font-black uppercase bg-slate-100 text-slate-400 hover:bg-slate-200 transition-all">취소</button>
                            <button onClick={() => confirmRequestInput(product.id)} className="py-2 rounded-xl text-[8px] font-black uppercase bg-amber-600 text-white shadow-lg shadow-amber-100 hover:bg-amber-700 active:scale-95 transition-all">확정</button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {isAlreadyRequested ? (
                            <button 
                              onClick={() => onRemoveOrderRequest(product.id)}
                              className="flex items-center justify-center space-x-1 py-2 rounded-xl text-[8px] font-black uppercase transition-all bg-rose-50 text-rose-500 border border-rose-100 hover:bg-rose-500 hover:text-white col-span-2"
                            >
                              <RotateCcw size={12} />
                              <span>요청 취소</span>
                            </button>
                          ) : (
                            <button 
                              disabled={isAlreadyConfirmed}
                              onClick={() => startRequestInput(product)}
                              className={`flex items-center justify-center space-x-1 py-2 rounded-xl text-[8px] font-black uppercase transition-all border col-span-2 ${
                                isAlreadyConfirmed 
                                  ? 'bg-slate-50 border-slate-100 text-slate-300' 
                                  : 'bg-amber-50 border-amber-100 text-amber-600 hover:bg-amber-500 hover:text-white shadow-sm'
                              }`}
                            >
                              <ShoppingCart size={12} />
                              <span>발주 요청</span>
                            </button>
                          )}
                        </div>
                      )
                    )}

                    {activeTab === 'requests' && reqInfo && (
                      <div className="flex flex-col space-y-2">
                        <div className="flex items-center space-x-2 bg-white border border-slate-200 p-1 rounded-xl shadow-inner">
                          <div className="flex-1 text-center">
                             <input
                                type="number"
                                value={reqInfo.quantity}
                                onChange={(e) => onUpdateOrderRequestQty(product.id, parseInt(e.target.value) || 0)}
                                className="w-14 text-center font-black text-xs outline-none text-slate-800 bg-transparent"
                             />
                             <span className="text-[9px] font-black text-slate-400 ml-0.5">{product.unit}</span>
                          </div>
                          <button
                            onClick={() => onToggleConfirmRequestQty(product.id)}
                            className={`px-2 py-1 rounded-lg text-[9px] font-black transition-all border ${
                              reqInfo.confirmedByUser
                                ? 'bg-emerald-50 border-emerald-100 text-emerald-600'
                                : 'bg-amber-50 border-amber-100 text-amber-600'
                            }`}
                          >
                            {reqInfo.confirmedByUser ? '취소' : '확정'}
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                           <button 
                              onClick={() => moveRequestToDraft(reqInfo)}
                              className="py-3.5 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase shadow-lg shadow-indigo-100 hover:bg-indigo-700 flex items-center justify-center space-x-2 active:scale-95 transition-all w-full"
                           >
                              <ListPlus size={14} />
                              <span>리스트로</span>
                           </button>
                        </div>
                      </div>
                    )}

                    {activeTab === 'history' && confInfo && (
                      <div className="space-y-1.5">
                         <div className="bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-xl flex items-center justify-between">
                            <span className="text-[8px] font-black text-emerald-500 uppercase tracking-wider">입고 예정</span>
                            <span className="text-sm font-black text-emerald-700">{confInfo.quantity}{product.unit}</span>
                         </div>
                         <button
                            onClick={() => onFinishConfirmedOrder(product.id)}
                            className="w-full py-2.5 bg-slate-800 text-white rounded-xl text-[10px] font-black hover:bg-slate-900 active:scale-[0.98] transition-all flex items-center justify-center space-x-1.5 shadow-sm"
                         >
                            <CheckCircle size={12} />
                            <span>입고 확인 및 재고 반영</span>
                         </button>
                         <button
                            onClick={() => {
                              setAdjustmentModal({
                                isOpen: true,
                                productId: product.id,
                                productName: product.name,
                                originalQuantity: confInfo.quantity,
                                type: 'quantity_change'
                              });
                              setAdjustmentQty(confInfo.quantity);
                              setAdjustmentReason('');
                            }}
                            className="w-full py-1.5 bg-white border border-slate-200 text-slate-400 rounded-xl text-[8px] font-black hover:bg-slate-50 transition-all flex items-center justify-center space-x-1"
                         >
                            <RefreshCw size={10} />
                            <span>수량 변동 및 취소 요청</span>
                         </button>
                      </div>
                    )}
                    
                    {/* Footer removed as requested */}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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
          {/* 입력 폼 */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-black text-slate-500 uppercase tracking-widest">새 기록 추가</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <select value={rmMaterial} onChange={e => setRmMaterial(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-400">
                {RAW_MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <input type="date" value={rmDate} onChange={e => setRmDate(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-400 cursor-pointer" />
              <input type="number" placeholder="입고량" value={rmReceived} onChange={e => setRmReceived(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-400" />
              <input type="number" placeholder="사용량" value={rmUsed} onChange={e => setRmUsed(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-400" />
              <input type="text" placeholder="비고" value={rmNote} onChange={e => setRmNote(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-400" />
            </div>
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
                });
                setRmReceived(''); setRmUsed(''); setRmNote('');
              }}
              className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition-all"
            >
              추가
            </button>
          </div>

          {/* 전월이월 설정 */}
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 space-y-3">
            <p className="text-xs font-black text-amber-600 uppercase tracking-widest">전월이월 설정 (매월 1일 잔량)</p>
            <div className="flex flex-wrap gap-2 items-end">
              <select value={rmMaterial} onChange={e => setRmMaterial(e.target.value)}
                className="bg-white border border-amber-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-amber-400">
                {RAW_MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <div className="relative">
                <input type="date" value={rmOpenDate} onChange={e => setRmOpenDate(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <div className="bg-white border border-amber-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 pointer-events-none whitespace-nowrap">
                  {rmOpenDate || '날짜'}
                </div>
              </div>
              <input type="number" placeholder="전월 마감 잔량 (kg)" value={rmOpenBalance} onChange={e => setRmOpenBalance(e.target.value)}
                className="bg-white border border-amber-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-amber-400 w-40" />
              <button
                onClick={() => {
                  if (!rmOpenDate || !rmOpenBalance) return;
                  onAddRawMaterialEntry({
                    id: `rm-open-${Date.now()}`,
                    material: rmMaterial,
                    date: rmOpenDate,
                    received: Number(rmOpenBalance),
                    used: 0,
                    note: '전월이월',
                    createdAt: new Date().toISOString(),
                  });
                  setRmOpenBalance('');
                }}
                className="px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-black hover:bg-amber-600 transition-all"
              >
                전월이월 저장
              </button>
            </div>
          </div>

          {/* 필터 */}
          <div className="flex flex-wrap gap-2">
            {['전체', ...RAW_MATERIALS].map(m => (
              <button key={m} onClick={() => setRmFilter(m)}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-black transition-all border ${rmFilter === m ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                {m}
              </button>
            ))}
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
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(() => {
                  // auto 사용량 항목 (isAuto: true, id 없음)
                  type DisplayEntry = { id?: string; material: string; date: string; received: number; used: number; note: string; isAuto: boolean };
                  const manualEntries: DisplayEntry[] = (rmFilter === '전체' ? rawMaterialLedger : rawMaterialLedger.filter(e => e.material === rmFilter))
                    .map(e => ({ id: e.id, material: e.material, date: e.date, received: e.received, used: e.used, note: e.note, isAuto: false }));
                  const autoEntries: DisplayEntry[] = (rmFilter === '전체' ? autoUsageEntries : autoUsageEntries.filter(e => e.material === rmFilter))
                    .map(e => ({ material: e.material, date: e.date, received: 0, used: e.used, note: e.note, isAuto: true }));
                  const sorted = [...manualEntries, ...autoEntries].sort((a, b) => a.date.localeCompare(b.date) || (a.isAuto ? 1 : -1));

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
                            <td className="px-4 py-2.5">
                              {entry.id && <button onClick={() => onDeleteRawMaterialEntry(entry.id!)}
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
                          <td className="px-4 py-2.5">
                            {!entry.isAuto && entry.id && <button onClick={() => onDeleteRawMaterialEntry(entry.id!)}
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
                      <td className="px-4 py-2.5">
                        {!entry.isAuto && entry.id && <button onClick={() => onDeleteRawMaterialEntry(entry.id!)}
                          className="p-1 text-slate-300 hover:text-rose-400 hover:bg-rose-50 rounded transition-all">
                          <Trash2 size={12} />
                        </button>}
                      </td>
                    </tr>
                  ));
                })()}
                {rawMaterialLedger.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-300 text-sm font-bold">기록이 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Draft Orders Floating Button removed as requested */}

      {isAddModalOpen && (
        <AddProductModal onClose={() => setIsAddModalOpen(false)} onSave={(newProduct) => { onAddProduct(newProduct); setIsAddModalOpen(false); }} />
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
