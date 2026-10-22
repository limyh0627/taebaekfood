import { useEffect, useRef, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '../../../shared/firebase';
import { appConfirm } from '../../../shared/components/appDialog';
import type { CompanyId } from '../../../shared/types';
import { capturePartnerSignupOriginal, decidePartnerSignup, PartnerSignupError, partnerSignupOriginalText, readPartnerSignup, subscribePendingPartnerSignups, type PartnerSignupDecision, type PartnerSignupUser } from '../../../shared/services/partnerSignupApprovalService';
interface Retained {
    request: PartnerSignupDecision;
    message: string;
    retryAllowed: boolean;
    observed?: PartnerSignupUser | null;
}
export function usePartnerSignupApproval(companyId: CompanyId) {
    const uid = auth.currentUser?.uid ?? '';
    const owner = useRef({ companyId, uid });
    if (owner.current.companyId !== companyId || owner.current.uid !== uid)
        owner.current = { companyId, uid };
    const renderedOwner = owner.current;
    const mounted = useRef(false), locks = useRef(new Map<string, object>());
    const lockOwner = useRef(renderedOwner);
    if (lockOwner.current !== renderedOwner) {
        locks.current = new Map();
        lockOwner.current = renderedOwner;
    }
    const retained = useRef(new Map<string, Map<string, Retained>>());
    const [, repaint] = useState(0);
    const [read, setRead] = useState<{
        owner: typeof renderedOwner;
        status: 'loading' | 'ready' | 'error';
        rows: PartnerSignupUser[];
        error: string;
    }>({ owner: renderedOwner, status: 'loading', rows: [], error: '' });
    const [retry, setRetry] = useState(0);
    const [messages, setMessages] = useState<{
        owner: typeof renderedOwner;
        values: Record<string, string>;
    }>({ owner: renderedOwner, values: {} });
    const key = JSON.stringify([companyId, uid]);
    const records = retained.current.get(key) ?? new Map<string, Retained>();
    retained.current.set(key, records);
    const current = () => mounted.current && owner.current === renderedOwner && auth.currentUser?.uid === renderedOwner.uid;
    const scope = { companyId, actorUid: uid, isCurrent: current };
    const update = () => { if (current())
        repaint(value => value + 1); };
    const tell = (id: string, message: string) => { if (current())
        setMessages(previous => ({ owner: renderedOwner, values: { ...(previous.owner === renderedOwner ? previous.values : {}), [id]: message } })); };
    useEffect(() => {
        mounted.current = true;
        let initial = true;
        const stop = onIdTokenChanged(auth, user => {
            if (initial && user?.uid === renderedOwner.uid) {
                initial = false;
                return;
            }
            initial = false;
            owner.current = { companyId: owner.current.companyId, uid: user?.uid ?? '' };
            repaint(value => value + 1);
        });
        return () => { mounted.current = false; owner.current = { ...owner.current }; stop(); };
    }, []);
    useEffect(() => {
        setRead({ owner: renderedOwner, status: 'loading', rows: [], error: '' });
        return subscribePendingPartnerSignups(scope, rows => { if (current())
            setRead({ owner: renderedOwner, status: 'ready', rows, error: '' }); }, error => { if (current())
            setRead({ owner: renderedOwner, status: 'error', rows: [], error: error.message }); });
    }, [renderedOwner, retry]);
    const rows = read.owner === renderedOwner ? read.rows : [];
    const run = async (request: PartnerSignupDecision, retrying = false) => {
        const id = request.original.id;
        if (!current() || locks.current.has(id) || (!retrying && records.has(id)))
            return;
        const token = {};
        locks.current.set(id, token);
        update();
        const owns = () => current() && locks.current.get(id) === token;
        let sent: Retained | undefined;
        try {
            const fixed = { ...request, original: capturePartnerSignupOriginal(request.original) };
            if (!retrying) {
                const live = rows.find(row => row.id === id);
                if (!live || partnerSignupOriginalText(live) !== partnerSignupOriginalText(fixed.original))
                    return;
                if (fixed.decision === 'reject' && !await appConfirm(`${fixed.original.name ?? fixed.original.username ?? '해당 사용자'} 님의 가입을 거절하시겠습니까?`))
                    return;
            }
            if (!owns())
                return;
            sent = { request: fixed, message: '처리 결과를 확인하고 있습니다.', retryAllowed: false };
            records.set(id, sent);
            await decidePartnerSignup(scope, fixed);
            if (records.get(id) === sent)
                records.delete(id);
            if (!owns())
                return;
            tell(id, fixed.decision === 'approve' ? '가입 신청을 승인하고 거래처와 연결했습니다.' : '가입 신청을 거절했습니다.');
        }
        catch (error) {
            if (sent && records.get(id) === sent) {
                if (error instanceof PartnerSignupError && error.outcome === 'unknown')
                    records.set(id, { request: sent.request, message: error.message, retryAllowed: false });
                else if (retrying)
                    records.set(id, { request: sent.request, message: '이전 요청의 결과는 아직 확인되지 않았습니다. 현재 상태를 다시 확인해 주세요.', retryAllowed: false });
                else
                    records.delete(id);
            }
            if (owns()) {
                const text = error instanceof Error ? error.message : '처리 결과를 확인하지 못했습니다.';
                tell(id, text);
            }
        }
        finally {
            if (locks.current.get(id) === token) {
                locks.current.delete(id);
                update();
            }
        }
    };
    const inspect = async (id: string) => {
        const entry = records.get(id);
        if (!entry || !current() || locks.current.has(id))
            return;
        const token = {};
        locks.current.set(id, token);
        update();
        const owns = () => current() && locks.current.get(id) === token;
        try {
            const observed = await readPartnerSignup(scope, id);
            if (!owns())
                return;
            let message: string, retryAllowed = false;
            if (!observed)
                message = '현재 가입 신청이 삭제되어 있습니다. 신청을 새로 만들지 않았습니다.';
            else if (observed.status === 'pending' && partnerSignupOriginalText(observed) === partnerSignupOriginalText(entry.request.original)) {
                message = '현재 신청이 처리 대기 중입니다. 미처리 확정은 아니며, 같은 내용으로 다시 시도할 수 있습니다.';
                retryAllowed = true;
            }
            else if (observed.status === 'approved' && entry.request.decision === 'approve' && observed.linkedPartnerId === entry.request.partnerId)
                message = '현재 선택한 거래처로 승인되어 있습니다. 이번 요청이 처리되었다는 증명은 아닙니다.';
            else if (observed.status === 'rejected' && entry.request.decision === 'reject')
                message = '현재 가입 신청이 거절되어 있습니다. 이번 요청이 처리되었다는 증명은 아닙니다.';
            else
                message = '현재 신청 내용 또는 처리 상태가 달라졌습니다. 기존 요청을 새 상태에 적용하지 않습니다.';
            records.set(id, { ...entry, observed, message, retryAllowed });
            tell(id, message);
        }
        catch (error) {
            if (owns()) {
                const text = error instanceof Error ? error.message : '현재 상태를 확인하지 못했습니다.';
                records.set(id, { ...entry, message: text });
                tell(id, text);
            }
        }
        finally {
            if (locks.current.get(id) === token) {
                locks.current.delete(id);
                update();
            }
        }
    };
    const displayed = [...rows];
    for (const [id, entry] of records)
        if (!displayed.some(row => row.id === id))
            displayed.push(entry.request.original);
    return {
        observationToken: renderedOwner,
        status: read.owner === renderedOwner ? read.status : 'loading' as const, error: read.owner === renderedOwner ? read.error : '', rows: displayed,
        messages: messages.owner === renderedOwner ? messages.values : {}, records, busy: (id: string) => locks.current.has(id),
        approve: (row: PartnerSignupUser, partnerId: string) => run({ original: row, decision: 'approve', partnerId }), reject: (row: PartnerSignupUser) => run({ original: row, decision: 'reject' }),
        inspect, closeObserved: (id: string) => { const entry = records.get(id); if (current() && !locks.current.has(id) && entry && 'observed' in entry && (entry.observed === null || entry.observed?.status === 'approved' || entry.observed?.status === 'rejected')) {
            records.delete(id);
            update();
        } }, retryDecision: (id: string) => { const entry = records.get(id); return entry?.retryAllowed ? run(entry.request, true) : Promise.resolve(); },
        retryRead: () => { if (current())
            setRetry(value => value + 1); },
    };
}
