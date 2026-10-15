import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { isDeepStrictEqual } from 'node:util';
import { encode, decode, hash } from './zeroItemPriceBackup.ts';
import { timestamp } from '../prepare-zero-item-price-dry-20261015.mts';
export type Version = { seconds: number; nanoseconds: number };
export type Document = { path: string; data: Record<string, unknown>; version: Version };
export type SourceHashes = { pallets: string; lots: string };
export type Plan = { version: 1; companyId: 'taebaek'; sourceHashes: SourceHashes; documents: { path: string; field: 'inUse'|'lotsAreTotal'; before: Record<string, unknown>; after: Record<string, unknown>; version: Version }[] };
export type Receipt = { version: 1; planHash: string; mode: 'apply'|'undo'; documents: { path: string; version: Version }[] };
export const SOURCE_HASHES: SourceHashes = { pallets: 'f4adfcc5cea25d270b0c0a1f4095a3709e5bdde333e98302fc92e43285c8a7c7', lots: '641e07be4bcf3a33a80436fd08ac716f196666a263b4273d3115694839216dd6' };
function check(v: unknown, message='정리 계획의 원문·회사·목록을 확인하세요.'): asserts v { if (!v) throw Error(message); }
function validVersion(v: Version) { check(v && Number.isSafeInteger(v.seconds) && Number.isInteger(v.nanoseconds) && v.nanoseconds>=0 && v.nanoseconds<1e9); return new Timestamp(v.seconds,v.nanoseconds); }
function later(a: Version,b: Version) { return a.seconds>b.seconds || a.seconds===b.seconds && a.nanoseconds>b.nanoseconds; }
export function prepareDeprecatedFieldRemoval(documents: Document[], sourceHashes: SourceHashes): Plan {
  check(documents.length===9 && isDeepStrictEqual(sourceHashes,SOURCE_HASHES));
  const selected=documents.map(row=>{
    check(/^(pallets|items)\/[^/]+$/.test(row.path) && !row.path.endsWith('/.') && !row.path.endsWith('/..'));
    check(row.data && (row.data.companyId??'taebaek')==='taebaek'); validVersion(row.version);
    const field=row.path.startsWith('pallets/')?'inUse':'lotsAreTotal';
    check(Object.hasOwn(row.data,field));
    check(field==='lotsAreTotal'?row.data[field]===false:typeof row.data[field]==='number' && Number.isFinite(row.data[field]));
    const before=decode(encode(row.data)); const after={...before}; delete after[field];
    return {path:row.path,field,before,after,version:{...row.version}} as Plan['documents'][number];
  }).sort((a,b)=>a.path.localeCompare(b.path));
  check(new Set(selected.map(r=>r.path)).size===9 && selected.filter(r=>r.field==='inUse').length===8 && selected.filter(r=>r.field==='lotsAreTotal').length===1);
  return {version:1,companyId:'taebaek',sourceHashes:{...sourceHashes},documents:selected};
}
export function checkPlan(plan: Plan) {
  check(plan?.version===1 && plan.companyId==='taebaek' && Array.isArray(plan.documents));
  const expected=prepareDeprecatedFieldRemoval(plan.documents.map(r=>({path:r.path,data:r.before,version:r.version})),plan.sourceHashes);
  check(isDeepStrictEqual(plan,expected));
}
export function checkReceipt(plan: Plan, receipt: Receipt, mode: 'apply'|'undo', planHash=hash(plan)) {
  checkPlan(plan); check(receipt?.version===1 && receipt.planHash===planHash && receipt.mode===mode && Array.isArray(receipt.documents) && receipt.documents.length===9,'실제 처리 영수증을 확인하세요. 자동 재실행하지 마세요.');
  receipt.documents.forEach((r,i)=>{check(r.path===plan.documents[i].path);validVersion(r.version);check(later(r.version,plan.documents[i].version));});
}
export function checkDeprecatedFieldRemoval(plan: Plan,current: Document[],mode: 'apply'|'undo',receipt?: Receipt,planHash=hash(plan)) {
  checkPlan(plan);check(mode==='apply'||mode==='undo');check(planHash===hash(plan));
  if(mode==='undo')checkReceipt(plan,receipt!,'apply',planHash);
  check(current.length===9 && new Set(current.map(r=>r.path)).size===9);
  for(const row of plan.documents){ const now=current.find(r=>r.path===row.path); const version=mode==='apply'?row.version:receipt!.documents.find(r=>r.path===row.path)!.version;
    check(now && isDeepStrictEqual(now.version,version) && isDeepStrictEqual(now.data,mode==='apply'?row.before:row.after),'원문 또는 나노초 버전이 변경됐습니다. 쓰지 않았습니다. 새 계획과 승인이 필요합니다.'); }
}
/** 전체 원문은 먼저 대조하고, 쓰기는 정확 한 필드와 그 문서 버전으로만 제한한다. */
export async function commitDeprecatedFieldRemoval(db: Firestore,plan: Plan,current: Document[],mode: 'apply'|'undo',approvedHash: string,receipt?: Receipt): Promise<Receipt> {
  check(approvedHash===hash(plan),'승인한 계획 해시가 일치하지 않습니다.');checkDeprecatedFieldRemoval(plan,current,mode,receipt,approvedHash);
  const batch=db.batch();
  for(const row of plan.documents){const version=mode==='apply'?row.version:receipt!.documents.find(r=>r.path===row.path)!.version;
    batch.update(db.doc(row.path),{[row.field]:mode==='apply'?FieldValue.delete():row.before[row.field]}, {lastUpdateTime:validVersion(version)});}
  const results=await batch.commit();check(Array.isArray(results)&&results.length===9,'실제 처리 버전을 확인하지 못했습니다. 자동 재실행하지 마세요.');
  const proof: Receipt={version:1,planHash:approvedHash,mode,documents:results.map((r,i)=>{check(r.writeTime instanceof Timestamp);const v={seconds:r.writeTime.seconds,nanoseconds:r.writeTime.nanoseconds}; const prior=mode==='apply'?plan.documents[i].version:receipt!.documents[i].version;check(later(v,prior),'처리 버전이 진행하지 않았습니다. 자동 재실행하지 마세요.');return {path:plan.documents[i].path,version:v};})};
  return proof;
}
export type Transport = (request:{url:string;method:'POST';headers:Record<string,string>;body:{writes:unknown[]}})=>Promise<{status:number;body:unknown}>;
export class RemovalRestError extends Error { constructor(public outcome:'rejected'|'unknown',public code:string){super(outcome==='rejected'?'서버가 원자 요청을 거절했습니다.':'처리 결과를 확인하지 못했습니다. 자동 재실행하지 마세요.');} }
const database='projects/taebaek-3abe4/databases/(default)';
const rejectionStatuses:Record<string,number>={INVALID_ARGUMENT:400,FAILED_PRECONDITION:400,OUT_OF_RANGE:400,UNAUTHENTICATED:401,PERMISSION_DENIED:403,NOT_FOUND:404,ALREADY_EXISTS:409,ABORTED:409};
const textTime=(v:Version)=>`${new Date(v.seconds*1000).toISOString().slice(0,19)}.${String(v.nanoseconds).padStart(9,'0')}Z`;
function restValue(v:unknown):unknown {
  if(v===false)return {booleanValue:false};
  check(typeof v==='number'&&Number.isFinite(v));return Number.isSafeInteger(v)&&!Object.is(v,-0)?{integerValue:String(v)}:{doubleValue:v};
}
export function createDeprecatedFieldRemovalRestDb(options:{plan:Plan;mode:'apply'|'undo';receipt?:Receipt;token:string;transport?:Transport}):Firestore {
  const mode=options.mode,token=options.token; const plan:Plan=decode(encode(options.plan)),receipt=options.receipt?decode(encode(options.receipt)):undefined;checkPlan(plan);
  check(mode==='apply'||mode==='undo');check(typeof token==='string'&&token.trim()&&!/[\r\n]/.test(token));if(mode==='undo')checkReceipt(plan,receipt,'apply');
  const transport:Transport=options.transport??(async r=>{const response=await fetch(r.url,{method:r.method,headers:r.headers,body:JSON.stringify(r.body),redirect:'error'});return {status:response.status,body:await response.json()};});
  const refs=new WeakMap<object,string>();let created=false,used=false;
  return {doc(path:string){check(plan.documents.some(r=>r.path===path));const ref=Object.freeze({});refs.set(ref,path);return ref;},batch(){check(!created&&!used);created=true;const writes:unknown[]=[];let poisoned=false;return {update(ref:object,data:Record<string,unknown>,condition:{lastUpdateTime:Timestamp}){
    try{const row=plan.documents[writes.length];check(!used&&row&&refs.get(ref)===row.path&&Object.keys(data).length===1&&Object.hasOwn(data,row.field));const expected=mode==='apply'?row.version:receipt.documents[writes.length].version;
      check(condition&&Object.keys(condition).length===1&&condition.lastUpdateTime instanceof Timestamp&&condition.lastUpdateTime.isEqual(validVersion(expected)));
      check(mode==='apply'?data[row.field] instanceof FieldValue&&(data[row.field] as FieldValue).isEqual(FieldValue.delete()):isDeepStrictEqual(data[row.field],row.before[row.field]));
      writes.push({update:{name:`${database}/documents/${row.path}`,fields:mode==='apply'?{}:{[row.field]:restValue(row.before[row.field])}},updateMask:{fieldPaths:[row.field]},currentDocument:{updateTime:textTime(expected)}});
    }catch(error){poisoned=true;throw error;}},async commit(){check(!used);used=true;check(!poisoned&&writes.length===9);let response:Awaited<ReturnType<Transport>>;try{response=await transport({url:`https://firestore.googleapis.com/v1/${database}/documents:commit`,method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:{writes}});}catch{throw new RemovalRestError('unknown','TRANSPORT_ERROR');}
      const body=response?.body as any;if(response?.status!==200){const status=body?.error?.status;if(typeof status==='string'&&rejectionStatuses[status]===response?.status&&body.error.code===response.status)throw new RemovalRestError('rejected',status);throw new RemovalRestError('unknown','UNKNOWN_RESPONSE');}
      if(!body||body.error||!Array.isArray(body.writeResults)||body.writeResults.length!==9)throw new RemovalRestError('unknown','INVALID_WRITE_RESULTS');
      try{return body.writeResults.map((r:any,i:number)=>{check(r&&(!Object.hasOwn(r,'transformResults')||Array.isArray(r.transformResults)&&r.transformResults.length===0));const writeTime=timestamp(r.updateTime),prior=mode==='apply'?plan.documents[i].version:receipt.documents[i].version;check(later(writeTime,prior));return {writeTime};});}catch{throw new RemovalRestError('unknown','INVALID_WRITE_RESULTS');}
    }};}} as unknown as Firestore;
}
