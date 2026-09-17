import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildCostFn } from './bomCost';
import type { Item } from './types';

const item = (value: Partial<Item> & Pick<Item, 'id' | 'name' | 'type'>): Item => ({ stock: 0, ...value } as Item);

describe('반제품 원가 롤업', () => {
  it('직접 원료 BOM과 부자재를 합산한다', () => {
    const raw = item({ id: 'raw', name: '수입들깨', type: 'raw', cost: 1000, unit: 'kg' });
    const can = item({ id: 'can', name: '16.5kg 캔', type: 'submaterial', cost: 5000, unit: '개' });
    const wip = item({ id: 'wip', name: '생들기름/16.5kg', type: 'wip', cost: 0, costSource: 'rollup' });
    const cost = buildCostFn({
      allItems: [raw, can, wip],
      formulaOf: () => [],
      itemBoms: [
        { parent_id: 'wip', child_id: 'raw', quantity: 16.5 },
        { parent_id: 'wip', child_id: 'can', quantity: 1 },
      ],
    });

    expect(cost(wip)).toBe(21_500);
  });

  it('BOM 없는 반제품은 규격 꼬리를 뺀 원료식 이름으로 계산한다', () => {
    const raw = item({ id: 'raw', name: '수입들깨', type: 'raw', cost: 172000 / 16.5, unit: 'kg' });
    const wip = item({ id: 'wip', name: '생들기름/16.5kg', type: 'wip', cost: 0, costSource: 'rollup' });
    const cost = buildCostFn({
      allItems: [raw, wip],
      formulaOf: () => [],
      formulaRowsOf: key => key === '생들기름'
        ? [{ raw: '수입들깨', ratio: 1, yieldRate: 0.4 }]
        : [],
      itemBoms: [],
    });

    expect(cost(wip)).toBeCloseTo((172000 / 16.5) / 0.4, 5);
  });

  it('품목관리 원가 열도 저장값 대신 공통 롤업 원가를 받는다', () => {
    const adminApp = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');
    const itemManager = readFileSync('components/ItemManager.tsx', 'utf8');

    expect(adminApp).toContain('costOf={inventoryCostOf}');
    expect(itemManager).toContain('shownCostOf(item)');
  });
});
