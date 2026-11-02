import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where, orderBy, limit, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp, type Firestore } from 'firebase/firestore';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore as adminFirestore } from 'firebase-admin/firestore';
import { createProjectWrites } from '../features/projects/services/projectWrites';

const enabled = process.env.PROJECTS_EMULATOR === '1';
const projectId = 'demo-projects-20261102';
const runId = randomUUID();
const names = { member: `projects-${runId}-member`, other: `projects-${runId}-other`, admin: `projects-${runId}-admin`, foreign: `projects-${runId}-foreign`, project: `projects-${runId}-project`, sentinel: `projects-${runId}-sentinel` };
const created = [`projects-${runId}-create-a`, `projects-${runId}-create-b`], operations = [`projects-${runId}-operation-a`, `projects-${runId}-operation-b`];
const taskId = `projects-${runId}-task`, checkId = `projects-${runId}-check`, commentId = `projects-${runId}-comment`, taskOps = Array.from({length: 11}, (_, i) => `projects-${runId}-task-op-${i}`);
const rogueIds = [`projects-${runId}-rogue-a`, `projects-${runId}-rogue-b`], rogueOp = `projects-${runId}-rogue-op`;
const lateOp = `projects-${runId}-late-op`;
const bigId = `projects-${runId}-big`, bigTask = `projects-${runId}-big-task`, bigComment = `projects-${runId}-big-comment`, bigOps = Array.from({length:5},(_,i)=>`projects-${runId}-big-op-${i}`);
const raceId=`projects-${runId}-race`,raceOp=`projects-${runId}-race-op`;
const owned = [`employees/${names.member}`, `employees/${names.other}`, `employees/${names.foreign}`, `workProjectsV1/${names.project}`, `workProjectsV1/${names.sentinel}`, ...created.flatMap((id, i) => [`workProjectsV1/${id}`, `workProjectsV1/${id}/operations/${operations[i]}`]), `workProjectsV1/${created[1]}/tasks/${taskId}`, `workProjectsV1/${created[1]}/tasks/${taskId}/comments/${commentId}`, ...taskOps.map(id=>`workProjectsV1/${created[1]}/operations/${id}`), ...rogueIds.map(id=>`workProjectsV1/${created[1]}/tasks/${id}`), `workProjectsV1/${created[1]}/operations/${rogueOp}`, `workProjectsV1/${created[1]}/operations/${lateOp}`, `employees/${names.admin}`, `workProjectsV1/${bigId}`, `workProjectsV1/${bigId}/tasks/${bigTask}`, `workProjectsV1/${bigId}/tasks/${bigTask}/comments/${bigComment}`, ...bigOps.map(id=>`workProjectsV1/${bigId}/operations/${id}`),`workProjectsV1/${raceId}`,`workProjectsV1/${raceId}/operations/${raceOp}`];
let env: RulesTestEnvironment;
let app: App;
let sentinelBefore: FirebaseFirestore.DocumentSnapshot;
const intents = new Set<string>();

