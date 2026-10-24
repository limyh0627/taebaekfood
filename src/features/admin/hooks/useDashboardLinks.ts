import { useEffect, useRef, useState } from 'react';
import { auth } from '../../../shared/firebase';
import { addItem, deleteItem, fetchWhere, updateItem } from '../../../shared/services/firebaseService';
import { appConfirm, appPrompt } from '../../../shared/components/appDialog';
import type { CompanyId } from '../../../shared/types';
export interface DashboardLink {
    id: string;
    label: string;
    url: string;
    order?: number;
}
const COL = 'dashboardLinks';
export const normalizeUrl = (raw: string): string => {
    const u = raw.trim();
    if (!u)
        return '';
    return /^https?:\/\//i.test(u) ? u : `https://${u}`;
};
export const hostOf = (url: string): string => {
    try {
        return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
    }
    catch {
        return url;
    }
};
export function useDashboardLinks(options: {
    companyId: CompanyId;
    isAdmin: boolean;
}) {
    const [, paint] = useState(0);
    const mounted = useRef(false);
    const make = () => ({ ...options, uid: auth.currentUser?.uid, links: [] as DashboardLink[],
        status: 'loading' as 'loading' | 'ready' | 'error', readError: '', error: '', notice: '',
        editing: false, label: '', url: '', dragOver: false, run: null as object | null, read: 0 });
    const owner = useRef(make());
    if (owner.current.companyId !== options.companyId || owner.current.uid !== auth.currentUser?.uid || owner.current.isAdmin !== options.isAdmin)
        owner.current = make();
    const state = owner.current;
    const current = () => mounted.current && owner.current === state && !!state.uid && auth.currentUser?.uid === state.uid;
    const notify = () => { if (current())
        paint(value => value + 1); };
    const editable = () => current() && state.isAdmin && !state.run && state.status === 'ready';
    const reload = async () => {
        if (!current())
            return;
        const read = ++state.read;
        state.status = 'loading';
        state.readError = '';
        notify();
        try {
            const rows = await fetchWhere<DashboardLink>(COL, 'companyId', state.companyId);
            if (!current() || state.read !== read)
                return;
            state.links = [...rows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label, 'ko'));
            state.status = 'ready';
        }
        catch {
            if (!current() || state.read !== read)
                return;
            state.status = 'error';
            state.readError = '바로가기 목록을 읽지 못했습니다. 다시 조회해 주세요.';
        }
        notify();
    };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(() => { void reload(); }, [state]);
    useEffect(() => {
        let first = true;
        return auth.onAuthStateChanged(user => {
            // 최초 알림은 현재 세션의 확인이며, 이후 알림은 같은 UID라도 이전 작업의 소유권을 끝낸다.
            if (first && user?.uid === owner.current.uid) {
                first = false;
                return;
            }
            first = false;
            owner.current = make();
            if (mounted.current)
                paint(value => value + 1);
        });
    }, []);
    const setLabel = (value: string) => { if (editable()) {
        state.label = value;
        state.error = '';
        notify();
    } };
    const setUrl = (value: string) => { if (editable()) {
        state.url = value;
        state.error = '';
        notify();
    } };
    const setEditing = (value: boolean) => { if (editable()) {
        state.editing = value;
        notify();
    } };
    const setDragOver = (value: boolean) => { if (editable()) {
        state.dragOver = value;
        notify();
    } };
    const execute = async (task: (isCurrent: () => boolean) => Promise<boolean | void>, clearDraft = false) => {
        if (!editable())
            return;
        const run = {};
        state.run = run;
        state.error = '';
        state.notice = '';
        notify();
        const owns = () => current() && state.run === run;
        let sent = false;
        try {
            const wrote = await task(() => owns() && state.isAdmin);
            if (!owns() || wrote === false)
                return;
            sent = true;
            if (clearDraft) {
                state.label = '';
                state.url = '';
            }
            state.notice = '바로가기 변경을 저장했습니다.';
            await reload();
        }
        catch (error) {
            if (owns())
                state.error = sent
                    ? '변경은 저장했지만 목록을 다시 읽지 못했습니다. 목록만 다시 조회해 주세요.'
                    : `바로가기 변경 결과를 확인하지 못했습니다. 목록을 다시 조회한 뒤 확인해 주세요. ${error instanceof Error ? error.message : String(error)}`;
        }
        finally {
            if (owns()) {
                state.run = null;
                notify();
            }
        }
    };
    const add = () => {
        if (!editable())
            return;
        const u = normalizeUrl(state.url);
        if (!u) {
            state.error = '주소를 입력하세요.';
            notify();
            return;
        }
        const payload = { label: state.label.trim() || hostOf(u), url: u, order: state.links.length };
        return execute(async (isCurrent) => { if (!isCurrent())
            return false; await addItem(COL, payload); }, true);
    };
    const addFromDrop = (dt: DataTransfer) => {
        if (!editable())
            return;
        state.dragOver = false;
        const raw = (dt.getData('text/uri-list') || dt.getData('text/plain') || '')
            .split(/\r?\n/).map(v => v.trim()).find(v => v && !v.startsWith('#')) ?? '';
        const u = normalizeUrl(raw);
        if (!u || !/^https?:\/\/[^\s]+\./i.test(u)) {
            state.error = '주소를 못 읽었습니다. 링크나 주소창을 끌어다 놓아 주세요.';
            notify();
            return;
        }
        let name = '';
        const html = dt.getData('text/html');
        if (html) {
            const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            if (text && !/^https?:\/\//i.test(text))
                name = text.slice(0, 30);
        }
        if (state.links.some(l => normalizeUrl(l.url) === u)) {
            state.error = '이미 담긴 주소입니다.';
            notify();
            return;
        }
        const payload = { label: name || hostOf(u), url: u, order: state.links.length };
        return execute(async (isCurrent) => { if (!isCurrent())
            return false; await addItem(COL, payload); });
    };
    const sameTarget = (link: DashboardLink) => state.links.some(row => row.id === link.id && row.label === link.label && row.url === link.url);
    const rename = (link: DashboardLink) => execute(async (isCurrent) => {
        const next = (await appPrompt('바로가기 이름', link.label))?.trim();
        if (next == null || next === link.label)
            return false;
        if (!isCurrent() || !sameTarget(link))
            return false;
        await updateItem(COL, link.id, { label: next || hostOf(link.url) });
    });
    const remove = (link: DashboardLink) => execute(async (isCurrent) => {
        if (!await appConfirm(`'${link.label}' 바로가기를 지울까요?`))
            return false;
        if (!isCurrent() || !sameTarget(link))
            return false;
        await deleteItem(COL, link.id);
    });
    return { ...state, busy: !!state.run, canEdit: editable(), reload, add, addFromDrop, rename, remove, setLabel, setUrl, setEditing, setDragOver };
}
