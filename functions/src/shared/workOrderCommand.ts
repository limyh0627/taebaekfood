import { cleanupValidId } from './partnerItemCleanup';
import { encodeCatalogValue, decodeCatalogValue, type CatalogValue } from './catalogOrderReferenceProof';

export const WORK_ORDER_OPERATIONS = 'workOrderOperations';
export const WORK_ORDER_FENCES = 'workOrderFences';
export interface WorkOrderReference { companyId: 'taebaek' | 'punghoe'; planId: string }
export interface WorkOrderItem {
    id: string;
    key: string;
    orderId: string;
    itemId: string;
    lineKey?: string;
    itemName: string;
    partnerName: string;
    qty: number;
    category: string;
    sortIndex: number;
    workGroup?: string | null;
    groupId?: string | null;
    groupName?: string | null;
}
export interface WorkOrderDocumentVersion { exists: boolean; version: string | null }
export interface WorkOrderExpected {
    items: { id: string; version: string }[];
    groups: WorkOrderDocumentVersion;
    reset: WorkOrderDocumentVersion;
}
export interface WorkOrderOpening {
    reference: WorkOrderReference;
    actorUid: string;
    items: { id: string; data: CatalogValue; version: string }[];
    groups: WorkOrderDocumentVersion & { data: CatalogValue | null };
    reset: WorkOrderDocumentVersion & { data: CatalogValue | null };
}
export type WorkOrderRequest = {
    version: 1;
    reference: WorkOrderReference;
    expected: WorkOrderExpected;
} & ({ action: 'apply'; items: WorkOrderItem[]; groups?: string[] } | { action: 'resetDaily'; date: string });
export interface WorkOrderResult {
    version: 1;
    reference: WorkOrderReference;
    actorUid: string;
    status: 'applied' | 'rejected' | 'cancelled' | 'unknown';
    requestHash: string | null;
    message: string;
}
export interface WorkOrderHistoryResult {
    version: 1;
    companyId: WorkOrderReference['companyId'];
    actorUid: string;
    entries: { result: WorkOrderResult; action: 'apply' | 'resetDaily' | 'cancel'; createdAt: string }[];
    nextCursor: string | null;
}
export type WorkOrderCommand = { mode: 'open'; reference: WorkOrderReference }
    | { mode: 'apply'; request: WorkOrderRequest }
    | { mode: 'inspect' | 'cancel'; reference: WorkOrderReference }
    | { mode: 'listHistory'; companyId: WorkOrderReference['companyId']; cursor?: string };

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !keys.includes(key)))
        throw Error('작업순서 요청 형식을 확인해 주세요.');
}
function nativeVersion(value: unknown): string | null {
    if (value === null) return null;
    if (typeof value !== 'string' || !/^\d+:\d{9}$/.test(value)) throw Error('작업순서의 확인 버전이 올바르지 않습니다.');
    return value;
}
function documentVersion(value: unknown): WorkOrderDocumentVersion {
    exact(value, ['exists', 'version']);
    const version = nativeVersion(value.version);
    if (typeof value.exists !== 'boolean' || value.exists !== (version !== null)) throw Error('작업순서 설정의 존재 여부가 다릅니다.');
    return { exists: value.exists, version };
}
export function normalizeWorkOrderReference(value: unknown): WorkOrderReference {
    exact(value, ['companyId', 'planId']);
    if (!['taebaek', 'punghoe'].includes(String(value.companyId)) || !cleanupValidId(value.planId)) throw Error('작업순서 요청 번호를 확인해 주세요.');
    return { companyId: value.companyId as WorkOrderReference['companyId'], planId: value.planId };
}
export function normalizeWorkOrderExpected(value: unknown): WorkOrderExpected {
    exact(value, ['items', 'groups', 'reset']);
    if (!Array.isArray(value.items) || value.items.length > 500) throw Error('한 번에 확인할 작업순서가 너무 많습니다.');
    const items = value.items.map(item => {
        exact(item, ['id', 'version']);
        const version = nativeVersion(item.version);
        if (!cleanupValidId(item.id) || version === null) throw Error('작업순서 항목의 확인 버전이 없습니다.');
        return { id: item.id, version };
    }).sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(items.map(item => item.id)).size !== items.length) throw Error('확인 항목 번호가 중복됩니다.');
    return { items, groups: documentVersion(value.groups), reset: documentVersion(value.reset) };
}
export function normalizeWorkOrderItem(value: unknown): WorkOrderItem {
    const fields = ['id', 'key', 'orderId', 'itemId', 'lineKey', 'itemName', 'partnerName', 'qty', 'category', 'sortIndex', 'workGroup', 'groupId', 'groupName'];
    exact(value, fields);
    for (const key of ['id', 'orderId', 'itemId']) if (!cleanupValidId(value[key])) throw Error('작업순서 항목 번호를 확인해 주세요.');
    for (const key of ['key', 'itemName', 'partnerName', 'category']) if (typeof value[key] !== 'string') throw Error('작업순서 항목 원문을 확인해 주세요.');
    if (typeof value.qty !== 'number' || !Number.isFinite(value.qty) || !Number.isSafeInteger(value.sortIndex) || (value.sortIndex as number) < 0) throw Error('작업순서 수량과 순번을 확인해 주세요.');
    if (Object.prototype.hasOwnProperty.call(value, 'lineKey') && typeof value.lineKey !== 'string') throw Error('주문 줄 번호를 확인해 주세요.');
    for (const key of ['workGroup', 'groupId', 'groupName']) if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== null && typeof value[key] !== 'string') throw Error('작업순서 묶음을 확인해 주세요.');
    return Object.fromEntries(fields.filter(key => Object.prototype.hasOwnProperty.call(value, key)).map(key => [key, value[key]])) as unknown as WorkOrderItem;
}
export function normalizeWorkOrderRequest(value: unknown): WorkOrderRequest {
    exact(value, ['version', 'reference', 'expected', 'action', 'items', 'groups', 'date']);
    if (value.version !== 1) throw Error('작업순서 요청 버전을 확인해 주세요.');
    const common = { version: 1 as const, reference: normalizeWorkOrderReference(value.reference), expected: normalizeWorkOrderExpected(value.expected) };
    if (value.action === 'resetDaily') {
        if (Object.prototype.hasOwnProperty.call(value, 'items') || Object.prototype.hasOwnProperty.call(value, 'groups') || typeof value.date !== 'string' || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(value.date)) throw Error('초기화 날짜를 확인해 주세요.');
        return { ...common, action: 'resetDaily', date: value.date };
    }
    if (value.action !== 'apply' || Object.prototype.hasOwnProperty.call(value, 'date') || !Array.isArray(value.items) || value.items.length > 500) throw Error('작업순서 저장 항목을 확인해 주세요.');
    const items = value.items.map(normalizeWorkOrderItem);
    if (new Set(items.map(item => item.id)).size !== items.length || new Set(items.map(item => item.key)).size !== items.length || items.some((item, index) => item.sortIndex !== index)) throw Error('작업순서 번호 또는 순번이 중복됩니다.');
    if (Object.prototype.hasOwnProperty.call(value, 'groups') && (!Array.isArray(value.groups) || value.groups.some(name => typeof name !== 'string'))) throw Error('작업 그룹 이름을 확인해 주세요.');
    return { ...common, action: 'apply', items, ...(Object.prototype.hasOwnProperty.call(value, 'groups') ? { groups: value.groups as string[] } : {}) };
}
export const serializeWorkOrderRequest = (value: WorkOrderRequest): string => JSON.stringify(normalizeWorkOrderRequest(value));

