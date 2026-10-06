/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrderStatus, type Item, type Order } from '../types';
import OrdersList from './OrdersList';
import { migrateOrderItemNotes } from '../src/shared/orderNote';
import { today } from '../src/shared/day';

const products = [
  { id: 'p1', name: '참기름', type: 'product', unit: '병', stock: 10 },
  { id: 'p2', name: '들기름', type: 'product', unit: '병', stock: 10 },
] as Item[];
const order = migrateOrderItemNotes({
  id: 'order-note-test', partnerId: 'partner-1', partnerName: '가상거래처', status: OrderStatus.PENDING,
  source: '일반', createdAt: `${today()}T12:00:00+09:00`, deliveryDate: today(), totalAmount: 0, email: '',
  note: '주문 전체 전달사항', noteImportant: true,
  items: [
    { itemId: 'p1', name: '참기름', quantity: 2, price: 0, note: '옛 참기름 메모'.repeat(8) },
    { itemId: 'p2', name: '들기름', quantity: 3, price: 0, note: '옛 들기름 메모' },
  ],
}) as Order;

const renderList = () => {
  const onUpdateNote = vi.fn();
  render(<OrdersList companyId="taebaek" title="주문" subtitle="" groupBy="status"
    allowedStatuses={[OrderStatus.PENDING]} orders={[order]} partners={[]} items={products}
    onUpdateStatus={vi.fn()} onUpdateDeliveryDate={vi.fn()} onDeleteOrder={vi.fn()}
    onAddClick={vi.fn()} onUpdateNote={onUpdateNote} />);
  fireEvent.click(screen.getByRole('button', { name: '리스트' }));
  return { onUpdateNote };
};

describe('주문 리스트 비고와 모바일 목록', () => {
  it.each(['일반', '추출'])('%s 등록 박스 주문 카드에는 주문수량만 표시한다', (source) => {
    const boxedOrder = { ...order, id: `box-${source}`, items: [{ itemId: 'p1', name: '참기름', quantity: 60, price: 0, isBoxUnit: true, boxQuantity: 3, unitsPerBox: 20 }] } as Order;
    render(<OrdersList companyId="taebaek" title="주문" subtitle="" groupBy="status"
      allowedStatuses={[OrderStatus.PENDING]} orders={[boxedOrder]} partners={[]} items={products}
      onUpdateStatus={vi.fn()} onUpdateDeliveryDate={vi.fn()} onDeleteOrder={vi.fn()}
      onAddClick={vi.fn()} onUpdateNote={vi.fn()} />);
    const card = document.getElementById(`order-card-box-${source}`);
    expect(card?.textContent).toContain('3박스');
    expect(card?.textContent).not.toContain('60개');
  });
  it('보드에서는 이관된 비고를 주문 카드 아래 한 영역에 모은다', () => {
    render(<OrdersList companyId="taebaek" title="주문" subtitle="" groupBy="status"
      allowedStatuses={[OrderStatus.PENDING]} orders={[order]} partners={[]} items={products}
      onUpdateStatus={vi.fn()} onUpdateDeliveryDate={vi.fn()} onDeleteOrder={vi.fn()}
      onAddClick={vi.fn()} onUpdateNote={vi.fn()} />);
    const card = document.getElementById('order-card-order-note-test');
    expect(card?.textContent).toContain('참기름: 옛 참기름 메모');
    expect(card?.textContent).toContain('들기름: 옛 들기름 메모');
    expect(card?.textContent).not.toContain('옛 품목 비고');
    expect(within(card!).queryByRole('button', { name: '참기름 비고' })).toBeNull();
  });

  it('두 품목이어도 데스크톱 비고 셀은 주문 하나이고 주문 비고만 편집한다', () => {
    const { onUpdateNote } = renderList();
    const table = screen.getByRole('table', { name: '주문 리스트' });
    const noteButtons = within(table).getAllByRole('button', { name: '가상거래처 주문 비고 수정' });
    expect(noteButtons).toHaveLength(1);
    expect(noteButtons[0].closest('[role="cell"]')?.textContent).toContain('옛 참기름 메모');
    expect(noteButtons[0].closest('[role="cell"]')?.textContent).toContain('옛 들기름 메모');

    fireEvent.click(noteButtons[0]);
    const note = screen.getByRole('textbox', { name: '주문 비고' }) as HTMLTextAreaElement;
    expect(note.value).toBe(order.note);
    fireEvent.change(note, { target: { value: '주문 수정사항' } });
    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));
    expect(onUpdateNote).toHaveBeenCalledWith('order-note-test', '주문 수정사항', true);
  });

  it('모바일 요약에 두 품목·수량·주문/옛 비고가 보이고 품목별 메모 수정은 열리지 않는다', () => {
    renderList();
    const mobile = screen.getByLabelText('모바일 주문 리스트');
    expect(mobile.textContent).toContain('참기름');
    expect(mobile.textContent).toContain('2병');
    expect(mobile.textContent).toContain('들기름');
    expect(mobile.textContent).toContain('3병');
    expect(mobile.textContent).toContain('주문 전체 전달사항');
    expect(mobile.textContent).toContain('옛 참기름 메모');
    expect(mobile.textContent).toContain('옛 들기름 메모');
    expect(screen.queryByRole('button', { name: '참기름 비고' })).toBeNull();
    fireEvent.click(within(mobile).getByRole('button', { name: '전체 표·작업 보기' }));
    expect(within(mobile).queryByText('주문 전체 전달사항')).toBeNull();
    expect(screen.getByRole('table', { name: '주문 리스트' })).not.toBeNull();
  });
  it('이관된 50자 초과 비고를 일부 수정해도 끝부분과 전체 길이가 유지된다', () => {
    const { onUpdateNote } = renderList();
    const table = screen.getByRole('table', { name: '주문 리스트' });
    fireEvent.click(within(table).getByRole('button', { name: '가상거래처 주문 비고 수정' }));
    const note = screen.getByRole('textbox', { name: '주문 비고' }) as HTMLTextAreaElement;
    expect(order.note!.length).toBeGreaterThan(50);
    expect(note.maxLength).toBe(order.note!.length);
    const changed = `수정${order.note!.slice(2)}`;
    fireEvent.change(note, { target: { value: changed } });
    fireEvent.click(screen.getByRole('button', { name: '변경 저장' }));
    expect(onUpdateNote).toHaveBeenCalledWith(order.id, changed, true);
    expect(changed.endsWith('들기름: 옛 들기름 메모')).toBe(true);
  });
});
