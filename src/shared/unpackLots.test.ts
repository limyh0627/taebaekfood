import { describe, it, expect } from 'vitest';
import { unpackLots, canStockAfter, bulkStockAfter } from './unpackLots';
import type { RawMaterialLot } from './types';

const det = { now: '2026-09-16T10:00:00.000Z', receivedDate: '2026-09-16', lotIdPrefix: 'unpack-1' };

/** 캔 로트 — 개수로 센다(`qtyRemaining`). */
const 캔로트 = (o: Partial<RawMaterialLot> & { id: string; qtyRemaining: number }): RawMaterialLot => ({
  supplierName: 'A거래처', unitKg: 16.5,
  qtyIn: o.qtyRemaining, kgIn: o.qtyRemaining * 16.5, kgRemaining: o.qtyRemaining * 16.5,
  receivedDate: '2026-09-01', status: 'active', createdAt: '2026-09-01T00:00:00Z',
  material: '통깨참기름', ...o,
} as RawMaterialLot);

/** 벌크 로트 — kg 으로 센다. */
const 벌크로트 = (o: Partial<RawMaterialLot> & { id: string; kgRemaining: number }): RawMaterialLot => ({
  supplierName: 'A거래처', kgIn: o.kgRemaining,
  receivedDate: '2026-09-01', status: 'active', createdAt: '2026-09-01T00:00:00Z',
  material: '통깨참기름', ...o,
} as RawMaterialLot);

