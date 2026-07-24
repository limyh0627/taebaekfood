
import React, { useState, useMemo, useEffect } from 'react';
import { X, Search, ShoppingBag, User, ArrowRight, AlertCircle, Truck, Store, LayoutGrid, Layers } from 'lucide-react';
import { Item, PartnerItem, OrderItem, Order, Partner, OrderSource, OrderPallet, PalletStock, ShippingRule } from '../types';
import { updateItem as updateItemDoc } from '../src/shared/services/firebaseService';
import { bomQty } from '../src/shared/bom';
import { unpackComponent, isBoxStockItem, boxSiblings } from '../src/shared/orderUnits';

interface AddOrderModalProps {
  items: Item[];
  partners: Partner[];
  partnerItems?: import('../src/shared/types').PartnerItem[];
  shippingRules?: ShippingRule[];
  palletStocks: PalletStock[];
  submaterials?: Item[];
  onClose: () => void;
  onSave: (_order: Omit<Order, 'id' | 'createdAt' | 'status'>) => void;
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

const matchClient = (name: string, query: string): boolean => {
  const q = query.trim();
  if (!q) return false;
  const isChosung = /^[ㄱ-ㅎ]+$/.test(q);
  if (isChosung) return getChosung(name).includes(decompound(q));
  return name.toLowerCase().includes(q.toLowerCase());
};

const AddOrderModal: React.FC<AddOrderModalProps> = ({ items, partners, partnerItems, shippingRules = [], palletStocks, submaterials: _submaterials, onClose, onSave }) => {
  const products = items;
  const submaterials = _submaterials ?? items.filter(i => i.category !== 'product');
  const partnerOut = (partnerItems ?? []).filter((pi: any) => pi.Direction === 'out');


  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClient, setSelectedClient] = useState<Partner | null>(null);
  const [selectedItems, setSelectedItems] = useState<{ itemId: string, quantity: number | '', isBoxUnit: boolean, unitsPerBox: number, boxType: string, boxSubId?: string, displaySize?: string }[]>([]);
  const [showHyangmiyu, setShowHyangmiyu] = useState(false);
  const [showGochutgaru, setShowGochutgaru] = useState(false);
  const [deadline, setDeadline] = useState(() => {
    const d = new Date(Date.now() + 86400000 * 3);
    const day = d.getDay();
    if (day === 6) d.setDate(d.getDate() + 2);
    else if (day === 0) d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [source, setSource] = useState<OrderSource>('일반');
  const [pallets, setPallets] = useState<OrderPallet[]>([]);
  const [isDelivery, setIsDelivery] = useState(false);

  const quickClients = useMemo(() => {
    const seen = new Set<string>();
    return [...partners]
      .filter(c => !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처')
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'))
      .filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true; })
      .slice(0, 15);
  }, [partners]);

  const filteredClients = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return partners.filter(c =>
      (!c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처') &&
      (matchClient(c.name || '', searchTerm) || (c.phone || '').includes(searchTerm))
    );
  }, [searchTerm, partners]);

  const getProductTypeOrder = (name: string): number => {
    if (/가루/.test(name)) return 3;
    if (/참기름|참진|참고소|참향/.test(name)) return 0;
    if (/들기름|들향|들진|들고소/.test(name)) return 1;
    if (/깨/.test(name)) return 2;
    return 4;
  };

  // 품목명 토큰 색상 — 기름 등급(분·특A·A·골드·원액)과 용기(병)를 색으로 구분해 비슷한 이름 헷갈림 방지
  const NAME_TOKEN_COLORS: Record<string, string> = {
    '병': 'text-teal-600',
    '분': 'text-blue-600',
    '특A': 'text-amber-800',
    'A': 'text-orange-500',
    '골드': 'text-yellow-500',
    '원액': 'text-purple-600',
  };
  const renderColoredName = (name: string): React.ReactNode => {
    const parts = name.split('/');
    if (parts.length === 1) return name;
    return parts.map((part, i) => {
      const color = NAME_TOKEN_COLORS[part.trim()];
      return (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-slate-300">/</span>}
          {color ? <span className={color}>{part}</span> : part}
        </React.Fragment>
      );
    });
  };