/** 표시 원문도 같은 codec으로 풀고, 저장에 쓸 버전 집합은 따로 고정한다. */
export function decodeWorkOrderValue(value: CatalogValue): Record<string, unknown> {
    const reject = () => { throw Error('작업순서 표시 원문을 확인하지 못했습니다.'); };
    const decoded = decodeCatalogValue(value, { special: () => undefined, timestamp: (seconds, nanoseconds) => ({ seconds, nanoseconds }), reference: path => ({ path }), geo: (latitude, longitude) => ({ latitude, longitude }), bytes: values => values });
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) reject();
    return decoded as Record<string, unknown>;
}
export function workOrderExpected(opening: WorkOrderOpening): WorkOrderExpected {
    return normalizeWorkOrderExpected({ items: opening.items.map(({ id, version }) => ({ id, version })), groups: { exists: opening.groups.exists, version: opening.groups.version }, reset: { exists: opening.reset.exists, version: opening.reset.version } });
}
export function decodeWorkOrderOpening(opening: WorkOrderOpening) {
    return { items: opening.items.map(row => ({ ...decodeWorkOrderValue(row.data), id: row.id })), groups: opening.groups.data === null ? null : decodeWorkOrderValue(opening.groups.data), reset: opening.reset.data === null ? null : decodeWorkOrderValue(opening.reset.data) };
}
function bind(value: Record<string, unknown>, reference: WorkOrderReference, uid: string) {
    if (JSON.stringify(normalizeWorkOrderReference(value.reference)) !== JSON.stringify(normalizeWorkOrderReference(reference)) || value.actorUid !== uid) throw Error('다른 회사 또는 계정의 작업순서 결과입니다.');
}
export function normalizeWorkOrderOpening(value: unknown, reference: WorkOrderReference, uid: string): WorkOrderOpening {
    exact(value, ['reference', 'actorUid', 'items', 'groups', 'reset']);
    bind(value, reference, uid);
    if (!Array.isArray(value.items) || value.items.length > 500) throw Error('작업순서 원문 목록이 올바르지 않습니다.');
    const items = value.items.map(row => {
        exact(row, ['id', 'data', 'version']);
        if (!cleanupValidId(row.id) || nativeVersion(row.version) === null) throw Error('작업순서 원문 번호가 올바르지 않습니다.');
        decodeWorkOrderValue(row.data as CatalogValue);
        return { id: row.id, data: row.data as CatalogValue, version: row.version as string };
    });
    const setting = (raw: unknown) => {
        exact(raw, ['exists', 'version', 'data']);
        const state = documentVersion({ exists: raw.exists, version: raw.version });
        if (state.exists !== (raw.data !== null)) throw Error('작업순서 설정 원문이 다릅니다.');
        if (raw.data !== null) decodeWorkOrderValue(raw.data as CatalogValue);
        return { ...state, data: raw.data as CatalogValue | null };
    };
    const result = { reference: normalizeWorkOrderReference(value.reference), actorUid: uid, items, groups: setting(value.groups), reset: setting(value.reset) };
    workOrderExpected(result);
    return result;
}
export const normalizeWorkOrderOpenResult = normalizeWorkOrderOpening;
export function normalizeWorkOrderResult(value: unknown, reference: WorkOrderReference, uid: string, expectedHash?: string): WorkOrderResult {
    exact(value, ['version', 'reference', 'actorUid', 'status', 'requestHash', 'message']);
    bind(value, reference, uid);
    if (value.version !== 1 || !['applied', 'rejected', 'cancelled', 'unknown'].includes(String(value.status)) || typeof value.message !== 'string' || !value.message || (value.requestHash === null ? !['cancelled', 'unknown'].includes(String(value.status)) : typeof value.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.requestHash)) || (expectedHash !== undefined && value.requestHash !== null && value.requestHash !== expectedHash)) throw Error('작업순서 처리 근거를 확인하지 못했습니다.');
    return { version: 1, reference: normalizeWorkOrderReference(value.reference), actorUid: uid, status: value.status as WorkOrderResult['status'], requestHash: value.requestHash as string | null, message: value.message };
}
export function normalizeWorkOrderHistoryResult(value: unknown, companyId: WorkOrderReference['companyId'], uid: string): WorkOrderHistoryResult {
    exact(value, ['version', 'companyId', 'actorUid', 'entries', 'nextCursor']);
    if (value.version !== 1 || value.companyId !== companyId || value.actorUid !== uid || !Array.isArray(value.entries) || value.entries.length > 50 || (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !/^[a-f0-9]{64}$/.test(value.nextCursor)))) throw Error('작업순서 처리이력을 확인하지 못했습니다.');
    return { version: 1, companyId, actorUid: uid, entries: value.entries.map(entry => {
        exact(entry, ['result', 'action', 'createdAt']);
        const ref = normalizeWorkOrderReference((entry.result as WorkOrderResult)?.reference);
        if (ref.companyId !== companyId || !['apply', 'resetDaily', 'cancel'].includes(String(entry.action)) || typeof entry.createdAt !== 'string' || !entry.createdAt) throw Error('다른 범위의 작업순서 이력입니다.');
        return { result: normalizeWorkOrderResult(entry.result, ref, uid), action: entry.action as 'apply' | 'resetDaily' | 'cancel', createdAt: entry.createdAt };
    }), nextCursor: value.nextCursor as string | null };
}
export { encodeCatalogValue };
