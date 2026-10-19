import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
vi.hoisted(() => { process.env.FIREBASE_CONFIG = JSON.stringify({ storageBucket: 'demo-notice-unit.appspot.com' }); });
import * as admin from 'firebase-admin';
import { randomUUID, createHash } from 'node:crypto';
import { executeNoticeCommand, noticeReceiptId, noticePhotoReceiptId, cleanupLateNoticeObject } from './noticeCommand';
import { noticeOpening, noticePhotoPath, normalizeNoticeRequest, normalizeNoticeResult, normalizeNoticePhotoResult, normalizeNoticeOpenResult, type NoticeRequest, type NoticeReference, type NoticePhotoRequest, type NoticeResult, type NoticeHistoryResult } from './shared/noticeCommand';
import type { NoticeStoragePort } from './noticeStorageCleanup';
const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const actor = { uid: 'u', token: { employeeId: 'legacy/no-doc', companyId: 'taebaek', isAdmin: true } };
let app: admin.app.App, db: admin.firestore.Firestore;
const owned = new Set<string>();
const own = (p: string) => { owned.add(p); return db.doc(p); };
const bytes = Buffer.from('abc'), sha256 = createHash('sha256').update(bytes).digest('hex');
const objects = new Map<string, {
    generation: string;
    size: number;
    contentType: string;
    metadata: Record<string, string>;
}>();
const remove = vi.fn(async (path: string, generation: string) => {
    const current = objects.get(path);
    if (!current)
        throw { code: 404 };
    if (current.generation !== generation)
        throw { code: 412 };
    objects.delete(path);
});
const storage: NoticeStoragePort = { bucketName: 'demo-bucket', stat: async (p) => objects.get(p) || null, read: async () => bytes, remove };
const ref = (): NoticeReference => { const r = { companyId: 'taebaek' as const, postId: 'post-' + randomUUID(), planId: randomUUID() }; own('notices/' + r.postId); own('noticeOperations/' + noticeReceiptId(r, actor.uid)); return r; };
const run = async (reference: NoticeReference, mode: 'inspect' | 'cancel') => normalizeNoticeResult(await executeNoticeCommand(db, actor, { mode, reference }, storage), reference, actor.uid, String(actor.token.employeeId));
const open = async (reference: NoticeReference) => normalizeNoticeOpenResult(await executeNoticeCommand(db, actor, { mode: 'open', reference, opening: noticeOpening((await own('notices/' + reference.postId).get()).data()) }, storage), reference, actor.uid, String(actor.token.employeeId));
const apply = async (request: NoticeRequest, store = db) => normalizeNoticeResult(await executeNoticeCommand(store, actor, { mode: 'apply', request }, storage), request.reference, actor.uid, String(actor.token.employeeId));
const body = (reference: NoticeReference): NoticeRequest => ({ version: 1, reference, action: 'create', expectedVersion: null, patch: { title: '제목', content: '본문', author: '관리자', date: '2026-10-19', tag: '공지', pinned: false, blocks: [{ type: 'text', text: '본문' }] } });
async function photo(reference: NoticeReference, upload = true) {
    const request: NoticePhotoRequest = { version: 1, reference: { companyId: reference.companyId, postId: reference.postId, uploadId: randomUUID() }, sha256, size: 3, contentType: 'image/png' };
    const p = noticePhotoPath(request.reference);
    own('noticePhotoUploads/' + request.reference.uploadId);
    own('noticeOperations/' + noticePhotoReceiptId(request.reference, actor.uid));
    own('noticeStoragePaths/' + createHash('sha256').update(p).digest('hex'));
    await executeNoticeCommand(db, actor, { mode: 'reservePhoto', request }, storage);
    if (upload)
        objects.set(p, { generation: '1', size: 3, contentType: 'image/png', metadata: { uploadId: request.reference.uploadId, sha256, actorUid: actor.uid, employeeId: String(actor.token.employeeId), firebaseStorageDownloadTokens: 'token' } });
    const result = normalizeNoticePhotoResult(await executeNoticeCommand(db, actor, { mode: 'inspect', photoReference: request.reference }, storage), request.reference, actor.uid, String(actor.token.employeeId));
    return { request, path: p, result };
}
describe.skipIf(!enabled)('공지 실제 Firestore 명령과 모사 Storage 경계', () => {
    beforeAll(() => { const projectId = 'demo-notice-command-' + randomUUID().slice(0, 8); app = admin.initializeApp({ projectId }, projectId); db = admin.firestore(app); });
    beforeEach(async () => {
        for (const path of owned)
            if (path.startsWith('notices/'))
                await db.doc(path).delete();
        objects.clear();
        remove.mockClear();
    });
    afterAll(async () => {
        if (!app)
            return;
        for (const p of owned)
            await db.doc(p).delete();
        await app.delete();
    });
    it('create 원문과receipt는함께확정되고응답유실뒤동일요청이후속값을덮지않는다', async () => { const r = ref(), request = body(r); expect((await apply(request)).status).toBe('applied'); await own('notices/' + r.postId).update({ title: '후속' }); expect((await run(r, 'inspect')).status).toBe('applied'); expect((await apply(request)).status).toBe('applied'); expect((await own('notices/' + r.postId).get()).get('title')).toBe('후속'); });
    it('legacy content만있는공지와path없는기존block을읽고dirty본문수정만보존한다', async () => { const r = ref(), target = own('notices/' + r.postId); await target.set({ companyId: 'taebaek', content: 'old', unknown: 123, blocks: [{ type: 'image', url: 'https://example.com/old', legacy: true }] }); const opened = await open(r); expect((await apply({ version: 1, reference: r, action: 'edit', expectedVersion: opened.expectedVersion, patch: { title: '새제목' } })).status).toBe('applied'); expect((await target.get()).data()).toMatchObject({ unknown: 123, blocks: [{ legacy: true }] }); });
    it('예약없는기존사진은pathURL존재와개수그대로caption만수정할수있다', async () => {
        for (const old of [{ type: 'image', url: 'https://example.com/old', caption: '이전', legacy: 1 }, { type: 'image', path: null, url: 'https://example.com/old', caption: '이전' }, { type: 'image', path: '', url: 'https://example.com/old', caption: '이전' }, { type: 'image', path: 'companies/taebaek/notices/legacy/photo', url: 'https://example.com/old', caption: '이전' }]) {
            const r = ref(), target = own('notices/' + r.postId);
            await target.set({ companyId: 'taebaek', content: '원본문', blocks: [old], unknown: '보존' });
            const req = normalizeNoticeRequest({ version: 1, reference: r, action: 'edit', expectedVersion: (await open(r)).expectedVersion, patch: { blocks: [{ ...old, caption: '수정 설명' }] } });
            expect((await apply(req)).status).toBe('applied');
            expect((await target.get()).get('blocks')).toEqual([{ ...old, caption: '수정 설명' }]);
            expect((await target.get()).get('content')).toBe('원본문');
            expect((await target.get()).get('unknown')).toBe('보존');
        }
    });
    it('기존사진개수증가와pathURL교체는caption허용으로우회할수없다', async () => {
        for (const mode of ['duplicate', 'url', 'path', 'extra']) {
            const r = ref(), old = { type: 'image', path: 'companies/taebaek/notices/' + r.postId + '/legacy', url: 'https://example.com/old', caption: '이전' }, target = own('notices/' + r.postId);
            await target.set({ companyId: 'taebaek', content: 'old', blocks: [old] });
            const next = mode === 'duplicate' ? [old, old] : [{ ...old, ...(mode === 'url' ? { url: 'https://example.com/new' } : mode === 'path' ? { path: null } : { unknown: '추가' }) }];
            const req = normalizeNoticeRequest({ version: 1, reference: r, action: 'edit', expectedVersion: (await open(r)).expectedVersion, patch: { blocks: next } });
            expect((await apply(req)).status).toBe('rejected');
            expect((await target.get()).get('blocks')).toEqual([old]);
        }
    });
    it('비수정필드변경과재생성은전체nativeCAS로거절한다', async () => { const r = ref(), target = own('notices/' + r.postId); await target.set({ companyId: 'taebaek', title: '원본', content: 'old' }); const opened = await open(r); await target.update({ unknown: 'changed' }); expect((await apply({ version: 1, reference: r, action: 'pin', expectedVersion: opened.expectedVersion, patch: { pinned: true } })).status).toBe('rejected'); expect((await target.get()).get('pinned')).toBeUndefined(); });
    it('부재는unknown이며중단뒤늦은apply를fence하고다른photo예약은닫지않는다', async () => { const r = ref(), p = await photo(r, false); expect((await run(r, 'inspect')).status).toBe('unknown'); expect((await run(r, 'cancel')).status).toBe('cancelled'); expect((await apply(body(r))).status).toBe('cancelled'); expect((await own('noticePhotoUploads/' + p.request.reference.uploadId).get()).get('closed')).toBe(false); });
    it('예약기록만있는사진도이력에서발견하고원문없이중단정리한다', async () => { const r = ref(), p = await photo(r); const h = await executeNoticeCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek' }, storage) as NoticeHistoryResult; expect(h.entries.some(e => e.kind === 'photo' && e.result.reference.uploadId === p.request.reference.uploadId)).toBe(true); await executeNoticeCommand(db, actor, { mode: 'cancelPhoto', photoReference: p.request.reference }, storage); const result = await executeNoticeCommand(db, actor, { mode: 'cleanup', photoReference: p.request.reference }, storage); expect(result.cleanupStatus).toBe('deleted'); expect(objects.has(p.path)).toBe(false); });
    it('동일예약실객체SHA확인은URL실패reload뒤에도재업로드없이verified주소를준다', async () => { const r = ref(), p = await photo(r); expect(p.result.uploadStatus).toBe('verified'); const again = await executeNoticeCommand(db, actor, { mode: 'reservePhoto', request: p.request }, storage); expect(again).toMatchObject({ uploadStatus: 'verified', generation: '1', downloadUrl: expect.stringContaining('token=token') }); });
    it('기존객체는새예약으로승인하지않고사진미도착본문은영구거절receipt를만들지않는다', async () => { const r = ref(), p = await photo(r, false); const req = body(r); req.patch!.blocks = [{ type: 'image', path: p.path, url: 'https://not-yet', caption: '' }]; expect((await apply(req)).status).toBe('unknown'); expect((await own('noticeOperations/' + noticeReceiptId(r, actor.uid)).get()).exists).toBe(false); const other = { ...p.request, reference: { ...p.request.reference, uploadId: randomUUID() } }; objects.set(noticePhotoPath(other.reference), { generation: '1', size: 3, contentType: 'image/png', metadata: {} }); await expect(executeNoticeCommand(db, actor, { mode: 'reservePhoto', request: other }, storage)).rejects.toMatchObject({ code: 'failed-precondition' }); });
    it('검증예약사진만새본문참조가능하고임의다른공지사진추가는거절한다', async () => { const r = ref(), p = await photo(r); const req = body(r); req.patch!.blocks = [{ type: 'image', path: p.path, url: p.result.downloadUrl!, caption: '' }]; expect((await apply(req)).status).toBe('applied'); const other = ref(), borrow = body(other); borrow.patch!.blocks = req.patch!.blocks; expect((await apply(borrow)).status).toBe('rejected'); });
    it('본문삭제ACK뒤실사진만정리하고다른공지path및정확URL참조는보존한다', async () => {
        for (const byUrl of [false, true]) {
            const r = ref(), p = await photo(r), req = body(r);
            req.patch!.blocks = [{ type: 'image', path: p.path, url: p.result.downloadUrl!, caption: '' }];
            await apply(req);
            const other = own('notices/shared-' + randomUUID());
            await other.set({ companyId: 'taebaek', content: '공유', blocks: [byUrl ? { type: 'image', url: p.result.downloadUrl } : { type: 'image', path: p.path, url: 'other' }] });
            const del = { ...r, planId: randomUUID() };
            own('noticeOperations/' + noticeReceiptId(del, actor.uid));
            const opened = await open(del);
            expect((await apply({ version: 1, reference: del, action: 'delete', expectedVersion: opened.expectedVersion })).cleanupStatus).toBe('pending');
            expect((await executeNoticeCommand(db, actor, { mode: 'cleanup', reference: del }, storage)).cleanupStatus).toBe('retained-shared');
            expect(objects.has(p.path)).toBe(true);
        }
    });
    it('legacyHTML모호참조와path없는사진은본문완료와별도manualblocked로끝낸다', async () => { const r = ref(), target = own('notices/' + r.postId); await target.set({ companyId: 'taebaek', content: '<img src="old">', blocks: [{ type: 'image', url: 'https://example.com' }] }); const opened = await open(r); expect((await apply({ version: 1, reference: r, action: 'delete', expectedVersion: opened.expectedVersion })).cleanupStatus).toBe('manual-blocked'); expect((await executeNoticeCommand(db, actor, { mode: 'cleanup', reference: r }, storage)).cleanupStatus).toBe('manual-blocked'); });
    it('다른URL의path없는legacy사진도경로를추정하지않고자동정리보류한다', async () => { const r = ref(), p = await photo(r); await own('notices/ambiguous-' + randomUUID()).set({ companyId: 'taebaek', content: 'old', blocks: [{ type: 'image', url: 'https://alias.example/unknown' }] }); await executeNoticeCommand(db, actor, { mode: 'cancelPhoto', photoReference: p.request.reference }, storage); expect((await executeNoticeCommand(db, actor, { mode: 'cleanup', photoReference: p.request.reference }, storage)).cleanupStatus).toBe('manual-blocked'); expect(objects.has(p.path)).toBe(true); });
    it('늦은finalize정리실패는pending영속후throw하고같은event재시도는정리한다', async () => { const r = ref(), p = await photo(r, false); await executeNoticeCommand(db, actor, { mode: 'cancelPhoto', photoReference: p.request.reference }, storage); objects.set(p.path, { generation: '1', size: 3, contentType: 'image/png', metadata: { uploadId: p.request.reference.uploadId, sha256, actorUid: actor.uid, employeeId: String(actor.token.employeeId) } }); remove.mockRejectedValueOnce(Error('storage failure')); await expect(cleanupLateNoticeObject(db, { name: p.path, generation: '1', bucket: 'demo-bucket' }, storage)).rejects.toThrow(); expect((await executeNoticeCommand(db, actor, { mode: 'inspect', photoReference: p.request.reference }, storage)).cleanupStatus).toBe('pending'); await cleanupLateNoticeObject(db, { name: p.path, generation: '1', bucket: 'demo-bucket' }, storage); expect(objects.has(p.path)).toBe(false); });
    it('부재정리뒤늦은객체도finalize에서다시발견해동일예약만삭제한다', async () => { const r = ref(), p = await photo(r, false); await executeNoticeCommand(db, actor, { mode: 'cancelPhoto', photoReference: p.request.reference }, storage); expect((await executeNoticeCommand(db, actor, { mode: 'cleanup', photoReference: p.request.reference }, storage)).cleanupStatus).toBe('absent'); objects.set(p.path, { generation: '1', size: 3, contentType: 'image/png', metadata: { uploadId: p.request.reference.uploadId, sha256, actorUid: actor.uid, employeeId: String(actor.token.employeeId) } }); await cleanupLateNoticeObject(db, { name: p.path, generation: '1', bucket: 'demo-bucket' }, storage); expect(objects.has(p.path)).toBe(false); });
    it('legacy현재관측은현재내용과부재만표시하고영수증쓰기와저장opening승격없다', async () => { const r = ref(); let observed = await executeNoticeCommand(db, actor, { mode: 'open', reference: r, observeOnly: true }, storage); expect(observed).toMatchObject({ observeOnly: true, exists: false, snapshot: null, expectedVersion: null }); await own('notices/' + r.postId).set({ companyId: 'taebaek', title: '현재', secret: '숨김' }); observed = await executeNoticeCommand(db, actor, { mode: 'open', reference: r, observeOnly: true }, storage); expect(observed).toMatchObject({ observeOnly: true, exists: true }); expect(JSON.stringify(observed)).not.toContain('숨김'); expect((await own('noticeOperations/' + noticeReceiptId(r, actor.uid)).get()).exists).toBe(false); await own('notices/' + r.postId).update({ companyId: 'punghoe' }); await expect(executeNoticeCommand(db, actor, { mode: 'open', reference: r, observeOnly: true }, storage)).rejects.toMatchObject({ code: 'failed-precondition' }); });
    it('정리fence뒤같은path새본문재참조는거절하고새generation은보존한다', async () => { const r = ref(), p = await photo(r), create = body(r); create.patch!.blocks = [{ type: 'image', path: p.path, url: p.result.downloadUrl!, caption: '' }]; await apply(create); const del = { ...r, planId: randomUUID() }; own('noticeOperations/' + noticeReceiptId(del, actor.uid)); await apply({ version: 1, reference: del, action: 'delete', expectedVersion: (await open(del)).expectedVersion }); let release!: () => void, entered!: () => void; const gate = new Promise<void>(res => release = res), started = new Promise<void>(res => entered = res); const port = { ...storage, stat: async (path: string) => { entered(); await gate; return storage.stat(path); } }; const cleaning = executeNoticeCommand(db, actor, { mode: 'cleanup', reference: del }, port); await started; const again = { ...r, planId: randomUUID() }; own('noticeOperations/' + noticeReceiptId(again, actor.uid)); const newer = body(again); newer.patch!.blocks = create.patch!.blocks; expect((await apply(newer)).status).toBe('rejected'); objects.set(p.path, { ...objects.get(p.path)!, generation: '2' }); release(); expect((await cleaning).cleanupStatus).toBe('retained-replaced'); expect(objects.get(p.path)?.generation).toBe('2'); });
    it('늦게실패한정리는동시새시도의성공을pending으로되돌리지않는다', async () => { const r = ref(), p = await photo(r); await executeNoticeCommand(db, actor, { mode: 'cancelPhoto', photoReference: p.request.reference }, storage); let release!: () => void, entered!: () => void; const gate = new Promise<void>(res => release = res), started = new Promise<void>(res => entered = res); const port = { ...storage, remove: async () => { entered(); await gate; throw Error('old failure'); } }; const first = executeNoticeCommand(db, actor, { mode: 'cleanup', photoReference: p.request.reference }, port); await started; expect((await executeNoticeCommand(db, actor, { mode: 'cleanup', photoReference: p.request.reference }, storage)).cleanupStatus).toBe('deleted'); release(); expect((await first).cleanupStatus).toBe('deleted'); });
    it('본문없는사진포함본인이력은50개cursor와다른UID빈결과를유지한다', async () => {
        for (let i = 0; i < 51; i++)
            await run(ref(), 'cancel');
        const first = await executeNoticeCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek' }, storage) as NoticeHistoryResult;
        expect(first.entries).toHaveLength(50);
        expect(first.nextCursor).toBeTruthy();
        const next = await executeNoticeCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek', cursor: first.nextCursor! }, storage) as NoticeHistoryResult;
        expect(next.entries.length).toBeGreaterThan(0);
        const other = await executeNoticeCommand(db, { ...actor, uid: 'other' }, { mode: 'listHistory', companyId: 'taebaek' }, storage) as NoticeHistoryResult;
        expect(other.entries).toEqual([]);
    });
    it('삭제후다른generation은보존하고전체commit실패는본문receipt동시롤백한다', async () => {
        const r = ref(), request = body(r);
        const failing = new Proxy(db, { get(o, k) {
                if (k === 'runTransaction')
                    return (fn: (t: admin.firestore.Transaction) => unknown) => o.runTransaction(tx => fn(new Proxy(tx, { get(t, p) {
                            if (p === 'create')
                                return (ref: admin.firestore.DocumentReference, data: Record<string, unknown>) => t.create(ref, ref.parent.id === 'noticeOperations' ? { ...data, overflow: 'x'.repeat(1100000) } : data);
                            const v = Reflect.get(t, p);
                            return typeof v === 'function' ? v.bind(t) : v;
                        } })) as Promise<never>);
                const v = Reflect.get(o, k);
                return typeof v === 'function' ? v.bind(o) : v;
            } });
        await expect(apply(request, failing)).rejects.toBeDefined();
        expect((await own('notices/' + r.postId).get()).exists).toBe(false);
        expect((await own('noticeOperations/' + noticeReceiptId(r, actor.uid)).get()).exists).toBe(false);
    });
});
