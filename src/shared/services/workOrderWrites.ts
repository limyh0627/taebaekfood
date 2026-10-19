import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../firebase';
import { normalizeWorkOrderReference, normalizeWorkOrderOpening, normalizeWorkOrderRequest, normalizeWorkOrderResult, normalizeWorkOrderHistoryResult, serializeWorkOrderRequest, type WorkOrderReference, type WorkOrderOpening, type WorkOrderRequest, type WorkOrderResult, type WorkOrderHistoryResult } from '../workOrderCommand';
import type { SaveOutcome } from '../saveOutcome';
import { subscribeToDocument } from './firebaseService';
import { companySettingDocId } from '../companySettings';
export interface WorkOrderScope {
    companyId: WorkOrderReference['companyId'];
    actorUid: string;
}
export interface WorkOrderEntry {
    key: string;
    reference: WorkOrderReference | null;
    request: WorkOrderRequest | null;
    requestHash: string | null;
    referenceHash: string | null;
    observedLocalText: string | null;
    observedReferenceText: string | null;
    status: 'valid' | 'corrupt' | 'missing';
    description: string;
}
export interface WorkOrderObservation {
    outcome: SaveOutcome;
    result?: WorkOrderResult;
    terminal: boolean;
    copyMismatch?: boolean;
}
type Current = () => boolean;
const prefix = (scope: WorkOrderScope) => `work-order-v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const notices = new Map<string, {
    message: string;
    reference: WorkOrderReference | null;
}>();
export const readWorkOrderNotice = (scope: WorkOrderScope) => notices.get(prefix(scope))?.message ?? '';
export const hasUnsentWorkOrderNotice = (scope: WorkOrderScope) => notices.get(prefix(scope))?.reference === null;
export function reportWorkOrderNotice(scope: WorkOrderScope, message: string, reference: WorkOrderReference | null = null) {
    const previous = notices.get(prefix(scope));
    if (message)
        notices.set(prefix(scope), {
            message, reference
        });
    else if (!previous?.reference || reference && previous.reference.planId === reference.planId)
        notices.delete(prefix(scope));
    window.dispatchEvent(new Event('work-order-requests'));
}
function finishNotice(scope: WorkOrderScope, reference: WorkOrderReference | null) {
    const notice = notices.get(prefix(scope));
    if (reference && notice?.reference?.companyId === reference.companyId && notice.reference.planId === reference.planId)
        notices.delete(prefix(scope));
}
const changed = () => window.dispatchEvent(new Event('work-order-requests'));
export const workOrderKey = (scope: WorkOrderScope, ref: WorkOrderReference) => prefix(scope) + encodeURIComponent(ref.planId);
export function hasWorkOrderCopy(scope: WorkOrderScope, reference: WorkOrderReference) {
    const key = workOrderKey(scope, reference);
    try {
        return localStorage.getItem(key) !== null || localStorage.getItem(key + ':reference') !== null;
    }
    catch {
        return true;
    }
}
const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), value => value.toString(16).padStart(2, '0')).join('');
const unknown = (message: string): WorkOrderObservation => ({
    terminal: false, outcome: {
        status: 'unknown', message, nextAction: '같은 요청의 결과를 확인하거나 미처리 요청을 중단해 주세요. 새 원문으로 자동 재전송하지 않았습니다.'
    }
});
async function check(scope: WorkOrderScope, current: Current) {
    await authReady;
    if (!current() || !scope.actorUid || auth.currentUser?.uid !== scope.actorUid)
        throw Error('회사 또는 로그인 계정이 바뀌었습니다. 보관 원문은 유지했습니다.');
    const token = await auth.currentUser.getIdTokenResult();
    if (!current() || auth.currentUser?.uid !== scope.actorUid || token.claims.companyId !== scope.companyId || typeof token.claims.employeeId !== 'string')
        throw Error('현재 회사의 직원 권한을 확인해 주세요.');
}
async function exclusive<T>(scope: WorkOrderScope, current: Current, work: () => T | Promise<T>): Promise<T> {
    if (!navigator.locks)
        throw Error('이 기기에서 원문 보호 잠금을 사용할 수 없습니다. 다른 지원 브라우저에서 확인해 주세요.');
    return navigator.locks.request(prefix(scope), {
        mode: 'exclusive'
    }, async () => {
        await check(scope, current);
        return work();
    });
}
function same(scope: WorkOrderScope, entry: WorkOrderEntry) {
    if (!entry.key.startsWith(prefix(scope)) || entry.reference && (entry.reference.companyId !== scope.companyId || workOrderKey(scope, entry.reference) !== entry.key))
        throw Error('다른 회사·계정의 보관 사본입니다.');
    if (localStorage.getItem(entry.key) !== entry.observedLocalText || localStorage.getItem(entry.key + ':reference') !== entry.observedReferenceText)
        throw Error('보관 사본이 바뀌었습니다. 다시 읽은 뒤 확인해 주세요.');
}
async function clear(scope: WorkOrderScope, entry: WorkOrderEntry, current: Current) {
    await exclusive(scope, current, () => {
        same(scope, entry);
        localStorage.removeItem(entry.key);
        localStorage.removeItem(entry.key + ':reference');
        if (localStorage.getItem(entry.key) !== null || localStorage.getItem(entry.key + ':reference') !== null)
            throw Error('기기 사본 정리를 확인하지 못했습니다.');
    });
    finishNotice(scope, entry.reference);
    changed();
}
async function rpc(input: unknown) {
    return (await httpsCallable(functions, 'workOrderCommand')(input)).data;
}
export async function readWorkOrderRequests(scope: WorkOrderScope, current: Current = () => true): Promise<WorkOrderEntry[]> {
    await check(scope, current);
    const keys = new Set(Object.keys(localStorage).filter(key => key.startsWith(prefix(scope))).map(key => key.endsWith(':reference') ? key.slice(0, -10) : key));
    const entries: WorkOrderEntry[] = [];
    for (const key of keys) {
        const observedLocalText = localStorage.getItem(key), observedReferenceText = localStorage.getItem(key + ':reference');
        let reference: WorkOrderReference | null = null, request: WorkOrderRequest | null = null, requestHash: string | null = null, referenceHash: string | null = null;
        try {
            reference = normalizeWorkOrderReference({
                companyId: scope.companyId, planId: decodeURIComponent(key.slice(prefix(scope).length))
            });
        }
        catch { /* 식별할 수 없는 키에 요청번호를 추정하지 않는다. */
        }
        try {
            const parsed = normalizeWorkOrderRequest(JSON.parse(observedLocalText!));
            if (!reference || workOrderKey(scope, parsed.reference) !== key || serializeWorkOrderRequest(parsed) !== observedLocalText)
                throw Error();
            request = parsed;
            requestHash = await sha(observedLocalText!);
        }
        catch { /* 손상된 원문도 참조 조회는 허용한다. */
        }
        try {
            const saved = JSON.parse(observedReferenceText!);
            if (saved.version !== 1 || saved.actorUid !== scope.actorUid || JSON.stringify(normalizeWorkOrderReference(saved.reference)) !== JSON.stringify(reference) || typeof saved.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(saved.requestHash))
                throw Error();
            referenceHash = saved.requestHash;
        }
        catch { /* 보관 참조는 화면에 관측한 그대로 남긴다. */
        }
        const valid = !!request && !!requestHash && referenceHash === requestHash;
        entries.push({
            key, reference, request, requestHash, referenceHash, observedLocalText, observedReferenceText, status: valid ? 'valid' : observedLocalText === null ? 'missing' : 'corrupt', description: request?.action === 'resetDaily' ? `${request.date} 작업순서 초기화` : request?.action === 'apply' ? `작업순서 ${request.items.length}건 · ${reference?.planId}` : `원문 확인이 필요한 작업순서 · ${reference?.planId ?? '식별 불가'}`
        });
    }
    await check(scope, current);
    return entries;
}
export async function openWorkOrder(scope: WorkOrderScope, reference: WorkOrderReference, current: Current = () => true): Promise<WorkOrderOpening> {
    await check(scope, current);
    if (reference.companyId !== scope.companyId)
        throw Error('다른 회사의 작업순서입니다.');
    const value = await rpc({
        mode: 'open', reference
    });
    await check(scope, current);
    return normalizeWorkOrderOpening(value, reference, scope.actorUid);
}
export async function prepareWorkOrder(scope: WorkOrderScope, input: WorkOrderRequest, current: Current = () => true): Promise<WorkOrderEntry> {
    const request = normalizeWorkOrderRequest(input);
    if (request.reference.companyId !== scope.companyId)
        throw Error('요청 회사가 다릅니다.');
    const text = serializeWorkOrderRequest(request), hash = await sha(text), key = workOrderKey(scope, request.reference), refText = JSON.stringify({
        version: 1, actorUid: scope.actorUid, reference: request.reference, requestHash: hash
    });
    await exclusive(scope, current, () => {
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
        key, reference: request.reference, request, requestHash: hash, referenceHash: hash, observedLocalText: text, observedReferenceText: refText, status: 'valid', description: request.action === 'resetDaily' ? `${request.date} 작업순서 초기화` : `작업순서 ${request.items.length}건 · ${request.reference.planId}`
    };
}
export async function runWorkOrder(scope: WorkOrderScope, entry: WorkOrderEntry, mode: 'apply' | 'inspect' | 'cancel', current: Current = () => true): Promise<WorkOrderObservation> {
    let sent = false;
    try {
        await check(scope, current);
        same(scope, entry);
        if (!entry.reference)
            throw Error('요청 번호를 식별하지 못했습니다. 원문을 보존하고 현재 작업순서를 직접 확인해 주세요.');
        let fixedRequest: WorkOrderRequest | null = null;
        if (mode === 'apply') {
            if (entry.status !== 'valid' || !entry.request || !entry.requestHash || entry.referenceHash !== entry.requestHash || await sha(entry.observedLocalText!) !== entry.requestHash)
                throw Error('최초 저장 원문을 검증하지 못해 전송하지 않았습니다.');
            fixedRequest = normalizeWorkOrderRequest(JSON.parse(entry.observedLocalText!));
            if (serializeWorkOrderRequest(fixedRequest) !== entry.observedLocalText || workOrderKey(scope, fixedRequest.reference) !== entry.key)
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
        const result = normalizeWorkOrderResult(value, entry.reference, scope.actorUid);
        if (result.status === 'unknown')
            return {
                ...unknown(result.message), result
            };
        const hasCopy = entry.observedLocalText !== null || entry.observedReferenceText !== null;
        if (!hasCopy)
            return {
                terminal: false, copyMismatch: true, result, outcome: {
                    status: 'rejected', message: result.message + ' 이 기기에 원문이 없는 과거 기록이며 현재 입력의 저장 완료로 처리하지 않았습니다.', nextAction: '확인된 과거 처리와 현재 작업순서를 구분해 필요한 새 업무를 진행해 주세요.'
                }
            };
        if (entry.observedLocalText !== null && !entry.requestHash || entry.observedReferenceText !== null && !entry.referenceHash || result.requestHash !== null && (result.requestHash !== (entry.requestHash ?? entry.referenceHash) || entry.referenceHash !== null && result.requestHash !== entry.referenceHash))
            return {
                terminal: false, copyMismatch: true, result, outcome: {
                    status: 'rejected', message: result.message + ' 보관 원문과 같다고 확인하지 못해 사본을 보존했습니다.', nextAction: '실제 처리 내용을 확인한 뒤 관측한 이 기기 사본만 명시적으로 정리해 주세요.'
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
                status: result.status === 'cancelled' ? 'cancelled' : 'rejected', message: result.message, nextAction: '현재 작업순서를 다시 읽은 뒤 필요한 내용을 명시적으로 새로 수정해 주세요.'
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
export async function discardWorkOrderCopy(scope: WorkOrderScope, entry: WorkOrderEntry, current: Current = () => true) {
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
            const result = normalizeWorkOrderResult(value, entry.reference, scope.actorUid);
            if (result.status === 'unknown')
                throw Error(result.message + ' 먼저 미처리 요청 중단을 확인해 주세요.');
        }
        await clear(scope, entry, current);
        return {
            status: 'cleared' as const, message: '이 기기 사본만 정리했습니다. 저장된 작업순서를 삭제하거나 서버 요청을 중단한 것은 아닙니다.'
        };
    }
    catch (error) {
        return {
            status: 'blocked' as const, message: error instanceof Error ? error.message : String(error)
        };
    }
}
export async function listWorkOrderHistory(scope: WorkOrderScope, cursor?: string, current: Current = () => true): Promise<WorkOrderHistoryResult> {
    await check(scope, current);
    const value = await rpc({
        mode: 'listHistory', companyId: scope.companyId, ...(cursor ? {
            cursor
        } : {})
    });
    await check(scope, current);
    return normalizeWorkOrderHistoryResult(value, scope.companyId, scope.actorUid);
}
export function subscribeWorkOrderGroups(scope: WorkOrderScope, onNames: (names: string[]) => void, current: Current = () => true) {
    let live = true, unsubscribe: (() => void) | undefined;
    void check(scope, () => live && current()).then(() => {
        if (!live || !current())
            return;
        unsubscribe = subscribeToDocument<{
            names: string[];
        }>('settings', companySettingDocId(scope.companyId, 'workGroups'), value => {
            if (!live || !current() || auth.currentUser?.uid !== scope.actorUid)
                return;
            const names = value?.names?.length ? value.names : ['기름', '깨', '미분류'];
            if (!names.every(name => typeof name === 'string'))
                return;
            onNames([...names]);
        });
    }).catch(error => {
        if (live && current())
            reportWorkOrderNotice(scope, error instanceof Error ? error.message : String(error));
    });
    return () => {
        live = false;
        unsubscribe?.();
    };
}
export const workOrderWrites = {
    open: openWorkOrder, prepare: prepareWorkOrder, read: readWorkOrderRequests, command: runWorkOrder, discard: discardWorkOrderCopy, history: listWorkOrderHistory, subscribeGroups: subscribeWorkOrderGroups
};
export type WorkOrderBindings = typeof workOrderWrites;
