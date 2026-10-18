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
export interface LeaveBatchRequest extends LeaveBatchReference { version: 1; rows: LeaveBatchRow[] }
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
export function normalizeLeaveBatchRequest(value: unknown): LeaveBatchRequest {
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
  const request: LeaveBatchRequest = {version:1,...reference,rows};
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > LEAVE_BATCH_MAX_BYTES) throw Error('단체 휴가 요청이 너무 큽니다. 대상이나 사유를 나누어 주세요.');
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
