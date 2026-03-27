
import React, { useState, useMemo } from 'react';
import { Plus, Edit, Search, Trash2, X, ChevronRight, LayoutGrid } from 'lucide-react';
import { Product, InventoryCategory, Client } from '../types';

interface ItemManagerProps {
  products: Product[];
  clients: Client[];
  onEditProduct: (_product: Product) => void;
  onAddProduct: () => void;
  onDeleteProduct: (_id: string, _category: string) => void;
}

const CATEGORY_MAP: Record<string, string> = {
  'Cap': '마개', 'Tape': '테이프', '박스': '박스', '용기': '용기', '라벨': '라벨',
};
const normalizeCategory = (cat: string) => CATEGORY_MAP[cat] || cat;

const CATEGORIES: InventoryCategory[] = ['완제품', '향미유', '고춧가루', '용기', '마개', '테이프', '박스', '라벨'];

const ItemManager: React.FC<ItemManagerProps> = ({ products, clients, onEditProduct, onAddProduct, onDeleteProduct }) => {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [activeCategory, setActiveCategory] = useState<InventoryCategory>('완제품');
  const [searchTerm, setSearchTerm] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const salesClients = useMemo(() =>
    clients
      .filter(c => !c.partnerType || c.partnerType === '매출처')
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [clients]
  );

  // 거래처별 품목 수
  const clientProductCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      for (const cid of p.clientIds ?? []) {
        map.set(cid, (map.get(cid) ?? 0) + 1);
      }
    }
    return map;
  }, [products]);

  const filteredClients = useMemo(() =>
    salesClients.filter(c => !clientSearch.trim() || c.name.includes(clientSearch)),
    [salesClients, clientSearch]
  );

  const selectedClient = selectedClientId ? clients.find(c => c.id === selectedClientId) : null;

  // 품목 필터링
  const filteredItems = useMemo(() => {
    let result = showAll
      ? products.filter(p => p.category === activeCategory)
      : products.filter(p => p.category === activeCategory && (p.clientIds ?? []).includes(selectedClientId ?? ''));

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(term) || p.id.toLowerCase().includes(term)
      );
    }
    return [...result].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [products, activeCategory, selectedClientId, showAll, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleSelectClient = (id: string) => {
    setSelectedClientId(id);
    setShowAll(false);
    setPage(1);
    setSearchTerm('');
  };

  const handleShowAll = () => {
    setSelectedClientId(null);
    setShowAll(true);
    setPage(1);
    setSearchTerm('');
  };

  const handleBack = () => {
    setSelectedClientId(null);
    setShowAll(false);
    setSearchTerm('');
    setPage(1);
  };

  // 거래처 목록 화면
  if (!selectedClientId && !showAll) {
    return (
      <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h2 className="text-3xl font-black text-slate-900 uppercase">품목 정보 관리</h2>
            <p className="text-slate-500 text-sm font-medium">거래처를 선택하거나 전체 품목을 조회하세요.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleShowAll}
              className="flex items-center gap-2 bg-slate-100 text-slate-600 px-5 py-3 rounded-2xl font-bold text-sm hover:bg-slate-200 transition-all"
            >
              <LayoutGrid size={16} />
              전체 품목
            </button>
            <button
              onClick={onAddProduct}
              className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-2xl font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
            >
              <Plus size={18} />
              신규 품목 등록
            </button>
          </div>
        </div>

        <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 bg-slate-50/50">
            <div className="relative max-w-sm">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
              <input
                type="text"
                placeholder="거래처 검색..."
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-2xl pl-11 pr-4 py-2.5 text-xs font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
              />
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {filteredClients.map(c => {
              const count = clientProductCount.get(c.id) ?? 0;
              return (
                <button
                  key={c.id}
                  onClick={() => handleSelectClient(c.id)}
                  className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-slate-700">{c.name}</span>
                    {count > 0 && (
                      <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] font-black rounded-full">
                        {count}개
                      </span>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-slate-300 group-hover:text-indigo-400 transition-colors" />
                </button>
              );
            })}
            {filteredClients.length === 0 && (
              <p className="px-6 py-12 text-center text-slate-400 text-sm">거래처가 없습니다.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 품목 테이블 화면
  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <button onClick={handleBack} className="text-xs text-slate-400 hover:text-indigo-600 font-bold mb-1 flex items-center gap-1 transition-colors">
            ← 거래처 목록
          </button>
          <h2 className="text-3xl font-black text-slate-900 uppercase">
            {showAll ? '전체 품목' : selectedClient?.name}
          </h2>
          <p className="text-slate-500 text-sm font-medium">
            {showAll ? '모든 품목을 조회합니다.' : `${selectedClient?.name} 거래처에 연결된 품목`}
          </p>
        </div>
        <button
          onClick={onAddProduct}
          className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-2xl font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
        >
          <Plus size={18} />
          신규 품목 등록
        </button>
      </div>

      <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center space-x-2 overflow-x-auto pb-1 no-scrollbar">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => { setActiveCategory(cat); setPage(1); }}
                className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase transition-all border whitespace-nowrap ${
                  activeCategory === cat
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                    : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="relative max-w-sm w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
            <input
              type="text"
              placeholder="품목명 검색..."
              value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
              className="w-full bg-white border border-slate-200 rounded-2xl pl-11 pr-4 py-2.5 text-xs font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest min-w-[100px]">품목 정보</th>
                {activeCategory === '완제품' && <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">거래처</th>}
                {activeCategory !== '완제품' && <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">매입거래처</th>}
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">용기</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">마개</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">라벨</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">테이프</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">박스</th>
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {pagedItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-20 text-center text-slate-400 font-medium">
                    {showAll ? '등록된 품목이 없습니다.' : '이 거래처에 연결된 품목이 없습니다.'}
                  </td>
                </tr>
              ) : (
                pagedItems.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-3 py-3">
                      <div className="flex items-center space-x-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                        <p className="text-[11px] font-bold text-slate-600 whitespace-nowrap">{item.name}</p>
                      </div>
                    </td>
                    {activeCategory === '완제품' && (
                      <td className="px-2 py-3">
                        <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap">
                          {(() => {
                            const names = (item.clientIds ?? []).map(id => clients.find(c => c.id === id)?.name).filter(Boolean) as string[];
                            if (!names.length) return <span className="text-slate-200">-</span>;
                            const MAX = 2;
                            return names.length > MAX
                              ? <>{names.slice(0, MAX).join(', ')} <span className="text-slate-400">+{names.length - MAX}</span></>
                              : names.join(', ');
                          })()}
                        </span>
                      </td>
                    )}
                    {activeCategory !== '완제품' && (
                      <td className="px-2 py-3">
                        <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap">
                          {clients.find(c => c.id === item.supplierId)?.name ?? <span className="text-slate-200">-</span>}
                        </span>
                      </td>
                    )}
                    {['용기', '마개', '라벨', '테이프', '박스'].map(cat => (
                      <td key={cat} className="px-2 py-3">
                        {item.category === '완제품' && item.submaterials ? (
                          (() => {
                            const subs = item.submaterials.filter(s => {
                              const full = products.find(p => p.id === s.id);
                              return normalizeCategory(full?.category || '') === cat;
                            });
                            return subs.length > 0
                              ? <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap">{subs.map(s => s.name).join(', ')}</span>
                              : <span className="text-[10px] text-slate-200">-</span>;
                          })()
                        ) : (
                          <span className="text-[10px] text-slate-200">-</span>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center space-x-2">
                        <button onClick={() => onEditProduct(item)} className="p-2 text-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 rounded-xl transition-all" title="수정">
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => { if (confirm('정말로 이 품목을 삭제하시겠습니까?')) onDeleteProduct(item.id, item.category); }}
                          className="p-2 text-rose-300 hover:bg-rose-50 hover:text-rose-500 rounded-xl transition-all"
                          title="삭제"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 py-4 border-t border-slate-100">
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
        </div>
      </div>
    </div>
  );
};

export default ItemManager;
