import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../shared/firebase';
import type { Partner } from '../../../shared/types';
import { partnerEditOpening, type PartnerEditOpenResult, type PartnerEditResult, type PartnerEditHistoryResult } from '../../../shared/partnerEditCommand';
import { partnerEditWrites, partnerEditKey, type PartnerEditBindings, type PartnerEditEntry, type PartnerEditScope, type PartnerEditObservation } from '../../../shared/services/partnerEditWrites';
import { saveOutcomeMessage } from '../../../shared/saveOutcome';
import { buildPartnerEditPatch } from '../application/partnerEditor';
export interface PartnerEditorOptions {
    companyId?: string;
    actorUid?: string;
    partners: Partner[];
    partnerEditBindings?: PartnerEditBindings;
    externalBusy?: boolean;
    selectOpening?: (partner: Partner) => boolean;
}
export interface PartnerRecoveryRow {
    entry: PartnerEditEntry;
    currentState: string;
    cause: string;
    nextAction: string;
}
function createState(owner: string) {
    return { owner, form: null as Partner | null, original: null as Partner | null, opened: null as PartnerEditOpenResult | null,
        token: 0, busy: false, opening: false, locked: false, requiresReopen: false,
        inlineError: '', inlineMessage: '', recoveryError: '', recoveryMessage: '', errorKey: null as string | null,
        pending: null as {
            entry: PartnerEditEntry;
            token: number;
        } | null,
        operations: [] as PartnerEditEntry[], results: new Map<string, PartnerEditObservation>(),
        history: [] as PartnerEditHistoryResult['entries'], cursor: null as string | null,
        readLoading: true, readError: '', historyLoading: false, historyError: '', readGeneration: 0, historyGeneration: 0 };
}
export function usePartnerEditor(options: PartnerEditorOptions) {
    const [, repaint] = useState(0);
    const [liveUid, setLiveUid] = useState(() => auth.currentUser?.uid ?? '');
    useEffect(() => onAuthStateChanged(auth, user => setLiveUid(user?.uid ?? '')), []);
    const latest = useRef(options);
    latest.current = options;
    const owner = JSON.stringify([options.companyId ?? '', options.actorUid ?? liveUid, liveUid]);
    const stateRef = useRef(createState(owner));
    if (stateRef.current.owner !== owner)
        stateRef.current = createState(owner);
    const state = stateRef.current, ports = options.partnerEditBindings ?? partnerEditWrites;
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const current = () => mounted.current && stateRef.current === state && ['taebaek', 'punghoe'].includes(options.companyId ?? '') && !!liveUid && auth.currentUser?.uid === liveUid && (!options.actorUid || options.actorUid === liveUid);
    const scope: PartnerEditScope = { companyId: options.companyId as PartnerEditScope['companyId'], actorUid: liveUid };
    const update = () => {
        if (mounted.current && stateRef.current === state)
            repaint(n => n + 1);
    };
    const isBusy = () => !current() || state.busy || state.opening || !!latest.current.externalBusy;
    const available = () => !isBusy() && !state.readLoading && !state.readError;
    const refresh = async () => {
        if (!current())
            return;
        const generation = ++state.readGeneration;
        state.readLoading = true;
        state.readError = '';
        update();
        try {
            const rows = await ports.read(scope, current);
            if (current() && generation === state.readGeneration)
                state.operations = rows;
        }
        catch (error) {
            if (current() && generation === state.readGeneration)
                state.readError = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (current() && generation === state.readGeneration) {
                state.readLoading = false;
                update();
            }
        }
    };
    useEffect(() => {
        void refresh();
        const read = () => {
            void refresh();
        };
        window.addEventListener('storage', read);
        window.addEventListener('partner-edit-requests', read);
        return () => {
            state.readGeneration++;
            state.historyGeneration++;
            window.removeEventListener('storage', read);
            window.removeEventListener('partner-edit-requests', read);
        };
    }, [owner]);
    const openEditing = async (partner: Partner) => {
        if (!available())
            return;
        const original = structuredClone(partner);
        if (latest.current.selectOpening && !latest.current.selectOpening(structuredClone(original)))
            return;
        state.token++;
        const token = state.token;
        state.original = original;
        state.form = structuredClone(original);
        state.opened = null;
        state.pending = null;
        state.locked = false;
        state.requiresReopen = false;
        state.inlineError = '';
        state.inlineMessage = '';
        state.opening = true;
        update();
        try {
            const reference = { companyId: scope.companyId, planId: crypto.randomUUID(), targetId: original.id };
            const opened = await ports.open(scope, reference, partnerEditOpening(original), current);
            if (current() && state.token === token) {
                state.opened = opened;
                state.locked = state.operations.some(row => row.reference?.targetId === original.id);
            }
        }
        catch (error) {
            if (current() && state.token === token)
                state.inlineError = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (current() && state.token === token) {
                state.opening = false;
                update();
            }
        }
    };
    const closeEditing = () => {
        if (isBusy())
            return;
        state.token++;
        state.form = null;
        state.original = null;
        state.opened = null;
        state.pending = null;
        state.locked = false;
        state.requiresReopen = false;
        state.inlineError = '';
        update();
    };
    const setEditForm = (action: SetStateAction<Partner | null>) => {
        if (!available() || state.locked || !state.form)
            return;
        const value = typeof action === 'function' ? action(structuredClone(state.form)) : action;
        if (!value || value.id !== state.form.id || JSON.stringify(value) === JSON.stringify(state.form))
            return;
        state.form = structuredClone(value);
        state.token++;
        state.inlineError = '';
        update();
    };
    const consume = (entry: PartnerEditEntry, observation: PartnerEditObservation) => {
        if (!current())
            return;
        state.results.set(entry.key, observation);
        state.errorKey = entry.key;
        state.recoveryError = saveOutcomeMessage(observation.outcome);
        state.recoveryMessage = observation.outcome.status === 'saved' ? '이 요청의 거래처 수정을 확인했습니다.' : '';
        if (state.locked && state.original?.id === entry.reference?.targetId && observation.terminal)
            state.requiresReopen = true;
        const pending = state.pending;
        if (!pending || pending.token !== state.token || pending.entry.key !== entry.key || pending.entry.observedLocalText !== entry.observedLocalText || pending.entry.observedReferenceText !== entry.observedReferenceText || !observation.terminal)
            return;
        state.pending = null;
        if (observation.outcome.status === 'saved') {
            state.form = null;
            state.original = null;
            state.opened = null;
            state.locked = false;
            state.inlineMessage = '거래처를 수정했습니다.';
        }
        else {
            state.locked = true;
            state.requiresReopen = true;
            state.inlineError = saveOutcomeMessage(observation.outcome);
        }
    };
    const finish = async () => {
        if (!current())
            return;
        await refresh();
        if (current()) {
            state.busy = false;
            update();
        }
    };
    const saveEditing = async () => {
        if (!available() || state.locked || !state.form || !state.original || !state.opened)
            return;
        state.busy = true;
        state.inlineError = '';
        state.inlineMessage = '';
        update();
        try {
            const patch = buildPartnerEditPatch(state.original, state.form);
            if (!Object.keys(patch).length) {
                state.form = null;
                state.original = null;
                state.opened = null;
                state.inlineMessage = '변경한 내용이 없습니다.';
                return;
            }
            if (!state.opened.expectedVersion)
                throw Error('최초 거래처 원문을 다시 확인해 주세요.');
            const token = state.token;
            const entry = await ports.prepare(scope, { version: 1, reference: state.opened.reference, expectedVersion: state.opened.expectedVersion, patch }, current, typeof state.original.name === 'string' ? state.original.name.slice(0, 500) : undefined);
            if (!current())
                return;
            state.pending = { entry, token };
            state.locked = true;
            consume(entry, await ports.command(scope, entry, 'apply', current));
        }
        catch (error) {
            if (current())
                state.inlineError = error instanceof Error ? error.message : String(error);
        }
        finally {
            await finish();
        }
    };
    const act = async (entry: PartnerEditEntry, mode: 'apply' | 'inspect' | 'cancel') => {
        if (!available())
            return;
        state.busy = true;
        update();
        try {
            consume(entry, await ports.command(scope, entry, mode, current));
        }
        catch (error) {
            if (current()) {
                state.recoveryError = String(error);
                state.errorKey = entry.key;
            }
        }
        finally {
            await finish();
        }
    };
    const discardCopy = async (entry: PartnerEditEntry) => {
        if (!available())
            return;
        state.busy = true;
        update();
        try {
            const result = await ports.discard(scope, entry, current);
            if (current()) {
                state.recoveryMessage = result.message;
                state.recoveryError = '';
                state.errorKey = null;
                if (result.status === 'cleared' && state.original?.id === entry.reference?.targetId) {
                    state.requiresReopen = true;
                    state.locked = true;
                }
            }
        }
        catch (error) {
            if (current()) {
                const message = error instanceof Error ? error.message : String(error);
                state.results.set(entry.key, { ...state.results.get(entry.key), terminal: false, outcome: { status: 'unknown', message, nextAction: '요청 정보가 바뀌었는지 다시 확인한 뒤 이 기기의 사본만 정리해 주세요.' } });
                state.recoveryError = message;
                state.errorKey = entry.key;
            }
        }
        finally {
            await finish();
        }
    };
    const loadPage = async (reset: boolean) => {
        if (!current() || state.historyLoading || (!reset && !state.cursor))
            return;
        state.historyLoading = true;
        state.historyError = '';
        const generation = ++state.historyGeneration;
        update();
        try {
            const page = await ports.history(scope, reset ? undefined : state.cursor!, current);
            if (!current() || generation !== state.historyGeneration)
                return;
            const rows = new Map((reset ? [] : state.history).map(row => [partnerEditKey(scope, row.result.reference), row]));
            page.entries.forEach(row => rows.set(partnerEditKey(scope, row.result.reference), row));
            state.history = [...rows.values()];
            state.cursor = page.nextCursor;
            state.recoveryMessage = `이번 조회 ${page.entries.length}건입니다. 목록이 없다고 미처리로 확정할 수는 없습니다.`;
        }
        catch (error) {
            if (current() && generation === state.historyGeneration)
                state.historyError = String(error);
        }
        finally {
            if (current() && generation === state.historyGeneration) {
                state.historyLoading = false;
                update();
            }
        }
    };
    const historyEntry = (result: PartnerEditResult): PartnerEditEntry => ({ key: partnerEditKey(scope, result.reference), reference: result.reference, request: null, requestHash: null, referenceHash: null, observedLocalText: null, observedReferenceText: null, status: 'missing', description: latest.current.partners.find(row => row.id === result.reference.targetId)?.name ? '거래처 수정 · ' + latest.current.partners.find(row => row.id === result.reference.targetId)!.name : '거래처 수정 요청' });
    const all = new Map(state.history.map(row => [partnerEditKey(scope, row.result.reference), historyEntry(row.result)]));
    state.operations.forEach(row => all.set(row.key, row));
    const resultFor = (entry: PartnerEditEntry) => state.results.get(entry.key) ?? (() => {
        const result = state.history.find(row => partnerEditKey(scope, row.result.reference) === entry.key)?.result;
        return result ? { result, terminal: false, outcome: { status: 'rejected' as const, message: result.message, nextAction: '현재 입력은 그대로입니다. 필요한 새 업무를 진행해 주세요.' } } : undefined;
    })();
    const canRetry = (entry: PartnerEditEntry) => entry.status === 'valid' && !!entry.request && (!resultFor(entry)?.result || resultFor(entry)?.result?.status === 'unknown');
    const canCancel = (entry: PartnerEditEntry) => !!entry.reference && (!resultFor(entry)?.result || resultFor(entry)?.result?.status === 'unknown');
    const canDiscard = (entry: PartnerEditEntry) => entry.observedLocalText !== null || entry.observedReferenceText !== null;
    const projection = (entry: PartnerEditEntry): PartnerRecoveryRow => {
        const observation = resultFor(entry), result = observation?.result, outcome = observation?.outcome;
        return { entry, currentState: result?.status === 'applied' ? '거래처 수정 완료' : result?.status === 'cancelled' ? '미처리 요청 중단 확인' : result?.status === 'rejected' ? '수정 요청 거절' : '처리 여부 확인 필요',
            cause: outcome && outcome.status !== 'saved' ? outcome.message : result?.message ?? (entry.status === 'valid' ? '이 기기에 처리 확인이 필요한 요청이 남아 있습니다.' : '보관한 요청 원문을 읽지 못했습니다.'),
            nextAction: outcome && 'nextAction' in outcome && outcome.nextAction ? outcome.nextAction : canDiscard(entry) ? '처리 결과를 확인한 뒤 이 기기에 남은 요청 정보만 정리해 주세요.' : '현재 입력은 그대로입니다. 필요한 새 업무를 진행해 주세요.' };
    };
    const rows = current() ? [...all.values()].map(projection) : [];
    const failureRows = rows.filter(row => canDiscard(row.entry) && !(state.busy && state.pending?.entry.key === row.entry.key));
    const canReopenCurrent = available() && !!state.original && state.requiresReopen && !state.operations.some(row => row.reference?.targetId === state.original?.id);
    const reopenCurrent = async () => {
        if (!canReopenCurrent)
            return;
        const partner = latest.current.partners.find(row => row.id === state.original?.id);
        if (partner)
            await openEditing(partner);
        else {
            state.inlineError = '현재 거래처가 없어 다시 열지 못했습니다.';
            update();
        }
    };
    const captureDeleteGuard = () => {
        const token = state.token, id = state.original?.id;
        return (deletedId: string) => {
            if (!current() || token !== state.token || id !== deletedId)
                return;
            state.form = null;
            state.original = null;
            state.opened = null;
            state.token++;
            update();
        };
    };
    const searchAddress = () => {
        if (!available() || state.locked || !state.form)
            return;
        const token = state.token, id = state.form.id;
        if (!window.daum?.Postcode) {
            state.inlineError = '주소 검색을 불러오지 못했습니다.';
            update();
            return;
        }
        new window.daum.Postcode({ oncomplete: data => {
                if (!current() || isBusy() || state.locked || state.token !== token || state.form?.id !== id)
                    return;
                state.form = { ...state.form, address: data.address };
                state.token++;
                update();
            } }).open();
    };
    const visible = current();
    return { editForm: visible ? state.form : null, openingPartner: visible ? state.original : null, setEditForm, openEditing, closeEditing, saveEditing, searchAddress,
        isSaving: visible && (state.busy || state.opening), busy: visible && (state.busy || state.opening), isBusy, locked: visible && state.locked,
        inlineError: visible ? state.inlineError : '', inlineMessage: visible ? state.inlineMessage : '', saveError: visible ? state.inlineError : '',
        recoveryError: visible && (!state.errorKey || !all.has(state.errorKey)) ? state.recoveryError : '', recoveryMessage: visible ? state.recoveryMessage : '',
        recoveryScopeKey: owner, isCurrentActor: current, failureRows, historyRows: rows, failureCount: failureRows.length, operations: visible ? state.operations : [],
        resultFor, canRetry, canCancel, canDiscard, inspect: (entry: PartnerEditEntry) => act(entry, 'inspect'), retry: (entry: PartnerEditEntry) => act(entry, 'apply'), cancel: (entry: PartnerEditEntry) => act(entry, 'cancel'), discardCopy,
        refresh, loadHistory: () => loadPage(true), nextHistory: () => loadPage(false), readLoading: visible && state.readLoading, readError: visible ? state.readError : '', historyLoading: visible && state.historyLoading, historyError: visible ? state.historyError : '', historyMore: visible && !!state.cursor,
        canReopenCurrent, reopenCurrent, captureDeleteGuard, onDeleted: (id: string) => captureDeleteGuard()(id) };
}
