import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../firebase';
import { canonicalOrderInterpretation, type OrderInterpretationRequest, type OrderInterpretationScope } from '../orderInterpretation';
import { decodeOrderCopyAttempt, prepareOrderCopyAttempt, clearOrderCopyAttempt } from '../orderCopyAttempt';
import type { OrderCopyResult } from '../../../functions/src/orderCopyCommands';
import { normalizeOrderCopyRecoveryReference, normalizeOrderCopyRecoveryResult, normalizeOrderCopyRecoveryHistoryResult, type OrderCopyRecoveryReference, type OrderCopyRecoveryResult } from '../orderCopyRecovery';
import type { SaveOutcome } from '../saveOutcome';
export type { OrderCopyResult };
export interface PendingOrderCopy {
    key: string;
    text: string;
    request: OrderInterpretationRequest | null;
    deleted: boolean;
    error: string;
}
const prefix = (scope: OrderInterpretationScope) => `order-copy-v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const keyOf = (request: OrderInterpretationRequest) => prefix(request) + encodeURIComponent(request.requestId);
export const orderCopyRecoveryKey = (scope: OrderInterpretationScope, requestId: string) => prefix(scope) + encodeURIComponent(requestId);
const marker = (key: string) => `${key}:deleted`;
const active = async (scope: OrderInterpretationScope, adminOnly = false) => {
    await authReady;
    const user = auth.currentUser;
    if (!user || user.uid !== scope.actorUid)
        throw Error('주문 요청의 로그인 계정이 변경되었습니다. 원문을 보존했습니다.');
    const claims = (await user.getIdTokenResult()).claims;
    if (auth.currentUser?.uid !== scope.actorUid || claims.companyId !== scope.companyId || typeof claims.employeeId !== 'string' || adminOnly && claims.isAdmin !== true)
        throw Error('현재 회사의 직원 권한을 확인해 주세요.');
};
async function locked<T>(scope: OrderInterpretationScope, work: () => T): Promise<T> {
    if (!navigator.locks?.request)
        throw Error('이 환경은 여러 창의 요청 보호를 지원하지 않습니다. 지원 브라우저에서 다시 시도해 주세요.');
    return navigator.locks.request(prefix(scope), {
        mode: 'exclusive'
    }, async () => { await active(scope); return work(); });
}
export function listPendingOrderCopies(companyId: OrderInterpretationScope['companyId'], actorUid: string): PendingOrderCopy[] {
    const scope = {
        companyId, actorUid
    }, rows: PendingOrderCopy[] = [];
    for (const key of Object.keys(localStorage).filter(key => key.startsWith(prefix(scope)) && !key.endsWith(':deleted') && !key.endsWith(':reference'))) {
        const text = localStorage.getItem(key)!;
        try {
            const request = decodeOrderCopyAttempt(text, scope);
            if (key !== keyOf(request))
                throw Error();
            rows.push({
                key, text, request, deleted: localStorage.getItem(marker(key)) === text, error: ''
            });
        }
        catch {
            rows.push({
                key, text, request: null, deleted: false, error: '최초 주문 원문이 손상되어 자동으로 다시 저장하지 않습니다.'
            });
        }
    }
    return rows;
}
export async function deletePendingOrderCopy(entry: PendingOrderCopy): Promise<void> {
    if (!entry.request)
        throw Error('최초 주문 원문을 확인한 뒤 삭제해 주세요.');
    await locked(entry.request, () => {
        clearOrderCopyAttempt(localStorage.getItem(entry.key), entry.text);
        localStorage.setItem(marker(entry.key), entry.text);
        if (localStorage.getItem(marker(entry.key)) !== entry.text)
            throw Error('실패 요청 삭제 표시를 확인하지 못했습니다.');
    });
}
async function hash(text: string): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
async function command(request: OrderInterpretationRequest, action: 'submit' | 'inspect', current: () => boolean = () => true, expected?: OrderCopyRecoveryEntry, onSend?: () => void): Promise<OrderCopyResult> {
    if (!current())
        throw Error('현재 작성 화면이 바뀌었습니다.');
    await active(request);
    const key = keyOf(request), text = canonicalOrderInterpretation(request, request);
    const reference = normalizeOrderCopyRecoveryReference({
        companyId: request.companyId, requestId: request.requestId
    }), requestHash = await hash(text), referenceText = JSON.stringify({
        version: 1, actorUid: request.actorUid, reference, requestHash, orderId: request.confirmed.orderDraft.id
    });
    if (action === 'submit')
        await locked(request, () => {
            if (!current())
                throw Error('현재 작성 화면이 바뀌었습니다.');
            if (expected)
                assertCopy(request, expected);
            const existing = localStorage.getItem(key), fixed = prepareOrderCopyAttempt(existing, request, request), savedRef = localStorage.getItem(key + ':reference');
            if (savedRef !== null && savedRef !== referenceText)
                throw Error('참조 사본이 바뀌어 다시 보내지 않았습니다.');
            localStorage.setItem(key + ':reference', referenceText);
            if (existing === null)
                localStorage.setItem(key, fixed);
            if (localStorage.getItem(key) !== fixed || localStorage.getItem(key + ':reference') !== referenceText)
                throw Error('최초 주문 원문과 참조 저장을 확인하지 못했습니다.');
        });
    const call = httpsCallable<Record<string, unknown>, OrderCopyResult>(functions, 'submitOrderCopyCommand');
    const { getDoc, doc } = await import('firebase/firestore');
    const { db } = await import('../firebase');
    const gate = action === 'submit' ? (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data() : undefined;
    await active(request);
    if (!current())
        throw Error('현재 작성 화면이 바뀌었습니다. 원문은 보존했습니다.');
    if (action === 'submit' && (localStorage.getItem(key) !== text || localStorage.getItem(key + ':reference') !== referenceText))
        throw Error('보관 원문 또는 참조가 바뀌어 다시 보내지 않았습니다.');
    onSend?.();
    const result = (await call({
        action, requestText: text, requestHash, ...(gate ? {
            releaseId: gate.releaseId
        } : {})
    })).data;
    await active(request);
    if (!current())
        throw Error('현재 작성 화면이 바뀌었습니다. 원문은 보존했습니다.');
    if (!result || !['applied', 'duplicate', 'rejected', 'unknown'].includes(result.status) || result.requestId !== request.requestId || result.orderId !== request.confirmed.orderDraft.id || result.requestHash !== requestHash)
        throw Error('최초 주문 처리 응답을 확인하지 못했습니다. 원문을 보존했습니다.');
    if (['applied', 'duplicate', 'rejected'].includes(result.status))
        await locked(request, () => {
            if (!current())
                throw Error('현재 작성 화면이 바뀌었습니다.');
            const saved = localStorage.getItem(key), savedReference = localStorage.getItem(key + ':reference');
            if (saved !== null || savedReference !== null) {
                if (saved !== null)
                    clearOrderCopyAttempt(saved, text);
                if (savedReference !== referenceText)
                    throw Error('참조 사본이 바뀌어 정리하지 않았습니다.');
                localStorage.removeItem(key);
                localStorage.removeItem(key + ':reference');
                if (localStorage.getItem(key) !== null || localStorage.getItem(key + ':reference') !== null)
                    throw Error('기기 사본 정리를 확인하지 못했습니다.');
                if (localStorage.getItem(marker(key)) === text)
                    localStorage.removeItem(marker(key));
            }
        });
    return result;
}
export const submitOrderCopy = (request: OrderInterpretationRequest) => command(request, 'submit');
export const inspectOrderCopy = (request: OrderInterpretationRequest) => command(request, 'inspect');
export interface OrderCopyRecoveryEntry {
    key: string;
    bodyText: string | null;
    referenceText: string | null;
    reference: OrderCopyRecoveryReference | null;
    request: OrderInterpretationRequest | null;
    requestHash: string | null;
    referenceHash: string | null;
    orderId: string | null;
    status: 'valid' | 'legacy' | 'corrupt' | 'missing';
    description: string;
}
export interface OrderCopyRecoveryObservation {
    outcome: SaveOutcome;
    terminal: boolean;
    result?: OrderCopyRecoveryResult;
    copyMismatch?: boolean;
}
const recoveryUnknown = (message: string): OrderCopyRecoveryObservation => ({
    terminal: false, outcome: {
        status: 'unknown', message, nextAction: '같은 요청의 결과를 확인하거나 미처리 요청 중단을 선택해 주세요. 새 주문을 다시 보내지 마세요.'
    }
});
function assertCopy(scope: OrderInterpretationScope, entry: OrderCopyRecoveryEntry) {
    const expected = entry.reference ? prefix(scope) + encodeURIComponent(entry.reference.requestId) : null;
    if (!entry.key.startsWith(prefix(scope)) || expected !== null && entry.key !== expected || entry.reference?.companyId && entry.reference.companyId !== scope.companyId)
        throw Error('현재 회사와 계정에서 관측한 사본이 아닙니다.');
    if (localStorage.getItem(entry.key) !== entry.bodyText || localStorage.getItem(entry.key + ':reference') !== entry.referenceText)
        throw Error('관측한 주문 원문 또는 참조가 바뀌었습니다. 다시 읽어 주세요.');
}
async function clearRecoveryCopy(scope: OrderInterpretationScope, entry: OrderCopyRecoveryEntry, current: () => boolean) {
    await locked(scope, () => {
        if (!current())
            throw Error('현재 회사 또는 작성 화면이 바뀌었습니다.');
        assertCopy(scope, entry);
        localStorage.removeItem(entry.key);
        localStorage.removeItem(entry.key + ':reference');
        if (localStorage.getItem(marker(entry.key)) === entry.bodyText)
            localStorage.removeItem(marker(entry.key));
        if (localStorage.getItem(entry.key) !== null || localStorage.getItem(entry.key + ':reference') !== null)
            throw Error('기기 사본 정리를 확인하지 못했습니다.');
    });
}
async function recoveryCheck(scope: OrderInterpretationScope, current: () => boolean) {
    if (!current())
        throw Error('현재 회사 또는 작성 화면이 바뀌었습니다.');
    await active(scope);
    if (!current())
        throw Error('현재 회사 또는 작성 화면이 바뀌었습니다.');
}
export async function readOrderCopyRecoveries(scope: OrderInterpretationScope, current: () => boolean = () => true): Promise<OrderCopyRecoveryEntry[]> {
    await recoveryCheck(scope, current);
    const keys = new Set<string>();
    for (const k of Object.keys(localStorage))
        if (k.startsWith(prefix(scope)) && !k.endsWith(':deleted'))
            keys.add(k.endsWith(':reference') ? k.slice(0, -10) : k);
    const rows: OrderCopyRecoveryEntry[] = [];
    for (const k of keys) {
        const bodyText = localStorage.getItem(k), referenceText = localStorage.getItem(k + ':reference');
        let reference: OrderCopyRecoveryReference | null = null, request: OrderInterpretationRequest | null = null, requestHash: string | null = null, referenceHash: string | null = null, orderId: string | null = null;
        try {
            reference = normalizeOrderCopyRecoveryReference({
                companyId: scope.companyId, requestId: decodeURIComponent(k.slice(prefix(scope).length))
            });
        }
        catch { }
        try {
            request = decodeOrderCopyAttempt(bodyText!, scope);
            if (keyOf(request) !== k || canonicalOrderInterpretation(request, scope) !== bodyText)
                throw Error();
            orderId = typeof request.confirmed.orderDraft.id === 'string' ? request.confirmed.orderDraft.id : null;
            requestHash = await hash(bodyText!);
        }
        catch {
            request = null;
            requestHash = null;
        }
        try {
            const v = JSON.parse(referenceText!);
            if (v.version !== 1 || v.actorUid !== scope.actorUid || JSON.stringify(normalizeOrderCopyRecoveryReference(v.reference)) !== JSON.stringify(reference) || !/^[a-f0-9]{64}$/.test(v.requestHash) || typeof v.orderId !== 'string')
                throw Error();
            referenceHash = v.requestHash;
            if (!orderId)
                orderId = v.orderId;
        }
        catch { }
        const valid = !!request && !!requestHash && !!orderId && (referenceText === null || referenceHash === requestHash);
        rows.push({
            key: k, bodyText, referenceText, reference, request, requestHash, referenceHash, orderId, status: valid ? (referenceText === null ? 'legacy' : 'valid') : bodyText === null ? 'missing' : 'corrupt', description: request ? `${String(request.confirmed.orderDraft.partnerName ?? '거래처 확인 필요')} · ${String(request.confirmed.orderDraft.deliveryDate ?? '날짜 확인 필요')} · ${request.requestId}` : '원문 확인이 필요한 복사 주문 · ' + (reference?.requestId ?? '식별 불가')
        });
    }
    await recoveryCheck(scope, current);
    return rows;
}
export async function resolveOrderCopyRecovery(scope: OrderInterpretationScope, entry: OrderCopyRecoveryEntry, action: 'inspect' | 'stop', current: () => boolean = () => true): Promise<OrderCopyRecoveryObservation> {
    try {
        await recoveryCheck(scope, current);
        assertCopy(scope, entry);
        if (!entry.reference)
            throw Error('요청 번호를 식별할 수 없어 서버 처리 여부를 확인하지 못했습니다. 원문과 주문 목록을 직접 대조해 주세요.');
        const result = normalizeOrderCopyRecoveryResult((await httpsCallable(functions, 'submitOrderCopyCommand')({
            action, reference: entry.reference
        })).data, entry.reference, scope.actorUid);
        await recoveryCheck(scope, current);
        if (result.status === 'unknown')
            return {
                ...recoveryUnknown(result.message), result
            };
        const hasCopy = entry.bodyText !== null || entry.referenceText !== null;
        if (!hasCopy)
            return {
                terminal: false, copyMismatch: true, result, outcome: {
                    status: 'rejected', message: result.message + ' 이 기기에 보관 원문이 없는 과거 처리 기록입니다. 현재 입력의 저장 완료로 처리하지 않았습니다.', nextAction: '현재 입력은 그대로 유지했습니다. 실제 주문 내용을 확인한 뒤 필요한 새 업무를 명시적으로 진행해 주세요.'
                }
            };
        if (entry.bodyText !== null && !entry.requestHash || entry.referenceText !== null && !entry.referenceHash || result.requestHash !== null && ((entry.requestHash ?? entry.referenceHash) !== result.requestHash || entry.referenceHash !== null && entry.referenceHash !== result.requestHash) || result.status === 'applied' && entry.orderId !== result.orderId)
            return {
                terminal: false, copyMismatch: true, result, outcome: {
                    status: 'rejected', message: result.message + ' 보관된 원문과 일치한다고 확인하지 못해 이 사본을 보존했습니다.', nextAction: '처리 내용을 확인한 뒤 관측한 이 기기 사본만 명시적으로 정리해 주세요.'
                }
            };
        try {
            await clearRecoveryCopy(scope, entry, current);
        }
        catch (error) {
            return {
                terminal: false, result, outcome: result.status === 'applied' ? {
                    status: 'partial', reason: 'followup-unconfirmed', committedIds: [entry.reference.requestId], unconfirmedIds: [], message: result.message + ' 기기 사본 정리를 확인하지 못했습니다.', nextAction: '주문을 다시 저장하지 말고 같은 요청을 조회하거나 기기 사본을 정리해 주세요.'
                } : {
                    status: 'unknown', message: error instanceof Error ? error.message : String(error), nextAction: '서버 종결 결과를 확인한 뒤 같은 기기 사본을 다시 확인해 주세요.'
                }
            };
        }
        return {
            terminal: true, result, outcome: result.status === 'applied' ? {
                status: 'saved'
            } : {
                status: result.status === 'stopped' ? 'cancelled' : 'rejected', message: result.message, nextAction: '현재 주문을 확인한 뒤 필요한 내용을 새로 작성해 주세요.'
            }
        };
    }
    catch (error) {
        return recoveryUnknown(error instanceof Error ? error.message : String(error));
    }
}
function observationFromAck(request: OrderInterpretationRequest, ack: OrderCopyResult): OrderCopyRecoveryObservation {
    if (ack.status === 'unknown')
        return recoveryUnknown(ack.reason ?? '주문 처리 결과를 확인하지 못했습니다.');
    const result: OrderCopyRecoveryResult = {
        version: 1, reference: {
            companyId: request.companyId, requestId: request.requestId
        }, actorUid: request.actorUid, status: ack.status === 'rejected' ? 'rejected' : 'applied', requestHash: ack.requestHash, message: ack.reason ?? (ack.status === 'rejected' ? '이번 요청으로 주문을 저장하지 않았습니다.' : '주문 저장을 확인했습니다.'), orderId: ack.orderId
    };
    return {
        terminal: true, result, outcome: ack.status === 'rejected' ? {
            status: 'rejected', message: result.message, nextAction: '거절 이유를 확인한 뒤 수정해서 새 요청을 작성해 주세요.'
        } : {
            status: 'saved'
        }
    };
}
export async function sendOrderCopyRecovery(request: OrderInterpretationRequest, current: () => boolean = () => true): Promise<OrderCopyRecoveryObservation> {
    let sent = false;
    try {
        return observationFromAck(request, await command(request, 'submit', current, undefined, () => { sent = true; }));
    }
    catch (error) {
        if (!current())
            return recoveryUnknown('현재 회사 또는 작성 화면이 바뀌어 이전 원문을 보존했습니다.');
        const entry = (await readOrderCopyRecoveries(request, current)).find(row => row.reference?.requestId === request.requestId);
        if (entry) {
            const observed = await resolveOrderCopyRecovery(request, entry, 'inspect', current);
            if (observed.result?.status !== 'unknown' && observed.result)
                return observed;
        }
        if (!entry && !sent)
            return {
                terminal: false, outcome: {
                    status: 'rejected', message: error instanceof Error ? error.message : String(error), nextAction: '최초 원문을 보관하지 못해 주문 요청을 보내지 않았습니다. 입력과 기기 보관 상태를 확인해 주세요.'
                }
            };
        return recoveryUnknown(error instanceof Error ? error.message : String(error));
    }
}
export async function retryOrderCopyRecovery(scope: OrderInterpretationScope, entry: OrderCopyRecoveryEntry, current: () => boolean = () => true): Promise<OrderCopyRecoveryObservation> {
    try {
        await recoveryCheck(scope, current);
        assertCopy(scope, entry);
        if (!entry.request || !entry.requestHash || !['valid', 'legacy'].includes(entry.status) || await hash(entry.bodyText!) !== entry.requestHash || entry.referenceHash !== null && entry.referenceHash !== entry.requestHash)
            throw Error('최초 주문 원문을 검증하지 못해 다시 보내지 않았습니다.');
        await recoveryCheck(scope, current);
        assertCopy(scope, entry);
        return observationFromAck(entry.request, await command(entry.request, 'submit', current, entry));
    }
    catch (error) {
        if (current() && entry.reference)
            return resolveOrderCopyRecovery(scope, entry, 'inspect', current);
        return recoveryUnknown(error instanceof Error ? error.message : String(error));
    }
}
export async function discardOrderCopyRecovery(scope: OrderInterpretationScope, entry: OrderCopyRecoveryEntry, current: () => boolean = () => true) {
    try {
        await recoveryCheck(scope, current);
        assertCopy(scope, entry);
        if (entry.bodyText === null && entry.referenceText === null)
            throw Error('관측한 기기 사본이 없습니다.');
        if (entry.reference) {
            const result = normalizeOrderCopyRecoveryResult((await httpsCallable(functions, 'submitOrderCopyCommand')({
                action: 'inspect', reference: entry.reference
            })).data, entry.reference, scope.actorUid);
            await recoveryCheck(scope, current);
            if (result.status === 'unknown')
                throw Error(result.message + ' 먼저 미처리 요청 중단을 확인해 주세요.');
        }
        await clearRecoveryCopy(scope, entry, current);
        return {
            status: 'cleared' as const, message: '이 기기 사본만 정리했습니다. 생성된 주문을 삭제하거나 서버 미처리를 확인한 것은 아닙니다.'
        };
    }
    catch (error) {
        return {
            status: 'blocked' as const, message: error instanceof Error ? error.message : String(error)
        };
    }
}
export async function listOrderCopyRecoveryHistory(scope: OrderInterpretationScope, cursor?: string, current: () => boolean = () => true) {
    await recoveryCheck(scope, current);
    const response = await httpsCallable(functions, 'submitOrderCopyCommand')({
        action: 'listHistory', companyId: scope.companyId, ...(cursor ? {
            cursor
        } : {})
    });
    await recoveryCheck(scope, current);
    return normalizeOrderCopyRecoveryHistoryResult(response.data, scope);
}
/** 명시적으로 같은 전체 입력을 다시 확인하는 현재 작성에만 사용한다. 일반 이력 승격과 분리한다. */
export async function reconnectOrderCopyRecovery(request: OrderInterpretationRequest, current: () => boolean = () => true): Promise<OrderCopyRecoveryObservation> {
    const scope = {
        companyId: request.companyId, actorUid: request.actorUid
    }, key = keyOf(request), reference = {
        companyId: request.companyId, requestId: request.requestId
    };
    try {
        await recoveryCheck(scope, current);
        const before = (await readOrderCopyRecoveries(scope, current)).find(entry => entry.key === key);
        if (before)
            return resolveOrderCopyRecovery(scope, before, 'inspect', current);
        const text = canonicalOrderInterpretation(request, scope), expectedHash = await hash(text);
        await recoveryCheck(scope, current);
        if (localStorage.getItem(key) !== null || localStorage.getItem(key + ':reference') !== null)
            throw Error('보관 사본이 바뀌어 현재 작성을 완료하지 않았습니다.');
        const result = normalizeOrderCopyRecoveryResult((await httpsCallable(functions, 'submitOrderCopyCommand')({
            action: 'inspect', reference
        })).data, reference, scope.actorUid);
        await recoveryCheck(scope, current);
        if (localStorage.getItem(key) !== null || localStorage.getItem(key + ':reference') !== null)
            throw Error('조회 중 보관 사본이 생겨 현재 작성을 완료하지 않았습니다.');
        if (result.status === 'applied' && result.requestHash === expectedHash && result.orderId === request.confirmed.orderDraft.id)
            return {
                terminal: true, result, outcome: {
                    status: 'saved'
                }
            };
        return {
            terminal: false, result, copyMismatch: result.status === 'applied', outcome: {
                status: result.status === 'unknown' ? 'unknown' : 'rejected', message: result.message, nextAction: '현재 입력은 보존했습니다. 처리 내용을 확인하고 필요한 내용을 별도로 새로 작성해 주세요.'
            }
        };
    }
    catch (error) {
        return recoveryUnknown(error instanceof Error ? error.message : String(error));
    }
}
export const orderCopyRecoveryServices = {
    read: readOrderCopyRecoveries, send: sendOrderCopyRecovery, resolve: resolveOrderCopyRecovery, retry: retryOrderCopyRecovery, discard: discardOrderCopyRecovery, list: listOrderCopyRecoveryHistory, reconnect: reconnectOrderCopyRecovery
};
export interface OrderInterpretationRule {
    ruleId: string;
    companyId: OrderInterpretationScope['companyId'];
    partnerId: string;
    alias: string;
    itemId: string;
    status: 'proposed' | 'approved' | 'stopped';
    revision: number;
    captureIds: string[];
    orderIds: string[];
    kind?: 'alias' | 'expression';
    scope?: 'partner' | 'company';
    target?: 'note';
    value?: string;
}
export async function listOrderInterpretationRules(companyId: OrderInterpretationScope['companyId'], includeAll = false): Promise<OrderInterpretationRule[]> {
    await authReady;
    const scope = {
        companyId, actorUid: auth.currentUser?.uid ?? ''
    };
    await active(scope, includeAll);
    const call = httpsCallable<Record<string, unknown>, OrderInterpretationRule[]>(functions, 'listOrderInterpretationRulesCommand');
    const result = (await call({
        companyId, includeAll
    })).data;
    await active(scope, includeAll);
    return result;
}
export async function reviewOrderInterpretationRule(input: {
    companyId: OrderInterpretationScope['companyId'];
    ruleId: string;
    expectedRevision: number;
    action: 'approve' | 'stop';
}): Promise<OrderInterpretationRule> {
    await authReady;
    const scope = {
        companyId: input.companyId, actorUid: auth.currentUser?.uid ?? ''
    };
    await active(scope, true);
    const { getDoc, doc } = await import('firebase/firestore');
    const { db } = await import('../firebase');
    const gate = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();
    await active(scope, true);
    const call = httpsCallable<Record<string, unknown>, OrderInterpretationRule>(functions, 'reviewOrderInterpretationRuleCommand');
    const result = (await call({
        ...input, releaseId: gate?.releaseId
    })).data;
    await active(scope, true);
    return result;
}
