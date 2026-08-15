import React, { useState, useRef, useEffect, useMemo } from 'react';
import { X, Package, Tag, Box, Layers, Plus, Building2, Check, Trash2, ChevronRight, FileText } from 'lucide-react';
import { Item, InventoryCategory, ItemSubtype, Partner, ClientBoxConfig, PartnerItem, ShippingRule } from '../types';
import { fetchCollection } from '../src/shared/services/firebaseService';
import { buildTaxonomy, DEFAULT_CATEGORY_LABELS, TaxonomyRow } from '../src/shared/taxonomy';
import { baseRawName, PRODUCT_FORMULA } from '../src/constants/formula';

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
  rawItems?: Item[];
  itemFormulas?: import('../src/shared/types').ItemFormula[];
  onSaveItemFormula?: (parentKey: string, rows: { child_name: string; yield_rate: number; ratio: number }[], prevKey?: string) => Promise<void>;
}

const CAT_NORM: Record<string, string> = {
  'Cap': '마개', 'Tape': '테이프', '박스': '박스', '용기': '용기', '라벨': '라벨', '마개': '마개', '테이프': '테이프',
  'cap': '마개', 'tape': '테이프', 'box': '박스', 'container': '용기', 'label': '라벨',
};
const normCat = (c?: string) => c ? (CAT_NORM[c] || c) : '';

const CATEGORY_LABELS: Record<string, string> = DEFAULT_CATEGORY_LABELS;

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

