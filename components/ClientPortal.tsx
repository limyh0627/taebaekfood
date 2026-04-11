
import React, { useState, useMemo } from 'react';
import { 
  ShoppingBag, 
  User, 
  Package, 
  Plus, 
  Minus, 
  ArrowRight, 
  CheckCircle2, 
  ArrowLeft,
  X,
  AlertCircle
} from 'lucide-react';
import { Client, Product, Order, OrderStatus, OrderSource, OrderItem } from '../types';

interface ClientPortalProps {
  clients: Client[];
  products: Product[];
  onOrderSubmit: (_order: Order) => void;
  onExit: () => void;
}

const ClientPortal: React.FC<ClientPortalProps> = ({ clients, products, onOrderSubmit, onExit }) => {
  const [step, setStep] = useState<'auth' | 'order' | 'confirm'>('auth');
  const [clientIdInput, setClientIdInput] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [cart, setCart] = useState<{ [productId: string]: number }>({});
  const [isSuccess, setIsSuccess] = useState(false);

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    const client = clients.find(c => c.id.toLowerCase() === clientIdInput.toLowerCase());
    if (client) {
      setSelectedClient(client);
      setStep('order');
    } else {
      alert('유효하지 않은 거래처 코드입니다. (예: c1, c2)');
    }
  };

  const associatedProducts = useMemo(() => {
    if (!selectedClient) return [];
    return products.filter(p => 
      p.category === '완제품' && 
      (!p.clientIds?.length || p.clientIds.includes(selectedClient.id))
    );
  }, [products, selectedClient]);

  const updateCart = (productId: string, delta: number) => {
    setCart(prev => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
      if (next === 0) {
        const { [productId]: _unused, ...rest } = prev;
        return rest;
      }
      return { ...prev, [productId]: next };
    });
  };

  // Fix: Explicitly type reduce parameters to avoid arithmetic error with unknown types
  const totalAmount = Object.entries(cart).reduce((sum: number, [id, qty]) => {
    const product = products.find(p => p.id === id);
    // Fix: Explicitly cast qty as number as Object.entries value might be inferred as unknown in some environments
    return sum + (product ? product.price * (qty as number) : 0);
  }, 0);

  const handleSubmit = () => {
    if (!selectedClient) return;

    const orderItems: OrderItem[] = Object.entries(cart).map(([id, qty]) => {
      const product = products.find(p => p.id === id)!;
      return {
        productId: id,
        name: product.name,
        // Fix: Explicitly cast qty as number to match OrderItem.quantity type
        quantity: qty as number,
        price: product.price,
        checked: false
      };
    });

    const newOrder: Order = {
      id: `WEB-${Date.now()}`,
      clientId: selectedClient.id,
      customerName: selectedClient.name,
      items: orderItems,
      totalAmount,
      status: OrderStatus.PENDING,
      createdAt: new Date().toISOString(),
      deliveryDate: new Date(Date.now() + 86400000 * 3).toISOString(), // 기본 3일 뒤
      email: selectedClient.email || '',
      source: selectedClient.type as OrderSource,
      region: selectedClient.region || '미지정'
    };

    onOrderSubmit(newOrder);
    setIsSuccess(true);
    setStep('confirm');
  };

  if (step === 'auth') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-[40px] shadow-2xl p-10 border border-slate-100 text-center">
          <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center text-white mx-auto shadow-xl mb-8">
            <ShoppingBag size={40} />
          </div>
          <h2 className="text-3xl font-black text-slate-900 mb-2">거래처 주문 포털</h2>
          <p className="text-slate-500 font-medium mb-10">귀사의 거래처 코드를 입력하여<br/>상품 주문을 시작하세요.</p>
          
          <form onSubmit={handleAuth} className="space-y-4">
            <div className="relative">
              <User className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
              <input 
                autoFocus
                type="text" 
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
                placeholder="거래처 코드 (ID)" 
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-14 pr-4 py-4 font-black text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
              />
            </div>
            <button type="submit" className="w-full bg-slate-900 text-white py-5 rounded-3xl font-black shadow-xl hover:bg-black active:scale-95 transition-all">
              입장하기
            </button>
          </form>
          
          <button onClick={onExit} className="mt-8 text-slate-400 font-bold flex items-center justify-center mx-auto hover:text-indigo-600 transition-colors">
            <ArrowLeft size={16} className="mr-2" />
            관리자 화면으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  if (step === 'confirm' && isSuccess) {
    return (
      <div className="min-h-screen bg-emerald-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-[40px] shadow-2xl p-10 text-center border border-emerald-100">
           <div className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-8 animate-bounce">
              <CheckCircle2 size={56} />
           </div>
           <h3 className="text-3xl font-black text-slate-900 mb-4">주문이 접수되었습니다!</h3>
           <p className="text-slate-500 font-medium leading-relaxed mb-10">
              {selectedClient?.name}님의 주문이 성공적으로 전송되었습니다.<br/>
              관리자가 확인 후 발송 처리를 시작합니다.
           </p>
           <button 
              onClick={() => { setStep('order'); setCart({}); setIsSuccess(false); }}
              className="w-full bg-emerald-600 text-white py-5 rounded-3xl font-black shadow-xl hover:bg-emerald-700 transition-all"
           >
              추가 주문하기
           </button>
           <button onClick={onExit} className="mt-6 text-slate-400 font-bold hover:text-emerald-600 transition-colors">
              포털 나가기
           </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-5 sticky top-0 z-20 flex items-center justify-between">
         <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center">
               <ShoppingBag size={20} />
            </div>
            <div>
               <h2 className="font-black text-slate-900">{selectedClient?.name}</h2>
               <p className="text-[10px] text-indigo-600 font-black uppercase tracking-widest">{selectedClient?.type} 채널</p>
            </div>
         </div>
         <button onClick={() => setStep('auth')} className="p-2 text-slate-400 hover:bg-slate-50 rounded-full">
            <X size={24} />
         </button>
      </header>

      <main className="flex-1 p-6 space-y-8 max-w-4xl mx-auto w-full">
         <div className="bg-indigo-600 rounded-[32px] p-8 text-white flex flex-col md:flex-row md:items-center justify-between gap-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full translate-x-32 -translate-y-32 blur-3xl" />
            <div>
               <h3 className="text-2xl font-black mb-1">안녕하세요!</h3>
               <p className="text-indigo-100 font-medium">오늘도 귀한 상품을 주문해주셔서 감사합니다.</p>
            </div>
            <div className="bg-white/20 backdrop-blur-md px-6 py-4 rounded-2xl flex flex-col items-center">
               <p className="text-[10px] font-black uppercase tracking-widest opacity-70">주문 합계</p>
               <p className="text-2xl font-black">{totalAmount.toLocaleString()}원</p>
            </div>
         </div>

         <div className="space-y-4">
            <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center">
               <Package size={16} className="mr-2" /> 주문 가능 품목 ({associatedProducts.length})
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {associatedProducts.map(p => {
                  const qty = cart[p.id] || 0;
                  return (
                     <div key={p.id} className={`bg-white p-5 rounded-3xl border transition-all ${qty > 0 ? 'border-indigo-500 shadow-xl shadow-indigo-50 ring-1 ring-indigo-500' : 'border-slate-100'}`}>
                        <div className="flex items-center justify-between mb-4">
                           <div className="flex items-center space-x-4">
                              <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400">
                                 <Package size={28} />
                              </div>
                              <div>
                                 <h5 className="font-black text-slate-800">{p.name}</h5>
                                 <p className="text-xs font-bold text-indigo-600">{p.price.toLocaleString()}원 / {p.unit}</p>
                              </div>
                           </div>
                        </div>
                        
                        <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                           <span className="text-[10px] font-bold text-slate-400 uppercase">수량 선택</span>
                           <div className="flex items-center space-x-4 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                              <button onClick={() => updateCart(p.id, -1)} className="p-2 bg-white text-slate-400 rounded-xl hover:text-indigo-600 transition-colors shadow-sm">
                                 <Minus size={16} />
                              </button>
                              <span className="w-8 text-center font-black text-slate-800">{qty}</span>
                              <button onClick={() => updateCart(p.id, 1)} className="p-2 bg-white text-slate-400 rounded-xl hover:text-indigo-600 transition-colors shadow-sm">
                                 <Plus size={16} />
                              </button>
                           </div>
                        </div>
                     </div>
                  );
               })}
               
               {associatedProducts.length === 0 && (
                  <div className="col-span-full py-20 bg-white border-2 border-dashed border-slate-100 rounded-[40px] flex flex-col items-center justify-center text-center">
                     <AlertCircle size={48} className="text-slate-200 mb-4" />
                     <p className="text-slate-400 font-bold">주문 가능한 품목이 없습니다.<br/>관리자에게 문의해주세요.</p>
                  </div>
               )}
            </div>
         </div>
      </main>

      {/* Floating Action Button (Order Summary) */}
      {Object.keys(cart).length > 0 && (
         <div className="fixed bottom-10 left-0 right-0 px-6 z-30 pointer-events-none">
            <div className="max-w-md mx-auto pointer-events-auto">
               <button 
                  onClick={handleSubmit}
                  className="w-full bg-slate-900 text-white p-6 rounded-[32px] shadow-2xl flex items-center justify-between hover:bg-black hover:scale-[1.02] transition-all group"
               >
                  <div className="flex items-center space-x-4">
                     <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                        <ShoppingBag size={24} />
                     </div>
                     <div className="text-left">
                        {/* Fix: Explicitly type reduce parameters to avoid arithmetic error with unknown types */}
                        <p className="text-[10px] font-black uppercase tracking-widest opacity-60">총 {Object.values(cart).reduce((a: number, b: number) => a + b, 0)}개 상품 선택됨</p>
                        <p className="text-xl font-black">{totalAmount.toLocaleString()}원 주문하기</p>
                     </div>
                  </div>
                  <ArrowRight size={24} className="group-hover:translate-x-2 transition-transform" />
               </button>
            </div>
         </div>
      )}
    </div>
  );
};

export default ClientPortal;
