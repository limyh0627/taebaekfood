import { it, expect, vi } from 'vitest';
import { OrderStatus, type Item, type Order, type ProductionRecord } from '../../../shared/types';
import { buildProductionRecord, planProductionRecordSync, addProductionRecord, updateProductionRecordDate, deleteProductionRecord, runProductionRecordSync, type ProductionRecordForm, type ProductionRecordPorts, type ProductionRecordSyncPlan } from './productionRecordEditor';

const product = (id: string, extra: Partial<Item> = {}): Item => ({ id, name: '제품-' + id, type: 'product', stock: 0, minStock: 0, unit: '개', image: '', ...extra });
const order = (id: string, extra: Partial<Order> = {}): Order => ({ id, partnerName: '거래처', items: [{ itemId: 'oil', name: '주문품목', quantity: 2.5, price: 10 }], totalAmount: 25, status: OrderStatus.DELIVERED, createdAt: '2026-10-19T00:00:00Z', deliveryDate: '2026-10-20', email: '', source: '일반', ...extra });
const form: ProductionRecordForm = { date: '2026-10-20', itemId: 'oil', finishedQty: '2.5', wipItemId: 'wip', wipUsed: '0', note: ' 기록 ' };
const identity = { id: 'pr-fixed', createdAt: '2026-10-20T00:00:00.000Z', currentUserName: '작성자' };
const context = { isCurrent: () => true };
const record = (id: string): ProductionRecord => ({ id, date: '2026-10-20', itemId: 'oil', itemName: '기름', finishedQty: 1, createdAt: identity.createdAt });
const plan = (): ProductionRecordSyncPlan => ({ records: [record('one'), record('two'), record('three')], deliveredOrderCount: 3 });

