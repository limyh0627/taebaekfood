import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import * as admin from 'firebase-admin';
import { receiveOemFinishedGoods } from './oemReceiptCommand';
import { issueOemFeeVoucher } from './oemFeeVoucher';
import { buildOemFeePlan } from './shared/oemFeePlan';
import { inventoryDocId, operationDocId, type RawInventoryCommand } from './shared/rawInventoryCore';
import { prepareRawCommand } from './shared/rawInventoryPrepare';
import { toLedgerDoc } from './shared/rawInventoryDocument';
import { editIssuedStatement } from './editIssuedStatementCommand';
import { deleteIssuedStatement, statementOriginalHash } from './deleteIssuedStatementCommand';

const available=process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8082';
const projectId=`demo-oem-fee-bulk-${randomUUID()}`;
const date='2026-10-13';
const releaseId=randomUUID();
let app:admin.app.App;
let db:admin.firestore.Firestore;
const clean=(value:any):any=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,clean(v)])):value;
const data=async(path:string)=>(await db.doc(path).get()).data()!;

async function setup(mixed=false,backdated=false){
 const id=randomUUID(),poId=`po-${id}`,rawId=`raw-${id}`,itemId=`product-${id}`,material=`벌크-${id}`,partnerId=`factory-${id}`;
 const operationId=`oem-receive:${poId}`,rawOperationId=`oem-receive-raw:${poId}:${rawId}`;
 const evidence={version:1,ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:rawId,kg:100,supplyAmount:200000}],
  packaging:{confirmed:true,supplyAmount:0},capturedAt:`${date}T00:00:00Z`};
 const sent=[{rawItemId:rawId,material,kg:100}];
 await Promise.all([
  db.doc('appMeta/releaseCutover').set({status:'active',releaseId,oemLotCutoverDate:date,voucherNotBefore:{taebaek:date}}),
  db.doc(`appMeta/voucherNo_taebaek_${date}_가공`).set({companyId:'taebaek',tradeDate:date,prefix:'가공',last:0}),
  db.doc(`appMeta/oemLotSequence_taebaek_${date.replaceAll('-','')}_${encodeURIComponent(material)}`).set({companyId:'taebaek',date,material,lastSequence:0}),
  db.doc(`partners/${partnerId}`).create({companyId:'taebaek',name:'합성 외주 공장'}),
  db.doc(`accountCodes/${id}`).create({companyId:'taebaek',code:'540',name:'외주가공비'}),
  db.doc(`items/${rawId}`).create({id:rawId,companyId:'taebaek',name:material,type:'raw',subtype:'벌크',unit:'kg',stock:0,cost:999999,lots:[]}),
  db.doc(`items/${itemId}`).create({id:itemId,companyId:'taebaek',name:'합성 완제품',품목:`완제품-${id}`,type:'product',procureType:'임가공',unit:'개',packageKg:1,stock:0,cost:123,lots:[]}),
  db.doc(`item_formula/${id}`).create({parent_key:`완제품-${id}`,child_name:material,ratio:1,yield_rate:1}),
  db.doc(`rawInventories/${inventoryDocId('taebaek',rawId)}`).create({id:inventoryDocId('taebaek',rawId),companyId:'taebaek',rawItemId:rawId,materialSnapshot:material,
   stockKg:0,activeLots:[],recentDepletedLots:[],revision:0,lastProcessedAt:'',...(backdated?{stocktakeAnchor:{operationId:'합성실사',effectiveAt:`${date}T13:00:00+09:00`,sequence:0}}:{})}),
  db.doc(`purchaseOrders/${poId}`).create({id:poId,companyId:'taebaek',poType:'oem',status:'invoiced',partnerId,oemPartnerId:partnerId,
   partnerName:'합성 외주 공장',oemSent:sent,oemIssueDate:date,oemCostEvidence:evidence,
   oemIssueFingerprint:JSON.stringify({companyId:'taebaek',partnerId,sent,date,oemCostEvidence:evidence})}),
 ]);
 const receipt={poId,operationId,date,releaseId,returns:mixed?[{itemId,qty:20}]:[],bulk:[{rawItemId:rawId,material,kg:70}],unitPricePerKg:500};
 expect((await receiveOemFinishedGoods(db,'taebaek',receipt)).status).toBe('applied');
 const plan=buildOemFeePlan({receivedKg:mixed?90:70,sentKg:100,perKg:500,exempt:false,accountCode:'540',
  products:mixed?[{name:'합성 완제품',spec:'개',qty:20,unitKg:1}]:[],bulk:[{material,kg:70}]});
 const request={poId,perKg:500,releaseId,statement:{id:`OEMFEE-${poId}`,orderId:poId,companyId:'taebaek',type:'매입',partnerId,partnerName:'합성 외주 공장',
  tradeDate:date,issuedAt:`${date}T00:00:00Z`,docNo:'미확정',items:plan.lines,totalSupply:plan.totalSupply,totalTax:plan.totalTax,totalAmount:plan.totalAmount}};
 return {poId,rawId,itemId,material,rawOperationId,request,receipt};
}

