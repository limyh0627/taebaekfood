/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, within, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PasteOrderModal from './PasteOrderModal';
import { buildBomIndex, getBomIndex, setBomIndex } from '../src/shared/bomIndex';
import { buildPackIndex, getPackIndex, setPackIndex } from '../src/shared/packIndex';
import type { OrderUnitInputs } from '../src/shared/orderUnits';
import type { Item, Order, Partner, PartnerItem } from '../src/shared/types';

const originalBom = getBomIndex(), originalPack = getPackIndex();
afterEach(() => { setBomIndex(originalBom); setPackIndex(originalPack); });
const partner = { id: 'client', name: '주문 거래처', type: '일반' } as Partner;
const makeInputs = (companyId: 'taebaek' | 'punghoe', count: number, pack: number) => {
  const items = [
    { id: 'box', name: '포장품', type: 'product', unit: '박스', companyId },
    { id: 'loose', name: '낱개품', type: 'product', unit: '병', companyId },
    { id: 'cap', name: `${companyId} 캡`, type: 'submaterial', category: '마개', unit: '개', companyId },
  ] as Item[];
  const inputs: OrderUnitInputs = { bom: buildBomIndex(items, [
    { parent_id: 'box', child_id: 'loose', quantity: count },
    { parent_id: 'box', child_id: 'cap', quantity: 1 },
  ]), pack: buildPackIndex([{ item_id: 'loose', units_per_box: pack }]) };
  return { items, inputs };
};
const prices = [{ id: 'price', itemId: 'loose', partnerId: 'client', Direction: 'out', price: 1000 },
  { id: 'box-price', itemId: 'box', partnerId: 'client', Direction: 'out', price: 0 }] as PartnerItem[];
const review = (container: HTMLElement) => {
  const ui = within(container);
  fireEvent.click(ui.getAllByRole('button', { name: /주문 거래처/ })[0]);
  fireEvent.change(ui.getByPlaceholderText(/주문 내용을 그대로 붙여넣으세요/), { target: { value: '포장품 2박스\n낱개품 2박스' } });
  fireEvent.click(ui.getByRole('button', { name: '분석하기' }));
  return ui;
};

it('두 회사의 부자재 표시와 실제 저장 가격·포장수량은 각 화면 입력을 사용한다', async () => {
  const a = makeInputs('taebaek', 20, 12), b = makeInputs('punghoe', 6, 4);
  setBomIndex(b.inputs.bom); setPackIndex(b.inputs.pack);
  const onSaveA = vi.fn(async (_order: Omit<Order, 'id' | 'status'>) => {}), onSaveB = vi.fn(async (_order: Omit<Order, 'id' | 'status'>) => {});
  const first = render(<PasteOrderModal items={a.items} partners={[partner]} partnerItems={prices} palletStocks={[]} orderUnitInputs={a.inputs} onClose={vi.fn()} onSave={onSaveA} />);
  const uiA = review(first.container);
  expect(uiA.getByText('taebaek 캡')).toBeInTheDocument();
  setBomIndex(a.inputs.bom); setPackIndex(a.inputs.pack);
  const second = render(<PasteOrderModal items={b.items} partners={[partner]} partnerItems={prices} palletStocks={[]} orderUnitInputs={b.inputs} onClose={vi.fn()} onSave={onSaveB} />);
  const uiB = review(second.container);
  expect(uiB.getByText('punghoe 캡')).toBeInTheDocument();
  fireEvent.click(uiA.getByRole('button', { name: /주문 생성/ }));
  fireEvent.click(uiB.getByRole('button', { name: /주문 생성/ }));
  await waitFor(() => { expect(onSaveA).toHaveBeenCalledTimes(1); expect(onSaveB).toHaveBeenCalledTimes(1); });
  expect(onSaveA.mock.calls[0][0]).toMatchObject({ totalAmount: 64000, items: [
    { itemId: 'box', quantity: 2, price: 20000 }, { itemId: 'loose', quantity: 24, price: 1000, unitsPerBox: 12, boxQuantity: 2 },
  ] });
  expect(onSaveB.mock.calls[0][0]).toMatchObject({ totalAmount: 20000, items: [
    { itemId: 'box', quantity: 2, price: 6000 }, { itemId: 'loose', quantity: 8, price: 1000, unitsPerBox: 4, boxQuantity: 2 },
  ] });
  expect(getBomIndex()).toBe(a.inputs.bom); expect(getPackIndex()).toBe(a.inputs.pack);
});

it('명시 입력이 없는 기존 호출은 전역 BOM과 포장표 fallback을 유지한다', async () => {
  const a = makeInputs('taebaek', 20, 12); setBomIndex(a.inputs.bom); setPackIndex(a.inputs.pack);
  const onSave = vi.fn(async (_order: Omit<Order, 'id' | 'status'>) => {});
  const view = render(<PasteOrderModal items={a.items} partners={[partner]} partnerItems={prices} palletStocks={[]} onClose={vi.fn()} onSave={onSave} />);
  const ui = review(view.container); expect(ui.getByText('taebaek 캡')).toBeInTheDocument();
  fireEvent.click(ui.getByRole('button', { name: /주문 생성/ }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0]).toMatchObject({ totalAmount: 64000 });
});
