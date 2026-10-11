import type { ChatMessage, CompanyId } from './types';
import type { SharedFileDraft } from './shareInbox';

export interface SharedChatAttempt {
  version: 1; companyId: CompanyId; uid: string; shareId: string;
  roomId: string; senderId: string; senderName: string; text: string; createdAt: string;
  file: { name: string; size: number; type: string; sha256: string };
  message?: ChatMessage;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key = (companyId: CompanyId, uid: string, id: string) => {
  if (!['taebaek', 'punghoe'].includes(companyId) || !uid || !uuid.test(id)) throw Error('공유 전송의 회사·로그인·번호를 확인해 주세요.');
  return `shared-chat-attempt:${companyId}:${encodeURIComponent(uid)}:${id}`;
};
function valid(attempt: SharedChatAttempt): void {
  key(attempt.companyId, attempt.uid, attempt.shareId);
  if (attempt.version !== 1 || typeof attempt.roomId !== 'string' || !attempt.roomId || typeof attempt.senderId !== 'string' || !attempt.senderId || typeof attempt.senderName !== 'string' || !attempt.senderName ||
      typeof attempt.text !== 'string' || typeof attempt.createdAt !== 'string' || !Number.isFinite(Date.parse(attempt.createdAt)) ||
      !attempt.file || !attempt.file.name || !Number.isInteger(attempt.file.size) || attempt.file.size <= 0 ||
      typeof attempt.file.type !== 'string' || !/^[0-9a-f]{64}$/.test(attempt.file.sha256)) throw Error('보존된 공유 전송 원문을 확인할 수 없습니다.');
  if (attempt.message) {
    const m = attempt.message;
    if (m.id !== `MSG-share-${attempt.shareId}` || m.companyId !== attempt.companyId ||
        m.roomId !== attempt.roomId || m.senderId !== attempt.senderId || m.senderName !== attempt.senderName ||
        m.text !== attempt.text || m.createdAt !== attempt.createdAt ||
        (!(typeof m.imageUrl === 'string' && m.imageUrl) && !(typeof m.fileUrl === 'string' && m.fileUrl && m.fileName === attempt.file.name && m.fileSize === attempt.file.size)))
      throw Error('보존된 공유 메시지와 최초 전송 원문이 다릅니다.');
  }
}
export function readSharedChatAttempt(companyId: CompanyId, uid: string, shareId: string): SharedChatAttempt | null {
  const raw = localStorage.getItem(key(companyId, uid, shareId));
  if (raw === null) return null;
  let attempt: SharedChatAttempt;
  try { attempt = JSON.parse(raw); valid(attempt); } catch { throw Error('보존된 공유 전송 원문이 손상됐습니다. 임의로 다시 보내지 않았습니다.'); }
  if (attempt.companyId !== companyId || attempt.uid !== uid || attempt.shareId !== shareId)
    throw Error('보존된 공유 전송의 회사·로그인·번호가 다릅니다.');
  return attempt;
}
async function fileDigest(file: File): Promise<string> {
  const buffer = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(Error('공유 파일 원문을 읽지 못했습니다.')); reader.readAsArrayBuffer(file);
  });
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function beginSharedChatAttempt(companyId: CompanyId, uid: string, draft: SharedFileDraft,
  roomId: string, senderId: string, senderName: string): Promise<SharedChatAttempt> {
  const previous = readSharedChatAttempt(companyId, uid, draft.id);
  if (previous) { await assertSharedChatDraft(previous, draft); return previous; }
  const attempt: SharedChatAttempt = { version: 1, companyId, uid, shareId: draft.id, roomId, senderId, senderName,
    text: draft.text, createdAt: new Date().toISOString(), file: { name: draft.file.name, size: draft.file.size, type: draft.file.type, sha256: await fileDigest(draft.file) } };
  valid(attempt);
  const concurrent = readSharedChatAttempt(companyId, uid, draft.id);
  if (concurrent) { await assertSharedChatDraft(concurrent, draft); return concurrent; }
  localStorage.setItem(key(companyId, uid, draft.id), JSON.stringify(attempt)); return attempt;
}
export async function assertSharedChatDraft(attempt: SharedChatAttempt, draft: SharedFileDraft): Promise<void> {
  if (attempt.shareId !== draft.id || attempt.text !== draft.text || attempt.file.name !== draft.file.name ||
      attempt.file.size !== draft.file.size || attempt.file.type !== draft.file.type || attempt.file.sha256 !== await fileDigest(draft.file))
    throw Error('공유 파일과 보존된 최초 전송 원문이 다릅니다. 기존 원문을 보존했습니다.');
}
/** 메시지를 보낸 뒤 통신이 끊겨도 URL·방·날짜가 바뀌지 않도록 전송 전에 고정한다. */
export function completeSharedChatAttempt(attempt: SharedChatAttempt, message: ChatMessage): SharedChatAttempt {
  const next = { ...attempt, message }; valid(next);
  const current = readSharedChatAttempt(attempt.companyId, attempt.uid, attempt.shareId);
  if (!current || JSON.stringify(current) !== JSON.stringify(attempt)) throw Error('공유 전송 원문이 변경되어 저장하지 않았습니다.');
  localStorage.setItem(key(attempt.companyId, attempt.uid, attempt.shareId), JSON.stringify(next)); return next;
}
export function clearSharedChatAttempt(attempt: SharedChatAttempt): void {
  valid(attempt);
  const current = readSharedChatAttempt(attempt.companyId, attempt.uid, attempt.shareId);
  if (!current) return;
  if (JSON.stringify(current) !== JSON.stringify(attempt)) throw Error('다른 공유 전송 원문은 삭제하지 않았습니다.');
  localStorage.removeItem(key(attempt.companyId, attempt.uid, attempt.shareId));
}

/** 명시적인 폐기는 손상 원문도 처리하지만 다른 창에서 바뀐 원문까지 지우지 않는다. */
export function sharedChatAttemptText(companyId: CompanyId, uid: string, shareId: string): string | null {
  return localStorage.getItem(key(companyId, uid, shareId));
}
export function discardSharedChatAttemptText(companyId: CompanyId, uid: string, shareId: string, expected: string | null): void {
  const target = key(companyId, uid, shareId);
  if (localStorage.getItem(target) !== expected) throw Error('공유 전송 원문이 변경되어 폐기하지 않았습니다.');
  if (expected !== null) localStorage.removeItem(target);
}

export function readSharedChatAttempts(companyId: CompanyId, uid: string): SharedChatAttempt[] {
  const prefix = `shared-chat-attempt:${companyId}:${encodeURIComponent(uid)}:`;
  const attempts: SharedChatAttempt[] = [];
  for (const storedKey of Object.keys(localStorage).filter(k => k.startsWith(prefix))) {
    const shareId = storedKey.slice(prefix.length);
    const attempt = readSharedChatAttempt(companyId, uid, shareId);
    if (attempt) attempts.push(attempt);
  }
  return attempts;
}
