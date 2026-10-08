import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './firebase';
import type { CompanyId, Post } from './types';

export async function uploadNoticeImage(companyId: CompanyId, postId: string, file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error('사진은 JPG·PNG·WebP 형식으로 5MB까지 첨부할 수 있습니다.');
  }
  const path = `companies/${companyId}/notices/${postId}/${crypto.randomUUID()}`;
  const target = ref(storage, path);
  await uploadBytes(target, file);
  let url:string;
  try { url=await getDownloadURL(target); }
  catch(error) { await deleteObject(target).catch(()=>{}); throw error; }
  return { type: 'image' as const, url, path, caption: '' };
}

export async function deleteNoticeImages(blocks: Post['blocks'], companyId?: CompanyId, postId?: string) {
  if (!blocks?.some(b=>b.type==='image')) return;
  if (!companyId || !postId || postId.includes('/') || blocks.some(b=>b.type==='image' && (!b.path.startsWith(`companies/${companyId}/notices/${postId}/`) || b.path.slice(`companies/${companyId}/notices/${postId}/`.length).includes('/') || b.path.endsWith('/')))) throw new Error('현재 공지에 속한 사진만 정리할 수 있습니다.');
  await Promise.all((blocks ?? []).filter(b => b.type === 'image').map(b =>
    deleteObject(ref(storage, b.path)).catch(error => {
      if (error.code !== 'storage/object-not-found') throw error;
    }),
  ));
}
