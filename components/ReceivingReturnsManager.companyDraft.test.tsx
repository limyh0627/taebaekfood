/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceivingReturnsManager from './ReceivingReturnsManager';
import type { CompanyId, Item, Partner, PartnerItem, ReturnRequest } from '../src/shared/types';

const mock = vi.hoisted(() => ({ listeners: [] as Array<{ callback: (rows: ReturnRequest[]) => void; stop: ReturnType<typeof vi.fn>; clauses: unknown[] }>, command: vi.fn(), pending: null as any, actor: 'test-auth-uid' }));
vi.mock('../src/shared/services/firebaseService', () => ({ subscribeToCollection: (_name: string, callback: (rows: ReturnRequest[]) => void, clauses: unknown[]) => {
  const stop = vi.fn(); mock.listeners.push({ callback, stop, clauses }); return stop;
} }));
vi.mock('../src/shared/services/employeeCommand', () => ({ executeEmployeeCommand: mock.command }));
vi.mock('../src/shared/services/returnRequestSubmission', () => ({
  getPendingReturnSubmission: () => mock.pending, returnSubmissionActorUid: () => mock.actor,
  submitReturnRequest: mock.command, resumeReturnSubmission: mock.command,
}));
vi.mock('firebase/firestore', () => ({ where: (field: string, op: string, value: unknown) => ({ field, op, value }) }));

const props = (companyId: CompanyId) => ({
  companyId,
  items: [{ id: `${companyId}-item`, name: `${companyId} 품목`, type: 'product', unit: '개', companyId }] as Item[],
  partners: [{ id: `${companyId}-partner`, name: `${companyId} 거래처`, partnerType: '매출+매입처', companyId }] as Partner[],
  partnerItems: [{ id: `${companyId}-partner-item`, itemId: `${companyId}-item`, partnerId: `${companyId}-partner`, Direction: 'out' }, { id: `${companyId}-purchase-link`, itemId: `${companyId}-item`, partnerId: `${companyId}-partner`, Direction: 'in' }] satisfies PartnerItem[],
  orders: [], currentUser: { id: 'user', name: '담당자' }, isAdmin: true, onProcessReturn: vi.fn(),
});
function selectPartner(placeholder: string) {
  fireEvent.focus(screen.getByPlaceholderText(placeholder));
  fireEvent.mouseDown(screen.getByRole('button', { name: 'taebaek 거래처' }));
}
afterEach(cleanup);
beforeEach(() => { mock.listeners.length = 0; mock.command.mockReset(); mock.pending = null; mock.actor = 'test-auth-uid'; });

