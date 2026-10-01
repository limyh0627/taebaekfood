import { describe, expect, it } from 'vitest';
import { flowItemsChanged, pendingFlowQuantityPatch } from './pendingFlowQuantity';
import type { PurchaseOrder, ReturnRequest } from '../../shared/types';

const po = {
  id: 'po-1', companyId: 'taebaek', itemId: 'a', itemName: '참기름', quantity: 2,
  status: 'invoiced', linkedStatementId: 'stmt-1', createdAt: '2026-09-30T00:00:00Z',
} as PurchaseOrder;
const request = {
  id: 'ret-1', companyId: 'taebaek', partnerId: 'p', partnerName: '거래처', status: 'pending',
  linkedStatementId: 'stmt-1', createdAt: '2026-09-30T00:00:00Z', totalAmount: 100,
  items: [{ itemId: 'a', name: '참기름', quantity: 2, price: 50, reason: '기타', isResellable: true }],
} as ReturnRequest;

describe('입고·반품 대기 수량 수정', () => {
  it('전표가 연결돼도 발주 수량을 수정하고 전표는 건드리지 않는다', () => {
    expect(pendingFlowQuantityPatch('입고', po, [{ itemId: 'a', previousQuantity: 2, quantity: 3.5 }], 'taebaek')).toEqual({ quantity: 3.5 });
    expect(po.quantity).toBe(2);
    expect(po.linkedStatementId).toBe('stmt-1');
  });
  it('묶음 발주는 각 줄만 바꾸고 원본은 보존한다', () => {
    const multi = { ...po, items: [{ itemId: 'a', name: '참기름', quantity: 2 }, { itemId: 'b', name: '들기름', quantity: 4 }] } as PurchaseOrder;
    expect(pendingFlowQuantityPatch('입고', multi, [{ itemId: 'a', previousQuantity: 2, quantity: 5 }, { itemId: 'b', previousQuantity: 4, quantity: 6 }], 'taebaek')).toEqual({ items: [{ itemId: 'a', name: '참기름', quantity: 5 }, { itemId: 'b', name: '들기름', quantity: 6 }] });
    expect(multi.items?.[0].quantity).toBe(2);
  });
  it('반품 수량과 금액을 함께 맞추고 전표 연결은 유지한다', () => {
    expect(pendingFlowQuantityPatch('반품', request, [{ itemId: 'a', previousQuantity: 2, quantity: 3 }], 'taebaek')).toEqual({ items: [{ ...request.items[0], quantity: 3 }], totalAmount: 150 });
    expect(request.linkedStatementId).toBe('stmt-1');
  });
  it('완료·타회사·품목 구성 변경·무효 수량은 저장 전에 거절한다', () => {
    expect(() => pendingFlowQuantityPatch('입고', { ...po, status: 'received' }, [{ itemId: 'a', previousQuantity: 2, quantity: 3 }], 'taebaek')).toThrow('대기');
    expect(() => pendingFlowQuantityPatch('반품', request, [{ itemId: 'a', previousQuantity: 2, quantity: 3 }], 'punghoe')).toThrow('다른 회사');
    expect(() => pendingFlowQuantityPatch('반품', request, [{ itemId: 'a', previousQuantity: 2, quantity: 3 }, { itemId: 'b', previousQuantity: 4, quantity: 4 }], 'taebaek')).toThrow('품목이나 수량');
    expect(() => pendingFlowQuantityPatch('반품', request, [{ itemId: 'b', previousQuantity: 2, quantity: 3 }], 'taebaek')).toThrow('품목이나 수량');
    expect(() => pendingFlowQuantityPatch('입고', po, [{ itemId: 'a', previousQuantity: 2, quantity: 0 }], 'taebaek')).toThrow('0보다 큰');
    expect(() => pendingFlowQuantityPatch('입고', po, [{ itemId: 'a', previousQuantity: 3, quantity: 4 }], 'taebaek')).toThrow('품목이나 수량');
  });
  it('상세창을 연 뒤 구독 기록의 품목 순서가 바뀌면 기존 입력을 저장 대상으로 보지 않는다', () => {
    expect(flowItemsChanged(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(flowItemsChanged(['a', 'b'], ['a', 'b'])).toBe(false);
    const multi = { ...po, items: [{ itemId: 'b', name: '들기름', quantity: 4 }, { itemId: 'a', name: '참기름', quantity: 2 }] } as PurchaseOrder;
    expect(() => pendingFlowQuantityPatch('입고', multi, [{ itemId: 'a', previousQuantity: 2, quantity: 5 }, { itemId: 'b', previousQuantity: 4, quantity: 6 }], 'taebaek')).toThrow('품목이나 수량');
  });
});
