import { describe, it, expect } from 'vitest';
import { oemLedgerKg } from './orderStockEngine';
import { buildBomIndex, setBomIndex } from '../../shared/bomIndex';
import type { Item } from '../../shared/types';

/**
 * **임가공 박스가 원장에 남기는 kg.**
 *
 * 2026-09-11 사장님 — "9월 9일 대왕 볶음참깨 10개입 박스 주문인데 깨는 1kg 밖에 차감이 안 됐네".
 * 실제 원장 줄이 `rm-auto-ORD-1788908640337-볶음참깨` `used: 1` 이었다. 10이어야 했다.
 *
 * 왜 못 잡았나 — 이 셈은 `produceOrder` 한복판에 박혀 있어 시험이 닿지 않았고,
 * `oemCycle.test.ts` ③번은 같은 셈을 **베껴 적어** 두고 통과했다. 게다가 그 가짜 품목의
 * 규격이 `20kg`(개입수 없음)이라, 진짜 데이터의 `1kg * 10` 과 어긋난 줄이 안 드러났다.
 *
 * **여기서는 진짜 모양을 쓴다** — 규격은 낱개 용량 + 개입수(`1kg * 10`), 개입수는 BOM.
 */

//  `type: 'product'` 가 있어야 BOM 이 낱개를 완제품으로 본다 — 박스 판정의 근거다
//  (`unpackComponent`). oemCycle.test 의 가짜 품목들은 이게 없어서 박스가 박스로 안 잡혔다.
const 품목 = (over: Partial<Item>): Item =>
  ({ id: 'x', name: 'x', type: 'product', category: 'product', unit: '개', price: 0, stock: 0, minStock: 0, image: '', ...over } as Item);

//  운영 데이터 그대로 — p-1785907900413 `볶음참깨/1kg` 규격 `1kg * 10`, BOM 에 낱개 ×10.
const 낱개 = 품목({ id: 'nakgae', name: '볶음참깨-낱개/1kg', spec: '1kg', procureType: '임가공' });
const 박스10 = 품목({ id: 'box10', name: '볶음참깨/1kg', spec: '1kg * 10', unit: '박스', procureType: '임가공' });
const 박스20 = 품목({ id: 'box20', name: '볶음참깨/1kg', spec: '1kg * 20', unit: '박스', procureType: '임가공' });
const 기름박스 = 품목({ id: 'oil12', name: '참기름/특A/1800ml', spec: '1800ml * 12', unit: '박스', procureType: '임가공' });
const 기름낱개 = 품목({ id: 'oil', name: '참기름/특A/1800ml', spec: '1800ml', procureType: '임가공' });

setBomIndex(buildBomIndex([낱개, 박스10, 박스20, 기름낱개, 기름박스], [
  { parent_id: 'box10', child_id: 'nakgae', quantity: 10 },
  { parent_id: 'box20', child_id: 'nakgae', quantity: 20 },
  { parent_id: 'oil12', child_id: 'oil', quantity: 12 },
]));

const 깨 = [{ raw: '볶음참깨', ratio: 1 }];
//  밀도표(DENSITY)의 열쇠는 **진짜 원료 이름**이다 — '참기름' 같은 갈래 이름이 아니라
//  '깨분참기름'·'통깨참기름' 이다. 갈래 이름을 넣으면 밀도가 1 로 떨어져 조용히 틀린다.
const 참기름 = [{ raw: '깨분참기름', ratio: 1 }];

describe('oemLedgerKg — 임가공이 원료수불부에 남기는 kg', () => {
  it('낱개는 규격 그대로 — 1kg × 3개 = 3kg', () => {
    expect(oemLedgerKg(낱개, 3, 깨)).toEqual({ 볶음참깨: 3 });
  });

  it('**10개입 박스 1개는 10kg 이다** — 사장님이 잡은 그 줄', () => {
    //  고치기 전에는 1 이 나왔다. `units`(박스 수)를 규격 앞부분(낱개 1kg)에 그냥 곱했다.
    expect(oemLedgerKg(박스10, 1, 깨)).toEqual({ 볶음참깨: 10 });
  });

  it('20개입 박스 3개는 60kg — oemCycle ③번이 베껴 적던 그 값', () => {
    expect(oemLedgerKg(박스20, 3, 깨)).toEqual({ 볶음참깨: 60 });
  });

  it('개입수는 **BOM 이 임자**다 — 규격 글자가 아니다', () => {
    //  규격에는 10 이라 적혀 있지만 BOM 은 20 이다. BOM 을 따라간다.
    const 어긋난박스 = 품목({ id: 'box20', name: '볶음참깨/1kg', spec: '1kg * 10', procureType: '임가공' });
    expect(oemLedgerKg(어긋난박스, 1, 깨)).toEqual({ 볶음참깨: 20 });
  });

  it('기름은 밀도로 환산한다 — 1800ml × 12 × 0.916 ≈ 19.786kg', () => {
    const r = oemLedgerKg(기름박스, 1, 참기름);
    expect(r.깨분참기름).toBeCloseTo(1.8 * 12 * 0.916, 2);
    //  낱개 12개와 같은 값이어야 한다 — 박스로 팔든 낱개로 팔든 쓴 기름은 같다.
    expect(r.깨분참기름).toBeCloseTo(oemLedgerKg(기름낱개, 12, 참기름).깨분참기름, 3);
  });

  it('원료식이 비면 아무것도 안 남긴다', () => {
    expect(oemLedgerKg(박스10, 5, [])).toEqual({});
  });

  it('규격이 없으면 0 — 없는 숫자를 지어내지 않는다', () => {
    expect(oemLedgerKg(품목({ id: 'box10', spec: '' }), 1, 깨)).toEqual({});
  });

  it('배합비를 곱한다 — 반반 섞은 것', () => {
    expect(oemLedgerKg(박스10, 1, [{ raw: '볶음참깨', ratio: 0.5 }, { raw: '볶음검정참깨', ratio: 0.5 }]))
      .toEqual({ 볶음참깨: 5, 볶음검정참깨: 5 });
  });
});
