import { describe, it, expect } from 'vitest';
import { buildRollbackPlan, buildStatusChangeAsk } from './rollbackSummary';
import { OrderStatus, type Item, type Order } from '../../shared/types';

/**
 * 작업완료·출고에서 되돌릴 때 **무엇이 되돌아오는지** 적어 보여주고 확인을 받는다.
 * 되돌리기는 재고를 조용히 움직여서, 눌러 놓고 나중에 "왜 재고가 늘었지"로 만나면 되짚기 어렵다.
 */
const items = [
  { id: 'box', name: '시골향참기름/A/1750ml', spec: '1750ml * 10', unit: '박스' },
  { id: 'loose', name: '시골향참기름/A/1750ml', spec: '1750ml', unit: '병' },
] as unknown as Item[];

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1', partnerName: '거산농산', status: OrderStatus.DISPATCHED,
  items: [{ itemId: 'box', name: '시골향참기름/A/1750ml', quantity: 3 } as never],
  ...over,
} as unknown as Order);

describe('되돌리기 안내문', () => {
  it('출고된 건이면 재고가 다시 는다고 알린다', () => {
    const p = buildRollbackPlan(order({ shippedOut: true }), items, OrderStatus.SHIPPED, OrderStatus.PENDING);
    expect(p.needed).toBe(true);
    expect(p.text).toContain("'출고' → '대기중'로 되돌립니다.");
    expect(p.text).toContain('시골향참기름/A/1750ml 1750ml * 10 +3');
  });

  it('생산분과 원료를 각각 적는다', () => {
    const p = buildRollbackPlan(order({
      producedUnits: [{ itemId: 'box', qty: 3 }],
      rawConsumedLots: [
        { material: '깨분참기름', supplierName: '청정', kg: 38.472 },
        { material: '깨분참기름', supplierName: '이월', kg: 1.528 },
        { material: '통깨참기름', supplierName: '압착', kg: 9.618 },
      ],
    } as never), items, OrderStatus.DISPATCHED, OrderStatus.PROCESSING);
    expect(p.text).toContain('시골향참기름/A/1750ml 1750ml * 10 −3');
    expect(p.text).toContain('깨분참기름 40kg');       // 같은 원료는 합쳐 적는다
    expect(p.text).toContain('통깨참기름 9.618kg');
    expect(p.text).toContain('원료수불부에는 사용 취소 이력이 뒤에 기록됩니다');
  });

  it('임가공 원장 전용 줄은 로트 복원으로 안내하지 않는다', () => {
    const p = buildRollbackPlan(order({
      producedAt: '2026-09-13T00:00:00.000Z',
      rawConsumedLots: [{
        material: '볶음참깨', rawItemId: 'raw-oem', operationId: 'oem-use-1',
        supplierName: '임가공', kg: 30, ledgerOnly: true,
      }],
    }), items, OrderStatus.DISPATCHED, OrderStatus.PENDING);
    expect(p.text).toContain('임가공 사용 기록만 취소됩니다: 볶음참깨 30kg');
    expect(p.text).toContain('실물 수량은 여기서 다시 움직이지 않습니다');
    expect(p.text).not.toContain('원료가 로트로 되돌아갑니다');
  });

  it('먼저 만들었던 구성품도 알린다', () => {
    const p = buildRollbackPlan(order({ autoBuilt: [{ itemId: 'loose', qty: 30 }] } as never), items, OrderStatus.DISPATCHED, OrderStatus.PENDING);
    expect(p.text).toContain('먼저 만들었던 구성품도 되돌립니다');
    expect(p.text).toContain('시골향참기름/A/1750ml 1750ml 30');
  });

  it('되돌릴 재고가 없으면 그렇게 적는다 — 그래도 확인은 받는다', () => {
    const p = buildRollbackPlan(order(), items, OrderStatus.DISPATCHED, OrderStatus.PENDING);
    expect(p.needed).toBe(false);
    expect(p.text).toContain('되돌릴 재고는 없습니다');
  });

  it('박스 주문은 박스 개수로 적는다 — 낱개로 적으면 자릿수가 달라 놀란다', () => {
    const o = order({ shippedOut: true, items: [{ itemId: 'box', name: 'x', quantity: 30, isBoxUnit: true, boxQuantity: 3 } as never] });
    expect(buildRollbackPlan(o, items, OrderStatus.SHIPPED, OrderStatus.PENDING).text).toContain('+3');
  });

  it('작업 당시 스냅샷이 있으면 현재 BOM 대신 실제 증감을 품목별로 보여준다', () => {
    const p = buildRollbackPlan(order({
      producedAt: '2026-09-01T00:00:00.000Z',
      inventorySnapshots: {
        version: 1,
        production: {
          capturedAt: '2026-09-01T00:00:00.000Z',
          stockDeltas: [{ itemId: 'box', delta: 3 }, { itemId: 'loose', delta: -30 }],
          bomLines: [{ parentItemId: 'box', childItemId: 'loose', quantity: 10 }],
        },
      },
    }), items, OrderStatus.DISPATCHED, OrderStatus.PENDING);
    expect(p.legacyEvidenceWarning).toBe(false);
    expect(p.adjustments).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'box', delta: -3 }),
      expect.objectContaining({ itemId: 'loose', delta: 30 }),
    ]));
  });

  it('스냅샷 없는 옛 생산 주문은 원복 근거 부족으로 별도 경고한다', () => {
    const p = buildRollbackPlan(order({ producedAt: '2026-08-01T00:00:00.000Z' }), items, OrderStatus.DISPATCHED, OrderStatus.PENDING);
    expect(p.legacyEvidenceWarning).toBe(true);
    expect(p.warnings.join(' ')).toContain('현재 데이터로 추정');
  });
});

