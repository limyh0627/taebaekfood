#!/usr/bin/env -S node --import tsx
/** 읽기 전용 CLI. 기존 CLI OAuth만 재사용하며 ADC·키 파일로 우회하지 않는다. */
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join,relative,isAbsolute} from 'node:path';
import {createRequire} from 'node:module';
import type {ManualBoxCorrectionFacts} from '../functions/src/shared/orderConfirmedBoxCorrectionPlan';
const args=process.argv.slice(2),allowed=new Set(['--facts','--output','--project','--now','--readonly']);
async function main(){
 const local=createRequire(import.meta.url),{fullCodec,fullHash}=local('../functions/src/shared/orderStockFullPlan.ts') as typeof import('../functions/src/shared/orderStockFullPlan'),{readOrderConfirmedBoxCorrection}=local('../functions/src/shared/orderConfirmedBoxCorrectionRead.ts') as typeof import('../functions/src/shared/orderConfirmedBoxCorrectionRead');
 if(process.versions.node.split('.')[0]!=='22')throw Error('node22-required');
 const seen=new Set<string>();for(let i=0;i<args.length;i++){const key=args[i];if(!allowed.has(key)||seen.has(key))throw Error('invalid-cli-options');seen.add(key);if(key==='--readonly')continue;if(i+1>=args.length||args[i+1].startsWith('--')||!args[i+1])throw Error('missing-cli-option-value');i++;}
 const option=(key:string)=>{const i=args.indexOf(key);return i<0?undefined:args[i+1];};
 if(!args.includes('--readonly')||process.env.GOOGLE_APPLICATION_CREDENTIALS)throw Error('readonly-explicit-no-key-required');
 const factsPath=option('--facts'),output=option('--output'),project=option('--project');if(!factsPath||!output||!project)throw Error('facts-output-project-required');
 const demo=project.startsWith('demo-'),host=process.env.FIRESTORE_EMULATOR_HOST;
 if(demo?host!=='127.0.0.1:8288':project!=='taebaek-3abe4'||!!host||!!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('project-loopback-read-scope-mismatch');
 const root=process.cwd(),outputPath=resolve(output),privateRoot=resolve(root,'privatework'),workRoot=resolve(root,'work'),within=(base:string)=>{const p=relative(base,outputPath);return !!p&&!p.startsWith('..')&&!isAbsolute(p);};if(!(within(privateRoot)||demo&&within(workRoot)))throw Error('private-new-output-path-required');
 const facts=JSON.parse(readFileSync(resolve(factsPath),'utf8')) as ManualBoxCorrectionFacts,now=option('--now')??new Date().toISOString(),req=createRequire(resolve('functions/package.json'));
 const versions={firestore:req('@google-cloud/firestore/package.json').version,auth:req('google-auth-library/package.json').version,gax:req('google-gax/package.json').version};if(versions.firestore!=='7.11.6'||versions.auth!=='9.15.1'||versions.gax!=='4.6.1')throw Error('reviewed-sdk-version-required');
 const {Firestore}=req('@google-cloud/firestore'),{OAuth2Client}=req('google-auth-library');let db:any;
 if(demo)db=new Firestore({projectId:project});else{
  const authPath=process.env.APPDATA&&join(process.env.APPDATA,'npm','node_modules','firebase-tools','lib','auth.js');if(!authPath||!existsSync(authPath))throw Error('existing-cli-auth-module-required');const cli=req(authPath),refresh=cli.getProjectDefaultAccount(root)?.tokens?.refresh_token;if(typeof refresh!=='string'||!refresh)throw Error('existing-cli-session-required');const access=(await cli.getAccessToken(refresh,['https://www.googleapis.com/auth/cloud-platform']))?.access_token;if(typeof access!=='string'||!access||access===refresh)throw Error('existing-cli-read-token-unavailable');const client=new OAuth2Client();client.setCredentials({access_token:access});db=new Firestore({projectId:project,authClient:client,preferRest:true});
 }
 try{const result=await db.runTransaction((tx:any)=>readOrderConfirmedBoxCorrection(tx,db,facts,{now}),{readOnly:true,maxAttempts:1}),nativeResultText=fullCodec(db).text(result),summary=result.status==='dry-planned'?{status:result.status,bookQuantities:result.bookQuantities,differences:result.differences,requestHash:result.requestHash,planHash:result.planHash}:{status:result.status,reason:result.reason};mkdirSync(dirname(outputPath),{recursive:true});writeFileSync(outputPath,JSON.stringify({kind:'confirmed-box-correction-readonly-dry-v1',project,readOnlyTransaction:true,operatingWrites:0,executionAllowed:false,nativeResultText,nativeResultHash:fullHash(nativeResultText),summary},null,2),{flag:'wx'});console.log(JSON.stringify({output:outputPath,status:result.status,executionAllowed:false,...(result.status==='dry-planned'?{requestHash:result.requestHash,planHash:result.planHash,readCount:result.readSet.length}:{reason:result.reason})}));}finally{await db.terminate();}
}
main().catch(()=>{console.error('confirmed-box-correction-readonly-cli-failed');process.exitCode=1;});
