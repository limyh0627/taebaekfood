import { useEffect, useReducer, useRef, useState } from 'react';
import type { CabinetDoc, CompanyId } from '../../../shared/types';
import { auth } from '../../../shared/firebase';
import { appConfirm, appPrompt } from '../../../shared/components/appDialog';
import { documentMetadataOpening, documentUploadPath, type DocumentMetadataReference, type DocumentMetadataRequest, type DocumentMetadataResult } from '../../../shared/documentMetadataCommand';
import { createDocumentTransferPort, documentFileSha256, assertDocumentFileIdentity, isDocumentTransferNotStarted } from '../infrastructure/documentTransfers';
import { documentMetadataWrites, type DocumentMetadataEntry, type DocumentMetadataObservation } from '../infrastructure/documentMetadataWrites';
type Scope = {
    companyId: CompanyId;
    actorUid: string;
    employeeId: string;
};
export interface DocumentTransferJob {
    jobId: string;
    companyId: CompanyId;
    actorUid: string;
    employeeId: string;
    documentId: string;
    fileName: string;
    category: string;
    subCategory: string;
    kind: 'upload' | 'delete' | 'note';
    stage: 'prepare' | 'reserve' | 'upload' | 'metadata' | 'cleanup' | 'unknown' | 'terminal';
    busy: boolean;
    message: string;
    canRetry: boolean;
    canInspect: boolean;
    canCancel: boolean;
    canDiscard: boolean;
    requiresFile: boolean;
    reference: DocumentMetadataReference | null;
    observedLocalText: string | null;
    serverResult?: DocumentMetadataResult;
    metadataStatus?: DocumentMetadataResult['status'];
    uploadStatus?: DocumentMetadataResult['uploadStatus'];
    cleanupStatus?: DocumentMetadataResult['cleanupStatus'];
}
type StoredJob = DocumentTransferJob & {
    scope: Scope;
    entry?: DocumentMetadataEntry;
    file?: File;
    serverOnly?: boolean;
};
export interface DocumentTransfersOptions {
    companyId: CompanyId;
    actorUid?: string;
    employeeId: string;
    uploadedBy: string;
    ports?: ReturnType<typeof createDocumentTransferPort>;
    metadata?: typeof documentMetadataWrites;
    confirm?: (message: string) => Promise<boolean>;
    prompt?: (message: string, value: string) => Promise<string | null>;
}
const terminal = (result?: DocumentMetadataResult) => !!result && ['applied', 'rejected', 'cancelled'].includes(result.status);
const cleanupPending = (result?: DocumentMetadataResult) => result?.cleanupStatus === 'pending';
const hasDocumentCopy = (job: StoredJob) => job.observedLocalText !== null || !!job.entry?.hasLocalCopy || !!job.entry?.readable;

