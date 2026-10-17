/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OrderStatus, type Order } from '../../../shared/types';
import { useOrderEditorDraft } from './useOrderEditorDraft';
const order = (id = 'a'): Order => ({ id, partnerName: '합성', items: [{ itemId: 'i', name: '품목', quantity: 20, price: 100, isBoxUnit: true, boxQuantity: 1 }], totalAmount: 2000, status: OrderStatus.PENDING, createdAt: '', deliveryDate: '2026-10-18T03:00:00Z', email: '', source: '일반', note: '원비고' });
const props = (orders = [order(), order('b')]) => ({ orders, embeddedListOnly: false, onBeforeOpen: vi.fn(), onUpdateDeliveryDate: vi.fn(), onUpdateItems: vi.fn(), onUpdateNote: vi.fn() });
it('없는 주문과 embedded는 열지 않고 원품목을 복사하며 재열기 때 팔레트를 접는다', () => {
 const p = props(), view = renderHook(input => useOrderEditorDraft(input), { initialProps: p }); act(() => view.result.current.openOrderEditor('absent')); expect(p.onBeforeOpen).not.toHaveBeenCalled();
 view.rerender({ ...p, embeddedListOnly: true }); act(() => view.result.current.openOrderEditor('a')); expect(view.result.current.listOrderEditor).toBeNull(); view.rerender(p);
 act(() => view.result.current.openOrderEditor('a')); expect(p.onBeforeOpen).toHaveBeenCalledOnce(); expect(view.result.current.listOrderEditor?.items[0]).toEqual(p.orders[0].items[0]); expect(view.result.current.listOrderEditor?.items[0]).not.toBe(p.orders[0].items[0]); expect(view.result.current.listOrderEditor?.deliveryDate).toBe('2026-10-18');
 act(() => { view.result.current.setShowEditorPallet(true); view.result.current.updateDraftItem(0, { price: 999 }); }); expect(p.orders[0].items[0].price).toBe(100); act(() => view.result.current.closeEditor()); act(() => view.result.current.openOrderEditor('a')); expect(view.result.current.showEditorPallet).toBe(false); expect(view.result.current.listOrderEditor?.items[0].price).toBe(100);
});
it('다른 주문으로 넘어간 뒤 옛 행 변경과 추가 콜백은 새 초안을 건드리지 않는다', () => {
 const view = renderHook(() => useOrderEditorDraft(props())); act(() => view.result.current.openOrderEditor('a')); const patch = view.result.current.updateDraftItem, add = view.result.current.addDraftItem;
 act(() => view.result.current.openOrderEditor('b')); act(() => { patch(0, { quantity: 99 }); add(); }); expect(view.result.current.listOrderEditor?.orderId).toBe('b'); expect(view.result.current.listOrderEditor?.items).toHaveLength(1); expect(view.result.current.listOrderEditor?.items[0].quantity).toBe(20);
});
it('박스 수량이 낱개보다 우선하며 0박스·날짜공란·품목없음은 저장하지 않는다', () => {
 const p = props(), view = renderHook(() => useOrderEditorDraft(p)); act(() => view.result.current.openOrderEditor('a')); act(() => view.result.current.updateDraftItem(0, { boxQuantity: 0, quantity: 20 })); expect(view.result.current.saveDisabled).toBe(true); act(() => view.result.current.saveEditor()); expect(p.onUpdateItems).not.toHaveBeenCalled();
 act(() => view.result.current.updateDraftItem(0, { boxQuantity: 2, quantity: 0 })); expect(view.result.current.saveDisabled).toBe(false);
 act(() => view.result.current.setListOrderEditor(current => current && { ...current, deliveryDate: '' })); expect(view.result.current.saveDisabled).toBe(true); act(() => view.result.current.saveEditor()); expect(p.onUpdateItems).not.toHaveBeenCalled();
 act(() => view.result.current.openOrderEditor('a')); act(() => view.result.current.updateDraftItem(0, { itemId: '' })); expect(view.result.current.saveDisabled).toBe(true); act(() => view.result.current.saveEditor()); expect(p.onUpdateItems).not.toHaveBeenCalled();
});
it('날짜→품목→변경 비고 순서로 호출하고 ACK를 기다리지 않고 즉시 닫는다', () => {
 const events: string[] = [], p = props(); p.onUpdateDeliveryDate.mockImplementation(() => { events.push('date'); }); p.onUpdateItems.mockImplementation(() => { events.push('items'); return new Promise<void>(() => {}); }); p.onUpdateNote.mockImplementation(() => { events.push('note'); });
 const view = renderHook(() => useOrderEditorDraft(p)); act(() => view.result.current.openOrderEditor('a')); act(() => view.result.current.setListOrderEditor(current => current && { ...current, deliveryDate: '2026-10-19', note: ' 새비고 ', noteImportant: true })); act(() => view.result.current.saveEditor());
 expect(events).toEqual(['date', 'items', 'note']); expect(p.onUpdateDeliveryDate).toHaveBeenCalledWith('a', new Date('2026-10-19').toISOString()); expect(p.onUpdateNote).toHaveBeenCalledWith('a', '새비고', true); expect(view.result.current.listOrderEditor).toBeNull();
});
it('변경하지 않은 날짜·비고는 전송하지 않고 현재 orders에서 수정 대상을 찾는다', () => {
 const p = props(), view = renderHook(input => useOrderEditorDraft(input), { initialProps: p }); act(() => view.result.current.openOrderEditor('a')); view.rerender({ ...p, orders: [{ ...p.orders[0], partnerName: '최신' }] }); expect(view.result.current.editorOrder?.partnerName).toBe('최신'); act(() => view.result.current.saveEditor()); expect(p.onUpdateItems).toHaveBeenCalledOnce(); expect(p.onUpdateNote).not.toHaveBeenCalled(); expect(p.onUpdateDeliveryDate).not.toHaveBeenCalled();
});
