import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { executeWorkOrderCommand, workOrderReceiptId, workOrderToday } from './workOrderCommand';
import { workOrderExpected, normalizeWorkOrderResult, normalizeWorkOrderOpening, type WorkOrderRequest, type WorkOrderReference, type WorkOrderItem, type WorkOrderHistoryResult } from './shared/workOrderCommand';

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8182';
const actor = { uid: 'work-user', token: { employeeId: '', companyId: 'taebaek', isAdmin: false } };
let app: admin.app.App, db: admin.firestore.Firestore;
const paths = new Set<string>();
const own = (path: string) => { paths.add(path); return db.doc(path); };
const ref = (): WorkOrderReference => {
    const reference = { companyId: 'taebaek' as const, planId: randomUUID() };
    own('workOrderOperations/' + workOrderReceiptId(reference.companyId, actor.uid, reference.planId));
    return reference;
};
const row = (id = 'a', sortIndex = 0): WorkOrderItem => ({ id, key: 'key-' + id, orderId: 'order', itemId: 'item', itemName: '품목', partnerName: '거래처', qty: 2, category: '기름', sortIndex });
const open = async (reference = ref()) => normalizeWorkOrderOpening(await executeWorkOrderCommand(db, actor, { mode: 'open', reference }), reference, actor.uid);
const request = async (items: WorkOrderItem[] = []): Promise<WorkOrderRequest> => { const opening = await open(); return { version: 1, reference: opening.reference, expected: workOrderExpected(opening), action: 'apply', items }; };
const apply = async (input: WorkOrderRequest, store = db) => normalizeWorkOrderResult(await executeWorkOrderCommand(store, actor, { mode: 'apply', request: input }), input.reference, actor.uid);
const resetRequest = async (): Promise<WorkOrderRequest> => { const opening = await open(); return { version: 1, reference: opening.reference, expected: workOrderExpected(opening), action: 'resetDaily', date: workOrderToday() }; };

