/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LotTimeline from './LotTimeline';
import type { Item, RawMaterialEntry } from '../src/shared/types';

const item = {
  id: 'raw-a', name: '볶음참깨', type: 'raw', subtype: '벌크', unit: 'kg', stock: 10, minStock: 0, price: 0, image: '',
  lots: [{ id: 'lot-a', supplierName: '가게', receivedDate: '2026-09-01', kgIn: 10, kgRemaining: 10, status: 'active', createdAt: '2026-09-01T09:00:00+09:00' }],
} as Item;

const entry = (n: number, lotId = 'lot-a') => ({
  id: `e-${n}`, date: `2026-09-${String(n).padStart(2, '0')}`,
  recordedAt: `2026-09-${String(n).padStart(2, '0')}T09:00:00+09:00`,
  note: `기록-${n}`, received: 1, used: 0,
  lotChanges: [{ lotId, deltaKg: 1, beforeKg: n - 1, afterKg: n }],
} as unknown as RawMaterialEntry);

describe('로트 상세 타임라인', () => {
  it('원료 로트 입고는 포 개수가 아니라 kgIn을 kg로 표시하고, 완제품은 개수를 표시한다', () => {
    const rawItem = { ...item, lots: [{ ...item.lots![0], qtyIn: 2.5, packageKg: 20, kgIn: 50, kgRemaining: 30 }] } as Item;
    const rawView = render(<LotTimeline item={rawItem} lotId="lot-a" />);
    expect(screen.getByText('+50 kg')).toBeTruthy();
    expect(screen.queryByText('+2.5 kg')).toBeNull();
    rawView.unmount();

    const product = { ...item, type: 'goods', subtype: '낱개', unit: '개', lots: [{ ...item.lots![0], qtyIn: 12, kgIn: 6 }] } as Item;
    render(<LotTimeline item={product} lotId="lot-a" />);
    expect(screen.getByText('+12 개')).toBeTruthy();
  });

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

  it('화면에 표시하는 기록시각으로 정렬하고 정정은 사용이 아니라 재고 정정으로 표시한다', () => {
    const rows = [
      { ...entry(17), id: 'late-business', date: '2026-09-17', recordedAt: '2026-09-13T14:20:00+09:00', note: '늦게 표시되면 안 됨' },
      { ...entry(13), id: 'new-record', date: '2026-09-13', recordedAt: '2026-09-17T08:00:00+09:00', note: '먼저 표시', type: 'correction', kind: 'adjust-lot' },
    ] as unknown as RawMaterialEntry[];
    const { container } = render(<LotTimeline item={item} lotId="lot-a" rawEntries={rows} />);

    expect(container.textContent!.indexOf('먼저 표시')).toBeLessThan(container.textContent!.indexOf('늦게 표시되면 안 됨'));
    expect(screen.getByText('재고 정정')).toBeTruthy();
    expect(screen.getByText(/기록 2026-09-13 14:20 · 업무일 2026-09-17/)).toBeTruthy();
    expect(screen.getAllByText(/기록 직후 로트 잔량/)).toHaveLength(2);
  });

  it('같은 기록시각에는 적용 순번대로 보이고, 잔량 스냅샷이 없는 줄에 0kg을 꾸며내지 않는다', () => {
    const rows = [
      { ...entry(13), id: 'first', recordedAt: '2026-09-13T01:00:00Z', sequence: 1, note: '첫 적용' },
      { ...entry(13), id: 'second', recordedAt: '2026-09-13T10:00:00+09:00', sequence: 2, note: '둘째 적용',
        lotChanges: [{ lotId: 'lot-a', deltaKg: -1 }] },
    ] as unknown as RawMaterialEntry[];
    const { container } = render(<LotTimeline item={item} lotId="lot-a" rawEntries={rows} />);

    expect(container.textContent!.indexOf('둘째 적용')).toBeLessThan(container.textContent!.indexOf('첫 적용'));
    expect(screen.getAllByText(/기록 2026-09-13 10:00 · 업무일 2026-09-13/)).toHaveLength(2);
    expect(screen.getAllByText(/기록 직후 로트 잔량/)).toHaveLength(1);
  });
});
