/** @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('../src/shared/services/employeeCommand', () => ({ executeEmployeeCommand: m.command }));
vi.mock('../src/shared/services/firebaseService', () => ({ subscribeToCollection: () => () => {} }));
vi.mock('firebase/firestore', () => ({ where: () => ({}) }));
import ReceivingReturnsManager from './ReceivingReturnsManager';
import type { IssuedStatement, Item, Partner } from '../src/shared/types';
const item = { id: 'box', companyId: 'taebaek', name: '박스', type: 'submaterial', unit: '개', stock: 5 } as Item;
const statement = { id: 'purchase', companyId: 'taebaek', partnerId: 'supplier', partnerName: '합성 거래처', type: '매입',
  tradeDate: '2026-10-01', docNo: '합성 매입', totalAmount: 220, totalSupply: 200, totalTax: 20,
  items: [{ itemId: 'box', name: '박스', qty: 2, price: 100, accountCode: '500', supply: 200, tax: 20, total: 220 }] } as IssuedStatement;
const props = { companyId: 'taebaek' as const, items: [item], partners: [{ id: 'supplier', companyId: 'taebaek', name: '합성 거래처', partnerType: '매출+매입처' }] as Partner[],
  orders: [], currentUser: { id: 'u', name: '관리자' }, isAdmin: true, onProcessReturn: vi.fn(),
  issuedStatements: [statement, { ...statement, id: 'foreign', companyId: 'punghoe', docNo: '다른 회사' } as IssuedStatement] };
afterEach(cleanup);
beforeEach(() => { m.command.mockReset(); vi.spyOn(window, 'alert').mockImplementation(() => {}); });
function selectPurchase() {
  fireEvent.click(screen.getByRole('button', { name: /^보낸 반품$/ }));
  fireEvent.focus(screen.getByPlaceholderText('공급처 검색...'));
  fireEvent.mouseDown(screen.getByRole('button', { name: '합성 거래처' }));
  fireEvent.change(screen.getByRole('combobox', { name: '원매입 전표' }), { target: { value: 'purchase' } });
  fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1' } });
}
describe('실제 반품 접수 원자 명령 입력', () => {
  it('원매입 선택으로 양수 공급가·세액 110원과 연결 ID를 접수한다', async () => {
    render(<ReceivingReturnsManager {...props} />); selectPurchase();
    expect(screen.queryByRole('option', { name: /다른 회사/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /반품 발송 접수/ }));
    await waitFor(() => expect(m.command).toHaveBeenCalledOnce());
    expect(m.command.mock.calls[0][0]).toMatchObject({ collection: 'returnRequests', data: { companyId: 'taebaek',
      partnerId: 'supplier', partnerName: '합성 거래처', linkedStatementId: 'purchase', returnType: '매입', totalAmount: 110,
      items: [{ quantity: 1, price: 110, isResellable: false }] } });
  });
  it('접수 실패와 초과 수량 거절은 원전표·수량·메모 초안을 보존한다', async () => {
    m.command.mockRejectedValue(new Error('저장 실패')); render(<ReceivingReturnsManager {...props} />); selectPurchase();
    fireEvent.change(screen.getByPlaceholderText('반품 사유, 메모 (선택)'), { target: { value: '보존할 메모' } });
    fireEvent.click(screen.getByRole('button', { name: /반품 발송 접수/ }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('저장 실패'));
    expect((screen.getByRole('combobox', { name: '원매입 전표' }) as HTMLSelectElement).value).toBe('purchase');
    expect((screen.getByPlaceholderText('0') as HTMLInputElement).value).toBe('1');
    expect((screen.getByPlaceholderText('반품 사유, 메모 (선택)') as HTMLTextAreaElement).value).toBe('보존할 메모');
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /반품 발송 접수/ })); expect(m.command).toHaveBeenCalledTimes(1);
  });
  it('원매출도 같은 공급가·세액 근거로 접수하고 실제 환불 현금을 생성하지 않는다', async () => {
    render(<ReceivingReturnsManager {...props} issuedStatements={[{ ...statement, id: 'sale', type: '매출', items: [{ ...statement.items[0], accountCode: '400' }] }]} />);
    fireEvent.focus(screen.getByPlaceholderText('거래처 검색...')); fireEvent.mouseDown(screen.getByRole('button', { name: '합성 거래처' }));
    fireEvent.change(screen.getByRole('combobox', { name: '원매출 전표' }), { target: { value: 'sale' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /반품 접수/ }));
    await waitFor(() => expect(m.command).toHaveBeenCalledOnce());
    expect(m.command.mock.calls[0][0]).toMatchObject({ collection: 'returnRequests', data: { linkedStatementId: 'sale', returnType: '매출', totalAmount: 110 } });
  });
});
