import { AR, AP, OTHER_PAYABLE } from '../../../shared/autoJournal';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../../../shared/firebase';
import type { CompanyId, ApplyPartnerAdvanceInput, CancelPartnerAdvanceInput, PreparedPartnerAdvance } from '../../../shared/partnerAdvance';
import { serializePartnerAdvanceRecoveryRequest, normalizePartnerAdvanceRecoveryReference, normalizePartnerAdvanceRecoveryResult, normalizePartnerAdvanceRecoveryHistoryResult, type PartnerAdvanceRecoveryReference, type PartnerAdvanceRecoveryResult } from '../../../shared/partnerAdvanceRecovery';
import type { SaveOutcome } from '../../../shared/saveOutcome';
export type PartnerAdvanceResult = {
    status: 'applied' | 'duplicate';
    id: string;
    docNo: string;
};
export type PendingPartnerAdvance = {
    version: 1;
    companyId: CompanyId;
    actorId: string;
    action: 'apply' | 'cancel';
    input: ApplyPartnerAdvanceInput | CancelPartnerAdvanceInput;
};
const key = (companyId: CompanyId, actorId: string) => `erp:partner-advance:${companyId}:${actorId}`;
const validId = (value: unknown, max = 180) => typeof value === 'string' && new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`).test(value);
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
function validInput(action: string, input: any): boolean {
    if (!input || !validId(input.operationId, 120) || !validId(input.partnerId, 150) || !validId(input.releaseId, 150) || typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date + 'T00:00:00Z')) || new Date(input.date + 'T00:00:00Z').toISOString().slice(0, 10) !== input.date || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
        return false;
    return action === 'apply' ? input.source?.collection === 'cashEntries' && validId(input.source.id) && ['133', '254'].includes(input.source.lineKey) && validId(input.statementId) && [AR, AP, OTHER_PAYABLE].includes(input.accountCode) && Number.isSafeInteger(input.amount) && input.amount > 0 && [input.expectedSourceFingerprint, input.expectedTargetFingerprint].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
        : action === 'cancel' && validId(input.applicationStatementId) && typeof input.reason === 'string' && !!input.reason.trim() && input.reason.length <= 500;
}
export function readPendingPartnerAdvance(companyId: CompanyId): PendingPartnerAdvance | null {
    const actorId = auth.currentUser?.uid;
    if (!actorId)
        return null;
    const prefix = `erp:partner-advance-v2:${companyId}:${encodeURIComponent(actorId)}:`;
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(prefix) || k.endsWith(':reference'))
            continue;
        let v: PendingPartnerAdvance;
        try {
            v = JSON.parse(localStorage.getItem(k)!);
        }
        catch {
            throw Error('저장된 적용 요청을 확인해 주세요.');
        }
        if (v.version !== 1 || v.companyId !== companyId || v.actorId !== actorId || !validInput(v.action, v.input))
            throw Error('저장된 적용 요청을 확인해 주세요.');
        return v;
    }
    const encoded = sessionStorage.getItem(key(companyId, actorId));
    if (!encoded)
        return null;
    let pending: PendingPartnerAdvance;
    try {
        pending = JSON.parse(encoded);
    }
    catch {
        throw new Error('저장된 적용 요청을 확인해 주세요.');
    }
    if (pending.version !== 1 || pending.companyId !== companyId || pending.actorId !== actorId || !['apply', 'cancel'].includes(pending.action) || !validInput(pending.action, pending.input))
        throw new Error('저장된 적용 요청을 확인해 주세요.');
    return pending;
}
async function actor(companyId: CompanyId) {
    await authReady;
    const user = auth.currentUser;
    if (!user)
        throw new Error('로그인이 필요합니다.');
    const claims = (await user.getIdTokenResult()).claims;
    if (auth.currentUser?.uid !== user.uid || claims.companyId !== companyId || claims.isAdmin !== true)
        throw new Error('현재 회사의 관리자 권한을 확인해 주세요.');
    return user.uid;
}
export async function preparePartnerAdvance(companyId: CompanyId, partnerId: string): Promise<PreparedPartnerAdvance> {
    const actorId = await actor(companyId);
    const result = (await httpsCallable<{
        partnerId: string;
    }, PreparedPartnerAdvance>(functions, 'preparePartnerAdvanceCommand')({
        partnerId
    })).data;
    if (await actor(companyId) !== actorId)
        throw new Error('로그인 정보가 변경됐습니다.');
    return result;
}
async function mutate(companyId: CompanyId, action: 'apply' | 'cancel', input: ApplyPartnerAdvanceInput | CancelPartnerAdvanceInput): Promise<PartnerAdvanceResult> {
    if (!validInput(action, input))
        throw new Error('적용 요청 입력을 확인해 주세요.');
    const actorId = await actor(companyId), storageKey = key(companyId, actorId);
    const pending: PendingPartnerAdvance = {
        version: 1, companyId, actorId, action, input: JSON.parse(JSON.stringify(input))
    };
    const encoded = JSON.stringify(pending), existing = sessionStorage.getItem(storageKey);
    if (existing && existing !== encoded) {
        let otherPartner = false;
        try {
            const previous = JSON.parse(existing);
            otherPartner = typeof previous.input?.partnerId === 'string' && previous.input.partnerId !== input.partnerId;
        }
        catch { }
        if (!otherPartner)
            throw new Error('결과를 확인하지 못한 이전 적용 요청을 먼저 재시도해 주세요.');
    }
    const durableScope = {
        companyId, actorId, partnerId: input.partnerId
    };
    const durable = await partnerAdvanceRecovery.persist(durableScope, pending, () => auth.currentUser?.uid === actorId);
    if (auth.currentUser?.uid !== actorId)
        throw new Error('로그인 정보가 변경됐습니다. 이전 요청은 보존했습니다.');
    let result: PartnerAdvanceResult;
    try {
        result = (await httpsCallable<unknown, PartnerAdvanceResult>(functions, action === 'apply' ? 'applyPartnerAdvanceCommand' : 'cancelPartnerAdvanceCommand')(pending.input)).data;
    }
    catch (error) {
        if (await actor(companyId) !== actorId)
            throw new Error('로그인 정보가 변경됐습니다. 이전 요청은 보존했습니다.');
        const proof = (error as {
            details?: {
                partnerAdvanceFailure?: any;
            };
        })?.details?.partnerAdvanceFailure;
        if (proof?.version === 1 && proof.companyId === companyId && proof.partnerId === input.partnerId && proof.operationId === input.operationId && proof.actorId === actorId && proof.operationRejected === true && proof.financialWrites === false && typeof proof.commandHash === 'string' && /^[a-f0-9]{64}$/.test(proof.commandHash) && JSON.stringify(canonical(proof.command)) === JSON.stringify(canonical(pending.input))) {
            await partnerAdvanceRecovery.clearObserved(durableScope, durable);
            if (existing === encoded && sessionStorage.getItem(storageKey) === encoded)
                sessionStorage.removeItem(storageKey);
        }
        throw error;
    }
    if (await actor(companyId) !== actorId)
        throw new Error('로그인 정보가 변경됐습니다. 이전 요청은 보존했습니다.');
    if (!['applied', 'duplicate'].includes(result.status) || !result.id || !result.docNo)
        throw new Error('적용 결과를 확인하지 못했습니다. 같은 요청으로 재시도해 주세요.');
    await partnerAdvanceRecovery.clearObserved(durableScope, durable);
    if (existing === encoded && sessionStorage.getItem(storageKey) === encoded)
        sessionStorage.removeItem(storageKey);
    return result;
}
export const applyPartnerAdvance = (companyId: CompanyId, input: ApplyPartnerAdvanceInput) => mutate(companyId, 'apply', input);
export const cancelPartnerAdvance = (companyId: CompanyId, input: CancelPartnerAdvanceInput) => mutate(companyId, 'cancel', input);
export interface AdvanceRecoveryScope {
    companyId: CompanyId;
    actorId: string;
    partnerId: string;
}
export interface AdvanceRecoveryEntry {
    key: string;
    bodyText: string | null;
    sidecarKey: string | null;
    sidecarText: string | null;
    reference: PartnerAdvanceRecoveryReference | null;
    request: PendingPartnerAdvance | null;
    requestHash: string | null;
    sidecarHash: string | null;
    status: 'valid' | 'legacy' | 'corrupt' | 'missing';
    description: string;
}
export interface AdvanceRecoveryOutcome {
    outcome: SaveOutcome;
    terminal: boolean;
    serverResult?: PartnerAdvanceRecoveryResult;
    copyMismatch?: boolean;
}
export interface AdvanceRecoveryPort {
    storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
    legacyStorage: Pick<Storage, 'getItem' | 'removeItem'>;
    assertScope: (scope: AdvanceRecoveryScope, current: () => boolean) => Promise<void>;
    command: (input: unknown) => Promise<unknown>;
    apply: (pending: PendingPartnerAdvance) => Promise<unknown>;
    digest: (pending: PendingPartnerAdvance) => Promise<string>;
}
export const advanceBodyKey = (scope: AdvanceRecoveryScope, operationId: string) => `erp:partner-advance-v2:${scope.companyId}:${encodeURIComponent(scope.actorId)}:${encodeURIComponent(scope.partnerId)}:${encodeURIComponent(operationId)}`;
export const advanceReferenceKey = (scope: AdvanceRecoveryScope, operationId: string) => advanceBodyKey(scope, operationId) + ':reference';
const unknownAdvance = (message = '상계 처리 결과를 확인하지 못했습니다.'): SaveOutcome => ({
    status: 'unknown', message, nextAction: '보관된 요청의 실제 결과를 확인하거나 미처리 요청 중단을 선택해 주세요. 새 상계를 다시 보내지 마세요.'
});
export const advanceRequestHash = async (pending: PendingPartnerAdvance) => {
    const text = serializePartnerAdvanceRecoveryRequest({
        companyId: pending.companyId, actorId: pending.actorId, action: pending.action, command: pending.input
    });
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
};
export function createPartnerAdvanceRecovery(port: AdvanceRecoveryPort) {
    const queues = new Map<string, Promise<unknown>>();
    const exclusive = <T>(scope: AdvanceRecoveryScope, task: () => Promise<T>) => {
        const locks = globalThis.navigator?.locks;
        const name = advanceBodyKey(scope, 'lock');
        if (locks)
            return locks.request(name, task);
        const run = (queues.get(name) ?? Promise.resolve()).catch(() => { }).then(task);
        queues.set(name, run);
        return run.finally(() => {
            if (queues.get(name) === run)
                queues.delete(name);
        });
    };
    const check = async (scope: AdvanceRecoveryScope, current: () => boolean) => {
        if (!current())
            throw Error('회사 또는 로그인 정보가 바뀌었습니다.');
        await port.assertScope(scope, current);
        if (!current())
            throw Error('회사 또는 로그인 정보가 바뀌었습니다.');
    };
    const parse = (raw: string | null, scope: AdvanceRecoveryScope): PendingPartnerAdvance | null => {
        try {
            const v = JSON.parse(raw!);
            return v.version === 1 && v.companyId === scope.companyId && v.actorId === scope.actorId && v.input?.partnerId === scope.partnerId && validInput(v.action, v.input) ? v : null;
        }
        catch {
            return null;
        }
    };
    const refFor = (scope: AdvanceRecoveryScope, operationId: string) => normalizePartnerAdvanceRecoveryReference({
        companyId: scope.companyId, partnerId: scope.partnerId, operationId
    });
    const copies = (entry: AdvanceRecoveryEntry) => [...(entry.bodyText !== null ? [{
                key: entry.key, text: entry.bodyText
            }] : []), ...(entry.sidecarKey ? [{
                key: entry.sidecarKey, text: entry.sidecarText
            }] : [])];
    const legacyKey = (scope: AdvanceRecoveryScope) => key(scope.companyId, scope.actorId);
    const storageFor = (scope: AdvanceRecoveryScope, k: string) => k === legacyKey(scope) ? port.legacyStorage : port.storage;
    const fresh = (scope: AdvanceRecoveryScope, entry: AdvanceRecoveryEntry) => {
        const prefix = advanceBodyKey(scope, '');
        if (entry.key !== legacyKey(scope) && !entry.key.startsWith(prefix) || entry.sidecarKey !== null && !entry.sidecarKey.startsWith(prefix))
            throw Error('다른 계정의 보관 사본입니다.');
        if (entry.reference && (entry.reference.companyId !== scope.companyId || entry.reference.partnerId !== scope.partnerId))
            throw Error('다른 거래처의 요청입니다.');
        if (entry.reference && (entry.key !== legacyKey(scope) && entry.key !== advanceBodyKey(scope, entry.reference.operationId) || entry.sidecarKey !== null && entry.sidecarKey !== advanceReferenceKey(scope, entry.reference.operationId)))
            throw Error('관측한 사본의 요청 번호가 다릅니다.');
        for (const copy of copies(entry))
            if (storageFor(scope, copy.key).getItem(copy.key) !== copy.text)
                throw Error('관측한 기기 사본이 바뀌었습니다. 다시 읽어 주세요.');
    };
    const clear = (scope: AdvanceRecoveryScope, entry: AdvanceRecoveryEntry, current: () => boolean = () => true) => exclusive(scope, async () => {
        await check(scope, current);
        fresh(scope, entry);
        for (const copy of copies(entry)) {
            const storage = storageFor(scope, copy.key);
            storage.removeItem(copy.key);
            if (storage.getItem(copy.key) !== null)
                throw Error('기기 사본 정리를 확인하지 못했습니다.');
        }
    });
    const read = async (scope: AdvanceRecoveryScope, current: () => boolean = () => true) => {
        await check(scope, current);
        const prefix = advanceBodyKey(scope, ''), keys = new Set<string>();
        for (let i = 0; i < port.storage.length; i++) {
            const k = port.storage.key(i);
            if (k?.startsWith(prefix))
                keys.add(k.endsWith(':reference') ? k.slice(0, -10) : k);
        }
        const old = legacyKey(scope), oldRaw = port.legacyStorage.getItem(old);
        if (oldRaw !== null) {
            try {
                const v = JSON.parse(oldRaw);
                if (v.input?.partnerId === scope.partnerId || !v.input?.partnerId)
                    keys.add(old);
            }
            catch {
                keys.add(old);
            }
        }
        const entries: AdvanceRecoveryEntry[] = [];
        for (const k of keys) {
            const legacy = k === old, bodyText = storageFor(scope, k).getItem(k), sidecarKey = legacy ? null : k + ':reference', sidecarText = sidecarKey ? port.storage.getItem(sidecarKey) : null;
            const request = parse(bodyText, scope);
            let reference: PartnerAdvanceRecoveryReference | null = null, sidecarHash: string | null = null;
            try {
                reference = refFor(scope, legacy ? JSON.parse(bodyText!).input.operationId : decodeURIComponent(k.slice(prefix.length)));
            }
            catch { }
            try {
                const v = JSON.parse(sidecarText!);
                if (v.version === 1 && v.actorId === scope.actorId && JSON.stringify(normalizePartnerAdvanceRecoveryReference(v.reference)) === JSON.stringify(reference) && /^[a-f0-9]{64}$/.test(v.requestHash))
                    sidecarHash = v.requestHash;
            }
            catch { }
            let requestHash: string | null = null;
            try {
                if (request)
                    requestHash = await port.digest(request);
            }
            catch { }
            const valid = !!request && request.input.operationId === reference?.operationId && !!requestHash && (!sidecarKey || sidecarHash === requestHash);
            entries.push({
                key: k, bodyText, sidecarKey, sidecarText, reference, request, requestHash, sidecarHash, status: valid ? 'valid' : legacy && reference ? 'legacy' : bodyText === null ? 'missing' : 'corrupt', description: request ? `${request.action === 'cancel' ? '상계 역분개' : '상계 적용'} · ${request.input.date} · ${'amount' in request.input ? request.input.amount.toLocaleString() + '원 · ' : ''}${request.input.operationId}` : '원문 확인이 필요한 상계 요청 · ' + (reference?.operationId ?? '번호 미확인')
            });
        }
        const merged = entries.filter(entry => {
            if (entry.bodyText !== null || !entry.reference)
                return true;
            const legacy = entries.find(row => row.key === old && row.reference?.operationId === entry.reference!.operationId);
            if (!legacy)
                return true;
            legacy.sidecarKey = entry.sidecarKey;
            legacy.sidecarText = entry.sidecarText;
            legacy.sidecarHash = entry.sidecarHash;
            if (legacy.requestHash !== entry.sidecarHash)
                legacy.status = 'corrupt';
            return false;
        });
        await check(scope, current);
        return merged;
    };
    const persist = async (scope: AdvanceRecoveryScope, pending: PendingPartnerAdvance, current: () => boolean) => exclusive(scope, async () => {
        await check(scope, current);
        if (!parse(JSON.stringify(pending), scope))
            throw Error('적용 요청 입력을 확인해 주세요.');
        const reference = refFor(scope, pending.input.operationId), bodyText = JSON.stringify(pending), requestHash = await port.digest(pending), k = advanceBodyKey(scope, reference.operationId), sidecarKey = k + ':reference', sidecarText = JSON.stringify({
            version: 1, actorId: scope.actorId, reference, requestHash
        });
        await check(scope, current);
        const existing = await read(scope, current);
        if (existing.some(row => (row.key !== k && row.key !== legacyKey(scope)) || row.bodyText !== bodyText))
            throw Error('결과를 확인하지 못한 이전 상계 요청을 먼저 확인해 주세요.');
        if (port.storage.getItem(k) !== null && port.storage.getItem(k) !== bodyText || port.storage.getItem(sidecarKey) !== null && port.storage.getItem(sidecarKey) !== sidecarText)
            throw Error('이전 요청과 원문이 다릅니다.');
        port.storage.setItem(sidecarKey, sidecarText);
        port.storage.setItem(k, bodyText);
        const entry: AdvanceRecoveryEntry = {
            key: k, bodyText, sidecarKey, sidecarText, reference, request: pending, requestHash, sidecarHash: requestHash, status: 'valid', description: pending.input.operationId
        };
        fresh(scope, entry);
        await check(scope, current);
        fresh(scope, entry);
        return entry;
    });
    const resolve = async (scope: AdvanceRecoveryScope, entry: AdvanceRecoveryEntry, mode: 'inspect' | 'stop', current: () => boolean = () => true): Promise<AdvanceRecoveryOutcome> => {
        try {
            await check(scope, current);
            fresh(scope, entry);
            if (!entry.reference)
                throw Error('대상을 식별할 수 없어 서버 처리 여부는 확인하지 못했습니다. 이력을 직접 확인해 주세요.');
            const value = await port.command({
                mode, reference: entry.reference
            });
            await check(scope, current);
            const result = normalizePartnerAdvanceRecoveryResult(value, entry.reference, scope.actorId);
            if (result.status === 'unknown')
                return {
                    terminal: false, serverResult: result, outcome: unknownAdvance(result.message)
                };
            const hasCopy = copies(entry).length > 0, hash = entry.requestHash ?? entry.sidecarHash;
            if (!hasCopy)
                return {
                    terminal: false, copyMismatch: true, serverResult: result, outcome: {
                        status: 'rejected', message: result.message + ' 이 기기에는 이 요청의 보관 원문이 없습니다. 확인한 과거 결과는 현재 입력의 저장 완료를 뜻하지 않습니다.', nextAction: '현재 입력은 그대로 유지했습니다. 과거 처리 내용을 확인한 뒤 필요한 새 업무를 명시적으로 진행해 주세요.'
                    }
                };
            if (entry.bodyText !== null && !entry.requestHash || entry.sidecarKey !== null && !entry.sidecarHash || result.requestHash !== null && hash !== result.requestHash || entry.sidecarHash !== null && result.requestHash !== null && entry.sidecarHash !== result.requestHash)
                return {
                    terminal: false, copyMismatch: true, serverResult: result, outcome: {
                        status: 'rejected', message: result.message + ' 이 기기 원문과 일치한다고 확인하지 못했습니다.', nextAction: '실제 결과를 확인한 뒤 관측한 기기 사본만 명시적으로 정리해 주세요.'
                    }
                };
            fresh(scope, entry);
            try {
                await clear(scope, entry, current);
            }
            catch {
                return {
                    terminal: false, serverResult: result, outcome: result.status === 'applied' ? {
                        status: 'partial', reason: 'followup-unconfirmed', committedIds: [entry.reference.operationId], unconfirmedIds: [], message: '상계는 완료됐지만 기기 사본을 정리하지 못했습니다.', nextAction: '다시 상계하지 말고 같은 요청의 결과를 확인해 주세요.'
                    } : unknownAdvance('서버 종결은 확인했지만 기기 사본 정리를 확인하지 못했습니다.')
                };
            }
            ;
            return {
                terminal: true, serverResult: result, outcome: result.status === 'applied' ? {
                    status: 'saved'
                } : {
                    status: result.status, message: result.message
                }
            };
        }
        catch (error) {
            return {
                terminal: false, outcome: unknownAdvance(error instanceof Error ? error.message : undefined)
            };
        }
    };
    const retry = async (scope: AdvanceRecoveryScope, entry: AdvanceRecoveryEntry, current: () => boolean = () => true): Promise<AdvanceRecoveryOutcome> => {
        try {
            await check(scope, current);
            fresh(scope, entry);
            if (!entry.reference || !entry.request || entry.request.input.operationId !== entry.reference.operationId || entry.status !== 'valid' || await port.digest(entry.request) !== entry.requestHash)
                throw Error('최초 원문을 검증하지 못해 다시 보내지 않았습니다.');
            let sent = entry;
            if (!entry.sidecarKey) {
                const sk = advanceReferenceKey(scope, entry.reference.operationId), st = JSON.stringify({
                    version: 1, actorId: scope.actorId, reference: entry.reference, requestHash: entry.requestHash
                });
                if (port.storage.getItem(sk) !== null)
                    throw Error('다른 참조 사본이 생겼습니다.');
                port.storage.setItem(sk, st);
                sent = {
                    ...entry, sidecarKey: sk, sidecarText: st, sidecarHash: entry.requestHash
                };
            }
            await check(scope, current);
            fresh(scope, sent);
            try {
                await port.apply(entry.request);
            }
            catch { }
            await check(scope, current);
            return resolve(scope, sent, 'inspect', current);
        }
        catch (error) {
            return {
                terminal: false, outcome: unknownAdvance(error instanceof Error ? error.message : undefined)
            };
        }
    };
    const discard = async (scope: AdvanceRecoveryScope, entry: AdvanceRecoveryEntry, current: () => boolean = () => true) => {
        try {
            await check(scope, current);
            fresh(scope, entry);
            if (!copies(entry).length)
                throw Error('관측한 사본이 없습니다.');
            if (entry.reference) {
                const result = normalizePartnerAdvanceRecoveryResult(await port.command({
                    mode: 'inspect', reference: entry.reference
                }), entry.reference, scope.actorId);
                await check(scope, current);
                if (result.status === 'unknown')
                    throw Error(result.message + ' 먼저 미처리 요청 중단을 확인해 주세요.');
            }
            fresh(scope, entry);
            await clear(scope, entry, current);
            return {
                status: 'cleared' as const, message: '이 기기 사본만 정리했습니다. 이미 처리된 상계를 역분개하거나 서버 미처리를 확인한 것은 아닙니다.'
            };
        }
        catch (error) {
            return {
                status: 'blocked' as const, message: error instanceof Error ? error.message : String(error)
            };
        }
    };
    const list = async (scope: AdvanceRecoveryScope, cursor?: string, current: () => boolean = () => true) => {
        await check(scope, current);
        const value = await port.command({
            mode: 'listHistory', companyId: scope.companyId, partnerId: scope.partnerId, ...(cursor ? {
                cursor
            } : {})
        });
        await check(scope, current);
        return normalizePartnerAdvanceRecoveryHistoryResult(value, scope);
    };
    const submit = async (scope: AdvanceRecoveryScope, pending: PendingPartnerAdvance, current: () => boolean = () => true): Promise<AdvanceRecoveryOutcome> => {
        let entry: AdvanceRecoveryEntry;
        try {
            entry = await persist(scope, pending, current);
        }
        catch (error) {
            return {
                terminal: false, outcome: {
                    status: 'rejected', message: error instanceof Error ? error.message : String(error), nextAction: '보관 상태와 입력을 확인한 뒤 다시 진행해 주세요.'
                }
            };
        }
        return retry(scope, entry, current);
    };
    return {
        read, persist, resolve, retry, discard, list, submit, clearObserved: clear
    };
}
export const partnerAdvanceRecovery = createPartnerAdvanceRecovery({
    get storage() { return localStorage; }, get legacyStorage() { return sessionStorage; }, digest: advanceRequestHash,
    assertScope: async (scope, current) => {
        if (!current() || await actor(scope.companyId) !== scope.actorId || !current())
            throw Error('회사 또는 로그인 정보가 바뀌었습니다.');
    },
    command: async (input) => (await httpsCallable(functions, 'partnerAdvanceRecoveryCommand')(input)).data,
    apply: async (pending) => (await httpsCallable(functions, pending.action === 'apply' ? 'applyPartnerAdvanceCommand' : 'cancelPartnerAdvanceCommand')(pending.input)).data,
});
