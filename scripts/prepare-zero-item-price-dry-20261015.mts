import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Timestamp} from 'firebase-admin/firestore';
import {cliToken} from './diag-zero-item-price-20261015.mts';
import {prepareZeroItemPrice,checkPlan,type Document,type Plan} from './shared/zeroItemPriceMigration.ts';
import {encode,decode,hash,resolveZeroItemPriceBackupPath} from './shared/zeroItemPriceBackup.ts';

const root='projects/taebaek-3abe4/databases/(default)/documents/';
function check(value:unknown):asserts value{if(!value)throw Error('정식 dry 원문 검증 실패');}
function object(value:unknown):asserts value is Record<string,unknown>{check(value!==null&&typeof value==='object'&&!Array.isArray(value));}
export function timestamp(value:unknown):Timestamp{
 check(typeof value==='string');const match=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value);check(match);
 const ms=Date.parse(match[1]+'Z');check(Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,19)===match[1]);
 return new Timestamp(ms/1000,Number((match[2]??'').padEnd(9,'0')));
}
export function decodeRestValue(value:unknown):unknown{
 object(value);const entries=Object.entries(value);check(entries.length===1);const [kind,raw]=entries[0];
 if(kind==='nullValue'){check(raw===null||raw==='NULL_VALUE');return null;}
 if(kind==='booleanValue'){check(typeof raw==='boolean');return raw;}
 if(kind==='stringValue'){check(typeof raw==='string');return raw;}
 if(kind==='integerValue'){check(typeof raw==='string'&&/^-?\d+$/.test(raw));const number=Number(raw);check(Number.isSafeInteger(number));return number;}
 if(kind==='doubleValue'){check(typeof raw==='number'||raw==='NaN'||raw==='Infinity'||raw==='-Infinity');return typeof raw==='number'?raw:Number(raw);}
 if(kind==='timestampValue')return timestamp(raw);
 if(kind==='arrayValue'){object(raw);check(Object.keys(raw).every(key=>key==='values'));check(raw.values===undefined||Array.isArray(raw.values));return ((raw.values??[]) as unknown[]).map(decodeRestValue);}
 if(kind==='mapValue'){object(raw);check(Object.keys(raw).every(key=>key==='fields'));return decodeRestFields(Object.hasOwn(raw,'fields')?raw.fields:{});}
 // 기존 백업 codec은 참조·좌표·bytes를 복원하지 못한다. 유사 JSON으로 바꾸지 않는다.
 throw Error('정식 dry에서 지원하지 않는 원문 타입');
}
function decodeRestFields(value:unknown):Record<string,unknown>{
 object(value);check(!Object.hasOwn(value,'__zeroMigrationType'));
 return Object.fromEntries(Object.entries(value).map(([key,raw])=>[key,decodeRestValue(raw)]));
}
export function parseFullResponse(body:unknown){
 check(Array.isArray(body)&&body.length>0);const documents:Document[]=[],seen=new Set<string>(),readTimes:string[]=[];
 for(const [index,value]of body.entries()){
  object(value);check(Object.keys(value).every(key=>['document','readTime','skippedResults','done'].includes(key)));
  check(value.skippedResults===undefined||value.skippedResults===0);check(value.done===undefined||typeof value.done==='boolean');if(value.done===true)check(index===body.length-1);
  if(value.readTime!==undefined){timestamp(value.readTime);readTimes.push(value.readTime as string);}
  if(value.document===undefined){check(value.readTime!==undefined||value.done===true);continue;}
  const doc=value.document;object(doc);check(Object.keys(doc).every(key=>['name','fields','createTime','updateTime'].includes(key)));
  const prefix=root+'items/';check(typeof doc.name==='string'&&doc.name.startsWith(prefix));const id=doc.name.slice(prefix.length);check(id.length>0&&!id.includes('/')&&!seen.has(id));seen.add(id);
  const v=timestamp(doc.updateTime);if(doc.createTime!==undefined)timestamp(doc.createTime);
  const data=decodeRestFields(Object.hasOwn(doc,'fields')?doc.fields:{});encode(data);
  documents.push({id,data,version:{seconds:v.seconds,nanoseconds:v.nanoseconds}});
 }
 check(readTimes.length>0);return {documents,readTimes:[...new Set(readTimes)]};
}
type Transport=(url:string,init:RequestInit)=>Promise<{ok:boolean;json:()=>Promise<unknown>}>;
export async function readFullItems(token:string,transport:Transport=fetch){
 const response=await transport('https://firestore.googleapis.com/v1/'+root.slice(0,-1)+':runQuery',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(60000),body:JSON.stringify({structuredQuery:{from:[{collectionId:'items',allDescendants:false}]}})});
 check(response.ok);return parseFullResponse(await response.json());
}
export function options(args:string[],exists:(path:string)=>boolean=existsSync):{company:Plan['companyId'];backup:string}{
 check(args.length===3&&args[0]==='--auth=firebase-cli'&&args[1].startsWith('--company=')&&args[2].startsWith('--backup='));
 const company=args[1].slice('--company='.length);check(company==='taebaek'||company==='punghoe');
 const backup=resolveZeroItemPriceBackupPath(company,args[2].slice('--backup='.length)).path;check(!exists(backup));return {company,backup};
}
export function backupText(company:Plan['companyId'],documents:Document[]){
 const plan=prepareZeroItemPrice(company,documents);checkPlan(plan);const planHash=hash(plan);
 const text=JSON.stringify(encode({plan,planHash}),null,2),restored=decode(JSON.parse(text));
 checkPlan(restored.plan);check(hash(restored.plan)===planHash&&restored.planHash===planHash);
 return {text,planHash,documents:plan.documents.length};
}
export async function runDry(args:string[],dependencies={exists:existsSync,token:cliToken,read:readFullItems,write:(path:string,text:string)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text,{flag:'wx'});}}){
 const {company,backup}=options(args,dependencies.exists);check(!process.env.FIRESTORE_EMULATOR_HOST);
 const result=await dependencies.read(await dependencies.token());const prepared=backupText(company,result.documents);
 dependencies.write(backup,prepared.text);
 return {mode:'dry',companyId:company,documents:prepared.documents,writes:0,planHash:prepared.planHash,readTimes:result.readTimes};
}
export function selfCheck(){
 const result=parseFullResponse([{document:{name:root+'items/SYNTHETIC',updateTime:'2026-10-15T00:00:00.123456789Z',fields:{price:{integerValue:'0'},cost:{doubleValue:-0},createdAt:{timestampValue:'2026-10-14T00:00:00.000000007Z'}}},readTime:'2026-10-15T00:00:01Z'}]);
 const prepared=backupText('taebaek',result.documents),restored=decode(JSON.parse(prepared.text));
 assert.equal(restored.plan.documents[0].before.createdAt.nanoseconds,7);assert.equal(restored.plan.documents[0].version.nanoseconds,123456789);assert.equal(Object.is(restored.plan.documents[0].before.cost,-0),true);assert.equal(prepared.documents,1);
 assert.throws(()=>decodeRestValue({referenceValue:root+'items/SYNTHETIC'}));assert.throws(()=>options(['--apply'],()=>false));
 return {selfCheck:'passed',productionRead:false,productionOutputWritten:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(process.argv.length===3&&process.argv[2]==='--self-check'?selfCheck():await runDry(process.argv.slice(2))));}
 catch{console.error('정식 dry 준비 실패: 인증·원문 타입·회사별 출력 경로를 확인하세요. 적용 요청은 보내지 않았습니다.');process.exitCode=1;}
}
