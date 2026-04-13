
import React from 'react';
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
  Users, 
  CreditCard, 
  AlertCircle,
  PackageCheck
} from 'lucide-react';
import { Order, Product } from '../types';

interface DashboardProps {
  orders: Order[];
  products: Product[];
}

const StatCard = ({ title, value, icon: Icon, trend, color }: any) => (
  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
    <div className="flex items-center justify-between mb-4">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon size={24} className="text-white" />
      </div>
      {trend && (
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${trend > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
          {trend > 0 ? '+' : ''}{trend}%
        </span>
      )}
    </div>
    <p className="text-slate-500 text-sm font-medium">{title}</p>
    <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
  </div>
);

const Dashboard: React.FC<DashboardProps> = ({ orders, products }) => {
  const totalItemsOrdered = orders.reduce((sum, o) => sum + o.items.reduce((iSum, item) => iSum + item.quantity, 0), 0);
  const totalCustomers = new Set(orders.map(o => o.clientId)).size;
  const lowStockItems = products.filter(p => p.stock < 10).length;

  const chartData = [
    { name: '월', orders: 12 },
    { name: '화', orders: 19 },
    { name: '수', orders: 8 },
    { name: '목', orders: 15 },
    { name: '금', orders: 22 },
    { name: '토', orders: 11 },
    { name: '일', orders: 14 },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">비즈니스 현황</h2>
          <p className="text-slate-500 mt-1">실시간 운영 및 재고 지표를 확인하세요.</p>
        </div>
        <div className="hidden sm:block">
          <button className="bg-white border border-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
            운영 보고서
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="총 주문 상품량" 
          value={`${totalItemsOrdered.toLocaleString()}개`} 
          icon={PackageCheck} 
          trend={12.5}
          color="bg-indigo-600"
        />
        <StatCard 
          title="전체 주문 수" 
          value={`${orders.length}건`} 
          icon={CreditCard} 
          trend={-2.4}
          color="bg-violet-600"
        />
        <StatCard 
          title="거래처 수" 
          value={`${totalCustomers}곳`} 
          icon={Users} 
          trend={5.8}
          color="bg-sky-600"
        />
        <StatCard 
          title="재고 알림" 
          value={`${lowStockItems}개 상품`} 
          icon={AlertCircle} 
          color="bg-rose-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-6">주간 주문 트렌드 (건수)</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="orders" 
                  stroke="#4f46e5" 
                  strokeWidth={3} 
                  fillOpacity={1} 
                  fill="url(#colorOrders)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-6">최근 주문 내역</h3>
          <div className="space-y-4">
            {orders.slice(0, 5).map(order => (
              <div key={order.id} className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-xs">
                    {order.customerName[0]}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">{order.customerName}</p>
                    <p className="text-xs text-slate-400">{new Date(order.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-indigo-600">
                    {order.items.length}개 품목
                  </p>
                  <p className="text-[10px] text-slate-400 uppercase font-black">{order.id}</p>
                </div>
              </div>
            ))}
          </div>
          <button className="w-full mt-6 py-2 text-sm font-bold text-slate-500 hover:text-indigo-600 transition-colors">
            전체 주문 보기
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
