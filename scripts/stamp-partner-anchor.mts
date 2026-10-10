/** Annual anchor maintenance. Explicit dry/apply/undo; never issues financial documents. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {getApp,deleteApp} from 'firebase-admin/app';
import {createRequire} from 'node:module';
import {adminDb} from './_admin.mts';
import type {CompanyId} from '../src/shared/types';
import type {AnchorPlan} from './shared/partnerAnchorTransaction';
const require=createRequire(import.meta.url);
const {prepareAnchor,applyAnchor,captureApplied,undoAnchor}=require('./shared/partnerAnchorTransaction.ts') as typeof import('./shared/partnerAnchorTransaction');
const {buildVerifiedAnchor}=require('./shared/partnerAnchorDry.ts') as typeof import('./shared/partnerAnchorDry');
const args=process.argv.slice(2);
const allowed=['--dry','--apply','--undo','--company=','--year=','--run-id=','--actor=','--backup=','--approve-hash=','--input='];
if(args.some(a=>!allowed.some(flag=>flag.endsWith('=')?a.startsWith(flag):a===flag))||new Set(args.map(a=>a.split('=')[0])).size!==args.length)throw new Error('알 수 없거나 중복된 인수입니다.');
const val=(name:string)=>args.find(a=>a.startsWith(name+'='))?.slice(name.length+1)??'';
const modes=args.filter(a=>['--dry','--apply','--undo'].includes(a));if(modes.length>1)throw new Error('실행 모드는 하나만 선택하세요.');
const mode=modes[0]??'--dry';const company=val('--company') as CompanyId,year=val('--year'),runId=val('--run-id'),actor=val('--actor');
if(!['taebaek','punghoe'].includes(company)||!/^\d{4}$/.test(year)||!/^anchor-[A-Za-z0-9_-]{1,100}$/.test(runId)||!actor.trim())throw new Error('company/year/run-id(anchor-)/actor를 명시하세요.');
const backup=resolve(val('--backup')||`work/partner-anchor-${company}-${year}-${runId}.json`);
const undoReceiptFile=backup+'.undone.json';
// A retained local undo receipt closes this CLI run, before credentials or DB access.
if(mode==='--apply'&&existsSync(undoReceiptFile))throw new Error('복구가 완료된 실행은 다시 적용할 수 없습니다. 새 실행 계획을 준비하세요.');
const input=val('--input');
if(input){
 if(mode!=='--dry')throw new Error('조회 파일은 미리보기 전용입니다.');
 if(`${year}-12-31`>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}))throw new Error('미래 결산 값은 만들지 않습니다.');
 const anchor=await buildVerifiedAnchor(company,year,JSON.parse(readFileSync(input,'utf8')));
 console.log(JSON.stringify({companyId:company,year,rows:anchor.rows.length,operatingWrites:0,source:'input-file; live completeness not verified'}));
 process.exit(0);
}
if(process.env.FIRESTORE_EMULATOR_HOST)throw new Error('운영 CLI는 에뮬레이터를 허용하지 않습니다. SDK는 helper를 직접 사용하세요.');
const db=adminDb();if(getApp().options.projectId!=='taebaek-3abe4')throw new Error('대상 프로젝트가 다릅니다.');
try{
 if(mode==='--dry'){
  const plan=await prepareAnchor(db,company,year,runId,actor);
  mkdirSync(dirname(backup),{recursive:true});writeFileSync(backup,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({backup,planHash:plan.planHash,companyId:company,year,rows:plan.after.rows.length,operatingWrites:0,atomicSnapshot:false}));
 }else{
  const plan=JSON.parse(readFileSync(backup,'utf8')) as AnchorPlan;
  if(plan.companyId!==company||plan.year!==year||plan.runId!==runId||plan.actorId!==actor)throw new Error('백업 회사·연도·실행ID·작업자가 다릅니다.');
  if(val('--approve-hash')!==plan.planHash)throw new Error('검토한 계획 지문을 명시하세요.');
  const receiptFile=backup+'.applied.json';
  if(mode==='--apply'){
   const result=await applyAnchor(db,plan,val('--approve-hash'));
   const receipt=await captureApplied(db,plan);
   // Keep the first captured commit version. Never overwrite an undo receipt.
   try{writeFileSync(receiptFile,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const old=JSON.parse(readFileSync(receiptFile,'utf8'));if(JSON.stringify(old)!==JSON.stringify(receipt))throw new Error('기존 적용 증명이 달라 보존합니다.');}
   console.log(JSON.stringify({status:result.status,anchorId:plan.anchorId,financialWrites:0,anchorWrites:result.status==='applied'?1:0}));
  }else {
   const status=await undoAnchor(db,plan,JSON.parse(readFileSync(receiptFile,'utf8')));
   const undoReceipt={version:1,companyId:company,year,runId,actorId:actor,planHash:plan.planHash};
   const text=JSON.stringify(undoReceipt,null,2)+'\n';
   try{writeFileSync(undoReceiptFile,text,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||readFileSync(undoReceiptFile,'utf8')!==text)throw error;}
   console.log(JSON.stringify({status,anchorId:plan.anchorId,financialWrites:0,undoReceiptFile}));
  }
 }
}finally{await deleteApp(getApp());}