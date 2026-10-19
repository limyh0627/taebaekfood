import { useEffect, useReducer, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, authReady } from '../../../shared/firebase';
import { AR, AP, OTHER_PAYABLE } from '../../../shared/autoJournal';
import { today } from '../../../shared/day';
import { formatMoneyInput, parseMoneyInput } from '../../../shared/moneyInput';
import { appConfirm } from '../../../shared/components/appDialog';
import { saveOutcomeMessage } from '../../../shared/saveOutcome';
import type { CompanyId, PreparedPartnerAdvance } from '../../../shared/partnerAdvance';
import type { PartnerAdvanceRecoveryReference, PartnerAdvanceRecoveryResult } from '../../../shared/partnerAdvanceRecovery';
import { partnerAdvanceRecovery, preparePartnerAdvance, advanceBodyKey, type PendingPartnerAdvance, type AdvanceRecoveryEntry, type AdvanceRecoveryOutcome, type AdvanceRecoveryScope } from '../infrastructure/partnerAdvanceCommands';
export const advanceSourceKey = (source: PreparedPartnerAdvance['sources'][number]) => `${source.key.id}:${source.key.lineKey}`;
export const advanceTargetKey = (target: PreparedPartnerAdvance['targets'][number]) => `${target.statementId}:${target.accountCode}`;
const compatible = (source: PreparedPartnerAdvance['sources'][number], target: PreparedPartnerAdvance['targets'][number]) => source.code === '254' ? target.accountCode === AR : [AP, OTHER_PAYABLE].includes(target.accountCode);
const order = (a: {
    date: string;
    docNo: string;
}, b: {
    date: string;
    docNo: string;
}) => a.date.localeCompare(b.date) || a.docNo.localeCompare(b.docNo);
export interface AdvanceState {
    blocked: boolean;
    applied: boolean;
    busy: boolean;
    sourceBalance: number;
    selectedAmount: number;
    lookupBlocked: boolean;
    pendingUnknown: boolean;
    selectionValid: boolean;
    resetVersion: number;
}
export interface PartnerAdvanceRecoveryOptions {
    companyId: CompanyId;
    partnerId: string;
    sourceCode?: '133' | '254';
    maxApplicationAmount?: number;
    externalBusy?: boolean;
    embedded?: boolean;
    onClose?: () => void;
    onStateChange?: (state: AdvanceState) => void;
    confirm?: (message: string) => Promise<boolean>;
}
export const partnerAdvanceServices = {
    ...partnerAdvanceRecovery, prepare: preparePartnerAdvance
};
export function usePartnerAdvanceRecovery(options: PartnerAdvanceRecoveryOptions, services = partnerAdvanceServices) {
    const [, render] = useReducer((n: number) => n + 1, 0), [uid, setUid] = useState(auth.currentUser?.uid ?? '');
    const latest = useRef(options);
    latest.current = options;
    const ports = useRef(services);
    ports.current = services;
    const mounted = useRef(true);
    const make = () => ({
        companyId: options.companyId, partnerId: options.partnerId, uid, data: null as PreparedPartnerAdvance | null, sourceId: '', targetId: '', amount: '', date: today(), applied: false, resetVersion: 0, error: '', message: '', loading: true, readLoading: true, readError: '', refreshFailed: false, readGeneration: 0, task: null as object | null, operations: [] as AdvanceRecoveryEntry[], results: new Map<string, AdvanceRecoveryOutcome>(), sessionOperation: null as string | null, history: [] as PartnerAdvanceRecoveryResult[], historyMore: null as string | null, historyLoading: false, historyError: '', historyGeneration: 0
    });
    const owner = useRef<ReturnType<typeof make> | null>(null);
    if (!owner.current || owner.current.companyId !== options.companyId || owner.current.partnerId !== options.partnerId || owner.current.uid !== uid)
        owner.current = make();
    const state = owner.current;
    const active = () => mounted.current && owner.current === state && !!state.uid && auth.currentUser?.uid === state.uid;
    const repaint = () => {
        if (mounted.current)
            render();
    };
    const scope = (): AdvanceRecoveryScope => ({
        companyId: state.companyId, partnerId: state.partnerId, actorId: state.uid
    });
    const sortedSources = () => [...(state.data?.sources ?? [])].filter(row => row.remaining > 0 && (!latest.current.sourceCode || row.code === latest.current.sourceCode)).sort((a, b) => order(a, b) || advanceSourceKey(a).localeCompare(advanceSourceKey(b)));
    const selectedSource = () => sortedSources().find(row => advanceSourceKey(row) === state.sourceId);
    const sortedTargets = () => [...(state.data?.targets ?? [])].filter(row => row.remaining > 0 && selectedSource() && compatible(selectedSource()!, row)).sort((a, b) => order(a, b) || advanceTargetKey(a).localeCompare(advanceTargetKey(b)));
    const selectedTarget = () => sortedTargets().find(row => advanceTargetKey(row) === state.targetId);
    const maximum = () => latest.current.maxApplicationAmount ?? Infinity;
    const selectionValid = () => !!selectedSource() && !!selectedTarget() && Number.isSafeInteger(parseMoneyInput(state.amount)) && parseMoneyInput(state.amount) > 0 && parseMoneyInput(state.amount) <= Math.min(selectedSource()!.remaining, selectedTarget()!.remaining, maximum());
    const refKey = (ref: PartnerAdvanceRecoveryReference) => JSON.stringify(ref);
    const refresh = async () => {
        if (!active())
            return;
        const turn = ++state.readGeneration;
        state.readLoading = true;
        repaint();
        try {
            const entries = await ports.current.read(scope(), () => active() && turn === state.readGeneration);
            if (active() && turn === state.readGeneration) {
                state.operations = entries;
                state.readError = '';
            }
        }
        catch (error) {
            if (active() && turn === state.readGeneration)
                state.readError = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (active() && turn === state.readGeneration) {
                state.readLoading = false;
                repaint();
            }
        }
    };
    const refreshBalances = async (initial = false) => {
        if (!active())
            return;
        try {
            const prepared = await ports.current.prepare(state.companyId, state.partnerId);
            if (!active())
                return;
            state.data = prepared;
            if (state.refreshFailed)
                state.error = '';
            state.refreshFailed = false;
            // 최초 제안만 원래 선택 정책을 사용한다. 과거 요청 조회는 현재 입력을 덮지 않는다.
            if (initial) {
                const sorted = [...prepared.sources].filter(row => row.remaining > 0 && (!latest.current.sourceCode || row.code === latest.current.sourceCode)).sort((a, b) => order(a, b) || advanceSourceKey(a).localeCompare(advanceSourceKey(b)));
                const first = sorted.find(row => prepared.targets.some(item => item.remaining > 0 && compatible(row, item)));
                const target = first && [...prepared.targets].filter(row => row.remaining > 0 && compatible(first, row)).sort((a, b) => order(a, b) || advanceTargetKey(a).localeCompare(advanceTargetKey(b)))[0];
                state.sourceId = first ? advanceSourceKey(first) : '';
                state.targetId = target ? advanceTargetKey(target) : '';
                state.amount = first && target ? formatMoneyInput(Math.min(first.remaining, target.remaining, maximum())) : '';
                state.date = [today(), first?.date ?? '', target?.date ?? ''].sort().at(-1)!;
            }
        }
        catch (error) {
            if (active()) {
                state.refreshFailed = true;
                state.error = (state.applied ? '상계는 완료됐지만 새 잔액을 확인하지 못했습니다. 다시 전송하지 마세요. ' : '') + (error instanceof Error ? error.message : String(error));
            }
        }
        finally {
            if (active()) {
                state.loading = false;
                repaint();
            }
        }
    };
    useEffect(() => {
        mounted.current = true;
        let live = true;
        const stop = onAuthStateChanged(auth, user => {
            if (live)
                setUid(user?.uid ?? '');
        });
        return () => { live = false; mounted.current = false; stop(); };
    }, []);
    useEffect(() => {
        let live = true;
        void Promise.resolve(authReady).then(async () => {
            if (!live || !active())
                return;
            await refresh();
            if (live && active())
                await refreshBalances(true);
        });
        return () => { live = false; state.readGeneration++; state.historyGeneration++; };
    }, [state]);
    const locked = () => !!state.task || !!latest.current.externalBusy || state.readLoading || !!state.readError || !!state.operations.length || state.refreshFailed;
    const start = () => {
        if (!active() || state.task || latest.current.externalBusy)
            return null;
        const task = {};
        state.task = task;
        state.error = '';
        repaint();
        return task;
    };
    const consume = async (result: AdvanceRecoveryOutcome, operationId: string, action?: 'apply' | 'cancel') => {
        if (!active())
            return;
        if (result.serverResult)
            state.results.set(refKey(result.serverResult.reference), result);
        state.message = saveOutcomeMessage(result.outcome) || '이 요청의 상계 처리가 확인됐습니다.';
        const own = state.sessionOperation === operationId;
        if (result.terminal && result.outcome.status === 'saved' && own) {
            state.applied = action === 'apply';
            if (action === 'cancel')
                state.resetVersion++;
            state.sessionOperation = null;
            await refreshBalances();
        }
        if (result.terminal && own && (result.outcome.status === 'cancelled' || result.outcome.status === 'rejected'))
            state.sessionOperation = null;
    };
    const submit = async (application?: PreparedPartnerAdvance['applications'][number]) => {
        if (locked() || !active() || !state.data || !state.data.enabled || latest.current.embedded && state.applied && !application)
            return false;
        if (!application && !selectionValid()) {
            state.error = '남은 금액 안에서 적용 금액을 입력해 주세요.';
            repaint();
            return false;
        }
        const task = start();
        if (!task)
            return false;
        const source = selectedSource(), target = selectedTarget(), prepared = state.data, value = parseMoneyInput(state.amount), date = state.date;
        const current = () => active() && state.task === task;
        try {
            if (!await (latest.current.confirm ?? appConfirm)(application ? `${application.docNo}의 ${application.amount.toLocaleString('ko-KR')}원 적용을 취소하고 선급·선수금으로 돌릴까요?` : `${source!.docNo}에서 ${target!.docNo}에 ${value.toLocaleString('ko-KR')}원을 적용할까요?`))
                return false;
            if (!current())
                return false;
            const request: PendingPartnerAdvance = {
                version: 1, companyId: state.companyId, actorId: state.uid, action: application ? 'cancel' : 'apply', input: application ? {
                    operationId: crypto.randomUUID(), partnerId: state.partnerId, date: [today(), application.date].sort().at(-1)!, applicationStatementId: application.statementId, reason: '거래처 원장에서 적용 취소', expectedRevision: prepared.revision, releaseId: prepared.releaseId
                } : {
                    operationId: crypto.randomUUID(), partnerId: state.partnerId, date, source: source!.key, statementId: target!.statementId, accountCode: target!.accountCode, amount: value, expectedSourceFingerprint: source!.fingerprint, expectedTargetFingerprint: target!.fingerprint, expectedRevision: prepared.revision, releaseId: prepared.releaseId
                }
            };
            state.sessionOperation = request.input.operationId;
            const result = await ports.current.submit(scope(), request, current);
            if (!current())
                return false;
            await consume(result, request.input.operationId, request.action);
            return result.terminal;
        }
        catch (error) {
            if (current())
                state.error = error instanceof Error ? error.message : String(error);
            return false;
        }
        finally {
            if (current()) {
                state.task = null;
                await refresh();
                repaint();
            }
        }
    };
    const recover = async (entry: AdvanceRecoveryEntry, mode: 'inspect' | 'retry' | 'stop' | 'discard') => {
        const task = start();
        if (!task)
            return;
        const current = () => active() && state.task === task;
        try {
            if (mode === 'discard') {
                const result = await ports.current.discard(scope(), entry, current);
                if (current())
                    state.message = result.message;
            }
            else {
                const result = mode === 'retry' ? await ports.current.retry(scope(), entry, current) : await ports.current.resolve(scope(), entry, mode, current);
                if (current())
                    await consume(result, entry.reference?.operationId ?? '', entry.request?.action);
            }
        }
        catch (error) {
            if (current())
                state.error = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (current()) {
                state.task = null;
                await refresh();
                repaint();
            }
        }
    };
    const history = async (reset: boolean) => {
        if (!active() || state.historyLoading || !reset && !state.historyMore)
            return;
        const turn = ++state.historyGeneration;
        state.historyLoading = true;
        repaint();
        try {
            const result = await ports.current.list(scope(), reset ? undefined : state.historyMore!, () => active() && turn === state.historyGeneration);
            if (active() && turn === state.historyGeneration) {
                state.history = reset ? result.entries : [...state.history, ...result.entries];
                state.historyMore = result.nextCursor;
                state.historyError = '';
                state.message = `이번 조회 ${result.entries.length}건입니다. 목록이 없다는 이유로 미처리라고 단정하지 않습니다.`;
            }
        }
        catch (error) {
            if (active() && turn === state.historyGeneration)
                state.historyError = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (active() && turn === state.historyGeneration) {
                state.historyLoading = false;
                repaint();
            }
        }
    };
    const pickSource = (id: string) => {
        if (!active() || locked())
            return;
        const chosen = sortedSources().find(row => advanceSourceKey(row) === id), first = chosen && [...(state.data?.targets ?? [])].filter(row => row.remaining > 0 && compatible(chosen, row)).sort((a, b) => order(a, b) || advanceTargetKey(a).localeCompare(advanceTargetKey(b)))[0];
        state.error = '';
        state.sourceId = id;
        state.targetId = first ? advanceTargetKey(first) : '';
        state.amount = chosen && first ? formatMoneyInput(Math.min(chosen.remaining, first.remaining, maximum())) : '';
        repaint();
    };
    const pickTarget = (id: string) => {
        if (!active() || locked())
            return;
        const selected = sortedTargets().find(row => advanceTargetKey(row) === id), source = selectedSource();
        state.targetId = id;
        state.amount = source && selected ? formatMoneyInput(Math.min(source.remaining, selected.remaining, maximum())) : '';
        state.error = '';
        repaint();
    };
    const visible = active(), sourceBalance = sortedSources().reduce((sum, row) => sum + row.remaining, 0), selectedAmount = parseMoneyInput(state.amount), valid = selectionValid();
    const historyEntry = (result: PartnerAdvanceRecoveryResult): AdvanceRecoveryEntry => ({
        key: advanceBodyKey(scope(), result.reference.operationId), bodyText: null, sidecarKey: null, sidecarText: null, reference: result.reference, request: null, requestHash: null, sidecarHash: null, status: 'missing', description: result.message
    });
    const canStop = (entry: AdvanceRecoveryEntry) => !!entry.reference && (!state.results.get(refKey(entry.reference))?.serverResult || state.results.get(refKey(entry.reference))?.serverResult?.status === 'unknown');
    const reported: AdvanceState = {
        blocked: !!state.task || state.readLoading || !!state.readError || !!state.operations.length, lookupBlocked: state.loading || state.refreshFailed || !state.data, pendingUnknown: !!state.readError || state.operations.some(row => row.status !== 'valid'), applied: state.applied, busy: !!state.task, sourceBalance, selectedAmount, selectionValid: valid, resetVersion: state.resetVersion
    };
    const reportRef = useRef(options.onStateChange);
    reportRef.current = options.onStateChange;
    useEffect(() => { reportRef.current?.(reported); }, [state, reported.blocked, reported.lookupBlocked, reported.pendingUnknown, reported.applied, reported.busy, sourceBalance, selectedAmount, valid, reported.resetVersion]);
    return {
        data: state.data, sourceId: state.sourceId, targetId: state.targetId, amount: state.amount, date: state.date, sources: sortedSources(), source: selectedSource(), targets: sortedTargets(), target: selectedTarget(), selectionValid: valid, blocked: !visible || state.loading || locked() || !state.data?.enabled, loading: state.loading, busy: !!state.task, error: state.error, message: state.message, refreshFailed: state.refreshFailed, applied: state.applied, resetVersion: state.resetVersion, operations: visible ? state.operations : [], readLoading: state.readLoading, readError: state.readError, pickSource, pickTarget, setAmount: (value: string) => {
            if (active() && !locked()) {
                state.amount = formatMoneyInput(value);
                state.error = '';
                repaint();
            }
        }, setDate: (value: string) => {
            if (active() && !locked()) {
                state.date = value;
                repaint();
            }
        }, submit, refresh: () => refresh(), refreshBalances: () => refreshBalances(), close: () => {
            if (!active() || state.task || latest.current.externalBusy)
                return false;
            latest.current.onClose?.();
            return true;
        }, inspect: (entry: AdvanceRecoveryEntry) => recover(entry, 'inspect'), retry: (entry: AdvanceRecoveryEntry) => recover(entry, 'retry'), stop: (entry: AdvanceRecoveryEntry) => recover(entry, 'stop'), discardCopy: (entry: AdvanceRecoveryEntry) => recover(entry, 'discard'), resultFor: (entry: AdvanceRecoveryEntry) => entry.reference ? state.results.get(refKey(entry.reference)) : undefined, canRetry: (entry: AdvanceRecoveryEntry) => entry.status === 'valid' && !state.results.get(entry.reference ? refKey(entry.reference) : '')?.copyMismatch && !state.results.get(entry.reference ? refKey(entry.reference) : '')?.terminal, canDiscard: (entry: AdvanceRecoveryEntry) => entry.bodyText !== null || entry.sidecarText !== null, canStop, inspectHistory: (result: PartnerAdvanceRecoveryResult) => recover(historyEntry(result), 'inspect'), stopHistory: (result: PartnerAdvanceRecoveryResult) => recover(historyEntry(result), 'stop'), history: visible ? state.history : [], historyMore: state.historyMore, historyLoading: state.historyLoading, historyError: state.historyError, loadHistory: () => history(true), nextHistory: () => history(false)
    };
}