describe('개봉은 로트를 물려주는 이동이다', () => {
  it('**로트번호가 그대로 벌크로 넘어간다** — 추적이 안 끊기는 자리', () => {
    const r = unpackLots({
      canLots: [캔로트({ id: 'c1', lotNo: '260901-01', qtyRemaining: 68 })],
      bulkLots: [],
      cans: 3, perCan: 16.5, material: '통깨참기름', det,
    });
    expect(r.bulkLots).toHaveLength(1);
    expect(r.bulkLots[0].lotNo).toBe('260901-01');
    expect(r.bulkLots[0].kgRemaining).toBe(49.5);
  });

  it('거래처를 물려받는다 — 산 것이 아니라 그 로트가 형태만 바뀐 것이다', () => {
    //  '개봉'이라고 적으면 나중에 이 기름이 어디서 왔는지 못 찾는다.
    const r = unpackLots({
      canLots: [캔로트({ id: 'c1', lotNo: '260901-01', qtyRemaining: 10, supplierName: '풍회유통' })],
      bulkLots: [], cans: 2, perCan: 16.5, material: '통깨참기름', det,
    });
    expect(r.bulkLots[0].supplierName).toBe('풍회유통');
    expect(r.bulkLots[0].receivedDate).toBe('2026-09-01');   // 입고일도 원래 것
  });

  it('**총량이 안 변한다** — 캔에서 빠진 kg 이 벌크로 그대로 간다', () => {
    const 캔 = [캔로트({ id: 'c1', lotNo: '260901-01', qtyRemaining: 68 })];
    const 전 = 캔[0].kgRemaining;
    const r = unpackLots({ canLots: 캔, bulkLots: [], cans: 3, perCan: 16.5, material: '통깨참기름', det });
    const 후캔 = r.canLots.reduce((s, l) => s + l.kgRemaining, 0);
    const 후벌크 = bulkStockAfter(r.bulkLots);
    expect(후캔 + 후벌크).toBe(전);
  });

  it('재고 = 로트 합계 — 양쪽 다', () => {
    const r = unpackLots({
      canLots: [캔로트({ id: 'c1', qtyRemaining: 68 })],
      bulkLots: [벌크로트({ id: 'b1', kgRemaining: 100 })],
      cans: 3, perCan: 16.5, material: '통깨참기름', det,
    });
    expect(canStockAfter(r.canLots)).toBe(65);
    expect(bulkStockAfter(r.bulkLots)).toBe(149.5);
  });

  it('선입선출 — 먼저 들어온 캔부터 깐다', () => {
    const r = unpackLots({
      canLots: [
        캔로트({ id: 'c1', lotNo: '260901-01', qtyRemaining: 2 }),
        캔로트({ id: 'c2', lotNo: '260910-01', qtyRemaining: 10, receivedDate: '2026-09-10' }),
      ],
      bulkLots: [], cans: 5, perCan: 16.5, material: '통깨참기름', det,
    });
    expect(r.moves.map(m => [m.lotNo, m.cans])).toEqual([['260901-01', 2], ['260910-01', 3]]);
    //  로트가 둘로 갈렸으니 벌크 로트도 둘 — 섞어 버리면 어느 쪽이 먼저인지 잃는다
    expect(r.bulkLots.map(l => l.lotNo)).toEqual(['260901-01', '260910-01']);
    expect(r.canLots.find(l => l.id === 'c1')!.status).toBe('depleted');
  });

  it('같은 로트를 또 까면 **있던 벌크 로트에 얹는다** — 새로 세우면 FIFO 가 무의미해진다', () => {
    const r = unpackLots({
      canLots: [캔로트({ id: 'c1', lotNo: '260901-01', qtyRemaining: 68 })],
      bulkLots: [벌크로트({ id: 'b1', lotNo: '260901-01', kgRemaining: 49.5 })],
      cans: 2, perCan: 16.5, material: '통깨참기름', det,
    });
    expect(r.bulkLots).toHaveLength(1);
    expect(r.bulkLots[0].id).toBe('b1');
    expect(r.bulkLots[0].kgRemaining).toBe(82.5);            // 49.5 + 33
  });

  it('로트번호가 다르면 따로 선다 — 다른 입고분을 한 통에 섞지 않는다', () => {
    const r = unpackLots({
      canLots: [캔로트({ id: 'c1', lotNo: '260910-01', qtyRemaining: 5 })],
      bulkLots: [벌크로트({ id: 'b1', lotNo: '260901-01', kgRemaining: 49.5 })],
      cans: 1, perCan: 16.5, material: '통깨참기름', det,
    });
    expect(r.bulkLots).toHaveLength(2);
  });

  it('개수 로트에는 안 얹는다 — 캔 로트와 벌크 로트는 세는 단위가 다르다', () => {
    //  `qtyRemaining` 이 있는 로트는 개수로 센다. 거기 kg 을 더하면 둘이 엉킨다.
    const r = unpackLots({
      canLots: [캔로트({ id: 'c1', lotNo: '260901-01', qtyRemaining: 5 })],
      bulkLots: [캔로트({ id: 'b1', lotNo: '260901-01', qtyRemaining: 3 })],
      cans: 1, perCan: 16.5, material: '통깨참기름', det,
    });
    expect(r.bulkLots).toHaveLength(2);
    expect(r.bulkLots[1].kgRemaining).toBe(16.5);
  });

  it('로트보다 많이 까면 **막지 않고 보이게 둔다** — 이월이 음수로 받는다', () => {
    //  조용히 0 에서 멈추면 로트 합계가 실제와 갈려 추적 자체를 못 믿게 된다.
    const r = unpackLots({
      canLots: [캔로트({ id: 'c1', lotNo: '260901-01', qtyRemaining: 2 })],
      bulkLots: [], cans: 5, perCan: 16.5, material: '통깨참기름', det,
    });
    expect(r.shortageQty).toBe(3);
    expect(r.canLots.find(l => l.supplierName === '이월')!.qtyRemaining).toBe(-3);
  });

  it('트랜잭션이 여러 번 돌아도 같은 로트가 선다 — id 를 밖에서 정해 넣는다', () => {
    const 한번 = unpackLots({ canLots: [캔로트({ id: 'c1', qtyRemaining: 9 })], bulkLots: [], cans: 2, perCan: 16.5, material: 'x', det });
    const 두번 = unpackLots({ canLots: [캔로트({ id: 'c1', qtyRemaining: 9 })], bulkLots: [], cans: 2, perCan: 16.5, material: 'x', det });
    expect(한번.bulkLots[0].id).toBe(두번.bulkLots[0].id);
    expect(한번.bulkLots[0].createdAt).toBe(두번.bulkLots[0].createdAt);
  });

  it('원본 배열을 안 건드린다 — 실패하면 그대로 되돌아가야 한다', () => {
    const 캔 = [캔로트({ id: 'c1', qtyRemaining: 68 })];
    unpackLots({ canLots: 캔, bulkLots: [], cans: 3, perCan: 16.5, material: 'x', det });
    expect(캔[0].qtyRemaining).toBe(68);
  });
});
