import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { executePartnerEditCommand, partnerEditReceiptId } from './partnerEditCommand';
import { partnerEditOpening, normalizePartnerEditOpenResult, normalizePartnerEditResult, type PartnerEditReference, type PartnerEditRequest, type PartnerEditPatch, type PartnerEditHistoryResult } from './shared/partnerEditCommand';
const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const actor = { uid: 'partner-worker', token: { employeeId: '', companyId: 'taebaek', isAdmin: false } };
let app: admin.app.App, db: admin.firestore.Firestore;
const paths = new Set<string>();
const own = (path: string) => { paths.add(path); return db.doc(path); };
const ref = (targetId = '거래처-' + randomUUID()): PartnerEditReference => {
    const reference = { companyId: 'taebaek' as const, planId: randomUUID(), targetId };
    own('partnerEditOperations/' + partnerEditReceiptId(reference.companyId, actor.uid, reference.planId, targetId));
    own('partners/' + targetId);
    return reference;
};
const target = (reference: PartnerEditReference) => db.doc('partners/' + reference.targetId);
const seed = (reference: PartnerEditReference, extra = {}) => target(reference).set({ companyId: 'taebaek', name: '원상호', type: '일반', note: '기존', ...extra });
const open = async (reference: PartnerEditReference) => normalizePartnerEditOpenResult(await executePartnerEditCommand(db, actor, { mode: 'open', reference, opening: partnerEditOpening((await target(reference).get()).data()!) }), reference, actor.uid);
const request = async (reference: PartnerEditReference, patch: PartnerEditPatch = { note: '새메모' }): Promise<PartnerEditRequest> => ({ version: 1, reference, expectedVersion: (await open(reference)).expectedVersion, patch });
const apply = async (input: PartnerEditRequest, store = db) => normalizePartnerEditResult(await executePartnerEditCommand(store, actor, { mode: 'apply', request: input }), input.reference, actor.uid);
const inspect = async (reference: PartnerEditReference, mode: 'inspect' | 'cancel' = 'inspect') => normalizePartnerEditResult(await executePartnerEditCommand(db, actor, { mode, reference }), reference, actor.uid);
describe.skipIf(!enabled)('거래처 편집 실제 영수증 트랜잭션', () => {
    beforeAll(() => { const projectId = 'demo-partner-edit-' + randomUUID().slice(0, 8); app = admin.initializeApp({ projectId }, projectId); db = admin.firestore(app); });
    beforeEach(async () => { for (const path of paths)
        await db.doc(path).delete(); });
    afterAll(async () => {
        if (!app)
            return;
        for (const path of paths)
            await db.doc(path).delete();
        for (const name of ['partners', 'partnerEditOperations'])
            expect((await db.collection(name).get()).empty).toBe(true);
        await app.delete();
    });
    it('배송지 미소유 SDK Timestamp가 있어도 무관 메모 편집을 허용하고 원문 객체를 보존한다', async () => {
        const reference = ref(), stamp = admin.firestore.Timestamp.fromMillis(1234);
        await seed(reference, { shipTos: [{ id: '', name: null, internalUpdatedAt: stamp }] });
        await expect(open(reference)).resolves.toMatchObject({ reference });
        expect((await apply(await request(reference))).status).toBe('applied');
        expect((await target(reference).get()).get('note')).toBe('새메모');
        expect((await target(reference).get()).get('shipTos')).toEqual([{ id: '', name: null, internalUpdatedAt: stamp }]);
    });
    it('일반 직원 claim만으로 dirty 필드를 저장하고 모든 숨은 값과 명시 빈값을 보존한다', async () => {
        const reference = ref();
        await seed(reference, { region: '서울', isOemFactory: true, purchaseItems: [{ secret: 1 }], hidden: { keep: true } });
        const input = await request(reference, { name: ' ', mobile: '', phone: '', note: '' });
        expect((await apply(input)).status).toBe('applied');
        expect((await target(reference).get()).data()).toMatchObject({ name: ' ', mobile: '', phone: '', note: '', region: '서울', isOemFactory: true, purchaseItems: [{ secret: 1 }], hidden: { keep: true }, type: '일반' });
        expect((await db.doc('partnerEditOperations/' + partnerEditReceiptId(reference.companyId, actor.uid, reference.planId, reference.targetId)).get()).get('requestText')).not.toContain('purchaseItems');
    });
    it('최초 선택 공개원문·회사·보관상태가 다르면 fresh 버전으로 덮어 포장하지 않는다', async () => {
        const reference = ref();
        await seed(reference);
        const opening = partnerEditOpening((await target(reference).get()).data()!);
        await target(reference).update({ name: '다른상호' });
        await expect(executePartnerEditCommand(db, actor, { mode: 'open', reference, opening })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect((await db.collection('partnerEditOperations').get()).empty).toBe(true);
    });
    it('open 뒤 숨은 필드 변경·삭제·같은 ID 재생성은 모두 native CAS로 거절한다', async () => {
        for (const change of ['hidden', 'delete', 'recreate']) {
            const reference = ref();
            await seed(reference);
            const input = await request(reference);
            if (change === 'hidden')
                await target(reference).update({ hidden: 2 });
            else {
                await target(reference).delete();
                if (change === 'recreate')
                    await seed(reference, { name: '새문서' });
            }
            expect((await apply(input)).status).toBe('rejected');
            if (change !== 'delete')
                expect((await target(reference).get()).get('note')).toBe('기존');
        }
    });
    it('회사 없는·타회사·보관 거래처와 삭제 대상은 편집하지 않는다', async () => {
        for (const patch of [{ companyId: 'punghoe' }, { archived: true }, { companyId: null }]) {
            const reference = ref();
            await seed(reference, patch);
            await expect(open(reference)).rejects.toMatchObject({ code: 'failed-precondition' });
            expect((await apply({ version: 1, reference, expectedVersion: '1:000000001', patch: { note: '금지' } })).status).toBe('rejected');
            expect((await target(reference).get()).get('note')).toBe('기존');
        }
        const reference = ref();
        expect((await apply({ version: 1, reference, expectedVersion: '1:000000001', patch: { note: '금지' } })).status).toBe('rejected');
        expect((await target(reference).get()).exists).toBe(false);
    });
    it('배송지 순서·보관복원·이름·배송방식만 바꾸며 기존 ID와 미지 필드를 보존한다', async () => {
        const reference = ref();
        await seed(reference, { shipTos: [{ id: '옛/배송지', name: '하나', archived: true, defaultShipMethod: '배송', hidden: { token: 1 } }, { id: '__legacy__', name: '', defaultShipMethod: '옛방식', order: 17 }] });
        expect((await apply(await request(reference, { shipTos: [{ id: '__legacy__', name: '', defaultShipMethod: '옛방식' }, { id: '옛/배송지', name: '', archived: false, defaultShipMethod: '택배' }, { id: 'st-new', name: '새곳', defaultShipMethod: '화물' }] }))).status).toBe('applied');
        expect((await target(reference).get()).get('shipTos')).toEqual([{ id: '__legacy__', name: '', defaultShipMethod: '옛방식', order: 17 }, { id: '옛/배송지', name: '', archived: false, defaultShipMethod: '택배', hidden: { token: 1 } }, { id: 'st-new', name: '새곳', defaultShipMethod: '화물' }]);
    });
    it('기존 배송지 누락 삭제·중복ID·숨은행 수정은 업무를 쓰지 않고 거절한다', async () => {
        for (const shipTos of [[], [{ id: 'a', name: '하나' }, { id: 'a', name: '둘' }]]) {
            const reference = ref();
            await seed(reference, { shipTos: [{ id: 'a', name: '하나', hidden: 9 }] });
            expect((await apply(await request(reference, { shipTos }))).status).toBe('rejected');
            expect((await target(reference).get()).get('shipTos')).toEqual([{ id: 'a', name: '하나', hidden: 9 }]);
        }
        const reference = ref();
        await seed(reference, { shipTos: [{ id: 'a', name: '하나', hidden: 9 }] });
        const input = await request(reference);
        await expect(apply({ ...input, patch: { shipTos: [{ id: 'a', name: '하나', hidden: 2 }] } } as never)).rejects.toMatchObject({ code: 'invalid-argument' });
    });
    it('새 배송지는 기존 UI의 이름·배송방식 정책만 적용하고 금융 거래처는 배송방식 없이 추가 가능하다', async () => {
        for (const row of [{ id: 'st-a', name: '' }, { id: 'st-a', name: '새곳' }, { id: 'st-a', name: ' 공백 ', defaultShipMethod: '배송' }]) {
            const reference = ref();
            await seed(reference);
            expect((await apply(await request(reference, { shipTos: [row] }))).status).toBe('rejected');
        }
        const reference = ref();
        await seed(reference, { partnerType: '금융기관' });
        expect((await apply(await request(reference, { shipTos: [{ id: 'st-a', name: '지점' }] }))).status).toBe('applied');
    });
    it('변경 없는 옛 유형·배송방식은 정규화하지 않고 다른 dirty 필드는 저장한다', async () => {
        const reference = ref();
        await seed(reference, { type: '옛채널', partnerType: null, defaultShipMethod: '옛방식', shipTos: null });
        expect((await apply(await request(reference))).status).toBe('applied');
        expect((await target(reference).get()).data()).toMatchObject({ type: '옛채널', partnerType: null, defaultShipMethod: '옛방식', shipTos: null, note: '새메모' });
        const legacy = ref();
        await seed(legacy, { shipTos: [{ id: 'a', name: '가', archived: null, defaultShipMethod: { old: 1 } }, { id: 'b', name: '나' }] });
        expect((await apply(await request(legacy, { shipTos: [{ id: 'b', name: '나' }, { id: 'a', name: '가', archived: null, defaultShipMethod: { old: 1 } }] }))).status).toBe('applied');
        expect((await target(legacy).get()).get('shipTos')[1]).toEqual({ id: 'a', name: '가', archived: null, defaultShipMethod: { old: 1 } });
    });
    it('응답 유실 reference-only 조회와 동일 재시도는 후속 수정·삭제를 되돌리지 않는다', async () => {
        const reference = ref();
        await seed(reference);
        const input = await request(reference);
        await apply(input);
        await target(reference).delete();
        expect((await inspect(reference)).status).toBe('applied');
        expect((await apply(input)).status).toBe('applied');
        expect((await target(reference).get()).exists).toBe(false);
        await expect(apply({ ...input, patch: { note: '다른원문' } })).rejects.toMatchObject({ code: 'already-exists' });
    });
    it('미처리 중단은 같은 영수증으로 늦은 apply를 막고 완료 업무는 되돌리지 않는다', async () => {
        const reference = ref();
        await seed(reference);
        const input = await request(reference);
        expect((await inspect(reference, 'cancel')).status).toBe('cancelled');
        expect((await apply(input)).status).toBe('cancelled');
        expect((await target(reference).get()).get('note')).toBe('기존');
        const done = ref();
        await seed(done);
        await apply(await request(done));
        expect((await inspect(done, 'cancel')).status).toBe('applied');
        expect((await target(done).get()).get('note')).toBe('새메모');
    });
    it('중단과 apply 경합은 한 영수증으로 수렴하고 다른 plan 동시 편집은 CAS 한쪽만 성공한다', async () => {
        const reference = ref();
        await seed(reference);
        const input = await request(reference);
        const result = await Promise.all([apply(input), inspect(reference, 'cancel')]);
        expect(result[0].status).toBe(result[1].status);
        const first = ref();
        await seed(first);
        const second = ref(first.targetId);
        const a = await request(first, { note: '첫째' }), b = await request(second, { note: '둘째' });
        expect((await Promise.all([apply(a), apply(b)])).map(row => row.status).sort()).toEqual(['applied', 'rejected']);
    }, 30000);
    it('결과 없는 inspect는 업무·영수증 쓰기0이며 이력은 자기UID 회사 메타만 반환한다', async () => {
        const reference = ref();
        await seed(reference);
        expect((await inspect(reference)).status).toBe('unknown');
        expect((await db.collection('partnerEditOperations').get()).empty).toBe(true);
        await apply(await request(reference));
        const history = await executePartnerEditCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek' }) as PartnerEditHistoryResult;
        expect(history.entries).toHaveLength(1);
        expect(JSON.stringify(history)).not.toContain('requestText');
        expect(JSON.stringify(history)).not.toContain('patch');
        expect((await executePartnerEditCommand(db, { ...actor, uid: 'other' }, { mode: 'listHistory', companyId: 'taebaek' }) as PartnerEditHistoryResult).entries).toEqual([]);
    });
    it('이력 50개 다음 페이지가 자기 scope의 남은 한 건을 반환한다', async () => {
        for (let index = 0; index < 51; index++)
            await inspect(ref(), 'cancel');
        const first = await executePartnerEditCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek' }) as PartnerEditHistoryResult;
        expect(first.entries).toHaveLength(50);
        expect(first.nextCursor).toBeTruthy();
        const next = await executePartnerEditCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek', cursor: first.nextCursor! }) as PartnerEditHistoryResult;
        expect(next.entries).toHaveLength(1);
        expect(next.nextCursor).toBeNull();
    });
    it('실 backend commit 실패는 거래처 patch와 receipt 모두 rollback한다', async () => {
        const reference = ref();
        await seed(reference);
        const input = await request(reference), missing = own('partners/missing-rollback');
        const failing = Object.create(db) as admin.firestore.Firestore;
        failing.runTransaction = ((callback: (tx: admin.firestore.Transaction) => Promise<unknown>) => db.runTransaction(async (tx) => { const result = await callback(tx); tx.update(missing, { impossible: true }); return result; })) as typeof db.runTransaction;
        await expect(apply(input, failing)).rejects.toThrow();
        expect((await target(reference).get()).get('note')).toBe('기존');
        expect((await db.doc('partnerEditOperations/' + partnerEditReceiptId(reference.companyId, actor.uid, reference.planId, reference.targetId)).get()).exists).toBe(false);
        expect((await apply(input)).status).toBe('applied');
    });
});
