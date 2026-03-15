
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
  const [selectedItems, setSelectedItems] = useState<{ productId: string, quantity: number | '', isBoxUnit: boolean }[]>([]);
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

  // 제품 자체 boxSize 또는 박스 submaterial의 boxSize가 있으면 박스 단위 기본값 true
  const getDefaultBoxUnit = (productId: string): boolean => {
    const p = products.find(pr => pr.id === productId);
    if (!p) return false;
    if ((p.boxSize ?? 0) > 0) return true;
    if (!p.submaterials) return false;
    return p.submaterials.some(s => {
      const sub = products.find(pr => pr.id === s.id);
      return sub?.category === '박스' && (sub.boxSize ?? 0) > 0;
    });
  };

  const getBoxSize = (productId: string): number => {
    const p = products.find(pr => pr.id === productId);
    if (!p) return 0;
    // 제품 자체 boxSize 우선 사용 (완제품, 향미유 등)
    if ((p.boxSize ?? 0) > 0) return p.boxSize!;
    // 폴백: submaterial 중 boxSize 있는 항목 사용 (박스/자루/벌크비닐 등 포함)
    if (!p.submaterials) return 0;
    for (const s of p.submaterials) {
      const sub = products.find(pr => pr.id === s.id);
      if (sub && (sub.boxSize ?? 0) > 0) return sub.boxSize!;
    }
    return 0;
  };

  const toggleProduct = (productId: string) => {
    setSelectedItems(prev => {
      const exists = prev.find(i => i.productId === productId);
      if (exists) {
        return prev.filter(i => i.productId !== productId);
      }
      return [...prev, { productId, quantity: 1, isBoxUnit: getDefaultBoxUnit(productId) }];
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

  const toggleBoxUnit = (productId: string) => {
    const boxSize = getBoxSize(productId);
    setSelectedItems(prev => prev.map(item => {
      if (item.productId !== productId) return item;
      const qty = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;
      if (item.isBoxUnit) {
        // B → 개: 박스수 × boxSize
        return { ...item, isBoxUnit: false, quantity: qty * (boxSize || 1) };
      } else {
        // 개 → B: 낱개수 ÷ boxSize (올림)
        return { ...item, isBoxUnit: true, quantity: Math.ceil(qty / (boxSize || 1)) };
      }
    }));
  };

  const handleSubmit = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!selectedClient || selectedItems.length === 0) return;

    const items: OrderItem[] = selectedItems.flatMap(item => {
      if (!item.quantity || item.quantity <= 0) return [];
      const product = products.find(p => p.id === item.productId)
        ?? products.find(p => String(p.id).trim() === String(item.productId).trim());
      if (!product) return [];
      const boxSize = getBoxSize(item.productId);
      const actualQty = item.isBoxUnit && boxSize > 0 ? item.quantity * boxSize : item.quantity;
      return [{
        productId: item.productId,
        name: product.name || '알 수 없는 상품',
        quantity: actualQty,
        price: product.price || 0,
        ...(item.isBoxUnit && boxSize > 0 ? { isBoxUnit: true, boxQuantity: item.quantity } : {}),
      }];
    });

    const totalAmount = selectedItems.reduce((sum, item) => {
      if (!item.quantity || item.quantity <= 0) return sum;
      const product = products.find(p => String(p.id).trim() === String(item.productId).trim());
      const boxSize = getBoxSize(item.productId);
      const actualQty = item.isBoxUnit && boxSize > 0 ? item.quantity * boxSize : item.quantity;
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
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-black">{client.type}</span>
                            </div>
                            <p className="text-xs text-slate-400">{client.phone}</p>
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
                                <div className="flex flex-wrap items-center gap-x-3 mt-0.5 text-slate-400">
                                  {client.phone && <span className="flex items-center text-[11px]"><Phone size={10} className="mr-1" />{client.phone}</span>}
                                  {client.region && <span className="flex items-center text-[11px]"><LayoutGrid size={10} className="mr-1" />{client.region}</span>}
                                </div>
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
                  <p className="text-[10px] text-indigo-500 font-medium">{selectedClient.phone || '연락처 없음'}</p>
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
                            <p className="text-[10px] text-slate-400 font-bold">{product.price.toLocaleString()}원</p>
                          </div>
                        </div>
                        {isSelected && (
                          <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-xl border border-slate-100" onClick={(e) => e.stopPropagation()}>
                            {getBoxSize(product.id) > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleBoxUnit(product.id)}
                                className={`text-[10px] font-black px-2 py-0.5 rounded-lg border transition-all shrink-0 ${selection.isBoxUnit ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
                              >
                                B
                              </button>
                            )}
                            <button type="button" onClick={() => handleQuantityStep(product.id, -1)} className="text-sm font-black w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 shrink-0">−</button>
                          <input type="number" value={selection.quantity === '' ? '' : selection.quantity} onChange={(e) => handleQuantityInput(product.id, e.target.value)} className="text-xs font-black w-full text-center text-slate-800 bg-white border border-slate-200 rounded-lg outline-none py-0.5" />
                          <button type="button" onClick={() => handleQuantityStep(product.id, 1)} className="text-sm font-black w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 shrink-0">+</button>
                            <span className="text-[10px] font-bold text-slate-400 shrink-0">
                              {selection.isBoxUnit && getBoxSize(product.id) > 0 ? '박스' : product.unit || '개'}
                            </span>
                          </div>
                        )}
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
                      {isSelected && (
                        <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-xl border border-slate-100" onClick={(e) => e.stopPropagation()}>
                          {getBoxSize(product.id) > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleBoxUnit(product.id)}
                              className={`text-[10px] font-black px-2 py-0.5 rounded-lg border transition-all shrink-0 ${selection.isBoxUnit ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
                            >
                              B
                            </button>
                          )}
                          <button type="button" onClick={() => handleQuantityStep(product.id, -1)} className="text-sm font-black w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 shrink-0">−</button>
                          <input type="number" value={selection.quantity === '' ? '' : selection.quantity} onChange={(e) => handleQuantityInput(product.id, e.target.value)} className="text-xs font-black w-full text-center text-slate-800 bg-white border border-slate-200 rounded-lg outline-none py-0.5" />
                          <button type="button" onClick={() => handleQuantityStep(product.id, 1)} className="text-sm font-black w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 shrink-0">+</button>
                          <span className="text-[10px] font-bold text-slate-400 shrink-0">
                            {selection.isBoxUnit && getBoxSize(product.id) > 0 ? '박스' : product.unit || 'L'}
                          </span>
                        </div>
                      )}
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
                  const selection = selectedItems.find(i => String(i.productId).trim() === String(product.id).trim());
                  const isSelected = !!selection;
                  return (
                    <div key={product.id} onClick={() => toggleProduct(product.id)} className={`p-3 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2 ${isSelected ? 'bg-white border-indigo-500 shadow-md ring-1 ring-indigo-500' : 'bg-white border-slate-100 hover:border-indigo-200'}`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}><Package size={16} /></div>
                        <p className="text-xs font-bold text-slate-800 truncate">{product.name}</p>
                      </div>
                      {isSelected && (
                        <div className="flex items-center gap-1.5 bg-slate-50 p-1.5 rounded-xl border border-slate-100" onClick={(e) => e.stopPropagation()}>
                          {getBoxSize(product.id) > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleBoxUnit(product.id)}
                              className={`text-[10px] font-black px-2 py-0.5 rounded-lg border transition-all shrink-0 ${selection.isBoxUnit ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200'}`}
                            >
                              B
                            </button>
                          )}
                          <button type="button" onClick={() => handleQuantityStep(product.id, -1)} className="text-sm font-black w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 shrink-0">−</button>
                          <input type="number" value={selection.quantity === '' ? '' : selection.quantity} onChange={(e) => handleQuantityInput(product.id, e.target.value)} className="text-xs font-black w-full text-center text-slate-800 bg-white border border-slate-200 rounded-lg outline-none py-0.5" />
                          <button type="button" onClick={() => handleQuantityStep(product.id, 1)} className="text-sm font-black w-6 h-6 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 shrink-0">+</button>
                          <span className="text-[10px] font-bold text-slate-400 shrink-0">
                            {selection.isBoxUnit && getBoxSize(product.id) > 0 ? '박스' : product.unit || 'kg'}
                          </span>
                        </div>
                      )}
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
