import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type { CashAccount, CashEntry, CompanyId, Partner } from '../src/shared/types';
import { companyOf } from '../src/shared/types';
import { today } from '../src/shared/day';
import { stampFor } from '../src/shared/voucherStamp';
import { STANDARD_ACCOUNT } from '../src/shared/accountChart';
import { splitCashEntry } from '../src/shared/splitEntry';
import { isFinancial } from '../src/shared/partnerRole';
import { loanBalance, loanMovements, loanOpeningPrincipalForBalance, type LoanContract } from '../src/shared/loanLedger';
import { createLoanWithOpening, fetchWhere, updateLoanOpening } from '../src/shared/services/firebaseService';
import { appConfirm, appNotice } from '../src/shared/components/appDialog';
import ModalShell from '../src/shared/components/ModalShell';
import { changeMoneyInput, formatMoneyInput, parseMoneyInput } from '../src/shared/moneyInput';
import { defaultCashAccountId } from '../src/shared/defaultCashAccount';

interface Props {
  companyId: CompanyId;
  cashEntries: CashEntry[];
  cashAccounts: CashAccount[];
  partners: Partner[];
  currentUserName?: string;
  onAddCashEntry: (entry: CashEntry) => Promise<unknown>;
}

const won = (amount: number) => `${Math.round(amount).toLocaleString('ko-KR')}원`;
const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-400';
const label = 'mb-1 block text-xs font-bold text-slate-500';

