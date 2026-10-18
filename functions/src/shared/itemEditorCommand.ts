import { encodeCatalogValue, type CatalogValue, type CatalogValueAdapter } from './catalogOrderReferenceProof';
import { cleanupValidId } from './partnerItemCleanup';
import {documentId as itemEditorDocumentId} from './documentId';
export {documentId as itemEditorDocumentId} from './documentId';
import { isSmartStoreItem } from './itemEditorDomain';
export { buildPurchaseNotices, itemEditorPurchaseNoticeText, itemEditorPurchaseNoticeMessage } from './itemEditorDomain';
export type { CatalogValue, CatalogValueAdapter } from './catalogOrderReferenceProof';
export const ITEM_EDITOR_OPERATIONS = 'itemEditorOperations';
export const ITEM_EDITOR_STAGES = ['primary', 'bom-cost', 'formula', 'formula-cost', 'purchase-links'] as const;
export type ItemEditorStage = typeof ITEM_EDITOR_STAGES[number];
export function itemEditorStageLabel(stage: ItemEditorStage): string {
    return { 'primary': '품목·박스 규격·구성품', 'bom-cost': '구성품 원가', 'formula': '배합', 'formula-cost': '배합 원가', 'purchase-links': '매입 거래처 연결' }[stage];
}
export interface ItemEditorReference {
    companyId: 'taebaek' | 'punghoe';
    planId: string;
    targetId: string;
}
export interface ItemEditorDocument {
    id: string;
    data: Record<string, unknown>;
}
export interface ItemEditorGraphDocuments {
    items: ItemEditorDocument[];
    boms: ItemEditorDocument[];
    formulas: ItemEditorDocument[];
    links: ItemEditorDocument[];
}
export type ItemEditorGraphPart = keyof ItemEditorGraphDocuments;
export const ITEM_EDITOR_GRAPH_PARTS = ['items', 'boms', 'formulas', 'links'] as const;
export interface ItemEditorGraphStamp {
    count: number;
    digest: string;
}
export type ItemEditorGraphEvidence = {
    schemaVersion: 1;
} & Record<ItemEditorGraphPart, ItemEditorGraphStamp>;
export interface ItemEditorDraft {
    isNew: boolean;
    metadata: Record<string, unknown>;
    bomDraft?: {
        childId: string;
        qty: number;
    }[];
    formulaRows?: {
        child_name: string;
        yield_pct: number;
    }[];
    inPartnerIds: string[];
    photoChanged: boolean;
}
export interface ItemEditorRequest extends ItemEditorReference {
    version: 1;
    graph: ItemEditorGraphEvidence;
    targetExpected: CatalogValue | null;
    draft: ItemEditorDraft;
    purchaseNoticeHash?: string;
}
export type ItemEditorCommand = {
    mode: 'apply';
    request: ItemEditorRequest;
    stage: ItemEditorStage;
} | {
    mode: 'inspect' | 'cancel';
    reference: ItemEditorReference;
    requestHash?: string;
};
export interface ItemEditorResult extends ItemEditorReference {
    actorUid: string;
    requestHash: string | null;
    status: 'active' | 'completed' | 'cancelled' | 'rejected' | 'unknown';
    confirmedStageIds: ItemEditorStage[];
    message: string;
}
export const ITEM_EDITOR_METADATA_FIELDS = ['name', 'type', 'category', 'subtype', 'cost', 'minStock', 'unit', 'image', 'imagePath', 'freightType', 'spec', '품목', 'isSmartStore', 'phantom', 'unpackable', 'costSource'] as const;
const ITEM_FIELDS = ['id', 'companyId', 'name', 'type', '품목', 'spec', 'cost', 'costSource', 'phantom', 'archived'] as const;
const BOM_FIELDS = ['id', 'companyId', 'parent_id', 'child_id', 'quantity'] as const;
const FORMULA_FIELDS = ['id', 'companyId', 'parent_key', 'child_name', 'ratio', 'yield_rate'] as const;
const own = (row: Record<string, unknown>, fields: readonly string[]) => Object.fromEntries(fields.filter(field => Object.prototype.hasOwnProperty.call(row, field)).map(field => [field, row[field]]));
export function itemEditorTargetExpected(rawTarget: Record<string, unknown>, adapter?: Pick<CatalogValueAdapter, 'special'>): CatalogValue {
    return encodeCatalogValue(own(rawTarget, ['companyId', ...ITEM_EDITOR_METADATA_FIELDS, 'partnerIds']), adapter);
}
/** 화면에 주입한 채널 표식만 정본으로 비교하고 매출처 파생 배열은 쓰기 근거로 쓰지 않는다. */
export function itemEditorDisplayMatches(display: Record<string, unknown>, rawTarget: Record<string, unknown>, adapter?: Pick<CatalogValueAdapter, 'special'>): boolean {
    const fields = ['companyId', ...ITEM_EDITOR_METADATA_FIELDS.filter(field => field !== 'isSmartStore')];
    return JSON.stringify(encodeCatalogValue(own(display, fields), adapter)) === JSON.stringify(encodeCatalogValue(own(rawTarget, fields), adapter))
        && isSmartStoreItem(display as Parameters<typeof isSmartStoreItem>[0]) === isSmartStoreItem(rawTarget as Parameters<typeof isSmartStoreItem>[0]);
}
export function itemEditorGraphProjection(kind: ItemEditorGraphPart, rows: readonly ItemEditorDocument[], adapter?: Pick<CatalogValueAdapter, 'special'>): CatalogValue {
    const ordered = kind === 'items' ? [...rows.filter(row => row.data.type === 'product'), ...rows.filter(row => row.data.type !== 'product')] : rows;
    const fields = kind === 'items' ? ITEM_FIELDS : kind === 'boms' ? BOM_FIELDS : kind === 'formulas' ? FORMULA_FIELDS : null;
    return encodeCatalogValue(ordered.map(row => ({ documentId: row.id, data: fields ? own(row.data, fields) : row.data })), adapter);
}
export const serializeItemEditorGraphPart = (kind: ItemEditorGraphPart, rows: readonly ItemEditorDocument[], adapter?: Pick<CatalogValueAdapter, 'special'>): string => JSON.stringify(itemEditorGraphProjection(kind, rows, adapter));
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
    if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key)))
        throw Error('품목 저장 요청 형식을 확인해 주세요.');
}
export function normalizeItemEditorReference(value: unknown): ItemEditorReference {
    exact(value, ['companyId', 'planId', 'targetId']);
    if (!['taebaek', 'punghoe'].includes(String(value.companyId)) || !cleanupValidId(value.planId) || !itemEditorDocumentId(value.targetId))
        throw Error('품목 저장의 회사·계획·대상을 확인해 주세요.');
    return { companyId: value.companyId as ItemEditorReference['companyId'], planId: value.planId, targetId: value.targetId };
}
const hashOk = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function json(value: unknown): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))
        return value;
    if (Array.isArray(value))
        return value.map(json);
    if (isRecord(value))
        return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, json(value[key])]));
    throw Error('품목 저장 입력에 올바르지 않은 값이 있습니다.');
}
export function normalizeItemEditorRequest(value: unknown): ItemEditorRequest {
    exact(value, ['version', 'companyId', 'planId', 'targetId', 'graph', 'targetExpected', 'draft', 'purchaseNoticeHash']);
    const reference = normalizeItemEditorReference({ companyId: value.companyId, planId: value.planId, targetId: value.targetId });
    if (value.version !== 1)
        throw Error('품목 저장 계약 버전을 확인해 주세요.');
    exact(value.graph, ['schemaVersion', ...ITEM_EDITOR_GRAPH_PARTS]);
    if (value.graph.schemaVersion !== 1)
        throw Error('품목 계산 자료의 계약 버전을 확인해 주세요.');
    const graph = { schemaVersion: 1 } as ItemEditorGraphEvidence;
    for (const part of ITEM_EDITOR_GRAPH_PARTS) {
        const stamp = value.graph[part];
        exact(stamp, ['count', 'digest']);
        if (!Number.isSafeInteger(stamp.count) || (stamp.count as number) < 0 || !hashOk(stamp.digest))
            throw Error('품목 계산 자료의 개수·해시를 확인해 주세요.');
        graph[part] = { count: stamp.count as number, digest: stamp.digest };
    }
    exact(value.draft, ['isNew', 'metadata', 'bomDraft', 'formulaRows', 'inPartnerIds', 'photoChanged']);
    const raw = value.draft;
    if (typeof raw.isNew !== 'boolean' || typeof raw.photoChanged !== 'boolean' || !Array.isArray(raw.inPartnerIds) || raw.inPartnerIds.some(id => !itemEditorDocumentId(id)) || new Set(raw.inPartnerIds).size !== raw.inPartnerIds.length)
        throw Error('품목 저장 유형·거래처를 확인해 주세요.');
    exact(raw.metadata, ITEM_EDITOR_METADATA_FIELDS);
    const metadata = json(raw.metadata) as Record<string, unknown>;
    if (typeof metadata.name !== 'string' || !metadata.name.trim() || typeof metadata.type !== 'string' || !metadata.type.trim())
        throw Error('품목 이름과 유형을 확인해 주세요.');
    for (const field of ['cost', 'minStock'])
        if (metadata[field] !== undefined && (typeof metadata[field] !== 'number' || !Number.isFinite(metadata[field]) || (metadata[field] as number) < 0))
            throw Error('품목 원가·최소재고를 확인해 주세요.');
    for (const field of ['isSmartStore', 'phantom', 'unpackable'])
        if (metadata[field] !== undefined && typeof metadata[field] !== 'boolean')
            throw Error('품목 선택 값을 확인해 주세요.');
    for (const field of ['category', 'subtype', 'unit', 'image', 'imagePath', 'freightType', 'spec', '품목'])
        if (metadata[field] !== undefined && typeof metadata[field] !== 'string')
            throw Error('품목 분류·규격·사진 입력을 확인해 주세요.');
    if (metadata.costSource !== undefined && !['manual', 'rollup'].includes(String(metadata.costSource)))
        throw Error('원가 입력 방식을 확인해 주세요.');
    const draft: ItemEditorDraft = { isNew: raw.isNew, metadata, inPartnerIds: [...raw.inPartnerIds] as string[], photoChanged: raw.photoChanged };
    if (raw.bomDraft !== undefined) {
        if (!Array.isArray(raw.bomDraft))
            throw Error('구성품 초안을 확인해 주세요.');
        draft.bomDraft = raw.bomDraft.map(row => { exact(row, ['childId', 'qty']); if (!itemEditorDocumentId(row.childId) || typeof row.qty !== 'number' || !Number.isFinite(row.qty))
            throw Error('구성품 수량을 확인해 주세요.'); return { childId: row.childId, qty: row.qty }; });
    }
    if (raw.formulaRows !== undefined) {
        if (!Array.isArray(raw.formulaRows))
            throw Error('배합 초안을 확인해 주세요.');
        draft.formulaRows = raw.formulaRows.map(row => { exact(row, ['child_name', 'yield_pct']); if (typeof row.child_name !== 'string' || typeof row.yield_pct !== 'number' || !Number.isFinite(row.yield_pct))
            throw Error('배합 이름·수율을 확인해 주세요.'); return { child_name: row.child_name, yield_pct: row.yield_pct }; });
    }
    if (raw.isNew ? value.targetExpected !== null : !Array.isArray(value.targetExpected) || value.targetExpected[0] !== 'map')
        throw Error('품목을 열 때 확인한 원문을 보존해 주세요.');
    if (value.purchaseNoticeHash !== undefined && !hashOk(value.purchaseNoticeHash))
        throw Error('낱개 연결 안내 확인 근거를 확인해 주세요.');
    const result: ItemEditorRequest = { version: 1, ...reference, graph, targetExpected: value.targetExpected === null ? null : json(value.targetExpected) as CatalogValue, draft, ...(value.purchaseNoticeHash ? { purchaseNoticeHash: value.purchaseNoticeHash as string } : {}) };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 256 * 1024)
        throw Error('품목 편집 초안이 너무 큽니다.');
    return result;
}
export const serializeItemEditorRequest = (value: unknown): string => JSON.stringify(normalizeItemEditorRequest(value));
export function normalizeItemEditorResult(value: unknown, reference: ItemEditorReference, actorUid: string, expectedHash?: string): ItemEditorResult {
    exact(value, ['companyId', 'planId', 'targetId', 'actorUid', 'requestHash', 'status', 'confirmedStageIds', 'message']);
    if (value.companyId !== reference.companyId || value.planId !== reference.planId || value.targetId !== reference.targetId || value.actorUid !== actorUid || !['active', 'completed', 'cancelled', 'rejected', 'unknown'].includes(String(value.status)) || typeof value.message !== 'string' || !Array.isArray(value.confirmedStageIds) || value.confirmedStageIds.some((stage, index) => stage !== ITEM_EDITOR_STAGES[index]) || value.confirmedStageIds.length > ITEM_EDITOR_STAGES.length)
        throw Error('품목 저장 결과의 회사·계정·단계를 확인해 주세요.');
    if (!(value.requestHash === null || hashOk(value.requestHash)) || value.requestHash === null && (!['unknown', 'cancelled'].includes(String(value.status)) || value.confirmedStageIds.length > 0) || value.status === 'unknown' && (value.requestHash !== null || value.confirmedStageIds.length > 0) || value.status === 'completed' && value.confirmedStageIds.length !== 5 || value.status === 'active' && (!value.confirmedStageIds.length || value.confirmedStageIds.length === 5) || value.status !== 'completed' && value.confirmedStageIds.length === 5 || expectedHash !== undefined && value.requestHash !== null && value.requestHash !== expectedHash)
        throw Error('품목 저장 최초 원문과 확인된 단계가 다릅니다.');
    return { ...reference, actorUid, requestHash: value.requestHash as string | null, status: value.status as ItemEditorResult['status'], confirmedStageIds: [...value.confirmedStageIds] as ItemEditorStage[], message: value.message };
}
