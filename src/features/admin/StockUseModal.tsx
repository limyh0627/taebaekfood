import React, { useState, useMemo } from 'react';
import { Package, X, CornerDownRight } from 'lucide-react';
import { StockUseRow, resolveStockUse, toStockUsePlan } from './stockUseRows';
import type { StockUsePlan } from './orderStockEngine';

/**
 * 작업완료 직전 "이미 있는 재고를 얼마나 쓸까" 확인.
 *
 * 기본값은 쓸 수 있는 만큼(= min(주문량, 재고))이 이미 채워져 있어 그냥 [작업완료]만 누르면 된다.
 * 수량을 줄이거나 [사용안함]을 누르면 그만큼 새로 생산한다 — 재고는 그대로 남는다.
 * 박스 재고로 주문량을 다 못 채우면 낱개 행이 따라 나온다(그것도 모자라면 전부 생산).
 *
 * 한 주문의 모든 라인을 한 화면에 모은다 — 10개입·20개입이 같은 낱개 재고를 노리므로
 * 순차 팝업이면 배분이 안 보인다.
 */
interface Props {
  partnerName: string;
  rows: StockUseRow[];
  onConfirm: (plan: StockUsePlan) => void;
  onCancel: () => void;
}

const num = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const StockUseModal: React.FC<Props> = ({ partnerName, rows, onConfirm, onCancel }) => {
  const [ownOverride, setOwnOverride] = useState<Record<number, number>>({});
  const [looseOverride, setLooseOverride] = useState<Record<number, number>>({});

  const states = useMemo(
    () => resolveStockUse(rows, ownOverride, looseOverride),
    [rows, ownOverride, looseOverride],
  );

  const totalUse = states.reduce((s, x) => s + x.own + (x.loose?.value ?? 0), 0);

  const qtyInput = (value: number, max: number, onChange: (n: number) => void) => (
    <input
      type="number" min={0} max={max} value={value}
      onChange={e => onChange(Math.max(0, Math.min(max, num(e.target.value))))}
      onFocus={e => e.target.select()}
      className="w-20 px-2 py-1.5 text-right font-black text-slate-900 bg-white border-2 border-slate-200 rounded-lg text-sm focus:border-emerald-400 focus:outline-none"
    />
  );

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 pb-4 flex items-start gap-4 border-b border-slate-100">
          <div className="p-2.5 bg-emerald-50 rounded-2xl shrink-0">
            <Package size={22} className="text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-slate-900 leading-snug">재고가 있습니다 — 사용하시겠습니까?</p>
            <p className="text-xs text-slate-400 font-medium mt-1">
              {partnerName} · 쓴 만큼 재고에서 빠지고, 모자란 만큼만 새로 생산합니다
            </p>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 transition-all shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {states.map(({ row, own, ownMax, shortUnits, loose }) => (
            <div key={row.idx} className="rounded-2xl border-2 border-slate-100 p-3.5">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate">{row.name}</p>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">
                    주문 {row.ordered}{row.unitLabel} · 재고 {row.stock}{row.unitLabel}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {qtyInput(own, ownMax, n => setOwnOverride(o => ({ ...o, [row.idx]: n })))}
                  <span className="text-xs font-bold text-slate-400">{row.unitLabel}</span>
                  <button
                    onClick={() => setOwnOverride(o => ({ ...o, [row.idx]: 0 }))}
                    className="px-2 py-1.5 bg-slate-100 text-slate-500 font-bold rounded-lg text-[11px] hover:bg-slate-200 transition-all"
                  >
                    사용안함
                  </button>
                </div>
              </div>

              {loose && (
                <div className="flex items-center gap-3 mt-2.5 pt-2.5 border-t border-dashed border-slate-200">
                  <CornerDownRight size={14} className="text-slate-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-slate-700 truncate">{loose.need > 0 ? row.loose!.name : ''}</p>
                    <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                      박스 {shortUnits}개 만들려면 {loose.need}{row.loose!.unitLabel} 필요 · 재고 {row.loose!.stock}{row.loose!.unitLabel}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {qtyInput(loose.value, loose.max, n => setLooseOverride(o => ({ ...o, [row.idx]: n })))}
                    <span className="text-xs font-bold text-slate-400">{row.loose!.unitLabel}</span>
                    <button
                      onClick={() => setLooseOverride(o => ({ ...o, [row.idx]: 0 }))}
                      className="px-2 py-1.5 bg-slate-100 text-slate-500 font-bold rounded-lg text-[11px] hover:bg-slate-200 transition-all"
                    >
                      사용안함
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] font-bold text-slate-400 mt-2.5">
                {shortUnits <= 0
                  ? '재고로 전부 충당 — 생산 없음'
                  : loose
                    ? `생산: ${row.name} ${shortUnits}${row.unitLabel}` + (loose.short > 0 ? ` (낱개 ${loose.short}${row.loose!.unitLabel} 새로 만듦)` : ' (낱개 재고로 조립)')
                    : `생산: ${shortUnits}${row.unitLabel}`}
              </p>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 flex gap-2 border-t border-slate-100">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm hover:bg-slate-200 transition-all"
          >
            취소
          </button>
          <button
            onClick={() => onConfirm(toStockUsePlan(states))}
            className="flex-[2] py-2.5 bg-emerald-500 text-white font-black rounded-xl text-sm hover:bg-emerald-600 transition-all"
          >
            {totalUse > 0 ? '재고 사용하고 작업완료' : '전량 생산하고 작업완료'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StockUseModal;
