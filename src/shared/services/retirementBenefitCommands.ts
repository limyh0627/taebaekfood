import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../firebase';
import { normalizeRetirementRequest, serializeRetirementRequest, type RetirementCompany, type RetirementRequest, type RetirementReadDTO, type RetirementCommandResult } from '../retirementBenefit';
export interface RetirementScope { companyId: RetirementCompany; employeeId: string; actorUid: string }
export interface RetirementAttempt { key: string; text: string; verified: boolean; operationId: string | null; request: RetirementRequest | null; result: RetirementCommandResult | null; error: string }
export type RetirementCurrent = () => boolean;
function resultShape(r: RetirementCommandResult): boolean {
 return typeof r.opaqueFence === 'boolean' && typeof r.message === 'string' && (r.errorCode === null || typeof r.errorCode === 'string') && (r.revision === null || Number.isSafeInteger(r.revision) && r.revision >= 0) && (r.opaqueFence ? r.status === 'discarded' && r.requestText === null && r.requestHash === null : r.requestText === null && r.requestHash === null && r.status === 'unknown' || typeof r.requestText === 'string' && typeof r.requestHash === 'string' && /^[a-f0-9]{64}$/.test(r.requestHash));
}
const verifiedResults = new Map<string, string>();
const prefix = (s: RetirementScope) => `retirement-v1:${s.companyId}:${encodeURIComponent(s.actorUid)}:${encodeURIComponent(s.employeeId)}:`;
const keyOf = (s: RetirementScope, r: RetirementRequest) => prefix(s) + r.operationId;
export async function retirementActor(): Promise<string> { await authReady; if (!auth.currentUser) throw Error('로그인이 만료되었습니다. 다시 로그인하세요.'); return auth.currentUser.uid; }
async function active(s: RetirementScope, current: RetirementCurrent) {
 await authReady;
 const user = auth.currentUser;
 if (!current() || !user || user.uid !== s.actorUid) throw Error('회사·직원 또는 로그인 계정이 바뀌었습니다. 최초 요청은 보존했습니다.');
 const { claims } = await user.getIdTokenResult();
 if (!current() || auth.currentUser?.uid !== s.actorUid || claims.companyId !== s.companyId || claims.isAdmin !== true) throw Error('현재 회사의 관리자 권한을 다시 확인하세요.');
}
async function locked<T>(s: RetirementScope, current: RetirementCurrent, work: () => T): Promise<T> {
 if (!navigator.locks?.request) throw Error('여러 창의 요청 보호를 지원하는 브라우저에서 다시 시도하세요.');
 return navigator.locks.request(prefix(s), { mode: 'exclusive' }, async () => { await active(s, current); return work(); });
}
export function listRetirementAttempts(s: RetirementScope): RetirementAttempt[] {
 return Object.keys(localStorage).filter(k => k.startsWith(prefix(s)) && !k.endsWith(':result')).map(key => {
  const text = localStorage.getItem(key)!;
  const suffix = key.slice(prefix(s).length);
  const operationId = /^[A-Za-z0-9_:-]{1,160}$/.test(suffix) ? suffix : null;
  let request: RetirementRequest | null = null, result: RetirementCommandResult | null = null, error = '';
  try { request = normalizeRetirementRequest(JSON.parse(text)); if (serializeRetirementRequest(request) !== text || request.companyId !== s.companyId || request.employeeId !== s.employeeId || key !== keyOf(s, request)) throw Error(); }
  catch { request = null; error = '보관 원문이 손상됐습니다. 저장 키의 참조로 서버 결과를 확인하거나 안전 폐기하세요.'; }
  try { const raw = localStorage.getItem(key + ':result'); if (raw) { const value = JSON.parse(raw) as RetirementCommandResult; if (resultShape(value) && value.actorUid === s.actorUid && value.companyId === s.companyId && value.employeeId === s.employeeId && value.operationId === operationId && ['applied', 'rejected', 'discarded', 'unknown'].includes(value.status) && (!request || value.requestText === text || value.opaqueFence === true && value.status === 'discarded')) result = value; } } catch { /* 원문과 서버 재조회 경로를 보존한다. */ }
  return { key, text, verified: result !== null && verifiedResults.get(key) === text + JSON.stringify(result), operationId, request, result, error };
 });
}export async function readRetirement(s: RetirementScope, asOfDay: string, current: RetirementCurrent = () => true): Promise<RetirementReadDTO> {
 await active(s, current);
 const call = httpsCallable<unknown, RetirementReadDTO>(functions, 'retirementBenefitCommand');
 const result = (await call({ mode: 'read', companyId: s.companyId, employeeId: s.employeeId, asOfDay })).data;
 await active(s, current);
 if (!result || result.companyId !== s.companyId || result.employeeId !== s.employeeId || result.asOfDay !== asOfDay || !Object.prototype.hasOwnProperty.call(result, 'profile') || !Array.isArray(result.events)) throw Error('직원별 퇴직금 조회 결과를 확인하지 못했습니다. 다시 조회하세요.');
 return result;
}
async function hash(text: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, '0')).join(''); }
export async function retirementCommand(s: RetirementScope, input: RetirementRequest, mode: 'apply' | 'inspect-request' | 'discard-request' = 'apply', current: RetirementCurrent = () => true): Promise<RetirementCommandResult> {
 const text = serializeRetirementRequest(input), request = JSON.parse(text) as RetirementRequest;
 if (request.companyId !== s.companyId || request.employeeId !== s.employeeId) throw Error('요청 회사·직원과 현재 화면이 다릅니다.');
 await active(s, current);
 const key = keyOf(s, request);
 await locked(s, current, () => {
  const old = localStorage.getItem(key);
  if (old !== null && old !== text) throw Error('같은 작업 번호의 최초 원문이 다릅니다. 기존 요청의 결과를 먼저 확인하세요.');
  if (mode === 'apply' && old === null) localStorage.setItem(key, text);
  if (localStorage.getItem(key) !== text) throw Error('최초 요청 원문 보관을 확인하지 못했습니다. 전송하지 않았습니다.');
 });
 const requestHash = await hash(text);
 await active(s, current);
 const call = httpsCallable<unknown, RetirementCommandResult>(functions, 'retirementBenefitCommand');
 const result = (await call({ mode, request })).data;
 await active(s, current);
 if (!result || !resultShape(result) || !['applied', 'rejected', 'discarded', 'unknown'].includes(result.status) || result.companyId !== s.companyId || result.employeeId !== s.employeeId || result.actorUid !== s.actorUid || result.operationId !== request.operationId || !(result.opaqueFence === true && result.status === 'discarded' || result.requestHash === requestHash && result.requestText === text)) throw Error('처리 결과와 최초 원문이 일치하지 않습니다. 요청을 보존했습니다. 결과 확인을 다시 실행하세요.');
 await locked(s, current, () => {
  if (localStorage.getItem(key) !== text) throw Error('보관 원문이 바뀌었습니다. 서버 결과를 반영하지 않았습니다.');
  localStorage.setItem(key + ':result', JSON.stringify(result));
  verifiedResults.set(key, text + JSON.stringify(result));
 });
 return result;
}


