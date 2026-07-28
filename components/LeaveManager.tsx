
import React, { useState, useMemo, useEffect } from 'react';
import {
  CalendarCheck,
  Plus,
  Search,
  Calendar,
  FileText,
  X,
  Check,
  ChevronRight,
  Info,
  Phone,
  PhoneCall,
  Building2,
  Network,
  Pencil,
  Save,
  Trash2,
  ArrowUp,
  ArrowDown,
  Crown
} from 'lucide-react';
import { Employee, LeaveRequest, LeaveType, LeaveStatus } from '../types';
import { subscribeToDocument, setDocument } from '../src/shared/services/firebaseService';
import PageHeader from './PageHeader';

// 연차 계산은 공용 모듈(src/shared/leave.ts) — 관리자 화면과 같은 함수를 쓴다
import {
  isDeductible,
  LEAVE_DEDUCTION,
  calculateRequestDays as calcRequestDays,
  calculateMonthlyLeave,
  calculateAnnualLeave,
  getAnnualGrantInfo,
} from '../src/shared/leave';

interface LeaveManagerProps {
  currentUser: Employee;
  employees: Employee[];
  leaveRequests: LeaveRequest[];
  onAddLeaveRequest: (_req: LeaveRequest) => void;
  onUpdateLeaveStatus: (_id: string, _status: LeaveStatus) => void;
  onUpdateLeave: (_id: string, _updates: Partial<LeaveRequest>) => void;
  /** 관리자만 조직도·비상연락망을 편집할 수 있다. 직원 앱에서는 읽기 전용. */
  isAdmin?: boolean;
}

type LeaveTab = 'my' | 'calendar' | 'orgchart';

// ── 조직도 설정 (Firestore: settings/orgChart) ──
interface OrgDept {
  id: string;         // 안정적인 노드 id
  keys: string[];     // 이 박스에 묶을 employee.department 값들(여러 개 = 병합, 예: 생산관리팀+생산팀)
  name: string;       // 화면 표시용 부서명 (편집 가능)
  headId?: string;        // 부서장(팀장) employeeId
  memo?: string;          // 부서 설명 메모
  tier?: 'exec' | 'normal'; // 'exec' = 임원 계층(대표와 부서 사이 개별 카드). undefined = 미지정(레거시)
}
interface OrgChartConfig {
  top: { title: string; name: string }; // 대표 노드
  departments: OrgDept[];
  updatedAt?: string;
}

// 시스템/회사 계정(관리자 로그인용) — 조직도·연락처에서 제외
const isSystemAccount = (e: Employee) => e.id === 'admin' || e.position === '관리자';

const generateLeaveId = () => `lv-${Math.random().toString(36).substring(2, 11)}`;
const genId = (p: string) => `${p}-${Math.random().toString(36).substring(2, 8)}`;

// 직급 서열 — 부서장 자동 추정 및 정렬용 (높을수록 상위)
const POSITION_RANK: Record<string, number> = {
  '대표': 100, '대표이사': 100, '사장': 95, '부사장': 90, '이사': 80, '상무': 82, '전무': 85,
  '부장': 70, '차장': 60, '팀장': 65, '실장': 66, '과장': 50, '대리': 40, '주임': 30, '반장': 32,
  '사원': 20, '주무': 22, '인턴': 10,
};
const positionRank = (pos?: string): number => {
  if (!pos) return 0;
  let best = 0;
  for (const [k, v] of Object.entries(POSITION_RANK)) {
    if (pos.includes(k) && v > best) best = v;
  }
  return best;
};

// 전화 걸기 링크용 — 숫자만 남긴다
const telHref = (phone?: string) => `tel:${(phone || '').replace(/[^0-9+]/g, '')}`;

