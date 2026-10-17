import React from 'react';
import { Check, X, CalendarCheck } from 'lucide-react';
import type { LeaveRequest, LeaveStatus } from '../../src/shared/types';

export function LeaveApprovalList({pendingRequests,onUpdateLeaveStatus,onUpdateLeave}:{
 pendingRequests:LeaveRequest[];
 onUpdateLeaveStatus:(_id:string,_status:LeaveStatus,_reason?:string)=>void;
 onUpdateLeave:(_id:string,_updates:Partial<LeaveRequest>)=>void;
}) {
 return (
<div className="flex-1 overflow-auto custom-scrollbar">
            <table className="w-full text-left min-w-[580px]">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">신청 직원</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">항목 / 사유</th>
                  <th className="px-4 sm:px-10 py-4 sm:py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">신청 기간 / 일수</th>
                  <th className="px-4 sm:px-10 py-4 sm:py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right whitespace-nowrap">결재 처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pendingRequests.map(req => {
                  const isCancel = req.status === 'cancel_pending';
                  const isModify = req.modifyRequest?.status === 'pending';
                  return (
                  <tr key={req.id} className={`transition-colors ${isCancel ? 'hover:bg-rose-50/20' : isModify ? 'hover:bg-violet-50/20' : 'hover:bg-amber-50/20'}`}>
                    <td className="px-4 sm:px-5 py-4 sm:py-6 whitespace-nowrap">
                      <p className="font-black text-slate-800 text-sm">{req.employeeName}</p>
                      {isCancel && <span className="text-[10px] font-black px-1.5 py-0.5 bg-rose-100 text-rose-600 rounded mt-0.5 inline-block">취소 신청</span>}
                      {isModify && <span className="text-[10px] font-black px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded mt-0.5 inline-block">변경 신청</span>}
                    </td>
                    <td className="px-4 sm:px-5 py-4 sm:py-6 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase mb-1 inline-block ${req.type === '연차' ? 'bg-indigo-600 text-white' : req.type === '휴가' ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'}`}>{req.type}</span>
                      {isModify ? (
                        <div className="mt-1 space-y-0.5">
                          <p className="text-[10px] text-slate-400 font-bold">변경 전: {req.startDate} ~ {req.endDate}</p>
                          <p className="text-[10px] text-violet-600 font-bold">변경 후: {req.modifyRequest!.startDate} ~ {req.modifyRequest!.endDate}</p>
                          <p className="text-xs text-slate-500 italic">&quot;{req.modifyRequest!.reason}&quot;</p>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 font-medium italic">&quot;{req.reason}&quot;</p>
                      )}
                    </td>
                    <td className="px-4 sm:px-10 py-4 sm:py-6 whitespace-nowrap">
                      <p className="text-xs font-bold text-slate-700">{req.startDate} ~ {req.endDate}</p>
                      <p className="text-[10px] font-black text-indigo-600 bg-indigo-50 w-fit px-1.5 py-0.5 rounded-lg mt-1">
                        {isModify ? `${req.modifyRequest!.daysUsed}일 (변경)` : `${req.daysUsed}일 사용`}
                      </p>
                    </td>
                    <td className="px-4 sm:px-10 py-4 sm:py-6 text-right">
                      <div className="flex justify-end space-x-3">
                        {/*  취소 요청은 **받아 주기만** 한다(2026-09-04 사장님:
                             "직원이 취소한걸 반려하는 경우는 없어").
                             있던 반려 단추가 뜻이 뒤집혀 쓰이던 자리다 — 취소를 거절했는데
                             오히려 취소가 확정돼 연차가 사라졌다. */}
                        {isCancel &&
                          <button onClick={() => onUpdateLeaveStatus(req.id, 'cancelled')} className="flex items-center space-x-2 px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-black hover:bg-rose-700 transition-all"><Check size={14} /><span>취소 승인</span></button>}
                        {isModify && <>
                          <button onClick={() => onUpdateLeave(req.id, {
                            startDate: req.modifyRequest!.startDate,
                            endDate: req.modifyRequest!.endDate,
                            reason: req.modifyRequest!.reason,
                            daysUsed: req.modifyRequest!.daysUsed,
                            modifyRequest: { ...req.modifyRequest!, status: 'approved' },
                          })} className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-violet-700 transition-all"><Check size={14} /><span>변경 승인</span></button>
                          <button onClick={() => onUpdateLeave(req.id, { modifyRequest: { ...req.modifyRequest!, status: 'rejected' } })} className="flex items-center space-x-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-black hover:bg-slate-200 transition-all"><X size={14} /><span>반려</span></button>
                        </>}
                        {!isCancel && !isModify && <>
                          <button onClick={() => onUpdateLeaveStatus(req.id, 'approved')} className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all"><Check size={14} /><span>승인</span></button>
                          <button onClick={() => onUpdateLeaveStatus(req.id, 'rejected')} className="flex items-center space-x-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-xs font-black hover:bg-rose-100 transition-all"><X size={14} /><span>반려</span></button>
                        </>}
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {pendingRequests.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-20 text-center flex flex-col items-center">
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-200 mb-4"><CalendarCheck size={32} /></div>
                      <p className="text-slate-400 font-bold">새로 들어온 승인 대기 내역이 없습니다.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
 );
}
