import { useEffect, useReducer, useRef } from 'react';
import { auth } from '../../../shared/firebase';
import type { AccountCode, AccountGroup, CompanyId } from '../../../shared/types';
import { primaryCommitted, saveOutcomeMessage, type SaveOutcome } from '../../../shared/saveOutcome';
import type { AccountEditContext, AccountOperationContext, AccountUpdateContext, AccountManagementOpenResult, AccountOperationReferenceEntry, AccountManagementReference, AccountGroupEditPatch, AccountCodeEditPatch } from '../infrastructure/accountManagementWrites';
type GroupDraft = {
    name: string;
    type: AccountGroup['type'];
    plLine: NonNullable<AccountGroup['plLine']> | '';
};
type CodeDraft = {
    code: string;
    name: string;
    groupId: string;
};
type Base = {
    id: string;
    planId: string;
    opening?: AccountManagementOpenResult;
    openFailed: boolean;
    pending: boolean;
    requiresReopen: boolean;
};
type Session = Base & ({
    kind: 'group';
    row: AccountGroup;
    original: GroupDraft;
    draft: GroupDraft;
    dirty: Set<keyof GroupDraft>;
} | {
    kind: 'code';
    intent: 'edit' | 'groupMove';
    row: AccountCode;
    original: CodeDraft;
    draft: CodeDraft;
    dirty: Set<keyof CodeDraft>;
});
export interface AccountManagementEditorOptions {
    companyId: CompanyId;
    actorUid?: string;
    isOtherBusy?: () => boolean;
    onOpenAccountEdit?: (kind: 'code' | 'group', row: AccountCode | AccountGroup, context: AccountOperationContext) => Promise<AccountManagementOpenResult>;
    onUpdateGroup?: (id: string, patch: AccountGroupEditPatch, context: AccountUpdateContext) => Promise<SaveOutcome>;
    onUpdateCode?: (id: string, patch: AccountCodeEditPatch, context: AccountUpdateContext) => Promise<SaveOutcome>;
    onReadAccountOperations?: (context: AccountEditContext) => Promise<AccountOperationReferenceEntry[]>;
    onInspectAccountOperation?: (ref: AccountManagementReference, context: AccountEditContext) => Promise<SaveOutcome>;
    onRetryAccountOperation?: (ref: AccountManagementReference, context: AccountEditContext) => Promise<SaveOutcome>;
    onCancelAccountOperation?: (ref: AccountManagementReference, context: AccountEditContext) => Promise<SaveOutcome>;
    onDiscardAccountOperationCopy?: (ref: AccountManagementReference, text: string, context: AccountEditContext) => Promise<SaveOutcome>;
}
export function useAccountManagementEditor(options: AccountManagementEditorOptions) {
    const [, render] = useReducer(n => n + 1, 0), mounted = useRef(true), latest = useRef(options);
    latest.current = options;
    const makeOwner = () => ({ companyId: options.companyId, actorUid: options.actorUid, session: null as Session | null, task: null as object | null, error: '', message: '', references: [] as AccountOperationReferenceEntry[], readError: '', readGeneration: 0, readReady: false });
    const owner = useRef(makeOwner());
    if (owner.current.companyId !== options.companyId || owner.current.actorUid !== options.actorUid)
        owner.current = makeOwner();
    const captured = owner.current;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const repaint = () => { if (mounted.current)
        render(); };
    const active = () => mounted.current && owner.current === captured && !!captured.actorUid && auth.currentUser?.uid === captured.actorUid;
    const locked = () => !!captured.task || !!latest.current.isOtherBusy?.();
    const referenceOf = (session: Session): AccountManagementReference => ({ companyId: captured.companyId, kind: session.kind, targetId: session.id, planId: session.planId });
    const matches = (session: Session | null, ref: AccountManagementReference) => !!session && ref.companyId === captured.companyId && session.kind === ref.kind && session.id === ref.targetId && session.planId === ref.planId;
    const context = (task?: object): AccountEditContext => ({ companyId: captured.companyId, actorUid: captured.actorUid!, isCurrent: () => active() && (!task || captured.task === task) });
    const refreshOperations = async () => {
        if (!active())
            return;
        const turn = ++captured.readGeneration, callback = latest.current.onReadAccountOperations;
        if (!callback) {
            captured.readReady = true;
            return;
        }
        try {
            const rows = await callback(context());
            if (active() && turn === captured.readGeneration) {
                captured.references = rows;
                captured.readError = '';
                captured.readReady = true;
            }
        }
        catch (error) {
            if (active() && turn === captured.readGeneration)
                captured.readError = '편집 요청 목록을 읽지 못했습니다. ' + (error instanceof Error ? error.message : String(error));
        }
        finally {
            if (active())
                repaint();
        }
    };
    useEffect(() => { void refreshOperations(); }, [options.companyId, options.actorUid]);
    const open = async (kind: 'code' | 'group', row: AccountCode | AccountGroup, intent: 'edit' | 'groupMove' = 'edit') => {
        if (!active() || locked())
            return false;
        if (!captured.readReady || captured.readError) {
            captured.error = '보관된 편집 요청 목록을 먼저 확인해 주세요.';
            repaint();
            return false;
        }
        if (captured.references.some(entry => entry.action === 'update' && entry.reference?.targetId === row.id && entry.reference.kind === kind)) {
            captured.error = '이 계정의 이전 편집 요청을 먼저 확인하거나 중단해 주세요.';
            repaint();
            return false;
        }
        const base = { id: row.id, planId: crypto.randomUUID(), openFailed: false, pending: false, requiresReopen: false };
        if (kind === 'group') {
            const group = row as AccountGroup, original: GroupDraft = { name: group.name, type: group.type, plLine: group.plLine ?? '' };
            captured.session = { ...base, kind, row: { ...group }, original, draft: { ...original }, dirty: new Set() };
        }
        else {
            const code = row as AccountCode, original: CodeDraft = { code: code.code, name: code.name, groupId: code.groupId ?? '' };
            captured.session = { ...base, kind, intent, row: { ...code }, original, draft: { ...original }, dirty: new Set() };
        }
        const session = captured.session, task = {};
        captured.task = task;
        captured.error = '';
        repaint();
        try {
            if (!latest.current.onOpenAccountEdit)
                throw Error('이 화면에는 계정 원문 확인 기능이 연결되지 않았습니다.');
            const opened = await latest.current.onOpenAccountEdit(kind, session.row, { ...context(task), planId: session.planId });
            if (!context(task).isCurrent() || captured.session !== session)
                return false;
            const ref = opened.reference;
            if (opened.actorUid !== captured.actorUid || ref.companyId !== captured.companyId || ref.kind !== kind || ref.targetId !== session.id || ref.planId !== session.planId)
                throw Error('다른 계정의 원문 확인 결과입니다. 현재 목록에서 다시 열어 주세요.');
            session.opening = opened;
            return true;
        }
        catch (error) {
            if (active() && captured.session === session) {
                session.openFailed = true;
                captured.error = error instanceof Error ? error.message : String(error);
            }
            return false;
        }
        finally {
            if (owner.current === captured && captured.task === task) {
                captured.task = null;
                repaint();
            }
        }
    };
    const changeGroup = (patch: Partial<GroupDraft>) => { const s = captured.session; if (!active() || locked() || s?.kind !== 'group' || s.pending || s.requiresReopen)
        return; for (const key of ['name', 'type', 'plLine'] as const)
        if (patch[key] !== undefined) {
            s.draft = { ...s.draft, [key]: patch[key] };
            if (s.draft[key] !== s.original[key])
                s.dirty.add(key);
            else
                s.dirty.delete(key);
        } captured.error = ''; repaint(); };
    const changeCode = (patch: Partial<CodeDraft>) => { const s = captured.session; if (!active() || locked() || s?.kind !== 'code' || s.pending || s.requiresReopen)
        return; for (const key of ['code', 'name', 'groupId'] as const)
        if (patch[key] !== undefined && (s.intent !== 'groupMove' || key === 'groupId')) {
            s.draft = { ...s.draft, [key]: patch[key] };
            if (s.draft[key] !== s.original[key])
                s.dirty.add(key);
            else
                s.dirty.delete(key);
        } captured.error = ''; repaint(); };
    const cancel = () => { if (owner.current !== captured)
        return; captured.session = null; captured.task = null; captured.error = ''; repaint(); void refreshOperations(); };
    const consume = (outcome: SaveOutcome, ref: AccountManagementReference, session: Session | null) => {
        const same = matches(session, ref) && captured.session === session;
        if ((outcome as SaveOutcome & {
            requestFinalized?: boolean;
        }).requestFinalized === true && (primaryCommitted(outcome, ref.targetId) || outcome.status === 'cancelled')) {
            captured.message = outcome.status === 'saved' ? '이 편집 요청의 처리 완료를 확인했습니다. 현재 목록을 확인해 주세요.' : saveOutcomeMessage(outcome);
            if (same)
                captured.session = null;
            return primaryCommitted(outcome, ref.targetId);
        }
        captured.error = saveOutcomeMessage(outcome);
        if (same && session) {
            session.pending = outcome.status === 'unknown' || outcome.status === 'partial' || captured.references.some(row => row.reference?.planId === ref.planId && row.reference.targetId === ref.targetId && row.reference.kind === ref.kind);
            if (outcome.status === 'rejected' && !session.pending)
                session.requiresReopen = (outcome as SaveOutcome & {
                    requiresReopen?: boolean;
                }).requiresReopen === true;
        }
        return false;
    };
    const save = async () => {
        const session = captured.session;
        if (!active() || !session || locked() || session.pending || session.requiresReopen || !session.opening || !session.dirty.size)
            return false;
        const callback = session.kind === 'group' ? latest.current.onUpdateGroup : latest.current.onUpdateCode;
        if (!callback)
            return false;
        if ((session.kind === 'group' || session.intent === 'edit') && !session.draft.name.trim()) {
            captured.error = '이름을 입력해 주세요.';
            repaint();
            return false;
        }
        const task = {};
        captured.task = task;
        captured.error = '';
        repaint();
        const patch: Record<string, unknown> = {};
        if (session.kind === 'group') {
            if (session.dirty.has('name'))
                patch.name = session.draft.name.trim();
            if (session.dirty.has('type'))
                patch.type = session.draft.type;
            if (session.dirty.has('plLine'))
                patch.plLine = session.draft.plLine || null;
        }
        else
            for (const key of session.dirty)
                if (session.intent !== 'groupMove' || key === 'groupId')
                    patch[key] = key === 'groupId' ? session.draft[key] : session.draft[key].trim();
        try {
            session.pending = true;
            const outcome = await callback(session.id, patch, { ...context(task), planId: session.planId, opening: session.opening });
            if (!context(task).isCurrent() || captured.session !== session)
                return false;
            await refreshOperations();
            if (!context(task).isCurrent())
                return false;
            return consume(outcome, referenceOf(session), session);
        }
        catch (error) {
            if (context(task).isCurrent() && captured.session === session) {
                session.pending = true;
                captured.error = '편집 처리 결과를 확인하지 못했습니다. ' + (error instanceof Error ? error.message : String(error)) + ' 같은 요청의 결과 확인 또는 미처리 요청 중단을 선택해 주세요.';
            }
            return false;
        }
        finally {
            if (owner.current === captured && captured.task === task) {
                captured.task = null;
                repaint();
            }
            if (active())
                void refreshOperations();
        }
    };
    const recover = async (ref: AccountManagementReference, mode: 'inspect' | 'retry' | 'cancel' | 'discard', text?: string) => {
        if (!active() || locked() || ref.companyId !== captured.companyId)
            return false;
        const callbacks = latest.current, callback = mode === 'inspect' ? callbacks.onInspectAccountOperation : mode === 'retry' ? callbacks.onRetryAccountOperation : mode === 'cancel' ? callbacks.onCancelAccountOperation : undefined;
        if (mode === 'discard' ? !callbacks.onDiscardAccountOperationCopy : !callback) {
            captured.error = '이 화면에는 편집 요청 복구 기능이 연결되지 않았습니다.';
            repaint();
            return false;
        }
        const row = captured.references.find(entry => entry.reference?.planId === ref.planId && entry.reference.targetId === ref.targetId && entry.reference.kind === ref.kind);
        if (mode === 'retry' && (!row || row.status !== 'valid' || row.action !== 'update'))
            return false;
        const task = {}, session = captured.session;
        captured.task = task;
        captured.error = '';
        repaint();
        try {
            const outcome = mode === 'discard' ? await callbacks.onDiscardAccountOperationCopy!(ref, text!, context(task)) : await callback!(ref, context(task));
            if (!context(task).isCurrent())
                return false;
            await refreshOperations();
            if (!context(task).isCurrent())
                return false;
            if (mode === 'discard') {
                if (outcome.status === 'saved')
                    captured.message = '이 기기 편집 사본만 정리했습니다. 이미 처리된 업무나 현재 초안은 변경하지 않았습니다.';
                else
                    captured.error = saveOutcomeMessage(outcome);
                return outcome.status === 'saved';
            }
            return consume(outcome, ref, session);
        }
        catch (error) {
            if (context(task).isCurrent())
                captured.error = '편집 요청의 결과를 확인하지 못했습니다. ' + (error instanceof Error ? error.message : String(error));
            return false;
        }
        finally {
            if (owner.current === captured && captured.task === task) {
                captured.task = null;
                repaint();
            }
            if (active())
                void refreshOperations();
        }
    };
    const moveCodeGroup = async (row: AccountCode, groupId: string) => { if (!active() || locked())
        return false; const s = captured.session; if (s?.pending || s?.requiresReopen)
        return false; if (s?.kind !== 'code' || s.id !== row.id || s.intent !== 'groupMove') {
        if (!await open('code', row, 'groupMove'))
            return false;
    } changeCode({ groupId }); return save(); };
    const session = captured.session, connected = session?.kind === 'group' ? !!options.onUpdateGroup : !!options.onUpdateCode;
    const blockedReason = !connected || !options.onOpenAccountEdit ? '이 화면에는 해당 계정 저장·원문 확인 기능이 연결되지 않았습니다.' : !active() ? '로그인 계정이 바뀌었습니다. 현재 계정에서 다시 열어 주세요.' : session?.openFailed ? '원문을 확인하지 못했습니다. 현재 목록에서 다시 열어 주세요.' : session?.pending ? '이전 편집 요청의 결과를 확인하거나 미처리 요청을 중단해 주세요.' : session?.requiresReopen ? '이 요청은 종결됐습니다. 현재 목록에서 다시 열어 새 수정으로 작성해 주세요.' : '';
    const ownsReference = (ref: AccountManagementReference) => captured.references.some(row => row.action === 'update' && row.reference?.companyId === ref.companyId && row.reference.kind === ref.kind && row.reference.targetId === ref.targetId && row.reference.planId === ref.planId) || matches(captured.session, ref);
    return { groupSession: session?.kind === 'group' ? { id: session.id, planId: session.planId, draft: session.draft, busy: !!captured.task, locked: session.pending || session.requiresReopen } : null, codeSession: session?.kind === 'code' ? { id: session.id, planId: session.planId, intent: session.intent, draft: session.draft, busy: !!captured.task, locked: session.pending || session.requiresReopen } : null,
        busy: !!captured.task, isBusy: () => owner.current === captured && !!captured.task, error: captured.error, message: captured.message, blockedReason, canSave: !!session && !!session.opening && !!session.dirty.size && !locked() && !blockedReason,
        operationReferences: captured.references.filter(row => row.action === 'update' || !!row.reference && matches(session, row.reference)), readError: captured.readError, readLoading: !captured.readReady, ownsReference, refreshOperations,
        openGroup: (row: AccountGroup) => open('group', row), openCode: (row: AccountCode) => open('code', row), changeGroup, changeCode, save, cancel, moveCodeGroup,
        inspectOperation: (ref: AccountManagementReference) => recover(ref, 'inspect'), retryOperation: (ref: AccountManagementReference) => recover(ref, 'retry'), cancelOperation: (ref: AccountManagementReference) => recover(ref, 'cancel'), discardOperation: (ref: AccountManagementReference, text: string) => recover(ref, 'discard', text) };
}
