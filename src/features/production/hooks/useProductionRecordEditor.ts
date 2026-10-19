import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../shared/firebase';
import type { Item, Order, ProductionRecord } from '../../../shared/types';
import { appConfirm } from '../../../shared/components/appDialog';
import { saveOutcomeMessage } from '../../../shared/saveOutcome';
import { productionRecordOpening, productionRecordBody, type ProductionRecordReference, type ProductionRecordRequest, type ProductionRecordResult, type ProductionRecordHistoryResult, type ProductionRecordSource, type ProductionRecordOpenResult } from '../../../shared/productionRecordCommand';
import { productionRecordWrites, productionRecordKey, type ProductionRecordBindings, type ProductionRecordEntry, type ProductionRecordObservation, type ProductionRecordScope } from '../../../shared/services/productionRecordWrites';
import { buildProductionRecord, planProductionRecordSync, type ProductionRecordForm } from '../application/productionRecordEditor';
export interface ProductionRecordEditorOptions {
    companyId?: string;
    actorUid?: string;
    currentUserName?: string;
    items: Item[];
    orders: Order[];
    records: ProductionRecord[];
    productionRecordBindings?: ProductionRecordBindings;
}
export interface ProductionRecordRecoveryRow {
    entry: ProductionRecordEntry;
    currentState: string;
    cause: string;
    nextAction: string;
}
const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const emptyForm = (): ProductionRecordForm => ({ date: today(), itemId: '', finishedQty: '', wipItemId: '', wipUsed: '', note: '' });
type Pending = {
    entry: ProductionRecordEntry;
    token: number;
    action: ProductionRecordRequest['action'];
};
function newState(owner: string) {
    return {
        owner, form: emptyForm(), showForm: false, editingDateId: null as string | null, editingDateVal: '',
        selectedDateRecord: null as ProductionRecord | null, selectedDateOpen: null as ProductionRecordOpenResult | null, busy: false, syncing: false, error: '', message: '', errorKind: null as 'inline' | 'recovery' | null, messageKind: null as 'inline' | 'recovery' | null, errorKey: null as string | null, token: 0,
        identity: null as null | {
            id: string;
            createdAt: string;
        }, pending: null as Pending | null,
        operations: [] as ProductionRecordEntry[], results: new Map<string, ProductionRecordObservation>(),
        history: [] as ProductionRecordHistoryResult['entries'], cursor: null as string | null,
        readLoading: true, readError: '', historyLoading: false, historyError: '', readGeneration: 0, historyGeneration: 0,
        confirmedIds: new Set<string>(),
    };
}
export function useProductionRecordEditor(options: ProductionRecordEditorOptions) {
    const [, repaint] = useState(0);
    const [liveUid, setLiveUid] = useState(() => auth.currentUser?.uid ?? '');
    useEffect(() => onAuthStateChanged(auth, user => setLiveUid(user?.uid ?? '')), []);
    const owner = JSON.stringify([options.companyId ?? '', options.actorUid ?? liveUid, liveUid]);
    const confirmedScopes = useRef(new Map<string, Set<string>>());
    const createState = () => {
        const next = newState(owner), key = JSON.stringify([options.companyId ?? '', options.actorUid ?? liveUid]);
        if (!confirmedScopes.current.has(key))
            confirmedScopes.current.set(key, new Set());
        next.confirmedIds = confirmedScopes.current.get(key)!;
        return next;
    };
    const stateRef = useRef(createState());
    if (stateRef.current.owner !== owner)
        stateRef.current = createState();
    const state = stateRef.current;
    const ports = options.productionRecordBindings ?? productionRecordWrites;
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const current = () => mounted.current && stateRef.current === state && ['taebaek', 'punghoe'].includes(options.companyId ?? '') &&
        !!liveUid && liveUid === auth.currentUser?.uid && (!options.actorUid || options.actorUid === liveUid);
    const scope: ProductionRecordScope = { companyId: options.companyId as ProductionRecordScope['companyId'], actorUid: liveUid };
    const update = () => {
        if (mounted.current && stateRef.current === state)
            repaint(value => value + 1);
    };
    const available = () => current() && !state.busy && !state.readLoading && !state.readError;
    const begin = () => {
        if (!available())
            return false;
        state.busy = true;
        state.error = '';
        state.message = '';
        state.errorKind = null;
        state.messageKind = null;
        state.errorKey = null;
        update();
        return true;
    };
    const refEqual = (a: ProductionRecordReference | null, b: ProductionRecordReference | null) => !!a && !!b && a.companyId === b.companyId && a.planId === b.planId && a.targetId === b.targetId;
    const refresh = async () => {
        if (!current())
            return;
        const generation = ++state.readGeneration;
        state.readLoading = true;
        state.readError = '';
        update();
        try {
            const entries = await ports.read(scope, current);
            if (!current() || generation !== state.readGeneration)
                return;
            state.operations = entries;
        }
        catch (error) {
            if (current() && generation === state.readGeneration)
                state.readError = String(error);
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
        const read = () => { void refresh(); };
        window.addEventListener('storage', read);
        window.addEventListener('production-record-requests', read);
        return () => { state.readGeneration++; state.historyGeneration++; window.removeEventListener('storage', read); window.removeEventListener('production-record-requests', read); };
    }, [owner]);
    const setInlineError = (message: string) => { state.error = message; state.errorKind = 'inline'; state.errorKey = null; };
    const setRecoveryError = (message: string, key: string | null = null) => { state.error = message; state.errorKind = 'recovery'; state.errorKey = key; };
    const pendingNotice = () => {
        const creates = state.operations.filter(entry => entry.request?.action === 'create').length;
        const syncs = state.operations.filter(entry => entry.request?.action === 'sync').length;
        return [creates ? '이전 수동 생산기록 ' + creates + '건의 처리 결과는 아직 확인하지 못했습니다.' : '', syncs ? '이전 동기화 ' + syncs + '건의 처리 결과는 아직 확인하지 못했습니다.' : ''].filter(Boolean).join(' ') + (creates || syncs ? ' 보관 요청의 실제 결과를 확인해 주세요. 같은 원문을 자동으로 다시 보내지 않았습니다.' : '');
    };
    const pendingFor = (targetId: string, action: 'date' | 'delete') => state.operations.find(entry => entry.reference?.targetId === targetId && (!entry.request || entry.request.action === action));
    const finish = async () => {
        if (!current())
            return;
        await refresh();
        if (current()) {
            state.busy = false;
            state.syncing = false;
            if (!state.error)
                setRecoveryError(pendingNotice());
            update();
        }
    };
    const consume = (entry: ProductionRecordEntry, observation: ProductionRecordObservation) => {
        if (!current())
            return;
        state.results.set(entry.key, observation);
        state.message = observation.outcome.status === 'saved' ? '이 요청의 처리를 확인했습니다.' : '';
        state.messageKind = 'recovery';
        setRecoveryError(saveOutcomeMessage(observation.outcome), entry.key);
        const pending = state.pending;
        if (!pending || !refEqual(pending.entry.reference, entry.reference) || pending.token !== state.token || pending.entry.observedLocalText !== entry.observedLocalText || pending.entry.observedReferenceText !== entry.observedReferenceText)
            return;
        if (!observation.terminal)
            return;
        state.pending = null;
        if (observation.outcome.status === 'rejected' || observation.outcome.status === 'cancelled')
            setInlineError(saveOutcomeMessage(observation.outcome));
        if (pending.action === 'date' && observation.outcome.status !== 'saved')
            state.selectedDateOpen = null;
        if (observation.outcome.status === 'saved') {
            state.messageKind = 'inline';
            if (pending.action === 'create') {
                state.showForm = false;
                state.form = emptyForm();
                state.identity = null;
            }
            if (pending.action === 'date') {
                state.editingDateId = null;
                state.selectedDateRecord = null;
            }
        }
    };
    const requestRecord = async (action: ProductionRecordRequest['action'], record: ProductionRecord, date?: string, source?: ProductionRecordSource, captured?: ProductionRecordOpenResult) => {
        const reference: ProductionRecordReference = captured?.reference ?? { companyId: scope.companyId, planId: crypto.randomUUID(), targetId: record.id };
        const opening = action === 'create' || action === 'sync' ? null : productionRecordOpening(record);
        const opened = captured ?? await ports.open(scope, reference, opening, source, current);
        if (!current())
            return null;
        const common = { version: 1 as const, reference, expectedVersion: opened.expectedVersion };
        let request: ProductionRecordRequest;
        if (action === 'create')
            request = { ...common, action, record: productionRecordBody(record) };
        else if (action === 'sync') {
            if (!source || !opened.source || opened.source.orderId !== source.orderId || JSON.stringify(opened.source.evidence) !== JSON.stringify(source.evidence))
                throw Error('최초 주문 근거와 확인한 원문이 달라 전송하지 않았습니다.');
            request = { ...common, action, record: productionRecordBody(record), source: opened.source };
        }
        else if (action === 'date')
            request = { ...common, action, date: date! };
        else
            request = { ...common, action: 'delete' };
        const entry = await ports.prepare(scope, request, current);
        if (!current())
            return null;
        state.pending = { entry, token: state.token, action };
        update();
        const observation = await ports.command(scope, entry, 'apply', current);
        if (observation.result?.status === 'applied')
            state.confirmedIds.add(record.id);
        consume(entry, observation);
        return { entry, observation };
    };
    const openCreate = () => {
        if (!available())
            return;
        state.token++;
        state.form = emptyForm();
        state.identity = { id: `pr-${crypto.randomUUID()}`, createdAt: new Date().toISOString() };
        state.pending = null;
        state.showForm = true;
        state.error = pendingNotice();
        state.message = '';
        update();
    };
    const closeForm = () => {
        if (!available())
            return;
        state.showForm = false;
        state.token++;
        update();
    };
    const locked = () => !!state.pending && state.pending.token === state.token && state.pending.action === 'create';
    const setField = (field: keyof ProductionRecordForm, value: string) => {
        if (!available() || locked())
            return;
        state.form = { ...state.form, [field]: value };
        state.token++;
        update();
    };
    const submit = async () => {
        if (!available() || locked())
            return;
        if (!state.form.itemId || !state.form.finishedQty) {
            setInlineError('품목과 생산수량을 입력해주세요.');
            update();
            return;
        }
        if (!begin())
            return;
        state.identity ??= { id: `pr-${crypto.randomUUID()}`, createdAt: new Date().toISOString() };
        try {
            const record = buildProductionRecord(state.form, options.items, { ...state.identity, currentUserName: options.currentUserName });
            await requestRecord('create', record);
        }
        catch (error) {
            if (current())
                setInlineError(`생산기록 요청을 시작하지 못했습니다. ${String(error)}`);
        }
        finally {
            await finish();
        }
    };
    const openDate = async (record: ProductionRecord) => {
        if (!begin())
            return;
        const previous = pendingFor(record.id, 'date');
        if (previous) {
            state.token++;
            state.editingDateId = record.id;
            state.editingDateVal = previous.request?.action === 'date' ? previous.request.date : record.date;
            state.selectedDateRecord = structuredClone(record);
            state.pending = { entry: previous, token: state.token, action: 'date' };
            setRecoveryError('이 기록의 이전 날짜 변경 결과를 확인하지 못했습니다. 보관 요청의 결과를 먼저 확인해 주세요.');
            await finish();
            return;
        }
        const original = structuredClone(record), reference: ProductionRecordReference = { companyId: scope.companyId, planId: crypto.randomUUID(), targetId: record.id };
        try {
            const opened = await ports.open(scope, reference, productionRecordOpening(original), undefined, current);
            if (!current())
                return;
            state.token++;
            state.editingDateId = original.id;
            state.editingDateVal = original.date;
            state.selectedDateRecord = original;
            state.selectedDateOpen = opened;
            state.pending = null;
        }
        catch (error) {
            if (current())
                setInlineError('생산일 편집을 열지 못했습니다. ' + String(error));
        }
        finally {
            await finish();
        }
    };
    const changeDate = (value: string) => {
        if (!available() || state.pending?.action === 'date')
            return;
        state.editingDateVal = value;
        state.token++;
        update();
    };
    const cancelDate = () => {
        if (!available())
            return;
        state.editingDateId = null;
        state.token++;
        update();
    };
    const saveDate = async () => {
        if (!state.selectedDateRecord || !state.selectedDateOpen || !state.editingDateVal || state.pending?.action === 'date' || !begin())
            return;
        try {
            await requestRecord('date', state.selectedDateRecord, state.editingDateVal, undefined, state.selectedDateOpen ?? undefined);
        }
        catch (error) {
            if (current())
                setInlineError(`생산일 변경을 시작하지 못했습니다. ${String(error)}`);
        }
        finally {
            await finish();
        }
    };
    const removeRecord = async (record: ProductionRecord) => {
        if (pendingFor(record.id, 'delete') || !begin())
            return;
        const original = structuredClone(record);
        try {
            const reference: ProductionRecordReference = { companyId: scope.companyId, planId: crypto.randomUUID(), targetId: original.id };
            const opened = await ports.open(scope, reference, productionRecordOpening(original), undefined, current);
            if (!current() || !await appConfirm('이 생산기록을 삭제하시겠습니까?') || !current())
                return;
            await requestRecord('delete', original, undefined, undefined, opened);
        }
        catch (error) {
            if (current())
                setInlineError(`삭제 요청을 시작하지 못했습니다. ${String(error)}`);
        }
        finally {
            await finish();
        }
    };
    const syncFromOrders = async () => {
        if (!begin())
            return;
        state.syncing = true;
        update();
        let confirmed = 0;
        try {
            const excludedIds = new Set([...state.confirmedIds, ...state.operations.flatMap(entry => entry.reference ? [entry.reference.targetId] : [])]);
            const plan = planProductionRecordSync({ orders: options.orders, items: options.items, records: options.records, excludedIds });
            for (const record of plan.records) {
                if (!current())
                    break;
                const source = plan.sources?.[record.id];
                if (!source)
                    throw Error('최초 주문의 생산 근거가 없습니다. 새로 선택해 주세요.');
                const result = await requestRecord('sync', record, undefined, source);
                if (!result || !current())
                    break;
                if (result.observation.outcome.status !== 'saved' || !result.observation.terminal) {
                    setRecoveryError(`${confirmed}건은 완료를 확인했습니다. ${saveOutcomeMessage(result.observation.outcome)} 나머지 기록은 보내지 않았습니다.`, result.entry.key);
                    state.message = `${confirmed}건은 완료를 확인했고 나머지 기록은 보내지 않았습니다.`;
                    state.messageKind = 'recovery';
                    break;
                }
                confirmed++;
            }
            if (current() && !state.error) {
                state.message = !plan.deliveredOrderCount ? '이력에 완료된 주문이 없습니다.' : confirmed ? `${confirmed}건 동기화 완료` : '동기화할 새 기록이 없습니다.';
                state.messageKind = 'inline';
            }
        }
        catch (error) {
            if (current())
                setInlineError(`${confirmed}건은 완료를 확인했습니다. ${String(error)} 나머지는 보내지 않았습니다.`);
        }
        finally {
            await finish();
        }
    };
    const recover = async (entry: ProductionRecordEntry, mode: 'apply' | 'inspect' | 'cancel') => {
        if (!begin())
            return;
        try {
            const observation = await ports.command(scope, entry, mode, current);
            consume(entry, observation);
            if (current() && observation.terminal && observation.result) {
                state.message = observation.result.message;
                state.messageKind = 'recovery';
            }
        }
        finally {
            await finish();
        }
    };
    const discardCopy = async (entry: ProductionRecordEntry) => {
        if (!begin())
            return;
        try {
            const result = await ports.discard(scope, entry, current);
            if (!current())
                return;
            state.message = result.status === 'cleared' ? result.message : '';
            state.messageKind = 'recovery';
            setRecoveryError(result.status === 'blocked' ? result.message : '');
            // 사본 정리는 업무 ACK가 아니다. 현재 작성이나 날짜 입력을 자동으로 닫지 않는다.
            if (result.status === 'cleared' && refEqual(state.pending?.entry.reference ?? null, entry.reference)) {
                if (state.pending?.action === 'date')
                    state.selectedDateOpen = null;
                state.pending = null;
            }
        }
        finally {
            await finish();
        }
    };
    const history = async (reset: boolean) => {
        if (!current() || state.busy || state.historyLoading || !reset && !state.cursor)
            return;
        const generation = ++state.historyGeneration, cursor = reset ? undefined : state.cursor!;
        state.historyLoading = true;
        state.historyError = '';
        update();
        try {
            const result = await ports.history(scope, cursor, current);
            if (!current() || generation !== state.historyGeneration)
                return;
            state.history = reset ? result.entries : [...state.history, ...result.entries];
            state.cursor = result.nextCursor;
            state.message = `이번 조회 ${result.entries.length}건입니다. 목록이 없더라도 미처리가 확정되는 것은 아닙니다.${result.nextCursor ? ' 다음 목록을 확인해 주세요.' : ''}`;
            state.messageKind = 'recovery';
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
    const resultFor = (entry: ProductionRecordEntry): ProductionRecordObservation | undefined => {
        const observed = state.results.get(entry.key);
        if (observed)
            return observed;
        const result = state.history.find(item => refEqual(item.result.reference, entry.reference))?.result;
        return result ? { result, terminal: false, copyMismatch: true, outcome: { status: 'rejected', message: result.message, nextAction: '과거 요청의 처리 기록입니다. 현재 문서와 입력을 별도로 확인해 주세요.' } } : undefined;
    };
    const canRetry = (entry: ProductionRecordEntry) => entry.status === 'valid' && !!entry.request && !resultFor(entry)?.copyMismatch && (!resultFor(entry)?.result || resultFor(entry)?.result?.status === 'unknown');
    const canCancel = (entry: ProductionRecordEntry) => !!entry.reference && (!resultFor(entry)?.result || resultFor(entry)?.result?.status === 'unknown');
    const canDiscard = (entry: ProductionRecordEntry) => entry.observedLocalText !== null || entry.observedReferenceText !== null;
    const all = new Map(state.operations.map(entry => [entry.key, entry]));
    for (const item of state.history) {
        const key = productionRecordKey(scope, item.result.reference);
        if (!all.has(key))
            all.set(key, { key, reference: item.result.reference, request: null, requestHash: null, referenceHash: null, observedLocalText: null, observedReferenceText: null, status: 'missing', description: `${({ create: '생산 등록', sync: '주문 생산 동기화', date: '생산일 변경', delete: '생산기록 삭제', cancel: '미처리 요청 중단' })[item.action]} · ${item.result.reference.targetId}` });
    }
    const project = (entry: ProductionRecordEntry): ProductionRecordRecoveryRow => {
        const result = resultFor(entry)?.result ?? state.history.find(item => refEqual(item.result.reference, entry.reference))?.result;
        const outcome = resultFor(entry)?.outcome;
        const action = entry.request?.action ?? state.history.find(item => refEqual(item.result.reference, entry.reference))?.action;
        return { entry,
            currentState: result?.status === 'applied' ? `${action === 'date' ? '생산일 변경' : action === 'delete' ? '생산기록 삭제' : action === 'sync' ? '주문 생산 동기화' : '생산 등록'} 요청의 처리를 완료했습니다.` : result?.status === 'rejected' ? '요청을 반영하지 않았습니다.' : result?.status === 'cancelled' ? '미처리 요청을 중단했습니다.' : '처리 결과를 확인해야 합니다.',
            cause: outcome && outcome.status !== 'saved' ? outcome.message : result?.message ?? '이 기기에 보관된 요청입니다.',
            nextAction: outcome && outcome.status !== 'saved' && outcome.nextAction ? outcome.nextAction : entry.observedLocalText === null && entry.observedReferenceText === null ? '확인된 과거 처리와 현재 입력을 구분해 새 업무를 진행해 주세요.' : resultFor(entry)?.terminal ? '현재 자료를 다시 확인한 뒤 새 업무를 진행해 주세요.' : '결과를 확인하고 미처리 요청 중단 또는 기기 사본 정리를 진행해 주세요.' };
    };
    const visible = current(), historyRows = visible ? [...all.values()].map(project) : [];
    const failureRows = historyRows.filter(row => canDiscard(row.entry) && !(state.busy && state.pending && refEqual(state.pending.entry.reference, row.entry.reference) && !resultFor(row.entry)));
    return { form: visible ? state.form : emptyForm(), setField, showForm: visible && state.showForm, openCreate, closeForm, submit,
        inlineError: visible && state.errorKind === 'inline' ? state.error : '',
        inlineMessage: visible && state.messageKind === 'inline' ? state.message : '',
        recoveryError: visible && state.errorKind === 'recovery' && !all.has(state.errorKey ?? '') ? state.error : '',
        recoveryMessage: visible && state.messageKind === 'recovery' ? state.message : '',
        unconfirmedRecords: visible ? state.operations.flatMap(entry => entry.request?.action === 'create' ? [{ ...entry.request.record, id: entry.reference!.targetId }] : []) : [], busy: visible && state.busy, locked: visible && locked(), error: visible ? state.error : '', message: visible ? state.message : '',
        editingDateId: visible ? state.editingDateId : null, editingDateVal: visible ? state.editingDateVal : '', openDate, changeDate, saveDate, cancelDate,
        canSaveDate: available() && !!state.editingDateId && !!state.selectedDateOpen && state.pending?.action !== 'date', canRemoveRecord: (record: ProductionRecord) => available() && !pendingFor(record.id, 'delete'),
        removeRecord, syncing: visible && state.syncing, syncFromOrders, ready: available(),
        recoveryScopeKey: owner, isCurrentActor: current, operations: visible ? state.operations : [], failureRows, historyRows, failureCount: failureRows.length,
        readLoading: visible && state.readLoading, readError: visible ? state.readError : '', refresh,
        historyLoading: visible && state.historyLoading, historyError: visible ? state.historyError : '', historyMore: visible && !!state.cursor,
        loadHistory: () => history(true), nextHistory: () => history(false), resultFor, canRetry, canCancel, canDiscard,
        inspect: (entry: ProductionRecordEntry) => recover(entry, 'inspect'), retry: (entry: ProductionRecordEntry) => recover(entry, 'apply'), cancel: (entry: ProductionRecordEntry) => recover(entry, 'cancel'), discardCopy };
}
