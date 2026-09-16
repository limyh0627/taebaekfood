import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import type { RawMaterialLot } from '../types';
import type { UnpackPlan } from '../canUnpack';
import { unpackSummary } from '../canUnpack';
import { unpackLots, canStockAfter, bulkStockAfter, type UnpackLotMove } from '../unpackLots';
import { pruneDepletedLots, withCarryOverProductLot, withCarryOverLot } from '../lotUtils';
import { anchorLotsByQty } from '../lotAnchor';
import { today } from '../day';

/**
 * **캔을 까서 벌크로 되돌린다 — 실제로 쓰는 자리.**
 *
 * 셈은 둘로 나뉜다: 무엇이 얼마나 나오는지는 `shared/canUnpack`, 어느 로트에서
 * 어느 로트로 가는지는 `shared/unpackLots`. 여기는 그 셈대로 **쓰기만** 한다.
 *
 * ---
 * **한 트랜잭션에 둘을 같이 쓴다.**
 *
 * 예전 박스 개봉(`ItemList.unpackBox`)은 두 번에 나눠 쓰고 뒤가 실패하면 앞을 되돌렸다.
 * 그 되돌리기마저 실패하면 재고가 그냥 사라진다. 두 품목이 다른 문서라 어쩔 수 없다고
 * 봤는데, Firestore 트랜잭션은 **여러 문서를 같이** 읽고 쓸 수 있다. 같이 성공하거나
 * 같이 실패한다 — 중간 상태가 아예 없다.
 *
 * ---
 * **재고는 로트 합계로 다시 센다**(`canStockAfter`·`bulkStockAfter`).
 *
 * 델타를 더하지 않는다. 로트가 참이고 `stock` 은 그 미러라, 어긋났더라도 개봉을 지나면
 * 맞아 돌아온다. 델타로 더하면 어긋남이 그대로 따라다닌다 —
 * 볶음참깨가 로트합 −520 vs stock 14 로 갈린 것이 그 길이다.
 *
 * **트랜잭션 콜백은 경합하면 여러 번 돈다.** 그래서 id·시각을 밖에서 정해 넣는다
 * (설계 §6). 안에서 `Date.now()` 로 만들면 재시도마다 다른 로트가 생긴다.
 */

export interface UnpackOutcome {
  ok: boolean;
  message: string;
  moves?: UnpackLotMove[];
}

export async function unpack(plan: UnpackPlan): Promise<UnpackOutcome> {
  const now = new Date().toISOString();
  const 오늘 = today();
  //  개봉 한 번에 하나 — 재시도해도 같은 값이라야 로트가 하나만 선다.
  const lotIdPrefix = `unpack-${plan.canItemId}-${Date.parse(now)}`;

  try {
    const moves = await runTransaction(db, async tx => {
      const canRef = doc(db, 'items', plan.canItemId);
      const bulkRef = doc(db, 'items', plan.bulkItemId);
      //  **읽기를 먼저 다 한다** — Firestore 트랜잭션은 쓰기 뒤에 읽을 수 없다.
      const [canSnap, bulkSnap] = await Promise.all([tx.get(canRef), tx.get(bulkRef)]);
      if (!canSnap.exists()) throw new Error(`${plan.canName} 품목을 찾을 수 없습니다.`);
      if (!bulkSnap.exists()) throw new Error(`${plan.bulkName} 품목을 찾을 수 없습니다.`);

      const canData = canSnap.data();
      const bulkData = bulkSnap.data();

      /**
       * **로트를 안 쓰던 재고를 먼저 이월 로트로 세운다.**
       *
       * 안 하면 로트 합계(0) < 재고(68캔)라 첫 개봉부터 전부 '미상'으로 빠진다.
       * 이월분은 출처를 모르는 게 사실이므로 `supplierName='이월'` 로 정직하게 남긴다.
       */
      const canLots = withCarryOverProductLot(
        (canData.lots ?? []) as RawMaterialLot[],
        Number(canData.stock ?? 0),
        plan.bulkName,
        plan.perCan,
        { id: `${lotIdPrefix}-can-carry`, createdAt: now, receivedDate: 오늘 },
      );
      const bulkLots = withCarryOverLot(
        (bulkData.lots ?? []) as RawMaterialLot[],
        Number(bulkData.stock ?? 0),
        plan.bulkName,
      );

      const r = unpackLots({
        canLots, bulkLots,
        cans: plan.cans,
        perCan: plan.perCan,
        material: plan.bulkName,
        det: { now, receivedDate: 오늘, lotIdPrefix },
      });

      //  소진 로트를 쳐낸다 — 안 하면 문서가 계속 커져 FIFO 보다 문서 한도가 먼저 걸린다(§3).
      tx.update(canRef, { lots: strip(pruneDepletedLots(r.canLots)), stock: canStockAfter(r.canLots) });
      tx.update(bulkRef, { lots: strip(pruneDepletedLots(r.bulkLots)), stock: bulkStockAfter(r.bulkLots) });
      return r.moves;
    });

    //  **공캔은 안 건드린다**(`plan.discarded`) — 깐 캔은 버린다. 되돌리면 다음 생산 때
    //  있지도 않은 공캔을 집어 쓴다.
    return { ok: true, message: unpackSummary(plan), moves };
  } catch (error) {
    //  트랜잭션이라 중간 상태가 없다 — 실패하면 아무것도 안 움직였다.
    console.error('[개봉] 실패 — 아무것도 안 움직였다:', error);
    const 사유 = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `개봉하지 못했습니다 — ${사유}` };
  }
}

