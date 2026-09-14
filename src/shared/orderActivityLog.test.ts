import { describe, it, expect } from 'vitest';
import { buildOrderActivityLog } from './orderActivityLog';
import { stampOrderItemEdits } from './stampOrderItemEdits';
import { OrderStatus, type Order, type OrderItem, type OrderStatusAudit } from './types';

/**
 * 주문 수정 창의 '로그' — 누가 무엇을 언제 했나(2026-09-14 사장님).
 * 새로 기록하지 않고 **이미 남아 있는 것**을 모아 읽는다.
 */
const 주문 = (over: Partial<Order> = {}): Order => ({
  id: 'o1', partnerName: '완도식품', createdAt: '2026-09-07T01:00:00.000Z', createdBy: '남명숙',
  items: [], status: OrderStatus.PROCESSING,
  ...over,
} as unknown as Order);

const 감사 = (over: Partial<OrderStatusAudit> = {}): OrderStatusAudit => ({
  id: 'a1', orderId: 'o1', partnerName: '완도식품',
  previousStatus: OrderStatus.PROCESSING, nextStatus: OrderStatus.DISPATCHED,
  approvedBy: '윤주임', approvedAt: '2026-09-11T02:00:00.000Z', completedAt: '2026-09-11T02:00:05.000Z',
  state: 'completed', legacyEvidenceWarning: false, stockAdjustments: [],
  ...over,
} as OrderStatusAudit);

describe('주문 로그', () => {
  it('주문 넣은 사람과 일시가 맨 아래 한 줄로 선다', () => {
    const rows = buildOrderActivityLog(주문(), []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ what: '주문 등록', who: '남명숙', at: '2026-09-07T01:00:00.000Z' });
  });

  it('넣은 사람이 비면 거래처 포털 주문이라고 까닭을 적는다', () => {
    const rows = buildOrderActivityLog(주문({ createdBy: undefined }), []);
    expect(rows[0].who).toBe('미기록');
    expect(rows[0].detail).toContain('거래처 포털');
  });

  it('상태 변경은 누가·언제·재고 몇 건인지 적는다', () => {
    const rows = buildOrderActivityLog(주문(), [감사({
      stockAdjustments: [{ itemId: 'a', name: '참깨', unit: 'kg', delta: -5 }, { itemId: 'b', name: '캡', unit: '개', delta: 0 }],
    })]);
    const 상태 = rows.find(r => r.kind === 'status')!;
    expect(상태.what).toBe('작업중 → 작업완료');
    expect(상태.who).toBe('윤주임');
    //  0 인 줄은 안 센다 — 안 움직인 것을 셈에 넣으면 숫자가 거짓말이 된다.
    expect(상태.detail).toBe('재고 1건');
  });

  it('끝난 시각이 있으면 승인 시각이 아니라 끝난 시각으로 줄을 세운다', () => {
    const rows = buildOrderActivityLog(주문(), [감사()]);
    expect(rows.find(r => r.kind === 'status')!.at).toBe('2026-09-11T02:00:05.000Z');
  });

  it('실패한 상태 변경은 사유까지 적는다', () => {
    const rows = buildOrderActivityLog(주문(), [감사({ state: 'failed', error: '재고 부족' })]);
    const 실패 = rows.find(r => r.kind === 'fail')!;
    expect(실패.detail).toBe('실패 — 재고 부족');
  });

  it('품목 작업완료·라벨·제조일·비고가 각각 한 줄씩 선다', () => {
    const rows = buildOrderActivityLog(주문({
      items: [{
        lineId: 'L1', itemId: 'p1', name: '볶음참깨/1kg', quantity: 5, price: 0,
        checked: true, checkedBy: '박주임', checkedAt: '2026-09-12T01:00:00.000Z',
        labelType: '부착', labelBy: '이실장', labelAt: '2026-09-12T02:00:00.000Z',
        mfgDate: '2026-09-11', mfgBy: '이실장', mfgAt: '2026-09-12T02:30:00.000Z',
        note: '급함', noteBy: '사장', noteAt: '2026-09-12T03:00:00.000Z',
      } as OrderItem],
    }), []);
    expect(rows.map(r => r.what)).toEqual([
      '비고 — 볶음참깨/1kg',
      '제조일 2026-09-11 — 볶음참깨/1kg',
      '라벨 부착 — 볶음참깨/1kg',
      '작업완료 — 볶음참깨/1kg',
      '주문 등록',
    ]);
    expect(rows[0].detail).toBe('급함');
  });

  it('시각이 없는 옛 기록은 맨 뒤로 보낸다', () => {
    const rows = buildOrderActivityLog(주문({
      items: [{ itemId: 'p1', name: '옛줄', quantity: 1, price: 0, checkedBy: '누군가' } as OrderItem],
    }), []);
    expect(rows[rows.length - 1].what).toBe('작업완료 — 옛줄');
  });

  /*  `Order.createdBy` 에는 이름이 아니라 사번이 들어간다(AddOrder 저장 경로).
      그대로 띄우면 화면에 사번이 뜬다. */
  it('주문 넣은 사람이 사번으로 적혀 있으면 이름으로 푼다', () => {
    const rows = buildOrderActivityLog(주문({ createdBy: 'u-17' }), [], key => ({ 'u-17': '남명숙' } as Record<string, string>)[key]);
    expect(rows[0].who).toBe('남명숙');
  });

  it('못 푸는 사번은 적힌 그대로 둔다 — 이름이 적힌 칸은 그냥 지난다', () => {
    const rows = buildOrderActivityLog(주문({ createdBy: 'u-99' }), [], () => undefined);
    expect(rows[0].who).toBe('u-99');
  });

  it('출고 확인도 줄로 선다', () => {
    const rows = buildOrderActivityLog(주문({ shipmentConfirmedBy: '윤주임', shipmentConfirmedAt: '2026-09-13T05:00:00.000Z' }), []);
    expect(rows[0]).toMatchObject({ what: '출고 확인', who: '윤주임' });
  });
});

