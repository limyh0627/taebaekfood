import { useEffect, useReducer, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../shared/firebase';
import type { CompanyId, IssuedStatement } from '../../../shared/types';
import { captureStatementEdit, executeStatementEdit, executePersistentStatementEdit, statementEditFollowupPending, type StatementEditWriter } from '../application/statementEditor';
import type { StatementEditBindings, StatementEditEntry, StatementEditFollowupPlan, StatementEditProgress, StatementEditObservation, StatementEditScope } from '../../../shared/services/statementEditWrites';
import { statementEditKey } from '../../../shared/services/statementEditWrites';
import type { StatementEditRecoveryResult } from '../../../shared/statementEditRecovery';
export interface StatementEditorOptions {
    companyId: CompanyId;
    actorUid?: string;
    original: IssuedStatement | null;
    draftFingerprint: string;
    save?: StatementEditWriter;
    bindings?: StatementEditBindings;
    onCommitted?: () => void;
}
export interface StatementEditInput {
    isCurrent?: () => boolean;
    patch: Partial<IssuedStatement>;
    confirm?: () => Promise<boolean>;
    afterSave?: (isCurrent: () => boolean, report: (progress: StatementEditProgress) => Promise<void>) => unknown | Promise<unknown>;
    getFollowupPlan?: () => StatementEditFollowupPlan;
}
export function useStatementEditor(options: StatementEditorOptions) {
    const [, repaint] = useReducer(value => value + 1, 0);
    const latest = useRef(options);
    latest.current = options;
    const alive = useRef(true);
    const liveUid = useRef(auth.currentUser?.uid ?? '');
    const unconfirmed = useRef(new Map<string, {
        revision: number;
        patch: Partial<IssuedStatement>;
        message: string;
    }[]>());
    const lockedBy = useRef(new WeakMap<object, string>());
    const state = useRef({ key: '', generation: 0, busy: false, error: '', message: '', uncertain: false });
    const recovery = useRef({ key: '', owner: {}, busy: false, entries: [] as StatementEditEntry[], history: [] as StatementEditRecoveryResult[], results: new Map<string, StatementEditObservation>(), readLoading: false, readError: '', message: '', historyLoading: false, historyError: '', cursor: null as string | null });
    const scopeKey = JSON.stringify([options.companyId, options.actorUid, auth.currentUser?.uid]);
    if (recovery.current.key !== scopeKey)
        recovery.current = { key: scopeKey, owner: {}, busy: false, entries: [], history: [], results: new Map(), readLoading: false, readError: '', message: '', historyLoading: false, historyError: '', cursor: null };
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
                recovery.current.owner = {};
                repaint();
            }
        });
        return () => { alive.current = false; unsubscribe(); };
    }, []);
    const isCurrentActor = () => alive.current && !!latest.current.actorUid && auth.currentUser?.uid === latest.current.actorUid;
    const scope = (): StatementEditScope => ({ companyId: latest.current.companyId, actorUid: latest.current.actorUid ?? '' });
    const entryKey = (entry: StatementEditEntry) => entry.key;
    async function refresh() {
        const owner = recovery.current, token = owner.owner, ports = latest.current.bindings, fixed = scope();
        const current = () => isCurrentActor() && recovery.current === owner && owner.owner === token;
        if (!ports || !current())
            return;
        owner.readLoading = true;
        owner.readError = '';
        repaint();
        try {
            const rows = await ports.readPending(fixed, current);
            if (current())
                owner.entries = rows;
        }
        catch (error) {
            if (current())
                owner.readError = error instanceof Error ? error.message : '보관한 전표 수정 요청을 읽지 못했습니다.';
        }
        finally {
            if (current()) {
                owner.readLoading = false;
                repaint();
            }
        }
    }
    useEffect(() => { void refresh(); const changed = () => void refresh(); window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed); }, [scopeKey, options.bindings]);
    async function history(next = false) {
        const owner = recovery.current, token = owner.owner, ports = latest.current.bindings, fixed = scope();
        const current = () => isCurrentActor() && recovery.current === owner && owner.owner === token;
        if (!ports || !current() || owner.historyLoading || next && !owner.cursor)
            return;
        owner.historyLoading = true;
        owner.historyError = '';
        repaint();
        try {
            const page = await ports.listHistory(fixed, next ? owner.cursor! : undefined, current);
            if (current()) {
                const results = page.entries.map(row => row.result);
                owner.history = next ? [...owner.history, ...results] : results;
                owner.cursor = page.nextCursor;
            }
        }
        catch (error) {
            if (current())
                owner.historyError = error instanceof Error ? error.message : '전표 수정 처리 기록을 읽지 못했습니다.';
        }
        finally {
            if (current()) {
                owner.historyLoading = false;
                repaint();
            }
        }
    }
    async function recover(entry: StatementEditEntry, mode: 'inspect' | 'apply' | 'cancel' | 'discard') {
        const owner = recovery.current, token = owner.owner, ports = latest.current.bindings, fixed = scope();
        const current = () => isCurrentActor() && recovery.current === owner && owner.owner === token;
        if (!ports || !current() || owner.busy || state.current.busy)
            return;
        owner.busy = true;
        owner.readError = '';
        repaint();
        try {
            const observation = await (mode === 'discard' ? ports.discardObserved : ports[mode])(fixed, entry, current);
            if (!current())
                return;
            if ('result' in observation)
                owner.results.set(entryKey(entry), observation);
            if ('result' in observation && mode !== 'discard' && observation.terminal && !observation.copyMismatch && observation.result.status === 'applied' && observation.entry.retained)
                await ports.markFollowup(fixed, observation.entry, 'body-ack', current);
            await refresh();
            if (current() && mode === 'discard' && lockedBy.current.get(state.current) === entry.key) {
                state.current.uncertain = false;
                state.current.error = '';
                state.current.message = '기기에 남은 요청 정보를 정리했습니다. 수정이 이미 처리됐다면 이 창을 닫고 목록에서 전표를 다시 열어 현재 내용을 확인한 뒤 수정해 주세요.';
            }
            if (current() && !('result' in observation))
                owner.message = observation.message;
            return observation;
        }
        catch (error) {
            if (current()) {
                const message = error instanceof Error ? error.message : '전표 수정 처리 결과를 확인하지 못했습니다.';
                await refresh();
                if (current())
                    owner.readError = message;
            }
        }
        finally {
            if (current()) {
                owner.busy = false;
                repaint();
            }
        }
    }
    async function run(original: IssuedStatement, input: StatementEditInput, close: boolean) {
        const owner = state.current;
        if (!isCurrentActor() || owner.busy || owner.uncertain || recovery.current.busy || recovery.current.readLoading)
            return;
        owner.busy = true;
        owner.error = '';
        owner.message = '';
        repaint();
        const fixed = latest.current;
        const requestScope = JSON.stringify([fixed.companyId, fixed.actorUid, original.id]);
        const prepared = { entry: null as StatementEditEntry | null };
        const ownerCurrent = () => isCurrentActor() && state.current === owner && latest.current.companyId === fixed.companyId && latest.current.actorUid === fixed.actorUid;
        const current = () => ownerCurrent() && (input.isCurrent?.() ?? true);
        try {
            const captured = captureStatementEdit(original, original.id, fixed.companyId);
            const patch = structuredClone(input.patch);
            if (unconfirmed.current.get(requestScope)?.some(entry => entry.revision === captured.expectedRevision && JSON.stringify(entry.patch) === JSON.stringify(patch))) {
                owner.error = '이 내용의 이전 수정 결과가 불확실합니다. 전표를 다시 열어 실제 내용을 먼저 확인해 주세요.';
                return;
            }
            if (input.confirm && !await input.confirm())
                return;
            if (!current())
                return;
            if (fixed.bindings) {
                const ports = fixed.bindings, fixedScope = { companyId: fixed.companyId, actorUid: fixed.actorUid! };
                const result = await executePersistentStatementEdit({ ports, scope: fixedScope, original: captured.original, patch, plan: input.getFollowupPlan?.() ?? null, current, afterSave: input.afterSave,
                    onPrepared: entry => { prepared.entry = entry; }, onObserved: observation => { if (current())
                        recovery.current.results.set(observation.entry.key, observation); } });
                await refresh();
                if (!current())
                    return result;
                owner.message = result.message;
                owner.uncertain = result.status === 'unknown' || result.status === 'partial';
                if (owner.uncertain && prepared.entry)
                    lockedBy.current.set(owner, prepared.entry.key);
                owner.error = result.status === 'saved' ? '' : result.message;
                if (result.status === 'saved' && close) {
                    owner.busy = false;
                    fixed.onCommitted?.();
                }
                return result;
            }
            const result = await executeStatementEdit({
                original: captured.original,
                patch,
                context: { companyId: fixed.companyId, actorUid: fixed.actorUid!, isCurrent: current },
                save: fixed.save,
                afterSave: input.afterSave ? isCurrent => input.afterSave!(isCurrent, async () => { }) : undefined,
            });
            if (result.status === 'unknown' || result.status === 'partial' || (result.status === 'stale' && !result.acknowledged)) {
                const entries = unconfirmed.current.get(requestScope) ?? [];
                entries.push({ revision: captured.expectedRevision, patch, message: result.message });
                unconfirmed.current.set(requestScope, entries);
            }
            if (!current())
                return result;
            owner.message = result.message;
            if (result.status === 'unknown' || result.status === 'partial') {
                owner.uncertain = true;
                owner.error = result.message;
            }
            else if (result.status === 'not-started')
                owner.error = result.message;
            if (result.status === 'saved' && close) {
                owner.busy = false;
                fixed.onCommitted?.();
            }
            return result;
        }
        catch (error) {
            if (fixed.bindings)
                await refresh();
            if (current()) {
                owner.error = error instanceof Error ? error.message : '전표 수정 내용을 확인하지 못했습니다.';
                if (prepared.entry) {
                    owner.uncertain = true;
                    lockedBy.current.set(owner, prepared.entry.key);
                }
            }
        }
        finally {
            if (ownerCurrent()) {
                owner.busy = false;
                repaint();
            }
        }
    }
    const visible = isCurrentActor();
    const resultFor = (entry: StatementEditEntry) => recovery.current.results.get(entryKey(entry))?.result ?? recovery.current.history.find(result => entry.reference?.operationId === result.reference.operationId && entry.reference.statementId === result.reference.statementId);
    const all = new Map(recovery.current.entries.map(entry => [entry.key, entry]));
    for (const result of recovery.current.history) {
        const key = statementEditKey(scope(), result.reference);
        if (!all.has(key))
            all.set(key, { key, reference: result.reference, retained: null, observedLocalText: null, observedReferenceText: null, description: '이전 전표 수정' });
    }
    const rows = [...all.values()].map(entry => {
        const result = resultFor(entry), body = entry.retained;
        return { entry, currentState: result?.status === 'applied' || body?.bodyAcknowledged ? '이 요청의 전표 수정 처리 완료' : result?.status === 'cancelled' ? '미처리 수정 중단 확인' : '전표 수정 결과 확인 필요', cause: body?.lastError ?? recovery.current.results.get(entry.key)?.message ?? result?.message ?? (!body && (entry.observedLocalText || entry.observedReferenceText) ? '보관한 본문이나 독립 참조를 정확히 읽지 못했습니다. 같은 요청을 다시 보내지 않았습니다.' : '기기에 보관한 전표 수정 요청입니다.'), nextAction: !entry.reference ? '요청을 식별할 수 없어 서버 처리 여부는 확인하지 못했습니다. 처리 기록을 확인하거나 이 기기의 손상 정보만 정리할 수 있습니다. 서버 요청 중단은 아닙니다.' : result?.status === 'cancelled' ? '기기에 남은 요청 정보를 정리한 뒤 새로 수정해 주세요.' : result?.status === 'applied' || body?.bodyAcknowledged ? body && statementEditFollowupPending(entry) ? '거래조건과 원가 후속 처리를 확인해 주세요. 자동으로 다시 실행하지 않았습니다. 이후 전표의 추가 수정·삭제 여부는 확인하지 않았습니다. 이 창을 닫고 목록에서 전표를 다시 열어 현재 내용을 확인한 뒤 수정해 주세요.' : '이후 전표의 추가 수정·삭제 여부는 확인하지 않았습니다. 이 창을 닫고 목록에서 전표를 다시 열어 현재 내용을 확인한 뒤 수정해 주세요.' : '결과를 확인하거나 미처리 요청을 중단해 주세요.' };
    });
    const failureRows = rows.filter(row => !!(row.entry.observedLocalText || row.entry.observedReferenceText));
    return {
        busy: visible && (state.current.busy || recovery.current.busy),
        locked: visible && state.current.uncertain,
        error: visible ? state.current.error : '',
        message: visible ? state.current.message : '',
        notice: visible && unconfirmed.current.has(JSON.stringify([options.companyId, options.actorUid, options.original?.id])) ? '이 전표의 이전 수정 또는 후속 처리 결과를 확인하지 못했습니다. 전표와 거래조건을 다시 확인해 주세요. 새 입력 저장은 이전 요청의 안전한 재시도가 아닙니다.' : '',
        isCurrentActor,
        isBusy: () => state.current.busy || recovery.current.busy,
        recoveryScopeKey: scopeKey,
        failureRows: visible ? failureRows : [], historyRows: visible ? rows : [], failureCount: visible ? failureRows.length : 0,
        readLoading: visible && recovery.current.readLoading, readError: visible ? recovery.current.readError : '',
        recoveryMessage: visible ? recovery.current.message : '',
        historyLoading: visible && recovery.current.historyLoading, historyError: visible ? recovery.current.historyError : '', historyMore: visible && !!recovery.current.cursor,
        refresh, loadHistory: () => history(), nextHistory: () => history(true), resultFor,
        inspect: (entry: StatementEditEntry) => recover(entry, 'inspect'), retry: (entry: StatementEditEntry) => recover(entry, 'apply'), stop: (entry: StatementEditEntry) => recover(entry, 'cancel'), discardCopy: (entry: StatementEditEntry) => recover(entry, 'discard'),
        canRetry: (entry: StatementEditEntry) => !!entry.retained && !entry.retained.bodyAcknowledged && (!resultFor(entry) || resultFor(entry)?.status === 'unknown'),
        canStop: (entry: StatementEditEntry) => !!entry.reference && !entry.retained?.bodyAcknowledged && (!resultFor(entry) || resultFor(entry)?.status === 'unknown'),
        canInspect: (entry: StatementEditEntry) => !!entry.reference,
        canDiscard: (entry: StatementEditEntry) => !!(entry.observedLocalText || entry.observedReferenceText) && (!entry.reference || !!resultFor(entry) && resultFor(entry)?.status !== 'unknown'),
        saveEdit: (input: StatementEditInput) => latest.current.original ? run(latest.current.original, input, true) : Promise.resolve(undefined),
        updateDate: (original: IssuedStatement, date: string, confirm?: () => Promise<boolean>) => run(original, { patch: { tradeDate: date }, confirm }, false),
        updateEvidence: (original: IssuedStatement, evidence: string) => run(original, { patch: { evidence } }, false),
        invalidate: () => { state.current = { key: '', generation: state.current.generation + 1, busy: false, error: '', message: '', uncertain: false }; repaint(); },
    };
}
