import {docDateOf,docSaleLines,docOilKg,addOilByRaw,docUnpack,docPumokAt} from './docOil';
import {stockUnits,type OrderUnitInputs} from './orderUnits';
import {OrderStatus,type Order,type Item,type ProductionRecord,type OrderRawCalculationEvidence} from './types';
import {companyOf,type RawMaterialEntry} from './types';
import {sameOrderInventoryGeneration} from './orderInventoryGeneration';

export interface RawDocOrderSource {
 orderId:string;lineId?:string;lineIndex:number;itemId?:string;itemName:string;spec:string;documentQuantity:number;documentUnit?:string;inputUnit?:string;unpackFactor?:number;documentOilKg:number;roundedOilKg:number;
 inputQuantity:number;boxQuantity?:number;isBoxUnit?:boolean;stockUnits:number;production?:{id:string;finishedQty:number};storedCalculations?:OrderRawCalculationEvidence[];rawContributionKg?:number;allocationAdjustmentKg?:number;
}
export interface RawDocUsageContribution {kind:'document'|'ledger'|'excluded'|'rounding';itemName:string;rawKg:number;sources:RawDocOrderSource[];recordId?:string;material?:string;source?:unknown;note?:string;orderId?:string;reportedDeltaKg?:number;appliedDeltaKg?:number;unconfirmed?:boolean}
export interface RawDocUsageSelection {companyId:string;month:string;material:string;date:string;segment:string;total:number;contributions:RawDocUsageContribution[]}

/** 일자·품목 합계의 기존 반올림을 유지하면서 같은 계산에서 출처를 함께 남긴다. */
export function collectRawDocOilUsage(orders:Order[],items:Item[],inputs?:OrderUnitInputs,records:ProductionRecord[]=[],companyId='taebaek'){
 const dayCat:Record<string,Record<string,number>>={},sources=new Map<string,RawDocOrderSource[]>();
 for(const order of orders){
  if(![OrderStatus.SHIPPED,OrderStatus.DELIVERED].includes(order.status as OrderStatus))continue;
  const date=docDateOf(order);if(!date)continue;
  for(const [lineIndex,item] of order.items.entries()){
   const product=items.find(row=>row.id===item.itemId)||items.find(row=>row.name===item.name);
   // 박스·선물세트는 전표와 같은 정본을 거친다. 입력 수량을 다시 풀면 개입수가 중복된다.
   const quantity=stockUnits(item,product,inputs);
   const pointer=item.lineId?order.productionRecordIndex?.[item.lineId]:undefined;
   const unpacked=docUnpack(product,quantity,id=>items.find(row=>row.id===id),inputs);
   for(const line of docSaleLines(product,quantity,id=>items.find(row=>row.id===id),inputs,date)){
    const kg=docOilKg(line.spec,line.qty);if(kg<=0)continue;
    const childIds=unpacked.filter(row=>docPumokAt(row.item,date)===line.품목&&(row.item.spec??'')===line.spec).map(row=>row.item.id);
    const candidates=records.filter(record=>companyOf(record)===companyId&&!record.supersededBy&&record.orderId===order.id&&childIds.length===1&&record.itemId===childIds[0]&&Number.isFinite(record.finishedQty)&&record.finishedQty>=0&&(pointer?record.id===pointer.recordId&&record.lineId===item.lineId&&sameOrderInventoryGeneration(record.generation,pointer.generation):item.lineId?record.lineId===item.lineId&&!record.generation:!record.lineId&&!record.generation&&order.items.filter(row=>row.itemId===item.itemId).length===1));
    const lineSnapshot=item.lineId?order.itemInventory?.[item.lineId]:undefined;
    const storedCalculations=lineSnapshot?.applied&&lineSnapshot.itemId===item.itemId?lineSnapshot.production.rawCalculationEvidence?.filter(row=>childIds.includes(row.productId)&&Number.isFinite(row.kg)):undefined;
    const production=candidates.length===1?{id:candidates[0].id,finishedQty:candidates[0].finishedQty}:undefined;
    (dayCat[date]=dayCat[date]||{})[line.품목]=(dayCat[date][line.품목]||0)+Math.round(kg);
    const key=`${date}\n${line.품목}`,list=sources.get(key)??[];
    list.push({orderId:order.id,lineId:item.lineId,lineIndex,itemId:item.itemId,itemName:item.name,spec:line.spec,documentQuantity:line.qty,documentUnit:unpacked.find(row=>row.item.id===childIds[0])?.item.unit||'개',inputUnit:product?.unit||'미확인',unpackFactor:quantity!==0?line.qty/quantity:undefined,documentOilKg:kg,roundedOilKg:Math.round(kg),inputQuantity:item.quantity,boxQuantity:item.boxQuantity,isBoxUnit:item.isBoxUnit,stockUnits:quantity,production,storedCalculations});sources.set(key,list);
   }
  }
 }
 const totals:Record<string,Record<string,number>>={},contributions:Record<string,Record<string,RawDocUsageContribution[]>>={};
 for(const date in dayCat){const row:Record<string,number>={};contributions[date]={};
  for(const [itemName,kg] of Object.entries(dayCat[date])){const before={...row};addOilByRaw(row,itemName,kg);
   for(const raw of Object.keys(row)){const rawKg=row[raw]-(before[raw]??0);if(!rawKg)continue;const originals=sources.get(`${date}\n${itemName}`)??[];let assigned=0;const allocated=originals.map((entry,index)=>{const proportional=kg===0?0:rawKg*entry.roundedOilKg/kg;const value=index===originals.length-1?rawKg-assigned:Math.round(proportional*1e6)/1e6;assigned+=value;return {...entry,rawContributionKg:value,allocationAdjustmentKg:value-proportional};});(contributions[date][raw]??=[]).push({kind:'document',itemName,rawKg,sources:allocated});}
  }totals[date]=row;
 }
 return {totals,contributions};
}
export const rawDocNoteSummary=(note:string,max=90)=>note.length>max?`${note.slice(0,max)}…`:note;