async function consume(fixture:Awaited<ReturnType<typeof setup>>,kg:number){
 const {rawId,material}=fixture;
 const command:RawInventoryCommand={kind:'consume',operationId:`합성사용-${randomUUID()}`,companyId:'taebaek',rawItemId:rawId,
  materialSnapshot:material,effectiveAt:`${date}T14:00:00+09:00`,source:{type:'production',id:'합성생산'},kg};
 await db.runTransaction(async tx=>{
  const stateRef=db.doc(`rawInventories/${inventoryDocId('taebaek',rawId)}`),itemRef=db.doc(`items/${rawId}`),movementRef=db.doc(`rawMaterialLedger/${operationDocId(command.operationId)}`);
  const [state,item,movement]=await Promise.all([tx.get(stateRef),tx.get(itemRef),tx.get(movementRef)]);
  const snap=(row:admin.firestore.DocumentSnapshot)=>({exists:()=>row.exists,data:()=>row.data()});
  const result=prepareRawCommand(command,{stateSnap:snap(state),itemSnap:snap(item),movementSnap:snap(movement)}, {now:`${date}T05:00:00Z`});
  if(result.status!=='applied')throw Error('합성 소비가 적용되지 않았습니다.');
  tx.set(stateRef,clean(result.state));
  tx.update(itemRef,{stock:result.state.stockKg,lots:clean([...result.state.activeLots,...result.state.recentDepletedLots])});
  tx.create(movementRef,clean(toLedgerDoc(result.movement)));
 });
}

const withoutCost=(row:any):any=>Array.isArray(row)?row.map(withoutCost):row&&typeof row==='object'
 ?Object.fromEntries(Object.entries(row).filter(([key])=>key!=='oemBatchCost').map(([key,value])=>[key,withoutCost(value)])):row;

