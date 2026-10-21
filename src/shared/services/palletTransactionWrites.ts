import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../firebase';
import { normalizePalletTransactionReference, normalizePalletTransactionRequest, normalizePalletTransactionOpenResult, normalizePalletTransactionResult, serializePalletTransactionRequest, normalizePalletExchangeOpenResult, normalizePalletExchangeOpenInput, normalizePalletExchangeSource, type PalletTransactionReference, type PalletTransactionRequest, type PalletTransactionAnyRequest, type PalletExchangeOpenInput, type PalletTransactionResult, } from '../palletTransactionCommand';
export interface PalletTransactionScope {
    companyId: PalletTransactionReference['companyId'];
    actorUid: string;
}
export interface PalletTransactionAttempt {
    at: string;
    message: string;
    outcome: 'unconfirmed' | 'server-rejected';
}
export interface PalletTransactionEntry {
    key: string;
    bodyRaw: string | null;
    referenceRaw: string | null;
    request: PalletTransactionAnyRequest | null;
    reference: PalletTransactionReference | null;
    transaction: PalletTransactionRequest['transaction'] | null;
    summary: {
        action: 'register' | 'complete-exchange';
        partnerId: string;
        palletId: string;
        type: 'in' | 'out';
        date: string;
        quantity: number;
        returnQty?: number;
        note: string;
        sourceTransactionId?: string;
    } | null;
    references: {
        reference: PalletTransactionReference;
        source: 'body' | 'reference' | 'both';
    }[];
    requestHash: string | null;
    legacy: boolean;
    lastAttempt: PalletTransactionAttempt | null;
    status: 'valid' | 'corrupt' | 'missing';
    description: string;
}
export interface PalletTransactionObservation {
    entry: PalletTransactionEntry | null;
    result?: PalletTransactionResult;
    terminal: boolean;
    copyMismatch?: boolean;
}
type Current = () => boolean;
type Own = (entry: PalletTransactionEntry | null) => void;
const prefix = (scope: PalletTransactionScope) => `pallet-transaction-v1:${scope.companyId}:${encodeURIComponent(scope.actorUid)}:`;
const keyFor = (scope: PalletTransactionScope, ref: PalletTransactionReference) => prefix(scope) + encodeURIComponent(JSON.stringify([ref.operationId, ref.transactionId]));
const equalRef = (a: PalletTransactionReference, b: PalletTransactionReference) => JSON.stringify(a) === JSON.stringify(b);
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), n => n.toString(16).padStart(2, '0')).join('');
const notify = () => window.dispatchEvent(new Event('pallet-transaction-pending'));
const running = new Set<string>();
function owner(scope: PalletTransactionScope, current: Current) {
    if (!current() || !scope.actorUid || auth.currentUser?.uid !== scope.actorUid)
        throw Error('회사 또는 로그인 계정이 바뀌었습니다. 보관 원문은 유지했습니다.');
}
async function authorize(scope: PalletTransactionScope, current: Current) {
    owner(scope, current);
    await authReady;
    owner(scope, current);
    const token = await auth.currentUser!.getIdTokenResult();
    owner(scope, current);
    if (token.claims.companyId !== scope.companyId || typeof token.claims.employeeId !== 'string')
        throw Error('현재 회사의 직원 권한을 확인해 주세요.');
}
async function exclusive<T>(scope: PalletTransactionScope, current: Current, work: () => Promise<T>) {
    const key = prefix(scope);
    if (running.has(key))
        throw Error('파렛트 요청을 처리 중입니다. 잠시 뒤 다시 확인해 주세요.');
    running.add(key);
    try {
        await authorize(scope, current);
        return await work();
    }
    finally {
        running.delete(key);
    }
}
function assertPair(scope: PalletTransactionScope, entry: PalletTransactionEntry, current: Current) {
    owner(scope, current);
    if (!entry.key.startsWith(prefix(scope)) || entry.key.endsWith(':reference')
        || localStorage.getItem(entry.key) !== entry.bodyRaw
        || localStorage.getItem(entry.key + ':reference') !== entry.referenceRaw)
        throw Error('기기에 보관된 파렛트 요청이 바뀌었습니다. 다시 읽어 주세요.');
}
async function readAt(scope: PalletTransactionScope, key: string): Promise<PalletTransactionEntry> {
    const bodyRaw = localStorage.getItem(key), referenceRaw = localStorage.getItem(key + ':reference');
    let request: PalletTransactionAnyRequest | null = null;
    let side: {
        reference: PalletTransactionReference;
        bodyDigest: string;
        lastAttempt?: PalletTransactionAttempt;
    } | null = null;
    try {
        const parsed = JSON.parse(bodyRaw ?? 'null');
        if (parsed?.version !== 1 || parsed.actorUid !== scope.actorUid)
            throw Error();
        request = normalizePalletTransactionRequest(parsed.request);
        if (request.reference.companyId !== scope.companyId)
            request = null;
    }
    catch {
        request = null;
    }
    try {
        const parsed = JSON.parse(referenceRaw ?? 'null');
        const reference = normalizePalletTransactionReference(parsed.reference);
        if (parsed.version !== 1 || parsed.actorUid !== scope.actorUid || reference.companyId !== scope.companyId
            || typeof parsed.bodyDigest !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.bodyDigest))
            throw Error();
        const attempt = parsed.lastAttempt;
        const lastAttempt = attempt && typeof attempt.at === 'string' && typeof attempt.message === 'string'
            && ['unconfirmed', 'server-rejected'].includes(attempt.outcome)
            ? { at: attempt.at.slice(0, 100), message: attempt.message.slice(0, 500), outcome: attempt.outcome } : undefined;
        side = { reference, bodyDigest: parsed.bodyDigest, lastAttempt };
    }
    catch {
        side = null;
    }
    const references: PalletTransactionEntry['references'] = [];
    if (request)
        references.push({ reference: request.reference, source: 'body' });
    if (side) {
        const same = references.find(row => equalRef(row.reference, side!.reference));
        if (same)
            same.source = 'both';
        else
            references.push({ reference: side.reference, source: 'reference' });
    }
    const valid = !!(request && side && equalRef(request.reference, side.reference) && bodyRaw && await digest(bodyRaw) === side.bodyDigest);
    return { key, bodyRaw, referenceRaw, request: valid ? request : null,
        reference: side?.reference ?? request?.reference ?? null, transaction: request?.version === 1 ? request.transaction : null, summary: summaryFor(request), references,
        requestHash: valid && request ? await digest(serializePalletTransactionRequest(request)) : null,
        legacy: !!request && referenceRaw === null,
        lastAttempt: side?.lastAttempt ?? null,
        status: valid ? 'valid' : bodyRaw === null && referenceRaw === null ? 'missing' : 'corrupt',
        description: request?.version === 2 ? '파렛트 교체 완료 요청' : request ? '파렛트 거래 요청' : '원문 확인이 필요한 파렛트 요청' };
}
async function rpc(input: unknown) {
    return (await httpsCallable(functions, 'palletTransactionCommand')(input)).data;
}
async function read(scope: PalletTransactionScope, current: Current = () => true) {
    scope = { ...scope };
    owner(scope, current);
    const keys = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix(scope)))
            keys.add(key.endsWith(':reference') ? key.slice(0, -10) : key);
    }
    const entries = await Promise.all([...keys].map(key => readAt(scope, key)));
    owner(scope, current);
    return entries;
}
async function open(scope: PalletTransactionScope, reference: PalletTransactionReference, palletId: string, originalTotal: number, current: Current) {
    scope = { ...scope };
    const ref = normalizePalletTransactionReference(reference);
    if (ref.companyId !== scope.companyId)
        throw Error('요청의 회사가 다릅니다.');
    return exclusive(scope, current, async () => {
        const raw = await rpc({ mode: 'open', reference: ref, palletId, originalTotal });
        owner(scope, current);
        return normalizePalletTransactionOpenResult(raw, ref, scope.actorUid, palletId, originalTotal);
    });
}
async function prepare(scope: PalletTransactionScope, input: PalletTransactionAnyRequest, current: Current, onOwn?: Own) {
    scope = { ...scope };
    const request = normalizePalletTransactionRequest(input);
    if (request.reference.companyId !== scope.companyId)
        throw Error('요청의 회사가 다릅니다.');
    return exclusive(scope, current, async () => {
        const entries = await read(scope, current);
        if (request.version === 1 ? findMatching(entries, request.transaction) : findMatchingExchange(entries, request.sourceTransactionId))
            throw Error('같은 내용의 보관 요청이 있습니다. 그 요청의 결과를 확인하거나 사본을 정리해 주세요.');
        const key = keyFor(scope, request.reference);
        const bodyRaw = JSON.stringify({ version: 1, actorUid: scope.actorUid, request });
        const referenceRaw = JSON.stringify({ version: 1, actorUid: scope.actorUid, reference: request.reference, bodyDigest: await digest(bodyRaw) });
        owner(scope, current);
        if (localStorage.getItem(key) !== null || localStorage.getItem(key + ':reference') !== null)
            throw Error('같은 번호의 보관 요청이 있습니다. 먼저 처리 결과를 확인해 주세요.');
        localStorage.setItem(key, bodyRaw);
        if (localStorage.getItem(key) !== bodyRaw || localStorage.getItem(key + ':reference') !== null)
            throw Error('보관 원문이 바뀌었습니다. 전송하지 않았습니다.');
        localStorage.setItem(key + ':reference', referenceRaw);
        const entry = await readAt(scope, key);
        if (entry.bodyRaw !== bodyRaw || entry.referenceRaw !== referenceRaw || entry.status !== 'valid')
            throw Error('보관 원문을 다시 확인하지 못해 전송하지 않았습니다.');
        assertPair(scope, entry, current);
        onOwn?.(entry);
        notify();
        return entry;
    });
}
async function command(scope: PalletTransactionScope, supplied: PalletTransactionEntry, mode: 'apply' | 'inspect' | 'cancel', current: Current, selected?: PalletTransactionReference, onOwn?: Own): Promise<PalletTransactionObservation> {
    scope = { ...scope };
    supplied = { ...supplied };
    const selectedSnapshot = selected ? normalizePalletTransactionReference(selected) : undefined;
    return exclusive(scope, current, async () => {
        assertPair(scope, supplied, current);
        let entry = await readAt(scope, supplied.key);
        assertPair(scope, supplied, current);
        const reference = normalizePalletTransactionReference(selectedSnapshot ?? entry.reference);
        if (!entry.references.some(row => equalRef(row.reference, reference)))
            throw Error('표시된 요청 번호가 아닙니다.');
        if (mode === 'apply' && (!entry.request || entry.status !== 'valid' || entry.references.length !== 1))
            throw Error('원문과 참조가 일치하지 않아 다시 전송할 수 없습니다.');
        try {
            assertPair(scope, entry, current);
            const raw = await rpc(mode === 'apply' ? { mode, request: entry.request } : { mode, reference });
            owner(scope, current);
            const result = normalizePalletTransactionResult(raw, reference, scope.actorUid);
            const copyMismatch = result.status === 'applied' && !!entry.requestHash && result.requestHash !== entry.requestHash;
            if (mode === 'apply' && copyMismatch)
                throw Error('처리 결과의 원문이 다릅니다. 보관 정보는 유지했습니다.');
            assertPair(scope, entry, current);
            return { entry, result, terminal: result.status !== 'unknown' };
        }
        catch (error) {
            owner(scope, current);
            assertPair(scope, entry, current);
            if (mode === 'apply') {
                const side = JSON.parse(entry.referenceRaw!);
                const details = (error as {
                    details?: Record<string, unknown>;
                })?.details;
                if (details?.palletTransactionRecovery) {
                    const result = normalizePalletTransactionResult(details.palletTransactionRecovery, reference, scope.actorUid);
                    if (result.status !== 'cancelled')
                        throw error;
                    return { entry, result, terminal: true };
                }
                let rejected = false;
                try {
                    rejected = details?.operationStatus === 'rejected' && details.version === 1 && details.writes === false
                        && equalRef(normalizePalletTransactionReference(details.reference), reference);
                }
                catch { /* 다른 요청의 오류를 현재 요청의 무쓰기 증거로 사용하지 않는다. */ }
                side.lastAttempt = { at: new Date().toISOString(), outcome: rejected ? 'server-rejected' : 'unconfirmed', message: error instanceof Error ? error.message.slice(0, 500) : '처리 결과를 확인하지 못했습니다.' };
                const nextRaw = JSON.stringify(side);
                try {
                    localStorage.setItem(entry.key + ':reference', nextRaw);
                }
                catch (metadataError) {
                    // 기록 실패가 실제 송신 결과나 원래 실패 원인을 바꾸지는 않는다.
                    throw Object.assign(new Error(`${side.lastAttempt.message} 원인 기록 저장에도 실패했습니다. 보관 요청의 처리 결과를 확인해 주세요.`), { cause: error, metadataError });
                }
                const next = await readAt(scope, entry.key);
                if (next.bodyRaw !== entry.bodyRaw || next.referenceRaw !== nextRaw)
                    throw Error('보관 정보가 바뀌었습니다. 다시 읽어 주세요.');
                entry = next;
                assertPair(scope, entry, current);
                onOwn?.(entry);
                notify();
            }
            throw error;
        }
    });
}
async function upgrade(scope: PalletTransactionScope, supplied: PalletTransactionEntry, current: Current, onOwn?: Own) {
    scope = { ...scope };
    supplied = { ...supplied };
    return exclusive(scope, current, async () => {
        assertPair(scope, supplied, current);
        const entry = await readAt(scope, supplied.key);
        assertPair(scope, supplied, current);
        if (!entry.legacy || !entry.bodyRaw || entry.referenceRaw !== null || entry.references.length !== 1)
            throw Error('복원할 수 있는 같은 원문이 아닙니다. 보관 정보는 유지했습니다.');
        const referenceRaw = JSON.stringify({ version: 1, actorUid: scope.actorUid, reference: entry.references[0].reference, bodyDigest: await digest(entry.bodyRaw) });
        assertPair(scope, entry, current);
        localStorage.setItem(entry.key + ':reference', referenceRaw);
        const next = await readAt(scope, entry.key);
        if (next.bodyRaw !== entry.bodyRaw || next.referenceRaw !== referenceRaw || next.status !== 'valid')
            throw Error('참조 복원을 다시 확인하지 못했습니다. 전송하지 않았습니다.');
        assertPair(scope, next, current);
        onOwn?.(next);
        notify();
        return next;
    });
}
async function discard(scope: PalletTransactionScope, supplied: PalletTransactionEntry, current: Current, onOwn?: Own): Promise<PalletTransactionObservation> {
    scope = { ...scope };
    supplied = { ...supplied };
    return exclusive(scope, current, async () => {
        assertPair(scope, supplied, current);
        const entry = await readAt(scope, supplied.key);
        assertPair(scope, supplied, current);
        for (const { reference } of entry.references) {
            const raw = await rpc({ mode: 'inspect', reference });
            assertPair(scope, entry, current);
            const result = normalizePalletTransactionResult(raw, reference, scope.actorUid);
            if (result.status === 'unknown')
                throw Error('아직 처리 결과를 확인하지 못한 요청이 있습니다. 먼저 확인하거나 중단해 주세요.');
        }
        assertPair(scope, entry, current);
        localStorage.removeItem(entry.key);
        if (localStorage.getItem(entry.key) !== null || localStorage.getItem(entry.key + ':reference') !== entry.referenceRaw)
            throw Error('다른 보관 정보가 생겨 그대로 두었습니다.');
        localStorage.removeItem(entry.key + ':reference');
        owner(scope, current);
        onOwn?.(null);
        notify();
        return { entry: null, terminal: true };
    });
}
function projection(entry: PalletTransactionEntry, input: PalletTransactionResult | readonly PalletTransactionResult[] | null = null) {
    const results = input ? Array.isArray(input) ? input : [input] : [];
    const referenceRows = entry.references.map(row => {
        const result = results.find(value => equalRef(value.reference, row.reference));
        const terminal = !!result && result.status !== 'unknown';
        const mismatch = result?.status === 'applied' && !!entry.requestHash && result.requestHash !== entry.requestHash;
        return { ...row, result, terminal, label: row.source === 'body' ? '본문에 남은 요청' : row.source === 'reference' ? '참조에 남은 요청' : '보관된 요청',
            currentState: result?.status === 'applied' ? entry.summary?.action === 'complete-exchange' ? '이 요청의 교체 완료와 회수 처리가 끝났습니다. 이후 수정·삭제 여부는 확인하지 않았습니다.' : '이 요청의 파렛트 거래가 처리되었습니다. 이후 수정·삭제 여부는 확인하지 않았습니다.' : result?.status === 'cancelled' ? '미처리 요청을 중단했습니다.' : '아직 처리 결과를 확인하지 못했습니다.',
            cause: mismatch ? '이 요청은 서버에서 처리됐지만 기기에 보관된 내용과 다릅니다. 현재 입력이 저장됐다는 뜻은 아닙니다.' : !terminal && row.source !== 'body' ? entry.lastAttempt?.message ?? '' : '',
            nextAction: terminal ? '이 기기에 남은 사본을 정리한 뒤 새 업무를 시작할 수 있습니다.' : '결과를 확인하거나 미처리 요청을 중단해 주세요.', canInspect: true, canCancel: !terminal };
    });
    const allTerminal = referenceRows.length > 0 && referenceRows.every(row => row.terminal);
    return { referenceRows, terminal: allTerminal, isUnresolved: !allTerminal,
        currentState: allTerminal ? referenceRows.length > 1 ? '두 요청의 처리 결과를 모두 확인했습니다.' : referenceRows[0].currentState : '확인이 필요한 파렛트 요청이 있습니다.',
        cause: entry.status === 'corrupt' ? '보관된 본문과 참조를 함께 확인해 주세요.' : '',
        nextAction: entry.references.length === 0 ? '서버 처리 여부는 확인할 수 없습니다. 이 기기의 손상 정보만 정리할 수 있으며 서버 요청 취소는 아닙니다.' : allTerminal ? '관측한 기기 사본을 명시적으로 정리해 주세요.' : '각 요청의 결과를 확인하거나 미처리 요청을 중단해 주세요.',
        canInspect: entry.references.length > 0, canRetry: entry.status === 'valid' && !allTerminal, canUpgradeReference: entry.legacy,
        canCancel: referenceRows.some(row => row.canCancel), canDiscard: entry.references.length === 0 || allTerminal };
}
function findMatching(entries: readonly PalletTransactionEntry[], transaction: PalletTransactionRequest['transaction']) {
    const normalize = (value: PalletTransactionRequest['transaction']) => normalizePalletTransactionRequest({ version: 1,
        reference: { companyId: 'taebaek', operationId: 'intent', transactionId: 'intent' }, transaction: value,
        ...(value.isTransfer ? { transfer: { originalTotal: 0, expectedVersion: '0:000000000' } } : {}) }) as PalletTransactionRequest;
    const text = JSON.stringify(normalize(transaction).transaction);
    return entries.find(entry => entry.transaction && JSON.stringify(normalize(entry.transaction).transaction) === text);
}
function findMatchingExchange(entries: readonly PalletTransactionEntry[], sourceTransactionId: string) {
    return entries.find(entry => entry.summary?.action === 'complete-exchange' && entry.summary.sourceTransactionId === sourceTransactionId);
}
function summaryFor(request: PalletTransactionAnyRequest | null): PalletTransactionEntry['summary'] {
    if (!request)
        return null;
    if (request.version === 1) {
        const body = request.transaction;
        return { action: 'register', partnerId: body.partnerId, palletId: body.palletId, type: body.type, date: body.date, quantity: body.quantity, ...(body.exchangeReturnQty !== undefined ? { returnQty: body.exchangeReturnQty } : {}), note: body.note ?? '' };
    }
    const source = request.source;
    return { action: 'complete-exchange', sourceTransactionId: request.sourceTransactionId, partnerId: source.partnerId, palletId: source.palletId, type: 'in', date: request.returnDate, quantity: source.quantity, returnQty: source.exchangeReturnQty ?? source.quantity, note: source.note ?? '' };
}
async function openExchange(scope: PalletTransactionScope, input: PalletExchangeOpenInput, current: Current) {
    scope = { ...scope };
    const { reference, source, sourceTransactionId } = normalizePalletExchangeOpenInput({ ...input, source: normalizePalletExchangeSource(input.source) });
    if (reference.companyId !== scope.companyId)
        throw Error('교체 완료 요청의 회사가 다릅니다.');
    return exclusive(scope, current, async () => {
        const raw = await rpc({ mode: 'open-exchange', reference, sourceTransactionId, source });
        owner(scope, current);
        const result = normalizePalletExchangeOpenResult(raw);
        if (!equalRef(result.reference, reference) || result.actorUid !== scope.actorUid || result.sourceTransactionId !== sourceTransactionId || JSON.stringify(result.source) !== JSON.stringify(source))
            throw Error('교체 준비 응답의 원문·사용자가 다릅니다.');
        return result;
    });
}
export const palletTransactionWrites = { open, openExchange, prepare, read, command, discard, upgrade, projection, findMatching, findMatchingExchange };
export type PalletTransactionBindings = typeof palletTransactionWrites;
export default palletTransactionWrites;
