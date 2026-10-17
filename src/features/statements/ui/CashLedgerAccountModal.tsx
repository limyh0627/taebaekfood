import { saveConfirmedCashBalance } from '../../../shared/services/confirmedCashBalance';
import { appNotice } from '../../../shared/components/appDialog';
import { useEffect, useRef, useState } from 'react';
import { isCalendarDay, monthStart, today } from '../../../shared/day';
import { CashAccount, CashEntry, CompanyId, companyOf } from '../../../shared/types';
import { totalCashOnHand } from '../../admin/cashLedger';
import ModalShell from '../../../shared/components/ModalShell';
import { changeMoneyInput, formatMoneyInput, parseMoneyInput } from '../../../shared/moneyInput';
import { cashOpeningBalanceForCurrent } from '../../../shared/cashOpening';
import type { Props } from '../domain/cashLedger';
import { fmt } from './cashEntryDisplay';
import { ACCOUNT_ICON } from './cashAccountDisplay';

interface AccountModalProps {
  companyId?: CompanyId;
  accounts: CashAccount[];
  cashEntries?: CashEntry[];
  onClose: () => void;
  onAdd: Props['onAddCashAccount'];
  onUpdate: Props['onUpdateCashAccount'];
  onCorrect?: Props['onCorrectCashAccount'];
  onAddEntry?: Props['onAddCashEntry'];
}

export function AccountModal(props: AccountModalProps) {
  return <AccountModalContent key={props.companyId ?? 'default'} {...props} />;
}

