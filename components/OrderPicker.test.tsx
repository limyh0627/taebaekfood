/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OrderPicker, { type OrderPickerProps } from './OrderPicker';
import { OrderStatus, type Item, type Order, type Partner } from '../src/shared/types';

const items = [
  { id: 'oil', name: '생들기름 300ml', unit: '병', type: 'product' },
  { id: 'gift', name: '선물세트', unit: '개', type: 'product' },
] as Item[];

const order = {
  id: 'order-1', cardNo: 'ORD-260908-01', partnerId: 'partner-1', partnerName: '해피유통',
  items: [
    { itemId: 'oil', name: '옛 품목명', quantity: 5, price: 0 },
    { itemId: 'gift', name: '선물세트', quantity: 24, price: 0,
      isBoxUnit: true, boxQuantity: 2, unitsPerBox: 12 },
  ],
  totalAmount: 0, status: OrderStatus.PENDING, createdAt: '2026-09-08T09:00:00+09:00',
  deliveryDate: '2026-09-09', email: '', source: '일반',
} as Order;

const partner = { id: 'partner-1', name: '해피유통', type: '일반' } as Partner;

function props(selectedClientId = '', selectedOrderIds: string[] = []): OrderPickerProps {
  return {
    mode: { createMode: '매출', manualMode: false, editingStmt: null },
    pick: { selectedClientId, selectedOrderId: selectedOrderIds[0] ?? '', selectedOrderIds },
    filter: { onlyActive: true, dateFrom: '', dateTo: '', orderDateQuick: '전체', activeVisible: 30, partnerSearch: '' },
    data: {
      activeOrders: [order], partnerOrders: selectedClientId ? [order] : [],
      confirmedBySupplier: [], orderRequestsBySupplier: [], confirmedOrders: [], orderRequests: [],
      mergedStatements: [], allItems: items, partners: [partner], isVouchered: () => false,
    },
    on: {
      setSelectedClientId: vi.fn(), setSelectedOrderIds: vi.fn(), setManualMode: vi.fn(), setManualItems: vi.fn(),
      setDateFrom: vi.fn(), setDateTo: vi.fn(), setOrderDateQuick: vi.fn(), setActiveVisible: vi.fn(),
      setTradeDate: vi.fn(), setLoadedPoIds: vi.fn(), setWarnDuplicate: vi.fn(), goCompose: vi.fn(),
      handleOrderClick: vi.fn(), poToManualRows: vi.fn(() => []),
    },
  };
}

describe('미발행 주문의 품목·수량', () => {
  it('미발행을 맨 앞에 두고 작은 상태 점을 쓰며 N품목을 눌러 품목을 여닫는다', () => {
    const p = props();
    render(<OrderPicker {...p}/>);
    const card = screen.getByTestId('active-order-order-1');
    const unissued = within(card).getByText('미발행');
    const delivery = within(card).getByText('납품 09-09');
    const partnerName = within(card).getByText('해피유통');
    const status = within(card).getByLabelText('상태 대기중');
    expect(unissued.compareDocumentPosition(delivery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(delivery.compareDocumentPosition(partnerName) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status.querySelector('[aria-hidden="true"]')).toHaveClass('rounded-full', 'bg-amber-500');
    expect(within(card).queryByText('생들기름 300ml')).not.toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'ORD-260908-01 2품목 보기' }));
    expect(p.on.handleOrderClick).not.toHaveBeenCalled();
    expect(p.on.setSelectedClientId).not.toHaveBeenCalled();
    expect(within(card).getByText('생들기름 300ml')).toBeInTheDocument();
    expect(within(card).getByText('5병')).toBeInTheDocument();
    expect(within(card).getByText('2박스 (24개)')).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'ORD-260908-01 2품목 접기' }));
    expect(within(card).queryByText('생들기름 300ml')).not.toBeInTheDocument();
  });

  it('거래처를 고른 뒤 목록도 N품목을 눌러 같은 품목과 수량을 펼친다', () => {
    render(<OrderPicker {...props('partner-1')}/>);
    const card = screen.getByTestId('order-pick-order-1');
    expect(within(card).queryByText('생들기름 300ml')).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'ORD-260908-01 2품목 보기' }));
    expect(within(card).getByText('생들기름 300ml')).toBeInTheDocument();
    expect(within(card).getByText('5병')).toBeInTheDocument();
    expect(within(card).getByText('2박스 (24개)')).toBeInTheDocument();
  });

  it('날짜 필터를 위에 두고 주문 선택·건수·작성·해제를 한 줄에 둔다', () => {
    render(<OrderPicker {...props('partner-1', ['order-1'])}/>);
    const dateFilter = screen.getByLabelText('주문 날짜 필터');
    const actionRow = screen.getByText('주문 선택').parentElement!;
    const compose = within(actionRow).getByRole('button', { name: /전표 작성/ });
    const clear = within(actionRow).getByRole('button', { name: '선택 해제' });

    expect(dateFilter.compareDocumentPosition(actionRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(actionRow).getByText('1건')).toBeInTheDocument();
    expect(compose.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('1건 선택')).not.toBeInTheDocument();
  });

  it('납품일 옆 주문번호로 실제 주문카드를 열고 닫으며 주문 선택은 건드리지 않는다', () => {
    const p = props('partner-1');
    render(<OrderPicker {...p}/>);
    const row = screen.getByTestId('order-pick-order-1');
    const delivery = within(row).getByText('납품: 2026-09-09');
    const number = within(delivery.parentElement!).getByRole('button', { name: 'ORD-260908-01' });

    fireEvent.click(number);
    expect(p.on.handleOrderClick).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: '주문 카드' });
    expect(within(dialog).getAllByText('해피유통').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('옛 품목명')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('옛 품목명 라벨 상태')).toBeDisabled();
    expect(within(dialog).getByLabelText('옛 품목명 제조일 설정')).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: '주문카드 닫기' }));
    expect(screen.queryByRole('dialog', { name: '주문 카드' })).not.toBeInTheDocument();
  });
});
