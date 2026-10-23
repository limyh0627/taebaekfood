import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: null as any, rows: new Map<string, any>(), writes: [] as string[], lost: false, reject: false, beforeGet: async () => { }, afterCommit: () => { }, value: null as any, error: null as any, unsub: vi.fn() }));
vi.mock('../firebase', () => ({ auth: { get currentUser() { return m.user; } }, authReady: Promise.resolve(), db: {} }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, col: string, id: string) => col + '/' + id, getDocFromServer: async (path: string) => { await m.beforeGet(); return snap(path); }, onSnapshot: (_ref: unknown, value: any, error: any) => { m.value = value; m.error = error; return m.unsub; }, runTransaction: (_db: unknown, fn: any) => transact(fn) }));
import { applyDeliverySettings, cancelDeliverySettings, inspectDeliverySettings, prepareDeliverySettings, readDeliverySettings, subscribeDeliverySettings, type DeliverySettingsChange } from './deliverySettingsService';
function snap(path: string) { return { exists: () => m.rows.has(path), data: () => structuredClone(m.rows.get(path)) }; }
function merge(a: any, b: any): any {
    const out = { ...a };
    for (const [key, value] of Object.entries(b))
        out[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(a?.[key], value) : structuredClone(value);
    return out;
}
async function transact(fn: any) {
    const pending: any[] = [];
    const result = await fn({ get: async (path: string) => { await m.beforeGet(); return snap(path); }, set: (path: string, value: any, options?: any) => pending.push([path, value, !!options?.merge]) });
    if (m.reject)
        throw Error('커밋 거절');
    for (const [path, value, nested] of pending) {
        m.rows.set(path, nested ? merge(m.rows.get(path), value) : structuredClone(value));
        m.writes.push(path);
    }
    m.afterCommit();
    if (m.lost)
        throw Error('응답 유실');
    return result;
}
const scope = { companyId: 'taebaek' as const, actorUid: 'actor', isCurrent: () => true };
const key = 'settings/taebaek__deliveryOrdering';
const ordering: DeliverySettingsChange = { type: 'day-ordering', date: '2026-10-23', nextOrdering: ['b', 'a'], usesLegacyOrdering: true };
const request = async (change: DeliverySettingsChange = ordering) => prepareDeliverySettings(scope, await readDeliverySettings(scope), change, { auditId: 'delivery-settings-test', changedAt: '2026-10-23T00:00:00Z', changedBy: '담당' });
beforeEach(() => { m.rows.clear(); m.writes = []; m.lost = false; m.reject = false; m.beforeGet = async () => { }; m.afterCommit = () => { }; m.unsub.mockClear(); m.user = { uid: 'actor', getIdTokenResult: async () => ({ claims: { companyId: 'taebaek', employeeId: 'actor' } }) }; m.rows.set(key, { companyId: 'taebaek', ordering: ['a', 'b'], orderingByDate: { '2026-10-22': ['past'] }, timeSlots: { a: '오전', b: '오후' }, groupsByDate: { '2026-10-22': [{ id: 'past', orderIds: ['past'] }] }, hidden: { keep: 7 } }); m.rows.set('orders/a', { companyId: 'taebaek', deliveryDate: '2026-10-23', inventoryWriteRevision: 4 }); });
it('일별 차례는 legacy를 쓰지 않고 다른 날짜와 숨은 필드를 보존한다', async () => { const r = await request(); await applyDeliverySettings(scope, r); expect(m.rows.get(key)).toMatchObject({ ordering: ['a', 'b'], orderingByDate: { '2026-10-22': ['past'], '2026-10-23': ['b', 'a'] }, hidden: { keep: 7 } }); expect(m.writes).toHaveLength(2); });
it('slot은 다른 주문 최신slot과 legacyordering을 덮지 않고 주문재고를 쓰지 않는다', async () => { const r = await request({ type: 'slot', orderId: 'a', nextSlot: '오후' }); m.rows.get(key).timeSlots.b = '오전'; m.rows.get(key).ordering = ['fresh']; await applyDeliverySettings(scope, r); expect(m.rows.get(key)).toMatchObject({ timeSlots: { a: '오후', b: '오전' }, ordering: ['fresh'] }); expect(m.rows.get('orders/a').inventoryWriteRevision).toBe(4); expect(m.writes.every(path => !path.startsWith('orders/'))).toBe(true); });
it('compound는 차례와 slot 및 감사 기록을 한 커밋으로 확정한다', async () => { const r = await request({ type: 'slot', orderId: 'a', nextSlot: '오후', ordering }); await applyDeliverySettings(scope, r); expect(m.rows.get(key)).toMatchObject({ timeSlots: { a: '오후' }, orderingByDate: { '2026-10-23': ['b', 'a'] } }); expect(m.rows.get('deliveryScheduleAudits/' + r.auditId)).toMatchObject({ kind: 'delivery-settings', outcome: 'COMPLETED', request: r }); });
it('compound 커밋 거절은 두 설정과 감사 기록을 모두 남기지 않는다', async () => { const r = await request({ type: 'slot', orderId: 'a', nextSlot: '오후', ordering }); const before = structuredClone(m.rows); m.reject = true; await expect(applyDeliverySettings(scope, r)).rejects.toMatchObject({ outcome: 'unknown' }); expect(m.rows).toEqual(before); });
it('차량groups는 그 날짜만 교체하고 다른 날짜/slot/순서를 보존한다', async () => { const r = await request({ type: 'day-groups', date: '2026-10-23', nextGroups: [{ id: 'g', name: '차량', orderIds: ['a', 'b'] }] }); await applyDeliverySettings(scope, r); expect(m.rows.get(key)).toMatchObject({ groupsByDate: { '2026-10-22': [{ id: 'past', orderIds: ['past'] }], '2026-10-23': [{ id: 'g', name: '차량', orderIds: ['a', 'b'] }] }, timeSlots: { b: '오후' }, ordering: ['a', 'b'] }); });
it.each(['legacy', 'date-presence', 'slot', 'groups'] as const)('%s 원문 변경은 추가쓰기 없이 CAS 거절한다', async (which) => {
    const change: DeliverySettingsChange = which === 'slot' ? { type: 'slot', orderId: 'a', nextSlot: '오후' } : which === 'groups' ? { type: 'day-groups', date: '2026-10-23', nextGroups: [] } : ordering;
    const r = await request(change);
    const row = m.rows.get(key);
    if (which === 'legacy')
        row.ordering = ['changed'];
    if (which === 'date-presence')
        row.orderingByDate['2026-10-23'] = [];
    if (which === 'slot')
        delete row.timeSlots.a;
    if (which === 'groups')
        row.groupsByDate['2026-10-23'] = [];
    await expect(applyDeliverySettings(scope, r)).rejects.toThrow('변경');
    expect(m.writes).toEqual([]);
});
it('없는slot과 명시 오전은 화면상 같아도 서로 다른 관측이다', async () => { delete m.rows.get(key).timeSlots.a; const r = await request({ type: 'slot', orderId: 'a', nextSlot: '오후' }); m.rows.get(key).timeSlots.a = '오전'; await expect(applyDeliverySettings(scope, r)).rejects.toThrow('변경'); });
it('응답 유실 뒤 같은 원문 재시도는 receipt first로 추가 설정쓰기0', async () => { const r = await request(); m.lost = true; await expect(applyDeliverySettings(scope, r)).rejects.toMatchObject({ outcome: 'unknown' }); m.lost = false; m.rows.delete(key); expect(await applyDeliverySettings(scope, r)).toEqual({ status: 'applied' }); expect(m.writes).toHaveLength(2); });
it('동일audit 다른 원문/옛schedule 기록은 완료로 추정하지 않는다', async () => { const r = await request(); await applyDeliverySettings(scope, r); await expect(inspectDeliverySettings(scope, { ...r, changedBy: '다른' })).rejects.toThrow('다른 요청'); delete m.rows.get('deliveryScheduleAudits/' + r.auditId).kind; await expect(inspectDeliverySettings(scope, r)).rejects.toThrow('원문'); });
it('조회 부재는 notfound이고 저장을 자동 실행하지 않는다', async () => { expect(await inspectDeliverySettings(scope, await request())).toEqual({ status: 'not-found' }); expect(m.writes).toEqual([]); });
it('중단은 audit만 쓰고 늦은apply는 cancelled로 추가쓰기0', async () => { const r = await request(); expect(await cancelDeliverySettings(scope, r)).toEqual({ status: 'cancelled' }); expect(await applyDeliverySettings(scope, r)).toEqual({ status: 'cancelled' }); expect(m.writes).toEqual(['deliveryScheduleAudits/' + r.auditId]); });
it('완료 뒤 중단은 완료를 되돌리지 않는다', async () => { const r = await request(); await applyDeliverySettings(scope, r); expect(await cancelDeliverySettings(scope, r)).toEqual({ status: 'applied' }); expect(m.writes).toHaveLength(2); });
it('원User 또는 회사claim 변경은 송신0', async () => { const r = await request(); m.user.getIdTokenResult = async () => { m.user = { ...m.user }; return { claims: { companyId: 'taebaek' } }; }; await expect(applyDeliverySettings(scope, r)).rejects.toThrow('계정'); expect(m.writes).toEqual([]); m.user.getIdTokenResult = async () => ({ claims: { companyId: 'punghoe' } }); await expect(applyDeliverySettings(scope, r)).rejects.toThrow('다른 회사'); });
it('ACK 뒤 owner 변경은 unknown이며 새UI 성공으로 승격하지 않는다', async () => { const r = await request(); let current = true; m.afterCommit = () => { current = false; }; await expect(applyDeliverySettings({ ...scope, isCurrent: () => current }, r)).rejects.toMatchObject({ outcome: 'unknown' }); });
it('타회사 또는 삭제 주문의 slot은 추가쓰기0', async () => { const r = await request({ type: 'slot', orderId: 'a', nextSlot: '오후' }); m.rows.get('orders/a').companyId = 'punghoe'; await expect(applyDeliverySettings(scope, r)).rejects.toThrow('주문'); expect(m.writes).toEqual([]); });
it('snapshot은 필드 부재와 빈배열을 구분하고 request는 깊게 고정한다', async () => { const state = await readDeliverySettings(scope); expect(Object.hasOwn(state.orderingByDate!, '2026-10-23')).toBe(false); const r = await request(); expect(Object.isFrozen(r.change)).toBe(true); expect(Object.isFrozen(r.before)).toBe(true); });
it('초기noauth 구독은 허용하되 회사UID 교체와 unsubscribe 뒤 결과를 폐기한다', () => { m.user = null; const values = vi.fn(), errors = vi.fn(); const stop = subscribeDeliverySettings({ ...scope, actorUid: '' }, values, errors); m.value(snap(key)); expect(values).toHaveBeenCalledTimes(1); m.user = { uid: 'new' }; m.value(snap(key)); expect(values).toHaveBeenCalledTimes(1); stop(); expect(m.unsub).toHaveBeenCalledTimes(1); });
it('구독 오류는 빈 성공으로 바꾸지 않고 권한 원인을 표시한다', () => { const values = vi.fn(), errors = vi.fn(); subscribeDeliverySettings(scope, values, errors); m.error(Object.assign(Error('raw'), { code: 'permission-denied' })); expect(values).not.toHaveBeenCalled(); expect(errors.mock.calls[0][0].message).toContain('권한'); });
it.each(['permission-denied', 'unavailable', 'deadline-exceeded', 'unauthenticated'])('%s 조회 오류는 한국어와 원인을 보존한다', async (code) => { const r = await request(); const original = Object.assign(Error('raw sdk'), { code }); m.beforeGet = async () => { throw original; }; await expect(inspectDeliverySettings(scope, r)).rejects.toMatchObject({ cause: original, message: expect.not.stringContaining('raw sdk') }); });
it('새 차례의 중복 ID는 저장 전 거절하되 과거 배열을 보정하지 않는다', async () => { m.rows.get(key).ordering = ['a', 'a']; await expect(request({ ...ordering, nextOrdering: ['a', 'a'] })).rejects.toThrow('원문'); const r = await request(); expect(r.before.find(row => row.path[0] === 'ordering')?.value).toEqual(['a', 'a']); expect(m.writes).toEqual([]); });