  // 용량 칩 — 이름 끝 용량(없으면 spec)을 뽑아 카드 오른쪽에 용량별 고정색 배지로 표시
  const VOLUME_CHIP_COLORS: Record<string, string> = {
    '180ml': 'bg-pink-100 text-pink-700',
    '300ml': 'bg-green-100 text-green-700',
    '350ml': 'bg-sky-100 text-sky-700',
    '1500ml': 'bg-indigo-100 text-indigo-700',
    '1750ml': 'bg-violet-100 text-violet-700',
    '1800ml': 'bg-red-100 text-red-700',
    '1kg': 'bg-amber-100 text-amber-800',
    '4kg': 'bg-orange-100 text-orange-700',
    '16.5kg': 'bg-cyan-100 text-cyan-700',
    '20kg': 'bg-emerald-100 text-emerald-800',
  };
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
  const renderVolumeChip = (vol: string | null) => vol ? (
    <span className={`shrink-0 text-[10px] font-black px-2 py-1 rounded-lg whitespace-nowrap ${VOLUME_CHIP_COLORS[vol] ?? 'bg-slate-100 text-slate-600'}`}>{vol}</span>
  ) : null;

  // 거래처 전용 품목 필터링 적용
  // 이 거래처가 이 품목을 주문할 수 있나 (거래처 등록·스마트스토어·통합품목)
  const orderableForClient = (p: Item): boolean => {
    if (!selectedClient) return false;
    if (p.partnerIds?.includes(selectedClient.id)) return true;
    if (selectedClient.type === '스마트스토어' && p.partnerIds?.includes('SMARTSTORE')) return true;
    if (selectedClient.type === '스마트스토어' && p.isSmartStore) return true;
    if (p.isRawMaterial && shippingRules.some(r => r.item_id === p.id && r.partner_id === selectedClient.id)) return true;
    return false;
  };
  // 낱개↔박스가 짝인데 거래처마다 노출 명단이 다르다 — 그룹의 아무 변형이나 주문 가능하면 낱개를 앵커로 띄운다
  const groupOrderable = (loose: Item): boolean =>
    orderableForClient(loose) || boxSiblings(loose, items).some(s => orderableForClient(s.item));

  const displayProducts = useMemo(() => {
    if (!selectedClient) return [];
    return products
      .filter(p => {
        if (p.archived) return false;
        const isOrderable = p.category === 'product' || p.category === 'giftset';
        if (!isOrderable || p.subtype === '향미유' || p.subtype === '고춧가루') return false;
        // 박스 변형은 목록에서 빼고 낱개 카드의 토글로만 접근 (짝 없이 홀로면 그대로 노출)
        if (isBoxStockItem(p) && items.some(x => !x.archived && x.id === (unpackComponent(p)?.itemId))) return false;
        return groupOrderable(p);
      })
      .sort((a, b) => {
        const diff = getProductTypeOrder(a.name) - getProductTypeOrder(b.name);
        return diff !== 0 ? diff : a.name.localeCompare(b.name, 'ko');
      });
  }, [products, selectedClient, shippingRules]);

