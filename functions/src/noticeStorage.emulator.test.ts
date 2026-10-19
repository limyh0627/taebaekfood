import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Storage, type Bucket } from '@google-cloud/storage';
import { randomUUID, createHash } from 'node:crypto';
import { createNoticeStoragePort, deleteNoticeGeneration, verifyNoticePhoto, type NoticeStoragePort } from './noticeStorageCleanup';
const active = process.env.NOTICE_STORAGE_TESTBENCH === 'http://127.0.0.1:9000';
let bucket: Bucket;
const paths = new Set<string>();
/** Google 소유 Storage testbench 모델 실제 SDK이며 운영 GCS/IAM 검증이 아니다. */
describe.skipIf(!active)('공지 사진 generation조건 실제 SDK 모델', () => {
    beforeAll(async () => { const storage = new Storage({ projectId: 'demo-notice-recovery', apiEndpoint: 'http://127.0.0.1:9000', useAuthWithCustomEndpoint: false, retryOptions: { autoRetry: false, maxRetries: 0 } }); bucket = storage.bucket('demo-notice-' + randomUUID()); await bucket.create(); });
    afterAll(async () => {
        if (!bucket)
            return;
        for (const p of paths) {
            const file = bucket.file(p);
            if ((await file.exists())[0]) {
                const [m] = await file.getMetadata();
                await file.delete({ ifGenerationMatch: m.generation });
            }
        }
        await bucket.delete();
    });
    it('G1확인뒤G2치환은실조건412로보존한다', async () => { const p = 'companies/taebaek/notices/p/' + randomUUID(); paths.add(p); const file = bucket.file(p); await file.save(Buffer.from('G1'), { resumable: false }); const [first] = await file.getMetadata(), real = createNoticeStoragePort(bucket); const port: NoticeStoragePort = { ...real, remove: async (path, generation) => { await file.save(Buffer.from('G2'), { resumable: false }); await real.remove(path, generation); } }; expect(await deleteNoticeGeneration(port, p, String(first.generation))).toBe('retained-replaced'); expect((await file.download())[0].toString()).toBe('G2'); });
    it('정확공지예약SHA와바이트를확인하고그세대만삭제한다', async () => { const uploadId = randomUUID(), reference = { companyId: 'taebaek' as const, postId: 'p', uploadId }, p = 'companies/taebaek/notices/p/' + uploadId, bytes = Buffer.from('공지사진'); paths.add(p); const sha256 = createHash('sha256').update(bytes).digest('hex'); await bucket.file(p).save(bytes, { resumable: false, metadata: { contentType: 'image/png', metadata: { uploadId, sha256, actorUid: 'u', employeeId: 'e', firebaseStorageDownloadTokens: 'token' } } }); const port = createNoticeStoragePort(bucket), verified = await verifyNoticePhoto(port, { version: 1, reference, sha256, size: bytes.length, contentType: 'image/png' }, 'u', 'e'); expect(verified).not.toBeNull(); expect(await deleteNoticeGeneration(port, p, verified!.generation)).toBe('deleted'); });
});
