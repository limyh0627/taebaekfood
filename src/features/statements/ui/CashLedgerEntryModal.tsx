import type { Props } from '../domain/cashLedger';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isCalendarDay, today } from '../../../shared/day';
import { CashAccount, CashEntry, AccountCode, Partner, FixedCostTemplate, CompanyId, companyOf } from '../../../shared/types';
import { useLoanContracts } from '../../../shared/useLoanContracts';
import { CashTemplateModal, filterTemplates, activeTemplate, isCashDir, splitModeOf, SPLIT_MODES, CashTemplate } from '../../../shared/cashTemplates';
import { journalizeCashEntry } from '../../../shared/autoJournal';
import { stampFor } from '../../../shared/voucherStamp';
import VoucherSlip from '../../../shared/VoucherSlip';
import { splitCashEntry, payrollEntries } from '../../../shared/splitEntry';
import { STANDARD_ACCOUNT } from '../../../shared/accountChart';
import ModalShell from '../../../shared/components/ModalShell';
import { changeMoneyInput, formatMoneyInput, parseMoneyInput } from '../../../shared/moneyInput';
import { defaultCashAccountId } from '../../../shared/defaultCashAccount';
import { projectCashLines } from '../../../../functions/src/shared/cashLineProjection';
import { auth, authReady } from '../../../shared/firebase';
import { fmt } from './cashEntryDisplay';

// ── 입출금 기록 모달 ──────────────────────────────────────────────────────────
type EntryAttempt = { companyId: CompanyId; userId: string; entries: CashEntry[] };

function readEntryAttempt(key: string, companyId: CompanyId, userId: string): { attempt: EntryAttempt | null; error: string } {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return { attempt: null, error: '' };
    const value = JSON.parse(stored) as EntryAttempt;
    const fields = ['id', 'companyId', 'dir', 'amount', 'accountCode', 'lines', 'note', 'date', 'cashAccountId', 'createdAt', 'createdBy', 'partnerId', 'partnerName'];
    if (!value || value.companyId !== companyId || value.userId !== userId || !Array.isArray(value.entries)
      || value.entries.length < 1 || value.entries.length > 2 || new Set(value.entries.map(entry => entry?.id)).size !== value.entries.length)
      throw new Error('invalid pending');
    for (const entry of value.entries) {
      if (!entry || Object.keys(entry).some(field => !fields.includes(field))
        || typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(entry.id)
        || entry.companyId !== undefined && entry.companyId !== companyId || !isCalendarDay(entry.date)
        || typeof entry.cashAccountId !== 'string' || !entry.cashAccountId || entry.cashAccountId.includes('/')
        || ['note', 'partnerId', 'partnerName', 'createdAt', 'createdBy'].some(field => (entry as any)[field] !== undefined && typeof (entry as any)[field] !== 'string'))
        throw new Error('invalid pending');
      if (entry.partnerId?.includes('/') || entry.lines !== undefined && (!Array.isArray(entry.lines) || entry.lines.length > 100
        || entry.lines.some(line => !line || Object.keys(line).some(field => !['accountCode', 'amount', 'side', 'note'].includes(field))
          || line.amount === 0 || line.note !== undefined && typeof line.note !== 'string')))
        throw new Error('invalid pending');
      projectCashLines(entry, true);
    }
    return { attempt: value, error: '' };
  } catch { return { attempt: null, error: '저장된 발행 요청 확인이 필요합니다. 중복 발행을 막기 위해 새 저장을 중단했습니다.' }; }
}

