import React, { useMemo, useState } from 'react';
import { Search, Package, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { Item, Order } from '../src/shared/types';
import { buildItemLedger, type ItemLedgerKind } from '../src/features/admin/itemLedger';
import { matchesSearch } from '../src/shared/hangul';

/**
 * 제품별원장 — 품목 하나가 언제 얼마나 들고 났나.
 *
 * 원료·벌크는 원료수불부가 이미 있다. 여긴 **완제품·부자재**를 본다.
 * 근거는 주문에 남은 스냅샷뿐이라(itemLedger.ts 참조) 재고조정·실사는 안 잡힌다.
 * 그래서 잔량을 억지로 맞추지 않고 **지금 재고와의 차이를 그대로 밝힌다** — 가리면 못 찾는다.
 */
const KIND_CLS: Record<ItemLedgerKind, string> = {
  '생산': 'bg-emerald-100 text-emerald-700',
  '먼저생산': 'bg-teal-100 text-teal-700',
  '출고': 'bg-rose-100 text-rose-600',
  '자재사용': 'bg-amber-100 text-amber-700',
};

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

const ItemLedger: React.FC<{ items: Item[]; orders: Order[] }> = ({ items, orders }) => {
  const [q, setQ] = useState('');
  const [pickedId, setPickedId] = useState('');

  const pickable = useMemo(
    () => items.filter(i => !i.archived).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [items]);
  const shown = useMemo(() => {
    const t = q.trim();
    return (t ? pickable.filter(i => matchesSearch(i.name, t) || matchesSearch(String(i.spec ?? ''), t)) : pickable).slice(0, 200);
  }, [pickable, q]);

  const picked = items.find(i => i.id === pickedId);
  const ledger = useMemo(
    () => (pickedId ? buildItemLedger(pickedId, orders, items) : null),
    [pickedId, orders, items]);

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* 품목 고르기 — 크기 고정. 검색으로 줄 수가 줄어도 창이 안 흔들린다. */}
      <div className="w-[280px] shrink-0 flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-2 border-b border-slate-100 relative">
          <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="품목명·규격으로 찾기"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-7 pr-2 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
        </div>
        <div className="flex-1 overflow-y-auto">
          {shown.length === 0 && <p className="px-3 py-8 text-center text-[11px] font-bold text-slate-300">찾는 품목이 없습니다</p>}
          {shown.map(i => (
            <button key={i.id} onClick={() => setPickedId(i.id)}
              className={`w-full text-left px-3 py-2 border-b border-slate-50 last:border-0 transition-colors ${
                pickedId === i.id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
              <span className={`block text-xs font-black truncate ${pickedId === i.id ? 'text-indigo-700' : 'text-slate-700'}`}>{i.name}</span>
              <span className="block text-[10px] font-bold text-slate-400">{i.spec || i.unit} · 재고 {fmt(Number(i.stock ?? 0))}{i.unit}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {!picked || !ledger ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 gap-2">
            <Package size={36} className="opacity-40"/>
            <p className="text-sm font-bold">왼쪽에서 품목을 고르세요</p>
          </div>
        ) : (<>
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-black text-slate-800">{picked.name}</span>
            <span className="text-[11px] font-bold text-slate-400">{picked.spec || picked.unit}</span>
            <div className="ml-auto flex items-center gap-3 text-[11px] font-black">
              <span className="text-emerald-600 flex items-center gap-0.5"><ArrowDownRight size={12}/>들어옴 {fmt(ledger.inSum)}</span>
              <span className="text-rose-500 flex items-center gap-0.5"><ArrowUpRight size={12}/>나감 {fmt(-ledger.outSum)}</span>
              <span className="text-slate-700">흐름 {fmt(ledger.net)}</span>
              <span className="text-slate-400">지금 재고 {fmt(Number(picked.stock ?? 0))}{picked.unit}</span>
            </div>
          </div>
          {/* 차이를 가리지 않는다 — 주문 밖에서 움직인 몫이 곧 실사·조정이다 */}
          {Math.abs(ledger.gap) > 0.001 && (
            <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-[11px] font-bold text-amber-700">
              흐름과 지금 재고가 <b>{fmt(ledger.gap)}{picked.unit}</b> 다릅니다 — 주문 밖에서 움직인 몫입니다(실사·재고조정·수동입력).
              이 원장은 주문에 남은 기록만 셉니다.
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {ledger.rows.length === 0 ? (
              <p className="px-3 py-12 text-center text-[11px] font-bold text-slate-300">주문으로 오간 기록이 없습니다</p>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>{['날짜', '갈래', '거래처', '내용', '수량', '잔량'].map((h, i) => (
                    <th key={h} className={`px-4 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest ${i >= 4 ? 'text-right' : ''}`}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {ledger.rows.map((r, i) => (
                    <tr key={`${r.orderId}-${r.kind}-${i}`} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2 text-[11px] font-bold text-slate-500 whitespace-nowrap">{r.date || '—'}</td>
                      <td className="px-4 py-2"><span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${KIND_CLS[r.kind]}`}>{r.kind}</span></td>
                      <td className="px-4 py-2 text-[11px] font-bold text-slate-600 truncate max-w-[140px]">{r.partnerName || '—'}</td>
                      <td className="px-4 py-2 text-[11px] text-slate-400 truncate max-w-[240px]">{r.note}</td>
                      <td className={`px-4 py-2 text-xs text-right font-black ${r.qty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {r.qty > 0 ? '+' : ''}{fmt(r.qty)}
                      </td>
                      <td className="px-4 py-2 text-xs text-right font-black text-slate-700 tabular-nums">{fmt(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>)}
      </div>
    </div>
  );
};

export default ItemLedger;
