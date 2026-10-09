import { appConfirm } from '../src/shared/components/appDialog';
import { purchaseReturnRequest, salesReturnRequest } from '../src/features/admin/purchaseReturnRequest';
import { getPendingReturnSubmission, resumeReturnSubmission, submitReturnRequest, returnSubmissionActorUid } from '../src/shared/services/returnRequestSubmission';
import type { CompanyId } from '../src/shared/types';
import { where } from 'firebase/firestore';
import React, { useState, useEffect, useRef } from 'react';
import { RotateCcw, Truck, X, Loader2 } from 'lucide-react';
import { subscribeToCollection } from '../src/shared/services/firebaseService';
import { Item, Order, IssuedStatement, Partner, PartnerItem, ReturnRequest } from '../src/shared/types';
import PageHeader from './PageHeader';
import { buysFrom, sellsTo } from '../src/shared/partnerRole';
import { isLinkedToPartner } from '../src/shared/partnerPrice';

type ReturnTab = '받기' | '보내기';

interface ReceivingReturnsManagerProps {
  companyId: CompanyId;
  items: Item[];
  /** 거래처–품목 연결 — 반품 넣을 품목을 고르는 데 쓴다 */
  partnerItems?: PartnerItem[];
  partners: Partner[];
  orders: Order[];
  issuedStatements?: IssuedStatement[];
  currentUser: { id: string; name: string };
  isAdmin: boolean;
  onProcessReturn: (req: ReturnRequest) => Promise<void>;
  // 선입고 품목추가 연결 — partner_item은 라이브 구독이 아니라 부모의 낙관적 갱신 필요
  onLinkInbound?: (itemId: string, partnerId: string) => void | Promise<void>;
}

