import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { verifyDocumentUpload, deleteDocumentGeneration, type DocumentStoragePort } from './documentStorageCleanup';
const bytes = Buffer.from('원본'), upload = {
    uploadId: 'u', path: 'p', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, contentType: 'application/pdf'
};
const object = {
    generation: '12', size: bytes.length, contentType: 'application/pdf', metadata: {
        uploadId: 'u', sha256: upload.sha256, actorUid: 'actor', employeeId: 'emp', firebaseStorageDownloadTokens: 'token'
    }
};
const port = (): DocumentStoragePort => ({
    stat: vi.fn(async () => object), read: vi.fn(async () => bytes), remove: vi.fn(async () => {
    })
});
it('검증은 generation고정 read와 실제바이트SHA를 사용한다', async () => {
    const p = port();
    expect(await verifyDocumentUpload(p, upload, 'actor', 'emp')).toMatchObject({
        object: {
            generation: '12'
        }
    });
    expect(p.read).toHaveBeenCalledWith('p', '12');
    p.read = vi.fn(async () => Buffer.from('변경'));
    await expect(verifyDocumentUpload(p, upload, 'actor', 'emp')).rejects.toThrow('SHA256');
});
it('크기·계정·요청·type mismatch와 token없음은 metadata등록 근거가 아니다', async () => {
    for (const patch of [{
            size: 1
        }, {
            contentType: 'text/plain'
        }, {
            metadata: {
                ...object.metadata, actorUid: 'other'
            }
        }, {
            metadata: {
                ...object.metadata, firebaseStorageDownloadTokens: ''
            }
        }]) {
        const p = port();
        p.stat = vi.fn(async () => ({
            ...object, ...patch
        }));
        await expect(verifyDocumentUpload(p, upload, 'actor', 'emp')).rejects.toThrow();
    }
});
it('다른세대와 실제412는보존하고 정확세대조건을삭제포트에전달한다', async () => {
    const p = port();
    expect(await deleteDocumentGeneration(p, 'p', '11')).toBe('retained-replaced');
    expect(p.remove).not.toHaveBeenCalled();
    expect(await deleteDocumentGeneration(p, 'p', '12')).toBe('deleted');
    expect(p.remove).toHaveBeenCalledWith('p', '12');
    p.remove = vi.fn(async () => {
        throw {
            code: 412
        };
    });
    expect(await deleteDocumentGeneration(p, 'p', '12')).toBe('retained-replaced');
});
it('없는객체404는absent,네트워크실패는삭제성공으로바꾸지않는다', async () => {
    const p = port();
    p.stat = vi.fn(async () => null);
    expect(await deleteDocumentGeneration(p, 'p', '12')).toBe('absent');
    p.stat = vi.fn(async () => object);
    p.remove = vi.fn(async () => {
        throw Error('네트워크');
    });
    await expect(deleteDocumentGeneration(p, 'p', '12')).rejects.toThrow('네트워크');
});
