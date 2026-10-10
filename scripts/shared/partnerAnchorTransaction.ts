import type {Firestore,Transaction,DocumentSnapshot} from 'firebase-admin/firestore';
import {Timestamp} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import {buildVerifiedAnchor} from './partnerAnchorDry';
import type {CompanyId} from '../../src/shared/types';
export const SOURCE_COLLECTIONS=['issuedStatements','cashEntries','settlements','accounts','partners','returnOperations','returnApplications','partnerAdvanceOperations'] as const;
const COLLECTION='partnerBalanceSnapshots';
/** JSON backup preserves Firestore timestamps rather than silently changing their type. */
export function encode(value:any):any {
 if(value instanceof Timestamp)return {$timestamp:[value.seconds,value.nanoseconds]};
 if(value instanceof Date)return {$date:value.toISOString()};
 if(Array.isArray(value))return value.map(encode);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,encode(value[k])]));
 return value;
}
export function decode(value:any):any {
 if(Array.isArray(value))return value.map(decode);
 if(value&&typeof value==='object'){
  if(Object.keys(value).length===1&&Array.isArray(value.$timestamp))return new Timestamp(...value.$timestamp as [number,number]);
  if(Object.keys(value).length===1&&typeof value.$date==='string')return new Date(value.$date);
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));
 }
 return value;
}
const hash=(value:any)=>createHash('sha256').update(JSON.stringify(encode(value))).digest('hex');
const version=(s:DocumentSnapshot)=>s.exists&&s.updateTime?`${s.updateTime.seconds}:${s.updateTime.nanoseconds}`:null;
type Captured={id:string;version:string|null;data:any};
const capture=(s:DocumentSnapshot):Captured=>({id:s.id,version:version(s),data:s.exists?encode(s.data()):null});
export interface AnchorPlan {version:1;companyId:CompanyId;year:string;runId:string;actorId:string;anchorId:string;source:Record<string,Captured[]>;before:Captured;after:any;planHash:string}
function scope(companyId:string,year:string,runId:string,actorId:string){
 if(!['taebaek','punghoe'].includes(companyId)||!/^\d{4}$/.test(year)||Number(year)<2000||Number(year)>9999||!/^anchor-[A-Za-z0-9_-]{1,100}$/.test(runId)||!actorId.trim())throw new Error('회사·명시 연도·anchor- 실행ID·실제 작업자를 확인하세요.');
 if(`${year}-12-31`>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}))throw new Error('미래 결산 값을 만들 수 없습니다.');
}
async function readSource(db:Firestore,tx?:Transaction){
 const result:Record<string,Captured[]>={};
 // Stable acquisition order; all reads finish before the sole anchor write.
 for(const name of SOURCE_COLLECTIONS){const q=db.collection(name);const s=tx?await tx.get(q):await q.get();result[name]=s.docs.map(capture).sort((a,b)=>a.id.localeCompare(b.id));}
 return result;
}
async function calculate(companyId:CompanyId,year:string,source:Record<string,Captured[]>,recordedAt:string){
 const rows=Object.fromEntries(SOURCE_COLLECTIONS.map(name=>[name,source[name].map(row=>({...decode(row.data),id:row.id}))]));
 const anchor=await buildVerifiedAnchor(companyId,year,rows);
 for(const row of anchor.rows)for(const type of ['매출','매입'] as const){
  const open=row.openStmts.filter(s=>s.type===type).reduce((sum,s)=>sum+s.remaining,0);
  const balance=type==='매출'?row.receivable:row.payable;
  if(!Number.isFinite(balance)||Math.abs(open-balance)>1)throw new Error('미결 합과 거래처 잔액이 달라 결산을 보류합니다.');
 }
 return encode({...anchor,recordedAt});
}
export async function prepareAnchor(db:Firestore,companyId:CompanyId,year:string,runId:string,actorId:string):Promise<AnchorPlan>{
 scope(companyId,year,runId,actorId);
 const source=await readSource(db);const before=capture(await db.collection(COLLECTION).doc(`${companyId}-${year}`).get());
 const after=await calculate(companyId,year,source,new Date().toISOString());
 const body={version:1 as const,companyId,year,runId,actorId,anchorId:`${companyId}-${year}`,source,before,after};
 return {...body,planHash:hash(body)};
}
function validate(plan:AnchorPlan){
 scope(plan.companyId,plan.year,plan.runId,plan.actorId);
 const {planHash,...body}=plan;
 if(plan.version!==1||plan.anchorId!==`${plan.companyId}-${plan.year}`||plan.before.id!==plan.anchorId||planHash!==hash(body))throw new Error('미리보기 원문 지문이 다릅니다.');
 for(const name of SOURCE_COLLECTIONS)if(!Array.isArray(plan.source[name]))throw new Error('조회 집합이 누락되었습니다.');
}
function expectedAfter(plan:AnchorPlan){const {id:_id,...after}=plan.after;return {...after,anchorOperation:{version:1,runId:plan.runId,actorId:plan.actorId,planHash:plan.planHash}};}
function checkedApplied(plan:AnchorPlan,after:Captured){
 if(hash(after.data)!==hash(expectedAfter(plan)))throw new Error('적용 후 검토 원문이 변경되었습니다.');
}
export async function applyAnchor(db:Firestore,plan:AnchorPlan,approvedHash:string){
 validate(plan);if(approvedHash!==plan.planHash)throw new Error('검토한 계획 지문이 다릅니다.');
 return db.runTransaction(async tx=>{
  const ref=db.collection(COLLECTION).doc(plan.anchorId);const current=capture(await tx.get(ref));
  const expected=expectedAfter(plan);
  if(current.data?.anchorOperation?.runId===plan.runId){checkedApplied(plan,current);return {status:'duplicate' as const,after:current};}
  const source=await readSource(db,tx);
  if(hash(current)!==hash(plan.before)||hash(source)!==hash(plan.source))throw new Error('원자료 또는 기존 앵커가 미리보기 후 변경되었습니다.');
  if(hash(await calculate(plan.companyId,plan.year,source,plan.after.recordedAt))!==hash(plan.after))throw new Error('계산 결과가 미리보기와 다릅니다.');
  const {id:_id,...data}=decode(expected);tx.set(ref,data);
  return {status:'applied' as const};
 });
}
/** Capture the verified read version for conditional undo; this is not the transaction commit version. */
export async function captureApplied(db:Firestore,plan:AnchorPlan){
 validate(plan);const after=capture(await db.collection(COLLECTION).doc(plan.anchorId).get());
 checkedApplied(plan,after);
 return {version:1 as const,planHash:plan.planHash,after};
}
export async function undoAnchor(db:Firestore,plan:AnchorPlan,receipt:Awaited<ReturnType<typeof captureApplied>>){
 validate(plan);if(receipt.version!==1||receipt.planHash!==plan.planHash)throw new Error('복원 증명이 다릅니다.');
 checkedApplied(plan,receipt.after);
 return db.runTransaction(async tx=>{
  const ref=db.collection(COLLECTION).doc(plan.anchorId);const current=capture(await tx.get(ref));
  // An already restored before body is an idempotent retry; no revision/version is rewound.
  if(hash(current.data)===hash(plan.before.data))return 'already-restored' as const;
  if(hash(current)!==hash(receipt.after))throw new Error('적용 뒤 앵커가 변경되어 복원할 수 없습니다.');
  if(plan.before.data===null)tx.delete(ref);else tx.set(ref,decode(plan.before.data));
  return 'restored' as const;
 });
}