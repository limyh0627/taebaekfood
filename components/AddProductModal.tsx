
import React, { useState, useRef, useEffect } from 'react';
import { X, Package, Tag, Box, Layers, Plus, Hash, ShieldAlert, Building2, Check, Trash2 } from 'lucide-react';
import { Product, InventoryCategory, Client, BoxConfig, ClientBoxConfig } from '../types';

interface ProductModalProps {
  initialData?: Product;
  allSubmaterials?: Product[];
  products?: Product[];
  clients?: Client[];
  onClose: () => void;
  onSave: (_product: Product) => void;
}

const CAT_NORM: Record<string, string> = {
  'Cap': '마개', 'Tape': '테이프', '박스': '박스', '용기': '용기', '라벨': '라벨', '마개': '마개', '테이프': '테이프'
};
const normCat = (c?: string) => c ? (CAT_NORM[c] || c) : '';

const PRESET_PUMOK = [
  '시골향참기름1', '시골향참기름2', '시골향참기름3', '시골향참기름4',
  '시골향들기름1', '시골향들기름2',
  '토마토참기름',
  '새싹참기름', '새싹들기름',
  '시골향볶음참깨', '시골향들깨가루', '시골향탈피들깨가루', '시골향볶음검정참깨',
];

const ProductModal: React.FC<ProductModalProps> = ({ initialData, allSubmaterials = [], products = [], clients = [], onClose, onSave }) => {
  const [formData, setFormData] = useState(() => ({
    name: initialData?.name || '',
    category: (initialData?.category as InventoryCategory) || '완제품',
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
    용량: initialData?.용량 || '',
    품목: initialData?.품목 || '',
    clientIds: initialData?.clientIds ?? (initialData?.clientId ? [initialData.clientId] : []),
    supplierId: initialData?.supplierId || '',
    submaterials: (initialData?.submaterials || []).map(s => ({
      ...s,
      category: normCat(s.category)
    }))
  }));

  const [activeSubCategory, setActiveSubCategory] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [showPumokDrop, setShowPumokDrop] = useState(false);
  const [pumokWarn, setPumokWarn] = useState(false);
  const [expandedBoxClient, setExpandedBoxClient] = useState<string | null>(null);
  const [boxClientSearch, setBoxClientSearch] = useState('');
  const [showBoxClientDrop, setShowBoxClientDrop] = useState(false);
  const boxClientSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxClientSearchRef.current && !boxClientSearchRef.current.contains(e.target as Node)) {
        setShowBoxClientDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const pumokRef = useRef<HTMLDivElement>(null);

  // 품목 드롭다운 외부 클릭 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pumokRef.current && !pumokRef.current.contains(e.target as Node)) {
        setShowPumokDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 품목 자동완성 옵션 (DB 완제품 기존값 + 프리셋)
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

  const categories: InventoryCategory[] = ['완제품', '향미유', '고춧가루', '용기', '마개', '테이프', '박스', '라벨'];

  const handleSubmit = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!formData.name) return;
    if (formData.category === '완제품' && !formData.품목) { setPumokWarn(true); return; }

    const isProductCategory = formData.category === '완제품' || formData.category === '향미유' || formData.category === '고춧가루';
    const hasBoxConfig = formData.defaultBoxConfig.unitsPerBox > 0;

    const finalProduct: Product = {
      id: initialData ? initialData.id : `p-${Date.now()}`,
      name: formData.name,
      category: formData.category,
      price: formData.price,
      stock: formData.stock,
      minStock: formData.category === '완제품' ? 0 : formData.minStock,
      unit: formData.unit,
      image: initialData?.image || '',
      submaterials: formData.category === '완제품'
        ? formData.submaterials
        : (formData.submaterials.length > 0 ? formData.submaterials : (initialData?.submaterials || [])),
      ...(formData.category === '박스' && { freightType: formData.freightType, boxSize: formData.boxSize }),
      ...(isProductCategory && hasBoxConfig && { defaultBoxConfig: formData.defaultBoxConfig }),
      ...(isProductCategory && formData.clientBoxConfigs.length > 0 && { clientBoxConfigs: formData.clientBoxConfigs }),
      ...(formData.용량 && { 용량: formData.용량 }),
      ...(formData.품목 && { 품목: formData.품목 }),
      ...(formData.category === '완제품' && formData.clientIds.length > 0 && { clientIds: formData.clientIds }),
      ...(formData.category !== '완제품' && formData.supplierId && { supplierId: formData.supplierId }),
    };

    onSave(finalProduct);
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={onClose} />

      <div className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 ${initialData ? 'bg-indigo-100 text-indigo-600' : 'bg-indigo-600 text-white'} rounded-xl flex items-center justify-center shadow-lg`}>
              {initialData ? <Package size={20} /> : <Plus size={20} />}
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">{initialData ? '품목 정보 수정' : '신규 품목 등록'}</h3>
              <p className="text-xs text-slate-500">재고가 최소 수량 미만이면 시스템이 감지하여 알려줍니다.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">

          {/* 품목명 */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
              <Tag size={14} className="mr-2" /> 품목명
            </label>
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

          {/* 카테고리 + 단위 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Package size={14} className="mr-2" /> 카테고리
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({...formData, category: e.target.value as InventoryCategory})}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all appearance-none"
              >
                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
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
          </div>

          {/* 매출거래처 (완제품) — 검색 + 그리드 */}
          {formData.category === '완제품' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Building2 size={14} className="mr-2" /> 매출거래처
                {formData.clientIds.length > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 bg-indigo-600 text-white text-[9px] font-black rounded-full">{formData.clientIds.length}</span>
                )}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={clientSearch}
                  onChange={e => setClientSearch(e.target.value)}
                  placeholder="거래처 검색..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-4 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
                />
              </div>
              {salesClients.length === 0 ? (
                <p className="text-xs text-slate-400 px-1">등록된 매출거래처 없음</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                  {salesClients
                    .filter(c => !clientSearch.trim() || c.name.toLowerCase().includes(clientSearch.toLowerCase()))
                    .map(c => {
                      const checked = formData.clientIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            const next = checked
                              ? formData.clientIds.filter(id => id !== c.id)
                              : [...formData.clientIds, c.id];
                            setFormData({...formData, clientIds: next});
                          }}
                          className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold border transition-all text-left ${
                            checked
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                              : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600'
                          }`}
                        >
                          {checked && <Check size={10} className="shrink-0" />}
                          <span className="truncate">{c.name}</span>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* BOM 설정 (완제품) — 매출거래처 바로 아래 */}
          {formData.category === '완제품' && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Layers size={14} className="mr-2" /> 구성 부자재 (BOM)
              </label>
              <div className="space-y-2">
                {(['용기', '마개', '라벨', '박스', '테이프'] as const).map(cat => {
                  const getSubCat = (s: typeof formData.submaterials[0]) => {
                    if (s.category) return normCat(s.category);
                    return normCat(allSubmaterials.find(a => a.id === s.id)?.category || '');
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
                              <span className="text-[10px] font-black text-indigo-400 bg-indigo-100/50 px-1.5 py-0.5 rounded">{selectedSub.stock}{selectedSub.unit}</span>
                            </div>
                          ) : (
                            <span className="text-sm font-medium text-slate-400">{cat} 선택 안함</span>
                          )}
                        </div>
                        <Plus size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-45' : ''}`} />
                      </button>

                      {isOpen && (
                        <div className="p-4 bg-white border-t border-slate-100 animate-in slide-in-from-top-2 duration-200">
                          <div className="grid grid-cols-1 gap-2 mb-4">
                            <button
                              type="button"
                              onClick={() => {
                                setFormData({ ...formData, submaterials: formData.submaterials.filter(s => getSubCat(s) !== cat) });
                                setActiveSubCategory(null);
                              }}
                              className={`flex items-center justify-between px-4 py-3 rounded-xl text-xs font-bold transition-all border ${!selectedSub ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-100'}`}
                            >
                              <span>{cat} 선택 안함</span>
                              {!selectedSub && <div className="w-2 h-2 bg-indigo-600 rounded-full" />}
                            </button>

                            {allSubmaterials.filter(s => s.category === cat).map(sub => {
                              const isSelected = selectedSub?.id === sub.id;
                              return (
                                <button
                                  key={sub.id}
                                  type="button"
                                  onClick={() => {
                                    const filtered = formData.submaterials.filter(s => getSubCat(s) !== cat);
                                    const autoCapacity = cat === '용기' ? (allSubmaterials.find(a => a.id === sub.id) as Product | undefined)?.용량 || '' : formData.용량;
                                    setFormData({
                                      ...formData,
                                      submaterials: [...filtered, {
                                        id: sub.id,
                                        name: sub.name,
                                        category: cat,
                                        stock: selectedSub?.stock || 1,
                                        unit: sub.unit
                                      }],
                                      ...(cat === '용기' && { 용량: autoCapacity }),
                                    });
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

                          {selectedSub && (
                            <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3 border border-slate-100">
                              <div className="flex items-center space-x-2">
                                <span className="text-[10px] font-black text-slate-400 uppercase">필요 수량</span>
                                <div className="flex items-center bg-white border border-slate-200 rounded-lg px-2 py-1">
                                  <input
                                    type="number"
                                    value={selectedSub.stock}
                                    onChange={(e) => {
                                      const newQty = Math.max(1, Number(e.target.value));
                                      setFormData({
                                        ...formData,
                                        submaterials: formData.submaterials.map(s => s.id === selectedSub.id ? { ...s, stock: newQty } : s)
                                      });
                                    }}
                                    className="w-12 text-center text-xs font-black outline-none"
                                  />
                                  <span className="text-[10px] font-bold text-slate-400 ml-1">{selectedSub.unit}</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 박스 설정 (완제품/향미유/고춧가루) */}
          {(formData.category === '완제품' || formData.category === '향미유' || formData.category === '고춧가루') && (() => {
            const boxSubs = allSubmaterials.filter(s => s.category === '박스');

            // 박스 선택 + 개수 입력 공통 컴포넌트 (inline)
            const BoxConfigRow = ({
              config,
              onSelect,
              onChangeQty,
              onRemove,
            }: {
              config: { boxType: string; unitsPerBox: number; boxSubId?: string };
              onSelect: (sub: typeof boxSubs[0]) => void;
              onChangeQty: (val: number) => void;
              onRemove?: () => void;
            }) => (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {boxSubs.map(sub => {
                    const isSel = config.boxSubId === sub.id;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => onSelect(sub)}
                        className={`flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-lg border transition-all ${
                          isSel
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                        }`}
                      >
                        {sub.name}
                        {sub.boxSize ? <span className={`text-[9px] ${isSel ? 'text-indigo-200' : 'text-slate-400'}`}>/{sub.boxSize}개</span> : null}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 shrink-0">박스당</span>
                  <input
                    type="number"
                    min={1}
                    placeholder="개수"
                    value={config.unitsPerBox === 0 ? '' : config.unitsPerBox}
                    onChange={(e) => onChangeQty(e.target.value === '' ? 0 : Number(e.target.value))}
                    className="w-16 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-black text-center outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <span className="text-[10px] text-slate-400 shrink-0">개</span>
                  {config.boxType && <span className="text-[10px] font-bold text-indigo-500 truncate">{config.boxType}</span>}
                  {onRemove && (
                    <button type="button" onClick={onRemove} className="ml-auto text-rose-400 hover:text-rose-600 shrink-0">
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            );

            return (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Box size={14} className="mr-2" /> 박스 설정
              </label>

              {/* 기본 박스 설정 */}
              <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">기본 박스 설정</p>
                <BoxConfigRow
                  config={formData.defaultBoxConfig}
                  onSelect={(sub) => setFormData({ ...formData, defaultBoxConfig: {
                    boxType: sub.name,
                    unitsPerBox: formData.defaultBoxConfig.unitsPerBox || sub.boxSize || 0,
                    boxSubId: sub.id,
                  }})}
                  onChangeQty={(val) => setFormData({ ...formData, defaultBoxConfig: { ...formData.defaultBoxConfig, unitsPerBox: val } })}
                />
              </div>

              {/* 거래처별 박스 설정 */}
              <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">거래처별 박스 설정</p>

                {formData.clientBoxConfigs.map((cfg) => {
                  const clientName = clients.find(c => c.id === cfg.clientId)?.name || cfg.clientId;
                  const isExpanded = expandedBoxClient === cfg.clientId;
                  return (
                    <div key={cfg.clientId} className="bg-white border border-slate-100 rounded-xl overflow-hidden">
                      <div
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors"
                        onClick={() => setExpandedBoxClient(isExpanded ? null : cfg.clientId)}
                      >
                        <span className="text-xs font-bold text-slate-700 flex-1 truncate">{clientName}</span>
                        <span className="text-[10px] font-bold text-slate-400 shrink-0">{cfg.configs.length}개 설정</span>
                        <span className="text-[10px] text-slate-400">{isExpanded ? '▲' : '▼'}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFormData({ ...formData, clientBoxConfigs: formData.clientBoxConfigs.filter(c => c.clientId !== cfg.clientId) });
                            if (expandedBoxClient === cfg.clientId) setExpandedBoxClient(null);
                          }}
                          className="text-rose-400 hover:text-rose-600 shrink-0"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-slate-100 p-3 space-y-3">
                          {cfg.configs.map((box, boxIdx) => (
                            <BoxConfigRow
                              key={boxIdx}
                              config={box}
                              onSelect={(sub) => {
                                const next = formData.clientBoxConfigs.map(c =>
                                  c.clientId !== cfg.clientId ? c : {
                                    ...c,
                                    configs: c.configs.map((b, i) => i === boxIdx ? {
                                      boxType: sub.name,
                                      unitsPerBox: b.unitsPerBox || sub.boxSize || 0,
                                      boxSubId: sub.id,
                                    } : b)
                                  }
                                );
                                setFormData({ ...formData, clientBoxConfigs: next });
                              }}
                              onChangeQty={(val) => {
                                const next = formData.clientBoxConfigs.map(c =>
                                  c.clientId !== cfg.clientId ? c : {
                                    ...c,
                                    configs: c.configs.map((b, i) => i === boxIdx ? { ...b, unitsPerBox: val } : b)
                                  }
                                );
                                setFormData({ ...formData, clientBoxConfigs: next });
                              }}
                              onRemove={() => {
                                const next = formData.clientBoxConfigs.map(c =>
                                  c.clientId !== cfg.clientId ? c : { ...c, configs: c.configs.filter((_, i) => i !== boxIdx) }
                                );
                                setFormData({ ...formData, clientBoxConfigs: next });
                              }}
                            />
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              const next = formData.clientBoxConfigs.map(c =>
                                c.clientId !== cfg.clientId ? c : {
                                  ...c,
                                  configs: [...c.configs, { boxType: '', unitsPerBox: 0 }]
                                }
                              );
                              setFormData({ ...formData, clientBoxConfigs: next });
                            }}
                            className="w-full py-1.5 text-[10px] font-bold text-indigo-500 border border-dashed border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                          >
                            + 박스 설정 추가
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* 거래처 추가 — 검색 + 드롭다운 */}
                {(() => {
                  const addedIds = formData.clientBoxConfigs.map(c => c.clientId);
                  const pool = (formData.category === '완제품' ? salesClients : clients).filter(c => !addedIds.includes(c.id));
                  if (pool.length === 0) return null;
                  const filtered = boxClientSearch.trim()
                    ? pool.filter(c => c.name.toLowerCase().includes(boxClientSearch.toLowerCase()))
                    : pool;
                  const addClient = (id: string) => {
                    const newCfg: ClientBoxConfig = {
                      clientId: id,
                      configs: formData.defaultBoxConfig.unitsPerBox > 0
                        ? [{ boxType: formData.defaultBoxConfig.boxType, unitsPerBox: formData.defaultBoxConfig.unitsPerBox }]
                        : [{ boxType: '', unitsPerBox: 0 }],
                    };
                    setFormData({ ...formData, clientBoxConfigs: [...formData.clientBoxConfigs, newCfg] });
                    setExpandedBoxClient(id);
                    setBoxClientSearch('');
                    setShowBoxClientDrop(false);
                  };
                  return (
                    <div ref={boxClientSearchRef} className="relative">
                      <div className="relative">
                        <Plus size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none" />
                        <input
                          type="text"
                          placeholder="거래처 검색 후 추가..."
                          value={boxClientSearch}
                          onFocus={() => setShowBoxClientDrop(true)}
                          onChange={(e) => { setBoxClientSearch(e.target.value); setShowBoxClientDrop(true); }}
                          className="w-full bg-white border border-dashed border-indigo-200 rounded-xl pl-8 pr-3 py-2 text-xs font-bold text-slate-700 placeholder:text-indigo-400 outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-300 transition-all"
                        />
                      </div>
                      {showBoxClientDrop && filtered.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden max-h-48 overflow-y-auto custom-scrollbar">
                          {filtered.map(c => (
                            <button
                              key={c.id}
                              type="button"
                              onMouseDown={() => addClient(c.id)}
                              className="w-full px-4 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 flex items-center justify-between transition-colors"
                            >
                              <span>{c.name}</span>
                              {c.type && <span className="text-[9px] font-black text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{c.type}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
            );
          })()}

          {/* 1박스 당 수량 (박스 부자재) */}
          {formData.category === '박스' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Hash size={14} className="mr-2" /> 1박스 당 수량 (개)
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

          {/* 용량 (용기 카테고리 또는 완제품) */}
          {(formData.category === '용기' || formData.category === '완제품') && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Box size={14} className="mr-2" /> 용량 (서류용)
                {formData.category === '완제품' && (
                  <span className="ml-2 text-[10px] font-normal text-slate-400 normal-case tracking-normal">용기 선택 시 자동 입력, 직접 수정 가능</span>
                )}
              </label>
              <input
                type="text"
                value={formData.용량}
                onChange={(e) => setFormData({...formData, 용량: e.target.value})}
                placeholder="예: 200g, 500g, 1kg, 300ml"
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
          )}

          {/* 서류용 품목명 (완제품) — 커스텀 드롭다운 */}
          {formData.category === '완제품' && (
            <div className="space-y-2" ref={pumokRef}>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Tag size={14} className="mr-2" /> 품목 (서류용)
              </label>
              {pumokWarn && <p className="text-xs font-bold text-red-500">서류용 품목을 선택해주세요.</p>}
              <div className="relative">
                <input
                  type="text"
                  value={formData.품목}
                  onChange={(e) => { setFormData({...formData, 품목: e.target.value}); setShowPumokDrop(true); setPumokWarn(false); }}
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
                        onMouseDown={(e) => { e.preventDefault(); setFormData({...formData, 품목: v}); setShowPumokDrop(false); }}
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

          {/* 매입거래처 (비완제품) */}
          {formData.category !== '완제품' && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Building2 size={14} className="mr-2" /> 매입거래처
              </label>
              <select
                value={formData.supplierId}
                onChange={(e) => setFormData({...formData, supplierId: e.target.value})}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all appearance-none"
              >
                <option value="">선택 안 함</option>
                {supplierClients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* 운임타입 (박스) */}
          {formData.category === '박스' && (
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

          {/* 재고량 + 최소 수량 */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center">
                <Hash size={14} className="mr-2" /> 현재 재고량
              </label>
              <input
                type="number"
                value={formData.stock}
                onChange={(e) => setFormData({...formData, stock: Number(e.target.value)})}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className={`text-xs font-bold uppercase tracking-widest flex items-center ${formData.category === '완제품' ? 'text-slate-200' : 'text-amber-600'}`}>
                <ShieldAlert size={14} className="mr-2" /> 최소 수량 알림
              </label>
              <input
                disabled={formData.category === '완제품'}
                type="number"
                value={formData.category === '완제품' ? 0 : formData.minStock}
                onChange={(e) => setFormData({...formData, minStock: Number(e.target.value)})}
                className="w-full bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3.5 text-sm font-bold text-amber-700 outline-none focus:ring-2 focus:ring-amber-500 transition-all disabled:opacity-30"
              />
            </div>
          </div>

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
