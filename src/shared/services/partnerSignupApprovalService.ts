import { onIdTokenChanged } from 'firebase/auth';
import { collection, doc, getDocFromServer, onSnapshot, query, runTransaction, where, type Firestore } from 'firebase/firestore';
import { auth, authReady, db } from '../firebase';
import type { CompanyId } from '../types';
export interface PartnerSignupUser {
    id: string;
    companyId: CompanyId;
    uid?: string;
    username?: string;
    name?: string;
    phone?: string;
    email?: string;
    type?: string;
    status?: string;
    linkedPartnerId?: string | null;
    linkedPartnerName?: string;
    createdAt?: string;
}
export interface PartnerSignupScope {
    companyId: CompanyId;
    actorUid: string;
    isCurrent: () => boolean;
}
export interface PartnerSignupDecision {
    original: PartnerSignupUser;
    decision: 'approve' | 'reject';
    partnerId?: string;
}
export class PartnerSignupError extends Error {
    constructor(message: string, readonly outcome: 'not-started' | 'unknown', readonly cause?: unknown) { super(message); }
}
const keys = ['id', 'companyId', 'uid', 'username', 'name', 'phone', 'email', 'type', 'status', 'linkedPartnerId', 'linkedPartnerName', 'createdAt'] as const;
export function capturePartnerSignupOriginal(value: PartnerSignupUser): PartnerSignupUser {
    const copy: Record<string, unknown> = {};
    for (const key of keys)
        if (Object.prototype.hasOwnProperty.call(value, key))
            copy[key] = value[key];
    return copy as unknown as PartnerSignupUser;
}
export function partnerSignupOriginalText(value: PartnerSignupUser): string {
    return JSON.stringify(keys.map(key => [key, Object.prototype.hasOwnProperty.call(value, key), value[key]]));
}
const stale = () => new PartnerSignupError('회사 또는 로그인 계정이 바뀌었습니다. 현재 화면에서 다시 확인해 주세요.', 'not-started');
function captureActor(scope: PartnerSignupScope) {
    const user = auth.currentUser;
    let invalid = false, disposed = false, initialized = false;
    let stop: (() => void) | undefined;
    let resolve!: () => void, reject!: (error: Error) => void;
    const initial = new Promise<void>((a, b) => { resolve = a; reject = b; });
    const check = () => {
        if (invalid || disposed || !scope.isCurrent() || !user || user.uid !== scope.actorUid || auth.currentUser !== user || auth.currentUser.uid !== scope.actorUid)
            throw stale();
    };
    const invalidate = () => { invalid = true; reject(stale()); };
    stop = onIdTokenChanged(auth, observed => {
        if (initialized || observed !== user || observed?.uid !== scope.actorUid)
            invalidate();
        else {
            initialized = true;
            resolve();
        }
    }, invalidate);
    void initial.catch(() => undefined);
    return {
        check,
        async ready() {
            await authReady;
            check();
            await initial;
            check();
            const token = await user!.getIdTokenResult();
            check();
            if (token.claims.companyId !== scope.companyId || token.claims.isAdmin !== true || typeof token.claims.employeeId !== 'string')
                throw new PartnerSignupError('현재 회사 관리자만 가입 신청을 확인하고 처리할 수 있습니다.', 'not-started');
        },
        dispose() { disposed = true; reject(stale()); stop?.(); },
    };
}
function message(error: unknown, fallback: string) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code).split('/').pop() : '';
    if (code === 'permission-denied' || code === 'unauthenticated')
        return '현재 회사 관리자 권한을 확인하지 못했습니다. 로그인 상태를 확인한 뒤 다시 시도해 주세요.';
    if (code === 'unavailable' || code === 'deadline-exceeded')
        return '서버와 연결하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 확인해 주세요.';
    return error instanceof PartnerSignupError ? error.message : fallback;
}
export function subscribePendingPartnerSignups(scope: PartnerSignupScope, onValue: (rows: PartnerSignupUser[]) => void, onError: (error: Error) => void): () => void {
    const actor = captureActor(scope);
    let disposed = false;
    let stop: (() => void) | undefined;
    const fail = (error: unknown) => { if (!disposed && scope.isCurrent())
        onError(Error(message(error, '가입 신청 목록을 읽지 못했습니다. 다시 확인해 주세요.'))); stop?.(); actor.dispose(); };
    void actor.ready().then(() => {
        actor.check();
        if (disposed)
            return;
        stop = onSnapshot(query(collection(db, 'users'), where('companyId', '==', scope.companyId), where('status', '==', 'pending')), snapshot => {
            try {
                actor.check();
                if (!disposed)
                    onValue(snapshot.docs.map(row => ({ ...row.data(), id: row.id }) as PartnerSignupUser));
            }
            catch (error) {
                fail(error);
            }
        }, fail);
    }).catch(fail);
    return () => { disposed = true; stop?.(); actor.dispose(); };
}
export async function readPartnerSignup(scope: PartnerSignupScope, id: string, store: Firestore = db): Promise<PartnerSignupUser | null> {
    const actor = captureActor(scope);
    try {
        await actor.ready();
        actor.check();
        const row = await getDocFromServer(doc(store, 'users', id));
        actor.check();
        if (!row.exists())
            return null;
        if (row.data().companyId !== scope.companyId)
            throw new PartnerSignupError('다른 회사의 가입 신청은 확인할 수 없습니다.', 'not-started');
        return { ...row.data(), id: row.id } as PartnerSignupUser;
    }
    catch (error) {
        throw new PartnerSignupError(message(error, '가입 신청의 현재 상태를 확인하지 못했습니다. 다시 확인해 주세요.'), 'not-started', error);
    }
    finally {
        actor.dispose();
    }
}
export async function decidePartnerSignup(scope: PartnerSignupScope, input: PartnerSignupDecision, store: Firestore = db): Promise<void> {
    const original = capturePartnerSignupOriginal(input.original);
    const decision = input.decision, partnerId = input.partnerId;
    const actor = captureActor(scope);
    let started = false, committed = false;
    try {
        await actor.ready();
        actor.check();
        if (!original.id || original.id.includes('/') || original.companyId !== scope.companyId || original.status !== 'pending' || !['approve', 'reject'].includes(decision))
            throw new PartnerSignupError('처리할 가입 신청 원문을 다시 확인해 주세요.', 'not-started');
        if (decision === 'approve' && (!partnerId || partnerId.includes('/')))
            throw new PartnerSignupError('연결할 거래처를 먼저 선택해 주세요.', 'not-started');
        const changedAt = new Date().toISOString();
        started = true;
        await runTransaction(store, async (tx) => {
            actor.check();
            const target = doc(store, 'users', original.id), snapshot = await tx.get(target);
            actor.check();
            if (!snapshot.exists())
                throw new PartnerSignupError('가입 신청이 삭제되어 처리하지 않았습니다. 목록을 다시 확인해 주세요.', 'not-started');
            const current = { ...snapshot.data(), id: snapshot.id } as PartnerSignupUser;
            if (current.companyId !== scope.companyId || current.status !== 'pending' || partnerSignupOriginalText(current) !== partnerSignupOriginalText(original))
                throw new PartnerSignupError('가입 신청 내용 또는 처리 상태가 변경되었습니다. 현재 상태를 다시 확인해 주세요.', 'not-started');
            let partnerName = '';
            if (decision === 'approve') {
                const partner = await tx.get(doc(store, 'partners', partnerId!));
                actor.check();
                if (!partner.exists() || partner.data().companyId !== scope.companyId)
                    throw new PartnerSignupError('현재 회사의 거래처를 찾을 수 없습니다. 거래처를 다시 선택해 주세요.', 'not-started');
                partnerName = partner.data().name;
                if (typeof partnerName !== 'string')
                    throw new PartnerSignupError('거래처 이름을 확인할 수 없습니다. 거래처를 다시 확인해 주세요.', 'not-started');
            }
            actor.check();
            tx.update(target, decision === 'approve' ? { status: 'approved', linkedPartnerId: partnerId, linkedPartnerName: partnerName, approvedAt: changedAt } : { status: 'rejected', rejectedAt: changedAt });
        });
        committed = true;
        actor.check();
    }
    catch (error) {
        if (error instanceof PartnerSignupError && !committed)
            throw error;
        throw new PartnerSignupError(message(error, started ? '처리 결과를 확인하지 못했습니다. 현재 상태를 확인한 뒤 다음 행동을 선택해 주세요.' : '처리를 시작하지 못했습니다. 다시 확인해 주세요.'), started ? 'unknown' : 'not-started', error);
    }
    finally {
        actor.dispose();
    }
}
