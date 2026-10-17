import { cleanupValidId, type CleanupCompany } from './partnerItemCleanup';
import { CATALOG_MERGE_BLOCKING_STATUSES } from './catalogItemMerge';
export const CATALOG_ORDER_PROOFS = 'catalogOrderReferenceProofs';
export const CATALOG_ORDER_EPOCH = 'catalogItemMergeState';
export type CatalogValue = ['null'] | ['boolean', boolean] | ['string', string] | ['number', number | 'NaN' | '+Infinity' | '-Infinity' | '-0'] | ['timestamp', number, number] | ['date', string] | ['reference', string] | ['geo', number, number] | ['bytes', number[]] | ['array', CatalogValue[]] | ['map', [string, CatalogValue][]];
export interface CatalogValueAdapter { special(value: unknown): CatalogValue | undefined; timestamp(seconds: number, nanoseconds: number): unknown; reference(path: string): unknown; geo(latitude: number, longitude: number): unknown; bytes(value: number[]): unknown }
export function encodeCatalogValue(value: unknown, adapter?: Pick<CatalogValueAdapter, 'special'>): CatalogValue {
  const special = adapter?.special(value); if (special) return special;
  if (value === null) return ['null'];
  if (typeof value === 'boolean') return ['boolean', value];
  if (typeof value === 'string') return ['string', value];
  if (typeof value === 'number') return ['number', Number.isNaN(value) ? 'NaN' : value === Infinity ? '+Infinity' : value === -Infinity ? '-Infinity' : Object.is(value, -0) ? '-0' : value];
  if (value instanceof Date) { if (!Number.isFinite(value.getTime())) throw Error('날짜 형식을 확인하세요.'); return ['date', value.toISOString()]; }
  if (Array.isArray(value)) return ['array', value.map(row => encodeCatalogValue(row, adapter))];
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return ['map', Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => [key, encodeCatalogValue((value as Record<string, unknown>)[key], adapter)] as [string, CatalogValue])];
  throw Error('저장할 수 없는 품목 값입니다. 다시 확인해 주세요.');
}
export function decodeCatalogValue(input: unknown, adapter: CatalogValueAdapter, depth = 0): unknown {
  if (depth > 40 || !Array.isArray(input)) throw Error('품목 값 형식이 올바르지 않습니다.');
  const [tag, a, b] = input;
  if (tag === 'null' && input.length === 1) return null;
  if (tag === 'boolean' && input.length === 2 && typeof a === 'boolean' || tag === 'string' && input.length === 2 && typeof a === 'string') return a;
  if (tag === 'number' && input.length === 2) { if (typeof a === 'number' && Number.isFinite(a)) return a; if (a === 'NaN') return NaN; if (a === '+Infinity') return Infinity; if (a === '-Infinity') return -Infinity; if (a === '-0') return -0; }
  if (tag === 'timestamp' && input.length === 3 && Number.isSafeInteger(a) && Number.isSafeInteger(b) && b >= 0 && b < 1e9) return adapter.timestamp(a, b);
  if (tag === 'date' && input.length === 2 && typeof a === 'string' && Number.isFinite(Date.parse(a)) && new Date(a).toISOString() === a) return new Date(a);
  if (tag === 'reference' && input.length === 2 && typeof a === 'string' && a.split('/').length % 2 === 0 && a.split('/').every(cleanupValidId)) return adapter.reference(a);
  if (tag === 'geo' && input.length === 3 && typeof a === 'number' && Number.isFinite(a) && a >= -90 && a <= 90 && typeof b === 'number' && Number.isFinite(b) && b >= -180 && b <= 180) return adapter.geo(a, b);
  if (tag === 'bytes' && input.length === 2 && Array.isArray(a) && a.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) return adapter.bytes(a);
  if (tag === 'array' && input.length === 2 && Array.isArray(a)) return a.map(value => decodeCatalogValue(value, adapter, depth + 1));
  if (tag === 'map' && input.length === 2 && Array.isArray(a)) {
    const result: Record<string, unknown> = {};
    let previous: string | undefined;
    for (const pair of a) { if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || previous !== undefined && pair[0] <= previous) throw Error('품목 필드가 중복되거나 순서가 다릅니다.'); previous = pair[0]; Object.defineProperty(result, pair[0], { value: decodeCatalogValue(pair[1], adapter, depth + 1), enumerable: true, configurable: true, writable: true }); }
    return result;
  }
  throw Error('품목 값 형식이 올바르지 않습니다.');
}
export type CatalogOrderReferenceProofRequest = { version: 1; companyId: CleanupCompany; orderId: string; orderExists: boolean; catalogRevision: number } & (
  { collection?: 'orders'; beforeRevision: number; status: string; items: CatalogValue } |
  { collection: 'purchaseOrders'; beforeProjection: CatalogValue; nextProjection: CatalogValue }
);
export interface CatalogOrderReferenceProofResult { proofId: string | null; catalogRevision: number }
export const PURCHASE_ORDER_REFERENCE_FIELDS = ['itemId', 'items', 'oemSent', 'status', 'oemIssueStatus', 'oemCancelledAt'] as const;
export function purchaseOrderReferenceProjection(value: Record<string, any>): Record<string, unknown> {
  return Object.fromEntries(PURCHASE_ORDER_REFERENCE_FIELDS.filter(key => Object.prototype.hasOwnProperty.call(value, key)).map(key => [key, value[key]]));
}
export function isActiveCatalogPurchaseOrder(value: Record<string, any>): boolean {
  return value.status !== 'cancelled' && !value.oemCancelledAt && (['pending', 'invoiced'].includes(value.status) || ['processing', 'failed'].includes(value.oemIssueStatus));
}
export function needsCatalogPurchaseOrderReferenceProof(before: Record<string, any> | undefined, next: Record<string, any>, adapter?: Pick<CatalogValueAdapter, 'special'>): boolean {
  return isActiveCatalogPurchaseOrder(next) && (!before || !isActiveCatalogPurchaseOrder(before) || JSON.stringify(encodeCatalogValue(purchaseOrderReferenceProjection(before), adapter)) !== JSON.stringify(encodeCatalogValue(purchaseOrderReferenceProjection(next), adapter)));
}
export function normalizeCatalogOrderReferenceProofRequest(value: unknown): CatalogOrderReferenceProofRequest {
  const v = value as CatalogOrderReferenceProofRequest;
  if (v && typeof v === 'object' && v.collection === 'purchaseOrders') {
    if (Object.keys(v).sort().join(',') !== 'beforeProjection,catalogRevision,collection,companyId,nextProjection,orderExists,orderId,version' || v.version !== 1 || !['taebaek', 'punghoe'].includes(v.companyId) || !cleanupValidId(v.orderId) || typeof v.orderExists !== 'boolean' || !Number.isSafeInteger(v.catalogRevision) || v.catalogRevision < 0 || !Array.isArray(v.beforeProjection) || v.beforeProjection[0] !== 'map' || !Array.isArray(v.nextProjection) || v.nextProjection[0] !== 'map') throw Error('발주 품목 확인 요청이 올바르지 않습니다.');
    return { version: 1, collection: 'purchaseOrders', companyId: v.companyId, orderId: v.orderId, orderExists: v.orderExists, catalogRevision: v.catalogRevision, beforeProjection: v.beforeProjection, nextProjection: v.nextProjection };
  }
  if (!v || typeof v !== 'object' || Object.keys(v).sort().join(',') !== 'beforeRevision,catalogRevision,companyId,items,orderExists,orderId,status,version' || v.version !== 1 || !['taebaek', 'punghoe'].includes(v.companyId) || !cleanupValidId(v.orderId) || typeof v.orderExists !== 'boolean' || !Number.isSafeInteger(v.beforeRevision) || v.beforeRevision < 0 || !Number.isSafeInteger(v.catalogRevision) || v.catalogRevision < 0 || !(CATALOG_MERGE_BLOCKING_STATUSES as readonly string[]).includes(v.status) || !Array.isArray(v.items) || v.items[0] !== 'array') throw Error('주문 품목 확인 요청이 올바르지 않습니다.');
  return { version: 1, companyId: v.companyId, orderId: v.orderId, orderExists: v.orderExists, beforeRevision: v.beforeRevision, catalogRevision: v.catalogRevision, status: v.status, items: v.items };
}
export function needsCatalogOrderReferenceProof(before: Record<string, any> | undefined, next: Record<string, any>, adapter?: Pick<CatalogValueAdapter, 'special'>): boolean {
  return (CATALOG_MERGE_BLOCKING_STATUSES as readonly string[]).includes(next.status) && (!before || !(CATALOG_MERGE_BLOCKING_STATUSES as readonly string[]).includes(before.status) || JSON.stringify(encodeCatalogValue(before.items ?? [], adapter)) !== JSON.stringify(encodeCatalogValue(next.items ?? [], adapter)));
}
