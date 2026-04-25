import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Factory, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { ProductionRecord, Product } from '../types';

interface ProductionManagerProps {
  records: ProductionRecord[];
  products: Product[];
  onAdd: (record: ProductionRecord) => void;
  onDelete: (id: string) => void;
  currentUserName?: string;
}

const ProductionManager: React.FC<ProductionManagerProps> = ({
  records,
  products,
  onAdd,
  onDelete,
  currentUserName,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  const [filterMonth, setFilterMonth] = useState(thisMonth);
  const [filterProductId, setFilterProductId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    date: today,
    productId: '',
    finishedQty: '',
    wipProductId: '',
    wipUsed: '',
    note: '',
  });

  const finishedProducts = useMemo(
    () => products.filter(p => p.itemType === 'FINISHED' || p.category === '완제품'),
    [products]
  );

  const wipProducts = useMemo(
    () => products.filter(p => p.itemType === 'WIP'),
    [products]
  );

  const filteredRecords = useMemo(() => {
    return records
      .filter(r => {
        const matchMonth = r.date.startsWith(filterMonth);
        const matchProduct = !filterProductId || r.productId === filterProductId;
        const matchSearch =
          !searchText ||
          r.productName.includes(searchText) ||
          (r.wipProductName ?? '').includes(searchText) ||
          (r.note ?? '').includes(searchText);
        return matchMonth && matchProduct && matchSearch;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [records, filterMonth, filterProductId, searchText]);

  const monthlySummary = useMemo(() => {
    const map: Record<string, { productName: string; qty: number; count: number }> = {};
    filteredRecords.forEach(r => {
      if (!map[r.productId]) {
        map[r.productId] = { productName: r.productName, qty: 0, count: 0 };
      }
      map[r.productId].qty += r.finishedQty;
      map[r.productId].count += 1;
    });
    return Object.values(map).sort((a, b) => b.qty - a.qty);
  }, [filteredRecords]);

  const prevMonth = () => {
    const [y, m] = filterMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setFilterMonth(d.toISOString().slice(0, 7));
  };

  const nextMonth = () => {
    const [y, m] = filterMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    setFilterMonth(d.toISOString().slice(0, 7));
  };

  const handleSubmit = () => {
    if (!form.productId || !form.finishedQty) {
      alert('품목과 생산수량을 입력해주세요.');
      return;
    }
    const product = products.find(p => p.id === form.productId);
    const wipProduct = form.wipProductId ? products.find(p => p.id === form.wipProductId) : undefined;

    const record: ProductionRecord = {
      id: `pr-${Date.now()}`,
      date: form.date,
      productId: form.productId,
      productName: product?.name ?? '',
      finishedQty: Number(form.finishedQty),
      wipProductId: wipProduct?.id,
      wipProductName: wipProduct?.name,
      wipUsed: form.wipUsed ? Number(form.wipUsed) : undefined,
      cost: product?.cost,
      note: form.note || undefined,
      createdBy: currentUserName,
      createdAt: new Date().toISOString(),
    };

    onAdd(record);
    setForm({ date: today, productId: '', finishedQty: '', wipProductId: '', wipUsed: '', note: '' });
    setShowForm(false);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div className="space-y-4 pb-10">
      {/* 헤더 */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <Factory size={20} className="text-emerald-600" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-800">생산 실적</h2>
            <p className="text-xs text-slate-400">WIP → FINISHED 전환 이력 관리</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-all"
        >
          <Plus size={16} />
          생산 실적 입력
        </button>
      </div>

      {/* 입력 폼 */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-emerald-200 p-5 space-y-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-black text-slate-700 text-sm">신규 생산 실적</h3>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">생산일자</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-400"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">생산 품목 (FINISHED)</label>
              <select
                value={form.productId}
                onChange={e => setForm(f => ({ ...f, productId: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-400 bg-white"
              >
                <option value="">품목 선택</option>
                {finishedProducts.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">생산 수량</label>
              <div className="relative">
                <input
                  type="number"
                  value={form.finishedQty}
                  onChange={e => setForm(f => ({ ...f, finishedQty: e.target.value }))}
                  placeholder="0"
                  min={0}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-400"
                />
                {form.productId && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                    {products.find(p => p.id === form.productId)?.unit ?? '개'}
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">투입 WIP 품목 <span className="font-normal text-slate-400">(옵션)</span></label>
              <select
                value={form.wipProductId}
                onChange={e => setForm(f => ({ ...f, wipProductId: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-400 bg-white"
              >
                <option value="">선택 안 함</option>
                {wipProducts.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {form.wipProductId && (
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">WIP 투입 수량</label>
                <input
                  type="number"
                  value={form.wipUsed}
                  onChange={e => setForm(f => ({ ...f, wipUsed: e.target.value }))}
                  placeholder="0"
                  min={0}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-400"
                />
              </div>
            )}

            <div className={form.wipProductId ? '' : 'sm:col-span-2'}>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">비고</label>
              <input
                type="text"
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="메모 (선택)"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-400"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-sm text-slate-500 hover:bg-slate-50"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700"
            >
              저장
            </button>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-wrap gap-3 items-center">
        {/* 월 이동 */}
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50">
            <ChevronLeft size={14} />
          </button>
          <span className="text-sm font-bold text-slate-700 w-20 text-center">{filterMonth}</span>
          <button onClick={nextMonth} className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50">
            <ChevronRight size={14} />
          </button>
        </div>

        {/* 품목 필터 */}
        <select
          value={filterProductId}
          onChange={e => setFilterProductId(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 bg-white"
        >
          <option value="">전체 품목</option>
          {finishedProducts.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* 검색 */}
        <div className="relative flex-1 min-w-[160px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="품목명/메모 검색"
            className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-emerald-400"
          />
          {searchText && (
            <button onClick={() => setSearchText('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 월별 요약 */}
      {monthlySummary.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">{filterMonth} 생산 요약</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {monthlySummary.map(s => (
              <div key={s.productName} className="bg-emerald-50 rounded-xl p-3">
                <p className="text-xs text-emerald-600 font-bold truncate">{s.productName}</p>
                <p className="text-xl font-black text-slate-800 mt-0.5">{s.qty.toLocaleString()}</p>
                <p className="text-[10px] text-slate-400">{s.count}회 생산</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 이력 테이블 */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {filteredRecords.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            <Factory size={32} className="mx-auto mb-2 opacity-30" />
            <p>생산 실적이 없습니다.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-black text-slate-400">날짜</th>
                  <th className="text-left px-4 py-3 text-xs font-black text-slate-400">생산 품목</th>
                  <th className="text-right px-4 py-3 text-xs font-black text-slate-400">생산 수량</th>
                  <th className="text-left px-4 py-3 text-xs font-black text-slate-400 hidden sm:table-cell">투입 WIP</th>
                  <th className="text-right px-4 py-3 text-xs font-black text-slate-400 hidden sm:table-cell">WIP 수량</th>
                  <th className="text-left px-4 py-3 text-xs font-black text-slate-400 hidden md:table-cell">비고</th>
                  <th className="text-left px-4 py-3 text-xs font-black text-slate-400 hidden md:table-cell">담당자</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredRecords.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-600 whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="px-4 py-3">
                      <span className="font-bold text-slate-800">{r.productName}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-black text-emerald-700">{r.finishedQty.toLocaleString()}</span>
                      <span className="text-xs text-slate-400 ml-0.5">
                        {products.find(p => p.id === r.productId)?.unit ?? '개'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                      {r.wipProductName ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 hidden sm:table-cell">
                      {r.wipUsed != null ? r.wipUsed.toLocaleString() : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs hidden md:table-cell max-w-[160px] truncate">
                      {r.note ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs hidden md:table-cell">
                      {r.createdBy ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          if (window.confirm('이 생산 실적을 삭제하시겠습니까?')) {
                            onDelete(r.id);
                          }
                        }}
                        className="text-slate-300 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductionManager;
