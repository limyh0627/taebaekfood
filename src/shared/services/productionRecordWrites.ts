import type { CatalogValue } from '../productionRecordCommand';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../firebase';
import { normalizeProductionRecordReference, normalizeProductionRecordOpenResult, normalizeProductionRecordRequest, normalizeProductionRecordResult, normalizeProductionRecordHistoryResult, serializeProductionRecordRequest, type ProductionRecordReference, type ProductionRecordOpenResult, type ProductionRecordRequest, type ProductionRecordResult, type ProductionRecordHistoryResult } from '../productionRecordCommand';
import type { SaveOutcome } from '../saveOutcome';
export interface ProductionRecordScope {
    companyId: ProductionRecordReference['companyId'];
    actorUid: string;
}
export interface ProductionRecordEntry {
    key: string;
    reference: ProductionRecordReference | null;
    request: ProductionRecordRequest | null;
    requestHash: string | null;
    referenceHash: string | null;
    observedLocalText: string | null;
    observedReferenceText: string | null;
    status: 'valid' | 'corrupt' | 'missing';
    description: string;
}
export interface ProductionRecordObservation {
    outcome: SaveOutcome;
    result?: ProductionRecordResult;
    terminal: boolean;
    copyMismatch?: boolean;
}
type Current = () => boolean;
function description(request: ProductionRecordRequest | null, reference: ProductionRecordReference | null) {
    const action = request?.action;
    const label = action === 'create' ? '생산 등록' : action === 'sync' ? '주문 생산 동기화' : action === 'date' ? '생산일 변경' : action === 'delete' ? '생산기록 삭제' : '원문 확인이 필요한 생산기록';
    return label + ' · ' + (request && 'record' in request ? request.record.itemName : reference?.targetId ?? '식별 불가');
}
const prefix = (scope: ProductionRecordScope) => `production-record-v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const changed = () => window.dispatchEvent(new Event('production-record-requests'));
export const productionRecordKey = (scope: ProductionRecordScope, ref: ProductionRecordReference) => prefix(scope) + encodeURIComponent(JSON.stringify([ref.planId, ref.targetId]));
export function hasProductionRecordCopy(scope: ProductionRecordScope, reference: ProductionRecordReference) {
    const key = productionRecordKey(scope, reference);
    try {
        return localStorage.getItem(key) !== null || localStorage.getItem(key + ':reference') !== null;
    }
    catch {
        return true;
    }
}
const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), value => value.toString(16).padStart(2, '0')).join('');
const unknown = (message: string): ProductionRecordObservation => ({
    terminal: false, outcome: {
        status: 'unknown', message, nextAction: '같은 요청의 결과를 확인하거나 미처리 요청을 중단해 주세요. 새 원문으로 자동 재전송하지 않았습니다.'
    }
});
async function check(scope: ProductionRecordScope, current: Current) {
    await authReady;
    if (!current() || !scope.actorUid || auth.currentUser?.uid !== scope.actorUid)
        throw Error('회사 또는 로그인 계정이 바뀌었습니다. 보관 원문은 유지했습니다.');
    const token = await auth.currentUser.getIdTokenResult();
    if (!current() || auth.currentUser?.uid !== scope.actorUid || token.claims.companyId !== scope.companyId || typeof token.claims.employeeId !== 'string')
        throw Error('현재 회사의 직원 권한을 확인해 주세요.');
}
async function exclusive<T>(scope: ProductionRecordScope, current: Current, work: () => T | Promise<T>): Promise<T> {
    if (!navigator.locks)
        throw Error('이 기기에서 원문 보호 잠금을 사용할 수 없습니다. 다른 지원 브라우저에서 확인해 주세요.');
    return navigator.locks.request(prefix(scope), {
        mode: 'exclusive'
    }, async () => {
        await check(scope, current);
        return work();
    });
}
function same(scope: ProductionRecordScope, entry: ProductionRecordEntry) {
    if (!entry.key.startsWith(prefix(scope)) || entry.reference && (entry.reference.companyId !== scope.companyId || productionRecordKey(scope, entry.reference) !== entry.key))
        throw Error('다른 회사·계정의 보관 사본입니다.');
    if (localStorage.getItem(entry.key) !== entry.observedLocalText || localStorage.getItem(entry.key + ':reference') !== entry.observedReferenceText)
        throw Error('보관 사본이 바뀌었습니다. 다시 읽은 뒤 확인해 주세요.');
}
async function clear(scope: ProductionRecordScope, entry: ProductionRecordEntry, current: Current) {
    await exclusive(scope, current, () => {
        same(scope, entry);
        localStorage.removeItem(entry.key);
        localStorage.removeItem(entry.key + ':reference');
        if (localStorage.getItem(entry.key) !== null || localStorage.getItem(entry.key + ':reference') !== null)
            throw Error('기기 사본 정리를 확인하지 못했습니다.');
    });
    changed();
}
function readableError(error: unknown): string {
    const original = error instanceof Error ? error.message : String(error);
    if (/[가-힣]/.test(original))
        return original;
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    const reason = code === 'functions/unauthenticated' ? '로그인 상태를 확인하지 못했습니다. 다시 로그인한 뒤 요청 결과를 확인해 주세요.'
        : code === 'functions/permission-denied' ? '현재 계정의 접근 권한을 확인해 주세요. 요청의 처리 결과는 아직 확인하지 못했습니다.'
            : code === 'functions/unavailable' || code === 'functions/deadline-exceeded' ? '서버 연결이나 응답을 확인하지 못했습니다. 같은 요청의 결과를 다시 확인해 주세요.'
                : '서버 응답을 확인하지 못했습니다. 같은 요청의 결과를 다시 확인해 주세요.';
    return reason + ' (' + original + ')';
}
async function rpc(input: unknown) {
    try {
        return (await httpsCallable(functions, 'productionRecordCommand')(input)).data;
    }
    catch (error) {
        throw Error(readableError(error));
    }
}
export async function readProductionRecordRequests(scope: ProductionRecordScope, current: Current = () => true): Promise<ProductionRecordEntry[]> {
    await check(scope, current);
    const keys = new Set(Object.keys(localStorage).filter(key => key.startsWith(prefix(scope))).map(key => key.endsWith(':reference') ? key.slice(0, -10) : key));
    const entries: ProductionRecordEntry[] = [];
    for (const key of keys) {
        const observedLocalText = localStorage.getItem(key), observedReferenceText = localStorage.getItem(key + ':reference');
        let reference: ProductionRecordReference | null = null, request: ProductionRecordRequest | null = null, requestHash: string | null = null, referenceHash: string | null = null;
        try {
            reference = normalizeProductionRecordReference({
                companyId: scope.companyId, planId: JSON.parse(decodeURIComponent(key.slice(prefix(scope).length)))[0], targetId: JSON.parse(decodeURIComponent(key.slice(prefix(scope).length)))[1]
            });
        }
        catch { /* 식별할 수 없는 키에 요청번호를 추정하지 않는다. */
        }
        try {
            const parsed = normalizeProductionRecordRequest(JSON.parse(observedLocalText!));
            if (!reference || productionRecordKey(scope, parsed.reference) !== key || serializeProductionRecordRequest(parsed) !== observedLocalText)
                throw Error();
            request = parsed;
            requestHash = await sha(observedLocalText!);
        }
        catch { /* 손상된 원문도 참조 조회는 허용한다. */
        }
        try {
            const saved = JSON.parse(observedReferenceText!);
            if (saved.version !== 1 || saved.actorUid !== scope.actorUid || JSON.stringify(normalizeProductionRecordReference(saved.reference)) !== JSON.stringify(reference) || typeof saved.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(saved.requestHash))
                throw Error();
            referenceHash = saved.requestHash;
        }
        catch { /* 보관 참조는 화면에 관측한 그대로 남긴다. */
        }
        const valid = !!request && !!requestHash && referenceHash === requestHash;
        entries.push({
            key, reference, request, requestHash, referenceHash, observedLocalText, observedReferenceText, status: valid ? 'valid' : observedLocalText === null ? 'missing' : 'corrupt', description: description(request, reference)
        });
    }
    await check(scope, current);
    return entries;
}
export async function openProductionRecord(scope: ProductionRecordScope, reference: ProductionRecordReference, opening: CatalogValue | null, source?: {
    orderId: string;
    evidence: CatalogValue;
}, current: Current = () => true): Promise<ProductionRecordOpenResult> {
    await check(scope, current);
    if (reference.companyId !== scope.companyId)
        throw Error('요청 회사가 다릅니다.');
    const value = await rpc({ mode: 'open', reference, opening, ...(source ? { source } : {}) });
    await check(scope, current);
    const result = normalizeProductionRecordOpenResult(value, reference, scope.actorUid);
    if (JSON.stringify(result.opening) !== JSON.stringify(opening) || !!result.source !== !!source || source && (result.source?.orderId !== source.orderId || JSON.stringify(result.source.evidence) !== JSON.stringify(source.evidence)))
        throw Error('선택한 최초 원문과 서버 확인 결과가 다릅니다.');
    return result;
}
export async function prepareProductionRecord(scope: ProductionRecordScope, input: ProductionRecordRequest, current: Current = () => true): Promise<ProductionRecordEntry> {
    const request = normalizeProductionRecordRequest(input);
    if (request.reference.companyId !== scope.companyId)
        throw Error('요청 회사가 다릅니다.');
    const text = serializeProductionRecordRequest(request), hash = await sha(text), key = productionRecordKey(scope, request.reference), refText = JSON.stringify({
        version: 1, actorUid: scope.actorUid, reference: request.reference, requestHash: hash
    });
    await exclusive(scope, current, () => {
        const keys = new Set(Object.keys(localStorage).filter(item => item.startsWith(prefix(scope))).map(item => item.endsWith(':reference') ? item.slice(0, -10) : item));
        for (const pendingKey of keys) {
            if (pendingKey === key)
                continue;
            let reference: ProductionRecordReference | null = null;
            try {
                const parts = JSON.parse(decodeURIComponent(pendingKey.slice(prefix(scope).length)));
                reference = normalizeProductionRecordReference({ companyId: scope.companyId, planId: parts[0], targetId: parts[1] });
            }
            catch { /* 식별 불가 원문에서 대상 번호를 추정하지 않는다. */ }
            if (reference?.targetId === request.reference.targetId)
                throw Error('이 생산기록의 이전 보관 요청을 먼저 확인하거나 중단·정리해 주세요. 다른 요청 번호로 다시 보내지 않았습니다.');
        }
        const body = localStorage.getItem(key), sidecar = localStorage.getItem(key + ':reference');
        if (body !== null && body !== text || sidecar !== null && sidecar !== refText)
            throw Error('같은 요청 번호의 최초 원문이 다릅니다. 새 사본을 덮지 않았습니다.');
        localStorage.setItem(key + ':reference', refText);
        localStorage.setItem(key, text);
        if (localStorage.getItem(key) !== text || localStorage.getItem(key + ':reference') !== refText)
            throw Error('최초 원문 보관을 확인하지 못해 저장하지 않았습니다.');
    });
    await check(scope, current);
    changed();
    return {
        key, reference: request.reference, request, requestHash: hash, referenceHash: hash, observedLocalText: text, observedReferenceText: refText, status: 'valid', description: description(request, request.reference)
    };
}
export async function runProductionRecord(scope: ProductionRecordScope, entry: ProductionRecordEntry, mode: 'apply' | 'inspect' | 'cancel', current: Current = () => true): Promise<ProductionRecordObservation> {
    let sent = false;
    try {
        await check(scope, current);
        same(scope, entry);
        if (!entry.reference)
            throw Error('요청 번호를 식별하지 못했습니다. 원문을 보존하고 현재 생산기록을 직접 확인해 주세요.');
        let fixedRequest: ProductionRecordRequest | null = null;
        if (mode === 'apply') {
            if (entry.status !== 'valid' || !entry.request || !entry.requestHash || entry.referenceHash !== entry.requestHash || await sha(entry.observedLocalText!) !== entry.requestHash)
                throw Error('최초 저장 원문을 검증하지 못해 전송하지 않았습니다.');
            fixedRequest = normalizeProductionRecordRequest(JSON.parse(entry.observedLocalText!));
            if (serializeProductionRecordRequest(fixedRequest) !== entry.observedLocalText || productionRecordKey(scope, fixedRequest.reference) !== entry.key)
                throw Error('관측한 최초 원문과 요청 번호가 달라 전송하지 않았습니다.');
            await check(scope, current);
            same(scope, entry);
        }
        sent = true;
        const value = await rpc(mode === 'apply' ? {
            mode, request: fixedRequest
        } : {
            mode, reference: entry.reference
        });
        await check(scope, current);
        const result = normalizeProductionRecordResult(value, entry.reference, scope.actorUid);
        if (result.status === 'unknown')
            return {
                ...unknown(result.message), result
            };
        const hasCopy = entry.observedLocalText !== null || entry.observedReferenceText !== null;
        if (!hasCopy)
            return {
                terminal: false, copyMismatch: true, result, outcome: {
                    status: 'rejected', message: result.message + ' 이 기기에 원문이 없는 과거 기록이며 현재 입력의 저장 완료로 처리하지 않았습니다.', nextAction: '확인된 과거 처리와 현재 생산기록을 구분해 필요한 새 업무를 진행해 주세요.'
                }
            };
        if (entry.observedLocalText !== null && !entry.requestHash || entry.observedReferenceText !== null && !entry.referenceHash || result.requestHash !== null && (result.requestHash !== (entry.requestHash ?? entry.referenceHash) || entry.referenceHash !== null && result.requestHash !== entry.referenceHash))
            return {
                terminal: false, copyMismatch: true, result, outcome: {
                    status: 'rejected', message: result.message + ' 보관 원문과 같다고 확인하지 못해 사본을 보존했습니다.', nextAction: '처리 결과를 확인한 뒤 이 기기에 남은 요청 정보만 정리해 주세요.'
                }
            };
        try {
            await clear(scope, entry, current);
        }
        catch (error) {
            return {
                terminal: false, result, outcome: result.status === 'applied' ? {
                    status: 'partial', reason: 'followup-unconfirmed', committedIds: [entry.reference.planId], unconfirmedIds: [], message: result.message + ' 기기 사본 정리를 확인하지 못했습니다.', nextAction: '업무를 다시 보내지 말고 결과 확인이나 기기 사본 정리를 진행해 주세요.'
                } : {
                    status: 'unknown', message: error instanceof Error ? error.message : String(error), nextAction: '확인된 종결 결과와 남은 기기 사본을 다시 확인해 주세요.'
                }
            };
        }
        return {
            terminal: true, result, outcome: result.status === 'applied' ? {
                status: 'saved'
            } : {
                status: result.status === 'cancelled' ? 'cancelled' : 'rejected', message: result.message, nextAction: '현재 생산기록을 다시 읽은 뒤 필요한 내용을 새로 수정해 주세요.'
            }
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return sent ? unknown(message) : {
            terminal: false, outcome: {
                status: 'rejected', message, nextAction: '전송하지 않았습니다. 원문과 회사·로그인 상태를 다시 확인해 주세요.'
            }
        };
    }
}
export async function discardProductionRecordCopy(scope: ProductionRecordScope, entry: ProductionRecordEntry, current: Current = () => true) {
    try {
        await check(scope, current);
        same(scope, entry);
        if (entry.observedLocalText === null && entry.observedReferenceText === null)
            throw Error('관측한 기기 사본이 없습니다.');
        if (entry.reference) {
            const value = await rpc({
                mode: 'inspect', reference: entry.reference
            });
            await check(scope, current);
            const result = normalizeProductionRecordResult(value, entry.reference, scope.actorUid);
            if (result.status === 'unknown')
                throw Error(result.message + ' 먼저 미처리 요청 중단을 확인해 주세요.');
        }
        await clear(scope, entry, current);
        return {
            status: 'cleared' as const, message: '이 기기 사본만 정리했습니다. 저장된 생산기록을 삭제하거나 서버 요청을 중단한 것은 아닙니다.'
        };
    }
    catch (error) {
        return {
            status: 'blocked' as const, message: error instanceof Error ? error.message : String(error)
        };
    }
}
export async function listProductionRecordHistory(scope: ProductionRecordScope, cursor?: string, current: Current = () => true): Promise<ProductionRecordHistoryResult> {
    await check(scope, current);
    const value = await rpc({
        mode: 'listHistory', companyId: scope.companyId, ...(cursor ? {
            cursor
        } : {})
    });
    await check(scope, current);
    return normalizeProductionRecordHistoryResult(value, scope.companyId, scope.actorUid);
}
export const productionRecordWrites = { open: openProductionRecord, prepare: prepareProductionRecord, read: readProductionRecordRequests, command: runProductionRecord, discard: discardProductionRecordCopy, history: listProductionRecordHistory };
export type ProductionRecordBindings = typeof productionRecordWrites;
