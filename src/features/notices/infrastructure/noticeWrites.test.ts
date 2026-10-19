import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
vi.mock('../../../shared/firebase', () => ({ auth: {}, authReady: Promise.resolve(), functions: {} }));
import { noticeOpening, serializeNoticeRequest, serializeNoticePhotoRequest, noticePhotoPath, type NoticeCommand, type NoticeRequest, type NoticePhotoRequest } from '../../../shared/noticeCommand';
import { createNoticeWriter, type NoticeContext } from './noticeWrites';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
function setup() {
    const map = new Map<string, string>(), scope = { companyId: 'taebaek' as const, actorUid: 'A', employeeId: 'employee' }, ctx = {
        ...scope, postId: 'post', planId: 'plan', isCurrent: () => current
    };
    let current = true;
    const command = vi.fn(async (input: NoticeCommand): Promise<unknown> => {
        if (input.mode === 'open') {
            if ('observeOnly' in input)
                return {
                    reference: input.reference, actorUid: scope.actorUid, employeeId: scope.employeeId, observeOnly: true, exists: false, snapshot: null, expectedVersion: null
                };
            return {
                reference: input.reference, actorUid: 'A', employeeId: 'employee', opening: input.opening, expectedVersion: '1:000000001'
            };
        }
        if (input.mode === 'apply')
            return {
                version: 1, reference: input.request.reference, actorUid: 'A', employeeId: 'employee', requestHash: digest(serializeNoticeRequest(input.request)), status: 'applied', cleanupStatus: 'not-required', message: '공지 저장 완료'
            };
        if (input.mode === 'reservePhoto')
            return {
                version: 1, reference: input.request.reference, actorUid: 'A', employeeId: 'employee', requestHash: digest(serializeNoticePhotoRequest(input.request)), status: 'reserved', cleanupStatus: 'not-required', uploadStatus: 'absent', path: noticePhotoPath(input.request.reference), message: '예약'
            };
        throw Error('미설정 요청');
    });
    const storage = {
        get length() {
            return map.size;
        }, key: (n: number) => [...map.keys()][n] ?? null, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, text: string) => {
            map.set(key, text);
        }, removeItem: (key: string) => {
            map.delete(key);
        }
    };
    const assertContext = vi.fn(async (c: NoticeContext) => {
        if (!c.isCurrent())
            throw Error('scope');
    });
    const hash = vi.fn(async (text: string) => digest(text));
    return {
        map, ctx, command, storage, assertContext, hash, setCurrent: (v: boolean) => {
            current = v;
        }, writer: createNoticeWriter({
            storage, command, assertContext, digest: hash
        })
    };
}
const post = {
    id: 'post', title: '제목', content: '내용', author: '작성자', date: '2026-10-19', tag: '공지' as const, pinned: false
};
it('경로 없는 기존 사진을 포함한 수정 원문은 서버 apply까지 보존한다', async () => {
    const s = setup();
    const opening = await s.writer.open(post, s.ctx);
    // 저장된 옛 사진은 현재 신규 사진 스키마의 path가 없을 수 있다.
    const legacyImage = {type: 'image', url: 'https://example.com/legacy', caption: ''} as unknown as NonNullable<NonNullable<NoticeRequest['patch']>['blocks']>[number];
    const outcome = await s.writer.save({action: 'edit', patch: {blocks: [legacyImage, {type: 'text', text: '추가 단락'}]}}, {...s.ctx, opening});
    expect(outcome.status).toBe('saved');
    expect(s.command).toHaveBeenCalledWith(expect.objectContaining({mode: 'apply', request: expect.objectContaining({patch: expect.objectContaining({blocks: expect.arrayContaining([expect.objectContaining({url: 'https://example.com/legacy'})])})})}));
});
const { id: unusedId, ...createPatch } = post;
async function pending() {
    const h = setup();
    h.command.mockRejectedValueOnce(Error('ACK 유실'));
    const outcome = await h.writer.save({ action: 'create', patch: createPatch }, { ...h.ctx, opening: null });
    expect(outcome.status).toBe('unknown');
    return { ...h, entry: (await h.writer.read(h.ctx))[0] };
}
it('strict open은 선택 raw만 대조하고 native version을 고정하며 저장과 분리한다', async () => {
    const h = setup(), opening = await h.writer.open(post, h.ctx);
    expect(h.command.mock.calls[0][0]).toEqual({ mode: 'open', reference: { companyId: 'taebaek', postId: 'post', planId: 'plan' }, opening: noticeOpening(post) });
    expect(h.map.size).toBe(0);
    expect(await h.writer.save({ action: 'edit', patch: { title: '새제목' } }, { ...h.ctx, opening })).toMatchObject({ status: 'saved', requestFinalized: true });
    expect(h.command.mock.calls[1][0]).toMatchObject({ request: { action: 'edit', expectedVersion: '1:000000001', patch: { title: '새제목' } } });
});
it('본문 ACK 유실은 body+독립ref를 보관하며 같은 원문만 retry한다', async () => {
    const h = await pending();
    expect(h.map.size).toBe(2);
    const request = JSON.parse(h.entry.observedLocalText!).request;
    expect(await h.writer.retry(h.entry.reference!, h.ctx)).toMatchObject({ status: 'saved', requestFinalized: true });
    expect(h.command.mock.calls[1][0]).toEqual({ mode: 'apply', request });
    expect(h.map.size).toBe(0);
});
it('readback 실패는 업무 송신0이고 보관 실패를 미확정 송신으로 승격하지 않는다', async () => {
    const h = setup();
    h.storage.setItem = () => {
        throw Error('기기 보관 실패');
    };
    expect((await h.writer.save({ action: 'create', patch: createPatch }, { ...h.ctx, opening: null })).status).toBe('rejected');
    expect(h.command).not.toHaveBeenCalled();
});
it('다른 유효 사본·해시 불가도 ref only로 실제 서버 상태를 보이되 현재 완료로 쓰지 않는다', async () => {
    const h = await pending(), original = JSON.parse(h.entry.observedLocalText!);
    h.hash.mockRejectedValueOnce(Error('해시 불가'));
    h.command.mockResolvedValueOnce({
        version: 1, reference: original.request.reference, actorUid: 'A', employeeId: 'employee', requestHash: original.requestHash, status: 'applied', cleanupStatus: 'not-required', message: '최초 공지는 저장됨'
    });
    expect(await h.writer.inspect(h.entry.reference!, h.ctx)).toMatchObject({ status: 'rejected', copyMismatch: true, serverResult: { status: 'applied' } });
    expect(h.command.mock.calls.at(-1)?.[0]).toEqual({ mode: 'inspect', reference: original.request.reference });
    expect(h.map.size).toBe(2);
});
it('원문 없는 서버 applied를 현재 새 초안의 ACK로 올리지 않는다', async () => {
    const h = await pending(), plan = JSON.parse(h.entry.observedLocalText!);
    h.map.delete(h.entry.key);
    h.command.mockResolvedValueOnce({
        version: 1, reference: h.entry.reference, actorUid: 'A', employeeId: 'employee', requestHash: plan.requestHash, status: 'applied', cleanupStatus: 'not-required', message: '과거 저장됨'
    });
    expect(await h.writer.inspect(h.entry.reference!, h.ctx)).toMatchObject({ status: 'rejected', copyMismatch: true });
    expect(h.map.size).toBe(1);
});
it('손상 본문은 중단조회만 가능하고 opaque fence도 실제 결과로 표시한 뒤 명시 정리한다', async () => {
    const h = await pending();
    h.map.set(h.entry.key, '손상');
    expect((await h.writer.retry(h.entry.reference!, h.ctx)).status).toBe('unknown');
    const terminal = {
        version: 1, reference: h.entry.reference, actorUid: 'A', employeeId: 'employee', requestHash: null, status: 'cancelled', cleanupStatus: 'not-required', message: '중단완료'
    };
    h.command.mockResolvedValueOnce(terminal);
    expect(await h.writer.cancel(h.entry.reference!, h.ctx)).toMatchObject({ status: 'rejected', copyMismatch: true });
    expect(h.map.get(h.entry.key)).toBe('손상');
    h.command.mockResolvedValueOnce(terminal);
    expect((await h.writer.discard(h.entry.reference!, '손상', h.entry.observedReferenceText, h.ctx)).status).toBe('saved');
    expect(h.map.size).toBe(0);
});
it('표시 sidecar A 뒤 클릭전 B 교체는 정리 요청0/새사본삭제0이다', async () => {
    const h = await pending();
    h.map.delete(h.entry.key);
    const observed = (await h.writer.read(h.ctx))[0], key = [...h.map.keys()][0], count = h.command.mock.calls.length;
    h.map.set(key, '참조 B');
    expect((await h.writer.discard(observed.reference!, null, observed.observedReferenceText, h.ctx)).status).toBe('rejected');
    expect(h.map.get(key)).toBe('참조 B');
    expect(h.command.mock.calls.length).toBe(count);
});
it('서버 apply 뒤 교체된 body는 partial로 남기고 종결태그를 만들지 않는다', async () => {
    const h = setup(), transport = h.command.getMockImplementation()!;
    h.command.mockImplementationOnce(async (command) => {
        const result = await transport(command), key = [...h.map.keys()].find(key => !key.endsWith(':reference'))!;
        h.map.set(key, '새body');
        return result;
    });
    const outcome = await h.writer.save({ action: 'create', patch: createPatch }, { ...h.ctx, opening: null });
    expect(outcome).toMatchObject({ status: 'partial', committedIds: ['post'] });
    expect(outcome).not.toHaveProperty('requestFinalized');
    expect([...h.map.values()]).toContain('새body');
});
it('정리 pending/manual-blocked는 업무 ACK와 구분하고 본문을 재송신하지 않는다', async () => {
    const h = await pending(), plan = JSON.parse(h.entry.observedLocalText!);
    h.command.mockResolvedValueOnce({
        version: 1, reference: h.entry.reference, actorUid: 'A', employeeId: 'employee', requestHash: plan.requestHash, status: 'applied', cleanupStatus: 'manual-blocked', message: '본문 완료, 구형 사진은 수동 확인 필요'
    });
    expect(await h.writer.inspect(h.entry.reference!, h.ctx)).toMatchObject({ status: 'saved', requestFinalized: true, serverResult: { cleanupStatus: 'manual-blocked' } });
    expect(h.map.size).toBe(2);
    expect(h.command.mock.calls.filter(call => call[0].mode === 'apply')).toHaveLength(1);
});
it('사진 예약은 본문과 별도uploadId·불변원문으로 보관하고 예약 ACK만 돌려준다', async () => {
    const h = setup(), request: NoticePhotoRequest = {
        version: 1, reference: { companyId: 'taebaek', postId: 'post', uploadId: 'photo' }, sha256: 'a'.repeat(64), size: 1, contentType: 'image/png'
    };
    expect(await h.writer.reservePhoto(request, h.ctx)).toMatchObject({ status: 'reserved', uploadStatus: 'absent' });
    const rows = await h.writer.read(h.ctx);
    expect(rows[0]).toMatchObject({ kind: 'photo', request });
    expect(h.map.size).toBe(2);
});
it('scope 또는 직원 교체 응답은 저장 완료로 쓰거나 보관 원문을 지우지 않는다', async () => {
    const h = await pending(), plan = JSON.parse(h.entry.observedLocalText!);
    h.command.mockResolvedValueOnce({
        version: 1, reference: h.entry.reference, actorUid: 'A', employeeId: 'other', requestHash: plan.requestHash, status: 'applied', cleanupStatus: 'not-required', message: '완료'
    });
    expect((await h.writer.inspect(h.entry.reference!, h.ctx)).status).toBe('unknown');
    expect(h.map.size).toBe(2);
    h.setCurrent(false);
    expect((await h.writer.retry(h.entry.reference!, h.ctx)).status).toBe('unknown');
});
it('이력은 명시 scope 메타만 요청하고 빈 scan cursor를 보존한다', async () => {
    const h = setup();
    h.command.mockResolvedValueOnce({
        version: 1, companyId: 'taebaek', actorUid: 'A', employeeId: 'employee', entries: [], nextCursor: 'a'.repeat(64)
    });
    expect((await h.writer.history(h.ctx)).nextCursor).toBe('a'.repeat(64));
    expect(h.command.mock.calls[0][0]).toEqual({ mode: 'listHistory', companyId: 'taebaek' });
});
it('정확 body ACK가 참조한 검증완료 사진 사본만 정리하고 다른 draft예약은 남긴다', async () => {
    const h = setup(), photo = (id: string): NoticePhotoRequest => ({
        version: 1, reference: { companyId: 'taebaek', postId: 'post', uploadId: id }, sha256: 'a'.repeat(64), size: 1, contentType: 'image/png'
    });
    await h.writer.reservePhoto(photo('used'), h.ctx);
    await h.writer.reservePhoto(photo('other-draft'), h.ctx);
    const transport = h.command.getMockImplementation()!;
    h.command.mockImplementation(async (command) => command.mode === 'inspect' && 'photoReference' in command ? {
        version: 1, reference: command.photoReference, actorUid: 'A', employeeId: 'employee', requestHash: digest(serializeNoticePhotoRequest(photo('used'))), status: 'reserved', cleanupStatus: 'not-required', uploadStatus: 'verified', downloadUrl: 'https://example.com/a', generation: '1', path: noticePhotoPath(command.photoReference), message: '검증완료'
    } : transport(command));
    expect((await h.writer.save({ action: 'create', patch: { ...createPatch, blocks: [{
                    type: 'image', path: noticePhotoPath(photo('used').reference), url: 'https://example.com/a', caption: ''
                }] } }, { ...h.ctx, opening: null })).status).toBe('saved');
    const rows = await h.writer.read(h.ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0].reference).toEqual(photo('other-draft').reference);
});
it('body ACK후 사진 사본교체는 새사본을 지우지 않고 partial로 남긴다', async () => {
    const h = setup(), photo: NoticePhotoRequest = {
        version: 1, reference: { companyId: 'taebaek', postId: 'post', uploadId: 'used' }, sha256: 'a'.repeat(64), size: 1, contentType: 'image/png'
    };
    await h.writer.reservePhoto(photo, h.ctx);
    const photoEntry = (await h.writer.read(h.ctx))[0], transport = h.command.getMockImplementation()!;
    h.command.mockImplementation(async (command) => {
        if (command.mode === 'apply') {
            const value = await transport(command);
            h.map.set(photoEntry.key, '다른 사진 사본');
            return value;
        }
        if (command.mode === 'inspect' && 'photoReference' in command)
            return {
                version: 1, reference: photo.reference, actorUid: 'A', employeeId: 'employee', requestHash: digest(serializeNoticePhotoRequest(photo)), status: 'reserved', cleanupStatus: 'not-required', uploadStatus: 'verified', downloadUrl: 'https://example.com/a', generation: '1', path: noticePhotoPath(photo.reference), message: '검증완료'
            };
        return transport(command);
    });
    const outcome = await h.writer.save({ action: 'create', patch: { ...createPatch, blocks: [{
                    type: 'image', path: noticePhotoPath(photo.reference), url: 'https://example.com/a', caption: ''
                }] } }, { ...h.ctx, opening: null });
    expect(outcome).toMatchObject({ status: 'partial', committedIds: ['post'] });
    expect(outcome).not.toHaveProperty('requestFinalized');
    expect(h.map.get(photoEntry.key)).toBe('다른 사진 사본');
});
