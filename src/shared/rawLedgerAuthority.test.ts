import { describe, expect, it } from 'vitest';
import { applyLedgerRow, authoritativeLedgerBalanceKg } from './rawLedgerBalance';
import type { RawMaterialEntry } from './types';

const row = (over: Partial<RawMaterialEntry>): RawMaterialEntry => ({
  id: 'row', material: '깨분참기름', date: '2026-09-11', createdAt: '',
  received: 0, used: 0, note: '', ...over,
});

describe('원자화 원장 확정 잔량', () => {
  it('과거 줄의 날짜 재합산 대신 마지막 원자화 balanceAfterKg를 사용한다', () => {
    const rows = [
      row({ id: 'legacy', createdAt: '2026-09-11T05:00:00Z', used: 41.555 }),
      row({ id: 'atomic-1', recordedAt: '2026-09-11T08:00:00Z', sequence: 2, balanceAfterKg: 1511.061 }),
      row({ id: 'atomic-2', date: '2026-09-16', recordedAt: '2026-09-16T08:00:00Z', sequence: 20, balanceAfterKg: 924.254 }),
    ];
    expect(authoritativeLedgerBalanceKg(rows)).toBe(924.254);
  });

  it('원자화 줄이 없으면 기존 입출고 누적을 유지한다', () => {
    expect(authoritativeLedgerBalanceKg([row({ received: 100, used: 30 })])).toBe(70);
  });

  it('화면 누적도 원자화 줄의 balanceAfterKg를 확정값으로 사용한다', () => {
    expect(applyLedgerRow(882.699, row({ used: 10, balanceAfterKg: 924.254 }))).toBe(924.254);
  });
});