/** Firestore 는 `undefined` 필드를 거부한다 — 로트의 미입력 옵션들이 여기 걸린다. */
const strip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;


/**
 * **실사 — 개수로 세는 품목의 재고와 로트를 실제 수량에 맞춘다.**
 *
 * 2026-09-16 사장님: "볶음참깨는 재고관리에서 실제 수량으로 한번 맞춘거 같은데
 * 왜 로트는 안 따라갔냐". 따라갈 길이 없었다 — 원료에는 실사 앵커가 있는데
 * 박스·캔·완제품에는 없어서, 재고현황에서 숫자를 고치면 `stock` 만 바뀌었다.
 *
 * **로트를 안 쓰는 품목은 `stock` 만 맞춘다.** 로트가 없는데 억지로 세우면 그때부터
 * 없던 이월 로트가 생겨 화면이 갑자기 달라진다. 쓰던 품목만 따라가게 한다.
 *
 * 셈은 `shared/lotAnchor` 가 한다. 여기는 한 트랜잭션으로 **쓰기만** 한다 —
 * 재고와 로트가 따로 움직이면 지금 볶음참깨처럼 둘이 갈린다.
 */
export async function stocktakeByQty(params: {
  itemId: string;
  itemName: string;
  /** 실제로 세어 본 수량(그 품목의 재고 단위) */
  targetQty: number;
}): Promise<{ ok: boolean; message: string; deltaQty?: number }> {
  const { itemId, itemName, targetQty } = params;
  const now = new Date().toISOString();
  const 오늘 = today();

  try {
    const r = await runTransaction(db, async tx => {
      const ref = doc(db, 'items', itemId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error(`${itemName} 품목을 찾을 수 없습니다.`);
      const data = snap.data();
      const lots = (data.lots ?? []) as RawMaterialLot[];

      if (!lots.length) {
        tx.update(ref, { stock: targetQty });
        return { deltaQty: 0, 로트없음: true };
      }

      const a = anchorLotsByQty({
        lots,
        targetQty,
        //  1개당 kg — 로트가 들고 있던 값을 그대로 쓴다. 여기서 새로 짐작하면
        //  로트마다 다른 환산이 섞인다.
        unitKg: lots.find(l => l.unitKg)?.unitKg ?? 0,
        det: { id: `anchor-${itemId}-${Date.parse(now)}`, createdAt: now, receivedDate: 오늘 },
      });
      //  **재고는 로트 합계로 다시 센다** — 목표값을 그대로 쓰지 않는다.
      //  둘이 갈리지 않는 유일한 길이다.
      tx.update(ref, { lots: strip(pruneDepletedLots(a.lots)), stock: canStockAfter(a.lots) });
      return { deltaQty: a.deltaQty, beforeQty: a.beforeQty, 로트없음: false };
    });

    return {
      ok: true,
      deltaQty: r.deltaQty,
      message: r.로트없음
        ? `${itemName} 재고를 ${targetQty}로 맞췄습니다`
        : `${itemName} 실사 ${targetQty} — 로트도 ${r.deltaQty > 0 ? '+' : ''}${r.deltaQty} 맞췄습니다`,
    };
  } catch (error) {
    console.error('[실사] 실패 — 아무것도 안 움직였다:', error);
    return { ok: false, message: `실사하지 못했습니다 — ${error instanceof Error ? error.message : String(error)}` };
  }
}
