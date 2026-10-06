/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Item } from '../types';
import ProductionManager from './ProductionManager';

it('현재 품목 분류로 생산·반제품 선택을 제공하고 보관 품목은 제외한다', () => {
  const items = [
    { id: 'p', name: '현재 완제품', type: 'product' },
    { id: 'w', name: '현재 반제품', type: 'wip' },
    { id: 'a', name: '보관 완제품', type: 'product', archived: true },
    { id: 'r', name: '원료', type: 'raw' },
  ].map(item => ({ stock: 10, unit: '개', ...item })) as Item[];
  render(<ProductionManager records={[]} orders={[]} items={items}
    onAdd={vi.fn()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '직접 입력' }));
  const products = within(screen.getByRole('combobox', { name: '생산 품목' }));
  const wip = within(screen.getByRole('combobox', { name: '투입 반제품' }));
  expect(products.getByRole('option', { name: '현재 완제품' })).toBeTruthy();
  expect(wip.getByRole('option', { name: '현재 반제품' })).toBeTruthy();
  expect(products.queryByRole('option', { name: '보관 완제품' })).toBeNull();
  expect(products.queryByRole('option', { name: '원료' })).toBeNull();
  expect(wip.queryByRole('option', { name: '현재 완제품' })).toBeNull();
});
