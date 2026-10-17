import { OrderRecoveryEntry } from './OrderRecoveryEntry';
import { isStockProduction } from '../../../shared/orderPurpose';
import React, { useState, useEffect, memo } from 'react';
import { Plus, CalendarDays, Edit2, Check, Trash2, ChevronDown, Square, CheckSquare, Layers, NotepadText, AlertCircle } from 'lucide-react';
import { Order, OrderStatus, Partner, OrderItem, Item, OrderPallet, PalletStock, ItemBom, PartnerItem, InvoiceType, INVOICE_TYPES } from '../../../../types';
import { splitNameVolume, specText } from '../../../shared/productChip';
import { isBulkItem } from '../../../shared/itemTaxonomy';
import { boxSiblings, isBoxStockItem, unpackComponent, unitsPerBoxOf, type OrderUnitInputs } from '../../../shared/orderUnits';
import { partnerLabel, shipToOf } from '../../../shared/shipTo';
import { bomOf } from '../../../shared/bomIndex';
import { subDotClass } from '../../../shared/submaterialStyle';
import { lineSuffix } from '../../../shared/orderLine';
import { matchesSearch } from '../../../shared/hangul';
import { shipMethodOf } from '../../../shared/channelStyle';
import { orderNotesForDisplay } from '../../../shared/orderNote';
import ConfirmModal from '../../../../components/ConfirmModal';
import type { AlertTone } from '../../../shared/components/AlertModalShell';
import type { LucideIcon } from 'lucide-react';
import { cardNoLabel } from '../../../shared/cardNo';
import { channelStyle } from '../../../shared/channelStyle';
import { DEFAULT_CATEGORY_LABELS } from '../../../shared/taxonomy';
import { STATUS_CARD_BORDER, STATUS_HEAD_LINE, STATUS_LABEL, statusLabel } from '../../../shared/orderStatusStyle';
import { fmtYYMMDD, expiryFromMfgDate, isCarriedOrder } from './orderDateDisplay';
import { 달력열기 } from './orderDateInteraction';

const baseName = (name: string): string => splitNameVolume({ name }).base;

interface OrderCardProps {
  renderOrderRecovery?: (order: Order) => React.ReactNode;
  orderUnitInputs?: OrderUnitInputs;
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
  onDeleteOrder: (id: string) => Promise<boolean> | void;
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
  /** 작업완료 카드에서 출고를 요청한다 — 확인창은 받는 쪽이 띄운다. */
  onRequestShip?: (orderId: string) => void;
}

