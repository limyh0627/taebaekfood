import {useDirectoryDelete,type DirectoryDeleteBindings} from '../src/shared/hooks/useDirectoryDelete';
import DirectoryDeleteDialogs from '../src/shared/components/DirectoryDeleteDialogs';
import {useEmployeeEditor} from '../src/features/hr/hooks/useEmployeeEditor';
import type {EmployeeEditReference} from '../src/shared/employeeEditCommand';
import type {EmployeeEditBindings} from '../src/features/hr/infrastructure/employeeEditWrites';
import {usePayrollDraft} from '../src/features/hr/hooks/usePayrollDraft';
import {useLeaveActions,type LeaveActionBindings} from '../src/features/hr/hooks/useLeaveActions';
import {LeaveActionRecovery} from './hr/LeaveApprovalList';
import {useLeaveApplication} from '../src/features/hr/hooks/useLeaveApplication';
import type {SaveOutcome} from '../src/shared/saveOutcome';
import type {PendingLeaveGroup} from '../src/features/hr/infrastructure/leaveRequestWrites';
import { previewHtmlPrint } from '../src/shared/htmlPrintOutput';
import { useOutputScope } from '../src/shared/hooks/useOutputScope';
import { EmployeeDirectory } from './hr/EmployeeDirectory';
import { LeaveApprovalRows } from './hr/LeaveApprovalList';
import ActionButton from '../src/shared/components/ActionButton';
import RetirementBenefitPanel from './hr/RetirementBenefitPanel';
import { readRetirement, retirementActor } from '../src/shared/services/retirementBenefitCommands';
import PayrollLineEditor from './hr/PayrollLineEditor';
import { defaultCashAccountId } from '../src/shared/defaultCashAccount';
import type { CashAccount } from '../src/shared/types';

import { appConfirm, appPrompt } from '../src/shared/components/appDialog';
import React, { useState, useMemo, useRef } from 'react';
//  이 파일엔 `const today = new Date()`(Date 객체)가 이미 있어 별칭으로 받는다
import { today as todayStr, dateOfLocal } from '../src/shared/day';
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
  Gift, 
  Lock, 
  Unlock,
  TrendingUp,
  ChevronRight,
  Wallet,
  Copy,
  Save,
  FileText,
} from 'lucide-react';
import { Employee, EmployeeStatus, LeaveRequest, LeaveStatus, LeaveType, Payroll, PayrollLine, CompanyId } from '../types';
import { payrollGross, payrollDeduct, payrollNet, payrollTotals, payrollDocId, companyOf, TAEBAEK } from '../types';
import PageHeader from './PageHeader';
import { subscribeToCollection } from '../src/shared/services/firebaseService';
import { where } from 'firebase/firestore';
import ModalShell from '../src/shared/components/ModalShell';
import LargeModalShell from '../src/shared/components/LargeModalShell';

// 연차 계산은 공용 모듈(src/shared/leave.ts) — 직원 앱과 같은 함수를 쓴다
import { isDeductible, calculateRequestDays as calcRequestDays, isUnderOneYear as isUnderOneYearShared, getAnnualGrantInfo as getGrantInfo, calculateLeaveBalance, canCancel } from '../src/shared/leave';

interface HRManagerProps extends LeaveActionBindings,EmployeeEditBindings,DirectoryDeleteBindings {
  requestScopeKey?:string;
  /** 지금 보고 있는 회사 — 명부·급여대장을 회사별로 가른다 */
  companyId?: CompanyId;
  cashAccounts?: CashAccount[];
  employees: Employee[];
  leaveRequests: LeaveRequest[];
  /** 회사 단체 휴가 일괄 등록 — 선택 직원별로 승인된 '휴가' 신청을 만든다(연차 차감) */
  onAddLeaveRequests?: (_reqs: LeaveRequest[]) => Promise<SaveOutcome> | SaveOutcome | void;
  onReadPendingLeaveGroups?:()=>PendingLeaveGroup[];
  onInspectLeaveRequest?:(id:string)=>Promise<SaveOutcome>;
  onCancelLeaveRequest?:(id:string)=>Promise<SaveOutcome>;
  onReadLeaveReferences?:()=>{planId:string;readable:boolean}[];
  onCancelLeaveReference?:(id:string)=>Promise<SaveOutcome>;

}

