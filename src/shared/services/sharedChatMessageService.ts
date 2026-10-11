import { doc, runTransaction } from 'firebase/firestore';
import { auth, authReady, db } from '../firebase';
import type { ChatMessage, CompanyId } from '../types';

export async function sharedChatActor(companyId: CompanyId, employeeId: string): Promise<string> {
  await authReady;
  const user = auth.currentUser;
  if (!user) throw Error('로그인 후 공유 파일을 다시 전송해 주세요.');
  const token = await user.getIdTokenResult();
  if (auth.currentUser?.uid !== user.uid || token.claims.companyId !== companyId || token.claims.employeeId !== employeeId)
    throw Error('공유 전송의 회사·로그인 사용자가 일치하지 않습니다.');
  return user.uid;
}
const originalKeys = ['id', 'companyId', 'roomId', 'senderId', 'senderName', 'text', 'createdAt', 'imageUrl', 'fileUrl', 'fileName', 'fileSize'] as const;
function original(message: ChatMessage): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const k of originalKeys) if (message[k] !== undefined) data[k] = message[k];
  return data;
}
/** 일반 대화의 수정·삭제 경로와 달리 공유 재전송은 최초 메시지를 덮어쓰지 않는다. */
export async function sendSharedChatMessage(message: ChatMessage, shareId: string): Promise<'created' | 'duplicate'> {
  const companyId = message.companyId;
  if (!companyId || !['taebaek', 'punghoe'].includes(companyId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(shareId) ||
      message.id !== `MSG-share-${shareId}` || !message.roomId || !message.senderId || !message.senderName ||
      typeof message.text !== 'string' || !Number.isFinite(Date.parse(message.createdAt)) ||
      (!message.imageUrl && !(message.fileUrl && message.fileName && Number.isInteger(message.fileSize) && message.fileSize! > 0)) ||
      Object.keys(message).some(k => !originalKeys.includes(k as typeof originalKeys[number])))
    throw Error('공유 메시지 원문을 확인해 주세요.');
  const uid = await sharedChatActor(companyId, message.senderId);
  const data = original(message);
  const result = await runTransaction(db, async tx => {
    if (auth.currentUser?.uid !== uid) throw Error('로그인 사용자가 변경되어 전송하지 않았습니다.');
    const ref = doc(db, 'chatMessages', message.id);
    const room = await tx.get(doc(db, 'chatRooms', message.roomId));
    if (!room.exists() || room.data().companyId !== companyId || !room.data().participantIds?.includes(message.senderId))
      throw Error('본인 회사의 참여 중인 대화방에만 공유할 수 있습니다.');
    const existing = await tx.get(ref);
    if (existing.exists()) {
      const old = original({ ...existing.data(), id: existing.id } as ChatMessage);
      if (JSON.stringify(old) !== JSON.stringify(data)) throw Error('같은 공유 번호의 메시지가 다른 원문으로 저장돼 있습니다. 덮어쓰지 않았습니다.');
      return 'duplicate';
    }
    if (auth.currentUser?.uid !== uid) throw Error('로그인 사용자가 변경되어 전송하지 않았습니다.');
    tx.set(ref, data); return 'created';
  });
  if (await sharedChatActor(companyId, message.senderId) !== uid) throw Error('로그인 사용자가 변경되어 전송 결과를 확인하지 못했습니다.');
  return result;
}
