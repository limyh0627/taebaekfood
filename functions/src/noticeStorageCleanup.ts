import { createHash } from 'node:crypto';
import { createDocumentStoragePort, deleteDocumentGeneration, type DocumentStoragePort } from './documentStorageCleanup';
import { noticePhotoPath, type NoticePhotoRequest } from './shared/noticeCommand';
export { createDocumentStoragePort as createNoticeStoragePort, deleteDocumentGeneration as deleteNoticeGeneration };
export type { DocumentStoragePort as NoticeStoragePort };
export async function verifyNoticePhoto(port: DocumentStoragePort, request: NoticePhotoRequest, actorUid: string, employeeId: string): Promise<{
    generation: string;
    downloadUrl: string;
} | null> {
    const path = noticePhotoPath(request.reference), object = await port.stat(path);
    if (!object)
        return null;
    if (object.size !== request.size || object.contentType !== request.contentType || object.metadata.uploadId !== request.reference.uploadId || object.metadata.sha256 !== request.sha256 || object.metadata.actorUid !== actorUid || object.metadata.employeeId !== employeeId)
        throw Error('사진의 최초 크기·형식·업로드·계정 정보가 다릅니다.');
    const bytes = await port.read(path, object.generation);
    if (bytes.length !== request.size || createHash('sha256').update(bytes).digest('hex') !== request.sha256)
        throw Error('사진 원본 바이트가 최초 SHA256과 다릅니다.');
    const token = object.metadata.firebaseStorageDownloadTokens?.split(',')[0];
    if (!token)
        throw Error('사진 주소를 확인하지 못했습니다.');
    return { generation: object.generation, downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(port.bucketName || '')}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}` };
}
