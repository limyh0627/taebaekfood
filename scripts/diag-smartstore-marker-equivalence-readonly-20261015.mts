import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {require as loadTs} from 'tsx/cjs/api';
import {cliToken} from './diag-zero-item-price-20261015.mts';
import {decodeRestValue,timestamp} from './prepare-zero-item-price-dry-20261015.mts';
const ROOT='projects/taebaek-3abe4/databases/(default)/documents';
export const SOURCE_MANIFEST=Object.freeze({'src/shared/partnerPrice.ts':'A71961E61D416701E6CA191DB4AF54800F100DBEA3C71DCFD3E52C4F1BAF6F82','src/shared/types.ts':'6511C7EB1081C8FC911600A79201C48A71866DB47652EC8B13B7ED98A8A328E1'});
const stages=['source','paths','auth','query','restshape','classification','comparison','output'] as const;
class Failure extends Error{constructor(readonly stage:typeof stages[number]){super('표식 읽기 진단 단계 실패');}}
function check(value:unknown):asserts value{if(!value)throw Error('표식 읽기 검증 실패');}
function guard<T>(stage:typeof stages[number],fn:()=>T):T{try{return fn();}catch(error){if(error instanceof Failure)throw error;throw new Failure(stage);}}
async function guardAsync<T>(stage:typeof stages[number],fn:()=>Promise<T>){try{return await fn();}catch(error){if(error instanceof Failure)throw error;throw new Failure(stage);}}
export function failureCode(error:unknown){return {stage:error instanceof Failure&&stages.includes(error.stage)?error.stage:'source',code:'validation-failed'};}
export function verifySources(reader:(path:string)=>Buffer=path=>readFileSync(path)){for(const [path,sha]of Object.entries(SOURCE_MANIFEST))check(createHash('sha256').update(reader(resolve(path))).digest('hex').toUpperCase()===sha);return SOURCE_MANIFEST;}
function helpers(){verifySources();return {isSmartStoreItem:(loadTs('../src/shared/partnerPrice.ts',import.meta.url) as typeof import('../src/shared/partnerPrice.ts')).isSmartStoreItem,companyOf:(loadTs('../src/shared/types.ts',import.meta.url) as typeof import('../src/shared/types.ts')).companyOf};}
export function safe(value:unknown):void{if(value===null||value===undefined)return;if(typeof value==='string'){check(!['__proto__','prototype','constructor'].includes(value));return;}if(typeof value==='number'){check(Number.isFinite(value));return;}if(typeof value==='object')for(const [key,child]of Object.entries(value)){check(!['__proto__','prototype','constructor'].includes(key));safe(child);}}
export type Document={id:string;data:Record<string,any>;original:Record<string,any>};
type Read={documents:Document[];readTimes:string[]};
export function parse(body:unknown):Read{
 check(Array.isArray(body)&&body.length>0);const documents:Document[]=[],readTimes:string[]=[],seen=new Set<string>();
 for(const [index,row]of body.entries()){
  check(row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).every(key=>['document','readTime','done','skippedResults'].includes(key)));check(row.skippedResults===undefined||row.skippedResults===0);check(row.done===undefined||typeof row.done==='boolean');if(row.done===true)check(index===body.length-1);
  if(row.readTime!==undefined){timestamp(row.readTime);readTimes.push(row.readTime);}
  if(row.document===undefined){check(row.readTime!==undefined||row.done===true);continue;}
  const doc=row.document;safe(doc);check(doc&&typeof doc==='object'&&Object.keys(doc).every(key=>['name','fields','updateTime','createTime'].includes(key)));const prefix=ROOT+'/items/';check(typeof doc.name==='string'&&doc.name.startsWith(prefix));const id=doc.name.slice(prefix.length);check(id&&!id.includes('/')&&!seen.has(id));safe(id);seen.add(id);timestamp(doc.updateTime);if(doc.createTime!==undefined)timestamp(doc.createTime);
  const fields=doc.fields??{};check(fields&&typeof fields==='object'&&!Array.isArray(fields));const data=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,decodeRestValue(value)]));safe(data);documents.push({id,data,original:doc});
 }check(readTimes.length>0);return {documents,readTimes:[...new Set(readTimes)]};
}
export function itemCategory(data:Record<string,any>){
 const {companyOf}=helpers(),companyValue=companyOf(data),company=companyValue==='taebaek'||companyValue==='punghoe'?companyValue:'unknown';
 const arrayValid=Array.isArray(data.partnerIds)&&data.partnerIds.every((id:unknown)=>typeof id==='string'),arrayAbsent=!Object.hasOwn(data,'partnerIds'),marker=arrayValid&&data.partnerIds.includes('SMARTSTORE');
 const ownFlag=Object.hasOwn(data,'isSmartStore'),flag=!ownFlag?'missing':data.isSmartStore===true?'true':data.isSmartStore===false?'false':data.isSmartStore===null?'null':'other';
 const archive=data.archived===true?'archived':data.archived===false||!Object.hasOwn(data,'archived')?'active':'unknown';
 return {company,arrayValid,arrayAbsent,marker,flag,archive,product:data.type==='product',candidate:marker&&!ownFlag&&company!=='unknown'&&data.type==='product'&&archive==='active'};
}
export function compareCandidate(data:Record<string,any>){
 check(itemCategory(data).candidate);safe(data);const {isSmartStoreItem}=helpers(),before=JSON.stringify(data),after:Record<string,any>={...data,isSmartStore:true},afterWithout={...after} as Record<string,any>;delete afterWithout.isSmartStore;
 check(isSmartStoreItem(data)===isSmartStoreItem(after));check(after.partnerIds===data.partnerIds&&JSON.stringify(after.partnerIds)===JSON.stringify(data.partnerIds));check(JSON.stringify(afterWithout)===before&&JSON.stringify(data)===before);return {equivalent:true,arrayOrderPreserved:true,otherFieldsPreserved:true};
}
export function classify(documents:Document[]){
 const companies:Record<string,Record<string,number>>={};for(const co of ['taebaek','punghoe','unknown'])companies[co]={documents:0,arrayAbsent:0,arrayMalformed:0,markers:0,flagMissing:0,flagTrue:0,flagFalseConflict:0,flagNull:0,flagOther:0,nonProduct:0,archived:0,archiveUnknown:0,candidates:0,equivalentCandidates:0};
 for(const doc of documents){const category=itemCategory(doc.data),counts=companies[category.company];counts.documents++;if(category.arrayAbsent)counts.arrayAbsent++;else if(!category.arrayValid)counts.arrayMalformed++;if(!category.marker)continue;counts.markers++;const field={missing:'flagMissing',true:'flagTrue',false:'flagFalseConflict',null:'flagNull',other:'flagOther'}[category.flag];counts[field]++;if(!category.product)counts.nonProduct++;if(category.archive==='archived')counts.archived++;if(category.archive==='unknown')counts.archiveUnknown++;if(category.candidate){counts.candidates++;compareCandidate(doc.data);counts.equivalentCandidates++;}}
 return {readOnly:true,deletionReady:false,atomicSnapshot:false,scope:'후보는 정확한 문자열 표식·명시 flag 없음·현재 제품·정상 비보관 자료로 제한한다. 보류 분류는 운영 정책 확정이 아니며 일부 집계는 중복된다. 후보 after는 isSmartStore true 한 필드 추가뿐이다. partnerIds 원문·순서와 다른 필드를 보존하며 판매 관계를 조회하거나 생성하지 않는다. 호환 reader 제거와 partnerIds 삭제의 승인이 아니다.',companies};
}
async function query(token:string,id:string|undefined,transport:typeof fetch){
 const response=await transport(`https://firestore.googleapis.com/v1/${ROOT}:runQuery`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId:'items',allDescendants:false}],...(!id?{select:{fields:['companyId','type','partnerIds','isSmartStore','archived'].map(fieldPath=>({fieldPath}))}}:{where:{fieldFilter:{field:{fieldPath:'__name__'},op:'EQUAL',value:{referenceValue:ROOT+'/items/'+id}}}})}})});check(response.ok);const body=await guardAsync('restshape',()=>response.json());return guard('restshape',()=>parse(body));
}
export async function readCurrent(token:string,transport:typeof fetch=fetch){
 const projection=await guardAsync('query',()=>query(token,undefined,transport)),originals:Document[]=[],candidateReadTimes:string[]=[];
 for(const candidate of projection.documents.filter(doc=>itemCategory(doc.data).candidate)){const full=await guardAsync('query',()=>query(token,candidate.id,transport));guard('restshape',()=>{check(full.documents.length===1);const doc=full.documents[0];check(doc.id===candidate.id&&doc.original.updateTime===candidate.original.updateTime&&itemCategory(doc.data).candidate);compareCandidate(doc.data);});originals.push(full.documents[0]);candidateReadTimes.push(...full.readTimes);}
 return {documents:projection.documents,originals,readTimes:{projection:projection.readTimes,candidates:[...new Set(candidateReadTimes)]}};
}
export function selfCheck(){const sourceManifest=verifySources(),{isSmartStoreItem}=helpers();assert.equal(isSmartStoreItem({partnerIds:['SMARTSTORE']}),true);assert.equal(isSmartStoreItem({isSmartStore:false,partnerIds:['SMARTSTORE']}),true);assert.equal(isSmartStoreItem({isSmartStore:false}),false);compareCandidate({type:'product',partnerIds:['synthetic','SMARTSTORE']});return {selfCheck:'passed',productionRead:false,productionOutputWritten:false,sourceManifest,nodeVersion:process.version};}
export function paths(args:string[],exists:(path:string)=>boolean=existsSync){check(resolve('.')===resolve(fileURLToPath(new URL('../',import.meta.url))));check(args.length===1&&args[0]==='--auth=firebase-cli');const output=resolve('../smartstore-marker-equivalence-readonly-20261015.json'),originals=resolve('work/smartstore-marker-originals-20261015.json');check(!exists(output)&&!exists(originals));return {output,originals};}
export async function run(args:string[],dependencies:{source?:typeof selfCheck;token:typeof cliToken;read:typeof readCurrent;paths:typeof paths}={token:cliToken,read:readCurrent,paths}){
 const source=guard('source',dependencies.source??selfCheck),outputs=guard('paths',()=>dependencies.paths(args)),token=await guardAsync('auth',()=>dependencies.token()),read=await guardAsync('query',()=>dependencies.read(token)),result=guard('classification',()=>classify(read.documents));
 const text=JSON.stringify({...result,sourceManifest:source.sourceManifest,moduleSelfCheck:source.selfCheck,nodeVersion:source.nodeVersion,readTimes:read.readTimes},null,2),backup=JSON.stringify({readOnly:true,atomicSnapshot:false,documents:read.originals.map(doc=>doc.original),readTimes:read.readTimes},null,2);
 guard('output',()=>{let written=false;try{writeFileSync(outputs.originals,backup,{flag:'wx'});written=true;writeFileSync(outputs.output,text,{flag:'wx'});}catch(error){if(written&&readFileSync(outputs.originals,'utf8')===backup)unlinkSync(outputs.originals);throw error;}});return {readOnly:true,deletionReady:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(process.argv.slice(2).join(' ')==='--self-check'?selfCheck():await run(process.argv.slice(2))));}catch(error){console.error(JSON.stringify({failed:true,...failureCode(error)}));process.exitCode=1;}}
