import { describe, it, expect } from 'vitest';
import { deductFromLots, pruneDepletedLots, withCarryOverLot, settleCarryOver } from './lotUtils';
import type { RawMaterialLot } from './types';

const lot = (id: string, kg: number, date = '2026-01-01'): RawMaterialLot =>
  ({ id, supplierName: id, qtyIn: 0, kgIn: kg, kgRemaining: kg, receivedDate: date, status: 'active', createdAt: '' } as RawMaterialLot);

describe('deductFromLots — 선입선출(FIFO)', () => {
  it('앞 로트부터 소진, 다음 로트에서 나머지', () => {
    const r = deductFromLots([lot('a', 100), lot('b', 50)], 120);
    expect(r.shortageKg).toBe(0);
    expect(r.lots[0].kgRemaining).toBe(0);
    expect(r.lots[0].status).toBe('depleted');
    expect(r.lots[1].kgRemaining).toBe(30);
    expect(r.distribution).toEqual([
      expect.objectContaining({ lotId: 'a', kg: 100 }),
      expect.objectContaining({ lotId: 'b', kg: 20 }),
    ]);
  });

  it('잔량보다 많이 쓰면 실제 로트는 0 소진, 초과분은 이월(미상) 버킷이 음수로 흡수', () => {
    const r = deductFromLots([lot('a', 100)], 150);
    expect(r.shortageKg).toBe(50);
    expect(r.lots[0].kgRemaining).toBe(0);
    expect(r.lots[0].status).toBe('depleted');
    const carry = r.lots.find(l => l.supplierName === '이월');
    expect(carry?.kgRemaining).toBe(-50);
    expect(carry?.status).toBe('active');
    // 분배(distribution)에도 이월 흡수분 포함 → 스냅샷/복원 가능
    expect(r.distribution).toContainEqual(expect.objectContaining({ supplierName: '이월', kg: 50 }));
  });

  it('혼합(mix): 상위 2개 로트에 비율 배분', () => {
    const r = deductFromLots([lot('a', 100), lot('b', 100)], 60, { topPercent: 50 });
    expect(r.lots[0].kgRemaining).toBe(70); // 30 사용
    expect(r.lots[1].kgRemaining).toBe(70); // 30 사용
  });
});

describe('settleCarryOver — 음수 이월을 입고로 상쇄', () => {
  it('입고가 음수 이월보다 크면 이월 0(소진), 남은 만큼 가용', () => {
    const drained = deductFromLots([lot('a', 100)], 150).lots; // a:0(depleted), 이월:-50
    const settled = settleCarryOver([...drained, lot('b', 80, '2026-02-01')]);
    const carry = settled.find(l => l.supplierName === '이월');
    const b = settled.find(l => l.id === 'b');
    expect(carry?.kgRemaining).toBe(0);
    expect(carry?.status).toBe('depleted');
    expect(b?.kgRemaining).toBe(30); // 80 - 50
  });
  it('입고가 음수 이월보다 작으면 이월에 부족분 남음', () => {
    const drained = deductFromLots([lot('a', 100)], 150).lots; // 이월 -50
    const settled = settleCarryOver([...drained, lot('c', 20, '2026-02-01')]);
    const carry = settled.find(l => l.supplierName === '이월');
    const c = settled.find(l => l.id === 'c');
    expect(carry?.kgRemaining).toBe(-30); // -50 + 20
    expect(c?.kgRemaining).toBe(0);
    expect(c?.status).toBe('depleted');
  });
  it('음수 이월 없으면 원본 그대로 반환', () => {
    const lots = [lot('a', 50)];
    expect(settleCarryOver(lots)).toBe(lots);
  });
});

describe('withCarryOverLot — 로트 없는데 재고>0이면 이월 로트로 보존', () => {
  it('로트 없으면 이월 로트 생성', () => {
    const out = withCarryOverLot([], 10, '참깨');
    expect(out).toHaveLength(1);
    expect(out[0].kgRemaining).toBe(10);
    expect(out[0].supplierName).toBe('이월');
  });
  it('로트 있으면 그대로', () => {
    const existing = [lot('a', 5)];
    expect(withCarryOverLot(existing, 10, '참깨')).toBe(existing);
  });
  it('재고 0이면 생성 안 함', () => {
    expect(withCarryOverLot([], 0, '참깨')).toHaveLength(0);
  });
});

describe('pruneDepletedLots — 오래된 소진 로트만 정리', () => {
  const today = new Date().toISOString().slice(0, 10);
  it('active·최근 소진은 보존, 6개월 지난 소진만 제거', () => {
    const active = { ...lot('z', 50, '2020-01-01') }; // active
    const oldDepleted = { ...lot('x', 0, '2020-01-01'), status: 'depleted' } as RawMaterialLot;
    const recentDepleted = { ...lot('y', 0, today), status: 'depleted' } as RawMaterialLot;
    const kept = pruneDepletedLots([active, oldDepleted, recentDepleted]);
    const ids = kept.map(l => l.id);
    expect(ids).toContain('z');
    expect(ids).toContain('y');
    expect(ids).not.toContain('x');
  });
});
