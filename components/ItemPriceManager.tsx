
import React, { useState, useMemo } from 'react';
import { Plus, Edit2, Trash2, Search, Save, X } from 'lucide-react';
import { Item, PartnerItem, InventoryCategory } from '../types';
import PageHeader from './PageHeader';
import ConfirmModal from './ConfirmModal';
import { bomOf } from '../src/shared/bomIndex';
import { marginOf } from '../src/shared/margin';
import { subDotClass } from '../src/shared/submaterialStyle';
import { isSaleTaxExempt, salePriceRange } from '../src/shared/partnerPrice';

interface ItemPriceManagerProps {
  items: Item[];
  onEditProduct: (product: Item) => void;
  onAddItem: () => void;
  onDeleteItem: (id: string, category: string) => void;
  onUpdateCost?: (itemId: string, cost: number) => void;
  /**
   * 거래처별 단가 — **판매단가는 품목이 아니라 거래처마다 다르다.**
   * 죽어 있던 `items.price` 를 지우면서 여기로 옮겼다(2026-09-04).
   */
  partnerItems?: PartnerItem[];
}

const CATEGORIES: (InventoryCategory | '전체')[] = ['전체', '완제품', '향미유', '고춧가루', '용기', '마개', '테이프', '박스', '라벨'];

const fmt = (n: number) => n.toLocaleString('ko-KR');

