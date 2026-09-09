/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AddOrderModal from './AddOrderModal';
import { OrderStatus, type Item, type Order, type Partner, type PartnerItem } from '../src/shared/types';

const items = [
  { id: 'oil', name: '생들기름 300ml', unit: '병', type: 'product', category: '들기름' },
  { id: 'gift', name: '선물세트', unit: '개', type: 'product', category: '선물세트' },
] as Item[];

const partners = [
  { id: 'partner-1', name: '가을식품', type: '일반' },
  { id: 'partner-2', name: '가을식품', type: '일반' },
] as Partner[];

const partnerItems = items.map((item, index) => ({
  id: `link-${index}`,
  itemId: item.id,
  partnerId: 'partner-1',
  Direction: 'out',
  price: 0,
})) as PartnerItem[];

const order = (
  id: string,
  status: OrderStatus,
  partnerId = 'partner-1',
  deliveryDate = '2026-09-14',
): Order => ({
  id,
  cardNo: `ORD-${id}`,
  partnerId,
  partnerName: '가을식품',
  items: [
    { itemId: 'oil', name: '옛 기름명', quantity: 5, price: 0 },
    { itemId: 'gift', name: '선물세트', quantity: 24, price: 0, isBoxUnit: true, boxQuantity: 2, unitsPerBox: 12 },
  ],
  totalAmount: 0,
  status,
  createdAt: '2026-09-09T09:00:00+09:00',
  deliveryDate,
  email: '',
  source: '일반',
});

describe('신규 주문 창의 거래처 진행 주문', () => {
  it('거래처 ID의 네 진행 상태만 품목 선택 위에 보여주고 N품목으로 펼친다', () => {
    render(
      <AddOrderModal
        items={items}
        orders={[
          order('260909-01', OrderStatus.PENDING, 'partner-1', '2026-09-11'),
          order('260909-02', OrderStatus.PROCESSING, 'partner-1', '2026-09-12'),
          order('260909-03', OrderStatus.DISPATCHED, 'partner-1', '2026-09-13'),
          order('260909-04', OrderStatus.SHIPPED, 'partner-1', '2026-09-14'),
          order('260909-05', OrderStatus.DELIVERED),
          order('260909-06', OrderStatus.ON_HOLD),
          order('260909-07', OrderStatus.PENDING, 'partner-2'),
        ]}
        partners={partners}
        partnerItems={partnerItems}
        palletStocks={[]}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /가을식품/ })[0]);

    const progress = screen.getByRole('region', { name: '현재 진행 주문' });
    expect(within(progress).getAllByTestId(/^active-client-order-/)).toHaveLength(4);
    for (const label of ['대기중', '작업중', '작업완료', '출고']) {
      expect(within(progress).getByLabelText(`상태 ${label}`)).toBeInTheDocument();
    }
    expect(within(progress).queryByText('ORD-260909-05')).not.toBeInTheDocument();
    expect(within(progress).queryByText('ORD-260909-06')).not.toBeInTheDocument();
    expect(within(progress).queryByText('ORD-260909-07')).not.toBeInTheDocument();

    const itemHeading = screen.getByText('주문 품목 선택');
    expect(progress.compareDocumentPosition(itemHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const firstOrder = within(progress).getByTestId('active-client-order-260909-01');
    expect(within(firstOrder).queryByText('생들기름 300ml')).not.toBeInTheDocument();
    fireEvent.click(within(firstOrder).getByRole('button', { name: 'ORD-260909-01 2품목 보기' }));
    expect(within(firstOrder).getByText('생들기름 300ml')).toBeInTheDocument();
    expect(within(firstOrder).getByText('5병')).toBeInTheDocument();
    expect(within(firstOrder).getByText('2박스 (24개)')).toBeInTheDocument();
  });
});
