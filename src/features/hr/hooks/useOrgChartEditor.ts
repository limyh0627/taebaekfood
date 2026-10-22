import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { auth } from '../../../shared/firebase';
import { subscribeOrgChart, saveOrgChart, type OrgChartConfig } from '../../../shared/services/orgChartService';
import type { CompanyId } from '../../../shared/types';
type Status = 'loading' | 'ready' | 'missing' | 'error';
type Owner = {
    companyId: CompanyId;
    employeeId: string;
    requestScopeKey: string;
    uid: string;
};
type State = {
    owner: Owner;
    status: Status;
    saved: OrgChartConfig | null;
    draft: OrgChartConfig | null;
    busy: boolean;
    error: string;
    run: object | null;
};
/** 조회·편집·저장 소유자를 함께 고정해 늦은 회사 응답이 새 초안을 닫지 못하게 한다. */
export function useOrgChartEditor(options: {
    companyId: CompanyId;
    employeeId: string;
    requestScopeKey?: string;
}) {
    const [, paint] = useState(0), [revision, setRevision] = useState(0);
    const latest = useRef(options);
    latest.current = options;
    const owner = useRef<Owner>({ ...options, requestScopeKey: options.requestScopeKey ?? '', uid: auth.currentUser?.uid ?? '' });
    const resetOwner = () => { owner.current = { ...latest.current, requestScopeKey: latest.current.requestScopeKey ?? '', uid: auth.currentUser?.uid ?? '' }; };
    if (owner.current.companyId !== options.companyId || owner.current.employeeId !== options.employeeId || owner.current.requestScopeKey !== (options.requestScopeKey ?? '') || owner.current.uid !== (auth.currentUser?.uid ?? ''))
        resetOwner();
    const state = useRef<State>({ owner: owner.current, status: 'loading', saved: null, draft: null, busy: false, error: '', run: null });
    if (state.current.owner !== owner.current)
        state.current = { owner: owner.current, status: 'loading', saved: null, draft: null, busy: false, error: '', run: null };
    const mounted = useRef(false);
    const current = (captured: Owner) => mounted.current && owner.current === captured && auth.currentUser?.uid === captured.uid;
    useEffect(() => { mounted.current = true; const stop = auth.onAuthStateChanged(user => { if ((user?.uid ?? '') !== owner.current.uid) {
        resetOwner();
        paint(n => n + 1);
    } }); return () => { mounted.current = false; stop(); }; }, []);
    useEffect(() => {
        const captured = owner.current;
        let active = true;
        const valid = () => active && current(captured);
        const s = state.current;
        s.status = 'loading';
        s.error = '';
        paint(n => n + 1);
        const stop = subscribeOrgChart({ companyId: captured.companyId, isCurrent: valid }, value => { if (!valid())
            return; s.saved = value; s.status = value ? 'ready' : 'missing'; s.error = ''; paint(n => n + 1); }, error => { if (!valid())
            return; s.status = 'error'; s.error = error.message || '조직도를 읽지 못했습니다. 다시 읽어 주세요.'; paint(n => n + 1); });
        return () => { active = false; stop(); };
    }, [owner.current, revision]);
    const s = state.current, captured = s.owner;
    const editable = () => current(captured) && (s.status === 'ready' || s.status === 'missing') && !s.busy;
    const setDraft = (update: SetStateAction<OrgChartConfig | null>) => { if (!editable())
        return; s.draft = typeof update === 'function' ? update(s.draft) : update; paint(n => n + 1); };
    const startEdit = (value: OrgChartConfig) => { if (!editable())
        return; s.draft = structuredClone(value); s.error = ''; paint(n => n + 1); };
    const cancel = () => { if (!current(captured) || s.busy)
        return; s.draft = null; s.error = ''; paint(n => n + 1); };
    const save = async () => {
        if (!editable() || !s.draft)
            return;
        const draft = s.draft, config = structuredClone(draft), run = {};
        s.run = run;
        s.busy = true;
        s.error = '';
        paint(n => n + 1);
        const valid = () => current(captured) && state.current === s && s.run === run && s.draft === draft;
        try {
            await saveOrgChart({ companyId: captured.companyId, employeeId: captured.employeeId, config, isCurrent: valid });
            if (!valid())
                return;
            s.saved = config;
            s.draft = null;
        }
        catch (error) {
            if (valid())
                s.error = '조직도 저장 결과를 확인하지 못했습니다. 작성 내용은 유지했습니다. ' + (error instanceof Error ? error.message : '다시 확인해 주세요.');
        }
        finally {
            if (current(captured) && state.current === s && s.run === run) {
                s.busy = false;
                s.run = null;
                paint(n => n + 1);
            }
        }
    };
    const retry = () => { if (!current(captured) || s.busy)
        return; s.status = 'loading'; s.error = ''; setRevision(n => n + 1); };
    return { saved: s.saved, draft: s.draft, status: s.status, error: s.error, busy: s.busy, canEdit: (s.status === 'ready' || s.status === 'missing') && !s.busy, setDraft, startEdit, cancel, save, retry };
}
