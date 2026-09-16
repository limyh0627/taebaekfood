import React from 'react';
import { Plus, Search, X } from 'lucide-react';
import type { Item, PartnerItem } from '../../../../types';

export interface StatementItemPickerRow {
  pc: PartnerItem;
  product: Item;
}

interface Props {
  rows: StatementItemPickerRow[];
  search: string;
  quantities: Record<string, string>;
  priceEdits: Record<string, string>;
  priceSaveState: Record<string, 'saving' | 'done' | 'error'>;
  onSearchChange: (value: string) => void;
  onToggleItem: (itemId: string) => void;
  onQuantityChange: (itemId: string, value: string) => void;
  onPriceChange: (partnerItemId: string, value: string) => void;
  onSavePrice: (partnerItem: PartnerItem) => void;
  onToggleTax: (partnerItem: PartnerItem) => void;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

/** 품목 고르기와 거래처 단가·과세 수정 UI. 저장 판단은 작성 화면이 맡는다. */
export default function StatementItemPicker(props: Props) {
  const selectedCount = Object.values(props.quantities).filter(q => parseFloat(q) > 0).length;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onKeyDown={event => {
        if (event.key === 'Enter') void props.onConfirm();
        if (event.key === 'Escape') props.onClose();
      }}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl h-[70vh] flex flex-col overflow-hidden mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <div className="font-black text-slate-900">품목 선택</div>
            <div className="text-[10px] text-slate-400">{props.rows.length}품목</div>
          </div>
          <button type="button" onClick={props.onClose} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl">
            <X size={16}/>
          </button>
        </div>
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
            <input autoFocus type="text" value={props.search} onChange={e => props.onSearchChange(e.target.value)}
              placeholder="품목명 검색..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-slate-50 z-10">
              <tr>
                {['품목명', '규격', '단가', '과세', '수량'].map(title => (
                  <th key={title} className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{title}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {props.rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">품목이 없습니다</td></tr>
              ) : props.rows.map((row, index) => {
                const itemId = row.product.id;
                const quantity = props.quantities[itemId] || '';
                const selected = !!parseFloat(quantity);
                const saveState = props.priceSaveState[row.pc.id];
                return (
                  <tr key={itemId} onClick={() => props.onToggleItem(itemId)}
                    className={`cursor-pointer transition-colors ${selected ? 'bg-blue-50' : index % 2 === 0 ? 'hover:bg-slate-50' : 'bg-slate-50/50 hover:bg-slate-100'}`}>
                    <td className="px-4 py-2.5"><span className="text-xs font-black text-slate-800">{row.product.name}</span></td>
                    <td className="px-4 py-2.5 text-[11px] font-bold text-slate-700">{row.product.spec || ''}</td>
                    <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-end">
                        <input type="text" inputMode="decimal" placeholder="미설정"
                          value={props.priceEdits[row.pc.id] ?? (row.pc.price !== undefined ? String(row.pc.price) : '')}
                          onChange={e => props.onPriceChange(row.pc.id, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); props.onSavePrice(row.pc); } }}
                          className="w-20 text-right bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-300"/>
                        <button type="button" onClick={() => props.onSavePrice(row.pc)} disabled={saveState === 'saving'} title="단가 저장"
                          className={`px-1.5 py-1 rounded-lg text-[10px] font-black text-white transition-all disabled:opacity-60 ${saveState === 'done' ? 'bg-emerald-500' : saveState === 'error' ? 'bg-rose-500' : 'bg-violet-600 hover:bg-violet-700'}`}>
                          {saveState === 'saving' ? '…' : saveState === 'done' ? '✓' : '저장'}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                      <button type="button" onClick={() => props.onToggleTax(row.pc)} disabled={saveState === 'saving'}
                        title="눌러서 - → 과세 → 면세"
                        className={`text-[10px] font-black px-2 py-1 rounded-lg border transition-all disabled:opacity-50 ${row.pc.taxType === '면세' ? 'bg-indigo-500 text-white border-indigo-500' : row.pc.taxType === '과세' ? 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100' : 'bg-white text-slate-300 border-dashed border-slate-200 hover:bg-slate-50'}`}>
                        {row.pc.taxType === '면세' ? '면세' : row.pc.taxType === '과세' ? '과세' : '-'}
                      </button>
                    </td>
                    <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                      <input type="text" inputMode="decimal" value={quantity}
                        onChange={e => props.onQuantityChange(itemId, e.target.value)} placeholder="수량"
                        className={`w-20 text-right text-xs font-bold border rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-300 ${selected ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'}`}/>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100">
          <span className="text-xs text-slate-500">선택 <b className="text-blue-600">{selectedCount}</b>품목</span>
          <div className="flex gap-2">
            <button type="button" onClick={props.onClose} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">취소</button>
            <button type="button" onClick={() => void props.onConfirm()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black hover:bg-blue-700">
              <Plus size={12} strokeWidth={3}/>추가
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
