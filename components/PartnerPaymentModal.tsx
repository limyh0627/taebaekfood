import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CashAccount, CompanyId } from '../src/shared/types';
import { companyOf } from '../src/shared/types';
import { auth, authReady } from '../src/shared/firebase';
import { today } from '../src/shared/day';
import { defaultCashAccountId } from '../src/shared/defaultCashAccount';
import { formatMoneyInput, parseMoneyInput } from '../src/shared/moneyInput';
import { recordPartnerPayment } from '../src/features/statements/infrastructure/issueTradeStatementCommand';
import ModalShell from '../src/shared/components/ModalShell';
import PartnerAdvanceModal from './PartnerAdvanceModal';

type Props = { companyId: CompanyId; partnerId: string; partnerName: string; type: '매입' | '매출'; balance: number; cashAccounts: CashAccount[]; initialAmount?: number; initialDate?: string; onClose: () => void };
export default function PartnerPaymentModal({ companyId, partnerId, partnerName, type, balance, cashAccounts, initialAmount, initialDate, onClose }: Props) {
  const label = type === '매출' ? '수금' : '지불';
  const accounts = cashAccounts.filter(row => row.active && companyOf(row) === companyId);
  const [amount, setAmount] = useState(initialAmount ? formatMoneyInput(Math.round(initialAmount)) : '');
  const [date, setDate] = useState(initialDate || today()), [note, setNote] = useState('');
  const [accountId, setAccountId] = useState(() => defaultCashAccountId(accounts, companyId));
  const [advance, setAdvance] = useState({ blocked: true, applied: false, busy: false, sourceBalance: 0, selectedAmount: 0, lookupBlocked: true, pendingUnknown: false, selectionValid: false, resetVersion: 0 });
  const attempted = useRef<Parameters<typeof recordPartnerPayment>[1] | null>(null);
  const [cashPending, setCashPending] = useState(false);
  const [useAdvance, setUseAdvance] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState('');
  const live = useRef(false), saving = useRef(false), actor = useRef('');
  useEffect(() => { live.current = true; void Promise.resolve(authReady).then(() => { if (live.current) { actor.current = auth.currentUser?.uid ?? ''; setReady(!!actor.current); } }); return () => { live.current = false; }; }, []);
  const current = () => live.current && !!actor.current && auth.currentUser?.uid === actor.current;
  const lastReset = useRef(0);
  const onAdvanceState = useCallback((state: { blocked: boolean; applied: boolean; busy: boolean; sourceBalance: number; selectedAmount: number; lookupBlocked: boolean; pendingUnknown: boolean; selectionValid: boolean; resetVersion: number }) => { if (state.resetVersion !== lastReset.current) { lastReset.current = state.resetVersion; setUseAdvance(false); setConfirmed(false); } setAdvance(previous => ({...state, selectedAmount: state.applied ? previous.selectedAmount : state.selectedAmount})); if (state.applied) setConfirmed(false); }, []);
  const [claimAmount] = useState(() => Number.isFinite(initialAmount) ? initialAmount! : balance);
  useEffect(() => { if (!advance.applied && Number.isFinite(claimAmount)) setAmount(formatMoneyInput((Math.round(claimAmount) - (useAdvance && advance.selectionValid ? advance.selectedAmount : 0)))); }, [useAdvance, advance.selectedAmount, advance.applied, advance.selectionValid, claimAmount]);
  const blocked = !ready || busy || advance.blocked || (advance.applied && !confirmed) || (useAdvance && advance.lookupBlocked) || (useAdvance && !advance.applied);
  const close = () => { if (!saving.current && !advance.busy) onClose(); };
  async function save() {
    if (saving.current || blocked) return;
    if (!current()) { setError('로그인 계정이 변경됐습니다. 창을 닫고 다시 여세요.'); return; }
    const value = parseMoneyInput(amount);
    if (!Number.isFinite(value) || value <= 0) { setError('실제로 입출금할 금액을 양수로 입력하세요. 상계만 했다면 현금을 저장하지 않고 닫으세요.'); return; }
    if (!accounts.some(row => row.id === accountId)) { setError('입출금 계좌를 선택해 주세요.'); return; }
    saving.current = true; setBusy(true); setError('');
    try {
      const request: Parameters<typeof recordPartnerPayment>[1] = attempted.current ?? { tradeDate: date, partnerId, direction: type === '매출' ? '입금' : '출금', amount: value, cashAccountId: accountId, pin: false, allocations: [], note: [partnerName + ' ' + label, note].filter(Boolean).join(' · ') };
      attempted.current = request;
      await recordPartnerPayment(companyId, request);
      if (current()) onClose();
    } catch (failure) { if (current()) { setCashPending(true); setError('현금 저장 결과를 확인하지 못했습니다. 입력을 유지했습니다. ' + (failure instanceof Error ? failure.message : '보관 요청을 확인하세요.')); } }
    finally { saving.current = false; if (current()) setBusy(false); }
  }
  return <ModalShell title={partnerName + ' ' + label} onClose={close}>
    <div className="space-y-4">
      <p>원장 표시 잔액: {Number.isFinite(balance) ? balance.toLocaleString('ko-KR') + '원' : '확인 필요'}{advance.applied ? ' · 상계 후 최신 원장 반영을 확인하세요.' : ''}</p>
      <p>사용 가능한 {type === '매입' ? '선급금' : '선수금'}: {advance.lookupBlocked ? '조회 확인 필요' : advance.sourceBalance.toLocaleString('ko-KR') + '원'}</p>
      <label className="block"><input type="checkbox" checked={useAdvance} disabled={busy || cashPending || advance.busy || advance.applied} onChange={event => setUseAdvance(event.target.checked)} /> 선급·선수금 사용</label>
      {advance.pendingUnknown && <p role="alert">보관된 상계 요청을 읽지 못해 처리 여부를 확인할 수 없습니다. 요청 원문을 확인한 뒤 다시 여세요. 현금 결제는 보류합니다.</p>}
      {useAdvance && !advance.selectionValid && !advance.applied && <p role="alert">상계 금액을 원천·대상 잔액과 이번 정산액 이내로 확인하세요.</p>}
      {useAdvance && (advance.selectionValid || advance.applied) && <p>예정 상계 {advance.selectedAmount.toLocaleString('ko-KR')}원 · 실제 {label} 예정 {amount || '0'}원</p>}
      <div hidden={!useAdvance}><PartnerAdvanceModal companyId={companyId} partnerId={partnerId} partnerName={partnerName} embedded sourceCode={type === '매입' ? '133' : '254'} maxApplicationAmount={claimAmount} externalBusy={busy || cashPending || !useAdvance} onStateChange={onAdvanceState} onClose={close} /></div>
      <section className="space-y-3 border-t border-gray-200 pt-4" aria-label="실제 현금 결제">
        <h4 className="font-bold">실제 현금 {label}</h4>
        <p className="text-sm text-gray-600">상계액과 별개로 실제 입출금할 금액만 입력하세요. 상계만 하면 현금 기록 없이 닫으세요.</p>
        {advance.applied && <label className="block"><input type="checkbox" checked={confirmed} disabled={advance.blocked || busy} onChange={event => setConfirmed(event.target.checked)} /> 상계가 반영된 내역을 확인했고 아래 현금 금액을 직접 확인했습니다.</label>}
        <fieldset disabled={blocked || cashPending} className="space-y-3">
          <label className="block">{label} 금액<input aria-label={label + ' 금액'} inputMode="numeric" value={amount} onChange={event => setAmount(formatMoneyInput(event.target.value))} className="block w-full rounded-lg border border-gray-300 p-2" /></label>
          <button type="button" disabled title="최신 원장 반영을 확인한 뒤 현금 금액을 직접 입력하세요.">전액 넣기 (잔액 확인 후 직접 입력)</button>
          <label className="block">날짜<input type="date" aria-label={label + ' 날짜'} value={date} onChange={event => setDate(event.target.value)} className="block w-full rounded-lg border border-gray-300 p-2" /></label>
          <label className="block">입출금 계좌<select aria-label="입출금 계좌" value={accountId} onChange={event => setAccountId(event.target.value)} className="block w-full rounded-lg border border-gray-300 p-2"><option value="">계좌 선택</option>{accounts.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="block">메모<input placeholder="계좌이체 등" value={note} onChange={event => setNote(event.target.value)} className="block w-full rounded-lg border border-gray-300 p-2" /></label>
        </fieldset>
        {cashPending && <p>현금 요청 결과가 미확정입니다. 입력한 날짜·계좌·금액을 보존해 같은 요청으로만 다시 확인합니다. 완료된 상계는 다시 보내지 않습니다.</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-2"><button type="button" disabled={busy || advance.busy} onClick={close} className="rounded-lg border px-3 py-2">닫기</button><button type="button" disabled={blocked} onClick={() => void save()} className="rounded-lg bg-indigo-600 px-3 py-2 text-white">{busy ? '저장 중…' : label + ' 기록'}</button></div>
      </section>
    </div>
  </ModalShell>;
}
