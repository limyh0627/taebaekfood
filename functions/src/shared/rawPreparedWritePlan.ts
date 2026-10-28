import { normalizeRawMovement, toLedgerDoc, type LegacyLedgerFields } from './rawInventoryDocument';
import type { RawApplyResult, RawInventoryCommand } from './rawInventoryCore';

type Snapshot = { exists(): boolean; data(): Record<string, any> | undefined };
export type RawPreparedWriteRead = { originalSnap: Snapshot | null; oldOriginalSnap: Snapshot | null; itemSnap: Snapshot };
export const stripRawWriteUndefined = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function buildPreparedRawWritePlan(
  command: RawInventoryCommand, read: RawPreparedWriteRead,
  result: Extract<RawApplyResult, { status: 'applied' }>,
  options: { mirrorToItem?: boolean; legacy?: LegacyLedgerFields } = {},
) {
  const originalSnap = read.originalSnap?.exists() ? read.originalSnap : read.oldOriginalSnap;
  const original = originalSnap?.exists() ? normalizeRawMovement(originalSnap.data()!) : null;
  const 원장전용 = command.kind === 'ledger-consume' || (command.kind === 'reverse' && original?.kind === 'ledger-consume');
  // 앱은 원래 쓰기 단계에서 평가하고, 서버는 쓰기 전에 같은 단계를 모두 평가한다.
  return {
    state: () => stripRawWriteUndefined(result.state),
    movement: () => stripRawWriteUndefined(toLedgerDoc(result.movement, options.legacy)),
    hasGuard: () => !!result.guard,
    guard: () => stripRawWriteUndefined(result.guard),
    itemPatch: (): Record<string, unknown> | undefined => {
      if (options.mirrorToItem !== false && !원장전용 && read.itemSnap.exists()) {
        const lots = [...result.state.activeLots, ...result.state.recentDepletedLots];
        const patch: Record<string, unknown> = { lots: stripRawWriteUndefined(lots) };
        patch.stock = result.state.stockKg;
        return patch;
      }
      return undefined;
    },
  };
}
