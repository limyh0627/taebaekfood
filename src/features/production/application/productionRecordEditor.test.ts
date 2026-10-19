import { it, expect, vi } from 'vitest';
import { OrderStatus, type Item, type Order, type ProductionRecord } from '../../../shared/types';
import { buildProductionRecord, planProductionRecordSync, type ProductionRecordForm } from './productionRecordEditor';
const product = (id: string, extra: Partial<Item> = {}): Item => ({ id, name: '제품-' + id, type: 'product', stock: 0, minStock: 0, unit: '개', image: '', ...extra });
const order = (id: string, extra: Partial<Order> = {}): Order => ({ id, partnerName: '거래처', items: [{ itemId: 'oil', name: '주문품목', quantity: 2.5, price: 10 }], totalAmount: 25, status: OrderStatus.DELIVERED, createdAt: '2026-10-19T00:00:00Z', deliveryDate: '2026-10-20', email: '', source: '일반', ...extra });
const form: ProductionRecordForm = { date: '2026-10-20', itemId: 'oil', finishedQty: '2.5', wipItemId: 'wip', wipUsed: '0', note: ' 기록 ' };
const identity = { id: 'pr-fixed', createdAt: '2026-10-20T00:00:00.000Z', currentUserName: '작성자' };
const record = (id: string): ProductionRecord => ({ id, date: '2026-10-20', itemId: 'oil', itemName: '기름', finishedQty: 1, createdAt: identity.createdAt });
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
it('생산 동기화 최초 source는 존재구분·품목 배열순서를 helper 그대로 고정한다', () => {
    const source = order('source', { items: [{ itemId: 'oil', name: '원문1', quantity: 1, price: 0 }, { itemId: 'other', name: '원문2', quantity: 2, price: 0 }] });
    const plan = planProductionRecordSync({ orders: [source], items: [], records: [] });
    const before = JSON.stringify(plan.sources);
    source.items.reverse();
    source.partnerName = '다른 거래처';
    expect(JSON.stringify(plan.sources)).toBe(before);
    expect(plan.sources?.['pr-source-oil'].orderId).toBe('source');
});
it('빈 동기화 계획은 완료주문없음과 새기록없음의 기존 구분을 보존한다', () => {
    expect(planProductionRecordSync({ orders: [], items: [], records: [] })).toMatchObject({ records: [], deliveredOrderCount: 0 });
    expect(planProductionRecordSync({ orders: [order('existing')], items: [], records: [record('pr-existing-oil')] })).toMatchObject({ records: [], deliveredOrderCount: 1 });
});
