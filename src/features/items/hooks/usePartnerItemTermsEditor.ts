import { useEffect, useRef, useState } from 'react';
import { primaryCommitted, saveOutcomeMessage } from '../../../shared/saveOutcome';
import { termsFromOpening, type PartnerItemTermsReference } from '../../../shared/partnerItemTermsCommand';
import { partnerItemTermsTargetId, partnerItemTermsTargetKey, type PartnerItemTermsTarget, type PartnerItemTermsInput, type PartnerItemTermsOutcome, type PartnerItemTerms, type PendingPartnerItemTerms, type PartnerItemTermsStoredReference } from '../infrastructure/partnerItemTermsWrites';
export type { PartnerItemTermsBindings } from '../infrastructure/partnerItemTermsWrites';
export interface PartnerItemTermsDraft {
  price: string;
  taxType: '과세' | '면세' | '' | null;
  Account_Code: string;
}
export interface PartnerItemTermsSession {
  key: string;
  target: PartnerItemTermsTarget;
  draft: PartnerItemTermsDraft;
  fields: (keyof PartnerItemTerms)[];
  mode: 'price' | 'service' | 'terms';
  eligibleCodes: readonly string[];
}
export interface PartnerItemTermsEditorOptions {
  scopeKey: string;
  onSave?: (input: PartnerItemTermsInput) => Promise<PartnerItemTermsOutcome>;
  readPending?: () => PendingPartnerItemTerms[];
  readReferences?: () => PartnerItemTermsStoredReference[];
  inspect?: (reference: PartnerItemTermsReference) => Promise<PartnerItemTermsOutcome>;
  cancel?: (reference: PartnerItemTermsReference) => Promise<PartnerItemTermsOutcome>;
}
const unknown = (): PartnerItemTermsOutcome => ({
  status: 'unknown',
  message: '거래조건 저장 결과를 확인하지 못했습니다.',
  nextAction: '보관 요청의 결과 확인 또는 요청 중단을 선택해 주세요.'
});
export function usePartnerItemTermsEditor(options: PartnerItemTermsEditorOptions) {
  const latest = useRef(options);
  latest.current = options;
  const scope = useRef(options.scopeKey),
    generation = useRef(0),
    lock = useRef(false);
  const sessions = useRef(new Map<string, PartnerItemTermsSession>());
  const confirmed = useRef(new Map<string, {
    fingerprint: string;
    outcome: PartnerItemTermsOutcome;
    planId?: string;
  }>());
  const [owner, setOwner] = useState(options.scopeKey);
  const [, redraw] = useState(0);
  const update = () => redraw(value => value + 1);
  if (scope.current !== options.scopeKey) {
    scope.current = options.scopeKey;
    generation.current++;
    lock.current = false;
    sessions.current.clear();
    confirmed.current.clear();
  }
  const [busyKey, setBusyKey] = useState<string | null>(null),
    [messageKey, setMessageKey] = useState<string | null>(null),
    [message, setMessage] = useState('');
  const [pending, setPending] = useState<PendingPartnerItemTerms[]>([]),
    [references, setReferences] = useState<PartnerItemTermsStoredReference[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, PartnerItemTermsOutcome>>({});
  const visible = owner === options.scopeKey;
  const refresh = () => {
    setPending(latest.current.readPending?.() ?? []);
    setReferences(latest.current.readReferences?.() ?? []);
  };
  useEffect(() => {
    generation.current++;
    setOwner(options.scopeKey);
    setBusyKey(null);
    setMessage('');
    setMessageKey(null);
    setPending([]);
    setReferences([]);
    setOutcomes({});
    try {
      refresh();
    } catch {
      setMessage('보관 요청을 읽지 못했습니다. 기기 저장소 접근을 확인해 주세요.');
    }
    return () => {
      generation.current++;
    };
  }, [options.scopeKey]);
  const isLocked = (key: string) => lock.current || visible && (pending.some(row => partnerItemTermsTargetKey(row.reference) === key) || references.some(row => row.reference && partnerItemTermsTargetKey(row.reference) === key) || !!outcomes[key] && (outcomes[key].requiresReopen || ['unknown', 'partial'].includes(outcomes[key].status)));
  const open = (target: PartnerItemTermsTarget, initial?: PartnerItemTerms, mode: PartnerItemTermsSession['mode'] = 'price', eligibleCodes: readonly string[] = []) => {
    const key = partnerItemTermsTargetKey(target);
    if (lock.current || sessions.current.has(key)) return key;
    const value = target.opening;
    setOutcomes(current => {
      const next = {
        ...current
      };
      delete next[key];
      return next;
    });
    if (messageKey === key) setMessage('');
    sessions.current.set(key, {
      key,
      target: {
        ...target,
        opening: value ? {
          ...value
        } : null
      },
      draft: {
        price: String(initial?.price ?? value?.price ?? ''),
        taxType: initial?.taxType === undefined ? value?.taxType ?? '' : initial.taxType,
        Account_Code: initial?.Account_Code ?? value?.Account_Code ?? ''
      },
      fields: mode === 'service' ? ['price', 'taxType', 'Account_Code'] : initial ? Object.keys(initial) as (keyof PartnerItemTerms)[] : ['price'],
      mode,
      eligibleCodes: [...eligibleCodes]
    });
    update();
    return key;
  };
  const change = (key: string, field: keyof PartnerItemTermsDraft, value: string | null) => {
    if (isLocked(key)) return;
    const session = sessions.current.get(key);
    if (!session) return;
    sessions.current.set(key, {
      ...session,
      draft: {
        ...session.draft,
        [field]: value
      },
      fields: [...new Set([...session.fields, field])]
    });
    update();
  };
  const perform = async (target: Pick<PartnerItemTermsTarget, 'itemId' | 'partnerId' | 'direction'>, task: (() => Promise<PartnerItemTermsOutcome>) | undefined, inspecting = false): Promise<PartnerItemTermsOutcome> => {
    const key = partnerItemTermsTargetKey(target),
      turn = generation.current;
    if (lock.current) return {
      status: 'rejected',
      message: '다른 거래조건 저장을 확인하는 중입니다.'
    };
    if (!task) {
      const result: PartnerItemTermsOutcome = {
        status: 'rejected',
        message: '거래조건 저장 기능이 연결되지 않아 요청을 보내지 않았습니다.'
      };
      setMessage(result.message);
      setMessageKey(key);
      return result;
    }
    lock.current = true;
    setBusyKey(key);
    setMessage('');
    setMessageKey(key);
    try {
      let result: PartnerItemTermsOutcome;
      try {
        result = (await task()) ?? unknown();
      } catch {
        result = unknown();
      }
      if (turn !== generation.current) return {
        status: 'cancelled',
        message: '회사 또는 계정이 바뀌어 이전 화면 결과를 반영하지 않았습니다.'
      };
      const committed = primaryCommitted(result, 'targetId' in target ? String(target.targetId) : `${target.itemId}_${target.partnerId}_${target.direction}`);
      const presented: PartnerItemTermsOutcome = inspecting && committed ? {
        ...result,
        requiresReopen: true
      } : result;
      setOutcomes(current => ({
        ...current,
        [key]: presented
      }));
      const cached = confirmed.current.get(key);
      if (inspecting && result.status === 'saved' && cached?.planId && 'planId' in target && target.planId === cached.planId) confirmed.current.set(key, {
        ...cached,
        outcome: presented
      });
      setMessage(inspecting && committed ? '거래조건 저장이 확인됐습니다. 현재 자료를 다시 열어 확인해 주세요.' : saveOutcomeMessage(result));
      try {
        refresh();
      } catch {
        setMessage(current => current + '\n기기 보관 요청을 읽지 못했습니다. 원문을 지우지 말고 다시 확인해 주세요.');
      }
      return presented;
    } finally {
      if (turn === generation.current) {
        lock.current = false;
        setBusyKey(null);
      }
    }
  };
  const saveRow = async (input: PartnerItemTermsInput): Promise<PartnerItemTermsOutcome> => {
    const key = partnerItemTermsTargetKey(input.target);
    const frozen: PartnerItemTermsInput = {
      target: {
        ...input.target,
        opening: input.target.opening ? {
          ...input.target.opening
        } : null
      },
      terms: {
        ...input.terms
      }
    };
    const fingerprint = JSON.stringify(frozen);
    const acknowledged = confirmed.current.get(key);
    if (acknowledged?.fingerprint === fingerprint) return acknowledged.outcome;
    if (lock.current) return {
      status: 'rejected',
      message: '저장 결과를 확인하는 중입니다.'
    };
    try {
      const stored = latest.current.readPending?.() ?? [],
        refs = latest.current.readReferences?.() ?? [];
      if (stored.some(row => partnerItemTermsTargetKey(row.reference) === key) || refs.some(row => row.reference && partnerItemTermsTargetKey(row.reference) === key)) {
        setPending(stored);
        setReferences(refs);
        const result: PartnerItemTermsOutcome = {
          status: 'rejected',
          message: '이 거래조건의 보관 요청을 먼저 확인하거나 중단해 주세요.'
        };
        setMessage(result.message);
        setMessageKey(key);
        return result;
      }
    } catch {
      const result: PartnerItemTermsOutcome = {
        status: 'rejected',
        message: '보관 요청을 읽지 못해 새 요청을 보내지 않았습니다.',
        nextAction: '기기 저장소 접근을 확인해 주세요.'
      };
      setMessage(result.message);
      setMessageKey(key);
      return result;
    }
    const save = latest.current.onSave;
    const outcome = await perform(frozen.target, save ? () => save(frozen) : undefined);
    if (outcome.status === 'saved') confirmed.current.set(key, {
      fingerprint,
      outcome
    });else if (primaryCommitted(outcome, partnerItemTermsTargetId(input.target))) {
      // 정리 실패 ACK는 정확한 보관 계획과 묶어야 다른 요청 조회로 완료시키지 않는다.
      try {
        const reference = latest.current.readReferences?.().find(row => row.reference && partnerItemTermsTargetKey(row.reference) === key && row.reference.targetId === partnerItemTermsTargetId(input.target))?.reference;
        if (reference) confirmed.current.set(key, {
          fingerprint,
          outcome,
          planId: reference.planId
        });
      } catch {/* 원문을 다시 읽을 때까지 ACK를 임의로 새 요청에 연결하지 않는다. */}
    }
    return outcome;
  };
  const hasStored = (key: string) => visible && (pending.some(row => partnerItemTermsTargetKey(row.reference) === key) || references.some(row => row.reference && partnerItemTermsTargetKey(row.reference) === key));
  const canCancelEdit = (key: string) => !lock.current && !hasStored(key) && !(visible && outcomes[key] && ['unknown', 'partial'].includes(outcomes[key].status));
  const cancelEdit = (key: string) => {
    if (!canCancelEdit(key)) return false;
    sessions.current.delete(key);
    setOutcomes(current => {
      const next = {
        ...current
      };
      delete next[key];
      return next;
    });
    if (messageKey === key) {
      setMessage('');
      setMessageKey(null);
    }
    update();
    return true;
  };
  const reopen = (target: PartnerItemTermsTarget, initial?: PartnerItemTerms, mode: PartnerItemTermsSession['mode'] = 'price', eligibleCodes: readonly string[] = []) => {
    const key = partnerItemTermsTargetKey(target);
    if (!cancelEdit(key)) return key;
    return open(target, initial, mode, eligibleCodes);
  };
  const submit = async (key: string): Promise<PartnerItemTermsOutcome> => {
    const session = sessions.current.get(key);
    if (!session || isLocked(key)) return {
      status: 'rejected',
      message: '현재 거래조건 초안이나 보관 요청을 확인해 주세요.'
    };
    const draft = session.draft,
      price = Number(draft.price);
    if (session.fields.includes('price') && (!Number.isFinite(price) || session.mode === 'service' && price <= 0) || session.mode === 'service' && (!draft.taxType || !draft.Account_Code || !session.eligibleCodes.includes(draft.Account_Code))) {
      const result: PartnerItemTermsOutcome = {
        status: 'rejected',
        message: session.mode === 'service' ? '용역 단가, 과세 여부, 계정과목을 모두 선택해 주세요.' : '단가를 숫자로 입력해 주세요.'
      };
      setMessage(result.message);
      setMessageKey(key);
      return result;
    }
    const terms: PartnerItemTerms = {};
    if (session.fields.includes('price')) terms.price = price;
    if (session.fields.includes('taxType') && draft.taxType !== '') terms.taxType = draft.taxType;
    if (session.fields.includes('Account_Code')) terms.Account_Code = draft.Account_Code;
    let resolved: PartnerItemTerms;
    try {
      resolved = termsFromOpening(session.target.opening ? {
        ...session.target.opening
      } : null, terms);
    } catch (error) {
      const rejected: PartnerItemTermsOutcome = {
        status: 'rejected',
        message: error instanceof Error ? error.message : '거래조건 입력을 확인해 주세요.'
      };
      setMessage(rejected.message);
      setMessageKey(key);
      return rejected;
    }
    const result = await saveRow({
      target: session.target,
      terms: resolved
    });
    if (result.status === 'saved' && sessions.current.get(key) === session) {
      sessions.current.delete(key);
      update();
    }
    return result;
  };
  return {
    open,
    reopen,
    change,
    submit,
    saveRow,
    keyFor: partnerItemTermsTargetKey,
    draftFor: (key: string) => sessions.current.get(key)?.draft ?? null,
    sessionFor: (key: string) => sessions.current.get(key) ?? null,
    cancelEdit,
    canCancelEdit,
    locked: isLocked,
    busy: visible && busyKey !== null,
    busyKey: visible ? busyKey : null,
    message: visible ? message : '',
    messageKey: visible ? messageKey : null,
    pending: visible ? pending : [],
    references: visible ? references : [],
    outcomes: visible ? outcomes : {},
    refresh,
    inspect: (reference: PartnerItemTermsReference) => {
      const port = latest.current.inspect;
      return perform(reference, port ? () => port(reference) : undefined, true);
    },
    cancel: (reference: PartnerItemTermsReference) => {
      const port = latest.current.cancel;
      return perform(reference, port ? () => port(reference) : undefined, true);
    }
  };
}
export type PartnerItemTermsEditor = ReturnType<typeof usePartnerItemTermsEditor>;
