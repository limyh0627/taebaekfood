/**
 * **원료 재고 쓰기 — 상태와 이력을 한 트랜잭션에 같이 쓴다.**
 *
 * 설계: [원료실제원장-로트-원자화-설계.md](../../../docs/원료실제원장-로트-원자화-설계.md) §6
 * 셈은 [rawInventoryCore](../rawInventoryCore.ts) 가 한다 — 여기는 읽고·쓰기만 맡는다.
 *
 * 여태 어떻게 갈렸나:
 *   · `mutateRawMaterialLots` 는 로트 트랜잭션을 **끝낸 뒤** 기초이월 원장을 따로 썼다.
 *     원장 실패는 `console.error` 로만 남아서 **로트만 늘었다.**
 *   · `rawReceipt`·`ItemList`·`RawMaterialLotPanel` 은 로트 먼저 → 원장 나중,
 *     `AdminApp` 은 그 반대. 어느 쪽이든 뒤가 실패하면 갈린다.
 *   · 재시도하면 입고 원장 id 가 `rm-rcv-{지금}-{난수}` 라 **줄이 하나 더 선다.**
 *
 * 그래서 이 함수는 셋을 한꺼번에 지킨다.
 *   ① 상태와 이력이 **같은 트랜잭션**에 들어간다. 한쪽만 남을 수 없다.
 *   ② 이력 문서 id 가 곧 작업 id 라, 같은 작업은 **두 번 먹지 않는다.**
 *   ③ 로트 id·시각을 트랜잭션 **밖에서** 정한다 — 콜백은 경합하면 여러 번 돈다.
 */
import { doc, getDoc, runTransaction, type Firestore } from 'firebase/firestore';
import { db as defaultDb } from '../firebase';
import { COL } from '../collections';
import {
  applyRawCommand, operationDocId, inventoryDocId, emptyRawInventory,
  type RawInventoryCommand, type RawApplyResult, type RawInventoryState,
  type RawInventoryMovement,
} from '../rawInventoryCore';

/**
 * **옛 원장 화면이 읽는 칸.**
 *
 * 이력 문서(`RawInventoryMovement`)는 `reportedDeltaKg` 처럼 새 이름으로 적는데,
 * 원료수불부·입출고 기록 화면은 아직 `received`/`used`/`note`/`type` 을 읽는다.
 * **같은 문서에 둘 다 담는다** — 이관 중에 화면이 빈칸으로 보이면 안 된다(설계 §2 "이관 기간").
 * 화면들이 새 칸으로 옮겨간 뒤에 이 층을 걷어낸다.
 */
export interface LegacyLedgerFields {
  note?: string;
  type?: 'auto' | 'manual' | 'correction' | 'stocktake_unit';
  addedBy?: string;
  orderId?: string;
  /** 단위 입고 표시용 — 캔 16.5kg × 68개 같은 것 */
  canSize?: number;
  canCount?: number;
  canSizeTag?: string;
  originalAmount?: number;
  originalUnit?: 'kg' | 'L';
}

/** 이력 + 옛 칸을 한 문서로. 저장은 이 모양으로 한다. */
export function toLedgerDoc(m: RawInventoryMovement, legacy: LegacyLedgerFields = {}): Record<string, unknown> {
  //  실사는 잔량을 targetKg 로 다시 잡는 앵커라 입고·사용 합계를 안 건드린다(앱의 실사와 같은 모양).
  const 실사 = m.kind === 'stocktake';
  const d = m.reportedDeltaKg;
  return {
    ...m,
    date: m.effectiveDate,
    material: m.materialSnapshot,
    received: 실사 ? 0 : (d > 0 ? d : 0),
    used: 실사 ? 0 : (d < 0 ? -d : 0),
    unit: 'kg',
    ...legacy,
  };
}

/**
 * `items.stock` 과 상태 문서가 이만큼까지 어긋나는 건 반올림으로 본다.
 * [ledgerLotCheck.GAP_TOLERANCE_KG](../ledgerLotCheck.ts) 와 같은 한도다 —
 * 로트는 kg 소수 셋째 자리까지 반올림하며 돌아 몇 g 씩은 늘 흔들린다.
 */
