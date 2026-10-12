// 실행은 총괄 검수 뒤 별도 배정한다. 기본 dry이며 확인된 네 입고의 lots만 복원한다.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {Timestamp,type Firestore} from 'firebase-admin/firestore';
import {require as tsxRequire} from 'tsx/cjs/api';
import type {Item} from '../src/shared/types.ts';
// 앱 ESM과 Functions CJS를 각각 복제하지 않고 같은 TS 본문을 읽는다.
const {buildProductLot,lotQtyRemaining}:typeof import('../functions/src/shared/productLot')=tsxRequire('../functions/src/shared/productLot.ts',import.meta.url);
const {tracksQuantityLots}:typeof import('../functions/src/shared/itemInventoryKind')=tsxRequire('../functions/src/shared/itemInventoryKind.ts',import.meta.url);
const {itemKg}:typeof import('../src/shared/orderUnits')=tsxRequire('../src/shared/orderUnits.ts',import.meta.url);
const {buildBomIndex}:typeof import('../src/shared/bomIndex')=tsxRequire('../src/shared/bomIndex.ts',import.meta.url);
const {buildPackIndex}:typeof import('../src/shared/packIndex')=tsxRequire('../src/shared/packIndex.ts',import.meta.url);
const {companyOf}:typeof import('../src/shared/types')=tsxRequire('../src/shared/types.ts',import.meta.url);

