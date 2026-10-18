import { cleanupValidId } from './partnerItemCleanup';
import { retirementCalendarDay } from './retirementBenefit';

export const LEAVE_BATCH_MAX_ROWS = 400;
export const LEAVE_BATCH_MAX_BYTES = 256 * 1024;
export const LEAVE_BATCH_OPERATIONS = 'leaveRequestOperations';
export type LeaveBatchCompany = 'taebaek' | 'punghoe';
export interface LeaveBatchReference { companyId: LeaveBatchCompany; planId: string }
interface LeaveBatchRowBase {
  id: string; employeeId: string; employeeName: string;
  type: '연차' | '오전반차' | '오후반차' | '병가' | '경조사' | '기타' | '휴가';
  startDate: string; endDate: string; reason: string;
  requestedAt: string; daysUsed: number;
}
export type LeaveBatchRow = LeaveBatchRowBase & ({status:'approved';deductsLeave:boolean}|{status:'pending';deductsLeave?:never});
export interface LeaveCreateRequest extends LeaveBatchReference { version: 1; rows: LeaveBatchRow[] }
export type LeaveMutationAction =
  | { action: 'approve' | 'reject' | 'request-cancel' | 'approve-modify' | 'reject-modify' }
  | { action: 'cancel'; reason?: string }
  | { action: 'request-modify'; modifyRequest: { startDate: string; endDate: string; reason: string; daysUsed: number } };
export function leaveActionLabel(action: LeaveMutationAction['action']): string {
  return {
    approve:'신청 승인', reject:'신청 반려', 'request-cancel':'취소 신청', cancel:'휴가 취소',
    'request-modify':'변경 신청', 'approve-modify':'변경 승인', 'reject-modify':'변경 반려',
  }[action];
}
export type LeaveMutationRequest = LeaveBatchReference & LeaveMutationAction & {
  version: 2; kind: 'mutation'; targetId: string; expected: Record<string, unknown>;
};
export type LeaveBatchRequest = LeaveCreateRequest | LeaveMutationRequest;
export const LEAVE_EXPECTED_FIELDS = ['companyId','employeeId','employeeName','type','startDate','endDate','reason','status','requestedAt','daysUsed','deductsLeave','modifyRequest','cancelledAt','cancelledBy','cancelledByName','cancelReason'] as const;
const MODIFY_FIELDS = ['startDate','endDate','reason','daysUsed','status'] as const;
function jsonEvidence(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonEvidence);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key,jsonEvidence(value[key])]));
  throw Error('휴가 원문의 비교 근거를 확인해 주세요.');
}
/** 생성 검증과 달리 기존 값은 재해석하지 않는다. 없는 칸과 null·false·0을 구별한다. */
export function leaveRequestExpected(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw Error('휴가 원문을 확인해 주세요.');
  return Object.fromEntries(LEAVE_EXPECTED_FIELDS.filter(key => Object.prototype.hasOwnProperty.call(value,key)).map(key => {
    const original = value[key];
    const projected = key === 'modifyRequest' && isRecord(original)
      ? Object.fromEntries(MODIFY_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(original,field)).map(field => [field,original[field]]))
      : original;
    return [key,jsonEvidence(projected)];
  }));
}
export const leaveRequestBusinessIds = (request: LeaveBatchRequest): string[] => request.version === 2 ? [request.targetId] : request.rows.map(row => row.id);
export type LeaveBatchCommand = { mode: 'apply'; request: LeaveBatchRequest }
  | { mode: 'inspect' | 'cancel'; reference: LeaveBatchReference; requestHash?: string };
