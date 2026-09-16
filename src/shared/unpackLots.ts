import type { RawMaterialLot } from './types';
import { deductLotsByQty, buildReceiveLot, lotQtyRemaining } from './lotUtils';

/**
 * **개봉은 로트를 물려주는 이동이다.**
 *
 * 2026-09-16 사장님: "로트 통합재고가 이게 FM이 맞냐 로트관리?"
 *
 * **아니었다.** `lotsAreTotal`(로트=통합재고)은 "로트 합계 = 통틀어, stock = 그중 벌크만"
 * 으로 **한 품목이 두 숫자를 뜻하게** 만드는 우회다. 로트 관리의 제1원칙
 * — **재고 = 그 품목의 로트 잔량 합** — 을 일부러 끄는 것이다.
 *
 * 운영 데이터가 그걸 증명한다. 이 표식을 켠 품목은 `볶음참깨` 하나뿐인데, 로트를 든
 * 19개 품목 중 **장부가 깨진 4개가 전부 볶음참깨 식구**다(로트합 −520 vs stock 14 등).
 * 나머지 15개는 다 맞는다.
 *
 * ---
 * **FM 은 이렇다** — 로트는 **재고를 들고 있는 품목마다** 붙고, 같은 로트번호를
 * 여러 품목이 나눠 갖는다.
 *
 *     로트 260901-01  (09-01 입고 · A거래처 · 1,122kg)
 *       ├ 캔 품목    65캔  = 1,072.5kg
 *       └ 벌크 품목           49.5kg
 *                          ─────────
 *                           1,122kg      ← 로트 잔량과 일치
 *
 * 개봉하면 **로트번호가 그대로** 벌크로 넘어간다. 그래서 추적이 안 끊긴다 —
 * 나중에 그 로트를 회수하면 캔으로 남은 것, 깐 벌크, 그걸로 만든 제품까지 따라온다.
 * `lotsAreTotal` 로는 못 한다: 깐 벌크가 **어느 로트에서 나왔는지 모른다.**
 *
 * 이 파일은 **셈만 한다** — 로트 배열 둘을 받아 바뀐 배열 둘을 돌려준다.
 * 쓰기는 `services/unpackService` 가 한다. 그래야 네트워크 없이 시험할 수 있다.
 */

/** 어느 로트에서 몇 개를 까서 벌크로 얼마가 넘어갔나 — 사람이 대조할 수 있게 남긴다. */
export interface UnpackLotMove {
  lotNo?: string;
  supplierName: string;
  receivedDate?: string;
  /** 깐 개수 */
  cans: number;
  /** 넘어간 벌크 양 */
  bulkQty: number;
}

export interface UnpackLotResult {
  canLots: RawMaterialLot[];
  bulkLots: RawMaterialLot[];
  moves: UnpackLotMove[];
  /**
   * 로트보다 많이 깠나 — 로트를 안 쓰던 시절 재고가 남아 있으면 그렇게 된다.
   * **막지 않고 보이게 둔다**(`deductLotsByQty` 와 같은 규칙). 조용히 0 에서 멈추면
   * 로트 합계가 실제와 갈려서 추적 자체를 못 믿게 된다.
   */
  shortageQty: number;
}

/**
 * 캔 로트에서 FIFO 로 까고, 그만큼을 **같은 로트번호**로 벌크 로트에 얹는다.
 *
 * @param perCan 캔 1개에 든 벌크 양(BOM 이 정한다)
 * @param det    트랜잭션 안에서 부를 때 밖에서 정해 넣는 값 — 재시도마다 id 가 달라지면
 *               한 번의 개봉이 여러 로트로 남는다(설계 §6, `buildReceiveLot` 머리말과 같은 이유).
 */
export function unpackLots(params: {
  canLots: RawMaterialLot[];
  bulkLots: RawMaterialLot[];
  cans: number;
  perCan: number;
  material: string;
  det: { now: string; receivedDate: string; lotIdPrefix: string };
}): UnpackLotResult {
  const { canLots, bulkLots, cans, perCan, material, det } = params;

  const 깐것 = deductLotsByQty(canLots, cans, {
    id: `${det.lotIdPrefix}-carry`,
    createdAt: det.now,
    receivedDate: det.receivedDate,
  });

  const moves: UnpackLotMove[] = [];
  const nextBulk = bulkLots.map(l => ({ ...l }));

  깐것.distribution.forEach((take, i) => {
    const bulkQty = r3(take.qty * perCan);
    if (bulkQty === 0) return;
    moves.push({
      lotNo: take.lotNo,
      supplierName: take.supplierName,
      receivedDate: take.receivedDate,
      cans: take.qty,
      bulkQty,
    });

    //  **같은 로트가 이미 벌크에 있으면 거기 얹는다.** 깔 때마다 새 로트를 세우면
    //  한 입고분이 로트 수십 개로 쪼개져 FIFO 가 무의미해진다.
    const 이미있는 = nextBulk.find(l =>
      l.status === 'active' && !!take.lotNo && l.lotNo === take.lotNo && (l.qtyRemaining == null));
    if (이미있는) {
      이미있는.kgIn = r3(이미있는.kgIn + bulkQty);
      이미있는.kgRemaining = r3(이미있는.kgRemaining + bulkQty);
      return;
    }

    nextBulk.push(buildReceiveLot({
      material,
      //  **거래처를 그대로 물려받는다** — 산 것이 아니라 그 로트가 형태만 바뀐 것이다.
      //  여기에 '개봉'이라고 적으면 나중에 이 기름이 어디서 온 것인지 못 찾는다.
      supplierName: take.supplierName,
      qtyIn: take.qty,
      kgIn: bulkQty,
      packageType: '캔',
      packageKg: perCan,
      receivedDate: take.receivedDate ?? det.receivedDate,
      id: `${det.lotIdPrefix}-${i}`,
      createdAt: det.now,
    }));
    //  `buildReceiveLot` 은 로트번호를 안 받는다(입고는 그때 새로 매긴다).
    //  개봉은 **물려받는** 것이라 여기서 직접 박는다 — 이게 추적이 이어지는 자리다.
    nextBulk[nextBulk.length - 1].lotNo = take.lotNo;
  });

  return { canLots: 깐것.lots, bulkLots: nextBulk, moves, shortageQty: 깐것.shortageQty };
}

/** 깐 뒤 캔이 몇 개 남았나 — 품목 `stock` 을 이 값으로 맞춘다(재고 = 로트 합계). */
export function canStockAfter(canLots: RawMaterialLot[]): number {
  return lotQtyRemaining(canLots);
}

/** 깐 뒤 벌크가 얼마 남았나 — 품목 `stock` 을 이 값으로 맞춘다. */
export function bulkStockAfter(bulkLots: RawMaterialLot[]): number {
  return r3((bulkLots ?? [])
    .filter(l => l.status === 'active')
    .reduce((s, l) => s + Number(l.kgRemaining ?? 0), 0));
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
