import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import * as admin from 'firebase-admin';
import {editIssuedStatement} from './editIssuedStatementCommand';
import {deleteIssuedStatement,statementOriginalHash} from './deleteIssuedStatementCommand';
const available=['127.0.0.1:8082','127.0.0.1:8182'].includes(process.env.FIRESTORE_EMULATOR_HOST??'');
const run='oem-cost-lifecycle-'+randomUUID();
let app:admin.app.App,db:admin.firestore.Firestore;
const tracked:admin.firestore.DocumentReference[]=[];
const ref=(group:string,id:string)=>{const result=db.collection(group).doc(id);tracked.push(result);return result;};
async function seed(suffix:string){
 const id='OEMFEE-'+run+'-'+suffix,poId=run+'-'+suffix,itemId=poId+'-item';
 const lot={id:'lot-oem-'+poId+'-'+itemId,poId,qtyIn:8,qtyRemaining:3,kgIn:8,kgRemaining:3,unitKg:1,receivedDate:'2026-10-08',status:'active',supplierName:'외주',createdAt:'2026-10-08T00:00:00Z',oemBatchCost:{poId,feeStatementId:id,receivedKg:8,totalSupplyAmount:1100,allocatedSupplyAmount:1100,costPerKg:137.5}};
 const cost={version:1,status:'confirmed',feeStatementId:id,feeSupplyAmount:100,totalSupplyAmount:1100,costPerKg:137.5,ownerCompanyId:'taebaek',sentKg:10,receivedKg:8,lossKg:2,rawSupplyAmount:1000,packagingSupplyAmount:0,rows:[{itemId,kg:8}],allocations:[{itemId,kg:8,supplyAmount:1100,costPerKg:137.5}],evidenceSnapshot:{version:1,ownerCompanyId:'taebaek',rawMaterials:[{rawItemId:'raw',kg:10,supplyAmount:1000}],packaging:{confirmed:true,supplyAmount:0},capturedAt:'2026-10-08T00:00:00Z'}};
 const statement={companyId:'taebaek',type:'매입',tradeDate:'2026-10-08',totalSupply:100,totalTax:10,totalAmount:110,items:[{name:'가공비',qty:1,price:100,supply:100,tax:10,total:110}],mutationRevision:0};
 await Promise.all([ref('appMeta','releaseCutover').set({status:'active',releaseId:run}),ref('issuedStatements',id).set(statement),ref('purchaseOrders',poId).set({companyId:'taebaek',poType:'oem',status:'received',linkedStatementId:id,oemBatchCost:cost}),ref('items',itemId).set({companyId:'taebaek',stock:3,cost:777,inventoryWriterProtocolVersion:1,inventoryWriteRevision:7,lots:[lot,{...lot,id:'unrelated',oemBatchCost:{...lot.oemBatchCost,poId:'other'}}]})]);
 return {id,poId,itemId,statement,cost};
}
const edit=(id:string,operationId:string,patch:Record<string,unknown>)=>editIssuedStatement(db,{auth:{uid:'actor',token:{isAdmin:true,employeeId:'employee',companyId:'taebaek'}},data:{statementId:id,releaseId:run,expectedRevision:0,operationId,patch}});
describe.skipIf(!available)('OEM 가공비 원가근거의 원자 무효화',{timeout:30000},()=>{
 beforeAll(()=>{app=admin.initializeApp({projectId:'demo-oem-cost-lifecycle'},run);db=admin.firestore(app);});
 afterAll(async()=>{for(const item of tracked)await item.delete();await app?.delete();});
 it('가공비 공급액 변경은 재고·잔여수량·품목원가를 유지하고 해당 로트 근거만 무효화한다',async()=>{
  const f=await seed('edit'),op=run+'-edit';ref('voucherMutationOperations',op);
  const patch={totalSupply:200,totalTax:20,totalAmount:220,items:[{name:'가공비',qty:1,price:200,supply:200,tax:20,total:220}]};
  expect((await edit(f.id,op,patch)).status).toBe('applied');
  expect((await ref('purchaseOrders',f.poId).get()).data()).toMatchObject({status:'received',linkedStatementId:f.id,oemBatchCost:{status:'blocked',reason:'fee-changed',previousConfirmed:f.cost}});
  const item=await ref('items',f.itemId).get();expect(item.get('stock')).toBe(3);expect(item.get('cost')).toBe(777);expect(item.data()).toMatchObject({inventoryWriterProtocolVersion:1,inventoryWriteRevision:7});expect(item.get('lots')[0]).toMatchObject({qtyRemaining:3,kgRemaining:3});expect(item.get('lots')[0].oemBatchCost).toBeUndefined();expect(item.get('lots')[1].oemBatchCost.poId).toBe('other');
  expect((await edit(f.id,op,patch)).status).toBe('duplicate');expect((await item.ref.get()).updateTime!.isEqual(item.updateTime!)).toBe(true);
 });
 it.each(['edit','delete'])('전표 연결이 풀린 배치도 %s 시 확정근거를 무효화한다',async(mode)=>{
  const f=await seed('unlinked-'+mode),op=run+'-unlinked-'+mode;ref('voucherMutationOperations',op);
  await db.collection('purchaseOrders').doc(f.poId).update({linkedStatementId:admin.firestore.FieldValue.delete()});
  if(mode==='edit'){
   expect((await edit(f.id,op,{totalSupply:200,totalTax:20,totalAmount:220,items:[{name:'가공비',qty:1,price:200,supply:200,tax:20,total:220}]})).status).toBe('applied');
  }else{
   expect((await deleteIssuedStatement(db,'taebaek','actor',{operationId:op,statementId:f.id,releaseId:run,expectedRevision:0,expectedOriginalHash:statementOriginalHash(f.statement)})).status).toBe('applied');
  }
  const po=await db.collection('purchaseOrders').doc(f.poId).get();
  expect(po.get('linkedStatementId')).toBeUndefined();expect(po.get('oemBatchCost')).toMatchObject({status:'blocked',reason:mode==='edit'?'fee-changed':'fee-deleted',previousConfirmed:f.cost});
  const item=await db.collection('items').doc(f.itemId).get();expect(item.get('stock')).toBe(3);expect(item.get('cost')).toBe(777);expect(item.data()).toMatchObject({inventoryWriterProtocolVersion:1,inventoryWriteRevision:7});expect(item.get('lots')[0]).toMatchObject({qtyRemaining:3,kgRemaining:3});expect(item.get('lots')[0].oemBatchCost).toBeUndefined();expect(item.get('lots')[1].oemBatchCost.poId).toBe('other');
 }); it('메모만 바꾸면 확정원가와 로트를 다시 쓰지 않는다',async()=>{
  const f=await seed('memo'),op=run+'-memo';ref('voucherMutationOperations',op);const po=await ref('purchaseOrders',f.poId).get(),item=await ref('items',f.itemId).get();
  expect((await edit(f.id,op,{memo:'메모'})).status).toBe('applied');expect((await po.ref.get()).updateTime!.isEqual(po.updateTime!)).toBe(true);expect((await item.ref.get()).updateTime!.isEqual(item.updateTime!)).toBe(true);
 });
 it('가공비 삭제는 연결을 풀고 원가를 미확인으로 남기며 수량과 중복재시도를 보존한다',async()=>{
  const f=await seed('delete'),op=run+'-delete';ref('voucherMutationOperations',op);const input={operationId:op,statementId:f.id,releaseId:run,expectedRevision:0,expectedOriginalHash:statementOriginalHash(f.statement)};
  expect((await deleteIssuedStatement(db,'taebaek','actor',input)).status).toBe('applied');const po=await ref('purchaseOrders',f.poId).get();expect(po.get('linkedStatementId')).toBeUndefined();expect(po.get('oemBatchCost')).toMatchObject({status:'blocked',reason:'fee-deleted',previousConfirmed:f.cost});
  const item=await ref('items',f.itemId).get();expect(item.get('stock')).toBe(3);expect(item.get('cost')).toBe(777);expect(item.data()).toMatchObject({inventoryWriterProtocolVersion:1,inventoryWriteRevision:7});expect(item.get('lots')[0].kgRemaining).toBe(3);expect(item.get('lots')[0].oemBatchCost).toBeUndefined();
  expect((await deleteIssuedStatement(db,'taebaek','actor',input)).status).toBe('duplicate');expect((await po.ref.get()).updateTime!.isEqual(po.updateTime!)).toBe(true);expect((await item.ref.get()).updateTime!.isEqual(item.updateTime!)).toBe(true);
 });
});
