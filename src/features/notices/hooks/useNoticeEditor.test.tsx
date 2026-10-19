// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
import { useNoticeEditor } from './useNoticeEditor';
import { resumeNoticePhoto } from '../../../shared/noticeImage';
import { noticeOpening, type NoticePhotoRequest } from '../../../shared/noticeCommand';
import type { NoticeBindings, NoticeEntry, NoticeOutcome } from '../infrastructure/noticeWrites';
const auth = vi.hoisted(() => ({ currentUser: { uid: 'A' } }));
vi.mock('../../../shared/firebase', () => ({ auth }));
vi.mock('../../../shared/noticeImage', () => ({ prepareNoticePhoto: vi.fn(async (companyId, postId, file) => ({ request: {
            version: 1, reference: { companyId, postId, uploadId: crypto.randomUUID() }, sha256: 'a'.repeat(64), size: file.size, contentType: file.type
        }, fileName: file.name })), resumeNoticePhoto: vi.fn(async (plan, _file, ctx, ports) => {
        await ports.reservePhoto(plan.request, ctx);
        return {
            type: 'image', path: `companies/${ctx.companyId}/notices/${plan.request.reference.postId}/${plan.request.reference.uploadId}`, url: 'https://example.com/a', caption: ''
        };
    }) }));
const post = {
    id: 'old', title: '기존', content: '옛 본문', author: '작성자', date: '2026-09-01', tag: '공지' as const, pinned: false
};
const scope = {
    companyId: 'taebaek' as const, actorUid: 'A', employeeId: 'employee', canWrite: true
};
function defer<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}
function ports() {
    let rows: NoticeEntry[] = [];
    const result: NoticeBindings = {
        open: vi.fn(async (post, ctx) => ({
            reference: { companyId: ctx.companyId, postId: ctx.postId, planId: ctx.planId }, actorUid: ctx.actorUid, employeeId: ctx.employeeId, opening: noticeOpening(post), expectedVersion: '1:000000001'
        })), save: vi.fn<NoticeBindings['save']>(async () => ({ status: 'saved', requestFinalized: true })), read: vi.fn(async () => rows), inspect: vi.fn<NoticeBindings['inspect']>(async () => ({ status: 'unknown', message: '처리 미확인', nextAction: '결과 확인' })), retry: vi.fn<NoticeBindings['retry']>(async () => ({ status: 'saved', requestFinalized: true })), cancel: vi.fn<NoticeBindings['cancel']>(async () => ({ status: 'cancelled', requestFinalized: true, message: '중단' })), cleanup: vi.fn<NoticeBindings['cleanup']>(async () => ({ status: 'saved' })), discard: vi.fn<NoticeBindings['discard']>(async () => ({ status: 'saved' })), history: vi.fn<NoticeBindings['history']>(async () => ({
            version: 1, companyId: 'taebaek', actorUid: 'A', employeeId: 'employee', entries: [], nextCursor: null
        })), reservePhoto: vi.fn<NoticeBindings['reservePhoto']>(async (request) => ({
            version: 1, reference: request.reference, actorUid: 'A', employeeId: 'employee', requestHash: 'a'.repeat(64), status: 'reserved', cleanupStatus: 'not-required', uploadStatus: 'absent', path: `companies/taebaek/notices/${request.reference.postId}/${request.reference.uploadId}`, message: '예약'
        })), observeLegacy: vi.fn<NoticeBindings['observeLegacy']>(async (reference) => ({
            reference, actorUid: 'A', employeeId: 'employee', observeOnly: true, exists: false, snapshot: null, expectedVersion: null
        }))
    };
    return { result, setRows: (value: NoticeEntry[]) => {
            rows = value;
        } };
}
beforeEach(() => {
    auth.currentUser.uid = 'A';
    sessionStorage.clear();
});
it('일반 직원 읽기 화면은 관리자 복구 I/O와 권한오류 없이 준비를 마친다', async () => {
    const p = ports();
    p.result.read = vi.fn().mockRejectedValue(Error('관리자 권한 필요'));
    const { result } = renderHook(() => useNoticeEditor({ ...scope, canWrite: false, ports: p.result }));
    await act(async () => {});
    expect(p.result.read).not.toHaveBeenCalled();
    expect(result.current.readLoading).toBe(false);
    expect(result.current.readError).toBe('');
    expect(result.current.canWrite).toBe(false);
});
const fill = (editor: ReturnType<typeof useNoticeEditor>) => {
    editor.changeField('title', '새 제목');
    editor.changeBlock(0, { text: '새 본문' });
};
it('새 작성당 ID와 plan은 고정하고 ACK 전에 닫거나 중복 저장하지 않는다', async () => {
    const p = ports(), gate = defer<NoticeOutcome>();
    p.result.save = vi.fn<NoticeBindings['save']>(() => gate.promise);
    const { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {
    });
    act(() => {
        result.current.openCreate();
        fill(result.current);
    });
    const id = result.current.draftId;
    let saving!: Promise<boolean>;
    act(() => {
        saving = result.current.save();
    });
    await act(() => result.current.save());
    expect(p.result.save).toHaveBeenCalledOnce();
    expect(result.current.showForm).toBe(true);
    expect(result.current.draftId).toBe(id);
    expect(await result.current.closeDraft()).toBe(false);
    await act(async () => {
        gate.resolve({ status: 'saved', requestFinalized: true });
        await saving;
    });
    expect(result.current.showForm).toBe(false);
});
it('기존 blocks없는 공지는 제목만 수정해 content와 blocks미존재를 보존한다', async () => {
    const p = ports(), { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {
    });
    await act(() => result.current.openEdit(post));
    act(() => result.current.changeField('title', '제목 수정'));
    await act(() => result.current.save());
    expect(p.result.save).toHaveBeenCalledWith({ action: 'edit', patch: { title: '제목 수정' } }, expect.objectContaining({ postId: 'old', opening: expect.objectContaining({ expectedVersion: '1:000000001' }) }));
});
it('삭제된 편집 대상 open 실패는 저장 미송신이며 명시 새작성은 새ID와 사진없는 초안이다', async () => {
    const p = ports();
    p.result.open = vi.fn().mockRejectedValue(Error('대상이 없습니다.'));
    const { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {
    });
    await act(() => result.current.openEdit({ ...post, blocks: [{
                type: 'image', path: 'old-photo', url: 'https://example.com/a', caption: '옛사진'
            }] }));
    expect(result.current.message).toContain('아직 저장 요청은 보내지 않았습니다');
    expect(p.result.save).not.toHaveBeenCalled();
    expect(result.current.locked).toBe(true);
    act(() => result.current.openCreate());
    expect(result.current.draftId).not.toBe('old');
    expect(result.current.blocks.every(b => b.type === 'text')).toBe(true);
});
it('unknown은 고정 원문 복구만 허용하고 body재조립 저장을 막는다', async () => {
    const p = ports();
    p.result.save = vi.fn<NoticeBindings['save']>(async (_input, ctx) => {
        p.setRows([{
                key: 'saved', kind: 'post', reference: { companyId: ctx.companyId, postId: ctx.postId, planId: ctx.planId }, status: 'valid', description: '원문', observedLocalText: 'raw', observedReferenceText: 'ref'
            }]);
        return { status: 'unknown', message: 'ACK 유실', nextAction: '같은 결과 확인' };
    });
    const { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {
    });
    act(() => {
        result.current.openCreate();
        fill(result.current);
    });
    await act(() => result.current.save());
    act(() => result.current.changeField('title', '변경 금지'));
    expect(result.current.form.title).toBe('새 제목');
    await act(() => result.current.save());
    expect(p.result.save).toHaveBeenCalledOnce();
    await act(() => result.current.retry(result.current.operations[0].reference!));
    expect(p.result.retry).toHaveBeenCalledOnce();
    expect(result.current.showForm).toBe(false);
});
it('사본정리 partial은 잠금/원인을 보존하고 동일 plan의 종결 태그 뒤만 닫는다', async () => {
    const p = ports();
    p.result.save = vi.fn<NoticeBindings['save']>(async (_input, ctx) => {
        p.setRows([{
                key: 'partial', kind: 'post', reference: { companyId: ctx.companyId, postId: ctx.postId, planId: ctx.planId }, status: 'valid', description: '원문', observedLocalText: 'raw', observedReferenceText: 'ref'
            }]);
        return {
            status: 'partial', reason: 'followup-unconfirmed', committedIds: [ctx.postId], unconfirmedIds: [], message: '기기 정리 실패', nextAction: '결과 확인'
        };
    });
    p.result.inspect = vi.fn<NoticeBindings['inspect']>(async () => {
        p.setRows([]);
        return { status: 'saved', requestFinalized: true };
    });
    const { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {
    });
    act(() => {
        result.current.openCreate();
        fill(result.current);
    });
    await act(() => result.current.save());
    expect(result.current.locked).toBe(true);
    expect(result.current.message).toContain('기기 정리 실패');
    expect(result.current.showForm).toBe(true);
    await act(() => result.current.inspect(result.current.operations[0].reference!));
    expect(result.current.showForm).toBe(false);
});
it('다른 과거 요청 완료와 관측사본 정리는 현재 새초안을 지우지 않는다', async () => {
    const p = ports();
    p.result.inspect = vi.fn<NoticeBindings['inspect']>(async () => ({ status: 'saved', requestFinalized: true }));
    const { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {
    });
    act(() => {
        result.current.openCreate();
        fill(result.current);
    });
    const id = result.current.draftId, ref = { companyId: 'taebaek' as const, planId: 'past', postId: 'past' };
    await act(() => result.current.inspect(ref));
    await act(() => result.current.discardCopy(ref, '본문 A', '참조 A'));
    expect(result.current.draftId).toBe(id);
    expect(result.current.form.title).toBe('새 제목');
    expect(p.result.discard).toHaveBeenCalledWith(ref, '본문 A', '참조 A', expect.any(Object));
});
it('UID 전환 뒤 old ACK/finally는 새 초안과 busy를 바꾸지 않는다', async () => {
    const p = ports(), old = defer<NoticeOutcome>(), fresh = defer<NoticeOutcome>();
    p.result.save = vi.fn<NoticeBindings['save']>().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
    const { result, rerender } = renderHook(({ uid }) => useNoticeEditor({ ...scope, actorUid: uid, ports: p.result }), { initialProps: { uid: 'A' } });
    await act(async () => {
    });
    act(() => {
        result.current.openCreate();
        fill(result.current);
    });
    let a!: Promise<boolean>, b!: Promise<boolean>;
    act(() => {
        a = result.current.save();
    });
    auth.currentUser.uid = 'B';
    rerender({ uid: 'B' });
    await act(async () => {
    });
    act(() => {
        result.current.openCreate();
        fill(result.current);
        result.current.changeField('title', 'B 초안');
    });
    act(() => {
        b = result.current.save();
    });
    await act(async () => {
        old.resolve({ status: 'saved', requestFinalized: true });
        await a;
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.form.title).toBe('B 초안');
    await act(async () => {
        fresh.resolve({ status: 'saved', requestFinalized: true });
        await b;
    });
});
it('사진 커서 삽입과 이동/기존사진제거는 후크가 소유하고 신규예약만 중단한다', async () => {
    const p = ports(), { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {
    });
    act(() => {
        result.current.openCreate();
        result.current.changeBlock(0, { text: '앞뒤' });
    });
    await act(() => result.current.uploadPhotos([new File(['a'], 'a.png', { type: 'image/png' })], { index: 0, offset: 1 }));
    expect(result.current.blocks.map(b => b.type === 'text' ? b.text : '사진')).toEqual(['앞', '사진', '뒤']);
    act(() => result.current.moveBlock(2, -1));
    expect(result.current.blocks.map(b => b.type === 'text' ? b.text : '사진')).toEqual(['앞', '뒤', '사진']);
    await act(() => result.current.removeBlock(2));
    expect(p.result.cancel).toHaveBeenCalledOnce();
    expect(p.result.cleanup).toHaveBeenCalledOnce();
});
it('legacy generic 원문은 서버관찰만 하고 receipt나새저장으로 승격하지 않는다', async () => {
    const p = ports();
    sessionStorage.setItem('notice-save-pending:taebaek:A', JSON.stringify({ post: { ...post, blocks: [{ type: 'text', text: '본문' }] }, editing: true }));
    const { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {
    });
    act(() => {
        result.current.openCreate();
        fill(result.current);
    });
    const id = result.current.draftId, raw = result.current.legacy!.observedLocalText;
    await act(() => result.current.legacyInspect());
    expect(p.result.observeLegacy).toHaveBeenCalledOnce();
    expect(result.current.legacy?.observation?.exists).toBe(false);
    expect(p.result.save).not.toHaveBeenCalled();
    await act(() => result.current.legacyDiscard(raw));
    expect(sessionStorage.getItem('notice-save-pending:taebaek:A')).toBeNull();
    expect(result.current.draftId).toBe(id);
    expect(result.current.form.title).toBe('새 제목');
});
it('legacy observe중 사본교체 또는 UID교체는 현재초안/새사본을 정리하지 않는다', async () => {
    const p = ports();
    const raw = JSON.stringify({ post: { ...post, blocks: [] }, editing: true });
    sessionStorage.setItem('notice-save-pending:taebaek:A', raw);
    const { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {
    });
    await act(() => result.current.legacyInspect());
    sessionStorage.setItem('notice-save-pending:taebaek:A', '새 사본');
    expect(await result.current.legacyDiscard(raw)).toBe(false);
    expect(sessionStorage.getItem('notice-save-pending:taebaek:A')).toBe('새 사본');
});
it('이력은 명시 버튼으로만 조회하고 빈 scan nextcursor를 보존한다', async () => {
    const p = ports();
    p.result.history = vi.fn<NoticeBindings['history']>().mockResolvedValue({
        version: 1, companyId: 'taebaek', actorUid: 'A', employeeId: 'employee', entries: [], nextCursor: 'a'.repeat(64)
    });
    const { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {
    });
    expect(p.result.history).not.toHaveBeenCalled();
    await act(() => result.current.loadHistory());
    expect(result.current.historyMore).toBe('a'.repeat(64));
    expect(result.current.message).toContain('0건');
    await act(() => result.current.nextHistory());
    expect(p.result.history).toHaveBeenLastCalledWith(expect.any(Object), 'a'.repeat(64));
});
it('초기보관읽기 대기와 실패는 새송신을 막고 명시refresh가 복구한다', async () => {
    const p = ports(), read = defer<NoticeEntry[]>();
    p.result.read = vi.fn().mockReturnValueOnce(read.promise).mockRejectedValueOnce(Error('기기 오류')).mockResolvedValue([]);
    const { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    act(() => {
        result.current.openCreate();
        fill(result.current);
    });
    await act(() => result.current.save());
    expect(p.result.save).not.toHaveBeenCalled();
    await act(async () => read.resolve([]));
    await act(() => result.current.refresh());
    expect(result.current.readError).toContain('기기 오류');
    await act(() => result.current.save());
    expect(p.result.save).not.toHaveBeenCalled();
    await act(() => result.current.refresh());
    expect(result.current.readError).toBe('');
});
it('확인된 본문 완료와 정리pending 단계는 reload후 본문재시도 대신 사진정리만 노출한다', async () => {
    const p = ports(), ref = { companyId: 'taebaek' as const, planId: 'done', postId: 'old' }, row: NoticeEntry = {
        key: 'done', kind: 'post', reference: ref, status: 'valid', description: '완료 후 사진정리', observedLocalText: '원문', observedReferenceText: '참조', serverResult: {
            version: 1, reference: ref, actorUid: 'A', employeeId: 'employee', status: 'applied', requestHash: 'a'.repeat(64), cleanupStatus: 'pending', message: '본문 완료, 사진 정리 대기'
        }
    };
    p.setRows([row]);
    const { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {
    });
    expect(result.current.canRetry(row)).toBe(false);
    expect(result.current.canCleanup(row)).toBe(true);
    expect(result.current.canCancel(row)).toBe(false);
    expect(result.current.canCreateNew).toBe(true);
});
it('본문 완료 후 사용된 사진 표시캐시를 미완료로 남기지 않는다', async () => {
    const p = ports(), { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {
    });
    act(() => {
        result.current.openCreate();
        fill(result.current);
    });
    await act(() => result.current.uploadPhotos([new File(['a'], 'a.png', { type: 'image/png' })]));
    expect(result.current.photos).toHaveLength(1);
    await act(() => result.current.save());
    expect(result.current.photos).toHaveLength(0);
    expect(result.current.showForm).toBe(false);
});
it('식별 불가 옛 사본은 서버추정 없이 본문과 참조 관측값이 같을 때만 정리한다', async () => {
    const key = 'notice-save-pending:taebaek:A', p = ports();
    sessionStorage.setItem(key, '{손상 원문');
    sessionStorage.setItem(key + ':reference', '참조 A');
    const { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {});
    act(() => { result.current.openCreate(); fill(result.current); });
    expect(result.current.legacy?.message).toContain('대상을 식별할 수 없어');
    expect(result.current.canDiscardLegacy).toBe(true);
    sessionStorage.setItem(key + ':reference', '참조 B');
    await act(async () => { expect(await result.current.legacyDiscard('{손상 원문', '참조 A')).toBe(false); });
    expect(sessionStorage.getItem(key + ':reference')).toBe('참조 B');
    await act(() => result.current.refresh());
    await act(async () => { expect(await result.current.legacyDiscard('{손상 원문', '참조 B')).toBe(true); });
    expect(result.current.form.title).toBe('새 제목');
    expect(p.result.observeLegacy).not.toHaveBeenCalled();
    expect(p.result.cancel).not.toHaveBeenCalled();
});
it('편집 사진 업로드 실패 뒤 같은 사진 재개 성공은 blocks 변경을 저장한다', async () => {
    const p = ports(), { result } = renderHook(() => useNoticeEditor({ ...scope, ports: p.result }));
    await act(async () => {});
    await act(() => result.current.openEdit(post));
    vi.mocked(resumeNoticePhoto).mockRejectedValueOnce(Error('주소 확인 실패'));
    await act(() => result.current.uploadPhotos([new File(['a'], 'a.png', { type: 'image/png' })]));
    const id = result.current.photos[0].id;
    await act(() => result.current.resumePhoto(id));
    act(() => result.current.changeField('title', '사진 재개'));
    await act(() => result.current.save());
    expect(p.result.save).toHaveBeenCalledWith(expect.objectContaining({patch: expect.objectContaining({blocks: expect.arrayContaining([expect.objectContaining({type: 'image'})])})}), expect.any(Object));
});
