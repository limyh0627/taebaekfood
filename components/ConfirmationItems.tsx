
import React, { useMemo } from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Package,
  ArrowRight,
  MessageSquare,
  AtSign,
  ShoppingCart
} from 'lucide-react';
import { AdjustmentRequest } from '../types';

interface ConfirmationItemsProps {
  requests: AdjustmentRequest[];
  onUpdateStatus: (_id: string, _status: 'processed' | 'rejected') => void;
  onProcessAdjustment: (_req: AdjustmentRequest) => void;
}

const ConfirmationItems: React.FC<ConfirmationItemsProps> = ({ 
  requests, 
  onUpdateStatus,
  onProcessAdjustment
}) => {
  const sortedRequests = useMemo(() => {
    return [...requests].sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  }, [requests]);

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 uppercase">확인사항 관리</h2>
          <p className="text-slate-500 text-sm font-medium">재고 변동 및 입고 취소 요청을 검토하고 처리하세요.</p>
        </div>
        {pendingCount > 0 && (
          <div className="bg-amber-50 border border-amber-100 px-4 py-2 rounded-xl flex items-center space-x-2">
            <AlertCircle size={18} className="text-amber-500" />
            <span className="text-sm font-bold text-amber-700">대기 중인 요청 {pendingCount}건</span>
          </div>
        )}
      </div>

      <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">요청 일시</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">품목명</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">요청 유형</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">변동 내용</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">사유</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">상태</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sortedRequests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center text-slate-400 font-medium">
                    확인할 사항이 없습니다.
                  </td>
                </tr>
              ) : (
                sortedRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2 text-slate-500">
                        <Clock size={14} />
                        <span className="text-xs font-bold">{new Date(req.requestedAt).toLocaleString()}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          req.type === 'chat_mention' ? 'bg-indigo-100 text-indigo-600' :
                          req.type === 'reorder_alert' ? 'bg-rose-100 text-rose-600' :
                          'bg-slate-100 text-slate-400'
                        }`}>
                          {req.type === 'chat_mention' ? <AtSign size={16} /> :
                           req.type === 'reorder_alert' ? <ShoppingCart size={16} /> :
                           <Package size={16} />}
                        </div>
                        <span className="text-sm font-black text-slate-800">{req.productName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter ${
                        req.type === 'quantity_change' ? 'bg-blue-50 text-blue-600' :
                        req.type === 'cancel_receipt' ? 'bg-rose-50 text-rose-600' :
                        req.type === 'reorder_alert' ? 'bg-rose-50 text-rose-600' :
                        'bg-indigo-50 text-indigo-600'
                      }`}>
                        {req.type === 'quantity_change' ? '수량 변동' :
                         req.type === 'cancel_receipt' ? '입고 취소' :
                         req.type === 'reorder_alert' ? '발주 필요' :
                         '채팅 언급'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {req.type === 'chat_mention' ? (
                        <span className="text-xs font-bold text-slate-400">-</span>
                      ) : req.type === 'reorder_alert' ? (
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold text-slate-400">재고 {req.originalQuantity}{req.unit || '개'}</span>
                          <ArrowRight size={12} className="text-slate-300" />
                          <span className="text-sm font-black text-rose-600">부족 {req.requestedQuantity}{req.unit || '개'}</span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold text-slate-400 line-through">{req.originalQuantity}</span>
                          <ArrowRight size={12} className="text-slate-300" />
                          <span className="text-sm font-black text-indigo-600">
                            {req.type === 'cancel_receipt' ? 0 : req.requestedQuantity}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2 max-w-[200px]">
                        <MessageSquare size={14} className="text-slate-300 flex-shrink-0" />
                        <span className="text-xs text-slate-600 truncate" title={req.reason}>{req.reason}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        {req.status === 'pending' && (
                          <span className="flex items-center space-x-1 text-amber-500 font-black text-[10px] uppercase">
                            <Clock size={12} />
                            <span>대기 중</span>
                          </span>
                        )}
                        {req.status === 'processed' && (
                          <span className="flex items-center space-x-1 text-emerald-500 font-black text-[10px] uppercase">
                            <CheckCircle2 size={12} />
                            <span>처리 완료</span>
                          </span>
                        )}
                        {req.status === 'rejected' && (
                          <span className="flex items-center space-x-1 text-rose-500 font-black text-[10px] uppercase">
                            <XCircle size={12} />
                            <span>반려됨</span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {req.status === 'pending' && (
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            onClick={() => {
                              if (req.type === 'chat_mention' || req.type === 'reorder_alert') {
                                onUpdateStatus(req.id, 'processed');
                              } else {
                                onProcessAdjustment(req);
                              }
                            }}
                            className={`px-3 py-1.5 text-white rounded-lg text-[10px] font-black transition-all shadow-sm ${req.type === 'reorder_alert' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                          >
                            {req.type === 'chat_mention' ? '확인 완료' :
                             req.type === 'reorder_alert' ? '발주 완료' :
                             '승인 및 반영'}
                          </button>
                          <button 
                            onClick={() => onUpdateStatus(req.id, 'rejected')}
                            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-400 rounded-lg text-[10px] font-black hover:bg-slate-50 transition-all"
                          >
                            반려
                          </button>
                        </div>
                      )}
                      {req.status !== 'pending' && (
                        <div className="text-center">
                          <span className="text-[10px] font-bold text-slate-300">
                            {req.processedAt ? new Date(req.processedAt).toLocaleDateString() : '-'}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationItems;
