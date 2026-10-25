import {STATUS_LABEL} from '../src/shared/orderStatusStyle';

import React from 'react';
import {useOutputScope} from '../src/shared/hooks/useOutputScope';
import type {CompanyId} from '../src/shared/types';
import type {PendingSubmissionRead} from '../src/shared/services/pendingSubmissionRead';
import { usePartnerPortalDraft } from '../src/features/orders/hooks/usePartnerPortalDraft';
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
import { Partner, Item, PartnerItem, Order, OrderStatus, OrderSource, OrderItem } from '../types';
import { isLinkedToPartner, salePriceOf } from '../src/shared/partnerPrice';

interface PartnerPortalProps {
  companyId:CompanyId;employeeId:string;getUid:()=>string|undefined;
  readOrder:(id:string,partnerId:string,signal:AbortSignal)=>Promise<PendingSubmissionRead<Order>>;
  partners: Partner[];
  items: Item[];
  /**
   * 거래처별 단가. **없으면 금액이 안 나온다** —
   * 전에는 죽은 `items.price` 를 보느라 모든 주문이 0원으로 들어갔다(2026-09-04).
   */
  partnerItems?: PartnerItem[];
  onOrderSubmit: (_order: Order) => Promise<unknown>;
  onExit: () => void;
}

const PartnerPortal: React.FC<PartnerPortalProps> = ({ companyId,employeeId,getUid,readOrder,partners, items, partnerItems, onOrderSubmit, onExit }) => {
  const getSignal=useOutputScope(companyId,employeeId);
  const { storageError,confirmedLocally,retryCheckpoint,readCheckpoint,restoreCheckpoint,checkpointText,pending,readPending,startNewOrder, step, partnerIdInput, selectedClient, cart, isSuccess, saving, error, associatedProducts, updateCart, 단가, totalAmount, handleSubmit, handleAuth, changePartnerInput, backToAuth, exit, orderAgain } = usePartnerPortalDraft({companyId,employeeId,getUid,getSignal,readOrder,partners, items, partnerItems, onOrderSubmit, onExit });

  const storageCard=storageError&&<section role="alert" className="m-4 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm"><p>{confirmedLocally?'주문 접수는 확인했지만 이 기기의 기록을 갱신하지 못했습니다. 최초 요청은 보존했습니다.':'현재 입력의 기기 보관을 확인하지 못했습니다. 입력은 화면에 보존했습니다.'}</p><p>{storageError}</p><button type="button" disabled={saving} onClick={()=>void retryCheckpoint()} className="rounded border px-3 py-2">다시 보관</button><button type="button" disabled={saving} onClick={readCheckpoint} className="ml-2 rounded border px-3 py-2">기기 기록 다시 읽기</button><button type="button" disabled={saving} onClick={()=>void restoreCheckpoint()} className="ml-2 rounded border px-3 py-2">보관본 열기</button><label className="block">입력 원문 복사<textarea readOnly value={checkpointText} className="mt-1 w-full rounded border p-2"/></label></section>;
  const recoveryCard=pending&&<section aria-label="원주문 결과 확인" className="m-4 break-words rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
    <p>확인할 주문 번호: {pending.order.id}</p><p>최초 주문: {pending.order.partnerName} · {pending.order.totalAmount.toLocaleString()}원</p>
    <ul>{pending.order.items.map((row,index)=><li key={index}>{row.name} {row.quantity}개 · {row.price.toLocaleString()}원</li>)}</ul>
    <p>최초 배송일: {pending.order.deliveryDate.slice(0,10)}</p>
    <p role="status">{pending.notice||'저장 결과를 아직 확인하지 못했습니다. 입력을 보존했으며 다시 보내지 않았습니다.'}</p>
    {pending.result?.kind==='found'&&<div aria-label="현재 등록된 주문"><p>현재 주문 번호: {pending.result.record.id}</p><p>현재 상태: {STATUS_LABEL[String(pending.result.record.status)]??'상태 확인 필요'}</p><p>현재 금액: {Number(pending.result.record.totalAmount??0).toLocaleString()}원</p><p>현재 배송일: {String(pending.result.record.deliveryDate??'').slice(0,10)}</p><ul>{(Array.isArray(pending.result.record.items)?pending.result.record.items:[]).map((row,index)=><li key={index}>{row.name} {row.quantity}개 · {Number(row.price??0).toLocaleString()}원</li>)}</ul></div>}
    <button type="button" disabled={!!pending.readRun||saving} onClick={()=>void readPending()} className="mt-2 rounded border px-3 py-2 disabled:opacity-40">{pending.readRun?'확인 중…':pending.result?'주문 다시 조회':'주문 저장 여부 확인'}</button>
    {pending.matches&&<button type="button" disabled={!!pending.readRun||saving} onClick={startNewOrder} className="ml-2 rounded border px-3 py-2">확인 후 새 주문 작성</button>}
    <p className="mt-2 text-xs">조회 결과가 없거나 다르면 다시 조회해 주세요. 화면을 닫거나 새로고침해도 서버 요청은 취소되지 않으며, 이 기기에 보관된 원문은 같은 계정으로 다시 확인할 수 있습니다. 보관 오류가 있으면 원문 복사 또는 다시 보관으로 확인해 주세요.</p>
  </section>;

  if (step === 'auth') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-[40px] shadow-2xl p-10 border border-slate-100 text-center">
          <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center text-white mx-auto shadow-xl mb-8">
            <ShoppingBag size={40} />
          </div>
          <h2 className="text-3xl font-black text-slate-900 mb-2">거래처 주문 포털</h2>
          {storageCard}{recoveryCard}
          <p className="text-slate-500 font-medium mb-10">귀사의 거래처 코드를 입력하여<br/>상품 주문을 시작하세요.</p>
          
          <form onSubmit={handleAuth} className="space-y-4">
            <div className="relative">
              <User className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
              <input 
                autoFocus
                type="text" 
                value={partnerIdInput}
                onChange={(e) => changePartnerInput(e.target.value)}
                placeholder="거래처 코드 (ID)" 
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-14 pr-4 py-4 font-black text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all"
              />
            </div>
            <button type="submit" className="w-full bg-slate-900 text-white py-5 rounded-3xl font-black shadow-xl hover:bg-black active:scale-95 transition-all">
              입장하기
            </button>
          </form>
          
          <button onClick={exit} disabled={saving} className="mt-8 text-slate-400 font-bold flex items-center justify-center mx-auto hover:text-indigo-600 transition-colors">
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
           <h3 className="text-3xl font-black text-slate-900 mb-4">주문이 접수되었습니다!</h3>{storageCard}
           <p className="text-slate-500 font-medium leading-relaxed mb-10">
              {selectedClient?.name}님의 주문이 성공적으로 전송되었습니다.<br/>
              관리자가 확인 후 발송 처리를 시작합니다.
           </p>
           <button 
              onClick={orderAgain}
              className="w-full bg-emerald-600 text-white py-5 rounded-3xl font-black shadow-xl hover:bg-emerald-700 transition-all"
           >
              추가 주문하기
           </button>
           <button onClick={exit} disabled={saving} className="mt-6 text-slate-400 font-bold hover:text-emerald-600 transition-colors">
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
         <button onClick={backToAuth} disabled={saving} className="p-2 text-slate-400 hover:bg-slate-50 rounded-full">
            <X size={24} />
         </button>
      </header>

      {storageCard}{recoveryCard}
      {error && <p role="alert" className="px-6 py-2 text-sm text-slate-700">{error}</p>}
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
                                 <p className="text-xs font-bold text-indigo-600">
                                   {단가(p.id) === undefined
                                     ? <span className="text-amber-600">단가 미정</span>
                                     : `${단가(p.id)!.toLocaleString()}원 / ${p.unit}`}
                                 </p>
                              </div>
                           </div>
                        </div>
                        
                        <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                           <span className="text-[10px] font-bold text-slate-400 uppercase">수량 선택</span>
                           <div className="flex items-center space-x-4 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                              <button disabled={saving} onClick={() => updateCart(p.id, -1)} className="p-2 bg-white text-slate-400 rounded-xl hover:text-indigo-600 transition-colors shadow-sm">
                                 <Minus size={16} />
                              </button>
                              <span className="w-8 text-center font-black text-slate-800">{qty}</span>
                              <button disabled={saving} onClick={() => updateCart(p.id, 1)} className="p-2 bg-white text-slate-400 rounded-xl hover:text-indigo-600 transition-colors shadow-sm">
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
                  disabled={saving||!!pending}
                  className="w-full bg-slate-900 text-white p-6 rounded-[32px] shadow-2xl flex items-center justify-between hover:bg-black hover:scale-[1.02] transition-all group"
               >
                  <div className="flex items-center space-x-4">
                     <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                        <ShoppingBag size={24} />
                     </div>
                     <div className="text-left">
                        {/* Fix: Explicitly type reduce parameters to avoid arithmetic error with unknown types */}
                        <p className="text-[10px] font-black uppercase tracking-widest opacity-60">총 {Object.values(cart).reduce((a: number, b: number) => a + b, 0)}개 상품 선택됨</p>
                        <p className="text-xl font-black">{saving ? '주문 저장 중…' : `${totalAmount.toLocaleString()}원 주문하기`}</p>
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

export default PartnerPortal;
