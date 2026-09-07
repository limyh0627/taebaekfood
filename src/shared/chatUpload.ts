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

/**
 * **붙여넣기(Ctrl+V)에 담긴 파일 하나** — 없으면 null.
 *
 * 2026-09-07 사장님: "오피스톡에 왜 사진 붙여넣기가 안돼".
 * 첨부는 `+` 로 골라서 올리는 길밖에 없었다. 화면을 캡처해서 바로 보내는 게
 * 제일 잦은 길인데 그게 막혀 있었다.
 *
 * **글자만 들어 있으면 null 을 돌려준다** — 그때는 브라우저가 알아서 넣게 둬야 한다.
 * 여기서 preventDefault 를 하면 글자 붙여넣기가 통째로 죽는다.
 *
 * 캡처는 이름이 `image.png` 이거나 아예 비어 있다. 그대로 두면 Storage 에 같은 이름이
 * 쌓이고, 나중에 저장해도 무슨 사진인지 모른다 → **날짜로 이름을 지어 준다.**
 */
export interface PasteLike {
  items?: ArrayLike<{ kind: string; getAsFile: () => File | null }>;
  files?: ArrayLike<File>;
}

/** `붙여넣기-20260907-0944` — 초까지 안 간다. 같은 초에 두 장 붙일 일은 없다. */
const 붙인이름 = (t: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `붙여넣기-${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
};

export function fileFromPaste(data: PasteLike | null | undefined, now = new Date()): File | null {
  let file: File | null = null;
  //  items 를 먼저 본다 — 글자와 그림이 같이 담긴 붙여넣기(웹에서 복사)는 files 가 비어 있을 수 있다
  const items = data?.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      if (items[i]?.kind !== 'file') continue;
      const f = items[i].getAsFile();
      if (f) { file = f; break; }
    }
  }
  if (!file) file = data?.files?.[0] ?? null;
  if (!file) return null;

  //  이름이 없거나 브라우저가 지어 준 'image.png' 면 우리가 다시 짓는다
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file;
  const ext = (file.type.split('/')[1] || 'png').replace(/^jpeg$/, 'jpg');
  return new File([file], `${붙인이름(now)}.${ext}`, { type: file.type });
}

/** 사람이 읽는 크기 — 1.2MB 처럼. */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 사진을 폰에 저장한다.
 *
 * `<a download>` 만으로는 안 된다 — 다른 도메인(Storage)에 있는 파일은 브라우저가
 * `download` 를 무시하고 그냥 화면에 열어 버린다. 그래서 **파일을 받아서** 저장한다.
 * 받는 게 막히면(CORS·오래된 폰) 새 탭으로 열어 준다 — 거기서 꾹 눌러 저장할 수 있다.
 */
export async function saveImage(url: string, name = `오피스톡-${Date.now()}.jpg`): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}
