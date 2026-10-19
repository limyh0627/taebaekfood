import { useEffect, useReducer, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, authReady } from '../../../shared/firebase';
import { today } from '../../../shared/day';
import { nextOrderNo } from '../../../shared/cardNo';
import { ensureOrderLineIds } from '../../../shared/orderLineInventory';
import type { Order } from '../../../shared/types';
import { validateOrderInterpretation, type OrderInterpretationRequest, type OrderInterpretationScope, type OrderInterpretationJsonObject, type OrderExpressionConfirmation } from '../../../shared/orderInterpretation';
import type { OrderCopyRecoveryResult } from '../../../shared/orderCopyRecovery';
import { orderCopyRecoveryServices, orderCopyRecoveryKey, type OrderCopyRecoveryEntry, type OrderCopyRecoveryObservation } from '../../../shared/services/orderCopyService';
import { saveOutcomeMessage } from '../../../shared/saveOutcome';
export interface OrderCopyEvidence {
    sourceText: string;
    firstAnalysis: OrderInterpretationJsonObject;
    inputLines: OrderInterpretationJsonObject[];
    expressionConfirmations?: OrderExpressionConfirmation[];
}
export interface OrderCopyRecoveryOptions {
    companyId: OrderInterpretationScope['companyId'];
    orders: Pick<Order, 'cardNo'>[];
    onCommitted?: (orderId: string, currentDraft: boolean) => void;
}
export interface OrderCopyRecoveryRow {
    entry: OrderCopyRecoveryEntry;
    currentState: string;
    cause: string;
    nextAction: string;
    result?: OrderCopyRecoveryResult;
}
function sameInput(request: OrderInterpretationRequest, draft: Omit<Order, 'id' | 'status'>, evidence: OrderCopyEvidence, messageId: string | null) {
    const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
    const stored = {
        ...request.confirmed.orderDraft
    }, candidate = {
        ...draft
    } as Record<string, unknown>;
    if ((stored.sourceChatMessageId ?? null) !== (messageId ?? candidate.sourceChatMessageId ?? null))
        return false;
    for (const key of ['id', 'cardNo', 'sourceChatMessageId']) {
        delete stored[key];
        delete candidate[key];
    }
    if (Array.isArray(stored.items)) {
        stored.items = stored.items.map((item, index) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
            const row = { ...item };
            if (!Object.hasOwn(draft.items[index] ?? {}, 'lineId')) delete row.lineId;
            return row;
        });
    }
    return request.sourceText === evidence.sourceText && stable(request.firstAnalysis) === stable(evidence.firstAnalysis) && stable(request.confirmed.inputLines) === stable(evidence.inputLines) && stable(request.confirmed.expressionConfirmations ?? []) === stable(evidence.expressionConfirmations ?? []) && stable(stored) === stable(candidate);
}
export function useOrderCopyRecovery(options: OrderCopyRecoveryOptions, services = orderCopyRecoveryServices) {
    const [, render] = useReducer((n: number) => n + 1, 0), [actorUid, setActorUid] = useState(auth.currentUser?.uid ?? '');
    const latest = useRef(options);
    latest.current = options;
    const ports = useRef(services);
    ports.current = services;
    const mounted = useRef(true);
    const make = () => ({
        companyId: options.companyId, actorUid, draftOpen: false, draftVersion: 0, initialText: '', sourceText: '', sourceChatMessageId: null as string | null, draftToken: {}, draftSignature: null as string | null, prepared: null as null | {
            body: string;
            request: OrderInterpretationRequest;
            token: object;
        }, task: null as object | null, operations: [] as OrderCopyRecoveryEntry[], selectedEntry: null as OrderCopyRecoveryEntry | null, results: new Map<string, OrderCopyRecoveryObservation>(), error: '', notice: '', readLoading: true, readError: '', readGeneration: 0, history: [] as OrderCopyRecoveryResult[], historyMore: null as string | null, historyLoading: false, historyError: '', historyGeneration: 0
    });
    const owner = useRef<ReturnType<typeof make> | null>(null);
    if (!owner.current || owner.current.companyId !== options.companyId || owner.current.actorUid !== actorUid)
        owner.current = make();
    const state = owner.current;
    const current = () => mounted.current && owner.current === state && !!state.actorUid && auth.currentUser?.uid === state.actorUid;
    const repaint = () => {
        if (mounted.current)
            render();
    };
    const scope = (): OrderInterpretationScope => ({
        companyId: state.companyId, actorUid: state.actorUid
    });
    const identity = (entry: OrderCopyRecoveryEntry) => entry.reference?.requestId ?? entry.key;
    const resultFor = (entry: OrderCopyRecoveryEntry) => state.results.get(identity(entry));
    const observedResult = (entry: OrderCopyRecoveryEntry) => resultFor(entry)?.result ?? state.history.find(result => result.reference.requestId === entry.reference?.requestId);
    const refresh = async () => {
        if (!current())
            return;
        const turn = ++state.readGeneration;
        state.readLoading = true;
        repaint();
        try {
            const rows = await ports.current.read(scope(), () => current() && turn === state.readGeneration);
            if (current() && turn === state.readGeneration) {
                state.operations = rows;
                state.readError = '';
                if (state.selectedEntry) {
                    const match = rows.find(row => row.key === state.selectedEntry!.key);
                    if (match)
                        state.selectedEntry = match;
                }
            }
        }
        catch (error) {
            if (current() && turn === state.readGeneration)
                state.readError = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (current() && turn === state.readGeneration) {
                state.readLoading = false;
                repaint();
            }
        }
    };
    useEffect(() => {
        mounted.current = true;
        let live = true;
        const stop = onAuthStateChanged(auth, user => {
            if (live)
                setActorUid(user?.uid ?? '');
        });
        return () => { live = false; mounted.current = false; stop(); };
    }, []);
    useEffect(() => {
        let live = true;
        void Promise.resolve(authReady).then(() => {
            if (live && current())
                void refresh();
        });
        const changed = () => {
            if (current())
                void refresh();
        };
        window.addEventListener('storage', changed);
        return () => { live = false; state.readGeneration++; state.historyGeneration++; window.removeEventListener('storage', changed); };
    }, [state]);
    const openDraft = (text = '', sourceChatMessageId: string | null = null) => {
        if (!current() || state.task)
            return false;
        state.draftOpen = true;
        state.draftVersion++;
        state.draftToken = {};
        state.draftSignature = null;
        state.prepared = null;
        state.initialText = text;
        state.sourceText = text;
        state.sourceChatMessageId = sourceChatMessageId;
        state.selectedEntry = null;
        state.error = '';
        repaint();
        return true;
    };
    const closeDraft = () => {
        if (!current() || state.task)
            return false;
        state.draftOpen = false;
        state.draftToken = {};
        state.prepared = null;
        repaint();
        return true;
    };
    const updateSourceText = (text: string) => {
        if (!current()||state.sourceText===text)
            return;
        state.sourceText = text;
        state.draftToken = {};
        repaint();
    };
    const updateDraftSignature = (signature: string) => {
        if (!current())
            return;
        if ((state.draftSignature !== null || state.prepared !== null) && state.draftSignature !== signature)
            state.draftToken = {};
        state.draftSignature = signature;
    };
    const begin = () => {
        if (!current() || state.task)
            return null;
        const task = {};
        state.task = task;
        state.error = '';
        repaint();
        return task;
    };
    const consume = (entry: OrderCopyRecoveryEntry, observation: OrderCopyRecoveryObservation, explicitToken?: object) => {
        if (!current())
            return;
        state.results.set(identity(entry), observation);
        state.notice = saveOutcomeMessage(observation.outcome) || observation.result?.message || '주문 처리를 확인했습니다.';
        const first = state.prepared, own = !!first && first.request.requestId === entry.reference?.requestId && (first.token === state.draftToken || explicitToken === state.draftToken) && first.request.sourceText === state.sourceText;
        if (observation.result?.status === 'applied' && observation.result.orderId) {
            const committed = own && observation.terminal && observation.outcome.status === 'saved';
            latest.current.onCommitted?.(observation.result.orderId, committed);
            if (committed) {
                state.prepared = null;
                state.draftOpen = false;
                state.initialText = '';
                state.sourceText = '';
                state.sourceChatMessageId = null;
                state.draftToken = {};
                state.selectedEntry = null;
            }
        }
        if (observation.terminal && observation.outcome.status === 'rejected') {
            state.selectedEntry = entry;
            state.error = state.notice;
            if (own)
                state.prepared = null;
        }
        if (observation.terminal && observation.outcome.status === 'cancelled' && own) {
            state.prepared = null;
            state.selectedEntry = null;
        }
    };
    const save = async (draft: Omit<Order, 'id' | 'status'>, evidence?: OrderCopyEvidence) => {
        if (!current() || state.task || state.readLoading || state.readError) {
            if (current()) {
                state.error = state.readError || '이전 보관 요청을 확인한 뒤 주문을 저장해 주세요.';
                repaint();
            }
            return;
        }
        if (!evidence) {
            state.error = '최초 주문 원문을 확인해 주세요.';
            repaint();
            return;
        }
        const body = JSON.stringify({
            draft, evidence, sourceChatMessageId: state.sourceChatMessageId
        });
        if (state.prepared && state.prepared.token !== state.draftToken && state.prepared.body === body) {
            const previous = state.prepared, task = begin();
            if (!task)
                return;
            const clickToken = state.draftToken, active = () => current() && state.task === task;
            try {
                const observation = await ports.current.reconnect(previous.request, active);
                if (!active() || state.draftToken !== clickToken)
                    return;
                const entry: OrderCopyRecoveryEntry = {
                    key: orderCopyRecoveryKey(scope(), previous.request.requestId), bodyText: null, referenceText: null, reference: {
                        companyId: state.companyId, requestId: previous.request.requestId
                    }, request: previous.request, requestHash: observation.result?.requestHash ?? null, referenceHash: null, orderId: String(previous.request.confirmed.orderDraft.id), status: 'missing', description: '명시적으로 다시 확인한 이번 주문'
                };
                consume(entry, observation, clickToken);
            }
            catch (error) {
                if (active())
                    state.error = error instanceof Error ? error.message : String(error);
            }
            finally {
                if (active()) {
                    state.task = null;
                    await refresh();
                    repaint();
                }
            }
            return;
        }
        const unresolved = state.operations.find(entry => entry.request && sameInput(entry.request, draft, evidence, state.sourceChatMessageId));
        if (unresolved && (!state.prepared || state.prepared.body !== body || state.prepared.request.requestId !== unresolved.reference?.requestId)) {
            state.selectedEntry = unresolved;
            state.error = '같은 내용으로 저장하던 주문이 있습니다. 결과 확인 또는 미처리 요청 중단을 먼저 선택해 주세요.';
            repaint();
            return;
        }
        let first = state.prepared;
        if (!first || first.body !== body) {
            const requestId = crypto.randomUUID();
            const request = validateOrderInterpretation({
                version: 1, requestId, companyId: state.companyId, actorUid: state.actorUid, createdAt: new Date().toISOString(), sourceText: evidence.sourceText, firstAnalysis: evidence.firstAnalysis, confirmed: {
                    inputLines: evidence.inputLines, ...(evidence.expressionConfirmations?.length ? {
                        expressionConfirmations: evidence.expressionConfirmations
                    } : {}), orderDraft: {
                        ...draft, id: `ORD-COPY-${requestId}`, cardNo: nextOrderNo(today(), latest.current.orders), items: ensureOrderLineIds(draft.items), ...(state.sourceChatMessageId ? {
                            sourceChatMessageId: state.sourceChatMessageId
                        } : {})
                    }
                }
            }, scope());
            first = {
                body, request, token: state.draftToken
            };
            state.prepared = first;
        }
        const task = begin();
        if (!task)
            return;
        const active = () => current() && state.task === task;
        try {
            const observation = await ports.current.send(first.request, active);
            if (!active())
                return;
            const rows = await ports.current.read(scope(), active);
            if (!active())
                return;
            const entry = rows.find(row => row.reference?.requestId === first!.request.requestId) ?? {
                key: orderCopyRecoveryKey(scope(), first.request.requestId), bodyText: null, referenceText: null, reference: {
                    companyId: state.companyId, requestId: first.request.requestId
                }, request: first.request, requestHash: observation.result?.requestHash ?? null, referenceHash: null, orderId: String(first.request.confirmed.orderDraft.id), status: 'missing' as const, description: '이번 주문'
            };
            state.operations = rows;
            state.selectedEntry = entry;
            consume(entry, observation);
        }
        catch (error) {
            if (active())
                state.error = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (active()) {
                state.task = null;
                await refresh();
                repaint();
            }
        }
    };
    const perform = async (entry: OrderCopyRecoveryEntry, action: 'inspect' | 'retry' | 'stop' | 'discard') => {
        const task = begin();
        if (!task)
            return;
        const active = () => current() && state.task === task;
        try {
            if (action === 'discard') {
                const result = await ports.current.discard(scope(), entry, active);
                if (active()) {
                    state.notice = result.message;
                    if (result.status === 'cleared' && state.selectedEntry?.key === entry.key)
                        state.selectedEntry = null;
                }
            }
            else {
                const result = action === 'retry' ? await ports.current.retry(scope(), entry, active) : await ports.current.resolve(scope(), entry, action, active);
                if (active())
                    consume(entry, result);
            }
        }
        catch (error) {
            if (active())
                state.error = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (active()) {
                state.task = null;
                await refresh();
                repaint();
            }
        }
    };
    const load = async (reset: boolean) => {
        if (!current() || state.historyLoading || !reset && !state.historyMore)
            return;
        const turn = ++state.historyGeneration;
        state.historyLoading = true;
        repaint();
        try {
            const result = await ports.current.list(scope(), reset ? undefined : state.historyMore!, () => current() && turn === state.historyGeneration);
            if (current() && turn === state.historyGeneration) {
                state.history = reset ? result.entries : [...state.history, ...result.entries];
                state.historyMore = result.nextCursor;
                state.historyError = '';
                state.notice = `이번 조회 ${result.entries.length}건입니다. ${result.nextCursor ? '더 확인할 기록이 있으니 다음 목록을 확인해 주세요.' : '목록에 없다는 이유로 미처리를 확정하지 않습니다.'}`;
            }
        }
        catch (error) {
            if (current() && turn === state.historyGeneration)
                state.historyError = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (current() && turn === state.historyGeneration) {
                state.historyLoading = false;
                repaint();
            }
        }
    };
    const historyEntry = (result: OrderCopyRecoveryResult): OrderCopyRecoveryEntry => ({
        key: `order-copy-v1:${state.companyId}:${encodeURIComponent(state.actorUid)}:${encodeURIComponent(result.reference.requestId)}`, bodyText: null, referenceText: null, reference: result.reference, request: null, requestHash: null, referenceHash: null, orderId: result.orderId ?? null, status: 'missing', description: result.partnerName ?? result.orderId ?? result.reference.requestId
    });
    const projection = (entry: OrderCopyRecoveryEntry): OrderCopyRecoveryRow => {
        const observed = resultFor(entry), result = observedResult(entry);
        return {
            entry, result, currentState: observed?.outcome.status === 'partial' ? '기기 사본 정리 필요' : observed?.copyMismatch ? '보관 내용 확인 필요' : result?.status === 'applied' ? '주문 저장 완료' : result?.status === 'rejected' ? '주문 저장 거절' : result?.status === 'stopped' ? '미처리 요청 중단 완료' : '주문 처리 여부 확인 필요', cause: observed ? saveOutcomeMessage(observed.outcome) || result?.message || '처리를 확인했습니다.' : result?.message ?? (entry.request ? '이전에 저장을 요청한 주문의 결과를 아직 확인하지 못했습니다.' : '보관된 원문을 확인하지 못했습니다.'), nextAction: entry.bodyText === null && entry.referenceText === null ? '확인한 주문 내용을 바탕으로 필요한 새 업무를 진행해 주세요.' : '결과 확인 또는 미처리 요청 중단 후 관측한 기기 사본만 정리해 주세요.'
        };
    };
    const visible = current(), local = visible ? state.operations : [], historyRows = visible ? state.history.filter(result => !local.some(entry => entry.reference?.requestId === result.reference.requestId)).map(result => projection(historyEntry(result))) : [];
    if (visible && state.selectedEntry && resultFor(state.selectedEntry)?.terminal && resultFor(state.selectedEntry)?.result?.status === 'rejected' && !local.some(entry => identity(entry) === identity(state.selectedEntry!)) && !historyRows.some(row => identity(row.entry) === identity(state.selectedEntry!)))
        historyRows.push(projection(state.selectedEntry));
    const failureRows = [...local.map(projection), ...historyRows.filter(row => row.result?.status === 'unknown')];
    const normalHistoryRows = historyRows.filter(row => row.result?.status !== 'unknown');
    const canRewrite = (entry: OrderCopyRecoveryEntry) => !!entry.request && !!resultFor(entry)?.terminal && resultFor(entry)?.result?.status === 'rejected' && !resultFor(entry)?.copyMismatch;
    return {
        actorUid, current, isCurrentActor: current, draftOpen: visible && state.draftOpen, draftVersion: state.draftVersion, initialText: visible ? state.initialText : '', sourceText: visible ? state.sourceText : '', sourceChatMessageId: visible ? state.sourceChatMessageId : null, busy: visible && !!state.task, error: visible ? state.error : '', notice: visible ? state.notice : '', readLoading: !visible || state.readLoading, readError: visible ? state.readError : '', selectedEntry: visible ? state.selectedEntry : null, operations: local, failureRows, historyRows: normalHistoryRows, failureCount: failureRows.length, resultFor,
        openDraft, closeDraft, updateSourceText, updateDraftSignature, save, select: (entry: OrderCopyRecoveryEntry) => {
            if (current() && !state.task) {
                state.selectedEntry = entry;
                repaint();
            }
        }, inspect: (entry: OrderCopyRecoveryEntry) => perform(entry, 'inspect'), retry: (entry: OrderCopyRecoveryEntry) => perform(entry, 'retry'), stop: (entry: OrderCopyRecoveryEntry) => perform(entry, 'stop'), discardCopy: (entry: OrderCopyRecoveryEntry) => perform(entry, 'discard'), canRetry: (entry: OrderCopyRecoveryEntry) => !!entry.request && !!entry.requestHash && ['valid', 'legacy'].includes(entry.status) && !resultFor(entry)?.copyMismatch && !resultFor(entry)?.terminal, canStop: (entry: OrderCopyRecoveryEntry) => !!entry.reference && (!observedResult(entry) || observedResult(entry)?.status === 'unknown'), canDiscard: (entry: OrderCopyRecoveryEntry) => entry.bodyText !== null || entry.referenceText !== null, canRewrite, saveBlocked: !visible || state.readLoading || !!state.readError || !!state.task || (!!state.selectedEntry && canRewrite(state.selectedEntry) && state.selectedEntry.request?.sourceText === state.sourceText),
        rewrite: (entry: OrderCopyRecoveryEntry) => {
            if (!current() || state.task || !canRewrite(entry))
                return false;
            const source = entry.request!.confirmed.orderDraft.sourceChatMessageId;
            return openDraft(entry.request!.sourceText, typeof source === 'string' ? source : null);
        }, refresh, loadHistory: () => load(true), nextHistory: () => load(false), history: visible ? state.history : [], historyMore: visible ? state.historyMore : null, historyLoading: visible && state.historyLoading, historyError: visible ? state.historyError : '', inspectHistory: (result: OrderCopyRecoveryResult) => perform(historyEntry(result), 'inspect'), stopHistory: (result: OrderCopyRecoveryResult) => perform(historyEntry(result), 'stop')
    };
}
