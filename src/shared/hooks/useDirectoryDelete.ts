import { useEffect, useRef, useState } from 'react';
import { primaryCommitted, saveOutcomeMessage } from '../saveOutcome';
import type { DirectoryDeleteReference } from '../directoryDeleteCommand';
import type { DirectoryDeleteInput, DirectoryDeletePrepared, DirectoryDeleteOutcome, PendingDirectoryDelete, DirectoryDeleteStoredReference } from '../services/directoryDeleteWrites';
export type { DirectoryDeleteBindings } from '../services/directoryDeleteWrites';
export interface DirectoryDeleteSession {
  input: DirectoryDeleteInput;
  reference?: DirectoryDeleteReference;
  ready: boolean;
}
export interface UseDirectoryDeleteOptions {
  scopeKey: string;
  prepare?: (input: DirectoryDeleteInput) => Promise<DirectoryDeletePrepared>;
  confirm?: (reference: DirectoryDeleteReference) => Promise<DirectoryDeleteOutcome>;
  inspect?: (reference: DirectoryDeleteReference) => Promise<DirectoryDeleteOutcome>;
  cancel?: (reference: DirectoryDeleteReference) => Promise<DirectoryDeleteOutcome>;
  readPending?: () => PendingDirectoryDelete[];
  readReferences?: () => DirectoryDeleteStoredReference[];
}
const sameReference = (left: DirectoryDeleteReference | undefined, right: DirectoryDeleteReference) => !!left && left.companyId === right.companyId && left.kind === right.kind && left.targetId === right.targetId && left.planId === right.planId;
const unknown = (): DirectoryDeleteOutcome => ({
  status: 'unknown',
  message: '삭제 응답을 확인하지 못했습니다.',
  nextAction: '보관된 같은 요청을 확인하거나 중단해 주세요. 현재 목록만으로 삭제 완료를 판단하지 마세요.'
});
const missing = (): DirectoryDeleteOutcome => ({
  status: 'rejected',
  message: '삭제 처리 기능이 연결되지 않았습니다.',
  nextAction: '관리자에게 연결 상태를 확인해 주세요. 삭제는 전송하지 않았습니다.'
});
export function useDirectoryDelete(options: UseDirectoryDeleteOptions) {
  const current = useRef(options);
  current.current = options;
  const owner = useRef(options.scopeKey),
    generation = useRef(0),
    selected = useRef<DirectoryDeleteInput | null>(null),
    sessionRef = useRef<DirectoryDeleteSession | null>(null),
    busyRef = useRef(false),
    outcomeRef = useRef<DirectoryDeleteOutcome | null>(null);
  const [state, setState] = useState<{
    owner: string;
    session: DirectoryDeleteSession | null;
    busy: boolean;
    message: string;
    messageTargetId: string | null;
    messageIdentity: {
      kind: DirectoryDeleteReference['kind'];
      targetId: string;
      planId?: string;
    } | null;
    pending: PendingDirectoryDelete[];
    references: DirectoryDeleteStoredReference[];
    lastOutcome: DirectoryDeleteOutcome | null;
  }>({
    owner: options.scopeKey,
    session: null,
    busy: false,
    message: '',
    messageTargetId: null,
    messageIdentity: null,
    pending: [],
    references: [],
    lastOutcome: null
  });
  if (owner.current !== options.scopeKey) {
    owner.current = options.scopeKey;
    generation.current++;
    selected.current = null;
    sessionRef.current = null;
    outcomeRef.current = null;
    busyRef.current = false;
  }
  const valid = (scope: string, token: number) => owner.current === scope && generation.current === token;
  const patch = (values: Partial<typeof state>) => setState(previous => ({
    ...previous,
    owner: owner.current,
    ...values
  }));
  const refresh = () => {
    try {
      patch({
        pending: current.current.readPending?.() ?? [],
        references: current.current.readReferences?.() ?? []
      });
    } catch {
      patch({
        message: '보관된 삭제 요청을 읽지 못했습니다. 기기 저장소를 확인한 뒤 다시 열어 주세요.',
        messageTargetId: null,
        messageIdentity: null
      });
    }
  };
  useEffect(() => {
    patch({
      session: null,
      busy: false,
      message: '',
      messageTargetId: null,
      messageIdentity: null,
      lastOutcome: null,
      pending: [],
      references: []
    });
    refresh();
  }, [options.scopeKey]);
  useEffect(() => () => {
    generation.current++;
  }, []);
  const select = (input: DirectoryDeleteInput) => {
    if (busyRef.current) return false;
    selected.current = {
      ...input,
      opening: {
        ...input.opening
      }
    };
    return true;
  };
  const open = async (input: DirectoryDeleteInput) => {
    if (busyRef.current) return false;
    select(input);
    const frozen = selected.current!,
      scope = owner.current,
      token = ++generation.current;
    const session: DirectoryDeleteSession = {
      input: frozen,
      ready: false
    };
    sessionRef.current = session;
    busyRef.current = true;
    patch({
      session,
      busy: true,
      message: '삭제할 자료를 확인하고 있습니다. 아직 삭제하지 않았습니다.',
      messageTargetId: frozen.targetId,
      messageIdentity: {
        kind: frozen.kind,
        targetId: frozen.targetId
      },
      lastOutcome: null
    });
    try {
      // 이미 보관된 삭제는 새 preview/새 ID로 대체하지 않는다.
      const pending = current.current.readPending?.() ?? [],
        refs = current.current.readReferences?.() ?? [];
      const prior = pending.find(row => row.reference.kind === frozen.kind && row.reference.targetId === frozen.targetId)?.reference ?? refs.find(row => row.reference?.kind === frozen.kind && row.reference.targetId === frozen.targetId)?.reference;
      if (prior) {
        if (valid(scope, token)) {
          sessionRef.current = {
            input: frozen,
            reference: prior,
            ready: false
          };
          patch({
            session: sessionRef.current,
            message: '이 대상의 보관된 삭제 요청이 있습니다. 결과를 확인하거나 중단해 주세요.',
            messageIdentity: prior
          });
        }
        return false;
      }
      const response = current.current.prepare ? await current.current.prepare(frozen) : {
        status: 'rejected' as const,
        outcome: missing()
      };
      if (!valid(scope, token)) return false;
      if (!response || !['ready', 'rejected'].includes(response.status)) throw Error('삭제 준비 응답이 없습니다.');
      if (response.status === 'ready') {
        if (response.reference.targetId !== frozen.targetId || response.reference.kind !== frozen.kind) throw Error('다른 삭제 대상의 준비 응답입니다.');
        sessionRef.current = {
          input: frozen,
          reference: response.reference,
          ready: true
        };
        patch({
          session: sessionRef.current,
          message: '',
          messageIdentity: response.reference,
          lastOutcome: null
        });
        refresh();
        return true;
      }
      patch({
        message: saveOutcomeMessage(response.outcome),
        lastOutcome: response.outcome
      });
      return false;
    } catch (error) {
      if (valid(scope, token)) patch({
        message: error instanceof Error ? error.message : '삭제 준비를 완료하지 못했습니다. 아직 삭제를 전송하지 않았습니다.',
        lastOutcome: {
          status: 'rejected',
          message: '삭제 준비를 완료하지 못했습니다.'
        }
      });
      return false;
    } finally {
      if (valid(scope, token)) {
        busyRef.current = false;
        patch({
          busy: false
        });
        refresh();
      }
    }
  };
  const perform = async (reference: DirectoryDeleteReference, mode: 'confirm' | 'inspect' | 'cancel') => {
    if (busyRef.current) return false;
    const scope = owner.current,
      token = generation.current;
    busyRef.current = true;
    const activeSession = sessionRef.current;
    if (mode === 'confirm' && activeSession && sameReference(activeSession.reference, reference)) {
      sessionRef.current = {
        ...activeSession,
        ready: false
      };
      patch({
        session: sessionRef.current
      });
    }
    patch({
      busy: true,
      message: '',
      messageTargetId: reference.targetId,
      messageIdentity: reference
    });
    try {
      const fn = current.current[mode];
      let outcome = fn ? await fn(reference) : missing();
      if (!valid(scope, token)) return false;
      if (!outcome || !['saved', 'partial', 'unknown', 'rejected', 'cancelled'].includes(outcome.status)) outcome = unknown();
      outcomeRef.current = outcome;
      const committed = primaryCommitted(outcome, reference.targetId);
      patch({
        lastOutcome: outcome,
        message: committed ? outcome.status === 'saved' ? '삭제가 확인됐습니다. 현재 목록을 확인해 주세요.' : saveOutcomeMessage(outcome) : saveOutcomeMessage(outcome),
        messageTargetId: reference.targetId,
        messageIdentity: reference
      });
      const resultingSession = sessionRef.current;
      if (resultingSession && sameReference(resultingSession.reference, reference) && outcome.status !== 'unknown') {
        // inspect의 늦은 확정은 새 확인창을 자동으로 닫지 않는다.
        sessionRef.current = {
          ...resultingSession,
          ready: false
        };
        patch({
          session: sessionRef.current
        });
      }
      return committed;
    } catch {
      if (valid(scope, token)) {
        outcomeRef.current = unknown();
        patch({
          lastOutcome: outcomeRef.current,
          message: saveOutcomeMessage(unknown()),
          messageTargetId: reference.targetId,
          messageIdentity: reference
        });
      }
      return false;
    } finally {
      if (valid(scope, token)) {
        busyRef.current = false;
        patch({
          busy: false
        });
        refresh();
      }
    }
  };
  const confirm = async () => {
    const session = sessionRef.current;
    if (!session?.ready || !session.reference) return false;
    return perform(session.reference, 'confirm');
  };
  const close = async (): Promise<boolean> => {
    if (busyRef.current) {
      patch({
        message: '처리 결과를 기다리고 있습니다. 완료 후 닫거나, 새로고침 뒤 같은 보관 요청을 확인해 주세요.'
      });
      return false;
    }
    const session = sessionRef.current,
      scope = owner.current,
      token = generation.current;
    // 미송신 준비의 정상 취소만 fence를 만들고, 실제 삭제 미확정의 닫기는 보관한다.
    if (session?.ready && session.reference) {
      outcomeRef.current = null;
      await perform(session.reference, 'cancel');
      if (!valid(scope, token)) return false;
      const outcome = outcomeRef.current as DirectoryDeleteOutcome | null;
      if (!outcome || outcome.status !== 'cancelled' && !primaryCommitted(outcome, session.input.targetId)) return false;
    }
    generation.current++;
    sessionRef.current = null;
    patch({
      session: null
    });
    return true;
  };
  const visible = state.owner === options.scopeKey;
  const identity = state.messageIdentity,
    session = state.session;
  const sessionMatches = visible && !!session && !!identity && session.input.kind === identity.kind && session.input.targetId === identity.targetId && (!session.reference || session.reference.planId === identity.planId);
  return {
    select,
    open,
    openSelected: () => selected.current ? open(selected.current) : Promise.resolve(false),
    close,
    confirm,
    inspect: (reference: DirectoryDeleteReference) => perform(reference, 'inspect'),
    cancel: (reference: DirectoryDeleteReference) => perform(reference, 'cancel'),
    refresh,
    session: visible ? state.session : null,
    busy: visible && state.busy,
    message: visible ? state.message : '',
    messageTargetId: visible ? state.messageTargetId : null,
    messageIdentity: visible ? state.messageIdentity : null,
    sessionMessage: sessionMatches ? state.message : '',
    sessionOutcome: sessionMatches ? state.lastOutcome : null,
    pending: visible ? state.pending : [],
    references: visible ? state.references : [],
    lastOutcome: visible ? state.lastOutcome : null
  };
}
