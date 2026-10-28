import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {getFirestore,type Firestore} from 'firebase-admin/firestore';
import {prepareOrderStockReservationPreview,type OrderStockReservationPreviewResult} from './orderStockExecutionPlan';
const enabled=process.env.ORDER_STOCK_PREVIEW_EMULATOR==='true',projectId='demo-order-stock-preview-20261028',prefix='trusted-preview-'+randomUUID()+'-',owned=new Set<string>(),observations:unknown[]=[];
let app:App,db:Firestore;
const clock={now:'2026-10-28T00:00:00.000Z',nowMs:Date.parse('2026-10-28T00:00:00.000Z')},actor={uid:'employee',token:{employeeId:'employee',companyId:'taebaek'}};
function guard(){if(!enabled||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8288'||process.env.ORDER_STOCK_PREVIEW_PROJECT!==projectId||process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_CONFIG)throw Error('명시 demo loopback8288 소유 시험만 허용합니다.');for(const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])if(process.env[key]&&process.env[key]!==projectId)throw Error('외부 프로젝트 환경 금지');}
function path(collection:string,id:string){guard();if(!['orders','items','item_bom','item_pack','item_formula'].includes(collection)||id.includes('/'))throw Error('비소유 경로');const p=collection+'/'+prefix+id;owned.add(p);return p;}
async function put(p:string,value:Record<string,unknown>){guard();if(!owned.has(p))throw Error('비소유 쓰기');await db.doc(p).set(value);}
async function cleanup(){for(const p of owned){guard();await db.doc(p).delete();expect((await db.doc(p).get()).exists).toBe(false);}}
function preview(r:OrderStockReservationPreviewResult){expect(r.status).toBe('preview');if(r.status!=='preview')throw Error(r.reason);return r;}
async function seed(count=1){
 const product=path('items','product'),order=path('orders','order'),formula=path('item_formula','formula');
 await put(product,{companyId:'taebaek',name:'합성품',type:'product',unit:'개',spec:'1kg',stock:1});
 for(let i=0;i<count;i++){const material=path('items','material'+i),bom=path('item_bom','bom'+i);await put(material,{companyId:'taebaek',name:'포장'+i,type:'submaterial',unit:'개',stock:20});await put(bom,{companyId:'taebaek',parent_id:product.split('/')[1],child_id:material.split('/')[1],quantity:1});}
 await put(formula,{companyId:'taebaek',parent_key:'합성품',child_name:'통깨참기름',ratio:1});
 await put(order,{companyId:'taebaek',status:'PENDING',items:[{itemId:product.split('/')[1],quantity:3,lineId:'원 opaque / 줄'}]});
 const intent={version:1,companyId:'taebaek',requestId:prefix+'request',orderId:order.split('/')[1],action:'status-forward',targetStatus:'DISPATCHED'};
 return {product,order,intent};
}
describe.skipIf(!enabled)('신뢰 예약 미리보기 실제 Admin SDK',()=>{
 beforeAll(()=>{guard();app=initializeApp({projectId},prefix);db=getFirestore(app);});
 afterAll(async()=>{let cleanupConfirmed=false;try{if(db){await cleanup();cleanupConfirmed=true;}}finally{if(app)await deleteApp(app);writeFileSync('work/performance-orders-trusted-preview-sdk-observations-20261028.json',JSON.stringify({projectId,prefix,sourceSHA256:createHash('sha256').update(readFileSync('functions/src/shared/orderStockExecutionPlan.ts')).digest('hex'),ownedPaths:[...owned],cleanupConfirmed,observations,wholeClear:0,operatingAccess:0},null,2));}});
 it('실제 RW 네 query 시각을 보존하고 preview 뒤 caller marker만 commit한다',async()=>{
  await cleanup();const f=await seed(),marker=path('orders','marker'),before=await db.doc(f.product).get();
  const r=preview(await db.runTransaction(async tx=>{const result=preview(await prepareOrderStockReservationPreview(tx,db,actor,f.intent,clock));tx.set(db.doc(marker),{companyId:'taebaek',previewObserved:true});return result;}));
  expect(r.quantities).toEqual([[f.product.split('/')[1],1],[prefix+'material0',2]]);expect(r.allocationQuantities).toEqual([[f.product.split('/')[1],3]]);expect(r.plannerAggregate.producedUnits).toEqual([{itemId:f.product.split('/')[1],qty:2}]);expect((await db.doc(marker).get()).exists).toBe(true);expect((await db.doc(f.product).get()).updateTime?.isEqual(before.updateTime!)).toBe(true);expect(r.executionAllowed).toBe(false);
  observations.push({id:'rw-caller-commit',markerCommitted:true,stockUnchanged:true,queryReadTimes:r.queryReadTimes,uniqueTimes:new Set(Object.values(r.queryReadTimes).map(t=>t.seconds+':'+t.nanoseconds)).size});
 });
 it('부족 차단은 caller outer throw로 marker0·기존 order/item 전문불변이다',async()=>{
  await cleanup();const f=await seed(),material='items/'+prefix+'material0',marker=path('orders','abort-marker');await put(material,{companyId:'taebaek',name:'포장',type:'submaterial',unit:'개',stock:1});const before=await db.getAll(db.doc(f.order),db.doc(f.product),db.doc(material));
  await expect(db.runTransaction(async tx=>{const result=await prepareOrderStockReservationPreview(tx,db,actor,f.intent,clock);if(result.status==='blocked')throw Error(result.reason);tx.set(db.doc(marker),{unexpected:true});})).rejects.toThrow('stock-shortage');
  expect((await db.doc(marker).get()).exists).toBe(false);const after=await db.getAll(...before.map(row=>row.ref));after.forEach((row,i)=>{expect(row.data()).toEqual(before[i].data());expect(row.updateTime?.isEqual(before[i].updateTime!)).toBe(true);});observations.push({id:'blocked-outer-abort',markerExists:false,sourceDocumentsUnchanged:true,helperRollbackAuthority:false});
 });
 it('21개 필수 부자재와 기존 완제품1을 빠짐없이 실제 읽고 쓰기0 미리본다',async()=>{
  await cleanup();const f=await seed(21),r=preview(await db.runTransaction(tx=>prepareOrderStockReservationPreview(tx,db,actor,f.intent,clock)));expect(r.quantities).toHaveLength(22);expect(r.quantities.filter(([id])=>id!==f.product.split('/')[1]).every(([,qty])=>qty===2)).toBe(true);expect((await db.doc(f.product).get()).get('stock')).toBe(1);observations.push({id:'21-required-preview',requiredMaterials:21,totalReservations:22,actualReserveWrites:0});
 });
 it('회사 불일치와 기존 효과는 실제 서버 order 원문에서 차단한다',async()=>{
  await cleanup();const f=await seed();await db.doc(f.order).update({companyId:'punghoe'});expect(await db.runTransaction(tx=>prepareOrderStockReservationPreview(tx,db,actor,f.intent,clock))).toMatchObject({status:'blocked',reason:'permission-denied'});await db.doc(f.order).update({companyId:'taebaek',producedAt:clock.now});expect(await db.runTransaction(tx=>prepareOrderStockReservationPreview(tx,db,actor,f.intent,clock))).toMatchObject({status:'blocked',reason:'unsupported-existing-work'});observations.push({id:'actual-order-company-existing-effects',blocked:true});
 });
 it('충돌 pack은 assembly 내부에서 차단하고 marker0을 유지한다',async()=>{
  await cleanup();const f=await seed(),marker=path('orders','pack-abort');for(const [id,qty]of [['a',12],['b',24]] as const)await put(path('item_pack',id),{companyId:'taebaek',item_id:f.product.split('/')[1],units_per_box:qty});await expect(db.runTransaction(async tx=>{const result=await prepareOrderStockReservationPreview(tx,db,actor,f.intent,clock);if(result.status==='blocked')throw Error(result.reason);tx.set(db.doc(marker),{unexpected:true});})).rejects.toThrow('ambiguous-pack');expect((await db.doc(marker).get()).exists).toBe(false);observations.push({id:'assembly-ambiguous-pack',markerExists:false});
 });
});
