
import React, { useMemo, useState } from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Package,
  ArrowRight,
  CalendarDays,
  User,
  ShoppingCart,
  AtSign,
  ChevronDown,
  ChevronUp,
  ClipboardList,
} from 'lucide-react';
import { LeaveRequest, AdjustmentRequest, Employee } from '../types';
import PageHeader from './PageHeader';

interface AdminChecklistProps {
  leaveRequests: LeaveRequest[];
  adjustmentRequests: AdjustmentRequest[];
  employees: Employee[];
  onUpdateLeaveStatus: (_id: string, _status: 'approved' | 'rejected') => void;
  onUpdateAdjustmentStatus: (_id: string, _status: 'processed' | 'rejected') => void;
  onProcessAdjustment: (_req: AdjustmentRequest) => void;
}

type TabType = 'leave' | 'adjustment';

const LEAVE_TYPE_LABEL: Record<string, string> = {
  '연차': '연차',
  '오전반차': '오전반차',
  '오후반차': '오후반차',
  '병가': '병가',
  '경조사': '경조사',
  '기타': '기타',
};

const AdminChecklist: React.FC<AdminChecklistProps> = ({
  leaveRequests,
  adjustmentRequests,
  employees,
  onUpdateLeaveStatus,
  onUpdateAdjustmentStatus,
  onProcessAdjustment,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('leave');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const pendingLeaves = useMemo(() =>
    leaveRequests.filter(r => r.status === 'pending' || r.status === 'cancel_pending' || r.modifyRequest?.status === 'pending')
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()),
    [leaveRequests]
  );

  const pendingAdjustments = useMemo(() =>
    adjustmentRequests.filter(r => r.status === 'pending')
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()),
    [adjustmentRequests]
  );

  const totalPending = pendingLeaves.length + pendingAdjustments.length;

  const getAdjTypeLabel = (type: string) => {
    if (type === 'quantity_change') return '수량 변동';
    if (type === 'cancel_receipt') return '입고 취소';
    if (type === 'reorder_alert') return '발주 필요';
    return '채팅 언급';
  };

  const getAdjTypeClass = (type: string) => {
    if (type === 'quantity_change') return 'bg-blue-50 text-blue-600';
    if (type === 'cancel_receipt') return 'bg-rose-50 text-rose-600';
    if (type === 'reorder_alert') return 'bg-rose-50 text-rose-600';
    return 'bg-indigo-50 text-indigo-600';
  };

  const getLeaveStatusBadge = (req: LeaveRequest) => {
    if (req.status === 'cancel_pending') {
      return <span className="flex items-center gap-1 text-orange-500 font-black text-[10px]"><Clock size={11} />취소 요청</span>;
    }
    if (req.modifyRequest?.status === 'pending') {
      return <span className="flex items-center gap-1 text-purple-500 font-black text-[10px]"><Clock size={11} />수정 요청</span>;
    }
    return <span className="flex items-center gap-1 text-amber-500 font-black text-[10px]"><Clock size={11} />승인 대기</span>;
  };

  const getEmployeeName = (empId: string) => {
    return employees.find(e => e.id === empId)?.name ?? empId;
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
      <PageHeader
        title="관리자 확인사항"
        subtitle="연차 신청, 재고 변동 등 처리가 필요한 항목을 확인하세요."
        right={totalPending > 0 ? (
          <div className="bg-amber-50 border border-amber-100 px-4 py-2 rounded-xl flex items-center space-x-2">
            <AlertCircle size={18} className="text-amber-500" />
            <span className="text-sm font-bold text-amber-700">대기 중 {totalPending}건</span>
          </div>
        ) : undefined}
      />

      {/* 탭 */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('leave')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            activeTab === 'leave'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <CalendarDays size={15} />
          연차 신청
          {pendingLeaves.length > 0 && (
            <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center ${activeTab === 'leave' ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-700'}`}>
              {pendingLeaves.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('adjustment')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            activeTab === 'adjustment'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Package size={15} />
          재고 확인사항
          {pendingAdjustments.length > 0 && (
            <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center ${activeTab === 'adjustment' ? 'bg-white/30 text-white' : 'bg-amber-100 text-amber-700'}`}>
              {pendingAdjustments.length}
            </span>
          )}
        </button>
      </div>

      {/* 연차 신청 탭 */}
      {activeTab === 'leave' && (
        <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">신청일</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">직원</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">유형</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">기간</th>
                  <th className="hidden sm:table-cell px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">사유</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">상태</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pendingLeaves.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-400">
                        <CalendarDays size={32} className="text-slate-200" />
                        <span className="text-sm font-medium">대기 중인 연차 신청이 없습니다</span>
                      </div>
                    </td>
                  </tr>
                ) : pendingLeaves.map(req => (
                  <React.Fragment key={req.id}>
                    <tr
                      className="hover:bg-slate-50/50 transition-colors cursor-pointer sm:cursor-default"
                      onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center space-x-1 text-slate-500">
                          <Clock size={12} className="shrink-0" />
                          <span className="text-[10px] font-bold whitespace-nowrap">
                            {new Date(req.requestedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                            <User size={13} className="text-indigo-600" />
                          </div>
                          <span className="text-[11px] font-black text-slate-800 whitespace-nowrap">{req.employeeName || getEmployeeName(req.employeeId)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="px-2 py-1 rounded-lg text-[10px] font-black bg-indigo-50 text-indigo-600 whitespace-nowrap">
                          {LEAVE_TYPE_LABEL[req.type] ?? req.type}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <span className="text-[10px] font-bold text-slate-700">{req.startDate}</span>
                          {req.startDate !== req.endDate && (
                            <>
                              <ArrowRight size={9} className="text-slate-300" />
                              <span className="text-[10px] font-bold text-slate-700">{req.endDate}</span>
                            </>
                          )}
                          <span className="text-[10px] text-slate-400 ml-1">({req.daysUsed}일)</span>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-3 py-3">
                        <span className="text-xs text-slate-600 line-clamp-1">{req.reason || '-'}</span>
                      </td>
                      <td className="px-3 py-3">
                        {getLeaveStatusBadge(req)}
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          {req.status === 'cancel_pending' ? (
                            <>
                              <button
                                onClick={() => onUpdateLeaveStatus(req.id, 'approved')}
                                className="px-2 py-1.5 bg-orange-500 text-white rounded-lg text-[10px] font-black hover:bg-orange-600 transition-all shadow-sm whitespace-nowrap"
                              >
                                취소승인
                              </button>
                              <button
                                onClick={() => onUpdateLeaveStatus(req.id, 'rejected')}
                                className="px-2 py-1.5 bg-white border border-slate-200 text-slate-400 rounded-lg text-[10px] font-black hover:bg-slate-50 transition-all"
                              >
                                반려
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => onUpdateLeaveStatus(req.id, 'approved')}
                                className="px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-black hover:bg-indigo-700 transition-all shadow-sm whitespace-nowrap"
                              >
                                승인
                              </button>
                              <button
                                onClick={() => onUpdateLeaveStatus(req.id, 'rejected')}
                                className="px-2 py-1.5 bg-white border border-slate-200 text-slate-400 rounded-lg text-[10px] font-black hover:bg-slate-50 transition-all"
                              >
                                반려
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === req.id && (
                      <tr className="sm:hidden bg-slate-50/80">
                        <td colSpan={7} className="px-4 py-3">
                          <p className="text-[10px] font-black text-slate-400 uppercase mb-0.5">사유</p>
                          <p className="text-xs text-slate-700 font-medium">{req.reason || '-'}</p>
                          {req.modifyRequest && (
                            <div className="mt-2">
                              <p className="text-[10px] font-black text-purple-400 uppercase mb-0.5">수정 요청 내용</p>
                              <p className="text-xs text-slate-700">{req.modifyRequest.startDate} ~ {req.modifyRequest.endDate} ({req.modifyRequest.daysUsed}일)</p>
                              <p className="text-xs text-slate-500">{req.modifyRequest.reason}</p>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 재고 확인사항 탭 */}
      {activeTab === 'adjustment' && (
        <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">요청 일시</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">품목명</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">유형</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">변동 내용</th>
                  <th className="hidden sm:table-cell px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">사유</th>
                  <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pendingAdjustments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-400">
                        <Package size={32} className="text-slate-200" />
                        <span className="text-sm font-medium">대기 중인 재고 확인사항이 없습니다</span>
                      </div>
                    </td>
                  </tr>
                ) : pendingAdjustments.map(req => (
                  <React.Fragment key={req.id}>
                    <tr
                      className="hover:bg-slate-50/50 transition-colors cursor-pointer sm:cursor-default"
                      onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center space-x-1 text-slate-500">
                          <Clock size={12} className="shrink-0" />
                          <span className="text-[10px] font-bold whitespace-nowrap">
                            {new Date(req.requestedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                          </span>
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
                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black whitespace-nowrap ${getAdjTypeClass(req.type)}`}>
                          {getAdjTypeLabel(req.type)}
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
                        <span className="text-xs text-slate-600 line-clamp-1">{req.reason || '-'}</span>
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => {
                              if (req.type === 'chat_mention' || req.type === 'reorder_alert') {
                                onUpdateAdjustmentStatus(req.id, 'processed');
                              } else {
                                onProcessAdjustment(req);
                              }
                            }}
                            className={`px-2 py-1.5 text-white rounded-lg text-[10px] font-black transition-all shadow-sm whitespace-nowrap ${req.type === 'reorder_alert' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                          >
                            {req.type === 'chat_mention' ? '확인' :
                             req.type === 'reorder_alert' ? '발주완료' : '승인'}
                          </button>
                          <button
                            onClick={() => onUpdateAdjustmentStatus(req.id, 'rejected')}
                            className="px-2 py-1.5 bg-white border border-slate-200 text-slate-400 rounded-lg text-[10px] font-black hover:bg-slate-50 transition-all"
                          >
                            반려
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === req.id && (
                      <tr className="sm:hidden bg-slate-50/80">
                        <td colSpan={6} className="px-4 py-3">
                          <p className="text-[10px] font-black text-slate-400 uppercase mb-0.5">사유</p>
                          <p className="text-xs text-slate-700 font-medium">{req.reason || '-'}</p>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {totalPending === 0 && (
        <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm p-12 flex flex-col items-center gap-3 text-slate-400">
          <ClipboardList size={40} className="text-slate-200" />
          <p className="text-sm font-bold">처리할 항목이 없습니다</p>
          <p className="text-xs text-slate-300">신규 연차 신청이나 재고 변동이 발생하면 여기에 표시됩니다.</p>
        </div>
      )}
    </div>
  );
};

export default AdminChecklist;
