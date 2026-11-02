import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore as adminFirestore } from 'firebase-admin/firestore';

const interception = vi.hoisted(() => ({ dropAcknowledgement: false }));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, runTransaction: async (...args: Parameters<typeof actual.runTransaction>) => {
    const result = await actual.runTransaction(...args);
    if (interception.dropAcknowledgement) { interception.dropAcknowledgement = false; throw Error('synthetic acknowledgement loss after SDK commit'); }
    return result;
  } };
});
import { doc, setDoc, deleteDoc, Timestamp, type Firestore } from 'firebase/firestore';
import { createProjectWrites } from './projectWrites';

const enabled = process.env.PROJECTS_EMULATOR === '1', projectId = 'demo-projects-20261102', run = randomUUID();
const employee = `projects-write-${run}-employee`, business = `projects-write-${run}-project`, operation = `projects-write-${run}-operation`, sentinel = `projects-write-${run}-sentinel`;
const paths = [`employees/${employee}`, `workProjectsV1/${business}`, `workProjectsV1/${business}/operations/${operation}`, `workProjectsV1/${sentinel}`], intents = new Set<string>();
let env: RulesTestEnvironment, app: App, sentinelBefore: FirebaseFirestore.DocumentSnapshot;

describe.skipIf(!enabled)('프로젝트 실제 Web SDK 복구', () => {
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8382') throw Error('등록된 프로젝트 에뮬레이터 주소가 아닙니다.');
    env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8382, rules: readFileSync('firestore.rules','utf8') } });
    app = initializeApp({ projectId }, `projects-writes-${run}`);
    const db = adminFirestore(app);
    for (const path of paths) if ((await db.doc(path).get()).exists) throw Error(`시험 경로가 이미 존재합니다: ${path}`);
    await env.withSecurityRulesDisabled(async context => {
      const web = context.firestore(); intents.add(paths[0]); await setDoc(doc(web,paths[0]),{companyId:'taebaek',authUid:'write-uid',status:'working'});
      intents.add(paths[3]); await setDoc(doc(web,paths[3]),{companyId:'taebaek',title:'보존 sentinel',nativeTime:new Timestamp(123,987654321)});
    });
    sentinelBefore = await db.doc(paths[3]).get();
  });
  afterAll(async () => {
    if (!app || !env) return;
    const db = adminFirestore(app);
    await env.withSecurityRulesDisabled(async context => { for (const path of [...intents].sort((a,b)=>b.split('/').length-a.split('/').length)) if (path !== paths[3]) await deleteDoc(doc(context.firestore(),path)); });
    if (sentinelBefore) { const after = await db.doc(paths[3]).get(); expect(after.data()).toEqual(sentinelBefore.data()); expect(after.updateTime?.seconds).toBe(sentinelBefore.updateTime?.seconds); expect(after.updateTime?.nanoseconds).toBe(sentinelBefore.updateTime?.nanoseconds); }
    if (intents.has(paths[3])) await env.withSecurityRulesDisabled(context=>deleteDoc(doc(context.firestore(),paths[3])));
    for (const path of intents) expect((await db.doc(path).get()).exists).toBe(false);
    await env.cleanup(); await deleteApp(app);
    writeFileSync(`work/projects-write-sdk-cleanup-${run}.json`,JSON.stringify({projectId,host:'127.0.0.1:8382',paths:[...intents],sentinelBodyAndNanosecondVersionPreserved:!!sentinelBefore,ownedPathsAbsentAfterCleanup:true,ackLoss:'synthetic after actual SDK transaction'},null,2)+'\n',{flag:'wx'});
  });
  it('실거래 완료 직후 응답을 합성 소실시켜도 같은 원문 영수증을 조회하고 재적용하지 않는다', async () => {
    const web = env.authenticatedContext('write-uid',{companyId:'taebaek',employeeId:employee}).firestore(), map = new Map<string,string>(); let deferCleanup=true; const storage = {get length(){return map.size;},key:(n:number)=>[...map.keys()][n]??null,getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{if(!deferCleanup)map.delete(key);}}, scope={companyId:'taebaek' as const,actorUid:'write-uid',employeeId:employee,sessionGeneration:1};
    const api=createProjectWrites({db:web as unknown as Firestore,auth:{currentUser:{uid:'write-uid'}},storage,uuid:()=>operation,clock:()=>new Date(),current:()=>true}), entry=api.prepare(scope,{projectId:business,projectEpoch:run,action:'project.create',target:{kind:'project',id:business},expectedProjectRevision:null,expectedTargetRevision:null,input:{title:'SDK 복구',description:''}});
    intents.add(paths[1]); intents.add(paths[2]); interception.dropAcknowledgement=true;
    expect((await api.apply(scope,entry)).kind).toBe('unknown');
    expect((await api.inspect(scope,entry)).kind).toBe('applied');
    expect((await api.apply(scope,entry)).kind).toBe('applied');
    deferCleanup=false;
    expect(await api.retryCleanup(scope,entry)).toMatchObject({kind:'applied',localCleanupPending:false});
    const parent = await adminFirestore(app).doc(paths[1]).get();
    expect(parent.data()?.revision).toBe(1);
    expect((await adminFirestore(app).doc(paths[2]).get()).data()?.request.operationId).toBe(operation);
  },30000);
});
