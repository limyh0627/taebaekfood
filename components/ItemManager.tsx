
import React, { useState, useMemo } from 'react';
import { Plus, Edit, Search, Trash2, LayoutGrid, Link, X, Copy, ChevronDown, ChevronUp, GitMerge, Save, Settings } from 'lucide-react';
import { Product, InventoryCategory, Client, ProductClient, ProductSupplier, PartnerItem, ShippingRule, ItemBom } from '../types';
import ConfirmModal from './ConfirmModal';
import PageHeader from './PageHeader';

interface ItemManagerProps {
  products: Product[];
  clients: Client[];
  productClients?: ProductClient[];
  productSuppliers?: ProductSupplier[];
  itemCustomers?: PartnerItem[];
  shippingRules?: ShippingRule[];
  itemBoms?: ItemBom[];
  onEditProduct: (_product: Product) => void;
  onAddProduct: () => void;
  onDeleteProduct: (_id: string, _category: string) => void;
  onLinkProduct: (_productId: string, _clientId: string) => void;
  onUnlinkProduct: (_productId: string, _clientId: string) => void;
  onMergeProducts?: (_keepId: string, _deleteIds: string[]) => Promise<void>;
  onSaveItemCustomer?: (_ic: Partial<PartnerItem> & { id: string }) => Promise<void>;
  onSaveShippingRule?: (_rule: Partial<ShippingRule> & { id: string }) => Promise<void>;
  onAddShippingRule?: (_rule: Omit<ShippingRule, 'id'>) => Promise<void>;
  isAdmin?: boolean;
}

const CATEGORY_MAP: Record<string, string> = {
  'Cap': 'cap', 'Tape': 'tape',
  '완제품': 'product', '향미유': 'product', '고춧가루': 'product',
  '용기': 'container', '마개': 'cap', '테이프': 'tape', '박스': 'box', '라벨': 'label',
};
const normalizeCategory = (cat: string) => CATEGORY_MAP[cat] || cat;

const CATEGORIES: InventoryCategory[] = ['product', 'wip', 'raw', 'giftset', 'container', 'cap', 'tape', 'box', 'label', 'shipping'];
const CATEGORY_LABELS: Record<string, string> = {
  product: '완제품', wip: '반제품', raw: '원료', giftset: '선물세트',
  container: '용기', cap: '마개', tape: '테이프', box: '박스', label: '라벨', shipping: '배송',
};
const LINK_CATEGORIES = ['product', 'wip', 'raw', '참기름', '들기름', '깨', '검정깨', '들깨'];
const SUB_ORDER: Record<string, number> = { 'label': 0, 'container': 1, 'cap': 2, 'tape': 3, 'box': 4 };
const sortSubs = (subs: { name: string; category: string }[]) =>
  [...subs].sort((a, b) => (SUB_ORDER[normalizeCategory(a.category)] ?? 9) - (SUB_ORDER[normalizeCategory(b.category)] ?? 9));

