import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {require as loadTs} from 'tsx/cjs/api';
import {cliToken} from './diag-zero-item-price-20261015.mts';
import {decodeRestValue,timestamp} from './prepare-zero-item-price-dry-20261015.mts';
const ROOT='projects/taebaek-3abe4/databases/(default)/documents';
export const SOURCE_MANIFEST=Object.freeze({
 'src/features/admin/financials.ts':'8DFD0C170577114755AD8F33F38FAEF4320A7322D2F4D89F5FD870ED1666C2A8',
 'src/shared/autoJournal.ts':'2E8FFF1A670DE5750C742FCA544367A89EC588550C88AD593FB3304FBDDF5CE3',
 'src/shared/accountChart.ts':'05DD50F0B23488C4D909013709868A677ACEBA665862E30693BE5D72050D4306',
 'src/shared/types.ts':'6511C7EB1081C8FC911600A79201C48A71866DB47652EC8B13B7ED98A8A328E1',
 'src/shared/services/firebaseService.ts':'9442ECE4F3ACF9021826A644526B959BFA933161119CD11642CBB7FD9EBB6AD5',
});
const contexts=['매출','매입','자금','대체'] as const;
const groupTypes=['수익','비용','자산','부채','자본'];
const stages=['source','paths','auth','query','restshape','input','calculation','output'] as const;
class Failure extends Error{constructor(readonly stage:typeof stages[number]){super('계정 읽기 진단 단계 실패');}}
function check(value:unknown):asserts value{if(!value)throw Error('계정 읽기 검증 실패');}
function guard<T>(stage:typeof stages[number],fn:()=>T):T{try{return fn();}catch(error){if(error instanceof Failure)throw error;throw new Failure(stage);}}
async function guardAsync<T>(stage:typeof stages[number],fn:()=>Promise<T>){try{return await fn();}catch(error){if(error instanceof Failure)throw error;throw new Failure(stage);}}
export function failureCode(error:unknown){return {stage:error instanceof Failure&&stages.includes(error.stage)?error.stage:'source',code:'validation-failed'};}
export function verifySources(reader:(path:string)=>Buffer=path=>readFileSync(path)){for(const [path,sha]of Object.entries(SOURCE_MANIFEST))check(createHash('sha256').update(reader(resolve(path))).digest('hex').toUpperCase()===sha);return SOURCE_MANIFEST;}
function helpers(){verifySources();return {...loadTs('../src/features/admin/financials.ts',import.meta.url) as typeof import('../src/features/admin/financials.ts'),companyOf:(loadTs('../src/shared/types.ts',import.meta.url) as typeof import('../src/shared/types.ts')).companyOf};}
export function safe(value:unknown):void{if(value===undefined||value===null)return;if(typeof value==='string'){check(!['__proto__','constructor','prototype'].includes(value));return;}if(typeof value==='number'){check(Number.isFinite(value));return;}if(typeof value==='object')for(const [key,child]of Object.entries(value)){check(!['__proto__','constructor','prototype'].includes(key));safe(child);}}
export type Document={id:string;data:Record<string,any>;original:Record<string,any>};
type Read={documents:Document[];readTimes:string[]};
export function parse(body:unknown,collection:'accountCodes'|'accountGroups'):Read{
 check(Array.isArray(body)&&body.length>0);const documents:Document[]=[],readTimes:string[]=[],seen=new Set<string>();
 for(const [index,row]of body.entries()){
  check(row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).every(key=>['document','readTime','done','skippedResults'].includes(key)));check(row.skippedResults===undefined||row.skippedResults===0);check(row.done===undefined||typeof row.done==='boolean');if(row.done===true)check(index===body.length-1);
  if(row.readTime!==undefined){timestamp(row.readTime);readTimes.push(row.readTime);}
  if(row.document===undefined){check(row.readTime!==undefined||row.done===true);continue;}
  const doc=row.document;safe(doc);check(doc&&typeof doc==='object'&&Object.keys(doc).every(key=>['name','fields','updateTime','createTime'].includes(key)));const prefix=ROOT+'/'+collection+'/';check(typeof doc.name==='string'&&doc.name.startsWith(prefix));const id=doc.name.slice(prefix.length);check(id&&!id.includes('/')&&!seen.has(id));safe(id);seen.add(id);timestamp(doc.updateTime);if(doc.createTime!==undefined)timestamp(doc.createTime);
  const fields=doc.fields??{};check(fields&&typeof fields==='object'&&!Array.isArray(fields));const data=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,decodeRestValue(value)]));safe(data);documents.push({id,data,original:doc});
 }check(readTimes.length>0);return {documents,readTimes:[...new Set(readTimes)]};
}
const projection={accountCodes:['companyId','id','code','name','groupId','noncash'],accountGroups:['companyId','id','type']};
async function query(token:string,collection:'accountCodes'|'accountGroups',id:string|undefined,transport:typeof fetch){
 const response=await transport(`https://firestore.googleapis.com/v1/${ROOT}:runQuery`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId:collection,allDescendants:false}],...(!id?{select:{fields:projection[collection].map(fieldPath=>({fieldPath}))}}:{where:{fieldFilter:{field:{fieldPath:'__name__'},op:'EQUAL',value:{referenceValue:ROOT+'/'+collection+'/'+id}}}})}})});check(response.ok);const body=await guardAsync('restshape',()=>response.json());return guard('restshape',()=>parse(body,collection));
}
export async function readCurrent(token:string,transport:typeof fetch=fetch){
 const accounts=await guardAsync('query',()=>query(token,'accountCodes',undefined,transport)),groups=await guardAsync('query',()=>query(token,'accountGroups',undefined,transport));const originals:Document[]=[],targetReadTimes:string[]=[];
 for(const candidate of accounts.documents.filter(row=>Object.hasOwn(row.data,'noncash'))){const full=await guardAsync('query',()=>query(token,'accountCodes',candidate.id,transport));guard('restshape',()=>{check(full.documents.length===1);const doc=full.documents[0];check(doc.id===candidate.id&&doc.original.updateTime===candidate.original.updateTime&&Object.hasOwn(doc.data,'noncash'));});originals.push(full.documents[0]);targetReadTimes.push(...full.readTimes);}
 return {accounts:accounts.documents,groups:groups.documents,originals,readTimes:{accounts:accounts.readTimes,groups:groups.readTimes,targets:[...new Set(targetReadTimes)]}};
}
export function selectionIndices(input:object[],selected:object[]){const indices=new Map(input.map((row,index)=>[row,index]));check(indices.size===input.length);return selected.map(row=>{check(indices.has(row));return indices.get(row)!;});}
export function classify(accounts:Document[],groups:Document[]){
 const {filterCodesForContext,companyOf}=helpers();const companies:Record<string,Record<string,any>>={};
 for(const company of ['taebaek','punghoe','unknown']){
  const companyKey=(row:Document)=>{const value=companyOf(row.data);return value==='taebaek'||value==='punghoe'?value:'unknown';};const mine=accounts.filter(row=>companyKey(row)===company),myGroups=groups.filter(row=>companyKey(row)===company);
  const flag=mine.filter(row=>Object.hasOwn(row.data,'noncash'));const counts={accounts:mine.length,groups:myGroups.length,targets:flag.length,flagTrue:flag.filter(row=>row.data.noncash===true).length,flagFalse:flag.filter(row=>row.data.noncash===false).length,flagOther:flag.filter(row=>typeof row.data.noncash!=='boolean').length,legacyCompanyDefault:mine.filter(row=>row.data.companyId==null).length,accountStoredIdMismatch:0,groupStoredIdMismatch:0,invalidAccountShape:0,invalidGroupShape:0,missingGroupReference:0,missingGroupAssignment:0,unknownGroupType:0,groupTypeMissing:0,equivalentContexts:0,notEvaluated:company==='unknown'};
  for(const row of mine){const data=row.data;if(data.id!==undefined&&data.id!==row.id)counts.accountStoredIdMismatch++;if(data.id!==undefined&&typeof data.id!=='string'||typeof data.code!=='string'||typeof data.name!=='string'||data.groupId!==undefined&&typeof data.groupId!=='string')counts.invalidAccountShape++;if(!data.groupId)counts.missingGroupAssignment++;else if(!myGroups.some(group=>(group.data.id??group.id)===data.groupId))counts.missingGroupReference++;}
  for(const row of myGroups){const data=row.data;if(data.id!==undefined&&data.id!==row.id)counts.groupStoredIdMismatch++;if(data.id!==undefined&&typeof data.id!=='string'||data.type!==undefined&&typeof data.type!=='string')counts.invalidGroupShape++;if(data.type===undefined||data.type==='')counts.groupTypeMissing++;else if(!groupTypes.includes(data.type))counts.unknownGroupType++;}
  if(counts.invalidAccountShape||counts.invalidGroupShape||company==='unknown')counts.notEvaluated=true;
  const contextResults:Record<string,boolean>={};
  if(!counts.notEvaluated){const before:Record<string,any>[]=mine.map(row=>({id:row.id,...row.data})),after=before.map(({noncash:_removed,...rest})=>rest),groupInput=myGroups.map(row=>({id:row.id,...row.data}));for(const context of contexts){const selectedBefore=selectionIndices(before,filterCodesForContext(before as any,groupInput as any,context)),selectedAfter=selectionIndices(after,filterCodesForContext(after as any,groupInput as any,context));check(JSON.stringify(selectedBefore)===JSON.stringify(selectedAfter));contextResults[context]=true;counts.equivalentContexts++;}}
  companies[company]={...counts,contextResults};
 }
 return {readOnly:true,deletionReady:false,atomicSnapshot:false,scope:'실제 filterCodesForContext 네 문맥의 실제 reader 입력의 전체 계정 선택 정체성과 순서를 원본 행 인덱스로 메모리에서 비교한다. 그룹 누락·미지정은 원함수 동작을 유지하고 별도로 표시한다. noncashApplication은 다른 현행 기능이며 조사하지 않는다. 계정 저장 경계 변경과 운영 필드 삭제 승인이 아니다.',companies};
}
export function selfCheck(){const sourceManifest=verifySources(),{filterCodesForContext}=helpers();const codes=[{id:'x',code:'900',name:'합성',noncash:true},{id:'cash',code:'102',name:'합성'}];assert.deepEqual(filterCodesForContext(codes as any,[],'대체').map(row=>row.id),['x']);assert.deepEqual(filterCodesForContext(codes as any,[],'자금').map(row=>row.id),['cash','x']);return {selfCheck:'passed',productionRead:false,productionOutputWritten:false,sourceManifest,nodeVersion:process.version};}
export function paths(args:string[],exists:(path:string)=>boolean=existsSync){check(resolve('.')===resolve(fileURLToPath(new URL('../',import.meta.url))));check(args.length===1&&args[0]==='--auth=firebase-cli');const output=resolve('../account-noncash-equivalence-readonly-v2-20261015.json'),originals=resolve('work/account-noncash-originals-v2-20261015.json');check(!exists(output)&&!exists(originals));return {output,originals};}
export async function run(args:string[],dependencies:{token:typeof cliToken;read:typeof readCurrent;paths:typeof paths;source?:typeof selfCheck}={token:cliToken,read:readCurrent,paths}){
 const source=guard('source',dependencies.source??selfCheck),outputs=guard('paths',()=>dependencies.paths(args)),token=await guardAsync('auth',()=>dependencies.token()),read=await guardAsync('query',()=>dependencies.read(token)),result=guard('calculation',()=>classify(read.accounts,read.groups));
 const publicText=JSON.stringify({...result,sourceManifest:source.sourceManifest,moduleSelfCheck:source.selfCheck,nodeVersion:source.nodeVersion,readTimes:read.readTimes},null,2),backup=JSON.stringify({readOnly:true,atomicSnapshot:false,documents:read.originals.map(doc=>doc.original),readTimes:read.readTimes},null,2);
 guard('output',()=>{let written=false;try{writeFileSync(outputs.originals,backup,{flag:'wx'});written=true;writeFileSync(outputs.output,publicText,{flag:'wx'});}catch(error){if(written&&readFileSync(outputs.originals,'utf8')===backup)unlinkSync(outputs.originals);throw error;}});return {readOnly:true,deletionReady:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(process.argv.slice(2).join(' ')==='--self-check'?selfCheck():await run(process.argv.slice(2))));}catch(error){console.error(JSON.stringify({failed:true,...failureCode(error)}));process.exitCode=1;}}