export interface DocumentTransferDisplayRow {
    job: DocumentTransferJob;
    currentState: string;
    cause: string;
    nextAction: string;
}
// 원문 오류는 job에 보존하고 화면에는 업무 표현만 전달한다.
const documentDisplayText = (text: string) => text.replace(/서버\s*결과\s*[:：]\s*/g, '').trim();
function documentTransferDisplay(job: StoredJob): DocumentTransferDisplayRow {
    const result = job.serverResult;
    const cause = documentDisplayText(job.message);
    if (cleanupPending(result)) {
        const currentState = result?.status === 'rejected'
            ? '문서 요청이 거절됐고 남은 파일 정리가 필요합니다.'
            : result?.status === 'cancelled'
                ? '문서 요청을 중단했고 남은 파일 정리가 필요합니다.'
                : result?.status === 'applied'
                    ? '문서 처리는 끝났고 남은 파일 정리가 필요합니다.'
                    : '문서 처리 결과 확인과 남은 파일 정리가 필요합니다.';
        return {job, currentState, cause, nextAction: '남은 파일 정리만 다시 시도해 주세요. 문서 요청은 다시 보내지 않습니다.'};
    }
    if (job.busy)
        return {job, currentState: '문서 요청을 처리하고 있습니다.', cause: '처리 응답을 기다리고 있습니다.', nextAction: '잠시 기다려 주세요. 같은 요청을 다시 보내지 않습니다.'};
    if (terminal(result)) {
        const done = result?.status === 'applied' ? '문서 처리가 완료됐습니다.'
            : result?.status === 'rejected' ? '문서 요청이 거절됐습니다.' : '문서 요청을 중단했습니다.';
        return {job, currentState: !hasDocumentCopy(job) ? done : done + ' 이 기기에 남은 사본을 확인해 주세요.', cause,
            nextAction: !hasDocumentCopy(job) ? '필요하면 문서 목록에서 현재 내용을 확인해 주세요.' : '처리 결과와 원문을 확인한 뒤 이 기기 사본만 정리해 주세요.'};
    }
    if (!job.reference)
        return {job, currentState: '보관된 문서 요청을 식별하지 못했습니다.', cause,
            nextAction: '보관 원문과 현재 문서 목록을 직접 확인한 뒤 이 기기 사본만 명시적으로 정리해 주세요. 처리 여부나 중단은 확인하지 못했습니다.'};
    if (job.requiresFile)
        return {job, currentState: '문서 등록을 이어가려면 원본 파일이 필요합니다.', cause,
            nextAction: '처음 선택했던 같은 파일을 다시 선택해 주세요. 파일 내용을 확인한 뒤 이어갑니다.'};
    return {job, currentState: result?.status === 'active' ? '문서 요청이 아직 완료되지 않았습니다.' : '문서 요청의 처리 결과를 아직 확인하지 못했습니다.', cause,
        nextAction: job.serverOnly ? '결과를 확인하거나 미처리 요청을 중단해 주세요. 이 기기에 원문이 없어 등록을 다시 보내지는 않습니다.'
            : '같은 요청의 결과를 확인한 뒤 이어가거나 미처리 요청을 중단해 주세요.'};
}