export const OrderCard = memo<OrderCardProps>(({
  order, partners, items, partnerItems, orderUnitInputs,
  editingOrderId, setEditingOrderId,
  showAddProductSelect, setShowAddProductSelect,
  onUpdateItems, onUpdateDeliveryDate, onUpdateStatus, onUpdatePallets,
  onToggleInvoicePrinted, onUpdateInvoiceType,
  onToggleItemChecked, onDeleteOrder, currentUserName, gridCols = 1, isHighlighted = false, highlightOrderId, palletStocks = [], itemBoms = [], readOnly = false,
  //  이름+연필을 누르면 이걸 부른다 — 리스트와 같은 '거래처 주문 수정' 창을 여는 문.
  onEditOrder,
  //  작업완료 카드의 출고 방식을 누르면 이걸 부른다 — 확인창은 부른 쪽이 띄운다(2026-09-15).
  onRequestShip, renderOrderRecovery,
}) => {
  // Compute derived variables
  const products = items;
  const highlighted = isHighlighted || highlightOrderId === order.id;
  const isEditing = editingOrderId === order.id;
  /*  머리에는 **짧은 이름**(`출고완료`·`주문 삭제`), 설명은 내용으로
      (2026-09-15 사장님: "헤더에는 재고부족 작업완료 출고완료 이런식으로 제목을 넣어"). */
  const [confirmModal, setConfirmModal] = useState<{ title?: string; tone?: AlertTone; icon?: LucideIcon; message: string; subMessage?: string; body?: React.ReactNode; confirmDisabled?: boolean; footerNote?: React.ReactNode; confirmText?: string; onConfirm: () => void } | null>(null);
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
  const [showPalletPicker, setShowPalletPicker] = useState(false);

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
  //  **배송지까지 붙인 이름**(2026-09-16 사장님: "주문카드처럼 배송지명으로 표시") —
  //  `해피유통(쿠팡)`. 만드는 곳은 `shared/shipTo` 하나다.
  const rawName = partnerLabel(order.partnerName || partner?.name || '이름 없음', shipToOf(partner, order.shipToId)?.name);
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
      title: '품목 삭제', tone: 'rose', icon: Trash2,
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
      /*  **카드는 안 끌린다**(2026-09-15 사장님: "드래그로 넘기는 기능도 막아놔").
          보드에서 칸 사이로 끌어 놓는 것이 상태를 바로 바꾸는 유일한 길이었는데,
          그것이 품목 체크와 어긋나는 자리였다(위 상태 칩 주석 참고).
          끌기를 남겨 두면 "끌리긴 하는데 아무 일도 안 나는" 더 나쁜 모양이 된다. */
      /*  **카드 아무 데나 눌러서 편집에 들어가지 않는다**(2026-09-11 사장님: "이름부터 그쪽까지만
          누르면 수정하는 거고"). 카드 표면 대부분이 체크·수량 같은 조작이라, 아무 데나 눌러도
          편집이 열리면 누르려던 것과 엉킨다. 여는 자리는 **이름 + 연필**뿐이다. */
      className={`bg-white rounded-2xl shadow-sm border transition-all group relative animate-in zoom-in-95 duration-200 ${isEditing ? 'ring-2 ring-indigo-500 border-indigo-200 shadow-xl z-20' : highlighted ? 'ring-2 ring-amber-400 border-amber-300 shadow-lg shadow-amber-100' : `${STATUS_CARD_BORDER[order.status] ?? 'border-slate-200'}${readOnly ? '' : ' hover:shadow-md cursor-pointer'}`} ${isCollapsed ? 'p-2.5' : 'p-4'} flex flex-col`}
    >
      {/*  머리 띠 — 카드 좌우 끝까지 닿게 음수 여백으로 빼고 위 모서리만 둥글린다.
           **바탕색도 아래 선도 뺐다**(2026-09-12 사장님) — 상태는 **글자색으로만** 알린다.
           색을 통째로 깔면 정작 거래처명이 안 읽혔다. */}
      <OrderRecoveryEntry order={order} renderOrderRecovery={readOnly ? undefined : renderOrderRecovery} />
      <div className={`flex flex-col rounded-t-2xl ${STATUS_HEAD_LINE[order.status] ?? 'text-slate-600'} ${
        isCollapsed ? '-mx-2.5 -mt-2.5 px-2.5 py-1.5 mb-1.5' : '-mx-4 -mt-4 px-4 py-2.5 mb-3'}`}>
        {/*  **첫 줄은 주문번호와 상태, 둘째 줄은 거래처명 통째로**(2026-09-14 사장님:
             "출고완료 3/5 이거 위로 올려서 주문 번호랑 같은 행에 두고 거래처명이 한 행
             온전히 쓸 수 있게"). 상태가 이름 옆에 있으면 긴 거래처명이 밀려 잘렸다 —
             주문번호는 짧아서 옆자리가 남는다. */}
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-[9px] font-black tabular-nums opacity-60">{cardNoLabel(order)}{isCarriedOrder(order) && <span className="ml-1 text-amber-700">이월</span>}</p>
        {/* 주문 상태 — 카드 **우측 상단**. 거래처명 옆에 두니 이름이 길 때 밀려 안 보였다.
            드롭다운은 오른쪽 기준으로 펼친다(왼쪽 기준이면 카드 밖으로 나간다). */}
        {/*  **상태와 진행도는 한 줄이다** — `작업중 3/5`
             (2026-09-12 사장님: "보드에 작업중 3/5 이걸 한줄로 넣자").
             같은 날 앞서 "0/1이거는 대기중 작업중 밑으로" 하셔서 두 줄로 쌓았는데, 그러면
             카드 머리가 한 줄 더 높아졌다. 이름은 이미 왼쪽에서 제 자리를 잡으므로
             오른쪽 두 조각을 옆으로 붙여도 이름을 안 밀어낸다. 눌러서 접는 것도 그대로다.
             **글줄 바닥(baseline)으로 맞춘다** — 둘은 글자 크기가 달라(11px·10px) 상자 가운데로
             맞추면 작은 쪽이 떠 보인다(2026-09-12 사장님: "대기중이랑 정렬이 안맞냐"). */}
        {/*  **`작업완료 6/6` 통째가 펼치기 단추다**(2026-09-15 사장님: "작업완료 6/6 까지를
             그냥 통째로 주문 펼치기 용 버튼으로 써"). 전에는 숫자 `6/6` 만 눌렸는데,
             10px 짜리 네 글자라 손가락으로 겨냥하기 어려웠다. 상태 글자까지 한 덩어리로 묶으면
             누를 자리가 두 배가 된다.

             **상태는 여기서 못 바꾼다 — 보여 주기만 한다**(같은 날 사장님: "카드에서 이제
             대기중 작업중 그런거 안 눌리게 바꾸고", "드래그로 넘기는 기능도 막아놔",
             "작업완료랑 출고완료도 그 버튼으로 왔다갔다 못하게 하고"). 대기중 → 작업중 →
             작업완료는 **품목 체크가 굴린다** — 여기서 상태만 건너뛰면 체크와 어긋나
             되돌리기·재고가 꼬였다. 그래서 이 자리는 이제 '펼치기' 하나만 한다.

             **글줄 바닥(baseline)으로 맞춘다** — 둘은 글자 크기가 달라(11px·10px) 상자 가운데로
             맞추면 작은 쪽이 떠 보인다(2026-09-12 사장님: "대기중이랑 정렬이 안맞냐"). */}
        {nonHyangmiyuItems.length > 0 ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setIsCollapsed(prev => !prev); }}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? '주문 펼치기' : '주문 접기'}
            className="-mx-1 flex shrink-0 items-baseline gap-1.5 rounded-md px-1 leading-tight transition-all hover:bg-black/5"
          >
            <span className="text-[11px] font-black opacity-80">{STATUS_LABEL[order.status] ?? order.status}</span>
            <span className="text-[10px] font-black opacity-70">{completedItems}/{totalItems}</span>
          </button>
        ) : (
          <div className="flex shrink-0 items-baseline leading-tight">
            <span className="text-[11px] font-black opacity-80">{STATUS_LABEL[order.status] ?? order.status}</span>
          </div>
        )}
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
              const qtyPerBox = item.unitsPerBox ?? unitsPerBoxOf(editProductInfo, orderUnitInputs);
              //  개입수를 아는 품목(박스 품목·향미유·고춧가루)에는 제조일자 칸을 안 띄운다
              const 개입수있음 = unitsPerBoxOf(editProductInfo, orderUnitInputs) > 0;
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
                        onClick={달력열기}
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
                      return (
                        <span className={`ml-auto pl-1.5 shrink-0 whitespace-nowrap ${isItemChecked ? 'opacity-50' : ''}`}>
                          <span className={`text-base font-black ${isItemChecked ? 'text-emerald-800' : 'text-slate-800'}`}>{qty}</span>
                          <span className="text-[12px] font-normal text-slate-400 ml-0.5">{unit}</span>
                        </span>
                      );
                    })()}
                  </div>
                  {(() => {
                    // 박스 품목이면 카톤/테이프 표시, 낱개(비박스)면 출고 카톤·테이프는 뺀다(박스=품목).
                    const isBoxProd = isBoxStockItem(productInfo, orderUnitInputs);
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
                        const cSubs = (orderUnitInputs ? orderUnitInputs.bom.of(p.id) : bomOf(p.id)).filter(l => {
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
                        onClick={달력열기}
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
            {orderNotesForDisplay(order).length > 0 && (
              <div className="space-y-0.5 px-2 py-1 text-[11px] font-bold text-slate-600">
                {orderNotesForDisplay(order).map((note, index) => (
                  <div key={index} className="flex items-center gap-1.5" title={note.text}>
                    {note.important && <AlertCircle size={12} className="shrink-0 text-rose-500" aria-hidden="true" />}
                    {index === 0 && <NotepadText size={12} className="shrink-0" aria-hidden="true" />}
                    <span className="truncate">{note.text}</span>
                  </div>
                ))}
              </div>
            )}
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
                  .filter(p => !(isBoxStockItem(p, orderUnitInputs) && items.some(x => !x.archived && x.id === unpackComponent(p, orderUnitInputs)?.itemId)))
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
                            const boxes = boxSiblings(p, items, orderUnitInputs).filter(b => orderable(b.item) && !already.has(b.item.id));
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
            {/*  **주문일자는 뺐다**(2026-09-15 사장님: "아예 주문일자는 빼고 왼쪽에 배송기한
                 가운데 배송방법 오른쪽은 팔레트 or 송장 이렇게 가자"). 셋이 가로로 벌어져
                 좁은 카드에서 서로 밀었고, 주문일자는 카드 머리의 주문번호로 갈음된다.
                 손대는 것(출고 방식·송장·팔레트)에 자리를 넘긴다. */}
            <div className="flex flex-col">
              <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">배송기한</span>
              <span className="text-[9px] font-bold text-slate-500">{(() => { const d = new Date(order.deliveryDate); return `${String(d.getFullYear()).slice(2)}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; })()}</span>
            </div>
            <div className="flex items-center">
              {/*  **팔레트 위에 출고 방식**(사장님: "팔레트 위에 출고 방식이 오게 해봐").
                   배송·직접수령·택배. 안 적힌 옛 주문은 판매 채널로 읽는다(`shipMethodOf`).
                   여기 있던 판매 채널은 거래처명 앞으로 옮겼다. */}
              {/*  **작업완료 주문은 여기서 바로 출고한다**(2026-09-15 사장님: "작업완료인 주문만
                   카드에서 배송방식이 버튼으로 누를 수 있게 바뀌고 누르면 알림띄워
                   재고가 ~~~차감됩니다. 출고완료로 전환하시겠습니까? … 예 누르면
                   배송버튼 > 완료로 바뀌고 출고완료로 이동하게").

                   같은 날 카드의 상태 칩에서 상태 바꾸는 길을 막았는데, 작업완료 → 출고완료는
                   **체크가 굴려 주지 않는 단계**라 누를 자리가 있어야 한다. 그 자리를 여기 둔다 —
                   출고 방식(배송·직접수령·택배)은 어차피 "어떻게 나가나" 를 적는 칸이다.
                   무엇이 얼마나 빠지는지는 `shipDeductions` 가 셈한다(재고 엔진과 같은 함수). */}
              {isStockProduction(order) ? <span className="text-xs font-bold text-indigo-600">재고 만들기 · 출고 없음</span> : order.status === OrderStatus.SHIPPED && !readOnly ? (
                <button
                  type="button"
                  onClick={event => { event.stopPropagation(); onUpdateStatus(order.id, OrderStatus.DISPATCHED); }}
                  title="출고를 취소하고 작업완료로 되돌리기"
                  className="rounded px-1.5 py-0.5 text-[9px] font-black text-amber-600 underline decoration-dotted underline-offset-2 transition-colors hover:bg-amber-50 hover:text-amber-700"
                >
                  출고취소
                </button>
              ) : order.status === OrderStatus.SHIPPED ? (
                <span className="text-[9px] font-black text-emerald-600">완료</span>
              ) : order.status === OrderStatus.DISPATCHED && !readOnly && onRequestShip ? (
                <button
                  type="button"
                  onClick={event => { event.stopPropagation(); onRequestShip(order.id); }}
                  title="눌러서 출고완료로"
                  className="rounded px-1.5 py-0.5 text-[9px] font-black text-slate-600 underline decoration-dotted underline-offset-2 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  {shipMethodOf(order)}
                </button>
              ) : (
                <span className="text-[9px] font-black text-slate-500">{shipMethodOf(order)}</span>
              )}
            </div>
            {/*  **택배면 송장, 아니면 팔레트**(2026-09-12 사장님: "보드에 카드에도 같은 방식으로
                 바꾸고"). 리스트의 '출고 방식' 칸과 같은 셈이다 — 택배로 나가면 팔레트가 돌
                 일이 없고, 우리 차가 돌면 송장이 붙을 일이 없다.
                 송장은 **양식(A~E)** 과 **세 단계**(`-`→출력→부착)를 나란히 둔다. */}
            <div className="flex items-center">
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
          <button onClick={() => { void onDeleteOrder(order.id); }}
            className="p-1.5 text-rose-400 hover:bg-rose-50 rounded-lg transition-all"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          tone={confirmModal.tone}
          icon={confirmModal.icon}
          message={confirmModal.message}
          subMessage={confirmModal.subMessage}
          body={confirmModal.body}
          confirmDisabled={confirmModal.confirmDisabled}
          footerNote={confirmModal.footerNote}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
});

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
