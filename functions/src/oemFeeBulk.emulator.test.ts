import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import {appendFileSync,writeFileSync} from 'node:fs';
import * as admin from 'firebase-admin';
import { receiveOemFinishedGoods } from './oemReceiptCommand';
import { issueOemFeeVoucher } from './oemFeeVoucher';
import { buildOemFeePlan,buildOemFeePlanV2 } from './shared/oemFeePlan';
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
let db:admin.firestore.Firestore,rawDb:admin.firestore.Firestore;
const tokens=new Set<string>(),owned=new Set<string>(),intents=new Set<string>(),intentLog:string[]=[],pending=new Set<Promise<unknown>>();
const stem='work/oem-v2-bulk-'+projectId,sentinelPath='items/sentinel-'+projectId;let sentinel:admin.firestore.DocumentSnapshot|undefined;
const ownId=()=>{const id=randomUUID();tokens.add(id);return id;};
function allowed(path:string){
 const [collection,id,...rest]=path.split('/');if(rest.length||!id)throw Error('unexpected path '+path);
 if(collection==='appMeta'&&(id==='releaseCutover'||id==='voucherNo_taebaek_'+date+'_가공'))return;
 let decoded='';if(id.startsWith('op_')){try{decoded=Buffer.from(id.slice(3),'base64url').toString('utf8');}catch{}}
 if(!['appMeta','items','item_formula','item_bom','partners','accountCodes','purchaseOrders','rawInventories','rawMaterialLedger','rawInventoryJobs','rawInventoryReversalGuards','adjustmentRequests','oemReceiptOperations','issuedStatements','voucherMutationOperations'].includes(collection)||![...tokens].some(token=>id.includes(token)||decoded.includes(token)))throw Error('unowned path '+path);
}
function intent(path:string){allowed(path);intents.add(path);intentLog.push(path);appendFileSync(stem+'-paths.jsonl',JSON.stringify({intent:path})+'\n');}
function track(database:admin.firestore.Firestore):admin.firestore.Firestore{return new Proxy(database,{get(target,key){
 if(key==='runTransaction')return (fn:any,...options:any[])=>{let writes:string[]=[];const run=(target.runTransaction as any)(async(tx:any)=>{writes=[];const wrapped=new Proxy(tx,{get(inner,k){if(['set','create','update','delete'].includes(String(k)))return(ref:any,...args:any[])=>{intent(ref.path);writes.push(ref.path);inner[k](ref,...args);return wrapped;};const v=Reflect.get(inner,k,inner);return typeof v==='function'?v.bind(inner):v;}});return fn(wrapped);},...options).then((result:any)=>{for(const path of writes)owned.add(path);return result;});pending.add(run);void run.then(()=>pending.delete(run),()=>pending.delete(run));return run;};
 if(key==='doc')return (path:string)=>{const ref=target.doc(path);return new Proxy(ref,{get(inner,k){if(['set','create','update','delete'].includes(String(k)))return async(...args:any[])=>{intent(path);if(!owned.has(path)&&(await inner.get()).exists)throw Error('preexisting direct '+path);const result=await (inner as any)[k](...args);owned.add(path);return result;};const v=Reflect.get(inner,k,inner);return typeof v==='function'?v.bind(inner):v;}});};const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;
}});}
const clean=(value:any):any=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,clean(v)])):value;
const data=async(path:string)=>(await db.doc(path).get()).data()!;

