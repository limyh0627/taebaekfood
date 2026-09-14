import { describe, it, expect } from 'vitest';
import { diffOrderItems } from './orderItemDiff';
import type { OrderItem } from './types';

/**
 * 주문 품목을 누가 언제 어떻게 고쳤나(2026-09-14 사장님: "2번도 했으면 좋겠는데").
 * 라벨·제조일·비고는 줄 자체에 사람이 찍히므로 **여기서 안 센다** — 세면 로그에 두 줄로 선다.
 */
const 줄 = (over: Partial<OrderItem> = {}): OrderItem =>
  ({ lineId: 'L1', itemId: 'p1', name: '볶음참깨/1kg', quantity: 5, price: 1000, ...over } as OrderItem);

describe('주문 품목 수정 차이', () => {
  it('안 바뀌면 아무것도 안 낸다', () => {
    expect(diffOrderItems([줄()], [줄()])).toEqual([]);
  });

  it('수량이 바뀌면 이전 → 지금으로 적는다', () => {
    const out = diffOrderItems([줄()], [줄({ quantity: 8 })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'qty', text: '수량 — 볶음참깨/1kg 5개 → 8개' });
  });

  it('박스 줄은 박스 수로 적는다 — 낱개만 보면 몇 박스인지 모른다', () => {
    const 박스 = (n: number) => 줄({ isBoxUnit: true, boxQuantity: n, quantity: n * 10, unitsPerBox: 10 });
    expect(diffOrderItems([박스(5)], [박스(8)])[0].text).toBe('수량 — 볶음참깨/1kg 5박스 (50개) → 8박스 (80개)');
  });

  it('줄을 넣으면 추가로, 빼면 삭제로 적는다', () => {
    const 둘째 = 줄({ lineId: 'L2', itemId: 'p2', name: '참기름', quantity: 2 });
    expect(diffOrderItems([줄()], [줄(), 둘째])[0]).toMatchObject({ kind: 'add', text: '품목 추가 — 참기름 2개' });
    expect(diffOrderItems([줄(), 둘째], [줄()])[0]).toMatchObject({ kind: 'remove', text: '품목 삭제 — 참기름 2개' });
  });

  it('가운데 줄을 지워도 아래 줄이 밀려 "품목 교체"로 찍히지 않는다', () => {
    const 가 = 줄({ lineId: 'A', itemId: 'p1', name: '가' });
    const 나 = 줄({ lineId: 'B', itemId: 'p2', name: '나' });
    const 다 = 줄({ lineId: 'C', itemId: 'p3', name: '다' });
    const out = diffOrderItems([가, 나, 다], [가, 다]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'remove', name: '나' });
  });

  it('lineId 가 없는 옛 줄도 같은 품목끼리 짝지어 본다', () => {
    const 옛 = { itemId: 'p1', name: '볶음참깨/1kg', quantity: 5, price: 1000 } as OrderItem;
    const out = diffOrderItems([옛], [{ ...옛, quantity: 7 }]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('qty');
  });

  it('같은 줄에서 품목이 바뀌면 교체로 적는다', () => {
    expect(diffOrderItems([줄()], [줄({ itemId: 'p9', name: '참기름' })])[0])
      .toMatchObject({ kind: 'item', text: '품목 교체 — 볶음참깨/1kg → 참기름' });
  });

  it('단가가 바뀌면 원 단위로 적는다', () => {
    expect(diffOrderItems([줄()], [줄({ price: 12500 })])[0])
      .toMatchObject({ kind: 'price', text: '단가 — 볶음참깨/1kg 1,000 → 12,500원' });
  });

  it('품목을 아직 안 고른 빈 줄은 안 센다 — 저장되지도 않는다', () => {
    expect(diffOrderItems([줄()], [줄(), { itemId: '', name: '', quantity: 1, price: 0 } as OrderItem])).toEqual([]);
  });

  it('라벨·제조일·비고는 안 센다 — 줄 자체에 사람이 찍힌다', () => {
    expect(diffOrderItems([줄()], [줄({ labelType: '부착', mfgDate: '2026-09-11', note: '급함' })])).toEqual([]);
  });

  it('한 번에 여럿 바뀌면 여럿 낸다', () => {
    const out = diffOrderItems([줄(), 줄({ lineId: 'L2', itemId: 'p2', name: '참기름' })], [줄({ quantity: 9 })]);
    expect(out.map(c => c.kind)).toEqual(['qty', 'remove']);
  });
});
