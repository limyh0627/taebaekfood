import { useEffect, useRef, useState } from 'react';
import { primaryCommitted, saveOutcomeMessage, type SaveOutcome } from '../../../shared/saveOutcome';
import { today } from '../../../shared/day';
import type { Employee } from '../../../shared/types';
import type { EmployeeProfileDraft, EmployeeBalanceDraft, EmployeeEditReference } from '../../../shared/employeeEditCommand';
import type { EmployeeEditInput, PendingEmployeeEdit, EmployeeEditStoredReference, EmployeeEditSaveOutcome } from '../infrastructure/employeeEditWrites';
export type { EmployeeEditBindings, EmployeeEditInput, PendingEmployeeEdit, EmployeeEditStoredReference } from '../infrastructure/employeeEditWrites';
export interface EmployeeEditorOptions {
  scopeKey: string;
  onSave?: (input: EmployeeEditInput) => Promise<EmployeeEditSaveOutcome>;
  readPending?: () => PendingEmployeeEdit[];
  inspect?: (reference: EmployeeEditReference) => Promise<EmployeeEditSaveOutcome>;
  cancel?: (reference: EmployeeEditReference) => Promise<EmployeeEditSaveOutcome>;
  readReferences?: () => EmployeeEditStoredReference[];
}
const unknown = (): SaveOutcome => ({
  status: 'unknown',
  message: '직원 저장 결과를 확인하지 못했습니다.',
  nextAction: '보관 요청의 결과 확인이나 요청 중단을 선택해 주세요.'
});
export interface EmployeeProfileSession {
  targetId: string;
  isNew: boolean;
  opening: Employee | null;
  draft: EmployeeProfileDraft;
}
export interface EmployeeBalanceSession {
  opening: Employee;
  draft: EmployeeBalanceDraft;
}
const defaults = (): EmployeeProfileDraft => ({
  name: '',
  position: '사원',
  department: '생산팀',
  joinDate: today(),
  birthDate: '',
  phone: '010-0000-0000',
  status: 'working',
  annualLeave: {
    carryOverLeave: 0,
    bonusLeave: 0
  },
  healthCertDate: ''
});
const snapshot = (row: Employee): Employee => ({
  ...row,
  ...(Object.hasOwn(row, 'annualLeave') ? {
    annualLeave: row.annualLeave ? {
      ...row.annualLeave
    } : row.annualLeave
  } : {})
});
const balanceOf = (row: Employee): EmployeeBalanceDraft => ({
  carryOverLeave: row.annualLeave?.carryOverLeave || 0,
  bonusLeave: row.annualLeave?.bonusLeave || 0
});
const profileOf = (row: Employee): EmployeeProfileDraft => ({
  name: row.name,
  position: row.position,
  department: row.department,
  joinDate: row.joinDate,
  birthDate: row.birthDate || '',
  phone: row.phone,
  status: row.status,
  annualLeave: balanceOf(row),
  healthCertDate: row.healthCertDate || ''
});
export function useEmployeeEditor(options: EmployeeEditorOptions) {
  const latest = useRef(options);
  latest.current = options;
  const profile = useRef<EmployeeProfileSession | null>(null);
  const balances = useRef<Record<string, EmployeeBalanceSession>>({});
  const [, renderDraft] = useState(0);
  const redraw = () => renderDraft(value => value + 1);
  const [stateOwner, setStateOwner] = useState(options.scopeKey);
  const scope = useRef(options.scopeKey),
    generation = useRef(0),
    locked = useRef(false);
  // effect 전에 새 회사·UID 렌더가 시작해도 옛 ACK를 받지 않는다.
  if (scope.current !== options.scopeKey) {
    scope.current = options.scopeKey;
    generation.current++;
    locked.current = false;
    profile.current = null;
    balances.current = {};
  }
  const [busy, setBusy] = useState(false),
    [targetId, setTargetId] = useState<string | null>(null);
  const [message, setMessage] = useState(''),
    [messageTargetId, setMessageTargetId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingEmployeeEdit[]>([]),
    [references, setReferences] = useState<EmployeeEditStoredReference[]>([]);
  const [lastOutcome, setLastOutcome] = useState<EmployeeEditSaveOutcome | null>(null);
  const refresh = () => {
    setPending(latest.current.readPending?.() ?? []);
    setReferences(latest.current.readReferences?.() ?? []);
  };
  useEffect(() => {
    setStateOwner(options.scopeKey);
    generation.current++;
    locked.current = false;
    setBusy(false);
    setTargetId(null);
    setMessage('');
    setMessageTargetId(null);
    setLastOutcome(null);
    setPending([]);
    setReferences([]);
    try {
      refresh();
    } catch {
      setMessage('보관된 직원 요청을 읽지 못했습니다. 기기 저장소 접근을 확인해 주세요.');
    }
    return () => {
      generation.current++;
    };
  }, [options.scopeKey]);
  const perform = async (reference: {
    targetId: string;
  }, task: (() => Promise<EmployeeEditSaveOutcome>) | undefined, inspecting = false) => {
    if (locked.current) return false;
    const turn = generation.current;
    setMessageTargetId(reference.targetId);
    setLastOutcome(null);
    if (!task) {
      setMessage('직원 저장 기능이 연결되지 않아 전송하지 않았습니다. 관리자에게 연결 상태를 확인해 주세요.');
      return false;
    }
    locked.current = true;
    setBusy(true);
    setTargetId(reference.targetId);
    setMessage('');
    try {
      let result: EmployeeEditSaveOutcome;
      try {
        result = (await task()) ?? unknown();
      } catch {
        result = unknown();
      }
      if (turn !== generation.current) return false;
      setLastOutcome(result);
      const committed = primaryCommitted(result, reference.targetId);
      setMessage(inspecting && committed ? '직원 저장이 확인됐습니다. 창을 닫고 현재 직원을 다시 열어 주세요.' : saveOutcomeMessage(result));
      try {
        refresh();
      } catch {
        setMessage(current => current + '\n기기 보관 요청을 읽지 못했습니다. 원문을 삭제하지 말고 다시 확인해 주세요.');
      }
      return committed;
    } finally {
      if (turn === generation.current) {
        locked.current = false;
        setBusy(false);
        setTargetId(null);
      }
    }
  };
  const submit = async (input: EmployeeEditInput) => {
    if (locked.current) return false;
    setMessageTargetId(input.targetId);
    try {
      const stored = latest.current.readPending?.() ?? [];
      const refs = latest.current.readReferences?.() ?? [];
      if (stored.some(row => row.id === input.targetId) || refs.some(row => row.reference?.targetId === input.targetId)) {
        setPending(stored);
        setReferences(refs);
        setMessage('이 직원의 보관 요청이 있습니다. 결과 확인 또는 요청 중단을 먼저 선택해 주세요.');
        return false;
      }
    } catch {
      setMessage('보관 요청을 읽지 못해 새 요청을 보내지 않았습니다. 기기 저장소 접근을 확인해 주세요.');
      return false;
    }
    const save = latest.current.onSave;
    return perform(input, save ? () => save(input) : undefined);
  };
  const visible = stateOwner === options.scopeKey;
  const visiblePending = visible ? pending : [];
  const visibleReferences = visible ? references : [];
  const hasPending = (id: string) => visiblePending.some(row => row.id === id) || visibleReferences.some(row => row.reference?.targetId === id);
  const needsReopen = (id: string) => visible && messageTargetId === id && !!lastOutcome && (lastOutcome.requiresReopen || ['unknown', 'partial'].includes(lastOutcome.status));
  const profileLocked = !!profile.current && (locked.current || hasPending(profile.current.targetId) || needsReopen(profile.current.targetId));
  const clearMessage = () => {
    setMessage('');
    setMessageTargetId(null);
    setLastOutcome(null);
  };
  const openCreate = (initial = defaults()) => {
    if (locked.current) return false;
    profile.current = {
      targetId: crypto.randomUUID(),
      isNew: true,
      opening: null,
      draft: {
        ...initial,
        annualLeave: {
          ...initial.annualLeave
        }
      }
    };
    clearMessage();
    redraw();
    return true;
  };
  const openProfile = (row: Employee) => {
    if (locked.current) return false;
    profile.current = {
      targetId: row.id,
      isNew: false,
      opening: snapshot(row),
      draft: profileOf(row)
    };
    clearMessage();
    redraw();
    return true;
  };
  const changeProfile = (change: Partial<EmployeeProfileDraft> | ((current: EmployeeProfileDraft) => EmployeeProfileDraft)) => {
    if (!profile.current || profileLocked) return;
    const current = profile.current;
    const next = typeof change === 'function' ? change(current.draft) : {
      ...current.draft,
      ...change
    };
    profile.current = {
      ...current,
      draft: {
        ...next,
        annualLeave: {
          ...next.annualLeave
        }
      }
    };
    redraw();
  };
  const submitProfile = async () => {
    const session = profile.current;
    if (!session || profileLocked) return false;
    const draft = {
      ...session.draft,
      annualLeave: {
        ...session.draft.annualLeave
      }
    };
    const saved = await submit(session.opening ? {
      targetId: session.targetId,
      kind: 'profile',
      opening: session.opening,
      profile: draft
    } : {
      targetId: session.targetId,
      kind: 'create',
      opening: null,
      profile: draft
    });
    return saved && profile.current === session;
  };
  const changeBalance = (row: Employee, field: keyof EmployeeBalanceDraft, value: string | number) => {
    if (locked.current || hasPending(row.id) || needsReopen(row.id)) return;
    const current = balances.current[row.id] ?? {
      opening: snapshot(row),
      draft: balanceOf(row)
    };
    balances.current = {
      ...balances.current,
      [row.id]: {
        ...current,
        draft: {
          ...current.draft,
          [field]: typeof value === 'number' ? value : parseFloat(value) || 0
        }
      }
    };
    redraw();
  };
  const canResetBalance = (id: string) => !locked.current && !hasPending(id) && !(visible && messageTargetId === id && lastOutcome && ['unknown', 'partial'].includes(lastOutcome.status));
  const submitBalance = async (id: string) => {
    const session = balances.current[id];
    if (!session || locked.current || hasPending(id) || needsReopen(id)) return false;
    const saved = await submit({
      targetId: id,
      kind: 'balance',
      opening: session.opening,
      balance: {
        ...session.draft
      }
    });
    if (saved && balances.current[id] === session) {
      const next = {
        ...balances.current
      };
      delete next[id];
      balances.current = next;
      redraw();
    }
    return saved;
  };
  const closeProfile = () => {
    if (!locked.current) return true;
    setMessage('직원 저장 결과를 확인하는 중입니다. 응답을 받은 뒤 닫아 주세요.');
    return false;
  };
  return {
    busy: visible && busy,
    targetId: visible ? targetId : null,
    busyId: visible ? targetId : null,
    message: visible ? message : '',
    messageTargetId: visible ? messageTargetId : null,
    lastOutcome: visible ? lastOutcome : null,
    terminalRequiresReopen: visible && !!(lastOutcome && 'requiresReopen' in lastOutcome && lastOutcome.requiresReopen),
    pending: visiblePending,
    references: visibleReferences,
    formData: profile.current?.draft ?? defaults(),
    profileSession: profile.current,
    profileLocked,
    openCreate,
    openProfile,
    changeProfile,
    submitProfile,
    closeProfile,
    changeProfileBalance: (field: keyof EmployeeBalanceDraft, value: string | number) => changeProfile(current => ({
      ...current,
      annualLeave: {
        ...current.annualLeave,
        [field]: typeof value === 'number' ? value : parseFloat(value) || 0
      }
    })),
    balanceDrafts: balances.current,
    balanceFor: (row: Employee) => balances.current[row.id]?.draft ?? balanceOf(row),
    hasBalanceDraft: (id: string) => !!balances.current[id],
    balanceLocked: (id: string) => locked.current || hasPending(id) || needsReopen(id),
    changeBalance,
    submitBalance,
    canResetBalance,
    resetBalance: (id: string) => {
      if (!canResetBalance(id)) return false;
      const next = {
        ...balances.current
      };
      delete next[id];
      balances.current = next;
      if (messageTargetId === id) clearMessage();
      redraw();
      return true;
    },
    submit,
    refresh,
    inspect: (reference: EmployeeEditReference) => {
      const port = latest.current.inspect;
      return perform(reference, port ? () => port(reference) : undefined, true);
    },
    cancel: (reference: EmployeeEditReference) => {
      const port = latest.current.cancel;
      return perform(reference, port ? () => port(reference) : undefined, true);
    },
    clearMessage,
    close: closeProfile
  };
}