export function useDocumentTransfers(options: DocumentTransfersOptions) {
    const [, render] = useReducer(n => n + 1, 0);
    const [readLoading, setReadLoading] = useState(true), [readError, setReadError] = useState('');
    const [confirmationBusy, setConfirmationBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [historyLoading, setHistoryLoading] = useState(false), [historyError, setHistoryError] = useState(''), [historyMore, setHistoryMore] = useState(false);
    const historyCursor = useRef<string | null>(null), historyLock = useRef<object | null>(null);
    const jobs = useRef(new Map<string, StoredJob>()), mounted = useRef(true), readTurn = useRef(0);
    const owner = useRef({ companyId: options.companyId, actorUid: options.actorUid, employeeId: options.employeeId });
    if (owner.current.companyId !== options.companyId || owner.current.actorUid !== options.actorUid || owner.current.employeeId !== options.employeeId)
        owner.current = { companyId: options.companyId, actorUid: options.actorUid, employeeId: options.employeeId };
    const renderOwner = owner.current, confirming = useRef<object | null>(null);
    const readOwner = useRef<typeof renderOwner | null>(null);
    const ports = options.ports ?? createDocumentTransferPort(), metadata = options.metadata ?? documentMetadataWrites;
    const current = (token = renderOwner) => mounted.current && owner.current === token && !!token.actorUid && auth.currentUser?.uid === token.actorUid;
    const visible = (job: StoredJob) => auth.currentUser?.uid === options.actorUid && job.scope.companyId === options.companyId && job.scope.actorUid === options.actorUid && job.scope.employeeId === options.employeeId;
    const repaint = () => {
        if (mounted.current)
            render();
    };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; readTurn.current++; }; }, []);
    const fromEntry = (entry: DocumentMetadataEntry, scope: Scope): StoredJob => {
        const request = entry.request, creation = request?.action === 'create' ? request : null;
        return { jobId: entry.key, scope, companyId: scope.companyId, actorUid: scope.actorUid, employeeId: scope.employeeId,
            documentId: entry.reference?.documentId ?? '식별 불가', fileName: creation?.metadata.fileName ?? entry.description,
            category: creation?.metadata.category ?? '', subCategory: creation?.metadata.subCategory ?? '',
            kind: request?.action === 'delete' ? 'delete' : request?.action === 'note' ? 'note' : 'upload', stage: 'unknown', busy: false,
            message: '서버의 처리 결과를 먼저 확인해 주세요.', canRetry: false, canInspect: !!entry.reference,
            canCancel: !!entry.reference, canDiscard: !!entry.readable || !!entry.hasLocalCopy, requiresFile: false, reference: entry.reference,
            observedLocalText: entry.observedLocalText, entry };
    };
    const present = async (job: StoredJob, observation: DocumentMetadataObservation) => {
        const result = observation.result;
        job.serverResult = result;
        job.metadataStatus = result.status;
        job.uploadStatus = result.uploadStatus;
        job.cleanupStatus = result.cleanupStatus;
        job.canCancel = !terminal(result);
        job.message = observation.message;
        if (job.reference) {
            const entry = await metadata.read(job.scope, job.reference);
            if (!current())
                return;
            if (!job.serverOnly) {
                // 새 관측을 정리 버튼에 쓰면 표시도 같은 관측으로 바꿔야 다른 사본을 지우지 않는다.
                if (!entry.readable || entry.requestHash !== job.entry?.requestHash)
                    job.file = undefined;
                const creation = entry.request?.action === 'create' ? entry.request : null;
                job.fileName = creation?.metadata.fileName ?? entry.description;
                job.category = creation?.metadata.category ?? '';
                job.subCategory = creation?.metadata.subCategory ?? '';
            }
            job.entry = entry;
            job.observedLocalText = entry.readable || entry.hasLocalCopy ? entry.observedLocalText : null;
        }
        if (!current())
            return;
        if (job.serverOnly) {
            job.stage = cleanupPending(result) ? 'cleanup' : terminal(result) ? 'terminal' : 'unknown';
            job.canRetry = cleanupPending(result);
            job.canDiscard = false;
            job.requiresFile = false;
            return;
        }
        if (cleanupPending(result)) {
            // 사본이 달라도 서버에 확정된 파일 정리는 같은 참조로만 이어간다. 업무 재전송은 없다.
            job.stage = 'cleanup';
            job.canRetry = true;
            job.requiresFile = false;
            job.canDiscard = false;
            return;
        }
        if (observation.copyMismatch || observation.cleanupFailed) {
            job.stage = 'terminal';
            job.canRetry = false;
            job.canDiscard = job.observedLocalText !== null;
            return;
        }
        if (terminal(result) && !cleanupPending(result)) {
            setMessage(result.message);
            jobs.current.delete(job.jobId);
            return;
        }
        job.stage = cleanupPending(result) ? 'cleanup' : result.status === 'active' && job.entry?.request?.action === 'create'
            ? result.uploadStatus === 'verified' ? 'metadata' : 'upload' : 'unknown';
        job.canRetry = cleanupPending(result) || !!job.entry?.readable && !terminal(result);
        job.requiresFile = job.stage === 'upload' && !job.file;
        job.canDiscard = terminal(result) && !cleanupPending(result);
    };
    const perform = async (jobId: string, action: 'inspect' | 'resume' | 'cancel' | 'cleanup', file?: File) => {
        if (!current())
            return;
        const job = jobs.current.get(jobId), token = renderOwner;
        if (!job || !visible(job) || job.busy || !job.reference)
            return;
        const ctx = { scope: job.scope, isCurrent: () => current(token) };
        job.busy = true;
        job.canRetry = false;
        repaint();
        try {
            // 예외를 부재로 추정하지 않고, 보관 원문의 재개는 서버 관측을 먼저 한다.
            let observation = await metadata.command(job.scope, job.reference, action === 'cancel' ? 'cancel' : action === 'cleanup' ? 'cleanup' : 'inspect', ctx.isCurrent);
            if (!ctx.isCurrent())
                return;
            await present(job, observation);
            if (action !== 'resume' || !jobs.current.has(jobId) || observation.copyMismatch || observation.cleanupFailed || terminal(observation.result))
                return;
            const request = job.entry?.request;
            if (!request || !job.entry?.readable)
                return;
            if (file && request.action === 'create') {
                await assertDocumentFileIdentity(file, request.upload);
                if (!ctx.isCurrent())
                    return;
                job.file = file;
            }
            if (request.action === 'create') {
                if (observation.result.status === 'unknown') {
                    observation = await metadata.command(job.scope, job.reference, 'reserveUpload', ctx.isCurrent);
                    if (!ctx.isCurrent())
                        return;
                    await present(job, observation);
                }
                if (observation.copyMismatch || terminal(observation.result) || observation.result.status !== 'active')
                    return;
                if (observation.result.uploadStatus !== 'verified') {
                    if (!['reserved', 'absent'].includes(observation.result.uploadStatus)) {
                        job.message = '업로드된 파일의 내용을 아직 확인하지 못했습니다. 결과 확인을 다시 선택해 주세요.';
                        return;
                    }
                    if (!job.file) {
                        job.requiresFile = true;
                        job.message = '처음 선택했던 같은 원본 파일을 다시 선택해 주세요. 내용·크기·형식을 확인한 뒤 이어갑니다.';
                        return;
                    }
                    job.stage = 'upload';
                    await ports.uploadReservedFile(job.file, request.upload, ctx);
                    if (!ctx.isCurrent())
                        return;
                    observation = await metadata.command(job.scope, job.reference, 'inspect', ctx.isCurrent);
                    if (!ctx.isCurrent())
                        return;
                    await present(job, observation);
                    if (observation.copyMismatch || observation.result.uploadStatus !== 'verified' || observation.result.status !== 'active')
                        return;
                }
            }
            if (!ctx.isCurrent())
                return;
            job.stage = 'metadata';
            await present(job, await metadata.command(job.scope, job.reference, 'apply', ctx.isCurrent));
        }
        catch (error) {
            job.stage = 'unknown';
            job.message = `${error instanceof Error ? error.message : '문서 처리 결과를 확인하지 못했습니다.'}\n같은 요청의 결과 확인을 선택해 주세요. 파일이나 문서 정보를 자동으로 다시 보내지 않습니다.`;
            job.canRetry = isDocumentTransferNotStarted(error);
        }
        finally {
            job.busy = false;
            if (current(token))
                repaint();
        }
    };
    const readHistory = async (reset: boolean) => {
        if (!current() || historyLock.current)
            return;
        const token = renderOwner, lock = {};
        historyLock.current = lock;
        setHistoryLoading(true);
        setHistoryError('');
        const cursor = reset ? undefined : historyCursor.current ?? undefined;
        if (!reset && !cursor) {
            historyLock.current = null;
            setHistoryLoading(false);
            return;
        }
        try {
            const scope: Scope = { companyId: token.companyId, actorUid: token.actorUid!, employeeId: token.employeeId };
            const page = await metadata.listPending(scope, cursor, () => current(token));
            if (!current(token) || historyLock.current !== lock)
                return;
            if (reset)
                for (const [id, job] of jobs.current)
                    if (visible(job) && job.serverOnly && !job.busy)
                        jobs.current.delete(id);
            for (const row of page.entries) {
                const reference = row.result.reference;
                const existing = [...jobs.current.values()].find(job => visible(job) && job.reference?.planId === reference.planId && job.reference.documentId === reference.documentId);
                if (existing)
                    continue;
                const jobId = `server:${JSON.stringify([scope.companyId, scope.actorUid, scope.employeeId, reference.documentId, reference.planId])}`;
                jobs.current.set(jobId, { jobId, scope, companyId: scope.companyId, actorUid: scope.actorUid, employeeId: scope.employeeId,
                    documentId: reference.documentId, fileName: row.label, category: '', subCategory: '', kind: 'upload',
                    stage: cleanupPending(row.result) ? 'cleanup' : 'unknown', busy: false, message: row.result.message,
                    canRetry: cleanupPending(row.result), canInspect: true, canCancel: !terminal(row.result), canDiscard: false, requiresFile: false,
                    reference, observedLocalText: null, serverOnly: true, serverResult: row.result, metadataStatus: row.result.status,
                    uploadStatus: row.result.uploadStatus, cleanupStatus: row.result.cleanupStatus });
            }
            historyCursor.current = page.nextCursor;
            setHistoryMore(page.nextCursor !== null);
            setMessage(`서버 문서 요청을 이번 조회에서 ${page.entries.length}건 확인했습니다. ${page.nextCursor ? '뒤에 확인할 요청이 더 있으니 다음 목록을 읽어 주세요.' : '목록에 없다는 이유로 미처리를 확정할 수 없습니다.'}`);
            repaint();
        }
        catch (error) {
            if (current(token))
                setHistoryError(error instanceof Error ? error.message : '서버 문서 요청 목록을 읽지 못했습니다.');
        }
        finally {
            if (current(token) && historyLock.current === lock) {
                historyLock.current = null;
                setHistoryLoading(false);
            }
        }
    };
    const refresh = async () => {
        if (!current())
            return;
        const token = renderOwner, turn = ++readTurn.current;
        historyLock.current = null;
        historyCursor.current = null;
        setHistoryMore(false);
        setReadLoading(true);
        setReadError('');
        try {
            const scope: Scope = { companyId: token.companyId, actorUid: token.actorUid!, employeeId: token.employeeId }, entries = await metadata.list(scope);
            if (!current(token) || turn !== readTurn.current)
                return;
            for (const [key, job] of jobs.current)
                if (visible(job) && !job.serverOnly && !job.busy && !entries.some(entry => entry.key === key))
                    jobs.current.delete(key);
            for (const entry of entries) {
                for (const [id, serverJob] of jobs.current)
                    if (visible(serverJob) && serverJob.serverOnly && entry.reference && serverJob.reference?.planId === entry.reference.planId && serverJob.reference.documentId === entry.reference.documentId)
                        jobs.current.delete(id);
                const old = jobs.current.get(entry.key);
                if (!old?.busy)
                    jobs.current.set(entry.key, { ...fromEntry(entry, scope), file: old?.file });
            }
            repaint();
            // 목록을 읽은 것만으로 적용을 추정하지 않는다. 후속 저장은 명시 이어하기만 허용한다.
            for (const entry of entries)
                if (entry.reference && current(token))
                    await perform(entry.key, 'inspect');
            if (current(token))
                await readHistory(true);
        }
        catch (error) {
            if (current(token) && turn === readTurn.current)
                setReadError(error instanceof Error ? error.message : '보관 문서 요청을 읽지 못했습니다.');
        }
        finally {
            if (current(token) && turn === readTurn.current) {
                readOwner.current = token;
                setReadLoading(false);
            }
        }
    };
    useEffect(() => { confirming.current = null; historyLock.current = null; historyCursor.current = null; setHistoryMore(false); setHistoryError(''); setHistoryLoading(false); setConfirmationBusy(false); setMessage(''); void refresh(); }, [options.companyId, options.actorUid, options.employeeId]);
    const startUploads = async (files: File[], category: string, subCategory: string) => {
        if (!current() || readOwner.current !== renderOwner || readLoading || readError)
            return;
        const token = renderOwner, scope: Scope = { companyId: token.companyId, actorUid: token.actorUid!, employeeId: token.employeeId };
        await Promise.all(files.map(async (file) => {
            if (!current(token))
                return;
            if (!category || !subCategory || file.size > 30 * 1024 * 1024) {
                setReadError('대분류·중분류와 30MB 이하 파일을 확인해 주세요.');
                return;
            }
            const reference = { companyId: scope.companyId, planId: crypto.randomUUID(), documentId: `doc-${crypto.randomUUID()}` }, uploadId = crypto.randomUUID();
            try {
                const sha256 = await documentFileSha256(file);
                if (!current(token))
                    return;
                const request: DocumentMetadataRequest = { version: 1, reference, action: 'create', metadata: { category, subCategory, fileName: file.name, note: '', uploadedBy: options.uploadedBy, uploadedAt: new Date().toISOString() },
                    upload: { uploadId, path: documentUploadPath(scope.companyId, uploadId, file.name), sha256, size: file.size, contentType: file.type || 'application/octet-stream' } };
                const entry = await metadata.prepare(scope, request, file.name, () => current(token));
                if (!current(token))
                    return;
                const job = { ...fromEntry(entry, scope), file };
                jobs.current.set(job.jobId, job);
                repaint();
                await perform(job.jobId, 'resume');
            }
            catch (error) {
                if (current(token)) {
                    await refresh();
                    if (current(token))
                        setMessage(error instanceof Error ? error.message : '파일 요청을 보관하지 못했습니다.');
                }
            }
        }));
    };
    const prepareExisting = async (document: CabinetDoc, action: 'delete' | 'note') => {
        if (!current() || confirming.current || readOwner.current !== renderOwner || readLoading || readError)
            return;
        const token = renderOwner, confirmation = {}, frozen = { ...document };
        confirming.current = confirmation;
        setConfirmationBusy(true);
        try {
            const note = action === 'note' ? await (options.prompt ?? appPrompt)('메모', frozen.note ?? '') : null;
            if (action === 'note' && note === null)
                return;
            if (action === 'delete' && !await (options.confirm ?? appConfirm)(`"${frozen.fileName}" 파일을 삭제할까요?`))
                return;
            if (!current(token) || frozen.companyId !== token.companyId)
                return;
            if ([...jobs.current.values()].some(job => visible(job) && job.documentId === frozen.id))
                return;
            const scope: Scope = { companyId: token.companyId, actorUid: token.actorUid!, employeeId: token.employeeId }, reference = { companyId: token.companyId, planId: crypto.randomUUID(), documentId: frozen.id };
            const opened = await metadata.open(scope, reference, documentMetadataOpening(frozen), () => current(token));
            if (!current(token))
                return;
            const request: DocumentMetadataRequest = action === 'delete' ? { version: 1, reference, action, expectedVersion: opened.expectedVersion } : { version: 1, reference, action, expectedVersion: opened.expectedVersion, note: note! };
            const entry = await metadata.prepare(scope, request, `${frozen.fileName} · ${action === 'delete' ? '삭제' : '메모'}`, () => current(token));
            if (!current(token))
                return;
            const job = fromEntry(entry, scope);
            job.fileName = frozen.fileName;
            jobs.current.set(job.jobId, job);
            repaint();
            await perform(job.jobId, 'resume');
        }
        catch (error) {
            if (current(token))
                setMessage(error instanceof Error ? error.message : '문서 원문을 준비하지 못했습니다.');
        }
        finally {
            if (current(token) && confirming.current === confirmation) {
                confirming.current = null;
                setConfirmationBusy(false);
            }
        }
    };
    const discardCopy = async (jobId: string, observedRaw?: string) => {
        if (!current())
            return;
        const job = jobs.current.get(jobId), token = renderOwner;
        if (!job || !visible(job) || job.busy || typeof (observedRaw ?? job.observedLocalText) !== 'string')
            return;
        job.busy = true;
        repaint();
        try {
            const result = await metadata.discard(job.scope, job.reference, (observedRaw ?? job.observedLocalText)!, () => current(token), job.entry?.key);
            if (!current(token))
                return;
            job.message = result.message;
            setMessage(result.message);
            if (result.status === 'cleared')
                jobs.current.delete(jobId);
        }
        finally {
            job.busy = false;
            if (current(token))
                repaint();
        }
    };
    const visibleJobs = [...jobs.current.values()].filter(visible);
    const needsAttention = (job: StoredJob) => cleanupPending(job.serverResult)
        || (terminal(job.serverResult) ? hasDocumentCopy(job) : job.serverOnly || !job.busy);
    const failureRows = visibleJobs.filter(needsAttention).map(documentTransferDisplay);
    const historyRows = visibleJobs.filter(job => !needsAttention(job)).map(documentTransferDisplay);
    return { jobs: visibleJobs, failureRows, historyRows, failureCount: failureRows.length,
        displayMessage: documentDisplayText(readOwner.current === renderOwner ? message : ''),
        displayReadError: documentDisplayText(readOwner.current === renderOwner ? readError : ''),
        displayHistoryError: documentDisplayText(readOwner.current === renderOwner ? historyError : ''), readLoading: readOwner.current !== renderOwner || readLoading, readError: readOwner.current === renderOwner ? readError : '', message: readOwner.current === renderOwner ? message : '', confirmationBusy,
        historyLoading, historyError: readOwner.current === renderOwner ? historyError : '', historyMore: readOwner.current === renderOwner && historyMore, nextPage: () => readHistory(false), startUploads,
        deleteDocument: (doc: CabinetDoc) => prepareExisting(doc, 'delete'), editNote: (doc: CabinetDoc) => prepareExisting(doc, 'note'),
        inspect: (id: string) => perform(id, 'inspect'), resume: (id: string, file?: File) => perform(id, 'resume', file),
        retryUpload: (id: string) => perform(id, 'resume'), retry: (id: string) => perform(id, 'resume'), cancel: (id: string) => perform(id, 'cancel'),
        retryCleanup: (id: string) => perform(id, 'cleanup'), discardCopy, refresh };
}
