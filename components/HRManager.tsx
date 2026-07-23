
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
  TrendingUp,
  ChevronRight
} from 'lucide-react';
import { Employee, EmployeeStatus, LeaveRequest, LeaveStatus, LeaveType } from '../types';
import PageHeader from './PageHeader';

const NON_DEDUCTIBLE_TYPES: LeaveType[] = ['경조사', '기타'];

interface HRManagerProps {
  employees: Employee[];
  leaveRequests: LeaveRequest[];
  onUpdateEmployee: (_emp: Employee) => void;
  onAddEmployee: (_emp: Employee) => void;
  onDeleteEmployee: (_id: string) => void;
  onUpdateLeaveStatus: (_id: string, _status: LeaveStatus) => void;
  onUpdateLeave: (_id: string, _updates: Partial<LeaveRequest>) => void;
  onDeleteLeaveRequest: (_id: string) => void;
  /** 회사 단체 휴가 일괄 등록 — 선택 직원별로 승인된 '휴가' 신청을 만든다(연차 차감) */
  onAddLeaveRequests?: (_reqs: LeaveRequest[]) => Promise<void> | void;
}

const HRManager: React.FC<HRManagerProps> = ({
  employees,
  leaveRequests,
  onUpdateEmployee,
  onAddEmployee,
  onDeleteEmployee,
  onUpdateLeaveStatus,
  onUpdateLeave,
  onAddLeaveRequests,
}) => {
  const [activeTab, setActiveTab] = useState<'employees' | 'leave-approval' | 'leave-balance'>('employees');
  const [confirmModal, setConfirmModal] = useState<{ message: string; subMessage?: string; onConfirm: () => void } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  // 연차 상세 오버레이 — 직원 클릭 시 올해 신청·사용 내역 (월별 그룹, 클릭 시 펼침)
  const [leaveDetailEmp, setLeaveDetailEmp] = useState<Employee | null>(null);
  const [openLeaveMonths, setOpenLeaveMonths] = useState<Set<string>>(new Set());
  // 회사 단체 휴가 — 기본 전원 포함, 뺄 사람만 체크 해제
  const [showVacation, setShowVacation] = useState(false);
  const [vacationExcluded, setVacationExcluded] = useState<Set<string>>(new Set());
  const [vacationRange, setVacationRange] = useState({ start: '', end: '' });
  const [vacationReason, setVacationReason] = useState('');
  const [vacationBusy, setVacationBusy] = useState(false);

  /** 평일 기준 일수 (주말 제외, 최소 1일) — LeaveManager의 계산과 동일 */
  const countWeekdays = (start: string, end: string) => {
    if (!start || !end) return 0;
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    if (e < s) return 0;
    let n = 0;
    const cur = new Date(s);
    while (cur <= e) {
      const d = cur.getDay();
      if (d !== 0 && d !== 6) n++;
      cur.setDate(cur.getDate() + 1);
    }
    return Math.max(1, n);
  };

  const [formData, setFormData] = useState({
    name: '',
    position: '사원',
    department: '생산팀',
    joinDate: new Date().toISOString().split('T')[0],
    birthDate: '',
    phone: '010-0000-0000',
    status: 'working' as EmployeeStatus,
    annualLeave: { carryOverLeave: 0, bonusLeave: 0 },
    manualAdjustment: 0,
    healthCertDate: '',
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

  /**
   * 올해 발생한 월차. 입사 1년 미만 기간에 매월 1일씩 최대 11일
   * (12번째 달은 1년 도달 = 연차 15일이 생기는 시점이라 월차로 세지 않는다).
   *
   * 1년이 지나도 0으로 지우지 않는다 — 발생한 월차는 잔여에 그대로 포함돼 있다가
   * 해가 바뀔 때 이월(carryOverLeave)로 넘어가는 개념이다.
   * 예전엔 1년이 지나면 월차를 0으로 만들면서, 그 월차로 쓴 휴가는 연차에서
   * 그대로 차감해 잔여가 실제보다 적게 나왔다.
   */
  const calculateMonthlyLeaveThisYear = (joinDate: string) => {
    const start = new Date(joinDate);
    let count = 0;
    for (let m = 1; m <= 11; m++) {
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
      .filter(r => r.employeeId === empId && r.status === 'approved' && !NON_DEDUCTIBLE_TYPES.includes(r.type))
      .reduce((sum, r) => sum + r.daysUsed, 0);
  };


  const calculateWorkDays = (joinDate: string) => {
    const start = new Date(joinDate);
    const today = new Date();
    const diffTime = Math.abs(today.getTime() - start.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // 보건증 만료일 = 발급일 + 1년, 남은 일수 계산
  const getHealthCertStatus = (issued: string) => {
    const issuedDate = new Date(issued);
    const expiry = new Date(issuedDate);
    expiry.setFullYear(expiry.getFullYear() + 1);
    const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return { expiry: expiry.toISOString().slice(0, 10), daysLeft };
  };

  const filteredEmployees = employees.filter(emp => 
    emp.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    emp.department.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const pendingRequests = leaveRequests.filter(r =>
    r.status === 'pending' || r.status === 'cancel_pending' || r.modifyRequest?.status === 'pending'
  );

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
    <div className="space-y-4 animate-in fade-in duration-300 h-full flex flex-col">
      <PageHeader
        title="인사 관리"
        subtitle="임직원 정보 관리부터 연차 승인, 잔여 일수 조정까지 통합 관리합니다."
        right={<div className="flex flex-wrap items-center gap-2">
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
                  annualLeave: { carryOverLeave: 0, bonusLeave: 0 }, manualAdjustment: 0,
                  healthCertDate: '',
                });
                setIsModalOpen(true);
              }}
              className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-black hover:bg-indigo-700 transition-all shadow-sm"
            >
              <Plus size={15} /><span>직원 등록</span>
            </button>
          )}
          {activeTab === 'leave-balance' && (
            <>
              <button
                onClick={() => setIsEditMode(!isEditMode)}
                className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-black shadow-sm transition-all ${
                  isEditMode ? 'bg-rose-500 text-white hover:bg-rose-600' : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                {isEditMode ? <Lock size={14} /> : <Unlock size={14} />}
                <span>{isEditMode ? '편집 종료' : '연차 편집'}</span>
              </button>
              <button
                onClick={() => {
                  setVacationExcluded(new Set());
                  setVacationRange({ start: today.toISOString().slice(0, 10), end: today.toISOString().slice(0, 10) });
                  setVacationReason('');
                  setShowVacation(true);
                }}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-black shadow-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-all"
              >
                <CalendarCheck size={14} /><span>휴가</span>
              </button>
            </>
          )}
        </div>}
      />

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-white rounded-2xl border border-slate-200">
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
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-left min-w-[640px]">
                <thead className="bg-slate-50/50 border-b border-slate-100 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">임직원 정보</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">부서 / 직급</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">입사일 / 근속</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">보건증</th>
                    <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredEmployees.map(emp => (
                    <tr key={emp.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-4 sm:px-8 py-4 sm:py-6">
                        <div className="flex items-center space-x-3">
                          <div className="w-9 h-9 sm:w-12 sm:h-12 bg-indigo-50 text-indigo-600 rounded-xl sm:rounded-2xl flex items-center justify-center font-black shrink-0">{emp.name[0]}</div>
                          <div><p className="font-black text-slate-800 text-sm">{emp.name}</p><p className="text-xs text-slate-400">{emp.phone}</p></div>
                        </div>
                      </td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6">
                        <p className="text-sm font-bold text-slate-700">{emp.department}</p>
                        <p className="text-[10px] text-slate-400 font-black uppercase">{emp.position}</p>
                      </td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-slate-600 flex items-center"><Calendar size={12} className="mr-1.5" />{emp.joinDate}</p>
                          <span className="text-[10px] font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100">{calculateWorkDays(emp.joinDate)}일째</span>
                        </div>
                      </td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6 text-center">
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
                      <td className="px-4 sm:px-8 py-4 sm:py-6 text-right">
                        <div className="flex justify-end space-x-2 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={() => { setEditingEmployee(emp); setFormData({ name: emp.name, position: emp.position, department: emp.department, joinDate: emp.joinDate, birthDate: emp.birthDate || '', phone: emp.phone, status: emp.status, annualLeave: { carryOverLeave: emp.annualLeave?.carryOverLeave || 0, bonusLeave: emp.annualLeave?.bonusLeave || 0 }, manualAdjustment: emp.manualAdjustment || 0, healthCertDate: emp.healthCertDate || '' }); setIsModalOpen(true); }} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"><Edit2 size={18} /></button>
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
          <div className="flex-1 overflow-auto custom-scrollbar">
            <table className="w-full text-left min-w-[580px]">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">신청 직원</th>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">항목 / 사유</th>
                  <th className="px-4 sm:px-10 py-4 sm:py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">신청 기간 / 일수</th>
                  <th className="px-4 sm:px-10 py-4 sm:py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">결재 처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pendingRequests.map(req => {
                  const isCancel = req.status === 'cancel_pending';
                  const isModify = req.modifyRequest?.status === 'pending';
                  return (
                  <tr key={req.id} className={`transition-colors ${isCancel ? 'hover:bg-rose-50/20' : isModify ? 'hover:bg-violet-50/20' : 'hover:bg-amber-50/20'}`}>
                    <td className="px-4 sm:px-8 py-4 sm:py-6">
                      <p className="font-black text-slate-800 text-sm">{req.employeeName}</p>
                      {isCancel && <span className="text-[9px] font-black px-1.5 py-0.5 bg-rose-100 text-rose-600 rounded mt-0.5 inline-block">취소 신청</span>}
                      {isModify && <span className="text-[9px] font-black px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded mt-0.5 inline-block">변경 신청</span>}
                    </td>
                    <td className="px-4 sm:px-8 py-4 sm:py-6">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase mb-1 inline-block ${req.type === '연차' ? 'bg-indigo-500 text-white' : req.type === '휴가' ? 'bg-sky-500 text-white' : 'bg-emerald-500 text-white'}`}>{req.type}</span>
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
                    <td className="px-4 sm:px-10 py-4 sm:py-6">
                      <p className="text-xs font-bold text-slate-700">{req.startDate} ~ {req.endDate}</p>
                      <p className="text-[10px] font-black text-indigo-600 bg-indigo-50 w-fit px-1.5 py-0.5 rounded-md mt-1">
                        {isModify ? `${req.modifyRequest!.daysUsed}일 (변경)` : `${req.daysUsed}일 사용`}
                      </p>
                    </td>
                    <td className="px-4 sm:px-10 py-4 sm:py-6 text-right">
                      <div className="flex justify-end space-x-3">
                        {isCancel && <>
                          <button onClick={() => onUpdateLeaveStatus(req.id, 'cancelled')} className="flex items-center space-x-2 px-4 py-2 bg-rose-600 text-white rounded-xl text-xs font-black hover:bg-rose-700 transition-all"><Check size={14} /><span>취소 승인</span></button>
                          <button onClick={() => onUpdateLeaveStatus(req.id, 'approved')} className="flex items-center space-x-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-black hover:bg-slate-200 transition-all"><X size={14} /><span>반려</span></button>
                        </>}
                        {isModify && <>
                          <button onClick={() => onUpdateLeave(req.id, {
                            startDate: req.modifyRequest!.startDate,
                            endDate: req.modifyRequest!.endDate,
                            reason: req.modifyRequest!.reason,
                            daysUsed: req.modifyRequest!.daysUsed,
                            modifyRequest: { ...req.modifyRequest!, status: 'approved' },
                          })} className="flex items-center space-x-2 px-4 py-2 bg-violet-600 text-white rounded-xl text-xs font-black hover:bg-violet-700 transition-all"><Check size={14} /><span>변경 승인</span></button>
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
        )}

        {activeTab === 'leave-balance' && (
          <div className="flex-1 overflow-auto custom-scrollbar">
            <div className="p-4 sm:p-8 bg-indigo-50 border-b border-indigo-100 flex items-start sm:items-center space-x-3">
              <AlertCircle className="text-indigo-500 shrink-0 mt-0.5 sm:mt-0" size={20} />
              <div className="text-xs font-bold text-indigo-700 leading-relaxed">
                <p>연차 정보는 인사팀에 의해 안전하게 관리됩니다. 우측 상단의 <b>&apos;편집 모드&apos;</b>를 활성화해야 수정이 가능합니다.</p>
                <p>1년 미만 직원은 올해 발생한 월차만 표시됩니다. 총 부여 = [월차/연차 + 보너스 + 이월], 실 잔여 = [총 부여 - (사용 + 수동 차감)]</p>
              </div>
            </div>
            <table className="w-full text-left min-w-[640px]">
              <thead className="bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">임직원</th>
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
                  // 1년이 지나도 올해 발생한 월차는 잔여에 그대로 포함된다(연말에 이월로 넘어감)
                  const monthlyLeave = calculateMonthlyLeaveThisYear(emp.joinDate);
                  const annualLeave = calculateAnnualLeave(emp.joinDate);
                  const totalGenerated = monthlyLeave + annualLeave;
                  const approvedUsed = getApprovedLeaveCount(emp.id);
                  const finalTotalUsable = totalGenerated + (emp.annualLeave?.carryOverLeave || 0) + (emp.annualLeave?.bonusLeave || 0);
                  const totalUsedCount = approvedUsed + (emp.manualAdjustment || 0);
                  const remaining = finalTotalUsable - totalUsedCount;

                  return (
                    <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-8 py-6">
                        <button
                          onClick={() => { setLeaveDetailEmp(emp); setOpenLeaveMonths(new Set()); }}
                          className="text-left group"
                          title="올해 연차 신청·사용 내역 보기"
                        >
                          <p className="font-black text-slate-800 group-hover:text-indigo-600 group-hover:underline decoration-indigo-300 underline-offset-2 transition-colors">{emp.name}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase">{emp.position}</p>
                        </button>
                      </td>
                      {/* 월차 — 1년이 지나도 올해 발생분은 잔여에 포함되므로 계속 표시 */}
                      <td className="px-4 py-6 text-center">
                        {monthlyLeave > 0 ? (
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
              {/* 보건증 섹션 */}
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest flex items-center space-x-1">
                  <CalendarCheck size={12} />
                  <span>보건증</span>
                </p>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">발급일</label>
                  <input
                    type="date"
                    value={formData.healthCertDate}
                    onChange={(e) => setFormData({...formData, healthCertDate: e.target.value})}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  {formData.healthCertDate && (() => {
                    const { expiry, daysLeft } = getHealthCertStatus(formData.healthCertDate);
                    const isExpired = daysLeft <= 0;
                    const isWarning = daysLeft > 0 && daysLeft <= 30;
                    return (
                      <p className={`text-xs font-bold px-3 py-1.5 rounded-xl ${isExpired ? 'bg-rose-50 text-rose-600' : isWarning ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                        만료일: {expiry} &nbsp;·&nbsp; {isExpired ? '만료됨' : `D-${daysLeft}`}
                      </p>
                    );
                  })()}
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
      {/* ── 회사 단체 휴가 일괄 등록 ── */}
      {showVacation && (() => {
        const targets = employees.filter(e => !vacationExcluded.has(e.id));
        const days = countWeekdays(vacationRange.start, vacationRange.end);
        const canSave = targets.length > 0 && days > 0 && !!vacationRange.start && !!vacationRange.end && !vacationBusy;

        const submit = async () => {
          if (!canSave || !onAddLeaveRequests) return;
          setVacationBusy(true);
          try {
            const now = new Date().toISOString();
            const reqs: LeaveRequest[] = targets.map((emp, i) => ({
              id: `leave-vac-${Date.now()}-${i}`,
              employeeId: emp.id,
              employeeName: emp.name,
              type: '휴가',
              startDate: vacationRange.start,
              endDate: vacationRange.end,
              reason: vacationReason.trim() || '회사 단체 휴가',
              status: 'approved',       // 관리자가 부여하는 것 — 승인 상태로 바로 차감
              requestedAt: now,
              daysUsed: days,
            }));
            await onAddLeaveRequests(reqs);
            setShowVacation(false);
          } catch (e) {
            alert(`휴가 등록 실패: ${(e as Error)?.message ?? String(e)}`);
          } finally {
            setVacationBusy(false);
          }
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowVacation(false)}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black text-slate-800">회사 단체 휴가</h3>
                  <p className="text-xs text-slate-400 font-bold">기간을 정하면 선택된 직원의 <b className="text-rose-500">연차가 차감</b>되고, 직원 앱 연차 내역에 '휴가'로 표시됩니다.</p>
                </div>
                <button onClick={() => setShowVacation(false)} className="text-slate-300 hover:text-slate-500 shrink-0"><X size={20} /></button>
              </div>

              {/* 기간 */}
              <div className="px-6 py-4 border-b border-slate-100 flex items-end gap-3 flex-wrap">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">시작일</label>
                  <input type="date" value={vacationRange.start}
                    onChange={e => setVacationRange(v => ({ ...v, start: e.target.value, end: v.end && v.end < e.target.value ? e.target.value : v.end }))}
                    className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">종료일</label>
                  <input type="date" value={vacationRange.end} min={vacationRange.start}
                    onChange={e => setVacationRange(v => ({ ...v, end: e.target.value }))}
                    className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div className="bg-indigo-50 rounded-xl px-4 py-2">
                  <p className="text-[10px] font-black text-indigo-400 uppercase">차감 일수</p>
                  <p className="text-lg font-black text-indigo-700 tabular-nums">{days}<span className="text-xs ml-0.5">일</span></p>
                </div>
                <input value={vacationReason} onChange={e => setVacationReason(e.target.value)} placeholder="사유 (기본: 회사 단체 휴가)"
                  className="flex-1 min-w-[160px] border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <p className="px-6 pt-2 text-[10px] text-slate-400">주말은 빼고 셉니다. 공휴일은 자동 제외되지 않으니 필요하면 기간을 나눠 등록하세요.</p>

              {/* 대상 직원 — 기본 전원 포함, 뺄 사람 클릭 */}
              <div className="px-6 py-3 flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">대상 {targets.length} / {employees.length}명</span>
                <button onClick={() => setVacationExcluded(new Set())} className="text-[10px] font-black text-indigo-500 hover:underline">전체 선택</button>
                <button onClick={() => setVacationExcluded(new Set(employees.map(e => e.id)))} className="text-[10px] font-black text-slate-400 hover:underline">전체 해제</button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {employees.map(emp => {
                    const on = !vacationExcluded.has(emp.id);
                    return (
                      <button key={emp.id}
                        onClick={() => setVacationExcluded(prev => {
                          const next = new Set(prev);
                          next.has(emp.id) ? next.delete(emp.id) : next.add(emp.id);
                          return next;
                        })}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all ${
                          on ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200 opacity-50'
                        }`}>
                        <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${on ? 'bg-indigo-600' : 'bg-slate-200'}`}>
                          {on && <Check size={11} className="text-white" strokeWidth={3.5} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-black text-slate-800 truncate">{emp.name}</span>
                          <span className="block text-[10px] text-slate-400 truncate">{emp.department} · {emp.position}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-2">
                <p className="text-[11px] font-bold text-slate-400 flex-1">
                  {targets.length}명 × {days}일 차감
                </p>
                <button onClick={() => setShowVacation(false)} className="px-5 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200">취소</button>
                <button onClick={submit} disabled={!canSave}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 disabled:opacity-30">
                  {vacationBusy ? '등록 중…' : '휴가 등록'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── 직원별 연차 상세 (올해 신청·사용 내역) ── */}
      {leaveDetailEmp && (() => {
        const emp = leaveDetailEmp;
        const year = today.getFullYear();
        const mine = leaveRequests
          .filter(r => r.employeeId === emp.id && (r.startDate ?? '').slice(0, 4) === String(year))
          .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));

        const underOneYear = isUnderOneYear(emp.joinDate);
        const monthlyLeave = calculateMonthlyLeaveThisYear(emp.joinDate);
        const annualLeave = calculateAnnualLeave(emp.joinDate);
        const totalUsable = monthlyLeave + annualLeave + (emp.annualLeave?.carryOverLeave || 0) + (emp.annualLeave?.bonusLeave || 0);
        const approvedUsed = getApprovedLeaveCount(emp.id);
        const remaining = totalUsable - approvedUsed - (emp.manualAdjustment || 0);

        // 승인되어 실제로 차감된 것만 집계(경조사·기타는 차감 안 함)
        const deductible = mine.filter(r => r.status === 'approved' && !NON_DEDUCTIBLE_TYPES.includes(r.type));
        const pendingMine = mine.filter(r => r.status === 'pending' || r.status === 'cancel_pending');

        const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
          approved: { text: '승인', cls: 'bg-emerald-100 text-emerald-700' },
          pending: { text: '대기', cls: 'bg-amber-100 text-amber-700' },
          rejected: { text: '반려', cls: 'bg-rose-100 text-rose-700' },
          cancel_pending: { text: '취소 요청', cls: 'bg-orange-100 text-orange-700' },
          cancelled: { text: '취소됨', cls: 'bg-slate-200 text-slate-500' },
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setLeaveDetailEmp(null)}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
              {/* 헤더 */}
              <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black text-slate-800">{emp.name}</h3>
                  <p className="text-xs text-slate-400 font-bold">
                    {emp.department} · {emp.position} · 입사 {emp.joinDate}
                    {underOneYear && <span className="ml-1.5 text-[10px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">1년 미만</span>}
                  </p>
                </div>
                <button onClick={() => setLeaveDetailEmp(null)} className="text-slate-300 hover:text-slate-500 shrink-0"><X size={20} /></button>
              </div>

              {/* 요약 */}
              <div className="px-6 py-4 grid grid-cols-4 gap-3 border-b border-slate-100">
                <div className="bg-slate-50 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase">총 부여</p>
                  <p className="text-xl font-black text-slate-800 tabular-nums">{totalUsable}<span className="text-xs ml-0.5 text-slate-400">일</span></p>
                  <p className="text-[9px] text-slate-400 mt-0.5">
                    {monthlyLeave > 0 && `월차 ${monthlyLeave}`}
                    {monthlyLeave > 0 && annualLeave > 0 && ' + '}
                    {annualLeave > 0 && `연차 ${annualLeave}`}
                    {(emp.annualLeave?.carryOverLeave || 0) > 0 && ` +이월 ${emp.annualLeave?.carryOverLeave}`}
                    {(emp.annualLeave?.bonusLeave || 0) > 0 && ` +보너스 ${emp.annualLeave?.bonusLeave}`}
                  </p>
                </div>
                <div className="bg-rose-50 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-black text-rose-400 uppercase">사용</p>
                  <p className="text-xl font-black text-rose-600 tabular-nums">{approvedUsed}<span className="text-xs ml-0.5 text-rose-300">일</span></p>
                  <p className="text-[9px] text-rose-400 mt-0.5">승인 {deductible.length}건</p>
                </div>
                <div className="bg-amber-50 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-black text-amber-500 uppercase">수동 차감</p>
                  <p className="text-xl font-black text-amber-600 tabular-nums">{emp.manualAdjustment || 0}<span className="text-xs ml-0.5 text-amber-300">일</span></p>
                </div>
                <div className="bg-indigo-600 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-black text-indigo-200 uppercase">잔여</p>
                  <p className="text-xl font-black text-white tabular-nums">{remaining}<span className="text-xs ml-0.5 text-indigo-200">일</span></p>
                  {pendingMine.length > 0 && <p className="text-[9px] text-indigo-200 mt-0.5">대기 {pendingMine.length}건</p>}
                </div>
              </div>

              {/* 월별 내역 — 헤더 클릭 시 펼침 */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{year}년 신청 내역 {mine.length}건</p>
                {mine.length === 0 ? (
                  <p className="text-center text-sm font-bold text-slate-300 py-16">올해 신청 내역이 없습니다</p>
                ) : (() => {
                  // 시작일 기준 월별 그룹 (최신 월 먼저)
                  const byMonth = new Map<string, typeof mine>();
                  for (const r of mine) {
                    const m = (r.startDate ?? '').slice(0, 7);
                    if (!byMonth.has(m)) byMonth.set(m, []);
                    byMonth.get(m)!.push(r);
                  }
                  const months = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));
                  return (
                    <div className="space-y-2">
                      {months.map(m => {
                        const rows = byMonth.get(m)!;
                        // 그 달에 실제로 차감된 일수 (승인 + 차감대상만)
                        const usedDays = rows
                          .filter(r => r.status === 'approved' && !NON_DEDUCTIBLE_TYPES.includes(r.type))
                          .reduce((s, r) => s + (r.daysUsed || 0), 0);
                        const pendingCnt = rows.filter(r => r.status === 'pending' || r.status === 'cancel_pending').length;
                        const isOpen = openLeaveMonths.has(m);
                        return (
                          <div key={m} className="border border-slate-100 rounded-2xl overflow-hidden">
                            <button
                              onClick={() => setOpenLeaveMonths(prev => {
                                const next = new Set(prev);
                                next.has(m) ? next.delete(m) : next.add(m);
                                return next;
                              })}
                              className={`w-full px-4 py-3 flex items-center gap-3 transition-colors ${isOpen ? 'bg-slate-50' : 'bg-white hover:bg-slate-50/60'}`}
                            >
                              <ChevronRight size={14} className={`text-slate-300 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                              <span className="font-black text-sm text-slate-800">{Number(m.slice(5, 7))}월</span>
                              <span className="text-[10px] font-black text-slate-400">{rows.length}건</span>
                              {pendingCnt > 0 && (
                                <span className="text-[10px] font-black px-2 py-0.5 rounded bg-amber-100 text-amber-700">대기 {pendingCnt}</span>
                              )}
                              <span className="ml-auto text-right shrink-0">
                                <span className={`text-lg font-black tabular-nums ${usedDays > 0 ? 'text-rose-600' : 'text-slate-300'}`}>{usedDays}</span>
                                <span className="text-[10px] font-bold text-slate-400 ml-0.5">일 사용</span>
                              </span>
                            </button>

                            {isOpen && (
                              <div className="divide-y divide-slate-50 border-t border-slate-100">
                                {rows.map(r => {
                                  const st = STATUS_LABEL[r.status] ?? { text: r.status, cls: 'bg-slate-100 text-slate-500' };
                                  const nonDeduct = NON_DEDUCTIBLE_TYPES.includes(r.type);
                                  return (
                                    <div key={r.id} className="px-4 py-3 flex items-start gap-3 bg-white">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className={`text-[10px] font-black px-2 py-0.5 rounded ${r.type === '연차' ? 'bg-indigo-500 text-white' : r.type === '휴가' ? 'bg-sky-500 text-white' : 'bg-emerald-500 text-white'}`}>{r.type}</span>
                                          <span className={`text-[10px] font-black px-2 py-0.5 rounded ${st.cls}`}>{st.text}</span>
                                          {nonDeduct && <span className="text-[10px] font-black px-2 py-0.5 rounded bg-slate-100 text-slate-500">미차감</span>}
                                          {r.modifyRequest?.status === 'pending' && <span className="text-[10px] font-black px-2 py-0.5 rounded bg-violet-100 text-violet-700">수정 요청</span>}
                                        </div>
                                        <p className="text-sm font-black text-slate-800 mt-1.5">
                                          {r.startDate}{r.endDate && r.endDate !== r.startDate ? ` ~ ${r.endDate}` : ''}
                                        </p>
                                        {r.reason && <p className="text-[11px] text-slate-400 mt-0.5 break-words">{r.reason}</p>}
                                        <p className="text-[10px] text-slate-300 mt-1">신청 {(r.requestedAt ?? '').slice(0, 10)}</p>
                                      </div>
                                      <div className="text-right shrink-0">
                                        <p className={`text-lg font-black tabular-nums ${r.status === 'approved' && !nonDeduct ? 'text-rose-600' : 'text-slate-300'}`}>
                                          {r.daysUsed}<span className="text-xs ml-0.5">일</span>
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })()}

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
