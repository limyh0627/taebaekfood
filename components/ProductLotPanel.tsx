import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Tag, Truck } from 'lucide-react';
import { Item, RawMaterialLot } from '../src/shared/types';

export interface LotShipment {
  orderId: string;
  partnerName: string;
  date: string;
  qty: number;
}

interface Props {
  material: string;
  items: Item[];
  shipmentsByLot?: Map<string, LotShipment[]>;
  emptyHint?: string;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
const kgOf = (lots: RawMaterialLot[]) => lots.reduce((sum, lot) => sum + (lot.kgRemaining ?? 0), 0);

/** 완제품 로트는 material 문자열로 합치지 않고 로트를 소유한 품목 안에서만 보여준다. */
const ProductLotPanel: React.FC<Props> = ({ items, shipmentsByLot, emptyHint }) => {
  const [showDepleted, setShowDepleted] = useState(false);
  const lots = items.flatMap(item => (item.lots ?? [])
    .filter(lot => lot.qtyRemaining != null)
    .map(lot => ({ item, lot })));
  const active = lots.filter(({ lot }) => lot.status === 'active');
  const depleted = lots.filter(({ lot }) => lot.status !== 'active');

  if (lots.length === 0) {
    return <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-xs font-bold text-slate-400">
      {emptyHint ?? '아직 생성된 로트가 없습니다.'}
    </div>;
  }

  const renderLot = (item: Item, lot: RawMaterialLot, dim = false) => {
    const shortage = (lot.qtyRemaining ?? 0) < 0 || (lot.kgRemaining ?? 0) < 0;
    const goods = item.type === 'goods';
    return <article key={`${item.id}-${lot.id}`} className={`rounded-xl border bg-white overflow-hidden ${shortage ? 'border-rose-200' : 'border-slate-200'} ${dim ? 'opacity-60' : ''}`}>
      <div className="p-3 flex items-start gap-3">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${shortage ? 'bg-rose-50 text-rose-600' : 'bg-violet-50 text-violet-600'}`}><Truck size={14} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-black text-slate-800">{lot.supplierName || '공급처 미입력'}</span>
            {lot.lotNo && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black text-slate-600"><Tag size={9} />{lot.lotNo}</span>}
            {shortage && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-black text-rose-600">재고 부족</span>}
          </div>
          <p className="mt-1 text-[10px] font-bold text-slate-400">입고 {lot.receivedDate || '-'}</p>
        </div>
        <div className="text-right shrink-0">
          {goods ? <p className={`text-sm font-black tabular-nums ${shortage ? 'text-rose-600' : 'text-slate-900'}`}>{fmt(lot.qtyRemaining ?? 0)} {item.unit || '개'}</p> : <>
            <p className={`text-sm font-black tabular-nums ${shortage ? 'text-rose-600' : 'text-slate-900'}`}>{fmt(lot.kgRemaining ?? 0)} kg</p>
            <p className="text-[10px] font-bold text-slate-400">{fmt(lot.qtyRemaining ?? 0)} {item.unit || '개'}</p>
          </>}
        </div>
      </div>
    </article>;
  };

  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[9px] font-black text-slate-400">활성 로트</p><p className="mt-1 text-lg font-black text-slate-900">{active.length}<span className="ml-1 text-xs text-slate-400">건</span></p></div>
      <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[9px] font-black text-slate-400">총 잔량</p><p className="mt-1 text-lg font-black text-violet-700">{items.every(item => item.type === 'goods')
        ? fmt(active.reduce((sum, row) => sum + Number(row.lot.qtyRemaining ?? 0), 0))
        : fmt(kgOf(active.map(x => x.lot)))}<span className="ml-1 text-xs">{items.every(item => item.type === 'goods') ? (items[0]?.unit || '개') : 'kg'}</span></p></div>
    </div>
    <div className="space-y-2">{active.map(({ item, lot }) => renderLot(item, lot))}</div>
    {active.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 bg-white py-8 text-center text-xs font-bold text-slate-400">남은 로트가 없습니다.</div>}
    {depleted.length > 0 && <div>
      <button type="button" onClick={() => setShowDepleted(value => !value)} className="flex items-center gap-1 text-[11px] font-black text-slate-500">
        {showDepleted ? <ChevronDown size={13} /> : <ChevronRight size={13} />} 소진 로트 {depleted.length}건
      </button>
      {showDepleted && <div className="mt-2 space-y-2">{depleted.map(({ item, lot }) => renderLot(item, lot, true))}</div>}
    </div>}
  </div>;
};

export default ProductLotPanel;
