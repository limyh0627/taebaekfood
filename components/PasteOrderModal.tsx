
import React, { useState, useMemo, useEffect } from 'react';
import { ClipboardPaste, CheckCircle2, AlertCircle, ChevronDown, User, Truck, Store, LayoutGrid, Search, ArrowRight, ShoppingBag, Layers, CalendarDays } from 'lucide-react';
import { Item, PartnerItem, Order, Partner, OrderSource, OrderItem, OrderPallet, PalletStock } from '../types';
import OrderCreationModalHeader from '../src/shared/components/OrderCreationModalHeader';
import ModalActionFooter from '../src/shared/components/ModalActionFooter';
import { bomOf } from '../src/shared/bomIndex';
import { sellsTo } from '../src/shared/partnerRole';
import { channelStyle } from '../src/shared/channelStyle';
import { isSmartStoreItem } from '../src/shared/partnerPrice';

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
/**
 * 붙여넣은 글과 품목이 얼마나 닮았나.
 *
 * **이름만 보면 안 된다** — 낱개와 그 박스들이 **같은 이름**을 쓴다(`볶음참깨/1kg`).
 * 규격으로만 갈리므로 이름만 보면 점수가 같아 아무거나 잡힌다.
 * 그래서 이름과 `이름 규격` 둘 다 재서 높은 쪽을 쓴다.
 */
const scoreOne = (target: string, q: string): number => {
  const pn = target.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  if (pn === q) return 1;
  if (pn.includes(q) || q.includes(pn)) return 0.85;
  return bigramSim(pn, q);
};

const scoreProduct = (product: { name: string; spec?: string }, query: string): number => {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const 이름 = scoreOne(product.name, q);
  const 규격까지 = product.spec ? scoreOne(`${product.name} ${product.spec}`, q) : 0;
  return Math.max(이름, 규격까지);
};

type ParsedLine = {
  rawText: string;
  rawName: string;
  qty: number;
  isBox: boolean;
  selectedProductId: string | null;
};

const parseLine = (line: string, pool: Item[]): ParsedLine => {
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
    .map(p => ({ product: p, score: scoreProduct(p, rawName) }))
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
  items: Item[];
  partners: Partner[];
  partnerItems?: import('../src/shared/types').PartnerItem[];
  palletStocks: PalletStock[];
  onClose: () => void;
  onBack?: () => void;
  onSave: (_order: Omit<Order, 'id' | 'status'>) => void;
}

type Step = 'partner' | 'paste' | 'review';

