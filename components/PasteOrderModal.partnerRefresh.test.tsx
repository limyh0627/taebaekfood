/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import PasteOrderModal from './PasteOrderModal';
import type { Item, Partner, PartnerItem } from '../src/shared/types';

const partner = { id: 'client', name: '원본 거래처', type: '일반', region: '옛 지역', shipTos: [{ id: 's1', name: '첫 배송지' }, { id: 's2', name: '선택 배송지' }] } as Partner;
const items = [{ id: 'product', name: '참깨', type: 'product', unit: '개' }] as Item[];
const partnerItems = [{ id: 'link', itemId: 'product', partnerId: 'client', Direction: 'out', price: 100 }] as PartnerItem[];
const props = { items, partnerItems, palletStocks: [], onClose: vi.fn() };
const choose = () => fireEvent.click(screen.getAllByRole('button', { name: /원본 거래처/ })[0]);
const paste = () => screen.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/);

it('같은 ID 원본의 배송지가 바뀌면 새 기본 배송지를 선택하고 붙여넣은 글은 보존한다', () => {
  const view = render(<PasteOrderModal {...props} partners={[partner]} onSave={vi.fn()} />); choose();
  fireEvent.change(paste(), { target: { value: '참깨 3개' } });
  view.rerender(<PasteOrderModal {...props} partners={[{ ...partner, shipTos: [{ id: 's3', name: '새 기본 배송지' }] }]} onSave={vi.fn()} />);
  expect(screen.getByRole('button', { name: /새 기본 배송지/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: /첫 배송지/ })).not.toBeInTheDocument();
  expect(paste()).toHaveValue('참깨 3개');
});
it('같은 ID 원본 변경은 유효 배송지 선택과 검토 수량·비고를 보존하며 최신 거래처로 저장한다', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const view = render(<PasteOrderModal {...props} partners={[partner]} onSave={onSave} />); choose();
  fireEvent.click(screen.getByRole('button', { name: /선택 배송지/ }));
  fireEvent.change(paste(), { target: { value: '참깨 3개' } }); fireEvent.click(screen.getByRole('button', { name: '분석하기' }));
  fireEvent.change(screen.getByLabelText('주문 비고'), { target: { value: '초안 보존' } });
  view.rerender(<PasteOrderModal {...props} partners={[{ ...partner, name: '최신 거래처', region: '새 지역', shipTos: [...partner.shipTos!, { id: 's3', name: '추가 배송지' }] }]} onSave={onSave} />);
  expect(screen.getByRole('button', { name: /선택 배송지/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: /주문 생성/ }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0]).toMatchObject({ partnerId: 'client', partnerName: '최신 거래처', region: '새 지역', shipToId: 's2', note: '초안 보존', items: [expect.objectContaining({ quantity: 3 })] });
});
it('선택한 거래처가 원본에서 삭제되면 이전 거래처로 주문을 저장하지 않는다', () => {
  const onSave = vi.fn();
  const view = render(<PasteOrderModal {...props} partners={[partner]} onSave={onSave} />); choose();
  fireEvent.change(paste(), { target: { value: '참깨 3개' } }); fireEvent.click(screen.getByRole('button', { name: '분석하기' }));
  view.rerender(<PasteOrderModal {...props} partners={[]} onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: /주문 생성/ }));
  expect(onSave).not.toHaveBeenCalled();
});