const MIRROR_TOLERANCE_KG = 1;

/** Firestore 는 `undefined` 필드를 거부한다 — 로트의 미입력 옵션들이 여기 걸린다. */
const stripUndefined = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * 트랜잭션 밖에서 미리 정하는 값들. **안에서 만들면 재시도마다 달라진다.**
 * 부르는 쪽이 직접 넘기고 싶으면 넘기고, 안 넘기면 여기서 한 번만 만든다.
 */
export interface RawCommandOptions {
  now?: string;
  newLotId?: string;
  carryOverLotId?: string;
  db?: Firestore;
  /**
   * **이관 기간 동안 `items.lots/stock` 도 같은 트랜잭션에서 맞춘다**(기본 켬).
   *
   * 새 상태 문서(`rawInventories`)로 옮기는 중인데 화면·계산은 아직 `items.lots` 를 본다
   * (설계 §2 "이관 기간에만 호환용으로 읽는다"). 여기서 같이 안 쓰면 새 명령으로 넣은 입고가
   * **화면에 안 보인다.** 같은 트랜잭션이라 둘이 갈릴 수 없다.
   *
   * 이관이 끝나 원료에서 `items.lots/stock` 을 걷어낼 때 이 옵션도 없앤다(설계 §15 10단계).
   */
  mirrorToItem?: boolean;
  /** 옛 원장 화면이 읽는 칸(note·type·addedBy…). 이관 중에는 채워서 보낸다. */
  legacy?: LegacyLedgerFields;
}

/**
 * 명령 하나를 실행한다.
 *
 * 결과는 셋으로 갈린다(§14) — 성공·이미먹음·거절을 부르는 쪽이 **구분해서** 다뤄야 한다.
 * 예전에는 불일치 경고를 띄운 직후 성공 토스트가 덮어써서 아무도 못 봤다.
 */
