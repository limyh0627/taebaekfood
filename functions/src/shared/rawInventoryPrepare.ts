import { applyRawCommand, operationDocId, inventoryDocId, type RawInventoryCommand, type RawInventoryState, type RawApplyResult, type ReversalGuard } from './rawInventoryCore';
import { normalizeRawInventoryState, normalizeRawMovement, rawMirrorMatches, type LegacyLedgerFields } from './rawInventoryDocument';
import { baseRawName } from './formula';

/** Web/Admin SDK 양쪽 조회 결과를 받는다. 읽기와 쓰기는 호출자가 맡는다. */
export interface RawReadSnapshot { exists(): boolean; data(): Record<string, any> | undefined }
export interface RawCommandRead {
  movementSnap: RawReadSnapshot; oldMovementSnap?: RawReadSnapshot | null;
  stateSnap: RawReadSnapshot; itemSnap: RawReadSnapshot;
  originalSnap?: RawReadSnapshot | null; oldOriginalSnap?: RawReadSnapshot | null;
  guardSnap?: RawReadSnapshot | null;
}
export interface RawPrepareOptions { now?: string; newLotId?: string; carryOverLotId?: string; mirrorToItem?: boolean; legacy?: LegacyLedgerFields }

/** 주문 취소도 같은 검사를 쓰도록 읽기·계산을 저장 경계에서 분리한다. */
export function prepareRawCommand(
  command: RawInventoryCommand,
  read: RawCommandRead,
  options: RawPrepareOptions = {},
  virtual?: { state: RawInventoryState; itemData: Record<string, any> },
): RawApplyResult {
  const { movementSnap, oldMovementSnap, stateSnap, itemSnap, originalSnap, oldOriginalSnap, guardSnap } = read;
  const opId = operationDocId(command.operationId);
  const invId = inventoryDocId(command.companyId, command.rawItemId);
  const now = options.now ?? command.effectiveAt;
  const newLotId = options.newLotId ?? `lot-${opId}`;
  const carryOverLotId = options.carryOverLotId ?? `carry-${opId}`;
  const mirror = options.mirrorToItem !== false;
    const 기존스냅 = movementSnap.exists() ? movementSnap : oldMovementSnap?.exists() ? oldMovementSnap : null;
    const existing = 기존스냅 ? normalizeRawMovement(기존스냅.data()!) : null;
    const state = virtual?.state ?? (stateSnap.exists() ? normalizeRawInventoryState(stateSnap.data()!) : null);
    const itemData = virtual?.itemData ?? (itemSnap.exists() ? itemSnap.data()! : null);

    if (!itemData) {
      return { status: 'rejected', code: 'ITEM_NOT_FOUND', message: `원료 품목을 찾을 수 없다: ${command.rawItemId}` };
    }
    const actualCompany = itemData.companyId ?? 'taebaek';
    if (actualCompany !== command.companyId) {
      return {
        status: 'rejected', code: 'COMPANY_MISMATCH',
        message: `품목 회사 ${actualCompany}와 명령 회사 ${command.companyId}가 다르다`,
      };
    }
    // 이름은 표시 스냅샷일 뿐이다. 화면이 보낸 값을 믿지 않고 rawItemId로 읽은 품목이 정한다.
    const materialSnapshot = String(itemData.rawMaterialName || baseRawName(String(itemData.name ?? '')));
    const resolvedCommand: RawInventoryCommand = { ...command, materialSnapshot };

    const 원본스냅 = originalSnap?.exists() ? originalSnap : oldOriginalSnap?.exists() ? oldOriginalSnap : null;
    const original = 원본스냅 ? normalizeRawMovement(원본스냅.data()!) : null;
    const guard = guardSnap?.exists() ? (guardSnap.data()! as ReversalGuard) : null;
    const 원장전용 = command.kind === 'ledger-consume'
      || (command.kind === 'reverse' && original?.kind === 'ledger-consume');

    /**
     * **상태 문서가 없는데 품목엔 로트가 있으면 멈춘다.**
     * 빈 상태로 계산하면 그 로트를 없는 셈 치고 덮어써서 **재고가 통째로 날아간다.**
     * 이관(설계 §15 4단계)을 안 돌린 원료다 — `scripts/migrate-raw-inventories.mts` 를 먼저.
     */
    const 품목로트 = (itemData?.lots ?? []) as unknown[];
    if (!state && (품목로트.length > 0 || 원장전용)) {
      return { status: 'rejected', code: 'NOT_MIGRATED', message: `이관 안 된 원료다(rawInventories 문서 없음): ${invId}` };
    }

    /**
     * **품목 재고와 상태 문서가 이미 어긋나 있으면 멈춘다.**
     *
     * 여기서 그냥 진행하면 아래 mirror 가 `items.stock` 을 새 값으로 덮어써서 **차이가 조용히
     * 사라진다.** 풍회 깻묵이 그런 상태다 — `items.stock` 8,000 인데 로트도 상태도 0 이다.
     * 그 원료에 입고 한 번 넣으면 8,000 이 날아간다.
     *
     * 어느 쪽이 맞는지는 코드가 못 정한다. 사람이 실사로 정하고 나서 다시 부른다.
     */
    if (mirror && !원장전용 && command.kind !== 'stocktake' && command.kind !== 'adjust-lot' && itemSnap?.exists()) {
      const 품목재고 = Number(itemData?.stock ?? 0);
      const 상태재고 = state?.stockKg ?? 0;
      if (!rawMirrorMatches(품목재고, 상태재고)) {
        return {
          status: 'rejected', code: 'STOCK_MISMATCH',
          message: `품목 재고와 원료 상태가 어긋나 있다: items.stock ${품목재고} ≠ ${상태재고} (${invId}). 실사로 맞춘 뒤에 다시 하라.`,
        };
      }
    }

    const result = applyRawCommand({
      state, command: resolvedCommand, existing, original, guard,
      det: { now, newLotId, carryOverLotId },
    });

    return result;
}
