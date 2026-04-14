
import React, { useState, useEffect, useMemo, memo } from 'react';
import {
  Plus,
  Clock,
  Inbox,
  Store,
  Box,
  History,
  Activity,
  Search,
  Truck,
  Edit2,
  Check,
  Trash2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Square,
  CheckSquare,
  Droplets,
  User,
  Minus,
  Package as PackageBox,
  X,
  ListOrdered,
  GripVertical
} from 'lucide-react';
import { Order, OrderStatus, Client, OrderSource, OrderItem, Product, OrderPallet, DeliveryBox } from '../types';
import ConfirmModal from './ConfirmModal';

// ─── 상수 ────────────────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  'Cap': '마개', 'Tape': '테이프', '박스': '박스', '용기': '용기', '라벨': '라벨',
};
const normalizeCategory = (cat: string) => CATEGORY_MAP[cat] || cat;

const STATUS_LABEL: Record<string, string> = {
  PENDING: '대기중', PROCESSING: '작업중', DISPATCHED: '작업완료',
  SHIPPED: '출고', DELIVERED: '예전 주문',
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  PROCESSING: 'bg-sky-100 text-sky-700',
  DISPATCHED: 'bg-emerald-100 text-emerald-700',
  SHIPPED: 'bg-indigo-100 text-indigo-700',
  DELIVERED: 'bg-slate-100 text-slate-500',
};

// ─── Props 타입 ───────────────────────────────────────────────────────────────

interface OrdersListProps {
  title: string;
  subtitle: string;
  groupBy: 'status' | 'source';
  allowedStatuses: OrderStatus[];
  orders: Order[];
  clients: Client[];
  products: Product[];
  onUpdateStatus: (id: string, status: OrderStatus) => void;
  onUpdateDeliveryDate: (id: string, date: string) => void;
  onUpdateReceivedDate?: (id: string, date: string) => void;
  onUpdatePallets?: (id: string, pallets: OrderPallet[]) => void;
  onUpdateItems?: (id: string, items: OrderItem[]) => void;
  onUpdateDeliveryBoxes?: (id: string, boxes: DeliveryBox[]) => void;
  onToggleInvoicePrinted?: (id: string, value: boolean) => void;
  onToggleItemChecked?: (orderId: string, itemIdx: number, checkedBy?: string) => void;
  onDeleteOrder: (id: string) => void;
  onAddClick: () => void;
  currentUserName?: string;
  highlightOrderId?: string | null;
  onHighlightClear?: () => void;
  workOrderItems?: { key: string; orderId: string; productId: string; itemName: string; clientName: string; qty: number; category: string }[];
  onSetWorkOrderItems?: (items: { key: string; orderId: string; productId: string; itemName: string; clientName: string; qty: number; category: string }[]) => void;
}

interface OrderCardProps {
  order: Order;
  clients: Client[];
  products: Product[];
  editingOrderId: string | null;
  setEditingOrderId: (id: string | null) => void;
  showAddProductSelect: string | null;
  setShowAddProductSelect: (id: string | null) => void;
  onUpdateItems?: (id: string, items: OrderItem[]) => void;
  onUpdateDeliveryDate: (id: string, date: string) => void;
  onUpdateStatus: (id: string, status: OrderStatus) => void;
  onToggleItemChecked?: (orderId: string, itemIdx: number, checkedBy?: string) => void;
  onDeleteOrder: (id: string) => void;
  currentUserName?: string;
  gridCols?: number;
  isHighlighted?: boolean;
  highlightOrderId?: string | null;
}

interface OrderSourceGroupProps {
  colId: string;
  source: OrderSource;
  orders: Order[];
  gridCols?: number;
  collapsedCategories: Set<string>;
  onToggleCategory: (colId: string, source: OrderSource) => void;
  clients: Client[];
  products: Product[];
  editingOrderId: string | null;
  setEditingOrderId: (id: string | null) => void;
  showAddProductSelect: string | null;
  setShowAddProductSelect: (id: string | null) => void;
  onUpdateItems?: (id: string, items: OrderItem[]) => void;
  onUpdateDeliveryDate: (id: string, date: string) => void;
  onUpdateStatus: (id: string, status: OrderStatus) => void;
  onToggleItemChecked?: (orderId: string, itemIdx: number, checkedBy?: string) => void;
  onDeleteOrder: (id: string) => void;
  currentUserName?: string;
  highlightOrderId?: string | null;
}

interface DeliveryRowProps {
  order: Order;
  clientName: string;
  products: Product[];
  onToggleInvoicePrinted?: (id: string, val: boolean) => void;
  onUpdateDeliveryBoxes?: (id: string, boxes: DeliveryBox[]) => void;
}

type TabType = 'delivery' | 'active' | 'history';

// ─── OrderCard ────────────────────────────────────────────────────────────────

