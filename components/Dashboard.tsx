
import React, { useMemo, useState } from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import {
  ShoppingBag,
  AlertCircle,
  PackageCheck,
  Truck,
  ChevronDown,
  ChevronUp,
  ShoppingCart
} from 'lucide-react';
import { Order, Product, OrderStatus, ViewType, Client } from '../types';
import PageHeader from './PageHeader';

interface DashboardProps {
  orders: Order[];
  products: Product[];
  clients?: Client[];
  onNavigate?: (view: ViewType) => void;
  onCreatePurchaseOrder?: (supplierId: string, supplierName: string, items: Array<{ name: string; spec: string; qty: number; price: number }>) => void;
}

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ElementType;
  trend?: number | null;
  color: string;
  sub?: string;
  onClick?: () => void;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon: Icon, trend, color, sub, onClick }) => (
  <div
    onClick={onClick}
    className={`bg-white p-6 rounded-2xl shadow-sm border border-slate-100 transition-all ${onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]' : 'hover:shadow-md'}`}
  >
    <div className="flex items-center justify-between mb-4">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon size={24} className="text-white" />
      </div>
      {trend !== undefined && trend !== null && (
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${trend > 0 ? 'bg-emerald-100 text-emerald-700' : trend < 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>
          {trend > 0 ? '+' : ''}{trend}%
        </span>
      )}
      {onClick && (
        <span className="text-[10px] font-black text-slate-300 tracking-widest uppercase ml-auto">바로가기 →</span>
      )}
    </div>
    <p className="text-slate-500 text-sm font-medium">{title}</p>
    <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
    {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
  </div>
);

const Dashboard: React.FC<DashboardProps> = ({ orders, products, clients = [], onNavigate, onCreatePurchaseOrder }) => {
  const [showLowStock, setShowLowStock] = useState(false);
  const [selectedLowStock, setSelectedLowStock] = useState<Set<string>>(new Set());
  const [orderQtys, setOrderQtys] = useState<Record<string, string>>({});
  const today = useMemo(() => new Date(), []);
  const todayStr = today.toISOString().slice(0, 10);

  // 최근 7일 주문 차트 데이터 (실제 데이터)
  const chartData = useMemo(() => {
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (6 - i));
      const dateStr = date.toISOString().slice(0, 10);
      const count = orders.filter(o => o.createdAt?.slice(0, 10) === dateStr).length;
      return {
        name: i === 6 ? '오늘' : dayNames[date.getDay()],
        주문수: count,
      };
    });
  }, [orders, today]);

  // 이번 주 / 지난 주 주문 분리
  const { thisWeekOrders, lastWeekOrders } = useMemo(() => {
    const thisStart = new Date(today);
    thisStart.setDate(today.getDate() - 6);
    thisStart.setHours(0, 0, 0, 0);

    const lastStart = new Date(today);
    lastStart.setDate(today.getDate() - 13);
    lastStart.setHours(0, 0, 0, 0);

    const lastEnd = new Date(today);
    lastEnd.setDate(today.getDate() - 7);
    lastEnd.setHours(23, 59, 59, 999);

    return {
      thisWeekOrders: orders.filter(o => new Date(o.createdAt) >= thisStart),
      lastWeekOrders: orders.filter(o => {
        const d = new Date(o.createdAt);
        return d >= lastStart && d <= lastEnd;
      }),
    };
  }, [orders, today]);

  // 증감률 계산
  const calcTrend = (thisVal: number, lastVal: number): number | null => {
    if (lastVal === 0) return null;
    return Math.round(((thisVal - lastVal) / lastVal) * 1000) / 10;
  };

  // StatCard 값 계산
  const thisWeekItems = thisWeekOrders.reduce((s, o) => s + o.items.reduce((is, i) => is + i.quantity, 0), 0);
  const lastWeekItems = lastWeekOrders.reduce((s, o) => s + o.items.reduce((is, i) => is + i.quantity, 0), 0);
  const itemTrend = calcTrend(thisWeekItems, lastWeekItems);

  const orderTrend = calcTrend(thisWeekOrders.length, lastWeekOrders.length);

  const activeClients = new Set(orders.map(o => o.clientId)).size;

  const lowStockList = products.filter(p =>
    p.category !== '완제품' && p.minStock > 0 && p.stock < p.minStock
  ).sort((a, b) => (a.stock - a.minStock) - (b.stock - b.minStock)); // 부족량 큰 순
  const lowStockItems = lowStockList.length;

  // 오늘 출고 예정
  const todayDispatch = orders.filter(
    o => o.deliveryDate === todayStr && o.status !== OrderStatus.DELIVERED
  ).length;

  // 최근 주문 (최신순)
  const recentOrders = useMemo(() =>
    [...orders]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5),
    [orders]
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="비즈니스 현황"
        subtitle={`${today.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })} 기준`}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="이번 주 주문 상품량"
          value={`${thisWeekItems.toLocaleString()}개`}
          icon={PackageCheck}
          trend={itemTrend}
          color="bg-indigo-600"
          sub={itemTrend !== null ? `지난 주 대비 ${itemTrend > 0 ? '증가' : '감소'}` : undefined}
          onClick={onNavigate ? () => onNavigate('orders') : undefined}
        />
        <StatCard
          title="이번 주 주문 수"
          value={`${thisWeekOrders.length}건`}
          icon={ShoppingBag}
          trend={orderTrend}
          color="bg-violet-600"
          sub={`전체 ${orders.length}건`}
          onClick={onNavigate ? () => onNavigate('orders') : undefined}
        />
        <StatCard
          title="오늘 출고 예정"
          value={`${todayDispatch}건`}
          icon={Truck}
          color="bg-sky-600"
          sub={`활성 거래처 ${activeClients}곳`}
          onClick={onNavigate ? () => onNavigate('orders') : undefined}
        />
        <StatCard
          title="재고 부족 상품"
          value={`${lowStockItems}개`}
          icon={AlertCircle}
          color="bg-rose-500"
          sub={lowStockItems > 0 ? '클릭하여 발주 관리' : '재고 정상'}
          onClick={lowStockItems > 0 ? () => setShowLowStock(v => !v) : undefined}
        />
      </div>

      {/* ── 재고 부족 알림 패널 ── */}
      {showLowStock && lowStockList.length > 0 && (() => {
        const toggleItem = (id: string) => setSelectedLowStock(prev => {
          const next = new Set(prev);
          next.has(id) ? next.delete(id) : next.add(id);
          return next;
        });
        const allSelected = lowStockList.every(p => selectedLowStock.has(p.id));
        const toggleAll = () => setSelectedLowStock(allSelected ? new Set() : new Set(lowStockList.map(p => p.id)));

        const handleCreateOrder = () => {
          const selected = lowStockList.filter(p => selectedLowStock.has(p.id));
          if (selected.length === 0) return;
          // 공급업체별로 그룹화
          const grouped = new Map<string, { name: string; items: typeof selected }>();
          selected.forEach(p => {
            const supplierId = p.supplierId ?? '__none__';
            const supplier = clients.find(c => c.id === supplierId);
            const supplierName = supplier?.name ?? '공급처 미지정';
            const existing = grouped.get(supplierId) ?? { name: supplierName, items: [] };
            existing.items.push(p);
            grouped.set(supplierId, existing);
          });
          // 첫 번째 그룹으로 발주서 생성 (공급처 여러 개면 첫 번째만)
          const [firstSupplierId, firstGroup] = [...grouped.entries()][0];
          onCreatePurchaseOrder?.(
            firstSupplierId === '__none__' ? '' : firstSupplierId,
            firstGroup.name,
            firstGroup.items.map(p => ({
              name: p.name,
              spec: p.용량 ?? '',
              qty: Number(orderQtys[p.id]) || Math.max(1, p.minStock - p.stock),
              price: p.cost ?? 0,
            }))
          );
        };

        return (
          <div className="bg-white rounded-2xl border border-rose-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-rose-50 border-b border-rose-100">
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="text-rose-500"/>
                <span className="font-black text-rose-700 text-sm">재고 부족 품목 — {lowStockList.length}개</span>
                <span className="text-[10px] text-rose-400">최소 재고 이하 항목입니다</span>
              </div>
              <div className="flex items-center gap-2">
                {selectedLowStock.size > 0 && (
                  <button
                    onClick={handleCreateOrder}
                    className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-black hover:bg-rose-700 transition-all"
                  >
                    <ShoppingCart size={13}/>선택 품목 발주서 생성 ({selectedLowStock.size})
                  </button>
                )}
                <button onClick={() => setShowLowStock(false)} className="p-1.5 text-rose-400 hover:bg-rose-100 rounded-lg transition-all">
                  <ChevronUp size={16}/>
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2.5 text-center">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll}
                        className="w-3.5 h-3.5 rounded accent-rose-500 cursor-pointer"/>
                    </th>
                    {['품목명', '단위', '현재 재고', '최소 재고', '부족량', '발주 수량', '공급처'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {lowStockList.map(p => {
                    const shortage = p.minStock - p.stock;
                    const supplier = clients.find(c => c.id === p.supplierId);
                    const isChecked = selectedLowStock.has(p.id);
                    return (
                      <tr key={p.id} className={`transition-colors ${isChecked ? 'bg-rose-50/50' : 'hover:bg-slate-50'}`}>
                        <td className="px-4 py-3 text-center">
                          <input type="checkbox" checked={isChecked} onChange={() => toggleItem(p.id)}
                            className="w-3.5 h-3.5 rounded accent-rose-500 cursor-pointer"/>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-black text-slate-800">{p.name}</span>
                          {p.용량 && <span className="ml-1.5 text-[10px] text-slate-400">{p.용량}</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">{p.unit}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-black text-rose-600">{p.stock}{p.unit}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">{p.minStock}{p.unit}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg">
                            -{shortage}{p.unit}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={orderQtys[p.id] ?? shortage}
                            onChange={e => setOrderQtys(prev => ({ ...prev, [p.id]: e.target.value }))}
                            className="w-20 text-right bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-rose-300"
                          />
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {supplier?.name ?? <span className="text-slate-300">미지정</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-slate-900">최근 7일 주문 트렌드</h3>
            <span className="text-xs font-bold text-slate-400">일별 주문 건수</span>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.12}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(v: number) => [`${v}건`, '주문']}
                />
                <Area
                  type="monotone"
                  dataKey="주문수"
                  stroke="#4f46e5"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorOrders)"
                  dot={{ fill: '#4f46e5', strokeWidth: 0, r: 4 }}
                  activeDot={{ r: 6, fill: '#4f46e5' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-6">최근 주문 내역</h3>
          {recentOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-300">
              <PackageCheck size={32} className="mb-2" />
              <p className="text-sm font-medium">주문 내역이 없습니다</p>
            </div>
          ) : (
            <div className="space-y-4">
              {recentOrders.map(order => (
                <div key={order.id} className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-black text-sm flex-shrink-0">
                      {order.customerName?.[0] ?? '?'}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800 leading-tight">{order.customerName}</p>
                      <p className="text-xs text-slate-400">{new Date(order.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}</p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-indigo-600">{order.items.length}개 품목</p>
                    <p className="text-[10px] text-slate-300 font-medium mt-0.5">
                      {order.items.reduce((s, i) => s + i.quantity, 0)}개
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
