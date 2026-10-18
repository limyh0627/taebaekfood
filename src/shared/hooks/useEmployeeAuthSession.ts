import { useCallback, useEffect, useRef, useState } from 'react';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { auth, authReady } from '../firebase';
import { employeeSession, readEmployeeSession } from '../employeeSession';
import type { Employee } from '../types';
/** 저장된 이름은 화면 복원용이며 신원과 권한은 현재 토큰으로만 확인한다. */
export function useEmployeeAuthSession() {
    const [session, setSession] = useState<{
        user: Employee;
        key: string;
    } | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const generation = useRef(0);
    const mounted = useRef(false);
    const verifiedUid = useRef<string | null>(null);
    const candidate = useRef<Employee | null>(null);
    const clearSession = useCallback(() => {
        generation.current++;
        verifiedUid.current = null;
        candidate.current = null;
        setSession(null);
        localStorage.removeItem('tb_user');
    }, []);
    const verify = useCallback(async (user: User | null, login?: Employee) => {
        const turn = ++generation.current;
        const uid = user?.uid;
        if (!user || user.isAnonymous) {
            verifiedUid.current = null;
            candidate.current = null;
            setSession(null);
            localStorage.removeItem('tb_user');
            setAuthChecked(true);
            return;
        }
        if (verifiedUid.current !== uid)
            setSession(null);
        const saved = login ?? candidate.current ?? readEmployeeSession(localStorage.getItem('tb_user'));
        try {
            const token = await user.getIdTokenResult();
            if (!mounted.current || turn !== generation.current || auth.currentUser?.uid !== uid)
                return;
            const claims = token.claims;
            const activeCandidate = candidate.current;
            if (login && verifiedUid.current === uid && activeCandidate && claims.employeeId === activeCandidate.id && claims.companyId === activeCandidate.companyId && (claims.employeeId !== login.id || claims.companyId !== login.companyId)) return;
            if ((claims.employeeId === 'admin' && claims.isAdmin !== true) || !saved || claims.employeeId !== saved.id || claims.companyId !== saved.companyId || !['taebaek', 'punghoe'].includes(String(claims.companyId)))
                throw Error('로그인 신원이 저장된 직원과 다릅니다.');
            const safe = employeeSession({ ...saved, adminAccess: claims.isAdmin === true });
            candidate.current = safe;
            verifiedUid.current = user.uid;
            localStorage.setItem('tb_user', JSON.stringify(safe));
            localStorage.removeItem('tb_company');
            const key = [uid, safe.id, safe.companyId, claims.isAdmin === true ? 'admin' : 'staff'].join(':');
            setSession(previous => previous?.key === key ? previous : { user: safe, key });
        }
        catch {
            if (!mounted.current || turn !== generation.current || auth.currentUser?.uid !== uid)
                return;
            candidate.current = null;
            verifiedUid.current = null;
            setSession(null);
            localStorage.removeItem('tb_user');
        }
        finally {
            if (mounted.current && turn === generation.current)
                setAuthChecked(true);
        }
    }, []);
    useEffect(() => {
        mounted.current = true;
        let live = true;
        let stop: (() => void) | undefined;
        void authReady.then(() => { if (live && mounted.current)
            stop = onIdTokenChanged(auth, user => { void verify(user); }); }).catch(() => { if (mounted.current) {
            clearSession();
            setAuthChecked(true);
        } });
        return () => { live = false; mounted.current = false; generation.current++; stop?.(); };
    }, [verify, clearSession]);
    const onLogin = useCallback((employee: Employee) => {
        void verify(auth.currentUser, employeeSession(employee));
    }, [verify]);
    return { currentUser: session?.user ?? null, sessionKey: session?.key ?? '', authChecked, onLogin, clearSession };
}
