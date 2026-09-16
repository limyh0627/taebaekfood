import React from 'react';
import { Plus } from 'lucide-react';
import type { Item, PartnerItem } from '../../../../types';
import { bomOf } from '../../../shared/bomIndex';

export interface StatementQuickItemResult {
  pc: Pick<PartnerItem, 'id' | 'price' | 'taxType'>;
  product: Item;
}

interface Props {
  name: string;
  spec: string;
  quantity: string;
  price: string;
  note: string;
  searchOpen: boolean;
  results: StatementQuickItemResult[];
  productCost: number;
  salePrice: number;
  unitSupply: number;
  supply: number;
  tax: number;
  marginRate: number;
  showUnitSupply: boolean;
  formatAmount: (value: number) => string;
  onNameChange: (value: string) => void;
  onNameFocus: () => void;
  onNameBlur: () => void;
  onSpecChange: (value: string) => void;
  onQuantityChange: (value: string) => void;
  onPriceChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onSelect: (result: StatementQuickItemResult) => void;
  onAdd: () => void;
  onOpenPicker: () => void;
}

/**
 * 전표 작성의 빠른 품목 입력 양식.
 * 검색·계산·저장은 부모가 맡고, 이 컴포넌트는 같은 입력 모양을 한곳에서 유지한다.
 */
export default function StatementQuickItemBar(props: Props) {
  const margin = (props.marginRate * 100).toFixed(1);

  return (
    <div className="flex-shrink-0 border-b border-slate-100 px-5 py-2.5 bg-white space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <input type="text" value={props.name} placeholder="품목명..."
            onChange={e => props.onNameChange(e.target.value)} onFocus={props.onNameFocus}
            onBlur={props.onNameBlur}
            className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-40"/>
          {props.results.length > 0 && props.searchOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
              <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                <span className="text-[10px] font-black text-slate-500">품목 선택</span>
              </div>
              <div className="h-60 overflow-y-auto">
                {props.results.slice(0, 50).map(result => {
                  const parts = bomOf(result.product.id);
                  const container = parts.find(line => line.child?.category === '용기')?.child?.name;
                  const cap = parts.find(line => line.child?.category === '마개')?.child?.name;
                  const info = result.product.oil || result.product.spec || '';
                  const tags = [container, cap, info].filter(Boolean).join(' · ');
                  return (
                    <button key={result.pc.id} type="button" onMouseDown={() => props.onSelect(result)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-blue-50 text-left transition-colors">
                      <span className="font-black text-slate-800">{result.product.name}</span>
                      <span className="text-slate-400 text-[10px]">{tags}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <input type="text" value={props.spec} placeholder="규격" onChange={e => props.onSpecChange(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-20"/>
        <input type="text" inputMode="decimal" value={props.quantity} placeholder="수량" onChange={e => props.onQuantityChange(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-20 text-right"/>
        <input type="text" inputMode="decimal" value={props.price} placeholder="단가" onChange={e => props.onPriceChange(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-24 text-right"/>
        <input type="text" value={props.note} placeholder="비고" onChange={e => props.onNoteChange(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 w-28"/>
        <button type="button" onClick={props.onAdd}
          className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-black hover:bg-slate-200 transition-all">
          직접 추가
        </button>
        <button type="button" onClick={props.onOpenPicker}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-black hover:bg-blue-700 transition-all">
          <Plus size={11} strokeWidth={3}/>품목 선택
        </button>
      </div>
      <div className="flex items-center gap-4 text-[10px] text-slate-400">
        <span>원가 <b className="text-slate-600">{props.formatAmount(props.productCost)}</b></span>
        <span>매출단가 <b className="text-slate-600">{props.salePrice > 0 ? props.formatAmount(props.salePrice) : '-'}</b>
          {props.salePrice > 0 && props.showUnitSupply
            ? <span className="ml-1 text-slate-400">(공급가 <b className="text-slate-500">{props.formatAmount(props.unitSupply)}</b>)</span>
            : null}
        </span>
        {props.supply > 0 && <span>공급가액 <b className="text-blue-600">{props.formatAmount(props.supply)}</b></span>}
        {props.tax > 0 && <span>세액 <b className="text-slate-600">{props.formatAmount(props.tax)}</b></span>}
        {props.salePrice > 0 && <span>마진율 <b className={Number(margin) > 0 ? 'text-emerald-600' : 'text-rose-600'}>{margin}%</b></span>}
      </div>
    </div>
  );
}
