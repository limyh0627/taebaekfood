import { normalizeFinancialOpeningRecoveryReference, normalizeFinancialOpeningRecoveryResult, type FinancialOpeningRecoveryReference, type FinancialOpeningRecoveryResult } from '../financialOpeningRecovery';
import { AR, AP } from '../autoJournal';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, db, functions } from '../firebase';
import type { CompanyId } from '../types';
import type { FinancialOpeningInput } from '../../../functions/src/financialOpeningCommand';

export type FinancialOpeningPending = { version: 1; companyId: CompanyId; userId: string; request: FinancialOpeningInput };
export type FinancialOpeningDraft = FinancialOpeningInput extends infer T ? T extends FinancialOpeningInput ? Omit<T, 'companyId' | 'operationId' | 'releaseId'> : never : never;
export interface FinancialOpeningObservation { pending: FinancialOpeningPending; raw: string; referenceRaw?: string | null }
export interface FinancialOpeningLastAttempt { at: string; phase: 'before-send' | 'sent'; outcome: 'server-rejected' | 'unconfirmed'; message: string }
export interface FinancialOpeningRecoveryReferenceEntry { reference: FinancialOpeningRecoveryReference; source: 'body' | 'reference' | 'both' }
export interface FinancialOpeningRecoveryEntry {
    companyId: CompanyId; actorUid: string; key: string;
    bodyRaw: string | null; referenceRaw: string | null;
    pending: FinancialOpeningPending | null; reference: FinancialOpeningRecoveryReference | null;
    validBody: boolean; legacy: boolean; error: string; description: string; conflictingReference: boolean;
    lastAttempt: FinancialOpeningLastAttempt | null; references: FinancialOpeningRecoveryReferenceEntry[];
}
interface ReferenceCopy { version: 1; companyId: CompanyId; actorUid: string; reference: FinancialOpeningRecoveryReference; bodyDigest: string; lastAttempt?: FinancialOpeningLastAttempt }
export type FinancialOpeningOwnObservation = (entry: FinancialOpeningRecoveryEntry) => void;
type FinancialOpeningResult = 'created' | 'unchanged' | 'updated';
const keyOf = (company: CompanyId, uid: string) => `financial-opening:${company}:${uid}`;
const notify = () => window.dispatchEvent(new Event('financial-opening-pending'));
const currentUid = () => auth.currentUser?.uid;
const running = new Map<string, object>();

function parsePending(raw: string, companyId: CompanyId, uid: string): FinancialOpeningPending {
    try {
        const pending = JSON.parse(raw) as FinancialOpeningPending, request = pending.request;
        if (pending.version !== 1 || pending.companyId !== companyId || pending.userId !== uid || !request || request.companyId !== companyId
            || typeof request.operationId !== 'string' || !request.operationId || typeof request.releaseId !== 'string' || !request.releaseId
            || !['partner-create', 'loan-create', 'loan-update', 'account-create', 'account-update'].includes(request.kind)) throw Error();
        const row = request.kind === 'loan-create' ? request.loan : request.kind === 'account-create' ? request.account
            : request.kind === 'loan-update' || request.kind === 'account-update' ? request.original : undefined;
        if (request.kind !== 'partner-create' && (!row || typeof row !== 'object' || Array.isArray(row)
            || typeof row.id !== 'string' || !row.id || row.companyId !== companyId || typeof row.name !== 'string')) throw Error();
        if (request.kind === 'partner-create' && (typeof request.partnerId !== 'string' || typeof request.date !== 'string'
            || ![AR, AP].includes(request.code) || !Number.isSafeInteger(request.amount))) throw Error();
        return pending;
    } catch {
        throw new Error('저장 중인 기초 금융 원문을 확인해야 합니다. 원문은 보존했습니다.');
    }
}

