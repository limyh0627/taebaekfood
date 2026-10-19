import { useEffect, useReducer, useRef } from 'react';
import { auth } from '../../../shared/firebase';
import { OrderStatus, type Order, type Item, type Partner } from '../../../shared/types';
import { lineKeyAt, lineSuffix } from '../../../shared/orderLine';
import { itemIndexOf } from '../../../shared/workItemLine';
import { clusterByGroup } from '../../../shared/rowGroup';
import { appConfirm, appPrompt } from '../../../shared/components/appDialog';
import { decodeWorkOrderOpening, normalizeWorkOrderRequest, workOrderExpected, type WorkOrderOpening, type WorkOrderRequest, type WorkOrderResult, type WorkOrderReference } from '../../../shared/workOrderCommand';
import { workOrderWrites, workOrderKey, readWorkOrderNotice, hasUnsentWorkOrderNotice, type WorkOrderBindings, type WorkOrderEntry, type WorkOrderObservation } from '../../../shared/services/workOrderWrites';
import { resetDailyWorkOrder } from '../../../shared/services/workOrderResetService';
import { saveOutcomeMessage } from '../../../shared/saveOutcome';
export interface WorkItem {
    id?: string;
    sortIndex?: number;
    key: string;
    orderId: string;
    itemId: string;
    lineKey?: string;
    itemName: string;
    partnerName: string;
    qty: number;
    category: string;
    workGroup?: string | null;
    groupId?: string | null;
    groupName?: string | null;
}
export interface WorkOrderEditorOptions {
    companyId: WorkOrderReference['companyId'];
    actorUid: string;
    enabled?: boolean;
    workOrderItems: WorkItem[];
    items: Item[];
    partners: Partner[];
    orders: Order[];
    pickableOrders: Order[];
    bindings?: WorkOrderBindings;
}
export interface WorkOrderRecoveryRow {
    entry: WorkOrderEntry;
    currentState: string;
    cause: string;
    nextAction: string;
}
type Change<T> = T | ((previous: T) => T);
const defaults = ['기름', '깨', '미분류'];
const clone = <T,>(value: T): T => structuredClone(value);
export function useWorkOrderEditor(options: WorkOrderEditorOptions) {
    const [, render] = useReducer((value: number) => value + 1, 0), mounted = useRef(true), latest = useRef(options);
    latest.current = options;
    const create = () => ({
        companyId: options.companyId, actorUid: options.actorUid, enabled: options.enabled !== false, items: clone(options.workOrderItems), groups: [...defaults], liveGroups: null as string[] | null, groupGeneration: 0, opening: null as WorkOrderOpening | null, openingBusy: false, task: null as object | null, token: {}, pending: null as null | {
            entry: WorkOrderEntry;
            token: object;
        }, locked: false, showPicker: false, pickerGroups: [] as string[], pickerOrdering: [] as string[], pickerAssign: {} as Record<string, string>, pickerGroup: '', groupEditing: false, newGroupName: '', workSort: null as string | null, groupPick: [] as string[], dragging: null as string | null, showCompleted: false, error: '', resetNotice: '', message: '', operations: [] as WorkOrderEntry[], results: new Map<string, WorkOrderObservation>(), readLoading: false, readError: '', readGeneration: 0, history: [] as {
            result: WorkOrderResult;
            action: string;
            createdAt: string;
        }[], historyMore: null as string | null, historyLoading: false, historyError: '', historyGeneration: 0
    });
    const owner = useRef<ReturnType<typeof create> | null>(null);
    if (!owner.current || owner.current.companyId !== options.companyId || owner.current.actorUid !== options.actorUid || owner.current.enabled !== (options.enabled !== false))
        owner.current = create();
    const state = owner.current;
    const current = () => mounted.current && owner.current === state && state.enabled && !!state.actorUid && auth.currentUser?.uid === state.actorUid;
    const repaint = () => {
        if (mounted.current)
            render();
    };
    const scope = () => ({
        companyId: state.companyId, actorUid: state.actorUid
    });
    const ports = () => latest.current.bindings ?? workOrderWrites;
    const change = <K extends keyof typeof state>(key: K, value: Change<(typeof state)[K]>) => {
        if (!current() || state.task || state.locked)
            return;
        state[key] = typeof value === 'function' ? (value as (old: (typeof state)[K]) => (typeof state)[K])(state[key]) : value;
        repaint();
    };
    const begin = () => {
        if (!current() || state.task || state.openingBusy)
            return null;
        const task = {};
        state.task = task;
        state.error = '';
        repaint();
        return task;
    };
    async function read() {
        if (!current())
            return;
        const generation = ++state.readGeneration;
        state.readLoading = true;
        repaint();
        try {
            const entries = await ports().read(scope(), () => current() && generation === state.readGeneration);
            if (current() && generation === state.readGeneration) {
                state.operations = entries;
                state.readError = '';
                state.resetNotice = readWorkOrderNotice(scope());
            }
        }
        catch (error) {
            if (current() && generation === state.readGeneration)
                state.readError = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (current() && generation === state.readGeneration) {
                state.readLoading = false;
                repaint();
            }
        }
    }
    async function capture(resetDraft: boolean) {
        if (!current() || state.openingBusy)
            return null;
        const token = state.token, groupGeneration = state.groupGeneration;
        state.openingBusy = true;
        repaint();
        try {
            const reference = {
                companyId: state.companyId, planId: crypto.randomUUID()
            };
            const opening = await ports().open(scope(), reference, () => current() && state.token === token);
            if (!current() || state.token !== token)
                return null;
            state.opening = opening;
            const decoded = decodeWorkOrderOpening(opening);
            state.items = decoded.items.sort((a, b) => Number((a as Record<string, unknown>).sortIndex ?? 0) - Number((b as Record<string, unknown>).sortIndex ?? 0)) as unknown as WorkItem[];
            state.groups = state.groupGeneration !== groupGeneration && state.liveGroups ? [...state.liveGroups] : Array.isArray(decoded.groups?.names) && decoded.groups!.names.length ? [...decoded.groups!.names] as string[] : [...defaults];
            if (resetDraft) {
                state.pickerOrdering = validItems().map(item => item.key);
                state.pickerAssign = Object.fromEntries(validItems().map(item => [item.key, categoryOf(item)]));
                state.pickerGroups = [...state.groups];
                state.pickerGroup = '';
            }
            state.error = '';
            return opening;
        }
        catch (error) {
            if (current() && state.token === token)
                state.error = error instanceof Error ? error.message : String(error);
            return null;
        }
        finally {
            if (current() && state.token === token) {
                state.openingBusy = false;
                repaint();
            }
        }
    }
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        if (current()) {
            void read();
            void capture(false);
        }
        const changed = () => {
            if (current())
                void read();
        };
        window.addEventListener('storage', changed);
        window.addEventListener('work-order-requests', changed);
        return () => {
            state.readGeneration++;
            state.historyGeneration++;
            window.removeEventListener('storage', changed);
            window.removeEventListener('work-order-requests', changed);
        };
    }, [state]);
    useEffect(() => {
        if (!current())
            return;
        return ports().subscribeGroups(scope(), names => {
            if (!current())
                return;
            if (JSON.stringify(state.liveGroups) === JSON.stringify(names))
                return;
            state.liveGroups = [...names];
            state.groupGeneration++;
            if (!state.showPicker && !state.pending && !state.task && !state.locked)
                state.groups = [...names];
            repaint();
        }, current);
    }, [state]);
    useEffect(() => {
        if (current() && state.liveGroups && !state.showPicker && !state.task && !state.pending && !state.locked && JSON.stringify(state.groups) !== JSON.stringify(state.liveGroups)) {
            state.groups = [...state.liveGroups];
            repaint();
        }
    }, [state, state.showPicker, state.task, state.pending, state.locked]);
    const incoming = JSON.stringify(options.workOrderItems);
    useEffect(() => {
        if (current() && !state.task && !state.showPicker && !state.pending && !state.locked)
            void capture(false);
    }, [incoming]);
    function categoryOf(workItem: WorkItem): string {
        const chosen = String(workItem.workGroup ?? '').trim();
        if (chosen)
            return state.groups.includes(chosen) ? chosen : (state.groups[state.groups.length - 1] ?? chosen);
        const product = latest.current.items.find(item => item.id === workItem.itemId), savedCategory = String(product?.category || workItem.category || '').trim();
        const typeValues = new Set(['product', 'goods', 'wip', 'raw', 'submaterial', 'giftset', 'shipping']);
        const category = savedCategory && !typeValues.has(savedCategory) ? savedCategory : '';
        const guessed = /기름/.test(category) ? '기름' : /깨/.test(category) ? '깨' : '미분류';
        return state.groups.includes(guessed) ? guessed : (state.groups[state.groups.length - 1] ?? guessed);
    }
    function allItems(orders: Order[], saved: boolean): WorkItem[] {
        return orders.filter(order => order.status === OrderStatus.PENDING || order.status === OrderStatus.PROCESSING).flatMap(order => {
            const partnerName = order.partnerName || latest.current.partners.find(partner => partner.id === order.partnerId)?.name || '이름없음';
            return order.items.map((item, index) => {
                const previous = saved ? state.items.find(row => row.key === `${order.id}-${lineKeyAt(order.items, index)}`) : undefined;
                return {
                    key: `${order.id}-${lineKeyAt(order.items, index)}`, orderId: order.id, itemId: item.itemId, lineKey: lineKeyAt(order.items, index), itemName: `${item.name}${lineSuffix(order.items, index)}`, partnerName, qty: item.quantity, category: latest.current.items.find(product => product.id === item.itemId)?.category || '미분류', ...(saved ? {
                        workGroup: previous?.workGroup, groupId: previous?.groupId, groupName: previous?.groupName
                    } : {})
                };
            }).filter(item => !saved || latest.current.items.find(product => product.id === item.itemId)?.type !== 'goods');
        });
    }
    function validItems() {
        const keys = new Set(state.items.map(item => item.key)), positions = new Map(state.items.map((item, index) => [item.key, index]));
        return allItems(latest.current.orders, true).filter(item => keys.has(item.key)).sort((a, b) => (positions.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.key) ?? Number.MAX_SAFE_INTEGER));
    }
    const workOrderOf = (item: WorkItem) => latest.current.orders.find(order => order.id === item.orderId);
    const orderItemOf = (item: WorkItem) => {
        const order = workOrderOf(item);
        if (!order)
            return undefined;
        const index = itemIndexOf(item, order);
        return index >= 0 ? order.items[index] : undefined;
    };
    const isComplete = (item: WorkItem) => orderItemOf(item)?.checked === true;
    const isProcessing = (item: WorkItem) => !isComplete(item) && workOrderOf(item)?.status === OrderStatus.PROCESSING;
    const groupOf = (key: string) => {
        const item = validItems().find(item => item.key === key);
        return item?.groupId ? {
            id: item.groupId, name: item.groupName ?? undefined
        } : undefined;
    };
    function sectionItems(category: string) {
        const rows = validItems().filter(item => categoryOf(item) === category), time = (value?: string) => value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
        if (state.workSort === 'dueDate')
            rows.sort((a, b) => Number(isProcessing(b)) - Number(isProcessing(a)) || time(workOrderOf(a)?.deliveryDate) - time(workOrderOf(b)?.deliveryDate) || time(workOrderOf(a)?.createdAt) - time(workOrderOf(b)?.createdAt));
        return clusterByGroup(rows.filter(item => !isComplete(item)), item => item.key, groupOf);
    }
    const completedItems = (category: string) => clusterByGroup(validItems().filter(item => categoryOf(item) === category && isComplete(item)), item => item.key, groupOf);
    const orderedItems = (category: string) => state.showCompleted ? [...sectionItems(category), ...completedItems(category)] : sectionItems(category);
    function consume(entry: WorkOrderEntry, observation: WorkOrderObservation, token: object) {
        if (!current())
            return false;
        state.results.set(entry.reference?.planId ?? entry.key, observation);
        state.message = saveOutcomeMessage(observation.outcome) || observation.result?.message || '작업순서 처리를 확인했습니다.';
        const own = !!state.pending && !!entry.reference && state.pending.entry.reference?.planId === entry.reference.planId && state.pending.token === token && state.token === token;
        if (own && observation.terminal) {
            state.pending = null;
            state.locked = true;
            if (observation.outcome.status === 'saved')
                state.showPicker = false;
        }
        return own && observation.terminal && observation.outcome.status === 'saved';
    }
    async function saveItems(next: WorkItem[], groups?: string[]) {
        if (!current() || state.task || state.locked || state.openingBusy)
            return false;
        const task = begin();
        if (!task)
            return false;
        const token = state.token, active = () => current() && state.task === task;
        try {
            const opening = state.opening;
            if (!opening || !active() || state.token !== token) {
                state.error = '현재 작업순서 원문을 먼저 확인해 주세요.';
                return false;
            }
            const previous = new Map(decodeWorkOrderOpening(opening).items.map(item => [(item as Record<string, unknown>).key, item]));
            const stamp = Date.now();
            const request = normalizeWorkOrderRequest({
                version: 1, reference: opening.reference, expected: workOrderExpected(opening), action: 'apply', items: next.map((item, index) => {
                    const old = previous.get(item.key), value: Record<string, unknown> = {
                        id: old?.id ?? `wo-${stamp}-${index}`, key: item.key, orderId: item.orderId, itemId: item.itemId, itemName: item.itemName, partnerName: item.partnerName, qty: item.qty, category: item.category, sortIndex: index
                    };
                    if (item.lineKey !== undefined)
                        value.lineKey = item.lineKey;
                    for (const field of ['workGroup', 'groupId', 'groupName'] as const) {
                        if (Object.hasOwn(item, field))
                            value[field] = item[field] ?? null;
                        else if (old && Object.hasOwn(old, field))
                            value[field] = null;
                    }
                    return value;
                }), ...(groups ? {
                    groups: [...groups]
                } : {})
            });
            const entry = await ports().prepare(scope(), request, active);
            if (!active())
                return false;
            state.pending = {
                entry, token
            };
            state.locked = true;
            state.items = clone(next);
            if (groups)
                state.groups = [...groups];
            repaint();
            const result = await ports().command(scope(), entry, 'apply', active);
            if (!active())
                return false;
            consume(entry, result, token);
            if (result.terminal && result.outcome.status === 'saved' && state.token === token) {
                state.locked = false;
                state.opening = null;
                await capture(false);
            }
            return result.terminal && result.outcome.status === 'saved';
        }
        catch (error) {
            if (active()) {
                state.error = error instanceof Error ? error.message : String(error);
                state.message = state.error;
            }
            return false;
        }
        finally {
            if (active()) {
                state.task = null;
                await read();
                repaint();
            }
        }
    }
    const setWorkItems = (value: Change<WorkItem[]>) => saveItems(typeof value === 'function' ? value(clone(state.items)) : value);
    async function openPicker() {
        if (!current() || state.task || state.openingBusy)
            return false;
        state.token = {};
        state.pending = null;
        state.locked = false;
        state.error = '';
        const opening = await capture(true);
        if (!opening)
            return false;
        state.showPicker = true;
        repaint();
        return true;
    }
    const closePicker = () => {
        if (!current() || state.task || state.openingBusy)
            return false;
        state.showPicker = false;
        state.token = {};
        repaint();
        return true;
    };
    async function reopenCurrent() {
        if (!current() || state.task || state.pending || !state.locked || state.openingBusy)
            return false;
        state.token = {};
        const opening = await capture(false);
        if (!opening)
            return false;
        state.locked = false;
        repaint();
        return true;
    }
    async function retryResetDaily() {
        if (!current() || state.task || !hasUnsentWorkOrderNotice(scope()))
            return;
        const task = begin();
        if (!task)
            return;
        const active = () => current() && state.task === task;
        try {
            await resetDailyWorkOrder(state.companyId, active, ports());
            if (active() && !state.showPicker && !state.pending)
                await capture(false);
        }
        finally {
            if (active()) {
                state.task = null;
                await read();
                repaint();
            }
        }
    }
    async function savePicker() {
        const next = state.pickerGroups.flatMap(group => state.pickerOrdering.filter(key => state.pickerAssign[key] === group).map(key => allItems(latest.current.pickableOrders, false).find(item => item.key === key)).filter((item): item is WorkItem => item !== undefined).map(item => ({
            ...item, workGroup: group
        })));
        return saveItems(next, state.pickerGroups);
    }
    function addGroup() {
        if (!current() || state.task || state.locked)
            return;
        const name = state.newGroupName.trim();
        if (!name)
            return;
        if (state.pickerGroups.includes(name)) {
            state.error = '같은 이름의 그룹이 이미 있습니다.';
            repaint();
            return;
        }
        state.pickerGroups = [...state.pickerGroups, name];
        state.pickerGroup = name;
        state.newGroupName = '';
        repaint();
    }
    async function renameGroup(name: string) {
        if (!current() || state.task || state.locked)
            return;
        const token = state.token, opening = state.opening, task = begin();
        if (!task)
            return;
        try {
            const next = (await appPrompt('그룹 이름', name))?.trim();
            if (!current() || state.token !== token || state.opening !== opening || state.task !== task || state.locked || !next || next === name)
                return;
            if (state.pickerGroups.includes(next)) {
                state.error = '같은 이름의 그룹이 이미 있습니다.';
                repaint();
                return;
            }
            state.pickerGroups = state.pickerGroups.map(value => value === name ? next : value);
            state.pickerAssign = Object.fromEntries(Object.entries(state.pickerAssign).map(([key, value]) => [key, value === name ? next : value]));
            if (state.pickerGroup === name)
                state.pickerGroup = next;
            repaint();
        }
        finally {
            if (current() && state.task === task) {
                state.task = null;
                repaint();
            }
        }
    }
    async function deleteGroup(name: string, count: number) {
        if (!current() || state.task || state.locked)
            return;
        if (state.pickerGroups.length <= 1) {
            state.error = '그룹은 하나는 남아 있어야 합니다.';
            repaint();
            return;
        }
        const token = state.token, opening = state.opening, task = begin();
        if (!task)
            return;
        try {
            if (count > 0 && !await appConfirm(`"${name}" 에 담긴 ${count}건은 어디에도 안 담긴 채로 빠집니다. 지울까요?`))
                return;
            if (!current() || state.token !== token || state.opening !== opening || state.task !== task || state.locked)
                return;
            state.pickerGroups = state.pickerGroups.filter(value => value !== name);
            state.pickerOrdering = state.pickerOrdering.filter(key => state.pickerAssign[key] !== name);
            if (state.pickerGroup === name)
                state.pickerGroup = state.pickerGroups[0] ?? '';
            repaint();
        }
        finally {
            if (current() && state.task === task) {
                state.task = null;
                repaint();
            }
        }
    }
    function togglePickerItem(item: WorkItem, complete = isComplete(item)) {
        if (!current() || state.task || state.locked || complete)
            return;
        if (!state.pickerGroup) {
            state.error = '먼저 담을 그룹을 고르세요.';
            repaint();
            return;
        }
        if (state.pickerOrdering.includes(item.key) && state.pickerAssign[item.key] === state.pickerGroup) {
            state.pickerOrdering = state.pickerOrdering.filter(key => key !== item.key);
            const { [item.key]: _removed, ...rest } = state.pickerAssign;
            state.pickerAssign = rest;
        }
        else {
            state.pickerOrdering = [...state.pickerOrdering.filter(key => key !== item.key), item.key];
            state.pickerAssign = {
                ...state.pickerAssign, [item.key]: state.pickerGroup
            };
        }
        repaint();
    }
    function pickerRows() {
        const all = allItems(latest.current.pickableOrders, false), original = new Map(all.map((item, index) => [item.key, index]));
        const position = (key: string) => {
            if (!state.pickerOrdering.includes(key))
                return Number.MAX_SAFE_INTEGER;
            const group = state.pickerAssign[key], slot = group ? state.pickerGroups.indexOf(group) : state.pickerGroups.length;
            return slot * 100000 + state.pickerOrdering.filter(key => state.pickerAssign[key] === group).indexOf(key);
        };
        return all.filter(item => !state.pickerGroup || !state.pickerAssign[item.key] || state.pickerAssign[item.key] === state.pickerGroup).sort((a, b) => Number(isComplete(a)) - Number(isComplete(b)) || position(a.key) - position(b.key) || (original.get(a.key)! - original.get(b.key)!));
    }
    function toggleGroupPick(key: string) {
        const item = validItems().find(item => item.key === key);
        if (item?.groupId) {
            const remaining = validItems().filter(row => row.groupId === item.groupId).length - 1;
            void setWorkItems(previous => previous.map(row => row.key === key || remaining < 2 && row.groupId === item.groupId ? {
                ...row, groupId: undefined, groupName: undefined
            } : row));
            return;
        }
        change('groupPick', previous => previous.includes(key) ? previous.filter(value => value !== key) : [...previous, key]);
    }
    async function confirmGroup() {
        if (state.groupPick.length < 2)
            return;
        const keys = [...state.groupPick], id = `wg-${Date.now()}`;
        if (await setWorkItems(previous => previous.map(item => keys.includes(item.key) ? {
            ...item, groupId: id
        } : item)))
            change('groupPick', []);
    }
    function dropItem(dragKey: string, targetKey: string) {
        if (!dragKey || dragKey === targetKey)
            return;
        const rows = validItems(), from = rows.findIndex(item => item.key === dragKey), to = rows.findIndex(item => item.key === targetKey);
        if (from < 0 || to < 0 || categoryOf(rows[from]) !== categoryOf(rows[to]))
            return;
        const [removed] = rows.splice(from, 1);
        rows.splice(rows.findIndex(item => item.key === targetKey), 0, removed);
        change('workSort', null);
        void saveItems(rows);
    }
    function moveItem(item: WorkItem, target: number) {
        const section = sectionItems(categoryOf(item)), index = section.findIndex(row => row.key === item.key);
        if (index < 0 || target < 0 || index === target)
            return;
        const [moved] = section.splice(index, 1);
        section.splice(target, 0, moved);
        let position = 0;
        void saveItems(validItems().map(row => categoryOf(row) === categoryOf(item) ? section[position++] : row));
    }
    function applySort(mode: string) {
        const orders = new Map(latest.current.orders.map(order => [order.id, order])), time = (value?: string) => {
            const number = value ? new Date(value).getTime() : NaN;
            return Number.isNaN(number) ? Infinity : number;
        };
        const rank = (item: WorkItem) => mode === 'orderDate' ? time(orders.get(item.orderId)?.createdAt) : mode === 'dueDate' ? time(orders.get(item.orderId)?.deliveryDate) : (() => {
            const product = latest.current.items.find(product => product.id === item.itemId);
            return product ? (product.stock ?? 0) - item.qty : Infinity;
        })();
        if (!current() || state.task || state.locked)
            return;
        state.workSort = mode;
        repaint();
        void setWorkItems(previous => {
            const best = new Map<string, number>();
            previous.forEach(item => best.set(item.partnerName, Math.min(best.get(item.partnerName) ?? Infinity, rank(item))));
            return [...previous].sort((a, b) => (best.get(a.partnerName)! - best.get(b.partnerName)!) || a.partnerName.localeCompare(b.partnerName, 'ko') || rank(a) - rank(b) || a.itemName.localeCompare(b.itemName, 'ko') || a.partnerName.localeCompare(b.partnerName, 'ko'));
        });
    }
    async function recovery(entry: WorkOrderEntry, mode: 'inspect' | 'apply' | 'cancel' | 'discard') {
        const task = begin();
        if (!task)
            return;
        const token = state.token, active = () => current() && state.task === task;
        try {
            if (mode === 'discard') {
                const result = await ports().discard(scope(), entry, active);
                if (active()) {
                    state.message = result.message;
                    if (result.status === 'cleared' && state.pending && entry.reference && state.pending.entry.reference?.planId === entry.reference.planId) {
                        state.pending = null;
                        state.locked = true;
                    }
                }
            }
            else {
                const result = await ports().command(scope(), entry, mode, active);
                if (active()) {
                    const owned = consume(entry, result, token);
                    if (owned && state.token === token) {
                        state.locked = false;
                        state.opening = null;
                        await capture(false);
                    }
                }
            }
        }
        catch (error) {
            if (active())
                state.error = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (active()) {
                state.task = null;
                await read();
                repaint();
            }
        }
    }
    async function history(reset: boolean) {
        if (!current() || state.historyLoading || !reset && !state.historyMore)
            return;
        const generation = ++state.historyGeneration;
        state.historyLoading = true;
        repaint();
        try {
            const result = await ports().history(scope(), reset ? undefined : state.historyMore!, () => current() && generation === state.historyGeneration);
            if (current() && generation === state.historyGeneration) {
                state.history = reset ? result.entries : [...state.history, ...result.entries];
                state.historyMore = result.nextCursor;
                state.historyError = '';
                state.message = `이번 조회 ${result.entries.length}건입니다. ${result.nextCursor ? '다음 기록도 확인해 주세요.' : '목록에 없다는 이유로 미처리를 확정하지 않습니다.'}`;
            }
        }
        catch (error) {
            if (current() && generation === state.historyGeneration)
                state.historyError = error instanceof Error ? error.message : String(error);
        }
        finally {
            if (current() && generation === state.historyGeneration) {
                state.historyLoading = false;
                repaint();
            }
        }
    }
    const resultFor = (entry: WorkOrderEntry) => state.results.get(entry.reference?.planId ?? entry.key);
    const knownResult = (entry: WorkOrderEntry) => resultFor(entry)?.result ?? state.history.find(row => row.result.reference.planId === entry.reference?.planId)?.result;
    const noLocal = (result: WorkOrderResult): WorkOrderEntry => ({
        key: workOrderKey(scope(), result.reference), reference: result.reference, request: null, requestHash: null, referenceHash: null, observedLocalText: null, observedReferenceText: null, status: 'missing', description: `작업순서 처리 · ${result.reference.planId}`
    });
    const projection = (entry: WorkOrderEntry, known?: WorkOrderResult): WorkOrderRecoveryRow => {
        const observed = resultFor(entry), result = observed?.result ?? known;
        return {
            entry, currentState: observed?.outcome.status === 'partial' ? '기기 사본 정리 필요' : observed?.copyMismatch ? '보관 내용 확인 필요' : result?.status === 'applied' ? '작업순서 처리 완료' : result?.status === 'rejected' ? '작업순서 처리 거절' : result?.status === 'cancelled' ? '미처리 요청 중단 완료' : '작업순서 처리 여부 확인 필요', cause: observed ? saveOutcomeMessage(observed.outcome) : result?.message ?? '이전에 요청한 작업순서의 처리 결과를 아직 확인하지 못했습니다.', nextAction: entry.observedLocalText === null && entry.observedReferenceText === null ? '현재 작업순서를 확인하고 필요한 새 업무를 진행해 주세요.' : '처리 결과를 확인하거나 미처리 요청을 중단한 뒤 관측한 기기 사본만 정리해 주세요.'
        };
    };
    const visible = current(), operations = visible ? state.operations : [], historyRows = visible ? state.history.filter(row => !operations.some(entry => entry.reference?.planId === row.result.reference.planId)).map(row => projection(noLocal(row.result), row.result)) : [];
    const workCategories = [...new Set([...state.groups, ...validItems().map(categoryOf)])].sort((a, b) => {
        const ai = state.groups.indexOf(a), bi = state.groups.indexOf(b);
        return (ai === -1 ? state.groups.length : ai) - (bi === -1 ? state.groups.length : bi) || a.localeCompare(b, 'ko');
    });
    return {
        workItems: visible ? state.items : [], setWorkItems, workGroups: visible ? state.groups : [], saveWorkGroups: (names: string[]) => saveItems(state.items, names), showWorkOrderPicker: visible && state.showPicker, setShowWorkOrderPicker: (value: boolean) => value ? openPicker() : closePicker(), openPicker, closePicker, savePicker, reopenCurrent, retryResetDaily, canRetryReset: visible && !state.task && !state.openingBusy && hasUnsentWorkOrderNotice(scope()), canReopenCurrent: visible && state.locked && !state.pending && !state.task && !state.openingBusy,
        pickerOrdering: state.pickerOrdering, setPickerOrdering: (value: Change<string[]>) => change('pickerOrdering', value), pickerGroups: state.pickerGroups, setPickerGroups: (value: Change<string[]>) => change('pickerGroups', value), pickerAssign: state.pickerAssign, setPickerAssign: (value: Change<Record<string, string>>) => change('pickerAssign', value), pickerGroup: state.pickerGroup, setPickerGroup: (value: Change<string>) => change('pickerGroup', value), 그룹편집: state.groupEditing, set그룹편집: (value: Change<boolean>) => change('groupEditing', value), 새그룹이름: state.newGroupName, set새그룹이름: (value: Change<string>) => change('newGroupName', value), 그룹추가: addGroup, 그룹이름바꾸기: renameGroup, 그룹지우기: deleteGroup,
        workSort: state.workSort, setWorkSort: (value: Change<string | null>) => change('workSort', value), workGroupPick: state.groupPick, setWorkGroupPick: (value: Change<string[]>) => change('groupPick', value), draggingWorkKey: state.dragging, setDraggingWorkKey: (value: Change<string | null>) => change('dragging', value), workCategoryOf: categoryOf, applyWorkSort: applySort, validWorkItems: visible ? validItems() : [], allPickableItems: visible ? allItems(options.pickableOrders, false) : [], 묶음찾기: groupOf, toggleWorkGroupPick: toggleGroupPick, confirmWorkGroup: confirmGroup, sectionItemsAll: sectionItems, 다한줄: completedItems, orderedSectionItems: orderedItems, isWorkComplete: isComplete, isWorkProcessing: isProcessing, workOrderOf, orderItemOf, showCompletedWorkItems: state.showCompleted, setShowCompletedWorkItems: (value: Change<boolean>) => change('showCompleted', value), workCategories, pickerRows: visible ? pickerRows() : [], togglePickerItem, dropWorkItem: dropItem, moveWorkItem: moveItem,
        busy: visible && !!state.task, locked: visible && state.locked, openingBusy: visible && state.openingBusy, canClose: visible && !state.task && !state.openingBusy, canSavePicker: visible && !state.task && !state.locked && !state.openingBusy && !!state.opening, error: visible ? (state.error || state.resetNotice) : '', message: visible ? state.message : '', readLoading: visible && state.readLoading, readError: visible ? state.readError : '', operations, failureRows: operations.filter(entry => !(state.task && state.pending?.entry.reference?.planId === entry.reference?.planId)).map(entry => projection(entry)), historyRows, failureCount: operations.filter(entry => !(state.task && state.pending?.entry.reference?.planId === entry.reference?.planId)).length, resultFor, refresh: read, loadHistory: () => history(true), nextHistory: () => history(false), historyLoading: visible && state.historyLoading, historyMore: visible ? state.historyMore : null, historyError: visible ? state.historyError : '', inspect: (entry: WorkOrderEntry) => recovery(entry, 'inspect'), retry: (entry: WorkOrderEntry) => recovery(entry, 'apply'), cancel: (entry: WorkOrderEntry) => recovery(entry, 'cancel'), discardCopy: (entry: WorkOrderEntry) => recovery(entry, 'discard'), canRetry: (entry: WorkOrderEntry) => entry.status === 'valid' && !resultFor(entry)?.terminal && !resultFor(entry)?.copyMismatch, canCancel: (entry: WorkOrderEntry) => !!entry.reference && (!knownResult(entry) || knownResult(entry)?.status === 'unknown'), canDiscard: (entry: WorkOrderEntry) => entry.observedLocalText !== null || entry.observedReferenceText !== null
    };
}
