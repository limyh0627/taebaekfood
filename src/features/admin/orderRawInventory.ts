import type { Firestore } from 'firebase/firestore';
import { dateOfLocal, today } from '../../shared/day';
import type { AppNotification, Item, Order, OrderRawInventoryTrace, Partner } from '../../shared/types';
import { companyOf } from '../../shared/types';
import { baseRawName, toKg } from '../../constants/formula';
import { isBoxStockItem, unpackQty } from '../../shared/orderUnits';
import { rawHolderByName, rawLedgerKeys } from '../../shared/rawHolder';
import { operationDocId } from '../../shared/rawInventoryCore';
import { runRawInventoryJob, type JobCommandInput } from '../../shared/services/rawInventoryJob';

export type RawUsageKg = Record<string, number>;

export interface OrderRawInventoryDeps {
  actorName?: string;
  allItems: Item[];
  partners: Partner[];
  db: Firestore;
  addNotification: (notification: Omit<AppNotification, 'id'>) => Promise<unknown>;
  runRawInventoryJob?: typeof runRawInventoryJob;
}

const kg3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * 임가공 완제품 한 줄이 원료수불부에 남길 kg.
 * 박스는 BOM이 정한 개입수까지 `unpackQty`로 편 뒤 한 공식을 쓴다.
 */
export function oemLedgerKg(
  product: Pick<Item, 'id' | 'unpackTo' | 'spec'>,
  units: number,
  formula: readonly { raw: string; ratio: number }[],
): RawUsageKg {
  const eachQty = unpackQty(units, product, isBoxStockItem(product));
  const out: RawUsageKg = {};
  for (const row of formula) {
    const kg = toKg(product.spec || '', row.raw, eachQty) * row.ratio;
    if (kg > 0) out[row.raw] = kg3((out[row.raw] ?? 0) + kg);
  }
  return out;
}

/** 주문 스냅샷에는 실제 Firestore 원장 문서 ID를 남긴다. */
export function rawLedgerDocIds(traces: readonly OrderRawInventoryTrace[]): string[] {
  return [...new Set(traces.flatMap(trace =>
    trace.ledgerId ? [trace.ledgerId] : trace.operationId ? [operationDocId(trace.operationId)] : [],
  ))];
}

/**
 * 주문 엔진과 원료 원자화 코어 사이의 경계.
 * 주문 엔진은 kg 합계만 넘기고, 이 모듈이 품목 ID 확인·명령 ID·job·취소를 전부 맡는다.
 *
 * 예전 주문 엔진은 로트를 먼저 깎고 원장을 나중에 따로 써 원장 없는 차감이 46건 생겼다.
 * 임가공은 반대 사고도 있었다. 완제품 로트가 박스 수와 kg을 이미 들고 있는데 원료 홀더까지
 * 깎으면 실물을 두 번 뺀다. 그래서 일반 생산은 `consume`, 임가공 판매는 `ledger-consume`으로
 * 나누되 둘 다 같은 job·operationId·reverse 체계 안에서 처리한다.
 */
