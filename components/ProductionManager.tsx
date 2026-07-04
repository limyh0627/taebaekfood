import React, { useState, useMemo } from 'react';
import { Plus, Trash2, Factory, ChevronLeft, ChevronRight, Search, X, RefreshCw, Pencil, Check, Layers } from 'lucide-react';
import PageHeader from './PageHeader';
import { ProductionRecord, Item, Order, OrderStatus } from '../types';

const SUB_ONLY_CATS = new Set(['용기', '마개', '테이프', '박스', '라벨', '향미유', '고춧가루']);

// 제품 종류 분류 (참기름/들기름 등) — 생산 요약 그룹핑용
const TYPE_ORDER = ['참기름', '들기름', '생들기름', '볶음참깨', '검정참깨', '들깨가루', '들깨', '기타'];
const productType = (name: string): string => {
  const n = name || '';
  if (n.includes('생들기름')) return '생들기름';
  if (n.includes('들기름')) return '들기름';
  if (n.includes('참기름')) return '참기름';
  if (n.includes('검정')) return '검정참깨';
  if (n.includes('들깨가루') || n.includes('탈피들깨')) return '들깨가루';
  if (n.includes('참깨')) return '볶음참깨';
  if (n.includes('들깨')) return '들깨';
  return '기타';
};

interface ProductionManagerProps {
  records: ProductionRecord[];
  items: Item[];
  orders: Order[];
  onAdd: (record: ProductionRecord) => Promise<void>;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<ProductionRecord>) => void;
  currentUserName?: string;
}

const toLocalYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const ProductionManager: React.FC<ProductionManagerProps> = ({
  records,
  items,
  orders,
  onAdd,
  onDelete,
  onUpdate,
  currentUserName,
}) => {
  const today = toLocalYMD(new Date());
  const thisMonth = today.slice(0, 7);

  const [filterMonth, setFilterMonth] = useState(thisMonth);
  const [showAll, setShowAll] = useState(false);
  const [filterProductId, setFilterProductId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const [editingDateVal, setEditingDateVal] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [expandedRecId, setExpandedRecId] = useState<string | null>(null);
  const [recLimit, setRecLimit] = useState(30);

  // 정방향 추적: 주문 문서의 rawConsumedLots 스냅샷 → 생산실적 행에서 조회(추가 읽기 0)
  const consumedByOrderId = useMemo(() => {
    const m = new Map<string, NonNullable<Order['rawConsumedLots']>>();
    for (const o of orders) if (o.rawConsumedLots && o.rawConsumedLots.length) m.set(o.id, o.rawConsumedLots);
    return m;
  }, [orders]);
  const traceOf = (r: ProductionRecord) => {
    if (!r.id.startsWith('pr-')) return undefined;
    const orderId = r.id.slice(3, r.id.length - r.itemId.length - 1);
    return consumedByOrderId.get(orderId);
  };

  const [form, setForm] = useState({
    date: today,
    itemId: '',
    finishedQty: '',
    wipItemId: '',
    wipUsed: '',
    note: '',
  });

  const finishedProducts = useMemo(
    () => items.filter(p => !p.archived && (p.itemType === 'FINISHED' || p.category === '완제품')),
    [items]
  );

  const wipProducts = useMemo(
    () => items.filter(p => !p.archived && p.itemType === 'WIP'),
    [items]
  );

  const filteredRecords = useMemo(() => {
    return records
      .filter(r => {
        const matchMonth = showAll || r.date.startsWith(filterMonth);
        const matchProduct = !filterProductId || r.itemId === filterProductId;
        const matchSearch =
          !searchText ||
          r.itemName.includes(searchText) ||
          (r.wipItemName ?? '').includes(searchText) ||
          (r.note ?? '').includes(searchText);
        return matchMonth && matchProduct && matchSearch;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [records, filterMonth, showAll, filterProductId, searchText]);

  const monthlySummary = useMemo(() => {
    const map: Record<string, { itemName: string; qty: number; count: number; category: string }> = {};
    filteredRecords.forEach(r => {
      if (!map[r.itemId]) {
        const cat = items.find(p => p.id === r.itemId)?.category ?? '';
        map[r.itemId] = { itemName: r.itemName, qty: 0, count: 0, category: cat };
      }
      map[r.itemId].qty += r.finishedQty;
      map[r.itemId].count += 1;
    });
    return Object.values(map).sort((a, b) => b.qty - a.qty);
  }, [filteredRecords, items]);

  const fmtMonth = (ym: string) => {
    const [y, m] = ym.split('-');
    return `${y}년 ${parseInt(m)}월`;
  };

  const prevMonth = () => {
    const [y, m] = filterMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setFilterMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const nextMonth = () => {
    const [y, m] = filterMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    setFilterMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const handleSubmit = () => {
    if (!form.itemId || !form.finishedQty) {
      alert('품목과 생산수량을 입력해주세요.');
      return;
    }
    const product = items.find(p => p.id === form.itemId);
    const wipProduct = form.wipItemId ? items.find(p => p.id === form.wipItemId) : undefined;

    const record: ProductionRecord = {
      id: `pr-${Date.now()}`,
      date: form.date,
      itemId: form.itemId,
      itemName: product?.name ?? '',
      finishedQty: Number(form.finishedQty),
      ...(wipProduct?.id ? { wipItemId: wipProduct.id, wipItemName: wipProduct.name } : {}),
      ...(form.wipUsed ? { wipUsed: Number(form.wipUsed) } : {}),
      ...(product?.cost != null ? { cost: product.cost } : {}),
      ...(form.note ? { note: form.note } : {}),
      ...(currentUserName ? { createdBy: currentUserName } : {}),
      createdAt: new Date().toISOString(),
    };

    onAdd(record);
    setForm({ date: today, itemId: '', finishedQty: '', wipItemId: '', wipUsed: '', note: '' });
    setShowForm(false);
  };

  // 기존 DELIVERED 주문에서 생산 실적 동기화
  const handleSyncFromOrders = async () => {
    try {
      const deliveredOrders = orders.filter(
        o => o.status === OrderStatus.DELIVERED && o.partnerName !== '생산기록'
      );

      if (deliveredOrders.length === 0) {
        alert('이력에 완료된 주문이 없습니다.');
        setSyncing(false);
        return;
      }

      const existingIds = new Set(records.map(r => r.id));
      let count = 0;

      for (const order of deliveredOrders) {
        for (const item of order.items) {
          const product = items.find(p => p.id === item.itemId);
          if (product && SUB_ONLY_CATS.has(product.category)) continue;

          const recordId = `pr-${order.id}-${item.itemId}`;
          if (existingIds.has(recordId)) continue;

          const record: ProductionRecord = {
            id: recordId,
            date: order.deliveredAt ? order.deliveredAt.slice(0, 10) : order.createdAt.slice(0, 10),
            itemId: item.itemId,
            itemName: product?.name ?? item.name,
            finishedQty: item.quantity,
            ...(product?.cost != null ? { cost: product.cost } : {}),
            note: `주문 자동 연동 (${order.partnerName})`,
            createdAt: new Date().toISOString(),
          };
          await onAdd(record);
          existingIds.add(recordId);
          count++;
        }
      }

      alert(count === 0 ? '동기화할 새 기록이 없습니다.' : `${count}건 동기화 완료`);
    } catch (e) {
      console.error('동기화 오류:', e);
      alert(`동기화 중 오류가 발생했습니다: ${e}`);
    }
    setSyncing(false);
  };

  const formatDate = (dateStr: string) => {
    const [, m, d] = dateStr.split('-');
    return `${parseInt(m)}/${parseInt(d)}`;
  };

  return (
    <div className="space-y-4 pb-10">
      <PageHeader
        title="생산 실적"
        subtitle="일자별 생산·출고 실적과 투입 원료(lot) 추적"
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSyncing(true); handleSyncFromOrders().catch(e => { alert(`오류: ${e}`); setSyncing(false); }); }}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-50 shadow-sm"
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
              주문 동기화
            </button>
            <button
              onClick={() => setShowForm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-sm"
            >
              <Plus size={14} />직접 입력
            </button>
          </div>
        }
      />

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
                value={form.itemId}
                onChange={e => setForm(f => ({ ...f, itemId: e.target.value }))}
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
                {form.itemId && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                    {items.find(p => p.id === form.itemId)?.unit ?? '개'}
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">투입 WIP 품목 <span className="font-normal text-slate-400">(옵션)</span></label>
              <select
                value={form.wipItemId}
                onChange={e => setForm(f => ({ ...f, wipItemId: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-400 bg-white"
              >
                <option value="">선택 안 함</option>
                {wipProducts.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {form.wipItemId && (
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

            <div className={form.wipItemId ? '' : 'sm:col-span-2'}>
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
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowAll(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${showAll ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
          >
            전체 보기
          </button>
          {!showAll && <>
            <button onClick={prevMonth} className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50">
              <ChevronLeft size={14} />
            </button>
            <span className="text-sm font-bold text-slate-700 w-24 text-center">{fmtMonth(filterMonth)}</span>
            <button onClick={nextMonth} className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50">
              <ChevronRight size={14} />
            </button>
          </>}
        </div>

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

      {/* 월별 요약 — 카테고리별 리스트 */}
      {monthlySummary.length > 0 && (() => {
        const groups = new Map<string, typeof monthlySummary>();
        for (const s of monthlySummary) { const k = productType(s.itemName); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(s); }
        const keys = [...groups.keys()].sort((a, b) => ((TYPE_ORDER.indexOf(a) + 1) || 99) - ((TYPE_ORDER.indexOf(b) + 1) || 99));
        return (
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">{showAll ? '전체' : fmtMonth(filterMonth)} 생산 요약</p>
              <div className="flex items-center gap-3 text-[11px] font-bold">
                <span className="text-slate-500">품목 <b className="text-slate-800">{monthlySummary.length}</b>종</span>
                <span className="text-slate-500">생산 <b className="text-emerald-700">{filteredRecords.length}</b>건</span>
              </div>
            </div>
            <div className="space-y-3">
              {keys.map(k => {
                const arr = groups.get(k)!;
                const subQty = arr.reduce((s, x) => s + x.qty, 0);
                return (
                  <div key={k}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[11px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">{k}</span>
                      <span className="text-[10px] text-slate-400 font-bold">{arr.length}종 · 합계 {subQty.toLocaleString()}개</span>
                    </div>
                    <div className="divide-y divide-slate-50 border border-slate-100 rounded-xl overflow-hidden">
                      {arr.map(s => (
                        <div key={s.itemName} className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 transition-colors">
                          <span className="text-xs font-bold text-slate-700 truncate mr-2">{s.itemName}</span>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-[10px] text-slate-400">{s.count}회</span>
                            <span className="text-sm font-black text-slate-800 tabular-nums">{s.qty.toLocaleString()}<span className="text-[10px] font-bold text-slate-400 ml-0.5">개</span></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 이력 테이블 */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        {filteredRecords.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            <Factory size={32} className="mx-auto mb-2 opacity-30" />
            <p>생산 실적이 없습니다.</p>
            <p className="text-xs mt-1 text-slate-300">상단 "주문 이력 동기화"로 기존 출고 이력을 불러오세요.</p>
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
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredRecords.slice(0, recLimit).map(r => { const trace = traceOf(r); const isExp = expandedRecId === r.id; return (
                  <React.Fragment key={r.id}>
                  <tr className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {editingDateId === r.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="date"
                            value={editingDateVal}
                            onChange={e => setEditingDateVal(e.target.value)}
                            className="border border-emerald-300 rounded-lg px-2 py-1 text-xs focus:outline-none w-32"
                          />
                          <button
                            onClick={() => {
                              if (editingDateVal) onUpdate(r.id, { date: editingDateVal });
                              setEditingDateId(null);
                            }}
                            className="text-emerald-500 hover:text-emerald-700"
                          >
                            <Check size={14} />
                          </button>
                          <button onClick={() => setEditingDateId(null)} className="text-slate-400">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingDateId(r.id); setEditingDateVal(r.date); }}
                          className="flex items-center gap-1 group font-bold text-slate-600"
                        >
                          {formatDate(r.date)}
                          <Pencil size={11} className="opacity-0 group-hover:opacity-40 transition-opacity" />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-bold text-slate-800">{r.itemName}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-black text-emerald-700">{r.finishedQty.toLocaleString()}</span>
                      <span className="text-xs text-slate-400 ml-0.5">
                        {items.find(p => p.id === r.itemId)?.unit ?? '개'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                      {r.wipItemName ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 hidden sm:table-cell">
                      {r.wipUsed != null ? r.wipUsed.toLocaleString() : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs hidden md:table-cell max-w-[180px] truncate">
                      {r.note ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {trace && trace.length > 0 && (
                          <button
                            onClick={() => setExpandedRecId(isExp ? null : r.id)}
                            className={`text-[10px] font-black px-2 py-1 rounded-lg flex items-center gap-1 transition-all ${isExp ? 'bg-teal-100 text-teal-700' : 'bg-teal-50 text-teal-600 hover:bg-teal-100'}`}
                            title="투입 원료 lot 추적"
                          >
                            <Layers size={11} />원료 {isExp ? '▲' : '▼'}
                          </button>
                        )}
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
                      </div>
                    </td>
                  </tr>
                  {isExp && trace && (
                    <tr className="bg-teal-50/40">
                      <td colSpan={7} className="px-4 py-3">
                        <p className="text-[10px] font-black text-teal-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                          <Layers size={11} />투입 원료 lot (선입선출)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {trace.map((d, i) => (
                            <div key={i} className="bg-white border border-teal-100 rounded-xl px-3 py-2 text-xs">
                              <span className="font-black text-slate-800">{d.material}</span>
                              <span className="text-slate-300 mx-1.5">·</span>
                              <span className="font-bold text-slate-600">{d.supplierName}</span>
                              {d.receivedDate && <span className="text-slate-400"> ({d.receivedDate} 입고)</span>}
                              {d.lotNo && <span className="text-slate-400"> · lot {d.lotNo}</span>}
                              <span className="ml-1.5 font-black text-teal-700">{Math.round(d.kg * 10) / 10}kg</span>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-2">※ 주문 단위 투입 원료입니다. (배송완료 시점 FIFO 소비 스냅샷)</p>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ); })}
              </tbody>
            </table>
            {filteredRecords.length > recLimit && (
              <div className="flex items-center justify-center gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/40">
                <span className="text-[11px] text-slate-400 font-bold">{recLimit} / {filteredRecords.length}건</span>
                <button
                  onClick={() => setRecLimit(n => n + 30)}
                  className="text-[11px] font-black px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 transition-all"
                >+30건 더 보기</button>
                <button
                  onClick={() => setRecLimit(filteredRecords.length)}
                  className="text-[11px] font-black px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-600 transition-all"
                >전체 ({filteredRecords.length})</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductionManager;