const ProductModal: React.FC<ProductModalProps> = ({ initialData, allSubmaterials = [], items, partners = [], partnerItems, shippingRules = [], onClose, onSave, onSaveShippingRule, onAddShippingRule, onUpsertPartnerItem, onDeletePartnerItem, onAddSubmaterial, rawItems = [], itemFormulas = [], onSaveItemFormula }) => {
  const partnerOut = (partnerItems ?? []).filter((pi: any) => pi.Direction === 'out');
  const partnerIn = (partnerItems ?? []).filter((pi: any) => pi.Direction === 'in');

  const [formData, setFormData] = useState(() => ({
    name: initialData?.name || '',
    category: (initialData?.category as InventoryCategory) || 'product',
    subtype: (initialData?.subtype as ItemSubtype | '') || '',
    subtype2: initialData?.subtype2 || '',
    price: initialData?.price || 0,
    cost: initialData?.cost || 0,
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
    phantom: initialData?.phantom ?? false,
    partnerIds: initialData?.partnerIds ?? (initialData?.partnerId ? [initialData.partnerId] : []),
    inPartnerIds: partnerIn
      .filter(pi => pi.itemId === initialData?.id)
      .map(pi => (pi.partnerId))
      .filter(Boolean) as string[],
    submaterials: (initialData?.submaterials || []).map(s => ({
      ...s,
      category: normCat(s.category)
    }))
  }));

  // 분류 체계 — 사용자가 정한 이름·하위 분류(itemTaxonomy). 저장본이 없으면 기본값.
  const [taxonomyRows, setTaxonomyRows] = useState<TaxonomyRow[]>([]);
  useEffect(() => { fetchCollection<TaxonomyRow>('itemTaxonomy').then(setTaxonomyRows).catch(() => {}); }, []);
  const taxo = useMemo(() => buildTaxonomy(taxonomyRows), [taxonomyRows]);

  const [partnerSearch, setClientSearch] = useState('');
  const [inboundPartnerSearch, setSupplierSearch] = useState('');
  const [showPumokDrop, setShowPumokDrop] = useState(false);
  const [pumokWarn, setPumokWarn] = useState(false);
  const [expandedBoxClient, setExpandedBoxClient] = useState<string | null>(null);
  const [boxClientSearch, setBoxClientSearch] = useState('');
  const [volNum, setVolNum] = useState('');
  const [volUnit, setVolUnit] = useState<'ml' | 'kg' | 'g'>('ml');
  const [customVols, setCustomVols] = useState<string[]>(initialData?.spec ? [initialData.spec] : []);
  const [bomSearch, setBomSearch] = useState('');
  const [bomPickerOpen, setBomPickerOpen] = useState(false);
  const [bomCatFilter, setBomCatFilter] = useState<string>('all');
  const [expandedBom, setExpandedBom] = useState<Set<string>>(new Set()); // 구성품 완제품 BOM 드릴다운
  const [showBoxClientDrop, setShowBoxClientDrop] = useState(false);

  // 원료 배합·수율 (완제품·반제품·원료) — item_formula 편집.
  //   완제품 parent_key = 품목(규격 공유), 반제품/원료 parent_key = base 이름.
  //   유효비율 = ratio × yield_rate (buildFormula와 동일). 표시/저장은 이 유효비율(%)로 통일.
  const [formulaRows, setFormulaRows] = useState<{ child_name: string; yield_pct: number }[]>(() => {
    if (!initialData) return [];
    const isProduct = initialData.category === 'product';
    const key = isProduct ? (initialData.품목 || initialData.name) : baseRawName(initialData.name);
    const rows = (itemFormulas ?? []).filter(f => f.parent_key === key);
    if (rows.length > 0)
      return rows.map(f => ({ child_name: f.child_name, yield_pct: Math.round((f.ratio ?? 1) * (f.yield_rate ?? 1) * 1000) / 10 }));
    // item_formula 행이 없으면 완제품은 하드코딩 시드(PRODUCT_FORMULA)를 미리 채워 보여줌(실수로 비우는 것 방지).
    if (isProduct && PRODUCT_FORMULA[key])
      return PRODUCT_FORMULA[key].map(r => ({ child_name: r.raw, yield_pct: Math.round(r.ratio * 1000) / 10 }));
    return [];
  });
  const [formulaChildQuery, setFormulaChildQuery] = useState('');
  const [formulaPickerOpen, setFormulaPickerOpen] = useState(false);
  const formulaPickerRef = useRef<HTMLDivElement>(null);

  // 거래처별 포장 설정(shipping_rule)은 폐기 — 겉박스·테이프는 박스 품목 BOM으로만 관리한다.
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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (formulaPickerRef.current && !formulaPickerRef.current.contains(e.target as Node))
        setFormulaPickerOpen(false);
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

  // 원료 배합 자식 후보 — 원료·반제품 base 이름(자기 자신·이미 추가된 것 제외)
  const formulaSelfKey = baseRawName(formData.name);
  const formulaChildOptions = [...new Set((rawItems ?? []).map(i => baseRawName(i.name)))]
    .filter(n => n && n !== formulaSelfKey && !formulaRows.some(r => r.child_name === n))
    .filter(n => !formulaChildQuery.trim() || n.toLowerCase().includes(formulaChildQuery.toLowerCase()))
    .sort();

  const inboundPartners = partners.filter(c =>
    c.partnerType === '매입처' || c.partnerType === '매출+매입처'
  );
  const salesClients = partners.filter(c =>
    !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처'
  );

  // 타입 목록 — 분류 관리(itemTaxonomy)에서 정한 것. 숨긴 타입(배송·선물세트 등)은 빠진다.
  // 편집 중 품목의 타입이 숨김이어도 선택이 보이게 포함한다.
  const typeList = useMemo(() => {
    const list = taxo.types.map(t => ({ key: t.key, label: t.label }));
    if (formData.category && !list.some(t => t.key === formData.category)) {
      return [{ key: formData.category, label: taxo.labelOf(formData.category) }, ...list];
    }
    return list;
  }, [taxo, formData.category]);

  const handleSubmit = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!formData.name) return;
    // 배송(박스) 서브타입은 서류용 품목이 없어도 저장 가능 — 낱개로 풀려 서류는 낱개 기준
    // 서류용 품목이 비어 있으면 — 예전엔 조용히 막아서 '저장 버튼이 안 눌린다'로 보였다.
    // 이제 물어보고, 그대로 진행하겠다면 저장한다(서류에서 이 품목은 빠진다).
    if (formData.category === 'product' && (formData as any).subtype2 !== '배송' && !formData.품목) {
      setPumokWarn(true);
      const go = window.confirm(
        '서류용 품목이 비어 있습니다.\n\n이대로 저장하면 원료수불부·생산작업기록부에서 이 품목이 빠집니다.\n그래도 저장할까요?',
      );
      if (!go) { pumokRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    }

    const isProductCategory = ['product', 'goods', 'wip', 'raw', 'giftset'].includes(formData.category);
    const hasBoxConfig = formData.defaultBoxConfig.unitsPerBox > 0;

    // 용량 칸에 숫자만 입력하고 '추가'(또는 Enter)를 누르지 않은 채 저장해도 반영 (완제품/반제품)
    const pendingSpec = (!formData.spec && volNum.trim() && (formData.category === 'product' || formData.category === 'wip'))
      ? `${volNum.trim()}${volUnit}` : '';
    const effectiveSpec = formData.spec || pendingSpec;

    const finalProduct: Item = {
      id: initialData ? initialData.id : `p-${Date.now()}`,
      name: formData.name,
      category: formData.category,
      ...(formData.subtype && { subtype: formData.subtype }),
      ...((formData as any).subtype2 && { subtype2: (formData as any).subtype2 }),
      price: formData.price,
      ...(formData.cost > 0 ? { cost: formData.cost } : {}),
      stock: initialData?.stock ?? 0,
      minStock: formData.category === 'product' ? 0 : formData.minStock,
      unit: formData.unit,
      image: initialData?.image || '',
      // 구성품(BOM)은 item_bom에만 저장한다 — 저장 직후 AdminApp이 동기화한다.
      //   items.submaterials는 로딩 때 withDerivedSubmaterials가 item_bom에서 통째로 다시 만들므로,
      //   여기에 써 두면 아무도 안 읽는 옛 값이 문서에 남아 나중에 진단할 때 헷갈린다.
      ...(formData.category === 'box' && { freightType: formData.freightType, boxSize: formData.boxSize }),
      ...(isProductCategory && hasBoxConfig && { defaultBoxConfig: formData.defaultBoxConfig }),
      ...(isProductCategory && formData.partnerBoxConfigs.length > 0 && { partnerBoxConfigs: formData.partnerBoxConfigs }),
      ...(effectiveSpec && { spec: effectiveSpec }),
      ...(formData.품목 && { 품목: formData.품목 }),
      ...(formData.category === 'product' && formData.partnerIds.length > 0 && { partnerIds: formData.partnerIds }),
      ...(formData.category === 'product' && { isSmartStore: formData.isSmartStore }),
      ...((formData.category === 'wip' || formData.category === 'raw') && { phantom: !!formData.phantom }),
    };

    onSave(finalProduct);

    // 원료 배합·수율 저장 — **반제품·원료만**. item_formula.
    //   완제품은 저장하지 않는다: parent_key가 품목이라 같은 품목을 쓰는 다른 완제품까지 덮어쓰고,
    //   완제품 배합은 구성품(BOM)이 정하므로 근거가 둘로 갈린다. 위 편집 UI도 완제품엔 없다.
    if (onSaveItemFormula && ['wip', 'raw'].includes(formData.category)) {
      const keyOf = (cat: string, pumok: string, nm: string) => cat === 'product' ? (pumok || nm) : baseRawName(nm);
      const parentKey = keyOf(formData.category, formData.품목, formData.name);
      const prevKey = initialData ? keyOf(initialData.category, initialData.품목 || '', initialData.name) : undefined;
      const rows = formulaRows
        .filter(r => r.child_name)
        .map(r => ({ child_name: r.child_name, yield_rate: (r.yield_pct || 0) / 100, ratio: 1 }));
      await onSaveItemFormula(parentKey, rows, prevKey && prevKey !== parentKey ? prevKey : undefined);
    }

    // PartnerItem 다중 upsert/삭제 — partner_item Direction='in'
    if (onUpsertPartnerItem) {
      const itemId = finalProduct.id;
      const prevIn = partnerIn.filter(pi => pi.itemId === itemId);
      // 선택된 매입거래처 upsert (기존 doc/단가 유지)
      for (const partnerId of formData.inPartnerIds) {
        const existing = prevIn.find(pi => (pi.partnerId) === partnerId);
        onUpsertPartnerItem({ id: existing?.id ?? `${itemId}_${partnerId}_in`, partnerId: partnerId, itemId: itemId, Direction: 'in', price: existing?.price, taxType: existing?.taxType });
      }
      // 해제된 매입거래처 삭제
      if (onDeletePartnerItem) {
        for (const pi of prevIn) {
          const pid = pi.partnerId;
          if (pid && !formData.inPartnerIds.includes(pid)) onDeletePartnerItem(pi.id);
        }
      }
    }

    // 거래처별 포장 설정(shipping_rule)은 폐기했다 — 겉박스·테이프는 박스 품목의 BOM으로만 잡는다.
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

          {/* 타입 */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
              <Package size={14} className="mr-2" /> 타입
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {typeList.map(({ key, label }) => {
                const isSelected = formData.category === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFormData({...formData, category: key as InventoryCategory, subtype: '', subtype2: '' } as any)}
                    className={`py-2 rounded-xl text-xs font-black border transition-all ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 서브타입 — 낱개/배송/선물세트. 분류 관리에서 정한 목록 */}
          {taxo.subtypesOf(formData.category).length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Layers size={14} className="mr-2" /> 서브타입
              </label>
              <div className="flex flex-wrap gap-1.5">
                {taxo.subtypesOf(formData.category).map((sub: string) => {
                  const isSelected = (formData as any).subtype2 === sub;
                  return (
                    <button
                      key={sub}
                      type="button"
                      onClick={() => setFormData({ ...formData, subtype2: isSelected ? '' : sub } as any)}
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

          {/* 카테고리 — 참기름/라벨/용기…. 분류 관리에서 정한 목록 */}
          {taxo.categoriesOf(formData.category).length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Tag size={14} className="mr-2" /> 카테고리
              </label>
              <div className="flex flex-wrap gap-1.5">
                {taxo.categoriesOf(formData.category).map((c: string) => {
                  const isSelected = formData.subtype === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setFormData({ ...formData, subtype: isSelected ? '' : c })}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-all ${
                        isSelected
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600'
                      }`}
                    >
                      {c}
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

          {/* 원가 (수동 입력 — 매입전표 발행 시 자동 갱신되지만 직접 입력도 가능) */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
              <Box size={14} className="mr-2" /> 원가 (원)
            </label>
            <input
              type="number"
              min={0}
              value={formData.cost === 0 ? '' : formData.cost}
              onChange={(e) => setFormData({...formData, cost: e.target.value === '' ? 0 : Number(e.target.value)})}
              placeholder="매입원가 직접 입력 (예: 380)"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            />
            <p className="text-[11px] text-slate-400">매입전표 발행/수정 시 자동 갱신됩니다. 직접 입력도 가능.</p>
          </div>


          {/* 구성품 (BOM) — 완제품/선물세트/배송/반제품: 전체 품목 검색·추가 (반제품=용기·마개·반제품 조립, 무라벨 등) */}
          {['product', 'giftset', 'shipping', 'wip'].includes(formData.category) && (() => {
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
                  {formData.submaterials.map((s, idx) => {
                    // 구성품이 완제품/반제품이면 그 BOM(원료+부자재)을 펼쳐 볼 수 있게
                    const child = (items ?? []).find(p => p.id === s.id);
                    const cCat = child ? normCat(child.category) : '';
                    const isAssembly = !!child && (cCat === 'product' || cCat === 'wip' || child.category === '완제품');
                    const open = expandedBom.has(s.id);
                    const childSubs = (child?.submaterials ?? []) as any[];
                    const childRaw = child ? (itemFormulas ?? []).filter(f => f.parent_key === ((child as any).품목 || child.name)) : [];
                    return (
                    <div key={`${s.id}-${idx}`} className="rounded-2xl border border-slate-100 overflow-hidden">
                      <div className="flex items-center gap-2 bg-slate-50 px-4 py-2.5">
                        {isAssembly ? (
                          <button type="button" title="완제품 구성 보기"
                            onClick={() => setExpandedBom(prev => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
                            className="shrink-0 text-slate-400 hover:text-indigo-600">
                            <ChevronRight size={15} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
                          </button>
                        ) : <span className="w-[15px] shrink-0" />}
                        <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md shrink-0">{catLabelOf(catKey(s))}</span>
                        <span className="flex-1 text-sm font-bold text-slate-700 truncate">{s.name}{(s as any).spec && <span className="ml-1.5 text-[11px] font-black text-indigo-400">{(s as any).spec}</span>}</span>
                        {/* BOM 수량은 **kg으로 저장**한다. 밀도가 있는 오일은 화면에서만 L로 보여주고
                            입력받은 L에 밀도를 곱해 되돌린다 — 안 그러면 kg 숫자에 'L' 딱지만 붙는다. */}
                        {(() => {
                          const comp = (items ?? []).find(p => p.id === s.id);
                          const d = comp?.density;
                          const shown = d ? Math.round(((s.stock ?? 1) / d) * 10000) / 10000 : (s.stock ?? 1);
                          return (
                            <>
                              <input
                                type="number"
                                min={0}
                                step="any"
                                value={shown}
                                onChange={e => {
                                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                                  const qty = d ? Math.round(v * d * 10000) / 10000 : v;
                                  setFormData(fd => ({ ...fd, submaterials: fd.submaterials.map((x, i) => i === idx ? { ...x, stock: qty } : x) }));
                                }}
                                className="w-16 text-center text-sm font-black bg-white border border-slate-200 rounded-lg py-1.5 outline-none focus:ring-2 focus:ring-indigo-400 shrink-0"
                              />
                              <span className="text-[10px] font-bold text-slate-400 w-6 shrink-0"
                                title={d ? `저장값 ${s.stock ?? 1}kg (밀도 ${d})` : undefined}>
                                {s.unit || '개'}
                              </span>
                            </>
                          );
                        })()}
                        <button
                          type="button"
                          onClick={() => setFormData(fd => ({ ...fd, submaterials: fd.submaterials.filter((_, i) => i !== idx) }))}
                          className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all shrink-0"
                        ><X size={14} /></button>
                      </div>
                      {isAssembly && open && (
                        <div className="bg-white px-4 py-2.5 pl-10 border-t border-slate-100 space-y-1">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{child?.name} 의 BOM</p>
                          {childRaw.length === 0 && childSubs.length === 0 && (
                            <p className="text-[11px] text-slate-400">등록된 구성(원료·부자재)이 없습니다.</p>
                          )}
                          {childRaw.map((f, i) => (
                            <div key={`r${i}`} className="flex items-center gap-2 text-[12px]">
                              <span className="text-[8px] font-black text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded shrink-0">원료</span>
                              <span className="flex-1 text-slate-600 truncate">{f.child_name}</span>
                              <span className="text-slate-400 font-bold shrink-0">×{f.ratio ?? 1}</span>
                            </div>
                          ))}
                          {childSubs.map((cs, i) => (
                            <div key={`s${i}`} className="flex items-center gap-2 text-[12px]">
                              <span className="text-[8px] font-black text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">{catLabelOf(catKey(cs))}</span>
                              <span className="flex-1 text-slate-600 truncate">{cs.name}</span>
                              <span className="text-slate-400 font-bold shrink-0">×{cs.stock ?? 1}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    );
                  })}
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
                  <div className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg h-[85vh] sm:h-[600px] flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
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
                                  const newSub = { id: p.id, name: p.name, category: catKey(p), stock: 1, unit: p.unit, ...((p as any).spec ? { spec: (p as any).spec } : {}) };
                                  const next = { ...fd, submaterials: [...fd.submaterials, newSub] };
                                  // 완제품: 용기 추가 시 그 용기의 용량(spec) 자동 입력
                                  if (fd.category === 'product' && catKey(p) === '용기' && (p as any).spec) next.spec = (p as any).spec;
                                  return next;
                                })}
                                className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-all text-left"
                              >
                                <Plus size={11} className="shrink-0 text-indigo-400" />
                                <span className="truncate">{p.name}</span>
                                {catKey(p) === 'product' && (p as any).spec && (
                                  <span className="ml-auto shrink-0 text-[10px] font-black text-indigo-400">{(p as any).spec}</span>
                                )}
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


          {/* 원료 배합 · 수율 — 반제품·원료만.
              완제품의 배합은 위 구성품(BOM)이 정한다. 완제품에서 여기를 열어두면 품목 키로
              원료식이 다시 생기고(같은 품목을 쓰는 다른 완제품까지 덮어씀), 재고 계산 근거가
              BOM과 원료식 둘로 갈라진다. 서류 비율은 코드의 DOC_MIX 표가 갖는다. */}
          {(formData.category === 'wip' || formData.category === 'raw') && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Layers size={14} className="mr-2" /> 원료 배합 · 수율
              </label>

              {/* 즉석배합(무재고) 토글 */}
              <button
                type="button"
                onClick={() => setFormData(fd => ({ ...fd, phantom: !fd.phantom }))}
                className={`w-full flex items-start gap-3 px-3.5 py-3 rounded-2xl border text-left transition-all ${formData.phantom ? 'bg-indigo-50 border-indigo-300' : 'bg-slate-50 border-slate-200'}`}
              >
                <span className={`mt-0.5 shrink-0 w-9 h-5 rounded-full relative transition-all ${formData.phantom ? 'bg-indigo-600' : 'bg-slate-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${formData.phantom ? 'left-4' : 'left-0.5'}`} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-black text-slate-700">즉석배합 (무재고)</span>
                  <span className="block text-[11px] text-slate-400 leading-snug mt-0.5">
                    {formData.phantom
                      ? '이 반제품은 재고를 안 만들고, 이걸 쓰는 완제품이 출고될 때 아래 배합비대로 원료가 바로 차감돼요.'
                      : '끄면 이 반제품을 재고(로트)로 관리해요 (볶음참깨처럼 선제조·재고 보유).'}
                  </span>
                </span>
              </button>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                {formData.phantom
                  ? <>배합비(%)를 지정합니다.<br />예) <b className="text-indigo-500">{formData.name || '혼합참기름원액'}</b> = 통깨참기름 <b className="text-indigo-500">60%</b> + 옥수수유 <b className="text-indigo-500">40%</b> (합 100%)</>
                  : <>수율(%)를 지정합니다.<br />예) <b className="text-indigo-500">{formData.name || '통깨참기름'}</b> ← 참깨 <b className="text-indigo-500">45%</b> : 참깨 100kg 사용 → {formData.name || '통깨참기름'} 45kg 생산</>}
              </p>

              {formulaRows.length > 0 && (
                <div className="space-y-1.5">
                  {formulaRows.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="flex-1 min-w-0 truncate bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700">{row.child_name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number" min={0} max={100} inputMode="decimal"
                          value={row.yield_pct === 0 ? '' : row.yield_pct}
                          onChange={e => { const v = e.target.value === '' ? 0 : Number(e.target.value); setFormulaRows(rows => rows.map((r, i) => i === idx ? { ...r, yield_pct: v } : r)); }}
                          placeholder="0"
                          className="w-20 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-right outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                        />
                        <span className="text-sm font-bold text-slate-400">%</span>
                      </div>
                      <button type="button" onClick={() => setFormulaRows(rows => rows.filter((_, i) => i !== idx))} className="shrink-0 p-2 rounded-xl text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="relative" ref={formulaPickerRef}>
                <input
                  type="text"
                  value={formulaChildQuery}
                  onChange={e => { setFormulaChildQuery(e.target.value); setFormulaPickerOpen(true); }}
                  onFocus={() => setFormulaPickerOpen(true)}
                  placeholder="원료 검색해서 추가 (예: 참깨)"
                  className="w-full bg-white border border-dashed border-slate-300 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
                />
                {formulaPickerOpen && formulaChildOptions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-20 overflow-hidden max-h-48 overflow-y-auto custom-scrollbar">
                    {formulaChildOptions.slice(0, 30).map(name => (
                      <button
                        key={name} type="button"
                        onMouseDown={e => { e.preventDefault(); setFormulaRows(rows => [...rows, { child_name: name, yield_pct: 0 }]); setFormulaChildQuery(''); setFormulaPickerOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-all"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!onSaveItemFormula && <p className="text-[10px] font-bold text-amber-500">⚠ 저장 핸들러 미연결 — 배합이 저장되지 않습니다.</p>}
            </div>
          )}

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

          {/* ── 서류 전용 ─────────────────────────────────────────────
               여기 두 개는 판매일지·거래명세서 같은 **서류**에만 쓰인다.
               재고 차감량은 위 구성품(BOM)의 수량이 정하며 이 값들과 무관하다.
               (원료수불부는 이 품목·용량으로 오일 사용량을 따로 집계한다) ── */}
          {(formData.category === 'product' || formData.category === 'wip') && (formData as any).subtype2 !== '배송' && (
            <div className="pt-2 mt-2 border-t-2 border-dashed border-slate-200 space-y-5">
              <div className="flex items-start gap-2">
                <FileText size={15} className="text-slate-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-black text-slate-500 uppercase tracking-widest">서류 전용</p>
                  <p className="text-[11px] font-bold text-slate-400 mt-0.5">판매일지·수불부에만 쓰입니다. 재고 차감에는 영향이 없습니다.</p>
                </div>
              </div>
            {/* 서류용 품목명 (완제품) — 배송(박스)은 낱개로 풀리므로 숨김 */}
            {formData.category === 'product' && (formData as any).subtype2 !== '배송' && (
              <div className="space-y-2" ref={pumokRef}>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                  <Tag size={14} className="mr-2" /> 품목
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

            {/* 용량 (완제품/반제품) — 배송(박스)은 낱개 용량을 따르므로 숨김 */}
            {(formData.category === 'product' || formData.category === 'wip') && (formData as any).subtype2 !== '배송' && (() => {
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
                  <Box size={14} className="mr-2" /> 용량
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
                    onClick={() => setVolUnit(prev => prev === 'ml' ? 'g' : prev === 'g' ? 'kg' : 'ml')}
                    title="단위 전환 (ml → g → kg)"
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
