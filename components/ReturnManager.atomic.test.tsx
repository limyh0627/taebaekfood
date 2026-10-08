/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('../src/shared/services/employeeCommand', () => ({ executeEmployeeCommand: m.command }));
vi.mock('../src/shared/services/firebaseService', () => ({ subscribeToCollection: () => () => {} }));
vi.mock('firebase/firestore', () => ({ where: () => ({}) }));
import ReturnManager from './ReturnManager';
import type { IssuedStatement, Item, Partner } from '../src/shared/types';
afterEach(cleanup);
it('완제품 폐기 반품은 원전표 금액과 선택 사유를 보존한다', async () => {
  const item = { id: 'p', companyId: 'taebaek', name: '완제품', type: 'product', unit: '개', stock: 5, minStock: 0, image: '', lots: [{ id: 'lot', supplierName: '합성 공급처', kgIn: 5, kgRemaining: 5, receivedDate: '2026-10-01', status: 'active', createdAt: '2026-10-01T00:00:00Z' }] } as Item;
  const source = { id: 'sale', companyId: 'taebaek', partnerId: 'c', type: '매출', tradeDate: '2026-10-01', docNo: '원매출', totalSupply: 200, totalTax: 20, totalAmount: 220,
    items: [{ itemId: 'p', name: '완제품', qty: 2, supply: 200, tax: 20, total: 220, accountCode: '404' }] } as IssuedStatement;
  render(<ReturnManager companyId="taebaek" items={[item]} partners={[{ id: 'c', companyId: 'taebaek', name: '고객', partnerType: '매출처' } as Partner]} orders={[]} issuedStatements={[source]} currentUser={{ id: 'u', name: '관리자' }} isAdmin onProcessReturn={vi.fn()} />);
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'c' } });
  fireEvent.change(screen.getAllByRole('combobox')[2], { target: { value: 'sale' } });
  fireEvent.click(screen.getByRole('button', { name: /품목 추가/ }));
  fireEvent.change(screen.getAllByRole('combobox')[3], { target: { value: 'p' } });
  fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '1' } });
  fireEvent.change(screen.getAllByRole('combobox')[4], { target: { value: '품질불량' } });
  fireEvent.click(screen.getByRole('button', { name: '재판매' }));
  expect(screen.getByText('₩110')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /반품 접수/ }));
  await waitFor(() => expect(m.command).toHaveBeenCalledOnce());
  expect(m.command.mock.calls[0][0]).toMatchObject({ collection: 'returnRequests', data: { totalAmount: 110,
    items: [{ quantity: 1, price: 110, reason: '품질불량', isResellable: false }] } });
});
