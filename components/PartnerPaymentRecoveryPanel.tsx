import React from 'react';
import type { usePartnerPaymentRecovery } from '../src/features/statements/hooks/usePartnerPaymentRecovery';

export type PartnerPaymentRecoveryController = Pick<ReturnType<typeof usePartnerPaymentRecovery>, 'pending' | 'selectedEntry' | 'selectEntry' | 'busy' | 'inspect' | 'cancel' | 'retry' | 'discardCopy' | 'canRetryEntry' | 'canDiscardEntry' | 'history' | 'historyMore' | 'loadHistory' | 'nextHistory' | 'inspectHistory' | 'cancelHistory' | 'message' | 'error' | 'readFailed' | 'refresh' | 'blockedReason' | 'ready'>;

/** 작성·상계와 독립적으로 보관된 최초 수금 요청만 확인한다. */
export default function PartnerPaymentRecoveryPanel({payment}: {payment:PartnerPaymentRecoveryController}) {
  const {busy,selectedEntry:entry}=payment;
  return <>
      {!payment.ready&&!payment.error&&payment.blockedReason&&<p role="status">{payment.blockedReason}</p>}
      {payment.message&&<p role="status" className="whitespace-pre-line text-sm">{payment.message}</p>}
      {payment.error&&<p role="alert" className="text-sm text-red-700">{payment.error}</p>}
      {!!payment.pending.length&&!payment.message&&!payment.error&&<p role="status">이전 요청의 결과를 아직 확인하지 않았습니다. 보관된 원문을 선택하고 서버 결과부터 확인해 주세요.</p>}
      {(payment.pending.length>0||payment.message||payment.error)&&<p className="text-sm">현재 입력은 이전 요청의 처리 결과가 아닙니다. 결과와 남은 조치를 확인한 뒤 필요한 새 업무만 명시적으로 저장해 주세요.</p>}
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
        {!entry.reference&&<><p>이 사본은 요청 번호를 읽을 수 없어 서버 요청과 동일하다고 판단할 수 없습니다. 사본 정리는 서버 중단이나 입출금 취소를 뜻하지 않습니다.</p></>}
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
      {!payment.history.length&&payment.historyMore&&<button type="button" disabled={busy} onClick={()=>void payment.nextHistory()} className="rounded border px-3 py-2">다음 20건</button>}
      {payment.ready&&<button type="button" disabled={busy} onClick={()=>void payment.loadHistory()} className="rounded border px-3 py-2">서버 처리 이력 확인</button>}
      {payment.readFailed&&<button type="button" disabled={busy} onClick={()=>void payment.refresh()} className="rounded border px-3 py-2">이전 요청 다시 읽기</button>}
  </>;
}
