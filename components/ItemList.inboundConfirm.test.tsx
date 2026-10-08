/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ItemList from './ItemList';
import type { Item, CompanyId } from '../src/shared/types';

vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {}, functions: {}, auth: {}, authReady: Promise.resolve() }));
vi.mock('../src/shared/services/firebaseService', () => ({
  fetchCollection: vi.fn().mockResolvedValue([]), subscribeToCollection: vi.fn(() => () => {}), addItem: vi.fn(),
}));

const item = { id: 'p1', companyId: 'taebaek', name: '검수 품목', type: 'product', unit: '개', stock: 10, minStock: 0 } as Item;
const order = { id: 'po1', companyId: 'taebaek', status: 'invoiced', createdAt: '2026-10-07', partnerName: '검수 거래처', items: [{ itemId: 'p1', name: '검수 품목', quantity: 2 }] } as any;
function view(orders = [order], issue = vi.fn().mockResolvedValue(true), companyId: CompanyId = 'taebaek', items = [item]) {
  const props: React.ComponentProps<typeof ItemList> = { companyId, items, partners: [],
    orderRequests: [], confirmedOrders: orders, inboundPartners: [], rawMaterialLedger: [],
    onUpdateItem: vi.fn(), onAddItem: vi.fn(), onAddOrderRequest: vi.fn(), onRemoveOrderRequest: vi.fn(),
    onUpdateOrderRequestQty: vi.fn(), onToggleConfirmRequestQty: vi.fn(), onConfirmRequest: vi.fn(),
    onConfirmRequests: vi.fn(), onBulkAddConfirmedOrders: vi.fn(), onConfirmAllRequests: vi.fn(),
    onFinishConfirmedOrder: issue, onUpdateConfirmedQty: vi.fn(), onRemoveConfirmedOrder: vi.fn(),
    onEditProduct: vi.fn(), onDeleteItem: vi.fn(), onAddAdjustmentRequest: vi.fn(),
    onAddRawMaterialEntry: vi.fn(), onDeleteRawMaterialEntry: vi.fn() };

  const rendered = render(<ItemList {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '입고/반품' }));
  return Object.assign(issue, { rendered, props });
}
it.each(['product', 'goods', 'submaterial'])('지원 품목 %s의 별도 입고확정은 원래 발주 ID로 연결된다', async type => {
  const issue = view([order], vi.fn().mockResolvedValue(true), 'taebaek', [{ ...item, type } as Item]);
  fireEvent.click(screen.getByRole('button', { name: '입고확정' }));
  fireEvent.click(screen.getAllByRole('button', { name: '입고확정' }).at(-1)!);
  await act(async () => {});
  expect(issue).toHaveBeenCalledExactlyOnceWith('po1');
});
it('회사 전환 후 이전 회사 상세를 표시하지 않고 현재 회사 발주만 확정한다', async () => {
  const issue = view();
  fireEvent.click(screen.getByText('검수 거래처').closest('tr')!);
  issue.rendered.rerender(<ItemList {...issue.props} companyId="punghoe"
    items={[{ ...item, companyId: 'punghoe' }]}
    confirmedOrders={[{ ...order, id: 'po2', companyId: 'punghoe', partnerName: '풍회 거래처' }]} />);
  expect(screen.queryByText('입고 상세')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '입고/반품' }));
  fireEvent.click(screen.getByRole('button', { name: '입고확정' }));
  fireEvent.click(screen.getAllByRole('button', { name: '입고확정' }).at(-1)!);
  await act(async () => {});
  expect(issue).toHaveBeenCalledExactlyOnceWith('po2');
});
it('OEM 입고는 목록과 상세 모두 일반 입고확정으로 진행하지 않는다', () => {
  const issue = view([{ ...order, poType: 'oem' }]);
  expect(screen.getByRole('button', { name: '입고확정' })).toBeDisabled();
  fireEvent.click(screen.getByText('검수 거래처').closest('tr')!);
  expect(screen.getAllByRole('button', { name: '입고확정' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
  expect(issue).not.toHaveBeenCalled();
});
it('목록 입고확정 진행 중 반복 요청을 막고 실패 후 대기 행을 보존한다', async () => {
  let complete!: (result: boolean) => void;
  const issue = view([order], vi.fn(() => new Promise<boolean>(resolve => { complete = resolve; })));
  fireEvent.click(screen.getByRole('button', { name: '입고확정' }));
  fireEvent.click(screen.getAllByRole('button', { name: '입고확정' }).at(-1)!);
  expect(issue).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: '입고확정' })).toBeDisabled();
  await act(async () => complete(false));
  expect(screen.getByRole('button', { name: '입고확정' })).toBeEnabled();
  expect(screen.getByText('대기', { selector: 'span' })).toBeInTheDocument();
});
it('상세 입고확정 거절 시 상세와 기존 수량이 남는다', async () => {
  view([order], vi.fn().mockResolvedValue(false));
  fireEvent.click(screen.getByText('검수 거래처').closest('tr')!);
  fireEvent.click(screen.getAllByRole('button', { name: '입고확정' }).at(-1)!);
  await act(async () => {});
  expect(screen.getByText('입고 상세')).toBeInTheDocument();
  expect(screen.getByLabelText('검수 품목 수량')).toHaveValue(2);
});

it('입고 처리에서 거래처와 품목을 선택하면 기존 원자 입고확정으로 연결한다', async () => {
 const issue = view([{ ...order, partnerId: 'supplier' }]);
 issue.rendered.rerender(<ItemList {...issue.props} inboundPartners={[{ id: 'supplier', name: '검수 거래처', type: '매입' } as any]} />);
 fireEvent.click(screen.getByRole('button', { name: '입고 처리' }));
 expect(screen.getByText('매입 거래처를 먼저 선택해 주세요.')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('입고 매입 거래처'), { target: { value: 'supplier' } });
 fireEvent.click(screen.getByRole('button', { name: /검수 품목.*입고대기 품목 확인/ }));
 fireEvent.click(screen.getAllByRole('button', { name: '입고확정' }).at(-1)!);
 await act(async () => {});
 expect(issue).toHaveBeenCalledExactlyOnceWith('po1');
});