export type RawDocLedgerRecord=RawMaterialEntry & {operationId?:string;source?:unknown;reportedDeltaKg?:number;appliedDeltaKg?:number};
const sourceOf=(entry:RawDocLedgerRecord)=>entry.source&&typeof entry.source==='object'?entry.source as {type?:unknown;id?:unknown}:undefined;
/** 원료명이나 op_ 접두사로 추정하지 않고 같은 회사·원료·주문 원문을 확인한다. */
export function rawDocProductionReplacement(entry:RawDocLedgerRecord,all:readonly RawDocLedgerRecord[],companyId:string):'replace'|'keep'|'unconfirmed'{
 const production=(row:RawDocLedgerRecord)=>{const source=sourceOf(row);return row.kind==='consume'&&row.companyId===companyId&&[row.rawItemId,row.operationId,row.orderId].every(value=>typeof value==='string'&&value.length>0&&value.trim()===value)&&source?.type==='production'&&source.id===row.orderId;};
 if(production(entry))return 'replace';
 if(entry.kind!=='reverse')return 'keep';
 if(!entry.reversalOf)return 'unconfirmed';
 const originals=all.filter(row=>row.operationId===entry.reversalOf&&companyOf(row)===companyId&&row.rawItemId===entry.rawItemId);
 if(originals.length!==1)return 'unconfirmed';const original=originals[0],source=sourceOf(entry);
 const writerMatches=source?.type==='reversal'&&((source.id===original.orderId&&entry.orderId===original.orderId)||(source.id===original.operationId&&(entry.orderId==null||entry.orderId===original.orderId)));
 return production(original)&&entry.companyId===companyId&&writerMatches?'replace':'unconfirmed';
}
