/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDocFromServer, deleteDoc, type Firestore } from 'firebase/firestore';
const m = vi.hoisted(() => ({ db: undefined as any }));
vi.mock('../firebase', () => ({ get db() { return m.db; }, authReady: Promise.resolve(), auth: { currentUser: { uid: 'writer', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', employeeId: 'writer' } }) } } }));
import { applyDeliverySchedule, cancelDeliverySchedule, inspectDeliverySchedule, prepareDeliverySchedule, readDeliverySchedule } from './deliveryScheduleService';
describe.skipIf(process.env.DELIVERY_SCHEDULE_SDK !== 'true')('배송 일정 실제 로컬SDK 한거래', () => {
    let env: RulesTestEnvironment;
    const paths = new Set<string>(), projectId = 'demo-delivery-' + randomUUID().slice(0, 8), scope = { companyId: 'taebaek' as const, isCurrent: () => true };
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8182, rules: readFileSync('firestore.rules', 'utf8') } }); m.db = env.authenticatedContext('writer', { companyId: 'taebaek', employeeId: 'writer', isAdmin: false }).firestore(); }, 30000);
    afterAll(async () => { if (!env)
        return; await env.withSecurityRulesDisabled(async (c) => { for (const p of paths)
        await deleteDoc(doc(c.firestore(), p)); for (const p of paths)
        expect((await getDocFromServer(doc(c.firestore(), p))).exists()).toBe(false); }); await env.cleanup(); }, 30000);
    async function seed(path: string, value: any) { paths.add(path); await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), path), value)); }
    async function fixture() { const id = randomUUID(); const r = prepareDeliverySchedule({ companyId: 'taebaek', actorUid: 'writer', auditId: 'audit-' + id, orderId: 'order-' + id, previousDeliveryDate: '2026-10-22', previousStatus: 'DISPATCHED', previousTimeSlot: '오전', nextDeliveryDate: '2026-10-23T15:00:00.000Z', nextTimeSlot: '오후', changedBy: '합성', changedAt: '2026-10-22T00:00:00Z' }); paths.add('deliveryScheduleAudits/' + r.auditId); await seed('orders/' + r.orderId, { companyId: 'taebaek', status: 'DISPATCHED', deliveryDate: r.previousDeliveryDate, items: [], inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 4 }); await seed('settings/taebaek__deliveryOrdering', { companyId: 'taebaek', ordering: ['other'], timeSlots: { other: '오후' }, unknown: 7 }); return r; }
    const read = async (path: string) => (await getDocFromServer(doc(m.db, path))).data();
    it('현재Rules 일반직원이 날짜와slot·receipt를 원자저장/중복ACK/타설정보존', async () => { const r = await fixture(); expect(await applyDeliverySchedule(scope, r)).toEqual({ status: 'applied' }); expect(await applyDeliverySchedule(scope, r)).toEqual({ status: 'applied' }); expect(await inspectDeliverySchedule(scope, r)).toEqual({ status: 'applied' }); expect(await read('orders/' + r.orderId)).toMatchObject({ deliveryDate: r.nextDeliveryDate, inventoryWriteRevision: 4 }); expect(await read('settings/taebaek__deliveryOrdering')).toMatchObject({ ordering: ['other'], timeSlots: { other: '오후', [r.orderId]: '오후' }, unknown: 7 }); });
    it('두개의같은원문동시apply는하나의receipt와동일결과', async () => { const r = await fixture(); expect(await Promise.all([applyDeliverySchedule(scope, r), applyDeliverySchedule(scope, r)])).toEqual([{ status: 'applied' }, { status: 'applied' }]); });
    it('중단과apply경합은한쪽결과로수렴하고cancel승리시주문불변', async () => { const r = await fixture(); const results = await Promise.all([cancelDeliverySchedule(scope, r), applyDeliverySchedule(scope, r)]); expect(results[0]).toEqual(results[1]); const row = await read('orders/' + r.orderId); expect(row?.deliveryDate).toBe(results[0].status === 'applied' ? r.nextDeliveryDate : r.previousDeliveryDate); });
    it('CAS실패는주문설정감사추가쓰기0/명시중단뒤늦은apply0', async () => { const r = await fixture(); await seed('orders/' + r.orderId, { companyId: 'taebaek', status: 'DELIVERED', deliveryDate: r.previousDeliveryDate, items: [] }); await expect(applyDeliverySchedule(scope, r)).rejects.toThrow('변경'); expect((await getDocFromServer(doc(m.db, 'deliveryScheduleAudits', r.auditId))).exists()).toBe(false); expect(await cancelDeliverySchedule(scope, r)).toEqual({ status: 'cancelled' }); expect(await applyDeliverySchedule(scope, r)).toEqual({ status: 'cancelled' }); });
    it('다른회사SDK인증은읽기단계에서거절되어추가쓰기0', async () => { const r = await fixture(); const foreign = env.authenticatedContext('foreign', { companyId: 'punghoe', employeeId: 'foreign' }).firestore(); await expect(applyDeliverySchedule(scope, r, foreign as unknown as Firestore)).rejects.toThrow(); expect((await read('orders/' + r.orderId))?.deliveryDate).toBe(r.previousDeliveryDate); expect((await read('settings/taebaek__deliveryOrdering'))?.timeSlots).toEqual({ other: '오후' }); });
    it('명시현재자료서버조회는최신date/status/slot을주며타회사정보거절', async () => { const r = await fixture(); expect(await readDeliverySchedule(scope, r.orderId)).toEqual({ deliveryDate: r.previousDeliveryDate, status: 'DISPATCHED', timeSlot: '오전' }); await seed('orders/' + r.orderId, { companyId: 'punghoe', status: 'DISPATCHED', deliveryDate: r.previousDeliveryDate }); await expect(readDeliverySchedule(scope, r.orderId)).rejects.toThrow(); });
    it('자체프로젝트감사write만Rules고장주입하면실commit전체rollback', async () => {
        const rules = readFileSync('firestore.rules', 'utf8').replace("allow create, update: if !hasOwnRule(collection)", "allow create, update: if collection != 'deliveryScheduleAudits' && !hasOwnRule(collection)");
        const fault = await initializeTestEnvironment({ projectId: projectId + '-fault', firestore: { host: '127.0.0.1', port: 8182, rules } });
        const original = m.db;
        const r = prepareDeliverySchedule({ ...await fixture(), auditId: 'fault-audit' });
        const paths = ['orders/' + r.orderId, 'settings/taebaek__deliveryOrdering', 'deliveryScheduleAudits/' + r.auditId];
        try {
            await fault.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), paths[0]), { companyId: 'taebaek', status: 'DISPATCHED', deliveryDate: r.previousDeliveryDate, items: [], inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 4 }); await setDoc(doc(c.firestore(), paths[1]), { companyId: 'taebaek', ordering: ['other'], timeSlots: { other: '오후' } }); });
            m.db = fault.authenticatedContext('writer', { companyId: 'taebaek', employeeId: 'writer', isAdmin: false }).firestore();
            await expect(applyDeliverySchedule(scope, r)).rejects.toThrow();
            expect((await getDocFromServer(doc(m.db, paths[0]))).data()?.deliveryDate).toBe(r.previousDeliveryDate);
            expect((await getDocFromServer(doc(m.db, paths[1]))).data()?.timeSlots).toEqual({ other: '오후' });
            expect((await getDocFromServer(doc(m.db, paths[2]))).exists()).toBe(false);
        }
        finally {
            m.db = original;
            await fault.withSecurityRulesDisabled(async (c) => { for (const path of paths)
                await deleteDoc(doc(c.firestore(), path)); for (const path of paths)
                expect((await getDocFromServer(doc(c.firestore(), path))).exists()).toBe(false); });
            await fault.cleanup();
        }
    });
});
