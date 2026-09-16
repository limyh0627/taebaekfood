import { useState } from 'react';
import type { ManualRow } from '../../../shared/statementLines';

/** 전표 품목 편집기에서만 쓰는 상태. 본체의 발행·조회 상태와 섞이지 않게 묶는다. */
export function useStatementItemEditor() {
  const [editablePrices, setEditablePrices] = useState<Record<string, string>>({});
  const [taxExemptOverrides, setTaxExemptOverrides] = useState<Record<string, boolean>>({});
  const [pricePanelEdits, setPricePanelEdits] = useState<Record<string, string>>({});
  const [priceSaveState, setPriceSaveState] = useState<Record<string, 'saving' | 'done' | 'error'>>({});
  const [manualMode, setManualMode] = useState(false);
  const [manualItems, setManualItems] = useState<ManualRow[]>([
    { name: '', spec: '', qty: '', price: '', isTaxExempt: false, note: '' },
  ]);
  const [activeSearchRow, setActiveSearchRow] = useState<number | null>(null);
  const [accountCodeOverrides, setAccountCodeOverrides] = useState<Record<string, string>>({});
  const [selectedItemIdx, setSelectedItemIdx] = useState<number | null>(null);
  const [quickItemId, setQuickItemId] = useState<string | undefined>();
  const [quickName, setQuickName] = useState('');
  const [quickSpec, setQuickSpec] = useState('');
  const [quickQty, setQuickQty] = useState('');
  const [quickPrice, setQuickPrice] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [quickIsTaxExempt, setQuickIsTaxExempt] = useState(false);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerQtys, setPickerQtys] = useState<Record<string, string>>({});
  const [noLinkIds, setNoLinkIds] = useState<Set<string>>(new Set());

  return {
    editablePrices, setEditablePrices, taxExemptOverrides, setTaxExemptOverrides,
    pricePanelEdits, setPricePanelEdits, priceSaveState, setPriceSaveState,
    manualMode, setManualMode, manualItems, setManualItems, activeSearchRow, setActiveSearchRow,
    accountCodeOverrides, setAccountCodeOverrides, selectedItemIdx, setSelectedItemIdx,
    quickItemId, setQuickItemId, quickName, setQuickName, quickSpec, setQuickSpec,
    quickQty, setQuickQty, quickPrice, setQuickPrice, quickNote, setQuickNote,
    quickSearchOpen, setQuickSearchOpen, quickIsTaxExempt, setQuickIsTaxExempt,
    showItemPicker, setShowItemPicker, pickerSearch, setPickerSearch, pickerQtys, setPickerQtys,
    noLinkIds, setNoLinkIds,
  };
}
