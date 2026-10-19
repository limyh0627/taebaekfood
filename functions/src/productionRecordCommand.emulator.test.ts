import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { executeProductionRecordCommand, productionRecordReceiptId } from './productionRecordCommand';
import { productionRecordOpening, productionRecordSourceEvidence, normalizeProductionRecordOpenResult, normalizeProductionRecordResult, type ProductionRecordReference, type ProductionRecordRequest, type ProductionRecordBody, type ProductionRecordHistoryResult } from './shared/productionRecordCommand';
const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const actor = { uid: 'production-user', token: { employeeId: '', companyId: 'taebaek', isAdmin: false } };
let app: admin.app.App, db: admin.firestore.Firestore;
const paths = new Set<string>();
const own = (path: string) => { paths.add(path); return db.doc(path); };
const ref = (targetId = randomUUID()): ProductionRecordReference => {
    const reference = { companyId: 'taebaek' as const, planId: randomUUID(), targetId };
    own('productionRecordOperations/' + productionRecordReceiptId(reference, actor.uid));
    own('productionRecords/' + targetId);
    return reference;
};
const record = (): ProductionRecordBody => ({ date: '2026-10-20', itemId: '참기름', itemName: '참기름', finishedQty: 2.5, wipUsed: 0, cost: 0, createdAt: '2026-10-20T00:00:00Z', note: '원문' });
const target = (reference: ProductionRecordReference) => db.doc('productionRecords/' + reference.targetId);
const open = async (reference: ProductionRecordReference) => normalizeProductionRecordOpenResult(await executeProductionRecordCommand(db, actor, { mode: 'open', reference, opening: productionRecordOpening((await target(reference).get()).data()) }), reference, actor.uid);
const create = (reference = ref()): ProductionRecordRequest => ({ version: 1, reference, action: 'create', expectedVersion: null, record: record() });
const apply = async (request: ProductionRecordRequest, store = db) => normalizeProductionRecordResult(await executeProductionRecordCommand(store, actor, { mode: 'apply', request }), request.reference, actor.uid);
const inspect = async (reference: ProductionRecordReference, mode: 'inspect' | 'cancel' = 'inspect') => normalizeProductionRecordResult(await executeProductionRecordCommand(db, actor, { mode, reference }), reference, actor.uid);
const date = async (reference: ProductionRecordReference): Promise<ProductionRecordRequest> => ({ version: 1, reference, action: 'date', expectedVersion: (await open(reference)).expectedVersion, date: '2026-10-21' });
const seed = async (reference: ProductionRecordReference, extra = {}) => target(reference).set({ ...record(), companyId: 'taebaek', inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 4, ...extra });
async function sync() {
    const orderId = '주문-' + randomUUID(), reference = ref(`pr-${orderId}-참기름`);
    const order = own('orders/' + orderId);
    const raw = { companyId: 'taebaek', status: 'DELIVERED', partnerName: '거래처', items: [{ itemId: '참기름', qty: 2.5 }], deliveredAt: '2026-10-20', createdAt: '최초' };
    await order.set(raw);
    const source = { orderId, evidence: productionRecordSourceEvidence(raw) };
    const opened = normalizeProductionRecordOpenResult(await executeProductionRecordCommand(db, actor, { mode: 'open', reference, opening: null, source }), reference, actor.uid);
    const request: ProductionRecordRequest = { version: 1, reference, action: 'sync', expectedVersion: null, record: record(), source: opened.source! };
    return { request, order, raw };
}
describe.skipIf(!enabled)('수동 생산실적 실제 영수증 트랜잭션', () => {
    beforeAll(() => { const projectId = 'demo-production-' + randomUUID().slice(0, 8); app = admin.initializeApp({ projectId }, projectId); db = admin.firestore(app); });
    beforeEach(async () => { for (const path of paths)
        await db.doc(path).delete(); });
    afterAll(async () => {
        if (!app)
            return;
        for (const path of paths)
            await db.doc(path).delete();
        for (const name of ['productionRecords', 'productionRecordOperations', 'orders'])
            expect((await db.collection(name).get()).empty).toBe(true);
        await app.delete();
    });
    it('직원 claim과 한글 ID로 최초 수량·원가를 그대로 생성하고 revision을 부여한다', async () => {
        const request = create(ref('생산-참기름'));
        expect((await open(request.reference)).expectedVersion).toBeNull();
        expect((await apply(request)).status).toBe('applied');
        expect((await target(request.reference).get()).data()).toMatchObject({ ...record(), companyId: 'taebaek', inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 1 });
    });
    it('조회는 쓰지 않으며 응답 유실 재조회와 동일 요청 재송신은 삭제한 기록을 되살리지 않는다', async () => {
        const request = create();
        expect((await inspect(request.reference)).status).toBe('unknown');
        expect((await db.collection('productionRecordOperations').get()).empty).toBe(true);
        await apply(request);
        await target(request.reference).delete();
        expect((await inspect(request.reference)).status).toBe('applied');
        expect((await apply(request)).status).toBe('applied');
        expect((await target(request.reference).get()).exists).toBe(false);
    });
    it('미처리 중단은 늦은 생성 차단이고 완료 요청 중단은 역삭제하지 않는다', async () => {
        const request = create();
        expect((await inspect(request.reference, 'cancel')).status).toBe('cancelled');
        expect((await apply(request)).status).toBe('cancelled');
        expect((await target(request.reference).get()).exists).toBe(false);
        const done = create();
        await apply(done);
        expect((await inspect(done.reference, 'cancel')).status).toBe('applied');
        expect((await target(done.reference).get()).exists).toBe(true);
    });
    it('생성과 중단의 실제 경합은 하나의 영수증 결과로 수렴한다', async () => {
        const request = create();
        const outcomes = await Promise.all([apply(request), inspect(request.reference, 'cancel')]);
        expect(outcomes[0].status).toBe(outcomes[1].status);
        expect((await target(request.reference).get()).exists).toBe(outcomes[0].status === 'applied');
    });
    it('날짜만 patch하고 미지 필드·자동 생산 세대와 기존 수량을 보존한다', async () => {
        const reference = ref();
        await seed(reference, { hidden: { a: 1 }, orderId: 'o', generation: 2 });
        expect((await apply(await date(reference))).status).toBe('applied');
        expect((await target(reference).get()).data()).toMatchObject({ finishedQty: 2.5, hidden: { a: 1 }, generation: 2, orderId: 'o', inventoryWriteRevision: 5, date: '2026-10-21' });
    });
    it('선택 열기 뒤 미지필드 변경·삭제·같은 ID 재생성은 날짜·삭제 요청을 거절한다', async () => {
        for (const change of ['hidden', 'deleted', 'recreated']) {
            const reference = ref();
            await seed(reference);
            const request = await date(reference);
            if (change === 'hidden')
                await target(reference).update({ hidden: 1 });
            else {
                await target(reference).delete();
                if (change === 'recreated')
                    await seed(reference, { note: '새 원문' });
            }
            expect((await apply(request)).status).toBe('rejected');
        }
        const reference = ref();
        await seed(reference);
        const request: ProductionRecordRequest = { version: 1, reference, action: 'delete', expectedVersion: (await open(reference)).expectedVersion };
        await target(reference).update({ note: '다른 수정' });
        expect((await apply(request)).status).toBe('rejected');
        expect((await target(reference).get()).exists).toBe(true);
    });
    it('선택 원문이 이미 바뀌었으면 open 단계에서 거절한다', async () => {
        const reference = ref();
        await seed(reference);
        const opening = productionRecordOpening((await target(reference).get()).data());
        await target(reference).update({ finishedQty: 9 });
        await expect(executeProductionRecordCommand(db, actor, { mode: 'open', reference, opening })).rejects.toMatchObject({ code: 'failed-precondition' });
    });
    it('삭제와 날짜 수정의 경합은 native CAS 한쪽만 적용한다', async () => {
        const first = ref();
        await seed(first);
        const second = ref(first.targetId), version = (await open(first)).expectedVersion;
        const outcomes = await Promise.all([apply({ version: 1, reference: first, action: 'date', expectedVersion: version, date: '2026-10-22' }), apply({ version: 1, reference: second, action: 'delete', expectedVersion: version })]);
        expect(outcomes.map(row => row.status).sort()).toEqual(['applied', 'rejected']);
    });
    it('다른 회사와 명시 회사 없는 기록은 덮거나 삭제하지 않는다', async () => {
        for (const companyId of ['punghoe', null]) {
            const reference = ref();
            await target(reference).set({ ...record(), ...(companyId ? { companyId } : {}) });
            expect((await apply(create(reference))).status).toBe('rejected');
            await expect(open(reference)).rejects.toMatchObject({ code: 'failed-precondition' });
            expect((await target(reference).get()).get('finishedQty')).toBe(2.5);
        }
    });
    it('동기화 최초 주문 근거가 바뀌면 fresh native 버전으로 바꿔 포장하지 않는다', async () => {
        const { request, order } = await sync();
        await order.update({ items: [{ itemId: '참기름', qty: 99 }] });
        await expect(executeProductionRecordCommand(db, actor, { mode: 'open', reference: request.reference, opening: null, source: { orderId: request.action === 'sync' ? request.source.orderId : '', evidence: request.action === 'sync' ? request.source.evidence : null } })).rejects.toMatchObject({ code: 'failed-precondition' });
        expect((await apply(request)).status).toBe('rejected');
        expect((await target(request.reference).get()).exists).toBe(false);
    });
    it('동기화 open 뒤 미지필드 변경도 native 버전으로 거절하고 정상 원문은 계산 없이 저장한다', async () => {
        const stale = await sync();
        await stale.order.update({ hidden: 1 });
        expect((await apply(stale.request)).status).toBe('rejected');
        const fresh = await sync();
        expect((await apply(fresh.request)).status).toBe('applied');
        expect((await target(fresh.request.reference).get()).get('cost')).toBe(0);
        expect((await fresh.order.get()).get('productionRecordIndex')).toBeUndefined();
    });
    it('완료·생산기록 주문·index 존재 또는 타회사 source는 자동 차감·생성하지 않는다', async () => {
        for (const patch of [{ status: 'PENDING' }, { partnerName: '생산기록' }, { productionRecordIndex: null }, { companyId: 'punghoe' }]) {
            const { request, order } = await sync();
            await order.update(patch);
            expect((await apply(request)).status).toBe('rejected');
            expect((await target(request.reference).get()).exists).toBe(false);
        }
    });
    it('다른 본문의 같은 계획은 거절하며 이력은 자기 회사 UID 메타만 반환한다', async () => {
        const request = create();
        await apply(request);
        await expect(apply({ ...request, action: 'create', record: { ...record(), finishedQty: 8 } })).rejects.toMatchObject({ code: 'already-exists' });
        const history = await executeProductionRecordCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek' }) as ProductionRecordHistoryResult;
        expect(history.entries).toHaveLength(1);
        expect(JSON.stringify(history)).not.toContain('requestText');
        expect(JSON.stringify(history)).not.toContain('finishedQty');
        const other = await executeProductionRecordCommand(db, { ...actor, uid: 'other' }, { mode: 'listHistory', companyId: 'taebaek' }) as ProductionRecordHistoryResult;
        expect(other.entries).toEqual([]);
        await expect(executeProductionRecordCommand(db, actor, { mode: 'listHistory', companyId: 'punghoe' })).rejects.toMatchObject({ code: 'permission-denied' });
    });
    it('이력은 본인 scope에서 50개씩 읽고 마지막 스캔 cursor로 남은 기록을 이어 읽는다', async () => {
        for (let index = 0; index < 51; index++) await inspect(ref(), 'cancel');
        const first = await executeProductionRecordCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek' }) as ProductionRecordHistoryResult;
        expect(first.entries).toHaveLength(50);
        expect(first.nextCursor).toMatch(/^[a-f0-9]{64}$/);
        const next = await executeProductionRecordCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek', cursor: first.nextCursor! }) as ProductionRecordHistoryResult;
        expect(next.entries).toHaveLength(1); expect(next.nextCursor).toBeNull();
        expect(new Set([...first.entries, ...next.entries].map(row => row.result.reference.planId)).size).toBe(51);
    });
    it('실 backend commit 실패는 업무와 영수증 모두 rollback하고 정상 재시도는 한 번 적용한다', async () => {
        const request = create(), missing = own('productionRecords/missing-rollback');
        const failing = Object.create(db) as admin.firestore.Firestore;
        failing.runTransaction = ((callback: (tx: admin.firestore.Transaction) => Promise<unknown>) => db.runTransaction(async (tx) => {
            const result = await callback(tx);
            tx.update(missing, { impossible: true });
            return result;
        })) as typeof db.runTransaction;
        await expect(apply(request, failing)).rejects.toThrow();
        expect((await target(request.reference).get()).exists).toBe(false);
        expect((await db.doc('productionRecordOperations/' + productionRecordReceiptId(request.reference, actor.uid)).get()).exists).toBe(false);
        expect((await apply(request)).status).toBe('applied');
    });
});
