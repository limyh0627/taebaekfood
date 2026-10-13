import { displaySpec } from '../../../shared/boxSpec';
import React from 'react';
import { CLEARED_PURCHASE_UNIT, changePurchaseUnitRowQuantity, defaultManualPurchaseUnitRowFields, purchaseUnitInputParts, changeManualPurchaseUnitInput, MANUAL_PURCHASE_UNIT_ID } from '../../../shared/purchaseUnitRow';
import { isRawPurchaseItem } from '../../../../functions/src/shared/purchaseCost';
import { X } from 'lucide-react';
import type { AccountCode, Item, PartnerItem, ItemPurchaseUnit, CompanyId, PurchaseUnitSnapshot } from '../../../../types';
import { bomOf, type BomIndex } from '../../../shared/bomIndex';
import { lineAmountOf } from '../../../shared/lineAmount';
import { manualAccountCode, type ManualRow, type LineItem, type StatementType } from '../../../shared/statementLines';

export interface StatementManualSearchResult {
  pc: Pick<PartnerItem, 'id' | 'price' | 'taxType' | 'Account_Code'>;
  product: Item;
}

interface Props {
  preservedPurchaseUnitLineIndices?: readonly number[];
  companyId?: CompanyId;
  selectedPartnerId?: string;
  lockedPurchaseUnitItemIds?: ReadonlySet<string>;
  purchaseUnits?: readonly ItemPurchaseUnit[];
  purchaseUnitLoadError?: string;
  bomIndex?: BomIndex;
  rows: ManualRow[];
  savedLines?: readonly LineItem[];
  readOnly: boolean;
  selectedIndex: number | null;
  activeSearchIndex: number | null;
  statementType: string;
  accountCodes: AccountCode[];
  items?: readonly Pick<Item, 'id' | 'type' | 'subtype' | 'unit' | 'phantom' | 'archived'>[];
  linked?: readonly { itemId: string; name: string }[];
  formatAmount: (value: number) => string;
  searchResults: (row: ManualRow) => StatementManualSearchResult[];
  onSelect: (index: number | null) => void;
  onChange: (index: number, patch: Partial<ManualRow>) => void;
  onSearchFocus: (index: number) => void;
  onSearchBlur: () => void;
  onChooseProduct: (index: number, result: StatementManualSearchResult, unitFields?: Partial<PurchaseUnitSnapshot>) => void;
  onRemove: (index: number) => void;
}

