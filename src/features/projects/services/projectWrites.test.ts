import { beforeEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ rows: new Map<string, any>(), loseAck: false, writes: [] as string[] }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  serverTimestamp: () => ({ timestamp: 'server' }),
  getDocFromServer: async (ref: any) => ({ exists: () => fake.rows.has(ref.path), data: () => fake.rows.get(ref.path), metadata: { fromCache: false, hasPendingWrites: false } }),
  runTransaction: async (_db: unknown, callback: (tx: any) => Promise<unknown>) => {
    const pending = new Map<string, unknown>();
    const result = await callback({ get: async (ref: any) => ({ exists: () => fake.rows.has(ref.path), data: () => fake.rows.get(ref.path) }), set: (ref: any, value: unknown) => pending.set(ref.path, value) });
    for (const [path, value] of pending) { fake.rows.set(path, value); fake.writes.push(path); }
    if (fake.loseAck) { fake.loseAck = false; throw Error('ack lost'); }
    return result;
  },
}));
import { createProjectWrites } from './projectWrites';
import type { ProjectScope } from '../domain/projectContract';
const scope: ProjectScope = { companyId: 'taebaek', actorUid: 'uid', employeeId: 'employee', sessionGeneration: 1 };
const draft = { projectId: 'project', projectEpoch: 'epoch', action: 'project.create' as const, target: { kind: 'project' as const, id: 'project' }, expectedProjectRevision: null, expectedTargetRevision: null, input: { title: '새 프로젝트', description: '' } };
function setup() {
  const map = new Map<string, string>();
  let removeFails = false;
  const storage = { get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { if (removeFails) throw Error('storage unavailable'); map.delete(key); } };
  let current = true;
  const api = createProjectWrites({ db: {} as never, auth: { currentUser: { uid: 'uid' } }, storage, uuid: () => 'operation', clock: () => new Date(), current: () => current });
  return { api, storage, change: () => { current = false; }, failRemove: (value: boolean) => { removeFails = value; } };
}
beforeEach(() => { fake.rows.clear(); fake.writes = []; fake.loseAck = false; fake.rows.set('employees/employee', { companyId: 'taebaek', authUid: 'uid', status: 'working' }); });
it('요청을 먼저 보관하고 응답 유실 후 같은 영수증으로 결과를 확인한다', async () => {
  const { api } = setup(), entry = api.prepare(scope, draft);
  expect(api.listLocal(scope)).toHaveLength(1);
  fake.loseAck = true;
  expect((await api.apply(scope, entry)).kind).toBe('unknown');
  expect(await api.inspect(scope, entry)).toMatchObject({kind:'applied',localCleanupPending:false});
  expect(api.listLocal(scope)).toHaveLength(0);
  expect(fake.writes.filter(path => path === 'workProjectsV1/project')).toHaveLength(1);
});
it('생성 취소가 먼저 적용되면 tombstone과 영수증이 늦은 같은 요청을 막는다', async () => {
  const { api, failRemove } = setup(), entry = api.prepare(scope, draft); failRemove(true);
  expect(await api.cancel(scope, entry)).toMatchObject({kind:'cancelled',localCleanupPending:true});
  expect(fake.rows.get('workProjectsV1/project').status).toBe('deleted');
  expect((await api.apply(scope, entry)).kind).toBe('cancelled');
  failRemove(false);
  expect(await api.retryCleanup(scope,entry)).toMatchObject({kind:'cancelled',localCleanupPending:false});
  expect(api.listLocal(scope)).toHaveLength(0);
  expect(fake.writes.filter(path => path === 'workProjectsV1/project')).toHaveLength(1);
});
it('생성이 먼저 완료된 경우 취소는 실제 적용 결과를 반환한다', async () => {
  const { api, failRemove } = setup(), entry = api.prepare(scope, draft); failRemove(true);
  expect((await api.apply(scope, entry)).kind).toBe('applied');
  expect((await api.cancel(scope, entry)).kind).toBe('applied');
  expect(fake.rows.get('workProjectsV1/project').status).toBe('active');
});
it('세대가 바뀐 뒤에는 이전 요청을 전송하지 않는다', async () => {
  const { api, change } = setup(), entry = api.prepare(scope, draft);
  change();
  expect((await api.apply(scope, entry)).kind).toBe('invalidated');
  expect(fake.writes).toEqual([]);
});
it('영수증 대상이 보관 원문과 다르면 성공으로 취급하지 않는다', async () => {
  const { api, failRemove } = setup(), entry = api.prepare(scope, draft); failRemove(true);
  expect((await api.apply(scope, entry)).kind).toBe('applied');
  fake.rows.get('workProjectsV1/project/operations/operation').target = { kind: 'project', id: 'other' };
  expect((await api.inspect(scope, entry)).kind).toBe('conflict');
  expect((await api.apply(scope, entry)).kind).toBe('conflict');
});
it('보관 원문이 바뀌거나 세대가 바뀌면 남의 사본을 정리하지 않는다', async () => {
  const first = setup(), entry = first.api.prepare(scope,draft); first.failRemove(true);
  expect((await first.api.apply(scope,entry)).kind).toBe('applied');
  first.failRemove(false);
  const changed = JSON.stringify({...entry.request,input:{title:'다른 원문',description:''}});
  first.storage.setItem(entry.key,changed);
  expect((await first.api.retryCleanup(scope,entry)).kind).toBe('conflict');
  expect(first.storage.getItem(entry.key)).toBe(changed);
  const second = setup(), entry2 = second.api.prepare(scope,draft); second.change();
  expect((await second.api.retryCleanup(scope,entry2)).kind).toBe('invalidated');
  expect(second.storage.getItem(entry2.key)).toBe(entry2.original);
});
it('손상 사본은 그대로 보존하면서 다른 정상 요청의 목록과 완료 처리를 막지 않는다', async () => {
  const {api,storage}=setup(),entry=api.prepare(scope,draft),broken=entry.key.replace(/operation$/,'broken');
  storage.setItem(broken,'{손상');
  const foreign='project-request-v1:punghoe:foreign:employee:broken'; storage.setItem(foreign,'{다른 계정');
  expect(api.listLocalIssues(scope)).toMatchObject({entries:[{key:entry.key}],issues:[{key:broken}]});
  expect(await api.apply(scope,entry)).toMatchObject({kind:'applied',localCleanupPending:false});
  expect(api.listLocalIssues(scope)).toMatchObject({entries:[],issues:[{key:broken}]});
  expect(storage.getItem(broken)).toBe('{손상');
  expect(storage.getItem(foreign)).toBe('{다른 계정');
});
it('보관 키 하나를 읽을 수 없어도 나머지 항목을 계속 확인한다', () => {
  const {api,storage}=setup(); storage.setItem('unreadable','value'); const entry=api.prepare(scope,draft), original=storage.key;
  storage.key=(index:number)=>{if(index===0)throw Error('키 오류');return original(index);};
  expect(api.listLocalIssues(scope)).toMatchObject({entries:[{key:entry.key}],issues:[{key:''}]});
});
