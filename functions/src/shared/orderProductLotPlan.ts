import type {RawMaterialLot} from './rawLot';
import {deductLotsByQty,type ProductLotTake} from './productLot';
import {holdsUnitStockPure as holdsUnitStock,isGoodsItem,isBulkItem,tracksQuantityLots,type InventoryKindItem} from './itemInventoryKind';
import {stockUnitKg} from './stockUnitMeasure';
import {unpackComponent,type OrderStockUnitInputs} from './orderStockUnits';
import type {ProductionItem,ProductionLine} from './orderProductionDomain';
export interface ProductConsumedLotTrace { itemId: string; material?: string; lotId?: string; lotNo?: string; receivedDate?: string; qty: number; lotSnapshot?: RawMaterialLot }
export type LotItem=ProductionItem & InventoryKindItem;
export interface LotOrder {items:ProductionLine[];productConsumedLots?:ProductConsumedLotTrace[]}
export interface OrderProductLotPolicy {buildProductLot:(params:Parameters<typeof import('./productLot').buildProductLot>[0])=>RawMaterialLot;withCarryOverProductLot:(lots:RawMaterialLot[],stock:number,material:string,unitKg:number,carry?:{id:string;createdAt:string;receivedDate:string})=>RawMaterialLot[]}
export interface OrderProductLotMutationResult {
  lots: RawMaterialLot[];
  consumedLots: ProductConsumedLotTrace[];
}

export interface OrderProductLotMutation {
  itemId: string;
  apply: (lots: RawMaterialLot[], stock?: number) => OrderProductLotMutationResult;
}

export class OrderInventoryPreconditionError extends Error {
  inventoryUnchanged = true;
}
export interface OrderProductLotDeps {
  allItems: LotItem[];
  shipQtyOf: (item: ProductionLine, product: LotItem) => number;
}
export function reverseProductionProductLots(traces: { itemId: string; lotId: string; qty: number }[] = []): OrderProductLotMutation[] {
  const grouped = new Map<string, typeof traces>();
  for (const trace of traces) grouped.set(trace.itemId, [...(grouped.get(trace.itemId) ?? []), trace]);
  return [...grouped].map(([itemId, rows]) => ({ itemId, apply: lots => {
    for (const row of rows) {
      const lot = lots.find(candidate => candidate.id === row.lotId);
      if (!lot || Number(lot.qtyRemaining ?? 0) < row.qty) throw new Error('생산 로트가 이미 사용되어 생산을 취소할 수 없습니다.');
    }
    return { lots: lots.map(lot => {
      const qty = rows.filter(row => row.lotId === lot.id).reduce((sum, row) => sum + row.qty, 0);
      return qty ? { ...lot, qtyRemaining: Math.round((Number(lot.qtyRemaining) - qty) * 1000) / 1000, kgRemaining: Math.round((Number(lot.qtyRemaining) - qty) * Number(lot.unitKg ?? 0) * 1000) / 1000 } : lot;
    }), consumedLots: [] };
  } }));
}

