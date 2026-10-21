import React from 'react';
import ModalShell from '../../../shared/components/ModalShell';
import type { usePalletTransactionEditor } from '../hooks/usePalletTransactionEditor';
type Editor = ReturnType<typeof usePalletTransactionEditor>;
export default function PalletTransactionRecoveryPanel({ editor, buttonsOnly = false, hideButtons = false }: { editor: Editor; buttonsOnly?: boolean; hideButtons?: boolean }) {
    return <>
        {!hideButtons && <div className="flex items-center gap-2">
            {editor.failureCount > 0 && <button type="button" onClick={editor.openRecovery} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-bold text-amber-700">실패 {editor.failureCount}</button>}
            {(editor.recoveryRows.some(row => !row.isUnresolved) || editor.readError) && <button type="button" onClick={editor.openRecovery} className="rounded-lg border px-3 py-2 text-xs font-bold">{editor.readError ? '보관 요청 확인 필요' : '처리 확인'}</button>}
        </div>}
        {!buttonsOnly && editor.recoveryOpen && <ModalShell title="파렛트 등록 처리 확인" layer={1100} onClose={editor.closeRecovery}>
            <div className="space-y-4">
                <p className="text-xs text-slate-600">이 기기에 남은 등록 요청입니다. 서버의 실제 결과를 확인한 뒤 같은 요청을 다시 시도하거나 미처리 요청을 중단할 수 있습니다.</p>
                <button type="button" disabled={editor.busy || editor.readLoading} onClick={() => void editor.refresh()} className="rounded-lg border px-3 py-2 text-xs">보관 요청 다시 읽기</button>
                {editor.readError && <p role="alert">보관 요청을 읽지 못했습니다. {editor.readError}</p>}
                {editor.recoveryError && !editor.recoveryRows.some(row => row.cause === editor.recoveryError || row.referenceRows.some(ref => ref.cause === editor.recoveryError)) && <p role="alert">{editor.recoveryError}</p>}
                {editor.recoveryRows.length === 0 && !editor.readLoading && !editor.readError && <p className="text-sm text-slate-500">이 기기에 확인할 등록 요청이 없습니다.</p>}
                {editor.recoveryRows.map(row => <section key={row.entry.key} className="space-y-2 rounded-xl border p-3">
                    <h3 className="text-sm font-bold">{row.summary ? row.summary.kind : row.entry.description}</h3>
                    {row.summary && <div className="space-y-1 text-xs text-slate-600">
                        <p>{row.summary.date} · {row.summary.quantity.toLocaleString()}개{typeof row.summary.returnQty === 'number' ? ' · 회수 예정 ' + row.summary.returnQty.toLocaleString() + '개' : ''}</p>
                        <p>현재 목록 이름: {row.summary.partnerName} · {row.summary.palletName}</p>
                        {row.summary.note && <p>비고: {row.summary.note}</p>}
                    </div>}
                    <p className="text-xs font-semibold">{row.currentState}</p>
                    {row.cause && <p className="text-xs text-amber-800">{row.cause}</p>}
                    <p className="text-xs text-slate-600">{row.nextAction}</p>
                    {row.referenceRows.map(ref => <div key={JSON.stringify(ref.reference)} className="space-y-1 rounded-lg bg-slate-50 p-2">
                        <p className="text-xs font-bold">{ref.label}</p><p className="text-xs">{ref.currentState}</p>
                        {ref.cause && <p className="text-xs text-amber-800">{ref.cause}</p>}<p className="text-xs">{ref.nextAction}</p>
                        <div className="flex flex-wrap gap-2">
                            {ref.canInspect && <button type="button" disabled={editor.busy} onClick={() => void editor.inspect(row.entry, ref.reference)} className="rounded border px-2 py-1 text-xs">{ref.label} 결과 확인</button>}
                            {ref.canCancel && <button type="button" disabled={editor.busy} onClick={() => void editor.cancel(row.entry, ref.reference)} className="rounded border px-2 py-1 text-xs">{ref.label} 미처리 중단</button>}
                        </div>
                    </div>)}
                    <div className="flex flex-wrap gap-2">
                        {row.canUpgradeReference && <button type="button" disabled={editor.busy} onClick={() => void editor.upgrade(row.entry)} className="rounded border px-2 py-1 text-xs">보관 원문의 참조 보완</button>}
                        {row.canRetry && <button type="button" disabled={editor.busy} onClick={() => void editor.retry(row.entry)} className="rounded border px-2 py-1 text-xs">같은 원문으로 재시도</button>}
                        {row.canDiscard && <button type="button" disabled={editor.busy} onClick={() => void editor.discard(row.entry)} className="rounded border px-2 py-1 text-xs">{row.entry.references.length === 0 ? '이 기기의 손상 정보만 정리' : '이 기기에 남은 요청 정보 정리'}</button>}
                    </div>
                    <details className="text-xs"><summary>보관 원문 확인</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{row.entry.bodyRaw ?? '(본문 없음)'}</pre><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{row.entry.referenceRaw ?? '(참조 없음)'}</pre></details>
                </section>)}
            </div>
        </ModalShell>}
    </>;
}
