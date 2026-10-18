import type { LeaveRequest } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';
import { leaveActionLabel, type LeaveMutationAction } from '../../../shared/leaveRequestCommand';
import type { PendingLeaveAction } from '../infrastructure/leaveRequestWrites';
import { useLeaveApplication } from './useLeaveApplication';
export type { PendingLeaveAction } from '../infrastructure/leaveRequestWrites';
export interface LeaveActionBindings {
  requestScopeKey?: string;
  onLeaveAction?: (row: LeaveRequest, action: LeaveMutationAction) => Promise<SaveOutcome | void> | SaveOutcome | void;
  onReadPendingLeaveActions?: () => PendingLeaveAction[];
  onInspectLeaveAction?: (planId: string) => Promise<SaveOutcome>;
  onCancelLeaveAction?: (planId: string) => Promise<SaveOutcome>;
  onReadLeaveReferences?: () => {
    planId: string;
    readable: boolean;
  }[];
  onCancelLeaveReference?: (planId: string) => Promise<SaveOutcome>;
}
export interface LeaveActionsOptions {
  scopeKey: string;
  onAction?: LeaveActionBindings['onLeaveAction'];
  readPending?: LeaveActionBindings['onReadPendingLeaveActions'];
  inspect?: LeaveActionBindings['onInspectLeaveAction'];
  cancel?: LeaveActionBindings['onCancelLeaveAction'];
  readReferences?: LeaveActionBindings['onReadLeaveReferences'];
  cancelReference?: LeaveActionBindings['onCancelLeaveReference'];
}
export function useLeaveActions(options: LeaveActionsOptions) {
  const application: ReturnType<typeof useLeaveApplication<PendingLeaveAction>> = useLeaveApplication<PendingLeaveAction>({
    scopeKey: options.scopeKey,
    allowDifferentId: true,
    submit: async entry => {
      if (entry.row) {
        const outcome = await options.onAction?.(entry.row, entry.action);
        try {
          entry.planId = options.readPending?.().find(p => p.id === entry.id)?.planId;
        } catch {}
        return outcome;
      }
      return {
        status: 'unknown',
        message: '보관된 휴가 요청은 새로 전송하지 않습니다.',
        nextAction: '결과 확인 또는 요청 중단을 선택해 주세요.'
      };
    },
    inspect: () => application.pending?.planId && options.inspect ? options.inspect(application.pending.planId) : Promise.resolve({
      status: 'unknown',
      message: '보관된 변경 계획을 다시 열어 결과를 확인해 주세요.',
      nextAction: '보관 요청 목록에서 원래 계획을 선택해 주세요.'
    }),
    cancel: () => application.pending?.planId && options.cancel ? options.cancel(application.pending.planId) : Promise.resolve({
      status: 'unknown',
      message: '보관된 변경 계획을 다시 열어 중단해 주세요.',
      nextAction: '보관 요청 목록에서 원래 계획을 선택해 주세요.'
    }),
    readPending: options.readPending,
    readReferences: options.readReferences,
    cancelReference: options.cancelReference
  });
  const run = async (row: LeaveRequest, action: LeaveMutationAction) => {
    if (application.busy) return {
      committed: false,
      cancelled: false
    };
    let stored: PendingLeaveAction[];
    try {
      stored = options.readPending?.() ?? [];
    } catch {
      application.notice({
        status: 'rejected',
        message: '보관된 휴가 요청을 읽지 못해 새 요청을 전송하지 않았습니다.',
        nextAction: '브라우저 저장소 접근을 확인하고 보관 요청의 결과 확인 또는 요청 중단을 선택해 주세요.'
      });
      return {
        committed: false,
        cancelled: false
      };
    }
    const prior = [...stored, ...application.pendingRequests].find(entry => entry.id === row.id);
    if (prior) {
      application.reopen(prior);
      return {
        committed: false,
        cancelled: false
      };
    }
    if (!options.onAction) {
      application.notice({
        status: 'rejected',
        message: '휴가 저장 기능이 연결되지 않아 전송하지 않았습니다.',
        nextAction: '화면을 새로고침한 뒤 관리자에게 연결 상태를 확인해 주세요.'
      });
      return {
        committed: false,
        cancelled: false
      };
    }
    return application.submit({
      id: row.id,
      row,
      action,
      description: `${row.employeeName} · ${row.startDate} · ${leaveActionLabel(action.action)}`
    });
  };
  return {
    busy: application.busy,
    busyId: application.busy ? application.pending?.id ?? null : null,
    message: application.message,
    pendingAction: application.pending,
    pendingActions: application.pendingRequests,
    damagedReferences: application.damagedReferences,
    run,
    openPending: application.reopen,
    inspect: application.inspect,
    cancel: application.cancel,
    cancelDamaged: application.cancelDamaged,
    close: application.close
  };
}