export function createOrderProductLotPlanner(deps:OrderProductLotDeps & {unitInputs:OrderStockUnitInputs;lotPolicy:OrderProductLotPolicy}) {
const {buildProductLot,withCarryOverProductLot}=deps.lotPolicy;
/** 최초 생성한 로트와 저장 원문 재개가 같은 적용 함수를 소비한다. */
function productionProductLotMutation(itemId:string,lot:RawMaterialLot):OrderProductLotMutation{
  return {itemId,apply:(lots,stock=0)=>{
    if(lots.some(row=>row.id===lot.id))throw new Error('이미 반영된 생산 로트입니다. 주문 생산 기록을 확인해 주세요.');
    return {lots:[...withCarryOverProductLot(lots,stock,lot.material??'',lot.unitKg??0,{id:`carry-${lot.id}`,createdAt:lot.createdAt,receivedDate:lot.receivedDate}),lot],consumedLots:[]};
  }};
}

/** 재고 증가와 같은 transaction에 전달한다. 기존 로트 부족은 과거 생산으로 단정해 보충하지 않는다. */
function productionProductLots(allItems: LotItem[], deltas: ReadonlyMap<string, number>, operationId: string, inputs: OrderStockUnitInputs) {
  const traces: { itemId: string; lotId: string; qty: number }[] = [];
  const mutations: OrderProductLotMutation[] = [];
  const consumedLots: ProductConsumedLotTrace[] = [];
  for (const [itemId, qty] of deltas) {
    const item = allItems.find(row => row.id === itemId);
    if (!item || !qty || isBulkItem(item)) continue;
    if (qty < 0 && tracksQuantityLots(item)) {
      const take = createOrderProductLotOperations({ allItems, shipQtyOf: row => row.quantity })
        .deductProductLotsForOrder({ items: [{ itemId, quantity: -qty }] } as LotOrder)[0]!;
      mutations.push({ itemId, apply: lots => {
        const result = take.apply(lots);
        // transaction 재시도에서 앞선 시도의 추적 수량을 중복 누적하지 않는다.
        consumedLots.splice(0, consumedLots.length, ...consumedLots.filter(row => row.itemId !== itemId), ...result.consumedLots);
        return { lots: result.lots, consumedLots: [] };
      } });
      continue;
    }
    if (!holdsUnitStock(item) || isGoodsItem(item)) continue;
    const unitKg = stockUnitKg(item, unpackComponent(item, inputs), id => allItems.find(row => row.id === id)) ?? 0;
    const lot = buildProductLot({ itemId, material: item.name, supplierName: '자체 생산', qtyIn: qty, unitKg });
    lot.id = `production-${operationId}-${itemId}`;
    lot.poId = operationId;
    traces.push({ itemId, lotId: lot.id, qty });
    mutations.push(productionProductLotMutation(itemId,lot));
  }
  return { traces, mutations, consumedLots };
}


function combineProductLotMutations(mutations: readonly OrderProductLotMutation[]): OrderProductLotMutation[] {
  const grouped = new Map<string, OrderProductLotMutation[]>();
  for (const mutation of mutations) grouped.set(mutation.itemId, [...(grouped.get(mutation.itemId) ?? []), mutation]);
  return [...grouped].map(([itemId, steps]) => ({ itemId, apply: (lots, stock) => {
    let result: OrderProductLotMutationResult = { lots, consumedLots: [] };
    for (const step of steps) { const next = step.apply(result.lots, stock); result = { lots: next.lots, consumedLots: [...result.consumedLots, ...next.consumedLots] }; }
    return result;
  } }));
}



/**
 * 주문 출고와 완제품 로트 추적의 계산 경계.
 *
 * 여기서는 DB를 쓰지 않고 품목별 로트 변환만 만든다. 숫자 재고와 로트를 각각 저장하면
 * 둘 중 하나만 성공할 수 있으므로, 실제 쓰기는 orderItemStock의 한 transaction에 넘긴다.
 */
function createOrderProductLotOperations(deps: OrderProductLotDeps) {
  const { allItems, shipQtyOf } = deps;

  const deductProductLotsForOrder = (order: LotOrder): OrderProductLotMutation[] => {
    const quantityByItem = new Map<string, number>();
    for (const row of order.items) {
      const product = allItems.find(item => item.id === row.itemId);
      if (!product) throw new Error(`완제품 로트 출고 중 품목 기준정보를 찾을 수 없습니다: ${row.itemId}`);
      if (!tracksQuantityLots(product)) continue;
      const qty = shipQtyOf(row, product);
      if (qty > 0) quantityByItem.set(product.id, (quantityByItem.get(product.id) ?? 0) + qty);
    }

    return [...quantityByItem].map(([itemId, qty]) => ({
      itemId,
      apply: (lots: RawMaterialLot[]) => {
        // 로트를 쓰기 시작한 품목만 추적한다. 로트가 전혀 없는 옛 품목에 출고만으로
        // 음수 이월 로트를 새로 만들면 기존 숫자 재고와 기준점이 맞지 않는다.
        if (!lots.some(lot => lot.qtyRemaining != null)) return { lots, consumedLots: [] };
        const result = deductLotsByQty(lots, qty);
        if (result.shortageQty > 0) {
          const product = allItems.find(item => item.id === itemId);
          const available = Math.round((qty - result.shortageQty) * 1000) / 1000;
          throw new OrderInventoryPreconditionError(`${product?.name ?? itemId} 로트 재고가 부족합니다. 현재 ${available}, 출고 ${qty}`);
        }
        const consumedLots = result.distribution.map(trace => ({
          itemId,
          material: result.lots.find(lot => lot.id === trace.lotId)?.material,
          lotId: trace.lotId,
          lotNo: trace.lotNo,
          receivedDate: trace.receivedDate,
          qty: trace.qty,
          lotSnapshot: lots.find(lot => lot.id === trace.lotId),
        }));
        return { lots: result.lots, consumedLots };
      },
    }));
  };

  const restoreProductLotsForOrder = (order: LotOrder): OrderProductLotMutation[] => {
    const byItem = new Map<string, (ProductLotTake & { lotSnapshot?: RawMaterialLot })[]>();
    for (const trace of order.productConsumedLots ?? []) {
      const current = byItem.get(trace.itemId) ?? [];
      current.push({
        lotId: trace.lotId,
        lotNo: trace.lotNo,
        receivedDate: trace.receivedDate,
        supplierName: trace.lotSnapshot?.supplierName ?? '',
        qty: trace.qty,
        lotSnapshot: trace.lotSnapshot,
      });
      byItem.set(trace.itemId, current);
    }
    return [...byItem].map(([itemId, traces]) => ({
      itemId,
      apply: (lots: RawMaterialLot[]) => {
        const missing: RawMaterialLot[] = [];
        for (const trace of traces) {
          if (lots.some(lot => lot.id === trace.lotId) || missing.some(lot => lot.id === trace.lotId)) continue;
          const snapshot = trace.lotSnapshot;
          if (!snapshot || !trace.lotId || snapshot.id !== trace.lotId) {
            throw new OrderInventoryPreconditionError('취소할 완제품 로트 원본이 없습니다. 저장된 소비 이력을 확인해 주세요.');
          }
          // Preserve origin metadata, but restore only this consumption, never the old snapshot balance.
          missing.push({ ...snapshot, qtyRemaining: 0, kgRemaining: 0, status: 'active' });
        }
        return { lots: restoreLotsByQty([...missing, ...lots], traces), consumedLots: [] };
      },
    }));
  };

  return { deductProductLotsForOrder, restoreProductLotsForOrder };
}

return {productionProductLotMutation,productionProductLots:(deltas:ReadonlyMap<string,number>,operationId:string)=>productionProductLots(deps.allItems,deltas,operationId,deps.unitInputs),reverseProductionProductLots,combineProductLotMutations,...createOrderProductLotOperations(deps)};
}
export function restoreLotsByQty(lots: RawMaterialLot[], taken: ProductLotTake[]): RawMaterialLot[] {
  const next = lots.map(l => ({ ...l }));
  for (const t of taken) {
    const l = next.find(x => x.id === t.lotId);
    if (!l || t.qty <= 0) continue;
    l.qtyRemaining = round3((l.qtyRemaining ?? 0) + t.qty);
    l.kgRemaining = round3((l.qtyRemaining ?? 0) * (l.unitKg ?? 0));
    if ((l.qtyRemaining ?? 0) > 0) l.status = 'active';
  }
  return next;
}


export function pruneDepletedLotsAtCutoff(lots:RawMaterialLot[],cutoffStr:string):RawMaterialLot[]{
 const kept = lots.filter(l => l.status !== 'depleted' || (l.receivedDate ?? '9999-99-99') >= cutoffStr);
 return kept.length === lots.length ? lots : kept;
}
export function productLotKstCutoff(asOf:string,retentionMonths=6):string {
 const cutoff=new Date(new Date(asOf).getTime()+9*60*60*1000);
 cutoff.setUTCMonth(cutoff.getUTCMonth()-retentionMonths);
 return new Date(cutoff.getTime()-9*60*60*1000).toISOString().slice(0,10);
}
const round3=(n:number)=>Math.round(n*1000)/1000;
