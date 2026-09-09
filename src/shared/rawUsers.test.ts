import { describe, it, expect } from 'vitest';
import { rawsOfProduct, productUsesRaw, orderLinesUsingRaw, type RawUsersDeps } from './rawUsers';
import type { Item } from './types';

/**
 * 2026-09-10 사장님: "여기 기록에 왜 볶음참깨 외 품목들이 보이냐".
 *
 * 원장 줄은 `orderId` 만 들고 있어서 화면이 **그 주문에 담긴 품목을 통째로** 적었다.
 * 한 주문에 참기름과 들깨가루가 같이 있으면 볶음참깨 줄에도 들깨가루가 떴다.
 */

const 품목 = (o: Partial<Item>): Item => ({ id: 'x', name: 'x', type: 'product', unit: '개', stock: 0, ...o } as Item);

//  참기름 —(BOM)→ 통깨참기름(벌크 홀더)
const 참기름 = 품목({ id: 'p-참기름', name: '참기름/병/1800ml' });
const 통깨참기름 = 품목({ id: 'raw-통깨참기름', name: '통깨참기름', subtype: '벌크', unit: 'kg' });

//  들깨가루 — 배합식으로만 잡힌 품목(BOM 에 벌크 구성품이 없다)
const 들깨가루 = 품목({ id: 'p-들깨가루', name: '시골향들깨가루(고운)/4kg' });

//  혼합원액(phantom) — 배합식으로 leaf 까지 펼쳐야 한다
const 혼합 = 품목({ id: 'wip-혼합', name: '참기름특A', subtype: '벌크', unit: 'kg', phantom: true });
const 특A = 품목({ id: 'p-특A', name: '참기름/특A/1750ml' });

//  조립 반제품(개 단위 wip) — 그 안으로 한 번 더 들어가야 한다
const 무라벨 = 품목({ id: 'wip-무라벨', name: '무라벨 참기름병', type: 'wip', unit: '개' });
const 선물세트 = 품목({ id: 'p-세트', name: '참기름 선물세트' });

const allItems = [참기름, 통깨참기름, 들깨가루, 혼합, 특A, 무라벨, 선물세트];

const bom: Record<string, string[]> = {
  'p-참기름': ['raw-통깨참기름'],
  'p-특A': ['wip-혼합'],
  'p-세트': ['wip-무라벨'],
  'wip-무라벨': ['raw-통깨참기름'],
};

const deps: RawUsersDeps = {
  allItems,
  bomOf: (id) => (bom[id] ?? []).map(childId => ({ childId })),
  buildFormula: (key) => {
    if (key === '참기름특A') return [{ raw: '통깨참기름' }, { raw: '깨분참기름' }];
    if (key === '시골향들깨가루(고운)/4kg') return [{ raw: '탈피들깨가루' }];
    return [];
  },
  baseRawName: (n) => String(n ?? '').split('/')[0].trim(),
};

describe('이 품목이 쓰는 원료', () => {
  it('BOM 의 벌크 구성품이 곧 원료다', () => {
    expect([...rawsOfProduct(참기름, deps)]).toEqual(['통깨참기름']);
  });

  it('phantom 반제품은 배합식으로 leaf 까지 편다', () => {
    expect([...rawsOfProduct(특A, deps)].sort()).toEqual(['깨분참기름', '통깨참기름']);
  });

  it('BOM 에 벌크가 없으면 품목 배합식으로 편다', () => {
    expect([...rawsOfProduct(들깨가루, deps)]).toEqual(['탈피들깨가루']);
  });

  it('조립 반제품(개 단위) 안으로 한 번 더 들어간다', () => {
    expect([...rawsOfProduct(선물세트, deps)]).toEqual(['통깨참기름']);
  });

  it('**품목 자체가 원료면 그것이다** — 볶음참깨를 그대로 파는 줄', () => {
    //  BOM·배합식만 보다가 이걸 빠뜨려, 정작 '볶음참깨' 한 줄짜리 주문이 안 골라졌다(정다운상회).
    expect([...rawsOfProduct(통깨참기름, deps)]).toEqual(['통깨참기름']);
  });

  it('phantom 벌크는 제 이름이 아니라 배합식으로 편다', () => {
    expect([...rawsOfProduct(혼합, deps)].sort()).toEqual(['깨분참기름', '통깨참기름']);
  });

  it('아무것도 모르면 빈 값 — 없는 걸 지어내지 않는다', () => {
    expect([...rawsOfProduct(품목({ id: 'p-몰라', name: '몰라' }), deps)]).toEqual([]);
    expect([...rawsOfProduct(undefined, deps)]).toEqual([]);
  });

  it('구성이 돌고 돌아도 멈춘다', () => {
    const 순환: Record<string, string[]> = { ...bom, 'p-세트': ['wip-무라벨'], 'wip-무라벨': ['p-세트'] };
    const d = { ...deps, bomOf: (id: string) => (순환[id] ?? []).map((childId: string) => ({ childId })) };
    expect(() => rawsOfProduct(선물세트, d)).not.toThrow();
  });
});

describe('주문 줄에서 이 원료를 쓰는 것만 고른다', () => {
  const 줄 = [
    { itemId: 'p-참기름', name: '참기름/병/1800ml' },
    { itemId: 'p-들깨가루', name: '시골향들깨가루(고운)/4kg' },
  ];

  it('**볶음참깨 줄에 들깨가루가 안 뜬다** — 사장님이 지적한 그것', () => {
    const 고른것 = orderLinesUsingRaw(줄, '통깨참기름', deps);
    expect(고른것?.map(l => l.itemId)).toEqual(['p-참기름']);
  });

  it('다른 원료로 물으면 다른 줄이 나온다', () => {
    expect(orderLinesUsingRaw(줄, '탈피들깨가루', deps)?.map(l => l.itemId)).toEqual(['p-들깨가루']);
  });

  it('하나도 못 고르면 undefined — 부르는 쪽이 예전처럼 전부 보여준다', () => {
    //  배합식이 아직 안 잡힌 품목까지 "안 썼다"고 감추면 기록이 사라진 것처럼 보인다.
    expect(orderLinesUsingRaw(줄, '깻묵', deps)).toBeUndefined();
    expect(orderLinesUsingRaw([], '통깨참기름', deps)).toBeUndefined();
    expect(orderLinesUsingRaw(undefined, '통깨참기름', deps)).toBeUndefined();
  });

  it('원료명에 규격이 붙어 와도 같은 것으로 본다', () => {
    expect(productUsesRaw(참기름, '통깨참기름/16.5kg', deps)).toBe(true);
  });
});
