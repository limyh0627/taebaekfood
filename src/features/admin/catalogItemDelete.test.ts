import { describe, expect, it } from 'vitest';
import type { Item, ItemBom, PartnerItem } from '../../shared/types';
import { planCatalogItemDelete } from './catalogItemDelete';

describe('품목 삭제 계획', () => {
  it('부모·자기 BOM과 거래처 연결을 모으고 부모 품목명을 경고한다', () => {
    const items = [
      { id: 'child', name: '자루' },
      { id: 'box-a', name: '들깨가루 4kg 박스' },
      { id: 'box-b', name: '참깨 20kg 박스' },
    ] as Item[];
    const boms = [
      { id: 'bom-a', parent_id: 'box-a', child_id: 'child', quantity: 1 },
      { id: 'bom-b', parent_id: 'box-b', child_id: 'child', quantity: 1 },
      { id: 'bom-own', parent_id: 'child', child_id: 'inner', quantity: 2 },
      { id: 'other', parent_id: 'box-a', child_id: 'other', quantity: 1 },
    ] as ItemBom[];
    const links = [
      { id: 'link-a', itemId: 'child' },
      { id: 'link-other', itemId: 'other' },
    ] as PartnerItem[];

    const plan = planCatalogItemDelete('child', items, boms, links);

    expect(plan.bomIds).toEqual(['bom-a', 'bom-b', 'bom-own']);
    expect(plan.partnerItemIds).toEqual(['link-a']);
    expect(plan.parentNames).toEqual(['들깨가루 4kg 박스', '참깨 20kg 박스']);
    expect(plan.subMessage).toContain('들깨가루 4kg 박스, 참깨 20kg 박스의 BOM');
    expect(plan.subMessage).toContain('자체의 BOM 1줄');
    expect(plan.subMessage).toContain('자동 제거');
  });
});
