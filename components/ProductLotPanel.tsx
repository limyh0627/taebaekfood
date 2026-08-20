import React, { useState } from 'react';
import { Package, Layers, Tag, Truck, ChevronRight } from 'lucide-react';
import { Item, RawMaterialLot } from '../src/shared/types';
import { lotQtyRemaining } from '../src/shared/lotUtils';

/** 로트 하나가 어디로 나갔나 — 주문의 productConsumedLots를 거꾸로 읽어 만든다 */
export interface LotShipment {
  orderId: string;
  partnerName: string;
  date: string;
  qty: number;
}

interface Props {
  material: string;                              // 물질 축 — '볶음참깨'
  items: Item[];                                 // 이 물질의 박스 로트를 지닌 완제품들
  shipmentsByLot?: Map<string, LotShipment[]>;   // 로트id → 나간 곳
  emptyHint?: string;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

/**
 * 완제품(박스) 로트 패널 — 개수로 세는 재고의 이력.
 *
 * 벌크 로트와 **따로** 보여 준다. 같은 볶음참깨여도 재고를 들고 있는 품목이 다르고
 * (벌크 홀더 10kg vs 박스 품목 23박스), 한 덩어리로 합치면 재고를 두 번 센 것처럼 보인다.
 * 묶는 축은 물질(lot.material)이고, 합계는 품목별로 나눠서 낸다.
 */
const ProductLotPanel: React.FC<Props> = ({ material, items, shipmentsByLot, emptyHint }) => {
  const [openDepleted, setOpenDepleted] = useState<Record<string, boolean>>({});

  const rows = items
    .map(it => {
      const all = (it.lots ?? []).filter(l => (l.material ?? material) === material && l.qtyRemaining != null);
      return { item: it, active: all.filter(l => l.status === 'active'), depleted: all.filter(l => l.status !== 'active') };
    })
    .filter(r => r.active.length > 0 || r.depleted.length > 0);

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-violet-100 px-3 py-5 text-center text-xs font-bold text-slate-300">
        {emptyHint ?? '박스 로트가 없습니다. 가공입고·생산 시 자동 생성됩니다.'}
      </div>
    );
  }

  const totalQty = rows.reduce((s, r) => s + lotQtyRemaining(r.active), 0);
  const totalKg = rows.reduce((s, r) => s + r.active.reduce((a, l) => a + (l.kgRemaining ?? 0), 0), 0);

  const lotRow = (lot: RawMaterialLot, unit: string, dim: boolean) => {
    const ships = shipmentsByLot?.get(lot.id) ?? [];
    const isCarry = lot.supplierName === '이월';
    const short = (lot.qtyRemaining ?? 0) < 0;
    return (
      <div key={lot.id} className={`px-3 py-2.5 border-t border-violet-50 ${dim ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${short ? 'bg-rose-100' : 'bg-violet-100'}`}>
            {isCarry ? <Layers size={13} className={short ? 'text-rose-600' : 'text-violet-600'} />
              : <Truck size={13} className="text-violet-600" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-black text-slate-800">{lot.supplierName}</span>
              {lot.lotNo && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 inline-flex items-center gap-0.5">
                  <Tag size={9} /> {lot.lotNo}
                </span>
              )}
              {short && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600">로트 없이 나감</span>}
            </div>
            <span className="text-[10px] text-slate-400">입고 {lot.receivedDate}</span>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-sm font-black ${short ? 'text-rose-600' : 'text-violet-700'}`}>{fmt(lot.qtyRemaining ?? 0)} {unit}</div>
            <div className="text-[10px] text-slate-400">{fmt(lot.kgRemaining ?? 0)} kg</div>
          </div>
        </div>
        {/* 회수·클레임이 실제로 보는 줄 — 이 로트가 어느 거래처로 나갔나 */}
        {ships.length > 0 && (
          <div className="mt-1.5 ml-9 flex flex-wrap gap-1">
            {ships.map((s, i) => (
              <span key={`${s.orderId}-${i}`} className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-100">
                {s.partnerName} {fmt(s.qty)}{unit}
                <span className="text-violet-400 font-black"> · {s.date?.slice(5)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-black text-violet-700 uppercase tracking-wide">박스 로트 (선입선출)</span>
        <span className="text-sm font-black text-violet-800">
          합계 {fmt(totalQty)}개 <span className="text-[11px] font-bold text-violet-500">({fmt(totalKg)} kg)</span>
        </span>
      </div>

      {rows.map(({ item, active, depleted }) => {
        const unit = item.unit ?? '개';
        const open = !!openDepleted[item.id];
        return (
          <div key={item.id} className="bg-white rounded-xl border border-violet-100 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-violet-50/60">
              <Package size={12} className="text-violet-500 shrink-0" />
              <span className="text-[11px] font-black text-slate-700 truncate">{item.name}</span>
              {item.spec && <span className="text-[10px] font-bold text-slate-400 shrink-0">{item.spec}</span>}
              <span className="ml-auto text-[11px] font-black text-violet-700 shrink-0">{fmt(lotQtyRemaining(active))} {unit}</span>
            </div>
            {active.length === 0 ? (
              <div className="px-3 py-3 text-center text-[11px] font-bold text-slate-300">남은 로트가 없습니다</div>
            ) : active.map(l => lotRow(l, unit, false))}
            {depleted.length > 0 && (
              <div className="px-3 py-1.5 border-t border-violet-50">
                <button
                  onClick={(e) => { e.stopPropagation(); setOpenDepleted(p => ({ ...p, [item.id]: !p[item.id] })); }}
                  className="text-[10px] font-black text-slate-400 hover:text-slate-600 transition-colors inline-flex items-center gap-0.5"
                >
                  <ChevronRight size={10} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
                  소진된 로트 {depleted.length}건
                </button>
              </div>
            )}
            {open && depleted.map(l => lotRow(l, unit, true))}
          </div>
        );
      })}
    </div>
  );
};

export default ProductLotPanel;