export function createOrderRawInventoryOperations(deps: OrderRawInventoryDeps) {
  const {
    actorName, allItems, partners, db, addNotification,
    runRawInventoryJob: runRawJob = runRawInventoryJob,
  } = deps;

  const applyOrderRawUsage = async (
    order: Order,
    physicalUsage: RawUsageKg,
    attempt: number,
    ledgerOnlyUsage: RawUsageKg = {},
    lineId?: string,
  ): Promise<OrderRawInventoryTrace[]> => {
    const traces: OrderRawInventoryTrace[] = [];
    const physicalNames = Object.keys(physicalUsage).filter(raw => kg3(physicalUsage[raw]) > 0);
    const ledgerOnlyNames = Object.keys(ledgerOnlyUsage).filter(raw => kg3(ledgerOnlyUsage[raw]) > 0);
    if (physicalNames.length === 0 && ledgerOnlyNames.length === 0) return traces;

    const date = dateOfLocal(order.deliveredAt) || today();
    const customerName = partners.find(partner => partner.id === order.partnerId)?.name
      || order.partnerName || '';
    const effectiveAt = `${date}T12:00:00+09:00`;
    const companyId = companyOf(order);
    const commands: JobCommandInput[] = [];
    const holderByMaterial = new Map<string, Item>();

    for (const material of physicalNames) {
      const rawItem = rawHolderByName(allItems, material, companyId);
      if (!rawItem) {
        throw new Error(`원료 차감 중단: ${companyId} 회사의 '${material}' 원료 품목을 찾을 수 없다 (주문 ${order.id})`);
      }
      holderByMaterial.set(material, rawItem);
      const operationId = `production:${order.id}${lineId ? `:${lineId}` : ''}:a${attempt}:${rawItem.id}`;
      commands.push({
        command: {
          operationId,
          ...rawLedgerKeys(rawItem),
          materialSnapshot: material,
          effectiveAt,
          ...(actorName ? { actorName } : {}),
          source: { type: 'production', id: order.id },
          kind: 'consume',
          kg: kg3(physicalUsage[material]),
          ...(rawItem.mixEnabled ? { mix: { topPercent: rawItem.mixTopPercent ?? 50 } } : {}),
        },
        options: {
          newLotId: `lot-${operationId}`,
          carryOverLotId: `carry-${operationId}`,
          legacy: {
            note: `자동: ${customerName}`,
            type: 'auto', orderId: order.id,
            ...(actorName ? { addedBy: actorName } : {}),
          },
        },
      });
    }

    for (const material of ledgerOnlyNames) {
      const rawItem = rawHolderByName(allItems, material, companyId);
      if (!rawItem) {
        throw new Error(`임가공 원장 기록 중단: ${companyId} 회사의 '${material}' 원료 품목을 찾을 수 없다 (주문 ${order.id})`);
      }
      holderByMaterial.set(material, rawItem);
      // 실제 차감 명령과 같은 원료가 섞여도 작업 번호가 겹치지 않는다.
      const operationId = `production-ledger:${order.id}${lineId ? `:${lineId}` : ''}:a${attempt}:${rawItem.id}`;
      commands.push({
        command: {
          operationId,
          ...rawLedgerKeys(rawItem),
          materialSnapshot: material,
          effectiveAt,
          ...(actorName ? { actorName } : {}),
          source: { type: 'oem', id: order.id },
          kind: 'ledger-consume',
          kg: kg3(ledgerOnlyUsage[material]),
        },
        options: {
          legacy: {
            note: `자동(임가공): ${customerName}`,
            type: 'auto', orderId: order.id,
            ...(actorName ? { addedBy: actorName } : {}),
          },
        },
      });
    }

    const { job, results } = await runRawJob({
      jobId: `production:${order.id}${lineId ? `:${lineId}` : ''}:a${attempt}`,
      companyId,
      source: { type: 'production', id: order.id },
      commands,
      options: { db },
    });

    for (const { input, result } of results) {
      if (result.status === 'applied' || result.status === 'duplicate') {
        const material = input.command.materialSnapshot;
        if (input.command.kind === 'ledger-consume') {
          // 로트가 없어도 operationId를 보관해야 생산 취소가 이 원장 줄을 reverse 한다.
          traces.push({
            material,
            rawItemId: input.command.rawItemId,
            operationId: input.command.operationId,
            ledgerId: result.movement.id,
            supplierName: '임가공',
            kg: kg3(Math.abs(result.movement.reportedDeltaKg)),
            ledgerOnly: true,
          });
          continue;
        }
        for (const change of result.movement.lotChanges) {
          if (change.deltaKg >= 0) continue;
          traces.push({
            material,
            rawItemId: input.command.rawItemId,
            operationId: input.command.operationId,
            ledgerId: result.movement.id,
            supplierName: change.supplierName ?? '',
            kg: kg3(-change.deltaKg),
            ...(change.lotId ? { lotId: change.lotId } : {}),
            ...(change.lotNo ? { lotNo: change.lotNo } : {}),
            ...(change.receivedDate ? { receivedDate: change.receivedDate } : {}),
          });
        }
        continue;
      }

      if (result.status === 'conflict') {
        throw new Error(`원료 차감 충돌: 같은 작업 번호에 다른 내용이 있다 (${input.command.operationId})`);
      }

      console.warn(`[생산 차감] 거절 — ${input.command.operationId}: ${result.code} ${result.message}`);
      const rawItem = holderByMaterial.get(input.command.materialSnapshot);
      if (rawItem) {
        await addNotification({
          type: 'inventory_shortage', title: '원료 차감 거절',
          body: `${input.command.materialSnapshot} — ${result.code} ${result.message} (주문 ${order.id}·${customerName})`,
          linkedId: rawItem.id, readBy: [], createdAt: new Date().toISOString(),
        });
      }
      throw new Error(`원료 차감 거절: ${result.code} ${result.message}`);
    }

    if (job.status === 'failed') {
      throw new Error(`원료 차감 업무 실패: ${job.id} ${job.lastError ?? ''}`);
    }
    return traces;
  };

  const reverseOrderRawUsage = async (order: Order, lineId?: string): Promise<void> => {
    const traces = order.rawConsumedLots ?? [];
    if (traces.length === 0) return;
    const companyId = companyOf(order);
    const originals = new Map<string, string>();
    for (const trace of traces) {
      if (!trace.operationId || !trace.rawItemId) {
        throw new Error(`옛 생산 기록은 원자 명령 번호가 없어 자동 취소할 수 없다: 주문 ${order.id}`);
      }
      originals.set(trace.operationId, trace.rawItemId);
    }

    const effectiveAt = new Date().toISOString();
    const commands: JobCommandInput[] = [];
    for (const [originalOperationId, rawItemId] of originals) {
      const rawItem = allItems.find(item => item.id === rawItemId);
      if (!rawItem || companyOf(rawItem) !== companyId) {
        throw new Error(`원료 복원 중단: 주문 회사의 원료 품목을 찾을 수 없다 (${rawItemId})`);
      }
      commands.push({
        command: {
          operationId: `reverse:${originalOperationId}`,
          ...rawLedgerKeys(rawItem),
          materialSnapshot: baseRawName(rawItem.name),
          effectiveAt,
          ...(actorName ? { actorName } : {}),
          source: { type: 'reversal', id: order.id },
          kind: 'reverse', originalOperationId,
        },
        options: {
          legacy: {
            type: 'auto', orderId: order.id,
            ...(actorName ? { addedBy: actorName } : {}),
          },
        },
      });
    }

    const { job, results } = await runRawJob({
      jobId: `production-reversal:${order.id}${lineId ? `:${lineId}` : ''}:a${order.rawInventoryAttempt ?? 0}`,
      companyId,
      source: { type: 'production-reversal', id: order.id },
      commands,
      options: { db },
    });
    const failed = results.find(row => row.result.status === 'conflict' || row.result.status === 'rejected');
    if (job.status !== 'complete' || failed) {
      const detail = failed?.result.status === 'rejected'
        ? `${failed.result.code} ${failed.result.message}`
        : failed?.result.status === 'conflict' ? '작업 번호 충돌' : job.lastError ?? '';
      throw new Error(`원료 복원 실패: 주문 ${order.id} ${detail}`);
    }
  };

  return { applyOrderRawUsage, reverseOrderRawUsage };
}