export function readFinancialOpeningObservation(companyId: CompanyId): FinancialOpeningObservation | null {
    const uid = currentUid();
    if (!uid) return null;
    const raw = localStorage.getItem(keyOf(companyId, uid));
    if (!raw) return null;
    return { pending: parsePending(raw, companyId, uid), raw, referenceRaw: localStorage.getItem(`${keyOf(companyId, uid)}:reference`) };
}
export function getPendingFinancialOpening(companyId: CompanyId): FinancialOpeningPending | null {
    return readFinancialOpeningObservation(companyId)?.pending ?? null;
}
function proof(error: unknown, pending: FinancialOpeningPending) {
    const detail = (error as { details?: Record<string, unknown> })?.details;
    return detail?.operationStatus === 'rejected' && detail.version === 1 && detail.financialWrites === false
        && detail.companyId === pending.companyId && detail.operationId === pending.request.operationId;
}
function assertObserved(key: string, raw: string | null) {
    if (localStorage.getItem(key) !== raw) throw new Error('기기에 남은 기초 금융 요청 정보가 바뀌었습니다. 다시 확인해 주세요.');
}

/** 같은 JS 인스턴스의 중복 진입을 거절한다. 대기시킨 호출을 새 작업으로 승격하지 않는다. */
async function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (running.has(key)) throw new Error('이 회사의 기초 금융 요청을 처리 중입니다. 잠시 뒤 다시 확인해 주세요.');
    const token = {};
    running.set(key, token);
    try { return await work(); }
    finally { if (running.get(key) === token) running.delete(key); }
}
async function authorize(companyId: CompanyId, uid: string, isCurrent: () => boolean) {
    const check = () => {
        if (!uid || currentUid() !== uid || !isCurrent()) throw new Error('로그인 사용자 또는 화면이 변경되었습니다. 기초 금융 원문은 보존했습니다.');
    };
    check();
    await authReady; check();
    const token = await auth.currentUser!.getIdTokenResult(); check();
    if (token.claims.companyId !== companyId || token.claims.isAdmin !== true) throw new Error('현재 회사 관리자만 기초 금융을 저장할 수 있습니다.');
    return check;
}
const referenceKey = (key: string) => `${key}:reference`;
const sameReference = (a: FinancialOpeningRecoveryReference | null, b: FinancialOpeningRecoveryReference | null) => !!a && !!b && a.companyId === b.companyId && a.operationId === b.operationId && a.kind === b.kind;
function capturePair(companyId: CompanyId, actorUid: string) {
    const key = keyOf(companyId, actorUid);
    return { key, bodyRaw: localStorage.getItem(key), referenceRaw: localStorage.getItem(referenceKey(key)) };
}
function assertPair(entry: Pick<FinancialOpeningRecoveryEntry, 'key' | 'bodyRaw' | 'referenceRaw'>) {
    assertObserved(entry.key, entry.bodyRaw);
    assertObserved(referenceKey(entry.key), entry.referenceRaw);
}
async function bodyDigest(raw: string) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))).map(value => value.toString(16).padStart(2, '0')).join('');
}
function referenceOf(pending: FinancialOpeningPending) {
    return normalizeFinancialOpeningRecoveryReference({ companyId: pending.companyId, operationId: pending.request.operationId, kind: pending.request.kind });
}
function parseReference(raw: string, companyId: CompanyId, actorUid: string): ReferenceCopy {
    const value = JSON.parse(raw) as ReferenceCopy;
    if (value?.version !== 1 || value.companyId !== companyId || value.actorUid !== actorUid || typeof value.bodyDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.bodyDigest)) throw Error('보관된 기초 금융 참조를 확인해야 합니다.');
    const reference = normalizeFinancialOpeningRecoveryReference(value.reference);
    if (reference.companyId !== companyId) throw Error('보관된 참조의 회사가 다릅니다.');
    if (value.lastAttempt && (typeof value.lastAttempt.at !== 'string' || !['before-send', 'sent'].includes(value.lastAttempt.phase) || !['server-rejected', 'unconfirmed'].includes(value.lastAttempt.outcome) || typeof value.lastAttempt.message !== 'string' || value.lastAttempt.message.length > 512)) throw Error('보관된 시도 안내를 확인해야 합니다.');
    return { ...value, reference };
}
function safeMessage(error: unknown) {
    const fallback = '저장 처리 결과를 확인하지 못했습니다. 서버 결과를 확인해 주세요.';
    const message = error instanceof Error ? error.message.split(/[\r\n]/)[0] : fallback;
    if (/[{}\[\]]|Bearer\s|token=|eyJ[A-Za-z0-9_-]{10}/i.test(message)) return fallback;
    return message.replace(/https?:\/\/\S+/g, '(주소 생략)').slice(0, 512) || fallback;
}
async function entryFromPair(companyId: CompanyId, actorUid: string, pair: ReturnType<typeof capturePair>): Promise<FinancialOpeningRecoveryEntry> {
    let pending: FinancialOpeningPending | null = null, bodyReference: FinancialOpeningRecoveryReference | null = null, copy: ReferenceCopy | null = null, error = '';
    if (pair.bodyRaw !== null) {
        try { pending = parsePending(pair.bodyRaw, companyId, actorUid); bodyReference = referenceOf(pending); }
        catch (failure) { error = failure instanceof Error ? failure.message : '보관된 본문을 확인할 수 없습니다.'; }
    }
    if (pair.referenceRaw !== null) {
        try { copy = parseReference(pair.referenceRaw, companyId, actorUid); }
        catch { error = '보관된 참조 정보가 손상되었습니다. 읽을 수 있는 요청 번호로 서버 결과를 먼저 확인해 주세요.'; }
    }
    const conflictingReference = !!copy && !!bodyReference && !sameReference(copy.reference, bodyReference);
    const validBody = !!pending && !!copy && !conflictingReference && sameReference(copy.reference, bodyReference) && await bodyDigest(pair.bodyRaw!) === copy.bodyDigest;
    if (pending && copy && !validBody) error = '본문과 참조 정보가 서로 맞지 않습니다. 저장을 다시 보내지 않고 서버 결과를 확인해 주세요.';
    const reference = copy?.reference ?? bodyReference;
    const references: FinancialOpeningRecoveryReferenceEntry[] = [];
    if (copy) references.push({ reference: copy.reference, source: bodyReference && sameReference(copy.reference, bodyReference) ? 'both' : 'reference' });
    if (bodyReference && !sameReference(copy?.reference ?? null, bodyReference)) references.push({ reference: bodyReference, source: 'body' });
    const entity = pending?.request.kind === 'loan-create' ? pending.request.loan : pending?.request.kind === 'account-create' ? pending.request.account : pending && (pending.request.kind === 'loan-update' || pending.request.kind === 'account-update') ? pending.request.original : null;
    const label = pending?.request.kind === 'partner-create' ? '거래처 기초 등록' : pending?.request.kind === 'loan-create' ? '대출 기초 등록' : pending?.request.kind === 'loan-update' ? '대출 기초 수정' : pending?.request.kind === 'account-create' ? '계좌 기초 등록' : pending?.request.kind === 'account-update' ? '계좌 기초 수정' : '기초 금융 요청';
    return { ...pair, companyId, actorUid, pending, reference, validBody, conflictingReference, references,
        legacy: !!pending && pair.referenceRaw === null, error, description: entity?.name ? `${label} · ${entity.name}` : label, lastAttempt: copy?.lastAttempt ?? null };
}
export async function readFinancialOpeningRecovery(companyId: CompanyId): Promise<FinancialOpeningRecoveryEntry | null> {
    const actorUid = currentUid();
    if (!actorUid) return null;
    const pair = capturePair(companyId, actorUid);
    if (pair.bodyRaw === null && pair.referenceRaw === null) return null;
    const entry = await entryFromPair(companyId, actorUid, pair);
    if (currentUid() !== actorUid) throw Error('로그인 사용자가 변경되었습니다.');
    assertPair(pair);
    return entry;
}
function fixedPair(companyId: CompanyId, observed: FinancialOpeningRecoveryEntry) {
    const uid = currentUid();
    if (!uid || observed.companyId !== companyId || observed.actorUid !== uid || observed.key !== keyOf(companyId, uid)) throw Error('현재 회사와 로그인 사용자를 다시 확인해 주세요.');
    return { companyId, actorUid: uid, key: observed.key, bodyRaw: observed.bodyRaw, referenceRaw: observed.referenceRaw };
}
async function fixedEntry(companyId: CompanyId, observed: FinancialOpeningRecoveryEntry) {
    const pair = fixedPair(companyId, observed);
    assertPair(pair);
    const entry = await entryFromPair(companyId, pair.actorUid, pair);
    assertPair(pair);
    return entry;
}
function pairClear(entry: FinancialOpeningRecoveryEntry) {
    assertPair(entry);
    localStorage.removeItem(entry.key);
    // 두 삭제 사이에 들어온 새 사본도 이전 요청의 정리 대상으로 삼지 않는다.
    assertPair({ ...entry, bodyRaw: null });
    localStorage.removeItem(referenceKey(entry.key));
    notify();
}
function registerOwn(entry: FinancialOpeningRecoveryEntry, onOwn?: FinancialOpeningOwnObservation) { onOwn?.(entry); notify(); }
async function promote(companyId: CompanyId, observed: FinancialOpeningRecoveryEntry, check: () => void, onOwn?: FinancialOpeningOwnObservation) {
    const entry = await fixedEntry(companyId, observed);
    if (!entry.pending || !entry.reference || entry.referenceRaw !== null || entry.bodyRaw === null) throw Error('이 원문은 독립 참조로 보관할 수 없습니다. 기존 참조를 덮어쓰지 않았습니다.');
    const digest = await bodyDigest(entry.bodyRaw);
    check(); assertPair(entry);
    const copy: ReferenceCopy = { version: 1, companyId, actorUid: entry.actorUid, reference: entry.reference, bodyDigest: digest };
    const referenceRaw = JSON.stringify(copy);
    localStorage.setItem(referenceKey(entry.key), referenceRaw);
    const next = { ...entry, referenceRaw, validBody: true, legacy: false, error: '' };
    assertPair(next); check(); registerOwn(next, onOwn);
    return next;
}
export async function upgradeFinancialOpeningReference(companyId: CompanyId, observed: FinancialOpeningRecoveryEntry, isCurrent: () => boolean, onOwn?: FinancialOpeningOwnObservation) {
    const pair = fixedPair(companyId, observed);
    return locked(pair.key, async () => { const check = await authorize(companyId, pair.actorUid, isCurrent); return promote(companyId, { ...observed, ...pair }, check, onOwn); });
}
function recordAttempt(entry: FinancialOpeningRecoveryEntry, error: unknown, sent: boolean, check: () => void, onOwn?: FinancialOpeningOwnObservation) {
    check(); assertPair(entry);
    if (!entry.referenceRaw || !entry.pending) throw Error('원인 안내를 기록할 독립 참조가 없습니다.');
    const copy = parseReference(entry.referenceRaw, entry.companyId, entry.actorUid);
    const lastAttempt: FinancialOpeningLastAttempt = { at: new Date().toISOString(), phase: sent ? 'sent' : 'before-send', outcome: sent && proof(error, entry.pending) ? 'server-rejected' : 'unconfirmed', message: safeMessage(error) };
    const referenceRaw = JSON.stringify({ ...copy, lastAttempt });
    localStorage.setItem(referenceKey(entry.key), referenceRaw);
    const next = { ...entry, referenceRaw, lastAttempt };
    assertPair(next); check(); registerOwn(next, onOwn);
}
async function authorizeAttempt(entry: FinancialOpeningRecoveryEntry, isCurrent: () => boolean, onOwn?: FinancialOpeningOwnObservation) {
    try { return await authorize(entry.companyId, entry.actorUid, isCurrent); }
    catch (error) {
        const check = () => { if (currentUid() !== entry.actorUid || !isCurrent()) throw Error('로그인 사용자 또는 화면이 변경되었습니다.'); };
        try { recordAttempt(entry, error, false, check, onOwn); }
        catch { throw Error(safeMessage(error) + ' 원인 안내를 기록하지 못했습니다. 원문과 현재 요청 정보를 다시 확인해 주세요.'); }
        throw error;
    }
}
async function sendEntry(entry: FinancialOpeningRecoveryEntry, check: () => void, onOwn?: FinancialOpeningOwnObservation): Promise<FinancialOpeningResult> {
    if (!entry.pending || !entry.validBody) throw Error('저장 원문과 독립 참조를 먼저 확인해 주세요.');
    let sent = false;
    try {
        check(); assertPair(entry);
        const call = httpsCallable<unknown, { result: FinancialOpeningResult }>(functions, 'financialOpeningCommand');
        sent = true;
        const response = await call(entry.pending.request);
        check();
        if (!response.data || !['created', 'unchanged', 'updated'].includes(response.data.result)) throw Error('기초 금융 저장 결과를 확인하지 못했습니다. 원문은 보존했습니다.');
        assertPair(entry); pairClear(entry);
        return response.data.result;
    } catch (error) {
        try { recordAttempt(entry, error, sent, check, onOwn); }
        catch { throw new Error(`${safeMessage(error)} 원인 안내를 기록하지 못했습니다. 원문과 현재 요청 정보를 다시 확인해 주세요.`); }
        throw error;
    }
}
export async function runFinancialOpening(companyId: CompanyId, draft: FinancialOpeningDraft): Promise<FinancialOpeningResult> {
    const uid = currentUid();
    if (!uid) throw Error('로그인을 확인해 주세요.');
    return locked(keyOf(companyId, uid), async () => {
        const draftText = JSON.stringify(draft), pair = capturePair(companyId, uid);
        const check = await authorize(companyId, uid, () => true);
        assertPair(pair);
        if (pair.bodyRaw !== null || pair.referenceRaw !== null) {
            const entry = await entryFromPair(companyId, uid, pair);
            if (!entry.validBody || !entry.pending) throw Error('이전 기초 금융 요청의 서버 결과를 확인하거나 독립 참조를 보관해 주세요.');
            const { operationId: _, releaseId: __, companyId: ___, ...body } = entry.pending.request;
            if (JSON.stringify(body) !== draftText) throw Error('이전에 저장 중이던 기초 금융 원문을 먼저 확인해 주세요.');
            check(); assertPair(entry);
            return sendEntry(entry, check);
        }
        const gate = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();
        check(); assertPair(pair);
        if (gate?.status !== 'active' || typeof gate.releaseId !== 'string') throw Error('기초 금융 저장 서버가 준비되지 않았습니다.');
        const pending: FinancialOpeningPending = { version: 1, companyId, userId: uid, request: { ...JSON.parse(draftText), companyId, operationId: `opening-${crypto.randomUUID()}`, releaseId: gate.releaseId } };
        const bodyRaw = JSON.stringify(pending), digest = await bodyDigest(bodyRaw);
        check(); assertPair(pair);
        const reference = referenceOf(pending);
        const referenceRaw = JSON.stringify({ version: 1, companyId, actorUid: uid, reference, bodyDigest: digest } satisfies ReferenceCopy);
        localStorage.setItem(pair.key, bodyRaw);
        localStorage.setItem(referenceKey(pair.key), referenceRaw);
        const entry: FinancialOpeningRecoveryEntry = { ...pair, companyId, actorUid: uid, bodyRaw, referenceRaw, pending, reference, validBody: true, legacy: false, error: '', description: '기초 금융 요청', conflictingReference: false, lastAttempt: null, references: [{ reference, source: 'both' }] };
        check(); assertPair(entry); notify();
        return sendEntry(entry, check);
    });
}
export async function retryFinancialOpening(companyId: CompanyId, observed: FinancialOpeningRecoveryEntry, isCurrent: () => boolean, onOwn?: FinancialOpeningOwnObservation) {
    const pair = fixedPair(companyId, observed);
    return locked(pair.key, async () => {
        const entry = await fixedEntry(companyId, { ...observed, ...pair });
        const check = await authorizeAttempt(entry, isCurrent, onOwn);
        assertPair(entry);
        return sendEntry(entry, check, onOwn);
    });
}
export async function resumeObservedFinancialOpening(companyId: CompanyId, observed: FinancialOpeningObservation, isCurrent: () => boolean) {
    const uid = currentUid();
    if (!uid) throw Error('로그인을 확인해 주세요.');
    const raw = observed.raw, pendingText = JSON.stringify(observed.pending), referenceRaw = observed.referenceRaw ?? null;
    const key = keyOf(companyId, uid);
    return locked(key, async () => {
        const pending = parsePending(raw, companyId, uid);
        if (JSON.stringify(pending) !== pendingText) throw Error('표시한 원문과 보관 요청이 다릅니다.');
        const entry = await entryFromPair(companyId, uid, { key, bodyRaw: raw, referenceRaw });
        const check = await authorizeAttempt(entry, isCurrent);
        assertPair(entry);
        return sendEntry(entry, check);
    });
}
export async function resumeFinancialOpening(companyId: CompanyId) {
    const observed = readFinancialOpeningObservation(companyId);
    if (!observed) throw Error('다시 확인할 기초 금융 요청이 없습니다.');
    return resumeObservedFinancialOpening(companyId, observed, () => true);
}
async function queryRecovery(mode: 'inspect' | 'cancel', companyId: CompanyId, observed: FinancialOpeningRecoveryEntry, isCurrent: () => boolean, selectedReference?: FinancialOpeningRecoveryReference) {
    const pair = fixedPair(companyId, observed);
    const selected = selectedReference ? normalizeFinancialOpeningRecoveryReference(selectedReference) : null;
    return locked(pair.key, async () => {
        const entry = await fixedEntry(companyId, { ...observed, ...pair });
        const reference = selected ?? entry.reference;
        if (!reference || !entry.references.some(item => sameReference(item.reference, reference))) throw Error('요청 번호를 식별할 수 없어 서버 결과를 확인하거나 중단할 수 없습니다.');
        const check = await authorize(companyId, pair.actorUid, isCurrent);
        assertPair(entry);
        const call = httpsCallable<unknown, unknown>(functions, 'financialOpeningCommand');
        const response = await call({ mode, reference });
        check(); assertPair(entry);
        return normalizeFinancialOpeningRecoveryResult(response.data, reference, pair.actorUid);
    });
}
export const inspectFinancialOpening = (companyId: CompanyId, entry: FinancialOpeningRecoveryEntry, isCurrent: () => boolean, reference?: FinancialOpeningRecoveryReference) => queryRecovery('inspect', companyId, entry, isCurrent, reference);
export const cancelFinancialOpening = (companyId: CompanyId, entry: FinancialOpeningRecoveryEntry, isCurrent: () => boolean, reference?: FinancialOpeningRecoveryReference) => queryRecovery('cancel', companyId, entry, isCurrent, reference);
export async function discardFinancialOpeningCopy(companyId: CompanyId, observed: FinancialOpeningRecoveryEntry, isCurrent: () => boolean) {
    const pair = fixedPair(companyId, observed);
    return locked(pair.key, async () => {
        const entry = await fixedEntry(companyId, { ...observed, ...pair });
        const check = await authorize(companyId, pair.actorUid, isCurrent);
        for (const { reference } of entry.references) {
            const call = httpsCallable<unknown, unknown>(functions, 'financialOpeningCommand');
            assertPair(entry);
            const response = await call({ mode: 'inspect', reference });
            check(); assertPair(entry);
            const result = normalizeFinancialOpeningRecoveryResult(response.data, reference, pair.actorUid);
            if (result.status === 'unknown') throw Error('서버 처리 여부가 확인되지 않았습니다. 미처리 중단이 확정된 뒤 정리해 주세요.');
        }
        check(); assertPair(entry); pairClear(entry);
    });
}
export function financialOpeningRecoveryProjection(entry: FinancialOpeningRecoveryEntry, result?: FinancialOpeningRecoveryResult | readonly FinancialOpeningRecoveryResult[] | null) {
    const results: readonly FinancialOpeningRecoveryResult[] = !result ? [] : Array.isArray(result) ? result : [result as FinancialOpeningRecoveryResult];
    const attemptCause = entry.lastAttempt?.outcome === 'server-rejected' ? '서버가 이 시도는 반영하지 않았습니다. ' + entry.lastAttempt.message : entry.lastAttempt?.message ?? '';
    const referenceRows = entry.references.map(item => {
        const bound = results.find(value => value.actorUid === entry.actorUid && sameReference(value.reference, item.reference));
        const terminal = bound?.status === 'applied' || bound?.status === 'cancelled';
        return { ...item, label: item.source === 'body' ? '본문에 남은 요청' : item.source === 'reference' ? '참조에 남은 요청' : '보관된 요청', currentState: bound?.status === 'applied' ? '이 요청의 기초 금융 처리는 완료되었습니다.' : bound?.status === 'cancelled' ? '이 요청의 미처리 중단이 확인되었습니다.' : '기초 금융 처리 여부를 확인해야 합니다.', cause: !terminal && item.source !== 'body' ? attemptCause : '', nextAction: terminal ? entry.references.length > 1 ? '다른 요청도 확인한 뒤 기기의 요청 정보를 정리해 주세요.' : '이 기기의 요청 정보를 정리한 뒤 현재 목록을 확인해 주세요.' : '서버 결과를 확인하거나 미처리 요청을 중단해 주세요.', canInspect: true, canCancel: !terminal, terminal, result: bound ?? null };
    });
    const terminal = referenceRows.length > 0 && referenceRows.every(item => item.terminal);
    const applied = terminal && referenceRows.some(item => item.result?.status === 'applied');
    const currentState = terminal ? entry.references.length > 1 ? '두 요청의 처리 결과를 모두 확인했습니다.' : applied ? '이 요청의 기초 금융 처리는 완료되었습니다.' : '이 요청의 미처리 중단이 확인되었습니다.' : entry.conflictingReference ? '서로 다른 두 요청의 처리 여부를 확인해야 합니다.' : '기초 금융 처리 여부를 확인해야 합니다.';
    const cause = terminal ? '' : entry.conflictingReference ? entry.error : attemptCause || entry.error;
    const nextAction = terminal ? applied ? '이후 추가 수정·삭제 여부는 확인하지 않았습니다. 이 기기의 요청 정보를 정리한 뒤 현재 목록을 확인해 주세요.' : '이 기기에 남은 요청 정보를 정리한 뒤 새 업무를 진행해 주세요.' : !entry.reference ? '요청 번호를 식별할 수 없어 서버 처리 여부는 확인할 수 없습니다. 이 기기의 손상 정보만 정리할 수 있으며 서버 요청 취소가 아닙니다.' : entry.conflictingReference ? '본문과 참조에 남은 두 요청을 각각 확인하거나 중단해 주세요. 두 요청의 결과가 확인된 뒤 기기 정보를 정리할 수 있습니다.' : entry.legacy ? '보관 원문의 독립 참조를 보관한 뒤 같은 내용으로 재시도하거나 서버 결과를 확인해 주세요.' : '서버 결과를 확인하거나 미처리 요청을 중단한 뒤 기기 요청 정보를 정리해 주세요.';
    return { currentState, cause, nextAction, referenceRows, canInspect: !!entry.reference, canRetry: entry.validBody && !terminal, canCancel: !!entry.reference && !terminal, canDiscard: !entry.reference || terminal, canUpgradeReference: entry.legacy && !!entry.reference };
}
