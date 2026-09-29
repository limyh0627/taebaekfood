/** @vitest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RawLedgerList from './RawLedgerList';
import type { ItemInventoryEntry } from '../src/features/admin/itemLedger';

const unpack = { id: 'unpack-1', material: '통깨참기름', rawItemId: 'bulk', date: '2026-09-02',
  createdAt: '2026-09-02T01:00:00Z', kind: 'unpack', source: { type: 'unpack', id: 'can' },
  received: 0, used: 0, unit: 'kg', canCount: 1, appliedDeltaKg: 16.5, note: '공급처 캔 개봉',
} as ItemInventoryEntry;

describe('입출고 기록의 실제 재고 읽기 모드', () => {
  it('기본 서류 모드는 개봉 입고 0을 보존하며 실제모드만 캔 -1개·벌크 +16.5kg를 한 번 표시한다', () => {
    const before = JSON.stringify(unpack);
    const view = render(<RawLedgerList entries={[unpack]} />);
    expect(screen.queryByText('+16.5')).toBeNull();
    expect(screen.queryByText('16.5kg')).toBeNull();
    view.unmount();
    render(<RawLedgerList stockMovements entries={[unpack]} allEntries={[unpack]} />);
    expect(screen.getAllByText('+18.013')).toHaveLength(1);
    expect(screen.getByText('18.013L')).toBeTruthy();
    expect(screen.queryByText('16.5kg')).toBeNull();
    expect(screen.getAllByText(/캔 -1개 → 벌크 \+16.5kg/)).toHaveLength(1);
    expect(JSON.stringify(unpack)).toBe(before);
  });

  it('합치기는 새 입고·사용이 아닌 0kg 사건이고 원본 재고량을 바꾸지 않는다', () => {
    const merge = { ...unpack, id: 'merge', date: '2026-09-03', kind: 'merge-lots', type: 'correction',
      source: { type: 'manual', id: 'merge' }, appliedDeltaKg: 0, note: '로트 두 개 통합' } as ItemInventoryEntry;
    const before = JSON.stringify([unpack, merge]);
    render(<RawLedgerList stockMovements entries={[unpack, merge]} />);
    expect(screen.getByText(/로트 합치기 · 재고 증감 0kg/)).toBeTruthy();
    expect(screen.getAllByText('+18.013')).toHaveLength(1);
    // 두 행의 잔량과 합치기 직전재고가 같은 값이다. 증가는 입고 칸에 한 번뿐이다.
    expect(screen.getAllByText('18.013L')).toHaveLength(3);
    expect(screen.queryByText('36.026L')).toBeNull();
    expect(JSON.stringify([unpack, merge])).toBe(before);
  });

  it('고체 원료는 실제 기록 모드에서도 kg 표시와 소수 수량을 유지한다', () => {
    render(<RawLedgerList stockMovements entries={[{ ...unpack, material: '참깨' }]} />);
    expect(screen.getByText('+16.5')).toBeTruthy();
    expect(screen.getByText('16.5kg')).toBeTruthy();
  });
});
