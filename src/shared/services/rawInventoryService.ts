import { prepareRawCommand } from '../../../functions/src/shared/rawInventoryPrepare';
export { prepareRawCommand } from '../../../functions/src/shared/rawInventoryPrepare';
import { normalizeRawInventoryState, normalizeRawMovement, toLedgerDoc, type LegacyLedgerFields } from '../../../functions/src/shared/rawInventoryDocument';
export { normalizeRawInventoryState, normalizeRawMovement, toLedgerDoc } from '../../../functions/src/shared/rawInventoryDocument';
export type { LegacyLedgerFields } from '../../../functions/src/shared/rawInventoryDocument';
/**
 * **원료 재고 쓰기 — 상태와 이력을 한 트랜잭션에 같이 쓴다.**
 *
 * 설계: [원료실제원장-로트-원자화-설계.md](../../../로컬전용/docs/원료실제원장-로트-원자화-설계.md) §6
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
import { doc, getDoc, runTransaction, type Firestore, type Transaction } from 'firebase/firestore';
import { COL } from '../collections';
import {
  operationDocId, legacyOperationDocId, inventoryDocId, emptyRawInventory,
  type RawInventoryCommand, type RawApplyResult, type RawInventoryState,
  type RawInventoryMovement,
} from '../rawInventoryCore';
import { companyOf, type RawMaterialLot } from '../types';
import { rawMirrorMatches } from '../rawMirror';

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

export async function readRawCommandInTransaction(tx: Transaction, database: Firestore, command: RawInventoryCommand) {
  const opId = operationDocId(command.operationId);
  const oldOpId = legacyOperationDocId(command.operationId);
  const invId = inventoryDocId(command.companyId, command.rawItemId);
    const movementRef = doc(database, COL.rawMaterialLedger, opId);
    const oldMovementRef = doc(database, COL.rawMaterialLedger, oldOpId);
    const stateRef = doc(database, COL.rawInventories, invId);
    const itemRef = doc(database, COL.items, command.rawItemId);
    const originalId = command.kind === 'reverse' ? command.originalOperationId : '';
    const originalRef = doc(database, COL.rawMaterialLedger, operationDocId(originalId || '_none_'));
    const oldOriginalRef = doc(database, COL.rawMaterialLedger, legacyOperationDocId(originalId || '_none_'));
    const guardRef = doc(database, COL.rawInventoryReversalGuards, operationDocId(originalId || '_none_'));

    // Firestore transaction은 첫 write 전 모든 read를 끝내야 한다. 원본과 취소표도 반드시
    // 이 안에서 읽는다. 밖에서 읽으면 서로 다른 취소 두 건이 둘 다 통과할 수 있다.
    const [movementSnap, oldMovementSnap, stateSnap, itemSnap, originalSnap, oldOriginalSnap, guardSnap] = await Promise.all([
      tx.get(movementRef),
      oldOpId === opId ? Promise.resolve(null) : tx.get(oldMovementRef),
      tx.get(stateRef),
      tx.get(itemRef),
      command.kind === 'reverse' ? tx.get(originalRef) : Promise.resolve(null),
      command.kind === 'reverse' && legacyOperationDocId(originalId) !== operationDocId(originalId)
        ? tx.get(oldOriginalRef) : Promise.resolve(null),
      command.kind === 'reverse' ? tx.get(guardRef) : Promise.resolve(null),
    ]);
    return { movementRef, stateRef, itemRef, guardRef, movementSnap, oldMovementSnap, stateSnap, itemSnap, originalSnap, oldOriginalSnap, guardSnap };
}

export function writePreparedRawCommand(
  tx: Transaction, command: RawInventoryCommand,
  read: Awaited<ReturnType<typeof readRawCommandInTransaction>>,
  result: Extract<RawApplyResult, { status: 'applied' }>, options: RawCommandOptions = {},
) {
  const originalSnap = read.originalSnap?.exists() ? read.originalSnap : read.oldOriginalSnap;
  const original = originalSnap?.exists() ? normalizeRawMovement(originalSnap.data()) : null;
  const 원장전용 = command.kind === 'ledger-consume' || (command.kind === 'reverse' && original?.kind === 'ledger-consume');
    //  ③ 상태·이력·품목을 **같은 트랜잭션**에 쓴다. 한쪽만 남을 수 없다.
    tx.set(read.stateRef, stripUndefined(result.state));
    tx.set(read.movementRef, stripUndefined(toLedgerDoc(result.movement, options.legacy)));
    if (result.guard) tx.set(read.guardRef, stripUndefined(result.guard));
    if (options.mirrorToItem !== false && !원장전용 && read.itemSnap.exists()) {
      //  화면이 보는 `lots` 는 활성·소진이 한 배열이다. 활성을 앞에 둬야 FIFO 순서가 산다.
      const lots = [...result.state.activeLots, ...result.state.recentDepletedLots];
      const patch: Record<string, unknown> = { lots: stripUndefined(lots) };
      //  **재고 = 로트 합계.** 예외는 없다(2026-09-16 `lotsAreTotal` 을 걷어냈다).
      patch.stock = result.state.stockKg;
      tx.update(read.itemRef, patch);
    }
}

/**
 * 명령 하나를 실행한다.
 *
 * 결과는 넷으로 갈린다(§14) — 성공·이미먹음·충돌·거절을 부르는 쪽이 **구분해서** 다뤄야 한다.
 * 예전에는 불일치 경고를 띄운 직후 성공 토스트가 덮어써서 아무도 못 봤다.
 */
