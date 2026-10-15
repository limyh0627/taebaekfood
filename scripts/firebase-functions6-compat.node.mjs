import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, join, relative, sep, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const baseline = join(root, 'work/firebase-functions6-baseline-20261015');
const candidate = join(root, 'work/firebase-functions6-candidate-20261015');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
function ordinary(path) {
  assert.equal(lstatSync(path).isSymbolicLink(), false, '격리 자료에 연결 경로가 없어야 한다');
  assert.equal(realpathSync(path), resolve(path), '격리 자료가 자기 경로에 있어야 한다');
}
function inside(parent, child) {
  const rel = relative(parent, child);
  assert.ok(rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel), 'SDK는 격리 폴더 안에서 해석해야 한다');
}
function verifyIsolation(directory, version) {
  ordinary(directory);
  ordinary(join(directory, 'node_modules'));
  const manifest = json(join(directory, 'source-manifest.json'));
  for (const [name, sha] of Object.entries(manifest.selected)) {
    if (name === 'package.json' || name === 'package-lock.json') continue;
    ordinary(join(directory, name));
    assert.equal(hash(join(directory, name)), sha, '복사한 제품 소스는 동일해야 한다');
    assert.equal(hash(join(root, 'functions', name)), sha, '검사 중 제품 소스는 고정해야 한다');
  }
  const require = createRequire(join(directory, 'package.json'));
  for (const name of ['firebase-functions', 'firebase-admin', 'typescript']) {
    const entry = realpathSync(require.resolve(name));
    inside(directory, entry);
    assert.equal(json(join(directory, 'node_modules', name, 'package.json')).version,
      name === 'firebase-functions' ? version : name === 'firebase-admin' ? '12.7.0' : '5.9.3');
  }
  for (const name of ['firebase-functions', 'firebase-admin', 'typescript']) {
    assert.equal(hash(join(root, 'functions/node_modules', name, 'package.json')), manifest.shared[name].sha, '공유 설치 원본을 보존해야 한다');
  }
  for (const name of ['node_modules', 'functions/node_modules']) assert.equal(realpathSync(join(root, name)), manifest.shared[name].realpath);
  return manifest;
}
const child = String.raw`
let blockedCalls=0;
const blocked=()=>{blockedCalls++;throw Error('외부 호출 금지');};
for(const name of ['node:http','node:https']){const m=require(name);m.request=blocked;m.get=blocked;}
const net=require('node:net'),connect=net.Socket.prototype.connect;let localPort;
net.Socket.prototype.connect=function(...args){const first=Array.isArray(args[0])?args[0][0]:args[0];const host=typeof first==='object'?first.host:args[1];const port=typeof first==='object'?first.port:first;if(host!=='127.0.0.1'||Number(port)!==localPort||localPort===undefined)return blocked();return connect.apply(this,args);};
require('node:tls').connect=blocked;
const dns=require('node:dns'),lookup=dns.lookup;dns.lookup=(host,...args)=>host==='127.0.0.1'?lookup(host,...args):blocked();dns.resolve=blocked;
const localFetch=global.fetch;
global.fetch=blocked;
for(const name of ['log','info','warn','debug','error'])console[name]=()=>{};
const sdk=require('firebase-functions/v2/https');
const exportsMap=require('./lib/index.js');

const manifest=Object.fromEntries(Object.entries(exportsMap).sort(([a],[b])=>a.localeCompare(b)).map(([name,fn])=>{
 if(typeof fn!=='function'||!fn.__endpoint)throw Error('함수 선언 누락');
 const endpoint=fn.__endpoint;
 return [name,{endpoint,hasRequiredAPIs:Object.hasOwn(fn,'__requiredAPIs'),requiredAPIs:fn.__requiredAPIs}];
}));
const express=require('express'),app=express();app.use(express.json());
for(const mode of ['ok','error','auth'])app.use('/'+mode,sdk.onCall({region:'asia-northeast3',cors:['https://synthetic.invalid']},async request=>{
  if(mode==='auth'&&!request.auth)throw new sdk.HttpsError('unauthenticated','로그인 필요');
  if(mode==='error')throw new sdk.HttpsError('failed-precondition','합성 충돌',{reason:'SYNTHETIC'});
  return {received:request.data};
}));
async function invoke(body,mode='ok',method='POST',origin='https://synthetic.invalid'){
 const response=await localFetch('http://127.0.0.1:'+localPort+'/'+mode,{method,headers:{'content-type':'application/json',origin},...(['GET','OPTIONS'].includes(method)?{}:{body:JSON.stringify(body)})});
 const text=await response.text();const headers=Object.fromEntries(['content-type','access-control-allow-origin','access-control-allow-methods','access-control-allow-headers','vary'].filter(name=>response.headers.has(name)).map(name=>[name,response.headers.get(name)]));
 return {status:response.status,body:text?JSON.parse(text):null,headers};
}
(async()=>{
 const server=require('node:http').createServer(app);
 try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});localPort=server.address().port;
 const cases={success:await invoke({data:{newPo:null,quantity:2}}),nullData:await invoke({data:null}),invalid:await invoke({other:1}),wrongMethod:await invoke({data:{}},'ok','GET'),explicitError:await invoke({data:{}},'error'),missingAuth:await invoke({data:{}},'auth'),preflight:await invoke(undefined,'ok','OPTIONS'),otherOrigin:await invoke({data:1},'ok','POST','https://other.invalid')};
 process.stdout.write(JSON.stringify({manifest,cases,node:process.version,transport:'loopback-http-json',productHandlersInvoked:false,externalCalls:blockedCalls},(_key,value)=>value===undefined?{sdkUndefined:true}:value));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));localPort=undefined;}
})().catch(()=>{process.stderr.write('격리 SDK 검사 실패');process.exitCode=1;});
`;
function probe(directory) {
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
    GCLOUD_PROJECT: 'demo-sdk6-compat', GOOGLE_CLOUD_PROJECT: 'demo-sdk6-compat',
    FIREBASE_CONFIG: JSON.stringify({projectId:'demo-sdk6-compat',storageBucket:'demo-sdk6-compat.invalid'}),
    FIREBASE_DEBUG_MODE: 'false' };
  const result = spawnSync(process.execPath, ['-e', child], {cwd:directory,env,encoding:'utf8',timeout:30000});
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('원본 공유 설치와 두 격리 SDK 및 제품 소스 경계를 검증한다', () => {
  assert.match(process.version, /^v22\./);
  const first=verifyIsolation(baseline,'5.1.1'),second=verifyIsolation(candidate,'6.6.0');
  assert.deepEqual(first,second);
  for(const name of ['package.json','package-lock.json'])assert.equal(hash(join(root,'functions',name)),first.selected[name], '검토 단계에서는 원본 의존성을 바꾸지 않는다');
});