export const OrderCard = memo<OrderCardProps>(({
  order, clients, products,
  editingOrderId, setEditingOrderId,
  showAddProductSelect, setShowAddProductSelect,
  onUpdateItems, onUpdateDeliveryDate, onUpdateStatus,
  onToggleItemChecked, onDeleteOrder, currentUserName, gridCols = 1, isHighlighted = false, highlightOrderId,
}) => {
  const highlighted = isHighlighted || highlightOrderId === order.id;
  const isEditing = editingOrderId === order.id;
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; confirmText?: string; onConfirm: () => void } | null>(null);

  // 향미유·고춧가루 제외한 품목만 진행률 및 완료 판단에 사용
  const isSecondary = (cat?: string) => cat === '향미유' || cat === '고춧가루';
  const nonHyangmiyuItems = order.items.filter(item => {
    const p = products.find(p => p.id === item.productId);
    return !isSecondary(p?.category);
  });
  const totalItems = nonHyangmiyuItems.length || 1;
  const completedItems = nonHyangmiyuItems.filter(i => i.checked).length;
  const progress = Math.round((completedItems / totalItems) * 100);
  const isFullyDone = progress === 100;
  const allNonHyangmiyuDone = nonHyangmiyuItems.length > 0 && nonHyangmiyuItems.every(i => i.checked);

  // 접힘 상태: DISPATCHED/SHIPPED 카드는 초기에 접힘
  const [isCollapsed, setIsCollapsed] = useState(
    order.status === OrderStatus.DISPATCHED || order.status === OrderStatus.SHIPPED
  );

  // 완제품 모두 체크 시 → 작업완료(DISPATCHED)로 자동 이동 + 접힘
  useEffect(() => {
    if (
      allNonHyangmiyuDone &&
      order.status !== OrderStatus.DISPATCHED &&
      order.status !== OrderStatus.SHIPPED &&
      order.status !== OrderStatus.DELIVERED
    ) {
      onUpdateStatus(order.id, OrderStatus.DISPATCHED);
      setIsCollapsed(true);
    }
  }, [allNonHyangmiyuDone]);

  const client = clients.find(c => c.id === order.clientId);
  const rawName = order.customerName || client?.name || '이름 없음';
  const displayName = rawName.replace(/\s*\(\d{4}\.\s*\d+\.\s*\d+\.?\)\s*$/, '');

  const handleDirectQtyChange = (idx: number, value: string) => {
    const qty = parseInt(value) || 0;
    const newItems = [...order.items];
    const item = newItems[idx];
    if (item.isBoxUnit && item.unitsPerBox) {
      // 박스 수 입력 → 낱개 수 자동 계산
      newItems[idx] = { ...item, boxQuantity: qty, quantity: qty * item.unitsPerBox };
    } else {
      newItems[idx] = { ...item, quantity: qty };
    }
    onUpdateItems?.(order.id, newItems);
  };

  const handleExpirationDateChange = (idx: number, value: string) => {
    const newItems = [...order.items];
    newItems[idx] = { ...newItems[idx], mfgDate: value };
    onUpdateItems?.(order.id, newItems);
  };

  const handleRemoveItem = (idx: number) => {
    const item = order.items[idx];
    setConfirmModal({
      message: `"${item.name}" 품목을 삭제할까요?`,
      subMessage: '주문에서 해당 품목이 제거됩니다.',
      confirmText: '삭제',
      onConfirm: () => {
        onUpdateItems?.(order.id, order.items.filter((_, i) => i !== idx));
        setConfirmModal(null);
      },
    });
  };

  const handleAddItem = (product: Product) => {
    const newItem: OrderItem = {
      productId: product.id, name: product.name,
      quantity: 1, price: product.price, checked: false,
    };
    onUpdateItems?.(order.id, [...order.items, newItem]);
    setShowAddProductSelect(null);
  };

  return (
    <div
      id={`order-card-${order.id}`}
      draggable={!isEditing}
      onDragStart={(e) => { e.dataTransfer.setData('orderId', order.id); e.dataTransfer.effectAllowed = 'move'; }}
      className={`bg-white rounded-2xl shadow-sm border transition-all group relative animate-in zoom-in-95 duration-200 ${isEditing ? 'ring-2 ring-indigo-500 border-indigo-200 shadow-xl z-20' : highlighted ? 'ring-2 ring-amber-400 border-amber-300 shadow-lg shadow-amber-100' : 'border-slate-100 hover:shadow-md hover:border-indigo-100 cursor-grab active:cursor-grabbing'} ${isCollapsed ? 'p-2.5' : 'p-4'} flex flex-col`}
    >
      <div className={`flex justify-between items-start ${isCollapsed ? 'mb-1.5' : 'mb-3'}`}>
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <h4 className="font-bold text-slate-800 leading-tight truncate text-sm">{displayName}</h4>
          {nonHyangmiyuItems.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIsCollapsed(prev => !prev); }}
              className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 transition-all ${isFullyDone ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-600'}`}
            >
              {completedItems}/{totalItems}
            </button>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setEditingOrderId(isEditing ? null : order.id); setShowAddProductSelect(null); }}
          className={`p-1.5 rounded-lg transition-all ${isEditing ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'}`}
          title={isEditing ? '저장' : '주문 편집'}
        >
          {isEditing ? <Check size={14} /> : <Edit2 size={14} />}
        </button>
      </div>

      <div className={isCollapsed ? '' : 'mb-3 flex-1'}>
        {isEditing ? (
          /* 편집 모드: 기존 행별 레이아웃 유지 */
          <div className="space-y-2">
            {order.items.map((item, idx) => {
              const opts = ['대기', '날인', '부착'] as const;
              const current = item.labelType ?? '대기';
              const next = opts[(opts.indexOf(current) + 1) % opts.length];
              const colorMap: Record<string, string> = {
                '대기': 'bg-red-50 border-red-200 text-red-600',
                '날인': 'bg-yellow-50 border-yellow-200 text-yellow-600',
                '부착': 'bg-emerald-50 border-emerald-300 text-emerald-600',
              };
              const editProductInfo = products.find(p => p.id === item.productId);
              return (
                <div key={idx} className="flex flex-col gap-0.5 text-[10px] font-bold border-b border-slate-50 pb-1.5 last:border-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-slate-700 flex-1">{item.name}</span>
                    {item.isBoxUnit && item.unitsPerBox ? (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <input type="number" value={item.boxQuantity ?? Math.round(item.quantity / item.unitsPerBox)} onChange={(e) => handleDirectQtyChange(idx, e.target.value)}
                          className="w-8 text-center bg-slate-50 border border-indigo-200 rounded outline-none font-bold py-0.5" />
                        <span className="text-[8px] font-bold text-slate-400">박스</span>
                        <span className="text-[8px] font-bold text-indigo-400">={item.quantity}개</span>
                      </div>
                    ) : (
                      <input type="number" value={item.quantity} onChange={(e) => handleDirectQtyChange(idx, e.target.value)}
                        className="w-10 text-center bg-slate-50 border border-indigo-200 rounded outline-none font-bold py-0.5 shrink-0" />
                    )}
                    <button onClick={() => handleRemoveItem(idx)} className="p-1 text-rose-400 hover:bg-rose-50 rounded shrink-0"><Trash2 size={10} /></button>
                  </div>
                  {!isSecondary(editProductInfo?.category) && (
                    <input type="date" value={item.mfgDate || ''} onChange={(e) => handleExpirationDateChange(idx, e.target.value)}
                      className="text-[9px] bg-slate-50 border border-indigo-200 rounded font-bold py-0.5 px-1 w-full text-center text-slate-600 cursor-pointer" />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* 보기 모드 */
          <div className="space-y-1">
            {/* 접힌 상태: 완료 요약만 표시 */}
            {/* 일반 품목 (완제품): 펼쳐진 상태에서만 표시 */}
            {!isCollapsed && order.items.filter(item => {
              const p = products.find(p => p.id === item.productId);
              return !isSecondary(p?.category);
            }).map((item, _) => {
              const idx = order.items.indexOf(item);
              const isItemChecked = !!item.checked;
              const productInfo = products.find(p => p.id === item.productId);
              const opts = ['대기', '날인', '부착'] as const;
              const current = item.labelType ?? '대기';
              const next = opts[(opts.indexOf(current) + 1) % opts.length];
              const colorMap: Record<string, string> = {
                '대기': 'bg-red-50 border-red-200 text-red-600',
                '날인': 'bg-yellow-50 border-yellow-200 text-yellow-600',
                '부착': 'bg-emerald-50 border-emerald-300 text-emerald-600',
              };
              const abbrev = (name: string) => name
                .replace(/참진한기름/g, '참진').replace(/참고소한기름/g, '참고소')
                .replace(/들향기름골드/g, '들향골드').replace(/참향기름/g, '참향')
                .replace(/들향기름/g, '들향').replace(/맛기름/g, '맛');
              return (
                <div key={idx} className="flex flex-col border-b border-slate-50 pb-1 last:border-0">
                  <div className="flex items-center text-[10px] font-bold">
                    <div className={`mr-1.5 shrink-0 ${isItemChecked ? 'text-emerald-600' : 'text-slate-300'}`} onClick={(e) => { e.stopPropagation(); onToggleItemChecked?.(order.id, idx, currentUserName); }} style={{cursor:'pointer'}}>
                      {isItemChecked ? <CheckSquare size={14} /> : <Square size={14} />}
                    </div>
                    <span className={`truncate ${isItemChecked ? 'text-emerald-800 line-through opacity-50' : 'text-slate-700'}`}>{abbrev(item.name)}</span>
                    <span className={`ml-1.5 px-1 py-0.5 rounded text-[8px] font-black shrink-0 ${isItemChecked ? 'text-emerald-700 bg-emerald-100' : 'text-indigo-600 bg-indigo-50'}`}>
                      {item.isBoxUnit && item.boxQuantity && item.unitsPerBox
                        ? `${item.boxType ? item.boxType + ' ' : ''}${item.boxQuantity}박스(${item.quantity}개)`
                        : `${item.quantity}${productInfo?.unit || '개'}`}
                    </span>
                  </div>
                  {productInfo?.submaterials && productInfo.submaterials.filter(sm => {
                    const fullSub = products.find(p => p.id === sm.id);
                    return ['마개', '테이프', '박스'].includes(normalizeCategory(fullSub?.category || sm.category || ''));
                  }).length > 0 && (
                    <div className={`mt-0.5 ${gridCols >= 2 ? 'grid grid-cols-2 md:flex md:flex-wrap md:items-center gap-x-1 gap-y-0.5 md:gap-1 md:pl-[20px]' : 'flex flex-wrap items-center gap-x-1 gap-y-0.5 pl-[20px]'}`}>
                      {productInfo.submaterials.filter(sm => {
                        const fullSub = products.find(p => p.id === sm.id);
                        return ['마개', '테이프', '박스'].includes(normalizeCategory(fullSub?.category || sm.category || ''));
                      }).map(sm => (
                        <span key={sm.id} className="text-[8px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{sm.name}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1 mt-0.5 pl-[20px]">
                    <button type="button" onClick={(e) => { e.stopPropagation(); const ni = [...order.items]; ni[idx] = { ...ni[idx], labelType: next }; onUpdateItems?.(order.id, ni); }}
                      className={`text-[8px] font-black px-1 py-0.5 rounded border transition-all shrink-0 ${colorMap[current]}`}>{current}</button>
                    {item.checked && item.checkedBy && (
                      <span className="text-[8px] font-bold text-slate-400">{item.checkedBy}</span>
                    )}
                    {item.mfgDate && (
                      <span className="text-[8px] font-bold text-slate-400 bg-slate-50 px-1 py-0.5 rounded border border-slate-100">
                        ~{(() => { const d = new Date(item.mfgDate!); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(2, 10); })()}
                      </span>
                    )}
                    {productInfo?.oil && <span className="text-[8px] text-indigo-500 font-bold">{productInfo.oil}</span>}
                  </div>
                </div>
              );
            })}
            {/* 향미유·고춧가루: 카테고리별 구분 표시 */}
            {(() => {
              const abbrev = (name: string) => name
                .replace(/참진한기름/g, '참진').replace(/참고소한기름/g, '참고소')
                .replace(/들향기름골드/g, '들향골드').replace(/참향기름/g, '참향')
                .replace(/들향기름/g, '들향').replace(/맛기름/g, '맛');
              const hyangmiyuItems = order.items.filter(item => products.find(p => p.id === item.productId)?.category === '향미유');
              const gochuItems = order.items.filter(item => products.find(p => p.id === item.productId)?.category === '고춧가루');
              if (hyangmiyuItems.length === 0 && gochuItems.length === 0) return null;
              return (
                <div className="space-y-1 pt-1.5 border-t-2 border-dashed border-slate-200 mt-1.5">
                  {hyangmiyuItems.length > 0 && (
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                      <span className="text-[8px] font-black text-teal-500 bg-teal-50 px-1.5 py-0.5 rounded shrink-0">향미유</span>
                      {hyangmiyuItems.map((item) => {
                        const idx = order.items.indexOf(item);
                        const isItemChecked = !!item.checked;
                        return (
                          <div key={idx} className={`flex items-center gap-1 text-[10px] font-bold ${isItemChecked ? 'opacity-50' : ''}`}>
                            <div className={`shrink-0 ${isItemChecked ? 'text-emerald-600' : 'text-slate-300'}`} onClick={() => onToggleItemChecked?.(order.id, idx)} style={{cursor:'pointer'}}>
                              {isItemChecked ? <CheckSquare size={12} /> : <Square size={12} />}
                            </div>
                            <span className={`${isItemChecked ? 'line-through text-slate-400' : 'text-slate-700'}`}>{abbrev(item.name)}</span>
                            <span className={`text-[8px] font-black shrink-0 ${isItemChecked ? 'text-emerald-700 bg-emerald-100' : 'text-teal-600 bg-teal-50'} px-1 py-0.5 rounded`}>
                              {item.isBoxUnit && item.boxQuantity ? `${item.boxQuantity}B` : `${item.quantity}개`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {gochuItems.length > 0 && (
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                      <span className="text-[8px] font-black text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded shrink-0">고춧가루</span>
                      {gochuItems.map((item) => {
                        const idx = order.items.indexOf(item);
                        const isItemChecked = !!item.checked;
                        return (
                          <div key={idx} className={`flex items-center gap-1 text-[10px] font-bold ${isItemChecked ? 'opacity-50' : ''}`}>
                            <div className={`shrink-0 ${isItemChecked ? 'text-emerald-600' : 'text-slate-300'}`} onClick={() => onToggleItemChecked?.(order.id, idx)} style={{cursor:'pointer'}}>
                              {isItemChecked ? <CheckSquare size={12} /> : <Square size={12} />}
                            </div>
                            <span className={`${isItemChecked ? 'line-through text-slate-400' : 'text-slate-700'}`}>{item.name}</span>
                            <span className={`text-[8px] font-black shrink-0 ${isItemChecked ? 'text-emerald-700 bg-emerald-100' : 'text-orange-600 bg-orange-50'} px-1 py-0.5 rounded`}>
                              {item.isBoxUnit && item.boxQuantity ? `${item.boxQuantity}B` : `${item.quantity}개`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {isEditing && (
        <div className="mt-2 mb-3">
          {showAddProductSelect === order.id ? (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
              <select
                onChange={(e) => { const p = products.find(prod => prod.id === e.target.value); if (p) handleAddItem(p); }}
                className="w-full bg-slate-50 border border-indigo-200 rounded-lg py-1.5 px-2 text-[10px] font-bold outline-none"
                defaultValue=""
              >
                <option value="" disabled>추가할 품목 선택...</option>
                <optgroup label="완제품">
                  {products
                    .filter(p => p.category === '완제품' && p.clientId === order.clientId)
                    .sort((a, b) => {
                      const order = (name: string) => /가루/.test(name) ? 3 : /참기름|참진|참고소|참향/.test(name) ? 0 : /들기름|들향|들진|들고소/.test(name) ? 1 : /깨/.test(name) ? 2 : 4;
                      const diff = order(a.name) - order(b.name);
                      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'ko');
                    })
                    .map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </optgroup>
                <optgroup label="향미유">
                  {products.filter(p => p.category === '향미유').map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
                <optgroup label="고춧가루">
                  {products.filter(p => p.category === '고춧가루').map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              </select>
              <button onClick={() => setShowAddProductSelect(null)} className="w-full py-1 text-[8px] font-black text-slate-400 uppercase hover:text-slate-600">취소</button>
            </div>
          ) : (
            <button onClick={() => setShowAddProductSelect(order.id)}
              className="w-full py-2 border border-dashed border-slate-200 rounded-xl text-[10px] font-bold text-slate-400 hover:border-indigo-300 hover:text-indigo-500 transition-all flex items-center justify-center space-x-1"
            >
              <Plus size={12} /><span>품목 추가</span>
            </button>
          )}
        </div>
      )}

      {/* 상태 변경 버튼 */}
      {!isEditing && (
        <div className="flex gap-1 mt-2">
          {([
            [OrderStatus.PENDING,    '대기중'],
            [OrderStatus.PROCESSING, '작업중'],
            [OrderStatus.DISPATCHED, '작업완료'],
          ] as [OrderStatus, string][]).map(([st, label]) => (
            <button
              key={st}
              type="button"
              onClick={(e) => { e.stopPropagation(); onUpdateStatus(order.id, st); }}
              className={`flex-1 py-1 rounded-lg text-[9px] font-black transition-all ${
                order.status === st
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-slate-50 mt-2">
        {isEditing ? (
          <div className="flex flex-col">
            <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">배송기한 수정</span>
            <input type="date" value={order.deliveryDate.split('T')[0]}
              onChange={(e) => onUpdateDeliveryDate(order.id, new Date(e.target.value).toISOString())}
              className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border-none outline-none rounded px-1 focus:ring-1 focus:ring-indigo-300"
            />
          </div>
        ) : (
          <>
            <div className="flex flex-col">
              <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">주문일자</span>
              <span className="text-[9px] font-bold text-slate-400">
                {new Date(order.createdAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
              </span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">배송기한</span>
              <span className="text-[9px] font-bold text-slate-500">{new Date(order.deliveryDate).toLocaleDateString().slice(2)}</span>
            </div>
            <div className="text-[9px] font-black text-slate-400 uppercase">{order.source}</div>
          </>
        )}
      </div>

      {isEditing && (
        <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between gap-2">
          <select value={order.status}
            onChange={(e) => { onUpdateStatus(order.id, e.target.value as OrderStatus); setEditingOrderId(null); }}
            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 text-[10px] font-black outline-none"
          >
            {([
              [OrderStatus.PENDING, '대기중'],
              [OrderStatus.PROCESSING, '작업중'],
              [OrderStatus.DISPATCHED, '작업완료'],
              [OrderStatus.SHIPPED, '출고'],
            ] as [OrderStatus, string][]).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
          <button onClick={() => setConfirmModal({
              message: '주문을 삭제하시겠습니까?',
              subMessage: `${clients.find(c => c.id === order.clientId)?.name ?? ''} · 삭제 후 복구할 수 없습니다.`,
              onConfirm: () => { onDeleteOrder(order.id); setConfirmModal(null); },
            })}
            className="p-1.5 text-rose-400 hover:bg-rose-50 rounded-lg transition-all"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          subMessage={confirmModal.subMessage}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
});

// ─── OrderSourceGroup ─────────────────────────────────────────────────────────

const SOURCE_CONFIGS = {
  '스마트스토어': { icon: Store, color: 'text-lime-600', bgColor: 'bg-lime-50' },
  '택배': { icon: Truck, color: 'text-pink-600', bgColor: 'bg-pink-50' },
  '일반': { icon: User, color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
} as const;

const OrderSourceGroup = memo<OrderSourceGroupProps>(({
  colId, source, orders, gridCols = 1,
  collapsedCategories, onToggleCategory,
  ...cardProps
}) => {
  const isCollapsed = collapsedCategories.has(`${colId}-${source}`);
  if (orders.length === 0) return null;

  const config = SOURCE_CONFIGS[source] || { icon: Box, color: 'text-slate-600', bgColor: 'bg-slate-50' };
  const Icon = config.icon;

  return (
    <div className="space-y-3">
      <button
        onClick={() => onToggleCategory(colId, source)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all hover:bg-white/60 ${config.bgColor} border border-white/40 shadow-sm`}
      >
        <div className="flex items-center space-x-2">
          <Icon size={14} className={config.color} />
          <span className={`text-[11px] font-black uppercase tracking-wider ${config.color}`}>{source} ({orders.length})</span>
        </div>
        {isCollapsed ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronUp size={14} className="text-slate-400" />}
      </button>
      {!isCollapsed && (
        <div className={`grid gap-3 ${gridCols === 3 ? 'grid-cols-3' : gridCols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {orders.map(order => <OrderCard key={order.id} order={order} {...cardProps} gridCols={gridCols} />)}
        </div>
      )}
    </div>
  );
});

// ─── DeliveryRow ──────────────────────────────────────────────────────────────

const DeliveryRow = memo<DeliveryRowProps>(({ order, clientName, products, onToggleInvoicePrinted, onUpdateDeliveryBoxes }) => {
  const [showBoxSelect, setShowBoxSelect] = useState(false);
  const [draft, setDraft] = useState<Record<string, number>>({});

  const availableBoxes = useMemo(
    () => products.filter(p => p.category === '박스' && !/(비닐|자루|원조)/i.test(p.name)),
    [products]
  );

  const openPanel = () => {
    const init: Record<string, number> = {};
    (order.deliveryBoxes || []).forEach(b => { init[b.productId] = b.quantity; });
    setDraft(init);
    setShowBoxSelect(true);
  };

  const handleConfirm = () => {
    const newBoxes: DeliveryBox[] = availableBoxes
      .filter(p => (draft[p.id] ?? 0) > 0)
      .map(p => ({ productId: p.id, name: p.name, quantity: draft[p.id] }));
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
            <span className={`text-sm font-bold truncate ${order.invoicePrinted ? 'line-through text-slate-400' : 'text-slate-800'}`}>{clientName}</span>
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
              const boxProduct = products.find(p => p.id === box.productId);
              return (
                <span key={box.productId} className="text-[9px] font-black bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
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

// ─── OrdersList ───────────────────────────────────────────────────────────────

const defaultUnits: Record<string, number> = { pending_col: 2, processing_col: 2, dispatch_col: 1, shipped_col: 1 };
const maxUnits: Record<string, number> = { pending_col: 2, processing_col: 3, dispatch_col: 2, shipped_col: 2 };

const activeConfigs = [
  { id: 'pending_col',    label: '대기중',   icon: Clock,    color: 'bg-amber-500',   bgColor: 'bg-amber-50/50',   borderColor: 'border-amber-100',   textColor: 'text-amber-700',   statusFilter: [OrderStatus.PENDING],    targetStatus: OrderStatus.PENDING },
  { id: 'processing_col', label: '작업중',   icon: Activity, color: 'bg-sky-500',     bgColor: 'bg-sky-50/50',     borderColor: 'border-sky-100',     textColor: 'text-sky-700',     statusFilter: [OrderStatus.PROCESSING], targetStatus: OrderStatus.PROCESSING },
];

const deliveryExtraConfigs = [
  { id: 'dispatch_col', label: '작업완료', icon: Truck,   color: 'bg-emerald-600', bgColor: 'bg-emerald-50/50', borderColor: 'border-emerald-100', textColor: 'text-emerald-700', statusFilter: [OrderStatus.DISPATCHED], targetStatus: OrderStatus.DISPATCHED },
  { id: 'shipped_col',  label: '출고',    icon: Truck,   color: 'bg-indigo-500',  bgColor: 'bg-indigo-50/50',  borderColor: 'border-indigo-100',  textColor: 'text-indigo-700',  statusFilter: [OrderStatus.SHIPPED],   targetStatus: OrderStatus.SHIPPED },
];

const historyConfig = { id: 'history_col', label: '예전 주문 이력', icon: History, color: 'bg-slate-700', bgColor: 'bg-slate-50/80', borderColor: 'border-slate-200', textColor: 'text-slate-700', statusFilter: [OrderStatus.DELIVERED], targetStatus: undefined };

const OrdersList: React.FC<OrdersListProps> = ({
  title, subtitle, orders, clients, products,
  onUpdateStatus, onUpdateDeliveryDate,
  onUpdateItems, onUpdateDeliveryBoxes,
  onToggleInvoicePrinted, onToggleItemChecked,
  onDeleteOrder, onAddClick,
  workOrderItems: workOrderItemsProp = [],
  onSetWorkOrderItems,
  currentUserName,
  highlightOrderId,
  onHighlightClear,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [showAddProductSelect, setShowAddProductSelect] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [columnUnits, setColumnUnits] = useState<Record<string, number>>(defaultUnits);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const HISTORY_PREVIEW = 5;
  type WorkItem = { key: string; orderId: string; productId: string; itemName: string; clientName: string; qty: number; category: string; };
  const workItems: WorkItem[] = workOrderItemsProp;
  const setWorkItems = (items: WorkItem[] | ((prev: WorkItem[]) => WorkItem[])) => {
    const resolved = typeof items === 'function' ? items(workItems) : items;
    onSetWorkOrderItems?.(resolved);
  };
  const [showWorkOrderPicker, setShowWorkOrderPicker] = useState(false);
  const [mobileCollapsed, setMobileCollapsed] = useState<Set<string>>(new Set());
  const toggleMobileCollapse = (id: string) => setMobileCollapsed(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const [pickerOrdering, setPickerOrdering] = useState<string[]>([]); // 선택 순서 배열
  const [previewOrderId, setPreviewOrderId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; confirmText?: string; onConfirm: () => void } | null>(null);

  // 알림에서 넘어온 주문 하이라이트 + 스크롤
  useEffect(() => {
    if (!highlightOrderId) return;
    // 히스토리 탭에 있을 경우 active 탭으로 전환
    setActiveTab('active');
    const timer = setTimeout(() => {
      const el = document.getElementById(`order-card-${highlightOrderId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      const clearTimer = setTimeout(() => onHighlightClear?.(), 3000);
      return () => clearTimeout(clearTimer);
    }, 200);
    return () => clearTimeout(timer);
  }, [highlightOrderId]);

  const expandColumn = (colId: string) =>
    setColumnUnits(prev => ({ ...prev, [colId]: Math.min((prev[colId] ?? defaultUnits[colId] ?? 1) + 1, maxUnits[colId] ?? 2) }));

  const collapseColumn = (colId: string) =>
    setColumnUnits(prev => ({ ...prev, [colId]: Math.max((prev[colId] ?? defaultUnits[colId] ?? 1) - 1, 1) }));

  const onToggleCategory = (colId: string, source: OrderSource) => {
    const key = `${colId}-${source}`;
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // 완료된 주문의 품목 자동 정리
  const validWorkItems = useMemo(() => {
    const activeIds = new Set(orders.filter(o => o.status === OrderStatus.PENDING || o.status === OrderStatus.PROCESSING).map(o => o.id));
    return workItems.filter(wi => activeIds.has(wi.orderId));
  }, [workItems, orders]);

  const isPowder = (name: string) => name.includes('가루') || name.includes('깨') || name.includes('Garu');
  const isOil = (name: string) => !isPowder(name);

  const filteredOrders = useMemo(() => {
    if (!searchTerm.trim()) return orders;
    const q = searchTerm.toLowerCase();
    return orders.filter(o =>
      (o.customerName || '').toLowerCase().includes(q) ||
      (o.id || '').toLowerCase().includes(q)
    );
  }, [orders, searchTerm]);

  const deliveryOrders = useMemo(() =>
    filteredOrders
      .filter(o => (o.source === '택배' || o.source === '스마트스토어' || o.deliveryBoxes !== undefined) && o.status !== OrderStatus.DELIVERED)
      .sort((a, b) => new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime()),
    [filteredOrders]
  );

  // DeliveryRow에 넘길 clientName 미리 계산
  const clientMap = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach(c => map.set(c.id, c.name));
    return map;
  }, [clients]);

  // OrderCard/OrderSourceGroup에 공통으로 넘길 props
  const cardSharedProps = {
    clients, products,
    editingOrderId, setEditingOrderId,
    showAddProductSelect, setShowAddProductSelect,
    onUpdateItems, onUpdateDeliveryDate, onUpdateStatus,
    onToggleItemChecked, onDeleteOrder, currentUserName,
    highlightOrderId,
  };

  return (
    <div className="flex flex-col space-y-4 md:space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-row items-center justify-between gap-2 md:gap-6">
        <div className="min-w-0">
          <h2 className="text-lg md:text-3xl font-bold text-slate-900 truncate">{title}</h2>
          <p className="text-xs md:text-sm text-slate-500 hidden sm:block">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
            <button onClick={() => setActiveTab('delivery')}
              className={`px-2.5 md:px-5 py-2 md:py-2.5 rounded-xl text-[10px] md:text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'delivery' ? 'bg-sky-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}>
              택배
            </button>
            <button onClick={() => setActiveTab('active')}
              className={`px-2.5 md:px-5 py-2 md:py-2.5 rounded-xl text-[10px] md:text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'active' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}>
              운영
            </button>
            <button onClick={() => setActiveTab('history')}
              className={`px-2.5 md:px-5 py-2 md:py-2.5 rounded-xl text-[10px] md:text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'history' ? 'bg-slate-700 text-white shadow-md' : 'text-slate-400 hover:bg-slate-50'}`}>
              이력
            </button>
          </div>
          <button onClick={onAddClick} className="flex items-center justify-center gap-1.5 bg-indigo-600 text-white px-3 md:px-6 py-2.5 md:py-3 rounded-2xl font-bold shadow-lg hover:bg-indigo-700 transition-all">
            <Plus size={18} /><span className="hidden sm:inline text-sm">주문 생성</span>
          </button>
        </div>
      </div>

      <div className="relative max-w-full md:max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input type="text" placeholder="고객명, 주문번호 검색..." value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-white border border-slate-200 rounded-2xl pl-11 pr-4 py-2.5 md:py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
        />
      </div>

      {activeTab === 'delivery' && (
        <div>
          {/* 택배 목록 */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-50 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-xl bg-sky-500 text-white"><Truck size={18} /></div>
              <h3 className="font-black text-base text-sky-700">택배 주문 목록 ({deliveryOrders.length})</h3>
            </div>
            {deliveryOrders.some(o => o.invoicePrinted) && (
              <button
                onClick={() => {
                  const checked = deliveryOrders.filter(o => o.invoicePrinted);
                  setConfirmModal({
                    message: `체크된 ${checked.length}건을 출고 처리하시겠습니까?`,
                    confirmText: '출고 처리',
                    onConfirm: () => { checked.forEach(o => onUpdateStatus(o.id, OrderStatus.SHIPPED)); setConfirmModal(null); },
                  } as any);
                }}
                className="flex items-center space-x-1.5 bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-black hover:bg-indigo-700 transition-all shadow"
              >
                <Truck size={13} />
                <span>출고 ({deliveryOrders.filter(o => o.invoicePrinted).length})</span>
              </button>
            )}
          </div>
          {deliveryOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 opacity-20">
              <Inbox size={40} />
              <p className="text-xs font-bold mt-2">택배 주문이 없습니다</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {deliveryOrders.map(order => {
                const clientName = (order.clientId && clientMap.get(order.clientId)) || order.customerName || '이름 없음';
                return (
                  <DeliveryRow
                    key={order.id}
                    order={order}
                    clientName={clientName}
                    products={products}
                    onToggleInvoicePrinted={onToggleInvoicePrinted}
                    onUpdateDeliveryBoxes={onUpdateDeliveryBoxes}
                  />
                );
              })}
            </div>
          )}
          </div>
        </div>
      )}

      {/* ── 운영 탭: 금일 작업순서(좌) + 대기중/작업중(우) ── */}
      {activeTab === 'active' && (() => {
        const pickableOrders = filteredOrders.filter(o => o.status === OrderStatus.PENDING || o.status === OrderStatus.PROCESSING);

        // 픽커용 전체 품목 목록 (향미유·고춧가루 제외)
        const allPickableItems: WorkItem[] = pickableOrders.flatMap(o => {
          const clientName = o.customerName || clients.find(c => c.id === o.clientId)?.name || '이름없음';
          return o.items
            .map((item, idx) => ({
              key: `${o.id}-${idx}`,
              orderId: o.id,
              productId: item.productId,
              itemName: item.name,
              clientName,
              qty: item.quantity,
              category: products.find(p => p.id === item.productId)?.category || '',
            }))
            .filter(wi => wi.category !== '향미유' && wi.category !== '고춧가루');
        });

        // 기름 / 가루 분류
        const oilItems = validWorkItems.filter(wi => isOil(wi.itemName));
        const powderItems = validWorkItems.filter(wi => isPowder(wi.itemName));

        // 섹션 내에서만 순서 이동 (기름↔기름, 가루↔가루)
        const getSection = (name: string) => isPowder(name) ? 'powder' : 'oil';
        const moveInSection = (key: string, dir: 'up' | 'down') => setWorkItems(prev => {
          const a = [...prev];
          const i = a.findIndex(x => x.key === key);
          if (i === -1) return prev;
          const sec = getSection(a[i].itemName);
          if (dir === 'up') {
            for (let j = i - 1; j >= 0; j--) {
              if (getSection(a[j].itemName) === sec) { [a[j], a[i]] = [a[i], a[j]]; return a; }
            }
          } else {
            for (let j = i + 1; j < a.length; j++) {
              if (getSection(a[j].itemName) === sec) { [a[i], a[j]] = [a[j], a[i]]; return a; }
            }
          }
          return prev;
        });
        const removeItem = (key: string) => setWorkItems(prev => prev.filter(x => x.key !== key));

        const renderItemRow = (wi: WorkItem, sectionItems: WorkItem[]) => {
          const sectionIdx = sectionItems.findIndex(x => x.key === wi.key);
          const isFirst = sectionIdx === 0;
          const isLast = sectionIdx === sectionItems.length - 1;
          return (
            <div
              key={wi.key}
              draggable
              onDragStart={e => { e.dataTransfer.setData('workItemKey', wi.key); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const dragKey = e.dataTransfer.getData('workItemKey');
                if (!dragKey || dragKey === wi.key) return;
                setWorkItems(prev => {
                  const a = [...prev];
                  const fromIdx = a.findIndex(x => x.key === dragKey);
                  const toIdx = a.findIndex(x => x.key === wi.key);
                  if (fromIdx === -1 || toIdx === -1) return prev;
                  if (getSection(a[fromIdx].itemName) !== getSection(a[toIdx].itemName)) return prev;
                  const [removed] = a.splice(fromIdx, 1);
                  const newTo = a.findIndex(x => x.key === wi.key);
                  a.splice(newTo, 0, removed);
                  return a;
                });
              }}
              className={`flex items-center gap-2 bg-white rounded-xl px-2.5 py-2 shadow-sm border cursor-grab active:cursor-grabbing ${isPowder(wi.itemName) ? 'border-orange-100' : 'border-pink-100'}`}
            >
              <GripVertical size={11} className="text-slate-200 shrink-0" />
              <span className={`text-[10px] font-black w-4 shrink-0 ${isPowder(wi.itemName) ? 'text-orange-400' : 'text-pink-500'}`}>{sectionIdx + 1}</span>
              <button
                onClick={e => { e.stopPropagation(); setPreviewOrderId(wi.orderId); }}
                className="flex-1 min-w-0 text-left hover:opacity-70 transition-opacity"
              >
                <p className="text-[11px] font-bold text-slate-700 truncate">{wi.itemName}</p>
                <p className="text-[9px] text-slate-400 truncate">{wi.clientName} · {wi.qty}개</p>
              </button>
              <div className="flex flex-col gap-0.5">
                <button onClick={e => { e.stopPropagation(); moveInSection(wi.key, 'up'); }} disabled={isFirst} className="text-slate-300 hover:text-violet-500 disabled:opacity-20 transition-all"><ChevronUp size={12} /></button>
                <button onClick={e => { e.stopPropagation(); moveInSection(wi.key, 'down'); }} disabled={isLast} className="text-slate-300 hover:text-violet-500 disabled:opacity-20 transition-all"><ChevronDown size={12} /></button>
              </div>
              <button onClick={e => { e.stopPropagation(); removeItem(wi.key); }} className="text-slate-200 hover:text-rose-400 transition-all ml-0.5"><X size={12} /></button>
            </div>
          );
        };

        const renderCol = (col: typeof activeConfigs[0]) => {
          const allColOrders = filteredOrders.filter(o =>
            col.statusFilter.includes(o.status)
          );
          const units = columnUnits[col.id] ?? defaultUnits[col.id] ?? 1;
          const colMax = maxUnits[col.id] ?? 2;
          const Icon = col.icon;
          const groupedOrders: Record<OrderSource, Order[]> = {
            '스마트스토어': allColOrders.filter(o => o.source === '스마트스토어'),
            '택배': allColOrders.filter(o => o.source === '택배'),
            '일반': allColOrders.filter(o => o.source === '일반'),
          };
          return (
            <div key={col.id}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('orderId'); if (id && col.targetStatus) onUpdateStatus(id, col.targetStatus); }}
              className={`flex flex-col rounded-3xl border ${col.borderColor} ${col.bgColor} shadow-sm flex-shrink-0`}
              style={{
                ...(typeof window !== 'undefined' && window.innerWidth >= 768 ? { width: `calc(${units} * (100vw - 9rem) / 6)` } : {}),
                minWidth: 280,
              }}
            >
              <div className="p-5 border-b border-white/50 flex items-center justify-between">
                <button className="flex items-center space-x-3 md:cursor-default" onClick={() => { if (window.innerWidth < 768) toggleMobileCollapse(col.id); }}>
                  <div className={`p-2 rounded-xl ${col.color} text-white`}><Icon size={20} /></div>
                  <h3 className={`font-black text-base ${col.textColor}`}>{col.label} ({allColOrders.length})</h3>
                  <ChevronDown size={14} className={`md:hidden text-slate-400 transition-transform ${mobileCollapsed.has(col.id) ? '' : 'rotate-180'}`} />
                </button>
                <div className="flex items-center space-x-0.5">
                  {units > 1 && <button onClick={() => collapseColumn(col.id)} className="p-1.5 rounded-lg hover:bg-white/60 text-slate-400 transition-all"><ChevronLeft size={14} /></button>}
                  <span className="text-[10px] font-black text-slate-400 px-1">{units}</span>
                  {units < colMax && <button onClick={() => expandColumn(col.id)} className="p-1.5 rounded-lg hover:bg-white/60 text-slate-400 transition-all"><ChevronRight size={14} /></button>}
                </div>
              </div>
              <div className={`p-5 space-y-6 ${mobileCollapsed.has(col.id) ? 'hidden md:block' : ''}`}>
                {(['스마트스토어', '택배', '일반'] as OrderSource[]).map(source => (
                  <OrderSourceGroup key={source} colId={col.id} source={source} orders={groupedOrders[source]} gridCols={units} collapsedCategories={collapsedCategories} onToggleCategory={onToggleCategory} {...cardSharedProps} />
                ))}
                {allColOrders.length === 0 && <div className="flex flex-col items-center justify-center py-20 opacity-20"><Inbox size={48} /><p className="text-xs font-bold mt-2">주문이 없습니다</p></div>}
              </div>
            </div>
          );
        };

        return (
          <div className="flex flex-col md:flex-row gap-4 pb-4 md:items-start">
            {/* 금일 작업순서 패널 */}
            <div className="w-full md:w-60 md:shrink-0 flex flex-col rounded-3xl border border-violet-100 bg-violet-50/50 shadow-sm">
              <div className="p-4 border-b border-white/50 flex items-center justify-between">
                <button className="flex items-center gap-2 md:cursor-default" onClick={() => { if (window.innerWidth < 768) toggleMobileCollapse('work-order'); }}>
                  <div className="p-1.5 rounded-xl bg-violet-600 text-white"><ListOrdered size={16} /></div>
                  <h3 className="font-black text-sm text-violet-700">금일 작업순서</h3>
                  <ChevronDown size={14} className={`md:hidden text-violet-400 transition-transform ${mobileCollapsed.has('work-order') ? '' : 'rotate-180'}`} />
                </button>
                <button
                  onClick={() => { setPickerOrdering(validWorkItems.map(wi => wi.key)); setShowWorkOrderPicker(true); }}
                  className="flex items-center gap-1 text-[10px] font-black text-violet-600 bg-violet-100 hover:bg-violet-200 px-2.5 py-1.5 rounded-lg transition-all"
                >
                  <Plus size={11} /> 주문추가
                </button>
              </div>
              <div className={`p-3 flex flex-col gap-2 min-h-[100px] ${mobileCollapsed.has('work-order') ? 'hidden md:flex' : ''}`}>
                {validWorkItems.length === 0 ? (
                  <p className="text-center text-[11px] text-violet-300 py-8 font-bold">주문추가 버튼으로<br/>순서를 설정하세요</p>
                ) : (
                  <>
                    {oilItems.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[9px] font-black text-pink-500 uppercase tracking-wider px-1">기름</span>
                        {oilItems.map(wi => renderItemRow(wi, oilItems))}
                      </div>
                    )}
                    {powderItems.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        {oilItems.length > 0 && <div className="border-t border-violet-100 my-1" />}
                        <span className="text-[9px] font-black text-orange-500 uppercase tracking-wider px-1">가루</span>
                        {powderItems.map(wi => renderItemRow(wi, powderItems))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            {/* 대기중 + 작업중 컬럼들 */}
            <div className="flex-1 md:overflow-x-auto no-scrollbar">
              <div className="flex flex-col md:flex-row md:min-w-max gap-4 pb-4">
                {activeConfigs.map(col => renderCol(col))}
              </div>
            </div>

            {/* 작업순서 설정 모달 */}
            {showWorkOrderPicker && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowWorkOrderPicker(false)}>
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[75vh] animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <h3 className="font-black text-slate-900">작업순서 설정</h3>
                    <button onClick={() => setShowWorkOrderPicker(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"><X size={16} /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {allPickableItems.length === 0 ? (
                      <p className="text-center text-sm text-slate-400 py-12">대기중/작업중 주문이 없습니다.</p>
                    ) : pickableOrders.map(o => {
                      const clientName = o.customerName || clients.find(c => c.id === o.clientId)?.name || '이름없음';
                      const orderItems = allPickableItems.filter(wi => wi.orderId === o.id);
                      return (
                        <div key={o.id} className="px-5 py-3 border-b border-slate-50">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-bold text-slate-700">{clientName}</span>
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${o.status === OrderStatus.PROCESSING ? 'bg-sky-100 text-sky-600' : 'bg-amber-100 text-amber-600'}`}>
                              {o.status === OrderStatus.PROCESSING ? '작업중' : '대기중'}
                            </span>
                          </div>
                          <div className="space-y-1">
                            {orderItems.map(wi => {
                              const isSelected = pickerOrdering.includes(wi.key);
                              // 섹션별 독립 번호
                              const sectionOrder = pickerOrdering.filter(k => {
                                const it = allPickableItems.find(x => x.key === k);
                                return it && (isPowder(wi.itemName) ? isPowder(it.itemName) : isOil(it.itemName));
                              });
                              const sectionPos = sectionOrder.indexOf(wi.key) + 1;
                              return (
                                <div key={wi.key}
                                  onClick={() => setPickerOrdering(prev => isSelected ? prev.filter(k => k !== wi.key) : [...prev, wi.key])}
                                  className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors ${isSelected ? (isPowder(wi.itemName) ? 'bg-orange-50' : 'bg-pink-50') : 'hover:bg-slate-50'}`}
                                >
                                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 text-[10px] font-black transition-all ${isSelected ? (isPowder(wi.itemName) ? 'bg-orange-500 border-orange-500 text-white' : 'bg-pink-500 border-pink-500 text-white') : 'border-slate-300 text-transparent'}`}>
                                    {isSelected ? sectionPos : ''}
                                  </div>
                                  <span className="flex-1 text-sm font-bold text-slate-700 truncate">{wi.itemName}</span>
                                  <span className="text-[10px] font-black text-slate-400 shrink-0">{wi.qty}개</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="p-4 border-t border-slate-100 flex gap-2">
                    <button onClick={() => setShowWorkOrderPicker(false)} className="flex-1 py-2.5 text-sm font-bold text-slate-400 hover:text-slate-600 transition-all">취소</button>
                    <button
                      onClick={() => {
                        const newItems = pickerOrdering
                          .map(key => allPickableItems.find(wi => wi.key === key))
                          .filter((wi): wi is WorkItem => wi !== undefined);
                        setWorkItems(newItems);
                        setShowWorkOrderPicker(false);
                      }}
                      className="flex-1 py-2.5 text-sm font-black bg-violet-600 text-white rounded-2xl hover:bg-violet-700 transition-all shadow"
                    >
                      확인 ({pickerOrdering.length}건)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── 주문이력 탭: 예전주문이력 전체 폭 ── */}
      {activeTab === 'history' && (() => {
        const col = historyConfig;
        const allColOrders = filteredOrders.filter(o => col.statusFilter.includes(o.status));
        const filteredHistoryOrders = allColOrders.filter(o => {
          if (historySearch && !((o.customerName || '').includes(historySearch))) return false;
          const dateStr = (o.deliveredAt || o.deliveryDate || o.createdAt || '').slice(0, 10);
          if (historyDateFrom && dateStr < historyDateFrom) return false;
          if (historyDateTo && dateStr > historyDateTo) return false;
          return true;
        });
        const hasHistoryFilter = !!(historySearch || historyDateFrom || historyDateTo);
        const colOrders = hasHistoryFilter ? filteredHistoryOrders : (showAllHistory ? filteredHistoryOrders : filteredHistoryOrders.slice(0, HISTORY_PREVIEW));
        const Icon = col.icon;
        const groupedOrders: Record<OrderSource, Order[]> = {
          '스마트스토어': colOrders.filter(o => o.source === '스마트스토어'),
          '택배': colOrders.filter(o => o.source === '택배' || (o.source === '일반' && o.deliveryBoxes !== undefined)),
          '일반': colOrders.filter(o => o.source === '일반' && o.deliveryBoxes === undefined),
        };
        return (
          <div className={`flex flex-col rounded-3xl border ${col.borderColor} ${col.bgColor} shadow-sm`}>
            <div className="p-5 border-b border-white/50 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-xl ${col.color} text-white`}><Icon size={20} /></div>
                <h3 className={`font-black text-base ${col.textColor}`}>{col.label} ({colOrders.length}/{allColOrders.length})</h3>
              </div>
            </div>
            <div className="px-5 py-3 border-b border-white/50 flex flex-col gap-2">
              <input type="text" placeholder="거래처 검색" value={historySearch} onChange={e => setHistorySearch(e.target.value)}
                className="w-full text-xs px-3 py-1.5 rounded-xl border border-slate-200 bg-white outline-none focus:ring-1 focus:ring-slate-400" />
              <div className="flex items-center gap-1">
                <input type="date" value={historyDateFrom} onChange={e => setHistoryDateFrom(e.target.value)} className="flex-1 text-[10px] px-2 py-1 rounded-xl border border-slate-200 bg-white outline-none" />
                <span className="text-[10px] text-slate-400">~</span>
                <input type="date" value={historyDateTo} onChange={e => setHistoryDateTo(e.target.value)} className="flex-1 text-[10px] px-2 py-1 rounded-xl border border-slate-200 bg-white outline-none" />
                {hasHistoryFilter && <button onClick={() => { setHistorySearch(''); setHistoryDateFrom(''); setHistoryDateTo(''); }} className="text-[10px] text-slate-400 hover:text-slate-600 px-1">✕</button>}
              </div>
            </div>
            <div className="p-5 space-y-6">
              {(['스마트스토어', '택배', '일반'] as OrderSource[]).map(source => (
                <OrderSourceGroup key={source} colId={col.id} source={source} orders={groupedOrders[source]} gridCols={3} collapsedCategories={collapsedCategories} onToggleCategory={onToggleCategory} {...cardSharedProps} />
              ))}
              {colOrders.length === 0 && <div className="flex flex-col items-center justify-center py-20 opacity-20"><Inbox size={48} /><p className="text-xs font-bold mt-2">주문이 없습니다</p></div>}
              {!hasHistoryFilter && filteredHistoryOrders.length > HISTORY_PREVIEW && (
                <button onClick={() => setShowAllHistory(v => !v)} className="w-full py-2 text-[11px] font-bold text-slate-400 hover:text-slate-600 hover:bg-white/60 rounded-xl transition-all">
                  {showAllHistory ? '▲ 접기' : `▼ 더 보기 (${filteredHistoryOrders.length - HISTORY_PREVIEW}건 더)`}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── 작업순서 품목 클릭 → 주문카드 팝업 ── */}
      {previewOrderId && (() => {
        const order = orders.find(o => o.id === previewOrderId);
        if (!order) return null;
        const clientName = order.customerName || clients.find(c => c.id === order.clientId)?.name || '이름없음';
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setPreviewOrderId(null)}
          >
            <div
              className="bg-slate-50 rounded-3xl shadow-2xl w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-200 flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-white rounded-t-3xl">
                <div>
                  <h3 className="font-black text-slate-900">{clientName}</h3>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                    order.status === OrderStatus.PROCESSING ? 'bg-sky-100 text-sky-600' : 'bg-amber-100 text-amber-600'
                  }`}>
                    {order.status === OrderStatus.PROCESSING ? '작업중' : '대기중'}
                  </span>
                </div>
                <button onClick={() => setPreviewOrderId(null)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
                  <X size={16} />
                </button>
              </div>
              <div className="p-4 overflow-y-auto max-h-[70vh]">
                <OrderCard
                  order={order}
                  clients={clients}
                  products={products}
                  editingOrderId={editingOrderId}
                  setEditingOrderId={setEditingOrderId}
                  showAddProductSelect={showAddProductSelect}
                  setShowAddProductSelect={setShowAddProductSelect}
                  onUpdateItems={onUpdateItems}
                  onUpdateDeliveryDate={onUpdateDeliveryDate}
                  onUpdateStatus={onUpdateStatus}
                  onToggleItemChecked={onToggleItemChecked}
                  onDeleteOrder={onDeleteOrder}
                />
              </div>
            </div>
          </div>
        );
      })()}
      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          subMessage={confirmModal.subMessage}
          confirmText={confirmModal.confirmText}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
};

export default OrdersList;
