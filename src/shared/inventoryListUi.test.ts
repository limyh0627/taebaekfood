import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('components/ItemList.tsx', 'utf8');

describe('재고 목록 표시 규칙', () => {
  it('상품 발주는 낱개로 고정하고 박스 수는 안내만 한다', () => {
    expect(src).toContain("const canOrderByBox = product.type !== 'goods'");
    expect(src).toContain("product.type === 'goods' && unitsPerBoxOf(product) > 1");
    expect(src).toContain('boxEquivalentLabel(inlineCartQty, unitsPerBoxOf(product))');
  });

  it('카테고리와 서브타입은 목록과 필터에서 숨긴다', () => {
    const inventoryFilters = src.slice(src.indexOf('/* ── 서브타입'), src.indexOf('/* 입고처리 오버레이 */'));
    expect(src).not.toContain('>카테고리</th>');
    expect(src).not.toContain('>서브타입</th>');
    expect(inventoryFilters).not.toContain('<FilterDrop label="서브타입"');
    expect(inventoryFilters).not.toContain('<FilterDrop label="분류"');
  });

  it('입고와 반품은 한 목록에서 유형·상태로 걸러 보고 상태 버튼은 확인창을 거친다', () => {
    expect(src).toContain("type FlowTypeFilter = '전체' | '입고' | '반품'");
    expect(src).toContain("type FlowStatusFilter = '전체' | '예정' | '대기' | '완료'");
    expect(src).toContain('발주를 입고대기로 옮길까요?');
    expect(src).toContain('품목을 입고 완료 처리할까요?');
    expect(src).toContain('requestTransition(row)');
  });

  it('재고 목록의 품목명과 규격은 서로 다른 열이다', () => {
    expect(src).toContain('>품목명</th>');
    expect(src).toContain('>규격</th>');
    expect(src).toContain('{inventoryNameSpec(product).name}');
    expect(src).toContain('{inventoryNameSpec(product).spec}');
    expect(src).not.toContain('>라벨</th>');
    expect(src).toContain("p.subtype === '선물세트'");
  });

  it('거래처는 규격 뒤에 오고 행을 누르면 상세카드에서 동작한다', () => {
    const table = src.slice(src.indexOf('/* ── 재고 현황: 테이블 뷰 ── */'));
    expect(table.indexOf('>품목명</th>')).toBeLessThan(table.indexOf('>규격</th>'));
    expect(table.indexOf('>규격</th>')).toBeLessThan(table.indexOf('>거래처</th>'));
    expect(src).toContain('setDetailProduct(product)');
    expect(src).toContain('발주 담기');
    expect(src).toContain('>개봉</button>');
    expect(src).toContain('>실사 반영</button>');
    expect(src).toContain('별도의 입출고, 생산과정 없이 재고수량이 변경됩니다.');
  });

  it('재고관리 내부 탭이 아니라 별도 생산관리 메뉴에서 생산·로트를 연다', () => {
    expect(src).toContain("mode?: 'inventory' | 'lots'");
    expect(src).toContain("mode === 'lots' ? '생산 관리' : '재고 관리'");
    expect(src).toContain("setActiveTab('production')");
    expect(src).not.toContain('<span>로트 관리</span>');
  });

  it('출고 전 주문에서 작업완료된 품목 줄만 실제 출고 수량으로 합산한다', () => {
    expect(src).toContain('>출고예정　가용재고</th>');
    expect(src).toContain('if (!line.checked) continue;');
    expect(src).toContain('shipQtyOfLine(line, product)');
    expect(src).toContain('scheduledOutboundQty.get(product.id) ?? 0');
    expect(src).not.toContain("isCritical ? 'bg-rose-50/30");
  });
});