describe.skipIf(!enabled)('프로젝트 실제 Web 권한 규칙', () => {
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8382') throw Error('등록된 프로젝트 에뮬레이터 주소가 아닙니다.');
    env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8382, rules: readFileSync('firestore.rules', 'utf8') } });
    app = initializeApp({ projectId }, `projects-rules-${runId}`);
    const db = adminFirestore(app);
    for (const path of owned) if ((await db.doc(path).get()).exists) throw Error(`시험 경로가 이미 존재합니다: ${path}`);
    const createdAt = new Timestamp(123, 456);
    await env.withSecurityRulesDisabled(async context => {
      const web = context.firestore();
      const create = async (path: string, value: Record<string, unknown>) => { if (!owned.includes(path)) throw Error('허용되지 않은 시험 경로'); intents.add(path); await setDoc(doc(web, path), value); };
      await create(owned[0], { companyId: 'taebaek', authUid: 'member-uid', status: 'working' });
      await create(owned[1], { companyId: 'taebaek', authUid: 'other-uid', status: 'working' });
      await create(owned[2], { companyId: 'punghoe', authUid: 'foreign-uid', status: 'working', adminAccess: true });
      await create(`employees/${names.admin}`, { companyId: 'taebaek', authUid: 'admin-uid', status: 'working', adminAccess: true });
      const data = { version: 1, companyId: 'taebaek', epoch: runId, ownerEmployeeId: names.member, participantIds: [names.member], title: '합성 프로젝트', description: '', revision: 1, status: 'active', lastOperationId: 'seed', createdAt, updatedAt: createdAt };
      await create(owned[3], data);
      await create(owned[4], { ...data, title: '보존 sentinel' });
      await create(`workProjectsV1/${bigId}`, {...data,title:'한도 시험',participantIds:[names.member,names.other,...Array.from({length:48},(_,i)=>`unused-${runId}-${i}`)]});
      await create(`workProjectsV1/${bigId}/tasks/${bigTask}`, {version:1,projectEpoch:runId,title:'한도 업무',description:'',status:'todo',assigneeEmployeeId:null,startDate:null,endDate:null,priority:'normal',tags:[],checklist:Object.fromEntries(Array.from({length:50},(_,i)=>[`check-${i}`,{title:`항목${i}`,checked:false}])),revision:1,deletedAt:null,lastOperationId:'seed',createdAt,updatedAt:createdAt});
    });
    sentinelBefore = await db.doc(owned[4]).get();
  });
  afterAll(async () => {
    if (!env || !app) return;
    const db = adminFirestore(app);
    await env.withSecurityRulesDisabled(async context => { for (const path of [...intents].sort((a,b)=>b.split('/').length-a.split('/').length)) if (path !== owned[4]) await deleteDoc(doc(context.firestore(), path)); });
    if (sentinelBefore) { const sentinelAfter = await db.doc(owned[4]).get(); expect(sentinelAfter.data()).toEqual(sentinelBefore.data()); expect(sentinelAfter.updateTime?.seconds).toBe(sentinelBefore.updateTime?.seconds); expect(sentinelAfter.updateTime?.nanoseconds).toBe(sentinelBefore.updateTime?.nanoseconds); }
    if (intents.has(owned[4])) await env.withSecurityRulesDisabled(context => deleteDoc(doc(context.firestore(), owned[4])));
    for (const path of intents) expect((await db.doc(path).get()).exists).toBe(false);
    await env.cleanup();
    await deleteApp(app);
    writeFileSync(`work/projects-rules-sdk-cleanup-${runId}.json`,JSON.stringify({projectId,host:'127.0.0.1:8382',paths:[...intents],sentinelBodyAndNanosecondVersionPreserved:!!sentinelBefore,ownedPathsAbsentAfterCleanup:true},null,2)+'\n',{flag:'wx'});
  });
  it('참여자는 읽고 같은 회사 비참여자와 다른 회사 관리자는 읽지 못한다', async () => {
    const member = env.authenticatedContext('member-uid', { companyId: 'taebaek', employeeId: names.member }).firestore();
    const other = env.authenticatedContext('other-uid', { companyId: 'taebaek', employeeId: names.other }).firestore();
    const foreign = env.authenticatedContext('foreign-uid', { companyId: 'punghoe', employeeId: names.foreign, isAdmin: true }).firestore();
    await assertSucceeds(getDoc(doc(member, owned[3])));
    await assertFails(getDoc(doc(other, owned[3])));
    await assertFails(getDoc(doc(foreign, owned[3])));
  });
  it('새 프로젝트 없는 경로만 확인할 수 있고 개별 문서 위조는 차단한다', async () => {
    const member = env.authenticatedContext('member-uid', { companyId: 'taebaek', employeeId: names.member }).firestore();
    await assertSucceeds(getDoc(doc(member, 'workProjectsV1', `projects-${runId}-absent`)));
    await assertFails(setDoc(doc(member, owned[3]), { companyId: 'taebaek', title: '위조' }));
  });
  it('목록 질의도 참여자 조건을 요구하며 관리자 권한은 회사와 claim을 함께 확인한다', async () => {
    const member = env.authenticatedContext('member-uid', { companyId: 'taebaek', employeeId: names.member }).firestore(), other = env.authenticatedContext('other-uid', { companyId: 'taebaek', employeeId: names.other }).firestore(), admin = env.authenticatedContext('admin-uid', { companyId: 'taebaek', employeeId: names.admin, isAdmin: true }).firestore(), noClaim = env.authenticatedContext('admin-uid', { companyId: 'taebaek', employeeId: names.admin }).firestore();
    const list = (db: typeof member, participant?: string) => query(collection(db, 'workProjectsV1'), where('companyId','==','taebaek'), where('status','==','active'), ...(participant ? [where('participantIds','array-contains',participant)] : []), orderBy('updatedAt','desc'), limit(50));
    await assertSucceeds(getDocs(list(member,names.member)));
    await assertFails(getDocs(list(other,names.member)));
    await assertSucceeds(getDocs(list(admin)));
    await assertFails(getDocs(list(noClaim)));
  });
  it('실제 Web 거래에서 생성과 취소 선후 관계가 동일한 영수증으로 수렴한다', async () => {
    const web = env.authenticatedContext('member-uid', { companyId: 'taebaek', employeeId: names.member }).firestore();
    const scope = { companyId: 'taebaek' as const, actorUid: 'member-uid', employeeId: names.member, sessionGeneration: 1 };
    for (let i = 0; i < 2; i++) {
      const map = new Map<string, string>(); let deferCleanup = true; const storage = { get length() { return map.size; }, key: (n: number) => [...map.keys()][n] ?? null, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { if (!deferCleanup) map.delete(key); } };
      const api = createProjectWrites({ db: web as unknown as Firestore, auth: { currentUser: { uid: 'member-uid' } }, storage, uuid: () => operations[i], clock: () => new Date(), current: () => true });
      const entry = api.prepare(scope, { projectId: created[i], projectEpoch: runId, action: 'project.create', target: { kind: 'project', id: created[i] }, expectedProjectRevision: null, expectedTargetRevision: null, input: { title: '실제 SDK', description: '' } });
      intents.add(`workProjectsV1/${created[i]}`); intents.add(`workProjectsV1/${created[i]}/operations/${operations[i]}`);
      if (i === 0) { expect((await api.cancel(scope, entry)).kind).toBe('cancelled'); expect((await api.apply(scope, entry)).kind).toBe('cancelled'); }
      else { expect((await api.apply(scope, entry)).kind).toBe('applied'); expect((await api.cancel(scope, entry)).kind).toBe('applied'); }
      deferCleanup = false;
      expect(await api.inspect(scope, entry)).toMatchObject({kind:i === 0 ? 'cancelled' : 'applied',localCleanupPending:false});
    }
  }, 30000);
  it('실제 Web 거래에서 업무와 체크리스트를 각각 한 영수증으로 저장한다', async () => {
    const web = env.authenticatedContext('member-uid', { companyId: 'taebaek', employeeId: names.member }).firestore(), scope = { companyId: 'taebaek' as const, actorUid: 'member-uid', employeeId: names.member, sessionGeneration: 1 };
    const map = new Map<string, string>(), storage = { get length() { return map.size; }, key: (n: number) => [...map.keys()][n] ?? null, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
    let index = 0; const api = createProjectWrites({ db: web as unknown as Firestore, auth: { currentUser: { uid: 'member-uid' } }, storage, uuid: () => taskOps[index++], clock: () => new Date(), current: () => true });
    const task = api.prepare(scope, { projectId: created[1], projectEpoch: runId, action: 'task.create', target: { kind: 'task', id: taskId }, expectedProjectRevision: 1, expectedTargetRevision: null, input: { title: '업무', description: '', status: 'todo', assigneeEmployeeId: null, startDate: null, endDate: null, priority: 'normal', tags: [] } });
    intents.add(`workProjectsV1/${created[1]}/tasks/${taskId}`); intents.add(`workProjectsV1/${created[1]}/operations/${taskOps[0]}`);
    expect((await api.apply(scope, task)).kind).toBe('applied');
    const checklist = api.prepare(scope, { projectId: created[1], projectEpoch: runId, action: 'checklist.create', target: { kind: 'checklist', id: checkId, taskId }, expectedProjectRevision: 2, expectedTargetRevision: 1, input: { title: '확인', checked: false } });
    intents.add(`workProjectsV1/${created[1]}/operations/${taskOps[1]}`);
    expect((await api.apply(scope, checklist)).kind).toBe('applied');
    expect((await getDoc(doc(web, 'workProjectsV1', created[1], 'tasks', taskId))).data()?.checklist).toEqual({ [checkId]: { title: '확인', checked: false } });
    const send = async (action: Parameters<typeof api.prepare>[1]['action'], target: Parameters<typeof api.prepare>[1]['target'], expectedProjectRevision: number, expectedTargetRevision: number | null, input: Record<string, unknown>, cancel = false) => {
      const entry = api.prepare(scope,{ projectId: created[1], projectEpoch: runId, action, target, expectedProjectRevision, expectedTargetRevision, input });
      intents.add(`workProjectsV1/${created[1]}/operations/${entry.request.operationId}`);
      return cancel ? api.cancel(scope,entry) : api.apply(scope,entry);
    };
    const taskTarget = { kind: 'task' as const, id: taskId }, taskInput = { title: '업무', description: '', status: 'done', assigneeEmployeeId: null, startDate: '2028-02-29', endDate: '2028-03-01', priority: 'normal', tags: Array.from({length:20},(_,i)=>i===0?'가'.repeat(40):i===1?'줄\n바꿈':'태그'+i) }, commentTarget = { kind: 'comment' as const, id: commentId, taskId }, projectTarget = { kind: 'project' as const, id: created[1] };
    expect((await send('task.edit',taskTarget,3,2,taskInput)).kind).toBe('applied');
    expect((await getDoc(doc(web,'workProjectsV1',created[1],'tasks',taskId))).data()?.checklist[checkId].checked).toBe(false);
    intents.add(`workProjectsV1/${created[1]}/tasks/${taskId}/comments/${commentId}`);
    expect((await send('comment.create',commentTarget,4,null,{body:'첫 댓글'})).kind).toBe('applied');
    expect((await send('comment.edit',commentTarget,5,1,{body:'수정 댓글'})).kind).toBe('applied');
    expect((await send('comment.delete',commentTarget,6,2,{})).kind).toBe('applied');
    expect((await send('member.add',projectTarget,7,7,{employeeId:names.other})).kind).toBe('applied');
    const other = env.authenticatedContext('other-uid', { companyId:'taebaek', employeeId:names.other }).firestore();
    await assertSucceeds(getDoc(doc(other,'workProjectsV1',created[1])));
    const otherMap = new Map<string,string>(), otherStorage = { get length(){return otherMap.size;}, key:(n:number)=>[...otherMap.keys()][n]??null, getItem:(key:string)=>otherMap.get(key)??null, setItem:(key:string,value:string)=>{otherMap.set(key,value);}, removeItem:(key:string)=>{otherMap.delete(key);} }, otherScope = {companyId:'taebaek' as const,actorUid:'other-uid',employeeId:names.other,sessionGeneration:1}, otherApi = createProjectWrites({db:other as unknown as Firestore,auth:{currentUser:{uid:'other-uid'}},storage:otherStorage,uuid:()=>lateOp,clock:()=>new Date(),current:()=>true}), late = otherApi.prepare(otherScope,{projectId:created[1],projectEpoch:runId,action:'task.edit',target:taskTarget,expectedProjectRevision:8,expectedTargetRevision:3,input:taskInput});
    expect((await send('member.remove',projectTarget,8,8,{employeeId:names.other})).kind).toBe('applied');
    await assertFails(getDoc(doc(other,'workProjectsV1',created[1])));
    intents.add(`workProjectsV1/${created[1]}/operations/${lateOp}`);
    expect((await otherApi.apply(otherScope,late)).kind).toBe('unknown');
    expect((await adminFirestore(app).doc(`workProjectsV1/${created[1]}/operations/${lateOp}`).get()).exists).toBe(false);
    expect((await send('project.edit',projectTarget,9,9,{title:'변경',description:''})).kind).toBe('applied');
    expect((await send('task.edit',taskTarget,1,1,taskInput,true)).kind).toBe('cancelled');
    expect((await getDoc(doc(web,'workProjectsV1',created[1]))).data()?.revision).toBe(10);
  }, 30000);
  it('부모만 변경하거나 한 영수증에 다른 업무를 끼워 넣는 거래는 거절한다', async () => {
    const web = env.authenticatedContext('member-uid', { companyId: 'taebaek', employeeId: names.member }).firestore(), parentRef = doc(web, 'workProjectsV1', created[1]), parent = (await getDoc(parentRef)).data()!;
    await assertFails(updateDoc(parentRef, { revision: parent.revision + 1, lastOperationId: rogueOp, updatedAt: serverTimestamp() }));
    const target = { kind: 'task', id: rogueIds[0] }, input = { title: '위조', description: '', status: 'todo', assigneeEmployeeId: null, startDate: null, endDate: null, priority: 'normal', tags: [] }, request = { version: 1, companyId: 'taebaek', projectId: created[1], projectEpoch: runId, operationId: rogueOp, actorUid: 'member-uid', actorEmployeeId: names.member, action: 'task.create', target, expectedProjectRevision: parent.revision, expectedTargetRevision: null, input };
    const task = { version: 1, projectEpoch: runId, ...input, checklist: {}, revision: 1, deletedAt: null, lastOperationId: rogueOp, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, receipt = { version: 1, projectEpoch: runId, operationId: rogueOp, actorUid: 'member-uid', actorEmployeeId: names.member, action: 'task.create', target, request, status: 'applied', before: null, after: task, at: serverTimestamp() };
    const first = doc(web, 'workProjectsV1', created[1], 'tasks', rogueIds[0]), second = doc(web, 'workProjectsV1', created[1], 'tasks', rogueIds[1]), op = doc(web, 'workProjectsV1', created[1], 'operations', rogueOp);
    intents.add(first.path); intents.add(second.path); intents.add(op.path);
    await assertFails(setDoc(first, task));
    await assertFails(setDoc(op, receipt));
    const batch = writeBatch(web); batch.set(parentRef, { ...parent, revision: parent.revision + 1, lastOperationId: rogueOp, updatedAt: serverTimestamp() }); batch.set(first, task); batch.set(second, task); batch.set(op, receipt);
    await assertFails(batch.commit());
    expect((await getDoc(parentRef)).data()?.revision).toBe(parent.revision);
    expect((await getDoc(first)).exists()).toBe(false);
    expect((await getDoc(second)).exists()).toBe(false);
    const taskRef = doc(web,'workProjectsV1',created[1],'tasks',taskId), originalTask = (await getDoc(taskRef)).data()!;
    const unchangedTarget = {kind:'task',id:taskId}, unchangedInput = {title:originalTask.title,description:originalTask.description,status:originalTask.status,assigneeEmployeeId:originalTask.assigneeEmployeeId,startDate:originalTask.startDate,endDate:originalTask.endDate,priority:originalTask.priority,tags:originalTask.tags}, unchangedRequest = {...request,action:'task.edit',target:unchangedTarget,expectedTargetRevision:originalTask.revision,input:unchangedInput}, unchangedReceipt = {...receipt,action:'task.edit',target:unchangedTarget,request:unchangedRequest,before:originalTask,after:originalTask,at:serverTimestamp()};
    const missingTargetBatch = writeBatch(web); missingTargetBatch.set(parentRef,{...parent,revision:parent.revision+1,lastOperationId:rogueOp,updatedAt:serverTimestamp()}); missingTargetBatch.set(op,unchangedReceipt);
    await assertFails(missingTargetBatch.commit());
    for (const invalid of [{ tags: Array.from({length:21},(_,i)=>`t${i}`), startDate:null, endDate:null }, { tags: ['x'.repeat(41)], startDate:null, endDate:null }, { tags: [1], startDate:null, endDate:null }, { tags: [null], startDate:null, endDate:null }, { tags: [{}], startDate:null, endDate:null }, { tags: [], startDate:'2026-02-30', endDate:null }]) {
      const invalidInput = { title: originalTask.title, description: originalTask.description, status: originalTask.status, assigneeEmployeeId: originalTask.assigneeEmployeeId, priority: originalTask.priority, ...invalid }, invalidTarget = {kind:'task',id:taskId}, invalidRequest = { ...request, action:'task.edit', target:invalidTarget, expectedTargetRevision:originalTask.revision, input:invalidInput }, invalidAfter = { ...originalTask, ...invalidInput, revision:originalTask.revision+1, lastOperationId:rogueOp, updatedAt:serverTimestamp() }, invalidReceipt = { ...receipt, action:'task.edit', target:invalidTarget, request:invalidRequest, before:originalTask, after:invalidAfter, at:serverTimestamp() };
      const invalidBatch = writeBatch(web); invalidBatch.set(parentRef,{...parent,revision:parent.revision+1,lastOperationId:rogueOp,updatedAt:serverTimestamp()}); invalidBatch.set(taskRef,invalidAfter); invalidBatch.set(op,invalidReceipt);
      await assertFails(invalidBatch.commit());
    }
    expect((await getDoc(taskRef)).data()?.revision).toBe(originalTask.revision);
    const map = new Map<string,string>(), storage = { get length(){return map.size;}, key:(n:number)=>[...map.keys()][n]??null, getItem:(key:string)=>map.get(key)??null, setItem:(key:string,value:string)=>{map.set(key,value);}, removeItem:(key:string)=>{map.delete(key);} }, scope = {companyId:'taebaek' as const,actorUid:'member-uid',employeeId:names.member,sessionGeneration:1};
    const api = createProjectWrites({db:web as unknown as Firestore,auth:{currentUser:{uid:'member-uid'}},storage,uuid:()=>taskOps[10],clock:()=>new Date(),current:()=>true}), deletion = api.prepare(scope,{projectId:created[1],projectEpoch:runId,action:'project.delete',target:{kind:'project',id:created[1]},expectedProjectRevision:parent.revision,expectedTargetRevision:parent.revision,input:{}});
    intents.add(`workProjectsV1/${created[1]}/operations/${taskOps[10]}`);
    expect((await api.apply(scope,deletion)).kind).toBe('applied');
    expect((await getDoc(parentRef)).data()?.status).toBe('deleted');
    await assertFails(getDoc(doc(web,'workProjectsV1',created[1],'tasks',taskId)));
    expect(api.listLocal(scope)).toHaveLength(0);
  }, 30000);
  it('참여자 50명과 체크리스트 50개 및 최대 댓글을 포함한 거래도 규칙 예산 안에서 처리한다', async () => {
    const web = env.authenticatedContext('member-uid',{companyId:'taebaek',employeeId:names.member}).firestore(), scope = {companyId:'taebaek' as const,actorUid:'member-uid',employeeId:names.member,sessionGeneration:1}, map = new Map<string,string>(), storage = {get length(){return map.size;},key:(n:number)=>[...map.keys()][n]??null,getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);}};
    let index=0;const api=createProjectWrites({db:web as unknown as Firestore,auth:{currentUser:{uid:'member-uid'}},storage,uuid:()=>bigOps[index++],clock:()=>new Date(),current:()=>true});
    const send=async(draft:Parameters<typeof api.prepare>[1])=>{const entry=api.prepare(scope,draft);intents.add(`workProjectsV1/${bigId}/operations/${entry.request.operationId}`);return api.apply(scope,entry);};
    expect((await send({projectId:bigId,projectEpoch:runId,action:'checklist.edit',target:{kind:'checklist',id:'check-0',taskId:bigTask},expectedProjectRevision:1,expectedTargetRevision:1,input:{title:'항목0',checked:true}})).kind).toBe('applied');
    expect(Object.keys((await getDoc(doc(web,'workProjectsV1',bigId,'tasks',bigTask))).data()!.checklist)).toHaveLength(50);
    const input={title:'한도 업무',description:'',status:'doing',assigneeEmployeeId:null,startDate:'2028-02-29',endDate:'2028-03-01',priority:'normal',tags:Array.from({length:20},(_,i)=>'태그'+i)};
    expect((await send({projectId:bigId,projectEpoch:runId,action:'task.edit',target:{kind:'task',id:bigTask},expectedProjectRevision:2,expectedTargetRevision:2,input})).kind).toBe('applied');
    intents.add(`workProjectsV1/${bigId}/tasks/${bigTask}/comments/${bigComment}`);
    expect((await send({projectId:bigId,projectEpoch:runId,action:'comment.create',target:{kind:'comment',id:bigComment,taskId:bigTask},expectedProjectRevision:3,expectedTargetRevision:null,input:{body:'가'.repeat(5000)}})).kind).toBe('applied');
    expect((await send({projectId:bigId,projectEpoch:runId,action:'member.remove',target:{kind:'project',id:bigId},expectedProjectRevision:4,expectedTargetRevision:4,input:{employeeId:names.other}})).kind).toBe('applied');
    expect((await send({projectId:bigId,projectEpoch:runId,action:'member.add',target:{kind:'project',id:bigId},expectedProjectRevision:5,expectedTargetRevision:5,input:{employeeId:names.other}})).kind).toBe('applied');
  },30000);
  it('두 Web 인스턴스의 생성과 취소가 동시에 시작돼도 하나의 영수증으로 수렴한다',async()=>{
    const web=env.authenticatedContext('member-uid',{companyId:'taebaek',employeeId:names.member}).firestore(),scope={companyId:'taebaek' as const,actorUid:'member-uid',employeeId:names.member,sessionGeneration:1},map=new Map<string,string>(),storage={get length(){return map.size;},key:(i:number)=>[...map.keys()][i]??null,getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(_key:string)=>{}},deps={db:web as unknown as Firestore,auth:{currentUser:{uid:'member-uid'}},storage,uuid:()=>raceOp,clock:()=>new Date(),current:()=>true},a=createProjectWrites(deps),b=createProjectWrites(deps),entry=a.prepare(scope,{projectId:raceId,projectEpoch:runId,action:'project.create',target:{kind:'project',id:raceId},expectedProjectRevision:null,expectedTargetRevision:null,input:{title:'동시 요청',description:''}});
    intents.add(`workProjectsV1/${raceId}`);intents.add(`workProjectsV1/${raceId}/operations/${raceOp}`);
    const results=await Promise.all([a.apply(scope,entry),b.cancel(scope,entry)]),final=await a.inspect(scope,entry);expect(['applied','cancelled']).toContain(final.kind);expect(results.some(result=>result.kind===final.kind)).toBe(true);for(const result of results)expect([final.kind,'unknown']).toContain(result.kind);
    const parent=(await adminFirestore(app).doc(`workProjectsV1/${raceId}`).get()).data();expect(parent?.revision).toBe(1);expect(parent?.status).toBe(final.kind==='applied'?'active':'deleted');
  },30000);
  it('실제 직원 상태나 관리자 접근이 바뀌면 기존 토큰만으로 계속 읽지 못한다', async () => {
    const admin = env.authenticatedContext('admin-uid', {companyId:'taebaek',employeeId:names.admin,isAdmin:true}).firestore(), member = env.authenticatedContext('member-uid', {companyId:'taebaek',employeeId:names.member}).firestore();
    await assertSucceeds(getDoc(doc(admin,owned[4])));
    await env.withSecurityRulesDisabled(async context => { await updateDoc(doc(context.firestore(),`employees/${names.admin}`),{adminAccess:false}); await updateDoc(doc(context.firestore(),`employees/${names.member}`),{status:'out'}); });
    await assertFails(getDoc(doc(admin,owned[4])));
    await assertFails(getDoc(doc(member,owned[4])));
  });
});