describe.skipIf(!enabled)('작업순서 실제 단일 트랜잭션', () => {
    beforeAll(() => { const projectId = 'demo-work-order-' + randomUUID().slice(0, 8); app = admin.initializeApp({ projectId }, projectId); db = admin.firestore(app); });
    beforeEach(async () => {
        for (const path of paths) await db.doc(path).delete();
        own('workOrderFences/taebaek');
        own('settings/taebaek__workGroups');
        own('appMeta/workOrderReset_taebaek');
    });
    afterAll(async () => {
        if (!app) return;
        for (const path of paths) await db.doc(path).delete();
        for (const name of ['workOrderItems', 'workOrderOperations', 'workOrderFences', 'settings', 'appMeta']) expect((await db.collection(name).get()).empty).toBe(true);
        await app.delete();
    });
    it('직원 claim만으로 빈 목록과 합법적 설정 부재를 열고 그룹·항목·영수증을 함께 생성한다', async () => {
        const input = await request([row()]); own('workOrderItems/a');
        expect(input.expected.groups.exists).toBe(false);
        expect((await apply({ ...input, groups: ['기름', '깨', '미분류'] } as WorkOrderRequest)).status).toBe('applied');
        expect((await db.doc('workOrderItems/a').get()).get('companyId')).toBe('taebaek');
        expect((await db.doc('settings/taebaek__workGroups').get()).get('names')).toEqual(['기름', '깨', '미분류']);
        expect((await executeWorkOrderCommand(db, actor, { mode: 'inspect', reference: input.reference }) as { status: string }).status).toBe('applied');
    });
    it('기존 항목은 순서·묶음만 바꾸고 수량·미지필드와 그룹의 다른 필드를 보존한다', async () => {
        await own('workOrderItems/a').set({ ...row(), companyId: 'taebaek', qty: 99, custom: { v: 1 } });
        await own('settings/taebaek__workGroups').set({ companyId: 'taebaek', names: ['기름'], hidden: 7 });
        const input = await request([{ ...row(), groupId: 'g', groupName: '' }]);
        expect((await apply({ ...input, groups: ['새그룹'] } as WorkOrderRequest)).status).toBe('applied');
        expect((await db.doc('workOrderItems/a').get()).data()).toMatchObject({ qty: 99, custom: { v: 1 }, groupId: 'g', groupName: '' });
        expect((await db.doc('settings/taebaek__workGroups').get()).get('hidden')).toBe(7);
    });
    it('항목의 미지필드·그룹·reset native 변경은 옛 요청을 거절한다', async () => {
        for (const path of ['workOrderItems/a', 'settings/taebaek__workGroups', 'appMeta/workOrderReset_taebaek']) {
            if (path.endsWith('/a')) await own(path).set({ ...row(), companyId: 'taebaek' });
            else await own(path).set({ companyId: 'taebaek' });
            const input = await request([]);
            await own(path).update({ unknown: randomUUID() });
            expect((await apply(input)).status).toBe('rejected');
        }
        expect((await db.doc('workOrderItems/a').get()).exists).toBe(true);
    });
    it('빈 목록 확인 뒤 추가된 항목도 원문 집합 CAS로 삭제하지 않는다', async () => {
        const input = await request([]);
        await own('workOrderItems/a').set({ ...row(), companyId: 'taebaek' });
        expect((await apply(input)).status).toBe('rejected');
        expect((await db.doc('workOrderItems/a').get()).exists).toBe(true);
    });
    it('응답 유실 조회·동일 재송신은 후속 작업을 다시 바꾸지 않는다', async () => {
        own('workOrderItems/a'); const input = await request([row()]);
        expect((await apply(input)).status).toBe('applied');
        await db.doc('workOrderItems/a').update({ groupName: '후속' });
        expect((await apply(input)).status).toBe('applied');
        expect((await db.doc('workOrderItems/a').get()).get('groupName')).toBe('후속');
    });
    it('미처리 중단은 늦은 apply를 막고 완료 요청 중단은 항목을 되돌리지 않는다', async () => {
        own('workOrderItems/a'); const input = await request([row()]);
        expect((await executeWorkOrderCommand(db, actor, { mode: 'cancel', reference: input.reference }) as { status: string }).status).toBe('cancelled');
        expect((await apply(input)).status).toBe('cancelled');
        expect((await db.doc('workOrderItems/a').get()).exists).toBe(false);
        const done = await request([row()]); await apply(done);
        expect((await executeWorkOrderCommand(db, actor, { mode: 'cancel', reference: done.reference }) as { status: string }).status).toBe('applied');
        expect((await db.doc('workOrderItems/a').get()).exists).toBe(true);
    });
    it('초기화는 marker와 전체 삭제를 함께 확정하고 같은 날 추가한 항목은 다시 지우지 않는다', async () => {
        await own('workOrderItems/a').set({ ...row(), companyId: 'taebaek' });
        expect((await apply(await resetRequest())).status).toBe('applied');
        expect((await db.doc('workOrderItems/a').get()).exists).toBe(false);
        expect((await db.doc('appMeta/workOrderReset_taebaek').get()).get('date')).toBe(workOrderToday());
        await own('workOrderItems/b').set({ ...row('b'), companyId: 'taebaek' });
        expect((await apply(await resetRequest())).status).toBe('applied');
        expect((await db.doc('workOrderItems/b').get()).exists).toBe(true);
    });
    it('같은 날의 패딩 날짜 marker를 다른 날로 보지 않고 회사 없는 marker는 허용하지 않는다', async () => {
        const padded = workOrderToday().split('-').map((part, index) => index ? part.padStart(2, '0') : part).join('-');
        await own('appMeta/workOrderReset_taebaek').set({ companyId: 'taebaek', date: padded });
        await own('workOrderItems/a').set({ ...row(), companyId: 'taebaek' });
        await apply(await resetRequest());
        expect((await db.doc('workOrderItems/a').get()).exists).toBe(true);
        await db.doc('appMeta/workOrderReset_taebaek').set({ date: padded });
        await expect(open()).rejects.toMatchObject({ code: 'failed-precondition' });
    });
    it('동시 저장과 초기화는 한쪽만 원문 CAS를 통과해 새 항목을 조용히 잃지 않는다', async () => {
        own('workOrderItems/a'); const save = await request([row()]), reset = await resetRequest();
        const outcomes = await Promise.all([apply(save), apply(reset)]);
        expect(outcomes.map(value => value.status).sort()).toEqual(['applied', 'rejected']);
        if (outcomes[0].status === 'applied') expect((await db.doc('workOrderItems/a').get()).exists).toBe(true);
    });
    it('두 번째 쓰기의 실제 backend commit 실패는 그룹·항목·영수증을 모두 롤백한다', async () => {
        own('workOrderItems/a'); const input = await request([row()]);
        const missing = own('workOrderItems/not-exists');
        const failing = new Proxy(db, { get(target, property) {
            if (property === 'runTransaction') return (callback: (tx: admin.firestore.Transaction) => Promise<unknown>) => target.runTransaction(tx => callback(new Proxy(tx, { get(transaction, name) {
                if (name === 'create') return (targetRef: admin.firestore.DocumentReference, data: object) => { transaction.create(targetRef, data); if (targetRef.path.startsWith('workOrderOperations/')) transaction.update(missing, { injected: true }); return transaction; };
                const value = Reflect.get(transaction, name); return typeof value === 'function' ? value.bind(transaction) : value;
            } })));
            const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
        } });
        await expect(apply({ ...input, groups: ['실패그룹'] } as WorkOrderRequest, failing)).rejects.toMatchObject({ code: 5 });
        expect((await db.doc('workOrderItems/a').get()).exists).toBe(false);
        expect((await db.doc('settings/taebaek__workGroups').get()).exists).toBe(false);
        expect((await db.doc('workOrderOperations/' + workOrderReceiptId('taebaek', actor.uid, input.reference.planId)).get()).exists).toBe(false);
        expect((await apply(input)).status).toBe('applied');
    });
    it('한도를 넘는 전체 변경은 부분 분할 없이 거절하고 기존 목록을 유지한다', async () => {
        const values = Array.from({ length: 499 }, (_, index) => row('new-' + index, index));
        values.forEach(value => own('workOrderItems/' + value.id));
        expect((await apply(await request(values))).status).toBe('rejected');
        expect((await db.collection('workOrderItems').get()).empty).toBe(true);
    });
    it('다른 회사 ID를 새 항목으로 덮지 않고 다른 UID 이력을 노출하지 않는다', async () => {
        await own('workOrderItems/a').set({ ...row(), companyId: 'punghoe' });
        expect((await apply(await request([row()]))).status).toBe('rejected');
        const reference = ref(); own('workOrderOperations/' + workOrderReceiptId('taebaek', 'other', reference.planId));
        await executeWorkOrderCommand(db, { ...actor, uid: 'other' }, { mode: 'cancel', reference });
        const history = await executeWorkOrderCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek' }) as WorkOrderHistoryResult;
        expect(history.entries.every(entry => entry.result.actorUid === actor.uid)).toBe(true);
        expect(history.entries.some(entry => entry.result.reference.planId === reference.planId)).toBe(false);
    });
    it('이력은 본인 scope 50개 페이지이며 다른 회사·UID로 넘어가지 않는다', async () => {
        for (let index = 0; index < 51; index++) {
            const reference = ref();
            await executeWorkOrderCommand(db, actor, { mode: 'cancel', reference });
        }
        const first = await executeWorkOrderCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek' }) as WorkOrderHistoryResult;
        expect(first.entries).toHaveLength(50);
        expect(first.nextCursor).not.toBeNull();
        const second = await executeWorkOrderCommand(db, actor, { mode: 'listHistory', companyId: 'taebaek', cursor: first.nextCursor! }) as WorkOrderHistoryResult;
        expect(second.entries).toHaveLength(1);
        expect(second.nextCursor).toBeNull();
        expect(new Set([...first.entries, ...second.entries].map(entry => entry.result.reference.planId)).size).toBe(51);
        await expect(executeWorkOrderCommand(db, actor, { mode: 'listHistory', companyId: 'punghoe' })).rejects.toMatchObject({ code: 'permission-denied' });
        const foreign = await executeWorkOrderCommand(db, { ...actor, uid: 'other' }, { mode: 'listHistory', companyId: 'taebaek' }) as WorkOrderHistoryResult;
        expect(foreign.entries).toEqual([]);
    });
    it('미래 날짜 초기화는 항목·marker 변경 없이 거절하고 최초 receipt 원문을 재사용한다', async () => {
        await own('workOrderItems/a').set({ ...row(), companyId: 'taebaek' });
        const input = { ...await resetRequest(), date: '2099-1-1' } as WorkOrderRequest;
        expect((await apply(input)).status).toBe('rejected');
        expect((await db.doc('workOrderItems/a').get()).exists).toBe(true);
        expect((await db.doc('appMeta/workOrderReset_taebaek').get()).exists).toBe(false);
        expect((await apply(input)).status).toBe('rejected');
        await expect(apply({ ...input, date: workOrderToday() } as WorkOrderRequest)).rejects.toMatchObject({ code: 'already-exists' });
    });
    it('다음 날의 동일 초기화 재시도는 최초 receipt부터 반환하고 미처리 옛 날짜는 거절한다', async () => {
        const input = await resetRequest(), oldUnsent = await resetRequest();
        expect((await apply(input)).status).toBe('applied');
        await own('workOrderItems/a').set({ ...row(), companyId: 'taebaek' });
        const now = Date.now();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(now + 24 * 60 * 60 * 1000);
        try {
            expect((await apply(input)).status).toBe('applied');
            // 옛 요청은 현재 집합에 맞춰 자동 재작성하지 않는다.
            expect((await apply(oldUnsent)).status).toBe('rejected');
            expect((await db.doc('workOrderItems/a').get()).exists).toBe(true);
        } finally { vi.useRealTimers(); }
    });
});
