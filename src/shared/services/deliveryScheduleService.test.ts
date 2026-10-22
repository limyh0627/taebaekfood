import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: null as any, rows: new Map<string, any>(), writes: [] as string[], rejectCommit: false, lost: false, afterCommit: () => { }, beforeGet: async () => { }, claims: async () => ({ claims: { companyId: 'taebaek' } }) }));
vi.mock('../firebase', () => ({ auth: { get currentUser() { return m.user; } }, authReady: Promise.resolve(), db: {} }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, col: string, id: string) => col + '/' + id, getDocFromServer: async (path: string) => { await m.beforeGet(); return snap(path); }, runTransaction: (_db: unknown, fn: any) => transact(fn) }));
vi.mock('../inventoryWriterProtocol', async () => { const real = await import('../../../functions/src/shared/inventoryWriterProtocol'); return { ...real, captureInventoryWriterContext: async () => undefined, runInventoryWriterTransaction: (_db: unknown, _context: unknown, fn: any) => transact(fn), prepareCatalogOrderCommit: async (_db: unknown, _tx: unknown, _id: string, _before: unknown, patch: unknown) => patch }; });
import { applyDeliverySchedule, cancelDeliverySchedule, inspectDeliverySchedule, prepareDeliverySchedule, readDeliverySchedule } from './deliveryScheduleService';
function snap(path: string) { return { exists: () => m.rows.has(path), data: () => structuredClone(m.rows.get(path)) }; }
async function transact(fn: any) {
    const changes: Array<[
        string,
        any,
        boolean
    ]> = [];
    const result = await fn({ get: async (path: string) => { await m.beforeGet(); return snap(path); }, update: (path: string, data: any) => changes.push([path, data, true]), set: (path: string, data: any, options?: any) => changes.push([path, data, !!options?.merge]) });
    if (m.rejectCommit)
        throw Error('커밋 거절');
    for (const [path, data, merge] of changes) {
        const before = m.rows.get(path);
        m.rows.set(path, merge ? { ...before, ...data } : data);
        m.writes.push(path);
    }
    m.afterCommit();
    if (m.lost)
        throw Error('응답 유실');
    return result;
}
const scope = { companyId: 'taebaek' as const, isCurrent: () => true };
const request = () => prepareDeliverySchedule({ companyId: 'taebaek', actorUid: 'actor', auditId: 'audit', orderId: 'order', previousDeliveryDate: '2026-10-22', previousStatus: 'DISPATCHED', previousTimeSlot: '오전', nextDeliveryDate: '2026-10-23T15:00:00.000Z', nextTimeSlot: '오후', changedBy: '담당', changedAt: '2026-10-22T00:00:00Z' });
beforeEach(() => { m.rows.clear(); m.writes = []; m.rejectCommit = false; m.lost = false; m.afterCommit = () => { }; m.beforeGet = async () => { }; m.claims = async () => ({ claims: { companyId: 'taebaek' } }); m.user = { uid: 'actor', getIdTokenResult: () => m.claims() }; m.rows.set('orders/order', { companyId: 'taebaek', deliveryDate: '2026-10-22', status: 'DISPATCHED', items: [], inventoryWriterProtocolVersion: 1, inventoryWriteRevision: 4 }); m.rows.set('settings/taebaek__deliveryOrdering', { companyId: 'taebaek', ordering: ['other', 'order'], timeSlots: { other: '오후' }, extra: 7 }); });
it('날짜·해당시간대·완료기록을 한 커밋으로 저장하고 다른 순서와 재고revision을 보존한다', async () => { await expect(applyDeliverySchedule(scope, request())).resolves.toEqual({ status: 'applied' }); expect(m.writes).toHaveLength(3); expect(m.rows.get('settings/taebaek__deliveryOrdering')).toMatchObject({ ordering: ['other', 'order'], timeSlots: { other: '오후', order: '오후' }, extra: 7 }); expect(m.rows.get('orders/order')).toMatchObject({ inventoryWriteRevision: 4, deliveryDate: request().nextDeliveryDate }); });
it('커밋 거절은 날짜·설정·감사기록 모두 반영하지 않는다', async () => { const before = structuredClone(m.rows); m.rejectCommit = true; await expect(applyDeliverySchedule(scope, request())).rejects.toMatchObject({ outcome: 'unknown' }); expect(m.rows).toEqual(before); });
it('응답 유실 뒤 같은 원문은 receipt first로 재고·날짜를 다시 쓰지 않는다', async () => { const r = request(); m.lost = true; await expect(applyDeliverySchedule(scope, r)).rejects.toThrow('응답 유실'); m.lost = false; m.rows.delete('orders/order'); expect(await applyDeliverySchedule(scope, r)).toEqual({ status: 'applied' }); expect(m.writes).toHaveLength(3); });
it('동일audit 다른 원문과 손상기록은 추가쓰기 없이 거절한다', async () => { await applyDeliverySchedule(scope, request()); const n = m.writes.length; await expect(applyDeliverySchedule(scope, { ...request(), nextTimeSlot: '오전' })).rejects.toThrow('다른 요청'); m.rows.get('deliveryScheduleAudits/audit').outcome = 'FAILED'; await expect(inspectDeliverySchedule(scope, request())).rejects.toThrow('처리 기록'); expect(m.writes).toHaveLength(n); });
it.each(['deliveryDate', 'status', 'slot'])('처음 선택한 %s가 바뀌면 세문서 쓰기0', async (field) => {
    if (field === 'slot')
        m.rows.get('settings/taebaek__deliveryOrdering').timeSlots.order = '오후';
    else
        m.rows.get('orders/order')[field] = '변경';
    await expect(applyDeliverySchedule(scope, request())).rejects.toMatchObject({ outcome: 'not-started' });
    expect(m.writes).toHaveLength(0);
});
it('타회사와 잘못된claims는 쓰기0', async () => { m.rows.get('orders/order').companyId = 'punghoe'; await expect(applyDeliverySchedule(scope, request())).rejects.toThrow('현재 회사'); m.claims = async () => ({ claims: { companyId: 'punghoe' } }); await expect(applyDeliverySchedule(scope, request())).rejects.toThrow(); expect(m.writes).toHaveLength(0); });
it('실User교체 또는 owner변경은 await 뒤 송신0', async () => { m.beforeGet = async () => { m.user = { ...m.user }; }; await expect(applyDeliverySchedule(scope, request())).rejects.toThrow('로그인'); expect(m.writes).toHaveLength(0); await expect(applyDeliverySchedule({ ...scope, isCurrent: () => false }, request())).rejects.toThrow(); });
it('inspect는 실서버읽기만 하며 없는기록을 미처리완료로 승격하지 않는다', async () => { expect(await inspectDeliverySchedule(scope, request())).toEqual({ status: 'not-found' }); expect(m.writes).toHaveLength(0); });
it('중단확정은 자기audit만 쓰고 늦은apply를 봉쇄한다', async () => { const r = request(); expect(await cancelDeliverySchedule(scope, r)).toEqual({ status: 'cancelled' }); expect(await applyDeliverySchedule(scope, r)).toEqual({ status: 'cancelled' }); expect(await inspectDeliverySchedule(scope, r)).toEqual({ status: 'cancelled' }); expect(m.writes).toEqual(['deliveryScheduleAudits/audit']); });
it('이미완료면 중단이 기존완료를 되돌리지 않는다', async () => { const r = request(); await applyDeliverySchedule(scope, r); expect(await cancelDeliverySchedule(scope, r)).toEqual({ status: 'applied' }); expect(m.writes).toHaveLength(3); });
it('명시현재자료읽기는최신값만반환하고오류를부재로바꾸지않는다', async () => { expect(await readDeliverySchedule(scope, 'order')).toEqual({ deliveryDate: '2026-10-22', status: 'DISPATCHED', timeSlot: '오전' }); m.rows.delete('orders/order'); await expect(readDeliverySchedule(scope, 'order')).rejects.toThrow('확인'); });
it('이미보낸커밋뒤owner가바뀌면notstarted가아닌unknown이다', async () => { let current = true; m.afterCommit = () => { current = false; }; await expect(applyDeliverySchedule({ ...scope, isCurrent: () => current }, request())).rejects.toMatchObject({ outcome: 'unknown' }); expect(m.writes).toHaveLength(3); });
it.each([['permission-denied', '권한'], ['unauthenticated', '로그인'], ['unavailable', '연결'], ['deadline-exceeded', '대기 시간']])('조회 %s를 한국어 원인과 다음행동으로 표시하고 원오류를보존한다', async (code, label) => { const original = Object.assign(Error('raw SDK failure'), { code }); m.beforeGet = async () => { throw original; }; try {
    await inspectDeliverySchedule(scope, request());
    throw Error('expected rejection');
}
catch (error) {
    expect(error).toMatchObject({ message: expect.stringContaining(label), cause: original });
    expect((error as Error).message).not.toContain('raw SDK');
} expect(m.writes).toHaveLength(0); });
it('저장·중단·현재자료조회에도연결오류안내를공유한다', async () => { const original = Object.assign(Error('raw'), { code: 'unavailable' }); m.beforeGet = async () => { throw original; }; for (const task of [() => applyDeliverySchedule(scope, request()), () => cancelDeliverySchedule(scope, request()), () => readDeliverySchedule(scope, 'order')])
    await expect(task()).rejects.toMatchObject({ message: expect.stringContaining('연결'), cause: original }); });
