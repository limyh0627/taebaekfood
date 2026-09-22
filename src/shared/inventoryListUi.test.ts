import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('components/ItemList.tsx', 'utf8');

describe('재고 목록 표시 규칙', () => {
  it('상품 발주는 낱개로 고정하고 박스 수는 안내만 한다', () => {
    expect(src).toContain("const canOrderByBox = product.type !== 'goods'");
    expect(src).toContain("product.type === 'goods' && unitsPerBoxOf(product) > 1");
    expect(src).toContain('boxEquivalentLabel(inlineCartQty, unitsPerBoxOf(product))');
  });

  it('서브타입과 카테고리는 목록에서 배경 없는 글자로 표시한다', () => {
    expect(src).toContain('>{product.subtype}</span>');
    expect(src).toContain('{categoryOf(product) || \'-\'}</span>');
  });

  it('재고 목록의 품목명과 규격은 서로 다른 열이다', () => {
    expect(src).toContain('>품목명</th>');
    expect(src).toContain('>규격</th>');
    expect(src).toContain('{inventoryNameSpec(product).name}');
    expect(src).toContain('{inventoryNameSpec(product).spec}');
    expect(src).not.toContain('>라벨</th>');
  });

  it('출고 전 주문 수량을 별도 열로 합산하고 부족 행에 바탕색을 칠하지 않는다', () => {
    expect(src).toContain('>출고예정수량</th>');
    expect(src).toContain('scheduledOutboundQty.get(product.id) ?? 0');
    expect(src).not.toContain("isCritical ? 'bg-rose-50/30");
  });
});
