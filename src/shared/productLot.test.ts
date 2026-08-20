import { describe, it, expect } from 'vitest';
import {
  buildProductLot, withCarryOverProductLot, deductLotsByQty, restoreLotsByQty,
  lotQtyRemaining, lotsByMaterial,
} from './lotUtils';
import type { RawMaterialLot } from './types';

/**
 * 완제품(박스) 로트 — 개수로 세는 재고의 이력추적.
 *
 * 규칙 한 줄: **재고는 품목별로 나누고, 이력은 material로 묶는다.**
 * 박스 로트를 벌크 홀더에 몰아넣으면 재고가 두 번 잡히고 FIFO가 엉키므로,
 * 로트는 재고를 들고 있는 품목에 붙이고 조회만 물질 축으로 가로지른다.
 */

const box = (qty: number, lotNo: string, unitKg = 20) =>
  buildProductLot({ material: '볶음참깨', itemId: 'box20', supplierName: '푸미푸드', qtyIn: qty, unitKg, receivedDate: '2026-08-25', lotNo });

describe('박스 로트 — 만들기', () => {
  it('개수와 kg을 함께 들고 있다 — 수불부가 kg으로 도니까', () => {
    const l = box(15, '260825-01');
    expect(l.qtyIn).toBe(15);
    expect(l.qtyRemaining).toBe(15);
    expect(l.kgIn).toBe(300);          // 15박스 × 20kg
    expect(l.kgRemaining).toBe(300);
    expect(l.material).toBe('볶음참깨');  // 물질 축 — 벌크 홀더와 같은 값
  });

  it('로트를 안 쓰던 재고는 이월 로트로 보존된다 — 안 하면 첫 출고부터 전부 미상이 된다', () => {
    const carried = withCarryOverProductLot([], 15, '볶음참깨', 20);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ supplierName: '이월', qtyRemaining: 15, kgRemaining: 300 });
    // 이미 로트가 있으면 다시 안 만든다(중복 이월 방지)
    expect(withCarryOverProductLot(carried, 15, '볶음참깨', 20)).toBe(carried);
  });
});

describe('박스 로트 — 출고 차감', () => {
  it('앞 로트부터 깐다(FIFO) — 어느 로트가 나갔는지 남는다', () => {
    const lots = [box(10, '260820-01'), box(15, '260825-01')];
    const r = deductLotsByQty(lots, 12);
    expect(r.shortageQty).toBe(0);
    expect(r.lots[0]).toMatchObject({ qtyRemaining: 0, kgRemaining: 0, status: 'depleted' });
    expect(r.lots[1]).toMatchObject({ qtyRemaining: 13, kgRemaining: 260 });
    expect(r.distribution.map(d => [d.lotNo, d.qty])).toEqual([['260820-01', 10], ['260825-01', 2]]);
  });

  it('재고보다 많이 나가면 이월(미상)이 음수로 받는다 — 조용히 0에서 멈추지 않는다', () => {
    const r = deductLotsByQty([box(5, '260825-01')], 8);
    expect(r.shortageQty).toBe(3);
    const carry = r.lots.find(l => l.supplierName === '이월')!;
    expect(carry.qtyRemaining).toBe(-3);
    // 합계가 실제 출고량을 그대로 따라간다 — 로트 합 5 − 8 = −3
    expect(lotQtyRemaining(r.lots)).toBe(-3);
  });

  it('0개 출고는 아무것도 안 건드린다', () => {
    const lots = [box(5, '260825-01')];
    const r = deductLotsByQty(lots, 0);
    expect(r.distribution).toHaveLength(0);
    expect(lotQtyRemaining(r.lots)).toBe(5);
  });
});

describe('박스 로트 — 출고취소', () => {
  it('그때 깐 로트에 스냅샷대로 되돌린다', () => {
    const lots = [box(10, '260820-01'), box(15, '260825-01')];
    const shipped = deductLotsByQty(lots, 12);
    const back = restoreLotsByQty(shipped.lots, shipped.distribution);
    expect(back[0]).toMatchObject({ qtyRemaining: 10, kgRemaining: 200, status: 'active' });
    expect(back[1]).toMatchObject({ qtyRemaining: 15, kgRemaining: 300 });
  });

  it('출고 뒤에 새 로트가 들어와도 엉뚱한 데 얹지 않는다 — 역FIFO가 아니라 스냅샷이라서', () => {
    const lots = [box(10, '260820-01')];
    const shipped = deductLotsByQty(lots, 10);
    const withNew = [...shipped.lots, box(20, '260901-01')];   // 그새 새 로트 입고
    const back = restoreLotsByQty(withNew, shipped.distribution);
    expect(back.find(l => l.lotNo === '260820-01')!.qtyRemaining).toBe(10);
    expect(back.find(l => l.lotNo === '260901-01')!.qtyRemaining).toBe(20);   // 안 건드림
  });

  it('그새 정리된 로트는 건너뛴다', () => {
    const back = restoreLotsByQty([box(5, '260825-01')], [{ lotId: '없는로트', supplierName: '', qty: 3 }]);
    expect(lotQtyRemaining(back)).toBe(5);
  });
});

describe('물질 축으로 묶어 보기', () => {
  it('벌크와 박스가 다른 품목에 있어도 볶음참깨 한 줄로 모인다', () => {
    const bulkLot = { id: 'l1', material: '볶음참깨', supplierName: '실사', kgIn: 10, kgRemaining: 10, receivedDate: '2026-08-12', status: 'active', createdAt: '' } as RawMaterialLot;
    const items = [
      { id: 'raw-볶음참깨', name: '볶음참깨', unit: 'kg', lots: [bulkLot] },
      { id: 'box20', name: '볶음참깨/1kg', unit: '박스', lots: [box(15, '260825-01')] },
      { id: 'box10', name: '볶음참깨/1kg', unit: '박스', lots: [box(8, '260825-02', 10)] },
      { id: 'oil', name: '참기름/300ml', unit: '개', lots: [] },
    ];
    const map = lotsByMaterial(items, n => n);
    const rows = map.get('볶음참깨')!;
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.itemId)).toEqual(['raw-볶음참깨', 'box20', 'box10']);
    // 벌크 10kg + 박스 300kg + 80kg
    expect(rows.reduce((s, r) => s + (r.lot.kgRemaining ?? 0), 0)).toBe(390);
  });

  it('material이 없는 옛 로트는 품목 이름으로 메운다', () => {
    const old = { id: 'l0', supplierName: '이월', kgIn: 5, kgRemaining: 5, receivedDate: '', status: 'active', createdAt: '' } as RawMaterialLot;
    const map = lotsByMaterial([{ id: 'raw-참깨', name: '참깨', lots: [old] }], n => n);
    expect(map.get('참깨')).toHaveLength(1);
  });
});
