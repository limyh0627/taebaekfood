import { describe, it, expect } from 'vitest';
import { unpackQty, boxQtyLabel, unitsPerBoxOf } from './orderUnits';
import type { Item } from './types';

/**
 * 개입수 12를 화면 일곱 군데가 손으로 박아 놓고 있었다.
 * 박스 품목 140개 중 102개가 12개입이 아니다 — 쓰는 날 바로 틀리는 자리였다.
 */
const 품목 = (over: Partial<Item> = {}): Item => ({ id: 'i1', name: '참기름', ...over } as Item);

describe('개입수는 품목이 안다', () => {
  it('boxSize 가 가장 세다', () => {
    expect(unitsPerBoxOf(품목({ boxSize: 20, spec: '1kg * 10' }))).toBe(20);
  });
  it('없으면 규격에서 읽는다', () => {
    expect(unitsPerBoxOf(품목({ spec: '1kg * 20' }))).toBe(20);
    expect(unitsPerBoxOf(품목({ spec: '300ml * 40' }))).toBe(40);
  });
  it('향미유는 규격이 없을 때만 12로 물러선다', () => {
    expect(unitsPerBoxOf(품목({ category: '향미유' }))).toBe(12);
    //  규격이 있으면 규격이 이긴다 — 여기를 12로 박아 두면 20개입이 12개로 잡힌다
    expect(unitsPerBoxOf(품목({ category: '향미유', spec: '1750ml * 10' }))).toBe(10);
  });
  it('박스로 안 파는 품목은 0', () => {
    expect(unitsPerBoxOf(품목({ spec: '1kg' }))).toBe(0);
    expect(unitsPerBoxOf(undefined)).toBe(0);
  });
});

describe('박스를 낱개로 편다', () => {
  it('박스면 개입수를 곱한다', () => {
    expect(unpackQty(3, 품목({ spec: '1kg * 20' }), true)).toBe(60);
  });
  it('낱개면 그대로 — 곱하면 안 된다', () => {
    expect(unpackQty(3, 품목({ spec: '1kg * 20' }), false)).toBe(3);
    expect(unpackQty(3, 품목({ spec: '1kg * 20' }))).toBe(3);
  });
  it('개입수를 모르면 그대로 둔다 — 12를 지어내지 않는다', () => {
    expect(unpackQty(3, 품목({ spec: '1kg' }), true)).toBe(3);
    expect(unpackQty(3, undefined, true)).toBe(3);
  });
  it('20개입 품목을 12로 세면 48개가 샌다', () => {
    const p = 품목({ spec: '1kg * 20' });
    expect(unpackQty(3, p, true)).toBe(60);
    expect(3 * 12).toBe(36);          // 옛 화면이 찍던 값
  });
});

describe('박스 수량 표기', () => {
  it('개입수를 알면 낱개까지 적는다', () => {
    expect(boxQtyLabel(3, 20)).toBe('3BOX(60개)');
    expect(boxQtyLabel('3', 20, 'B')).toBe('3B(60개)');
  });
  it('**모르면 개수를 안 적는다** — 12라고 지어내면 틀린 값을 확신에 차서 보여준다', () => {
    expect(boxQtyLabel(3, 0)).toBe('3BOX');
    expect(boxQtyLabel(3, undefined)).toBe('3BOX');
    expect(boxQtyLabel(3, 1)).toBe('3BOX');
  });
  it('빈 값이어도 개입수를 알면 그대로 적는다', () => {
    expect(boxQtyLabel('', 20)).toBe('0BOX(0개)');
  });
});

// ── 개입수의 근거는 BOM 이다 ────────────────────────────────────────────────

import { setBomIndex, buildBomIndex, resetBomIndex } from './bomIndex';
import { afterEach } from 'vitest';

/**
 * 규격 글자(`1kg * 20`)는 사람이 읽으라고 따라 적는 것이지 근거가 아니다.
 * 실제로 다섯 품목이 **BOM 엔 40·10 이 있는데 규격이 비어** 있었고,
 * 규격을 먼저 읽던 시절엔 그 품목들이 "박스가 아니다"로 읽혔다.
 */
const 세우기 = (items: Item[], boms: { parent_id: string; child_id: string; quantity?: number }[]) =>
  setBomIndex(buildBomIndex(items as never, boms));

afterEach(() => resetBomIndex());

describe('개입수는 BOM 이 정한다', () => {
  const 낱개 = { id: 'loose', name: '참기름/180ml', type: 'product', spec: '180ml' } as Item;
  const 박스 = { id: 'box', name: '참기름/병/분/엘생명/180ml', type: 'product', unit: '박스' } as Item;

  it('규격이 비어 있어도 BOM 이 있으면 읽는다 — 실제로 다섯 품목이 이 상태였다', () => {
    세우기([낱개, 박스], [{ parent_id: 'box', child_id: 'loose', quantity: 40 }]);
    expect(박스.spec).toBeUndefined();
    expect(unitsPerBoxOf(박스)).toBe(40);
    expect(unpackQty(3, 박스, true)).toBe(120);
  });

  it('**BOM 이 규격을 이긴다** — 규격은 따라 적는 글자일 뿐이다', () => {
    const 어긋난박스 = { ...박스, spec: '180ml * 12' } as Item;   // 글자는 12, BOM 은 40
    세우기([낱개, 어긋난박스], [{ parent_id: 'box', child_id: 'loose', quantity: 40 }]);
    expect(unitsPerBoxOf(어긋난박스)).toBe(40);
  });

  it('BOM 이 없으면 예전대로 규격을 읽는다 — 옛 데이터가 아직 그렇게 산다', () => {
    세우기([], []);
    expect(unitsPerBoxOf({ id: 'x', spec: '1kg * 20' } as Item)).toBe(20);
  });

  it('BOM 에 낱개가 하나여도 수량이 1이면 박스가 아니다 — 그건 그냥 같은 것이다', () => {
    세우기([낱개, 박스], [{ parent_id: 'box', child_id: 'loose', quantity: 1 }]);
    expect(unitsPerBoxOf(박스)).toBe(0);
  });

  it('서로 다른 완제품을 하나씩 담으면 선물세트다 — 박스가 아니다', () => {
    const 참 = { id: 'a', name: '참기름', type: 'product' } as Item;
    const 들 = { id: 'b', name: '들기름', type: 'product' } as Item;
    const 세트 = { id: 'set', name: '참+들/스마트', type: 'product' } as Item;
    세우기([참, 들, 세트], [
      { parent_id: 'set', child_id: 'a', quantity: 1 },
      { parent_id: 'set', child_id: 'b', quantity: 1 },
    ]);
    expect(unitsPerBoxOf(세트)).toBe(0);
  });
});
