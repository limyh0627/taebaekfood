import React, { useState, useRef, useEffect } from 'react';
import { X, Package, Tag, Box, Layers, Plus, Building2, Check, Trash2 } from 'lucide-react';
import { Item, InventoryCategory, ItemSubtype, Partner, ClientBoxConfig, PartnerItem, ShippingRule } from '../types';

interface ProductModalProps {
  initialData?: Item;
  allSubmaterials?: Item[];
  items?: Item[];
  partners?: Partner[];
  partnerItems?: import('../src/shared/types').PartnerItem[];
  shippingRules?: ShippingRule[];
  onClose: () => void;
  onSave: (_product: Item) => void;
  onSaveShippingRule?: (rule: Partial<ShippingRule> & { id: string }) => Promise<void>;
  onAddShippingRule?: (rule: Omit<ShippingRule, 'id'>) => Promise<void>;
  onUpsertPartnerItem?: (ps: PartnerItem) => void;
  onDeletePartnerItem?: (id: string) => void;
  onAddSubmaterial?: (name: string, category: string) => Promise<string>;
}

const CAT_NORM: Record<string, string> = {
  'Cap': '마개', 'Tape': '테이프', '박스': '박스', '용기': '용기', '라벨': '라벨', '마개': '마개', '테이프': '테이프',
  'cap': '마개', 'tape': '테이프', 'box': '박스', 'container': '용기', 'label': '라벨',
};
const normCat = (c?: string) => c ? (CAT_NORM[c] || c) : '';

const CATEGORY_LABELS: Record<string, string> = {
  product: '완제품', goods: '상품', wip: '반제품', raw: '원료',
  giftset: '선물세트', submaterial: '부자재', shipping: '배송',
};

const GOODS_SUBTYPES: ItemSubtype[] = ['향미유', '고춧가루', '참기름', '들기름', '참깨', '들깨', '검정깨'];
const SUBMATERIAL_SUBTYPES: ItemSubtype[] = ['마개', '용기', '박스', '테이프', '라벨'];

const PRESET_PUMOK = [
  '시골향참기름1', '시골향참기름2', '시골향참기름3', '시골향참기름4',
  '시골향들기름1', '시골향들기름2',
  '하남댁참기름', '하남댁들기름', '하남댁맑음들기름',
  '가득찬순참기름',
  '해달참기름', '해달들기름',
  '시골집참기름(해내음)',
  '토마토참기름',
  '새싹참기름', '새싹들기름',
  '시골향볶음참깨', '시골향들깨가루', '시골향탈피들깨가루', '시골향볶음검정참깨',
];

const PUMOK_VOLUMES: Record<string, string[]> = {
  '시골향참기름1': ['180ml','300ml','350ml','1500ml','1750ml','1800ml','16.5kg'],
  '시골향참기름2': ['300ml','350ml','1500ml','1750ml','1800ml'],
  '시골향참기름3': ['300ml','350ml','1500ml','1750ml','1800ml','16.5kg'],
  '시골향참기름4': ['300ml','350ml','1500ml','1750ml','1800ml'],
  '시골향들기름1': ['270ml','350ml','1800ml','16.5kg'],
  '시골향들기름2': ['180ml','300ml','350ml','1500ml','1750ml','1800ml'],
  '하남댁참기름':  ['300ml','1750ml'],
  '하남댁들기름':  ['300ml','1750ml'],
  '하남댁맑음들기름': ['300ml'],
  '가득찬순참기름': ['300ml','1800ml'],
  '해달참기름':    ['350ml'],
  '해달들기름':    ['350ml'],
  '시골집참기름(해내음)': ['1800ml'],
  '토마토참기름':  ['300ml','500ml','1800ml'],
  '새싹참기름':   ['300ml'],
  '새싹들기름':   ['300ml'],
  '시골향볶음참깨': ['140g','200g','350g','500g','1kg','20kg','25kg'],
  '시골향들깨가루': ['1kg','4kg','20kg','25kg'],
  '시골향탈피들깨가루': ['400g','1kg','20kg','25kg'],
  '시골향볶음검정참깨': ['1kg','20kg','25kg'],
};

