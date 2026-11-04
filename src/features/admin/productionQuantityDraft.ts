import { toQuantityMilli, fromQuantityMilli, assertQuantityForKind, assertCompletionChoiceMatchesUnit, type BatchOpenResult, type CompletionChoice } from '../../../functions/src/shared/orderProductionBatchContract';
import { OrderStatus, type Item, type Order } from '../../shared/types';
import { ensureOrderLineIds } from '../../shared/orderLineInventory';
import { isStockProduction } from '../../shared/orderPurpose';
import { holdsUnitStock, isBulkItem, isGoodsItem } from '../../shared/itemTaxonomy';
import { stockUnits, unpackComponent, type OrderUnitInputs } from '../../shared/orderUnits';
import { categoryOf } from '../../shared/productChip';
import { unreservedItemStock } from './orderItemStock';
import { resolveStockUse, type StockUseRow } from './stockUseRows';

export type ProductionTarget = { lineId?: string; itemIndex?: number };
export type ProductionQuantityDraft = { production: string; own: string; loose: string; productionEdited: boolean };
export type ProductionOpeningRow = BatchOpenResult['rows'][number];
export type ProductionRoute = { kind: 'batch' } | { kind: 'legacy'; reason: 'existing-legacy' | 'non-manufacturing' | 'stock-production' } | { kind: 'review'; message: string };

