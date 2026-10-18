import React from 'react';
import ConfirmModal from './ConfirmModal';
import type { useDirectoryDelete } from '../hooks/useDirectoryDelete';
type DirectoryDeleteController = ReturnType<typeof useDirectoryDelete>;
interface Props {
    controller: DirectoryDeleteController;
    onConfirmed?: (targetId: string) => void;
}
/** 모든 삭제 동선은 같은 확인창과 실제 요청의 결과 확인·중단을 제공한다. */
export default function DirectoryDeleteDialogs({ controller, onConfirmed }: Props) {
    const { session, busy, message } = controller;
    const modalMessage = controller.sessionMessage;
    const modalOutcome = controller.sessionOutcome;
    const activePlan = session?.reference?.planId;
    const pending = controller.pending.filter(row => row.reference.planId !== activePlan);
    const damaged = controller.references.filter(row => !row.readable && (!activePlan || row.reference?.planId !== activePlan));
    const actions = (reference: NonNullable<typeof session>['reference']) => reference && <div className="flex flex-wrap gap-2">
  <button type="button" disabled={busy} onClick={() => void controller.inspect(reference)} className="rounded border border-slate-200 px-3 py-2 text-xs">결과 확인</button>
  <button type="button" disabled={busy} onClick={() => void controller.cancel(reference)} className="rounded border border-slate-200 px-3 py-2 text-xs">요청 중단</button>
 </div>;
    const confirm = async () => { const targetId = session?.input.targetId; if (targetId && await controller.confirm()) {
        if (await controller.close())
            onConfirmed?.(targetId);
    } };
    const recovery = !!session?.reference && !session.ready;
    const terminal = !!modalOutcome && (modalOutcome.status === 'saved' || !!modalOutcome.requiresReopen);
    const name = session && typeof session.input.opening.name === 'string' ? session.input.opening.name : session?.input.targetId;
    return <>
  {(!session || message !== modalMessage) && message && <p role="status" className="whitespace-pre-line border-t border-slate-200 py-3 text-sm text-slate-600">{message}</p>}
  {(pending.length > 0 || damaged.length > 0) && <section aria-label="처리 결과 확인이 필요한 삭제" className="space-y-2 rounded-lg border border-slate-200 p-3">
   <h3 className="text-sm font-bold text-slate-700">처리 결과 확인이 필요한 삭제</h3>
   {pending.map(row => <div key={row.reference.planId} className="flex flex-wrap items-center gap-2 text-xs"><span>{row.description}</span>{actions(row.reference)}</div>)}
   {damaged.map(row => <div key={row.key} className="flex flex-wrap items-center gap-2 text-xs"><span>요청 원문을 읽지 못했습니다. 대상 번호: {row.reference?.targetId ?? '읽을 수 없어 확인이 필요합니다. 다른 대상 작업은 계속할 수 있습니다.'}</span>{actions(row.reference ?? undefined)}</div>)}
  </section>}
  {session && <ConfirmModal title="삭제 확인" message={`'${name}' ${session.input.kind === 'employee' ? '직원' : '거래처'} 정보를 삭제하시겠습니까?`} subMessage="선택한 대상의 현재 원문을 먼저 확인합니다. 명시적으로 삭제를 누르기 전에는 삭제하지 않습니다." confirmText={busy ? '처리 중…' : recovery ? '확인창 닫기' : '삭제'} confirmDisabled={busy || (!recovery && (!session.ready || !!modalOutcome))} confirmOnly={!session.ready && !!session.reference} onConfirm={() => { if (recovery)
            void controller.close();
        else
            void confirm(); }} onCancel={() => { void controller.close(); }} body={<div className="mt-3 space-y-3">{modalMessage && <p role="status" className="whitespace-pre-line text-xs text-slate-600">{modalMessage}</p>}{session.reference && !session.ready && !terminal && actions(session.reference)}</div>}/>}
 </>;
}
