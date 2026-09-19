/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LotTimeline from './LotTimeline';
import type { Item, RawMaterialEntry } from '../src/shared/types';

const item = {
  id: 'raw-a', name: '볶음참깨', type: 'raw', unit: 'kg', stock: 10, minStock: 0, price: 0, image: '',
  lots: [{ id: 'lot-a', supplierName: '가게', receivedDate: '2026-09-01', kgIn: 10, kgRemaining: 10, status: 'active', createdAt: '2026-09-01T09:00:00+09:00' }],
} as Item;

const entry = (n: number, lotId = 'lot-a') => ({
  id: `e-${n}`, date: `2026-09-${String(n).padStart(2, '0')}`,
  recordedAt: `2026-09-${String(n).padStart(2, '0')}T09:00:00+09:00`,
  note: `기록-${n}`, received: 1, used: 0,
  lotChanges: [{ lotId, deltaKg: 1, beforeKg: n - 1, afterKg: n }],
} as unknown as RawMaterialEntry);

describe('로트 상세 타임라인', () => {
  it('선택한 로트의 이력만 최신 5건을 보이고 나머지는 펼친다', () => {
    render(<LotTimeline item={item} lotId="lot-a"
      rawEntries={[...Array.from({ length: 7 }, (_, i) => entry(i + 1)), entry(8, '다른-로트')]} />);

    expect(screen.getByText(/기록-7/)).toBeTruthy();
    expect(screen.getByText(/기록-3/)).toBeTruthy();
    expect(screen.queryByText(/기록-2/)).toBeNull();
    expect(screen.queryByText(/기록-8/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '나머지 2개 펼쳐 보기' }));
    expect(screen.getByText(/기록-2/)).toBeTruthy();
    expect(screen.getByText(/기록-1/)).toBeTruthy();
    expect(screen.queryByText(/기록-8/)).toBeNull();
  });
});
