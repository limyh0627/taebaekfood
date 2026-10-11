import { doc,runTransaction,type Firestore } from 'firebase/firestore';
import { rawPressText } from '../../shared/rawPressAttempt';
import { companyOf,type Item,type Order } from '../../shared/types';
import { planOrderStockReservation } from './orderItemStock';
import type { JobCommandInput } from '../../shared/services/rawInventoryJob';
import { prepareRawCommand,readRawCommandInTransaction } from '../../shared/services/rawInventoryService';
import type { RawInventoryState } from '../../shared/rawInventoryCore';
import type { OrderProductLotMutation } from './orderProductLots';
export type OrderProductionPreview={deltas:ReadonlyMap<string,number>;commands:readonly JobCommandInput[];lotMutations?:readonly OrderProductLotMutation[]};
export class OrderProductionPreflightError extends Error {
 constructor(public readonly problems:readonly string[]){super('작업완료를 시작하지 않았습니다.\n'+problems.join('\n'));}
}
/** 미리보기는 예약도 쓰지 않는다. 통과 뒤의 경합은 기존 예약·재고 TX가 다시 검증한다. */
export async function inspectOrderProduction(input:{db:Firestore;order:Order;itemIds:readonly string[];preview:(stock:ReadonlyMap<string,number>)=>OrderProductionPreview;preserveOwnAllocation?:boolean}):Promise<readonly string[]> {
 return runTransaction(input.db,async tx=>{
  const ids=[...new Set(input.itemIds)],orderSnap=await tx.get(doc(input.db,'orders',input.order.id));
  if(!orderSnap.exists())return ['주문을 찾을 수 없습니다.'];
  const live=orderSnap.data() as Order;
  // 사전검사 중 주문 원문이 바뀌면 낡은 선택으로 claim하지 않는다.
  const evidence=(order:Order)=>rawPressText({status:order.status,items:order.items,producedAt:order.producedAt,shippedOut:order.shippedOut,deliveredAt:order.deliveredAt,rawInventoryAttempt:order.rawInventoryAttempt,itemInventory:order.itemInventory,inventorySnapshots:order.inventorySnapshots,rawConsumedLots:order.rawConsumedLots,inventoryOperation:order.inventoryOperation,purpose:order.purpose});
  if(companyOf(live)!==companyOf(input.order)||evidence(live)!==evidence(input.order))return ['주문이 변경되었습니다. 새로 확인해 주세요.'];
  const snapshots=await Promise.all(ids.map(id=>tx.get(doc(input.db,'items',id))));
  const problems:string[]=[],data=new Map<string,Record<string,any>>();
  snapshots.forEach((snap,index)=>{if(!snap.exists())problems.push('품목을 찾을 수 없습니다: '+ids[index]);else if(companyOf(snap.data())!==companyOf(input.order))problems.push('품목 회사가 다릅니다: '+ids[index]);else data.set(ids[index],snap.data());});
  if(problems.length)return problems;
  let preview:OrderProductionPreview|undefined;
  try{
   const reserved=planOrderStockReservation(input.order.id,data,stock=>{preview=input.preview(stock);return preview.deltas;},{preserveOwnAllocation:input.preserveOwnAllocation});
   for(const shortage of reserved.shortages){const item=data.get(shortage.itemId);problems.push(`${item?.name??shortage.itemId} 재고 부족: 현재 ${shortage.current}, 다른 주문 예약 ${shortage.other}, 필요 ${shortage.required}, 부족 ${shortage.missing}`);}
  }catch(error){problems.push((error as Error).message);return problems;}
  const commands=preview!.commands;
  const reads=await Promise.all(commands.map(row=>readRawCommandInTransaction(tx,input.db,row.command)));
  const virtual=new Map<string,{state:RawInventoryState;itemData:Record<string,any>}>();
  for(let index=0;index<commands.length;index++){
   const row=commands[index],read=reads[index],key=row.command.companyId+':'+row.command.rawItemId;
   if(read.movementSnap.exists()&&read.oldMovementSnap?.exists()){problems.push('신·구 원료 이력이 동시에 있습니다: '+row.command.materialSnapshot);continue;}
   const result=prepareRawCommand(row.command,read,row.options,virtual.get(key));
   if(result.status==='rejected'||result.status==='conflict'){problems.push(row.command.materialSnapshot+' — '+(result.status==='rejected'?result.message:'동일 작업번호 원문 충돌'));continue;}
   if(result.status==='applied'){
    const itemData={...(virtual.get(key)?.itemData??read.itemSnap.data()??{})};
    if(row.command.kind!=='ledger-consume')itemData.stock=result.state.stockKg;
    virtual.set(key,{state:result.state,itemData});
   }
  }
  const lots=new Map<string,Item['lots']>();
  for(const mutation of preview!.lotMutations??[]){try{const item=data.get(mutation.itemId);if(!item)throw Error('로트 검사 품목 없음: '+mutation.itemId);const before=lots.get(mutation.itemId)??structuredClone(item.lots??[]);lots.set(mutation.itemId,mutation.apply(before,Number(item.stock??0)).lots);}catch(error){problems.push((error as Error).message);}}
  return problems;
 });
}
