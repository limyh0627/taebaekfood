/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import ItemLedger from './ItemLedger';
import type { Item } from '../src/shared/types';
import type { ItemInventoryEntry } from '../src/features/admin/itemLedger';

it('제품별원장의 캔·벌크 선택 모두 같은 개봉 원본을 넘겨 개수/kg를 구분한다', () => {
  const items = [
    { id: 'can', name: '깨분참기름-캔', subtype: '캔', type: 'semi', unit: '개', stock: 2 },
    { id: 'bulk', name: '깨분참기름', subtype: '벌크', type: 'semi', unit: 'kg', stock: 16.5 },
  ] as Item[];
  const entry = { id: 'unpack', rawItemId: 'bulk', material: '깨분참기름', kind: 'unpack',
    source: { type: 'unpack', id: 'can' }, date: '2026-09-02', createdAt: '2026-09-02T01:00:00Z',
    received: 0, used: 0, canCount: 1, appliedDeltaKg: 16.5, note: '1캔 개봉', unit: 'kg',
  } as ItemInventoryEntry;
  render(<ItemLedger items={items} orders={[]} rawEntries={[entry]} companyId="taebaek" />);
  fireEvent.click(screen.getByRole('button', { name: /깨분참기름-캔/ }));
  expect(screen.getByText('캔 개봉')).toBeTruthy();
  expect(screen.getByText('-1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^깨분참기름(?!-캔)/ }));
  expect(screen.getByText('+18.013')).toBeTruthy();
  expect(screen.getByText('현재 18.013L')).toBeTruthy();
  expect(screen.getByText('18.013L')).toBeTruthy();
  expect(screen.getByText(/캔 -1개 → 벌크 \+16.5kg/)).toBeTruthy();
});
