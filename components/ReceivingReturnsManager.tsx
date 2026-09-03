import React, { useState, useEffect } from 'react';
import { RotateCcw, History, Truck, X, ChevronDown, Loader2 } from 'lucide-react';
import { addItem, subscribeToCollection } from '../src/shared/services/firebaseService';
import {
  ReturnRequest, ReturnItem, ReturnReason,
  Item, Partner, Order,
} from '../src/shared/types';
import PageHeader from './PageHeader';
import { dateOfLocal } from '../src/shared/day';

type ReturnTab = '받기' | '보내기' | '이력';

interface ReceivingReturnsManagerProps {
  items: Item[];
  partners: Partner[];
  orders: Order[];
  currentUser: { id: string; name: string };
  isAdmin: boolean;
  onProcessReturn: (req: ReturnRequest) => Promise<void>;
  // 선입고 품목추가 연결 — partner_item은 라이브 구독이 아니라 부모의 낙관적 갱신 필요
  onLinkInbound?: (itemId: string, partnerId: string) => void | Promise<void>;
}

const ReceivingReturnsManager: React.FC<ReceivingReturnsManagerProps> = ({
  items,
  partners,
  orders,
  currentUser,
  isAdmin,
  onProcessReturn,
}) => {
  // ── Tab state ──
  const [returnTab, setReturnTab] = useState<ReturnTab>('받기');

  // ── Shared Firestore data ──
  const [returnRequests, setReturnRequests] = useState<ReturnRequest[]>([]);

  //  반품 목록은 실시간 구독 — 다른 사람이 넣은 요청이 바로 떠야 한다
  useEffect(() => subscribeToCollection<ReturnRequest>('returnRequests', setReturnRequests), []);

  // ── Returns form ──
  const [returnClientId, setReturnClientId] = useState('');
  const [returnClientSearch, setReturnClientSearch] = useState('');
  const [showReturnClientDropdown, setShowReturnClientDropdown] = useState(false);
  const [returnItems, setReturnItems] = useState<{ itemId: string; name: string; qty: string; unit: string }[]>([]);
  const [returnItemSearch, setReturnItemSearch] = useState('');
  const [returnNote, setReturnNote] = useState('');
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnFilterMonth, setReturnFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));

  // ── 매입 반품 (보내기) state ──
  const [prSupplierId, setPrSupplierId] = useState('');
  const [prSupplierSearch, setPrSupplierSearch] = useState('');
  const [showPrSupplierDropdown, setShowPrSupplierDropdown] = useState(false);
  const [prItems, setPrItems] = useState<{ itemId: string; name: string; qty: string; unit: string }[]>([]);
  const [prItemSearch, setPrItemSearch] = useState('');
  const [prNote, setPrNote] = useState('');
  const [prSaving, setPrSaving] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // ══════════════════════════════════════════
  // Camera helpers
  // ══════════════════════════════════════════

  // ══════════════════════════════════════════
  // Scan inbound save
  // ══════════════════════════════════════════

  // ══════════════════════════════════════════
  // InboundPartner-based inbound
  // ══════════════════════════════════════════

  const inboundPartners = partners.filter(c =>
    c.partnerType === '매입처' || c.partnerType === '매출+매입처'
  );

  // 거래처별 연결 품목
  // purchaseItems가 존재하면 그게 최종 목록 (X로 수동 관리한 상태)
  // purchaseItems가 없으면 items.partnerId 폴백
  // sub가 없으면 Item(향미유/고춧가루 등)에서도 검색

  // ══════════════════════════════════════════
  // 전표 발행 helpers
  // ══════════════════════════════════════════

  // ══════════════════════════════════════════
  // Returns helpers
  // ══════════════════════════════════════════

  const sellableProducts = items.filter(p =>
    ['완제품', '향미유', '고춧가루', 'product', 'wip'].includes(p.type as string)
  );

  useEffect(() => {
    if (!returnClientId) { setReturnItems([]); return; }
    // 거래처에 연결된 품목(partnerIds 기반) 우선 표시
    const linked = sellableProducts
      .filter(p => p.partnerIds?.includes(returnClientId))
      .map(p => ({ itemId: p.id, name: p.name, qty: '', unit: p.unit }));
    if (linked.length > 0) {
      setReturnItems(linked);
      return;
    }
    // 연결 품목 없으면 최근 주문 이력으로 fallback
    const partnerOrders = orders
      .filter(o => o.partnerId === returnClientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const seen = new Set<string>();
    const preItems: { itemId: string; name: string; qty: string; unit: string }[] = [];
    for (const order of partnerOrders) {
      for (const item of order.items) {
        if (!item.itemId || seen.has(item.itemId)) continue;
        const product = sellableProducts.find(p => p.id === item.itemId);
        if (!product) continue;
        seen.add(item.itemId);
        preItems.push({ itemId: item.itemId, name: item.name, qty: '', unit: product.unit });
      }
    }
    setReturnItems(preItems);
  }, [returnClientId]);

  const handleSelectReturnClient = (id: string, name: string) => {
    setReturnClientId(id);
    setReturnClientSearch(name);
    setShowReturnClientDropdown(false);
    setReturnItemSearch('');
  };

  const addReturnItem = (itemId: string) => {
    if (returnItems.some(i => i.itemId === itemId)) return;
    const p = sellableProducts.find(x => x.id === itemId);
    if (!p) return;
    setReturnItems(prev => [...prev, { itemId: p.id, name: p.name, qty: '', unit: p.unit }]);
  };

  const handleReturnSubmit = async () => {
    const partner = partners.find(c => c.id === returnClientId);
    if (!partner) { alert('거래처를 선택해주세요.'); return; }
    const items: ReturnItem[] = returnItems
      .filter(i => Number(i.qty) > 0)
      .map(i => ({
        itemId: i.itemId,
        name: i.name,
        quantity: Number(i.qty),
        price: 0,
        reason: '기타' as ReturnReason,
        isResellable: true,
      }));
    if (items.length === 0) { alert('반품 수량을 1개 이상 입력해주세요.'); return; }
    setReturnSaving(true);
    try {
      await addItem('returnRequests', {
        partnerId: returnClientId,
        partnerName: partner.name,
        items,
        totalAmount: 0,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.name,
        ...(returnNote && { note: returnNote }),
      });
      setReturnClientId('');
      setReturnClientSearch('');
      setReturnItems([]);
      setReturnNote('');
      setReturnTab('이력');
    } finally {
      setReturnSaving(false);
    }
  };

  const handlePurchaseReturnSubmit = async () => {
    const inboundPartner = partners.find(c => c.id === prSupplierId);
    if (!inboundPartner) { alert('거래처를 선택해주세요.'); return; }
    const items: ReturnItem[] = prItems
      .filter(i => Number(i.qty) > 0)
      .map(i => ({
        itemId: i.itemId,
        name: i.name,
        quantity: Number(i.qty),
        price: 0,
        reason: '기타' as ReturnReason,
        isResellable: false,
      }));
    if (items.length === 0) { alert('반품 수량을 1개 이상 입력해주세요.'); return; }
    setPrSaving(true);
    try {
      await addItem('returnRequests', {
        partnerId: prSupplierId,
        partnerName: inboundPartner.name,
        items,
        totalAmount: 0,
        status: 'pending' as const,
        returnType: '매입' as const,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.name,
        ...(prNote && { note: prNote }),
      });
      setPrSupplierId('');
      setPrSupplierSearch('');
      setPrItems([]);
      setPrNote('');
      setReturnTab('이력');
    } finally {
      setPrSaving(false);
    }
  };

  const handleProcessReturn = async (req: ReturnRequest) => {
    if (!isAdmin) { alert('관리자만 반품 처리를 할 수 있습니다.'); return; }
    if (!window.confirm(`${req.partnerName}의 반품을 처리하시겠습니까?\n재판매 가능 품목의 재고가 복귀됩니다.`)) return;
    setProcessingId(req.id);
    try {
      await onProcessReturn(req);
    } finally {
      setProcessingId(null);
    }
  };

  // ── Derived ──
  const pendingReturnCount = returnRequests.filter(r => r.status === 'pending' && r.returnType !== '매입').length;
  const filteredReturnHistory = returnRequests
    .filter(r => r.createdAt.slice(0, 7) === returnFilterMonth)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // ══════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════

  return (
    <div className="space-y-4">
      <PageHeader
        title="반품"
        subtitle="반품 접수 및 처리"
      />

      {/* ══════════════════════════════════════════
          반품 탭
      ══════════════════════════════════════════ */}
      {(
        <div className="space-y-4">
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1 w-fit">
            <button
              onClick={() => setReturnTab('받기')}
              className={`px-4 py-2 rounded-lg text-sm font-black transition-all flex items-center gap-1.5 ${returnTab === '받기' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <RotateCcw size={13} />
              받은 반품
              {pendingReturnCount > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">
                  {pendingReturnCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setReturnTab('보내기')}
              className={`px-4 py-2 rounded-lg text-sm font-black transition-all flex items-center gap-1.5 ${returnTab === '보내기' ? 'bg-white text-orange-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Truck size={13} />
              보낸 반품
            </button>
            <button
              onClick={() => setReturnTab('이력')}
              className={`px-4 py-2 rounded-lg text-sm font-black transition-all flex items-center gap-1.5 ${returnTab === '이력' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <History size={13} />
              이력
            </button>
          </div>

          {/* ── 받은 반품 (매출처가 우리에게 돌려보내는 것) ── */}
          {returnTab === '받기' && (
            <div className="space-y-3">
              {/* 거래처 검색 */}
              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-2">
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest">거래처 *</p>
                <div className="relative">
                  <input
                    value={returnClientSearch}
                    onChange={e => { setReturnClientSearch(e.target.value); setShowReturnClientDropdown(true); if (!e.target.value) { setReturnClientId(''); } }}
                    onFocus={() => setShowReturnClientDropdown(true)}
                    onBlur={() => setTimeout(() => setShowReturnClientDropdown(false), 150)}
                    placeholder="거래처 검색..."
                    className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${returnClientId ? 'border-blue-300 bg-blue-50' : 'border-slate-200'}`}
                  />
                  {showReturnClientDropdown && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-auto">
                      {partners
                        .filter(c => !c.partnerType || c.partnerType === '매출처' || c.partnerType === '매출+매입처')
                        .filter(c => !returnClientSearch || c.name.toLowerCase().includes(returnClientSearch.toLowerCase()))
                        .map(c => (
                          <button
                            key={c.id}
                            onMouseDown={() => handleSelectReturnClient(c.id, c.name)}
                            className={`w-full px-3 py-2.5 text-left text-sm hover:bg-blue-50 transition-colors ${returnClientId === c.id ? 'bg-blue-50 font-bold text-blue-700' : 'text-slate-700'}`}
                          >
                            {c.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 품목 목록 */}
              {returnClientId && (
                <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">반품 품목</p>
                    <span className="text-xs text-slate-400">{returnItems.filter(i => Number(i.qty) > 0).length}개 입력됨</span>
                  </div>

                  {returnItems.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">이 거래처의 주문 이력이 없습니다. 아래에서 품목을 추가하세요.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {returnItems.map((item, idx) => (
                        <div key={item.itemId} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-700">{item.name}</p>
                            <p className="text-xs text-slate-400">{item.unit}</p>
                          </div>
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={item.qty}
                            onChange={e => setReturnItems(prev => prev.map((it, i) => i === idx ? { ...it, qty: e.target.value } : it))}
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                          <span className="text-xs text-slate-400 w-8 shrink-0">{item.unit}</span>
                          <button onClick={() => setReturnItems(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-slate-300 hover:text-rose-500 transition-colors">
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 품목 검색 추가 */}
                  <div className="relative">
                    <input
                      type="text"
                      value={returnItemSearch}
                      onChange={e => setReturnItemSearch(e.target.value)}
                      onBlur={() => setTimeout(() => setReturnItemSearch(''), 150)}
                      placeholder="+ 품목 검색하여 추가..."
                      className="w-full border border-dashed border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-500 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    {returnItemSearch && (
                      <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-auto">
                        {sellableProducts
                          .filter(p => !returnItems.some(i => i.itemId === p.id))
                          .filter(p => p.name.toLowerCase().includes(returnItemSearch.toLowerCase()))
                          .map(p => (
                            <button
                              key={p.id}
                              onMouseDown={() => { addReturnItem(p.id); setReturnItemSearch(''); }}
                              className="w-full px-3 py-2.5 text-left text-sm hover:bg-blue-50 transition-colors text-slate-700"
                            >
                              {p.name}
                            </button>
                          ))}
                        {sellableProducts.filter(p => !returnItems.some(i => i.itemId === p.id) && p.name.toLowerCase().includes(returnItemSearch.toLowerCase())).length === 0 && (
                          <p className="px-3 py-3 text-xs text-slate-400 text-center">검색 결과 없음</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 비고 */}
              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">비고</p>
                <textarea
                  value={returnNote}
                  onChange={e => setReturnNote(e.target.value)}
                  placeholder="반품 관련 메모 (선택)"
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <button
                onClick={handleReturnSubmit}
                disabled={returnSaving || !returnClientId}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-black text-sm transition-all shadow-md"
              >
                {returnSaving ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                반품 접수 (관리자 확인 후 전표 발행)
              </button>
            </div>
          )}

          {/* ── 보낸 반품 (우리가 매입처에 돌려보내는 것) ── */}
          {returnTab === '보내기' && (
            <div className="space-y-3">
              <div className="bg-orange-50 border border-orange-100 rounded-2xl px-4 py-2.5 text-xs text-orange-700 font-bold">
                우리가 공급처(매입처)에 재료·부자재를 반품 보낼 때 기록합니다
              </div>

              {/* 거래처 (매입처) */}
              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-2">
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest">공급처 *</p>
                <div className="relative">
                  <input
                    value={prSupplierSearch}
                    onChange={e => { setPrSupplierSearch(e.target.value); setShowPrSupplierDropdown(true); if (!e.target.value) setPrSupplierId(''); }}
                    onFocus={() => setShowPrSupplierDropdown(true)}
                    onBlur={() => setTimeout(() => setShowPrSupplierDropdown(false), 150)}
                    placeholder="공급처 검색..."
                    className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 ${prSupplierId ? 'border-orange-300 bg-orange-50' : 'border-slate-200'}`}
                  />
                  {showPrSupplierDropdown && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-auto">
                      {inboundPartners
                        .filter(c => !prSupplierSearch || c.name.toLowerCase().includes(prSupplierSearch.toLowerCase()))
                        .map(c => (
                          <button
                            key={c.id}
                            onMouseDown={() => { setPrSupplierId(c.id); setPrSupplierSearch(c.name); setShowPrSupplierDropdown(false); setPrItems([]); }}
                            className={`w-full px-3 py-2.5 text-left text-sm hover:bg-orange-50 transition-colors ${prSupplierId === c.id ? 'bg-orange-50 font-bold text-orange-700' : 'text-slate-700'}`}
                          >
                            {c.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 품목 */}
              {prSupplierId && (
                <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">반품 품목</p>
                    <span className="text-xs text-slate-400">{prItems.filter(i => Number(i.qty) > 0).length}개 입력됨</span>
                  </div>

                  {prItems.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">아래에서 품목을 검색해 추가하세요</p>
                  ) : (
                    <div className="space-y-1.5">
                      {prItems.map((item, idx) => (
                        <div key={item.itemId} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-700">{item.name}</p>
                            <p className="text-xs text-slate-400">{item.unit}</p>
                          </div>
                          <input
                            type="number"
                            min={0}
                            placeholder="0"
                            value={item.qty}
                            onChange={e => setPrItems(prev => prev.map((it, i) => i === idx ? { ...it, qty: e.target.value } : it))}
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-orange-400"
                          />
                          <span className="text-xs text-slate-400 w-8 shrink-0">{item.unit}</span>
                          <button onClick={() => setPrItems(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-slate-300 hover:text-rose-500 transition-colors">
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="relative">
                    <input
                      type="text"
                      value={prItemSearch}
                      onChange={e => setPrItemSearch(e.target.value)}
                      onBlur={() => setTimeout(() => setPrItemSearch(''), 150)}
                      placeholder="+ 품목 검색하여 추가..."
                      className="w-full border border-dashed border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-500 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                    />
                    {prItemSearch && (
                      <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-auto">
                        {items
                          .filter(s => !prItems.some(i => i.itemId === s.id) && s.name.toLowerCase().includes(prItemSearch.toLowerCase()))
                          .map(s => (
                            <button
                              key={s.id}
                              onMouseDown={() => { setPrItems(prev => [...prev, { itemId: s.id, name: s.name, qty: '', unit: s.unit }]); setPrItemSearch(''); }}
                              className="w-full px-3 py-2.5 text-left text-sm hover:bg-orange-50 transition-colors text-slate-700"
                            >
                              {s.name}
                            </button>
                          ))}
                        {items.filter(s => !prItems.some(i => i.itemId === s.id) && s.name.toLowerCase().includes(prItemSearch.toLowerCase())).length === 0 && (
                          <p className="px-3 py-3 text-xs text-slate-400 text-center">검색 결과 없음</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 비고 */}
              <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
                <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">비고</p>
                <textarea
                  value={prNote}
                  onChange={e => setPrNote(e.target.value)}
                  placeholder="반품 사유, 메모 (선택)"
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>

              <button
                onClick={handlePurchaseReturnSubmit}
                disabled={prSaving || !prSupplierId}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white rounded-xl font-black text-sm transition-all shadow-md"
              >
                {prSaving ? <Loader2 size={16} className="animate-spin" /> : <Truck size={16} />}
                반품 발송 접수 (관리자 확인 후 처리)
              </button>
            </div>
          )}

          {/* ── 반품 이력 ── */}
          {returnTab === '이력' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider">기간</label>
                <input
                  type="month"
                  value={returnFilterMonth}
                  onChange={e => setReturnFilterMonth(e.target.value)}
                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-400">{filteredReturnHistory.length}건</span>
              </div>

              {filteredReturnHistory.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center text-slate-400">
                  <RotateCcw size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">해당 월의 반품 이력이 없습니다</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredReturnHistory.map(req => (
                    <div key={req.id}>
                      <div className="flex items-center gap-2 mb-1.5 px-1">
                        {req.returnType === '매입' ? (
                          <span className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                            <Truck size={10} /> 보낸 반품
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                            <RotateCcw size={10} /> 받은 반품
                          </span>
                        )}
                      </div>
                      <ReturnCard
                        req={req}
                        isAdmin={isAdmin}
                        isProcessing={processingId === req.id}
                        onProcess={() => handleProcessReturn(req)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 전표 발행 모달 ── */}

    </div>
  );
};

// ── 반품 이력 카드 ──────────────────────────────────────────────────────────────

interface ReturnCardProps {
  req: ReturnRequest;
  isAdmin: boolean;
  isProcessing: boolean;
  onProcess: () => void;
}

const ReturnCard: React.FC<ReturnCardProps> = ({ req, isAdmin, isProcessing, onProcess }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
      <div
        className="p-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(p => !p)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-slate-800 text-sm">{req.partnerName}</p>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${req.status === 'processed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {req.status === 'processed' ? '처리완료' : '처리대기'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {dateOfLocal(req.createdAt)} · {req.items.length}개 품목 · ₩{req.totalAmount.toLocaleString()}
            {req.createdBy && <span> · 접수: {req.createdBy}</span>}
          </p>
        </div>

        {req.status === 'pending' && isAdmin && (
          <button
            onClick={e => { e.stopPropagation(); onProcess(); }}
            disabled={isProcessing}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-black hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
          >
            {isProcessing ? '처리 중...' : '처리'}
          </button>
        )}

        <ChevronDown
          size={16}
          className={`text-slate-400 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-2.5">
          {req.orderId && <p className="text-xs text-slate-400">원주문 ID: {req.orderId}</p>}
          {req.linkedStatementId && <p className="text-xs text-emerald-600">연결 전표: {req.linkedStatementId}</p>}

          <div className="space-y-1.5">
            {req.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="font-semibold text-slate-700">{item.name}</span>
                  <span className="text-slate-400">{item.quantity}개 × ₩{item.price.toLocaleString()}</span>
                  <span className="text-slate-400">· {item.reason}</span>
                </div>
                <span className={`ml-2 shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black ${item.isResellable ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {item.isResellable ? '재판매' : '폐기'}
                </span>
              </div>
            ))}
          </div>

          {req.note && (
            <p className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              비고: {req.note}
            </p>
          )}
          {req.processedAt && (
            <p className="text-xs text-slate-400">
              처리일시: {req.processedAt.slice(0, 16).replace('T', ' ')}
              {req.processedBy && ` (${req.processedBy})`}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ReceivingReturnsManager;
