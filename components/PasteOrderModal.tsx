
import React, { useState, useMemo, useEffect } from 'react';
import { X, ClipboardPaste, CheckCircle2, AlertCircle, ChevronDown, User, Truck, Store, LayoutGrid, Search, ArrowRight, ShoppingBag } from 'lucide-react';
import { Product, ProductClient, Order, Client, OrderSource, OrderItem, OrderPallet } from '../types';

// ── 퍼지 매칭 ───────────────────────────────────────────────
const getBigrams = (s: string) => {
  const clean = s.toLowerCase().replace(/\s+/g, '');
  const set = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
};
const bigramSim = (a: string, b: string) => {
  const ba = getBigrams(a), bb = getBigrams(b);
  if (!ba.size || !bb.size) return 0;
  return (2 * [...ba].filter(x => bb.has(x)).length) / (ba.size + bb.size);
};
const scoreProduct = (name: string, query: string): number => {
  const pn = name.toLowerCase().replace(/\s+/g, '');
  const q  = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  if (pn === q) return 1;
  if (pn.includes(q) || q.includes(pn)) return 0.85;
  return bigramSim(pn, q);
};

type ParsedLine = {
  rawText: string;
  rawName: string;
  qty: number;
  isBox: boolean;
  selectedProductId: string | null;
};

const parseLine = (line: string, pool: Product[]): ParsedLine => {
  // "3박스", "5개", "1kg" 형태에서 마지막 수량+단위 추출
  // ※ \b 는 한글(非ASCII) 뒤에서 동작하지 않으므로 (?:\s|$) 로 대체
  const re = /(\d+(?:\.\d+)?)\s*(박스|box|개|kg|g|L|ml|l)(?=\s|$)/gi;
  let qty = 1, isBox = true, m: RegExpExecArray | null, last: RegExpExecArray | null = null;
  while ((m = re.exec(line)) !== null) last = m;
  if (last) {
    qty = parseFloat(last[1]);
    isBox = /박스|box/i.test(last[2]);
  }
  const rawName = line.replace(/\d+(?:\.\d+)?\s*(?:박스|box|개|kg|g|L|ml|l)(?=\s|$)/gi, '').trim();
  const scored = pool
    .map(p => ({ product: p, score: scoreProduct(p.name, rawName) }))
    .sort((a, b) => b.score - a.score);
  return {
    rawText: line,
    rawName,
    qty,
    isBox,
    selectedProductId: scored[0]?.score >= 0.25 ? scored[0].product.id : null,
  };
};

// ── 초성 검색 ────────────────────────────────────────────────
const CHOSUNG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const getChosung = (str: string) =>
  str.split('').map(c => {
    const code = c.charCodeAt(0) - 44032;
    return code >= 0 && code <= 11171 ? CHOSUNG[Math.floor(code / 588)] : c;
  }).join('');
const COMPOUND_MAP: Record<string, string> = {
  'ㄳ':'ㄱㅅ','ㄵ':'ㄴㅈ','ㄶ':'ㄴㅎ','ㄺ':'ㄹㄱ','ㄻ':'ㄹㅁ',
  'ㄼ':'ㄹㅂ','ㄽ':'ㄹㅅ','ㄾ':'ㄹㅌ','ㄿ':'ㄹㅍ','ㅀ':'ㄹㅎ','ㅄ':'ㅂㅅ',
};
const decompound = (str: string) => str.split('').map(c => COMPOUND_MAP[c] ?? c).join('');
const matchClient = (name: string, q: string) => {
  if (!q.trim()) return false;
  if (/^[ㄱ-ㅎ]+$/.test(q)) return getChosung(name).includes(decompound(q));
  return name.toLowerCase().includes(q.toLowerCase());
};

// ── Props ────────────────────────────────────────────────────
interface PasteOrderModalProps {
  products: Product[];
  clients: Client[];
  productClients: ProductClient[];
  onClose: () => void;
  onSave: (_order: Omit<Order, 'id' | 'createdAt' | 'status'>) => void;
}

type Step = 'client' | 'paste' | 'review';

