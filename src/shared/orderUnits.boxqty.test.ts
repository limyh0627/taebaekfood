import { describe, it, expect, afterEach } from 'vitest';
import { unitsPerBoxOf, unpackQty, boxQtyLabel, packBreakdown } from './orderUnits';
import { setBomIndex, buildBomIndex, resetBomIndex } from './bomIndex';
import { setPackIndex, buildPackIndex, resetPackIndex } from './packIndex';
import type { Item } from './types';

/**
 * **개입수의 근거는 둘뿐이다.**
 *
 *   ① BOM        박스를 별개 품목으로 둔 것. 박스째 쌓아 두고 박스로 센다(136품목).
 *   ② 환산표      낱개로만 세는데 박스로 말하는 것. 향미유·고춧가루(9품목).
 *
 * 예전엔 `boxSize` 필드 · 규격 글자 · 코드에 박은 '향미유면 12' 까지 넷이었다.
 * 근거가 넷이면 어느 게 맞는지 아무도 못 믿고, 실제로 갈려 있었다 —
 * 규격이 안 따라간 다섯 품목에서 0이 나왔다(BOM 엔 40·10 이 멀쩡히 있었는데).
 */
const 품목 = (over: Partial<Item> = {}): Item => ({ id: 'i1', name: '참기름', ...over } as Item);
const BOM세우기 = (items: Item[], boms: { parent_id: string; child_id: string; quantity?: number }[]) =>
  setBomIndex(buildBomIndex(items as never, boms));
const 환산표세우기 = (rows: { item_id: string; units_per_box?: number }[]) =>
  setPackIndex(buildPackIndex(rows));

afterEach(() => { resetBomIndex(); resetPackIndex(); });

describe('① BOM — 박스를 별개 품목으로 둔 것', () => {
  const 낱개 = { id: 'loose', name: '참기름/180ml', type: 'product', spec: '180ml' } as Item;
  const 박스 = { id: 'box', name: '참기름/병/분/엘생명/180ml', type: 'product', unit: '박스' } as Item;

  it('BOM 의 낱개 구성품 수량이 곧 개입수다', () => {
    BOM세우기([낱개, 박스], [{ parent_id: 'box', child_id: 'loose', quantity: 40 }]);
    expect(unitsPerBoxOf(박스)).toBe(40);
    expect(unpackQty(3, 박스, true)).toBe(120);
  });

  it('**규격 글자가 비어 있어도 읽는다** — 실제로 다섯 품목이 그 상태였다', () => {
    BOM세우기([낱개, 박스], [{ parent_id: 'box', child_id: 'loose', quantity: 40 }]);
    expect(박스.spec).toBeUndefined();
    expect(unitsPerBoxOf(박스)).toBe(40);
  });

  it('**규격 글자를 아예 안 본다** — 따라 적는 글자일 뿐이라 근거가 아니다', () => {
    BOM세우기([], []);
    expect(unitsPerBoxOf(품목({ spec: '1kg * 20' }))).toBe(0);
  });

  it('수량이 1이면 박스가 아니다 — 그건 그냥 같은 것이다', () => {
    BOM세우기([낱개, 박스], [{ parent_id: 'box', child_id: 'loose', quantity: 1 }]);
    expect(unitsPerBoxOf(박스)).toBe(0);
  });

  it('서로 다른 완제품을 하나씩 담으면 선물세트다 — 박스가 아니다', () => {
    const 참 = { id: 'a', name: '참기름', type: 'product' } as Item;
    const 들 = { id: 'b', name: '들기름', type: 'product' } as Item;
    const 세트 = { id: 'set', name: '참+들/스마트', type: 'product' } as Item;
    BOM세우기([참, 들, 세트], [
      { parent_id: 'set', child_id: 'a', quantity: 1 },
      { parent_id: 'set', child_id: 'b', quantity: 1 },
    ]);
    expect(unitsPerBoxOf(세트)).toBe(0);
  });
});

