import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../src/shared/firebase';
import type { CompanyId } from '../src/shared/types';
import type { FinancialOpeningRecoveryResult, FinancialOpeningRecoveryReference } from '../src/shared/financialOpeningRecovery';
import { readFinancialOpeningRecovery, financialOpeningRecoveryProjection, inspectFinancialOpening, cancelFinancialOpening, discardFinancialOpeningCopy, retryFinancialOpening, upgradeFinancialOpeningReference, type FinancialOpeningPending } from '../src/shared/services/financialOpeningCommands';
type Entry = NonNullable<Awaited<ReturnType<typeof readFinancialOpeningRecovery>>>;
type Action = 'inspect' | 'retry' | 'cancel' | 'discard' | 'upgrade';
type Execution = {
    accepted: Set<string>;
    sawOther: boolean;
};
type Owner = {
    companyId: CompanyId;
    uid: string;
    execution: Execution | null;
    readSeq: number;
};
type View = {
    owner: Owner;
    entry: Entry | null;
    result?: FinancialOpeningRecoveryResult | readonly FinancialOpeningRecoveryResult[];
    readError: string;
    actionError: string;
    notice: string;
};
const pair = (entry: Entry) => JSON.stringify([entry.key, entry.bodyRaw, entry.referenceRaw]);
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
    const ownerRef = useRef<Owner>({ companyId, uid, execution: null, readSeq: 0 });
    if (ownerRef.current.companyId !== companyId || ownerRef.current.uid !== uid)
        ownerRef.current = { companyId, uid, execution: null, readSeq: 0 };
    const owner = ownerRef.current, mounted = useRef(false);
    const [, render] = useState(0);
    const [view, setView] = useState<View>({ owner, entry: null, readError: '', actionError: '', notice: '' });
    const [busyOwner, setBusyOwner] = useState<Owner | null>(null);
    const current = () => mounted.current && ownerRef.current === owner && auth.currentUser?.uid === owner.uid;
    const observe = (entry: Entry | null) => {
        if (entry && owner.execution && !owner.execution.accepted.has(pair(entry)))
            owner.execution.sawOther = true;
    };
    const read = async (explicit = false) => {
        if (!current())
            return;
        const seq = ++owner.readSeq;
        try {
            const entry = await readFinancialOpeningRecovery(companyId);
            if (!current() || seq !== owner.readSeq)
                return;
            observe(entry);
            setView(previous => ({ owner, entry, result: entry && previous.owner === owner && previous.entry && pair(previous.entry) === pair(entry) ? previous.result : undefined, readError: '', actionError: '', notice: entry ? (owner.execution?.sawOther ? '보관된 요청이 바뀌었습니다. 현재 내용을 확인한 뒤 해결 버튼을 다시 눌러 주세요.' : '') : explicit ? '이 기기에 보관된 요청이 없습니다. 서버에서 처리되지 않았다는 뜻은 아닙니다.' : '' }));
        }
        catch (e) {
            if (current() && seq === owner.readSeq)
                setView(previous => ({ owner, entry: previous.owner === owner ? previous.entry : null, readError: e instanceof Error ? e.message : '보관된 요청을 읽지 못했습니다.', actionError: '', notice: '' }));
        }
    };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => {
        const reread = () => { void read(); };
        void read();
        const unsubscribe = onAuthStateChanged(auth, user => {
            const nextUid = user?.uid ?? '';
            if (ownerRef.current.uid !== nextUid) {
                ownerRef.current = { companyId: ownerRef.current.companyId, uid: nextUid, execution: null, readSeq: 0 };
                render(v => v + 1);
            }
        });
        window.addEventListener('financial-opening-pending', reread);
        window.addEventListener('storage', reread);
        return () => { unsubscribe(); window.removeEventListener('financial-opening-pending', reread); window.removeEventListener('storage', reread); };
    }, [owner]);
    const visible = view.owner === owner ? view : null, entry = visible?.entry ?? null, busy = busyOwner === owner;
    const projection = entry ? financialOpeningRecoveryProjection(entry, visible?.result) : null;
    const execute = async (action: Action, reference?: FinancialOpeningRecoveryReference) => {
        if (!entry || !current() || owner.execution)
            return;
        const execution: Execution = { accepted: new Set([pair(entry)]), sawOther: false };
        owner.execution = execution;
        setBusyOwner(owner);
        const executing = () => current() && owner.execution === execution;
        const ownObservation = (next: Entry) => {
            if (!executing())
                return;
            execution.accepted.add(pair(next));
            if (!execution.sawOther)
                setView(previous => previous.owner === owner && previous.entry && execution.accepted.has(pair(previous.entry)) ? { ...previous, entry: next, actionError: '', notice: '' } : previous);
        };
        setView(previous => previous.owner === owner ? { ...previous, actionError: '', notice: '' } : previous);
        try {
            let result: FinancialOpeningRecoveryResult | undefined;
            if (action === 'inspect')
                result = await inspectFinancialOpening(companyId, entry, executing, reference);
            else if (action === 'cancel')
                result = await cancelFinancialOpening(companyId, entry, executing, reference);
            else if (action === 'retry')
                await retryFinancialOpening(companyId, entry, executing, ownObservation);
            else if (action === 'upgrade')
                await upgradeFinancialOpeningReference(companyId, entry, executing, ownObservation);
            else
                await discardFinancialOpeningCopy(companyId, entry, executing);
            if (!executing())
                return;
            const seq = ++owner.readSeq, latest = await readFinancialOpeningRecovery(companyId);
            if (!executing())
                return;
            observe(latest);
            if (execution.sawOther) {
                setView(previous => previous.owner === owner && previous.entry && execution.accepted.has(pair(previous.entry)) ? { ...previous, notice: '보관된 요청이 바뀌었습니다. 이 기기에 보관된 요청을 다시 읽고 확인해 주세요.' } : previous);
                return;
            }
            if (seq === owner.readSeq)
                setView(previous => {
                    const known = previous.owner === owner && previous.entry && latest && pair(previous.entry) === pair(latest) ? previous.result : undefined;
                    const results = known ? Array.isArray(known) ? [...known] : [known as FinancialOpeningRecoveryResult] : [];
                    if (result) {
                        const key = JSON.stringify(result.reference);
                        const index = results.findIndex(value => JSON.stringify(value.reference) === key);
                        if (index >= 0)
                            results[index] = result;
                        else
                            results.push(result);
                    }
                    return { owner, entry: latest, result: results, readError: '', actionError: '', notice: action === 'discard' ? '이 기기의 관측한 사본을 정리했습니다. 새로운 입력을 시작할 수 있습니다.' : action === 'upgrade' ? '보관된 원문에 조회용 참조를 복구했습니다. 실제 결과를 확인하거나 같은 원문으로 다시 시도해 주세요.' : '' };
                });
            if (action === 'retry' || action === 'discard')
                onRecovered();
        }
        catch (e) {
            if (!executing())
                return;
            let latest: Entry | null = null;
            try {
                latest = await readFinancialOpeningRecovery(companyId);
            }
            catch { }
            if (!executing())
                return;
            observe(latest);
            if (execution.sawOther) {
                setView(previous => previous.owner === owner && previous.entry && execution.accepted.has(pair(previous.entry)) ? { ...previous, notice: '보관된 요청이 바뀌었습니다. 이 기기에 보관된 요청을 다시 읽고 확인해 주세요.' } : previous);
                return;
            }
            const message = e instanceof Error ? e.message : '요청 결과를 확인하지 못했습니다. 보관된 요청을 다시 확인해 주세요.';
            const cause = latest ? financialOpeningRecoveryProjection(latest).cause : '';
            setView(previous => ({ owner, entry: latest, result: previous.owner === owner && previous.entry && latest && pair(previous.entry) === pair(latest) ? previous.result : undefined, readError: '', actionError: action === 'retry' && cause.includes(message) ? '' : message, notice: '' }));
        }
        finally {
            if (owner.execution === execution)
                owner.execution = null;
            if (current())
                setBusyOwner(value => value === owner ? null : value);
        }
    };
    if (!entry && !visible?.readError && !visible?.actionError && !visible?.notice && !busy)
        return null;
    const details = entry?.pending ? summary(entry.pending) : null;
    return <section aria-label="이전 기초 저장 확인" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
  <p className="font-semibold">이전 기초 저장 결과와 해결</p>
  {details && <p>{details[0]} · {details[1]} · {details[2]} · {typeof details[3] === 'number' && Number.isFinite(details[3]) ? `${details[3].toLocaleString('ko-KR')}원` : '금액 확인 필요'}</p>}
  {!details && entry && <p>{entry.description}</p>}
  {projection && <><p>현재 상태: {projection.currentState}</p><p>내용: {projection.cause}</p><p>다음 행동: {projection.nextAction}</p></>}
  {visible?.readError && <p role="alert" className="mt-1 text-red-700">보관 정보 읽기 오류: {visible.readError}</p>}
  {visible?.actionError && <p role="alert" className="mt-1 text-red-700">이번 확인 결과: {visible.actionError}</p>}
  {visible?.notice && <p role="status" className="mt-1">{visible.notice}</p>}
  {entry?.conflictingReference && projection?.referenceRows.map(row => <div key={JSON.stringify(row.reference)} className="mt-2 rounded-lg border border-amber-200 p-2">
        <p className="font-semibold">{row.label}</p><p>현재 상태: {row.currentState}</p>{row.cause && <p>내용: {row.cause}</p>}<p>다음 행동: {row.nextAction}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {row.canInspect && <button type="button" disabled={busy} onClick={() => void execute('inspect', row.reference)} className="rounded-lg border border-amber-300 px-3 py-2 disabled:opacity-50" aria-label={`${row.label} 실제 처리 결과 확인`}>실제 처리 결과 확인</button>}
          {row.canCancel && <button type="button" disabled={busy} onClick={() => void execute('cancel', row.reference)} className="rounded-lg border border-amber-300 px-3 py-2 disabled:opacity-50" aria-label={`${row.label} 미처리 요청 중단`}>미처리 요청 중단</button>}
        </div>
      </div>)}
  <div className="flex flex-wrap gap-2 mt-2">
   {!entry?.conflictingReference && projection?.canInspect && <button type="button" disabled={busy} onClick={() => void execute('inspect')} className="rounded-lg bg-amber-900 px-3 py-2 text-white disabled:opacity-50">실제 처리 결과 확인</button>}
   {projection?.canRetry && <button type="button" disabled={busy} onClick={() => void execute('retry')} className="rounded-lg bg-amber-900 px-3 py-2 text-white disabled:opacity-50">같은 내용으로 다시 시도</button>}
   {!entry?.conflictingReference && projection?.canCancel && <button type="button" disabled={busy} onClick={() => void execute('cancel')} className="rounded-lg border border-amber-300 px-3 py-2 disabled:opacity-50">미처리 요청 중단</button>}
   {projection?.canDiscard && <button type="button" disabled={busy} onClick={() => void execute('discard')} className="rounded-lg border border-amber-300 px-3 py-2 disabled:opacity-50">{entry?.reference ? '이 기기의 확인한 사본 정리' : '이 기기의 손상된 복구 정보만 정리'}</button>}
   {projection?.canUpgradeReference && <button type="button" disabled={busy} onClick={() => void execute('upgrade')} className="rounded-lg border border-amber-300 px-3 py-2 disabled:opacity-50">보관된 원문의 조회 참조 복구</button>}
   <button type="button" onClick={() => void read(true)} className="rounded-lg border border-amber-300 px-3 py-2">이 기기에 보관된 요청 다시 읽기</button>
  </div>
  {projection?.canRetry && <p className="mt-1">보관된 같은 내용으로 저장을 다시 시도합니다. 아직 처리되지 않았다면 이 요청이 저장됩니다.</p>}
  <p className="mt-1 text-xs">이 기기에 보관된 요청만 확인합니다. 다른 기기의 요청이나 사라진 과거 원문을 모두 찾는 기능은 아닙니다.</p>
 </section>;
}
