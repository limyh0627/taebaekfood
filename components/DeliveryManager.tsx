
import React, { useState, useMemo, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Clock,
  CheckCircle2,
  Send,
  ListOrdered,
  GripVertical,
  ChevronDown,
  Square,
  CheckSquare,
  Search,
  LayoutDashboard,
  AlertTriangle
} from 'lucide-react';
import { Order, Partner, OrderStatus, Item, ItemBom, PartnerItem, PalletStock, OrderPallet } from '../types';
import { statusChip, statusLabel } from '../src/shared/orderStatusStyle';
import { X } from 'lucide-react';
import { subscribeToDocument, setDocument } from '../src/shared/services/firebaseService';
import OrdersList, { OrderCard } from './OrdersList';
import PageHeader from './PageHeader';
import CalendarDayCountBadge from './CalendarDayCountBadge';
import OrderEditModalShell from './OrderEditModalShell';
import ConfirmModal from './ConfirmModal';
import DeliveryDayList from './DeliveryDayList';
import { boxCountOf } from '../src/shared/orderUnits';
import type { DayRow } from '../src/shared/deliveryPlan';

import { OrderItem } from '../types';

interface DeliveryManagerProps {
  orders: Order[];
  partners: Partner[];
  items: Item[];
  itemBoms?: ItemBom[];
  partnerItems?: PartnerItem[];
  palletStocks?: PalletStock[];
  currentUserName?: string;
  onUpdateDeliveryDate?: (_id: string, _date: string) => void | Promise<void>;
  onUpdateStatus?: (_id: string, _status: OrderStatus) => void;
  onUpdateItems?: (_id: string, _items: OrderItem[]) => void;
  onUpdatePallets?: (_id: string, _pallets: OrderPallet[]) => void;
  onToggleInvoicePrinted?: (_id: string, _value: boolean) => void;
  onToggleShipmentComplete?: (_id: string, _value: boolean) => void;
  onToggleItemChecked?: (_orderId: string, _itemIdx: number) => void;
  onDeleteOrder?: (_id: string) => void;
}

const DELIVERY_STATUS_LABEL: Record<string, string> = {
  PENDING: '대기중', PROCESSING: '작업중', DISPATCHED: '작업완료',
  SHIPPED: '출고완료', DELIVERED: '예전 주문', ON_HOLD: '보류',
};

const hasWorkCheckOmission = (order: Order) => order.items.length === 0 || order.items.some(item => !item.checked);

const WorkCheckWarning: React.FC<{ order: Order; className?: string }> = ({ order, className = '' }) => (
  hasWorkCheckOmission(order) ? (
    <span className={`inline-flex items-center gap-0.5 whitespace-nowrap font-black text-red-600 ${className}`}>
      <AlertTriangle size={10} className="shrink-0" aria-hidden="true" />
      <span>작업 확인 누락</span>
    </span>
  ) : null
);

