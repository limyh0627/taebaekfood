import { useEffect, useRef, useState } from 'react';
import { auth } from '../../../shared/firebase';
import { OrderStatus, type CompanyId, type Order } from '../../../shared/types';
import { queryDateKey } from '../domain/deliveryQueryDate';
import { prepareDeliverySchedule, applyDeliverySchedule, inspectDeliverySchedule, cancelDeliverySchedule, readDeliverySchedule, type DeliveryScheduleRequest } from '../../../shared/services/deliveryScheduleService';
export interface DeliveryScheduleEditorOptions {
    companyId: CompanyId;
    requestScopeKey?: string;
    currentUserName?: string;
    timeSlots: Record<string, '오전' | '오후'>;
    onApplied: (request: DeliveryScheduleRequest) => void;
}
type Pending = {
    request: DeliveryScheduleRequest;
    order: Order;
    terminal?: 'applied' | 'cancelled';
};
type Editor = {
    order: Order | null;
    date: string;
    slot: '오전' | '오후';
    originalSlot: '오전' | '오후';
    confirmation: 'discard' | 'save-shipped' | null;
    error: string;
    busy: boolean;
    pending: Pending | null;
    selection: object;
    run: object | null;
};
const empty = (): Editor => ({ order: null, date: '', slot: '오전', originalSlot: '오전', confirmation: null, error: '', busy: false, pending: null, selection: {}, run: null });
/** 원요청은 메모리에 보관하고 화면 세대와 분리해 늦은 결과가 새 편집을 종결하지 못하게 한다. */
export function useDeliveryScheduleEditor(options: DeliveryScheduleEditorOptions) {
    const [, paint] = useState(0), latest = useRef(options);
    latest.current = options;
    const owner = useRef({ companyId: options.companyId, scope: options.requestScopeKey, uid: auth.currentUser?.uid ?? '' });
    const reset = () => { owner.current = { companyId: latest.current.companyId, scope: latest.current.requestScopeKey, uid: auth.currentUser?.uid ?? '' }; };
    if (owner.current.companyId !== options.companyId || owner.current.scope !== options.requestScopeKey || owner.current.uid !== (auth.currentUser?.uid ?? ''))
        reset();
    const state = useRef({ owner: owner.current, editor: empty() });
    if (state.current.owner !== owner.current)
        state.current = { owner: owner.current, editor: empty() };
    const pending = useRef(new Map<string, Pending>()), mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        const stop = auth.onAuthStateChanged(user => {
            if ((user?.uid ?? '') !== owner.current.uid) {
                reset();
                paint(n => n + 1);
            }
        });
        return () => { mounted.current = false; stop(); };
    }, []);
    const captured = owner.current, s = state.current.editor;
    const current = () => mounted.current && owner.current === captured && state.current.editor === s && (auth.currentUser?.uid ?? '') === captured.uid;
    const key = (id: string) => JSON.stringify([captured.companyId, captured.uid, id]);
    const dirty = !!s.order && (s.date !== queryDateKey(s.order.deliveryDate) || s.slot !== s.originalSlot);
    const open = (order: Order) => {
        if (!current() || s.busy)
            return;
        const retained = pending.current.get(key(order.id)) ?? null;
        state.current.editor = { ...empty(), order: structuredClone(order), pending: retained, date: retained ? queryDateKey(retained.request.nextDeliveryDate) : queryDateKey(order.deliveryDate), slot: retained?.request.nextTimeSlot ?? latest.current.timeSlots[order.id] ?? '오전', originalSlot: latest.current.timeSlots[order.id] ?? '오전', error: retained ? (retained.terminal ? '이전 요청의 처리를 확인했습니다. 현재 일정을 다시 읽은 뒤 편집해 주세요.' : '지난 일정 변경의 처리 결과를 확인해 주세요. 새로고침하거나 화면을 나가면 이 안내를 다시 찾지 못할 수 있습니다.') : '' };
        paint(n => n + 1);
    };
    const setDate = (value: string) => {
        if (!current() || s.busy || s.pending)
            return;
        s.date = value;
        s.error = '';
        paint(n => n + 1);
    };
    const setTimeSlot = (value: '오전' | '오후') => {
        if (!current() || s.busy || s.pending)
            return;
        s.slot = value;
        s.error = '';
        paint(n => n + 1);
    };
    const close = () => {
        if (!current() || s.busy)
            return;
        state.current.editor = empty();
        paint(n => n + 1);
    };
    const requestClose = () => {
        if (!current() || s.busy)
            return;
        if (dirty && !s.pending) {
            s.confirmation = 'discard';
            paint(n => n + 1);
        }
        else
            close();
    };
    const setConfirmation = (value: Editor['confirmation']) => {
        if (!current() || s.busy)
            return;
        s.confirmation = value;
        paint(n => n + 1);
    };
    const execute = async (mode: 'apply' | 'inspect' | 'cancel') => {
        if (!current() || s.busy || !s.order || s.pending?.terminal)
            return;
        if (mode === 'apply' && !s.pending && (!dirty || !s.date))
            return;
        const selection = s.selection, run = {};
        s.busy = true;
        s.run = run;
        s.error = '';
        paint(n => n + 1);
        const valid = () => current() && s.selection === selection && s.run === run;
        try {
            if (!s.pending) {
                const request = prepareDeliverySchedule({ companyId: captured.companyId, actorUid: captured.uid, auditId: 'delivery-schedule-' + crypto.randomUUID(), orderId: s.order.id, previousDeliveryDate: s.order.deliveryDate, previousStatus: s.order.status, previousTimeSlot: s.originalSlot, nextDeliveryDate: new Date(s.date + 'T00:00:00+09:00').toISOString(), nextTimeSlot: s.slot, changedBy: latest.current.currentUserName || '미기록', changedAt: new Date().toISOString() });
                s.pending = { request, order: structuredClone(s.order) };
                pending.current.set(key(s.order.id), s.pending);
            }
            const request = s.pending.request;
            const result = mode === 'apply' ? await applyDeliverySchedule({ companyId: captured.companyId, isCurrent: valid }, request) : mode === 'inspect' ? await inspectDeliverySchedule({ companyId: captured.companyId, isCurrent: valid }, request) : await cancelDeliverySchedule({ companyId: captured.companyId, isCurrent: valid }, request);
            if (!valid())
                return;
            if (result.status === 'applied' || result.status === 'cancelled') {
                s.pending!.terminal = result.status;
                if (result.status === 'applied')
                    latest.current.onApplied(request);
                state.current.editor = empty();
                paint(n => n + 1);
            }
            else
                s.error = '처리 기록을 찾지 못했지만 저장되지 않았다고 확정할 수 없습니다. 같은 내용으로 다시 시도하거나 결과를 다시 확인해 주세요.';
        }
        catch (error) {
            if (valid())
                s.error = (s.pending ? '출고 일정의 처리 결과를 확인하지 못했습니다. 작성 내용과 같은 요청을 보관했습니다. ' : '저장 요청을 준비하지 못했습니다. 작성 내용은 유지했습니다. ') + (error instanceof Error ? error.message : '다시 확인해 주세요.');
        }
        finally {
            if (current() && s.run === run) {
                s.busy = false;
                s.run = null;
                s.confirmation = null;
                paint(n => n + 1);
            }
        }
    };
    const readCurrent = async () => {
        if (!current() || s.busy || !s.order || !s.pending?.terminal)
            return;
        const run = {};
        s.run = run;
        s.busy = true;
        s.error = '';
        paint(n => n + 1);
        const valid = () => current() && s.run === run;
        try {
            const value = await readDeliverySchedule({ companyId: captured.companyId, isCurrent: valid }, s.order.id);
            if (!valid())
                return;
            pending.current.delete(key(s.order.id));
            s.order = { ...s.order, deliveryDate: value.deliveryDate, status: value.status as OrderStatus };
            s.date = queryDateKey(value.deliveryDate);
            s.slot = value.timeSlot;
            s.originalSlot = value.timeSlot;
            s.pending = null;
        }
        catch (error) {
            if (valid())
                s.error = '현재 일정을 다시 읽지 못했습니다. ' + (error instanceof Error ? error.message : '다시 확인해 주세요.');
        }
        finally {
            if (valid()) {
                s.busy = false;
                s.run = null;
                paint(n => n + 1);
            }
        }
    };
    const requestSave = () => {
        if (!current() || s.busy || s.pending || !dirty || !s.date)
            return;
        if (s.order?.status === OrderStatus.SHIPPED) {
            s.confirmation = 'save-shipped';
            paint(n => n + 1);
        }
        else
            void execute('apply');
    };
    const unresolved = [...pending.current.values()].filter(entry => !entry.terminal && entry.request.companyId === captured.companyId && entry.request.actorUid === captured.uid);
    const openUnresolved = () => { if (!current() || s.busy || !unresolved.length) return; open(unresolved[0].order); };
    return { unresolvedCount: unresolved.length, openUnresolved, editingOrder: s.order, newDate: s.date, editingTimeSlot: s.slot, originalTimeSlot: s.originalSlot, originalScheduleDate: s.order ? queryDateKey(s.order.deliveryDate) : '', isScheduleDirty: dirty, scheduleConfirmation: s.confirmation, scheduleSaveError: s.error, isSavingSchedule: s.busy, hasPending: !!s.pending && !s.pending.terminal, requiresRefresh: !!s.pending?.terminal, readCurrent, handleOrderClick: open, setNewDate: setDate, setEditingTimeSlot: setTimeSlot, closeScheduleEditor: close, requestCloseScheduleEditor: requestClose, setScheduleConfirmation: setConfirmation, requestSaveDate: requestSave, persistScheduleChange: () => execute('apply'), inspect: () => execute('inspect'), cancelPending: () => execute('cancel') };
}
