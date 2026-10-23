/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocFromServer, deleteDoc, type Firestore } from 'firebase/firestore';
const m = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('../firebase', () => ({ get db() { return m.db; }, authReady: Promise.resolve(), auth: { currentUser: { uid: 'writer', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', employeeId: 'writer' } }) } } }));
import { applyDeliverySettings, cancelDeliverySettings, inspectDeliverySettings, prepareDeliverySettings, readDeliverySettings, type DeliverySettingsChange } from './deliverySettingsService';
import { applyDeliverySchedule, prepareDeliverySchedule } from './deliveryScheduleService';
describe.skipIf(process.env.DELIVERY_SETTINGS_SDK !== 'true')('배송 설정 실제 Firestore SDK·현 Rules', () => {
    let env: RulesTestEnvironment;
    const paths = new Set<string>(), projectId = 'demo-settings-' + randomUUID().slice(0, 8), scope = { companyId: 'taebaek' as const, actorUid: 'writer', isCurrent: () => true };
    const key = 'settings/taebaek__deliveryOrdering';
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8182, rules: readFileSync('firestore.rules', 'utf8') } }); m.db = env.authenticatedContext('writer', { companyId: 'taebaek', employeeId: 'writer', isAdmin: false }).firestore(); }, 30000);
    afterAll(async () => {
        if (!env)
            return;
        await env.withSecurityRulesDisabled(async (c) => {
            for (const p of paths)
                await deleteDoc(doc(c.firestore(), p));
            for (const p of paths)
                expect((await getDocFromServer(doc(c.firestore(), p))).exists()).toBe(false);
        });
        await env.cleanup();
    }, 30000);
    async function seed(path: string, value: any) { paths.add(path); await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), path), value)); }
    const read = async (path: string) => (await getDocFromServer(doc(m.db, path))).data();
    async function fixture(change: DeliverySettingsChange) {
        await seed(key, { companyId: 'taebaek', ordering: ['a', 'b'], orderingByDate: { '2026-10-22': ['past'] }, timeSlots: { a: '오전', b: '오후' }, groupsByDate: { '2026-10-22': [{ id: 'past', orderIds: ['past'] }] }, hidden: { keep: 7 } });
        await seed('orders/a', { companyId: 'taebaek', deliveryDate: '2026-10-23', status: 'DISPATCHED', items: [], inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 4 });
        const request = prepareDeliverySettings(scope, await readDeliverySettings(scope), change, { auditId: 'delivery-settings-' + randomUUID(), changedAt: '2026-10-23T00:00:00Z', changedBy: '담당' });
        paths.add('deliveryScheduleAudits/' + request.auditId);
        return request;
    }
    it('slot 실쓰기에서 다른 주문 최신slot과 legacy순서를 되돌리지 않는다', async () => {
        const r = await fixture({ type: 'slot', orderId: 'a', nextSlot: '오후' });
        await seed(key, { ...(await read(key)), ordering: ['fresh'], timeSlots: { a: '오전', b: '오전' } });
        if (process.env.DELIVERY_SETTINGS_REPRO === 'true')
            await setDoc(doc(m.db, key), { companyId: 'taebaek', ordering: ['a', 'b'], timeSlots: { a: '오후', b: '오후' } }, { merge: true });
        else
            await applyDeliverySettings(scope, r);
        expect((await read(key))?.timeSlots.b).toBe('오전');
        expect((await read(key))?.ordering).toEqual(['fresh']);
        expect((await read('orders/a'))?.inventoryWriteRevision).toBe(4);
    });
    it('신규 audit-write 고장주입은 compound 전체 rollback', async () => {
        const r = await fixture({ type: 'slot', orderId: 'a', nextSlot: '오후', ordering: { date: '2026-10-23', nextOrdering: ['b', 'a'], usesLegacyOrdering: true } });
        const rules = readFileSync('firestore.rules', 'utf8').replace("allow create, update: if !hasOwnRule(collection)", "allow create, update: if collection != 'deliveryScheduleAudits' && !hasOwnRule(collection)");
        const fault = await initializeTestEnvironment({ projectId: projectId + '-fault', firestore: { host: '127.0.0.1', port: 8182, rules } });
        const store = fault.authenticatedContext('writer', { companyId: 'taebaek', employeeId: 'writer' }).firestore();
        const auditPath = 'deliveryScheduleAudits/' + r.auditId;
        try {
            await fault.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), key), { companyId: 'taebaek', ordering: ['a', 'b'], timeSlots: { a: '오전' } }));
            await fault.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'orders/a'), { companyId: 'taebaek' }));
            await expect(applyDeliverySettings(scope, r, store as unknown as Firestore)).rejects.toThrow();
            expect((await getDocFromServer(doc(store, key))).data()?.orderingByDate).toBeUndefined();
            expect((await getDocFromServer(doc(store, key))).data()?.timeSlots.a).toBe('오전');
            expect((await getDocFromServer(doc(store, auditPath))).exists()).toBe(false);
        }
        finally {
            await fault.withSecurityRulesDisabled(async (c) => {
                for (const p of [key, 'orders/a', auditPath])
                    await deleteDoc(doc(c.firestore(), p));
                for (const p of [key, 'orders/a', auditPath])
                    expect((await getDocFromServer(doc(c.firestore(), p))).exists()).toBe(false);
            });
            await fault.cleanup();
        }
    });
    it('기존 순서→slot 두쓰기는 후행거절시 부분저장되며 새compound는 모두 rollback', async () => {
        const r = await fixture({ type: 'slot', orderId: 'a', nextSlot: '오후', ordering: { date: '2026-10-23', nextOrdering: ['b', 'a'], usesLegacyOrdering: true } });
        const rules = readFileSync('firestore.rules', 'utf8').replace("allow create, update: if !hasOwnRule(collection)", "allow create, update: if !(collection == 'settings' && request.resource.data.get('timeSlots', {}).get('a', '') == '오후') && !hasOwnRule(collection)");
        const fault = await initializeTestEnvironment({ projectId: projectId + '-split', firestore: { host: '127.0.0.1', port: 8182, rules } });
        const store = fault.authenticatedContext('writer', { companyId: 'taebaek', employeeId: 'writer' }).firestore();
        const auditPath = 'deliveryScheduleAudits/' + r.auditId;
        try {
            await fault.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), key), { companyId: 'taebaek', ordering: ['a', 'b'], timeSlots: { a: '오전', b: '오후' } }); await setDoc(doc(c.firestore(), 'orders/a'), { companyId: 'taebaek' }); });
            if (process.env.DELIVERY_SETTINGS_REPRO === 'true') {
                await setDoc(doc(store, key), { companyId: 'taebaek', orderingByDate: { '2026-10-23': ['b', 'a'] } }, { merge: true });
                await expect(setDoc(doc(store, key), { companyId: 'taebaek', ordering: ['a', 'b'], timeSlots: { a: '오후', b: '오후' } }, { merge: true })).rejects.toThrow();
            }
            else
                await expect(applyDeliverySettings(scope, r, store as unknown as Firestore)).rejects.toThrow();
            expect((await getDocFromServer(doc(store, key))).data()?.orderingByDate).toBeUndefined();
            expect((await getDocFromServer(doc(store, key))).data()?.timeSlots).toEqual({ a: '오전', b: '오후' });
            expect((await getDocFromServer(doc(store, auditPath))).exists()).toBe(false);
        }
        finally {
            await fault.withSecurityRulesDisabled(async (c) => {
                for (const p of [key, 'orders/a', auditPath])
                    await deleteDoc(doc(c.firestore(), p));
                for (const p of [key, 'orders/a', auditPath])
                    expect((await getDocFromServer(doc(c.firestore(), p))).exists()).toBe(false);
            });
            await fault.cleanup();
        }
    });
    it('일별차례와groups는 다른 날짜·미지필드를 보존한다', async () => { const r = await fixture({ type: 'day-ordering', date: '2026-10-23', nextOrdering: ['b', 'a'], usesLegacyOrdering: true }); expect(await applyDeliverySettings(scope, r)).toEqual({ status: 'applied' }); const g = prepareDeliverySettings(scope, await readDeliverySettings(scope), { type: 'day-groups', date: '2026-10-23', nextGroups: [{ id: 'g', name: '차량', orderIds: ['a'] }] }, { auditId: 'delivery-settings-' + randomUUID(), changedAt: r.changedAt, changedBy: r.changedBy }); paths.add('deliveryScheduleAudits/' + g.auditId); await applyDeliverySettings(scope, g); expect(await read(key)).toMatchObject({ hidden: { keep: 7 }, ordering: ['a', 'b'], orderingByDate: { '2026-10-22': ['past'], '2026-10-23': ['b', 'a'] }, groupsByDate: { '2026-10-22': [{ id: 'past', orderIds: ['past'] }], '2026-10-23': [{ id: 'g', name: '차량', orderIds: ['a'] }] } }); });
    it('legacy와fieldpresence CAS충돌은쓰기0·중단뒤늦은apply0', async () => { const r = await fixture({ type: 'day-ordering', date: '2026-10-23', nextOrdering: [], usesLegacyOrdering: true }); await setDoc(doc(m.db, key), { orderingByDate: { '2026-10-23': [] } }, { merge: true }); await expect(applyDeliverySettings(scope, r)).rejects.toThrow('변경'); expect(await cancelDeliverySettings(scope, r)).toEqual({ status: 'cancelled' }); expect(await applyDeliverySettings(scope, r)).toEqual({ status: 'cancelled' }); expect((await read(key))?.orderingByDate['2026-10-23']).toEqual([]); });
    it('receipt동일원문중복은설정삭제뒤에도추가설정생성0/다른원문거절', async () => { const r = await fixture({ type: 'slot', orderId: 'a', nextSlot: '오후' }); await applyDeliverySettings(scope, r); await env.withSecurityRulesDisabled(c => deleteDoc(doc(c.firestore(), key))); expect(await applyDeliverySettings(scope, r)).toEqual({ status: 'applied' }); expect((await getDocFromServer(doc(m.db, key))).exists()).toBe(false); await expect(inspectDeliverySettings(scope, { ...r, changedBy: '다른' })).rejects.toThrow('다른 요청'); });
    it('apply/cancel동시경합은같은audit에서한쪽결과로수렴한다', async () => { const r = await fixture({ type: 'slot', orderId: 'a', nextSlot: '오후' }); const [a, b] = await Promise.all([applyDeliverySettings(scope, r), cancelDeliverySettings(scope, r)]); expect(a).toEqual(b); expect((await read(key))?.timeSlots.a).toBe(a.status === 'applied' ? '오후' : '오전'); });
    it('다른회사Rules인증은거절/자기회사employee는새역할조건없이가능', async () => { const r = await fixture({ type: 'slot', orderId: 'a', nextSlot: '오후' }); const foreign = env.authenticatedContext('foreign', { companyId: 'punghoe', employeeId: 'foreign' }).firestore(); await expect(applyDeliverySettings(scope, r, foreign as unknown as Firestore)).rejects.toThrow(); expect((await read(key))?.timeSlots.a).toBe('오전'); expect(await applyDeliverySettings(scope, r)).toEqual({ status: 'applied' }); });
    it('기존 일정변경이 먼저 slot을 바꾸면 settings 요청은 원문CAS로 거절한다', async () => {
        const r = await fixture({ type: 'slot', orderId: 'a', nextSlot: '오후' });
        const auditId = 'schedule-race-' + randomUUID();
        paths.add('deliveryScheduleAudits/' + auditId);
        const schedule = prepareDeliverySchedule({ companyId: 'taebaek', actorUid: 'writer', auditId, orderId: 'a', previousDeliveryDate: '2026-10-23', previousStatus: 'DISPATCHED', previousTimeSlot: '오전', nextDeliveryDate: '2026-10-24', nextTimeSlot: '오후', changedAt: r.changedAt, changedBy: r.changedBy });
        expect(await applyDeliverySchedule(scope, schedule)).toEqual({ status: 'applied' });
        await expect(applyDeliverySettings(scope, r)).rejects.toThrow('변경');
        expect((await read(key))?.timeSlots.a).toBe('오후');
        expect((await read('orders/a'))?.deliveryDate).toBe('2026-10-24');
        expect((await read('orders/a'))?.inventoryWriteRevision).toBe(4);
        expect((await getDocFromServer(doc(m.db, 'deliveryScheduleAudits', r.auditId))).exists()).toBe(false);
    });
});