export interface LeaveBatchResult extends LeaveBatchReference {
  status: 'applied' | 'duplicate' | 'rejected' | 'cancelled' | 'unknown';
  actorUid: string; requestHash: string | null; requestIds: string[]; message: string;
}
const validRequestedAt = (value: unknown): value is string => retirementCalendarDay(value) || typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error('휴가 요청 형식을 확인해 주세요.');
}
export function normalizeLeaveBatchReference(value: unknown): LeaveBatchReference {
  exact(value, ['companyId', 'planId']);
  if (!['taebaek','punghoe'].includes(String(value.companyId)) || !cleanupValidId(value.planId)) throw Error('단체 휴가의 회사와 작업 번호를 확인해 주세요.');
  return { companyId: value.companyId as LeaveBatchCompany, planId: value.planId };
}
export function normalizeLeaveBatchRequest(value: LeaveCreateRequest): LeaveCreateRequest;
export function normalizeLeaveBatchRequest(value: LeaveMutationRequest): LeaveMutationRequest;
export function normalizeLeaveBatchRequest(value: unknown): LeaveBatchRequest;
export function normalizeLeaveBatchRequest(value: unknown): LeaveBatchRequest {
  if (isRecord(value) && value.version === 2) return normalizeLeaveMutation(value);
  exact(value, ['version','companyId','planId','rows']);
  const reference = normalizeLeaveBatchReference({companyId:value.companyId,planId:value.planId});
  if (value.version !== 1 || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > LEAVE_BATCH_MAX_ROWS) throw Error('단체 휴가는 한 번에 1~400명까지 등록할 수 있습니다.');
  const pending = value.rows.length === 1 && value.rows[0]?.status === 'pending';
  const ids = new Set<string>(), employees = new Set<string>();
  const rows = value.rows.map(row => {
    exact(row, ['id','employeeId','employeeName','type','startDate','endDate','reason','status','requestedAt','daysUsed',...(pending?[]:['deductsLeave'])]);
    if (!cleanupValidId(row.id) || !cleanupValidId(row.employeeId) || ids.has(row.id) || employees.has(row.employeeId)) throw Error('휴가 번호와 대상 직원이 중복되었거나 올바르지 않습니다.');
    if (typeof row.employeeName !== 'string' || !row.employeeName.trim() || typeof row.reason !== 'string'
      || !(pending?['연차','오전반차','오후반차','경조사','기타']:['연차','오전반차','오후반차','병가','경조사','기타','휴가']).includes(String(row.type)) || row.status !== (pending?'pending':'approved')
      || !retirementCalendarDay(row.startDate) || !retirementCalendarDay(row.endDate) || row.startDate > row.endDate
      || !validRequestedAt(row.requestedAt) || typeof row.daysUsed !== 'number' || !Number.isFinite(row.daysUsed) || (pending ? row.daysUsed < 0 : row.daysUsed <= 0)
      || !pending && typeof row.deductsLeave !== 'boolean') throw Error('휴가 유형·날짜·승인 상태·일수·차감 여부를 확인해 주세요.');
    ids.add(row.id); employees.add(row.employeeId);
    return {id:row.id,employeeId:row.employeeId,employeeName:row.employeeName,type:row.type as LeaveBatchRow['type'],startDate:row.startDate,endDate:row.endDate,reason:row.reason,requestedAt:row.requestedAt,daysUsed:row.daysUsed,...(pending?{status:'pending' as const}:{status:'approved' as const,deductsLeave:row.deductsLeave as boolean})};
  });
  const request: LeaveCreateRequest = {version:1,...reference,rows};
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > LEAVE_BATCH_MAX_BYTES) throw Error('단체 휴가 요청이 너무 큽니다. 대상이나 사유를 나누어 주세요.');
  return request;
}
function normalizeLeaveMutation(value: Record<string, unknown>): LeaveMutationRequest {
  const action = value.action;
  const actions = ['approve','reject','request-cancel','cancel','request-modify','approve-modify','reject-modify'];
  exact(value,['version','kind','companyId','planId','targetId','expected','action',...(action === 'cancel' ? ['reason'] : action === 'request-modify' ? ['modifyRequest'] : [])]);
  const reference = normalizeLeaveBatchReference({companyId:value.companyId,planId:value.planId});
  if (value.kind !== 'mutation' || !cleanupValidId(value.targetId) || !actions.includes(String(action))) throw Error('휴가 변경 종류와 대상을 확인해 주세요.');
  exact(value.expected,LEAVE_EXPECTED_FIELDS);
  const expected = leaveRequestExpected(value.expected);
  let payload: LeaveMutationAction;
  if (action === 'cancel') {
    if (value.reason !== undefined && typeof value.reason !== 'string') throw Error('취소 사유를 확인해 주세요.');
    payload = {action,...(value.reason !== undefined ? {reason:value.reason as string} : {})};
  } else if (action === 'request-modify') {
    exact(value.modifyRequest,['startDate','endDate','reason','daysUsed']);
    const change = value.modifyRequest;
    if (!retirementCalendarDay(change.startDate) || !retirementCalendarDay(change.endDate) || change.startDate > change.endDate || typeof change.reason !== 'string' || !change.reason.trim() || typeof change.daysUsed !== 'number' || !Number.isFinite(change.daysUsed) || change.daysUsed < 0) throw Error('변경할 휴가 날짜·사유·일수를 확인해 주세요.');
    payload = {action,modifyRequest:{startDate:change.startDate,endDate:change.endDate,reason:change.reason,daysUsed:change.daysUsed}};
  } else payload = {action:action as Exclude<LeaveMutationAction['action'],'cancel'|'request-modify'>};
  const request: LeaveMutationRequest = {version:2,kind:'mutation',...reference,targetId:value.targetId,expected,...payload};
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > LEAVE_BATCH_MAX_BYTES) throw Error('휴가 변경 원문이 너무 큽니다.');
  return request;
}
/** 고정 필드 순서와 원래 행 순서를 보존해 브라우저·서버가 같은 원문을 비교한다. */
export const serializeLeaveBatchRequest = (value: unknown): string => JSON.stringify(normalizeLeaveBatchRequest(value));

export function normalizeLeaveBatchResult(value: unknown, reference: LeaveBatchReference, actorUid: string, requestHash?: string, expectedIds?: readonly string[]): LeaveBatchResult {
  exact(value, ['status','companyId','planId','actorUid','requestHash','requestIds','message']);
  if (value.companyId !== reference.companyId || value.planId !== reference.planId || value.actorUid !== actorUid
    || !['applied','duplicate','rejected','cancelled','unknown'].includes(String(value.status)) || typeof value.message !== 'string'
    || !Array.isArray(value.requestIds) || value.requestIds.length > LEAVE_BATCH_MAX_ROWS || value.requestIds.some(id=>!cleanupValidId(id)) || new Set(value.requestIds).size !== value.requestIds.length
    || !(value.requestHash === null || typeof value.requestHash === 'string' && /^[a-f0-9]{64}$/.test(value.requestHash))) throw Error('단체 휴가 응답의 회사·계정·작업 번호를 확인해 주세요.');
  if ((value.status === 'applied' || value.status === 'duplicate') && (value.requestHash === null || !value.requestIds.length)
    || value.status === 'unknown' && (value.requestHash !== null || value.requestIds.length !== 0)
    || value.requestHash === null && (!['cancelled','unknown'].includes(String(value.status)) || value.requestIds.length !== 0)
    || requestHash !== undefined && value.requestHash !== null && value.requestHash !== requestHash
    || expectedIds !== undefined && value.requestHash !== null && JSON.stringify(value.requestIds) !== JSON.stringify(expectedIds)) throw Error('단체 휴가 최초 원문과 처리 결과가 다릅니다.');
  return {...reference,status:value.status as LeaveBatchResult['status'],actorUid,requestHash:value.requestHash as string|null,requestIds:[...value.requestIds] as string[],message:value.message};
}