const PasteOrderModal: React.FC<PasteOrderModalProps> = ({
  items, partners, partnerItems, palletStocks, onClose, onBack, onSave,
}) => {
  const products = items;
  const partnerOut = (partnerItems ?? []).filter((pi: any) => pi.Direction === 'out');
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const [step, setStep] = useState<Step>('partner');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClient, setSelectedClient] = useState<Partner | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [parsedLines, setParsedLines] = useState<ParsedLine[]>([]);
  const [isDelivery, setIsDelivery] = useState(false);
  const [orderDate, setOrderDate] = useState(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()));
  const [deadline, setDeadline] = useState(() => {
    const d = new Date(Date.now() + 86400000 * 3);
    const day = d.getDay();
    if (day === 6) d.setDate(d.getDate() + 2);
    else if (day === 0) d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [pallets, setPallets] = useState<OrderPallet[]>([]);

  const selectClient = (client: Partner) => {
    setSelectedClient(client);
    setIsDelivery(client.type === '택배' || client.type === '스마트스토어');
    setSearchTerm('');
    setStep('paste');
  };

  const changeClient = () => {
    setSelectedClient(null);
    setPasteText('');
    setParsedLines([]);
    setPallets([]);
    setIsDelivery(false);
    setSearchTerm('');
    setStep('partner');
  };

  // 거래처별 품목 풀 — 거래처에 연결된 품목만 포함
  /**
   * 붙여넣은 글에서 찾아볼 품목들.
   *
   * **전에는 아무것도 안 나왔다**(2026-09-06) — `p.type !== '완제품'` 으로 걸렀는데
   * 타입 값은 `product` 다('완제품'은 화면에 보이는 이름이다). `향미유`·`고춧가루` 도
   * 타입이 아니라 **카테고리**라 마찬가지였다. 셋 다 늘 거짓이라 목록이 비어 있었다.
   *
   * 연결 판정도 주문 화면과 **같은 규칙**을 쓴다 — 거기는 `partner_item` 도 보는데
   * 여기는 `partnerIds` 만 봐서, 품목연결로 붙인 것이 통째로 빠졌다.
   */
  const partnerOutIds = useMemo(
    () => new Set((partnerItems ?? [])
      .filter((r: any) => r.partnerId === selectedClient?.id && r.Direction !== 'in')
      .map((r: any) => String(r.itemId))),
    [partnerItems, selectedClient?.id]);

  const productPool = useMemo(() => {
    if (!selectedClient) return [];
    const catalog = items.filter(p => !p.archived && ['product', 'goods', 'wip', 'raw', 'submaterial'].includes(p.type));
    const linked = catalog.filter(p => partnerOutIds.has(p.id) || (selectedClient.type === '스마트스토어' && isSmartStoreItem(p)));
    return linked.length ? linked : catalog;
  }, [items, partnerOutIds, selectedClient]);

  const filteredClients = useMemo(() => {
    if (!searchTerm.trim()) return [];
    return partners.filter(c =>
      sellsTo(c) &&
      matchClient(c.name || '', searchTerm)
    );
  }, [searchTerm, partners]);

  const quickClients = useMemo(() => {
    const seen = new Set<string>();
    return partners
      .filter(sellsTo)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'))
      .filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true; })
      .slice(0, 12);
  }, [partners]);

  const analyze = () => {
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean);
    setParsedLines(lines.map(l => parseLine(l, productPool)));
    setStep('review');
  };
  const matchedLineCount = parsedLines.filter(line => !!line.selectedProductId).length;
  const unmatchedLineCount = parsedLines.length - matchedLineCount;

  const getBoxConfig = (itemId: string) => {
    const pc = partnerOut.find(p => p.itemId === itemId && p.partnerId === selectedClient?.id);
    if (pc?.boxTypeId) return { unitsPerBox: pc.qtyPerBox ?? 0, boxType: pc.boxTypeId, boxSubId: pc.boxTypeId };
    const p = items.find(pr => pr.id === itemId);
    if (p?.defaultBoxConfig?.unitsPerBox) return p.defaultBoxConfig;
    return { unitsPerBox: 0, boxType: '' };
  };

  const handleSubmit = () => {
    if (!orderDate || !deadline || !selectedClient) return;
    const validLines = parsedLines.filter(l => l.selectedProductId && l.qty > 0);
    const orderItems: OrderItem[] = validLines.flatMap(line => {
      const product = items.find(p => p.id === line.selectedProductId);
      if (!product) return [];
      const cfg = getBoxConfig(line.selectedProductId!);
      const uPerBox = cfg.unitsPerBox;
      const actualQty = line.isBox && uPerBox > 0 ? line.qty * uPerBox : line.qty;
      return [{
        itemId: line.selectedProductId!,
        name: product.name,
        quantity: actualQty,
        price: 0,
        ...(line.isBox ? {
          isBoxUnit: true,
          boxQuantity: line.qty,
          ...(uPerBox > 0 ? { unitsPerBox: uPerBox, boxType: cfg.boxType } : {}),
        } : {}),
      }];
    });
    if (!orderItems.length) return;
    const totalAmount = orderItems.reduce((s, i) => s + i.price * i.quantity, 0);
    onSave({
      partnerId: selectedClient.id,
      partnerName: selectedClient.name,
      email: selectedClient.email || '',
      createdAt: new Date(`${orderDate}T00:00:00+09:00`).toISOString(),
      items: orderItems,
      totalAmount,
      deliveryDate: new Date(deadline).toISOString(),
      source: (isDelivery ? '택배' : '일반') as OrderSource,
      pallets: pallets.filter(p => p.quantity > 0),
      region: selectedClient.region || '미지정',
      ...(isDelivery ? { deliveryBoxes: [] } : {}),
    });
  };

  //  채널 아이콘·색은 [shared/channelStyle](../src/shared/channelStyle) 한 곳이 정한다
  const typeConfig = (type: string) => ({ ...channelStyle(type), color: channelStyle(type).chip });

  const renderOrderSchedule = () => (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-slate-700"><CalendarDays size={16} /><h3 className="text-sm font-black">주문 일정</h3></div>
        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-600">필수</span>
        <span className="text-xs font-medium text-slate-500">주문일과 출고예정일은 자동 설정되며 수정할 수 있습니다.</span>
      </div>
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-slate-600">주문일</span>
          <input type="date" required value={orderDate} onChange={event => setOrderDate(event.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold tabular-nums text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-slate-600">출고예정일</span>
          <input type="date" required min={orderDate} value={deadline} onChange={event => setDeadline(event.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold tabular-nums text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
        </label>
      </div>
    </section>
  );

  const clientSectionHeading = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 text-slate-700"><User size={16} /><h3 className="text-sm font-black">거래처</h3></div>
      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-600">필수</span>
    </div>
  );

  const renderSelectedClient = () => {
    if (!selectedClient) return null;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-black text-indigo-900">{selectedClient.name}</span>
              <span className="shrink-0 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[8px] font-black text-white">{selectedClient.type}</span>
            </div>
            {selectedClient.region && <span className="text-[10px] font-medium text-indigo-500">{selectedClient.region}</span>}
          </div>
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="출고 방식">
            <button type="button" onClick={() => setIsDelivery(false)} aria-pressed={!isDelivery}
              className={`min-h-8 rounded-md px-2.5 text-[11px] font-bold transition-colors ${!isDelivery ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>일반</button>
            <button type="button" onClick={() => setIsDelivery(true)} aria-pressed={isDelivery}
              className={`flex min-h-8 items-center gap-1 rounded-md px-2.5 text-[11px] font-bold transition-colors ${isDelivery ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              <Truck size={12} aria-hidden="true" />택배
            </button>
          </div>
        </div>
        <button type="button" onClick={changeClient}
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2">
          <User size={14} aria-hidden="true" />
          거래처 다시 선택
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col h-[85vh] max-h-[860px] animate-in zoom-in-95 duration-300">

        {/* 헤더 */}
        <OrderCreationModalHeader
          currentLabel="주문 내역 붙여넣기"
          onBack={onBack}
          onClose={onClose}
        />

        {/* 스텝 인디케이터 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {renderOrderSchedule()}

          {/* ── STEP 1: 거래처 선택 ── */}
          {step === 'partner' && (
            <div className="space-y-4">
              {clientSectionHeading}
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input type="text" placeholder="거래처명 검색..." value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-3 text-sm outline-none focus:ring-2 focus:ring-violet-400" />
                {filteredClients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-100 rounded-2xl shadow-xl z-20 overflow-hidden max-h-60 overflow-y-auto">
                    {filteredClients.map(c => (
                      <button key={c.id} onClick={() => selectClient(c)}
                        className={`w-full px-5 py-3 text-left flex items-center justify-between transition-colors ${selectedClient?.id === c.id ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'}`}>
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
                        onClick={() => selectClient(c)}
                        className={`rounded-2xl border p-3 text-left transition-all ${selectedClient?.id === c.id ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50'}`}>
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
              {clientSectionHeading}
              {renderSelectedClient()}

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
            <div className="space-y-5">
              {clientSectionHeading}
              {renderSelectedClient()}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-slate-700">
                  <ShoppingBag size={16} />
                  <h3 className="text-sm font-black">주문 품목</h3>
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-600">필수</span>
                </div>
                <button type="button" onClick={() => setStep('paste')} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2">
                  <ClipboardPaste size={14} aria-hidden="true" />
                  주문 내용 다시 입력
                </button>
              </div>
              <div className={`rounded-xl border px-3 py-3 ${unmatchedLineCount === 0 ? 'border-emerald-200 bg-emerald-50' : matchedLineCount === 0 ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`} role="status">
                <div className="flex items-start gap-2.5">
                  {unmatchedLineCount === 0 ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" /> : <AlertCircle size={18} className={`mt-0.5 shrink-0 ${matchedLineCount === 0 ? 'text-rose-600' : 'text-amber-600'}`} aria-hidden="true" />}
                  <div className="min-w-0">
                    <p className={`text-xs font-black ${unmatchedLineCount === 0 ? 'text-emerald-800' : matchedLineCount === 0 ? 'text-rose-800' : 'text-amber-800'}`}>
                      {unmatchedLineCount === 0 ? '모든 주문 품목을 분석했습니다.' : matchedLineCount === 0 ? '자동으로 매칭된 품목이 없습니다.' : '일부 품목의 확인이 필요합니다.'}
                    </p>
                    <p className={`mt-0.5 text-[11px] font-medium ${unmatchedLineCount === 0 ? 'text-emerald-700' : matchedLineCount === 0 ? 'text-rose-700' : 'text-amber-700'}`}>
                      전체 {parsedLines.length}건 · 성공 {matchedLineCount}건 · 확인 필요 {unmatchedLineCount}건
                      {unmatchedLineCount > 0 && ' — 확인이 필요한 행에서 품목을 직접 선택해주세요.'}
                    </p>
                  </div>
                </div>
              </div>
              {parsedLines.map((line, idx) => {
                const matched = line.selectedProductId
                  ? productPool.find(p => p.id === line.selectedProductId) : null;
                return (
                  <div key={idx} className={`space-y-3 rounded-xl border p-4 ${line.selectedProductId ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50/60'}`}>
                    {/* 원문 + 상태 */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-medium text-slate-500">"{line.rawText}"</span>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold leading-none ${line.selectedProductId ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {line.selectedProductId ? '분석 성공' : '확인 필요'}
                      </span>
                    </div>
                    {/* 품목 선택 + 수량 */}
                    <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <div className="relative min-w-0">
                        <select
                          value={line.selectedProductId ?? ''}
                          onChange={e => {
                            const val = e.target.value || null;
                            setParsedLines(prev => prev.map((l, i) => i === idx ? { ...l, selectedProductId: val } : l));
                          }}
                          className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 py-2 pl-4 pr-10 text-sm font-bold text-slate-700 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                        >
                          <option value="">— 제외 —</option>
                          {productPool.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <input type="number" min={1} value={line.qty}
                          onChange={e => {
                            const qty = Math.max(1, parseInt(e.target.value) || 1);
                            setParsedLines(prev => prev.map((l, i) => i === idx ? { ...l, qty } : l));
                          }}
                          className="h-11 w-20 rounded-xl border border-slate-200 bg-slate-50 px-2 text-center text-sm font-black text-slate-700 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                        />
                        <div className="flex h-11 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                          {(['박스', '개'] as const).map(unit => (
                            <button key={unit} type="button"
                              onClick={() => setParsedLines(prev => prev.map((l, i) => i === idx ? { ...l, isBox: unit === '박스' } : l))}
                              className={`h-9 min-w-12 rounded-lg px-2.5 text-xs font-bold transition-colors ${(unit === '박스') === line.isBox ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-700'}`}
                            >{unit}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {matched && (() => {
                      const pc = partnerOut.find(p => p.itemId === matched.id && p.partnerId === selectedClient?.id);
                      const pcSubs: { id: string; name: string }[] = [];
                      if (pc?.boxTypeId) { const b = items.find(p => p.id === pc.boxTypeId); if (b) pcSubs.push({ id: b.id, name: b.name }); }
                      if (pc?.tapeTypeId) { const t = items.find(p => p.id === pc.tapeTypeId); if (t) pcSubs.push({ id: t.id, name: t.name }); }
                      const pcSubIds = new Set(pcSubs.map(s => s.id));
                      //  포장 부자재는 BOM에서 읽는다 — 근거는 자식 품목의 category(용기·마개·라벨…).
                      const legacySubs = bomOf(matched.id)
                        .filter(l => !pcSubIds.has(l.childId)
                          && ['마개', '테이프', '박스', '용기', '라벨', '비닐', '케이스'].includes(String(l.child?.category ?? '')))
                        .map(l => l.child!.name);
                      const subs = [...pcSubs.map(s => s.name), ...legacySubs];
                      return (
                        <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2">
                          <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
                          <span className="text-xs font-bold text-slate-700">{matched.name} · {line.qty}{line.isBox ? '박스' : '개'}</span>
                          {subs.map((name, i) => (
                            <span key={i} className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500">{name}</span>
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

              {palletStocks.length > 0 && (
                <section className="space-y-3 border-t border-slate-200 pt-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 text-slate-700"><Layers size={16} /><h3 className="text-sm font-black">팔레트</h3></div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">선택</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {palletStocks
                      .filter(stock => !stock.hidden)
                      .sort((a, b) => (a.name.toLowerCase().includes('kpp') ? 0 : 1) - (b.name.toLowerCase().includes('kpp') ? 0 : 1) || a.name.localeCompare(b.name, 'ko'))
                      .map(stock => {
                        const current = pallets.find(pallet => pallet.type === stock.id)?.quantity ?? 0;
                        const update = (quantity: number) => {
                          const next = Math.max(0, quantity);
                          setPallets(previous => {
                            const rest = previous.filter(pallet => pallet.type !== stock.id);
                            return next > 0 ? [...rest, { type: stock.id, quantity: next }] : rest;
                          });
                        };
                        return (
                          <div key={stock.id} className={`flex items-center justify-between gap-2 rounded-xl border p-3 transition-colors ${current > 0 ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 bg-white'}`}>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-slate-800">{stock.name}</p>
                              {current > 0 && <p className="mt-0.5 text-[10px] font-bold text-indigo-500">{current}개 선택</p>}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button type="button" onClick={() => update(current - 1)} aria-label={`${stock.name} 수량 줄이기`} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-sm font-black text-slate-600 hover:bg-slate-200">−</button>
                              <span className="w-8 text-center text-xs font-black text-slate-800">{current}</span>
                              <button type="button" onClick={() => update(current + 1)} aria-label={`${stock.name} 수량 늘리기`} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-sm font-black text-slate-600 hover:bg-slate-200">+</button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="rounded-b-3xl">
          {step === 'partner' && (
            <ModalActionFooter
              onCancel={onClose}
            />
          )}
          {step === 'paste' && (
            <ModalActionFooter
              onCancel={onClose}
              onPrimary={analyze}
              primaryLabel="분석하기"
              primaryDisabled={!orderDate || !deadline || !pasteText.trim()}
            />
          )}
          {step === 'review' && (
            <ModalActionFooter
              onCancel={onClose}
              onPrimary={handleSubmit}
              primaryLabel={`주문 생성 (${parsedLines.filter(line => line.selectedProductId).length}건)`}
              primaryDisabled={!orderDate || !deadline || !parsedLines.some(line => line.selectedProductId && line.qty > 0)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default PasteOrderModal;
