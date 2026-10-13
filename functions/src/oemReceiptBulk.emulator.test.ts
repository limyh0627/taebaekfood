import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'crypto';
import * as admin from 'firebase-admin';
import {receiveOemFinishedGoods} from './oemReceiptCommand';
import {inventoryDocId,operationDocId,applyRawCommand} from './shared/rawInventoryCore';
const prefix=`oem-bulk-${randomUUID()}`,date='2026-10-13',projectId=`demo-oem-bulk-${randomUUID().slice(0,8)}`;
let app:admin.app.App,db:admin.firestore.Firestore;
const paths=new Set<string>();
async function seed(path:string,data:any){paths.add(path);await db.doc(path).set(data);}
async function fixture(tag:string,packed=false){
 const po=`${prefix}-${tag}-po`,raw=`${prefix}-${tag}-raw`,partner=`${prefix}-partner`,name=`${prefix}-${tag}`,product=`${prefix}-${tag}-product`;
 await seed(`partners/${partner}`,{companyId:'taebaek',name:'외주 시험'});
 await seed(`items/${raw}`,{companyId:'taebaek',name,subtype:'벌크',stock:0,lots:[]});
 await seed(`purchaseOrders/${po}`,{companyId:'taebaek',poType:'oem',status:'invoiced',oemPartnerId:partner,oemSent:[{material:name,rawItemId:raw,kg:20}]});
 if(packed){await seed(`items/${product}`,{companyId:'taebaek',name:product,procureType:'임가공',unit:'개',packageKg:1,stock:0,lots:[]});await seed(`item_formula/${product}`,{parent_key:product,child_name:name,ratio:1,yield_rate:1});await seed(`appMeta/oemLotSequence_taebaek_20261013_${encodeURIComponent(name)}`,{companyId:'taebaek',material:name,date,lastSequence:0});}
 const operationId=`oem-receive:${po}`,rawOp=`oem-receive-raw:${po}:${raw}`;
 for(const path of [`oemReceiptOperations/${operationId}`,`adjustmentRequests/OEMFEE-${po}`,`rawInventories/${inventoryDocId('taebaek',raw)}`,`rawMaterialLedger/${operationDocId(rawOp)}`])paths.add(path);
 return {po,raw,name,product,operationId,rawOp,input:{poId:po,operationId,date,releaseId:prefix,returns:packed?[{itemId:product,qty:2}]:[],bulk:[{material:name,kg:10,rawItemId:raw}]}};
}
describe('OEM 벌크의 실제 서버 원자 거래',()=>{
 beforeAll(async()=>{process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8082';process.env.GCLOUD_PROJECT=projectId;app=admin.initializeApp({projectId},prefix);db=app.firestore();await seed('appMeta/releaseCutover',{status:'active',releaseId:prefix,oemLotCutoverDate:date});},30000);
 afterAll(async()=>{if(db){for(const path of paths)await db.doc(path).delete();for(const path of paths)expect((await db.doc(path).get()).exists).toBe(false);}if(app)await app.delete();},30000);
 it('벌크만 입고하고 원문 재전송은 쓰기 없이 완료한다',async()=>{const f=await fixture('only');expect((await receiveOemFinishedGoods(db,'taebaek',f.input)).receivedKg).toBe(10);const item=(await db.doc(`items/${f.raw}`).get()).data()!;expect(item.stock).toBe(10);expect(item.lots[0]).toMatchObject({id:`lot-oem-${f.po}-${f.raw}`,poId:f.po,kgIn:10,kgRemaining:10});expect(item.lots[0].lotNo).toBeTruthy();const before=(await db.doc(`items/${f.raw}`).get()).updateTime;expect((await receiveOemFinishedGoods(db,'taebaek',f.input)).status).toBe('duplicate');expect((await db.doc(`items/${f.raw}`).get()).updateTime?.isEqual(before!)).toBe(true);const state=(await db.doc(`rawInventories/${inventoryDocId('taebaek',f.raw)}`).get()).data()!;const consume=applyRawCommand({state:state as any,command:{kind:'consume',operationId:`consume:${prefix}`,companyId:'taebaek',rawItemId:f.raw,materialSnapshot:f.name,effectiveAt:`${date}T13:00:00+09:00`,source:{type:'production',id:prefix},kg:3},det:{now:date,newLotId:'unused',carryOverLotId:'unused'}});expect(consume.status).toBe('applied');if(consume.status==='applied')expect(consume.state.stockKg).toBe(7);});
 it('완제품과 벌크를 같은 입고 kg로 합산한다',async()=>{const f=await fixture('mixed',true);expect((await receiveOemFinishedGoods(db,'taebaek',f.input)).receivedKg).toBe(12);expect((await db.doc(`items/${f.product}`).get()).data()?.stock).toBe(2);expect((await db.doc(`items/${f.raw}`).get()).data()?.stock).toBe(10);expect((await receiveOemFinishedGoods(db,'taebaek',f.input)).status).toBe('duplicate');});
 it('같은 벌크 홀더를 제품 행에도 넣어 재고를 덮어쓸 수 없다',async()=>{const f=await fixture('same-holder');await db.doc(`items/${f.raw}`).update({procureType:'임가공',packageKg:1});await seed(`item_formula/${f.raw}`,{parent_key:f.name,child_name:f.name,ratio:1,yield_rate:1});await seed(`appMeta/oemLotSequence_taebaek_20261013_${encodeURIComponent(f.name)}`,{companyId:'taebaek',material:f.name,date,lastSequence:0});await expect(receiveOemFinishedGoods(db,'taebaek',{...f.input,returns:[{itemId:f.raw,qty:2}]})).rejects.toThrow('완제품');expect((await db.doc(`items/${f.raw}`).get()).data()?.stock).toBe(0);expect((await db.doc(`oemReceiptOperations/${f.operationId}`).get()).exists).toBe(false);});
 it('두번째 홀더가 불량이면 완제품과 첫 원료도 아무것도 쓰지 않는다',async()=>{const f=await fixture('atomic',true),bad=`${prefix}-bad`;await seed(`items/${bad}`,{companyId:'taebaek',name:'불량',subtype:'벌크',stock:5,lots:[]});await expect(receiveOemFinishedGoods(db,'taebaek',{...f.input,bulk:[...f.input.bulk,{material:'불량',rawItemId:bad,kg:1}]})).rejects.toThrow('어긋나');expect((await db.doc(`items/${f.raw}`).get()).data()?.stock).toBe(0);expect((await db.doc(`items/${f.product}`).get()).data()?.stock).toBe(0);expect((await db.doc(`oemReceiptOperations/${f.operationId}`).get()).exists).toBe(false);});
 it('외국회사·팬텀·삭제 품목과 명시 없는 중복 홀더는 거절한다',async()=>{for(const flags of [{companyId:'punghoe'},{phantom:true},{archived:true}]){const f=await fixture(randomUUID().slice(0,8));await db.doc(`items/${f.raw}`).update(flags);await expect(receiveOemFinishedGoods(db,'taebaek',f.input)).rejects.toThrow('벌크');expect((await db.doc(`oemReceiptOperations/${f.operationId}`).get()).exists).toBe(false);}const f=await fixture('ambiguous');await seed(`items/${f.raw}-other`,{companyId:'taebaek',name:f.name,subtype:'벌크',stock:0,lots:[]});await expect(receiveOemFinishedGoods(db,'taebaek',{...f.input,bulk:[{material:f.name,kg:10}]})).rejects.toThrow('유일');});
 it('기존 pending의 유일한 이름 홀더는 해석하며 변경된 원문은 거절한다',async()=>{const f=await fixture('legacy'),input={...f.input,bulk:[{material:f.name,kg:10}]};await receiveOemFinishedGoods(db,'taebaek',input);await expect(receiveOemFinishedGoods(db,'taebaek',{...input,bulk:[{material:f.name,kg:11}]})).rejects.toThrow();expect((await db.doc(`items/${f.raw}`).get()).data()?.stock).toBe(10);});
 it('입고 증거 변조를 재전송에서 검출한다',async()=>{const f=await fixture('tamper');await receiveOemFinishedGoods(db,'taebaek',f.input);await db.doc(`purchaseOrders/${f.po}`).update({oemReceivedBulk:[]});await expect(receiveOemFinishedGoods(db,'taebaek',f.input)).rejects.toThrow('근거');});
 it('없는 홀더와 취소된 발주는 재고를 쓰지 않는다',async()=>{const missing=await fixture('missing');await db.doc(`items/${missing.raw}`).delete();await expect(receiveOemFinishedGoods(db,'taebaek',missing.input)).rejects.toThrow('벌크');const canceled=await fixture('cancel');await db.doc(`purchaseOrders/${canceled.po}`).update({oemCancelledAt:date});await expect(receiveOemFinishedGoods(db,'taebaek',canceled.input)).rejects.toThrow('취소');expect((await db.doc(`items/${canceled.raw}`).get()).data()?.stock).toBe(0);expect((await db.doc(`oemReceiptOperations/${canceled.operationId}`).get()).exists).toBe(false);});
 it('실제 503쓰기 규모는 계산 뒤 모든 품목 저장 전에 차단한다',async()=>{
   const f=await fixture('write-limit'),returns:{itemId:string;qty:number}[]=[],bulk:{material:string;rawItemId:string;kg:number}[]=[];
   const batch=db.batch();
   const add=(path:string,data:any)=>{paths.add(path);batch.create(db.doc(path),data);};
   for(let i=0;i<100;i++){
     const raw=`${prefix}-limit-raw-${i}`,product=`${prefix}-limit-product-${i}`,material=`${prefix}-limit-${i}`;
     add(`items/${raw}`,{companyId:'taebaek',name:material,subtype:'벌크',stock:0,lots:[]});
     add(`items/${product}`,{companyId:'taebaek',name:product,procureType:'임가공',packageKg:1,stock:0,lots:[]});
     add(`item_formula/${product}`,{parent_key:product,child_name:material,ratio:1,yield_rate:1});
     add(`appMeta/oemLotSequence_taebaek_20261013_${encodeURIComponent(material)}`,{companyId:'taebaek',material,date,lastSequence:0});
     returns.push({itemId:product,qty:1});bulk.push({material,rawItemId:raw,kg:1});
     paths.add(`rawInventories/${inventoryDocId('taebaek',raw)}`);
     paths.add(`rawMaterialLedger/${operationDocId(`oem-receive-raw:${f.po}:${raw}`)}`);
   }
   await batch.commit();
   await expect(receiveOemFinishedGoods(db,'taebaek',{...f.input,returns,bulk})).rejects.toThrow('발주를 나누어');
   for(const row of [...returns,...bulk.map(row=>({itemId:row.rawItemId}))])expect((await db.doc(`items/${row.itemId}`).get()).data()?.stock).toBe(0);
   expect((await db.doc(`oemReceiptOperations/${f.operationId}`).get()).exists).toBe(false);
   expect((await db.doc(`adjustmentRequests/OEMFEE-${f.po}`).get()).exists).toBe(false);
 },30000);
 it('실사 앞 입고는 원kg만 기록하고 현재 재고나 새 로트를 만들지 않는다',async()=>{const f=await fixture('backdate');await seed(`rawInventories/${inventoryDocId('taebaek',f.raw)}`,{id:inventoryDocId('taebaek',f.raw),companyId:'taebaek',rawItemId:f.raw,materialSnapshot:f.name,stockKg:0,activeLots:[],recentDepletedLots:[],revision:1,lastProcessedAt:date,stocktakeAnchor:{effectiveAt:`${date}T15:00:00+09:00`,operationId:'anchor',sequence:1}});await receiveOemFinishedGoods(db,'taebaek',f.input);expect((await db.doc(`items/${f.raw}`).get()).data()).toMatchObject({stock:0,lots:[]});const bulk=(await db.doc(`purchaseOrders/${f.po}`).get()).data()?.oemReceivedBulk[0];expect(bulk).toMatchObject({kg:10,reportedDeltaKg:10,appliedDeltaKg:0,status:'skipped-backdated'});expect((await receiveOemFinishedGoods(db,'taebaek',f.input)).status).toBe('duplicate');});
});
