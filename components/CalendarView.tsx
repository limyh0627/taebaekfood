
import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Package, X } from 'lucide-react';
import { Order, OrderStatus } from '../types';

interface CalendarViewProps {
  orders: Order[];
  onUpdateDeliveryDate: (_id: string, _date: string) => void;
}

const STATUS_SHORT: Record<string, string> = {
  PENDING: '대기', PROCESSING: '작업', DISPATCHED: '완료', SHIPPED: '출고', DELIVERED: '이력',
};
const DOT_COLOR: Record<string, string> = {
  PENDING: 'bg-amber-400', PROCESSING: 'bg-sky-400',
  DISPATCHED: 'bg-violet-400', SHIPPED: 'bg-indigo-400', DELIVERED: 'bg-emerald-400',
};

const CalendarView: React.FC<CalendarViewProps> = ({ orders, onUpdateDeliveryDate }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [popupDay, setPopupDay] = useState<number | null>(null);

  const daysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();

  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];
  const totalDays = daysInMonth(currentDate);
  const offset = firstDayOfMonth(currentDate);

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < offset; i++) calendarDays.push(null);
  for (let i = 1; i <= totalDays; i++) calendarDays.push(i);

  // 주 단위로 묶기
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < calendarDays.length; i += 7) weeks.push(calendarDays.slice(i, i + 7));

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  // 해당 주의 마지막 날이 오늘 이전이면 "지나간 주"
  const isWeekPast = (week: (number | null)[]) => {
    const lastDay = [...week].reverse().find(d => d !== null);
    if (!lastDay) return false;
    const lastDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), lastDay);
    return lastDate < todayMidnight;
  };

  const getOrdersForDay = (day: number) =>
    orders.filter(order => {
      if (!order.deliveryDate) return false;
      const d = new Date(order.deliveryDate);
      return d.getFullYear() === currentDate.getFullYear() &&
        d.getMonth() === currentDate.getMonth() &&
        d.getDate() === day;
    });

  const isToday = (day: number) =>
    day === new Date().getDate() &&
    currentDate.getMonth() === new Date().getMonth() &&
    currentDate.getFullYear() === new Date().getFullYear();

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const handleDrop = (e: React.DragEvent, day: number) => {
    e.preventDefault();
    const orderId = e.dataTransfer.getData('orderId');
    onUpdateDeliveryDate(orderId, new Date(currentDate.getFullYear(), currentDate.getMonth(), day).toISOString());
  };

  const getStatusColor = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.PENDING:    return 'bg-amber-100 text-amber-700 border-amber-200';
      case OrderStatus.PROCESSING: return 'bg-sky-100 text-sky-700 border-sky-200';
      case OrderStatus.SHIPPED:    return 'bg-indigo-100 text-indigo-700 border-indigo-200';
      case OrderStatus.DISPATCHED: return 'bg-violet-100 text-violet-700 border-violet-200';
      case OrderStatus.DELIVERED:  return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      default:                     return 'bg-slate-50 text-slate-500';
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm flex flex-col mb-8 animate-in fade-in duration-500">
      {/* 헤더 */}
      <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-t-3xl">
        <div className="flex items-center space-x-4">
          <h3 className="text-xl font-bold text-slate-900">{currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월</h3>
          <div className="flex items-center bg-white rounded-xl border border-slate-200 p-1">
            <button onClick={prevMonth} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500"><ChevronLeft size={20} /></button>
            <button onClick={nextMonth} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500"><ChevronRight size={20} /></button>
          </div>
          <button onClick={() => setCurrentDate(new Date())} className="text-xs font-bold text-indigo-600 px-3 py-1.5 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">오늘</button>
        </div>
        <div className="hidden md:flex items-center space-x-4 text-[11px] font-bold text-slate-400">
          <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-amber-400 mr-1.5" />대기</div>
          <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-sky-400 mr-1.5" />작업</div>
          <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-violet-400 mr-1.5" />완료</div>
          <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-indigo-400 mr-1.5" />출고</div>
          <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-emerald-400 mr-1.5" />이력</div>
        </div>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/30">
        {weekDays.map((day, idx) => (
          <div key={day} className={`p-3 text-center text-xs font-bold uppercase tracking-widest ${idx === 0 ? 'text-rose-500' : idx === 6 ? 'text-indigo-500' : 'text-slate-400'}`}>
            {day}
          </div>
        ))}
      </div>

      {/* 주 단위 렌더링 */}
      <div className="flex flex-col">
        {weeks.map((week, wi) => {
          const past = isWeekPast(week);

          return (
            <div key={wi} className={`grid grid-cols-7 border-b border-slate-100 last:border-b-0`}>
              {week.map((day, di) => {
                const dayOrders = day ? getOrdersForDay(day) : [];
                const isLastCol = di === 6;

                /* ── 지나간 주: 한 줄 압축 표시 ── */
                if (past) {
                  return (
                    <div
                      key={di}
                      className={`relative px-2 py-1.5 border-r border-slate-100 flex items-center gap-1.5 h-9 ${isLastCol ? 'border-r-0' : ''} ${day ? 'bg-slate-50/40' : 'bg-slate-50/20'}`}
                    >
                      {day && (
                        <>
                          <span className={`text-[11px] font-bold shrink-0 ${isToday(day) ? 'text-indigo-600' : 'text-slate-300'}`}>{day}</span>
                          {dayOrders.length > 0 && (
                            <button
                              onClick={() => setPopupDay(popupDay === day ? null : day)}
                              className="flex items-center gap-1 min-w-0"
                            >
                              <div className="flex gap-0.5 shrink-0">
                                {dayOrders.slice(0, 4).map((o, i) => (
                                  <span key={i} className={`w-1.5 h-1.5 rounded-full ${DOT_COLOR[o.status] || 'bg-slate-300'}`} />
                                ))}
                              </div>
                              <span className="text-[10px] font-black text-slate-400 hover:text-indigo-500 transition-colors whitespace-nowrap">{dayOrders.length}건</span>
                            </button>
                          )}

                          {/* 팝업 */}
                          {popupDay === day && (
                            <div className="absolute top-9 left-0 z-30 bg-white rounded-2xl shadow-xl border border-slate-100 w-52 p-2.5 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-150">
                              <div className="flex items-center justify-between mb-1 px-0.5">
                                <span className="text-[11px] font-black text-slate-600">{currentDate.getMonth()+1}/{day} 주문 {dayOrders.length}건</span>
                                <button onClick={() => setPopupDay(null)} className="text-slate-300 hover:text-slate-500 transition-colors"><X size={11} /></button>
                              </div>
                              {dayOrders.map(o => (
                                <div key={o.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[10px] font-bold border ${getStatusColor(o.status)}`}>
                                  <span className="truncate flex-1">{o.customerName || '이름없음'}</span>
                                  <span className="shrink-0 opacity-60 text-[9px]">{STATUS_SHORT[o.status]}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                }

                /* ── 현재/미래 주: 일반 카드 표시 (5개까지 노스크롤) ── */
                return (
                  <div
                    key={di}
                    onDragOver={handleDragOver}
                    onDrop={e => day && handleDrop(e, day)}
                    className={`p-2 border-r border-slate-100 group transition-colors flex flex-col ${day ? 'hover:bg-indigo-50/20' : 'bg-slate-50/30'} ${isLastCol ? 'border-r-0' : ''}`}
                  >
                    {day && (
                      <>
                        <div className="flex justify-between items-center mb-1.5">
                          <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday(day) ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500'}`}>
                            {day}
                          </span>
                        </div>
                        <div
                          className={`flex flex-col gap-1.5 ${dayOrders.length > 5 ? 'overflow-y-auto no-scrollbar' : ''}`}
                          style={dayOrders.length > 5 ? { maxHeight: '260px' } : {}}
                        >
                          {dayOrders.map(order => (
                            <div
                              key={order.id}
                              draggable
                              onDragStart={e => { e.dataTransfer.setData('orderId', order.id); e.dataTransfer.effectAllowed = 'move'; }}
                              className={`p-2 rounded-lg border text-[10px] font-bold shadow-sm cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] ${getStatusColor(order.status)}`}
                            >
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="truncate max-w-[80px]">{order.customerName}</span>
                              </div>
                              <div className="flex items-center opacity-80 font-medium">
                                <Package size={10} className="mr-1 shrink-0" />
                                <span className="truncate">{order.items[0]?.name || '상품'}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* 팝업 닫기용 배경 */}
      {popupDay !== null && (
        <div className="fixed inset-0 z-20" onClick={() => setPopupDay(null)} />
      )}
    </div>
  );
};

export default CalendarView;
