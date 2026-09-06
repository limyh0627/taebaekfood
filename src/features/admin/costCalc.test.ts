import { describe, it, expect } from 'vitest';
import { calcCost, CALC_ITEM_ID } from './costCalc';
import type { Item } from '../../shared/types';

const item = (over: Partial<Item> & { id: string; name: string }): Item => ({
  type: 'submaterial', unit: '개', stock: 0, minStock: 0, price: 0, ...over,
} as Item);

//  참기름 한 병 — 병 + 캡 + 라벨 + 기름
const 병 = item({ id: 'sub-bottle', name: '1750ML-페트병', cost: 420, taxType: '과세' });
const 캡 = item({ id: 'sub-cap', name: '물엿캡-빨강', cost: 55, taxType: '과세' });
const 기름 = item({ id: 'raw-oil', name: '참기름A', type: 'raw', unit: 'kg', cost: 7_000, taxType: '면세' });
const ALL = [병, 캡, 기름];

describe('원가계산기', () => {
  it('구성품 원가를 수량만큼 더한다', () => {
    const r = calcCost([{ itemId: 병.id, qty: 1 }, { itemId: 캡.id, qty: 1 }], ALL, [], { taxType: '면세' });
    expect(r.cost).toBe(475);          // 420 + 55
    expect(r.lines).toHaveLength(2);
  });

  /**
   * 면세 원료(참깨·들깨)로 과세품(참기름)을 만들면 매입세액을 못 뺀다 —
   * 그만큼이 그대로 원가에 얹힌다. 계산기가 이걸 빼먹으면 마진이 실제보다 좋아 보인다.
   */
  /**
   * **원가는 공급가액으로만 본다**(2026-09-06 사장님: "아예 면세로만 원가 보는게 fm 아니야?").
   * 전에는 면세 원료로 과세품을 만들면 ×1.1을 얹었는데, 면세 농산물은 살 때 부가세를
   * **애초에 안 낸다** — 못 빼는 매입세액이 없으니 얹을 것도 없다.
   */
  it('과세품이든 면세품이든 원가는 같다 — 부가세를 안 얹는다', () => {
    const 과세 = calcCost([{ itemId: 기름.id, qty: 1 }], ALL, [], { taxType: '과세' });
    const 면세 = calcCost([{ itemId: 기름.id, qty: 1 }], ALL, [], { taxType: '면세' });
    expect(과세.cost).toBe(7_000);
    expect(면세.cost).toBe(7_000);
  });

  it('소수 수량도 그대로 곱한다 — 기름은 1.603kg씩 들어간다', () => {
    const r = calcCost([{ itemId: 기름.id, qty: 1.603 }], ALL, [], { taxType: '면세' });
    expect(r.cost).toBe(Math.round(7_000 * 1.603));
  });

  it('가공비를 더한다', () => {
    const r = calcCost([{ itemId: 병.id, qty: 1 }], ALL, [], { taxType: '면세', fee: 300 });
    expect(r.cost).toBe(720);
    expect(r.fee).toBe(300);
  });

  it('마진 = 판매가 − 원가, 마진율은 판매가 기준', () => {
    const x = calcCost([{ itemId: 병.id, qty: 1 }], ALL, [], { taxType: '면세', price: 1_000 });
    expect(x.cost).toBe(420);
    expect(x.margin).toBe(580);
    expect(x.marginRate).toBeCloseTo(0.58, 5);      // 580 / 1,000
    expect(x.markupRate).toBeCloseTo(580 / 420, 5); // 원가에 138% 얹은 셈
  });

  it('원가보다 싸게 팔면 마진이 음수다', () => {
    const r = calcCost([{ itemId: 병.id, qty: 1 }], ALL, [], { taxType: '면세', price: 300 });
    expect(r.margin).toBe(-120);
    expect(r.marginRate).toBeCloseTo(-0.4, 5);
  });

  it('판매가·원가가 0이면 비율은 0 — 나눗셈이 터지지 않는다', () => {
    const r = calcCost([], ALL, [], {});
    expect(r.cost).toBe(0);
    expect(r.marginRate).toBe(0);
    expect(r.markupRate).toBe(0);
  });

  it('수량이 0이거나 품목이 안 골라진 줄은 뺀다', () => {
    const r = calcCost(
      [{ itemId: 병.id, qty: 0 }, { itemId: '', qty: 5 }, { itemId: 캡.id, qty: 2 }],
      ALL, [], { taxType: '면세' },
    );
    expect(r.lines.map(l => l.itemId)).toEqual([캡.id]);
    expect(r.cost).toBe(110);
  });

  /**
   * 구성품이 또 구성품을 가진 경우 — 박스에 낱개가 10개 들어가는 식.
   * 계산기가 한 단만 보면 박스 원가가 겉박스 값만 나온다.
   */
  it('하위 BOM까지 굴린다', () => {
    const 낱개 = item({ id: 'p-unit', name: '참기름/1750ml', type: 'product', taxType: '면세' });
    const 겉박스 = item({ id: 'sub-box', name: '4호박스', cost: 900, taxType: '과세' });
    const all = [...ALL, 낱개, 겉박스];
    const boms = [
      { parent_id: 낱개.id, child_id: 병.id, quantity: 1 },
      { parent_id: 낱개.id, child_id: 캡.id, quantity: 1 },
    ];
    //  박스 하나 = 낱개 10 + 겉박스 1
    const r = calcCost(
      [{ itemId: 낱개.id, qty: 10 }, { itemId: 겉박스.id, qty: 1 }],
      all, boms, { taxType: '면세' },
    );
    expect(r.cost).toBe(475 * 10 + 900);
  });

  it('가짜 품목 id는 실제 품목과 안 부딪히는 이름이다', () => {
    expect(CALC_ITEM_ID.startsWith('__')).toBe(true);
  });
});
