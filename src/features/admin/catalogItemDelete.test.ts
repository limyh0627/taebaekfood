import { describe, expect, it } from 'vitest';
import { OrderStatus, type Item, type ItemBom, type Order, type PartnerItem } from '../../shared/types';
import { catalogItemDeleteBlockers, catalogItemDeleteBlockMessage, planCatalogItemDelete } from './catalogItemDelete';

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

  it('진행 중 주문만 삭제를 막고 주문번호·거래처·상태를 알려 준다', () => {
    const orders = [
      { id: 'ORD-1', partnerName: '가을식품', status: OrderStatus.PROCESSING, items: [{ itemId: 'child' }] },
      { id: 'ORD-2', partnerName: '해피유통', status: OrderStatus.SHIPPED, items: [{ itemId: 'child' }] },
      { id: 'ORD-OLD', partnerName: '옛 거래처', status: OrderStatus.DELIVERED, items: [{ itemId: 'child' }] },
      { id: 'ORD-OTHER', partnerName: '다른 거래처', status: OrderStatus.PENDING, items: [{ itemId: 'other' }] },
    ] as Order[];

    const blockers = catalogItemDeleteBlockers('child', orders);
    const message = catalogItemDeleteBlockMessage('자루', blockers);

    expect(blockers.map(order => order.id)).toEqual(['ORD-1', 'ORD-2']);
    expect(message).toContain('진행 중 주문 2건');
    expect(message).toContain('ORD-1 · 가을식품 · 작업중');
    expect(message).toContain('ORD-2 · 해피유통 · 출고완료');
    expect(message).not.toContain('ORD-OLD');
  });
});
