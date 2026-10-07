/** @vitest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import RawLedgerList from './RawLedgerList';
import { orderLinesUsingRaw } from '../src/shared/rawUsers';
import type { Item, Order, RawMaterialEntry } from '../src/shared/types';

// 원장/주문/품목 배열은 같은 참조로 두고 배합식에서 파생된 콜백만 갱신한다.
const items = [
  { id: 'a', name: '배합품A', type: 'product' },
  { id: 'b', name: '배합품B', type: 'product' },
] as Item[];
const orders = [{ id: 'order', partnerName: '시험거래처', items: [
  { itemId: 'a', name: '배합품A', quantity: 1 },
  { itemId: 'b', name: '배합품B', quantity: 1 },
] }] as Order[];
const entries = [{ id: 'entry', material: '참깨', date: '2026-10-07',
  type: 'auto', used: 1, orderId: 'order', note: '자동: 시험거래처' }] as RawMaterialEntry[];
const linesUsing = (name: string) => (order: Order, material: string) => orderLinesUsingRaw(order.items, material, {
  allItems: items, bomOf: () => [], baseRawName: value => value,
  buildFormula: key => key === name ? [{ raw: '참깨' }] : [],
});

it('배합식만 갱신되면 같은 원장/주문 참조에서도 최신 사용 품목을 표시한다', () => {
  const first = linesUsing('배합품A');
  const next = linesUsing('배합품B');
  expect(first(orders[0], '참깨')?.[0].itemId).toBe('a');
  expect(next(orders[0], '참깨')?.[0].itemId).toBe('b');
  const view = render(<RawLedgerList entries={entries} orders={orders} linesUsingRaw={first} />);
  expect(screen.getByText('시험거래처 · 배합품A')).toBeInTheDocument();
  view.rerender(<RawLedgerList entries={entries} orders={orders} linesUsingRaw={next} />);
  expect(screen.queryByText('시험거래처 · 배합품A')).not.toBeInTheDocument();
  expect(screen.getByText('시험거래처 · 배합품B')).toBeInTheDocument();
});
