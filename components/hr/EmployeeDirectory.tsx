import React from 'react';
import { Calendar, Edit2, Search, Trash2 } from 'lucide-react';
import type { Employee } from '../../types';
import ActionButton from '../../src/shared/components/ActionButton';
interface EmployeeDirectoryProps {
 filteredEmployees: Employee[]; searchTerm: string; onSearchChange: (value: string) => void;
 calculateWorkDays: (joinDate: string) => number;
 getHealthCertStatus: (issued: string) => { expiry: string; daysLeft: number };
 onRetirement: (employee: Employee) => void; onEdit: (employee: Employee) => void; onDelete: (employee: Employee) => void;
}
export function EmployeeDirectory({ filteredEmployees, searchTerm, onSearchChange, calculateWorkDays, getHealthCertStatus, onRetirement, onEdit, onDelete }: EmployeeDirectoryProps) {
 return (
          <>
            <div className="p-6 border-b border-slate-50">
              <div className="relative max-w-md">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="text" 
                  placeholder="이름 또는 부서 검색..." 
                  value={searchTerm}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-3.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-left min-w-[640px]">
                <thead className="bg-slate-50/50 border-b border-slate-100 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">임직원 정보</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">부서 / 직급</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">입사일 / 근속</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">보건증</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right whitespace-nowrap">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredEmployees.map(emp => (
                    <tr key={emp.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-4 sm:px-5 py-4 sm:py-6 whitespace-nowrap">
                        <div className="flex items-center space-x-3">
                          <div className="w-9 h-9 sm:w-12 sm:h-12 bg-indigo-50 text-indigo-600 rounded-xl sm:rounded-2xl flex items-center justify-center font-black shrink-0">{emp.name[0]}</div>
                          <div><p className="font-black text-slate-800 text-sm">{emp.name}</p><p className="text-xs text-slate-400">{emp.phone}</p></div>
                        </div>
                      </td>
                      <td className="px-4 sm:px-5 py-4 sm:py-6 whitespace-nowrap">
                        <p className="text-sm font-bold text-slate-700">{emp.department}</p>
                        <p className="text-[10px] text-slate-400 font-black uppercase">{emp.position}</p>
                      </td>
                      <td className="px-4 sm:px-5 py-4 sm:py-6 whitespace-nowrap">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-slate-600 flex items-center"><Calendar size={12} className="mr-1.5" />{emp.joinDate}</p>
                          <span className="text-[10px] font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100">{calculateWorkDays(emp.joinDate)}일째</span>
                        </div>
                      </td>
                      <td className="px-4 sm:px-5 py-4 sm:py-6 text-center whitespace-nowrap">
                        {emp.healthCertDate ? (() => {
                          const { expiry, daysLeft } = getHealthCertStatus(emp.healthCertDate);
                          const isExpired = daysLeft <= 0;
                          const isWarning = daysLeft > 0 && daysLeft <= 30;
                          return (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[10px] font-bold text-slate-500">발급 {emp.healthCertDate}</span>
                              <span className="text-[10px] font-bold text-slate-400">만료 {expiry}</span>
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${
                                isExpired ? 'bg-rose-100 text-rose-600' :
                                isWarning ? 'bg-amber-100 text-amber-600' :
                                'bg-emerald-50 text-emerald-600'
                              }`}>
                                {isExpired ? '만료됨' : `D-${daysLeft}`}
                              </span>
                            </div>
                          );
                        })() : (
                          <span className="text-[10px] text-slate-300 font-bold">미등록</span>
                        )}
                      </td>
                      <td className="min-w-[192px] whitespace-nowrap px-4 sm:px-5 py-4 sm:py-6 text-right">
                        <div className="flex shrink-0 flex-nowrap justify-end gap-2 whitespace-nowrap opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all">
                          <ActionButton type="button" onClick={() => onRetirement(emp)} tone="normal">퇴직금</ActionButton>
                          <ActionButton onClick={() => onEdit(emp)} aria-label={`${emp.name} 정보 수정`} className="w-9 !px-0 hover:!text-indigo-600"><Edit2 size={14} /></ActionButton>
                          <ActionButton onClick={() => onDelete(emp)} aria-label={`${emp.name} 삭제`} className="w-9 !px-0 hover:!text-rose-600"><Trash2 size={14} /></ActionButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
 );
}