const CompanyReceivingReturnsManager: React.FC<ReceivingReturnsManagerProps> = ({
  companyId,
  items,
  partnerItems,
  partners,
  orders,
  issuedStatements = [],
  currentUser,
}) => {
  // ── Tab state ──
  const [returnTab, setReturnTab] = useState<ReturnTab>('받기');

  // ── Shared Firestore data ──
  const mounted = useRef(true);
  const activeActor = returnSubmissionActorUid();
  const liveSubmission = () => mounted.current && returnSubmissionActorUid() === activeActor;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [returnRequests, setReturnRequests] = useState<ReturnRequest[]>([]);

  //  반품 목록은 실시간 구독 — 다른 사람이 넣은 요청이 바로 떠야 한다
  useEffect(() => {
    let active = true;
    setReturnRequests([]);
    const stop = subscribeToCollection<ReturnRequest>('returnRequests', rows => {
      if (active) setReturnRequests(rows);
    }, [where('companyId', '==', companyId)]);
    return () => { active = false; stop(); };
  }, [companyId]);

  // ── Returns form ──
  const [returnClientId, setReturnClientId] = useState('');
  const [returnClientSearch, setReturnClientSearch] = useState('');
  const [showReturnClientDropdown, setShowReturnClientDropdown] = useState(false);
  const [returnItems, setReturnItems] = useState<{ itemId: string; name: string; qty: string; unit: string }[]>([]);
  const [returnItemSearch, setReturnItemSearch] = useState('');
  const [returnNote, setReturnNote] = useState('');
  const [explicitMoney, setExplicitMoney] = useState<Record<string, { supply: string; tax: string; accountCode: string }>>({});
  const [payableAccountCode, setPayableAccountCode] = useState<'251' | '253'>('251');

  const explicitFor = (rows: { itemId: string }[]) => ({ items: rows.map(row => ({ itemId: row.itemId,
    supply: explicitMoney[row.itemId]?.supply?.trim() ? Number(explicitMoney[row.itemId].supply) : NaN,
    tax: explicitMoney[row.itemId]?.tax?.trim() ? Number(explicitMoney[row.itemId].tax) : NaN,
    accountCode: explicitMoney[row.itemId]?.accountCode ?? '' })), payableAccountCode });
  const [returnSaving, setReturnSaving] = useState(false);

  // ── 매입 반품 (보내기) state ──
  const [purchaseSourceId, setPurchaseSourceId] = useState('');
  const [salesSourceId, setSalesSourceId] = useState('');
  const [prSupplierId, setPrSupplierId] = useState('');
  const [prSupplierSearch, setPrSupplierSearch] = useState('');
  const [showPrSupplierDropdown, setShowPrSupplierDropdown] = useState(false);
  const [prItems, setPrItems] = useState<{ itemId: string; name: string; qty: string; unit: string }[]>([]);
  const [prItemSearch, setPrItemSearch] = useState('');
  const [prNote, setPrNote] = useState('');
  const [prSaving, setPrSaving] = useState(false);
  useEffect(() => { setExplicitMoney({}); }, [returnTab, returnClientId, prSupplierId, salesSourceId, purchaseSourceId]);

  const submissionBusy = useRef(false);
  const [pendingSubmission, setPendingSubmission] = useState<ReturnType<typeof getPendingReturnSubmission>>(null);
  const [submissionError, setSubmissionError] = useState('');
  const [resumingSubmission, setResumingSubmission] = useState(false);
  useEffect(() => {
    const load = () => { try { setPendingSubmission(getPendingReturnSubmission(companyId)); setSubmissionError(''); }
      catch(error) { setSubmissionError(error instanceof Error ? error.message : '이전 접수 원문을 확인해주세요.'); } };
    load(); window.addEventListener('return-submission-pending', load); window.addEventListener('storage', load);
    return () => { window.removeEventListener('return-submission-pending', load); window.removeEventListener('storage', load); };
  }, [companyId]);
  const handleResumeSubmission = async () => {
    if (submissionBusy.current) return;
    submissionBusy.current = true; setResumingSubmission(true);

    try { await resumeReturnSubmission(companyId); if (!liveSubmission()) return;
      setPendingSubmission(null); setSubmissionError(''); setReturnItems([]); setPrItems([]); setReturnNote(''); setPrNote('');
    } catch(error) { if (liveSubmission()) setSubmissionError(error instanceof Error ? error.message : '접수 결과를 확인하지 못했습니다. 원문은 보존했습니다.'); }
    finally { submissionBusy.current = false; if (liveSubmission()) setResumingSubmission(false); }
  };
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
    c.companyId === companyId && buysFrom(c)
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
      .filter(p => isLinkedToPartner(partnerItems, returnClientId, p.id))
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
    setExplicitMoney({});
    setSalesSourceId('');
    setReturnClientId(id);
    setReturnClientSearch(name);
    setShowReturnClientDropdown(false);
    setReturnItemSearch('');
  };

  const partnerProducts = (partnerId: string, direction: 'in' | 'out', sourceId: string) => items.filter(item =>
    item.companyId === companyId && ((partnerItems ?? []).some(link => link.partnerId === partnerId && link.itemId === item.id && link.Direction === direction) ||
      issuedStatements.some(statement => statement.companyId === companyId && statement.partnerId === partnerId && statement.type === (direction === 'in' ? '매입' : '매출') && (!sourceId || statement.id === sourceId) && statement.items.some(line => line.itemId === item.id)))
  );
  const returnProducts = partnerProducts(returnClientId, 'out', salesSourceId);
  const purchaseProducts = partnerProducts(prSupplierId, 'in', purchaseSourceId);

  const addReturnItem = (itemId: string) => {
    if (returnItems.some(i => i.itemId === itemId)) return;
    const p = returnProducts.find(x => x.id === itemId);
    if (!p) return;
    setReturnItems(prev => [...prev, { itemId: p.id, name: p.name, qty: '', unit: p.unit }]);
  };

  const handleReturnSubmit = async () => {
    if (submissionBusy.current) return;
    submissionBusy.current = true;  setReturnSaving(true);
    try {
    const partner = partners.find(c => c.id === returnClientId);
    if (!partner) { alert('거래처를 선택해주세요.'); return; }
    let request: ReturnType<typeof salesReturnRequest>;
    try { request = salesReturnRequest(companyId, returnClientId, issuedStatements.find(row => row.id === salesSourceId), returnItems, items, salesSourceId ? undefined : explicitFor(returnItems.filter(row => Number(row.qty) > 0))); }
    catch (error) { alert(error instanceof Error ? error.message : '반품 원전표를 확인해주세요.'); return; }
    if (!salesSourceId && !await appConfirm(`공급가·세액 합계 ${request.totalAmount.toLocaleString()}원\n미수금108을 같은 거래처 미결의 거래일·ID 순으로 차감합니다. 현금 수금이 아닙니다.`)) return;
    if (!liveSubmission()) return;
    setReturnSaving(true);
    try {
      await submitReturnRequest(companyId, {
        ...request,
        partnerName: partner.name,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.name,
        ...(returnNote && { note: returnNote }),
      });
      if (!liveSubmission()) return;
      setReturnClientId('');
      setReturnClientSearch('');
      setReturnItems([]);
      setReturnNote('');
    } catch (error) { if (liveSubmission()) alert(error instanceof Error ? error.message : '반품 접수를 완료하지 못했습니다.'); } finally {
      if (liveSubmission()) setReturnSaving(false);
    }
    } finally { submissionBusy.current = false; if (liveSubmission()) { setReturnSaving(false); setPrSaving(false); } }
  };

  const handlePurchaseReturnSubmit = async () => {
    if (submissionBusy.current) return;
    submissionBusy.current = true;  setPrSaving(true);
    try {
    const inboundPartner = partners.find(c => c.id === prSupplierId);
    if (!inboundPartner) { alert('거래처를 선택해주세요.'); return; }
    let request: ReturnType<typeof purchaseReturnRequest>;
    try { request = purchaseReturnRequest(companyId, prSupplierId, issuedStatements.find(row => row.id === purchaseSourceId), prItems, items, purchaseSourceId ? undefined : explicitFor(prItems.filter(row => Number(row.qty) > 0))); }
    catch (error) { alert(error instanceof Error ? error.message : '반품 원전표를 확인해주세요.'); return; }
    if (!purchaseSourceId && !await appConfirm(`공급가·세액 합계 ${request.totalAmount.toLocaleString()}원\n미지급금${payableAccountCode}을 같은 거래처 미결의 거래일·ID 순으로 차감합니다. 현금 지급이 아닙니다.`)) return;
    if (!liveSubmission()) return;
    setPrSaving(true);
    try {
      await submitReturnRequest(companyId, {
        ...request,
        partnerName: inboundPartner.name,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.name,
        ...(prNote && { note: prNote }),
      });
      if (!liveSubmission()) return;
      setPrSupplierId('');
      setPrSupplierSearch('');
      setPrItems([]);
      setPrNote('');
    } catch (error) { if (liveSubmission()) alert(error instanceof Error ? error.message : '반품 접수를 완료하지 못했습니다.'); } finally {
      if (liveSubmission()) setPrSaving(false);
    }
    } finally { submissionBusy.current = false; if (liveSubmission()) { setReturnSaving(false); setPrSaving(false); } }
  };

  const pendingReturnCount = returnRequests.filter(r => r.status === 'pending' && r.returnType !== '매입').length;

  // ══════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════

  return (
    <div className="space-y-4">
      {!navigator.locks && <p className="text-xs text-slate-500">이 브라우저에서는 한 창에서만 반품을 접수해주세요. 다른 창의 동시 첫 접수 보호는 지원되지 않습니다.</p>}
      {(pendingSubmission || submissionError) && <div role="status" className="border rounded-xl p-3 space-y-2">
        <p>이전 반품 접수 확인 {pendingSubmission?.request.partnerName} {pendingSubmission?.request.returnType}
          {pendingSubmission && ` · ${pendingSubmission.request.totalAmount.toLocaleString()}원`}</p>
        {submissionError && <p role="alert">{submissionError}</p>}
        <button onClick={handleResumeSubmission} disabled={resumingSubmission}>이전 접수 확인</button>
      </div>}
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
              반품받기
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
              반품하기
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
                        .filter(c => c.companyId === companyId && sellsTo(c))
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

              {returnClientId && <div className="bg-white rounded-2xl p-4 space-y-2">
                <label className="text-xs font-bold">원매출 전표
                  <select aria-label="원매출 전표" value={salesSourceId} onChange={e => {
                    setSalesSourceId(e.target.value);
                    const original = issuedStatements.find(row => row.id === e.target.value && row.companyId === companyId && row.partnerId === returnClientId && row.type === '매출');
                    setReturnItems((original?.items ?? []).map(row => ({ itemId: row.itemId ?? '', name: row.name, qty: '', unit: items.find(item => item.id === row.itemId)?.unit ?? '' })));
                  }} className="block w-full border rounded-lg p-2 mt-1">
                    <option value="">원전표 없이 금액 직접 입력</option>
                    {issuedStatements.filter(row => row.companyId === companyId && row.partnerId === returnClientId && row.type === '매출' && row.totalAmount > 0)
                      .map(row => <option key={row.id} value={row.id}>{row.tradeDate} · {row.docNo} · {row.totalAmount.toLocaleString()}원</option>)}
                  </select>
                </label>
                <p className="text-xs text-slate-500">원전표 선택 시 공급가·세액 비례로 계산하고, 미지정 시 금액을 직접 입력합니다. 품목에 맞춰 재고와 로트를 함께 처리합니다.</p>
              </div>}

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
                        {returnProducts
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
                        {returnProducts.filter(p => !returnItems.some(i => i.itemId === p.id) && p.name.toLowerCase().includes(returnItemSearch.toLowerCase())).length === 0 && (
                          <p className="px-3 py-3 text-xs text-slate-400 text-center">검색 결과 없음</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

{!salesSourceId && <div className="space-y-2 border rounded-xl p-3">
              <p>원전표 없이 금액 직접 입력 · 과거 단가를 자동 추정하지 않습니다.</p>
              {returnItems.map((row, idx) => row.itemId && <div key={row.itemId} className="flex flex-wrap gap-2">
                <span>{row.name}</span>
                {(['supply', 'tax', 'accountCode'] as const).map(field => <label key={field}>
                  {{ supply: '공급가', tax: '세액', accountCode: '발생 계정' }[field]}
                  <input aria-label={`${row.name} ${{ supply: '공급가', tax: '세액', accountCode: '발생 계정' }[field]}`}
                    type={field === 'accountCode' ? 'text' : 'number'} min={0}
                    value={explicitMoney[row.itemId!]?.[field] ?? ''}
                    onChange={e => setExplicitMoney(prev => ({ ...prev, [row.itemId!]: {
                      ...(prev[row.itemId!] ?? { supply: '', tax: '', accountCode: '' }), [field]: e.target.value } }))} />
                </label>)}
              </div>)}
            </div>}
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
                            onMouseDown={() => { setExplicitMoney({}); setPurchaseSourceId(''); setPrSupplierId(c.id); setPrSupplierSearch(c.name); setShowPrSupplierDropdown(false); setPrItems([]); }}
                            className={`w-full px-3 py-2.5 text-left text-sm hover:bg-orange-50 transition-colors ${prSupplierId === c.id ? 'bg-orange-50 font-bold text-orange-700' : 'text-slate-700'}`}
                          >
                            {c.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {prSupplierId && <div className="bg-white rounded-2xl p-4 space-y-2">
                <label className="text-xs font-bold">원매입 전표
                  <select aria-label="원매입 전표" value={purchaseSourceId} onChange={e => {
                    setPurchaseSourceId(e.target.value);
                    const original = issuedStatements.find(row => row.id === e.target.value && row.companyId === companyId && row.partnerId === prSupplierId && row.type === '매입');
                    setPrItems((original?.items ?? []).map(row => ({ itemId: row.itemId ?? '', name: row.name, qty: '', unit: items.find(item => item.id === row.itemId)?.unit ?? '' })));
                  }} className="block w-full border rounded-lg p-2 mt-1">
                    <option value="">원전표 없이 금액 직접 입력</option>
                    {issuedStatements.filter(row => row.companyId === companyId && row.partnerId === prSupplierId && row.type === '매입' && row.totalAmount > 0)
                      .map(row => <option key={row.id} value={row.id}>{row.tradeDate} · {row.docNo} · {row.totalAmount.toLocaleString()}원</option>)}
                  </select>
                </label>
                <p className="text-xs text-slate-500">원전표 선택 시 공급가·세액 비례로 계산하고, 미지정 시 금액을 직접 입력합니다. 품목에 맞춰 재고와 로트를 함께 처리합니다.</p>
              </div>}

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
                        {purchaseProducts
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
                        {purchaseProducts.filter(s => !prItems.some(i => i.itemId === s.id) && s.name.toLowerCase().includes(prItemSearch.toLowerCase())).length === 0 && (
                          <p className="px-3 py-3 text-xs text-slate-400 text-center">검색 결과 없음</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

{!purchaseSourceId && <div className="space-y-2 border rounded-xl p-3">
              <p>원전표 없이 금액 직접 입력 · 과거 단가를 자동 추정하지 않습니다.</p>
              <label>줄일 채무 계정<select aria-label="줄일 채무 계정" value={payableAccountCode} onChange={e => setPayableAccountCode(e.target.value as '251' | '253')}><option value="251">251</option><option value="253">253</option></select></label>
              {prItems.map((row, idx) => row.itemId && <div key={row.itemId} className="flex flex-wrap gap-2">
                <span>{row.name}</span>
                {(['supply', 'tax', 'accountCode'] as const).map(field => <label key={field}>
                  {{ supply: '공급가', tax: '세액', accountCode: '발생 계정' }[field]}
                  <input aria-label={`${row.name} ${{ supply: '공급가', tax: '세액', accountCode: '발생 계정' }[field]}`}
                    type={field === 'accountCode' ? 'text' : 'number'} min={0}
                    value={explicitMoney[row.itemId!]?.[field] ?? ''}
                    onChange={e => setExplicitMoney(prev => ({ ...prev, [row.itemId!]: {
                      ...(prev[row.itemId!] ?? { supply: '', tax: '', accountCode: '' }), [field]: e.target.value } }))} />
                </label>)}
              </div>)}
            </div>}
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

        </div>
      )}

      {/* ── 전표 발행 모달 ── */}

    </div>
  );
};

// 회사가 바뀌면 거래처·수량·메모 등 이전 회사의 반품 초안을 함께 비운다.
const ReceivingReturnsManager: React.FC<ReceivingReturnsManagerProps> = props => (
  <CompanyReceivingReturnsManager key={`${props.companyId}:${returnSubmissionActorUid() ?? ""}`} {...props} />
);

export default ReceivingReturnsManager;
