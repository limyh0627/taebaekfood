import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../../shared/firebase';
import type { CompanyId } from '../../../shared/types';
import { useHaccpRecordActor } from './useHaccpRecordActor';
import { createHaccpRecordKnowledge } from '../domain/haccpRecordKnowledge';

interface MonthlyRecord { id?: string; month: string; revisionCount: number; confirmedBy?: string; confirmedAt?: string }
interface Options<R, D> {
  companyId: CompanyId; currentUserId?: string; isAdmin?: boolean; canConfirm?: boolean;
  currentMonth: string; collectionName: string; createDraft: () => D; readDraft: (record: R) => D;
}
export interface MonthlyWriteContext<R, D> { month: string; draft: D; currentRecord: R | undefined }
type ReadState = 'loading' | 'cache' | 'ready' | 'error';
type Action = 'save' | 'confirm';
type Recovery = 'none' | 'rejected' | 'unknown';

// 월별 작성 정책은 이곳에만 두고 표의 기본값·계산·저장 payload는 소비자가 구성한다.
export function useHaccpMonthlyRecord<R extends MonthlyRecord, D>(options: Options<R, D>) {
  const latest = useRef(options); latest.current = options;
  const actor = useHaccpRecordActor(options), owner = actor.ownerToken;
  const [knowledge] = useState(createHaccpRecordKnowledge);
  const [, paint] = useReducer(value => value + 1, 0);
  const make = () => ({ owner, month: options.currentMonth, draft: options.createDraft(), record: undefined as R | undefined,
    records: [] as R[], dirty: false, selection: 0, run: null as object | null, action: null as Action | null,
    readState: 'loading' as ReadState, readError: '', error: '', recovery: 'none' as Recovery,
    attempt: 0, rejectedAttempt: -1, overlay: undefined as R | undefined,
    acknowledged: new Map<string, R>(), rejected: new Map<string, {attempt: number; error: string}>(), unknown: new Map<string, MonthlyWriteContext<R, D>>() });
  const ref = useRef<ReturnType<typeof make> | null>(null);
  if (!ref.current || ref.current.owner !== owner) ref.current = make();
  const state = ref.current;
  const current = () => ref.current === state && actor.isCurrent(owner);
  const notify = () => { if (current()) paint(); };
  const editableMonth = () => !(state.month < latest.current.currentMonth && !latest.current.isAdmin);
  const permitted = (kind: Action) => actor.canAct(kind, owner) && (kind !== 'save' || editableMonth());
  useLayoutEffect(() => { knowledge.resetOwner(); }, [owner]);

  useEffect(() => {
    let active = true;
    const attempt = state.attempt;
    state.readState = 'loading'; state.readError = ''; notify();
    const stop = onSnapshot(query(collection(db, options.collectionName), where('companyId', '==', options.companyId)), { includeMetadataChanges: true }, snapshot => {
      if (!active || !current() || state.attempt !== attempt) return;
      const rows = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as R)).filter(row => typeof row.month === 'string').sort((a, b) => b.month.localeCompare(a.month));
      knowledge.observe(rows.map(row => row.id)); state.records = rows;
      const serverConfirmed = snapshot.metadata.fromCache === false;
      state.readState = serverConfirmed ? 'ready' : 'cache';
      if (serverConfirmed) {
        for (const [month, rejected] of state.rejected) if (attempt > rejected.attempt) state.rejected.delete(month);
        if (state.recovery === 'rejected' && !state.rejected.has(state.month)) { state.recovery = 'none'; state.error = ''; }
      }
      const received = rows.find(row => row.month === state.month);
      if (state.overlay) {
        const overlay = state.overlay;
        const joined = rows.find(row => row.id === overlay.id && row.month === state.month && row.revisionCount >= overlay.revisionCount &&
          (!overlay.confirmedAt || (row.confirmedAt === overlay.confirmedAt && row.confirmedBy === overlay.confirmedBy)));
        if (serverConfirmed && joined) state.overlay = undefined;
      }
      // 조회 갱신은 입력 중이거나 처리 중인 본문을 대신하지 않는다.
      if (serverConfirmed && !state.dirty && !state.run && !state.overlay && !state.unknown.has(state.month)) {
        if (received && (!state.record?.id || state.record.id === received.id)) {
          state.record = received; state.draft = latest.current.readDraft(received);
        } else if (!state.record?.id && !received) state.draft = latest.current.createDraft();
      }
      notify();
    }, () => {
      if (!active || !current() || state.attempt !== attempt) return;
      active = false; state.readState = 'error';
      state.readError = '월별 기록을 확인하지 못했습니다. 입력은 보존했습니다. 다시 조회해 주세요.'; notify();
    });
    return () => { active = false; stop(); };
  }, [state, state.attempt]);

  const conflict = () => !state.record?.id && state.records.some(row => row.month === state.month);
  const targetPresent = () => !state.record?.id || state.records.some(row => row.id === state.record!.id && row.month === state.month) ||
    (!state.records.some(row => row.month === state.month) && knowledge.allowsUnobservedAck(state.record.id));
  const canSend = (kind: Action) => current() && !state.run && state.readState === 'ready' && state.recovery === 'none' &&
    !state.unknown.has(state.month) && permitted(kind) && !conflict() && targetPresent() && (kind !== 'confirm' || !!state.record?.id);
  const selectMonth = (month: string) => {
    if (!current() || state.run || month === state.month) return;
    state.selection++; knowledge.clearSelection(); state.month = month; state.dirty = false; state.overlay = undefined; state.error = '';
    const observed = state.readState === 'ready' ? state.records.find(row => row.month === month) : undefined;
    const acknowledged = state.acknowledged.get(month);
    const joined = acknowledged && observed?.id === acknowledged.id && observed!.revisionCount >= acknowledged.revisionCount &&
      (!acknowledged.confirmedAt || (observed!.confirmedAt === acknowledged.confirmedAt && observed!.confirmedBy === acknowledged.confirmedBy));
    state.record = joined ? observed : acknowledged ?? observed;
    if (acknowledged && !joined) { state.overlay = acknowledged; knowledge.rememberAck(acknowledged.id!); }
    const unknown = state.unknown.get(month);
    state.draft = unknown ? unknown.draft : state.record ? latest.current.readDraft(state.record) : latest.current.createDraft();
    state.recovery = unknown ? 'unknown' : state.rejected.has(month) ? 'rejected' : 'none';
    if (state.recovery === 'rejected') state.error = state.rejected.get(month)!.error;
    if (unknown) state.error = '이 월의 저장 결과가 미확인 상태입니다. 입력은 보존했습니다. 다시 조회해 기록을 확인하세요. 새 저장은 보내지 않습니다.';
    notify();
  };
  const openObservedRecord = () => {
    if (!current() || state.run || state.readState !== 'ready') return;
    const observed = state.records.find(row => row.month === state.month); if (!observed) return;
    state.selection++; knowledge.clearSelection();
    if (state.acknowledged.get(state.month)?.id !== observed.id) state.acknowledged.delete(state.month);
    state.record = observed; state.overlay = undefined;
    state.draft = latest.current.readDraft(observed); state.dirty = false;
    if (!state.unknown.has(state.month)) { state.error = state.rejected.get(state.month)?.error ?? ''; state.recovery = state.rejected.has(state.month) ? 'rejected' : 'none'; }
    else state.error = '조회된 기록을 열었습니다. 이전 요청의 성공 증명은 아니며 미확인 요청의 재송신은 계속 막았습니다.';
    notify();
  };
  const editDraft = (update: D | ((draft: D) => D)) => {
    if (!current() || state.run || !editableMonth()) return;
    state.draft = typeof update === 'function' ? (update as (draft: D) => D)(state.draft) : update;
    state.dirty = true; notify();
  };
  const retryRead = () => { if (current() && !state.run) { state.attempt++; state.readState = 'loading'; state.readError = ''; notify(); } };
  const run = async (kind: Action, writer: (context: MonthlyWriteContext<R, D>) => Promise<{ id: string; record: R }>) => {
    if (!canSend(kind)) {
      if (current() && !state.run && permitted(kind) && state.readState === 'ready' && (!targetPresent() || conflict())) {
        state.error = '현재 목록에서 선택 기록을 확인하지 못했거나 같은 월의 다른 기록이 있습니다. 입력은 보존했습니다. 다시 조회하거나 조회된 기록을 열어 진행해 주세요.'; notify();
      }
      return;
    }
    const token = {}, generation = state.selection;
    const context = { month: state.month, draft: state.draft, currentRecord: state.record };
    state.run = token; state.action = kind; state.error = ''; notify();
    const owns = () => current() && state.selection === generation && state.run === token;
    try {
      const result = await writer(context);
      if (!owns() || !permitted(kind)) return;
      if (kind === 'save' && !context.currentRecord?.id) knowledge.rememberAck(result.id);
      state.record = { ...result.record, id: result.id }; state.overlay = state.record;
      // 확인 ACK는 본문 저장이 아니므로 작성 중 dirty를 해제하지 않는다.
      state.acknowledged.set(state.month, state.record);
      if (kind === 'save') { state.dirty = false; state.draft = context.draft; }
    } catch (error) {
      if (!owns() || !permitted(kind)) return;
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code).replace('firestore/', '') : '';
      const rejected = ['permission-denied', 'unauthenticated', 'invalid-argument', 'failed-precondition', 'not-found', 'already-exists'].includes(code);
      state.recovery = rejected ? 'rejected' : 'unknown';
      if (rejected) {
        state.rejectedAttempt = state.attempt;
        const reason = code === 'permission-denied' || code === 'unauthenticated' ? '현재 계정의 저장 권한을 확인해 주세요.' : '기록과 입력 내용을 확인해 주세요.';
        state.error = '요청이 거절되었습니다. 입력은 보존했습니다. ' + reason + ' 다시 조회한 뒤 저장으로 재진행해 주세요.';
        state.rejected.set(state.month, {attempt: state.attempt, error: state.error});
      } else {
        state.unknown.set(state.month, context);
        state.error = '저장 결과를 확인하지 못했습니다. 입력은 보존되어 있습니다. 다시 조회해 기록을 확인하세요. 미확인 요청은 다시 보내지 않습니다.';
      }
    } finally { if (owns()) { state.run = null; state.action = null; notify(); } }
  };
  return { month: state.month, selectMonth, records: state.records, currentRecord: state.record, draft: state.draft, editDraft,
    readState: state.readState, readError: state.readError, retryRead, busy: !!state.run, action: state.action,
    error: state.error, recovery: state.recovery, canEdit: current() && !state.run && editableMonth(),
    canSave: canSend('save'), canConfirm: canSend('confirm'), hasObservedRecord: state.records.some(row => row.month === state.month),
    collision: conflict(), targetMissing: !targetPresent(), openObservedRecord,
    runSave: (writer: (context: MonthlyWriteContext<R, D>) => Promise<{id: string; record: R}>) => run('save', writer),
    runConfirm: (writer: (context: MonthlyWriteContext<R, D>) => Promise<{id: string; record: R}>) => run('confirm', writer) };
}

