
import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Package } from 'lucide-react';
import { Order, OrderStatus } from '../types';

interface CalendarViewProps {
  orders: Order[];
  onUpdateDeliveryDate: (_id: string, _date: string) => void;
}

const CalendarView: React.FC<CalendarViewProps> = ({ orders, onUpdateDeliveryDate }) => {
  const [currentDate, setCurrentDate] = useState(new Date());

  const daysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const firstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];
  const totalDays = daysInMonth(currentDate);
  const offset = firstDayOfMonth(currentDate);
  
  const calendarDays = [];
  for (let i = 0; i < offset; i++) calendarDays.push(null);
  for (let i = 1; i <= totalDays; i++) calendarDays.push(i);

  const getOrdersForDay = (day: number) => {
    return orders.filter(order => {
      if (!order.deliveryDate) return false;
      const d = new Date(order.deliveryDate);
      return (
        d.getFullYear() === currentDate.getFullYear() &&
        d.getMonth() === currentDate.getMonth() &&
        d.getDate() === day
      );
    });
  };

  const handleDragStart = (e: React.DragEvent, orderId: string) => {
    e.dataTransfer.setData('orderId', orderId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, day: number) => {
    e.preventDefault();
    const orderId = e.dataTransfer.getData('orderId');
    const targetDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    onUpdateDeliveryDate(orderId, targetDate.toISOString());
  };

  const getStatusColor = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.PENDING: return 'bg-amber-100 text-amber-700 border-amber-200';
      case OrderStatus.PROCESSING: return 'bg-sky-100 text-sky-700 border-sky-200';
      case OrderStatus.SHIPPED: return 'bg-indigo-100 text-indigo-700 border-indigo-200';
      case OrderStatus.DISPATCHED: return 'bg-violet-100 text-violet-700 border-violet-200';
      case OrderStatus.DELIVERED: return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      default: return 'bg-slate-50 text-slate-500';
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[800px] mb-8 animate-in fade-in duration-500">
      <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center space-x-4">
          <h3 className="text-xl font-bold text-slate-900">
            {currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월
          </h3>
          <div className="flex items-center bg-white rounded-xl border border-slate-200 p-1">
            <button onClick={prevMonth} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500">
              <ChevronLeft size={20} />
            </button>
            <button onClick={nextMonth} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500">
              <ChevronRight size={20} />
            </button>
          </div>
          <button 
            onClick={() => setCurrentDate(new Date())}
            className="text-xs font-bold text-indigo-600 px-3 py-1.5 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            오늘
          </button>
        </div>
        
        <div className="hidden md:flex items-center space-x-4 text-[11px] font-bold text-slate-400">
          <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-amber-400 mr-1.5"></span>대기</div>
          <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-sky-400 mr-1.5"></span>작업</div>
          <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-indigo-400 mr-1.5"></span>완료</div>
          <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-violet-400 mr-1.5"></span>출고</div>
          <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-emerald-400 mr-1.5"></span>이력</div>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/30">
        {weekDays.map((day, idx) => (
          <div key={day} className={`p-4 text-center text-xs font-bold uppercase tracking-widest ${idx === 0 ? 'text-rose-500' : idx === 6 ? 'text-indigo-500' : 'text-slate-400'}`}>
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 flex-1">
        {calendarDays.map((day, idx) => {
          const isToday = day && 
            day === new Date().getDate() && 
            currentDate.getMonth() === new Date().getMonth() && 
            currentDate.getFullYear() === new Date().getFullYear();

          return (
            <div 
              key={idx} 
              onDragOver={handleDragOver}
              onDrop={(e) => day && handleDrop(e, day)}
              className={`min-h-[140px] p-2 border-r border-b border-slate-100 group transition-colors flex flex-col ${day ? 'hover:bg-indigo-50/20' : 'bg-slate-50/30'} ${idx % 7 === 6 ? 'border-r-0' : ''}`}
            >
              {day && (
                <>
                  <div className="flex justify-between items-center mb-2">
                    <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500'}`}>
                      {day}
                    </span>
                  </div>
                  
                  <div className="flex-1 space-y-1.5 overflow-y-auto no-scrollbar max-h-[100px]">
                    {getOrdersForDay(day).map(order => (
                      <div 
                        key={order.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, order.id)}
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
    </div>
  );
};

export default CalendarView;
