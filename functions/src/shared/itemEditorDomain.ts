import { unpackStockComponent, type StockComponent } from './stockUnitMeasure';
import { buildCostFn } from './bomCost';
import { buildFormula, formulaRowsOf } from './itemFormula';
import { baseRawName } from './formula';
import type { ItemEditorGraphDocuments, ItemEditorDraft, ItemEditorRequest, ItemEditorStage, ItemEditorDocument } from './itemEditorCommand';
export interface EditorItem {
    id: string;
    name: string;
    type: string;
    companyId?: string;
    품목?: string;
    spec?: string;
    cost?: number;
    costSource?: 'manual' | 'rollup';
    phantom?: boolean;
    archived?: boolean;
}
export interface EditorFormula {
    id: string;
    companyId?: string;
    parent_key: string;
    child_name: string;
    ratio?: number;
    yield_rate?: number;
}
export interface EditorBom {
    id: string;
    companyId?: string;
    parent_id: string;
    child_id: string;
    quantity?: number;
}
export const isSmartStoreItem = (item: {
    isSmartStore?: boolean;
    partnerIds?: readonly string[];
} | undefined): boolean => item?.isSmartStore === true || (item?.partnerIds ?? []).includes('SMARTSTORE');
export function assertItemEditorTombstone(data: Record<string, any> | undefined, companyId: string, itemId: string): void {
    if (data?.mergedIntoItemId !== undefined)
        throw Error('통합된 품목은 다시 만들 수 없습니다. 남긴 품목을 선택해 주세요.');
    if (data && (data.companyId !== companyId || data.itemId !== itemId || data.inventoryWriterProtocolVersion !== 1 || !Number.isSafeInteger(data.deletionRevision) || data.deletionRevision < 1 || !Number.isSafeInteger(data.lastDeletedItemRevision) || data.lastDeletedItemRevision < 0 || data.beforeRevision !== data.lastDeletedItemRevision))
        throw Error('품목 삭제의 회사·버전 기록이 다릅니다.');
}
export function specBase(spec?: string): string {
    return String(spec ?? '').replace(/\s*[*x×].*$/i, '').trim();
}
export function boxSpecOf(looseSpec: string | undefined, count: number): string {
    const base = specBase(looseSpec);
    if (!base)
        return '';
    return count > 1 ? `${base} * ${count}` : base;
}
export function editorBoxSiblings<T extends {
    id: string;
    archived?: boolean;
}>(loose: {
    id: string;
}, all: readonly T[], parents: readonly {
    parentId: string;
}[], components: (id: string) => readonly StockComponent[]): {
    item: T;
    count: number;
}[] {
    const byId = new Map(all.map(item => [item.id, item]));
    const hits = new Map<string, {
        item: T;
        count: number;
    }>();
    for (const { parentId } of parents) {
        const item = byId.get(parentId);
        if (!item || item.archived)
            continue;
        const unpacked = unpackStockComponent(components(item.id));
        if (unpacked && unpacked.count > 1 && unpacked.itemId === loose.id)
            hits.set(parentId, { item, count: unpacked.count });
    }
    return [...hits.values()].sort((a, b) => a.count - b.count);
}
export function boxSpecUpdatesForSiblings(loose: {
    spec?: string;
}, siblings: readonly {
    item: {
        id: string;
        name?: string;
        spec?: string;
    };
    count: number;
}[]): {
    id: string;
    name?: string;
    from?: string;
    spec: string;
}[] {
    const out: {
        id: string;
        name?: string;
        from?: string;
        spec: string;
    }[] = [];
    for (const { item, count } of siblings) {
        const want = boxSpecOf(loose.spec, count);
        if (!want || String(item.spec ?? '').trim() === want)
            continue;
        out.push({ id: item.id, name: item.name, from: item.spec, spec: want });
    }
    return out;
}
export interface ItemEditorPurchaseNotice {
    boxItemId: string;
    looseItemId: string;
    partnerId: string;
    direction: 'in';
    count: number;
    boxName: string;
    looseName: string;
    loosePrice?: number;
    taxType?: unknown;
}
function businessRow(row: ItemEditorDocument): Record<string, unknown> { return { id: row.id, ...row.data }; }
function stockComponents(graph: ItemEditorGraphDocuments, parentId: string): StockComponent[] {
    return graph.boms.filter(row => row.data.parent_id === parentId).map(row => ({ childId: String(row.data.child_id), qty: typeof row.data.quantity === 'number' ? row.data.quantity : 1, child: graph.items.find(item => businessRow(item).id === row.data.child_id)?.data as {
            type?: string;
        } | undefined }));
}
export function buildPurchaseNotices(graph: ItemEditorGraphDocuments, draft: ItemEditorDraft, targetId: string): ItemEditorPurchaseNotice[] {
    // 연결은 품목·구성을 저장한 뒤 실행되므로 확인 문구도 같은 새 구성을 본다.
    graph = cloneGraph(graph);
    const targetIndex = graph.items.findIndex(row => row.id === targetId);
    const targetData = { ...(targetIndex >= 0 ? graph.items[targetIndex].data : {}), ...draft.metadata };
    if (targetIndex >= 0)
        graph.items[targetIndex] = { id: targetId, data: targetData };
    else
        graph.items.push({ id: targetId, data: targetData });
    if (draft.bomDraft !== undefined) {
        const next = new Map(draft.bomDraft.map(line => [line.childId, line]));
        graph.boms = [...graph.boms.filter(row => row.data.parent_id !== targetId), ...[...next.values()].map(line => ({ id: `notice-${targetId}-${line.childId}`, data: { parent_id: targetId, child_id: line.childId, quantity: line.qty } }))];
    }
    const notices: ItemEditorPurchaseNotice[] = [], virtual = graph.links.map(row => ({ ...row, data: { ...row.data } }));
    const visit = (itemId: string, partnerId: string, price: unknown, taxType: unknown, depth: number) => {
        if (depth > 40)
            throw Error('박스·낱개 연결이 너무 깊습니다. 구성을 확인해 주세요.');
        if (!virtual.some(row => row.data.itemId === itemId && row.data.partnerId === partnerId && row.data.Direction === 'in'))
            virtual.push({ id: `${itemId}_${partnerId}_in`, data: { itemId, partnerId, Direction: 'in' } });
        const target = graph.items.find(row => businessRow(row).id === itemId), unpacked = target ? unpackStockComponent(stockComponents(graph, itemId)) : null;
        if (!target || !unpacked || virtual.some(row => row.data.itemId === unpacked.itemId && row.data.partnerId === partnerId && (row.data.Direction ?? 'out') === 'in'))
            return;
        const notice: ItemEditorPurchaseNotice = { boxItemId: itemId, looseItemId: unpacked.itemId, partnerId, direction: 'in', count: unpacked.count, boxName: String(target.data.name ?? ''), looseName: String(graph.items.find(row => businessRow(row).id === unpacked.itemId)?.data.name ?? unpacked.itemId), ...(typeof price === 'number' && price > 0 ? { loosePrice: Math.round(price / unpacked.count) } : {}), ...(taxType !== undefined ? { taxType } : {}) };
        notices.push(notice);
        visit(unpacked.itemId, partnerId, notice.loosePrice, taxType, depth + 1);
    };
    for (const partnerId of draft.inPartnerIds) {
        const existing = graph.links.find(row => row.data.itemId === targetId && row.data.partnerId === partnerId && row.data.Direction === 'in');
        visit(targetId, partnerId, existing?.data.price, existing?.data.taxType, 0);
    }
    return notices;
}
export function itemEditorPurchaseNoticeText(companyId: string, targetId: string, graph: ItemEditorGraphDocuments, draft: ItemEditorDraft): string | null {
    const notices = buildPurchaseNotices(graph, draft, targetId);
    return notices.length ? JSON.stringify({ version: 1, companyId, targetId, notices }) : null;
}
export function itemEditorPurchaseNoticeMessage(notices: readonly ItemEditorPurchaseNotice[]): string {
    return notices.map(notice => `"${notice.boxName}"은(는) 박스 품목입니다.\n낱개 품목 "${notice.looseName}"이(가) 이 거래처에 없어 함께 등록합니다.`).join('\n\n');
}
export interface ItemEditorOperation {
    collection: 'items' | 'item_bom' | 'item_formula' | 'partner_item';
    id: string;
    kind: 'create' | 'update' | 'set' | 'delete';
    data?: Record<string, unknown>;
    unset?: string[];
    removeSmartStoreMarker?: boolean;
}
export interface ItemEditorDomainPlan {
    stages: Record<ItemEditorStage, ItemEditorOperation[]>;
    after: Record<ItemEditorStage, ItemEditorGraphDocuments>;
    purchaseNotices: ItemEditorPurchaseNotice[];
    committedItems: EditorItem[];
    committedBoms: EditorBom[];
}
function assertBinding(row: ItemEditorDocument): void {
    if (Object.prototype.hasOwnProperty.call(row.data, 'id') && row.data.id !== row.id)
        throw Error('선택한 자료의 문서 번호와 저장된 번호가 다릅니다. 해당 자료를 확인해 주세요.');
}
function selectedItem(graph: ItemEditorGraphDocuments, businessId: string): ItemEditorDocument {
    const row = graph.items.find(item => businessRow(item).id === businessId);
    if (!row)
        throw Error('현재 회사에 속한 구성품을 확인해 주세요.');
    assertBinding(row);
    return row;
}
function cloneGraph(graph: ItemEditorGraphDocuments): ItemEditorGraphDocuments {
    return { items: graph.items.map(row => ({ ...row, data: { ...row.data } })), boms: graph.boms.map(row => ({ ...row, data: { ...row.data } })), formulas: graph.formulas.map(row => ({ ...row, data: { ...row.data } })), links: graph.links.map(row => ({ ...row, data: { ...row.data } })) };
}
const partOf = (collection: ItemEditorOperation['collection']): keyof ItemEditorGraphDocuments => ({ items: 'items', item_bom: 'boms', item_formula: 'formulas', partner_item: 'links' } as const)[collection];
/** 새 문서는 실제 기본 query 순서에 들어간다. 원가 계산용 최초 배열은 별도로 보존한다. */
function documentOrder(a: ItemEditorDocument, b: ItemEditorDocument): number {
    const left = new TextEncoder().encode(a.id), right = new TextEncoder().encode(b.id);
    for (let i = 0; i < Math.min(left.length, right.length); i++)
        if (left[i] !== right[i])
            return left[i] - right[i];
    return left.length - right.length;
}
export function applyItemEditorOperations(graph: ItemEditorGraphDocuments, ops: readonly ItemEditorOperation[]): ItemEditorGraphDocuments {
    const next = cloneGraph(graph);
    for (const op of ops) {
        const part = partOf(op.collection), index = next[part].findIndex(row => row.id === op.id), previous = index < 0 ? undefined : next[part][index];
        if (op.kind === 'delete') {
            if (index >= 0)
                next[part].splice(index, 1);
            continue;
        }
        if (op.kind === 'update' && !previous)
            throw Error('수정할 자료가 없어 다시 만들지 않았습니다.');
        if (op.kind === 'create' && previous)
            throw Error('같은 번호의 품목이 이미 있습니다.');
        const data = op.kind === 'update' ? { ...previous!.data, ...op.data } : { ...op.data };
        for (const field of op.unset ?? [])
            delete data[field];
        if (op.removeSmartStoreMarker && Array.isArray(data.partnerIds))
            data.partnerIds = data.partnerIds.filter(value => value !== 'SMARTSTORE');
        const row = { id: op.id, data };
        if (index < 0)
            next[part].push(row);
        else
            next[part][index] = row;
    }
    for (const part of ['items', 'boms', 'formulas', 'links'] as const)
        next[part].sort(documentOrder);
    return next;
}
function uniqueOps(ops: ItemEditorOperation[]): ItemEditorOperation[] {
    const map = new Map<string, ItemEditorOperation>();
    for (const op of ops) {
        const key = op.collection + '/' + op.id, prior = map.get(key);
        if (prior && prior.kind === 'update' && op.kind === 'update')
            map.set(key, { ...op, data: { ...prior.data, ...op.data }, unset: [...new Set([...(prior.unset ?? []), ...(op.unset ?? [])])], ...(prior.removeSmartStoreMarker || op.removeSmartStoreMarker ? { removeSmartStoreMarker: true } : {}) });
        else
            map.set(key, op);
    }
    return [...map.values()];
}
function costs(items: EditorItem[], boms: EditorBom[], formulas: EditorFormula[], graph: ItemEditorGraphDocuments): ItemEditorOperation[] {
    const roll = buildCostFn({ allItems: items, itemBoms: boms, formulaOf: key => buildFormula(key, formulas, items), formulaRowsOf: key => formulaRowsOf(key, formulas) });
    return items.map(item => ({ item, value: Math.round(roll(item)) })).filter(({ item, value }) => value > 0 && Math.abs(value - (item.cost ?? 0)) > 0.5).map(({ item, value }) => {
        const row = selectedItem(graph, item.id);
        return { collection: 'items', id: row.id, kind: 'update', data: { cost: value } };
    });
}
/** 요청의 임의 patch가 아니라 같은 업무 정본으로 모든 단계의 유한 쓰기 계획을 미리 만든다. */
export function buildItemEditorPlan(graph: ItemEditorGraphDocuments, request: ItemEditorRequest): ItemEditorDomainPlan {
    const { draft, targetId, companyId } = request;
    const target = graph.items.find(row => row.id === targetId);
    if (draft.isNew ? !!target : !target)
        throw Error(draft.isNew ? '같은 번호의 품목이 이미 있습니다.' : '수정할 품목이 없어 다시 만들지 않았습니다.');
    if (target)
        assertBinding(target);
    if (target && (target.data.type === 'service') !== (draft.metadata.type === 'service'))
        throw Error('기존 실물 품목과 비재고·용역 유형 사이에서는 변경할 수 없습니다.');
    const metadata = { ...draft.metadata };
    // 자동 원가는 화면이 보내는 숫자를 신뢰하지 않고 아래 동일 원가 정본에서 계산한다.
    if (metadata.costSource !== 'manual')
        delete metadata.cost;
    if (!draft.photoChanged) {
        delete metadata.image;
        delete metadata.imagePath;
    }
    if (metadata.type === 'service') {
        metadata.cost = 0;
        metadata.costSource = 'manual';
    }
    const primary: ItemEditorOperation[] = [{ collection: 'items', id: targetId, kind: draft.isNew ? 'create' : 'update', data: { ...metadata, companyId, ...(draft.isNew ? { stock: 0 } : {}) }, ...(target?.data.type === 'product' && typeof metadata.isSmartStore === 'boolean' && Array.isArray(target.data.partnerIds) && target.data.partnerIds.every(value => typeof value === 'string') && target.data.partnerIds.includes('SMARTSTORE') ? { removeSmartStoreMarker: true } : {}) }];
    const baseItems = [...graph.items.filter(row => row.data.type === 'product'), ...graph.items.filter(row => row.data.type !== 'product')].map(row => businessRow(row) as unknown as EditorItem);
    const originalBoms = graph.boms.map(row => businessRow(row) as unknown as EditorBom);
    const formulas = graph.formulas.map(row => businessRow(row) as unknown as EditorFormula);
    if (target) {
        const parents = graph.boms.filter(row => row.data.child_id === targetId).map(row => ({ parentId: String(row.data.parent_id) }));
        const siblings = editorBoxSiblings({ id: targetId }, baseItems, parents, id => stockComponents(graph, id));
        for (const update of boxSpecUpdatesForSiblings(metadata as {
            spec?: string;
        }, siblings))
            primary.push({ collection: 'items', id: selectedItem(graph, update.id).id, kind: 'update', data: { spec: update.spec } });
    }
    let committedBoms = originalBoms;
    if (draft.bomDraft !== undefined) {
        const next = new Map<string, Record<string, unknown>>();
        for (const line of draft.bomDraft) {
            selectedItem(graph, line.childId);
            const id = ('bom-' + targetId + '__' + line.childId).replace(/[/#$[\].]/g, '_');
            next.set(id, { companyId, parent_id: targetId, child_id: line.childId, quantity: line.qty });
        }
        for (const previous of graph.boms.filter(row => row.data.parent_id === targetId)) {
            assertBinding(previous);
            if (!next.has(previous.id))
                primary.push({ collection: 'item_bom', id: previous.id, kind: 'delete' });
        }
        for (const [id, data] of next) {
            const previous = graph.boms.find(row => row.id === id);
            if (previous)
                assertBinding(previous);
            primary.push({ collection: 'item_bom', id, kind: 'set', data });
        }
        committedBoms = [...originalBoms.filter(row => row.parent_id !== targetId), ...[...next].map(([id, data]) => ({ id, ...data } as unknown as EditorBom))];
    }
    const primaryOps = uniqueOps(primary);
    // 4차에서 ACK한 품목·규격·BOM 사본을 두 원가 단계가 함께 쓴다. 옛 allItems로 돌아가지 않는다.
    const byId = new Map(baseItems.map(item => [item.id, item]));
    for (const op of primaryOps)
        if (op.collection === 'items' && op.kind !== 'delete')
            byId.set(op.id, { ...(byId.get(op.id) ?? {}), ...op.data, id: op.id } as unknown as EditorItem);
    const committedItems = [...byId.values()];
    if (metadata.costSource !== 'manual' && metadata.type !== 'service') {
        const roll = buildCostFn({ allItems: committedItems, itemBoms: committedBoms, formulaOf: key => buildFormula(key, formulas, committedItems), formulaRowsOf: key => formulaRowsOf(key, formulas) });
        const edited = committedItems.find(item => item.id === targetId)!;
        const value = Math.round(roll(edited));
        if (value > 0) {
            edited.cost = value;
            primaryOps[0].data = { ...primaryOps[0].data, cost: value };
        }
    }
    const stages = {} as Record<ItemEditorStage, ItemEditorOperation[]>, after = {} as Record<ItemEditorStage, ItemEditorGraphDocuments>;
    let virtual = graph;
    const put = (stage: ItemEditorStage, ops: ItemEditorOperation[]) => { const normalized = uniqueOps(ops); if (normalized.length > 499)
        throw Error(itemEditorStageName(stage) + ' 단계가 한 거래의 499개 업무 쓰기 한도를 넘습니다. 대상이나 연결을 나누어 확인해 주세요.'); stages[stage] = normalized; virtual = applyItemEditorOperations(virtual, normalized); after[stage] = virtual; };
    put('primary', primaryOps);
    put('bom-cost', draft.bomDraft !== undefined ? costs(committedItems, committedBoms, formulas, virtual) : []);
    let nextFormulas = formulas;
    const formulaOps: ItemEditorOperation[] = [];
    if (['raw', 'wip'].includes(String(metadata.type)) && draft.formulaRows !== undefined) {
        const key = baseRawName(String(metadata.name)), oldKey = target ? baseRawName(String(target.data.name ?? '')) : undefined;
        const keys = new Set([key, oldKey].filter(Boolean));
        for (const row of graph.formulas.filter(row => keys.has(String(row.data.parent_key)))) {
            assertBinding(row);
            formulaOps.push({ collection: 'item_formula', id: row.id, kind: 'delete' });
        }
        const rows = draft.formulaRows.filter(row => row.child_name).map(row => ({ id: `formula-${key}-${row.child_name}`.replace(/\s/g, '_'), companyId, parent_key: key, child_name: row.child_name, ratio: 1, yield_rate: (row.yield_pct || 0) / 100 }));
        if (new Set(rows.map(row => row.id)).size !== rows.length)
            throw Error('같은 배합 원료가 중복되었습니다. 배합 초안을 확인해 주세요.');
        for (const { id, ...data } of rows) {
            const previous = graph.formulas.find(row => row.id === id);
            if (previous)
                assertBinding(previous);
            formulaOps.push({ collection: 'item_formula', id, kind: 'set', data });
        }
        nextFormulas = [...formulas.filter(row => !keys.has(row.parent_key)), ...rows];
    }
    put('formula', formulaOps);
    put('formula-cost', draft.formulaRows !== undefined && ['raw', 'wip'].includes(String(metadata.type)) ? costs(committedItems, committedBoms, nextFormulas, virtual) : []);
    const linkOps: ItemEditorOperation[] = [];
    const purchaseNotices = buildPurchaseNotices(graph, draft, targetId);
    const previousIn = graph.links.filter(row => row.data.itemId === targetId && row.data.Direction === 'in');
    const mergeLink = (id: string, fields: Record<string, unknown>, existing?: ItemEditorDocument) => {
        existing ??= virtual.links.find(row => row.id === id);
        if (existing)
            assertBinding(existing);
        const unset: string[] = [];
        if (fields.taxType === null) {
            delete fields.taxType;
            unset.push('taxType');
        }
        linkOps.push({ collection: 'partner_item', id, kind: existing ? 'update' : 'create', data: { ...fields, companyId }, ...(unset.length ? { unset } : {}) });
    };
    for (const partnerId of draft.inPartnerIds) {
        const existing = previousIn.find(row => row.data.partnerId === partnerId);
        const id = existing?.id ?? `${targetId}_${partnerId}_in`;
        mergeLink(id, { itemId: targetId, partnerId, Direction: 'in', ...(existing?.data.price !== undefined ? { price: existing.data.price } : {}), ...(existing?.data.taxType !== undefined ? { taxType: existing.data.taxType } : {}) }, existing);
        for (const notice of purchaseNotices.filter(row => row.partnerId === partnerId)) {
            selectedItem(graph, notice.looseItemId);
            const looseId = `${notice.looseItemId}_${partnerId}_in`, prior = virtual.links.find(row => row.id === looseId);
            mergeLink(looseId, { itemId: notice.looseItemId, partnerId, Direction: 'in', ...(notice.loosePrice !== undefined ? { price: notice.loosePrice } : {}), ...(notice.taxType !== undefined ? { taxType: notice.taxType } : {}) }, prior);
        }
    }
    for (const row of previousIn)
        if (typeof row.data.partnerId === 'string' && !draft.inPartnerIds.includes(row.data.partnerId)) {
            assertBinding(row);
            linkOps.push({ collection: 'partner_item', id: row.id, kind: 'delete' });
        }
    put('purchase-links', linkOps);
    return { stages, after, purchaseNotices, committedItems, committedBoms };
}
function itemEditorStageName(stage: ItemEditorStage): string { return { 'primary': '품목·구성품', 'bom-cost': '구성품 원가', 'formula': '배합', 'formula-cost': '배합 원가', 'purchase-links': '매입 연결' }[stage]; }
