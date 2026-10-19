import { ref, uploadBytes } from 'firebase/storage';
import { storage, auth } from './firebase';
import type { CompanyId, Post } from './types';
import { noticePhotoPath, normalizeNoticePhotoRequest, type NoticePhotoRequest } from './noticeCommand';
import { noticeBindings, noticeDigest, type NoticeBindings, type NoticeContext } from '../features/notices/infrastructure/noticeWrites';
export interface NoticePhotoPlan {
    request: NoticePhotoRequest;
    fileName: string;
}
export function validateNoticeImage(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024)
        throw Error('사진은 JPG·PNG·WebP 형식으로 5MB까지 첨부할 수 있습니다.');
}
const fileBytes = (file: File): Promise<ArrayBuffer> => typeof file.arrayBuffer === 'function' ? file.arrayBuffer() : new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
});
export async function prepareNoticePhoto(companyId: CompanyId, postId: string, file: File): Promise<NoticePhotoPlan> {
    validateNoticeImage(file);
    return { request: normalizeNoticePhotoRequest({
            version: 1, reference: { companyId, postId, uploadId: crypto.randomUUID() }, sha256: await noticeDigest(await fileBytes(file)), size: file.size, contentType: file.type
        }), fileName: file.name };
}
export async function assertNoticePhotoFile(plan: NoticePhotoPlan, file: File) {
    validateNoticeImage(file);
    if (file.size !== plan.request.size || file.type !== plan.request.contentType || await noticeDigest(await fileBytes(file)) !== plan.request.sha256)
        throw Error('처음 선택한 사진과 내용이 다릅니다. 같은 사진 파일을 다시 선택해 주세요.');
}
const sent = new Set<string>();
export async function resumeNoticePhoto(plan: NoticePhotoPlan, file: File | undefined, context: NoticeContext, ports: NoticeBindings = noticeBindings) {
    const request = normalizeNoticePhotoRequest(plan.request), path = noticePhotoPath(request.reference);
    if (!context.isCurrent() || auth.currentUser?.uid !== context.actorUid)
        throw Error('사진 작업의 로그인 정보가 바뀌었습니다.');
    const reservation = await ports.reservePhoto(request, context);
    if (!context.isCurrent() || auth.currentUser?.uid !== context.actorUid)
        throw Error('사진 작업의 로그인 정보가 바뀌었습니다.');
    if (reservation.status !== 'reserved')
        throw Error(reservation.message);
    if (reservation.uploadStatus === 'verified' && reservation.downloadUrl)
        return {
            type: 'image' as const, path, url: reservation.downloadUrl, caption: ''
        };
    if (!file)
        throw Error('파일을 다시 선택해 사진 내용을 확인해 주세요.');
    await assertNoticePhotoFile(plan, file);
    if (reservation.uploadStatus === 'unverified')
        throw Error('서버에서 사진 내용을 확인하지 못했습니다. 결과 확인 또는 사진 요청 중단을 선택해 주세요.');
    if (!context.isCurrent() || auth.currentUser?.uid !== context.actorUid)
        throw Error('사진 작업의 로그인 정보가 바뀌었습니다.');
    if (!sent.has(path) || reservation.uploadStatus === 'absent') {
        sent.add(path);
        await uploadBytes(ref(storage, path), file, { contentType: request.contentType, customMetadata: {
                uploadId: request.reference.uploadId, sha256: request.sha256, actorUid: context.actorUid, employeeId: context.employeeId
            } });
    }
    const result = await ports.reservePhoto(request, context);
    if (!context.isCurrent() || auth.currentUser?.uid !== context.actorUid)
        throw Error('사진 작업의 로그인 정보가 바뀌었습니다.');
    if (result.status !== 'reserved' || result.uploadStatus !== 'verified' || !result.downloadUrl)
        throw Error('사진 전송 후 서버 확인이 완료되지 않았습니다. 같은 사진 요청의 결과를 확인해 주세요.');
    return {
        type: 'image' as const, path, url: result.downloadUrl, caption: ''
    };
}
export async function uploadNoticeImage(companyId: CompanyId, postId: string, file: File, context: NoticeContext, ports: NoticeBindings = noticeBindings) {
    const plan = await prepareNoticePhoto(companyId, postId, file);
    return resumeNoticePhoto(plan, file, context, ports);
}
export async function deleteNoticeImages(blocks: Post['blocks'], companyId: CompanyId | undefined, postId: string | undefined, context: NoticeContext, ports: NoticeBindings = noticeBindings) {
    if (!blocks?.some(b => b.type === 'image'))
        return;
    if (!companyId || !postId || context.companyId !== companyId || postId.includes('/'))
        throw Error('현재 공지에 속한 사진만 정리할 수 있습니다.');
    for (const block of blocks) {
        if (block.type !== 'image')
            continue;
        const base = `companies/${companyId}/notices/${postId}/`, uploadId = block.path.startsWith(base) ? block.path.slice(base.length) : '';
        if (!uploadId || uploadId.includes('/'))
            throw Error('현재 공지에 속한 사진만 정리할 수 있습니다.');
    }
    for (const block of blocks) {
        if (block.type !== 'image')
            continue;
        const reference = { companyId, postId, uploadId: block.path.slice(`companies/${companyId}/notices/${postId}/`.length) };
        const cancelled = await ports.cancel(reference, context);
        if (cancelled.status === 'unknown')
            throw Error(cancelled.message);
        const cleaned = await ports.cleanup(reference, context);
        if (cleaned.serverResult?.cleanupStatus === 'pending' || cleaned.serverResult?.cleanupStatus === 'manual-blocked' || cleaned.status === 'unknown')
            throw Error('사진 정리가 완료되지 않았습니다. 보관된 사진 요청에서 정리를 다시 확인해 주세요.');
    }
}
