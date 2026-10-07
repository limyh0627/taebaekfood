import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * **재고량은 알림으로 보내지 않는다**(2026-09-08 사장님: "알람에 재고부족경고 안오게 해").
 *
 * 과거에는 먼저 내보내고 나중에 만드는 흐름에서 음수 재고를 허용했다.
 * 지금은 부족한 출고를 거절하고 작업자에게 오류를 돌려준다. 예전에는 재고량 알림을 띄워 종에 91건이 쌓였고 —
 * 전체 알림 455건의 20% — 새 주문과 언급이 그 사이에 묻혔다.
 *
 * **알림은 "지금 눈을 떼고 봐야 할 일"에만 쓴다.** 재고 부족은 저장 시도한 사람에게
 * 즉시 보여 주며 알림 종에는 넣지 않는다.
 *
 * ---
 * **다만 다 끄는 게 아니다.** 같은 `inventory_shortage` 갈래에 성격이 다른 둘이 같이 있다 —
 *
 *   원장·로트 불일치      원장과 로트가 갈렸다 → **한쪽만 반영된 것이다. 사고다**
 *   배송완료일 없는 주문   서류 네 종에서 통째로 빠진다 → **사고다**
 *
 * 이 둘은 **재고량이 아니라 어긋남**이라 남긴다. 갈래(type)로 뭉뚱그려 끄면 이것까지 죽는다.
 */
const 엔진 = readFileSync('src/features/admin/orderStockEngine.ts', 'utf8');
const 품목재고경계 = readFileSync('src/features/admin/orderItemStock.ts', 'utf8');

/** `addItem('notifications', { ... title: '...' ... })` 에서 제목만 뽑는다 */
const 알림제목 = (src: string): string[] => {
  const out: string[] = [];
  for (const m of src.matchAll(/addItem\(\s*'notifications'[\s\S]{0,400}?title:\s*'([^']+)'/g)) out.push(m[1]);
  return out;
};

describe('재고량은 알림으로 안 보낸다', () => {
  const 제목들 = 알림제목(엔진);

  it("'재고 부족 경고' 를 알림으로 만들지 않는다", () => {
    expect(제목들, `재고 부족 알림이 되살아났다 — 출고 때마다 떠서 종이 묻힌다.\n` +
      `부족한 출고는 저장 중 오류로 알려야 한다.`).not.toContain('재고 부족 경고');
  });

  it("'원료 로트 부족' 을 알림으로 만들지 않는다", () => {
    expect(제목들).not.toContain('원료 로트 부족');
  });

  it('부족한 출고는 오류로 거절하고 호출자에게 돌려준다', () => {
    expect(품목재고경계).toContain('throw new OrderInventoryPreconditionError(`${row.item!.name} 재고가 부족합니다.');
    expect(엔진).toMatch(/await applyItemStockDeltas\(deltas, combineProductLotMutations\(productLotMutations\), reservationContext[\s\S]*?catch \(error\) \{[\s\S]*?throw error;/);
  });

  it('어긋남 알림은 그대로 살아 있다 — 이건 사고 신호다', () => {
    //  **원장·로트 불일치 알림은 없어진 게 맞다**(2026-09-10 원자화 5단계).
    //  같은 트랜잭션에서 상태·이력·품목을 함께 쓰므로 한쪽만 반영될 수가 없다 — 감시 대상이 사라졌다.
    expect(제목들, '배송완료일 없는 주문 알림이 사라졌다 — 서류에서 조용히 빠진다')
      .toContain('배송완료일 없는 주문');
  });
});