it('수동 생산 원문의 수량·원가 0·반제품 0과 작성 정보를 기존 변환 그대로 만든다', () => {
    const result = buildProductionRecord(form, [product('oil', { cost: 0 }), product('wip', { type: 'wip' })], identity);
    expect(result).toEqual({ id: 'pr-fixed', date: '2026-10-20', itemId: 'oil', itemName: '제품-oil', finishedQty: 2.5, wipItemId: 'wip', wipItemName: '제품-wip', wipUsed: 0, cost: 0, note: ' 기록 ', createdBy: '작성자', createdAt: identity.createdAt });
});
it('선택 부재는 필드를 발명하지 않고 기존 필수 두 입력 외 새 양수·날짜 정책을 추가하지 않는다', () => {
    const empty = { ...form, date: '', wipItemId: '', wipUsed: '', note: '', finishedQty: '-1' };
    expect(buildProductionRecord(empty, [], { id: 'p', createdAt: identity.createdAt })).toEqual({ id: 'p', date: '', itemId: 'oil', itemName: '', finishedQty: -1, createdAt: identity.createdAt });
    expect(buildProductionRecord({ ...empty, finishedQty: '0' }, [], identity).finishedQty).toBe(0);
    expect(() => buildProductionRecord({ ...form, itemId: '' }, [], identity)).toThrow('품목과 생산수량');
    expect(() => buildProductionRecord({ ...form, finishedQty: '' }, [], identity)).toThrow('품목과 생산수량');
});
it('동기화는 완료 주문·품목의 원래 순서와 원가·날짜·메모를 보존한다', () => {
    const result = planProductionRecordSync({ orders: [order('first', { deliveredAt: '2026-10-20T03:00:00Z', items: [{ itemId: 'oil', name: '원명', quantity: 2.5, price: 10 }, { itemId: 'missing', name: '옛명', quantity: 0, price: 0 }] }), order('next')], items: [product('oil', { cost: 17 })], records: [], now: () => new Date(identity.createdAt) });
    expect(result.records).toEqual([
        { id: 'pr-first-oil', date: '2026-10-20', itemId: 'oil', itemName: '제품-oil', finishedQty: 2.5, cost: 17, note: '주문 자동 연동 (거래처)', createdAt: identity.createdAt },
        { id: 'pr-first-missing', date: '2026-10-20', itemId: 'missing', itemName: '옛명', finishedQty: 0, note: '주문 자동 연동 (거래처)', createdAt: identity.createdAt },
        { id: 'pr-next-oil', date: '2026-10-19', itemId: 'oil', itemName: '제품-oil', finishedQty: 2.5, cost: 17, note: '주문 자동 연동 (거래처)', createdAt: identity.createdAt },
    ]);
});
it('기존 제외 종류·현재 세대 index·기록 ID·계획 내 중복·보호 ID는 동기화로 되살리지 않는다', () => {
    const values = [order('pending', { status: OrderStatus.PENDING }), order('manual', { partnerName: '생산기록' }), order('modern', { productionRecordIndex: {} }), order('old', { items: [{ itemId: 'oil', name: 'oil', quantity: 1, price: 0 }, { itemId: 'oil', name: '중복', quantity: 2, price: 0 }, { itemId: 'label', name: '라벨', quantity: 1, price: 0 }, { itemId: 'guarded', name: '미확정', quantity: 1, price: 0 }] })];
    const input = { orders: values, items: [product('label', { type: '라벨' })], records: [], excludedIds: new Set(['pr-old-guarded']), now: () => new Date(identity.createdAt) };
    expect(planProductionRecordSync(input).records.map(row => row.id)).toEqual(['pr-old-oil']);
    expect(planProductionRecordSync({ ...input, records: [record('pr-old-oil')] }).records).toEqual([]);
});
it('추가는 실제 Promise ACK를 기다리고 호출 전 원본을 고정한다', async () => {
    let finish!: () => void;
    const onAdd = vi.fn<NonNullable<ProductionRecordPorts['onAdd']>>(() => new Promise<void>(resolve => { finish = resolve; }));
    const original = record('one'), done = vi.fn();
    const task = addProductionRecord(original, { onAdd }, context).then(result => { done(result); return result; });
    original.finishedQty = 99;
    expect(onAdd.mock.calls[0][0].finishedQty).toBe(1);
    await Promise.resolve(); expect(done).not.toHaveBeenCalled();
    finish();
    expect(await task).toMatchObject({ status: 'saved', targetId: 'one', acknowledged: true });
});
it('거절 오류는 원인과 결과 미확정을 보존하고 같은 ID를 자동 재송신하지 않는다', async () => {
    const onAdd = vi.fn<NonNullable<ProductionRecordPorts['onAdd']>>().mockRejectedValue(Error('재고 writer 거절'));
    const result = await addProductionRecord(record('one'), { onAdd }, context);
    expect(result).toMatchObject({ status: 'unknown', acknowledged: false });
    expect(result.message).toContain('재고 writer 거절');
    expect(result.message).toContain('처리 결과를 확정하지 못했습니다');
    expect(onAdd).toHaveBeenCalledTimes(1);
});
it('미연결·사전 scope 교체는 쓰기 전 중단하고 void 반환은 성공 ACK가 아니다', async () => {
    expect(await addProductionRecord(record('one'), {}, context)).toMatchObject({ status: 'not-started', acknowledged: false });
    const onDelete = vi.fn<NonNullable<ProductionRecordPorts['onDelete']>>().mockResolvedValue(undefined);
    expect(await deleteProductionRecord('one', { onDelete }, { isCurrent: () => false })).toMatchObject({ status: 'not-started' });
    expect(onDelete).not.toHaveBeenCalled();
    const voidPort = { onDelete: () => undefined } as unknown as ProductionRecordPorts;
    expect(await deleteProductionRecord('one', voidPort, context)).toMatchObject({ status: 'unknown', acknowledged: false });
});
it('날짜 수정도 완료 응답 전 종료하지 않고 날짜 필드만 전달한다', async () => {
    let finish!: () => void;
    const onUpdate = vi.fn<NonNullable<ProductionRecordPorts['onUpdate']>>(() => new Promise<void>(resolve => { finish = resolve; }));
    const task = updateProductionRecordDate('one', '2026-11-03', { onUpdate }, context);
    expect(onUpdate).toHaveBeenCalledWith('one', { date: '2026-11-03' });
    finish(); expect((await task).status).toBe('saved');
    expect((await updateProductionRecordDate('one', '', { onUpdate }, context)).status).toBe('not-started');
    expect(onUpdate).toHaveBeenCalledTimes(1);
});
it('삭제의 늦은 ACK는 실제 응답 근거만 남기고 새 화면 성공으로 승격하지 않는다', async () => {
    let current = true, finish!: () => void;
    const onDelete = vi.fn<NonNullable<ProductionRecordPorts['onDelete']>>(() => new Promise<void>(resolve => { finish = resolve; }));
    const task = deleteProductionRecord('one', { onDelete }, { isCurrent: () => current });
    current = false; finish();
    expect(await task).toMatchObject({ status: 'stale', acknowledged: true, targetId: 'one' });
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('one');
});
it('동기화는 완료 prefix·실패 한 건·미송신 나머지를 분리하고 첫 오류 뒤 멈춘다', async () => {
    const onAdd = vi.fn<NonNullable<ProductionRecordPorts['onAdd']>>().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('둘째 응답 유실')).mockResolvedValueOnce(undefined);
    const result = await runProductionRecordSync(plan(), { onAdd }, context);
    expect(result).toMatchObject({ status: 'partial', confirmedIds: ['one'], failedId: 'two', remainingIds: ['three'] });
    expect(result.message).toContain('1건은 완료 응답');
    expect(result.message).toContain('둘째 응답 유실');
    expect(onAdd.mock.calls.map(([value]) => value.id)).toEqual(['one', 'two']);
});
it('첫 실패를 전체 실패로 단정하지 않으며 미연결 sync는 미송신 전체를 남긴다', async () => {
    const onAdd = vi.fn<NonNullable<ProductionRecordPorts['onAdd']>>().mockRejectedValue(Error('첫 응답 유실'));
    expect(await runProductionRecordSync(plan(), { onAdd }, context)).toMatchObject({ status: 'unknown', confirmedIds: [], failedId: 'one', remainingIds: ['two', 'three'] });
    expect(await runProductionRecordSync(plan(), {}, context)).toMatchObject({ status: 'not-started', confirmedIds: [], failedId: null, remainingIds: ['one', 'two', 'three'] });
});
it('동기화 중 scope 교체는 받은 ACK prefix를 보존하고 후속 기록을 보내지 않는다', async () => {
    let current = true;
    const onAdd = vi.fn<NonNullable<ProductionRecordPorts['onAdd']>>().mockImplementation(async () => { current = false; });
    expect(await runProductionRecordSync(plan(), { onAdd }, { isCurrent: () => current })).toMatchObject({ status: 'stale', confirmedIds: ['one'], failedId: null, remainingIds: ['two', 'three'] });
    expect(onAdd).toHaveBeenCalledTimes(1);
});
it('첫 호출 전 scope가 다르면 해당 첫 기록까지 미송신 나머지에 포함한다', async () => {
    const onAdd = vi.fn<NonNullable<ProductionRecordPorts['onAdd']>>();
    expect(await runProductionRecordSync(plan(), { onAdd }, { isCurrent: () => false })).toMatchObject({ status: 'not-started', confirmedIds: [], failedId: null, remainingIds: ['one', 'two', 'three'] });
    expect(onAdd).not.toHaveBeenCalled();
});
it('동기화 await 중 외부 계획 변경은 아직 보내지 않은 payload를 바꾸지 않는다', async () => {
    const original = plan(); let finish!: () => void;
    const onAdd = vi.fn<NonNullable<ProductionRecordPorts['onAdd']>>().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const task = runProductionRecordSync(original, { onAdd }, context);
    original.records[1].finishedQty = 90; original.records.splice(2);
    finish();
    expect(await task).toMatchObject({ status: 'saved', confirmedIds: ['one', 'two', 'three'] });
    expect(onAdd.mock.calls[1][0].finishedQty).toBe(1);
});
it('실제 ACK·미확정 ID 보호를 사용하면 stale props의 다음 계획이 같은 ID를 재생성하지 않는다', async () => {
    const orders = [order('o', { items: ['a', 'b', 'c'].map(itemId => ({ itemId, name: itemId, quantity: 1, price: 0 })) })];
    const first = planProductionRecordSync({ orders, items: [], records: [], now: () => new Date(identity.createdAt) });
    const onAdd = vi.fn<NonNullable<ProductionRecordPorts['onAdd']>>().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('미확정'));
    const result = await runProductionRecordSync(first, { onAdd }, context);
    const excludedIds = new Set([...result.confirmedIds, ...(result.failedId ? [result.failedId] : [])]);
    expect(planProductionRecordSync({ orders, items: [], records: [], excludedIds }).records.map(row => row.id)).toEqual(['pr-o-c']);
});
it('빈 동기화는 실제 기록을 쓰지 않고 기존 두 빈결과 안내를 구분한다', async () => {
    const onAdd = vi.fn<NonNullable<ProductionRecordPorts['onAdd']>>();
    expect((await runProductionRecordSync({ records: [], deliveredOrderCount: 0 }, { onAdd }, context)).message).toBe('이력에 완료된 주문이 없습니다.');
    expect((await runProductionRecordSync({ records: [], deliveredOrderCount: 1 }, { onAdd }, context)).message).toBe('동기화할 새 기록이 없습니다.');
    expect(onAdd).not.toHaveBeenCalled();
});
