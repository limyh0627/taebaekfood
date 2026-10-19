import { normalizePartnerPaymentReference, normalizePartnerPaymentRecoveryResult, normalizePartnerPaymentListResult, serializePartnerPaymentRequest, type PartnerPaymentReference, type PartnerPaymentRecoveryResult, type PartnerPaymentRecoveryCommand } from '../../../shared/partnerPaymentRecovery';
import type { SaveOutcome } from '../../../shared/saveOutcome';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../../../shared/firebase';
export type PartnerPaymentInput = {
    tradeDate: string;
    partnerId: string;
    direction: '입금' | '출금';
    amount: number;
    cashAccountId: string;
    pin: boolean;
    allocations: {
        statementId: string;
        amount: number;
    }[];
    note?: string;
};
export function validatePartnerPaymentInput(input: PartnerPaymentInput) {
    const validDay = /^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate)
        && Number.isFinite(Date.parse(`${input.tradeDate}T00:00:00Z`))
        && new Date(`${input.tradeDate}T00:00:00Z`).toISOString().slice(0, 10) === input.tradeDate;
    if (!validDay || !input.partnerId || input.partnerId.includes('/') || !input.cashAccountId || input.cashAccountId.includes('/')
        || !['입금', '출금'].includes(input.direction) || !Number.isSafeInteger(input.amount) || input.amount <= 0
        || typeof input.pin !== 'boolean' || !Array.isArray(input.allocations)
        || input.allocations.some(row => !row || !row.statementId || row.statementId.includes('/') || !Number.isSafeInteger(row.amount) || row.amount <= 0)
        || new Set(input.allocations.map(row => row.statementId)).size !== input.allocations.length
        || input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500))
        throw new Error('수금·지불 날짜·금액·대상·입력을 확인해 주세요.');
}
/** 서버가 종결을 확인한 거절·중단을 네트워크 미확인과 구분한다. */
export class PartnerPaymentTerminalError extends Error {
    constructor(readonly outcome: Extract<SaveOutcome, {
        status: 'rejected' | 'cancelled';
    }>) {
        super(outcome.message);
    }
}
export function paymentTerminalFailure(error: unknown, reference: PartnerPaymentReference, status: 'cancelled' | 'rejected') {
    const details = (error as {
        details?: Record<string, Record<string, unknown>>;
    })?.details;
    const value = details?.[status === 'cancelled' ? 'partnerPaymentCancelled' : 'partnerPaymentFailure'];
    return value?.version === 1 && value.companyId === reference.companyId && value.partnerId === reference.partnerId && value.operationId === reference.operationId && value[status === 'cancelled' ? 'operationCancelled' : 'operationRejected'] === true && value.financialWrites === false;
}
export interface PartnerPaymentRecoveryScope {
    companyId: 'taebaek' | 'punghoe';
    actorUid: string;
    partnerId: string;
}
export type StoredPartnerPaymentRequest = PartnerPaymentInput & {
    operationId: string;
    expectedRevision: number;
    releaseId: string;
};
export interface PartnerPaymentRecoveryEntry {
    key: string;
    bodyText: string | null;
    sidecarKey: string | null;
    sidecarText: string | null;
    reference: PartnerPaymentReference | null;
    request: StoredPartnerPaymentRequest | null;
    requestHash: string | null;
    sidecarHash: string | null;
    status: 'valid' | 'legacy' | 'corrupt' | 'missing';
    description: string;
}
export interface PartnerPaymentRecoveryOutcome {
    outcome: SaveOutcome;
    terminal: boolean;
    serverResult?: PartnerPaymentRecoveryResult;
    copyMismatch?: boolean;
}
export interface PartnerPaymentRecoveryPort {
    storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
    assertScope: (scope: PartnerPaymentRecoveryScope, isCurrent: () => boolean) => Promise<void>;
    command: (command: PartnerPaymentRecoveryCommand) => Promise<unknown>;
    apply: (request: StoredPartnerPaymentRequest) => Promise<unknown>;
}
const paymentBodyKey = (s: PartnerPaymentRecoveryScope) => 'partner-payment-pending:' + s.companyId + ':' + s.partnerId + ':' + s.actorUid;
export const paymentReferenceKey = (s: PartnerPaymentRecoveryScope, operationId: string) => paymentBodyKey(s) + ':ref:' + encodeURIComponent(operationId);
export const paymentHash = async (request: Record<string, unknown>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serializePartnerPaymentRequest(request))))].map(n => n.toString(16).padStart(2, '0')).join('');
export function clearPaymentCopies(storage: Pick<Storage, 'getItem' | 'removeItem'>, copies: {
    key: string;
    text: string | null;
}[]) {
    // 모든 사본을 먼저 대조한다. 응답 대기 중 다른 원문으로 교체됐으면 하나도 지우지 않는다.
    for (const copy of copies)
        if (storage.getItem(copy.key) !== copy.text)
            throw Error('보관된 수금 사본이 바뀌어 정리하지 않았습니다.');
    for (const copy of copies) {
        storage.removeItem(copy.key);
        if (storage.getItem(copy.key) !== null)
            throw Error('보관된 수금 사본 정리를 확인하지 못했습니다.');
    }
}
const paymentUnknown = (message = '수금·지불 처리 결과를 확인하지 못했습니다.'): SaveOutcome => ({
    status: 'unknown', message, nextAction: '보관된 최초 요청의 결과 확인 또는 미처리 요청 중단을 선택해 주세요. 새 결제로 다시 작성하지 마세요.'
});
function storedPayment(value: unknown, scope: PartnerPaymentRecoveryScope): StoredPartnerPaymentRequest | null {
    try {
        const row = value as {
            version?: number;
            fingerprint?: string;
            request?: StoredPartnerPaymentRequest;
        }, r = row.request;
        if (row.version !== 2 || !r || r.partnerId !== scope.partnerId || !['입금', '출금'].includes(r.direction) || !Number.isSafeInteger(r.amount) || r.amount <= 0 || !Number.isSafeInteger(r.expectedRevision) || r.expectedRevision < 0 || !r.releaseId || !/^[A-Za-z0-9_-]{1,100}$/.test(r.releaseId) || !r.cashAccountId || !Array.isArray(r.allocations) || typeof r.tradeDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.tradeDate) || !Number.isFinite(Date.parse(r.tradeDate + 'T00:00:00Z')) || new Date(r.tradeDate + 'T00:00:00Z').toISOString().slice(0, 10) !== r.tradeDate)
            return null;
        validatePartnerPaymentInput(r);
        normalizePartnerPaymentReference({
            companyId: scope.companyId, partnerId: scope.partnerId, operationId: r.operationId
        });
        const business = {
            tradeDate: r.tradeDate, partnerId: r.partnerId, direction: r.direction, amount: r.amount, cashAccountId: r.cashAccountId, pin: r.pin, allocations: r.allocations, note: r.note
        };
        if (JSON.stringify(business) !== row.fingerprint)
            return null;
        return r;
    }
    catch {
        return null;
    }
}
function inferredPaymentOperation(text: string | null): string | null {
    if (!text)
        return null;
    try {
        const row = JSON.parse(text);
        return typeof (row.request?.operationId ?? row.operationId) === 'string' ? (row.request?.operationId ?? row.operationId) : null;
    }
    catch {
        // 손상 원문에서 번호가 하나만 명확할 때도 조회/중단만 허용한다. 금액이나 release는 복원하지 않는다.
        const matches = [...text.matchAll(/"operationId"\s*:\s*"([A-Za-z0-9_-]{1,160})"/g)];
        return matches.length === 1 ? matches[0][1] : null;
    }
}
export function createPartnerPaymentRecovery(port: PartnerPaymentRecoveryPort) {
    const check = async (s: PartnerPaymentRecoveryScope, current: () => boolean) => {
        if (!current())
            throw Error('결제 화면이 바뀌었습니다.');
        await port.assertScope(s, current);
        if (!current())
            throw Error('결제 화면이 바뀌었습니다.');
    };
    const read = async (scope: PartnerPaymentRecoveryScope, current: () => boolean = () => true): Promise<PartnerPaymentRecoveryEntry[]> => {
        await check(scope, current);
        const key = paymentBodyKey(scope), body = port.storage.getItem(key), operation = inferredPaymentOperation(body), request = body ? storedPayment((() => {
            try {
                return JSON.parse(body);
            }
            catch {
                return null;
            }
        })(), scope) : null;
        const requestHash = request ? await paymentHash(request) : null, entries: PartnerPaymentRecoveryEntry[] = [];
        const prefix = paymentReferenceKey(scope, '');
        for (let i = 0; i < port.storage.length; i++) {
            const sk = port.storage.key(i);
            if (!sk?.startsWith(prefix))
                continue;
            let reference: PartnerPaymentReference;
            try {
                reference = normalizePartnerPaymentReference({
                    companyId: scope.companyId, partnerId: scope.partnerId, operationId: decodeURIComponent(sk.slice(prefix.length))
                });
            }
            catch {
                entries.push({
                    key, bodyText: null, sidecarKey: sk, sidecarText: port.storage.getItem(sk), reference: null, request: null, requestHash: null, sidecarHash: null, status: 'corrupt', description: '번호를 확인할 수 없는 수금 참조 사본'
                });
                continue;
            }
            const text = port.storage.getItem(sk);
            let sidecarHash: string | null = null;
            try {
                const v = JSON.parse(text!);
                if (v.version !== 1 || v.actorUid !== scope.actorUid || JSON.stringify(normalizePartnerPaymentReference(v.reference)) !== JSON.stringify(reference) || typeof v.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.requestHash))
                    throw Error();
                sidecarHash = v.requestHash;
            }
            catch { }
            const matches = operation === reference.operationId;
            entries.push({
                key, bodyText: matches ? body : null, sidecarKey: sk, sidecarText: text, reference, request: matches ? request : null, requestHash: matches ? requestHash : null, sidecarHash, status: matches && request && sidecarHash === requestHash ? 'valid' : matches ? 'corrupt' : 'missing', description: matches && request ? request.tradeDate + ' · ' + request.amount.toLocaleString() + '원 · ' + reference.operationId : '보관된 수금·지불 · ' + reference.operationId
            });
        }
        if (body !== null && !entries.some(e => e.bodyText !== null)) {
            let reference: PartnerPaymentReference | null = null;
            try {
                if (operation)
                    reference = normalizePartnerPaymentReference({
                        companyId: scope.companyId, partnerId: scope.partnerId, operationId: operation
                    });
            }
            catch { }
            entries.push({
                key, bodyText: body, sidecarKey: null, sidecarText: null, reference, request, requestHash, sidecarHash: null, status: request ? 'valid' : reference ? 'legacy' : 'corrupt', description: request ? request.tradeDate + ' · ' + request.amount.toLocaleString() + '원' : '식별 확인이 필요한 수금·지불 사본'
            });
        }
        await check(scope, current);
        return entries;
    };
    const copies = (entry: PartnerPaymentRecoveryEntry) => [...(entry.bodyText !== null ? [{ key: entry.key, text: entry.bodyText }] : []), ...(entry.sidecarKey ? [{ key: entry.sidecarKey, text: entry.sidecarText }] : [])];
    const fresh = (scope: PartnerPaymentRecoveryScope, entry: PartnerPaymentRecoveryEntry) => {
        if (entry.key !== paymentBodyKey(scope) || entry.sidecarKey !== null && (entry.reference ? entry.sidecarKey !== paymentReferenceKey(scope, entry.reference.operationId) : !entry.sidecarKey.startsWith(paymentReferenceKey(scope, ''))))
            throw Error('다른 계정의 기기 사본입니다.');
        for (const copy of copies(entry))
            if (port.storage.getItem(copy.key) !== copy.text)
                throw Error('선택한 수금 사본이 바뀌었습니다. 다시 읽어 주세요.');
    };
    const validRef = (scope: PartnerPaymentRecoveryScope, ref: PartnerPaymentReference) => {
        normalizePartnerPaymentReference(ref);
        if (ref.companyId !== scope.companyId || ref.partnerId !== scope.partnerId)
            throw Error('다른 회사 또는 거래처 요청입니다.');
    };
    const resolve = async (scope: PartnerPaymentRecoveryScope, entry: PartnerPaymentRecoveryEntry, mode: 'inspect' | 'cancel', current: () => boolean = () => true): Promise<PartnerPaymentRecoveryOutcome> => {
        try {
            await check(scope, current);
            if (!entry.reference)
                throw Error('요청 번호를 확인할 수 없습니다. 서버 이력에서 후보를 직접 확인해 주세요.');
            validRef(scope, entry.reference);
            fresh(scope, entry);
            const value = await port.command({ mode, reference: entry.reference });
            await check(scope, current);
            const result = normalizePartnerPaymentRecoveryResult(value, entry.reference, scope.actorUid);
            if (result.status === 'unknown')
                return {
                    outcome: paymentUnknown(result.message), terminal: false, serverResult: result
                };
            const hasBody = entry.bodyText !== null, hash = entry.requestHash ?? entry.sidecarHash;
            if ((hasBody && !entry.requestHash) || (entry.sidecarKey !== null && entry.sidecarHash === null) || (result.requestHash !== null && hash !== null && result.requestHash !== hash) || (result.requestHash !== null && entry.sidecarHash !== null && result.requestHash !== entry.sidecarHash))
                return {
                    terminal: false, copyMismatch: true, serverResult: result, outcome: {
                        status: 'rejected', message: result.message + ' 이 기기 사본의 원문과 일치한다고 확인하지 못해 보존했습니다.', nextAction: '서버 결과를 확인한 뒤 이 기기 사본만 명시적으로 정리할 수 있습니다.'
                    }
                };
            fresh(scope, entry);
            try {
                clearPaymentCopies(port.storage, copies(entry));
            }
            catch (error) {
                return {
                    terminal: result.status === 'applied', serverResult: result, outcome: result.status === 'applied' ? {
                        status: 'partial', reason: 'followup-unconfirmed', committedIds: [entry.reference.operationId], unconfirmedIds: [], message: '결제는 완료됐지만 기기 사본 정리를 확인하지 못했습니다.', nextAction: '다시 결제하지 말고 같은 요청의 결과를 확인해 주세요.'
                    } : paymentUnknown(error instanceof Error ? error.message : undefined)
                };
            }
            return {
                terminal: true, serverResult: result, outcome: result.status === 'applied' ? { status: 'saved' } : {
                    status: result.status, message: result.message, nextAction: '현재 거래 내역을 확인한 뒤 필요한 경우 새 결제를 작성해 주세요.'
                }
            };
        }
        catch (error) {
            return { terminal: false, outcome: paymentUnknown(error instanceof Error ? error.message : undefined) };
        }
    };
    const discard = async (scope: PartnerPaymentRecoveryScope, entry: PartnerPaymentRecoveryEntry, current: () => boolean = () => true): Promise<{
        status: 'cleared' | 'blocked' | 'unknown';
        message: string;
    }> => {
        try {
            await check(scope, current);
            fresh(scope, entry);
            if (copies(entry).length === 0)
                return { status: 'blocked', message: '관측한 기기 사본이 없어 정리하지 않았습니다.' };
            if (entry.reference) {
                validRef(scope, entry.reference);
                const raw = await port.command({ mode: 'inspect', reference: entry.reference });
                await check(scope, current);
                const result = normalizePartnerPaymentRecoveryResult(raw, entry.reference, scope.actorUid);
                if (result.status === 'unknown')
                    return { status: 'blocked', message: result.message + ' 먼저 미처리 요청 중단을 확인해 주세요.' };
            }
            fresh(scope, entry);
            clearPaymentCopies(port.storage, copies(entry));
            return { status: 'cleared', message: entry.reference ? '이 기기 사본만 정리했습니다. 이미 처리된 결제는 취소하지 않았습니다.' : '식별할 수 없는 이 기기 사본만 정리했습니다. 서버 요청 중단이나 결제 미처리를 확인한 것은 아닙니다. 새 결제가 안전하다는 뜻이 아닙니다.' };
        }
        catch (error) {
            return { status: 'unknown', message: error instanceof Error ? error.message : '사본 정리를 확인하지 못했습니다.' };
        }
    };
    const retry = async (scope: PartnerPaymentRecoveryScope, entry: PartnerPaymentRecoveryEntry, current: () => boolean = () => true): Promise<PartnerPaymentRecoveryOutcome> => {
        let sentEntry = entry;
        try {
            await check(scope, current);
            fresh(scope, entry);
            if (!entry.reference || !entry.request || entry.status !== 'valid')
                throw Error('최초 요청 전체를 검증하지 못해 다시 전송하지 않았습니다. 결과 확인 또는 요청 중단을 선택해 주세요.');
            validRef(scope, entry.reference);
            const request = entry.bodyText === null ? null : storedPayment(JSON.parse(entry.bodyText), scope);
            if (!request || request.operationId !== entry.reference.operationId)
                throw Error('보관 본문과 요청 번호가 다릅니다.');
            const hash = await paymentHash(request);
            if (hash !== entry.requestHash || entry.sidecarHash !== null && entry.sidecarHash !== hash)
                throw Error('원문 해시가 다릅니다.');
            const sidecarKey = entry.sidecarKey ?? paymentReferenceKey(scope, entry.reference.operationId), sidecarText = entry.sidecarText ?? JSON.stringify({
                version: 1, reference: entry.reference, actorUid: scope.actorUid, requestHash: hash
            });
            if (entry.sidecarKey === null) {
                if (port.storage.getItem(sidecarKey) !== null)
                    throw Error('다른 참조 사본이 생겼습니다.');
                port.storage.setItem(sidecarKey, sidecarText);
            }
            if (port.storage.getItem(sidecarKey) !== sidecarText)
                throw Error('참조 보관을 확인하지 못했습니다.');
            sentEntry = {
                ...entry, sidecarKey, sidecarText, sidecarHash: hash
            };
            await check(scope, current);
            fresh(scope, sentEntry);
            const ack = await port.apply(request) as {
                status?: string;
                id?: string;
            };
            await check(scope, current);
            if (!ack || !['applied', 'duplicate'].includes(ack.status ?? '') || ack.id !== entry.reference.operationId)
                throw Error('수금 저장 응답을 확인하지 못했습니다.');
            return resolve(scope, {
                ...entry, sidecarKey, sidecarText, sidecarHash: hash
            }, 'inspect', current);
        }
        catch (error) {
            if (entry.reference && (paymentTerminalFailure(error, entry.reference, 'cancelled') || paymentTerminalFailure(error, entry.reference, 'rejected'))) {
                // apply가 종결 예외를 반환해도 오류 코드로 추정하지 않고 같은 참조의 실제 영수증을 확인한다.
                return resolve(scope, sentEntry, 'inspect', current);
            }
            return { terminal: false, outcome: paymentUnknown(error instanceof Error ? error.message : undefined) };
        }
    };
    const list = async (scope: PartnerPaymentRecoveryScope, cursor?: string, current: () => boolean = () => true) => {
        await check(scope, current);
        const value = await port.command({
            mode: 'list', companyId: scope.companyId, partnerId: scope.partnerId, ...(cursor ? { cursor } : {})
        });
        await check(scope, current);
        return normalizePartnerPaymentListResult(value, scope.companyId, scope.partnerId, scope.actorUid);
    };
    return {
        read, resolve, retry, discard, list
    };
}
async function assertPaymentScope(scope: PartnerPaymentRecoveryScope, current: () => boolean) {
    await authReady;
    if (!current() || auth.currentUser?.uid !== scope.actorUid)
        throw Error('로그인 계정이 변경됐습니다.');
    const user = auth.currentUser;
    const { claims } = await user.getIdTokenResult();
    if (!current() || auth.currentUser?.uid !== scope.actorUid || claims.companyId !== scope.companyId || claims.isAdmin !== true)
        throw Error('현재 회사 관리자 권한을 확인해 주세요.');
}
const paymentRecoveryWriter = () => createPartnerPaymentRecovery({
    storage: localStorage, assertScope: assertPaymentScope, command: async (command) => (await httpsCallable<PartnerPaymentRecoveryCommand, unknown>(functions, 'partnerPaymentRecoveryCommand')(command)).data, apply: async (request) => (await httpsCallable<StoredPartnerPaymentRequest, unknown>(functions, 'recordPartnerPaymentCommand')(request)).data
});
export const readPartnerPaymentRecoveries = (scope: PartnerPaymentRecoveryScope, current?: () => boolean) => paymentRecoveryWriter().read(scope, current);
export const resolvePartnerPaymentRecovery = (scope: PartnerPaymentRecoveryScope, entry: PartnerPaymentRecoveryEntry, mode: 'inspect' | 'cancel', current?: () => boolean) => paymentRecoveryWriter().resolve(scope, entry, mode, current);
export const retryPartnerPaymentRecovery = (scope: PartnerPaymentRecoveryScope, entry: PartnerPaymentRecoveryEntry, current?: () => boolean) => paymentRecoveryWriter().retry(scope, entry, current);
export const discardPartnerPaymentCopy = (scope: PartnerPaymentRecoveryScope, entry: PartnerPaymentRecoveryEntry, current?: () => boolean) => paymentRecoveryWriter().discard(scope, entry, current);
export const listPartnerPaymentHistory = (scope: PartnerPaymentRecoveryScope, cursor?: string, current?: () => boolean) => paymentRecoveryWriter().list(scope, cursor, current);
