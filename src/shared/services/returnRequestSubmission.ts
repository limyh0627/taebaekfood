import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../firebase';
import type { CompanyId } from '../types';
type RequestBody = Record<string, any>;
export type PendingReturnSubmission = { version: 1; companyId: CompanyId; userId: string; requestId: string; request: RequestBody };
const keyOf = (companyId: CompanyId, uid: string) => `return-submission:${companyId}:${uid}`;
export const returnSubmissionActorUid = () => auth.currentUser?.uid;
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
 ? Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([key,v]) => [key,canonical(v)])) : value;
export async function returnSubmissionRequestHash(request: RequestBody) {
 const {id: _, ...body} = request;
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(body))))),byte=>byte.toString(16).padStart(2,'0')).join('');
}
const running = new Set<string>();
const notify = () => window.dispatchEvent(new Event('return-submission-pending'));
export function getPendingReturnSubmission(companyId: CompanyId): PendingReturnSubmission | null {
 const uid = auth.currentUser?.uid; if (!uid) return null;
 const text = localStorage.getItem(keyOf(companyId, uid)); if (!text) return null;
 try { const p = JSON.parse(text) as PendingReturnSubmission;
  if (p.version !== 1 || p.companyId !== companyId || p.userId !== uid || typeof p.requestId !== 'string' || !p.requestId
    || !p.request || p.request.companyId !== companyId || !['매출','매입'].includes(p.request.returnType)
    || !Number.isSafeInteger(p.request.totalAmount) || p.request.totalAmount <= 0 || p.request.status !== 'pending'
    || typeof p.request.partnerId !== 'string' || !p.request.partnerId || !Array.isArray(p.request.items) || !p.request.items.length) throw Error();
  return p;
 } catch { throw new Error('이전 반품 접수 원문을 확인해야 합니다. 원문은 보존했습니다.'); }
}
async function authorize(companyId: CompanyId, uid: string) {
 const check = () => { if (auth.currentUser?.uid !== uid) throw new Error('로그인 사용자가 변경되었습니다. 이전 접수 원문은 보존했습니다.'); };
 await authReady; check(); const token = await auth.currentUser!.getIdTokenResult(); check();
 if (token.claims.companyId !== companyId || typeof token.claims.employeeId !== 'string') throw new Error('현재 회사의 로그인 권한을 확인해주세요.');
 return check;
}
async function send(p: PendingReturnSubmission) {
 const key = keyOf(p.companyId, p.userId); if (running.has(key)) throw new Error('이전 반품 접수를 확인 중입니다.');
 running.add(key);
 try {
  const check = await authorize(p.companyId, p.userId); const requestHash = await returnSubmissionRequestHash(p.request); check(); const text = JSON.stringify(p);
  const old = localStorage.getItem(key); if (old !== null && old !== text) throw new Error('이전 반품 접수 원문을 먼저 확인해주세요.');
  localStorage.setItem(key, text); notify(); check();
  try {
  const call = httpsCallable<unknown, {status:'created'|'duplicate';requestId:string;actorId:string;requestHash:string}>(functions,'submitReturnRequestCommand');
  const result = await call({companyId:p.companyId,requestId:p.requestId,request:p.request}); check();
  if (!result.data || !['created','duplicate'].includes(result.data.status) || result.data.requestId !== p.requestId
    || result.data.actorId !== p.userId || result.data.requestHash !== requestHash)
    throw new Error('반품 접수 결과를 확인하지 못했습니다. 원문은 보존했습니다.');
  if (localStorage.getItem(key) === text) { localStorage.removeItem(key); notify(); }
  return result.data.status;
  } catch(error) {
   const d = (error as {details?:Record<string,unknown>})?.details;
   if (auth.currentUser?.uid === p.userId && d?.version === 1 && d.operationStatus === 'rejected'
     && d.receiptStatus === 'rejected' && d.terminalConfirmed === true && d.submissionWrites === false && d.financialWrites === false && d.companyId === p.companyId
     && d.requestId === p.requestId && d.actorId === p.userId && d.requestHash === requestHash
     && localStorage.getItem(key) === text) { localStorage.removeItem(key); notify(); }
   throw error;
  }
 } finally { running.delete(key); }
}
export async function submitReturnRequest(companyId: CompanyId, request: RequestBody) {
 const uid = auth.currentUser?.uid; if (!uid) throw new Error('로그인을 확인해주세요.');
 if (request.companyId !== companyId || !request.partnerId || !Array.isArray(request.items) || !request.items.length
   || request.status !== 'pending') throw new Error('반품 접수 원문을 확인해주세요.');
 const check = await authorize(companyId, uid);
 const claim = () => {
  check(); const prior = getPendingReturnSubmission(companyId);
  if (prior) {
   if (JSON.stringify(canonical(prior.request)) !== JSON.stringify(canonical(request))) throw new Error('이전 반품 접수 확인 버튼으로 저장 결과를 먼저 확인해주세요.');
   return prior;
  }
  const p: PendingReturnSubmission = {version:1,companyId,userId:uid,requestId:`return-request-${crypto.randomUUID()}`,request:JSON.parse(JSON.stringify(request))};
  localStorage.setItem(keyOf(companyId, uid), JSON.stringify(p)); notify(); return p;
 };
 // 네트워크를 기다리지 않고 localStorage 원문 선택·저장만 같은 브라우저 탭 사이에서 직렬화한다.
 const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
 const p = locks ? await locks.request(keyOf(companyId, uid), claim) : claim();
 check(); return send(p);
}
export async function resumeReturnSubmission(companyId: CompanyId) {
 const p = getPendingReturnSubmission(companyId); if (!p) throw new Error('확인할 이전 반품 접수가 없습니다.');
 return send(p);
}