/** 본문이 손상돼도 정확한 저장 키의 작업 참조로 서버 봉쇄 여부를 확인한다. */
export async function recoverRetirementReference(s: RetirementScope, entry: RetirementAttempt, mode: 'inspect-request' | 'discard-request', current: RetirementCurrent = () => true): Promise<RetirementCommandResult> {
 if (!entry.operationId || entry.key !== prefix(s) + entry.operationId) throw Error('저장 키의 작업 번호를 확인하지 못했습니다. 다른 요청으로 추측하지 않습니다.');
 await active(s, current);
 const call = httpsCallable<unknown, RetirementCommandResult>(functions, 'retirementBenefitCommand');
 const result = (await call({ mode, reference: { companyId: s.companyId, employeeId: s.employeeId, operationId: entry.operationId } })).data;
 await active(s, current);
 if (!result || !resultShape(result) || result.companyId !== s.companyId || result.employeeId !== s.employeeId || result.operationId !== entry.operationId || result.actorUid !== s.actorUid || !['applied', 'rejected', 'discarded', 'unknown'].includes(result.status)) throw Error('참조 조회 결과가 현재 직원·요청과 다릅니다. 사본을 보존했습니다.');
 if (entry.request && result.status !== 'unknown' && !result.opaqueFence && (result.requestText !== entry.text || result.requestHash !== await hash(entry.text))) throw Error('서버 결과가 최초 원문과 다릅니다. 사본을 보존했습니다.');
 await locked(s, current, () => {
  if (localStorage.getItem(entry.key) !== entry.text) throw Error('최초 보관 사본이 바뀌었습니다. 정리하지 않았습니다.');
  localStorage.setItem(entry.key + ':result', JSON.stringify(result));
  verifiedResults.set(entry.key, entry.text + JSON.stringify(result));
 });
 return result;
}
export async function clearRetirementAttempt(s: RetirementScope, entry: RetirementAttempt, current: RetirementCurrent = () => true): Promise<RetirementCommandResult> {
 const result = await recoverRetirementReference(s, entry, 'inspect-request', current);
 if (result.status === 'unknown') throw Error('서버 처리 여부가 미확인입니다. 안전 폐기로 늦은 처리를 봉쇄한 뒤 정리하세요.');
 await locked(s, current, () => {
  if (localStorage.getItem(entry.key) !== entry.text) throw Error('최초 보관 사본이 바뀌었습니다. 정리하지 않았습니다.');
  localStorage.removeItem(entry.key);
  localStorage.removeItem(entry.key + ':result');
  verifiedResults.delete(entry.key);
 });
 return result;
}
