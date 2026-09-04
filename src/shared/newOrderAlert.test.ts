import { describe, it, expect } from 'vitest';
import { pickNewOrders, newOrderMessage } from './newOrderAlert';

const 켠시각 = '2026-09-03T10:00:00.000Z';
const o = (id: string, createdAt: string) => ({ id, createdAt, partnerName: id });

describe('pickNewOrders', () => {
  it('첫 목록은 아무것도 안 울린다 — 켤 때 지난 주문이 우르르 울리면 안 된다', () => {
    const seen = new Set<string>();
    const got = pickNewOrders([o('a', '2026-09-03T11:00:00.000Z')], seen, { seeded: false, since: 켠시각 });
    expect(got).toEqual([]);
    expect(seen.has('a')).toBe(true);   // 다음엔 새것이 아니다
  });

  it('첫 목록 뒤에 들어온 것만 울린다', () => {
    const seen = new Set(['a']);
    const got = pickNewOrders(
      [o('a', '2026-09-03T09:00:00.000Z'), o('b', '2026-09-03T11:00:00.000Z')],
      seen, { seeded: true, since: 켠시각 });
    expect(got.map(x => x.id)).toEqual(['b']);
  });

  it('같은 주문을 두 번 울리지 않는다', () => {
    const seen = new Set<string>(['a']);
    const opts = { seeded: true, since: 켠시각 };
    const list = [o('a', '2026-09-03T09:00:00.000Z'), o('b', '2026-09-03T11:00:00.000Z')];
    expect(pickNewOrders(list, seen, opts).map(x => x.id)).toEqual(['b']);
    expect(pickNewOrders(list, seen, opts)).toEqual([]);
  });

  it('내가 넣은 주문은 안 울린다', () => {
    const seen = new Set(['a']);
    const got = pickNewOrders([o('b', '2026-09-03T11:00:00.000Z')], seen,
      { seeded: true, since: 켠시각, mine: new Set(['b']) });
    expect(got).toEqual([]);
  });

  it('옛 주문을 뒤늦게 불러와도 안 울린다 — 주문이력을 펼칠 때가 그렇다', () => {
    const seen = new Set(['a']);
    const got = pickNewOrders([o('old', '2026-08-01T00:00:00.000Z')], seen, { seeded: true, since: 켠시각 });
    expect(got).toEqual([]);
  });

  it('createdAt 이 비면 안 울린다 — 언제 건지 모르는 걸 새것으로 치면 안 된다', () => {
    const seen = new Set(['a']);
    expect(pickNewOrders([o('x', '')], seen, { seeded: true, since: 켠시각 })).toEqual([]);
  });

  it('여러 건이 한꺼번에 와도 다 잡는다', () => {
    const seen = new Set<string>(['a']);
    const got = pickNewOrders(
      [o('b', '2026-09-03T11:00:00.000Z'), o('c', '2026-09-03T11:01:00.000Z')],
      seen, { seeded: true, since: 켠시각 });
    expect(got.map(x => x.id)).toEqual(['b', 'c']);
  });
});

describe('newOrderMessage', () => {
  it('한 건이면 거래처 이름', () => {
    expect(newOrderMessage(['희성실업']).body).toBe('희성실업 주문이 들어왔습니다.');
  });
  it('여러 건이면 묶는다', () => {
    expect(newOrderMessage(['희성실업', '푸드원', '태백']).body).toBe('희성실업 외 2건이 들어왔습니다.');
  });
});
