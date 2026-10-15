import {isDeepStrictEqual} from 'node:util';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {require as loadTs} from 'tsx/cjs/api';
import {cliToken} from './diag-zero-item-price-20261015.mts';
import {decodeRestValue,timestamp} from './prepare-zero-item-price-dry-20261015.mts';
import {hash,encode} from './shared/zeroItemPriceBackup.ts';
import type {Input} from './shared/deulgireum3Plan.ts';
const ROOT='projects/taebaek-3abe4/databases/(default)/documents';
export const COLLECTIONS=['items','productionSalesLogs','item_bom','item_formula'] as const;
export const SOURCE_MANIFEST:Readonly<Record<string,string>>=Object.freeze({
  "scripts/shared/deulgireum3Plan.ts": "E7C9F032D7EE5C5745927DB704C4AB2A8BA009B8E6D239D587427194038C9F9E",
  "scripts/diag-zero-item-price-20261015.mts": "CD4DF28228563932DAADEAF973EEB648F1F716FE112E91C47C4A0B7CE2A37AB2",
  "scripts/prepare-zero-item-price-dry-20261015.mts": "DA4245008D1CDF72F75218ED13B864EE113CD369E23C79180598DF62AC764A86",
  "scripts/shared/zeroItemPriceBackup.ts": "0F1F9A8EC366444E7F6D3D8D83CBCB1F30024C698BF2851FD6A55ED28BF8F4DE",
  "scripts/shared/zeroItemPriceMigration.ts": "86507F891DDABAA5126B2AC3F7EBEE9AB1360E90FEF14181E71C1CFC0FAEDCAA",
  "src/shared/bomCost.ts": "EB98804D128BF3E80E6E25BC495E84B714542C3BD4BAD90E8C715ED6BE0B610A",
  "src/features/admin/bom.ts": "2BD4A166B21E85BE270F0ECF50DB750264492DC940E24359B903F90A6945AA20",
  "src/shared/bom.ts": "4AAA57FD072609F1EC6CF397338330E5BC00EB99D2BD7E9964A8E6000FDA1A0B",
  "src/shared/docName.ts": "09FEB5E1B8C43D26F1E82ABCA98FD8765FDACE9EC0073185CE1EB221F06603EB",
  "src/shared/docOil.ts": "1B60507B40EDBF51AB006FBE80F15DFE9F5F10A183D15CF25160F143413BEDED",
  "src/constants/formula.ts": "1FF98A5B1403AD775092E94F9E79E8B19C49C6DD1ED4443723D98020D07A23AE",
  "functions/src/shared/formula.ts": "8DB011CD4A22E2EF4A1F4D0F5CA4882D419588048DCD5D926703E026ECC9090A",
  "src/shared/orderUnits.ts": "FCCC4398377B66D82802765A610F3CE863171E5A35F0940DE8C41CEE7EF1D148",
  "src/shared/bomIndex.ts": "18F22E1199679E2F1289E84CB603FC302F8F7EC09223EE65DBCD301FCC2A3091",
  "src/shared/packIndex.ts": "CB308CD8985631DD7AE39E3DB62F5BB1D29928D6F997C0A85A70C762ED5A03AD",
  "functions/src/shared/stockUnitMeasure.ts": "C85A01020E673B740242CC14B758E6747D92B499A8E33E6DEBF4222A4067E651",
  "src/shared/day.ts": "1F99CDD8F50906F7B165D505DD8C2BF53826B62F05E4052890B3E30227A671EB",
  "functions/src/shared/calculation.ts": "70DAEF46F158D42658B9906BD6BD6F959C0B86DE6D02960544A415E6719C9794",
  "scripts/fix-pumok-deulgireum2-to-3.mts": "14987D89EEBB9A866F93D94C4CDDAE87EF2A5E1F800CD9AC4602083EE8B68720"
});
function check(v:unknown):asserts v{if(!v)throw Error('읽기 계획 검증 실패');}
const stages=['source','paths','auth','query','restshape','plan','output'] as const;
class Failure extends Error{constructor(readonly stage:typeof stages[number]){super('원문 비공개 읽기 계획 실패');}}
function guard<T>(stage:typeof stages[number],fn:()=>T):T{try{return fn();}catch(e){if(e instanceof Failure)throw e;throw new Failure(stage);}}
async function asyncGuard<T>(stage:typeof stages[number],fn:()=>Promise<T>):Promise<T>{try{return await fn();}catch(e){if(e instanceof Failure)throw e;throw new Failure(stage);}}
export function failureCode(error:unknown){return {failed:true,stage:error instanceof Failure?error.stage:'source',code:'validation-failed'};}
export function verifySources(read:(path:string)=>Buffer=path=>readFileSync(path)){for(const [path,sha]of Object.entries(SOURCE_MANIFEST))check(createHash('sha256').update(read(resolve(path))).digest('hex').toUpperCase()===sha);return SOURCE_MANIFEST;}
function planner(){verifySources();return loadTs('./shared/deulgireum3Plan.ts',import.meta.url) as typeof import('./shared/deulgireum3Plan.ts');}
function preserveJson(value:unknown):void{check(isDeepStrictEqual(value,JSON.parse(JSON.stringify(value))));}
function object(value:unknown):asserts value is Record<string,any>{check(value!==null&&typeof value==='object'&&!Array.isArray(value));}
function safe(value:unknown):void{if(value&&typeof value==='object'){for(const [key,child]of Object.entries(value)){check(!['__proto__','prototype','constructor'].includes(key));safe(child);}}}
export function parse(body:unknown,collection:typeof COLLECTIONS[number]){
 check(COLLECTIONS.includes(collection));check(Array.isArray(body)&&body.length>0);const rows:{id:string;data:Record<string,any>;original:Record<string,any>}[]=[],readTimes:string[]=[],seen=new Set<string>();
 for(const [index,row]of body.entries()){object(row);check(Object.keys(row).every(k=>['document','readTime','done','skippedResults'].includes(k)));check(row.skippedResults===undefined||row.skippedResults===0);check(row.done===undefined||typeof row.done==='boolean');if(row.done===true)check(index===body.length-1);if(row.readTime!==undefined){timestamp(row.readTime);readTimes.push(row.readTime);}if(row.document===undefined){check(row.readTime!==undefined||row.done===true);continue;}const doc=row.document;object(doc);safe(doc);preserveJson(doc);check(Object.keys(doc).every(k=>['name','fields','createTime','updateTime'].includes(k)));const prefix=ROOT+'/'+collection+'/';check(typeof doc.name==='string'&&doc.name.startsWith(prefix));const id=doc.name.slice(prefix.length);check(id&&!id.includes('/')&&!seen.has(id));seen.add(id);timestamp(doc.updateTime);if(doc.createTime!==undefined)timestamp(doc.createTime);const fields=doc.fields??{};object(fields);const data=Object.fromEntries(Object.entries(fields).map(([key,v])=>[key,decodeRestValue(v)]));safe(data);encode(data);check(data.companyId==='taebaek'&&(!Object.hasOwn(data,'id')||data.id===id));rows.push({id,data,original:doc});}
 check(readTimes.length>0);return {rows,readTimes:[...new Set(readTimes)]};
}
type Transport=typeof fetch;
export async function readCurrent(token:string,transport:Transport=fetch){
 const snapshots:Record<string,ReturnType<typeof parse>>={};
 for(const collection of COLLECTIONS){const response=await transport('https://firestore.googleapis.com/v1/'+ROOT+':runQuery',{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId:collection,allDescendants:false}],where:{fieldFilter:{field:{fieldPath:'companyId'},op:'EQUAL',value:{stringValue:'taebaek'}}}}})});check(response.ok);snapshots[collection]=await asyncGuard('restshape',async()=>parse(await response.json(),collection));}
 const fixed=planner().POLICY.bom,response=await transport('https://firestore.googleapis.com/v1/'+ROOT+'/item_bom/'+encodeURIComponent(fixed),{method:'GET',redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+token}});let fixedOriginal:Record<string,any>|null=null;if(response.status===404){const body=await asyncGuard('restshape',()=>response.json());object(body);object(body.error);check(body.error.code===404&&body.error.status==='NOT_FOUND');}else{check(response.ok);const body=await asyncGuard('restshape',()=>response.json());object(body);check(body.name===ROOT+'/item_bom/'+fixed);timestamp(body.updateTime);preserveJson(body);fixedOriginal=body;}
 return {snapshots,fixedOriginal,fixedReadAt:new Date().toISOString()};
}
export function outputPath(input:string,workspace=resolve('.'),exists:(p:string)=>boolean=existsSync){const work=resolve(workspace,'work'),path=resolve(input);check(dirname(path)===work);const match=/^deulgireum3-readonly-plan-20261015(?:-v([1-9]\d*))?\.json$/.exec(basename(path));check(match);if(match[1]!==undefined)check(Number.isSafeInteger(Number(match[1]))&&Number(match[1])>=2&&String(Number(match[1]))===match[1]);check(!exists(path));for(const directory of [workspace,work]){check(!lstatSync(directory).isSymbolicLink());check(realpathSync(directory).toLowerCase()===resolve(directory).toLowerCase());}try{lstatSync(path);throw Error('출력 경로가 존재합니다.');}catch(error){check((error as NodeJS.ErrnoException).code==='ENOENT');}return path;}
export function options(args:string[],exists:(p:string)=>boolean=existsSync){check(resolve('.')===resolve(fileURLToPath(new URL('../',import.meta.url))));check(args.length===2&&args[0]==='--auth=firebase-cli'&&args[1].startsWith('--output='));check(!process.env.FIRESTORE_EMULATOR_HOST);return outputPath(args[1].slice(9),resolve('.'),exists);}
export function prepareResult(read:Awaited<ReturnType<typeof readCurrent>>){for(const collection of COLLECTIONS)for(const row of read.snapshots[collection].rows)preserveJson(row.original);if(read.fixedOriginal!==null)preserveJson(read.fixedOriginal);const input=Object.fromEntries(COLLECTIONS.map(k=>[k,read.snapshots[k].rows.map(r=>({...r.data,id:r.id}))])) as unknown as Input;input.fixedBomExists=read.fixedOriginal!==null;const module=planner();let plan:ReturnType<typeof module.prepareDeulgireum3>|null=null;const blockers:{code:string;target?:{collection:string;id:string}}[]=[];try{plan=module.prepareDeulgireum3(input);}catch(error){if(!(error instanceof module.PlanBlocked)||error.code==='invalid-input')throw error;blockers.push({code:error.code,...(error.target?{target:error.target}:{})});}return {readOnly:true,applyApproved:false,atomicSnapshot:false,sourceManifest:SOURCE_MANIFEST,nodeVersion:process.version,inputHash:hash(read),planHash:plan?hash(plan):null,blockers,blockerCounts:Object.fromEntries(blockers.map(b=>[b.code,1])),readTimes:Object.fromEntries(COLLECTIONS.map(k=>[k,read.snapshots[k].readTimes])),originals:Object.fromEntries(COLLECTIONS.map(k=>[k,read.snapshots[k].rows.map(r=>r.original)])),fixedOriginal:read.fixedOriginal,fixedReadAt:read.fixedReadAt,plan:encode(plan)};}
export function selfCheck(){const manifest=verifySources(),{prepareDeulgireum3,POLICY}=planner();const result=prepareDeulgireum3({items:[{id:POLICY.parent,companyId:'taebaek',품목:POLICY.old,spec:'1500ml',costSource:'manual'},{id:POLICY.child,companyId:'taebaek',type:'wip',subtype:'벌크'}],item_bom:[],item_formula:[],productionSalesLogs:[],fixedBomExists:false});assert.equal(result.summary.total,2);assert.equal(result.applyApproved,false);return {selfCheck:'passed',productionRead:false,productionOutputWritten:false,sourceManifest:manifest,nodeVersion:process.version};}
export async function run(args:string[],deps:{source:typeof selfCheck;options:typeof options;token:typeof cliToken;read:typeof readCurrent;write:(path:string,text:string)=>void}={source:selfCheck,options,token:cliToken,read:readCurrent,write:(path,text)=>writeFileSync(path,text,{flag:'wx'})}){const source=guard('source',()=>deps.source()),path=guard('paths',()=>deps.options(args)),token=await asyncGuard('auth',()=>deps.token()),read=await asyncGuard('query',()=>deps.read(token)),result=guard('plan',()=>prepareResult(read));const payload={...result,moduleSelfCheck:source.selfCheck};guard('output',()=>deps.write(path,JSON.stringify(payload,null,2)));return {readOnly:true,applyApproved:false,atomicSnapshot:false,summary:result.plan?.summary??null,blockerCounts:result.blockerCounts,inputHash:result.inputHash,planHash:result.planHash};}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(process.argv.slice(2).join(' ')==='--self-check'?selfCheck():await run(process.argv.slice(2))));}catch(error){console.error(JSON.stringify(failureCode(error)));process.exitCode=1;}}