/**
 * **되돌릴 때는 반드시 묻는다**(2026-09-14 사장님: "작업완료 이후에 있던 주문들이 돌아올때는
 * 무조건 알람 띄워야지 … 차감된 원료 부자재 같은거 롤백해야 하는데").
 * 한동안 내릴 때 아무것도 안 물어서, 원료·부자재가 조용히 되돌아갔다.
 */
describe('상태 변경 확인창 글', () => {
  const 계획 = (over: Partial<ReturnType<typeof buildRollbackPlan>> = {}) => ({
    needed: true, lines: [], text: '', legacyEvidenceWarning: false, warnings: [],
    adjustments: [
      { itemId: 'box', name: '시골향참기름/A/1750ml', unit: '박스', delta: -3, reason: '생산 취소' as const },
      { itemId: 'cap', name: '캡', unit: '개', delta: 30, reason: '생산 취소' as const },
    ],
    ...over,
  });

  it('되돌릴 재고가 있으면 몇 건이 어느 품목인지 적는다', () => {
    const 글 = buildStatusChangeAsk({ partnerName: '거산농산', from: OrderStatus.DISPATCHED, to: OrderStatus.PENDING, plan: 계획() });
    expect(글.message).toBe('주문 상태와 재고를 원복할까요?');
    expect(글.subMessage).toContain('거산농산 · 작업완료 → 대기중');
    expect(글.subMessage).toContain('재고 2건이 되돌아갑니다');
    expect(글.subMessage).toContain('시골향참기름/A/1750ml, 캡');
    expect(글.confirmText).toBe('원복 승인');
  });

  it('네 건이 넘으면 셋만 적고 나머지는 세어 준다', () => {
    const 많음 = 계획({ adjustments: ['가', '나', '다', '라', '마'].map(name => ({ itemId: name, name, unit: '개', delta: 1, reason: '생산 취소' as const })) });
    expect(buildStatusChangeAsk({ from: OrderStatus.DISPATCHED, to: OrderStatus.PROCESSING, plan: 많음 }).subMessage)
      .toContain('가, 나, 다 외 2건');
  });

  it('전량 재고로 나가 생산이 없던 건은 되돌릴 것이 없다고 적는다', () => {
    const 글 = buildStatusChangeAsk({ partnerName: '해내음', from: OrderStatus.DISPATCHED, to: OrderStatus.PENDING, plan: 계획({ adjustments: [] }) });
    expect(글.subMessage).toContain('되돌릴 원료·부자재가 없습니다');
    expect(글.confirmText).toBe('되돌리기');
  });

  it('대기중 ↔ 작업중은 재고가 안 움직인다고 적고, 그래도 묻는다', () => {
    const 글 = buildStatusChangeAsk({ partnerName: '해내음', from: OrderStatus.PROCESSING, to: OrderStatus.PENDING });
    expect(글.message).toBe('대기중 로 바꿀까요?');
    expect(글.subMessage).toContain('해내음 · 작업중 → 대기중');
    expect(글.subMessage).toContain('재고는 움직이지 않습니다');
    expect(글.confirmText).toBe('변경하기');
  });

  it('줄 하나만 풀 때는 그 품목 이름을 제목에 넣는다', () => {
    expect(buildStatusChangeAsk({ from: OrderStatus.DISPATCHED, to: OrderStatus.PROCESSING, plan: 계획(), lineName: '참기름 골드' }).message)
      .toBe('“참기름 골드” 을 풀고 재고를 원복할까요?');
    expect(buildStatusChangeAsk({ from: OrderStatus.DISPATCHED, to: OrderStatus.PROCESSING, plan: 계획({ adjustments: [] }), lineName: '참기름 골드' }).message)
      .toBe('“참기름 골드” 작업완료를 풀까요?');
  });

  it('생산 당시 기록이 없으면 추정이라고 밝힌다', () => {
    expect(buildStatusChangeAsk({ from: OrderStatus.DISPATCHED, to: OrderStatus.PENDING, plan: 계획({ legacyEvidenceWarning: true }) }).subMessage)
      .toContain('추정해 되돌립니다');
  });
});
