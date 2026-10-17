// 운영 적용은 최초 백업·현재 CLI 주체·검증한 배포 metadata를 모두 대조한 정확 한 건만 허용한다.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {Timestamp,type Firestore,type DocumentSnapshot,type Transaction} from 'firebase-admin/firestore';
import {require as tsxRequire} from 'tsx/cjs/api';
import {createGoodsRepairAuthClient,safeGoodsRepairFailure} from './fix-goods-receipt-lots-20261012.mts';
const corePath=resolve(dirname(fileURLToPath(import.meta.url)),'../functions/src/deleteIssuedStatementCommand.ts');
const loadedCoreHash=createHash('sha256').update(readFileSync(corePath)).digest('hex').toUpperCase();
const core:typeof import('../functions/src/deleteIssuedStatementCommand')=tsxRequire('../functions/src/deleteIssuedStatementCommand.ts',import.meta.url);
const {activeAdvanceApplications}:typeof import('../functions/src/shared/partnerAdvance')=tsxRequire('../functions/src/shared/partnerAdvance.ts',import.meta.url);
export const ILPUM={companyId:'taebaek',statementId:'stmt-open-c-misu-1785823904191-1-매출',partnerId:'c-misu-1785823904191-1',docNo:'기초260731-54',tradeDate:'2026-07-31',amount:102000} as const;
const targetPath='issuedStatements/'+ILPUM.statementId,statePath=`appMeta/partnerPaymentState_${ILPUM.companyId}_${ILPUM.partnerId}`,gatePath='appMeta/releaseCutover';
type Row=Record<string,any>;
export type NativeVersion={seconds:number;nanoseconds:number}|null;
export type OpeningSnapshot={path:string;data:Row|null;version:NativeVersion};
export interface OpeningDeletePlan {version:1;projectId:'taebaek-3abe4';actorId:string;target:OpeningSnapshot;state:OpeningSnapshot;gate:OpeningSnapshot;input:Parameters<typeof core.deleteIssuedStatement>[3];backupHash:string}
export class OpeningDeleteError extends Error {}
function stop(message:string):never{throw new OpeningDeleteError(message);}
/** 나노초와 배열 순서까지 보존한다. 비공개 백업을 JSON 일반 객체로 축약하지 않는다. */
export function encodeOpening(value:any):any {if(value instanceof Date)return {$date:value.toISOString()};if(value&&typeof value.toMillis==='function'&&typeof value.seconds==='number')return {$timestamp:[value.seconds,value.nanoseconds]};if(Array.isArray(value))return value.map(encodeOpening);return value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,encodeOpening(value[k])])):value;}
export function decodeOpening(value:any):any {if(value?.$timestamp&&Object.keys(value).length===1)return new Timestamp(...value.$timestamp as [number,number]);if(value?.$date&&Object.keys(value).length===1)return new Date(value.$date);if(Array.isArray(value))return value.map(decodeOpening);return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decodeOpening(v)])):value;}
export const openingHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(encodeOpening(value))).digest('hex');
const snapshot=(snap:DocumentSnapshot):OpeningSnapshot=>({path:snap.ref.path,data:snap.exists?snap.data()!:null,version:snap.updateTime?{seconds:snap.updateTime.seconds,nanoseconds:snap.updateTime.nanoseconds}:null});
export function assertIlpumOpening(row:Row|null){
 if(!row||row.companyId!==ILPUM.companyId||row.partnerId!==ILPUM.partnerId||row.docNo!==ILPUM.docNo||row.tradeDate!==ILPUM.tradeDate||row.type!=='비용'||row.totalAmount!==ILPUM.amount||row.totalSupply!==ILPUM.amount||row.totalTax!==0)stop('승인한 일품 기초 미수금 한 건과 원문이 다릅니다.');
 if(!Array.isArray(row.items)||row.items.length!==2||row.items.some((line:Row,index:number)=>line.accountCode!==['108','375'][index]||line.side!==['차변','대변'][index]||line.qty!==1||line.price!==ILPUM.amount||line.supply!==ILPUM.amount||line.tax!==0||line.total!==ILPUM.amount||line.isTaxExempt!==true))stop('기초 전표의 차대 계정과 금액이 승인 범위와 다릅니다.');
 if(row.noncashApplication||core.statementSourceIds(row,'orders').length||core.statementSourceIds(row,'purchaseOrders').length)stop('주문·발주·선수 적용 연결이 있어 이 삭제 준비로 처리하지 않습니다.');
}
export function prepareOpeningDelete(target:OpeningSnapshot,state:OpeningSnapshot,gate:OpeningSnapshot,actorId:string):OpeningDeletePlan{
 if(target.path!==targetPath||state.path!==statePath||gate.path!==gatePath||!target.version||!gate.version||!/^cli-ilpum-[a-f0-9]{24}$/.test(actorId))stop('대상 경로·원문 버전·CLI 주체를 확인하지 못했습니다.');assertIlpumOpening(target.data);
 if(gate.data?.status!=='active'||typeof gate.data.releaseId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(gate.data.releaseId))stop('기존 전표 삭제 프로토콜이 활성화되지 않았습니다.');
 if(state.data&&(state.data.companyId!==ILPUM.companyId||state.data.partnerId!==ILPUM.partnerId||!Number.isSafeInteger(state.data.revision)||state.data.revision<0))stop('거래처 정산 상태가 다릅니다.');
 const revision=target.data!.mutationRevision??0;if(!Number.isSafeInteger(revision)||revision<0)stop('전표 수정 버전이 잘못되었습니다.');
 const input={operationId:'repair-ilpum-'+openingHash([actorId,target,gate.data.releaseId]).slice(0,32),statementId:ILPUM.statementId,releaseId:gate.data.releaseId,expectedRevision:revision,expectedOriginalHash:core.statementOriginalHash(target.data!)};
 const base={version:1 as const,projectId:'taebaek-3abe4' as const,actorId,target,state,gate,input};return {...base,backupHash:openingHash(base)};
}
export function validateOpeningPlan(plan:OpeningDeletePlan){const {backupHash,...base}=plan;if(backupHash!==openingHash(base))stop('최초 백업 원문 해시가 다릅니다.');const expected=prepareOpeningDelete(plan.target,plan.state,plan.gate,plan.actorId);if(openingHash(expected)!==openingHash(plan))stop('고정 삭제 입력과 최초 원문이 다릅니다.');}
async function assertNoLinks(db:Firestore,tx?:Transaction){
 const read=(query:FirebaseFirestore.Query)=>tx?tx.get(query):query.get();
 for(const [collection,field]of [['orders','linkedStatementId'],['purchaseOrders','linkedStatementId'],['settlements','statementId']] as const){const rows=await read(db.collection(collection).where(field,'==',ILPUM.statementId));if(!rows.empty)stop('현재 연결 문서가 있어 삭제하지 않습니다.');}
 // 반품과 직접 지급은 원 삭제 core가 지우지 않는 역참조이므로 회사·대상 한 건만 별도 확인한다.
 for(const [collection,field]of [['returnRequests','sourceStatementId'],['returnApplications','statementId'],['issuedStatements','reverseOfStatementId'],['cashEntries','linkedAccrualStatementId']] as const){const rows=await read(db.collection(collection).where('companyId','==',ILPUM.companyId).where(field,'==',ILPUM.statementId));if(!rows.empty)stop('반품·역전표·직접 지급 연결이 있어 삭제하지 않습니다.');}
 const candidates=await read(db.collection('issuedStatements').where('partnerId','==',ILPUM.partnerId));
 const applications=activeAdvanceApplications(candidates.docs.map(doc=>({...doc.data(),id:doc.id})) as any,ILPUM.companyId,ILPUM.partnerId);
 if(applications.some(row=>row.noncashApplication.kind==='advance-application'&&row.noncashApplication.allocations.some(a=>a.statementId===ILPUM.statementId||a.source.collection==='issuedStatements'&&a.source.id===ILPUM.statementId)))stop('기초 미수금에 연결된 선수 적용이 있어 삭제하지 않습니다.');
}
export async function readOpeningDeletePlan(db:Firestore,actorId:string){
 const rows=await db.getAll(db.doc(targetPath),db.doc(statePath),db.doc(gatePath));const plan=prepareOpeningDelete(snapshot(rows[0]),snapshot(rows[1]),snapshot(rows[2]),actorId);await assertNoLinks(db);const prior=await db.doc('voucherMutationOperations/'+plan.input.operationId).get();if(prior.exists)stop('같은 삭제 작업의 감사가 이미 있습니다. 최초 백업으로만 확인해 주세요.');return plan;
}
export const ILPUM_CORE_SHA='8BDA9976A19C405CAEC260EFBEE7DAD6B8F24D266E72362BA936FD3D6F5E90CA';
const functionName='projects/taebaek-3abe4/locations/asia-northeast3/functions/deleteIssuedStatementCommand';
const approvedDeployment={name:functionName,state:'ACTIVE',runtime:'nodejs22',updatedAt:'2026-10-17T18:35:24.390166394Z',source:{storageSource:{bucket:'gcf-v2-sources-426912093935-asia-northeast3',object:'deleteIssuedStatementCommand/function-source.zip',generation:'1792262116399389'}}};
export function validateOpeningDeploymentEvidence(plan:OpeningDeletePlan,actorId:string,evidence:Row,fresh:Row,localCoreHash:string,now=Date.now()){
 validateOpeningPlan(plan);
 if(actorId!==plan.actorId)stop('현재 CLI 인증 주체와 최초 백업 주체가 다릅니다.');
 if(localCoreHash!==ILPUM_CORE_SHA)stop('실행할 원자 삭제 core가 배포 검증 원문과 다릅니다.');
 const checkedAt=Date.parse(evidence?.checkedAt);if(!Number.isFinite(checkedAt)||checkedAt>now+300000||!Array.isArray(evidence.functions))stop('원격 배포 대조 증거의 확인 시각을 확인해 주세요.');
 const matches=evidence.functions.filter((row:Row)=>row.name===functionName);if(matches.length!==1||openingHash(matches[0])!==openingHash(approvedDeployment)||openingHash(fresh)!==openingHash(approvedDeployment))stop('활성 함수의 런타임·갱신시각·소스 generation이 검증한 배포와 다릅니다.');
 return {functionName,sourceGeneration:approvedDeployment.source.storageSource.generation,backupHash:plan.backupHash,actorId};
}
const productionContexts=new WeakMap<object,{store:Firestore;backupHash:string;checkedAt:number}>();
function prepareProductionContext(store:Firestore,plan:OpeningDeletePlan,actorId:string,evidence:Row,fresh:Row){
 if(loadedCoreHash!==ILPUM_CORE_SHA)stop('로딩된 원자 삭제 core가 검증 원문과 다릅니다.');
 validateOpeningDeploymentEvidence(plan,actorId,evidence,fresh,createHash('sha256').update(readFileSync(corePath)).digest('hex').toUpperCase());
 const context=Object.freeze({kind:'ilpum-opening-delete'});productionContexts.set(context,{store,backupHash:plan.backupHash,checkedAt:Date.now()});return context;
}
export function assertOpeningWrite(method:string,path:string,data:Row|undefined,plan:OpeningDeletePlan){
 const allowed=method==='delete'&&path===targetPath||method==='update'&&path===statePath&&openingHash(data)===openingHash({revision:(plan.state.data?.revision??0)+1})||method==='create'&&path===statePath&&openingHash(data)===openingHash({companyId:ILPUM.companyId,partnerId:ILPUM.partnerId,revision:1})||method==='create'&&path==='voucherMutationOperations/'+plan.input.operationId&&data?.status==='applied'&&data.companyId===ILPUM.companyId&&data.voucherId===ILPUM.statementId&&data.createdBy===plan.actorId&&data.beforeHash===plan.input.expectedOriginalHash&&openingHash(data.command)===openingHash(plan.input);
 if(!allowed)stop('승인된 전표·정산 revision·삭제 감사 외 쓰기는 허용하지 않습니다.');
}
/** 실제 SDK Transaction에 원문·버전 재검사와 세 경로 쓰기 봉쇄를 씌우고 기존 core만 실행한다. */
export async function commitOpeningDelete(db:Firestore,plan:OpeningDeletePlan,productionContext?:object):Promise<{status:string;id:string}>{
 validateOpeningPlan(plan);
 const emulator=['127.0.0.1:8082','127.0.0.1:8182'].includes(process.env.FIRESTORE_EMULATOR_HOST??'');
 const projectId=(db as Firestore & {projectId:string}).projectId,proof=productionContext?productionContexts.get(productionContext):undefined;
 const productionAllowed=!process.env.FIRESTORE_EMULATOR_HOST&&!process.env.FIREBASE_AUTH_EMULATOR_HOST&&projectId==='taebaek-3abe4'&&proof?.store===db&&proof.backupHash===plan.backupHash&&Date.now()>=proof.checkedAt&&Date.now()-proof.checkedAt<60000&&loadedCoreHash===ILPUM_CORE_SHA&&createHash('sha256').update(readFileSync(corePath)).digest('hex').toUpperCase()===ILPUM_CORE_SHA;
 if(!(emulator&&projectId.startsWith('demo-'))&&!productionAllowed)stop('운영 적용은 최초 백업·현재 CLI 주체·배포 metadata를 대조한 전용 실행 context가 필요합니다. 승인 대기 상태에서 임의 호출할 수 없습니다.');
 const receiptPath='voucherMutationOperations/'+plan.input.operationId;
 const wrapped=new Proxy(db,{get(store,key){if(key!=='runTransaction'){const value=Reflect.get(store,key,store);return typeof value==='function'?value.bind(store):value;}return (callback:(tx:Transaction)=>Promise<unknown>,options?:unknown)=>store.runTransaction(async tx=>{
  const [target,state,gate,prior]=await tx.getAll(store.doc(targetPath),store.doc(statePath),store.doc(gatePath),store.doc(receiptPath));
  if(prior.exists){const receipt=prior.data()!;if(target.exists||receipt.status!=='applied'||receipt.companyId!==ILPUM.companyId||receipt.createdBy!==plan.actorId||receipt.voucherId!==ILPUM.statementId||receipt.beforeHash!==plan.input.expectedOriginalHash||openingHash(receipt.command)!==openingHash(plan.input))stop('기존 삭제 감사와 최초 요청이 다릅니다.');}
  else{for(const [actual,expected]of [[target,plan.target],[state,plan.state],[gate,plan.gate]] as const)if(openingHash(snapshot(actual))!==openingHash(expected))stop('원문 또는 나노초 버전이 변경되어 삭제하지 않았습니다.');assertIlpumOpening(target.data()!);await assertNoLinks(store,tx);}
  const guarded=new Proxy(tx,{get(transaction,method){if(!['create','set','update','delete'].includes(String(method))){const value=Reflect.get(transaction,method,transaction);return typeof value==='function'?value.bind(transaction):value;}return (ref:FirebaseFirestore.DocumentReference,data?:Row,...rest:unknown[])=>{
   const path=ref.path;
   assertOpeningWrite(String(method),path,data,plan);
   return (transaction[method as 'create'] as Function).call(transaction,ref,...(method==='delete'?rest:[data,...rest]));
  };}});return callback(guarded);
 },options as any);}});
 return core.deleteIssuedStatement(wrapped,ILPUM.companyId,plan.actorId,plan.input);
}
export function openingUndoPlan(plan:OpeningDeletePlan){validateOpeningPlan(plan);return {mode:'undo',operatingWrites:0,restorable:false,reason:'삭제 감사와 원문 백업은 있지만 공식 원자 복구 명령이 없습니다. 임의 setDoc 복원은 차대·정산·감사 연결을 되살리지 못하므로 실행하지 않습니다.',statementId:ILPUM.statementId,backupHash:plan.backupHash};}
async function main(){
 const args=process.argv.slice(2);if(args.length>1||args.some(arg=>!['--dry','--apply','--undo'].includes(arg)))stop('dry/apply/undo 중 하나만 지정합니다.');const mode=args[0]??'--dry';
 const folder=resolve(dirname(fileURLToPath(import.meta.url)),'../work'),backup=resolve(folder,'ilpum-opening-delete-20261018.backup.json');

 if(mode==='--undo'){if(!existsSync(backup))stop('최초 백업이 없어 복구 계획도 확인할 수 없습니다.');console.log(JSON.stringify(openingUndoPlan(decodeOpening(JSON.parse(readFileSync(backup,'utf8'))))));return;}
 if(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST)stop('운영 dry는 에뮬레이터에서 실행하지 않습니다.');if(mode==='--dry'&&existsSync(backup))stop('기존 최초 백업을 덮어쓰지 않습니다.');
 const require=createRequire(import.meta.url),auth=require(resolve(process.env.APPDATA??stop('기존 CLI 인증 경로가 없습니다.'),'npm/node_modules/firebase-tools/lib/auth.js')),account=auth.getGlobalDefaultAccount();if(!account?.tokens?.refresh_token||typeof account.user?.email!=='string')stop('기존 CLI 인증 주체를 확인해 주세요.');
 const token=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);if(typeof token?.access_token!=='string'||!token.access_token)stop('기존 CLI 인증을 확인하지 못했습니다.');
 const {Firestore:CloudFirestore}=require('@google-cloud/firestore'),store:Firestore=new CloudFirestore({projectId:'taebaek-3abe4',authClient:createGoodsRepairAuthClient(token.access_token,Number.isFinite(token.expires_at)?token.expires_at:Date.now()+Math.max(1,Number(token.expires_in)||3600)*1000)});
 try{
  const actorId='cli-ilpum-'+openingHash(account.user.email.trim().toLowerCase()).slice(0,24);
  if(mode==='--dry'){
   const plan=await readOpeningDeletePlan(store,actorId);writeFileSync(backup,JSON.stringify(encodeOpening(plan),null,2),{flag:'wx'});console.log(JSON.stringify({mode:'dry',status:'prepared',statementId:ILPUM.statementId,amount:ILPUM.amount,operatingWrites:0,undoExecutable:false}));
  }else{
   if(!existsSync(backup))stop('최초 백업 없이는 적용할 수 없습니다. 새 작업번호를 만들지 않습니다.');
   const plan=decodeOpening(JSON.parse(readFileSync(backup,'utf8'))) as OpeningDeletePlan;validateOpeningPlan(plan);if(actorId!==plan.actorId)stop('현재 CLI 인증 주체와 최초 백업 주체가 다릅니다.');
   const evidencePath=resolve(dirname(fileURLToPath(import.meta.url)),'../records/raw-output-release-verification-20261018.json');
   if(!existsSync(evidencePath))stop('배포 원격 대조 증거가 없습니다.');const evidence=JSON.parse(readFileSync(evidencePath,'utf8'));
   const response=await fetch('https://cloudfunctions.googleapis.com/v2/'+functionName,{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});if(!response.ok)stop('활성 함수 metadata를 다시 확인하지 못했습니다.');const metadata=await response.json() as Row;
   const fresh={name:metadata.name,state:metadata.state,runtime:metadata.buildConfig?.runtime,updatedAt:metadata.updateTime,source:metadata.buildConfig?.source};
   const context=prepareProductionContext(store,plan,actorId,evidence,fresh),result=await commitOpeningDelete(store,plan,context);
   console.log(JSON.stringify({mode:'apply',status:result.status,statementId:ILPUM.statementId,operationId:plan.input.operationId,amount:ILPUM.amount,undoExecutable:false}));
  }
 }finally{await store.terminate();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify(error instanceof OpeningDeleteError?{message:error.message}:safeGoodsRepairFailure(error)));process.exitCode=1;});
