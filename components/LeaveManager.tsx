
import React, { useState, useMemo } from 'react';
import { 
  CalendarCheck, 
  Plus, 
  Search, 
  Trash2, 
  Calendar, 
  FileText,
  X,
  Check,
  ChevronRight,
  Info
} from 'lucide-react';
import { Employee, LeaveRequest, LeaveType, LeaveStatus } from '../types';

interface LeaveManagerProps {
  currentUser: Employee;
  employees: Employee[];
  leaveRequests: LeaveRequest[];
  onAddLeaveRequest: (_req: LeaveRequest) => void;
  onUpdateLeaveStatus: (_id: string, _status: LeaveStatus) => void;
  onDeleteLeaveRequest: (_id: string) => void;
}

type LeaveTab = 'my' | 'calendar';

const generateLeaveId = () => `lv-${Math.random().toString(36).substr(2, 9)}`;

const LeaveManager: React.FC<LeaveManagerProps> = ({ 
  currentUser,
  employees, 
  leaveRequests, 
  onAddLeaveRequest, 
  onDeleteLeaveRequest 
}) => {
  const [activeTab, setActiveTab] = useState<LeaveTab>('my');
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(currentUser.id);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const days = daysInMonth(year, month);
    const startDay = firstDayOfMonth(year, month);
    
    const result = [];
    // Previous month padding
    for (let i = 0; i < startDay; i++) {
      result.push(null);
    }
    // Current month days
    for (let i = 1; i <= days; i++) {
      result.push(new Date(year, month, i));
    }
    return result;
  }, [currentMonth]);

  const getLeavesForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return leaveRequests.filter(req => {
      if (req.status !== 'approved') return false;
      const start = new Date(req.startDate);
      const end = new Date(req.endDate);
      const current = new Date(dateStr);
      return current >= start && current <= end;
    });
  };

  const [formData, setFormData] = useState({
    type: '연차' as LeaveType,
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    reason: ''
  });

  const calculateStatutoryLeave = (joinDate: string) => {
    const start = new Date(joinDate);
    const today = new Date();
    let months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
    if (today.getDate() < start.getDate()) months--;
    const oneYearLater = new Date(start);
    oneYearLater.setFullYear(start.getFullYear() + 1);
    if (today < oneYearLater) {
      return Math.max(0, Math.min(11, months));
    } else {
      const years = today.getFullYear() - start.getFullYear();
      return Math.min(25, 15 + Math.floor((years - 1) / 2));
    }
  };

  const calculateUsedPersonalLeave = (empId: string) => {
    const today = new Date();
    return leaveRequests
      .filter(r => r.employeeId === empId && r.status === 'approved' && new Date(r.endDate) < today)
      .reduce((sum, r) => sum + r.daysUsed, 0);
  };

  const calculateRequestDays = (start: string, end: string, type: LeaveType) => {
    if (type === '오전반차' || type === '오후반차') return 0.5;
    const s = new Date(start);
    const e = new Date(end);
    const diffTime = Math.abs(e.getTime() - s.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  };

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    const emp = employees.find(e => e.id === selectedEmployeeId);
    if (!emp) return;
    const daysUsed = calculateRequestDays(formData.startDate, formData.endDate, formData.type);
    const newReq: LeaveRequest = {
      id: generateLeaveId(),
      employeeId: emp.id, employeeName: emp.name,
      type: formData.type, startDate: formData.startDate, endDate: formData.endDate,
      reason: formData.reason, status: 'pending', requestedAt: new Date().toISOString().split('T')[0],
      daysUsed
    };
    onAddLeaveRequest(newReq);
    setIsModalOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setFormData({ type: '연차', startDate: new Date().toISOString().split('T')[0], endDate: new Date().toISOString().split('T')[0], reason: '' });
    setSelectedEmployeeId('');
  };

  const filteredRequests = useMemo(() => {
    return leaveRequests
      .filter(r => r.employeeId === currentUser.id)
      .filter(r => r.employeeName.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  }, [leaveRequests, searchTerm, currentUser.id]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-black text-slate-900">연차 신청 및 확인</h2>
          <p className="text-sm md:text-base text-slate-500 mt-1">임직원 본인의 연차 사용 내역을 확인하고 신규 휴가를 신청하세요.</p>
        </div>
        <div className="flex items-center space-x-2 md:space-x-3">
          <div className="bg-white p-1 md:p-1.5 rounded-2xl border border-slate-100 shadow-sm flex overflow-x-auto no-scrollbar">
            <button 
              onClick={() => setActiveTab('my')}
              className={`px-4 md:px-6 py-2 md:py-2.5 rounded-xl text-xs font-black transition-all whitespace-nowrap ${activeTab === 'my' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
            >
              내 휴가
            </button>
            <button 
              onClick={() => setActiveTab('calendar')}
              className={`px-4 md:px-6 py-2 md:py-2.5 rounded-xl text-xs font-black transition-all whitespace-nowrap ${activeTab === 'calendar' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
            >
              임직원 캘린더
            </button>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-indigo-600 text-white px-4 md:px-8 py-3 md:py-4 rounded-2xl font-black shadow-xl shadow-indigo-100 hover:bg-indigo-700 hover:scale-105 active:scale-95 transition-all flex items-center space-x-2"
          >
            <Plus size={20} className="md:w-[22px] md:h-[22px]" />
            <span className="hidden sm:inline">신규 연차 신청</span>
          </button>
        </div>
      </div>

      {activeTab === 'calendar' ? (
        /* Calendar Section */
        <div className="bg-white rounded-[40px] border border-slate-100 shadow-sm overflow-hidden animate-in fade-in zoom-in-95 duration-300">
          <div className="p-8 border-b border-slate-50 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shadow-sm">
                <Calendar size={24} />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-800">임직원 휴가 캘린더</h3>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">월별 휴가 일정</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button 
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                className="p-2 hover:bg-slate-50 rounded-xl transition-all text-slate-400 hover:text-indigo-600"
              >
                <ChevronRight size={20} className="rotate-180" />
              </button>
              <span className="text-lg font-black text-slate-800">
                {currentMonth.getFullYear()}년 {currentMonth.getMonth() + 1}월
              </span>
              <button 
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                className="p-2 hover:bg-slate-50 rounded-xl transition-all text-slate-400 hover:text-indigo-600"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
          
          <div className="p-8 overflow-x-auto">
            <div className="min-w-[800px]">
              <div className="grid grid-cols-7 gap-2 mb-4">
                {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                  <div key={d} className="text-center text-[10px] font-black text-slate-400 uppercase tracking-widest py-2">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {calendarDays.map((date, idx) => {
                  if (!date) return <div key={`empty-${idx}`} className="aspect-square bg-slate-50/30 rounded-2xl" />;
                  
                  const leaves = getLeavesForDate(date);
                  const isToday = date.toDateString() === new Date().toDateString();
                  
                  return (
                    <div key={date.toISOString()} className={`min-h-[120px] p-3 rounded-2xl border transition-all flex flex-col ${isToday ? 'border-indigo-500 bg-indigo-50/30' : 'border-slate-50 hover:border-indigo-100'}`}>
                      <span className={`text-[10px] font-black mb-2 ${isToday ? 'text-indigo-600' : 'text-slate-400'}`}>{date.getDate()}</span>
                      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1.5 max-h-[80px]">
                        {leaves.map(l => (
                          <div key={l.id} className={`px-2 py-1 rounded-lg text-[9px] font-black truncate ${l.employeeId === currentUser.id ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600'}`}>
                            {l.employeeName}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* My Leave Tab Content */
        <div className="animate-in fade-in zoom-in-95 duration-300">
          {employees.filter(e => e.id === currentUser.id).map(emp => {
            const statutory = calculateStatutoryLeave(emp.joinDate);
            const carryOver = emp.annualLeave?.carryOverLeave || 0;
            const bonus = emp.annualLeave?.bonusLeave || 0;
            const total = statutory + carryOver + bonus;
            const usedVacation = emp.manualAdjustment || 0;
            const usedPersonal = calculateUsedPersonalLeave(emp.id);
            const totalUsed = usedVacation + usedPersonal;
            const remaining = total - totalUsed;
            const usagePercent = total > 0 ? (totalUsed / total) * 100 : 0;

            return (
              <div key={emp.id} className="flex flex-col lg:flex-row gap-4 md:gap-5 items-start">
                {/* 왼쪽: 연차 요약 카드 */}
                <div className="w-full lg:flex-[4] bg-white p-4 md:p-6 rounded-3xl border border-slate-100 shadow-sm">
                  {/* 직원 */}
                  <div className="flex items-center space-x-2 md:space-x-3 mb-4 md:mb-5">
                    <div className="w-10 h-10 md:w-11 md:h-11 bg-indigo-600 text-white rounded-xl flex items-center justify-center font-black text-base md:text-lg">{emp.name[0]}</div>
                    <div>
                      <h4 className="text-sm md:text-base font-black text-slate-800">{emp.name} {emp.position}</h4>
                      <p className="text-[10px] text-slate-400 font-bold">{emp.department} · {emp.joinDate}</p>
                    </div>
                  </div>

                  {/* 총 연차 */}
                  <div className="bg-slate-50 rounded-2xl p-3 md:p-4 mb-3 border border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">총 연차</p>
                      <p className="text-xl md:text-2xl font-black text-slate-900">{total}<span className="text-xs ml-0.5 font-bold text-slate-400">일</span></p>
                    </div>
                    <div className="flex flex-wrap gap-1 text-[10px] font-bold text-slate-400">
                      <span className="bg-white border border-slate-200 px-1.5 py-0.5 rounded">당해 {statutory}일</span>
                      <span className="text-slate-300">+</span>
                      <span className="bg-white border border-slate-200 px-1.5 py-0.5 rounded">이월 {carryOver}일</span>
                      <span className="text-slate-300">+</span>
                      <span className="bg-emerald-50 border border-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded">보너스 {bonus}일</span>
                    </div>
                  </div>

                  {/* 3칸: 휴가 | 개인연차 | 잔여 */}
                  <div className="grid grid-cols-3 gap-1.5 md:gap-2 mb-3 md:mb-4">
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-2 md:p-3 text-center">
                      <p className="text-[9px] font-black text-amber-400 uppercase mb-1">휴가</p>
                      <p className="text-lg md:text-xl font-black text-amber-500">{usedVacation}</p>
                    </div>
                    <div className="bg-rose-50 border border-rose-100 rounded-xl p-2 md:p-3 text-center">
                      <p className="text-[9px] font-black text-rose-400 uppercase mb-1">개인연차</p>
                      <p className="text-lg md:text-xl font-black text-rose-500">{usedPersonal}</p>
                    </div>
                    <div className={`rounded-xl p-2 md:p-3 text-center border ${remaining < 0 ? 'bg-rose-50 border-rose-200' : 'bg-indigo-50 border-indigo-100'}`}>
                      <p className="text-[9px] font-black text-slate-400 uppercase mb-1">잔여</p>
                      <p className={`text-lg md:text-xl font-black ${remaining < 0 ? 'text-rose-600' : 'text-indigo-600'}`}>{remaining}</p>
                    </div>
                  </div>

                  {/* 사용률 바 */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[9px] font-black text-slate-400 uppercase">
                      <div className="flex items-center space-x-2">
                        <span className="flex items-center space-x-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" /><span>휴가</span></span>
                        <span className="flex items-center space-x-1"><span className="w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" /><span>개인연차</span></span>
                      </div>
                      <span>{usagePercent.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                      <div style={{ width: `${total > 0 ? (usedVacation / total) * 100 : 0}%` }} className="h-full bg-amber-400 transition-all duration-700" />
                      <div style={{ width: `${total > 0 ? (usedPersonal / total) * 100 : 0}%` }} className="h-full bg-rose-400 transition-all duration-700" />
                    </div>
                  </div>
                </div>

                {/* 오른쪽: 신청 내역 */}
                <div className="w-full lg:flex-[6] bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h3 className="text-sm md:text-base font-black text-slate-800 flex items-center"><FileText className="mr-2 text-indigo-600 w-4 md:w-[18px] h-4 md:h-[18px]" />내 신청 내역</h3>
                    <div className="relative w-full sm:w-40">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={13} />
                      <input type="text" placeholder="검색..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                  </div>
                  <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
                    <table className="w-full text-left min-w-[500px]">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="px-3 md:px-5 py-2 md:py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">항목</th>
                          <th className="px-3 md:px-5 py-2 md:py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">기간</th>
                          <th className="px-3 md:px-5 py-2 md:py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">상태</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredRequests.length === 0 ? (
                          <tr><td colSpan={3} className="px-3 md:px-5 py-12 md:py-16 text-center text-slate-400 font-bold text-sm">신청 내역이 없습니다.</td></tr>
                        ) : filteredRequests.map(req => (
                          <tr key={req.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-3 md:px-5 py-2.5 md:py-3.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${req.type === '연차' ? 'bg-indigo-500 text-white' : 'bg-emerald-500 text-white'}`}>{req.type}</span>
                              <p className="text-xs text-slate-400 mt-0.5 italic leading-tight">&quot;{req.reason}&quot;</p>
                            </td>
                            <td className="px-3 md:px-5 py-2.5 md:py-3.5 text-xs font-bold text-slate-600 whitespace-nowrap">{req.startDate} ~ {req.endDate}</td>
                            <td className="px-3 md:px-5 py-2.5 md:py-3.5 text-center">
                              {req.status === 'pending' && <span className="bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full text-[10px] font-black uppercase">대기</span>}
                              {req.status === 'approved' && <span className="bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full text-[10px] font-black uppercase">승인</span>}
                              {req.status === 'rejected' && <span className="bg-rose-100 text-rose-700 px-2.5 py-1 rounded-full text-[10px] font-black uppercase">반려</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal - Unified Application */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setIsModalOpen(false)} />
          <div className="relative bg-white w-full max-w-xl rounded-[40px] shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-8 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg"><CalendarCheck size={24} /></div>
                <div><h3 className="text-2xl font-black text-slate-900">연차 신청서</h3><p className="text-xs text-slate-500 font-bold uppercase tracking-widest">휴가 신청</p></div>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full"><X size={24} /></button>
            </div>
            <form onSubmit={handleApply} className="p-8 space-y-6 overflow-y-auto custom-scrollbar">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">본인 확인</label>
                <div className="p-4 rounded-2xl border border-indigo-600 bg-indigo-600 text-white shadow-lg font-bold text-sm">
                  {currentUser.name} {currentUser.position}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">연차 유형</label>
                <div className="flex flex-wrap gap-2">
                  {['연차', '오전반차', '오후반차', '경조사', '기타'].map(t => (
                    <button key={t} type="button" onClick={() => setFormData({...formData, type: t as LeaveType})} className={`px-5 py-3 rounded-2xl text-xs font-bold border transition-all ${formData.type === t ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : 'bg-white border-slate-100 text-slate-400 hover:bg-slate-50'}`}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">시작일</label><input required type="date" value={formData.startDate} onChange={(e) => setFormData({...formData, startDate: e.target.value, endDate: e.target.value > formData.endDate ? e.target.value : formData.endDate})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" /></div>
                <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">종료일</label><input required disabled={formData.type.includes('반차')} type="date" value={formData.type.includes('반차') ? formData.startDate : formData.endDate} onChange={(e) => setFormData({...formData, endDate: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50" /></div>
              </div>
              <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">상세 사유</label><textarea required rows={4} value={formData.reason} onChange={(e) => setFormData({...formData, reason: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-3xl px-6 py-5 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 resize-none" placeholder="휴가 사유를 작성해 주세요." /></div>
              {selectedEmployeeId && (
                <div className="bg-indigo-50 border border-indigo-100 p-5 rounded-3xl flex items-center justify-between text-indigo-700 font-black text-sm">
                  <div className="flex items-center space-x-2"><Info size={18} /><span>총 {calculateRequestDays(formData.startDate, formData.endDate, formData.type)}일이 차감됩니다.</span></div>
                </div>
              )}
            </form>
            <div className="p-8 border-t border-slate-100 bg-slate-50/50 flex space-x-4 rounded-b-[40px]">
              <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-5 rounded-3xl font-black text-slate-500 bg-white border border-slate-200 hover:bg-slate-50 transition-all">취소</button>
              <button disabled={!selectedEmployeeId} type="submit" onClick={handleApply} className="flex-[2] py-5 rounded-3xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl transition-all disabled:opacity-50 flex items-center justify-center space-x-2"><Check size={22} /><span>신청 완료</span></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaveManager;
