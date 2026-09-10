import React, { useState, useMemo, useEffect } from 'react';
import { today, addDays, dateOfLocal } from '../src/shared/day';
import { matchesSearch } from '../src/shared/hangul';
import { X, Search, ShoppingBag, User, ArrowRight, AlertCircle, Truck, Store, LayoutGrid, Layers, ClipboardList, ChevronDown, CalendarDays } from 'lucide-react';
import { Item, PartnerItem, OrderItem, Order, Partner, OrderSource, OrderPallet, PalletStock } from '../types';
import { bomQty } from '../src/shared/bom';
import { unpackComponent, isBoxStockItem, boxSiblings, boxDerivedUnitPrice, unitsPerBoxOf } from '../src/shared/orderUnits';
import { subDotClass } from '../src/shared/submaterialStyle';
import { VOLUME_CHIP_COLORS, catOrder, renderColoredName } from '../src/shared/productChip';
import { isBulkItem } from '../src/shared/itemTaxonomy';
import { bomOf, packingSubmaterials } from '../src/shared/bomIndex';
import { sellsTo } from '../src/shared/partnerRole';
import { channelStyle, isDeliveryChannel } from '../src/shared/channelStyle';
import { DEFAULT_CATEGORY_LABELS } from '../src/shared/taxonomy';
import { isSmartStoreItem } from '../src/shared/partnerPrice';
import { isActive } from '../src/shared/statementOrders';
import { cardNoLabel } from '../src/shared/cardNo';
import OrderStatusDot from '../src/shared/components/OrderStatusDot';
import OrderItemLines from '../src/shared/components/OrderItemLines';
import OrderCreationModalHeader from '../src/shared/components/OrderCreationModalHeader';
import ModalActionFooter from '../src/shared/components/ModalActionFooter';

interface AddOrderModalProps {
  items: Item[];
  orders: readonly Order[];
  partners: Partner[];
  partnerItems?: import('../src/shared/types').PartnerItem[];
  palletStocks: PalletStock[];
  submaterials?: Item[];
  onClose: () => void;
  onBack?: () => void;
  onSave: (_order: Omit<Order, 'id' | 'status'>) => void;
}

const CHOSUNG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

const getChosung = (str: string): string =>
  str.split('').map(c => {
    const code = c.charCodeAt(0) - 44032;
    return code >= 0 && code <= 11171 ? CHOSUNG[Math.floor(code / 588)] : c;
  }).join('');

const COMPOUND_MAP: Record<string, string> = {
  'ㄳ':'ㄱㅅ', 'ㄵ':'ㄴㅈ', 'ㄶ':'ㄴㅎ', 'ㄺ':'ㄹㄱ', 'ㄻ':'ㄹㅁ',
  'ㄼ':'ㄹㅂ', 'ㄽ':'ㄹㅅ', 'ㄾ':'ㄹㅌ', 'ㄿ':'ㄹㅍ', 'ㅀ':'ㄹㅎ', 'ㅄ':'ㅂㅅ'
};

const decompound = (str: string): string =>
  str.split('').map(c => COMPOUND_MAP[c] ?? c).join('');

//  초성·겹자음 처리는 shared/hangul 하나뿐이다. 빈 검색어는 '아무도 아님'으로 본다(거래처 고르기).
const matchPartner = (name: string, query: string): boolean =>
  !!query.trim() && matchesSearch(name, query);

