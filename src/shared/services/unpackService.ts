import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { COL } from '../collections';
import { companyOf, type RawMaterialLot } from '../types';
import type { UnpackPlan } from '../canUnpack';
import { unpackSummary } from '../canUnpack';
import { unpackLots, canStockAfter, bulkStockAfter, type UnpackLotMove } from '../unpackLots';
import { pruneDepletedLots, withCarryOverProductLot, withCarryOverLot } from '../lotUtils';
import { anchorLotsByQty } from '../lotAnchor';
import { today } from '../day';
import { inventoryDocId, operationDocId, type LotChange, type RawInventoryMovement } from '../rawInventoryCore';
import { normalizeRawInventoryState, toLedgerDoc } from './rawInventoryService';

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
 * 벌크 원료는 `items`만 고치지 않는다. 원자화 이후에는 `rawInventories`가 수량의 본체고
 * `items`는 화면용 사본이다. 2026-09-22 깨분참기름 80캔 개봉이 `items`에만 1,320kg을
 * 더해 둘이 갈렸으므로, 캔·벌크 품목·원자화 상태·원장 이력을 이 트랜잭션 하나에 묶는다.
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
  //  같은 호출을 Firestore가 재시도해도 작업번호·로트번호는 바뀌지 않는다.
  const operationId = `unpack:${plan.canItemId}:${Date.parse(now)}`;
  const operationDocumentId = operationDocId(operationId);
  const lotIdPrefix = `lot-${operationDocumentId}`;

  try {
    const moves = await runTransaction(db, async tx => {
      const canRef = doc(db, 'items', plan.canItemId);
      const bulkRef = doc(db, 'items', plan.bulkItemId);
      const movementRef = doc(db, COL.rawMaterialLedger, operationDocumentId);
      // 원자화 상태 문서 열쇠에는 회사가 필요하다. 벌크 품목을 읽은 뒤 다시 읽으면
      // Firestore의 '모든 읽기는 쓰기 전' 규칙은 지키지만 왕복이 늘 뿐 안전성은 같다.
      const [canSnap, bulkSnap, movementSnap] = await Promise.all([
        tx.get(canRef), tx.get(bulkRef), tx.get(movementRef),
      ]);
      if (!canSnap.exists()) throw new Error(`${plan.canName} 품목을 찾을 수 없습니다.`);
      if (!bulkSnap.exists()) throw new Error(`${plan.bulkName} 품목을 찾을 수 없습니다.`);

      // 모바일에서 성공 응답을 못 받고 같은 호출이 재시도돼도 두 번 까지 않는다.
      if (movementSnap.exists()) return (movementSnap.data().unpackMoves ?? []) as UnpackLotMove[];

      const canData = canSnap.data();
      const bulkData = bulkSnap.data();
      const canCompany = companyOf(canData);
      const bulkCompany = companyOf(bulkData);
      if (canCompany !== bulkCompany) throw new Error('캔과 벌크 품목의 회사가 다릅니다.');

      const stateRef = doc(db, COL.rawInventories, inventoryDocId(bulkCompany, plan.bulkItemId));
      const stateSnap = await tx.get(stateRef);
      if (!stateSnap.exists()) throw new Error(`${plan.bulkName} 원료가 아직 원자화되지 않았습니다.`);
      const state = normalizeRawInventoryState(stateSnap.data());
      if (Math.abs(Number(bulkData.stock ?? 0) - state.stockKg) > 1) {
        throw new Error(`품목 재고와 원료 상태가 어긋나 있습니다: items.stock ${Number(bulkData.stock ?? 0)} ≠ ${state.stockKg}. 실사로 맞춘 뒤 다시 시도하세요.`);
      }

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
      // 벌크는 원자화 상태가 본체다. items.lots를 다시 근거로 삼으면 두 경로가 또 생긴다.
      const bulkLots = withCarryOverLot(state.activeLots, state.stockKg, plan.bulkName);

      const r = unpackLots({
        canLots, bulkLots,
        cans: plan.cans,
        perCan: plan.perCan,
        material: plan.bulkName,
        det: { now, receivedDate: 오늘, lotIdPrefix },
      });

      const activeLots = r.bulkLots.filter(l => l.status !== 'depleted');
      const addedIds = new Set(r.moves.map((_, i) => `${lotIdPrefix}-${i}`));
      const beforeById = new Map(state.activeLots.map(l => [l.id, l]));
      const lotChanges: LotChange[] = activeLots.flatMap(lot => {
        const before = beforeById.get(lot.id);
        const beforeKg = Number(before?.kgRemaining ?? 0);
        const afterKg = Number(lot.kgRemaining ?? 0);
        const deltaKg = Math.round((afterKg - beforeKg) * 1000) / 1000;
        if (deltaKg === 0 && !addedIds.has(lot.id)) return [];
        return [{
          lotId: lot.id, supplierName: lot.supplierName, lotNo: lot.lotNo,
          receivedDate: lot.receivedDate, deltaKg, beforeKg, afterKg,
          lotSnapshot: before ?? { ...lot, kgRemaining: 0 },
        }];
      });
      const balanceAfterKg = bulkStockAfter(activeLots);
      const movement: RawInventoryMovement = {
        id: operationDocumentId,
        operationId,
        commandHash: `unpack:${plan.canItemId}:${plan.bulkItemId}:${plan.cans}:${plan.perCan}`,
        companyId: bulkCompany,
        rawItemId: plan.bulkItemId,
        materialSnapshot: String(bulkData.rawMaterialName || plan.bulkName),
        effectiveAt: now,
        recordedAt: now,
        sequence: state.revision + 1,
        kind: 'unpack',
        reportedDeltaKg: plan.bulkQty,
        appliedDeltaKg: plan.bulkQty,
        balanceAfterKg,
        lotChanges,
        source: { type: 'unpack', id: plan.canItemId },
      };
      const recentDepletedLots = state.recentDepletedLots.slice(0, 40);
      const nextState = {
        ...state,
        materialSnapshot: movement.materialSnapshot,
        stockKg: balanceAfterKg,
        activeLots,
        recentDepletedLots,
        revision: movement.sequence,
        lastProcessedAt: now,
      };

      // 네 문서가 한 트랜잭션이다. 하나라도 실패하면 캔도 벌크도 전혀 움직이지 않는다.
      tx.update(canRef, { lots: strip(pruneDepletedLots(r.canLots)), stock: canStockAfter(r.canLots) });
      tx.update(bulkRef, { lots: strip([...activeLots, ...recentDepletedLots]), stock: balanceAfterKg });
      tx.set(stateRef, strip(nextState));
      tx.set(movementRef, strip({
        ...toLedgerDoc(movement, {
          note: unpackSummary(plan), type: 'manual', addedBy: '캔 개봉',
          canSize: plan.perCan, canCount: plan.cans,
        }),
        unpackMoves: r.moves,
      }));
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
 * 로트가 아직 없는 품목도 실사 시점부터 `실사조정` 로트를 세운다. 그렇지 않으면
 * 같은 실사 모달인데 어떤 품목은 stock만 바뀌어 다음 출고부터 다시 갈라진다.
 *
 * 셈은 `shared/lotAnchor` 가 한다. 여기는 한 트랜잭션으로 **쓰기만** 한다 —
 * 재고와 로트가 따로 움직이면 지금 볶음참깨처럼 둘이 갈린다.
 */
export async function stocktakeByQty(params: {
  itemId: string;
  itemName: string;
  /** 실제로 세어 본 수량(그 품목의 재고 단위) */
  targetQty: number;
  /** 로트가 아직 없을 때 새 실사 로트에 기록할 1재고단위의 kg. */
  unitKg?: number;
}): Promise<{ ok: boolean; message: string; deltaQty?: number }> {
  const { itemId, itemName, targetQty, unitKg = 0 } = params;
  if (!Number.isFinite(targetQty) || targetQty < 0) return { ok: false, message: '실사 수량은 0 이상의 숫자여야 합니다.' };
  const now = new Date().toISOString();
  const 오늘 = today();

  try {
    const r = await runTransaction(db, async tx => {
      const ref = doc(db, 'items', itemId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error(`${itemName} 품목을 찾을 수 없습니다.`);
      const data = snap.data();
      const lots = (data.lots ?? []) as RawMaterialLot[];
      const stocktakeAnchors = Array.isArray(data.stocktakeAnchors) ? data.stocktakeAnchors : [];

      const a = anchorLotsByQty({
        lots,
        targetQty,
        //  1개당 kg — 로트가 들고 있던 값을 그대로 쓴다. 여기서 새로 짐작하면
        //  로트마다 다른 환산이 섞인다.
        unitKg: lots.find(l => l.unitKg)?.unitKg ?? unitKg,
        det: { id: `anchor-${itemId}-${Date.parse(now)}`, createdAt: now, receivedDate: 오늘 },
      });
      //  **재고는 로트 합계로 다시 센다** — 목표값을 그대로 쓰지 않는다.
      //  둘이 갈리지 않는 유일한 길이다.
      const anchor = {
        id: `stocktake-${itemId}-${Date.parse(now)}`,
        date: 오늘,
        createdAt: now,
        targetQty,
        beforeQty: a.beforeQty,
        deltaQty: a.deltaQty,
      };
      tx.update(ref, {
        lots: strip(pruneDepletedLots(a.lots)),
        stock: canStockAfter(a.lots),
        stocktakeAnchors: strip([...stocktakeAnchors, anchor].slice(-100)),
      });
      return { deltaQty: a.deltaQty, beforeQty: a.beforeQty };
    });

    return {
      ok: true,
      deltaQty: r.deltaQty,
      message: `${itemName} 실사 ${targetQty} — 로트도 ${r.deltaQty > 0 ? '+' : ''}${r.deltaQty} 맞췄습니다`,
    };
  } catch (error) {
    console.error('[실사] 실패 — 아무것도 안 움직였다:', error);
    return { ok: false, message: `실사하지 못했습니다 — ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 수동 증감도 실사와 같은 앵커 형식으로 남긴다. stock 숫자만 바꾸면 제품별 원장에서 사라진다. */
export async function adjustStockByQty(params: {
  itemId: string;
  itemName: string;
  deltaQty: number;
  unitKg?: number;
  note?: string;
}): Promise<{ ok: boolean; message: string; deltaQty?: number }> {
  const { itemId, itemName, deltaQty, unitKg = 0, note = '재고 조정' } = params;
  if (!Number.isFinite(deltaQty)) return { ok: false, message: '조정 수량이 올바른 숫자가 아닙니다.' };
  const now = new Date().toISOString();
  const 오늘 = today();
  try {
    await runTransaction(db, async tx => {
      const itemRef = doc(db, 'items', itemId);
      const snap = await tx.get(itemRef);
      if (!snap.exists()) throw new Error(`${itemName} 품목을 찾을 수 없습니다.`);
      const data = snap.data();
      const lots = (data.lots ?? []) as RawMaterialLot[];
      const beforeQty = Number(data.stock ?? 0);
      const targetQty = beforeQty + deltaQty;
      if (targetQty < 0) throw new Error('조정 후 재고가 음수가 됩니다.');
      const anchored = anchorLotsByQty({
        lots, targetQty,
        unitKg: lots.find(lot => lot.unitKg)?.unitKg ?? unitKg,
        det: { id: `adjust-${itemId}-${Date.parse(now)}`, createdAt: now, receivedDate: 오늘 },
      });
      const anchors = Array.isArray(data.stocktakeAnchors) ? data.stocktakeAnchors : [];
      tx.update(itemRef, {
        lots: strip(pruneDepletedLots(anchored.lots)),
        stock: canStockAfter(anchored.lots),
        stocktakeAnchors: strip([...anchors, {
          id: `adjust-${itemId}-${Date.parse(now)}`, date: 오늘, createdAt: now,
          targetQty, beforeQty, deltaQty, note,
        }].slice(-100)),
      });
    });
    return { ok: true, deltaQty, message: `${itemName} ${deltaQty > 0 ? '+' : ''}${deltaQty} — 기록과 로트에 반영했습니다.` };
  } catch (error) {
    return { ok: false, message: `재고를 조정하지 못했습니다 — ${error instanceof Error ? error.message : String(error)}` };
  }
}
