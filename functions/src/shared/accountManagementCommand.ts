import { encodeCatalogValue, decodeCatalogValue, type CatalogValue } from './catalogOrderReferenceProof';
import { documentId } from './documentId';
import { cleanupValidId } from './partnerItemCleanup';
export type { CatalogValue, CatalogValueAdapter } from './catalogOrderReferenceProof';

export const ACCOUNT_MANAGEMENT_OPERATIONS = 'accountManagementOperations';
export interface AccountManagementReference {
  companyId: 'taebaek' | 'punghoe';
  planId: string;
  kind: 'code' | 'group';
  targetId: string;
}
export interface AccountManagementCreateData {
  id: string;
  name: string;
  code?: string;
  groupId?: string;
  type?: string;
  plLine?: string;
}
export interface AccountManagementUpdatePatch {
  name?: string;
  code?: string;
  groupId?: string;
  type?: string;
  plLine?: string | null;
}
export interface AccountManagementRequest {
  version: 1;
  reference: AccountManagementReference;
  action: 'create' | 'delete' | 'update';
  expectedVersion: string | null;
  data?: AccountManagementCreateData;
  patch?: AccountManagementUpdatePatch;
}
export interface AccountManagementOpenRequest {
  mode: 'open';
  reference: AccountManagementReference;
  opening: CatalogValue;
}
export interface AccountManagementOpenResult {
  reference: AccountManagementReference;
  actorUid: string;
  opening: CatalogValue;
  expectedVersion: string;
}
export interface AccountManagementResult {
  version: 1;
  reference: AccountManagementReference;
  actorUid: string;
  status: 'applied' | 'rejected' | 'cancelled' | 'unknown';
  requestHash: string | null;
  message: string;
}
export type AccountManagementCommand = AccountManagementOpenRequest
  | { mode: 'apply'; request: AccountManagementRequest }
  | { mode: 'inspect' | 'cancel'; reference: AccountManagementReference; requestHash?: string };

function exact(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some(key => !fields.includes(key))) throw Error('계정 요청 형식을 확인해 주세요.');
}
const fieldsOf = (kind: AccountManagementReference['kind']) => kind === 'code'
  ? ['companyId', 'name', 'code', 'groupId'] : ['companyId', 'name', 'type', 'plLine'];
