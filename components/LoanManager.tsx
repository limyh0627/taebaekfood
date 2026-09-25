import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type { CashAccount, CashEntry, CompanyId, Partner } from '../src/shared/types';
import { companyOf } from '../src/shared/types';
import { today } from '../src/shared/day';
import { stampFor } from '../src/shared/voucherStamp';
import { STANDARD_ACCOUNT } from '../src/shared/accountChart';
import { splitCashEntry } from '../src/shared/splitEntry';
import { isFinancial } from '../src/shared/partnerRole';
import { loanBalance, loanMovements, type LoanContract } from '../src/shared/loanLedger';
import { addItem, fetchWhere } from '../src/shared/services/firebaseService';
import { appConfirm, appNotice } from '../src/shared/components/appDialog';
import ModalShell from '../src/shared/components/ModalShell';

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
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState('');
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

  const refresh = async () => {
    setLoading(true);
    try {
      setLoans(await fetchWhere<LoanContract>('loanContracts', 'companyId', companyId));
    } catch (error) {
      await appNotice(`대출 목록을 불러오지 못했습니다. ${String(error)}`, '조회 실패');
    } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [companyId]);

  const selected = loans.find(loan => loan.id === selectedId);
  const rows = useMemo(() => selected ? loanMovements(selected, cashEntries) : [], [selected, cashEntries]);
  const availableAccounts = cashAccounts.filter(a => a.active && a.type === '통장');

  const createLoan = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(openingPrincipal);
    if (!name.trim() || !lenderName.trim() || !openingDate || !Number.isFinite(amount) || amount < 0) {
      await appNotice('대출명·금융기관·시작일·0원 이상의 시작 원금을 입력하세요.'); return;
    }
    if (!await appConfirm({ title: '대출 등록', message: `${name.trim()}의 ${openingDate} 시작 원금 ${won(amount)}을 등록할까요? 회계 기초잔액이나 기존 전표는 바뀌지 않습니다.`, confirmText: '등록' })) return;
    setBusy(true);
    try {
      const id = `loan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await addItem('loanContracts', {
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
    const p = Number(principal), i = action === '상환' ? Number(interest) : 0;
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
        <button type="button" onClick={() => setShowNew(true)} className="flex items-center gap-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white"><Plus size={16}/> 대출 등록</button></div>
    </div>
    <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">기존 전표는 자동으로 대출에 배정하지 않습니다. 시작 원금은 대출별 조회 기준이며 회계 기초잔액을 변경하지 않습니다.</p>
    {loading ? <p className="p-8 text-center text-slate-400">불러오는 중…</p> : loans.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">등록된 대출이 없습니다.</p> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{loans.map(loan => {
      const balance = loanBalance(loan, cashEntries);
      return <button key={loan.id} type="button" onClick={() => setSelectedId(loan.id)} className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-300">
        <div className="flex justify-between gap-2"><strong className="text-sm text-slate-900">{loan.name}</strong><span className="text-xs text-slate-500">{loan.accountCode === '260' ? '단기' : '장기'}</span></div>
        <p className="mt-1 text-xs text-slate-500">{loan.lenderName}</p><p className="mt-4 text-xs text-slate-500">원금 잔액</p><p className="text-xl font-black text-slate-900">{won(balance)}</p>
        <p className="mt-2 text-xs text-slate-400">{loan.openingDate} 시작 · 거래 {loanMovements(loan, cashEntries).length}건</p>
      </button>;
    })}</div>}
    {showNew && <ModalShell title="대출 등록" subtitle="대출별 시작 원금은 회계 분개와 별도로 관리합니다" onClose={() => setShowNew(false)}>
      <form onSubmit={e => void createLoan(e)} className="space-y-4">
        <div><label className={label}>대출명</label><input className={field} value={name} onChange={e => setName(e.target.value)} placeholder="예: 운전자금 대출 1호" required/></div>
        <div><label className={label}>금융기관</label><input className={field} value={lenderName} onChange={e => { setLenderName(e.target.value); setPartnerId(''); }} placeholder="은행명" required/></div>
        <div><label className={label}>등록된 금융기관 연결 (선택)</label><select className={field} value={partnerId} onChange={e => { setPartnerId(e.target.value); const p = partners.find(row => row.id === e.target.value); if (p) setLenderName(p.name); }}><option value="">선택 안 함</option>{partners.filter(p => companyOf(p) === companyId && isFinancial(p)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><label className={label}>계정</label><select className={field} value={accountCode} onChange={e => setAccountCode(e.target.value as '260' | '293')}><option value="260">260 단기차입금</option><option value="293">293 장기차입금</option></select></div><div><label className={label}>만기일 (선택)</label><input type="date" className={field} value={maturityDate} onChange={e => setMaturityDate(e.target.value)}/></div></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><label className={label}>잔액 기준일</label><input type="date" className={field} value={openingDate} onChange={e => setOpeningDate(e.target.value)} required/></div><div><label className={label}>그날 시작 원금</label><input type="number" min="0" step="1" className={field} value={openingPrincipal} onChange={e => setOpeningPrincipal(e.target.value)} required/></div></div>
        <button disabled={busy} className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white disabled:opacity-50">등록</button>
      </form>
    </ModalShell>}
    {selected && <ModalShell title={selected.name} subtitle={`${selected.lenderName} · ${selected.accountCode === '260' ? '단기차입금' : '장기차입금'}`} onClose={() => setSelectedId('')}>
      <div className="space-y-4"><div className="rounded-xl border border-slate-200 p-4"><p className="text-xs text-slate-500">현재 원금 잔액</p><p className="text-2xl font-black text-slate-900">{won(loanBalance(selected, cashEntries))}</p><p className="mt-1 text-xs text-slate-400">시작 {selected.openingDate} · {won(selected.openingPrincipal)}{selected.maturityDate ? ` · 만기 ${selected.maturityDate}` : ''}</p></div>
        <div className="flex gap-2"><button className="flex-1 rounded-xl border border-indigo-200 px-3 py-2.5 text-sm font-bold text-indigo-700" onClick={() => { setDate(today()); setCashAccountId(availableAccounts[0]?.id ?? ''); setAction('차입'); }}>차입 기록</button><button className="flex-1 rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-bold text-white" onClick={() => { setDate(today()); setCashAccountId(availableAccounts[0]?.id ?? ''); setAction('상환'); }}>원금·이자 상환</button></div>
        <div><h3 className="mb-2 text-sm font-bold text-slate-700">거래 내역</h3>{rows.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">연결된 전표가 없습니다.</p> : <div className="divide-y divide-slate-100 border-y border-slate-100">{[...rows].reverse().map(row => <div key={row.entry.id} className="flex items-center justify-between gap-2 py-3 text-sm"><div><p className="font-semibold text-slate-800">{row.entry.date} · {row.entry.note || row.entry.docNo || '자금전표'}</p><p className="text-xs text-slate-400">{row.entry.docNo || row.entry.id}</p></div><span className={row.principalDelta >= 0 ? 'font-bold text-indigo-600' : 'font-bold text-slate-700'}>{row.principalDelta > 0 ? '+' : ''}{won(row.principalDelta)}</span></div>)}</div>}</div>
      </div>
    </ModalShell>}
    {selected && action && <ModalShell title={`${selected.name} ${action}`} subtitle="이 화면에서 발행한 전표는 해당 대출에 자동 연결됩니다" onClose={() => setAction(null)} layer={1100}>
      <form onSubmit={e => void saveMovement(e)} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><div><label className={label}>거래일</label><input type="date" className={field} value={date} onChange={e => setDate(e.target.value)} required/></div><div><label className={label}>통장</label><select className={field} value={cashAccountId} onChange={e => setCashAccountId(e.target.value)} required><option value="">선택</option>{availableAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div></div>
        <div><label className={label}>원금 {action === '상환' ? '상환액' : '차입액'}</label><input type="number" min="0" step="1" className={field} value={principal} onChange={e => setPrincipal(e.target.value)} required/></div>
        {action === '상환' && <div><label className={label}>이자 비용</label><input type="number" min="0" step="1" className={field} value={interest} onChange={e => setInterest(e.target.value)}/></div>}
        <div><label className={label}>적요</label><input className={field} value={note} onChange={e => setNote(e.target.value)} placeholder="선택 입력"/></div>
        <button disabled={busy} className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white disabled:opacity-50">{action} 전표 발행</button>
      </form>
    </ModalShell>}
  </div>;
}
