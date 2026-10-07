/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceivingReturnsManager from './ReceivingReturnsManager';
import type { CompanyId, Item, Partner, PartnerItem, ReturnRequest } from '../src/shared/types';

const mock = vi.hoisted(() => ({ listeners: [] as Array<{ callback: (rows: ReturnRequest[]) => void; stop: ReturnType<typeof vi.fn>; clauses: unknown[] }>, command: vi.fn() }));
vi.mock('../src/shared/services/firebaseService', () => ({ subscribeToCollection: (_name: string, callback: (rows: ReturnRequest[]) => void, clauses: unknown[]) => {
  const stop = vi.fn(); mock.listeners.push({ callback, stop, clauses }); return stop;
} }));
vi.mock('../src/shared/services/employeeCommand', () => ({ executeEmployeeCommand: mock.command }));
vi.mock('firebase/firestore', () => ({ where: (field: string, op: string, value: unknown) => ({ field, op, value }) }));

const props = (companyId: CompanyId) => ({
  companyId,
  items: [{ id: `${companyId}-item`, name: `${companyId} 품목`, type: 'product', unit: '개', companyId }] as Item[],
  partners: [{ id: `${companyId}-partner`, name: `${companyId} 거래처`, partnerType: '매출+매입처', companyId }] as Partner[],
  partnerItems: [{ id: `${companyId}-partner-item`, itemId: `${companyId}-item`, partnerId: `${companyId}-partner`, Direction: 'out' }] satisfies PartnerItem[],
  orders: [], currentUser: { id: 'user', name: '담당자' }, isAdmin: true, onProcessReturn: vi.fn(),
});
function selectPartner(placeholder: string) {
  fireEvent.focus(screen.getByPlaceholderText(placeholder));
  fireEvent.mouseDown(screen.getByRole('button', { name: 'taebaek 거래처' }));
}
afterEach(cleanup);
beforeEach(() => { mock.listeners.length = 0; mock.command.mockReset(); });

describe('반품 회사 전환 초안', () => {
  it('받기 초안은 같은 회사 자료 갱신에 유지되고 회사 전환에는 초기화된다', () => {
    const view = render(<ReceivingReturnsManager {...props('taebaek')} />);
    selectPartner('거래처 검색...');
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '7' } });
    fireEvent.change(screen.getByPlaceholderText('반품 관련 메모 (선택)'), { target: { value: '받기 초안' } });
    view.rerender(<ReceivingReturnsManager {...props('taebaek')} />);
    expect((screen.getByPlaceholderText('0') as HTMLInputElement).value).toBe('7');
    view.rerender(<ReceivingReturnsManager {...props('punghoe')} />);
    expect((screen.getByPlaceholderText('거래처 검색...') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('taebaek 품목')).toBeNull();
    expect((screen.getByPlaceholderText('반품 관련 메모 (선택)') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByRole('button', { name: /반품 접수/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(mock.command).not.toHaveBeenCalled();
  });

  it('보내기 거래처와 품목 수량 초안도 회사 전환 시 초기화된다', () => {
    const view = render(<ReceivingReturnsManager {...props('taebaek')} />);
    fireEvent.click(screen.getByRole('button', { name: /^보낸 반품$/ }));
    selectPartner('공급처 검색...');
    fireEvent.change(screen.getByPlaceholderText('+ 품목 검색하여 추가...'), { target: { value: 'taebaek' } });
    fireEvent.mouseDown(screen.getByRole('button', { name: 'taebaek 품목' }));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '4' } });
    fireEvent.change(screen.getByPlaceholderText('반품 사유, 메모 (선택)'), { target: { value: '보내기 초안' } });
    view.rerender(<ReceivingReturnsManager {...props('taebaek')} />);
    expect((screen.getByPlaceholderText('0') as HTMLInputElement).value).toBe('4');
    view.rerender(<ReceivingReturnsManager {...props('punghoe')} />);
    fireEvent.click(screen.getByRole('button', { name: /^보낸 반품$/ }));
    expect((screen.getByPlaceholderText('공급처 검색...') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('taebaek 품목')).toBeNull();
    expect((screen.getByPlaceholderText('반품 사유, 메모 (선택)') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByRole('button', { name: /반품 발송 접수/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(mock.command).not.toHaveBeenCalled();
  });

  it('이전 회사 구독을 해제하고 늦게 도착한 반품 목록을 버린다', () => {
    const view = render(<ReceivingReturnsManager {...props('taebaek')} />);
    const old = mock.listeners[0];
    view.rerender(<ReceivingReturnsManager {...props('punghoe')} />);
    expect(old.stop).toHaveBeenCalledTimes(1);
    expect(mock.listeners[1].clauses).toEqual([{ field: 'companyId', op: '==', value: 'punghoe' }]);
    fireEvent.click(screen.getByRole('button', { name: /^이력$/ }));
    act(() => mock.listeners[1].callback([{ id: 'new', partnerName: '현재 회사 반품', items: [], totalAmount: 0, status: 'pending', createdAt: new Date().toISOString() } as unknown as ReturnRequest]));
    expect(screen.getByText('현재 회사 반품')).toBeTruthy();
    act(() => old.callback([{ id: 'old', partnerName: '옛 회사 반품', items: [], totalAmount: 0, status: 'pending', createdAt: new Date().toISOString() } as unknown as ReturnRequest]));
    expect(screen.queryByText('옛 회사 반품')).toBeNull();
    expect(screen.getByText('현재 회사 반품')).toBeTruthy();
    expect(mock.command).not.toHaveBeenCalled();
  });
});
