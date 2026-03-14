
import React, { useState, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Truck, 
  MapPin, 
  Package, 
  Clock,
  Building2
} from 'lucide-react';
import { Order, Client, OrderStatus } from '../types';
import { X, Save } from 'lucide-react';

interface DeliveryManagerProps {
  orders: Order[];
  clients: Client[];
  onUpdateDeliveryDate?: (_id: string, _date: string) => void;
}

const DeliveryManager: React.FC<DeliveryManagerProps> = ({ orders, clients, onUpdateDeliveryDate }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [newDate, setNewDate] = useState('');

  const handleOrderClick = (order: Order) => {
    setEditingOrder(order);
    setNewDate(order.deliveryDate.split('T')[0]);
  };

  const handleSaveDate = () => {
    if (editingOrder && onUpdateDeliveryDate) {
      onUpdateDeliveryDate(editingOrder.id, new Date(newDate).toISOString());
      setEditingOrder(null);
    }
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
      if (order.deliveryDate) {
        const date = order.deliveryDate.split('T')[0];
        if (!schedules[date]) schedules[date] = [];
        schedules[date].push(order);
      }
    });
    return schedules;
  }, [orders]);

  const hasWeekendOrders = useMemo(() => {
    return Object.keys(deliverySchedules).some(dateStr => {
      const d = new Date(dateStr + 'T00:00:00');
      const dow = d.getDay();
      return (dow === 0 || dow === 6) && d.getFullYear() === year && d.getMonth() === month;
    });
  }, [deliverySchedules, year, month]);

  const regionList = useMemo(() => ["서울/경기", "강원", "충청", "전라", "경상", "제주", "미지정"], []);

  // 시 단위 → 광역권 매핑
  const cityToRegion = (city: string): string => {
    if (!city) return "미지정";
    if (/서울|인천|경기|수원|성남|고양|용인|부천|안산|안양|남양주|화성|평택|의정부|시흥|파주|광명|김포|군포|광주|이천|양주|오산|구리|안성|포천|의왕|하남|여주|동두천|과천/.test(city)) return "서울/경기";
    if (/강원|춘천|원주|강릉|동해|태백|속초|삼척/.test(city)) return "강원";
    if (/충청|청주|충주|제천|천안|공주|보령|아산|서산|논산|계룡|당진|세종/.test(city)) return "충청";
    if (/전라|전주|군산|익산|정읍|남원|김제|목포|여수|순천|나주|광양|광주광역/.test(city)) return "전라";
    if (/경상|부산|대구|울산|포항|경주|김천|안동|구미|영주|영천|상주|문경|경산|창원|진주|통영|사천|김해|밀양|거제|양산/.test(city)) return "경상";
    if (/제주|서귀포/.test(city)) return "제주";
    return "미지정";
  };

  const ordersByRegion = useMemo(() => {
    const grouped: Record<string, { client: Client; orders: Order[] }[]> = {};
    regionList.forEach(r => { grouped[r] = []; });

    const activeOrders = orders.filter(o => o.status !== OrderStatus.DELIVERED);

    activeOrders.forEach(order => {
      const client = clients.find(c => c.id === order.clientId);
      const region = cityToRegion(client?.region || "");

      const existingClientEntry = grouped[region].find(e => e.client.id === order.clientId);
      if (existingClientEntry) {
        existingClientEntry.orders.push(order);
      } else if (client) {
        grouped[region].push({ client, orders: [order] });
      }
    });

    return grouped;
  }, [orders, clients, regionList]);

  const renderCalendar = () => {
    const totalDays = daysInMonth(year, month);
    const startDay = firstDayOfMonth(year, month);
    const days = [];

    const getStatusColor = (status: OrderStatus) => {
      switch (status) {
        case OrderStatus.PENDING: return 'bg-amber-100 text-amber-700 border-amber-200';
        case OrderStatus.PROCESSING: return 'bg-sky-100 text-sky-700 border-sky-200';
        case OrderStatus.SHIPPED: return 'bg-indigo-100 text-indigo-700 border-indigo-200';
        case OrderStatus.DISPATCHED: return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        case OrderStatus.DELIVERED: return 'bg-slate-100 text-slate-500 border-slate-200';
        default: return 'bg-slate-100 text-slate-600 border-slate-200';
      }
    };

    const renderDayCell = (day: number, dateStr: string) => {
      const dayOrders = deliverySchedules[dateStr] || [];
      const isToday = new Date().toISOString().split('T')[0] === dateStr;
      return (
        <div
          key={day}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, dateStr)}
          className={`h-32 border-b border-r border-slate-100 p-2 transition-all hover:bg-indigo-50/30 group relative ${isToday ? 'bg-indigo-50/20' : 'bg-white'}`}
        >
          <div className="flex justify-between items-start mb-1">
            <span className={`text-xs font-black w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 group-hover:text-indigo-600'}`}>
              {day}
            </span>
            {dayOrders.length > 0 && (
              <span className="text-[10px] font-black text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded-md">
                {dayOrders.length}건
              </span>
            )}
          </div>
          <div className="space-y-1 overflow-y-auto max-h-[88px]" style={{scrollbarWidth:'thin'}}>
            {dayOrders.map(order => {
              const progress = order.items.length > 0
                ? Math.round((order.items.filter(i => i.checked).length / order.items.length) * 100)
                : 0;
              return (
                <div
                  key={order.id}
                  onClick={() => handleOrderClick(order)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, order.id)}
                  className={`text-[9px] font-bold py-1 px-2 rounded-lg border flex justify-between items-center cursor-pointer hover:brightness-95 transition-all active:scale-95 ${getStatusColor(order.status)}`}
                >
                  <span className="flex-1 min-w-[32px] truncate">{order.customerName}</span>
                  <span className="ml-1 shrink-0 opacity-70">{progress}%</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    };

    if (hasWeekendOrders) {
      // 7-column full grid (Sun–Sat)
      for (let i = 0; i < startDay; i++) {
        days.push(<div key={`empty-${i}`} className="h-32 border-b border-r border-slate-100 bg-slate-50/30" />);
      }
      for (let day = 1; day <= totalDays; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        days.push(renderDayCell(day, dateStr));
      }
    } else {
      // 5-column Mon–Fri grid (weekends hidden)
      const mondayOffset = startDay === 0 || startDay === 6 ? 0 : startDay - 1;
      for (let i = 0; i < mondayOffset; i++) {
        days.push(<div key={`empty-${i}`} className="h-32 border-b border-r border-slate-100 bg-slate-50/30" />);
      }
      for (let day = 1; day <= totalDays; day++) {
        const dow = new Date(year, month, day).getDay();
        if (dow === 0 || dow === 6) continue;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        days.push(renderDayCell(day, dateStr));
      }
    }

    return days;
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight flex items-center">
            <Truck className="mr-3 text-indigo-600" size={32} />
            배송 관리
          </h2>
          <p className="text-slate-500 font-medium mt-1">배송 일정을 확인하고 지역별 주문 현황을 관리합니다.</p>
        </div>
      </div>

      {/* Calendar Section */}
      <div className="bg-white rounded-[40px] shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
        <div className="p-8 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center shadow-inner">
              <CalendarIcon size={24} />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-900">{year}년 {monthNames[month]}</h3>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">배송 일정 캘린더</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button onClick={prevMonth} className="p-3 hover:bg-slate-100 rounded-2xl text-slate-400 hover:text-indigo-600 transition-all">
              <ChevronLeft size={20} />
            </button>
            <button onClick={() => setCurrentDate(new Date())} className="px-5 py-2.5 text-xs font-black text-indigo-600 bg-indigo-50 rounded-xl hover:bg-indigo-100 transition-all">
              오늘
            </button>
            <button onClick={nextMonth} className="p-3 hover:bg-slate-100 rounded-2xl text-slate-400 hover:text-indigo-600 transition-all">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        <div className={`grid ${hasWeekendOrders ? 'grid-cols-7' : 'grid-cols-5'} bg-slate-50/50 border-b border-slate-100`}>
          {(hasWeekendOrders ? ["일", "월", "화", "수", "목", "금", "토"] : ["월", "화", "수", "목", "금"]).map(day => (
            <div key={day} className="py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {day}
            </div>
          ))}
        </div>
        <div className={`grid ${hasWeekendOrders ? 'grid-cols-7' : 'grid-cols-5'} border-l border-slate-100`}>
          {renderCalendar()}
        </div>
      </div>

      {/* Region Based Section */}
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
            <MapPin size={20} />
          </div>
          <div>
            <h3 className="text-xl font-black text-slate-900">지역별 주문 현황</h3>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">현재 진행 중인 주문 (배송 완료 제외)</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {regionList.map(region => {
            const regionData = ordersByRegion[region];
            if (regionData.length === 0) return null;

            return (
              <div key={region} className="bg-white rounded-[32px] border border-slate-100 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col">
                <div className="p-6 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-indigo-600 shadow-sm">
                      <MapPin size={16} />
                    </div>
                    <span className="font-black text-slate-900">{region}</span>
                  </div>
                  <span className="text-[10px] font-black text-slate-400 bg-white px-2 py-1 rounded-full border border-slate-100">
                    {regionData.length}개 거래처
                  </span>
                </div>
                <div className="p-4 space-y-3 flex-1 overflow-y-auto max-h-[400px] custom-scrollbar">
                  {regionData.map(({ client, orders }) => (
                    <div key={client.id} className="p-4 bg-white border border-slate-100 rounded-2xl hover:border-indigo-200 transition-all group">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center">
                            <Building2 size={16} />
                          </div>
                          <span className="text-sm font-bold text-slate-800">{client.name}</span>
                        </div>
                        <span className="text-[10px] font-black text-indigo-600">
                          {orders.length}건 주문
                        </span>
                      </div>
                      <div className="space-y-2">
                        {orders.map(order => {
                          const progress = order.items.length > 0 
                            ? Math.round((order.items.filter(i => i.checked).length / order.items.length) * 100) 
                            : 0;
                          return (
                            <div 
                              key={order.id} 
                              onClick={() => handleOrderClick(order)}
                              draggable
                              onDragStart={(e) => handleDragStart(e, order.id)}
                              className="flex flex-col space-y-1 p-3 bg-slate-50 rounded-xl border border-slate-100 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-all active:scale-95"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-slate-700 truncate">{order.customerName}</span>
                                <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-md">{progress}%</span>
                              </div>
                              <div className="flex items-center justify-between text-[10px]">
                                <div className="flex items-center space-x-2">
                                  <Clock size={10} className="text-slate-400" />
                                  <span className="text-slate-500 font-medium">배송일: {order.deliveryDate.split('T')[0]}</span>
                                </div>
                                <span className={`font-black text-[9px] ${
                                  order.status === OrderStatus.PENDING ? 'text-amber-500' :
                                  order.status === OrderStatus.PROCESSING ? 'text-indigo-500' :
                                  'text-emerald-500'
                                }`}>
                                  {order.status === OrderStatus.PENDING ? '대기중' :
                                   order.status === OrderStatus.PROCESSING ? '작업중' :
                                   order.status === OrderStatus.DISPATCHED ? '작업완료' :
                                   order.status === OrderStatus.SHIPPED ? '출고' : '완료'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        
        {Object.values(ordersByRegion).every(arr => arr.length === 0) && (
          <div className="bg-white rounded-[40px] border-2 border-dashed border-slate-100 py-20 flex flex-col items-center justify-center text-center">
            <Package size={48} className="text-slate-100 mb-4" />
            <p className="text-slate-400 font-bold">현재 진행 중인 배송 일정이 없습니다.</p>
          </div>
        )}
      </div>
      {/* Date Edit Modal */}
      {editingOrder && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
                  <CalendarIcon size={20} />
                </div>
                <h3 className="text-xl font-black text-slate-900">
                  {editingOrder.customerName}
                  <span className="text-slate-400 font-bold text-base ml-2">({editingOrder.deliveryDate.split('T')[0]})</span>
                </h3>
              </div>
              <button onClick={() => setEditingOrder(null)} className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-slate-600 transition-all">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">새 배송 날짜</label>
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>

              {editingOrder.items.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">주문 품목</p>
                  <div className="bg-slate-50 rounded-2xl border border-slate-100 divide-y divide-slate-100 overflow-hidden max-h-48 overflow-y-auto">
                    {editingOrder.items.map((item, idx) => (
                      <div key={idx} className={`flex items-center justify-between px-4 py-2.5 ${item.checked ? 'opacity-50' : ''}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${item.checked ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'}`}>
                            {item.checked && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </span>
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border shrink-0 ${
                            (item.labelType ?? '대기') === '대기' ? 'bg-red-50 border-red-200 text-red-600' :
                            item.labelType === '날인' ? 'bg-yellow-50 border-yellow-200 text-yellow-600' :
                            'bg-emerald-50 border-emerald-300 text-emerald-600'
                          }`}>{item.labelType ?? '대기'}</span>
                          <span className={`text-[11px] font-bold truncate ${item.checked ? 'line-through text-slate-400' : 'text-slate-700'}`}>{item.name}</span>
                        </div>
                        <span className="text-[11px] font-black text-indigo-600 shrink-0 ml-2">{item.quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex space-x-3">
              <button 
                onClick={() => setEditingOrder(null)}
                className="flex-1 py-4 bg-white text-slate-600 font-black rounded-2xl border border-slate-200 hover:bg-slate-100 transition-all"
              >
                취소
              </button>
              <button 
                onClick={handleSaveDate}
                className="flex-1 py-4 bg-indigo-600 text-white font-black rounded-2xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center space-x-2"
              >
                <Save size={18} />
                <span>변경사항 저장</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeliveryManager;
