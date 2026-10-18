/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OrderStatus, type Order } from '../../../shared/types';
import type { SaveOutcome } from '../../../shared/saveOutcome';
import { useOrderEditApplication, type PendingOrderEdit } from './useOrderEditApplication';
import { useOrderEditorDraft } from './useOrderEditorDraft';
const order = (id = 'a'): Order => ({ id, companyId: 'taebaek', partnerName: '합성', items: [{ itemId: 'i', name: '품목', quantity: 20, price: 100, isBoxUnit: true, boxQuantity: 1 }], totalAmount: 2000, status: OrderStatus.PENDING, createdAt: '', deliveryDate: '2026-10-18T03:00:00Z', email: '', source: '일반', note: '원비고' });
function setup(save = vi.fn(async (): Promise<SaveOutcome> => ({ status: 'saved' }))) {
    let pending: PendingOrderEdit[] = [];
    const input = { orders: [order(), order('b')], scopeKey: 'taebaek:uid', embeddedListOnly: false };
    const before = vi.fn();
    const inspect = vi.fn(async (): Promise<SaveOutcome> => {
        pending = [];
        return { status: 'saved' };
    });
    const view = renderHook(props => {
        const application = useOrderEditApplication({ scopeKey: props.scopeKey, onSaveOrderEdit: save, onReadPendingOrderEdits: () => pending, onInspectOrderEdit: inspect });
        return { ...useOrderEditorDraft({ ...props, application, onBeforeOpen: before }), application };
    }, { initialProps: input });
    return { view, save, input, before, inspect, setPending: (entries: PendingOrderEdit[]) => pending = entries };
}
it('없는 주문과 embedded는 열지 않고 원품목을 복사하며 재열기 때 팔레트를 접는다', () => {
    const h = setup();
    act(() => h.view.result.current.openOrderEditor('absent'));
    expect(h.before).not.toHaveBeenCalled();
    h.view.rerender({ ...h.input, embeddedListOnly: true });
    act(() => h.view.result.current.openOrderEditor('a'));
    expect(h.view.result.current.listOrderEditor).toBeNull();
    h.view.rerender(h.input);
    act(() => h.view.result.current.openOrderEditor('a'));
    expect(h.view.result.current.listOrderEditor?.items[0]).not.toBe(h.input.orders[0].items[0]);
    act(() => {
        h.view.result.current.setShowEditorPallet(true);
        h.view.result.current.updateDraftItem(0, { price: 999 });
    });
    expect(h.input.orders[0].items[0].price).toBe(100);
    act(() => h.view.result.current.closeEditor());
    act(() => h.view.result.current.openOrderEditor('a'));
    expect(h.view.result.current.showEditorPallet).toBe(false);
});
it('최신 구독으로 바뀌어도 열 때 원문과 초안을 전송한다', async () => {
    const h = setup();
    act(() => h.view.result.current.openOrderEditor('a'));
    h.view.rerender({ ...h.input, orders: [{ ...h.input.orders[0], note: '다른 사람 저장', items: [{ ...h.input.orders[0].items[0], quantity: 40 }] }] });
    await act(async () => h.view.result.current.saveEditor());
    expect(h.save).toHaveBeenCalledExactlyOnceWith(h.input.orders[0], { kind: 'draft', draft: expect.objectContaining({ note: '원비고', items: h.input.orders[0].items }) });
});
it('ACK 전에 닫기와 중복저장을 막고 성공 뒤 같은 초안만 닫는다', async () => {
    let finish!: (v: SaveOutcome) => void;
    const save = vi.fn(() => new Promise<SaveOutcome>(resolve => finish = resolve)), h = setup(save);
    act(() => h.view.result.current.openOrderEditor('a'));
    act(() => {
        void h.view.result.current.saveEditor();
        void h.view.result.current.saveEditor();
    });
    act(() => h.view.result.current.closeEditor());
    expect(h.view.result.current.listOrderEditor?.orderId).toBe('a');
    expect(save).toHaveBeenCalledOnce();
    await act(async () => finish({ status: 'saved' }));
    expect(h.view.result.current.listOrderEditor).toBeNull();
});
it('미확정은 동일 주문 재저장을 막고 정확 plan 확인만 허용한다', async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => ({ status: 'unknown', message: '응답 미확인', nextAction: '결과를 확인하세요' })), h = setup(save);
    act(() => h.view.result.current.openOrderEditor('a'));
    h.setPending([{ id: 'a', planId: 'first-plan', description: '보관 수정' }]);
    await act(async () => h.view.result.current.saveEditor());
    expect(save).not.toHaveBeenCalled();
    expect(h.view.result.current.listOrderEditor?.note).toBe('원비고');
    expect(h.view.result.current.saveDisabled).toBe(true);
    await act(async () => h.view.result.current.application.inspect({ id: 'a', planId: 'first-plan', description: '보관 수정' }));
    expect(h.inspect).toHaveBeenCalledWith('first-plan', 'a');
    expect(h.view.result.current.saveDisabled).toBe(false);
    expect(h.view.result.current.listOrderEditor?.orderId).toBe('a');
    expect(h.view.result.current.saveError).toBe('');
    expect(h.view.result.current.application.message).toContain('이 주문 수정은 저장됐습니다.');
});
it('거절은 초안을 보존하고 UID 전환 뒤 늦은 ACK는 새 초안을 닫지 않는다', async () => {
    let finish!: (v: SaveOutcome) => void;
    const save = vi.fn().mockResolvedValueOnce({ status: 'rejected', message: '원문 변경' }).mockImplementationOnce(() => new Promise<SaveOutcome>(resolve => finish = resolve)), h = setup(save);
    act(() => h.view.result.current.openOrderEditor('a'));
    await act(async () => h.view.result.current.saveEditor());
    expect(h.view.result.current.listOrderEditor?.orderId).toBe('a');
    expect(h.view.result.current.application.message).toContain('원문 변경');
    act(() => {
        void h.view.result.current.saveEditor();
    });
    h.view.rerender({ ...h.input, scopeKey: 'taebaek:other-uid' });
    act(() => h.view.result.current.openOrderEditor('b'));
    await act(async () => finish({ status: 'saved' }));
    expect(h.view.result.current.listOrderEditor?.orderId).toBe('b');
});
it('박스수량 우선·날짜공란·빈품목 검증은 전송 전에 유지한다', () => {
    const h = setup();
    act(() => h.view.result.current.openOrderEditor('a'));
    act(() => h.view.result.current.updateDraftItem(0, { boxQuantity: 0, quantity: 20 }));
    expect(h.view.result.current.saveDisabled).toBe(true);
    act(() => h.view.result.current.updateDraftItem(0, { boxQuantity: 2, quantity: 0 }));
    expect(h.view.result.current.saveDisabled).toBe(false);
    act(() => h.view.result.current.setListOrderEditor(current => current && { ...current, deliveryDate: '' }));
    expect(h.view.result.current.saveDisabled).toBe(true);
    expect(h.save).not.toHaveBeenCalled();
});
