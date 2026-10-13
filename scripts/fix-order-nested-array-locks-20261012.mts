// 사용자 명시 수동 해제다. 이 기록을 재고 전체 무반영 증명으로 사용하지 않는다.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Timestamp} from 'firebase-admin/firestore';
import {createGoodsRepairAuthClient,goodsRepairHash} from './fix-goods-receipt-lots-20261012.mts';
export const TARGETS=[
 {id:'ORD-1791764807041',op:'order-line-ORD-1791764807041-line-2-p-1775086496028-1791769818655',at:'2026-10-12T01:50:18.655Z'},
 {id:'ORD-1791765141201',op:'order-line-ORD-1791765141201-line-2-box-p-1775432881153-20-1791790308561',at:'2026-10-12T07:31:48.561Z'},
 {id:'ORD-1791765760437',op:'order-line-ORD-1791765760437-line-1-p-1775688081496-1791791010218',at:'2026-10-12T07:43:30.218Z'},
] as const;
const ids=TARGETS.map(x=>x.id);
const queries=[['rawInventoryJobs','source.id'],['rawMaterialLedger','source.id'],['rawMaterialLedger','orderId'],['productionRecords','orderId'],['orderStatusAudits','orderId']] as const;
const encode=(v:any):any=>v instanceof Timestamp?{_lockTimestamp:[v.seconds,v.nanoseconds]}:Array.isArray(v)?v.map(encode):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)])):v;
const decode=(v:any):any=>Array.isArray(v)?v.map(decode):v&&typeof v==='object'?('_lockTimestamp' in v?new Timestamp(...v._lockTimestamp):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)]))):v;
const snap=(s:any)=>({path:s.ref.path,exists:s.exists,data:s.exists?s.data():null,version:s.updateTime?{seconds:s.updateTime.seconds,nanoseconds:s.updateTime.nanoseconds}:null});
const stop=(m:string):never=>{throw Error(m);};
export function validateLockOrder(row:any,index:number){
 const target=TARGETS[index],o=row.data,p=o?.inventoryOperation;
 if(row.path!=='orders/'+target.id||!row.exists||o.companyId!=='taebaek'||o.status!=='PENDING'||p?.id!==target.op||p.startedAt!==target.at||p.state!=='failed'||p.stage!=='raw-inventory'||p.contractVersion!==1||!String(p.error).includes('Nested arrays are not supported'))stop('최초 실패 주문 원문이 변경됐습니다.');
 if(o.producedAt||o.shippedOut||o.inventoryGenerationCompletion||Object.keys(o.productionRecordIndex??{}).length||Object.keys(o.itemInventory??{}).length||o.items.some((x:any)=>x.checked||x.checkedAt))stop('주문에 생산·완료 근거가 있어 자동 해제하지 않았습니다.');
 return {...o,inventoryOperation:null};
}
export function assessLockEvidence(e:any){
 if(e.jobs.some((s:any)=>s.exists))stop('최초 원료 작업이 존재합니다.');
 for(const q of e.results){if(q.collection!=='orderStatusAudits'&&q.rows.length)stop('재고·생산 효과 근거가 존재합니다.');if(q.collection==='orderStatusAudits'&&q.rows.some((s:any)=>s.data.state!=='failed'))stop('상태 작업 완료·진행 근거가 존재합니다.');}
 if(e.reservations.some((s:any)=>(s.data.inventoryReservations??[]).some((r:any)=>ids.includes(r.orderId))))stop('잔존 주문 예약을 먼저 확인해야 합니다.');
}
async function evidence(db:any,reader:any){
 const get=(ref:any)=>reader?reader.get(ref):ref.get();
 const orders=await Promise.all(TARGETS.map(x=>get(db.doc('orders/'+x.id))));
 const jobs=await Promise.all(TARGETS.map(x=>get(db.doc('rawInventoryJobs/order-raw-batch:v1:op_'+Buffer.from(x.op).toString('base64url')))));
 const results=[];
 for(const [collection,field]of queries){const q=await get(db.collection(collection).where(field,'in',ids));results.push({collection,field,rows:q.docs.map(snap)});}
 const items=await get(db.collection('items').select('companyId','inventoryReservations'));
 return {orders:orders.map(snap),jobs:jobs.map(snap),results,reservations:items.docs.map(snap)};
}
export function prepareLockPlan(e:any){
 assessLockEvidence(e);const orders=e.orders.map((row:any,i:number)=>({...row,after:validateLockOrder(row,i)}));
 return {version:1,reason:'manual-user-authorized',inventoryApplied:'unknown',preparedAt:new Date().toISOString(),evidence:e,orders};
}
const versionEqual=(a:any,b:any)=>goodsRepairHash(a)===goodsRepairHash(b);
export async function applyLockPlan(db:any,plan:any,mode:'apply'|'undo',receipt?:any){
 if(plan.version!==1||plan.reason!=='manual-user-authorized'||plan.inventoryApplied!=='unknown'||plan.orders.length!==3)stop('수동 해제 백업 범위를 확인해 주세요.');
 assessLockEvidence(plan.evidence);plan.orders.forEach((x:any,i:number)=>{if(goodsRepairHash(validateLockOrder(x,i))!==goodsRepairHash(x.after))stop('백업 계획이 원문과 다릅니다.');});
 return db.runTransaction(async(tx:any)=>{
  const live=await evidence(db,tx);assessLockEvidence(live);
  for(const k of ['jobs','results','reservations'])if(goodsRepairHash(live[k])!==goodsRepairHash(plan.evidence[k]))stop('재고 근거·예약 문서 버전이 변경됐습니다.');
  const expected=mode==='apply'?'data':'after',opposite=mode==='apply'?'after':'data';
  if(live.orders.every((r:any,i:number)=>goodsRepairHash(r.data)===goodsRepairHash(plan.orders[i][opposite])))return 'duplicate';
  live.orders.forEach((r:any,i:number)=>{
   const p=plan.orders[i];if(goodsRepairHash(r.data)!==goodsRepairHash(p[expected]))stop('현재 주문이 백업과 달라 쓰지 않았습니다.');
   const v=mode==='apply'?p.version:receipt?.orders?.[i]?.version;if(!v||!versionEqual(r.version,v))stop('현재 주문 버전이 달라 쓰지 않았습니다.');
  });
  live.orders.forEach((r:any,i:number)=>tx.update(db.doc(r.path),{inventoryOperation:mode==='apply'?null:plan.orders[i].data.inventoryOperation},{lastUpdateTime:new Timestamp(r.version.seconds,r.version.nanoseconds)}));
  return mode==='apply'?'applied':'undone';
 });
}
async function main(){
 const args=process.argv.slice(2);if(args.length>1||args.some(x=>!['--dry','--apply','--undo'].includes(x)))stop('dry/apply/undo 중 하나만 지정해 주세요.');
 if(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST)stop('운영 CLI의 에뮬레이터 환경을 해제해 주세요.');
 const mode=args.includes('--apply')?'apply':args.includes('--undo')?'undo':'dry';
 const folder=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),backup=resolve(folder,'order-nested-array-locks-backup-20261012.json'),proof=resolve(folder,'order-nested-array-locks-applied-20261012.json');
 const require=createRequire(import.meta.url),auth=require(resolve(process.env.APPDATA!,'npm/node_modules/firebase-tools/lib/auth.js')),account=auth.getGlobalDefaultAccount();
 const token=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);const {Firestore}=require('@google-cloud/firestore');
 const db=new Firestore({projectId:'taebaek-3abe4',authClient:createGoodsRepairAuthClient(token.access_token,Date.now()+3500000)});
 try{
  if(mode==='dry'){if(existsSync(backup)||existsSync(proof))stop('기존 비공개 백업을 덮어쓰지 않습니다.');const plan=prepareLockPlan(await evidence(db,null));writeFileSync(backup,JSON.stringify(encode({plan,hash:goodsRepairHash(plan)}),null,2),{flag:'wx'});console.log(JSON.stringify({mode,status:'prepared',orders:3,operatingWrites:0,inventoryApplied:'unknown'}));}
  else{if(!existsSync(backup))stop('원문 백업이 없습니다.');const saved=decode(JSON.parse(readFileSync(backup,'utf8')));if(goodsRepairHash(saved.plan)!==saved.hash)stop('백업 해시가 다릅니다.');const receipt=existsSync(proof)?decode(JSON.parse(readFileSync(proof,'utf8'))):undefined;if(mode==='undo'&&!receipt)stop('적용 버전 영수증이 없습니다.');const status=await applyLockPlan(db,saved.plan,mode,receipt);const current=await Promise.all(TARGETS.map(x=>db.doc('orders/'+x.id).get()));if(current.some((s:any,i:number)=>goodsRepairHash(s.data())!==goodsRepairHash(saved.plan.orders[i][mode==='apply'?'after':'data'])))stop('적용 후 원문 대조가 실패했습니다.');if(mode==='apply'&&!existsSync(proof))writeFileSync(proof,JSON.stringify(encode({orders:current.map(snap),status}),null,2),{flag:'wx'});console.log(JSON.stringify({mode,status,verified:true,orders:3,changedFields:['inventoryOperation'],inventoryApplied:'unknown',stockWrites:0}));}
 }finally{await db.terminate();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({message:'수동 잠금 해제 중단',reason:typeof e.code==='number'?e.code:String(e.message).startsWith('최초')||String(e.message).includes('변경')||String(e.message).includes('근거')||String(e.message).includes('예약')?e.message:'백업·인증·문서 상태 확인 필요'}));process.exitCode=1;});
