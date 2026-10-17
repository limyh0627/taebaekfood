import { cleanupValidId, type CleanupCompany } from './partnerItemCleanup';

export const MAX_MERGE_DONORS = 20;
export const MAX_MERGE_WRITES = 400;
export const CATALOG_MERGE_BLOCKING_STATUSES = ['PENDING', 'PROCESSING', 'DISPATCHED', 'SHIPPED', 'ON_HOLD'] as const;
export interface CatalogItemMergeReference { version: 1; companyId: CleanupCompany; operationId: string }
export interface CatalogItemMergeResolution { destinationKey: string; sourceLinkId: string }
export interface CatalogItemMergeRequest extends CatalogItemMergeReference { releaseId: string; keepId: string; donorIds: string[]; snapshotDigest: string; resolutions: CatalogItemMergeResolution[] }
export interface CatalogItemMergeDoc { id: string; version: string; data: Record<string, unknown> }
export interface CatalogItemMergeSnapshot { companyId: CleanupCompany; keepId: string; donorIds: string[]; items: CatalogItemMergeDoc[]; links: CatalogItemMergeDoc[]; boms: CatalogItemMergeDoc[]; packs: CatalogItemMergeDoc[]; activeOrders: CatalogItemMergeDoc[]; rawInventories: CatalogItemMergeDoc[]; purchaseUnits: CatalogItemMergeDoc[]; purchaseOrders: CatalogItemMergeDoc[]; returnRequests: CatalogItemMergeDoc[]; coverage: { complete: boolean; reason?: string; estimatedWriteCount: number } }
export interface CatalogItemMergeBlocker { code: string; itemId: string; documentIds: string[]; message: string; nextAction: 'review-item' | 'review-inventory' | 'review-orders' | 'review-bom' | 'reload' }
export interface CatalogItemMergeGroup { destinationKey: string; partnerId: string; direction: 'in' | 'out'; destinationLinkId: string | null; candidateLinkIds: string[]; existingKeepLinkId: string | null; selectedSourceLinkId: string | null; differingFields: string[] }
export interface CatalogItemMergePlan { phase: 'ready' | 'needs-resolution' | 'blocked'; keepId: string; donorIds: string[]; groups: CatalogItemMergeGroup[]; blockers: CatalogItemMergeBlocker[]; deleteLinkIds: string[]; deleteOwnBomIds: string[]; deletePackIds: string[] }
export interface CatalogItemMergeCandidateLink { id: string; itemId: string; itemName: string; partnerId: string; partnerName: string | null; direction: 'in' | 'out'; business: Record<string, unknown> }
export interface CatalogItemMergePreview { companyId: CleanupCompany; releaseId: string | null; snapshotDigest: string; plan: CatalogItemMergePlan; candidateLinks: CatalogItemMergeCandidateLink[] }
export interface CatalogOrderProofRequest { companyId: CleanupCompany; orderId: string; items: unknown[] }
export interface CatalogOrderProofResult { proofId: string | null; catalogRevision: number }
export interface CatalogItemMergeResult extends CatalogItemMergeReference { actorUid: string; status: 'applied' | 'rejected' | 'discarded' | 'unknown'; requestText: string | null; requestHash: string | null; opaqueFence: boolean; errorCode: string | null; message: string; summary?: Record<string, unknown> }
export type CatalogItemMergeCommand = { mode: 'read'; companyId: CleanupCompany; keepId: string; donorIds: string[] } | { mode: 'apply'; request: CatalogItemMergeRequest } | { mode: 'inspect-request' | 'discard-request'; request?: CatalogItemMergeRequest; reference?: CatalogItemMergeReference };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const versionOk = (value: unknown) => typeof value === 'string' && /^\d+:\d{9}$/.test(value);
const companyOk = (value: unknown): value is CleanupCompany => value === 'taebaek' || value === 'punghoe';
const ownKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const donorIdsOf = (value: unknown, keepId: string): string[] => {
  if (!Array.isArray(value) || !value.length || value.length > MAX_MERGE_DONORS || !value.every(cleanupValidId) || value.includes(keepId) || new Set(value).size !== value.length) throw Error('남길 품목과 통합할 품목 번호를 다시 확인하세요.');
  return [...value].sort();
};
function resolutionsOf(value: unknown): CatalogItemMergeResolution[] {
  if (!Array.isArray(value) || value.length > MAX_MERGE_WRITES) throw Error('연결 선택 내용을 다시 확인하세요.');
  const rows = value.map(row => {
    if (!object(row) || !ownKeys(row, ['destinationKey', 'sourceLinkId']) || !cleanupValidId(row.sourceLinkId) || typeof row.destinationKey !== 'string') throw Error('연결 선택 내용을 다시 확인하세요.');
    let parts: unknown; try { parts = JSON.parse(row.destinationKey); } catch { throw Error('연결 대상 번호를 확인하세요.'); }
    if (!Array.isArray(parts) || parts.length !== 2 || !cleanupValidId(parts[0]) || !['in', 'out'].includes(parts[1]) || JSON.stringify(parts) !== row.destinationKey) throw Error('연결 대상 번호를 확인하세요.');
    return { destinationKey: row.destinationKey, sourceLinkId: row.sourceLinkId };
  });
  if (new Set(rows.map(row => row.destinationKey)).size !== rows.length) throw Error('같은 연결에 선택이 중복됐습니다.');
  return rows.sort((a, b) => a.destinationKey.localeCompare(b.destinationKey));
}
export function normalizeCatalogItemMergeReference(value: unknown): CatalogItemMergeReference {
  if (!object(value) || !ownKeys(value, ['version', 'companyId', 'operationId']) || value.version !== 1 || !companyOk(value.companyId) || !cleanupValidId(value.operationId)) throw Error('회사와 작업 번호를 확인하세요.');
  return { version: 1, companyId: value.companyId, operationId: value.operationId };
}
export function normalizeCatalogItemMergeRequest(value: unknown): CatalogItemMergeRequest {
  if (!object(value) || !ownKeys(value, ['version', 'companyId', 'operationId', 'releaseId', 'keepId', 'donorIds', 'snapshotDigest', 'resolutions']) || !cleanupValidId(value.keepId) || !cleanupValidId(value.releaseId) || typeof value.snapshotDigest !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.snapshotDigest)) throw Error('서버 확인 내용과 통합 대상을 다시 확인하세요.');
  return { ...normalizeCatalogItemMergeReference({ version: value.version, companyId: value.companyId, operationId: value.operationId }), releaseId: value.releaseId, keepId: value.keepId, donorIds: donorIdsOf(value.donorIds, value.keepId), snapshotDigest: value.snapshotDigest.toLowerCase(), resolutions: resolutionsOf(value.resolutions) };
}
export const serializeCatalogItemMergeRequest = (request: CatalogItemMergeRequest) => JSON.stringify(normalizeCatalogItemMergeRequest(request));