const ItemPriceManager: React.FC<ItemPriceManagerProps> = ({
  items, onEditProduct, onAddItem, onDeleteItem, onUpdateCost, partnerItems,
}) => {
  const [category, setCategory] = useState<string>('전체');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCost, setEditCost] = useState('');
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; onConfirm: () => void } | null>(null);

  const filtered = useMemo(() => {
    return items
      .filter(p => category === '전체' || p.type === category)
      .filter(p => !search.trim() || p.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [items, category, search]);

  const startEdit = (p: Item) => {
    setEditingId(p.id);
    setEditCost(p.cost !== undefined ? String(p.cost) : '');
  };

  const saveEdit = (p: Item) => {
    const cost = editCost.trim() !== '' ? Number(editCost) : undefined;
    if (cost !== undefined && !isNaN(cost)) onUpdateCost?.(p.id, cost);
    setEditingId(null);
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <PageHeader
        title="품목 관리"
        subtitle="품목 추가·수정·삭제 및 원가를 관리합니다. 원가는 부가세를 뺀 공급가액이고, 판매단가는 거래처마다 다릅니다."
        right={
          <button onClick={onAddItem}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 shadow-sm transition-all">
            <Plus size={13}/>품목 추가
          </button>
        }
      />

      {/* 카테고리 필터 + 검색 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-slate-100 rounded-xl p-1 gap-0.5 flex-wrap">
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all whitespace-nowrap ${category === c ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              {c}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="품목명 검색..."
            className="pl-8 pr-3 py-2 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 w-48"/>
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">품목명</th>
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">카테고리</th>
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap text-right">판매단가</th>
                {/*  **원가는 공급가액이다** — 전표에 치는 매입단가(세포함)와 다른 숫자다.
                     표시가 없으면 매입단가를 그대로 옮겨 적어 과세 품목이 10% 부푼다.
                     밑을 맞추는 셈은 `costOfPurchase` 한 곳뿐이다(인수인계 "원가는 공급가액"). */}
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap text-right">
                  원가 <span className="text-slate-300 normal-case">(공급가액)</span>
                </th>
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap text-right">재고</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-300">품목 없음</td>
                </tr>
              ) : filtered.map(p => {
                const isEditing = editingId === p.id;
                //  판매단가는 거래처마다 다르다 — 폭으로 본다(shared/partnerPrice).
                //  전에는 죽은 `items.price` 를 봐서 **마진이 한 줄도 안 떴다**.
                const 폭 = salePriceRange(partnerItems, p.id);
                //  마진은 **공급가에서** 센다(shared/margin) — 세포함 단가로 나누면 부풀어 보인다.
                //  여러 단가 중 **가장 싼 것**으로 잡는다 — 제일 나쁜 경우를 봐야 한다.
                const margin = p.cost && 폭
                  ? Math.round(marginOf(폭.min, p.cost, isSaleTaxExempt(partnerItems, p.id)).marginRate * 100)
                  : null;
                return (
                  <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${isEditing ? 'bg-indigo-50/40' : ''}`}>
                    {/* 품목명 */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-black text-slate-800 text-sm">{p.name}</div>
                      {(() => {
                        //  부자재는 BOM 그대로 — 용기·마개만 골라 뽑던 자리다(그 필터는 늘 비어 있었다).
                        const subs = bomOf(p.id);
                        const 정보 = p.oil || p.spec || '';
                        if (!subs.length && !정보) return null;
                        return (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                            {정보 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-400">{정보}</span>}
                            {subs.map((l, i) => (
                              <span key={`${l.childId}-${i}`} className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400 whitespace-nowrap">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${subDotClass(l.child)}`} />
                                {l.child?.category ? `${l.child.category} ` : ''}{l.child?.name ?? l.childId}
                                {l.qty !== 1 && <span className="text-slate-300">×{l.qty}</span>}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                      {p.sku && <div className="text-[10px] text-slate-300 mt-0.5">{p.sku}</div>}
                    </td>
                    {/* 카테고리 */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{p.type}</span>
                    </td>
                    {/* 판매단가 — 거래처마다 다르니 폭으로 보여준다 */}
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      {!폭 ? (
                        <span className="text-xs font-bold text-slate-300">-</span>
                      ) : (
                        <div>
                          <span className="text-sm font-bold text-slate-700">
                            {폭.min === 폭.max ? `${fmt(폭.min)}원` : `${fmt(폭.min)}~${fmt(폭.max)}원`}
                          </span>
                          <div className="text-[10px] font-bold text-slate-300 mt-0.5">거래처 {폭.count}곳</div>
                        </div>
                      )}
                    </td>
                    {/* 원가 */}
                    <td className="px-3 py-3 text-right">
                      {isEditing ? (
                        <input type="number" value={editCost} onChange={e => setEditCost(e.target.value)}
                          className="w-28 text-right border border-emerald-300 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-300"
                          placeholder="원가(공급가)"/>
                      ) : (
                        <div>
                          <span className="text-sm font-bold text-slate-600">{p.cost ? `${fmt(p.cost)}원` : '-'}</span>
                          {margin !== null && (
                            <div className="text-[10px] font-black text-emerald-500 mt-0.5" title="가장 싼 거래처 단가 기준">마진 {margin}%</div>
                          )}
                        </div>
                      )}
                    </td>
                    {/* 재고 */}
                    <td className="px-3 py-3 text-right">
                      <span className="text-sm font-bold text-slate-500">{p.stock ?? 0}{p.unit ? ` ${p.unit}` : ''}</span>
                    </td>
                    {/* 관리 */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveEdit(p)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 transition-all">
                              <Save size={12}/>저장
                            </button>
                            <button onClick={() => setEditingId(null)}
                              className="p-1.5 rounded-lg text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition-all">
                              <X size={14}/>
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(p)}
                              className="p-2 text-emerald-400 hover:bg-emerald-50 hover:text-emerald-600 rounded-xl transition-all" title="단가/원가 수정">
                              <Edit2 size={15}/>
                            </button>
                            <button onClick={() => onEditProduct(p)}
                              className="p-2 text-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 rounded-xl transition-all" title="품목 정보 수정">
                              <Edit2 size={15}/>
                            </button>
                            <button onClick={() => setConfirmModal({
                              message: `'${p.name}'을(를) 삭제하시겠습니까?`,
                              subMessage: '삭제 후 복구할 수 없습니다.',
                              onConfirm: () => { onDeleteItem(p.id, p.type); setConfirmModal(null); },
                            })}
                              className="p-2 text-rose-300 hover:bg-rose-50 hover:text-rose-500 rounded-xl transition-all" title="삭제">
                              <Trash2 size={15}/>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className="px-4 py-2.5 border-t border-slate-100 text-[10px] text-slate-400 font-bold">
            총 {filtered.length}개 품목
          </div>
        )}
      </div>

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

export default ItemPriceManager;
