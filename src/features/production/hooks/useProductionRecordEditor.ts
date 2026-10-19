import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../../shared/firebase';
import type { Item, Order, ProductionRecord } from '../../../shared/types';
import { appConfirm } from '../../../shared/components/appDialog';
import { buildProductionRecord, planProductionRecordSync, addProductionRecord, updateProductionRecordDate, deleteProductionRecord, runProductionRecordSync, type ProductionRecordForm, } from '../application/productionRecordEditor';
type Ports = Parameters<typeof addProductionRecord>[1];
export interface ProductionRecordEditorOptions extends Ports {
    companyId?: string;
    actorUid?: string;
    currentUserName?: string;
    items: Item[];
    orders: Order[];
    records: ProductionRecord[];
}
const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const emptyForm = (): ProductionRecordForm => ({ date: today(), itemId: '', finishedQty: '', wipItemId: '', wipUsed: '', note: '' });
function newState(owner: string) {
    return { owner, form: emptyForm(), showForm: false, editingDateId: null as string | null,
        editingDateVal: '', busy: false, syncing: false, error: '', message: '',
        unconfirmedRecords: [] as ProductionRecord[], token: 0, identity: null as null | {
            id: string;
            createdAt: string;
        }, uncertain: false,
        excludedIds: new Set<string>(), uncertainSyncIds: new Set<string>() };
}
export function useProductionRecordEditor(options: ProductionRecordEditorOptions) {
    const [, repaint] = useState(0);
    const [liveUid, setLiveUid] = useState(() => auth.currentUser?.uid ?? '');
    useEffect(() => onAuthStateChanged(auth, user => setLiveUid(user?.uid ?? '')), []);
    const owner = JSON.stringify([options.companyId ?? '', options.actorUid ?? liveUid, liveUid]);
    const exclusions = useRef(new Map<string, Set<string>>());
    const uncertainSync = useRef(new Map<string, Set<string>>());
    const unconfirmed = useRef(new Map<string, ProductionRecord[]>());
    const createState = () => {
        const next = newState(owner);
        const key = JSON.stringify([options.companyId ?? '', options.actorUid ?? liveUid]);
        if (!exclusions.current.has(key))
            exclusions.current.set(key, new Set());
        next.excludedIds = exclusions.current.get(key)!;
        if (!uncertainSync.current.has(key))
            uncertainSync.current.set(key, new Set());
        next.uncertainSyncIds = uncertainSync.current.get(key)!;
        if (!unconfirmed.current.has(key))
            unconfirmed.current.set(key, []);
        next.unconfirmedRecords = unconfirmed.current.get(key)!;
        return next;
    };
    const stateRef = useRef(createState());
    if (stateRef.current.owner !== owner)
        stateRef.current = createState();
    const state = stateRef.current;
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const current = () => mounted.current && stateRef.current === state && !!options.companyId &&
        !!liveUid && liveUid === auth.currentUser?.uid && (!options.actorUid || options.actorUid === liveUid);
    const update = () => {
        if (mounted.current && stateRef.current === state)
            repaint(value => value + 1);
    };
    const available = () => current() && !state.busy;
    const begin = () => {
        if (!available())
            return false;
        state.busy = true;
        state.error = '';
        state.message = '';
        update();
        return true;
    };
    const pendingNotice = () => [
        state.unconfirmedRecords.length ? `이전 수동 생산기록 ${state.unconfirmedRecords.length}건의 처리 결과는 아직 확인하지 못했습니다.` : '',
        state.uncertainSyncIds.size ? `이전 동기화 ${state.uncertainSyncIds.size}건의 처리 결과는 아직 확인하지 못했습니다.` : '',
    ].filter(Boolean).join(' ') + (state.unconfirmedRecords.length || state.uncertainSyncIds.size ? ' 현재 목록을 확인해 주세요. 미확정 요청은 다시 보내지 않았습니다.' : '');
    const finish = () => {
        if (stateRef.current === state) {
            state.busy = false;
            state.syncing = false;
            if (!state.error)
                state.error = pendingNotice();
            update();
        }
    };
    const openCreate = () => {
        if (!available())
            return;
        state.token++;
        state.form = emptyForm();
        state.identity = { id: `pr-${crypto.randomUUID()}`, createdAt: new Date().toISOString() };
        state.uncertain = false;
        state.showForm = true;
        state.error = pendingNotice();
        state.message = '';
        update();
    };
    const closeForm = () => {
        if (!available())
            return;
        state.showForm = false;
        state.token++;
        update();
    };
    const setField = (field: keyof ProductionRecordForm, value: string) => {
        if (!available() || state.uncertain)
            return;
        state.form = { ...state.form, [field]: value };
        state.token++;
        update();
    };
    const submit = async () => {
        if (!available() || state.uncertain)
            return;
        if (!state.form.itemId || !state.form.finishedQty) {
            state.error = '품목과 생산수량을 입력해주세요.';
            update();
            return;
        }
        if (!begin())
            return;
        const token = state.token;
        state.identity ??= { id: `pr-${crypto.randomUUID()}`, createdAt: new Date().toISOString() };
        try {
            const record = buildProductionRecord(state.form, options.items, { ...state.identity, currentUserName: options.currentUserName });
            const result = await addProductionRecord(record, options, { isCurrent: current });
            if (result.status === 'unknown') {
                state.excludedIds.add(record.id);
                state.unconfirmedRecords.push(record);
            }
            if (!current() || token !== state.token)
                return;
            if (result.status === 'saved' && result.acknowledged) {
                state.form = emptyForm();
                state.showForm = false;
                state.identity = null;
                state.message = result.message;
            }
            else {
                state.error = result.message;
                if (result.status === 'unknown') {
                    state.uncertain = true;
                }
            }
        }
        catch (error) {
            if (current()) {
                state.uncertain = true;
                state.error = `생산기록 처리 결과를 확인하지 못했습니다. 목록을 확인하고 같은 기록을 다시 보내지 마세요. ${String(error)}`;
            }
        }
        finally {
            finish();
        }
    };
    const openDate = (record: ProductionRecord) => {
        if (!available())
            return;
        state.editingDateId = record.id;
        state.editingDateVal = record.date;
        state.token++;
        state.error = state.excludedIds.has(`date:${record.id}`) ? '이 기록의 이전 날짜 변경 결과를 확인하지 못했습니다. 현재 목록을 확인해 주세요. 같은 변경은 다시 보내지 않습니다.' : '';
        update();
    };
    const changeDate = (value: string) => {
        if (!available())
            return;
        state.editingDateVal = value;
        state.token++;
        update();
    };
    const cancelDate = () => {
        if (!available())
            return;
        state.editingDateId = null;
        state.token++;
        update();
    };
    const saveDate = async () => {
        if (!state.editingDateId || !state.editingDateVal || state.excludedIds.has(`date:${state.editingDateId}`) || !begin())
            return;
        const id = state.editingDateId, date = state.editingDateVal, token = state.token;
        try {
            const result = await updateProductionRecordDate(id, date, options, { isCurrent: current });
            if (result.status === 'unknown')
                state.excludedIds.add(`date:${id}`);
            if (!current() || token !== state.token)
                return;
            if (result.status === 'saved' && result.acknowledged) {
                state.editingDateId = null;
                state.message = result.message;
            }
            else {
                state.error = result.message;
            }
        }
        finally {
            finish();
        }
    };
    const removeRecord = async (record: ProductionRecord) => {
        if (state.excludedIds.has(`delete:${record.id}`) || !begin())
            return;
        try {
            if (!await appConfirm('이 생산기록을 삭제하시겠습니까?') || !current())
                return;
            const result = await deleteProductionRecord(record.id, options, { isCurrent: current });
            if (result.status === 'unknown')
                state.excludedIds.add(`delete:${record.id}`);
            if (!current())
                return;
            if (result.status === 'saved' && result.acknowledged)
                state.message = result.message;
            else {
                state.error = result.message;
            }
        }
        finally {
            finish();
        }
    };
    const syncFromOrders = async () => {
        if (!begin())
            return;
        state.syncing = true;
        update();
        try {
            const plan = planProductionRecordSync({ orders: options.orders, items: options.items, records: options.records, excludedIds: state.excludedIds });
            const result = await runProductionRecordSync(plan, options, { isCurrent: current });
            result.confirmedIds.forEach(id => state.excludedIds.add(id));
            if (result.failedId) {
                state.excludedIds.add(result.failedId);
                state.uncertainSyncIds.add(result.failedId);
            }
            if (!current())
                return;
            if (result.status === 'saved') {
                state.message = result.message;
                if (state.uncertainSyncIds.size)
                    state.error = `이전 동기화 ${state.uncertainSyncIds.size}건의 처리 결과는 아직 확인하지 못했습니다. 현재 목록을 확인해 주세요. 해당 기록은 다시 보내지 않았습니다.`;
            }
            else
                state.error = result.message;
        }
        finally {
            finish();
        }
    };
    const visible = current();
    return { form: visible ? state.form : emptyForm(), setField, showForm: visible && state.showForm, openCreate, closeForm, submit,
        unconfirmedRecords: visible ? state.unconfirmedRecords : [], busy: visible && state.busy, locked: visible && state.uncertain, error: visible ? state.error : '', message: visible ? state.message : '',
        editingDateId: visible ? state.editingDateId : null, editingDateVal: visible ? state.editingDateVal : '', openDate, changeDate, saveDate, cancelDate,
        canSaveDate: available() && !!state.editingDateId && !state.excludedIds.has(`date:${state.editingDateId}`),
        canRemoveRecord: (record: ProductionRecord) => available() && !state.excludedIds.has(`delete:${record.id}`),
        removeRecord, syncing: visible && state.syncing, syncFromOrders };
}
