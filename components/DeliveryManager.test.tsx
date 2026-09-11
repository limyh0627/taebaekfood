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
  it('캘린더를 기본 뷰로 열고 배송 대상 상태만 집계한다', () => {
    render(
      <DeliveryManager
        orders={[
          주문('260909-01', 'p1', OrderStatus.DISPATCHED),
          주문('260909-02', 'p2', OrderStatus.DISPATCHED),
          주문('260908-01', 'old', OrderStatus.DELIVERED),
        ]}
        partners={partners}
        items={items}
      />,
    );

    expect(screen.getByRole('button', { name: '캘린더' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '전체2' })).toBeInTheDocument();
    expect(screen.queryByText('예전 거래처')).not.toBeInTheDocument();
  });

  it('날짜 상세의 주문번호를 누르면 출고 일정 수정 창이 열린다', () => {
    render(
      <DeliveryManager
        orders={[주문('260909-01', 'p1', OrderStatus.DISPATCHED)]}
        partners={partners}
        items={items}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: `${Number(today().slice(8, 10))}일 배송 상세 보기` }));
    fireEvent.click(screen.getByRole('button', { name: 'ORD-260909-01' }));

    expect(screen.getByText('출고 일정 수정')).toBeInTheDocument();
    expect(screen.getByLabelText('출고예정일')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: '출고 시간대' })).toBeInTheDocument();
  });
});
