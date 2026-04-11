
import React, { useMemo, useState } from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Package,
  ArrowRight,
  MessageSquare,
  AtSign,
  ShoppingCart,
  ChevronDown,
  ChevronUp
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sortedRequests = useMemo(() => {
    return [...requests].sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  }, [requests]);

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  const getTypeLabel = (type: string) => {
    if (type === 'quantity_change') return '수량 변동';
    if (type === 'cancel_receipt') return '입고 취소';
    if (type === 'reorder_alert') return '발주 필요';
    return '채팅 언급';
  };

  const getTypeClass = (type: string) => {
    if (type === 'quantity_change') return 'bg-blue-50 text-blue-600';
    if (type === 'cancel_receipt') return 'bg-rose-50 text-rose-600';
    if (type === 'reorder_alert') return 'bg-rose-50 text-rose-600';
    return 'bg-indigo-50 text-indigo-600';
  };

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
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">요청 일시</th>
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">품목명</th>
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">요청 유형</th>
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">변동 내용</th>
                <th className="hidden sm:table-cell px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">사유</th>
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">상태</th>
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">관리</th>
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
                  <React.Fragment key={req.id}>
                    <tr
                      className="hover:bg-slate-50/50 transition-colors group cursor-pointer sm:cursor-default"
                      onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center space-x-1 text-slate-500">
                          <Clock size={12} className="shrink-0" />
                          <span className="text-[10px] font-bold whitespace-nowrap">{new Date(req.requestedAt).toLocaleDateString()}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center space-x-2">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            req.type === 'chat_mention' ? 'bg-indigo-100 text-indigo-600' :
                            req.type === 'reorder_alert' ? 'bg-rose-100 text-rose-600' :
                            'bg-slate-100 text-slate-400'
                          }`}>
                            {req.type === 'chat_mention' ? <AtSign size={14} /> :
                             req.type === 'reorder_alert' ? <ShoppingCart size={14} /> :
                             <Package size={14} />}
                          </div>
                          <span className="text-[11px] font-black text-slate-800 whitespace-nowrap">{req.productName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black whitespace-nowrap ${getTypeClass(req.type)}`}>
                          {getTypeLabel(req.type)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {req.type === 'chat_mention' ? (
                          <span className="text-xs font-bold text-slate-400">-</span>
                        ) : req.type === 'reorder_alert' ? (
                          <div className="flex items-center space-x-1 whitespace-nowrap">
                            <span className="text-[10px] font-bold text-slate-400">{req.originalQuantity}{req.unit || '개'}</span>
                            <ArrowRight size={10} className="text-slate-300" />
                            <span className="text-[11px] font-black text-rose-600">부족 {req.requestedQuantity}{req.unit || '개'}</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1 whitespace-nowrap">
                            <span className="text-[10px] font-bold text-slate-400 line-through">{req.originalQuantity}</span>
                            <ArrowRight size={10} className="text-slate-300" />
                            <span className="text-[11px] font-black text-indigo-600">
                              {req.type === 'cancel_receipt' ? 0 : req.requestedQuantity}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="hidden sm:table-cell px-3 py-3">
                        <div className="flex items-center space-x-2 max-w-[180px]">
                          <MessageSquare size={12} className="text-slate-300 flex-shrink-0" />
                          <span className="text-xs text-slate-600 truncate" title={req.reason}>{req.reason}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center space-x-1 whitespace-nowrap">
                          {req.status === 'pending' && (
                            <span className="flex items-center space-x-1 text-amber-500 font-black text-[10px] uppercase">
                              <Clock size={11} />
                              <span>대기중</span>
                            </span>
                          )}
                          {req.status === 'processed' && (
                            <span className="flex items-center space-x-1 text-emerald-500 font-black text-[10px] uppercase">
                              <CheckCircle2 size={11} />
                              <span>완료</span>
                            </span>
                          )}
                          {req.status === 'rejected' && (
                            <span className="flex items-center space-x-1 text-rose-500 font-black text-[10px] uppercase">
                              <XCircle size={11} />
                              <span>반려</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        {req.status === 'pending' && (
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => {
                                if (req.type === 'chat_mention' || req.type === 'reorder_alert') {
                                  onUpdateStatus(req.id, 'processed');
                                } else {
                                  onProcessAdjustment(req);
                                }
                              }}
                              className={`px-2 py-1.5 text-white rounded-lg text-[10px] font-black transition-all shadow-sm whitespace-nowrap ${req.type === 'reorder_alert' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                            >
                              {req.type === 'chat_mention' ? '확인' :
                               req.type === 'reorder_alert' ? '발주완료' :
                               '승인'}
                            </button>
                            <button
                              onClick={() => onUpdateStatus(req.id, 'rejected')}
                              className="px-2 py-1.5 bg-white border border-slate-200 text-slate-400 rounded-lg text-[10px] font-black hover:bg-slate-50 transition-all"
                            >
                              반려
                            </button>
                          </div>
                        )}
                        {req.status !== 'pending' && (
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-[10px] font-bold text-slate-300 whitespace-nowrap">
                              {req.processedAt ? new Date(req.processedAt).toLocaleDateString() : '-'}
                            </span>
                            <span className="sm:hidden text-slate-300">
                              {expandedId === req.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                    {expandedId === req.id && (
                      <tr className="sm:hidden bg-slate-50/80">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="flex items-start space-x-2">
                            <MessageSquare size={13} className="text-slate-400 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-[10px] font-black text-slate-400 uppercase mb-0.5">사유</p>
                              <p className="text-xs text-slate-700 font-medium">{req.reason || '-'}</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
