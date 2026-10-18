import { useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../../../shared/firebase';
import type { Item, CompanyId } from '../../../shared/types';
import type { BomDraftLine } from '../../../shared/bomIndex';
import type { ItemEditorProgress, ItemEditorSaveResult } from '../application/itemEditorSave';
export const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export type ItemPhotoProduct = Item & {
    bomDraft?: BomDraftLine[];
    photoChanged?: boolean;
};
interface ItemPhotoSaveOptions {
    companyId: CompanyId;
    initialData?: Item;
    scopeKey?: string;
    onSave: (product: ItemPhotoProduct, progress: ItemEditorProgress, isCurrent: () => boolean) => Promise<ItemEditorSaveResult>;
}
interface PhotoSubmission {
    finalProduct: Item;
    photoFile: File | null;
    photoRemoved: boolean;
    bomDraft: BomDraftLine[];
    progress: ItemEditorProgress;
    isCurrent: () => boolean;
}
export function useItemPhotoSave({ companyId, initialData, onSave, scopeKey }: ItemPhotoSaveOptions) {
    const [saving, setSaving] = useState(false), savingRef = useRef(false);
    const upload = useRef<{
        file: File;
        itemId: string;
        scope: string;
        path: string;
        uploaded: boolean;
        url?: string;
    } | null>(null);
    const saveItemPhoto = async (input: PhotoSubmission): Promise<ItemEditorSaveResult> => {
        const { finalProduct, photoFile, photoRemoved, bomDraft, progress, isCurrent } = input;
        const stopped = (): ItemEditorSaveResult => ({ outcome: { status: 'cancelled', message: '회사 또는 편집 화면이 바뀌어 후속 저장을 중단했습니다.' }, progress });
        if (savingRef.current || !isCurrent())
            return stopped();
        if (progress.unknownStageId)
            return { outcome: progress.confirmedStageIds.includes('primary') ? { status: 'partial', reason: 'followup-unconfirmed', committedIds: [progress.itemId], unconfirmedIds: [], message: '이전 저장 단계의 결과가 불확실합니다.', nextAction: '같은 요청을 다시 보내지 말고 관리자에게 확인해 주세요.' } : { status: 'unknown', message: '이전 품목 저장 결과가 불확실합니다.', nextAction: '최초 작성 내용과 사진을 유지하고 관리자에게 확인해 주세요.' }, progress };
        savingRef.current = true;
        setSaving(true);
        let sent = false;
        try {
            const product = { ...finalProduct };
            if (photoFile) {
                if (!upload.current || upload.current.file !== photoFile || upload.current.itemId !== product.id || upload.current.scope !== companyId + ':' + (scopeKey ?? '')) {
                    const suffix = PHOTO_TYPES[photoFile.type];
                    if (!suffix)
                        throw Error('JPEG, PNG, WebP 사진을 선택해 주세요.');
                    upload.current = { file: photoFile, itemId: product.id, scope: companyId + ':' + (scopeKey ?? ''), path: 'companies/' + companyId + '/items/' + product.id + '/photo-' + crypto.randomUUID() + '.' + suffix, uploaded: false };
                }
                const cached = upload.current, fileRef = storageRef(storage, cached.path);
                if (!cached.uploaded) {
                    await uploadBytes(fileRef, photoFile, { contentType: photoFile.type });
                    cached.uploaded = true;
                }
                if (!isCurrent())
                    return stopped();
                if (!cached.url)
                    cached.url = await getDownloadURL(fileRef);
                if (!isCurrent())
                    return stopped();
                product.image = cached.url;
                product.imagePath = cached.path;
            }
            if (!isCurrent())
                return stopped();
            sent = true;
            const result = await onSave({ ...product, photoChanged: !!(photoFile || photoRemoved), bomDraft }, progress, isCurrent);
            if (!result || result.progress !== progress || !result.outcome || !['saved', 'rejected', 'cancelled', 'unknown', 'partial'].includes(result.outcome.status) || result.outcome.status === 'saved' && !progress.confirmedStageIds.includes('primary')) {
                progress.unknownStageId = 'save-result';
                return { outcome: { status: 'unknown', message: '품목 저장 결과를 확인하지 못했습니다.', nextAction: '작성 내용과 사진을 유지했습니다. 현재 품목과 작업 결과를 확인해 주세요.' }, progress };
            }
            if (result.outcome.status === 'unknown' && !progress.unknownStageId)
                progress.unknownStageId = 'save-result';
            // 조회 결과만으로 최초 저장의 미반영을 추정하지 않는다. 새 사진은 미확정에도 보존한다.
            if (result.outcome.status === 'saved' && isCurrent() && (photoFile || photoRemoved) && initialData?.imagePath?.startsWith('companies/' + companyId + '/items/' + product.id + '/')) {
                try {
                    const saved = await getDoc(doc(db, 'items', product.id));
                    if (isCurrent() && saved.exists() && saved.data().imagePath !== initialData.imagePath)
                        await deleteObject(storageRef(storage, initialData.imagePath));
                }
                catch (error) {
                    console.error('구 사진 참조 확인 실패 — 파일 삭제를 보류합니다.', error);
                }
            }
            return result;
        }
        catch (error) {
            if (sent)
                progress.unknownStageId ??= 'save-result';
            return { outcome: sent ? { status: 'unknown', message: '품목 저장 결과를 확인하지 못했습니다.', nextAction: '사진을 삭제하거나 다시 올리지 말고 현재 품목과 작업 결과를 확인해 주세요.' } : { status: 'rejected', message: error instanceof Error ? error.message : '사진 준비를 완료하지 못했습니다.', nextAction: '아직 품목 저장을 전송하지 않았습니다. 사진 준비를 다시 시도해 주세요.' }, progress };
        }
        finally {
            savingRef.current = false;
            setSaving(false);
        }
    };
    return { saving, savingRef, saveItemPhoto };
}
