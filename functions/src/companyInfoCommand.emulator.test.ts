import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import { executeCompanyInfoCommand, companyInfoReceiptId } from './companyInfoCommand';
import { companyInfoOpening, normalizeCompanyInfoOpenResult, normalizeCompanyInfoResult, type CompanyInfoReference, type CompanyInfoRequest } from './shared/companyInfoCommand';
const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const actor = { uid: 'employee', token: { employeeId: 'e', companyId: 'taebaek', isAdmin: false } };
let app: admin.app.App, db: admin.firestore.Firestore;
const paths = new Set<string>();
const own = (p: string) => { paths.add(p); return db.doc(p); };
const reference = (): CompanyInfoReference => { const ref = { companyId: 'taebaek' as const, planId: randomUUID() }; own('companyInfoOperations/' + companyInfoReceiptId(ref.companyId, actor.uid, ref.planId)); return ref; };
const target = () => own('settings/taebaek');
const run = async (ref: CompanyInfoReference, mode: 'inspect' | 'cancel') => normalizeCompanyInfoResult(await executeCompanyInfoCommand(db, actor, { mode, reference: ref }), ref, actor.uid);
const opening = async (ref: CompanyInfoReference) => normalizeCompanyInfoOpenResult(await executeCompanyInfoCommand(db, actor, { mode: 'open', reference: ref, opening: companyInfoOpening((await target().get()).data()) }), ref, actor.uid);
const request = async (ref: CompanyInfoReference, patch: CompanyInfoRequest['patch']): Promise<CompanyInfoRequest> => ({ version: 1, reference: ref, expectedVersion: (await opening(ref)).expectedVersion, patch });
const apply = async (req: CompanyInfoRequest, store = db) => normalizeCompanyInfoResult(await executeCompanyInfoCommand(store, actor, { mode: 'apply', request: req }), req.reference, actor.uid);
describe.skipIf(!enabled)('회사정보 실제 원자 명령', () => {
    beforeAll(async () => { const projectId = 'demo-company-info-' + randomUUID().slice(0, 8); app = admin.initializeApp({ projectId }, projectId); db = admin.firestore(app); await own('employees/e').set({ companyId: 'taebaek' }); });
    beforeEach(async () => { await target().set({ companyId: 'taebaek', name: '기존', adminPassword: 'secret', bankAccount: '', unknown: { x: 1 } }); });
    afterAll(async () => {
        if (!app)
            return;
        for (const p of paths)
            await db.doc(p).delete();
        await app.delete();
    });
    it('직원권한으로 최초 설정을 생성하고 영수증을 함께 확정한다', async () => { await target().delete(); const ref = reference(), req = await request(ref, { name: '회사', bankAccount: '' }); expect(req.expectedVersion).toBeNull(); expect((await apply(req)).status).toBe('applied'); expect((await target().get()).data()).toEqual({ companyId: 'taebaek', name: '회사', bankAccount: '' }); });
    it('raw 빈은행값·숨은 비밀번호·미지필드는 보존하고 dirty만 쓴다', async () => { await target().set({ companyId: 'taebaek', bankAccount: '', adminPassword: 'secret', unknown: { x: 1 } }); const ref = reference(), opened = await opening(ref); expect(JSON.stringify(opened)).not.toContain('secret'); const req = { version: 1 as const, reference: ref, expectedVersion: opened.expectedVersion, patch: { phone: '' } }; expect((await apply(req)).status).toBe('applied'); expect((await target().get()).data()).toMatchObject({ bankAccount: '', adminPassword: 'secret', unknown: { x: 1 }, phone: '' }); const saved = (await own('companyInfoOperations/' + companyInfoReceiptId(ref.companyId, actor.uid, ref.planId)).get()).data(); expect(JSON.stringify(saved)).not.toContain('secret'); });
    it('은행 표시 fallback을 원문으로 대체하지 않고 누락 null 빈값 공백을 구분한다', async () => {
        for (const value of [undefined, null, '', '   ']) {
            await target().set({ companyId: 'taebaek', bizNo: '139-04-37157', ...(value === undefined ? {} : { bankAccount: value }), adminPassword: 'hidden' });
            const ref = reference();
            const raw = (await target().get()).data()!;
            await expect(executeCompanyInfoCommand(db, actor, { mode: 'open', reference: ref, opening: companyInfoOpening({ ...raw, bankAccount: '표시 fallback' }) })).rejects.toMatchObject({ code: 'failed-precondition' });
            const req = await request(ref, { bankAccount: '' });
            expect((await apply(req)).status).toBe('applied');
            expect((await target().get()).get('bankAccount')).toBe('');
            expect((await target().get()).get('adminPassword')).toBe('hidden');
        }
        await target().set({ companyId: 'taebaek', adminPassword: 'only-hidden' });
        const ref = reference();
        const opened = normalizeCompanyInfoOpenResult(await executeCompanyInfoCommand(db, actor, { mode: 'open', reference: ref, opening: companyInfoOpening({}) }), ref, actor.uid);
        expect(opened.expectedVersion).not.toBeNull();
    });
    it('숨은 필드 동시변경은 native CAS 거절하고 덮지 않는다', async () => { const ref = reference(), req = await request(ref, { name: '옛수정' }); await target().update({ adminPassword: 'new-secret' }); expect((await apply(req)).status).toBe('rejected'); expect((await target().get()).get('name')).not.toBe('옛수정'); });
    it('삭제 재생성도 옛 버전 수정은 거절한다', async () => { const ref = reference(), req = await request(ref, { name: 'old' }); await target().delete(); await target().set({ companyId: 'taebaek', name: '재생성' }); expect((await apply(req)).status).toBe('rejected'); expect((await target().get()).get('name')).toBe('재생성'); });
    it('응답 유실 뒤 receipt 조회·재전송은 후속값을 덮지 않는다', async () => { const ref = reference(), req = await request(ref, { name: '첫수정' }); await apply(req); await target().update({ name: '후속' }); expect((await run(ref, 'inspect')).status).toBe('applied'); expect((await apply(req)).status).toBe('applied'); expect((await target().get()).get('name')).toBe('후속'); await own('employees/e').delete(); expect((await run(ref, 'inspect')).status).toBe('applied'); await own('employees/e').set({ companyId: 'taebaek' }); });
    it('없는 기록은 unknown이고 중단뒤 늦은 동일 apply는 쓰지 않는다', async () => { const ref = reference(), req = await request(ref, { name: '늦음' }); expect((await run(ref, 'inspect')).status).toBe('unknown'); expect((await run(ref, 'cancel')).status).toBe('cancelled'); expect((await apply(req)).status).toBe('cancelled'); expect((await target().get()).get('name')).not.toBe('늦음'); });
    it('유효 직원 claim은 직원문서 부재와 legacy회사누락이어도 기존 직원 권한을 유지한다', async () => {
        for (const employeeId of ['missing-employee', 'legacy-employee', 'claim/only', '']) {
            if (employeeId === 'legacy-employee')
                await own('employees/legacy-employee').set({ name: '기존 직원' });
            const user = { uid: 'claim-' + employeeId, token: { employeeId, companyId: 'taebaek', isAdmin: false } };
            const ref = reference();
            own('companyInfoOperations/' + companyInfoReceiptId('taebaek', user.uid, ref.planId));
            const opened = normalizeCompanyInfoOpenResult(await executeCompanyInfoCommand(db, user, { mode: 'open', reference: ref, opening: companyInfoOpening((await target().get()).data()) }), ref, user.uid);
            const req: CompanyInfoRequest = { version: 1, reference: ref, expectedVersion: opened.expectedVersion, patch: { phone: 'claim허용' } };
            expect(normalizeCompanyInfoResult(await executeCompanyInfoCommand(db, user, { mode: 'apply', request: req }), ref, user.uid).status).toBe('applied');
            const cancelRef = reference();
            own('companyInfoOperations/' + companyInfoReceiptId('taebaek', user.uid, cancelRef.planId));
            expect(normalizeCompanyInfoResult(await executeCompanyInfoCommand(db, user, { mode: 'cancel', reference: cancelRef }), cancelRef, user.uid).status).toBe('cancelled');
            const history = await executeCompanyInfoCommand(db, user, { mode: 'listHistory', companyId: 'taebaek' }) as import('./shared/companyInfoCommand').CompanyInfoHistoryResult;
            expect(history.entries).toHaveLength(2);
        }
    });
    it('claim없는 비문자직원과 다른회사 요청은 모든 모드에서 거절한다', async () => {
        const ref = reference(), req = await request(ref, { name: '불가' });
        for (const token of [{ companyId: 'taebaek' }, { companyId: 'taebaek', employeeId: 12 }, { companyId: 'punghoe', employeeId: 'e' }, { companyId: 'invalid', employeeId: 'e' }]) {
            for (const input of [{ mode: 'open', reference: ref, opening: companyInfoOpening((await target().get()).data()) }, { mode: 'apply', request: req }, { mode: 'inspect', reference: ref }, { mode: 'cancel', reference: ref }, { mode: 'listHistory', companyId: 'taebaek' }] as import('./shared/companyInfoCommand').CompanyInfoCommand[])
                await expect(executeCompanyInfoCommand(db, { uid: 'invalid', token }, input)).rejects.toMatchObject({ code: 'permission-denied' });
        }
    });
    it('같은 계획의 다른 원문은 최초 receipt를 덮지 않는다', async () => { const ref = reference(), req = await request(ref, { name: '최초' }); await apply(req); await expect(apply({ ...req, patch: { name: '다름' } })).rejects.toMatchObject({ code: 'already-exists' }); });
    it('회사 누락·다른회사 설정은 수정과 열기를 거절한다', async () => {
        for (const companyId of [undefined, null, 'punghoe']) {
            await target().set({ ...(companyId === undefined ? {} : { companyId }), name: '보존' });
            const ref = reference();
            await expect(opening(ref)).rejects.toMatchObject({ code: 'failed-precondition' });
            expect((await apply({ version: 1, reference: ref, expectedVersion: null, patch: { name: '변경' } })).status).toBe('rejected');
            expect((await target().get()).get('name')).toBe('보존');
        }
        await target().set({ companyId: 'taebaek', name: '복구' });
    });
    it('native 버전이 같은 두 계획은 하나만 적용된다', async () => { const a = reference(), b = reference(), ra = await request(a, { name: 'A' }), rb = await request(b, { name: 'B' }); expect((await Promise.all([apply(ra), apply(rb)])).map(r => r.status).sort()).toEqual(['applied', 'rejected']); }, 30000);
    it('실제 backend 두번째쓰기 실패는 설정과 receipt를 함께 롤백한다', async () => {
        const ref = reference(), req = await request(ref, { name: '롤백금지' }), before = (await target().get()).data();
        const store = new Proxy(db, { get(o, k) {
                if (k === 'runTransaction')
                    return (fn: (t: admin.firestore.Transaction) => unknown) => o.runTransaction(tx => fn(new Proxy(tx, { get(t, p) {
                            if (p === 'create')
                                return (r: admin.firestore.DocumentReference, d: Record<string, unknown>) => t.create(r, { ...d, padding: 'x'.repeat(1100000) });
                            const v = Reflect.get(t, p);
                            return typeof v === 'function' ? v.bind(t) : v;
                        } })) as Promise<never>);
                const v = Reflect.get(o, k);
                return typeof v === 'function' ? v.bind(o) : v;
            } });
        await expect(apply(req, store)).rejects.toBeDefined();
        expect((await target().get()).data()).toEqual(before);
        expect((await own('companyInfoOperations/' + companyInfoReceiptId(ref.companyId, actor.uid, ref.planId)).get()).exists).toBe(false);
    });
    it('명시 이력은 본인회사 UID만 50개씩 안정 페이지로 반환하고 비밀번호·원문은 없다', async () => {
        for (let i = 0; i < 51; i++)
            await run(reference(), 'cancel');
        const first = await executeCompanyInfoCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek' }) as import('./shared/companyInfoCommand').CompanyInfoHistoryResult;
        expect(first.entries).toHaveLength(50);
        expect(first.nextCursor).toBeTruthy();
        expect(JSON.stringify(first)).not.toContain('requestText');
        expect(JSON.stringify(first)).not.toContain('adminPassword');
        const next = await executeCompanyInfoCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek', cursor: first.nextCursor! }) as typeof first;
        expect(next.entries.length).toBeGreaterThan(0);
        const other = await executeCompanyInfoCommand(db, { ...actor, uid: 'other' }, { mode: 'listHistory', companyId: 'taebaek' }) as typeof first;
        expect(other.entries).toEqual([]);
    });
});
