import { AR, AP } from '../autoJournal';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, db, functions } from '../firebase';
import type { CompanyId } from '../types';
import type { FinancialOpeningInput } from '../../../functions/src/financialOpeningCommand';

export type FinancialOpeningPending = { version: 1; companyId: CompanyId; userId: string; request: FinancialOpeningInput };
export type FinancialOpeningDraft = FinancialOpeningInput extends infer T ? T extends FinancialOpeningInput ? Omit<T, 'companyId' | 'operationId' | 'releaseId'> : never : never;
export interface FinancialOpeningObservation { pending: FinancialOpeningPending; raw: string }
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
    return { pending: parsePending(raw, companyId, uid), raw };
}
export function getPendingFinancialOpening(companyId: CompanyId): FinancialOpeningPending | null {
    return readFinancialOpeningObservation(companyId)?.pending ?? null;
}
function clear(key: string, raw: string) {
    if (localStorage.getItem(key) === raw) { localStorage.removeItem(key); notify(); }
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
async function send(pending: FinancialOpeningPending, raw: string, previous: boolean, check: () => void): Promise<FinancialOpeningResult> {
    const key = keyOf(pending.companyId, pending.userId);
    check(); assertObserved(key, raw);
    try {
        const call = httpsCallable<unknown, { result: FinancialOpeningResult }>(functions, 'financialOpeningCommand');
        const result = await call(pending.request);
        check();
        if (!result.data || !['created', 'unchanged', 'updated'].includes(result.data.result)) throw new Error('기초 금융 저장 결과를 확인하지 못했습니다. 원문은 보존했습니다.');
        clear(key, raw);
        return result.data.result;
    } catch (error) {
        if (!previous && currentUid() === pending.userId && proof(error, pending)) {
            check(); clear(key, raw);
        }
        throw error;
    }
}

export async function runFinancialOpening(companyId: CompanyId, draft: FinancialOpeningDraft): Promise<FinancialOpeningResult> {
    const uid = currentUid();
    if (!uid) throw new Error('로그인을 확인해 주세요.');
    const key = keyOf(companyId, uid);
    return locked(key, async () => {
        const draftText = JSON.stringify(draft);
        const observed = readFinancialOpeningObservation(companyId);
        const check = await authorize(companyId, uid, () => true);
        assertObserved(key, observed?.raw ?? null);
        if (observed) {
            const { operationId: _, releaseId: __, companyId: ___, ...body } = observed.pending.request;
            if (JSON.stringify(body) !== draftText) throw new Error('이전에 저장 중이던 기초 금융 원문을 먼저 재시도해 주세요.');
            return send(observed.pending, observed.raw, true, check);
        }
        const gate = (await getDoc(doc(db, 'appMeta', 'releaseCutover'))).data();
        check(); assertObserved(key, null);
        if (gate?.status !== 'active' || typeof gate.releaseId !== 'string') throw new Error('기초 금융 저장 서버가 준비되지 않았습니다.');
        const pending: FinancialOpeningPending = { version: 1, companyId, userId: uid,
            request: { ...JSON.parse(draftText), companyId, operationId: `opening-${crypto.randomUUID()}`, releaseId: gate.releaseId } };
        const raw = JSON.stringify(pending);
        assertObserved(key, null);
        localStorage.setItem(key, raw); notify();
        return send(pending, raw, false, check);
    });
}

/** 화면에 표시한 관측 원문만 재확인하며, 사본이 사라져도 복원하거나 새 요청을 만들지 않는다. */
export async function resumeObservedFinancialOpening(companyId: CompanyId, observed: FinancialOpeningObservation, isCurrent: () => boolean): Promise<FinancialOpeningResult> {
    const uid = currentUid();
    if (!uid) throw new Error('로그인을 확인해 주세요.');
    const key = keyOf(companyId, uid);
    return locked(key, async () => {
        const raw = observed.raw;
        const provided = JSON.stringify(observed.pending);
        const pending = parsePending(raw, companyId, uid);
        if (JSON.stringify(pending) !== provided) throw new Error('표시한 기초 금융 원문과 보관된 요청이 다릅니다. 다시 확인해 주세요.');
        assertObserved(key, raw);
        const check = await authorize(companyId, uid, isCurrent);
        assertObserved(key, raw);
        return send(pending, raw, true, check);
    });
}
export async function resumeFinancialOpening(companyId: CompanyId): Promise<FinancialOpeningResult> {
    const observed = readFinancialOpeningObservation(companyId);
    if (!observed) throw new Error('다시 확인할 기초 금융 요청이 없습니다.');
    return resumeObservedFinancialOpening(companyId, observed, () => true);
}
