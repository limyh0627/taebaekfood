
import React, { useState, useMemo, useEffect } from 'react';
import { RotateCcw, Plus } from 'lucide-react';
import { isDeliveryChannel, channelStyle, shipMethodOf } from '../src/shared/channelStyle';
import { partnerLabel, shipToOf } from '../src/shared/shipTo';
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
import { Order, Partner, OrderStatus, Item, ItemBom, PartnerItem, PalletStock, OrderPallet, CompanyId } from '../types';
import { statusChip, statusLabel, STATUS_CARD_BORDER, STATUS_HEAD_LINE } from '../src/shared/orderStatusStyle';
import { X } from 'lucide-react';
import { subscribeToDocument, setDocument } from '../src/shared/services/firebaseService';
import OrdersList, { OrderCard } from './OrdersList';
import PageHeader from './PageHeader';
import CalendarDayCountBadge from './CalendarDayCountBadge';
import OrderEditModalShell from './OrderEditModalShell';
import ConfirmModal from './ConfirmModal';
import DeliveryDayList from './DeliveryDayList';
import { saveDeliveryTimeSlot } from '../src/shared/deliveryTimeSlot';
import { cardNoLabel } from '../src/shared/cardNo';
import { boxCountOf } from '../src/shared/orderUnits';
import { ungroup, withGroup, type DayRow, type DeliveryGroup } from '../src/shared/deliveryPlan';
import { clusterByGroup } from '../src/shared/rowGroup';
import { companySettingDocId, companySettingPatch } from '../src/shared/companySettings';

import { OrderItem, InvoiceType } from '../types';

