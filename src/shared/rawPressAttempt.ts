import type { CompanyId, RawMaterialEntry } from './types';
import type { RawInventoryCommand } from './rawInventoryCore';
import type { LegacyLedgerFields } from './services/rawInventoryService';

export interface RawPressRequest {
  version: 1;
  companyId: CompanyId;
  actorUid: string;
  entry: RawMaterialEntry;
  yieldRule: { product: string; rate: number };
  sourceCommand: Extract<RawInventoryCommand, { kind: 'consume-lot' }>;
  derivedCommand: Extract<RawInventoryCommand, { kind: 'receive' }>;
  sourceLegacy: LegacyLedgerFields;
  derivedLegacy: LegacyLedgerFields;
}
export function rawPressText(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().filter(key => v[key] !== undefined).map(key => [key, canonical(v[key])])) : v;
  return JSON.stringify(canonical(value));
}
/** 기존 압착 수율 셈을 안내·저장·원문 검증이 함께 사용한다. kg를 다시 환산하지 않는다. */
export const rawPressYieldKg = (usedKg: number, rate: number): number => Math.round(usedKg * rate * 1000) / 1000;
export function validateRawPressRequest(request: RawPressRequest): void {
  const r = request, source = r?.sourceCommand, derived = r?.derivedCommand;
  if (r?.version !== 1 || !['taebaek', 'punghoe'].includes(r.companyId) || !r.actorUid
    || !r.entry?.id || !r.entry.effectiveAt || !Number.isFinite(Date.parse(r.entry.effectiveAt))
    || !r.entry.createdAt || !Number.isFinite(Date.parse(r.entry.createdAt))
    || r.entry.type !== 'manual' || r.entry.targetKg != null || r.entry.received !== 0
    || !Number.isFinite(r.entry.used) || r.entry.used <= 0 || !r.entry.targetLotId
    || !r.yieldRule?.product || !Number.isFinite(r.yieldRule.rate) || r.yieldRule.rate <= 0
    || source?.kind !== 'consume-lot' || derived?.kind !== 'receive'
    || source.companyId !== r.companyId || derived.companyId !== r.companyId
    || source.rawItemId === derived.rawItemId || !source.rawItemId || !derived.rawItemId
    || source.operationId !== r.entry.id || derived.operationId !== `yield:${r.entry.id}`
    || source.source?.type !== 'manual' || source.source.id !== r.entry.id
    || derived.source?.type !== 'manual' || derived.source.id !== r.entry.id
    || source.kg !== r.entry.used || source.lotId !== r.entry.targetLotId
    || source.effectiveAt !== r.entry.effectiveAt || derived.effectiveAt !== r.entry.effectiveAt
    || derived.kg !== rawPressYieldKg(r.entry.used, r.yieldRule.rate)
    || !Number.isFinite(derived.kg) || derived.kg < 0
    || source.materialSnapshot !== r.entry.material || derived.materialSnapshot !== r.yieldRule.product
    || (r.entry.companyId !== undefined && r.entry.companyId !== r.companyId)) throw Error('압착 최초 요청 원문을 확인해 주세요.');
}
export const rawPressAttemptKey = (companyId: CompanyId, actorUid: string) => `raw-press:${encodeURIComponent(actorUid)}:${companyId}`;
export function readRawPressAttempt(companyId: CompanyId, actorUid: string): { request: RawPressRequest; encoded: string } | null {
  const encoded = localStorage.getItem(rawPressAttemptKey(companyId, actorUid));
  if (encoded === null) return null;
  try {
    const request = JSON.parse(encoded) as RawPressRequest;
    validateRawPressRequest(request);
    if (request.companyId !== companyId || request.actorUid !== actorUid) throw Error();
    return { request, encoded };
  } catch { throw Error('저장된 압착 요청이 손상되었습니다. 원문을 보존했으니 확인이 필요합니다.'); }
}
export function hasRawPressAttempt(companyId: CompanyId, actorUid: string): boolean { return readRawPressAttempt(companyId, actorUid) !== null; }
export function saveRawPressAttempt(request: RawPressRequest): { request: RawPressRequest; encoded: string } {
  validateRawPressRequest(request);
  const existing = readRawPressAttempt(request.companyId, request.actorUid);
  if (existing) {
    if (rawPressText(existing.request) !== rawPressText(request)) throw Error('이전에 완료 여부를 확인하지 못한 압착 요청을 먼저 재개해 주세요.');
    return existing;
  }
  const key = rawPressAttemptKey(request.companyId, request.actorUid), encoded = JSON.stringify(request);
  if (localStorage.getItem(key) !== null) throw Error('다른 압착 요청을 먼저 재개해 주세요.');
  localStorage.setItem(key, encoded);
  return { request, encoded };
}
export function clearRawPressAttempt(companyId: CompanyId, actorUid: string, encoded: string): void {
  const key = rawPressAttemptKey(companyId, actorUid);
  if (localStorage.getItem(key) !== encoded) throw Error('압착 재개 원문이 달라 정리하지 않았습니다.');
  localStorage.removeItem(key);
}
export interface RawPressCancellationRequest {
  version:1; companyId:CompanyId; actorUid:string; originalOperationId:string;
  cancellationId:string; effectiveAt:string; createdAt:string; original:RawPressRequest;
  sourceReverse:Extract<RawInventoryCommand,{kind:'reverse'}>;
  derivedReverse:Extract<RawInventoryCommand,{kind:'reverse'}>;
}
export function makeRawPressCancellationRequest(original:RawPressRequest,actorUid:string,cancellationId:string,effectiveAt:string):RawPressCancellationRequest {
  const reverse=(command:RawInventoryCommand,side:string):Extract<RawInventoryCommand,{kind:'reverse'}>=>({
    kind:'reverse',companyId:original.companyId,rawItemId:command.rawItemId,materialSnapshot:command.materialSnapshot,
    operationId:`${cancellationId}:${side}`,effectiveAt,source:{type:'reversal',id:command.operationId},originalOperationId:command.operationId,
  });
  return {version:1,companyId:original.companyId,actorUid,originalOperationId:original.entry.id,cancellationId,effectiveAt,createdAt:effectiveAt,original,
    sourceReverse:reverse(original.sourceCommand,'source'),derivedReverse:reverse(original.derivedCommand,'derived')};
}
export function validateRawPressCancellationRequest(request:RawPressCancellationRequest):void {
  validateRawPressRequest(request?.original);
  if(request.version!==1||request.companyId!==request.original.companyId||!request.actorUid||!request.cancellationId
    ||request.originalOperationId!==request.original.entry.id||!Number.isFinite(Date.parse(request.effectiveAt))||request.createdAt!==request.effectiveAt
    ||rawPressText(request)!==rawPressText(makeRawPressCancellationRequest(request.original,request.actorUid,request.cancellationId,request.effectiveAt)))throw Error('압착 취소 최초 원문을 확인해 주세요.');
}
export const rawPressCancellationAttemptKey=(companyId:CompanyId,actorUid:string,originalOperationId:string)=>`raw-press-cancel:${encodeURIComponent(actorUid)}:${companyId}:${encodeURIComponent(originalOperationId)}`;
export function readRawPressCancellationAttempt(companyId:CompanyId,actorUid:string,originalOperationId:string):{request:RawPressCancellationRequest;encoded:string}|null {
  const encoded=localStorage.getItem(rawPressCancellationAttemptKey(companyId,actorUid,originalOperationId));
  if(encoded===null)return null;
  try{const request=JSON.parse(encoded);validateRawPressCancellationRequest(request);if(request.companyId!==companyId||request.actorUid!==actorUid||request.originalOperationId!==originalOperationId)throw Error();return {request,encoded};}
  catch{throw Error('저장된 압착 취소 요청이 손상되었습니다. 최초 원문을 보존했습니다.');}
}
export function saveRawPressCancellationAttempt(request:RawPressCancellationRequest):{request:RawPressCancellationRequest;encoded:string} {
  validateRawPressCancellationRequest(request);
  const existing=readRawPressCancellationAttempt(request.companyId,request.actorUid,request.originalOperationId);
  if(existing){if(rawPressText(existing.request)!==rawPressText(request))throw Error('이전 압착 취소 요청을 먼저 재개해 주세요.');return existing;}
  const key=rawPressCancellationAttemptKey(request.companyId,request.actorUid,request.originalOperationId),encoded=JSON.stringify(request);
  if(localStorage.getItem(key)!==null)throw Error('다른 압착 취소 요청이 있습니다.');
  localStorage.setItem(key,encoded);return {request,encoded};
}
export function clearRawPressCancellationAttempt(request:RawPressCancellationRequest,encoded:string):void {
  const key=rawPressCancellationAttemptKey(request.companyId,request.actorUid,request.originalOperationId);
  if(localStorage.getItem(key)!==encoded)throw Error('압착 취소 원문이 달라 정리하지 않았습니다.');localStorage.removeItem(key);
}