test('같은 제품 소스를 각 실제 SDK로 컴파일한다', () => {
  for (const [directory, version] of [[baseline,'5.1.1'],[candidate,'6.6.0']]) {
    verifyIsolation(directory,version);
    const result=spawnSync(process.execPath,[join(directory,'node_modules/typescript/bin/tsc'),'--project',join(directory,'tsconfig.json')],{cwd:directory,encoding:'utf8',timeout:60000});
    assert.equal(result.status,0,result.stdout+result.stderr);
  }
});

test('실제 함수 선언과 합성 Callable HTTP·오류·CORS 결과가 같다', t => {
  const before=probe(baseline),after=probe(candidate);
  assert.ok(Object.keys(before.manifest).length>0);
  t.diagnostic('비교한 제품 함수 선언 '+Object.keys(before.manifest).length+'개, 합성 HTTP 사례 '+Object.keys(before.cases).length+'개');
  assert.deepEqual(after.manifest,before.manifest);
  assert.deepEqual(after.cases,before.cases);
  assert.equal(after.cases.success.status,200);
  assert.deepEqual(after.cases.success.body,{result:{received:{newPo:null,quantity:2}}});
  assert.equal(after.cases.invalid.status,400);
  assert.equal(after.cases.wrongMethod.status,400);
  assert.equal(after.cases.explicitError.status,400);
  assert.equal(after.cases.explicitError.body.error.status,'FAILED_PRECONDITION');
  assert.equal(after.cases.explicitError.body.error.details.reason,'SYNTHETIC');
  assert.equal(after.cases.missingAuth.status,401);
  assert.equal(after.cases.preflight.status,204);
  assert.equal(after.cases.success.headers['access-control-allow-origin'],'https://synthetic.invalid');
  assert.equal(after.cases.otherOrigin.headers['access-control-allow-origin'],'https://synthetic.invalid');
  assert.equal(after.productHandlersInvoked,false);
  assert.equal(before.transport,'loopback-http-json');assert.equal(after.transport,'loopback-http-json');
  assert.equal(before.externalCalls,0);assert.equal(after.externalCalls,0);
  verifyIsolation(baseline,'5.1.1');verifyIsolation(candidate,'6.6.0');
});
