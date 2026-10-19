import { it, expect, vi } from 'vitest';
import { verifyNoticePhoto, deleteNoticeGeneration } from './noticeStorageCleanup';
import { createHash } from 'node:crypto';
const bytes = Buffer.from('abc'), sha256 = createHash('sha256').update(bytes).digest('hex');
const request = { version: 1 as const, reference: { companyId: 'taebaek' as const, postId: 'p', uploadId: 'up' }, sha256, size: 3, contentType: 'image/png' as const };
const object = { generation: '1', size: 3, contentType: 'image/png', metadata: { uploadId: 'up', sha256, actorUid: 'u', employeeId: 'e', firebaseStorageDownloadTokens: 'token' } };
it('정확세대바이트SHA를검증하고URL을서버에서파생한다', async () => { const port = { bucketName: 'bucket', stat: vi.fn(async () => object), read: vi.fn(async () => bytes), remove: vi.fn() }; expect(await verifyNoticePhoto(port, request, 'u', 'e')).toMatchObject({ generation: '1', downloadUrl: expect.stringContaining('token=token') }); port.read.mockResolvedValueOnce(Buffer.from('bad')); await expect(verifyNoticePhoto(port, request, 'u', 'e')).rejects.toThrow('SHA256'); });
it('다른세대는조건삭제하지않고412도보존으로끝낸다', async () => { const remove = vi.fn(), port = { stat: async () => object, read: async () => bytes, remove }; expect(await deleteNoticeGeneration(port, 'path', 'old')).toBe('retained-replaced'); expect(remove).not.toHaveBeenCalled(); remove.mockRejectedValueOnce({ code: 412 }); expect(await deleteNoticeGeneration(port, 'path', '1')).toBe('retained-replaced'); });
