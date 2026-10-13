import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'crypto';
import * as admin from 'firebase-admin';
import {retireOrderRequest,retirementIdentity,retirementText,retirementHash,retireOrderRequestCommand,claimRetiredOrderInventoryOperation,claimRetiredOrderInventoryOperationCommand} from './orderRequestRetirement';
import {applyRetirementAuthorizations} from '../../scripts/fix-order-request-retire-authorizations-20261013.mts';
import {TARGETS} from '../../scripts/fix-order-nested-array-locks-20261012.mts';
import {selectOrderRawBatchOrderEvidence} from './shared/orderRawBatchOrderEvidence';
const enabled=['127.0.0.1:8082','127.0.0.1:8182'].includes(process.env.FIRESTORE_EMULATOR_HOST??'');
const run='retire-'+randomUUID(),paths=new Set<string>();let app:admin.app.App,db:admin.firestore.Firestore;
const ref=(path:string)=>{paths.add(path);return db.doc(path);};
async function seed(suffix:string){const orderId=run+'-'+suffix,g={contractVersion:1,companyId:'taebaek',orderId,operationId:'old-'+orderId,startedAt:'2026-10-12T00:00:00Z',actorUid:'actor'},order={companyId:'taebaek',status:'PENDING',items:[{itemId:'product',quantity:2}],inventoryOperation:null};const orderRef=ref('orders/'+orderId);await orderRef.create(order);const snapshot=await orderRef.get(),id=retirementIdentity({companyId:g.companyId,orderId,operationId:g.operationId,startedAt:g.startedAt,actorUid:g.actorUid}),authorizationRef=ref('orderRequestRetirementAuthorizations/'+id),terminalRef=ref('orderRequestRetirements/'+id);const a={version:1,status:'authorized',reason:'manual-user-authorized',inventoryApplied:'unknown',companyId:g.companyId,orderId,operationId:g.operationId,startedAt:g.startedAt,actorUid:g.actorUid,backupHash:'a'.repeat(64),expectedOrderText:retirementText(order),expectedOrderHash:retirementHash(retirementText(order)),expectedOrderVersion:{seconds:snapshot.updateTime!.seconds,nanoseconds:snapshot.updateTime!.nanoseconds}};await authorizationRef.create(a);const requestText=retirementText({version:1,generation:g,recordedAt:g.startedAt,commands:[],plan:{},business:{orderText:'first'},legacyJobIds:[]}),input={requestText,requestHash:retirementHash(requestText),releaseId:run};return {g,a,id,input,orderRef,snapshot,authorizationRef,terminalRef};}
async function seedManifest(suffix:string){
 const f=await seed(suffix),itemId=f.g.orderId+'-item',rawId=f.g.orderId+'-raw',missingId=f.g.orderId+'-missing';
 const item=ref('items/'+itemId),rawItem=ref('items/'+rawId),raw=ref('rawInventories/taebaek__'+rawId),missing=ref('rawInventories/taebaek__'+missingId);
 await item.set({companyId:'taebaek',stock:12,lots:[{id:'lot',qtyRemaining:12}],inventoryReservations:{other:2}});
 await rawItem.set({companyId:'taebaek',stock:20,lots:[],inventoryWriterProtocolVersion:1,inventoryWriteRevision:4});
 await raw.set({companyId:'taebaek',rawItemId:rawId,stockKg:20,activeLots:[],inventoryWriterProtocolVersion:1,inventoryWriteRevision:7});
 ref('items/'+missingId);for(const id of [itemId,rawId,missingId])ref('inventoryWriterDeletions/taebaek__'+id);
 const request=JSON.parse(f.input.requestText);request.plan={productionDeltas:[{itemId,delta:2}],reservationDeltas:[{itemId,delta:-2}],finalLotItemIds:[itemId]};
 request.commands=[rawId,missingId].map(rawItemId=>({command:{companyId:'taebaek',rawItemId,kind:'consume',kg:1,source:{type:'production',id:f.g.orderId}}}));
 const requestText=retirementText(request);f.input={...f.input,requestText,requestHash:retirementHash(requestText)};
 return {...f,item,itemId,raw,rawId,rawItem,missing};
}
async function claimInput(f:Awaited<ReturnType<typeof seed>>,suffix='first'){
 const live=(await f.orderRef.get()).data()!,operation={id:f.g.orderId+'-'+suffix,startedAt:'2026-10-13T00:00:00Z',actor:'직원',actorUid:'actor',contractVersion:1,productionRecordContractVersion:1,kind:'status',targetStatus:'DISPATCHED',state:'processing'};
 const requestText=retirementText({version:1,retirementId:f.id,companyId:'taebaek',actorUid:'actor',orderId:f.g.orderId,expectedStatus:live.status,orderText:selectOrderRawBatchOrderEvidence({...live,id:f.g.orderId},retirementText),operation});
 return {requestText,requestHash:retirementHash(requestText),releaseId:run};
}
describe.skipIf(!enabled)('수동 unknown 최초 주문 요청 보관 실제 AdminSDK',{timeout:30000},()=>{
 beforeAll(async()=>{app=admin.initializeApp({projectId:'demo-'+run},run);db=app.firestore();await ref('appMeta/releaseCutover').set({status:'active',releaseId:run});});
 afterAll(async()=>{for(const path of paths){await db.doc(path).delete();expect((await db.doc(path).get()).exists).toBe(false);}await app.delete();});
 it('정확 승인 세대는 원문 archive terminal만 생성하고 주문·품목·원장 버전을 보존한다',async()=>{const f=await seed('first'),item=ref('items/'+f.g.orderId),ledger=ref('rawMaterialLedger/'+f.g.orderId);await item.create({companyId:'taebaek',stock:12,lots:[{id:'lot',qtyRemaining:12}]});await ledger.create({companyId:'taebaek',reportedDeltaKg:-2});const originals=await Promise.all([item.get(),ledger.get(),f.authorizationRef.get()]);expect(await retireOrderRequest(db,'taebaek','actor',f.input)).toMatchObject({status:'retired',inventoryApplied:'unknown',requestText:f.input.requestText});expect((await f.terminalRef.get()).get('requestText')).toBe(f.input.requestText);expect((await f.orderRef.get()).data()).toMatchObject({retirementId:f.id,retirementClaimPending:true,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});for(const [i,s]of (await Promise.all([item.get(),ledger.get(),f.authorizationRef.get()])).entries())expect(s.updateTime!.isEqual(originals[i].updateTime!)).toBe(true);});
 it('응답 유실은 exact duplicate이고 새 claim이 생긴 뒤에도 퇴역terminal은 다시 쓰지 않는다',async()=>{const f=await seed('duplicate');await retireOrderRequest(db,'taebaek','actor',f.input);const before=await f.terminalRef.get();await f.orderRef.update({inventoryOperation:{contractVersion:1,id:'new',startedAt:'2026-10-13T00:00:00Z',actorUid:'actor',state:'processing'}});expect(await retireOrderRequest(db,'taebaek','actor',f.input)).toMatchObject({status:'duplicate',inventoryApplied:'unknown'});expect((await f.terminalRef.get()).updateTime!.isEqual(before.updateTime!)).toBe(true);const r=JSON.parse(f.input.requestText);r.business.orderText='different';const text=retirementText(r);await expect(retireOrderRequest(db,'taebaek','actor',{...f.input,requestText:text,requestHash:retirementHash(text)})).rejects.toThrow('다른 퇴역');});
 it.each(['new-lock','changed-order','same-values-new-version','changed-actor','missing-authorization','none'])('%s는 terminal 생성0',async kind=>{const f=await seed(kind);if(kind==='new-lock')await f.orderRef.update({inventoryOperation:{id:'new'}});if(kind==='changed-order')await f.orderRef.update({status:'PROCESSING'});if(kind==='same-values-new-version'){await f.orderRef.update({status:'PROCESSING'});await f.orderRef.update({status:'PENDING'});}if(kind==='changed-actor')await f.authorizationRef.update({actorUid:'other'});if(kind==='missing-authorization')await f.authorizationRef.delete();if(kind==='none')await f.authorizationRef.update({inventoryApplied:'none'});await expect(retireOrderRequest(db,'taebaek','actor',f.input)).rejects.toThrow();expect((await f.terminalRef.get()).exists).toBe(false);});
 it('동시 같은 원문 요청은 terminal 한 개에 retired/duplicate로 수렴한다',async()=>{const f=await seed('race'),results=await Promise.all([retireOrderRequest(db,'taebaek','actor',f.input),retireOrderRequest(db,'taebaek','actor',f.input)]);expect(results.map(x=>x.status).sort()).toEqual(['duplicate','retired']);expect((await f.orderRef.get()).data()).toMatchObject({retirementId:f.id,retirementClaimPending:true,inventoryWriterProtocolVersion:1,inventoryWriteRevision:1});});
 it('실제 등록 callable는 미인증 및 직원claim없는 요청을 거절한다',async()=>{const call=(r:any)=>(retireOrderRequestCommand as any).run(r);await expect(call({data:{}})).rejects.toMatchObject({code:'unauthenticated'});await expect(call({auth:{uid:'actor',token:{companyId:'taebaek'}},data:{}})).rejects.toMatchObject({code:'permission-denied'});});
 it('exact3 승인 script 실제 SDK apply/duplicate/undo는 주문·재고를 쓰지 않는다',async()=>{
  const authorizations=[];
  for(const target of TARGETS){const orderRef=ref('orders/'+target.id),data={companyId:'taebaek',status:'PENDING',items:[],inventoryOperation:null};await orderRef.create(data);const s=await orderRef.get(),generation={companyId:'taebaek',orderId:target.id,operationId:target.op,startedAt:target.at,actorUid:'actor'},id=retirementIdentity(generation),expectedOrderText=retirementText(data),version={seconds:s.updateTime!.seconds,nanoseconds:s.updateTime!.nanoseconds};ref('orderRequestRetirementAuthorizations/'+id);ref('orderRequestRetirements/'+id);authorizations.push({path:'orderRequestRetirementAuthorizations/'+id,terminalPath:'orderRequestRetirements/'+id,orderPath:orderRef.path,order:{path:orderRef.path,data,version},data:{version:1,status:'authorized',reason:'manual-user-authorized',inventoryApplied:'unknown',...generation,backupHash:'a'.repeat(64),expectedOrderText,expectedOrderHash:retirementHash(expectedOrderText),expectedOrderVersion:version}});}
  const plan={version:1,reason:'manual-user-authorized',inventoryApplied:'unknown',sourceBackupHash:'a'.repeat(64),authorizations};
  expect(await applyRetirementAuthorizations(db,plan,'apply')).toMatchObject({status:'applied',stockWrites:0,orderWrites:0});expect(await applyRetirementAuthorizations(db,plan,'apply')).toMatchObject({status:'duplicate'});
  for(const row of authorizations){const s=await db.doc(row.orderPath).get();expect({seconds:s.updateTime!.seconds,nanoseconds:s.updateTime!.nanoseconds}).toEqual(row.order.version);expect((await db.doc(row.path).get()).data()).toEqual(row.data);}
  expect(await applyRetirementAuthorizations(db,plan,'undo')).toMatchObject({status:'undone'});for(const row of authorizations)expect((await db.doc(row.path).get()).exists).toBe(false);
 });
 it('최초 대상 marker만 한번 증가하고 숫자재고·로트·예약·없는 원료 상태는 그대로다',async()=>{
  const f=await seedManifest('markers'),before=await Promise.all([f.item.get(),f.rawItem.get(),f.raw.get()]);
  await retireOrderRequest(db,'taebaek','actor',f.input);
  const after=await Promise.all([f.item.get(),f.rawItem.get(),f.raw.get()]);
  for(const [index,row]of after.entries()){const expected={...before[index].data(),inventoryWriterProtocolVersion:1,inventoryWriteRevision:[1,5,8][index]};expect(row.data()).toEqual(expected);}
  expect((await f.missing.get()).exists).toBe(false);expect((await f.terminalRef.get()).get('requestText')).toBe(f.input.requestText);
  const snapshots=await Promise.all([f.item.get(),f.raw.get(),f.orderRef.get()]);await retireOrderRequest(db,'taebaek','actor',f.input);for(const row of snapshots)expect((await row.ref.get()).updateTime!.isEqual(row.updateTime!)).toBe(true);
 });
 it('퇴역 뒤 정상 입고 revision 증가는 허용하며 첫claim과 영수증은 한번만 저장한다',async()=>{
  const f=await seedManifest('arrival');await retireOrderRequest(db,'taebaek','actor',f.input);
  await f.item.update({stock:22,inventoryWriteRevision:2});await f.raw.update({stockKg:30,inventoryWriteRevision:9});await f.rawItem.update({stock:30,inventoryWriteRevision:6});
  const input=await claimInput(f),before=await Promise.all([f.item.get(),f.raw.get(),f.rawItem.get()]);
  const result=await claimRetiredOrderInventoryOperation(db,'taebaek','actor',input);expect(result.status).toBe('claimed');expect(result.order).toMatchObject({retirementClaimPending:false,inventoryOperation:{stage:'claim',id:JSON.parse(input.requestText).operation.id}});
  const terminal=await f.terminalRef.get(),order=await f.orderRef.get();expect(terminal.get('requestText')).toBe(f.input.requestText);expect(terminal.get('firstClaim.requestText')).toBe(input.requestText);
  expect(await retireOrderRequest(db,'taebaek','actor',f.input)).toMatchObject({status:'duplicate',action:'archived-only',allowNewClaim:false});
  expect((await claimRetiredOrderInventoryOperation(db,'taebaek','actor',input)).status).toBe('duplicate');for(const row of [...before,terminal,order])expect((await row.ref.get()).updateTime!.isEqual(row.updateTime!)).toBe(true);
 });
 it('같은 첫claim 동시는 한 개로 수렴하고 다른 최초 명세는 쓰지 않는다',async()=>{
  const f=await seed('claim-race');await retireOrderRequest(db,'taebaek','actor',f.input);const input=await claimInput(f);
  const results=await Promise.all([claimRetiredOrderInventoryOperation(db,'taebaek','actor',input),claimRetiredOrderInventoryOperation(db,'taebaek','actor',input)]);expect(results.map(row=>row.status).sort()).toEqual(['claimed','duplicate']);
  const terminal=await f.terminalRef.get(),order=await f.orderRef.get();expect(order.get('inventoryWriteRevision')).toBe(2);
  const other=await claimInput(f,'different');await expect(claimRetiredOrderInventoryOperation(db,'taebaek','actor',other)).rejects.toThrow('다른 최초 claim');for(const row of [terminal,order])expect((await row.ref.get()).updateTime!.isEqual(row.updateTime!)).toBe(true);
  const sameGeneration=JSON.parse(input.requestText);sameGeneration.operation.targetStatus='SHIPPED';const changedText=retirementText(sameGeneration);await expect(claimRetiredOrderInventoryOperation(db,'taebaek','actor',{...input,requestText:changedText,requestHash:retirementHash(changedText)})).rejects.toThrow('다른 최초 claim');
 });
 it.each(['actor','company','old-operation','order-business'])('첫claim %s가 다르면 order와 terminal 쓰기0',async kind=>{
  const f=await seed('claim-'+kind);await retireOrderRequest(db,'taebaek','actor',f.input);const input=await claimInput(f),request=JSON.parse(input.requestText);let actor='actor',company='taebaek';
  if(kind==='actor'){actor='other';request.actorUid='other';request.operation.actorUid='other';}if(kind==='company'){company='punghoe';request.companyId='punghoe';}if(kind==='old-operation')request.operation.id=f.g.operationId;if(kind==='order-business')await f.orderRef.update({items:[]});
  const before=await Promise.all([f.orderRef.get(),f.terminalRef.get()]),requestText=retirementText(request);await expect(claimRetiredOrderInventoryOperation(db,company,actor,{...input,requestText,requestHash:retirementHash(requestText)})).rejects.toThrow();for(const row of before)expect((await row.ref.get()).updateTime!.isEqual(row.updateTime!)).toBe(true);
 });
 it.each(['deleted-without-proof','recreated-below-floor','wrong-company','raw-regression','deleted-with-proof','recreated-after-floor'])('첫claim %s 삭제/재생성 계보를 검사한다',async kind=>{
  const f=await seedManifest('lineage-'+kind);await retireOrderRequest(db,'taebaek','actor',f.input);const input=await claimInput(f),tomb=ref('inventoryWriterDeletions/taebaek__'+f.itemId);
  if(kind==='raw-regression')await f.raw.update({inventoryWriteRevision:7});else{
   await f.item.delete();if(kind!=='deleted-without-proof')await tomb.set({companyId:kind==='wrong-company'?'punghoe':'taebaek',itemId:f.itemId,inventoryWriterProtocolVersion:1,beforeRevision:1,lastDeletedItemRevision:1,deletionRevision:1});
   if(kind.startsWith('recreated'))await f.item.set({companyId:'taebaek',stock:9,lots:[],inventoryWriterProtocolVersion:1,inventoryWriteRevision:kind==='recreated-below-floor'?1:2});
  }
  const before=await Promise.all([f.orderRef.get(),f.terminalRef.get(),f.item.get(),f.raw.get()]);
  if(['deleted-with-proof','recreated-after-floor'].includes(kind))expect((await claimRetiredOrderInventoryOperation(db,'taebaek','actor',input)).status).toBe('claimed');else{await expect(claimRetiredOrderInventoryOperation(db,'taebaek','actor',input)).rejects.toThrow();for(const row of before)if(row.exists)expect((await row.ref.get()).updateTime!.isEqual(row.updateTime!)).toBe(true);}
 });
 it('정확 첫claim 완료 ACK는 쓰지 않으며 후속 세대에 옛claim을 재설치하지 않는다',async()=>{
  const f=await seed('claim-complete');await retireOrderRequest(db,'taebaek','actor',f.input);const input=await claimInput(f),result=await claimRetiredOrderInventoryOperation(db,'taebaek','actor',input),g=result.generation;
  const requestText=retirementText({generation:g,deltas:[],lotItemIds:[],patch:{status:'DISPATCHED'}});await f.orderRef.update({status:'DISPATCHED',inventoryOperation:null,inventoryGenerationCompletion:{generation:g,completedAt:'2026-10-13T00:01:00Z',requestText,consumedLots:[],consumedLotsText:'[]'}});
  const completed=await f.orderRef.get();expect((await claimRetiredOrderInventoryOperation(db,'taebaek','actor',input)).status).toBe('duplicate');expect((await f.orderRef.get()).updateTime!.isEqual(completed.updateTime!)).toBe(true);
  await f.orderRef.update({inventoryOperation:{...JSON.parse(input.requestText).operation,id:'later',startedAt:'2026-10-14T00:00:00Z'}});const later=await f.orderRef.get();await expect(claimRetiredOrderInventoryOperation(db,'taebaek','actor',input)).rejects.toThrow('세대가 바뀌');expect((await f.orderRef.get()).updateTime!.isEqual(later.updateTime!)).toBe(true);
 });
 it('등록 firstclaim callable는 인증·직원 claim 없는 경우 DB 쓰기0이다',async()=>{await expect((claimRetiredOrderInventoryOperationCommand as any).run({data:{}})).rejects.toMatchObject({code:'unauthenticated'});await expect((claimRetiredOrderInventoryOperationCommand as any).run({auth:{uid:'actor',token:{companyId:'taebaek'}},data:{}})).rejects.toMatchObject({code:'permission-denied'});});
 it('같은 세대의 다른 첫claim 업무 원문은 duplicate ACK로 위장하지 않는다',async()=>{
  const f=await seed('same-generation-text');await retireOrderRequest(db,'taebaek','actor',f.input);const input=await claimInput(f);await claimRetiredOrderInventoryOperation(db,'taebaek','actor',input);
  const before=await Promise.all([f.orderRef.get(),f.terminalRef.get()]),request=JSON.parse(input.requestText);request.operation.targetStatus='SHIPPED';const requestText=retirementText(request);
  await expect(claimRetiredOrderInventoryOperation(db,'taebaek','actor',{...input,requestText,requestHash:retirementHash(requestText)})).rejects.toThrow('다른 최초 claim');for(const row of before)expect((await row.ref.get()).updateTime!.isEqual(row.updateTime!)).toBe(true);
 });
 it('archive-only는 현재 주문·효과·재고·marker를 전혀 쓰지 않고 첫 옛원문만 pin한다',async()=>{
  const f=await seed('archive-only'),item=ref('items/'+f.g.orderId),effect=ref('productionRecords/'+f.g.orderId);await item.set({companyId:'taebaek',stock:8,inventoryWriterProtocolVersion:1,inventoryWriteRevision:9});await effect.set({companyId:'taebaek',orderId:f.g.orderId,qty:2});
  const current=await f.orderRef.get();await f.authorizationRef.update({mode:'archive-only-current-evidence',revision:1,currentOrderText:retirementText(current.data()),currentOrderHash:retirementHash(retirementText(current.data())),currentOrderVersion:{seconds:current.updateTime!.seconds,nanoseconds:current.updateTime!.nanoseconds},currentEvidence:[],currentQueries:[]});
  await f.orderRef.update({status:'DISPATCHED',memo:'현재 메모',inventoryGenerationCompletion:{current:'현재 다른 세대'},inventoryOperation:null});await effect.update({qty:3});
  const originals=await Promise.all([f.orderRef.get(),item.get(),effect.get(),f.authorizationRef.get()]);expect(await retireOrderRequest(db,'taebaek','actor',f.input)).toMatchObject({status:'retired',action:'archived-only',allowNewClaim:false,inventoryApplied:'unknown'});
  for(const row of originals)expect((await row.ref.get()).updateTime!.isEqual(row.updateTime!)).toBe(true);
  const terminal=await f.terminalRef.get();await f.orderRef.update({memo:'후속 메모'});expect(await retireOrderRequest(db,'taebaek','actor',f.input)).toMatchObject({status:'duplicate',action:'archived-only'});expect((await f.terminalRef.get()).updateTime!.isEqual(terminal.updateTime!)).toBe(true);
  const request=JSON.parse(f.input.requestText);request.business={orderText:'다른 옛copy'};const requestText=retirementText(request);await expect(retireOrderRequest(db,'taebaek','actor',{...f.input,requestText,requestHash:retirementHash(requestText)})).rejects.toThrow('다른 퇴역');
  await f.orderRef.update({inventoryOperation:{contractVersion:1,id:f.g.operationId,startedAt:f.g.startedAt,actorUid:f.g.actorUid,state:'failed'}});await expect(retireOrderRequest(db,'taebaek','actor',f.input)).rejects.toThrow('다시 활성화');
 });
});

