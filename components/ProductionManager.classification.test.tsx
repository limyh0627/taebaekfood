/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Item } from '../types';
import ProductionManager from './ProductionManager';
it('생산 제목 뒤 행동과 조회를 두고 직접 입력 폼을 열어도 검색값과 writer는 유지한다',()=>{
 const add=vi.fn();render(<ProductionManager records={[]} orders={[]} items={[]} onAdd={add} onDelete={vi.fn()} onUpdate={vi.fn()}/>);
 const heading=screen.getByRole('heading',{name:'생산 실적'}),direct=screen.getByRole('button',{name:'직접 입력'}),search=screen.getByPlaceholderText('품목명/메모 검색');
 expect(heading.compareDocumentPosition(direct)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(direct.compareDocumentPosition(search)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(direct).toHaveClass('h-9');expect(search).toHaveClass('h-10');
 expect(screen.getByRole('region',{name:'검색조건'})).toContainElement(search);expect(screen.getByLabelText('전체 검색')).toBe(search);expect(screen.getByLabelText('품목')).toHaveClass('h-10');
 fireEvent.change(search,{target:{value:'검수 검색'}});fireEvent.click(direct);expect(screen.getByRole('heading',{name:'신규 생산 실적'})).toBeInTheDocument();expect(search).toHaveValue('검수 검색');expect(add).not.toHaveBeenCalled();
});

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
