import React from 'react';
import {usePurchaseUnitEditor} from './hooks/usePurchaseUnitEditor';
import type { CompanyId, Item, ItemPurchaseUnit, Partner } from '../../shared/types';
import ModalShell from '../../shared/components/ModalShell';

import { buysFrom } from '../../shared/partnerRole';

export default function PurchaseUnitManagerModal({ companyId, item, partners, onClose }: { companyId: CompanyId; item: Item; partners: Partner[]; onClose: () => void }) {
  const editor=usePurchaseUnitEditor({companyId,item,onClose});
  const {units,selected,partnerId,label,weight,isDefault,error,busy,reset,choose,save}=editor;
  const setPartnerId=(value:string)=>editor.patch({partnerId:value}),setLabel=(value:string)=>editor.patch({label:value}),setWeight=(value:string)=>editor.patch({weight:value}),setIsDefault=(value:boolean)=>editor.patch({isDefault:value});
  return <ModalShell title="매입단위 관리" subtitle={item.name} onClose={editor.close} bodyClassName="space-y-4">
    <p className="text-xs text-slate-500">등록한 단위의 실제 중량을 입력하세요. 거래 수량과 단가는 그대로 두고 입고 재고를 kg로 환산합니다. 기존 전표에는 영향을 주지 않습니다.</p>
    <div className="space-y-2">{units.length === 0 && <p className="text-sm text-slate-400">등록된 매입단위가 없습니다.</p>}{units.map(unit => <button key={unit.id} disabled={busy} type="button" onClick={() => choose(unit)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-3 text-left text-sm"><span>{unit.purchaseUnit} · {unit.unitKg}kg<br/><span className="text-xs text-slate-500">{partners.find(p => p.id === unit.partnerId)?.name ?? '모든 매입거래처'}</span></span><span>{unit.active ? '사용중' : '사용안함'}{unit.isDefault ? ' · 기본' : ''}</span></button>)}</div>
    {units.filter(unit => unit.active && unit.isDefault && (unit.partnerId ?? '') === partnerId).length > 1 && <p className="text-sm text-amber-700">이 거래처의 기본 단위가 여러 개라 자동 선택되지 않습니다. 사용할 기본 단위 하나만 남겨 주세요.</p>}
    <div className="space-y-3 border-t border-slate-200 pt-4">
      <div className="flex items-center justify-between"><strong>{selected ? '매입단위 수정' : '매입단위 등록'}</strong>{selected && <button type="button" disabled={busy} onClick={reset} className="text-sm text-indigo-600">새 단위 등록</button>}</div>
      <label className="block text-xs">적용 거래처<select aria-label="적용 거래처" disabled={!!selected || busy} value={partnerId} onChange={e => setPartnerId(e.target.value)} className="mt-1 w-full rounded-lg border p-2"><option value="">모든 매입거래처</option>{partners.filter(p => p.companyId === companyId && buysFrom(p)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-3"><label className="text-xs">매입단위 이름<input aria-label="매입단위 이름" disabled={busy} value={label} onChange={e => setLabel(e.target.value)} placeholder="예: 상자" className="mt-1 w-full rounded-lg border p-2"/></label><label className="text-xs">한 단위의 실제 중량(kg)<input aria-label="한 단위의 실제 중량 kg" disabled={busy} type="number" min="0.001" step="0.001" value={weight} onChange={e => setWeight(e.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label></div>
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={isDefault} disabled={busy} onChange={e => setIsDefault(e.target.checked)}/>새 전표의 기본 매입단위</label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex gap-2">{selected && <button type="button" disabled={busy} onClick={() => save(!selected.active)} className="rounded-lg border px-4 py-2 text-sm">{selected.active ? '사용 중지' : '사용 재개'}</button>}<button type="button" disabled={busy || !label.trim() || !Number.isFinite(Number(weight)) || Number(weight) <= 0} onClick={() => save(selected?.active ?? true)} className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white">{busy ? '저장중...' : '저장'}</button></div>
    </div>
  </ModalShell>;
}
