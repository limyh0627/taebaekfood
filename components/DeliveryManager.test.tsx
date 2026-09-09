/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DeliveryManager from './DeliveryManager';
import { today } from '../src/shared/day';
import { OrderStatus, type Item, type Order, type Partner } from '../src/shared/types';

vi.mock('../src/shared/services/firebaseService', () => ({
  subscribeToDocument: vi.fn(() => () => undefined),
  setDocument: vi.fn(),
}));

const partners = [
  { id: 'p1', name: '현재 거래처 1' },
  { id: 'p2', name: '현재 거래처 2' },
  { id: 'old', name: '예전 거래처' },
] as Partner[];

const items = [{
  id: 'oil', name: '참기름/병/분/전통/350ml', spec: '350ml', unit: '병',
  type: 'product', category: '참기름', stock: 0, minStock: 0, image: '',
}] as Item[];

const 주문 = (id: string, partnerId: string, status: OrderStatus): Order => ({
  id,
  cardNo: `ORD-${id}`,
  partnerId,
  partnerName: partners.find(p => p.id === partnerId)?.name ?? '',
  items: [{ itemId: 'oil', name: '옛 품목명', quantity: 50, price: 0 }],
  totalAmount: 0,
  status,
  createdAt: `${today()}T09:00:00+09:00`,
  deliveryDate: today(),
  email: '',
  source: '일반',
});

describe('주간 배송 캘린더', () => {
  it('예전 주문 건수를 누르면 목록이 열리고 현재 건수가 옆에 보인다', () => {
    render(
      <DeliveryManager
        orders={[
          주문('260909-01', 'p1', OrderStatus.PROCESSING),
          주문('260909-02', 'p2', OrderStatus.DISPATCHED),
          주문('260908-01', 'old', OrderStatus.DELIVERED),
        ]}
        partners={partners}
        items={items}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '배송캘린더' }));
    const oldCount = screen.getByRole('button', { name: '1건' });
    expect(oldCount.parentElement).toHaveTextContent('2건');
    expect(screen.queryByText('예전 거래처')).not.toBeInTheDocument();

    fireEvent.click(oldCount);
    expect(screen.getByText('예전 거래처')).toBeInTheDocument();
    expect(screen.getByText('ORD-260908-01')).toBeInTheDocument();
  });

  it('주문번호를 누르면 배송일 창에 품목 규격과 수량 단위가 나온다', () => {
    render(
      <DeliveryManager
        orders={[주문('260909-01', 'p1', OrderStatus.PROCESSING)]}
        partners={partners}
        items={items}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '배송캘린더' }));
    fireEvent.click(screen.getByRole('button', { name: 'ORD-260909-01' }));

    expect(screen.getByText('새 배송 날짜')).toBeInTheDocument();
    expect(screen.getByText('참기름/병/분/전통')).toBeInTheDocument();
    expect(screen.getByText('350ml')).toBeInTheDocument();
    expect(screen.getByText('50병')).toBeInTheDocument();
  });
});
