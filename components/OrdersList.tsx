
import React, { useState, useEffect, useMemo, memo } from 'react';
import { today, dateOfLocal } from '../src/shared/day';
import { matchesSearch } from '../src/shared/hangul';
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
  GripVertical,
  ClipboardPaste,
  Layers
} from 'lucide-react';
import { Order, OrderStatus, Partner, OrderSource, OrderItem, Item, OrderPallet, DeliveryBox, PalletStock, ItemBom, PartnerItem } from '../types';
import { splitNameVolume, specText } from '../src/shared/productChip';
import { isBulkItem } from '../src/shared/itemTaxonomy';
import { boxSiblings, isBoxStockItem, unpackComponent, unitsPerBoxOf } from '../src/shared/orderUnits';
import { bomOf } from '../src/shared/bomIndex';
import { subDotClass } from '../src/shared/submaterialStyle';

import ConfirmModal from './ConfirmModal';
import PageHeader from './PageHeader';
import { cardNoLabel } from '../src/shared/cardNo';

/** 이름 끝 용량은 뗀다 — 규격 칩이 이미 들고 있어 '참기름/병/A/300ml [300ml * 20]'처럼 겹친다. */
const baseName = (name: string): string => splitNameVolume({ name }).base;

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

/**
 * 카드 머리 띠 — 거래처명 줄에 **상태색 바탕**을 깐다. 카드를 멀리서 봐도 상태가 읽힌다.
 * 글자는 진한 쪽, 바탕은 옅은 쪽이라 이름이 묻히지 않는다.
 */
const STATUS_HEAD: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  PROCESSING: 'bg-sky-100 text-sky-800',
  DISPATCHED: 'bg-emerald-100 text-emerald-800',
  SHIPPED: 'bg-indigo-100 text-indigo-800',
  DELIVERED: 'bg-slate-100 text-slate-600',
};

// ─── Props 타입 ───────────────────────────────────────────────────────────────

interface OrdersListProps {
  title: string;
  subtitle: string;
  groupBy: 'status' | 'source';
  allowedStatuses: OrderStatus[];
  orders: Order[];
  partners: Partner[];
  items: Item[];
  partnerItems?: PartnerItem[];
  palletStocks?: PalletStock[];
  itemBoms?: ItemBom[];
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
  onPasteClick?: () => void;
  currentUserName?: string;
  highlightOrderId?: string | null;
  onHighlightClear?: () => void;
  newOrderId?: string | null;
  onNewOrderIdClear?: () => void;
  workOrderItems?: { key: string; orderId: string; itemId: string; itemName: string; partnerName: string; qty: number; category: string }[];
  onSetWorkOrderItems?: (items: { key: string; orderId: string; itemId: string; itemName: string; partnerName: string; qty: number; category: string }[]) => void;
  onLoadHistoricalOrders?: (start: string, end: string) => Promise<void>;
  isLoadingHistoricalOrders?: boolean;
  ordersMonths?: number;
  onChangeOrdersMonths?: (n: number) => void;
}

interface OrderCardProps {
  order: Order;
  partners: Partner[];
  items: Item[];
  partnerItems?: PartnerItem[];
  palletStocks?: PalletStock[];
  itemBoms?: ItemBom[];
  editingOrderId: string | null;
  setEditingOrderId: (id: string | null) => void;
  showAddProductSelect: string | null;
  setShowAddProductSelect: (id: string | null) => void;
  onUpdateItems?: (id: string, items: OrderItem[]) => void;
  onUpdateDeliveryDate: (id: string, date: string) => void;
  onUpdateStatus: (id: string, status: OrderStatus) => void;
  onUpdatePallets?: (id: string, pallets: OrderPallet[]) => void;
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
  partners: Partner[];
  items: Item[];
  partnerItems?: PartnerItem[];
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
  onCardClick?: (orderId: string) => void;
}

interface DeliveryRowProps {
  order: Order;
  partnerName: string;
  items: Item[];
  onToggleInvoicePrinted?: (id: string, val: boolean) => void;
  onUpdateDeliveryBoxes?: (id: string, boxes: DeliveryBox[]) => void;
}

type TabType = 'delivery' | 'active' | 'history';

// ─── OrderCard ────────────────────────────────────────────────────────────────

/**
 * **카드 순서를 못 박는다** — 납기 → 주문일 → id.
 *
 * 예전엔 정렬이 아예 없어서 Firestore 스냅샷이 주는 순서를 그대로 썼다. 주문을 고치면
 * (품목 추가 같은 것) 그 문서가 다시 실려 오면서 **카드가 목록 안에서 튀었다.**
 * 무엇을 고쳤든 자리는 그대로여야 눈이 안 흔들린다.
 */
const byDeliveryThenId = (a: Order, b: Order) =>
  String(a.deliveryDate ?? '').localeCompare(String(b.deliveryDate ?? ''))
  || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
  || String(a.id).localeCompare(String(b.id));