/** 직접 입력한 전표 줄. 주문 품목과 달리 이름·규격·수량까지 고칠 수 있다. */
export default function StatementManualItemRows(props: Props) {
  return <>{props.rows.map((row, index) => {
    const saved = props.readOnly ? props.savedLines?.[index] : undefined;
    const { supply, tax } = saved ?? lineAmountOf(row.qty, row.price, row.isTaxExempt);
    const total = saved?.total ?? supply + tax;
    const selected = props.selectedIndex === index;
    const results = props.readOnly ? [] : props.searchResults(row);
    const unitLocked = !!row.purchaseUnitId && !!row.itemId && !!props.lockedPurchaseUnitItemIds?.has(row.itemId);
    const structureLocked = (props.preservedPurchaseUnitLineIndices ?? []).some(savedIndex => savedIndex >= index);
    const clearUnit = CLEARED_PURCHASE_UNIT;
    const changeQuantity = (qty: string) => props.onChange(index, { qty, ...changePurchaseUnitRowQuantity(row, qty),...(row.purchaseUnitId===MANUAL_PURCHASE_UNIT_ID?{purchaseQuantityKg:undefined}:{}) });
    const rawPurchase = props.statementType === '매입' && isRawPurchaseItem(props.items?.find(item => item.id === row.itemId));
    const unitInput=purchaseUnitInputParts(row,props.items?.find(item=>item.id===row.itemId)?.unit??'kg');
    const negative = (parseFloat(row.qty) || 0) < 0;
    return (
      <React.Fragment key={index}><tr onClick={() => props.onSelect(selected ? null : index)}
        className={`cursor-pointer transition-colors text-xs ${selected ? 'bg-blue-50' : negative ? 'bg-rose-50 hover:bg-rose-100' : 'hover:bg-slate-50'}`}>
        <td className="px-3 py-2 text-slate-400 text-center w-8">{index + 1}</td>
        <td className="px-3 py-2 relative min-w-[120px]">
          {props.readOnly ? <span className="font-black text-slate-800">{row.name}</span> : <>
            <input disabled={unitLocked} type="text" placeholder="제품명..." value={row.name}
              onChange={e => props.onChange(index, { itemId: undefined, purchaseQuantityKg: undefined, ...clearUnit, name: e.target.value })}
              onFocus={() => props.onSearchFocus(index)} onBlur={props.onSearchBlur}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300 min-w-[120px]"/>
            {props.activeSearchIndex === index && results.length > 0 && (
              <div className="absolute left-0 top-full z-50 mt-1 w-64 h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl">
                {results.slice(0, 50).map(result => {
                  const parts = props.bomIndex ? props.bomIndex.of(result.product.id) : bomOf(result.product.id);
                  const container = parts.find(line => line.child?.category === '용기')?.child?.name;
                  const cap = parts.find(line => line.child?.category === '마개')?.child?.name;
                  const info = result.product.oil || result.product.spec || '';
                  return <button key={result.pc.id} onMouseDown={() => props.onChooseProduct(index, result, props.statementType === '매입' && isRawPurchaseItem(result.product) ? defaultManualPurchaseUnitRowFields(row.qty) : {})}
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
          ? <span className="font-bold text-slate-700">{displaySpec(row.spec)}</span>
          : <input type="text" placeholder="규격" value={row.spec} onChange={e => props.onChange(index, { spec: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-300"/>}</td>
        <td className="px-3 py-2 w-24">
          {props.readOnly
          ? <span className="block text-right font-bold">{row.qty}</span>
          : <input aria-label={`${index + 1}행 거래 수량`} disabled={unitLocked} type="text" inputMode="decimal" placeholder="0" value={row.qty} onChange={e => changeQuantity(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-right outline-none focus:ring-2 focus:ring-blue-300"/>}
        </td>

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
        <td className={`px-3 py-2 text-right font-black ${total < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{total !== 0 ? props.formatAmount(total) : '-'}</td>
        <td className="px-3 py-2 w-24">{props.readOnly
          ? <span className="text-[10px] font-black text-slate-500">{saved ? saved.accountCode || '-' : manualAccountCode(row, props.statementType as StatementType, props.linked, props.items) || '-'}</span>
          : <select value={manualAccountCode(row, props.statementType as StatementType, props.linked, props.items) || ''} onClick={e => e.stopPropagation()}
              disabled={unitLocked} onChange={e => props.onChange(index, { accountCode: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1 text-[10px] font-bold outline-none focus:ring-2 focus:ring-blue-300">
              <option value="">-</option>{props.accountCodes.map(code => <option key={code.id} value={code.code}>{code.code} {code.name}</option>)}
            </select>}</td>
        <td className="px-3 py-2 w-8 text-center">{!props.readOnly && !unitLocked && !structureLocked && props.rows.length > 1 && (
          <button aria-label={`${index + 1}행 삭제`} onClick={e => { e.stopPropagation(); props.onRemove(index); }} className="text-slate-300 hover:text-rose-400 transition-colors"><X size={14}/></button>
        )}</td>
      </tr>
      {rawPurchase && <tr onClick={e => e.stopPropagation()} className={selected ? 'bg-blue-50/50' : 'bg-slate-50/50'}>
        <td colSpan={10} className="px-4 pb-3 pt-1">
          {/* 설정을 좁은 수량 열에 넣으면 기본 입력 행도 늘어나므로 표 전체 폭을 쓴다. */}
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
          {rawPurchase && <div className="min-w-0 flex-1 space-y-1 text-[11px] text-slate-500">
            {props.readOnly ? <span>{row.purchaseUnit??props.items?.find(item=>item.id===row.itemId)?.unit??'kg'}</span> : <>
              <label className="block max-w-[320px]">매입단위
                <span className="mt-1 flex gap-2">
                  <input aria-label={(index + 1) + '행 매입단위 숫자'} type="text" inputMode="decimal" disabled={unitLocked} readOnly={unitInput.legacy} value={unitInput.amount}
                    onClick={e=>e.stopPropagation()} onChange={e=>{if(unitInput.legacy||!/^\d*(?:\.\d*)?$/.test(e.target.value))return;props.onChange(index,{...changeManualPurchaseUnitInput(e.target.value,unitInput.unit as 'kg'|'g',row.qty),purchaseQuantityKg:undefined});}}
                    className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1"/>
                  <select aria-label={(index + 1) + '행 매입단위 단위'} disabled={unitLocked} value={unitInput.legacy?'legacy':unitInput.unit} onClick={e=>e.stopPropagation()} onChange={e=>{if(e.target.value==='legacy')return;props.onChange(index,{...changeManualPurchaseUnitInput(unitInput.amount,e.target.value as 'kg'|'g',row.qty),purchaseQuantityKg:undefined});}}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1">
                    {unitInput.legacy&&<option value="legacy">{unitInput.unit}</option>}<option value="kg">kg</option><option value="g">g</option>
                  </select>
                </span>
              </label>
            </>}
          </div>}
          </div>
        </td>
      </tr>}
      </React.Fragment>
    );
  })}</>;
}
