import { useCallback, useEffect, useRef, useState } from 'react';
import { onIdTokenChanged, signOut, type User } from 'firebase/auth';
import { auth, authReady } from '../firebase';
import { employeeSession, readEmployeeSession } from '../employeeSession';
import { capturePushActor, unregisterPush } from '../push';
import type { Employee } from '../types';

const LOGOUT_INTENT_KEY = 'tb_logout_intent_v1';
type LogoutIntent = { version: 1; attemptId: string; uid: string; companyId: string; employeeId: string };
type IntentObservation = { raw: string | null; intent: LogoutIntent | null; readFailed: boolean };
type LogoutRun = {
    uid: string | null; key: string; employee: Employee | null;
    sawNull: boolean; running: boolean; raw: string | null; storageError: boolean;
};
function readLogoutIntent(): IntentObservation {
    let raw: string | null;
    try { raw = localStorage.getItem(LOGOUT_INTENT_KEY); }
    catch { return { raw: null, intent: null, readFailed: true }; }
    if (raw === null) return { raw, intent: null, readFailed: false };
    try {
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value)
            || Object.keys(value).sort().join(',') !== 'attemptId,companyId,employeeId,uid,version'
            || value.version !== 1 || typeof value.attemptId !== 'string'
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.attemptId)
            || typeof value.uid !== 'string' || !value.uid
            || !['taebaek', 'punghoe'].includes(value.companyId) || typeof value.employeeId !== 'string') throw Error();
        return { raw, intent: value as LogoutIntent, readFailed: false };
    } catch { return { raw, intent: null, readFailed: false }; }
}
function discardLogoutIntent(raw: string | null) {
    if (raw === null) return;
    try { if (localStorage.getItem(LOGOUT_INTENT_KEY) === raw) localStorage.removeItem(LOGOUT_INTENT_KEY); }
    catch { /* 인증 종료와 기기 기록 정리의 성공 여부를 혼동하지 않는다. */ }
}
function removeSavedEmployee() {
    try { localStorage.removeItem('tb_user'); } catch { /* Auth null이 확인되면 저장소 실패로 로그인을 막지 않는다. */ }
}
/** 저장된 이름은 화면 복원용이며 신원과 권한은 현재 토큰으로만 확인한다. */
export function useEmployeeAuthSession() {
    const [session, setSession] = useState<{ user: Employee; key: string } | null>(null);
    const [initialIntent] = useState(readLogoutIntent);
    const [authChecked, setAuthChecked] = useState(false);
    const [logoutState, setLogoutState] = useState<'idle' | 'pending' | 'failed'>(initialIntent.raw !== null || initialIntent.readFailed ? 'pending' : 'idle');
    const [logoutError, setLogoutError] = useState('');
    const logoutRun = useRef<LogoutRun | null>(null);
    const sessionRef = useRef(session);
    sessionRef.current = session;
    const generation = useRef(0);
    const mounted = useRef(false);
    const verifiedUid = useRef<string | null>(null);
    const candidate = useRef<Employee | null>(null);
    const freshLoginAfterNull = useRef(false);
    const clearSession = useCallback(() => {
        generation.current++;
        verifiedUid.current = null;
        candidate.current = null;
        setSession(null);
        removeSavedEmployee();
    }, []);
    const restoreLogoutCheckFailure = useCallback((user: User, observed: IntentObservation) => {
        logoutRun.current = { uid: user.uid, key: '', employee: null, sawNull: false, running: false, raw: observed.raw, storageError: observed.readFailed };
        setSession(null);
        setLogoutState('failed');
        setLogoutError('인증 상태 확인을 마치지 못했습니다. 현재 계정을 다시 로그아웃해 주세요.');
        setAuthChecked(true);
    }, []);
    const verify = useCallback(async (user: User | null, login?: Employee) => {
        if (!user && auth.currentUser !== null) return;
        const pending = logoutRun.current;
        if (pending && !user && pending.running) {
            pending.sawNull = true;
            freshLoginAfterNull.current = true;
            return;
        }
        // 새 계정 이벤트는 옛 요청부터 무효화하되, 새 토큰 검증 전에 업무 화면은 열지 않는다.
        if (pending && user && (pending.uid !== user.uid || pending.sawNull)) {
            logoutRun.current = null;
            setSession(null);
        }
        const turn = ++generation.current;
        const uid = user?.uid;
        if (!user || user.isAnonymous) {
            freshLoginAfterNull.current = true;
            discardLogoutIntent(readLogoutIntent().raw);
            logoutRun.current = null;
            verifiedUid.current = null;
            candidate.current = null;
            setSession(null);
            removeSavedEmployee();
            setLogoutState('idle');
            setLogoutError('');
            setAuthChecked(true);
            return;
        }
        if (verifiedUid.current !== uid) setSession(null);
        try {
            const token = await user.getIdTokenResult();
            if (!mounted.current || turn !== generation.current || auth.currentUser?.uid !== uid) return;
            const claims = token.claims;
            const observed = readLogoutIntent();
            const activeCandidate = candidate.current;
            if (login && verifiedUid.current === uid && activeCandidate && claims.employeeId === activeCandidate.id && claims.companyId === activeCandidate.companyId
                && (claims.employeeId !== login.id || claims.companyId !== login.companyId)) return;
            const validActor = typeof claims.employeeId === 'string' && ['taebaek', 'punghoe'].includes(String(claims.companyId))
                && (claims.employeeId !== 'admin' || claims.isAdmin === true);
            const key = [uid, claims.employeeId, claims.companyId, claims.isAdmin === true ? 'admin' : 'staff'].join(':');
            if (logoutRun.current && (logoutRun.current.key === key || logoutRun.current.key === '' && logoutRun.current.uid === uid)) {
                if (validActor) logoutRun.current.key = key;
                return;
            }
            const intent = observed.intent;
            const sameIntentActor = intent !== null && intent.uid === uid && intent.companyId === claims.companyId && intent.employeeId === claims.employeeId;
            const blocked = observed.readFailed || observed.raw !== null && (!observed.intent || sameIntentActor);
            if (validActor && blocked && !freshLoginAfterNull.current) {
                logoutRun.current = { uid: user.uid, key, employee: null, sawNull: false, running: false, raw: observed.raw, storageError: observed.readFailed };
                verifiedUid.current = user.uid;
                setSession(null);
                setLogoutState('failed');
                setLogoutError(observed.readFailed ? '로그아웃 요청 기록을 읽지 못했습니다. 현재 계정을 다시 로그아웃해 주세요.'
                    : observed.intent ? '이전 로그아웃의 완료를 확인하지 못했습니다. 다시 로그아웃해 주세요.' : '로그아웃 요청 기록을 확인하지 못했습니다. 현재 계정을 다시 로그아웃해 주세요.');
                return;
            }
            const saved = login ?? candidate.current ?? readEmployeeSession(localStorage.getItem('tb_user'));
            if (!validActor || !saved || claims.employeeId !== saved.id || claims.companyId !== saved.companyId)
                throw Error('로그인 신원이 저장된 직원과 다릅니다.');
            const safe = employeeSession({ ...saved, adminAccess: claims.isAdmin === true });
            discardLogoutIntent(observed.raw);
            logoutRun.current = null;
            freshLoginAfterNull.current = false;
            setLogoutState('idle');
            setLogoutError('');
            candidate.current = safe;
            verifiedUid.current = user.uid;
            localStorage.setItem('tb_user', JSON.stringify(safe));
            localStorage.removeItem('tb_company');
            setSession(previous => previous?.key === key ? previous : { user: safe, key });
        } catch {
            if (!mounted.current || turn !== generation.current || auth.currentUser?.uid !== uid || logoutRun.current) return;
            const observed = readLogoutIntent();
            if (observed.raw !== null || observed.readFailed || initialIntent.raw !== null || initialIntent.readFailed) {
                restoreLogoutCheckFailure(user, observed);
                return;
            }
            candidate.current = null;
            verifiedUid.current = null;
            setSession(null);
            removeSavedEmployee();
        } finally {
            if (mounted.current && turn === generation.current) setAuthChecked(true);
        }
    }, [initialIntent, restoreLogoutCheckFailure]);
    useEffect(() => {
        mounted.current = true;
        let live = true;
        let stop: (() => void) | undefined;
        void authReady.then(() => { if (live && mounted.current) stop = onIdTokenChanged(auth, user => { void verify(user); }); })
            .catch(() => {
                if (!live || !mounted.current) return;
                stop = onIdTokenChanged(auth, user => { void verify(user); });
                const observed = readLogoutIntent(), user = auth.currentUser;
                if (user && (observed.raw !== null || observed.readFailed || initialIntent.raw !== null || initialIntent.readFailed)) {
                    restoreLogoutCheckFailure(user, observed);
                    return;
                }
                if (!user) discardLogoutIntent(observed.raw);
                clearSession();
                setLogoutState('idle');
                setLogoutError('');
                setAuthChecked(true);
            });
        return () => { live = false; mounted.current = false; generation.current++; logoutRun.current = null; stop?.(); };
    }, [verify, clearSession, initialIntent, restoreLogoutCheckFailure]);
    const performLogout = useCallback(async (retry = false): Promise<void> => {
        if (!mounted.current || logoutRun.current && (!retry || logoutRun.current.running)) return;
        const previous = logoutRun.current;
        if (previous && auth.currentUser && auth.currentUser.uid !== previous.uid) return;
        const selected = sessionRef.current;
        if (!previous && selected && auth.currentUser && auth.currentUser.uid !== verifiedUid.current) return;
        const run: LogoutRun = previous ?? { uid: auth.currentUser?.uid ?? null, key: selected?.key ?? '', employee: selected?.user ?? null,
            sawNull: false, running: false, raw: null, storageError: false };
        run.running = true;
        logoutRun.current = run;
        generation.current++;
        setLogoutState('pending');
        setLogoutError('');
        if (!previous && run.employee && run.uid) {
            const companyId = run.employee.companyId;
            if (companyId === 'taebaek' || companyId === 'punghoe') {
                const intent: LogoutIntent = { version: 1, attemptId: crypto.randomUUID(), uid: run.uid, companyId, employeeId: run.employee.id };
                run.raw = JSON.stringify(intent);
                try {
                    localStorage.setItem(LOGOUT_INTENT_KEY, run.raw);
                    if (localStorage.getItem(LOGOUT_INTENT_KEY) !== run.raw) throw Error();
                } catch { run.storageError = true; }
            } else run.storageError = true;
            // 예약 사이에 계정이 바뀌어도 새 사람의 푸시 표를 지우지 않는다.
            try {
                const pushActor = capturePushActor(run.employee.id);
                void Promise.resolve().then(() => unregisterPush(run.employee!.id, undefined, pushActor))
                    .catch(() => undefined).finally(() => pushActor.dispose());
            } catch { /* 푸시 준비 실패로 인증 종료를 막지 않는다. */ }
        }
        const current = () => mounted.current && logoutRun.current === run && (!auth.currentUser || auth.currentUser.uid === run.uid);
        const complete = () => {
            discardLogoutIntent(run.raw);
            clearSession();
            logoutRun.current = null;
            freshLoginAfterNull.current = true;
            setAuthChecked(true);
            setLogoutState('idle');
        };
        try {
            if (previous && auth.currentUser) {
                const selectedUser = auth.currentUser;
                // 토큰 발급 실패는 업무 권한을 주지 않지만, 사용자가 요청한 인증 종료까지 막지는 않는다.
                const token = await selectedUser.getIdTokenResult().catch(() => null);
                if (!current() || auth.currentUser !== selectedUser) return;
                if (token && run.key) {
                    const claims = token.claims;
                    const actorKey = [selectedUser.uid, claims.employeeId, claims.companyId, claims.isAdmin === true ? 'admin' : 'staff'].join(':');
                    if (actorKey !== run.key) throw Error('로그인 계정 정보가 바뀌었습니다. 현재 계정을 다시 확인한 뒤 로그아웃해 주세요.');
                }
            }
            await signOut(auth);
            if (!current()) return;
            if (auth.currentUser !== null) throw Error('로그인 상태가 남아 있습니다. 다시 로그아웃해 주세요.');
            complete();
        } catch (error) {
            if (!current()) return;
            if (auth.currentUser === null) { complete(); return; }
            run.running = false;
            const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
            const detail = code === 'auth/network-request-failed' ? '네트워크 연결을 확인한 뒤 다시 로그아웃해 주세요.'
                : code.startsWith('auth/') ? '로그아웃 완료를 확인하지 못했습니다. 현재 인증 상태가 남아 있습니다. 다시 시도해 주세요.'
                : error instanceof Error ? error.message : '로그아웃 결과를 확인하지 못했습니다.';
            setLogoutError(detail + (run.storageError ? ' 기기에 요청 기록을 보관하지 못했습니다. 새로고침 후에는 이 차단 상태를 유지하지 못할 수 있습니다. 이 화면에서 다시 로그아웃해 주세요.' : ''));
            setLogoutState('failed');
        }
    }, [clearSession]);
    const logout = useCallback(() => performLogout(), [performLogout]);
    const retryLogout = useCallback(() => performLogout(true), [performLogout]);
    const onLogin = useCallback((employee: Employee) => { void verify(auth.currentUser, employeeSession(employee)); }, [verify]);
    return { currentUser: session?.user ?? null, sessionKey: session?.key ?? '', authChecked, onLogin, clearSession, logout, retryLogout, logoutState, logoutError };
}