const HRManager: React.FC<HRManagerProps> = ({
  companyId = TAEBAEK, cashAccounts = [],requestScopeKey,
  employees: allEmployees,
  leaveRequests,
  onSaveEmployeeEdit,onReadPendingEmployeeEdits,onInspectEmployeeEdit,onCancelEmployeeEdit,onReadEmployeeEditReferences,onDiscardEmployeeEditCopy,
  onPrepareDirectoryDelete,onConfirmDirectoryDelete,onInspectDirectoryDelete,onCancelDirectoryDelete,onReadPendingDirectoryDeletes,onReadDirectoryDeleteReferences,
  onLeaveAction,onReadPendingLeaveActions,onInspectLeaveAction,onCancelLeaveAction,
  onAddLeaveRequests,onReadPendingLeaveGroups,onInspectLeaveRequest,onCancelLeaveRequest,onReadLeaveReferences,onCancelLeaveReference,
}) => {
  const actionScopeKey=companyId+':'+(requestScopeKey??'');
  const deletion=useDirectoryDelete({scopeKey:actionScopeKey,prepare:onPrepareDirectoryDelete,confirm:onConfirmDirectoryDelete,inspect:onInspectDirectoryDelete,cancel:onCancelDirectoryDelete,readPending:onReadPendingDirectoryDeletes,readReferences:onReadDirectoryDeleteReferences});
  const actionScope=useRef(actionScopeKey);actionScope.current=actionScopeKey;
  const actions=useLeaveActions({scopeKey:actionScopeKey,onAction:onLeaveAction,readPending:onReadPendingLeaveActions,inspect:onInspectLeaveAction,cancel:onCancelLeaveAction});
  const employeeEditor=useEmployeeEditor({scopeKey:actionScopeKey,onSave:onSaveEmployeeEdit,readPending:onReadPendingEmployeeEdits,inspect:onInspectEmployeeEdit,cancel:onCancelEmployeeEdit,readReferences:onReadEmployeeEditReferences,discardCopy:onDiscardEmployeeEditCopy});
  const {formData,changeProfile:setFormData}=employeeEditor;
  const employeeCopyButton=(reference:EmployeeEditReference,observed:string|null|undefined)=>{
    if(typeof observed!=='string')return null;
    return <button type="button" disabled={employeeEditor.busy} onClick={()=>void employeeEditor.discardCopy(reference,observed)} className="rounded border border-slate-200 px-3 py-2 text-xs">이 기기 사본 정리</button>;
  };
  React.useEffect(()=>setIsModalOpen(false),[actionScopeKey]);
  /*
   * 명부를 회사로 가른다 — 태백과 풍회는 별도 사업자라 급여도 4대보험도 각각 낸다.
   * 회사가 안 붙은 옛 기록은 태백으로 본다(companyOf). 관리자 계정(admin)은 어느 쪽에도 안 센다.
   */
  const employees = useMemo(
    () => allEmployees.filter(e => e.id === 'admin' || companyOf(e) === companyId),
    [allEmployees, companyId],
  );
  const [activeTab, setActiveTab] = useState<'employees' | 'leave-approval' | 'leave-balance' | 'payroll'>('employees');
  const [retirementEmployee, setRetirementEmployee] = useState<Employee | null>(null);
  React.useEffect(()=>setRetirementEmployee(null),[companyId,requestScopeKey]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  // 연차 상세 오버레이 — 직원 클릭 시 올해 신청·사용 내역 (월별 그룹, 클릭 시 펼침)
  const [leaveDetailEmp, setLeaveDetailEmp] = useState<Employee | null>(null);
  const [openLeaveMonths, setOpenLeaveMonths] = useState<Set<string>>(new Set());
  // 회사 단체 휴가 — 기본 전원 포함, 뺄 사람만 체크 해제
  const [showVacation, setShowVacation] = useState(false);
  React.useEffect(()=>setShowVacation(false),[companyId,requestScopeKey]);
  const [vacationExcluded, setVacationExcluded] = useState<Set<string>>(new Set());
  const [vacationRange, setVacationRange] = useState({ start: '', end: '' });
  const [vacationReason, setVacationReason] = useState('');
  const vacation=useLeaveApplication<PendingLeaveGroup>({scopeKey:companyId+':'+(requestScopeKey??''),submit:group=>onAddLeaveRequests?.(group.requests),inspect:onInspectLeaveRequest,cancel:onCancelLeaveRequest,readPending:onReadPendingLeaveGroups,readReferences:onReadLeaveReferences,cancelReference:onCancelLeaveReference});
  const closeVacation=()=>{if(vacation.close())setShowVacation(false);};
  const finishVacation=async(mode:'inspect'|'cancel')=>{const result=await vacation[mode]();if(result.committed)setShowVacation(false);};
  const openRetainedVacation=(group:PendingLeaveGroup)=>{vacation.reopen(group);setVacationRange({start:group.requests[0].startDate,end:group.requests[0].endDate});setVacationReason(group.requests[0].reason);setVacationDeducts(group.requests[0].deductsLeave!==false);setVacationExcluded(new Set(employees.filter(e=>!group.requests.some(r=>r.employeeId===e.id)).map(e=>e.id)));setShowVacation(true);};
  /** 단체 휴가가 연차를 차감하는가 — 창립기념일·명절 추가휴무는 미차감, 집단 연차소진은 차감 */
  const [vacationDeducts, setVacationDeducts] = useState(true);

  /** 단체 휴가 일수 — 신청과 같은 평일 기준(공용 모듈) */
  const countWeekdays = (start: string, end: string) =>
    (start && end) ? calcRequestDays(start, end, '휴가') : 0;

  // ── 급여대장 ──────────────────────────────────────────────────────────────
  // 재직자 명부에서 줄을 깔고 금액만 채운다. 저장은 월 단위 문서 하나(payrolls/pay-YYYY-MM).
  const thisYm = new Date().toISOString().slice(0, 7);
  const [payYm, setPayYm] = useState(thisYm);
  const [payrolls, setPayrolls] = useState<Array<Payroll & { revision?: number; issueOperationId?: string; issueExpectedRevision?: number }>>([]);
  React.useEffect(() => {
    // 권한 규칙은 목록을 걸러 주지 않는다. 서버 질의에 회사 조건이 없으면 관리자도 구독이 거부된다.
    setPayrolls([]);
    return subscribeToCollection<Payroll>('payrolls', setPayrolls, [where('companyId', '==', companyId)]);
  }, [companyId]);
  const payrollDraft=usePayrollDraft({companyId,actorUid:requestScopeKey??'',yearMonth:payYm,payrolls,employees});
  const {lines:payLines,payDate,busy:paySaving,message:payMsg,setCell,setPayDate}=payrollDraft;
  const [payBank,setPayBank]=useState('');
  const payBankOwner=useRef(actionScopeKey);
  React.useEffect(()=>{
    if(paySaving)return;
    const banks=cashAccounts.filter(a=>companyOf(a)===companyId&&a.active&&a.type==='통장');
    const ownerChanged=payBankOwner.current!==actionScopeKey;payBankOwner.current=actionScopeKey;
    setPayBank(current=>!ownerChanged&&banks.some(a=>a.id===current)?current:defaultCashAccountId(banks,companyId));
  },[cashAccounts,companyId,requestScopeKey,paySaving]);
  const [paySlipEmp, setPaySlipEmp] = useState<PayrollLine | null>(null);   // 명세서 미리보기
  const paySlipDocumentScope = React.useRef({companyId, yearMonth:payYm});
  const paySlipRef = React.useRef<HTMLDivElement>(null);
  const paySlipSignal = useOutputScope(companyId, JSON.stringify([activeTab,payYm,payDate,paySlipEmp?.employeeId]));
  const printPaySlip = () => {
    if (!paySlipRef.current || paySlipDocumentScope.current.companyId !== companyId || paySlipDocumentScope.current.yearMonth !== payYm) return;
    const signal = paySlipSignal(); if (signal.aborted) return;
    const heading = document.createElement('h1'); heading.textContent = `급여명세서 · ${paySlipEmp?.employeeName ?? ''}`;
    const styles = Array.from(document.querySelectorAll('style,link[rel="stylesheet"]')).map(node=>node.outerHTML).join('');
    void previewHtmlPrint({title:'급여명세서',signal,html:`<!DOCTYPE html><html><head><meta charset="utf-8"><title>급여명세서</title>${styles}<style>body{background:white;padding:24px;font-family:'Malgun Gothic',sans-serif;}@page{size:A4;margin:10mm;}</style></head><body>${heading.outerHTML}${paySlipRef.current.innerHTML}</body></html>`});
  };
  const won = (n: number) => (n || 0).toLocaleString('ko-KR');
  // 회사별로 문서가 따로다 — 남의 회사 대장을 덮어쓰면 안 된다
  const payDocId = payrollDocId(companyId, payYm);
  const savedPayroll = payrolls.find(p => p.id === payDocId) ?? null;

  const copyPrevMonth=payrollDraft.copyPreviousMonth;
  const payTotals=payrollTotals(payLines);
  const savePayroll=()=>payrollDraft.run();
  const makePayrollEntry=()=>payrollDraft.run('cash',payBank);
  const makePayrollAccrual=()=>payrollDraft.run('accrual');


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
    r.status === 'pending' || r.status === 'cancel_pending' || r.status === 'approved' && r.modifyRequest?.status === 'pending'
  );

  const closeEmployeeEditor=()=>{if(employeeEditor.closeProfile())setIsModalOpen(false);};
  const handleFormSubmit=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(await employeeEditor.submitProfile())setIsModalOpen(false);
  };

  return (
    <div className="min-w-0 max-w-full space-y-4 animate-in fade-in duration-300 h-full flex flex-col">
      {activeTab!=='leave-approval'&&<LeaveActionRecovery actions={actions}/>}
      {!isModalOpen&&employeeEditor.message&&<p role="status" className="whitespace-pre-line text-sm text-slate-600">{employeeEditor.message}</p>}
      {(employeeEditor.pending.length>0||employeeEditor.references.some(row=>!row.readable))&&<section aria-label="처리 결과 확인이 필요한 직원 저장" className="space-y-2 rounded-lg border border-slate-200 p-3">
        <h3 className="text-sm font-bold text-slate-700">처리 결과 확인이 필요한 직원 저장</h3>
        {employeeEditor.pending.map(row=><div key={row.planId} className="flex flex-wrap items-center gap-2 text-xs">
          <span>{row.description} · 대상 번호 {row.id}</span>
          <button type="button" disabled={employeeEditor.busy} onClick={()=>void employeeEditor.inspect(row.reference)} className="rounded border border-slate-200 px-3 py-2">결과 확인</button>
          <button type="button" disabled={employeeEditor.busy} onClick={()=>void employeeEditor.cancel(row.reference)} className="rounded border border-slate-200 px-3 py-2">요청 중단</button>
          {employeeCopyButton(row.reference,row.observedLocalText)}
        </div>)}
        {employeeEditor.references.filter(row=>!row.readable).map(row=><div key={row.key} className="flex flex-wrap items-center gap-2 text-xs">
          <span>원문 확인 필요 · {row.reference?'대상 번호 '+row.reference.targetId:'대상 번호를 읽지 못했습니다.'}</span>
          {row.reference&&<><button type="button" disabled={employeeEditor.busy} onClick={()=>void employeeEditor.inspect(row.reference!)} className="rounded border border-slate-200 px-3 py-2">결과 확인</button><button type="button" disabled={employeeEditor.busy} onClick={()=>void employeeEditor.cancel(row.reference!)} className="rounded border border-slate-200 px-3 py-2">요청 중단</button>{employeeCopyButton(row.reference!,row.observedLocalText)}</>}
        </div>)}
      </section>}
      <PageHeader
        title="인사 관리"
        subtitle="임직원 정보 관리부터 연차 승인, 잔여 일수 조정까지 통합 관리합니다."
        tabs={<div role="group" aria-label="인사 메뉴" className="flex w-full min-w-0 max-w-full shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap">
            <ActionButton
              onClick={() => setActiveTab('employees')}
              aria-pressed={activeTab === 'employees'}
              className={activeTab === 'employees' ? '!text-indigo-600 !border-indigo-200' : ''}
            >
              <Users size={14} /><span>임직원</span>
            </ActionButton>
            <ActionButton
              onClick={() => setActiveTab('leave-approval')}
              aria-pressed={activeTab === 'leave-approval'}
              className={activeTab === 'leave-approval' ? '!text-indigo-600 !border-indigo-200' : ''}
            >
              <ClipboardCheck size={14} /><span>승인 대기</span>
              {pendingRequests.length > 0 && <span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] text-white">{pendingRequests.length}</span>}
            </ActionButton>
            <ActionButton
              onClick={() => setActiveTab('leave-balance')}
              aria-pressed={activeTab === 'leave-balance'}
              className={activeTab === 'leave-balance' ? '!text-indigo-600 !border-indigo-200' : ''}
            >
              <Settings2 size={14} /><span>연차 관리</span>
            </ActionButton>
            <ActionButton
              onClick={() => setActiveTab('payroll')}
              aria-pressed={activeTab === 'payroll'}
              className={activeTab === 'payroll' ? '!text-indigo-600 !border-indigo-200' : ''}
            >
              <Wallet size={14} /><span>급여대장</span>
            </ActionButton>
          </div>}
        actions={(activeTab === 'employees' || activeTab === 'leave-balance') ? <>
          {activeTab === 'employees' && (
            <ActionButton
              onClick={() => {
                if(employeeEditor.openCreate())setIsModalOpen(true);
              }}
              tone="primary"
            >
              <Plus size={15} /><span>직원 등록</span>
            </ActionButton>
          )}
          {activeTab === 'leave-balance' && (
            <>
              <ActionButton
                onClick={() => setIsEditMode(!isEditMode)}
                tone="primary"
              >
                {isEditMode ? <Lock size={14} /> : <Unlock size={14} />}
                <span>{isEditMode ? '편집 종료' : '연차 편집'}</span>
              </ActionButton>
              <ActionButton
                onClick={() => {
                  if(vacation.pending){openRetainedVacation(vacation.pending);return;}
                  setVacationExcluded(new Set());
                  setVacationRange({ start: today.toISOString().slice(0, 10), end: today.toISOString().slice(0, 10) });
                  setVacationReason('');
                  setVacationDeducts(true);
                  setShowVacation(true);
                }}
                tone="primary"
              >
                <CalendarCheck size={14} /><span>휴가</span>
              </ActionButton>
            </>
          )}
          </> : undefined}
      />

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-white rounded-2xl border border-slate-200">
        {activeTab === 'employees' && (
          <EmployeeDirectory filteredEmployees={filteredEmployees} searchTerm={searchTerm} onSearchChange={setSearchTerm}
            calculateWorkDays={calculateWorkDays} getHealthCertStatus={getHealthCertStatus} onRetirement={setRetirementEmployee}
            onEdit={(emp) => {if(employeeEditor.openProfile(emp))setIsModalOpen(true);}} onDelete={emp=>void deletion.open({kind:'employee',targetId:emp.id,opening:{...emp}})} />
        )}

        {activeTab === 'leave-approval' && (
          <LeaveApprovalRows pendingRequests={pendingRequests} actions={actions} />
        )}

        {activeTab === 'leave-balance' && (
          <div className="flex-1 overflow-auto custom-scrollbar">
            <table className="w-full text-left min-w-[640px]">
              <thead className="bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">임직원</th>
                  <th className="px-4 py-4 text-[10px] font-black text-emerald-400 uppercase tracking-widest text-center whitespace-nowrap">월차</th>
                  <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">
                    <span className="block">연차</span>
                    <span className="text-[10px] font-bold text-slate-300 normal-case tracking-normal">입사일 기준</span>
                  </th>
                  <th className="px-5 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center bg-indigo-50/30 whitespace-nowrap">보너스 (+)</th>
                  <th className="px-5 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">이월 (+)</th>
                  <th className="px-5 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center text-rose-500 whitespace-nowrap">
                    <span className="block">사용 개수</span>
                    <span className="text-[10px] font-bold text-slate-300 normal-case tracking-normal">총 / 당월</span>
                  </th>
                  <th className="px-5 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right whitespace-nowrap">최종 잔여</th>
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
                      <td className="px-5 py-6 whitespace-nowrap">
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
                      <td className="px-4 py-6 text-center whitespace-nowrap">
                        {monthlyLeave > 0 ? (
                          <div className="flex flex-col items-center">
                            <span className="text-sm font-bold text-emerald-600">{monthlyLeave}</span>
                            <span className="text-[10px] font-bold text-emerald-300 uppercase">올해</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-200">-</span>
                        )}
                      </td>
                      {/* 연차 — 입사 응당일에 발생. 발생 전이면 0이고 잔여에도 안 더해진다 */}
                      <td className="px-4 py-6 text-center whitespace-nowrap">
                        {(() => {
                          const g = getAnnualGrantInfo(emp.joinDate);
                          if (underOneYear) return (
                            <div className="flex flex-col items-center">
                              <span className="text-sm font-bold text-slate-300">0</span>
                              <span className="text-[10px] font-bold text-slate-300 uppercase">1년 미만</span>
                            </div>
                          );
                          return g.granted ? (
                            <div className="flex flex-col items-center">
                              <span className="text-sm font-bold text-slate-600">{annualLeave}</span>
                              <span className="text-[10px] font-black text-emerald-500">✓ {g.dateStr} 발생</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center" title={`${g.dateStr}에 ${g.pendingDays}일 발생 예정 — 그때까지는 이월분으로만 사용`}>
                              <span className="text-sm font-bold text-slate-300">0</span>
                              <span className="text-[10px] font-black text-amber-500">{g.dateStr} 예정 ({g.pendingDays})</span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-5 py-6 text-center bg-indigo-50/20 whitespace-nowrap">
                        {isEditMode ? (
                          <div className="flex justify-center items-center">
                            <input 
                              type="number" step="0.5"
                              value={employeeEditor.balanceFor(emp).bonusLeave}
                              disabled={employeeEditor.busy||employeeEditor.balanceLocked(emp.id)}
                              onChange={(e) => employeeEditor.changeBalance(emp,'bonusLeave',e.target.value)}
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
                      <td className="px-5 py-6 text-center whitespace-nowrap">
                        {isEditMode ? (
                          <input 
                            type="number" step="0.5"
                            value={employeeEditor.balanceFor(emp).carryOverLeave}
                            disabled={employeeEditor.busy||employeeEditor.balanceLocked(emp.id)}
                            onChange={(e) => employeeEditor.changeBalance(emp,'carryOverLeave',e.target.value)}
                            className="w-16 text-center bg-white border border-slate-200 rounded-lg py-1.5 text-sm font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                          />

                        ) : (
                          <span className="text-sm font-black text-slate-400">{emp.annualLeave?.carryOverLeave || 0}</span>
                        )}
                      {employeeEditor.hasBalanceDraft(emp.id)&&<div className="mt-2 flex justify-center gap-2">
                            <button type="button" disabled={employeeEditor.balanceLocked(emp.id)} onClick={()=>void employeeEditor.submitBalance(emp.id)} className="rounded border border-slate-200 px-2 py-1 text-xs">연차 저장</button>
                            <button type="button" disabled={!employeeEditor.canResetBalance(emp.id)} onClick={()=>employeeEditor.resetBalance(emp.id)} className="rounded border border-slate-200 px-2 py-1 text-xs">되돌리기</button>
                          </div>}
                      </td>
                      {/* 사용 개수 — 총 / 당월 */}
                      <td className="px-5 py-6 text-center whitespace-nowrap">
                        <div className="flex flex-col items-center">
                          <div className="flex items-baseline gap-1">
                            <span className="text-sm font-black text-rose-500">{totalUsedCount}</span>
                            <span className="text-[10px] font-bold text-slate-300">/</span>
                            <span className={`text-sm font-black ${bal.usedThisMonth > 0 ? 'text-amber-500' : 'text-slate-300'}`}>{bal.usedThisMonth}</span>
                          </div>
                          <span className="text-[10px] font-bold text-slate-300 uppercase tracking-tighter">총 / 당월</span>
                          {/*  승인만 되고 아직 안 온 휴가 — 사용에 섞으면 안 쉬었는데 쓴 것으로 보인다.
                               그래도 잔여에서는 빼고 있으니 여기 적어 둬야 숫자가 안 맞아 보이지 않는다. */}
                          {bal.scheduled > 0 && (
                            <span className="text-[10px] font-black text-violet-400 mt-0.5" title="승인됐지만 아직 안 온 휴가 — 잔여에는 아직 포함돼 있습니다">
                              예정 {bal.scheduled}일
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-6 text-right">
                        <div className="flex flex-col items-end">
                          <span className={`text-xl font-black ${remaining < 0 ? 'text-rose-600' : 'text-indigo-600'}`}>
                            {remaining}
                            <span className="text-xs ml-0.5">일</span>
                          </span>
                          <div className="flex items-center text-[10px] font-black text-slate-300 uppercase tracking-tighter">
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
              <input type="month" aria-label="급여 월" disabled={paySaving} value={payYm} onChange={e => setPayYm(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-xs font-black outline-none focus:ring-2 focus:ring-violet-300" />
              <label className="flex items-center gap-1.5 text-[11px] font-black text-slate-400">
                지급일
                <input type="date" disabled={paySaving} value={payDate} onChange={e => setPayDate(e.target.value)}
                  className="border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-violet-300" />
              </label>
              <label>지급 계좌<select disabled={paySaving} aria-label="급여 지급 계좌" value={payBank} onChange={e => setPayBank(e.target.value)}>
                {cashAccounts.filter(a => companyOf(a) === companyId && a.active && a.type === '통장').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></label>
              <button disabled={paySaving} onClick={copyPrevMonth}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-white border border-slate-200 text-slate-500 hover:border-violet-300 hover:text-violet-600 transition-all">
                <Copy size={13} />지난달 복사
              </button>
              <div className="ml-auto flex items-center gap-2">
                {payrollDraft.conflict&&<button type="button" disabled={paySaving} onClick={payrollDraft.reload} className="rounded border border-slate-200 px-3 py-2 text-xs">최신 급여 불러오기</button>}
                {payMsg && <span className="text-[11px] font-black text-violet-600">{payMsg}</span>}
                {savedPayroll?.cashEntryId && (
                  <span className="text-[10px] font-black px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">전표 생성됨</span>
                )}
                <button onClick={savePayroll} disabled={paySaving}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-white border border-slate-200 text-slate-600 hover:border-slate-300 disabled:opacity-40 transition-all">
                  <Save size={13} />저장
                </button>
                {/* 두 갈래 — **언제 비용으로 잡느냐**가 다르다.
                    발생: 그 달 비용으로 세우고 지급은 나중에(대체전표). 급여를 다음 달에 주면 이쪽.
                    지급: 그날 통장에서 바로 나감(자금전표). 그날 바로 주면 이쪽. */}
                <button onClick={makePayrollAccrual} disabled={paySaving}
                  title="그 달 말일에 비용으로 세운다 — 통장은 안 움직인다"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-indigo-600 text-white hover:bg-violet-500 disabled:opacity-40 transition-all">
                  <FileText size={13} />발생 전표
                </button>
                <button onClick={makePayrollEntry} disabled={paySaving || !payBank}
                  title="지급일에 통장에서 바로 나간다 — 그날 바로 줄 때만"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black bg-white border border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-600 disabled:opacity-40 transition-all">
                  <Wallet size={13} />지급 전표
                </button>
              </div>
            </div>

            {payLines.length === 0 ? (
              <p className="py-16 text-center text-xs font-bold text-slate-300">재직 중인 임직원이 없습니다</p>
            ) : (
              <PayrollLineEditor disabled={paySaving} lines={payLines} onCell={setCell} onPrint={line => { paySlipDocumentScope.current={companyId,yearMonth:payYm}; setPaySlipEmp(line); }} />
            )}

            <div className="p-4 space-y-2">
              <div className="grid md:grid-cols-2 gap-2">
                <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
                  <p className="text-[10px] font-black text-violet-500 uppercase tracking-widest mb-2">발생 전표 · 대체</p>
                  <div className="text-xs font-bold text-slate-600 space-y-0.5 tabular-nums">
                    <p>(차) 515 급여 <span className="text-slate-800">{won(payTotals.gross)}</span></p>
                    <p className="pl-6">(대) 254 예수금 <span className="text-slate-800">{won(payTotals.deduct)}</span></p>
                    <p className="pl-6">(대) 263 미지급급여 <span className="text-slate-800">{won(payTotals.net)}</span></p>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">
                    <b>그 달 말일</b>에 비용으로 세웁니다. 통장은 안 움직입니다.
                    실제로 줄 때 <b>일반전표 → 출금 → 263 미지급급여</b>로 실지급액만 끊으면 됩니다 —
                    지급일이 사람마다 달라도 나가는 대로 쪼개 끊으면 잔액이 맞습니다.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">지급 전표 · 자금</p>
                  <div className="text-xs font-bold text-slate-600 space-y-0.5 tabular-nums">
                    <p>(차) 515 급여 <span className="text-slate-800">{won(payTotals.gross)}</span></p>
                    <p className="pl-6">(대) 254 예수금 <span className="text-slate-800">{won(payTotals.deduct)}</span></p>
                    <p className="pl-6">(대) 103 보통예금 <span className="text-slate-800">{won(payTotals.net)}</span></p>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2">
                    지급일에 통장에서 바로 나갑니다. <b>그날 바로 주는 달에만</b> 쓰세요 —
                    다음 달에 주는데 이걸 쓰면 비용이 한 달 밀립니다.
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 px-1">
                어느 쪽이든 공제분은 <b>254 예수금(부채)</b>으로 남았다가, 다음 달 원천세·4대보험을 낼 때
                <b> 일반전표 → 출금 → 254 예수금</b>으로 털어야 사라집니다.
              </p>
              <p className="text-[11px] text-slate-400 px-1">
                4대보험 요율은 해마다 바뀌므로 자동계산하지 않습니다 — <b>고지서 금액을 그대로 입력</b>하세요.
                임금명세서 교부는 법적 의무이니, 줄 끝 인쇄 버튼으로 사원별 명세서를 뽑아 주세요.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 급여명세서 — 사원 한 명분. 근로기준법상 교부 의무 항목(지급·공제 내역)을 담는다. */}
      {paySlipEmp && paySlipDocumentScope.current.companyId === companyId && paySlipDocumentScope.current.yearMonth === payYm && (
        <ModalShell title={`급여명세서 · ${paySlipEmp.employeeName}`} onClose={() => setPaySlipEmp(null)}>
            <div ref={paySlipRef}>
            <p className="mb-4 text-[11px] font-bold text-slate-400">
              {paySlipEmp.department} {paySlipEmp.position} · {payYm} · 지급일 {payDate}
            </p>
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
            </div>
            <button onClick={printPaySlip}
              className="mt-4 w-full py-2.5 rounded-xl bg-slate-800 text-white text-xs font-black hover:bg-slate-900 transition-all">
              인쇄
            </button>
        </ModalShell>
      )}

      {/* Employee Add/Edit Modal */}
      {isModalOpen && employeeEditor.profileSession && (
        <ModalShell title={employeeEditor.profileSession.isNew?'신규 직원 등록':'정보 수정'} onClose={closeEmployeeEditor} bodyClassName="!p-0">
            <form onSubmit={handleFormSubmit} className="p-5 space-y-5">
              <fieldset disabled={employeeEditor.busy||employeeEditor.profileLocked} className="contents">
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
                      <input type="number" step="0.5" value={formData.annualLeave.carryOverLeave} onChange={(e) => employeeEditor.changeProfileBalance('carryOverLeave',e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">보너스 연차</label>
                      <p className="text-[10px] text-slate-300">포상·특별 부여 연차</p>
                      <input type="number" step="0.5" value={formData.annualLeave.bonusLeave} onChange={(e) => employeeEditor.changeProfileBalance('bonusLeave',e.target.value)} className="w-full bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-sm font-bold outline-none text-emerald-700 focus:border-emerald-400" />
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
              </fieldset>
              {employeeEditor.message&&(employeeEditor.messageTargetId===null||employeeEditor.messageTargetId===employeeEditor.profileSession?.targetId)&&<p role="status" className="whitespace-pre-line text-xs text-slate-600">{employeeEditor.message}</p>}
              {employeeEditor.references.filter(row=>row.reference?.targetId===employeeEditor.profileSession?.targetId).map(row=><div key={row.key} className="flex gap-2">
                <button type="button" disabled={employeeEditor.busy} onClick={()=>void employeeEditor.inspect(row.reference!)} className="rounded border border-slate-200 px-3 py-2 text-xs">결과 확인</button>
                <button type="button" disabled={employeeEditor.busy} onClick={()=>void employeeEditor.cancel(row.reference!)} className="rounded border border-slate-200 px-3 py-2 text-xs">요청 중단</button>
                {employeeCopyButton(row.reference!,row.observedLocalText)}
              </div>)}
              <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex space-x-3 mt-4">
                <button type="button" disabled={employeeEditor.busy} onClick={closeEmployeeEditor} className="flex-1 py-4 rounded-2xl font-bold text-slate-500 bg-white border border-slate-200">취소</button>
                <button type="submit" disabled={employeeEditor.busy||employeeEditor.profileLocked} className="flex-1 py-4 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-100 flex items-center justify-center space-x-2"><Check size={20} /><span>저장 완료</span></button>
              </div>
            </form>
        </ModalShell>
      )}
      {/* ── 회사 단체 휴가 일괄 등록 ── */}
      {!showVacation&&vacation.message&&<p role="status" className="text-xs whitespace-pre-line">{vacation.message}</p>}
      {vacation.damagedReferences.map(planId=><p key={planId} className="text-xs">보관된 휴가 원문을 읽을 수 없습니다. <button type="button" disabled={vacation.busy} onClick={()=>vacation.cancelDamaged(planId)} className="underline">손상된 요청 중단 확인</button></p>)}
      {!showVacation&&vacation.pendingRequests.map(group=><button key={group.id} type="button" className="text-xs underline" onClick={()=>openRetainedVacation(group)}>보관된 단체 휴가 확인 · {group.requests.length}명</button>)}
      {showVacation && (() => {
        const targets = employees.filter(e => companyOf(e)===companyId&&!vacationExcluded.has(e.id));
        const days = countWeekdays(vacationRange.start, vacationRange.end);
        const canSave = targets.length > 0 && days > 0 && !!vacationRange.start && !!vacationRange.end && !vacation.busy && !vacation.pending;

        const submit = async () => {
          if (!canSave || !onAddLeaveRequests) return;

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
            const result=await vacation.submit({id:reqs[0].id,requests:reqs});
            if(result.committed)setShowVacation(false);
          } catch (e) {
            alert(`휴가 등록 실패: ${(e as Error)?.message ?? String(e)}`);
          }
        };

        return (
          <ModalShell title="회사 단체 휴가" onClose={closeVacation} bodyClassName="!p-0">
            {vacation.message&&<p role="alert" className="px-5 pt-4 text-xs whitespace-pre-line">{vacation.message}</p>}
            <fieldset disabled={vacation.busy||!!vacation.pending} className="contents">
                  <p className="px-5 pt-4 text-xs text-slate-400 font-bold">
                    선택된 직원에게 &apos;휴가&apos;로 기록됩니다. <b className={vacationDeducts ? 'text-rose-500' : 'text-slate-500'}>
                    {vacationDeducts ? '연차에서 차감' : '연차 차감 없음'}</b> — 직원 앱 연차 내역에도 그대로 표시됩니다.
                  </p>

              {/* 기간 */}
              <div className="px-5 py-4 border-b border-slate-100 flex items-end gap-3 flex-wrap">
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
              <div className="px-5 pb-1">
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">연차 차감</label>
                <div className="flex bg-slate-100 rounded-xl p-0.5 gap-0.5 max-w-md">
                  <button type="button" onClick={() => setVacationDeducts(true)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-black transition-all ${vacationDeducts ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
                    차감 <span className="font-bold opacity-70">· 집단 연차소진</span>
                  </button>
                  <button type="button" onClick={() => setVacationDeducts(false)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-black transition-all ${!vacationDeducts ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
                    미차감 <span className="font-bold opacity-70">· 창립일·명절 등</span>
                  </button>
                </div>
              </div>
              <p className="px-5 pt-2 text-[10px] text-slate-400">주말은 빼고 셉니다. 공휴일은 자동 제외되지 않으니 필요하면 기간을 나눠 등록하세요.</p>

              {/* 대상 직원 — 기본 전원 포함, 뺄 사람 클릭 */}
              <div className="px-5 py-3 flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">대상 {targets.length} / {employees.length}명</span>
                <button onClick={() => setVacationExcluded(new Set())} className="text-[10px] font-black text-indigo-500 hover:underline">전체 선택</button>
                <button onClick={() => setVacationExcluded(new Set(employees.map(e => e.id)))} className="text-[10px] font-black text-slate-400 hover:underline">전체 해제</button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-4">
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

</fieldset>
              <div className="px-5 py-4 border-t border-slate-100 flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-bold text-slate-400 flex-1">
                  {targets.length}명 × {days}일 {vacationDeducts ? '연차 차감' : '휴무(연차 미차감)'}
                </p>
                <button onClick={closeVacation} className="px-5 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-xs font-black hover:bg-slate-200">취소</button>
                {vacation.pending&&<><button type="button" disabled={vacation.busy||!onInspectLeaveRequest} onClick={()=>finishVacation('inspect')} className="text-xs underline">저장 결과 확인</button><button type="button" disabled={vacation.busy||!onCancelLeaveRequest} onClick={()=>finishVacation('cancel')} className="text-xs underline">요청 중단</button></>}
                <button onClick={submit} disabled={!canSave}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 disabled:opacity-30">
                  {vacation.busy ? '등록 중…' : '휴가 등록'}
                </button>
              </div>
          </ModalShell>
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
          <LargeModalShell title={`${emp.name} 연차 상세`} onClose={() => setLeaveDetailEmp(null)} bodyClassName="!p-0">
                  <p className="px-5 pt-4 text-xs text-slate-400 font-bold">
                    {emp.department} · {emp.position} · 입사 {emp.joinDate}
                    {underOneYear && <span className="ml-1.5 text-[10px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">1년 미만</span>}
                  </p>

              {/* 요약 */}
              <div className="px-5 py-4 grid grid-cols-3 gap-3 border-b border-slate-100">
                <div className="bg-slate-50 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase">총 부여</p>
                  <p className="text-xl font-black text-slate-800 tabular-nums">{totalUsable}<span className="text-xs ml-0.5 text-slate-400">일</span></p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {monthlyLeave > 0 && `월차 ${monthlyLeave}`}
                    {monthlyLeave > 0 && annualLeave > 0 && ' + '}
                    {annualLeave > 0 && `연차 ${annualLeave}`}
                    {(emp.annualLeave?.carryOverLeave || 0) > 0 && ` +이월 ${emp.annualLeave?.carryOverLeave}`}
                    {(emp.annualLeave?.bonusLeave || 0) > 0 && ` +보너스 ${emp.annualLeave?.bonusLeave}`}
                  </p>
                  {(() => {
                    const g = getAnnualGrantInfo(emp.joinDate);
                    if (underOneYear || g.granted) return null;
                    return <p className="text-[10px] font-black text-amber-500 mt-1">연차 {g.dateStr} 발생 예정 ({g.pendingDays}일) — 아직 미포함</p>;
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
                  <p className="text-[10px] text-rose-400 mt-0.5">승인 {deductible.length}건</p>
                  {bal.scheduled > 0 && (
                    <p className="text-[10px] font-black text-violet-500 mt-0.5" title="승인됐지만 아직 안 온 휴가 — 잔여에는 아직 포함돼 있습니다">
                      예정 {bal.scheduled}일 (아직 안 옴)
                    </p>
                  )}
                </div>
                <div className="bg-indigo-600 rounded-2xl px-4 py-3">
                  <p className="text-[10px] font-black text-indigo-200 uppercase">잔여</p>
                  <p className="text-xl font-black text-white tabular-nums">{remaining}<span className="text-xs ml-0.5 text-indigo-200">일</span></p>
                  {bal.scheduled > 0 && (
                    <p className="text-[10px] font-black text-indigo-200 mt-0.5" title="예정된 휴가까지 빼면 앞으로 쓸 수 있는 날">
                      예정 빼면 {bal.remaining - bal.scheduled}일
                    </p>
                  )}
                  {pendingMine.length > 0 && <p className="text-[10px] text-indigo-200 mt-0.5">대기 {pendingMine.length}건</p>}
                </div>
              </div>

              {/* 월별 내역 — 헤더 클릭 시 펼침 */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
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
                                          <span className={`text-[10px] font-black px-2 py-0.5 rounded ${r.type === '연차' ? 'bg-indigo-600 text-white' : r.type === '휴가' ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'}`}>{r.type}</span>
                                          <span className={`text-[10px] font-black px-2 py-0.5 rounded ${st.cls}`}>{st.text}</span>
                                          {nonDeduct && <span className="text-[10px] font-black px-2 py-0.5 rounded bg-slate-100 text-slate-500">미차감</span>}
                                          {['approved','cancel_pending'].includes(r.status) && r.modifyRequest?.status === 'pending' && <span className="text-[10px] font-black px-2 py-0.5 rounded bg-violet-100 text-violet-700">수정 요청</span>}
                                        </div>
                                        <p className="text-sm font-black text-slate-800 mt-1.5">
                                          {r.startDate}{r.endDate && r.endDate !== r.startDate ? ` ~ ${r.endDate}` : ''}
                                        </p>
                                        {r.reason && <p className="text-[11px] text-slate-400 mt-0.5 break-words">{r.reason}</p>}
                                        <p className="text-[10px] text-slate-300 mt-1">신청 {dateOfLocal(r.requestedAt)}</p>
                                        {r.status === 'cancelled' && (r.cancelledAt || r.cancelReason) && (
                                          <p className="text-[10px] text-rose-400 font-bold mt-0.5">
                                            취소 {dateOfLocal(r.cancelledAt)}
                                            {r.cancelledByName ? ` · ${r.cancelledByName}` : ''}
                                            {r.cancelReason ? ` · "${r.cancelReason}"` : ''}
                                          </p>
                                        )}
                                      </div>
                                      <div className="text-right shrink-0">
                                        <p className={`text-lg font-black tabular-nums ${r.status === 'approved' && !nonDeduct ? 'text-rose-600' : 'text-slate-300'}`}>
                                          {r.daysUsed}<span className="text-xs ml-0.5">일</span>
                                        </p>
                                        {/*  **관리자가 바로 무를 수 있다**(2026-09-04 사장님).
                                             전에는 직원이 취소를 신청해야만 관리자가 승인할 수 있어서,
                                             사장님이 남의 연차를 무를 길이 없었다(이지영 09-04 는 스크립트로 지웠다). */}
                                        {canCancel(r) && (
                                          <button
                                            disabled={actions.busy||actions.pendingActions.some(entry=>entry.id===r.id)}
                                            onClick={async () => {
                                              const scope=actionScope.current;
                                              const why = await appPrompt({
                                                title: '연차 취소',
                                                message: `${r.employeeName} ${r.startDate} 연차를 취소합니다.\n사유를 입력해 주세요. (선택)`,
                                                defaultValue: '',
                                              });
                                              if (why === null || actionScope.current!==scope) return;
                                              await actions.run(r,{action:'cancel',reason:why});
                                            }}
                                            className="mt-1 text-[9px] font-black px-2 py-1 rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100 transition-all"
                                          >취소</button>
                                        )}
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
          </LargeModalShell>
        );
      })()}

      {retirementEmployee && companyOf(retirementEmployee) === companyId && <RetirementBenefitPanel companyId={companyId} employee={retirementEmployee} onClose={() => setRetirementEmployee(null)} />}
      <DirectoryDeleteDialogs controller={deletion}/>
    </div>
  );
};

export default HRManager;
