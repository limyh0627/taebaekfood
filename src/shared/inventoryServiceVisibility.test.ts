import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPhysicalInventoryItem } from './itemTaxonomy';

describe('용역과 재고 화면의 경계', () => {
  it('수량과 원가가 입력된 용역도 실물 재고에서 제외한다', () => {
    const items = [
      { id: 'service', type: 'service', stock: 5, cost: 100_000 },
      { id: 'raw', type: 'raw', stock: 0, cost: 8_000 },
      { id: 'product', type: 'product', stock: 2, cost: 12_000 },
    ];
    expect(items.filter(isPhysicalInventoryItem).map(item => item.id)).toEqual(['raw', 'product']);
  });

  it('재고 목록·로트·재고평가·월말 스냅샷이 같은 판정을 사용한다', () => {
    const list = readFileSync('components/ItemList.tsx', 'utf8');
    const valuation = readFileSync('components/ProfitAnalysis.tsx', 'utf8');
    const app = readFileSync('src/features/admin/AdminApp.tsx', 'utf8');

    expect(list).toContain('const inventoryItems = useMemo(() => items.filter(isPhysicalInventoryItem), [items]);');
    expect(list).toContain('const lotItems = useMemo(() => inventoryItems');
    expect(list).toContain('taxo.types.filter(t => isPhysicalInventoryItem({ type: t.key }))');
    expect(list).toContain('result = inventoryItems.filter(p => !p.archived);');
    expect(valuation).toContain('companyOf(p) === companyId && isPhysicalInventoryItem(p)');
    expect(app).toContain('allItems.filter(p => isPhysicalInventoryItem(p)');
  });
});