export function EntryModal({ companyId, account, accounts, accountCodes, partners, currentUser, fixedCostTemplates = [], onClose, onAdd }: {
  companyId: CompanyId;
  account: CashAccount;
  accounts: CashAccount[];
  accountCodes: AccountCode[];
  fixedCostTemplates?: FixedCostTemplate[];
  partners: Partner[];
  currentUser?: { id: string; name: string } | null;
  onClose: () => void;
  onAdd: Props['onAddCashEntry'];
}) {
  const [mode, setMode] = useState<'일반' | '상환' | '급여' | '보험' | '세금'>('일반');
  const [cashAccountId, setCashAccountId] = useState(() => defaultCashAccountId(accounts, companyId));
  const [date, setDate] = useState(today());
  const [dir, setDir] = useState<'입금' | '출금'>('출금');
  const [amount, setAmount] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [accountCode, setAccountCode] = useState('');
  const [note, setNote] = useState('');
  const [savingEntry, setSavingEntry] = useState(false);
  const saveLock = useRef(false);
  const userId = auth.currentUser?.uid ?? '';
  const pendingKey = `cash-entry-issue:${companyId}:${userId}`;
  const restored = useMemo(() => readEntryAttempt(pendingKey, companyId, userId), [pendingKey, companyId, userId]);
  const saveAttempt = useRef<EntryAttempt | null>(restored.attempt);
  const attemptScope = useRef({ key: pendingKey, active: true });
  if (attemptScope.current.key !== pendingKey) {
    attemptScope.current = { key: pendingKey, active: true };
    saveAttempt.current = restored.attempt;
  }
  useEffect(() => { const scope = attemptScope.current; scope.active = true; return () => { scope.active = false; }; }, [pendingKey]);
  const [entryError, setEntryError] = useState('');
  // 대출 상환 전용
  const [loanCode, setLoanCode] = useState('260');   // 260 단기 / 293 장기
  const [loanId, setLoanId] = useState('');
  const loans = useLoanContracts(companyId);
  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('');
  // 급여 지급 전용
  const [gross, setGross] = useState('');
  const [deduction, setDeduction] = useState('');
  // 세금 — 부가세(맡아둔 예수금)와 소득세(사장님 개인)를 한 번에 낸다. 둘 다 비용이 아니다.
  const [vat, setVat] = useState('');
  const [incomeTax, setIncomeTax] = useState('');

  const amt = parseMoneyInput(amount);
  const partner = partners.find(p => p.id === partnerId);
  const prin = parseMoneyInput(principal);
  const intr = parseMoneyInput(interest);
  const grs = parseMoneyInput(gross);
  const ded = parseMoneyInput(deduction);
  const net = grs - ded;
  const vatAmt = parseMoneyInput(vat);
  const taxAmt = parseMoneyInput(incomeTax);
  const taxTotal = vatAmt + taxAmt;
  // 계정 코드 (이름으로 탐색, 없으면 기본)
  // 고른 방향의 템플릿만. 카드를 누르면 모드·계정과목·비고가 한 번에 채워진다.
  const templates = useMemo(() => filterTemplates(accountCodes, fixedCostTemplates), [accountCodes, fixedCostTemplates]);
  /** 고른 템플릿을 id로 붙든다 — 계정만으로 되찾으면 같은 계정 템플릿 중 먼저 오는 게 잡힌다 */
  const [templateId, setTemplateId] = useState<string | null>(null);
  const currentTemplate = () =>
    (templateId ? templates.find(t => t.id === templateId) : undefined)
      ?? activeTemplate(templates, { mode, accountCode });
  /**
   * 템플릿을 고르면 **양식 전체가 그 템플릿이 된다** — 계정·거래처·금액·두 줄 값까지.
   * 전에는 계정과 적요만 가져와서, 거래처·금액을 매번 다시 골라야 했다(템플릿을 둔 뜻이 없다).
   *
   * 없는 값은 **비운다.** 안 그러면 앞서 고른 템플릿의 금액이 남아 딴 전표로 끊긴다.
   */
  const pickTemplate = (t: CashTemplate) => {
    setTemplateId(t.id);
    if (isCashDir(t.dir)) setDir(t.dir);   // 자금원장은 돈이 오간 것만 적는다
    setMode(t.mode);
    setAccountCode(t.accountCode ?? '');
    // 적요는 품목명 > 템플릿 비고 순 — 전표에 그대로 남는 글이라 품목명이 먼저다
    setNote(t.itemName || t.note || '');
    setPartnerId(t.partnerId ?? '');
    setAmount(t.amount && t.amount > 0 ? String(t.amount) : '');
    // 두 줄로 갈리는 갈래는 금액칸을 안 쓴다. 넷을 먼저 비우고 고른 갈래만 채운다.
    setInsCorpStr(''); setInsEmpStr(''); setPrincipal(''); setInterest('');
    setGross(''); setDeduction(''); setVat(''); setIncomeTax('');
    const sm = splitModeOf(t.mode);
    if (sm) {
      const S = SPLIT_MODES[sm];
      const a = (t as Record<string, any>)[S.a], b = (t as Record<string, any>)[S.b];
      const setters: Record<string, [(v: string) => void, (v: string) => void]> = {
        보험: [setInsCorpStr, setInsEmpStr],
        상환: [setPrincipal, setInterest],
        급여: [setGross, setDeduction],
        세금: [setVat, setIncomeTax],
      };
      if (sm === '상환' && t.loanCode) setLoanCode(t.loanCode);
      const [setA, setB] = setters[sm];
      if (a != null || b != null) { setA(a ? String(a) : ''); setB(b ? String(b) : ''); }
    }
    setPickerOpen(false);
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const codeName = useMemo(() => new Map(accountCodes.map(c => [c.code, c.name])), [accountCodes]);
  const partnerNameMap = useMemo(() => new Map(partners.map(p => [p.id, p.name])), [partners]);
  // 4대보험 — 회사부담(비용) + 근로자부담(맡아둔 예수금)
  const [insCorpStr, setInsCorpStr] = useState('');
  const [insEmpStr, setInsEmpStr] = useState('');
  const insCorp = parseMoneyInput(insCorpStr);
  const insEmp = parseMoneyInput(insEmpStr);
  const insTotal = insCorp + insEmp;
  const INS_CODE = accountCodes.find(c => c.name === '복리후생비' || c.name === '사대보험')?.code ?? STANDARD_ACCOUNT.WELFARE;
  const loanAccounts = accountCodes.filter(c => c.type === '부채' && /차입금/.test(c.name));
  const INTEREST_CODE = accountCodes.find(c => /이자비용/.test(c.name))?.code ?? STANDARD_ACCOUNT.INTEREST;
  const SALARY_CODE = accountCodes.find(c => c.name === '급여')?.code ?? STANDARD_ACCOUNT.SALARY;
  const WITHHOLD_CODE = accountCodes.find(c => c.name === '예수금')?.code ?? STANDARD_ACCOUNT.WITHHOLDING;
  const VAT_CODE = accountCodes.find(c => c.name === '부가세예수금')?.code ?? '255';
  const DRAW_CODE = accountCodes.find(c => c.name === '인출금')?.code ?? '338';
  const canSave = mode === '일반' ? (amt > 0 && !!accountCode)
    : mode === '상환' ? ((prin > 0 || intr > 0) && !!loanCode)
    : mode === '보험' ? insTotal > 0
    : mode === '세금' ? taxTotal > 0
    : (grs > 0 && ded >= 0 && net >= 0);

  /**
   * 모든 자금전표가 공유하는 바탕. **시각은 stampFor가 정한다** —
   * 여기서 new Date()를 쓰면 지난 날짜로 끊어도 '지금 시각'이 박혀서, 그날 안의 자리가
   * 끊은 시각에 따라 멋대로 잡힌다(오전에 끊으면 그날 앞, 저녁에 끊으면 뒤).
   */
  const base = () => ({ companyId, date, cashAccountId, createdAt: stampFor(date), ...(currentUser ? { createdBy: currentUser.name } : {}), ...(partnerId ? { partnerId, partnerName: partner?.name ?? '' } : {}) });

  /**
   * 저장하면 생길 자금전표. 아래 분개 미리보기가 이걸 그대로 분개한다 —
   * 저장과 미리보기를 갈라 두면 "보인 것과 저장된 것"이 달라진다.
   */
  const buildEntries = (): CashEntry[] => {
    if (mode === '일반') {
      if (amt <= 0) return [];
      return [{ id: `cash-${Date.now()}`, dir, amount: amt, accountCode, ...(note.trim() ? { note: note.trim() } : {}), ...base() } as CashEntry];
    }
    if (mode === '상환') {
      //  통장에서 나간 건 합계 한 번. 그 안에서 원금(차입금=부채 감소)·이자(비용)를 줄로 가른다.
      //  가르는 셈은 [shared/splitEntry](../src/shared/splitEntry.ts) — 일반전표 화면과 같은 함수다.
      const e = splitCashEntry({
        lines: [
          { accountCode: loanCode, amount: prin, note: '원금' },
          { accountCode: INTEREST_CODE, amount: intr, note: '이자' },
        ],
        note, fallbackNote: '대출 상환', base: { ...base(), ...(loans.some(loan => loan.id === loanId && loan.accountCode === loanCode) ? { loanId } : {}) },
      });
      return e ? [e] : [];
    }
    if (mode === '보험') {
      // 통장에서 한 번 나가지만 성격이 둘 — 회사부담은 비용, 근로자부담은 맡아둔 예수금을 턴다.
      // 전액을 530으로 몰면 비용이 부풀고 예수금이 영영 안 줄어든다.
      const e = splitCashEntry({
        lines: [
          { accountCode: INS_CODE, amount: insCorp, note: '회사부담' },
          { accountCode: WITHHOLD_CODE, amount: insEmp, note: '근로자부담(예수금)' },
        ],
        note, fallbackNote: '4대보험', base: base(),
      });
      return e ? [e] : [];
    }
    if (mode === '세금') {
      /*
       * 부가세와 종합소득세를 한 번에 낸다. **둘 다 비용이 아니다.**
       * 부가세는 손님한테 받아 맡아둔 돈이라 부채(255)를 터는 것이고,
       * 종합소득세는 사업이 아니라 사장님 개인에게 매기는 세금이라 인출금(338)이다.
       * 비용으로 몰면 이익이 그만큼 줄어 보이고 부가세예수금은 영영 안 줄어든다.
       */
      const e = splitCashEntry({
        lines: [
          { accountCode: VAT_CODE, amount: vatAmt, note: '부가세' },
          { accountCode: DRAW_CODE, amount: taxAmt, note: '소득세' },
        ],
        note, fallbackNote: '세금 납부', base: base(),
      });
      return e ? [e] : [];
    }
    //  급여 → 총급여 출금(급여) + 공제 입금(예수금). 합산하면 급여 비용 전액 + 예수금 + 실지급.
    return payrollEntries({
      gross: grs, deduction: ded,
      salaryCode: SALARY_CODE, withholdCode: WITHHOLD_CODE,
      note, base: base(),
    });
  };

  const save = async () => {
    if ((!canSave && !saveAttempt.current) || saveLock.current || restored.error) return;
    const previous = saveAttempt.current;
    const entries = previous?.entries ?? buildEntries();
    // 대출은 전용 서비스가 실제 operation과 pending을 소유한다. generic 원문 대기를 겹치지 않는다.
    const generic = !entries.some(entry => entry.loanId);
    if (entries.some(entry => [entry.accountCode, ...(entry.lines ?? []).map(line => line.accountCode)]
      .some(code => ['260', '293'].includes(String(code))))) {
      alert('대출 차입·상환은 대출 관리에서 처리해 주세요.');
      return;
    }
    saveLock.current = true;
    setSavingEntry(true);
    const scope = attemptScope.current;
    let completed = 0;
    let attemptText: string | undefined;
    try {
      await authReady;
      if (!userId || auth.currentUser?.uid !== userId || auth.currentUser.isAnonymous)
        throw new Error('로그인 상태를 확인한 뒤 다시 저장해주세요.');
      if (!previous) for (const entry of entries) {
        if (!isCalendarDay(entry.date) || !accounts.some(account => account.id === entry.cashAccountId && companyOf(account) === companyId && account.active)
          || entry.partnerId && !partners.some(partner => partner.id === entry.partnerId && companyOf(partner) === companyId))
          throw new Error('현재 회사의 계좌·거래처·날짜를 확인해주세요.');
        const projection = projectCashLines(entry, true);
        if (projection.parts.some(line => !accountCodes.some(code => code.code === line.accountCode))) throw new Error('계정과목을 확인해주세요.');
      }
      const attempt = previous ?? { companyId, userId, entries };
      if (generic) {
        attemptText = JSON.stringify(attempt);
        const stored = localStorage.getItem(pendingKey);
        if (stored !== null && stored !== attemptText)
          throw new Error('다른 창의 발행 요청이 대기 중입니다. 창을 다시 열어 해당 원문을 확인해주세요.');
        localStorage.setItem(pendingKey, attemptText);
        saveAttempt.current = attempt;
      }
      for (const entry of entries) {
        if (!scope.active || attemptScope.current !== scope || generic && saveAttempt.current !== attempt || auth.currentUser?.uid !== attempt.userId) return;
        await onAdd(entry);
        completed++;
        if (!scope.active || attemptScope.current !== scope || generic && saveAttempt.current !== attempt || auth.currentUser?.uid !== attempt.userId) return;
      }
      if (generic && localStorage.getItem(pendingKey) === attemptText) localStorage.removeItem(pendingKey);
      saveAttempt.current = null;
      onClose();
    } catch (error) {
      if (!scope.active || attemptScope.current !== scope) return;
      const proof = (error as { details?: Record<string, unknown> })?.details;
      if (generic && !previous && completed === 0 && proof?.operationStatus === 'rejected' && proof.version === 1
        && proof.financialWrites === false && proof.companyId === companyId && proof.operationId === entries[0]?.id) {
        if (localStorage.getItem(pendingKey) === attemptText) localStorage.removeItem(pendingKey);
        saveAttempt.current = null;
      }
      setEntryError(error instanceof Error ? error.message : String(error));
      alert(`자금전표 저장에 실패했습니다. 입력은 유지됩니다.\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      saveLock.current = false;
      if (scope.active && attemptScope.current === scope) setSavingEntry(false);
    }
  };

  return (
    <ModalShell title="일반전표 발행" onClose={onClose} bodyClassName="!p-0">
        {(restored.error || entryError) && <p role="alert" className="px-5 py-2 text-sm text-rose-600">{restored.error || entryError}</p>}
        {saveAttempt.current && <p className="px-5 py-2 text-sm text-amber-700">이전 요청의 결과를 확인할 때까지 입력을 유지합니다. 동일 요청으로 재시도합니다: {saveAttempt.current.entries.map(entry => `${entry.date} ${entry.accountCode ?? '복수 분개'} ${entry.amount.toLocaleString()}원`).join(' / ')}</p>}
        <fieldset disabled={savingEntry || !!saveAttempt.current || !!restored.error} className="contents">
        {/* 방향은 제목 줄에 둔다 — 아래 목록이 통째로 바뀌므로 목록 위에 있어야 한다 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
          {/* 일자는 제목 옆에 — 전표를 끊을 때 제일 먼저 확인하는 값이라 맨 위에 둔다 */}
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="shrink-0 border border-slate-200 rounded-xl px-3 py-1.5 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300" />
          <div className="flex gap-1.5 ml-auto">
            {(['출금', '입금'] as const).map(d => (
              <button key={d} type="button" onClick={() => { setDir(d); setMode('일반'); setAccountCode(''); }}
                className={`px-5 py-2 rounded-xl text-xs font-black border transition-all ${dir === d
                  ? d === '입금' ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' : 'bg-rose-600 text-white border-rose-600 shadow-sm'
                  : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'}`}>
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-6 space-y-5">

        {/* 기본은 직접입력. 목록은 고를 때만 창을 열어 보여준다(전표 화면과 같다) */}
        {(() => {
          const cur = currentTemplate();
          const picked = !!cur && !cur.id.startsWith('free');
          return (
            <button type="button" onClick={() => setPickerOpen(true)}
              className={`w-full flex items-center gap-2 px-4 py-3 rounded-xl border text-left transition-all ${
                picked ? 'bg-indigo-50 border-indigo-200 hover:border-indigo-400' : 'bg-slate-50 border-slate-200 hover:border-slate-400'
              }`}>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0">전표</span>
              <span className={`text-sm font-black truncate ${picked ? 'text-indigo-700' : 'text-slate-600'}`}>{cur?.label ?? '직접입력'}</span>
              {cur && <span className="text-[10px] font-bold text-slate-400 truncate">{cur.hint ?? `${cur.accountCode} ${accountCodes.find(c => c.code === cur.accountCode)?.name ?? ''}`}</span>}
              <span className="ml-auto text-[11px] font-black text-indigo-600 shrink-0">템플릿 ▾</span>
            </button>
          );
        })()}
        {/* 대체·줄돈 템플릿을 자금원장에서 고르면 — 여긴 돈이 오간 것만 적는 화면이라
            같은 비용을 전표에서 한 번, 여기서 또 한 번 잡을 수 있다. 고르는 건 막지 않고 알린다. */}
        {(() => {
          const cur = currentTemplate();
          if (!cur || isCashDir(cur.dir)) return null;
          return (
            <div className="rounded-xl bg-amber-50 text-amber-700 px-3 py-2.5 text-[11px] font-bold leading-snug">
              <b>{cur.label}</b>은 <b>{cur.dir}</b> 갈래 템플릿입니다 — 자금원장은 <b>돈이 실제로 오간 것</b>만 적습니다.
              발생만 잡으려면 전표 화면에서 끊고, 나중에 낼 때 [지불]하세요. 여기서 그대로 저장하면 비용이 두 번 잡힙니다.
            </div>
          );
        })()}
        <p className="text-[11px] text-slate-400 leading-snug">
          {mode === '일반'
            ? <>실제로 돈이 움직인 사실만 적습니다. 이 돈의 성격(비용·자산·부채)은 <b>계정과목</b>이 정합니다 — 전기요금이면 전력비, 기계 구입이면 기계장치, 대출 받으면 차입금.</>
            : mode === '상환'
            ? <>원금·이자를 한 번에 넣으면 <b>자금원장에 두 줄</b>로 자동 기록됩니다 — 원금은 차입금 감소, 이자는 비용.</>
            : <>총급여·공제를 넣으면 <b>급여(비용) + 예수금(원천공제) + 실지급</b>으로 자동 분리됩니다. 떼둔 세금·4대보험은 예수금으로 잡혔다가 공단·국세청 납부 때 빠집니다.</>}
        </p>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">계좌</label>
          <select value={cashAccountId} onChange={e => setCashAccountId(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300">
            {accounts.filter(a => a.active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        {mode === '급여' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">총급여</label>
                <input inputMode="numeric" value={formatMoneyInput(gross)} placeholder="0"
                  onChange={e => changeMoneyInput(e.currentTarget, setGross)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">공제 <span className="text-slate-300">(원천세·4대보험 근로자분)</span></label>
                <input inputMode="numeric" value={formatMoneyInput(deduction)} placeholder="0"
                  onChange={e => changeMoneyInput(e.currentTarget, setDeduction)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
            </div>
            <div className={`flex items-center justify-between rounded-xl px-3 py-2 text-[11px] font-black ${net < 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-500'}`}>
              <span>실지급 (통장에서 나감)</span>
              <span className="tabular-nums text-slate-800">{fmt(net)}{net < 0 ? ' · 공제가 총급여보다 큼' : ''}</span>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">거래처 <span className="text-slate-300">(선택 · 직원/급여계좌)</span></label>
              <select value={partnerId} onChange={e => setPartnerId(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300">
                <option value="">— 없음 —</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </>
        ) : mode === '보험' ? (
          <>
            {/* 통장에서 한 번 나가지만 성격이 둘 — 회사부담은 비용, 근로자부담은 맡아둔 예수금을 턴다 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">회사부담 <span className="text-slate-300">(비용)</span></label>
                <input inputMode="numeric" value={formatMoneyInput(insCorpStr)} placeholder="0"
                  onChange={e => changeMoneyInput(e.currentTarget, setInsCorpStr)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">근로자부담 <span className="text-slate-300">(예수금)</span></label>
                <input inputMode="numeric" value={formatMoneyInput(insEmpStr)} placeholder="0"
                  onChange={e => changeMoneyInput(e.currentTarget, setInsEmpStr)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
            </div>
            <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2 text-[11px] font-black text-slate-500">
              <span>통장에서 나가는 총액</span>
              <span className="tabular-nums text-slate-800">{fmt(insTotal)}</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              회사부담은 <b>비용</b>, 근로자부담은 급여에서 떼어 맡아둔 <b>예수금</b>을 터는 것입니다.
            </p>
          </>
        ) : mode === '세금' ? (
          <>
            {/* 세금 양식이 없어서 '세금납부' 템플릿을 고르면 상환(원금·이자) 칸이 떴다.
                고른 템플릿과 다른 양식이 뜨면 무슨 전표를 쓰는 중인지 알 수 없다. */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">부가세 <span className="text-slate-300">(예수금)</span></label>
                <input inputMode="numeric" value={formatMoneyInput(vat)} placeholder="0"
                  onChange={e => changeMoneyInput(e.currentTarget, setVat)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">소득세 <span className="text-slate-300">(인출금)</span></label>
                <input inputMode="numeric" value={formatMoneyInput(incomeTax)} placeholder="0"
                  onChange={e => changeMoneyInput(e.currentTarget, setIncomeTax)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
            </div>
            <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2 text-[11px] font-black text-slate-500">
              <span>한 번에 내는 총액</span>
              <span className="tabular-nums text-slate-800">{fmt(taxTotal)}</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              둘 다 <b>비용이 아닙니다.</b> 부가세는 받아서 맡아둔 돈을 넘기는 것이고,
              종합소득세는 사장님 개인 세금이라 <b>인출금</b>입니다.
            </p>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">거래처 <span className="text-slate-300">(선택 · 세무서)</span></label>
              <select value={partnerId} onChange={e => setPartnerId(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300">
                <option value="">— 없음 —</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </>
        ) : mode === '일반' ? (
          <>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">금액</label>
              <div className="relative">
                <input inputMode="numeric" value={formatMoneyInput(amount)} placeholder="0"
                  onChange={e => changeMoneyInput(e.currentTarget, setAmount)}
                  className="w-full border border-slate-200 rounded-xl pl-3 pr-9 py-3 text-right text-2xl font-black tabular-nums outline-none focus:ring-2 focus:ring-slate-300" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-black text-slate-300 pointer-events-none">원</span>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">거래처 <span className="text-slate-300">(선택)</span></label>
              <select value={partnerId} onChange={e => setPartnerId(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300">
                <option value="">— 없음 —</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">계정과목 <span className="text-rose-400">*</span></label>
              <select value={accountCode} onChange={e => setAccountCode(e.target.value)}
                className={`w-full border rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300 ${
                  accountCode ? 'border-slate-200' : 'border-amber-300 bg-amber-50'
                }`}>
                <option value="">— 선택하세요 —</option>
                {accountCodes.map(c => <option key={c.id} value={c.code}>{c.code} · {c.name}</option>)}
              </select>
              {!accountCode && <p className="text-[10px] font-bold text-amber-600 mt-1">계정과목이 없으면 손익·현금흐름 어디에도 못 잡힙니다.</p>}
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">대출 계정 <span className="text-rose-400">*</span></label>
              <select value={loanCode} onChange={e => { setLoanCode(e.target.value); setLoanId(''); }}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300">
                {(loanAccounts.length ? loanAccounts : [{ id: '260', code: '260', name: '단기차입금' }, { id: '293', code: '293', name: '장기차입금' }]).map(c => (
                  <option key={c.id} value={c.code}>{c.code} · {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">대출 건 연결</label>
              <select value={loanId} onChange={e => { setLoanId(e.target.value); const loan = loans.find(row => row.id === e.target.value); if (loan?.partnerId) setPartnerId(loan.partnerId); }} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold">
                <option value="">선택 안 함 — 대출별 잔액에 미반영</option>
                {loans.filter(loan => loan.accountCode === loanCode).map(loan => <option key={loan.id} value={loan.id}>{loan.name} · {loan.lenderName}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">원금</label>
                <input inputMode="numeric" value={formatMoneyInput(principal)} placeholder="0"
                  onChange={e => changeMoneyInput(e.currentTarget, setPrincipal)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">이자</label>
                <input inputMode="numeric" value={formatMoneyInput(interest)} placeholder="0"
                  onChange={e => changeMoneyInput(e.currentTarget, setInterest)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-right text-base font-black tabular-nums outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
            </div>
            <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2 text-[11px] font-black text-slate-500">
              <span>통장에서 나가는 총액</span>
              <span className="tabular-nums text-slate-800">{fmt(prin + intr)}</span>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">거래처 <span className="text-slate-300">(선택 · 은행)</span></label>
              <select value={partnerId} onChange={e => setPartnerId(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300">
                <option value="">— 없음 —</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </>
        )}

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase block mb-1.5">적요 <span className="text-slate-300">(선택)</span></label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder={mode === '일반' ? '7월분 전기요금 자동이체' : '기업은행 시설자금 7월 상환'}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300" />
        </div>

        {/* ── 이렇게 분개됩니다 ── 성격계정만 고르면 통장 쪽은 자동이라, 저장 전에는
            무엇이 어디로 잡히는지 안 보였다. 저장 경로와 같은 함수로 만들어 보여 준다. */}
        {(() => {
          const entries = buildEntries();
          if (!entries.length) return null;
          return (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">이렇게 분개됩니다</span>
                {entries.length > 1 && <span className="text-[10px] font-bold text-slate-400">자금전표 {entries.length}건</span>}
              </div>
              <div className="divide-y divide-slate-200">
                {entries.map(e => {
                  const je = journalizeCashEntry(e);
                  return (
                    <div key={e.id} className="px-2 sm:px-4 py-2.5">
                      {je ? (
                        <VoucherSlip je={je} codeName={codeName} partnerName={partnerNameMap}
                          kind={e.dir} docNo={e.docNo} date={e.date} headPartner={e.partnerName} />
                      ) : (
                        <p className="text-[11px] font-black text-amber-600">
                          계정과목이 없어 분개를 만들 수 없습니다 — 손익·재무제표 어디에도 안 잡힙니다.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        </div>
        </fieldset>
        <div className="flex gap-2 px-5 py-4">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-500 text-sm font-black hover:bg-slate-200">취소</button>
          <button onClick={save} disabled={(!canSave && !saveAttempt.current) || savingEntry || !!restored.error}
            className="flex-[2] py-3 rounded-xl bg-slate-800 text-white text-sm font-black hover:bg-slate-900 disabled:opacity-30 disabled:cursor-not-allowed">
            {savingEntry ? '저장 중…' : saveAttempt.current ? '동일 요청 재시도' : '저장'}
          </button>
        </div>

        {pickerOpen && (
          <CashTemplateModal
            templates={templates} accountCodes={accountCodes}
            activeId={currentTemplate()?.id ?? null}
            onPick={pickTemplate}
            onDirect={() => { setTemplateId(null); setMode('일반'); setAccountCode(''); setPickerOpen(false); }}
            onClose={() => setPickerOpen(false)}
          />
        )}
    </ModalShell>
  );
}
