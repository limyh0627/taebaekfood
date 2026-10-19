import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../../../shared/firebase';
import { normalizeDocumentMetadataReference, normalizeDocumentMetadataRequest, normalizeDocumentMetadataResult, normalizeDocumentMetadataOpenResult, normalizeDocumentMetadataPendingResult, serializeDocumentMetadataRequest, type DocumentMetadataReference, type DocumentMetadataRequest, type DocumentMetadataResult, type DocumentMetadataCommand, type DocumentMetadataScope, type CatalogValue } from '../../../shared/documentMetadataCommand';
export type { DocumentMetadataReference, DocumentMetadataRequest, DocumentMetadataResult, DocumentMetadataScope };
export interface DocumentMetadataEntry {
    key: string;
    reference: DocumentMetadataReference | null;
    request?: DocumentMetadataRequest;
    requestHash?: string;
    description: string;
    readable: boolean;
    status: 'valid' | 'corrupt' | 'unidentified';
    hasLocalCopy?: boolean;
    /** 두 보관 위치를 한 번 관측한 값이다. 표시와 사본 정리는 이 관측을 공유한다. */
    observedLocalText: string;
    result?: DocumentMetadataResult;
}
export interface DocumentMetadataObservation {
    result: DocumentMetadataResult;
    copyMismatch: boolean;
    cleanupFailed: boolean;
    message: string;
}
export interface DocumentCopyResult {
    status: 'cleared' | 'blocked' | 'unknown';
    message: string;
}
export interface DocumentMetadataPort {
    storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
    assertScope(scope: DocumentMetadataScope): Promise<void>;
    command(command: DocumentMetadataCommand): Promise<unknown>;
    exclusive<T>(scope: DocumentMetadataScope, work: () => Promise<T>): Promise<T>;
}
interface Journal {
    version: 1;
    actorUid: string;
    employeeId: string;
    request: DocumentMetadataRequest;
    requestHash: string;
    description: string;
    result?: DocumentMetadataResult;
}
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
    .map(value => value.toString(16).padStart(2, '0')).join('');
const prefix = (scope: DocumentMetadataScope) => `tb_document_v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:${encodeURIComponent(scope.employeeId)}:`;
const keyOf = (scope: DocumentMetadataScope, reference: DocumentMetadataReference) => prefix(scope)
    + [reference.documentId, reference.planId].map(encodeURIComponent).join(':') + ':body';
