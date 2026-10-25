import { useEffect, useReducer, useRef } from 'react';
import { createHaccpRecordAcknowledgements } from '../domain/haccpRecordAcknowledgements';
import { auth } from '../../../shared/firebase';
import type { CompanyId } from '../../../shared/types';
export type HaccpRecordOwner = object;
export type HaccpRecordRead = 'records' | 'template';
export type HaccpRecordAction = 'save' | 'confirm' | 'delete';
interface Options<T> {
    getKey(record: T): string;
    getRevision(record: T): number;
    mergeConfirmed(base: T, result: T): T;
    companyId: CompanyId;
    currentUserId?: string;
    isAdmin?: boolean;
    canConfirm?: boolean;
    getUid?: () => string | undefined;
}
export function useHaccpRecordEditor<T extends {
    id?: string;
}>(options: Options<T>) {
    const [, paint] = useReducer(value => value + 1, 0);
    const latest = useRef(options);
    latest.current = options;
    const getUid = () => latest.current.getUid ? latest.current.getUid() ?? '' : auth.currentUser?.uid ?? '';
    const make = () => ({ companyId: options.companyId, employee: options.currentUserId ?? '', uid: getUid(),
        alive: true, selected: null as T | null, selection: 0, run: null as object | null,
        acknowledgements: createHaccpRecordAcknowledgements<T>({getKey: record => latest.current.getKey(record), strategy: {kind: 'numeric', getRevision: record => latest.current.getRevision(record)}, mergeConfirmed: (base, result) => latest.current.mergeConfirmed(base, result)}),
        error: '', reads: { records: false, template: false }, readErrors: { records: '', template: '' }, readRevision: 0 });
    const ref = useRef<ReturnType<typeof make> | null>(null);
    if (!ref.current || !ref.current.alive || ref.current.companyId !== options.companyId ||
        ref.current.employee !== (options.currentUserId ?? '') || ref.current.uid !== getUid()) {
        if (ref.current)
            ref.current.alive = false;
        ref.current = make();
    }
    const state = ref.current;
    const generation = state.selection;
    const current = () => state.alive && ref.current === state && getUid() === state.uid;
    const isCurrent = (token: HaccpRecordOwner) => token === state && current();
    const notify = () => { if (current())
        paint(); };
    const ready = () => state.reads.records && state.reads.template;
    const canEdit = () => current() && ready() && !state.run && generation === state.selection;
    useEffect(() => {
        state.alive = true;
        let active = true;
        const stop = auth.onAuthStateChanged(user => {
            if (!active || ref.current !== state)
                return;
            if ((user?.uid ?? '') !== state.uid) {
                state.alive = false;
                paint();
            }
        });
        return () => { active = false; state.alive = false; stop(); };
    }, [state]);
    const keyOf = (record: T) => latest.current.getKey(record);
    const resolveRecord = (fallback: T): T => state.acknowledgements.resolve(fallback, state.reads.records);
    const select = (next: T | null, prepare?: (record: T) => T) => {
        if (!canEdit() || (next?.id && state.acknowledgements.isDeleted(next.id))) return;
        const resolved = state.acknowledgements.select(next, state.reads.records);
        state.selected = resolved && prepare ? prepare(resolved) : resolved;
        state.selection++;
        state.error = '';
        notify();
    };
    const openServerRecord = () => {
        if (!canEdit() || !state.selected) return;
        const candidate = state.acknowledgements.serverRecord(keyOf(state.selected));
        if (!candidate?.id) return;
        const row = state.acknowledgements.openServerRecord(keyOf(state.selected), candidate.id, state.reads.records);
        if (!row) return;
        state.selected = row; state.selection++; state.error = ''; notify();
    };
    const targetAllowed = (kind: HaccpRecordAction, id?: string) => (kind === 'delete' || !!state.selected) && state.acknowledgements.canTarget(kind, id, state.selected ? keyOf(state.selected) : '');
    const targetError = (kind: HaccpRecordAction, id?: string) => {
        const issue = state.acknowledgements.targetIssue(kind, id, state.selected ? keyOf(state.selected) : '');
        if (!issue) return;
        const messages = {'body-mismatch': '마지막 저장 내용과 조회된 내용이 다릅니다. 입력은 보존했습니다. 다시 조회하거나 저장된 기록을 열어 확인해 주세요.', 'duplicate-key': '같은 점검 기록이 여러 개입니다. 입력은 보존했습니다. 관리자 확인 후 기존 이력에서 중복 기록을 정리하고 다시 조회해 주세요.', 'existing-key': '같은 날짜의 저장된 기록이 있습니다. 입력은 보존했습니다. 조회된 기록을 열어 확인해 주세요.', 'missing-record': '현재 목록에서 선택 기록을 확인하지 못했습니다. 입력은 보존했습니다. 다시 조회하거나 다른 기록을 선택해 주세요.'};
        state.error = messages[issue]; notify();
    };
    const edit = (action: T | null | ((previous: T | null) => T | null)) => {
        if (!canEdit())
            return;
        state.selected = typeof action === 'function' ? action(state.selected) : action;
        notify();
    };
    const run = async (kind: HaccpRecordAction, targetId: string | undefined, allowed: () => boolean, work: (isCurrent: () => boolean) => Promise<T | null | void | {deletedId: string; selected: T | null | undefined}>) => {
        if (!canEdit() || !state.uid)
            return;
        const permission = () => (kind !== 'confirm' || !!latest.current.canConfirm) && (kind !== 'delete' || !!latest.current.isAdmin);
        const authorized = () => current() && generation === state.selection && allowed() && permission();
        const actionAllowed = () => ready() && authorized() && targetAllowed(kind, targetId);
        if (!actionAllowed()) { if (current() && ready() && permission() && !targetAllowed(kind, targetId)) targetError(kind, targetId); return; }
        // 선택은 처리 중 바꿀 수 없고, ACK는 이 실행이 예약한 선택에만 적용한다.
        if (kind !== 'delete' && state.selected?.id !== targetId)
            return;
        const confirmationBase = kind === 'confirm' && state.selected ?
            state.acknowledgements.captureConfirm(keyOf(state.selected), targetId!) : undefined;
        const saveObservation = state.acknowledgements.captureSave();
        const token = {};
        state.run = token;
        state.error = '';
        notify();
        const owns = () => current() && state.run === token && state.selection === generation;
        const permitted = () => { const valid = owns() && actionAllowed(); if (!valid && owns() && ready() && permission() && !targetAllowed(kind, targetId)) targetError(kind, targetId); return valid; };
        try {
            const result = await work(permitted);
            if (!owns() || !permission())
                return;
            if (kind === 'delete' && result && typeof (result as {deletedId?: unknown}).deletedId === 'string' && Object.hasOwn(result, 'selected')) {
                const deletion = result as {deletedId: string; selected: T | null | undefined};
                state.acknowledgements.rememberDelete(deletion.deletedId, state.selected?.id);
                if (deletion.selected !== undefined) state.selected = deletion.selected;
            } else if (result !== undefined) {
                const recordResult = result as T | null;
                if (recordResult && kind === 'save') state.acknowledgements.rememberSave(recordResult, saveObservation);
                if (recordResult && kind === 'confirm' && confirmationBase) state.acknowledgements.rememberConfirm(recordResult, confirmationBase);
                state.selected = recordResult;
            }
        }
        catch (error) {
            if (!owns() || !permission())
                return;
            const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
            const reason = code.includes('permission-denied') ? '현재 계정의 저장 권한을 확인해주세요.' :
                code.includes('unavailable') || code.includes('network') ? '네트워크 연결을 확인해주세요.' : '저장된 기록을 먼저 확인해주세요.';
            state.error = '처리 결과를 확인하지 못했습니다. 입력 내용은 유지했습니다. ' + reason;
        }
        finally {
            if (state.run === token) {
                state.run = null;
                notify();
            }
        }
    };
    return { selected: state.selected, select, edit, run, resolveRecord, knownRecord: (key: string) => state.acknowledgements.known(key, state.reads.records), openServerRecord, isDeleted: state.acknowledgements.isDeleted,
        hasServerRecord: !!state.selected && !!state.acknowledgements.serverRecord(keyOf(state.selected)), busy: !!state.run, error: state.error, canEdit,
        ownerToken: state as HaccpRecordOwner, isCurrent, readRevision: state.readRevision,
        readReady: ready(), readPending: (kind: HaccpRecordRead) => { if (current()) { state.reads[kind] = false; state.readErrors[kind] = ''; notify(); } },
        observeRecords: (rows: T[], serverReady: boolean) => { if (current()) {
            state.acknowledgements.observe(rows, serverReady);
            state.reads.records = serverReady; state.readErrors.records = ''; notify();
        } }, readError: state.readErrors.records || state.readErrors.template,
        readSuccess: (kind: HaccpRecordRead) => { if (current()) {
            state.reads[kind] = true;
            state.readErrors[kind] = '';
            notify();
        } },
        readFailure: (kind: HaccpRecordRead) => { if (current()) {
            state.reads[kind] = false;
            state.readErrors[kind] = '기록과 점검 항목을 조회하지 못했습니다. 다시 조회해주세요.';
            notify();
        } },
        retryRead: () => { if (current() && !state.run) {
            state.readRevision++;
            state.reads = { records: false, template: false };
            state.readErrors = { records: '', template: '' };
            notify();
        } } };
}
