import {withOrderListProjection} from '../orderListProjection';
import { doc, FieldValue, deleteField, Timestamp, DocumentReference, GeoPoint, Bytes, type Firestore, type Transaction } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../firebase';
import { encodeCatalogValue, needsCatalogOrderReferenceProof, CATALOG_ORDER_EPOCH, CATALOG_ORDER_PROOFS, type CatalogValue, type CatalogOrderReferenceProofResult } from '../../../functions/src/shared/catalogOrderReferenceProof';
import { needsCatalogPurchaseOrderReferenceProof, purchaseOrderReferenceProjection } from '../../../functions/src/shared/catalogOrderReferenceProof';
const adapter = { special(value: unknown): CatalogValue | undefined {
  // Firestore stores Date values as Timestamp; compare the committed native value.
  if (value instanceof Date) { const stamp = Timestamp.fromDate(value); return ['timestamp', stamp.seconds, stamp.nanoseconds]; }
  if (value instanceof Timestamp) return ['timestamp', value.seconds, value.nanoseconds];
  if (value instanceof DocumentReference) return ['reference', value.path];
  if (value instanceof GeoPoint) return ['geo', value.latitude, value.longitude];
  if (value instanceof Bytes) return ['bytes', [...value.toUint8Array()]];
  return undefined;
} };
/** 업무 patch는 바꾸지 않고 최종 커밋 메타만 별도 복사에 붙인다. 모든 호출은 첫 쓰기 전이다. */
export async function prepareCatalogOrderCommit(database: Firestore, tx: Transaction, orderId: string, before: Record<string, any> | undefined, patch: Record<string, any>, replace = false, collection: 'orders' | 'purchaseOrders' = 'orders'): Promise<Record<string, any>> {
  const projectedPatch = collection === 'orders' ? withOrderListProjection(before,patch,replace?'replace':before?'patch':'create',{isDeleteValue:value=>value instanceof FieldValue&&value.isEqual(deleteField()),isTransform:value=>value instanceof FieldValue}) : patch;
  const next = replace ? { ...patch } : { ...before, ...patch };
  if (!(collection === 'purchaseOrders' ? needsCatalogPurchaseOrderReferenceProof(before, next, adapter) : needsCatalogOrderReferenceProof(before, next, adapter))) return projectedPatch;
  const companyId = next.companyId ?? before?.companyId ?? 'taebaek';
  const epoch = await tx.get(doc(database, CATALOG_ORDER_EPOCH, companyId));
  if (!epoch.exists()) return projectedPatch;
  await authReady;
  const uid = auth.currentUser?.uid;
  if (!uid || !['taebaek', 'punghoe'].includes(companyId)) throw Error('회사와 로그인 정보를 다시 확인해 주세요.');
  const revision = epoch.data().revision;
  if (epoch.data().companyId !== companyId || !Number.isSafeInteger(revision) || revision < 0) throw Error('회사 품목 버전을 확인할 수 없습니다.');
  const request = collection === 'purchaseOrders'
    ? { version: 1 as const, collection, companyId, orderId, orderExists: !!before, catalogRevision: revision, beforeProjection: encodeCatalogValue(purchaseOrderReferenceProjection(before ?? {}), adapter), nextProjection: encodeCatalogValue(purchaseOrderReferenceProjection(next), adapter) }
    : { version: 1 as const, companyId, orderId, orderExists: !!before, beforeRevision: before?.inventoryWriteRevision ?? 0, catalogRevision: revision, status: next.status, items: encodeCatalogValue(next.items ?? [], adapter) };
  const response = (await httpsCallable<typeof request, CatalogOrderReferenceProofResult>(functions, 'catalogOrderReferenceProof')(request)).data;
  if (auth.currentUser?.uid !== uid) throw Error('로그인이 변경되어 주문을 저장하지 않았습니다.');
  if (!response || response.catalogRevision !== revision || !response.proofId) throw Object.assign(Error('품목 목록이 변경됐습니다. 같은 주문 내용을 다시 확인해 주세요.'), { code: 'aborted', catalogProofRace: true });
  const proof = await tx.get(doc(database, CATALOG_ORDER_PROOFS, response.proofId));
  const p = proof.data();
  const matches = !!p && (collection === 'purchaseOrders' ? p.collection === collection && JSON.stringify(encodeCatalogValue(p.beforeProjection, adapter)) === JSON.stringify(request.beforeProjection) && JSON.stringify(encodeCatalogValue(p.nextProjection, adapter)) === JSON.stringify(request.nextProjection) : p.beforeRevision === request.beforeRevision && p.status === next.status && JSON.stringify(encodeCatalogValue(p.items, adapter)) === JSON.stringify(request.items));
  if (!proof.exists() || !p || p.companyId !== companyId || p.actorUid !== uid || p.orderId !== orderId || p.catalogRevision !== revision || p.orderExists !== request.orderExists || !matches) throw Error('주문 품목 확인 증거가 원문과 다릅니다.');
  return { ...projectedPatch, catalogReferenceProofId: response.proofId };
}
