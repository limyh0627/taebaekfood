/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DeliveryDayList from './DeliveryDayList';
import { OrderStatus, type Order, type Partner } from '../src/shared/types';
import type { DayRow } from '../src/shared/deliveryPlan';

const partners = [
  { id: 'p1', name: '첫 거래처' },
  { id: 'p2', name: '둘 거래처' },
] as Partner[];

const 주문 = (id: string, partnerId: string, cardNo: string): Order => ({
  id,
  partnerId,
  partnerName: '',
  cardNo,
  items: [],
  totalAmount: 0,
  status: OrderStatus.PROCESSING,
  createdAt: '2026-09-08T09:30:00+09:00',
  deliveryDate: '2026-09-09',
  email: '',
  source: '일반',
});

const rows: DayRow[] = [
  { orderId: 'A', auto: true, slot: '오전', done: false },
  { orderId: 'B', auto: true, slot: '오전', done: false },
];

describe('배송 캘린더 주문 카드', () => {
  it('주문번호와 접수일을 한 줄 정보로 보여준다', () => {
    render(
      <DeliveryDayList
        rows={rows}
        orders={[주문('A', 'p1', 'ORD-260908-001'), 주문('B', 'p2', 'ORD-260908-002')]}
        partners={partners}
        dateStr="2026-09-09"
        compact
        on={{ open: vi.fn(), toggleDone: vi.fn(), reorder: vi.fn() }}
      />,
    );

    expect(screen.getByRole('button', { name: 'ORD-260908-001' })).toBeInTheDocument();
    expect(screen.getAllByText('접수 9/8')).toHaveLength(2);
  });

  it('순번 숫자에서 목표 자리를 직접 고를 수 있다', () => {
    const reorder = vi.fn();
    render(
      <DeliveryDayList
        rows={rows}
        orders={[주문('A', 'p1', 'ORD-260908-001'), 주문('B', 'p2', 'ORD-260908-002')]}
        partners={partners}
        dateStr="2026-09-09"
        on={{ open: vi.fn(), toggleDone: vi.fn(), reorder }}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: '둘 거래처 배송 순서' }), { target: { value: '0' } });
    expect(reorder).toHaveBeenCalledWith(['B', 'A']);
  });

  it('드래그할 때 주문 ID와 원래 날짜를 함께 넘긴다', () => {
    render(
      <DeliveryDayList
        rows={rows}
        orders={[주문('A', 'p1', 'ORD-260908-001'), 주문('B', 'p2', 'ORD-260908-002')]}
        partners={partners}
        dateStr="2026-09-09"
        on={{ open: vi.fn(), toggleDone: vi.fn(), reorder: vi.fn() }}
      />,
    );
    const setData = vi.fn();
    fireEvent.dragStart(screen.getAllByTitle('잡아서 순서나 날짜 변경')[0], {
      dataTransfer: { setData, effectAllowed: 'move' },
    });

    expect(setData).toHaveBeenCalledWith('orderId', 'A');
    expect(setData).toHaveBeenCalledWith('deliverySourceDate', '2026-09-09');
  });
});
