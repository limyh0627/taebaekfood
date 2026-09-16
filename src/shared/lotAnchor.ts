import type { RawMaterialLot } from './types';
import { deductLotsByQty, lotQtyRemaining } from './lotUtils';
import { today as todayStr } from './day';

/**
 * **실사 — 개수로 세는 로트를 실제 수량에 맞춰 다시 세운다.**
 *
 * 2026-09-16 사장님: "볶음참깨는 재고관리에서 실제 수량으로 한번 맞춘거 같은데
 * 왜 로트는 안 따라갔냐".
 *
 * **따라갈 길이 없었다.** 원료(`raw`)에는 실사 앵커가 있어서 "지금 200kg" 을 찍으면
 * 로트를 그 값으로 다시 세운다(`rawInventoryCore` 의 `stocktake` · `targetKg`).
 * 그런데 **개수로 세는 품목(박스·캔·완제품)에는 그 경로가 아예 없었다.** 재고현황에서
 * 숫자를 고치면 `items.stock` 만 바뀌고 로트는 손도 안 댔다.
 *
 * 그래서 이렇게 됐다:
 *
 *   1. 로트를 도입했는데 그전 재고는 로트가 없다 → 출고할 때마다 '이월'이 음수로 받는다
 *   2. 사람이 "실제로 39박스" 라고 맞춘다 → **`stock` 만 39가 된다**
 *   3. 다음 출고부터 또 이월이 음수로 받는다
 *   4. stock 은 39→38→37, 로트는 −7→−8→−9 — **둘이 각자 간다**
 *
 * 운영 데이터가 그 모습 그대로다(2026-09-16):
 *
 *     볶음참깨-낱개/1kg   stock  30    이월 로트  −14개
 *     볶음참깨/1kg        stock  39    이월 로트   −7박스
 *     볶음참깨/1kg        stock  14    이월 로트  −26박스
 *
 * ---
 * **늘릴 때는 '이월'에 넣는다.** 어느 입고분인지 모르는 게 사실이기 때문이다.
 * 없는 로트에 임의로 붙이면 나중에 회수할 때 엉뚱한 거래처가 걸린다
 * (`lotUtils.withCarryOverProductLot` 과 같은 태도 — "출처를 모르는 게 사실이므로
 * supplierName='이월'로 정직하게 남긴다").
 *
 * **줄일 때는 선입선출로 깐다.** 실제 로트가 먼저 나간 것으로 본다.
 *
 * 이 파일은 **셈만 한다** — 배열을 받아 바뀐 배열을 돌려준다.
 */

export interface AnchorResult {
  lots: RawMaterialLot[];
  /** 로트가 실제로 얼마나 움직였나 — 사람에게 "+46박스 맞췄습니다" 라고 알린다. */
  deltaQty: number;
  /** 맞추기 전 로트 합계 — 얼마나 어긋나 있었는지 보여 준다. */
  beforeQty: number;
}

export function anchorLotsByQty(params: {
  lots: RawMaterialLot[];
  /** 실제로 세어 본 수량 */
  targetQty: number;
  /** 1개당 kg — 로트는 개수와 kg 을 같이 들고 다닌다(수불부와 이어진다) */
  unitKg?: number;
  /** 트랜잭션 안에서 부를 때 밖에서 정해 넣는다 — 재시도마다 버킷이 하나씩 더 생기면 안 된다. */
  det?: { id: string; createdAt: string; receivedDate: string };
}): AnchorResult {
  const { lots, targetQty, unitKg = 0, det } = params;
  const before = lotQtyRemaining(lots);
  const delta = r3(targetQty - before);

  if (Math.abs(delta) < 0.0001) return { lots: lots.map(l => ({ ...l })), deltaQty: 0, beforeQty: before };

  if (delta < 0) {
    //  **줄인다** — 선입선출로 깐다. 실제 로트가 모자라면 이월이 음수로 받는다(막지 않는다).
    const r = deductLotsByQty(lots, -delta, det);
    return { lots: r.lots, deltaQty: delta, beforeQty: before };
  }

  //  **늘린다** — 이월 버킷에 넣는다. 이미 음수로 깔려 있으면 거기서 메워져 자연히 털린다.
  const next = lots.map(l => ({ ...l }));
  let idx = next.findIndex(l => l.supplierName === '이월' && l.qtyRemaining != null);
  if (idx < 0) {
    next.push({
      id: det?.id ?? `lot-anchor-${Date.now()}`,
      supplierName: '이월',
      qtyIn: 0, qtyRemaining: 0, unitKg,
      kgIn: 0, kgRemaining: 0,
      receivedDate: det?.receivedDate ?? todayStr(),
      status: 'active',
      createdAt: det?.createdAt ?? new Date().toISOString(),
    } as RawMaterialLot);
    idx = next.length - 1;
  }
  const b = next[idx];
  b.qtyRemaining = r3((b.qtyRemaining ?? 0) + delta);
  b.unitKg = b.unitKg || unitKg;
  b.kgRemaining = r3((b.qtyRemaining ?? 0) * (b.unitKg ?? 0));
  //  **다시 살린다** — 0 이 돼서 소진으로 꺼 뒀던 버킷에 실사로 수량이 들어오면 살아 있어야 한다.
  b.status = 'active';
  return { lots: next, deltaQty: delta, beforeQty: before };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
