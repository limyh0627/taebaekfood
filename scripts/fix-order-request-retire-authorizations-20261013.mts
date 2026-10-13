// 이전 수동 unknown 해제의 exact3 원문만 서버 승인으로 옮긴다. 운영 실행은 총괄 검수 후 한다.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Timestamp} from 'firebase-admin/firestore';
import {TARGETS,validateLockOrder,assessLockEvidence} from './fix-order-nested-array-locks-20261012.mts';
import {createGoodsRepairAuthClient,goodsRepairHash} from './fix-goods-receipt-lots-20261012.mts';
import {rawPressText} from '../src/shared/rawPressAttempt.ts';
import {assertArchiveOldGenerationAbsent} from '../functions/src/shared/orderRawBatchOrderEvidence.ts';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const encode=(v:any):any=>v instanceof Timestamp?{_lockTimestamp:[v.seconds,v.nanoseconds]}:Array.isArray(v)?v.map(encode):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)])):v;
const decode=(v:any):any=>Array.isArray(v)?v.map(decode):v&&typeof v==='object'?('_lockTimestamp' in v?new Timestamp(...v._lockTimestamp):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)]))):v;
const stop=(message:string):never=>{throw Error(message);};
export class RetirementSafetyError extends Error {
 reasonCode:string;phase:string;targetIndex?:number;
 constructor(reasonCode:string,phase:string,targetIndex?:number){super('최초 요청 퇴역 승인 안전 조건을 확인해 주세요.');this.reasonCode=reasonCode;this.phase=phase;this.targetIndex=targetIndex;}
}
/** 공개 진단에는 원문·UID·서버 응답을 포함하지 않는다. */
export function retirementSafetyDiagnostic(error:unknown,phase:string){
 return error instanceof RetirementSafetyError?{phase:error.phase,reasonCode:error.reasonCode,...(error.targetIndex===undefined?{}:{targetIndex:error.targetIndex}),operatingWrites:0}
  :{phase,reasonCode:'UNCLASSIFIED_FAILURE',operatingWrites:0};
}
export async function inspectRetirementAuthorizationSources(db:any,plan:any){
 const before=[];
 for(const [index,row]of plan.authorizations.entries()){
  let order:any,a:any,t:any;
  try{[order,a,t]=await Promise.all([db.doc(row.orderPath).get(),db.doc(row.path).get(),db.doc(row.terminalPath).get()]);}
  catch{throw new RetirementSafetyError('SOURCE_READ_FAILED','current-source-read',index);}
  const fail=(code:string):never=>{throw new RetirementSafetyError(code,'current-source-compare',index);};
  if(a.exists)fail('AUTHORIZATION_ALREADY_EXISTS');if(t.exists)fail('TERMINAL_ALREADY_EXISTS');if(!order.exists)fail('ORDER_MISSING');
  if(rawPressText(order.data())!==row.data.expectedOrderText)fail('ORDER_TEXT_CHANGED');
  if(order.updateTime?.seconds!==row.data.expectedOrderVersion.seconds||order.updateTime?.nanoseconds!==row.data.expectedOrderVersion.nanoseconds)fail('ORDER_VERSION_CHANGED');
  before.push({path:row.path,exists:false,terminalPath:row.terminalPath,terminalExists:false});
 }
 return before;
}
export async function diagnoseRetirementCurrentSources(db:any,plan:any){
 const safeFields=new Set(['companyId','status','items','inventoryOperation','inventoryGenerationCompletion','inventoryWriterProtocolVersion','inventoryWriteRevision','retirementId','retirementClaimPending','producedAt','shippedOut','rawConsumedLots','itemInventory','inventorySnapshots','rawInventoryAttempt','productionRecordIndex','memo','deliveryDate','updatedAt','createdAt']);
 const targets=[];
 for(const [targetIndex,row]of plan.authorizations.entries()){
  try{
   const [order,authorization,terminal]=await Promise.all([db.doc(row.orderPath).get(),db.doc(row.path).get(),db.doc(row.terminalPath).get()]);
   const live=order.data(),expected=JSON.parse(row.data.expectedOrderText);
   const changedFields=[...new Set([...Object.keys(expected),...Object.keys(live??{})].filter(key=>rawPressText({value:expected[key]})!==rawPressText({value:live?.[key]})).map(key=>safeFields.has(key)?key:'otherFields'))].sort();
   const operation=live?.inventoryOperation;
   const effects:Record<string,number>={};
   for(const [collection,field]of [['rawInventoryJobs','source.id'],['rawMaterialLedger','source.id'],['rawMaterialLedger','orderId'],['productionRecords','orderId'],['orderStatusAudits','orderId']]){
    effects[collection+':'+field]=(await db.collection(collection).where(field,'==',row.data.orderId).get()).size;
   }
   targets.push({targetIndex,reasonCode:!order.exists?'ORDER_MISSING':rawPressText(live)!==row.data.expectedOrderText?'ORDER_TEXT_CHANGED':order.updateTime?.seconds!==row.data.expectedOrderVersion.seconds||order.updateTime?.nanoseconds!==row.data.expectedOrderVersion.nanoseconds?'ORDER_VERSION_CHANGED':authorization.exists?'AUTHORIZATION_ALREADY_EXISTS':terminal.exists?'TERMINAL_ALREADY_EXISTS':'MATCHED',changedFields,
    statusMatches:live?.status===expected.status,operationStageMatches:operation?.stage===expected.inventoryOperation?.stage,clearedLockMatches:operation==null&&expected.inventoryOperation==null,actorGenerationMatches:operation?.id===row.data.operationId&&operation?.startedAt===row.data.startedAt&&operation?.actorUid===row.data.actorUid,
    orderVersionMatches:order.updateTime?.seconds===row.data.expectedOrderVersion.seconds&&order.updateTime?.nanoseconds===row.data.expectedOrderVersion.nanoseconds,authorizationExists:authorization.exists,terminalExists:terminal.exists,effects});
  }catch{targets.push({targetIndex,reasonCode:'SOURCE_READ_FAILED'});}
 }
 return {phase:'current-source-diagnostic',operatingWrites:0,targets};
}
let diagnosticPhase='arguments';
export function prepareRetirementAuthorizations(saved:any,applied:any){
 if(!saved?.plan||goodsRepairHash(saved.plan)!==saved.hash||saved.plan.reason!=='manual-user-authorized'||saved.plan.inventoryApplied!=='unknown'||saved.plan.orders?.length!==3||applied?.orders?.length!==3||!['applied','duplicate'].includes(applied.status))stop('정확한 수동 해제 백업·적용 영수증이 필요합니다.');
 assessLockEvidence(saved.plan.evidence);
 const authorizations=saved.plan.orders.map((row:any,index:number)=>{
  const after=validateLockOrder(row,index),proof=applied.orders[index],target=TARGETS[index],operation=row.data.inventoryOperation;
  if(goodsRepairHash(after)!==goodsRepairHash(row.after)||proof.path!==row.path||proof.path!=='orders/'+target.id||goodsRepairHash(proof.data)!==goodsRepairHash(after)||!Number.isSafeInteger(proof.version?.seconds)||!Number.isSafeInteger(proof.version?.nanoseconds)||proof.version.nanoseconds<0||proof.version.nanoseconds>=1e9||typeof operation.actorUid!=='string'||!operation.actorUid.trim())stop('수동 해제 최초 세대·UID·적용 버전이 다릅니다.');
  const generation={companyId:'taebaek',orderId:target.id,operationId:target.op,startedAt:target.at,actorUid:operation.actorUid},id=hash(rawPressText(generation)),expectedOrderText=rawPressText(after);
  return {path:'orderRequestRetirementAuthorizations/'+id,terminalPath:'orderRequestRetirements/'+id,orderPath:proof.path,data:{version:1,status:'authorized',reason:'manual-user-authorized',inventoryApplied:'unknown',...generation,backupHash:saved.hash,expectedOrderText,expectedOrderHash:hash(expectedOrderText),expectedOrderVersion:proof.version},order:proof};
 });
 return {version:1,reason:'manual-user-authorized',inventoryApplied:'unknown',sourceBackupHash:saved.hash,authorizations};
}
/** 옛 해제 증거는 그대로 묶고 현재 세대는 새 read-only 명세로 별도 고정한다. */
export async function prepareCurrentRetirementAuthorizations(db:any,sourcePlan:any){
 const authorizations=[];
 for(const [index,row]of sourcePlan.authorizations.entries()){
  const order=await db.doc(row.orderPath).get();if(!order.exists||order.data().companyId!==row.data.companyId)throw new RetirementSafetyError('ORDER_COMPANY_OR_EXISTENCE_CHANGED','current-plan',index);
  const queries=[],evidence=new Map<string,any>();
  for(const [collection,field]of [['rawInventoryJobs','source.id'],['rawMaterialLedger','source.id'],['rawMaterialLedger','orderId'],['productionRecords','orderId'],['orderStatusAudits','orderId']]){
   const snapshots=await db.collection(collection).where(field,'==',row.data.orderId).get(),paths=snapshots.docs.map((snapshot:any)=>snapshot.ref.path).sort();queries.push({collection,field,paths});
   for(const snapshot of snapshots.docs){if((snapshot.data().companyId??'taebaek')!==row.data.companyId)throw new RetirementSafetyError('EVIDENCE_COMPANY_CHANGED','current-plan',index);const text=rawPressText(snapshot.data());evidence.set(snapshot.ref.path,{path:snapshot.ref.path,text,hash:hash(text),version:{seconds:snapshot.updateTime.seconds,nanoseconds:snapshot.updateTime.nanoseconds}});}
  }
  const currentOrderText=rawPressText(order.data()),currentOrderVersion={seconds:order.updateTime.seconds,nanoseconds:order.updateTime.nanoseconds};
  const unclaimed=currentOrderText===row.data.expectedOrderText&&rawPressText(currentOrderVersion)===rawPressText(row.data.expectedOrderVersion)&&evidence.size===0;
  authorizations.push({...row,order:{path:row.orderPath,data:order.data(),version:currentOrderVersion},data:{...row.data,revision:1,mode:unclaimed?'unclaimed-after-unlock':'archive-only-current-evidence',currentOrderText,currentOrderHash:hash(currentOrderText),currentOrderVersion,currentEvidence:[...evidence.values()].sort((a,b)=>a.path.localeCompare(b.path)),currentQueries:queries}});
 }
 return {...sourcePlan,authorizations};
}
export async function applyRetirementAuthorizations(db:any,plan:any,mode:'apply'|'undo'){
 if(plan?.version!==1||plan.reason!=='manual-user-authorized'||plan.inventoryApplied!=='unknown'||plan.authorizations?.length!==3)stop('퇴역 승인 계획 범위가 다릅니다.');
 return db.runTransaction(async(tx:any)=>{
  const rows=await Promise.all(plan.authorizations.map(async(row:any,index:number)=>{
   const target=TARGETS[index],d=row.data;
   const current=d.mode!==undefined,orderText=current?d.currentOrderText:d.expectedOrderText,orderVersion=current?d.currentOrderVersion:d.expectedOrderVersion;
   if(d.orderId!==target.id||d.operationId!==target.op||d.startedAt!==target.at||d.companyId!=='taebaek'||d.inventoryApplied!=='unknown'||d.reason!=='manual-user-authorized'||d.status!=='authorized'||d.version!==1||!d.actorUid||d.backupHash!==plan.sourceBackupHash||d.expectedOrderHash!==hash(d.expectedOrderText)||rawPressText(row.order.data)!==orderText||row.orderPath!==row.order.path||row.orderPath!=='orders/'+target.id||rawPressText(orderVersion)!==rawPressText(row.order.version)||current&&(!Number.isSafeInteger(d.revision)||d.revision<1||!['unclaimed-after-unlock','archive-only-current-evidence'].includes(d.mode)||hash(orderText)!==d.currentOrderHash||!Array.isArray(d.currentQueries)||d.currentQueries.length!==5||!Array.isArray(d.currentEvidence)))stop('승인 계획의 원문과 세대가 다릅니다.');
   const id=hash(rawPressText({companyId:d.companyId,orderId:d.orderId,operationId:d.operationId,startedAt:d.startedAt,actorUid:d.actorUid}));
   if(row.path!=='orderRequestRetirementAuthorizations/'+id||row.terminalPath!=='orderRequestRetirements/'+id)stop('승인 문서 범위가 다릅니다.');
   const [order,authorization,terminal]=await Promise.all([tx.get(db.doc(row.orderPath)),tx.get(db.doc(row.path)),tx.get(db.doc(row.terminalPath))]);
   if(terminal.exists)stop('이미 최초 요청을 보관한 승인은 원복하지 않습니다.');
   if(d.mode==='archive-only-current-evidence'){
    if(!order.exists||order.data().companyId!==d.companyId)stop('현재 주문의 회사가 다릅니다.');
    assertArchiveOldGenerationAbsent(order.data(),d);
   }else if(!order.exists||rawPressText(order.data())!==orderText||order.updateTime?.seconds!==orderVersion.seconds||order.updateTime?.nanoseconds!==orderVersion.nanoseconds)stop('수동 해제 뒤 주문 원문·버전이 바뀌었습니다.');
   if(current&&d.mode!=='archive-only-current-evidence'){
    const expectedPaths=new Set<string>();
    const roles=[['rawInventoryJobs','source.id'],['rawMaterialLedger','source.id'],['rawMaterialLedger','orderId'],['productionRecords','orderId'],['orderStatusAudits','orderId']];
    for(const [queryIndex,[collection,field]]of roles.entries()){
     const query=d.currentQueries[queryIndex];if(query.collection!==collection||query.field!==field)stop('현재 효과 조회 명세가 다릅니다.');
     const snapshots=await tx.get(db.collection(collection).where(field,'==',d.orderId)),paths=snapshots.docs.map((snapshot:any)=>snapshot.ref.path).sort();
     if(rawPressText(paths)!==rawPressText(query.paths))stop('현재 효과 조회 집합이 바뀌었습니다.');paths.forEach((path:string)=>expectedPaths.add(path));
    }
    if(expectedPaths.size!==d.currentEvidence.length||d.mode==='unclaimed-after-unlock'&&expectedPaths.size>0)stop('현재 효과 원문 명세가 다릅니다.');
    for(const evidence of d.currentEvidence){if(!expectedPaths.delete(evidence.path)||hash(evidence.text)!==evidence.hash)stop('현재 효과 원문 해시가 다릅니다.');const snapshot=await tx.get(db.doc(evidence.path));if(!snapshot.exists||rawPressText(snapshot.data())!==evidence.text||snapshot.updateTime?.seconds!==evidence.version.seconds||snapshot.updateTime?.nanoseconds!==evidence.version.nanoseconds)stop('현재 효과 원문·버전이 바뀌었습니다.');}
   }
   if(authorization.exists&&rawPressText(authorization.data())!==rawPressText(d))stop('다른 승인 기록을 덮어쓰지 않습니다.');
   return {row,authorization};
  }));
  for(const {row,authorization} of rows)if(mode==='apply'){if(!authorization.exists)tx.create(db.doc(row.path),row.data);}else if(authorization.exists)tx.delete(db.doc(row.path));
  return {status:rows.every(row=>mode==='apply'?row.authorization.exists:!row.authorization.exists)?'duplicate':mode==='apply'?'applied':'undone',inventoryApplied:'unknown',orderWrites:0,stockWrites:0};
 });
}
async function main(){
 const args=process.argv.slice(2);if(args.length>1||args.some(arg=>!['--dry','--apply','--undo'].includes(arg)))stop('dry/apply/undo 중 하나만 지정해 주세요.');
 if(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST)stop('운영 CLI의 에뮬레이터 환경을 해제해 주세요.');
 const mode=args.includes('--apply')?'apply':args.includes('--undo')?'undo':'dry',folder=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
 const backup=resolve(folder,'order-request-retire-authorizations-backup-20261013.json'),proof=resolve(folder,'order-request-retire-authorizations-applied-20261013.json');
 diagnosticPhase='source-files-read';
 const source=decode(JSON.parse(readFileSync(resolve(folder,'order-nested-array-locks-backup-20261012.json'),'utf8'))),applied=decode(JSON.parse(readFileSync(resolve(folder,'order-nested-array-locks-applied-20261012.json'),'utf8')));
 diagnosticPhase='source-plan';const sourcePlan=prepareRetirementAuthorizations(source,applied);
 diagnosticPhase='authentication';
 const require=createRequire(import.meta.url),auth=require(resolve(process.env.APPDATA!,'npm/node_modules/firebase-tools/lib/auth.js')),account=auth.getGlobalDefaultAccount(),token=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
 const {Firestore}=require('@google-cloud/firestore'),db=new Firestore({projectId:'taebaek-3abe4',authClient:createGoodsRepairAuthClient(token.access_token,Date.now()+3500000)});
 try{
  if(mode==='dry'){
   if(existsSync(backup)||existsSync(proof))stop('기존 비공개 승인 백업을 덮어쓰지 않습니다.');
   diagnosticPhase='current-source-read';console.log(JSON.stringify(await diagnoseRetirementCurrentSources(db,sourcePlan)));
   const currentPlan=await prepareCurrentRetirementAuthorizations(db,sourcePlan);
   const before=await inspectRetirementAuthorizationSources(db,{...currentPlan,authorizations:currentPlan.authorizations.map((row:any)=>({...row,data:{...row.data,expectedOrderText:row.data.currentOrderText,expectedOrderVersion:row.data.currentOrderVersion}}))});
   diagnosticPhase='local-backup-write';
   writeFileSync(backup,JSON.stringify(encode({plan:currentPlan,hash:goodsRepairHash(currentPlan),before}),null,2),{flag:'wx'});console.log(JSON.stringify({mode,status:'prepared',authorizations:3,modes:currentPlan.authorizations.map((row:any)=>row.data.mode),operatingWrites:0,inventoryApplied:'unknown'}));
  }else{
   if(!existsSync(backup))stop('승인 원문 백업이 없습니다.');const saved=decode(JSON.parse(readFileSync(backup,'utf8')));
   if(goodsRepairHash(saved.plan)!==saved.hash||saved.plan.sourceBackupHash!==sourcePlan.sourceBackupHash||saved.plan.authorizations.length!==3||saved.plan.authorizations.some((row:any,index:number)=>Object.keys(sourcePlan.authorizations[index].data).some(key=>rawPressText({value:row.data[key]})!==rawPressText({value:sourcePlan.authorizations[index].data[key]}))))stop('승인 백업이 수동 해제 원문과 다릅니다.');
   if(mode==='undo'&&!existsSync(proof))stop('승인 적용 영수증이 없습니다.');
   const result=await applyRetirementAuthorizations(db,saved.plan,mode);
   const after=await Promise.all(saved.plan.authorizations.map(async(row:any)=>{const s=await db.doc(row.path).get();if(mode==='apply'?(!s.exists||rawPressText(s.data())!==rawPressText(row.data)):s.exists)stop('적용 후 승인 재조회가 다릅니다.');return {path:row.path,exists:s.exists,version:s.updateTime?{seconds:s.updateTime.seconds,nanoseconds:s.updateTime.nanoseconds}:null};}));
   if(mode==='apply'&&!existsSync(proof))writeFileSync(proof,JSON.stringify({result,after},null,2),{flag:'wx'});console.log(JSON.stringify({mode,...result,verified:true,authorizations:3}));
  }
 }finally{await db.terminate();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({message:'최초 요청 퇴역 승인 준비·적용 중단. 비공개 백업·원문·버전을 확인하세요.',...retirementSafetyDiagnostic(error,diagnosticPhase)}));process.exitCode=1;});
