import { useEffect, useReducer, useRef } from 'react';
import { createHaccpRecordKnowledge } from '../domain/haccpRecordKnowledge';
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
        rawRecords: [] as T[], records: [] as T[], serverRecords: [] as T[], saved: new Map<string, T>(), confirmations: new Map<string, T>(), deleted: new Set<string>(), knowledge: createHaccpRecordKnowledge(),
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
    const revisionOf = (record: T) => latest.current.getRevision(record);
    const merge = (base: T, result: T) => latest.current.mergeConfirmed(base, result);
    const confirmedJoined = (server: T, saved: T) => JSON.stringify(merge({id: server.id} as T, server)) === JSON.stringify(merge({id: saved.id} as T, saved));
    const bestConfirmedBase = (key: string, id?: string, includeServer = true): T | undefined => {
        const saved = state.saved.get(key);
        const validSaved = saved && !state.deleted.has(saved.id ?? '') && (!id || saved.id === id) ? saved : undefined;
        const server = includeServer ? state.serverRecords.find(row => keyOf(row) === key && (!id || row.id === id) && !state.deleted.has(row.id ?? '')) : undefined;
        if (validSaved) {
            if (server && server.id === validSaved.id && revisionOf(server) >= revisionOf(validSaved) && confirmedJoined(server, validSaved)) return server;
            return validSaved;
        }
        if (server) { const confirmed = state.confirmations.get(server.id ?? ''); return confirmed ? merge(server, confirmed) : server; }
        return undefined;
    };
    const resolveRecord = (fallback: T): T => bestConfirmedBase(keyOf(fallback), undefined, state.reads.records) ?? fallback;
    const select = (next: T | null, prepare?: (record: T) => T) => {
        if (!canEdit() || (next?.id && state.deleted.has(next.id))) return;
        state.knowledge.clearSelection();
        const resolved = next ? resolveRecord(next) : null;
        state.selected = resolved && prepare ? prepare(resolved) : resolved;
        if (resolved?.id && state.saved.get(keyOf(resolved))?.id === resolved.id) state.knowledge.rememberAck(resolved.id);
        state.selection++;
        state.error = '';
        notify();
    };
    const openServerRecord = () => {
        if (!canEdit() || !state.selected) return;
        const row = state.serverRecords.find(row => keyOf(row) === keyOf(state.selected!) && !state.deleted.has(row.id ?? ''));
        if (!row) return;
        state.knowledge.clearSelection(); state.saved.delete(keyOf(row));
        state.selected = row; state.selection++; state.error = ''; notify();
    };
    const targetAllowed = (kind: HaccpRecordAction, id?: string) => {
        if (kind === 'delete') return !!id && !state.deleted.has(id) && state.records.some(row => row.id === id);
        if (!state.selected) return false;
        const key = keyOf(state.selected);
        if (id) return !state.deleted.has(id) && (state.records.some(row => row.id === id && keyOf(row) === key) ||
            (!state.records.some(row => keyOf(row) === key) && state.knowledge.allowsUnobservedAck(id)));
        return !state.rawRecords.some(row => keyOf(row) === key);
    };
    const targetError = () => { state.error = '현재 목록에서 선택 기록을 확인하지 못했거나 같은 날짜의 다른 기록이 있습니다. 입력은 보존했습니다. 다시 조회하거나 조회된 기록을 열어 진행해 주세요.'; notify(); };
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
        if (!actionAllowed()) { if (current() && ready() && permission() && !targetAllowed(kind, targetId)) targetError(); return; }
        // 선택은 처리 중 바꿀 수 없고, ACK는 이 실행이 예약한 선택에만 적용한다.
        if (kind !== 'delete' && state.selected?.id !== targetId)
            return;
        const confirmationBase = kind === 'confirm' && state.selected ?
            bestConfirmedBase(keyOf(state.selected), targetId) : undefined;
        const token = {};
        state.run = token;
        state.error = '';
        notify();
        const owns = () => current() && state.run === token && state.selection === generation;
        const permitted = () => { const valid = owns() && actionAllowed(); if (!valid && owns() && ready() && permission() && !targetAllowed(kind, targetId)) targetError(); return valid; };
        try {
            const result = await work(permitted);
            if (!owns() || !permission())
                return;
            if (kind === 'delete' && result && typeof (result as {deletedId?: unknown}).deletedId === 'string' && Object.hasOwn(result, 'selected')) {
                const deletion = result as {deletedId: string; selected: T | null | undefined};
                const id = deletion.deletedId, clearingSelected = state.selected?.id === id;
                state.deleted.add(id); state.confirmations.delete(id);
                for (const [key, saved] of state.saved) if (saved.id === id) state.saved.delete(key);
                state.records = state.records.filter(row => row.id !== id); state.serverRecords = state.serverRecords.filter(row => row.id !== id);
                if (deletion.selected !== undefined) state.selected = deletion.selected;
                if (clearingSelected) state.knowledge.clearSelection();
            } else if (result !== undefined) {
                const recordResult = result as T | null;
                if (recordResult && kind === 'save' && recordResult.id) { state.saved.set(keyOf(recordResult), recordResult); state.knowledge.rememberAck(recordResult.id); }
                if (recordResult && kind === 'confirm' && recordResult.id) {
                    const key = keyOf(recordResult);
                    const latestBase = bestConfirmedBase(key, recordResult.id);
                    const base = confirmationBase && (!latestBase || revisionOf(confirmationBase) > revisionOf(latestBase)) ? confirmationBase : latestBase;
                    const metadata = merge({id: recordResult.id} as T, recordResult); state.confirmations.set(recordResult.id, metadata);
                    if (base) state.saved.set(key, merge(base, metadata));
                }
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
    return { selected: state.selected, select, edit, run, resolveRecord, knownRecord: (key: string) => { const saved = state.saved.get(key); return saved && !state.deleted.has(saved.id ?? '') ? resolveRecord(saved) : undefined; }, openServerRecord, isDeleted: (id: string) => state.deleted.has(id),
        hasServerRecord: !!state.selected && state.serverRecords.some(row => keyOf(row) === keyOf(state.selected!)), busy: !!state.run, error: state.error, canEdit,
        ownerToken: state as HaccpRecordOwner, isCurrent, readRevision: state.readRevision,
        readReady: ready(), readPending: (kind: HaccpRecordRead) => { if (current()) { state.reads[kind] = false; state.readErrors[kind] = ''; notify(); } },
        observeRecords: (rows: T[], serverReady: boolean) => { if (current()) {
            state.rawRecords = rows; state.records = rows.filter(row => !state.deleted.has(row.id ?? '')); state.knowledge.observe(rows.map(row => row.id));
            if (serverReady) state.serverRecords = state.records;
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
