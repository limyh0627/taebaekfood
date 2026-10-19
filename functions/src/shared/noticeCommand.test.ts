import { it, expect } from 'vitest';
import { noticeOpening, normalizeNoticeRequest, normalizeNoticeOpenResult, noticePhotoPath, normalizeNoticePhotoRequest, normalizeNoticeResult } from './noticeCommand';
const reference = { companyId: 'taebaek' as const, planId: 'p', postId: 'post' };
it('legacy 열기는 blocks없는본문과 미지 단락을 원형보존하며숨은필드는제외한다', () => { const raw = { content: 'old', blocks: [{ type: 'image', url: 'https://example.com/a', unknown: 1 }], secret: 'x' }; const opened = normalizeNoticeOpenResult({ reference, actorUid: 'u', employeeId: 'e', opening: noticeOpening(raw), expectedVersion: '1:000000001' }, reference, 'u', 'e'); expect(JSON.stringify(opened)).toContain('unknown'); expect(JSON.stringify(opened)).not.toContain('secret'); });
it('dirty 수정 필드만 허용하고삭제와수정원문을섞지않는다', () => {
    expect(normalizeNoticeRequest({ version: 1, reference, action: 'pin', expectedVersion: '1:000000001', patch: { pinned: false } }).patch).toEqual({ pinned: false });
    for (const patch of [{ companyId: 'x' }, { id: 'x' }, { pinned: 'true' }])
        expect(() => normalizeNoticeRequest({ version: 1, reference, action: 'pin', expectedVersion: null, patch })).toThrow();
});
it('사진경로는회사공지upload세수명을고정하고크기형식을검사한다', () => { const ref = { companyId: 'taebaek' as const, postId: 'post', uploadId: 'up' }; expect(noticePhotoPath(ref)).toBe('companies/taebaek/notices/post/up'); expect(normalizeNoticePhotoRequest({ version: 1, reference: ref, sha256: 'a'.repeat(64), size: 3, contentType: 'image/png' }).size).toBe(3); expect(() => normalizeNoticePhotoRequest({ version: 1, reference: ref, sha256: 'a'.repeat(64), size: 6 * 1024 * 1024, contentType: 'image/png' })).toThrow(); });
it('다른계정응답과hash를현재완료로쓰지않는다', () => { const r = { version: 1, reference, actorUid: 'u', employeeId: 'e', status: 'applied', requestHash: 'a'.repeat(64), cleanupStatus: 'pending', message: '완료' }; expect(normalizeNoticeResult(r, reference, 'u', 'e').cleanupStatus).toBe('pending'); expect(() => normalizeNoticeResult(r, reference, 'other', 'e')).toThrow(); expect(() => normalizeNoticeResult(r, reference, 'u', 'e', 'b'.repeat(64))).toThrow(); });