interface DeliveryManagerProps {
  companyId: CompanyId;
  /**
   * **캘린더만 그린다** — 주문·배송을 한 화면으로 합칠 때 쓴다(2026-09-11 사장님).
   *
   * 껍데기(제목·탭바·검색조건·상태필터)와 리스트·보드는 주문 쪽(`OrdersList`)이 맡고,
   * 이 컴포넌트는 **금일 배송순서 + 배송 캘린더**만 내놓는다. 탭바가 둘이 되지 않게 한다.
   */
  calendarOnly?: boolean;
  /** 주문 쪽 검색조건에서 고른 정렬 — 캘린더의 날짜별 차례가 이걸 따른다. */
  sortMode?: 'delivery' | 'order' | 'stock' | 'workLow' | 'workHigh';
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
  //  송장은 세 단계다 — 뜻은 OrdersList 의 같은 props 주석 참고.
  onToggleInvoicePrinted?: (_id: string, _value: boolean | 'printed' | 'attached' | undefined) => void;
  /** 송장 양식(A~E) — 안에 끼운 주문 리스트가 쓴다. */
  onUpdateInvoiceType?: (_id: string, _value: InvoiceType | undefined) => void;
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

const DeliveryManager: React.FC<DeliveryManagerProps> = ({ companyId, calendarOnly = false, sortMode = 'delivery', orders: sourceOrders, partners, items, itemBoms = [], partnerItems = [], palletStocks = [], currentUserName, onUpdateDeliveryDate, onUpdateStatus, onUpdateItems, onUpdatePallets, onToggleInvoicePrinted, onUpdateInvoiceType, onToggleShipmentComplete, onToggleItemChecked, onDeleteOrder }) => {
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
  /**
   * **주문 끌어오기 창** — 금일 배송순서에 어떤 주문을 담을지 고른다.
   *
   * 2026-09-11 사장님: "금일배송순서랑 금일작업순서 내에 주문, 품목을 추가할 방법이 없다".
   * 맞다 — 예전엔 패널 머리에 `+ 추가` 가 있었는데(`306986e` 587줄) **병합(`a08a811`) 때
   * 통째로 사라졌다.** 상태 변수까지 없어져서 되살린다.
   *
   * 저장은 지금 방식(`settings/deliveryOrdering` 한 문서)을 그대로 쓴다 — 옛 코드의
   * 날짜별 `savePlan` 은 이제 없다.
   */
  /**
   * 배송순서에서 지금 보는 갈래 — **택배와 일반을 단추로 갈라 본다**
   * (2026-09-11 사장님: "택배랑 일반을 상단에서 버튼 눌러서 분리하는 형태로 둬봐").
   * 둘을 세로로 이어 쌓으면 일반을 보려고 택배를 지나쳐 내려가야 했다.
   */
  const [deliveryChannelTab, setDeliveryChannelTab] = useState<'일반' | '택배'>('일반');
  const [showDeliveryPicker, setShowDeliveryPicker] = useState(false);
  const [pickerDeliveryOrdering, setPickerDeliveryOrdering] = useState<string[]>([]);
  const [deliveryTimeSlots, setDeliveryTimeSlots] = useState<Record<string, '오전' | '오후'>>({});
  const [groupsByDate, setGroupsByDate] = useState<Record<string, DeliveryGroup[]>>({});
  const [groupPick, setGroupPick] = useState<{ date: string; ids: string[] }>({ date: '', ids: [] });
  /**
   * 금일 배송순서의 정렬 — **기본은 직접 정렬**(2026-09-11 사장님:
   * "금일배송순서랑 금일작업순서는 직접정렬이 디폴트로").
   *
   * 추천이 기본이면 카드가 `draggable={false}` 라 **끌어도 아무 일이 안 난다.** 게다가 그 토글은
   * 접히는 패널 안에 있어서, 왜 안 끌리는지 알아내려면 패널을 펴고 '직접 정렬'을 먼저 눌러야 했다.
   * 순서는 결국 사람이 정하는 것이니 끌리는 쪽을 기본으로 둔다. 추천은 눌러서 쓴다.
   */
  const [deliverySortMode, setDeliverySortMode] = useState<'recommended' | 'manual'>('manual');
  const [showCompletedDeliveryOrders, setShowCompletedDeliveryOrders] = useState(false);

  useEffect(() => {
    return subscribeToDocument<{ ordering: string[]; timeSlots: Record<string, '오전' | '오후'>; orderingByDate?: Record<string, string[]>; groupsByDate?: Record<string, DeliveryGroup[]> }>(
      'settings', companySettingDocId(companyId, 'deliveryOrdering'),
      (data) => {
        setDeliveryOrdering(data?.ordering ?? []);
        setDeliveryTimeSlots(data?.timeSlots ?? {});
        setOrderingByDate(data?.orderingByDate ?? {});
        setGroupsByDate(data?.groupsByDate ?? {});
      }
    );
  }, [companyId]);
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
    ['source', '판매 채널'], ['partner', '거래처'], ['address', '주소'],
    ['completion', '작업완료 여부'], ['item', '주문 품목'], ['quantity', '주문 수량'],
    ['label', '라벨 작업'], ['packaging', '포장'], ['pallet', '팔레트'],
    ['shipment', '출고완료 여부'], ['invoice', '송장'], ['note', '비고'],
    ['orderDate', '주문일'], ['deliveryDate', '출고예정일'],
  ];
  /**
   * **출고예정일이 어느 날인가 — 한국시간으로 센다.**
   *
   * 2026-09-12 사장님: "배송캘린더에서 날짜 옮기는거 아직도 안되는거 같던데 날짜 선택해서
   * 옮겨도 금일배송순서에만 들어오고 캘린더에서는 변화 없는거 같고".
   *
   * 맞다 — **저장과 읽기가 서로 다른 셈을 쓰고 있었다.** 출고 일정 수정 창은 한국시간 자정으로
   * 적는데(`…T00:00:00+09:00` → 전날 15:00Z), 캘린더 칸은 그 글자를 그냥 `split('T')[0]` 로
   * 잘라 **UTC 날짜**를 봤다. 9월 18일로 옮기면 캘린더는 9월 17일 칸에 넣었다.
   * 금일 배송순서는 이 함수(한국시간)를 쓰고 있어서 제 날짜에 떴고 — 그래서 "배송순서에만
   * 들어온다"로 보였다.
   *
   * 공장 기준은 한국시간이다. **읽는 쪽을 모두 이 함수로 모은다** — 글자를 자르면 적은 방식에
   * 따라 하루가 밀린다. 자정 UTC 로 적힌 옛 주문도 한국시간으로는 같은 날 09:00 이라 그대로다.
   */
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
  const [queryStatus, setQueryStatus] = useState<'all' | OrderStatus>('all');
  const deliverySearchOrders = useMemo(() => {
    const normalized = queryText.trim().toLocaleLowerCase('ko-KR');
    return sourceOrders.filter(order => {
      /*  **배송 화면은 상태로 거르지 않는다**(2026-09-14 사장님: "배송캘린더에 작업완료
       *  출고완료 주문만 뜨게 하지말고 대기중 작업중인 주문도 뜨게 해").
       *
       *  여기서 작업완료·출고완료만 들이고 있어서 **금일 배송순서와 캘린더가 어긋나 있었다** —
       *  금일 배송순서(`deliverySequenceOrders`)는 이미 `sourceOrders` 를 바로 읽어
       *  '배송완료가 아닌 것'을 다 담는데(2026-09-12 사장님: "금일배송순서가 배송캘린더
       *  당일에 해당하는거랑 일치해야 하는데"), 캘린더만 좁아 대기중·작업중이 빠졌다.
       *  **세는 곳이 둘이면 또 갈린다** — 그쪽 규칙에 맞춘다.
       *
       *  예전 주문(배송완료)도 들인다. 캘린더가 그걸 따로 모아(`deliveredSchedules`)
       *  '이전 N건' 으로 접어 두기 때문이다 — 전에는 여기서 막혀 그 접힘이 늘 비어 있었다. */
      if (order.partnerName === '생산기록') return false;
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
    setNewDate(queryDateKey(order.deliveryDate));
    setEditingTimeSlot(deliveryTimeSlots[order.id] || '오전');
    setScheduleConfirmation(null);
    setScheduleSaveError('');
  };

  const originalScheduleDate = editingOrder ? queryDateKey(editingOrder.deliveryDate) : '';
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
      await setDocument('settings', companySettingDocId(companyId, 'deliveryOrdering'), companySettingPatch(companyId, { ordering: deliveryOrdering, timeSlots: nextTimeSlots }));
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
        const date = queryDateKey(order.deliveryDate);
        if (!schedules[date]) schedules[date] = [];
        schedules[date].push(order);
      }
    });
    /*  **날짜 안의 차례도 검색조건의 정렬을 따른다**(2026-09-11 사장님).
        재고 여유는 "재고 − 주문량"이 적은 것부터 — 모자랄 것 같은 주문을 먼저 본다. */
    const 여유 = (order: Order) => Math.min(...order.items.map(line => {
      const product = items.find(candidate => candidate.id === line.itemId);
      return product ? (product.stock ?? 0) - line.quantity : Number.POSITIVE_INFINITY;
    }));
    for (const date of Object.keys(schedules)) {
      schedules[date].sort((a, b) => {
        if (sortMode === 'order') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (sortMode === 'stock') return 여유(a) - 여유(b);
        return (a.partnerName || '').localeCompare(b.partnerName || '', 'ko');
      });
    }
    return schedules;
  }, [orders, items, sortMode]);

  const deliveredSchedules = useMemo(() => {
    const schedules: Record<string, Order[]> = {};
    orders.forEach(order => {
      if (order.deliveryDate && order.partnerName !== '생산기록' && order.status === OrderStatus.DELIVERED) {
        const date = queryDateKey(order.deliveryDate);
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

  /*  **날짜별 배송 차례**(2026-09-12 사장님: "순서 어디갔냐", "주간에서는 드래그 해서 순서
      바꾸거나 다른 날짜로 넘기는거 왜 안되냐").
      오늘 것은 금일 배송순서 판과 같은 `ordering` 을 쓰고(둘이 어긋나면 안 된다),
      **다른 날은 `orderingByDate[날짜]`** 에 따로 담는다 — 전에는 오늘 말고는 차례를
      담는 데가 없어 번호도 끌기도 없었다. 안 담긴 주문은 뒤에 붙는다. */
  const [orderingByDate, setOrderingByDate] = useState<Record<string, string[]>>({});
  const 끄는카드 = React.useRef<{ id: string; date: string } | null>(null);
  /*  **출고 방식 묶음을 접었다 편다**(2026-09-15 사장님) — 택배는 기본이 접힘이다.
      손댄 적 없는 묶음은 기본을 따르고, 한 번 누른 묶음만 여기 담긴다(그래야 날마다 안 흔들린다). */
  const [묶음토글, set묶음토글] = useState<Set<string>>(new Set());
  const 묶음접기 = (열쇠: string) => set묶음토글(이전 => {
    const 다음 = new Set(이전);
    다음.has(열쇠) ? 다음.delete(열쇠) : 다음.add(열쇠);
    return 다음;
  });
  /*  **묶음 숫자 색**(2026-09-16 사장님: "택배는 분홍색으로 글씨 해봐" → "숫자에만 색 넣어"
      → "배송도 숫자에만 색넣고"). 이름은 안 칠한다 — 카드의 거래처명 색과 다투고 정작
      몇 건인지가 안 읽힌다. 방식마다 색이 달라야 접힌 채로도 눈으로 갈린다.
      **클래스는 통째로 적는다** — Tailwind 는 조립한 이름을 못 알아본다. */
  const 묶음숫자색: Record<string, string> = {
    택배: 'text-pink-600',
    배송: 'text-sky-600',
    직접수령: 'text-emerald-600',
  };

  const 접힌묶음 = (열쇠: string, 방식: string) => {
    const 기본접힘 = 방식 === '택배';
    return 묶음토글.has(열쇠) ? !기본접힘 : 기본접힘;
  };

  const saveDayOrdering = (dateStr: string, next: string[]) => {
    setOrderingByDate(prev => ({ ...prev, [dateStr]: next }));
    //  merge 로 쓴다 — 다른 날짜와 `ordering`·`timeSlots` 는 그대로 남는다
    void setDocument('settings', companySettingDocId(companyId, 'deliveryOrdering'), companySettingPatch(companyId, { orderingByDate: { [dateStr]: next } }));
  };

  /** 한 차 묶음도 순서처럼 회사 설정의 날짜 칸에 둔다. 다른 회사·다른 날짜를 덮지 않는다. */
  const saveDayGroups = (dateStr: string, groups: DeliveryGroup[]) => {
    setGroupsByDate(previous => ({ ...previous, [dateStr]: groups }));
    void setDocument('settings', companySettingDocId(companyId, 'deliveryOrdering'), companySettingPatch(companyId, {
      groupsByDate: { [dateStr]: groups },
    }));
  };

  const groupedIds = (dateStr: string, ids: string[]) => {
    const groups = groupsByDate[dateStr] ?? [];
    if (!groups.length) return ids;
    const groupOf = new Map<string, DeliveryGroup>();
    for (const group of groups) for (const id of group.orderIds) groupOf.set(id, group);
    return clusterByGroup(ids.map(id => ({ id })), row => row.id, id => groupOf.get(id)).map(row => row.id);
  };

  const toggleGroupPick = (dateStr: string, orderId: string) => {
    const groups = groupsByDate[dateStr] ?? [];
    if (groups.some(group => group.orderIds.includes(orderId))) {
      const plan = ungroup({ ordering: [], timeSlots: {}, done: [], groups }, orderId);
      saveDayGroups(dateStr, plan.groups ?? []);
      return;
    }
    setGroupPick(previous => {
      const ids = previous.date === dateStr ? previous.ids : [];
      return { date: dateStr, ids: ids.includes(orderId) ? ids.filter(id => id !== orderId) : [...ids, orderId] };
    });
  };

  const confirmGroup = (dateStr: string) => {
    if (groupPick.date !== dateStr || groupPick.ids.length < 2) return;
    const plan = withGroup(
      { ordering: [], timeSlots: {}, done: [], groups: groupsByDate[dateStr] ?? [] },
      groupPick.ids,
    );
    saveDayGroups(dateStr, plan.groups ?? []);
    setGroupPick({ date: '', ids: [] });
  };

  /** 담긴 차례를 먼저, 안 담긴 것은 뒤에 — 그 날 실제 주문만 남긴다 */
  const 하루차례 = (dateStr: string, ids: string[], saved: string[]) =>
    [...saved.filter(id => ids.includes(id)), ...ids.filter(id => !saved.includes(id))];

  /**
   * **그 날짜에 저장된 차례** — 오늘도 다른 날과 같은 데서 읽는다.
   *
   * 2026-09-14 사장님: "ORDERING에 없는거 자동포함은 하지마", "출고예정일이 오늘인 주문이
   * 이미 캘린더에 순서 붙어서 들어있잖아 그 목록을 그냥 가져오면 돼".
   *
   * 오늘만 **날짜를 안 들고 있는 옛 전역 목록**(`ordering`)을 쓰고 있었다. 날짜가 없으니
   * 어제 세운 줄이 오늘 칸에 남았고, 그걸 메우려고 "오늘 주문 중 차례에 없는 것"을 뒤에
   * 자동으로 붙였다. 한 번 끌면 그 자동분까지 통째로 저장돼, 고른 적 없는 주문이 차례에 박혔다.
   *
   * 이제 **오늘도 `orderingByDate[날짜]`** 다 — 다른 날과 같은 규칙이라 자동포함이라는
   * 개념 자체가 없다. 그 날 주문을 그대로 늘어놓고 차례만 저장한다.
   *
   * 옛 전역 목록은 **오늘 것이 아직 안 옮겨졌을 때만** 읽는다 — 세워 둔 차례를 잃지 않게.
   */
  const 날짜차례 = (dateStr: string) => orderingByDate[dateStr] ?? (dateStr === todayKey ? deliveryOrdering : []);

  /**
   * **배송 카드 한 벌 — 어느 날 칸이든 같은 모양이다.**
   *
   * 2026-09-12 사장님: "카드 양식이 당일에 해당하는 바탕색 없는 카드로 통일했으면 좋겠고".
   * **당일 칸이 쓰던 흰 카드**가 기준이다 — 다른 날 칸은 상태색을 바탕에 통째로 깔아
   * 같은 캘린더 안에서 두 가지 카드가 보였다.
   *
   * 담기는 것 — 번호(있으면) · 거래처 · **주문번호** · 주소 · 상태, 그리고 손잡이.
   * 출고완료면 **줄이 그어지고 흐려진다**(사장님: "출고완료되면 월간 카드 처럼 줄그어지고
   * 흐릿해지는 기능"). 카드를 누르면 주문 상세, **주문번호를 누르면 출고일정**이다.
   */
  const renderDeliveryCard = (
    o: Order,
    opt: {
      번호?: number; 띠?: string; 번호색?: string;
      /** 그 묶음에 몇 장인가 — 번호 고르개에 세울 숫자들. */
      번호총수?: number;
      /** 같은 차 묶음 — 캘린더에서도 붙어 있다는 표시를 남긴다. */
      한차?: boolean;
      /** 번호를 눌러 자리를 옮긴다(0부터). 안 주면 번호는 글자로만 뜬다. */
      onGotoNumber?: (목표: number) => void;
      drag?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
    } = {},
  ) => {
    //  **배송지까지 붙인다**(2026-09-16 사장님: "배송캘린더에서도 배송지명으로 들어가있게").
    const 그거래처 = partners.find(c => c.id === o.partnerId);
    const 이름 = partnerLabel(그거래처?.name || o.partnerName || '', shipToOf(그거래처, o.shipToId)?.name);
    const 끝났나 = o.status === OrderStatus.SHIPPED;
    return (
      <div
        key={o.id}
        {...opt.drag}
        /*  **카드를 누르면 출고 일정 수정**(2026-09-15 사장님: "카드 자체를 누르면 출고일정수정이
             뜨게 바꾸고 주문 번호를 눌렀을때 주문카드 보이게"). 둘을 맞바꿨다 —
             배송 화면에서 카드를 누르는 까닭은 열에 아홉 **날짜를 옮기려는 것**인데,
             넓은 카드가 주문 상세를 열고 좁은 주문번호가 일정 수정을 열고 있었다.
             자주 하는 일을 넓은 자리에 둔다. */
        onClick={() => handleOrderClick(o)}
        /*  **주문 카드와 같은 옷을 입힌다**(2026-09-14 사장님: "저기 있는 카드들도 주문카드랑
             색 맞춰 글씨랑 테두리"). 전에는 `statusChip` 을 통째로 얹어 **바탕까지 상태색으로
             칠했다** — 캘린더 칸은 카드가 작고 여럿이라 바탕이 깔리면 온통 색판이 됐다
             ("대기중 왤케 노래"). 주문 카드는 바탕이 흰색이고 **테두리와 글자**로만 상태를
             알린다(`STATUS_CARD_BORDER`·`STATUS_HEAD_LINE`) — 같은 규칙을 쓴다.
             오전·오후는 번호 색으로 남는다(`opt.번호색`). */
        title={`${이름} · ${DELIVERY_STATUS_LABEL[o.status] ?? o.status} — 눌러서 출고 일정 수정`}
        className={`flex items-center gap-1.5 rounded-xl border bg-white px-2 py-1.5 shadow-sm transition-all hover:brightness-95 cursor-pointer ${STATUS_CARD_BORDER[o.status] ?? 'border-slate-200'} ${opt.한차 ? 'border-l-4 border-l-indigo-400' : ''} ${끝났나 ? 'opacity-50' : ''}`}
      >
        {/*  **번호를 눌러 자리를 고른다**(2026-09-15 사장님: "배송캘린더에 배송순서 숫자 눌러서
             번호 타겟할 수 있게 바꿔주고"). 좁은 칸에서 카드를 끌어 옮기는 것보다 확실하다 —
             금일 배송순서 판이 진작 쓰던 방식이라 모양을 맞춘다. */}
        {opt.번호 !== undefined && (
          opt.onGotoNumber && (opt.번호총수 ?? 0) > 1 ? (
            <select
              aria-label={`${이름} 배송 순서`}
              value={opt.번호}
              onClick={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
              onChange={e => { e.stopPropagation(); opt.onGotoNumber?.(Number(e.target.value) - 1); }}
              className={`w-6 shrink-0 cursor-pointer appearance-none rounded bg-transparent text-center text-[9px] font-black outline-none hover:bg-slate-100 ${opt.번호색 ?? 'text-slate-400'}`}
            >
              {Array.from({ length: opt.번호총수 ?? 0 }, (_, i) => i + 1)
                .map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          ) : (
            <span className={`w-3 shrink-0 text-[9px] font-black ${opt.번호색 ?? 'text-slate-400'}`}>{opt.번호}</span>
          )
        )}
        <span className="min-w-0 flex-1">
          {/*  **주문번호는 맨 위, 작게**(2026-09-16 사장님: "주문번호는 크기 좀 줄여서 맨 위에 둬").
               어느 주문인지 짚을 때만 보는 것이라 거래처명 밑에서 자리를 다투고 있었다.
               위로 올려 **한 줄로 얇게** 깔면 아래 이름이 온전히 넓어진다.
               누르면 주문 상세 — 2026-09-12 에 여기 붙였던 출고 일정 수정은 카드 전체로 옮겼다.
               카드 눌림과 겹치지 않게 여기서 끊는다. */}
          <button
            type="button"
            title="눌러서 주문 상세 보기"
            aria-label={`${이름} 주문 상세`}
            onClick={e => { e.stopPropagation(); setPreviewDeliveryOrderId(o.id); }}
            className="block max-w-full truncate text-left text-[8px] font-black text-indigo-400 tabular-nums hover:underline"
          >{cardNoLabel(o)}</button>
          <span className="flex min-w-0 items-center gap-1">
            {/*  **출고 방식은 거래처명 앞이다**(사장님: "배송 택배 이런게 거래처명 좌측으로 오자").
                 뒤에 두면 긴 거래처명에 밀려 잘려 나갔고, 딱지가 줄마다 다른 자리에 서서
                 세로로 훑을 수가 없었다. 앞에 세우면 딱지들이 한 줄로 선다.
                 주문 카드도 판매 채널을 이름 앞에 둔다 — 같은 규칙이다.
                 배송·직접수령·택배. 안 적힌 옛 주문은 판매 채널로 읽는다(`shipMethodOf`). */}
            <span className={`shrink-0 rounded px-1 py-0.5 text-[8px] font-black ${channelStyle(shipMethodOf(o) === '배송' ? '일반' : shipMethodOf(o)).chip}`}>
              {shipMethodOf(o)}
            </span>
            {/*  **거래처명이 이 카드의 주인공이다**(사장님: "거래처명 글씨 크기 좀만 키우고") —
                 10 → 12px. 멀리서 훑을 때 읽히는 것이 이름이다. */}
            <span className={`min-w-0 truncate text-[12px] font-bold ${STATUS_HEAD_LINE[o.status] ?? 'text-slate-700'} ${끝났나 ? 'line-through' : ''}`}>{이름}</span>
          </span>
          {calendarLocationOf(o) && (
            <span className="mt-0.5 flex items-center gap-0.5 truncate text-[9px] font-medium text-slate-500">
              <MapPin size={9} className="shrink-0" />{calendarLocationOf(o)}
            </span>
          )}
        </span>
        {/*  **상태 글자는 뺐다 — 색으로만 알린다**(2026-09-15 사장님: "작업완료 대기중 이런건
             빼고 색깔로만 구분할게 배송캘린더 쪽에선"). 칸이 좁아 `작업완료` 네 글자가
             거래처명을 밀어냈다. 테두리와 거래처명 색이 이미 같은 말을 하고 있다
             (`STATUS_CARD_BORDER`·`STATUS_HEAD_LINE`). 마우스를 올리면 글자로도 나온다. */}
        {opt.drag?.draggable && <GripVertical size={10} className="shrink-0 text-slate-300" />}
      </div>
    );
  };

  /**
   * **하루치 배송 줄 — 오전·오후로 가르고 번호를 매긴다.**
   *
   * 2026-09-12 사장님: "오전 오후 구분이 없네", "순서 어디갔냐".
   * 전에는 **오늘 칸에만** 있던 것이라 다른 날은 밋밋한 목록이었다. 어느 날이든 같게 한다.
   *
   * 번호는 `오전 → 오후` 로 이어 매긴다. 카드를 끌어 **같은 날 안에서는 차례가 바뀌고**,
   * 다른 날 칸에 떨어뜨리면 날짜가 바뀐다(바깥 칸이 받는다 — 그래서 여기서 전파를 안 막는다).
   */
  /**
   * **하루치를 출고 방식으로 묶는다**(2026-09-15 사장님: "같은 날짜에 있는 주문들이 배송방식으로
   * 묶이게 하고 열었다 접었다 할 수 있게 택배는 기본적으로 접혀있고 그리고 배송방식 택배인
   * 주문들은 자기네 순서 따로 써").
   *
   * 전에는 오전·오후로만 갈라, 우리 차가 도는 집과 기사가 실어 가는 택배가 한 줄에 섞여 있었다.
   * **도는 차례는 우리 차 것에만 뜻이 있다** — 택배는 몇 번째든 상관이 없다.
   * 그래서 방식으로 먼저 묶고 **번호를 묶음 안에서 매긴다.**
   *
   * **택배는 접어 둔다** — 대개 손댈 일이 없는데 칸을 제일 많이 먹는다. 접힌 채로도 몇 건인지는 보인다.
   * 오전·오후는 묶음 **안에서** 차례를 가르는 데 그대로 쓴다(오전 먼저, 오후 나중).
   */
  const renderDaySequence = (dateStr: string, ids: string[], 저장: (_next: string[]) => void) => {
    const 붙인ids = groupedIds(dateStr, ids);
    const 방식 = (id: string) => {
      const o = orders.find(x => x.id === id);
      return o ? shipMethodOf(o) : '배송';
    };
    /*  **택배가 맨 위다**(2026-09-15 사장님: "택배가 위로 올라오게 해 캘린더에서").
        택배는 접혀 있어 한 줄만 먹는다 — 위에 두면 그 한 줄만 지나면 바로 우리 차 도는
        차례가 나온다. 아래에 두면 배송 목록이 길 때 택배가 몇 건인지 보려고 칸을 굴려야 한다.
        나머지는 칸에 서는 차례 그대로. */
    const 묶음이름: string[] = [];
    for (const id of 붙인ids) { const m = 방식(id); if (!묶음이름.includes(m)) 묶음이름.push(m); }
    묶음이름.sort((a, b) => (a === '택배' ? 0 : 1) - (b === '택배' ? 0 : 1));

    const 놓기 = (놓인id: string) => {
      const 끈것 = 끄는카드.current;
      끄는카드.current = null;
      if (!끈것 || 끈것.date !== dateStr || 끈것.id === 놓인id) return;   // 다른 날 → 바깥 칸이 받는다
      const next = 붙인ids.filter(id => id !== 끈것.id);
      next.splice(Math.max(0, next.indexOf(놓인id)), 0, 끈것.id);
      저장(next);
    };

    return 묶음이름.map(이름 => {
      //  그 묶음 것만, 오전 먼저 오후 나중으로.
      const 묶음ids = 붙인ids.filter(id => 방식(id) === 이름);
      const 오전 = 묶음ids.filter(id => (deliveryTimeSlots[id] || '오전') === '오전');
      const 오후 = 묶음ids.filter(id => deliveryTimeSlots[id] === '오후');
      const 차례 = [...오전, ...오후];
      const 열쇠 = `${dateStr}__${이름}`;
      const 접힘 = 접힌묶음(열쇠, 이름);

      /*  **번호를 눌러 자리를 고른다**(사장님: "배송순서 숫자 눌러서 번호 타겟할 수 있게").
          좁은 칸에서 카드를 끌어 옮기는 것보다 확실하다 — 금일 배송순서 판이 진작 쓰던 방식이다.
          **묶음 안에서만** 자리를 바꾸고, 저장할 때 그 자리에 도로 끼워 넣는다 —
          그래야 택배를 옮겨도 우리 차 도는 차례가 안 흔들린다. */
      const 자리바꾸기 = (id: string, 목표: number) => {
        const 지금 = 차례.indexOf(id);
        if (지금 < 0 || 목표 < 0 || 목표 === 지금 || 목표 >= 차례.length) return;
        const 새차례 = [...차례];
        const [옮길것] = 새차례.splice(지금, 1);
        새차례.splice(목표, 0, 옮길것);
        //  전체 목록에서 **이 묶음 자리들만** 새 차례로 갈아 끼운다.
        let n = 0;
        저장(붙인ids.map(원래 => 방식(원래) === 이름 ? 새차례[n++] : 원래));
      };

      return (
        <React.Fragment key={이름}>
          {/*  **색은 숫자에만**(2026-09-16 사장님: "택배는 분홍색으로 글씨 해봐" → "숫자에만 색
               넣어" → "배송도 숫자에만 색넣고"). 이름까지 칠하면 카드의 거래처명 색과 다투고,
               정작 몇 건인지가 안 읽힌다.

               **바탕도 크기도 안 건드린다** — 한 번 바탕을 깔고 글씨를 키워 봤다가 바로
               무르셨다("왜 갑자기 바탕색을 넣고 크기도 바꿨어 그냥 숫자 색만 넣으라니까").
               캘린더 칸은 카드가 여럿이라 머리까지 칠하면 또 색판이 된다 — 숫자 색만으로 갈린다. */}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); 묶음접기(열쇠); }}
            aria-expanded={!접힘}
            title={접힘 ? `${이름} 펴기` : `${이름} 접기`}
            className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-[9px] font-black text-slate-500 transition-colors hover:bg-slate-100"
          >
            <ChevronDown size={10} className={`shrink-0 transition-transform ${접힘 ? '-rotate-90' : ''}`} aria-hidden="true" />
            <span className="truncate">{이름}</span>
            <span className={`tabular-nums ${묶음숫자색[이름] ?? 'text-slate-400'}`}>{묶음ids.length}</span>
          </button>
          {!접힘 && 차례.map(id => {
            const o = orders.find(x => x.id === id);
            if (!o) return null;
            const 오후인가 = deliveryTimeSlots[id] === '오후';
            return renderDeliveryCard(o, {
              //  **묶음 안에서 매긴다** — 택배가 우리 차 번호를 밀지 않는다.
              번호: 차례.indexOf(id) + 1,
              번호총수: 차례.length,
              onGotoNumber: 목표 => 자리바꾸기(id, 목표),
              띠: 오후인가 ? 'border-indigo-100' : 'border-amber-100',
              번호색: 오후인가 ? 'text-indigo-500' : 'text-amber-500',
              한차: (groupsByDate[dateStr] ?? []).some(group => group.orderIds.includes(id)),
              drag: {
                draggable: true,
                onDragStart: e => { 끄는카드.current = { id, date: dateStr }; handleDragStart(e, id); },
                onDragEnd: () => { 끄는카드.current = null; },
                onDragOver: e => e.preventDefault(),
                onDrop: () => 놓기(id),
              },
            });
          })}
        </React.Fragment>
      );
    });
  };

  const renderWeekCalendar = () => {
    const todayStr = toLocalDateStr(new Date());
    //  상태 색은 [shared/orderStatusStyle](../src/shared/orderStatusStyle) 한 곳이 정한다.
    //  여기 있던 표는 **하늘 배경에 분홍 글씨**(`text-pink-700`)였다 — 복사 실수다(2026-09-06).

    /*  **오늘 칸도 다른 날과 똑같이 그린다**(2026-09-14 사장님). 전에는 오늘만 날짜 없는
     *  전역 목록을 읽고, 거기 없는 오늘 주문을 뒤에 자동으로 붙였다. 이제 `날짜차례` 하나다 —
     *  그 날 주문(`deliverySchedules[날짜]`)을 늘어놓고 차례만 `orderingByDate` 에 담는다. */

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
      );

      if (isToday) {
        // 오늘 열 → 금일 배송순서 스타일
        return (
          <div
            key={dateStr}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, dateStr)}
            className="border-r border-slate-100 p-1.5 sm:p-3 flex flex-col bg-indigo-50/30 relative"
            style={{ minHeight: 200 }}
          >
            <button type="button" onClick={() => setDayModal(dateStr)}
              className="absolute inset-x-0 top-0 z-10 h-14 sm:hidden" aria-label={`${d.getDate()}일 배송 상세 보기`} />
            {dateHeader}
            <div className="flex flex-1 flex-col gap-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {dayOrders.length === 0 ? (
                <p className="text-center text-[10px] text-slate-300 font-bold py-4">오늘 나갈 주문 없음</p>
              ) : (
                //  오늘 차례도 `orderingByDate[오늘]` 이다 — 금일 배송순서 판이 같은 것을 읽는다.
                <>{renderDaySequence(dateStr, 하루차례(dateStr, dayOrders.map(order => order.id), 날짜차례(dateStr)), next => saveDayOrdering(dateStr, next))}</>
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
            {/*  전에는 여기만 상태색을 바탕에 통째로 깔고, 번호도 오전·오후도 없었다.
                 **당일 칸과 같게** 맞춘다(2026-09-12 사장님). 차례는 `orderingByDate[날짜]`. */}
            {renderDaySequence(
              dateStr,
              하루차례(dateStr, dayOrders.map(order => order.id), 날짜차례(dateStr)),
              next => saveDayOrdering(dateStr, next),
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
          /*  **한 칸에 주문 넉 장은 보여야 한다**(2026-09-15 사장님: "한칸에 주문 4개는
              보여야돼 더 늘어나게 해"). 카드 한 장이 44px(카드 40 + 사이 4)이고 오전·오후
              머리가 각 16px 이라, 넉 장이면 176 + 32 = 208 이 든다.
              일정이 없는 지난 날은 전처럼 납작하게 둔다(`compact`). */
          style={{ minHeight: compact ? 36 : 208 }}
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
          {/*  **월간도 주간과 같은 카드다**(2026-09-12 사장님: "배송캘린더 월간 카드는 왜 통일
               안됐어"). 주간만 고치고 월간은 `DeliveryDayList` 를 그대로 뒀더니 캘린더 안에서
               또 두 가지 카드가 보였다. 당일 칸이 쓰던 흰 카드 한 벌(`renderDeliveryCard`)로 모은다.

               **완료 체크는 카드에서 빠진다** — 그 체크는 `DeliveryDayList` 것이라 주간·당일에는
               원래 없었다. 출고완료 처리는 금일 배송순서 판과 날짜 상세 창에서 한다. */}
          {/*  넉 장까지는 안 밀고 그대로 보인다 — 더 있으면 그때부터 칸 안에서 굴린다. */}
          {dayOrders.length > 0 && (
            <div className="mt-1 flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: 208, scrollbarWidth: 'thin' }}>
              {renderDaySequence(
                dateStr,
                하루차례(dateStr, dayOrders.map(order => order.id), 날짜차례(dateStr)),
                next => saveDayOrdering(dateStr, next),
              )}
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
      {!calendarOnly && <PageHeader
        title="배송 관리"
        subtitle="배송 일정과 출고 진행 상태를 관리합니다."
      />}

      {!calendarOnly && <div className="order-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-6">
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
      </div>}

      {!calendarOnly && <section className="order-3 overflow-hidden rounded-lg border border-slate-200 bg-white" aria-labelledby="delivery-query-title">
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
      </section>}

      {!calendarOnly && <div className="order-4 flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white px-1" aria-label="배송 상태 필터">
        {/*  **'전체' 는 예전 주문을 안 센다** — 예전 것은 캘린더에서 '이전 N건' 으로 접혀 따로 뜬다.
             셈에 넣으면 운영 중인 주문이 몇 건인지가 묻힌다. */}
        {[
          { value: 'all' as const, label: '전체', count: deliveryQueryOrders.filter(order => order.status !== OrderStatus.DELIVERED).length },
          { value: OrderStatus.PENDING, label: '대기중', count: deliveryQueryOrders.filter(order => order.status === OrderStatus.PENDING).length },
          { value: OrderStatus.PROCESSING, label: '작업중', count: deliveryQueryOrders.filter(order => order.status === OrderStatus.PROCESSING).length },
          { value: OrderStatus.DISPATCHED, label: '작업완료', count: deliveryQueryOrders.filter(order => order.status === OrderStatus.DISPATCHED).length },
          { value: OrderStatus.SHIPPED, label: '출고완료', count: deliveryQueryOrders.filter(order => order.status === OrderStatus.SHIPPED).length },
        ].map(status => (
          <button key={status.value} type="button" onClick={() => setQueryStatus(status.value as typeof queryStatus)} className={`flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-xs font-black transition-colors ${queryStatus === status.value ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>
            <span>{status.label}</span><span className={`text-[9px] tabular-nums ${queryStatus === status.value ? 'text-indigo-500' : 'text-slate-400'}`}>{status.count}</span>
          </button>
        ))}
      </div>}

      {!calendarOnly && deliveryTab === '리스트' && (
        <div className="order-5">
        <OrdersList
          companyId={companyId}
          title="배송 목록"
          subtitle="오늘 나갈 주문 — 대기중부터 출고완료까지"
          groupBy="status"
          /*  캘린더와 같은 것을 본다(2026-09-14) — 위 상태 바에서 '대기중'을 골랐는데
              목록이 비어 있으면 거짓말이 된다. 예전 주문만 뺀다. */
          allowedStatuses={[OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.DISPATCHED, OrderStatus.ON_HOLD, OrderStatus.SHIPPED]}
          orders={orders.filter(order => order.status !== OrderStatus.DELIVERED)}
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
          onUpdateInvoiceType={(id, value) => onUpdateInvoiceType?.(id, value)}
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
        /*  **금일 배송순서는 오늘 나갈 것만 본다**(2026-09-11 사장님: "목록이 오늘 출고
            예정인것만 보여야 하는데?"). 전에는 운영 중인 배송 대상을 날짜와 무관하게 다 담아서,
            머리의 건수(오늘 기준)와 목록이 안 맞았다. **목록 쪽을 오늘로 좁힌다.** */
        /*  **캘린더 당일 칸과 같은 것을 본다**(2026-09-12 사장님: "금일배송순서가 배송캘린더
         *  당일에 해당하는거랑 일치해야 하는데 목록이").
         *
         *  여기만 `작업중·출고대기·출고완료` 로 좁혀 놔서, 캘린더 오늘 칸에는 뜨는데 이 목록에는
         *  없는 주문이 생겼다(대기중·보류). 캘린더 쪽 규칙(`배송완료가 아닌 것`)에 맞춘다 —
         *  대기중도 오늘 나갈 것이면 여기 서야 한다(2026-09-09 사장님: "금일 배송순서에 대기중
         *  작업중 이 상태가 없네"). 세는 곳이 둘이면 또 갈린다. */
        const deliverySequenceOrders = sourceOrders.filter(order =>
          order.partnerName !== '생산기록'
          && order.status !== OrderStatus.DELIVERED
          && queryDateKey(order.deliveryDate) === todayKey
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
        /*  **나간 것은 차례에서 빠진다**(2026-09-12 사장님: "완료된애들은 순서에서 빠지는게
            낫겠다"). 2026-09-11 에는 반대로 "숨겨도 제 번호를 들고 있어야 한다" 하셔서 숨기기
            전 목록에서 번호를 셌는데, 그 판단을 뒤집으신 것이다.
            남은 집이 1·2·3 으로 다시 매겨져 **앞으로 몇 집이 남았는지가 번호로 읽힌다.** */
        /*  차례 밖에 있는 줄 — **택배**(기사가 실어 가니 도는 순서가 없다)와
            **이미 나간 집**(출고완료). 번호도, 끌기도, 번호 바꾸기도 이 줄들은 건너뛴다. */
        /*  주문을 찾을 때 **이 판이 보는 목록**에서 찾는다 — 아래 조회 결과(`orders`)는
            검색조건·상태탭이 걸려 있어 대기중·작업중이 빠진다. 거기서 찾으면 못 찾은 주문이
            말없이 '일반'으로 떨어져, 작업중 택배 주문이 일반 칸에 서서 번호까지 받았다. */
        const 판주문 = (id: string) => deliverySequenceOrders.find(candidate => candidate.id === id);
        const 차례밖 = (id: string) => {
          const order = 판주문(id);
          return isDeliveryChannel(order?.source) || order?.status === OrderStatus.SHIPPED;
        };
        /*  **차례는 캘린더가 들고 있는 오늘 것을 그대로 가져온다**(2026-09-14 사장님:
            "출고예정일이 오늘인 주문이 이미 캘린더에 순서 붙어서 들어있잖아 그 목록을 그냥
            가져오면 돼"). 전에는 여기와 캘린더가 **날짜 없는 전역 목록**을 따로 이어 붙여
            썼다 — 같은 일을 두 군데서 하니 어긋났고, 붙인 것이 그대로 저장돼 고른 적 없는
            주문이 차례에 박혔다. 이제 `하루차례` 하나가 정한다. */
        const 오늘차례 = 날짜차례(todayKey);
        const numberingIds = 하루차례(todayKey, deliverySequenceOrders.map(order => order.id), 오늘차례)
          .filter(id => !차례밖(id));
        const manualIds = 하루차례(todayKey, visibleDeliverySequenceOrders.map(order => order.id), 오늘차례);
        const visibleIds = groupedIds(todayKey, deliverySortMode === 'recommended'
          ? recommendedOrders.map(order => order.id)
          : manualIds);
        /*  **세는 것과 보여 주는 것이 같아야 한다**(2026-09-11 사장님: "출고완료 n건
            출고미완료 n건이 실제 금일배송순서에 있는 주문 개수랑 안 맞는거 같어").
            맞다 — 숫자는 **오늘 출고예정일인 것만** 세는데 목록은 날짜와 무관하게 운영 중인
            배송 대상을 다 보여 준다. 그래서 목록엔 13건이 있는데 숫자는 몇 건으로 떴다.
            고친 뒤로는 목록도 오늘 것만 담으므로(위 `deliverySequenceOrders`) 둘이 같은 것을 센다.
            나간 집을 숨겨도 그 건수는 단추에 찍혀야 하므로, 완료는 숨기기 전 목록에서 센다. */
        const todayIncompleteCount = deliverySequenceOrders.filter(order => order.status !== OrderStatus.SHIPPED).length;
        const todayCompleteCount = deliverySequenceOrders.filter(order => order.status === OrderStatus.SHIPPED).length;

        /*  캘린더 오늘 칸과 **같은 자리**(`orderingByDate[오늘]`)에 담는다 — 둘이 어긋나면 안 된다.
            오전·오후는 날짜와 무관하게 주문마다 붙는 것이라 예전 자리(`timeSlots`)에 그대로 둔다. */
        const saveDeliveryOrdering = (next: string[], slots?: Record<string, '오전' | '오후'>) => {
          saveDayOrdering(todayKey, next);
          if (slots) saveTimeSlots(slots);
        };

        const saveTimeSlots = (next: Record<string, '오전' | '오후'>) => {
          setDeliveryTimeSlots(next);
          setDocument('settings', companySettingDocId(companyId, 'deliveryOrdering'), companySettingPatch(companyId, { ordering: deliveryOrdering, timeSlots: next }));
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
          /*  **택배는 순서가 없다**(2026-09-11 사장님: "배송순서에 택배는 순서랄게 없어").
              기사가 와서 실어 가는 것이라 우리가 도는 차례를 정할 게 없다 — 번호도 손잡이도 안 단다.
              일반(우리 차가 도는 것)만 번호와 끌기를 둔다. */
          const 택배인가 = isDeliveryChannel(order.source);
          //  번호는 **차례에 선 집들**(일반 · 아직 안 나간 것) 안에서만 센다.
          const sequenceNumber = numberingIds.indexOf(id) + 1;
          const 끌수있나 = deliverySortMode === 'manual' && !차례밖(id);
          const slotTone = slot === '오전' ? 'amber' : 'indigo';
          const 한차 = (groupsByDate[todayKey] ?? []).find(group => group.orderIds.includes(id));
          const 묶으려고고름 = groupPick.date === todayKey && groupPick.ids.includes(id);
          return (
            <div
              key={id}
              draggable={끌수있나}
              onDragStart={() => {
                if (!끌수있나) return;
                setDragDeliveryIdx(manualIds.indexOf(id));
                setDragDeliveryId(id);
              }}
              onDragOver={event => 끌수있나 && event.preventDefault()}
              onDrop={() => { if (끌수있나) moveDeliveryOrder(id, slot); }}
              className={`grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border bg-white px-3 py-2.5 shadow-sm ${한차 ? 'border-l-4 border-l-indigo-400' : slotTone === 'amber' ? 'border-amber-100' : 'border-indigo-100'} ${묶으려고고름 ? 'ring-2 ring-indigo-300' : ''} ${끌수있나 ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {/*  **숫자를 눌러 순서를 직접 고른다**(2026-09-11 사장님: "숫자 눌러서 직접 순서 입력해서
                   바꿀 수 있게 해"). 좁은 카드끼리 끌어 옮기는 것보다 확실하다 —
                   배송 캘린더의 줄(`DeliveryDayList`)이 진작 쓰던 방식이라 모양을 그대로 맞춘다.
                   택배는 순서가 없으니 빈칸이다. */}
              {차례밖(id) ? (
                <span className="text-center text-[11px] font-black tabular-nums text-slate-300" />
              ) : deliverySortMode === 'manual' ? (
                <select
                  aria-label={`${partnerName} 배송 순서`}
                  value={sequenceNumber}
                  onPointerDown={event => event.stopPropagation()}
                  onChange={event => {
                    const 목표 = Number(event.target.value) - 1;
                    const 지금 = numberingIds.indexOf(id);
                    if (지금 < 0 || 목표 < 0 || 목표 === 지금) return;
                    //  **일반 것들의 차례만 바꾼다.** 택배는 순서가 없어 끼어들지 않는다.
                    const 새차례 = [...numberingIds];
                    const [옮길것] = 새차례.splice(지금, 1);
                    새차례.splice(목표, 0, 옮길것);
                    //  저장하는 목록에는 택배도 들어 있으므로, 일반 자리만 새 차례로 갈아 끼운다.
                    let n = 0;
                    //  `numberingIds` 에서 뺀 것과 **똑같은 기준**으로 건너뛴다.
                    //  한쪽만 빼면 `새차례` 가 모자라 저장된 차례에 `undefined` 가 끼어든다.
                    saveDeliveryOrdering(manualIds.map(x => 차례밖(x) ? x : 새차례[n++]));
                  }}
                  className={`h-7 w-7 shrink-0 cursor-pointer appearance-none rounded-lg border border-slate-200 bg-slate-50 text-center text-xs font-black tabular-nums outline-none focus:ring-2 focus:ring-indigo-300 ${slotTone === 'amber' ? 'text-amber-600' : 'text-indigo-600'}`}
                >
                  {numberingIds.map((_, n) => <option key={n} value={n + 1}>{n + 1}</option>)}
                </select>
              ) : (
                <span className={`text-center text-[11px] font-black tabular-nums ${slotTone === 'amber' ? 'text-amber-600' : 'text-indigo-600'}`}>{sequenceNumber}</span>
              )}
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
                {!택배인가 && deliverySortMode === 'manual' && (
                  <button
                    type="button"
                    onClick={() => toggleGroupPick(todayKey, id)}
                    className={`min-h-7 rounded-md px-2 text-[10px] font-black ${한차 ? 'bg-indigo-100 text-indigo-700' : 묶으려고고름 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'}`}
                  >{한차 ? '묶음 해제' : 묶으려고고름 ? '선택됨' : '한 차'}</button>
                )}
                <button type="button" onClick={() => toggleTimeSlot(id)} className={`min-h-7 rounded-md px-2 text-[10px] font-black ${slotTone === 'amber' ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}>{slot}</button>
                {끌수있나 && <GripVertical size={14} className="text-slate-300" aria-label="순서 이동" />}
              </div>
            </div>
          );
        };

        return (
          <>
              {/*  **금일 배송순서는 캘린더 탭 위에만 둔다**(2026-09-11 사장님:
                   "금일 배송순서는 캘린더 쪽 상단으로 이동시켜").
                   리스트·보드에서는 그날 도는 순서를 볼 일이 없고, 늘 붙어 있으면 화면만 길어진다.
                   주문 쪽 금일 작업순서와 두 덩이가 겹쳐 쌓이는 것도 막는다. */}
              {(calendarOnly || deliveryTab === '캘린더') && (
              <div className="order-1 flex w-full flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                  <button type="button" className="flex min-h-11 items-center gap-2 text-left" onClick={() => toggleMobileCollapse('delivery-order')} aria-expanded={!mobileCollapsed.has('delivery-order')}>
                    <div className="rounded-xl bg-indigo-600 p-1.5 text-white"><ListOrdered size={16} /></div>
                    <h3 className="text-sm font-black text-slate-900"><span className="tabular-nums">{todayKey.replaceAll('-', '.')}</span> 금일 배송순서</h3>
                    <ChevronDown size={14} className={`text-slate-400 transition-transform ${mobileCollapsed.has('delivery-order') ? '' : 'rotate-180'}`} />
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setPickerDeliveryOrdering(visibleIds); setShowDeliveryPicker(true); }}
                      className="flex min-h-8 items-center gap-1 rounded-lg bg-indigo-50 px-2.5 text-[11px] font-black text-indigo-600 transition-colors hover:bg-indigo-100"
                    ><Plus size={12} aria-hidden="true" />주문 끌어오기</button>
                    {/*  **생긴 것은 전과 똑같다**(2026-09-12 사장님: "생긴건 전이랑 똑같이 해
                         괜히 바탕색 넣고 색 바꾸지말고"). 쓰던 문장 그대로 두고 완료 쪽만 눌리게 했다 —
                         나간 집은 차례에서 빠지고, 눌러야 뒤에 붙어 보인다. 켜진 것은 밑줄로만 알린다. */}
                    <p className="flex flex-nowrap items-center whitespace-nowrap text-xs font-bold text-slate-500">
                      출고 미완료 <strong className="ml-1 font-black text-rose-600">{todayIncompleteCount}건</strong>
                      <span className="mx-1.5 text-slate-300">·</span>
                      <button
                        type="button"
                        onClick={() => setShowCompletedDeliveryOrders(현재 => !현재)}
                        aria-pressed={showCompletedDeliveryOrders}
                        className={`transition-opacity hover:opacity-70 ${showCompletedDeliveryOrders ? 'underline underline-offset-4' : ''}`}
                      >출고 완료 <strong className="font-black text-emerald-600">{todayCompleteCount}건</strong></button>
                    </p>
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
                      {/*  **묶음은 택배와 일반 둘이다**(2026-09-11 사장님: "배송순서에서는
                           택배(택배, 스마트스토어)랑 일반으로 분류"). 택배는 송장을 붙여 넘기고
                           일반은 우리 차가 돌기 때문에 챙기는 일이 다르다 — 섞여 있으면 순서를 못 짠다.
                           스마트스토어도 택배로 나가므로 같은 묶음이다(`isDeliveryChannel`).
                           오전·오후는 줄마다 달린 딱지로 그대로 고른다. */}
                      {/*  **갈래 보기는 금일 작업순서와 같은 모양이다**(2026-09-12 사장님:
                           "왜 배송순서는 작업순서랑 그룹 보기 방식이 다르냐 작업순서 하는대로 하면 되는데").
                           맞다 — 같은 화면에 나란히 있는 두 판이 묶음을 다르게 보여 줄 이유가 없었다.
                           작업순서 쪽 품목 카테고리 탭(밑줄 · 옆에 작은 수 · ←/→ 로 넘김)을 그대로 쓴다.
                           수는 **숨기기 전 전체**를 적고, 지금 몇 줄 보고 있는지는 아래 `n/n` 이 맡는다
                           — 작업순서가 그렇게 하고 있다. */}
                      {(() => {
                        const 갈래목록 = (['일반', '택배'] as const).map(key => {
                          const 택배묶음 = key === '택배';
                          return {
                            key,
                            ids: visibleIds.filter(id => isDeliveryChannel(판주문(id)?.source) === 택배묶음),
                            전체: deliverySequenceOrders.filter(order => isDeliveryChannel(order.source) === 택배묶음).length,
                          };
                        });
                        const 키들 = 갈래목록.map(갈래 => 갈래.key);
                        return (
                          <div className="mb-2 flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white px-1" role="tablist" aria-label="배송 갈래">
                            {갈래목록.map(갈래 => (
                              <button
                                key={갈래.key} id={`delivery-tab-${갈래.key}`} type="button" role="tab"
                                aria-controls="delivery-channel-panel"
                                tabIndex={deliveryChannelTab === 갈래.key ? 0 : -1}
                                aria-selected={deliveryChannelTab === 갈래.key}
                                onClick={() => setDeliveryChannelTab(갈래.key)}
                                onKeyDown={event => {
                                  const index = 키들.indexOf(갈래.key);
                                  const nextIndex = event.key === 'ArrowRight' ? (index + 1) % 키들.length
                                    : event.key === 'ArrowLeft' ? (index - 1 + 키들.length) % 키들.length
                                    : event.key === 'Home' ? 0 : event.key === 'End' ? 키들.length - 1 : -1;
                                  if (nextIndex < 0) return;
                                  event.preventDefault();
                                  const 다음 = 키들[nextIndex];
                                  setDeliveryChannelTab(다음);
                                  document.getElementById(`delivery-tab-${다음}`)?.focus();
                                }}
                                className={`flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-xs font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${deliveryChannelTab === 갈래.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>
                                <span>{갈래.key}</span>
                                <span className={`text-[9px] tabular-nums ${deliveryChannelTab === 갈래.key ? 'text-indigo-500' : 'text-slate-400'}`}>{갈래.전체}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                      {(['일반', '택배'] as const).map(key => ({
                        key,
                        ids: visibleIds.filter(id => isDeliveryChannel(판주문(id)?.source) === (key === '택배')),
                        전체: deliverySequenceOrders.filter(order => isDeliveryChannel(order.source) === (key === '택배')).length,
                      })).filter(묶음 => 묶음.key === deliveryChannelTab).map(묶음 => (
                        <div key={묶음.key} id="delivery-channel-panel" role="tabpanel" aria-labelledby={`delivery-tab-${묶음.key}`} tabIndex={0} className="flex flex-col gap-1">
                          {/*  몇 집 중 몇 집을 보고 있나 — 탭의 수는 전체라, '출고 완료 n건' 을
                               안 눌렀을 때 몇 집이 빠져 있는지는 여기서만 알 수 있다(작업순서와 같다). */}
                          <div className="mb-0.5 flex items-center justify-end px-1">
                            {묶음.key === '일반' && groupPick.date === todayKey && groupPick.ids.length > 0 && (
                              <button
                                type="button"
                                disabled={groupPick.ids.length < 2}
                                onClick={() => confirmGroup(todayKey)}
                                className="mr-auto rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[10px] font-black text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                              >고른 {groupPick.ids.length}건 한 차로 묶기</button>
                            )}
                            <span className="text-[10px] font-bold text-slate-400">{묶음.ids.length}/{묶음.전체}</span>
                          </div>
                          {묶음.ids.length === 0
                            ? <p className="py-1 text-center text-[10px] font-bold text-slate-300">없음</p>
                            : 묶음.key === '택배'
                              //  택배는 도는 차례가 없으니 오전·오후로도 안 가른다.
                              ? 묶음.ids.map(id => renderDeliveryRow(id, deliveryTimeSlots[id] === '오후' ? '오후' : '오전'))
                              /*  **일반은 오전·오후로 한 번 더 가른다**(2026-09-11 사장님: "배송순서 쪽에
                                  오전 오후가 없어졌냐"). 택배/일반로 묶으면서 이 구분이 빠져 있었다 —
                                  줄마다 달린 오전·오후 딱지는 그대로였지만 칸이 안 갈려 언제 나가는지
                                  한눈에 안 들어왔다. 끌어서 칸에 놓으면 그 시간대로 옮겨 가는 것도 그대로다. */
                              : (['오전', '오후'] as const).map(slot => {
                                  const 칸ids = 묶음.ids.filter(id => (deliveryTimeSlots[id] || '오전') === slot);
                                  return (
                                    <div key={slot} className="flex flex-col gap-1">
                                      <div
                                        className={`px-1 pt-1 text-[10px] font-black ${slot === '오전' ? 'text-amber-600' : 'text-indigo-500'}`}
                                        onDragOver={event => deliverySortMode === 'manual' && event.preventDefault()}
                                        onDrop={() => {
                                          if (deliverySortMode !== 'manual' || dragDeliveryId === null) return;
                                          saveTimeSlots({ ...deliveryTimeSlots, [dragDeliveryId]: slot });
                                          setDragDeliveryId(null);
                                        }}
                                      >{slot} <span className="tabular-nums opacity-60">{칸ids.length}</span></div>
                                      {칸ids.length === 0
                                        ? <p className="py-1 text-center text-[10px] font-bold text-slate-300">없음</p>
                                        : 칸ids.map(id => renderDeliveryRow(id, slot))}
                                    </div>
                                  );
                                })}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
              )}

            {/*  **주문 끌어오기 창** — 금일 배송순서에 담을 주문을 고른다.
                 후보는 지금 운영 중인 배송 대상(작업중·작업완료·출고완료) 전부다.
                 누른 차례가 곧 배송 순서라 동그라미에 번호를 보여 준다. */}
            {showDeliveryPicker && (
              <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setShowDeliveryPicker(false)}>
                <div className="flex max-h-[70vh] w-full max-w-sm flex-col rounded-3xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
                  <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <h3 className="font-black text-slate-900">금일 배송순서에 담기</h3>
                    <button type="button" onClick={() => setShowDeliveryPicker(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={16} /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {visibleDeliverySequenceOrders.length === 0 ? (
                      <p className="py-10 text-center text-sm text-slate-400">담을 주문이 없습니다.</p>
                    ) : visibleDeliverySequenceOrders.map(order => {
                      const 그곳 = partners.find(partner => partner.id === order.partnerId);
                      const 이름 = partnerLabel(그곳?.name || order.partnerName || '', shipToOf(그곳, order.shipToId)?.name);
                      const 골랐나 = pickerDeliveryOrdering.includes(order.id);
                      const 번호 = pickerDeliveryOrdering.indexOf(order.id) + 1;
                      return (
                        <button
                          key={order.id}
                          type="button"
                          onClick={() => setPickerDeliveryOrdering(현재 => 골랐나 ? 현재.filter(id => id !== order.id) : [...현재, order.id])}
                          className={`flex w-full items-center gap-3 border-b border-slate-50 px-5 py-3 text-left transition-colors hover:bg-slate-50 ${골랐나 ? 'bg-indigo-50/70' : ''}`}
                        >
                          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${골랐나 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{골랐나 ? 번호 : ''}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-bold text-slate-700">{이름}</span>
                              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-black ${statusChip(order.status)}`}>{statusLabel(order.status)}</span>
                            </span>
                            <span className="block truncate text-[10px] text-slate-400">{order.items.map(item => item.name).join(', ')}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t border-slate-100 p-4">
                    <button
                      type="button"
                      onClick={() => { saveDeliveryOrdering(pickerDeliveryOrdering); setDeliverySortMode('manual'); setShowDeliveryPicker(false); }}
                      className="w-full rounded-2xl bg-indigo-600 py-3 font-black text-white transition-colors hover:bg-indigo-700"
                    >고른 {pickerDeliveryOrdering.length}건으로 순서 정하기</button>
                  </div>
                </div>
              </div>
            )}

            {!calendarOnly && deliveryTab === '보드' && <div className="order-5 md:overflow-x-auto no-scrollbar">
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
      {(calendarOnly || deliveryTab === '캘린더') && (
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
        const 이날묶음 = groupsByDate[dayModal] ?? [];
        const 묶음찾기 = new Map<string, DeliveryGroup>();
        for (const group of 이날묶음) for (const id of group.orderIds) 묶음찾기.set(id, group);
        const 진행Rows: DayRow[] = clusterByGroup(진행.map(order => ({
          orderId: order.id,
          //  차례에 손으로 담긴 적 없는 줄 — 이제 날짜별 차례를 본다(전역 목록이 아니다).
          auto: !날짜차례(dayModal).includes(order.id),
          slot: deliveryTimeSlots[order.id] || '오전',
          done: order.status === OrderStatus.SHIPPED,
        })), row => row.orderId, id => 묶음찾기.get(id));
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
                {groupPick.date === dayModal && groupPick.ids.length > 0 && (
                  <button
                    type="button"
                    disabled={groupPick.ids.length < 2}
                    onClick={() => confirmGroup(dayModal)}
                    className="w-full rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                  >고른 {groupPick.ids.length}건 한 차로 묶기</button>
                )}
                {진행.length === 0 && 완료.length === 0 && (
                  <p className="py-12 text-center text-sm font-bold text-slate-300">이 날은 배송이 없습니다.</p>
                )}
                {진행Rows.length > 0 && (
                  <DeliveryDayList
                    rows={진행Rows}
                    orders={orders}
                    partners={partners}
                    dateStr={dayModal}
                    selected={groupPick.date === dayModal ? new Set(groupPick.ids) : new Set()}
                    on={{
                      open: order => { setDayModal(null); handleOrderClick(order); },
                      toggleDone: id => onToggleShipmentComplete?.(id, orders.find(order => order.id === id)?.status !== OrderStatus.SHIPPED),
                      reorder: next => saveDayOrdering(dayModal, next),
                      select: id => toggleGroupPick(dayModal, id),
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
                  <dt className="mb-1 font-medium text-slate-400">판매 채널</dt>
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