type Row=Record<string,any>;
type Version={seconds:number;nanoseconds:number};
export type RepairSnapshot={path:string;data:Row;version:Version};
export type QueryProof={collection:'item_bom'|'item_pack';field:'parent_id'|'item_id';ids:string[];paths:string[]};
export const GOODS_RECEIPT_TARGETS=[
 {itemId:'f1',receiptId:'rcv-po-po-stmt-1791425968010-f1',poId:'po-stmt-1791425968010',quantity:384,date:'2026-10-08',partnerId:'C001'},
 {itemId:'f2',receiptId:'rcv-po-po-1791787164590-0-f2',poId:'po-1791787164590-0',quantity:144,date:'2026-10-12',partnerId:'C001'},
 {itemId:'f5',receiptId:'rcv-po-po-1791787164590-0-f5',poId:'po-1791787164590-0',quantity:240,date:'2026-10-12',partnerId:'C001'},
 {itemId:'f4',receiptId:'rcv-po-po-1791787164590-0-f4',poId:'po-1791787164590-0',quantity:384,date:'2026-10-12',partnerId:'C001'},
] as const;
export class GoodsRepairError extends Error {}
/** 설치된 gRPC는 plain 헤더를 기대하므로 그 SDK가 쓰는 같은 OAuth 라이브러리 버전을 선택한다. */
export function createGoodsRepairAuthClient(accessToken:string,expiresAt:number){
 const require=createRequire(import.meta.url),sdkRequire=createRequire(require.resolve('@google-cloud/firestore')),gaxRequire=createRequire(sdkRequire.resolve('google-gax'));
 const {OAuth2Client}=gaxRequire('google-auth-library');const client=new OAuth2Client();client.setCredentials({access_token:accessToken,expiry_date:expiresAt});return client;
}
export function safeGoodsRepairFailure(error:unknown):Record<string,unknown>{
 if(error instanceof GoodsRepairError)return {message:error.message};
 const row=error as {name?:unknown;code?:unknown}|undefined;
 const safe=(value:unknown)=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value)?value:undefined;
 return {message:'복원 준비·확인에 실패했습니다. 기존 CLI 인증과 조회 권한을 확인해 주세요. 비밀값·원문·오류 본문은 출력하지 않았습니다.',name:safe(row?.name)??'Error',...(typeof row?.code==='number'||safe(row?.code)?{code:row?.code}:{})};
}
const stop=(message:string):never=>{throw new GoodsRepairError(message);};
const encode=(value:any):any=>{
 if(value instanceof Timestamp)return {_goodsLotTimestamp:[value.seconds,value.nanoseconds]};
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value))return value.map(encode);
 if(value&&Object.getPrototypeOf(value)===Object.prototype&&!Object.hasOwn(value,'_goodsLotTimestamp'))return Object.fromEntries(Object.entries(value).map(([key,row])=>[key,encode(row)]));
 return stop('백업에서 보존할 수 없는 문서 형식입니다.');
};
const decode=(value:any):any=>{
 if(value&&Object.hasOwn(value,'_goodsLotTimestamp')){
  const pair=value._goodsLotTimestamp;if(Object.keys(value).length!==1||!Array.isArray(pair)||pair.length!==2||!pair.every(Number.isSafeInteger))stop('백업 시각 형식이 손상됐습니다.');
  return new Timestamp(pair[0],pair[1]);
 }
 if(Array.isArray(value))return value.map(decode);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,row])=>[key,decode(row)]));
 return value;
};
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const goodsRepairHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(encode(value)))).digest('hex');
export type GoodsRepairPlan={version:1;companyId:'taebaek';sources:RepairSnapshot[];queries:QueryProof[];documents:{id:string;version:Version;before:Row;after:Row;beforeHash:string;afterHash:string}[]};
/** 현재고와 원입고의 누락량이 정확히 같을 때만 원입고 하나를 복원한다. 다른 재고 차이를 메우지 않는다. */
export function prepareGoodsReceiptLots(sources:RepairSnapshot[],queries:QueryProof[]):GoodsRepairPlan{
 const ids=GOODS_RECEIPT_TARGETS.map(row=>row.itemId);
 if(queries.length!==2||new Set(queries.map(row=>row.collection)).size!==2)stop('중량 기준 조회 근거가 없습니다.');
 queries.forEach(query=>{if(!['item_bom','item_pack'].includes(query.collection)||query.field!==(query.collection==='item_bom'?'parent_id':'item_id')||goodsRepairHash(query.ids)!==goodsRepairHash(ids)||!Array.isArray(query.paths)||new Set(query.paths).size!==query.paths.length||query.paths.some(path=>!path.startsWith(query.collection+'/')||path.split('/').length!==2))stop('허용된 중량 기준 조회 범위가 아닙니다.');});
 if(new Set(sources.map(row=>row.path)).size!==sources.length)stop('중복 조회 근거입니다.');
 sources.forEach(row=>{goodsRepairHash(row.data);if(!Number.isSafeInteger(row.version?.seconds)||!Number.isSafeInteger(row.version?.nanoseconds)||row.version.nanoseconds<0||row.version.nanoseconds>=1_000_000_000)stop('문서 버전 근거가 없습니다.');});
 const known=new Set(GOODS_RECEIPT_TARGETS.flatMap(row=>['items/'+row.itemId,'itemReceipts/'+row.receiptId,'purchaseOrders/'+row.poId]));
 queries.forEach(query=>{const actual=sources.filter(row=>row.path.startsWith(query.collection+'/'));if(goodsRepairHash(actual.map(row=>row.path).sort())!==goodsRepairHash(query.paths)||actual.some(row=>!ids.includes(row.data[query.field])||companyOf(row.data)!=='taebaek'))stop('중량 기준 원문이 조회 범위와 다릅니다.');actual.forEach(row=>{known.add(row.path);if(query.collection==='item_bom'){if(typeof row.data.child_id!=='string'||!row.data.child_id||row.data.child_id.includes('/'))stop('중량 기준 자식 품목이 잘못됐습니다.');known.add('items/'+row.data.child_id);}});});
 if(sources.length!==known.size||sources.some(row=>!known.has(row.path)))stop('조회 근거에 확인 대상 밖의 문서가 있습니다.');
 const get=(path:string)=>sources.find(row=>row.path===path)??stop('필수 문서 조회 근거가 없습니다.');
 const catalog=sources.filter(row=>row.path.startsWith('items/')).map(row=>({...row.data,id:row.path.slice(6)}) as Item);
 if(catalog.some(row=>companyOf(row)!=='taebaek'))stop('중량 기준 품목의 회사가 다릅니다.');
 const inputs={bom:buildBomIndex(catalog,sources.filter(row=>row.path.startsWith('item_bom/')).map(row=>row.data) as any),pack:buildPackIndex(sources.filter(row=>row.path.startsWith('item_pack/')).map(row=>row.data) as any)};
 const documents=GOODS_RECEIPT_TARGETS.map(target=>{
  const itemSnap=get('items/'+target.itemId),item={...itemSnap.data,id:target.itemId} as Item;
  const receipt=get('itemReceipts/'+target.receiptId).data,po=get('purchaseOrders/'+target.poId).data;
  if(companyOf(item)!=='taebaek'||item.type!=='goods'||!tracksQuantityLots(item)||item.archived)stop('복원 대상 상품 분류가 변경됐습니다.');
  if(companyOf(receipt)!=='taebaek'||receipt.id!==target.receiptId||receipt.itemId!==target.itemId||receipt.poId!==target.poId||receipt.quantity!==target.quantity||receipt.date!==target.date)stop('원입고 근거가 변경됐습니다.');
  if(companyOf(po)!=='taebaek'||po.status!=='received'||po.poType==='oem'||!receipt.partnerId||receipt.partnerId!==po.partnerId||!receipt.partnerName||typeof receipt.partnerName!=='string')stop('발주 완료·공급자 근거가 변경됐습니다.');
  if('partnerId' in target&&receipt.partnerId!==target.partnerId)stop('확인된 공급자와 다릅니다.');
  const poRows=(Array.isArray(po.items)&&po.items.length?po.items:[po]).filter((row:Row)=>row.itemId===target.itemId);
  if(poRows.length!==1||poRows[0].quantity!==target.quantity)stop('발주 원수량과 원입고가 다릅니다.');
  if(typeof receipt.createdAt!=='string'||!Number.isFinite(Date.parse(receipt.createdAt)))stop('원입고 시각이 없습니다.');
  const lots=item.lots;if(!Array.isArray(lots)||lots.some(lot=>!Number.isFinite(lot.qtyRemaining)))stop('기존 상품 로트 근거가 잘못됐습니다.');
  if(lots.some(lot=>lot.id==='receipt:'+target.receiptId))stop('원입고 로트가 이미 존재합니다.');
  if(!Number.isFinite(item.stock)||Math.round((item.stock-lotQtyRemaining(lots))*1000)/1000!==target.quantity)stop('재고·로트 차이가 확인된 원입고량과 다릅니다.');
  const unitKg=itemKg(item,inputs)||0;if(!Number.isFinite(unitKg)||unitKg<0)stop('기존 공용 중량 기준이 잘못됐습니다.');
  const lot=JSON.parse(JSON.stringify(buildProductLot({material:item.rawMaterialName||item.name,itemId:target.itemId,supplierName:receipt.partnerName,supplierId:receipt.partnerId,qtyIn:target.quantity,unitKg,receivedDate:receipt.date,poId:receipt.poId},{id:'receipt:'+target.receiptId,date:receipt.date,now:receipt.createdAt})));
  const after={...itemSnap.data,lots:[...lots,lot]};
  if(lotQtyRemaining(after.lots)!==item.stock)stop('복원 뒤 로트 합계가 현재고와 다릅니다.');
  return {id:target.itemId,version:itemSnap.version,before:itemSnap.data,after,beforeHash:goodsRepairHash(itemSnap.data),afterHash:goodsRepairHash(after)};
 });
 return {version:1,companyId:'taebaek',sources,queries,documents};
}
export function validateGoodsRepairPlan(plan:GoodsRepairPlan):void{
 if(plan.version!==1||plan.companyId!=='taebaek'||!Array.isArray(plan.sources)||!Array.isArray(plan.queries)||!Array.isArray(plan.documents)||plan.documents.length!==4)stop('복원 백업 범위가 잘못됐습니다.');
 const rebuilt=prepareGoodsReceiptLots(plan.sources,plan.queries);if(goodsRepairHash(rebuilt)!==goodsRepairHash(plan))stop('복원 계획이 최초 조회 원문과 다릅니다.');
}
const snapshot=(snap:any):RepairSnapshot=>{if(!snap.exists||!snap.updateTime)stop('필수 문서가 없습니다.');return {path:snap.ref.path,data:snap.data(),version:{seconds:snap.updateTime.seconds,nanoseconds:snap.updateTime.nanoseconds}};};
async function readSources(store:Firestore):Promise<{sources:RepairSnapshot[];queries:QueryProof[]}>{
 const ids=GOODS_RECEIPT_TARGETS.map(row=>row.itemId),paths=[...new Set(GOODS_RECEIPT_TARGETS.flatMap(row=>['items/'+row.itemId,'itemReceipts/'+row.receiptId,'purchaseOrders/'+row.poId]))];
 const sources=(await store.getAll(...paths.map(path=>store.doc(path)))).map(snapshot);
 const queries:QueryProof[]=[];
 for(const [collection,field] of [['item_bom','parent_id'],['item_pack','item_id']] as const){
  const rows=await store.collection(collection).where(field,'in',ids).get();sources.push(...rows.docs.map(snapshot));queries.push({collection,field,ids:[...ids],paths:rows.docs.map(row=>row.ref.path).sort()});
 }
 const children=[...new Set(sources.filter(row=>row.path.startsWith('item_bom/')).map(row=>row.data.child_id).filter(id=>typeof id==='string'&&!ids.includes(id)))];
 if(children.length)sources.push(...(await store.getAll(...children.map(id=>store.doc('items/'+id)))).map(snapshot));
 return {sources,queries};
}
/** 조회·버전·원입고 대조를 전부 끝낸 다음 네 상품의 lots 필드만 한 거래로 쓴다. */
export async function commitGoodsReceiptLots(store:Firestore,plan:GoodsRepairPlan,mode:'apply'|'undo'):Promise<'applied'|'undone'|'duplicate'>{
 validateGoodsRepairPlan(plan);
 return store.runTransaction(async tx=>{
  const snapshots=await tx.getAll(...plan.sources.map(row=>store.doc(row.path)));
  const current=new Map(snapshots.map(snap=>[snap.ref.path,snapshot(snap)]));
  for(const proof of plan.queries){const rows=await tx.get(store.collection(proof.collection).where(proof.field,'in',proof.ids));if(goodsRepairHash(rows.docs.map(row=>row.ref.path).sort())!==goodsRepairHash(proof.paths))stop('중량 기준 조회 집합이 변경됐습니다.');}
  for(const source of plan.sources){if(plan.documents.some(row=>'items/'+row.id===source.path))continue;const actual=current.get(source.path)!;if(goodsRepairHash(actual.data)!==goodsRepairHash(source.data)||goodsRepairHash(actual.version)!==goodsRepairHash(source.version))stop('원입고·발주·중량 기준의 문서 버전이 변경됐습니다.');}
  const expected=mode==='apply'?'beforeHash':'afterHash',opposite=mode==='apply'?'afterHash':'beforeHash';
  if(plan.documents.every(row=>goodsRepairHash(current.get('items/'+row.id)!.data)===row[opposite]))return 'duplicate';
  for(const row of plan.documents){const actual=current.get('items/'+row.id)!;if(goodsRepairHash(actual.data)!==row[expected]||mode==='apply'&&goodsRepairHash(actual.version)!==goodsRepairHash(row.version))stop('상품의 최초 원문·버전이 바뀌어 쓰지 않았습니다.');}
  for(const row of plan.documents){const actual=current.get('items/'+row.id)!;tx.update(store.doc('items/'+row.id),{lots:(mode==='apply'?row.after:row.before).lots},{lastUpdateTime:new Timestamp(actual.version.seconds,actual.version.nanoseconds)});}
  return mode==='apply'?'applied':'undone';
 });
}
async function main(){
 const args=process.argv.slice(2);if(args.some(arg=>!['--dry','--apply','--undo'].includes(arg))||args.length>1)stop('실행 방식은 dry/apply/undo 중 하나만 지정합니다.');
 if(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST)stop('공식 CLI는 운영 대상이며 에뮬레이터에서 실행하지 않습니다.');
 const mode=args.includes('--undo')?'undo':args.includes('--apply')?'apply':'dry';
 const folder=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),backup=resolve(folder,'goods-receipt-lots-repair-20261012.json'),report=resolve(folder,'goods-receipt-lots-repair-dry-20261012.json');
 const require=createRequire(import.meta.url),auth=require(resolve(process.env.APPDATA??stop('기존 CLI 인증 위치를 확인해 주세요.'),'npm/node_modules/firebase-tools/lib/auth.js'));
 const account=auth.getGlobalDefaultAccount();if(!account?.tokens?.refresh_token)stop('기존 Firebase CLI 인증이 필요합니다.');
 // Admin SDK의 임의 Credential은 Firestore 인증 종류로 지원되지 않는다. 기존 CLI 토큰만 메모리 OAuth에 전달한다.
 const token=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);if(typeof token?.access_token!=='string'||!token.access_token)stop('기존 CLI 인증을 확인하지 못했습니다.');
 const {Firestore:CloudFirestore}=require('@google-cloud/firestore');
 const authClient=createGoodsRepairAuthClient(token.access_token,Number.isFinite(token.expires_at)?token.expires_at:Date.now()+Math.max(1,Number(token.expires_in)||3600)*1000);
 const store:Firestore=new CloudFirestore({projectId:'taebaek-3abe4',authClient});
 try{
  if(mode==='dry'){
   if(existsSync(backup)||existsSync(report))stop('기존 비공개 백업·미리보기는 덮어쓰지 않습니다.');
   const read=await readSources(store),plan=prepareGoodsReceiptLots(read.sources,read.queries);
   writeFileSync(backup,JSON.stringify(encode({version:1,plan,planHash:goodsRepairHash(plan)}),null,2),{flag:'wx'});
   writeFileSync(report,JSON.stringify({mode,companyId:'taebaek',changedFields:['lots'],documents:plan.documents.map(row=>({id:row.id,stock:row.before.stock,beforeLots:lotQtyRemaining(row.before.lots),afterLots:lotQtyRemaining(row.after.lots)})),stockWrites:0,receiptWrites:0,costWrites:0},null,2),{flag:'wx'});
   console.log(JSON.stringify({mode,status:'prepared',documents:4,operatingWrites:0}));
  }else{
   if(!existsSync(backup))stop('먼저 dry로 원문 백업을 준비해 주세요.');
   const saved=decode(JSON.parse(readFileSync(backup,'utf8')));if(saved.version!==1||goodsRepairHash(saved.plan)!==saved.planHash)stop('최초 백업 해시가 다릅니다.');
   const status=await commitGoodsReceiptLots(store,saved.plan,mode);
   const verify=await store.getAll(...saved.plan.documents.map((row:Row)=>store.doc('items/'+row.id)));
   if(verify.some((snap:any,index:number)=>goodsRepairHash(snap.data())!==saved.plan.documents[index][mode==='apply'?'afterHash':'beforeHash']))stop('적용 뒤 상품 원문을 다시 확인해 주세요.');
   console.log(JSON.stringify({mode,status,verified:true,documents:4,changedFields:['lots'],stockWrites:0,receiptWrites:0,costWrites:0}));
  }
 }finally{await store.terminate();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify(safeGoodsRepairFailure(error)));process.exitCode=1;});