const PasteOrderModal: React.FC<PasteOrderModalProps> = ({
  products, clients, productClients, onClose, onSave,
}) => {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const [step, setStep] = useState<Step>('client');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [parsedLines, setParsedLines] = useState<ParsedLine[]>([]);
  const [isDelivery, setIsDelivery] = useState(false);
  const [deadline, setDeadline] = useState(() => {
    const d = new Date(Date.now() + 86400000 * 3);
    const day = d.getDay();
    if (day === 6) d.setDate(d.getDate() + 2);
    else if (day === 0) d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [pallets] = useState<OrderPallet[]>([]);

  // 거래처별 품목 풀
  const productPool = useMemo(() => {
    if (!selectedClient) return [];
    const main = products.filter(p => {
      if (p.category !== '완제품') return false;
      if (p.clientIds?.includes(selectedClient.id)) return true;
      if (selectedClient.type === '스마트스토어' && (p.clientIds?.includes('SMARTSTORE') || p.isSmartStore)) return true;
      return false;
    });
    const hyangmiyu = selectedClient.type !== '스마트스토어'
      ? products.filter(p => p.category === '향미유') : [];
    const gochu = selectedClient.type !== '스마트스토어'
      ? products.filter(p => p.category === '고춧가루') : [];
    return [...main, ...hyangmiyu, ...gochu];
  }, [products, selectedClient]);

  const filteredClients = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return clients.filter(c =>
      (!c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처') &&
      matchClient(c.name || '', searchTerm)
    );
  }, [searchTerm, clients]);

  const quickClients = useMemo(() => {
    const seen = new Set<string>();
    return clients
      .filter(c => !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처')
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'))
      .filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true; })
      .slice(0, 12);
  }, [clients]);

  const analyze = () => {
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean);
    setParsedLines(lines.map(l => parseLine(l, productPool)));
    setStep('review');
  };

  const getBoxConfig = (productId: string) => {
    const pc = productClients.find(p => p.productId === productId && p.clientId === selectedClient?.id);
    if (pc?.boxTypeId) return { unitsPerBox: pc.qtyPerBox ?? 0, boxType: pc.boxTypeId, boxSubId: pc.boxTypeId };
    const p = products.find(pr => pr.id === productId);
    if (p?.defaultBoxConfig?.unitsPerBox) return p.defaultBoxConfig;
    return { unitsPerBox: 0, boxType: '' };
  };

  const handleSubmit = () => {
    if (!selectedClient) return;
    const validLines = parsedLines.filter(l => l.selectedProductId && l.qty > 0);
    const items: OrderItem[] = validLines.flatMap(line => {
      const product = products.find(p => p.id === line.selectedProductId);
      if (!product) return [];
      const cfg = getBoxConfig(line.selectedProductId!);
      const uPerBox = cfg.unitsPerBox;
      const actualQty = line.isBox && uPerBox > 0 ? line.qty * uPerBox : line.qty;
      return [{
        productId: line.selectedProductId!,
        name: product.name,
        quantity: actualQty,
        price: product.price || 0,
        ...(line.isBox ? {
          isBoxUnit: true,
          boxQuantity: line.qty,
          ...(uPerBox > 0 ? { unitsPerBox: uPerBox, boxType: cfg.boxType } : {}),
        } : {}),
      }];
    });
    if (!items.length) return;
    const totalAmount = items.reduce((s, i) => s + i.price * i.quantity, 0);
    onSave({
      clientId: selectedClient.id,
      customerName: selectedClient.name,
      email: selectedClient.email || '',
      items,
      totalAmount,
      deliveryDate: new Date(deadline).toISOString(),
      source: (isDelivery ? '택배' : '일반') as OrderSource,
      pallets: pallets.filter(p => p.quantity > 0),
      region: selectedClient.region || '미지정',
      ...(isDelivery ? { deliveryBoxes: [] } : {}),
    });
  };

  const typeConfig = (type: string) => ({
    '일반': { icon: User, color: 'bg-indigo-100 text-indigo-600' },
    '택배': { icon: Truck, color: 'bg-pink-100 text-pink-600' },
    '스마트스토어': { icon: Store, color: 'bg-lime-100 text-lime-600' },
  }[type] || { icon: LayoutGrid, color: 'bg-slate-100 text-slate-600' });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col h-[85vh] max-h-[860px] animate-in zoom-in-95 duration-300">

        {/* 헤더 */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between rounded-t-3xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-violet-600 text-white rounded-xl flex items-center justify-center shadow-lg shadow-violet-100">
              <ClipboardPaste size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">복사 주문</h3>
              <p className="text-xs text-slate-400">
                {step === 'client' ? '거래처를 선택하세요' : step === 'paste' ? '주문 내용을 붙여넣으세요' : '매칭 결과를 확인하세요'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all">
            <X size={20} />
          </button>
        </div>

        {/* 스텝 인디케이터 */}
        <div className="px-6 pt-4 flex items-center gap-2">
          {(['client', 'paste', 'review'] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1.5 text-[11px] font-black ${step === s ? 'text-violet-600' : i < ['client','paste','review'].indexOf(step) ? 'text-emerald-500' : 'text-slate-300'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${step === s ? 'bg-violet-600 text-white' : i < ['client','paste','review'].indexOf(step) ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-300'}`}>
                  {i + 1}
                </div>
                {s === 'client' ? '거래처' : s === 'paste' ? '입력' : '확인'}
              </div>
              {i < 2 && <div className={`flex-1 h-0.5 rounded ${i < ['client','paste','review'].indexOf(step) ? 'bg-emerald-300' : 'bg-slate-100'}`} />}
            </React.Fragment>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {/* ── STEP 1: 거래처 선택 ── */}
          {step === 'client' && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input type="text" placeholder="거래처명 검색..." value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-3 text-sm outline-none focus:ring-2 focus:ring-violet-400" />
                {filteredClients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-100 rounded-2xl shadow-xl z-20 overflow-hidden max-h-60 overflow-y-auto">
                    {filteredClients.map(c => (
                      <button key={c.id} onClick={() => { setSelectedClient(c); setIsDelivery(c.type === '택배' || c.type === '스마트스토어'); setSearchTerm(''); setStep('paste'); }}
                        className="w-full px-5 py-3 text-left hover:bg-violet-50 flex items-center justify-between">
                        <p className="font-bold text-slate-800 text-sm">{c.name}</p>
                        <ArrowRight size={16} className="text-slate-300" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!searchTerm && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {quickClients.map(c => {
                    const cfg = typeConfig(c.type);
                    const Icon = cfg.icon;
                    return (
                      <button key={c.id}
                        onClick={() => { setSelectedClient(c); setIsDelivery(c.type === '택배' || c.type === '스마트스토어'); setStep('paste'); }}
                        className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-violet-100 p-3 text-left transition-all">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${cfg.color}`}><Icon size={16} /></div>
                          <span className="text-xs font-bold text-slate-900 truncate">{c.name}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: 붙여넣기 ── */}
          {step === 'paste' && selectedClient && (
            <div className="space-y-4">
              {/* 선택된 거래처 */}
              <div className="bg-violet-50 border border-violet-100 px-4 py-2.5 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-black text-violet-900 text-sm">{selectedClient.name}</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[8px] font-black">{selectedClient.type}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                    className="text-[10px] font-bold text-violet-700 bg-white border border-violet-200 rounded-lg px-2 py-1.5 outline-none" />
                  <button onClick={() => { setSelectedClient(null); setStep('client'); }}
                    className="text-[10px] font-bold text-violet-400 hover:text-violet-600 underline">변경</button>
                </div>
              </div>

              <div>
                <p className="text-xs font-black text-slate-500 mb-2">주문 내용 붙여넣기</p>
                <textarea
                  autoFocus
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder={"주문 내용을 그대로 붙여넣으세요.\n\n예)\n청정 검정깨 3박스\n검정깨가루 3박스\n탈피들깨 5박스\n들깨중간 1kg 3박스"}
                  className="w-full h-52 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-violet-400 resize-none placeholder:text-slate-300 leading-relaxed"
                />
                <p className="text-[10px] text-slate-400 mt-1.5 px-1">한 줄에 품목 하나씩 — 품목명 + 수량 + 단위(박스/개)</p>
              </div>
            </div>
          )}

          {/* ── STEP 3: 확인 ── */}
          {step === 'review' && (
            <div className="space-y-3">
              {parsedLines.map((line, idx) => {
                const matched = line.selectedProductId
                  ? productPool.find(p => p.id === line.selectedProductId) : null;
                return (
                  <div key={idx} className={`rounded-2xl border p-3 space-y-2 ${line.selectedProductId ? 'bg-white border-slate-100' : 'bg-rose-50 border-rose-200'}`}>
                    {/* 원문 + 상태 */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-400 font-medium truncate">"{line.rawText}"</span>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ${line.selectedProductId ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
                        {line.selectedProductId ? '매칭됨' : '미매칭'}
                      </span>
                    </div>
                    {/* 품목 선택 + 수량 */}
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <select
                          value={line.selectedProductId ?? ''}
                          onChange={e => {
                            const val = e.target.value || null;
                            setParsedLines(prev => prev.map((l, i) => i === idx ? { ...l, selectedProductId: val } : l));
                          }}
                          className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-400 pr-7"
                        >
                          <option value="">— 제외 —</option>
                          {productPool.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <input type="number" min={1} value={line.qty}
                          onChange={e => {
                            const qty = Math.max(1, parseInt(e.target.value) || 1);
                            setParsedLines(prev => prev.map((l, i) => i === idx ? { ...l, qty } : l));
                          }}
                          className="w-14 text-center bg-slate-50 border border-slate-200 rounded-xl py-2 text-xs font-black outline-none focus:ring-2 focus:ring-violet-400"
                        />
                        <div className="flex flex-col gap-0.5">
                          {(['박스', '개'] as const).map(unit => (
                            <button key={unit} type="button"
                              onClick={() => setParsedLines(prev => prev.map((l, i) => i === idx ? { ...l, isBox: unit === '박스' } : l))}
                              className={`text-[9px] font-black px-1.5 py-0.5 rounded border transition-all ${(unit === '박스') === line.isBox ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-400 border-slate-200'}`}
                            >{unit}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {matched && (() => {
                      const pc = productClients.find(p => p.productId === matched.id && p.clientId === selectedClient?.id);
                      const subs: string[] = [];
                      if (pc?.boxTypeId) { const b = products.find(p => p.id === pc.boxTypeId); if (b) subs.push(b.name); }
                      if (pc?.tapeTypeId) { const t = products.find(p => p.id === pc.tapeTypeId); if (t) subs.push(t.name); }
                      if (!subs.length) {
                        (matched.submaterials ?? []).forEach(sm => {
                          const fullSub = products.find(p => p.id === sm.id);
                          const cat = fullSub?.category || sm.category || '';
                          if (['마개', '테이프', '박스', '용기', '라벨', 'Cap', 'Tape'].includes(cat)) subs.push(sm.name);
                        });
                      }
                      return (
                        <div className="flex flex-wrap items-center gap-1">
                          <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                          <span className="text-[10px] font-bold text-emerald-700">{matched.name} · {line.qty}{line.isBox ? '박스' : '개'}</span>
                          {subs.map((name, i) => (
                            <span key={i} className="text-[8px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">{name}</span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
              {parsedLines.every(l => !l.selectedProductId) && (
                <div className="text-center py-8 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                  <AlertCircle className="text-slate-300 mx-auto mb-2" size={28} />
                  <p className="text-slate-400 text-sm font-bold">매칭된 품목이 없습니다</p>
                  <p className="text-[11px] text-slate-300 mt-1">드롭다운에서 직접 선택해주세요</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="p-6 border-t border-slate-100 bg-slate-50/50 rounded-b-3xl">
          {step === 'client' && (
            <button onClick={onClose} className="w-full py-3.5 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200">취소</button>
          )}
          {step === 'paste' && (
            <div className="flex gap-3">
              <button onClick={() => setStep('client')} className="flex-1 py-3.5 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200">이전</button>
              <button onClick={analyze} disabled={!pasteText.trim()}
                className="flex-1 py-3.5 rounded-2xl font-black text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 transition-all">
                분석하기
              </button>
            </div>
          )}
          {step === 'review' && (
            <div className="flex gap-3">
              <button onClick={() => setStep('paste')} className="flex-1 py-3.5 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200">다시 입력</button>
              <button
                onClick={handleSubmit}
                disabled={!parsedLines.some(l => l.selectedProductId && l.qty > 0)}
                className="flex-1 py-3.5 rounded-2xl font-black text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 transition-all"
              >
                주문 생성 ({parsedLines.filter(l => l.selectedProductId).length}건)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PasteOrderModal;
