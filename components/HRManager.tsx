
import React, { useState } from 'react';
import ConfirmModal from './ConfirmModal';
import { 
  Users, 
  Search, 
  Plus, 
  Calendar, 
  Trash2, 
  Edit2, 
  X, 
  Check, 
  ClipboardCheck, 
  CalendarCheck, 
  Settings2, 
  AlertCircle, 
  Gift, 
  Lock, 
  Unlock,
  TrendingUp
} from 'lucide-react';
import { Employee, EmployeeStatus, LeaveRequest, LeaveStatus } from '../types';
import PageHeader from './PageHeader';

interface HRManagerProps {
  employees: Employee[];
  leaveRequests: LeaveRequest[];
  onUpdateEmployee: (_emp: Employee) => void;
  onAddEmployee: (_emp: Employee) => void;
  onDeleteEmployee: (_id: string) => void;
  onUpdateLeaveStatus: (_id: string, _status: LeaveStatus) => void;
  onDeleteLeaveRequest: (_id: string) => void;
}

const HRManager: React.FC<HRManagerProps> = ({ 
  employees, 
  leaveRequests, 
  onUpdateEmployee, 
  onAddEmployee, 
  onDeleteEmployee,
  onUpdateLeaveStatus
}) => {
  const [activeTab, setActiveTab] = useState<'employees' | 'leave-approval' | 'leave-balance'>('employees');
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; onConfirm: () => void } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    position: '사원',
    department: '생산팀',
    joinDate: new Date().toISOString().split('T')[0],
    birthDate: '',
    phone: '010-0000-0000',
    status: 'working' as EmployeeStatus,
    annualLeave: { carryOverLeave: 0, bonusLeave: 0 },
    manualAdjustment: 0
  });

  const today = new Date();
  const CURRENT_YEAR = today.getFullYear();

  // 1년 미만 여부 판단
  const isUnderOneYear = (joinDate: string) => {
    const start = new Date(joinDate);
    const oneYearLater = new Date(start);
    oneYearLater.setFullYear(start.getFullYear() + 1);
    return today < oneYearLater;
  };

  // 월차: 입사일+N개월 기준일이 올해에 해당하고 오늘 이전인 것만 카운트
  const calculateMonthlyLeaveThisYear = (joinDate: string) => {
    const start = new Date(joinDate);
    let count = 0;
    for (let m = 1; m <= 12; m++) {
      const grantDate = new Date(start.getFullYear(), start.getMonth() + m, start.getDate());
      if (grantDate > today) break;
      if (grantDate.getFullYear() === CURRENT_YEAR) count++;
    }
    return count;
  };

  // 연차: 1년 미만이면 0, 이상이면 15일 + 가산
  const calculateAnnualLeave = (joinDate: string) => {
    if (isUnderOneYear(joinDate)) return 0;
    const start = new Date(joinDate);
    const diffYears = today.getFullYear() - start.getFullYear();
    const seniorYears = Math.floor((diffYears - 1) / 2);
    return Math.min(25, 15 + seniorYears);
  };

  const getApprovedLeaveCount = (empId: string) => {
    return leaveRequests
      .filter(r => r.employeeId === empId && r.status === 'approved')
      .reduce((sum, r) => sum + r.daysUsed, 0);
  };

  const calculateWorkDays = (joinDate: string) => {
    const start = new Date(joinDate);
    const today = new Date();
    const diffTime = Math.abs(today.getTime() - start.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const filteredEmployees = employees.filter(emp => 
    emp.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    emp.department.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const pendingRequests = leaveRequests.filter(r => r.status === 'pending');

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const empData: Employee = {
      id: editingEmployee ? editingEmployee.id : `emp-${Date.now()}`,
      ...formData
    };
    if (editingEmployee) onUpdateEmployee(empData);
    else onAddEmployee(empData);
    setIsModalOpen(false);
  };

  const handleBalanceUpdate = (emp: Employee, field: 'carryOverLeave' | 'bonusLeave' | 'manualAdjustment', value: string) => {
    const numValue = parseFloat(value) || 0;
    if (field === 'manualAdjustment') {
      onUpdateEmployee({ ...emp, manualAdjustment: numValue });
    } else {
      onUpdateEmployee({ ...emp, annualLeave: { ...emp.annualLeave, carryOverLeave: emp.annualLeave?.carryOverLeave || 0, bonusLeave: emp.annualLeave?.bonusLeave || 0, [field]: numValue } });
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full flex flex-col">
      <PageHeader
        title="인사 관리"
        subtitle="임직원 정보 관리부터 연차 승인, 잔여 일수 조정까지 통합 관리합니다."
        right={<div className="flex items-center gap-2">
          <div className="flex bg-slate-100 p-1 rounded-2xl items-center">
            <button
              onClick={() => setActiveTab('employees')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${activeTab === 'employees' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Users size={14} /><span>임직원</span>
            </button>
            <button
              onClick={() => setActiveTab('leave-approval')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 relative ${activeTab === 'leave-approval' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <ClipboardCheck size={14} /><span>승인 대기</span>
              {pendingRequests.length > 0 && <span className="absolute -top-1 -right-1 bg-amber-500 text-white w-4 h-4 flex items-center justify-center rounded-full text-[9px]">{pendingRequests.length}</span>}
            </button>
            <button
              onClick={() => setActiveTab('leave-balance')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${activeTab === 'leave-balance' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Settings2 size={14} /><span>연차 관리</span>
            </button>
          </div>
          {activeTab === 'employees' && (
            <button
              onClick={() => {
                setEditingEmployee(null);
                setFormData({
                  name: '', position: '사원', department: '생산팀',
                  joinDate: new Date().toISOString().split('T')[0],
                  birthDate: '',
                  phone: '010-0000-0000', status: 'working',
                  annualLeave: { carryOverLeave: 0, bonusLeave: 0 }, manualAdjustment: 0
                });
                setIsModalOpen(true);
              }}
              className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-black hover:bg-indigo-700 transition-all shadow-sm"
            >
              <Plus size={15} /><span>직원 등록</span>
            </button>
          )}
          {activeTab === 'leave-balance' && (
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-black shadow-sm transition-all ${
                isEditMode ? 'bg-rose-500 text-white hover:bg-rose-600' : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              {isEditMode ? <Lock size={14} /> : <Unlock size={14} />}
              <span>{isEditMode ? '편집 종료' : '연차 편집'}</span>
            </button>
          )}
        </div>}
      />

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-white rounded-3xl border border-slate-100 shadow-sm">
        {activeTab === 'employees' && (
          <>
            <div className="p-6 border-b border-slate-50">
              <div className="relative max-w-md">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="text" 
                  placeholder="이름 또는 부서 검색..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-3.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <table className="w-full text-left">
                <thead className="bg-slate-50/50 border-b border-slate-100 sticky top-0 z-10">
                  <tr>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">임직원 정보</th>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">부서 / 직급</th>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">입사일 / 근속</th>
                    <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredEmployees.map(emp => (
                    <tr key={emp.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-8 py-6">
                        <div className="flex items-center space-x-4">
                          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center font-black">{emp.name[0]}</div>
                          <div><p className="font-black text-slate-800">{emp.name}</p><p className="text-xs text-slate-400">{emp.phone}</p></div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-sm font-bold text-slate-700">{emp.department}</p>
                        <p className="text-[10px] text-slate-400 font-black uppercase">{emp.position}</p>
                      </td>
                      <td className="px-8 py-6">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-slate-600 flex items-center"><Calendar size={12} className="mr-1.5" />{emp.joinDate}</p>
                          <span className="text-[10px] font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100">{calculateWorkDays(emp.joinDate)}일째</span>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex justify-end space-x-2 opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={() => { setEditingEmployee(emp); setFormData({ name: emp.name, position: emp.position, department: emp.department, joinDate: emp.joinDate, birthDate: emp.birthDate || '', phone: emp.phone, status: emp.status, annualLeave: { carryOverLeave: emp.annualLeave?.carryOverLeave || 0, bonusLeave: emp.annualLeave?.bonusLeave || 0 }, manualAdjustment: emp.manualAdjustment || 0 }); setIsModalOpen(true); }} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"><Edit2 size={18} /></button>
                          <button onClick={() => setConfirmModal({
                              message: `'${emp.name}' 직원 정보를 삭제하시겠습니까?`,
                              subMessage: '휴가 기록 등 관련 데이터도 함께 삭제됩니다.',
                              onConfirm: () => { onDeleteEmployee(emp.id); setConfirmModal(null); },
                            })} className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><Trash2 size={18} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'leave-approval' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">신청 직원</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">항목 / 사유</th>
                  <th className="px-10 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">신청 기간 / 일수</th>
                  <th className="px-10 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">결재 처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pendingRequests.map(req => (
                  <tr key={req.id} className="hover:bg-amber-50/20 transition-colors">
                    <td className="px-8 py-6">
                      <p className="font-black text-slate-800">{req.employeeName}</p>
                      <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter">REQ-ID: {req.id}</p>
                    </td>
                    <td className="px-8 py-6">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase mb-1 inline-block ${req.type === '연차' ? 'bg-indigo-500 text-white' : 'bg-emerald-500 text-white'}`}>{req.type}</span>
                      <p className="text-xs text-slate-500 font-medium italic">&quot;{req.reason}&quot;</p>
                    </td>
                    <td className="px-10 py-6">
                      <p className="text-xs font-bold text-slate-700">{req.startDate} ~ {req.endDate}</p>
                      <p className="text-[10px] font-black text-indigo-600 bg-indigo-50 w-fit px-1.5 py-0.5 rounded-md mt-1">{req.daysUsed}일 사용</p>
                    </td>
                    <td className="px-10 py-6 text-right">
                      <div className="flex justify-end space-x-3">
                        <button onClick={() => onUpdateLeaveStatus(req.id, 'approved')} className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all"><Check size={14} /><span>승인</span></button>
                        <button onClick={() => onUpdateLeaveStatus(req.id, 'rejected')} className="flex items-center space-x-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-xs font-black hover:bg-rose-100 transition-all"><X size={14} /><span>반려</span></button>
                      </div>
                    </td>
                  </tr>
                ))}
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
        )}

        {activeTab === 'leave-balance' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="p-8 bg-indigo-50 border-b border-indigo-100 flex items-center space-x-4">
              <AlertCircle className="text-indigo-500" size={24} />
              <div className="text-xs font-bold text-indigo-700 leading-relaxed">
                <p>연차 정보는 인사팀에 의해 안전하게 관리됩니다. 우측 상단의 <b>&apos;편집 모드&apos;</b>를 활성화해야 수정이 가능합니다.</p>
                <p>1년 미만 직원은 올해 발생한 월차만 표시됩니다. 총 부여 = [월차/연차 + 보너스 + 이월], 실 잔여 = [총 부여 - (사용 + 수동 차감)]</p>
              </div>
            </div>
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                <tr>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">임직원</th>
                  <th className="px-4 py-5 text-[10px] font-black text-emerald-400 uppercase tracking-widest text-center">월차</th>
                  <th className="px-4 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
                    <span className="block">연차</span>
                    <span className="text-[9px] font-bold text-slate-300 normal-case tracking-normal">입사일 기준</span>
                  </th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center bg-indigo-50/30">보너스 (+)</th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">이월 (+)</th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center text-rose-500">사용 개수</th>
                  <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">수동 차감 (-)</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">최종 잔여</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {employees.map(emp => {
                  const underOneYear = isUnderOneYear(emp.joinDate);
                  const monthlyLeave = underOneYear ? calculateMonthlyLeaveThisYear(emp.joinDate) : 0;
                  const annualLeave = calculateAnnualLeave(emp.joinDate);
                  const totalGenerated = monthlyLeave + annualLeave;
                  const approvedUsed = getApprovedLeaveCount(emp.id);
                  const finalTotalUsable = totalGenerated + (emp.annualLeave?.carryOverLeave || 0) + (emp.annualLeave?.bonusLeave || 0);
                  const totalUsedCount = approvedUsed + (emp.manualAdjustment || 0);
                  const remaining = finalTotalUsable - totalUsedCount;

                  return (
                    <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-8 py-6">
                        <p className="font-black text-slate-800">{emp.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase">{emp.position}</p>
                      </td>
                      {/* 월차 */}
                      <td className="px-4 py-6 text-center">
                        {underOneYear ? (
                          <div className="flex flex-col items-center">
                            <span className="text-sm font-bold text-emerald-600">{monthlyLeave}</span>
                            <span className="text-[9px] font-bold text-emerald-300 uppercase">올해</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-200">-</span>
                        )}
                      </td>
                      {/* 연차 */}
                      <td className="px-4 py-6 text-center">
                        <div className="flex flex-col items-center">
                          <span className="text-sm font-bold text-slate-500">{annualLeave}</span>
                          {underOneYear && <span className="text-[9px] font-bold text-slate-300 uppercase">입사일 기준</span>}
                        </div>
                      </td>
                      <td className="px-6 py-6 text-center bg-indigo-50/20">
                        {isEditMode ? (
                          <div className="flex justify-center items-center">
                            <input 
                              type="number" step="0.5"
                              value={emp.annualLeave?.bonusLeave || 0}
                              onChange={(e) => handleBalanceUpdate(emp, 'bonusLeave', e.target.value)}
                              className="w-16 text-center bg-white border border-indigo-200 rounded-lg py-1.5 text-sm font-black text-indigo-600 shadow-sm outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center justify-center space-x-1 text-indigo-600">
                             <Gift size={12} />
                             <span className="text-sm font-black">{emp.annualLeave?.bonusLeave || 0}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-6 text-center">
                        {isEditMode ? (
                          <input 
                            type="number" step="0.5"
                            value={emp.annualLeave?.carryOverLeave || 0}
                            onChange={(e) => handleBalanceUpdate(emp, 'carryOverLeave', e.target.value)}
                            className="w-16 text-center bg-white border border-slate-200 rounded-lg py-1.5 text-sm font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        ) : (
                          <span className="text-sm font-black text-slate-400">{emp.annualLeave?.carryOverLeave || 0}</span>
                        )}
                      </td>
                      <td className="px-6 py-6 text-center">
                        <div className="flex flex-col items-center">
                          <span className="text-sm font-black text-rose-500">{approvedUsed}</span>
                          <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">승인됨</span>
                        </div>
                      </td>
                      <td className="px-6 py-6 text-center">
                        {isEditMode ? (
                          <input 
                            type="number" step="0.5"
                            value={emp.manualAdjustment || 0}
                            onChange={(e) => handleBalanceUpdate(emp, 'manualAdjustment', e.target.value)}
                            className="w-16 text-center bg-rose-50 border border-rose-200 rounded-lg py-1.5 text-sm font-black text-rose-700 outline-none focus:ring-2 focus:ring-rose-500"
                          />
                        ) : (
                          <span className="text-sm font-black text-slate-300">{emp.manualAdjustment || 0}</span>
                        )}
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex flex-col items-end">
                          <span className={`text-xl font-black ${remaining < 0 ? 'text-rose-600' : 'text-indigo-600'}`}>
                            {remaining}
                            <span className="text-xs ml-0.5">일</span>
                          </span>
                          <div className="flex items-center text-[9px] font-black text-slate-300 uppercase tracking-tighter">
                             <TrendingUp size={10} className="mr-0.5" />
                             REMAINING
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Employee Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsModalOpen(false)} />
          <div className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-900">{editingEmployee ? '정보 수정' : '신규 직원 등록'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full"><X size={20} /></button>
            </div>
            <form onSubmit={handleFormSubmit} className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">이름</label>
                <input required type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">부서</label>
                  <input type="text" value={formData.department} onChange={(e) => setFormData({...formData, department: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">직급</label>
                  <input type="text" value={formData.position} onChange={(e) => setFormData({...formData, position: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">입사일</label>
                  <input required type="date" value={formData.joinDate} onChange={(e) => setFormData({...formData, joinDate: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">생년월일</label>
                  <input type="date" value={formData.birthDate} onChange={(e) => setFormData({...formData, birthDate: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">전화번호</label>
                  <input type="text" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none" placeholder="010-0000-0000" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">재직 상태</label>
                  <select value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value as EmployeeStatus})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none">
                    <option value="working">재직</option><option value="leave">휴직</option><option value="out">퇴사</option>
                  </select>
                </div>
              </div>

              {/* 연차 섹션 */}
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center space-x-1">
                  <Calendar size={12} />
                  <span>연차</span>
                </p>
                <div className="bg-slate-50 rounded-2xl p-4 space-y-3 border border-slate-100">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">이월 연차</label>
                      <p className="text-[10px] text-slate-300">전년도에서 이월된 잔여 연차</p>
                      <input type="number" step="0.5" value={formData.annualLeave.carryOverLeave} onChange={(e) => setFormData({...formData, annualLeave: {...formData.annualLeave, carryOverLeave: parseFloat(e.target.value) || 0}})} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">보너스 연차</label>
                      <p className="text-[10px] text-slate-300">포상·특별 부여 연차</p>
                      <input type="number" step="0.5" value={formData.annualLeave.bonusLeave} onChange={(e) => setFormData({...formData, annualLeave: {...formData.annualLeave, bonusLeave: parseFloat(e.target.value) || 0}})} className="w-full bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-sm font-bold outline-none text-emerald-700 focus:border-emerald-400" />
                    </div>
                  </div>
                  <div className="space-y-1.5 pt-2 border-t border-slate-200">
                    <label className="text-[10px] font-bold text-rose-400 uppercase tracking-widest">수동 차감</label>
                    <p className="text-[10px] text-slate-300">승인 절차 없이 직접 차감 — 시스템 도입 전 사용분, 수동 보정 등</p>
                    <input type="number" step="0.5" value={formData.manualAdjustment} onChange={(e) => setFormData({...formData, manualAdjustment: parseFloat(e.target.value) || 0})} className="w-full bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 text-sm font-bold outline-none text-rose-700 focus:border-rose-400" />
                  </div>
                </div>
              </div>
              <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex space-x-3 mt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-4 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200">취소</button>
                <button type="submit" className="flex-1 py-4 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-100 flex items-center justify-center space-x-2"><Check size={20} /><span>저장 완료</span></button>
              </div>
            </form>
          </div>
        </div>
      )}
      {confirmModal && (
        <ConfirmModal
          message={confirmModal.message}
          subMessage={confirmModal.subMessage}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
};

export default HRManager;
