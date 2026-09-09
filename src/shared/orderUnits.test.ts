import { describe, it, expect, beforeEach } from 'vitest';
import { boxDerivedUnitPrice, boxSiblings, isBoxStockItem, stockUnits, unpackComponent, 묶음갈래of } from './orderUnits';
import { buildBomIndex, setBomIndex } from './bomIndex';
import { toKg } from '../constants/formula';
import type { Item } from './types';

const 낱개ID = 'PLDhkjOgcPIhO1hhReHm';

const it_ = (o: Partial<Item> & { id: string }) =>
  ({ name: o.id, type: 'submaterial', unit: '개', stock: 0, minStock: 0, price: 0, ...o }) as Item;

/**
 * 구성은 이제 품목에 안 붙는다 — item_bom을 세워 두고 판정이 그걸 읽는다.
 * 예전 픽스처는 `{ submaterials: [...] }`를 품목에 달았다(shared/bomSource, 폐기).
 */
const 박스20 = it_({ id: '박스20', type: 'product' });
const 박스10 = it_({ id: '박스10', type: 'product' });
const 참기름300 = it_({ id: '참기름300', type: 'product' });
const 낱개 = it_({ id: 낱개ID, type: 'product' });
const box10 = it_({ id: 'box10', type: 'product' });
const box20 = it_({ id: 'box20', type: 'product' });
const other = it_({ id: 'other', type: 'product' });
const xxx = it_({ id: 'xxx', type: 'product' });

const ITEMS = [박스20, 박스10, 참기름300, 낱개, box10, box20, other, xxx,
  it_({ id: 'container-300' }), it_({ id: 'cap-300' })];

const bom = (parent: string, child: string, quantity: number) =>
  ({ parent_id: parent, child_id: child, quantity });

beforeEach(() => {
  setBomIndex(buildBomIndex(ITEMS, [
    bom('박스20', 낱개ID, 20),
    bom('박스10', 낱개ID, 10),
    bom('참기름300', 'container-300', 1),
    bom('참기름300', 'cap-300', 2),
    bom('box10', 낱개ID, 10),
    bom('box20', 낱개ID, 20),
    bom('other', 'xxx', 12),
  ]));
});

describe('unpackComponent — BOM에서 읽는다', () => {
  it('BOM에 든 완제품 구성품이 낱개', () => {
    expect(unpackComponent(박스20)).toEqual({ itemId: 낱개ID, count: 20 });
    expect(unpackComponent(박스10)).toEqual({ itemId: 낱개ID, count: 10 });
  });
  it('부자재만 있으면 박스 품목이 아니다', () => {
    expect(unpackComponent(참기름300)).toBeNull();
    expect(unpackComponent(낱개)).toBeNull();
    expect(unpackComponent(undefined)).toBeNull();
  });
  it('BOM에 없으면 옛 unpackTo로 폴백', () => {
    expect(unpackComponent(it_({ id: '옛품목', unpackTo: { itemId: 낱개ID, count: 20 } })))
      .toEqual({ itemId: 낱개ID, count: 20 });
  });
  it('BOM이 우선 — unpackTo와 다르면 BOM을 쓴다', () => {
    expect(unpackComponent({ ...박스20, unpackTo: { itemId: 'x', count: 99 } }))
      .toEqual({ itemId: 낱개ID, count: 20 });
  });
  it('BOM이 안 세워졌으면 아무것도 못 읽는다 — 로딩 전 상태', () => {
    setBomIndex(buildBomIndex(ITEMS, []));
    expect(unpackComponent(박스20)).toBeNull();
  });
});

describe('stockUnits', () => {
  it('일반 품목은 quantity 그대로', () => {
    expect(stockUnits({ quantity: 100 }, 참기름300)).toBe(100);
    expect(stockUnits({ quantity: 12, isBoxUnit: true, boxQuantity: 1 }, 참기름300)).toBe(12);
  });
  it('박스 품목은 박스 개수', () => {
    // 서래농산 20kg박스 5B → quantity=100(낱개kg), boxQuantity=5
    expect(stockUnits({ quantity: 100, isBoxUnit: true, boxQuantity: 5 }, 박스20)).toBe(5);
    // 무경유통 10kg박스 40B
    expect(stockUnits({ quantity: 400, isBoxUnit: true, boxQuantity: 40 }, 박스10)).toBe(40);
  });
  it('박스 개수로 들어오면 그대로 — 품목 들어간 수량만큼 빠진다', () => {
    // 주문 입력이 박스 기준으로 바뀐 뒤: quantity 자체가 박스 개수
    expect(stockUnits({ quantity: 5 }, 박스20)).toBe(5);
    expect(stockUnits({ quantity: 5, isBoxUnit: true, boxQuantity: 5 }, 박스20)).toBe(5);
  });
});

describe('원료 kg 환산 — spec은 재고 1단위의 내용량', () => {
  it('박스 품목: 20kg × 5B = 100kg', () => {
    const q = stockUnits({ quantity: 100, isBoxUnit: true, boxQuantity: 5 }, 박스20);
    expect(toKg('20kg', '볶음참깨', q)).toBe(100);
  });
  it('quantity를 그대로 넣으면 20배가 된다 (고치기 전 동작)', () => {
    expect(toKg('20kg', '볶음참깨', 100)).toBe(2000);
  });
  it('일반 완제품은 영향 없음 — 300ml 참기름 100병', () => {
    const q = stockUnits({ quantity: 100 }, 참기름300);
    expect(toKg('300ml', '통깨참기름', q)).toBeCloseTo(27.48, 6);
  });
});

