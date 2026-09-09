
import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Package,
  Clock,
  Building2,
  CheckCircle2,
  Send,
  ListOrdered,
  Plus,
  ChevronDown,
  Square,
  CheckSquare
} from 'lucide-react';
import { Order, Partner, OrderStatus, Item } from '../types';
import { statusText, statusLabel } from '../src/shared/orderStatusStyle';
import { cardNoLabel } from '../src/shared/cardNo';
import { orderItemQuantityLabel } from '../src/shared/orderUnits';
import { specText, splitNameVolume } from '../src/shared/productChip';
import { X, Save } from 'lucide-react';
import { subscribeToDocument, setDocument } from '../src/shared/services/firebaseService';
import { OrderCard } from './OrdersList';
import PageHeader from './PageHeader';
import DeliveryDayList from './DeliveryDayList';
import {
  planFor, withPlan, dayRows, bySlot, 정한이, toggleDone, stamp, withGroup, ungroup,
  mergeReorderedSubset, removeOrderFromPlan,
  type DeliveryPlanDoc, type DayPlan,
} from '../src/shared/deliveryPlan';

import { OrderItem } from '../types';

interface DeliveryManagerProps {
  orders: Order[];
  partners: Partner[];
  items: Item[];
  onUpdateDeliveryDate?: (_id: string, _date: string) => void;
  onUpdateStatus?: (_id: string, _status: OrderStatus) => void;
  onUpdateItems?: (_id: string, _items: OrderItem[]) => void;
  onToggleItemChecked?: (_orderId: string, _itemIdx: number) => void;
  onDeleteOrder?: (_id: string) => void;
  /** 배송 순서를 누가 정했는지 남길 이름 — 없으면 '자동' 으로만 뜬다 */
  currentUserName?: string;
}