describe('반품 회사 전환 초안', () => {
  it('수동으로 추가한 행은 연결 자료가 바뀌어도 유지된다', () => {
    const loaded = props('taebaek');
    const second = { ...loaded.items[0], id: 'second', name: '수동 추가 품목' };
    const source = { id: 's', companyId: 'taebaek', partnerId: 'taebaek-partner', type: '매출', totalAmount: 100, items: [{ itemId: 'second' }] } as any;
    const view = render(<ReceivingReturnsManager {...loaded} items={[...loaded.items, second]} issuedStatements={[source]} />);
    selectPartner('거래처 검색...');
    fireEvent.change(screen.getByPlaceholderText('+ 품목 검색하여 추가...'), { target: { value: '수동 추가' } });
    fireEvent.mouseDown(screen.getByRole('button', { name: '수동 추가 품목' }));
    view.rerender(<ReceivingReturnsManager {...props('taebaek')} issuedStatements={[source]} />);
    expect(screen.getAllByPlaceholderText('0')).toHaveLength(2);
  });

  it.each(['공급가', '세액', '발생 계정'])('%s를 입력한 뒤 자료 갱신도 초안을 유지한다', field => {
    const loaded = props('taebaek');
    const view = render(<ReceivingReturnsManager {...loaded} />);
    selectPartner('거래처 검색...');
    fireEvent.change(screen.getByLabelText(`taebaek 품목 ${field}`), { target: { value: '100' } });
    view.rerender(<ReceivingReturnsManager {...loaded} items={[{ ...loaded.items[0], name: '변경된 품목' }]} />);
    expect(screen.getByLabelText(`taebaek 품목 ${field}`)).toHaveProperty('value', '100');
  });

  it('이전 접수 확인 성공 후 자료가 와도 행을 다시 만들지 않는다', async () => {
    mock.pending = { request: { partnerName: '이전 거래처', returnType: '매출', totalAmount: 100 } };
    mock.command.mockResolvedValue(undefined);
    const loaded = props('taebaek');
    const view = render(<ReceivingReturnsManager {...loaded} />);
    selectPartner('거래처 검색...');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '이전 접수 확인' })); });
    view.rerender(<ReceivingReturnsManager {...props('taebaek')} />);
    expect(screen.queryByPlaceholderText('0')).toBeNull();
    expect(mock.command).toHaveBeenCalledOnce();
  });

  it('실제 로그인 계정이 바뀌면 같은 회사에서도 초안을 초기화한다', () => {
    const view = render(<ReceivingReturnsManager {...props('taebaek')} />);
    selectPartner('거래처 검색...');
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '4' } });
    mock.actor = 'other-auth-uid';
    view.rerender(<ReceivingReturnsManager {...props('taebaek')} />);
    expect(screen.queryByPlaceholderText('0')).toBeNull();
    expect(screen.getByPlaceholderText('거래처 검색...')).toHaveProperty('value', '');
  });

  it('연결 자료가 늦게 도착하면 미편집 자동 제안을 채운다', () => {
    const loaded = props('taebaek');
    const view = render(<ReceivingReturnsManager {...loaded} items={[]} partnerItems={[]} />);
    selectPartner('거래처 검색...');
    expect(screen.queryByPlaceholderText('0')).toBeNull();
    view.rerender(<ReceivingReturnsManager {...loaded} />);
    expect(screen.getByPlaceholderText('0')).toHaveProperty('value', '');
    expect(screen.getAllByText('taebaek 품목')[0]).toBeTruthy();
  });

  it('늦은 주문은 현재 회사만 제안하고 연결 품목이 오면 우선한다', () => {
    const loaded = props('taebaek');
    const second = { ...loaded.items[0], id: 'second', name: '연결 우선 품목' };
    const view = render(<ReceivingReturnsManager {...loaded} partnerItems={[]} />);
    selectPartner('거래처 검색...');
    const order = { id: 'o', companyId: 'taebaek', partnerId: 'taebaek-partner', createdAt: '2026-10-15', items: [{ itemId: 'taebaek-item', name: '주문 품목' }] } as any;
    view.rerender(<ReceivingReturnsManager {...loaded} partnerItems={[]} orders={[{ ...order, companyId: 'punghoe' }]} />);
    expect(screen.queryByPlaceholderText('0')).toBeNull();
    view.rerender(<ReceivingReturnsManager {...loaded} partnerItems={[]} orders={[order]} />);
    expect(screen.getAllByText('주문 품목')[0]).toBeTruthy();
    view.rerender(<ReceivingReturnsManager {...loaded} items={[...loaded.items, second]} partnerItems={[{ id: 'l', partnerId: 'taebaek-partner', itemId: 'second', Direction: 'out' }]} orders={[order]} />);
    expect(screen.queryByText('주문 품목')).toBeNull();
    expect(screen.getAllByText('연결 우선 품목')[0]).toBeTruthy();
  });

  it.each(['0', ''])('수량을 %s로 편집하면 늦은 자료가 행을 교체하지 않는다', value => {
    const loaded = props('taebaek');
    const view = render(<ReceivingReturnsManager {...loaded} />);
    selectPartner('거래처 검색...');
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '3' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value } });
    view.rerender(<ReceivingReturnsManager {...loaded} items={[{ ...loaded.items[0], name: '새 자료 이름' }]} />);
    expect(screen.getAllByText('taebaek 품목')[0]).toBeTruthy();
    expect(screen.getByPlaceholderText('0')).toHaveProperty('value', value);
  });

  it('행을 모두 삭제한 빈 초안도 늦은 자료가 되살리지 않는다', () => {
    const loaded = props('taebaek');
    const view = render(<ReceivingReturnsManager {...loaded} />);
    selectPartner('거래처 검색...');
    fireEvent.click(screen.getByRole('button', { name: 'taebaek 품목 삭제' }));
    view.rerender(<ReceivingReturnsManager {...props('taebaek')} />);
    expect(screen.queryByPlaceholderText('0')).toBeNull();
  });

  it('원전표 선택과 해제 뒤 빈 행을 자동 제안으로 덮지 않는다', () => {
    const loaded = props('taebaek');
    const source = { id: 's', companyId: 'taebaek', partnerId: 'taebaek-partner', type: '매출', tradeDate: '2026-10-15', docNo: '1', totalAmount: 100, items: [{ itemId: 'taebaek-item', name: '원전표 품목' }] } as any;
    const view = render(<ReceivingReturnsManager {...loaded} issuedStatements={[source]} />);
    selectPartner('거래처 검색...');
    fireEvent.change(screen.getByLabelText('원매출 전표'), { target: { value: 's' } });
    view.rerender(<ReceivingReturnsManager {...props('taebaek')} issuedStatements={[source]} />);
    expect(screen.getByText('원전표 품목')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('원매출 전표'), { target: { value: '' } });
    view.rerender(<ReceivingReturnsManager {...props('taebaek')} issuedStatements={[source]} />);
    expect(screen.queryByPlaceholderText('0')).toBeNull();
  });

  it('품목이 오기 전에 작성한 비고는 자동 행 생성을 멈춘다', () => {
    const loaded = props('taebaek');
    const view = render(<ReceivingReturnsManager {...loaded} items={[]} partnerItems={[]} />);
    selectPartner('거래처 검색...');
    fireEvent.change(screen.getByPlaceholderText('반품 관련 메모 (선택)'), { target: { value: '수동 초안' } });
    view.rerender(<ReceivingReturnsManager {...loaded} />);
    expect(screen.queryByPlaceholderText('0')).toBeNull();
  });

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
    fireEvent.click(screen.getByRole('button', { name: /^반품하기$/ }));
    selectPartner('공급처 검색...');
    fireEvent.change(screen.getByPlaceholderText('+ 품목 검색하여 추가...'), { target: { value: 'taebaek' } });
    fireEvent.mouseDown(screen.getByRole('button', { name: 'taebaek 품목' }));
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '4' } });
    fireEvent.change(screen.getByPlaceholderText('반품 사유, 메모 (선택)'), { target: { value: '보내기 초안' } });
    view.rerender(<ReceivingReturnsManager {...props('taebaek')} />);
    expect((screen.getByPlaceholderText('0') as HTMLInputElement).value).toBe('4');
    view.rerender(<ReceivingReturnsManager {...props('punghoe')} />);
    fireEvent.click(screen.getByRole('button', { name: /^반품하기$/ }));
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
    expect(screen.queryByRole('button', { name: /^이력$/ })).toBeNull();
    act(() => mock.listeners[1].callback([{ id: 'new', partnerName: '현재 회사 반품', items: [], totalAmount: 0, status: 'pending', createdAt: new Date().toISOString() } as unknown as ReturnRequest]));
    expect(screen.getByRole('button', { name: /반품받기/ }).textContent).toContain('1');
    act(() => old.callback([{ id: 'old', partnerName: '옛 회사 반품', items: [], totalAmount: 0, status: 'pending', createdAt: new Date().toISOString() } as unknown as ReturnRequest]));
    expect(screen.queryByText('옛 회사 반품')).toBeNull();
    expect(screen.getByRole('button', { name: /반품받기/ }).textContent).toContain('1');
    expect(mock.command).not.toHaveBeenCalled();
  });
});