const ItemManager: React.FC<ItemManagerProps> = ({ products, clients, productClients = [], productSuppliers = [], itemCustomers = [], shippingRules = [], itemBoms = [], onEditProduct, onAddProduct, onDeleteProduct, onLinkProduct, onUnlinkProduct, onMergeProducts, onSaveItemCustomer, onSaveShippingRule, onAddShippingRule, isAdmin = true }) => {
  const [mainView, setMainView] = useState<'flat' | 'by-client'>(isAdmin ? 'flat' : 'by-client');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(true);
  const [showNoClient, setShowNoClient] = useState(false);
  const [activeCategory, setActiveCategory] = useState<InventoryCategory>('product');
  const [searchTerm, setSearchTerm] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [linkSearch, setLinkSearch] = useState('');
  const [showLinkPanel, setShowLinkPanel] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; onConfirm: () => void } | null>(null);
  const [linkCategory, setLinkCategory] = useState('product');
  const [clientTypeFilter, setClientTypeFilter] = useState<string | null>(null);
  const [expandedClientRowId, setExpandedClientRowId] = useState<string | null>(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [dupExpandedKeys, setDupExpandedKeys] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [selectedKeepId, setSelectedKeepId] = useState<Record<string, string>>({});
  const [selectedMergeIds, setSelectedMergeIds] = useState<Record<string, Set<string>>>({});
  const [expandedPackagingId, setExpandedPackagingId] = useState<string | null>(null);
  const [editingIc, setEditingIc] = useState<Record<string, Partial<PartnerItem>>>({});
  const [editingRule, setEditingRule] = useState<Record<string, Partial<ShippingRule>>>({});
  const [packagingModal, setPackagingModal] = useState<{ item: Product; clientId: string } | null>(null);
  const [packagingEdit, setPackagingEdit] = useState<Partial<ShippingRule>>({});
  const [packagingAdding, setPackagingAdding] = useState(false);
  const [packagingSaving, setPackagingSaving] = useState(false);
  const [partnerTab, setPartnerTab] = useState<'sales' | 'purchase'>('sales');

  const TYPE_ORDER: Record<string, number> = { '일반': 0, '택배': 1, '스마트스토어': 2 };
  const salesClients = useMemo(() =>
    clients
      .filter(c => !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처')
      .sort((a, b) => {
        const tDiff = (TYPE_ORDER[a.type] ?? 0) - (TYPE_ORDER[b.type] ?? 0);
        return tDiff !== 0 ? tDiff : a.name.localeCompare(b.name, 'ko');
      }),
    [clients]
  );
  const purchaseClients = useMemo(() =>
    clients
      .filter(c => c.partnerType === '매입처' || c.partnerType === '매출+매입처')
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [clients]
  );
  const activePartnerClients = partnerTab === 'sales' ? salesClients : purchaseClients;

  const duplicateGroups = useMemo(() => {
    const finished = products.filter(p => !p.archived && ['product', 'wip', 'giftset'].includes(p.category));
    const pcByProduct: Record<string, ProductClient[]> = {};
    for (const pc of productClients) {
      const key = pc.Item_ID;
      if (!key) continue;
      if (!pcByProduct[key]) pcByProduct[key] = [];
      pcByProduct[key].push(pc);
    }
    const subMap = Object.fromEntries(products.map(p => [p.id, p.name]));

    const groups: Record<string, typeof finished> = {};
    for (const p of finished) {
      const subs = p.submaterials || [];
      const 용기 = subs.filter(s => normalizeCategory(s.category) === 'container').map(s => s.name).sort().join(',');
      const 마개 = subs.filter(s => normalizeCategory(s.category) === 'cap').map(s => s.name).sort().join(',');
      const key = `${p.name}||용기:${용기}|마개:${마개}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }

    return Object.entries(groups)
      .filter(([, prods]) => prods.length > 1)
      .map(([key, prods]) => {
        const [namePart, containerPart] = key.split('||');
        const items = prods.map(p => {
          const subs = p.submaterials || [];
          const 라벨 = subs.filter(s => normalizeCategory(s.category) === 'label').map(s => s.name).join(', ');
          const pcs = pcByProduct[p.id] || [];
          const directClients = [...new Set([...(p.clientIds || [])])];
          return { product: p, 라벨, pcs, directClients, subMap };
        });
        const labels = [...new Set(items.map(i => i.라벨).filter(Boolean))];
        const canMerge = labels.length <= 1;
        return { key, name: namePart, container: containerPart, items, canMerge };
      })
      .sort((a, b) => (a.canMerge ? 0 : 1) - (b.canMerge ? 0 : 1));
  }, [products, productClients]);

  const clientProductCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      for (const cid of p.clientIds ?? []) {
        map.set(cid, (map.get(cid) ?? 0) + 1);
      }
    }
    return map;
  }, [products]);

  const supplierItemCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const ps of productSuppliers) {
      const sid = ps.supplierId ?? ps.Partner_ID;
      if (sid) map.set(sid, (map.get(sid) ?? 0) + 1);
    }
    return map;
  }, [productSuppliers]);

  const filteredClients = useMemo(() =>
    activePartnerClients.filter(c =>
      (!clientSearch.trim() || c.name.includes(clientSearch)) &&
      (!clientTypeFilter || c.type === clientTypeFilter)
    ),
    [salesClients, clientSearch, clientTypeFilter]
  );

  const handleClientTypeFilter = (type: string) => {
    const next = clientTypeFilter === type ? null : type;
    setClientTypeFilter(next);
    if (next && selectedClientId) {
      const cur = clients.find(c => c.id === selectedClientId);
      if (cur && cur.type !== next) {
        setSelectedClientId(null);
        setShowAll(false);
      }
    }
  };

  const selectedClient = selectedClientId ? clients.find(c => c.id === selectedClientId) : null;

  const filteredItems = useMemo(() => {
    const isByClientPurchase = mainView === 'by-client' && partnerTab === 'purchase' && selectedClientId;
    let result = mainView === 'flat' || showAll || showNoClient
      ? products.filter(p => !p.archived && p.category === activeCategory)
      : selectedClientId
        ? isByClientPurchase
          ? products.filter(p => !p.archived && productSuppliers.some(ps => (ps.productId ?? ps.Item_ID) === p.id && (ps.supplierId ?? ps.Partner_ID) === selectedClientId))
          : products.filter(p => !p.archived && p.category === activeCategory && (p.clientIds ?? []).includes(selectedClientId))
        : [];

    if (showNoClient) {
      result = result.filter(p => (p.clientIds ?? []).length === 0);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      if (mainView === 'flat') {
        result = result.filter(p =>
          p.name.toLowerCase().includes(term) ||
          clients.some(c => (p.clientIds ?? []).includes(c.id) && c.name.toLowerCase().includes(term))
        );
      } else {
        result = result.filter(p => p.name.toLowerCase().includes(term) || p.id.toLowerCase().includes(term));
      }
    }
    return [...result].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [products, activeCategory, selectedClientId, showAll, showNoClient, searchTerm, mainView, clients, partnerTab, productSuppliers]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleSelectClient = (id: string) => {
    setSelectedClientId(id);
    setShowAll(false);
    setShowNoClient(false);
    setPage(1);
    setSearchTerm('');
  };

  const handleShowAll = () => {
    setSelectedClientId(null);
    setShowAll(true);
    setShowNoClient(false);
    setPage(1);
    setSearchTerm('');
  };

  // 클라이언트 목록 패널 (공통)
  const clientListPanel = (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
        <input
          type="text"
          placeholder="거래처 검색..."
          value={clientSearch}
          onChange={e => setClientSearch(e.target.value)}
          className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
        />
      </div>
      <div className="flex gap-1">
        {([['일반 거래처', '일반'], ['택배사/대행', '택배'], ['스마트스토어', '스마트스토어']] as const).map(([label, type]) => (
          <button
            key={type}
            onClick={() => handleClientTypeFilter(type)}
            className={`flex-1 px-1.5 py-1.5 rounded-lg text-[9px] font-black transition-all whitespace-nowrap ${
              clientTypeFilter === type
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-col overflow-y-auto max-h-[calc(100vh-280px)] divide-y divide-slate-100">
        {filteredClients.map(c => {
          const count = clientProductCount.get(c.id) ?? 0;
          const isSelected = selectedClientId === c.id;
          return (
            <button
              key={c.id}
              onClick={() => handleSelectClient(c.id)}
              className={`flex items-center justify-between px-3 py-2.5 text-left transition-all ${
                isSelected
                  ? 'bg-indigo-600 text-white'
                  : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              <span className={`text-xs font-bold truncate ${isSelected ? 'text-white' : ''}`}>{c.name}</span>
              {count > 0 && (
                <span className={`text-[10px] font-black shrink-0 ml-2 ${isSelected ? 'text-indigo-200' : 'text-indigo-400'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
        {filteredClients.length === 0 && (
          <p className="text-center text-slate-400 text-xs py-6">거래처 없음</p>
        )}
      </div>
    </div>
  );

  // 연결 가능한 품목 (모달 카테고리 기준, 이미 연결된 것 제외)
  const linkableProduts = useMemo(() => {
    if (!selectedClientId) return [];
    const term = linkSearch.toLowerCase().trim();
    return products
      .filter(p => p.category === linkCategory && !(p.clientIds ?? []).includes(selectedClientId))
      .filter(p => !term || p.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [products, selectedClientId, linkCategory, linkSearch]);

  // 품목 테이블 패널 (공통)
  const productPanel = (
    <div className="flex flex-col gap-3 min-w-0">
      {/* 모바일 신규 등록 버튼 */}
      {isAdmin && (
        <div className="flex items-center justify-end lg:hidden">
          <button
            onClick={onAddProduct}
            className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-xl font-black text-xs shadow-md"
          >
            <Plus size={14} />
            신규 등록
          </button>
        </div>
      )}

      <div className="hidden lg:flex items-center justify-between">
        <div>
          <h3 className="text-lg font-black text-slate-900">
            {showAll ? '전체 품목' : selectedClient?.name ?? ''}
          </h3>
          <p className="text-xs text-slate-400 font-medium">
            {showAll ? '모든 품목' : `${filteredItems.length}개 품목`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedClientId && isAdmin && (
            <button
              onClick={() => { setShowLinkPanel(true); setLinkSearch(''); setLinkCategory('product'); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm shadow-sm transition-all active:scale-95 bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
            >
              <Link size={14} />
              품목 연결
            </button>
          )}
          {isAdmin && (
            <button
              onClick={onAddProduct}
              className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-black text-sm shadow-md hover:bg-indigo-700 transition-all active:scale-95"
            >
              <Plus size={15} />
              신규 품목 등록
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 240px)' }}>
        <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar flex-1">
            {(isAdmin || (!isAdmin && !selectedClientId)) && (
              <button
                onClick={() => { handleShowAll(); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border whitespace-nowrap flex items-center gap-1 ${
                  showAll && !showNoClient
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow'
                    : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                }`}
              >
                <LayoutGrid size={11} />
                전체 품목
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => { setShowNoClient(p => !p); setShowAll(true); setSelectedClientId(null); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border whitespace-nowrap flex items-center gap-1 ${
                  showNoClient
                    ? 'bg-rose-500 border-rose-500 text-white shadow'
                    : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                }`}
              >
                거래처 없는 것만
              </button>
            )}
            {isAdmin && CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => { setActiveCategory(cat); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border whitespace-nowrap ${
                  activeCategory === cat
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow'
                    : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                }`}
              >
                {CATEGORY_LABELS[cat] ?? cat}
              </button>
            ))}
          </div>
          <div className="relative shrink-0 w-full sm:w-44">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={13} />
            <input
              type="text"
              placeholder="품목명 검색..."
              value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
              className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
            />
          </div>
        </div>

        <div className="overflow-x-auto overflow-y-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest min-w-[100px]">품목 정보</th>
                {activeCategory === 'product' && <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">거래처</th>}
                {activeCategory !== 'product' && <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">매입거래처</th>}
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">용기</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">마개</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">라벨</th>
                {isAdmin && <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap text-right">원가</th>}
                {(isAdmin || (mainView === 'by-client' && !!selectedClientId)) && <th className="px-2 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {!selectedClientId && !showAll ? (
                <tr>
                  <td colSpan={isAdmin ? 7 : 5} className="px-6 py-16 text-center text-slate-300 font-medium text-sm">
                    거래처를 선택하세요.
                  </td>
                </tr>
              ) : pagedItems.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 7 : 5} className="px-6 py-16 text-center text-slate-400 font-medium text-sm">
                    {showAll ? '등록된 품목이 없습니다.' : '이 거래처에 연결된 품목이 없습니다.'}
                  </td>
                </tr>
              ) : (
                pagedItems.map(item => (
                  <React.Fragment key={item.id}>
                  <tr className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-3 py-3">
                      <div className="flex items-center space-x-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                        <p className="text-[11px] font-bold text-slate-600 whitespace-nowrap">{item.name}</p>
                      </div>
                    </td>
                    {activeCategory === 'product' && (
                      <td className="px-2 py-3">
                        {(() => {
                          const BADGE_COLORS = [
                            'bg-indigo-100 text-indigo-700','bg-emerald-100 text-emerald-700','bg-amber-100 text-amber-700',
                            'bg-rose-100 text-rose-700','bg-sky-100 text-sky-700','bg-violet-100 text-violet-700',
                            'bg-teal-100 text-teal-700','bg-orange-100 text-orange-700','bg-pink-100 text-pink-700',
                          ];
                          const clientList = clients.filter(c => !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처');
                          const matched = (item.clientIds ?? []).map(id => clientList.find(c => c.id === id)).filter(Boolean) as typeof clientList;
                          if (!matched.length) return <span className="text-slate-200">-</span>;
                          const isExp = expandedClientRowId === item.id;
                          const shown = isExp ? matched : matched.slice(0, 1);
                          return (
                            <div className="flex flex-wrap gap-1 items-center" onClick={e => e.stopPropagation()}>
                              {shown.map((c) => {
                                const colorIdx = clientList.indexOf(c) % BADGE_COLORS.length;
                                return (
                                  <span key={c.id} className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-black ${BADGE_COLORS[colorIdx]}`}>{c.name}</span>
                                );
                              })}
                              {!isExp && matched.length > 1 && (
                                <button onClick={() => setExpandedClientRowId(item.id)} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 transition-colors">+{matched.length - 1}</button>
                              )}
                              {isExp && (
                                <button onClick={() => setExpandedClientRowId(null)} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 transition-colors">접기</button>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    )}
                    {activeCategory !== 'product' && (
                      <td className="px-2 py-3">
                        <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap">
                          {clients.find(c => c.id === productSuppliers.find(ps => ps.productId === item.id)?.supplierId)?.name ?? <span className="text-slate-200">-</span>}
                        </span>
                      </td>
                    )}
                    {['container', 'cap', 'label'].map(cat => (
                      <td key={cat} className="px-2 py-3">
                        {item.category === 'product' ? (() => {
                          // shippingRules 기반 (테이프/박스, 거래처 선택 시)
                          if (selectedClientId && (cat === 'tape' || cat === 'box')) {
                            const rule = shippingRules.find(r => r.item_id === item.id && r.partner_id === selectedClientId);
                            const subId = cat === 'tape' ? rule?.tape_item_id : rule?.box_item_id;
                            if (subId) {
                              const sub = products.find(p => p.id === subId);
                              if (sub) return <span className="text-[11px] font-bold text-indigo-600 whitespace-nowrap">{sub.name}</span>;
                            }
                          }
                          // 폴백: submaterials 배열
                          const subs = (item.submaterials ?? []).filter(s => {
                            const full = products.find(p => p.id === s.id);
                            return normalizeCategory(full?.category || s.category || '') === cat;
                          });
                          return subs.length > 0
                            ? <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap">{subs.map(s => s.name).join(', ')}</span>
                            : <span className="text-[10px] text-slate-200">-</span>;
                        })() : (
                          <span className="text-[10px] text-slate-200">-</span>
                        )}
                      </td>
                    ))}
                    {isAdmin && (
                      <td className="px-2 py-3 text-right">
                        {item.cost != null
                          ? <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">{item.cost.toLocaleString()}원</span>
                          : <span className="text-[10px] text-slate-200">-</span>}
                      </td>
                    )}
                    {(isAdmin || (mainView === 'by-client' && !!selectedClientId)) && (
                      <td className="px-2 py-3 text-center">
                        {isAdmin && mainView === 'by-client' && selectedClientId ? (
                          // 거래처별 뷰: 포장설정 버튼
                          <button
                            onClick={() => {
                              const existing = shippingRules.find(r => r.item_id === item.id && r.partner_id === selectedClientId);
                              setPackagingModal({ item, clientId: selectedClientId });
                              setPackagingEdit(existing ? { ...existing } : {});
                              setPackagingAdding(!existing);
                            }}
                            className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-800 transition-all"
                            title="포장설정"
                          >
                            <Settings size={13} />
                          </button>
                        ) : isAdmin ? (
                          // 품목 목록 뷰: 품목 수정 버튼
                          <button
                            onClick={() => onEditProduct(item)}
                            className="p-1.5 rounded-lg bg-indigo-50 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700 transition-all"
                          >
                            <Edit size={13} />
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                  {item.isRawMaterial && expandedPackagingId === item.id && (() => {
                    const colCount = isAdmin ? 7 : 5;
                    // BOM: 이 품목의 구성 부자재 (item_bom)
                    const boms = itemBoms.filter(b => b.parent_id === item.id);
                    const getBomChild = (cat: string) => {
                      const bom = boms.find(b => normalizeCategory(products.find(p => p.id === b.child_id)?.category || '') === cat);
                      return bom ? products.find(p => p.id === bom.child_id) : null;
                    };
                    const containerItem = getBomChild('container');
                    const labelItem = getBomChild('label');
                    const capItem = getBomChild('cap');
                    // 거래처별 포장 설정 (shipping_rule)
                    const rules = shippingRules.filter(r => r.item_id === item.id);
                    return (
                      <tr>
                        <td colSpan={colCount} className="px-4 pb-4 pt-0 bg-emerald-50/60">
                          <div className="rounded-2xl border border-emerald-100 overflow-hidden p-3 space-y-3">
                            {/* BOM 구성 (공통) */}
                            <div>
                              <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-1.5">BOM 구성 (공통)</p>
                              <div className="flex gap-4 text-xs text-slate-600">
                                <span>용기: <strong className="text-slate-800">{containerItem?.name ?? '없음'}</strong></span>
                                <span>라벨: <strong className="text-slate-800">{labelItem?.name ?? '무라벨'}</strong></span>
                                <span>마개: <strong className="text-slate-800">{capItem?.name ?? '없음'}</strong></span>
                              </div>
                            </div>
                            {/* 거래처별 포장 설정 */}
                            <div>
                              <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-1.5">거래처별 포장 설정</p>
                              {rules.length === 0 ? (
                                <p className="text-xs text-slate-400 px-1">포장 설정 없음 (shipping_rule 미등록)</p>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead className="bg-emerald-100">
                                    <tr>
                                      <th className="text-left px-3 py-2 font-black text-emerald-800">거래처</th>
                                      <th className="text-left px-3 py-2 font-black text-emerald-800">박스</th>
                                      <th className="text-center px-3 py-2 font-black text-emerald-800">박스당수량</th>
                                      <th className="text-left px-3 py-2 font-black text-emerald-800">테이프</th>
                                      <th className="text-center px-3 py-2 font-black text-emerald-800">단가</th>
                                      {onSaveShippingRule && <th className="px-3 py-2" />}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rules.map(rule => {
                                      const clientName = rule.partner_id
                                        ? (clients.find(c => c.id === rule.partner_id)?.name ?? rule.partner_id)
                                        : '전체 (기본)';
                                      const boxItem = products.find(p => p.id === rule.box_item_id);
                                      const tapeItem = rule.tape_item_id ? products.find(p => p.id === rule.tape_item_id) : null;
                                      const partnerPrice = itemCustomers.find(ic =>
                                        (ic.item_id ?? ic.Item_ID) === item.id &&
                                        (ic.customer_id ?? ic.Partner_ID) === rule.partner_id
                                      )?.price;
                                      const editing = editingRule[rule.id];
                                      return (
                                        <tr key={rule.id} className="border-t border-emerald-100">
                                          <td className="px-3 py-2 font-bold text-slate-700">{clientName}</td>
                                          <td className="px-3 py-2 text-slate-600">
                                            {editing ? (
                                              <select className="border border-emerald-300 rounded px-1 text-xs w-full"
                                                value={editing.box_item_id ?? rule.box_item_id}
                                                onChange={e => setEditingRule(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], box_item_id: e.target.value } }))}>
                                                {products.filter(p => p.category === 'box' || p.category === 'shipping').map(p => (
                                                  <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                              </select>
                                            ) : <span>{boxItem?.name ?? rule.box_item_id}</span>}
                                          </td>
                                          <td className="px-3 py-2 text-center">
                                            {editing ? (
                                              <input type="number" className="w-14 border border-emerald-300 rounded px-1 text-center text-xs"
                                                value={editing.qty_per_box ?? rule.qty_per_box}
                                                onChange={e => setEditingRule(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], qty_per_box: Number(e.target.value) } }))} />
                                            ) : <span>{rule.qty_per_box}개</span>}
                                          </td>
                                          <td className="px-3 py-2 text-slate-600">
                                            {editing ? (
                                              <select className="border border-emerald-300 rounded px-1 text-xs w-full"
                                                value={editing.tape_item_id ?? rule.tape_item_id ?? ''}
                                                onChange={e => setEditingRule(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], tape_item_id: e.target.value || undefined } }))}>
                                                <option value="">없음</option>
                                                {products.filter(p => p.category === 'tape').map(p => (
                                                  <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                              </select>
                                            ) : <span>{tapeItem?.name ?? '없음'}</span>}
                                          </td>
                                          <td className="px-3 py-2 text-center text-slate-500">
                                            {partnerPrice ? `${partnerPrice.toLocaleString()}원` : '-'}
                                          </td>
                                          {onSaveShippingRule && (
                                            <td className="px-3 py-2 text-center">
                                              {editing ? (
                                                <button onClick={async () => {
                                                  await onSaveShippingRule({ ...rule, ...editing, id: rule.id });
                                                  setEditingRule(prev => { const n = { ...prev }; delete n[rule.id]; return n; });
                                                }}
                                                  className="p-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all"><Save size={12} /></button>
                                              ) : (
                                                <button onClick={() => setEditingRule(prev => ({ ...prev, [rule.id]: {} }))}
                                                  className="p-1 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-all"><Edit size={12} /></button>
                                              )}
                                            </td>
                                          )}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col items-center gap-2 px-4 py-3 border-t border-slate-100">
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-slate-100 disabled:opacity-30 transition-all">←</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${safePage === p ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:bg-slate-100'}`}>
                  {p}
                </button>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-slate-100 disabled:opacity-30 transition-all">→</button>
            </div>
          )}
          <span className="text-[10px] font-bold text-slate-300">
            총 {filteredItems.length}개 · {safePage}/{totalPages} 페이지
          </span>
        </div>
      </div>

    </div>
  );

  return (
    <div className="space-y-4 animate-in slide-in-from-right-4 duration-500">
      <PageHeader
        title="품목 정보 관리"
        subtitle="거래처를 선택하거나 전체 품목을 조회하세요."
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDuplicates(p => !p)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-black text-xs shadow-sm transition-all whitespace-nowrap ${showDuplicates ? 'bg-amber-50 text-amber-600 border border-amber-300' : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'}`}
            >
              <Copy size={13} />
              중복 품목
              {duplicateGroups.length > 0 && (
                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${showDuplicates ? 'bg-amber-200 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{duplicateGroups.length}</span>
              )}
            </button>
            {isAdmin && (
              <button
                onClick={onAddProduct}
                className="lg:hidden flex items-center gap-2 bg-indigo-600 text-white px-3 py-2 rounded-xl font-black text-xs shadow-md whitespace-nowrap"
              >
                <Plus size={14} />
                신규 등록
              </button>
            )}
          </div>
        }
      />

      {/* 중복 품목 패널 */}
      {showDuplicates && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-amber-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Copy size={15} className="text-amber-600" />
              <span className="text-sm font-black text-amber-800">중복 품목 목록</span>
              <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">이름+용기/마개 기준 {duplicateGroups.length}그룹</span>
            </div>
            <button onClick={() => setShowDuplicates(false)} className="p-1 hover:bg-amber-100 rounded-lg transition-colors">
              <X size={14} className="text-amber-500" />
            </button>
          </div>
          <div className="divide-y divide-amber-100 max-h-[60vh] overflow-y-auto">
            {duplicateGroups.map(group => {
              const isExpanded = dupExpandedKeys.has(group.key);
              return (
                <div key={group.key} className="px-5 py-3">
                  <button
                    className="w-full flex items-start justify-between gap-3 text-left"
                    onClick={() => setDupExpandedKeys(prev => { const next = new Set(prev); next.has(group.key) ? next.delete(group.key) : next.add(group.key); return next; })}
                  >
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-sm font-black text-slate-800">{group.name}</span>
                      <span className="text-[10px] font-bold text-slate-400">{group.container}</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${group.canMerge ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
                        {group.canMerge ? '통합 가능' : '라벨 다름'}
                      </span>
                      <span className="text-[10px] font-bold text-amber-600">{group.items.length}개</span>
                    </div>
                    {isExpanded ? <ChevronUp size={14} className="text-amber-500 shrink-0 mt-0.5" /> : <ChevronDown size={14} className="text-amber-500 shrink-0 mt-0.5" />}
                  </button>

                  {isExpanded && (
                    <div className="mt-3 space-y-2">
                      {group.items.map(({ product, 라벨, pcs, directClients, subMap }) => {
                        const subs = product.submaterials || [];
                        const 용기목록 = subs.filter(s => normalizeCategory(s.category) === 'container').map(s => s.name).join(', ');
                        const 마개목록 = subs.filter(s => normalizeCategory(s.category) === 'cap').map(s => s.name).join(', ');
                        return (
                        <div key={product.id} className="bg-white rounded-xl border border-amber-100 px-4 py-3">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-[10px] font-black text-slate-400 font-mono">{product.id}</span>
                            {라벨 ? (
                              <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">라벨: {라벨}</span>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-300">라벨 없음</span>
                            )}
                            {용기목록 && <span className="text-[10px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full">용기: {용기목록}</span>}
                            {마개목록 && <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">마개: {마개목록}</span>}
                          </div>
                          {pcs.length > 0 ? (
                            <div className="space-y-1">
                              {pcs.map(pc => {
                                const cname = clients.find(c => c.id === pc.clientId)?.name || pc.clientId;
                                const boxName = pc.boxTypeId ? (subMap[pc.boxTypeId] || pc.boxTypeId) : null;
                                const tapeName = pc.tapeTypeId ? (subMap[pc.tapeTypeId] || pc.tapeTypeId) : null;
                                return (
                                  <div key={pc.id} className="flex flex-wrap items-center gap-3 text-[11px]">
                                    <span className="font-bold text-slate-700 min-w-[80px]">{cname}</span>
                                    <span className="text-slate-400">{boxName ? `박스: ${boxName}` : '박스 없음'}</span>
                                    <span className="text-slate-400">{tapeName ? `테이프: ${tapeName}` : '테이프 없음'}</span>
                                    {pc.qtyPerBox && <span className="text-slate-400">{pc.qtyPerBox}개/박스</span>}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-400">
                              거래처: {directClients.map(id => clients.find(c => c.id === id)?.name || id).join(', ') || '없음'} — 포장 설정 없음
                            </div>
                          )}
                        </div>
                        );
                      })}

                      {onMergeProducts && (() => {
                        const allIds = group.items.map(i => i.product.id);
                        const mergeSet = selectedMergeIds[group.key] ?? new Set(allIds);
                        const keepId = (() => {
                          const k = selectedKeepId[group.key] ?? allIds[0];
                          return mergeSet.has(k) ? k : (Array.from(mergeSet)[0] ?? allIds[0]);
                        })();
                        const selectedList = allIds.filter(id => mergeSet.has(id));
                        const deleteIds = selectedList.filter(id => id !== keepId);
                        const canMerge = selectedList.length >= 2;

                        const toggleMerge = (id: string) => {
                          setSelectedMergeIds(prev => {
                            const cur = new Set(prev[group.key] ?? allIds);
                            if (cur.has(id)) {
                              if (cur.size <= 1) return prev; // 최소 1개 유지
                              cur.delete(id);
                            } else {
                              cur.add(id);
                            }
                            return { ...prev, [group.key]: cur };
                          });
                        };

                        return (
                          <div className={`border rounded-xl px-4 py-3 ${group.canMerge ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                            <p className={`text-[11px] font-black mb-3 ${group.canMerge ? 'text-emerald-700' : 'text-rose-600'}`}>
                              {group.canMerge ? '합칠 품목을 선택하고, 남길 품목을 지정하세요' : '⚠ 라벨이 달라 통합 시 주의 필요'}
                            </p>

                            <div className="space-y-2 mb-3">
                              {group.items.map(({ product, 라벨 }) => {
                                const isSelected = mergeSet.has(product.id);
                                const isKeep = keepId === product.id && isSelected;
                                return (
                                  <div key={product.id} className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${isSelected ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 opacity-50'}`}>
                                    {/* 선택 체크박스 */}
                                    <button
                                      onClick={() => toggleMerge(product.id)}
                                      className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}
                                    >
                                      {isSelected && <span className="text-white text-[9px] font-black">✓</span>}
                                    </button>
                                    {/* 품목 ID + 라벨 */}
                                    <span className="text-[10px] font-bold text-slate-600 font-mono flex-1 truncate">
                                      {product.id}{라벨 ? ` (${라벨})` : ''}
                                    </span>
                                    {/* 남길 품목 선택 */}
                                    {isSelected && (
                                      <button
                                        onClick={() => setSelectedKeepId(prev => ({ ...prev, [group.key]: product.id }))}
                                        className={`px-2 py-0.5 rounded text-[9px] font-black border transition-all shrink-0 ${isKeep ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-300'}`}
                                      >
                                        {isKeep ? '남김 ✓' : '남기기'}
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {!canMerge && (
                              <p className="text-[10px] text-slate-400 mb-2">합칠 품목을 2개 이상 선택하세요</p>
                            )}

                            <button
                              disabled={merging || !canMerge}
                              onClick={async () => {
                                if (!window.confirm(`"${group.name}" 통합하시겠습니까?\n\n남기는 품목: ${keepId}\n삭제할 품목: ${deleteIds.join(', ')}\n\n삭제 품목의 거래처/포장설정이 남기는 품목으로 이전됩니다.`)) return;
                                setMerging(true);
                                try {
                                  await onMergeProducts(keepId, deleteIds);
                                  setDupExpandedKeys(prev => { const n = new Set(prev); n.delete(group.key); return n; });
                                } finally {
                                  setMerging(false);
                                }
                              }}
                              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-[11px] font-black rounded-lg hover:bg-indigo-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <GitMerge size={13} />
                              {merging ? '통합 중...' : `선택 품목 통합 (${selectedList.length}개)`}
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 뷰 탭 — 관리자만 */}
      {isAdmin && (
        <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5 w-fit">
          {([['flat', '품목 목록'], ['by-client', '거래처별 품목']] as const).map(([v, label]) => (
            <button key={v} onClick={() => { setMainView(v); setSelectedClientId(null); setShowAll(true); setPage(1); setSearchTerm(''); }}
              className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${mainView === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 품목 목록 뷰: 관리자만 */}
      {isAdmin && mainView === 'flat' && productPanel}

      {/* 거래처별 품목 뷰 */}
      {mainView === 'by-client' && (
        <>
          {!selectedClientId ? (
            /* 거래처 그리드 */
            <div className="space-y-3">
              {/* 매출/매입 탭 */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5">
                  {([['sales', '매출처'], ['purchase', '매입처']] as const).map(([tab, label]) => (
                    <button key={tab}
                      onClick={() => { setPartnerTab(tab); setSelectedClientId(null); setClientSearch(''); }}
                      className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${partnerTab === tab ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                  <input
                    type="text"
                    placeholder="거래처 검색..."
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-2xl pl-10 pr-4 py-2.5 text-xs font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all shadow-sm"
                  />
                </div>
              </div>
              {filteredClients.length === 0 ? (
                <p className="py-12 text-center text-slate-400 text-sm">거래처가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {filteredClients
                    .filter(c => (partnerTab === 'sales' ? clientProductCount.get(c.id) ?? 0 : supplierItemCount.get(c.id) ?? 0) > 0)
                    .map(c => {
                      const count = partnerTab === 'sales'
                        ? (clientProductCount.get(c.id) ?? 0)
                        : (supplierItemCount.get(c.id) ?? 0);
                      return (
                        <button key={c.id} onClick={() => handleSelectClient(c.id)}
                          className="bg-white border border-slate-200 rounded-2xl px-4 py-3.5 text-left hover:border-indigo-300 hover:shadow-md transition-all active:scale-95 group">
                          <p className="text-sm font-bold text-slate-700 group-hover:text-indigo-600 transition-colors truncate">{c.name}</p>
                          <p className="text-[11px] text-slate-400 mt-1">
                            <span className="text-indigo-500 font-black">{count}</span>
                            <span className="ml-0.5 font-medium">개 품목</span>
                          </p>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          ) : (
            /* 선택된 거래처 품목 테이블 */
            <div className="space-y-3">
              <button
                onClick={() => { setSelectedClientId(null); setPage(1); setSearchTerm(''); }}
                className="flex items-center gap-1.5 text-xs text-indigo-600 font-bold hover:underline"
              >
                ← 거래처 목록으로
              </button>
              {productPanel}
            </div>
          )}
        </>
      )}

      {/* 품목 연결 모달 */}
      {showLinkPanel && selectedClientId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowLinkPanel(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl mx-4 flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-black text-slate-900">품목 연결</h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">{selectedClient?.name}에 추가할 품목을 선택하세요</p>
              </div>
              <button onClick={() => setShowLinkPanel(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-all">
                <X size={18} />
              </button>
            </div>
            {/* 카테고리 탭 */}
            <div className="px-6 pt-4 pb-1 flex flex-wrap gap-1.5">
              {LINK_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => { setLinkCategory(cat); setLinkSearch(''); }}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border whitespace-nowrap ${
                    linkCategory === cat
                      ? 'bg-emerald-600 border-emerald-600 text-white shadow'
                      : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            {/* 검색 */}
            <div className="px-6 py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                <input
                  type="text"
                  placeholder="품목명 검색..."
                  value={linkSearch}
                  onChange={e => setLinkSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400"
                  autoFocus
                />
              </div>
            </div>
            {/* 목록 */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {linkableProduts.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-12">연결 가능한 품목이 없습니다.</p>
              ) : (
                <div className="flex flex-col divide-y divide-slate-50">
                  {linkableProduts.map(p => (
                    <div key={p.id} className="flex items-center justify-between py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded-xl transition-colors">
                      <div>
                        <p className="text-xs font-bold text-slate-700">{p.name}</p>
                        {p.submaterials && p.submaterials.length > 0 && (
                          <p className="text-[9px] text-slate-400 font-medium mt-0.5">{sortSubs(p.submaterials).map(s => s.name).join(' · ')}</p>
                        )}
                      </div>
                      <button
                        onClick={() => onLinkProduct(p.id, selectedClientId)}
                        className="flex items-center gap-1 text-[10px] font-black text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-all shrink-0 ml-3"
                      >
                        <Plus size={11} /> 연결
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          subMessage={confirmModal.subMessage}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}

      {/* 포장설정 모달 */}
      {packagingModal && (() => {
        const { item, clientId } = packagingModal;
        const clientName = clients.find(c => c.id === clientId)?.name ?? clientId;
        const existingRule = shippingRules.find(r => r.item_id === item.id && r.partner_id === clientId);
        const boxItems = products.filter(p => p.category === 'box');
        const tapeItems = products.filter(p => p.category === 'tape');

        const closeModal = () => { setPackagingModal(null); setPackagingEdit({}); setPackagingAdding(false); };

        const handleSave = async () => {
          setPackagingSaving(true);
          try {
            if (existingRule && onSaveShippingRule) {
              await onSaveShippingRule({ ...existingRule, ...packagingEdit, id: existingRule.id });
            } else if (!existingRule && onAddShippingRule) {
              await onAddShippingRule({
                item_id: item.id,
                partner_id: clientId,
                box_item_id: packagingEdit.box_item_id ?? '',
                qty_per_box: packagingEdit.qty_per_box ?? 1,
                tape_item_id: packagingEdit.tape_item_id,
              });
            }
            closeModal();
          } finally {
            setPackagingSaving(false);
          }
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={closeModal}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              {/* 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <div>
                  <h3 className="text-base font-black text-slate-900">포장설정</h3>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">
                    <span className="text-indigo-600 font-bold">{item.name}</span>
                    <span className="mx-1">·</span>
                    <span className="text-emerald-600 font-bold">{clientName}</span>
                  </p>
                </div>
                <button onClick={closeModal} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-all">
                  <X size={18} />
                </button>
              </div>

              {/* 본문 */}
              {!existingRule && !packagingAdding ? (
                /* 설정 없음 → 추가 여부 확인 */
                <div className="px-6 py-8 text-center space-y-4">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto">
                    <Settings size={24} className="text-slate-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-700">포장설정이 없습니다</p>
                    <p className="text-xs text-slate-400 mt-1">이 거래처 전용 포장설정을 추가하시겠습니까?</p>
                  </div>
                  <div className="flex gap-2 justify-center">
                    <button onClick={closeModal} className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all">취소</button>
                    <button onClick={() => setPackagingAdding(true)} className="px-5 py-2.5 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 transition-all">추가하기</button>
                  </div>
                </div>
              ) : (
                /* 편집 폼 */
                <div className="px-6 py-5 space-y-4">
                  {existingRule && (
                    <div className="bg-emerald-50 rounded-xl px-4 py-2.5 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-[11px] font-bold text-emerald-700">기존 설정 수정</span>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">박스</label>
                      <select
                        value={packagingEdit.box_item_id ?? existingRule?.box_item_id ?? ''}
                        onChange={e => setPackagingEdit(prev => ({ ...prev, box_item_id: e.target.value }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all bg-white"
                      >
                        <option value="">박스 없음</option>
                        {boxItems.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">박스당 수량</label>
                      <input
                        type="number"
                        min={1}
                        value={packagingEdit.qty_per_box ?? existingRule?.qty_per_box ?? 1}
                        onChange={e => setPackagingEdit(prev => ({ ...prev, qty_per_box: Number(e.target.value) }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">테이프</label>
                      <select
                        value={packagingEdit.tape_item_id ?? existingRule?.tape_item_id ?? ''}
                        onChange={e => setPackagingEdit(prev => ({ ...prev, tape_item_id: e.target.value || undefined }))}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all bg-white"
                      >
                        <option value="">테이프 없음</option>
                        {tapeItems.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button onClick={closeModal} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all">취소</button>
                    <button
                      onClick={handleSave}
                      disabled={packagingSaving}
                      className="flex-1 py-2.5 rounded-xl text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                    >
                      <Save size={14} />
                      {packagingSaving ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default ItemManager;
