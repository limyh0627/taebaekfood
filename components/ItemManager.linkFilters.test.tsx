/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ItemManager from './ItemManager';
import type { Item, Partner } from '../types';

vi.mock('../src/shared/services/firebaseService', () => ({ fetchCollection: vi.fn().mockResolvedValue([]) }));

const items = [
  { id: 'a', name: '참기름', type: 'product', subtype: '낱개 ', category: '기름 ', spec: '350ml ' },
  { id: 'b', name: '참기름', type: 'product', subtype: '낱개', category: '기름', spec: '1750ml' },
  { id: 'c', name: '들기름', type: 'product', subtype: '벌크', category: '기름', spec: '350ml' },
] as Item[];
const partners = [
  { id: 'p1', name: '첫 거래처', type: '일반' },
  { id: 'p2', name: '다음 거래처', type: '일반' },
] as Partner[];

afterEach(() => { document.body.innerHTML = ''; });

it('조합 필터, 공백 있는 값, 이름/규격 검색, 초기화, 0건과 재오픈을 처리한다', () => {
  const onLinkItem = vi.fn();
  render(<ItemManager companyId="taebaek" items={items} partners={partners}
    onEditProduct={vi.fn()} onAddItem={vi.fn()} onDeleteItem={vi.fn()}
    onLinkItem={onLinkItem} onUnlinkItem={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '거래처별 품목' }));
  fireEvent.click(screen.getByRole('button', { name: /첫 거래처/ }));
  fireEvent.click(screen.getAllByRole('button', { name: '품목 연결' })[0]);
  let dialog = screen.getByRole('dialog', { name: '품목 연결' });
  expect(within(dialog).getByRole('status').textContent).toContain('3개');
  fireEvent.change(within(dialog).getByRole('combobox', { name: '서브타입' }), { target: { value: '낱개' } });
  fireEvent.change(within(dialog).getByRole('combobox', { name: '카테고리' }), { target: { value: '기름' } });
  fireEvent.change(within(dialog).getByRole('combobox', { name: '규격' }), { target: { value: '350ml' } });
  expect(within(dialog).getByRole('status').textContent).toContain('1개');
  fireEvent.click(within(dialog).getByRole('button', { name: '연결' }));
  expect(onLinkItem).toHaveBeenCalledWith('a', 'p1');
  fireEvent.change(within(dialog).getByPlaceholderText('품목명·규격 검색...'), { target: { value: '없는품목' } });
  expect(within(dialog).getByText(/현재 조건에 맞는/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '조건 초기화' }));
  expect(within(dialog).getByRole('status').textContent).toContain('3개');
  fireEvent.change(within(dialog).getByPlaceholderText('품목명·규격 검색...'), { target: { value: '1750ml' } });
  expect(within(dialog).getByRole('status').textContent).toContain('1개');
  fireEvent.click(within(dialog).getByRole('button', { name: '품목 연결 닫기' }));
  fireEvent.click(screen.getAllByRole('button', { name: '품목 연결' })[0]);
  dialog = screen.getByRole('dialog', { name: '품목 연결' });
  expect(within(dialog).getByRole('status').textContent).toContain('3개');
});
