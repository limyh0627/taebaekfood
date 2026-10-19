import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CashAccount, CompanyId } from '../src/shared/types';
import { companyOf } from '../src/shared/types';
import { formatMoneyInput } from '../src/shared/moneyInput';
import { usePartnerPaymentRecovery } from '../src/features/statements/hooks/usePartnerPaymentRecovery';
import ModalShell from '../src/shared/components/ModalShell';
import PartnerAdvanceModal from './PartnerAdvanceModal';

type Props = { companyId: CompanyId; partnerId: string; partnerName: string; type: '매입' | '매출'; balance: number; cashAccounts: CashAccount[]; initialAmount?: number; initialDate?: string; onClose: () => void };
export default function PartnerPaymentModal({ companyId, partnerId, partnerName, type, balance, cashAccounts, initialAmount, initialDate, onClose }: Props) {
  const label = type === '매출' ? '수금' : '지불';
  const accounts = cashAccounts.filter(row => row.active && companyOf(row) === companyId);
  const payment=usePartnerPaymentRecovery({companyId,partnerId,partnerName,type,balance,cashAccounts,initialAmount,initialDate,onClose});
  const {amount,date,note,accountId,busy,ready,error}=payment;
  const [advance, setAdvance] = useState({ blocked: true, applied: false, busy: false, sourceBalance: 0, selectedAmount: 0, lookupBlocked: true, pendingUnknown: false, selectionValid: false, resetVersion: 0 });
  const [useAdvance, setUseAdvance] = useState(false),[confirmed,setConfirmed]=useState(false);
  const lastReset = useRef(0);
  const onAdvanceState = useCallback((state: { blocked: boolean; applied: boolean; busy: boolean; sourceBalance: number; selectedAmount: number; lookupBlocked: boolean; pendingUnknown: boolean; selectionValid: boolean; resetVersion: number }) => { if (state.resetVersion !== lastReset.current) { lastReset.current = state.resetVersion; setUseAdvance(false); setConfirmed(false); } setAdvance(previous => ({...state, selectedAmount: state.applied ? previous.selectedAmount : state.selectedAmount})); if (state.applied) setConfirmed(false); }, []);
  const [claimAmount] = useState(() => Number.isFinite(initialAmount) ? initialAmount! : balance);
  useEffect(() => { if (!advance.applied && Number.isFinite(claimAmount)) payment.setAmount(formatMoneyInput((Math.round(claimAmount) - (useAdvance && advance.selectionValid ? advance.selectedAmount : 0)))); }, [useAdvance, advance.selectedAmount, advance.applied, advance.selectionValid, claimAmount]);
  const blocked = !ready || busy || advance.blocked || (advance.applied && !confirmed) || (useAdvance && advance.lookupBlocked) || (useAdvance && !advance.applied);
  const close=()=>{if(!advance.busy)payment.close();};
  const entry=payment.selectedEntry;
  return <ModalShell title={partnerName + ' ' + label} onClose={close}>
    <div className="space-y-4">
      <p>원장 표시 잔액: {Number.isFinite(balance) ? balance.toLocaleString('ko-KR') + '원' : '확인 필요'}{advance.applied ? ' · 상계 후 최신 원장 반영을 확인하세요.' : ''}</p>
      {!!payment.pending.length&&<section aria-label="결과 확인이 필요한 수금·지불 요청" className="max-h-60 space-y-2 overflow-y-auto rounded border border-gray-200 p-3">
        {payment.pending.map(row=><div key={row.sidecarKey??row.key} className="space-y-1 break-words text-sm">
          <p>{row.description}</p>
          <p className="text-xs">요청 번호: {row.reference?.operationId??'읽을 수 없음'}</p>
          <button type="button" disabled={busy}
            aria-label={row.description+' · '+(row.reference?.operationId??'번호 미확인')+' · 이 요청 확인'}
            onClick={()=>payment.selectEntry(row)} className="rounded border px-3 py-2">이 요청 확인</button>
        </div>)}
      </section>}
      {entry&&<section aria-label="이전 수금·지불 원문과 복구" className="space-y-2 border-t border-gray-200 pt-3 text-sm">
        <p>이전 요청을 현재 잔액이나 날짜로 바꾸지 않습니다.</p>
        {entry.request?<p>원래 요청: {entry.request.amount.toLocaleString('ko-KR')}원 · {entry.request.tradeDate} · 계좌 {entry.request.cashAccountId}</p>:<p>요청 원문을 읽지 못했습니다. 금액·날짜·계좌를 추정해 다시 보내지 않습니다.</p>}
        <div className="flex flex-wrap gap-2">
          {entry.reference&&<><button type="button" disabled={busy} onClick={()=>void payment.inspect(entry)} className="rounded border px-3 py-2">결과 확인</button><button type="button" disabled={busy} onClick={()=>void payment.cancel(entry)} className="rounded border px-3 py-2">미처리 요청 중단</button></>}
          {payment.canRetryEntry(entry)&&<button type="button" disabled={busy} onClick={()=>void payment.retry(entry)} className="rounded border px-3 py-2">같은 요청 재시도</button>}
          {payment.canDiscardEntry(entry)&&<button type="button" disabled={busy} onClick={()=>void payment.discardCopy(entry)} className="rounded border px-3 py-2">이 기기 사본 정리</button>}
        </div>
        <p className="text-xs">요청 중단은 미처리 요청의 늦은 실행을 막습니다. 이미 반영된 입출금이나 상계를 되돌리지 않습니다.</p>
        {!entry.reference&&<><p>이 사본은 요청 번호를 읽을 수 없어 서버 요청과 동일하다고 판단할 수 없습니다. 사본 정리는 서버 중단이나 입출금 취소를 뜻하지 않습니다.</p><button type="button" disabled={busy} onClick={()=>void payment.loadHistory()} className="rounded border px-3 py-2">서버 처리 이력 확인</button></>}
      </section>}
      {!!payment.history.length&&<section aria-label="거래처 서버 처리 이력" className="max-h-60 space-y-2 overflow-y-auto rounded border border-gray-200 p-3 text-sm">
        <p>현재 회사·계정·거래처의 처리 이력입니다. 선택한 사본과 같은 요청이라고 자동 판단하지 않습니다.</p>
        {payment.history.map(result=><div key={result.reference.operationId} className="space-y-1 break-words border-t border-gray-200 pt-2">
          <p>요청 번호: {result.reference.operationId}</p>
          <p>{result.message}{result.docNo?' · 전표 '+result.docNo:''}</p>
          {result.tradeDate!==undefined&&<p>원래 날짜: {result.tradeDate}</p>}
          {result.amount!==undefined&&<p>최초 금액: {result.amount.toLocaleString('ko-KR')}원</p>}
          {result.cashAccountId!==undefined&&<p>원래 계좌: {result.cashAccountId}</p>}
          {result.createdAt!==undefined&&<p>최초 요청 시각: {result.createdAt}</p>}
          <button type="button" disabled={busy} onClick={()=>void payment.inspectHistory(result)}
            className="rounded border px-3 py-2">{result.reference.operationId} 결과 확인</button>
          <button type="button" disabled={busy} onClick={()=>void payment.cancelHistory(result)}
            className="rounded border px-3 py-2">{result.reference.operationId} 미처리 요청 중단</button>
        </div>)}
        {payment.historyMore&&<button type="button" disabled={busy} onClick={()=>void payment.nextHistory()} className="rounded border px-3 py-2">다음 20건</button>}
      </section>}
      <p>사용 가능한 {type === '매입' ? '선급금' : '선수금'}: {advance.lookupBlocked ? '조회 확인 필요' : advance.sourceBalance.toLocaleString('ko-KR') + '원'}</p>
      <label className="block"><input type="checkbox" checked={useAdvance} disabled={busy || payment.locked || advance.busy || advance.applied} onChange={event => setUseAdvance(event.target.checked)} /> 선급·선수금 사용</label>
      {advance.pendingUnknown && <p role="alert">보관된 상계 요청을 읽지 못해 처리 여부를 확인할 수 없습니다. 요청 원문을 확인한 뒤 다시 여세요. 현금 결제는 보류합니다.</p>}
      {useAdvance && !advance.selectionValid && !advance.applied && <p role="alert">상계 금액을 원천·대상 잔액과 이번 정산액 이내로 확인하세요.</p>}
      {useAdvance && (advance.selectionValid || advance.applied) && <p>예정 상계 {advance.selectedAmount.toLocaleString('ko-KR')}원 · 실제 {label} 예정 {amount || '0'}원</p>}
      <div hidden={!useAdvance}><PartnerAdvanceModal companyId={companyId} partnerId={partnerId} partnerName={partnerName} embedded sourceCode={type === '매입' ? '133' : '254'} maxApplicationAmount={claimAmount} externalBusy={busy || payment.locked || !useAdvance} onStateChange={onAdvanceState} onClose={close} /></div>
      <section className="space-y-3 border-t border-gray-200 pt-4" aria-label="실제 현금 결제">
        <h4 className="font-bold">실제 현금 {label}</h4>
        <p className="text-sm text-gray-600">상계액과 별개로 실제 입출금할 금액만 입력하세요. 상계만 하면 현금 기록 없이 닫으세요.</p>
        {advance.applied && <label className="block"><input type="checkbox" checked={confirmed} disabled={advance.blocked || busy || payment.locked} onChange={event => setConfirmed(event.target.checked)} /> 상계가 반영된 내역을 확인했고 아래 현금 금액을 직접 확인했습니다.</label>}
        <fieldset disabled={blocked || payment.locked} className="space-y-3">
          <label className="block">{label} 금액<input aria-label={label + ' 금액'} inputMode="numeric" value={amount} onChange={event => payment.setAmount(formatMoneyInput(event.target.value))} className="block w-full rounded-lg border border-gray-300 p-2" /></label>
          <button type="button" disabled title="최신 원장 반영을 확인한 뒤 현금 금액을 직접 입력하세요.">전액 넣기 (잔액 확인 후 직접 입력)</button>
          <label className="block">날짜<input type="date" aria-label={label + ' 날짜'} value={date} onChange={event => payment.setDate(event.target.value)} className="block w-full rounded-lg border border-gray-300 p-2" /></label>
          <label className="block">입출금 계좌<select aria-label="입출금 계좌" value={accountId} onChange={event => payment.setAccountId(event.target.value)} className="block w-full rounded-lg border border-gray-300 p-2"><option value="">계좌 선택</option>{accounts.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}{accountId&&!accounts.some(row=>row.id===accountId)&&<option value={accountId}>이전 요청 계좌: {accountId}</option>}</select></label>
          <label className="block">메모<input placeholder="계좌이체 등" value={note} onChange={event => payment.setNote(event.target.value)} className="block w-full rounded-lg border border-gray-300 p-2" /></label>
        </fieldset>
        {!ready&&!error&&payment.blockedReason&&<p role="status">{payment.blockedReason}</p>}
        {busy&&<p role="status">{label} 처리 결과를 확인하고 있습니다. 완료 응답을 기다려 주세요.</p>}
        {payment.message&&<p role="status" className="whitespace-pre-line text-sm">{payment.message}</p>}
        {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
        {payment.readFailed&&<button type="button" disabled={busy} onClick={()=>void payment.refresh()} className="rounded border px-3 py-2">이전 요청 다시 읽기</button>}
        <div className="flex gap-2"><button type="button" disabled={busy || advance.busy} onClick={close} className="rounded-lg border px-3 py-2">닫기</button>{!entry&&<button type="button" disabled={blocked || payment.locked} onClick={()=>{if(!blocked&&!payment.locked)void payment.save();}} className="rounded-lg bg-indigo-600 px-3 py-2 text-white">{busy ? '저장 중…' : label + ' 기록'}</button>}</div>
      </section>
    </div>
  </ModalShell>;
}