export const OrderCard = memo<OrderCardProps>(({
  order, partners, items, partnerItems,
  editingOrderId, setEditingOrderId,
  showAddProductSelect, setShowAddProductSelect,
  onUpdateItems, onUpdateDeliveryDate, onUpdateStatus, onUpdatePallets,
  onToggleItemChecked, onDeleteOrder, currentUserName, gridCols = 1, isHighlighted = false, highlightOrderId, palletStocks = [], itemBoms = [],
}) => {
  // Compute derived variables
  const products = items;
  const highlighted = isHighlighted || highlightOrderId === order.id;
  const isEditing = editingOrderId === order.id;
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; confirmText?: string; onConfirm: () => void } | null>(null);
  const [expandedItemBom, setExpandedItemBom] = useState<Set<string>>(new Set()); // 박스 완제품 구성 펼치기
  const [addItemQuery, setAddItemQuery] = useState('');   // 품목 추가 패널 검색어

  // 향미유·고춧가루 제외한 품목만 진행률 및 완료 판단에 사용
  const isSecondary = (cat?: string) => cat === '향미유' || cat === '고춧가루';
  const nonHyangmiyuItems = order.items.filter(item => {
    const p = items.find(p => p.id === item.itemId);
    return !isSecondary(p?.type);
  });
  const totalItems = nonHyangmiyuItems.length || 1;
  const completedItems = nonHyangmiyuItems.filter(i => i.checked).length;
  const progress = Math.round((completedItems / totalItems) * 100);
  const isFullyDone = progress === 100;
  const allNonHyangmiyuDone = nonHyangmiyuItems.length > 0 && nonHyangmiyuItems.every(i => i.checked);

  // 접힘 상태: DISPATCHED/SHIPPED 카드는 초기에 접힘
  const [isCollapsed, setIsCollapsed] = useState(
    order.status === OrderStatus.DISPATCHED || order.status === OrderStatus.SHIPPED || order.status === OrderStatus.ON_HOLD
  );
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showPalletPicker, setShowPalletPicker] = useState(false);

  useEffect(() => {
    if (!showStatusPicker) return;
    const close = () => setShowStatusPicker(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showStatusPicker]);

  useEffect(() => {
    if (!showPalletPicker) return;
    const close = () => setShowPalletPicker(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showPalletPicker]);

  /**
   * 다 체크되면 카드를 접기만 한다. **상태는 안 건드린다.**
   *
   * 예전엔 여기서 작업완료로 바로 넘겼는데, 그러면 handleToggleItemChecked가 띄우는
   * '작업완료로 보낼까요?'에서 취소를 눌러도 이 effect가 그냥 보내 버렸다.
   * 상태를 옮기는 자리는 한 곳(handleToggleItemChecked)뿐이어야 한다 —
   * 작업완료는 원료를 차감하는 되돌리기 어려운 일이라 더 그렇다.
   */
  useEffect(() => {
    if (allNonHyangmiyuDone) setIsCollapsed(true);
  }, [allNonHyangmiyuDone]);

  const partner = partners.find(c => c.id === order.partnerId);
  const rawName = order.partnerName || partner?.name || '이름 없음';
  const displayName = rawName.replace(/\s*\(\d{4}\.\s*\d+\.\s*\d+\.?\)\s*$/, '');

  const handleDirectQtyChange = (idx: number, value: string) => {
    const qty = parseInt(value) || 0;
    const newItems = [...order.items];
    const item = newItems[idx];
    if (item.isBoxUnit && item.unitsPerBox) {
      // 박스 수 입력 → 낱개 수 자동 계산
      newItems[idx] = { ...item, boxQuantity: qty, quantity: qty * item.unitsPerBox };
    } else if (item.isBoxUnit) {
      // 박스 단위이지만 unitsPerBox 미설정 — 박스 수 = quantity
      newItems[idx] = { ...item, boxQuantity: qty, quantity: qty };
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

  const handleAddItem = (product: Item) => {
    const newItem: OrderItem = {
      itemId: product.id, name: product.name,
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
      onClick={() => { if (!isEditing) { setEditingOrderId(order.id); setShowAddProductSelect(null); } }}
      className={`bg-white rounded-2xl shadow-sm border transition-all group relative animate-in zoom-in-95 duration-200 ${isEditing ? 'ring-2 ring-indigo-500 border-indigo-200 shadow-xl z-20' : highlighted ? 'ring-2 ring-amber-400 border-amber-300 shadow-lg shadow-amber-100' : 'border-slate-100 hover:shadow-md hover:border-indigo-100 cursor-pointer'} ${isCollapsed ? 'p-2.5' : 'p-4'} flex flex-col`}
    >
      {/* 머리 띠 — 카드 좌우 끝까지 닿게 음수 여백으로 빼고 위 모서리만 둥글린다 */}
      <div className={`flex justify-between items-center rounded-t-2xl ${STATUS_HEAD[order.status] ?? 'bg-slate-100 text-slate-600'} ${
        isCollapsed ? '-mx-2.5 -mt-2.5 px-2.5 py-1.5 mb-1.5' : '-mx-4 -mt-4 px-4 py-2.5 mb-3'}`}>
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {/* 색을 안 준다 — 머리 띠의 상태 글자색을 그대로 물려받아 상태와 같은 색이 된다 */}
          <h4 className="font-black leading-tight text-base break-words">{displayName}</h4>
          {nonHyangmiyuItems.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIsCollapsed(prev => !prev); }}
              className="text-[12px] font-black shrink-0 transition-all hover:opacity-70 opacity-80"
            >
              {completedItems}/{totalItems}
            </button>
          )}
        </div>
        {/* 주문 상태 — 카드 **우측 상단**. 거래처명 옆에 두니 이름이 길 때 밀려 안 보였다.
            드롭다운은 오른쪽 기준으로 펼친다(왼쪽 기준이면 카드 밖으로 나간다). */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowStatusPicker(p => !p); }}
            className="text-[12px] font-black transition-all hover:opacity-70 opacity-80"
          >
            {STATUS_LABEL[order.status] ?? order.status}
          </button>
          {showStatusPicker && (
            <div
              className="absolute top-full right-0 mt-1 z-50 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden flex flex-col min-w-[72px]"
              onClick={(e) => e.stopPropagation()}
            >
              {([
                [OrderStatus.PENDING,    '대기중',   'hover:bg-amber-50 text-amber-700'],
                [OrderStatus.PROCESSING, '작업중',   'hover:bg-sky-50 text-sky-700'],
                [OrderStatus.DISPATCHED, '작업완료', 'hover:bg-emerald-50 text-emerald-700'],
              ] as [OrderStatus, string, string][]).map(([st, label, cls]) => (
                <button
                  key={st}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateStatus(order.id, st);
                    setShowStatusPicker(false);
                  }}
                  className={`px-3 py-2 text-[10px] font-black text-left transition-all ${cls} ${order.status === st ? 'opacity-40 cursor-default' : ''}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {isEditing && (
          <button
            onClick={(e) => { e.stopPropagation(); setEditingOrderId(null); setShowAddProductSelect(null); }}
            className="p-1.5 rounded-lg transition-all bg-indigo-600 text-white shrink-0"
            title="편집 완료"
          >
            <Check size={14} />
          </button>
        )}
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
              const editProductInfo = items.find(p => p.id === item.itemId);
              //  박스로 주문할 수 있느냐는 **개입수가 있느냐**로 정한다 —
              //  박스 품목은 BOM 이, 향미유·고춧가루는 포장 환산표가 답한다.
              //  예전엔 '향미유·고춧가루면'으로 갈래를 박아 둬서 다른 품목은 아예 못 골랐다.
              const isOil = unitsPerBoxOf(editProductInfo) > 0;
              // 주문에 박힌 값 → 품목이 아는 개입수(BOM 아니면 포장 환산표)
              const qtyPerBox = item.unitsPerBox ?? unitsPerBoxOf(editProductInfo);
              const toggleBoxUnit = () => {
                const newItems = [...order.items];
                if (item.isBoxUnit) {
                  newItems[idx] = { ...item, isBoxUnit: false, boxQuantity: undefined };
                } else {
                  const bq = qtyPerBox ? Math.max(1, Math.round(item.quantity / qtyPerBox)) : item.quantity;
                  newItems[idx] = { ...item, isBoxUnit: true, boxQuantity: bq, unitsPerBox: qtyPerBox, quantity: qtyPerBox ? bq * qtyPerBox : bq };
                }
                onUpdateItems?.(order.id, newItems);
              };
              return (
                <div key={idx} className="flex flex-col gap-1 text-[10px] font-bold border-b border-slate-50 pb-2 last:border-0">
                  {/* **이름 → 규격 → 수량**을 한 줄에. 수량을 아래로 내리면 품목마다 두 줄이 되고,
                      규격이 없으면 어느 규격의 수량인지 눈으로 안 갈린다. */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-800 text-[11px] leading-snug break-words min-w-0 flex-1">{item.name}</span>
                    {/* 규격 — 벌크는 규격이 없다(자루째 kg으로 센다). spec에 '1kg'을 넣으면
                        코드가 그걸 낱개 용량·개입수로 읽어 박스 계산이 어긋나므로 넣으면 안 된다.
                        대신 '벌크'라고 적어 준다. 단위는 수량칸 옆에 따로 붙는다. */}
                    {(editProductInfo?.spec || (editProductInfo && isBulkItem(editProductInfo))) && (
                      <span className="text-[9px] font-bold text-slate-400 shrink-0">
                        {editProductInfo?.spec || '벌크'}
                      </span>
                    )}
                    {/* 향미유·고춧가루: 낱개/박스 토글 */}
                    {isOil && (
                      <button
                        onClick={() => toggleBoxUnit()}
                        className={`text-[8px] font-black px-1.5 py-0.5 rounded border transition-all shrink-0 ${item.isBoxUnit ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-slate-100 border-slate-200 text-slate-500'}`}
                      >
                        {item.isBoxUnit ? '박스' : '낱개'}
                      </button>
                    )}
                    {item.isBoxUnit ? (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <input type="number" value={item.boxQuantity ?? 1} onChange={(e) => handleDirectQtyChange(idx, e.target.value)}
                          className="w-8 text-center bg-slate-50 border border-indigo-200 rounded outline-none font-bold py-0.5" />
                        <span className="text-[8px] font-bold text-slate-400">박스</span>
                        {qtyPerBox ? <span className="text-[8px] font-bold text-indigo-400">={item.quantity}개</span> : null}
                      </div>
                    ) : (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <input type="number" value={item.quantity} onChange={(e) => handleDirectQtyChange(idx, e.target.value)}
                          className="w-10 text-center bg-slate-50 border border-indigo-200 rounded outline-none font-bold py-0.5" />
                        {/* 단위는 칸 **바깥**에 — 안에 넣으면 숫자와 겹쳐 읽힌다 */}
                        <span className="text-[8px] font-bold text-slate-400">{editProductInfo?.unit || '개'}</span>
                      </div>
                    )}
                    <button onClick={() => handleRemoveItem(idx)} className="ml-auto p-1 text-rose-400 hover:bg-rose-50 rounded shrink-0"><Trash2 size={10} /></button>
                  </div>
                  {!isOil && (
                    <input type="date" value={item.mfgDate || ''} onChange={(e) => handleExpirationDateChange(idx, e.target.value)}
                      className="text-[9px] bg-slate-50 border border-indigo-200 rounded font-bold py-0.5 px-1 w-full text-center text-slate-600 cursor-pointer" />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* 보기 모드 */
          <div className="space-y-2.5">
            {/* 접힌 상태: 완료 요약만 표시 */}
            {/* 일반 품목 (완제품): 펼쳐진 상태에서만 표시 */}
            {!isCollapsed && order.items.filter(item => {
              const p = items.find(p => p.id === item.itemId);
              return !isSecondary(p?.type);
            }).map((item, _) => {
              const idx = order.items.indexOf(item);
              const isItemChecked = !!item.checked;
              const productInfo = items.find(p => p.id === item.itemId);
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
                <div key={idx} className="flex flex-col border-b border-slate-100 pb-2.5 last:border-0 last:pb-0 cursor-pointer select-none" onClick={(e) => { e.stopPropagation(); onToggleItemChecked?.(order.id, idx, currentUserName); }}>
                  <div className="flex items-center text-[12px] font-bold">
                    <div className={`mr-1.5 shrink-0 ${isItemChecked ? 'text-emerald-600' : 'text-slate-300'}`}>
                      {isItemChecked ? <CheckSquare size={14} /> : <Square size={14} />}
                    </div>
                    <span className={`break-words min-w-0 ${isItemChecked ? 'text-emerald-800 line-through opacity-50' : 'text-slate-700'}`}>{abbrev(baseName(item.name))}</span>
                    {/* 규격 — 품목과 **같은 크기, 색 없이**. 칩으로 칠해 두면 품목보다 눈에 먼저 띈다. */}
                    {(() => {
                      const sp = productInfo ? (specText(productInfo.spec) || splitNameVolume(productInfo).vol) : '';
                      return sp ? <span className={`ml-1.5 shrink-0 ${isItemChecked ? 'text-emerald-800 opacity-50' : 'text-slate-400'}`}>{sp}</span> : null;
                    })()}
                    {/* 주문수량 — 배지 없이 오른쪽 끝에. 수량은 굵게, 단위는 얇게. 카드에서 제일 먼저 읽는 값이다. */}
                    {(() => {
                      const box = item.isBoxUnit && item.boxQuantity;
                      const qty = box ? item.boxQuantity! : item.quantity;
                      const unit = box ? '박스' : (productInfo?.unit || '개');
                      const sub = box && item.unitsPerBox ? `${item.quantity}개` : '';
                      return (
                        <span className={`ml-auto pl-1.5 shrink-0 whitespace-nowrap ${isItemChecked ? 'opacity-50' : ''}`}>
                          <span className={`text-base font-black ${isItemChecked ? 'text-emerald-800' : 'text-slate-800'}`}>{qty}</span>
                          <span className="text-[12px] font-normal text-slate-400 ml-0.5">{unit}</span>
                          {sub && <span className="text-[12px] font-normal text-slate-300 ml-1">{sub}</span>}
                        </span>
                      );
                    })()}
                  </div>
                  {/* 라벨 상태·소비기한 — **품목명 바로 밑**. 부자재보다 먼저 챙기는 정보라 위로 올린다.
                      소비기한은 안 정해져 있어도 자리를 지킨다: 비어 있다는 걸 보여야 채워 넣는다. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5 pl-[20px]">
                    <button type="button" onClick={(e) => { e.stopPropagation(); const ni = [...order.items]; ni[idx] = { ...ni[idx], labelType: next }; onUpdateItems?.(order.id, ni); }}
                      className={`text-[11px] font-black px-1.5 py-0.5 rounded border transition-all shrink-0 ${colorMap[current]}`}>{current}</button>
                    {/* 눌러서 제조일을 고르면 1년 뒤로 소비기한이 잡힌다.
                        날짜 입력을 글자 위에 투명하게 얹어 네이티브 달력이 뜨게 한다. */}
                    <span className="relative inline-flex items-center text-[11px] font-bold text-slate-400 shrink-0 hover:text-slate-600"
                      title="제조일을 고르면 1년 뒤로 소비기한이 잡힙니다">
                      소비기한&nbsp;{item.mfgDate
                        ? <span className="text-slate-600">~{(() => { const d = new Date(item.mfgDate!); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(2, 10); })()}</span>
                        : <span className="text-slate-300 underline decoration-dotted underline-offset-2">미설정</span>}
                      <input type="date" value={item.mfgDate || ''}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { e.stopPropagation(); handleExpirationDateChange(idx, e.target.value); }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    </span>
                    {item.checked && item.checkedBy && (
                      <span className="text-[11px] font-bold text-slate-400 shrink-0">{item.checkedBy}</span>
                    )}
                    {productInfo?.oil && <span className="text-[11px] text-indigo-500 font-bold shrink-0">{productInfo.oil}</span>}
                  </div>
                  {(() => {
                    // 박스 품목이면 카톤/테이프 표시, 낱개(비박스)면 출고 카톤·테이프는 뺀다(박스=품목).
                    const isBoxProd = isBoxStockItem(productInfo);
                    const isShipPkg = (p: Item) => p.type === 'box' || p.category === '박스' || p.category === '테이프';
                    // 1. item_bom 기반 구성품 (submaterial 카테고리만) — 낱개는 박스/테이프 제외
                    const bomSubs = itemBoms
                      .filter(b => b.parent_id === item.itemId)
                      .map(b => items.find(p => p.id === b.child_id))
                      .filter((p): p is Item => !!p && p.type === 'submaterial' && (isBoxProd || !isShipPkg(p)));
                    const bomSubIds = new Set(bomSubs.map(p => p.id));

                    //  옛 품목 구성품 스냅샷(Item.submaterials)으로 라벨을 보완하던 자리 — 그 필드를 없앴다.
                    //  라벨은 item_bom에만 있고, BOM이 지워진 품목을 가리키면 BomIntegrityPanel이 잡는다.
                    const snapLabels: { id: string; name: string }[] = [];

                    // 2. 박스/테이프: 박스 품목만. 낱개(비박스)는 출고 카톤·테이프 표시 안 함.
                    const packagingSubs: { id: string; name: string }[] = [];
                    if (isBoxProd) {
                      // 겉박스·테이프는 박스 품목 BOM에 들어 있다(위 bomSubs). 주문에 박아 둔 boxSubId만 보탠다.
                      const boxId = item.boxSubId;
                      if (boxId) { const b = items.find(p => p.id === boxId); if (b && !bomSubIds.has(b.id)) packagingSubs.push({ id: b.id, name: b.name }); }
                    }

                    // 3. 완제품/반제품 구성품 (박스의 낱개 등) — 펼치면 그 완제품의 부자재까지
                    //    벌크(kg·L로 재는 원료·반제품)는 뺀다 — 작업자가 챙길 물건이 아니라 통에서 나오는 것이다.
                    const bomProducts = itemBoms
                      .filter(b => b.parent_id === item.itemId)
                      .map(b => ({ qty: b.quantity, p: items.find(p => p.id === b.child_id) }))
                      .filter((r): r is { qty: number; p: Item } =>
                        !!r.p && !isBulkItem(r.p) && (r.p.type === 'product' || r.p.type === 'wip' || r.p.type === '완제품'));

                    const allSubs = [...bomSubs.map(p => ({ id: p.id, name: p.name })), ...snapLabels, ...packagingSubs];
                    if (allSubs.length === 0 && bomProducts.length === 0) return null;
                    const rowKey = `${order.id}-${idx}`;
                    const open = expandedItemBom.has(rowKey);
                    return (
                      <>
                      {/* 칩이던 시절엔 폭이 넓어 2칸 그리드로 눌러 담았는데, 점 표기라 짧아졌다.
                          그냥 흐르게 두면 모바일에서 완제품이 혼자 줄바꿈되지 않는다. */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pl-[20px]">
                        {/* 부자재 — 칩으로 칠하면 배경이 글자보다 먼저 읽힌다. 이름 앞에 점만 찍는다: ● 테이프-빨강 */}
                        {allSubs.map(sm => {
                          const _s = items.find(p => p.id === sm.id) ?? { name: sm.name };
                          return (
                            <span key={sm.id} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 shrink-0">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${subDotClass(_s)}`} />
                              {sm.name}
                            </span>
                          );
                        })}
                      </div>
                      {/* 구성품 완제품(박스 안의 낱개)은 **줄을 따로 쓴다.** 부자재와 급이 달라
                          같은 줄에 섞이면 어디까지가 부자재인지 흐려진다.
                          눌러서 그 낱개의 부자재를 펼친다 — 화살표 없이 점만 두고 색으로 구분한다. */}
                      {bomProducts.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pl-[20px]">
                          {bomProducts.map(({ p, qty }) => (
                            <button key={p.id} type="button"
                              onClick={(e) => { e.stopPropagation(); setExpandedItemBom(prev => { const n = new Set(prev); n.has(rowKey) ? n.delete(rowKey) : n.add(rowKey); return n; }); }}
                              className="inline-flex items-center gap-1 text-[11px] font-black text-indigo-500 shrink-0 hover:text-indigo-700">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${open ? 'bg-indigo-600' : 'bg-indigo-300'}`} />
                              {abbrev(p.name)}{qty > 1 ? `×${qty}` : ''}
                            </button>
                          ))}
                        </div>
                      )}
                      {open && bomProducts.map(({ p }) => {
                        // 펼친 낱개의 부자재 — 벌크는 여기서도 뺀다
                        const cSubs = bomOf(p.id).filter(l => {
                          const ci = l.child;
                          return ci?.type === 'submaterial' && !isShipPkg(ci) && !isBulkItem(ci);
                        });
                        return (
                          <div key={`exp-${p.id}`} className="flex flex-wrap items-center gap-1 pl-[28px] mt-0.5" onClick={e => e.stopPropagation()}>
                            {/* 어느 낱개인지는 방금 누른 점이 말해 준다 — 이름을 또 적으면 줄만 길어진다.
                                구성 낱개가 둘 이상일 때만 어느 것인지 밝힌다. */}
                            {bomProducts.length > 1 && (
                              <span className="text-[9px] font-black text-indigo-300">└ {abbrev(p.name)}</span>
                            )}
                            {cSubs.length === 0
                              ? <span className="text-[9px] text-slate-300">부자재 없음</span>
                              : cSubs.map((l, i) => (
                                  <span key={i} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 shrink-0">
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${subDotClass(l.child)}`} />
                                    {l.child?.name ?? l.childId}
                                  </span>
                                ))}
                          </div>
                        );
                      })}
                      </>
                    );
                  })()}
                </div>
              );
            })}
            {/* 향미유·고춧가루: 카테고리별 구분 표시 */}
            {(() => {
              const abbrev = (name: string) => name
                .replace(/참진한기름/g, '참진').replace(/참고소한기름/g, '참고소')
                .replace(/들향기름골드/g, '들향골드').replace(/참향기름/g, '참향')
                .replace(/들향기름/g, '들향').replace(/맛기름/g, '맛');
              const hyangmiyuItems = order.items.filter(item => items.find(p => p.id === item.itemId)?.type === '향미유');
              const gochuItems = order.items.filter(item => items.find(p => p.id === item.itemId)?.type === '고춧가루');
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
                            <div className="flex items-center gap-1 cursor-pointer select-none" onClick={(e) => { e.stopPropagation(); onToggleItemChecked?.(order.id, idx); }}>
                              <div className={`shrink-0 ${isItemChecked ? 'text-emerald-600' : 'text-slate-300'}`}>
                                {isItemChecked ? <CheckSquare size={12} /> : <Square size={12} />}
                              </div>
                              <span className={`${isItemChecked ? 'line-through text-slate-400' : 'text-slate-700'}`}>{abbrev(baseName(item.name))}</span>
                              {(() => {
                                const _p = items.find(p => p.id === item.itemId);
                                const sp = _p ? (specText(_p.spec) || splitNameVolume(_p).vol) : '';
                                return sp ? <span className="ml-1.5 shrink-0 text-slate-400">{sp}</span> : null;
                              })()}
                            </div>
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
                            <div className="flex items-center gap-1 cursor-pointer select-none" onClick={(e) => { e.stopPropagation(); onToggleItemChecked?.(order.id, idx); }}>
                              <div className={`shrink-0 ${isItemChecked ? 'text-emerald-600' : 'text-slate-300'}`}>
                                {isItemChecked ? <CheckSquare size={12} /> : <Square size={12} />}
                              </div>
                              <span className={`${isItemChecked ? 'line-through text-slate-400' : 'text-slate-700'}`}>{baseName(item.name)}</span>
                              {(() => {
                                const _p = items.find(p => p.id === item.itemId);
                                const sp = _p ? (specText(_p.spec) || splitNameVolume(_p).vol) : '';
                                return sp ? <span className="ml-1.5 shrink-0 text-slate-400">{sp}</span> : null;
                              })()}
                            </div>
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
              {(() => {
                /**
                 * **옛 한글 타입을 보고 있었다** — `p.type === '완제품'`·`'향미유'`·`'고춧가루'`.
                 * 지금 타입은 product·goods·wip·raw·submaterial이고 향미유·고춧가루는 category다.
                 * 그래서 목록이 통째로 비어 **품목을 하나도 못 넣었다.**
                 *
                 * 주문 추가 화면과 같은 규칙 — **매출(Direction='out')로 연결된 품목이면 타입 불문**
                 * 다 뜨고, 타입별로 묶는다. 고르는 창도 native select를 걷어내고 검색 패널로 바꿨다
                 * (품목이 수십 개라 select로는 눈으로 못 찾는다).
                 */
                const pid = order.partnerId ?? '';
                const linkedIds = new Set(
                  (partnerItems ?? []).filter(pi => pi.Direction === 'out' && pi.partnerId === pid).map(pi => String(pi.itemId)),
                );
                const already = new Set(order.items.map(i => String(i.itemId)));
                const q = addItemQuery.trim();
                const orderable = (p: Item) => linkedIds.has(p.id) || (p.partnerIds ?? []).includes(pid);
                /**
                 * **낱개↔박스는 한 줄에 토글로.** 둘을 따로 띄우면 이름이 같아 어느 쪽을 눌렀는지
                 * 모르고, 목록도 두 배로 길어진다. 주문 추가 화면과 같은 규칙이다.
                 * 짝 없이 홀로 있는 박스는 그대로 띄운다.
                 */
                const pool = items
                  .filter(p => !p.archived && !already.has(p.id) && orderable(p))
                  .filter(p => !(isBoxStockItem(p) && items.some(x => !x.archived && x.id === unpackComponent(p)?.itemId)))
                  .filter(p => !q || matchesSearch(p.name, q) || matchesSearch(String(p.spec ?? ''), q));
                const TYPE_LABEL: Record<string, string> = {
                  product: '완제품', goods: '상품', wip: '반제품', raw: '원료', submaterial: '부자재',
                };
                const TYPE_ORDER = ['product', 'goods', 'wip', 'raw', 'submaterial'];
                const rank = (name: string) => /가루/.test(name) ? 3 : /참기름|참진|참고소|참향/.test(name) ? 0 : /들기름|들향|들진|들고소/.test(name) ? 1 : /깨/.test(name) ? 2 : 4;
                const groups = new Map<string, typeof pool>();
                for (const p of pool) { const k = String(p.type); (groups.get(k) ?? groups.set(k, []).get(k)!).push(p); }
                const ordered = [...groups.entries()].sort((a, b) => {
                  const ai = TYPE_ORDER.indexOf(a[0]), bi = TYPE_ORDER.indexOf(b[0]);
                  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
                });
                return (
                  <div className="rounded-xl border border-indigo-200 bg-white overflow-hidden shadow-sm">
                    <div className="p-1.5 border-b border-slate-100">
                      <input autoFocus value={addItemQuery} onChange={e => setAddItemQuery(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        placeholder="품목명·규격으로 찾기"
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] font-bold outline-none focus:ring-2 focus:ring-indigo-300"/>
                    </div>
                    {/* 창 크기를 고정한다 — 검색으로 줄 수가 줄어도 카드가 안 흔들린다 */}
                    <div className="h-[180px] overflow-y-auto">
                      {ordered.length === 0 ? (
                        <p className="px-2 py-8 text-center text-[10px] font-bold text-slate-300">
                          {q ? '찾는 품목이 없습니다' : '이 거래처에 연결된 품목이 없습니다'}
                        </p>
                      ) : ordered.map(([key, list]) => (
                        <div key={key}>
                          <div className="sticky top-0 bg-slate-50/95 px-2 py-1 text-[8px] font-black text-slate-400 uppercase tracking-widest">
                            {TYPE_LABEL[key] ?? key} <span className="text-slate-300">{list.length}</span>
                          </div>
                          {list.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'ko')).map(p => {
                            //  이 낱개에 짝지어진 박스 중 이 거래처가 살 수 있는 것만 토글에 올린다
                            const boxes = boxSiblings(p, items).filter(b => orderable(b.item) && !already.has(b.item.id));
                            const variants = [
                              { item: p as Item, label: isBulkItem(p) ? '벌크' : '낱개', spec: p.spec || (isBulkItem(p) ? p.unit : '') },
                              ...boxes.map(b => ({ item: b.item as Item, label: `${b.count}개입`, spec: b.item.spec || '' })),
                            ];
                            return (
                              <div key={p.id} className="border-b border-slate-50 last:border-0">
                                <div className="flex items-center gap-1.5 px-2 py-1.5">
                                  <span className="text-[10px] font-bold text-slate-700 truncate flex-1 min-w-0">{p.name}</span>
                                  {variants.map(v => (
                                    <button key={v.item.id} type="button"
                                      onClick={e => { e.stopPropagation(); handleAddItem(v.item); setAddItemQuery(''); }}
                                      title={`${p.name} ${v.spec}`}
                                      className="shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-slate-200 text-[9px] font-black text-slate-500 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 transition-all">
                                      <Plus size={8} strokeWidth={3}/>{v.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <button onClick={() => { setShowAddProductSelect(null); setAddItemQuery(''); }} className="w-full py-1 text-[8px] font-black text-slate-400 uppercase hover:text-slate-600">취소</button>
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


      {/*  카드번호 — 주문일자·배송기한 윗줄. 화면끼리 이 카드를 가리킬 이름이다
           (전표 만들 때 고른 주문이 어느 카드인지 확인하려면 있어야 한다). */}
      {cardNoLabel(order) && (
        <div className="pt-2 border-t border-slate-50 mt-2 -mb-1">
          <span className="text-[9px] font-black text-slate-400 tabular-nums">{cardNoLabel(order)}</span>
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
                {(() => { const d = new Date(order.createdAt); return `${String(d.getFullYear()).slice(2)}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; })()}
              </span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">배송기한</span>
              <span className="text-[9px] font-bold text-slate-500">{(() => { const d = new Date(order.deliveryDate); return `${String(d.getFullYear()).slice(2)}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; })()}</span>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              {palletStocks.length > 0 && onUpdatePallets && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowPalletPicker(p => !p); }}
                    className="flex items-center gap-0.5 text-[8px] font-black px-1.5 py-0.5 rounded transition-all bg-violet-500 text-white hover:bg-violet-600"
                  >
                    <Layers size={8} />
                    <span>{(order.pallets?.reduce((s, p) => s + p.quantity, 0) ?? 0) > 0 ? order.pallets!.reduce((s, p) => s + p.quantity, 0) + '개' : '팔레트'}</span>
                  </button>
                  {showPalletPicker && (
                    <div
                      className="absolute bottom-full right-0 mb-1 z-50 bg-white rounded-xl shadow-xl border border-slate-100 flex flex-col min-w-[160px] p-2 gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="text-[9px] font-black text-slate-400 px-1 uppercase tracking-widest">팔레트</p>
                      {palletStocks.map(ps => {
                        const entry = order.pallets?.find(p => p.type === ps.id);
                        const qty = entry?.quantity ?? 0;
                        const isEx = entry?.isExchange ?? false;
                        const updatePallet = (newQty: number, exchange: boolean) => {
                          const filtered = (order.pallets ?? []).filter(p => p.type !== ps.id);
                          const next = newQty > 0 ? [...filtered, { type: ps.id, quantity: newQty, ...(exchange ? { isExchange: true } : {}) }] : filtered;
                          onUpdatePallets(order.id, next);
                        };
                        return (
                          <div key={ps.id} className="flex flex-col gap-1 border-b border-slate-50 pb-1.5 last:border-0 last:pb-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-bold text-slate-700 truncate">{ps.name}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                <button type="button" onClick={() => updatePallet(Math.max(0, qty - 1), isEx)} className="w-5 h-5 flex items-center justify-center rounded bg-slate-100 text-slate-500 hover:bg-slate-200 font-black text-xs">−</button>
                                <span className="w-5 text-center text-[10px] font-black text-slate-800">{qty}</span>
                                <button type="button" onClick={() => updatePallet(qty + 1, isEx)} className="w-5 h-5 flex items-center justify-center rounded bg-violet-100 text-violet-600 hover:bg-violet-200 font-black text-xs">+</button>
                              </div>
                            </div>
                            {qty > 0 && (
                              <button
                                type="button"
                                onClick={() => updatePallet(qty, !isEx)}
                                className={`text-[9px] font-black px-2 py-0.5 rounded self-start transition-all ${isEx ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400 hover:bg-amber-50 hover:text-amber-600'}`}
                              >
                                {isEx ? '교환 (차감안함)' : '교환'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <span className="text-[9px] font-black text-slate-400 uppercase text-center">{order.source}</span>
            </div>
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
              [OrderStatus.ON_HOLD, '보류'],
              [OrderStatus.SHIPPED, '출고'],
            ] as [OrderStatus, string][]).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
          <button onClick={() => setConfirmModal({
              message: '주문을 삭제하시겠습니까?',
              subMessage: `${partners.find(c => c.id === order.partnerId)?.name ?? ''} · 삭제 후 복구할 수 없습니다.`,
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
        <div className={`${gridCols === 3 ? 'sm:columns-3' : gridCols === 2 ? 'sm:columns-2' : 'columns-1'} gap-3`}>
          {orders.map(order => (
            <div key={order.id} className="break-inside-avoid mb-3">
              <OrderCard order={order} {...cardProps} gridCols={gridCols} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ─── DeliveryRow ──────────────────────────────────────────────────────────────

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
  title, subtitle, orders, partners, items, partnerItems, palletStocks, itemBoms = [],
  onUpdateStatus, onUpdateDeliveryDate, onUpdatePallets,
  onUpdateItems, onUpdateDeliveryBoxes,
  onToggleInvoicePrinted, onToggleItemChecked,
  onDeleteOrder, onAddClick, onPasteClick,
  workOrderItems: workOrderItemsProp = [],
  onSetWorkOrderItems,
  currentUserName,
  highlightOrderId,
  onHighlightClear,
  newOrderId,
  onNewOrderIdClear,
  onLoadHistoricalOrders,
  isLoadingHistoricalOrders = false,
  ordersMonths,
  onChangeOrdersMonths,
}) => {
  // Compute derived variables
  const products = items;
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
  type WorkItem = { key: string; orderId: string; itemId: string; itemName: string; partnerName: string; qty: number; category: string; };
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

  // 신규 주문 생성 시 자동으로 편집 모드 열기
  useEffect(() => {
    if (!newOrderId) return;
    setActiveTab('active');
    const timer = setTimeout(() => {
      setEditingOrderId(newOrderId);
      const el = document.getElementById(`order-card-${newOrderId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onNewOrderIdClear?.();
    }, 150);
    return () => clearTimeout(timer);
  }, [newOrderId]);

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
      (o.partnerName || '').toLowerCase().includes(q) ||
      (o.id || '').toLowerCase().includes(q)
    );
  }, [orders, searchTerm]);

  const deliveryOrders = useMemo(() =>
    filteredOrders
      .filter(o => (o.source === '택배' || o.source === '스마트스토어' || o.deliveryBoxes !== undefined) && o.status !== OrderStatus.DELIVERED)
      .sort((a, b) => new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime()),
    [filteredOrders]
  );

  // DeliveryRow에 넘길 partnerName 미리 계산
  const partnerMap = useMemo(() => {
    const map = new Map<string, string>();
    partners.forEach(c => map.set(c.id, c.name));
    return map;
  }, [partners]);

  // OrderCard/OrderSourceGroup에 공통으로 넘길 props
  const cardSharedProps = {
    partners, items, partnerItems, palletStocks, itemBoms,
    editingOrderId, setEditingOrderId,
    showAddProductSelect, setShowAddProductSelect,
    onUpdateItems, onUpdateDeliveryDate, onUpdateStatus, onUpdatePallets,
    onToggleItemChecked, onDeleteOrder, currentUserName,
    highlightOrderId,
  };

  return (
    <div className="flex flex-col space-y-4 md:space-y-5 animate-in fade-in duration-300">
      <PageHeader
        title={title}
        subtitle={subtitle}
        right={
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
            {(['delivery','active','history'] as const).map((tab, i) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 rounded-lg text-xs font-black transition-all whitespace-nowrap ${activeTab === tab ? 'bg-white shadow-sm ' + (tab==='delivery'?'text-sky-600':tab==='active'?'text-indigo-600':'text-slate-700') : 'text-slate-400 hover:text-slate-600'}`}>
                {['택배','운영','이력'][i]}
              </button>
            ))}
          </div>
        }
      />

      {/* 콘텐츠 첫 줄(검색) + 액션 버튼 같은 행 (검색 좌측 · 버튼 우측) */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative w-full md:max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input type="text" placeholder="고객명, 주문번호 검색..." value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl pl-11 pr-4 py-2.5 md:py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0 md:ml-auto">
          {activeTab === 'history' && onChangeOrdersMonths && (
            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm" title="Firestore 실시간 구독 범위 — 줄이면 읽기 비용 절감">
              <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">실시간</span>
              <select
                value={ordersMonths ?? 12}
                onChange={(e) => onChangeOrdersMonths(parseInt(e.target.value, 10))}
                className="text-xs font-black text-slate-700 bg-transparent outline-none cursor-pointer"
              >
                {[1, 3, 6, 12, 24].map(n => (
                  <option key={n} value={n}>최근 {n}개월</option>
                ))}
              </select>
            </div>
          )}
          {onPasteClick && (
            <button onClick={onPasteClick} className="flex items-center gap-1.5 bg-violet-600 text-white px-3 py-2 rounded-xl text-xs font-black hover:bg-violet-700 transition-all shadow-sm">
              <ClipboardPaste size={13} /><span className="hidden sm:inline">복사주문</span>
            </button>
          )}
          <button onClick={onAddClick} className="flex items-center gap-1.5 bg-indigo-600 text-white px-3 py-2 rounded-xl text-xs font-black hover:bg-indigo-700 transition-all shadow-sm">
            <Plus size={13} /><span className="hidden sm:inline">주문 생성</span>
          </button>
        </div>
      </div>

      {activeTab === 'delivery' && (
        <div>
          {/* 택배 목록 */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
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
                const partnerName = (order.partnerId && partnerMap.get(order.partnerId)) || order.partnerName || '이름 없음';
                return (
                  <DeliveryRow
                    key={order.id}
                    order={order}
                    partnerName={partnerName}
                    items={items}
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
          const partnerName = o.partnerName || partners.find(c => c.id === o.partnerId)?.name || '이름없음';
          return o.items
            .map((item, idx) => ({
              key: `${o.id}-${idx}`,
              orderId: o.id,
              itemId: item.itemId,
              itemName: item.name,
              partnerName,
              qty: item.quantity,
              category: items.find(p => p.id === item.itemId)?.type || '',
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
                <p className="text-[9px] text-slate-400 truncate">{wi.partnerName} · {wi.qty}개</p>
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
          const allColOrders = filteredOrders
            .filter(o => col.statusFilter.includes(o.status))
            .sort(byDeliveryThenId);   // 스냅샷 순서에 맡기면 고칠 때마다 카드가 튄다
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
              className={`flex flex-col rounded-3xl border ${col.borderColor} bg-white shadow-sm flex-shrink-0`}
              style={{
                ...(typeof window !== 'undefined' && window.innerWidth >= 768 ? { width: `calc(${units} * (100vw - 9rem) / 6)` } : {}),
                // 모바일은 컬럼 폭이 곧 카드 폭이다. 280은 한 손에 안 들어와 조금 줄인다.
                minWidth: typeof window !== 'undefined' && window.innerWidth < 768 ? 248 : 280,
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
            {/* 칸반 컬럼과 같은 규칙 — 흰 바탕에 테두리 색만. 패널까지 칠하면 안의 카드가 묻힌다. */}
            <div className="w-full md:w-60 md:shrink-0 flex flex-col rounded-3xl border border-violet-100 bg-white shadow-sm">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
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
                      const partnerName = o.partnerName || partners.find(c => c.id === o.partnerId)?.name || '이름없음';
                      const orderItems = allPickableItems.filter(wi => wi.orderId === o.id);
                      return (
                        <div key={o.id} className="px-5 py-3 border-b border-slate-50">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-bold text-slate-700">{partnerName}</span>
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
        const allColOrders = filteredOrders.filter(o => col.statusFilter.includes(o.status)).sort(byDeliveryThenId);
        const filteredHistoryOrders = allColOrders.filter(o => {
          if (historySearch && !((o.partnerName || '').includes(historySearch))) return false;
          const dateStr = dateOfLocal(o.deliveredAt || o.deliveryDate || o.createdAt);
          if (historyDateFrom && dateStr < historyDateFrom) return false;
          if (historyDateTo && dateStr > historyDateTo) return false;
          return true;
        }).sort((a, b) => {
          const da = a.deliveredAt || a.deliveryDate || a.createdAt || '';
          const db = b.deliveredAt || b.deliveryDate || b.createdAt || '';
          return db.localeCompare(da);
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
          <div className={`flex flex-col rounded-3xl border ${col.borderColor} bg-white shadow-sm`}>
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
              {onLoadHistoricalOrders && (
                <button
                  onClick={() => {
                    const from = historyDateFrom || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
                    const to = historyDateTo || today();
                    onLoadHistoricalOrders(from, to);
                  }}
                  disabled={isLoadingHistoricalOrders}
                  className="w-full py-1.5 rounded-xl text-[11px] font-black bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 transition-all"
                >
                  {isLoadingHistoricalOrders ? '불러오는 중…' : `📂 이력 불러오기 (${historyDateFrom || '30일 전'} ~ ${historyDateTo || '오늘'})`}
                </button>
              )}
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
        const partnerName = order.partnerName || partners.find(c => c.id === order.partnerId)?.name || '이름없음';
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
                  <h3 className="font-black text-slate-900">{partnerName}</h3>
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
                  partners={partners}
                  items={items}
                  partnerItems={partnerItems}
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
