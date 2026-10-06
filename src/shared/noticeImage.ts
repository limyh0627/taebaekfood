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
  return { type: 'image' as const, url: await getDownloadURL(target), path, caption: '' };
}

export async function deleteNoticeImages(blocks: Post['blocks']) {
  await Promise.all((blocks ?? []).filter(b => b.type === 'image').map(b =>
    deleteObject(ref(storage, b.path)).catch(error => {
      if (error.code !== 'storage/object-not-found') throw error;
    }),
  ));
}
