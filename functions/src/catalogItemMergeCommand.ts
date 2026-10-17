import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { assertReleaseActive, releaseGateRef } from './releaseGate';
import { advanceInventoryWriterProtocol } from './shared/inventoryWriterProtocol';
import { cleanupValidId } from './shared/partnerItemCleanup';
import { buildCatalogItemMergePlan, normalizeCatalogItemMergeReference, normalizeCatalogItemMergeRequest, serializeCatalogItemMergeRequest,
  type CatalogItemMergeCommand, type CatalogItemMergeDoc, type CatalogItemMergeSnapshot, type CatalogItemMergePreview, type CatalogItemMergeRequest, type CatalogItemMergeReference, type CatalogItemMergeResult } from './shared/catalogItemMerge';

type Actor = { uid: string; token: Record<string, unknown> };
type Row = Record<string, any>;
export const CATALOG_MERGE_RECEIPTS = 'catalogItemMergeReceipts';
const LIMIT = 1000;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const catalogItemMergeReceiptId = (company: string, actor: string, operation: string) => hash(JSON.stringify([company, actor, operation]));
const fail = (message: string): never => { throw new HttpsError('failed-precondition', message); };
const ownCompany = (data: Row) => data.companyId ?? 'taebaek';
const version = (doc: admin.firestore.DocumentSnapshot) => doc.updateTime ? `${doc.updateTime.seconds}:${String(doc.updateTime.nanoseconds).padStart(9, '0')}` : null;
function canonical(value: any): any {
  if (value === undefined) return { $missing: true };
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.toMillis === 'function') return { $timestamp: [value.seconds, value.nanoseconds] };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (typeof value.path === 'string' && value.firestore) return { $reference: value.path };
  if (typeof value.latitude === 'number' && typeof value.longitude === 'number') return { $geo: [value.latitude, value.longitude] };
  if (Buffer.isBuffer(value)) return { $bytes: value.toString('base64') };
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
const textOf = (value: unknown) => JSON.stringify(canonical(value));

