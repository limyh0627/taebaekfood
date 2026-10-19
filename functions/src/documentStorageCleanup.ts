import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import type { UploadIdentity } from './shared/documentMetadataCommand';
export interface DocumentStorageObject {
    generation: string;
    size: number;
    contentType: string;
    metadata: Record<string, string>;
}
export interface DocumentStoragePort {
    bucketName?: string;
    stat(path: string): Promise<DocumentStorageObject | null>;
    read(path: string, generation: string): Promise<Buffer>;
    remove(path: string, generation: string): Promise<void>;
}
const codeOf = (error: unknown): unknown => error && typeof error === 'object' && 'code' in error ? error.code : undefined;
/** 객체 세대를 고정하여 검증한 바이트와 삭제하는 바이트가 달라지지 않게 한다. */
export function createDocumentStoragePort(bucket = admin.storage().bucket()): DocumentStoragePort {
    return {
        bucketName: bucket.name,
        async stat(path) {
            try {
                const [m] = await bucket.file(path).getMetadata();
                return {
                    generation: String(m.generation), size: Number(m.size), contentType: m.contentType || 'application/octet-stream', metadata: (m.metadata || {}) as Record<string, string>
                };
            }
            catch (error) {
                if (Number(codeOf(error)) === 404)
                    return null;
                throw error;
            }
        },
        async read(path, generation) {
            const [bytes] = await bucket.file(path, {
                generation
            }).download();
            return bytes;
        },
        async remove(path, generation) {
            await bucket.file(path).delete({
                ifGenerationMatch: generation
            });
        },
    };
}
export async function verifyDocumentUpload(port: DocumentStoragePort, upload: UploadIdentity, actorUid: string, employeeId: string): Promise<{
    object: DocumentStorageObject;
    downloadUrl: string;
} | null> {
    const object = await port.stat(upload.path);
    if (!object)
        return null;
    if (object.size !== upload.size || object.contentType !== upload.contentType || object.metadata.uploadId !== upload.uploadId || object.metadata.sha256 !== upload.sha256 || object.metadata.actorUid !== actorUid || object.metadata.employeeId !== employeeId)
        throw Error('업로드 파일의 크기·형식·요청·계정 정보가 최초 원문과 다릅니다.');
    const bytes = await port.read(upload.path, object.generation);
    if (bytes.length !== upload.size || createHash('sha256').update(bytes).digest('hex') !== upload.sha256)
        throw Error('업로드 파일 바이트가 최초 SHA256과 다릅니다. 같은 원본 파일을 확인해 주세요.');
    const token = object.metadata.firebaseStorageDownloadTokens?.split(',')[0];
    if (!token)
        throw Error('업로드 파일의 다운로드 토큰을 확인하지 못했습니다. 파일 상태를 다시 확인해 주세요.');
    return {
        object, downloadUrl: token
    };
}
export async function deleteDocumentGeneration(port: DocumentStoragePort, path: string, generation: string): Promise<'deleted' | 'absent' | 'retained-replaced'> {
    const current = await port.stat(path);
    if (!current)
        return 'absent';
    if (current.generation !== generation)
        return 'retained-replaced';
    try {
        await port.remove(path, generation);
        return 'deleted';
    }
    catch (error) {
        if (Number(codeOf(error)) === 404)
            return 'absent';
        if (Number(codeOf(error)) === 412)
            return 'retained-replaced';
        throw error;
    }
}