function AccountModalContent({ companyId = 'taebaek', accounts, cashEntries = [], onClose, onAdd, onUpdate, onCorrect, onAddEntry }: AccountModalProps) {
  const [showAdd, setShowAdd] = useState(accounts.length === 0);
  const [selected, setSelected] = useState<CashAccount | null>(null);
  const [detailName, setDetailName] = useState('');
  const [detailDate, setDetailDate] = useState('');
  const [detailBalance, setDetailBalance] = useState('');
  const [detailError, setDetailError] = useState('');
  const [openingMode, setOpeningMode] = useState(!onAddEntry);
  const [adjustDate, setAdjustDate] = useState(today());
  const [adjustTarget, setAdjustTarget] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustInputInvalid, setAdjustInputInvalid] = useState(false);
  const [pendingAdjustment, setPendingAdjustment] = useState<CashEntry | null>(null);
  const [invalidPending, setInvalidPending] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const pendingKey = (accountId: string) => `cash-balance-adjustment:${companyId}:${accountId}`;

  const savingLock = useRef(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'통장' | '카드' | '현금'>('통장');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingDate, setOpeningDate] = useState(monthStart());
  const [draftId, setDraftId] = useState(() => `cashacct-${crypto.randomUUID()}`);
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!name.trim() || savingLock.current) return;
    const amount = parseMoneyInput(openingBalance);
    if (!openingDate || !Number.isSafeInteger(amount) || amount < 0 || (type === '카드' && amount !== 0)) {
      await appNotice(type === '카드' ? '카드는 기초 잔액 0원으로 등록하세요.' : '기초일과 0원 이상의 정수 잔액을 확인하세요.'); return;
    }
    savingLock.current = true; setSaving(true);
    try {
      await onAdd({ id: draftId, name: name.trim(), type, openingBalance: amount,
        openingDate, active: true, createdAt: new Date().toISOString() });
      setName(''); setOpeningBalance(''); setDraftId(`cashacct-${crypto.randomUUID()}`);
      setShowAdd(false);
    } catch (error) {
      await appNotice(`계좌를 저장하지 못했습니다. ${String(error)}`, '저장 실패');
    } finally { savingLock.current = false; setSaving(false); }
  };

  const openDetails = (account: CashAccount) => {
    setSelected(account); setDetailName(account.name); setDetailDate(account.openingDate);
    setDetailBalance(String(totalCashOnHand([account], cashEntries.filter(entry => companyOf(entry) === companyId), today())));
    setDetailError(''); setAdjustInputInvalid(false); setOpeningMode(!onAddEntry);
    let pending: CashEntry | null = null;
    let corrupt = false;
    try {
      const raw = localStorage.getItem(pendingKey(account.id));
      if (raw) {
        const saved = JSON.parse(raw) as CashEntry;
        const meta = saved?.balanceAdjustment;
        const valid = typeof saved?.id === 'string' && saved.id.startsWith('cash-adjust-')
          && saved.companyId === companyId && saved.cashAccountId === account.id
          && typeof saved.date === 'string' && isCalendarDay(saved.date) && saved.date >= account.openingDate && saved.date <= today()
          && typeof saved.createdAt === 'string' && typeof saved.note === 'string'
          && meta && (meta.confirmedBalance === undefined || typeof meta.confirmedBalance === 'boolean') && typeof meta.reason === 'string' && !!meta.reason.trim()
          && Number.isSafeInteger(meta.before) && Number.isSafeInteger(meta.target) && Number.isSafeInteger(meta.delta)
          && meta.delta !== 0 && meta.target - meta.before === meta.delta
          && saved.amount === Math.abs(meta.delta) && saved.dir === (meta.delta > 0 ? '입금' : '출금')
          && !['accountCode', 'lines', 'partnerId', 'partnerName', 'loanId', 'settlementId', 'settlements', 'statementId'].some(key => key in saved);
        if (valid) pending = saved;
        else corrupt = true;
      }
    } catch { corrupt = true; }
    setInvalidPending(corrupt);
    if (corrupt) setDetailError('저장된 조정 요청 확인이 필요합니다. 중복 요청을 막기 위해 잔액 조정을 중단했습니다.');
    setPendingAdjustment(pending);
    setAdjustDate(pending?.date ?? today());
    setAdjustTarget(String(pending?.balanceAdjustment?.target ?? totalCashOnHand([account], cashEntries.filter(entry => companyOf(entry) === companyId), today())));
    setAdjustReason(pending?.balanceAdjustment?.reason ?? '');
  };
  const beforeAdjustment = selected ? totalCashOnHand([selected], cashEntries.filter(entry => companyOf(entry) === companyId), adjustDate) : 0;
  const targetAdjustment = Number(adjustTarget);
  const adjustmentDelta = pendingAdjustment?.balanceAdjustment?.delta ?? targetAdjustment - beforeAdjustment;
  const adjust = async () => {
    if (!selected || !onAddEntry || savingLock.current || adjustInputInvalid || invalidPending) return;
    if (companyOf(selected) !== companyId || !isCalendarDay(adjustDate) || adjustDate < selected.openingDate || adjustDate > today()
        || !/^-?\d+$/.test(adjustTarget) || !Number.isSafeInteger(targetAdjustment) || !Number.isSafeInteger(beforeAdjustment)
        || !Number.isSafeInteger(adjustmentDelta) || (pendingAdjustment && adjustmentDelta === 0) || !adjustReason.trim()) {
      setDetailError('계좌 기초일 이후 오늘까지의 날짜·정수 잔액·조정 사유를 확인하세요.'); return;
    }
    savingLock.current = true; setSaving(true); setDetailError('');
    try {
      if (pendingAdjustment) {
        await onAddEntry(pendingAdjustment);
        localStorage.removeItem(pendingKey(selected.id));
      } else {
        await saveConfirmedCashBalance(companyId, selected, adjustDate, targetAdjustment, adjustReason.trim());
      }
      if (alive.current) { setPendingAdjustment(null); setSelected(null); }
    } catch (error) { if (alive.current) setDetailError(`잔액 조정을 저장하지 못했습니다. 같은 요청으로 다시 시도하세요. ${String(error)}`); }
    finally { if (alive.current) { savingLock.current = false; setSaving(false); } }
  };
  const correct = async () => {
    if (!selected || !onCorrect || savingLock.current) return;
    const raw = detailBalance.replace(/,/g, '');
    const amount = Number(raw);
    if (!detailName.trim() || !detailDate || !/^-?\d+$/.test(raw) || !Number.isSafeInteger(amount)) {
      setDetailError('이름·기준일·정수 잔액을 확인하세요.'); return;
    }
    savingLock.current = true; setSaving(true); setDetailError('');
    try {
      await onCorrect(selected, detailName.trim(), detailDate, amount);
      setSelected(null);
    } catch (error) {
      setDetailError(`계좌를 저장하지 못했습니다. ${String(error)}`);
    } finally { savingLock.current = false; setSaving(false); }
  };
  const toggleActive = async () => {
    if (!selected || savingLock.current) return;
    const nextActive = !selected.active;
    savingLock.current = true; setSaving(true); setDetailError('');
    try {
      await onUpdate(selected.id, { active: nextActive });
      setSelected({ ...selected, active: nextActive });
    } catch (error) {
      setDetailError(`사용 상태를 변경하지 못했습니다. ${String(error)}`);
    } finally { savingLock.current = false; setSaving(false); }
  };
  let openingPreview: number | undefined;
  if (selected && /^-?\d+$/.test(detailBalance)) {
    try { openingPreview = cashOpeningBalanceForCurrent(selected, cashEntries, detailDate, Number(detailBalance)); }
    catch { /* 유효한 날짜·금액을 입력한 뒤 미리보기를 표시한다. */ }
  }
  if (selected) return (
    <ModalShell title="계좌 상세" onClose={() => { if (!saving) setSelected(null); }} bodyClassName="space-y-3">
      <p className="text-xs text-slate-500">계좌 유형: {selected.type}</p>
      {!openingMode ? <>
        <h3 className="font-bold">실잔액 맞추기</h3>
        <p className="text-xs text-slate-500">선택한 날짜의 통장 잔액을 확정합니다. 이전 날짜의 거래가 나중에 입력돼도 이 날짜 잔액은 유지됩니다. 미기록 거래의 회계 분개는 별도 확인이 필요합니다.</p>
        <label className="block text-xs">조정일<input aria-label="조정일" type="date" min={selected.openingDate} max={today()} value={adjustDate} disabled={saving || !!pendingAdjustment} onChange={e => setAdjustDate(e.target.value)} className="block w-full border rounded-xl p-2" /></label>
        <label className="block text-xs">실제 잔액<input aria-label="실제 잔액" value={adjustTarget.startsWith('-') ? `-${formatMoneyInput(adjustTarget.slice(1))}` : formatMoneyInput(adjustTarget)} disabled={saving || !!pendingAdjustment} onChange={e => {
          if (/^-?[\d,]*$/.test(e.target.value)) { setAdjustTarget(e.target.value.replace(/,/g, '')); setAdjustInputInvalid(false); setDetailError(''); }
          else { setAdjustInputInvalid(true); setDetailError('잔액은 정수로 입력하세요. 소수는 사용할 수 없습니다.'); }
        }} className="block w-full border rounded-xl p-2" /></label>
        <label className="block text-xs">조정 사유<input aria-label="조정 사유" value={adjustReason} disabled={saving || !!pendingAdjustment} onChange={e => setAdjustReason(e.target.value)} className="block w-full border rounded-xl p-2" /></label>
        <p className="text-sm">조정일 장부 잔액: {fmt(pendingAdjustment?.balanceAdjustment?.before ?? beforeAdjustment)}원 · 차액: {fmt(adjustmentDelta)}원</p>
        {pendingAdjustment && <p className="text-xs text-amber-700">이전에 보낸 조정 요청을 같은 내용으로 재시도합니다.</p>}
        <button disabled={saving || invalidPending || adjustInputInvalid || !onAddEntry || (!!pendingAdjustment && adjustmentDelta === 0) || !Number.isSafeInteger(adjustmentDelta)} onClick={() => void adjust()} className="w-full rounded-xl bg-slate-800 text-white p-2 disabled:opacity-30">{saving ? '저장 중' : pendingAdjustment ? '조정 재시도' : '잔액 조정 저장'}</button>
        <button disabled={saving || !!pendingAdjustment} onClick={() => { setOpeningMode(true); setDetailError(''); }} className="w-full border rounded-xl p-2">기초잔액 수정</button>
      </> : <>
      {onAddEntry && <button disabled={saving} onClick={() => { setOpeningMode(false); setDetailError(''); }} className="w-full border rounded-xl p-2">실잔액 맞추기</button>}
      <label className="block text-xs">계좌 이름<input aria-label="계좌 이름" value={detailName} onChange={e => setDetailName(e.target.value)} disabled={saving} className="block w-full border rounded-xl p-2" /></label>
      <label className="block text-xs">잔액 기준일<input aria-label="잔액 기준일" type="date" value={detailDate} onChange={e => setDetailDate(e.target.value)} disabled={saving} className="block w-full border rounded-xl p-2" /></label>
      <label className="block text-xs">현재 잔액<input aria-label="현재 잔액" inputMode="text" value={detailBalance.startsWith('-') ? `-${formatMoneyInput(detailBalance.slice(1))}` : formatMoneyInput(detailBalance)} onChange={e => { if (/^-?[\d,]*$/.test(e.target.value)) setDetailBalance(e.target.value.replace(/,/g, '')); }} disabled={saving} className="block w-full border rounded-xl p-2" /></label>
      <p className="text-xs text-slate-500">현재 잔액은 오늘까지의 입출금을 반영한 값입니다. 기준일과 잔액을 바꾸면 기초잔액이 함께 조정됩니다.</p>
      {openingPreview !== undefined && <p className="text-xs text-slate-600">조정 후 기초잔액: {fmt(openingPreview)}원</p>}
      {!onCorrect && <p className="text-xs text-slate-500">현재 화면에서는 계좌 수정이 연결되지 않았습니다.</p>}
      <button disabled={saving || !onCorrect} onClick={() => void correct()} className="w-full rounded-xl bg-slate-800 text-white p-2 disabled:opacity-30">{saving ? '저장 중' : '저장'}</button>
      </>}
      <button disabled={saving || !!pendingAdjustment} onClick={() => void toggleActive()} className="border rounded-xl px-3 py-2">{selected.active ? '사용중' : '보관'}</button>
      {detailError && <p role="alert" className="text-sm text-rose-600">{detailError}</p>}
    </ModalShell>
  );

  return (
    <ModalShell title={showAdd ? '계좌 추가' : '자금 계좌 관리'} onClose={() => { if (!saving) { if (showAdd && accounts.length) setShowAdd(false); else onClose(); } }} bodyClassName="space-y-4">
        <p className="text-[11px] text-slate-400 leading-snug">
          <b>기초 잔액</b>은 기준일 시점의 현금·통장 잔고입니다. 회계 기초일과 같은 날짜로 등록하면 계좌원장과 회계 기초 전표에 함께 반영됩니다. 카드는 0원으로 등록하세요.
        </p>

        {!showAdd && <><button onClick={() => setShowAdd(true)} className="w-full rounded-xl bg-slate-800 text-white p-2">계좌 추가</button><div className="space-y-2">
          {accounts.map(a => {
            const Icon = ACCOUNT_ICON[a.type];
            return (
              <button key={a.id} onClick={() => openDetails(a)} className="w-full text-left flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
                <Icon size={14} className="text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-slate-800 truncate">{a.name}</p>
                  <p className="text-[10px] text-slate-400">{a.openingDate} 기준 {fmt(a.openingBalance)}원</p>
                </div>
                <span
                  className={`text-[10px] font-black px-2.5 py-1 rounded-lg ${
                    a.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-200 text-slate-400'
                  }`}>{a.active ? '사용중' : '보관'}</span>
              </button>
            );
          })}
        </div></>}

        {showAdd && <div className="border-t border-slate-100 pt-4 space-y-3">
          <p className="text-[10px] font-black text-slate-400 uppercase">계좌 추가</p>
          <div className="grid grid-cols-2 gap-2">
            <input disabled={saving} value={name} onChange={e => setName(e.target.value)} placeholder="기업은행 1234-56"
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300" />
            <select disabled={saving} value={type} onChange={e => setType(e.target.value as typeof type)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300">
              {(['통장', '카드', '현금'] as const).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input disabled={saving} inputMode="numeric" value={formatMoneyInput(openingBalance)} placeholder="기초 잔액"
              onChange={e => changeMoneyInput(e.currentTarget, setOpeningBalance)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-right text-sm font-black tabular-nums outline-none focus:ring-2 focus:ring-slate-300" />
            <input disabled={saving} type="date" value={openingDate} onChange={e => setOpeningDate(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-slate-300" />
          </div>
          <button onClick={() => void add()} disabled={!name.trim() || saving}
            className="w-full py-2.5 rounded-xl bg-slate-800 text-white text-xs font-black hover:bg-slate-900 disabled:opacity-30">
            추가
          </button>
        </div>}
    </ModalShell>
  );
}
