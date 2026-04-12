
import React, { useState, useMemo } from 'react';
import { Plus, Edit, Search, Trash2, LayoutGrid, Link, X } from 'lucide-react';
import { Product, InventoryCategory, Client } from '../types';
import ConfirmModal from './ConfirmModal';

interface ItemManagerProps {
  products: Product[];
  clients: Client[];
  onEditProduct: (_product: Product) => void;
  onAddProduct: () => void;
  onDeleteProduct: (_id: string, _category: string) => void;
  onLinkProduct: (_productId: string, _clientId: string) => void;
  onUnlinkProduct: (_productId: string, _clientId: string) => void;
}

const CATEGORY_MAP: Record<string, string> = {
  'Cap': '마개', 'Tape': '테이프', '박스': '박스', '용기': '용기', '라벨': '라벨',
};
const normalizeCategory = (cat: string) => CATEGORY_MAP[cat] || cat;

const CATEGORIES: InventoryCategory[] = ['완제품', '향미유', '고춧가루', '용기', '마개', '테이프', '박스', '라벨'];
const LINK_CATEGORIES = ['완제품', '향미유', '고춧가루', '참기름', '들기름', '깨', '검정깨', '들깨'];
const SUB_ORDER: Record<string, number> = { '라벨': 0, '용기': 1, '마개': 2, '테이프': 3, '박스': 4 };
const sortSubs = (subs: { name: string; category: string }[]) =>
  [...subs].sort((a, b) => (SUB_ORDER[normalizeCategory(a.category)] ?? 9) - (SUB_ORDER[normalizeCategory(b.category)] ?? 9));

