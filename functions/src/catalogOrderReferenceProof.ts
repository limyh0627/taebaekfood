import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { decodeCatalogValue, encodeCatalogValue, purchaseOrderReferenceProjection, isActiveCatalogPurchaseOrder, normalizeCatalogOrderReferenceProofRequest, CATALOG_ORDER_EPOCH, CATALOG_ORDER_PROOFS, type CatalogValueAdapter } from './shared/catalogOrderReferenceProof';
import { cleanupValidId } from './shared/partnerItemCleanup';
type Actor = { uid: string; token: Record<string, unknown> };
export async function executeCatalogOrderReferenceProof(db: admin.firestore.Firestore, actor: Actor | undefined, input: unknown) {
  const request = normalizeCatalogOrderReferenceProofRequest(input);
  if (!actor?.uid || actor.token.companyId !== request.companyId || !(actor.token.isAdmin === true || typeof actor.token.employeeId === 'string' && actor.token.employeeId)) throw new HttpsError('permission-denied', '같은 회사 직원만 주문 품목을 확인할 수 있습니다.');
  const adapter: CatalogValueAdapter = { special: value => {
    if(value instanceof admin.firestore.Timestamp) return ['timestamp',value.seconds,value.nanoseconds];
    if(value instanceof admin.firestore.DocumentReference) return ['reference',value.path];
    if(value instanceof admin.firestore.GeoPoint) return ['geo',value.latitude,value.longitude];
    if(Buffer.isBuffer(value)) return ['bytes',[...value]];
    return undefined;
  }, timestamp: (s, n) => new admin.firestore.Timestamp(s, n), reference: path => db.doc(path), geo: (a, b) => new admin.firestore.GeoPoint(a, b), bytes: value => Buffer.from(value) };
  const po = request.collection === 'purchaseOrders';
  const nextProjection = po ? decodeCatalogValue(request.nextProjection, adapter) as Record<string, any> : undefined;
  const beforeProjection = po ? decodeCatalogValue(request.beforeProjection, adapter) : undefined;
  if (po && (!nextProjection || typeof nextProjection !== 'object' || !isActiveCatalogPurchaseOrder(nextProjection) || JSON.stringify(encodeCatalogValue(purchaseOrderReferenceProjection(nextProjection),adapter)) !== JSON.stringify(encodeCatalogValue(nextProjection,adapter)))) throw new HttpsError('invalid-argument', '발주 참조 내용을 확인하세요.');
  const items = po ? [nextProjection!.itemId, ...(Array.isArray(nextProjection!.items) ? nextProjection!.items.map((row: any) => row?.itemId) : []), ...(Array.isArray(nextProjection!.oemSent) ? nextProjection!.oemSent.map((row: any) => row?.rawItemId) : [])].filter(id => id !== undefined).map(itemId => ({itemId})) : decodeCatalogValue(request.items, adapter);
  if (!Array.isArray(items) || items.some(row => !row || typeof row !== 'object' || !cleanupValidId(row.itemId))) throw new HttpsError('invalid-argument', '주문 품목 번호를 확인하세요.');
  const requestHash = createHash('sha256').update(JSON.stringify({ actorUid: actor.uid, ...request })).digest('hex');
  return db.runTransaction(async tx => {
    const [epoch, order] = await Promise.all([tx.get(db.collection(CATALOG_ORDER_EPOCH).doc(request.companyId)), tx.get(db.collection(po ? 'purchaseOrders' : 'orders').doc(request.orderId))]);
    if (!epoch.exists) return { proofId: null, catalogRevision: 0 };
    const revision = epoch.get('revision');
    if (epoch.get('companyId') !== request.companyId || !Number.isSafeInteger(revision) || revision < 0 || revision !== request.catalogRevision) throw new HttpsError('aborted', '품목 목록이 변경됐습니다. 같은 주문 내용을 다시 확인해 주세요.', { catalogProofRace: true });
    const beforeMatches = po ? JSON.stringify(encodeCatalogValue(purchaseOrderReferenceProjection(order.data() ?? {}), adapter)) === JSON.stringify(request.beforeProjection) : (order.exists ? order.get('inventoryWriteRevision') ?? 0 : 0) === request.beforeRevision;
    if (order.exists !== request.orderExists || (order.exists && (order.get('companyId') ?? 'taebaek') !== request.companyId) || !beforeMatches) throw new HttpsError('aborted', '주문이 변경됐습니다. 같은 내용을 다시 확인해 주세요.', { catalogProofRace: true });
    const ids = [...new Set(items.map(row => String(row.itemId)))];
    const refs = await Promise.all(ids.map(id => tx.get(db.collection('items').doc(id))));
    const tombs = await Promise.all(ids.map(id => tx.get(db.collection('inventoryWriterDeletions').doc(request.companyId + '__' + id))));
    for (let i = 0; i < ids.length; i++) if (!refs[i].exists || (refs[i].get('companyId') ?? 'taebaek') !== request.companyId || refs[i].get('archived') === true || tombs[i].get('mergedIntoItemId') !== undefined) throw new HttpsError('failed-precondition', '통합되었거나 사용할 수 없는 품목이 있습니다. 현재 품목을 다시 선택해 주세요.');
    const ref = db.collection(CATALOG_ORDER_PROOFS).doc(requestHash);
    const prior = await tx.get(ref);
    if (prior.exists) { if (prior.get('requestHash') !== requestHash || prior.get('actorUid') !== actor.uid) throw new HttpsError('failed-precondition', '품목 확인 증거가 다릅니다.'); }
    else tx.create(ref, { ...request, ...(po ? {beforeProjection, nextProjection} : {items}), actorUid: actor.uid, requestHash });
    return { proofId: ref.id, catalogRevision: revision };
  });
}
export const catalogOrderReferenceProof = onCall({ region: 'asia-northeast3' }, request => executeCatalogOrderReferenceProof(admin.firestore(), request.auth, request.data));
