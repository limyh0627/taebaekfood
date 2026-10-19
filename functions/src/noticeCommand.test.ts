import { it, expect, vi } from 'vitest';
vi.hoisted(() => { process.env.FIREBASE_CONFIG = JSON.stringify({ storageBucket: 'demo-notice-unit.appspot.com' }); });
import { executeNoticeCommand } from './noticeCommand';
it('관리자회사claim과직원문자권한은TX전검사한다', async () => {
    const db = { runTransaction: vi.fn() } as never, reference = { companyId: 'taebaek' as const, postId: 'post', planId: 'plan' }, storage = {} as never;
    await expect(executeNoticeCommand(db, undefined, { mode: 'inspect', reference }, storage)).rejects.toMatchObject({ code: 'unauthenticated' });
    for (const token of [{ companyId: 'taebaek', employeeId: 'e', isAdmin: false }, { companyId: 'punghoe', employeeId: 'e', isAdmin: true }, { companyId: 'taebaek', employeeId: 1, isAdmin: true }])
        await expect(executeNoticeCommand(db, { uid: 'u', token }, { mode: 'inspect', reference }, storage)).rejects.toMatchObject({ code: 'permission-denied' });
});
it('endpoint지역과늦은사진이벤트재시도설정을보존한다', async () => {
    const { noticeCommand, cleanupLateNoticeUpload } = await import('./noticeCommand');
    expect((noticeCommand as unknown as {
        __endpoint: {
            region: string[];
        };
    }).__endpoint.region).toEqual(['asia-northeast3']);
    expect((cleanupLateNoticeUpload as unknown as {
        __endpoint: {
            region: string[];
            eventTrigger: {
                retry: boolean;
            };
        };
    }).__endpoint).toMatchObject({ region: ['us-east1'], eventTrigger: { retry: true } });
});
