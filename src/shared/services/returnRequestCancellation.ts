import { httpsCallable } from 'firebase/functions';
import { auth, authReady, functions } from '../firebase';
import type { CompanyId, ReturnRequest } from '../types';

type Command = { companyId: CompanyId; requestId: string; operationId: string; expectedRequest: Record<string, unknown> };
type Result = { status: 'cancelled' | 'duplicate'; requestId: string; operationId: string; requestHash: string };
const running = new Set<string>();
const keyOf = (company: CompanyId, uid: string, id: string) => `return-cancellation:${company}:${uid}:${id}`;
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value.toMillis === 'function' ? { timestampMillis: value.toMillis() }
  : value instanceof Date ? { dateISO: value.toISOString() }
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
const encoded = (value: unknown) => JSON.stringify(canonical(value));
async function hash(value: unknown) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded(value))))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function pending(companyId: CompanyId, uid: string, requestId: string): Command | null {
  const text = localStorage.getItem(keyOf(companyId, uid, requestId));
  if (!text) return null;
  try {
    const saved = JSON.parse(text) as Command;
    if (saved.companyId !== companyId || saved.requestId !== requestId || !/^rc-[A-Za-z0-9_-]+$/.test(saved.operationId)
      || !saved.expectedRequest || saved.expectedRequest.companyId !== companyId) throw Error();
    return saved;
  } catch { throw new Error('보존된 반품 취소 요청을 확인해주세요.'); }
}
async function send(command: Command, uid: string): Promise<void> {
  const key = keyOf(command.companyId, uid, command.requestId);
  if (running.has(key)) throw new Error('반품 취소 결과를 확인 중입니다.');
  running.add(key);
  try {
    const check = async () => {
      if (auth.currentUser?.uid !== uid) throw new Error('로그인 사용자가 바뀌었습니다.');
      const claims = (await auth.currentUser.getIdTokenResult()).claims;
      if (auth.currentUser?.uid !== uid || claims.companyId !== command.companyId || claims.isAdmin !== true)
        throw new Error('현재 회사 관리자 권한을 확인해주세요.');
    };
    await authReady; await check();
    const text = encoded(command), previous = localStorage.getItem(key);
    if (previous !== null && previous !== text) throw new Error('이전 취소 요청을 먼저 확인해주세요.');
    const requestHash = await hash(command);
    await check();
    if (localStorage.getItem(key) !== previous) throw new Error('다른 취소 요청이 진행 중입니다.');
    localStorage.setItem(key, text);
    try {
      const reply = (await httpsCallable<Command, Result>(functions, 'cancelPendingReturnCommand')(command)).data;
      await check();
      if (!reply || !['cancelled', 'duplicate'].includes(reply.status) || reply.requestId !== command.requestId
        || reply.operationId !== command.operationId || reply.requestHash !== requestHash)
        throw new Error('취소 결과가 확인되지 않았습니다. 같은 요청으로 다시 확인해주세요.');
      if (localStorage.getItem(key) === text) localStorage.removeItem(key);
    } catch (error) {
      await check();
      const proof = (error as { details?: { cancellationRejected?: any } })?.details?.cancellationRejected;
      if (proof?.version === 1 && proof.terminalConfirmed === true && proof.status === 'rejected'
        && proof.companyId === command.companyId && proof.actorId === uid && proof.requestId === command.requestId
        && proof.operationId === command.operationId && proof.requestHash === requestHash
        && encoded(proof.command) === text && localStorage.getItem(key) === text) localStorage.removeItem(key);
      throw error;
    }
  } finally { running.delete(key); }
}
export function hasPendingReturnCancellation(companyId: CompanyId, requestId: string): boolean {
  const uid = auth.currentUser?.uid;
  return !!uid && localStorage.getItem(keyOf(companyId, uid, requestId)) !== null;
}
export async function cancelReturnRequest(companyId: CompanyId, original: ReturnRequest): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid || original.companyId !== companyId || original.status !== 'pending') throw new Error('현재 회사의 처리 대기 반품을 확인해주세요.');
  const { id, ...body } = original;
  const saved = pending(companyId, uid, id);
  if (saved && encoded(saved.expectedRequest) !== encoded(body)) throw new Error('이전 취소 결과 확인 버튼으로 먼저 확인해주세요.');
  return send(saved ?? { companyId, requestId: id, operationId: `rc-${crypto.randomUUID()}`, expectedRequest: canonical(body) }, uid);
}
export async function resumeReturnCancellation(companyId: CompanyId, requestId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const saved = pending(companyId, uid, requestId);
  if (!saved) throw new Error('보존된 취소 요청이 없습니다.');
  return send(saved, uid);
}