export default function LoanManager({ companyId, cashEntries, cashAccounts, partners, currentUserName, onAddCashEntry }: Props) {
  const [loans, setLoans] = useState<LoanContract[]>([]);
  const refreshSeq = useRef(0);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newLoanId, setNewLoanId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const activeSelection = useRef({ companyId, selectedId });
  activeSelection.current = { companyId, selectedId };
  const [action, setAction] = useState<'차입' | '상환' | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [lenderName, setLenderName] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [accountCode, setAccountCode] = useState<'260' | '293'>('293');
  const [openingDate, setOpeningDate] = useState(today());
  const [openingPrincipal, setOpeningPrincipal] = useState('0');
  const [maturityDate, setMaturityDate] = useState('');
  const [date, setDate] = useState(today());
  const [cashAccountId, setCashAccountId] = useState('');
  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('0');
  const [note, setNote] = useState('');
  const [amountErrors, setAmountErrors] = useState<Record<string, string>>({});
  const [editingLoan, setEditingLoan] = useState<LoanContract | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editBalance, setEditBalance] = useState('');
  useEffect(() => { setAmountErrors({}); }, [showNew, action, editingLoan]);
  const changeLoanAmount = (input: HTMLInputElement, key: string, previous: string, setValue: (value: string) => void) => {
    // 부호·소수점을 지워 다른 금액으로 만들지 않고 입력 전체를 거절한다.
    if (!/^[0-9,]*$/.test(input.value)) {
      input.value = formatMoneyInput(previous);
      setAmountErrors(current => ({ ...current, [key]: '금액은 0원 이상의 정수만 입력하세요. 소수와 음수는 사용할 수 없습니다.' }));
      return;
    }
    setAmountErrors(current => ({ ...current, [key]: '' }));
    changeMoneyInput(input, setValue);
  };

  const refresh = async () => {
    const seq = ++refreshSeq.current;
    setLoading(true);
    try {
      const rows = await fetchWhere<LoanContract>('loanContracts', 'companyId', companyId);
      if (seq === refreshSeq.current) setLoans(rows);
    } catch (error) {
      if (seq === refreshSeq.current) await appNotice(`대출 목록을 불러오지 못했습니다. ${String(error)}`, '조회 실패');
    } finally { if (seq === refreshSeq.current) setLoading(false); }
  };
  useEffect(() => { setLoans([]); setSelectedId(''); setEditingLoan(null); void refresh(); return () => { refreshSeq.current++; }; }, [companyId]);

  const companyLoans = loans.filter(loan => loan.companyId === companyId);
  const selected = companyLoans.find(loan => loan.id === selectedId);
  const rows = useMemo(() => selected ? loanMovements(selected, cashEntries) : [], [selected, cashEntries]);
  const availableAccounts = cashAccounts.filter(a => a.active && a.type === '통장');

  let editPrincipal: number | undefined;
  let editError = '';
  if (editingLoan) {
    try { editPrincipal = loanOpeningPrincipalForBalance(editingLoan, cashEntries, editDate, parseMoneyInput(editBalance)); }
    catch (error) { editError = error instanceof Error ? error.message : String(error); }
  }
  const saveOpeningEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingLoan || busy || amountErrors.editBalance || editPrincipal === undefined) return;
    const original = editingLoan;
    const stillSelected = () => activeSelection.current.companyId === companyId && activeSelection.current.selectedId === original.id;
    setBusy(true);
    try {
      if (!await appConfirm({ title: '대출 시작일·잔액 수정', message: `${editingLoan.name}의 시작일을 ${editDate}, 현재 원금 잔액을 ${won(parseMoneyInput(editBalance))}으로 수정할까요?`, confirmText: '저장' })) return;
      if (!stillSelected()) return;
      await updateLoanOpening(companyId, original, editDate, parseMoneyInput(editBalance));
      if (!stillSelected()) return;
      await refresh();
      if (stillSelected()) setEditingLoan(null);
    } catch (error) { if (stillSelected()) await appNotice(`대출을 수정하지 못했습니다. ${String(error)}`, '저장 실패'); }
    finally { setBusy(false); }
  };

  const createLoan = async (event: React.FormEvent) => {
    event.preventDefault();
    if (amountErrors.opening) return;
    const amount = parseMoneyInput(openingPrincipal);
    if (!name.trim() || !lenderName.trim() || !openingDate || !Number.isFinite(amount) || amount < 0) {
      await appNotice('대출명·금융기관·시작일·0원 이상의 시작 원금을 입력하세요.'); return;
    }
    if (!await appConfirm({ title: '대출 등록', message: `${name.trim()}의 ${openingDate} 시작 원금 ${won(amount)}을 등록할까요?${amount ? ' 회계 기초일과 같으면 대출부채 기초 전표도 함께 발행합니다.' : ' 실제 차입액은 등록 후 차입 전표로 기록하세요.'}`, confirmText: '등록' })) return;
    setBusy(true);
    try {
      const id = newLoanId;
      await createLoanWithOpening(companyId, {
        id, companyId, name: name.trim(), lenderName: lenderName.trim(),
        ...(partnerId ? { partnerId } : {}), accountCode, openingDate, openingPrincipal: amount,
        ...(maturityDate ? { maturityDate } : {}), createdAt: new Date().toISOString(),
      });
      await refresh(); setSelectedId(id); setShowNew(false); setName(''); setOpeningPrincipal('0');
    } catch (error) { await appNotice(`대출을 저장하지 못했습니다. ${String(error)}`, '저장 실패'); }
    finally { setBusy(false); }
  };

  const saveMovement = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !action) return;
    if (amountErrors.principal || (action === '상환' && amountErrors.interest)) return;
    const p = parseMoneyInput(principal), i = action === '상환' ? parseMoneyInput(interest) : 0;
    if (!date || date < selected.openingDate || !cashAccountId || !Number.isFinite(p) || p < 0 || !Number.isFinite(i) || i < 0 || p + i <= 0) {
      await appNotice('시작일 이후 날짜·통장·0원 이상의 원금을 확인하세요.'); return;
    }
    if (action === '차입' && p <= 0) { await appNotice('차입 원금을 입력하세요.'); return; }
    if (action === '상환' && p > loanBalance(selected, cashEntries)) {
      await appNotice('상환 원금이 현재 대출 잔액보다 많습니다.'); return;
    }
    const entry: CashEntry | null = action === '차입'
      ? { id: `cash-loan-${Date.now()}`, companyId, loanId: selected.id, date, createdAt: stampFor(date),
          cashAccountId, dir: '입금', amount: p, accountCode: selected.accountCode,
          partnerId: selected.partnerId, partnerName: selected.lenderName,
          note: note.trim() || `${selected.name} 차입`, createdBy: currentUserName }
      : splitCashEntry({
          lines: [
            { accountCode: selected.accountCode, amount: p, note: '원금' },
            { accountCode: STANDARD_ACCOUNT.INTEREST, amount: i, note: '이자' },
          ],
          note, fallbackNote: `${selected.name} 상환`,
          base: { companyId, loanId: selected.id, date, createdAt: stampFor(date), cashAccountId,
            partnerId: selected.partnerId, partnerName: selected.lenderName, createdBy: currentUserName },
        });
    if (!entry) return;
    if (!await appConfirm({ title: `${action} 전표 확인`, message: `${selected.name} · ${date}\n원금 ${won(p)}${i ? ` / 이자 ${won(i)}` : ''}\n${action === '상환' ? '출금' : '입금'} 전표를 발행하고 이 대출에 연결할까요?`, confirmText: '전표 발행' })) return;
    setBusy(true);
    try {
      await onAddCashEntry(entry);
      setAction(null); setPrincipal(''); setInterest('0'); setNote('');
    } catch (error) { await appNotice(`전표를 저장하지 못했습니다. ${String(error)}`, '저장 실패'); }
    finally { setBusy(false); }
  };

  return <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-black text-slate-900">대출 관리</h1><p className="mt-1 text-sm text-slate-500">대출별 원금 잔액 · 차입/상환 내역</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => void refresh()} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600"><RefreshCw size={16}/></button>
        <button type="button" onClick={() => { setNewLoanId(`loan-${crypto.randomUUID()}`); setShowNew(true); }} className="flex items-center gap-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white"><Plus size={16}/> 대출 등록</button></div>
    </div>
    <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">회계 기초일과 같은 시작 원금은 대출 계약과 기초 전표에 함께 반영됩니다. 이후 새로 차입한 돈은 시작 원금 0원으로 등록하고 차입 전표를 발행하세요. 기존 전표는 자동 배정하지 않습니다.</p>
    {loading ? <p className="p-8 text-center text-slate-400">불러오는 중…</p> : companyLoans.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">등록된 대출이 없습니다.</p> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{companyLoans.map(loan => {
      const balance = loanBalance(loan, cashEntries);
      return <button key={loan.id} type="button" onClick={() => setSelectedId(loan.id)} className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-300">
        <div className="flex justify-between gap-2"><strong className="text-sm text-slate-900">{loan.name}</strong><span className="text-xs text-slate-500">{loan.accountCode === '260' ? '단기' : '장기'}</span></div>
        <p className="mt-1 text-xs text-slate-500">{loan.lenderName}</p><p className="mt-4 text-xs text-slate-500">원금 잔액</p><p className="text-xl font-black text-slate-900">{won(balance)}</p>
        <p className="mt-2 text-xs text-slate-400">{loan.openingDate} 시작 · 거래 {loanMovements(loan, cashEntries).length}건</p>
      </button>;
    })}</div>}
    {showNew && <ModalShell title="대출 등록" subtitle="기초 원금은 회계 기초일의 대출부채와 함께 저장됩니다" onClose={() => setShowNew(false)}>
      <form onSubmit={e => void createLoan(e)} className="space-y-4">
        <div><label className={label}>대출명</label><input className={field} value={name} onChange={e => setName(e.target.value)} placeholder="예: 운전자금 대출 1호" required/></div>
        <div><label className={label}>금융기관</label><input className={field} value={lenderName} onChange={e => { setLenderName(e.target.value); setPartnerId(''); }} placeholder="은행명" required/></div>
        <div><label className={label}>등록된 금융기관 연결 (선택)</label><select className={field} value={partnerId} onChange={e => { setPartnerId(e.target.value); const p = partners.find(row => row.id === e.target.value); if (p) setLenderName(p.name); }}><option value="">선택 안 함</option>{partners.filter(p => companyOf(p) === companyId && isFinancial(p)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><label className={label}>계정</label><select className={field} value={accountCode} onChange={e => setAccountCode(e.target.value as '260' | '293')}><option value="260">260 단기차입금</option><option value="293">293 장기차입금</option></select></div><div><label className={label}>만기일 (선택)</label><input type="date" className={field} value={maturityDate} onChange={e => setMaturityDate(e.target.value)}/></div></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><label className={label}>잔액 기준일</label><input type="date" className={field} value={openingDate} onChange={e => setOpeningDate(e.target.value)} required/></div><div><label className={label}>그날 시작 원금</label><input type="text" inputMode="numeric" className={field} value={formatMoneyInput(openingPrincipal)} onChange={e => changeLoanAmount(e.currentTarget, 'opening', openingPrincipal, setOpeningPrincipal)} aria-invalid={!!amountErrors.opening} required/>{amountErrors.opening && <p role="alert" className="mt-1 text-xs text-rose-600">{amountErrors.opening}</p>}</div></div>
        <button disabled={busy} className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white disabled:opacity-50">등록</button>
      </form>
    </ModalShell>}
    {selected && <ModalShell title={selected.name} subtitle={`${selected.lenderName} · ${selected.accountCode === '260' ? '단기차입금' : '장기차입금'}`} onClose={() => setSelectedId('')}>
      <div className="space-y-4"><div className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">현재 원금 잔액</p><p className="text-2xl font-black text-slate-900">{won(loanBalance(selected, cashEntries))}</p><p className="mt-1 text-xs text-slate-400">시작 {selected.openingDate} · {won(selected.openingPrincipal)}{selected.maturityDate ? ` · 만기 ${selected.maturityDate}` : ''}</p></div>
        <button className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-700" onClick={() => {
          setEditDate(selected.openingDate); setEditBalance(String(loanBalance(selected, cashEntries))); setEditingLoan(selected);
        }}>시작일·현재 잔액 수정</button>
        <div className="flex gap-2"><button className="flex-1 rounded-xl border border-indigo-200 px-3 py-2.5 text-sm font-bold text-indigo-700" onClick={() => { setDate(today()); setCashAccountId(defaultCashAccountId(availableAccounts, companyId)); setAction('차입'); }}>차입 기록</button><button className="flex-1 rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-bold text-white" onClick={() => { setDate(today()); setCashAccountId(defaultCashAccountId(availableAccounts, companyId)); setAction('상환'); }}>원금·이자 상환</button></div>
        <div><h3 className="mb-2 text-sm font-bold text-slate-700">거래 내역</h3>{rows.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">연결된 전표가 없습니다.</p> : <div className="divide-y divide-slate-100 border-y border-slate-100">{[...rows].reverse().map(row => <div key={row.entry.id} className="flex items-center justify-between gap-2 py-3 text-sm"><div><p className="font-semibold text-slate-800">{row.entry.date} · {row.entry.note || row.entry.docNo || '자금전표'}</p><p className="text-xs text-slate-400">{row.entry.docNo || row.entry.id}</p></div><span className={row.principalDelta >= 0 ? 'font-bold text-indigo-600' : 'font-bold text-slate-700'}>{row.principalDelta > 0 ? '+' : ''}{won(row.principalDelta)}</span></div>)}</div>}</div>
      </div>
    </ModalShell>}
    {editingLoan && <ModalShell title={`${editingLoan.name} 시작일·잔액 수정`} subtitle="연결 거래를 반영해 시작 원금을 함께 맞춥니다" onClose={() => { if (!busy) setEditingLoan(null); }} layer={1100}>
      <form onSubmit={e => void saveOpeningEdit(e)} className="space-y-4">
        <div><label htmlFor="loan-edit-date" className={label}>시작일</label><input id="loan-edit-date" type="date" className={field} value={editDate} disabled={busy} onChange={e => setEditDate(e.target.value)} required /></div>
        <div><label htmlFor="loan-edit-balance" className={label}>현재 원금 잔액</label><input id="loan-edit-balance" type="text" inputMode="numeric" className={field} value={formatMoneyInput(editBalance)} disabled={busy} onChange={e => changeLoanAmount(e.currentTarget, 'editBalance', editBalance, setEditBalance)} aria-invalid={!!amountErrors.editBalance} required />
          {amountErrors.editBalance && <p role="alert" className="mt-1 text-xs text-rose-600">{amountErrors.editBalance}</p>}
        </div>
        {editPrincipal !== undefined ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">시작 원금 미리보기: <strong>{won(editPrincipal)}</strong></p> : <p role="alert" className="text-sm text-rose-600">{editError}</p>}
        <button disabled={busy || !!amountErrors.editBalance || editPrincipal === undefined} className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? '저장 중…' : '수정 저장'}</button>
      </form>
    </ModalShell>}
    {selected && action && <ModalShell title={`${selected.name} ${action}`} subtitle="이 화면에서 발행한 전표는 해당 대출에 자동 연결됩니다" onClose={() => setAction(null)} layer={1100}>
      <form onSubmit={e => void saveMovement(e)} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><div><label className={label}>거래일</label><input type="date" className={field} value={date} onChange={e => setDate(e.target.value)} required/></div><div><label className={label}>통장</label><select className={field} value={cashAccountId} onChange={e => setCashAccountId(e.target.value)} required><option value="">선택</option>{availableAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div></div>
        <div><label className={label}>원금 {action === '상환' ? '상환액' : '차입액'}</label><input type="text" inputMode="numeric" className={field} value={formatMoneyInput(principal)} onChange={e => changeLoanAmount(e.currentTarget, 'principal', principal, setPrincipal)} aria-invalid={!!amountErrors.principal} required/>{amountErrors.principal && <p role="alert" className="mt-1 text-xs text-rose-600">{amountErrors.principal}</p>}</div>
        {action === '상환' && <div><label className={label}>이자 비용</label><input type="text" inputMode="numeric" className={field} value={formatMoneyInput(interest)} onChange={e => changeLoanAmount(e.currentTarget, 'interest', interest, setInterest)} aria-invalid={!!amountErrors.interest}/>{amountErrors.interest && <p role="alert" className="mt-1 text-xs text-rose-600">{amountErrors.interest}</p>}</div>}
        <div><label className={label}>적요</label><input className={field} value={note} onChange={e => setNote(e.target.value)} placeholder="선택 입력"/></div>
        <button disabled={busy} className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white disabled:opacity-50">{action} 전표 발행</button>
      </form>
    </ModalShell>}
  </div>;
}
