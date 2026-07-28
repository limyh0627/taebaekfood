import { describe, it, expect } from 'vitest';
import { buildSubmaterialsFromBom, withDerivedSubmaterials } from './bomSource';
import { unpackComponent, isBoxStockItem } from './orderUnits';
import { bomQty } from './bom';
import { Item, ItemBom } from './types';

const mk = (p: Partial<Item> & { id: string; name: string; category: string }): Item =>
  ({ stock: 0, ...p } as Item);

// 낱개 + 카톤 + 테이프
const 낱개 = mk({ id: 'loose', name: '볶음참깨-낱개/1kg', category: 'product', spec: '1kg', unit: '개', cost: 5100 });
const 카톤 = mk({ id: 'B-06', name: '6호박스', category: 'submaterial', subtype: '박스', unit: '개', cost: 1045 } as any);
const 테이프 = mk({ id: 'T-TR', name: '테이프-투명', category: 'submaterial', subtype: '테이프', unit: '개' } as any);
const 박스 = mk({ id: 'box10', name: '볶음참깨/10kg박스', category: 'product', spec: '10kg', unit: '개' });
const items = [낱개, 카톤, 테이프, 박스];

// item_bom: 박스 = 낱개×10 + 6호박스×1 + 테이프×0
const boms: ItemBom[] = [
  { id: 'b1', parent_id: 'box10', child_id: 'loose', quantity: 10 },
  { id: 'b2', parent_id: 'box10', child_id: 'B-06', quantity: 1 },
  { id: 'b3', parent_id: 'box10', child_id: 'T-TR', quantity: 0 },
];

describe('bomSource — buildSubmaterialsFromBom', () => {
  const map = buildSubmaterialsFromBom(items, boms);
  const boxSubs = map.get('box10')!;

  it('item_bom을 부모별 submaterials로 묶는다', () => {
    expect(boxSubs).toHaveLength(3);
    expect(boxSubs.map(s => s.id).sort()).toEqual(['B-06', 'T-TR', 'loose']);
  });

  it('quantity가 stock(개입수)로 들어간다', () => {
    expect(boxSubs.find(s => s.id === 'loose')!.stock).toBe(10);
    expect(boxSubs.find(s => s.id === 'B-06')!.stock).toBe(1);
    expect(boxSubs.find(s => s.id === 'T-TR')!.stock).toBe(0);
  });

  it('category는 자식 품목 것을 따른다 (낱개=product, 카톤=submaterial)', () => {
    expect(boxSubs.find(s => s.id === 'loose')!.category).toBe('product');
    expect(boxSubs.find(s => s.id === 'B-06')!.category).toBe('submaterial');
  });

  it('이름·원가·규격을 자식에서 채운다', () => {
    const loose = boxSubs.find(s => s.id === 'loose')!;
    expect(loose.name).toBe('볶음참깨-낱개/1kg');
    expect(loose.cost).toBe(5100);
    expect(loose.spec).toBe('1kg');
  });

  it('구성 없는 품목은 맵에 없다', () => {
    expect(map.has('loose')).toBe(false);
  });
});

describe('bomSource — 기존 소비자와 호환', () => {
  const derived = withDerivedSubmaterials(items, boms);
  const box = derived.find(i => i.id === 'box10')!;
  const loose = derived.find(i => i.id === 'loose')!;

  it('submaterials를 파생값으로 교체', () => {
    expect(box.submaterials).toHaveLength(3);
    expect(loose.submaterials).toEqual([]);
  });

  it('unpackComponent가 낱개×10을 뽑아낸다 (박스 인식)', () => {
    expect(unpackComponent(box)).toEqual({ itemId: 'loose', count: 10 });
    expect(isBoxStockItem(box)).toBe(true);
    expect(isBoxStockItem(loose)).toBe(false);
  });

  it('bomQty가 테이프 0(차감안함)을 유지', () => {
    const tape = box.submaterials!.find(s => s.id === 'T-TR')!;
    expect(bomQty(tape)).toBe(0);
    const carton = box.submaterials!.find(s => s.id === 'B-06')!;
    expect(bomQty(carton)).toBe(1);
  });
});
