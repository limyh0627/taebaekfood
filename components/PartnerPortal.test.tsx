/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import PartnerPortal from './PartnerPortal';
import type { Item, Partner, PartnerItem } from '../types';

it('품목 원본이 같아도 거래처 연결의 추가·삭제를 주문 목록에 반영한다', () => {
  const items = [{ id: 'p1', name: '연결 검수 품목', type: 'product', unit: '개' }] as Item[];
  const partners = [{ id: 'c1', name: '검수거래처', type: '일반' }] as Partner[];
  const props = { items, partners, onOrderSubmit: vi.fn(), onExit: vi.fn() };
  const links = [{ id: 'pi1', itemId: 'p1', partnerId: 'c1', Direction: 'out', price: 1000 }] as PartnerItem[];
  const view = render(<PartnerPortal {...props} partnerItems={[]} />);
  fireEvent.change(screen.getByPlaceholderText('거래처 코드 (ID)'), { target: { value: 'c1' } });
  fireEvent.click(screen.getByRole('button', { name: '입장하기' }));
  expect(screen.queryByText('연결 검수 품목')).not.toBeInTheDocument();
  view.rerender(<PartnerPortal {...props} partnerItems={links} />);
  expect(screen.getByText('연결 검수 품목')).toBeInTheDocument();
  view.rerender(<PartnerPortal {...props} partnerItems={[]} />);
  expect(screen.queryByText('연결 검수 품목')).not.toBeInTheDocument();
});

it('주문 저장이 실패하면 성공 화면으로 넘어가지 않고 다시 저장할 수 있다', async () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const onOrderSubmit = vi.fn().mockRejectedValueOnce(new Error('권한 거부')).mockResolvedValueOnce('order-1');
  render(<PartnerPortal
    partners={[{ id: 'c1', name: '검수거래처', type: '일반' } as Partner]}
    items={[{ id: 'p1', name: '검수품목', type: 'product', unit: '개' } as Item]}
    partnerItems={[{ id: 'pi1', itemId: 'p1', partnerId: 'c1', Direction: 'out', price: 1000 } as PartnerItem]}
    onOrderSubmit={onOrderSubmit} onExit={vi.fn()}
  />);
  fireEvent.change(screen.getByPlaceholderText('거래처 코드 (ID)'), { target: { value: 'c1' } });
  fireEvent.click(screen.getByRole('button', { name: '입장하기' }));
  const plus = screen.getAllByRole('button').find(button => button.querySelector('svg.lucide-plus'))!;
  fireEvent.click(plus);
  fireEvent.click(screen.getByRole('button', { name: /주문하기/ }));
  await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('권한 거부')));
  expect(screen.queryByText('주문이 접수되었습니다!')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /주문하기/ }));
  expect(await screen.findByText('주문이 접수되었습니다!')).toBeTruthy();
  expect(onOrderSubmit).toHaveBeenCalledTimes(2);
  alert.mockRestore();
});

it('주문 응답 대기 중 거래처 이동과 수량 변경을 막고 실패 초안을 유지한다', async () => {
  let reject!: (error: Error) => void;
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const submit = vi.fn(() => new Promise((_resolve, no) => { reject = no; }));
  render(<PartnerPortal partners={[{id:'c1',name:'검수거래처',type:'일반'} as Partner]} items={[{id:'p1',name:'검수품목',type:'product',unit:'개'} as Item]} partnerItems={[{id:'pi1',itemId:'p1',partnerId:'c1',Direction:'out',price:1000} as PartnerItem]} onOrderSubmit={submit} onExit={vi.fn()}/>);
  fireEvent.change(screen.getByPlaceholderText('거래처 코드 (ID)'),{target:{value:'c1'}});
  fireEvent.click(screen.getByRole('button',{name:'입장하기'}));
  const plus=screen.getAllByRole('button').find(button=>button.querySelector('svg.lucide-plus'))!;
  const close=screen.getAllByRole('button').find(button=>button.querySelector('svg.lucide-x'))!;
  fireEvent.click(plus); fireEvent.click(screen.getByRole('button',{name:/주문하기/}));
  expect(plus).toBeDisabled(); expect(close).toBeDisabled();
  reject(Error('응답 실패'));
  await waitFor(()=>expect(alert).toHaveBeenCalledWith(expect.stringContaining('응답 실패')));
  expect(screen.getByRole('button',{name:/1,000원 주문하기/})).toBeEnabled();
  alert.mockRestore();
});
