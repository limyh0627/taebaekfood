import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../firebase';
import { normalizePartnerItemCleanupReference, normalizePartnerItemCleanupRequest, serializePartnerItemCleanupRequest, type PartnerItemCleanupRequest, type PartnerItemCleanupReadDTO, type PartnerItemCleanupResult, type PartnerItemCleanupReference } from '../../../functions/src/shared/partnerItemCleanup';
import type { CompanyId } from '../types';
export type { PartnerItemCleanupRequest, PartnerItemCleanupReadDTO, PartnerItemCleanupResult };
export interface PartnerItemCleanupScope { companyId: CompanyId; actorUid: string }
export interface PartnerItemCleanupAttempt { key: string; text: string; request: PartnerItemCleanupRequest | null; reference: PartnerItemCleanupReference | null; error: string }
export type CleanupCurrent = () => boolean;
const prefix = (s: PartnerItemCleanupScope) => `partner-item-cleanup-v1:${s.companyId}:${encodeURIComponent(s.actorUid)}:`;
const keyOf = (s: PartnerItemCleanupScope, r: PartnerItemCleanupReference) => prefix(s) + encodeURIComponent(r.linkId) + ':' + r.operationId;
async function active(s: PartnerItemCleanupScope, current: CleanupCurrent) {
 await authReady; const user = auth.currentUser;
 if (!current() || !user || user.uid !== s.actorUid) throw Error('회사·계정 또는 선택한 연결이 바뀌었습니다. 최초 요청은 보존했습니다.');
 const { claims } = await user.getIdTokenResult();
 if (!current() || auth.currentUser?.uid !== s.actorUid || claims.companyId !== s.companyId || claims.isAdmin !== true) throw Error('현재 회사의 관리자 권한을 다시 확인하세요.');
}
export const watchPartnerItemCleanupActor = (callback: (uid: string) => void) => onAuthStateChanged(auth, user => callback(user?.uid ?? ''));
export async function partnerItemCleanupActor() { await authReady; if (!auth.currentUser) throw Error('로그인이 만료되었습니다. 다시 로그인하세요.'); return auth.currentUser.uid; }
async function locked<T>(s: PartnerItemCleanupScope, current: CleanupCurrent, work: () => T): Promise<T> {
 if (!navigator.locks?.request) throw Error('여러 창의 요청 보호를 지원하는 브라우저에서 다시 시도하세요.');
 return navigator.locks.request(prefix(s), { mode: 'exclusive' }, async () => { await active(s, current); return work(); });
}
export function listPartnerItemCleanupAttempts(s: PartnerItemCleanupScope): PartnerItemCleanupAttempt[] {
 return Object.keys(localStorage).filter(key => key.startsWith(prefix(s))).map(key => {
  const text = localStorage.getItem(key)!; let reference: PartnerItemCleanupReference | null = null;
  try { const suffix = key.slice(prefix(s).length), separator = suffix.indexOf(':'), linkId = decodeURIComponent(suffix.slice(0, separator)), operationId = suffix.slice(separator + 1); if (separator < 1) throw Error(); reference = normalizePartnerItemCleanupReference({ companyId: s.companyId, linkId, operationId }); if (keyOf(s, reference) !== key) throw Error(); } catch { reference = null; }
  try { const request = normalizePartnerItemCleanupRequest(JSON.parse(text)); if (!reference || request.companyId !== s.companyId || keyOf(s, request) !== key || serializePartnerItemCleanupRequest(request) !== text) throw Error(); return { key, text, request, reference, error: '' }; }
  catch { return { key, text, request: null, reference, error: reference ? '보관 본문을 판독하지 못했습니다. 처리 결과를 확인하거나 미처리 요청을 중단하세요.' : '저장 키와 본문을 확인하지 못했습니다. 원문을 보존하고 관리자에게 확인하세요.' }; }
 });
}
export async function previewPartnerItemCleanup(s: PartnerItemCleanupScope, linkId: string, current: CleanupCurrent = () => true): Promise<PartnerItemCleanupReadDTO> {
 await active(s, current); const call = httpsCallable<unknown, PartnerItemCleanupReadDTO>(functions, 'partnerItemCleanupCommand');
 const result = (await call({ mode: 'read', companyId: s.companyId, linkId })).data; await active(s, current);
 if (!result || result.companyId !== s.companyId || result.linkId !== linkId || !['missing-link', 'archived', 'missing-item', 'active', 'unconfirmed'].includes(result.state) || typeof result.message !== 'string') throw Error('선택한 연결의 서버 확인 결과가 다릅니다. 다시 확인하세요.');
 return result;
}
async function hash(text: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join(''); }
function validResult(result: PartnerItemCleanupResult, s: PartnerItemCleanupScope, ref: PartnerItemCleanupReference) {
 return !!result && result.companyId === s.companyId && result.actorUid === s.actorUid && result.linkId === ref.linkId && result.operationId === ref.operationId && ['applied', 'rejected', 'discarded', 'unknown'].includes(result.status) && typeof result.message === 'string' && typeof result.opaqueFence === 'boolean' && (result.opaqueFence ? result.status === 'discarded' && result.requestText === null && result.requestHash === null : result.status === 'unknown' && result.requestText === null && result.requestHash === null || typeof result.requestText === 'string' && typeof result.requestHash === 'string' && /^[a-f0-9]{64}$/.test(result.requestHash));
}
async function finish(s: PartnerItemCleanupScope, entry: PartnerItemCleanupAttempt, result: PartnerItemCleanupResult, current: CleanupCurrent, clearRejected: boolean) {
 await locked(s, current, () => { if (localStorage.getItem(entry.key) !== entry.text) throw Error('보관 사본이 바뀌었습니다. 결과를 반영하지 않았습니다.'); if (result.status === 'applied' || result.status === 'discarded' || result.status === 'rejected' && clearRejected) localStorage.removeItem(entry.key); });
}
export async function applyPartnerItemCleanup(s: PartnerItemCleanupScope, input: PartnerItemCleanupRequest, current: CleanupCurrent = () => true): Promise<PartnerItemCleanupResult> {
 const text = serializePartnerItemCleanupRequest(input), request = JSON.parse(text) as PartnerItemCleanupRequest;
 if (request.companyId !== s.companyId) throw Error('요청 회사와 현재 회사가 다릅니다.');
 const key = keyOf(s, request); await locked(s, current, () => { const old = localStorage.getItem(key); if (old !== null && old !== text) throw Error('같은 요청 번호의 최초 원문이 다릅니다. 처리 결과를 먼저 확인하세요.'); if (old === null) localStorage.setItem(key, text); if (localStorage.getItem(key) !== text) throw Error('최초 요청 보관을 확인하지 못해 전송하지 않았습니다.'); });
 return recoverPartnerItemCleanup(s, { key, text, request, reference: { companyId: request.companyId, linkId: request.linkId, operationId: request.operationId }, error: '' }, 'apply', current);
}
export async function recoverPartnerItemCleanup(s: PartnerItemCleanupScope, entry: PartnerItemCleanupAttempt, mode: 'apply' | 'inspect-request' | 'discard-request', current: CleanupCurrent = () => true): Promise<PartnerItemCleanupResult> {
 const ref = entry.reference;
 if (!ref || ref.companyId !== s.companyId || entry.key !== keyOf(s, ref) || mode === 'apply' && !entry.request) throw Error('최초 요청 또는 정확한 저장 참조가 없어 재시도할 수 없습니다.');
 if (entry.request && (serializePartnerItemCleanupRequest(entry.request) !== entry.text || keyOf(s, entry.request) !== entry.key)) throw Error('최초 요청과 저장 사본이 다릅니다.');
 await locked(s, current, () => { if (localStorage.getItem(entry.key) !== entry.text) throw Error('최초 보관 사본이 바뀌었습니다. 전송하지 않았습니다.'); });
 const expectedHash = entry.request ? await hash(entry.text) : null; await active(s, current);
 const call = httpsCallable<unknown, PartnerItemCleanupResult>(functions, 'partnerItemCleanupCommand');
 const result = (await call({ mode, ...(entry.request ? { request: JSON.parse(entry.text) } : { reference: ref }) })).data; await active(s, current);
 if (!validResult(result, s, ref) || entry.request && !result.opaqueFence && (result.requestText !== entry.text || result.requestHash !== expectedHash)) throw Error('서버 결과가 최초 요청과 일치하지 않습니다. 사본을 보존했습니다. 처리 결과를 다시 확인하세요.');
 await finish(s, entry, result, current, mode === 'discard-request'); return result;
}