const DeliveryManager: React.FC<DeliveryManagerProps> = ({ orders: sourceOrders, partners, items, itemBoms = [], partnerItems = [], palletStocks = [], currentUserName, onUpdateDeliveryDate, onUpdateStatus, onUpdateItems, onUpdatePallets, onToggleInvoicePrinted, onToggleShipmentComplete, onToggleItemChecked, onDeleteOrder }) => {
  // Compute derived variables
  const products = items;
  const [currentDate, setCurrentDate] = useState(new Date());
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [newDate, setNewDate] = useState('');
  const [editingTimeSlot, setEditingTimeSlot] = useState<'오전' | '오후'>('오전');
  const [scheduleConfirmation, setScheduleConfirmation] = useState<'discard' | 'save-shipped' | null>(null);
  const [scheduleSaveError, setScheduleSaveError] = useState('');
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [showAddProductSelect, setShowAddProductSelect] = useState<string | null>(null);
  const [deliveryOrdering, setDeliveryOrdering] = useState<string[]>([]);
  const [deliveryTimeSlots, setDeliveryTimeSlots] = useState<Record<string, '오전' | '오후'>>({});
  const [deliverySortMode, setDeliverySortMode] = useState<'recommended' | 'manual'>('recommended');
  const [showCompletedDeliveryOrders, setShowCompletedDeliveryOrders] = useState(false);

  useEffect(() => {
    return subscribeToDocument<{ ordering: string[]; timeSlots: Record<string, '오전' | '오후'> }>(
      'settings', 'deliveryOrdering',
      (data) => {
        setDeliveryOrdering(data?.ordering ?? []);
        setDeliveryTimeSlots(data?.timeSlots ?? {});
      }
    );
  }, []);
  const [dragDeliveryIdx, setDragDeliveryIdx] = useState<number | null>(null);
  const [dragDeliveryId, setDragDeliveryId] = useState<string | null>(null);
  const [previewDeliveryOrderId, setPreviewDeliveryOrderId] = useState<string | null>(null);
  const [deliveryTab, setDeliveryTab] = useState<'캘린더' | '리스트' | '보드'>('캘린더');
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [queryDateFrom, setQueryDateFrom] = useState(`${todayKey.slice(0, 7)}-01`);
  const [queryDateTo, setQueryDateTo] = useState(todayKey);
  const [queryText, setQueryText] = useState('');
  const [queryField, setQueryField] = useState('');
  const [queryValue, setQueryValue] = useState('');
  const queryFields = [
    ['source', '출고 방식'], ['partner', '거래처'], ['address', '주소'],
    ['completion', '작업완료 여부'], ['item', '주문 품목'], ['quantity', '주문 수량'],
    ['label', '라벨 작업'], ['packaging', '포장'], ['pallet', '팔레트'],
    ['shipment', '출고완료 여부'], ['invoice', '송장'], ['note', '비고'],
    ['orderDate', '주문일'], ['deliveryDate', '출고예정일'],
  ];
  const queryDateKey = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  };
  const queryValuesFor = (order: Order, field: string): string[] => {
    const partner = partners.find(candidate => candidate.id === order.partnerId);
    switch (field) {
      case 'source': return [order.source];
      case 'partner': return [order.partnerName || partner?.name || '이름 없음'];
      case 'address': return [[partner?.address, partner?.addressDetail].filter(Boolean).join(' ')];
      case 'completion': return order.items.map(item => item.checked ? '완료' : '미완료');
      case 'item': return order.items.map(item => item.name);
      case 'quantity': return order.items.map(item => item.isBoxUnit ? `${boxCountOf(item)}박스` : `${item.quantity}${items.find(product => product.id === item.itemId)?.unit || '개'}`);
      case 'label': return order.items.map(item => item.labelType && item.labelType !== '대기' ? item.labelType : '-');
      case 'packaging': return order.items.map(item => item.boxType || '-');
      case 'pallet': return (order.pallets ?? []).map(pallet => `${palletStocks.find(stock => stock.id === pallet.type)?.name || pallet.type} ${pallet.quantity}개`);
      case 'shipment': return [order.status === OrderStatus.SHIPPED ? '완료' : '미완료'];
      case 'invoice': return [(order.source === '택배' || order.source === '스마트스토어' || order.deliveryBoxes !== undefined) ? (order.invoicePrinted ? '완료' : '미완료') : '-'];
      case 'note': return order.items.map(item => item.note || '');
      case 'orderDate': return [queryDateKey(order.createdAt)];
      case 'deliveryDate': return [queryDateKey(order.deliveryDate)];
      default: return [];
    }
  };
  const quickWeekDate = new Date(`${todayKey}T00:00:00+09:00`);
  const weekday = new Date(`${todayKey}T00:00:00Z`).getUTCDay();
  quickWeekDate.setTime(quickWeekDate.getTime() - ((weekday + 6) % 7) * 86400000);
  const quickWeekStart = queryDateKey(quickWeekDate.toISOString());
  const [queryStatus, setQueryStatus] = useState<'all' | OrderStatus.DISPATCHED | OrderStatus.SHIPPED>('all');
  const deliverySearchOrders = useMemo(() => {
    const normalized = queryText.trim().toLocaleLowerCase('ko-KR');
    return sourceOrders.filter(order => {
      if (order.status !== OrderStatus.DISPATCHED && order.status !== OrderStatus.SHIPPED) return false;
      const orderDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(order.createdAt));
      if (queryDateFrom && orderDate < queryDateFrom) return false;
      if (queryDateTo && orderDate > queryDateTo) return false;
      if (!normalized) return true;
      const partner = partners.find(candidate => candidate.id === order.partnerId);
      return [
        order.id, order.partnerName, partner?.name, partner?.address, partner?.addressDetail,
        order.source, order.deliveryDate, ...order.items.flatMap(item => [item.name, item.note]),
      ].filter(Boolean).some(value => String(value).toLocaleLowerCase('ko-KR').includes(normalized));
    });
  }, [sourceOrders, partners, queryDateFrom, queryDateTo, queryText]);
  const queryOptions = [...new Set(deliverySearchOrders.flatMap(order => queryValuesFor(order, queryField)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const deliveryQueryOrders = deliverySearchOrders.filter(order => !queryField || !queryValue || queryValuesFor(order, queryField).includes(queryValue));
  const orders = useMemo(
    () => queryStatus === 'all' ? deliveryQueryOrders : deliveryQueryOrders.filter(order => order.status === queryStatus),
    [deliveryQueryOrders, queryStatus]
  );
  const [calendarView, setCalendarView] = useState<'주간' | '월간'>('주간');
  const [currentWeekDate, setCurrentWeekDate] = useState(new Date());
  const [mobileCollapsed, setMobileCollapsed] = useState<Set<string>>(new Set(['delivery-order']));
  const toggleMobileCollapse = (id: string) => setMobileCollapsed(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const [selectedDispatchedIds, setSelectedDispatchedIds] = useState<Set<string>>(new Set());
  const toggleDispatchedSelect = (id: string) => setSelectedDispatchedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const handleBulkShip = () => { selectedDispatchedIds.forEach(id => onUpdateStatus?.(id, OrderStatus.SHIPPED)); setSelectedDispatchedIds(new Set()); };
  const [expandedDeliveredDates, setExpandedDeliveredDates] = useState<Set<string>>(new Set());
  const toggleDeliveredDate = (dateStr: string) => setExpandedDeliveredDates(prev => { const next = new Set(prev); next.has(dateStr) ? next.delete(dateStr) : next.add(dateStr); return next; });

  const handleOrderClick = (order: Order) => {
    setEditingOrder(order);
    setNewDate(order.deliveryDate.split('T')[0]);
    setEditingTimeSlot(deliveryTimeSlots[order.id] || '오전');
    setScheduleConfirmation(null);
    setScheduleSaveError('');
  };

  const originalScheduleDate = editingOrder?.deliveryDate.split('T')[0] ?? '';
  const originalTimeSlot = editingOrder ? (deliveryTimeSlots[editingOrder.id] || '오전') : '오전';
  const isScheduleDirty = Boolean(editingOrder) && (newDate !== originalScheduleDate || editingTimeSlot !== originalTimeSlot);

  const closeScheduleEditor = () => {
    setEditingOrder(null);
    setScheduleConfirmation(null);
    setScheduleSaveError('');
  };

  const requestCloseScheduleEditor = () => {
    if (isScheduleDirty) {
      setScheduleConfirmation('discard');
      return;
    }
    closeScheduleEditor();
  };

  const persistScheduleChange = async () => {
    if (!editingOrder || !onUpdateDeliveryDate || !newDate || !isScheduleDirty || isSavingSchedule) return;

    const changedAt = new Date().toISOString();
    const auditId = `delivery-schedule-${editingOrder.id}-${Date.now()}`;
    const nextTimeSlots = { ...deliveryTimeSlots, [editingOrder.id]: editingTimeSlot };
    const auditBase = {
      id: auditId,
      orderId: editingOrder.id,
      partnerId: editingOrder.partnerId,
      partnerName: editingOrder.partnerName,
      orderStatus: editingOrder.status,
      changedBy: currentUserName || '미기록',
      changedAt,
      previousDeliveryDate: originalScheduleDate,
      nextDeliveryDate: newDate,
      previousTimeSlot: originalTimeSlot,
      nextTimeSlot: editingTimeSlot,
    };

    setIsSavingSchedule(true);
    setScheduleSaveError('');
    try {
      await setDocument('deliveryScheduleAudits', auditId, { ...auditBase, outcome: 'PENDING' });
      await onUpdateDeliveryDate(editingOrder.id, new Date(`${newDate}T00:00:00+09:00`).toISOString());
      await setDocument('settings', 'deliveryOrdering', { ordering: deliveryOrdering, timeSlots: nextTimeSlots });
      await setDocument('deliveryScheduleAudits', auditId, { outcome: 'COMPLETED', completedAt: new Date().toISOString() });
      setDeliveryTimeSlots(nextTimeSlots);
      closeScheduleEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setScheduleSaveError('출고 일정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      await setDocument('deliveryScheduleAudits', auditId, { ...auditBase, outcome: 'FAILED', errorMessage: message }).catch(() => undefined);
    } finally {
      setIsSavingSchedule(false);
      setScheduleConfirmation(null);
    }
  };

  const requestSaveDate = () => {
    if (!editingOrder || !isScheduleDirty || !newDate) return;
    if (editingOrder.status === OrderStatus.SHIPPED) {
      setScheduleConfirmation('save-shipped');
      return;
    }
    void persistScheduleChange();
  };

  const handleDragStart = (e: React.DragEvent, orderId: string) => {
    e.dataTransfer.setData('orderId', orderId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    const orderId = e.dataTransfer.getData('orderId');
    if (orderId && onUpdateDeliveryDate) {
      onUpdateDeliveryDate(orderId, new Date(dateStr).toISOString());
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const calendarLocationOf = (order: Order) => {
    const partner = partners.find(candidate => candidate.id === order.partnerId);
    const tokens = (partner?.address || '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return '';
    let endIndex = Math.min(1, tokens.length - 1);
    for (let index = 1; index < Math.min(tokens.length, 4); index += 1) {
      endIndex = index;
      if (/[군구]$/.test(tokens[index])) break;
      if (/시$/.test(tokens[index]) && !/[구]$/.test(tokens[index + 1] || '')) break;
    }
    return tokens.slice(0, endIndex + 1).join(' ');
  };

  // Calendar logic
  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const monthNames = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

  const deliverySchedules = useMemo(() => {
    const schedules: Record<string, Order[]> = {};
    orders.forEach(order => {
      if (order.deliveryDate && order.partnerName !== '생산기록' && order.status !== OrderStatus.DELIVERED) {
        const date = order.deliveryDate.split('T')[0];
        if (!schedules[date]) schedules[date] = [];
        schedules[date].push(order);
      }
    });
    return schedules;
  }, [orders]);

  const deliveredSchedules = useMemo(() => {
    const schedules: Record<string, Order[]> = {};
    orders.forEach(order => {
      if (order.deliveryDate && order.partnerName !== '생산기록' && order.status === OrderStatus.DELIVERED) {
        const date = order.deliveryDate.split('T')[0];
        if (!schedules[date]) schedules[date] = [];
        schedules[date].push(order);
      }
    });
    return schedules;
  }, [orders]);

  // 로컬 날짜 문자열 (타임존 버그 방지)
  const toLocalDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Week navigation helpers
  const getWeekStart = (d: Date) => {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday = start
    const start = new Date(d);
    start.setDate(d.getDate() + diff);
    start.setHours(0, 0, 0, 0);
    return start;
  };

  const weekStart = getWeekStart(currentWeekDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];
  const weekdayTextClass = (day: number) => day === 0 || day === 6 ? 'text-rose-600' : 'text-slate-600';

  const prevWeek = () => setCurrentWeekDate(prev => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d; });
  const nextWeek = () => setCurrentWeekDate(prev => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d; });

  const weekLabel = (() => {
    const endDate = weekDays[weekDays.length - 1];
    const sM = weekStart.getMonth() + 1;
    const sD = weekStart.getDate();
    const eM = endDate.getMonth() + 1;
    const eD = endDate.getDate();
    const yr = weekStart.getFullYear();
    return sM === eM ? `${yr}년 ${sM}월 ${sD}일 – ${eD}일` : `${yr}년 ${sM}월 ${sD}일 – ${eM}월 ${eD}일`;
  })();

  /** 날짜별 상세 창은 보조 경로로 유지한다. 캘린더 자체는 모바일에서도 최소 열 너비와
   * 가로 스크롤을 쓰므로, 카드 목록을 숨기면 실제 일정이 없는 것처럼 보인다. */
  const [dayModal, setDayModal] = useState<string | null>(null);

  const renderWeekCalendar = () => {
    const todayStr = toLocalDateStr(new Date());
    //  상태 색은 [shared/orderStatusStyle](../src/shared/orderStatusStyle) 한 곳이 정한다.
    //  여기 있던 표는 **하늘 배경에 분홍 글씨**(`text-pink-700`)였다 — 복사 실수다(2026-09-06).
    const getStatusColor = statusChip;

    // 금일 배송순서 공통 데이터 (오늘 열에서 사용)
    // deliveryOrdering에 있는 것 + 오늘 날짜 캘린더 주문 중 ordering에 없는 것 자동 포함
    const todayCalendarExtra = orders
      .filter(o =>
        o.partnerName !== '생산기록' &&
        o.status !== OrderStatus.DELIVERED &&
        o.deliveryDate?.split('T')[0] === todayStr &&
        !deliveryOrdering.includes(o.id)
      )
      .map(o => o.id);
    const todayValidDelivery = [
      ...deliveryOrdering.filter(id =>
        orders.some(o => o.id === id && o.status !== OrderStatus.DELIVERED && o.partnerName !== '생산기록')
      ),
      ...todayCalendarExtra,
    ];
    const todayMorningIds = todayValidDelivery.filter(id => (deliveryTimeSlots[id] || '오전') === '오전');
    const todayAfternoonIds = todayValidDelivery.filter(id => deliveryTimeSlots[id] === '오후');

    const saveTodayOrdering = (next: string[], slots?: Record<string, '오전' | '오후'>) => {
      setDeliveryOrdering(next);
      setDocument('settings', 'deliveryOrdering', { ordering: next, timeSlots: slots ?? deliveryTimeSlots });
    };

    return weekDays.map(d => {
      const dateStr = toLocalDateStr(d);
      const dayOrders = deliverySchedules[dateStr] || [];
      const deliveredOrders = deliveredSchedules[dateStr] || [];
      const isToday = todayStr === dateStr;
      const showDelivered = expandedDeliveredDates.has(dateStr);

      // 주문 캘린더와 같은 날짜·건수 위계를 써서 두 관리 화면의 읽는 위치가 같아야 한다.
      const dateHeader = (
        <div className="mb-2 flex flex-shrink-0 items-start justify-between gap-2">
          <div className="flex min-h-8 items-center gap-1.5">
            <span className={`flex h-8 min-w-8 items-center justify-center rounded-full px-1 text-lg font-black leading-none tabular-nums ${isToday ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-800 group-hover:text-indigo-600'}`}>
              {d.getDate()}
            </span>
            <span className={`text-[11px] font-black ${weekdayTextClass(d.getDay())}`}>{dayLabels[d.getDay()]}</span>
          </div>
          <div className="flex items-center gap-1">
            <CalendarDayCountBadge count={isToday ? todayValidDelivery.length : dayOrders.length} />
            {deliveredOrders.length > 0 && (
              <button
                onClick={e => { e.stopPropagation(); toggleDeliveredDate(dateStr); }}
                className="hidden sm:block text-[10px] font-black text-slate-400 bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded-md transition-all whitespace-nowrap"
              >
                이전 {deliveredOrders.length}건
              </button>
            )}
            {deliveredOrders.length > 0 && (
              <span className="sm:hidden text-[10px] font-black text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                +{deliveredOrders.length}
              </span>
            )}
          </div>
        </div>
      );

      if (isToday) {
        // 오늘 열 → 금일 배송순서 스타일
        return (
          <div
            key={dateStr}
            className="border-r border-slate-100 p-1.5 sm:p-3 flex flex-col bg-indigo-50/30 relative"
            style={{ minHeight: 200 }}
          >
            <button type="button" onClick={() => setDayModal(dateStr)}
              className="absolute inset-x-0 top-0 z-10 h-14 sm:hidden" aria-label={`${d.getDate()}일 배송 상세 보기`} />
            {dateHeader}
            <div className="flex flex-1 flex-col gap-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {todayValidDelivery.length === 0 ? (
                <p className="text-center text-[10px] text-slate-300 font-bold py-4">배송순서 미설정</p>
              ) : (
                <>
                  <span className="text-[9px] font-black text-amber-500 px-1">오전</span>
                  {todayMorningIds.length === 0 && <p className="text-[9px] text-slate-300 text-center py-1">없음</p>}
                  {todayMorningIds.map((id, idx) => {
                    const o = orders.find(x => x.id === id);
                    if (!o) return null;
                    const partnerName = partners.find(c => c.id === o.partnerId)?.name || o.partnerName || '';
                    const globalNum = todayValidDelivery.indexOf(id) + 1;
                    return (
                      <div
                        key={id}
                        draggable
                        onDragStart={() => { setDragDeliveryIdx(idx); setDragDeliveryId(id); }}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => {
                          if (dragDeliveryIdx === null || dragDeliveryIdx === todayValidDelivery.indexOf(id)) return;
                          const next = [...todayValidDelivery];
                          const [moved] = next.splice(dragDeliveryIdx, 1);
                          next.splice(next.indexOf(id), 0, moved);
                          saveTodayOrdering(next);
                          setDragDeliveryIdx(null); setDragDeliveryId(null);
                        }}
                        onClick={() => setPreviewDeliveryOrderId(id)}
                        className={`flex items-center gap-1.5 bg-white rounded-xl px-2 py-1.5 shadow-sm border border-amber-100 cursor-pointer hover:brightness-95 transition-all ${getStatusColor(o.status)}`}
                      >
                        <span className="text-[9px] font-black text-amber-500 w-3 shrink-0">{globalNum}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[10px] font-bold">{partnerName}</span>
                          {calendarLocationOf(o) && <span className="mt-0.5 flex items-center gap-0.5 truncate text-[9px] font-medium text-slate-500"><MapPin size={9} className="shrink-0" />{calendarLocationOf(o)}</span>}
                        </span>
                        <span className="shrink-0 text-[9px] font-black">{DELIVERY_STATUS_LABEL[o.status]}</span>
                        <GripVertical size={10} className="text-slate-300 shrink-0" />
                      </div>
                    );
                  })}
                  <span className="text-[9px] font-black text-indigo-500 px-1 pt-1">오후</span>
                  {todayAfternoonIds.length === 0 && <p className="text-[9px] text-slate-300 text-center py-1">없음</p>}
                  {todayAfternoonIds.map((id, idx) => {
                    const o = orders.find(x => x.id === id);
                    if (!o) return null;
                    const partnerName = partners.find(c => c.id === o.partnerId)?.name || o.partnerName || '';
                    const globalNum = todayValidDelivery.indexOf(id) + 1;
                    return (
                      <div
                        key={id}
                        draggable
                        onDragStart={() => { setDragDeliveryIdx(idx); setDragDeliveryId(id); }}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => {
                          if (dragDeliveryIdx === null || dragDeliveryIdx === todayValidDelivery.indexOf(id)) return;
                          const next = [...todayValidDelivery];
                          const [moved] = next.splice(dragDeliveryIdx, 1);
                          next.splice(next.indexOf(id), 0, moved);
                          saveTodayOrdering(next);
                          setDragDeliveryIdx(null); setDragDeliveryId(null);
                        }}
                        onClick={() => setPreviewDeliveryOrderId(id)}
                        className={`flex items-center gap-1.5 bg-white rounded-xl px-2 py-1.5 shadow-sm border border-indigo-100 cursor-pointer hover:brightness-95 transition-all ${getStatusColor(o.status)}`}
                      >
                        <span className="text-[9px] font-black text-indigo-500 w-3 shrink-0">{globalNum}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[10px] font-bold">{partnerName}</span>
                          {calendarLocationOf(o) && <span className="mt-0.5 flex items-center gap-0.5 truncate text-[9px] font-medium text-slate-500"><MapPin size={9} className="shrink-0" />{calendarLocationOf(o)}</span>}
                        </span>
                        <span className="shrink-0 text-[9px] font-black">{DELIVERY_STATUS_LABEL[o.status]}</span>
                        <GripVertical size={10} className="text-slate-300 shrink-0" />
                      </div>
                    );
                  })}
                </>
              )}
              {showDelivered && deliveredOrders.map(order => (
                <div
                  key={order.id}
                  onClick={() => handleOrderClick(order)}
                  className="text-[10px] font-bold py-1.5 px-2.5 rounded-xl border flex justify-between items-center cursor-pointer bg-slate-50 border-slate-200 text-slate-400 hover:brightness-95 transition-all"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{order.partnerName}</span>
                    {calendarLocationOf(order) && <span className="mt-0.5 flex items-center gap-0.5 truncate text-[9px] font-medium"><MapPin size={9} className="shrink-0" />{calendarLocationOf(order)}</span>}
                  </span>
                  <span className="ml-1 shrink-0">완료</span>
                </div>
              ))}
            </div>
          </div>
        );
      }

      return (
        <div
          key={dateStr}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, dateStr)}
          className="border-r border-slate-100 p-1.5 sm:p-3 flex flex-col transition-all hover:bg-indigo-50/30 group bg-white relative"
          style={{ minHeight: 200 }}
        >
          <button type="button" onClick={() => setDayModal(dateStr)}
            className="absolute inset-x-0 top-0 z-10 h-14 sm:hidden" aria-label={`${d.getDate()}일 배송 상세 보기`} />
          {dateHeader}
          <div className="flex-1 space-y-1.5 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {dayOrders.map(order => {
              return (
                <div
                  key={order.id}
                  onClick={() => handleOrderClick(order)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, order.id)}
                  className={`text-[10px] font-bold py-1.5 px-2.5 rounded-xl border flex justify-between items-center cursor-pointer hover:brightness-95 transition-all active:scale-95 ${getStatusColor(order.status)}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{order.partnerName}</span>
                    {calendarLocationOf(order) && <span className="mt-0.5 flex items-center gap-0.5 truncate text-[9px] font-medium opacity-75"><MapPin size={9} className="shrink-0" />{calendarLocationOf(order)}</span>}
                  </span>
                  <span className="ml-1 flex shrink-0 flex-col items-end text-[9px] font-black">
                    <span>{DELIVERY_STATUS_LABEL[order.status]}</span>
                    <WorkCheckWarning order={order} className="text-[8px]" />
                  </span>
                </div>
              );
            })}
            {showDelivered && deliveredOrders.map(order => (
              <div
                key={order.id}
                onClick={() => handleOrderClick(order)}
                className="text-[10px] font-bold py-1.5 px-2.5 rounded-xl border flex justify-between items-center cursor-pointer bg-slate-50 border-slate-200 text-slate-400 hover:brightness-95 transition-all"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{order.partnerName}</span>
                  {calendarLocationOf(order) && <span className="mt-0.5 flex items-center gap-0.5 truncate text-[9px] font-medium"><MapPin size={9} className="shrink-0" />{calendarLocationOf(order)}</span>}
                </span>
                <span className="ml-1 shrink-0">완료</span>
              </div>
            ))}
            {dayOrders.length === 0 && deliveredOrders.length === 0 && (
              <div className="flex-1 flex items-center justify-center">
                <span className="text-[10px] text-slate-300 font-bold">배송 없음</span>
              </div>
            )}
          </div>
        </div>
      );
    });
  };

  const renderCalendar = () => {
    const totalDays = daysInMonth(year, month);
    const startDay = firstDayOfMonth(year, month);
    const days = [];

    //  상태 색은 [shared/orderStatusStyle](../src/shared/orderStatusStyle) 한 곳이 정한다.
    //  여기 있던 표는 **하늘 배경에 분홍 글씨**(`text-pink-700`)였다 — 복사 실수다(2026-09-06).
    const getStatusColor = statusChip;

    const todayStr = toLocalDateStr(new Date());
    const renderDayCell = (day: number, dateStr: string) => {
      const dayOrders = deliverySchedules[dateStr] || [];
      const deliveredOrders = deliveredSchedules[dateStr] || [];
      const isToday = todayStr === dateStr;
      const isPast = dateStr < todayStr;
      const compact = isPast && dayOrders.length === 0 && deliveredOrders.length === 0;
      const showDelivered = expandedDeliveredDates.has(dateStr);
      const dayOfWeek = new Date(year, month, day).getDay();
      return (
        <div
          key={day}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, dateStr)}
          className={`border-b border-r border-slate-100 p-1.5 sm:p-2 transition-all hover:bg-indigo-50/30 group relative ${isToday ? 'bg-indigo-50/20' : compact ? 'bg-slate-50/40' : 'bg-white'}`}
          style={{ minHeight: compact ? 36 : 110 }}
        >
          {/* 작은 화면에서도 열 너비는 유지하고 가로 스크롤하므로 일정 카드를 그대로 보여 준다. */}
          <button type="button" onClick={() => setDayModal(dateStr)}
            className="absolute inset-x-0 top-0 z-10 h-9 sm:hidden" aria-label={`${day}일 배송 상세 보기`} />
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-h-8 items-center gap-1.5">
              <span className={`flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full px-1 text-lg font-black leading-none tabular-nums ${isToday ? 'bg-indigo-600 text-white shadow-md' : compact ? 'text-slate-400' : 'text-slate-800 group-hover:text-indigo-600'}`}>{day}</span>
              <span className={`text-[11px] font-black ${weekdayTextClass(dayOfWeek)}`}>{dayLabels[dayOfWeek]}</span>
            </div>
            <div className="flex items-center gap-1">
              <CalendarDayCountBadge count={dayOrders.length} />
              {deliveredOrders.length > 0 && (
                <button
                  onClick={e => { e.stopPropagation(); toggleDeliveredDate(dateStr); }}
                  className="hidden sm:block text-[10px] font-black text-slate-400 bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded-md transition-all whitespace-nowrap"
                >
                  이전 {deliveredOrders.length}건
                </button>
              )}
              {deliveredOrders.length > 0 && (
                <span className="sm:hidden text-[10px] font-black text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                  +{deliveredOrders.length}
                </span>
              )}
            </div>
          </div>
          {dayOrders.length > 0 && (
            <div className="mt-1 space-y-1 overflow-y-auto" style={{ maxHeight: 110, scrollbarWidth: 'thin' }}>
              {dayOrders.map(order => {
                return (
                  <div
                    key={order.id}
                    onClick={() => handleOrderClick(order)}
                    draggable
                    onDragStart={(e) => handleDragStart(e, order.id)}
                    className={`text-[9px] font-bold py-1 px-2 rounded-lg border flex justify-between items-center cursor-pointer hover:brightness-95 transition-all active:scale-95 ${getStatusColor(order.status)}`}
                  >
                    <span className="min-w-[32px] flex-1">
                      <span className="block truncate">{order.partnerName}</span>
                      {calendarLocationOf(order) && <span className="mt-0.5 flex items-center gap-0.5 truncate text-[8px] font-medium text-slate-500"><MapPin size={8} className="shrink-0" />{calendarLocationOf(order)}</span>}
                    </span>
                    <span className="ml-1 flex shrink-0 flex-col items-end text-[9px] font-black">
                      <span>{DELIVERY_STATUS_LABEL[order.status]}</span>
                      <WorkCheckWarning order={order} className="text-[8px]" />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {showDelivered && deliveredOrders.length > 0 && (
            <div className="mt-1 space-y-1 overflow-y-auto border-t border-slate-100 pt-1" style={{ maxHeight: 80, scrollbarWidth: 'thin' }}>
              {deliveredOrders.map(order => (
                <div
                  key={order.id}
                  onClick={() => handleOrderClick(order)}
                  className="text-[9px] font-bold py-1 px-2 rounded-lg border flex justify-between items-center cursor-pointer bg-slate-50 border-slate-200 text-slate-400 hover:brightness-95 transition-all"
                >
                  <span className="min-w-[32px] flex-1">
                    <span className="block truncate">{order.partnerName}</span>
                    {calendarLocationOf(order) && <span className="mt-0.5 flex items-center gap-0.5 truncate text-[8px] font-medium"><MapPin size={8} className="shrink-0" />{calendarLocationOf(order)}</span>}
                  </span>
                  <span className="ml-1 shrink-0">완료</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    };

    // 배송 일정이 없는 주말도 포함해 일–토 7일을 항상 같은 위치에 표시한다.
    for (let i = 0; i < startDay; i++) {
      days.push(<div key={`empty-${i}`} className="border-b border-r border-slate-100 bg-slate-50/30" />);
    }
    for (let day = 1; day <= totalDays; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push(renderDayCell(day, dateStr));
    }

    return days;
  };

  return (
    <div className="flex flex-col gap-5 animate-in fade-in duration-300">
      <PageHeader
        title="배송 관리"
        subtitle="배송 일정과 출고 진행 상태를 관리합니다."
      />

      <div className="order-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-6">
        <h2 className="text-lg font-black text-slate-900">전체 배송 관리</h2>
        <div className="flex items-center rounded-2xl bg-slate-100 p-1" aria-label="배송 보기 방식">
          {([
            { value: '캘린더' as const, icon: CalendarIcon },
            { value: '리스트' as const, icon: ListOrdered },
            { value: '보드' as const, icon: LayoutDashboard },
          ]).map(view => {
            const Icon = view.icon;
            return (
              <button key={view.value} type="button" onClick={() => setDeliveryTab(view.value)} aria-pressed={deliveryTab === view.value}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-black transition-all ${deliveryTab === view.value ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                <Icon size={13} aria-hidden="true" /><span>{view.value}</span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="order-3 overflow-hidden rounded-lg border border-slate-200 bg-white" aria-labelledby="delivery-query-title">
        <div className="flex min-h-11 items-center gap-2 border-b border-slate-200 px-4 py-2.5">
          <h3 id="delivery-query-title" className="text-xs font-black text-slate-900">검색조건</h3>
          <button type="button" onClick={() => { setQueryDateFrom(`${todayKey.slice(0, 7)}-01`); setQueryDateTo(todayKey); setQueryText(''); setQueryStatus('all'); setQueryField(''); setQueryValue(''); }} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[11px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700"><RotateCcw size={12} aria-hidden="true" />초기화</button>
        </div>
        <div className="flex flex-wrap items-end gap-3 p-3 md:p-4">
          <label className="flex flex-col gap-1 text-[10px] font-bold text-slate-500">
            주문일
            <span className="flex flex-wrap items-center gap-2">
              <input type="date" value={queryDateFrom} max={queryDateTo || undefined} onChange={event => setQueryDateFrom(event.target.value)} className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300" aria-label="주문일 시작" />
              <span className="text-xs text-slate-400">~</span>
              <input type="date" value={queryDateTo} min={queryDateFrom || undefined} onChange={event => setQueryDateTo(event.target.value)} className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300" aria-label="주문일 종료" />
              <span className="flex h-9 items-center overflow-hidden rounded-md border border-slate-200 bg-white">
                {[[todayKey, '오늘'], [quickWeekStart, '이번 주'], [`${todayKey.slice(0, 7)}-01`, '이번 달']].map(([from, label], index) => {
                  const selected = queryDateFrom === from && queryDateTo === todayKey;
                  return <button key={label} type="button" aria-pressed={selected} onClick={() => { setQueryDateFrom(from); setQueryDateTo(todayKey); }} className={`h-full px-3 text-[11px] ${index < 2 ? 'border-r border-slate-200' : ''} ${selected ? 'bg-slate-900 font-black text-white' : 'font-bold text-slate-600 hover:bg-slate-50'}`}>{label}</button>;
                })}
              </span>
            </span>
          </label>
          <span className="h-0 basis-full" aria-hidden="true" />
          <label className="flex w-36 shrink-0 flex-col gap-1 text-[10px] font-bold text-slate-500">
            검색 필드
            <select value={queryField} onChange={event => { setQueryField(event.target.value); setQueryValue(''); }} className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300">
              <option value="">필드 선택</option>
              {queryFields.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="flex w-36 shrink-0 flex-col gap-1 text-[10px] font-bold text-slate-500">
            조건 값
            <select value={queryValue} disabled={!queryField} onChange={event => setQueryValue(event.target.value)} className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 outline-none disabled:cursor-not-allowed disabled:opacity-40 focus:border-slate-400 focus:ring-1 focus:ring-slate-300">
              <option value="">전체</option>
              {queryValue && !queryOptions.includes(queryValue) && <option value={queryValue}>{queryValue} (결과 없음)</option>}
              {queryOptions.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="flex min-w-52 flex-1 flex-col gap-1 text-[10px] font-bold text-slate-500 md:max-w-sm">
            전체 검색
            <span className="relative block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} aria-hidden="true" />
              <input type="search" value={queryText} onChange={event => setQueryText(event.target.value)} placeholder="거래처, 주소, 품목, 비고 검색" className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300" />
            </span>
          </label>
        </div>
      </section>

      <div className="order-4 flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white px-1" aria-label="배송 상태 필터">
        {[
          { value: 'all' as const, label: '전체', count: deliveryQueryOrders.length },
          { value: OrderStatus.DISPATCHED, label: '작업완료', count: deliveryQueryOrders.filter(order => order.status === OrderStatus.DISPATCHED).length },
          { value: OrderStatus.SHIPPED, label: '출고완료', count: deliveryQueryOrders.filter(order => order.status === OrderStatus.SHIPPED).length },
        ].map(status => (
          <button key={status.value} type="button" onClick={() => setQueryStatus(status.value as typeof queryStatus)} className={`flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-xs font-black transition-colors ${queryStatus === status.value ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>
            <span>{status.label}</span><span className={`text-[9px] tabular-nums ${queryStatus === status.value ? 'text-indigo-500' : 'text-slate-400'}`}>{status.count}</span>
          </button>
        ))}
      </div>

      {deliveryTab === '리스트' && (
        <div className="order-5">
        <OrdersList
          title="배송 목록"
          subtitle="작업 완료 및 출고완료 주문"
          groupBy="status"
          allowedStatuses={[OrderStatus.DISPATCHED, OrderStatus.SHIPPED]}
          orders={orders.filter(order => order.status === OrderStatus.DISPATCHED || order.status === OrderStatus.SHIPPED)}
          partners={partners}
          items={items}
          partnerItems={partnerItems}
          palletStocks={palletStocks}

          itemBoms={itemBoms}
          onUpdateStatus={(id, status) => onUpdateStatus?.(id, status)}
          onUpdateDeliveryDate={(id, date) => onUpdateDeliveryDate?.(id, date)}
          onUpdatePallets={(id, nextPallets) => onUpdatePallets?.(id, nextPallets)}
          onUpdateItems={(id, nextItems) => onUpdateItems?.(id, nextItems)}
          onToggleInvoicePrinted={(id, value) => onToggleInvoicePrinted?.(id, value)}
          onToggleShipmentComplete={(id, value) => onToggleShipmentComplete?.(id, value)}
          onToggleItemChecked={onToggleItemChecked}
          onDeleteOrder={id => onDeleteOrder?.(id)}
          onAddClick={() => {}}
          embeddedListOnly
        />
        </div>
      )}

      {/* 작업완료 / 보류 / 출고 컬럼 */}
      {(() => {
        const dispatchedOrders = orders
          .filter(o => o.status === OrderStatus.DISPATCHED && o.partnerName !== '생산기록')
          .sort((a, b) => (a.deliveryDate || '').localeCompare(b.deliveryDate || ''));
        const onHoldOrders = orders.filter(o => o.status === OrderStatus.ON_HOLD && o.partnerName !== '생산기록');
        const shippedOrders = orders.filter(o => o.status === OrderStatus.SHIPPED && o.partnerName !== '생산기록');
        // 금일 배송순서는 아래 조회 결과의 상태 탭/검색조건과 독립적으로 운영 대상 전체를 본다.
        const deliverySequenceOrders = sourceOrders.filter(order =>
          order.partnerName !== '생산기록'
          && [OrderStatus.PROCESSING, OrderStatus.DISPATCHED, OrderStatus.SHIPPED].includes(order.status)
        );
        const visibleDeliverySequenceOrders = deliverySequenceOrders.filter(order =>
          showCompletedDeliveryOrders || order.status !== OrderStatus.SHIPPED
        );

        const completionRateOf = (order: Order) => order.items.length === 0
          ? 0
          : Math.round((order.items.filter(item => item.checked).length / order.items.length) * 100);

        const dueDateTimeOf = (order: Order) => {
          const time = new Date(order.deliveryDate).getTime();
          return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
        };

        const recommendedOrders = [...visibleDeliverySequenceOrders].sort((a, b) =>
          completionRateOf(b) - completionRateOf(a)
          || dueDateTimeOf(a) - dueDateTimeOf(b)
          || (calendarLocationOf(a) || '\uffff').localeCompare(calendarLocationOf(b) || '\uffff', 'ko')
          || (a.partnerName || '').localeCompare(b.partnerName || '', 'ko')
        );
        const validIds = new Set(visibleDeliverySequenceOrders.map(order => order.id));
        const manualIds = [
          ...deliveryOrdering.filter(id => validIds.has(id)),
          ...visibleDeliverySequenceOrders.filter(order => !deliveryOrdering.includes(order.id)).map(order => order.id),
        ];
        const visibleIds = deliverySortMode === 'recommended'
          ? recommendedOrders.map(order => order.id)
          : manualIds;
        const todayDeliveryOrders = deliverySequenceOrders.filter(order => queryDateKey(order.deliveryDate) === todayKey);
        const todayIncompleteCount = todayDeliveryOrders.filter(order => order.status !== OrderStatus.SHIPPED).length;
        const todayCompleteCount = todayDeliveryOrders.filter(order => order.status === OrderStatus.SHIPPED).length;

        const saveDeliveryOrdering = (next: string[], slots?: Record<string, '오전' | '오후'>) => {
          setDeliveryOrdering(next);
          setDocument('settings', 'deliveryOrdering', { ordering: next, timeSlots: slots ?? deliveryTimeSlots });
        };

        const saveTimeSlots = (next: Record<string, '오전' | '오후'>) => {
          setDeliveryTimeSlots(next);
          setDocument('settings', 'deliveryOrdering', { ordering: deliveryOrdering, timeSlots: next });
        };

        const toggleTimeSlot = (id: string) => {
          const next: Record<string, '오전' | '오후'> = { ...deliveryTimeSlots, [id]: deliveryTimeSlots[id] === '오후' ? '오전' : '오후' };
          saveTimeSlots(next);
        };

        const morningIds = visibleIds.filter(id => (deliveryTimeSlots[id] || '오전') === '오전');
        const afternoonIds = visibleIds.filter(id => deliveryTimeSlots[id] === '오후');

        const moveDeliveryOrder = (targetId: string, slot: '오전' | '오후') => {
          if (deliverySortMode !== 'manual' || dragDeliveryIdx === null || dragDeliveryId === null) return;
          const next = [...manualIds];
          const sourceIndex = next.indexOf(dragDeliveryId);
          const targetIndex = next.indexOf(targetId);
          if (sourceIndex < 0 || targetIndex < 0) return;
          const [moved] = next.splice(sourceIndex, 1);
          next.splice(targetIndex, 0, moved);
          saveDeliveryOrdering(next, { ...deliveryTimeSlots, [dragDeliveryId]: slot });
          setDragDeliveryIdx(null);
          setDragDeliveryId(null);
        };

        const renderDeliveryRow = (id: string, slot: '오전' | '오후') => {
          const order = deliverySequenceOrders.find(candidate => candidate.id === id);
          if (!order) return null;
          const partner = partners.find(candidate => candidate.id === order.partnerId);
          const partnerName = partner?.name || order.partnerName || '거래처 미지정';
          const location = calendarLocationOf(order);
          const completionRate = completionRateOf(order);
          const sequenceNumber = visibleIds.indexOf(id) + 1;
          const slotTone = slot === '오전' ? 'amber' : 'indigo';
          return (
            <div
              key={id}
              draggable={deliverySortMode === 'manual'}
              onDragStart={() => {
                if (deliverySortMode !== 'manual') return;
                setDragDeliveryIdx(manualIds.indexOf(id));
                setDragDeliveryId(id);
              }}
              onDragOver={event => deliverySortMode === 'manual' && event.preventDefault()}
              onDrop={() => moveDeliveryOrder(id, slot)}
              className={`grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border bg-white px-3 py-2.5 shadow-sm ${slotTone === 'amber' ? 'border-amber-100' : 'border-indigo-100'} ${deliverySortMode === 'manual' ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              <span className={`text-center text-[11px] font-black tabular-nums ${slotTone === 'amber' ? 'text-amber-600' : 'text-indigo-600'}`}>{sequenceNumber}</span>
              <button type="button" onClick={() => setPreviewDeliveryOrderId(id)} className="min-w-0 text-left hover:opacity-75">
                <span className="flex min-w-0 items-center gap-2">
                  <strong className="truncate text-xs font-black text-slate-800">{partnerName}</strong>
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-black ${statusChip(order.status)}`}>{statusLabel(order.status)}</span>
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-bold text-slate-500">
                  <span>{queryDateKey(order.deliveryDate).replaceAll('-', '.')}</span>
                  <span>{order.items.length}품목</span>
                  <span>작업 {completionRate}%</span>
                  {location && <span className="inline-flex items-center gap-0.5"><MapPin size={9} />{location}</span>}
                </span>
              </button>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => toggleTimeSlot(id)} className={`min-h-7 rounded-md px-2 text-[10px] font-black ${slotTone === 'amber' ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}>{slot}</button>
                {deliverySortMode === 'manual' && <GripVertical size={14} className="text-slate-300" aria-label="순서 이동" />}
              </div>
            </div>
          );
        };

        return (
          <>
              {/* 금일 배송순서 패널 */}
              <div className="order-1 flex w-full flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <button type="button" className="flex min-h-11 items-center gap-2 text-left" onClick={() => toggleMobileCollapse('delivery-order')} aria-expanded={!mobileCollapsed.has('delivery-order')}>
                    <div className="rounded-xl bg-indigo-600 p-1.5 text-white"><ListOrdered size={16} /></div>
                    <h3 className="text-sm font-black text-slate-900"><span className="tabular-nums">{todayKey.replaceAll('-', '.')}</span> 금일 배송순서</h3>
                    <ChevronDown size={14} className={`text-slate-400 transition-transform ${mobileCollapsed.has('delivery-order') ? '' : 'rotate-180'}`} />
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-bold text-slate-500">
                      출고 미완료 <strong className="font-black text-rose-600">{todayIncompleteCount}건</strong>
                      <span className="mx-1.5 text-slate-300">·</span>
                      출고 완료 <strong className="font-black text-emerald-600">{todayCompleteCount}건</strong>
                    </p>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 px-2 text-xs font-medium text-slate-600">
                      <input type="checkbox" checked={showCompletedDeliveryOrders} onChange={event => setShowCompletedDeliveryOrders(event.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500" />
                      완료 포함
                    </label>
                  </div>
                </div>
                <div className={`flex-col gap-3 p-3 ${mobileCollapsed.has('delivery-order') ? 'hidden' : 'flex'}`}>
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2">
                    <span className="px-1 text-[11px] font-black text-slate-500">정렬 방식</span>
                    <div className="flex rounded-lg border border-slate-200 bg-white p-0.5" aria-label="배송순서 정렬 방식">
                      <button type="button" onClick={() => setDeliverySortMode('recommended')} aria-pressed={deliverySortMode === 'recommended'} className={`min-h-8 rounded-md px-2.5 text-[11px] font-black transition-colors ${deliverySortMode === 'recommended' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>추천 순서 적용</button>
                      <button type="button" onClick={() => setDeliverySortMode('manual')} aria-pressed={deliverySortMode === 'manual'} className={`min-h-8 rounded-md px-2.5 text-[11px] font-black transition-colors ${deliverySortMode === 'manual' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>직접 정렬</button>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500">{deliverySortMode === 'recommended' ? '작업완료율 높은 순 → 출고예정일 임박 순 → 같은 시군구 순' : '이동 핸들을 끌어 순서를 직접 변경'}</span>
                  </div>
                  {visibleIds.length === 0 ? (
                    <p className="py-6 text-center text-xs font-bold text-slate-400">배송순서에 표시할 주문이 없습니다.</p>
                  ) : (
                    <>
                      <div
                        className="px-1 pt-1 text-[10px] font-black text-amber-600"
                        onDragOver={event => deliverySortMode === 'manual' && event.preventDefault()}
                        onDrop={() => {
                          if (deliverySortMode !== 'manual' || dragDeliveryId === null) return;
                          const next: Record<string, '오전' | '오후'> = { ...deliveryTimeSlots, [dragDeliveryId]: '오전' };
                          saveTimeSlots(next);
                          setDragDeliveryId(null);
                        }}
                      >오전</div>
                      {morningIds.length === 0 ? <p className="py-1 text-center text-[10px] font-bold text-slate-300">없음</p> : morningIds.map(id => renderDeliveryRow(id, '오전'))}
                      <div
                        className="px-1 pt-2 text-[10px] font-black text-indigo-600"
                        onDragOver={event => deliverySortMode === 'manual' && event.preventDefault()}
                        onDrop={() => {
                          if (deliverySortMode !== 'manual' || dragDeliveryId === null) return;
                          const next: Record<string, '오전' | '오후'> = { ...deliveryTimeSlots, [dragDeliveryId]: '오후' };
                          saveTimeSlots(next);
                          setDragDeliveryId(null);
                        }}
                      >오후</div>
                      {afternoonIds.length === 0 ? <p className="py-1 text-center text-[10px] font-bold text-slate-300">없음</p> : afternoonIds.map(id => renderDeliveryRow(id, '오후'))}
                    </>
                  )}
                </div>
              </div>

            {deliveryTab === '보드' && <div className="order-5 md:overflow-x-auto no-scrollbar">
              <div className="flex flex-col gap-4 pb-1 md:min-w-max md:flex-row md:items-start">
              {/* 작업완료 컬럼 (2열) */}
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('orderId'); if (id) onUpdateStatus?.(id, OrderStatus.DISPATCHED); }}
                className="flex flex-col rounded-3xl border border-emerald-100 bg-emerald-50/50 shadow-sm w-full md:w-72 md:shrink-0"
              >
                <div className="p-4 border-b border-white/50 flex items-center gap-3">
                  <button className="flex items-center gap-3 md:cursor-default" onClick={() => { if (window.innerWidth < 768) toggleMobileCollapse('dispatched'); }}>
                    <div className="p-2 rounded-xl bg-emerald-500 text-white"><CheckCircle2 size={20} /></div>
                    <h3 className="text-sm font-black text-emerald-700">작업완료 ({dispatchedOrders.length})</h3>
                    <ChevronDown size={14} className={`md:hidden text-emerald-400 transition-transform ${mobileCollapsed.has('dispatched') ? '' : 'rotate-180'}`} />
                  </button>
                </div>
                <div className={`p-4 flex flex-col gap-3 overflow-y-auto no-scrollbar ${mobileCollapsed.has('dispatched') ? 'hidden md:flex' : ''}`}>
                  {dispatchedOrders.length === 0 ? (
                    <p className="text-center text-[11px] text-slate-300 font-bold py-10">주문이 없습니다</p>
                  ) : dispatchedOrders.map(order => {
                    const isChecked = selectedDispatchedIds.has(order.id);
                    return (
                      <div key={order.id} className="flex items-start gap-2">
                        <button
                          onClick={() => toggleDispatchedSelect(order.id)}
                          className={`mt-3 shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                            isChecked
                              ? 'border-indigo-500 bg-white'
                              : 'bg-white border-slate-300 hover:border-indigo-400'
                          }`}
                        >
                          {isChecked && (
                            <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="1,4 3.5,7 9,1" />
                            </svg>
                          )}
                        </button>
                        <div className={`flex-1 transition-all rounded-2xl ${isChecked ? 'ring-2 ring-indigo-400 ring-offset-1' : ''}`}>
                          <OrderCard
                            readOnly
                            tintedHeader
                            order={order}
                            partners={partners}
                            items={products}

                            itemBoms={itemBoms}
                            editingOrderId={editingOrderId}
                            setEditingOrderId={setEditingOrderId}
                            showAddProductSelect={showAddProductSelect}
                            setShowAddProductSelect={setShowAddProductSelect}
                            onUpdateItems={onUpdateItems}
                            onUpdateDeliveryDate={onUpdateDeliveryDate!}
                            onUpdateStatus={onUpdateStatus!}
                            onToggleItemChecked={onToggleItemChecked}
                            onDeleteOrder={onDeleteOrder ?? (() => {})}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {dispatchedOrders.length > 0 && (
                    <div className="flex items-center gap-2 pt-1 border-t border-emerald-100 mt-1">
                      <button
                        onClick={() => {
                          if (selectedDispatchedIds.size === dispatchedOrders.length) {
                            setSelectedDispatchedIds(new Set());
                          } else {
                            setSelectedDispatchedIds(new Set(dispatchedOrders.map(o => o.id)));
                          }
                        }}
                        className="flex items-center gap-1.5 text-[10px] font-black text-emerald-600 hover:text-emerald-800 transition-all"
                      >
                        {selectedDispatchedIds.size === dispatchedOrders.length
                          ? <CheckSquare size={13} />
                          : <Square size={13} />
                        }
                        {selectedDispatchedIds.size === dispatchedOrders.length ? '전체 해제' : '전체 선택'}
                      </button>
                      {selectedDispatchedIds.size > 0 && (
                        <button
                          onClick={handleBulkShip}
                          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-black rounded-xl shadow transition-all active:scale-95"
                        >
                          <Send size={12} />
                          일괄 출고 등록 ({selectedDispatchedIds.size})
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 출고 컬럼 (1열, 컴팩트) */}
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('orderId'); if (id) onUpdateStatus?.(id, OrderStatus.SHIPPED); }}
                className="flex flex-col rounded-3xl border border-indigo-100 bg-indigo-50/50 shadow-sm w-full md:w-72 md:shrink-0"
              >
                <div className="p-4 border-b border-white/50 flex items-center gap-3">
                  <button className="flex items-center gap-3 md:cursor-default" onClick={() => { if (window.innerWidth < 768) toggleMobileCollapse('shipped'); }}>
                    <div className="p-2 rounded-xl bg-indigo-500 text-white"><Send size={18} /></div>
                    <h3 className="font-black text-sm text-indigo-700">출고완료 ({shippedOrders.length})</h3>
                    <ChevronDown size={14} className={`md:hidden text-indigo-400 transition-transform ${mobileCollapsed.has('shipped') ? '' : 'rotate-180'}`} />
                  </button>
                </div>
                <div className={`p-4 grid grid-cols-1 gap-3 overflow-y-auto no-scrollbar ${mobileCollapsed.has('shipped') ? 'hidden md:grid' : ''}`}>
                  {shippedOrders.length === 0 ? (
                    <p className="col-span-1 text-center text-[11px] text-slate-300 font-bold py-10">주문이 없습니다</p>
                  ) : shippedOrders.map(order => (
                    <OrderCard
                      readOnly
                      tintedHeader
                      key={order.id}
                      order={order}
                      partners={partners}
                      items={products}

                      itemBoms={itemBoms}
                      editingOrderId={editingOrderId}
                      setEditingOrderId={setEditingOrderId}
                      showAddProductSelect={showAddProductSelect}
                      setShowAddProductSelect={setShowAddProductSelect}
                      onUpdateItems={onUpdateItems}
                      onUpdateDeliveryDate={onUpdateDeliveryDate!}
                      onUpdateStatus={onUpdateStatus!}
                      onToggleItemChecked={onToggleItemChecked}
                      onDeleteOrder={onDeleteOrder ?? (() => {})}
                    />
                  ))}
                </div>
              </div>

              {/* 보류 컬럼 */}
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('orderId'); if (id) onUpdateStatus?.(id, OrderStatus.ON_HOLD); }}
                className="flex flex-col rounded-3xl border border-orange-100 bg-orange-50/50 shadow-sm w-full md:w-72 md:shrink-0"
              >
                <div className="p-4 border-b border-white/50 flex items-center gap-3">
                  <button className="flex items-center gap-3 md:cursor-default" onClick={() => { if (window.innerWidth < 768) toggleMobileCollapse('onhold'); }}>
                    <div className="p-2 rounded-xl bg-orange-400 text-white"><Clock size={18} /></div>
                    <h3 className="font-black text-sm text-orange-700">보류 ({onHoldOrders.length})</h3>
                    <ChevronDown size={14} className={`md:hidden text-orange-400 transition-transform ${mobileCollapsed.has('onhold') ? '' : 'rotate-180'}`} />
                  </button>
                </div>
                <div className={`p-4 grid grid-cols-1 gap-3 overflow-y-auto no-scrollbar ${mobileCollapsed.has('onhold') ? 'hidden md:grid' : ''}`}>
                  {onHoldOrders.length === 0 ? (
                    <p className="col-span-1 text-center text-[11px] text-slate-300 font-bold py-10">보류 중인 주문이 없습니다</p>
                  ) : onHoldOrders.map(order => (
                    <OrderCard
                      readOnly
                      tintedHeader
                      key={order.id}
                      order={order}
                      partners={partners}
                      items={products}

                      itemBoms={itemBoms}
                      editingOrderId={editingOrderId}
                      setEditingOrderId={setEditingOrderId}
                      showAddProductSelect={showAddProductSelect}
                      setShowAddProductSelect={setShowAddProductSelect}
                      onUpdateItems={onUpdateItems}
                      onUpdateDeliveryDate={onUpdateDeliveryDate!}
                      onUpdateStatus={onUpdateStatus!}
                      onToggleItemChecked={onToggleItemChecked}
                      onDeleteOrder={onDeleteOrder ?? (() => {})}
                    />
                  ))}
                </div>
              </div>
            </div>
            </div>}

          </>
        );
      })()}

      {/* Calendar (Weekly / Monthly toggle) */}
      {deliveryTab === '캘린더' && (
        <div className="order-5 mb-10 min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {/* 공통 헤더 — 뷰 토글 + 현재 뷰 내비게이션 */}
          <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-inner ${calendarView === '주간' ? 'bg-violet-100 text-violet-600' : 'bg-indigo-100 text-indigo-600'}`}>
                <CalendarIcon size={18} />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">
                  {calendarView === '주간' ? weekLabel : `${year}년 ${monthNames[month]}`}
                </h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">배송 캘린더</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* 주간/월간 토글 */}
              <div className="flex bg-slate-100 p-0.5 rounded-xl">
                {(['주간', '월간'] as const).map(v => (
                  <button key={v} onClick={() => setCalendarView(v)}
                    className={`px-3 py-1.5 rounded-[10px] text-xs font-black transition-all ${calendarView === v ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                    {v}
                  </button>
                ))}
              </div>
              {/* 주간 내비게이션 */}
              {calendarView === '주간' && <>
                <button onClick={prevWeek} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-violet-600 transition-all"><ChevronLeft size={16} /></button>
                <button onClick={() => setCurrentWeekDate(new Date())} className="px-3 py-1.5 text-xs font-black text-violet-600 bg-violet-50 rounded-xl hover:bg-violet-100 transition-all">이번주</button>
                <button onClick={nextWeek} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-violet-600 transition-all"><ChevronRight size={16} /></button>
              </>}
              {/* 월간 내비게이션 */}
              {calendarView === '월간' && <>
                <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-indigo-600 transition-all"><ChevronLeft size={16} /></button>
                <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 text-xs font-black text-indigo-600 bg-indigo-50 rounded-xl hover:bg-indigo-100 transition-all">오늘</button>
                <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-indigo-600 transition-all"><ChevronRight size={16} /></button>
              </>}
            </div>
          </div>

          <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain" role="region" aria-label="배송 캘린더 좌우 스크롤" tabIndex={0}>
          <div style={{ minWidth: 7 * 180 }}>
          {/* 주간 뷰 */}
          {calendarView === '주간' && (
            <div className="grid border-l border-slate-100" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
              {renderWeekCalendar()}
            </div>
          )}

          {/* 월간 뷰 */}
          {calendarView === '월간' && <>
            <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50">
              {["일", "월", "화", "수", "목", "금", "토"].map((day, index) => (
                <div key={day} className={`py-3 text-center text-xs font-black ${weekdayTextClass(index)}`}>{day}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 border-l border-slate-100">
              {renderCalendar()}
            </div>
          </>}
          </div>
          </div>
        </div>
      )}

      {/*  **하루 상세 창** — 폰에서 날짜를 누르면 뜬다(2026-09-06 사장님).
           칸이 좁아 목록을 못 넣으니 여기서 다 보여준다. 주문을 누르면 원래 상세로 넘어간다. */}
      {dayModal && (() => {
        const 진행 = deliverySchedules[dayModal] || [];
        const 완료 = deliveredSchedules[dayModal] || [];
        const d = new Date(dayModal + 'T00:00:00');
        const 제목 = `${d.getMonth() + 1}월 ${d.getDate()}일 (${dayLabels[d.getDay()]})`;
        const 진행Rows: DayRow[] = 진행.map(order => ({
          orderId: order.id,
          auto: !deliveryOrdering.includes(order.id),
          slot: deliveryTimeSlots[order.id] || '오전',
          done: order.status === OrderStatus.SHIPPED,
        }));
        const 줄 = (order: Order, done: boolean) => {
          return (
            <button key={order.id} type="button"
              onClick={() => { setDayModal(null); handleOrderClick(order); }}
              className={`w-full text-left text-xs font-bold py-2.5 px-3 rounded-xl border flex justify-between items-center gap-2 transition-all active:scale-[0.98] ${
                done ? 'bg-slate-50 border-slate-200 text-slate-400' : statusChip(order.status)}`}>
              <span className="flex-1 min-w-0 break-keep">{order.partnerName}</span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="opacity-70">{done ? '완료' : DELIVERY_STATUS_LABEL[order.status]}</span>
                <WorkCheckWarning order={order} className="text-[9px]" />
              </span>
            </button>
          );
        };
        return (
          <div className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setDayModal(null)} />
            <div className="relative bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[80vh] flex flex-col">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-base font-black text-slate-900">{제목}</h3>
                  <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                    배송 {진행.length}건{완료.length > 0 && ` · 이전 ${완료.length}건`}
                  </p>
                </div>
                <button onClick={() => setDayModal(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {진행.length === 0 && 완료.length === 0 && (
                  <p className="py-12 text-center text-sm font-bold text-slate-300">이 날은 배송이 없습니다.</p>
                )}
                {진행Rows.length > 0 && (
                  <DeliveryDayList
                    rows={진행Rows}
                    orders={orders}
                    partners={partners}
                    dateStr={dayModal}
                    on={{
                      open: order => { setDayModal(null); handleOrderClick(order); },
                      toggleDone: id => onToggleShipmentComplete?.(id, orders.find(order => order.id === id)?.status !== OrderStatus.SHIPPED),
                    }}
                  />
                )}
                {완료.length > 0 && (
                  <>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest pt-3 pb-1">이전 배송</p>
                    {완료.map(o => 줄(o, true))}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* 배송 담당자는 일정만 수정한다. 주문 품목 변경은 주문 관리에서만 허용한다. */}
      {editingOrder && (
        <OrderEditModalShell
          title="출고 일정 수정"
          partnerName={editingOrder.partnerName || partners.find(partner => partner.id === editingOrder.partnerId)?.name || '거래처 미지정'}
          context={`주문일 ${queryDateKey(editingOrder.createdAt).replaceAll('-', '.')} · ${DELIVERY_STATUS_LABEL[editingOrder.status] || editingOrder.status}`}
          onClose={requestCloseScheduleEditor}
          onSave={requestSaveDate}
          saveDisabled={!newDate || !isScheduleDirty || isSavingSchedule}
        >
          <div className="space-y-5">
            <section aria-labelledby="delivery-order-summary">
              <h4 id="delivery-order-summary" className="mb-2 text-xs font-black text-slate-700">주문 정보</h4>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
                <div className="col-span-2">
                  <dt className="mb-1 font-medium text-slate-400">배송지</dt>
                  <dd className="font-bold leading-5 text-slate-700">
                    {(() => {
                      const partner = partners.find(candidate => candidate.id === editingOrder.partnerId);
                      return [partner?.address, partner?.addressDetail].filter(Boolean).join(' ') || '주소 미등록';
                    })()}
                  </dd>
                </div>
                <div>
                  <dt className="mb-1 font-medium text-slate-400">출고 방식</dt>
                  <dd className="font-bold text-slate-700">{editingOrder.source || '-'}</dd>
                </div>
                <div>
                  <dt className="mb-1 font-medium text-slate-400">주문 품목</dt>
                  <dd className="font-bold text-slate-700">{editingOrder.items.length}개</dd>
                </div>
              </dl>
            </section>
            <section aria-labelledby="delivery-schedule-heading">
              <h4 id="delivery-schedule-heading" className="mb-2 text-xs font-black text-slate-700">출고 일정</h4>
              <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                <label className="block text-[11px] font-bold text-slate-600" htmlFor="delivery-editor-date">출고예정일
                  <input id="delivery-editor-date" type="date" value={newDate} onChange={event => { setNewDate(event.target.value); setScheduleSaveError(''); }} className="mt-1.5 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold tabular-nums text-slate-800 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                </label>
                <fieldset>
                  <legend className="text-[11px] font-bold text-slate-600">출고 시간대</legend>
                  <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-1" role="radiogroup" aria-label="출고 시간대">
                    {(['오전', '오후'] as const).map(slot => (
                      <button key={slot} type="button" role="radio" aria-checked={editingTimeSlot === slot} onClick={() => { setEditingTimeSlot(slot); setScheduleSaveError(''); }} className={`min-h-9 rounded-md text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${editingTimeSlot === slot ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>{slot}</button>
                    ))}
                  </div>
                </fieldset>
              </div>
            </section>
            <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] font-medium text-slate-500">주문 품목과 수량의 변경·삭제·추가는 주문 관리에서 진행할 수 있습니다.</p>
            {scheduleSaveError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-600">{scheduleSaveError}</p>}
          </div>
        </OrderEditModalShell>
      )}

      {scheduleConfirmation === 'discard' && (
        <ConfirmModal
          message="저장하지 않고 닫을까요?"
          subMessage="변경한 출고 일정은 반영되지 않습니다."
          confirmText="변경 취소"
          onCancel={() => setScheduleConfirmation(null)}
          onConfirm={closeScheduleEditor}
        />
      )}

      {scheduleConfirmation === 'save-shipped' && editingOrder && (
        <ConfirmModal
          message="출고완료 주문의 일정을 변경할까요?"
          subMessage={`${editingOrder.partnerName} · ${originalScheduleDate.replaceAll('-', '.')} ${originalTimeSlot} → ${newDate.replaceAll('-', '.')} ${editingTimeSlot}`}
          confirmText="변경 저장"
          onCancel={() => setScheduleConfirmation(null)}
          onConfirm={() => { void persistScheduleChange(); }}
        />
      )}

      {/* 배송순서 클릭 → 주문카드 팝업 */}
      {previewDeliveryOrderId && (() => {
        const order = orders.find(o => o.id === previewDeliveryOrderId);
        if (!order) return null;
        const partnerName = order.partnerName || partners.find(c => c.id === order.partnerId)?.name || '이름없음';
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setPreviewDeliveryOrderId(null)}
          >
            <div
              className="bg-slate-50 rounded-3xl shadow-2xl w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-200 flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-white rounded-t-3xl">
                <div>
                  <h3 className="font-black text-slate-900">{partnerName}</h3>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600">작업완료</span>
                </div>
                <button onClick={() => setPreviewDeliveryOrderId(null)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
                  <X size={16} />
                </button>
              </div>
              <div className="p-4 overflow-y-auto max-h-[70vh]">
                <OrderCard
                      readOnly
                  order={order}
                  partners={partners}
                items={products}

                  itemBoms={itemBoms}
                  editingOrderId={editingOrderId}
                  setEditingOrderId={setEditingOrderId}
                  showAddProductSelect={showAddProductSelect}
                  setShowAddProductSelect={setShowAddProductSelect}
                  onUpdateItems={onUpdateItems}
                  onUpdateDeliveryDate={onUpdateDeliveryDate ?? (() => {})}
                  onUpdateStatus={onUpdateStatus ?? (() => {})}
                  onToggleItemChecked={onToggleItemChecked}
                  onDeleteOrder={onDeleteOrder ?? (() => {})}
                />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default DeliveryManager;