export async function executeRawInventoryCommand(
  command: RawInventoryCommand,
  options: RawCommandOptions = {},
): Promise<RawApplyResult> {
  const database = options.db ?? defaultDb;
  //  ★ 트랜잭션 밖에서 딱 한 번 정한다.
  const now = options.now ?? new Date().toISOString();
  const opId = operationDocId(command.operationId);
  const newLotId = options.newLotId ?? `lot-${opId}`;
  const carryOverLotId = options.carryOverLotId ?? `carry-${opId}`;
  const invId = inventoryDocId(command.companyId, command.rawItemId);

  //  되돌리기 원본은 트랜잭션 밖에서 읽는다 — 이력은 만들어지면 안 바뀌므로 안전하다.
  let original: RawInventoryMovement | null = null;
  if (command.kind === 'reverse') {
    const snap = await getDoc(doc(database, COL.rawMaterialLedger, operationDocId(command.originalOperationId)));
    original = snap.exists() ? (snap.data() as RawInventoryMovement) : null;
  }

  const mirror = options.mirrorToItem !== false;

  return runTransaction(database, async tx => {
    const movementRef = doc(database, COL.rawMaterialLedger, opId);
    const stateRef = doc(database, COL.rawInventories, invId);
    const itemRef = doc(database, COL.items, command.rawItemId);

    //  ① 이미 먹은 작업인지 먼저 본다. 이력 문서가 곧 중복 방지 표다(§5).
    //  Firestore 트랜잭션은 **읽기를 모두 마친 뒤에** 써야 한다 — 그래서 여기서 다 읽는다.
    const [movementSnap, stateSnap, itemSnap] = await Promise.all([
      tx.get(movementRef), tx.get(stateRef), mirror ? tx.get(itemRef) : Promise.resolve(null),
    ]);
    const existing = movementSnap.exists() ? (movementSnap.data() as RawInventoryMovement) : null;
    const state = stateSnap.exists() ? (stateSnap.data() as RawInventoryState) : null;

    /**
     * **상태 문서가 없는데 품목엔 로트가 있으면 멈춘다.**
     * 빈 상태로 계산하면 그 로트를 없는 셈 치고 덮어써서 **재고가 통째로 날아간다.**
     * 이관(설계 §15 4단계)을 안 돌린 원료다 — `scripts/migrate-raw-inventories.mts` 를 먼저.
     */
    const 품목로트 = (itemSnap?.data()?.lots ?? []) as unknown[];
    if (!state && 품목로트.length > 0) {
      return { status: 'rejected', reason: `이관 안 된 원료다(rawInventories 문서 없음): ${invId}` };
    }

    /**
     * **품목 재고와 상태 문서가 이미 어긋나 있으면 멈춘다.**
     *
     * 여기서 그냥 진행하면 아래 mirror 가 `items.stock` 을 새 값으로 덮어써서 **차이가 조용히
     * 사라진다.** 풍회 깻묵이 그런 상태다 — `items.stock` 8,000 인데 로트도 상태도 0 이다.
     * 그 원료에 입고 한 번 넣으면 8,000 이 날아간다.
     *
     * `lotsAreTotal` 원료(볶음참깨)는 원래 둘이 다른 숫자라 안 본다 — stock 을 덮지도 않는다.
     * 어느 쪽이 맞는지는 코드가 못 정한다. 사람이 실사로 정하고 나서 다시 부른다.
     */
    if (mirror && itemSnap?.exists() && !itemSnap.data()?.lotsAreTotal) {
      const 품목재고 = Number(itemSnap.data()?.stock ?? 0);
      const 상태재고 = state?.stockKg ?? 0;
      if (Math.abs(품목재고 - 상태재고) > MIRROR_TOLERANCE_KG) {
        return {
          status: 'rejected',
          reason: `품목 재고와 원료 상태가 어긋나 있다: items.stock ${품목재고} ≠ ${상태재고} (${invId}). 실사로 맞춘 뒤에 다시 하라.`,
        };
      }
    }

    const result = applyRawCommand({
      state, command, existing, original,
      det: { now, newLotId, carryOverLotId },
    });

    //  ② 이미 먹었거나 거절이면 **아무것도 안 쓴다.**
    if (result.status !== 'applied') return result;

    //  ③ 상태·이력·품목을 **같은 트랜잭션**에 쓴다. 한쪽만 남을 수 없다.
    tx.set(stateRef, stripUndefined(result.state));
    tx.set(movementRef, stripUndefined(toLedgerDoc(result.movement, options.legacy)));
    if (mirror && itemSnap?.exists()) {
      //  화면이 보는 `lots` 는 활성·소진이 한 배열이다. 활성을 앞에 둬야 FIFO 순서가 산다.
      const lots = [...result.state.activeLots, ...result.state.recentDepletedLots];
      const patch: Record<string, unknown> = { lots: stripUndefined(lots) };
      //  `lotsAreTotal` 원료는 로트합이 통합재고라 stock 을 안 덮는다(mutateRawMaterialLots 와 같은 규칙).
      if (!itemSnap.data()?.lotsAreTotal) patch.stock = result.state.stockKg;
      tx.update(itemRef, patch);
    }
    return result;
  });
}

/**
 * 상태를 읽는다. 문서가 없으면 빈 상태를 돌려준다 — `null` 과 "0kg" 을 섞지 않기 위해서다.
 * 아직 이관 전이라 문서가 없는 원료가 대부분이다.
 */
export async function readRawInventory(
  companyId: RawInventoryCommand['companyId'], rawItemId: string, materialSnapshot = '',
  database: Firestore = defaultDb,
): Promise<RawInventoryState> {
  const snap = await getDoc(doc(database, COL.rawInventories, inventoryDocId(companyId, rawItemId)));
  return snap.exists()
    ? (snap.data() as RawInventoryState)
    : emptyRawInventory(companyId, rawItemId, materialSnapshot, new Date().toISOString());
}
