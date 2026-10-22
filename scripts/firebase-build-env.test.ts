import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resolveConfig, build } from 'vite';
import { FIREBASE_BUILD_VARIABLES, validateFirebaseBuildEnvironment, renderFirebaseMessagingWorker, firebaseBuildEnvironment } from './firebase-build-env';
const projectDir=resolve('.');
const values={VITE_FIREBASE_API_KEY:'demo-api',VITE_FIREBASE_AUTH_DOMAIN:'demo.invalid',VITE_FIREBASE_PROJECT_ID:'demo-build-env',VITE_FIREBASE_STORAGE_BUCKET:'demo-build-env.invalid',VITE_FIREBASE_MESSAGING_SENDER_ID:'12345',VITE_FIREBASE_APP_ID:'demo-app',VITE_FIREBASE_VAPID_KEY:'synthetic-public-vapid-not-real'};
let saved:Map<string,string|undefined>;
beforeEach(()=>{saved=new Map(FIREBASE_BUILD_VARIABLES.map(name=>[name,process.env[name]]));for(const name of FIREBASE_BUILD_VARIABLES)delete process.env[name];});
afterEach(()=>{for(const [name,value]of saved){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
function fixture(){const root=mkdtempSync(resolve('work/push-vapid-A-unit-'));writeFileSync(resolve(root,'.env'),Object.entries(values).map(([name,value])=>name+'='+value).join('\n'));writeFileSync(resolve(root,'index.html'),'<div>합성 빌드</div>');return root;}
it.each(['VITE_FIREBASE_API_KEY','VITE_FIREBASE_AUTH_DOMAIN','VITE_FIREBASE_PROJECT_ID','VITE_FIREBASE_STORAGE_BUCKET','VITE_FIREBASE_MESSAGING_SENDER_ID','VITE_FIREBASE_APP_ID','VITE_FIREBASE_VAPID_KEY'] as const)('필수 변수 %s 누락·공백은 값 노출 없이 중단한다',name=>{
 for(const value of [undefined,'','  \t ']){const env={...values,[name]:value};let message='';try{validateFirebaseBuildEnvironment(env,'audit');}catch(error){message=String(error);}expect(message).toContain(name);expect(message).toContain('audit');expect(message).not.toContain('synthetic-public-vapid-not-real');expect(message).not.toContain('demo-api');}
});
it('순수 generator는 Firebase6만 담고 VAPID와 기타 환경값을 내보내지 않는다',()=>{
 const config=validateFirebaseBuildEnvironment(values,'audit');const output=renderFirebaseMessagingWorker({...config,vapidKey:values.VITE_FIREBASE_VAPID_KEY} as typeof config,'initialize(__CONFIG__);');expect(output).toContain('demo-build-env');expect(output).not.toContain('vapid');expect(Object.keys(config)).toHaveLength(6);expect(()=>renderFirebaseMessagingWorker(config,'위치없음')).toThrow('템플릿');
});
it('실제 Vite mode/envDir/프로세스 우선순위를 적용한 config.env만 검사한다',async()=>{
 const root=fixture();writeFileSync(resolve(root,'.env.audit'),'VITE_FIREBASE_PROJECT_ID=demo-mode\nVITE_FIREBASE_APP_ID="demo mode quoted"');process.env.VITE_FIREBASE_PROJECT_ID='demo-process';const pending=resolveConfig({configFile:false,root,envDir:root,mode:'audit',plugins:[firebaseBuildEnvironment(projectDir)]},'build');await expect(pending).resolves.toMatchObject({mode:'audit',env:{VITE_FIREBASE_PROJECT_ID:'demo-process',VITE_FIREBASE_APP_ID:'demo mode quoted'}});const config=await pending;expect(resolve(config.envDir)).toBe(root);expect(config.mode).toBe('audit');expect(config.env.VITE_FIREBASE_APP_ID).toBe('demo mode quoted');expect(validateFirebaseBuildEnvironment(config.env,config.mode).projectId).toBe('demo-process');
});
it('직접 Vite build도 생성 전 VAPID 누락을 거절하고 출력 폴더를 만들지 않는다',async()=>{
 const root=fixture();writeFileSync(resolve(root,'.env'),Object.entries(values).filter(([name])=>name!=='VITE_FIREBASE_VAPID_KEY').map(([name,value])=>name+'='+value).join('\n'));const output=resolve(root,'out');await expect(build({configFile:false,root,envDir:root,mode:'audit',plugins:[firebaseBuildEnvironment(projectDir)],build:{outDir:output}})).rejects.toThrow('VITE_FIREBASE_VAPID_KEY');expect(existsSync(output)).toBe(false);
});
it('Vite 산출물의 worker는 동일 환경 cfg이고 public 원본은 바뀌지 않는다',async()=>{
 const root=fixture(),before=readFileSync(resolve('public/firebase-messaging-sw.js'));const result=await build({configFile:false,root,envDir:root,mode:'audit',logLevel:'silent',plugins:[firebaseBuildEnvironment(projectDir)],build:{write:false,outDir:resolve(root,'out')}});if(Array.isArray(result)||!('output'in result))throw Error('단일 빌드 출력이 아닙니다.');const worker=result.output.find(row=>row.fileName==='firebase-messaging-sw.js');expect(worker&&worker.type==='asset'?String(worker.source):'').toContain('demo-build-env');expect(worker&&worker.type==='asset'?String(worker.source):'').not.toContain(values.VITE_FIREBASE_VAPID_KEY);expect(readFileSync(resolve('public/firebase-messaging-sw.js'))).toEqual(before);
});

it('양앱 자동 build는 별도 fcm 생성단계를 실행하지 않아 public 원본을 덮지 않는다',()=>{
 const scripts=JSON.parse(readFileSync(resolve('package.json'),'utf8')).scripts;for(const app of ['admin','staff']){expect(scripts['build:'+app]).toBe('npx vite build --config vite.'+app+'.config.ts');}expect(scripts['fcm:sw']).toBe('node scripts/gen-fcm-sw.mjs');
});
