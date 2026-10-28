import {oemLedgerKg,type RawUsageKg} from '../../shared/orderProductionPlanner';
export {oemLedgerKg} from '../../shared/orderProductionPlanner';
export type {RawUsageKg} from '../../shared/orderProductionPlanner';
import {stock3 as kg3} from '../../shared/orderStockReservationPlan';
import type { Firestore } from 'firebase/firestore';
import { dateOfLocal, today } from '../../shared/day';
import type { AppNotification, Item, Order, OrderRawInventoryTrace, Partner } from '../../shared/types';
import { companyOf } from '../../shared/types';
import { baseRawName } from '../../constants/formula';
import { rawHolderByName, rawLedgerKeys } from '../../shared/rawHolder';
import { operationDocId,type RawInventoryCommand,type RawInventoryMovement } from '../../shared/rawInventoryCore';
import { buildOrderRawCommands as buildOrderRawCommandsPure, selectOrderRawUsageNames } from '../../../functions/src/shared/orderRawCommandPlan';
import { runRawInventoryJob, type JobCommandInput } from '../../shared/services/rawInventoryJob';
import {orderRawBatchJobId,orderRawBatchOrderEvidence,type OrderRawBatchRequest} from '../../shared/orderRawBatchAttempt';
import type {OrderInventoryGeneration} from '../../shared/orderInventoryGeneration';

export interface OrderRawInventoryDeps {
  actorName?: string;
  allItems: Item[];
  partners: Partner[];
  db: Firestore;
  addNotification: (notification: Omit<AppNotification, 'id'>) => Promise<unknown>;
  runRawInventoryJob?: typeof runRawInventoryJob;
}



/** 주문 스냅샷에는 실제 Firestore 원장 문서 ID를 남긴다. */
export {rawLedgerDocIds,orderRawTracesFromMovement} from '../../../functions/src/shared/orderRawCommandPlan';
import {rawLedgerDocIds,orderRawTracesFromMovement} from '../../../functions/src/shared/orderRawCommandPlan';
/** 여러 줄의 첫 계획을 한 원료 TX로 넘긴다. 재개 결과는 현재 계산값 대신 최초 plan을 돌려준다. */
export async function applyOrderAtomicRawPlan(input:{order:Order;generation:OrderInventoryGeneration;selection:Record<string,unknown>;plan:Record<string,unknown>;commands:JobCommandInput[];legacyJobIds:string[]}){
 const request:OrderRawBatchRequest={version:1,generation:input.generation,jobId:orderRawBatchJobId(input.generation),recordedAt:input.generation.startedAt,
  business:{orderText:orderRawBatchOrderEvidence(input.order),selection:input.selection},plan:input.plan,legacyJobIds:input.legacyJobIds,
  commands:input.commands.map(row=>({command:row.command,...(row.options?{options:row.options}:{})}))};
 const {executeOrderRawBatch}=await import('../../shared/services/orderRawBatchService');
 const result=await executeOrderRawBatch(request);
 if(result.status!=='committed'&&result.status!=='duplicate')throw Error(result.reason??'원료 일괄 처리를 확정하지 못했습니다. 최초 요청을 보존했습니다.');
 return {request:result.request,traces:result.results.map((row,index)=>orderRawTracesFromMovement(result.request.commands[index].command,row.movement))};
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
/** 원료 계획의 단위·작업번호·혼합 설정을 실제 적용과 사전검사가 함께 고정한다. */
export function buildOrderRawCommands(input:{order:Order;physicalUsage:RawUsageKg;ledgerOnlyUsage?:RawUsageKg;attempt:number;lineId?:string;allItems:Item[];partners:Partner[];actorName?:string}) {
 const {order,physicalUsage,attempt,lineId,allItems,partners,actorName}=input,ledgerOnlyUsage=input.ledgerOnlyUsage??{};
 const names = selectOrderRawUsageNames(physicalUsage, ledgerOnlyUsage);
 const businessDate = dateOfLocal(order.deliveredAt) || today();
 const customerName = partners.find(partner => partner.id === order.partnerId)?.name || order.partnerName || '';
 const companyId = companyOf(order);
 return buildOrderRawCommandsPure({get orderId(){return order.id;},physicalUsage,ledgerOnlyUsage,attempt,lineId,allItems,companyId,businessDate,customerName,actorName,names});

}

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
    const {commands,holderByMaterial,companyId,customerName}=buildOrderRawCommands({order,physicalUsage,ledgerOnlyUsage,attempt,lineId,allItems,partners,actorName});
    if(commands.length===0)return traces;

    const { job, results } = await runRawJob({
      jobId: `production:${order.id}${lineId ? `:${lineId}` : ''}:a${attempt}`,
      companyId,
      source: { type: 'production', id: order.id },
      commands,
      options: { db },
    });

    for (const { input, result } of results) {
      if (result.status === 'applied' || result.status === 'duplicate') {
        traces.push(...orderRawTracesFromMovement(input.command,result.movement));
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


/** 원본 명령 ID만 사용한다. 현재 BOM·배합비로 취소량을 재산출하지 않는다. */
export function cancellationRawCommands(
  order: Order, originals: ReadonlyMap<string, string>, effectiveAt: string, actorName?: string,
): import('../../shared/rawInventoryCore').RawInventoryCommand[] {
  return [...originals].map(([originalOperationId, rawItemId]) => ({
    operationId: `reverse:${originalOperationId}`, companyId: companyOf(order), rawItemId,
    materialSnapshot: '', effectiveAt,
    ...(actorName ? { actorName } : {}),
    source: { type: 'reversal', id: order.id }, kind: 'reverse', originalOperationId,
  }));
}
