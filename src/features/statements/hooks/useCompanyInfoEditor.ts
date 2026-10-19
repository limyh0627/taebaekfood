import { useEffect, useReducer, useRef } from 'react';
import type { CompanyId, CompanyInfo } from '../../../shared/types';
import { auth } from '../../../shared/firebase';
import { bankAccountOf } from '../../../shared/companyInfo';
import { COMPANY_INFO_FIELDS, normalizeCompanyInfoOpenResult, type CompanyInfoField, type CompanyInfoReference, type CompanyInfoOpenResult, type CompanyInfoHistoryResult } from '../../../shared/companyInfoCommand';
import { primaryCommitted, saveOutcomeMessage } from '../../../shared/saveOutcome';
import type { CompanyInfoContext, CompanyInfoOperationContext, CompanyInfoSaveContext, CompanyInfoOutcome, CompanyInfoOperationEntry } from '../infrastructure/companyInfoWrites';
export { COMPANY_INFO_FIELDS };
export type { CompanyInfoField };
type Form = Record<CompanyInfoField, string>;
export interface CompanyInfoEditorOptions {
    initial?: CompanyInfo | null;
    companyId: CompanyId;
    actorUid?: string;
    onClose?: () => void;
    onOpenCompanyInfo?: (initial: CompanyInfo | null | undefined, context: CompanyInfoOperationContext) => Promise<CompanyInfoOpenResult>;
    onSave?: (patch: Partial<CompanyInfo>, context: CompanyInfoSaveContext) => Promise<CompanyInfoOutcome>;
    onReadCompanyInfoOperations?: (context: CompanyInfoContext) => Promise<CompanyInfoOperationEntry[]>;
    onInspectCompanyInfoOperation?: (ref: CompanyInfoReference, context: CompanyInfoContext) => Promise<CompanyInfoOutcome>;
    onRetryCompanyInfoOperation?: (ref: CompanyInfoReference, context: CompanyInfoContext) => Promise<CompanyInfoOutcome>;
    onCancelCompanyInfoOperation?: (ref: CompanyInfoReference, context: CompanyInfoContext) => Promise<CompanyInfoOutcome>;
    onDiscardCompanyInfoCopy?: (ref: CompanyInfoReference, text: string | null, referenceText: string | null, context: CompanyInfoContext) => Promise<CompanyInfoOutcome>;
    onListCompanyInfoHistory?: (context: CompanyInfoContext, cursor?: string) => Promise<CompanyInfoHistoryResult>;
}
function display(initial?: CompanyInfo | null): Form {
    const form = Object.fromEntries(COMPANY_INFO_FIELDS.map(key => [key, String(initial?.[key] ?? '')])) as Form;
    form.bankAccount = bankAccountOf(initial);
    return form;
}
function ownedInitial(initial?: CompanyInfo | null) {
    if (!initial)
        return initial;
    const raw = { ...initial };
    for (const key of Object.keys(raw))
        if (!COMPANY_INFO_FIELDS.some(field => field === key))
            Reflect.deleteProperty(raw, key);
    return raw;
}
export function useCompanyInfoEditor(options: CompanyInfoEditorOptions) {
    const [, render] = useReducer((n: number) => n + 1, 0), mounted = useRef(true), latest = useRef(options);
    latest.current = options;
    const create = () => {
        const original = display(options.initial);
        return {
            companyId: options.companyId, actorUid: options.actorUid, planId: crypto.randomUUID(), raw: ownedInitial(options.initial), original, form: { ...original }, dirty: new Set<CompanyInfoField>(), opening: null as CompanyInfoOpenResult | null, openingBusy: false, ready: false, task: null as object | null, error: '', message: '', pending: false, requiresReopen: false, operations: [] as CompanyInfoOperationEntry[], readGeneration: 0, readLoading: true, readError: '', history: [] as CompanyInfoHistoryResult['entries'], historyMore: null as string | null, historyLoading: false, historyError: '', historyGeneration: 0
        };
    };
    const owner = useRef<ReturnType<typeof create> | null>(null);
    if (!owner.current || owner.current.companyId !== options.companyId || owner.current.actorUid !== options.actorUid)
        owner.current = create();
    const captured = owner.current;
    const repaint = () => {
        if (mounted.current)
            render();
    };
    const active = () => mounted.current && owner.current === captured && !!captured.actorUid && auth.currentUser?.uid === captured.actorUid;
    const context = (task?: object): CompanyInfoContext => ({ companyId: captured.companyId, actorUid: captured.actorUid!, isCurrent: () => active() && (!task || captured.task === task) });
    const reference = (): CompanyInfoReference => ({ companyId: captured.companyId, planId: captured.planId });
    const refresh = async () => {
        if (!active())
            return;
        const generation = ++captured.readGeneration;
        captured.readLoading = true;
        repaint();
        try {
            const rows = latest.current.onReadCompanyInfoOperations ? await latest.current.onReadCompanyInfoOperations({ ...context(), isCurrent: () => active() && captured.readGeneration === generation }) : [];
            if (active() && captured.readGeneration === generation) {
                captured.operations = rows;
                captured.readError = '';
            }
        }
        catch (error) {
            if (active() && captured.readGeneration === generation)
                captured.readError = '보관된 회사정보 요청을 읽지 못했습니다. ' + (error instanceof Error ? error.message : String(error));
        }
        finally {
            if (active() && captured.readGeneration === generation) {
                captured.readLoading = false;
                repaint();
            }
        }
    };
    const open = async () => {
        if (!active() || captured.task || captured.openingBusy)
            return false;
        captured.openingBusy = true;
        captured.ready = false;
        repaint();
        try {
            if (!latest.current.onOpenCompanyInfo)
                throw Error('회사정보 원문 확인 기능이 연결되지 않았습니다.');
            const result = await latest.current.onOpenCompanyInfo(captured.raw, { ...context(), planId: captured.planId });
            if (!active())
                return false;
            captured.opening = normalizeCompanyInfoOpenResult(result, reference(), captured.actorUid!);
            captured.ready = true;
            captured.error = '';
            return true;
        }
        catch (error) {
            if (active())
                captured.error = '회사정보를 열지 못했습니다. ' + (error instanceof Error ? error.message : String(error));
            return false;
        }
        finally {
            if (active()) {
                captured.openingBusy = false;
                repaint();
            }
        }
    };
    useEffect(() => {
        mounted.current = true;
        void (async () => {
            await refresh();
            if (active())
                await open();
        })();
        return () => {
            captured.readGeneration++;
            captured.historyGeneration++;
        };
    }, [captured]);
    useEffect(() => () => {
        mounted.current = false;
    }, []);
    const changeField = (key: CompanyInfoField, value: string) => {
        if (!active() || captured.task || captured.openingBusy || captured.pending || captured.requiresReopen || !COMPANY_INFO_FIELDS.includes(key))
            return;
        captured.form = { ...captured.form, [key]: value };
        if (value === captured.original[key])
            captured.dirty.delete(key);
        else
            captured.dirty.add(key);
        captured.error = '';
        repaint();
    };
    const close = () => {
        if (owner.current !== captured)
            return false;
        owner.current = null;
        latest.current.onClose?.();
        return true;
    };
    const consume = (outcome: CompanyInfoOutcome, ref: CompanyInfoReference, mayClose: boolean) => {
        const same = ref.companyId === captured.companyId && ref.planId === captured.planId;
        if (outcome.requestFinalized === true) {
            if (same) {
                captured.pending = false;
                captured.requiresReopen = true;
            }
            captured.message = outcome.status === 'saved' ? '회사정보 저장 완료를 확인했습니다. 현재 정보를 확인해 주세요.' : saveOutcomeMessage(outcome);
            if (same && mayClose && primaryCommitted(outcome, captured.companyId)) {
                close();
                return true;
            }
        }
        else {
            captured.error = saveOutcomeMessage(outcome);
            if (same) {
                captured.pending = outcome.status === 'unknown' || outcome.status === 'partial' || captured.operations.some(row => row.reference?.planId === ref.planId);
                captured.requiresReopen = outcome.requiresReopen === true;
            }
        }
        repaint();
        return false;
    };
    const save = async () => {
        if (!active() || captured.task || !captured.ready || captured.openingBusy || captured.readLoading || captured.readError || captured.pending || captured.requiresReopen || !captured.dirty.size || !latest.current.onSave || !captured.opening)
            return false;
        const task = {};
        captured.task = task;
        captured.error = '';
        const patch: Partial<CompanyInfo> = {};
        for (const key of captured.dirty)
            patch[key] = captured.form[key];
        repaint();
        try {
            const outcome = await latest.current.onSave(patch, { ...context(task), planId: captured.planId, opening: captured.opening });
            if (!context(task).isCurrent())
                return false;
            await refresh();
            if (!context(task).isCurrent())
                return false;
            return consume(outcome, reference(), true);
        }
        catch (error) {
            if (context(task).isCurrent()) {
                captured.pending = true;
                captured.error = '저장 결과를 확인하지 못했습니다. ' + (error instanceof Error ? error.message : String(error)) + ' 같은 요청의 결과 확인 또는 중단을 선택해 주세요.';
            }
            return false;
        }
        finally {
            if (owner.current === captured && captured.task === task) {
                captured.task = null;
                repaint();
            }
            if (active())
                void refresh();
        }
    };
    const recover = async (ref: CompanyInfoReference, mode: 'inspect' | 'retry' | 'cancel' | 'discard', text?: string | null, referenceText?: string | null) => {
        if (!active() || captured.task || ref.companyId !== captured.companyId)
            return false;
        const entry = captured.operations.find(row => row.reference?.planId === ref.planId);
        if (mode === 'retry' && entry?.status !== 'valid')
            return false;
        const callback = mode === 'inspect' ? latest.current.onInspectCompanyInfoOperation : mode === 'retry' ? latest.current.onRetryCompanyInfoOperation : mode === 'cancel' ? latest.current.onCancelCompanyInfoOperation : undefined;
        if (mode === 'discard' ? !latest.current.onDiscardCompanyInfoCopy : !callback) {
            captured.error = '회사정보 요청 복구 기능이 연결되지 않았습니다.';
            repaint();
            return false;
        }
        const task = {};
        captured.task = task;
        captured.error = '';
        repaint();
        try {
            const outcome = mode === 'discard' ? await latest.current.onDiscardCompanyInfoCopy!(ref, text!, referenceText!, context(task)) : await callback!(ref, context(task));
            if (!context(task).isCurrent())
                return false;
            await refresh();
            if (!context(task).isCurrent())
                return false;
            if (mode === 'discard') {
                if (outcome.status === 'saved') {
                    captured.message = '이 기기의 사본만 정리했습니다. 저장된 회사정보나 현재 초안은 바꾸지 않았습니다.';
                    if (ref.planId === captured.planId) {
                        captured.pending = false;
                        captured.requiresReopen = true;
                    }
                }
                else
                    captured.error = saveOutcomeMessage(outcome);
                return outcome.status === 'saved';
            }
            return consume(outcome, ref, true);
        }
        catch (error) {
            if (context(task).isCurrent())
                captured.error = '회사정보 요청을 확인하지 못했습니다. ' + (error instanceof Error ? error.message : String(error));
            return false;
        }
        finally {
            if (owner.current === captured && captured.task === task) {
                captured.task = null;
                repaint();
            }
            if (active())
                void refresh();
        }
    };
    const history = async (reset: boolean) => {
        if (!active() || captured.historyLoading || !latest.current.onListCompanyInfoHistory)
            return;
        const generation = ++captured.historyGeneration, cursor = reset ? undefined : captured.historyMore ?? undefined;
        if (!reset && !cursor)
            return;
        captured.historyLoading = true;
        captured.historyError = '';
        repaint();
        try {
            const result = await latest.current.onListCompanyInfoHistory({ ...context(), isCurrent: () => active() && captured.historyGeneration === generation }, cursor);
            if (!active() || captured.historyGeneration !== generation)
                return;
            captured.history = reset ? result.entries : [...captured.history, ...result.entries.filter(row => !captured.history.some(old => old.result.reference.planId === row.result.reference.planId))];
            captured.historyMore = result.nextCursor;
            captured.message = `이번 조회에서 ${result.entries.length}건을 확인했습니다. 조회 목록이 없다고 미처리로 확정할 수는 없습니다.`;
        }
        catch (error) {
            if (active() && captured.historyGeneration === generation)
                captured.historyError = '회사정보 처리 이력을 읽지 못했습니다. ' + (error instanceof Error ? error.message : String(error));
        }
        finally {
            if (active() && captured.historyGeneration === generation) {
                captured.historyLoading = false;
                repaint();
            }
        }
    };
    const reopenCurrent = async () => {
        if (!active() || captured.task || captured.pending || captured.operations.some(row => row.reference?.planId === captured.planId))
            return false;
        owner.current = null;
        repaint();
        return true;
    };
    const blockedReason = !options.onSave ? '이 화면에는 회사정보 저장 기능이 연결되지 않았습니다.' : !captured.actorUid || auth.currentUser?.uid !== captured.actorUid ? '로그인 계정이 바뀌어 저장할 수 없습니다. 창을 닫고 현재 계정에서 다시 열어 주세요.' : !options.onOpenCompanyInfo ? '회사정보 원문 확인 기능이 연결되지 않았습니다.' : '';
    return {
        blockedReason, form: captured.form, changeField, dirtyFields: Array.from(captured.dirty), dirty: !!captured.dirty.size, busy: !!captured.task || captured.openingBusy, openingBusy: captured.openingBusy, locked: captured.pending || captured.requiresReopen, error: captured.error, message: captured.message, canSave: active() && !blockedReason && captured.ready && !captured.readLoading && !captured.readError && !captured.task && !captured.openingBusy && !captured.pending && !captured.requiresReopen && !!captured.dirty.size, save, close, reopenCurrent, canReopenCurrent: active() && !captured.pending && !captured.task && !captured.openingBusy && !captured.operations.some(row => row.reference?.planId === captured.planId), operations: captured.operations, readLoading: captured.readLoading, readError: captured.readError, refresh, inspect: (ref: CompanyInfoReference) => recover(ref, 'inspect'), retry: (ref: CompanyInfoReference) => recover(ref, 'retry'), cancel: (ref: CompanyInfoReference) => recover(ref, 'cancel'), discardCopy: (ref: CompanyInfoReference, text: string | null, referenceText: string | null) => recover(ref, 'discard', text, referenceText), canRetryEntry: (entry: CompanyInfoOperationEntry) => !!entry.reference && entry.status === 'valid', canDiscardEntry: (entry: CompanyInfoOperationEntry) => !!entry.reference && (typeof entry.observedLocalText === 'string' || typeof entry.observedReferenceText === 'string'), history: captured.history, historyLoading: captured.historyLoading, historyError: captured.historyError, historyMore: captured.historyMore, loadHistory: () => history(true), nextHistory: () => history(false)
    };
}
