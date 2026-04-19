
import React, { useMemo } from 'react';
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
  Truck
} from 'lucide-react';
import { Order, Product, OrderStatus, ViewType } from '../types';
import PageHeader from './PageHeader';

interface DashboardProps {
  orders: Order[];
  products: Product[];
  onNavigate?: (view: ViewType) => void;
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

const Dashboard: React.FC<DashboardProps> = ({ orders, products, onNavigate }) => {
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

  const lowStockItems = products.filter(p =>
    p.category !== '완제품' && p.minStock > 0 && p.stock < p.minStock
  ).length;

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
          sub={lowStockItems > 0 ? '최소 재고 이하 항목' : '재고 정상'}
          onClick={onNavigate ? () => onNavigate('inventory') : undefined}
        />
      </div>

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
