import { auth } from '../firebase';
import { applyPurchaseOrderBatch, inspectPurchaseOrderBatch, cancelPurchaseOrderBatch, purchaseOrderBatchReference, serializePurchaseOrderBatchRequest, normalizePurchaseOrderBatchReference, type PurchaseOrderBatchRequest, type PurchaseOrderBatchReference, type PurchaseOrderBatchResult, type PurchaseOrderBatchScope, } from './purchaseOrderBatchService';
export type PurchaseBatchEntry = {
    key: string;
    bodyRaw: string | null;
    referenceRaw: string | null;
    request: PurchaseOrderBatchRequest | null;
    reference: PurchaseOrderBatchReference | null;
    lastAttempt: string;
    problem: string;
    conflicting: boolean;
};
export type PurchaseBatchObservation = {
    entry: PurchaseBatchEntry | null;
    result?: PurchaseOrderBatchResult;
};
export const PURCHASE_BATCH_EVENT = 'purchase-batch-pending';
type Own = (next: PurchaseBatchEntry | null, previous: PurchaseBatchEntry) => void;
const locks = new Set<string>();
export const purchaseBatchKey = (scope: Pick<PurchaseOrderBatchScope, 'companyId' | 'actorUid'>) => `purchase-batch-v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function owner(scope: PurchaseOrderBatchScope) {
    if (!scope.actorUid || auth.currentUser?.uid !== scope.actorUid || !scope.isCurrent())
        throw Error('회사 또는 로그인 계정이 바뀌었습니다. 보관된 요청은 유지했습니다.');
}
function pair(scope: PurchaseOrderBatchScope, entry: PurchaseBatchEntry) {
    owner(scope);
    if (entry.key !== purchaseBatchKey(scope) || localStorage.getItem(entry.key) !== entry.bodyRaw
        || localStorage.getItem(entry.key + ':reference') !== entry.referenceRaw)
        throw Error('기기에 보관된 발주 요청이 바뀌었습니다. 보관된 요청을 다시 읽어 주세요.');
}
function notify() { window.dispatchEvent(new Event(PURCHASE_BATCH_EVENT)); }
async function exclusive<T>(scope: PurchaseOrderBatchScope, work: () => Promise<T>): Promise<T> {
    const key = purchaseBatchKey(scope);
    owner(scope);
    if (locks.has(key))
        throw Error('발주 요청을 처리 중입니다. 잠시 뒤 다시 확인해 주세요.');
    locks.add(key);
    try {
        const run = async () => { owner(scope); return work(); };
        return typeof navigator !== 'undefined' && navigator.locks
            ? await navigator.locks.request(key, run) : await run();
    }
    finally {
        locks.delete(key);
    }
}
function referenceOf(raw: unknown, scope: PurchaseOrderBatchScope): PurchaseOrderBatchReference | null {
    try {
        const value = normalizePurchaseOrderBatchReference(raw);
        return value.companyId === scope.companyId && value.actorUid === scope.actorUid ? value : null;
    }
    catch {
        return null;
    }
}
export async function readPurchaseBatch(scope: PurchaseOrderBatchScope): Promise<PurchaseBatchEntry | null> {
    owner(scope);
    const key = purchaseBatchKey(scope), bodyRaw = localStorage.getItem(key), referenceRaw = localStorage.getItem(key + ':reference');
    if (bodyRaw === null && referenceRaw === null)
        return null;
    let request: PurchaseOrderBatchRequest | null = null, reference: PurchaseOrderBatchReference | null = null;
    let lastAttempt = '', problem = '', conflicting = false;
    try {
        const side = JSON.parse(referenceRaw ?? 'null');
        if (side?.version === 1) {
            reference = referenceOf(side.reference, scope);
            if (typeof side.lastAttempt === 'string')
                lastAttempt = side.lastAttempt;
        }
    }
    catch { /* 손상된 원문은 명시 정리 전까지 보존한다. */ }
    try {
        const body = JSON.parse(bodyRaw ?? 'null');
        if (body?.version !== 1)
            throw Error();
        const candidate = body.request as PurchaseOrderBatchRequest;
        if (candidate.companyId !== scope.companyId || candidate.actorUid !== scope.actorUid)
            throw Error();
        // 직렬화/해시는 실제 발주 서비스의 정본만 사용한다.
        serializePurchaseOrderBatchRequest(candidate);
        const calculated = await purchaseOrderBatchReference(candidate);
        owner(scope);
        if (reference && !same(calculated, reference)) {
            conflicting = true;
            problem = '본문과 참조에 서로 다른 발주가 남아 있습니다. 두 요청을 확인해야 하므로 사본을 정리하지 않았습니다.';
            throw Error();
        }
        if (!reference) {
            reference = calculated;
            throw Error();
        }
        request = candidate;
    }
    catch {
        if (!conflicting)
            problem = reference ? '보관된 발주 본문을 확인할 수 없습니다. 다시 보내지 말고 처리 결과를 조회하거나 미처리 요청을 중단해 주세요.' : '발주 참조를 식별할 수 없어 처리 결과 확인과 사본 정리를 중단했습니다. 원문은 유지했습니다.';
    }
    owner(scope);
    return { key, bodyRaw, referenceRaw, request, reference, lastAttempt, problem, conflicting };
}
export async function preparePurchaseBatch(scope: PurchaseOrderBatchScope, request: PurchaseOrderBatchRequest): Promise<PurchaseBatchEntry> {
    return exclusive(scope, async () => {
        if (await readPurchaseBatch(scope))
            throw Error('이 기기에 보관된 발주가 있습니다. 처리 결과를 확인하고 사본을 정리한 뒤 새 발주를 시작해 주세요.');
        if (request.companyId !== scope.companyId || request.actorUid !== scope.actorUid)
            throw Error('발주 요청의 회사 또는 계정이 다릅니다.');
        const reference = await purchaseOrderBatchReference(request);
        owner(scope);
        const key = purchaseBatchKey(scope);
        const bodyRaw = JSON.stringify({ version: 1, request: JSON.parse(serializePurchaseOrderBatchRequest(request)) });
        const referenceRaw = JSON.stringify({ version: 1, reference });
        if (localStorage.getItem(key) !== null || localStorage.getItem(key + ':reference') !== null)
            throw Error('다른 발주가 보관되었습니다. 다시 읽어 주세요.');
        // 둘 중 하나만 기록되어도 송신하지 않는다. 남은 참조는 조회·중단에 사용한다.
        localStorage.setItem(key + ':reference', referenceRaw);
        localStorage.setItem(key, bodyRaw);
        const entry = await readPurchaseBatch(scope);
        if (!entry || entry.bodyRaw !== bodyRaw || entry.referenceRaw !== referenceRaw || !entry.request)
            throw Error('발주 원문 보관을 확인하지 못해 보내지 않았습니다. 보관된 요청을 다시 읽어 주세요.');
        pair(scope, entry);
        notify();
        return entry;
    });
}
export async function commandPurchaseBatch(scope: PurchaseOrderBatchScope, entry: PurchaseBatchEntry, mode: 'apply' | 'inspect' | 'cancel', onOwn?: Own): Promise<PurchaseBatchObservation> {
    return exclusive(scope, async () => {
        pair(scope, entry);
        const fresh = await readPurchaseBatch(scope);
        if (!fresh || fresh.bodyRaw !== entry.bodyRaw || fresh.referenceRaw !== entry.referenceRaw)
            throw Error('보관된 발주가 바뀌었습니다. 다시 읽어 주세요.');
        entry = fresh;
        pair(scope, entry);
        if (entry.conflicting)
            throw Error(entry.problem);
        if (!entry.reference || mode === 'apply' && !entry.request)
            throw Error('보관된 원문을 확인할 수 없어 다시 보내지 않았습니다.');
        try {
            const result = mode === 'apply' ? await applyPurchaseOrderBatch(scope, entry.request!)
                : mode === 'inspect' ? await inspectPurchaseOrderBatch(scope, entry.reference)
                    : await cancelPurchaseOrderBatch(scope, entry.reference);
            pair(scope, entry);
            if (!same(result.reference, entry.reference))
                throw Error('요청과 처리 결과가 다릅니다. 보관 원문을 유지했습니다.');
            return { entry, result };
        }
        catch (error) {
            if (mode !== 'apply')
                throw error;
            pair(scope, entry);
            const message = error instanceof Error ? error.message : '발주 저장 응답을 확인하지 못했습니다.';
            try {
                const side = JSON.parse(entry.referenceRaw!);
                const nextRaw = JSON.stringify({ ...side, lastAttempt: message.slice(0, 500) });
                pair(scope, entry);
                localStorage.setItem(entry.key + ':reference', nextRaw);
                if (localStorage.getItem(entry.key) !== entry.bodyRaw || localStorage.getItem(entry.key + ':reference') !== nextRaw)
                    throw Error('오류 기록을 보관하는 동안 사본이 바뀌었습니다.');
                const next = { ...entry, referenceRaw: nextRaw, lastAttempt: message };
                onOwn?.(next, entry);
                notify();
            }
            catch (metadataError) {
                throw Object.assign(Error(`${message} 오류 기록 보관에도 실패했습니다. 처리 결과를 먼저 확인해 주세요.`), { cause: error, metadataError });
            }
            throw error;
        }
    });
}
export async function discardPurchaseBatch(scope: PurchaseOrderBatchScope, entry: PurchaseBatchEntry, onOwn?: Own): Promise<void> {
    return exclusive(scope, async () => {
        pair(scope, entry);
        const fresh = await readPurchaseBatch(scope);
        if (!fresh || fresh.bodyRaw !== entry.bodyRaw || fresh.referenceRaw !== entry.referenceRaw)
            throw Error('보관된 발주가 바뀌었습니다. 다시 읽어 주세요.');
        entry = fresh;
        pair(scope, entry);
        if (entry.conflicting)
            throw Error(entry.problem);
        if (!entry.reference)
            throw Error('발주 참조를 식별할 수 없어 사본을 정리하지 않았습니다. 원문은 유지했습니다.');
        if (entry.reference) {
            const result = await inspectPurchaseOrderBatch(scope, entry.reference);
            pair(scope, entry);
            if (!same(result.reference, entry.reference) || result.status === 'not-found')
                throw Error('미처리 여부를 확정하지 못했습니다. 요청을 중단한 뒤 사본을 정리해 주세요.');
        }
        pair(scope, entry);
        localStorage.removeItem(entry.key);
        owner(scope);
        if (localStorage.getItem(entry.key) !== null || localStorage.getItem(entry.key + ':reference') !== entry.referenceRaw)
            throw Error('보관 사본 정리를 확인하지 못했습니다. 삭제 중 사본이 바뀌었거나 그대로 남아 있습니다. 남은 사본은 지우지 않았습니다. 다시 읽어 주세요.');
        localStorage.removeItem(entry.key + ':reference');
        owner(scope);
        if (localStorage.getItem(entry.key) !== null || localStorage.getItem(entry.key + ':reference') !== null)
            throw Error('보관 사본 정리를 확인하지 못했습니다. 다시 읽어 주세요. 새 발주는 보내지 않았습니다.');
        onOwn?.(null, entry);
        notify();
    });
}
export const purchaseBatchWrites = { read: readPurchaseBatch, prepare: preparePurchaseBatch, command: commandPurchaseBatch, discard: discardPurchaseBatch };