export function resolveProductionRoute(order: Order, catalog: readonly Item[], target?: ProductionTarget): ProductionRoute {
 const o=order as Order & Record<string, any>;
 if (isStockProduction(order)) return {kind:'legacy',reason:'stock-production'};
 // 끝나지 않은 새 방식 요청이 주문을 잡고 있으면 표식만 보고 옛 경로로 보내지 않는다. 서버 창이 '이전 작업 확인'으로 안내한다.
 if (o.inventoryOperation?.fullAttemptId && o.inventoryOperation?.fullReference) return {kind:'batch'};
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
/** 남은 주문 수량을 재고 단위로. 박스 주문을 낱개 재고로 세는 줄이 있어 주문 단위와 다를 수 있다. */
const remainingStockUnits=(r:ProductionOpeningRow)=>fromQuantityMilli((toQuantityMilli(r.orderedQty)-toQuantityMilli(r.completedQty))*r.unit.stock.unitsPerOrderUnit);
/**
 * 생산 처리에서 이 줄을 어떻게 다루나.
 * made: 만드는 품목 — 재고를 먼저 쓰고 모자란 만큼 생산. stock-only: 상품·완사입·임가공 — 만들지 않고 재고에서만 나간다.
 * no-stock: 재고를 들지 않는 품목(용역 등). stock-only·no-stock에는 서버가 재고 사용량을 받지 않으므로 칸을 보여 주지 않는다.
 */
export type ProductionLineKind='made'|'stock-only'|'no-stock';
export const productionLineKind=(item:Item):ProductionLineKind=>isGoodsItem(item)&&!isBulkItem(item)?'stock-only':holdsUnitStock(item)?'made':'no-stock';
export type StockShortage={name:string;need:number;stock:number;others:number;unit:string};
/** 품목별로 어느 주문이 완료해 두고 아직 출고하지 않은 수량. `type=goods` 상품은 예약을 잡지 않으므로 주문을 훑어서 센다. */
export type GoodsCommitted=ReadonlyMap<string,ReadonlyMap<string,number>>;
export function buildGoodsCommitted(orders:readonly Order[],catalog:readonly Item[],inputs?:OrderUnitInputs):GoodsCommitted{
 const items=new Map(catalog.map(item=>[item.id,item])),result=new Map<string,Map<string,number>>();
 for(const order of orders){
  if(isStockProduction(order)||order.shippedOut||order.status===OrderStatus.SHIPPED||order.status===OrderStatus.DELIVERED)continue;
  const refs=(order as Order&{orderProductionRefsV1?:{lines?:{lineId:string;completedQty:number}[]}}).orderProductionRefsV1;
  for(const line of order.items??[]){
   const item=items.get(line.itemId);if(!item||holdsUnitStock(item)||productionLineKind(item)!=='stock-only')continue;
   const all=stockUnits(line,item,inputs),ordered=line.isBoxUnit&&line.boxQuantity?line.boxQuantity:line.quantity;
   const done=refs?all*(refs.lines?.find(row=>row.lineId===line.lineId)?.completedQty??0)/ordered:line.checked?all:0;if(!(done>0))continue;
   const rows=result.get(item.id)??new Map<string,number>();rows.set(order.id,(rows.get(order.id)??0)+done);result.set(item.id,rows);
  }
 }
 return result;
}
const quantity3=(value:number)=>Math.round(value*1000)/1000;
export function committedByOthers(committed:GoodsCommitted|undefined,itemId:string,orderId:string):number{
 let total=0;for(const [owner,qty] of committed?.get(itemId)??[])if(owner!==orderId)total+=qty;return quantity3(total);
}
/** 현재고와 다른 주문이 쓰기로 한 양. 완사입·임가공은 예약으로, 상품은 다른 주문의 완료분으로 잡힌다. */
function stockAndOthers(item:Item,orderId:string,committed?:GoodsCommitted){
 const stock=Number(item.stock??0);return {stock,others:quantity3(stock-unreservedItemStock(item)+committedByOthers(committed,item.id,orderId))};
}
/** 2026-11-04 사장님: 상품은 현재고·이번 주문량·차감 후 재고만 확인되면 된다. */
export function goodsStockView(row:ProductionOpeningRow,item:Item,orderId:string,committed?:GoodsCommitted){
 const {stock,others}=stockAndOthers(item,orderId,committed),need=remainingStockUnits(row);return {stock,others,need,after:quantity3(stock-others-need)};
}
const pushShortage=(result:{add:(key:string,row:StockShortage)=>void},used:Map<string,number>,key:string,item:Item,orderId:string,committed:GoodsCommitted|undefined,need:number,unit:string)=>{
 const {stock,others}=stockAndOthers(item,orderId,committed),taken=used.get(item.id)??0;
 if(need>0&&stock-others-taken<need)result.add(key,{name:item.name,need,stock,others:quantity3(others+taken),unit});else used.set(item.id,taken+need);
};
/** 2026-11-04 사장님: 상품은 우리가 만들지 않으니 재고가 모자라면 완료할 수 없다. 생산 창과 옛 경로가 같은 문장을 쓴다. */
export const stockShortageNotice=(rows:readonly StockShortage[])=>['재고가 부족해서 주문을 완료할 수 없습니다.',...rows.map(row=>`${row.name}: 현재고 ${row.stock} ${row.unit}${row.others>0?` · 다른 주문 완료분 ${row.others} ${row.unit}`:''} · 이번 주문 ${row.need} ${row.unit}`),'사 오거나 맡긴 물건이라 생산으로 채워지지 않습니다. 다른 품목만 먼저 끝내려면 주문에서 그 품목만 선택해 주세요.'].join('\n');
/** 생산 창에서 처리할 줄 중 재고가 모자란 만들지 않는 줄. 같은 품목의 여러 줄은 재고 한 풀을 나눠 쓴다. */
export function findStockShortages(rows:readonly ProductionOpeningRow[],catalog:readonly Item[],lineIds:ReadonlySet<string>,orderId='',committed?:GoodsCommitted):Record<string,StockShortage>{
 const used=new Map<string,number>(),result:Record<string,StockShortage>={};
 for(const row of rows){const item=catalog.find(i=>i.id===row.itemId);if(!item||!lineIds.has(row.lineId)||productionLineKind(item)!=='stock-only')continue;pushShortage({add:(key,value)=>{result[key]=value}},used,row.lineId,item,orderId,committed,remainingStockUnits(row),row.unit.stock.label);}
 return result;
}
/** 옛 경로의 주문 전체 완료용. 이미 완료한 줄은 다시 보지 않는다. */
export function findUncheckedGoodsShortages(items:Order['items'],catalog:readonly Item[],inputs?:OrderUnitInputs,committed?:GoodsCommitted,orderId=''):StockShortage[]{
 const used=new Map<string,number>(),result:StockShortage[]=[];
 for(const line of items){const item=catalog.find(i=>i.id===line.itemId);if(line.checked||!item||productionLineKind(item)!=='stock-only')continue;pushShortage({add:(_key,value)=>{result.push(value)}},used,line.itemId,item,orderId,committed,stockUnits(line,item,inputs),unpackComponent(item,inputs)?'박스':(item.unit||'개'));}
 return result;
}
export function buildProductionDefaults(input:{order:Order;opening:BatchOpenResult;catalog:readonly Item[];target?:ProductionTarget;lineIds?:readonly string[]}):Record<string,ProductionQuantityDraft>{
 const selected=new Set(input.lineIds??resolveProductionTargetLineIds(input.order,input.opening,input.target));const rows:StockUseRow[]=[];
 input.opening.rows.forEach((r,idx)=>{const item=input.catalog.find(i=>i.id===r.itemId);if(!selected.has(r.lineId)||!item||productionLineKind(item)!=='made')return;const loose=r.unit.loose;const component=loose&&input.catalog.find(i=>i.id===loose.itemId);rows.push({idx,itemId:r.itemId,name:item.name,unitLabel:r.unit.stock.label,ordered:remainingStockUnits(r),stock:unreservedItemStock(item),...(loose&&component?{loose:{itemId:loose.itemId,name:component.name,count:loose.unitsPerBox,stock:unreservedItemStock(component),unitLabel:loose.label}}:{})})});
 const result:Record<string,ProductionQuantityDraft>={};for(const r of input.opening.rows){result[r.lineId]={production:'0',own:'0',loose:'0',productionEdited:false};const item=input.catalog.find(i=>i.id===r.itemId);if(selected.has(r.lineId)&&item&&productionLineKind(item)!=='made')result[r.lineId].production=String(remainingStockUnits(r));}for(const s of resolveStockUse(rows))result[input.opening.rows[s.row.idx].lineId]={production:String(s.shortUnits),own:String(s.own),loose:String(s.loose?.value??0),productionEdited:false};return result;
}
export function buildProductionCompletion(row:ProductionOpeningRow,draft:ProductionQuantityDraft):{choice:CompletionChoice|null;producedStock:number;completeNow:number;completedAfter:number}{
 const production=parseProductionQuantity(draft.production,row.unit.stock.quantityKind,'생산 수량')??0,own=parseProductionQuantity(draft.own,row.unit.stock.quantityKind,'재고 사용량')??0,loose=row.unit.loose?parseProductionQuantity(draft.loose,row.unit.loose.quantityKind,'구성품 사용량')??0:0;
 const sum=toQuantityMilli(production)+toQuantityMilli(own), divisor=row.unit.stock.unitsPerOrderUnit;if(!Number.isSafeInteger(sum)||!Number.isFinite(divisor)||divisor<=0||!Number.isSafeInteger(sum/divisor))throw Error('생산과 재고 사용량을 주문 단위로 정확히 환산할 수 없습니다.');const completeNow=fromQuantityMilli(sum/divisor);const after=toQuantityMilli(row.completedQty)+sum/divisor;if(!Number.isSafeInteger(after)||after>toQuantityMilli(row.orderedQty))throw Error('완료 합계가 남은 주문 수량을 초과합니다.');if(row.unit.order.kind==='box-count'&&sum/divisor%1000!==0)throw Error('완료 박스 수량은 정수여야 합니다.');if(!sum){if(loose)throw Error('완료 수량 없이 구성품만 사용할 수 없습니다.');return {choice:null,producedStock:0,completeNow:0,completedAfter:row.completedQty}}
 if(loose>production*(row.unit.loose?.unitsPerBox??0))throw Error('구성품 사용량이 생산에 필요한 수량을 초과합니다.');
 const choice:CompletionChoice={lineId:row.lineId,complete:{value:completeNow,kind:row.unit.order.kind,measureId:row.unit.measureId},stockUse:{own:{itemId:row.unit.stock.itemId,value:own,measureId:row.unit.measureId},...(row.unit.loose?{loose:{itemId:row.unit.loose.itemId,value:loose,measureId:row.unit.measureId}}:{})}};assertCompletionChoiceMatchesUnit(row.unit,choice);return {choice,producedStock:production,completeNow,completedAfter:fromQuantityMilli(after)};
}
/** 창에 보이는 한 줄 요약. 칸 이름과 같은 말을 쓴다. 수량이 잘못되면 buildProductionCompletion처럼 던진다. */
export function summarizeProductionCompletion(row:ProductionOpeningRow,draft:ProductionQuantityDraft,kind:ProductionLineKind):string{
 const {completeNow,producedStock}=buildProductionCompletion(row,draft),order=row.unit.order.label,stock=row.unit.stock.label;if(!completeNow)return '이번에는 처리하지 않습니다.';
 if(kind!=='made')return `${completeNow} ${order} 완료`;
 const own=parseProductionQuantity(draft.own,row.unit.stock.quantityKind,'재고 사용량')??0,loose=row.unit.loose?parseProductionQuantity(draft.loose,row.unit.loose.quantityKind,'구성품 사용량')??0:0;
 const parts=[...(own>0?[`있던 재고 ${own} ${stock}`]:[]),...(producedStock>0?[`새로 만듦 ${producedStock} ${stock}${loose>0?` (있던 낱개 ${loose} ${row.unit.loose?.label??''} 사용)`:''}`]:[])];
 return `${completeNow} ${order} 완료 = ${parts.join(' + ')}`;
}
/** 더 만든 재고의 후보. 서버가 받는 품목(제 재고를 드는 제조 품목)만 고른다. 주문 품목이 먼저, 그다음 같은 카테고리에서 이름 조각이 많이 겹치는 순. */
export function buildExtraCandidates(rows:readonly {itemId:string}[],catalog:readonly Item[],limit=5):{suggested:Item[];all:Item[]}{
 const all=catalog.filter(item=>!item.archived&&holdsUnitStock(item)&&!isGoodsItem(item)&&!!item.unit?.trim()&&!!item.name?.trim());
 const orderedIds=new Set(rows.map(row=>row.itemId)),ordered=catalog.filter(item=>orderedIds.has(item.id)),parts=(name:string)=>name.toLowerCase().split('/').map(part=>part.trim()).filter(Boolean);
 const overlap=(item:Item)=>Math.max(0,...ordered.filter(row=>categoryOf(row)&&categoryOf(row)===categoryOf(item)).map(row=>{const a=parts(row.name),b=parts(item.name);return b.filter(part=>a.includes(part)).length+(a[0]===b[0]?1:0)}));
 const similar=all.filter(item=>!orderedIds.has(item.id)&&overlap(item)>0).sort((a,b)=>overlap(b)-overlap(a)||a.name.localeCompare(b.name,'ko')).slice(0,limit);
 return {suggested:[...all.filter(item=>orderedIds.has(item.id)),...similar],all};
}
