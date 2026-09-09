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

  return runTransaction(database, async tx => {
    const movementRef = doc(database, COL.rawMaterialLedger, opId);
    const stateRef = doc(database, COL.rawInventories, invId);

    //  ① 이미 먹은 작업인지 먼저 본다. 이력 문서가 곧 중복 방지 표다(§5).
    const [movementSnap, stateSnap] = await Promise.all([tx.get(movementRef), tx.get(stateRef)]);
    const existing = movementSnap.exists() ? (movementSnap.data() as RawInventoryMovement) : null;
    const state = stateSnap.exists() ? (stateSnap.data() as RawInventoryState) : null;

    const result = applyRawCommand({
      state, command, existing, original,
      det: { now, newLotId, carryOverLotId },
    });

    //  ② 이미 먹었거나 거절이면 **아무것도 안 쓴다.**
    if (result.status !== 'applied') return result;

    //  ③ 둘을 같은 트랜잭션에 쓴다. 한쪽만 남을 수 없다.
    tx.set(stateRef, stripUndefined(result.state));
    tx.set(movementRef, stripUndefined(result.movement));
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
