import React, { useMemo, useState } from 'react';
import { Order, Partner, Item } from '../src/shared/types';
import { TrendingUp, Users, RefreshCw, ChevronDown, ChevronUp, Tag, Check, X } from 'lucide-react';
import PageHeader from './PageHeader';

interface Props {
  orders: Order[];partners;items;
  onUpdateProduct: (id: string, data: Partial<Item>) => void;
}

type Tab = 'monthly' | 'customers' | 'retention' | 'prices';

function formatAmount(n: number) {
  return n.toLocaleString('ko-KR') + '원';
}

function getYearMonth(dateStr: string) {
  return dateStr.slice(0, 7);
}

function formatYearMonth(ym: string) {
  const [y, m] = ym.split('-');
  return `${y}년 ${parseInt(m)}월`;
}

export default function SmartStoreAnalytics({ orders, partners, items, onUpdateProduct }: Props) {
  const [tab, setTab] = useState<Tab>('monthly');
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [expandedRetention, setExpandedRetention] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const ssOrders = useMemo(
    () => orders.filter(o => o.source === '스마트스토어'),
    [orders]
  );

  const ssClients = useMemo(
    () => partners.filter(c => c.type === '스마트스토어'),
    [partners]
  );

  const ssProducts = useMemo(
    () => items.filter(p =>
      p.isSmartStore === true || p.partnerIds?.includes('SMARTSTORE')
    ).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [items]
  );

  const priceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of items) {
      if (p.smartStorePrice != null) m.set(p.id, p.smartStorePrice);
    }
    return m;
  }, [items]);

  // itemId → name 맵
  const productNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of items) m.set(p.id, p.name);
    return m;
  }, [items]);

  function calcRevenue(o: Order) {
    return o.items.reduce((sum, item) => {
      const unitPrice = priceMap.get(item.itemId) ?? item.price;
      return sum + unitPrice * item.quantity;
    }, 0);
  }

  // 고객별 첫 주문 월
  const firstOrderMonthMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of ssOrders.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const key = o.partnerId ?? o.customerName;
      if (!m.has(key)) m.set(key, getYearMonth(o.createdAt));
    }
    return m;
  }, [ssOrders]);

  // ── 월별 매출 ──────────────────────────────────────────────
  const monthlyData = useMemo(() => {
    const map = new Map<string, { revenue: number; orderCount: number; partnerIds: Set<string> }>();
    for (const o of ssOrders) {
      const ym = getYearMonth(o.createdAt);
      if (!map.has(ym)) map.set(ym, { revenue: 0, orderCount: 0, partnerIds: new Set() });
      const row = map.get(ym)!;
      row.revenue += calcRevenue(o);
      row.orderCount += 1;
      if (o.partnerId) row.partnerIds.add(o.partnerId);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([ym, data]) => ({ ym, ...data, uniqueClients: data.partnerIds.size }));
  }, [ssOrders, priceMap]);

  // ── 고객별 현황 (품목 내역 포함) ─────────────────────────────
  const customerData = useMemo(() => {
    const clientMap = new Map<string, {
      client: Partner;
      monthlyOrders: Map<string, { count: number; amount: number }>;
      productSummary: Map<string, { name: string; qty: number; amount: number }>;
    }>();

    for (const o of ssOrders) {
      const key = o.partnerId ?? o.customerName;
      if (!clientMap.has(key)) {
        const client = ssClients.find(c => c.id === o.partnerId) ?? {
          id: key,
          name: o.customerName,
          type: '스마트스토어' as const,
        };
        clientMap.set(key, { client, monthlyOrders: new Map(), productSummary: new Map() });
      }
      const entry = clientMap.get(key)!;

      // 월별 집계
      const ym = getYearMonth(o.createdAt);
      if (!entry.monthlyOrders.has(ym)) entry.monthlyOrders.set(ym, { count: 0, amount: 0 });
      const mo = entry.monthlyOrders.get(ym)!;
      mo.count += 1;
      mo.amount += calcRevenue(o);

      // 품목별 집계
      for (const item of o.items) {
        const pid = item.itemId;
        if (!entry.productSummary.has(pid)) {
          entry.productSummary.set(pid, {
            name: productNameMap.get(pid) ?? item.name,
            qty: 0,
            amount: 0,
          });
        }
        const ps = entry.productSummary.get(pid)!;
        const unitPrice = priceMap.get(pid) ?? item.price;
        ps.qty += item.quantity;
        ps.amount += unitPrice * item.quantity;
      }
    }

    return Array.from(clientMap.values()).map(({ client, monthlyOrders, productSummary }) => {
      const months = Array.from(monthlyOrders.entries()).sort((a, b) => b[0].localeCompare(a[0]));
      const productList = Array.from(productSummary.values()).sort((a, b) => b.amount - a.amount);
      const totalAmount = months.reduce((s, [, v]) => s + v.amount, 0);
      const totalOrders = months.reduce((s, [, v]) => s + v.count, 0);
      const firstMonth = firstOrderMonthMap.get(client.id) ?? '';
      return { client, months, productList, totalAmount, totalOrders, activeMonths: months.length, firstMonth };
    }).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [ssOrders, ssClients, priceMap, productNameMap, firstOrderMonthMap]);

  // ── 신규/재주문 분석 ─────────────────────────────────────────
  const retentionData = useMemo(() => {
    const map = new Map<string, {
      newClients: Array<{ key: string; name: string }>;
      returningClients: Set<string>;
      newRevenue: number;
      returningRevenue: number;
    }>();

    for (const o of ssOrders) {
      const ym = getYearMonth(o.createdAt);
      const key = o.partnerId ?? o.customerName;
      if (!map.has(ym)) map.set(ym, { newClients: [], returningClients: new Set(), newRevenue: 0, returningRevenue: 0 });
      const row = map.get(ym)!;
      const rev = calcRevenue(o);
      if (firstOrderMonthMap.get(key) === ym) {
        // 이미 추가된 신규가 아닐 때만 push
        if (!row.newClients.find(c => c.key === key)) {
          const client = ssClients.find(c => c.id === o.partnerId);
          row.newClients.push({ key, name: client?.name ?? o.customerName });
        }
        row.newRevenue += rev;
      } else {
        row.returningClients.add(key);
        row.returningRevenue += rev;
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([ym, data]) => ({
        ym,
        newClients: data.newClients,
        newCount: data.newClients.length,
        returningCount: data.returningClients.size,
        newRevenue: data.newRevenue,
        returningRevenue: data.returningRevenue,
      }));
  }, [ssOrders, priceMap, firstOrderMonthMap, ssClients]);

  // ── 품목별 판매 현황 ────────────────────────────────────────
  const productSalesMap = useMemo(() => {
    const m = new Map<string, { qty: number; revenue: number }>();
    for (const o of ssOrders) {
      for (const item of o.items) {
        if (!m.has(item.itemId)) m.set(item.itemId, { qty: 0, revenue: 0 });
        const s = m.get(item.itemId)!;
        const unitPrice = priceMap.get(item.itemId) ?? item.price;
        s.qty += item.quantity;
        s.revenue += unitPrice * item.quantity;
      }
    }
    return m;
  }, [ssOrders, priceMap]);

  const totalRevenue = useMemo(() => ssOrders.reduce((s, o) => s + calcRevenue(o), 0), [ssOrders, priceMap]);

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'monthly', label: '월별 매출', icon: TrendingUp },
    { id: 'customers', label: '고객별 현황', icon: Users },
    { id: 'retention', label: '신규 / 재주문', icon: RefreshCw },
    { id: 'prices', label: '단가 관리', icon: Tag },
  ];

  function startEdit(p: Item) {
    setEditingId(p.id);
    setEditValue(String(p.smartStorePrice ?? p.price ?? ''));
  }
  function cancelEdit() { setEditingId(null); setEditValue(''); }
  function saveEdit(id: string) {
    const val = parseInt(editValue.replace(/,/g, ''), 10);
    if (!isNaN(val) && val >= 0) onUpdateProduct(id, { smartStorePrice: val });
    setEditingId(null); setEditValue('');
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <PageHeader title="스마트스토어 분석" subtitle={`총 ${ssOrders.length}건 주문 · 거래처 ${ssClients.length}개 · 전용 품목 ${ssProducts.length}개`} />

        {/* 요약 카드 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 font-medium">전체 매출 (단가 기준)</p>
            <p className="text-xl font-black text-lime-600 mt-1">{formatAmount(totalRevenue)}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 font-medium">전체 주문</p>
            <p className="text-xl font-black text-slate-800 mt-1">{ssOrders.length}건</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 font-medium">등록 거래처</p>
            <p className="text-xl font-black text-slate-800 mt-1">{ssClients.length}개</p>
          </div>
        </div>

        {/* 탭 */}
        <div className="flex gap-2 bg-white rounded-2xl p-1.5 shadow-sm border border-slate-100">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm font-bold transition-all ${
                  tab === t.id ? 'bg-lime-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                <Icon size={15} />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* ── 월별 매출 ── */}
        {tab === 'monthly' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-5 py-3 font-bold text-slate-600">월</th>
                  <th className="text-right px-5 py-3 font-bold text-slate-600">매출</th>
                  <th className="text-right px-5 py-3 font-bold text-slate-600">주문수</th>
                  <th className="text-right px-5 py-3 font-bold text-slate-600">활성 거래처</th>
                </tr>
              </thead>
              <tbody>
                {monthlyData.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-10 text-slate-400">스마트스토어 주문이 없습니다</td></tr>
                )}
                {monthlyData.map(row => (
                  <tr key={row.ym} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 font-semibold text-slate-700">{formatYearMonth(row.ym)}</td>
                    <td className="px-5 py-3.5 text-right font-bold text-lime-600">{formatAmount(row.revenue)}</td>
                    <td className="px-5 py-3.5 text-right text-slate-600">{row.orderCount}건</td>
                    <td className="px-5 py-3.5 text-right text-slate-600">{row.uniqueClients}개</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── 고객별 현황 ── */}
        {tab === 'customers' && (
          <div className="space-y-3">
            {customerData.length === 0 && (
              <div className="bg-white rounded-2xl p-10 text-center text-slate-400 shadow-sm border border-slate-100">스마트스토어 주문이 없습니다</div>
            )}
            {customerData.map(({ client, months, productList, totalAmount, totalOrders, activeMonths, firstMonth }) => {
              const isExpanded = expandedClient === client.id;
              const isNew = firstMonth === getYearMonth(new Date().toISOString()) || activeMonths === 1;
              return (
                <div key={client.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  <button
                    className="w-full px-5 py-4 flex items-center gap-3 hover:bg-slate-50 transition-colors"
                    onClick={() => setExpandedClient(isExpanded ? null : client.id)}
                  >
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-slate-800">{client.name}</p>
                        {firstMonth && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">
                            신규 {formatYearMonth(firstMonth)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{activeMonths}개월 활동 · 총 {totalOrders}건</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-black text-lime-600">{formatAmount(totalAmount)}</p>
                    </div>
                    {isExpanded ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-100">
                      {/* 월별 주문 내역 */}
                      <div className="px-5 pt-3 pb-1">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">월별 주문</p>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50">
                            <th className="text-left px-5 py-2 font-bold text-slate-500 text-xs">월</th>
                            <th className="text-right px-5 py-2 font-bold text-slate-500 text-xs">주문수</th>
                            <th className="text-right px-5 py-2 font-bold text-slate-500 text-xs">금액</th>
                          </tr>
                        </thead>
                        <tbody>
                          {months.map(([ym, data]) => (
                            <tr key={ym} className="border-t border-slate-50">
                              <td className="px-5 py-2 text-slate-600">{formatYearMonth(ym)}</td>
                              <td className="px-5 py-2 text-right text-slate-600">{data.count}건</td>
                              <td className="px-5 py-2 text-right font-semibold text-slate-700">{formatAmount(data.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* 품목별 주문 현황 */}
                      {productList.length > 0 && (
                        <>
                          <div className="px-5 pt-4 pb-1 border-t border-slate-100 mt-1">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">주문 품목</p>
                          </div>
                          <table className="w-full text-sm mb-2">
                            <thead>
                              <tr className="bg-slate-50">
                                <th className="text-left px-5 py-2 font-bold text-slate-500 text-xs">품목</th>
                                <th className="text-right px-5 py-2 font-bold text-slate-500 text-xs">누적 수량</th>
                                <th className="text-right px-5 py-2 font-bold text-slate-500 text-xs">누적 금액</th>
                              </tr>
                            </thead>
                            <tbody>
                              {productList.map(item => (
                                <tr key={item.name} className="border-t border-slate-50">
                                  <td className="px-5 py-2 text-slate-700 font-medium">{item.name}</td>
                                  <td className="px-5 py-2 text-right text-slate-600">{item.qty.toLocaleString()}개</td>
                                  <td className="px-5 py-2 text-right font-semibold text-slate-700">{formatAmount(item.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── 신규/재주문 ── */}
        {tab === 'retention' && (
          <div className="space-y-3">
            {retentionData.length === 0 && (
              <div className="bg-white rounded-2xl p-10 text-center text-slate-400 shadow-sm border border-slate-100">스마트스토어 주문이 없습니다</div>
            )}
            {retentionData.map(row => {
              const isExpanded = expandedRetention === row.ym;
              return (
                <div key={row.ym} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  <button
                    className="w-full px-5 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors"
                    onClick={() => setExpandedRetention(isExpanded ? null : row.ym)}
                  >
                    <div className="flex-1 text-left">
                      <p className="font-bold text-slate-800">{formatYearMonth(row.ym)}</p>
                      <div className="flex gap-3 mt-1">
                        {row.newCount > 0 && (
                          <span className="text-xs text-blue-600 font-semibold">신규 {row.newCount}개</span>
                        )}
                        {row.returningCount > 0 && (
                          <span className="text-xs text-lime-600 font-semibold">재주문 {row.returningCount}개</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 space-y-0.5">
                      {row.newRevenue > 0 && <p className="text-sm font-bold text-blue-600">{formatAmount(row.newRevenue)}</p>}
                      {row.returningRevenue > 0 && <p className="text-sm font-bold text-lime-600">{formatAmount(row.returningRevenue)}</p>}
                    </div>
                    {isExpanded ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
                  </button>

                  {isExpanded && row.newClients.length > 0 && (
                    <div className="border-t border-slate-100 px-5 py-3">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">이 달 신규 거래처</p>
                      <div className="flex flex-wrap gap-2">
                        {row.newClients.map(c => (
                          <div key={c.key} className="flex items-center gap-1.5 bg-blue-50 border border-blue-100 rounded-full px-3 py-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                            <span className="text-xs font-bold text-blue-700">{c.name}</span>
                            <span className="text-[10px] text-blue-400">첫 주문 {formatYearMonth(row.ym)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── 단가 관리 ── */}
        {tab === 'prices' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
              <p className="text-xs text-slate-500">스마트스토어 전용 단가를 설정하면 모든 탭의 매출 집계에 즉시 반영됩니다.</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-3 font-bold text-slate-600">품목명</th>
                  <th className="text-right px-5 py-3 font-bold text-slate-600">기본 단가</th>
                  <th className="text-right px-5 py-3 font-bold text-slate-600">스마트스토어 단가</th>
                  <th className="text-right px-5 py-3 font-bold text-slate-600">누적 판매</th>
                  <th className="text-right px-5 py-3 font-bold text-slate-600">누적 매출</th>
                  <th className="w-16"></th>
                </tr>
              </thead>
              <tbody>
                {ssProducts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-slate-400">
                      스마트스토어 전용 품목이 없습니다.<br />
                      <span className="text-xs">품목 관리에서 스마트스토어 전용 체크 후 추가해주세요.</span>
                    </td>
                  </tr>
                )}
                {ssProducts.map(p => {
                  const sales = productSalesMap.get(p.id);
                  return (
                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-slate-800">{p.name}</p>
                        {p.spec && <p className="text-xs text-slate-400 mt-0.5">{p.spec}</p>}
                      </td>
                      <td className="px-5 py-3.5 text-right text-slate-400">{formatAmount(p.price)}</td>
                      <td className="px-5 py-3.5 text-right">
                        {editingId === p.id ? (
                          <input
                            type="number"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveEdit(p.id); if (e.key === 'Escape') cancelEdit(); }}
                            className="w-32 text-right border border-lime-400 rounded-lg px-2 py-1 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-lime-300"
                            autoFocus
                          />
                        ) : (
                          <span
                            className={`font-bold cursor-pointer ${p.smartStorePrice != null ? 'text-lime-600' : 'text-slate-300'}`}
                            onClick={() => startEdit(p)}
                          >
                            {p.smartStorePrice != null ? formatAmount(p.smartStorePrice) : '미설정'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right text-slate-600">
                        {sales ? `${sales.qty.toLocaleString()}개` : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-5 py-3.5 text-right font-semibold text-slate-700">
                        {sales ? formatAmount(sales.revenue) : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-3 py-3.5">
                        {editingId === p.id ? (
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => saveEdit(p.id)} className="p-1.5 rounded-lg bg-lime-500 text-white hover:bg-lime-600 transition-colors">
                              <Check size={13} />
                            </button>
                            <button onClick={cancelEdit} className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors">
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => startEdit(p)} className="text-xs text-slate-400 hover:text-lime-600 transition-colors px-2 py-1 rounded-lg hover:bg-lime-50">
                            수정
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
