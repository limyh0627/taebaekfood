import React from 'react';
import ModalShell from '../src/shared/components/ModalShell';
import type { CompanyId, PreparedPartnerAdvance } from '../src/shared/partnerAdvance';
import { saveOutcomeMessage } from '../src/shared/saveOutcome';
import { usePartnerAdvanceRecovery, advanceSourceKey as sourceKey, advanceTargetKey as targetKey } from '../src/features/statements/hooks/usePartnerAdvanceRecovery';

type Props = { companyId: CompanyId; partnerId: string; partnerName: string; onClose: () => void; embedded?: boolean; showApplication?: boolean; sourceCode?: '133' | '254'; maxApplicationAmount?: number; externalBusy?: boolean; onStateChange?: (state: { blocked: boolean; applied: boolean; busy: boolean; sourceBalance: number; selectedAmount: number; lookupBlocked: boolean; pendingUnknown: boolean; selectionValid: boolean; resetVersion: number }) => void };
const money = (value: number) => value.toLocaleString('ko-KR')+'원';

export default function PartnerAdvanceModal({ companyId, partnerId, partnerName, onClose, embedded = false, showApplication = true, sourceCode, maxApplicationAmount = Infinity, externalBusy = false, onStateChange }: Props) {
  const recovery = usePartnerAdvanceRecovery({companyId, partnerId, sourceCode, maxApplicationAmount, externalBusy, embedded, onClose, onStateChange});
  const {data, sourceId, targetId, amount, date, applied, busy, loading, error, refreshFailed, sources, source, targets, target, selectionValid, blocked} = recovery;
  const submit = (application?: PreparedPartnerAdvance['applications'][number]) => recovery.submit(application);
  const actions = <div className="flex gap-2"><button type="button" disabled={busy || externalBusy} onClick={() => recovery.close()} className="flex-1 rounded-xl border px-4 py-3">닫기</button><button type="button" disabled={blocked || (embedded && applied) || !source || !target} onClick={() => void submit()} className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white disabled:opacity-40">{busy ? '처리 중…' : '확인하고 적용'}</button></div>;
  const content = <>
    {recovery.readLoading && <p role="status" className="text-sm text-slate-600">보관된 상계 요청을 읽고 있습니다.</p>}
    {recovery.readError && <div className="space-y-2"><p role="alert" className="text-sm text-slate-700">{recovery.readError}</p><button type="button" disabled={busy} onClick={() => void recovery.refresh()} className="rounded border border-slate-200 px-3 py-2 text-xs">상계 보관 요청 다시 읽기</button></div>}
    {error && <p role="alert" className="whitespace-pre-line text-sm text-slate-700">{error}</p>}
    {recovery.message && <p role="status" className="whitespace-pre-line text-sm text-slate-600">{recovery.message}</p>}
    {refreshFailed && <button type="button" disabled={busy || externalBusy} onClick={() => void recovery.refreshBalances()} className="rounded border border-slate-200 px-3 py-2 text-xs">잔액 다시 조회</button>}
    {recovery.operations.length > 0 && <section aria-label="보관된 상계 요청 복구" className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <h4 className="text-sm font-bold">보관된 상계 요청</h4>
      <p className="text-xs text-slate-600">결과 확인은 조회만 합니다. 미처리 요청 중단은 이미 완료된 상계의 적용 취소와 다릅니다.</p>
      {recovery.operations.map(entry => {
        const result = recovery.resultFor(entry);
        return <article key={entry.key} className="space-y-2 border-t border-slate-200 pt-3 text-sm">
          <p className="font-semibold">{entry.description}</p>
          {entry.reference && <p className="text-xs text-slate-500">요청 번호: {entry.reference.operationId}</p>}
          {entry.request && <p className="text-xs text-slate-600">원래 요청: {entry.request.action === 'cancel' ? '완료된 상계 적용 취소' : '상계 적용'} · {entry.request.input.date}{'amount' in entry.request.input ? ' · '+money(entry.request.input.amount) : ''}</p>}
          {result && <p className="whitespace-pre-line text-slate-600">{result.serverResult?.message || saveOutcomeMessage(result.outcome)}</p>}
          {result?.copyMismatch && <p className="text-xs text-slate-600">서버 결과를 현재 사본의 성공으로 처리하지 않았습니다. 원문을 보존한 채 이 기기 사본만 명시적으로 정리할 수 있습니다.</p>}
          {!entry.reference && <p className="text-xs text-slate-600">요청을 식별할 수 없어 서버 처리 여부나 중단은 확인하지 못했습니다. 원문과 서버 이력을 대조하고 현재 장부도 직접 확인해 주세요.</p>}
          {entry.bodyText !== null && <details><summary>보관 원문 보기</summary><textarea aria-label={entry.description+' 보관 원문'} readOnly value={entry.bodyText} className="mt-2 w-full rounded border border-slate-200 p-2 text-xs"/></details>}
          <div className="flex flex-wrap gap-2">
            {entry.reference && <button type="button" disabled={busy || externalBusy} onClick={() => void recovery.inspect(entry)} className="rounded border border-slate-200 px-3 py-2 text-xs">상계 결과 확인</button>}
            {recovery.canRetry(entry) && <button type="button" disabled={busy || externalBusy} onClick={() => void recovery.retry(entry)} className="rounded border border-slate-200 px-3 py-2 text-xs">같은 상계 요청 재시도</button>}
            {recovery.canStop(entry) && <button type="button" disabled={busy || externalBusy} onClick={() => void recovery.stop(entry)} className="rounded border border-slate-200 px-3 py-2 text-xs">미처리 상계 요청 중단</button>}
            {recovery.canDiscard(entry) && <button type="button" disabled={busy || externalBusy} onClick={() => void recovery.discardCopy(entry)} className="rounded border border-slate-200 px-3 py-2 text-xs">{entry.reference ? '상계 기기 사본만 정리' : '식별 불가 상계 사본만 정리'}</button>}
          </div>
        </article>;
      })}
    </section>}
    <section aria-label="거래처 상계 처리 이력" className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <button type="button" disabled={recovery.historyLoading} onClick={() => void recovery.loadHistory()} className="rounded border border-slate-200 px-3 py-2 text-xs">서버 상계 이력 조회</button>
      {recovery.historyLoading && <p role="status" className="text-sm text-slate-600">상계 이력을 조회하고 있습니다.</p>}
      {recovery.historyError && <p role="alert" className="text-sm text-slate-600">{recovery.historyError}</p>}
      {recovery.history.map(result => <article key={result.reference.operationId} className="space-y-1 border-t border-slate-200 pt-2 text-sm"><p className="font-semibold">{result.docNo || result.reference.operationId}{result.action ? ' · '+(result.action === 'cancel' ? '상계 적용 취소' : '상계 적용') : ''}</p>{result.date && <p>원래 날짜: {result.date}</p>}{result.amount !== undefined && <p>확인된 금액: {money(result.amount)}</p>}<p className="whitespace-pre-line text-slate-600">{result.message}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || externalBusy} onClick={() => void recovery.inspectHistory(result)} className="rounded border border-slate-200 px-3 py-2 text-xs">이력 결과 확인</button>{result.status === 'unknown' && <button type="button" disabled={busy || externalBusy} onClick={() => void recovery.stopHistory(result)} className="rounded border border-slate-200 px-3 py-2 text-xs">이력 미처리 요청 중단</button>}</div></article>)}
      {recovery.historyMore && <><p className="text-sm text-slate-600">더 확인할 상계 요청이 있습니다.</p><button type="button" disabled={recovery.historyLoading} onClick={() => void recovery.nextHistory()} className="rounded border border-slate-200 px-3 py-2 text-xs">다음 상계 이력 확인</button></>}
    </section>

    <div hidden={embedded && !showApplication} className="space-y-4">
      <p className="text-sm text-slate-500">남아 있는 내역을 오래된 순으로 선택했습니다. 적용해도 통장에서 돈이 다시 움직이지 않습니다.</p>

      {loading && <p>잔액을 확인하고 있습니다.</p>}

      {data && !data.enabled && <p className="rounded-xl border border-slate-200 p-3 text-sm">{data.blockedReason || '현재 이 회사에서 적용 기능을 준비 중입니다.'}</p>}
      <label className="block text-sm font-bold">미리 지급하거나 받은 내역<select aria-label="미리 지급하거나 받은 내역" disabled={blocked || (embedded && applied)} value={sourceId} onChange={event => recovery.pickSource(event.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="">남아 있는 내역 없음</option>{sources.map(row => <option key={sourceKey(row)} value={sourceKey(row)}>{row.date} · {row.docNo} · {row.code === '133' ? '선급금' : '선수금'} {money(row.remaining)} {row.note}</option>)}</select></label>
      <label className="block text-sm font-bold">갚을 전표<select aria-label="갚을 전표" disabled={blocked} value={targetId} onChange={event => recovery.pickTarget(event.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="">미결 전표 없음</option>{targets.map(row => <option key={targetKey(row)} value={targetKey(row)}>{row.date} · {row.docNo} · 남은 {money(row.remaining)}</option>)}</select></label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-sm font-bold">적용일<input aria-label="적용일" type="date" disabled={blocked} value={date} onChange={event => recovery.setDate(event.target.value)} className="mt-2 w-full rounded-xl border p-3" /></label><label className="text-sm font-bold">적용 금액<input aria-label="적용 금액" inputMode="numeric" disabled={blocked} value={amount} onChange={event => recovery.setAmount(event.target.value)} className="mt-2 w-full rounded-xl border p-3" /></label></div>
      {!selectionValid && amount && source && target && <p role="alert">적용 금액은 원천·대상 잔액과 이번 정산액 이내의 양수로 입력하세요.</p>}
      {source && target && <p className="text-sm text-slate-500">현재 적용 가능한 금액: {money(Math.min(source.remaining, target.remaining))}</p>}
      {!!data?.applications.length && <section className="space-y-2 border-t pt-4"><h4 className="font-bold">적용한 내역</h4>{data.applications.map(row => <div key={row.statementId} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm"><span>{row.date} · {row.docNo}<br />{money(row.amount)}</span><button type="button" disabled={blocked} onClick={() => void submit(row)} className="shrink-0 font-bold text-rose-600">적용 취소</button></div>)}</section>}
      {!!data?.diagnostics.length && <p className="text-xs text-amber-700">일부 내역은 연결 확인이 필요해 목록에서 제외했습니다.</p>}
    </div>
    {embedded && showApplication && actions}
  </>;
  return embedded ? <section aria-label="선급·선수금 상계" className="border-t border-gray-200 pt-4">{content}</section> : <ModalShell title="선급·선수금 적용" subtitle={partnerName} onClose={() => { recovery.close(); }} footer={actions}>{content}</ModalShell>;
}
