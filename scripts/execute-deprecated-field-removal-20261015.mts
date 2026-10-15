import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { timestamp, decodeRestValue } from './prepare-zero-item-price-dry-20261015.mts';
import { cliToken } from './diag-zero-item-price-20261015.mts';
import { encode, decode, hash } from './shared/zeroItemPriceBackup.ts';
import { SOURCE_HASHES, prepareDeprecatedFieldRemoval, checkPlan, checkReceipt, checkDeprecatedFieldRemoval, commitDeprecatedFieldRemoval, createDeprecatedFieldRemovalRestDb, RemovalRestError, type Plan, type Document, type Receipt, type Transport } from './shared/deprecatedFieldRemoval.ts';
const root='projects/taebaek-3abe4/databases/(default)/documents/';
const sourcePaths={pallets:resolve('work/pallet-inuse-originals-20261015.json'),lots:resolve('work/lots-total-originals-20261015.json')};
export const paths={plan:resolve('work/deprecated-field-removal-plan-20261015.json'),summary:resolve('../deprecated-field-removal-plan-summary-20261015.json'),lock:resolve('work/deprecated-field-removal-20261015.lock'),applyIntent:resolve('work/deprecated-field-removal-20261015.apply.intent.json'),undoIntent:resolve('work/deprecated-field-removal-20261015.undo.intent.json'),applyReceipt:resolve('work/deprecated-field-removal-20261015.apply.receipt.json'),undoReceipt:resolve('work/deprecated-field-removal-20261015.undo.receipt.json'),applyFailure:resolve('work/deprecated-field-removal-20261015.apply.failure.json'),undoFailure:resolve('work/deprecated-field-removal-20261015.undo.failure.json')};
function check(v:unknown,message='등록한 원본·실행 모드·승인 해시를 확인하세요.'):asserts v { if(!v)throw Error(message); }
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
/** 옛 도구를 실행하지 않고 실제 두 조건의 false/필드 부재 분기만 대조한다. */
export function legacyFalseBranchEquivalent(source:string){
  const tree=ts.createSourceFile('legacy.mts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);const conditions:ts.Expression[]=[];
  function visit(node:ts.Node){if(ts.isIfStatement(node)||ts.isConditionalExpression(node)){const condition=ts.isIfStatement(node)?node.expression:node.condition;if(condition.getText(tree).includes('lotsAreTotal'))conditions.push(condition);}ts.forEachChild(node,visit);}visit(tree);
  check(conditions.length===2,'옛 reader 조건이 변경되어 별도 검수가 필요합니다.');
  for(const node of conditions){check(ts.isPropertyAccessExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='h'&&node.name.text==='lotsAreTotal');
    const read=(data:Record<string,unknown>)=>Boolean(data[node.name.text]);check(read({lotsAreTotal:false})===read({}));}
  return {sourceSha:sha(source),conditions:2,equivalent:true};
}
function object(v:any){check(v&&typeof v==='object'&&!Array.isArray(v));}
export function parseOriginals(palletBackup:any,lotsBackup:any):Document[]{
  check(palletBackup?.readOnly===true&&palletBackup.collection==='pallets'&&Array.isArray(palletBackup.documents)&&palletBackup.documents.length===8);
  check(lotsBackup?.readOnly===true&&lotsBackup.atomicSnapshot===false&&Array.isArray(lotsBackup.targets)&&lotsBackup.targets.length===1);
  const original=[...palletBackup.documents,lotsBackup.targets[0].item];
  return original.map((doc:any,index)=>{object(doc);const collection=index<8?'pallets':'items';check(typeof doc.name==='string'&&doc.name.startsWith(root+collection+'/'));
    const path=doc.name.slice(root.length);check(path.split('/').length===2);const version=timestamp(doc.updateTime);object(doc.fields);
    return {path,data:Object.fromEntries(Object.entries(doc.fields).map(([key,value])=>[key,decodeRestValue(value)])),version:{seconds:version.seconds,nanoseconds:version.nanoseconds}};
  });
}
export function buildLocalPlan(palletText:string,lotsText:string):Plan{
  check(sha(palletText)===SOURCE_HASHES.pallets&&sha(lotsText)===SOURCE_HASHES.lots,'등록한 원본 파일의 SHA가 달라 계획을 만들지 않았습니다.');
  return prepareDeprecatedFieldRemoval(parseOriginals(JSON.parse(palletText),JSON.parse(lotsText)),SOURCE_HASHES);
}
export function options(args:string[]){
  const modes=args.filter(v=>['--prepare','--inspect','--apply','--undo'].includes(v));check(modes.length<=1);
  const values=new Map<string,string>();for(const arg of args){if(modes.includes(arg))continue;const i=arg.indexOf('=');check(i>0);const key=arg.slice(0,i);check(['--auth','--approved-hash'].includes(key)&&!values.has(key));values.set(key,arg.slice(i+1));}
  const mode=(modes[0]?.slice(2)??'inspect') as 'prepare'|'inspect'|'apply'|'undo';
  if(mode==='prepare')check(values.size===0);else check(values.get('--auth')==='firebase-cli');
  const approvedHash=values.get('--approved-hash');if(mode==='apply'||mode==='undo')check(typeof approvedHash==='string'&&/^[a-f0-9]{64}$/.test(approvedHash));else check(approvedHash===undefined);
  return {mode,approvedHash};
}
export async function readCurrent(plan:Plan,token:string,request:typeof fetch=fetch):Promise<Document[]>{
  checkPlan(plan);const response=await request('https://firestore.googleapis.com/v1/projects/taebaek-3abe4/databases/(default)/documents:batchGet',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({documents:plan.documents.map(r=>root+r.path)}),redirect:'error'});
  check(response.status===200,'현재 원문 조회가 실패했습니다. 쓰지 않았습니다.');const body=await response.json();check(Array.isArray(body)&&body.length===9);const seen=new Set<string>();
  const rows=body.map((entry:any)=>{object(entry);check(entry.found&&!entry.missing);const doc=entry.found;object(doc);check(typeof doc.name==='string'&&doc.name.startsWith(root));const path=doc.name.slice(root.length);check(plan.documents.some(r=>r.path===path)&&!seen.has(path));seen.add(path);object(doc.fields);const v=timestamp(doc.updateTime);return {path,data:Object.fromEntries(Object.entries(doc.fields).map(([k,v])=>[k,decodeRestValue(v)])),version:{seconds:v.seconds,nanoseconds:v.nanoseconds}};});return rows;
}
interface IO{exists:(path:string)=>boolean;read:(path:string)=>string;write:(path:string,text:string)=>void;remove:(path:string)=>void;}
const io:IO={exists:existsSync,read:p=>readFileSync(p,'utf8'),write:(p,t)=>writeFileSync(p,t,{flag:'wx'}),remove:unlinkSync};
const json=(value:unknown)=>JSON.stringify(encode(value),null,2);
function loadReceipt(files:IO,path:string,plan:Plan,mode:'apply'|'undo'):Receipt{const saved=decode(JSON.parse(files.read(path))),intent=JSON.parse(files.read(mode==='apply'?paths.applyIntent:paths.undoIntent));check(saved?.version===1&&typeof saved.operationId==='string'&&saved.operationId===intent.operationId&&intent.mode===mode&&intent.planHash===hash(plan));const receipt=saved.receipt;checkReceipt(plan,receipt,mode);return receipt;}
function verifiedCurrent(plan:Plan,current:Document[],receipt:Receipt){
  checkReceipt(plan,receipt,receipt.mode);check(current.length===9&&new Set(current.map(r=>r.path)).size===9);
  for(const row of plan.documents){const now=current.find(r=>r.path===row.path),proof=receipt.documents.find(r=>r.path===row.path)!;check(now&&isDeepStrictEqual(now.version,proof.version)&&isDeepStrictEqual(now.data,receipt.mode==='apply'?row.after:row.before),'처리 후 전체 원문과 실제 쓰기 버전을 확인하지 못했습니다. 자동 재실행하지 마세요.');}
}
export interface Dependencies{io:IO;build:typeof buildLocalPlan;token:()=>Promise<string>;read:typeof readCurrent;transport?:Transport;}
const dependencies:Dependencies={io,build:buildLocalPlan,token:cliToken,read:readCurrent};
export async function run(args:string[],dep:Dependencies=dependencies){
  check(resolve('.')===resolve(fileURLToPath(new URL('../',import.meta.url))));const opt=options(args);check(!process.env.FIRESTORE_EMULATOR_HOST,'실제 명령에 에뮬레이터 환경을 섞지 마세요.');
  const files=dep.io;
  if(opt.mode==='prepare')check(!files.exists(paths.plan)&&!files.exists(paths.summary),'검토 계획 출력이 이미 있습니다. 덮어쓰지 않았습니다.');
  const plan=dep.build(files.read(sourcePaths.pallets),files.read(sourcePaths.lots));checkPlan(plan);const planHash=hash(plan);
  const legacyProof=legacyFalseBranchEquivalent(readFileSync(new URL('./fix-lot-to-ledger.mts',import.meta.url),'utf8'));
  if(opt.mode==='prepare'){
    const text=json({version:1,planHash,plan,paths,legacyProof});const summary=JSON.stringify({version:1,companyId:'taebaek',documents:9,fields:{'items.lotsAreTotal':1,'pallets.inUse':8},sourceHashes:SOURCE_HASHES,planHash,legacyProof,productionWrites:0,deletionApproved:false},null,2);
    let written=false;try{files.write(paths.plan,text);written=true;files.write(paths.summary,summary);}catch(error){if(written&&files.read(paths.plan)===text)files.remove(paths.plan);throw error;}
    return {mode:'prepare',documents:9,writes:0,planHash};
  }
  const saved=decode(JSON.parse(files.read(paths.plan)));check(saved?.version===1&&saved.planHash===planHash&&isDeepStrictEqual(saved.plan,plan)&&isDeepStrictEqual(saved.paths,paths)&&isDeepStrictEqual(saved.legacyProof,legacyProof),'계획이 등록한 원본과 다릅니다.');
  const applyReceipt=files.exists(paths.applyReceipt)?loadReceipt(files,paths.applyReceipt,plan,'apply'):undefined;
  const undoReceipt=files.exists(paths.undoReceipt)?loadReceipt(files,paths.undoReceipt,plan,'undo'):undefined;
  if(opt.mode==='inspect'){
    const current=await dep.read(plan,await dep.token());
    if(undoReceipt)verifiedCurrent(plan,current,undoReceipt);else if(applyReceipt)verifiedCurrent(plan,current,applyReceipt);else checkDeprecatedFieldRemoval(plan,current,'apply');
    const unresolved=files.exists(paths.lock)||files.exists(paths.undoIntent)&&!undoReceipt||files.exists(paths.applyIntent)&&!applyReceipt;
    return {mode:'inspect',documents:9,writes:0,planHash,state:unresolved?'unresolved':undoReceipt?'undone':applyReceipt?'applied':'not-started'};
  }
  check(opt.approvedHash===planHash,'승인한 계획 해시가 다릅니다.');
  check(!files.exists(paths.lock),'이전 작업 잠금이 남아 있습니다. 결과를 먼저 확인하세요. 자동 재실행하지 마세요.');
  check(!undoReceipt&&!files.exists(paths.undoIntent),'복원 요청이 이미 존재합니다. 새 계획과 승인이 필요합니다.');
  if(opt.mode==='apply')check(!applyReceipt&&!files.exists(paths.applyIntent),'이미 보낸 요청입니다. 결과를 먼저 확인하세요. 자동 재실행하지 마세요.');
  else {check(applyReceipt,'실제 적용 영수증이 없어 복원하지 않습니다.');check(!files.exists(paths.applyFailure),'미확정 적용 기록을 확인하세요.');}
  const token=await dep.token();const lock=json({version:1,planHash,mode:opt.mode,operationId:randomUUID()});files.write(paths.lock,lock);
  let sent=false;
  try{
    const current=await dep.read(plan,token);checkDeprecatedFieldRemoval(plan,current,opt.mode,applyReceipt,planHash);
    const intent=opt.mode==='apply'?paths.applyIntent:paths.undoIntent,receiptPath=opt.mode==='apply'?paths.applyReceipt:paths.undoReceipt;
    files.write(intent,lock);sent=true;
    let proof:Receipt;
    try{proof=await commitDeprecatedFieldRemoval(createDeprecatedFieldRemovalRestDb({plan,mode:opt.mode,receipt:applyReceipt,token,transport:dep.transport}),plan,current,opt.mode,planHash,applyReceipt);
      verifiedCurrent(plan,await dep.read(plan,token),proof);files.write(receiptPath,json({version:1,operationId:JSON.parse(lock).operationId,receipt:proof}));
    }catch(error){const outcome=error instanceof RemovalRestError?error.outcome:'unknown';const failure=opt.mode==='apply'?paths.applyFailure:paths.undoFailure;
      try{files.write(failure,json({version:1,planHash,mode:opt.mode,outcome,operation:JSON.parse(lock).operationId}));}catch{}throw Error(outcome==='rejected'?'서버가 요청을 거절했습니다. 새 계획과 승인으로 재검토하세요.':'처리 결과가 불확실합니다. 자동 재실행하지 말고 보관된 요청과 서버 결과를 확인하세요.');}
    check(files.read(paths.lock)===lock);files.remove(paths.lock);return {mode:opt.mode,documents:9,writes:9,planHash};
  }catch(error){if(!sent&&files.exists(paths.lock)&&files.read(paths.lock)===lock)files.remove(paths.lock);throw error;}
}
export function selfCheck(){check(options(['--prepare']).mode==='prepare');check(options(['--inspect','--auth=firebase-cli']).mode==='inspect');let rejected=false;try{options(['--apply','--auth=firebase-cli']);}catch{rejected=true;}check(rejected);return {selfCheck:'passed',productionRead:false,productionWrites:0,outputWritten:false};}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(process.argv.slice(2).join(' ')==='--self-check'?selfCheck():await run(process.argv.slice(2))));}catch{console.error('필드 정리 준비 또는 실행에 실패했습니다. 등록 원본·승인·보관된 요청을 확인하세요. 자동 재실행하지 마세요.');process.exitCode=1;}}