const ProductModal: React.FC<ProductModalProps> = ({ initialData, allSubmaterials = [], items, partners = [], partnerItems, shippingRules = [], onClose, onSave, onSaveShippingRule, onAddShippingRule, onUpsertPartnerItem, onDeletePartnerItem, onAddSubmaterial }) => {
  const partnerOut = (partnerItems ?? []).filter((pi: any) => pi.Direction === 'out');
  const partnerIn = (partnerItems ?? []).filter((pi: any) => pi.Direction === 'in');

  const [formData, setFormData] = useState(() => ({
    name: initialData?.name || '',
    category: (initialData?.category as InventoryCategory) || 'product',
    subtype: (initialData?.subtype as ItemSubtype | '') || '',
    price: initialData?.price || 0,
    stock: initialData?.stock || 0,
    minStock: initialData?.minStock || 10,
    unit: initialData?.unit || '개',
    freightType: (initialData?.freightType || 's') as 's' | 'a' | 'b' | 'c' | 'd' | 'e',
    boxSize: initialData?.boxSize ?? 0,
    defaultBoxConfig: initialData?.defaultBoxConfig ?? (
      (initialData?.boxSize ?? 0) > 0
        ? { boxType: '', unitsPerBox: initialData!.boxSize! }
        : { boxType: '', unitsPerBox: 0 }
    ),
    partnerBoxConfigs: initialData?.partnerBoxConfigs ?? [] as ClientBoxConfig[],
    spec: initialData?.spec || '',
    품목: initialData?.품목 || '',
    isSmartStore: initialData?.isSmartStore ?? false,
    partnerIds: initialData?.partnerIds ?? (initialData?.partnerId ? [initialData.partnerId] : []),
    inPartnerIds: partnerIn
      .filter(pi => pi.Item_ID === initialData?.id)
      .map(pi => (pi.partnerId ?? pi.Partner_ID))
      .filter(Boolean) as string[],
    submaterials: (initialData?.submaterials || []).map(s => ({
      ...s,
      category: normCat(s.category)
    }))
  }));

  const [partnerSearch, setClientSearch] = useState('');
  const [inboundPartnerSearch, setSupplierSearch] = useState('');
  const [showPumokDrop, setShowPumokDrop] = useState(false);
  const [pumokWarn, setPumokWarn] = useState(false);
  const [expandedBoxClient, setExpandedBoxClient] = useState<string | null>(null);
  const [boxClientSearch, setBoxClientSearch] = useState('');
  const [volNum, setVolNum] = useState('');
  const [volUnit, setVolUnit] = useState<'ml' | 'kg'>('ml');
  const [customVols, setCustomVols] = useState<string[]>(initialData?.spec ? [initialData.spec] : []);
  const [bomSearch, setBomSearch] = useState('');
  const [bomPickerOpen, setBomPickerOpen] = useState(false);
  const [bomCatFilter, setBomCatFilter] = useState<string>('all');
  const [showBoxClientDrop, setShowBoxClientDrop] = useState(false);

  // 거래처별 포장 설정 (shipping_rule 기반, partner_item 필드 fallback)
  const [partnerPackagingConfigs, setClientPackagingConfigs] = useState<Record<string, { boxTypeId?: string; qtyPerBox?: number; tapeTypeId?: string }>>(() => {
    const map: Record<string, { boxTypeId?: string; qtyPerBox?: number; tapeTypeId?: string }> = {};
    if (initialData) {
      partnerOut.filter(pi => pi.Item_ID === initialData.id).forEach(pc => {
        const rule = shippingRules.find(r => r.item_id === initialData.id && r.partner_id === pc.Partner_ID);
        map[pc.Partner_ID] = {
          boxTypeId: rule?.box_item_id ?? pc.boxTypeId,
          qtyPerBox: rule?.qty_per_box ?? pc.qtyPerBox,
          tapeTypeId: rule?.tape_item_id ?? pc.tapeTypeId,
        };
      });
    }
    return map;
  });
  const boxClientSearchRef = useRef<HTMLDivElement>(null);
  const pumokRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxClientSearchRef.current && !boxClientSearchRef.current.contains(e.target as Node))
        setShowBoxClientDrop(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pumokRef.current && !pumokRef.current.contains(e.target as Node))
        setShowPumokDrop(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pumokOptions = [
    ...new Set([
      ...(items ?? []).map(p => p.품목).filter(Boolean) as string[],
      ...PRESET_PUMOK,
    ])
  ].filter(v => !formData.품목 || v.toLowerCase().includes(formData.품목.toLowerCase()));

  const inboundPartners = partners.filter(c =>
    c.partnerType === '매입처' || c.partnerType === '매출+매입처'
  );
  const salesClients = partners.filter(c =>
    !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처'
  );

  const categories: InventoryCategory[] = ['product', 'goods', 'wip', 'raw', 'giftset', 'submaterial', 'shipping'];

  const handleSubmit = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!formData.name) return;
    if (formData.category === 'product' && !formData.품목) { setPumokWarn(true); return; }

    const isProductCategory = ['product', 'goods', 'wip', 'raw', 'giftset'].includes(formData.category);
    const hasBoxConfig = formData.defaultBoxConfig.unitsPerBox > 0;

    const finalProduct: Item = {
      id: initialData ? initialData.id : `p-${Date.now()}`,
      name: formData.name,
      category: formData.category,
      ...(formData.subtype && { subtype: formData.subtype }),
      price: formData.price,
      stock: initialData?.stock ?? 0,
      minStock: formData.category === 'product' ? 0 : formData.minStock,
      unit: formData.unit,
      image: initialData?.image || '',
      submaterials: ['product', 'giftset', 'shipping'].includes(formData.category)
        ? formData.submaterials
        : (formData.submaterials.length > 0 ? formData.submaterials : (initialData?.submaterials || [])),
      ...(formData.category === 'box' && { freightType: formData.freightType, boxSize: formData.boxSize }),
      ...(isProductCategory && hasBoxConfig && { defaultBoxConfig: formData.defaultBoxConfig }),
      ...(isProductCategory && formData.partnerBoxConfigs.length > 0 && { partnerBoxConfigs: formData.partnerBoxConfigs }),
      ...(formData.spec && { spec: formData.spec }),
      ...(formData.품목 && { 품목: formData.품목 }),
      ...(formData.category === 'product' && formData.partnerIds.length > 0 && { partnerIds: formData.partnerIds }),
      ...(formData.category === 'product' && { isSmartStore: formData.isSmartStore }),
    };

    onSave(finalProduct);

    // PartnerItem 다중 upsert/삭제 — partner_item Direction='in'
    if (onUpsertPartnerItem) {
      const itemId = finalProduct.id;
      const prevIn = partnerIn.filter(pi => pi.Item_ID === itemId);
      // 선택된 매입거래처 upsert (기존 doc/단가 유지)
      for (const partnerId of formData.inPartnerIds) {
        const existing = prevIn.find(pi => (pi.partnerId ?? pi.Partner_ID) === partnerId);
        onUpsertPartnerItem({ id: existing?.id ?? `${itemId}_${partnerId}_in`, Partner_ID: partnerId, Item_ID: itemId, Direction: 'in', Standard_Price: existing?.Standard_Price, taxType: existing?.taxType });
      }
      // 해제된 매입거래처 삭제
      if (onDeletePartnerItem) {
        for (const pi of prevIn) {
          const pid = pi.partnerId ?? pi.Partner_ID;
          if (pid && !formData.inPartnerIds.includes(pid)) onDeletePartnerItem(pi.id);
        }
      }
    }

    // 거래처별 포장 설정 → shipping_rule 컬렉션에 저장
    if ((onSaveShippingRule || onAddShippingRule) && finalProduct.partnerIds?.length) {
      const pid = finalProduct.id;
      for (const partnerId of finalProduct.partnerIds) {
        const cfg = partnerPackagingConfigs[partnerId] ?? {};
        if (!cfg.boxTypeId && !cfg.qtyPerBox && !cfg.tapeTypeId) continue;
        const existing = shippingRules.find(r => r.item_id === pid && r.partner_id === partnerId);
        if (existing && onSaveShippingRule) {
          await onSaveShippingRule({ id: existing.id, box_item_id: cfg.boxTypeId ?? '', qty_per_box: cfg.qtyPerBox ?? 0, tape_item_id: cfg.tapeTypeId });
        } else if (!existing && onAddShippingRule && cfg.boxTypeId) {
          await onAddShippingRule({ item_id: pid, partner_id: partnerId, box_item_id: cfg.boxTypeId, qty_per_box: cfg.qtyPerBox ?? 0, tape_item_id: cfg.tapeTypeId });
        }
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={onClose} />

      <div className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
        {/* 헤더 */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 ${initialData ? 'bg-indigo-100 text-indigo-600' : 'bg-indigo-600 text-white'} rounded-xl flex items-center justify-center shadow-lg`}>
              {initialData ? <Package size={20} /> : <Plus size={20} />}
            </div>
            <h3 className="text-lg font-black text-slate-900">{initialData ? '품목 정보 수정' : '신규 품목 등록'}</h3>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">

          {/* 품목명 + 스마트스토어 토글 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Tag size={14} className="mr-2" /> 품목명
              </label>
              {formData.category === 'product' && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-400">스마트스토어 전용</span>
                  <button
                    type="button"
                    onClick={() => setFormData({...formData, isSmartStore: !formData.isSmartStore})}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${formData.isSmartStore ? 'bg-indigo-600' : 'bg-slate-200'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${formData.isSmartStore ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              )}
            </div>
            <input
              required
              autoFocus
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              placeholder="예: 프리미엄 참기름 (300ml)"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>

          {/* 카테고리 */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
              <Package size={14} className="mr-2" /> 카테고리
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {categories.map(cat => {
                const isSelected = formData.category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setFormData({...formData, category: cat as InventoryCategory, subtype: ''})}
                    className={`py-2 rounded-xl text-xs font-black border transition-all ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600'
                    }`}
                  >
                    {CATEGORY_LABELS[cat] ?? cat}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 세부 분류 (subtype) */}
          {(formData.category === 'goods' || formData.category === 'submaterial') && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Tag size={14} className="mr-2" /> 세부 분류
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(formData.category === 'goods' ? GOODS_SUBTYPES : SUBMATERIAL_SUBTYPES).map(sub => {
                  const isSelected = formData.subtype === sub;
                  return (
                    <button
                      key={sub}
                      type="button"
                      onClick={() => setFormData({...formData, subtype: isSelected ? '' : sub})}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-all ${
                        isSelected
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600'
                      }`}
                    >
                      {sub}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 단위 */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
              <Box size={14} className="mr-2" /> 단위
            </label>
            <input
              type="text"
              value={formData.unit}
              onChange={(e) => setFormData({...formData, unit: e.target.value})}
              placeholder="개, 팩, 롤 등"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
          </div>


          {/* 구성품 (BOM) — 완제품/선물세트/배송: 전체 품목 검색·추가 */}
          {['product', 'giftset', 'shipping'].includes(formData.category) && (() => {
            const pool = [...(items ?? []), ...allSubmaterials];
            const addedIds = new Set(formData.submaterials.map(s => s.id));
            const q = bomSearch.trim().toLowerCase();
            const SUB_CATS = ['용기', '마개', '라벨', '박스', '테이프'];
            const catKey = (p: { category?: string; subtype?: string }) => {
              const n = normCat(p.category);
              if (SUB_CATS.includes(n)) return n;
              if (p.category === 'submaterial' && p.subtype && SUB_CATS.includes(p.subtype)) return p.subtype;
              return p.category || '기타';
            };
            const catLabelOf = (k: string) => CATEGORY_LABELS[k] ?? k;
            const CAT_ORDER = ['product', 'goods', 'wip', 'raw', 'giftset', '용기', '마개', '라벨', '박스', '테이프', 'submaterial', 'shipping'];
            const selectable = pool.filter(p => p.id !== initialData?.id && !addedIds.has(p.id));
            // 칩 목록은 전체 품목 기준으로 고정 (추가/필터에 따라 안 바뀌게)
            const availableCats = [...new Set(pool.filter(p => p.id !== initialData?.id).map(catKey))].sort((a, b) => {
              const ai = CAT_ORDER.indexOf(a); const bi = CAT_ORDER.indexOf(b);
              return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            });
            const results = selectable.filter(p => (bomCatFilter === 'all' || catKey(p) === bomCatFilter) && (!q || p.name.toLowerCase().includes(q)));
            const groups = new Map<string, typeof results>();
            for (const p of results) {
              const k = catKey(p);
              if (!groups.has(k)) groups.set(k, []);
              groups.get(k)!.push(p);
            }
            const sortedGroups = [...groups.entries()].sort((a, b) => {
              const ai = CAT_ORDER.indexOf(a[0]); const bi = CAT_ORDER.indexOf(b[0]);
              return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            });
            return (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Layers size={14} className="mr-2" /> 구성품 (BOM)
                {formData.submaterials.length > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 bg-indigo-600 text-white text-[9px] font-black rounded-full">{formData.submaterials.length}</span>
                )}
              </label>

              {/* 추가된 구성품 + 수량 */}
              {formData.submaterials.length > 0 && (
                <div className="space-y-2">
                  {formData.submaterials.map((s, idx) => (
                    <div key={`${s.id}-${idx}`} className="flex items-center gap-2 bg-slate-50 rounded-2xl border border-slate-100 px-4 py-2.5">
                      <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md shrink-0">{catLabelOf(catKey(s))}</span>
                      <span className="flex-1 text-sm font-bold text-slate-700 truncate">{s.name}</span>
                      <input
                        type="number"
                        min={0}
                        value={s.stock ?? 1}
                        onChange={e => {
                          const qty = e.target.value === '' ? 0 : Number(e.target.value);
                          setFormData(fd => ({ ...fd, submaterials: fd.submaterials.map((x, i) => i === idx ? { ...x, stock: qty } : x) }));
                        }}
                        className="w-16 text-center text-sm font-black bg-white border border-slate-200 rounded-lg py-1.5 outline-none focus:ring-2 focus:ring-indigo-400 shrink-0"
                      />
                      <span className="text-[10px] font-bold text-slate-400 w-6 shrink-0">{s.unit || '개'}</span>
                      <button
                        type="button"
                        onClick={() => setFormData(fd => ({ ...fd, submaterials: fd.submaterials.filter((_, i) => i !== idx) }))}
                        className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all shrink-0"
                      ><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}

              {/* 추가 버튼 */}
              <button
                type="button"
                onClick={() => { setBomSearch(''); setBomCatFilter('all'); setBomPickerOpen(true); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-3 rounded-2xl text-sm font-bold text-indigo-600 border border-dashed border-indigo-200 hover:bg-indigo-50 transition-all"
              >
                <Plus size={16} /> 구성품 추가
              </button>

              {/* 구성품 선택 오버레이 */}
              {bomPickerOpen && (
                <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center" onClick={() => setBomPickerOpen(false)}>
                  <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
                  <div className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[85vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                    <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-slate-100 rounded-t-3xl">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-black text-slate-800 text-base">구성품 추가</span>
                        <button type="button" onClick={() => setBomPickerOpen(false)} className="p-2 rounded-xl hover:bg-slate-100 transition-colors"><X size={18} className="text-slate-500" /></button>
                      </div>
                      {/* 카테고리 토글 */}
                      <div className="flex flex-wrap gap-1.5 mb-2.5">
                        <button
                          type="button"
                          onClick={() => setBomCatFilter('all')}
                          className={`px-3 py-1.5 rounded-full text-[11px] font-black border transition-all ${bomCatFilter === 'all' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300'}`}
                        >전체</button>
                        {availableCats.map(c => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setBomCatFilter(c)}
                            className={`px-3 py-1.5 rounded-full text-[11px] font-black border transition-all ${bomCatFilter === c ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300'}`}
                          >{catLabelOf(c)}</button>
                        ))}
                      </div>
                      <input
                        autoFocus
                        type="text"
                        value={bomSearch}
                        onChange={e => setBomSearch(e.target.value)}
                        placeholder="품목명 검색..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
                      {sortedGroups.length === 0 ? (
                        <p className="text-xs text-slate-400 px-1 py-2">{q ? '검색 결과 없음' : '추가할 품목 없음'}</p>
                      ) : sortedGroups.map(([k, list]) => (
                        <div key={k}>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-1.5">{catLabelOf(k)} <span className="text-slate-300">{list.length}</span></p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {list.sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(p => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => setFormData(fd => {
                                  const next = { ...fd, submaterials: [...fd.submaterials, { id: p.id, name: p.name, category: catKey(p), stock: 1, unit: p.unit }] };
                                  // 완제품: 용기 추가 시 그 용기의 용량(spec) 자동 입력
                                  if (fd.category === 'product' && catKey(p) === '용기' && (p as any).spec) next.spec = (p as any).spec;
                                  return next;
                                })}
                                className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-all text-left"
                              >
                                <Plus size={11} className="shrink-0 text-indigo-400" />
                                <span className="truncate">{p.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="p-4 border-t border-slate-100">
                      <button type="button" onClick={() => setBomPickerOpen(false)} className="w-full py-3 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-all">완료 ({formData.submaterials.length})</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            );
          })()}

          {/* 1박스 당 수량 (박스 부자재) */}
          {formData.category === 'box' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Box size={14} className="mr-2" /> 1박스 당 수량 (개)
              </label>
              <input
                type="number"
                min={0}
                value={formData.boxSize === 0 ? '' : formData.boxSize}
                onChange={(e) => setFormData({...formData, boxSize: e.target.value === '' ? 0 : Number(e.target.value)})}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
          )}

          {/* 서류용 품목명 (완제품) */}
          {formData.category === 'product' && (
            <div className="space-y-2" ref={pumokRef}>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Tag size={14} className="mr-2" /> 품목 (서류용)
              </label>
              {pumokWarn && <p className="text-xs font-bold text-red-500">서류용 품목을 선택해주세요.</p>}
              <div className="relative">
                <input
                  type="text"
                  value={formData.품목}
                  onChange={(e) => { setFormData({...formData, 품목: e.target.value, spec: ''}); setShowPumokDrop(true); setPumokWarn(false); }}
                  onFocus={() => setShowPumokDrop(true)}
                  placeholder="예: 시골향참기름1"
                  className={`w-full bg-slate-50 border rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 transition-all ${pumokWarn ? 'border-red-400 focus:ring-red-400' : 'border-slate-200 focus:ring-indigo-500'}`}
                />
                {showPumokDrop && pumokOptions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-20 overflow-hidden max-h-48 overflow-y-auto custom-scrollbar">
                    {pumokOptions.map(v => (
                      <button
                        key={v}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); setFormData({...formData, 품목: v, spec: ''}); setShowPumokDrop(false); }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-bold hover:bg-indigo-50 hover:text-indigo-700 transition-all ${formData.품목 === v ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 용량 (완제품/반제품) */}
          {(formData.category === 'product' || formData.category === 'wip') && (() => {
            const presetVols = (formData.품목 && PUMOK_VOLUMES[formData.품목]) || [];
            const allVols = Array.from(new Set([...presetVols, ...customVols]));
            const addVol = () => {
              const n = volNum.trim();
              if (!n) return;
              const vol = `${n}${volUnit}`;
              if (!presetVols.includes(vol) && !customVols.includes(vol)) setCustomVols(prev => [...prev, vol]);
              setFormData(fd => ({ ...fd, spec: vol }));
              setVolNum('');
            };
            return (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Box size={14} className="mr-2" /> 용량 (서류용)
              </label>
              {allVols.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {allVols.map(vol => (
                    <button
                      key={vol}
                      type="button"
                      onClick={() => setFormData(fd => ({...fd, spec: fd.spec === vol ? '' : vol}))}
                      title={formData.spec === vol ? '클릭하면 선택 해제' : undefined}
                      className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                        formData.spec === vol
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'
                      }`}
                    >
                      {vol}
                    </button>
                  ))}
                </div>
              )}
              {/* 용량 직접 추가: 숫자 입력 + ml/kg 토글 */}
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  value={volNum}
                  onChange={(e) => setVolNum(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVol(); } }}
                  placeholder="예: 300"
                  className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setVolUnit(prev => prev === 'ml' ? 'kg' : 'ml')}
                  title="단위 전환 (ml ↔ kg)"
                  className="shrink-0 w-16 px-4 py-3.5 rounded-2xl border border-indigo-200 bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-all"
                >
                  {volUnit}
                </button>
                <button
                  type="button"
                  onClick={addVol}
                  className="shrink-0 px-5 py-3.5 rounded-2xl bg-indigo-50 text-indigo-600 text-sm font-bold hover:bg-indigo-100 transition-all"
                >
                  추가
                </button>
              </div>
              {formData.spec && (
                <p className="text-[11px] font-bold text-slate-400">선택된 용량: <span className="text-indigo-600">{formData.spec}</span></p>
              )}
            </div>
            );
          })()}

          {/* 매입거래처 (비완제품) */}
          {formData.category !== 'product' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Building2 size={14} className="mr-2" /> 매입거래처 <span className="ml-1 text-[10px] text-slate-300 normal-case">(여러 개 선택 가능)</span>
                {formData.inPartnerIds.length > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 bg-indigo-600 text-white text-[9px] font-black rounded-full">{formData.inPartnerIds.length}</span>
                )}
              </label>
              <input
                type="text"
                value={inboundPartnerSearch}
                onChange={e => setSupplierSearch(e.target.value)}
                placeholder="거래처 검색..."
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
              />
              {inboundPartners.length === 0 ? (
                <p className="text-xs text-slate-400 px-1">등록된 매입거래처 없음</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                  <button
                    type="button"
                    onClick={() => setFormData(fd => ({...fd, inPartnerIds: []}))}
                    className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                      formData.inPartnerIds.length === 0
                        ? 'bg-slate-600 border-slate-600 text-white shadow-sm'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    선택 안 함
                  </button>
                  {inboundPartners
                    .filter(c => !inboundPartnerSearch.trim() || c.name.toLowerCase().includes(inboundPartnerSearch.toLowerCase()))
                    .sort((a, b) => (formData.inPartnerIds.includes(a.id) ? -1 : 0) - (formData.inPartnerIds.includes(b.id) ? -1 : 0))
                    .map(c => {
                      const selected = formData.inPartnerIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setFormData(fd => ({...fd, inPartnerIds: selected ? fd.inPartnerIds.filter(id => id !== c.id) : [...fd.inPartnerIds, c.id]}))}
                          className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold border transition-all text-left ${
                            selected
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                              : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600'
                          }`}
                        >
                          {selected && <Check size={10} className="shrink-0" />}
                          <span className="truncate">{c.name}</span>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* 운임타입 (박스) */}
          {formData.category === 'box' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Tag size={14} className="mr-2" /> 운임타입
              </label>
              <div className="flex gap-2">
                {(['s', 'a', 'b', 'c', 'd', 'e'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFormData({...formData, freightType: t})}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-black border transition-all uppercase ${
                      formData.freightType === t
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow'
                        : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

        </form>

        <div className="p-6 border-t border-slate-100 bg-slate-50/50 rounded-b-3xl flex space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-4 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50 transition-all"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="flex-1 py-4 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all"
          >
            {initialData ? '수정 완료' : '등록 완료'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductModal;
