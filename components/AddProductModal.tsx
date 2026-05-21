import React, { useState, useRef, useEffect } from 'react';
import { X, Package, Tag, Box, Layers, Plus, Building2, Check, Trash2 } from 'lucide-react';
import { Product, InventoryCategory, ItemSubtype, Client, ClientBoxConfig, ProductClient, ProductSupplier, ShippingRule } from '../types';

interface ProductModalProps {
  initialData?: Product;
  allSubmaterials?: Product[];
  products?: Product[];
  clients?: Client[];
  productClients?: ProductClient[];
  productSuppliers?: ProductSupplier[];
  shippingRules?: ShippingRule[];
  onClose: () => void;
  onSave: (_product: Product) => void;
  onSaveProductClientConfig?: (id: string, config: Partial<ProductClient>) => Promise<void>;
  onSaveShippingRule?: (rule: Partial<ShippingRule> & { id: string }) => Promise<void>;
  onAddShippingRule?: (rule: Omit<ShippingRule, 'id'>) => Promise<void>;
  onUpsertProductSupplier?: (ps: ProductSupplier) => void;
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

const ProductModal: React.FC<ProductModalProps> = ({ initialData, allSubmaterials = [], products = [], clients = [], productClients = [], productSuppliers = [], shippingRules = [], onClose, onSave, onSaveProductClientConfig, onSaveShippingRule, onAddShippingRule, onUpsertProductSupplier, onAddSubmaterial }) => {
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
    clientBoxConfigs: initialData?.clientBoxConfigs ?? [] as ClientBoxConfig[],
    spec: initialData?.spec || '',
    품목: initialData?.품목 || '',
    isSmartStore: initialData?.isSmartStore ?? false,
    clientIds: initialData?.clientIds ?? (initialData?.clientId ? [initialData.clientId] : []),
    supplierId: productSuppliers.find(ps => ps.Item_ID === initialData?.id)?.Partner_ID ?? '',
    submaterials: (initialData?.submaterials || []).map(s => ({
      ...s,
      category: normCat(s.category)
    }))
  }));

  const [activeSubCategory, setActiveSubCategory] = useState<string | null>(null);
  const [addingSubCat, setAddingSubCat] = useState<string | null>(null);
  const [newSubName, setNewSubName] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [subSearch, setSubSearch] = useState<Record<string, string>>({});
  const [showPumokDrop, setShowPumokDrop] = useState(false);
  const [pumokWarn, setPumokWarn] = useState(false);
  const [expandedBoxClient, setExpandedBoxClient] = useState<string | null>(null);
  const [boxClientSearch, setBoxClientSearch] = useState('');
  const [showBoxClientDrop, setShowBoxClientDrop] = useState(false);

  // 거래처별 포장 설정 (shipping_rule 기반, partner_item 필드 fallback)
  const [clientPackagingConfigs, setClientPackagingConfigs] = useState<Record<string, { boxTypeId?: string; qtyPerBox?: number; tapeTypeId?: string }>>(() => {
    const map: Record<string, { boxTypeId?: string; qtyPerBox?: number; tapeTypeId?: string }> = {};
    if (initialData) {
      productClients.filter(pc => pc.Item_ID === initialData.id).forEach(pc => {
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
      ...products.map(p => p.품목).filter(Boolean) as string[],
      ...PRESET_PUMOK,
    ])
  ].filter(v => !formData.품목 || v.toLowerCase().includes(formData.품목.toLowerCase()));

  const supplierClients = clients.filter(c =>
    c.partnerType === '매입처' || c.partnerType === '매출+매입처'
  );
  const salesClients = clients.filter(c =>
    !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처'
  );

  const categories: InventoryCategory[] = ['product', 'goods', 'wip', 'raw', 'giftset', 'submaterial', 'shipping'];

  const handleSubmit = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!formData.name) return;
    if (formData.category === 'product' && !formData.품목) { setPumokWarn(true); return; }

    const isProductCategory = ['product', 'goods', 'wip', 'raw', 'giftset'].includes(formData.category);
    const hasBoxConfig = formData.defaultBoxConfig.unitsPerBox > 0;

    const finalProduct: Product = {
      id: initialData ? initialData.id : `p-${Date.now()}`,
      name: formData.name,
      category: formData.category,
      ...(formData.subtype && { subtype: formData.subtype }),
      price: formData.price,
      stock: initialData?.stock ?? 0,
      minStock: formData.category === 'product' ? 0 : formData.minStock,
      unit: formData.unit,
      image: initialData?.image || '',
      submaterials: formData.category === 'product'
        ? formData.submaterials
        : (formData.submaterials.length > 0 ? formData.submaterials : (initialData?.submaterials || [])),
      ...(formData.category === 'box' && { freightType: formData.freightType, boxSize: formData.boxSize }),
      ...(isProductCategory && hasBoxConfig && { defaultBoxConfig: formData.defaultBoxConfig }),
      ...(isProductCategory && formData.clientBoxConfigs.length > 0 && { clientBoxConfigs: formData.clientBoxConfigs }),
      ...(formData.spec && { spec: formData.spec }),
      ...(formData.품목 && { 품목: formData.품목 }),
      ...(formData.category === 'product' && formData.clientIds.length > 0 && { clientIds: formData.clientIds }),
      ...(formData.category === 'product' && { isSmartStore: formData.isSmartStore }),
    };

    onSave(finalProduct);

    // ProductSupplier upsert — partner_item Direction='in'으로 저장
    if (formData.supplierId && onUpsertProductSupplier) {
      const supplierId = formData.supplierId;
      const itemId = finalProduct.id;
      const psId = `${itemId}_${supplierId}_in`;
      const existing = productSuppliers.find(ps => ps.Item_ID === itemId);
      onUpsertProductSupplier({ id: psId, Partner_ID: supplierId, Item_ID: itemId, Direction: 'in', Standard_Price: existing?.Standard_Price, taxType: existing?.taxType });
    }

    // 거래처별 포장 설정 → shipping_rule 컬렉션에 저장
    if ((onSaveShippingRule || onAddShippingRule) && finalProduct.clientIds?.length) {
      const pid = finalProduct.id;
      for (const clientId of finalProduct.clientIds) {
        const cfg = clientPackagingConfigs[clientId] ?? {};
        if (!cfg.boxTypeId && !cfg.qtyPerBox && !cfg.tapeTypeId) continue;
        const existing = shippingRules.find(r => r.item_id === pid && r.partner_id === clientId);
        if (existing && onSaveShippingRule) {
          await onSaveShippingRule({ id: existing.id, box_item_id: cfg.boxTypeId ?? '', qty_per_box: cfg.qtyPerBox ?? 0, tape_item_id: cfg.tapeTypeId });
        } else if (!existing && onAddShippingRule && cfg.boxTypeId) {
          await onAddShippingRule({ item_id: pid, partner_id: clientId, box_item_id: cfg.boxTypeId, qty_per_box: cfg.qtyPerBox ?? 0, tape_item_id: cfg.tapeTypeId });
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


          {/* BOM 설정 (완제품) */}
          {formData.category === 'product' && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Layers size={14} className="mr-2" /> 구성 부자재 (BOM)
              </label>
              <div className="space-y-2">
                {(['용기', '마개', '라벨'] as const).map(cat => {
                  const getSubCat = (s: typeof formData.submaterials[0]) => {
                    if ((s as any).category === 'submaterial') return (s as any).subtype || '';
                    if (s.category) return normCat(s.category);
                    const found = allSubmaterials.find(a => a.id === s.id);
                    if (found?.category === 'submaterial') return found.subtype || '';
                    return normCat(found?.category || '');
                  };
                  const selectedSub = formData.submaterials
                    .filter(s => s.id !== 's-auto-C-NONE' && s.name !== 'C-NONE')
                    .find(s => getSubCat(s) === cat);
                  const isOpen = activeSubCategory === cat;

                  return (
                    <div key={cat} className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden transition-all">
                      <button
                        type="button"
                        onClick={() => setActiveSubCategory(isOpen ? null : cat)}
                        className="w-full flex items-center justify-between p-4 hover:bg-slate-100/50 transition-all"
                      >
                        <div className="flex items-center space-x-3">
                          <span className="text-[10px] font-black text-indigo-600 uppercase tracking-tighter bg-indigo-50 px-2 py-1 rounded-md">{cat}</span>
                          {selectedSub ? (
                            <div className="flex items-center space-x-2">
                              <span className="text-sm font-bold text-slate-700">{selectedSub.name}</span>
                            </div>
                          ) : (
                            <span className="text-sm font-medium text-slate-400">{cat} 선택 안함</span>
                          )}
                        </div>
                        <Plus size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-45' : ''}`} />
                      </button>

                      {isOpen && (
                        <div className="p-4 bg-white border-t border-slate-100 animate-in slide-in-from-top-2 duration-200">
                          <input
                            type="text"
                            value={subSearch[cat] || ''}
                            onChange={e => setSubSearch(prev => ({ ...prev, [cat]: e.target.value }))}
                            placeholder={`${cat} 검색...`}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400 mb-3"
                          />
                          <div className="grid grid-cols-1 gap-2 mb-4 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                            <button
                              type="button"
                              onClick={() => {
                                const filtered = formData.submaterials.filter(s => getSubCat(s) !== cat);
                                setFormData({ ...formData, submaterials: filtered });
                                setActiveSubCategory(null);
                              }}
                              className={`flex items-center justify-between px-4 py-3 rounded-xl text-xs font-bold transition-all border ${!selectedSub ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100'}`}
                            >
                              <span>{cat} 선택 안함</span>
                              {!selectedSub && <div className="w-2 h-2 bg-indigo-600 rounded-full" />}
                            </button>

                            {allSubmaterials
                              .filter(s => normCat(s.category) === cat || (s.category === 'submaterial' && s.subtype === cat))
                              .filter(s => !subSearch[cat] || s.name.toLowerCase().includes(subSearch[cat].toLowerCase()))
                              .sort((a, b) => {
                                const sikolA = a.name.startsWith('시골향');
                                const sikolB = b.name.startsWith('시골향');
                                if (sikolA && !sikolB) return -1;
                                if (!sikolA && sikolB) return 1;
                                if (sikolA && sikolB) {
                                  const order = (n: string) =>
                                    n.includes('참기름') ? 0 : n.includes('들기름') ? 1 : n.includes('가루') ? 2 : 3;
                                  const diff = order(a.name) - order(b.name);
                                  if (diff !== 0) return diff;
                                }
                                return a.name.localeCompare(b.name, 'ko');
                              })
                              .map(sub => {
                                const isSelected = selectedSub?.id === sub.id;
                                return (
                                  <button
                                    key={sub.id}
                                    type="button"
                                    onClick={() => {
                                      const filtered = formData.submaterials.filter(s => getSubCat(s) !== cat);
                                      const autoCapacity = cat === '용기'
                                        ? (allSubmaterials.find(a => a.id === sub.id) as Product | undefined)?.spec || ''
                                        : formData.spec;
                                      const newSub = { id: sub.id, name: sub.name, category: cat, stock: 1, unit: sub.unit };
                                      const newData: typeof formData = {
                                        ...formData,
                                        submaterials: [...filtered, newSub],
                                        ...(cat === '용기' && { spec: autoCapacity }),
                                      };
                                      setFormData(newData);
                                      setActiveSubCategory(null);
                                    }}
                                    className={`flex items-center justify-between px-4 py-3 rounded-xl text-xs font-bold transition-all border ${isSelected ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100'}`}
                                  >
                                    <span>{sub.name}</span>
                                    {isSelected && <div className="w-2 h-2 bg-indigo-600 rounded-full" />}
                                  </button>
                                );
                              })}
                          </div>

                          {/* 새 항목 추가 */}
                          {onAddSubmaterial && (
                            addingSubCat === cat ? (
                              <div className="flex items-center gap-2 mt-2">
                                <input
                                  autoFocus
                                  type="text"
                                  value={newSubName}
                                  onChange={e => setNewSubName(e.target.value)}
                                  onKeyDown={async e => {
                                    if (e.key === 'Enter' && newSubName.trim()) {
                                      const unit = cat === '라벨' ? '매' : '개';
                                      const newId = await onAddSubmaterial(newSubName.trim(), cat);
                                      const newSub = { id: newId, name: newSubName.trim(), category: cat, unit, stock: 1 };
                                      const filtered = formData.submaterials.filter(s => getSubCat(s) !== cat);
                                      setFormData({ ...formData, submaterials: [...filtered, newSub] });
                                      setNewSubName('');
                                      setAddingSubCat(null);
                                      setActiveSubCategory(null);
                                    } else if (e.key === 'Escape') {
                                      setNewSubName(''); setAddingSubCat(null);
                                    }
                                  }}
                                  placeholder={`새 ${cat} 이름 입력 후 Enter`}
                                  className="flex-1 bg-slate-50 border border-indigo-300 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-400"
                                />
                                <button
                                  type="button"
                                  onClick={() => { setNewSubName(''); setAddingSubCat(null); }}
                                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
                                ><X size={14} /></button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => { setAddingSubCat(cat); setNewSubName(''); }}
                                className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-indigo-500 border border-dashed border-indigo-200 hover:bg-indigo-50 transition-all"
                              >
                                <Plus size={12} /> 새 {cat} 추가
                              </button>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

            </div>
          )}

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

          {/* 용량 (완제품) */}
          {formData.category === 'product' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Box size={14} className="mr-2" /> 용량 (서류용)
              </label>
              {formData.품목 && PUMOK_VOLUMES[formData.품목] ? (
                <div className="flex flex-wrap gap-2">
                  {PUMOK_VOLUMES[formData.품목].map(vol => (
                    <button
                      key={vol}
                      type="button"
                      onClick={() => setFormData({...formData, spec: vol})}
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
              ) : (
                <input
                  type="text"
                  value={formData.spec}
                  onChange={(e) => setFormData({...formData, spec: e.target.value})}
                  placeholder="예: 200g, 500g, 1kg, 300ml"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              )}
            </div>
          )}

          {/* 매입거래처 (비완제품) */}
          {formData.category !== 'product' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Building2 size={14} className="mr-2" /> 매입거래처
                {formData.supplierId && (
                  <span className="ml-2 px-1.5 py-0.5 bg-indigo-600 text-white text-[9px] font-black rounded-full">1</span>
                )}
              </label>
              <input
                type="text"
                value={supplierSearch}
                onChange={e => setSupplierSearch(e.target.value)}
                placeholder="거래처 검색..."
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
              />
              {supplierClients.length === 0 ? (
                <p className="text-xs text-slate-400 px-1">등록된 매입거래처 없음</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                  <button
                    type="button"
                    onClick={() => setFormData({...formData, supplierId: ''})}
                    className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                      !formData.supplierId
                        ? 'bg-slate-600 border-slate-600 text-white shadow-sm'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    선택 안 함
                  </button>
                  {supplierClients
                    .filter(c => !supplierSearch.trim() || c.name.toLowerCase().includes(supplierSearch.toLowerCase()))
                    .sort((a, b) => (formData.supplierId === a.id ? -1 : formData.supplierId === b.id ? 1 : 0))
                    .map(c => {
                      const selected = formData.supplierId === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setFormData({...formData, supplierId: selected ? '' : c.id})}
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
