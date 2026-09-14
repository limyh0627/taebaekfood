
import React, { useState, useEffect, useMemo, memo, useRef } from 'react';
import { today, dateOfLocal } from '../src/shared/day';
import { RotateCcw } from 'lucide-react';
import {
  Link2,
  Unlink,
  Plus,
  Clock,
  CalendarDays,
  LayoutDashboard,
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
  Layers,
  PauseCircle,
  Settings2,
  NotepadText,
  AlertTriangle,
  Minimize2,
  Maximize2
} from 'lucide-react';
import { Order, OrderStatus, Partner, OrderSource, OrderItem, Item, OrderPallet, DeliveryBox, PalletStock, ItemBom, PartnerItem, InvoiceType, INVOICE_TYPES } from '../types';
import { orderItemDetails } from '../src/shared/orderItemDetails';
import { splitNameVolume, specText } from '../src/shared/productChip';
import { isBulkItem } from '../src/shared/itemTaxonomy';
import { boxSiblings, isBoxStockItem, unpackComponent, unitsPerBoxOf } from '../src/shared/orderUnits';
import { bomOf } from '../src/shared/bomIndex';
import { subDotClass } from '../src/shared/submaterialStyle';
import { CHIP_NEUTRAL as SUB_CHIP_NEUTRAL, subChipClass } from '../src/shared/submaterialStyle';
import { lineKeyAt, lineSuffix } from '../src/shared/orderLine';
import { itemIndexOf } from '../src/shared/workItemLine';
import { clusterByGroup } from '../src/shared/rowGroup';
import { isLinkedToPartner } from '../src/shared/partnerPrice';
import { matchesSearch } from '../src/shared/hangul';
import { shipMethodOf } from '../src/shared/channelStyle';
import { groupStripes } from '../src/shared/groupStripe';
import SearchableSelect from '../src/shared/components/SearchableSelect';
import { subscribeDeliveryOrdering, saveDeliveryTimeSlot, DeliveryTimeSlot } from '../src/shared/deliveryTimeSlot';
import { subscribeToDocument, setDocument } from '../src/shared/services/firebaseService';

import ConfirmModal from './ConfirmModal';
import PageHeader from './PageHeader';
import { cardNoLabel } from '../src/shared/cardNo';
import { channelStyle } from '../src/shared/channelStyle';
import { DEFAULT_CATEGORY_LABELS } from '../src/shared/taxonomy';
import { CARD_HEADER_COLOR, STATUS_CARD_BORDER, STATUS_COLOR, STATUS_HEAD_LINE, STATUS_LABEL, statusLabel, statusChip, statusColumn } from '../src/shared/orderStatusStyle';

/** 이름 끝 용량은 뗀다 — 규격 칩이 이미 들고 있어 '참기름/병/A/300ml [300ml * 20]'처럼 겹친다. */
const baseName = (name: string): string => splitNameVolume({ name }).base;
import CalendarView from './CalendarView';
import Badge from '../src/shared/components/Badge';
import CompletionStatusControl from '../src/shared/components/CompletionStatusControl';
import OrderEditModalShell from './OrderEditModalShell';

// ─── 상수 ────────────────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  'Cap': '마개', 'Tape': '테이프', '박스': '박스', '용기': '용기', '라벨': '라벨',
};
const normalizeCategory = (cat: string) => CATEGORY_MAP[cat] || cat;

/**
 * 주문 카드 안 배지 줄 앞에 붙는 갈래 라벨(구성·부자재·라벨).
 * 너비를 고정해 여러 줄의 배지 시작점이 세로로 맞는다 — 그래야 목록으로 읽힌다.
 */
/* 라벨은 slate-500 이상 — slate-400은 흰 배경에서 대비 2.8:1로 WCAG AA(4.5:1) 미달이고
   10px 크기라 현장에서 특히 안 읽혔다. slate-500은 4.76:1로 통과한다. */
const CARD_ROW_LABEL = 'w-10 md:w-9 shrink-0 text-[11px] md:text-[10px] font-black text-slate-500';

interface EditableDeliveryDateProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * 표 안에서는 투명한 date input이 클릭 위치에 따라 연·월·일 조각만 포커스되는 문제가 있다.
 * 셀 전체를 하나의 명시적인 버튼으로 만들고, 사용자 동작 안에서 네이티브 선택기를 연다.
 */
const EditableDeliveryDate: React.FC<EditableDeliveryDateProps> = ({ label, value, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const openPicker = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    try {
      input.showPicker?.();
    } catch {
      input.click();
    }
  };

  return (
    <div className="relative w-full">
      <button
        type="button"
        onClick={openPicker}
        className="flex h-7 w-full items-center justify-start gap-1.5 rounded-md border border-slate-200 bg-slate-100 px-1.5 text-[10px] font-black tabular-nums text-indigo-600 transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        aria-label={`${label} 수정`}
      >
        <CalendarDays size={11} className="shrink-0 opacity-70" aria-hidden="true" />
        <span>{fmtYYMMDD(new Date(value))}</span>
      </button>
      <input
        ref={inputRef}
        type="date"
        value={value.slice(0, 10)}
        onChange={event => { if (event.target.value) onChange(event.target.value); }}
        className="pointer-events-none absolute bottom-0 left-1/2 h-px w-px -translate-x-1/2 opacity-0"
        aria-label={label}
        tabIndex={-1}
      />
    </div>
  );
};

interface CardDatePickerButtonProps {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  className: string;
  children: React.ReactNode;
  disabled?: boolean;
}

/**
 * 카드의 짧은 날짜 텍스트는 버튼으로 동작하고, 숨겨진 네이티브 입력은 값 선택만 담당한다.
 * 투명 input을 텍스트 위에 덮으면 브라우저별 클릭 영역 차이로 선택기가 열리지 않을 수 있다.
 */
const CardDatePickerButton: React.FC<CardDatePickerButtonProps> = ({ label, value = '', onChange, className, children, disabled = false }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const openPicker = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    try {
      input.showPicker?.();
    } catch {
      input.click();
    }
  };

  return (
    <span className="relative inline-flex">
      <button type="button" onClick={openPicker} disabled={disabled} className={className} aria-label={label} title="제조일을 선택하면 소비기한이 365일 뒤로 자동 계산됩니다">
        {children}
      </button>
      <input
        ref={inputRef}
        type="date"
        value={value.slice(0, 10)}
        disabled={disabled}
        aria-label={`${label} 날짜 선택`}
        className="pointer-events-none absolute bottom-0 left-1/2 h-px w-px -translate-x-1/2 opacity-0"
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
        onChange={event => { if (event.target.value) onChange(event.target.value); }}
      />
    </span>
  );
};

/**
 * 카드 안 칩 공통 모양 — 테두리·패딩·모서리는 전부 같고 색만 다르다.
 * 전엔 어떤 칩은 테두리가 있고(부자재·라벨) 어떤 건 없었으며(주문·진행률·팔레트)
 * 패딩도 px-1 / px-1.5 / px-2 세 가지가 섞여 있었다.
 * 테두리는 흰색·투명 부자재(테이프-투명, 마개-하양)가 흰 배경에서 사라지지 않게 하는 역할도 하므로
 * 없애는 대신 전부 넣는 쪽으로 맞춘다.
 */
const CARD_CHIP = 'px-1.5 py-0.5 rounded-md border';

/** 의미 없는 값에 쓰는 기본 칩 색 */
const CHIP_NEUTRAL = 'bg-slate-100 text-slate-600 border-slate-200';
/** 완료된 항목 — 끝난 일은 눈에 띄지 말고 물러나야 하므로 흐린 회색으로 둔다 */
const CHIP_DONE = 'bg-slate-50 text-slate-400 border-slate-200';

/**
 * 한국 시간 기준 오늘 (YYYY.MM.DD).
 * '금일' 작업순서가 어느 날짜인지 못 박아둔다. 기기 시간대가 무엇이든 공장 기준(Asia/Seoul) 날짜를 쓴다 —
 * 자정 무렵이나 해외에서 접속해도 현장과 같은 날짜를 봐야 하기 때문이다.
 */
const seoulToday = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}.${get('month')}.${get('day')}`;
};

/**
 * 카드 안 날짜 표기 — YY.MM.DD 하나로 통일한다.
 * 전엔 푸터(주문일자·배송기한)는 점, 소비기한만 `toISOString()`을 잘라 ISO 하이픈(`27-08-21`)이라
 * 한 카드에 두 형식이 섞였고 앞의 `~`가 마이너스처럼 읽혔다.
 * toISOString()은 UTC로 바꾸므로 표시용으로는 지역 시간 게터를 쓴다.
 */
const fmtYYMMDD = (d: Date) =>
  `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

