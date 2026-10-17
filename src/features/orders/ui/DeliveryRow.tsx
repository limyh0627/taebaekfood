import React, { memo, useMemo, useState } from 'react';
import { Check, Plus, Minus, Package as PackageBox } from 'lucide-react';
import type { Order, Item, DeliveryBox } from '../../../shared/types';
import { STATUS_COLOR, STATUS_LABEL } from '../../../shared/orderStatusStyle';

interface DeliveryRowProps {
  order: Order;
  partnerName: string;
  items: Item[];
  onToggleInvoicePrinted?: (id: string, val: boolean) => void;
  onUpdateDeliveryBoxes?: (id: string, boxes: DeliveryBox[]) => void;
}

const DeliveryRow = memo<DeliveryRowProps>(({ order, partnerName, items, onToggleInvoicePrinted, onUpdateDeliveryBoxes }) => {
  const [showBoxSelect, setShowBoxSelect] = useState(false);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const products = items;

  const availableBoxes = useMemo(
    () => items.filter(p => p.type === '박스' && !/(비닐|자루|원조)/i.test(p.name)),
    [items]
  );

  const openPanel = () => {
    const init: Record<string, number> = {};
    (order.deliveryBoxes || []).forEach(b => { init[b.itemId] = b.quantity; });
    setDraft(init);
    setShowBoxSelect(true);
  };

  const handleConfirm = () => {
    const newBoxes: DeliveryBox[] = availableBoxes
      .filter(p => (draft[p.id] ?? 0) > 0)
      .map(p => ({ itemId: p.id, name: p.name, quantity: draft[p.id] }));
    onUpdateDeliveryBoxes?.(order.id, newBoxes);
    setShowBoxSelect(false);
  };

  return (
    <div className={`px-5 py-4 transition-colors ${order.invoicePrinted ? 'bg-emerald-50/60 hover:bg-emerald-50' : 'hover:bg-slate-50'}`}>
      <div className="flex items-center gap-3">
        <button type="button"
          onClick={() => onToggleInvoicePrinted?.(order.id, !order.invoicePrinted)}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${order.invoicePrinted ? 'bg-sky-500 border-sky-500' : 'border-slate-300 hover:border-sky-400'}`}
        >
          {order.invoicePrinted && <Check size={12} className="text-white" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-bold ${order.invoicePrinted ? 'line-through text-slate-400' : 'text-slate-800'}`}>{partnerName}</span>
            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${STATUS_COLOR[order.status] || 'bg-slate-100 text-slate-500'}`}>
              {STATUS_LABEL[order.status] || order.status}
            </span>
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{order.source}</span>
          </div>
        </div>
      </div>

      <div className="mt-2 ml-8">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center space-x-1">
            <PackageBox size={10} className="text-indigo-400" />
            <span className="text-[9px] font-black text-indigo-400 uppercase tracking-tighter">박스</span>
          </div>
          <button type="button" onClick={openPanel} className="text-[9px] font-black text-indigo-400 hover:text-indigo-600 flex items-center space-x-0.5">
            <Plus size={9} /><span>추가</span>
          </button>
        </div>
        {(order.deliveryBoxes || []).length === 0 ? (
          <p className="text-[9px] text-slate-300 font-bold">박스를 선택하세요</p>
        ) : (
          <div className="flex items-center gap-1 flex-wrap">
            {(order.deliveryBoxes || []).map(box => {
              const boxProduct = items.find(p => p.id === box.itemId);
              return (
                <span key={box.itemId} className="text-[9px] font-black bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                  {box.name} ({(boxProduct?.freightType ?? 's').toUpperCase()}) ×{box.quantity}
                </span>
              );
            })}
          </div>
        )}
        {showBoxSelect && (
          <div className="mt-2 bg-white border border-indigo-100 rounded-xl shadow-md animate-in fade-in duration-150 overflow-hidden">
            <div className="p-3 space-y-2">
              {availableBoxes.length === 0 ? (
                <p className="text-[9px] text-slate-300 font-bold">등록된 박스 없음</p>
              ) : availableBoxes.map(box => {
                const qty = draft[box.id] ?? 0;
                return (
                  <div key={box.id} className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-slate-600 truncate flex-1">
                      {box.name}
                      <span className="ml-1 text-[8px] font-black text-indigo-400">({(box.freightType ?? 's').toUpperCase()})</span>
                    </span>
                    <div className="flex items-center space-x-1 shrink-0">
                      <button type="button" onClick={() => setDraft(d => ({ ...d, [box.id]: Math.max(0, (d[box.id] ?? 0) - 1) }))}
                        className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 transition-all">
                        <Minus size={9} />
                      </button>
                      <input type="number" min={0} value={qty === 0 ? '' : qty} placeholder="0"
                        onChange={(e) => setDraft(d => ({ ...d, [box.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                        className={`w-8 text-center text-[10px] font-black rounded border outline-none py-0.5 ${qty > 0 ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
                      />
                      <button type="button" onClick={() => setDraft(d => ({ ...d, [box.id]: (d[box.id] ?? 0) + 1 }))}
                        className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 transition-all">
                        <Plus size={9} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-3 pb-3 flex gap-2">
              <button type="button" onClick={handleConfirm}
                className="flex-1 py-1.5 bg-indigo-600 text-white text-[10px] font-black rounded-lg hover:bg-indigo-700 transition-all">완료</button>
              <button type="button" onClick={() => setShowBoxSelect(false)}
                className="py-1.5 px-3 text-[10px] font-black text-slate-400 hover:text-slate-600 transition-all">취소</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});


export default DeliveryRow;