async function setup(mixed=false,backdated=false){
 const id=ownId(),poId=`po-${id}`,rawId=`raw-${id}`,itemId=`product-${id}`,material=`벌크-${id}`,partnerId=`factory-${id}`;
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
 const command:RawInventoryCommand={kind:'consume',operationId:`합성사용-${ownId()}`,companyId:'taebaek',rawItemId:rawId,
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
  const statementId=`OEMFEE-${f.poId}`,statement=await data(`issuedStatements/${statementId}`),operationId=ownId();
  const paths=[`items/${f.rawId}`,`rawInventories/${inventoryDocId('taebaek',f.rawId)}`],before=await Promise.all(paths.map(data));
  const input={operationId,statementId,releaseId,expectedRevision:statement.mutationRevision??0};
  const patch={totalSupply:40000,totalTax:4000,totalAmount:44000,items:[{name:'가공비',qty:1,price:40000,supply:40000,tax:4000,total:44000}]};
  const apply=()=>mode==='edit'?editIssuedStatement(db,{auth:{uid:'actor',token:{isAdmin:true,employeeId:'employee',companyId:'taebaek'}},data:{...input,patch}})
   :deleteIssuedStatement(db,'taebaek','actor',{...input,expectedOriginalHash:statementOriginalHash(statement)});
  expect(await apply()).toMatchObject({status:'applied'});
  const after=await Promise.all(paths.map(data));expect(after.map(withoutCost)).toEqual(before.map(withoutCost));
  expect(after[0].lots[0].oemBatchCost).toBeUndefined();expect(after[1][depleted?'recentDepletedLots':'activeLots'][0].oemBatchCost).toBeUndefined();
  expect(after[0].lots.at(-1)).toEqual(unrelated);expect(after[1].recentDepletedLots.at(-1)).toEqual(unrelated);
  const snapshots=await Promise.all(paths.map(path=>db.doc(path).get()));expect(await apply()).toMatchObject({status:'duplicate'});
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
  await expect(editIssuedStatement(db,{auth:{uid:'actor',token:{isAdmin:true,employeeId:'employee',companyId:'taebaek'}},data:{statementId:`OEMFEE-${f.poId}`,releaseId,expectedRevision:0,operationId:ownId(),patch:{totalSupply:40000,totalTax:4000,totalAmount:44000,items:[{name:'가공비',qty:1,price:40000,supply:40000,tax:4000,total:44000}]}}})).rejects.toMatchObject({code:'failed-precondition'});
  expect((await itemRef.get()).updateTime!.isEqual(item.updateTime!)).toBe(true);expect((await poRef.get()).updateTime!.isEqual(po.updateTime!)).toBe(true);
 },30000);
 beforeAll(async()=>{if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8082'||!projectId.startsWith('demo-oem-fee-bulk-')||process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_CONFIG)throw Error('isolated demo emulator required');writeFileSync(stem+'-paths.jsonl','',{flag:'wx'});app=admin.initializeApp({projectId},projectId);rawDb=app.firestore();if((await rawDb.listCollections()).length)throw Error('demo namespace is not empty');const ref=rawDb.doc(sentinelPath);if((await ref.get()).exists)throw Error('sentinel exists');await ref.create({marker:projectId});sentinel=await ref.get();db=track(rawDb);},30000);
 afterAll(async()=>{if(!rawDb)return;let allAbsent=false,preserved=false;try{await Promise.allSettled([...pending]);for(const path of new Set([...owned,...intents])){allowed(path);const snap=await rawDb.doc(path).get();if(snap.exists){if(!owned.has(path))writeFileSync(stem+'-ambiguous-'+randomUUID()+'.json',JSON.stringify({path,data:snap.data()},null,2),{flag:'wx'});await snap.ref.delete();}expect((await rawDb.doc(path).get()).exists,path).toBe(false);}if(sentinel){const current=await sentinel.ref.get();expect(current.data()).toEqual(sentinel.data());expect(current.updateTime).toEqual(sentinel.updateTime);preserved=true;await sentinel.ref.delete();expect((await sentinel.ref.get()).exists).toBe(false);}allAbsent=true;}finally{writeFileSync(stem+'-cleanup.json',JSON.stringify({projectId,owned:[...owned],intents:[...intents],allAbsent,sentinelPreserved:preserved,globalClear:0},null,2),{flag:'wx'});await app?.delete();}},60000);

 it('품목별 가공·업체부자재 혼합과세를 원입고 snapshot대로 발행하고 창고수량은 보존한다',async()=>{
  const seed=await setup(),id=ownId(),poId='v2-'+id,a='v2-a-'+id,b='v2-b-'+id,packageItem='vendor-pack-'+id,material='가공원료-'+id,operationId='oem-receive:'+poId;
  const sent=[{rawItemId:seed.rawId,material,kg:600}],evidence={version:1,ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:seed.rawId,kg:600,supplyAmount:200000}],packaging:{confirmed:true,supplyAmount:100},capturedAt:date+'T00:00:00Z'},issue={companyId:'taebaek',partnerId:seed.receipt? (await data('purchaseOrders/'+seed.poId)).partnerId:'',sent,date,oemCostEvidence:evidence},partnerId=issue.partnerId;
  await db.doc('appMeta/'+('oemLotSequence_taebaek_'+date.replaceAll('-','')+'_'+encodeURIComponent(material))).create({companyId:'taebaek',date,material,lastSequence:0});
  for(const [itemId,unitKg] of [[a,10],[b,20]] as const){await db.doc('items/'+itemId).create({id:itemId,companyId:'taebaek',name:itemId,품목:itemId,type:'product',procureType:'임가공',unit:'박스',packageKg:unitKg,stock:0,lots:[]});await db.doc('item_formula/'+itemId).create({parent_key:itemId,child_name:material,ratio:1,yield_rate:1});}
  await db.doc('items/'+packageItem).create({id:packageItem,companyId:'taebaek',name:'업체부자재와 무관한 창고품목',type:'submaterial',unit:'개',stock:37,lots:[]});
  await db.doc('purchaseOrders/'+poId).create({id:poId,companyId:'taebaek',poType:'oem',status:'invoiced',partnerId,oemPartnerId:partnerId,partnerName:'합성 외주',oemSent:sent,oemIssueDate:date,oemCostEvidence:evidence,oemIssueFingerprint:JSON.stringify(issue)});
  const terms={version:2 as const,companyId:'taebaek',partnerId,nonDuplicatePackagingConfirmed:true,rows:[{itemId:a,processing:{unit:'kg' as const,grossUnitPrice:10,taxExempt:false},vendorPackaging:{unit:'box' as const,grossUnitPrice:100,taxExempt:true}},{itemId:b,processing:{unit:'kg' as const,grossUnitPrice:20,taxExempt:true},vendorPackaging:{unit:'box' as const,grossUnitPrice:50,taxExempt:false}}]};
  const receipt={poId,operationId,date,releaseId,returns:[{itemId:a,qty:10},{itemId:b,qty:20}],feeTermsV2:terms};
  const receiptCursor=intentLog.length;expect(await receiveOemFinishedGoods(db,'taebaek',receipt)).toMatchObject({status:'applied',receivedKg:500});expect(intentLog.slice(receiptCursor)).not.toContain('items/'+packageItem);const po=await data('purchaseOrders/'+poId),plan=buildOemFeePlanV2({...po.oemFeeSnapshotV2,accountCode:'540'});
  expect(plan.totalAmount).toBe(11000);expect(plan.lines.map(row=>row.isTaxExempt)).toEqual([false,true,true,false]);
  const statement={id:'OEMFEE-'+poId,orderId:poId,companyId:'taebaek',type:'매입',partnerId,partnerName:'합성 외주',tradeDate:date,issuedAt:date+'T00:00:00Z',docNo:'미확정',items:plan.lines,totalSupply:plan.totalSupply,totalTax:plan.totalTax,totalAmount:plan.totalAmount};
  const request={poId,releaseId,statement},beforePack=await db.doc('items/'+packageItem).get(),beforeA=await db.doc('items/'+a).get(),beforeB=await db.doc('items/'+b).get();
  await expect(issueOemFeeVoucher(db,'taebaek',{...request,perKg:500})).rejects.toThrow('단일 kg 단가');expect((await db.doc('issuedStatements/OEMFEE-'+poId).get()).exists).toBe(false);
  const feeRef=db.doc('adjustmentRequests/OEMFEE-'+poId),originalFee=await data(feeRef.path);
  await feeRef.update({oemFeeTermsV2:{...terms,rows:terms.rows.slice(1)}});const beforeCounter=await db.doc('appMeta/voucherNo_taebaek_'+date+'_가공').get();await expect(issueOemFeeVoucher(db,'taebaek',request)).rejects.toThrow();expect((await db.doc('issuedStatements/OEMFEE-'+poId).get()).exists).toBe(false);expect((await db.doc('appMeta/voucherNo_taebaek_'+date+'_가공').get()).updateTime).toEqual(beforeCounter.updateTime);await feeRef.set(originalFee);
  const poRef=db.doc('purchaseOrders/'+poId),originalPo=await data(poRef.path),forged={...terms,rows:terms.rows.map((row,i)=>i?row:{...row,processing:{...row.processing,grossUnitPrice:999}})};
  await poRef.update({oemFeeTermsV2:forged});await feeRef.update({oemFeeTermsV2:forged});await expect(issueOemFeeVoucher(db,'taebaek',request)).rejects.toThrow('원입고');expect((await db.doc('issuedStatements/OEMFEE-'+poId).get()).exists).toBe(false);await poRef.set(originalPo);await feeRef.set(originalFee);
  await poRef.update({oemFeeTermsV2:admin.firestore.FieldValue.delete(),oemFeeSnapshotV2:admin.firestore.FieldValue.delete()});await feeRef.update({oemFeeTermsV2:admin.firestore.FieldValue.delete(),oemFeeSnapshotV2:admin.firestore.FieldValue.delete()});
  await expect(issueOemFeeVoucher(db,'taebaek',request)).rejects.toThrow('원입고');expect((await db.doc('issuedStatements/OEMFEE-'+poId).get()).exists).toBe(false);expect((await db.doc('appMeta/voucherNo_taebaek_'+date+'_가공').get()).updateTime).toEqual(beforeCounter.updateTime);await poRef.set(originalPo);await feeRef.set(originalFee);
  const feeCursor=intentLog.length,lost=new Proxy(db,{get(target,key,receiver){if(key==='runTransaction')return async(fn:any)=>{await target.runTransaction(fn);throw Error('synthetic fee ACK loss');};return Reflect.get(target,key,receiver);}});await expect(issueOemFeeVoucher(lost,'taebaek',request)).rejects.toThrow('synthetic fee ACK loss');expect((await db.doc('issuedStatements/OEMFEE-'+poId).get()).exists).toBe(true);expect(await issueOemFeeVoucher(db,'taebaek',request)).toBe('OEMFEE-'+poId);expect(intentLog.slice(feeCursor)).not.toContain('items/'+packageItem);const afterPack=await db.doc('items/'+packageItem).get();expect(afterPack.data()).toEqual(beforePack.data());expect(afterPack.updateTime).toEqual(beforePack.updateTime);expect((await data('items/'+a)).stock).toBe(beforeA.get('stock'));expect((await data('items/'+b)).stock).toBe(beforeB.get('stock'));
  const finished=await data('purchaseOrders/'+poId);expect(finished.oemBatchCost).toMatchObject({status:'confirmed',rawSupplyAmount:200000,packagingSupplyAmount:100,feeSupplyAmount:plan.totalSupply,totalSupplyAmount:200100+plan.totalSupply});expect(finished.oemBatchCost.allocations.reduce((sum:number,row:any)=>sum+row.supplyAmount,0)).toBe(200100+plan.totalSupply);
  expect(await issueOemFeeVoucher(db,'taebaek',request)).toBe('OEMFEE-'+poId);expect(await receiveOemFinishedGoods(db,'taebaek',receipt)).toMatchObject({status:'duplicate'});
  await db.doc('purchaseOrders/'+poId).update({oemFeeTermsV2:{...terms,rows:terms.rows.slice(1)}});await expect(issueOemFeeVoucher(db,'taebaek',request)).rejects.toThrow();expect((await data('items/'+packageItem)).stock).toBe(37);
 },30000);

 it('V2 명시 무료 요율은 입고 원문에 남고 0원 전표를 임의 발행하지 않는다',async()=>{
  const f=await setup(),id=ownId(),poId='v2-free-'+id,partnerId=(await data('purchaseOrders/'+f.poId)).partnerId,sent=[{rawItemId:f.rawId,material:f.material,kg:100}];
  await db.doc('purchaseOrders/'+poId).create({id:poId,companyId:'taebaek',poType:'oem',status:'invoiced',partnerId,oemPartnerId:partnerId,partnerName:'합성 외주',oemSent:sent,oemIssueDate:date});
  const terms={version:2 as const,companyId:'taebaek',partnerId,rows:[{itemId:f.itemId,processing:{unit:'piece' as const,grossUnitPrice:0,taxExempt:true},vendorPackaging:{unit:'piece' as const,grossUnitPrice:0,taxExempt:true}}]},receipt={poId,operationId:'oem-receive:'+poId,date,releaseId,returns:[{itemId:f.itemId,qty:2}],feeTermsV2:terms};
  expect(await receiveOemFinishedGoods(db,'taebaek',receipt)).toMatchObject({status:'applied',receivedKg:2});const po=await data('purchaseOrders/'+poId),fee=await data('adjustmentRequests/OEMFEE-'+poId);expect(po.oemFeeTermsV2).toEqual(terms);expect(po.oemFeePerKg).toBeUndefined();expect(fee.oemTotal).toBe(0);expect(fee.oemFeePerKg).toBeUndefined();
  const request={poId,releaseId,statement:{id:'OEMFEE-'+poId,orderId:poId,companyId:'taebaek',type:'매입',partnerId,tradeDate:date,items:[],totalSupply:0,totalTax:0,totalAmount:0}};await expect(issueOemFeeVoucher(db,'taebaek',request)).rejects.toThrow();expect((await db.doc('issuedStatements/OEMFEE-'+poId).get()).exists).toBe(false);
 },30000);

 it('V2 완제품과 벌크 혼합은 별도 벌크 요율을 고정하고 두 원재고의 수량을 보존한다',async()=>{
  const f=await setup(),id=ownId(),poId='v2-bulk-'+id,partnerId=(await data('purchaseOrders/'+f.poId)).partnerId,sent=[{rawItemId:f.rawId,material:f.material,kg:100}],evidence={version:1,ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:f.rawId,kg:100,supplyAmount:200000}],packaging:{confirmed:true,supplyAmount:0},capturedAt:date+'T00:00:00Z'},issue={companyId:'taebaek',partnerId,sent,date,oemCostEvidence:evidence};
  await db.doc('purchaseOrders/'+poId).create({id:poId,companyId:'taebaek',poType:'oem',status:'invoiced',partnerId,oemPartnerId:partnerId,partnerName:'합성 외주',oemSent:sent,oemIssueDate:date,oemCostEvidence:evidence,oemIssueFingerprint:JSON.stringify(issue)});
  const terms={version:2 as const,companyId:'taebaek',partnerId,rows:[{itemId:f.itemId,processing:{unit:'kg' as const,grossUnitPrice:100,taxExempt:false},vendorPackaging:{unit:'piece' as const,grossUnitPrice:5,taxExempt:true}}],bulk:{grossUnitPrice:200,taxExempt:false}};
  const receipt={poId,operationId:'oem-receive:'+poId,date,releaseId,returns:[{itemId:f.itemId,qty:20}],bulk:[{rawItemId:f.rawId,material:f.material,kg:30}],feeTermsV2:terms};
  expect(await receiveOemFinishedGoods(db,'taebaek',receipt)).toMatchObject({status:'applied',receivedKg:50});const po=await data('purchaseOrders/'+poId);expect(po.oemFeeSnapshotV2.bulk).toMatchObject([{rawItemId:f.rawId,kg:30,grossUnitPrice:200}]);
  const plan=buildOemFeePlanV2({...po.oemFeeSnapshotV2,accountCode:'540'});expect(plan.totalAmount).toBe(8100);const statement={id:'OEMFEE-'+poId,orderId:poId,companyId:'taebaek',type:'매입',partnerId,partnerName:'합성 외주',tradeDate:date,issuedAt:date+'T00:00:00Z',docNo:'미확정',items:plan.lines,totalSupply:plan.totalSupply,totalTax:plan.totalTax,totalAmount:plan.totalAmount},request={poId,releaseId,statement};
  const paths=['items/'+f.rawId,'rawInventories/'+inventoryDocId('taebaek',f.rawId),'items/'+f.itemId],before=await Promise.all(paths.map(data));expect(await issueOemFeeVoucher(db,'taebaek',request)).toBe('OEMFEE-'+poId);const after=await Promise.all(paths.map(data));expect(after.map(withoutCost)).toEqual(before.map(withoutCost));expect((await data('purchaseOrders/'+poId)).oemBatchCost.totalSupplyAmount).toBe(200000+plan.totalSupply);expect(await receiveOemFinishedGoods(db,'taebaek',receipt)).toMatchObject({status:'duplicate'});
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
