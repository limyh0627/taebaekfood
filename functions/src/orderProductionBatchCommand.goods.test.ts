import {describe,it,expect} from 'vitest';
import {FieldValue,Timestamp} from 'firebase-admin/firestore';
import {emptyRawInventory,inventoryDocId} from './shared/rawInventoryCore';
import {executeOrderProductionBatchCommand} from './orderProductionBatchCommand';

/**
 * 2026-11-04 사장님: 상품(`type=goods`)은 만들지 않으니 대조 없이 출고 때 재고에서 차감만 한다.
 * 실제 서버 명령 전체를 메모리 저장소 위에서 돌려, 완료 뒤 출고·취소·해제가 막히지 않는지 본다.
 */
const nowMs=Date.parse('2026-11-04T01:00:00.000Z');
const actor={uid:'uid',token:{companyId:'taebaek',employeeId:'employee'}} as any;
const LINE_P='line-1-p',LINE_G='line-2-g';
function memoryDb(seed:[string,any][]){
 const rows=new Map<string,any>(seed),versions=new Map<string,Timestamp>();let tick=1000;const stamp=()=>new Timestamp(tick++,0);for(const [path] of seed)versions.set(path,stamp());
 const snap=(path:string)=>({id:path.split('/').pop(),ref:{path},exists:rows.has(path),data:()=>rows.has(path)?structuredClone(rows.get(path)):undefined,updateTime:versions.get(path),createTime:versions.get(path),readTime:new Timestamp(tick,0)});
 const query=(collection:string,filters:[string,any][]=[],limit=Infinity,after?:string):any=>({collection,filters,lim:limit,
  where:(field:string,_op:string,value:any)=>query(collection,[...filters,[field,value]],limit,after),limit:(n:number)=>query(collection,filters,n,after),orderBy:()=>query(collection,filters,limit,after),startAfter:(cursor:any)=>query(collection,filters,limit,cursor?.id??cursor),
  isQuery:true});
 const run=(ref:any)=>{const field=(row:any,path:string)=>path.split('.').reduce((value,key)=>value?.[key],row);const docs=[...rows.keys()].filter(path=>path.startsWith(ref.collection+'/')&&path.split('/').length===ref.collection.split('/').length+1&&ref.filters.every(([name,value]:[string,any])=>name==='__name__'||field(rows.get(path),name)===value)).sort().filter(path=>!ref.after||path.split('/').pop()!>ref.after).slice(0,ref.lim).map(snap);return {docs,size:docs.length,empty:!docs.length,readTime:new Timestamp(tick,0)};};
 const db:any={projectId:'demo-goods-unit',databaseId:'(default)',doc:(path:string)=>({path}),collection:(path:string)=>query(path),
  runTransaction:async(callback:any,options?:any)=>{const writes:[string,string,any][]=[],tx:any={get:async(ref:any)=>ref.isQuery?run(ref):snap(ref.path),getAll:async(...refs:any[])=>refs.map(ref=>snap(ref.path)),set:(ref:any,data:any)=>{writes.push(['set',ref.path,data]);return tx;},create:(ref:any,data:any)=>{if(rows.has(ref.path))throw Error('create-exists');writes.push(['set',ref.path,data]);return tx;},update:(ref:any,data:any)=>{writes.push(['update',ref.path,data]);return tx;},delete:(ref:any)=>{writes.push(['delete',ref.path,null]);return tx;}};const out=await callback(tx);if(options?.readOnly&&writes.length)throw Error('read-only-write');for(const [kind,path,data] of writes){if(kind==='delete'){rows.delete(path);versions.delete(path);continue;}const next=kind==='update'?{...rows.get(path)}:{};for(const [key,value] of Object.entries(data as object)){if((value as any)?.isEqual?.(FieldValue.delete()))delete next[key];else next[key]=value;}rows.set(path,structuredClone(next));versions.set(path,stamp());}return out;}};
 return {db,rows};
}
function seed(goodsStock:number,extra:[string,any][]=[]){const lots=[{id:'lot',material:'통깨참기름',supplierName:'공급',kgIn:100,kgRemaining:100,receivedDate:'2026-10-01',status:'active',createdAt:'2026-10-01T00:00:00.000Z'}];return memoryDb([
 ['employees/employee',{companyId:'taebaek',authUid:'uid',name:'담당',status:'working'}],
 ['orders/order',{companyId:'taebaek',status:'PENDING',partnerName:'고객',partnerId:'partner',totalAmount:3200,items:[{lineId:LINE_P,itemId:'p',quantity:2,price:1000},{lineId:LINE_G,itemId:'g',quantity:12,isBoxUnit:true,boxQuantity:1,unitsPerBox:12,price:100}]}],
 ['items/p',{companyId:'taebaek',name:'품목',id:'p',type:'product',unit:'개',stock:0,spec:'1kg'}],
 ['items/g',{companyId:'taebaek',name:'참향기름',id:'g',type:'goods',category:'향미유',unit:'개',stock:goodsStock}],
 ['item_pack/g-12',{companyId:'taebaek',item_id:'g',units_per_box:12}],
 ['item_formula/f',{companyId:'taebaek',parent_key:'품목',child_name:'통깨참기름',ratio:1}],
 ['items/raw',{companyId:'taebaek',id:'raw',name:'통깨참기름',rawMaterialName:'통깨참기름',type:'wip',subtype:'벌크',unit:'kg',stock:100,lots}],
 ['rawInventories/'+inventoryDocId('taebaek','raw'),{...emptyRawInventory('taebaek','raw','통깨참기름','2026-10-01T00:00:00.000Z'),stockKg:100,activeLots:lots}],
 ...extra,
]);}
let serial=0;
const rid=()=>`pb1-00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`;
const clockAt=()=>{const ms=nowMs+serial*1000;return {now:new Date(ms).toISOString(),nowMs:ms};};
function driver(db:any){
 const call=(input:any)=>executeOrderProductionBatchCommand(db,actor,input,clockAt()) as Promise<any>;
 const open=()=>call({version:1,mode:'open',companyId:'taebaek',orderId:'order',stockOnlyItemIds:[]});
 const reference=()=>({version:1,companyId:'taebaek',orderId:'order',requestId:rid()});
 const finish=async(reserved:any)=>{if(reserved.state!=='reserved')throw Error('준비 실패: '+JSON.stringify({state:reserved.state,reason:reserved.reason,message:reserved.message}));const applied=await call({version:1,mode:'apply',locator:reserved.locator,expectedPlanHash:reserved.planHash});if(applied.state!=='applied')throw Error('적용 실패: '+JSON.stringify({state:applied.state,reason:applied.reason,message:applied.message}));return applied;};
 const prepareComplete=async(lineIds:string[])=>{const opening=await open();const lines=opening.rows.filter((row:any)=>lineIds.includes(row.lineId)).map((row:any)=>({lineId:row.lineId,complete:{value:row.orderedQty,kind:row.unit.order.kind,measureId:row.unit.measureId},stockUse:{own:{itemId:row.unit.stock.itemId,value:0,measureId:row.unit.measureId}}}));return call({version:1,mode:'prepare-reserve',intent:{version:1,reference:reference(),opening:opening.opening,action:'complete-partial',lines,stockOnly:[]}});};
 const prepareConsumer=async(extra:any)=>{const opening=await open();return call({version:1,mode:'prepare-reserve',intent:{version:1,reference:reference(),opening:opening.opening,...extra}});};
 return {call,open,finish,prepareComplete,prepareConsumer,complete:async(lineIds:string[])=>finish(await prepareComplete(lineIds)),ship:async()=>finish(await prepareConsumer({action:'shipment-forward',targetStatus:'SHIPPED'}))};
}
const goodsOf=(rows:Map<string,any>)=>rows.get('items/g');

