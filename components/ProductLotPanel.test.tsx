/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import ProductLotPanel from './ProductLotPanel';
import type { Item } from '../types';

it('완제품 로트는 환산 kg가 있어도 남은 개수로 보여준다', () => {
  render(<ProductLotPanel material="참기름" items={[{
    id: 'can', name: '참기름 캔', type: 'wip', unit: '개',
    lots: [{ id: 'lot-1', status: 'active', qtyRemaining: 15, kgRemaining: 247.5 }],
  } as Item]} />);
  expect(screen.getByText(/15 개/)).toBeTruthy();
  expect(screen.getByText('15')).toBeTruthy();
  expect(screen.queryByText(/247\.5 kg/)).toBeNull();
});