/**
 * 라벨·제조일에는 사람이 안 남고 있었다 — 저장하는 문 한 곳에서 찍는다.
 */
describe('라벨·제조일에 사람과 시각 찍기', () => {
  const 줄 = (over: Partial<OrderItem> = {}): OrderItem =>
    ({ lineId: 'L1', itemId: 'p1', name: '볶음참깨/1kg', quantity: 5, price: 0, ...over } as OrderItem);
  const 때 = '2026-09-14T04:00:00.000Z';

  it('라벨이 바뀐 줄에만 찍는다', () => {
    const after = stampOrderItemEdits(
      [줄(), 줄({ lineId: 'L2', itemId: 'p2', name: '참기름' })],
      [줄({ labelType: '부착' }), 줄({ lineId: 'L2', itemId: 'p2', name: '참기름' })],
      '이실장', 때);
    expect(after[0]).toMatchObject({ labelBy: '이실장', labelAt: 때 });
    expect(after[1].labelBy).toBeUndefined();
  });

  it('제조일이 바뀌면 제조일 쪽에 찍는다 — 라벨은 안 건드린다', () => {
    const after = stampOrderItemEdits([줄()], [줄({ mfgDate: '2026-09-11' })], '이실장', 때);
    expect(after[0]).toMatchObject({ mfgBy: '이실장', mfgAt: 때 });
    expect(after[0].labelBy).toBeUndefined();
  });

  it('줄 순서가 밀려도 lineId 로 찾아 엉뚱한 줄에 안 찍는다', () => {
    const before = [줄({ lineId: 'L1' }), 줄({ lineId: 'L2', itemId: 'p2', labelType: '부착' })];
    const after = stampOrderItemEdits(before, [줄({ lineId: 'L2', itemId: 'p2', labelType: '부착' })], '이실장', 때);
    expect(after[0].labelBy).toBeUndefined();
  });

  it('새로 넣은 줄에는 안 찍는다', () => {
    const after = stampOrderItemEdits([줄()], [줄(), { itemId: 'p9', name: '새줄', quantity: 1, price: 0 } as OrderItem], '이실장', 때);
    expect(after[1].labelBy).toBeUndefined();
  });

  it('안 바뀌면 아무것도 안 찍는다 — 같은 객체를 그대로 돌려준다', () => {
    const items = [줄({ labelType: '날인' })];
    expect(stampOrderItemEdits(items, items, '이실장', 때)[0]).toBe(items[0]);
  });

  it('사람 이름이 없으면 미기록으로 남긴다 — 빈칸으로 두면 누락인지 모른다', () => {
    expect(stampOrderItemEdits([줄()], [줄({ labelType: '부착' })], undefined, 때)[0].labelBy).toBe('미기록');
  });
});
