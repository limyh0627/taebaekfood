import { describe, expect, it } from 'vitest';
import type { Item } from './types';
import { hasInboundInventoryLines, isInboundInventoryItem } from './inboundInventory';

const 품목 = (type: string, subtype?: string) => ({ id: type, type, subtype } as Item);

describe('매입전표 입고대기 확인 대상', () => {
  it.each(['raw', 'wip', 'product', 'goods', 'submaterial'])('%s 재고 품목은 대상이다', type => {
    expect(isInboundInventoryItem(품목(type))).toBe(true);
  });

  it('옛 한글 분류도 재고 품목으로 읽는다', () => {
    expect(isInboundInventoryItem(품목('완제품'))).toBe(true);
    expect(isInboundInventoryItem(품목('용기'))).toBe(true);
  });

  it('비용 줄·직접 입력 줄·배송 서비스는 대상이 아니다', () => {
    expect(isInboundInventoryItem(품목('service'))).toBe(false);
    expect(isInboundInventoryItem(undefined)).toBe(false);
    expect(isInboundInventoryItem(품목('product', '배송'))).toBe(false);
  });

  it('전표 줄 중 실물 재고가 하나라도 있을 때만 확인한다', () => {
    const items = [품목('service'), { ...품목('goods'), id: '상품' }];
    expect(hasInboundInventoryLines([{ itemId: 'service' }], items)).toBe(false);
    expect(hasInboundInventoryLines([{ itemId: 'service' }, { itemId: '상품' }], items)).toBe(true);
  });
});
