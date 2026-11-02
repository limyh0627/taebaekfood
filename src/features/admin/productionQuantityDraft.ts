import { toQuantityMilli, fromQuantityMilli, assertQuantityForKind, assertCompletionChoiceMatchesUnit, type BatchOpenResult, type CompletionChoice } from '../../../functions/src/shared/orderProductionBatchContract';
import type { Item, Order } from '../../shared/types';
import { ensureOrderLineIds } from '../../shared/orderLineInventory';
import { isStockProduction } from '../../shared/orderPurpose';
import { holdsUnitStock, isGoodsItem } from '../../shared/itemTaxonomy';
import { unreservedItemStock } from './orderItemStock';
import { resolveStockUse, type StockUseRow } from './stockUseRows';

export type ProductionTarget = { lineId?: string; itemIndex?: number };
export type ProductionQuantityDraft = { production: string; own: string; loose: string; productionEdited: boolean };
export type ProductionOpeningRow = BatchOpenResult['rows'][number];
export type ProductionRoute = { kind: 'batch' } | { kind: 'legacy'; reason: 'existing-legacy' | 'non-manufacturing' | 'stock-production' } | { kind: 'review'; message: string };

export function resolveProductionRoute(order: Order, catalog: readonly Item[], target?: ProductionTarget): ProductionRoute {
 const o=order as Order & Record<string, any>;
 if (isStockProduction(order)) return {kind:'legacy',reason:'stock-production'};
 if (Object.prototype.hasOwnProperty.call(o,'orderProductionRefsV1')) return {kind:'batch'};
 const items=target?.itemIndex!==undefined?[order.items[target.itemIndex]]:target?.lineId?ensureOrderLineIds(order.items).filter(x=>x.lineId===target.lineId):order.items;
 if (!items.length || items.some(x=>!x || !catalog.find(i=>i.id===x.itemId))) return {kind:'review',message:'주문 품목을 다시 확인해 주세요.'};
 const manufacturing=items.some(x=>{const i=catalog.find(p=>p.id===x.itemId);return i&&holdsUnitStock(i)&&!isGoodsItem(i)});
 if (!manufacturing) return {kind:'legacy',reason:'non-manufacturing'};
 if (Object.prototype.hasOwnProperty.call(o,'legacyRecoveryRetirementV1')) return {kind:'batch'};
 if (order.items.some(x=>x.checked) || o.producedAt || o.inventoryExecutionProtocol || o.shippedOut || o.inventorySnapshots || o.rawConsumedLots || o.productionRecordIndex || (o.rawInventoryAttempt && o.rawInventoryAttempt!==0) || Object.values(o.itemInventory??{}).some((x:any)=>x?.applied)) return {kind:'legacy',reason:'existing-legacy'};
 return {kind:'batch'};
}
export function resolveProductionTargetLineIds(order: Order, opening: BatchOpenResult, target?: ProductionTarget): string[] {
 const items=ensureOrderLineIds(order.items);
 const ids=target ? [target.lineId ?? (target.itemIndex!==undefined?items[target.itemIndex]?.lineId:undefined)] : opening.rows.filter(r=>r.completedQty<r.orderedQty).map(r=>r.lineId);
 if(ids.some(id=>!id)) throw Error('선택한 주문 품목을 다시 확인해 주세요.');
 for(const id of ids){const rows=opening.rows.filter(r=>r.lineId===id), matches=items.filter(i=>i.lineId===id);if(rows.length!==1||matches.length!==1)throw Error('선택한 주문 품목을 다시 확인해 주세요.');const line=matches[0],row=rows[0],source=row.unit.sourceLine;if(target?.itemIndex!==undefined&&items[target.itemIndex]?.lineId!==id||line.itemId!==row.itemId||(['quantity','isBoxUnit','boxQuantity','unitsPerBox'] as const).some(k=>line[k]!==source[k]))throw Error('주문 품목이 변경되었습니다. 다시 조회해 주세요.');}
 return ids as string[];
}
export function parseProductionQuantity(text:string,kind:'count'|'bulk',label:string):number|null {
 const s=text.trim();if(!s)return null;if(!/^\d+(?:\.\d{1,3})?$/.test(s))throw Error(`${label}은 0 이상의 숫자로 입력하세요.`);const n=Number(s);try{toQuantityMilli(n);assertQuantityForKind(kind,n)}catch{throw Error(`${label}의 수량과 단위를 확인해 주세요.`)}return n;
}
export function buildProductionDefaults(input:{order:Order;opening:BatchOpenResult;catalog:readonly Item[];target?:ProductionTarget}):Record<string,ProductionQuantityDraft>{
 const selected=new Set(resolveProductionTargetLineIds(input.order,input.opening,input.target));const rows:StockUseRow[]=[];
 input.opening.rows.forEach((r,idx)=>{const item=input.catalog.find(i=>i.id===r.itemId);if(!selected.has(r.lineId)||!item||!holdsUnitStock(item)||isGoodsItem(item))return;const loose=r.unit.loose;const component=loose&&input.catalog.find(i=>i.id===loose.itemId);rows.push({idx,itemId:r.itemId,name:item.name,unitLabel:r.unit.stock.label,ordered:fromQuantityMilli((toQuantityMilli(r.orderedQty)-toQuantityMilli(r.completedQty))*r.unit.stock.unitsPerOrderUnit),stock:unreservedItemStock(item),...(loose&&component?{loose:{itemId:loose.itemId,name:component.name,count:loose.unitsPerBox,stock:unreservedItemStock(component),unitLabel:loose.label}}:{})})});
 const result:Record<string,ProductionQuantityDraft>={};for(const r of input.opening.rows)result[r.lineId]={production:'0',own:'0',loose:'0',productionEdited:false};for(const s of resolveStockUse(rows))result[input.opening.rows[s.row.idx].lineId]={production:String(s.shortUnits),own:String(s.own),loose:String(s.loose?.value??0),productionEdited:false};return result;
}
export function buildProductionCompletion(row:ProductionOpeningRow,draft:ProductionQuantityDraft):{choice:CompletionChoice|null;producedStock:number;completeNow:number;completedAfter:number}{
 const production=parseProductionQuantity(draft.production,row.unit.stock.quantityKind,'생산 수량')??0,own=parseProductionQuantity(draft.own,row.unit.stock.quantityKind,'재고 사용량')??0,loose=row.unit.loose?parseProductionQuantity(draft.loose,row.unit.loose.quantityKind,'구성품 사용량')??0:0;
 const sum=toQuantityMilli(production)+toQuantityMilli(own), divisor=row.unit.stock.unitsPerOrderUnit;if(!Number.isSafeInteger(sum)||!Number.isFinite(divisor)||divisor<=0||!Number.isSafeInteger(sum/divisor))throw Error('생산과 재고 사용량을 주문 단위로 정확히 환산할 수 없습니다.');const completeNow=fromQuantityMilli(sum/divisor);const after=toQuantityMilli(row.completedQty)+sum/divisor;if(!Number.isSafeInteger(after)||after>toQuantityMilli(row.orderedQty))throw Error('완료 합계가 남은 주문 수량을 초과합니다.');if(row.unit.order.kind==='box-count'&&sum/divisor%1000!==0)throw Error('완료 박스 수량은 정수여야 합니다.');if(!sum){if(loose)throw Error('완료 수량 없이 구성품만 사용할 수 없습니다.');return {choice:null,producedStock:0,completeNow:0,completedAfter:row.completedQty}}
 if(loose>production*(row.unit.loose?.unitsPerBox??0))throw Error('구성품 사용량이 생산에 필요한 수량을 초과합니다.');
 const choice:CompletionChoice={lineId:row.lineId,complete:{value:completeNow,kind:row.unit.order.kind,measureId:row.unit.measureId},stockUse:{own:{itemId:row.unit.stock.itemId,value:own,measureId:row.unit.measureId},...(row.unit.loose?{loose:{itemId:row.unit.loose.itemId,value:loose,measureId:row.unit.measureId}}:{})}};assertCompletionChoiceMatchesUnit(row.unit,choice);return {choice,producedStock:production,completeNow,completedAfter:fromQuantityMilli(after)};
}