const ItemManager: React.FC<ItemManagerProps> = ({ products, clients, onEditProduct, onAddProduct, onDeleteProduct, onLinkProduct, onUnlinkProduct }) => {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [activeCategory, setActiveCategory] = useState<InventoryCategory>('완제품');
  const [searchTerm, setSearchTerm] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [linkSearch, setLinkSearch] = useState('');
  const [showLinkPanel, setShowLinkPanel] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; onConfirm: () => void } | null>(null);
  const [linkCategory, setLinkCategory] = useState('완제품');
  const [clientTypeFilter, setClientTypeFilter] = useState<string | null>(null);

  const TYPE_ORDER: Record<string, number> = { '일반': 0, '택배': 1, '스마트스토어': 2 };
  const salesClients = useMemo(() =>
    clients
      .filter(c => !c.partnerType || c.partnerType === '매출처')
      .sort((a, b) => {
        const tDiff = (TYPE_ORDER[a.type] ?? 0) - (TYPE_ORDER[b.type] ?? 0);
        return tDiff !== 0 ? tDiff : a.name.localeCompare(b.name, 'ko');
      }),
    [clients]
  );

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
    salesClients.filter(c =>
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
    let result = showAll
      ? products.filter(p => p.category === activeCategory)
      : selectedClientId
        ? products.filter(p => p.category === activeCategory && (p.clientIds ?? []).includes(selectedClientId))
        : [];

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

  // 모바일: 거래처 선택 전 목록 화면
  const showMobileClientList = !selectedClientId && !showAll;

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
      {/* 모바일 뒤로가기 */}
      <div className="flex items-center justify-between lg:hidden">
        <button
          onClick={() => { setSelectedClientId(null); setShowAll(false); setSearchTerm(''); setPage(1); }}
          className="flex items-center gap-1 text-xs text-indigo-600 font-bold"
        >
          ← 거래처 목록
        </button>
        <button
          onClick={onAddProduct}
          className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-xl font-black text-xs shadow-md"
        >
          <Plus size={14} />
          신규 등록
        </button>
      </div>

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
          {selectedClientId && (
            <button
              onClick={() => { setShowLinkPanel(true); setLinkSearch(''); setLinkCategory('완제품'); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm shadow-sm transition-all active:scale-95 bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
            >
              <Link size={14} />
              품목 연결
            </button>
          )}
          <button
            onClick={onAddProduct}
            className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-black text-sm shadow-md hover:bg-indigo-700 transition-all active:scale-95"
          >
            <Plus size={15} />
            신규 품목 등록
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar flex-1">
            <button
              onClick={() => { handleShowAll(); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border whitespace-nowrap flex items-center gap-1 ${
                showAll
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow'
                  : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
              }`}
            >
              <LayoutGrid size={11} />
              전체 품목
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => { setActiveCategory(cat); setPage(1); }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all border whitespace-nowrap ${
                  activeCategory === cat
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow'
                    : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                }`}
              >
                {cat}
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
              {!selectedClientId && !showAll ? (
                <tr>
                  <td colSpan={9} className="px-6 py-16 text-center text-slate-300 font-medium text-sm">
                    거래처를 선택하세요.
                  </td>
                </tr>
              ) : pagedItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-16 text-center text-slate-400 font-medium text-sm">
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
                        {(() => {
                          const BADGE_COLORS = [
                            'bg-indigo-100 text-indigo-700','bg-emerald-100 text-emerald-700','bg-amber-100 text-amber-700',
                            'bg-rose-100 text-rose-700','bg-sky-100 text-sky-700','bg-violet-100 text-violet-700',
                            'bg-teal-100 text-teal-700','bg-orange-100 text-orange-700','bg-pink-100 text-pink-700',
                          ];
                          const clientList = clients.filter(c => !c.partnerType || c.partnerType === '매출처');
                          const matched = (item.clientIds ?? []).map(id => clientList.find(c => c.id === id)).filter(Boolean) as typeof clientList;
                          if (!matched.length) return <span className="text-slate-200">-</span>;
                          const MAX = 3;
                          return (
                            <div className="flex flex-wrap gap-1">
                              {matched.slice(0, MAX).map((c) => {
                                const colorIdx = clientList.indexOf(c) % BADGE_COLORS.length;
                                return (
                                  <span key={c.id} className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-black ${BADGE_COLORS[colorIdx]}`}>{c.name}</span>
                                );
                              })}
                              {matched.length > MAX && <span className="text-[10px] text-slate-400 font-bold">+{matched.length - MAX}</span>}
                            </div>
                          );
                        })()}
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
                        {selectedClientId && !showAll && (
                          <button
                            onClick={() => setConfirmModal({
                              message: `'${item.name}' 연결을 해제하시겠습니까?`,
                              subMessage: `${selectedClient?.name}에서 이 품목이 제거됩니다. 품목 자체는 삭제되지 않습니다.`,
                              onConfirm: () => { onUnlinkProduct(item.id, selectedClientId); setConfirmModal(null); },
                            })}
                            className="p-2 text-amber-300 hover:bg-amber-50 hover:text-amber-500 rounded-xl transition-all"
                            title="연결 해제"
                          >
                            <X size={18} />
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmModal({
                            message: `'${item.name}'을(를) 삭제하시겠습니까?`,
                            subMessage: '삭제 후 복구할 수 없습니다.',
                            onConfirm: () => { onDeleteProduct(item.id, item.category); setConfirmModal(null); },
                          })}
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

  return (
    <div className="space-y-4 animate-in slide-in-from-right-4 duration-500">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-slate-900 uppercase">품목 정보 관리</h2>
          <p className="text-slate-500 text-sm font-medium">거래처를 선택하거나 전체 품목을 조회하세요.</p>
        </div>
        {/* 데스크탑 신규 등록은 productPanel에서 */}
        <button
          onClick={onAddProduct}
          className="lg:hidden flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-black text-sm shadow-md"
        >
          <Plus size={16} />
          신규 품목 등록
        </button>
      </div>

      {/* 모바일: 거래처 목록 그리드 */}
      {showMobileClientList && (
        <div className="lg:hidden space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
            <input
              type="text"
              placeholder="거래처 검색..."
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-2xl pl-10 pr-4 py-2.5 text-xs font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all shadow-sm"
            />
          </div>
          <button
            onClick={handleShowAll}
            className="flex items-center gap-2 bg-slate-100 text-slate-600 px-4 py-2.5 rounded-xl font-bold text-xs hover:bg-slate-200 transition-all"
          >
            <LayoutGrid size={13} />
            전체 품목 보기
          </button>
          {filteredClients.length === 0 ? (
            <p className="py-12 text-center text-slate-400 text-sm">거래처가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredClients.map(c => {
                const count = clientProductCount.get(c.id) ?? 0;
                return (
                  <button
                    key={c.id}
                    onClick={() => handleSelectClient(c.id)}
                    className="bg-white border border-slate-200 rounded-2xl px-4 py-4 text-left hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-50 transition-all group active:scale-95"
                  >
                    <p className="text-sm font-bold text-slate-700 group-hover:text-indigo-600 transition-colors truncate">{c.name}</p>
                    <p className="text-[11px] text-slate-400 mt-1 font-medium">
                      {count > 0 ? <span className="text-indigo-500 font-black">{count}</span> : <span>0</span>}
                      <span className="ml-0.5">개 품목</span>
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 모바일: 품목 테이블 (거래처 선택 후) */}
      {!showMobileClientList && (
        <div className="lg:hidden">
          {productPanel}
        </div>
      )}

      {/* 데스크탑: 좌우 분할 */}
      <div className="hidden lg:flex gap-4 items-start">
        {/* 왼쪽 거래처 패널 */}
        <div className="w-52 shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm p-3">
          {clientListPanel}
        </div>
        {/* 오른쪽 품목 패널 */}
        <div className="flex-1 min-w-0">
          {productPanel}
        </div>
      </div>

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
    </div>
  );
};

export default ItemManager;