describe.skipIf(!enabled)('프로젝트 포괄 규칙 OR 실제 반례', () => {
  const mutationProject = `demo-projects-mutation-${runId}`, docId = `projects-${runId}-mutation`, employeeId = `projects-${runId}-mutation-employee`, markerId = `projects-${runId}-mutation-sentinel`, mutationPaths = [`employees/${employeeId}`,`workProjectsV1/${docId}`,`workProjectsV1/${markerId}`], mutationIntents = new Set<string>();
  let mutationEnv: RulesTestEnvironment, mutationApp: App, beforeMarker: FirebaseFirestore.DocumentSnapshot, sourceHash: string;
  const outcomes: string[] = [];
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  beforeAll(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8382') throw Error('등록된 에뮬레이터 주소가 아닙니다.');
    const source = readFileSync('firestore.rules','utf8'); sourceHash = digest(source);
    const old = source.replace("c == 'workProjectsV1' || ", ''); if (old === source) throw Error('변이 위치가 다릅니다.');
    mutationEnv = await initializeTestEnvironment({projectId:mutationProject,firestore:{host:'127.0.0.1',port:8382,rules:old}});
    mutationApp = initializeApp({projectId:mutationProject},`projects-mutant-${runId}`); const db=adminFirestore(mutationApp);
    for(const path of mutationPaths) if((await db.doc(path).get()).exists) throw Error('시험 경로가 이미 존재합니다.');
    await mutationEnv.withSecurityRulesDisabled(async context=>{const web=context.firestore();for(const [path,value] of [[mutationPaths[0],{companyId:'taebaek',authUid:'mutant-uid',status:'working'}],[mutationPaths[1],{companyId:'taebaek',participantIds:['another'],status:'active',title:'비참여자 금지'}],[mutationPaths[2],{companyId:'taebaek',participantIds:['another'],status:'active',nativeTime:new Timestamp(123,222222222)}]] as const){mutationIntents.add(path);await setDoc(doc(web,path),value);}});
    beforeMarker=await db.doc(mutationPaths[2]).get();
  });
  afterAll(async () => {
    if (!mutationApp || !mutationEnv) return; const db=adminFirestore(mutationApp);
    await mutationEnv.withSecurityRulesDisabled(async context=>{for(const path of mutationIntents)if(path!==mutationPaths[2])await deleteDoc(doc(context.firestore(),path));});
    if(beforeMarker){const after=await db.doc(mutationPaths[2]).get();expect(after.data()).toEqual(beforeMarker.data());expect(after.updateTime?.seconds).toBe(beforeMarker.updateTime?.seconds);expect(after.updateTime?.nanoseconds).toBe(beforeMarker.updateTime?.nanoseconds);}
    if(mutationIntents.has(mutationPaths[2]))await mutationEnv.withSecurityRulesDisabled(context=>deleteDoc(doc(context.firestore(),mutationPaths[2])));
    for(const path of mutationIntents)expect((await db.doc(path).get()).exists).toBe(false);
    expect(digest(readFileSync('firestore.rules','utf8'))).toBe(sourceHash); await mutationEnv.cleanup(); await deleteApp(mutationApp);
    if(outcomes.length===3)writeFileSync(`work/projects-rules-or-mutation-${runId}.json`,JSON.stringify({projectId:mutationProject,host:'127.0.0.1:8382',paths:[...mutationIntents],outcomes,sourceSha256:sourceHash,sentinelBodyAndNanosecondVersionPreserved:true,ownedPathsAbsentAfterCleanup:true},null,2)+'\n',{flag:'wx'});
  });
  it('포괄 허용이 남으면 비참여자가 읽고, 전용 제외는 막으며, deny만 추가해도 막히지 않는다',async()=>{
    const claim={companyId:'taebaek',employeeId}, read=()=>getDoc(doc(mutationEnv.authenticatedContext('mutant-uid',claim).firestore(),mutationPaths[1]));
    await assertSucceeds(read());outcomes.push('generic-allow-observed');
    const source=readFileSync('firestore.rules','utf8');await mutationEnv.cleanup();mutationEnv=await initializeTestEnvironment({projectId:mutationProject,firestore:{host:'127.0.0.1',port:8382,rules:source}});
    await assertFails(read());outcomes.push('scoped-exclusion-denied');
    const denyOnly=source.replace("c == 'workProjectsV1' || ",'').replace('match /databases/{database}/documents {',"match /databases/{database}/documents {\n match /workProjectsV1/{document=**} { allow read, write: if false; }");
    await mutationEnv.cleanup();mutationEnv=await initializeTestEnvironment({projectId:mutationProject,firestore:{host:'127.0.0.1',port:8382,rules:denyOnly}});
    await assertSucceeds(read());outcomes.push('deny-only-bypass-observed');
  },30000);
});
