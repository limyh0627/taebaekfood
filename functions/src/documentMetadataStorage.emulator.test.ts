import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Storage, type Bucket } from '@google-cloud/storage';
import { randomUUID, createHash } from 'node:crypto';
import { createDocumentStoragePort, deleteDocumentGeneration, verifyDocumentUpload, type DocumentStoragePort } from './documentStorageCleanup';
const active = process.env.DOCUMENT_STORAGE_TESTBENCH === 'http://127.0.0.1:9000';
let bucket: Bucket;
const files = new Set<string>();
/** Google storage-testbench 모델의 실제 SDK 검증. Firebase emulator/IAM·운영 검증이 아니다. */
describe.skipIf(!active)('문서 세대조건 실제 GCS SDK 모델', () => {
    beforeAll(async () => {
        const storage = new Storage({
            projectId: 'demo-document-recovery', apiEndpoint: 'http://127.0.0.1:9000', useAuthWithCustomEndpoint: false, retryOptions: {
                autoRetry: false, maxRetries: 0
            }
        });
        bucket = storage.bucket('demo-document-' + randomUUID());
        await bucket.create();
    });
    afterAll(async () => {
        if (!bucket)
            return;
        for (const name of files) {
            const file = bucket.file(name);
            const [exists] = await file.exists();
            if (exists) {
                const [m] = await file.getMetadata();
                await file.delete({
                    ifGenerationMatch: m.generation
                });
            }
        }
        await bucket.delete();
    });
    it('stat G1뒤실제G2치환·조건삭제412로G2바이트보존', async () => {
        const name = 'companies/taebaek/file-cabinet/legacy/' + randomUUID();
        files.add(name);
        const file = bucket.file(name);
        await file.save(Buffer.from('G1'), {
            resumable: false
        });
        const [first] = await file.getMetadata();
        const real = createDocumentStoragePort(bucket);
        let replaced = false;
        const port: DocumentStoragePort = {
            ...real, remove: async (path, generation) => {
                await file.save(Buffer.from('G2'), {
                    resumable: false
                });
                replaced = true;
                await real.remove(path, generation);
            }
        };
        expect(await deleteDocumentGeneration(port, name, String(first.generation))).toBe('retained-replaced');
        expect(replaced).toBe(true);
        const [current] = await file.getMetadata(), [bytes] = await file.download();
        expect(current.generation).not.toBe(first.generation);
        expect(bytes.toString()).toBe('G2');
    });
    it('정확generation다운로드SHA·size·customidentity검증후해당세대만삭제', async () => {
        const name = 'companies/taebaek/file-cabinet/uploads/u/' + randomUUID(), bytes = Buffer.from('원본');
        files.add(name);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        await bucket.file(name).save(bytes, {
            resumable: false, metadata: {
                contentType: 'application/pdf', metadata: {
                    uploadId: 'u', sha256, actorUid: 'actor', employeeId: 'emp', firebaseStorageDownloadTokens: 'test-token'
                }
            }
        });
        const port = createDocumentStoragePort(bucket), verified = await verifyDocumentUpload(port, {
            uploadId: 'u', path: name, sha256, size: bytes.length, contentType: 'application/pdf'
        }, 'actor', 'emp');
        expect(verified).not.toBeNull();
        expect(await deleteDocumentGeneration(port, name, verified!.object.generation)).toBe('deleted');
        expect((await bucket.file(name).exists())[0]).toBe(false);
    });
});
