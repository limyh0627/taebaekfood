import { useEffect, useRef, useState } from 'react';
import type { Order } from '../../../shared/types';
import { primaryCommitted, saveOutcomeMessage, type SaveOutcome } from '../../../shared/saveOutcome';
import type { OrderEdit } from '../application/orderEditService';
export interface PendingOrderEdit {
  id: string;
  planId: string;
  description: string;
  observedLocalText?: string | null;
}
export interface OrderEditBindings {
  requestScopeKey?: string;
  onSaveOrderEdit?: (opening: Order, edit: OrderEdit) => Promise<SaveOutcome>;
  onReadPendingOrderEdits?: () => PendingOrderEdit[];
  onInspectOrderEdit?: (planId: string, targetId: string) => Promise<SaveOutcome>;
  onCancelOrderEdit?: (planId: string, targetId: string) => Promise<SaveOutcome>;
  onDiscardOrderEditCopy?: (planId: string, targetId: string, observedLocalText: string) => Promise<SaveOutcome>;
  onReadOrderEditReferences?: () => {
    id: string;
    planId: string;
    readable: boolean;
    observedLocalText?: string | null;
  }[];
  onCancelOrderEditReference?: (planId: string, targetId: string) => Promise<SaveOutcome>;
}
export interface OrderEditApplicationOptions extends OrderEditBindings {
  scopeKey: string;
}
const unknown = (): SaveOutcome => ({
  status: 'unknown',
  message: '주문 저장 결과를 확인하지 못했습니다.',
  nextAction: '보관 요청에서 결과 확인 또는 요청 중단을 선택해 주세요.'
});
export function useOrderEditApplication(options: OrderEditApplicationOptions) {
  const latest = useRef(options);
  latest.current = options;
  const generation = useRef(0),
    locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [busyId, setBusyId] = useState<string | null>(null),
    [message, setMessage] = useState(''),
    [messageTargetId, setMessageTargetId] = useState<string | null>(null);
  const [pendingEdits, setPending] = useState<PendingOrderEdit[]>([]),
    [damagedReferences, setDamaged] = useState<{
      id: string;
      planId: string;
      observedLocalText?: string | null;
    }[]>([]);
  const refresh = () => {
    setPending(latest.current.onReadPendingOrderEdits?.() ?? []);
    setDamaged((latest.current.onReadOrderEditReferences?.() ?? []).filter(p => !p.readable).map(p => ({
      id: p.id,
      planId: p.planId,
      observedLocalText: p.observedLocalText
    })));
  };
  useEffect(() => {
    generation.current++;
    locked.current = false;
    setBusy(false);
    setBusyId(null);
    setMessage('');
    setMessageTargetId(null);
    setPending([]);
    setDamaged([]);
    try {
      refresh();
    } catch {
      setMessage('보관된 주문 요청을 읽지 못했습니다. 기기 저장소 접근을 확인해 주세요.');
    }
    return () => {
      generation.current++;
    };
  }, [options.scopeKey]);
  const perform = async (id: string, task: () => Promise<SaveOutcome>, cancelling = false, inspecting = false, discarding = false) => {
    if (locked.current) return {
      committed: false,
      cancelled: false
    };
    const turn = generation.current;
    locked.current = true;
    setBusy(true);
    setBusyId(id);
    setMessage('');
    setMessageTargetId(id);
    try {
      let outcome: SaveOutcome;
      try {
        outcome = (await task()) ?? unknown();
      } catch {
        outcome = unknown();
      }
      if (turn !== generation.current) return {
        committed: false,
        cancelled: false
      };
      const committed = !discarding && primaryCommitted(outcome, id),
        cancelled = !discarding && outcome.status === 'cancelled';
      setMessage(discarding && outcome.status === 'saved' ? '이 기기 사본만 정리했습니다. 주문의 저장이나 취소 결과를 바꾸지 않았습니다.' : inspecting && committed ? '이 주문 수정은 저장됐습니다. 현재 주문을 다시 열어 내용을 확인해 주세요.' : cancelling && committed ? '이 요청은 이미 저장됐습니다. 기존 주문은 유지했습니다. 주문을 다시 열어 확인해 주세요.' : saveOutcomeMessage(outcome));
      try {
        refresh();
      } catch {
        if (outcome.status === 'unknown') setMessage(saveOutcomeMessage(outcome) + '\n기기 저장소에서 원문을 읽지 못했습니다. 삭제하지 말고 다시 확인해 주세요.');
      }
      return {
        committed,
        cancelled
      };
    } finally {
      if (turn === generation.current) {
        locked.current = false;
        setBusy(false);
        setBusyId(null);
      }
    }
  };
  const run = async (opening: Order, edit: OrderEdit) => {
    if (locked.current) return {
      committed: false,
      cancelled: false
    };
    setMessageTargetId(opening.id);
    let pending: PendingOrderEdit[];
    try {
      pending = latest.current.onReadPendingOrderEdits?.() ?? [];
    } catch {
      setMessage('보관된 주문 요청을 읽지 못해 새 요청을 전송하지 않았습니다. 기기 저장소를 확인해 주세요.');
      return {
        committed: false,
        cancelled: false
      };
    }
    if (pending.some(p => p.id === opening.id)) {
      setPending(pending);
      setMessage('이 주문의 보관 요청이 있습니다. 결과 확인 또는 요청 중단을 먼저 선택해 주세요.');
      return {
        committed: false,
        cancelled: false
      };
    }
    if (!latest.current.onSaveOrderEdit) {
      setMessage('주문 수정 저장 기능이 연결되지 않아 전송하지 않았습니다. 관리자에게 연결 상태를 확인해 주세요.');
      return {
        committed: false,
        cancelled: false
      };
    }
    return perform(opening.id, () => latest.current.onSaveOrderEdit!(opening, edit));
  };
  return {
    busy,
    busyId,
    message,
    messageTargetId,
    pendingEdits,
    damagedReferences,
    run,
    inspect: (pending: PendingOrderEdit) => perform(pending.id, () => latest.current.onInspectOrderEdit?.(pending.planId, pending.id) ?? Promise.resolve(unknown()), false, true),
    cancel: (pending: PendingOrderEdit) => perform(pending.id, () => latest.current.onCancelOrderEdit?.(pending.planId, pending.id) ?? Promise.resolve(unknown()), true),
    discardCopy: (entry: {id: string; planId: string}, text: string) => perform(entry.id, () => latest.current.onDiscardOrderEditCopy?.(entry.planId, entry.id, text) ?? Promise.resolve(unknown()), false, false, true),
    inspectDamaged: (entry: {id: string; planId: string}) => perform(entry.id, () => latest.current.onInspectOrderEdit?.(entry.planId, entry.id) ?? Promise.resolve(unknown()), false, true),
    cancelDamaged: (reference: {
      id: string;
      planId: string;
    }) => perform(reference.id, () => latest.current.onCancelOrderEditReference?.(reference.planId, reference.id) ?? Promise.resolve(unknown()), true),
    close: () => {
      if (locked.current) {
        setMessage('주문 저장 결과를 확인하는 중입니다. 응답을 받은 뒤 닫아 주세요.');
        return false;
      }
      return true;
    }
  };
}
