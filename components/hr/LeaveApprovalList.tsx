import {useLeaveActions,type LeaveActionBindings} from '../../src/features/hr/hooks/useLeaveActions';
import React from 'react';
import { Check, X, CalendarCheck } from 'lucide-react';
import type { LeaveRequest } from '../../src/shared/types';

export function LeaveActionRecovery({actions,onCommitted}:{actions:ReturnType<typeof useLeaveActions>;onCommitted?:()=>void}) {
 return <div className="space-y-2 text-xs text-slate-600">
  {actions.message&&<p role={actions.pendingAction?'alert':'status'} className="whitespace-pre-line">{actions.message}</p>}
  {actions.pendingActions.map(entry=><button key={entry.planId??entry.id} type="button" disabled={actions.busy} className="block underline" onClick={()=>actions.openPending(entry)}>보관된 휴가 작업 확인 · {entry.description}</button>)}
  {actions.pendingAction&&<div className="flex flex-wrap gap-3"><button type="button" disabled={actions.busy} className="underline" onClick={async()=>{const result=await actions.inspect();if(result.committed)onCommitted?.();}}>휴가 작업 결과 확인</button><button type="button" disabled={actions.busy} className="underline" onClick={()=>actions.cancel()}>휴가 작업 요청 중단</button></div>}
  {actions.damagedReferences.map(id=><button key={id} type="button" disabled={actions.busy} className="block underline" onClick={()=>actions.cancelDamaged(id)}>손상된 휴가 작업 중단 · {id}</button>)}
 </div>;
}
export function LeaveApprovalList({pendingRequests,...bindings}:{pendingRequests:LeaveRequest[]}&LeaveActionBindings) {
 const actions=useLeaveActions({scopeKey:bindings.requestScopeKey??'',onAction:bindings.onLeaveAction,readPending:bindings.onReadPendingLeaveActions,inspect:bindings.onInspectLeaveAction,cancel:bindings.onCancelLeaveAction,readReferences:bindings.onReadLeaveReferences,cancelReference:bindings.onCancelLeaveReference});
 return <LeaveApprovalRows pendingRequests={pendingRequests} actions={actions}/>;
}
export function LeaveApprovalRows({pendingRequests,actions}:{pendingRequests:LeaveRequest[];actions:ReturnType<typeof useLeaveActions>}) {
 const rowDisabled=(req:LeaveRequest)=>actions.busy||actions.pendingActions.some(entry=>entry.id===req.id);
 return (
<div className="flex-1 overflow-auto custom-scrollbar"><LeaveActionRecovery actions={actions}/>
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
                  const isModify = ['approved','cancel_pending'].includes(req.status) && req.modifyRequest?.status === 'pending';
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
                          <button disabled={rowDisabled(req)} onClick={() => actions.run(req,{action:'cancel'})} className="flex items-center space-x-2 px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-black hover:bg-rose-700 transition-all"><Check size={14} /><span>취소 승인</span></button>}
                        {isModify && <>
                          <button disabled={rowDisabled(req)} onClick={() => actions.run(req,{action:'approve-modify'})} className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-violet-700 transition-all"><Check size={14} /><span>변경 승인</span></button>
                          <button disabled={rowDisabled(req)} onClick={() => actions.run(req,{action:'reject-modify'})} className="flex items-center space-x-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-black hover:bg-slate-200 transition-all"><X size={14} /><span>반려</span></button>
                        </>}
                        {req.status==='pending' && !isModify && <>
                          <button disabled={rowDisabled(req)} onClick={() => actions.run(req,{action:'approve'})} className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all"><Check size={14} /><span>승인</span></button>
                          <button disabled={rowDisabled(req)} onClick={() => actions.run(req,{action:'reject'})} className="flex items-center space-x-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-xs font-black hover:bg-rose-100 transition-all"><X size={14} /><span>반려</span></button>
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
