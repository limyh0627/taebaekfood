/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, type Item, type Order } from '../types';

const notice = vi.hoisted(() => vi.fn(async (_message: string, _title?: string) => {}));
vi.mock('../src/shared/components/appDialog', () => ({
  appNotice: notice,
  appConfirm: vi.fn(async () => true),
  appPrompt: vi.fn(async () => null),
}));

import OrdersList from './OrdersList';

const product = { id: 'p1', name: '참기름 박스', type: 'product', unit: '박스', stock: 2 } as Item;
const order = {
  id: 'o1', partnerId: 'partner-1', partnerName: '거래처', status: OrderStatus.DISPATCHED, source: '일반',
  createdAt: '2026-09-25T00:00:00+09:00', orderDate: '2026-09-25', deliveryDate: '2026-09-25',
  totalAmount: 0, email: '',
  items: [{ itemId: 'p1', name: '참기름 박스', quantity: 1, price: 0 }],
} as Order;

beforeEach(() => notice.mockClear());

describe('주문 출고 저장 실패', () => {
  it('확인 뒤 DB 재고 부족이 드러나면 이유를 공통 알림으로 보여 준다', async () => {
    const onUpdateStatus = vi.fn(async () => { throw new Error('참기름 박스 재고가 부족합니다. 현재 0, 차감 1'); });
    render(<OrdersList
      companyId="taebaek" title="주문" subtitle="" groupBy="status"
      allowedStatuses={[OrderStatus.DISPATCHED]} orders={[order]} partners={[]} items={[product]}
      onUpdateStatus={onUpdateStatus} onUpdateDeliveryDate={vi.fn()} onDeleteOrder={vi.fn()} onAddClick={vi.fn()}
    />);

    fireEvent.click(screen.getByTitle('눌러서 출고완료로'));
    fireEvent.click(screen.getByRole('button', { name: '출고완료' }));

    await waitFor(() => expect(notice).toHaveBeenCalledWith(
      '참기름 박스 재고가 부족합니다. 현재 0, 차감 1', '재고 부족',
    ));
    expect(onUpdateStatus).toHaveBeenCalledWith('o1', OrderStatus.SHIPPED);
  });
});
