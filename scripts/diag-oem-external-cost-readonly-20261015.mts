import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {require as loadTs} from 'tsx/cjs/api';
import {cliToken} from './diag-zero-item-price-20261015.mts';
import {decodeRestValue,timestamp} from './prepare-zero-item-price-dry-20261015.mts';
import {hash} from './shared/zeroItemPriceBackup.ts';
import type {PurchaseOrder,CompanyId} from '../src/shared/types';
import type {OemExternalEvidence} from '../src/features/admin/oemExternalStock';
import type {OemExternalCostDiagnostic} from '../src/features/admin/oemExternalCostDiagnostic';
export const ROOT='projects/taebaek-3abe4/databases/(default)/documents';
export const COLLECTIONS=['purchaseOrders','rawInventoryJobs','rawMaterialLedger','rawInventoryReversalGuards'] as const;
export const SOURCE_MANIFEST=Object.freeze({
  "src/features/admin/oemExternalCostDiagnostic.ts": "4636710DA5939BDDB2A656EF613498BB03A3CFBD3F5F5A0B56CE69DB9790E79A",
  "src/features/admin/oemExternalStock.ts": "2A46645AD102BEBDF1E93FB7EF50BF893AF183DE178EAECB266ADD17D4C1AFC4",
  "src/shared/oemBatchCost.ts": "C4CA6EB4E3AC7BD94848AFEF9417C597CAD3D2C9D5F9F23AC7F48F7FF49BB24B",
  "functions/src/shared/oemBatchCost.ts": "95F159CB35E1099C51ACBA634AC15909703780CAA9EE5CBAE202543900D32634",
  "src/shared/rawInventoryCore.ts": "BDDDDC087456E0543A158E67EE906EDD49E284E41C3B48BD0C4533E3CD02AC83",
  "functions/src/shared/rawInventoryCore.ts": "424FB40B47BF7C03E9BFB1375B0B14D01F56519D29FCEA15629B6EF34CF65CBD",
  "functions/src/shared/rawLot.ts": "3C635419351BA2DB33D3B2A4C2F9053C1F4F5D891A40A923953182B520B09DF0",
  "src/shared/types.ts": "FDE692A9ED4192B21220913D2CE2AFEE4865E8678B634190347280A3A2488FF5",
  "src/shared/day.ts": "1F99CDD8F50906F7B165D505DD8C2BF53826B62F05E4052890B3E30227A671EB",
  "functions/src/shared/calculation.ts": "70DAEF46F158D42658B9906BD6BD6F959C0B86DE6D02960544A415E6719C9794",
  "scripts/diag-zero-item-price-20261015.mts": "CD4DF28228563932DAADEAF973EEB648F1F716FE112E91C47C4A0B7CE2A37AB2",
  "scripts/prepare-zero-item-price-dry-20261015.mts": "DA4245008D1CDF72F75218ED13B864EE113CD369E23C79180598DF62AC764A86",
  "scripts/shared/zeroItemPriceBackup.ts": "0F1F9A8EC366444E7F6D3D8D83CBCB1F30024C698BF2851FD6A55ED28BF8F4DE",
  "scripts/shared/zeroItemPriceMigration.ts": "86507F891DDABAA5126B2AC3F7EBEE9AB1360E90FEF14181E71C1CFC0FAEDCAA",
  "src/shared/services/oemExternalStockEvidence.ts": "B9069945BFBEB7C67566642C1359D3E3C8E5E9E00C1043DF548486D3F1660A57"
});
const workspace=fileURLToPath(new URL('../',import.meta.url));
const stages=['arguments','source','paths','auth','query','restshape','calculation','output'] as const;
class Failure extends Error{constructor(readonly stage:typeof stages[number]){super('OEM 읽기 진단 실패');}}
function check(value:unknown):asserts value{if(!value)throw Error('OEM 읽기 검증 실패');}
function guard<T>(stage:typeof stages[number],fn:()=>T):T{try{return fn();}catch(error){if(error instanceof Failure)throw error;throw new Failure(stage);}}
async function guarded<T>(stage:typeof stages[number],fn:()=>Promise<T>):Promise<T>{try{return await fn();}catch(error){if(error instanceof Failure)throw error;throw new Failure(stage);}}
export function failureCode(error:unknown){return {failed:true,stage:error instanceof Failure?error.stage:'source',code:'validation-failed'};}
export function verifySources(reader:(path:string)=>Buffer=readFileSync){for(const [path,sha]of Object.entries(SOURCE_MANIFEST))check(createHash('sha256').update(reader(resolve(workspace,path))).digest('hex').toUpperCase()===sha);return SOURCE_MANIFEST;}
function helpers(){return {...loadTs('../src/features/admin/oemExternalCostDiagnostic.ts',import.meta.url) as typeof import('../src/features/admin/oemExternalCostDiagnostic'),...loadTs('../src/shared/rawInventoryCore.ts',import.meta.url) as typeof import('../src/shared/rawInventoryCore'),companyOf:(loadTs('../src/shared/types.ts',import.meta.url) as typeof import('../src/shared/types')).companyOf};}
function object(v:unknown):asserts v is Record<string,any>{check(v!==null&&typeof v==='object'&&!Array.isArray(v));}
function safe(v:unknown):void{if(v&&typeof v==='object')for(const [key,child]of Object.entries(v)){check(!['__proto__','constructor','prototype'].includes(key));safe(child);}}
function preserved(v:unknown){safe(v);check(isDeepStrictEqual(v,JSON.parse(JSON.stringify(v))));}
function id(v:unknown):asserts v is string{check(typeof v==='string'&&v.length>0&&!v.includes('/')&&Buffer.byteLength(v)<=1500&&!/^__.*__$/.test(v));}
export type Document={id:string;data:Record<string,any>;original:Record<string,any>};
export function parseDocument(body:unknown,collection:typeof COLLECTIONS[number],expectedId?:string):Document{
 check(COLLECTIONS.includes(collection));object(body);preserved(body);check(Object.keys(body).every(k=>['name','fields','updateTime','createTime'].includes(k)));const prefix=ROOT+'/'+collection+'/';check(typeof body.name==='string'&&body.name.startsWith(prefix));const key=body.name.slice(prefix.length);id(key);if(expectedId!==undefined)check(key===expectedId);timestamp(body.updateTime);if(body.createTime!==undefined)timestamp(body.createTime);const fields=body.fields??{};object(fields);const data=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,decodeRestValue(v)]));safe(data);return {id:key,data,original:body};
}
export function parseQuery(body:unknown){check(Array.isArray(body)&&body.length>0);const documents:Document[]=[],readTimes:string[]=[],seen=new Set<string>();for(const [index,row]of body.entries()){object(row);check(Object.keys(row).every(k=>['document','readTime','done','skippedResults'].includes(k)));check(row.skippedResults===undefined||row.skippedResults===0);check(row.done===undefined||typeof row.done==='boolean');if(row.done===true)check(index===body.length-1);if(row.readTime!==undefined){timestamp(row.readTime);readTimes.push(row.readTime);}if(row.document===undefined){check(row.readTime!==undefined||row.done===true);continue;}const doc=parseDocument(row.document,'purchaseOrders');check(!seen.has(doc.id));seen.add(doc.id);check(doc.data.poType==='oem');documents.push(doc);}check(readTimes.length>0);return {documents,readTimes:[...new Set(readTimes)]};}
export type Observation={collection:typeof COLLECTIONS[number];id:string;document:Document|null;observedAt:string};
export interface Ports{list:()=>Promise<ReturnType<typeof parseQuery>>;get:(collection:typeof COLLECTIONS[number],id:string)=>Promise<Observation>}
export function restPorts(token:string,transport:typeof fetch=fetch):Ports{
 const request=async(url:string,init:RequestInit)=>{const response=await guarded('query',()=>transport(url,{...init,redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}}));return response;};
 return {list:async()=>{const response=await request('https://firestore.googleapis.com/v1/'+ROOT+':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'purchaseOrders',allDescendants:false}],where:{fieldFilter:{field:{fieldPath:'poType'},op:'EQUAL',value:{stringValue:'oem'}}}}})});guard('query',()=>check(response.ok));return guarded('restshape',async()=>parseQuery(await response.json()));},get:async(collection,key)=>{guard('query',()=>{check(COLLECTIONS.includes(collection));id(key);});const response=await request('https://firestore.googleapis.com/v1/'+ROOT+'/'+collection+'/'+encodeURIComponent(key),{method:'GET'}),observedAt=new Date().toISOString();if(response.status===404){return guarded('restshape',async()=>{const body=await response.json();object(body);object(body.error);check(body.error.code===404&&body.error.status==='NOT_FOUND');return {collection,id:key,document:null,observedAt};});}guard('query',()=>check(response.ok));return guarded('restshape',async()=>({collection,id:key,document:parseDocument(await response.json(),collection,key),observedAt}));}};
}
type Report=OemExternalCostDiagnostic|{poId:string;classification:'unconfirmed';reason:'po-changed-during-read';currentOnly:true;assetValuationConfirmed:false};
export async function collect(company:CompanyId,ports:Ports){
 check(company==='taebaek'||company==='punghoe');const h=helpers(),listing=await ports.list(),observations:Observation[]=[],reports:Report[]=[];const selected=listing.documents.filter(row=>h.companyOf(row.data)===company);
 const read=async(collection:typeof COLLECTIONS[number],key:string)=>{check(COLLECTIONS.includes(collection));id(key);const result=await ports.get(collection,key);check(result.collection===collection&&result.id===key);timestamp(result.observedAt);if(result.document!==null){const verified=parseDocument(result.document.original,collection,key);check(isDeepStrictEqual(verified,result.document));}observations.push(result);return result.document?{...result.document.data,id:result.document.id}:null;};
 const movement=async(operation:string)=>{const current=h.operationDocId(operation),legacy=h.legacyOperationDocId(operation),a=await read('rawMaterialLedger',current),b=current===legacy?null:await read('rawMaterialLedger',legacy);return a&&b?null:a??b;};
 for(const row of selected){const po={...row.data,id:row.id} as PurchaseOrder,evidence:OemExternalEvidence={po,job:await read('rawInventoryJobs','oem-issue:'+po.id),receipts:{},guards:{},reversals:{}};for(const sent of Array.isArray(po.oemSent)?po.oemSent:[]){if(typeof sent?.rawItemId!=='string'||!sent.rawItemId||sent.rawItemId.includes('/'))continue;const operation='oem-issue:'+po.id+':'+sent.rawItemId;evidence.receipts[operation]=await movement(operation);evidence.guards[operation]=await read('rawInventoryReversalGuards',h.operationDocId(operation));if(evidence.guards[operation]||po.oemCancelledAt||po.oemCancelOperationId)evidence.reversals[operation]=await movement('oem-cancel:'+po.id+':'+sent.rawItemId);}
  const diagnostic=h.diagnoseOemExternalCost(po,company,evidence);await read('purchaseOrders',po.id);const final=observations[observations.length-1].document;if(!final||!isDeepStrictEqual(row.original,final.original))reports.push({poId:po.id,classification:'unconfirmed',reason:'po-changed-during-read',currentOnly:true,assetValuationConfirmed:false});else reports.push(diagnostic);
 }
 return {company,listing,observations,reports};
}
export function summary(result:Awaited<ReturnType<typeof collect>>){const classification:Record<string,number>={},reasons:Record<string,number>={};for(const row of result.reports){classification[row.classification]=(classification[row.classification]??0)+1;reasons[row.reason]=(reasons[row.reason]??0)+1;}return {readOnly:true,currentOnly:true,atomicSnapshot:false,assetValuationConfirmed:false,orders:result.reports.length,classification,reasons};}
export function parseArgs(args:string[]){check(args.length===3&&args[0]==='--auth=firebase-cli'&&/^--company=(taebaek|punghoe)$/.test(args[1])&&args[2].startsWith('--output='));check(!process.env.FIRESTORE_EMULATOR_HOST);return {company:args[1].slice(10) as CompanyId,output:args[2].slice(9)};}
export function outputPath(input:string,base=workspace){if(base===workspace)check(resolve('.')===resolve(workspace));const work=resolve(base,'work'),path=resolve(input);check(dirname(path)===work&&/^oem-external-cost-readonly-20261015(?:-v(?:[2-9]|[1-9]\d+))?\.json$/.test(basename(path)));for(const directory of [base,work])check(!lstatSync(directory).isSymbolicLink()&&realpathSync(directory).toLowerCase()===resolve(directory).toLowerCase());check(!existsSync(path));try{lstatSync(path);throw Error('출력 파일 존재');}catch(error){check((error as NodeJS.ErrnoException).code==='ENOENT');}return path;}
export function selfCheck(){verifySources();const h=helpers();assert.notEqual(h.operationDocId('oem-issue:합성:원료'),h.legacyOperationDocId('oem-issue:합성:원료'));assert.equal(h.companyOf({}), 'taebaek');assert.equal(h.diagnoseOemExternalCost({id:'합성',poType:'oem',companyId:'taebaek'} as PurchaseOrder,'taebaek').classification,'unconfirmed');assert.deepEqual(parseQuery([{readTime:'2026-10-15T00:00:00.123456789Z',done:true}]).documents,[]);assert.equal(parseDocument({name:ROOT+'/purchaseOrders/test',updateTime:'2026-10-15T00:00:00.123456789Z',fields:{poType:{stringValue:'oem'},data:{mapValue:{fields:{zero:{integerValue:'0'}}}}}},'purchaseOrders').original.updateTime,'2026-10-15T00:00:00.123456789Z');assert.throws(()=>parseQuery([]));assert.throws(()=>parseDocument({name:ROOT+'/purchaseOrders/test',updateTime:'2026-10-15T00:00:00.123456789Z',fields:{value:{doubleValue:-0}}},'purchaseOrders'));return {selfCheck:'passed',productionRead:false,productionOutputWritten:false,nodeVersion:process.version,sourceManifest:SOURCE_MANIFEST};}
export async function run(args:string[],deps={source:selfCheck,path:outputPath,token:cliToken,ports:restPorts,write:(path:string,text:string)=>writeFileSync(path,text,{flag:'wx'})}){
 const options=guard('arguments',()=>parseArgs(args)),path=guard('paths',()=>deps.path(options.output)),source=guard('source',()=>deps.source()),token=await guarded('auth',()=>deps.token()),result=await guarded('query',()=>collect(options.company,deps.ports(token)));const payload=guard('calculation',()=>({readOnly:true,currentOnly:true,atomicSnapshot:false,assetValuationConfirmed:false,scope:'현재 관측한 송출 원물 공급액 후보만이며 확정 자산이나 과거 월말 평가가 아니다. PO 최종 대조는 job·원장·guard의 원자성을 보장하지 않는다. GET observedAt은 서버 readTime이 아니다.',sourceManifest:SOURCE_MANIFEST,toolSourceSha256:createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),moduleSelfCheck:source.selfCheck,nodeVersion:process.version,inputHash:hash({listing:result.listing.documents.map(row=>row.original),readTimes:result.listing.readTimes,observations:result.observations.map(row=>({collection:row.collection,id:row.id,document:row.document?.original??null,observedAt:row.observedAt}))}),company:result.company,listing:{documents:result.listing.documents.map(row=>row.original),readTimes:result.listing.readTimes},observations:result.observations.map(row=>({...row,document:row.document?.original??null})),reports:result.reports,summary:summary(result)}));guard('output',()=>deps.write(path,JSON.stringify(payload,null,2)));return summary(result);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const args=process.argv.slice(2);console.log(JSON.stringify(args.length===1&&args[0]==='--self-check'?selfCheck():await run(args)));}catch(error){console.error(JSON.stringify(failureCode(error)));process.exitCode=1;}}
