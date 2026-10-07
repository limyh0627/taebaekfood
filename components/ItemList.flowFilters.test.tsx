/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ItemList from './ItemList';
import type { PurchaseOrder, ReturnRequest } from '../src/shared/types';

vi.mock('../src/shared/firebase', () => ({ db: {}, storage: {}, functions: {}, auth: {}, authReady: Promise.resolve() }));
vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection: vi.fn().mockResolvedValue([]), subscribeToCollection: vi.fn(() => () => {}), addItem: vi.fn() }));
const purchase = (id: string, status: PurchaseOrder['status']) => ({ id, companyId: 'taebaek', partnerName: id, status, createdAt: '2026-10-01', invoicedAt: '2026-10-02', receivedAt: '2026-10-03', items: [{ itemId: 'p1', name: '기름', quantity: 2, unit: '병' }] } as PurchaseOrder);
const returned = (id: string, status: ReturnRequest['status']): ReturnRequest & { companyId: 'taebaek' } => ({ id, companyId: 'taebaek', partnerId: 'partner-1', partnerName: id, totalAmount: 0, status, createdAt: '2026-10-01', processedAt: '2026-10-03', items: [{ itemId: 'p1', name: '기름', quantity: 2, price: 0, reason: '기타', isResellable: true }] });
function view(extra: Partial<React.ComponentProps<typeof ItemList>> = {}) {
 render(<ItemList companyId="taebaek" items={[]} partners={[]} orderRequests={[purchase('예정거래처', 'pending')]} confirmedOrders={[purchase('대기거래처', 'invoiced')]} receivedOrders={[purchase('완료거래처', 'received')]} returnRequests={[returned('반품대기거래처', 'pending'), returned('반품완료거래처', 'processed')]} inboundPartners={[]} rawMaterialLedger={[]}
 onUpdateItem={vi.fn()} onAddItem={vi.fn()} onAddOrderRequest={vi.fn()} onRemoveOrderRequest={vi.fn()} onUpdateOrderRequestQty={vi.fn()} onToggleConfirmRequestQty={vi.fn()} onConfirmRequest={vi.fn()} onConfirmRequests={vi.fn()} onBulkAddConfirmedOrders={vi.fn()} onConfirmAllRequests={vi.fn()} onFinishConfirmedOrder={vi.fn()} onUpdateConfirmedQty={vi.fn()} onRemoveConfirmedOrder={vi.fn()} onEditProduct={vi.fn()} onDeleteItem={vi.fn()} onAddAdjustmentRequest={vi.fn()} onAddRawMaterialEntry={vi.fn()} onDeleteRawMaterialEntry={vi.fn()} {...extra} />);
 fireEvent.click(screen.getByRole('button', { name: '입고/반품' }));
 const table = screen.getByRole('table');
 const panel = table.parentElement!.parentElement!;
 const filter = within(panel.firstElementChild as HTMLElement);
 return { table: within(table), panel: within(panel), filter };
}

it('기본 전체는 예정·대기만 표시하고 건수도 완료를 제외한다', () => {
 const { table, filter } = view();
 expect(table.getByText('예정거래처')).toBeInTheDocument();
 expect(table.getByText('대기거래처')).toBeInTheDocument();
 expect(table.getByText('반품대기거래처')).toBeInTheDocument();
 expect(table.queryByText('완료거래처')).not.toBeInTheDocument();
 expect(table.queryByText('반품완료거래처')).not.toBeInTheDocument();
 expect(filter.getByText('3건')).toBeInTheDocument();
});

it('이력은 완료만 표시하며 유형과 건수를 같은 결과로 거른다', () => {
 const { table, filter } = view();
 fireEvent.click(filter.getByRole('button', { name: '이력' }));
 expect(table.getByText('완료거래처')).toBeInTheDocument();
 expect(table.getByText('반품완료거래처')).toBeInTheDocument();
 expect(table.queryByText('대기거래처')).not.toBeInTheDocument();
 expect(filter.getByText('2건')).toBeInTheDocument();
 fireEvent.click(filter.getByRole('button', { name: '반품' }));
 expect(table.queryByText('완료거래처')).not.toBeInTheDocument();
 expect(table.getByText('반품완료거래처')).toBeInTheDocument();
 expect(filter.getByText('1건')).toBeInTheDocument();
});

it('기본 전체의 페이지 수에 완료 건을 포함하지 않는다', () => {
 const { table, panel, filter } = view({ orderRequests: Array.from({ length: 31 }, (_, i) => purchase(`예정-${i}`, 'pending')), confirmedOrders: [], returnRequests: [], receivedOrders: Array.from({ length: 61 }, (_, i) => purchase(`완료-${i}`, 'received')) });
 expect(filter.getByText('31건')).toBeInTheDocument();
 expect(panel.queryByRole('button', { name: /^3$/ })).not.toBeInTheDocument();
 fireEvent.click(panel.getByRole('button', { name: /^2$/ }));
 expect(table.getByText('예정-30')).toBeInTheDocument();
 fireEvent.click(filter.getByRole('button', { name: '이력' }));
 expect(filter.getByText('61건')).toBeInTheDocument();
 expect(table.getByText('완료-0')).toBeInTheDocument();
 expect(table.queryByText('예정-30')).not.toBeInTheDocument();
 fireEvent.click(panel.getByRole('button', { name: /^3$/ }));
 expect(table.getByText('완료-60')).toBeInTheDocument();
});