// 필드를 골라 복사하면 새 업무 필드가 유실되므로 제외할 식별자만 명시한다.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}
const without = (data: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));
const itemCompany = (data: Record<string, unknown>) => data.companyId === undefined ? 'taebaek' : data.companyId;

/** 조회된 원문으로 계획만 만든다. 쓰기 데이터는 선택한 source 문서를 서버가 그대로 사용한다. */
export function buildCatalogItemMergePlan(snapshot: CatalogItemMergeSnapshot, resolutions: CatalogItemMergeResolution[] = []): CatalogItemMergePlan {
  const blockers: CatalogItemMergeBlocker[] = [], groups: CatalogItemMergeGroup[] = [], deleteOwnBomIds: string[] = [], deletePackIds: string[] = [];
  const block = (code: string, itemId: string, documentIds: string[], message: string, nextAction: CatalogItemMergeBlocker['nextAction']) => blockers.push({ code, itemId, documentIds, message, nextAction });
  const keepId = snapshot.keepId;
  let donorIds: string[] = [], choices: CatalogItemMergeResolution[] = [];
  try { if (!companyOk(snapshot.companyId) || !cleanupValidId(keepId)) throw Error(); donorIds = donorIdsOf(snapshot.donorIds, keepId); choices = resolutionsOf(resolutions); } catch { block('invalid-data', keepId, [], '통합 대상이나 연결 선택이 올바르지 않습니다. 다시 조회해 주세요.', 'reload'); }
  const arrays = [snapshot.items, snapshot.links, snapshot.boms, snapshot.packs, snapshot.activeOrders, snapshot.rawInventories, snapshot.purchaseUnits, snapshot.purchaseOrders, snapshot.returnRequests];
  if (arrays.some(rows => !Array.isArray(rows))) block('invalid-data', keepId, [], '서버 조회 자료가 완전하지 않습니다.', 'reload');
  const docs = (rows: CatalogItemMergeDoc[] | undefined) => Array.isArray(rows) ? rows : [];
  for (const rows of arrays) {
    const seen = new Set<string>();
    for (const row of docs(rows)) {
      if (!row || !cleanupValidId(row.id) || !versionOk(row.version) || !object(row.data) || seen.has(row.id)) block('invalid-data', keepId, row?.id ? [row.id] : [], '문서 번호나 버전을 다시 확인해야 합니다.', 'reload');
      if (row) seen.add(row.id);
    }
  }
  const coverage = snapshot.coverage;
  if (!coverage || coverage.complete !== true || !Number.isSafeInteger(coverage.estimatedWriteCount) || coverage.estimatedWriteCount < 0 || coverage.estimatedWriteCount > MAX_MERGE_WRITES) block('capacity', keepId, [], '조회가 끝나지 않았거나 한 번에 처리할 수 있는 범위를 넘었습니다. 대상을 줄이고 다시 조회해 주세요.', 'reload');
  const items = docs(snapshot.items).filter(row => row && object(row.data));
  const donors = new Set(donorIds), targets = new Set([keepId, ...donorIds]);
  const checkLots = (value: unknown, itemId: string, id: string) => {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some(lot => !object(lot) || typeof lot.kgRemaining !== 'number' || !Number.isFinite(lot.kgRemaining) || (Object.prototype.hasOwnProperty.call(lot, 'qtyRemaining') && (typeof lot.qtyRemaining !== 'number' || !Number.isFinite(lot.qtyRemaining))))) { block('invalid-data', itemId, [id], '로트 잔량을 확인할 수 없습니다. 재고 화면에서 확인해 주세요.', 'review-inventory'); return; }
    if (value.some(lot => (lot as Record<string, unknown>).kgRemaining !== 0 || (Object.prototype.hasOwnProperty.call(lot, 'qtyRemaining') && (lot as Record<string, unknown>).qtyRemaining !== 0))) block('active-lots', itemId, [id], '잔량이 있는 로트가 있어 통합할 수 없습니다. 재고를 먼저 정리해 주세요.', 'review-inventory');
  };
  for (const id of targets) {
    const row = items.find(item => item.id === id);
    if (!row) { block('missing', id, [], '대상 품목을 찾을 수 없습니다. 다시 조회해 주세요.', 'review-item'); continue; }
    const d = row.data;
    if (itemCompany(d) !== snapshot.companyId) block('foreign', id, [id], '다른 회사 품목이 포함돼 있습니다.', 'review-item');
    if (d.archived === true) block('archived', id, [id], '이미 보관된 품목입니다. 현재 품목을 다시 선택해 주세요.', 'review-item');
    if (!donors.has(id)) continue;
    const keep = items.find(item => item.id === keepId);
    const compatibility = ['name', 'type', 'category', 'subtype', 'unit', 'spec', 'density', 'rawMaterialName', 'phantom', 'procureType', 'packageType', 'packageKg', 'unpackable'];
    if (keep && compatibility.some(field => Object.prototype.hasOwnProperty.call(d, field) !== Object.prototype.hasOwnProperty.call(keep.data, field) || canonical(d[field]) !== canonical(keep.data[field]))) block('incompatible-item', id, [id, keepId], '이름·분류·단위·규격 등 품목 정보가 다릅니다. 품목 정보를 확인한 뒤 다시 시도해 주세요.', 'review-item');
    if (typeof d.stock !== 'number' || !Number.isFinite(d.stock)) block('invalid-data', id, [id], '재고 수량이 없거나 올바르지 않습니다. 0으로 간주하지 않습니다.', 'review-inventory');
    else if (d.stock !== 0) block('nonzero-stock', id, [id], '통합할 품목에 재고가 남아 있습니다. 재고를 먼저 정리해 주세요.', 'review-inventory');
    checkLots(d.lots, id, id);
    if (d.inventoryReservations !== undefined && (!Array.isArray(d.inventoryReservations) || d.inventoryReservations.length)) block('reservation', id, [id], '주문에 배정 중인 재고가 있습니다. 작업을 마친 뒤 다시 확인해 주세요.', 'review-orders');
    for (const field of ['allocated', 'inventoryAllocations']) if (Object.prototype.hasOwnProperty.call(d, field)) {
      const value = d[field];
      if (!(value === 0 || (Array.isArray(value) && value.length === 0))) block('reservation', id, [id], '이전 재고 배정 값이 남아 있거나 확인되지 않습니다. 주문 배정을 먼저 확인해 주세요.', 'review-orders');
    }
  }
  for (const row of docs(snapshot.rawInventories).filter(row => row && object(row.data))) {
    const d = row.data, id = typeof d.rawItemId === 'string' ? d.rawItemId : '';
    if (!targets.has(id) || row.id !== `${snapshot.companyId}__${id}` || d.companyId !== snapshot.companyId || !Number.isSafeInteger(d.revision) || Number(d.revision) < 0 || typeof d.stockKg !== 'number' || !Number.isFinite(d.stockKg) || !Array.isArray(d.activeLots)) { block('raw-inventory-mismatch', id || keepId, [row.id], '원료 재고 문서의 품목·회사·잔량 근거를 확인해야 합니다.', 'review-inventory'); continue; }
    if (donors.has(id)) { if (d.stockKg !== 0) block('nonzero-stock', id, [row.id], '원료 재고가 남아 있어 통합할 수 없습니다.', 'review-inventory'); checkLots(d.activeLots, id, row.id); }
  }
  for (const row of docs(snapshot.purchaseUnits).filter(row => row && object(row.data))) {
    const d = row.data;
    if (d.companyId !== snapshot.companyId || !cleanupValidId(d.itemId) || typeof d.active !== 'boolean') { block('invalid-data', keepId, [row.id], '매입단위의 회사·품목·사용 상태를 확인할 수 없습니다.', 'review-item'); continue; }
    if (donors.has(d.itemId) && d.active) block('active-purchase-unit', d.itemId, [row.id], '사용 중인 매입단위가 있습니다. 매입단위 관리에서 먼저 확인해 주세요.', 'review-item');
  }
  for (const row of docs(snapshot.purchaseOrders).filter(row => row && object(row.data))) {
    const d = row.data;
    if (itemCompany(d) !== snapshot.companyId) { block('foreign', keepId, [row.id], '다른 회사의 발주가 조회됐습니다.', 'reload'); continue; }
    if (d.status === 'cancelled' || d.oemCancelledAt) continue;
    if (!['pending', 'invoiced', 'received'].includes(String(d.status))) { block('invalid-data', keepId, [row.id], '발주 상태를 확인할 수 없습니다.', 'reload'); continue; }
    if (!['pending', 'invoiced'].includes(String(d.status)) && !['processing', 'failed'].includes(String(d.oemIssueStatus))) continue;
    const ids = [d.itemId, ...(Array.isArray(d.items) ? d.items.filter(object).map(line => line.itemId) : []), ...(Array.isArray(d.oemSent) ? d.oemSent.filter(object).map(line => line.rawItemId) : [])];
    for (const id of donorIds) if (ids.includes(id)) block('active-purchase-order', id, [row.id], '입고 또는 가공 처리 중인 발주에 사용됩니다. 발주를 먼저 확인해 주세요.', 'review-orders');
  }
  for (const row of docs(snapshot.returnRequests).filter(row => row && object(row.data))) {
    const d = row.data;
    if (itemCompany(d) !== snapshot.companyId) { block('foreign', keepId, [row.id], '다른 회사의 반품이 조회됐습니다.', 'reload'); continue; }
    if (d.status !== 'pending') continue;
    if (!Array.isArray(d.items)) { block('invalid-data', keepId, [row.id], '대기 반품의 품목을 확인할 수 없습니다.', 'reload'); continue; }
    for (const id of donorIds) if (d.items.some(line => object(line) && line.itemId === id)) block('pending-return', id, [row.id], '처리 대기 반품에 포함돼 있습니다. 반품을 먼저 확인해 주세요.', 'review-orders');
  }
  for (const row of docs(snapshot.activeOrders).filter(row => row && object(row.data))) {
    const d = row.data;
    if (itemCompany(d) !== snapshot.companyId) { block('foreign', keepId, [row.id], '다른 회사 주문이 조회됐습니다. 다시 조회해 주세요.', 'reload'); continue; }
    if (!Array.isArray(d.items)) { block('invalid-data', keepId, [row.id], '진행 주문의 품목을 확인할 수 없습니다.', 'review-orders'); continue; }
    if (!(CATALOG_MERGE_BLOCKING_STATUSES as readonly string[]).includes(String(d.status))) continue;
    const referenced = new Set<string>();
    const rowsAt = (value: unknown, fields: string[]) => {
      if (value === undefined) return;
      if (!Array.isArray(value) || value.some(line => !object(line))) { block('invalid-data', keepId, [row.id], '진행 주문의 재고 복구 근거를 확인할 수 없습니다.', 'review-orders'); return; }
      for (const line of value as Record<string, unknown>[]) for (const field of fields) if (cleanupValidId(line[field])) referenced.add(line[field] as string);
    };
    const stockSnapshot = (value: unknown) => {
      if (value === undefined) return;
      if (!object(value)) { block('invalid-data', keepId, [row.id], '진행 주문의 재고 스냅샷 형식을 확인해야 합니다.', 'review-orders'); return; }
      rowsAt(value.stockDeltas, ['itemId']); rowsAt(value.bomLines, ['parentItemId', 'childItemId']);
      rowsAt(value.rawConsumedLots, ['rawItemId']); rowsAt(value.productConsumedLots, ['itemId']); rowsAt(value.productProducedLots, ['itemId']);
    };
    rowsAt(d.items, ['itemId']);
    if (d.itemInventory !== undefined && !object(d.itemInventory)) block('invalid-data', keepId, [row.id], '진행 주문의 품목별 재고 근거를 확인해야 합니다.', 'review-orders');
    const states = object(d.itemInventory) ? Object.values(d.itemInventory) : [];
    for (const state of states) {
      if (!object(state) || typeof state.applied !== 'boolean') { block('invalid-data', keepId, [row.id], '진행 주문의 재고 반영 상태를 확인해야 합니다.', 'review-orders'); continue; }
      if (!state.applied) continue;
      if (cleanupValidId(state.itemId)) referenced.add(state.itemId);
      rowsAt(state.rawConsumedLots, ['rawItemId']); rowsAt(state.autoBuilt, ['itemId']); rowsAt(state.producedUnits, ['itemId']); stockSnapshot(state.production);
    }
    rowsAt(d.rawConsumedLots, ['rawItemId']); rowsAt(d.productConsumedLots, ['itemId']); rowsAt(d.autoBuilt, ['itemId']); rowsAt(d.producedUnits, ['itemId']);
    if (object(d.inventorySnapshots)) { stockSnapshot(d.inventorySnapshots.production); stockSnapshot(d.inventorySnapshots.shipment); }
    for (const id of donorIds) if (referenced.has(id)) block('active-order', id, [row.id], '진행 중 주문 또는 재고 복구 근거에 사용된 품목입니다. 주문 작업을 먼저 확인해 주세요.', 'review-orders');
  }
  const boms = docs(snapshot.boms).filter(row => row && object(row.data));
  for (const row of boms) if (itemCompany(row.data) !== snapshot.companyId || !cleanupValidId(row.data.parent_id) || !cleanupValidId(row.data.child_id) || typeof row.data.quantity !== 'number' || !Number.isFinite(row.data.quantity)) block('invalid-data', keepId, [row.id], '배합의 회사·품목·수량을 확인할 수 없습니다.', 'review-bom');
  const bomSignature = (id: string) => boms.filter(row => row.data.parent_id === id).map(row => canonical(without(row.data, ['id', 'companyId', 'parent_id']))).sort();
  for (const id of donorIds) {
    const external = boms.filter(row => row.data.child_id === id && row.data.parent_id !== id);
    if (external.length) block('external-bom', id, external.map(row => row.id), '다른 품목의 배합에 사용 중입니다. 배합을 먼저 확인해 주세요.', 'review-bom');
    const own = boms.filter(row => row.data.parent_id === id);
    if (canonical(bomSignature(id)) !== canonical(bomSignature(keepId))) block('own-bom-mismatch', id, own.map(row => row.id), '남길 품목과 배합 구성이 다릅니다. 배합을 먼저 확인해 주세요.', 'review-bom');
    else deleteOwnBomIds.push(...own.map(row => row.id));
  }
  const packs = docs(snapshot.packs).filter(row => row && object(row.data));
  for (const row of packs) if (row.data.companyId !== snapshot.companyId || !cleanupValidId(row.data.item_id) || !targets.has(row.data.item_id)) block('invalid-data', keepId, [row.id], '포장 구성의 회사·품목을 확인할 수 없습니다. 다시 조회해 주세요.', 'review-item');
  const packSignature = (id: string) => packs.filter(row => row.data.item_id === id).map(row => canonical(without(row.data, ['id', 'companyId', 'item_id']))).sort();
  for (const id of donorIds) {
    const own = packs.filter(row => row.data.item_id === id);
    if (canonical(packSignature(id)) !== canonical(packSignature(keepId))) block('pack-mismatch', id, own.map(row => row.id), '남길 품목과 포장 구성이 다릅니다. 박스 개입수 등 포장 정보를 먼저 확인해 주세요.', 'review-item');
    else deletePackIds.push(...own.map(row => row.id));
  }
  const links = docs(snapshot.links).filter(row => row && object(row.data));
  const relevant = links.filter(row => targets.has(String(row.data.itemId)));
  const buckets = new Map<string, CatalogItemMergeDoc[]>();
  for (const row of relevant) {
    const d = row.data;
    if (d.companyId !== snapshot.companyId) { block('foreign', String(d.itemId), [row.id], '다른 회사의 거래처 연결입니다.', 'review-item'); continue; }
    if (!cleanupValidId(d.partnerId) || !['in', 'out'].includes(String(d.Direction))) { block('invalid-data', String(d.itemId), [row.id], '거래처와 매입·매출 방향을 확인해 주세요.', 'review-item'); continue; }
    const key = JSON.stringify([d.partnerId, d.Direction]); buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  for (const [key, candidates] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
    if (!candidates.some(row => donors.has(String(row.data.itemId)))) continue;
    candidates.sort((a, b) => a.id.localeCompare(b.id));
    const keepLinks = candidates.filter(row => row.data.itemId === keepId), first = candidates[0];
    const partnerId = String(first.data.partnerId), direction = first.data.Direction as 'in' | 'out';
    const destinationLinkId = keepLinks.length === 1 ? keepLinks[0].id : `${keepId}_${partnerId}_${direction}`;
    if (keepLinks.length > 1 || links.some(row => row.id === destinationLinkId && !candidates.includes(row))) block('destination-collision', keepId, [destinationLinkId], '남길 연결 번호가 겹칩니다. 기존 거래처 연결을 먼저 확인해 주세요.', 'review-item');
    const payloads = candidates.map(row => without(row.data, ['id', 'itemId', 'companyId']));
    const fields = [...new Set(payloads.flatMap(data => Object.keys(data)))].sort();
    const differingFields = fields.filter(field => new Set(payloads.map(data => Object.prototype.hasOwnProperty.call(data, field) ? canonical(data[field]) : '__missing__')).size > 1);
    const choice = choices.find(row => row.destinationKey === key);
    if (choice && !candidates.some(row => row.id === choice.sourceLinkId)) block('invalid-data', keepId, [choice.sourceLinkId], '조회된 후보에 없는 연결을 선택했습니다. 다시 조회해 주세요.', 'reload');
    groups.push({ destinationKey: key, partnerId, direction, destinationLinkId, candidateLinkIds: candidates.map(row => row.id), existingKeepLinkId: keepLinks.length === 1 ? keepLinks[0].id : null, selectedSourceLinkId: choice && candidates.some(row => row.id === choice.sourceLinkId) ? choice.sourceLinkId : differingFields.length ? null : (keepLinks[0] ?? first).id, differingFields });
  }
  for (const choice of choices) if (!groups.some(group => group.destinationKey === choice.destinationKey)) block('invalid-data', keepId, [choice.sourceLinkId], '조회 결과에 없는 연결 선택이 있습니다.', 'reload');
  const deleteLinkIds = relevant.filter(row => donors.has(String(row.data.itemId))).map(row => row.id).sort();
  const minimumWrites = donorIds.length * 2 + deleteLinkIds.length + deleteOwnBomIds.length + deletePackIds.length + groups.length + 2;
  if (minimumWrites > MAX_MERGE_WRITES) block('capacity', keepId, [], '한 번에 처리할 문서가 너무 많습니다. 통합 대상을 줄여 주세요.', 'reload');
  return { phase: blockers.length ? 'blocked' : groups.some(group => !group.selectedSourceLinkId) ? 'needs-resolution' : 'ready', keepId, donorIds, groups, blockers, deleteLinkIds, deleteOwnBomIds: [...new Set(deleteOwnBomIds)].sort(), deletePackIds: [...new Set(deletePackIds)].sort() };
}
