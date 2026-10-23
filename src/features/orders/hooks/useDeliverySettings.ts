import { useEffect, useRef, useState } from 'react';
import { auth } from '../../../shared/firebase';
import type { CompanyId } from '../../../shared/types';
import { prepareDeliverySettings, subscribeDeliverySettings, readDeliverySettings, applyDeliverySettings, inspectDeliverySettings, cancelDeliverySettings, type DeliverySettingsRequest, type DeliverySettingsSnapshot, type DeliverySettingsChange } from '../../../shared/services/deliverySettingsService';
type Retained = {
    request: DeliverySettingsRequest;
    terminal?: 'applied' | 'cancelled';
    afterApplied?: () => void;
};
type View = {
    status: 'loading' | 'ready' | 'error';
    snapshot: DeliverySettingsSnapshot;
    error: string;
    readError: string;
    busy: boolean;
    run: object | null;
};
const empty = (): View => ({ status: 'loading', snapshot: { exists: false }, error: '', readError: '', busy: false, run: null });
/** 미확인 원문은 화면 세대와 분리해 회사 왕복 뒤에도 같은 마운트에서 다시 확인한다. */
export function useDeliverySettings(options: {
    companyId: CompanyId;
    requestScopeKey?: string;
    currentUserName?: string;
}) {
    const [, paint] = useState(0), mounted = useRef(false), retained = useRef(new Map<string, Retained>());
    const owner = useRef({ companyId: options.companyId, uid: auth.currentUser?.uid ?? '', scope: options.requestScopeKey, view: empty() });
    const uid = auth.currentUser?.uid ?? '';
    if (owner.current.companyId !== options.companyId || owner.current.uid !== uid || owner.current.scope !== options.requestScopeKey)
        owner.current = { companyId: options.companyId, uid, scope: options.requestScopeKey, view: empty() };
    const captured = owner.current, v = captured.view, key = JSON.stringify([captured.companyId, captured.uid]);
    const current = () => mounted.current && owner.current === captured && (auth.currentUser?.uid ?? '') === captured.uid;
    const notify = () => { if (current())
        paint(n => n + 1); };
    const scope = { companyId: captured.companyId, actorUid: captured.uid, isCurrent: current };
    const pending = retained.current.get(key);
    useEffect(() => {
        mounted.current = true;
        let active = true;
        let initial = true;
        const stopAuth = auth.onAuthStateChanged(() => { if (!active || !mounted.current)
            return; const nextUid = auth.currentUser?.uid ?? ''; if (initial && owner.current.uid === nextUid) {
            initial = false;
            return;
        } initial = false; {
            owner.current = { companyId: owner.current.companyId, uid: auth.currentUser?.uid ?? '', scope: owner.current.scope, view: empty() };
            paint(n => n + 1);
        } });
        return () => { active = false; mounted.current = false; stopAuth(); };
    }, []);
    const [readEpoch, setReadEpoch] = useState(0);
    useEffect(() => {
        let active = true;
        v.status = 'loading';
        v.readError = '';
        notify();
        const stop = subscribeDeliverySettings(scope, snapshot => { if (!active || !current())
            return; v.readError = ''; v.snapshot = snapshot; v.status = 'ready'; notify(); }, error => { if (!active || !current())
            return; v.status = 'error'; v.readError = error.message; notify(); });
        return () => { active = false; stop(); };
    }, [captured, readEpoch]);
    const refresh = async () => { if (!current())
        return false; v.status = 'loading'; notify(); try {
        const snapshot = await readDeliverySettings(scope);
        if (!current())
            return false;
        v.snapshot = snapshot;
        v.status = 'ready';
        v.readError = '';
        if(!retained.current.has(key)) v.error = '';
        notify();
        return true;
    }
    catch (error) {
        if (current()) {
            v.status = 'error';
            v.readError = error instanceof Error ? error.message : String(error);
            notify();
        }
        return false;
    } };
    const canMutate = () => current() && !!captured.uid && v.status === 'ready' && !v.busy && !retained.current.has(key);
    const execute = async (mode: 'apply' | 'inspect' | 'cancel' | 'read', record: Retained) => {
        if (!current() || v.busy || retained.current.get(key) !== record || (mode === 'read' && !record.terminal))
            return false;
        const run = {};
        v.busy = true;
        v.run = run;
        v.error = '';
        notify();
        try {
            if (!current())
                return false;
            if (mode !== 'read') {
                const result = await (mode === 'apply' ? applyDeliverySettings(scope, record.request) : mode === 'inspect' ? inspectDeliverySettings(scope, record.request) : cancelDeliverySettings(scope, record.request));
                if (retained.current.get(key) !== record)
                    return false;
                if (result.status === 'not-found') {
                    if (current())
                        v.error = '기록을 찾지 못했습니다. 미처리로 확정된 것은 아닙니다. 같은 요청을 다시 시도하거나 미처리 요청을 중단해 주세요.';
                    return false;
                }
                record.terminal = result.status;
            }
            if (!current())
                return false;
            if (!await refresh())
                return false;
            if (retained.current.get(key) !== record)
                return false;
            retained.current.delete(key);
            v.error = "";
            if (record.terminal === 'applied')
                record.afterApplied?.();
            return true;
        }
        catch (error) {
            if (current())
                v.error = error instanceof Error ? error.message : String(error);
            return false;
        }
        finally {
            if (v.run === run) {
                v.run = null;
                v.busy = false;
                notify();
            }
        }
    };
    const save = (change: DeliverySettingsChange, afterApplied?: () => void) => {
        if (!canMutate())
            return Promise.resolve(false);
        let request: DeliverySettingsRequest;
        try {
            request = prepareDeliverySettings(scope, v.snapshot, change, { auditId: 'delivery-settings-' + crypto.randomUUID(), changedAt: new Date().toISOString(), changedBy: options.currentUserName ?? '' });
        }
        catch (error) {
            v.error = error instanceof Error ? error.message : String(error);
            notify();
            return Promise.resolve(false);
        }
        const record = { request, afterApplied: afterApplied ? () => { if (current())
                afterApplied(); } : undefined };
        retained.current.set(key, record);
        return execute('apply', record);
    };
    const recover = (mode: 'apply' | 'inspect' | 'cancel' | 'read') => { const record = retained.current.get(key); return record ? execute(mode, record) : Promise.resolve(false); };
    return { scopeKey: captured, snapshot: v.snapshot, status: v.status, error: v.error || v.readError, busy: v.busy, pending: !!pending, terminal: pending?.terminal, locked: !captured.uid || v.busy || !!pending || v.status !== 'ready', canMutate, save, recover, retryRead: () => { if (current() && !v.busy)
            setReadEpoch(n => n + 1); }, refresh };
}
