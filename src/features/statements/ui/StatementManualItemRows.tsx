import React from 'react';
import { X } from 'lucide-react';
import type { AccountCode, Item, PartnerItem } from '../../../../types';
import { bomOf } from '../../../shared/bomIndex';
import { lineAmountOf } from '../../../shared/lineAmount';
import type { ManualRow } from '../../../shared/statementLines';

export interface StatementManualSearchResult {
  pc: Pick<PartnerItem, 'id' | 'price' | 'taxType'>;
  product: Item;
}

interface Props {
  rows: ManualRow[];
  readOnly: boolean;
  selectedIndex: number | null;
  activeSearchIndex: number | null;
  statementType: string;
  accountCodes: AccountCode[];
  formatAmount: (value: number) => string;
  searchResults: (row: ManualRow) => StatementManualSearchResult[];
  onSelect: (index: number | null) => void;
  onChange: (index: number, patch: Partial<ManualRow>) => void;
  onSearchFocus: (index: number) => void;
  onSearchBlur: () => void;
  onChooseProduct: (index: number, result: StatementManualSearchResult) => void;
  onRemove: (index: number) => void;
}

/** 직접 입력한 전표 줄. 주문 품목과 달리 이름·규격·수량까지 고칠 수 있다. */
export default function StatementManualItemRows(props: Props) {
  return <>{props.rows.map((row, index) => {
    const { supply, tax } = lineAmountOf(row.qty, row.price, row.isTaxExempt);
    const selected = props.selectedIndex === index;
    const results = props.readOnly ? [] : props.searchResults(row);
    const negative = (parseFloat(row.qty) || 0) < 0;
    return (
      <tr key={index} onClick={() => props.onSelect(selected ? null : index)}
        className={`cursor-pointer transition-colors text-xs ${selected ? 'bg-blue-50' : negative ? 'bg-rose-50 hover:bg-rose-100' : 'hover:bg-slate-50'}`}>
        <td className="px-3 py-2 text-slate-400 text-center w-8">{index + 1}</td>
        <td className="px-3 py-2 relative min-w-[120px]">
          {props.readOnly ? <span className="font-black text-slate-800">{row.name}</span> : <>
            <input type="text" placeholder="제품명..." value={row.name}
              onChange={e => props.onChange(index, { itemId: undefined, name: e.target.value })}
              onFocus={() => props.onSearchFocus(index)} onBlur={props.onSearchBlur}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 min-w-[120px]"/>
            {props.activeSearchIndex === index && results.length > 0 && (
              <div className="absolute left-0 top-full z-50 mt-1 w-64 h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl">
                {results.slice(0, 50).map(result => {
                  const parts = bomOf(result.product.id);
                  const container = parts.find(line => line.child?.category === '용기')?.child?.name;
                  const cap = parts.find(line => line.child?.category === '마개')?.child?.name;
                  const info = result.product.oil || result.product.spec || '';
                  return <button key={result.pc.id} onMouseDown={() => props.onChooseProduct(index, result)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-blue-50 text-left transition-colors">
                    <span className="font-black text-slate-800">{result.product.name}</span>
                    <span className="text-slate-400 text-[10px]">{[container, cap, info].filter(Boolean).join(' · ')}</span>
                  </button>;
                })}
              </div>
            )}
          </>}
        </td>
        <td className="px-3 py-2 w-20">{props.readOnly
          ? <span className="font-bold text-slate-700">{row.spec}</span>
          : <input type="text" placeholder="규격" value={row.spec} onChange={e => props.onChange(index, { spec: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>}</td>
        <td className="px-3 py-2 w-16">{props.readOnly
          ? <span className="block text-right font-bold">{row.qty}</span>
          : <input type="text" inputMode="decimal" placeholder="0" value={row.qty} onChange={e => props.onChange(index, { qty: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>}</td>
        <td className="px-3 py-2 w-24">{props.readOnly
          ? <span className="block text-right font-bold">{props.formatAmount(Number(row.price) || 0)}</span>
          : <input type="text" inputMode="decimal" placeholder="0" value={row.price} onChange={e => props.onChange(index, { price: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>}</td>
        <td className={`px-3 py-2 text-right ${supply < 0 ? 'text-rose-600 font-bold' : 'text-slate-700'}`}>{supply !== 0 ? props.formatAmount(supply) : '-'}</td>
        <td className="px-3 py-2 text-center">{props.readOnly
          ? <span className={`text-[10px] font-black ${row.isTaxExempt ? 'text-indigo-600' : ''}`}>{row.isTaxExempt ? '면세' : tax !== 0 ? props.formatAmount(tax) : '-'}</span>
          : <button onClick={e => { e.stopPropagation(); props.onChange(index, { isTaxExempt: !row.isTaxExempt }); }}
              className={`px-2 py-0.5 rounded-md text-[10px] font-black border transition-all ${row.isTaxExempt ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}>
              {row.isTaxExempt ? '면세' : tax !== 0 ? props.formatAmount(tax) : '-'}
            </button>}</td>
        <td className={`px-3 py-2 text-right font-black ${supply + tax < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{supply + tax !== 0 ? props.formatAmount(supply + tax) : '-'}</td>
        <td className="px-3 py-2 w-24">{props.readOnly
          ? <span className="text-[10px] font-black text-slate-500">{row.accountCode || (props.statementType === '매출' ? '800' : '-')}</span>
          : <select value={row.accountCode || (props.statementType === '매출' ? '800' : '')} onClick={e => e.stopPropagation()}
              onChange={e => props.onChange(index, { accountCode: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-300">
              <option value="">-</option>{props.accountCodes.map(code => <option key={code.id} value={code.code}>{code.code} {code.name}</option>)}
            </select>}</td>
        <td className="px-3 py-2 w-8 text-center">{!props.readOnly && props.rows.length > 1 && (
          <button onClick={e => { e.stopPropagation(); props.onRemove(index); }} className="text-slate-300 hover:text-rose-400 transition-colors"><X size={14}/></button>
        )}</td>
      </tr>
    );
  })}</>;
}
