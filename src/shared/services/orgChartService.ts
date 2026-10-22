import { onIdTokenChanged } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, authReady, db } from '../firebase';
import { companySettingDocId, companySettingPatch } from '../companySettings';
import { withClaimCompany } from '../companyWriteBoundary';
import { stripUndefined } from './firebaseService';
import type { CompanyId } from '../types';
export interface OrgDept {
    id: string;
    keys: string[];
    name: string;
    headId?: string;
    memo?: string;
    tier?: 'exec' | 'normal';
}
export interface OrgChartConfig {
    top: {
        title: string;
        name: string;
    };
    departments: OrgDept[];
    updatedAt?: string;
}
type Scope = {
    companyId: CompanyId;
    isCurrent: () => boolean;
};
const stale = () => Error('회사 또는 로그인 계정이 바뀌었습니다. 현재 화면에서 다시 확인해 주세요.');
/** 같은 UID로 돌아와도 이전 토큰 이벤트의 읽기·저장을 되살리지 않는다. */
function capture(scope: Scope, onInvalid?: () => void) {
    const user = auth.currentUser, uid = user?.uid;
    let invalid = false, disposed = false, initialized = false;
    let stop: (() => void) | undefined;
    let resolveInitial!: () => void, rejectInitial!: (error: Error) => void;
    const initial = new Promise<void>((resolve, reject) => { resolveInitial = resolve; rejectInitial = reject; });
    const assertCurrent = () => {
        if (invalid || disposed || !scope.isCurrent() || !user || auth.currentUser !== user || auth.currentUser.uid !== uid)
            throw stale();
    };
    const invalidate = () => {
        if (invalid || disposed)
            return;
        invalid = true;
        rejectInitial(stale());
        stop?.();
        onInvalid?.();
    };
    try {
        stop = onIdTokenChanged(auth, observed => {
            if (initialized) {
                invalidate();
                return;
            }
            initialized = true;
            if (observed !== user || observed?.uid !== uid)
                invalidate();
            else
                resolveInitial();
        }, invalidate);
    }
    catch {
        invalidate();
    }
    if (invalid)
        stop?.();
    void initial.catch(() => undefined);
    const ready = async () => {
        await authReady;
        assertCurrent();
        await initial;
        assertCurrent();
        const token = await user!.getIdTokenResult();
        assertCurrent();
        // 기존 공통 저장과 같은 회사 정책이다. 새 직급·employeeId 조건을 만들지 않는다.
        withClaimCompany('settings', { companyId: scope.companyId }, { companyId: token.claims.companyId });
        assertCurrent();
        return token;
    };
    return { ready, assertCurrent, dispose() { disposed = true; rejectInitial(stale()); stop?.(); } };
}
export function subscribeOrgChart(input: Scope, onValue: (config: OrgChartConfig | null) => void, onError: (error: Error) => void): () => void {
    const scope = { companyId: input.companyId, isCurrent: input.isCurrent };
    let disposed = false, failed = false, stop: (() => void) | undefined;
    let actor: ReturnType<typeof capture> | undefined;
    const fail = (error: unknown) => {
        if (disposed || failed)
            return;
        failed = true;
        stop?.();
        actor?.dispose();
        if (scope.isCurrent())
            onError(error instanceof Error ? error : Error('조직도를 읽지 못했습니다. 다시 확인해 주세요.'));
    };
    actor = capture(scope, () => fail(stale()));
    const capturedActor = actor;
    void capturedActor.ready().then(() => {
        capturedActor.assertCurrent();
        if (disposed || failed)
            return;
        stop = onSnapshot(doc(db, 'settings', companySettingDocId(scope.companyId, 'orgChart')), snapshot => {
            try {
                capturedActor.assertCurrent();
                if (!disposed && !failed)
                    onValue(snapshot.exists() ? snapshot.data() as OrgChartConfig : null);
            }
            catch (error) {
                fail(error);
            }
        }, fail);
        if (disposed || failed)
            stop?.();
    }).catch(error => { fail(error); capturedActor.dispose(); });
    return () => { disposed = true; stop?.(); capturedActor.dispose(); };
}
export async function saveOrgChart(input: Scope & {
    employeeId: string;
    config: OrgChartConfig;
}): Promise<void> {
    const scope = { companyId: input.companyId, isCurrent: input.isCurrent };
    const payload = stripUndefined(companySettingPatch(scope.companyId, { ...input.config, updatedAt: new Date().toISOString() }));
    const actor = capture(scope);
    try {
        actor.assertCurrent();
        const token = await actor.ready();
        actor.assertCurrent();
        const data = withClaimCompany('settings', payload, { companyId: token.claims.companyId });
        const ref = doc(db, 'settings', companySettingDocId(scope.companyId, 'orgChart'));
        actor.assertCurrent();
        await setDoc(ref, data, { merge: true });
        actor.assertCurrent();
    }
    finally {
        actor.dispose();
    }
}
