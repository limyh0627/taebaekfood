import { describe, it, expect } from 'vitest';
import { journalizeInventory } from './autoJournal';

const snaps = [
  { id: 's6', yearMonth: '2026-06', value: 147_083_582 },
  { id: 's7', yearMonth: '2026-07', value: 169_620_237 },
  { id: 's8', yearMonth: '2026-08', value: 189_759_253 },
];

describe('journalizeInventory (월말 재고 조정)', () => {
  it('재고가 늘면 (차)재고자산 / (대)원료매입 — 안 팔린 만큼 원가에서 뺀다', () => {
    const out = journalizeInventory(snaps, 169_620_237, '2026-07');
    expect(out).toHaveLength(1);                       // 기초월 이하는 건너뜀
    expect(out[0].date).toBe('2026-08-31');
    expect(out[0].lines).toEqual([
      { accountCode: '146', debit: 20_139_016, credit: 0 },
      { accountCode: '500', debit: 0, credit: 20_139_016 },
    ]);
  });

  it('재고가 줄면 방향이 뒤집힌다', () => {
    const out = journalizeInventory(
      [{ yearMonth: '2026-08', value: 100_000_000 }], 120_000_000, '2026-07');
    expect(out[0].lines).toEqual([
      { accountCode: '500', debit: 20_000_000, credit: 0 },
      { accountCode: '146', debit: 0, credit: 20_000_000 },
    ]);
  });

  it('차변 합계와 대변 합계는 언제나 같다', () => {
    for (const e of journalizeInventory(snaps, 0)) {
      const d = e.lines.reduce((a, l) => a + l.debit, 0);
      const c = e.lines.reduce((a, l) => a + l.credit, 0);
      expect(d).toBe(c);
    }
  });

  it('직전 실사액과 같으면 분개를 안 만든다', () => {
    expect(journalizeInventory([{ yearMonth: '2026-08', value: 500 }], 500, '2026-07')).toHaveLength(0);
  });

  it('기초월 이전 스냅샷은 기준선만 옮기고 분개는 안 만든다', () => {
    const out = journalizeInventory(snaps, 0, '2026-07');
    expect(out.map(e => e.date)).toEqual(['2026-08-31']);
  });

  it('월 마지막 날짜를 정확히 계산한다 (2월·30일 달)', () => {
    const out = journalizeInventory(
      [{ yearMonth: '2026-02', value: 100 }, { yearMonth: '2026-04', value: 200 }], 0);
    expect(out.map(e => e.date)).toEqual(['2026-02-28', '2026-04-30']);
  });
});
