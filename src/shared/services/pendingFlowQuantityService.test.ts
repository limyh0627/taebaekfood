import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePendingFlowQuantity } from './pendingFlowQuantityService';
const state = vi.hoisted(() => ({ record: undefined as Record<string, unknown> | undefined, reads: [] as unknown[], update: vi.fn() }));
vi.mock('../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  runTransaction: async (_db: unknown, callback: (tx: unknown) => Promise<void>) => callback({
    get: async (ref: unknown) => { state.reads.push(ref); return { exists: () => !!state.record, data: () => state.record }; },
    update: state.update,
  }),
}));
const updates = [{ itemId: 'a', previousQuantity: 2, quantity: 3.125 }];
const po = () => ({ companyId: 'taebaek', status: 'invoiced', items: [{ itemId: 'a', name: '기름', quantity: 2, unit: '병', price: 50 }], linkedStatementId: 'issued' });
const request = () => ({ companyId: 'punghoe', status: 'pending', items: [{ itemId: 'a', name: '기름', quantity: 2, price: 50 }], totalAmount: 100 });
beforeEach(() => { state.record = po(); state.reads = []; state.update.mockReset(); });
describe('대기 입고·반품 수량 공용 저장', () => {
  it('최신 입고 문서를 읽고 다른 필드와 연결 전표를 건드리지 않는다', async () => {
    const original = structuredClone(state.record);
    await updatePendingFlowQuantity('taebaek', '입고', 'po1', updates);
    expect(state.reads).toEqual([{ collection: 'purchaseOrders', id: 'po1' }]);
    expect(state.update).toHaveBeenCalledWith(state.reads[0], { items: [{ ...po().items[0], quantity: 3.125 }] });
    expect(state.record).toEqual(original);
  });
  it('옛 단일 품목 입고는 quantity만 저장한다', async () => {
    state.record = { status: 'invoiced', itemId: 'a', quantity: 2 };
    await updatePendingFlowQuantity('taebaek', '입고', 'legacy', updates);
    expect(state.update).toHaveBeenCalledWith({ collection: 'purchaseOrders', id: 'legacy' }, { quantity: 3.125 });
  });
  it('풍회 반품은 실제 가격으로 합계를 다시 계산한다', async () => {
    state.record = request();
    await updatePendingFlowQuantity('punghoe', '반품', 'r1', updates);
    expect(state.update).toHaveBeenCalledWith({ collection: 'returnRequests', id: 'r1' }, { items: [{ ...request().items[0], quantity: 3.125 }], totalAmount: 156.25 });
  });
  it.each(['입고', '반품'] as const)('%s 문서가 없으면 저장하지 않는다', async type => {
    state.record = undefined;
    await expect(updatePendingFlowQuantity('taebaek', type, 'missing', updates)).rejects.toThrow('찾을 수');
    expect(state.update).not.toHaveBeenCalled();
  });
  it.each(['입고', '반품'] as const)('%s 다른 회사 문서는 저장하지 않는다', async type => {
    state.record = type === '입고' ? { ...po(), companyId: 'punghoe' } : request();
    await expect(updatePendingFlowQuantity('taebaek', type, 'foreign', updates)).rejects.toThrow('다른 회사');
    expect(state.update).not.toHaveBeenCalled();
  });
  it.each(['입고', '반품'] as const)('%s 완료 상태나 바뀐 원본 수량은 거절한다', async type => {
    state.record = type === '입고' ? { ...po(), status: 'received' } : { ...request(), companyId: 'taebaek', status: 'processed' };
    await expect(updatePendingFlowQuantity('taebaek', type, 'done', updates)).rejects.toThrow('대기');
    state.record = type === '입고' ? po() : { ...request(), companyId: 'taebaek' };
    await expect(updatePendingFlowQuantity('taebaek', type, 'changed', [{ ...updates[0], previousQuantity: 1 }])).rejects.toThrow('품목이나 수량');
    expect(state.update).not.toHaveBeenCalled();
  });
  it.each([0, -1, NaN, Infinity, 1.2345])('잘못된 수량 %s는 거절한다', async quantity => {
    await expect(updatePendingFlowQuantity('taebaek', '입고', 'po1', [{ ...updates[0], quantity }])).rejects.toThrow('수량');
    expect(state.update).not.toHaveBeenCalled();
  });
});