const terminal = (result: DocumentMetadataResult) => ['applied', 'rejected', 'cancelled'].includes(result.status);
const cleanupFinished = (result: DocumentMetadataResult) => result.cleanupStatus !== 'pending';
export function createDocumentMetadataWrites(port: DocumentMetadataPort) {
    const check = async (scope: DocumentMetadataScope, isCurrent: () => boolean) => {
        if (!isCurrent())
            throw Error('회사 또는 로그인 화면이 바뀌어 작업을 시작하지 않았습니다.');
        await port.assertScope(scope);
        if (!isCurrent())
            throw Error('회사 또는 로그인 화면이 바뀌어 다음 단계를 시작하지 않았습니다.');
    };
    const referenceForKey = (scope: DocumentMetadataScope, key: string) => {
        if (!key.endsWith(':body'))
            throw Error('보관 위치가 손상됐습니다.');
        const parts = key.slice(prefix(scope).length, -5).split(':').map(decodeURIComponent);
        if (parts.length !== 2)
            throw Error('보관 위치가 손상됐습니다.');
        return normalizeDocumentMetadataReference({ companyId: scope.companyId, documentId: parts[0], planId: parts[1] });
    };
    const observe = async (scope: DocumentMetadataScope, key: string): Promise<DocumentMetadataEntry> => {
        const body = port.storage.getItem(key), sidecar = port.storage.getItem(key + ':ref');
        const observedLocalText = JSON.stringify({ body, sidecar });
        let reference: DocumentMetadataReference | null = null;
        const base = { key, description: '문서 보관 요청', observedLocalText, hasLocalCopy: body !== null || sidecar !== null };
        try {
            reference = referenceForKey(scope, key);
        }
        catch {
            return { ...base, reference, readable: false, status: 'unidentified' };
        }
        try {
            const value = JSON.parse(body ?? '') as Journal;
            const request = normalizeDocumentMetadataRequest(value.request);
            const savedReference = JSON.parse(sidecar ?? '') as {
                reference: unknown;
                actorUid: string;
                employeeId: string;
                requestHash: string;
            };
            const ref = normalizeDocumentMetadataReference(savedReference.reference);
            if (keyOf(scope, ref) !== key || keyOf(scope, request.reference) !== key || value.version !== 1
                || value.actorUid !== scope.actorUid || value.employeeId !== scope.employeeId
                || savedReference.actorUid !== scope.actorUid || savedReference.employeeId !== scope.employeeId
                || savedReference.requestHash !== value.requestHash || typeof value.description !== 'string'
                || await digest(serializeDocumentMetadataRequest(request)) !== value.requestHash)
                throw Error('원문 결합이 다릅니다.');
            const result = value.result ? normalizeDocumentMetadataResult(value.result, reference, scope.actorUid, scope.employeeId) : undefined;
            return { ...base, reference, request, requestHash: value.requestHash, description: value.description, readable: true, status: 'valid', result };
        }
        catch {
            return { ...base, reference, readable: false, status: 'corrupt' };
        }
    };
    const read = (scope: DocumentMetadataScope, reference: DocumentMetadataReference) => observe(scope, keyOf(scope, normalizeDocumentMetadataReference(reference)));
    const list = async (scope: DocumentMetadataScope): Promise<DocumentMetadataEntry[]> => {
        const keys = new Set<string>();
        for (let index = 0; index < port.storage.length; index++) {
            const key = port.storage.key(index);
            if (key?.startsWith(prefix(scope)))
                keys.add(key.endsWith(':ref') ? key.slice(0, -4) : key);
        }
        return Promise.all([...keys].map(key => observe(scope, key)));
    };
    const listPending = async (scope: DocumentMetadataScope, cursor?: string, isCurrent = () => true) => {
        await check(scope, isCurrent);
        const companyId = normalizeDocumentMetadataReference({ companyId: scope.companyId, planId: 'scope', documentId: 'scope' }).companyId;
        const value = await port.command({ mode: 'listPending', companyId, ...(cursor ? { cursor } : {}) });
        await check(scope, isCurrent);
        return normalizeDocumentMetadataPendingResult(value, scope.companyId, scope.actorUid, scope.employeeId);
    };
    const same = (entry: DocumentMetadataEntry) => {
        const observed = JSON.parse(entry.observedLocalText) as {
            body: string | null;
            sidecar: string | null;
        };
        return port.storage.getItem(entry.key) === observed.body && port.storage.getItem(entry.key + ':ref') === observed.sidecar;
    };
    const remove = async (scope: DocumentMetadataScope, entry: DocumentMetadataEntry, isCurrent: () => boolean) => port.exclusive(scope, async () => {
        await check(scope, isCurrent);
        if (!same(entry))
            throw Error('기기 사본이 바뀌어 정리하지 않았습니다. 목록을 다시 읽어 주세요.');
        port.storage.removeItem(entry.key);
        port.storage.removeItem(entry.key + ':ref');
        if (port.storage.getItem(entry.key) !== null || port.storage.getItem(entry.key + ':ref') !== null)
            throw Error('기기 사본 정리를 확인하지 못했습니다.');
    });
    const prepare = async (scope: DocumentMetadataScope, input: DocumentMetadataRequest, description: string, isCurrent = () => true) => {
        await check(scope, isCurrent);
        const request = normalizeDocumentMetadataRequest(input), key = keyOf(scope, request.reference);
        if (request.reference.companyId !== scope.companyId)
            throw Error('다른 회사의 요청입니다.');
        const requestHash = await digest(serializeDocumentMetadataRequest(request));
        const body = JSON.stringify({ version: 1, actorUid: scope.actorUid, employeeId: scope.employeeId, request, requestHash, description } satisfies Journal);
        const sidecar = JSON.stringify({ reference: request.reference, actorUid: scope.actorUid, employeeId: scope.employeeId, requestHash });
        await port.exclusive(scope, async () => {
            await check(scope, isCurrent);
            for (const [location, text] of [[key, body], [key + ':ref', sidecar]]) {
                const old = port.storage.getItem(location);
                if (old !== null && old !== text)
                    throw Error('같은 요청번호의 다른 기기 사본이 있습니다. 먼저 결과를 확인해 주세요.');
                port.storage.setItem(location, text);
                if (port.storage.getItem(location) !== text)
                    throw Error('기기 보관을 확인하지 못해 서버 요청을 보내지 않았습니다.');
            }
        });
        return observe(scope, key);
    };
    const open = async (scope: DocumentMetadataScope, reference: DocumentMetadataReference, opening: CatalogValue, isCurrent = () => true) => {
        await check(scope, isCurrent);
        const ref = normalizeDocumentMetadataReference(reference);
        if (ref.companyId !== scope.companyId)
            throw Error('다른 회사의 문서입니다.');
        const value = await port.command({ mode: 'open', reference: ref, opening });
        await check(scope, isCurrent);
        return normalizeDocumentMetadataOpenResult(value, ref, scope.actorUid, scope.employeeId);
    };
    const command = async (scope: DocumentMetadataScope, input: DocumentMetadataEntry | DocumentMetadataReference, mode: 'reserveUpload' | 'apply' | 'inspect' | 'cancel' | 'cleanup', isCurrent = () => true): Promise<DocumentMetadataObservation> => {
        await check(scope, isCurrent);
        const reference = normalizeDocumentMetadataReference('key' in input ? input.reference : input);
        if (reference.companyId !== scope.companyId)
            throw Error('다른 회사의 문서 요청입니다.');
        const entry = await read(scope, reference);
        const sending = mode === 'apply' || mode === 'reserveUpload';
        if (sending && (!entry.request || !entry.readable))
            throw Error('보관 원문이 손상되어 다시 보내지 않았습니다. 결과 확인 또는 요청 중단을 선택해 주세요.');
        await check(scope, isCurrent);
        if (sending && !same(entry))
            throw Error('보관 원문이 바뀌어 요청을 보내지 않았습니다.');
        const value = await port.command(sending ? { mode, request: entry.request! } : { mode, reference });
        await check(scope, isCurrent);
        const result = normalizeDocumentMetadataResult(value, reference, scope.actorUid, scope.employeeId);
        if (sending && result.requestHash !== null && result.requestHash !== entry.requestHash)
            throw Error('서버가 다른 원문으로 응답하여 처리 결과를 확인하지 못했습니다.');
        const observed = JSON.parse(entry.observedLocalText) as {
            body: string | null;
            sidecar: string | null;
        };
        const hasCopy = observed.body !== null || observed.sidecar !== null;
        const copyMismatch = (!hasCopy && result.status === 'applied') || hasCopy && (!entry.readable || result.requestHash !== null && result.requestHash !== entry.requestHash);
        if (copyMismatch)
            return { result, copyMismatch: true, cleanupFailed: false,
                message: hasCopy ? `서버 결과: ${result.message}\n이 기기의 사본과 서버에 확정된 원문이 달라 이 사본의 완료로 처리하지 않았습니다. 결과를 확인한 뒤 이 기기 사본만 명시적으로 정리해 주세요.` : `서버 결과: ${result.message}\n이 기기에 원문이 없어 현재 작성의 완료로 연결하지 않았습니다.` };
        if (terminal(result) && cleanupFinished(result) && hasCopy) {
            try {
                await remove(scope, entry, isCurrent);
            }
            catch (error) {
                return { result, copyMismatch: false, cleanupFailed: true, message: `${result.message}\n기기 사본 정리를 확인하지 못했습니다. 다시 저장하지 말고 같은 요청을 확인하거나 사본 정리를 선택해 주세요. ${error instanceof Error ? error.message : ''}` };
            }
        }
        else if (entry.readable) {
            // 단계 관측은 고정 요청/hash와 분리하며, 다른 탭이 바꾼 원문은 덮지 않는다.
            await port.exclusive(scope, async () => {
                await check(scope, isCurrent);
                if (!same(entry))
                    throw Error('기기 사본이 바뀌어 단계 정보를 덮어쓰지 않았습니다.');
                const journal = JSON.parse(observed.body!) as Journal, text = JSON.stringify({ ...journal, result });
                port.storage.setItem(entry.key, text);
                if (port.storage.getItem(entry.key) !== text)
                    throw Error('단계 관측 보관을 확인하지 못했습니다. 서버 결과를 다시 확인해 주세요.');
            });
        }
        return { result, copyMismatch: false, cleanupFailed: false, message: result.message };
    };
    const discard = async (scope: DocumentMetadataScope, reference: DocumentMetadataReference | null, observedLocalText: string, isCurrent = () => true, unidentifiedKey?: string): Promise<DocumentCopyResult> => {
        try {
            await check(scope, isCurrent);
            const key = reference ? keyOf(scope, normalizeDocumentMetadataReference(reference)) : unidentifiedKey;
            if (!key?.startsWith(prefix(scope)))
                return { status: 'blocked', message: '현재 계정의 관측한 사본만 정리할 수 있습니다.' };
            if (reference) {
                if (reference.companyId !== scope.companyId)
                    return { status: 'blocked', message: '다른 회사의 사본은 정리할 수 없습니다.' };
                const result = normalizeDocumentMetadataResult(await port.command({ mode: 'inspect', reference }), reference, scope.actorUid, scope.employeeId);
                await check(scope, isCurrent);
                if (!terminal(result) || !cleanupFinished(result))
                    return { status: 'blocked', message: '요청 또는 파일 정리가 아직 끝나지 않았습니다. 먼저 결과 확인이나 요청 중단을 선택해 주세요.' };
            }
            await remove(scope, { key, observedLocalText } as DocumentMetadataEntry, isCurrent);
            return { status: 'cleared', message: reference ? '이 기기의 사본만 정리했습니다. 이미 처리된 문서를 되돌리지 않습니다.' : '식별할 수 없는 이 기기 사본만 정리했습니다. 서버 요청을 중단하거나 미처리를 확인한 것은 아닙니다.' };
        }
        catch (error) {
            return { status: 'unknown', message: error instanceof Error ? error.message : '사본 정리를 확인하지 못했습니다.' };
        }
    };
    return { prepare, read, list, listPending, open, command, discard };
}
const defaultPort: DocumentMetadataPort = {
    get storage() { return localStorage; },
    async assertScope(scope) {
        const user = auth.currentUser;
        if (!user || user.uid !== scope.actorUid)
            throw Error('로그인 계정이 바뀌었습니다.');
        await authReady;
        if (auth.currentUser !== user)
            throw Error('로그인 계정이 바뀌었습니다.');
        const { claims } = await user.getIdTokenResult();
        if (auth.currentUser !== user || claims.companyId !== scope.companyId || claims.employeeId !== scope.employeeId || claims.isAdmin !== true)
            throw Error('현재 회사의 관리자 직원 로그인 정보를 확인해 주세요.');
    },
    command: async (command) => (await httpsCallable(functions, 'documentMetadataCommand')(command)).data,
    async exclusive(scope, work) {
        if (!navigator.locks)
            throw Error('기기 보관 보호 기능을 사용할 수 없습니다. 지원되는 브라우저에서 다시 확인해 주세요.');
        return navigator.locks.request(prefix(scope), work);
    }
};
export const documentMetadataWrites = createDocumentMetadataWrites(defaultPort);
