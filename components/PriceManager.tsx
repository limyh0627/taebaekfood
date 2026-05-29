
import React, { useState, useMemo } from 'react';
import { Tag, Search, Save, AlertCircle } from 'lucide-react';
import { Item, Partner, PartnerItem } from '../types';

interface PriceManagerProps {
  items: Item[];
  partners: Partner[];
  partnerItems?: import('../src/shared/types').PartnerItem[];
  productClients?: PartnerItem[];
  productSuppliers?: PartnerItem[];
  onUpdateProductClientPrice?: (id: string, price: number) => void;
  onUpdateProductClientTaxType?: (id: string, taxType: '과세' | '면세') => void;
  onUpsertProductSupplier?: (ps: PartnerItem) => void;
  onUpdateProductSupplierTaxType?: (id: string, taxType: '과세' | '면세') => void;
  onUpdateProductCost?: (itemId: string, cost: number) => void;
}

const PriceManager: React.FC<PriceManagerProps> = ({
  items, partners, partnerItems, productClients: _pc, productSuppliers: _ps,
  onUpdateProductClientPrice, onUpdateProductClientTaxType,
  onUpsertProductSupplier, onUpdateProductSupplierTaxType,
  onUpdateProductCost,
}) => {
  // Compute derived variables
  const products = items;
  const clients = partners;
  const productClients = (_pc ?? partnerItems ?? []).filter((pi: any) => pi.Direction === 'out');
  const productSuppliers = (_ps ?? partnerItems ?? []).filter((pi: any) => pi.Direction === 'in');
  const [mode, setMode] = useState<'매출' | '매입'>('매출');
  const [partnerId, setClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [taxEdits, setTaxEdits] = useState<Record<string, '과세' | '면세'>>({});
  const [costEdits, setCostEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const psMap = useMemo(() =>
    new Map(productSuppliers.map(ps => [ps.itemId ?? ps.Item_ID, ps.partnerId ?? ps.Partner_ID])),
    [productSuppliers]
  );

  const filteredClients = useMemo(() =>
    clients
      .filter(c => !clientSearch || c.name.includes(clientSearch))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [clients, clientSearch]
  );

  const selectedPcRows = useMemo(() =>
    partnerId
      ? productClients
          .filter(pc => (pc.partnerId ?? pc.Partner_ID) === partnerId)
          .map(pc => ({ pc, product: items.find(p => p.id === (pc.itemId ?? pc.Item_ID)) }))
          .filter(r => r.product)
          .sort((a, b) => a.product!.name.localeCompare(b.product!.name))
      : [],
    [productClients, products, partnerId]
  );

  const selectedPsRows = useMemo(() =>
    partnerId
      ? products
          .filter(p => psMap.get(p.id) === partnerId)
          .map(p => {
            const ps = productSuppliers.find(s =>
              (s.itemId ?? s.Item_ID) === p.id && (s.partnerId ?? s.Partner_ID) === partnerId
            ) ?? { id: `${p.id}_${partnerId}`, itemId: p.id, Item_ID: p.id, partnerId: partnerId, Partner_ID: partnerId, Direction: 'in' as const } as unknown as PartnerItem;
            return { ps, product: p };
          })
          .sort((a, b) => a.product.name.localeCompare(b.product.name))
      : [],
    [products, productSuppliers, psMap, partnerId]
  );

  const hasMissingPrice = mode === '매출'
    ? selectedPcRows.some(r => !r.pc.price && !r.pc.Standard_Price)
    : selectedPsRows.some(r => !r.ps.price && !r.ps.Standard_Price);

  const hasEdits = Object.keys(priceEdits).length > 0 || Object.keys(taxEdits).length > 0 || Object.keys(costEdits).length > 0;

  const saveAll = async () => {
    setSaving(true);
    if (mode === '매출') {
      for (const [pcId, val] of Object.entries(priceEdits)) {
        const n = parseFloat(val);
        if (!isNaN(n) && n >= 0) onUpdateProductClientPrice?.(pcId, n);
      }
      for (const [pcId, tax] of Object.entries(taxEdits)) {
        onUpdateProductClientTaxType?.(pcId, tax);
      }
      for (const [itemId, val] of Object.entries(costEdits)) {
        const n = parseFloat(val);
        if (!isNaN(n) && n >= 0) onUpdateProductCost?.(itemId, n);
      }
    } else {
      for (const [psId, val] of Object.entries(priceEdits)) {
        const n = parseFloat(val);
        if (isNaN(n) || n < 0) continue;
        const row = selectedPsRows.find(r => r.ps.id === psId);
        if (!row) continue;
        onUpsertProductSupplier?.({ ...row.ps, Standard_Price: n });
        const itemId = row.ps.Item_ID ?? row.ps.itemId;
        if (itemId) onUpdateProductCost?.(itemId, n);
      }
      for (const [psId, tax] of Object.entries(taxEdits)) {
        const row = selectedPsRows.find(r => r.ps.id === psId);
        if (!row) continue;
        onUpsertProductSupplier?.({ ...row.ps, taxType: tax });
        onUpdateProductSupplierTaxType?.(psId, tax);
      }
    }
    setPriceEdits({});
    setTaxEdits({});
    setCostEdits({});
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex gap-4 min-h-[600px]">
      {/* 좌측: 거래처 목록 */}
      <div className="w-56 shrink-0 bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="px-3 pt-3 pb-2 border-b border-slate-100">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"/>
            <input
              type="text"
              placeholder="거래처 검색..."
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
          {filteredClients.map(c => {
            const pcCount = mode === '매출'
              ? productClients.filter(pc => (pc.partnerId ?? pc.Partner_ID) === c.id).length
              : productSuppliers.filter(ps => (ps.partnerId ?? ps.Partner_ID) === c.id).length;
            const missingCount = mode === '매출'
              ? productClients.filter(pc => (pc.partnerId ?? pc.Partner_ID) === c.id && !pc.price && !pc.Standard_Price).length
              : productSuppliers.filter(ps => (ps.partnerId ?? ps.Partner_ID) === c.id && !ps.price && !ps.Standard_Price).length;
            if (pcCount === 0) return null;
            return (
              <button
                key={c.id}
                onClick={() => { setClientId(c.id); setPriceEdits({}); setTaxEdits({}); }}
                className={`w-full text-left px-3 py-2.5 transition-all hover:bg-violet-50 ${partnerId === c.id ? 'bg-violet-50 border-r-2 border-violet-500' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-black truncate ${partnerId === c.id ? 'text-violet-700' : 'text-slate-700'}`}>{c.name}</span>
                  {missingCount > 0 && (
                    <span className="text-[9px] font-black bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full ml-1 shrink-0">{missingCount}</span>
                  )}
                </div>
                <span className="text-[10px] text-slate-400">{pcCount}품목</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 우측: 단가 테이블 */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* 매출/매입 토글 */}
        <div className="flex items-center gap-2 px-5 pt-3 pb-2 border-b border-slate-100">
          <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
            {(['매출', '매입'] as const).map(m => (
              <button key={m}
                onClick={() => { setMode(m); setClientId(''); setPriceEdits({}); setTaxEdits({}); setCostEdits({}); }}
                className={`px-3 py-1 rounded-md text-xs font-black transition-all ${mode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                {m}단가
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-400">{mode === '매출' ? '거래처별 판매단가' : '매입처별 매입단가 (= 원가)'}</span>
        </div>

        {!partnerId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-300">
            <Tag size={40} strokeWidth={1.5}/>
            <span className="text-sm font-bold">좌측에서 거래처를 선택하세요</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="font-black text-slate-900 text-sm">{partners.find(c => c.id === partnerId)?.name}</span>
                <span className="text-xs text-slate-400">{mode === '매출' ? selectedPcRows.length : selectedPsRows.length}품목</span>
                {hasMissingPrice && (
                  <div className="flex items-center gap-1 text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">
                    <AlertCircle size={10}/>단가 미입력 품목 있음
                  </div>
                )}
              </div>
              <button
                onClick={saveAll}
                disabled={!hasEdits || saving}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all ${
                  saved ? 'bg-emerald-500 text-white' :
                  hasEdits ? 'bg-violet-600 text-white hover:bg-violet-700' :
                  'bg-slate-100 text-slate-300 cursor-not-allowed'
                }`}
              >
                <Save size={12}/>{saved ? '저장완료!' : '전체 저장'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {mode === '매출' ? (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-slate-50 z-10">
                    <tr>
                      <th className="px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">품목명</th>
                      <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">용량/규격</th>
                      <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">원가</th>
                      <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">매출단가</th>
                      <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">마진율</th>
                      <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">과세</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {selectedPcRows.map(({ pc, product }) => {
                      const priceEdited = priceEdits[pc.id] !== undefined;
                      const costEdited = costEdits[product!.id] !== undefined;
                      const taxEdited = taxEdits[pc.id] !== undefined;
                      const currentTax = taxEdits[pc.id] ?? pc.taxType ?? '과세';
                      const effectivePrice = priceEdits[pc.id] ? parseFloat(priceEdits[pc.id]) : (pc.price ?? pc.Standard_Price ?? 0);
                      const effectiveCost = costEdits[product!.id] ? parseFloat(costEdits[product!.id]) : (product!.cost ?? 0);
                      const margin = effectivePrice > 0 && effectiveCost > 0
                        ? Math.round((effectivePrice - effectiveCost) / effectivePrice * 100) : null;
                      const hasNoPrice = !pc.price && !pc.Standard_Price;
                      return (
                        <tr key={pc.id} className={`hover:bg-slate-50 transition-colors ${hasNoPrice ? 'bg-amber-50/40' : ''}`}>
                          <td className="px-5 py-3">
                            <span className="text-xs font-black text-slate-800">{product!.name}</span>
                            {hasNoPrice && <span className="ml-1.5 text-[9px] font-black text-amber-500 bg-amber-100 px-1.5 py-0.5 rounded-full">단가 미입력</span>}
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-400">{product!.spec || '-'}</td>
                          <td className="px-4 py-3"><div className="flex justify-end">
                            <input type="number" placeholder={product!.cost ? String(product!.cost) : '원가'} value={costEdits[product!.id] ?? ''}
                              onChange={e => setCostEdits(prev => ({ ...prev, [product!.id]: e.target.value }))}
                              className={`w-24 text-right bg-white border rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-orange-300 transition-all ${costEdited ? 'border-orange-400 bg-orange-50' : 'border-slate-200'}`}/>
                          </div></td>
                          <td className="px-4 py-3"><div className="flex justify-end">
                            <input type="number" placeholder={effectivePrice ? String(effectivePrice) : '단가 입력'} value={priceEdits[pc.id] ?? ''}
                              onChange={e => setPriceEdits(prev => ({ ...prev, [pc.id]: e.target.value }))}
                              className={`w-24 text-right bg-white border rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-violet-300 transition-all ${priceEdited ? 'border-violet-400 bg-violet-50' : 'border-slate-200'}`}/>
                          </div></td>
                          <td className="px-4 py-3 text-center">
                            {margin !== null
                              ? <span className={`text-[11px] font-black px-2 py-1 rounded-lg ${margin >= 30 ? 'bg-emerald-100 text-emerald-700' : margin >= 10 ? 'bg-amber-100 text-amber-700' : margin >= 0 ? 'bg-slate-100 text-slate-600' : 'bg-rose-100 text-rose-700'}`}>{margin}%</span>
                              : <span className="text-[10px] text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => setTaxEdits(prev => ({ ...prev, [pc.id]: (taxEdits[pc.id] ?? pc.taxType ?? '과세') === '과세' ? '면세' : '과세' }))}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all ${taxEdited ? currentTax === '면세' ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-slate-500 text-white border-slate-500' : currentTax === '면세' ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}>
                              {currentTax}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-slate-50 z-10">
                    <tr>
                      <th className="px-5 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">품목명</th>
                      <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">용량/규격</th>
                      <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">매입단가(원가)</th>
                      <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">과세</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {selectedPsRows.map(({ ps, product }) => {
                      const edited = priceEdits[ps.id] !== undefined;
                      const taxEdited = taxEdits[ps.id] !== undefined;
                      const currentTax = taxEdits[ps.id] ?? ps.taxType ?? '과세';
                      const hasNoPrice = !ps.price && !ps.Standard_Price;
                      return (
                        <tr key={ps.id} className={`hover:bg-slate-50 transition-colors ${hasNoPrice ? 'bg-amber-50/40' : ''}`}>
                          <td className="px-5 py-3">
                            <span className="text-xs font-black text-slate-800">{product.name}</span>
                            {hasNoPrice && <span className="ml-1.5 text-[9px] font-black text-amber-500 bg-amber-100 px-1.5 py-0.5 rounded-full">미입력</span>}
                          </td>
                          <td className="px-4 py-3 text-[11px] text-slate-400">{product.spec || '-'}</td>
                          <td className="px-4 py-3"><div className="flex justify-end">
                            <input type="number"
                              placeholder={ps.price ? String(ps.price) : ps.Standard_Price ? String(ps.Standard_Price) : '매입단가'}
                              value={priceEdits[ps.id] ?? ''}
                              onChange={e => setPriceEdits(prev => ({ ...prev, [ps.id]: e.target.value }))}
                              className={`w-28 text-right bg-white border rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-rose-300 transition-all ${edited ? 'border-rose-400 bg-rose-50' : 'border-slate-200'}`}/>
                          </div></td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => setTaxEdits(prev => ({ ...prev, [ps.id]: (taxEdits[ps.id] ?? ps.taxType ?? '과세') === '과세' ? '면세' : '과세' }))}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all ${taxEdited ? currentTax === '면세' ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-slate-500 text-white border-slate-500' : currentTax === '면세' ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}>
                              {currentTax}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PriceManager;