const AddOrderModal: React.FC<AddOrderModalProps> = ({ items, orders, partners, partnerItems, palletStocks, submaterials: _submaterials, onClose, onBack, onSave }) => {
  const products = items;
  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const submaterials = _submaterials ?? items.filter(i => i.type !== 'product');
  const partnerOut = (partnerItems ?? []).filter((pi: any) => pi.Direction === 'out');


  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [selectedItems, setSelectedItems] = useState<{ itemId: string, quantity: number | '', isBoxUnit: boolean, unitsPerBox: number, boxType: string, boxSubId?: string, displaySize?: string }[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState<string>('전체');
  const [orderDate, setOrderDate] = useState(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()));
  const [deadline, setDeadline] = useState(() => {
    const base = addDays(today(), 3);
    const day = new Date(`${base}T12:00:00Z`).getUTCDay();
    return day === 6 ? addDays(base, 2) : day === 0 ? addDays(base, 1) : base;
  });
  const [source, setSource] = useState<OrderSource>('일반');
  const [pallets, setPallets] = useState<OrderPallet[]>([]);
  const [isDelivery, setIsDelivery] = useState(false);
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(() => new Set());

  // 거래처 이름이 같아도 주문은 섞지 않는다 — 연결의 근거는 partnerId 하나다.
  const activePartnerOrders = useMemo(() => {
    if (!selectedPartner) return [];
    return orders
      .filter(order => order.partnerId === selectedPartner.id && isActive(order))
      .sort((a, b) => {
        const aDate = dateOfLocal(a.deliveryDate) || '9999-12-31';
        const bDate = dateOfLocal(b.deliveryDate) || '9999-12-31';
        return aDate.localeCompare(bDate)
          || b.createdAt.localeCompare(a.createdAt)
          || a.id.localeCompare(b.id);
      });
  }, [orders, selectedPartner]);

  const toggleOrderItems = (orderId: string) => {
    setExpandedOrderIds(current => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const selectPartner = (partner: Partner) => {
    setSelectedPartner(partner);
    setSource(partner.type as OrderSource);
    setIsDelivery(partner.type === '택배' || partner.type === '스마트스토어');
    setSearchTerm('');
  };

  const changePartner = () => {
    setSelectedPartner(null);
    setSelectedItems([]);
    setPallets([]);
    setSource('일반');
    setIsDelivery(false);
    setProductCategoryFilter('전체');
    setVolumeFilter(null);
    setSearchTerm('');
  };

  const quickPartners = useMemo(() => {
    const seen = new Set<string>();
    return [...partners]
      .filter(sellsTo)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'))
      .filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true; })
      .slice(0, 15);
  }, [partners]);

  const filteredPartners = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return partners.filter(c =>
      sellsTo(c) &&
      (matchPartner(c.name || '', searchTerm) || (c.phone || '').includes(searchTerm))
    );
  }, [searchTerm, partners]);

  // 카테고리 순서는 공용(productChip.catOrder) — 품목관리·재고현황과 같은 순서로 본다.
  // 품목에 카테고리가 없으면 이름으로 짐작한다.
  const catOf = (p: { category?: string; name: string }): string => {
    if (p.category) return p.category;
    const n = p.name;
    if (/들기름|들향|들진|들고소/.test(n)) return '들기름';
    if (/참기름|참진|참고소|참향/.test(n)) return '참기름';
    if (/검정깨|검정참깨/.test(n)) return '검정깨';
    if (/탈피들깨/.test(n)) return '탈피들깨';
    if (/들깨/.test(n)) return '들깨';
    if (/참깨/.test(n)) return '참깨';
    return '';
  };
  //  이름 색칠은 [shared/productChip](../src/shared/productChip) 한 곳이 한다

  const productCategoryOf = (p: Item): string => p.category || '미분류';
  const PRODUCT_CATEGORIES = ['전체', ...new Set(items.filter(p => !p.archived).map(productCategoryOf))];
  const VOLUME_RE = /^\d+(\.\d+)?\s*(ml|l|g|kg)$/i;
  const normVolume = (s: string) => s.trim().toLowerCase().replace(/\s/g, '');
  // "참기름/병/분/300ml" → { base: "참기름/병/분", vol: "300ml" } / 이름에 없으면 spec 폴백
  const splitNameVolume = (product: { name: string; spec?: string }): { base: string; vol: string | null } => {
    const parts = product.name.split('/');
    const last = parts[parts.length - 1]?.trim() ?? '';
    if (parts.length > 1 && VOLUME_RE.test(last)) {
      return { base: parts.slice(0, -1).join('/'), vol: normVolume(last) };
    }
    const spec = (product.spec ?? '').trim();
    if (spec && VOLUME_RE.test(spec)) return { base: product.name, vol: normVolume(spec) };
    return { base: product.name, vol: null };
  };
  /** 규격 칩 — 품목의 규격을 그대로 띄운다('300ml * 20'). 색만 용량으로 고른다. */
  const renderVolumeChip = (vol: string | null, product?: { spec?: string }) => {
    const spec = String(product?.spec ?? '').trim();
    const text = spec || vol;
    if (!text) return null;
    // 색을 안 쓴다 — 칠해 두면 품목명보다 규격이 먼저 읽힌다(주문카드·품목관리와 같은 규칙)
    return <span className="shrink-0 text-xs font-bold text-slate-400 whitespace-nowrap">{text}</span>;
  };

  // 거래처 전용 품목 필터링 적용
  // 이 거래처가 이 품목을 주문할 수 있나 (거래처 등록·스마트스토어·통합품목)
  /**
   * 이 거래처가 이 품목을 주문할 수 있나 — **연결이 두 군데에 산다.**
   *   · items.partnerIds (옛 방식)
   *   · partner_item 행 (품목관리 '품목 연결'이 만드는 것 — 지금 쓰는 길)
   * partnerIds만 보면 품목 연결로 붙인 것이 통째로 안 뜬다. 새봄푸드의 벌크 볶음참깨·
   * 볶음검정참깨가 그랬다(partnerIds는 비었고 partner_item에만 있다).
   */
  const partnerOutIds = useMemo(
    () => new Set(partnerOut.filter((pi: any) => pi.partnerId === selectedPartner?.id).map((pi: any) => String(pi.itemId))),
    [partnerOut, selectedPartner?.id]);
  const orderableForPartner = (p: Item): boolean => {
    if (!selectedPartner) return false;
    //  **연결은 partner_item 하나가 근거다**(2026-09-06). 옛 방식(items.partnerIds)도
    //  같이 보다가 둘이 어긋나 동우 볶음참깨가 10개입 대신 20개입으로 주문됐다.
    if (partnerOutIds.has(p.id)) return true;
    if (selectedPartner.type === '스마트스토어' && isSmartStoreItem(p)) return true;

    return false;
  };
  // 낱개↔박스가 짝인데 거래처마다 노출 명단이 다르다 — 그룹의 아무 변형이나 주문 가능하면 낱개를 앵커로 띄운다
  const groupOrderable = (loose: Item): boolean =>
    orderableForPartner(loose) || boxSiblings(loose, items).some(s => orderableForPartner(s.item));

  const catalogProducts = useMemo(() => {
    if (!selectedPartner) return [];
    return products
      .filter(p => {
        if (p.archived) return false;
        // 박스 변형은 목록에서 빼고 낱개 카드의 토글로만 접근 (짝 없이 홀로면 그대로 노출)
        if (isBoxStockItem(p) && items.some(x => !x.archived && x.id === (unpackComponent(p)?.itemId))) return false;
        return true;
      })
      .sort((a, b) => {
        const diff = catOrder(catOf(a)) - catOrder(catOf(b));
        return diff !== 0 ? diff : a.name.localeCompare(b.name, 'ko');
      });
  }, [products, selectedPartner, partnerOutIds, items]);
  const linkedProducts = useMemo(() => catalogProducts.filter(groupOrderable), [catalogProducts, selectedPartner, partnerOutIds, items]);
  const usingCatalogFallback = !!selectedPartner && linkedProducts.length === 0;
  const displayProducts = usingCatalogFallback ? catalogProducts : linkedProducts;

  // 개봉은 여기 없다 — 재고관리(재고현황) 화면의 박스 품목 행에서 한다.
  //  주문을 받는 화면이 창고 재고를 직접 바꾸면, 주문을 취소해도 개봉은 남고
  //  실제로 박스를 뜯는 시점(출고 작업)보다 한참 앞서 장부만 움직인다.

  // 용량 필터 — 거래처 품목에 존재하는 용량들만 버튼으로 노출
  const [volumeFilter, setVolumeFilter] = useState<string | null>(null);
  useEffect(() => {
    setProductCategoryFilter('전체');
    setVolumeFilter(null);
    setProductSearch('');
  }, [selectedPartner?.id]);
  const categoryOptions = useMemo(() => PRODUCT_CATEGORIES
    .map(category => [category, category === '전체' ? displayProducts.length : displayProducts.filter(p => productCategoryOf(p) === category).length] as const)
    .filter(([category, count]) => category === '전체' || count > 0), [displayProducts]);
  const categoryProducts = productCategoryFilter === '전체'
    ? displayProducts
    : displayProducts.filter(p => productCategoryOf(p) === productCategoryFilter);
  const volumeOptions = useMemo(() => {
    const m = new Map<string, number>();
    categoryProducts.forEach(p => { const { vol } = splitNameVolume(p); if (vol) m.set(vol, (m.get(vol) ?? 0) + 1); });
    const rank = (v: string) => {
      const n = parseFloat(v);
      if (v.endsWith('ml')) return n;
      if (v.endsWith('kg')) return 1000000 + n * 1000;
      if (v.endsWith('l')) return n * 1000;
      return 1000000 + n; // g
    };
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [categoryProducts]);
  const volumeMatchedProducts = volumeFilter ? categoryProducts.filter(p => splitNameVolume(p).vol === volumeFilter) : categoryProducts;
  const shownProducts = productSearch.trim()
    ? volumeMatchedProducts.filter(product => matchesSearch(product.name, productSearch))
    : volumeMatchedProducts;

  const shownGroups = [...new Set(shownProducts.map(p => p.type))].map(key => ({
    key, label: DEFAULT_CATEGORY_LABELS[key] || key, list: shownProducts.filter(p => p.type === key),
  }));

  // 현재 선택된 품목 기준 부자재 재고 부족 계산
  const shortages = useMemo(() => {
    const usage: Record<string, { name: string; needed: number; stock: number }> = {};
    // (테이프는 재고 차감·부족 경고 대상에서 제외 — 사용자 요청)
    for (const item of selectedItems) {
      const qty = typeof item.quantity === 'number' ? item.quantity : 0;
      if (qty <= 0) continue;
      const product = items.find(p => p.id === item.itemId);
      if (!product) continue;

      if (product.category === '향미유') {
        const sub = submaterials.find(s => s.id === product.id);
        if (sub) {
          const actualQty = item.isBoxUnit && item.unitsPerBox > 0 ? qty * item.unitsPerBox : qty;
          //  **나누지 않는다.** 여기서 찾는 `sub` 는 겉박스가 아니라 **향미유 그 자체**다
          //  (`submaterials = items.filter(type !== 'product')` 인데 향미유는 goods 다).
          //  향미유 재고는 낱개로 세니 낱개 수가 곧 소요량이다. 개입수로 나누면
          //  36개 주문이 "3개 필요"가 돼서 재고 부족 경고가 12배 느슨해진다.
          const needed = actualQty;
          if (!usage[sub.id]) usage[sub.id] = { name: sub.name, needed: 0, stock: sub.stock };
          usage[sub.id].needed += needed;
        }
        continue;
      }

      if (product.type !== 'product' || !selectedPartner) continue;
      const actualQty = item.isBoxUnit && item.unitsPerBox > 0 ? qty * item.unitsPerBox : qty;

      const pc = partnerOut.find(p => p.itemId === product.id && p.partnerId === selectedPartner.id);
      const boxSize = pc?.qtyPerBox || item.unitsPerBox || unitsPerBoxOf(product) || 1;
      const boxesNeeded = Math.ceil(actualQty / boxSize);

      if (pc?.boxTypeId) {
        const sub = submaterials.find(sm => sm.id === pc.boxTypeId);
        if (sub) {
          if (!usage[sub.id]) usage[sub.id] = { name: sub.name, needed: 0, stock: sub.stock };
          usage[sub.id].needed += boxesNeeded;
        }
      }
      // 재고 1단위 기준 수량 — 박스 품목은 박스 개수(입력이 박스면 qty가 곧 박스 수)
      const unpack = unpackComponent(product);
      const stockQty = unpack ? (item.isBoxUnit ? qty : actualQty / unpack.count) : actualQty;
      for (const line of bomOf(product.id)) {
        // 겉박스·테이프도 BOM으로 센다 — 거래처별 포장설정(shipping_rule)은 폐기했다.
        const sub = submaterials.find(sm => sm.id === line.childId);
        if (!sub) continue;
        if (!usage[sub.id]) usage[sub.id] = { name: sub.name, needed: 0, stock: sub.stock };
        usage[sub.id].needed += stockQty * line.qty;   // 재고 1단위 × BOM 수량
      }
    }
    return Object.values(usage).filter(v => v.needed > v.stock);
  }, [selectedItems, selectedPartner, products, partnerOut, submaterials]);

  // 박스 설정 — 품목이 들고 있는 것만 본다(거래처별 포장설정은 폐기).
  const getPartnerBoxConfigs = (itemId: string, _partnerId?: string): { unitsPerBox: number; boxType: string; boxSubId?: string }[] => {
    const p = items.find(pr => pr.id === itemId);
    if (p?.defaultBoxConfig?.unitsPerBox) return [p.defaultBoxConfig];
    return [];
  };
  const getItemCustomerConfigs = (_itemId: string, _partnerId?: string): { id: string; box_item_id?: string; qty_per_box?: number }[] => [];

  // 선택 1건을 어떻게 초기화할지 — 토글·변형 전환에서 공유
  const buildSelection = (itemId: string): typeof selectedItems[0] => {
    const product = items.find(p => p.id === itemId);
    // 박스 변형 품목 자체는 재고 단위가 '박스 1개'다. 배송 포장(shipping_rule)을 얹지 않는다
    // — 수량 = 박스 개수, 그대로 그 품목 재고에서 뺀다.
    if (product && isBoxStockItem(product)) {
      // 겉박스는 박스 품목 BOM에 들어있어 생산 때 깎인다 — 주문 라인엔 안 싣는다(이중차감 방지)
      return { itemId, quantity: 1, isBoxUnit: false, unitsPerBox: 0, boxType: '' };
    }
        if (product?.isRawMaterial && selectedPartner) {
      const rules = getItemCustomerConfigs(itemId, selectedPartner.id);
      if (rules.length >= 1) {
        const rule = rules[0];
        const qpb = rule.qty_per_box ?? 0;
        return { itemId, quantity: 1, isBoxUnit: qpb > 1, unitsPerBox: qpb, boxType: rule.box_item_id ?? '', boxSubId: rule.box_item_id || undefined, displaySize: product?.netContent };
      }
    }
    const configs = getPartnerBoxConfigs(itemId, selectedPartner?.id);
    // 개입수는 품목이 안다(BOM → 포장 환산표). 거래처 포장설정이 있으면 그게 먼저.
    const first = configs[0] ?? { unitsPerBox: unitsPerBoxOf(product), boxType: '', boxSubId: undefined };
    return { itemId, quantity: 1, isBoxUnit: first.unitsPerBox > 0, unitsPerBox: first.unitsPerBox, boxType: first.boxType, boxSubId: first.boxSubId };
  };

  const toggleProduct = (itemId: string) => {
    setSelectedItems(prev => {
      const exists = prev.find(i => i.itemId === itemId);
      if (exists) return prev.filter(i => i.itemId !== itemId);
      return [...prev, buildSelection(itemId)];
    });
  };

  // 낱개↔박스 변형 전환 — 카드가 어느 품목(낱개/10kg박스/20kg박스)을 주문하는지 바꾼다.
  // 같은 그룹의 다른 변형이 골라져 있었으면 그 선택을 새 변형으로 옮긴다.
  const [variantChoice, setVariantChoice] = useState<Record<string, string>>({});
  const chooseVariant = (looseId: string, chosenId: string, groupIds: string[]) => {
    setVariantChoice(prev => ({ ...prev, [looseId]: chosenId }));
    setSelectedItems(prev => {
      const had = prev.find(i => groupIds.includes(i.itemId));
      const rest = prev.filter(i => !groupIds.includes(i.itemId));
      return had ? [...rest, buildSelection(chosenId)] : prev;
    });
  };

  const updateItem = (itemId: string, patch: Partial<typeof selectedItems[0]>) => {
    setSelectedItems(prev => prev.map(i => i.itemId === itemId ? { ...i, ...patch } : i));
  };

  /**
   * 카드 맨 우측 수량칸 — 고르고 나서 수량을 넣는 게 아니라 **수량을 넣으면 담긴다.**
   * 비우면 선택이 풀린다. 아래 상세 조작(낱개/박스·규격)은 담긴 뒤 그대로 쓴다.
   */
  const quickQtyOf = (itemId: string): string => {
    const sel = selectedItems.find(i => i.itemId === itemId);
    return sel && typeof sel.quantity === 'number' && sel.quantity > 0 ? String(sel.quantity) : '';
  };
  const setQuickQty = (itemId: string, raw: string) => {
    const v = raw.replace(/[^\d]/g, '');
    setSelectedItems(prev => {
      const exists = prev.find(i => i.itemId === itemId);
      if (!v) return prev.filter(i => i.itemId !== itemId);
      const qty = Number(v);
      if (exists) return prev.map(i => i.itemId === itemId ? { ...i, quantity: qty } : i);
      return [...prev, { ...buildSelection(itemId), quantity: qty }];
    });
  };

  /**
   * **수량칸은 카드 맨 위 한 곳뿐이다.** 숫자를 넣으면 담기고 비우면 빠진다.
   * 예전엔 펼친 뒤 아래에 [−][수량][+]가 또 있었다 — 같은 값을 두 군데서 고치니
   * 어느 쪽이 진짜인지 헷갈리고, 카드가 세로로 길어져 목록이 안 읽혔다.
   */
  const renderQtyBox = (product: Item) => {
    const isBox = isBoxStockItem(product);
    return (
      <>
        <input inputMode="numeric" value={quickQtyOf(product.id)} placeholder="0"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setQuickQty(product.id, e.target.value)}
          className={`w-12 shrink-0 text-right text-sm font-black tabular-nums rounded-lg px-2 py-1.5 border outline-none focus:ring-2 focus:ring-indigo-300 ${
            selectedItems.some(i => i.itemId === product.id) ? 'border-indigo-300 bg-white' : 'border-slate-200 bg-slate-50'}`} />
        {/* 단위 — 숫자 바로 옆이라야 '3'이 3박스인지 3병인지 눈으로 안다 */}
        <span className={`w-7 shrink-0 text-[10px] font-black ${isBox ? 'text-indigo-500' : 'text-slate-400'}`}>
          {isBox ? '박스' : (product.unit || '개')}
        </span>
      </>
    );
  };

  const renderItemControls = (product: { id: string; unit?: string; category?: string }) => {
    const selection = selectedItems.find(i => i.itemId === product.id);
    if (!selection) return null;
    const uPerBox = selection.unitsPerBox ?? 0;
    const boxQty = typeof selection.quantity === 'number' ? selection.quantity : 0;
    const totalUnits = selection.isBoxUnit && uPerBox > 0 ? boxQty * uPerBox : boxQty;
    const availableConfigs = getPartnerBoxConfigs(product.id, selectedPartner?.id);
    const isBoxMode = selection.isBoxUnit && uPerBox > 0;
    const icConfigs = getItemCustomerConfigs(product.id, selectedPartner?.id);
    return (
      <div
        className={`flex flex-col gap-1.5 p-1.5 rounded-xl border transition-colors ${
          isBoxMode ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-100'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 통합 품목 규격 선택 (isRawMaterial + 여러 포장 규격) */}
        {icConfigs.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {icConfigs.map(rule => {
              const boxItem = submaterials.find(s => s.id === rule.box_item_id);
              const label = boxItem?.name ?? rule.box_item_id ?? '';
              return (
                <button
                  key={rule.id}
                  type="button"
                  onClick={() => { const qpb = rule.qty_per_box ?? 0; updateItem(product.id, {
                    displaySize: items.find(p => p.id === product.id)?.netContent,
                    unitsPerBox: qpb,
                    isBoxUnit: qpb > 1,
                    boxType: rule.box_item_id ?? '',
                    boxSubId: rule.box_item_id || undefined,
                  }); }}
                  className={`text-[10px] font-black px-2.5 py-1 rounded-lg border transition-all ${
                    selection.boxType === rule.box_item_id
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-300'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {/* 자동 선택된 규격 표시 (1개만 있을 때) */}
        {icConfigs.length === 1 && selection.displaySize && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg">
              {selection.displaySize}
            </span>
          </div>
        )}


        {/* 박스 종류 선택 (박스 모드 + 여러 configs) */}
        {isBoxMode && availableConfigs.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {availableConfigs.map((cfg, i) => (
              <button
                key={i}
                type="button"
                onClick={() => updateItem(product.id, { boxType: cfg.boxType, unitsPerBox: cfg.unitsPerBox, boxSubId: cfg.boxSubId })}
                className={`text-[10px] font-black px-2 py-0.5 rounded-lg border transition-all ${
                  selection.boxType === cfg.boxType && selection.unitsPerBox === cfg.unitsPerBox
                    ? 'bg-indigo-100 text-indigo-700 border-indigo-400'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-200'
                }`}
              >
                {cfg.boxType ? `${cfg.boxType} ${cfg.unitsPerBox}개` : `${cfg.unitsPerBox}개`}
              </button>
            ))}
          </div>
        )}

        {/* 수량은 카드 맨 위 한 곳에서만 고친다(renderQtyBox) — 여기 또 두면 같은 값이 두 군데다 */}

        {/* 합계 */}
        {isBoxMode && boxQty > 0 && (
          <div className="flex items-center justify-end px-1">
            <span className="text-[9px] font-black text-indigo-500">× {uPerBox}개 = {totalUnits}개</span>
          </div>
        )}

        {/* 낱개 재고 부족 알림 — 알려주기만 한다. 개봉(재고 이동)은 재고관리 화면에서. */}
        {(() => {
          const full = items.find(i => i.id === product.id);
          if (!full) return null;
          const boxes = items.filter(b => !b.archived && unpackComponent(b)?.itemId === full.id);
          if (boxes.length === 0) return null;
          const shortBy = totalUnits - (full.stock ?? 0);
          if (shortBy <= 0) return null;
          const onHand = boxes.filter(b => (b.stock ?? 0) > 0);
          return (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-2">
              <p className="text-[10px] font-black text-amber-700">낱개 재고 {full.stock ?? 0}개 · {shortBy}개 부족</p>
              <p className="text-[10px] font-bold text-amber-600/80 mt-0.5">
                {onHand.length > 0
                  ? `재고관리에서 개봉하세요 — ${onHand.map(b => `${b.name} ${b.stock}박스`).join(', ')}`
                  : '깔 박스 재고도 없습니다'}
              </p>
            </div>
          );
        })()}
      </div>
    );
  };


  const handleSubmit = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!orderDate || !deadline || !selectedPartner || selectedItems.length === 0) return;

    const orderItems: OrderItem[] = selectedItems.flatMap(item => {
      if (!item.quantity || item.quantity <= 0) return [];
      const product = items.find(p => p.id === item.itemId)
        ?? items.find(p => String(p.id).trim() === String(item.itemId).trim());
      if (!product) return [];
      const uPerBox = item.unitsPerBox ?? 0;
      const actualQty = item.isBoxUnit && uPerBox > 0 ? item.quantity * uPerBox : item.quantity;
      // 박스 품목은 낱개단가×개입수로 파생, 아니면 품목 단가
      const boxPrice = selectedPartner ? boxDerivedUnitPrice(product, selectedPartner.id, partnerOut) : undefined;
      return [{
        itemId: item.itemId,
        name: product.name || '알 수 없는 상품',
        quantity: actualQty,
        price: boxPrice ?? 0,
        ...(item.isBoxUnit && uPerBox > 0 ? { isBoxUnit: true, boxQuantity: item.quantity, unitsPerBox: uPerBox, boxType: item.boxType } : {}),
        ...(item.boxSubId ? { boxSubId: item.boxSubId } : {}),   // 겉박스 — 박스 품목/일반 공통
        ...(item.displaySize ? { displaySize: item.displaySize } : {}),
      }];
    });

    const totalAmount = selectedItems.reduce((sum, item) => {
      if (!item.quantity || item.quantity <= 0) return sum;
      const product = items.find(p => String(p.id).trim() === String(item.itemId).trim());
      if (!product) return sum;
      const uPerBox = item.unitsPerBox ?? 0;
      const actualQty = item.isBoxUnit && uPerBox > 0 ? item.quantity * uPerBox : item.quantity;
      const boxPrice = selectedPartner ? boxDerivedUnitPrice(product, selectedPartner.id, partnerOut) : undefined;
      return sum + (boxPrice ?? 0) * actualQty;
    }, 0);

    onSave({
      partnerId: selectedPartner.id,
      partnerName: selectedPartner.name || '이름 없음',
      email: selectedPartner.email || '',
      createdAt: new Date(`${orderDate}T00:00:00+09:00`).toISOString(),
      items: orderItems,
      totalAmount,
      deliveryDate: new Date(deadline).toISOString(),
      source: (isDelivery && source === '일반') ? '택배' : source,
      pallets: pallets.filter(p => p.quantity > 0),
      region: selectedPartner.region || '미지정',
      ...(isDelivery ? { deliveryBoxes: [] } : {}),
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-6">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={onClose} />

      <div className="relative bg-white w-full sm:max-w-3xl rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col h-[92dvh] sm:h-[85vh] sm:max-h-[900px] animate-in slide-in-from-bottom sm:zoom-in-95 duration-300">
        <div className="sticky top-0 z-10 rounded-t-3xl">
          <OrderCreationModalHeader
            currentLabel="직접 선택"
            onBack={onBack}
            onClose={onClose}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 sm:space-y-8 custom-scrollbar">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 text-slate-700"><CalendarDays size={16} /><h3 className="text-sm font-black">주문 일정</h3></div>
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-600">필수</span>
              <span className="text-xs font-medium text-slate-500">주문일과 출고예정일은 자동 설정되며 수정할 수 있습니다.</span>
            </div>
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-600">주문일</span>
                <input type="date" required value={orderDate} onChange={event => setOrderDate(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold tabular-nums text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-600">출고예정일</span>
                <input type="date" required min={orderDate} value={deadline} onChange={event => setDeadline(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold tabular-nums text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              </label>
            </div>
          </section>
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 text-slate-700"><User size={16} /><h3 className="text-sm font-black">거래처</h3></div>
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-600">필수</span>
            </div>

            {!selectedPartner ? (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input type="text" placeholder="거래처명 또는 초성 검색 (예: ㅌㅂ)..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-4 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />

                  {filteredPartners.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-100 rounded-2xl shadow-xl z-20 overflow-hidden max-h-80 overflow-y-auto custom-scrollbar">
                      {filteredPartners.map(partner => (
                        <button key={partner.id} onClick={() => selectPartner(partner)} className="w-full px-5 py-3 text-left hover:bg-indigo-50 flex items-center justify-between group">
                          <div>
                            <div className="flex items-center space-x-2">
                              <p className="font-bold text-slate-800 text-sm">{partner.name || '이름 없음'}</p>
                              {partner.region && <span className="text-[9px] text-slate-400">{partner.region}</span>}
                            </div>
                          </div>
                          <ArrowRight size={16} className="text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {!searchTerm && quickPartners.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest px-1">자주 사용하는 거래처</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {quickPartners.map(partner => {
                        //  채널 아이콘·색은 [shared/channelStyle](../src/shared/channelStyle) 한 곳이 정한다
                        const typeConfig = { ...channelStyle(partner.type), color: channelStyle(partner.type).chip };
                        const TypeIcon = typeConfig.icon;
                        return (
                          <button
                            key={partner.id}
                            onClick={() => selectPartner(partner)}
                            className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-100 transition-all p-4 text-left"
                          >
                            <div className="flex items-center space-x-3 min-w-0">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${typeConfig.color}`}>
                                <TypeIcon size={18} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <h3 className="text-sm font-bold text-slate-900 truncate">{partner.name}</h3>
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-black flex-shrink-0 ${typeConfig.color}`}>{partner.type}</span>
                                </div>
                                {partner.region && (
                                  <p className="text-[11px] text-slate-400 mt-0.5">{partner.region}</p>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-3">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-1.5">
                      <h4 className="truncate text-sm font-black text-indigo-900">{selectedPartner.name}</h4>
                      <span className="shrink-0 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[8px] font-black text-white">{selectedPartner.type}</span>
                    </div>
                    {selectedPartner.region && <p className="text-[10px] font-medium text-indigo-500">{selectedPartner.region}</p>}
                  </div>
                  <div className="shrink-0">
                  <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="출고 방식">
                    <button
                      type="button"
                      onClick={() => {
                        setIsDelivery(false);
                        setSource(current => current === '택배' ? '일반' : current);
                      }}
                      aria-pressed={!isDelivery}
                      className={`min-h-8 rounded-md px-2.5 text-[11px] font-bold transition-colors ${!isDelivery ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                      일반
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsDelivery(true);
                        setSource(current => current === '일반' ? '택배' : current);
                      }}
                      aria-pressed={isDelivery}
                      className={`flex min-h-8 items-center gap-1 rounded-md px-2.5 text-[11px] font-bold transition-colors ${isDelivery ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                      <Truck size={12} aria-hidden="true" />
                      택배
                    </button>
                  </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={changePartner}
                  className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                >
                  <User size={14} aria-hidden="true" />
                  거래처 다시 선택
                </button>
              </div>
            )}
          </section>

          {selectedPartner && (
            <section aria-labelledby="active-client-orders-title" className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex items-center gap-2 text-slate-400">
                <ClipboardList size={16} />
                <span id="active-client-orders-title" className="text-xs font-bold uppercase tracking-widest">현재 진행 주문</span>
                <span className="text-[10px] font-bold text-slate-400">{activePartnerOrders.length}건</span>
              </div>

              {activePartnerOrders.length === 0 ? (
                <p className="border-y border-slate-100 py-3 text-[11px] font-medium text-slate-400">
                  현재 진행 중인 주문이 없습니다.
                </p>
              ) : (
                <div className="max-h-44 overflow-y-auto border-y border-slate-100 divide-y divide-slate-100 custom-scrollbar">
                  {activePartnerOrders.map(order => {
                    const expanded = expandedOrderIds.has(order.id);
                    return (
                      <div key={order.id} data-testid={`active-client-order-${order.id}`} className="px-1 py-2.5">
                        <div className="flex items-center gap-3">
                          <OrderStatusDot status={order.status} className="w-20 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[10px] font-black text-slate-600 tabular-nums">{cardNoLabel(order)}</p>
                            <p className="mt-0.5 text-[10px] font-medium text-slate-400">납품 {dateOfLocal(order.deliveryDate) || '미정'}</p>
                          </div>
                          <button type="button"
                            aria-expanded={expanded}
                            aria-label={`${cardNoLabel(order)} ${order.items.length}품목 ${expanded ? '접기' : '보기'}`}
                            onClick={() => toggleOrderItems(order.id)}
                            className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-slate-500 hover:text-indigo-600">
                            {order.items.length}품목
                            <ChevronDown size={11} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                          </button>
                        </div>
                        {expanded && (
                          <OrderItemLines orderItems={order.items} itemById={itemById}
                            className="mt-2 border-t border-slate-100 pt-2 pl-1" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {selectedPartner && (
            <section className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 text-slate-700"><ShoppingBag size={16} /><h3 className="text-sm font-black">주문 품목</h3></div>
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-600">필수</span>
                  <span className="text-xs font-medium text-slate-500">품목을 선택하면 <strong className="font-bold text-slate-700">단가·단위는 자동 입력됩니다.</strong></span>
                </div>
              </div>
              {usingCatalogFallback && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3" role="status">
                  <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-black text-amber-800">연결된 주문 품목이 없어 전체 활성 품목을 표시합니다.</p>
                    <p className="mt-1 text-[11px] font-medium leading-relaxed text-amber-700">품목명을 검색해 이번 주문에만 수동으로 추가할 수 있습니다. 거래처의 기본 품목 연결 정보는 변경되지 않습니다.</p>
                  </div>
                </div>
              )}
              <label className="block text-[10px] font-bold text-slate-500">
                품목 검색
                <span className="relative mt-1 block">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} aria-hidden="true" />
                  <input type="search" value={productSearch} onChange={event => setProductSearch(event.target.value)} placeholder={usingCatalogFallback ? '전체 활성 품목명 검색' : '품목명 검색'} className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                </span>
              </label>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70">
                <div className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-start">
                  <span className="w-16 shrink-0 pt-2 text-[11px] font-bold text-slate-500">제품 유형</span>
                  <div className="flex flex-1 flex-wrap gap-1.5" aria-label="제품 유형">
                    {categoryOptions.map(([category, count]) => (
                      <button
                        type="button"
                        key={category}
                        onClick={() => {
                          setProductCategoryFilter(category);
                          setVolumeFilter(null);
                        }}
                        aria-pressed={productCategoryFilter === category}
                        className={`min-h-9 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 ${
                          productCategoryFilter === category
                            ? 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {category} <span className={productCategoryFilter === category ? 'text-indigo-400' : 'text-slate-400'}>{count}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {volumeOptions.length > 1 && (
                  <div className="flex flex-col gap-2.5 border-t border-slate-200/80 px-3 py-2.5 sm:flex-row sm:items-start">
                    <span className="w-16 shrink-0 pt-1.5 text-[11px] font-medium text-slate-400">용량</span>
                    <div className="flex flex-1 flex-wrap gap-1.5" aria-label="용량 유형">
                      <button type="button" onClick={() => setVolumeFilter(null)} aria-pressed={volumeFilter === null}
                        className={`min-h-8 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${volumeFilter === null ? 'border-slate-400 bg-white text-slate-800' : 'border-transparent bg-transparent text-slate-500 hover:bg-white hover:text-slate-700'}`}>전체</button>
                      {volumeOptions.map(([vol, cnt]) => (
                        <button type="button" key={vol} onClick={() => setVolumeFilter(v => v === vol ? null : vol)} aria-pressed={volumeFilter === vol}
                          className={`min-h-8 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${volumeFilter === vol ? 'border-slate-400 bg-white text-slate-800' : 'border-transparent bg-transparent text-slate-500 hover:bg-white hover:text-slate-700'}`}>
                          {vol} <span className="text-slate-400">{cnt}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2">
                {shownProducts.length > 0 ? (
                  shownGroups.map(g => (
                  <React.Fragment key={g.key}>
                  {/* 타입이 하나뿐이면 머리를 안 붙인다 — 나눌 게 없는데 줄만 는다 */}
                  {shownGroups.length > 1 && (
                    <div className="flex items-center gap-2 pt-1 first:pt-0">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{g.label}</span>
                      <span className="text-[10px] font-bold text-slate-300">{g.list.length}</span>
                      <div className="flex-1 h-px bg-slate-100"/>
                    </div>
                  )}
                  {g.list.map(looseProduct => {
                    // 낱개↔박스 변형 — 이 낱개에 짝지어진 박스 품목들. 있으면 카드 안에서 전환.
                    // 낱개 + 이 거래처에 설정된 박스만 (모든 박스 규격을 다 띄우지 않는다)
                    const siblings = boxSiblings(looseProduct, items).filter(s => usingCatalogFallback || orderableForPartner(s.item));
                    const groupIds = [looseProduct.id, ...siblings.map(s => s.item.id)];
                    // 기본 변형 — 거의 박스로 주문하니 박스를 기본으로 연다. 박스가 여럿이면
                    // 가장 작은 개입(첫 번째)으로 과다주문 방지. 짝 박스가 없으면 낱개.
                    const defaultId = siblings.length > 0 ? siblings[0].item.id : looseProduct.id;
                    const activeId = variantChoice[looseProduct.id] && groupIds.includes(variantChoice[looseProduct.id])
                      ? variantChoice[looseProduct.id] : defaultId;
                    const product = items.find(p => p.id === activeId) ?? looseProduct;
                    // 낱개도 이 거래처에 팔릴 때만 토글에 (안 팔리면 박스만)
                    const variants = siblings.length > 0
                      ? [
                          ...((usingCatalogFallback || orderableForPartner(looseProduct)) ? [{ id: looseProduct.id, label: '낱개' }] : []),
                          ...siblings.map(s => ({ id: s.item.id, label: `${s.count}개입` })),
                        ]
                      : [];

                    const selection = selectedItems.find(i => String(i.itemId).trim() === String(product.id).trim());
                    const isSelected = !!selection;
                    const nv = splitNameVolume(product);
                    return (
                      <div key={looseProduct.id} onClick={() => toggleProduct(product.id)} className={`p-3 rounded-2xl border-2 transition-all cursor-pointer flex flex-col gap-2 ${isSelected ? 'bg-white border-indigo-500 shadow-md ring-1 ring-indigo-500' : 'bg-white border-slate-100 hover:border-indigo-200'}`}>
                        {variants.length > 1 && (
                          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                            {variants.map(v => (
                              <button key={v.id} type="button"
                                onClick={() => chooseVariant(looseProduct.id, v.id, groupIds)}
                                className={`px-2 py-0.5 rounded-lg text-[10px] font-black border transition-all ${
                                  activeId === v.id ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-400 hover:border-indigo-300'
                                }`}>{v.label}</button>
                            ))}
                          </div>
                        )}
                        {/* 이름 · 규격 · 수량을 **한 줄**에. 부자재는 그 아래 줄로 내린다 —
                            같은 칸에 넣으면 부자재가 길어질수록 수량칸이 아래로 밀려 내려갔다. */}
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-slate-800 leading-snug break-keep min-w-0 flex-1">{renderColoredName(nv.base)}</p>
                          {renderVolumeChip(nv.vol, product)}
                          {/* 수량 — 맨 우측. 숫자를 넣으면 담기고 비우면 빠진다. */}
                          {renderQtyBox(product)}
                        </div>
                        {(() => {
                          // 지금 고른 변형(낱개/박스)의 **BOM 그대로** 보여준다.
                          //  · 낱개를 고르면 라벨·병·캡,  박스를 고르면 겉박스·테이프
                          //  · 예전엔 언제나 낱개(looseProduct) BOM을 읽고 박스·테이프를 일부러 뺐다
                          //    → 박스를 골라도 낱개 부자재만 나왔다. 거래처 포장설정(boxTypeId) 경로도 폐기됐다.
                          // 내용물(반제품·원료·완제품)과 벌크는 뺀다 — 챙길 물건이 아니라 통에서 나온다.
                          const chips = packingSubmaterials(product.id, isBulkItem) as Item[];
                          if (chips.length === 0) return null;
                          return (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                              title={`부자재: ${chips.map(c => c.name).join(' · ')}`}>
                              {chips.map(c => (
                                <span key={c.id} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 shrink-0">
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${subDotClass(c)}`} />
                                  {c.name}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                        {isSelected && renderItemControls(product)}
                      </div>
                    );
                  })}
                  </React.Fragment>
                  ))
                ) : (
                   <div className="text-center py-10 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center space-y-2 animate-in fade-in">
                      <AlertCircle className="text-slate-300" size={32} />
                      <p className="text-slate-400 text-sm font-bold">주문 가능한 품목이 없습니다.</p>
                   </div>
                )}
              </div>
            </section>
          )}

          {selectedPartner && palletStocks.length > 0 && (
            <section className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 text-slate-700"><Layers size={16} /><h3 className="text-sm font-black">팔레트</h3></div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">선택</span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {palletStocks
                  .filter(ps => !ps.hidden)
                  .sort((a, b) => (a.name.toLowerCase().includes('kpp') ? 0 : 1) - (b.name.toLowerCase().includes('kpp') ? 0 : 1) || a.name.localeCompare(b.name, 'ko'))
                  .map(ps => {
                  const current = pallets.find(p => p.type === ps.id)?.quantity ?? 0;
                  const update = (qty: number) => {
                    const next = Math.max(0, qty);
                    setPallets(prev => {
                      const filtered = prev.filter(p => p.type !== ps.id);
                      return next > 0 ? [...filtered, { type: ps.id, quantity: next }] : filtered;
                    });
                  };
                  return (
                    <div key={ps.id} className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-2 ${current > 0 ? 'bg-white border-indigo-400 shadow-sm ring-1 ring-indigo-400' : 'bg-white border-slate-100'}`}>
                      <div className="flex flex-col min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate">{ps.name}</p>
                        {current > 0 && <p className="text-[9px] text-indigo-500 font-bold">{current}개 선택</p>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => update(current - 1)} className="w-6 h-6 flex items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 font-black text-sm">−</button>
                        <span className="w-6 text-center text-xs font-black text-slate-800">{current}</span>
                        <button type="button" onClick={() => update(current + 1)} className="w-6 h-6 flex items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 hover:bg-indigo-200 font-black text-sm">+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <div className="border-t border-slate-100 bg-slate-50/50 rounded-b-3xl">
          {shortages.length > 0 && (
            <div className="mx-6 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-2xl">
              <div className="flex items-center gap-1.5 text-amber-700 font-bold text-[11px] mb-1.5">
                <AlertCircle size={13} />
                부자재 재고 부족 — 주문 전 확인 필요
              </div>
              <ul className="space-y-0.5">
                {shortages.map(s => (
                  <li key={s.name} className="text-[10px] text-amber-600 font-medium">
                    {s.name}: 필요 {s.needed}개 · 재고 {s.stock}개 → <span className="font-black">{s.needed - s.stock}개 부족</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ModalActionFooter
            onCancel={onClose}
            onPrimary={handleSubmit}
            primaryLabel="주문 생성 완료"
            primaryDisabled={!orderDate || !deadline || !selectedPartner || selectedItems.length === 0}
          />
        </div>
      </div>
    </div>
  );
};

export default AddOrderModal;
