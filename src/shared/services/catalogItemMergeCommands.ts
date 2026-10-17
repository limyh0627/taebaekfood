import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../firebase';
import { normalizeCatalogItemMergeReference, normalizeCatalogItemMergeRequest, serializeCatalogItemMergeRequest, type CatalogItemMergeRequest, type CatalogItemMergePreview, type CatalogItemMergeResult, type CatalogItemMergeReference } from '../../../functions/src/shared/catalogItemMerge';
import { cleanupValidId } from '../../../functions/src/shared/partnerItemCleanup';
import type { CompanyId } from '../types';
export type { CatalogItemMergeRequest, CatalogItemMergePreview, CatalogItemMergeResult };
export interface CatalogItemMergeScope { companyId: CompanyId; actorUid: string }
export interface CatalogItemMergeAttempt { key: string; text: string; request: CatalogItemMergeRequest | null; reference: CatalogItemMergeReference | null; error: string }
/** 범위를 모르는 사본은 보존하고, 알려진 사본은 실제 품목 ID가 겹칠 때만 선행 복구한다. */
export function catalogItemMergeAttemptBlocks(entry: CatalogItemMergeAttempt, keepId: string, donorIds: string[]): boolean {
 if (!entry.request) return true;
 const targets=new Set([keepId,...donorIds]);
 return [entry.request.keepId,...entry.request.donorIds].some(id=>targets.has(id));
}
export type CleanupCurrent = () => boolean;
const prefix = (s: CatalogItemMergeScope) => `catalog-item-merge-v1:${s.companyId}:${encodeURIComponent(s.actorUid)}:`;
const keyOf = (s: CatalogItemMergeScope, r: CatalogItemMergeReference) => prefix(s) + encodeURIComponent(r.operationId);
async function active(s: CatalogItemMergeScope, current: CleanupCurrent) {
 await authReady; const user = auth.currentUser;
 if (!current() || !user || user.uid !== s.actorUid) throw Error('회사·계정 또는 선택한 품목이 바뀌었습니다. 최초 요청은 보존했습니다.');
 const { claims } = await user.getIdTokenResult();
 if (!current() || auth.currentUser?.uid !== s.actorUid || claims.companyId !== s.companyId || claims.isAdmin !== true) throw Error('현재 회사의 관리자 권한을 다시 확인하세요.');
}
export const watchCatalogItemMergeActor = (callback: (uid: string) => void) => onAuthStateChanged(auth, user => callback(user?.uid ?? ''));
export async function catalogItemMergeActor() { await authReady; if (!auth.currentUser) throw Error('로그인이 만료되었습니다. 다시 로그인하세요.'); return auth.currentUser.uid; }
async function locked<T>(s: CatalogItemMergeScope, current: CleanupCurrent, work: () => T): Promise<T> {
 if (!navigator.locks?.request) throw Error('여러 창의 요청 보호를 지원하는 브라우저에서 다시 시도하세요.');
 return navigator.locks.request(prefix(s), { mode: 'exclusive' }, async () => { await active(s, current); return work(); });
}
export function listCatalogItemMergeAttempts(s: CatalogItemMergeScope): CatalogItemMergeAttempt[] {
 return Object.keys(localStorage).filter(key => key.startsWith(prefix(s))).map(key => {
  const text = localStorage.getItem(key)!; let reference: CatalogItemMergeReference | null = null;
  try { const operationId = decodeURIComponent(key.slice(prefix(s).length)); reference = normalizeCatalogItemMergeReference({ version: 1, companyId: s.companyId, operationId }); if (keyOf(s, reference) !== key) throw Error(); } catch { reference = null; }
  try { const request = normalizeCatalogItemMergeRequest(JSON.parse(text)); if (!reference || request.companyId !== s.companyId || keyOf(s, request) !== key || serializeCatalogItemMergeRequest(request) !== text) throw Error(); return { key, text, request, reference, error: '' }; }
  catch { return { key, text, request: null, reference, error: reference ? '보관 본문을 판독하지 못했습니다. 처리 결과를 확인하거나 미처리 요청을 중단하세요.' : '저장 키와 본문을 확인하지 못했습니다. 원문을 보존하고 관리자에게 확인하세요.' }; }
 });
}
export async function previewCatalogItemMerge(s: CatalogItemMergeScope, keepId: string, donorIds: string[], current: CleanupCurrent = () => true): Promise<CatalogItemMergePreview> {
 await active(s, current); const call = httpsCallable<unknown, CatalogItemMergePreview>(functions, 'catalogItemMergeCommand');
 const result = (await call({ mode: 'read', companyId: s.companyId, keepId, donorIds })).data; await active(s, current);
 if (!result || result.companyId !== s.companyId || result.releaseId !== null && !cleanupValidId(result.releaseId) || !/^[a-f0-9]{64}$/.test(result.snapshotDigest) || !result.plan || result.plan.keepId !== keepId || !Array.isArray(result.plan.donorIds) || JSON.stringify([...result.plan.donorIds].sort()) !== JSON.stringify([...donorIds].sort()) || !['ready','blocked','needs-resolution'].includes(result.plan.phase) || !Array.isArray(result.plan.blockers) || !Array.isArray(result.plan.groups) || !Array.isArray(result.candidateLinks) || result.plan.groups.some(group => !group || typeof group.destinationKey !== 'string' || !Array.isArray(group.candidateLinkIds) || !group.candidateLinkIds.every(cleanupValidId) || !['in','out'].includes(group.direction)) || result.plan.blockers.some(row => !row || typeof row.message !== 'string' || !['review-item','review-inventory','review-orders','review-bom','reload'].includes(row.nextAction) || typeof row.itemId !== 'string' || !Array.isArray(row.documentIds)) || result.candidateLinks.some(row => !row || typeof row.id !== 'string' || typeof row.itemId !== 'string' || typeof row.partnerId !== 'string' || typeof row.itemName !== 'string' || !row.business || typeof row.business !== 'object' || Array.isArray(row.business))) throw Error('선택한 품목의 서버 확인 결과가 다릅니다. 다시 확인하세요.');
 return result;
}
async function hash(text: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join(''); }
function validResult(result: CatalogItemMergeResult, s: CatalogItemMergeScope, ref: CatalogItemMergeReference) {
 return !!result && result.version === 1 && result.companyId === s.companyId && result.actorUid === s.actorUid && result.operationId === ref.operationId && ['applied', 'rejected', 'discarded', 'unknown'].includes(result.status) && typeof result.message === 'string' && typeof result.opaqueFence === 'boolean' && (result.opaqueFence ? result.status === 'discarded' && result.requestText === null && result.requestHash === null : result.status === 'unknown' && result.requestText === null && result.requestHash === null || typeof result.requestText === 'string' && typeof result.requestHash === 'string' && /^[a-f0-9]{64}$/.test(result.requestHash));
}
async function finish(s: CatalogItemMergeScope, entry: CatalogItemMergeAttempt, result: CatalogItemMergeResult, current: CleanupCurrent, clearRejected: boolean) {
 await locked(s, current, () => { if (localStorage.getItem(entry.key) !== entry.text) throw Error('보관 사본이 바뀌었습니다. 결과를 반영하지 않았습니다.'); if (result.status === 'applied' || result.status === 'discarded' || result.status === 'rejected' && clearRejected) localStorage.removeItem(entry.key); });
}
export async function applyCatalogItemMerge(s: CatalogItemMergeScope, input: CatalogItemMergeRequest, current: CleanupCurrent = () => true): Promise<CatalogItemMergeResult> {
 const text = serializeCatalogItemMergeRequest(input), request = JSON.parse(text) as CatalogItemMergeRequest;
 if (request.companyId !== s.companyId) throw Error('요청 회사와 현재 회사가 다릅니다.');
 const key = keyOf(s, request); await locked(s, current, () => { const old = localStorage.getItem(key); if (old !== null && old !== text) throw Error('같은 요청 번호의 최초 원문이 다릅니다. 처리 결과를 먼저 확인하세요.'); if (old === null && listCatalogItemMergeAttempts(s).some(row => row.key !== key && catalogItemMergeAttemptBlocks(row, request.keepId, request.donorIds))) throw Error('이전 통합 요청의 처리 결과를 먼저 확인하거나 요청을 중단하세요.'); if (old === null) localStorage.setItem(key, text); if (localStorage.getItem(key) !== text) throw Error('최초 요청 보관을 확인하지 못해 전송하지 않았습니다.'); });
 return recoverCatalogItemMerge(s, { key, text, request, reference: { version: 1, companyId: request.companyId, operationId: request.operationId }, error: '' }, 'apply', current);
}
export async function recoverCatalogItemMerge(s: CatalogItemMergeScope, entry: CatalogItemMergeAttempt, mode: 'apply' | 'inspect-request' | 'discard-request', current: CleanupCurrent = () => true): Promise<CatalogItemMergeResult> {
 const ref = entry.reference;
 if (!ref || ref.companyId !== s.companyId || entry.key !== keyOf(s, ref) || mode === 'apply' && !entry.request) throw Error('최초 요청 또는 정확한 저장 참조가 없어 재시도할 수 없습니다.');
 if (entry.request && (serializeCatalogItemMergeRequest(entry.request) !== entry.text || keyOf(s, entry.request) !== entry.key)) throw Error('최초 요청과 저장 사본이 다릅니다.');
 await locked(s, current, () => { if (localStorage.getItem(entry.key) !== entry.text) throw Error('최초 보관 사본이 바뀌었습니다. 전송하지 않았습니다.'); });
 const expectedHash = entry.request ? await hash(entry.text) : null; await active(s, current);
 const call = httpsCallable<unknown, CatalogItemMergeResult>(functions, 'catalogItemMergeCommand');
 const result = (await call({ mode, ...(entry.request ? { request: JSON.parse(entry.text) } : { reference: ref }) })).data; await active(s, current);
 if (!validResult(result, s, ref) || entry.request && !result.opaqueFence && (result.requestText !== entry.text || result.requestHash !== expectedHash)) throw Error('서버 결과가 최초 요청과 일치하지 않습니다. 사본을 보존했습니다. 처리 결과를 다시 확인하세요.');
 if (!result.opaqueFence && result.requestText !== null) {
  let original: CatalogItemMergeRequest; try { original = normalizeCatalogItemMergeRequest(JSON.parse(result.requestText)); } catch { throw Error('서버 영수증 원문을 판독하지 못했습니다. 보관 사본을 유지했습니다.'); }
  if (original.companyId !== ref.companyId || original.operationId !== ref.operationId || serializeCatalogItemMergeRequest(original) !== result.requestText || await hash(result.requestText) !== result.requestHash) throw Error('서버 영수증의 최초 요청 참조가 다릅니다. 사본을 보존했습니다.');
 }
 await finish(s, entry, result, current, mode === 'discard-request'); return result;
}