export async function executeRawInventoryCommand(
  command: RawInventoryCommand,
  options: RawCommandOptions = {},
): Promise<RawApplyResult> {
  const database = options.db ?? (await import('../firebase')).db;
  //  ★ 트랜잭션 밖에서 딱 한 번 정한다.
  const now = options.now ?? new Date().toISOString();
  const opId = operationDocId(command.operationId);
  const newLotId = options.newLotId ?? `lot-${opId}`;
  const carryOverLotId = options.carryOverLotId ?? `carry-${opId}`;

  return runTransaction(database, async tx => {
    const read = await readRawCommandInTransaction(tx, database, command);
    const result = prepareRawCommand(command, read, { ...options, now, newLotId, carryOverLotId });
    if (result.status === 'applied') writePreparedRawCommand(tx, command, read, result, options);
    return result;
  });
}

/**
 * 상태를 읽는다. 문서가 없으면 빈 상태를 돌려준다 — `null` 과 "0kg" 을 섞지 않기 위해서다.
 * 아직 이관 전이라 문서가 없는 원료가 대부분이다.
 */
export async function readRawInventory(
  companyId: RawInventoryCommand['companyId'], rawItemId: string, materialSnapshot = '',
  database?: Firestore,
): Promise<RawInventoryState> {
  const resolvedDb = database ?? (await import('../firebase')).db;
  const snap = await getDoc(doc(resolvedDb, COL.rawInventories, inventoryDocId(companyId, rawItemId)));
  return snap.exists()
    ? normalizeRawInventoryState(snap.data())
    : emptyRawInventory(companyId, rawItemId, materialSnapshot, new Date().toISOString());
}

/**
 * 로트 번호·FIFO 순서처럼 **수량이 아닌 정보**를 상태와 화면용 품목 사본에 함께 쓴다.
 * 수량·상태·로트 추가삭제는 이 함수가 거절한다. 그런 변경은 반드시 명령 이력을 남겨야 한다.
 */
export async function updateRawInventoryLotMetadata(input: {
  companyId: RawInventoryCommand['companyId'];
  rawItemId: string;
  transform: (lots: RawMaterialLot[]) => RawMaterialLot[];
  db?: Firestore;
}): Promise<RawMaterialLot[]> {
  const database = input.db ?? (await import('../firebase')).db;
  const stateRef = doc(database, COL.rawInventories, inventoryDocId(input.companyId, input.rawItemId));
  const itemRef = doc(database, COL.items, input.rawItemId);
  return runTransaction(database, async tx => {
    const [stateSnap, itemSnap] = await Promise.all([tx.get(stateRef), tx.get(itemRef)]);
    if (!stateSnap.exists()) throw new Error(`이관 안 된 원료다: ${input.companyId}/${input.rawItemId}`);
    if (!itemSnap.exists()) throw new Error(`원료 품목을 찾을 수 없다: ${input.rawItemId}`);
    if (companyOf(itemSnap.data()) !== input.companyId) throw new Error(`원료 품목 회사가 다르다: ${input.rawItemId}`);

    const state = normalizeRawInventoryState(stateSnap.data());
    const before = [...state.activeLots, ...state.recentDepletedLots];
    const after = stripUndefined(input.transform(before.map(lot => ({ ...lot }))));
    const beforeById = new Map(before.map(lot => [lot.id, lot]));
    const 수량바뀜 = after.length !== before.length || after.some(lot => {
      const old = beforeById.get(lot.id);
      return !old
        || old.kgIn !== lot.kgIn
        || old.kgRemaining !== lot.kgRemaining
        || old.qtyIn !== lot.qtyIn
        || old.qtyRemaining !== lot.qtyRemaining
        || old.packageKg !== lot.packageKg
        || old.unitKg !== lot.unitKg
        || old.status !== lot.status;
    });
    if (수량바뀜 || new Set(after.map(lot => lot.id)).size !== after.length) {
      throw new Error('로트 수량·상태·추가삭제는 메타정보 수정으로 바꿀 수 없다');
    }

    const activeLots = after.filter(lot => lot.status !== 'depleted' && Number(lot.kgRemaining) !== 0);
    const recentDepletedLots = after.filter(lot => lot.status === 'depleted' || Number(lot.kgRemaining) === 0);
    tx.set(stateRef, stripUndefined({ ...state, activeLots, recentDepletedLots }));
    tx.update(itemRef, { lots: after });
    return after;
  });
}
