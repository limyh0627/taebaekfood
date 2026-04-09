
import React, { useState, useMemo } from 'react';
import { X, Search, ShoppingBag, User, ArrowRight, Package, AlertCircle, Phone, Mail, Truck, Store, LayoutGrid, CalendarDays } from 'lucide-react';
import { Product, OrderItem, Order, Client, OrderSource, OrderPallet } from '../types';

interface AddOrderModalProps {
  products: Product[];
  clients: Client[];
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

const AddOrderModal: React.FC<AddOrderModalProps> = ({ products, clients, onClose, onSave }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedItems, setSelectedItems] = useState<{ productId: string, quantity: number | '', isBoxUnit: boolean, unitsPerBox: number, boxType: string, boxSubId?: string }[]>([]);
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
  const [pallets] = useState<OrderPallet[]>([]);
  const [isDelivery, setIsDelivery] = useState(false);

  const quickClients = useMemo(() => {
    const seen = new Set<string>();
    return [...clients]
      .filter(c => !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처')
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'))
      .filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true; })
      .slice(0, 15);
  }, [clients]);

  const filteredClients = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return clients.filter(c =>
      (!c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처') &&
      (matchClient(c.name || '', searchTerm) || (c.phone || '').includes(searchTerm))
    );
  }, [searchTerm, clients]);

  // 거래처 전용 품목 필터링 적용
  const displayProducts = useMemo(() => {
    if (!selectedClient) return [];
    return products.filter(p => {
      if (p.category !== '완제품') return false;
      if (p.clientIds?.includes(selectedClient.id)) return true;
      // 스마트스토어 타입 거래처 선택 시 SMARTSTORE 태그 제품도 표시
      if (selectedClient.type === '스마트스토어' && p.clientIds?.includes('SMARTSTORE')) return true;
      return false;
    });
  }, [products, selectedClient]);

  // 스마트스토어 제외 거래처 → 향미유 목록
  const displayHyangmiyu = useMemo(() => {
    if (!selectedClient || selectedClient.type === '스마트스토어') return [];
    return products.filter(p => p.category === '향미유');
  }, [products, selectedClient]);

  // 스마트스토어 제외 거래처 → 고춧가루 목록
  const displayGochutgaru = useMemo(() => {
    if (!selectedClient || selectedClient.type === '스마트스토어') return [];
    return products.filter(p => p.category === '고춧가루');
  }, [products, selectedClient]);

  // 거래처별 박스 설정 목록 조회
  const getClientBoxConfigs = (productId: string, clientId?: string): { unitsPerBox: number; boxType: string; boxSubId?: string }[] => {
    const p = products.find(pr => pr.id === productId);
    if (!p) return [];
    if (clientId && p.clientBoxConfigs) {
      const cfg = p.clientBoxConfigs.find(c => c.clientId === clientId);
      if (cfg?.configs.length) return cfg.configs.filter(c => c.unitsPerBox > 0);
    }
    if (p.defaultBoxConfig?.unitsPerBox) return [p.defaultBoxConfig];
    const legacy = p.boxSize ?? p.submaterials?.reduce((acc: number, s) => {
      const sub = products.find(pr => pr.id === s.id);
      return sub?.category === '박스' && (sub.boxSize ?? 0) > 0 ? sub.boxSize! : acc;
    }, 0) ?? 0;
    return legacy > 0 ? [{ unitsPerBox: legacy, boxType: '' }] : [];
  };

  const toggleProduct = (productId: string) => {
    setSelectedItems(prev => {
      const exists = prev.find(i => i.productId === productId);
      if (exists) return prev.filter(i => i.productId !== productId);
      const configs = getClientBoxConfigs(productId, selectedClient?.id);
      const first = configs[0] ?? { unitsPerBox: 0, boxType: '', boxSubId: undefined };
      return [...prev, { productId, quantity: 1, isBoxUnit: first.unitsPerBox > 0, unitsPerBox: first.unitsPerBox, boxType: first.boxType, boxSubId: first.boxSubId }];
    });
  };

  const handleQuantityInput = (productId: string, value: string) => {
    const qty = value === '' ? '' : parseInt(value) || '';
    setSelectedItems(prev => prev.map(item =>
      item.productId === productId ? { ...item, quantity: qty } : item
    ));
  };

  const handleQuantityStep = (productId: string, delta: number) => {
    setSelectedItems(prev => prev.map(item => {
      if (item.productId !== productId) return item;
      const current = typeof item.quantity === 'number' ? item.quantity : 1;
      return { ...item, quantity: Math.max(1, current + delta) };
    }));
  };

  const updateItem = (productId: string, patch: Partial<typeof selectedItems[0]>) => {
    setSelectedItems(prev => prev.map(i => i.productId === productId ? { ...i, ...patch } : i));
  };

  const renderItemControls = (product: { id: string; unit?: string; price: number }) => {
    const selection = selectedItems.find(i => i.productId === product.id);
    if (!selection) return null;
    const uPerBox = selection.unitsPerBox ?? 0;
    const boxQty = typeof selection.quantity === 'number' ? selection.quantity : 0;
    const totalUnits = selection.isBoxUnit && uPerBox > 0 ? boxQty * uPerBox : boxQty;
    const availableConfigs = getClientBoxConfigs(product.id, selectedClient?.id);
    return (
      <div className="flex flex-col gap-1.5 bg-slate-50 p-1.5 rounded-xl border border-slate-100" onClick={(e) => e.stopPropagation()}>

        {/* 박스 종류 선택 (박스 모드 + 여러 configs) */}
        {selection.isBoxUnit && availableConfigs.length > 1 && (
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
          {uPerBox > 0 && (
            <button
              type="button"
              onClick={() => {
                const qty = typeof selection.quantity === 'number' && selection.quantity > 0 ? selection.quantity : 1;
                if (selection.isBoxUnit) {
                  updateItem(product.id, { isBoxUnit: false, quantity: 1 });
                } else {
                  updateItem(product.id, { isBoxUnit: true, quantity: Math.ceil(qty / uPerBox) });
                }
              }}
              className={`text-[10px] font-black px-2 py-0.5 rounded-lg border transition-all shrink-0 ${selection.isBoxUnit ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
            >B</button>
          )}
          <button type="button" onClick={() => handleQuantityStep(product.id, -1)} className="text-sm font-black w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 shrink-0">−</button>
          <input type="number" value={selection.quantity === '' ? '' : selection.quantity} onChange={(e) => handleQuantityInput(product.id, e.target.value)} className="text-xs font-black w-full text-center text-slate-800 bg-white border border-slate-200 rounded-lg outline-none py-0.5" />
          <button type="button" onClick={() => handleQuantityStep(product.id, 1)} className="text-sm font-black w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 shrink-0">+</button>
          <span className="text-[10px] font-bold text-slate-400 shrink-0">{selection.isBoxUnit && uPerBox > 0 ? '박스' : (product.unit || '개')}</span>
        </div>

        {/* 합계 */}
        {selection.isBoxUnit && uPerBox > 0 && boxQty > 0 && (
          <div className="flex items-center justify-end px-1">
            <span className="text-[9px] font-black text-indigo-500">× {uPerBox}개 = {totalUnits}개</span>
          </div>
        )}
      </div>
    );
  };


  const handleSubmit = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!selectedClient || selectedItems.length === 0) return;

    const items: OrderItem[] = selectedItems.flatMap(item => {
      if (!item.quantity || item.quantity <= 0) return [];
      const product = products.find(p => p.id === item.productId)
        ?? products.find(p => String(p.id).trim() === String(item.productId).trim());
      if (!product) return [];
      const uPerBox = item.unitsPerBox ?? 0;
      const actualQty = item.isBoxUnit && uPerBox > 0 ? item.quantity * uPerBox : item.quantity;
      return [{
        productId: item.productId,
        name: product.name || '알 수 없는 상품',
        quantity: actualQty,
        price: product.price || 0,
        ...(item.isBoxUnit && uPerBox > 0 ? { isBoxUnit: true, boxQuantity: item.quantity, unitsPerBox: uPerBox, boxType: item.boxType, ...(item.boxSubId ? { boxSubId: item.boxSubId } : {}) } : {}),
      }];
    });

    const totalAmount = selectedItems.reduce((sum, item) => {
      if (!item.quantity || item.quantity <= 0) return sum;
      const product = products.find(p => String(p.id).trim() === String(item.productId).trim());
      const uPerBox = item.unitsPerBox ?? 0;
      const actualQty = item.isBoxUnit && uPerBox > 0 ? item.quantity * uPerBox : item.quantity;
      return sum + (product ? (product.price || 0) * actualQty : 0);
    }, 0);

    onSave({
      clientId: selectedClient.id,
      customerName: `${selectedClient.name || '이름 없음'} (${new Date().toLocaleDateString()})`,
      email: selectedClient.email || '',
      items,
      totalAmount,
      deliveryDate: new Date(deadline).toISOString(),
      source: (isDelivery && source === '일반') ? '택배' : source,
      pallets: pallets.filter(p => p.quantity > 0),
      region: selectedClient.region || '미지정',
      ...(isDelivery ? { deliveryBoxes: [] } : {}),
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={onClose} />
      
      <div className="relative bg-white w-full max-w-3xl rounded-3xl shadow-2xl flex flex-col h-[85vh] max-h-[900px] animate-in zoom-in-95 duration-300">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10 rounded-t-3xl">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-lg shadow-indigo-100"><ShoppingBag size={20} /></div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">신규 주문 생성</h3>
              <p className="text-xs text-slate-500">주문할 품목과 수량을 확인하세요.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
          <section className="space-y-4">
            <div className="flex items-center space-x-2 text-slate-400"><User size={16} /><span className="text-xs font-bold uppercase tracking-widest">거래처 정보</span></div>

            {!selectedClient ? (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input type="text" placeholder="거래처명 또는 초성 검색 (예: ㅌㅂ)..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-4 text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />

                  {filteredClients.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-100 rounded-2xl shadow-xl z-20 overflow-hidden max-h-80 overflow-y-auto custom-scrollbar">
                      {filteredClients.map(client => (
                        <button key={client.id} onClick={() => { setSelectedClient(client); setSource(client.type as OrderSource); setSearchTerm(''); setIsDelivery(client.type === '택배' || client.type === '스마트스토어'); }} className="w-full px-5 py-3 text-left hover:bg-indigo-50 flex items-center justify-between group">
                          <div>
                            <div className="flex items-center space-x-2">
                              <p className="font-bold text-slate-800 text-sm">{client.name || '이름 없음'}</p>
                              {client.region && <span className="text-[9px] text-slate-400">{client.region}</span>}
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
                      {quickClients.map(client => {
                        const typeConfig = {
                          '일반': { icon: User, color: 'bg-indigo-100 text-indigo-600' },
                          '택배': { icon: Truck, color: 'bg-pink-100 text-pink-600' },
                          '스마트스토어': { icon: Store, color: 'bg-lime-100 text-lime-600' },
                        }[client.type] || { icon: LayoutGrid, color: 'bg-slate-100 text-slate-600' };
                        const TypeIcon = typeConfig.icon;
                        return (
                          <button
                            key={client.id}
                            onClick={() => { setSelectedClient(client); setSource(client.type as OrderSource); setIsDelivery(client.type === '택배' || client.type === '스마트스토어'); }}
                            className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-100 transition-all p-4 text-left"
                          >
                            <div className="flex items-center space-x-3 min-w-0">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${typeConfig.color}`}>
                                <TypeIcon size={18} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <h3 className="text-sm font-bold text-slate-900 truncate">{client.name}</h3>
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-black flex-shrink-0 ${typeConfig.color}`}>{client.type}</span>
                                </div>
                                {client.region && (
                                  <p className="text-[11px] text-slate-400 mt-0.5">{client.region}</p>
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
              <div className="grid grid-cols-2 gap-2">
                {displayProducts.length > 0 ? (
                  displayProducts.map(product => {
                    const selection = selectedItems.find(i => String(i.productId).trim() === String(product.id).trim());
                    const isSelected = !!selection;
                    return (
                      <div key={product.id} onClick={() => toggleProduct(product.id)} className={`p-3 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2 ${isSelected ? 'bg-white border-indigo-500 shadow-md ring-1 ring-indigo-500' : 'bg-white border-slate-100 hover:border-indigo-200'}`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}><Package size={16} /></div>
                          <div className="flex flex-col min-w-0">
                            <p className="text-xs font-bold text-slate-800 truncate">{product.name}</p>
                            {(() => {
                              const label = product.submaterials?.find(s => s.category === '라벨')?.name;
                              const vol = product.용량;
                              const parts = [label, vol].filter(Boolean);
                              return parts.length > 0 ? (
                                <p className="text-[9px] text-slate-400 font-bold truncate leading-tight">{parts.join(' · ')}</p>
                              ) : null;
                            })()}
                          </div>
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
                  const selection = selectedItems.find(i => String(i.productId).trim() === String(product.id).trim());
                  const isSelected = !!selection;
                  return (
                    <div key={product.id} onClick={() => toggleProduct(product.id)} className={`p-3 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2 ${isSelected ? 'bg-white border-indigo-500 shadow-md ring-1 ring-indigo-500' : 'bg-white border-slate-100 hover:border-indigo-200'}`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}><Package size={16} /></div>
                        <p className="text-xs font-bold text-slate-800 truncate">{product.name}</p>
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
                  const isSelected = selectedItems.some(i => String(i.productId).trim() === String(product.id).trim());
                  return (
                    <div key={product.id} onClick={() => toggleProduct(product.id)} className={`p-3 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2 ${isSelected ? 'bg-white border-indigo-500 shadow-md ring-1 ring-indigo-500' : 'bg-white border-slate-100 hover:border-indigo-200'}`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}><Package size={16} /></div>
                        <p className="text-xs font-bold text-slate-800 truncate">{product.name}</p>
                      </div>
                      {isSelected && renderItemControls(product)}
                    </div>
                  );
                })}
              </div>}
            </section>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50/50 rounded-b-3xl">
          <div className="grid grid-cols-2 gap-4">
            <button onClick={onClose} className="py-4 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200">취소</button>
            <button disabled={!selectedClient || selectedItems.length === 0} onClick={handleSubmit} className="py-4 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">주문 완료</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddOrderModal;