describe('끝나지 않은 요청이 잡은 주문',()=>{
 it('창을 열면 이전 작업으로 안내하고, 중단하면 표식이 지워져 새로 처리할 수 있다',async()=>{
  const {db,rows}=seed(48),d=driver(db);
  const reserved=await d.prepareComplete([LINE_P]);
  expect(reserved.state).toBe('reserved');
  expect(rows.get('orders/order').inventoryExecutionProtocol).toBe('full-v1');
  expect(rows.get('orders/order').inventoryOperation.fullAttemptId).toEqual(expect.any(String));
  expect(rows.get('orders/order').inventoryOperation.fullReference).toEqual(expect.anything());
  const active=await d.open();
  expect(active.state).toBe('active');
  expect(active.activeRequest).toEqual(reserved.locator);
  const cancelled=await d.call({version:1,mode:'cancel',locator:reserved.locator,expectedRequestHash:reserved.requestHash});
  expect(cancelled.state).toBe('cancelled');
  expect(rows.get('orders/order').inventoryExecutionProtocol).toBeUndefined();
  expect(rows.get('orders/order').inventoryOperation??null).toBeNull();
  expect((await d.open()).state).toBe('open');
  await d.complete([LINE_P,LINE_G]);
 });
});

describe('상품 줄은 예약 대조 없이 출고 때 재고에서 차감한다',()=>{
 it('상품 줄을 완료해도 예약을 잡지 않고 재고도 그대로이며, 창이 다시 열린다',async()=>{
  const {db,rows}=seed(48),d=driver(db);
  await d.complete([LINE_G]);
  expect(goodsOf(rows).stock).toBe(48);
  expect(goodsOf(rows).inventoryReservations??[]).toEqual([]);
  const opened=await d.open();
  expect(opened.rows.find((row:any)=>row.lineId===LINE_G).completedQty).toBe(1);
 });

 it('막혔던 대왕푸드 순서: 제조 줄 완료 → 상품 줄 완료 → 출고하면 상품 재고가 주문량만큼 준다',async()=>{
  const {db,rows}=seed(48),d=driver(db);
  await d.complete([LINE_P]);
  await d.complete([LINE_G]);
  expect(rows.get('orders/order').status).toBe('DISPATCHED');
  await d.ship();
  expect(rows.get('orders/order').status).toBe('SHIPPED');
  expect(goodsOf(rows).stock).toBe(36);
  expect(goodsOf(rows).inventoryReservations??[]).toEqual([]);
  expect(rows.get('items/p').inventoryReservations).toEqual([]);
 });

 it('상품 줄을 먼저 완료한 뒤 제조 줄을 완료해도 출고까지 간다',async()=>{
  const {db,rows}=seed(48),d=driver(db);
  await d.complete([LINE_G]);
  await d.complete([LINE_P]);
  await d.ship();
  expect(goodsOf(rows).stock).toBe(36);
  expect(rows.get('items/p').stock).toBe(0);
 });

 it('한 요청에 상품 줄과 제조 줄을 함께 완료해도 출고까지 간다',async()=>{
  const {db,rows}=seed(48),d=driver(db);
  await d.complete([LINE_P,LINE_G]);
  await d.ship();
  expect(goodsOf(rows).stock).toBe(36);
 });

 it('출고를 취소하면 상품 재고가 돌아오고 예약은 생기지 않으며 다시 출고할 수 있다',async()=>{
  const {db,rows}=seed(48),d=driver(db);
  await d.complete([LINE_P,LINE_G]);
  await d.ship();
  const cancelling=await d.prepareConsumer({action:'cancel-shipment'});
  expect(cancelling.preview.stockChanges.find((row:any)=>row.itemId==='g')).toMatchObject({before:36,delta:12,after:48,reservedBefore:0,reservedAfter:0});
  await d.finish(cancelling);
  expect(rows.get('orders/order').status).toBe('DISPATCHED');
  expect(goodsOf(rows).stock).toBe(48);
  expect(goodsOf(rows).inventoryReservations??[]).toEqual([]);
  await d.ship();
  expect(goodsOf(rows).stock).toBe(36);
 });

 it('출고 때 재고가 모자라면 재고 부족으로 막고 주문을 잠그지 않는다',async()=>{
  const {db,rows}=seed(48),d=driver(db);
  await d.complete([LINE_P,LINE_G]);
  rows.set('items/g',{...goodsOf(rows),stock:3});
  const blocked=await d.prepareConsumer({action:'shipment-forward',targetStatus:'SHIPPED'});
  expect(blocked.state).toBe('blocked');
  expect(blocked.message).toContain('재고가 부족');
  expect(blocked.message).toContain('참향기름');
  expect(rows.get('orders/order').inventoryOperation??null).toBeNull();
  expect(goodsOf(rows).stock).toBe(3);
 });

 it('완료 배정을 풀어도 상품 재고는 그대로이고 줄이 미완료로 돌아간다',async()=>{
  const {db,rows}=seed(48),d=driver(db);
  await d.complete([LINE_G]);
  await d.finish(await d.prepareConsumer({action:'release-order-allocation',disposition:'keep-order'}));
  expect(goodsOf(rows).stock).toBe(48);
  expect(rows.get('orders/order').items.find((line:any)=>line.lineId===LINE_G).checked).toBe(false);
  const opened=await d.open();
  expect(opened.rows.find((row:any)=>row.lineId===LINE_G).completedQty).toBe(0);
 });

 it('상품만 완료한 묶음을 생산 취소해도 재고는 그대로이고 다시 완료할 수 있다',async()=>{
  const {db,rows}=seed(48),d=driver(db);
  await d.complete([LINE_G]);
  const opened=await d.open();
  expect(opened.reversibleBatches).toHaveLength(1);
  await d.finish(await d.prepareConsumer({action:'reverse-production-batch',batchId:opened.reversibleBatches[0].batchId}));
  expect((await d.open()).rows.find((row:any)=>row.lineId===LINE_G).completedQty).toBe(0);
  expect(goodsOf(rows).stock).toBe(48);
  await d.complete([LINE_G]);
  expect((await d.open()).rows.find((row:any)=>row.lineId===LINE_G).completedQty).toBe(1);
 });

 it('주문을 나눠도 상품 줄이 막히지 않고 양쪽 창이 열린다',async()=>{
  const {db,rows}=seed(48),d=driver(db);
  await d.complete([LINE_G]);
  const row=(await d.open()).rows.find((value:any)=>value.lineId===LINE_G),quantity={value:1,kind:row.unit.order.kind,measureId:row.unit.measureId};
  await d.finish(await d.prepareConsumer({action:'split-ready',childOrderId:'split-child',lines:[{lineId:LINE_G,move:quantity,moveCompleted:quantity}]}));
  expect(rows.has('orders/split-child')).toBe(true);
  expect(goodsOf(rows).stock).toBe(48);
  expect(goodsOf(rows).inventoryReservations??[]).toEqual([]);
  expect((await d.open()).state).toBe('open');
 });

 it('제조 품목은 예약 대조를 그대로 유지한다: 예약이 사라지면 거절한다',async()=>{
  const {db,rows}=seed(48),d=driver(db);
  await d.complete([LINE_P]);
  const product=rows.get('items/p');
  expect(product.inventoryReservations).toHaveLength(1);
  rows.set('items/p',{...product,inventoryReservations:[],fullReservationRows:[],serverReservedStockFloorV1:0});
  await expect(d.open()).rejects.toThrow('주문 품목과 생산 근거를 확인해 주세요');
 });
});
