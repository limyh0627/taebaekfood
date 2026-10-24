import { useEffect, useReducer, useRef } from 'react';
import { auth } from '../../../shared/firebase';
import type { CompanyId } from '../../../shared/types';
export type HaccpRecordOwner = object;
export type HaccpRecordRead = 'records' | 'template';
export type HaccpRecordAction = 'save' | 'confirm' | 'delete';
interface Options {
    companyId: CompanyId;
    currentUserId?: string;
    isAdmin?: boolean;
    canConfirm?: boolean;
    getUid?: () => string | undefined;
}
export function useHaccpRecordEditor<T extends {
    id?: string;
}>(options: Options) {
    const [, paint] = useReducer(value => value + 1, 0);
    const latest = useRef(options);
    latest.current = options;
    const getUid = () => latest.current.getUid ? latest.current.getUid() ?? '' : auth.currentUser?.uid ?? '';
    const make = () => ({ companyId: options.companyId, employee: options.currentUserId ?? '', uid: getUid(),
        alive: true, selected: null as T | null, selection: 0, run: null as object | null,
        error: '', reads: { records: false, template: false }, readErrors: { records: '', template: '' }, readRevision: 0 });
    const ref = useRef<ReturnType<typeof make> | null>(null);
    if (!ref.current || !ref.current.alive || ref.current.companyId !== options.companyId ||
        ref.current.employee !== (options.currentUserId ?? '') || ref.current.uid !== getUid()) {
        if (ref.current)
            ref.current.alive = false;
        ref.current = make();
    }
    const state = ref.current;
    const generation = state.selection;
    const current = () => state.alive && ref.current === state && getUid() === state.uid;
    const isCurrent = (token: HaccpRecordOwner) => token === state && current();
    const notify = () => { if (current())
        paint(); };
    const ready = () => state.reads.records && state.reads.template;
    const canEdit = () => current() && ready() && !state.run && generation === state.selection;
    useEffect(() => {
        state.alive = true;
        let active = true;
        const stop = auth.onAuthStateChanged(user => {
            if (!active || ref.current !== state)
                return;
            if ((user?.uid ?? '') !== state.uid) {
                state.alive = false;
                paint();
            }
        });
        return () => { active = false; state.alive = false; stop(); };
    }, [state]);
    const select = (next: T | null) => {
        if (!canEdit())
            return;
        state.selected = next;
        state.selection++;
        state.error = '';
        notify();
    };
    const edit = (action: T | null | ((previous: T | null) => T | null)) => {
        if (!canEdit())
            return;
        state.selected = typeof action === 'function' ? action(state.selected) : action;
        notify();
    };
    const run = async (kind: HaccpRecordAction, targetId: string | undefined, allowed: () => boolean, work: (isCurrent: () => boolean) => Promise<T | null | void>) => {
        if (!canEdit() || !state.uid)
            return;
        const permission = () => (kind !== 'confirm' || !!latest.current.canConfirm) && (kind !== 'delete' || !!latest.current.isAdmin);
        const authorized = () => current() && generation === state.selection && allowed() && permission();
        const actionAllowed = () => ready() && authorized();
        if (!actionAllowed())
            return;
        // 선택은 처리 중 바꿀 수 없고, ACK는 이 실행이 예약한 선택에만 적용한다.
        if (kind !== 'delete' && state.selected?.id !== targetId)
            return;
        const token = {};
        state.run = token;
        state.error = '';
        notify();
        const owns = () => current() && state.run === token && state.selection === generation;
        const permitted = () => owns() && actionAllowed();
        try {
            const result = await work(permitted);
            if (!owns() || !permission())
                return;
            if (result !== undefined)
                state.selected = result;
        }
        catch (error) {
            if (!owns() || !permission())
                return;
            const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
            const reason = code.includes('permission-denied') ? '현재 계정의 저장 권한을 확인해주세요.' :
                code.includes('unavailable') || code.includes('network') ? '네트워크 연결을 확인해주세요.' : '저장된 기록을 먼저 확인해주세요.';
            state.error = '처리 결과를 확인하지 못했습니다. 입력 내용은 유지했습니다. ' + reason;
        }
        finally {
            if (state.run === token) {
                state.run = null;
                notify();
            }
        }
    };
    return { selected: state.selected, select, edit, run, busy: !!state.run, error: state.error, canEdit,
        ownerToken: state as HaccpRecordOwner, isCurrent, readRevision: state.readRevision,
        readReady: ready(), readError: state.readErrors.records || state.readErrors.template,
        readSuccess: (kind: HaccpRecordRead) => { if (current()) {
            state.reads[kind] = true;
            state.readErrors[kind] = '';
            notify();
        } },
        readFailure: (kind: HaccpRecordRead) => { if (current()) {
            state.reads[kind] = false;
            state.readErrors[kind] = '기록과 점검 항목을 조회하지 못했습니다. 다시 조회해주세요.';
            notify();
        } },
        retryRead: () => { if (current() && !state.run) {
            state.readRevision++;
            state.reads = { records: false, template: false };
            state.readErrors = { records: '', template: '' };
            notify();
        } } };
}