describe.skipIf(!available)('벌크 OEM 가공비 실제 Firestore 거래',()=>{
 it.each([['edit',false],['delete',false],['edit',true],['delete',true]] as const)('벌크 가공비 %s 후 소진 여부 %s 양쪽 근거를 제거하고 다음 처리에서도 되살리지 않는다',async(mode,depleted)=>{
  const f=await setup();if(depleted)await consume(f,70);await issueOemFeeVoucher(db,'taebaek',f.request);
  const stateRef=db.doc(`rawInventories/${inventoryDocId('taebaek',f.rawId)}`),itemRef=db.doc(`items/${f.rawId}`);
  const state=await data(stateRef.path),item=await data(itemRef.path),unrelated={...item.lots[0],id:'연결되지않은로트',kgRemaining:0,status:'depleted'};
  await stateRef.update({recentDepletedLots:[...state.recentDepletedLots,unrelated]});await itemRef.update({lots:[...item.lots,unrelated]});
  const statementId=`OEMFEE-${f.poId}`,statement=await data(`issuedStatements/${statementId}`),operationId=randomUUID();
  const paths=[`items/${f.rawId}`,`rawInventories/${inventoryDocId('taebaek',f.rawId)}`],before=await Promise.all(paths.map(data));
  const input={operationId,statementId,releaseId,expectedRevision:statement.mutationRevision??0};
  const patch={totalSupply:40000,totalTax:4000,totalAmount:44000,items:[{name:'가공비',qty:1,price:40000,supply:40000,tax:4000,total:44000}]};
  const apply=()=>mode==='edit'?editIssuedStatement(db,{auth:{uid:'actor',token:{isAdmin:true,employeeId:'employee',companyId:'taebaek'}},data:{...input,patch}})
   :deleteIssuedStatement(db,'taebaek','actor',{...input,expectedOriginalHash:statementOriginalHash(statement)});
  expect((await apply()).status).toBe('applied');
  const after=await Promise.all(paths.map(data));expect(after.map(withoutCost)).toEqual(before.map(withoutCost));
  expect(after[0].lots[0].oemBatchCost).toBeUndefined();expect(after[1][depleted?'recentDepletedLots':'activeLots'][0].oemBatchCost).toBeUndefined();
  expect(after[0].lots.at(-1)).toEqual(unrelated);expect(after[1].recentDepletedLots.at(-1)).toEqual(unrelated);
  const snapshots=await Promise.all(paths.map(path=>db.doc(path).get()));expect((await apply()).status).toBe('duplicate');
  for(const snap of snapshots)expect((await snap.ref.get()).updateTime!.isEqual(snap.updateTime!)).toBe(true);
  if(!depleted)await consume(f,20);expect((await data(paths[0])).lots[0].oemBatchCost).toBeUndefined();expect((await data(paths[1]))[depleted?'recentDepletedLots':'activeLots'][0].oemBatchCost).toBeUndefined();
  expect((await receiveOemFinishedGoods(db,'taebaek',f.receipt)).status).toBe('duplicate');
  expect((await data(paths[0])).lots[0].oemBatchCost).toBeUndefined();
 },30000);
 it.each(['missing','company','raw-id','lot-id','lot-original'])('원료 상태의 %s 불일치는 무효화 거래 전체를 거절한다',async mode=>{
  const f=await setup();await issueOemFeeVoucher(db,'taebaek',f.request);
  const stateRef=db.doc(`rawInventories/${inventoryDocId('taebaek',f.rawId)}`),state=await data(stateRef.path);
  if(mode==='missing')await stateRef.delete();else {
   if(mode==='company')state.companyId='punghoe';
   if(mode==='raw-id')state.rawItemId='다른원료';
   if(mode==='lot-id')state.activeLots[0].id='다른로트';
   if(mode==='lot-original')state.activeLots[0].kgRemaining-=1;
   await stateRef.set(state);
  }
  const itemRef=db.doc(`items/${f.rawId}`),poRef=db.doc(`purchaseOrders/${f.poId}`),item=await itemRef.get(),po=await poRef.get();
  await expect(editIssuedStatement(db,{auth:{uid:'actor',token:{isAdmin:true,employeeId:'employee',companyId:'taebaek'}},data:{statementId:`OEMFEE-${f.poId}`,releaseId,expectedRevision:0,operationId:randomUUID(),patch:{totalSupply:40000,totalTax:4000,totalAmount:44000,items:[{name:'가공비',qty:1,price:40000,supply:40000,tax:4000,total:44000}]}}})).rejects.toMatchObject({code:'failed-precondition'});
  expect((await itemRef.get()).updateTime!.isEqual(item.updateTime!)).toBe(true);expect((await poRef.get()).updateTime!.isEqual(po.updateTime!)).toBe(true);
 },30000);
 beforeAll(()=>{app=admin.initializeApp({projectId},projectId);db=app.firestore();});
 afterAll(async()=>{
  if(db)for(const collection of await db.listCollections()){
   for(const doc of (await collection.get()).docs)await doc.ref.delete();
   expect((await collection.get()).empty).toBe(true);
  }
  await app?.delete();
 },30000);

 it.each([false,true])('벌크 단독·혼합을 실제 입고한 뒤 공급가만 확정하고 원장과 수량을 보존한다(%s)',async mixed=>{
  const f=await setup(mixed);
  const paths=[`items/${f.rawId}`,`rawInventories/${inventoryDocId('taebaek',f.rawId)}`,`items/${f.itemId}`];
  const before=await Promise.all(paths.map(data));
  const ledgerPath=`rawMaterialLedger/${operationDocId(f.rawOperationId)}`,ledger=await data(ledgerPath);
  const receipt=await data(`oemReceiptOperations/oem-receive:${f.poId}`);
  await issueOemFeeVoucher(db,'taebaek',f.request);
  const after=await Promise.all(paths.map(data));
  expect(after.map(withoutCost)).toEqual(before.map(withoutCost));
  expect(after[0].lots[0].oemBatchCost).toMatchObject({poId:f.poId,receivedKg:70,feeStatementId:`OEMFEE-${f.poId}`});
  expect(after[1].activeLots[0].oemBatchCost).toEqual(after[0].lots[0].oemBatchCost);
  const cost=(await data(`purchaseOrders/${f.poId}`)).oemBatchCost;
  expect(cost).toMatchObject({status:'confirmed',packagingSupplyAmount:0,totalSupplyAmount:200000+f.request.statement.totalSupply});
  expect(cost.allocations.reduce((sum:number,row:any)=>sum+row.supplyAmount,0)).toBe(cost.totalSupplyAmount);
  expect(await data(ledgerPath)).toEqual(ledger);expect(await data(`oemReceiptOperations/oem-receive:${f.poId}`)).toEqual(receipt);
  expect(await issueOemFeeVoucher(db,'taebaek',f.request)).toBe(`OEMFEE-${f.poId}`);
  expect((await data(`appMeta/voucherNo_taebaek_${date}_가공`)).last).toBe(1);
  expect((await receiveOemFinishedGoods(db,'taebaek',f.receipt)).status).toBe('duplicate');
 },30000);

 it.each([20,70])('실제 원료 소비 %s kg 이후 가공비가 잔량과 소진 상태를 되돌리지 않는다',async kg=>{
  const f=await setup();await consume(f,kg);
  const paths=[`items/${f.rawId}`,`rawInventories/${inventoryDocId('taebaek',f.rawId)}`];
  const before=await Promise.all(paths.map(data));
  await issueOemFeeVoucher(db,'taebaek',f.request);
  const after=await Promise.all(paths.map(data));
  expect(after.map(withoutCost)).toEqual(before.map(withoutCost));
  expect(after[0].stock).toBe(70-kg);expect(after[1].stockKg).toBe(70-kg);
  expect(after[1][kg===70?'recentDepletedLots':'activeLots'][0].oemBatchCost).toEqual(after[0].lots[0].oemBatchCost);
 },30000);

 it('가공비 후확정과 실제 소비가 경합해도 최신 잔량과 원가를 함께 보존한다',async()=>{
  const f=await setup();
  const ledgerPath=`rawMaterialLedger/${operationDocId(f.rawOperationId)}`,original=await data(ledgerPath);
  await Promise.all([consume(f,20),issueOemFeeVoucher(db,'taebaek',f.request)]);
  const item=await data(`items/${f.rawId}`),state=await data(`rawInventories/${inventoryDocId('taebaek',f.rawId)}`);
  expect(item.stock).toBe(50);expect(state.stockKg).toBe(50);expect(state.revision).toBe(2);
  expect(item.lots[0].kgRemaining).toBe(50);expect(item.lots).toEqual([...state.activeLots,...state.recentDepletedLots]);
  expect(item.lots[0].oemBatchCost.feeStatementId).toBe(`OEMFEE-${f.poId}`);
  expect(await data(ledgerPath)).toEqual(original);
 },30000);

 it('실사 이전의 applied 0 벌크 입고는 비용만 확정하고 현재 로트를 만들지 않는다',async()=>{
  const f=await setup(false,true);
  const statePath=`rawInventories/${inventoryDocId('taebaek',f.rawId)}`,before=await data(statePath);
  expect((await data(`purchaseOrders/${f.poId}`)).oemReceivedBulk[0]).toMatchObject({appliedDeltaKg:0,status:'skipped-backdated'});
  await issueOemFeeVoucher(db,'taebaek',f.request);
  expect(await data(statePath)).toEqual(before);expect((await data(`items/${f.rawId}`)).lots).toEqual([]);
  expect((await data(`purchaseOrders/${f.poId}`)).oemBatchCost.status).toBe('confirmed');
 },30000);

 it.each(['command','movement','manifest','material','mirror'])('벌크 %s 근거 변조는 발행·원가·번호를 쓰기 전에 거절한다',async mode=>{
  const f=await setup();
  if(mode==='command'){
   const path=`oemReceiptOperations/oem-receive:${f.poId}`,saved=await data(path);saved.bulkReceipts[0].command.kg=69;await db.doc(path).set(saved);
  }
  if(mode==='movement')await db.doc(`rawMaterialLedger/${operationDocId(f.rawOperationId)}`).update({reportedDeltaKg:69});
  if(mode==='manifest'){
   const path=`purchaseOrders/${f.poId}`,po=await data(path);po.oemReceivedBulk[0].lotId='다른로트';await db.doc(path).set(po);
  }
  if(mode==='material'){
   const path=`purchaseOrders/${f.poId}`,po=await data(path);po.oemReceivedBulk[0].material='변경된 원료';await db.doc(path).set(po);
   f.request.statement.items[0].name='변경된 원료 벌크 가공비';
  }
  if(mode==='mirror'){
   const path=`items/${f.rawId}`,item=await data(path);item.lots[0].kgRemaining=69;await db.doc(path).set(item);
  }
  const before=await data(`rawInventories/${inventoryDocId('taebaek',f.rawId)}`);
  await expect(issueOemFeeVoucher(db,'taebaek',f.request)).rejects.toThrow('벌크');
  expect(await data(`rawInventories/${inventoryDocId('taebaek',f.rawId)}`)).toEqual(before);
  expect((await db.doc(`issuedStatements/OEMFEE-${f.poId}`).get()).exists).toBe(false);
  expect((await data(`appMeta/voucherNo_taebaek_${date}_가공`)).last).toBe(0);
 },30000);
});
