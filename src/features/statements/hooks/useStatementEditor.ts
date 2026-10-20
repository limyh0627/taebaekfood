import { useEffect, useReducer, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../shared/firebase';
import type { CompanyId, IssuedStatement } from '../../../shared/types';
import { captureStatementEdit, executeStatementEdit, type StatementEditWriter } from '../application/statementEditor';

export interface StatementEditorOptions {
  companyId: CompanyId;
  actorUid?: string;
  original: IssuedStatement | null;
  draftFingerprint: string;
  save?: StatementEditWriter;
  onCommitted?: () => void;
}
export interface StatementEditInput {
  patch: Partial<IssuedStatement>;
  confirm?: () => Promise<boolean>;
  afterSave?: (isCurrent: () => boolean) => unknown | Promise<unknown>;
}

export function useStatementEditor(options: StatementEditorOptions) {
  const [, repaint] = useReducer(value => value + 1, 0);
  const latest = useRef(options);
  latest.current = options;
  const alive = useRef(true);
  const liveUid = useRef(auth.currentUser?.uid ?? '');
  const unconfirmed = useRef(new Map<string, { revision: number; patch: Partial<IssuedStatement>; message: string }[]>());
  const state = useRef({ key: '', generation: 0, busy: false, error: '', message: '', uncertain: false });
  const key = JSON.stringify([options.companyId, options.actorUid, auth.currentUser?.uid, options.original?.id, options.draftFingerprint]);
  if (state.current.key !== key) {
    state.current = { key, generation: state.current.generation + 1, busy: false, error: '', message: '', uncertain: false };
  }
  useEffect(() => {
    alive.current = true;
    const unsubscribe = onAuthStateChanged(auth, user => {
      const uid = user?.uid ?? '';
      if (liveUid.current !== uid) {
        liveUid.current = uid;
        state.current = { key: '', generation: state.current.generation + 1, busy: false, error: '', message: '', uncertain: false };
        repaint();
      }
    });
    return () => { alive.current = false; unsubscribe(); };
  }, []);
  const isCurrentActor = () => alive.current && !!latest.current.actorUid && auth.currentUser?.uid === latest.current.actorUid;

  async function run(original: IssuedStatement, input: StatementEditInput, close: boolean) {
    const owner = state.current;
    if (!isCurrentActor() || owner.busy || owner.uncertain) return;
    owner.busy = true;
    owner.error = '';
    owner.message = '';
    repaint();
    const fixed = latest.current;
    const requestScope = JSON.stringify([fixed.companyId, fixed.actorUid, original.id]);
    const current = () => isCurrentActor() && state.current === owner && latest.current.companyId === fixed.companyId && latest.current.actorUid === fixed.actorUid;
    try {
      const captured = captureStatementEdit(original, original.id, fixed.companyId);
      const patch = structuredClone(input.patch);
      if (unconfirmed.current.get(requestScope)?.some(entry => entry.revision === captured.expectedRevision && JSON.stringify(entry.patch) === JSON.stringify(patch))) {
        owner.error = '이 내용의 이전 수정 결과가 불확실합니다. 전표를 다시 열어 실제 내용을 먼저 확인해 주세요.';
        return;
      }
      if (input.confirm && !await input.confirm()) return;
      if (!current()) return;
      const result = await executeStatementEdit({
        original: captured.original,
        patch,
        context: { companyId: fixed.companyId, actorUid: fixed.actorUid!, isCurrent: current },
        save: fixed.save,
        afterSave: input.afterSave,
      });
      if (result.status === 'unknown' || result.status === 'partial' || (result.status === 'stale' && !result.acknowledged)) {
        const entries = unconfirmed.current.get(requestScope) ?? [];
        entries.push({ revision: captured.expectedRevision, patch, message: result.message });
        unconfirmed.current.set(requestScope, entries);
      }
      if (!current()) return result;
      owner.message = result.message;
      if (result.status === 'unknown' || result.status === 'partial') {
        owner.uncertain = true;
        owner.error = result.message;
      } else if (result.status === 'not-started') owner.error = result.message;
      if (result.status === 'saved' && close) {
        owner.busy = false;
        fixed.onCommitted?.();
      }
      return result;
    } catch (error) {
      if (current()) owner.error = error instanceof Error ? error.message : '전표 수정 내용을 확인하지 못했습니다.';
    } finally {
      if (current()) { owner.busy = false; repaint(); }
    }
  }
  const visible = isCurrentActor();
  return {
    busy: visible && state.current.busy,
    locked: visible && state.current.uncertain,
    error: visible ? state.current.error : '',
    message: visible ? state.current.message : '',
    notice: visible && unconfirmed.current.has(JSON.stringify([options.companyId, options.actorUid, options.original?.id])) ? '이 전표의 이전 수정 또는 후속 처리 결과를 확인하지 못했습니다. 전표와 거래조건을 다시 확인해 주세요. 새 입력 저장은 이전 요청의 안전한 재시도가 아닙니다.' : '',
    isCurrentActor,
    isBusy: () => state.current.busy,
    saveEdit: (input: StatementEditInput) => latest.current.original ? run(latest.current.original, input, true) : Promise.resolve(undefined),
    updateDate: (original: IssuedStatement, date: string, confirm?: () => Promise<boolean>) => run(original, { patch: { tradeDate: date }, confirm }, false),
    updateEvidence: (original: IssuedStatement, evidence: string) => run(original, { patch: { evidence } }, false),
    invalidate: () => { state.current = { key: '', generation: state.current.generation + 1, busy: false, error: '', message: '', uncertain: false }; repaint(); },
  };
}
