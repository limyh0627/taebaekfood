import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,unlinkSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Timestamp} from 'firebase-admin/firestore';
import {cliToken} from './diag-zero-item-price-20261015.mts';
import {readFullItems} from './prepare-zero-item-price-dry-20261015.mts';
import {decode,encode,hash,resolveZeroItemPriceBackupPath} from './shared/zeroItemPriceBackup.ts';
import {checkPlan,checkMigrationState,commitZeroItemPrice,type Plan,type Applied,type Document} from './shared/zeroItemPriceMigration.ts';
import {createZeroItemPriceRestDb,ZeroPriceRestError} from './shared/zeroItemPriceRest.ts';

type Mode='inspect'|'apply'|'undo';
interface FileIO{exists:(path:string)=>boolean;read:(path:string)=>string;write:(path:string,text:string)=>void;remove:(path:string)=>void;list:()=>string[];}
const files:FileIO={exists:existsSync,read:path=>readFileSync(path,'utf8'),write:(path,text)=>writeFileSync(path,text,{flag:'wx'}),remove:unlinkSync,list:()=>readdirSync(resolve('work')).map(name=>resolve('work',name))};
function check(value:unknown,message='실행 원문과 승인 정보를 확인하세요.'):asserts value{if(!value)throw Error(message);}
export function options(args:string[]){
 const modes=args.filter(value=>['--apply','--undo','--inspect'].includes(value));check(modes.length<=1);
 const releaseVerifiedLock=args.includes('--release-verified-lock');check(args.filter(value=>value==='--release-verified-lock').length<=1);
 const values=new Map<string,string>();for(const arg of args){if(modes.includes(arg)||arg==='--release-verified-lock')continue;const index=arg.indexOf('=');check(index>0);const key=arg.slice(0,index);check(['--auth','--company','--backup','--approved-hash'].includes(key)&&!values.has(key));values.set(key,arg.slice(index+1));}
 check(values.get('--auth')==='firebase-cli');const company=values.get('--company');check(company==='taebaek'||company==='punghoe');
 check(values.has('--backup'));const location=resolveZeroItemPriceBackupPath(company,values.get('--backup')!),backup=location.path;
 const mode:Mode=modes[0]==='--apply'?'apply':modes[0]==='--undo'?'undo':'inspect',approvedHash=values.get('--approved-hash');
 check(!releaseVerifiedLock||mode==='inspect');check(mode==='inspect'||typeof approvedHash==='string'&&/^[a-f0-9]{64}$/.test(approvedHash));return {company:company as Plan['companyId'],backup,mode,approvedHash,family:location.family,releaseVerifiedLock};
}
function receipt(text:string,plan:Plan,planHash:string):Applied{
 const value=decode(JSON.parse(text));check(value&&value.version===1&&value.planHash===planHash&&Array.isArray(value.documents)&&value.documents.length===plan.documents.length,'보관된 적용 영수증을 확인할 수 없습니다. 자동 재실행하지 마세요.');
 check(new Set(value.documents.map((row:any)=>row.id)).size===plan.documents.length);
 for(const [index,row]of value.documents.entries()){
  check(row.id===plan.documents[index].id&&row.version&&Number.isSafeInteger(row.version.seconds)&&Number.isInteger(row.version.nanoseconds)&&row.version.nanoseconds>=0&&row.version.nanoseconds<1e9);
  new Timestamp(row.version.seconds,row.version.nanoseconds);
 }
 return value;
}
function progress(proof:Applied,previous:{id:string;version:{seconds:number;nanoseconds:number}}[]){
 for(const [index,row]of proof.documents.entries()){
  const prior=previous[index];check(prior&&row.id===prior.id&&(row.version.seconds>prior.version.seconds||row.version.seconds===prior.version.seconds&&row.version.nanoseconds>prior.version.nanoseconds),'적용 영수증의 원문 버전 연결을 확인하세요.');
 }
}
const reason:Record<string,string>={INVALID_ARGUMENT:'서버가 요청 형식을 거절했습니다.',FAILED_PRECONDITION:'현재 원문 버전 등 서버 처리 조건이 맞지 않습니다.',OUT_OF_RANGE:'서버가 허용 범위를 벗어난 요청을 거절했습니다.',UNAUTHENTICATED:'로그인 인증을 확인하세요.',PERMISSION_DENIED:'현재 계정의 권한이 거절되었습니다.',NOT_FOUND:'처리 대상이 존재하지 않습니다.',ALREADY_EXISTS:'기존 처리와 충돌했습니다.',ABORTED:'서버가 원자 요청을 거절했습니다.'};
const allowedCodes=new Set([...Object.keys(reason),'INVALID_ADAPTER_INPUT','INVALID_ADAPTER_WRITE','INCOMPLETE_ADAPTER_BATCH','ADAPTER_ALREADY_USED','UNKNOWN_RESPONSE','TRANSPORT_ERROR','INVALID_WRITE_RESULTS']);
const safeCode=(value:string)=>allowedCodes.has(value)?value:'UNKNOWN_RESPONSE';
function linkedRecord(row:any,mode:string,planHash:string,operationId:string,company?:string){return row&&row.version===1&&row.mode===mode&&row.planHash===planHash&&row.operationId===operationId&&(!company||row.companyId===company);}
function terminalRejection(io:FileIO,backup:string,mode:string,planHash:string,company:string){
 try{
  const path=backup+`.rest-${mode}.rejected.json`;if(!io.exists(path))return undefined;const marker=JSON.parse(io.read(path));
  const validCode=marker.outcome==='rejected'?Object.hasOwn(reason,marker.code):marker.outcome==='not-started'&&['INVALID_ADAPTER_INPUT','INVALID_ADAPTER_WRITE','INCOMPLETE_ADAPTER_BATCH','ADAPTER_ALREADY_USED'].includes(marker.code);
  if(!validCode||typeof marker.operationId!=='string'||!marker.operationId||!linkedRecord(marker,mode,planHash,marker.operationId))return undefined;
  const intentPath=backup+`.rest-${mode}.intent.json`,lockPath=backup+'.rest.lock';
  if(!io.exists(intentPath)&&marker.outcome!=='not-started')return undefined;
  if(io.exists(intentPath)&&!linkedRecord(JSON.parse(io.read(intentPath)),mode,planHash,marker.operationId,company))return undefined;
  if(io.exists(lockPath)&&!linkedRecord(JSON.parse(io.read(lockPath)),mode,planHash,marker.operationId))return undefined;
  return {code:marker.code as string,operationId:marker.operationId as string};
 }catch{return undefined;}
}
function operationProof(io:FileIO,backup:string,planHash:string,company:string,applied?:Applied,undone?:Applied,ignoreLockText?:string){
 const lockPath=backup+'.rest.lock';
  const existingLock=io.exists(lockPath)?io.read(lockPath):undefined,lockText=existingLock===ignoreLockText?undefined:existingLock;let lock:any,unknown=false;
  try{if(lockText!==undefined){lock=JSON.parse(lockText);if(lock.version!==1||lock.planHash!==planHash||!['apply','undo'].includes(lock.mode)||typeof lock.operationId!=='string'||!lock.operationId)unknown=true;}}catch{unknown=true;}
  const rejected:Array<{mode:string;code:string}>=[];
  for(const mode of ['apply','undo']){
   const intentPath=backup+`.rest-${mode}.intent.json`;let intent:any;
   try{if(io.exists(intentPath)){intent=JSON.parse(io.read(intentPath));if(!linkedRecord(intent,mode,planHash,intent.operationId,company)||typeof intent.operationId!=='string'||!intent.operationId)unknown=true;}}catch{unknown=true;}
   const proof=mode==='apply'?applied:undone,pending=!!intent||io.exists(intentPath)||lock?.mode===mode;
   if(proof){if(pending&&(!intent||lock?.mode===mode&&!linkedRecord(lock,mode,planHash,intent.operationId)))unknown=true;continue;}
   const terminal=terminalRejection(io,backup,mode,planHash,company);
   if(terminal)rejected.push({mode,code:terminal.code});
   else if(pending||io.exists(backup+`.rest-${mode}.rejected.json`))unknown=true;
  }
 return {lockText,lock,unknown,rejected};
}
export interface Dependencies{io:FileIO;token:typeof cliToken;read:typeof readFullItems;adapter:typeof createZeroItemPriceRestDb;uuid:()=>string;}
const defaults:Dependencies={io:files,token:cliToken,read:readFullItems,adapter:createZeroItemPriceRestDb,uuid:randomUUID};
export async function execute(args:string[],dependencies:Dependencies=defaults){
 const input=options(args),{io}=dependencies;check(!process.env.FIRESTORE_EMULATOR_HOST);const original=io.read(input.backup),saved=decode(JSON.parse(original.replace(/^\uFEFF/,'')));
 check(saved&&saved.plan&&typeof saved.planHash==='string');const plan=saved.plan as Plan;checkPlan(plan);const planHash=hash(plan);
 check(saved.planHash===planHash&&plan.companyId===input.company&&(!input.approvedHash||input.approvedHash===planHash));
 const paths={lock:input.backup+'.rest.lock',applied:input.backup+'.applied.json',undone:input.backup+'.undone.json',intent:input.backup+`.rest-${input.mode}.intent.json`,rejected:input.backup+`.rest-${input.mode}.rejected.json`};
 const applied=io.exists(paths.applied)?receipt(io.read(paths.applied),plan,planHash):undefined,undone=io.exists(paths.undone)?receipt(io.read(paths.undone),plan,planHash):undefined;
 check(!undone||applied,'복원 영수증의 최초 적용 근거가 없습니다. 자동 재실행하지 마세요.');
 if(applied)progress(applied,plan.documents);if(undone)progress(undone,applied!.documents);
 const base={companyId:input.company,mode:input.mode,planHash,documents:plan.documents.length};
 const readCurrent=async(token:string):Promise<Document[]>=>{const result=await dependencies.read(token);const expected=new Set(plan.documents.map(row=>row.id));return result.documents.filter(row=>expected.has(row.id));};
 const checkFamily=()=>{
  const siblings=new Set<string>();
  for(const path of io.list()){
   const match=/^(.*\.json)(?:\.rest\.lock|\.rest-(?:apply|undo)\.intent\.json)$/.exec(path);if(!match||match[1]===input.backup)continue;
   try{const location=resolveZeroItemPriceBackupPath(input.company,match[1]);if(location.family===input.family)siblings.add(location.path);}catch{/* 다른 회사·날짜의 파일은 이 계획 가족이 아니다. */}
  }
  for(const backup of siblings){
   const saved=decode(JSON.parse(io.read(backup))),other=saved.plan as Plan;checkPlan(other);const otherHash=hash(other);check(saved.planHash===otherHash&&other.companyId===input.company);
   check(!io.exists(backup+'.rest.lock'),'같은 회사의 이전 revision 실행 잠금이 남아 있습니다. 다른 실행의 처리 결과를 확인하고 새 revision으로 우회하지 마세요.');
   const undonePath=backup+'.undone.json',appliedPath=backup+'.applied.json';
   const appliedProof=io.exists(appliedPath)?receipt(io.read(appliedPath),other,otherHash):undefined;
   const undoneProof=io.exists(undonePath)?receipt(io.read(undonePath),other,otherHash):undefined;check(!undoneProof||appliedProof);
   if(appliedProof)progress(appliedProof,other.documents);if(undoneProof)progress(undoneProof,appliedProof!.documents);
   const lockPath=backup+'.rest.lock',lock=io.exists(lockPath)?JSON.parse(io.read(lockPath)):undefined;
   if(lock)check(lock.version===1&&lock.planHash===otherHash&&['apply','undo'].includes(lock.mode)&&typeof lock.operationId==='string');
   for(const mode of ['apply','undo']){
    const intentPath=backup+`.rest-${mode}.intent.json`,intent=io.exists(intentPath)?JSON.parse(io.read(intentPath)):undefined;
    if(!intent&&lock?.mode!==mode)continue;
    if(intent)check(intent.version===1&&intent.planHash===otherHash&&intent.mode===mode&&intent.companyId===input.company&&typeof intent.operationId==='string'&&intent.operationId.length>0);
    if(mode==='apply'?appliedProof:undoneProof)continue;
    const terminal=terminalRejection(io,backup,mode,otherHash,input.company);
    check(terminal,'같은 회사의 이전 revision에 미확인 전송 의도나 잠금이 있습니다. 새 revision으로 우회하지 말고 처리 결과부터 확인하세요.');
   }
  }
 };
 if(input.mode==='inspect'||input.mode==='apply'&&applied||input.mode==='undo'&&undone){
  const {lockText,lock,unknown,rejected}=operationProof(io,input.backup,planHash,input.company,applied,undone);
  if(unknown)return {...base,status:'unknown',writes:null,message:'완료 영수증과 연결되지 않은 적용 또는 복원 의도·잠금이 남아 있습니다. 기존 기록을 보존하고 처리 결과부터 확인하세요. 자동 재실행하지 마세요.'};
  let current:Document[];
  try{
   current=await readCurrent(await dependencies.token());
   if(applied||undone){
    checkMigrationState(plan,current,undone?'undone':'duplicate',undone??applied,planHash);
    let lockReleased=false;
    if(input.releaseVerifiedLock&&lockText!==undefined){
     const proof=lock?.mode==='undo'?undone:applied,intentPath=input.backup+`.rest-${lock.mode}.intent.json`;
     check(proof&&io.exists(intentPath)&&linkedRecord(JSON.parse(io.read(intentPath)),lock.mode,planHash,lock.operationId,input.company),'완료된 영수증과 실행 잠금의 연결을 확인할 수 없습니다.');
     check(io.exists(paths.lock)&&io.read(paths.lock)===lockText,'확인 중 잠금이 바뀌어 삭제하지 않았습니다.');io.remove(paths.lock);lockReleased=true;
    }
    return {...base,status:undone?'undone':'applied',writes:0,...(input.releaseVerifiedLock?{lockReleased}:{}),...(rejected.length?{code:rejected[0].code,message:'이전 요청 중 거절된 처리가 있습니다. 완료된 영수증과 현재 자료는 대조했습니다. 새 작업에는 새 dry·승인이 필요합니다.'}:{})};
   }
  }catch{
   if(applied||undone)return {...base,status:'verification-failed',writes:0,message:'서버 처리 영수증은 보관되어 있습니다. 현재 원문·버전 또는 잠금 연결 대조를 완료하지 못했습니다. 같은 요청을 다시 보내지 말고 로그인·현재 자료를 확인한 뒤 inspect로 대조하세요.'};
   throw Error('읽기 확인을 완료하지 못했습니다. 적용 요청은 보내지 않았습니다.');
  }
  if(rejected.length){const code=rejected[0].code;return {...base,status:'rejected',writes:0,code,message:(reason[code]??'전송 전 요청 검증에 실패했습니다.')+' 이전 요청은 반영되지 않았습니다. 원인을 해결한 뒤 새 dry·승인을 준비하세요.'};}
  check(!input.releaseVerifiedLock,'완료 영수증 없이 실행 잠금을 삭제하지 않습니다.');checkMigrationState(plan,current,'apply');return {...base,status:'ready',writes:0};
 }
 check(!operationProof(io,input.backup,planHash,input.company,applied,undone).unknown,'같은 백업의 적용 또는 복원 결과가 미확인입니다. 다른 mode로 우회하지 말고 처리 결과부터 확인하세요.');
 check(input.mode!=='apply'||!undone,'이미 복원된 계획은 다시 적용하지 않습니다. 새 dry와 승인을 준비하세요.');
 check(input.mode!=='undo'||applied,'복원에는 최초 적용 영수증이 필요합니다.');
 checkFamily();
 check(!io.exists(paths.lock)&&!io.exists(paths.intent)&&!io.exists(paths.rejected),'이전 잠금 또는 전송 의도가 남아 있습니다. 자동 재실행하지 마세요. 새 dry·승인 또는 처리 결과 확인이 필요합니다.');
 const operationId=dependencies.uuid(),lock=JSON.stringify({version:1,operationId,mode:input.mode,planHash});io.write(paths.lock,lock);
 let sent=false,intentWritten=false,confirmed:Applied|undefined;
 const ownLock=()=>io.exists(paths.lock)&&io.read(paths.lock)===lock;
 const release=()=>{check(ownLock(),'실행 잠금이 변경되어 삭제하지 않았습니다.');io.remove(paths.lock);};
 try{
  const token=await dependencies.token(),all=await dependencies.read(token),ids=new Set(plan.documents.map(row=>row.id)),current=all.documents.filter(row=>ids.has(row.id));checkFamily();checkMigrationState(plan,current,input.mode,applied,planHash);
  check(!operationProof(io,input.backup,planHash,input.company,applied,undone,lock).unknown,'확인 중 다른 mode의 미확인 의도가 생겼습니다. 전송하지 않았습니다.');
  check(io.read(input.backup)===original&&ownLock(),'백업 또는 실행 잠금이 바뀌었습니다. 전송하지 않았습니다.');
  const db=plan.documents.length?dependencies.adapter({plan,mode:input.mode,receipt:applied,token}):undefined;
  io.write(paths.intent,JSON.stringify({version:1,operationId,mode:input.mode,companyId:input.company,planHash}));intentWritten=true;
  sent=true;confirmed=await commitZeroItemPrice(db!,plan,current,input.mode,planHash,applied);
  receipt(JSON.stringify(encode(confirmed)),plan,planHash);
  io.write(input.mode==='apply'?paths.applied:paths.undone,JSON.stringify(encode(confirmed),null,2));
  try{checkMigrationState(plan,await readCurrent(token),input.mode==='apply'?'duplicate':'undone',confirmed,planHash);}
  catch{return {...base,status:'verification-failed',writes:plan.documents.length,message:'서버 적용 영수증은 보관했습니다. 사후 대조를 완료하지 못했습니다. 같은 요청을 다시 보내지 말고 inspect로 확인하세요.'};}
  release();return {...base,status:input.mode==='apply'?'applied':'undone',writes:plan.documents.length};
 }catch(error){
  if(error instanceof ZeroPriceRestError&&(error.outcome==='rejected'||error.outcome==='not-started')){
   const code=safeCode(error.code);io.write(paths.rejected,JSON.stringify({version:1,operationId,mode:input.mode,planHash,outcome:error.outcome,code}));release();
   return {...base,status:'rejected',writes:0,code,message:(reason[code]??'전송 전 요청 검증에 실패했습니다.')+' 기존 백업과 생성된 처리 기록을 보존했습니다. 원인을 해결한 뒤 새 dry·승인을 준비하세요.'};
  }
  if(!sent&&!intentWritten&&!io.exists(paths.intent)){release();throw Error('전송 전 읽기·원문 검증에 실패했습니다. 적용 요청은 보내지 않았습니다.');}
  return {...base,status:'unknown',writes:null,message:confirmed?'서버 응답은 받았으나 영수증 저장을 확인하지 못했습니다. 잠금과 전송 의도를 보존했습니다. 자동 재실행하지 마세요.':'전송 후 결과를 확인하지 못했습니다. 잠금과 전송 의도를 보존했습니다. 자동 적용·복원을 다시 실행하지 마세요.'};
 }
}
export function selfCheck(){
 const company='taebaek',backup=resolve(`work/zero-item-price-${company}-20261015.json`);assert.equal(options(['--auth=firebase-cli','--company='+company,'--backup='+backup]).mode,'inspect');assert.throws(()=>options(['--apply','--auth=firebase-cli','--company='+company,'--backup='+backup]));
 return {selfCheck:'passed',productionRead:false,productionWrite:false,productionOutputWritten:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const result=process.argv.length===3&&process.argv[2]==='--self-check'?selfCheck():await execute(process.argv.slice(2));console.log(JSON.stringify(result));if('status'in result&&['unknown','rejected','verification-failed'].includes(result.status))process.exitCode=1;}
 catch{console.error('실행을 완료하지 못했습니다. 회사·승인 hash·백업과 기존 처리 기록을 확인하세요. 기존 기록을 임의 삭제하거나 자동 재실행하지 마세요.');process.exitCode=1;}
}
