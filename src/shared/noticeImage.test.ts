import { beforeEach, it, expect, vi } from 'vitest';
import type { NoticeBindings, NoticeContext } from '../features/notices/infrastructure/noticeWrites';
const sdk = vi.hoisted(() => ({ ref: vi.fn((_storage: unknown, path: string) => ({ path })), uploadBytes: vi.fn().mockResolvedValue(undefined) }));
vi.mock('firebase/storage', () => sdk);
vi.mock('./firebase', () => ({ storage: {}, auth: { currentUser: { uid: 'A' } } }));
import { prepareNoticePhoto, resumeNoticePhoto, deleteNoticeImages } from './noticeImage';
const context: NoticeContext = {
    companyId: 'taebaek', actorUid: 'A', employeeId: 'employee', isCurrent: () => true
};
const body = () => new File(['a'], 'a.png', { type: 'image/png' });
function ports() {
    const reservePhoto = vi.fn<NoticeBindings['reservePhoto']>().mockImplementation(async (request) => ({
        version: 1, reference: request.reference, actorUid: 'A', employeeId: 'employee', requestHash: 'a'.repeat(64), status: 'reserved', cleanupStatus: 'not-required', path: `companies/taebaek/notices/${request.reference.postId}/${request.reference.uploadId}`, message: '예약', uploadStatus: 'absent'
    }));
    return { reservePhoto, cancel: vi.fn().mockResolvedValue({ status: 'cancelled' }), cleanup: vi.fn().mockResolvedValue({ status: 'saved', serverResult: { cleanupStatus: 'deleted' } }) } as unknown as NoticeBindings & {
        reservePhoto: typeof reservePhoto;
    };
}
beforeEach(() => vi.clearAllMocks());
it('다운로드 주소 확인 실패는 재업로드 없이 고정 예약으로 서버 상태부터 다시 확인한다', async () => {
    const p = ports(), plan = await prepareNoticePhoto('taebaek', 'post', body());
    p.reservePhoto.mockRejectedValueOnce(Error('예약 ACK 유실'));
    await expect(resumeNoticePhoto(plan, body(), context, p)).rejects.toThrow('예약 ACK 유실');
    expect(sdk.uploadBytes).not.toHaveBeenCalled();
    p.reservePhoto.mockImplementationOnce(async () => ({
        version: 1, reference: plan.request.reference, actorUid: 'A', employeeId: 'employee', requestHash: 'a'.repeat(64), status: 'reserved', cleanupStatus: 'not-required', path: `companies/taebaek/notices/post/${plan.request.reference.uploadId}`, message: '예약', uploadStatus: 'absent'
    })).mockRejectedValueOnce(Error('주소 오류'));
    await expect(resumeNoticePhoto(plan, body(), context, p)).rejects.toThrow('주소 오류');
    expect(sdk.uploadBytes).toHaveBeenCalledOnce();
    p.reservePhoto.mockResolvedValueOnce({
        version: 1, reference: plan.request.reference, actorUid: 'A', employeeId: 'employee', requestHash: 'a'.repeat(64), status: 'reserved', cleanupStatus: 'not-required', path: `companies/taebaek/notices/post/${plan.request.reference.uploadId}`, message: '확인', uploadStatus: 'verified', downloadUrl: 'https://example.com/a', generation: '1'
    });
    expect((await resumeNoticePhoto(plan, undefined, context, p)).url).toBe('https://example.com/a');
    expect(sdk.uploadBytes).toHaveBeenCalledOnce();
});
it('다른 회사 또는 다른 공지 사진 삭제는 쓰기를 시작하지 않는다', async () => {
    const p = ports();
    for (const path of ['companies/punghoe/notices/post/a', 'companies/taebaek/notices/other/a', 'companies/taebaek/notices/post/a/b'])
        await expect(deleteNoticeImages([{
                type: 'image', path, url: 'https://example.com/a', caption: ''
            }], 'taebaek', 'post', context, p)).rejects.toThrow('현재 공지');
    expect(p.cancel).not.toHaveBeenCalled();
    expect(p.cleanup).not.toHaveBeenCalled();
});
it('현재 공지 사진만 예약을 중단하고 서버 정리하며 텍스트는 건드리지 않는다', async () => {
    const p = ports();
    await deleteNoticeImages([{ type: 'text', text: '글' }, {
            type: 'image', path: 'companies/taebaek/notices/post/a', url: 'https://example.com/a', caption: ''
        }], 'taebaek', 'post', context, p);
    expect(p.cancel).toHaveBeenCalledWith({ companyId: 'taebaek', postId: 'post', uploadId: 'a' }, context);
    expect(p.cleanup).toHaveBeenCalledOnce();
});
it('파일 검증 SHA가 다르면 같은 경로로 전송하지 않는다', async () => {
    const p = ports(), plan = await prepareNoticePhoto('taebaek', 'post', body());
    await expect(resumeNoticePhoto(plan, new File(['b'], 'same.png', { type: 'image/png' }), context, p)).rejects.toThrow('내용이 다릅니다');
    expect(sdk.uploadBytes).not.toHaveBeenCalled();
});
