import { describe, expect, it } from 'vitest';
import type { Item, ItemBom } from './types';
import { crossCompanyBoms, itemsOfCompany } from './itemCompany';

const item = (id: string, companyId?: 'taebaek' | 'punghoe'): Item => ({
  id, companyId, name: id, type: 'raw', unit: 'kg', stock: 0, minStock: 0, image: '',
});
const bom = (id: string, parent_id: string, child_id: string): ItemBom => ({ id, parent_id, child_id, quantity: 1 });

describe('회사별 품목과 BOM', () => {
  it('회사 없는 옛 품목은 태백 목록에만 둔다', () => {
    const rows = [item('old'), item('tb', 'taebaek'), item('ph', 'punghoe')];
    expect(itemsOfCompany(rows, 'taebaek').map(x => x.id)).toEqual(['old', 'tb']);
    expect(itemsOfCompany(rows, 'punghoe').map(x => x.id)).toEqual(['ph']);
  });

  it('부모와 구성품 회사가 다른 BOM만 찾는다', () => {
    const rows = [item('tb-parent'), item('tb-child'), item('ph-child', 'punghoe')];
    const result = crossCompanyBoms([
      bom('ok', 'tb-parent', 'tb-child'),
      bom('bad', 'tb-parent', 'ph-child'),
    ], rows);
    expect(result).toEqual([expect.objectContaining({ bomId: 'bad', parentCompanyId: 'taebaek', childCompanyId: 'punghoe' })]);
  });
});