describe('② 환산표 — 낱개로만 세는데 박스로 말하는 것', () => {
  const 향미유 = 품목({ id: 'oil', name: '들향기름', type: 'goods' });

  it('표에 줄이 있으면 박스로 팔 수 있다', () => {
    환산표세우기([{ item_id: 'oil', units_per_box: 12 }]);
    expect(unitsPerBoxOf(향미유)).toBe(12);
    expect(unpackQty(3, 향미유, true)).toBe(36);
  });

  it('**줄이 없으면 박스로 안 판다** — 코드가 12를 지어내지 않는다', () => {
    환산표세우기([]);
    expect(unitsPerBoxOf(향미유)).toBe(0);
    expect(unpackQty(3, 향미유, true)).toBe(3);
  });

  it('개입수가 1이면 안 담는다 — 한 박스에 한 개는 박스가 아니다', () => {
    환산표세우기([{ item_id: 'oil', units_per_box: 1 }]);
    expect(unitsPerBoxOf(향미유)).toBe(0);
  });

  it('빈 값·글자는 안 담는다', () => {
    환산표세우기([{ item_id: 'oil' }, { item_id: 'x', units_per_box: NaN }]);
    expect(unitsPerBoxOf(향미유)).toBe(0);
  });

  it('같은 낱개라도 품목마다 따로 적는다 — 고춧가루 1kg 20개입 · 5kg 4개입', () => {
    환산표세우기([
      { item_id: 'g1', units_per_box: 20 },
      { item_id: 'g5', units_per_box: 4 },
    ]);
    expect(unitsPerBoxOf(품목({ id: 'g1' }))).toBe(20);
    expect(unitsPerBoxOf(품목({ id: 'g5' }))).toBe(4);
  });
});

describe('둘이 겹치면 BOM 이 이긴다', () => {
  it('박스 품목이면 BOM 이 근거다 — 표는 낱개 품목용이다', () => {
    const 낱개 = { id: 'loose', name: '깨', type: 'product' } as Item;
    const 박스 = { id: 'box', name: '깨/20개입', type: 'product' } as Item;
    BOM세우기([낱개, 박스], [{ parent_id: 'box', child_id: 'loose', quantity: 20 }]);
    환산표세우기([{ item_id: 'box', units_per_box: 99 }]);
    expect(unitsPerBoxOf(박스)).toBe(20);
  });
});

describe('박스를 낱개로 편다', () => {
  it('박스면 개입수를 곱한다', () => {
    환산표세우기([{ item_id: 'i1', units_per_box: 20 }]);
    expect(unpackQty(3, 품목(), true)).toBe(60);
  });
  it('낱개면 그대로 — 곱하면 안 된다', () => {
    환산표세우기([{ item_id: 'i1', units_per_box: 20 }]);
    expect(unpackQty(3, 품목(), false)).toBe(3);
    expect(unpackQty(3, 품목())).toBe(3);
  });
  it('개입수를 모르면 그대로 둔다 — 지어내지 않는다', () => {
    expect(unpackQty(3, 품목(), true)).toBe(3);
    expect(unpackQty(3, undefined, true)).toBe(3);
  });
});

describe('박스 수량 표기', () => {
  it('개입수를 알면 낱개까지 적는다', () => {
    expect(boxQtyLabel(3, 20)).toBe('3BOX(60개)');
    expect(boxQtyLabel('3', 20, 'B')).toBe('3B(60개)');
  });
  it('**모르면 개수를 안 적는다** — 지어내면 틀린 값을 확신에 차서 보여준다', () => {
    expect(boxQtyLabel(3, 0)).toBe('3BOX');
    expect(boxQtyLabel(3, undefined)).toBe('3BOX');
    expect(boxQtyLabel(3, 1)).toBe('3BOX');
  });
  it('빈 값이어도 개입수를 알면 그대로 적는다', () => {
    expect(boxQtyLabel('', 20)).toBe('0BOX(0개)');
  });
});

describe('재고를 박스로 환산해 곁들인다', () => {
  it('딱 떨어지면 박스만', () => {
    expect(packBreakdown(300, 12)).toBe('(12개입)25B');
    expect(packBreakdown(360, 12)).toBe('(12개입)30B');
  });
  it('남으면 낱개를 붙인다', () => {
    expect(packBreakdown(308, 12)).toBe('(12개입)25B+8개');
    expect(packBreakdown(20, 12)).toBe('(12개입)1B+8개');
  });
  it('**개입수를 모르면 아무것도 안 적는다** — 지어내지 않는다', () => {
    expect(packBreakdown(300, 0)).toBe('');
    expect(packBreakdown(300, 1)).toBe('');
  });
  it('한 박스가 안 되면 0B', () => {
    expect(packBreakdown(5, 12)).toBe('(12개입)0B+5개');
    expect(packBreakdown(0, 12)).toBe('(12개입)0B');
  });
  it('마이너스도 그대로 — 감추면 어긋난 재고를 못 본다', () => {
    expect(packBreakdown(-48, 12)).toBe('(12개입)-4B');
    expect(packBreakdown(-31, 10)).toBe('(10개입)-3B-1개');
  });
  it('낱개 합이 맞는다 — 박스×개입 + 나머지', () => {
    for (const [n, per] of [[300, 12], [308, 12], [-48, 12], [-31, 10], [5, 20]] as const) {
      const m = /\((\d+)개입\)(-?\d+)B(?:\+?(-?\d+)개)?/.exec(packBreakdown(n, per))!;
      expect(Number(m[2]) * per + Number(m[3] ?? 0)).toBe(n);
    }
  });
});
