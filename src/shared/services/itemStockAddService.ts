import {doc,runTransaction,type Firestore} from 'firebase/firestore';
import {db} from '../firebase';
import {COL} from '../collections';
import {companyOf,type Item} from '../types';
import {isRawHolder} from '../rawHolder';
import {anchorLotsByQty} from '../lotAnchor';
import {canStockAfter} from '../unpackLots';
import {pruneDepletedLots} from '../lotUtils';
import {operationDocId} from '../rawInventoryCore';
import {productStocktakeActor} from './unpackService';
import {ItemInventoryRejected,prepareItemInventory,assertItemInventoryWriteBudget,validateItemInventoryRequest,itemInventoryRequestHash,itemInventoryRequestText,runItemInventoryAttempt,type ItemStockAddRequest,type ItemInventoryOutcome} from '../itemInventoryAttempt';
const clean=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
/** 기존 수동 증감 계산을 모든 품목에 준비한 뒤 전체와 영수증을 한 번에 쓴다. */
export async function applyItemStockAddWithDb(store:Firestore,request:ItemStockAddRequest,mode:'apply'|'inspect',check:()=>Promise<void>):Promise<ItemInventoryOutcome>{
 validateItemInventoryRequest(request);if(request.kind!=='stock-add')throw Error('재고 추가 요청 종류가 다릅니다.');request=clean(request);await check();const requestHash=await itemInventoryRequestHash(request);await check();
 return runTransaction<ItemInventoryOutcome>(store,async tx=>{
  await check();const receiptRef=doc(store,COL.itemStockAddOperations,operationDocId(request.operationId));
  const receipt=await tx.get(receiptRef);await check();
  if(receipt.exists()){
   const saved=receipt.data(),results=saved.results;
   if(saved.id!==operationDocId(request.operationId)||saved.companyId!==request.companyId||saved.uid!==request.uid||saved.status!=='complete'||saved.requestHash!==requestHash||itemInventoryRequestText(saved.request)!==itemInventoryRequestText(request)||saved.completedAt!==request.capturedAt||!Array.isArray(results)||results.length!==request.rows.length||results.some((row:any,index:number)=>row.itemId!==request.rows[index].itemId||row.deltaQty!==request.rows[index].deltaQty||!Number.isFinite(row.beforeQty)||!Number.isFinite(row.afterQty)||row.afterQty<0||row.anchorId!==('add-'+operationDocId(request.operationId)+'-'+index)||Object.keys(row).some(key=>!['itemId','beforeQty','afterQty','deltaQty','anchorId'].includes(key))||row.afterQty!==canStockAfter(anchorLotsByQty({lots:[],targetQty:row.beforeQty+row.deltaQty,unitKg:request.rows[index].unitKg,det:{id:row.anchorId,createdAt:request.capturedAt,receivedDate:request.date}}).lots)))throw Error('재고 추가 영수증이 최초 원문과 다릅니다.');
   return {ok:true,status:'duplicate',message:'최초 재고 추가 결과를 확인했습니다.',retainPending:false};
  }
  if(mode==='inspect')return {ok:false,status:'blocked',message:'최초 재고 추가 영수증이 없습니다. 재고를 다시 더하지 않았습니다.',retainPending:true};
  const refs=request.rows.map(row=>doc(store,COL.items,row.itemId)),snaps=await Promise.all(refs.map(ref=>tx.get(ref)));await check();
  const prepared=prepareItemInventory(()=>request.rows.map((row,index)=>{
   const snap=snaps[index];if(!snap.exists())throw Error('추가할 품목이 없습니다: '+row.itemName);const data=snap.data();
   if(companyOf(data)!==request.companyId||isRawHolder({...data,id:row.itemId} as Item))throw Error('재고 추가 품목의 회사·분류가 다릅니다.');
   const beforeQty=Number(data.stock??0),targetQty=beforeQty+row.deltaQty;if(!Number.isFinite(beforeQty)||!Number.isFinite(targetQty)||targetQty<0)throw Error('추가할 현재 재고를 확인해 주세요.');
   const lots=data.lots??[],anchorId=`add-${operationDocId(request.operationId)}-${index}`;
   const anchored=anchorLotsByQty({lots,targetQty,unitKg:lots.find((lot:any)=>lot.unitKg)?.unitKg??row.unitKg,det:{id:anchorId,createdAt:request.capturedAt,receivedDate:request.date}});
   const afterQty=canStockAfter(anchored.lots);
   const candidate={stock:afterQty,lots:pruneDepletedLots(anchored.lots),stocktakeAnchors:[...(Array.isArray(data.stocktakeAnchors)?data.stocktakeAnchors:[]),{id:anchorId,date:request.date,createdAt:request.capturedAt,targetQty,beforeQty,deltaQty:row.deltaQty,note:row.note}].slice(-100)};
   assertItemInventoryWriteBudget([candidate]);const patch=clean(candidate);
   if(new TextEncoder().encode(JSON.stringify({...data,...patch})).byteLength>900_000)throw Error('재고 품목 문서 저장 한도를 초과했습니다.');
   return {patch,result:{itemId:row.itemId,beforeQty,afterQty,deltaQty:row.deltaQty,anchorId}};
  }));
  const saved={id:operationDocId(request.operationId),companyId:request.companyId,uid:request.uid,status:'complete',request,requestHash,completedAt:request.capturedAt,results:prepared.map(row=>row.result)};
  if(prepared.length+1>500||new TextEncoder().encode(JSON.stringify(saved)).byteLength>900_000)throw Error('재고 추가 저장 한도를 초과했습니다.');
  assertItemInventoryWriteBudget([...prepared.map((row,index)=>({...snaps[index].data(),...row.patch})),saved]);
  await check();prepared.forEach((row,index)=>tx.update(refs[index],row.patch));tx.set(receiptRef,saved);
  return {ok:true,status:'applied',message:`${prepared.length}개 품목 재고를 늘렸습니다.`,retainPending:false};
 }).catch(error=>{if(mode==='apply'&&error instanceof ItemInventoryRejected)return {ok:false,status:'rejected',message:error.message,retainPending:false};throw error;});
}
export async function durableItemStockAdd(request:ItemStockAddRequest):Promise<ItemInventoryOutcome>{
 const companyId=request.companyId,uid=request.uid;
 return runItemInventoryAttempt(request,async()=>{await productStocktakeActor(companyId,uid,true);},(mode,check,first)=>applyItemStockAddWithDb(db,first as ItemStockAddRequest,mode,check));
}