  // 박스 개봉 — 낱개 부족 시 박스 −1 → 낱개 +count (재고는 라이브 구독으로 즉시 갱신)
  const [unpacking, setUnpacking] = useState(false);
  const handleUnpack = async (box: Item, target: Item) => {
    const count = unpackComponent(box)?.count ?? 0;
    if (count <= 0 || unpacking) return;
    if ((box.stock ?? 0) < 1) { alert(`${box.name} 재고(박스)가 없습니다.`); return; }
    if (!confirm(`${box.name} 1박스를 개봉해 "${target.name}" ${count}개로 전환할까요?\n(${box.name} −1박스, ${target.name} +${count}개)`)) return;
    setUnpacking(true);
    try {
      await updateItemDoc('items', box.id, { stock: (box.stock ?? 0) - 1 });
      await updateItemDoc('items', target.id, { stock: (target.stock ?? 0) + count });
    } catch (err) {
      console.error('[개봉] 실패:', err);
      alert('개봉 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setUnpacking(false);
    }
  };

  // 용량 필터 — 거래처 품목에 존재하는 용량들만 버튼으로 노출
  const [volumeFilter, setVolumeFilter] = useState<string | null>(null);
  useEffect(() => { setVolumeFilter(null); }, [selectedClient?.id]);
  const volumeOptions = useMemo(() => {
    const m = new Map<string, number>();
    displayProducts.forEach(p => { const { vol } = splitNameVolume(p); if (vol) m.set(vol, (m.get(vol) ?? 0) + 1); });
    const rank = (v: string) => {
      const n = parseFloat(v);
      if (v.endsWith('ml')) return n;
      if (v.endsWith('kg')) return 1000000 + n * 1000;
      if (v.endsWith('l')) return n * 1000;
      return 1000000 + n; // g
    };
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [displayProducts]);
  const shownProducts = volumeFilter ? displayProducts.filter(p => splitNameVolume(p).vol === volumeFilter) : displayProducts;

  // 스마트스토어 제외 거래처 → 향미유 목록
  const displayHyangmiyu = useMemo(() => {
    if (!selectedClient || selectedClient.type === '스마트스토어') return [];
    return items.filter(p => p.subtype === '향미유');
  }, [products, selectedClient]);

  // 스마트스토어 제외 거래처 → 고춧가루 목록
  const displayGochutgaru = useMemo(() => {
    if (!selectedClient || selectedClient.type === '스마트스토어') return [];
    return items.filter(p => p.subtype === '고춧가루');
  }, [products, selectedClient]);

  // 현재 선택된 품목 기준 부자재 재고 부족 계산
  const shortages = useMemo(() => {
    const usage: Record<string, { name: string; needed: number; stock: number }> = {};
    // (테이프는 재고 차감·부족 경고 대상에서 제외 — 사용자 요청)
    for (const item of selectedItems) {
      const qty = typeof item.quantity === 'number' ? item.quantity : 0;
      if (qty <= 0) continue;
      const product = items.find(p => p.id === item.itemId);
      if (!product) continue;

      if (product.subtype === '향미유') {
        const sub = submaterials.find(s => s.id === product.id);
        if (sub) {
          const actualQty = item.isBoxUnit && item.unitsPerBox > 0 ? qty * item.unitsPerBox : qty;
          const needed = Math.ceil(actualQty / (product.boxSize || 1));
          if (!usage[sub.id]) usage[sub.id] = { name: sub.name, needed: 0, stock: sub.stock };
          usage[sub.id].needed += needed;
        }
        continue;
      }

      if (product.category !== 'product' || !selectedClient) continue;
      const actualQty = item.isBoxUnit && item.unitsPerBox > 0 ? qty * item.unitsPerBox : qty;

      // 통합 품목(isRawMaterial): shipping_rule 기반으로 박스/테이프 부자재 조회
      if (product.isRawMaterial) {
        const rule = shippingRules.find(r => r.item_id === product.id && r.partner_id === selectedClient.id);
        if (rule) {
          const boxSize = rule.qty_per_box || 1;
          const boxesNeeded = Math.ceil(actualQty / boxSize);
          if (rule.box_item_id) {
            const sub = submaterials.find(sm => sm.id === rule.box_item_id);
            if (sub) {
              if (!usage[sub.id]) usage[sub.id] = { name: sub.name, needed: 0, stock: sub.stock };
              usage[sub.id].needed += boxesNeeded;
            }
          }
        }
        continue;
      }

      const pc = partnerOut.find(p => p.itemId === product.id && p.partnerId === selectedClient.id);
      const boxSize = pc?.qtyPerBox || item.unitsPerBox || 1;
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
      for (const s of (product.submaterials || [])) {
        if (s.category === 'box') continue;   // 겉박스는 shipping_rule 경로 · 테이프는 BOM 수량 0으로
        const sub = submaterials.find(sm => sm.id === s.id);
        if (!sub) continue;
        if (!usage[sub.id]) usage[sub.id] = { name: sub.name, needed: 0, stock: sub.stock };
        usage[sub.id].needed += stockQty * bomQty(s);   // 재고 1단위 × BOM 수량
      }
    }
    return Object.values(usage).filter(v => v.needed > v.stock);
  }, [selectedItems, selectedClient, products, partnerOut, submaterials, shippingRules]);

  // 거래처별 박스 설정 조회 — shippingRules 기반
  const getClientBoxConfigs = (itemId: string, partnerId?: string): { unitsPerBox: number; boxType: string; boxSubId?: string }[] => {
    if (partnerId) {
      const rule = shippingRules.find(r => r.item_id === itemId && r.partner_id === partnerId);
      if (rule?.qty_per_box) {
        return [{ unitsPerBox: rule.qty_per_box, boxType: rule.box_item_id ?? '', boxSubId: rule.box_item_id }];
      }
    }
    const p = items.find(pr => pr.id === itemId);
    if (p?.defaultBoxConfig?.unitsPerBox) return [p.defaultBoxConfig];
    return [];
  };

  // 품목의 거래처별 포장 규격 목록 (shipping_rule 기반)
  const getItemCustomerConfigs = (itemId: string, partnerId?: string) => {
    if (!partnerId) return [];
    return shippingRules.filter(r => r.item_id === itemId && (r.partner_id === partnerId || !r.partner_id));
  };

  // 선택 1건을 어떻게 초기화할지 — 토글·변형 전환에서 공유
  const buildSelection = (itemId: string): typeof selectedItems[0] => {
    const product = items.find(p => p.id === itemId);
    // 박스 변형 품목 자체는 재고 단위가 '박스 1개'다. 배송 포장(shipping_rule)을 얹지 않는다
    // — 수량 = 박스 개수, 그대로 그 품목 재고에서 뺀다.
    if (product && isBoxStockItem(product)) {
      return { itemId, quantity: 1, isBoxUnit: false, unitsPerBox: 0, boxType: '' };
    }
    const isHyangmiyu = product?.subtype === '향미유';
    if (product?.isRawMaterial && selectedClient) {
      const rules = getItemCustomerConfigs(itemId, selectedClient.id);
      if (rules.length >= 1) {
        const rule = rules[0];
        const qpb = rule.qty_per_box ?? 0;
        return { itemId, quantity: 1, isBoxUnit: qpb > 1, unitsPerBox: qpb, boxType: rule.box_item_id ?? '', boxSubId: rule.box_item_id || undefined, displaySize: product?.netContent };
      }
    }
    const configs = getClientBoxConfigs(itemId, selectedClient?.id);
    const first = configs[0] ?? { unitsPerBox: isHyangmiyu ? 12 : 0, boxType: '', boxSubId: undefined };
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

  const handleQuantityInput = (itemId: string, value: string) => {
    const qty = value === '' ? '' : parseInt(value) || '';
    setSelectedItems(prev => prev.map(item =>
      item.itemId === itemId ? { ...item, quantity: qty } : item
    ));
  };

  const handleQuantityStep = (itemId: string, delta: number) => {
    setSelectedItems(prev => prev.map(item => {
      if (item.itemId !== itemId) return item;
      const current = typeof item.quantity === 'number' ? item.quantity : 1;
      return { ...item, quantity: Math.max(1, current + delta) };
    }));
  };

  const updateItem = (itemId: string, patch: Partial<typeof selectedItems[0]>) => {
    setSelectedItems(prev => prev.map(i => i.itemId === itemId ? { ...i, ...patch } : i));
  };

  const renderItemControls = (product: { id: string; unit?: string; price: number; category?: string }) => {
    const selection = selectedItems.find(i => i.itemId === product.id);
    if (!selection) return null;
    const uPerBox = selection.unitsPerBox ?? 0;
    const boxQty = typeof selection.quantity === 'number' ? selection.quantity : 0;
    const totalUnits = selection.isBoxUnit && uPerBox > 0 ? boxQty * uPerBox : boxQty;
    const availableConfigs = getClientBoxConfigs(product.id, selectedClient?.id);
    const isHyangmiyu = product.category === '향미유';
    const isBoxMode = selection.isBoxUnit && uPerBox > 0;
    const icConfigs = getItemCustomerConfigs(product.id, selectedClient?.id);
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

        {/* 박스 모드 배지 */}
        {(uPerBox > 0 || isHyangmiyu) && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const qty = typeof selection.quantity === 'number' && selection.quantity > 0 ? selection.quantity : 1;
                if (selection.isBoxUnit) {
                  updateItem(product.id, { isBoxUnit: false, quantity: qty * (uPerBox || 12) });
                } else {
                  updateItem(product.id, { isBoxUnit: true, quantity: Math.ceil(qty / (uPerBox || 12)) });
                }
              }}
              className={`text-[10px] font-black px-2.5 py-0.5 rounded-lg border transition-all shrink-0 ${
                isBoxMode
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-300'
              }`}
            >
              BOX
            </button>
            {isBoxMode && (
              <span className="text-[9px] font-black text-indigo-500 bg-indigo-100 px-1.5 py-0.5 rounded">
                박스 단위
              </span>
            )}
            {!isBoxMode && (
              <span className="text-[9px] font-black text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                낱개 단위
              </span>
            )}
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

        {/* 수량 입력 */}
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => handleQuantityStep(product.id, -1)} className="text-sm font-black w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 shrink-0">−</button>
          <input
            type="number"
            value={selection.quantity === '' ? '' : selection.quantity}
            onChange={(e) => handleQuantityInput(product.id, e.target.value)}
            className={`text-xs font-black w-full text-center text-slate-800 bg-white border rounded-lg outline-none py-0.5 ${
              isBoxMode ? 'border-indigo-200' : 'border-slate-200'
            }`}
          />
          <button type="button" onClick={() => handleQuantityStep(product.id, 1)} className="text-sm font-black w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 shrink-0">+</button>
          <span className={`text-[10px] font-bold shrink-0 ${isBoxMode ? 'text-indigo-500' : 'text-slate-400'}`}>
            {isBoxMode ? '박스' : (product.unit || '개')}
          </span>
        </div>

        {/* 합계 */}
        {isBoxMode && boxQty > 0 && (
          <div className="flex items-center justify-end px-1">
            <span className="text-[9px] font-black text-indigo-500">× {uPerBox}개 = {totalUnits}개</span>
          </div>
        )}

        {/* 낱개 재고 부족 → 박스 개봉 안내 (unpackTo로 이 품목을 채우는 박스 품목 중 선택) */}
        {(() => {
          const full = items.find(i => i.id === product.id);
          if (!full) return null;
          // 이 낱개를 BOM에 물고 있는 박스 품목들 (옛 unpackTo도 폴백으로 인식)
          const sources = items.filter(b => !b.archived && unpackComponent(b)?.itemId === full.id);
          if (sources.length === 0) return null;
          const shortBy = totalUnits - (full.stock ?? 0);
          if (shortBy <= 0) return null;
          return (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-2 space-y-1.5">
              <p className="text-[10px] font-black text-amber-700">낱개 재고 {full.stock ?? 0}개 · {shortBy}개 부족 — 박스를 개봉하세요</p>
              <div className="flex flex-wrap gap-1">
                {sources.map(box => (
                  <button
                    key={box.id} type="button" disabled={unpacking || (box.stock ?? 0) < 1}
                    onClick={(e) => { e.stopPropagation(); handleUnpack(box, full); }}
                    className="text-[10px] font-black px-2 py-1 rounded-lg bg-white border border-amber-300 text-amber-700 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {box.name} 개봉 +{unpackComponent(box)!.count} <span className="opacity-60">(박스 {box.stock ?? 0})</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    );
  };


  const handleSubmit = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!selectedClient || selectedItems.length === 0) return;

    const orderItems: OrderItem[] = selectedItems.flatMap(item => {
      if (!item.quantity || item.quantity <= 0) return [];
      const product = items.find(p => p.id === item.itemId)
        ?? items.find(p => String(p.id).trim() === String(item.itemId).trim());
      if (!product) return [];
      const uPerBox = item.unitsPerBox ?? 0;
      const actualQty = item.isBoxUnit && uPerBox > 0 ? item.quantity * uPerBox : item.quantity;
      return [{
        itemId: item.itemId,
        name: product.name || '알 수 없는 상품',
        quantity: actualQty,
        price: product.price || 0,
        ...(item.isBoxUnit && uPerBox > 0 ? { isBoxUnit: true, boxQuantity: item.quantity, unitsPerBox: uPerBox, boxType: item.boxType, ...(item.boxSubId ? { boxSubId: item.boxSubId } : {}) } : {}),
        ...(item.displaySize ? { displaySize: item.displaySize } : {}),
      }];
    });

    const totalAmount = selectedItems.reduce((sum, item) => {
      if (!item.quantity || item.quantity <= 0) return sum;
      const product = items.find(p => String(p.id).trim() === String(item.itemId).trim());
      const uPerBox = item.unitsPerBox ?? 0;
      const actualQty = item.isBoxUnit && uPerBox > 0 ? item.quantity * uPerBox : item.quantity;
      return sum + (product ? (product.price || 0) * actualQty : 0);
    }, 0);

    onSave({
      partnerId: selectedClient.id,
      partnerName: selectedClient.name || '이름 없음',
      email: selectedClient.email || '',
      items: orderItems,
      totalAmount,
      deliveryDate: new Date(deadline).toISOString(),
      source: (isDelivery && source === '일반') ? '택배' : source,
      pallets: pallets.filter(p => p.quantity > 0),
      region: selectedClient.region || '미지정',
      ...(isDelivery ? { deliveryBoxes: [] } : {}),
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-6">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={onClose} />

      <div className="relative bg-white w-full sm:max-w-3xl rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col h-[92dvh] sm:h-[85vh] sm:max-h-[900px] animate-in slide-in-from-bottom sm:zoom-in-95 duration-300">
        <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10 rounded-t-3xl">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-lg shadow-indigo-100"><ShoppingBag size={20} /></div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">신규 주문 생성</h3>
              <p className="text-xs text-slate-500">주문할 품목과 수량을 확인하세요.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 sm:space-y-8 custom-scrollbar">
          <section className="space-y-4">
            <div className="flex items-center space-x-2 text-slate-400"><User size={16} /><span className="text-xs font-bold uppercase tracking-widest">거래처 정보</span></div>

            {!selectedClient ? (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input type="text" placeholder="거래처명 또는 초성 검색 (예: ㅌㅂ)..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-4 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />

                  {filteredClients.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-100 rounded-2xl shadow-xl z-20 overflow-hidden max-h-80 overflow-y-auto custom-scrollbar">
                      {filteredClients.map(partner => (
                        <button key={partner.id} onClick={() => { setSelectedClient(partner); setSource(partner.type as OrderSource); setSearchTerm(''); setIsDelivery(partner.type === '택배' || partner.type === '스마트스토어'); }} className="w-full px-5 py-3 text-left hover:bg-indigo-50 flex items-center justify-between group">
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

                {!searchTerm && quickClients.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest px-1">자주 사용하는 거래처</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {quickClients.map(partner => {
                        const typeConfig = {
                          '일반': { icon: User, color: 'bg-indigo-100 text-indigo-600' },
                          '택배': { icon: Truck, color: 'bg-pink-100 text-pink-600' },
                          '스마트스토어': { icon: Store, color: 'bg-lime-100 text-lime-600' },
                        }[partner.type] || { icon: LayoutGrid, color: 'bg-slate-100 text-slate-600' };
                        const TypeIcon = typeConfig.icon;
                        return (
                          <button
                            key={partner.id}
                            onClick={() => { setSelectedClient(partner); setSource(partner.type as OrderSource); setIsDelivery(partner.type === '택배' || partner.type === '스마트스토어'); }}
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
              <div className="bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-xl flex items-center gap-2">
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h4 className="font-black text-indigo-900 text-sm truncate">{selectedClient.name}</h4>
                    <span className="px-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-[8px] font-black shrink-0">{selectedClient.type}</span>
                  </div>
                  {selectedClient.region && <p className="text-[10px] text-indigo-500 font-medium">{selectedClient.region}</p>}
                </div>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="text-[10px] font-bold text-indigo-700 bg-white border border-indigo-200 rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-indigo-400 shrink-0"
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsDelivery(prev => !prev)}
                    className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[10px] font-bold transition-all ${isDelivery ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200 hover:border-indigo-300'}`}
                  >
                    <Truck size={11} />
                    택배
                  </button>
                  <button onClick={() => { setSelectedClient(null); setSelectedItems([]); }} className="text-[10px] font-bold text-indigo-400 hover:text-indigo-600 underline whitespace-nowrap">변경</button>
                </div>
              </div>
            )}
          </section>

          {selectedClient && (
            <section className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-slate-400"><ShoppingBag size={16} /><span className="text-xs font-bold uppercase tracking-widest">주문 품목 선택</span></div>
              </div>
              {volumeOptions.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => setVolumeFilter(null)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-black transition-all ${volumeFilter === null ? 'bg-slate-700 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-400'}`}>전체</button>
                  {volumeOptions.map(([vol, cnt]) => (
                    <button type="button" key={vol} onClick={() => setVolumeFilter(v => v === vol ? null : vol)}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-black transition-all ${volumeFilter === vol ? `${VOLUME_CHIP_COLORS[vol] ?? 'bg-slate-200 text-slate-700'} ring-2 ring-indigo-400` : 'bg-white border border-slate-200 text-slate-500 hover:border-indigo-300'}`}>
                      {vol} <span className="opacity-50">{cnt}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {shownProducts.length > 0 ? (
                  shownProducts.map(looseProduct => {
                    // 낱개↔박스 변형 — 이 낱개에 짝지어진 박스 품목들. 있으면 카드 안에서 전환.
                    // 낱개 + 이 거래처에 설정된 박스만 (모든 박스 규격을 다 띄우지 않는다)
                    const siblings = boxSiblings(looseProduct, items).filter(s => orderableForClient(s.item));
                    const groupIds = [looseProduct.id, ...siblings.map(s => s.item.id)];
                    // 기본 변형 — 낱개가 이 거래처에 안 팔리면 팔리는 박스로 연다
                    const defaultId = orderableForClient(looseProduct)
                      ? looseProduct.id
                      : (siblings[0]?.item.id ?? looseProduct.id);
                    const activeId = variantChoice[looseProduct.id] && groupIds.includes(variantChoice[looseProduct.id])
                      ? variantChoice[looseProduct.id] : defaultId;
                    const product = items.find(p => p.id === activeId) ?? looseProduct;
                    // 낱개도 이 거래처에 팔릴 때만 토글에 (안 팔리면 박스만)
                    const variants = siblings.length > 0
                      ? [
                          ...(orderableForClient(looseProduct) ? [{ id: looseProduct.id, label: '낱개' }] : []),
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
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col min-w-0 flex-1">
                            <p className="text-xs font-bold text-slate-800 truncate">{renderColoredName(nv.base)}</p>
                            {(() => {
                              const label = product.submaterials?.find(s => s.category === '라벨')?.name;
                              // 칩과 중복되는 spec은 아랫줄에서 생략
                              const vol = product.spec && (!nv.vol || normVolume(product.spec) !== nv.vol) ? product.spec : null;
                              const parts = [label, vol].filter(Boolean);
                              const pc = selectedClient ? partnerOut.find(p => p.itemId === product.id && p.partnerId === selectedClient.id) : null;
                              const boxName = pc?.boxTypeId ? items.find(p => p.id === pc.boxTypeId)?.name : null;
                              const tapeName = pc?.tapeTypeId ? items.find(p => p.id === pc.tapeTypeId)?.name : null;
                              const subParts = [boxName, tapeName].filter(Boolean);
                              return (
                                <>
                                  {parts.length > 0 && <p className="text-[9px] text-slate-400 font-bold truncate leading-tight">{parts.join(' · ')}</p>}
                                  {subParts.length > 0 && <p className="text-[9px] text-indigo-400 font-bold truncate leading-tight">{subParts.join(' · ')}</p>}
                                </>
                              );
                            })()}
                          </div>
                          {renderVolumeChip(nv.vol)}
                        </div>
                        {isSelected && renderItemControls(product)}
                      </div>
                    );
                  })
                ) : (
                   <div className="text-center py-10 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center space-y-2 animate-in fade-in">
                      <AlertCircle className="text-slate-300" size={32} />
                      <p className="text-slate-400 text-sm font-bold">주문 가능한 품목이 없습니다.</p>
                   </div>
                )}
              </div>
            </section>
          )}

          {selectedClient && displayHyangmiyu.length > 0 && (
            <section className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-500">
              <button type="button" onClick={() => setShowHyangmiyu(p => !p)} className="flex items-center justify-between w-full text-slate-400 hover:text-slate-600 transition-all">
                <div className="flex items-center space-x-2">
                  <ShoppingBag size={16} />
                  <span className="text-xs font-bold uppercase tracking-widest">향미유</span>
                </div>
                <span className="text-[10px] font-bold">{showHyangmiyu ? '▲' : '▼'}</span>
              </button>
              {showHyangmiyu && <div className="grid grid-cols-2 gap-2">
                {displayHyangmiyu.map(product => {
                  const selection = selectedItems.find(i => String(i.itemId).trim() === String(product.id).trim());
                  const isSelected = !!selection;
                  return (
                    <div key={product.id} onClick={() => toggleProduct(product.id)} className={`p-3 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2 ${isSelected ? 'bg-white border-indigo-500 shadow-md ring-1 ring-indigo-500' : 'bg-white border-slate-100 hover:border-indigo-200'}`}>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-slate-800 truncate flex-1 min-w-0">{renderColoredName(splitNameVolume(product).base)}</p>
                        {renderVolumeChip(splitNameVolume(product).vol)}
                      </div>
                      {isSelected && renderItemControls(product)}
                    </div>
                  );
                })}
              </div>}
            </section>
          )}

          {selectedClient && displayGochutgaru.length > 0 && (
            <section className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-500">
              <button type="button" onClick={() => setShowGochutgaru(p => !p)} className="flex items-center justify-between w-full text-slate-400 hover:text-slate-600 transition-all">
                <div className="flex items-center space-x-2">
                  <ShoppingBag size={16} />
                  <span className="text-xs font-bold uppercase tracking-widest">고춧가루</span>
                </div>
                <span className="text-[10px] font-bold">{showGochutgaru ? '▲' : '▼'}</span>
              </button>
              {showGochutgaru && <div className="grid grid-cols-2 gap-2">
                {displayGochutgaru.map(product => {
                  const isSelected = selectedItems.some(i => String(i.itemId).trim() === String(product.id).trim());
                  return (
                    <div key={product.id} onClick={() => toggleProduct(product.id)} className={`p-3 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2 ${isSelected ? 'bg-white border-indigo-500 shadow-md ring-1 ring-indigo-500' : 'bg-white border-slate-100 hover:border-indigo-200'}`}>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-slate-800 truncate flex-1 min-w-0">{renderColoredName(splitNameVolume(product).base)}</p>
                        {renderVolumeChip(splitNameVolume(product).vol)}
                      </div>
                      {isSelected && renderItemControls(product)}
                    </div>
                  );
                })}
              </div>}
            </section>
          )}

          {selectedClient && palletStocks.length > 0 && (
            <section className="space-y-3 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex items-center space-x-2 text-slate-400">
                <Layers size={16} />
                <span className="text-xs font-bold uppercase tracking-widest">팔레트</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
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
          <div className="p-6 grid grid-cols-2 gap-4">
            <button onClick={onClose} className="py-4 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200">취소</button>
            <button disabled={!selectedClient || selectedItems.length === 0} onClick={handleSubmit} className="py-4 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">주문 완료</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddOrderModal;
