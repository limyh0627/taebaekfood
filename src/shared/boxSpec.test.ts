import { describe, it, expect, afterEach } from 'vitest';
import { specBase, boxSpecOf, boxSpecUpdates } from './boxSpec';
import { setBomIndex, buildBomIndex, resetBomIndex } from './bomIndex';
import type { Item } from './types';

/**
 * 낱개 규격을 고쳤을 때 박스가 따라오는가. 안 따라와서 여섯 품목이 어긋나 있었다
 * (들기름/병/특/가득찬/350ml 은 낱개가 350ml 인데 박스는 '300ml * 20' 이었다).
 */
const 품목 = (id: string, name: string, spec?: string): Item =>
  ({ id, name, type: 'product', spec } as Item);
const 세우기 = (items: Item[], boms: { parent_id: string; child_id: string; quantity?: number }[]) =>
  setBomIndex(buildBomIndex(items as never, boms));
afterEach(() => resetBomIndex());

describe('규격 글자 다루기', () => {
  it('개입수 꼬리를 뗀다', () => {
    expect(specBase('350ml * 20')).toBe('350ml');
    expect(specBase('1kg x 10')).toBe('1kg');
    expect(specBase('1kg × 10')).toBe('1kg');
    expect(specBase('1750ml')).toBe('1750ml');
    expect(specBase(undefined)).toBe('');
  });

  it('낱개 규격 + 개입수 = 박스 규격', () => {
    expect(boxSpecOf('350ml', 20)).toBe('350ml * 20');
    //  낱개 쪽에 꼬리가 남아 있어도 떼고 새로 붙인다
    expect(boxSpecOf('350ml * 12', 20)).toBe('350ml * 20');
  });

  it('개입수가 1이면 꼬리를 안 붙인다 — 박스가 아니다', () => {
    expect(boxSpecOf('350ml', 1)).toBe('350ml');
  });

  it('낱개 규격이 없으면 만들 수 없다', () => {
    expect(boxSpecOf('', 20)).toBe('');
    expect(boxSpecOf(undefined, 20)).toBe('');
  });
});

describe('낱개를 고치면 박스가 따라온다', () => {
  const 낱개 = 품목('loose', '들기름/병/특/가득찬/350ml', '350ml');
  const 박스 = 품목('box', '들기름/병/특/가득찬/350ml', '300ml * 20');
  const bom = [{ parent_id: 'box', child_id: 'loose', quantity: 20 }];

  it('**용량이 바뀌면 박스 규격도 바뀐다** — 이게 안 돼서 300ml 이 남아 있었다', () => {
    세우기([낱개, 박스], bom);
    expect(boxSpecUpdates(낱개, [낱개, 박스])).toEqual([
      { id: 'box', name: '들기름/병/특/가득찬/350ml', from: '300ml * 20', spec: '350ml * 20' },
    ]);
  });

  it('꼬리가 통째로 빠져 있어도 붙인다 — 다섯 품목이 그 상태였다', () => {
    const 꼬리없음 = 품목('box', '참기름/병/분/엘생명/180ml', '180ml');
    const 낱개180 = 품목('loose', '참기름/180ml', '180ml');
    세우기([낱개180, 꼬리없음], [{ parent_id: 'box', child_id: 'loose', quantity: 40 }]);
    expect(boxSpecUpdates(낱개180, [낱개180, 꼬리없음])[0].spec).toBe('180ml * 40');
  });

  it('이미 맞으면 안 건드린다 — 쓸데없이 쓰면 어디가 바뀌었는지 못 읽는다', () => {
    const 맞는박스 = 품목('box', '들기름', '350ml * 20');
    세우기([낱개, 맞는박스], bom);
    expect(boxSpecUpdates(낱개, [낱개, 맞는박스])).toEqual([]);
  });

  it('박스가 여럿이면 각자 개입수로 맞춘다 — 같은 낱개를 10개들이·20개들이가 문다', () => {
    const b10 = 품목('b10', '시골향탈피들깨가루/1kg', '1kg * 10');
    const b20 = 품목('b20', '시골향탈피들깨가루/1kg', '999g * 20');
    const l = 품목('l', '시골향탈피들깨가루/1kg', '1kg');
    세우기([l, b10, b20], [
      { parent_id: 'b10', child_id: 'l', quantity: 10 },
      { parent_id: 'b20', child_id: 'l', quantity: 20 },
    ]);
    const up = boxSpecUpdates(l, [l, b10, b20]);
    expect(up).toEqual([{ id: 'b20', name: '시골향탈피들깨가루/1kg', from: '999g * 20', spec: '1kg * 20' }]);
  });

  it('낱개 규격을 비우면 박스를 안 건드린다 — 있는 글자를 지우면 더 나쁘다', () => {
    const 빈낱개 = 품목('loose', '들기름', undefined);
    세우기([빈낱개, 박스], bom);
    expect(boxSpecUpdates(빈낱개, [빈낱개, 박스])).toEqual([]);
  });

  it('박스가 없으면 할 일이 없다', () => {
    세우기([낱개], []);
    expect(boxSpecUpdates(낱개, [낱개])).toEqual([]);
  });
});
