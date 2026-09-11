import { statusChip, statusLabel } from '../src/shared/orderStatusStyle';
import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Package, Store, Truck } from 'lucide-react';
import { Order } from '../types';
import CalendarDayCountBadge from './CalendarDayCountBadge';

interface CalendarViewProps {
  orders: Order[];
  onUpdateDeliveryDate: (_id: string, _date: string) => void;
  onOrderClick: (_id: string) => void;
}


const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const startOfWeek = (date: Date) => {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() - ((next.getDay() + 6) % 7));
  return next;
};
const weekdayTextClass = (day: number) => day === 0 || day === 6 ? 'text-rose-600' : 'text-slate-600';

const CalendarView: React.FC<CalendarViewProps> = ({ orders, onUpdateDeliveryDate, onOrderClick }) => {
  const [mode, setMode] = useState<'주간' | '월간'>('주간');
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [currentWeek, setCurrentWeek] = useState(() => new Date());
  const ordersByDate = useMemo(() => {
    const grouped = new Map<string, Order[]>();
    orders.forEach(order => {
      if (!order.deliveryDate) return;
      const key = dateKey(new Date(order.deliveryDate));
      grouped.set(key, [...(grouped.get(key) ?? []), order]);
    });
    return grouped;
  }, [orders]);

  const weekStart = startOfWeek(currentWeek);
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + index);
    return day;
  });
  const weekEnd = weekDays[6];
  const monthYear = currentMonth.getFullYear();
  const monthIndex = currentMonth.getMonth();
  const monthOffset = new Date(monthYear, monthIndex, 1).getDay();
  const monthLength = new Date(monthYear, monthIndex + 1, 0).getDate();
  const monthCells: (Date | null)[] = [
    ...Array.from({ length: monthOffset }, () => null),
    ...Array.from({ length: monthLength }, (_, index) => new Date(monthYear, monthIndex, index + 1)),
  ];
  while (monthCells.length % 7) monthCells.push(null);

  const movePeriod = (direction: -1 | 1) => {
    if (mode === '주간') {
      const next = new Date(currentWeek);
      next.setDate(next.getDate() + direction * 7);
      setCurrentWeek(next);
    } else setCurrentMonth(new Date(monthYear, monthIndex + direction, 1));
  };
  const goToday = () => { setCurrentWeek(new Date()); setCurrentMonth(new Date()); };
  const handleDrop = (event: React.DragEvent, day: Date) => {
    event.preventDefault();
    const orderId = event.dataTransfer.getData('orderId');
    if (orderId) onUpdateDeliveryDate(orderId, dateKey(day));
  };

  const renderDay = (day: Date | null, weekly: boolean, index: number) => {
    if (!day) return <div key={`empty-${index}`} className="border-b border-r border-slate-100 bg-slate-50/40" />;
    const key = dateKey(day);
    const dayOrders = ordersByDate.get(key) ?? [];
    const today = key === dateKey(new Date());
    return (
      <div key={key} onDragOver={event => event.preventDefault()} onDrop={event => handleDrop(event, day)} className={`group border-b border-r border-slate-100 p-2 transition-colors hover:bg-indigo-50/30 ${today ? 'bg-indigo-50/30' : 'bg-white'}`} style={{ minHeight: weekly ? 200 : 112 }}>
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex min-h-8 items-center gap-1.5">
            <span className={`flex h-8 min-w-8 items-center justify-center rounded-full px-1 text-lg font-black leading-none tabular-nums ${today ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-800'}`}>{day.getDate()}</span>
            <span className={`text-[11px] font-black ${weekdayTextClass(day.getDay())}`}>{['일', '월', '화', '수', '목', '금', '토'][day.getDay()]}</span>
          </div>
          <CalendarDayCountBadge count={dayOrders.length} />
        </div>
        <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: weekly ? 250 : 112, scrollbarWidth: 'thin' }}>
          {dayOrders.map(order => {
            const status = { label: statusLabel(order.status), className: statusChip(order.status) };
            const orderItems = order.items ?? [];
            const completedCount = orderItems.filter(item => item.checked).length;
            const progress = orderItems.length > 0 ? Math.round((completedCount / orderItems.length) * 100) : 0;
            const boxQuantity = orderItems.reduce((sum, item) => sum + (item.isBoxUnit ? (item.boxQuantity ?? 0) : 0), 0);
            const unitQuantity = orderItems.reduce((sum, item) => sum + (!item.isBoxUnit ? (item.quantity ?? 0) : 0), 0);
            const quantityLabel = [boxQuantity > 0 ? `${boxQuantity}박스` : '', unitQuantity > 0 ? `${unitQuantity}개` : ''].filter(Boolean).join(' · ') || '-';
            const ChannelIcon = order.source === '스마트스토어' ? Store : order.source === '택배' ? Truck : null;
            return <button
              key={order.id}
              type="button"
              draggable
              onClick={() => onOrderClick(order.id)}
              onDragStart={event => { event.dataTransfer.setData('orderId', order.id); event.dataTransfer.effectAllowed = 'move'; }}
              className={`w-full rounded-lg border p-2.5 text-left text-[10px] font-bold shadow-sm transition-[filter] hover:brightness-95 ${status.className}`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex flex-1 items-center gap-1.5">
                  {ChannelIcon && <ChannelIcon size={11} className="shrink-0" aria-label={order.source} />}
                  <span className="truncate text-[11px] font-black">{order.partnerName || '이름 없음'}</span>
                </span>
                <span className="shrink-0 text-[9px] font-black">{status.label}</span>
              </span>
              <span className="mt-1.5 flex items-center gap-1 opacity-90">
                <Package size={10} className="shrink-0" aria-hidden="true" />
                <span className="truncate">{orderItems[0]?.name || '품목 없음'}{orderItems.length > 1 ? ` 외 ${orderItems.length - 1}개` : ''}</span>
              </span>
              <span className="mt-1 flex items-center justify-between gap-2 opacity-80">
                <span className="truncate">총 {quantityLabel}</span>
                <span className="shrink-0 tabular-nums">{completedCount}/{orderItems.length} 완료</span>
              </span>
              <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/60" aria-label={`작업 완료 진행률 ${progress}%`}>
                <span className="block h-full rounded-full bg-current opacity-60" style={{ width: `${progress}%` }} />
              </span>
            </button>;
          })}
        </div>
      </div>
    );
  };

  return <section className="mb-10 min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 md:p-5">
      <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600"><CalendarDays size={18} aria-hidden="true" /></div><div><h3 className="text-base font-black text-slate-900">{mode === '주간' ? `${weekStart.getFullYear()}년 ${weekStart.getMonth() + 1}월 ${weekStart.getDate()}일 – ${weekEnd.getMonth() + 1}월 ${weekEnd.getDate()}일` : `${monthYear}년 ${monthIndex + 1}월`}</h3><p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">주문 캘린더</p></div></div>
      <div className="flex items-center gap-2"><div className="flex rounded-xl bg-slate-100 p-0.5" aria-label="캘린더 기간">{(['주간', '월간'] as const).map(value => <button key={value} type="button" onClick={() => setMode(value)} aria-pressed={mode === value} className={`rounded-[10px] px-3 py-1.5 text-xs font-black transition-all ${mode === value ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{value}</button>)}</div><button type="button" onClick={() => movePeriod(-1)} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-indigo-600" aria-label="이전 기간"><ChevronLeft size={16} /></button><button type="button" onClick={goToday} className="rounded-xl bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-600 hover:bg-indigo-100">오늘</button><button type="button" onClick={() => movePeriod(1)} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-indigo-600" aria-label="다음 기간"><ChevronRight size={16} /></button></div>
    </div>
    <div className="w-full overflow-x-auto overscroll-x-contain" role="region" aria-label="주문 캘린더 좌우 스크롤" tabIndex={0}>
    <div className="min-w-[1260px]">
    {mode === '월간' && <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/50">{['일', '월', '화', '수', '목', '금', '토'].map((day, index) => <div key={day} className={`py-3 text-center text-xs font-black ${weekdayTextClass(index)}`}>{day}</div>)}</div>}
    <div className="grid grid-cols-7 border-l border-slate-100">{(mode === '주간' ? weekDays : monthCells).map((day, index) => renderDay(day, mode === '주간', index))}</div>
    </div>
    </div>
  </section>;
};

export default CalendarView;
