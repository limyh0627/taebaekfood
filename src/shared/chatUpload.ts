import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';

//  **오피스톡 첨부는 Storage 를 지난다.**
//  전에는 사진을 base64 로 바꿔 메시지 글자에 실어 Firestore 에 넣었다. Firestore 문서는
//  1MB 가 한계라, 폰으로 찍은 사진(2~4MB → base64 는 1.35배)은 아예 안 보내졌다.
//  파일로 올리고 주소만 싣는다.

/** 한 번에 올릴 수 있는 크기. Storage 는 더 받지만, 톡에 100MB 를 올릴 일은 없다. */
export const CHAT_MAX_MB = 20;

export interface ChatAttachment {
  url: string;
  path: string;
  name: string;
  size: number;
  type: string;
  /** 말풍선에 그림으로 펼칠지, 파일 줄로 접을지 */
  isImage: boolean;
}

/** Storage 경로에 못 들어가는 글자를 걷어낸다 — 한글 파일명은 그대로 둔다. */
export const safeFileName = (name: string) => name.replace(/[#?%\/]/g, '_');

export async function uploadChatFile(roomId: string, file: File): Promise<ChatAttachment> {
  if (file.size > CHAT_MAX_MB * 1024 * 1024) {
    throw new Error(`${CHAT_MAX_MB}MB 까지 보낼 수 있습니다 (${Math.round(file.size / 1024 / 1024)}MB)`);
  }
  const path = `officetalk/${roomId}/${Date.now()}_${safeFileName(file.name)}`;
  await uploadBytes(ref(storage, path), file);
  const url = await getDownloadURL(ref(storage, path));
  return {
    url, path,
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    isImage: (file.type || '').startsWith('image/'),
  };
}

/** 사람이 읽는 크기 — 1.2MB 처럼. */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