describe('boxSiblings — 낱개↔박스 짝', () => {
  it('이 낱개를 가리키는 박스만, count 오름차순', () => {
    const r = boxSiblings(낱개, [box20, box10, other, 낱개]);
    expect(r.map(x => x.item.id)).toEqual(['box10', 'box20']);
    expect(r.map(x => x.count)).toEqual([10, 20]);
  });
  it('짝 없으면 빈 배열', () => {
    expect(boxSiblings({ id: 'zzz' }, [box10, box20])).toEqual([]);
  });
  it('archived 박스는 제외', () => {
    expect(boxSiblings(낱개, [{ ...box10, archived: true }, box20])).toHaveLength(1);
  });
  it('옛 unpackTo 품목도 짝으로 잡는다 — BOM에는 안 잡히는 자리', () => {
    const 옛박스 = it_({ id: '옛박스', type: 'product', unpackTo: { itemId: 낱개ID, count: 6 } });
    expect(boxSiblings(낱개, [옛박스, box20]).map(x => x.count)).toEqual([6, 20]);
  });
});

describe('boxDerivedUnitPrice — 낱개 × 개입수', () => {
  const pi = [{ itemId: 낱개ID, partnerId: 'C1', price: 7500 }, { itemId: 낱개ID, partnerId: 'C2', price: 8000 }];
  it('박스 = 낱개 단가 × 개입수', () => {
    expect(boxDerivedUnitPrice(박스20, 'C1', pi)).toBe(150000); // 7500×20
    expect(boxDerivedUnitPrice(박스10, 'C2', pi)).toBe(80000);  // 8000×10
  });
  it('낱개 단가 없으면 undefined', () => {
    expect(boxDerivedUnitPrice(박스20, 'C9', pi)).toBeUndefined();
  });
  it('박스 아니면 undefined', () => {
    expect(boxDerivedUnitPrice(참기름300, 'C1', pi)).toBeUndefined();
  });
});

describe('isBoxStockItem', () => {
  it('BOM에 낱개가 물려 있으면 박스 재고 품목', () => {
    expect(isBoxStockItem(박스20)).toBe(true);
    expect(isBoxStockItem(참기름300)).toBe(false);
  });
  it('×1은 박스가 아니다 — 재포장이지 묶음이 아니다', () => {
    const 한개 = it_({ id: '한개짜리', type: 'product' });
    setBomIndex(buildBomIndex([...ITEMS, 한개], [bom('한개짜리', 낱개ID, 1)]));
    expect(isBoxStockItem(한개)).toBe(false);
  });
});

/**
 * **박스와 선물세트는 한 규칙이 가른다.**
 *
 * 서류(원료수불부·생산작업기록부·판매일지)에서 **둘 다 든 완제품으로 풀린다**
 * (2026-09-06 사장님: "박스품목 서류에 들어가는거랑 통합해서 처리해").
 * 그래서 둘 다 자기 서류용 품목·규격이 없어도 된다 — 품목 등록 화면도 이 판정을 쓴다.
 */
describe('묶음 갈래', () => {
  it('같은 것 여러 개 = 박스', () => {
    expect(묶음갈래of([{ qty: 20 }])).toBe('박스');
    expect(묶음갈래of([{ qty: 2 }])).toBe('박스');
  });

  it('다른 것을 모으면 = 세트', () => {
    expect(묶음갈래of([{ qty: 1 }, { qty: 1 }])).toBe('세트');
    expect(묶음갈래of([{ qty: 2 }, { qty: 1 }]), '같은 것을 둘 담아도 종류가 여럿이면 세트').toBe('세트');
    expect(묶음갈래of([{ qty: 1 }, { qty: 1 }, { qty: 1 }])).toBe('세트');
  });

  it('완제품을 하나만 1개 담으면 묶음이 아니다 — 그냥 그 품목이다', () => {
    expect(묶음갈래of([{ qty: 1 }])).toBeNull();
  });

  it('완제품 구성품이 없으면 묶음이 아니다', () => {
    expect(묶음갈래of([])).toBeNull();
  });
});

/**
 * **박스 품목이면 `isBoxUnit` 을 안 본다**(2026-09-09 사장님:
 * "박스 품목으로 주문 들어오면 isBoxUnit 이 true 일 필요는 없는거야?").
 *
 * 품목이 이미 "나는 박스다" 라고 말하는데 줄에도 같은 사실이 또 있었고, 그 둘이 갈려서
 * 무경유통 볶음참깨가 2,000kg 빠졌다 — 박스 20으로 넣고 낱개로 토글하니 `isBoxUnit` 만
 * 꺼지고 `quantity` 는 낱개(200)로 남아 여기서 200을 박스로 읽었다.
 */
describe('박스 품목의 재고 차감 수량', () => {
  //  box10 은 위 픽스처에서 낱개가 10개 물린 박스 품목이다
  it('박스 수가 적혀 있으면 그게 임자다', () => {
    expect(stockUnits({ quantity: 200, boxQuantity: 20, isBoxUnit: true }, box10)).toBe(20);
  });

  it('**isBoxUnit 이 꺼져 있어도 박스 수를 본다** — 갈린 줄에서 200을 박스로 읽으면 안 된다', () => {
    expect(stockUnits({ quantity: 200, boxQuantity: 20, isBoxUnit: false }, box10)).toBe(20);
  });

  it('박스 수가 없으면 quantity 가 박스 수다 — 운영 데이터 309줄이 그 모양이다', () => {
    expect(stockUnits({ quantity: 50, isBoxUnit: false }, box10)).toBe(50);
  });

  it('박스 품목이 아니면 quantity 그대로 — 향미유는 낱개로 센다', () => {
    expect(stockUnits({ quantity: 60, boxQuantity: 5, isBoxUnit: true }, 참기름300)).toBe(60);
  });
});
