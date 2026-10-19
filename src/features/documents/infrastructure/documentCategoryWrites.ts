import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../../../shared/firebase';
import type { SaveOutcome } from '../../../shared/saveOutcome';
import { normalizeDocumentCategoryReference, normalizeDocumentCategoryRequest, serializeDocumentCategoryRequest, normalizeDocumentCategoryResult, normalizeDocumentCategoryPendingResult, type DocumentCategoryReference, type DocumentCategoryRequest, type DocumentCategoryResult, type DocumentCategoryScope, type DocumentCategoryCommand } from '../../../shared/documentCategoryCommand';
export type { DocumentCategoryReference, DocumentCategoryRequest, DocumentCategoryResult, DocumentCategoryScope };
export interface DocumentCategoryEntry {
    key: string;
    reference: DocumentCategoryReference | null;
    request?: DocumentCategoryRequest;
    requestHash?: string;
    description: string;
    observedLocalText: string;
    readable: boolean;
    hasLocalCopy: boolean;
}
export interface DocumentCategoryObservation {
    result: DocumentCategoryResult;
    outcome: SaveOutcome;
    copyMismatch: boolean;
    cleanupFailed: boolean;
    request?: DocumentCategoryRequest;
}
export interface DocumentCategoryCopyResult {
    status: 'cleared' | 'blocked' | 'unknown';
    message: string;
}
export interface DocumentCategoryPort {
    storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
    assertScope(scope: DocumentCategoryScope): Promise<void>;
    command(command: DocumentCategoryCommand): Promise<unknown>;
    exclusive<T>(scope: DocumentCategoryScope, work: () => Promise<T>): Promise<T>;
}
interface Journal {
    version: 1;
    actorUid: string;
    employeeId: string;
    request: DocumentCategoryRequest;
    requestHash: string;
    description: string;
}
const prefix = (scope: DocumentCategoryScope) => `tb_document_category_v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:${encodeURIComponent(scope.employeeId)}:`;
const keyOf = (scope: DocumentCategoryScope, ref: DocumentCategoryReference) => prefix(scope) + encodeURIComponent(ref.planId) + ':body';
const hash = async (request: DocumentCategoryRequest) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializeDocumentCategoryRequest(request))))].map(n => n.toString(16).padStart(2, '0')).join('');
const terminal = (result: DocumentCategoryResult) => result.status !== 'unknown';
const unknown = (message: string): SaveOutcome => ({ status: 'unknown', message, nextAction: '같은 보관 요청의 결과 확인 또는 미처리 요청 중단을 선택해 주세요. 목록에 없다는 이유로 미처리를 확정하지 않습니다.' });
export function createDocumentCategoryWrites(port: DocumentCategoryPort) {
    const check = async (scope: DocumentCategoryScope, current: () => boolean) => {
        if (!current())
            throw Error('회사 또는 로그인 화면이 바뀌었습니다.');
        await port.assertScope(scope);
        if (!current())
            throw Error('회사 또는 로그인 화면이 바뀌어 다음 단계를 시작하지 않았습니다.');
    };
    const readKey = async (scope: DocumentCategoryScope, key: string): Promise<DocumentCategoryEntry> => {
        const body = port.storage.getItem(key), sidecar = port.storage.getItem(key + ':ref');
        const base = { key, description: '분류 보관 요청', observedLocalText: JSON.stringify({ body, sidecar }), hasLocalCopy: body !== null || sidecar !== null };
        let reference: DocumentCategoryReference | null = null;
        try {
            if (!key.startsWith(prefix(scope)) || !key.endsWith(':body'))
                throw Error('보관 위치가 손상됐습니다.');
            reference = normalizeDocumentCategoryReference({ companyId: scope.companyId, planId: decodeURIComponent(key.slice(prefix(scope).length, -5)) });
        }
        catch {
            return { ...base, reference, readable: false };
        }
        try {
            const value = JSON.parse(body ?? '') as Journal, refValue = JSON.parse(sidecar ?? '') as {
                actorUid: string;
                employeeId: string;
                reference: unknown;
                requestHash: string;
            };
            const request = normalizeDocumentCategoryRequest(value.request), savedRef = normalizeDocumentCategoryReference(refValue.reference);
            if (value.version !== 1 || value.actorUid !== scope.actorUid || value.employeeId !== scope.employeeId
                || refValue.actorUid !== scope.actorUid || refValue.employeeId !== scope.employeeId
                || keyOf(scope, request.reference) !== key || keyOf(scope, savedRef) !== key
                || refValue.requestHash !== value.requestHash || typeof value.description !== 'string' || await hash(request) !== value.requestHash)
                throw Error('보관 원문 결합이 다릅니다.');
            return { ...base, reference, request, requestHash: value.requestHash, description: value.description, readable: true };
        }
        catch {
            return { ...base, reference, readable: false };
        }
    };
    const read = (scope: DocumentCategoryScope, ref: DocumentCategoryReference) => readKey(scope, keyOf(scope, normalizeDocumentCategoryReference(ref)));
    const list = async (scope: DocumentCategoryScope) => {
        const keys = new Set<string>();
        for (let index = 0; index < port.storage.length; index++) {
            const key = port.storage.key(index);
            if (key?.startsWith(prefix(scope)))
                keys.add(key.endsWith(':ref') ? key.slice(0, -4) : key);
        }
        return Promise.all([...keys].map(key => readKey(scope, key)));
    };
    const same = (entry: DocumentCategoryEntry) => {
        const original = JSON.parse(entry.observedLocalText) as {
            body: string | null;
            sidecar: string | null;
        };
        return port.storage.getItem(entry.key) === original.body && port.storage.getItem(entry.key + ':ref') === original.sidecar;
    };
    const clear = (scope: DocumentCategoryScope, entry: DocumentCategoryEntry, current: () => boolean) => port.exclusive(scope, async () => {
        await check(scope, current);
        if (!same(entry))
            throw Error('관측 뒤 기기 사본이 바뀌어 정리하지 않았습니다.');
        port.storage.removeItem(entry.key);
        port.storage.removeItem(entry.key + ':ref');
        if (port.storage.getItem(entry.key) !== null || port.storage.getItem(entry.key + ':ref') !== null)
            throw Error('기기 사본 정리를 확인하지 못했습니다.');
    });
    const prepare = async (scope: DocumentCategoryScope, input: DocumentCategoryRequest, description: string, current = () => true) => {
        await check(scope, current);
        const request = normalizeDocumentCategoryRequest(input), key = keyOf(scope, request.reference);
        if (request.reference.companyId !== scope.companyId)
            throw Error('다른 회사의 분류 요청입니다.');
        const requestHash = await hash(request);
        const body = JSON.stringify({ version: 1, actorUid: scope.actorUid, employeeId: scope.employeeId, request, requestHash, description } satisfies Journal);
        const sidecar = JSON.stringify({ reference: request.reference, actorUid: scope.actorUid, employeeId: scope.employeeId, requestHash });
        await port.exclusive(scope, async () => {
            await check(scope, current);
            for (const [location, text] of [[key, body], [key + ':ref', sidecar]]) {
                const previous = port.storage.getItem(location);
                if (previous !== null && previous !== text)
                    throw Error('같은 요청 번호에 다른 원문이 남아 있습니다. 먼저 결과를 확인해 주세요.');
                port.storage.setItem(location, text);
                if (port.storage.getItem(location) !== text)
                    throw Error('기기 보관을 확인하지 못해 서버 요청을 보내지 않았습니다.');
            }
        });
        return readKey(scope, key);
    };
    const command = async (scope: DocumentCategoryScope, input: DocumentCategoryReference, mode: 'apply' | 'inspect' | 'cancel', current = () => true, expectedObservation?: string): Promise<DocumentCategoryObservation> => {
        await check(scope, current);
        const reference = normalizeDocumentCategoryReference(input);
        if (reference.companyId !== scope.companyId)
            throw Error('다른 회사의 요청을 처리할 수 없습니다.');
        const entry = await read(scope, reference);
        const changedObservation = expectedObservation !== undefined && expectedObservation !== entry.observedLocalText;
        if (mode === 'apply' && changedObservation)
            throw Error('표시한 뒤 보관 원문이 바뀌어 다시 보내지 않았습니다. 목록을 다시 읽어 주세요.');
        if (mode === 'apply' && (!entry.readable || !entry.request))
            throw Error('보관 원문을 확인하지 못해 다시 보내지 않았습니다. 결과 확인 또는 요청 중단을 선택해 주세요.');
        await check(scope, current);
        if (mode === 'apply' && !same(entry))
            throw Error('원문이 바뀌어 서버 요청을 보내지 않았습니다.');
        const response = await port.command(mode === 'apply' ? { mode, request: entry.request! } : { mode, reference });
        await check(scope, current);
        const result = normalizeDocumentCategoryResult(response, reference, scope.actorUid, scope.employeeId, mode === 'apply' ? entry.requestHash : undefined);
        if (result.status === 'unknown')
            return { result, request: entry.request, outcome: unknown(result.message), copyMismatch: false, cleanupFailed: false };
        const copyMismatch = (changedObservation && entry.hasLocalCopy) || (entry.hasLocalCopy ? !entry.readable || result.requestHash !== null && result.requestHash !== entry.requestHash : result.status === 'applied');
        if (copyMismatch)
            return { result, request: entry.request, copyMismatch: true, cleanupFailed: false, outcome: { status: 'rejected', message: `서버 결과: ${result.message}\n${entry.hasLocalCopy ? '이 기기의 원문과 서버의 확정 원문이 달라 이 사본의 완료로 처리하지 않았습니다.' : '이 기기에 원문이 없어 현재 작성의 완료로 연결하지 않았습니다.'}`, nextAction: '서버 상태를 확인한 뒤 관측한 이 기기 사본만 명시적으로 정리해 주세요.' } };
        let outcome: SaveOutcome = result.status === 'applied' ? { status: 'saved' } : { status: result.status, message: result.message, nextAction: '현재 분류를 다시 확인한 뒤 필요한 작업을 새로 작성해 주세요.' };
        let cleanupFailed = false;
        if (entry.hasLocalCopy) {
            try {
                await clear(scope, entry, current);
            }
            catch (error) {
                cleanupFailed = true;
                outcome = result.status === 'applied' ? { status: 'partial', reason: 'followup-unconfirmed', committedIds: [reference.planId], unconfirmedIds: [], message: `${result.message}\n기기 사본 정리를 확인하지 못했습니다.`, nextAction: '분류를 다시 저장하지 말고 같은 요청을 확인하거나 기기 사본 정리를 선택해 주세요.' }
                    : { status: result.status, message: `${result.message}\n${error instanceof Error ? error.message : '기기 사본 정리를 확인하지 못했습니다.'}`, nextAction: '기기 사본을 보존하고 결과 확인 또는 명시 사본 정리를 선택해 주세요.' };
            }
        }
        return { result, request: entry.request, outcome, copyMismatch: false, cleanupFailed };
    };
    const listPending = async (scope: DocumentCategoryScope, cursor?: string, current = () => true) => {
        await check(scope, current);
        const companyId = normalizeDocumentCategoryReference({ companyId: scope.companyId, planId: 'scope' }).companyId;
        const value = await port.command({ mode: 'listPending', companyId, ...(cursor ? { cursor } : {}) });
        await check(scope, current);
        return normalizeDocumentCategoryPendingResult(value, scope.companyId, scope.actorUid, scope.employeeId);
    };
    const discard = async (scope: DocumentCategoryScope, reference: DocumentCategoryReference | null, observedLocalText: string, current = () => true, unidentifiedKey?: string): Promise<DocumentCategoryCopyResult> => {
        try {
            await check(scope, current);
            const ref = reference ? normalizeDocumentCategoryReference(reference) : null;
            if (ref && ref.companyId !== scope.companyId)
                throw Error('다른 회사의 사본입니다.');
            const key = ref ? keyOf(scope, ref) : unidentifiedKey;
            if (!key?.startsWith(prefix(scope)))
                return { status: 'blocked', message: '현재 계정에서 관측한 사본만 정리할 수 있습니다.' };
            if (ref) {
                const result = normalizeDocumentCategoryResult(await port.command({ mode: 'inspect', reference: ref }), ref, scope.actorUid, scope.employeeId);
                await check(scope, current);
                if (!terminal(result))
                    return { status: 'blocked', message: '서버 결과를 아직 확인하지 못했습니다. 먼저 미처리 요청을 중단한 뒤 사본을 정리해 주세요.' };
            }
            await clear(scope, { key, observedLocalText } as DocumentCategoryEntry, current);
            return { status: 'cleared', message: ref ? '이 기기 사본만 정리했습니다. 이미 반영된 분류를 되돌리지 않습니다.' : '식별할 수 없는 기기 사본만 정리했습니다. 서버 요청의 중단이나 미처리를 확인한 것은 아닙니다.' };
        }
        catch (error) {
            return { status: 'unknown', message: error instanceof Error ? error.message : '기기 사본 정리를 확인하지 못했습니다.' };
        }
    };
    return { prepare, read, list, command, listPending, discard };
}
const defaultPort: DocumentCategoryPort = {
    get storage() { return localStorage; },
    async assertScope(scope) {
        const user = auth.currentUser;
        if (!user || user.uid !== scope.actorUid)
            throw Error('로그인 계정이 바뀌었습니다.');
        if (typeof scope.employeeId !== 'string' || !scope.employeeId.trim())
            throw Error('관리자 직원 로그인 정보를 확인해 주세요.');
        await authReady;
        if (auth.currentUser !== user)
            throw Error('로그인 계정이 바뀌었습니다.');
        const { claims } = await user.getIdTokenResult();
        if (auth.currentUser !== user || claims.companyId !== scope.companyId || claims.employeeId !== scope.employeeId || typeof claims.employeeId !== 'string' || !claims.employeeId.trim() || claims.isAdmin !== true)
            throw Error('현재 회사의 관리자 직원 로그인 정보를 확인해 주세요.');
    },
    command: async (input) => (await httpsCallable(functions, 'documentCategoryCommand')(input)).data,
    async exclusive(scope, work) {
        if (!navigator.locks)
            throw Error('기기 보관 보호 기능을 사용할 수 없습니다. 지원되는 브라우저에서 다시 확인해 주세요.');
        return navigator.locks.request(prefix(scope), work);
    }
};
export const documentCategoryWrites = createDocumentCategoryWrites(defaultPort);
