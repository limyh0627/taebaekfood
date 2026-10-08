/** @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AddOrderModal from './AddOrderModal';
import { OrderStatus, type Item, type Order, type Partner, type PartnerItem } from '../src/shared/types';
import { buildPackIndex, resetPackIndex, setPackIndex } from '../src/shared/packIndex';

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

describe('선택한 거래처의 실시간 원본 갱신', () => {
  const partner = { ...partners[0], shipTos: [{ id: 's1', name: '기본 배송지' }, { id: 's2', name: '선택 배송지' }] } as Partner;
  const props = { items, orders: [], palletStocks: [], partnerItems, onClose: vi.fn() };

  it('같은 ID의 배송지가 교체되면 최신 목록과 기본 배송지를 표시한다', () => {
    const view = render(<AddOrderModal {...props} partners={[partner]} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /가을식품/ }));
    const updated = { ...partner, shipTos: [{ id: 's3', name: '새 배송지' }] };
    view.rerender(<AddOrderModal {...props} partners={[updated]} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: '새 배송지' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '기본 배송지' })).not.toBeInTheDocument();
  });

  it('원본 갱신 중 유효한 배송지와 수량·비고를 보존하고 최신 거래처·단가로 저장한다', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const view = render(<AddOrderModal {...props} partners={[partner]} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: /가을식품/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택 배송지' }));
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('주문 비고'), { target: { value: '작성한 비고' } });
    const updated = { ...partner, name: '갱신 거래처', email: 'new@example.test',
      shipTos: [{ id: 's3', name: '추가 배송지' }, ...partner.shipTos!] };
    const updatedLinks = partnerItems.map(link => ({ ...link, price: 2200 }));
    view.rerender(<AddOrderModal {...props} partners={[updated]} partnerItems={updatedLinks} onSave={save} />);
    expect(screen.getByRole('button', { name: '선택 배송지' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByPlaceholderText('0')[0]).toHaveValue('2');
    expect(screen.getByLabelText('주문 비고')).toHaveValue('작성한 비고');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '주문 생성 완료' })));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      partnerId: partner.id, partnerName: '갱신 거래처', email: 'new@example.test', shipToId: 's2',
      note: '작성한 비고', totalAmount: 4400,
      items: [expect.objectContaining({ itemId: 'oil', quantity: 2, price: 2200 })],
    }));
  });

  it('선택 배송지가 삭제되면 기본값으로 돌아가고 거래처가 삭제되면 저장을 막는다', () => {
    const view = render(<AddOrderModal {...props} partners={[partner]} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /가을식품/ }));
    fireEvent.click(screen.getByRole('button', { name: '선택 배송지' }));
    view.rerender(<AddOrderModal {...props} partners={[{ ...partner, shipTos: [partner.shipTos![0]] }]} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: '기본 배송지' })).toHaveAttribute('aria-pressed', 'true');
    view.rerender(<AddOrderModal {...props} partners={[]} onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: '주문 생성 완료' })).toBeDisabled();
  });
});

describe('옛 박스 설정과 포장 환산표 충돌', () => {
  it('주문 입력에는 포장 환산표의 개입수를 표시한다', () => {
    setPackIndex(buildPackIndex([{ item_id: 'f6', units_per_box: 12 }]));
    try {
      const item = { id: 'f6', name: '포장 설정 충돌 품목', unit: '개', type: 'goods',
        defaultBoxConfig: { unitsPerBox: 10, boxType: '' } } as unknown as Item;
      render(<AddOrderModal items={[item]} orders={[]} partners={partners}
        partnerItems={[{ id: 'f6-link', itemId: item.id, partnerId: 'partner-1', Direction: 'out', price: 0 } as PartnerItem]}
        palletStocks={[]} onClose={vi.fn()} onSave={vi.fn()} />);
      fireEvent.click(screen.getAllByRole('button', { name: /가을식품/ })[0]);
      fireEvent.click(screen.getByText('포장 설정 충돌 품목'));
      expect(screen.getByText('× 12개 = 12개')).toBeInTheDocument();
    } finally {
      resetPackIndex();
    }
  });
});

describe('신규 주문 창의 거래처 진행 주문', () => {
  it('검색 후 키보드가 화면을 줄여도 결과를 보이는 쪽으로 옮기고 선택할 수 있다', () => {
    const viewport = new EventTarget();
    vi.stubGlobal('visualViewport', viewport);
    try {
      render(<AddOrderModal items={items} orders={[]} partners={partners} palletStocks={[]} onClose={vi.fn()} onSave={vi.fn()} />);
      const input = screen.getByPlaceholderText(/거래처명 또는 초성 검색/);
      const body = input.closest('.overflow-y-auto') as HTMLElement;
      vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ top: 315, bottom: 365 } as DOMRect);
      const bodyRect = vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ top: 84, bottom: 844 } as DOMRect);
      fireEvent.change(input, { target: { value: '가을' } });
      expect(screen.getAllByRole('button', { name: /가을식품/ })[0].parentElement).toHaveClass('top-full');
      bodyRect.mockReturnValue({ top: 84, bottom: 389 } as DOMRect);
      act(() => { viewport.dispatchEvent(new Event('resize')); });
      const result = screen.getAllByRole('button', { name: /가을식품/ })[0];
      expect(result.parentElement).toHaveClass('bottom-full');
      fireEvent.click(result);
      expect(screen.getByRole('heading', { name: '주문 품목' })).toBeInTheDocument();
    } finally { vi.unstubAllGlobals(); }
  });
  it('검색칸 아래 공간이 부족하면 거래처 결과를 위쪽에 보여준다', () => {
    render(<AddOrderModal items={items} orders={[]} partners={partners} palletStocks={[]} onClose={vi.fn()} onSave={vi.fn()} />);
    const input = screen.getByPlaceholderText(/거래처명 또는 초성 검색/);
    const body = input.closest('.overflow-y-auto') as HTMLElement;
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ top: 315, bottom: 365 } as DOMRect);
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ top: 84, bottom: 389 } as DOMRect);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '가을' } });
    expect(screen.getAllByRole('button', { name: /가을식품/ })[0].parentElement).toHaveClass('bottom-full');
  });

  it('매출 연결된 비재고 용역을 주문 품목에 노출하지 않는다', () => {
    const service = { id: 'delivery-fee', name: '배송 용역', unit: '건', type: 'service', category: 'service' } as Item;
    render(
      <AddOrderModal
        items={[...items, service]}
        orders={[]}
        partners={partners}
        partnerItems={[...partnerItems, { id: 'service-link', itemId: service.id, partnerId: 'partner-1', Direction: 'out', price: 10000 } as PartnerItem]}
        palletStocks={[]}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /가을식품/ })[0]);
    expect(screen.queryByText('배송 용역')).not.toBeInTheDocument();
  });

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
    for (const label of ['대기중', '작업중', '작업완료', '출고완료']) {
      expect(within(progress).getByLabelText(`상태 ${label}`)).toBeInTheDocument();
    }
    expect(within(progress).queryByText('ORD-260909-05')).not.toBeInTheDocument();
    expect(within(progress).queryByText('ORD-260909-06')).not.toBeInTheDocument();
    expect(within(progress).queryByText('ORD-260909-07')).not.toBeInTheDocument();

    const itemHeading = screen.getByRole('heading', { name: '주문 품목' });
    expect(progress.compareDocumentPosition(itemHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const firstOrder = within(progress).getByTestId('active-client-order-260909-01');
    expect(within(firstOrder).queryByText('생들기름 300ml')).not.toBeInTheDocument();
    fireEvent.click(within(firstOrder).getByRole('button', { name: 'ORD-260909-01 2품목 보기' }));
    expect(within(firstOrder).getByText('생들기름 300ml')).toBeInTheDocument();
    expect(within(firstOrder).getByText('5병')).toBeInTheDocument();
    expect(within(firstOrder).getByText('2박스')).toBeInTheDocument();
  });
});

 describe('재고 만들기', () => {
 it('일정과 거래처 필수 없이 품목을 골라 생산작업을 저장한다', async () => {
 const save = vi.fn().mockResolvedValue(undefined);
 render(<AddOrderModal mode="stock" items={items} partners={partners} partnerItems={partnerItems} orders={[]} palletStocks={[]} onClose={vi.fn()} onSave={save} />);
 expect(screen.queryByText('주문 일정')).not.toBeInTheDocument();
 fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '5' } });
 fireEvent.click(screen.getByRole('button', { name: '생산 작업 등록' }));
 await waitFor(() => expect(save).toHaveBeenCalledOnce());
 expect(save.mock.calls[0][0]).toMatchObject({ purpose: 'stock-production', totalAmount: 0 });
 expect(save.mock.calls[0][0].partnerId).toBeUndefined();
 });
 });

it('생산 거래처 필터는 복수 ID로 품목만 거르고 판매상대를 지정하지 않는다', () => {
 render(<AddOrderModal mode="stock" items={items} partners={partners} partnerItems={partnerItems} orders={[]} palletStocks={[]} onClose={vi.fn()} onSave={vi.fn()} />);
 const choices = screen.getAllByRole('checkbox').filter(box => box.closest('label')?.textContent === '가을식품');
 fireEvent.click(choices[0]);
 expect(screen.getByText('거래처 필터 전체 해제 (1곳 선택)')).toBeInTheDocument();
 expect(screen.queryByText('주문 일정')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: /거래처 필터 전체 해제/ }));
 expect(choices[0]).not.toBeChecked();
});
