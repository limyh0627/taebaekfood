export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancel_pending' | 'cancelled';
export interface LeaveActor { id: string; name: string }
type LeaveStatusPatch = {
  status: LeaveStatus;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelledByName?: string;
  cancelReason?: string;
}

/** 취소 자국을 클라이언트와 서버가 같은 규칙으로 남긴다. */
export function leaveStatusPatch(next: LeaveStatus, by?: LeaveActor, reason?: string, now = new Date()): LeaveStatusPatch {
  if (next !== 'cancelled') return {status:next};
  const trimmed = (reason ?? '').trim();
  return {
    status: 'cancelled' as const,
    cancelledAt: now.toISOString(),
    ...(by ? {cancelledBy:by.id,cancelledByName:by.name} : {}),
    ...(trimmed ? {cancelReason:trimmed} : {}),
  };
}
export function canCancel(request: {status: unknown}): boolean {
  return request.status === 'approved' || request.status === 'pending' || request.status === 'cancel_pending';
}
