import type { Item, RawMaterialLot } from '../shared/types';
import {
  applyRawCommand,
  emptyRawInventory,
  type RawApplyResult,
  type RawInventoryMovement,
  type RawInventoryState,
  type ReversalGuard,
} from '../shared/rawInventoryCore';
import type { RunJobOutcome } from '../shared/services/rawInventoryJob';
import type { OrderStockEngineDeps } from '../features/admin/orderStockEngine';

/**
 * 주문 재고 엔진 시험용 원료 job.
 *
 * 화면 시험이 예전 `mutateRawMaterialLots` 가짜 구현에 기대면 공용 명령을 건너뛰어도 시험이
 * 통과한다. 이 가짜는 실제 순수 코어를 실행해 명령 중복·취소·로트 변화를 그대로 검증한다.
 */
export function rawInventoryJobTestDouble(input: {
  items: Item[];
  lots: Map<string, RawMaterialLot[]>;
  stock: Map<string, number>;
  ledger: Map<string, Record<string, any>>;
}) {
  const states = new Map<string, RawInventoryState>();
  const movements = new Map<string, RawInventoryMovement>();
  const guards = new Map<string, ReversalGuard>();

  const stateOf = (command: Parameters<typeof applyRawCommand>[0]['command']) => {
    const cached = states.get(command.rawItemId);
    if (cached) return cached;
    const item = input.items.find(x => x.id === command.rawItemId);
    const current = [...(input.lots.get(command.rawItemId) ?? [])];
    if (current.length === 0 && Number(input.stock.get(command.rawItemId) ?? 0) > 0) {
      const kg = Number(input.stock.get(command.rawItemId));
      current.push({
        id: `test-opening-${command.rawItemId}`, supplierName: '기초이월',
        receivedDate: '2000-01-01', qtyIn: 0, kgIn: kg, kgRemaining: kg,
        status: 'active', createdAt: '2000-01-01T00:00:00.000Z',
      });
    }
    const base = emptyRawInventory(command.companyId, command.rawItemId, command.materialSnapshot, '');
    const state: RawInventoryState = {
      ...base,
      stockKg: current.reduce((sum, lot) => sum + Number(lot.kgRemaining ?? 0), 0),
      activeLots: current.filter(lot => Number(lot.kgRemaining ?? 0) > 0),
      recentDepletedLots: current.filter(lot => Number(lot.kgRemaining ?? 0) <= 0),
    };
    if (item?.lotsAreTotal) state.stockKg = current.reduce((sum, lot) => sum + Number(lot.kgRemaining ?? 0), 0);
    states.set(command.rawItemId, state);
    return state;
  };

  return async (jobInput: Parameters<NonNullable<OrderStockEngineDeps['runRawInventoryJob']>>[0]): Promise<RunJobOutcome> => {
    const results: RunJobOutcome['results'] = [];
    for (const item of jobInput.commands) {
      const command = item.command;
      const result: RawApplyResult = applyRawCommand({
        state: stateOf(command),
        command,
        existing: movements.get(command.operationId) ?? null,
        original: command.kind === 'reverse' ? movements.get(command.originalOperationId) ?? null : null,
        guard: command.kind === 'reverse' ? guards.get(command.originalOperationId) ?? null : null,
        det: {
          now: jobInput.options?.now ?? '2026-09-10T10:00:00.000Z',
          newLotId: item.options?.newLotId ?? `lot-${command.operationId}`,
          carryOverLotId: item.options?.carryOverLotId ?? `carry-${command.operationId}`,
        },
      });
      results.push({ input: item, result });
      if (result.status === 'conflict' || result.status === 'rejected') {
        return {
          job: {
            id: jobInput.jobId, companyId: jobInput.companyId, source: jobInput.source,
            expectedOperationIds: jobInput.commands.map(x => x.command.operationId),
            status: 'failed', createdAt: '', lastError: result.status === 'rejected' ? result.message : 'conflict',
          },
          results,
        };
      }
      if (result.status === 'applied') {
        states.set(command.rawItemId, result.state);
        movements.set(command.operationId, result.movement);
        if (result.guard && command.kind === 'reverse') guards.set(command.originalOperationId, result.guard);
        const lots = [...result.state.activeLots, ...result.state.recentDepletedLots];
        input.lots.set(command.rawItemId, lots);
        const rawItem = input.items.find(x => x.id === command.rawItemId);
        if (!rawItem?.lotsAreTotal) input.stock.set(command.rawItemId, result.state.stockKg);
        input.ledger.set(command.operationId, {
          ...result.movement,
          material: result.movement.materialSnapshot,
          received: result.movement.kind === 'stocktake' ? 0 : Math.max(0, result.movement.reportedDeltaKg),
          used: result.movement.kind === 'stocktake' ? 0 : Math.max(0, -result.movement.reportedDeltaKg),
        });
      }
    }
    return {
      job: {
        id: jobInput.jobId, companyId: jobInput.companyId, source: jobInput.source,
        expectedOperationIds: jobInput.commands.map(x => x.command.operationId),
        status: 'complete', createdAt: '', completedAt: '',
      },
      results,
    };
  };
}
