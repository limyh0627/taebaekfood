
import React, { useState, useMemo } from 'react';
import { 
  Package, 
  Plus, 
  Edit, 
  Search, 
  Trash2
} from 'lucide-react';
import { Product, InventoryCategory, Client } from '../types';

interface ItemManagerProps {
  products: Product[];
  clients: Client[];
  onEditProduct: (_product: Product) => void;
  onAddProduct: () => void;
  onDeleteProduct: (_id: string, _category: string) => void;
}

const CATEGORY_MAP: Record<string, string> = {
  'Cap': '마개',
  'Tape': '테이프',
  '박스': '박스',
  '용기': '용기',
  '라벨': '라벨',
};

const normalizeCategory = (cat: string): string => CATEGORY_MAP[cat] || cat;

const ItemManager: React.FC<ItemManagerProps> = ({
  products,
  clients,
  onEditProduct,
  onAddProduct,
  onDeleteProduct
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<InventoryCategory>('완제품');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const categories: InventoryCategory[] = ['완제품', '향미유', '고춧가루', '용기', '마개', '테이프', '박스', '라벨'];

  const filteredItems = useMemo(() => {
    let result = products.filter(p => p.category === activeCategory);

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(p => {
        const clientName = p.clientIds?.map(id => clients.find(c => c.id === id)?.name ?? '').filter(Boolean).join(' ').toLowerCase() ?? '';
        return (
          p.name.toLowerCase().includes(term) ||
          p.id.toLowerCase().includes(term) ||
          clientName.includes(term)
        );
      });
    }
    // 가나다 순 정렬
    return [...result].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [products, activeCategory, searchTerm, clients]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 uppercase">품목 정보 관리</h2>
          <p className="text-slate-500 text-sm font-medium">제품 및 부자재의 마스터 정보를 관리하고 편집하세요.</p>
        </div>
        <button 
          onClick={onAddProduct}
          className="flex items-center justify-center space-x-2 bg-indigo-600 text-white px-6 py-3.5 rounded-2xl font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
        >
          <Plus size={20} />
          <span>신규 품목 등록</span>
        </button>
      </div>

      <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center space-x-2 overflow-x-auto pb-1 no-scrollbar">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
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
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
            <input 
              type="text" 
              placeholder="품목명 또는 코드 검색..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-2xl pl-12 pr-4 py-3 text-xs font-bold outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
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
                    검색 결과가 없습니다.
                  </td>
                </tr>
              ) : (
                pagedItems.map((item) => (
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
                          {item.clientIds?.length ? item.clientIds.map(id => clients.find(c => c.id === id)?.name).filter(Boolean).join(', ') : <span className="text-slate-200">-</span>}
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
                              const fullProduct = products.find(p => p.id === s.id);
                              return normalizeCategory(fullProduct?.category || '') === cat;
                            });
                            return subs.length > 0 ? (
                              <span className="text-[11px] font-bold text-slate-600 whitespace-nowrap">{subs.map(s => s.name).join(', ')}</span>
                            ) : (
                              <span className="text-[10px] text-slate-200">-</span>
                            );
                          })()
                        ) : (
                          <span className="text-[10px] text-slate-200">-</span>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center space-x-2">
                        <button 
                          onClick={() => onEditProduct(item)}
                          className="p-2 text-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 rounded-xl transition-all"
                          title="수정"
                        >
                          <Edit size={18} />
                        </button>
                        <button 
                          onClick={() => {
                            if(confirm('정말로 이 품목을 삭제하시겠습니까?')) {
                              onDeleteProduct(item.id, item.category);
                            }
                          }}
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
