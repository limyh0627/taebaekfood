import { useState, useRef } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../../../shared/firebase';
import type { Item, CompanyId } from '../../../shared/types';
import type { BomDraftLine } from '../../../shared/bomIndex';
export const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
interface ItemPhotoSaveOptions { companyId: CompanyId; initialData?: Item; onSave: (product: Item & { bomDraft?: BomDraftLine[]; photoChanged?: boolean }) => void | Promise<void> }
export function useItemPhotoSave({ companyId, initialData, onSave }: ItemPhotoSaveOptions) {
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const saveItemPhoto = async ({finalProduct, photoFile, photoRemoved, bomDraft}: {finalProduct: Item; photoFile: File | null; photoRemoved: boolean; bomDraft: BomDraftLine[]}): Promise<boolean> => {
    savingRef.current = true;
    setSaving(true);
    let uploadedPath = '';
    try {
      if (photoFile) {
        const suffix = PHOTO_TYPES[photoFile.type];
        uploadedPath = `companies/${companyId}/items/${finalProduct.id}/photo-${crypto.randomUUID()}.${suffix}`;
        const fileRef = storageRef(storage, uploadedPath);
        await uploadBytes(fileRef, photoFile, { contentType: photoFile.type });
        finalProduct.image = await getDownloadURL(fileRef);
        finalProduct.imagePath = uploadedPath;
      }
      await onSave({ ...finalProduct, photoChanged: !!(photoFile || photoRemoved),
        bomDraft });
    } catch (error) {
      // 품목 문서가 이미 새 사진을 가리키면 후속 처리 실패여도 파일을 남겨 둔다.
      let photoPersisted = false;
      if (uploadedPath) {
        try {
          const saved = await getDoc(doc(db, 'items', finalProduct.id));
          photoPersisted = saved.exists() && saved.data().imagePath === uploadedPath;
        } catch (checkError) {
          console.error('사진 저장 상태 확인 실패 — 파일 삭제를 보류합니다.', checkError);
          photoPersisted = true;
        }
        if (!photoPersisted) await deleteObject(storageRef(storage, uploadedPath)).catch(console.error);
      }
      window.alert(`${error instanceof Error ? error.message : '품목을 저장하지 못했습니다.'}${photoPersisted ? '\n사진이 품목에 저장되어 있어 파일은 유지했습니다.' : ''}`);
      savingRef.current = false;
      setSaving(false);
      return false;
    }
    if ((photoFile || photoRemoved) && initialData?.imagePath?.startsWith(`companies/${companyId}/items/${finalProduct.id}/`)) {
      try {
        const saved = await getDoc(doc(db, 'items', finalProduct.id));
        // 다른 편집자가 구 사진을 다시 연결했다면 Storage에서 지우지 않는다.
        if (saved.exists() && saved.data().imagePath !== initialData.imagePath) {
          await deleteObject(storageRef(storage, initialData.imagePath)).catch(console.error);
        }
      } catch (error) { console.error('구 사진 참조 확인 실패 — 파일 삭제를 보류합니다.', error); }
    }
    savingRef.current = false;
    setSaving(false);
    return true;
  };
  return {saving,savingRef,saveItemPhoto};
}