export function accountManagementOpening(row: object, kind: AccountManagementReference['kind']): CatalogValue {
  return encodeCatalogValue(Object.fromEntries(fieldsOf(kind).filter(key => Object.prototype.hasOwnProperty.call(row, key))
    .map(key => [key, (row as Record<string, unknown>)[key]])));
}
function openingOf(value: unknown, kind: AccountManagementReference['kind']): CatalogValue {
  const unsupported = () => { throw Error('계정 원문 형식을 확인해 주세요.'); };
  const raw = decodeCatalogValue(value, { special: () => undefined, timestamp: unsupported, reference: unsupported,
    geo: unsupported, bytes: unsupported });
  exact(raw, fieldsOf(kind));
  if (JSON.stringify(accountManagementOpening(raw, kind)) !== JSON.stringify(value)) throw Error('선택한 계정 원문을 보존해 주세요.');
  return value as CatalogValue;
}
export function normalizeAccountManagementReference(value: unknown): AccountManagementReference {
  exact(value, ['companyId', 'planId', 'kind', 'targetId']);
  if (!['taebaek', 'punghoe'].includes(String(value.companyId)) || !cleanupValidId(value.planId)
    || !['code', 'group'].includes(String(value.kind)) || !documentId(value.targetId)) throw Error('계정 요청의 회사·종류·번호를 확인해 주세요.');
  return { companyId: value.companyId as AccountManagementReference['companyId'], planId: value.planId,
    kind: value.kind as AccountManagementReference['kind'], targetId: value.targetId };
}
function versionOf(value: unknown): string {
  if (typeof value !== 'string' || !/^-?\d+:\d{9}$/.test(value) || Number(value.split(':')[1]) >= 1e9) throw Error('확인한 계정 버전을 보존해 주세요.');
  return value;
}
export function normalizeAccountManagementRequest(value: unknown): AccountManagementRequest {
  exact(value, ['version', 'reference', 'action', 'expectedVersion', 'data', 'patch']);
  const reference = normalizeAccountManagementReference(value.reference);
  if (value.version !== 1 || !['create', 'delete', 'update'].includes(String(value.action))) throw Error('계정 처리 종류를 확인해 주세요.');
  const result: AccountManagementRequest = { version: 1, reference, action: value.action as AccountManagementRequest['action'], expectedVersion: null };
  if (value.action === 'update') {
    if (Object.prototype.hasOwnProperty.call(value, 'data')) throw Error('수정 요청에는 신규 원문을 넣을 수 없습니다.');
    result.expectedVersion = versionOf(value.expectedVersion);
    const fields = reference.kind === 'code' ? ['code', 'name', 'groupId'] : ['name', 'type', 'plLine'];
    exact(value.patch, fields);
    const patch = Object.fromEntries(fields.filter(key => value.patch && (value.patch as Record<string, unknown>)[key] !== undefined)
      .map(key => [key, (value.patch as Record<string, unknown>)[key]]));
    if (!Object.keys(patch).length || Object.entries(patch).some(([key, field]) => typeof field !== 'string' && !(key === 'plLine' && field === null)))
      throw Error('수정할 계정 항목과 입력 원문을 확인해 주세요.');
    if (typeof patch.name === 'string' && !patch.name.trim()) throw Error('이름을 입력해 주세요.');
    result.patch = patch as AccountManagementUpdatePatch;
  } else if (value.action === 'delete') {
    if (Object.prototype.hasOwnProperty.call(value, 'patch')) throw Error('삭제 요청에는 수정 항목을 넣을 수 없습니다.');
    if (Object.prototype.hasOwnProperty.call(value, 'data')) throw Error('삭제 요청에는 신규 원문을 넣을 수 없습니다.');
    result.expectedVersion = versionOf(value.expectedVersion);
  } else {
    if (Object.prototype.hasOwnProperty.call(value, 'patch')) throw Error('신규 요청에는 수정 항목을 넣을 수 없습니다.');
    if (value.expectedVersion !== null) throw Error('신규 계정은 기존 버전 없이 등록해 주세요.');
    const fields = reference.kind === 'code' ? ['id', 'code', 'name', 'groupId'] : ['id', 'name', 'type', 'plLine'];
    exact(value.data, fields);
    const data = Object.fromEntries(fields.filter(key => value.data && (value.data as Record<string, unknown>)[key] !== undefined)
      .map(key => [key, (value.data as Record<string, unknown>)[key]]));
    if (data.id !== reference.targetId || typeof data.name !== 'string'
      || (reference.kind === 'code' ? typeof data.code !== 'string' : typeof data.type !== 'string')
      || Object.values(data).some(field => typeof field !== 'string')) throw Error('신규 계정의 고정 번호와 표시 원문을 확인해 주세요.');
    result.data = data as unknown as AccountManagementCreateData;
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 256 * 1024) throw Error('계정 요청 원문이 너무 큽니다.');
  return result;
}
export const serializeAccountManagementRequest = (value: AccountManagementRequest): string => JSON.stringify(normalizeAccountManagementRequest(value));
export function normalizeAccountManagementOpenRequest(value: unknown): AccountManagementOpenRequest {
  exact(value, ['mode', 'reference', 'opening']);
  if (value.mode !== 'open') throw Error('계정 열기 요청을 확인해 주세요.');
  const reference = normalizeAccountManagementReference(value.reference);
  return { mode: 'open', reference, opening: openingOf(value.opening, reference.kind) };
}
function bound(value: unknown, reference: AccountManagementReference, actorUid: string): Record<string, unknown> {
  exact(value, ['version', 'reference', 'actorUid', 'opening', 'expectedVersion', 'status', 'requestHash', 'message']);
  if (JSON.stringify(normalizeAccountManagementReference(value.reference)) !== JSON.stringify(normalizeAccountManagementReference(reference))
    || value.actorUid !== actorUid) throw Error('다른 회사·계정·대상의 응답입니다.');
  return value;
}
export function normalizeAccountManagementOpenResult(value: unknown, reference: AccountManagementReference, actorUid: string): AccountManagementOpenResult {
  const raw = bound(value, reference, actorUid);
  exact(raw, ['reference', 'actorUid', 'opening', 'expectedVersion']);
  return { reference: normalizeAccountManagementReference(raw.reference), actorUid,
    opening: openingOf(raw.opening, reference.kind), expectedVersion: versionOf(raw.expectedVersion) };
}
export function normalizeAccountManagementResult(value: unknown, reference: AccountManagementReference, actorUid: string, expectedHash?: string): AccountManagementResult {
  const raw = bound(value, reference, actorUid);
  exact(raw, ['version', 'reference', 'actorUid', 'status', 'requestHash', 'message']);
  if (raw.version !== 1 || !['applied', 'rejected', 'cancelled', 'unknown'].includes(String(raw.status))
    || typeof raw.message !== 'string' || !raw.message
    || (raw.requestHash === null ? !['cancelled', 'unknown'].includes(String(raw.status))
      : typeof raw.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.requestHash))
    || (expectedHash !== undefined && raw.requestHash !== null && raw.requestHash !== expectedHash)) throw Error('계정 결과의 원문 근거를 확인하지 못했습니다.');
  return { version: 1, reference: normalizeAccountManagementReference(raw.reference), actorUid,
    status: raw.status as AccountManagementResult['status'], requestHash: raw.requestHash as string | null, message: raw.message };
}