/** 문서 부재와 조회 결과 집합도 고정해 재생성·뒤늦은 참조를 같은 원문으로 취급하지 않는다. */
async function readSnapshot(db: admin.firestore.Firestore, tx: admin.firestore.Transaction, companyId: 'taebaek' | 'punghoe', keepId: string, donorIds: string[]) {
  const ids = [keepId, ...donorIds], observed = new Map<string, admin.firestore.DocumentSnapshot>();
  const querySets: { key: string; paths: string[]; complete: boolean }[] = [];
  let complete = true, reason = '';
  const note = (message: string) => { complete = false; reason ||= message; };
  const read = async (collection: string, id: string) => { const row = await tx.get(db.collection(collection).doc(id)); observed.set(row.ref.path, row); return row; };
  const query = async (collection: string, field: string, values: unknown[], operator: 'in' | '==' = 'in', companyScoped = false) => {
    const result = await tx.get(db.collection(collection).where(field, operator, operator === 'in' ? values : values[0]).limit(LIMIT + 1));
    if (result.size > LIMIT) note('참조가 많아 전체를 확인하지 못했습니다. 대상을 줄이고 담당자에게 문의하세요.');
    const relevant = companyScoped ? result.docs.filter(row => ownCompany(row.data()) === companyId) : result.docs;
    querySets.push({ key: textOf([collection, field, operator, values]), paths: relevant.map(row => row.ref.path).sort(), complete: result.size <= LIMIT });
    for (const row of relevant) observed.set(row.ref.path, row);
    return result.docs;
  };
  const [itemDocs, rawDocs, tombDocs, epoch, gate] = await Promise.all([
    Promise.all(ids.map(id => read('items', id))), Promise.all(ids.map(id => read('rawInventories', companyId + '__' + id))),
    Promise.all(ids.map(id => read('inventoryWriterDeletions', companyId + '__' + id))), read('catalogItemMergeState', companyId), tx.get(releaseGateRef(db)),
  ]);
  for (const row of itemDocs) if (row.exists) {
    if (ownCompany(row.data()!) !== companyId) throw new HttpsError('permission-denied', '다른 회사 품목은 통합할 수 없습니다.');
    try { advanceInventoryWriterProtocol(row.data(), {}); } catch { note('품목 재고 쓰기 버전이 손상됐습니다. 원문을 보존하고 관리자에게 확인하세요.'); }
  }
  for (const row of tombDocs) if (row.exists) {
    const d = row.data()!;
    if (d.companyId !== companyId || d.itemId !== row.id.slice(companyId.length + 2) || d.inventoryWriterProtocolVersion !== 1 || !Number.isSafeInteger(d.deletionRevision) || d.deletionRevision < 1 || !Number.isSafeInteger(d.lastDeletedItemRevision) || d.lastDeletedItemRevision < 0 || d.beforeRevision !== d.lastDeletedItemRevision || d.mergedIntoItemId !== undefined) note('품목의 삭제·통합 이력이 달라졌습니다. 원문을 보존하고 다시 확인하세요.');
  }
  const revision = epoch.exists ? epoch.data()!.revision : 0;
  if (epoch.exists && epoch.data()!.companyId !== companyId || !Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(revision + 1)) note('회사 품목 변경 버전을 확인할 수 없습니다. 관리자에게 문의하세요.');
  const [links, parents, children, packs, orders, units, pos, oemPos, returns] = await Promise.all([
    query('partner_item', 'itemId', ids), query('item_bom', 'parent_id', ids), query('item_bom', 'child_id', ids), query('item_pack', 'item_id', ids),
    query('orders', 'status', ['PENDING', 'PROCESSING', 'DISPATCHED', 'SHIPPED', 'ON_HOLD'], 'in', true), query('item_purchase_unit', 'itemId', ids),
    query('purchaseOrders', 'status', ['pending', 'invoiced', 'received'], 'in', true), query('purchaseOrders', 'oemIssueStatus', ['processing', 'failed'], 'in', true), query('returnRequests', 'status', ['pending'], 'in', true),
  ]);
  const unique = (rows: admin.firestore.DocumentSnapshot[]) => [...new Map(rows.map(row => [row.ref.path, row])).values()];
  // 신규 목적지 ID의 점유도 조회하여 query에 잡히지 않은 문서를 덮어쓰지 않는다.
  const destinations = new Set(links.filter(row => cleanupValidId(row.data()?.partnerId) && ['in', 'out'].includes(row.data()?.Direction)).map(row => `${keepId}_${row.data()!.partnerId}_${row.data()!.Direction}`));
  const missingDestinations = await Promise.all([...destinations].filter(id => !links.some(row => row.id === id)).map(id => read('partner_item', id)));
  const partnerIds = [...new Set(links.filter(row => row.data()?.companyId === companyId).map(row => row.data()!.partnerId).filter(cleanupValidId))] as string[];
  const partners = await Promise.all(partnerIds.map(id => read('partners', id)));
  for (const row of partners) if (!row.exists || ownCompany(row.data()!) !== companyId) note('연결된 거래처의 회사·존재를 확인할 수 없습니다. 거래처 연결을 먼저 확인하세요.');
  const doc = (row: admin.firestore.DocumentSnapshot): CatalogItemMergeDoc => ({ id: row.id, version: version(row)!, data: row.data()! });
  const own = (rows: admin.firestore.DocumentSnapshot[]) => rows.filter(row => ownCompany(row.data()!) === companyId).map(doc);
  const snapshot: CatalogItemMergeSnapshot = { companyId, keepId, donorIds, items: itemDocs.filter(row => row.exists).map(doc), rawInventories: rawDocs.filter(row => row.exists).map(doc),
    links: unique([...links, ...missingDestinations.filter(row => row.exists)]).map(doc), boms: unique([...parents, ...children]).map(doc), packs: packs.map(doc), activeOrders: own(orders), purchaseUnits: units.map(doc), purchaseOrders: own(unique([...pos, ...oemPos])), returnRequests: own(returns), coverage: { complete, reason, estimatedWriteCount: 0 } };
  if (Buffer.byteLength(textOf(snapshot), 'utf8') > 700000) { snapshot.coverage.complete = false; snapshot.coverage.reason = '원문 감사 기록이 너무 큽니다. 통합 대상을 줄이거나 담당자에게 참조 범위 확인을 요청하세요.'; }
  const evidence = [...observed.values()].sort((a, b) => a.ref.path.localeCompare(b.ref.path)).map(row => ({ path: row.ref.path, exists: row.exists, version: version(row), data: row.exists ? row.data() : null }));
  return { snapshot, gate, epoch, revision, itemDocs, tombDocs, partners, digest: hash(textOf({ companyId, keepId, donorIds, evidence, queries: querySets.sort((a, b) => a.key.localeCompare(b.key)) })) };
}
function preview(read: Awaited<ReturnType<typeof readSnapshot>>): CatalogItemMergePreview {
  const { snapshot, gate } = read;
  const names = new Map(read.partners.filter(row => row.exists && ownCompany(row.data()!) === snapshot.companyId).map(row => [row.id, String(row.data()!.name ?? '')]));
  return { companyId: snapshot.companyId, releaseId: gate.data()?.status === 'active' ? gate.data()?.releaseId ?? null : null, snapshotDigest: read.digest, plan: buildCatalogItemMergePlan(snapshot),
    candidateLinks: snapshot.links.filter(row => row.data.companyId === snapshot.companyId && [snapshot.keepId, ...snapshot.donorIds].includes(String(row.data.itemId))).map(row => ({ id: row.id, itemId: String(row.data.itemId), itemName: String(snapshot.items.find(item => item.id === row.data.itemId)?.data.name ?? ''), partnerId: String(row.data.partnerId ?? ''), partnerName: names.get(String(row.data.partnerId)) ?? null, direction: row.data.Direction as 'in' | 'out', business: row.data })) };
}
export async function executeCatalogItemMerge(db: admin.firestore.Firestore, actor: Actor | undefined, input: CatalogItemMergeCommand): Promise<CatalogItemMergePreview | CatalogItemMergeResult> {
  if (!actor) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  if (!actor.uid || actor.token.isAdmin !== true || !['taebaek', 'punghoe'].includes(String(actor.token.companyId)) || typeof actor.token.employeeId !== 'string' || !actor.token.employeeId.trim()) throw new HttpsError('permission-denied', '현재 회사 관리자 권한이 필요합니다.');
  if (!input || !['read', 'apply', 'inspect-request', 'discard-request'].includes(input.mode)) throw new HttpsError('invalid-argument', '품목 통합 명령을 확인하세요.');
  if (input.mode === 'read') {
    if (Object.keys(input).some(key => !['mode', 'companyId', 'keepId', 'donorIds'].includes(key))) throw new HttpsError('invalid-argument', '조회 항목을 확인하세요.');
    let normalized: CatalogItemMergeRequest;
    try { normalized = normalizeCatalogItemMergeRequest({ version: 1, operationId: 'read', releaseId: 'read', companyId: input.companyId, keepId: input.keepId, donorIds: input.donorIds, snapshotDigest: '0'.repeat(64), resolutions: [] }); } catch { throw new HttpsError('invalid-argument', '통합할 회사와 품목 번호를 확인하세요.'); }
    if (normalized.companyId !== actor.token.companyId) throw new HttpsError('permission-denied', '다른 회사의 통합 요청입니다.');
    return db.runTransaction(async tx => preview(await readSnapshot(db, tx, normalized.companyId, normalized.keepId, normalized.donorIds)));
  }
  if (Object.keys(input).some(key => !['mode', 'request', 'reference'].includes(key)) || ('request' in input && 'reference' in input)) throw new HttpsError('invalid-argument', '최초 원문 또는 복구 참조 하나만 보내세요.');
  let request: CatalogItemMergeRequest | undefined, ref: CatalogItemMergeReference;
  try { if ('request' in input && input.request) { request = normalizeCatalogItemMergeRequest(input.request); ref = request; } else if (input.mode !== 'apply' && 'reference' in input) ref = normalizeCatalogItemMergeReference(input.reference); else throw Error(); } catch { throw new HttpsError('invalid-argument', '최초 통합 원문과 작업 번호를 확인하세요.'); }
  if (ref.companyId !== actor.token.companyId) throw new HttpsError('permission-denied', '다른 회사의 통합 요청입니다.');
  const text = request ? serializeCatalogItemMergeRequest(request) : null, digest = text === null ? null : hash(text);
  const receipt = db.collection(CATALOG_MERGE_RECEIPTS).doc(catalogItemMergeReceiptId(ref.companyId, actor.uid, ref.operationId));
  const result = (status: CatalogItemMergeResult['status'], message: string, errorCode: string | null = null, opaqueFence = false): CatalogItemMergeResult => ({ ...ref, actorUid: actor.uid, status, requestText: opaqueFence ? null : text, requestHash: opaqueFence ? null : digest, opaqueFence, errorCode, message });
  return db.runTransaction(async tx => {
    const prior = await tx.get(receipt);
    if (prior.exists) {
      const r = prior.data() as CatalogItemMergeResult;
      if (r.version !== 1 || r.companyId !== ref.companyId || r.actorUid !== actor.uid || r.operationId !== ref.operationId || !['applied', 'rejected', 'discarded'].includes(r.status)) fail('통합 영수증의 회사·계정·작업 번호가 다릅니다. 원문을 보존하고 문의하세요.');
      if (r.opaqueFence) { if (r.status !== 'discarded' || r.requestText !== null || r.requestHash !== null) fail('중단 영수증 원문이 다릅니다.'); }
      else {
        if (typeof r.requestText !== 'string' || hash(r.requestText) !== r.requestHash || text !== null && (r.requestText !== text || r.requestHash !== digest)) throw new HttpsError('already-exists', '같은 작업 번호의 최초 통합 원문이 다릅니다. 결과를 확인하거나 요청을 중단하세요.');
        let original: CatalogItemMergeRequest; try { original = normalizeCatalogItemMergeRequest(JSON.parse(r.requestText)); } catch { return fail('통합 영수증 원문을 확인하세요.'); }
        if (original.companyId !== ref.companyId || original.operationId !== ref.operationId || serializeCatalogItemMergeRequest(original) !== r.requestText) fail('통합 영수증의 최초 요청 참조가 다릅니다.');
      }
      return { version: r.version, companyId: r.companyId, operationId: r.operationId, actorUid: r.actorUid, status: r.status, requestText: r.requestText, requestHash: r.requestHash, opaqueFence: r.opaqueFence, errorCode: r.errorCode, message: r.message, ...(r.summary ? { summary: r.summary } : {}) };
    }
    if (input.mode === 'inspect-request') return result('unknown', '아직 서버 처리 결과를 확인하지 못했습니다. 같은 원문으로 다시 확인하거나 요청을 중단하세요.');
    if (input.mode === 'discard-request') { const r = result('discarded', '이 요청의 늦은 통합 처리를 봉쇄했습니다. 이미 통합된 품목은 복원하지 않습니다.', null, !request); tx.create(receipt, { ...r, createdAt: new Date().toISOString() }); return r; }
    if (!request) throw new HttpsError('invalid-argument', '최초 통합 원문이 필요합니다.');
    const read = await readSnapshot(db, tx, request.companyId, request.keepId, request.donorIds);
    let code: string | null = null, message = '';
    try { assertReleaseActive(read.gate, request.releaseId); } catch { code = 'release-changed'; message = '배포 상태가 달라졌습니다. 이 요청을 중단하고 다시 확인하세요.'; }
    if (!code && read.digest !== request.snapshotDigest) { code = 'snapshot-changed'; message = '품목 또는 연결·재고·진행 업무가 바뀌었습니다. 이 요청을 중단하고 최신 상태에서 다시 선택하세요.'; }
    const plan = buildCatalogItemMergePlan(read.snapshot, request.resolutions);
    if (!code && plan.phase !== 'ready') { code = plan.phase === 'needs-resolution' ? 'selection-required' : 'blocked'; message = plan.blockers.map(row => row.message).join('\n') || '연결의 단가·세금·포장 중 남길 원문을 선택하고 다시 확인하세요.'; }
    if (code) { const r = result('rejected', message, code); tx.create(receipt, { ...r, createdAt: new Date().toISOString() }); return r; }
    const writes: { ref: admin.firestore.DocumentReference; data?: Row; remove?: boolean }[] = [];
    for (const group of plan.groups) {
      const source = read.snapshot.links.find(row => row.id === group.selectedSourceLinkId)!;
      writes.push({ ref: db.collection('partner_item').doc(group.destinationLinkId!), data: { ...source.data, id: group.destinationLinkId, companyId: request.companyId, itemId: request.keepId } });
    }
    for (const [collection, ids] of [['partner_item', plan.deleteLinkIds], ['item_bom', plan.deleteOwnBomIds], ['item_pack', plan.deletePackIds]] as const) for (const id of ids) writes.push({ ref: db.collection(collection).doc(id), remove: true });
    const now = new Date().toISOString();
    for (const id of request.donorIds) {
      const item = read.itemDocs.find(row => row.id === id)!, tomb = read.tombDocs.find(row => row.id === request.companyId + '__' + id)!;
      const beforeRevision = advanceInventoryWriterProtocol(item.data(), {}).inventoryWriteRevision - 1, deletionRevision = (tomb.data()?.deletionRevision ?? 0) + 1;
      if (!Number.isSafeInteger(deletionRevision)) fail('품목 삭제 이력 버전 한도를 초과했습니다.');
      writes.push({ ref: tomb.ref, data: { ...tomb.data(), companyId: request.companyId, itemId: id, inventoryWriterProtocolVersion: 1, deletionRevision, beforeRevision, lastDeletedItemRevision: beforeRevision, mergedIntoItemId: request.keepId, mergeOperationId: request.operationId, deletedAt: now } }, { ref: item.ref, remove: true });
    }
    if (writes.length + 2 > 400 || new Set(writes.map(row => row.ref.path)).size !== writes.length) fail('같은 문서의 중복 처리 또는 저장 한도를 확인하세요. 대상을 줄여 다시 확인하세요.');
    const r = result('applied', '선택한 품목 연결을 통합했습니다. 남긴 품목의 재고와 과거 거래 내역은 바꾸지 않았습니다.');
    for (const write of writes) if (write.remove) tx.delete(write.ref); else tx.set(write.ref, write.data!);
    tx.set(read.epoch.ref, { ...read.epoch.data(), companyId: request.companyId, revision: read.revision + 1, lastOperationId: request.operationId, updatedAt: now });
    tx.create(receipt, { ...r, createdAt: now, beforeSnapshot: read.snapshot, summary: { keepId: request.keepId, donorIds: request.donorIds, changedLinkIds: plan.groups.map(row => row.destinationLinkId), catalogRevision: read.revision + 1 } });
    return { ...r, summary: { keepId: request.keepId, donorIds: request.donorIds, changedLinkIds: plan.groups.map(row => row.destinationLinkId), catalogRevision: read.revision + 1 } };
  });
}
export const catalogItemMergeCommand = onCall({ region: 'asia-northeast3' }, async request => executeCatalogItemMerge(admin.firestore(), request.auth, request.data as CatalogItemMergeCommand));
