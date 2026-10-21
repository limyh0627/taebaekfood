import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../src/shared/firebase';
import type { CompanyId } from '../src/shared/types';
import { readFinancialOpeningObservation, resumeObservedFinancialOpening, type FinancialOpeningPending } from '../src/shared/services/financialOpeningCommands';
type Observation = NonNullable<ReturnType<typeof readFinancialOpeningObservation>>;
type Execution = {
    observed: Observation;
    sawOther: boolean;
};
type Owner = {
    companyId: CompanyId;
    uid: string;
    execution: Execution | null;
};
function summary(p: FinancialOpeningPending) {
    const r = p.request;
    switch (r.kind) {
        case 'partner-create': return ['거래처 기초 등록', r.partnerId, r.date, r.amount] as const;
        case 'loan-create': return ['대출 기초 등록', r.loan.name, r.loan.openingDate, r.loan.openingPrincipal] as const;
        case 'loan-update': return ['대출 기초 수정', r.original.name, r.newDate, r.targetBalance] as const;
        case 'account-create': return ['계좌 기초 등록', r.account.name, r.account.openingDate, r.account.openingBalance] as const;
        case 'account-update': return ['계좌 기초 수정', r.name, r.newDate, r.targetBalance] as const;
    }
}
export default function FinancialOpeningResume({ companyId, onRecovered }: {
    companyId: CompanyId;
    onRecovered: () => void;
}) {
    const uid = auth.currentUser?.uid ?? '';
    const ownerRef = useRef<Owner>({ companyId, uid, execution: null });
    if (ownerRef.current.companyId !== companyId || ownerRef.current.uid !== uid)
        ownerRef.current = { companyId, uid, execution: null };
    const owner = ownerRef.current;
    const mounted = useRef(false);
    const [, render] = useState(0);
    const [view, setView] = useState<{
        owner: Owner;
        observed: Observation | null;
        error: string;
        notice: string;
    }>({ owner, observed: null, error: '', notice: '' });
    const [busyOwner, setBusyOwner] = useState<Owner | null>(null);
    const current = () => mounted.current && ownerRef.current === owner && auth.currentUser?.uid === owner.uid;
    const read = (explicit = false) => {
        if (!current())
            return null;
        try {
            const observed = readFinancialOpeningObservation(companyId);
            if (observed && owner.execution && observed.raw !== owner.execution.observed.raw)
                owner.execution.sawOther = true;
            setView({ owner, observed, error: '', notice: observed ? (owner.execution?.sawOther ? '보관된 요청이 바뀌었습니다. 현재 요청을 확인한 뒤 다시 눌러 주세요.' : '') : explicit ? '이 기기에 보관된 요청이 없습니다. 서버에서 처리되지 않았다는 뜻은 아닙니다.' : '' });
            return observed;
        }
        catch (e) {
            setView({ owner, observed: null, error: e instanceof Error ? e.message : '이전 기초 저장 원문을 확인할 수 없습니다.', notice: '' });
            return null;
        }
    };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        const reread = () => { read(); };
        read();
        const unsubscribe = onAuthStateChanged(auth, user => {
            const nextUid = user?.uid ?? '';
            if (ownerRef.current.uid !== nextUid) {
                ownerRef.current = { companyId: ownerRef.current.companyId, uid: nextUid, execution: null };
                render(v => v + 1);
            }
        });
        window.addEventListener('financial-opening-pending', reread);
        window.addEventListener('storage', reread);
        return () => { unsubscribe(); window.removeEventListener('financial-opening-pending', reread); window.removeEventListener('storage', reread); };
    }, [owner]);
    const visible = view.owner === owner ? view : null;
    const observed = visible?.observed ?? null;
    const pending = observed?.pending ?? null;
    const busy = busyOwner === owner;
    const resume = async () => {
        if (!current() || owner.execution || !observed)
            return;
        const execution: Execution = { observed, sawOther: false };
        owner.execution = execution;
        setBusyOwner(owner);
        setView(v => v.owner === owner ? { ...v, error: '', notice: '' } : v);
        const executing = () => current() && owner.execution === execution;
        try {
            await resumeObservedFinancialOpening(companyId, observed, executing);
            if (!executing())
                return;
            const latest = readFinancialOpeningObservation(companyId);
            if (latest && latest.raw !== observed.raw) {
                execution.sawOther = true;
                setView(v => v.owner === owner && v.observed?.raw === observed.raw ? { ...v, error: '', notice: '보관된 요청이 바뀌었습니다. 현재 요청을 다시 읽고 확인해 주세요.' } : v);
            }
            if (execution.sawOther)
                return;
            setView({ owner, observed: latest, error: '', notice: '' });
            onRecovered();
        }
        catch (e) {
            if (!executing())
                return;
            let latest: Observation | null = null;
            try {
                latest = readFinancialOpeningObservation(companyId);
            }
            catch { }
            if (latest && latest.raw !== observed.raw)
                execution.sawOther = true;
            if (execution.sawOther) {
                setView(v => v.owner === owner && v.observed?.raw === observed.raw ? { ...v, error: '', notice: '보관된 요청이 바뀌었습니다. 현재 요청을 다시 읽고 확인해 주세요.' } : v);
                return;
            }
            setView({ owner, observed: latest, error: e instanceof Error ? e.message : '저장 결과를 확인하지 못했습니다. 이전 요청을 다시 확인해 주세요.', notice: '' });
        }
        finally {
            if (owner.execution === execution)
                owner.execution = null;
            if (current())
                setBusyOwner(value => value === owner ? null : value);
        }
    };
    if (!pending && !visible?.error && !visible?.notice && !busy)
        return null;
    const details = pending ? summary(pending) : null;
    return <section aria-label="이전 기초 저장 확인" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
    <p className="font-semibold">이전 기초 저장 결과를 확인해 주세요</p>
    <p>보관된 같은 내용으로 저장을 다시 시도합니다. 아직 처리되지 않았다면 이 요청이 저장됩니다.</p>
    {details && <p>{details[0]} · {details[1]} · {details[2]} · {typeof details[3] === 'number' && Number.isFinite(details[3]) ? `${details[3].toLocaleString('ko-KR')}원` : '금액 확인 필요'}</p>}
    {visible?.error && <p role="alert" className="mt-1 text-red-700">{visible.error}</p>}
    {visible?.notice && <p role="status" className="mt-1">{visible.notice}</p>}
    {pending && <button type="button" disabled={busy} onClick={() => void resume()} className="mt-2 rounded-lg bg-amber-900 px-3 py-2 text-white disabled:opacity-50">{busy ? '저장 확인 중…' : '같은 내용으로 다시 시도'}</button>}
    <button type="button" onClick={() => read(true)} className="ml-2 mt-2 rounded-lg border border-amber-300 px-3 py-2">이 기기에 보관된 요청 다시 읽기</button>
  </section>;
}
