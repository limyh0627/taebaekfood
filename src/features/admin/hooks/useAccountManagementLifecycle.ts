import { useEffect, useReducer, useRef } from 'react';
import type { AccountCode, AccountGroup, CompanyId } from '../../../shared/types';
import { auth } from '../../../shared/firebase';
import { primaryCommitted, saveOutcomeMessage, type SaveOutcome } from '../../../shared/saveOutcome';
import type { AccountEditContext, AccountOperationContext, AccountOperationReferenceEntry, AccountManagementReference } from '../infrastructure/accountManagementWrites';
type CodeDraft = {
    code: string;
    name: string;
    groupId: string;
};
type GroupDraft = {
    name: string;
    type: AccountGroup['type'];
    plLine: NonNullable<AccountGroup['plLine']> | '';
};
type DraftSession = {
    kind: 'code';
    id: string;
    planId: string;
    draft: CodeDraft;
    submitted?: AccountCode;
    unknown: boolean;
} | {
    kind: 'group';
    id: string;
    planId: string;
    draft: GroupDraft;
    submitted?: AccountGroup;
    unknown: boolean;
};
type DeleteSession = {
    kind: 'code' | 'group';
    id: string;
    planId: string;
    name: string;
    unknown: boolean;
};
export interface AccountLifecycleUnknown {
    operationId: string;
    companyId: CompanyId;
    actorUid: string;
    kind: 'create-code' | 'create-group' | 'delete-code' | 'delete-group';
    targetId: string;
    name: string;
    submitted: Readonly<AccountCode | AccountGroup> | null;
    message: string;
}
export interface AccountManagementLifecycleOptions {
    companyId: CompanyId;
    actorUid?: string;
    onAddCode?: (data: AccountCode, context: AccountOperationContext) => Promise<SaveOutcome>;
    onAddGroup?: (data: AccountGroup, context: AccountOperationContext) => Promise<SaveOutcome>;
    onDeleteCode?: (opening: AccountCode, context: AccountOperationContext) => Promise<SaveOutcome>;
    onDeleteGroup?: (opening: AccountGroup, context: AccountOperationContext) => Promise<SaveOutcome>;
    isOtherBusy?: () => boolean;
    onReadAccountOperations?: (context: AccountEditContext) => Promise<AccountOperationReferenceEntry[]>;
    onInspectAccountOperation?: (reference: AccountManagementReference, context: AccountEditContext) => Promise<SaveOutcome>;
    onRetryAccountOperation?: (reference: AccountManagementReference, context: AccountEditContext) => Promise<SaveOutcome>;
    onDiscardAccountOperationCopy?: (reference: AccountManagementReference, observedLocalText: string, context: AccountEditContext) => Promise<SaveOutcome>;
    onCancelAccountOperation?: (reference: AccountManagementReference, context: AccountEditContext) => Promise<SaveOutcome>;
}
export function useAccountManagementLifecycle(options: AccountManagementLifecycleOptions) {
    const [, render] = useReducer((n: number) => n + 1, 0);
    const mounted = useRef(true);
    const makeOwner = () => ({ companyId: options.companyId, actorUid: options.actorUid, draft: null as DraftSession | null,
        deletion: null as DeleteSession | null, task: null as object | null, error: '', message: '', references: [] as AccountOperationReferenceEntry[], readError: '', readGeneration: 0 });
    const owner = useRef(makeOwner());
    const unknowns = useRef(new Map<string, AccountLifecycleUnknown>());
    if (owner.current.companyId !== options.companyId || owner.current.actorUid !== options.actorUid)
        owner.current = makeOwner();
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const refresh = () => {
        if (mounted.current)
            render();
    };
    const isBusy = () => !!owner.current.task;
    const locked = () => isBusy() || !!options.isOtherBusy?.();
    const newCode = () => {
        if (locked())
            return false;
        owner.current.draft = { kind: 'code', id: `ac-${crypto.randomUUID()}`, planId: crypto.randomUUID(), draft: { code: '', name: '', groupId: '' }, unknown: false };
        owner.current.error = '';
        refresh();
        return true;
    };
    const newGroup = () => {
        if (locked())
            return false;
        owner.current.draft = { kind: 'group', id: `ag-${crypto.randomUUID()}`, planId: crypto.randomUUID(), draft: { name: '', type: '수익', plLine: '' }, unknown: false };
        owner.current.error = '';
        refresh();
        return true;
    };
    const changeCode = (patch: Partial<CodeDraft>) => {
        const session = owner.current.draft;
        if (locked() || session?.kind !== 'code' || session.unknown)
            return;
        for (const key of ['code', 'name', 'groupId'] as const)
            if (patch[key] !== undefined)
                session.draft = { ...session.draft, [key]: patch[key] };
        owner.current.error = '';
        refresh();
    };
    const changeGroup = (patch: Partial<GroupDraft>) => {
        const session = owner.current.draft;
        if (locked() || session?.kind !== 'group' || session.unknown)
            return;
        for (const key of ['name', 'type', 'plLine'] as const)
            if (patch[key] !== undefined)
                session.draft = { ...session.draft, [key]: patch[key] };
        owner.current.error = '';
        refresh();
    };
    const closeDraft = () => { owner.current.draft = null; owner.current.task = null; owner.current.error = ''; refresh(); };
    const closeDelete = () => { owner.current.deletion = null; owner.current.task = null; owner.current.error = ''; refresh(); };
    const begin = (session: DraftSession | DeleteSession) => {
        const captured = owner.current;
        if (locked() || !captured.actorUid || auth.currentUser?.uid !== captured.actorUid)
            return null;
        const task = {};
        captured.task = task;
        captured.error = '';
        captured.message = '';
        refresh();
        const context: AccountOperationContext = { companyId: captured.companyId, actorUid: captured.actorUid, planId: session.planId,
            isCurrent: () => mounted.current && owner.current === captured && captured.task === task
                && (captured.draft === session || captured.deletion === session) && auth.currentUser?.uid === captured.actorUid };
        return { captured, task, context };
    };
    const execute = async (session: DraftSession | DeleteSession, call: (context: AccountOperationContext) => Promise<SaveOutcome>, deleting: boolean) => {
        const run = begin(session);
        if (!run)
            return false;
        const operationId = crypto.randomUUID();
        const retainUnknown = () => {
            if (!mounted.current || options.onReadAccountOperations)
                return;
            const submitted = 'submitted' in session && session.submitted ? Object.freeze({ ...session.submitted }) : null;
            unknowns.current.set(operationId, {
                operationId, companyId: run.captured.companyId, actorUid: run.captured.actorUid!,
                kind: deleting ? session.kind === 'code' ? 'delete-code' : 'delete-group' : session.kind === 'code' ? 'create-code' : 'create-group',
                targetId: session.id, name: submitted?.name ?? ('name' in session ? session.name : session.draft.name), submitted,
                message: deleting ? '삭제 여부를 확인하지 못했습니다. 현재 목록을 확인해 주세요. 같은 삭제를 자동으로 다시 보내지 않습니다.'
                    : '등록 여부를 확인하지 못했습니다. 현재 목록을 확인해 주세요. 새 작성은 별도 등록이며, 이전 요청도 반영돼 두 건이 생길 수 있습니다.'
            });
            refresh();
        };
        try {
            const outcome = await call(run.context);
            const committed = primaryCommitted(outcome, session.id);
            if (!committed && (outcome.status === 'unknown' || outcome.status === 'partial'))
                retainUnknown();
            if (!run.context.isCurrent())
                return false;
            if (committed) {
                run.captured.message = saveOutcomeMessage(outcome);
                if (deleting)
                    run.captured.deletion = null;
                else
                    run.captured.draft = null;
                return true;
            }
            if (outcome.status === 'unknown' || outcome.status === 'partial')
                session.unknown = true;
            run.captured.error = saveOutcomeMessage(outcome);
            return false;
        }
        catch (error) {
            retainUnknown();
            if (run.context.isCurrent()) {
                session.unknown = true;
                run.captured.error = `처리 결과를 확인하지 못했습니다. ${error instanceof Error ? error.message : String(error)}\n현재 목록을 확인해 주세요. 같은 요청을 자동으로 다시 보내지 않습니다.`;
            }
            return false;
        }
        finally {
            if (owner.current === run.captured) {
                if (run.captured.task === run.task) {
                    run.captured.task = null;
                    refresh();
                }
                await refreshOperations();
            }
        }
    };
    const save = async () => {
        const session = owner.current.draft;
        if (!session || session.unknown || locked())
            return false;
        const connected = session.kind === 'code' ? options.onAddCode : options.onAddGroup;
        if (!connected) {
            owner.current.error = '이 화면에는 계정 등록 기능이 연결되지 않았습니다.';
            refresh();
            return false;
        }
        if (!session.draft.name.trim() || session.kind === 'code' && !session.draft.code.trim()) {
            owner.current.error = session.kind === 'code' ? '코드와 계정명을 입력해 주세요.' : '그룹명을 입력해 주세요.';
            refresh();
            return false;
        }
        if (session.kind === 'group' && ['수익', '비용'].includes(session.draft.type) && !session.draft.plLine) {
            owner.current.error = '손익 줄을 골라 주세요. 안 고르면 손익계산서 어디에 설지 몰라 비용은 전부 매출원가로 떨어집니다.';
            refresh();
            return false;
        }
        if (session.kind === 'code') {
            const data: AccountCode = { id: session.id, code: session.draft.code.trim(), name: session.draft.name.trim(), ...(session.draft.groupId ? { groupId: session.draft.groupId } : {}) };
            session.submitted = Object.freeze({ ...data });
            return execute(session, context => options.onAddCode!(data, context), false);
        }
        const data: AccountGroup = { id: session.id, name: session.draft.name.trim(), type: session.draft.type, ...(session.draft.plLine ? { plLine: session.draft.plLine } : {}) };
        session.submitted = Object.freeze({ ...data });
        return execute(session, context => options.onAddGroup!(data, context), false);
    };
    const remove = async (kind: 'code' | 'group', row: AccountCode | AccountGroup) => {
        if (locked())
            return false;
        const captured = owner.current;
        const connected = kind === 'code' ? options.onDeleteCode : options.onDeleteGroup;
        if (!connected) {
            captured.error = '이 화면에는 계정 삭제 기능이 연결되지 않았습니다.';
            refresh();
            return false;
        }
        if (captured.deletion?.kind === kind && captured.deletion.id === row.id && captured.deletion.unknown)
            return false;
        const session: DeleteSession = { kind, id: row.id, planId: crypto.randomUUID(), name: row.name, unknown: false };
        captured.deletion = session;
        return execute(session, context => kind === 'code' ? options.onDeleteCode!({ ...row } as AccountCode, context) : options.onDeleteGroup!({ ...row } as AccountGroup, context), true);
    };
    const refreshOperations = async () => {
        const captured = owner.current;
        if (!options.onReadAccountOperations || !captured.actorUid)
            return;
        const generation = ++captured.readGeneration;
        const context: AccountEditContext = { companyId: captured.companyId, actorUid: captured.actorUid,
            isCurrent: () => mounted.current && owner.current === captured && captured.readGeneration === generation && auth.currentUser?.uid === captured.actorUid };
        try {
            const entries = await options.onReadAccountOperations(context);
            if (context.isCurrent()) {
                captured.references = entries;
                captured.readError = '';
                refresh();
            }
        }
        catch {
            if (context.isCurrent()) {
                captured.readError = '보관된 계정 요청을 읽지 못했습니다. 브라우저 저장소를 확인한 뒤 다시 불러와 주세요.';
                refresh();
            }
        }
    };
    useEffect(() => { void refreshOperations(); }, [options.companyId, options.actorUid]);
    const recover = async (reference: AccountManagementReference, mode: 'inspect' | 'retry' | 'cancel' | 'discard', observedLocalText?: string) => {
        const captured = owner.current;
        if (locked() || !captured.actorUid || reference.companyId !== captured.companyId || auth.currentUser?.uid !== captured.actorUid)
            return false;
        const callback = mode === 'discard' ? options.onDiscardAccountOperationCopy ? (ref: AccountManagementReference, context: AccountEditContext) => options.onDiscardAccountOperationCopy!(ref, observedLocalText!, context) : undefined : mode === 'inspect' ? options.onInspectAccountOperation : mode === 'retry' ? options.onRetryAccountOperation : options.onCancelAccountOperation;
        if (!callback) {
            captured.error = '이 화면에는 요청 복구 기능이 연결되지 않았습니다.';
            refresh();
            return false;
        }
        const task = {};
        captured.task = task;
        captured.error = '';
        refresh();
        const context: AccountEditContext = { companyId: captured.companyId, actorUid: captured.actorUid,
            isCurrent: () => mounted.current && owner.current === captured && captured.task === task && auth.currentUser?.uid === captured.actorUid };
        try {
            const outcome = await callback({ ...reference }, context);
            if (!context.isCurrent())
                return false;
            if (mode === 'discard') {
                if (outcome.status === 'saved')
                    captured.message = '이 기기에 보관된 사본만 정리했습니다. 이미 처리된 업무는 취소하거나 변경하지 않았습니다.';
                else
                    captured.error = saveOutcomeMessage(outcome);
                return outcome.status === 'saved';
            }
            if (primaryCommitted(outcome, reference.targetId) || outcome.status === 'cancelled') {
                const same = (session: DraftSession | DeleteSession | null) => session?.kind === reference.kind
                    && session.id === reference.targetId && session.planId === reference.planId;
                if (same(captured.draft)) captured.draft = null;
                if (same(captured.deletion)) captured.deletion = null;
            }
            if (primaryCommitted(outcome, reference.targetId)) {
                captured.message = outcome.status === 'saved' ? '이 요청의 처리 완료를 확인했습니다. 현재 목록을 다시 확인해 주세요.' : saveOutcomeMessage(outcome);
            }
            else
                captured.error = saveOutcomeMessage(outcome);
            return primaryCommitted(outcome, reference.targetId);
        }
        catch {
            if (context.isCurrent())
                captured.error = '계정 요청의 결과를 확인하지 못했습니다. 같은 요청의 결과 확인 또는 중단을 선택해 주세요.';
            return false;
        }
        finally {
            if (owner.current === captured && captured.task === task) {
                captured.task = null;
                refresh();
                await refreshOperations();
            }
        }
    };
    const current = owner.current, session = current.draft;
    const connected = session?.kind === 'code' ? !!options.onAddCode : !!options.onAddGroup;
    const blockedReason = !connected && session ? '이 화면에는 계정 등록 기능이 연결되지 않았습니다.'
        : !current.actorUid || auth.currentUser?.uid !== current.actorUid ? '로그인 계정이 바뀌었습니다. 현재 계정에서 다시 열어 주세요.' : '';
    return {
        unknownOperations: Array.from(unknowns.current.values()).filter(record => record.companyId === options.companyId && record.actorUid === options.actorUid),
        codeSession: session?.kind === 'code' ? { ...session, busy: !!current.task } : null,
        groupSession: session?.kind === 'group' ? { ...session, busy: !!current.task } : null,
        deleteSession: current.deletion ? { ...current.deletion, busy: !!current.task } : null,
        operationReferences: current.references, refreshOperations, inspectOperation: (ref: AccountManagementReference) => recover(ref, 'inspect'), retryOperation: (ref: AccountManagementReference) => recover(ref, 'retry'), cancelOperation: (ref: AccountManagementReference) => recover(ref, 'cancel'), discardOperation: (ref: AccountManagementReference, text: string) => recover(ref, 'discard', text),
        busy: !!current.task, isBusy, error: current.error || current.readError, message: current.message, blockedReason,
        unknownNotice: session?.unknown ? '현재 목록을 확인해 주세요. 새 작성은 별도 등록이며 이전 요청이 저장되지 않았다는 뜻은 아닙니다. 두 요청이 모두 반영될 수 있습니다.' : '',
        canSave: !!session && !session.unknown && !locked() && !blockedReason,
        newCode, newGroup, changeCode, changeGroup, save, closeDraft, closeDelete,
        deleteCode: (row: AccountCode) => remove('code', row), deleteGroup: (row: AccountGroup) => remove('group', row)
    };
}
