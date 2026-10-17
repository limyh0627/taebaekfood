import React, {useState} from 'react';
import type {Item,PartnerItem,AccountCode,AccountGroup} from '../../../shared/types';
import {filterCodesForContext} from '../../admin/financials';

export const ServiceTerms: React.FC<{
  item: Item; partnerId: string; direction: 'in' | 'out'; value?: PartnerItem;
  accountCodes: AccountCode[]; accountGroups: AccountGroup[]; onSave: (value: PartnerItem) => void | Promise<void>;
}> = ({ item, partnerId, direction, value, accountCodes, accountGroups, onSave }) => {
  const [price, setPrice] = useState(String(value?.price ?? ''));
  const [taxType, setTaxType] = useState(value?.taxType ?? '');
  const [code, setCode] = useState(value?.Account_Code ?? '');
  const [busy, setBusy] = useState(false);
  const eligibleCodes = filterCodesForContext(accountCodes, accountGroups, direction === 'out' ? '매출' : '매입');
  const save = async () => {
    if (busy) return;
    if (!Number.isFinite(Number(price)) || Number(price) <= 0 || !taxType || !code ||
        !eligibleCodes.some(account => account.code === code)) {
      window.alert('용역 단가, 과세 여부, 계정과목을 모두 선택해 주세요.');
      return;
    }
    setBusy(true);
    try {
      await onSave({ ...(value ?? {}), id: value?.id ?? `${item.id}_${partnerId}_${direction}`,
        itemId: item.id, partnerId, Direction: direction, price: Number(price),
        taxType: taxType as '과세' | '면세', Account_Code: code } as PartnerItem);
    } catch (error) {
      window.alert(`용역 거래조건을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setBusy(false); }
  };
  return <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2" onClick={e => e.stopPropagation()}>
    <label className="text-[10px] font-bold text-slate-500">단가
      <input aria-label="용역 단가" type="number" min="0" value={price} onChange={e => setPrice(e.target.value)}
        className="block w-28 rounded-md border border-slate-200 px-2 py-1 text-xs" />
    </label>
    <label className="text-[10px] font-bold text-slate-500">과세
      <select aria-label="용역 과세 여부" value={taxType} onChange={e => setTaxType(e.target.value as '과세' | '면세' | '')}
        className="block rounded-md border border-slate-200 px-2 py-1 text-xs">
        <option value="">선택</option><option value="과세">과세</option><option value="면세">면세</option>
      </select>
    </label>
    <label className="text-[10px] font-bold text-slate-500">계정과목
      <select aria-label="용역 계정과목" value={code} onChange={e => setCode(e.target.value)}
        className="block max-w-44 rounded-md border border-slate-200 px-2 py-1 text-xs">
        <option value="">선택</option>{eligibleCodes.map(account =>
          <option key={account.id} value={account.code}>{account.code} {account.name}</option>)}
      </select>
    </label>
    <button type="button" disabled={busy} onClick={save}
      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">{busy ? '저장 중…' : '저장'}</button>
  </div>;
};
