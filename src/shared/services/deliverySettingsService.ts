import { doc, getDocFromServer, onSnapshot, runTransaction, type Firestore } from 'firebase/firestore';
import { auth, authReady, db } from '../firebase';
import { companySettingDocId, companySettingStateKey } from '../companySettings';
import { withClaimCompany } from '../companyWriteBoundary';
import type { CompanyId } from '../types';
import type { DeliveryGroup } from '../deliveryPlan';
export interface DeliverySettingsScope {
    companyId: CompanyId;
    actorUid: string;
    isCurrent: () => boolean;
}
export interface DeliverySettingsSnapshot {
    exists: boolean;
    companyId?: CompanyId;
    ordering?: string[];
    orderingByDate?: Record<string, string[]>;
    timeSlots?: Record<string, '오전' | '오후'>;
    groupsByDate?: Record<string, DeliveryGroup[]>;
}
type OrderingChange = {
    date: string;
    nextOrdering: string[];
    usesLegacyOrdering: boolean;
};
export type DeliverySettingsChange = ({
    type: 'day-ordering';
} & OrderingChange) | {
    type: 'slot';
    orderId: string;
    nextSlot: '오전' | '오후';
    ordering?: OrderingChange;
} | {
    type: 'day-groups';
    date: string;
    nextGroups: DeliveryGroup[];
};
type Observation = {
    path: string[];
    exists: boolean;
    value?: unknown;
};
export interface DeliverySettingsRequest {
    version: 1;
    kind: 'delivery-settings';
    companyId: CompanyId;
    actorUid: string;
    auditId: string;
    changedAt: string;
    changedBy: string;
    settingsExists: boolean;
    change: DeliverySettingsChange;
    before: Observation[];
}
export type DeliverySettingsResult = {
    status: 'applied' | 'cancelled' | 'not-found';
};
export class DeliverySettingsError extends Error {
    constructor(message: string, readonly outcome: 'not-started' | 'unknown') { super(message); }
}
function bad(message = '배송 설정 원문을 확인할 수 없습니다. 현재 자료를 다시 읽어 주세요.'): never {
    throw new DeliverySettingsError(message, 'not-started');
}
const same = (a: unknown, b: unknown) => companySettingStateKey(a) === companySettingStateKey(b);
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function json<T>(value: T): T {
    const walk = (item: unknown): void => {
        if (item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)))
            return;
        if (Array.isArray(item)) {
            item.forEach(walk);
            return;
        }
        if (record(item)) {
            Object.values(item).forEach(walk);
            return;
        }
        bad();
    };
    walk(value);
    return JSON.parse(JSON.stringify(value)) as T;
}
function freeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}
function validateChange(change: DeliverySettingsChange) {
    const ordering = (value: OrderingChange) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Array.isArray(value.nextOrdering) || value.nextOrdering.some(id => typeof id !== 'string' || !id || id.includes('/')) || new Set(value.nextOrdering).size !== value.nextOrdering.length || typeof value.usesLegacyOrdering !== 'boolean')
            bad();
    };
    if (change.type === 'day-ordering')
        ordering(change);
    else if (change.type === 'slot') {
        if (!change.orderId || change.orderId.includes('/') || !['오전', '오후'].includes(change.nextSlot))
            bad();
        if (change.ordering)
            ordering(change.ordering);
    }
    else if (change.type === 'day-groups') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(change.date) || !Array.isArray(change.nextGroups))
            bad();
        for (const group of change.nextGroups)
            if (!group || typeof group.id !== 'string' || !Array.isArray(group.orderIds) || group.orderIds.some(id => typeof id !== 'string') || (group.name !== undefined && typeof group.name !== 'string'))
                bad();
    }
    else
        bad();
}
function paths(change: DeliverySettingsChange): string[][] {
    const ordering = (value: OrderingChange) => [['orderingByDate', value.date], ...(value.usesLegacyOrdering ? [['ordering']] : [])];
    if (change.type === 'day-ordering')
        return ordering(change);
    if (change.type === 'slot')
        return [['timeSlots', change.orderId], ...(change.ordering ? ordering(change.ordering) : [])];
    return [['groupsByDate', change.date]];
}
function observe(value: Record<string, unknown>, path: string[]): Observation {
    let node: unknown = value;
    for (const key of path) {
        if (!record(node))
            bad();
        if (!has(node, key))
            return { path, exists: false };
        node = node[key];
    }
    return { path, exists: true, value: json(node) };
}
export function prepareDeliverySettings(scope: DeliverySettingsScope, snapshot: DeliverySettingsSnapshot, change: DeliverySettingsChange, meta: {
    auditId: string;
    changedAt: string;
    changedBy: string;
}): DeliverySettingsRequest {
    if (!scope.isCurrent() || !['taebaek', 'punghoe'].includes(scope.companyId) || !scope.actorUid || !meta.auditId.startsWith('delivery-settings-') || meta.auditId.includes('/') || !Number.isFinite(Date.parse(meta.changedAt)) || typeof meta.changedBy !== 'string' || typeof snapshot.exists !== 'boolean' || (snapshot.exists && snapshot.companyId !== scope.companyId))
        bad();
    validateChange(change);
    const before = paths(change).map(path => observe(snapshot as unknown as Record<string, unknown>, path));
    const legacy = change.type === 'day-ordering' ? change : change.type === 'slot' ? change.ordering : undefined;
    if (legacy?.usesLegacyOrdering && before.find(item => same(item.path, ['orderingByDate', legacy.date]))?.exists)
        bad();
    return freeze(json({ version: 1, kind: 'delivery-settings', companyId: scope.companyId, actorUid: scope.actorUid, ...meta, settingsExists: snapshot.exists, change, before }));
}
function strict(input: DeliverySettingsRequest): DeliverySettingsRequest {
    const request = json(input);
    if (request.version !== 1 || request.kind !== 'delivery-settings' || !['taebaek', 'punghoe'].includes(request.companyId) || !request.actorUid || !request.auditId.startsWith('delivery-settings-') || request.auditId.includes('/') || !Number.isFinite(Date.parse(request.changedAt)) || typeof request.changedBy !== 'string' || typeof request.settingsExists !== 'boolean')
        bad();
    validateChange(request.change);
    if (!Array.isArray(request.before) || !same(request.before.map(item => item.path), paths(request.change)) || request.before.some(item => typeof item.exists !== 'boolean' || item.exists !== has(item, 'value')))
        bad();
    return freeze(request);
}
function actor(scope: DeliverySettingsScope) {
    const user = auth.currentUser, companyId = scope.companyId, uid = scope.actorUid, current = scope.isCurrent;
    const check = () => {
        if (!current() || !user || auth.currentUser !== user || user.uid !== uid || scope.companyId !== companyId || scope.actorUid !== uid)
            bad('회사 또는 로그인 계정이 바뀌었습니다. 현재 화면에서 다시 확인해 주세요.');
    };
    return { check, ready: async () => { check(); await authReady; check(); const token = await user!.getIdTokenResult(); check(); withClaimCompany('settings', { companyId }, { companyId: token.claims.companyId }); check(); } };
}
function failure(error: unknown, sent: boolean) {
    const code = String((error as {
        code?: unknown;
    } | null)?.code ?? '').replace(/^firestore\//, '');
    const messages: Record<string, string> = {
        'permission-denied': '현재 계정의 배송 설정 권한을 확인하지 못했습니다. 처리 결과를 먼저 확인한 뒤 계정 권한을 확인해 주세요.',
        'unauthenticated': '로그인 인증을 확인하지 못했습니다. 다시 로그인한 뒤 처리 결과를 먼저 확인해 주세요.',
        'unavailable': '연결이 끊겨 처리 응답을 받지 못했습니다. 연결을 확인한 뒤 처리 결과를 확인해 주세요.',
        'deadline-exceeded': '응답 대기 시간이 지나 처리 결과를 확인하지 못했습니다. 같은 요청의 결과를 먼저 확인해 주세요.'
    };
    if (error instanceof DeliverySettingsError && !sent)
        return error;
    return Object.assign(new DeliverySettingsError(messages[code] ?? (error instanceof Error ? error.message : '배송 설정 결과를 확인하지 못했습니다. 결과를 다시 확인해 주세요.'), sent ? 'unknown' : 'not-started'), { cause: error });
}
function snapshot(exists: boolean, data: Record<string, unknown> | undefined, companyId: CompanyId): DeliverySettingsSnapshot {
    if (!exists)
        return { exists: false };
    if (!data || data.companyId !== companyId)
        bad('현재 회사의 배송 설정을 확인할 수 없습니다.');
    const result: Record<string, unknown> = { exists: true, companyId };
    for (const key of ['ordering', 'orderingByDate', 'timeSlots', 'groupsByDate'])
        if (has(data, key))
            result[key] = data[key];
    return result as unknown as DeliverySettingsSnapshot;
}
export async function readDeliverySettings(scope: DeliverySettingsScope, store: Firestore = db): Promise<DeliverySettingsSnapshot> {
    try {
        const owner = actor(scope);
        await owner.ready();
        const value = await getDocFromServer(doc(store, 'settings', companySettingDocId(scope.companyId, 'deliveryOrdering')));
        owner.check();
        return snapshot(value.exists(), value.data(), scope.companyId);
    }
    catch (error) {
        throw failure(error, false);
    }
}
/** 초기 인증 준비 중 구독 자체는 기존 SDK 규칙 범위에 두고 이전 수명의 결과만 폐기한다. */
export function subscribeDeliverySettings(scope: DeliverySettingsScope, onValue: (value: DeliverySettingsSnapshot) => void, onError: (error: Error) => void, store: Firestore = db): () => void {
    const user = auth.currentUser, uid = scope.actorUid, companyId = scope.companyId;
    let active = true;
    const current = () => active && scope.isCurrent() && auth.currentUser === user && (user ? user.uid === uid : uid === '') && scope.actorUid === uid && scope.companyId === companyId;
    const stop = onSnapshot(doc(store, 'settings', companySettingDocId(companyId, 'deliveryOrdering')), value => {
        if (!current())
            return;
        try {
            onValue(snapshot(value.exists(), value.data(), companyId));
        }
        catch (error) {
            onError(failure(error, false));
        }
    }, error => {
        if (current())
            onError(failure(error, false));
    });
    return () => { active = false; stop(); };
}
function receipt(data: Record<string, unknown> | undefined, request: DeliverySettingsRequest): DeliverySettingsResult {
    if (!data || data.kind !== request.kind || data.companyId !== request.companyId || data.actorUid !== request.actorUid || !same(data.request, request) || !['COMPLETED', 'CANCELLED'].includes(String(data.outcome)))
        bad('같은 기록 번호에 다른 요청 또는 원문이 부족한 처리 기록이 있습니다.');
    return { status: data.outcome === 'COMPLETED' ? 'applied' : 'cancelled' };
}
function bound(scope: DeliverySettingsScope, request: DeliverySettingsRequest) {
    if (request.companyId !== scope.companyId || request.actorUid !== scope.actorUid)
        bad('현재 회사와 계정의 요청이 아닙니다.');
    return actor(scope);
}
export async function applyDeliverySettings(scope: DeliverySettingsScope, input: DeliverySettingsRequest, store: Firestore = db): Promise<DeliverySettingsResult> {
    let sent = false;
    try {
        const request = strict(input), owner = bound(scope, request);
        await owner.ready();
        const result = await runTransaction(store, async (tx) => {
            owner.check();
            const auditRef = doc(store, 'deliveryScheduleAudits', request.auditId), audit = await tx.get(auditRef);
            owner.check();
            if (audit.exists())
                return receipt(audit.data(), request);
            const settingsRef = doc(store, 'settings', companySettingDocId(request.companyId, 'deliveryOrdering')), current = await tx.get(settingsRef);
            owner.check();
            const state = snapshot(current.exists(), current.data(), request.companyId);
            if (state.exists !== request.settingsExists || request.before.some(item => !same(item, observe(state as unknown as Record<string, unknown>, item.path))))
                bad('배송 설정이 변경되었습니다. 처리 결과를 확인하거나 요청을 중단한 뒤 현재 자료를 다시 읽어 주세요.');
            const change = request.change;
            if (change.type === 'slot') {
                const order = await tx.get(doc(store, 'orders', change.orderId));
                owner.check();
                if (!order.exists() || order.data().companyId !== request.companyId)
                    bad('현재 회사의 주문을 확인할 수 없습니다.');
            }
            const patch: Record<string, unknown> = { companyId: request.companyId };
            if (change.type === 'day-ordering')
                patch.orderingByDate = { [change.date]: change.nextOrdering };
            else if (change.type === 'day-groups')
                patch.groupsByDate = { [change.date]: change.nextGroups };
            else {
                patch.timeSlots = { [change.orderId]: change.nextSlot };
                if (change.ordering)
                    patch.orderingByDate = { [change.ordering.date]: change.ordering.nextOrdering };
            }
            owner.check();
            sent = true;
            tx.set(settingsRef, patch, { merge: true });
            tx.set(auditRef, { id: request.auditId, kind: request.kind, companyId: request.companyId, actorUid: request.actorUid, outcome: 'COMPLETED', request, changedAt: request.changedAt, changedBy: request.changedBy });
            return { status: 'applied' as const };
        });
        owner.check();
        return result;
    }
    catch (error) {
        throw failure(error, sent);
    }
}
export async function inspectDeliverySettings(scope: DeliverySettingsScope, input: DeliverySettingsRequest, store: Firestore = db): Promise<DeliverySettingsResult> {
    try {
        const request = strict(input), owner = bound(scope, request);
        await owner.ready();
        const value = await getDocFromServer(doc(store, 'deliveryScheduleAudits', request.auditId));
        owner.check();
        return value.exists() ? receipt(value.data(), request) : { status: 'not-found' };
    }
    catch (error) {
        throw failure(error, false);
    }
}
export async function cancelDeliverySettings(scope: DeliverySettingsScope, input: DeliverySettingsRequest, store: Firestore = db): Promise<DeliverySettingsResult> {
    let sent = false;
    try {
        const request = strict(input), owner = bound(scope, request);
        await owner.ready();
        const result = await runTransaction(store, async (tx) => {
            owner.check();
            const ref = doc(store, 'deliveryScheduleAudits', request.auditId), value = await tx.get(ref);
            owner.check();
            if (value.exists())
                return receipt(value.data(), request);
            sent = true;
            tx.set(ref, { id: request.auditId, kind: request.kind, companyId: request.companyId, actorUid: request.actorUid, outcome: 'CANCELLED', request, changedAt: request.changedAt, changedBy: request.changedBy });
            return { status: 'cancelled' as const };
        });
        owner.check();
        return result;
    }
    catch (error) {
        throw failure(error, sent);
    }
}
