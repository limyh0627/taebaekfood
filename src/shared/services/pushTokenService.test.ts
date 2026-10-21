import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ employeeId: 'employee-own', companyId: 'taebaek', uid: 'auth-different', anonymous: false, loggedIn: true, fail: false,
  initialDifferent:false,writes: [] as unknown[][], currentUser: null as any, listeners: new Set<(user:any)=>void>(), stops: 0, authReady: Promise.resolve() as Promise<void>, claims: null as null | (()=>Promise<{claims:Record<string,unknown>}>) }));
vi.mock('../firebase', () => ({ app: {}, db: {}, get authReady(){return state.authReady;}, auth: {
  get currentUser() { return state.loggedIn ? state.currentUser : null; },
} }));
vi.mock('firebase/auth',()=>({onIdTokenChanged:(_auth:unknown,listener:(user:any)=>void)=>{state.listeners.add(listener);listener(state.initialDifferent?{...state.currentUser,uid:"initial-other"}:state.loggedIn?state.currentUser:null);return()=>{if(state.listeners.delete(listener))state.stops++;};}}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  arrayUnion: (token: string) => ({ union: token }), arrayRemove: (token: string) => ({ remove: token }), deleteField: () => ({ delete: true }),
  FieldPath: class { constructor(public parent: string, public token: string) {} },
  updateDoc: async (...args: unknown[]) => { if (state.fail) throw new Error('저장 실패'); state.writes.push(args); },
}));
vi.mock('firebase/messaging', () => ({ isSupported: async () => true, getMessaging: () => ({}), getToken: async () => 'token:with.dot' }));
vi.mock('../deviceLabel', () => ({ currentDeviceLabel: () => '합성 기기' }));
import { capturePushActor, updateOwnPushToken } from './pushTokenService';
beforeEach(() => {
  state.employeeId = 'employee-own'; state.companyId='taebaek';state.listeners.clear();state.initialDifferent=false;state.stops=0;state.claims=null;state.authReady=Promise.resolve(); state.uid = 'auth-different'; state.anonymous = false; state.loggedIn = true; state.fail = false; state.writes = [];
  state.currentUser={uid:state.uid,get isAnonymous(){return state.anonymous;},getIdTokenResult:async()=>state.claims?state.claims():({claims:{employeeId:state.employeeId,companyId:state.companyId}})};
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'synthetic');
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('navigator', { serviceWorker: { register: async () => ({}) } });
  vi.stubGlobal('localStorage', { getItem: () => null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('UID와 다른 직원 문서 ID도 employeeId claim으로 확인하며 토큰·기기 정보를 한 번에 저장한다', async () => {
  await updateOwnPushToken('employee-own', 'token:with.dot', { name: '기기', at: '2026-10-07' });
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toEqual(['employees/employee-own', 'fcmTokens', { union: 'token:with.dot' }, expect.objectContaining({ parent: 'fcmDevices', token: 'token:with.dot' }), { name: '기기', at: '2026-10-07' }]);
});
it('삭제도 토큰과 해당 기기 키만 하나의 update로 제거한다', async () => {
  await updateOwnPushToken('employee-own', 'token:with.dot');
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toEqual(['employees/employee-own', 'fcmTokens', { remove: 'token:with.dot' }, expect.objectContaining({ token: 'token:with.dot' }), { delete: true }]);
});
it('타직원 및 로그인 없는 요청은 쓰기 전에 거절한다', async () => {
  await expect(updateOwnPushToken('foreign', 't')).rejects.toThrow('본인');
  state.loggedIn = false; await expect(updateOwnPushToken('employee-own', 't')).rejects.toThrow('본인');
  state.loggedIn = true; state.anonymous = true; await expect(updateOwnPushToken('employee-own', 't')).rejects.toThrow('본인');
  expect(state.writes).toEqual([]);
});
it('저장 실패는 반쪽 토큰·기기 기록 없이 전달한다', async () => {
  state.fail = true;
  await expect(updateOwnPushToken('employee-own', 't', { name: '기기', at: 'now' })).rejects.toThrow('저장 실패');
  expect(state.writes).toEqual([]);
});
it('관리자 자동등록과 마이페이지가 쓰는 실제 registerPush 경로는 한 번만 저장한다', async () => {
  const { registerPush } = await import('../push');
  expect(await registerPush('employee-own')).toEqual({ ok: true, token: 'token:with.dot' });
  expect(state.writes).toHaveLength(1);
});
it('기존 로그아웃 삭제 경로는 실패를 삼키고 성공 시 두 필드를 함께 지운다', async () => {
  const { unregisterPush } = await import('../push');
  await unregisterPush('employee-own', 'token:with.dot'); expect(state.writes).toHaveLength(1);
  state.fail = true; await expect(unregisterPush('employee-own', 'token:with.dot')).resolves.toBeUndefined();
  expect(state.writes).toHaveLength(1);
});

const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
const emit=(user:any)=>{state.currentUser=user;for(const listener of [...state.listeners])listener(user);};
it('동일 직원 ID라도 claims 대기 중 다른 UID·회사로 교체되면 쓰기0이다',async()=>{
 const token=deferred<{claims:Record<string,unknown>}>();state.claims=()=>token.promise;const request=updateOwnPushToken('employee-own','synthetic');await Promise.resolve();await Promise.resolve();
 emit({uid:'other-uid',isAnonymous:false,getIdTokenResult:async()=>({claims:{employeeId:'employee-own',companyId:'punghoe'}})});token.resolve({claims:{employeeId:'employee-own',companyId:'taebaek'}});await expect(request).rejects.toThrow();expect(state.writes).toEqual([]);expect(state.listeners.size).toBe(0);
});
it('초기 listener 뒤 동일 UID refresh도 해당 캡처를 영구 무효화하고 새 호출만 허용한다',async()=>{
 const actor=capturePushActor('employee-own');await actor.ready;emit(state.currentUser);await expect(updateOwnPushToken('employee-own','old',undefined,actor)).rejects.toThrow();await updateOwnPushToken('employee-own','new');expect(state.writes).toHaveLength(1);expect(state.writes[0][2]).toEqual({remove:'new'});actor.dispose();expect(state.listeners.size).toBe(0);
});
it('UID A-B-A 복귀와 최초 user객체 교체는 외부 context를 되살리지 않는다',async()=>{
 const first=state.currentUser,actor=capturePushActor('employee-own');await actor.ready;emit({...first,uid:'b'});emit(first);await expect(updateOwnPushToken('employee-own','old',undefined,actor)).rejects.toThrow();expect(state.writes).toEqual([]);actor.dispose();
});
it('authReady 대기 중 교체와 준비 거절은 모두 쓰기없이 listener를 정리한다',async()=>{
 const pending=deferred<void>();state.authReady=pending.promise;const task=updateOwnPushToken('employee-own','t');emit({...state.currentUser,uid:'b'});pending.resolve();await expect(task).rejects.toThrow();expect(state.listeners.size).toBe(0);
 state.authReady=Promise.reject(Error('준비 실패'));await expect(updateOwnPushToken('employee-own','t')).rejects.toThrow('준비 실패');expect(state.listeners.size).toBe(0);expect(state.writes).toEqual([]);
});
it('외부 context는 호출원이 정리하고 직원 binding 위장이나 dispose 후에는 쓰지 않는다',async()=>{
 const actor=capturePushActor('employee-own');await actor.ready;await expect(updateOwnPushToken('foreign','t',undefined,actor)).rejects.toThrow('본인');expect(state.listeners.size).toBe(1);await updateOwnPushToken('employee-own','t',undefined,actor);expect(state.listeners.size).toBe(1);actor.dispose();actor.dispose();await expect(updateOwnPushToken('employee-own','t2',undefined,actor)).rejects.toThrow();expect(state.writes).toHaveLength(1);expect(state.listeners.size).toBe(0);
});
it('같은 User객체의 UID 변경도 claims await 뒤 쓰기직전 차단한다',async()=>{
 const token=deferred<{claims:Record<string,unknown>}>();state.claims=()=>token.promise;const task=updateOwnPushToken('employee-own','t');await Promise.resolve();await Promise.resolve();state.currentUser.uid='changed';token.resolve({claims:{employeeId:'employee-own',companyId:'taebaek'}});await expect(task).rejects.toThrow();expect(state.writes).toEqual([]);
});

it('첫 listener가 캡처 User와 다르거나 claims 회사가 없으면 준비와 쓰기를 거절한다',async()=>{
 state.initialDifferent=true;await expect(updateOwnPushToken('employee-own','t')).rejects.toThrow();expect(state.listeners.size).toBe(0);state.initialDifferent=false;state.companyId='';await expect(updateOwnPushToken('employee-own','t')).rejects.toThrow('본인');expect(state.writes).toEqual([]);expect(state.listeners.size).toBe(0);
});
it('claims 조회 거절과 ready전 dispose도 외부 context listener를 남기지 않는다',async()=>{
 state.claims=async()=>{throw Error('토큰 조회 실패');};const failed=capturePushActor('employee-own');await expect(failed.ready).rejects.toThrow('토큰 조회 실패');expect(state.listeners.size).toBe(0);failed.dispose();state.claims=null;const closed=capturePushActor('employee-own');closed.dispose();await expect(closed.ready).rejects.toThrow();expect(state.listeners.size).toBe(0);
});