/** 제조일을 포함해 365일째 되는 날을 소비기한으로 표시한다. */
const expiryFromMfgDate = (mfgDate: string) => {
  const d = new Date(`${mfgDate.slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() + 365);
  return d;
};

const seoulDateInput = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

const seoulWeekStart = () => {
  const today = seoulDateInput();
  const date = new Date(`${today}T00:00:00+09:00`);
  const daysFromMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysFromMonday);
  return seoulDateInput(date);
};

/**
 * 화면에서 박스 재고 상품으로 볼 수 있는 경우만 개입수를 반환한다.
 * 단일 BOM 수량만 보면 스마트스토어 상품의 원액 사용량(예: 1.649kg)을
 * 개입수로 오인할 수 있으므로, 박스 표식과 2 이상의 정수 수량을 함께 확인한다.
 */
const inventoryBoxPackCount = (product: Item | undefined): number | undefined => {
  return product && isBoxStockItem(product) ? unitsPerBoxOf(product) || undefined : undefined;
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
  /**
   * 송장 칸을 바꾼다. `boolean` 은 옛 뜻(출력 했나/안 했나)이고,
   * `'printed' | 'attached' | undefined` 는 **세 단계**다(2026-09-11 사장님).
   * 받는 쪽이 둘을 같이 저장해 옛 화면과 어긋나지 않게 한다.
   */
  onToggleInvoicePrinted?: (id: string, value: boolean | 'printed' | 'attached' | undefined) => void;
  /** 송장 양식(A~E)을 고른다. 안 고름은 `undefined`. */
  onUpdateInvoiceType?: (id: string, value: InvoiceType | undefined) => void;
  onToggleShipmentComplete?: (id: string, value: boolean) => void;
  onToggleItemChecked?: (orderId: string, itemIdx: number, checkedBy?: string) => void;
  onDeleteOrder: (id: string) => void;
  onAddClick: () => void;
  onPasteClick?: () => void;
  currentUserName?: string;
  highlightOrderId?: string | null;
  onHighlightClear?: () => void;
  newOrderId?: string | null;
  onNewOrderIdClear?: () => void;
  workOrderItems?: { key: string; orderId: string; itemId: string; lineKey?: string; itemName: string; partnerName: string; qty: number; category: string; groupId?: string; groupName?: string }[];
  onSetWorkOrderItems?: (items: { key: string; orderId: string; itemId: string; lineKey?: string; itemName: string; partnerName: string; qty: number; category: string; groupId?: string; groupName?: string }[]) => void;
  onLoadHistoricalOrders?: (start: string, end: string) => Promise<void>;
  isLoadingHistoricalOrders?: boolean;
  ordersMonths?: number;
  onChangeOrdersMonths?: (n: number) => void;
  embeddedListOnly?: boolean;
  /**
   * **캘린더 탭에 끼워 넣을 화면.** 안 주면 이 파일의 `CalendarView` 를 그린다.
   *
   * 2026-09-11 사장님: "캘린더는 배송관리쪽꺼 쓰고 나머지 리스트랑 보드는 주문관리쪽꺼 쓸거고".
   * 주문·배송을 한 화면으로 합치면서, 탭바·검색·금일 작업순서는 이쪽(주문) 것을 그대로 쓰고
   * **캘린더 자리만** 배송 캘린더로 바꿔 끼운다. 탭바가 둘이 되지 않게 하려는 것이다.
   */
  /**
   * 안 주면 이 파일의 `CalendarView` 를 그린다. **지금 고른 정렬을 넘겨 준다** —
   * 검색조건 안의 고르개가 캘린더에서도 들어야 한다(2026-09-11 사장님:
   * "검색조건이랑 붙어다니게 해야지 코드가").
   */
  calendarSlot?: (_sort: 'delivery' | 'order' | 'stock' | 'workLow' | 'workHigh') => React.ReactNode;
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
  /**
   * 송장 칸을 바꾼다. `boolean` 은 옛 뜻(출력 했나/안 했나)이고,
   * `'printed' | 'attached' | undefined` 는 **세 단계**다(2026-09-11 사장님).
   * 받는 쪽이 둘을 같이 저장해 옛 화면과 어긋나지 않게 한다.
   */
  onToggleInvoicePrinted?: (id: string, value: boolean | 'printed' | 'attached' | undefined) => void;
  /** 송장 양식(A~E)을 고른다. 안 고름은 `undefined`. */
  onUpdateInvoiceType?: (id: string, value: InvoiceType | undefined) => void;
  onToggleItemChecked?: (orderId: string, itemIdx: number, checkedBy?: string) => void;
  onDeleteOrder: (id: string) => void;
  currentUserName?: string;
  gridCols?: number;
  isListView?: boolean;
  tintedHeader?: boolean;
  isHighlighted?: boolean;
  highlightOrderId?: string | null;
  /** 상세 확인 팝업에서는 주문 내용을 보여주되 편집·상태변경은 열지 않는다. */
  readOnly?: boolean;
  /** 주문관리의 모든 보기에서 동일한 거래처 주문 수정 모달을 연다. */
  onEditOrder?: (orderId: string) => void;
  /** 보드 카드 헤더에서 품목 메모를 바로 연다. */
  onOpenMemo?: (orderId: string, itemIndex: number) => void;
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
  /**
   * 송장 칸을 바꾼다. `boolean` 은 옛 뜻(출력 했나/안 했나)이고,
   * `'printed' | 'attached' | undefined` 는 **세 단계**다(2026-09-11 사장님).
   * 받는 쪽이 둘을 같이 저장해 옛 화면과 어긋나지 않게 한다.
   */
  onToggleInvoicePrinted?: (id: string, value: boolean | 'printed' | 'attached' | undefined) => void;
  onToggleItemChecked?: (orderId: string, itemIdx: number, checkedBy?: string) => void;
  onDeleteOrder: (id: string) => void;
  currentUserName?: string;
  isListView?: boolean;
  highlightOrderId?: string | null;
  onCardClick?: (orderId: string) => void;
  onEditOrder?: (orderId: string) => void;
  onOpenMemo?: (orderId: string, itemIndex: number) => void;
  tintedHeader?: boolean;
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

/**
 * **주문 카드 — 보드·리스트 공용.**
 *
 * 2026-09-11 사장님: "보드 카드 UI 형태만 전에 걸로 가져와". 병합(`a08a811`)으로 들어온
 * 새 카드 대신 **그 전에 쓰던 카드 모양**을 그대로 되돌린다 — 줄마다 제조·라벨·포장·팔레트를
 * 펼치고 부자재를 색 딱지로 찍던 그 카드다.
 *
 * `OrderCardProps` 는 **새것을 그대로 둔다** — 호출부가 넘기는 `onEditOrder`·`onOpenMemo`·
 * `tintedHeader` 같은 새 props 를 이 본문은 안 쓰고 흘려보낸다. 인터페이스까지 되돌리면
 * 그걸 넘기는 자리가 전부 타입 오류가 난다.
 */
export const OrderCard = memo<OrderCardProps>(({
  order, partners, items, partnerItems,
  editingOrderId, setEditingOrderId,
  showAddProductSelect, setShowAddProductSelect,
  onUpdateItems, onUpdateDeliveryDate, onUpdateStatus, onUpdatePallets,
  onToggleInvoicePrinted, onUpdateInvoiceType,
  onToggleItemChecked, onDeleteOrder, currentUserName, gridCols = 1, isHighlighted = false, highlightOrderId, palletStocks = [], itemBoms = [], readOnly = false,
  //  이름+연필을 누르면 이걸 부른다 — 리스트와 같은 '거래처 주문 수정' 창을 여는 문.
  onEditOrder,
}) => {
  // Compute derived variables
  const products = items;
  const highlighted = isHighlighted || highlightOrderId === order.id;
  const isEditing = editingOrderId === order.id;
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; confirmText?: string; onConfirm: () => void } | null>(null);
  const [expandedItemBom, setExpandedItemBom] = useState<Set<string>>(new Set()); // 박스 완제품 구성 펼치기
  //  줄마다 구성(BOM)을 폈나 — **기본은 접힘**(2026-09-12 사장님: "bom 접었다 펼 수 있게")
  const [openItemBom, setOpenItemBom] = useState<Set<string>>(new Set());
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
      quantity: 1, price: 0, checked: false,
    };
    onUpdateItems?.(order.id, [...order.items, newItem]);
    setShowAddProductSelect(null);
  };

  return (
    <div
      id={`order-card-${order.id}`}
      draggable={!readOnly && !isEditing}
      onDragStart={(e) => { e.dataTransfer.setData('orderId', order.id); e.dataTransfer.effectAllowed = 'move'; }}
      /*  **카드 아무 데나 눌러서 편집에 들어가지 않는다**(2026-09-11 사장님: "이름부터 그쪽까지만
          누르면 수정하는 거고"). 카드 표면 대부분이 체크·수량 같은 조작이라, 아무 데나 눌러도
          편집이 열리면 누르려던 것과 엉킨다. 여는 자리는 **이름 + 연필**뿐이다. */
      className={`bg-white rounded-2xl shadow-sm border transition-all group relative animate-in zoom-in-95 duration-200 ${isEditing ? 'ring-2 ring-indigo-500 border-indigo-200 shadow-xl z-20' : highlighted ? 'ring-2 ring-amber-400 border-amber-300 shadow-lg shadow-amber-100' : `${STATUS_CARD_BORDER[order.status] ?? 'border-slate-200'}${readOnly ? '' : ' hover:shadow-md cursor-pointer'}`} ${isCollapsed ? 'p-2.5' : 'p-4'} flex flex-col`}
    >
      {/*  머리 띠 — 카드 좌우 끝까지 닿게 음수 여백으로 빼고 위 모서리만 둥글린다.
           **바탕색도 아래 선도 뺐다**(2026-09-12 사장님) — 상태는 **글자색으로만** 알린다.
           색을 통째로 깔면 정작 거래처명이 안 읽혔다. */}
      <div className={`flex flex-col rounded-t-2xl ${STATUS_HEAD_LINE[order.status] ?? 'text-slate-600'} ${
        isCollapsed ? '-mx-2.5 -mt-2.5 px-2.5 py-1.5 mb-1.5' : '-mx-4 -mt-4 px-4 py-2.5 mb-3'}`}>
        {/*  **첫 줄은 주문번호와 상태, 둘째 줄은 거래처명 통째로**(2026-09-14 사장님:
             "출고완료 3/5 이거 위로 올려서 주문 번호랑 같은 행에 두고 거래처명이 한 행
             온전히 쓸 수 있게"). 상태가 이름 옆에 있으면 긴 거래처명이 밀려 잘렸다 —
             주문번호는 짧아서 옆자리가 남는다. */}
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-[9px] font-black tabular-nums opacity-60">{cardNoLabel(order)}</p>
        {/* 주문 상태 — 카드 **우측 상단**. 거래처명 옆에 두니 이름이 길 때 밀려 안 보였다.
            드롭다운은 오른쪽 기준으로 펼친다(왼쪽 기준이면 카드 밖으로 나간다). */}
        {/*  **상태와 진행도는 한 줄이다** — `작업중 3/5`
             (2026-09-12 사장님: "보드에 작업중 3/5 이걸 한줄로 넣자").
             같은 날 앞서 "0/1이거는 대기중 작업중 밑으로" 하셔서 두 줄로 쌓았는데, 그러면
             카드 머리가 한 줄 더 높아졌다. 이름은 이미 왼쪽에서 제 자리를 잡으므로
             오른쪽 두 조각을 옆으로 붙여도 이름을 안 밀어낸다. 눌러서 접는 것도 그대로다.
             **글줄 바닥(baseline)으로 맞춘다** — 둘은 글자 크기가 달라(11px·10px) 상자 가운데로
             맞추면 작은 쪽이 떠 보인다(2026-09-12 사장님: "대기중이랑 정렬이 안맞냐"). */}
        <div className="flex shrink-0 items-baseline gap-1.5 leading-tight">
        <div className="relative shrink-0">
          {readOnly ? (
            <span className="text-[11px] font-black opacity-80">{STATUS_LABEL[order.status] ?? order.status}</span>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowStatusPicker(p => !p); }}
              className="text-[11px] font-black transition-all hover:opacity-70 opacity-80"
            >
              {STATUS_LABEL[order.status] ?? order.status}
            </button>
          )}
          {!readOnly && showStatusPicker && (
            <div
              className="absolute top-full right-0 mt-1 z-50 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden flex flex-col min-w-[72px]"
              onClick={(e) => e.stopPropagation()}
            >
              {([
                [OrderStatus.PENDING,    statusLabel(OrderStatus.PENDING),    'hover:bg-amber-50 text-amber-700'],
                [OrderStatus.PROCESSING, statusLabel(OrderStatus.PROCESSING), 'hover:bg-sky-50 text-sky-700'],
                [OrderStatus.DISPATCHED, statusLabel(OrderStatus.DISPATCHED), 'hover:bg-emerald-50 text-emerald-700'],
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
          {nonHyangmiyuItems.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIsCollapsed(prev => !prev); }}
              className="text-[10px] font-black opacity-70 transition-all hover:opacity-100"
            >
              {completedItems}/{totalItems}
            </button>
          )}
        </div>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          {/*  **판매 채널은 거래처명 앞**(사장님: "배송채널은 거래처명 앞으로 가고").
               꼬리 구석에 작게 적혀 있어 안 읽혔다. 색은 channelStyle 한 곳이 정한다. */}
          <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-black ${channelStyle(order.source).chip}`}>
            {channelStyle(order.source).short}
          </span>
          {/*  **이름 + 연필까지가 '수정' 자리다.** 누르면 리스트에서 쓰는 것과 **같은**
               `거래처 주문 수정` 창이 뜬다(2026-09-11 사장님: "리스트 쪽에 붙은 거래처 주문 수정
               모달띄우는걸로 바꿔 기존 방식 버리고"). 카드 안에서 직접 고치던 옛 방식은 버린다 —
               같은 일을 두 가지 모양으로 하면 어느 쪽이 맞는지 매번 헷갈린다.
               색을 안 준다 — 머리 띠의 상태 글자색을 물려받아 상태와 같은 색이 된다. */}
          {onEditOrder && !readOnly ? (
            <button
              type="button"
              onClick={event => { event.stopPropagation(); onEditOrder(order.id); }}
              aria-label={`${displayName} 주문 수정`}
              className="flex min-w-0 items-center gap-1 rounded-md px-1 -mx-1 text-left transition-opacity hover:opacity-70"
            >
              <h4 className="font-black leading-tight text-base break-words">{displayName}</h4>
              <Edit2 size={13} className="shrink-0 opacity-60" aria-hidden="true" />
            </button>
          ) : (
            <h4 className="font-black leading-tight text-base break-words">{displayName}</h4>
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
              /*
               *  **낱개↔박스 토글은 없앴다**(2026-09-09 사장님: "수정화면에는 토글이 없이
               *  그냥 박스면 박스다 낱개면 낱개다가 맞다").
               *
               *  박스로 받을지는 **주문을 넣을 때** 정해지는 것이지 나중에 뒤집을 일이 아니다.
               *  끄는 쪽이 반쪽이라 사고가 났다 — 박스 20으로 넣은 뒤 낱개로 끄면 `isBoxUnit` 만
               *  꺼지고 `quantity` 는 낱개(200)로 남아, 재고가 200을 박스로 읽었다(무경유통 2,000kg).
               *  단위를 바꿔야 하면 줄을 지우고 다시 담는다.
               */
              // 주문에 박힌 값 → 품목이 아는 개입수(BOM 아니면 포장 환산표)
              const qtyPerBox = item.unitsPerBox ?? unitsPerBoxOf(editProductInfo);
              //  개입수를 아는 품목(박스 품목·향미유·고춧가루)에는 제조일자 칸을 안 띄운다
              const 개입수있음 = unitsPerBoxOf(editProductInfo) > 0;
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
                    {/*  박스로 받은 줄임을 **보여주기만** 한다 — 여기서 못 바꾼다.
                         박스 품목은 품목 자체가 박스라 이 딱지가 안 붙는다. */}
                    {item.isBoxUnit && (
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded border bg-indigo-100 border-indigo-300 text-indigo-700 shrink-0">
                        박스
                      </span>
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
                  {!개입수있음 && (
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
                /*  **누르면 작업완료가 되는 자리는 체크칸과 품목명뿐이다**(2026-09-12 사장님:
                    "눌러서 주문 완료 되는 위치는 딱 체크박스랑 품목명 있는 부분으로 해").
                    전에는 줄 전체가 눌림을 받아, 밑에 달린 라벨·소비기한을 만지려다 완료가
                    켜졌다 꺼졌다 했다. 규격·수량·부자재 줄은 이제 눌러도 아무 일이 없다. */
                <div key={idx} className="flex flex-col border-b border-slate-100 pb-2.5 last:border-0 last:pb-0">
                  <div className="flex items-center text-[12px] font-bold">
                    <button
                      type="button" disabled={readOnly}
                      onClick={(e) => { e.stopPropagation(); onToggleItemChecked?.(order.id, idx, currentUserName); }}
                      aria-pressed={isItemChecked}
                      aria-label={`${item.name} 작업 완료 전환`}
                      className="flex min-w-0 select-none items-center text-left disabled:cursor-default"
                    >
                      <div className={`mr-1.5 shrink-0 ${isItemChecked ? 'text-emerald-600' : 'text-slate-300'}`}>
                        {isItemChecked ? <CheckSquare size={14} /> : <Square size={14} />}
                      </div>
                      <span className={`break-words min-w-0 ${isItemChecked ? 'text-emerald-800 line-through opacity-50' : 'text-slate-700'}`}>{abbrev(baseName(item.name))}</span>
                    </button>
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
                    const 구성폄 = openItemBom.has(rowKey);
                    const 구성수 = allSubs.length + bomProducts.length;
                    return (
                      <>
                      {/*  **구성은 접어 둔다**(2026-09-12 사장님: "카드에서 bom 접었다 펼 수 있게
                           바꾸고"). 부자재·낱개는 만들 때 한 번 보는 참고인데, 늘 펴져 있어
                           카드마다 두세 줄을 먹고 정작 손대는 라벨·소비기한을 밀어냈다.
                           몇 개가 들었는지는 접힌 채로도 보이게 수를 적는다. */}
                      <button
                        type="button"
                        onClick={event => { event.stopPropagation(); setOpenItemBom(이전 => { const 다음 = new Set(이전); 다음.has(rowKey) ? 다음.delete(rowKey) : 다음.add(rowKey); return 다음; }); }}
                        aria-expanded={구성폄}
                        className="mt-1.5 ml-[20px] inline-flex items-center gap-1 rounded px-1 text-[10px] font-black text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                      >
                        <ChevronDown size={11} className={`transition-transform ${구성폄 ? 'rotate-180' : ''}`} aria-hidden="true" />
                        구성 <span className="tabular-nums">{구성수}</span>
                      </button>
                      {구성폄 && (<>
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
                      </>)}
                      </>
                    );
                  })()}
                  {/*  **라벨 상태·소비기한은 구성(BOM) 아래**(2026-09-12 사장님: "라벨이랑
                       소비기한이 아래로 내려오게 해 bom보다"). 구성은 접어 두는 참고이고,
                       이 둘은 **여기서 손대는 것**이라 손이 가는 것을 아래에 둔다.
                       소비기한은 안 정해져 있어도 자리를 지킨다: 비어 있다는 걸 보여야 채워 넣는다. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5 pl-[20px]">
                    {/*  **리스트에서 쓰는 고르개·날짜칸 그대로**(2026-09-12 사장님: "대기 소비기한
                         설정 저거 리스트에 있는 버튼 모양들로 그대로 대체하고"). 여기만 눌러 돌리는
                         딱지와 밑줄 글자를 써서, 같은 일을 두 모양으로 하고 있었다.
                         읽기전용(주문 고르기 창)에서는 잠근다. */}
                    <div className="relative w-[58px] shrink-0" onClick={(e) => e.stopPropagation()} onPointerDown={누르는동안끌기끄기}>
                      <select
                        value={current} disabled={readOnly}
                        onChange={(e) => { const ni = [...order.items]; ni[idx] = { ...ni[idx], labelType: e.target.value as '대기' | '날인' | '부착' }; onUpdateItems?.(order.id, ni); }}
                        aria-label={`${item.name} 라벨 상태`}
                        className={`h-7 w-full cursor-pointer appearance-none rounded-md border border-slate-200 pl-2 pr-5 text-[10px] font-black outline-none transition-colors focus:ring-1 focus:ring-indigo-400 disabled:cursor-default disabled:opacity-60 ${current === '대기' ? 'bg-slate-100 font-bold text-slate-700 enabled:hover:bg-slate-200' : 'bg-slate-100 text-slate-700 enabled:hover:bg-slate-200'}`}
                      >
                        <option value="대기">-</option>
                        <option value="날인">날인</option>
                        <option value="부착">부착</option>
                      </select>
                      <ChevronDown size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    </div>
                    <div className="relative h-7 w-[92px] shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-[10px] font-black transition-colors hover:bg-slate-200 focus-within:ring-1 focus-within:ring-indigo-400"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={누르는동안끌기끄기}
                      title="제조일을 고르면 1년 뒤로 소비기한이 잡힙니다">
                      <input
                        type="date" value={item.mfgDate || ''} disabled={readOnly}
                        onChange={(e) => { e.stopPropagation(); handleExpirationDateChange(idx, e.target.value); }}
                        aria-label={`${item.name} 소비기한 수정용 제조일`}
                        className="peer absolute inset-0 z-10 h-full w-full min-w-0 cursor-pointer opacity-0 disabled:cursor-default"
                      />
                      <span className={`pointer-events-none flex h-full min-w-0 items-center gap-1 px-1.5 ${item.mfgDate ? 'text-indigo-600' : 'text-slate-700'}`}>
                        <CalendarDays size={11} className="shrink-0" aria-hidden="true" />
                        <span className="min-w-0 truncate tabular-nums">{item.mfgDate ? fmtYYMMDD(expiryFromMfgDate(item.mfgDate)) : '-'}</span>
                      </span>
                    </div>
                    {item.checked && item.checkedBy && (
                      <span className="text-[11px] font-bold text-slate-400 shrink-0">{item.checkedBy}</span>
                    )}
                    {productInfo?.oil && <span className="text-[11px] text-indigo-500 font-bold shrink-0">{productInfo.oil}</span>}
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
                              <span className={`${isItemChecked ? 'line-through text-slate-400' : 'text-slate-700'}`}>{abbrev(baseName(item.name))}{lineSuffix(order.items, idx)}</span>
                              {(() => {
                                const _p = items.find(p => p.id === item.itemId);
                                const sp = _p ? (specText(_p.spec) || splitNameVolume(_p).vol) : '';
                                return sp ? <span className="ml-1.5 shrink-0 text-slate-400">{sp}</span> : null;
                              })()}
                            </div>
                            <span className={`text-[8px] font-black shrink-0 ${isItemChecked ? 'text-emerald-700 bg-emerald-100' : 'text-teal-600 bg-teal-50'} px-1 py-0.5 rounded`}>
                              {item.isBoxUnit && item.boxQuantity
                                ? `${item.boxQuantity}B`
                                : `${item.quantity}${items.find(p => p.id === item.itemId)?.unit || '개'}`}
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
                              <span className={`${isItemChecked ? 'line-through text-slate-400' : 'text-slate-700'}`}>{baseName(item.name)}{lineSuffix(order.items, idx)}</span>
                              {(() => {
                                const _p = items.find(p => p.id === item.itemId);
                                const sp = _p ? (specText(_p.spec) || splitNameVolume(_p).vol) : '';
                                return sp ? <span className="ml-1.5 shrink-0 text-slate-400">{sp}</span> : null;
                              })()}
                            </div>
                            <span className={`text-[8px] font-black shrink-0 ${isItemChecked ? 'text-emerald-700 bg-emerald-100' : 'text-orange-600 bg-orange-50'} px-1 py-0.5 rounded`}>
                              {item.isBoxUnit && item.boxQuantity
                                ? `${item.boxQuantity}B`
                                : `${item.quantity}${items.find(p => p.id === item.itemId)?.unit || '개'}`}
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
                const orderable = (p: Item) => linkedIds.has(p.id);   // 연결은 partner_item 하나가 근거다(2026-09-06)
                /**
                 * **낱개↔박스는 한 줄에 토글로.** 둘을 따로 띄우면 이름이 같아 어느 쪽을 눌렀는지
                 * 모르고, 목록도 두 배로 길어진다. 주문 추가 화면과 같은 규칙이다.
                 * 짝 없이 홀로 있는 박스는 그대로 띄운다.
                 */
                const pool = items
                  .filter(p => !p.archived && !already.has(p.id) && orderable(p))
                  .filter(p => !(isBoxStockItem(p) && items.some(x => !x.archived && x.id === unpackComponent(p)?.itemId)))
                  .filter(p => !q || matchesSearch(p.name, q) || matchesSearch(String(p.spec ?? ''), q));
                //  이름표는 shared/taxonomy 한 곳에서 온다
                const TYPE_LABEL = DEFAULT_CATEGORY_LABELS;
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
              {/*  **팔레트 위에 출고 방식**(사장님: "팔레트 위에 출고 방식이 오게 해봐").
                   배송·직접수령·택배. 안 적힌 옛 주문은 판매 채널로 읽는다(`shipMethodOf`).
                   여기 있던 판매 채널은 거래처명 앞으로 옮겼다. */}
              <span className="text-[9px] font-black text-slate-500">{shipMethodOf(order)}</span>
              {/*  **택배면 송장, 아니면 팔레트**(2026-09-12 사장님: "보드에 카드에도 같은 방식으로
                   바꾸고"). 리스트의 '출고 방식' 칸과 같은 셈이다 — 택배로 나가면 팔레트가 돌
                   일이 없고, 우리 차가 돌면 송장이 붙을 일이 없다.
                   송장은 **양식(A~E)** 과 **세 단계**(`-`→출력→부착)를 나란히 둔다. */}
              {shipMethodOf(order) === '택배' ? (
                <div className="flex items-center gap-1">
                  <select
                    value={order.invoiceType ?? ''}
                    onChange={event => { event.stopPropagation(); onUpdateInvoiceType?.(order.id, (event.target.value || undefined) as InvoiceType | undefined); }}
                    onClick={event => event.stopPropagation()}
                    disabled={!onUpdateInvoiceType || readOnly}
                    aria-label="송장 양식"
                    title="송장 양식"
                    className="h-5 cursor-pointer rounded bg-slate-100 px-1 text-[8px] font-black text-slate-600 outline-none disabled:cursor-default disabled:text-slate-300"
                  >
                    <option value="">-</option>
                    {INVOICE_TYPES.map(양식 => <option key={양식} value={양식}>{양식}</option>)}
                  </select>
                  {(() => {
                    const 단계 = order.invoiceStage ?? (order.invoicePrinted ? 'printed' : undefined);
                    const 다음: Record<string, 'printed' | 'attached' | undefined> = { undefined: 'printed', printed: 'attached', attached: undefined };
                    const 글자 = 단계 === 'attached' ? '부착' : 단계 === 'printed' ? '출력' : '송장';
                    const 색 = 단계 === 'attached' ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                      : 단계 === 'printed' ? 'bg-sky-500 text-white hover:bg-sky-600'
                      : 'bg-slate-100 text-slate-400 hover:bg-slate-200';
                    return (
                      <button
                        type="button"
                        onClick={event => { event.stopPropagation(); onToggleInvoicePrinted?.(order.id, 다음[String(단계)]); }}
                        disabled={!onToggleInvoicePrinted || readOnly}
                        title="눌러서 - → 출력 → 부착"
                        className={`rounded px-1.5 py-0.5 text-[8px] font-black transition-all disabled:cursor-default ${색}`}
                      >{글자}</button>
                    );
                  })()}
                </div>
              ) : palletStocks.length > 0 && onUpdatePallets ? (
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
              ) : null}
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
              [OrderStatus.PENDING, statusLabel(OrderStatus.PENDING)],
              [OrderStatus.PROCESSING, statusLabel(OrderStatus.PROCESSING)],
              [OrderStatus.DISPATCHED, statusLabel(OrderStatus.DISPATCHED)],
              [OrderStatus.ON_HOLD, statusLabel(OrderStatus.ON_HOLD)],
              [OrderStatus.SHIPPED, statusLabel(OrderStatus.SHIPPED)],
            ] as [OrderStatus, string][]).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
          <button onClick={() => setConfirmModal({
              message: '주문을 삭제하시겠습니까?',
              subMessage: order.status === OrderStatus.DELIVERED
                ? `${partners.find(c => c.id === order.partnerId)?.name ?? ''} · 예전 주문 기록만 삭제하며 재고·BOM은 원복하지 않습니다.`
                : `${partners.find(c => c.id === order.partnerId)?.name ?? ''} · 삭제 후 복구할 수 없습니다.`,
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

//  채널 아이콘·색은 [shared/channelStyle](../src/shared/channelStyle) 한 곳이 정한다.
//  여기만 색을 `text-`/`bg-` 로 나눠 쓰고 있었다 — 모듈이 둘 다 낸다.
const sourceConfig = (s: string) => {
  const c = channelStyle(s);
  return { icon: c.icon, color: c.fg, bgColor: c.bg };
};

const OrderSourceGroup = memo<OrderSourceGroupProps>(({
  colId, source, orders, gridCols = 1,
  collapsedCategories, onToggleCategory,
  ...cardProps
}) => {
  const isCollapsed = collapsedCategories.has(`${colId}-${source}`);
  if (orders.length === 0) return null;

  const config = sourceConfig(source) || { icon: Box, color: 'text-slate-600', bgColor: 'bg-slate-50' };
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

// 기본은 전부 1열 — 2열이 기본이면 카드 폭이 좁아져 품목명이 줄바꿈되고 부자재 칩까지 grid-cols-2로
// 눌려서 더 빽빽해 보였다(484행). 필요하면 컬럼 헤더의 ‹› 버튼으로 여전히 넓힐 수 있다.
const defaultUnits: Record<string, number> = { pending_col: 1, processing_col: 1, dispatch_col: 1, shipped_col: 1, hold_col: 1, delivered_col: 1 };
const maxUnits: Record<string, number> = { pending_col: 2, processing_col: 3, dispatch_col: 2, shipped_col: 2, hold_col: 2, delivered_col: 2 };

//  칸 색은 상태에서 나온다 — [shared/orderStatusStyle](../src/shared/orderStatusStyle) 의
//  `statusColumn` 이 점·배경·테두리·글자색을 한 벌로 낸다. 상태 색을 고치면 칸도 따라간다.
const 칸 = (id: string, st: OrderStatus, icon: any, label?: string) => ({
  id, icon, label: label ?? statusLabel(st), ...statusColumn(st),
  statusFilter: [st], targetStatus: st,
});
const activeConfigs = [
  칸('pending_col', OrderStatus.PENDING, Clock),
  칸('processing_col', OrderStatus.PROCESSING, Activity),
  칸('dispatch_col', OrderStatus.DISPATCHED, Truck),
  칸('shipped_col', OrderStatus.SHIPPED, Truck),
  칸('hold_col', OrderStatus.ON_HOLD, PauseCircle),
];

/*  **그룹마다 색이 다르다**(2026-09-12 사장님: "그룹별로 색 다르게").
    작업순서 설정 창에서 칩도 줄도 다 보라라, 어느 줄이 어느 그룹에 담겼는지 **이름을 읽어야**
    알았다. 그룹 차례대로 색을 돌려 쓴다 — 여섯 번째부터는 처음 색을 다시 쓴다.

    **클래스 이름은 통째로 적는다** — Tailwind 는 글자를 찾아 만들기 때문에
    `bg-${색}-50` 처럼 이어 붙이면 그 클래스가 아예 안 만들어진다. */
const 그룹색표 = [
  { 칩: 'border-violet-400 bg-violet-50 text-violet-700', 줄: 'bg-violet-50', 번호: 'bg-violet-600 border-violet-600', 글자: 'text-violet-500' },
  { 칩: 'border-amber-400 bg-amber-50 text-amber-700', 줄: 'bg-amber-50', 번호: 'bg-amber-500 border-amber-500', 글자: 'text-amber-600' },
  { 칩: 'border-emerald-400 bg-emerald-50 text-emerald-700', 줄: 'bg-emerald-50', 번호: 'bg-emerald-600 border-emerald-600', 글자: 'text-emerald-600' },
  { 칩: 'border-sky-400 bg-sky-50 text-sky-700', 줄: 'bg-sky-50', 번호: 'bg-sky-600 border-sky-600', 글자: 'text-sky-600' },
  { 칩: 'border-rose-400 bg-rose-50 text-rose-700', 줄: 'bg-rose-50', 번호: 'bg-rose-600 border-rose-600', 글자: 'text-rose-600' },
];
const 그룹색 = (groups: readonly string[], name: string | undefined) => {
  const 자리 = name ? groups.indexOf(name) : -1;
  return 그룹색표[(자리 < 0 ? 0 : 자리) % 그룹색표.length];
};

/**
 * **끌 수 있는 카드 안의 입력칸을 살린다.**
 *
 * 크롬은 `draggable` 인 조상 안에서 입력칸을 누르면 그 눌림을 **끌기로 먹어 버린다** —
 * 소비기한 달력이 안 열리고 라벨 고르개도 잘 안 잡힌다(2026-09-12 사장님: "달력 안 눌리는거").
 * 보드 카드는 칸 사이로 끌어 옮기는 것이라 카드째 끌리는 것을 없앨 수 없으니,
 * **누르는 동안만** 끌기를 꺼 두고 손을 떼면 되돌린다.
 */
const 누르는동안끌기끄기 = (event: React.PointerEvent) => {
  const 카드 = (event.currentTarget as HTMLElement).closest('[draggable="true"]') as HTMLElement | null;
  if (!카드) return;
  카드.draggable = false;
  const 되돌리기 = () => {
    카드.draggable = true;
    window.removeEventListener('pointerup', 되돌리기);
    window.removeEventListener('pointercancel', 되돌리기);
  };
  window.addEventListener('pointerup', 되돌리기);
  window.addEventListener('pointercancel', 되돌리기);
};

//  예전 주문 칸은 옮길 데가 없다 — targetStatus 를 비운다
const historyConfig = { ...칸('history_col', OrderStatus.DELIVERED, History, '예전 주문 이력'), targetStatus: undefined };

//  짧은 목록이라 검색칸이 안 뜬다(SearchableSelect 의 `searchThreshold`) — 전과 똑같이 동작한다.
const 검색필드목록 = [
  { value: '', label: '필드 선택' },
  /*  **두 축을 이름으로 갈라 둔다**(2026-09-12 사장님: "이름을 배송 채널이 아니라 판매
      채널이라고", "배송 방식이 아니라 출고 방식으로 통일해라").
        · `판매 채널` = 거래처가 들고 있는 것(일반·택배·스마트스토어) — 예전 이름이 '출고 방식'
          이었는데 그건 채널을 가리키던 잘못된 이름이었다.
        · `출고 방식` = 주문마다 고르는 것(배송·직접수령·택배). */
  { value: 'source', label: '판매 채널' },
  { value: 'shipMethod', label: '출고 방식' },
  { value: 'invoicePrinted', label: '송장' },
  { value: 'completion', label: '작업완료 여부' },
  { value: 'item', label: '주문 품목' },
  { value: 'manufacturing', label: '품목명' },
  { value: 'label', label: '라벨 작업' },
  { value: 'deliveryDate', label: '출고예정일' },
];
const 정렬목록 = [
  { value: 'delivery', label: '출고예정일 임박 순' },
  { value: 'order', label: '주문일 최신 순' },
  { value: 'stock', label: '재고 여유 순' },
  //  **작업도 = 그 주문에서 체크가 끝난 품목 비율**(2026-09-12 사장님).
  //  낮은 순은 '아직 손도 안 댄 것'부터, 높은 순은 '조금만 더 하면 끝나는 것'부터 본다.
  { value: 'workLow', label: '작업도 낮은 순' },
  { value: 'workHigh', label: '작업도 높은 순' },
];

const OrdersList: React.FC<OrdersListProps> = ({
  title, subtitle, allowedStatuses, orders, partners, items, partnerItems, palletStocks, itemBoms = [],
  onUpdateStatus, onUpdateDeliveryDate, onUpdatePallets,
  onUpdateItems, onUpdateDeliveryBoxes,
  onToggleInvoicePrinted,
  onUpdateInvoiceType, onToggleShipmentComplete, onToggleItemChecked,
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
  embeddedListOnly = false,
  calendarSlot,
}) => {
  // Compute derived variables
  const products = items;
  const [activeTab, setActiveTab] = useState<TabType>('active');
  // 배송 관리에 삽입되는 목록은 외부의 '리스트' 선택 결과이므로 내부 기본 뷰도 리스트여야 한다.
  /*  **보기 축에 '이력'이 하나 더 있다**(2026-09-11 사장님: "보드 우측에 이력 탭 추가하고
    전처럼 예전 주문은 이력 탭에서 확인할거고").

    이력 화면 자체는 진작 만들어져 있었는데(주문 한 건 = 한 행, 완료일 최신순) 그걸 여는
    탭바가 `hidden` 이라 **들어갈 길이 없었다.** 숨은 축(`activeTab`)을 쓰지 않고 보기 축에
    붙여, 배송 캘린더·리스트·보드와 같은 줄에서 고르게 한다. */
  const [activeView, setActiveView] = useState<'calendar' | 'list' | 'kanban' | 'history'>(embeddedListOnly ? 'list' : 'kanban');
  const [showListDetailColumns, setShowListDetailColumns] = useState(false);
  const [showListCompletionColumns, setShowListCompletionColumns] = useState(false);
  const [listSort, setListSort] = useState<'delivery' | 'order' | 'stock' | 'workLow' | 'workHigh'>('delivery');
  const [listStatusTab, setListStatusTab] = useState<'all' | OrderStatus>('all');
  const [listPage, setListPage] = useState(1);
  //  거래처 거르개 — 검색필드와 따로 논다(2026-09-11 사장님).
  const [listPartnerFilter, setListPartnerFilter] = useState('');
  const [listFilterField, setListFilterField] = useState<'source' | 'shipMethod' | 'invoicePrinted' | 'partner' | 'completion' | 'item' | 'quantity' | 'manufacturing' | 'label' | 'packaging' | 'pallet' | 'orderDate' | 'deliveryDate' | ''>('');
  const [listFilterValue, setListFilterValue] = useState('');
  const [listMemoEditor, setListMemoEditor] = useState<{ orderId: string; itemIndex: number } | null>(null);
  const [listMemoDraft, setListMemoDraft] = useState('');
  const [listOrderEditor, setListOrderEditor] = useState<{ orderId: string; deliveryDate: string; items: OrderItem[] } | null>(null);
  /*  주문 수정 창의 팔레트는 **접어 둔다**(2026-09-12 사장님: "팔레트는 좀 접어둬라
      필요할때 펼치게"). 늘 건드리는 칸이 아닌데 자리를 크게 먹어 품목이 밀렸다.
      창을 닫았다 열면 다시 접힌다. */
  const [showEditorPallet, setShowEditorPallet] = useState(false);
  /*  배송 오전·오후는 배송순서 화면과 **같은 문서**를 본다(`settings/deliveryOrdering`).
      읽고 쓰는 길은 [deliveryTimeSlot](../src/shared/deliveryTimeSlot.ts) 하나다. */
  const [deliveryTimeSlots, setDeliveryTimeSlots] = useState<Record<string, DeliveryTimeSlot>>({});
  useEffect(() => subscribeDeliveryOrdering(doc => setDeliveryTimeSlots(doc?.timeSlots ?? {})), []);
  const [listPalletEditorOrderId, setListPalletEditorOrderId] = useState<string | null>(null);
  const listTopScrollRef = React.useRef<HTMLDivElement>(null);
  const listBodyScrollRef = React.useRef<HTMLDivElement>(null);
  const [listColumnWidths, setListColumnWidths] = useState<Record<string, number>>({
    //  작업완료 여부·주문 수량은 글자가 짧아 자리가 남았다 — 좁힌다(2026-09-11 사장님).
    status: 90, source: 112, invoicePrinted: 105, shipmentComplete: 116, partner: 168, address: 220, completion: 84, confirmer: 90, confirmedAt: 90,
    item: 180, quantity: 76, manufacturing: 145, bottle: 120, cap: 120, componentLabel: 135,
    label: 150, packaging: 135, pallet: 140,
    //  송장(105) + 팔레트(140) 를 합친 칸 — 한쪽만 뜨므로 둘을 더한 만큼은 필요 없다
    shipOut: 168,
    note: 150, orderDate: 90, deliveryDate: 90,
    //  합친 칸 — 날짜 두 줄(dates)과 출고방식을 얹은 거래처(partner)
    dates: 104, orderNo: 120,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [includeLegacyHistory, setIncludeLegacyHistory] = useState(false);
  const legacyHistoryEnabled = !embeddedListOnly && includeLegacyHistory;
  const visibleActiveConfigs = useMemo(
    () => activeConfigs.filter(config => !!config.targetStatus && allowedStatuses.includes(config.targetStatus)),
    [allowedStatuses]
  );
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [showAddProductSelect, setShowAddProductSelect] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [columnUnits, setColumnUnits] = useState<Record<string, number>>(defaultUnits);
  const [showAllHistory, setShowAllHistory] = useState(false);
  //  이력은 **한 쪽에 15줄**(2026-09-11 사장님). 검색조건을 바꾸면 첫 쪽으로 돌아간다.
  const [historyPage, setHistoryPage] = useState(1);
  const [historySearch, setHistorySearch] = useState('');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [activeDateFrom, setActiveDateFrom] = useState(() => `${seoulDateInput().slice(0, 7)}-01`);
  const [activeDateTo, setActiveDateTo] = useState(() => seoulDateInput());
  const HISTORY_PREVIEW = 5;
  /**
   * `workGroup` = **작업 그룹**(2026-09-11 사장님: "기름 깨 미분류가 세 개의 그룹이 되는거지").
   * 화면의 큰 칸을 가르는 이름이고, 사장님이 만들고 고치고 지운다.
   * `groupId`/`groupName` 은 그것과 **다른 것** — 그 칸 안에서 '같이 만들 것끼리 묶기'다.
   */
  type WorkItem = { key: string; orderId: string; itemId: string; lineKey?: string; itemName: string; partnerName: string; qty: number; category: string; workGroup?: string; groupId?: string; groupName?: string; };
  const workItems: WorkItem[] = workOrderItemsProp;
  const setWorkItems = (items: WorkItem[] | ((prev: WorkItem[]) => WorkItem[])) => {
    const resolved = typeof items === 'function' ? items(workItems) : items;
    onSetWorkOrderItems?.(resolved);
  };
  const [showWorkOrderPicker, setShowWorkOrderPicker] = useState(false);
  /** 같이 만들 것으로 고른 줄들 — 두 개 이상 골라야 묶을 수 있다 */
  const [workGroupPick, setWorkGroupPick] = useState<string[]>([]);
  /**
   * **작업 그룹 이름과 차례** — `settings/workGroups` 한 문서에 둔다.
   * 처음에는 여태 쓰던 세 갈래(기름·깨·미분류)로 시작한다. 사장님이 고치면 그때부터 그 이름이다.
   */
  const [workGroups, setWorkGroups] = useState<string[]>(['기름', '깨', '미분류']);
  useEffect(() => {
    if (embeddedListOnly) return;
    return subscribeToDocument<{ names: string[] }>('settings', 'workGroups', doc => {
      if (doc?.names?.length) setWorkGroups(doc.names);
    });
  }, [embeddedListOnly]);
  const saveWorkGroups = (names: string[]) => {
    setWorkGroups(names);
    void setDocument('settings', 'workGroups', { names });
  };
  const [mobileCollapsed, setMobileCollapsed] = useState<Set<string>>(() => new Set(['work-order']));
  const toggleMobileCollapse = (id: string) => setMobileCollapsed(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const [pickerOrdering, setPickerOrdering] = useState<string[]>([]); // 선택 순서 배열
  /**
   * **끌어오기 창의 그룹 작업판.**
   *
   * 2026-09-11 사장님: "주문 끌어오기할 때 아예 그룹 추가하고 그 그룹 클릭 한다음에 주문
   * 선택하면 그 그룹내에서만 순서 따로 들어가게 하고 그룹이름 변경하거나 삭제하는 것도 가능하게".
   *
   * 창에서 고친 것은 **확인을 눌러야** 저장된다 — 그 전에는 여기 셋만 바뀐다.
   *   `pickerGroups` 그룹 이름과 차례 · `pickerAssign` 줄이 어느 그룹인지 · `pickerGroup` 지금 고른 그룹
   * 줄의 차례는 `pickerOrdering` 하나로 두고, 그룹 안 번호는 그걸 걸러서 센다 —
   * 그룹마다 배열을 따로 두면 줄 하나가 두 그룹에 남는 일이 생긴다.
   */
  const [pickerGroups, setPickerGroups] = useState<string[]>([]);
  const [pickerAssign, setPickerAssign] = useState<Record<string, string>>({});
  const [pickerGroup, setPickerGroup] = useState('');
  /** 그룹 편집 창 — 추가·이름바꾸기·지우기를 여기 한곳에 모은다(2026-09-14 사장님). */
  const [그룹편집, set그룹편집] = useState(false);
  const [새그룹이름, set새그룹이름] = useState('');

  /*  그룹을 손대는 일 셋 — 창에서만 부른다. 칩에서는 고르기만 한다(2026-09-14 사장님). */
  const 그룹추가 = () => {
    const 이름 = 새그룹이름.trim();
    if (!이름) return;
    if (pickerGroups.includes(이름)) { alert('같은 이름의 그룹이 이미 있습니다.'); return; }
    setPickerGroups(prev => [...prev, 이름]);
    setPickerGroup(이름);
    set새그룹이름('');
  };

  const 그룹이름바꾸기 = (name: string) => {
    const 새이름 = window.prompt('그룹 이름', name)?.trim();
    if (!새이름 || 새이름 === name) return;
    if (pickerGroups.includes(새이름)) { alert('같은 이름의 그룹이 이미 있습니다.'); return; }
    setPickerGroups(prev => prev.map(x => x === name ? 새이름 : x));
    //  담긴 줄도 같이 따라간다 — 이름만 바꾸고 줄을 두면 그 줄이 갈 곳을 잃는다.
    setPickerAssign(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v === name ? 새이름 : v])));
    setPickerGroup(현재 => 현재 === name ? 새이름 : 현재);
  };

  const 그룹지우기 = (name: string, 담긴수: number) => {
    if (pickerGroups.length <= 1) { alert('그룹은 하나는 남아 있어야 합니다.'); return; }
    if (담긴수 > 0 && !window.confirm(`"${name}" 에 담긴 ${담긴수}건은 어디에도 안 담긴 채로 빠집니다. 지울까요?`)) return;
    const 남은 = pickerGroups.filter(x => x !== name);
    setPickerGroups(남은);
    //  지운 그룹에 담겼던 줄은 **목록에서도 뺀다** — 갈 곳 없는 줄을 남기지 않는다.
    setPickerOrdering(prev => prev.filter(k => pickerAssign[k] !== name));
    setPickerGroup(현재 => 현재 === name ? (남은[0] ?? '') : 현재);
  };
  const [previewOrderId, setPreviewOrderId] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; confirmText?: string; onConfirm: () => void } | null>(null);
  /*  **카드를 따라가지 않는다**(2026-09-14 사장님: "움직인 위치로 따라가도록 해놨는데 그거 기능 꺼놔봐").
   *  폰에서 상태가 바뀌면 그 카드가 간 열까지 화면이 저절로 스크롤했다. 손으로 체크하는 중에
   *  화면이 움직이니 다음 줄을 누르려던 손가락이 엉뚱한 데를 짚었다. 이제 제자리에 머문다. */
  const followItemToggle = (orderId: string, itemIndex: number, actor?: string) =>
    onToggleItemChecked?.(orderId, itemIndex, actor);

  const openOrderEditor = (orderId: string) => {
    const order = orders.find(candidate => candidate.id === orderId);
    if (!order || embeddedListOnly) return;
    setPreviewOrderId(null);
    setEditingOrderId(null);
    setShowAddProductSelect(null);
    setShowEditorPallet(false);   // 열 때는 늘 접힌 채로
    setListOrderEditor({
      orderId: order.id,
      deliveryDate: order.deliveryDate.split('T')[0],
      items: order.items.map(item => ({ ...item })),
    });
  };

  const openMemoEditor = (orderId: string, itemIndex: number) => {
    const order = orders.find(candidate => candidate.id === orderId);
    const item = order?.items[itemIndex];
    if (!order || !item || embeddedListOnly) return;
    setListMemoEditor({ orderId, itemIndex });
    setListMemoDraft(item.note || '');
  };

  useEffect(() => {
    if (!listPalletEditorOrderId) return;
    const close = () => setListPalletEditorOrderId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [listPalletEditorOrderId]);

  useEffect(() => {
    setListPage(1);
  }, [listStatusTab, listFilterField, listFilterValue, searchTerm, activeDateFrom, activeDateTo, listSort, includeLegacyHistory]);
  //  이력도 조건이 바뀌면 첫 쪽으로 — 3쪽을 보다가 조건을 좁히면 빈 쪽이 뜬다.
  useEffect(() => { setHistoryPage(1); }, [searchTerm, activeDateFrom, activeDateTo]);

  // 조회만으로 운영 주문을 수정하지 않는다. 상태 이동은 사용자 조작의 승인 경로에서만 한다.

  // 신규 주문 생성 시 자동으로 편집 모드 열기
  useEffect(() => {
    if (!newOrderId) return;
    setActiveTab('active');
    const timer = setTimeout(() => {
      openOrderEditor(newOrderId);
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

  // 최신 품목 카테고리를 사용한다. 비어 있으면 임의의 이름 추정 대신 미분류로 표시한다.
  /**
   * **작업순서의 묶음 — 기름 · 깨 · 미분류 셋뿐이다**(2026-09-11 사장님).
   *
   * 전에는 품목에 적힌 분류를 그대로 썼다(`참기름`·`들기름`·`들깨`·`탈피들깨`·`검정참깨`…).
   * 그러면 **짜는 설비가 같은데 칸이 갈려서** 한 번에 짤 것을 두세 번에 나눠 보게 된다.
   *   기름 : 참기름 · 들기름 · 생들기름 — 짜는 일
   *   깨   : 참깨 · 들깨 · 검정깨와 그 가루 — 볶고 빻는 일
   * 둘 중 어디에도 안 걸리면 미분류다. 운영 데이터의 완제품 분류는 지금 일곱 가지뿐이고
   * (참기름 160 · 들기름 74 · 들깨 33 · 참깨 15 · 탈피들깨 10 · 검정참깨 9 · 빈칸 12)
   * 그게 전부 이 셋으로 들어간다.
   */
  /**
   * **이 줄이 어느 그룹인가.**
   *
   * 사장님이 지정한 그룹(`workGroup`)이 있으면 그것이다. 아직 안 정한 줄은 품목 분류로
   * 갈라 첫 자리를 잡아 준다(기름·깨·미분류) — 그래야 그룹을 쓰기 시작해도 화면이 안 빈다.
   * 지워진 그룹에 남아 있던 줄은 목록의 **맨 끝 그룹**으로 흘려 보낸다.
   */
  const workCategoryOf = (workItem: WorkItem): string => {
    const 정한것 = String(workItem.workGroup ?? '').trim();
    if (정한것) return workGroups.includes(정한것) ? 정한것 : (workGroups[workGroups.length - 1] ?? 정한것);
    const product = items.find(item => item.id === workItem.itemId);
    const savedCategory = String(product?.category || workItem.category || '').trim();
    const typeValues = new Set(['product', 'goods', 'wip', 'raw', 'submaterial', 'giftset', 'shipping']);
    const 분류 = savedCategory && !typeValues.has(savedCategory) ? savedCategory : '';
    //  이름으로 가르지 않고 **분류값**으로 가른다 — 품목 이름은 사람이 자주 고친다.
    const 짐작 = /기름/.test(분류) ? '기름' : /깨/.test(분류) ? '깨' : '미분류';
    return workGroups.includes(짐작) ? 짐작 : (workGroups[workGroups.length - 1] ?? 짐작);
  };

  /**
   * 작업순서 보기 = 1depth(무엇으로 묶나) + 2depth(그 묶음을 어떤 순서로 두나).
   *
   *  공정별  : 기름/가루 — 설비가 갈리므로 기본값. 2depth는 주문일·배송기한.
   *  품목별  : 같은 품목을 한 줄에 모아 한 번에 만든다. 2depth는 재고 여유(재고 − 주문량)가 적은 것 먼저.
   *  거래처별: 한 거래처 것을 모아 챙긴다. 2depth는 주문일·배송기한.
   *
   * 누르면 순서를 다시 잡고 그대로 저장한다 — 현장이 따라야 할 순서는 하나여야 하므로
   * '보기만 바뀌는' 임시 정렬은 두지 않는다. 정렬 후 드래그로 미세조정하는 흐름을 전제로 한다.
   */
  /* 표는 하나(세로 거래처 × 가로 공정)로 고정하고 정렬만 고른다.
     전엔 '묶기(거래처별/품목별)'라는 축이 하나 더 있었는데, 품목별은 사실상 재고 여유순을 담는 그릇이었을 뿐이고
     재고 여유순도 같은 표로 보여줄 수 있어서 축 자체를 없앴다 — 고를 게 줄어 헷갈릴 일도 줄었다. */
  /**
   * 지금 적용된 정렬. null = 아직 아무 정렬도 안 눌렀거나(저장된 순서 그대로),
   * 드래그로 직접 옮겨 더는 어떤 정렬 기준과도 맞지 않는 상태.
   * 이걸 표시하지 않으면 '둘 중 뭐가 켜진 거지?'를 알 수 없다.
   */
  /**
   * 금일 작업순서의 정렬 — `null` 이 **직접 정렬**이고 그게 **기본**이다
   * (2026-09-11 사장님: "금일배송순서랑 금일작업순서는 직접정렬이 디폴트로").
   * 추천(`dueDate`)이 기본이면 줄이 `draggable={false}` 라 끌어도 아무 일이 안 난다.
   */
  const [workSort, setWorkSort] = useState<string | null>(null);
  const [showCompletedWorkItems, setShowCompletedWorkItems] = useState(false);
  const [mobileWorkCategory, setMobileWorkCategory] = useState('');
  /** 지금 끌고 있는 항목 — 기름↔가루는 설비가 달라 순서를 못 섞으므로, 끌 수 없는 칸을 미리 흐리게 만든다. */
  const [draggingWorkKey, setDraggingWorkKey] = useState<string | null>(null);

  /** 재고 여유 = 현재고 − 이 주문 수량. 음수면 지금 재고로 못 대니 먼저 만들어야 한다. */
  const stockSlack = (wi: { itemId: string; qty: number }) => {
    const p = items.find(x => x.id === wi.itemId);
    return p ? (p.stock ?? 0) - wi.qty : Infinity; // 품목을 못 찾으면 판단 불가 → 뒤로
  };

  const applyWorkSort = (mode: string) => {
    const orderById = new Map(orders.map(o => [o.id, o]));
    const t = (v?: string) => { const n = v ? new Date(v).getTime() : NaN; return Number.isNaN(n) ? Infinity : n; };
    // 항목 하나의 정렬값 — 거래처(표의 세로줄) 순서도 이 값으로 정해진다
    const rank = (wi: WorkItem) => {
      const o = orderById.get(wi.orderId);
      if (mode === 'orderDate') return t(o?.createdAt);
      if (mode === 'dueDate') return t(o?.deliveryDate);
      return stockSlack(wi);
    };
    setWorkItems(prev => {
      const groupKey = (wi: WorkItem) => wi.partnerName;
      // 거래처별 대표값 = 그 거래처에서 가장 급한 항목의 값 → 급한 거래처가 위로 온다
      const best = new Map<string, number>();
      prev.forEach(wi => {
        const k = groupKey(wi);
        best.set(k, Math.min(best.get(k) ?? Infinity, rank(wi)));
      });
      return [...prev].sort((a, b) =>
        (best.get(groupKey(a))! - best.get(groupKey(b))!)   // 거래처(세로줄) 순서
        || groupKey(a).localeCompare(groupKey(b), 'ko')      // 값이 같으면 이름순
        || (rank(a) - rank(b))                              // 한 칸 안 순서
        || a.itemName.localeCompare(b.itemName, 'ko')       // 동점은 이름으로 갈라 매번 같은 결과
        || a.partnerName.localeCompare(b.partnerName, 'ko')
      );
    });
    setWorkSort(mode);
  };

  /**
   * **정렬 셈은 이 하나뿐이다** — 보드·리스트·배송 캘린더·이력이 다 이걸 지난다
   * (2026-09-11 사장님: "보드 리스트 배송캘린더 이력에서 정렬 다 공용으로 쓰게 해").
   *
   * 전에는 리스트만 정렬하고 보드는 거르기만 했다. 검색조건 안에 있는 고르개가
   * 한 화면에서만 듣는 건 말이 안 된다.
   *
   *   출고예정일 임박 순 (기본) · 주문일 최신 순 · 재고 여유 순
   *
   * 재고 여유는 "재고 − 주문량"이 적은 것부터다 — 모자랄 것 같은 주문을 먼저 본다.
   */
  const stockSlackOf = (order: Order) => Math.min(...order.items.map(item => {
    const product = items.find(candidate => candidate.id === item.itemId);
    return product ? (product.stock ?? 0) - item.quantity : Number.POSITIVE_INFINITY;
  }));
  /*  **작업도** — 그 주문에서 체크가 끝난 품목 비율(0~1). 품목이 없으면 0으로 본다
   *  (나눗셈이 NaN 이 되면 정렬이 뒤죽박죽이 된다). 같은 작업도면 출고예정일이 급한 것부터. */
  const 작업도 = (order: Order) => order.items.length === 0
    ? 0
    : order.items.filter(item => item.checked).length / order.items.length;

  const 정렬 = (rows: readonly Order[]): Order[] => [...rows].sort((a, b) => {
    if (listSort === 'order') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (listSort === 'stock') return stockSlackOf(a) - stockSlackOf(b);
    if (listSort === 'workLow' || listSort === 'workHigh') {
      const 차 = 작업도(a) - 작업도(b);
      if (차 !== 0) return listSort === 'workLow' ? 차 : -차;
      return new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime();
    }
    return new Date(a.deliveryDate).getTime() - new Date(b.deliveryDate).getTime();
  });

  const filteredOrders = useMemo(() => {
    if (!searchTerm.trim()) return orders;
    const q = searchTerm.toLowerCase();
    return orders.filter(o =>
      (o.partnerName || '').toLowerCase().includes(q) ||
      (o.id || '').toLowerCase().includes(q)
    );
  }, [orders, searchTerm]);

  const activePeriodOrders = useMemo(() => embeddedListOnly ? orders : orders.filter(order => {
    const orderDate = seoulDateInput(new Date(order.createdAt));
    if (activeDateFrom && orderDate < activeDateFrom) return false;
    if (activeDateTo && orderDate > activeDateTo) return false;
    return visibleActiveConfigs.some(config => config.statusFilter.includes(order.status))
      || (legacyHistoryEnabled && order.status === OrderStatus.DELIVERED);
  }), [orders, activeDateFrom, activeDateTo, embeddedListOnly, visibleActiveConfigs, legacyHistoryEnabled]);

  const activeOperationOrders = useMemo(
    () => activePeriodOrders.filter(order => visibleActiveConfigs.some(config => config.statusFilter.includes(order.status))),
    [activePeriodOrders, visibleActiveConfigs]
  );

  const validWorkItems = useMemo(() => {
    const liveItems: WorkItem[] = activeOperationOrders
      .filter(order => order.status === OrderStatus.PENDING || order.status === OrderStatus.PROCESSING)
      .flatMap(order => {
        const partnerName = order.partnerName || partners.find(partner => partner.id === order.partnerId)?.name || '이름없음';
        /*  **열쇠는 `주문id-lineKey` 다** — 자리 번호를 쓰면 안 된다.
         *
         *  2026-09-11 사장님: "이미 목록에 들어가서 설정돼 있는 애들이 표시가 안되네".
         *  맞다 — 여기는 `${order.id}-${index}` 로, 고르는 창(`allPickableItems`)은
         *  `${o.id}-${lineKeyAt(...)}` 로 열쇠를 만들고 있었다. **두 글자가 달라 영영 안 맞으니**
         *  창을 열면 이미 담긴 것들이 하나도 체크되지 않았다(확인 건수만 맞고 칸은 다 비어 있었다).
         *
         *  맞춰야 할 쪽은 이쪽이다 — 자리 번호는 앞 품목을 지우면 다른 품목을 가리킨다
         *  (2026-09-09 사장님: "몇번째 주문이냐는 너무 위험한데"). 이름도 같은 규칙으로 갈라 적는다. */
        /*  **상품은 작업순서에 안 세운다**(2026-09-11 사장님: "상품은 작업순서에서 빼 사오는거니까").
            사 오는 물건이라 우리가 만들 일이 없다 — 줄만 늘어난다. */
        return order.items.map((item, index) => {
          /*  **저장된 칸을 통째로 이어받는다**(2026-09-12 사장님: "묶기해도 아무런 변화가 없는데").
           *
           *  여기가 매번 주문에서 줄을 **새로 만들기** 때문에, 저장된 문서에서 끌어오지 않은 칸은
           *  화면에서 영영 비어 있다. `workGroup` 만 끌어오고 있어서 **묶음(`groupId`)은 DB 에
           *  잘 찍히는데도 줄에는 안 붙었다** — 눌러도 띠가 안 생기니 아무 일도 안 한 것처럼 보였다.
           *  묶음 이름(`groupName`)도 같이 가져온다. */
          const 저장된 = workItems.find(saved => saved.key === `${order.id}-${lineKeyAt(order.items, index)}`);
          return {
            key: `${order.id}-${lineKeyAt(order.items, index)}`,
            orderId: order.id,
            itemId: item.itemId,
            lineKey: lineKeyAt(order.items, index),
            itemName: `${item.name}${lineSuffix(order.items, index)}`,
            partnerName,
            qty: item.quantity,
            category: items.find(product => product.id === item.itemId)?.category || '미분류',
            //  저장된 그룹을 이어받는다 — 없으면 workCategoryOf 가 품목 분류로 짐작한다.
            workGroup: 저장된?.workGroup,
            groupId: 저장된?.groupId,
            groupName: 저장된?.groupName,
          };
        })
        //  **거르기는 열쇠를 만든 뒤에** — 먼저 거르면 `index` 가 원래 자리와 어긋나
        //  `lineKeyAt` 이 엉뚱한 줄을 가리킨다.
        .filter(workItem => items.find(product => product.id === workItem.itemId)?.type !== 'goods');
      });
    /*  **담은 것만 선다**(2026-09-14 사장님: "고른 것만 해야지").
     *
     *  전에는 대기중·작업중 주문의 **모든 품목이 무조건** 줄로 섰다. 담긴 목록
     *  (`workOrderItems`)은 순서·묶음을 이어받는 데만 쓰고 거르는 데는 안 썼다 —
     *  그래서 `주문보기`에서 빼도 다음 그림에 도로 나타났고, 주문을 넣는 순간 저절로 끼어들었다.
     *  담고 빼는 일 자체가 아무 효과가 없었던 것이다(`a08a811` 병합 때 이렇게 됐다).
     *
     *  **매일 아침 비우는 것**(AdminApp 의 작업순서 초기화)도 이 때문에 뜻이 없었다 —
     *  비워도 곧바로 다시 채워졌다. 이제 비우면 비어 있고, 그날 세울 것을 담아서 짠다. */
    const 담긴키 = new Set(workItems.map(item => item.key));
    const savedPosition = new Map(workItems.map((item, index) => [item.key, index]));
    return liveItems
      .filter(workItem => 담긴키.has(workItem.key))
      .sort((a, b) => (savedPosition.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (savedPosition.get(b.key) ?? Number.MAX_SAFE_INTEGER));
  }, [workItems, activeOperationOrders, partners, items]);

  const activeKanbanOrders = useMemo(() => {
    if (!searchTerm.trim()) return activePeriodOrders;
    const query = searchTerm.toLocaleLowerCase('ko-KR');
    return activePeriodOrders.filter(order =>
      (order.partnerName || '').toLocaleLowerCase('ko-KR').includes(query)
      || (order.id || '').toLocaleLowerCase('ko-KR').includes(query)
      || order.items.some(item => item.name.toLocaleLowerCase('ko-KR').includes(query))
    );
  }, [activePeriodOrders, searchTerm]);

  const activeViewFilterValuesForOrder = (order: Order) => {
    if (listFilterField === 'source') return [order.source];
    if (listFilterField === 'shipMethod') return [shipMethodOf(order)];
    if (listFilterField === 'invoicePrinted') return [order.invoicePrinted ? '출력 완료' : '미출력'];
    if (listFilterField === 'partner') return [order.partnerName || partners.find(partner => partner.id === order.partnerId)?.name || '이름 없음'];
    if (listFilterField === 'completion') return order.items.map(item => item.checked ? '완료' : '미완료');
    if (listFilterField === 'item' || listFilterField === 'manufacturing') return order.items.map(item => item.name);
    if (listFilterField === 'quantity') return order.items.map(item => String(item.quantity));
    if (listFilterField === 'label') return order.items.map(item => item.labelType || '대기');
    if (listFilterField === 'packaging') return order.items.map(item => item.boxType || '-');
    if (listFilterField === 'pallet') return (order.pallets ?? []).map(pallet => palletStocks?.find(stock => stock.id === pallet.type)?.name || pallet.type);
    if (listFilterField === 'orderDate') return [fmtYYMMDD(new Date(order.createdAt))];
    if (listFilterField === 'deliveryDate') return [fmtYYMMDD(new Date(order.deliveryDate))];
    return [];
  };
  const activeViewFilterValues = useMemo(() => [...new Set(activeKanbanOrders.flatMap(activeViewFilterValuesForOrder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')), [activeKanbanOrders, listFilterField, partners, palletStocks]);
  /**
   * **거래처 거르개는 이름의 일부만 쳐도 걸린다**(2026-09-11 사장님: "거래처 검색 필터 따로
   * 뺀게 제대로 작동 안하는거 같은데").
   *
   * 두 군데가 틀렸었다 — ① **정확히 같아야** 걸려서, `은진`까지 치는 동안은 결과가 통째로
   * 사라졌다. ② **리스트에만** 물려 있어서 보드·이력에서는 아무 일도 안 났다.
   * 담는 것(`대소문자 무시 · 포함`)과 자리(공용 `activeViewOrders`) 둘 다 고친다.
   */
  const 거래처이름of = (order: Order) =>
    order.partnerName || partners.find(partner => partner.id === order.partnerId)?.name || '';
  //  **초성으로도 찾는다**(2026-09-11 사장님) — `ㅇㅈ` 로 은진상회가 걸린다.
  //  판정은 `shared/hangul.matchesSearch` 한 곳이 한다(인수인계 "검색은 어디서나 초성으로 된다").
  const 거래처걸림 = (order: Order) => matchesSearch(거래처이름of(order), listPartnerFilter);

  const activeViewOrders = useMemo(() => {
    const allowed = activeKanbanOrders.filter(order => visibleActiveConfigs.some(config => config.statusFilter.includes(order.status)) || (legacyHistoryEnabled && order.status === OrderStatus.DELIVERED));
    const statusMatched = listStatusTab === 'all' ? allowed : allowed.filter(order => order.status === listStatusTab);
    const fieldMatched = !listFilterField || !listFilterValue ? statusMatched : statusMatched.filter(order => activeViewFilterValuesForOrder(order).includes(listFilterValue));
    return fieldMatched.filter(거래처걸림);
  }, [activeKanbanOrders, visibleActiveConfigs, listStatusTab, listFilterField, listFilterValue, listPartnerFilter, partners, palletStocks, legacyHistoryEnabled]);

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

  const requestBoardStatusChange = (orderId: string, nextStatus: OrderStatus) => {
    const order = orders.find(candidate => candidate.id === orderId);
    if (!order || order.status === nextStatus) return;
    const stockStage = (value: OrderStatus) => value === OrderStatus.SHIPPED || value === OrderStatus.DELIVERED
      ? 2 : value === OrderStatus.DISPATCHED ? 1 : 0;
    const move = () => onUpdateStatus(orderId, nextStatus);
    // 대기중·작업중·출고완료 이동은 묻지 않고, 작업완료 진입만 확인한다.
    if (nextStatus !== OrderStatus.DISPATCHED || stockStage(nextStatus) < stockStage(order.status)) return move();
    const partnerName = order.partnerName || partners.find(partner => partner.id === order.partnerId)?.name || '거래처 미지정';
    setConfirmModal({
      message: `해당 거래처를 ${statusLabel(nextStatus)} 상태로 변경할까요?`,
      subMessage: `${partnerName} · 주문일: ${dateOfLocal(order.createdAt).slice(2).replaceAll('-', '.')}`,
      confirmText: '변경하기',
      onConfirm: () => {
        setConfirmModal(null);
        move();
      },
    });
  };

  // OrderCard/OrderSourceGroup에 공통으로 넘길 props
  const cardSharedProps = {
    partners, items, partnerItems, palletStocks, itemBoms,
    editingOrderId, setEditingOrderId,
    showAddProductSelect, setShowAddProductSelect,
    onUpdateItems, onUpdateDeliveryDate,
    onUpdateStatus: activeView === 'kanban' ? requestBoardStatusChange : onUpdateStatus,
    onUpdatePallets, onToggleInvoicePrinted, onUpdateInvoiceType,
    onToggleItemChecked: followItemToggle, onDeleteOrder, currentUserName,
    highlightOrderId,
    onEditOrder: embeddedListOnly ? undefined : openOrderEditor,
    onOpenMemo: embeddedListOnly ? undefined : openMemoEditor,
    isListView: activeView === 'list',
    tintedHeader: activeView === 'kanban' && !embeddedListOnly,
  };
  const renderOrderManagementControls = () => embeddedListOnly ? null : (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-6">
        <h2 className="text-lg font-black text-slate-900">전체 주문 관리</h2>
          <div className="flex items-center rounded-2xl bg-slate-100 p-1" aria-label="주문 보기 방식">
            {([
              //  보기 순서는 사장님이 정한다(2026-09-11): 보드 → 리스트 → 배송 캘린더 → 이력.
              { value: 'kanban' as const, label: '보드', icon: LayoutDashboard },
              { value: 'list' as const, label: '리스트', icon: ListOrdered },
              { value: 'calendar' as const, label: '배송 캘린더', icon: CalendarDays },
              { value: 'history' as const, label: '이력', icon: History },
            ]).map(view => {
              const Icon = view.icon;
              return <button key={view.value} type="button" onClick={() => setActiveView(view.value)} aria-pressed={activeView === view.value} className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-black transition-all ${activeView === view.value ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><Icon size={13} /><span>{view.label}</span></button>;
            })}
          </div>
      </div>
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-labelledby="active-view-query-title">
            <div className="flex min-h-11 items-center gap-2 border-b border-slate-200 px-4 py-2.5">
              <h3 id="active-view-query-title" className="text-xs font-black text-slate-900">검색조건</h3>
              <button type="button" onClick={() => { const today = seoulDateInput(); setActiveDateFrom(`${today.slice(0, 7)}-01`); setActiveDateTo(today); setListFilterField(''); setListFilterValue(''); setListPartnerFilter(''); setSearchTerm(''); setListSort('delivery'); }} className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[11px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700"><RotateCcw size={12} aria-hidden="true" />초기화</button>
            </div>
            <div className="flex flex-wrap items-end gap-2 p-3 md:p-4">
              <label className="order-1 flex w-full flex-col gap-1 text-[10px] font-bold text-slate-500 sm:w-auto">
                주문일
                {/*  **폰에서도 한 행에 들어간다**(2026-09-11 사장님). 줄바꿈을 막고(`flex-nowrap`)
                     날짜칸·단추의 여백과 글씨를 좁은 화면에서만 줄인다 — 넓은 화면은 그대로다. */}
                <span className="flex flex-nowrap items-center gap-1 sm:gap-2">
                  <input aria-label="주문일 시작" type="date" value={activeDateFrom} max={activeDateTo || undefined} onChange={event => setActiveDateFrom(event.target.value)} className="date-narrow h-9 rounded-md border border-slate-200 bg-slate-50 px-0.5 text-[10px] font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300 sm:px-2 sm:text-xs" />
                  <span className="shrink-0 text-xs text-slate-400">~</span>
                  <input aria-label="주문일 종료" type="date" value={activeDateTo} min={activeDateFrom || undefined} onChange={event => setActiveDateTo(event.target.value)} className="date-narrow h-9 rounded-md border border-slate-200 bg-slate-50 px-0.5 text-[10px] font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300 sm:px-2 sm:text-xs" />
                  <span className="flex h-9 shrink-0 items-center overflow-hidden rounded-md border border-slate-200 bg-white">
                    {/*  **폰에서도 '오늘·이번 주·이번 달'** (2026-09-12 사장님: "오른쪽 공간 좀 더
                         써서 오늘 이번주 이번달 안되나"). 전에는 '주·달' 한 글자로 줄여 놨는데,
                         날짜 칸을 86px 까지 좁히고 나니 제 이름이 다 들어간다. */}
                    <button type="button" onClick={() => { setActiveDateFrom(sharedQuickToday); setActiveDateTo(sharedQuickToday); }} className={`border-r border-slate-200 ${sharedQuickRangeClass(activeDateFrom === sharedQuickToday && activeDateTo === sharedQuickToday)}`}>오늘</button>
                    <button type="button" onClick={() => { setActiveDateFrom(sharedQuickWeekStart); setActiveDateTo(sharedQuickToday); }} className={`border-r border-slate-200 ${sharedQuickRangeClass(activeDateFrom === sharedQuickWeekStart && activeDateTo === sharedQuickToday)}`} aria-label="이번 주">이번 주</button>
                    <button type="button" onClick={() => { setActiveDateFrom(sharedQuickMonthStart); setActiveDateTo(sharedQuickToday); }} className={sharedQuickRangeClass(activeDateFrom === sharedQuickMonthStart && activeDateTo === sharedQuickToday)} aria-label="이번 달">이번 달</button>
                  </span>
                </span>
              </label>
              {/*  '예전 주문 이력 포함' 체크는 없앴다(2026-09-11 사장님) — 이력은 이제 **탭**이다.
                   섞어 보여 주던 길을 두면 같은 것을 두 군데서 보게 되고, 어느 쪽이 맞는지 헷갈린다. */}
              <span className="order-2 h-0 basis-full" aria-hidden="true" />
              <label className="order-3 flex w-36 shrink-0 flex-col gap-1 text-[10px] font-bold text-slate-500">
                검색 필드
                {/*  포장·팔레트·주문일·주문수량은 뺐다(2026-09-11 사장님) — 이 칸으로 걸러 본 적이 없다.
                     거래처는 제일 자주 쓰는 것이라 **옆에 따로 꺼내 뒀다.** */}
                <SearchableSelect
                  ariaLabel="검색 필드" className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                  value={listFilterField}
                  onChange={value => { setListFilterField(value as typeof listFilterField); setListFilterValue(''); }}
                  options={검색필드목록}
                />
              </label>

              <label className="order-3 flex w-36 shrink-0 flex-col gap-1 text-[10px] font-bold text-slate-500">
                조건 값
                <SearchableSelect
                  ariaLabel="조건 값" className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                  value={listFilterValue} onChange={setListFilterValue} disabled={!listFilterField}
                  options={[{ value: '', label: '전체' }, ...activeViewFilterValues.map(value => ({ value, label: value }))]}
                />
              </label>
              {/*  **거래처는 따로 꺼낸다**(2026-09-11 사장님: "거래처필터를 검색필드 조건값 다음으로 옮기고"). 제일 자주 거르는 것인데 '필드 선택 → 조건 값'
                   두 번을 거쳐야 했다. 고르면 그 거래처만 남는다. */}
              <label className="order-3 flex w-36 shrink-0 flex-col gap-1 text-[10px] font-bold text-slate-500">
                거래처
                <SearchableSelect
                  ariaLabel="거래처" className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                  value={listPartnerFilter} onChange={setListPartnerFilter}
                  options={[{ value: '', label: '전체' }, ...[...new Set(activeViewOrders.map(order => order.partnerName || partners.find(p => p.id === order.partnerId)?.name || '').filter(Boolean))]
                    .sort((a, b) => a.localeCompare(b, 'ko'))
                    .map(name => ({ value: name, label: name }))]}
                />
              </label>
              {/*  **정렬도 검색조건 안이다**(2026-09-11 사장님: "정렬을 검색조건에 넣어").
                   조회 결과 머리에 따로 떠 있어서, 조건을 잡는 자리가 두 군데로 갈려 있었다. */}
              {/*  정렬은 **한 줄 아래**로 내린다(2026-09-11 사장님) — 위 줄이 날짜·필드로 이미 빽빽하다. */}
              <span className="order-3 h-0 basis-full" aria-hidden="true" />
              <label className="order-4 flex w-44 shrink-0 flex-col gap-1 text-[10px] font-bold text-slate-500">
                정렬
                <SearchableSelect
                  ariaLabel="정렬" className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                  value={listSort} onChange={value => setListSort(value as typeof listSort)}
                  options={정렬목록}
                />
              </label>
              <label className="order-4 flex min-w-52 flex-1 flex-col gap-1 text-[10px] font-bold text-slate-500 md:max-w-sm">
                전체 검색
                <span className="relative block">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} aria-hidden="true" />
                  <input type="search" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="거래처, 품목, 제조, 라벨, 포장, 팔레트 검색" className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300" />
                </span>
              </label>
            </div>
          </section>
          {/*  이력 탭에는 상태 고르개를 안 둔다(2026-09-11 사장님) — 거긴 예전 주문 하나뿐이라 고를 게 없다. */}
          <div className={`items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white px-1 ${activeView === 'history' ? 'hidden' : 'flex'}`} aria-label="주문 상태 선택">
            {[{ value: 'all' as const, label: '전체', count: activeKanbanOrders.length }, ...visibleActiveConfigs.map(config => ({ value: config.targetStatus, label: config.label, count: activeKanbanOrders.filter(order => order.status === config.targetStatus).length }))].map(tab => (
              <button key={tab.value} type="button" onClick={() => setListStatusTab(tab.value)} className={`flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-xs font-black transition-colors ${listStatusTab === tab.value ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>
                <span>{tab.label}</span><span className={`text-[9px] tabular-nums ${listStatusTab === tab.value ? 'text-indigo-500' : 'text-slate-400'}`}>{tab.count}</span>
              </button>
            ))}
          </div>

    </div>
  );

  const sharedQuickToday = seoulDateInput();
  const sharedQuickWeekStart = seoulWeekStart();
  const sharedQuickMonthStart = `${sharedQuickToday.slice(0, 7)}-01`;
  //  폰에서는 여백·글씨를 줄여 '오늘·이번 주·이번 달'이 날짜칸과 한 행에 들어가게 한다.
  const sharedQuickRangeClass = (active: boolean) => `h-full whitespace-nowrap px-1.5 text-[9px] sm:px-3 sm:text-[11px] ${active ? 'bg-slate-900 font-black text-white' : 'font-bold text-slate-600 hover:bg-slate-50'}`;

  return (
    <div className="flex flex-col space-y-4 md:space-y-5 animate-in fade-in duration-300">
      {/*  **최상단 헤더는 없앴다**(2026-09-11 사장님: "주문배송 메뉴의 최상단 헤더도 중복되니까
           제거하고"). 바로 아래에 '전체 주문 관리' 제목이 또 있어 같은 말이 두 번 나왔다.
           `주문 생성` 단추는 금일 작업순서 밑으로 내렸다(아래 `order-3`). */}

      {!embeddedListOnly && <div className="hidden" aria-label="이전 주문 구분">
        {(['delivery','active','history'] as const).map((tab, index) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`flex min-h-10 shrink-0 items-center border-b-2 px-3 text-xs font-black transition-colors ${activeTab === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>
            {['택배', '운영', '이력'][index]}
          </button>
        ))}
      </div>}

      {/* 콘텐츠 첫 줄(검색) + 액션 버튼 같은 행 (검색 좌측 · 버튼 우측) */}
      {!embeddedListOnly && activeTab !== 'active' && <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative w-full md:max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input type="text" placeholder="고객명, 주문번호 검색..." value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl pl-11 pr-4 py-2.5 md:py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0 md:ml-auto">
          {activeView === 'history' && onChangeOrdersMonths && (
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
        </div>
      </div>}

      {activeView === 'calendar' && activeTab === 'delivery' && (
        <CalendarView
          orders={deliveryOrders}
          onUpdateDeliveryDate={onUpdateDeliveryDate}
          onOrderClick={openOrderEditor}
        />
      )}

      {activeTab === 'delivery' && activeView !== 'calendar' && (
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
                <span>출고완료 ({deliveryOrders.filter(o => o.invoicePrinted).length})</span>
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

      {/* ── 운영 주문: 금일 작업순서 + 캘린더/리스트/보드 ── */}
      {activeTab === 'active' && (() => {
        const pickableOrders = activeViewOrders.filter(o => o.status === OrderStatus.PENDING || o.status === OrderStatus.PROCESSING);

        // 픽커용 전체 품목 목록 — 품목 카테고리(subtype)를 그대로 보존한다.
        const allPickableItems: WorkItem[] = pickableOrders.flatMap(o => {
          const partnerName = o.partnerName || partners.find(c => c.id === o.partnerId)?.name || '이름없음';
          return o.items
            .map((item, idx) => ({
              /*  **열쇠에 자리를 안 넣는다**(2026-09-09 사장님: "몇번째 주문이냐는 너무 위험한데").
               *  이 줄은 Firestore 에 저장되는 **사본**이라, 주문에서 앞 품목을 지우면
               *  자리 번호가 다른 품목을 가리킨다. 되찾는 이름은 **주문 쪽이 만든다** —
               *  같은 품목이 두 줄이면 `참기름#1`·`참기름#2` 로 갈라진다(orderLine.lineKeyAt). */
              key: `${o.id}-${lineKeyAt(o.items, idx)}`,
              orderId: o.id,
              itemId: item.itemId,
              lineKey: lineKeyAt(o.items, idx),
              //  같은 품목이 두 줄이면 이름 뒤에 -1 · -2 가 붙는다. 주문카드와 같은 글자다.
              itemName: `${item.name}${lineSuffix(o.items, idx)}`,
              partnerName,
              qty: item.quantity,
              category: items.find(p => p.id === item.itemId)?.category || '미분류',
            }));
        });

        const workOrderOf = (workItem: WorkItem) => activeOperationOrders.find(order => order.id === workItem.orderId);
        const orderItemOf = (workItem: WorkItem) => {
          const order = workOrderOf(workItem);
          if (!order) return undefined;
          const itemIndex = itemIndexOf(workItem, order);
          return itemIndex >= 0 ? order.items[itemIndex] : undefined;
        };
        const isWorkComplete = (workItem: WorkItem) => orderItemOf(workItem)?.checked === true;
        const isWorkProcessing = (workItem: WorkItem) => !isWorkComplete(workItem) && workOrderOf(workItem)?.status === OrderStatus.PROCESSING;
        const isLegacyWorkItem = (workItem: WorkItem) => {
          const product = items.find(item => item.id === workItem.itemId);
          return !product || !String(product.category || '').trim();
        };
        const isDueSoon = (workItem: WorkItem) => {
          const deliveryDate = workOrderOf(workItem)?.deliveryDate?.slice(0, 10);
          if (!deliveryDate || isWorkComplete(workItem)) return false;
          const today = new Date(`${seoulDateInput()}T00:00:00`).getTime();
          const due = new Date(`${deliveryDate}T00:00:00`).getTime();
          return Number.isFinite(due) && due - today <= 24 * 60 * 60 * 1000;
        };
        /* 같은 품목 카테고리 안에서 함께 만들기로 지정한 줄을 붙여 세운다. */
        const 묶음찾기 = (key: string) => {
          const wi = validWorkItems.find(x => x.key === key);
          return wi?.groupId ? { id: wi.groupId, name: wi.groupName } : undefined;
        };

        /** 고른 줄들을 한 묶음으로 — 이미 묶인 줄을 누르면 그 자리에서 푼다 */
        const toggleWorkGroupPick = (key: string) => {
          const wi = validWorkItems.find(x => x.key === key);
          if (wi?.groupId) {
            const 남는수 = validWorkItems.filter(x => x.groupId === wi.groupId).length - 1;
            setWorkItems(prev => prev.map(x =>
              //  한 명만 남으면 그 묶음도 없앤다 — 혼자는 묶음이 아니다
              (x.key === key || (남는수 < 2 && x.groupId === wi.groupId))
                ? { ...x, groupId: undefined, groupName: undefined } : x));
            return;
          }
          setWorkGroupPick(prev => prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]);
        };
        const confirmWorkGroup = () => {
          if (workGroupPick.length < 2) return;
          const gid = `wg-${Date.now()}`;
          setWorkItems(prev => prev.map(x => workGroupPick.includes(x.key) ? { ...x, groupId: gid } : x));
          setWorkGroupPick([]);
        };

        //  **빈 그룹도 보여 준다** — 만들어 놓고 아직 안 담은 그룹이 사라지면 담을 데가 없다.
        const workCategories = [...new Set([...workGroups, ...validWorkItems.map(workCategoryOf)])]
          .sort((a, b) => {
            const ai = workGroups.indexOf(a); const bi = workGroups.indexOf(b);
            return (ai === -1 ? workGroups.length : ai) - (bi === -1 ? workGroups.length : bi) || a.localeCompare(b, 'ko');
          });

        //  묶음 띠 색 — 지금 있는 묶음들에 **겹치지 않게** 나눠 준다
        const 묶음띠색 = groupStripes(validWorkItems.map(workItem => workItem.groupId));

        // 순서 이동은 같은 품목 카테고리 안에서만 허용한다.
        const getSection = (workItem: WorkItem) => workCategoryOf(workItem);
        //  머리줄에 적는 수 — **주문이 아니라 줄(품목)** 을 센다(2026-09-12 사장님:
        //  "작업 미완료 n건 작업 완료 n건"). 이 판은 줄 단위로 보는 자리라, 주문 상태
        //  건수(대기중·작업중)보다 줄 수가 눈앞의 일과 맞는다.
        const 완료줄수 = validWorkItems.filter(workItem => isWorkComplete(workItem)).length;
        const 미완료줄수 = validWorkItems.length - 완료줄수;
        const activeMobileWorkCategory = workCategories.includes(mobileWorkCategory) ? mobileWorkCategory : workCategories[0];

        /**
         * **차례에 서는 줄 — 아직 안 한 것만.**
         *
         * 2026-09-12 사장님: "완료된애들은 순서에서 빠지는게 낫겠다".
         * 하루 전(2026-09-11)에는 반대로 "완료포함이 숨겨져도 자기 번호는 계속 들고 있는게
         * 맞지 않나" 하셔서 **숨기기 전 목록에서 번호를 셌는데, 그 판단을 뒤집으신 것이다.**
         * 다 한 줄이 번호를 물고 있으면 1·2·5·7 처럼 구멍이 나서 몇 개 남았는지가 안 읽혔다.
         * 이제 남은 것이 1·2·3 으로 이어져 **번호 끝이 곧 남은 일감 수**다.
         */
        const sectionItemsAll = (category: string) => {
          const categoryItems = [...validWorkItems.filter(workItem => workCategoryOf(workItem) === category)];
          const time = (value?: string) => value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
          if (workSort === 'dueDate') {
            categoryItems.sort((a, b) => {
              const aOrder = workOrderOf(a);
              const bOrder = workOrderOf(b);
              return Number(isWorkProcessing(b)) - Number(isWorkProcessing(a))
                || time(aOrder?.deliveryDate) - time(bOrder?.deliveryDate)
                || time(aOrder?.createdAt) - time(bOrder?.createdAt);
            });
          }
          /*  **다 한 줄은 차례에서 빠진다**(2026-09-12 사장님: "완료된애들은 순서에서 빠지는게
           *  낫겠다"). 2026-09-11 에는 반대로 "숨겨도 제 번호를 들고 있어야 한다" 하셔서
           *  숨기기 전 목록에서 번호를 셌는데, 그 판단을 뒤집으신 것이다.
           *  남은 것이 1·2·3 으로 다시 매겨져 **지금 할 일이 몇 개인지가 번호로 읽힌다.** */
          return clusterByGroup(categoryItems.filter(workItem => !isWorkComplete(workItem)), workItem => workItem.key, 묶음찾기);
        };
        //  다 한 줄은 '작업 완료 n건' 을 눌렀을 때만 뒤에 붙여 보여 준다(차례에는 안 낀다).
        const 다한줄 = (category: string) => clusterByGroup(
          validWorkItems.filter(workItem => workCategoryOf(workItem) === category && isWorkComplete(workItem)),
          workItem => workItem.key, 묶음찾기);
        const orderedSectionItems = (category: string) =>
          showCompletedWorkItems ? [...sectionItemsAll(category), ...다한줄(category)] : sectionItemsAll(category);

        const renderItemRow = (wi: WorkItem, sectionItems: WorkItem[]) => {
          //  자리 번호는 **아직 안 한 줄들** 안에서 센다(`sectionItemsAll`).
          //  다 한 줄은 그 목록에 없어 -1 이 나오므로, 번호 대신 빈칸을 둔다(아래).
          void sectionItems;
          const sectionIdx = sectionItemsAll(workCategoryOf(wi)).findIndex(x => x.key === wi.key);
          const order = workOrderOf(wi);
          const lineIdx = itemIndexOf(wi, order);
          const completed = isWorkComplete(wi);
          const processing = isWorkProcessing(wi);
          const dueSoon = isDueSoon(wi);
          const legacy = isLegacyWorkItem(wi);
          // 끌고 있는 항목과 공정(기름/가루)이 다르면 여기엔 못 놓는다.
          // dragover 중에는 dataTransfer를 읽을 수 없어(브라우저 보안) 끌기 시작할 때 기억해 둔 키로 판단한다.
          const dragging = draggingWorkKey ? validWorkItems.find(x => x.key === draggingWorkKey) : null;
          const blocked = !!dragging && dragging.key !== wi.key
            && getSection(dragging) !== getSection(wi);
          return (
            /*  **끌 수 있는 것은 손잡이뿐이다**(2026-09-12 사장님: "달력 안 눌리는거 확인했어").
                줄 전체가 `draggable` 이면 **크롬이 그 안의 입력칸 눌림을 끌기로 먹어 버려서**
                소비기한 달력이 안 열리고 라벨 고르개도 잘 안 잡힌다.
                배송 줄(`DeliveryDayList`)이 같은 이유로 진작 손잡이만 끌게 해 뒀다 — 그대로 맞춘다.
                놓는 자리는 줄 전체 그대로다(좁은 손잡이에만 놓게 하면 옮기기가 어렵다). */
            <div
              key={wi.key}
              /* 못 놓는 칸은 preventDefault를 하지 않아 브라우저가 '놓을 수 없음' 커서를 띄우게 둔다 */
              onDragOver={e => { if (blocked) { e.dataTransfer.dropEffect = 'none'; return; } e.preventDefault(); }}
              onDrop={e => {
                setDraggingWorkKey(null);
                // 손으로 옮긴 순간 어떤 정렬 기준과도 맞지 않으므로 '적용된 정렬' 표시를 푼다
                setWorkSort(null);
                e.preventDefault();
                const dragKey = e.dataTransfer.getData('workItemKey');
                if (!dragKey || dragKey === wi.key) return;
                setWorkItems(() => {
                  const a = [...validWorkItems];
                  const fromIdx = a.findIndex(x => x.key === dragKey);
                  const toIdx = a.findIndex(x => x.key === wi.key);
                  if (fromIdx === -1 || toIdx === -1) return a;
                  if (getSection(a[fromIdx]) !== getSection(a[toIdx])) return a;
                  const [removed] = a.splice(fromIdx, 1);
                  const newTo = a.findIndex(x => x.key === wi.key);
                  a.splice(newTo, 0, removed);
                  return a;
                });
              }}
              /* 가로로 흐르는 카드 — 순번이 좌→우로 읽히므로 순서 이동도 ←/→ 다.
                 폭을 고정하지 않고 max-w로만 묶어 짧은 이름은 자리를 덜 먹는다.
                 카드 표면 대부분이 버튼(품목명·순서이동·빼기)이라 실제로 끌 수 있는 곳은 손잡이뿐이다.
                 그래서 cursor-grab은 카드 전체가 아니라 손잡이에만 준다 — 전엔 카드 전체에 걸려 있어
                 아무 데나 잡아도 되는 것처럼 보였지만 실제로는 안 끌렸다. */
              title={blocked ? '서로 다른 품목 카테고리 간에는 순서를 바꿀 수 없습니다' : undefined}
              className={`flex min-h-[48px] flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border px-2.5 py-2 transition-all ${completed ? 'border-slate-200 bg-slate-50 text-slate-400' : processing ? 'border-sky-200 bg-sky-50/70 shadow-sm' : 'border-slate-200 bg-white shadow-sm'} ${(wi.groupId ? `border-l-4 ${묶음띠색(wi.groupId)} ` : '')}${workGroupPick.includes(wi.key) ? 'ring-2 ring-violet-400' : ''} ${blocked ? 'opacity-30' : ''}`}
            >
              {/*  **숫자를 눌러 순서를 직접 고른다**(2026-09-11 사장님) — 배송순서·배송 캘린더와
                   같은 모양이다. 직접 정렬일 때만 고를 수 있다(추천 정렬이면 눌러 봐야 덮인다).
                   자리는 **그 묶음 안에서만** 옮긴다 — 기름 줄을 깨 칸으로 보내려면 그룹을 바꿔야 한다. */}
              {/*  **다 한 줄은 번호가 없다** — 차례에서 빠졌기 때문이다.
                   빈칸이라도 자리(w-7)는 남겨 둬야 아래 줄들과 글자가 어긋나지 않는다.
                   (안 그러면 고르개의 값이 목록에 없는 0 이 되어 브라우저가 멋대로 1 을 고른다 —
                   다 한 줄마다 '1' 이 찍혀 첫 줄이 여럿으로 보였다.) */}
              {completed ? (
                <span className="w-7 shrink-0" aria-hidden="true" />
              ) : workSort === null ? (
                <select
                  aria-label={`${wi.itemName} 작업 순서`}
                  value={sectionIdx + 1}
                  onPointerDown={event => event.stopPropagation()}
                  onChange={event => {
                    const 목표 = Number(event.target.value) - 1;
                    const 칸 = sectionItemsAll(workCategoryOf(wi));
                    const 지금 = 칸.findIndex(x => x.key === wi.key);
                    if (지금 < 0 || 목표 < 0 || 목표 === 지금) return;
                    const 새칸 = [...칸];
                    const [옮길것] = 새칸.splice(지금, 1);
                    새칸.splice(목표, 0, 옮길것);
                    //  전체 목록에서 **이 묶음 자리만** 새 차례로 갈아 끼운다.
                    let n = 0;
                    setWorkItems(validWorkItems.map(x =>
                      workCategoryOf(x) === workCategoryOf(wi) ? 새칸[n++] : x));
                  }}
                  className={`h-7 w-7 shrink-0 cursor-pointer appearance-none rounded-lg border border-slate-200 bg-slate-50 text-center text-xs font-black tabular-nums outline-none focus:ring-2 focus:ring-indigo-300 ${completed ? 'text-slate-400' : 'text-indigo-600'}`}
                >
                  {sectionItemsAll(workCategoryOf(wi)).map((_, n) => <option key={n} value={n + 1}>{n + 1}</option>)}
                </select>
              ) : (
                <span className={`w-7 shrink-0 text-center text-xs font-black tabular-nums ${completed ? 'text-slate-400' : 'text-indigo-600'}`}>{sectionIdx + 1}</span>
              )}
              <button
                onClick={e => { e.stopPropagation(); setPreviewOrderId(wi.orderId); }}
                className="min-w-0 flex-1 basis-32 text-left transition-opacity hover:opacity-70"
              >
                {/*  **거래처 → 품목 → 수량 → 라벨** 차례로 읽는다(2026-09-11 사장님:
                     "작업순서 한 행이: 거래처명 품목명 수량 (라벨 날인,부착 상태)").
                     현장은 "어디 갈 것인지"부터 보므로 거래처가 맨 앞이다.
                     **단위는 품목에서 읽는다**(2026-09-09) — 박스 품목이면 '박스' 다.
                     라벨은 `대기`면 안 적는다 — 아직 안 한 것까지 적으면 한 줄이 딱지로 덮인다. */}
                <p className="flex min-w-0 items-center gap-1.5">
                  <span className={`shrink-0 text-[11px] font-black ${completed ? 'text-slate-400' : 'text-indigo-600'}`}>{wi.partnerName}</span>
                  <span className={`min-w-0 truncate text-xs font-black ${completed ? 'text-slate-500' : 'text-slate-800'}`}>{wi.itemName}</span>
                </p>
              </button>
              {/*  **수량은 줄 오른쪽 끝**(2026-09-12 사장님: "수량 더 오른쪽으로 밀어서 품목명 더
                   길게 나오게"). 품목명 바로 옆에 붙여 뒀더니 긴 이름이 그만큼 먼저 잘렸다.
                   이름 칸 밖으로 꺼내 `ml-auto` 로 밀어 두면 남는 폭이 전부 이름에 간다.
                   **단위는 품목에서 읽는다**(2026-09-09) — 박스 품목이면 '박스' 다. */}
              <span className={`ml-auto shrink-0 whitespace-nowrap text-[11px] font-black ${completed ? 'text-slate-400' : 'text-slate-600'}`}>
                {wi.qty}{items.find(p => p.id === wi.itemId)?.unit || '개'}
              </span>
              {/*  **라벨·소비기한은 오른쪽 같은 줄에서 바로 고친다**(2026-09-12 사장님:
                   "라벨대기랑 소비기한 미설정이 한행에서 우측으로 오고", "저기서도 라벨 상태 바꾸고
                   소비기한 설정할 수 있게").
                   전에는 읽기만 되고 고치려면 주문을 열어야 했다. 모양·셈은 **리스트 것과 같다** —
                   라벨은 `-`/날인/부착, 소비기한은 제조일을 고르면 1년 뒤로 잡힌다
                   (`expiryFromMfgDate`). 끌어서 순서를 바꾸는 줄이라 눌림은 위로 안 넘긴다. */}
              {(() => {
                const 줄 = lineIdx >= 0 ? order?.items?.[lineIdx] : undefined;
                const 못고침 = !order || lineIdx < 0 || !onUpdateItems;
                const 고치기 = (조각: Partial<OrderItem>) => {
                  if (!order || lineIdx < 0) return;
                  const 다음 = [...order.items];
                  다음[lineIdx] = { ...다음[lineIdx], ...조각 };
                  onUpdateItems?.(order.id, 다음);
                };
                const 라벨 = 줄?.labelType ?? '대기';
                return (
                  /*  **좁으면 두 줄로 간다**(2026-09-12 사장님: "ㅇㅈㄹ났는데 차라리 두줄로 가던가").
                      폰에서 한 줄에 다 세웠더니 거래처·품목이 한 글자로 눌렸다. 라벨·소비기한은
                      폭이 정해진 칸이라 줄어들 수가 없어, 좁을 땐 **통째로 아랫줄**로 내린다
                      (`order-last w-full`). 넓은 화면은 예전처럼 한 줄이다. */
                  <div className="order-last flex w-full items-center justify-end gap-2 sm:order-none sm:ml-auto sm:w-auto">
                    {/*  **다 한 것 표시는 리스트 것을 그대로 쓴다**(2026-09-12 사장님: "체크박스 대신에
                         리스트에서 작업완료 여부 표시하는 그걸로 갖다 쓰자"). 같은 일을 두 모양으로
                         그리지 않는다 — 리스트에서 완료/미완료를 읽던 눈이 여기서도 그대로 읽힌다.
                         라벨·소비기한과 **한 덩어리**다(사장님: "미완료도 한행 내려버려") —
                         좁으면 셋이 같이 아랫줄로 가고, 넓으면 셋이 같이 오른쪽에 선다. */}
                    {/*  눌림을 막지 않는다 — 이 줄에는 누름 처리가 없고, 폰에서 끌기로 먹히면
                         탭이 씹힌다(2026-09-12 사장님: "이건 클릭이 안된다"). */}
                    <div className="shrink-0">
                      <CompletionStatusControl
                        completed={completed}
                        disabled={lineIdx < 0 || !onToggleItemChecked}
                        ariaLabel={`${wi.itemName} 작업 완료 전환`}
                        title={completed ? '작업 완료 취소' : '작업 완료'}
                        onChange={() => { if (lineIdx >= 0) followItemToggle(wi.orderId, lineIdx, currentUserName); }}
                      />
                    </div>
                    <div className="relative w-[58px] shrink-0" onPointerDown={e => e.stopPropagation()}>
                      <select
                        value={라벨} disabled={못고침}
                        onChange={e => 고치기({ labelType: e.target.value as '대기' | '날인' | '부착' })}
                        aria-label={`${wi.itemName} 라벨 상태`}
                        className={`h-7 w-full cursor-pointer appearance-none rounded-md border border-slate-200 pl-2 pr-5 text-[10px] font-black outline-none transition-colors focus:ring-1 focus:ring-indigo-400 disabled:cursor-default disabled:opacity-60 ${라벨 === '대기' ? 'bg-slate-100 font-bold text-slate-700 enabled:hover:bg-slate-200' : 'bg-slate-100 text-slate-700 enabled:hover:bg-slate-200'}`}
                      >
                        <option value="대기">-</option>
                        <option value="날인">날인</option>
                        <option value="부착">부착</option>
                      </select>
                      <ChevronDown size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    </div>
                    <div className="relative h-7 w-[92px] shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-[10px] font-black transition-colors hover:bg-slate-200 focus-within:ring-1 focus-within:ring-indigo-400"
                      onPointerDown={e => e.stopPropagation()}>
                      <input
                        type="date" value={줄?.mfgDate || ''} disabled={못고침}
                        onChange={e => 고치기({ mfgDate: e.target.value })}
                        aria-label={`${wi.itemName} 소비기한 수정용 제조일`}
                        className="peer absolute inset-0 z-10 h-full w-full min-w-0 cursor-pointer opacity-0 disabled:cursor-default"
                      />
                      <span className={`pointer-events-none flex h-full min-w-0 items-center gap-1 px-1.5 ${줄?.mfgDate ? 'text-indigo-600' : 'text-slate-700'}`}>
                        <CalendarDays size={11} className="shrink-0" aria-hidden="true" />
                        <span className="min-w-0 truncate tabular-nums">{줄?.mfgDate ? fmtYYMMDD(expiryFromMfgDate(줄.mfgDate)) : '-'}</span>
                      </span>
                    </div>
                    {/*  손잡이·묶기도 이 덩어리에 넣는다 — 폰에서 라벨·소비기한과 **같이** 내려가야
                         윗줄이 온전히 이름 몫이 된다. 넓은 화면에서는 서던 자리 그대로다. */}
                    <div className="flex items-center gap-0.5">
                      <span
                        draggable={workSort === null}
                        onDragStart={e => { e.dataTransfer.setData('workItemKey', wi.key); e.dataTransfer.effectAllowed = 'move'; setDraggingWorkKey(wi.key); }}
                        onDragEnd={() => setDraggingWorkKey(null)}
                        title={workSort === null ? '끌어서 순서 바꾸기' : '직접 정렬을 선택하면 이동할 수 있습니다'}
                        className={`rounded p-1 transition-colors ${workSort === null ? 'cursor-grab text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 active:cursor-grabbing' : 'cursor-not-allowed text-slate-300'}`}>
                        <GripVertical size={16} />
                      </span>
                    </div>
                    {/*  같이 만들 것끼리 묶기 — 이미 묶인 줄을 누르면 그 자리에서 푼다 */}
                    <button
                      onClick={e => { e.stopPropagation(); toggleWorkGroupPick(wi.key); }}
                      aria-label={wi.groupId ? '묶음에서 빼기' : '같이 만들 것 고르기'}
                      className={`shrink-0 transition-colors ${workGroupPick.includes(wi.key) ? 'text-violet-500' : 'text-slate-200 hover:text-violet-400'}`}
                    >{wi.groupId ? <Unlink size={13} /> : <Link2 size={13} />}</button>
                  </div>
                );
              })()}
              {/*  **날짜와 상태 딱지는 뺐다**(2026-09-12 사장님: "금일작업순서에 날짜랑 대기중
                   없애라니까", "대기중 작업중 상태 표시를 없애라고").
                   오늘 할 일만 세운 칸이라 날짜가 줄마다 붙을 이유가 없고, 다 한 것은 왼쪽
                   체크로 이미 보인다. 경고 딱지(출고 임박·카테고리 누락)는 남긴다 — 그건 상태가
                   아니라 **손을 봐야 한다는 신호**다. */}
              <div className="flex flex-wrap justify-end gap-1">
                {dueSoon && <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-black text-rose-600"><AlertTriangle size={11} aria-hidden="true" />출고 임박</span>}
                {legacy && <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-black text-amber-700"><AlertTriangle size={11} aria-hidden="true" />품목 카테고리 누락</span>}
              </div>
            </div>
          );
        };

        const renderWorkCategory = (category: string) => {
          const sectionItems = orderedSectionItems(category);
          const totalCount = validWorkItems.filter(workItem => workCategoryOf(workItem) === category).length;
          /*  **껍데기와 갈래 이름을 뺐다**(2026-09-12 사장님: "작업순서 그룹 배경 테두리 바탕색
              없애고 굳이 기름 글자도 없어도 될거 같은디").
              바로 위 탭이 이미 `기름 14 · 깨 7 · 미분류 1` 을 보여 준다 — 같은 말을 두 번 적을
              이유가 없고, 테두리·바탕이 빠진 만큼 줄이 좌우로 넓어진다.
              몇 개 중 몇 개를 보고 있는지(`12/14`)는 남긴다 — 탭의 수는 전체라, '작업 완료 n건'
              을 안 눌렀을 때 몇 줄이 빠져 있는지는 여기서만 알 수 있다. */
          return (
            <section key={category} className="min-w-0" aria-label={`${category} 작업순서`}>
              <div className="mb-1.5 flex items-center justify-end px-1">
                <span className="text-[10px] font-bold text-slate-400">{sectionItems.length}/{totalCount}</span>
              </div>
              {/*  **다섯 줄까지만 펴 두고 나머지는 스크롤**(2026-09-11 사장님: "작업순서는 상위
                   다섯개 이후는 스크롤로 바꿔"). 한 칸에 열 줄씩 쌓이면 다른 칸이 화면 밖으로 밀린다.
                   넓은 화면은 한 줄이 48px 이라 다섯 줄 = 264px, 폰은 두 줄이라 404px 로 잡는다.
                   다섯 줄 이하면 높이를 안 잡는다 — 짧은 칸에 빈 자리가 남지 않게. */}
              <div
                className={`space-y-1.5 overflow-y-auto ${sectionItems.length > 5 ? 'max-h-[404px] sm:max-h-[264px]' : ''}`}
                style={sectionItems.length > 5 ? { scrollbarWidth: 'thin' } : undefined}
              >
                {sectionItems.length > 0
                  ? sectionItems.map(workItem => renderItemRow(workItem, sectionItems))
                  : <p className="py-5 text-center text-[11px] font-bold text-slate-400">표시할 작업이 없습니다</p>}
              </div>
            </section>
          );
        };

        const renderCol = (col: typeof activeConfigs[0] | typeof historyConfig) => {
          //  보드 칸도 같은 정렬을 지난다 — 리스트에서 고른 차례가 여기서도 그대로 보인다.
          const allColOrders = 정렬(activeViewOrders.filter(o => col.statusFilter.includes(o.status)));
          const units = activeView === 'list' ? 1 : (columnUnits[col.id] ?? defaultUnits[col.id] ?? 1);
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
              onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('orderId'); if (id && col.targetStatus) requestBoardStatusChange(id, col.targetStatus); }}
              /*  **칸 바탕은 흰색이다**(2026-09-11 사장님: "보드 각 컬럼에 바탕색 좀 빼라").
                  칸마다 색이 깔려 있으면 그 위에 얹힌 주문 카드의 상태 색이 안 읽힌다 —
                  색으로 알려야 할 것은 카드지 칸이 아니다. 테두리와 머리 아이콘 색은 남긴다. */
              className={`flex flex-col rounded-3xl border bg-white ${col.borderColor} shadow-sm ${activeView === 'kanban' ? 'flex-shrink-0' : 'w-full'}`}
              style={{
                ...(activeView === 'kanban' && typeof window !== 'undefined' && window.innerWidth >= 768 ? { width: `calc(${units} * (100vw - 9rem) / 5)` } : {}),
                minWidth: activeView === 'kanban' && typeof window !== 'undefined' && window.innerWidth >= 768 ? 320 : undefined,
              }}
            >
              <div className="px-4 py-3 border-b border-white/50 flex items-center justify-between">
                <button className="flex items-center gap-2 md:cursor-default" onClick={() => { if (window.innerWidth < 768) toggleMobileCollapse(col.id); }}>
                  <div className={`p-1.5 rounded-xl ${col.color} text-white`}><Icon size={16} /></div>
                  <h3 className={`font-black text-sm ${col.textColor}`}>{col.label} ({allColOrders.length})</h3>
                  <ChevronDown size={14} className={`md:hidden text-slate-400 transition-transform ${mobileCollapsed.has(col.id) ? '' : 'rotate-180'}`} />
                </button>
                {activeView === 'kanban' && <div className="hidden items-center space-x-0.5 md:flex" aria-label={`${col.label} 열 너비 조절`}>
                  {units > 1 && <button type="button" onClick={() => collapseColumn(col.id)} aria-label={`${col.label} 열 너비 축소`} title="열 너비 축소" className="group relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-all hover:bg-white/60 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"><Minimize2 size={14} aria-hidden="true" /><span role="tooltip" className="pointer-events-none absolute right-0 top-full z-40 mt-1.5 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-bold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">열 너비 축소</span></button>}
                  <span className="px-1 text-[10px] font-black text-slate-400" aria-label={`현재 너비 ${units}단계`}>{units}</span>
                  {units < colMax && <button type="button" onClick={() => expandColumn(col.id)} aria-label={`${col.label} 열 너비 확대`} title="열 너비 확대" className="group relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-all hover:bg-white/60 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"><Maximize2 size={14} aria-hidden="true" /><span role="tooltip" className="pointer-events-none absolute right-0 top-full z-40 mt-1.5 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] font-bold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">열 너비 확대</span></button>}
                </div>}
              </div>
              <div className={`px-4 pt-4 pb-3 space-y-5 ${mobileCollapsed.has(col.id) ? 'hidden md:block' : ''}`}>
                {(['스마트스토어', '택배', '일반'] as OrderSource[]).map(source => (
                  <OrderSourceGroup key={source} colId={col.id} source={source} orders={groupedOrders[source]} gridCols={units} collapsedCategories={collapsedCategories} onToggleCategory={onToggleCategory} {...cardSharedProps} />
                ))}
                {allColOrders.length === 0 && <div className="flex flex-col items-center justify-center py-20 opacity-20"><Inbox size={48} /><p className="text-xs font-bold mt-2">주문이 없습니다</p></div>}
              </div>
            </div>
          );
        };

        const renderListTable = () => {
          const allActiveListOrders = embeddedListOnly ? activeOperationOrders : activePeriodOrders;
          /*  **네 열을 둘로 합친다**(2026-09-11 사장님: "주문일 출고예정일은 합쳐서 위아래 두줄로
              놔 출고방식 열은 거래처에 합치고"). 가로로 길어 좌우로 밀어 보던 표를 줄인다 —
              날짜 둘은 한 칸에서 위아래로, 출고방식은 거래처 이름 위에 얹는다. */
          const visibleListColumns = [
            //  맨 앞은 **주문번호 + 상태**(2026-09-11 사장님) — 어느 주문인지, 지금 어디까지 왔는지.
            'orderNo',
            'dates', 'partner',
            ...(embeddedListOnly ? ['address'] : []),
            ...(embeddedListOnly ? ['shipmentComplete'] : []),
            'completion',
            ...(showListCompletionColumns ? ['confirmer', 'confirmedAt'] : []),
            'item',
            ...(showListDetailColumns ? ['manufacturing', 'bottle', 'cap', 'componentLabel'] : []),
            'quantity',
            //  포장이 송장보다 앞이다(2026-09-11 사장님) — 싸고 나서 송장을 붙인다.
            /*  **송장과 팔레트는 한 칸이다**(2026-09-12 사장님: "송장 팔레트 합쳐서 출고
                방식으로 바꾸고"). 택배로 나가면 팔레트가 돌 일이 없고, 우리 차가 돌면 송장이
                붙을 일이 없다 — 늘 한쪽만 쓰던 두 칸이라 자리를 반으로 먹고 있었다. */
            'label', 'packaging', 'shipOut', 'note',
          ];
          const listGridTemplate = visibleListColumns.map(column => `${listColumnWidths[column]}px`).join(' ');
          const listMinWidth = visibleListColumns.reduce((total, column) => total + listColumnWidths[column], 0);
          const listGridStyle = { gridTemplateColumns: listGridTemplate, width: listMinWidth, minWidth: listMinWidth };
          const startListColumnResize = (column: string, event: React.MouseEvent<HTMLSpanElement>) => {
            event.preventDefault();
            event.stopPropagation();
            const startX = event.clientX;
            const startWidth = listColumnWidths[column];
            const onMove = (moveEvent: MouseEvent) => {
              const nextWidth = Math.max(64, startWidth + moveEvent.clientX - startX);
              setListColumnWidths(previous => ({ ...previous, [column]: nextWidth }));
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          };
          const resizeHandle = (column: string) => (
            <span
              role="separator"
              aria-orientation="vertical"
              title="드래그해서 열 너비 조정"
              onMouseDown={event => startListColumnResize(column, event)}
              onClick={event => { event.preventDefault(); event.stopPropagation(); }}
              className="absolute -right-1 top-0 z-30 h-full w-2 cursor-col-resize select-none after:absolute after:bottom-0 after:left-1/2 after:top-0 after:w-px after:-translate-x-1/2 after:bg-slate-300 hover:after:w-0.5 hover:after:bg-indigo-500"
            />
          );
          const listInlineSelectClass = 'h-7 cursor-pointer rounded-md border border-slate-200 pl-2 pr-6 text-[10px] font-black outline-none transition-colors focus:ring-1 focus:ring-indigo-400';
          const getListItemDetail = (_order: Order, orderItem: OrderItem) => orderItemDetails(orderItem, items);
          const getPalletSummary = (order: Order) => (order.pallets ?? [])
            .filter(pallet => pallet.quantity > 0)
            .map(pallet => {
              const palletName = palletStocks?.find(stock => stock.id === pallet.type)?.name || pallet.type;
              return `${palletName} ${pallet.quantity}개${pallet.isExchange ? ' · 교환' : ''}`;
            });

          const normalizedListSearch = searchTerm.trim().toLocaleLowerCase('ko-KR');
          const matchesOrderHeaderSearch = (order: Order) => {
            const partner = partners.find(candidate => candidate.id === order.partnerId);
            const partnerName = order.partnerName || partner?.name || '';
            const partnerAddress = [partner?.address, partner?.addressDetail].filter(Boolean).join(' ');
            return [
              order.id, partnerName, partnerAddress, STATUS_LABEL[order.status], order.status, order.source,
              (order.source === '택배' || order.source === '스마트스토어' || order.deliveryBoxes !== undefined) ? (order.invoicePrinted ? '송장 출력 완료' : '송장 미출력') : '',
              order.createdAt, order.deliveryDate,
              fmtYYMMDD(new Date(order.createdAt)), fmtYYMMDD(new Date(order.deliveryDate)),
              ...getPalletSummary(order),
            ].filter(Boolean).some(value => String(value).toLocaleLowerCase('ko-KR').includes(normalizedListSearch));
          };
          const matchesItemSearch = (order: Order, item: OrderItem) => {
            const detail = getListItemDetail(order, item);
            const product = items.find(candidate => candidate.id === item.itemId);
            const quantity = item.isBoxUnit && item.boxQuantity ? `${item.boxQuantity}박스` : `${item.quantity}${product?.unit || '개'}`;
            return [
              item.name, quantity, item.checked ? '완료' : '미완료', item.checkedBy, item.checkedAt,
              item.labelType && item.labelType !== '대기' ? item.labelType : '-', item.mfgDate, item.note, item.noteBy, item.noteAt,
              ...detail.manufacturing, ...detail.labels, ...detail.packaging,
            ].filter(Boolean).some(value => String(value).toLocaleLowerCase('ko-KR').includes(normalizedListSearch));
          };
          const searchMatchedListOrders = !normalizedListSearch ? allActiveListOrders : allActiveListOrders.filter(order =>
            matchesOrderHeaderSearch(order) || order.items.some(item => matchesItemSearch(order, item))
          );
          const baseListOrders = embeddedListOnly || listStatusTab === 'all' ? searchMatchedListOrders : searchMatchedListOrders.filter(order => order.status === listStatusTab);

          const filterValues = [...new Set(baseListOrders.flatMap(order => {
            if (listFilterField === 'partner') return [order.partnerName || partners.find(partner => partner.id === order.partnerId)?.name || '이름 없음'];
            if (listFilterField === 'completion') return order.items.map(item => item.checked ? '완료' : '미완료');
            if (listFilterField === 'source') return [order.source];
            if (listFilterField === 'shipMethod') return [shipMethodOf(order)];
            if (listFilterField === 'invoicePrinted') return [(order.source === '택배' || order.source === '스마트스토어' || order.deliveryBoxes !== undefined) ? (order.invoicePrinted ? '출력 완료' : '미출력') : '-'];
            if (listFilterField === 'item') return order.items.map(item => item.name);
            if (listFilterField === 'quantity') return order.items.map(item => item.isBoxUnit && item.boxQuantity ? `${item.boxQuantity}박스` : `${item.quantity}${items.find(product => product.id === item.itemId)?.unit || '개'}`);
            if (listFilterField === 'label') return order.items.map(item => item.labelType && item.labelType !== '대기' ? item.labelType : '-');
            if (listFilterField === 'manufacturing') return order.items.flatMap(item => getListItemDetail(order, item).manufacturing);
            if (listFilterField === 'packaging') return order.items.flatMap(item => getListItemDetail(order, item).packaging);
            if (listFilterField === 'pallet') return getPalletSummary(order);
            if (listFilterField === 'orderDate') return [fmtYYMMDD(new Date(order.createdAt))];
            if (listFilterField === 'deliveryDate') return [fmtYYMMDD(new Date(order.deliveryDate))];
            return [];
          }).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));

          const matchesListFilter = (order: Order) => {
            if (!listFilterField || !listFilterValue) return true;
            if (listFilterField === 'partner') return (order.partnerName || partners.find(partner => partner.id === order.partnerId)?.name || '이름 없음') === listFilterValue;
            if (listFilterField === 'completion') return order.items.some(item => (item.checked ? '완료' : '미완료') === listFilterValue);
            if (listFilterField === 'source') return order.source === listFilterValue;
            if (listFilterField === 'shipMethod') return shipMethodOf(order) === listFilterValue;
            if (listFilterField === 'invoicePrinted') return ((order.source === '택배' || order.source === '스마트스토어' || order.deliveryBoxes !== undefined) ? (order.invoicePrinted ? '출력 완료' : '미출력') : '-') === listFilterValue;
            if (listFilterField === 'item') return order.items.some(item => item.name === listFilterValue);
            if (listFilterField === 'quantity') return order.items.some(item => (item.isBoxUnit && item.boxQuantity ? `${item.boxQuantity}박스` : `${item.quantity}${items.find(product => product.id === item.itemId)?.unit || '개'}`) === listFilterValue);
            if (listFilterField === 'label') return order.items.some(item => (item.labelType && item.labelType !== '대기' ? item.labelType : '-') === listFilterValue);
            if (listFilterField === 'manufacturing') return order.items.some(item => getListItemDetail(order, item).manufacturing.includes(listFilterValue));
            if (listFilterField === 'packaging') return order.items.some(item => getListItemDetail(order, item).packaging.includes(listFilterValue));
            if (listFilterField === 'pallet') return getPalletSummary(order).includes(listFilterValue);
            if (listFilterField === 'orderDate') return fmtYYMMDD(new Date(order.createdAt)) === listFilterValue;
            return fmtYYMMDD(new Date(order.deliveryDate)) === listFilterValue;
          };
          const stockSlackForOrder = (order: Order) => Math.min(...order.items.map(item => {
            const product = items.find(candidate => candidate.id === item.itemId);
            return product ? (product.stock ?? 0) - item.quantity : Number.POSITIVE_INFINITY;
          }));
          //  거래처 거르개는 검색필드와 **따로** 먹는다 — 둘을 같이 걸 수 있어야 쓸모가 있다.
          const searchConditionMatchedListOrders = searchMatchedListOrders.filter(matchesListFilter).filter(거래처걸림);
          const listOrders = 정렬(embeddedListOnly || listStatusTab === 'all'
            ? searchConditionMatchedListOrders
            : searchConditionMatchedListOrders.filter(order => order.status === listStatusTab));
          const listPageSize = 20;
          const listPageCount = Math.max(1, Math.ceil(listOrders.length / listPageSize));
          const currentListPage = Math.min(listPage, listPageCount);
          const paginatedListOrders = listOrders.slice((currentListPage - 1) * listPageSize, currentListPage * listPageSize);
          const toggleListItemCompleted = (order: Order, itemIndex: number) => followItemToggle(order.id, itemIndex, currentUserName);
          const quickToday = seoulDateInput();
          const quickWeekStart = seoulWeekStart();
          const quickMonthStart = `${quickToday.slice(0, 7)}-01`;
          const quickRangeClass = (active: boolean) => `h-full px-3 text-[11px] ${active ? 'bg-slate-900 font-black text-white' : 'font-bold text-slate-600 hover:bg-slate-50'}`;

          return (
            <div className="order-4 space-y-3">
              <section className="hidden" aria-labelledby="list-query-title">
                <div className="flex min-h-11 items-center gap-2 border-b border-slate-200 px-4 py-2.5">
                  <h3 id="list-query-title" className="text-xs font-black text-slate-900">검색조건</h3>
                  <span className="text-[10px] font-bold text-slate-400">주문일 · 필드 조건</span>
                  <button type="button" onClick={() => { const today = seoulDateInput(); setActiveDateFrom(`${today.slice(0, 7)}-01`); setActiveDateTo(today); setListFilterField(''); setListFilterValue(''); setSearchTerm(''); }} className="ml-auto text-[10px] font-bold text-slate-400 hover:text-slate-700">초기화</button>
                </div>
                <div className="flex flex-wrap items-end gap-2 p-3 md:p-4">
                  <span className="order-2 h-0 basis-full" aria-hidden="true" />
                  <div className="order-1 flex flex-col gap-1 text-[10px] font-bold text-slate-500">
                    <span>주문일</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <input aria-label="주문일 시작" type="date" value={activeDateFrom} max={activeDateTo || undefined} onChange={event => setActiveDateFrom(event.target.value)} className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300" />
                      <span className="text-xs text-slate-400">~</span>
                      <input aria-label="주문일 종료" type="date" value={activeDateTo} min={activeDateFrom || undefined} onChange={event => setActiveDateTo(event.target.value)} className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300" />
                      <div className="flex h-9 items-center overflow-hidden rounded-md border border-slate-200 bg-white">
                        <button type="button" onClick={() => { setActiveDateFrom(quickToday); setActiveDateTo(quickToday); }} className={`border-r border-slate-200 ${quickRangeClass(activeDateFrom === quickToday && activeDateTo === quickToday)}`}>오늘</button>
                        <button type="button" onClick={() => { setActiveDateFrom(quickWeekStart); setActiveDateTo(quickToday); }} className={`border-r border-slate-200 ${quickRangeClass(activeDateFrom === quickWeekStart && activeDateTo === quickToday)}`}>이번 주</button>
                        <button type="button" onClick={() => { setActiveDateFrom(quickMonthStart); setActiveDateTo(quickToday); }} className={quickRangeClass(activeDateFrom === quickMonthStart && activeDateTo === quickToday)}>이번 달</button>
                      </div>
                    </div>
                  </div>
                  <label className="order-3 flex min-w-36 flex-col gap-1 text-[10px] font-bold text-slate-500">
                    검색 필드
                    <select value={listFilterField} onChange={event => { setListFilterField(event.target.value as typeof listFilterField); setListFilterValue(''); }} className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300">
                      <option value="">필드 선택</option>
                      <option value="source">출고 방식</option><option value="invoicePrinted">송장</option><option value="partner">거래처</option><option value="completion">작업완료 여부</option><option value="item">주문 품목</option><option value="quantity">주문 수량</option><option value="manufacturing">품목명</option><option value="label">라벨</option><option value="packaging">포장</option><option value="pallet">팔레트</option><option value="orderDate">주문일</option><option value="deliveryDate">출고예정일</option>
                    </select>
                  </label>
                  <label className="order-3 flex min-w-40 flex-1 flex-col gap-1 text-[10px] font-bold text-slate-500 md:max-w-xs">
                    조건 값
                    <select value={listFilterValue} onChange={event => setListFilterValue(event.target.value)} disabled={!listFilterField} className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 outline-none disabled:cursor-not-allowed disabled:opacity-40 focus:border-slate-400 focus:ring-1 focus:ring-slate-300">
                      <option value="">전체</option>
                      {filterValues.map(value => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  <label className="order-3 flex min-w-52 flex-1 flex-col gap-1 text-[10px] font-bold text-slate-500 md:max-w-sm">
                    전체 검색
                    <span className="relative block">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} aria-hidden="true" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={event => setSearchTerm(event.target.value)}
                        placeholder="거래처, 품목, 수량, 라벨, 포장, 팔레트 검색"
                        className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                      />
                    </span>
                  </label>
                </div>
              </section>
              <section className="contents" aria-labelledby="list-display-settings-title">
                <div className="hidden">
                  <Settings2 size={15} className="text-indigo-600" aria-hidden="true" />
                  <h3 id="list-display-settings-title" className="text-xs font-black text-slate-800">표시 설정</h3>
                  <span className="text-[10px] font-bold text-slate-400">상태 · 정렬 · 필터 · 검색</span>
                </div>
                <div className="contents">
              <div className="hidden">
                {[{ value: 'all' as const, label: '전체', count: searchConditionMatchedListOrders.length }, ...visibleActiveConfigs.map(config => ({ value: config.targetStatus, label: config.label, count: searchConditionMatchedListOrders.filter(order => order.status === config.targetStatus).length }))].map(tab => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setListStatusTab(tab.value)}
                    className={`flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-xs font-black transition-colors ${listStatusTab === tab.value ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}
                  >
                    <span>{tab.label}</span>
                    <span className={`text-[9px] tabular-nums ${listStatusTab === tab.value ? 'text-indigo-500' : 'text-slate-400'}`}>{tab.count}</span>
                  </button>
                ))}
                <div className="hidden" aria-label="주문 보기 방식">
                  <button type="button" onClick={() => setActiveView('list')} aria-pressed={activeView === 'list'} className={`flex min-h-7 items-center gap-1 rounded-md px-2 text-[11px] font-black transition-all ${activeView === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}><ListOrdered size={13} /><span>리스트</span></button>
                  <button type="button" onClick={() => setActiveView('kanban')} aria-pressed={activeView === 'kanban'} className={`flex min-h-7 items-center gap-1 rounded-md px-2 text-[11px] font-black transition-all ${activeView === 'kanban' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}><LayoutDashboard size={13} /><span>보드</span></button>
                </div>
              </div>
              <div className="hidden">
                <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm" aria-label="주문 보기 방식">
                  <button type="button" onClick={() => setActiveView('list')} aria-pressed={activeView === 'list'} className={`flex min-h-7 items-center gap-1 rounded-md px-2 text-[11px] font-black transition-all ${activeView === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}><ListOrdered size={13} /><span>리스트</span></button>
                  <button type="button" onClick={() => setActiveView('kanban')} aria-pressed={activeView === 'kanban'} className={`flex min-h-7 items-center gap-1 rounded-md px-2 text-[11px] font-black transition-all ${activeView === 'kanban' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}><LayoutDashboard size={13} /><span>보드</span></button>
                </div>
              </div>
              <div className="hidden">
                <span className="text-[11px] font-black text-slate-500">정렬</span>
                <select value={listSort} onChange={event => setListSort(event.target.value as typeof listSort)} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="delivery">출고예정일 임박 순</option>
                  <option value="order">주문일 최신 순</option>
                  <option value="stock">재고 여유 순</option>
                </select>
                <span className="h-0 basis-full sm:hidden" aria-hidden="true" />
                <span className="ml-1 text-[11px] font-black text-slate-500">필터</span>
                <select value={listFilterField} onChange={event => { setListFilterField(event.target.value as typeof listFilterField); setListFilterValue(''); }} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">필드 선택</option>
                  <option value="source">출고 방식</option>
                  <option value="partner">거래처</option>
                  <option value="completion">작업완료 여부</option>
                  <option value="item">주문 품목</option>
                  <option value="quantity">주문 수량</option>
                  <option value="manufacturing">품목명</option>
                  <option value="label">라벨</option>
                  <option value="packaging">포장</option>
                  <option value="orderDate">주문일</option>
                  <option value="deliveryDate">출고예정일</option>
                  <option value="pallet">팔레트</option>
                </select>
                <select value={listFilterValue} onChange={event => setListFilterValue(event.target.value)} disabled={!listFilterField} className="min-w-32 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none disabled:cursor-not-allowed disabled:opacity-40 focus:ring-2 focus:ring-indigo-500">
                  <option value="">전체</option>
                  {filterValues.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
                {listFilterValue && <button type="button" onClick={() => { setListFilterField(''); setListFilterValue(''); }} className="rounded-lg px-2 py-1.5 text-[11px] font-black text-slate-500 hover:bg-slate-100">필터 초기화</button>}
                <span className="whitespace-nowrap text-[11px] font-bold text-slate-500">결과 <strong className="font-black text-indigo-600">{listOrders.length}건</strong></span>
              </div>
              <div className="hidden">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={event => setSearchTerm(event.target.value)}
                  placeholder="테이블 전체 검색"
                  className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 pl-10 pr-4 text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                />
              </div>
                </div>
              </section>
              <section className="space-y-2" aria-labelledby="list-results-title">
                <div className="flex items-center justify-between gap-3 px-1">
                  <h3 id="list-results-title" className="text-sm font-black text-slate-900">조회 결과 <span className="text-indigo-600">{listOrders.length}건</span></h3>
                </div>
              <div className={`rounded-lg border border-slate-200 bg-white shadow-sm ${showListDetailColumns ? 'w-full' : 'w-fit max-w-full'}`}>
                <div
                  ref={listTopScrollRef}
                  onScroll={event => { if (listBodyScrollRef.current && listBodyScrollRef.current.scrollLeft !== event.currentTarget.scrollLeft) listBodyScrollRef.current.scrollLeft = event.currentTarget.scrollLeft; }}
                  className="h-4 overflow-x-scroll overflow-y-hidden rounded-t-lg border-b border-slate-200 bg-slate-50 [scrollbar-color:#cbd5e1_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300"
                  aria-label="표 가로 스크롤"
                >
                  <div style={{ width: listMinWidth, height: 1 }} />
                </div>
              <div ref={listBodyScrollRef} onScroll={event => { if (listTopScrollRef.current && listTopScrollRef.current.scrollLeft !== event.currentTarget.scrollLeft) listTopScrollRef.current.scrollLeft = event.currentTarget.scrollLeft; }} className="no-scrollbar overflow-x-auto overflow-y-hidden rounded-b-lg" role="table" aria-label="주문 리스트">
                <div role="row" style={listGridStyle} className="sticky top-0 z-10 grid border-b-2 border-slate-400 bg-slate-100 text-[11px] font-black text-slate-600">
                  <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-3">주문번호{resizeHandle('orderNo')}</div>
                  <div role="columnheader" className="relative flex min-h-10 flex-col justify-center border-r border-slate-300 px-3 leading-tight">
                    <span>주문일</span><span className="text-[10px] font-bold text-slate-400">출고예정일</span>{resizeHandle('dates')}
                  </div>
                  <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-3">거래처{resizeHandle('partner')}</div>
                  {embeddedListOnly && <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-3">주소{resizeHandle('address')}</div>}
                  {embeddedListOnly && <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-3">출고완료 여부{resizeHandle('shipmentComplete')}</div>}
                  <button
                    type="button"
                    role="columnheader"
                    onClick={() => setShowListCompletionColumns(value => !value)}
                    className="relative flex min-h-10 items-center justify-between border-r border-slate-300 px-2 text-left hover:bg-indigo-50"
                    title={showListCompletionColumns ? '확인 정보 접기' : '확인 정보 펼치기'}
                  >
                    <span className="whitespace-nowrap">작업완료 여부</span>
                    {showListCompletionColumns ? <ChevronLeft size={14} className="text-indigo-600" /> : <ChevronRight size={14} className="text-indigo-600" />}
                    {resizeHandle('completion')}
                  </button>
                  {showListCompletionColumns && <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-2">확인자{resizeHandle('confirmer')}</div>}
                  {showListCompletionColumns && <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-2">확인날짜{resizeHandle('confirmedAt')}</div>}
                  <button
                    type="button"
                    role="columnheader"
                    onClick={() => setShowListDetailColumns(value => !value)}
                    className="relative flex min-h-10 items-center justify-between border-r border-slate-300 px-3 text-left hover:bg-indigo-50"
                    title={showListDetailColumns ? '품목 상세 접기' : '품목 상세 펼치기'}
                  >
                    <span>주문 품목</span>
                    {showListDetailColumns ? <ChevronLeft size={15} className="text-indigo-600" /> : <ChevronRight size={15} className="text-indigo-600" />}
                    {resizeHandle('item')}
                  </button>
                  {showListDetailColumns ? (
                    <>
                      <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-3">품목명{resizeHandle('manufacturing')}</div>
                      <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-3">병{resizeHandle('bottle')}</div>
                      <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-3">뚜껑{resizeHandle('cap')}</div>
                      <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-3">라벨{resizeHandle('componentLabel')}</div>
                    </>
                  ) : null}
                  <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-3">주문 수량{resizeHandle('quantity')}</div>
                  <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-3">라벨 작업{resizeHandle('label')}</div>
                  <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-3">포장{resizeHandle('packaging')}</div>
                  <div role="columnheader" className="relative flex min-h-10 items-center border-r border-slate-300 px-3">출고 방식{resizeHandle('shipOut')}</div>
                  <div role="columnheader" className="relative flex min-h-10 items-center px-3">비고{resizeHandle('note')}</div>
                </div>
                {paginatedListOrders.map((order, rowIndex) => {
                  const partner = partners.find(candidate => candidate.id === order.partnerId);
                  const partnerName = order.partnerName || partner?.name || '이름 없음';
                  const partnerAddress = [partner?.address, partner?.addressDetail].filter(Boolean).join(' ');
                  const visibleItemEntries = order.items
                    .map((item, originalIndex) => ({ item, originalIndex }))
                    .filter(({ item }) => !normalizedListSearch || matchesOrderHeaderSearch(order) || matchesItemSearch(order, item));
                  const itemDetails = visibleItemEntries.map(({ item }) => getListItemDetail(order, item));
                  return (
                      <div
                        key={order.id}
                        role="row"
                        style={listGridStyle}
                        /*  **주문과 주문 사이를 진하게 가른다**(2026-09-11 사장님).
                            한 주문이 품목 수만큼 세로로 늘어나는데 줄 경계가 옅어, 어디까지가 한 주문인지
                            눈으로 못 끊었다. 주문 경계만 굵고 진하게 두고 품목 줄은 옅게 둔다. */
                        className={`grid min-h-10 border-b-2 border-slate-400 text-[10px] text-slate-700 transition-colors ${rowIndex % 2 === 0 ? 'bg-white hover:bg-indigo-50/60' : 'bg-slate-50/40 hover:bg-indigo-50/70'}`}
                      >
                        {/*  **주문번호(위) · 상태(아래)** — 주문을 짚어 말할 때 쓰는 번호와
                             지금 어디까지 왔는지를 한 칸에 둔다(2026-09-11 사장님). */}
                        <div role="cell" className="flex flex-col justify-center gap-0.5 border-r border-slate-300 px-2 py-1">
                          {/*  `ORD-` 는 전부 붙는 머리라 읽을 정보가 없다 — 떼고 숫자만 보여 준다
                               (2026-09-11 사장님). 원래 번호는 마우스를 올리면 나온다. */}
                          <span className="truncate font-black tabular-nums text-slate-600" title={cardNoLabel(order) || order.id}>{(cardNoLabel(order) || order.id).replace(/^ORD-/, '')}</span>
                          <span className={`w-fit rounded-md px-1.5 py-0.5 text-[9px] font-black ${statusChip(order.status)}`}>{statusLabel(order.status)}</span>
                        </div>
                        {/*  주문일(위) · 출고예정일(아래) — 출고예정일은 그대로 눌러서 고친다. */}
                        <div role="cell" className="flex flex-col justify-center gap-0.5 border-r border-slate-300 px-1.5 py-1">
                          <span className="px-1.5 font-bold tabular-nums text-slate-500">{fmtYYMMDD(new Date(order.createdAt))}</span>
                          <EditableDeliveryDate
                            label={`${partnerName} 출고예정일`}
                            value={order.deliveryDate}
                            onChange={date => onUpdateDeliveryDate(order.id, new Date(date).toISOString())}
                          />
                        </div>
                        <div role="cell" className="flex items-center border-r border-slate-300 p-1.5">
                          <button
                            type="button"
                            onClick={() => openOrderEditor(order.id)}
                            disabled={embeddedListOnly}
                            className="group flex min-h-8 w-full min-w-0 items-center justify-between gap-1 rounded-md px-1.5 text-left font-black text-slate-800 transition-colors enabled:hover:bg-indigo-50 enabled:hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-default"
                            aria-label={`${partnerName} 주문 수정`}
                          >
                            {/*  출고 방식을 거래처 이름 **앞에** 붙여 한 줄로 읽는다
                                 (2026-09-11 사장님: "거래처에 > 일반 거래처명이게 낫겠다").
                                 두 줄로 쌓으면 줄 높이가 두 배가 되어 한 화면에 덜 들어왔다. */}
                            <span className="flex min-w-0 items-center gap-1.5" title={`${order.source} · ${partnerName}`}>
                              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black ${channelStyle(order.source).chip}`} title={order.source}>{channelStyle(order.source).short}</span>
                              <span className="min-w-0 truncate">{partnerName}</span>
                              {order.status === OrderStatus.DELIVERED && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">예전</span>}
                            </span>
                            {!embeddedListOnly && <Edit2 size={12} className="shrink-0 text-slate-300 group-hover:text-indigo-500" aria-hidden="true" />}
                          </button>
                        </div>
                        {embeddedListOnly && <div role="cell" className="flex min-w-0 items-center border-r border-slate-300 px-3 text-[10px] font-bold text-slate-600">
                          <span className="truncate" title={partnerAddress || '주소 미등록'}>{partnerAddress || '주소 미등록'}</span>
                        </div>}
                        {embeddedListOnly && <div role="cell" className="flex items-center justify-center border-r border-slate-300 px-2">
                          <CompletionStatusControl
                            completed={order.status === OrderStatus.SHIPPED}
                            ariaLabel={`${partnerName} 출고완료 여부`}
                            onChange={onToggleShipmentComplete ? value => {
                              if (!value) {
                                onToggleShipmentComplete(order.id, false);
                                return;
                              }
                              setConfirmModal({
                                message: '해당 거래처를 출고완료 상태로 변경할까요?',
                                subMessage: `${partnerName} · 출고완료일: ${fmtYYMMDD(new Date())}`,
                                confirmText: '변경하기',
                                onConfirm: () => {
                                  onToggleShipmentComplete(order.id, true);
                                  setConfirmModal(null);
                                },
                              });
                            } : undefined}
                            disabled={!onToggleShipmentComplete}
                            title={order.shipmentConfirmedAt ? `${order.shipmentConfirmedBy || '확인자 미기록'} · ${new Date(order.shipmentConfirmedAt).toLocaleString('ko-KR')}` : undefined}
                          />
                        </div>}
                        <div role="cell" className="border-r border-slate-300">
                          <div className="divide-y divide-slate-300">
                            {visibleItemEntries.map(({ item, originalIndex }) => (
                              <div key={`${item.itemId}-${originalIndex}`} className={`flex h-10 items-center justify-center px-2 ${item.checked ? 'bg-slate-50/70' : ''}`}>
                                <CompletionStatusControl
                                  completed={!!item.checked}
                                  disabled={embeddedListOnly}
                                  ariaLabel={`${item.name} 작업 완료 전환`}
                                  onChange={() => toggleListItemCompleted(order, originalIndex)}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                        {showListCompletionColumns && <div role="cell" className="border-r border-slate-300">
                          <div className="divide-y divide-slate-300">
                            {visibleItemEntries.map(({ item, originalIndex }) => (
                              <div key={originalIndex} className={`flex h-10 items-center px-2 text-[10px] font-bold ${item.checked ? 'bg-slate-50/70 text-slate-500' : 'text-slate-300'}`}>
                                {item.checked ? (item.checkedBy || currentUserName || '-') : '-'}
                              </div>
                            ))}
                          </div>
                        </div>}
                        {showListCompletionColumns && <div role="cell" className="border-r border-slate-300">
                          <div className="divide-y divide-slate-300">
                            {visibleItemEntries.map(({ item, originalIndex }) => (
                              <div key={originalIndex} className={`flex h-10 items-center px-2 text-[10px] font-bold tabular-nums ${item.checked ? 'bg-slate-50/70 text-slate-500' : 'text-slate-300'}`}>
                                {item.checkedAt ? fmtYYMMDD(new Date(item.checkedAt)) : '-'}
                              </div>
                            ))}
                          </div>
                        </div>}
                        <div role="cell" className="border-r border-slate-300">
                          <div className="divide-y divide-slate-300">
                            {visibleItemEntries.map(({ item, originalIndex }) => (
                              <div key={`${item.itemId}-${originalIndex}`} className={`flex h-10 min-w-0 items-center px-3 font-bold ${item.checked ? 'bg-slate-50/70 text-slate-400' : ''}`}><span className="truncate" title={item.name}>{item.name}</span></div>
                            ))}
                          </div>
                        </div>
                        {showListDetailColumns ? (
                          <>
                            <div role="cell" className="border-r border-slate-300">
                              <div className="divide-y divide-slate-300">{itemDetails.map((detail, index) => <div key={visibleItemEntries[index].originalIndex} className={`flex h-10 min-w-0 items-center px-2 font-bold ${visibleItemEntries[index].item.checked ? 'bg-slate-50/70 text-slate-400' : ''}`}><span className="truncate" title={detail.manufacturing.join(', ')}>{detail.manufacturing.join(', ') || '-'}</span></div>)}</div>
                            </div>
                            <div role="cell" className="border-r border-slate-300">
                              <div className="divide-y divide-slate-300">{itemDetails.map((detail, index) => <div key={visibleItemEntries[index].originalIndex} className={`flex h-10 min-w-0 items-center px-2 font-bold ${visibleItemEntries[index].item.checked ? 'bg-slate-50/70 text-slate-400' : ''}`}><span className="truncate" title={detail.bottles.join(', ')}>{detail.bottles.join(', ') || '-'}</span></div>)}</div>
                            </div>
                            <div role="cell" className="border-r border-slate-300">
                              <div className="divide-y divide-slate-300">{itemDetails.map((detail, index) => <div key={visibleItemEntries[index].originalIndex} className={`flex h-10 min-w-0 items-center px-2 font-bold ${visibleItemEntries[index].item.checked ? 'bg-slate-50/70 text-slate-400' : ''}`}><span className="truncate" title={detail.caps.join(', ')}>{detail.caps.join(', ') || '-'}</span></div>)}</div>
                            </div>
                            <div role="cell" className="border-r border-slate-300">
                              <div className="divide-y divide-slate-300">{itemDetails.map((detail, index) => <div key={visibleItemEntries[index].originalIndex} className={`flex h-10 min-w-0 items-center px-2 font-bold ${visibleItemEntries[index].item.checked ? 'bg-slate-50/70 text-slate-400' : ''}`}><span className="truncate" title={detail.labels.join(', ')}>{detail.labels.join(', ') || '-'}</span></div>)}</div>
                            </div>
                          </>
                        ) : null}
                        <div role="cell" className="border-r border-slate-300">
                          <div className="divide-y divide-slate-300">
                            {visibleItemEntries.map(({ item, originalIndex }) => (
                              <div key={`${item.itemId}-${originalIndex}`} className={`flex h-10 items-center px-3 font-black tabular-nums ${item.checked ? 'bg-slate-50/70 text-slate-400' : 'text-indigo-600'}`}>
                                {item.isBoxUnit && item.boxQuantity ? `${item.boxQuantity}박스` : `${item.quantity}${items.find(product => product.id === item.itemId)?.unit || '개'}`}
                              </div>
                            ))}
                          </div>
                        </div>
                            <div role="cell" className="border-r border-slate-300">
                              <div className="divide-y divide-slate-300">{visibleItemEntries.map(({ item, originalIndex }) => <div key={originalIndex} className={`flex h-10 min-w-0 items-center gap-1 overflow-hidden px-1.5 font-bold ${item.checked ? 'bg-slate-50/70 text-slate-400' : ''}`}>
                                <div className="relative w-[58px] shrink-0">
                                  <select
                                    value={item.labelType || '대기'}
                                    disabled={embeddedListOnly}
                                    onChange={event => {
                                      const nextItems = [...order.items];
                                      nextItems[originalIndex] = { ...nextItems[originalIndex], labelType: event.target.value as '대기' | '날인' | '부착' };
                                      onUpdateItems?.(order.id, nextItems);
                                    }}
                                    className={`w-full appearance-none !pl-2 !pr-5 ${listInlineSelectClass} disabled:cursor-default disabled:opacity-100 ${(item.labelType || '대기') === '대기' ? '!border-slate-200 !bg-slate-100 !font-bold !text-slate-700 enabled:hover:!bg-slate-200' : 'bg-slate-100 text-slate-700 enabled:hover:bg-slate-200'}`}
                                    aria-label={`${item.name} 라벨 상태`}
                                  >
                                    <option value="대기" className="bg-slate-100 text-slate-700">-</option>
                                    <option value="날인" className="bg-slate-100 text-slate-700">날인</option>
                                    <option value="부착" className="bg-slate-100 text-slate-700">부착</option>
                                  </select>
                                  {!embeddedListOnly && <ChevronDown size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500" />}
                                </div>
                                <div className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-[10px] font-black text-slate-700 transition-colors hover:bg-slate-200 focus-within:ring-1 focus-within:ring-indigo-400">
                                  <input
                                    type="date"
                                    value={item.mfgDate || ''}
                                    disabled={embeddedListOnly}
                                    onChange={event => {
                                      const nextItems = [...order.items];
                                      nextItems[originalIndex] = { ...nextItems[originalIndex], mfgDate: event.target.value };
                                      onUpdateItems?.(order.id, nextItems);
                                    }}
                                    className="peer absolute inset-0 z-10 h-full w-full min-w-0 cursor-pointer opacity-0 disabled:cursor-default"
                                    aria-label={`${item.name} 소비기한 수정용 제조일`}
                                  />
                                  <span className={`pointer-events-none flex h-full min-w-0 items-center gap-1 px-1.5 ${item.mfgDate ? 'text-indigo-600' : 'text-slate-700'}`}>
                                    <CalendarDays size={11} className="shrink-0" aria-hidden="true" />
                                    <span className="min-w-0 truncate tabular-nums">{item.mfgDate ? fmtYYMMDD(expiryFromMfgDate(item.mfgDate)) : '-'}</span>
                                  </span>
                                </div>
                              </div>)}</div>
                            </div>
                            <div role="cell" className="border-r border-slate-300">
                              <div className="divide-y divide-slate-300">{itemDetails.map((detail, index) => <div key={visibleItemEntries[index].originalIndex} className={`flex h-10 min-w-0 items-center px-2 font-bold ${visibleItemEntries[index].item.checked ? 'bg-slate-50/70 text-slate-400' : ''}`}><span className="truncate" title={detail.packaging.join(', ')}>{detail.packaging.join(', ')}</span></div>)}</div>
                            </div>
                        {/*  **출고 방식 한 칸** — 택배면 송장, 아니면 팔레트
                             (2026-09-12 사장님: "출고 방식이 택배인 애들은 팔레트가 안뜨고 송장만
                             뜨고 출고방식 택배가 아닌애들은 팔레트가 뜨게").
                             무엇으로 나가는지는 `shipMethodOf` 하나가 판정한다 — 전에는 이 칸만
                             채널(`source`)로 따로 따져서, 출고 방식을 택배로 바꿔 놔도 송장이 안 떴다.

                             송장은 **양식(A~E) + 세 단계**다. 세 단계는 `-` → 출력 → 부착 → `-`
                             (2026-09-11 사장님: "송장은 - ,출력, 부착 세가지 옵션으로 뜨고") — 부착
                             여부가 여기 들어 있어 그대로 둔다. */}
                        <div role="cell" className="relative flex min-h-full items-center gap-1 border-r border-slate-300 px-1.5 font-bold text-slate-600">
                          {shipMethodOf(order) === '택배' ? (
                          <>
                          <select
                            value={order.invoiceType ?? ''}
                            onChange={event => onUpdateInvoiceType?.(order.id, (event.target.value || undefined) as InvoiceType | undefined)}
                            disabled={!onUpdateInvoiceType}
                            aria-label={`${partnerName} 송장 양식`}
                            title="송장 양식"
                            className="h-7 w-12 shrink-0 cursor-pointer rounded-md border border-slate-200 bg-slate-50 px-1 text-center text-[10px] font-black text-slate-700 outline-none focus:border-slate-400 disabled:cursor-default disabled:text-slate-300"
                          >
                            <option value="">-</option>
                            {INVOICE_TYPES.map(양식 => <option key={양식} value={양식}>{양식}</option>)}
                          </select>
                          {onToggleInvoicePrinted ? (
                            (() => {
                              const 단계 = order.invoiceStage ?? (order.invoicePrinted ? 'printed' : undefined);
                              const 다음: Record<string, 'printed' | 'attached' | undefined> = { undefined: 'printed', printed: 'attached', attached: undefined };
                              const 글자 = 단계 === 'attached' ? '부착' : 단계 === 'printed' ? '출력' : '-';
                              const 색 = 단계 === 'attached' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 단계 === 'printed' ? 'bg-sky-50 text-sky-700 hover:bg-sky-100'
                                : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500';
                              return (
                                <button
                                  type="button"
                                  onClick={() => onToggleInvoicePrinted(order.id, 다음[String(단계)])}
                                  aria-label={`${partnerName} 송장 ${글자}`}
                                  title="눌러서 - → 출력 → 부착"
                                  className={`flex min-h-8 flex-1 items-center justify-center rounded-md px-2 text-[10px] font-black transition-colors ${색}`}
                                >{글자}</button>
                              );
                            })()
                          ) : (
                            <span className="flex-1 text-center text-slate-300">-</span>
                          )}
                          </>
                          ) : (
                          <>
                              <button
                                type="button"
                                onClick={event => { event.stopPropagation(); setListPalletEditorOrderId(current => current === order.id ? null : order.id); }}
                                disabled={embeddedListOnly || !onUpdatePallets || !palletStocks?.some(stock => !stock.hidden)}
                                className="flex min-h-7 w-full min-w-0 items-center justify-between gap-1 rounded-md bg-slate-100 px-2 text-left text-[10px] font-bold text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-default disabled:hover:bg-slate-100"
                                aria-expanded={listPalletEditorOrderId === order.id}
                                aria-label={`${partnerName} 팔레트 수정`}
                              >
                                <span className="truncate" title={getPalletSummary(order).join(', ') || '-'}>{getPalletSummary(order).join(', ') || '-'}</span>
                                {!embeddedListOnly && <ChevronDown size={11} className={`shrink-0 transition-transform ${listPalletEditorOrderId === order.id ? 'rotate-180' : ''}`} />}
                              </button>
                              {listPalletEditorOrderId === order.id && onUpdatePallets && (
                                <div className="absolute right-1 top-[calc(50%+18px)] z-50 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl" onClick={event => event.stopPropagation()}>
                                  <p className="mb-1.5 px-1 text-[10px] font-black text-slate-500">팔레트 수정</p>
                                  <div className="space-y-1.5">
                                    {(palletStocks ?? []).filter(stock => !stock.hidden).map(stock => {
                                      const entry = order.pallets?.find(pallet => pallet.type === stock.id);
                                      const quantity = entry?.quantity ?? 0;
                                      const isExchange = entry?.isExchange ?? false;
                                      const updatePallet = (nextQuantity: number, nextExchange = isExchange) => {
                                        const remaining = (order.pallets ?? []).filter(pallet => pallet.type !== stock.id);
                                        onUpdatePallets(order.id, nextQuantity > 0 ? [...remaining, { type: stock.id, quantity: nextQuantity, ...(nextExchange ? { isExchange: true } : {}) }] : remaining);
                                      };
                                      return (
                                        <div key={stock.id} className="border-b border-slate-100 pb-1.5 last:border-0 last:pb-0">
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="min-w-0 truncate text-[10px] font-bold text-slate-700">{stock.name}</span>
                                            <div className="flex shrink-0 items-center gap-1">
                                              <button type="button" onClick={() => updatePallet(Math.max(0, quantity - 1))} className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-xs font-black text-slate-600 hover:bg-slate-200">−</button>
                                              <span className="w-5 text-center text-[10px] font-black tabular-nums text-slate-800">{quantity}</span>
                                              <button type="button" onClick={() => updatePallet(quantity + 1)} className="flex h-6 w-6 items-center justify-center rounded bg-indigo-50 text-xs font-black text-indigo-600 hover:bg-indigo-100">+</button>
                                            </div>
                                          </div>
                                          <div className="mt-1 flex min-h-7 items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => updatePallet(quantity, !isExchange)}
                                              disabled={quantity <= 0}
                                              className={`inline-flex min-h-7 items-center rounded-md px-2.5 text-[10px] font-black transition-colors disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300 ${isExchange ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-700'}`}
                                            >
                                              {isExchange ? '교환 · 적용됨' : '교환'}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => updatePallet(0, false)}
                                              disabled={quantity <= 0}
                                              className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-[10px] font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                                            >
                                              <RotateCcw size={11} aria-hidden="true" />
                                              초기화
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                          </>
                          )}
                        </div>
                        <div role="cell" className="border-r border-slate-300">
                          <div className="divide-y divide-slate-300">
                            {visibleItemEntries.map(({ item, originalIndex }) => (
                              <button
                                key={originalIndex}
                                type="button"
                                onClick={() => { setListMemoEditor({ orderId: order.id, itemIndex: originalIndex }); setListMemoDraft(item.note || ''); }}
                                className={`flex h-10 w-full min-w-0 items-center px-2 text-left text-[10px] font-bold transition-colors hover:bg-slate-100 ${item.checked ? 'bg-slate-50/70 text-slate-400' : 'text-slate-600'}`}
                              >
                                <span className={item.note ? 'block min-w-0 truncate' : 'inline-flex rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-slate-500'} title={item.note || '메모 추가'}>{item.note || '메모 추가'}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                  );
                })}
                {listOrders.length === 0 && (
                  <div className="flex min-h-40 flex-col items-center justify-center text-slate-400">
                    <Inbox size={36} />
                    <p className="mt-2 text-xs font-bold">주문이 없습니다</p>
                  </div>
                )}
              </div>
              </div>
              {listPageCount > 1 && (
                <nav className="flex items-center justify-center gap-2 pt-3" aria-label="주문 목록 페이지">
                  <button
                    type="button"
                    onClick={() => setListPage(page => Math.max(1, page - 1))}
                    disabled={currentListPage === 1}
                    className="flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    이전
                  </button>
                  <span className="min-w-16 text-center text-[11px] font-bold tabular-nums text-slate-500">
                    <strong className="text-indigo-600">{currentListPage}</strong> / {listPageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setListPage(page => Math.min(listPageCount, page + 1))}
                    disabled={currentListPage === listPageCount}
                    className="flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    다음
                  </button>
                </nav>
              )}
              </section>
            </div>
          );
        };

        return (
          /* 작업순서(위) → 칸반(아래). 전엔 작업순서가 왼쪽 240px를 상시 차지해 칸반이 그만큼 좁았다.
             컬럼이 5개로 늘어난 뒤로는 그 240px가 컬럼 하나에 해당해서 위아래로 나눴다.
             대신 항목을 가로로 흘려야 상단이 세로로 길어지지 않는다. */
          <div className="flex flex-col gap-5 pb-4">
            <section className="hidden" aria-labelledby="active-query-title">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                <CalendarDays size={15} className="text-indigo-600" aria-hidden="true" />
                <h3 id="active-query-title" className="text-xs font-black text-slate-800">검색 조건</h3>
                <span className="text-[10px] font-bold text-slate-400">주문일 기준</span>
              </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
              <span className="text-[11px] font-black text-slate-500">주문일</span>
              <input type="date" value={activeDateFrom} max={activeDateTo || undefined} onChange={event => setActiveDateFrom(event.target.value)} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-400" aria-label="주문일 시작" />
              <span className="text-xs text-slate-400">~</span>
              <input type="date" value={activeDateTo} min={activeDateFrom || undefined} onChange={event => setActiveDateTo(event.target.value)} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-400" aria-label="주문일 종료" />
              <div className="flex h-8 items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                <button type="button" onClick={() => { const today = seoulDateInput(); setActiveDateFrom(today); setActiveDateTo(today); }} className={`h-full border-r border-slate-200 px-2.5 text-[11px] ${activeDateFrom === seoulDateInput() && activeDateTo === seoulDateInput() ? 'bg-slate-900 font-black text-white' : 'font-bold text-slate-600 hover:bg-slate-50'}`}>오늘</button>
                <button type="button" onClick={() => { const today = seoulDateInput(); setActiveDateFrom(seoulWeekStart()); setActiveDateTo(today); }} className={`h-full border-r border-slate-200 px-2.5 text-[11px] ${activeDateFrom === seoulWeekStart() && activeDateTo === seoulDateInput() ? 'bg-slate-900 font-black text-white' : 'font-bold text-slate-600 hover:bg-slate-50'}`}>이번 주</button>
                <button type="button" onClick={() => { const today = seoulDateInput(); setActiveDateFrom(`${today.slice(0, 7)}-01`); setActiveDateTo(today); }} className={`h-full px-2.5 text-[11px] ${activeDateFrom === `${seoulDateInput().slice(0, 7)}-01` && activeDateTo === seoulDateInput() ? 'bg-slate-900 font-black text-white' : 'font-bold text-slate-600 hover:bg-slate-50'}`}>이번 달</button>
              </div>
              <span className="text-[11px] font-bold text-slate-500">{activeOperationOrders.length}건</span>
            </div>
            </section>
            {/*  **금일 작업순서 — 금일 배송순서와 같은 자리에 둔다**(2026-09-11 사장님:
                 "금일작업순서도 금일배송순서랑 같은 위치에 두고 배송캘린더 일때는 배송순서만
                 보이고 나머지에서는 작업순서만 보이게").

                 배송순서는 배송 캘린더(`calendarSlot`) 안에서 본문 맨 위에 뜬다. 그래서 이쪽도
                 `order-3` 으로 내려 **검색 아래·본문 위**에 세운다 — 둘이 같은 자리에서 갈아 끼워진다.
                 캘린더 탭에서는 배송순서가 그 자리를 쓰므로 이건 감춘다. */}
            <div className={`order-3 w-full flex-col rounded-3xl border border-slate-200 bg-white shadow-sm ${embeddedListOnly || activeView === 'calendar' || activeView === 'history' ? 'hidden' : 'flex'}`}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <button className="flex min-h-11 items-center gap-2 text-left" onClick={() => toggleMobileCollapse('work-order')} aria-expanded={!mobileCollapsed.has('work-order')}>
                  <div className="rounded-xl bg-indigo-600 p-1.5 text-white"><ListOrdered size={16} /></div>
                  <h3 className="text-sm font-black text-slate-900"><span className="tabular-nums">{seoulToday()}</span> 금일 작업순서</h3>
                  <ChevronDown size={14} className={`text-slate-400 transition-transform ${mobileCollapsed.has('work-order') ? '' : 'rotate-180'}`} />
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  {/*  **주문 끌어오기** — 작업순서에 어떤 품목을 세울지 고른다.
                       창(`작업순서 설정`)은 살아 있었는데 **여는 단추가 통째로 없어져** 못 들어갔다
                       (2026-09-11 사장님). 여는 순간 `pickerOrdering` 에 **지금 목록을 채워 넣는다** —
                       이게 빠져 있어서 이미 담긴 것들이 체크가 안 된 채로 떴다. */}
                  <button
                    type="button"
                    onClick={() => {
                      setPickerOrdering(validWorkItems.map(workItem => workItem.key));
                      setPickerAssign(Object.fromEntries(validWorkItems.map(workItem => [workItem.key, workCategoryOf(workItem)])));
                      setPickerGroups(workGroups);
                      setPickerGroup(workGroups[0] ?? '');
                      setShowWorkOrderPicker(true);
                    }}
                    className="flex min-h-8 items-center gap-1 rounded-lg bg-violet-50 px-2.5 text-[11px] font-black text-violet-600 transition-colors hover:bg-violet-100"
                  ><Plus size={12} aria-hidden="true" />주문보기</button>
                  {/*  **건수와 '완료 포함' 은 늘 한 줄이다**(2026-09-12 사장님: "대기중 오른쪽에
                       ㅁ 완료 포함이 한줄로 오게"). 따로 놔두면 폭이 좁아질 때 체크만 아랫줄로
                       떨어져 무엇에 걸린 체크인지 안 읽힌다. 묶어 두면 둘이 같이 내려간다. */}
                  {/*  **주문 상태가 아니라 '할 일이 몇 줄 남았나' 를 센다**(2026-09-12 사장님:
                       "대기중 n건 작업중 n건이 아니라 작업 미완료 n건 작업 완료 n건으로").
                       이 판은 줄 단위로 보는 자리라 주문 상태보다 줄 수가 맞는 셈이다.
                       다 한 줄은 차례에서 빠지고, **'작업 완료 n건' 을 눌러야** 뒤에 붙어 보인다. */}
                  {/*  **생긴 것은 전과 똑같다**(2026-09-12 사장님: "생긴건 전이랑 똑같이 해
                       괜히 바탕색 넣고 색 바꾸지말고"). 전에 쓰던 한 문장 그대로 두고,
                       **완료 쪽만 눌리게** 했다 — 누르면 다 한 줄이 뒤에 붙는다.
                       켜진 것은 밑줄로만 알린다. 바탕색을 깔면 머리줄에 없던 덩어리가 생긴다. */}
                  <p className="flex flex-nowrap items-center whitespace-nowrap text-xs font-bold text-slate-500">
                    작업 미완료 <strong className="ml-1 font-black text-rose-600">{미완료줄수}건</strong>
                    <span className="mx-1.5 text-slate-300">·</span>
                    <button
                      type="button"
                      onClick={() => setShowCompletedWorkItems(현재 => !현재)}
                      aria-pressed={showCompletedWorkItems}
                      className={`transition-opacity hover:opacity-70 ${showCompletedWorkItems ? 'underline underline-offset-4' : ''}`}
                    >작업 완료 <strong className="font-black text-emerald-600">{완료줄수}건</strong></button>
                  </p>
                </div>
              </div>
              <div className={`flex flex-col gap-3 p-2 ${mobileCollapsed.has('work-order') ? 'hidden' : ''}`}>
                {validWorkItems.length === 0 ? (
                  <div className="flex items-center justify-center py-6">
                    <p className="text-xs font-bold text-slate-400">현재 조회 조건에 해당하는 작업이 없습니다.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2">
                      <span className="px-1 text-[11px] font-black text-slate-500">정렬 방식</span>
                      <div className="flex rounded-lg border border-slate-200 bg-white p-0.5" aria-label="작업순서 정렬 방식">
                        <button type="button" onClick={() => setWorkSort('dueDate')} aria-pressed={workSort === 'dueDate'} className={`min-h-8 rounded-md px-2.5 text-[11px] font-black transition-colors ${workSort === 'dueDate' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>추천 순서 적용</button>
                        <button type="button" onClick={() => setWorkSort(null)} aria-pressed={workSort === null} className={`min-h-8 rounded-md px-2.5 text-[11px] font-black transition-colors ${workSort === null ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>직접 정렬</button>
                      </div>
                      <span className="text-[10px] font-bold text-slate-500">{workSort === 'dueDate' ? '작업중 → 출고예정일 임박 순 → 주문일 빠른 순' : '같은 품목 카테고리 안에서 이동 핸들을 끌어 정렬'}</span>
                    </div>
                    {/* 모든 화면에서 한 카테고리만 보여 주문 조회 영역이 지나치게 밀리지 않게 한다. */}
                    {(() => {
                      // 같은 거래처는 떨어져 있어도 한 줄로 합친다 —
                      // 이웃한 것만 묶으면 저장된 순서가 섞여 있을 때 같은 거래처가 위아래로 쪼개져 두 번 나온다.
                      return (
                        <div>
                          <div className="min-w-0">
                            <div className="mb-2 flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white px-1" role="tablist" aria-label="품목 카테고리">
                              {workCategories.map(category => (
                                <button key={category} id={`work-tab-${category}`} type="button" role="tab" aria-controls="work-category-panel" tabIndex={activeMobileWorkCategory === category ? 0 : -1} aria-selected={activeMobileWorkCategory === category} onClick={() => setMobileWorkCategory(category)}
                                  onKeyDown={event => {
                                    const index = workCategories.indexOf(category);
                                    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % workCategories.length
                                      : event.key === 'ArrowLeft' ? (index - 1 + workCategories.length) % workCategories.length
                                      : event.key === 'Home' ? 0 : event.key === 'End' ? workCategories.length - 1 : -1;
                                    if (nextIndex < 0) return;
                                    event.preventDefault();
                                    const nextCategory = workCategories[nextIndex];
                                    setMobileWorkCategory(nextCategory);
                                    document.getElementById(`work-tab-${nextCategory}`)?.focus();
                                  }}
                                  className={`flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-xs font-black transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${activeMobileWorkCategory === category ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>
                                  <span>{category}</span>
                                  <span className={`text-[9px] tabular-nums ${activeMobileWorkCategory === category ? 'text-indigo-500' : 'text-slate-400'}`}>
                                    {validWorkItems.filter(workItem => workCategoryOf(workItem) === category).length}
                                  </span>
                                </button>
                              ))}
                            </div>
                            {activeMobileWorkCategory && <div id="work-category-panel" role="tabpanel" aria-labelledby={`work-tab-${activeMobileWorkCategory}`} tabIndex={0}>{renderWorkCategory(activeMobileWorkCategory)}</div>}
                            {workGroupPick.length >= 2 && (
                              <button onClick={confirmWorkGroup}
                                className="mt-2 w-full rounded-xl bg-indigo-600 py-2 text-[10px] font-black text-white transition-colors hover:bg-indigo-700">
                                고른 {workGroupPick.length}건 같이 만들 것으로 묶기
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
            {/*  주문 생성은 금일 작업순서 바로 밑에 둔다 — 같은 `order-3` 이고 DOM 에서 패널 다음이다.
                 캘린더·이력에서는 패널이 숨어도 단추는 남는다(주문은 어느 화면에서나 만든다). */}
            {/*  주문 생성은 **보드·리스트에만**(2026-09-11 사장님) — 배송 캘린더는 일정 보는 자리고
                 이력은 지나간 것을 보는 자리라, 거기서 새 주문을 만들 일이 없다. */}
            {!embeddedListOnly && (activeView === 'kanban' || activeView === 'list') && (
              <div className="order-3 flex flex-wrap items-center justify-end gap-2">
                <button onClick={onAddClick} className="flex h-9 items-center gap-1.5 rounded-md bg-indigo-600 px-4 text-xs font-black text-white transition-colors hover:bg-indigo-700">
                  <Plus size={13} /><span>주문 생성</span>
                </button>
              </div>
            )}
            {!embeddedListOnly && <div className="order-2">{renderOrderManagementControls()}</div>}
            {activeView === 'calendar' && (
              <div className="order-4">
                {calendarSlot?.(listSort) ?? (
                  <CalendarView
                    orders={activeViewOrders}
                    onUpdateDeliveryDate={onUpdateDeliveryDate}
                    onOrderClick={openOrderEditor}
                  />
                )}
              </div>
            )}
            {/* 상태별 칸반 컬럼 — 이제 화면 전체 폭을 쓴다 */}
            {activeView === 'kanban' ? (
              <section className="order-4" aria-label="상태별 주문 보드">
                <div className="md:overflow-x-auto no-scrollbar">
                  <div className="flex flex-col md:flex-row md:min-w-max gap-4 pb-4">
                    {visibleActiveConfigs.map(col => renderCol(col))}
                    {legacyHistoryEnabled && listStatusTab === 'all' && renderCol(historyConfig)}
                  </div>
                </div>
              </section>
            ) : activeView === 'list' ? renderListTable() : null}

            {/*  **그룹 편집 창**(2026-09-14 사장님) — 추가·이름바꾸기·지우기를 여기 모은다.
                 작업순서 설정 창 **위에** 뜬다(z-[60]). 칩에서 손대던 일이 다 여기로 왔다. */}
            {그룹편집 && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => set그룹편집(false)}>
                <div className="flex max-h-[70vh] w-full max-w-sm flex-col rounded-3xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <h3 className="font-black text-slate-900">그룹 편집</h3>
                    <button onClick={() => set그룹편집(false)} aria-label="닫기" className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={16} /></button>
                  </div>

                  {/*  새 그룹 — 창 맨 위다. 들어오자마자 하는 일이 보통 '추가'다. */}
                  <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
                    <input
                      value={새그룹이름}
                      onChange={e => set새그룹이름(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); 그룹추가(); } }}
                      placeholder="새 그룹 이름"
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400"
                    />
                    <button type="button" onClick={그룹추가} disabled={!새그룹이름.trim()}
                      className="flex min-h-9 shrink-0 items-center gap-1 rounded-lg bg-violet-600 px-3 text-xs font-black text-white transition-colors hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400">
                      <Plus size={12} />추가
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {pickerGroups.length === 0 ? (
                      <p className="py-10 text-center text-xs font-bold text-slate-400">그룹이 없습니다.</p>
                    ) : pickerGroups.map(name => {
                      const 담긴수 = pickerOrdering.filter(k => pickerAssign[k] === name).length;
                      return (
                        <div key={name} className="flex items-center gap-2 border-b border-slate-50 px-5 py-3 last:border-0">
                          <span className={`h-3 w-3 shrink-0 rounded-full ${그룹색(pickerGroups, name).번호}`} />
                          <span className="min-w-0 flex-1 truncate text-sm font-black text-slate-700">{name}</span>
                          <span className="shrink-0 text-[10px] font-bold text-slate-400 tabular-nums">{담긴수}건</span>
                          <button type="button" aria-label={`${name} 이름 바꾸기`} onClick={() => 그룹이름바꾸기(name)}
                            className="shrink-0 rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-violet-50 hover:text-violet-600"><Edit2 size={14} /></button>
                          <button type="button" aria-label={`${name} 지우기`} onClick={() => 그룹지우기(name, 담긴수)}
                            className="shrink-0 rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-600"><X size={14} /></button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t border-slate-100 p-4">
                    <button type="button" onClick={() => set그룹편집(false)}
                      className="w-full rounded-2xl bg-slate-100 py-3 text-sm font-black text-slate-600 transition-colors hover:bg-slate-200">닫기</button>
                  </div>
                </div>
              </div>
            )}

            {/* 작업순서 설정 모달 */}
            {showWorkOrderPicker && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowWorkOrderPicker(false)}>
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[75vh] animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <h3 className="font-black text-slate-900">작업순서 설정</h3>
                    <button onClick={() => setShowWorkOrderPicker(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"><X size={16} /></button>
                  </div>

                  {/*  **그룹 줄** — 고른 그룹에 주문이 담긴다. 이름 고치기·지우기·새로 만들기가 여기 있다. */}
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-5 py-3">
                    {pickerGroups.map(name => {
                      const 고름 = pickerGroup === name;
                      const 담긴수 = pickerOrdering.filter(k => pickerAssign[k] === name).length;
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => setPickerGroup(name)}
                          className={`flex min-h-7 items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-black transition-all ${그룹색(pickerGroups, name).칩} ${고름 ? 'ring-2 ring-slate-400' : 'opacity-55'}`}
                        >
                          {name} <span className="tabular-nums opacity-60">{담긴수}</span>
                        </button>
                      );
                    })}
                    {/*  **칩에는 고르기만 남긴다**(2026-09-14 사장님: "그룹안에 수정이랑 삭제버튼
                         넣지말고 그룹추가>그룹편집 으로 바꾸고 모달로 띄워서 안에서 추가랑,
                         수정, 삭제 할 수 있게"). 좁은 칩에 단추 셋이 붙어 있어 고르려다 이름이
                         바뀌거나 그룹이 지워졌다. 손대는 일은 편집 창에 모은다. */}
                    <button
                      type="button"
                      onClick={() => set그룹편집(true)}
                      className="flex min-h-7 items-center gap-1 rounded-xl bg-violet-50 px-2.5 text-[11px] font-black text-violet-600 hover:bg-violet-100"
                    ><Settings2 size={11} />그룹 편집</button>
                  </div>

                  {/*  **`min-h-0` 가 있어야 스크롤이 먹는다**(2026-09-12 사장님: "스크롤이 안되는건지").
                       flex 칸은 기본 최소 높이가 '내용만큼'이라, 이게 없으면 목록이 상자를 밀고
                       늘어나 버려 넘칠 일이 없어진다 — 그래서 스크롤이 안 생겼다. */}
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {allPickableItems.length === 0 ? (
                      <p className="text-center text-sm text-slate-400 py-12">대기중/작업중 주문이 없습니다.</p>
                    ) : pickableOrders.map(o => {
                      const partnerName = o.partnerName || partners.find(c => c.id === o.partnerId)?.name || '이름없음';
                      /*  **그룹끼리 모은다**(2026-09-12 사장님: "왜 그룹별로 안 보이고 같이 보이냐").
                          한 거래처 줄이 기름·미분류·기름·깨 로 섞여 있어 어느 그룹에 무엇이
                          담겼는지 한 줄씩 읽어야 했다. 그룹 차례(`pickerGroups`)대로 세우고,
                          아직 안 담긴 것은 맨 뒤로 보낸다 — 담긴 것부터 보는 게 맞다. */
                      const 그룹자리 = (key: string) => {
                        const 그룹 = pickerAssign[key];
                        const 자리 = 그룹 ? pickerGroups.indexOf(그룹) : -1;
                        return 자리 < 0 ? pickerGroups.length : 자리;
                      };
                      const orderItems = allPickableItems
                        .filter(wi => wi.orderId === o.id)
                        .sort((a, b) => 그룹자리(a.key) - 그룹자리(b.key));
                      return (
                        <div key={o.id} className="px-5 py-3 border-b border-slate-50">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-bold text-slate-700">{partnerName}</span>
                            <Badge variant={o.status === OrderStatus.PROCESSING ? 'info' : 'progress'}>
                              {o.status === OrderStatus.PROCESSING ? '작업중' : '대기중'}
                            </Badge>
                          </div>
                          <div className="space-y-1">
                            {orderItems.map(wi => {
                              const isSelected = pickerOrdering.includes(wi.key);
                              const 담긴그룹 = pickerAssign[wi.key];
                              //  **번호는 그 그룹 안에서만 센다**(사장님: "그 그룹내에서만 순서 따로").
                              const sectionPos = pickerOrdering.filter(k => pickerAssign[k] === 담긴그룹).indexOf(wi.key) + 1;
                              return (
                                <div key={wi.key}
                                  onClick={() => {
                                    if (!pickerGroup) { alert('먼저 담을 그룹을 고르세요.'); return; }
                                    if (isSelected && 담긴그룹 === pickerGroup) {
                                      //  같은 그룹에 담긴 것을 다시 누르면 뺀다.
                                      setPickerOrdering(prev => prev.filter(k => k !== wi.key));
                                      setPickerAssign(prev => { const { [wi.key]: _뺌, ...남은 } = prev; return 남은; });
                                      return;
                                    }
                                    //  안 담겼거나 **다른 그룹**에 담긴 것이면 지금 그룹으로 옮긴다(끝에 붙는다).
                                    setPickerOrdering(prev => [...prev.filter(k => k !== wi.key), wi.key]);
                                    setPickerAssign(prev => ({ ...prev, [wi.key]: pickerGroup }));
                                  }}
                                  className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors ${isSelected ? 그룹색(pickerGroups, 담긴그룹).줄 : 'hover:bg-slate-50'}`}
                                >
                                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 text-[10px] font-black transition-all ${isSelected ? `${그룹색(pickerGroups, 담긴그룹).번호} text-white` : 'border-slate-300 text-transparent'}`}>
                                    {isSelected ? sectionPos : ''}
                                  </div>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-bold text-slate-700">{wi.itemName}</span>
                                    {isSelected && 담긴그룹 && <span className={`text-[10px] font-black ${그룹색(pickerGroups, 담긴그룹).글자}`}>{담긴그룹}</span>}
                                  </span>
                                  <span className="text-[10px] font-black text-slate-400 shrink-0">{wi.qty}{items.find(p => p.id === wi.itemId)?.unit || '개'}</span>
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
                        //  **그룹 차례대로 줄을 늘어놓는다** — 저장되는 순번(sortIndex)이 곧 화면 차례라,
                        //  섞어 저장하면 칸 안의 순서가 흔들린다.
                        const newItems = pickerGroups.flatMap(group => pickerOrdering
                          .filter(key => pickerAssign[key] === group)
                          .map(key => allPickableItems.find(wi => wi.key === key))
                          .filter((wi): wi is WorkItem => wi !== undefined)
                          .map(wi => ({ ...wi, workGroup: group })));
                        saveWorkGroups(pickerGroups);
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

      {/* ── 이력 탭: 예전 주문. 한 건 = 한 행, 완료일 최신순 ── */}
      {activeView === 'history' && (() => {
        const col = historyConfig;
        /*  **이력도 위의 검색조건을 그대로 쓴다**(2026-09-11 사장님: "이력 자체에 붙어있던
            날짜 필터링은 제거하고 상단에 있는 검색조건을 함께 쓸거야").
            거래처 검색은 `searchTerm`(전체 검색)이 이미 `filteredOrders` 에서 걸러 주고,
            기간은 여기서 `activeDateFrom~activeDateTo` 로 본다.
            **기간의 기준은 완료일**이다 — 이력에서 찾는 건 "언제 나갔나"지 "언제 주문했나"가 아니다. */
        const allColOrders = filteredOrders.filter(o => col.statusFilter.includes(o.status)).filter(거래처걸림).sort(byDeliveryThenId);
        const 완료일 = (o: Order) => dateOfLocal(o.deliveredAt || o.deliveryDate || o.createdAt);
        const filteredHistoryBase = allColOrders.filter(o => {
          const dateStr = 완료일(o);
          if (activeDateFrom && dateStr < activeDateFrom) return false;
          if (activeDateTo && dateStr > activeDateTo) return false;
          return true;
        });
        /*  이력도 **같은 정렬 고르개**를 쓴다(2026-09-11 사장님). 다만 아무것도 안 고른
            기본값(출고예정일 임박 순)일 때는 이력답게 **완료일 최신순**으로 둔다 —
            지나간 것을 볼 때 제일 최근이 위로 오는 게 맞다. */
        const 이력정렬 = listSort === 'delivery'
          ? [...filteredHistoryBase].sort((a, b) => {
              const da = a.deliveredAt || a.deliveryDate || a.createdAt || '';
              const db = b.deliveredAt || b.deliveryDate || b.createdAt || '';
              //  같으면 주문번호로 갈라 순서가 흔들리지 않게 한다.
              return db.localeCompare(da) || (b.id || '').localeCompare(a.id || '');
            })
          : 정렬(filteredHistoryBase);
        const filteredHistoryOrders = 이력정렬;
        const hasHistoryFilter = !!(searchTerm || activeDateFrom || activeDateTo);
        //  **한 쪽에 15줄**(2026-09-11 사장님: "주문 이력 한페이지에 15개만 보여주고 나머진 페이지로 넘겨라").
        //  전에는 5줄만 보이고 '더 보기'로 통째로 펴는 방식이라, 많이 쌓이면 한없이 길어졌다.
        const HISTORY_PAGE_SIZE = 15;
        const historyPageCount = Math.max(1, Math.ceil(filteredHistoryOrders.length / HISTORY_PAGE_SIZE));
        const currentHistoryPage = Math.min(historyPage, historyPageCount);
        const colOrders = filteredHistoryOrders.slice((currentHistoryPage - 1) * HISTORY_PAGE_SIZE, currentHistoryPage * HISTORY_PAGE_SIZE);
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
                <h3 className={`font-black text-base ${col.textColor}`}>{col.label} ({filteredHistoryOrders.length}건)</h3>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[850px]">
                <div className="grid grid-cols-[150px_240px_110px_110px_90px_90px_100px] border-b-2 border-slate-400 bg-slate-100 text-[11px] font-black text-slate-600">
                  {['거래처', '주문 품목', '주문 수량', '확인자', '주문일', '출고예정일', '완료일'].map(label => <div key={label} className="flex h-10 items-center border-r border-slate-300 px-3 last:border-r-0">{label}</div>)}
                </div>
                {colOrders.map((order, rowIndex) => {
                  const partnerName = order.partnerName || partners.find(partner => partner.id === order.partnerId)?.name || '이름 없음';
                  return (
                    <div key={order.id} className={`grid grid-cols-[150px_240px_110px_110px_90px_90px_100px] border-b border-slate-300 text-xs text-slate-700 ${rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}>
                      <div className="flex items-center border-r border-slate-300 px-3 font-black">{partnerName}</div>
                      <div className="divide-y divide-slate-300 border-r border-slate-300">{order.items.map((item, index) => <div key={index} className="flex h-10 min-w-0 items-center px-3 font-bold"><span className="truncate" title={item.name}>{item.name}</span></div>)}</div>
                      <div className="divide-y divide-slate-300 border-r border-slate-300">{order.items.map((item, index) => <div key={index} className="flex h-10 items-center px-3 font-black text-indigo-600">{item.isBoxUnit && item.boxQuantity ? `${item.boxQuantity}박스` : `${item.quantity}${items.find(product => product.id === item.itemId)?.unit || '개'}`}</div>)}</div>
                      <div className="divide-y divide-slate-300 border-r border-slate-300">{order.items.map((item, index) => <div key={index} className="flex h-10 items-center px-3 text-[10px] font-bold">{item.checkedBy || '-'}</div>)}</div>
                      <div className="flex items-center border-r border-slate-300 px-3 text-[10px] font-bold tabular-nums">{fmtYYMMDD(new Date(order.createdAt))}</div>
                      <div className="flex items-center border-r border-slate-300 px-3 text-[10px] font-black tabular-nums text-indigo-600">{fmtYYMMDD(new Date(order.deliveryDate))}</div>
                      <div className="flex items-center px-3 text-[10px] font-bold tabular-nums">{order.deliveredAt ? fmtYYMMDD(new Date(order.deliveredAt)) : '-'}</div>
                    </div>
                  );
                })}
              </div>
              {colOrders.length === 0 && <div className="flex flex-col items-center justify-center py-20 opacity-20"><Inbox size={48} /><p className="text-xs font-bold mt-2">주문이 없습니다</p></div>}
              {historyPageCount > 1 && (
                <nav className="flex items-center justify-center gap-2 py-3" aria-label="주문 이력 페이지">
                  <button
                    type="button"
                    onClick={() => setHistoryPage(page => Math.max(1, page - 1))}
                    disabled={currentHistoryPage === 1}
                    className="flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >이전</button>
                  <span className="min-w-16 text-center text-[11px] font-bold tabular-nums text-slate-500">
                    <strong className="text-indigo-600">{currentHistoryPage}</strong> / {historyPageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setHistoryPage(page => Math.min(historyPageCount, page + 1))}
                    disabled={currentHistoryPage === historyPageCount}
                    className="flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >다음</button>
                </nav>
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
                  <Badge variant={order.status === OrderStatus.PROCESSING ? 'info' : 'progress'}>
                    {order.status === OrderStatus.PROCESSING ? '작업중' : '대기중'}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => openOrderEditor(order.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black text-indigo-600 hover:bg-indigo-50" aria-label={`${partnerName} 주문 수정`}><Edit2 size={14} aria-hidden="true" />수정</button>
                  <button onClick={() => setPreviewOrderId(null)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400" aria-label="상세 닫기">
                    <X size={16} />
                  </button>
                </div>
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
                  onToggleInvoicePrinted={onToggleInvoicePrinted}
                  onUpdateInvoiceType={onUpdateInvoiceType}
                  onToggleItemChecked={followItemToggle}
                  onDeleteOrder={onDeleteOrder}
                  readOnly
                />
              </div>
            </div>
          </div>
        );
      })()}
      {listOrderEditor && (() => {
        const editorOrder = orders.find(order => order.id === listOrderEditor.orderId);
        if (!editorOrder) return null;
        const partnerName = editorOrder.partnerName || partners.find(partner => partner.id === editorOrder.partnerId)?.name || '이름 없음';
        /*  **그 거래처에 연결된 품목만 고르게 한다**(2026-09-11 사장님: "품목명 눌러서 나오는
            드롭다운은 거래처에 연결된 품목만 나오게 바꿔"). 전 품목을 다 띄우면 목록이 500줄이 넘고,
            그 거래처가 안 사는 것까지 섞여 엉뚱한 품목이 주문에 들어간다.
            판정은 `isLinkedToPartner` 한 곳이 한다(주문 추가 화면과 같은 근거).

            **지금 이 주문에 들어 있는 품목은 연결이 없어도 남긴다** — 안 그러면 그 줄의
            드롭다운이 빈칸으로 보이고, 수량만 고치려다 품목이 바뀌어 버린다. */
        const 이미담긴 = new Set(listOrderEditor.items.map(orderItem => orderItem.itemId));
        const orderableItems = items
          .filter(item => !item.archived && !['raw', 'submaterial', 'shipping', 'box', 'tape', 'container', 'cap', 'label'].includes(item.type))
          .filter(item => 이미담긴.has(item.id) || isLinkedToPartner(partnerItems, editorOrder.partnerId ?? '', item.id))
          .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        const updateDraftItem = (index: number, patch: Partial<OrderItem>) => {
          setListOrderEditor(current => current && current.orderId === editorOrder.id
            ? { ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }
            : current);
        };
        const closeEditor = () => setListOrderEditor(null);
        const saveEditor = () => {
          if (!listOrderEditor.deliveryDate || listOrderEditor.items.length === 0 || listOrderEditor.items.some(item => !item.itemId)) return;
          if (listOrderEditor.deliveryDate !== editorOrder.deliveryDate.split('T')[0]) {
            onUpdateDeliveryDate(editorOrder.id, new Date(listOrderEditor.deliveryDate).toISOString());
          }
          onUpdateItems?.(editorOrder.id, listOrderEditor.items);
          closeEditor();
        };
        const addDraftItem = () => setListOrderEditor(current => current && current.orderId === editorOrder.id
          ? { ...current, items: [...current.items, { itemId: '', name: '', quantity: 1, price: 0 }] }
          : current);
        const saveDisabled = !listOrderEditor.deliveryDate || listOrderEditor.items.length === 0 || listOrderEditor.items.some(item => !item.itemId);
        return (
          <OrderEditModalShell title="거래처 주문 수정" partnerName={partnerName} context={`주문일 ${fmtYYMMDD(new Date(editorOrder.createdAt))}`} onClose={closeEditor} onSave={saveEditor} saveDisabled={saveDisabled}>
            <div className="space-y-4">
              <section aria-labelledby="order-schedule-heading">
                <h4 id="order-schedule-heading" className="mb-1.5 text-xs font-black text-slate-700">출고 일정</h4>
                <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                  <div className="min-w-0 flex-1">
                    <label className="block text-[11px] font-bold leading-4 text-slate-600" htmlFor="order-editor-delivery-date">출고예정일</label>
                    <input id="order-editor-delivery-date" type="date" value={listOrderEditor.deliveryDate} onChange={event => setListOrderEditor(current => current ? { ...current, deliveryDate: event.target.value } : current)} className="mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm font-bold tabular-nums text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                  </div>
                  {/*  **오전·오후**(2026-09-12 사장님: "출고예정일 우측에 오전 오후 설정하는것도 둬
                       미정이면 그냥 -로 뜨게 하고"). 금일 배송순서가 보는 것과 **같은 문서**다 —
                       여기서 정하면 거기 줄도 같이 옮겨 간다. 누르는 즉시 저장된다(품목과 달리
                       '변경 저장'을 안 기다린다) — 배송 화면이 곧바로 이 값을 쓰기 때문이다. */}
                  <label className="shrink-0">
                    <span className="block text-[11px] font-bold leading-4 text-slate-600">배송 시간</span>
                    <select
                      value={deliveryTimeSlots[editorOrder.id] ?? ''}
                      onChange={event => saveDeliveryTimeSlot(editorOrder.id, (event.target.value || null) as DeliveryTimeSlot | null)}
                      aria-label="배송 시간"
                      className="mt-1 h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    >
                      <option value="">-</option>
                      <option value="오전">오전</option>
                      <option value="오후">오후</option>
                    </select>
                  </label>
                </div>
              </section>

              <section aria-labelledby="order-items-heading">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h4 id="order-items-heading" className="text-xs font-black text-slate-700">주문 품목</h4>
                  <span className="text-[11px] font-bold text-slate-500">{listOrderEditor.items.length}개</span>
                </div>
                <div className="mb-2 hidden grid-cols-[minmax(0,1fr)_112px] gap-2 px-2 text-[10px] font-black text-slate-500 sm:grid">
                  <span>품목명</span><span>주문 수량</span>
                </div>
                <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {listOrderEditor.items.map((orderItem, index) => (
                    /*  **한 줄이 두 칸이다**(2026-09-12 사장님: "이름 잘리는게 아쉽고 품목명 수량
                        밑에 줄에 작업완료 여부 라벨상태 소비기한 뜨게 하고").
                        윗칸은 품목명·수량만 둔다 — 지우개를 아랫줄로 내린 만큼 이름이 길어진다.
                        아랫칸은 작업완료·라벨·소비기한, 그리고 맨 오른쪽에 지우개다. */
                    <div key={`${orderItem.itemId}-${index}`} className="space-y-2 p-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_96px] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_112px] sm:items-center">
                      <label className="min-w-0 text-[10px] font-black text-slate-500 sm:contents"><span className="mb-1 block sm:hidden">품목명</span>
                      <select
                        value={orderItem.itemId}
                        onChange={event => {
                          const selected = items.find(item => item.id === event.target.value);
                          if (selected) updateDraftItem(index, { itemId: selected.id, name: selected.name, price: partnerItems?.find(link => link.Direction === 'out' && link.partnerId === editorOrder.partnerId && link.itemId === selected.id)?.price || 0, isBoxUnit: false, boxQuantity: undefined, unitsPerBox: undefined });
                        }}
                        className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        aria-label={`${index + 1}번째 주문 품목`}
                      >
                        {!orderItem.itemId && <option value="">품목을 선택하세요</option>}
                        {orderItem.itemId && !orderableItems.some(item => item.id === orderItem.itemId) && <option value={orderItem.itemId}>{orderItem.name}</option>}
                        {orderableItems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                      </label>
                      <label className="min-w-0 text-[10px] font-black text-slate-500 sm:contents"><span className="mb-1 block sm:hidden">수량</span><span className="relative block min-w-0">
                        <input
                          type="number"
                          min={1}
                          value={orderItem.isBoxUnit ? (orderItem.boxQuantity ?? orderItem.quantity) : orderItem.quantity}
                          onChange={event => {
                            const quantity = Math.max(1, Number(event.target.value) || 1);
                            updateDraftItem(index, orderItem.isBoxUnit ? { boxQuantity: quantity, quantity: quantity * (orderItem.unitsPerBox || 1) } : { quantity });
                          }}
                          className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-2 pr-9 text-right text-xs font-black tabular-nums text-indigo-600 outline-none [appearance:textfield] focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          aria-label={`${orderItem.name} 주문 수량 (${orderItem.isBoxUnit ? '박스' : (items.find(item => item.id === orderItem.itemId)?.unit || '개')})`}
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-500">
                          {orderItem.isBoxUnit ? '박스' : (items.find(item => item.id === orderItem.itemId)?.unit || '개')}
                        </span>
                      </span></label>
                    </div>
                    {/*  **작업완료·라벨·소비기한** — 작업순서 줄과 같은 부품·같은 셈이다.
                         라벨·소비기한은 초안이라 '변경 저장'을 눌러야 반영되고(위 안내 문구 그대로),
                         작업완료만 **바로 저장**한다 — 상태를 옮기는 셈이 `onToggleItemChecked` 안에
                         있어서 그 길로 가야 한다. 대신 초안에도 같이 적어 둔다. 안 그러면 저장할 때
                         초안이 옛 값으로 덮어 버린다.
                         **새로 추가한 줄은 아직 주문에 없으니** 작업완료를 잠근다. */}
                    {(() => {
                      const 살아있는 = index < editorOrder.items.length ? editorOrder.items[index] : undefined;
                      const 완료 = !!(살아있는?.checked ?? orderItem.checked);
                      const 라벨 = orderItem.labelType ?? '대기';
                      return (
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="shrink-0">
                            <CompletionStatusControl
                              completed={완료}
                              disabled={!살아있는 || !onToggleItemChecked}
                              ariaLabel={`${orderItem.name} 작업 완료 전환`}
                              onChange={() => {
                                followItemToggle(editorOrder.id, index, currentUserName);
                                updateDraftItem(index, { checked: !완료, checkedBy: !완료 ? currentUserName : undefined });
                              }}
                            />
                          </div>
                          <div className="relative w-[58px] shrink-0">
                            <select
                              value={라벨}
                              onChange={event => updateDraftItem(index, { labelType: event.target.value as '대기' | '날인' | '부착' })}
                              aria-label={`${orderItem.name} 라벨 상태`}
                              className={`h-8 w-full cursor-pointer appearance-none rounded-md border border-slate-200 pl-2 pr-5 text-[10px] font-black outline-none transition-colors focus:ring-1 focus:ring-indigo-400 ${라벨 === '대기' ? 'bg-slate-100 font-bold text-slate-700 hover:bg-slate-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                            >
                              <option value="대기">-</option>
                              <option value="날인">날인</option>
                              <option value="부착">부착</option>
                            </select>
                            <ChevronDown size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500" />
                          </div>
                          <div className="relative h-8 w-[92px] shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-[10px] font-black transition-colors hover:bg-slate-200 focus-within:ring-1 focus-within:ring-indigo-400">
                            <input
                              type="date" value={orderItem.mfgDate || ''}
                              onChange={event => updateDraftItem(index, { mfgDate: event.target.value })}
                              aria-label={`${orderItem.name} 소비기한 수정용 제조일`}
                              className="peer absolute inset-0 z-10 h-full w-full min-w-0 cursor-pointer opacity-0"
                            />
                            <span className={`pointer-events-none flex h-full min-w-0 items-center gap-1 px-1.5 ${orderItem.mfgDate ? 'text-indigo-600' : 'text-slate-700'}`}>
                              <CalendarDays size={11} className="shrink-0" aria-hidden="true" />
                              <span className="min-w-0 truncate tabular-nums">{orderItem.mfgDate ? fmtYYMMDD(expiryFromMfgDate(orderItem.mfgDate)) : '-'}</span>
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setListOrderEditor(current => current ? { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) } : current)}
                            disabled={listOrderEditor.items.length === 1}
                            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-not-allowed disabled:text-slate-300"
                            aria-label={`${orderItem.name} 주문 품목 삭제`}
                            title={listOrderEditor.items.length === 1 ? '마지막 품목은 주문 전체 삭제를 이용하세요' : '품목 삭제'}
                          ><Trash2 size={16} /></button>
                        </div>
                      );
                    })()}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addDraftItem} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-4 text-xs font-black text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><Plus size={15} aria-hidden="true" /> 신규 품목 추가</button>
                <p className="mt-2 text-[10px] font-bold text-slate-500">품목 변경·삭제·추가는 ‘변경 저장’을 눌러야 반영됩니다.</p>
              </section>

              {/*  **팔레트**(2026-09-12 사장님: "주문 전체삭제 위에 팔레트 설정 하는거 두고").
                   리스트의 팔레트 칸과 **같은 셈**이다 — 수를 올리고 내리고, 교환이면 교환으로 찍는다.
                   여기는 누르는 즉시 저장된다(`onUpdatePallets`) — 리스트 쪽과 같은 길이라
                   한쪽만 초안으로 두면 두 화면이 서로 다른 것을 보게 된다. */}
              {onUpdatePallets && (palletStocks ?? []).some(stock => !stock.hidden) && (
                <section aria-labelledby="order-pallet-heading">
                  {/*  **접어 둔다** — 늘 건드리는 칸이 아닌데 자리를 크게 먹어 품목이 밀렸다.
                       담긴 게 있으면 접어 둔 채로도 몇 개인지 보인다. */}
                  <button
                    type="button" id="order-pallet-heading"
                    onClick={() => setShowEditorPallet(현재 => !현재)}
                    aria-expanded={showEditorPallet}
                    className="flex min-h-9 w-full items-center gap-1.5 text-left text-xs font-black text-slate-700"
                  >
                    팔레트
                    {(() => {
                      const 담긴수 = (editorOrder.pallets ?? []).reduce((합, pallet) => 합 + pallet.quantity, 0);
                      return 담긴수 > 0
                        ? <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-black text-violet-600">{담긴수}개</span>
                        : <span className="text-[10px] font-bold text-slate-400">없음</span>;
                    })()}
                    <ChevronDown size={13} className={`ml-auto text-slate-400 transition-transform ${showEditorPallet ? 'rotate-180' : ''}`} />
                  </button>
                  <div className={`space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 ${showEditorPallet ? '' : 'hidden'}`}>
                    {(palletStocks ?? []).filter(stock => !stock.hidden).map(stock => {
                      const entry = editorOrder.pallets?.find(pallet => pallet.type === stock.id);
                      const quantity = entry?.quantity ?? 0;
                      const isExchange = entry?.isExchange ?? false;
                      const updatePallet = (nextQuantity: number, nextExchange = isExchange) => {
                        const remaining = (editorOrder.pallets ?? []).filter(pallet => pallet.type !== stock.id);
                        onUpdatePallets(editorOrder.id, nextQuantity > 0 ? [...remaining, { type: stock.id, quantity: nextQuantity, ...(nextExchange ? { isExchange: true } : {}) }] : remaining);
                      };
                      return (
                        <div key={stock.id} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-700">{stock.name}</span>
                          <button type="button" onClick={() => updatePallet(quantity, !isExchange)} disabled={quantity <= 0}
                            className={`inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-[10px] font-black transition-colors disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 ${isExchange ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-white text-slate-500 hover:bg-amber-50 hover:text-amber-700'}`}
                          >{isExchange ? '교환 · 적용됨' : '교환'}</button>
                          <div className="flex shrink-0 items-center gap-1">
                            <button type="button" onClick={() => updatePallet(Math.max(0, quantity - 1))} aria-label={`${stock.name} 하나 빼기`}
                              className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-sm font-black text-slate-600 hover:bg-slate-200">−</button>
                            <span className="w-6 text-center text-xs font-black tabular-nums text-slate-800">{quantity}</span>
                            <button type="button" onClick={() => updatePallet(quantity + 1)} aria-label={`${stock.name} 하나 더하기`}
                              className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-50 text-sm font-black text-indigo-600 hover:bg-indigo-100">+</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {showEditorPallet && <p className="mt-2 text-[10px] font-bold text-slate-500">팔레트는 누르는 즉시 저장됩니다.</p>}
                </section>
              )}

              <section aria-label="주문 전체 삭제">
                <button type="button" onClick={() => setConfirmModal({
                  message: '이 거래처 주문을 삭제하시겠습니까?',
                  subMessage: editorOrder.status === OrderStatus.DELIVERED
                    ? `${partnerName} · 예전 주문 기록만 삭제하며 재고·BOM은 원복하지 않습니다.`
                    : `${partnerName} · 전체 주문과 품목이 삭제되며 복구할 수 없습니다.`,
                  confirmText: '주문 삭제',
                  onConfirm: () => { onDeleteOrder(editorOrder.id); setConfirmModal(null); closeEditor(); },
                })} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-4 text-xs font-black text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"><Trash2 size={15} aria-hidden="true" /> 주문 전체 삭제</button>
                <p className="mt-2 text-[10px] font-bold text-slate-500">거래처 주문과 모든 하위 품목이 함께 삭제되며 복구할 수 없습니다.</p>
              </section>
            </div>
          </OrderEditModalShell>
        );
      })()}
      {listMemoEditor && (() => {
        const memoOrder = orders.find(order => order.id === listMemoEditor.orderId);
        const memoItem = memoOrder?.items[listMemoEditor.itemIndex];
        if (!memoOrder || !memoItem) return null;
        const closeMemo = () => { setListMemoEditor(null); setListMemoDraft(''); };
        const saveMemo = () => {
          const nextItems = [...memoOrder.items];
          const { note: _oldNote, noteBy: _oldNoteBy, noteAt: _oldNoteAt, ...baseItem } = nextItems[listMemoEditor.itemIndex];
          const trimmed = listMemoDraft.trim().slice(0, 500);
          nextItems[listMemoEditor.itemIndex] = trimmed
            ? { ...baseItem, note: trimmed, noteBy: currentUserName || '미기록', noteAt: new Date().toISOString() }
            : baseItem;
          onUpdateItems?.(memoOrder.id, nextItems);
          closeMemo();
        };
        const requestDeleteMemo = () => {
          closeMemo();
          setConfirmModal({
            message: '이 메모를 삭제할까요?',
            subMessage: '메모 내용과 작성자, 작성일시가 함께 삭제됩니다.',
            confirmText: '메모 삭제',
            onConfirm: () => {
              const nextItems = [...memoOrder.items];
              const { note: _oldNote, noteBy: _oldNoteBy, noteAt: _oldNoteAt, ...baseItem } = nextItems[listMemoEditor.itemIndex];
              nextItems[listMemoEditor.itemIndex] = baseItem;
              onUpdateItems?.(memoOrder.id, nextItems);
              setConfirmModal(null);
            },
          });
        };
        return (
          <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm md:items-center md:p-4" onClick={closeMemo}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="memo-editor-title"
              className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl animate-in slide-in-from-bottom duration-300 md:rounded-2xl md:zoom-in-95"
              onClick={event => event.stopPropagation()}
            >
              <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-5 py-4">
                <div className="min-w-0">
                  <h3 id="memo-editor-title" className="font-black text-slate-900">메모 작성</h3>
                  <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-3 text-xs">
                    <div className="flex min-w-0"><span className="w-16 shrink-0 font-bold text-slate-400">거래처</span><span className="truncate font-bold text-slate-700">{memoOrder.partnerName || partners.find(partner => partner.id === memoOrder.partnerId)?.name || '이름 없음'}</span></div>
                    <div className="flex min-w-0 items-center">
                      <span className="w-16 shrink-0 font-bold text-slate-400">주문 품목</span>
                      {memoOrder.items.length > 1 ? (
                        <select
                          value={listMemoEditor.itemIndex}
                          onChange={event => {
                            const itemIndex = Number(event.target.value);
                            const nextItem = memoOrder.items[itemIndex];
                            setListMemoEditor({ orderId: memoOrder.id, itemIndex });
                            setListMemoDraft(nextItem?.note || '');
                          }}
                          className="h-8 min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                          aria-label="메모를 작성할 주문 품목"
                        >
                          {memoOrder.items.map((item, itemIndex) => <option key={`${item.itemId}-${itemIndex}`} value={itemIndex}>{item.name}</option>)}
                        </select>
                      ) : (
                        <span className="truncate font-bold text-slate-700" title={memoItem.name}>{memoItem.name}</span>
                      )}
                    </div>
                    <div className="flex min-w-0"><span className="w-16 shrink-0 font-bold text-slate-400">주문일</span><span className="font-bold tabular-nums text-slate-700">{new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(memoOrder.createdAt))}</span></div>
                    <div className="flex min-w-0"><span className="w-16 shrink-0 font-bold text-slate-400">작성자</span><span className="truncate font-bold text-slate-700">{memoItem.noteBy || currentUserName || '미기록'}</span></div>
                  </div>
                </div>
                <button type="button" onClick={closeMemo} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="메모 닫기"><X size={17} /></button>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
                <div>
                  <textarea
                    value={listMemoDraft}
                    onChange={event => setListMemoDraft(event.target.value.slice(0, 500))}
                    placeholder="작업 시 확인할 내용을 입력하세요."
                    maxLength={500}
                    rows={4}
                    aria-describedby="memo-character-count"
                    className="h-28 w-full resize-none rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-medium leading-5 text-slate-800 outline-none placeholder:text-xs placeholder:font-medium placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 md:h-32 md:resize-y"
                  />
                  <p id="memo-character-count" className="mt-1 text-right text-[10px] font-medium tabular-nums text-slate-400">
                    {listMemoDraft.length}/500자
                  </p>
                </div>
                {memoItem.noteAt && <div className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-xs">
                    <span className="font-bold text-slate-500">작성일시</span>
                    <span className="font-bold tabular-nums text-slate-700">{new Date(memoItem.noteAt).toLocaleString('ko-KR')}</span>
                </div>}
              </div>
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:py-3">
                <div>
                  {memoItem.note && <button type="button" onClick={requestDeleteMemo} className="rounded-lg px-3 py-2 text-xs font-black text-rose-600 hover:bg-rose-50">메모 삭제</button>}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={closeMemo} className="rounded-lg px-4 py-2 text-xs font-black text-slate-500 hover:bg-slate-100">취소</button>
                  <button type="button" onClick={saveMemo} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700">{memoItem.note ? '수정 저장' : '저장'}</button>
                </div>
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