// 부서 카드 색상 팔레트 — 부서별로 다른 색을 줘서 한눈에 구분되게
const DEPT_COLORS = [
  { bar: 'bg-indigo-500', soft: 'bg-indigo-50', border: 'border-indigo-100', text: 'text-indigo-600', avatar: 'bg-indigo-600' },
  { bar: 'bg-emerald-500', soft: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-600', avatar: 'bg-emerald-600' },
  { bar: 'bg-amber-500', soft: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-600', avatar: 'bg-amber-500' },
  { bar: 'bg-sky-500', soft: 'bg-sky-50', border: 'border-sky-100', text: 'text-sky-600', avatar: 'bg-sky-600' },
  { bar: 'bg-rose-500', soft: 'bg-rose-50', border: 'border-rose-100', text: 'text-rose-600', avatar: 'bg-rose-500' },
  { bar: 'bg-violet-500', soft: 'bg-violet-50', border: 'border-violet-100', text: 'text-violet-600', avatar: 'bg-violet-600' },
];

// 같은 부서로 볼 이름을 하나의 표준형으로 — "생산관리팀"과 "생산팀"을 같은 그룹으로 묶는다.
// 공백 제거 → '관리/지원' 같은 수식어 제거 → 끝의 팀/부/과/실/그룹/센터/본부 제거.
const canonicalDept = (name: string): string => {
  const c = name
    .replace(/\s+/g, '')
    .replace(/관리|지원/g, '')
    .replace(/(팀|부|과|실|그룹|센터|본부|사업부)$/g, '');
  return c || name.replace(/\s+/g, ''); // 표준형이 비면 병합하지 않도록 원본 사용
};

// 실제 직원 명단에서 조직도 기본값을 만든다. (재직/휴직 포함, 퇴사·시스템 계정 제외)
const deriveDefaultOrg = (employees: Employee[]): OrgChartConfig => {
  const active = employees.filter(e => e.status !== 'out' && !isSystemAccount(e));
  const ceo = active.find(e => (e.position || '').includes('대표'));
  const deptNames = Array.from(new Set(active.map(e => e.department).filter(Boolean))) as string[];
  // 표준형이 같은 부서명끼리 하나의 노드로 병합
  const groups = new Map<string, string[]>();
  for (const name of deptNames) {
    const canon = canonicalDept(name);
    if (!groups.has(canon)) groups.set(canon, []);
    groups.get(canon)!.push(name);
  }
  const departments: OrgDept[] = Array.from(groups.values()).map((keys, i) => {
    const members = active.filter(e => keys.includes(e.department));
    const head = [...members].sort((a, b) => positionRank(b.position) - positionRank(a.position))[0];
    // 표시 이름 = 구성원이 가장 많은 원본 부서명(동률이면 더 짧은 쪽)
    const name = [...keys].sort((a, b) => {
      const ca = active.filter(e => e.department === b).length - active.filter(e => e.department === a).length;
      return ca !== 0 ? ca : a.length - b.length;
    })[0];
    // '임원' 부서는 대표와 부서 사이의 임원 계층으로 표시
    const isExec = keys.some(k => canonicalDept(k) === '임원') || name === '임원';
    const dept: OrgDept = { id: `dept-${i}`, keys, name, headId: head?.id, memo: '' };
    if (isExec) dept.tier = 'exec';
    return dept;
  });
  // 임원 계층을 부서보다 앞에 오도록 정렬(위쪽 tier가 먼저)
  departments.sort((a, b) => (a.tier === 'exec' ? 0 : 1) - (b.tier === 'exec' ? 0 : 1));
  return { top: { title: ceo?.position || '대표', name: ceo?.name || '' }, departments };
};

// 저장본 보정 — tier 미지정(레거시 저장본)인 '임원' 부서를 임원 계층으로 승격.
// (관리자가 명시적으로 껐다면 tier='normal'이므로 건드리지 않는다.)
const normalizeOrg = (cfg: OrgChartConfig): OrgChartConfig => ({
  ...cfg,
  departments: (cfg.departments ?? []).map(d =>
    d.tier === undefined && (d.name === '임원' || (d.keys ?? []).some(k => canonicalDept(k) === '임원'))
      ? { ...d, tier: 'exec' as const }
      : d,
  ),
});

const LeaveManager: React.FC<LeaveManagerProps> = ({
  currentUser,
  employees,
  leaveRequests,
  onAddLeaveRequest,
  onUpdateLeaveStatus,
  onUpdateLeave,
  isAdmin = false,
}) => {
  const [activeTab, setActiveTab] = useState<LeaveTab>('my');
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(currentUser.id);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [filterMonth, setFilterMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [modifyTarget, setModifyTarget] = useState<LeaveRequest | null>(null);
  const [modifyForm, setModifyForm] = useState({ startDate: '', endDate: '', reason: '' });

  // ── 조직도 / 직원 연락처 ──
  const [orgSaved, setOrgSaved] = useState<OrgChartConfig | null>(null);   // Firestore 저장본(없으면 null)
  const [orgDraft, setOrgDraft] = useState<OrgChartConfig | null>(null);   // 편집 중 초안(null이면 보기 모드)
  const [dirSearch, setDirSearch] = useState('');                          // 직원 연락처 검색어

  useEffect(() => {
    const unsubOrg = subscribeToDocument<OrgChartConfig>('settings', 'orgChart', setOrgSaved);
    return () => { unsubOrg(); };
  }, []);

  // 저장본이 없으면 실제 직원 명단에서 만든 기본 조직도를 보여준다. (레거시 저장본은 임원 계층 보정)
  const effectiveOrg = useMemo<OrgChartConfig>(
    () => normalizeOrg(orgSaved ?? deriveDefaultOrg(employees)),
    [orgSaved, employees],
  );

  // 재직 중인 실제 직원(퇴사·시스템 계정 제외)
  const activeEmployees = useMemo(
    () => employees.filter(e => e.status !== 'out' && !isSystemAccount(e)),
    [employees],
  );
  const empById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  // 조직도 "구성원 기준" 셀렉트용 — 실제 존재하는 부서명 목록
  const deptKeys = useMemo(
    () => Array.from(new Set(activeEmployees.map(e => e.department).filter(Boolean))) as string[],
    [activeEmployees],
  );
  // 여러 부서명을 한 박스로 묶으므로 keys 배열 기준으로 구성원을 모은다.
  const membersOf = (keys: string[]) =>
    activeEmployees
      .filter(e => keys.includes(e.department))
      .sort((a, b) => positionRank(b.position) - positionRank(a.position));
  // 어느 부서에도 속하지 않은 재직자(부서 미입력/삭제된 부서)
  const unassigned = useMemo(() => {
    const claimed = new Set(effectiveOrg.departments.flatMap(d => d.keys));
    return activeEmployees.filter(e => !e.department || !claimed.has(e.department));
  }, [effectiveOrg, activeEmployees]);

  const saveOrg = async (cfg: OrgChartConfig) => {
    const payload = { ...cfg, updatedAt: new Date().toISOString() };
    await setDocument('settings', 'orgChart', payload);
    setOrgDraft(null);
  };
  // draft 부서 필드 수정 헬퍼
  const patchDept = (id: string, patch: Partial<OrgDept>) =>
    setOrgDraft(d => d ? { ...d, departments: d.departments.map(dp => dp.id === id ? { ...dp, ...patch } : dp) } : d);
  // 박스에 특정 부서명을 넣거나 뺀다(병합/분리). 부서장이 빠지면 초기화.
  const toggleDeptKey = (id: string, key: string) =>
    setOrgDraft(d => {
      if (!d) return d;
      return {
        ...d,
        departments: d.departments.map(dp => {
          if (dp.id !== id) return dp;
          const has = dp.keys.includes(key);
          const keys = has ? dp.keys.filter(k => k !== key) : [...dp.keys, key];
          const headStillIn = dp.headId && activeEmployees.some(e => e.id === dp.headId && keys.includes(e.department));
          return { ...dp, keys, headId: headStillIn ? dp.headId : undefined };
        }),
      };
    });
  const moveDept = (idx: number, dir: -1 | 1) =>
    setOrgDraft(d => {
      if (!d) return d;
      const arr = [...d.departments];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return d;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return { ...d, departments: arr };
    });
  // 임원 계층 여부 토글 (명시적 'normal'로 꺼야 보정 로직이 다시 켜지 않는다)
  const toggleExec = (id: string) =>
    setOrgDraft(d => d ? { ...d, departments: d.departments.map(dp => dp.id === id ? { ...dp, tier: dp.tier === 'exec' ? 'normal' : 'exec' } : dp) } : d);

  // 조직도 카드 안의 직원 한 줄 (부서장은 색상 강조 + 왕관, 전화번호 있으면 전화 버튼)
  const personRow = (emp: Employee, head: boolean, color: typeof DEPT_COLORS[number]) => (
    <div key={emp.id} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${head ? color.soft : 'hover:bg-slate-50'} transition-colors`}>
      <span className={`relative w-7 h-7 rounded-lg text-[11px] font-black flex items-center justify-center shrink-0 ${head ? `${color.avatar} text-white` : 'bg-slate-100 text-slate-500'}`}>
        {emp.name[0]}
        {head && <Crown size={9} className="absolute -top-1.5 -right-1 text-amber-400 fill-amber-400" />}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-xs font-black text-slate-800 truncate">{emp.name} <span className="text-[10px] font-bold text-slate-400">{emp.position}</span></p>
        {head && <p className={`text-[9px] font-black ${color.text}`}>부서장</p>}
      </div>
      {emp.phone && (
        <a href={telHref(emp.phone)} className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100 transition-all shrink-0"><Phone size={13} /></a>
      )}
    </div>
  );

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

  const parseLocal = (s: string) => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };

  const getLeavesForDate = (date: Date) => {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    return leaveRequests.filter(req => {
      if (req.status !== 'approved') return false;
      const start = parseLocal(req.startDate);
      const end = parseLocal(req.endDate);
      const current = parseLocal(dateStr);
      return current >= start && current <= end;
    });
  };

  const [formData, setFormData] = useState({
    type: '연차' as LeaveType,
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    reason: ''
  });

  /** 당해 발생 월차/연차 — 공용 모듈. 1년 미만이면 월차, 이상이면 응당일에 발생한 연차. */
  const calculateStatutoryLeave = (joinDate: string) =>
    calculateMonthlyLeave(joinDate) + calculateAnnualLeave(joinDate);

  const calculateUsedPersonalLeave = (empId: string) => {
    const today = new Date();
    return leaveRequests
      .filter(r =>
        r.employeeId === empId &&
        r.status === 'approved' &&
        isDeductible(r) &&
        new Date(r.endDate) < today
      )
      .reduce((sum, r) => sum + r.daysUsed, 0);
  };

  /** 신청 일수 — 공용 모듈 (평일 기준, 반차 0.5, 경조사·기타 0) */
  const calculateRequestDays = calcRequestDays;

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.type === '기타' && !formData.reason.trim()) {
      alert('기타 유형은 상세 사유를 반드시 입력해야 합니다.');
      return;
    }
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
      .filter(r => r.startDate.slice(0, 7) === filterMonth || r.endDate.slice(0, 7) === filterMonth)
      .filter(r => r.employeeName.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  }, [leaveRequests, searchTerm, currentUser.id, filterMonth]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col pb-20">
      <PageHeader
        title="연차 신청 및 확인"
        subtitle="임직원 본인의 연차 사용 내역을 확인하고 신규 휴가를 신청하세요."
        right={<div className="flex items-center space-x-2 md:space-x-3">
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
            <button
              onClick={() => setActiveTab('orgchart')}
              className={`px-4 md:px-6 py-2 md:py-2.5 rounded-xl text-xs font-black transition-all whitespace-nowrap ${activeTab === 'orgchart' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
            >
              조직도·연락망
            </button>
          </div>
          {(activeTab === 'my' || activeTab === 'calendar') && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="bg-indigo-600 text-white px-4 md:px-6 py-2.5 rounded-xl font-black shadow-sm hover:bg-indigo-700 transition-all flex items-center space-x-2"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">신규 연차 신청</span>
            </button>
          )}
        </div>}
      />

      {activeTab === 'calendar' && (
        /* Calendar Section */
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-300">
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
      )}

      {activeTab === 'my' && (
        /* My Leave Tab Content */
        <div className="animate-in fade-in zoom-in-95 duration-300">
          {employees.filter(e => e.id === currentUser.id).map(emp => {
            const statutory = calculateStatutoryLeave(emp.joinDate);
            const carryOver = emp.annualLeave?.carryOverLeave || 0;
            const bonus = emp.annualLeave?.bonusLeave || 0;
            const total = statutory + carryOver + bonus;
            // 회사 단체 휴가 = '휴가' 유형 신청, 개인연차 = 그 외. 둘 다 승인분만.
            const mineApproved = leaveRequests.filter(r =>
              r.employeeId === emp.id && r.status === 'approved' && isDeductible(r));
            const usedVacation = mineApproved.filter(r => r.type === '휴가').reduce((s, r) => s + (r.daysUsed || 0), 0);
            const usedPersonal = mineApproved.filter(r => r.type !== '휴가').reduce((s, r) => s + (r.daysUsed || 0), 0);
            const totalUsed = usedVacation + usedPersonal;
            const remaining = total - totalUsed;
            const usagePercent = total > 0 ? (totalUsed / total) * 100 : 0;

            return (
              <div key={emp.id} className="flex flex-col lg:flex-row gap-4 md:gap-5 items-start">
                {/* 왼쪽: 연차 요약 카드 */}
                <div className="w-full lg:flex-[4] bg-white p-4 md:p-6 rounded-2xl border border-slate-200">
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
                    {/* 올해 연차 발생 여부 */}
                    {(() => {
                      const g = getAnnualGrantInfo(emp.joinDate);
                      if (g.underOneYear) return (
                        <p className="mt-2 pt-2 border-t border-slate-200 text-[10px] font-bold text-slate-400">
                          입사 1년 미만 — 매월 1일씩 월차가 생깁니다 (현재 {statutory}일)
                        </p>
                      );
                      return g.granted ? (
                        <p className="mt-2 pt-2 border-t border-slate-200 text-[10px] font-black text-emerald-600">
                          ✓ 올해 연차 {g.days}일 발생 완료 ({g.anniversary})
                        </p>
                      ) : (
                        <p className="mt-2 pt-2 border-t border-slate-200 text-[10px] font-black text-amber-600">
                          올해 연차 미발생 — {g.anniversary}에 {g.days}일 발생 예정
                          <span className="block font-bold text-slate-400 mt-0.5">그때까지는 이월분({carryOver}일)으로 사용합니다</span>
                        </p>
                      );
                    })()}
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

                  {/* 보건증 */}
                  {(() => {
                    if (!emp.healthCertDate) return (
                      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><CalendarCheck size={11} />보건증</p>
                        <span className="text-[10px] font-bold text-slate-300">미등록</span>
                      </div>
                    );
                    const issuedDate = new Date(emp.healthCertDate);
                    const expiry = new Date(issuedDate);
                    expiry.setFullYear(expiry.getFullYear() + 1);
                    const daysLeft = Math.ceil((expiry.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                    const isExpired = daysLeft <= 0;
                    const isWarning = daysLeft > 0 && daysLeft <= 30;
                    return (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1 mb-2"><CalendarCheck size={11} />보건증</p>
                        <div className={`rounded-xl p-3 flex items-center justify-between border ${isExpired ? 'bg-rose-50 border-rose-100' : isWarning ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100'}`}>
                          <div>
                            <p className="text-[10px] font-bold text-slate-500">발급 {emp.healthCertDate}</p>
                            <p className="text-[10px] font-bold text-slate-400">만료 {expiry.toISOString().slice(0, 10)}</p>
                          </div>
                          <span className={`text-sm font-black ${isExpired ? 'text-rose-600' : isWarning ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {isExpired ? '만료됨' : `D-${daysLeft}`}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* 오른쪽: 신청 내역 */}
                <div className="w-full lg:flex-[6] bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-4 md:px-6 py-3 md:py-4 border-b border-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h3 className="text-sm md:text-base font-black text-slate-800 flex items-center"><FileText className="mr-2 text-indigo-600 w-4 md:w-[18px] h-4 md:h-[18px]" />내 신청 내역</h3>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setFilterMonth(m => { const d = new Date(m + '-01'); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })} className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 text-sm font-bold">‹</button>
                      <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
                      <button onClick={() => setFilterMonth(m => { const d = new Date(m + '-01'); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 7); })} className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 text-sm font-bold">›</button>
                    </div>
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
                          <th className="px-3 md:px-5 py-2 md:py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">관리</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredRequests.length === 0 ? (
                          <tr><td colSpan={4} className="px-3 md:px-5 py-12 md:py-16 text-center text-slate-400 font-bold text-sm">신청 내역이 없습니다.</td></tr>
                        ) : filteredRequests.map(req => (
                          <tr key={req.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-3 md:px-5 py-2.5 md:py-3.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${req.type === '연차' ? 'bg-indigo-500 text-white' : req.type === '휴가' ? 'bg-sky-500 text-white' : 'bg-emerald-500 text-white'}`}>{req.type}</span>
                              <p className="text-xs text-slate-400 mt-0.5 italic leading-tight">&quot;{req.reason}&quot;</p>
                            </td>
                            <td className="px-3 md:px-5 py-2.5 md:py-3.5 text-xs font-bold text-slate-600 whitespace-nowrap">{req.startDate} ~ {req.endDate}</td>
                            <td className="px-3 md:px-5 py-2.5 md:py-3.5 text-center">
                              {req.status === 'pending' && <span className="bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full text-[10px] font-black">대기</span>}
                              {req.status === 'approved' && <span className="bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full text-[10px] font-black">승인</span>}
                              {req.status === 'cancel_pending' && <span className="bg-rose-100 text-rose-600 px-2.5 py-1 rounded-full text-[10px] font-black">취소 대기</span>}
                              {req.status === 'cancelled' && <span className="bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full text-[10px] font-black">취소됨</span>}
                              {req.status === 'rejected' && <span className="bg-rose-100 text-rose-700 px-2.5 py-1 rounded-full text-[10px] font-black">반려</span>}
                              {req.modifyRequest?.status === 'pending' && <p className="text-[9px] text-violet-500 font-bold mt-0.5">변경 대기중</p>}
                            </td>
                            <td className="px-3 md:px-5 py-2.5 md:py-3.5 text-center">
                              {req.status === 'approved' && (
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    onClick={() => { setModifyTarget(req); setModifyForm({ startDate: req.startDate, endDate: req.endDate, reason: req.reason }); }}
                                    className="text-[9px] font-black px-2 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 transition-all"
                                  >변경</button>
                                  <button
                                    onClick={() => onUpdateLeaveStatus(req.id, 'cancel_pending')}
                                    className="text-[9px] font-black px-2 py-1 rounded-lg bg-rose-100 text-rose-600 hover:bg-rose-200 transition-all"
                                  >취소</button>
                                </div>
                              )}
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

      {/* ── 조직도 탭 ── */}
      {activeTab === 'orgchart' && (
        <div className="animate-in fade-in zoom-in-95 duration-300 space-y-6">
          {/* 헤더 */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shadow-sm"><Network size={24} /></div>
              <div>
                <h3 className="text-xl font-black text-slate-800">조직도</h3>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">{effectiveOrg.departments.length}개 부서 · 재직 {activeEmployees.length}명</p>
              </div>
            </div>
            {isAdmin && !orgDraft && (
              <button onClick={() => setOrgDraft(JSON.parse(JSON.stringify(effectiveOrg)))} className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl text-xs font-black hover:bg-slate-800 transition-all"><Pencil size={14} />편집</button>
            )}
            {isAdmin && orgDraft && (
              <div className="flex items-center gap-2">
                <button onClick={() => setOrgDraft(null)} className="px-4 py-2.5 rounded-xl text-xs font-black text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all">취소</button>
                <button onClick={() => saveOrg(orgDraft)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-xs font-black hover:bg-indigo-700 transition-all"><Save size={14} />저장</button>
              </div>
            )}
          </div>

          {orgDraft ? (
            /* 편집 모드 */
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">대표 노드</p>
                <div className="grid grid-cols-2 gap-3">
                  <input value={orgDraft.top.title} onChange={e => setOrgDraft(d => d ? { ...d, top: { ...d.top, title: e.target.value } } : d)} placeholder="직함 (예: 대표이사)" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                  <input value={orgDraft.top.name} onChange={e => setOrgDraft(d => d ? { ...d, top: { ...d.top, name: e.target.value } } : d)} placeholder="이름" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              {orgDraft.departments.map((dept, idx) => {
                const members = membersOf(dept.keys);
                const color = DEPT_COLORS[idx % DEPT_COLORS.length];
                const orphanKeys = dept.keys.filter(k => !deptKeys.includes(k));
                return (
                  <div key={dept.id} className="rounded-2xl border border-slate-200 overflow-hidden">
                    <div className={`h-1.5 ${color.bar}`} />
                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-0.5">
                          <button onClick={() => moveDept(idx, -1)} disabled={idx === 0} className="w-6 h-5 flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowUp size={13} /></button>
                          <button onClick={() => moveDept(idx, 1)} disabled={idx === orgDraft.departments.length - 1} className="w-6 h-5 flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30"><ArrowDown size={13} /></button>
                        </div>
                        <input value={dept.name} onChange={e => patchDept(dept.id, { name: e.target.value })} placeholder="부서명" className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-black text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500" />
                        <button onClick={() => setOrgDraft(d => d ? { ...d, departments: d.departments.filter(x => x.id !== dept.id) } : d)} className="w-9 h-9 flex items-center justify-center rounded-xl text-rose-500 hover:bg-rose-50 transition-all"><Trash2 size={16} /></button>
                      </div>
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">구성원 부서 <span className="text-slate-300 normal-case tracking-normal">— 여러 개 선택 시 한 부서로 병합</span></span>
                        <div className="flex flex-wrap gap-1.5">
                          {deptKeys.map(k => {
                            const on = dept.keys.includes(k);
                            return <button key={k} type="button" onClick={() => toggleDeptKey(dept.id, k)} className={`px-2.5 py-1 rounded-lg text-[11px] font-black border transition-all ${on ? `${color.avatar} text-white border-transparent` : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>{k}</button>;
                          })}
                          {orphanKeys.map(k => (
                            <button key={k} type="button" onClick={() => toggleDeptKey(dept.id, k)} className="px-2.5 py-1 rounded-lg text-[11px] font-black border border-dashed border-slate-300 bg-slate-100 text-slate-500">{k} (없음)</button>
                          ))}
                          {deptKeys.length === 0 && <span className="text-[11px] text-slate-300 font-bold">등록된 부서가 없습니다</span>}
                        </div>
                      </div>
                      <label className="block space-y-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">부서장</span>
                        <select value={dept.headId ?? ''} onChange={e => patchDept(dept.id, { headId: e.target.value || undefined })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500">
                          <option value="">(지정 안 함)</option>
                          {members.map(m => <option key={m.id} value={m.id}>{m.name} {m.position}</option>)}
                        </select>
                      </label>
                      <input value={dept.memo ?? ''} onChange={e => patchDept(dept.id, { memo: e.target.value })} placeholder="부서 메모 (선택)" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                      <button type="button" onClick={() => toggleExec(dept.id)} className={`w-full py-2 rounded-xl text-[11px] font-black border transition-all flex items-center justify-center gap-1.5 ${dept.tier === 'exec' ? 'bg-amber-500 text-white border-transparent' : 'bg-white text-slate-400 border-slate-200 hover:border-amber-300'}`}><Crown size={13} className={dept.tier === 'exec' ? 'fill-white' : ''} />{dept.tier === 'exec' ? '임원 계층 — 대표 아래 개별 표시 중' : '임원 계층으로 표시(대표와 부서 사이)'}</button>
                      <p className="text-[10px] text-slate-400 font-bold">구성원 {members.length}명: {members.map(m => m.name).join(', ') || '없음'}</p>
                    </div>
                  </div>
                );
              })}
              <button onClick={() => setOrgDraft(d => d ? { ...d, departments: [...d.departments, { id: genId('dept'), keys: [], name: '새 부서', memo: '' }] } : d)} className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 font-black text-xs hover:border-indigo-300 hover:text-indigo-500 transition-all flex items-center justify-center gap-2"><Plus size={16} />부서 추가</button>
            </div>
          ) : (
            /* 보기 모드 — 트리형 (대표 → 임원 → 부서) */
            <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-8">
              {(() => {
                const hasTop = !!(effectiveOrg.top.name || effectiveOrg.top.title);
                const execDepts = effectiveOrg.departments.filter(d => d.tier === 'exec');
                const normalDepts = effectiveOrg.departments.filter(d => d.tier !== 'exec');
                const execs = execDepts.flatMap(d => membersOf(d.keys));
                if (!hasTop && execs.length === 0 && normalDepts.length === 0 && unassigned.length === 0)
                  return <p className="text-center text-slate-300 font-bold py-10">등록된 직원이 없습니다.</p>;
                const hasParentAboveDepts = hasTop || execs.length > 0;
                return (
                  <div className="overflow-x-auto pb-2">
                    <div className="inline-flex min-w-full flex-col items-center px-2">
                      {/* 대표 */}
                      {hasTop && (
                        <>
                          <div className="bg-gradient-to-br from-slate-900 to-slate-700 text-white rounded-2xl px-8 py-4 shadow-xl text-center min-w-[190px]">
                            <div className="flex items-center justify-center gap-1.5 mb-1"><Crown size={14} className="text-amber-300 fill-amber-300" /><span className="text-[10px] font-black uppercase tracking-widest text-slate-300">{effectiveOrg.top.title || '대표'}</span></div>
                            <p className="text-xl font-black">{effectiveOrg.top.name || '—'}</p>
                          </div>
                          {(execs.length > 0 || normalDepts.length > 0) && <div className="w-px h-7 bg-slate-200" />}
                        </>
                      )}
                      {/* 임원 계층 — 개별 카드, 옆으로 확장 */}
                      {execs.length > 0 && (
                        <>
                          <div className="flex flex-col items-center">
                            <span className="inline-flex items-center gap-1 text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-100 rounded-full px-2.5 py-0.5 mb-2 uppercase tracking-widest">임원</span>
                            <div className="flex items-start gap-3">
                              {execs.map(m => (
                                <div key={m.id} className="w-[150px] rounded-2xl border border-amber-200 bg-gradient-to-b from-amber-50 to-white shadow-sm px-3 py-3 text-center">
                                  <span className="w-10 h-10 rounded-xl bg-amber-500 text-white text-sm font-black flex items-center justify-center mx-auto mb-1.5">{m.name[0]}</span>
                                  <p className="text-sm font-black text-slate-800 truncate">{m.name}</p>
                                  <p className="text-[10px] font-bold text-amber-600">{m.position}</p>
                                  {m.phone && <a href={telHref(m.phone)} className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-black text-slate-500 hover:text-emerald-600 transition-colors"><Phone size={11} />{m.phone}</a>}
                                </div>
                              ))}
                            </div>
                          </div>
                          {normalDepts.length > 0 && <div className="w-px h-7 bg-slate-200" />}
                        </>
                      )}
                      {/* 부서 계층 */}
                      {normalDepts.length > 0 && (
                        <div className="flex items-start">
                          {normalDepts.map((dept, i) => {
                            const members = membersOf(dept.keys);
                            const head = dept.headId ? empById.get(dept.headId) : undefined;
                            const rest = members.filter(m => m.id !== dept.headId);
                            const color = DEPT_COLORS[i % DEPT_COLORS.length];
                            const single = normalDepts.length === 1;
                            const isFirst = i === 0;
                            const isLast = i === normalDepts.length - 1;
                            return (
                              <div key={dept.id} className="flex flex-col items-center px-1.5">
                                {hasParentAboveDepts && (
                                  <div className="relative h-7 w-full">
                                    {!single && <div className={`absolute top-0 h-px bg-slate-200 ${isFirst ? 'left-1/2 right-0' : isLast ? 'left-0 right-1/2' : 'left-0 right-0'}`} />}
                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-7 bg-slate-200" />
                                  </div>
                                )}
                                <div className="w-[230px] rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
                                  <div className={`h-1.5 ${color.bar}`} />
                                  <div className="px-4 py-3 border-b border-slate-50 flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0"><Building2 size={15} className={color.text} /><span className="font-black text-slate-800 text-sm truncate">{dept.name}</span></div>
                                    <span className={`text-[10px] font-black ${color.text} ${color.soft} rounded-full px-2 py-0.5 shrink-0`}>{members.length}명</span>
                                  </div>
                                  <div className="p-2.5 space-y-0.5">
                                    {members.length === 0 && <p className="text-[11px] text-slate-300 font-bold text-center py-3">구성원 없음</p>}
                                    {head && personRow(head, true, color)}
                                    {rest.map(m => personRow(m, false, color))}
                                    {dept.memo && <p className="text-[10px] text-slate-400 font-medium px-2 pt-2 mt-1 border-t border-slate-50">{dept.memo}</p>}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              {unassigned.length > 0 && (
                <div className="mt-6 rounded-2xl border border-dashed border-slate-200 p-4">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5">미배정 ({unassigned.length}명)</p>
                  <div className="flex flex-wrap gap-2">
                    {unassigned.map(m => (
                      <div key={m.id} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl pl-2 pr-1 py-1">
                        <span className="w-6 h-6 rounded-lg bg-slate-200 text-slate-500 text-[10px] font-black flex items-center justify-center">{m.name[0]}</span>
                        <span className="text-xs font-bold text-slate-600">{m.name} <span className="text-[10px] text-slate-400">{m.position}</span></span>
                        {m.phone && <a href={telHref(m.phone)} className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100"><Phone size={12} /></a>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== 직원 연락처 ===== */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 md:p-6 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3 md:space-x-4">
                <div className="w-11 h-11 md:w-12 md:h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shadow-sm"><PhoneCall size={22} /></div>
                <div>
                  <h3 className="text-lg md:text-xl font-black text-slate-800">직원 연락처</h3>
                  <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">재직 {activeEmployees.length}명 · 탭하면 전화</p>
                </div>
              </div>
              <div className="relative w-40 md:w-52">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                <input value={dirSearch} onChange={e => setDirSearch(e.target.value)} placeholder="이름·부서·직급 검색" className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
            </div>
            <div className="p-4 md:p-6">
              {(() => {
                const q = dirSearch.trim().toLowerCase();
                const filtered = activeEmployees.filter(e => !q || `${e.name} ${e.position} ${e.department} ${e.phone}`.toLowerCase().includes(q));
                if (filtered.length === 0) return <div className="text-center text-slate-300 font-bold text-sm py-8">검색 결과가 없습니다.</div>;
                // 조직도 표시명으로 그룹핑(생산관리팀+생산팀 = 한 그룹), 없으면 원래 부서명/미배정
                const labelOf = (e: Employee) => {
                  const d = effectiveOrg.departments.find(dp => dp.keys.includes(e.department));
                  return d ? d.name : (e.department || '미배정');
                };
                const groups = new Map<string, Employee[]>();
                for (const e of filtered) {
                  const key = labelOf(e);
                  if (!groups.has(key)) groups.set(key, []);
                  groups.get(key)!.push(e);
                }
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                    {Array.from(groups.entries()).map(([label, list]) => (
                      <div key={label}>
                        <div className="flex items-center gap-2 mb-2 px-1">
                          <Building2 size={13} className="text-slate-400" />
                          <span className="text-xs font-black text-slate-500">{label}</span>
                          <span className="text-[10px] font-bold text-slate-300">{list.length}</span>
                        </div>
                        <div className="rounded-2xl border border-slate-100 divide-y divide-slate-50 overflow-hidden">
                          {[...list].sort((a, b) => positionRank(b.position) - positionRank(a.position)).map(e => (
                            <div key={e.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition-colors">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 text-sm font-black flex items-center justify-center shrink-0">{e.name[0]}</span>
                                <div className="min-w-0">
                                  <p className="text-sm font-black text-slate-800 truncate">{e.name} <span className="text-[10px] font-bold text-slate-400">{e.position}</span></p>
                                  <p className="text-[11px] font-bold text-slate-400">{e.phone || '연락처 미등록'}</p>
                                </div>
                              </div>
                              {e.phone && <a href={telHref(e.phone)} className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100 transition-all shrink-0"><PhoneCall size={16} /></a>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* 변경 신청 모달 */}
      {modifyTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setModifyTarget(null)} />
          <div className="relative bg-white w-full max-w-md rounded-[32px] shadow-2xl flex flex-col">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">변경 신청</h3>
                <p className="text-[10px] text-slate-400 font-bold">{modifyTarget.type} · 기존: {modifyTarget.startDate} ~ {modifyTarget.endDate}</p>
              </div>
              <button onClick={() => setModifyTarget(null)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">변경 시작일</label>
                  <input type="date" value={modifyForm.startDate} onChange={(e) => setModifyForm(f => ({ ...f, startDate: e.target.value }))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">변경 종료일</label>
                  <input type="date" value={modifyForm.endDate} onChange={(e) => setModifyForm(f => ({ ...f, endDate: e.target.value }))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">변경 사유</label>
                <textarea rows={3} value={modifyForm.reason} onChange={(e) => setModifyForm(f => ({ ...f, reason: e.target.value }))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 resize-none" placeholder="변경 사유를 입력하세요." />
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 flex gap-3">
              <button onClick={() => setModifyTarget(null)} className="flex-1 py-3 rounded-2xl font-black text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all">취소</button>
              <button
                onClick={() => {
                  if (!modifyForm.startDate || !modifyForm.endDate || !modifyForm.reason.trim()) return;
                  const newDays = calculateRequestDays(modifyForm.startDate, modifyForm.endDate, modifyTarget.type);
                  const modifyRequest = { startDate: modifyForm.startDate, endDate: modifyForm.endDate, reason: modifyForm.reason, daysUsed: newDays, status: 'pending' as const };
                  onUpdateLeave(modifyTarget.id, { modifyRequest });
                  setModifyTarget(null);
                }}
                className="flex-[2] py-3 rounded-2xl font-black text-white bg-violet-600 hover:bg-violet-700 transition-all flex items-center justify-center gap-2"
              >
                <Check size={18} />변경 신청
              </button>
            </div>
          </div>
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
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                  상세 사유{formData.type === '기타' && <span className="ml-1 text-rose-500">*필수</span>}
                </label>
                <textarea
                  rows={4}
                  value={formData.reason}
                  onChange={(e) => setFormData({...formData, reason: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-3xl px-6 py-5 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  placeholder={formData.type === '기타' ? '기타 유형은 상세 사유를 반드시 입력해 주세요.' : '휴가 사유를 작성해 주세요.'}
                />
              </div>
              {selectedEmployeeId && (
                <div className={`p-5 rounded-3xl flex items-center space-x-2 font-black text-sm ${LEAVE_DEDUCTION[formData.type] === 0 ? 'bg-slate-50 border border-slate-100 text-slate-500' : 'bg-indigo-50 border border-indigo-100 text-indigo-700'}`}>
                  <Info size={18} />
                  {LEAVE_DEDUCTION[formData.type] === 0
                    ? <span>연차에서 차감되지 않습니다.</span>
                    : <span>총 {calculateRequestDays(formData.startDate, formData.endDate, formData.type)}일이 차감됩니다.</span>
                  }
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