const DeliveryManager: React.FC<DeliveryManagerProps> = ({ orders, partners, items, onUpdateDeliveryDate, onUpdateStatus, onUpdateItems, onToggleItemChecked, onDeleteOrder, currentUserName }) => {
  // Compute derived variables
  const products = items;
  const [currentDate, setCurrentDate] = useState(new Date());
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [newDate, setNewDate] = useState('');
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [showAddProductSelect, setShowAddProductSelect] = useState<string | null>(null);
  /**
   * **배송 계획 — 날짜별.** 셈은 [shared/deliveryPlan](../src/shared/deliveryPlan.ts) 한 곳이 안다.
   * 전에는 날짜 없는 목록 하나였다(`{ordering, timeSlots}`) — 그래서 오늘 칸만 순서가 붙었다.
   * 옛 모양은 읽을 때 오늘 것으로 물러서고, 한 번 손대면 그때 byDate 로 옮겨진다.
   */
  const [planDoc, setPlanDoc] = useState<DeliveryPlanDoc>({});
  /** 묶으려고 고른 것들 — 날짜별. 두 개 이상 골라야 묶을 수 있다. */
  const [groupPick, setGroupPick] = useState<{ date: string; ids: string[] }>({ date: '', ids: [] });

  // 로컬 날짜 문자열 (타임존 버그 방지)
  const toLocalDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    return subscribeToDocument<DeliveryPlanDoc>('settings', 'deliveryOrdering', (data) => setPlanDoc(data ?? {}));
  }, []);

  const todayStr = toLocalDateStr(new Date());
  /** 그 날짜 계획 */
  const planOf = (dateStr: string): DayPlan => planFor(planDoc, dateStr, todayStr);
  /**
   * 그 날짜 계획을 저장한다. **사람이 손댄 것이므로 이름·시각 도장을 찍는다** —
   * 그때부터 화면에 '자동' 대신 '임영훈 · 9/9 14:30' 이 뜬다.
   */
  const savePlan = (dateStr: string, next: DayPlan) => {
    const 도장 = currentUserName ? { by: stamp(currentUserName) } : {};
    const doc = withPlan(planDoc, dateStr, { ...next, ...도장 });
    setPlanDoc(doc);
    setDocument('settings', 'deliveryOrdering', doc);
  };
  /** 그 날짜에 보일 줄들 — 손으로 정한 차례가 먼저, 캘린더에서 온 게 뒤 */
  const rowsOf = (dateStr: string) => dayRows({ plan: planOf(dateStr), orders, dateStr });

  /** 하루치 카드에 물릴 손잡이들 — 캘린더 칸·판·상세창이 모두 이걸 쓴다 */
  const handlersFor = (dateStr: string) => ({
    // 주문번호는 배송일과 주문 품목을 함께 확인·수정하는 기존 창을 연다.
    open: (o: Order) => {
      setEditingOrder(o);
      setNewDate(o.deliveryDate.split('T')[0]);
    },
    toggleDone: (id: string) => savePlan(dateStr, toggleDone(planOf(dateStr), id)),
    toggleSlot: (id: string) => {
      const p = planOf(dateStr);
      savePlan(dateStr, { ...p, timeSlots: { ...p.timeSlots, [id]: p.timeSlots?.[id] === '오후' ? '오전' : '오후' } });
    },
    // 오전·오후 중 한 목록에서 받은 순서를 하루 전체 순서에 다시 끼운다.
    // 일부 목록을 그대로 저장하면 반대 시간대 주문이 수동 순서표에서 빠진다.
    reorder: (next: string[]) => savePlan(dateStr, {
      ...planOf(dateStr),
      ordering: mergeReorderedSubset(rowsOf(dateStr).map(r => r.orderId), next),
    }),
    select: (id: string) => toggleGroupPick(dateStr, id),
  });

  /**
   * 묶기 고르기. **이미 묶여 있는 걸 누르면 그 자리에서 푼다** — 풀려고 두 번 누를 일이 없다.
   * 날짜가 바뀌면 앞 날짜에서 고른 건 버린다(다른 날 것을 한 차에 실을 수 없다).
   */
  const toggleGroupPick = (dateStr: string, id: string) => {
    const plan = planOf(dateStr);
    if ((plan.groups ?? []).some(g => g.orderIds.includes(id))) { savePlan(dateStr, ungroup(plan, id)); return; }
    setGroupPick(prev => {
      const ids = prev.date === dateStr ? prev.ids : [];
      return { date: dateStr, ids: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] };
    });
  };

  const confirmGroup = (dateStr: string) => {
    if (groupPick.date !== dateStr || groupPick.ids.length < 2) return;
    savePlan(dateStr, withGroup(planOf(dateStr), groupPick.ids));
    setGroupPick({ date: '', ids: [] });
  };
  const [showDeliveryPicker, setShowDeliveryPicker] = useState(false);
  const [pickerDeliveryOrdering, setPickerDeliveryOrdering] = useState<string[]>([]);
  const [deliveryTab, setDeliveryTab] = useState<'배송일정관리' | '배송캘린더'>('배송일정관리');
  const [calendarView, setCalendarView] = useState<'주간' | '월간'>('주간');
  const [currentWeekDate, setCurrentWeekDate] = useState(new Date());
  const [mobileCollapsed, setMobileCollapsed] = useState<Set<string>>(new Set());
  const toggleMobileCollapse = (id: string) => setMobileCollapsed(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const [selectedDispatchedIds, setSelectedDispatchedIds] = useState<Set<string>>(new Set());
  const toggleDispatchedSelect = (id: string) => setSelectedDispatchedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const handleBulkShip = () => { selectedDispatchedIds.forEach(id => onUpdateStatus?.(id, OrderStatus.SHIPPED)); setSelectedDispatchedIds(new Set()); };
  const [expandedDeliveredDates, setExpandedDeliveredDates] = useState<Set<string>>(new Set());
  const toggleDeliveredDate = (dateStr: string) => setExpandedDeliveredDates(prev => { const next = new Set(prev); next.has(dateStr) ? next.delete(dateStr) : next.add(dateStr); return next; });

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
    const sourceDate = orders.find(o => o.id === orderId)?.deliveryDate?.split('T')[0];
    if (sourceDate) e.dataTransfer.setData('deliverySourceDate', sourceDate);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    const orderId = e.dataTransfer.getData('orderId');
    if (orderId && onUpdateDeliveryDate) {
      const sourceDate = e.dataTransfer.getData('deliverySourceDate');
      if (sourceDate && sourceDate !== dateStr) {
        // 날짜만 바꾸면 옛 ordering 때문에 원래 날짜에도 계속 보인다.
        savePlan(sourceDate, removeOrderFromPlan(planOf(sourceDate), orderId));
      }
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
    const grouped: Record<string, { partner: Partner; orders: Order[] }[]> = {};
    regionList.forEach(r => { grouped[r] = []; });

    const activeOrders = orders.filter(o => o.status !== OrderStatus.DELIVERED);

    activeOrders.forEach(order => {
      const partner = partners.find(c => c.id === order.partnerId);
      const region = cityToRegion(partner?.region || "");

      const existingClientEntry = grouped[region].find(e => e.partner.id === order.partnerId);
      if (existingClientEntry) {
        existingClientEntry.orders.push(order);
      } else if (partner) {
        grouped[region].push({ partner, orders: [order] });
      }
    });

    return grouped;
  }, [orders, partners, regionList]);

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

  const hasWeekendOrdersInWeek = weekDays.some(d => {
    const dateStr = toLocalDateStr(d);
    const dow = d.getDay();
    return (dow === 0 || dow === 6) && (deliverySchedules[dateStr]?.length > 0 || deliveredSchedules[dateStr]?.length > 0);
  });

  const visibleWeekDays = hasWeekendOrdersInWeek ? weekDays : weekDays.filter(d => d.getDay() !== 0 && d.getDay() !== 6);
  const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];

  const prevWeek = () => setCurrentWeekDate(prev => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d; });
  const nextWeek = () => setCurrentWeekDate(prev => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d; });

  const weekLabel = (() => {
    const endDate = visibleWeekDays[visibleWeekDays.length - 1];
    const sM = weekStart.getMonth() + 1;
    const sD = weekStart.getDate();
    const eM = endDate.getMonth() + 1;
    const eD = endDate.getDate();
    const yr = weekStart.getFullYear();
    return sM === eM ? `${yr}년 ${sM}월 ${sD}일 – ${eD}일` : `${yr}년 ${sM}월 ${sD}일 – ${eM}월 ${eD}일`;
  })();

  /**
   * **폰에서는 날짜를 눌러 창으로 본다**(2026-09-06 사장님: "날짜 눌러서 상세보기 창
   * 뜨게 만들어").
   *
   * 한 주가 7칸이라 폰에서는 칸 하나가 50px 밖에 안 된다. 거기 요일·날짜·건수 배지·
   * 거래처 칩을 다 넣으니 **글자가 한 글자씩 세로로 쪼개지고** 이름이 잘렸다.
   * 좁은 화면에서는 칸에 날짜와 건수만 두고, 목록은 창으로 띄운다.
   * 넓은 화면은 그대로 — 칸 안에서 끌어다 옮기는 게 되어야 한다.
   */
  const [dayModal, setDayModal] = useState<string | null>(null);

  const renderWeekCalendar = () => {
    /*
     *  **모든 날에 순서·오전오후가 붙는다**(2026-09-09 사장님:
     *  "캘린더에서 당일에만 순서가 붙고 다른 날짜는 순서가 없잖아 오전 오후도 없고").
     *
     *  전에는 오늘 칸만 번호가 붙는 특별한 가지였고 나머지 날은 밋밋한 목록이었다.
     *  줄 만드는 셈은 [deliveryPlan](../src/shared/deliveryPlan.ts), 그리는 건
     *  [DeliveryDayList](./DeliveryDayList.tsx) 한 벌이다 — 오늘도 남의 날도 같은 카드다.
     */
    return visibleWeekDays.map(d => {
      const dateStr = toLocalDateStr(d);
      const deliveredOrders = deliveredSchedules[dateStr] || [];
      const isToday = todayStr === dateStr;
      const rows = rowsOf(dateStr);
      const { 오전, 오후 } = bySlot(rows);
      const plan = planOf(dateStr);

      return (
        <div
          key={dateStr}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, dateStr)}
          className={`border-r border-slate-100 p-1.5 sm:p-3 flex flex-col relative group ${
            isToday ? 'bg-indigo-50/30' : 'bg-white hover:bg-indigo-50/20'}`}
          style={{ minHeight: 200 }}
        >
          <button type="button" onClick={() => setDayModal(dateStr)}
            className="sm:hidden absolute inset-0 z-10" aria-label={`${d.getDate()}일 배송 보기`} />

          {/* 날짜 오른쪽에 예전 주문과 현재 주문 건수를 한 줄로 붙인다. */}
          <div className="flex flex-col items-center gap-0.5 sm:flex-row sm:justify-between sm:items-start mb-2 flex-shrink-0">
            <div className="flex flex-col items-center sm:items-start">
              <span className="text-[10px] font-black text-slate-400 uppercase">{dayLabels[d.getDay()]}</span>
              <span className={`text-base sm:text-lg font-black w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-full ${isToday ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-700 group-hover:text-indigo-600'}`}>
                {d.getDate()}
              </span>
            </div>
            <div className="flex items-center justify-center sm:justify-end gap-1">
              {deliveredOrders.length > 0 && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); toggleDeliveredDate(dateStr); }}
                  className="relative z-20 inline-flex items-center gap-0.5 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded-md whitespace-nowrap"
                >
                  {deliveredOrders.length}건
                  <ChevronDown size={11} className={`transition-transform ${expandedDeliveredDates.has(dateStr) ? 'rotate-180' : ''}`} />
                </button>
              )}
              {rows.length > 0 && (
                <span className="text-[10px] font-black text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                  {rows.length}건
                </span>
              )}
            </div>
          </div>

          <div className="hidden sm:flex flex-1 flex-col gap-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            {rows.length === 0 ? (
              <p className="text-center text-[10px] text-slate-300 font-bold py-4">배송 없음</p>
            ) : (
              <>
                {/*  누가 정했나 — 아무도 안 건드린 날은 '자동' */}
                <span className="text-[8px] font-black text-slate-300 px-0.5 truncate">{정한이(plan)}</span>
                {오전.length > 0 && <span className="text-[9px] font-black text-amber-500 px-1">오전</span>}
                {오전.length > 0 && (
                  <DeliveryDayList rows={오전} orders={orders} partners={partners} compact
                    dateStr={dateStr} on={handlersFor(dateStr)} selected={groupPick.date === dateStr ? new Set(groupPick.ids) : undefined} />
                )}
                {오후.length > 0 && <span className="text-[9px] font-black text-indigo-500 px-1 pt-1">오후</span>}
                {오후.length > 0 && (
                  <DeliveryDayList rows={오후} orders={orders} partners={partners} compact
                    dateStr={dateStr} positionOffset={오전.length} on={handlersFor(dateStr)} selected={groupPick.date === dateStr ? new Set(groupPick.ids) : undefined} />
                )}
                {groupPick.date === dateStr && groupPick.ids.length >= 2 && (
                  <button onClick={() => confirmGroup(dateStr)}
                    className="mt-1 text-[9px] font-black text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg py-1 transition-colors">
                    {groupPick.ids.length}건 묶기
                  </button>
                )}
              </>
            )}
            {expandedDeliveredDates.has(dateStr) && deliveredOrders.length > 0 && (
              <div className="mt-1 pt-1 border-t border-slate-100 space-y-1">
                <p className="px-1 text-[10px] font-black text-slate-400">예전 주문</p>
                {deliveredOrders.map(order => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => handleOrderClick(order)}
                    className="w-full text-left px-2 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-500"
                  >
                    <span className="block text-xs font-bold truncate">{order.partnerName}</span>
                    <span className="block text-[10px] font-black text-slate-400 whitespace-nowrap">{cardNoLabel(order)}</span>
                  </button>
                ))}
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

    const todayStr = toLocalDateStr(new Date());
    const renderDayCell = (day: number, dateStr: string) => {
      const dayOrders = deliverySchedules[dateStr] || [];
      const deliveredOrders = deliveredSchedules[dateStr] || [];
      const isToday = todayStr === dateStr;
      const isPast = dateStr < todayStr;
      const compact = isPast && dayOrders.length === 0 && deliveredOrders.length === 0;
      const showDelivered = expandedDeliveredDates.has(dateStr);
      return (
        <div
          key={day}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, dateStr)}
          className={`border-b border-r border-slate-100 p-1.5 sm:p-2 transition-all hover:bg-indigo-50/30 group relative ${isToday ? 'bg-indigo-50/20' : compact ? 'bg-slate-50/40' : 'bg-white'}`}
          style={{ minHeight: compact ? 36 : 110 }}
        >
          {/*  폰에서는 칸을 통째로 누르면 그날 상세가 창으로 뜬다 — 칸이 50px 라
               목록을 넣으면 글자가 세로로 쪼개진다. 넓은 화면에서는 안 덮는다(끌어 옮기기). */}
          <button type="button" onClick={() => setDayModal(dateStr)}
            className="sm:hidden absolute inset-0 z-10" aria-label={`${day}일 배송 보기`} />
          {/*  **날짜는 왼쪽 위**(2026-09-09 사장님: "날짜가 너무 한 가운데 있다").
               가운데 두니 달력이 아니라 표처럼 읽혔다. 종이 달력처럼 왼쪽 위에 붙인다.

               **날짜 옆에는 예전 주문, 활성 주문은 한 줄 밑**(사장님).
               지금 할 일(활성)이 눈에 먼저 들어와야 하는데, 옆에 나란히 두니 지나간 것과
               섞여 어느 게 오늘 할 일인지 안 갈렸다. */}
          <div className="flex items-center gap-1">
            <span className={`text-xs font-black w-6 h-6 flex items-center justify-center rounded-full shrink-0 ${isToday ? 'bg-indigo-600 text-white shadow-md' : compact ? 'text-slate-300' : 'text-slate-500 group-hover:text-indigo-600'}`}>
              {day}
            </span>
            {/*  예전 주문 — 지나간 것이라 옅게. 넓은 화면에서는 눌러서 펼친다. */}
            {deliveredOrders.length > 0 && (
              <button
                onClick={e => { e.stopPropagation(); toggleDeliveredDate(dateStr); }}
                className="inline-flex items-center gap-0.5 text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded-md transition-all whitespace-nowrap shrink-0"
              >
                {deliveredOrders.length}건
                <ChevronDown size={10} className={`transition-transform ${showDelivered ? 'rotate-180' : ''}`} />
              </button>
            )}
            {dayOrders.length > 0 && (
              <span className="text-[10px] font-black text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                {dayOrders.length}건
              </span>
            )}
          </div>
          {/*  **주간과 같은 카드다**(2026-09-09 사장님: "금일만 다는게 아니라 캘린더 쪽에도").
               월간만 옛 카드로 남아 상태 색은 있어도 글자가 없었고, 순서·오전오후·체크·묶음도
               없었다. [DeliveryDayList](./DeliveryDayList.tsx) 한 벌로 맞춘다. */}
          {(() => {
            const rows = rowsOf(dateStr);
            if (rows.length === 0) return null;
            const { 오전, 오후 } = bySlot(rows);
            const on = handlersFor(dateStr);
            const picked = groupPick.date === dateStr ? new Set(groupPick.ids) : undefined;
            return (
              <div className="hidden sm:block mt-1 space-y-0.5 overflow-y-auto" style={{ maxHeight: 130, scrollbarWidth: 'thin' }}>
                {오전.length > 0 && <span className="block text-[8px] font-black text-amber-500 px-0.5">오전</span>}
                {오전.length > 0 && (
                  <DeliveryDayList rows={오전} orders={orders} partners={partners} compact dateStr={dateStr} on={on} selected={picked} />
                )}
                {오후.length > 0 && <span className="block text-[8px] font-black text-indigo-500 px-0.5 pt-0.5">오후</span>}
                {오후.length > 0 && (
                  <DeliveryDayList rows={오후} orders={orders} partners={partners} compact dateStr={dateStr} positionOffset={오전.length} on={on} selected={picked} />
                )}
                {picked && picked.size >= 2 && (
                  <button onClick={e => { e.stopPropagation(); confirmGroup(dateStr); }}
                    className="w-full mt-0.5 text-[8px] font-black text-white bg-indigo-500 hover:bg-indigo-600 rounded py-0.5">
                    {picked.size}건 묶기
                  </button>
                )}
              </div>
            );
          })()}
          {showDelivered && deliveredOrders.length > 0 && (
            <div className="hidden sm:block mt-1 space-y-1 overflow-y-auto border-t border-slate-100 pt-1" style={{ maxHeight: 80, scrollbarWidth: 'thin' }}>
              {deliveredOrders.map(order => (
                <div
                  key={order.id}
                  onClick={() => handleOrderClick(order)}
                  className="text-[9px] font-bold py-1 px-2 rounded-lg border flex justify-between items-center cursor-pointer bg-slate-50 border-slate-200 text-slate-400 hover:brightness-95 transition-all"
                >
                  <span className="flex-1 min-w-[32px] truncate">{order.partnerName}</span>
                  <span className="ml-1 shrink-0">완료</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    };

    if (hasWeekendOrders) {
      // 7-column full grid (Sun–Sat)
      for (let i = 0; i < startDay; i++) {
        days.push(<div key={`empty-${i}`} className="border-b border-r border-slate-100 bg-slate-50/30" />);
      }
      for (let day = 1; day <= totalDays; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        days.push(renderDayCell(day, dateStr));
      }
    } else {
      // 5-column Mon–Fri grid (weekends hidden)
      const mondayOffset = startDay === 0 || startDay === 6 ? 0 : startDay - 1;
      for (let i = 0; i < mondayOffset; i++) {
        days.push(<div key={`empty-${i}`} className="border-b border-r border-slate-100 bg-slate-50/30" />);
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
    <div className="space-y-5 animate-in fade-in duration-300">
      <PageHeader
        title="배송 관리"
        subtitle="배송 일정을 확인하고 지역별 주문 현황을 관리합니다."
        right={
          <div className="flex bg-slate-100 p-1 rounded-2xl items-center">
            {(['배송일정관리', '배송캘린더'] as const).map(tab => (
              <button key={tab} onClick={() => setDeliveryTab(tab)}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap ${deliveryTab === tab ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >{tab}</button>
            ))}
          </div>
        }
      />

      {/* 작업완료 / 보류 / 출고 컬럼 */}
      {deliveryTab === '배송일정관리' && (() => {
        const dispatchedOrders = orders
          .filter(o => o.status === OrderStatus.DISPATCHED && o.partnerName !== '생산기록')
          .sort((a, b) => (a.deliveryDate || '').localeCompare(b.deliveryDate || ''));
        const onHoldOrders = orders.filter(o => o.status === OrderStatus.ON_HOLD && o.partnerName !== '생산기록');
        const shippedOrders = orders.filter(o => o.status === OrderStatus.SHIPPED && o.partnerName !== '생산기록');
        /*  **오늘 판은 캘린더 오늘 칸과 같은 것을 본다**(2026-09-09 사장님:
         *  "금일 배송일정이 배송 캘린더의 당일에 해당하는 주문 목록을 받아오도록").
         *  전에는 판은 손으로 고른 목록만, 캘린더는 납품일 목록을 봐서 둘이 달랐다. */
        const todayRows = rowsOf(todayStr);
        const todayPlan = planOf(todayStr);
        const { 오전: morningRows, 오후: afternoonRows } = bySlot(todayRows);
        const todayOn = handlersFor(todayStr);
        const todayPicked = groupPick.date === todayStr ? new Set(groupPick.ids) : undefined;

        return (
          <div className="md:overflow-x-auto no-scrollbar">
            <div className="flex flex-col md:flex-row md:min-w-max gap-4 pb-1 md:items-start">

              {/* 금일 배송순서 패널 — 캘린더 오늘 칸과 같은 줄을 본다 */}
              <div className="w-full md:w-64 md:shrink-0 flex flex-col rounded-3xl border border-pink-100 bg-white shadow-sm">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <button className="flex items-center gap-2 md:cursor-default" onClick={() => { if (window.innerWidth < 768) toggleMobileCollapse('delivery-order'); }}>
                    <div className="p-1.5 rounded-xl bg-pink-500 text-white"><ListOrdered size={16} /></div>
                    <div className="text-left">
                      <h3 className="font-black text-sm text-pink-700">금일 배송순서</h3>
                      {/*  아무도 안 건드린 날은 '자동' — 누가 정했는지 물어볼 데가 있어야 한다 */}
                      <p className="text-[9px] font-bold text-slate-400">{정한이(todayPlan)}</p>
                    </div>
                    <ChevronDown size={14} className={`md:hidden text-pink-400 transition-transform ${mobileCollapsed.has('delivery-order') ? '' : 'rotate-180'}`} />
                  </button>
                  <button
                    onClick={() => { setPickerDeliveryOrdering(todayRows.map(r => r.orderId)); setShowDeliveryPicker(true); }}
                    className="flex items-center gap-1 text-[10px] font-black text-pink-600 bg-pink-100 hover:bg-pink-200 px-2.5 py-1.5 rounded-lg transition-all"
                  >
                    <Plus size={11} /> 추가
                  </button>
                </div>
                <div className={`p-3 flex flex-col gap-1.5 min-h-[80px] ${mobileCollapsed.has('delivery-order') ? 'hidden md:flex' : ''}`}>
                  {todayRows.length === 0 ? (
                    <p className="text-center text-[11px] text-slate-300 py-6 font-bold">오늘 배송이 없습니다</p>
                  ) : (
                    <>
                      <span className="text-[9px] font-black text-amber-500 px-1">오전</span>
                      {morningRows.length === 0
                        ? <p className="text-[10px] text-slate-300 text-center py-1 font-bold">없음</p>
                        : <DeliveryDayList rows={morningRows} orders={orders} partners={partners} dateStr={todayStr} on={todayOn} selected={todayPicked} />}
                      <span className="text-[9px] font-black text-indigo-500 px-1 pt-1">오후</span>
                      {afternoonRows.length === 0
                        ? <p className="text-[10px] text-slate-300 text-center py-1 font-bold">없음</p>
                        : <DeliveryDayList rows={afternoonRows} orders={orders} partners={partners} dateStr={todayStr} positionOffset={morningRows.length} on={todayOn} selected={todayPicked} />}
                      {todayPicked && todayPicked.size >= 2 && (
                        <button onClick={() => confirmGroup(todayStr)}
                          className="mt-1 text-[10px] font-black text-white bg-indigo-500 hover:bg-indigo-600 rounded-xl py-2 transition-colors">
                          고른 {todayPicked.size}건 한 차로 묶기
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 작업완료 컬럼 (2열) */}
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('orderId'); if (id) onUpdateStatus?.(id, OrderStatus.DISPATCHED); }}
                className="flex flex-col rounded-3xl border border-emerald-100 bg-emerald-50/50 shadow-sm w-full md:w-72 md:shrink-0"
              >
                <div className="p-4 border-b border-white/50 flex items-center gap-3">
                  <button className="flex items-center gap-3 md:cursor-default" onClick={() => { if (window.innerWidth < 768) toggleMobileCollapse('dispatched'); }}>
                    <div className="p-2 rounded-xl bg-emerald-500 text-white"><CheckCircle2 size={20} /></div>
                    <h3 className="font-black text-base text-emerald-700">작업완료 ({dispatchedOrders.length})</h3>
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
                            order={order}
                            partners={partners}
                            items={products}
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
                    <h3 className="font-black text-sm text-indigo-700">출고 ({shippedOrders.length})</h3>
                    <ChevronDown size={14} className={`md:hidden text-indigo-400 transition-transform ${mobileCollapsed.has('shipped') ? '' : 'rotate-180'}`} />
                  </button>
                </div>
                <div className={`p-4 grid grid-cols-1 gap-3 overflow-y-auto no-scrollbar ${mobileCollapsed.has('shipped') ? 'hidden md:grid' : ''}`}>
                  {shippedOrders.length === 0 ? (
                    <p className="col-span-1 text-center text-[11px] text-slate-300 font-bold py-10">주문이 없습니다</p>
                  ) : shippedOrders.map(order => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      partners={partners}
                      items={products}
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
                      key={order.id}
                      order={order}
                      partners={partners}
                      items={products}
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

            {/* 배송순서 설정 모달 */}
            {showDeliveryPicker && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowDeliveryPicker(false)}>
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm mx-4 flex flex-col max-h-[70vh] animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <h3 className="font-black text-slate-900">배송순서 설정</h3>
                    <button onClick={() => setShowDeliveryPicker(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"><X size={16} /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {dispatchedOrders.length === 0 ? (
                      <p className="text-center text-sm text-slate-400 py-10">작업완료 주문이 없습니다.</p>
                    ) : dispatchedOrders.map(o => {
                      const partnerName = partners.find(c => c.id === o.partnerId)?.name || o.partnerName || '';
                      const isSelected = pickerDeliveryOrdering.includes(o.id);
                      const idx = pickerDeliveryOrdering.indexOf(o.id);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) setPickerDeliveryOrdering(pickerDeliveryOrdering.filter(x => x !== o.id));
                            else setPickerDeliveryOrdering([...pickerDeliveryOrdering, o.id]);
                          }}
                          className={`w-full flex items-center gap-3 px-5 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors text-left ${isSelected ? 'bg-teal-50' : ''}`}
                        >
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${isSelected ? 'bg-pink-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                            {isSelected ? idx + 1 : ''}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-700 truncate">{partnerName}</p>
                            <p className="text-[10px] text-slate-400 truncate">{o.items.map(i => i.name).join(', ')}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="p-4 border-t border-slate-100">
                    <button
                      onClick={() => { savePlan(todayStr, { ...planOf(todayStr), ordering: pickerDeliveryOrdering }); setShowDeliveryPicker(false); }}
                      className="w-full bg-pink-500 text-white font-black py-3 rounded-2xl hover:bg-pink-600 transition-all"
                    >확인</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Calendar (Weekly / Monthly toggle) */}
      {deliveryTab === '배송캘린더' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {/*  공통 헤더 — 뷰 토글 + 내비게이션.
               **폰에서는 두 줄로 쌓는다**(2026-09-09 사장님: "상단이 너무 답답하고").
               한 줄에 다 넣으니 폭이 모자라 글자가 한 자씩 쪼개졌다 — `2026 / 년 9월`,
               `주 / 간`, `오 / 늘`. 아이콘과 부제는 폰에서 뺀다(위에 '배송 관리'가 이미 있다). */}
          <div className="p-3 sm:p-5 border-b border-slate-100 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className={`hidden sm:flex w-9 h-9 rounded-xl items-center justify-center shadow-inner ${calendarView === '주간' ? 'bg-violet-100 text-violet-600' : 'bg-indigo-100 text-indigo-600'}`}>
                <CalendarIcon size={18} />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 whitespace-nowrap">
                  {calendarView === '주간' ? weekLabel : `${year}년 ${monthNames[month]}`}
                </h3>
                <p className="hidden sm:block text-[10px] text-slate-400 font-bold uppercase tracking-widest">배송 캘린더</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 [&_button]:whitespace-nowrap">
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

          {/* 주간 뷰 */}
          {calendarView === '주간' && (
            <div className="grid border-l border-slate-100" style={{ gridTemplateColumns: `repeat(${visibleWeekDays.length}, minmax(0, 1fr))` }}>
              {renderWeekCalendar()}
            </div>
          )}

          {/* 월간 뷰 */}
          {calendarView === '월간' && <>
            <div className={`grid ${hasWeekendOrders ? 'grid-cols-7' : 'grid-cols-5'} bg-slate-50/50 border-b border-slate-100`}>
              {(hasWeekendOrders ? ["일", "월", "화", "수", "목", "금", "토"] : ["월", "화", "수", "목", "금"]).map(day => (
                <div key={day} className="py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">{day}</div>
              ))}
            </div>
            <div className={`grid ${hasWeekendOrders ? 'grid-cols-7' : 'grid-cols-5'} border-l border-slate-100`}>
              {renderCalendar()}
            </div>
          </>}
        </div>
      )}

      {/*  **하루 상세 창** — 폰에서 날짜를 누르면 뜬다(2026-09-06 사장님).
           칸이 좁아 목록을 못 넣으니 여기서 다 보여준다. 주문을 누르면 원래 상세로 넘어간다. */}
      {dayModal && (() => {
        const 완료 = deliveredSchedules[dayModal] || [];
        const d = new Date(dayModal + 'T00:00:00');
        const 제목 = `${d.getMonth() + 1}월 ${d.getDate()}일 (${dayLabels[d.getDay()]})`;
        //  **여기도 같은 카드다** — 순서·오전오후·체크·묶음이 캘린더 칸과 똑같이 보인다
        const rows = rowsOf(dayModal);
        const { 오전, 오후 } = bySlot(rows);
        const on = handlersFor(dayModal);
        const picked = groupPick.date === dayModal ? new Set(groupPick.ids) : undefined;
        return (
          <div className="fixed inset-0 z-[1200] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setDayModal(null)} />
            <div className="relative bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[80vh] flex flex-col">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-base font-black text-slate-900">{제목}</h3>
                  <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                    배송 {rows.length}건{완료.length > 0 && ` · 이전 ${완료.length}건`} · {정한이(planOf(dayModal))}
                  </p>
                </div>
                <button onClick={() => setDayModal(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {rows.length === 0 && 완료.length === 0 && (
                  <p className="py-12 text-center text-sm font-bold text-slate-300">이 날은 배송이 없습니다.</p>
                )}
                {오전.length > 0 && <p className="text-[10px] font-black text-amber-500 px-1">오전</p>}
                {오전.length > 0 && <DeliveryDayList rows={오전} orders={orders} partners={partners} dateStr={dayModal} on={on} selected={picked} />}
                {오후.length > 0 && <p className="text-[10px] font-black text-indigo-500 px-1 pt-2">오후</p>}
                {오후.length > 0 && <DeliveryDayList rows={오후} orders={orders} partners={partners} dateStr={dayModal} positionOffset={오전.length} on={on} selected={picked} />}
                {picked && picked.size >= 2 && (
                  <button onClick={() => confirmGroup(dayModal)}
                    className="w-full text-[11px] font-black text-white bg-indigo-500 hover:bg-indigo-600 rounded-xl py-2.5 transition-colors">
                    고른 {picked.size}건 한 차로 묶기
                  </button>
                )}
                {완료.length > 0 && (
                  <>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest pt-3 pb-1">이전 배송</p>
                    {완료.map(order => (
                      <button key={order.id} type="button"
                        onClick={() => { setDayModal(null); handleOrderClick(order); }}
                        className="w-full text-left text-xs font-bold py-2.5 px-3 rounded-xl border bg-slate-50 border-slate-200 text-slate-400 flex justify-between items-center gap-2">
                        <span className="flex-1 min-w-0 break-keep">{order.partnerName}</span>
                        <span className="shrink-0">완료</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {deliveryTab === '배송일정관리' && <div className="space-y-6">
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
              <div key={region} className="bg-white rounded-2xl border border-slate-200 hover:border-slate-300 transition-all overflow-hidden flex flex-col">
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
                  {regionData.map(({ partner, orders }) => (
                    <div key={partner.id} className="p-4 bg-white border border-slate-100 rounded-2xl hover:border-indigo-200 transition-all group">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center">
                            <Building2 size={16} />
                          </div>
                          <span className="text-sm font-bold text-slate-800">{partner.name}</span>
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
                                <span className="text-[11px] font-bold text-slate-700 truncate">{order.partnerName}</span>
                                <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-md">{progress}%</span>
                              </div>
                              <div className="flex items-center justify-between text-[10px]">
                                <div className="flex items-center space-x-2">
                                  <Clock size={10} className="text-slate-400" />
                                  <span className="text-slate-500 font-medium">배송일: {order.deliveryDate.split('T')[0]}</span>
                                </div>
                                {/*  글자색도 [shared/orderStatusStyle](../src/shared/orderStatusStyle) 이 정한다 —
                                     여기만 작업중이 **남색**이었다(다른 데선 하늘색, 2026-09-06) */}
                                <span className={`font-black text-[9px] ${statusText(order.status)}`}>
                                  {statusLabel(order.status)}
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
      </div>}

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
                  {editingOrder.partnerName}
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
                    {editingOrder.items.map((item, idx) => {
                      const product = products.find(p => p.id === item.itemId);
                      const display = splitNameVolume({
                        name: product?.name || item.name || '품목',
                        spec: product?.spec || item.displaySize,
                      });
                      const spec = specText(product?.spec || item.displaySize) || display.vol || '';
                      return (
                        <div key={idx} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${item.checked ? 'opacity-50' : ''}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${item.checked ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'}`}>
                              {item.checked && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </span>
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border shrink-0 ${
                              (item.labelType ?? '대기') === '대기' ? 'bg-red-50 border-red-200 text-red-600' :
                              item.labelType === '날인' ? 'bg-yellow-50 border-yellow-200 text-yellow-600' :
                              'bg-emerald-50 border-emerald-300 text-emerald-600'
                            }`}>{item.labelType ?? '대기'}</span>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`text-[11px] font-bold truncate ${item.checked ? 'line-through text-slate-400' : 'text-slate-700'}`}>{display.base}</span>
                              {spec && <span className="shrink-0 whitespace-nowrap text-[10px] font-bold text-slate-400">{spec}</span>}
                            </div>
                          </div>
                          <span className="text-[11px] font-black text-indigo-600 shrink-0 whitespace-nowrap">
                            {orderItemQuantityLabel(item, product?.unit)}
                          </span>
                        </div>
                      );
                    })}
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
