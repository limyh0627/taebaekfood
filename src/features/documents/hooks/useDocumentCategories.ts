import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { auth } from '../../../shared/firebase';
import { appConfirm } from '../../../shared/components/appDialog';
import { saveOutcomeMessage } from '../../../shared/saveOutcome';
import { documentCategoryOpening, serializeDocumentCategoryRequest, type DocumentCategoryReference, type DocumentCategoryRequest, type DocumentCategoryResult } from '../../../shared/documentCategoryCommand';
import type { CabinetCategory, CabinetSubCategory, CompanyId } from '../../../shared/types';
import { documentCategoryWrites, type DocumentCategoryEntry, type DocumentCategoryObservation } from '../infrastructure/documentCategoryWrites';
type Scope = {
    companyId: CompanyId;
    actorUid: string;
    employeeId: string;
};
interface Draft {
    id: string;
    planId: string;
    name: string;
    request?: DocumentCategoryRequest;
}
interface Owner {
    companyId: CompanyId;
    actorUid?: string;
    employeeId: string;
    lock: boolean;
    cat: Draft;
    sub: Draft;
    addingCat: boolean;
    addingSub: boolean;
    boots: Map<string, 'pending' | 'done'>;
    selectionAck?: {
        category: string;
        subCategory: string;
    };
}
export interface DocumentCategoryOperation {
    id: string;
    reference: DocumentCategoryReference | null;
    observedLocalText: string | null;
    description: string;
    message: string;
    serverStatus?: DocumentCategoryResult['status'];
    busy: boolean;
    canInspect: boolean;
    canRetry: boolean;
    canCancel: boolean;
    canDiscard: boolean;
    serverOnly: boolean;
}
type StoredOperation = DocumentCategoryOperation & {
    scope: Scope;
    entry?: DocumentCategoryEntry;
    request?: DocumentCategoryRequest;
};
export interface DocumentCategoriesOptions {
    companyId: CompanyId;
    actorUid?: string;
    employeeId: string;
    categories: CabinetCategory[];
    subCategories: CabinetSubCategory[];
    docCountByCat?: ReadonlyMap<string, number>;
    docCountBySub?: ReadonlyMap<string, number>;
    seed?: readonly {
        category: string;
        subCategory: string;
    }[];
    writes?: typeof documentCategoryWrites;
    confirm?: (message: string) => Promise<boolean>;
}
const draft = (): Draft => ({ id: crypto.randomUUID(), planId: crypto.randomUUID(), name: '' });
const same = (a: DocumentCategoryReference | null, b: DocumentCategoryReference | null) => !!a && !!b && a.companyId === b.companyId && a.planId === b.planId;
export function useDocumentCategories(options: DocumentCategoriesOptions) {
    const [, repaint] = useReducer(n => n + 1, 0), [active, setActive] = useState({ category: '', subCategory: '' });
    const [message, setMessage] = useState(''), [readError, setReadError] = useState(''), [readLoading, setReadLoading] = useState(true);
    const [historyError, setHistoryError] = useState(''), [historyLoading, setHistoryLoading] = useState(false), [historyMore, setHistoryMore] = useState(false);
    const [readRevision, setReadRevision] = useState(0);
    const mounted = useRef(true), readGeneration = useRef(0), operations = useRef(new Map<string, StoredOperation>());
    const owner = useRef<Owner>({ companyId: options.companyId, actorUid: options.actorUid, employeeId: options.employeeId, lock: false, cat: draft(), sub: draft(), addingCat: false, addingSub: false, boots: new Map() });
    if (owner.current.companyId !== options.companyId || owner.current.actorUid !== options.actorUid || owner.current.employeeId !== options.employeeId) {
        const previous = owner.current;
        owner.current = { companyId: options.companyId, actorUid: options.actorUid, employeeId: options.employeeId, lock: false, cat: draft(), sub: draft(), addingCat: previous.addingCat, addingSub: previous.addingSub, boots: new Map() };
    }
    const token = owner.current, readyOwner = useRef<Owner | null>(null), confirming = useRef<Owner | null>(null);
    const cursor = useRef<string | null>(null), historyLock = useRef<object | null>(null), latest = useRef(options);
    latest.current = options;
    const writes = options.writes ?? documentCategoryWrites;
    const current = (captured = token) => mounted.current && owner.current === captured && !!captured.actorUid && auth.currentUser?.uid === captured.actorUid;
    const scopeOf = (captured: Owner): Scope => ({ companyId: captured.companyId, actorUid: captured.actorUid!, employeeId: captured.employeeId });
    const visible = (row: StoredOperation) => auth.currentUser?.uid === options.actorUid && row.scope.companyId === options.companyId && row.scope.actorUid === options.actorUid && row.scope.employeeId === options.employeeId;
    const force = () => { if (mounted.current)
        repaint(); };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; readGeneration.current++; }; }, []);
    const fromEntry = (entry: DocumentCategoryEntry, scope: Scope): StoredOperation => ({ id: entry.key, reference: entry.reference, observedLocalText: entry.observedLocalText,
        description: entry.description, message: '같은 요청의 서버 결과를 확인해 주세요.', busy: false, canInspect: !!entry.reference, canRetry: entry.readable,
        canCancel: !!entry.reference, canDiscard: entry.hasLocalCopy, serverOnly: false, scope, entry, request: entry.request });
    const finishDraft = (reference: DocumentCategoryReference, observation: DocumentCategoryObservation, matchedRequest?: DocumentCategoryRequest) => {
        if (observation.copyMismatch || observation.cleanupFailed || observation.outcome.status === 'unknown')
            return;
        for (const kind of ['cat', 'sub'] as const) {
            const activeDraft = token[kind];
            if (!same(activeDraft.request?.reference ?? null, reference))
                continue;
            const opaqueStopped = observation.outcome.status === 'cancelled' && observation.result.requestHash === null;
            if (!opaqueStopped && (!activeDraft.request || !matchedRequest || serializeDocumentCategoryRequest(activeDraft.request) !== serializeDocumentCategoryRequest(matchedRequest)))
                continue;
            if (observation.outcome.status === 'saved' || observation.outcome.status === 'cancelled') {
                if (kind === 'cat') {
                    token.addingCat = false;
                    if (observation.outcome.status === 'saved') {
                        token.selectionAck = { category: activeDraft.name.trim(), subCategory: '' };
                        setActive(token.selectionAck);
                    }
                }
                else {
                    token.addingSub = false;
                    if (observation.outcome.status === 'saved' && activeDraft.request?.action === 'createSubCategory') {
                        token.selectionAck = { category: activeDraft.request.category, subCategory: activeDraft.name.trim() };
                        setActive(token.selectionAck);
                    }
                }
                token[kind] = draft();
            }
            else if (observation.outcome.status === 'rejected') {
                activeDraft.request = undefined;
                activeDraft.planId = crypto.randomUUID();
            }
        }
    };
    const applyObservation = async (row: StoredOperation, observation: DocumentCategoryObservation) => {
        if (!current())
            return;
        row.serverStatus = observation.result.status;
        row.message = observation.outcome.status === 'saved' ? observation.result.message : saveOutcomeMessage(observation.outcome);
        row.canCancel = observation.result.status === 'unknown';
        if (row.serverOnly) {
            row.canRetry = false;
            row.canDiscard = false;
            setMessage(row.message);
            return;
        }
        const entry = await writes.read(row.scope, row.reference!);
        if (!current())
            return;
        // 표시와 명시 정리 입력은 하나의 관측 원문을 공유한다.
        row.entry = entry;
        row.description = entry.hasLocalCopy ? entry.description : row.description;
        // 사본이 교체돼도 현재 작성한 다른 원문을 그 결과로 닫지 않는다.
        const matchedRequest = observation.request;
        if (matchedRequest && (['cat', 'sub'] as const).some(kind => same(token[kind].request?.reference ?? null, row.reference) && serializeDocumentCategoryRequest(token[kind].request!) !== serializeDocumentCategoryRequest(matchedRequest))) {
            row.message += '\n현재 작성한 원문과 다른 내용의 처리 결과입니다. 현재 입력을 저장 완료로 처리하지 않았습니다. 추가 창을 닫고 새 요청으로 작성해 주세요.';
        }
        row.observedLocalText = entry.hasLocalCopy ? entry.observedLocalText : null;
        row.canRetry = !!entry.readable && observation.result.status === 'unknown' && !observation.copyMismatch;
        row.canDiscard = entry.hasLocalCopy;
        if (!observation.copyMismatch && observation.result.status !== 'unknown') {
            const request = row.request;
            if (request?.action === 'seedDefaults')
                token.boots.set('defaults', 'done');
            if (request?.action === 'ensurePath')
                token.boots.set(JSON.stringify([request.category, request.subCategory]), 'done');
            finishDraft(row.reference!, observation, matchedRequest);
            if (!observation.cleanupFailed)
                operations.current.delete(row.id);
        }
        setMessage(row.message);
    };
    const recover = async (id: string, mode: 'inspect' | 'apply' | 'cancel') => {
        if (!current() || token.lock)
            return;
        const row = operations.current.get(id);
        if (!row || !visible(row) || !row.reference || row.busy || mode === 'apply' && (row.serverOnly || !row.canRetry))
            return;
        token.lock = true;
        row.busy = true;
        force();
        try {
            await applyObservation(row, await writes.command(row.scope, row.reference, mode, () => current(token), row.observedLocalText ?? undefined));
        }
        catch (error) {
            if (current(token)) {
                row.message = `${error instanceof Error ? error.message : '처리 결과를 확인하지 못했습니다.'}\n같은 요청의 결과 확인 또는 미처리 요청 중단을 선택해 주세요.`;
                setMessage(row.message);
            }
        }
        finally {
            row.busy = false;
            if (current(token)) {
                token.lock = false;
                force();
            }
        }
    };
    const execute = async (request: DocumentCategoryRequest, description: string) => {
        if (!current() || token.lock)
            return;
        token.lock = true;
        force();
        let submitted = false;
        try {
            const scope = scopeOf(token), entry = await writes.prepare(scope, request, description, () => current(token));
            if (!current(token))
                return;
            const row = fromEntry(entry, scope);
            row.busy = true;
            operations.current.set(row.id, row);
            force();
            try {
                submitted = true;
                await applyObservation(row, await writes.command(scope, request.reference, 'apply', () => current(token), entry.observedLocalText));
            }
            finally {
                row.busy = false;
            }
        }
        catch (error) {
            if (!current(token))
                return;
            const cause = `${error instanceof Error ? error.message : '분류 요청을 준비하지 못했습니다.'}\n보관된 요청이 있으면 결과 확인을 먼저 선택해 주세요.`;
            if (!submitted) {
                try {
                    const entry = await writes.read(scopeOf(token), request.reference);
                    if (!current(token))
                        return;
                    if (entry.hasLocalCopy)
                        operations.current.set(entry.key, fromEntry(entry, scopeOf(token)));
                    else {
                        for (const kind of ['cat', 'sub'] as const)
                            if (same(token[kind].request?.reference ?? null, request.reference))
                                token[kind].request = undefined;
                        if (request.action === 'seedDefaults')
                            token.boots.delete('defaults');
                        if (request.action === 'ensurePath')
                            token.boots.delete(JSON.stringify([request.category, request.subCategory]));
                    }
                }
                catch { /* 보관소 읽기도 실패하면 원문이 없다고 추정하거나 같은 요청을 재생성하지 않는다. */ }
            }
            setMessage(cause);
        }
        finally {
            if (current(token)) {
                token.lock = false;
                force();
            }
        }
    };
    const history = async (reset: boolean) => {
        if (!current() || historyLock.current)
            return;
        const historyToken = {}, pageCursor = reset ? undefined : cursor.current ?? undefined;
        if (!reset && !pageCursor)
            return;
        historyLock.current = historyToken;
        setHistoryLoading(true);
        setHistoryError('');
        try {
            const scope = scopeOf(token), page = await writes.listPending(scope, pageCursor, () => current(token));
            if (!current(token) || historyLock.current !== historyToken)
                return;
            if (reset)
                for (const [id, row] of operations.current)
                    if (visible(row) && row.serverOnly && !row.busy)
                        operations.current.delete(id);
            for (const entry of page.entries) {
                if ([...operations.current.values()].some(row => visible(row) && same(row.reference, entry.result.reference)))
                    continue;
                const id = `server:${JSON.stringify([scope.companyId, scope.actorUid, scope.employeeId, entry.result.reference.planId])}`;
                operations.current.set(id, { id, scope, reference: entry.result.reference, observedLocalText: null, description: entry.label, message: entry.result.message,
                    serverStatus: entry.result.status, busy: false, canInspect: true, canRetry: false, canCancel: entry.result.status === 'unknown', canDiscard: false, serverOnly: true });
            }
            cursor.current = page.nextCursor;
            setHistoryMore(page.nextCursor !== null);
            setMessage(`이번 조회에서 서버 분류 요청 ${page.entries.length}건을 확인했습니다. ${page.nextCursor ? '더 확인할 요청이 있으니 다음 목록을 읽어 주세요.' : '목록에 없다는 이유로 미처리를 확정하지 않습니다.'}`);
            force();
        }
        catch (error) {
            if (current(token))
                setHistoryError(error instanceof Error ? error.message : '서버 분류 요청을 읽지 못했습니다.');
        }
        finally {
            if (current(token) && historyLock.current === historyToken) {
                historyLock.current = null;
                setHistoryLoading(false);
            }
        }
    };
    const refresh = async (includeHistory = true) => {
        if (!current())
            return;
        const turn = ++readGeneration.current;
        historyLock.current = null;
        cursor.current = null;
        setHistoryMore(false);
        setReadLoading(true);
        setReadError('');
        try {
            const scope = scopeOf(token), entries = await writes.list(scope);
            if (!current(token) || turn !== readGeneration.current)
                return;
            for (const [id, row] of operations.current)
                if (visible(row) && !row.serverOnly && !row.busy && !entries.some(entry => entry.key === id))
                    operations.current.delete(id);
            for (const entry of entries) {
                for (const [id, row] of operations.current)
                    if (visible(row) && row.serverOnly && same(row.reference, entry.reference))
                        operations.current.delete(id);
                if (!operations.current.get(entry.key)?.busy)
                    operations.current.set(entry.key, fromEntry(entry, scope));
            }
            force();
            for (const entry of entries)
                if (entry.reference && current(token))
                    await recover(entry.key, 'inspect');
            if (includeHistory && current(token))
                await history(true);
        }
        catch (error) {
            if (current(token) && turn === readGeneration.current)
                setReadError(error instanceof Error ? error.message : '보관된 분류 요청을 읽지 못했습니다.');
        }
        finally {
            if (current(token) && turn === readGeneration.current) {
                readyOwner.current = token;
                setReadLoading(false);
                setReadRevision(value => value + 1);
            }
        }
    };
    useEffect(() => { confirming.current = null; historyLock.current = null; cursor.current = null; setReadError(''); setHistoryError(''); setHistoryMore(false); setMessage(''); setActive({ category: '', subCategory: '' }); void refresh(false); }, [options.companyId, options.actorUid, options.employeeId]);
    const sortedCats = useMemo(() => [...options.categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)), [options.categories]);
    useEffect(() => {
        if (!current())
            return;
        const ack = token.selectionAck;
        if (ack && active.category === ack.category && active.subCategory === ack.subCategory) {
            // 업무 ACK보다 구독 행이 늦어도 방금 저장한 선택을 옛 목록으로 되돌리지 않는다.
            if (!sortedCats.some(row => row.name === ack.category) || ack.subCategory && !options.subCategories.some(row => row.category === ack.category && row.name === ack.subCategory))
                return;
            token.selectionAck = undefined;
        }
        if (!sortedCats.some(row => row.name === active.category)) {
            const next = sortedCats[0]?.name ?? '';
            if (active.category !== next || active.subCategory)
                setActive({ category: next, subCategory: '' });
        }
        else if (active.subCategory && !options.subCategories.some(row => row.category === active.category && row.name === active.subCategory))
            setActive(previous => ({ ...previous, subCategory: '' }));
    }, [sortedCats, options.subCategories, active.category, active.subCategory]);
    const seedKey = JSON.stringify(options.seed ?? []);
    useEffect(() => {
        if (!current() || readyOwner.current !== token || readLoading || readError || token.lock)
            return;
        const boot = async () => {
            const submitBoot = async (intent: string, request: () => DocumentCategoryRequest, description: string) => {
                if (!current(token) || token.lock || token.boots.has(intent))
                    return;
                const existing = [...operations.current.values()].some(row => visible(row) && (intent === 'defaults' ? row.request?.action === 'seedDefaults' : row.request?.action === 'ensurePath' && JSON.stringify([row.request.category, row.request.subCategory]) === intent));
                if (existing) {
                    token.boots.set(intent, 'pending');
                    return;
                }
                token.boots.set(intent, 'pending');
                await execute(request(), description);
            };
            const reference = () => ({ companyId: token.companyId, planId: crypto.randomUUID() });
            if (!latest.current.categories.length)
                await submitBoot('defaults', () => ({ version: 1, reference: reference(), action: 'seedDefaults', categoryIds: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], createdAt: new Date().toISOString() }), '기본 대분류 준비');
            for (const path of latest.current.seed ?? [])
                await submitBoot(JSON.stringify([path.category, path.subCategory]), () => ({ version: 1, reference: reference(), action: 'ensurePath', categoryId: crypto.randomUUID(), subCategoryId: crypto.randomUUID(), category: path.category, subCategory: path.subCategory, createdAt: new Date().toISOString() }), `${path.category} > ${path.subCategory} 자리 준비`);
        };
        void boot();
    }, [readRevision, readLoading, readError, seedKey, options.categories.length, options.companyId, options.actorUid, options.employeeId]);
    const canWrite = () => current() && readyOwner.current === token && !readLoading && !readError && !token.lock;
    const add = async (kind: 'cat' | 'sub') => {
        if (!canWrite())
            return;
        const form = token[kind], name = form.name.trim();
        if (!name || form.request)
            return;
        if (kind === 'cat' ? latest.current.categories.some(row => row.name === name) : latest.current.subCategories.some(row => row.category === active.category && row.name === name)) {
            setMessage('이미 있는 분류입니다.');
            return;
        }
        if (kind === 'sub' && !active.category) {
            setMessage('먼저 대분류를 선택하세요.');
            return;
        }
        const base = { version: 1 as const, reference: { companyId: token.companyId, planId: form.planId }, name, createdAt: new Date().toISOString() };
        const request: DocumentCategoryRequest = kind === 'cat' ? { ...base, action: 'createCategory', categoryId: form.id, order: latest.current.categories.length }
            : { ...base, action: 'createSubCategory', subCategoryId: form.id, category: active.category, order: latest.current.subCategories.filter(row => row.category === active.category).length };
        form.request = request;
        await execute(request, `${kind === 'cat' ? '대분류' : '중분류'} ${name} 추가`);
    };
    const remove = async (row: CabinetCategory | CabinetSubCategory, kind: 'category' | 'subCategory') => {
        if (!canWrite())
            return;
        const frozen = { ...row }, confirmation = token;
        token.lock = true;
        confirming.current = token;
        force();
        try {
            if (kind === 'category' && ((latest.current.docCountByCat?.get(frozen.name) ?? 0) > 0 || latest.current.subCategories.some(sub => sub.category === frozen.name))) {
                setMessage('파일 또는 중분류가 있어 삭제할 수 없습니다.');
                return;
            }
            if (kind === 'subCategory' && (latest.current.docCountBySub?.get(`${(frozen as CabinetSubCategory).category}|${frozen.name}`) ?? 0) > 0) {
                setMessage('파일이 있어 삭제할 수 없습니다.');
                return;
            }
            if (!await (options.confirm ?? appConfirm)(`${kind === 'category' ? '대분류' : '중분류'} "${frozen.name}"을(를) 삭제할까요?`) || !current(token))
                return;
            const request: DocumentCategoryRequest = { version: 1, reference: { companyId: token.companyId, planId: crypto.randomUUID() }, action: kind === 'category' ? 'deleteCategory' : 'deleteSubCategory', targetId: frozen.id, opening: documentCategoryOpening(frozen, kind) };
            token.lock = false;
            confirming.current = null;
            await execute(request, `${frozen.name} 삭제`);
        }
        catch (error) {
            if (current(token))
                setMessage(error instanceof Error ? error.message : '분류 삭제 확인을 완료하지 못했습니다.');
        }
        finally {
            if (current(confirmation)) {
                token.lock = false;
                confirming.current = null;
                force();
            }
        }
    };
    const discard = async (id: string, raw: string) => {
        if (!current() || token.lock)
            return;
        const row = operations.current.get(id);
        if (!row || !visible(row) || row.busy)
            return;
        token.lock = true;
        row.busy = true;
        force();
        try {
            const result = await writes.discard(row.scope, row.reference, raw, () => current(token), row.entry?.key);
            if (!current(token))
                return;
            setMessage(result.message);
            if (result.status === 'cleared')
                operations.current.delete(id);
        }
        finally {
            row.busy = false;
            if (current(token)) {
                token.lock = false;
                force();
            }
        }
    };
    return { activeCat: readyOwner.current === token ? active.category : '', activeSub: readyOwner.current === token ? active.subCategory : '', sortedCats,
        selectCat: (name: string) => { if (current()) {
            token.selectionAck = undefined;
            token.addingSub = false;
            setActive({ category: name, subCategory: '' });
        } }, selectSub: (name: string) => { if (current()) {
            token.selectionAck = undefined;
            setActive(previous => ({ ...previous, subCategory: name }));
        } },
        addingCat: token.addingCat, addingSub: token.addingSub, newCatName: token.cat.name, newSubName: token.sub.name,
        categoryLocked: !canWrite() || !!token.cat.request, subCategoryLocked: !canWrite() || !!token.sub.request,
        openAddCategory: () => { if (canWrite()) {
            token.cat = draft();
            token.addingCat = true;
            force();
        } }, openAddSubCategory: () => { if (canWrite()) {
            token.sub = draft();
            token.addingSub = true;
            force();
        } },
        changeCategoryName: (name: string) => { if (canWrite() && !token.cat.request) {
            token.cat.name = name;
            force();
        } }, changeSubName: (name: string) => { if (canWrite() && !token.sub.request) {
            token.sub.name = name;
            force();
        } },
        cancelAddCategory: () => { if (current() && !token.lock) {
            token.addingCat = false;
            token.cat = draft();
            force();
        } }, cancelAddSubCategory: () => { if (current() && !token.lock) {
            token.addingSub = false;
            token.sub = draft();
            force();
        } },
        addCategory: () => add('cat'), addSubCategory: () => add('sub'), deleteCategory: (row: CabinetCategory) => remove(row, 'category'), deleteSubCategory: (row: CabinetSubCategory) => remove(row, 'subCategory'),
        busy: current() && token.lock, confirmationBusy: current() && confirming.current === token,
        message: readyOwner.current === token ? message : '', readError: readyOwner.current === token ? readError : '', readLoading: readyOwner.current !== token || readLoading,
        operations: [...operations.current.values()].filter(visible).map(row => ({ ...row })), historyLoading, historyError: readyOwner.current === token ? historyError : '', historyMore: readyOwner.current === token && historyMore,
        refresh: () => refresh(), nextPage: () => history(false), inspect: (id: string) => recover(id, 'inspect'), retry: (id: string) => recover(id, 'apply'), cancel: (id: string) => recover(id, 'cancel'), discard };
}
