import { describe, it, expect } from 'vitest';
import { anchorLotsByQty } from './lotAnchor';
import { lotQtyRemaining } from './lotUtils';
import type { RawMaterialLot } from './types';

const det = { id: 'anchor-1', createdAt: '2026-09-16T10:00:00.000Z', receivedDate: '2026-09-16' };

const 로트 = (o: Partial<RawMaterialLot> & { id: string; qtyRemaining: number }): RawMaterialLot => ({
  supplierName: '푸미푸드', unitKg: 1,
  qtyIn: o.qtyRemaining, kgIn: o.qtyRemaining, kgRemaining: o.qtyRemaining,
  receivedDate: '2026-08-28', status: 'active', createdAt: '2026-08-28T00:00:00Z',
  ...o,
} as RawMaterialLot);

describe('실사 — 로트를 실제 수량에 맞춘다', () => {
  it('**맞추고 나면 로트 합계 = 실제 수량**. 이게 전부다', () => {
    const r = anchorLotsByQty({ lots: [로트({ id: 'a', qtyRemaining: 48 })], targetQty: 30, det });
    expect(lotQtyRemaining(r.lots)).toBe(30);
  });

  it('**음수로 깔린 이월이 실사로 털린다** — 볶음참깨가 걸려 있던 자리', () => {
    //  운영: 볶음참깨/1kg 은 stock 39 인데 이월 로트가 −7박스였다.
    //  로트를 맞출 길이 없어서 몇 번을 고쳐도 stock 만 바뀌고 로트는 계속 벌어졌다.
    const 이월음수: RawMaterialLot[] = [
      로트({ id: '이월', supplierName: '이월', qtyRemaining: -7, lotNo: undefined }),
      로트({ id: '소진', qtyRemaining: 0, status: 'depleted' }),
    ];
    const r = anchorLotsByQty({ lots: 이월음수, targetQty: 39, unitKg: 1, det });
    expect(lotQtyRemaining(r.lots)).toBe(39);
    expect(r.lots.find(l => l.supplierName === '이월')!.qtyRemaining).toBe(39);
    expect(r.deltaQty).toBe(46);          // −7 → 39
    expect(r.beforeQty).toBe(-7);
  });

  it('늘린 만큼은 **이월**로 들어간다 — 어느 입고분인지 모르는 게 사실이다', () => {
    //  없는 로트에 임의로 붙이면 나중에 회수할 때 엉뚱한 거래처가 걸린다.
    const r = anchorLotsByQty({ lots: [로트({ id: 'a', qtyRemaining: 10 })], targetQty: 25, unitKg: 1, det });
    expect(r.lots.find(l => l.id === 'a')!.qtyRemaining).toBe(10);      // 진짜 로트는 안 건드린다
    expect(r.lots.find(l => l.supplierName === '이월')!.qtyRemaining).toBe(15);
  });

  it('줄일 때는 선입선출 — 먼저 들어온 것이 먼저 나간 것으로 본다', () => {
    const r = anchorLotsByQty({
      lots: [로트({ id: '먼저', qtyRemaining: 10 }), 로트({ id: '나중', qtyRemaining: 10, receivedDate: '2026-09-05' })],
      targetQty: 6, det,
    });
    expect(r.lots.find(l => l.id === '먼저')!.qtyRemaining).toBe(0);
    expect(r.lots.find(l => l.id === '먼저')!.status).toBe('depleted');
    expect(r.lots.find(l => l.id === '나중')!.qtyRemaining).toBe(6);
  });

  it('kg 도 같이 따라간다 — 로트는 개수와 kg 을 같이 들고 다닌다', () => {
    const r = anchorLotsByQty({ lots: [], targetQty: 4, unitKg: 16.5, det });
    const b = r.lots[0];
    expect(b.qtyRemaining).toBe(4);
    expect(b.kgRemaining).toBe(66);
  });

  it('이미 맞으면 아무것도 안 건드린다', () => {
    const r = anchorLotsByQty({ lots: [로트({ id: 'a', qtyRemaining: 30 })], targetQty: 30, det });
    expect(r.deltaQty).toBe(0);
    expect(r.lots[0].qtyRemaining).toBe(30);
  });

  it('0 으로 맞추면 전부 깐다', () => {
    const r = anchorLotsByQty({ lots: [로트({ id: 'a', qtyRemaining: 12 })], targetQty: 0, det });
    expect(lotQtyRemaining(r.lots)).toBe(0);
  });

  it('로트가 하나도 없어도 선다 — 로트를 처음 쓰는 품목', () => {
    const r = anchorLotsByQty({ lots: [], targetQty: 68, unitKg: 16.5, det });
    expect(lotQtyRemaining(r.lots)).toBe(68);
    expect(r.lots[0].supplierName).toBe('이월');
  });

  it('소진으로 꺼 뒀던 이월 버킷도 실사로 다시 살아난다', () => {
    const r = anchorLotsByQty({
      lots: [로트({ id: '이월', supplierName: '이월', qtyRemaining: 0, status: 'depleted' })],
      targetQty: 5, unitKg: 1, det,
    });
    expect(r.lots[0].status).toBe('active');
    expect(lotQtyRemaining(r.lots)).toBe(5);
  });

  it('트랜잭션이 여러 번 돌아도 버킷이 하나만 선다 — id 를 밖에서 정해 넣는다', () => {
    const a = anchorLotsByQty({ lots: [], targetQty: 5, det });
    const b = anchorLotsByQty({ lots: [], targetQty: 5, det });
    expect(a.lots[0].id).toBe(b.lots[0].id);
  });

  it('원본 배열을 안 건드린다 — 실패하면 그대로 되돌아가야 한다', () => {
    const 원본 = [로트({ id: 'a', qtyRemaining: 48 })];
    anchorLotsByQty({ lots: 원본, targetQty: 10, det });
    expect(원본[0].qtyRemaining).toBe(48);
  });
});
