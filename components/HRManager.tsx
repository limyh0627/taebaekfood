
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
  ChevronRight,
  Wallet,
  Copy,
  Printer,
  Save
} from 'lucide-react';
import { Employee, EmployeeStatus, LeaveRequest, LeaveStatus, LeaveType, Payroll, PayrollLine } from '../types';
import { payrollGross, payrollDeduct, payrollNet, payrollTotals } from '../types';
import PageHeader from './PageHeader';
import { subscribeToCollection, setDocument } from '../src/shared/services/firebaseService';

// 연차 계산은 공용 모듈(src/shared/leave.ts) — 직원 앱과 같은 함수를 쓴다
import {
  isDeductible,
  calculateRequestDays as calcRequestDays,
  isUnderOneYear as isUnderOneYearShared,
  getAnnualGrantInfo as getGrantInfo,
  calculateLeaveBalance,
} from '../src/shared/leave';

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
  // ── 급여대장 ── 대장 자체는 이 화면이 직접 읽고 쓴다(payrolls). 전표만 밖에 맡긴다.
  /** 대장 합계로 자금기록 한 건을 만들고 그 id를 돌려준다 */
  onCreatePayrollEntry?: (_p: {
    date: string; gross: number; deduct: number; net: number; note: string;
  }) => Promise<string | undefined>;
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
  onCreatePayrollEntry,
}) => {
  const [activeTab, setActiveTab] = useState<'employees' | 'leave-approval' | 'leave-balance' | 'payroll'>('employees');
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
  /** 단체 휴가가 연차를 차감하는가 — 창립기념일·명절 추가휴무는 미차감, 집단 연차소진은 차감 */
  const [vacationDeducts, setVacationDeducts] = useState(true);

  /** 단체 휴가 일수 — 신청과 같은 평일 기준(공용 모듈) */
  const countWeekdays = (start: string, end: string) =>
    (start && end) ? calcRequestDays(start, end, '휴가') : 0;

  // ── 급여대장 ──────────────────────────────────────────────────────────────
  // 재직자 명부에서 줄을 깔고 금액만 채운다. 저장은 월 단위 문서 하나(payrolls/pay-YYYY-MM).
  const thisYm = new Date().toISOString().slice(0, 7);
  const [payYm, setPayYm] = useState(thisYm);
  const [payDate, setPayDate] = useState(() => `${thisYm}-25`);
  const [payLines, setPayLines] = useState<PayrollLine[]>([]);
  const [paySaving, setPaySaving] = useState(false);
  const [payMsg, setPayMsg] = useState('');
  const [paySlipEmp, setPaySlipEmp] = useState<PayrollLine | null>(null);   // 명세서 미리보기
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  React.useEffect(() => subscribeToCollection<Payroll>('payrolls', setPayrolls), []);
  const won = (n: number) => (n || 0).toLocaleString('ko-KR');
  const savedPayroll = payrolls.find(p => p.yearMonth === payYm) ?? null;

  // 월을 바꾸면 저장본을 싣고, 없으면 재직자로 빈 줄을 깐다
  React.useEffect(() => {
    if (activeTab !== 'payroll') return;
    const doc = payrolls.find(p => p.yearMonth === payYm);
    if (doc) { setPayLines(doc.lines ?? []); setPayDate(doc.payDate || `${payYm}-25`); }
    else {
      setPayLines(employees.filter(e => e.status === 'working' && e.id !== 'admin').map(e => ({
        employeeId: e.id, employeeName: e.name, department: e.department, position: e.position, base: 0,
      })));
      setPayDate(`${payYm}-25`);
    }
    setPayMsg('');
  }, [payYm, activeTab, payrolls, employees]);

  const setCell = (i: number, field: keyof PayrollLine, v: string) => {
    const n = Math.round(parseFloat(v.replace(/[^\d.-]/g, '')) || 0);
    setPayLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: n } : l));
  };
  /** 지난달 금액 그대로 — 매달 바뀌는 건 몇 칸뿐이라 복사가 가장 빠르다 */
  const copyPrevMonth = () => {
    const [y, m] = payYm.split('-').map(Number);
    const prevYm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const prev = payrolls.find(p => p.yearMonth === prevYm);
    if (!prev) { setPayMsg(`${prevYm} 대장이 없습니다`); return; }
    const byId = new Map(prev.lines.map(l => [l.employeeId, l]));
    setPayLines(prev2 => prev2.map(l => {
      const old = byId.get(l.employeeId);
      return old ? { ...old, employeeId: l.employeeId, employeeName: l.employeeName, department: l.department, position: l.position } : l;
    }));
    setPayMsg(`${prevYm} 금액을 불러왔습니다`);
  };
  const payTotals = payrollTotals(payLines);

  const savePayroll = async () => {
    if (paySaving) return;
    setPaySaving(true);
    try {
      await setDocument('payrolls', `pay-${payYm}`, {
        id: `pay-${payYm}`, yearMonth: payYm, payDate,
        lines: payLines.filter(l => payrollGross(l) > 0),
        ...(savedPayroll?.cashEntryId ? { cashEntryId: savedPayroll.cashEntryId } : {}),
        createdAt: savedPayroll?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setPayMsg('저장했습니다');
    } finally { setPaySaving(false); }
  };

  /** 전표 생성 — 대장 합계로 자금기록 한 건.
   *  (차) 급여 지급계  (대) 예수금 공제계 + 보통예금 실지급계
   *  공제는 음수 줄로 넣어 통장에서 나간 돈이 실지급계와 맞는다. */
  const makePayrollEntry = async () => {
    if (!onCreatePayrollEntry || paySaving) return;
    if (payTotals.gross <= 0) { setPayMsg('금액을 먼저 입력하세요'); return; }
    if (savedPayroll?.cashEntryId && !window.confirm('이미 전표를 끊은 대장입니다. 한 건 더 만들까요?')) return;
    setPaySaving(true);
    try {
      await savePayroll();
      const id = await onCreatePayrollEntry({
        date: payDate, gross: payTotals.gross, deduct: payTotals.deduct, net: payTotals.net,
        note: `${payYm} 급여`,
      });
      if (id) {
        await setDocument('payrolls', `pay-${payYm}`, {
          id: `pay-${payYm}`, yearMonth: payYm, payDate,
          lines: payLines.filter(l => payrollGross(l) > 0), cashEntryId: id,
          createdAt: savedPayroll?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      setPayMsg('전표를 만들었습니다 — 전표내역에서 확인하세요');
    } finally { setPaySaving(false); }
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
    healthCertDate: '',
  });

  const today = new Date();

  // ── 연차 계산은 전부 공용 모듈(src/shared/leave.ts). 직원 앱과 같은 함수를 쓴다. ──
  const isUnderOneYear = (joinDate: string) => isUnderOneYearShared(joinDate, today);
  /** 올해 연차 발생 여부 + 응당일(MM-DD) + 발생 시 일수 — 표시용 */
  const getAnnualGrantInfo = (joinDate: string) => {
    const g = getGrantInfo(joinDate, today);
    return { granted: g.granted, dateStr: g.anniversary.slice(5), pendingDays: g.days };
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

  const handleBalanceUpdate = (emp: Employee, field: 'carryOverLeave' | 'bonusLeave', value: string) => {
    const numValue = parseFloat(value) || 0;
    onUpdateEmployee({ ...emp, annualLeave: { ...emp.annualLeave, carryOverLeave: emp.annualLeave?.carryOverLeave || 0, bonusLeave: emp.annualLeave?.bonusLeave || 0, [field]: numValue } });
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
            <button
              onClick={() => setActiveTab('payroll')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${activeTab === 'payroll' ? 'bg-white text-violet-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Wallet size={14} /><span>급여대장</span>
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
                  annualLeave: { carryOverLeave: 0, bonusLeave: 0 },
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
                  setVacationDeducts(true);
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
                          <button onClick={() => { setEditingEmployee(emp); setFormData({ name: emp.name, position: emp.position, department: emp.department, joinDate: emp.joinDate, birthDate: emp.birthDate || '', phone: emp.phone, status: emp.status, annualLeave: { carryOverLeave: emp.annualLeave?.carryOverLeave || 0, bonusLeave: emp.annualLeave?.bonusLeave || 0 }, healthCertDate: emp.healthCertDate || '' }); setIsModalOpen(true); }} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"><Edit2 size={18} /></button>
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
                <p>총 부여 = [월차 + 연차 + 보너스 + 이월], 잔여 = [총 부여 − 사용 개수]. <b>회사 단체 휴가는 위 &apos;휴가&apos; 버튼으로 등록하면 사용 개수에 바로 차감</b>됩니다.</p>
                <p>사용 개수는 <b>총 / 당월</b>로 보여줍니다(당월은 신청 시작일 기준). 월차는 발생분이 잔여에 포함돼 있다가 해가 바뀌면 이월로 넘겨주세요.</p>
                <p><b>연차는 입사 응당일에 발생</b>합니다. 아직 안 지났으면 <span className="text-amber-600 font-black">MM-DD 예정</span>으로 표시되고 <b>잔여에 더해지지 않습니다</b> — 그때까지는 이월분으로 사용합니다.</p>
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
                  <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center text-rose-500">
                    <span className="block">사용 개수</span>
                    <span className="text-[9px] font-bold text-slate-300 normal-case tracking-normal">총 / 당월</span>
                  </th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">최종 잔여</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {employees.map(emp => {
                  // 계산은 전부 공용 모듈 — 직원 앱과 같은 결과
                  const bal = calculateLeaveBalance(emp, leaveRequests, today);
                  const underOneYear = bal.grant.underOneYear;
                  const monthlyLeave = bal.monthly;
                  const annualLeave = bal.annual;
                  const finalTotalUsable = bal.granted;
                  const totalUsedCount = bal.usedTotal;
                  const remaining = bal.remaining;

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
                      {/* 연차 — 입사 응당일에 발생. 발생 전이면 0이고 잔여에도 안 더해진다 */}
                      <td className="px-4 py-6 text-center">
                        {(() => {
                          const g = getAnnualGrantInfo(emp.joinDate);
                          if (underOneYear) return (
                            <div className="flex flex-col items-center">
                              <span className="text-sm font-bold text-slate-300">0</span>
                              <span className="text-[9px] font-bold text-slate-300 uppercase">1년 미만</span>
                            </div>
                          );
                          return g.granted ? (
                            <div className="flex flex-col items-center">
                              <span className="text-sm font-bold text-slate-600">{annualLeave}</span>
                              <span className="text-[9px] font-black text-emerald-500">✓ {g.dateStr} 발생</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center" title={`${g.dateStr}에 ${g.pendingDays}일 발생 예정 — 그때까지는 이월분으로만 사용`}>
                              <span className="text-sm font-bold text-slate-300">0</span>
                              <span className="text-[9px] font-black text-amber-500">{g.dateStr} 예정 ({g.pendingDays})</span>
                            </div>
                          );
                        })()}
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
                      {/* 사용 개수 — 총 / 당월 */}
                      <td className="px-6 py-6 text-center">
                        <div className="flex flex-col items-center">
                          <div className="flex items-baseline gap-1">
                            <span className="text-sm font-black text-rose-500">{totalUsedCount}</span>
                            <span className="text-[10px] font-bold text-slate-300">/</span>
                            <span className={`text-sm font-black ${bal.usedThisMonth > 0 ? 'text-amber-500' : 'text-slate-300'}`}>{bal.usedThisMonth}</span>
                          </div>
                          <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">총 / 당월</span>
                        </div>
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

        {/* ── 급여대장 ── 재직자 명부에서 줄을 깔고 금액만 채운다.
            [전표 생성]을 누르면 합계로 자금기록 한 건이 나가고, 대장과 전표가 id로 묶인다. */}
        {activeTab === 'payroll' && (
          <div className="flex-1 overflow-auto custom-scrollbar">
            <div className="p-4 flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 sticky top-0 z-10">
              <input type="month" value={payYm} onChange={e => setPayYm(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-black outline-none focus:ring-2 focus:ring-violet-300" />
              <label className="flex items-center gap-1.5 text-[11px] font-black text-slate-400">
                지급일
                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                  className="border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-violet-300" />
              </label>
              <button onClick={copyPrevMonth}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-white border border-slate-200 text-slate-500 hover:border-violet-300 hover:text-violet-600 transition-all">
                <Copy size={13} />지난달 복사
              </button>
              <div className="ml-auto flex items-center gap-2">
                {payMsg && <span className="text-[11px] font-black text-violet-600">{payMsg}</span>}
                {savedPayroll?.cashEntryId && (
                  <span className="text-[10px] font-black px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">전표 생성됨</span>
                )}
                <button onClick={savePayroll} disabled={paySaving}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-white border border-slate-200 text-slate-600 hover:border-slate-300 disabled:opacity-40 transition-all">
                  <Save size={13} />저장
                </button>
                <button onClick={makePayrollEntry} disabled={paySaving || !onCreatePayrollEntry}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40 transition-all">
                  <Wallet size={13} />전표 생성
                </button>
              </div>
            </div>

            {payLines.length === 0 ? (
              <p className="py-16 text-center text-xs font-bold text-slate-300">재직 중인 임직원이 없습니다</p>
            ) : (
              <table className="w-full text-left min-w-[1100px] text-xs">
                <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">이름</th>
                    <th className="px-3 py-2.5">부서</th>
                    <th className="px-2 py-2.5 text-right">기본급</th>
                    <th className="px-2 py-2.5 text-right">연장수당</th>
                    <th className="px-2 py-2.5 text-right">기타수당</th>
                    <th className="px-2 py-2.5 text-right bg-slate-100">지급계</th>
                    <th className="px-2 py-2.5 text-right">소득세</th>
                    <th className="px-2 py-2.5 text-right">지방세</th>
                    <th className="px-2 py-2.5 text-right">국민연금</th>
                    <th className="px-2 py-2.5 text-right">건강보험</th>
                    <th className="px-2 py-2.5 text-right">고용보험</th>
                    <th className="px-2 py-2.5 text-right">기타공제</th>
                    <th className="px-2 py-2.5 text-right bg-slate-100">공제계</th>
                    <th className="px-2 py-2.5 text-right bg-violet-50">실지급</th>
                    <th className="px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {payLines.map((l, i) => {
                    const cell = (field: keyof PayrollLine) => (
                      <td className="px-2 py-1.5 text-right">
                        <input inputMode="numeric" value={(l[field] as number) ? won(l[field] as number) : ''}
                          onChange={e => setCell(i, field, e.target.value)} placeholder="0"
                          className="w-20 text-right tabular-nums font-bold border border-transparent hover:border-slate-200 focus:border-violet-300 rounded-lg px-1.5 py-1 outline-none" />
                      </td>
                    );
                    return (
                      <tr key={l.employeeId} className="hover:bg-slate-50/60">
                        <td className="px-3 py-1.5 font-black text-slate-800 whitespace-nowrap">{l.employeeName}</td>
                        <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{l.department}</td>
                        {cell('base')}{cell('overtime')}{cell('allowance')}
                        <td className="px-2 py-1.5 text-right font-black tabular-nums text-slate-700 bg-slate-50">{won(payrollGross(l))}</td>
                        {cell('incomeTax')}{cell('localTax')}{cell('pension')}{cell('health')}{cell('employment')}{cell('otherDeduct')}
                        <td className="px-2 py-1.5 text-right font-black tabular-nums text-rose-500 bg-slate-50">{won(payrollDeduct(l))}</td>
                        <td className="px-2 py-1.5 text-right font-black tabular-nums text-violet-700 bg-violet-50/60">{won(payrollNet(l))}</td>
                        <td className="px-2 py-1.5">
                          <button onClick={() => setPaySlipEmp(l)} title="급여명세서"
                            className="text-slate-300 hover:text-violet-600 transition-colors"><Printer size={13} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-100 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-3 py-2.5 font-black text-slate-700" colSpan={2}>합계 {payLines.length}명</td>
                    <td colSpan={3} />
                    <td className="px-2 py-2.5 text-right font-black tabular-nums text-slate-800">{won(payTotals.gross)}</td>
                    <td colSpan={6} />
                    <td className="px-2 py-2.5 text-right font-black tabular-nums text-rose-600">{won(payTotals.deduct)}</td>
                    <td className="px-2 py-2.5 text-right font-black tabular-nums text-violet-700">{won(payTotals.net)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}

            <div className="p-4 space-y-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">전표 생성 시 분개</p>
                <div className="text-xs font-bold text-slate-600 space-y-0.5 tabular-nums">
                  <p>(차) 515 급여 <span className="text-slate-800">{won(payTotals.gross)}</span></p>
                  <p className="pl-6">(대) 254 예수금 <span className="text-slate-800">{won(payTotals.deduct)}</span></p>
                  <p className="pl-6">(대) 103 보통예금 <span className="text-slate-800">{won(payTotals.net)}</span></p>
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  통장에서 나가는 건 실지급계뿐입니다. 공제분은 <b>예수금(부채)</b>으로 남았다가,
                  다음 달 원천세·4대보험을 낼 때 <b>입출금 → 일반 → 254 예수금</b> 출금으로 털어야 사라집니다.
                </p>
              </div>
              <p className="text-[11px] text-slate-400 px-1">
                4대보험 요율은 해마다 바뀌므로 자동계산하지 않습니다 — <b>고지서 금액을 그대로 입력</b>하세요.
                임금명세서 교부는 법적 의무이니, 줄 끝 인쇄 버튼으로 사원별 명세서를 뽑아 주세요.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 급여명세서 — 사원 한 명분. 근로기준법상 교부 의무 항목(지급·공제 내역)을 담는다. */}
      {paySlipEmp && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" onClick={() => setPaySlipEmp(null)}>
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">급여명세서</p>
                <h3 className="text-lg font-black text-slate-900">{paySlipEmp.employeeName}</h3>
                <p className="text-[11px] font-bold text-slate-400">
                  {paySlipEmp.department} {paySlipEmp.position} · {payYm} · 지급일 {payDate}
                </p>
              </div>
              <button onClick={() => setPaySlipEmp(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-2xl border border-slate-200 p-3">
                <p className="text-[10px] font-black text-slate-400 uppercase mb-1.5">지급</p>
                {([['기본급', paySlipEmp.base], ['연장수당', paySlipEmp.overtime], ['기타수당', paySlipEmp.allowance]] as const)
                  .filter(([, v]) => v).map(([k, v]) => (
                    <p key={k} className="flex justify-between font-bold text-slate-600 tabular-nums"><span>{k}</span><span>{won(v as number)}</span></p>
                  ))}
                <p className="flex justify-between font-black text-slate-800 tabular-nums border-t border-slate-100 mt-1.5 pt-1.5">
                  <span>지급계</span><span>{won(payrollGross(paySlipEmp))}</span></p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-3">
                <p className="text-[10px] font-black text-slate-400 uppercase mb-1.5">공제</p>
                {([['소득세', paySlipEmp.incomeTax], ['지방소득세', paySlipEmp.localTax], ['국민연금', paySlipEmp.pension],
                   ['건강보험', paySlipEmp.health], ['고용보험', paySlipEmp.employment], ['기타', paySlipEmp.otherDeduct]] as const)
                  .filter(([, v]) => v).map(([k, v]) => (
                    <p key={k} className="flex justify-between font-bold text-slate-600 tabular-nums"><span>{k}</span><span>{won(v as number)}</span></p>
                  ))}
                <p className="flex justify-between font-black text-rose-600 tabular-nums border-t border-slate-100 mt-1.5 pt-1.5">
                  <span>공제계</span><span>{won(payrollDeduct(paySlipEmp))}</span></p>
              </div>
            </div>
            <div className="mt-3 rounded-2xl bg-violet-50 px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-black text-violet-700">실지급액</span>
              <span className="text-lg font-black text-violet-700 tabular-nums">{won(payrollNet(paySlipEmp))}</span>
            </div>
            <button onClick={() => window.print()}
              className="mt-4 w-full py-2.5 rounded-xl bg-slate-800 text-white text-xs font-black hover:bg-slate-900 transition-all">
              인쇄
            </button>
          </div>
        </div>
      )}

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
              reason: vacationReason.trim() || (vacationDeducts ? '회사 단체 휴가' : '회사 단체 휴가 (연차 미차감)'),
              status: 'approved',       // 관리자가 부여하는 것 — 승인 상태
              requestedAt: now,
              daysUsed: days,
              deductsLeave: vacationDeducts,
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
                  <p className="text-xs text-slate-400 font-bold">
                    선택된 직원에게 &apos;휴가&apos;로 기록됩니다. <b className={vacationDeducts ? 'text-rose-500' : 'text-slate-500'}>
                    {vacationDeducts ? '연차에서 차감' : '연차 차감 없음'}</b> — 직원 앱 연차 내역에도 그대로 표시됩니다.
                  </p>
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
                <div className={`rounded-xl px-4 py-2 ${vacationDeducts ? 'bg-indigo-50' : 'bg-slate-100'}`}>
                  <p className={`text-[10px] font-black uppercase ${vacationDeducts ? 'text-indigo-400' : 'text-slate-400'}`}>
                    {vacationDeducts ? '차감 일수' : '휴무 일수'}
                  </p>
                  <p className={`text-lg font-black tabular-nums ${vacationDeducts ? 'text-indigo-700' : 'text-slate-500'}`}>{days}<span className="text-xs ml-0.5">일</span></p>
                </div>
                <input value={vacationReason} onChange={e => setVacationReason(e.target.value)} placeholder="사유 (기본: 회사 단체 휴가)"
                  className="flex-1 min-w-[160px] border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>

              {/* 연차 차감 여부 */}
              <div className="px-6 pb-1">
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">연차 차감</label>
                <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5 max-w-md">
                  <button type="button" onClick={() => setVacationDeducts(true)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-black transition-all ${vacationDeducts ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
                    차감 <span className="font-bold opacity-70">· 집단 연차소진</span>
                  </button>
                  <button type="button" onClick={() => setVacationDeducts(false)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-black transition-all ${!vacationDeducts ? 'bg-slate-600 text-white' : 'text-slate-400'}`}>
                    미차감 <span className="font-bold opacity-70">· 창립일·명절 등</span>
                  </button>
                </div>
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
                  {targets.length}명 × {days}일 {vacationDeducts ? '연차 차감' : '휴무(연차 미차감)'}
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

        const bal = calculateLeaveBalance(emp, leaveRequests, today);
        const underOneYear = bal.grant.underOneYear;
        const monthlyLeave = bal.monthly;
        const annualLeave = bal.annual;
        const totalUsable = bal.granted;
        const remaining = bal.remaining;

        // 승인되어 실제로 차감된 것만 집계(경조사·기타는 차감 안 함)
        const deductible = mine.filter(r => r.status === 'approved' && isDeductible(r));
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
              <div className="px-6 py-4 grid grid-cols-3 gap-3 border-b border-slate-100">
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
                  {(() => {
                    const g = getAnnualGrantInfo(emp.joinDate);
                    if (underOneYear || g.granted) return null;
                    return <p className="text-[9px] font-black text-amber-500 mt-1">연차 {g.dateStr} 발생 예정 ({g.pendingDays}일) — 아직 미포함</p>;
                  })()}
                </div>
                <div className="bg-rose-50 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-black text-rose-400 uppercase">사용 <span className="text-rose-300 normal-case">총 / 당월</span></p>
                  <p className="text-xl font-black text-rose-600 tabular-nums">
                    {bal.usedTotal}
                    <span className="text-slate-300 mx-1 text-sm">/</span>
                    <span className={bal.usedThisMonth > 0 ? 'text-amber-600' : 'text-slate-300'}>{bal.usedThisMonth}</span>
                    <span className="text-xs ml-0.5 text-rose-300">일</span>
                  </p>
                  <p className="text-[9px] text-rose-400 mt-0.5">승인 {deductible.length}건</p>
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
                          .filter(r => r.status === 'approved' && isDeductible(r))
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
                                  const nonDeduct = !isDeductible(r);
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
