import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {require as loadTs} from 'tsx/cjs/api';
import {cliToken} from './diag-zero-item-price-20261015.mts';
import {decodeRestValue,timestamp} from './prepare-zero-item-price-dry-20261015.mts';
export const SOURCE_MANIFEST=Object.freeze({
 'functions/src/shared/rawInventoryCore.ts':'424FB40B47BF7C03E9BFB1375B0B14D01F56519D29FCEA15629B6EF34CF65CBD',
 'functions/src/shared/rawInventoryDocument.ts':'90C7853D143340BE5B4C7843A77FA2335E82DC3F32560C237BAA5DB2D83631CF',
 'src/shared/unpackLots.ts':'38E039EB37948E1E150DFDF93A032621BE9C2DB7E80D6901FA2142162F0B59ED',
 'src/shared/lotUtils.ts':'FE4A4DC862DDC8A7EAE0E7A7C11BE9A8530914D5F5464FF0215556E06FDCF167',
 'functions/src/shared/productLot.ts':'282460C39E20595EC47053BC24FE3F9C62EF58795D8D32859AD702532C2E3FBA',
 'functions/src/shared/rawLot.ts':'3C635419351BA2DB33D3B2A4C2F9053C1F4F5D891A40A923953182B520B09DF0',
 'src/shared/day.ts':'1F99CDD8F50906F7B165D505DD8C2BF53826B62F05E4052890B3E30227A671EB',
 'functions/src/shared/stockUnitMeasure.ts':'C85A01020E673B740242CC14B758E6747D92B499A8E33E6DEBF4222A4067E651',
 'functions/src/shared/calculation.ts':'70DAEF46F158D42658B9906BD6BD6F959C0B86DE6D02960544A415E6719C9794',
 'functions/src/shared/formula.ts':'8DB011CD4A22E2EF4A1F4D0F5CA4882D419588048DCD5D926703E026ECC9090A',
});
export function verifySources(reader:(path:string)=>Buffer=path=>readFileSync(path)){
 for(const [path,sha]of Object.entries(SOURCE_MANIFEST))check(createHash('sha256').update(reader(resolve(path))).digest('hex').toUpperCase()===sha);
 return SOURCE_MANIFEST;
}
function helpers(){
 verifySources();
 return {...loadTs('../functions/src/shared/rawInventoryCore.ts',import.meta.url) as typeof import('../functions/src/shared/rawInventoryCore.ts'),...loadTs('../functions/src/shared/rawInventoryDocument.ts',import.meta.url) as typeof import('../functions/src/shared/rawInventoryDocument.ts'),...loadTs('../src/shared/unpackLots.ts',import.meta.url) as typeof import('../src/shared/unpackLots.ts')};
}
const ROOT='projects/taebaek-3abe4/databases/(default)/documents';
type Row=Record<string,any>;
type Document={id:string;data:Row;original:Row};
type Read={documents:Document[];readTimes:string[]};
const stages=['source','paths','auth','projection','target-query','state-query','restshape','input','calculation','output'] as const;
class Failure extends Error{constructor(readonly stage:typeof stages[number]){super('원문 값을 포함하지 않는 진단 실패');}}
function check(value:unknown):asserts value{if(!value)throw Error('읽기 진단 검증 실패');}
function guard<T>(stage:typeof stages[number],fn:()=>T):T{try{return fn();}catch(error){if(error instanceof Failure)throw error;throw new Failure(stage);}}
async function guardAsync<T>(stage:typeof stages[number],fn:()=>Promise<T>):Promise<T>{try{return await fn();}catch(error){if(error instanceof Failure)throw error;throw new Failure(stage);}}
export function failureCode(error:unknown){return {stage:error instanceof Failure&&stages.includes(error.stage)?error.stage:'source',code:'validation-failed'};}
export function safe(value:unknown):void{if(value===null||value===undefined)return;if(typeof value==='string'){check(!['__proto__','constructor','prototype'].includes(value));return;}if(typeof value==='number'){check(Number.isFinite(value));return;}if(typeof value==='object')for(const [key,child]of Object.entries(value)){check(!['__proto__','constructor','prototype'].includes(key));safe(child);}}
export function parse(body:unknown,collection:'items'|'rawInventories'):Read{
 check(Array.isArray(body)&&body.length>0);const documents:Document[]=[],readTimes:string[]=[],seen=new Set<string>();
 for(const [index,row]of body.entries()){
  check(row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).every(key=>['document','readTime','done','skippedResults'].includes(key)));check(row.skippedResults===undefined||row.skippedResults===0);check(row.done===undefined||typeof row.done==='boolean');if(row.done===true)check(index===body.length-1);
  if(row.readTime!==undefined){timestamp(row.readTime);readTimes.push(row.readTime);}
  if(row.document===undefined){check(row.readTime!==undefined||row.done===true);continue;}
  const doc=row.document;safe(doc);check(doc&&typeof doc==='object'&&Object.keys(doc).every(key=>['name','fields','updateTime','createTime'].includes(key)));const prefix=ROOT+'/'+collection+'/';check(typeof doc.name==='string'&&doc.name.startsWith(prefix));const id=doc.name.slice(prefix.length);check(id&&!id.includes('/')&&!seen.has(id));safe(id);seen.add(id);timestamp(doc.updateTime);if(doc.createTime!==undefined)timestamp(doc.createTime);
  const fields=doc.fields??{};check(fields&&typeof fields==='object'&&!Array.isArray(fields));const data=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,decodeRestValue(value)]));safe(data);documents.push({id,data,original:doc});
 }check(readTimes.length>0);return {documents,readTimes:[...new Set(readTimes)]};
}
type Transport=typeof fetch;
async function query(token:string,collection:'items'|'rawInventories',projection:boolean,id:string|undefined,transport:Transport):Promise<Read>{
 const response=await transport(`https://firestore.googleapis.com/v1/${ROOT}:runQuery`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId:collection,allDescendants:false}],...(projection?{select:{fields:[{fieldPath:'companyId'},{fieldPath:'lotsAreTotal'}]}}:{}),...(id?{where:{fieldFilter:{field:{fieldPath:'__name__'},op:'EQUAL',value:{referenceValue:ROOT+'/'+collection+'/'+id}}}}:{})}})});check(response.ok);const body=await guardAsync('restshape',()=>response.json());return guard('restshape',()=>parse(body,collection));
}
export type Target={item:Document;state:Document|null;itemReadTimes:string[];stateReadTimes:string[]};
export async function readTargets(token:string,transport:Transport=fetch){
 const {inventoryDocId}=helpers();
 const projection=await guardAsync('projection',()=>query(token,'items',true,undefined,transport));const targets:Target[]=[];
 for(const candidate of projection.documents.filter(doc=>Object.hasOwn(doc.data,'lotsAreTotal'))){
  const full=await guardAsync('target-query',()=>query(token,'items',false,candidate.id,transport));const item=guard('target-query',()=>{check(full.documents.length===1);const doc=full.documents[0];check(doc.id===candidate.id&&doc.original.updateTime===candidate.original.updateTime&&Object.hasOwn(doc.data,'lotsAreTotal'));return doc;});
  const company=item.data.companyId??'taebaek';let state:Read={documents:[],readTimes:[]};
  if(company==='taebaek'||company==='punghoe'){const id=inventoryDocId(company,item.id);state=await guardAsync('state-query',()=>query(token,'rawInventories',false,id,transport));guard('state-query',()=>{check(state.documents.length<=1);check(!state.documents[0]||state.documents[0].id===id);});}
  targets.push({item,state:state.documents[0]??null,itemReadTimes:full.readTimes,stateReadTimes:state.readTimes});
 }return {targets,projectionReadTimes:projection.readTimes};
}
export function selfCheck(){const sourceManifest=verifySources();const {inventoryDocId,canStockAfter,bulkStockAfter,rawMirrorMatches,normalizeRawInventoryState}=helpers();assert.equal(inventoryDocId('taebaek','synthetic'),'taebaek__synthetic');assert.equal(canStockAfter([{status:'active',qtyRemaining:2,kgRemaining:10,unitKg:5} as any]),2);assert.equal(bulkStockAfter([{status:'active',kgRemaining:10} as any]),10);assert.equal(rawMirrorMatches(1.0001,1),true);assert.equal(normalizeRawInventoryState({stockKg:1,activeLots:[]}).stockKg,1);return {selfCheck:'passed',productionRead:false,productionOutputWritten:false,sourceManifest,nodeVersion:process.version};}
function validLots(lots:unknown):lots is any[]{return Array.isArray(lots)&&lots.every(lot=>lot&&typeof lot==='object'&&!Array.isArray(lot)&&['active','depleted'].includes(lot.status)&&(lot.status!=='active'||typeof lot.kgRemaining==='number'&&Number.isFinite(lot.kgRemaining))&&(lot.qtyRemaining===undefined||typeof lot.qtyRemaining==='number'&&Number.isFinite(lot.qtyRemaining)));}
export function classify(targets:Target[]){
 const {inventoryDocId,canStockAfter,bulkStockAfter,normalizeRawInventoryState}=helpers();
 const companies:Record<string,Record<string,number>>={};for(const co of ['taebaek','punghoe','unknown'])companies[co]={targets:0,flagTrue:0,flagFalse:0,flagOther:0,missingState:0,invalidItem:0,invalidState:0,companyMismatch:0,itemLinkMismatch:0,unitAmbiguous:0,notEvaluated:0,helperInputEquivalent:0,helperResultEquivalent:0,quantityFieldMissing:0,normalizationDefaultsObserved:0};
 for(const target of targets){
  const item=target.item.data,co=item.companyId??'taebaek',counts=companies[co==='taebaek'||co==='punghoe'?co:'unknown'];counts.targets++;counts[item.lotsAreTotal===true?'flagTrue':item.lotsAreTotal===false?'flagFalse':'flagOther']++;
  if(!['taebaek','punghoe'].includes(co)){counts.companyMismatch++;counts.notEvaluated++;continue;}
  if(!validLots(item.lots)||typeof item.stock!=='number'||!Number.isFinite(item.stock)){counts.invalidItem++;counts.notEvaluated++;continue;}
  const {lotsAreTotal:_removed,...after}=item;check(JSON.stringify(item.lots)===JSON.stringify(after.lots));counts.helperInputEquivalent++;
  const qtyBefore=canStockAfter(item.lots),qtyAfter=canStockAfter(after.lots),kgBefore=bulkStockAfter(item.lots),kgAfter=bulkStockAfter(after.lots);check([qtyBefore,qtyAfter,kgBefore,kgAfter].every(Number.isFinite));check(qtyBefore===qtyAfter&&kgBefore===kgAfter);counts.helperResultEquivalent++;
  if(item.lots.some((lot:any)=>lot.qtyRemaining===undefined))counts.quantityFieldMissing++;
  if(!target.state){counts.missingState++;counts.notEvaluated++;continue;}
  const raw=target.state.data;
  if(raw.companyId!==co){counts.companyMismatch++;counts.notEvaluated++;continue;}
  if(raw.rawItemId!==target.item.id||target.state.id!==inventoryDocId(co,target.item.id)){counts.itemLinkMismatch++;counts.notEvaluated++;continue;}
  if(typeof raw.stockKg!=='number'||!Number.isFinite(raw.stockKg)||!validLots(raw.activeLots)||raw.recentDepletedLots!==undefined&&!validLots(raw.recentDepletedLots)||[raw.revision,raw.version].some(value=>value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)))){counts.invalidState++;counts.notEvaluated++;continue;}
  const normalized=normalizeRawInventoryState(raw),normalizedAfter=normalizeRawInventoryState(raw);check(JSON.stringify(normalized)===JSON.stringify(normalizedAfter));
  if(raw.revision===undefined||raw.recentDepletedLots===undefined||raw.id===undefined)counts.normalizationDefaultsObserved++;
  // 동일 숫자라도 포장수량과 kg의 동치나 실제 mirror 경로를 증명하지 않는다.
  counts.unitAmbiguous++;counts.notEvaluated++;
 }
 return {readOnly:true,deletionReady:false,atomicSnapshot:false,scope:'현재 flag 존재 대상만 조사한다. helper는 flag를 입력받지 않아 제거 전후 실제 입력 lots와 상태 원문은 같다. 수량 계산과 kg 계산을 서로 또는 stock과 자동 비교하지 않는다. 실제 벌크 mirror 경로 근거가 없어 stock과 state.stockKg의 수치 비교도 실행하지 않는다. 상태 존재·품목 이름·표시 단위만으로 단위를 확정하지 않는다. 옛 fix-lot-to-ledger reader는 남아 있다.',companies};
}
export function paths(args:string[],exists:(path:string)=>boolean=existsSync){check(resolve('.')===resolve(fileURLToPath(new URL('../',import.meta.url))));check(args.length===1&&args[0]==='--auth=firebase-cli');const output=resolve('../lots-total-equivalence-readonly-20261015.json'),originals=resolve('work/lots-total-originals-20261015.json');check(!exists(output)&&!exists(originals));return {output,originals};}
export async function run(args:string[],dependencies:{token:typeof cliToken;read:typeof readTargets;paths:typeof paths;source?:typeof selfCheck}={token:cliToken,read:readTargets,paths}){
 const source=guard('source',dependencies.source??selfCheck);const outputs=guard('paths',()=>dependencies.paths(args)),token=await guardAsync('auth',()=>dependencies.token()),read=await dependencies.read(token),result=guard('calculation',()=>classify(read.targets));
 const publicText=JSON.stringify({...result,sourceManifest:source.sourceManifest,moduleSelfCheck:source.selfCheck,nodeVersion:source.nodeVersion,readTimes:{projection:read.projectionReadTimes,items:[...new Set(read.targets.flatMap(row=>row.itemReadTimes))],states:[...new Set(read.targets.flatMap(row=>row.stateReadTimes))]}},null,2);
 const originals=JSON.stringify({readOnly:true,atomicSnapshot:false,projectionReadTimes:read.projectionReadTimes,targets:read.targets.map(target=>({item:target.item.original,state:target.state?.original??null,itemReadTimes:target.itemReadTimes,stateReadTimes:target.stateReadTimes}))},null,2);
 guard('output',()=>{let written=false;try{writeFileSync(outputs.originals,originals,{flag:'wx'});written=true;writeFileSync(outputs.output,publicText,{flag:'wx'});}catch(error){if(written&&readFileSync(outputs.originals,'utf8')===originals)unlinkSync(outputs.originals);throw error;}});return {readOnly:true,deletionReady:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(process.argv.slice(2).join(' ')==='--self-check'?selfCheck():await run(process.argv.slice(2))));}catch(error){console.error(JSON.stringify({failed:true,...failureCode(error)}));process.exitCode=1;}}
