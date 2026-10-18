import { useEffect, useRef, useState } from 'react';
import type { LeaveRequest } from '../../../shared/types';
import { primaryCommitted, saveOutcomeMessage, type SaveOutcome } from '../../../shared/saveOutcome';
export interface LeaveApplicationOptions<T extends {
  id: string;
} = LeaveRequest> {
  scopeKey: string;
  allowDifferentId?: boolean;
  submit: (request: T) => Promise<SaveOutcome | void> | SaveOutcome | void;
  inspect?: (id: string) => Promise<SaveOutcome>;
  cancel?: (id: string) => Promise<SaveOutcome>;
  readPending?: () => T[];
  readReferences?: () => {
    planId: string;
    readable: boolean;
  }[];
  cancelReference?: (planId: string) => Promise<SaveOutcome>;
}
const unknown = (): SaveOutcome => ({
  status: 'unknown',
  message: '휴가 저장 결과를 확인하지 못했습니다. 작성 원문은 보관했습니다.',
  nextAction: '보관 요청에서 결과 확인 또는 요청 중단을 선택해 주세요. 확인 전에는 새로 신청하지 마세요.'
});
export function useLeaveApplication<T extends {
  id: string;
} = LeaveRequest>(options: LeaveApplicationOptions<T>) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [pending, setPending] = useState<T | null>(null),
    [pendingRequests, setPendingRequests] = useState<T[]>([]),
    [damagedReferences, setDamagedReferences] = useState<string[]>([]);
  const current = useRef<T | null>(null),
    generation = useRef(0),
    locked = useRef(false);
  useEffect(() => {
    generation.current++;
    locked.current = false;
    current.current = null;
    setBusy(false);
    setMessage('');
    setPending(null);
    setPendingRequests([]);
    setDamagedReferences([]);
    try {
      setPendingRequests(callbacks.current.readPending?.() ?? []);
      setDamagedReferences((callbacks.current.readReferences?.() ?? []).filter(row => !row.readable).map(row => row.planId));
    } catch {
      setMessage('보관된 휴가 원문을 읽지 못했습니다. 삭제하지 말고 관리자에게 요청 중단을 확인해 주세요.');
    }
    return () => {
      generation.current++;
    };
  }, [options.scopeKey]);
  const close = () => {
    if (locked.current) {
      setMessage('휴가 저장 결과를 확인하는 중입니다. 응답을 받은 뒤 닫거나 요청 중단을 선택해 주세요.');
      return false;
    }
    generation.current++;
    locked.current = false;
    setBusy(false);
    return true;
  };
  const reopen = (request: T) => {
    if (!close()) return;
    current.current = request;
    setPending(request);
    setMessage(saveOutcomeMessage(unknown()));
  };
  const perform = async (request: T, action: () => Promise<SaveOutcome | void> | SaveOutcome | void, cancelling = false) => {
    if (locked.current) return {
      committed: false,
      cancelled: false
    };
    const turn = generation.current;
    locked.current = true;
    current.current = request;
    setPending(request);
    setBusy(true);
    setMessage('');
    try {
      let outcome: SaveOutcome;
      try {
        outcome = (await action()) ?? unknown();
      } catch {
        outcome = unknown();
      }
      if (turn !== generation.current) return {
        committed: false,
        cancelled: false
      };
      setMessage(cancelling && primaryCommitted(outcome, request.id) ? '이 요청은 이미 저장되어 등록된 휴가를 그대로 유지했습니다. 취소하려면 휴가 목록의 정상 취소 절차를 이용해 주세요.' : saveOutcomeMessage(outcome));
      const committed = primaryCommitted(outcome, request.id),
        cancelled = outcome.status === 'cancelled';
      if (committed || cancelled || outcome.status === 'rejected') {
        current.current = null;
        setPending(null);
        setPendingRequests(rows => rows.filter(row => row.id !== request.id));
      } else setPendingRequests(rows => [...rows.filter(row => row.id !== request.id), request]);
      return {
        committed,
        cancelled
      };
    } finally {
      if (turn === generation.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  return {
    busy,
    notice: (outcome: SaveOutcome) => setMessage(saveOutcomeMessage(outcome)),
    message,
    pending,
    pendingRequests,
    damagedReferences,
    close,
    reopen,
    cancelDamaged: async (planId: string) => {
      if (locked.current || !callbacks.current.cancelReference) return;
      const turn = generation.current;
      locked.current = true;
      setBusy(true);
      try {
        let outcome: SaveOutcome;
        try {
          outcome = await callbacks.current.cancelReference(planId);
        } catch {
          outcome = unknown();
        }
        if (turn !== generation.current) return;
        setMessage(outcome.status === 'saved' ? '이 요청은 이미 저장됐습니다. 기존 휴가는 그대로 두었습니다. 휴가 목록에서 확인해 주세요.' : saveOutcomeMessage(outcome));
        if (outcome.status === 'saved' || outcome.status === 'cancelled' || outcome.status === 'rejected') setDamagedReferences(rows => rows.filter(id => id !== planId));
      } finally {
        if (turn === generation.current) {
          locked.current = false;
          setBusy(false);
        }
      }
    },
    submit: (request: T) => current.current && (!options.allowDifferentId || current.current.id === request.id) ? Promise.resolve({
      committed: false,
      cancelled: false
    }) : perform(request, () => callbacks.current.submit(request)),
    inspect: () => current.current && callbacks.current.inspect ? perform(current.current, () => callbacks.current.inspect!(current.current!.id)) : Promise.resolve({
      committed: false,
      cancelled: false
    }),
    cancel: () => current.current && callbacks.current.cancel ? perform(current.current, () => callbacks.current.cancel!(current.current!.id), true) : Promise.resolve({
      committed: false,
      cancelled: false
    })
  };
}
