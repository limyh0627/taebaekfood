import React from 'react';
import type { AccountCode } from '../../../../types';
import type { LineItem } from '../../../shared/statementLines';

interface Props {
  items: LineItem[];
  selectedIndex: number | null;
  editablePrices: Record<string, string>;
  accountCodes: AccountCode[];
  formatAmount: (value: number) => string;
  onSelect: (index: number | null) => void;
  onPriceChange: (key: string, value: string) => void;
  onTaxChange: (key: string, isTaxExempt: boolean) => void;
  onAccountChange: (key: string, code: string) => void;
}

/** 주문에서 불러온 전표 품목 행. 직접 입력 행과 상태·수정 방식이 달라 따로 둔다. */
export default function StatementOrderItemRows(props: Props) {
  if (props.items.length === 0) {
    return <tr><td colSpan={11} className="px-3 py-12 text-center text-sm text-slate-300">주문을 선택하면 품목이 표시됩니다</td></tr>;
  }

  return <>{props.items.map((item, index) => {
    const selected = props.selectedIndex === index;
    return (
      <tr key={item.key} onClick={() => props.onSelect(selected ? null : index)}
        className={`cursor-pointer transition-colors text-xs ${selected ? 'bg-blue-50' : !item.accountCode ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-slate-50'}`}>
        <td className="px-3 py-2 text-slate-400 text-center w-8">{item.no}</td>
        <td className="px-3 py-2 text-[11px] font-black text-slate-800 max-w-[140px]">
          <span className="block truncate">{item.name}</span>
          {item.unknownItem && <span className="mt-0.5 inline-block text-[9px] font-black text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded-full whitespace-nowrap"
            title="주문의 품목이 삭제됐거나 id가 바뀌었습니다. 박스 품목이면 낱개로 안 풀리니 수량·단가를 확인하세요.">품목 없음 — 수량 확인</span>}
        </td>
        <td className="px-3 py-2 text-[11px] font-bold text-slate-700">{item.spec}</td>
        <td className="px-3 py-2 text-right text-[11px] w-12">{props.formatAmount(item.qty)}</td>
        <td className="px-3 py-2 w-28 shrink-0" onClick={e => e.stopPropagation()}>
          <input type="text" inputMode="decimal" placeholder={String(item.price)} value={props.editablePrices[item.key] ?? ''}
            onChange={e => props.onPriceChange(item.key, e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>
        </td>
        <td className="px-3 py-2 text-right text-slate-700">{props.formatAmount(item.supply)}</td>
        <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
          <button onClick={() => props.onTaxChange(item.key, item.taxUnknown ? false : !item.isTaxExempt)}
            className={`px-2 py-0.5 rounded-md text-[10px] font-black border transition-all ${item.taxUnknown ? 'bg-amber-50 text-amber-600 border-amber-300 hover:bg-amber-100' : item.isTaxExempt ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}
            title={item.taxUnknown ? '과세·면세를 정한 적이 없습니다 — 눌러서 정하세요' : undefined}>
            {item.taxUnknown ? '-' : item.isTaxExempt ? '면세' : props.formatAmount(item.tax)}
          </button>
        </td>
        <td className="px-3 py-2 text-right font-black text-slate-800">{props.formatAmount(item.total)}</td>
        <td className="px-3 py-2 w-24" onClick={e => e.stopPropagation()}>
          <select value={item.accountCode || ''} onChange={e => props.onAccountChange(item.key, e.target.value)}
            className={`w-full border rounded-lg px-1.5 py-1 text-[10px] font-bold outline-none focus:ring-2 focus:ring-amber-300 ${!item.accountCode ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-slate-50 border-slate-200'}`}>
            <option value="">계정 선택 ⚠</option>
            {props.accountCodes.map(code => <option key={code.id} value={code.code}>{code.code} {code.name}</option>)}
          </select>
        </td>
        <td className="px-3 py-2 w-8"/>
      </tr>
    );
  })}</>;
}
