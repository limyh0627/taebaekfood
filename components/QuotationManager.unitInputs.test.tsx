/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import QuotationManager from './QuotationManager';
import { buildBomIndex, getBomIndex, setBomIndex } from '../src/shared/bomIndex';
import { buildPackIndex } from '../src/shared/packIndex';
import type { Item, Partner, PartnerItem } from '../src/shared/types';
vi.mock('../src/shared/services/firebaseService', () => ({ subscribeToCollection: vi.fn(() => () => {}), addItem: vi.fn(), deleteItem: vi.fn() }));
const original = getBomIndex(); afterEach(() => setBomIndex(original));
const items = [{ id: 'box', name: '견적 박스', type: 'product', unit: '박스' }, { id: 'loose', name: '견적 낱개', type: 'product', unit: '병' }] as Item[];
const input = (count: number) => ({ bom: buildBomIndex(items, [{ parent_id: 'box', child_id: 'loose', quantity: count }]), pack: buildPackIndex([]) });
const partner = { id: 'client', name: '견적 거래처', type: '일반' } as Partner;
const prices = [{ id: 'price', itemId: 'loose', partnerId: 'client', Direction: 'out', price: 1000 }] as PartnerItem[];
const choose = (container: HTMLElement) => {
  const ui = within(container);
  fireEvent.click(ui.getByRole('button', { name: '견적서 작성' }));
  fireEvent.click(ui.getByRole('button', { name: '견적 거래처' }));
  fireEvent.click(ui.getByRole('button', { name: '1번째 줄 등록 품목에서 찾기' }));
  fireEvent.click(ui.getByRole('button', { name: /견적 박스/ }));
  return ui;
};
it('견적 실제 품목 선택의 박스 단가는 화면 회사 BOM으로 계산한다', () => {
  const a = input(20), b = input(6); setBomIndex(b.bom);
  const first = render(<QuotationManager items={items} partners={[partner]} partnerItems={prices} orderUnitInputs={a} />);
  expect(choose(first.container).getByDisplayValue('20000')).toBeInTheDocument();
  setBomIndex(a.bom);
  const second = render(<QuotationManager items={items} partners={[partner]} partnerItems={prices} orderUnitInputs={b} companyId="punghoe" />);
  expect(choose(second.container).getByDisplayValue('6000')).toBeInTheDocument();
  expect(getBomIndex()).toBe(a.bom);
});
it('등록된 양수 박스 단가가 우선이고 입력 생략은 기존 전역 fallback을 쓴다', () => {
  setBomIndex(input(6).bom);
  const direct = render(<QuotationManager items={items} partners={[partner]} partnerItems={[...prices, { id: 'direct', itemId: 'box', partnerId: 'client', Direction: 'out', price: 7777 } as PartnerItem]} orderUnitInputs={input(20)} />);
  expect(choose(direct.container).getByDisplayValue('7777')).toBeInTheDocument(); direct.unmount();
  const fallback = render(<QuotationManager items={items} partners={[partner]} partnerItems={prices} />);
  expect(choose(fallback.container).getByDisplayValue('6000')).toBeInTheDocument();
});
