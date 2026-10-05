import { joinSharedText } from './shareTarget';

const CACHE = 'tb-share-inbox-v1';
const MAX = 20 * 1024 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SharedFileDraft { id: string; file: File; text: string }

function key(id: string): string {
  if (!ID.test(id)) throw new Error('잘못된 공유 번호입니다.');
  return new URL(`/__share-inbox/${id}`, window.location.origin).href;
}

export function shareIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('share');
}

export function clearShareUrl(id: string): void {
  if (shareIdFromUrl() !== id) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('share');
  url.searchParams.delete('shareRejected');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export async function readSharedFile(id: string): Promise<SharedFileDraft> {
  const response = await (await caches.open(CACHE)).match(key(id));
  if (!response) throw new Error('공유 파일을 찾지 못했습니다. 다시 공유하거나 폐기해 주세요.');
  const data = await response.formData();
  const files = data.getAll('files');
  if (files.length !== 1 || !(files[0] instanceof File) || !files[0].size || files[0].size > MAX || !TYPES.has(files[0].type)) {
    throw new Error('지원하지 않는 공유 파일입니다. 파일 1개, 20MB 이하 PNG/JPEG/WebP/PDF만 가능합니다.');
  }
  return { id, file: files[0], text: joinSharedText({ title: String(data.get('title') || ''), text: String(data.get('text') || ''), url: String(data.get('url') || '') }) };
}

export async function discardSharedFile(id: string): Promise<void> {
  await (await caches.open(CACHE)).delete(key(id));
  clearShareUrl(id);
}
