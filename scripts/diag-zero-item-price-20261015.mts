import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareZeroItemPrice,type Document} from './shared/zeroItemPriceMigration.ts';

const project='taebaek-3abe4';
const root=`projects/${project}/databases/(default)/documents/`;
const projected=['companyId','price','cost'];
const own=(object:object,key:string)=>Object.hasOwn(object,key);
function check(value:unknown):asserts value {if(!value)throw Error('읽기 분류 검증 실패');}
function object(value:unknown):asserts value is Record<string,unknown>{check(value!==null&&typeof value==='object'&&!Array.isArray(value));}
export function decodeValue(value:unknown):unknown {
 object(value);const entries=Object.entries(value);check(entries.length===1);const [kind,raw]=entries[0];
 if(kind==='nullValue'){check(raw===null||raw==='NULL_VALUE');return null;}
 if(kind==='booleanValue'){check(typeof raw==='boolean');return raw;}
 if(kind==='stringValue'){check(typeof raw==='string');return raw;}
 if(kind==='integerValue'){check(typeof raw==='string'&&/^-?\d+$/.test(raw));const n=BigInt(raw);check(n>=-9223372036854775808n&&n<=9223372036854775807n);return Number(raw);}
 if(kind==='doubleValue'){check(typeof raw==='number'||raw==='NaN'||raw==='Infinity'||raw==='-Infinity');return typeof raw==='number'?raw:Number(raw);}
 if(kind==='arrayValue'){object(raw);check(Object.keys(raw).every(key=>key==='values'));check(raw.values===undefined||Array.isArray(raw.values));return ((raw.values??[]) as unknown[]).map(decodeValue);}
 if(kind==='mapValue'){object(raw);check(Object.keys(raw).every(key=>key==='fields'));return decodeFields(own(raw,'fields')?raw.fields:{});}
 if(['timestampValue','referenceValue','bytesValue'].includes(kind)){check(typeof raw==='string');return {[kind]:raw};}
 if(kind==='geoPointValue'){object(raw);check(typeof raw.latitude==='number'&&typeof raw.longitude==='number');return {[kind]:raw};}
 throw Error('읽기 분류 검증 실패');
}
function decodeFields(value:unknown):Record<string,unknown>{object(value);return Object.fromEntries(Object.entries(value).map(([key,data])=>[key,decodeValue(data)]));}
function version(value:unknown){
 check(typeof value==='string');const match=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);check(match);
 const milliseconds=Date.parse(match[1]+'Z');check(Number.isFinite(milliseconds)&&new Date(milliseconds).toISOString().slice(0,19)===match[1]);
 return {seconds:milliseconds/1000,nanoseconds:Number((match[2]??'').padEnd(9,'0'))};
}
export function parseResponse(body:unknown){
 check(Array.isArray(body)&&body.length>0);const documents:Document[]=[],ids=new Set<string>(),readTimes:string[]=[];
 for(const [index,value]of body.entries()){
  object(value);check(Object.keys(value).every(key=>['document','readTime','skippedResults','done'].includes(key)));
  check(value.skippedResults===undefined||value.skippedResults===0);check(value.done===undefined||typeof value.done==='boolean');if(value.done===true)check(index===body.length-1);
  if(value.readTime!==undefined){version(value.readTime);readTimes.push(value.readTime as string);}
  if(value.document===undefined){check(value.readTime!==undefined||value.done===true);continue;}
  const doc=value.document;object(doc);const prefix=root+'items/';check(typeof doc.name==='string'&&doc.name.startsWith(prefix));const id=doc.name.slice(prefix.length);check(id.length>0&&!id.includes('/')&&!ids.has(id));ids.add(id);
  const data=decodeFields(own(doc,'fields')?doc.fields:{});check(Object.keys(data).every(key=>projected.includes(key)));
  documents.push({id,data,version:version(doc.updateTime)});
 }
 check(readTimes.length>0);return {documents,readTimes:[...new Set(readTimes)]};
}
const buckets=['missing','null','positiveZero','negativeZero','positive','negative','nonfinite','string','boolean','other'] as const;
type Bucket=typeof buckets[number];
export function bucket(data:Record<string,unknown>,field:string):Bucket{
 if(!own(data,field))return 'missing';const value=data[field];if(value===null)return 'null';
 if(typeof value==='number'){if(Object.is(value,0))return 'positiveZero';if(Object.is(value,-0))return 'negativeZero';if(!Number.isFinite(value))return 'nonfinite';return value>0?'positive':'negative';}
 return typeof value==='string'?'string':typeof value==='boolean'?'boolean':'other';
}
const counts=()=>Object.fromEntries(buckets.map(key=>[key,0])) as Record<Bucket,number>;
const group=()=>({documents:0,price:counts(),cost:counts(),cross:Object.fromEntries(buckets.map(key=>[key,counts()])) as Record<Bucket,Record<Bucket,number>>,migrationSelected:0,migrationByCost:counts(),exceedsSingleBatchLimit:false});
export function classify(documents:Document[]){
 const companies={taebaek:group(),punghoe:group(),invalid:group()},companyFields={missing:0,null:0,valid:0,invalid:0};
 const seen=new Set<string>();
 for(const row of documents){
  check(row.id.length>0&&!seen.has(row.id));seen.add(row.id);
  const data=row.data,company=data.companyId;
  companyFields[!own(data,'companyId')?'missing':company===null?'null':company==='taebaek'||company==='punghoe'?'valid':'invalid']++;
  const owner=company===undefined||company===null?'taebaek':company==='taebaek'||company==='punghoe'?company:'invalid';
  const entry=companies[owner],p=bucket(data,'price'),c=bucket(data,'cost');entry.documents++;entry.price[p]++;entry.cost[c]++;entry.cross[p][c]++;
  // 전송된 세 필드로 만든 계획은 적용·백업에 쓸 수 없다. 공용 선정 결과의 개수만 사용한다.
  if(owner!=='invalid'&&prepareZeroItemPrice(owner,[row]).documents.length===1){entry.migrationSelected++;entry.migrationByCost[c]++;}
 }
 for(const entry of Object.values(companies)){
  entry.exceedsSingleBatchLimit=entry.migrationSelected>450;
  check(Object.values(entry.price).reduce((a,b)=>a+b,0)===entry.documents&&Object.values(entry.cost).reduce((a,b)=>a+b,0)===entry.documents);
  check(Object.values(entry.cross).flatMap(Object.values).reduce((a,b)=>a+b,0)===entry.documents);
  check(Object.values(entry.migrationByCost).reduce((a,b)=>a+b,0)===entry.migrationSelected);
 }
 check(Object.values(companyFields).reduce((a,b)=>a+b,0)===documents.length);
 return {documents:documents.length,companyFields,companies};
}
type Transport=(url:string,init:RequestInit)=>Promise<{ok:boolean;json:()=>Promise<unknown>}>;
export async function readItems(token:string,transport:Transport=fetch){
 const response=await transport(`https://firestore.googleapis.com/v1/${root.slice(0,-1)}:runQuery`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(60000),body:JSON.stringify({structuredQuery:{select:{fields:projected.map(fieldPath=>({fieldPath}))},from:[{collectionId:'items',allDescendants:false}]}})});
 check(response.ok);return parseResponse(await response.json());
}
export async function cliToken(load:()=>unknown=()=>createRequire(import.meta.url)('C:/Users/yhy_0/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js')){
 const auth=load() as {getProjectDefaultAccount:(path:string)=>{tokens?:{refresh_token?:unknown}}|undefined;getAccessToken:(refresh:string,scopes:string[])=>Promise<{access_token?:unknown}>};
 const refresh=auth.getProjectDefaultAccount(process.cwd())?.tokens?.refresh_token;check(typeof refresh==='string'&&refresh.length>0);
 const result=await auth.getAccessToken(refresh,['https://www.googleapis.com/auth/cloud-platform']);check(typeof result.access_token==='string'&&result.access_token.length>0&&result.access_token!==refresh);return result.access_token;
}
export function outputPath(args:string[],exists:(path:string)=>boolean=existsSync){
 const expected=resolve('../zero-item-price-classification-20261015.json');
 check(args.length===2&&args[0]==='--auth=firebase-cli'&&args[1].startsWith('--output='));check(resolve(args[1].slice('--output='.length))===expected&&!exists(expected));return expected;
}
export async function run(args:string[],dependencies={exists:existsSync,token:cliToken,read:readItems,write:(path:string,text:string)=>writeFileSync(path,text,{flag:'wx'})}){
 const path=outputPath(args,dependencies.exists);check(!process.env.FIRESTORE_EMULATOR_HOST);
 const response=await dependencies.read(await dependencies.token());const result={project,readOnly:true,classificationOnly:true,migrationPlan:false,atomicSnapshot:false,readTimes:response.readTimes,...classify(response.documents)};
 dependencies.write(path,JSON.stringify(result,null,2));return result;
}
export function selfCheck(){
 const rows:Document[]=[{id:'SECRET_A',data:{price:0},version:{seconds:1,nanoseconds:2}},{id:'SECRET_B',data:{companyId:null,price:-0,cost:0},version:{seconds:1,nanoseconds:2}},{id:'SECRET_C',data:{companyId:'punghoe',price:'0',cost:7},version:{seconds:1,nanoseconds:2}}];
 const result=classify(rows);assert.equal(result.companies.taebaek.migrationSelected,1);assert.equal(result.companies.taebaek.price.negativeZero,1);assert.equal(result.companies.punghoe.price.string,1);assert.equal(JSON.stringify(result).includes('SECRET_'),false);
 assert.equal(Object.is(decodeValue({doubleValue:-0}),-0),true);assert.equal(decodeValue({nullValue:null}),null);assert.equal(decodeValue({stringValue:'0'}),'0');
 assert.throws(()=>parseResponse([]));assert.throws(()=>outputPath(['--auth=firebase-cli','--output='+resolve('../zero-item-price-classification-20261015.json')],()=>true));
 return {selfCheck:'passed',productionRead:false,productionOutputWritten:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{if(process.argv.slice(2).length===1&&process.argv[2]==='--self-check')console.log(JSON.stringify(selfCheck()));else{const result=await run(process.argv.slice(2));console.log(JSON.stringify({readOnly:true,classificationOnly:true,documents:result.documents}));}}
 catch{console.error('읽기 분류 실패: 인증·응답·출력 경로를 확인하세요. 집계 완료를 확인하지 못했습니다.');process.exitCode=1;}
}
