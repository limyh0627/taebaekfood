import { describe, expect, it } from 'vitest';
import { applyLedgerRow, applyLedgerRowByBusinessDate, authoritativeLedgerBalanceKg } from './rawLedgerBalance';
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

  it('원장 현재고 계산은 원자화 줄의 balanceAfterKg를 확정값으로 사용한다', () => {
    expect(applyLedgerRow(882.699, row({ used: 10, balanceAfterKg: 924.254 }))).toBe(924.254);
  });

  it('문서 날짜순 입출고 표는 소급 기록의 처리 당시 잔량을 무시한다', () => {
    const rows = [
      row({ id: '09-14-stocktake', date: '2026-09-14', targetKg: -1320, type: 'correction' }),
      row({ id: '09-14-receive', date: '2026-09-14', received: 5400, balanceAfterKg: 4080 }),
      row({ id: '09-14-use', date: '2026-09-14', used: 540, balanceAfterKg: 3540 }),
      row({ id: '09-16-use', date: '2026-09-16', used: 540, balanceAfterKg: 5670 }),
      row({ id: '09-17-receive', date: '2026-09-17', received: 3000, balanceAfterKg: 8130 }),
      row({ id: '09-17-use', date: '2026-09-17', used: 540, balanceAfterKg: 5130 }),
      row({ id: '09-18-use', date: '2026-09-18', used: 840, balanceAfterKg: 4290 }),
      row({ id: '09-19-use', date: '2026-09-19', used: 540, balanceAfterKg: 3750 }),
      // 9/23에 뒤늦게 처리돼 저장된 스냅샷은 9/21의 날짜별 잔량이 아니다.
      row({ id: '09-21-use', date: '2026-09-21', used: 330, balanceAfterKg: 6210 }),
      row({ id: '09-23-receive', date: '2026-09-23', received: 3000, balanceAfterKg: 8550 }),
      row({ id: '09-23-use', date: '2026-09-23', used: 1200, balanceAfterKg: 5550 }),
    ];
    let balance = 0;
    const balances = rows.map(entry => (balance = applyLedgerRowByBusinessDate(balance, entry)));
    expect(balances).toEqual([-1320, 4080, 3540, 3000, 6000, 5460, 4620, 4080, 3750, 6750, 5550]);
  });
});
