import React, {StrictMode} from 'react';
import {readFileSync} from 'node:fs';
/** @vitest-environment jsdom */
import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Employee} from '../types';
const mock=vi.hoisted(()=>({auth:{currentUser:null as any},listener:null as any,stop:vi.fn(),ready:Promise.resolve() as Promise<void>,signOut:vi.fn(),unregister:vi.fn(),capture:vi.fn(),pushActor:{ready:Promise.resolve(),assertCurrent:vi.fn(),dispose:vi.fn()}}));
vi.mock('../firebase',()=>({auth:mock.auth,get authReady(){return mock.ready;}}));
vi.mock('../push',()=>({unregisterPush:mock.unregister,capturePushActor:mock.capture}));
vi.mock('firebase/auth',()=>({signOut:mock.signOut,onIdTokenChanged:vi.fn((_auth,listener)=>{mock.listener=listener;return mock.stop;})}));
import {onIdTokenChanged} from 'firebase/auth';
import {useEmployeeAuthSession} from './useEmployeeAuthSession';
const employee={id:'emp-a',companyId:'taebaek',name:'합성 직원',adminAccess:true} as Employee;
const user=(uid='uid-a',claims:Record<string,unknown>={employeeId:'emp-a',companyId:'taebaek',isAdmin:false})=>({uid,isAnonymous:false,getIdTokenResult:vi.fn(async()=>({claims}))});
const emit=async(value:any)=>{mock.auth.currentUser=value;await act(async()=>{mock.listener(value);});};
beforeEach(()=>{localStorage.clear();mock.auth.currentUser=null;mock.listener=null;mock.ready=Promise.resolve();vi.clearAllMocks();mock.signOut.mockReset().mockImplementation(async()=>{mock.auth.currentUser=null;mock.listener?.(null);});mock.unregister.mockReset().mockResolvedValue(undefined);mock.capture.mockReset().mockReturnValue(mock.pushActor);});
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();});
it('저장된 권한 대신 토큰 권한을 쓰고 같은 신원 갱신은 세션 객체와 key를 보존한다',async()=>{
 localStorage.setItem('tb_user',JSON.stringify(employee));const hook=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(mock.listener).toBeTruthy());
 await emit(user());expect(hook.result.current.currentUser?.adminAccess).toBe(false);const first=hook.result.current.currentUser,key=hook.result.current.sessionKey;
 await emit(user());expect(hook.result.current.currentUser).toBe(first);expect(hook.result.current.sessionKey).toBe(key);expect(onIdTokenChanged).toHaveBeenCalledOnce();
});
it.each([{employeeId:'other',companyId:'taebaek'},{employeeId:'emp-a',companyId:'punghoe'},{}])('저장 직원과 토큰 불일치는 복원하지 않는다 %j',async(claims)=>{
 localStorage.setItem('tb_user',JSON.stringify(employee));const hook=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(mock.listener).toBeTruthy());await emit(user('uid-a',claims));expect(hook.result.current.currentUser).toBeNull();expect(localStorage.getItem('tb_user')).toBeNull();expect(hook.result.current.authChecked).toBe(true);
});
it('UID 변경은 검증 대기 중 즉시 화면 신원을 비우고 옛 응답은 돌아와도 되살리지 않는다',async()=>{
 localStorage.setItem('tb_user',JSON.stringify(employee));const hook=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(mock.listener).toBeTruthy());await emit(user());
 let resolve!:(v:any)=>void;const pending=user('uid-b');pending.getIdTokenResult.mockImplementation(()=>new Promise(r=>resolve=r));mock.auth.currentUser=pending;
 act(()=>mock.listener(pending));expect(hook.result.current.currentUser).toBeNull();await emit(null);await act(async()=>resolve({claims:{employeeId:'emp-a',companyId:'taebaek',isAdmin:true}}));expect(hook.result.current.currentUser).toBeNull();expect(localStorage.getItem('tb_user')).toBeNull();
});
it('로그인 callback도 같은 토큰 검사와 회사 대조를 거치고 unmount 후 응답은 저장하지 않는다',async()=>{
 const hook=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(mock.listener).toBeTruthy());mock.auth.currentUser=user();await act(async()=>hook.result.current.onLogin(employee));expect(hook.result.current.currentUser?.id).toBe('emp-a');
 let resolve!:(v:any)=>void;const pending=user();pending.getIdTokenResult.mockImplementation(()=>new Promise(r=>resolve=r));mock.auth.currentUser=pending;act(()=>hook.result.current.onLogin(employee));hook.unmount();localStorage.removeItem('tb_user');await act(async()=>resolve({claims:{employeeId:'emp-a',companyId:'taebaek',isAdmin:true}}));expect(localStorage.getItem('tb_user')).toBeNull();expect(mock.stop).toHaveBeenCalledOnce();
});

it('StrictMode 재설치에도 토큰 listener는 한 벌이며 권한 변경은 새 자료 수명 key가 된다',async()=>{
 localStorage.setItem('tb_user',JSON.stringify(employee));const hook=renderHook(()=>useEmployeeAuthSession(),{wrapper:({children}:{children:React.ReactNode})=><StrictMode>{children}</StrictMode>});await waitFor(()=>expect(mock.listener).toBeTruthy());expect(onIdTokenChanged).toHaveBeenCalledOnce();await emit(user());const oldKey=hook.result.current.sessionKey;await emit(user('uid-a',{employeeId:'emp-a',companyId:'taebaek',isAdmin:true}));expect(hook.result.current.sessionKey).not.toBe(oldKey);expect(hook.result.current.currentUser?.adminAccess).toBe(true);
});
it('양앱은 검증된 세션 key 안에서 자료 구독과 앱을 함께 mount한다',()=>{
 for(const app of ['admin','staff']){const source=readFileSync('apps/'+app+'/main.tsx','utf8');expect(source).toContain('key={session.sessionKey}');expect(source).toContain('const session=useEmployeeAuthSession()');expect(source).not.toContain('readEmployeeSession');expect(source).not.toContain('setCurrentUser');expect(source.indexOf('const appData = useAppData')).toBeLessThan(source.indexOf('const session=useEmployeeAuthSession()'));}
});

it('정상 B 로그인 뒤 도착한 A의 옛 로그인 callback은 B의 세션과 저장본을 지우지 않는다',async()=>{const b={...employee,id:'emp-b',name:'직원 B'};localStorage.setItem('tb_user',JSON.stringify(b));const hook=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(mock.listener).toBeTruthy());await emit(user('uid-b',{employeeId:'emp-b',companyId:'taebaek',isAdmin:false}));const before=hook.result.current.currentUser,key=hook.result.current.sessionKey;await act(async()=>hook.result.current.onLogin(employee));expect(hook.result.current.currentUser).toBe(before);expect(hook.result.current.sessionKey).toBe(key);expect(JSON.parse(localStorage.getItem('tb_user')!).id).toBe('emp-b');});

const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;const promise=new Promise<T>((ok,no)=>{resolve=ok;reject=no;});return {promise,resolve,reject};};
async function loggedIn(){localStorage.setItem('tb_user',JSON.stringify(employee));const hook=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(mock.listener).toBeTruthy());await emit(user());return hook;}
it('로그아웃은 첫 tick 잠금 뒤 null 이벤트가 먼저 와도 응답까지 pending을 유지한다',async()=>{
 const hook=await loggedIn(),pending=deferred<void>();mock.signOut.mockReturnValueOnce(pending.promise);let task!:Promise<void>;
 act(()=>{task=hook.result.current.logout();void hook.result.current.logout();void hook.result.current.retryLogout();});
 expect(mock.signOut).toHaveBeenCalledOnce();expect(hook.result.current.logoutState).toBe('pending');await emit(null);expect(hook.result.current.logoutState).toBe('pending');expect(localStorage.getItem('tb_user')).not.toBeNull();
 await act(async()=>{pending.resolve();await task;});expect(hook.result.current.logoutState).toBe('idle');expect(hook.result.current.currentUser).toBeNull();expect(localStorage.getItem('tb_user')).toBeNull();expect(mock.unregister).toHaveBeenCalledExactlyOnceWith('emp-a',undefined,mock.pushActor);
});
it('거절 후 Auth가 남으면 저장세션을 지우지 않고 실패·명시재시도하며 push는 한 번뿐이다',async()=>{
 const hook=await loggedIn();mock.signOut.mockRejectedValueOnce(Error('종료 거절'));await act(async()=>{await expect(hook.result.current.logout()).resolves.toBeUndefined();});
 expect(hook.result.current.logoutState).toBe('failed');expect(hook.result.current.logoutError).toBe('종료 거절');expect(localStorage.getItem('tb_user')).not.toBeNull();
 await act(async()=>hook.result.current.retryLogout());expect(hook.result.current.logoutState).toBe('idle');expect(mock.signOut).toHaveBeenCalledTimes(2);expect(mock.unregister).toHaveBeenCalledOnce();
});
it('성공 응답이어도 Auth 잔존이면 완료로 올리지 않고 push 거절은 관찰해 분리한다',async()=>{
 const hook=await loggedIn();mock.signOut.mockResolvedValueOnce(undefined);mock.unregister.mockRejectedValueOnce(Error('푸시 정리 실패'));await act(async()=>hook.result.current.logout());
 expect(hook.result.current.logoutState).toBe('failed');expect(hook.result.current.logoutError).toContain('로그인 상태');expect(hook.result.current.currentUser).not.toBeNull();
});
it('로그아웃 이전 토큰검증 응답은 pending 세션을 다시 저장하지 않는다',async()=>{
 const hook=await loggedIn(),token=deferred<any>(),pending=deferred<void>();const fresh=user();fresh.getIdTokenResult.mockReturnValueOnce(token.promise);mock.auth.currentUser=fresh;act(()=>mock.listener(fresh));mock.signOut.mockReturnValueOnce(pending.promise);let task!:Promise<void>;act(()=>{task=hook.result.current.logout();});
 localStorage.setItem('tb_user','관측보존');await act(async()=>token.resolve({claims:{employeeId:'emp-a',companyId:'taebaek'}}));expect(localStorage.getItem('tb_user')).toBe('관측보존');await emit(null);await act(async()=>{pending.resolve();await task;});
});
it.each(['resolve','reject'] as const)('UID A-B-A 뒤 옛 로그아웃 %s는 새 저장세션을 지우지 않는다',async(kind)=>{
 const hook=await loggedIn(),pending=deferred<void>();mock.signOut.mockReturnValueOnce(pending.promise);let task!:Promise<void>;act(()=>{task=hook.result.current.logout();});
 await emit(user('uid-b'));await emit(user());await act(async()=>hook.result.current.onLogin(employee));const raw=localStorage.getItem('tb_user'),key=hook.result.current.sessionKey;
 await act(async()=>{if(kind==='resolve')pending.resolve();else pending.reject(Error('옛 거절'));await task;});expect(localStorage.getItem('tb_user')).toBe(raw);expect(hook.result.current.sessionKey).toBe(key);expect(hook.result.current.logoutState).toBe('idle');
});
it('unmount 뒤 로그아웃 응답은 다른 화면의 저장본을 지우지 않는다',async()=>{
 const hook=await loggedIn(),pending=deferred<void>();mock.signOut.mockReturnValueOnce(pending.promise);let task!:Promise<void>;act(()=>{task=hook.result.current.logout();});hook.unmount();localStorage.setItem('tb_user','새 화면');mock.auth.currentUser=null;await act(async()=>{pending.resolve();await task;});expect(localStorage.getItem('tb_user')).toBe('새 화면');
});

it('Auth 객체가 listener보다 먼저 다른 UID가 되면 옛 실패 재시도는 새 계정을 signOut하지 않는다',async()=>{
 const hook=await loggedIn();mock.signOut.mockRejectedValueOnce(Error('A 실패'));await act(async()=>hook.result.current.logout());expect(hook.result.current.logoutState).toBe('failed');
 mock.auth.currentUser=user('uid-b');await act(async()=>hook.result.current.retryLogout());expect(mock.signOut).toHaveBeenCalledOnce();expect(mock.auth.currentUser.uid).toBe('uid-b');
});

const markerKey='tb_logout_intent_v1';
const marker=(uid='uid-a',companyId='taebaek',employeeId='emp-a')=>JSON.stringify({version:1,attemptId:crypto.randomUUID(),uid,companyId,employeeId});
it('실패한 로그아웃은 reload 뒤 업무 대신 실패를 복원하고 명시 retry만 같은 attempt를 마친다',async()=>{
 const first=await loggedIn();mock.signOut.mockRejectedValueOnce(Error('응답 거절'));await act(async()=>first.result.current.logout());const raw=localStorage.getItem(markerKey);expect(raw).not.toBeNull();first.unmount();
 const second=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(mock.listener).toBeTruthy());await emit(user());expect(second.result.current.currentUser).toBeNull();expect(second.result.current.logoutState).toBe('failed');expect(mock.signOut).toHaveBeenCalledOnce();expect(localStorage.getItem(markerKey)).toBe(raw);
 mock.signOut.mockRejectedValueOnce(Error('두 번째 거절'));await act(async()=>second.result.current.retryLogout());expect(localStorage.getItem(markerKey)).toBe(raw);await act(async()=>second.result.current.retryLogout());expect(second.result.current.logoutState).toBe('idle');expect(localStorage.getItem(markerKey)).toBeNull();expect(mock.unregister).toHaveBeenCalledOnce();
});
it.each(['{broken',JSON.stringify({version:1,uid:'uid-a'})])('손상된 intent는 Auth가 있으면 업무를 복원하지 않고 현재 검증 계정의 명시 로그아웃을 허용한다 %s',async(raw)=>{
 localStorage.setItem(markerKey,raw);localStorage.setItem('tb_user',JSON.stringify(employee));const hook=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(mock.listener).toBeTruthy());await emit(user());expect(hook.result.current.logoutState).toBe('failed');expect(hook.result.current.currentUser).toBeNull();expect(mock.signOut).not.toHaveBeenCalled();await act(async()=>hook.result.current.retryLogout());expect(hook.result.current.logoutState).toBe('idle');expect(mock.signOut).toHaveBeenCalledOnce();
});
it('intent 읽기 거절은 업무를 차단하되 검증된 현재 계정의 재시도는 외부 throw 없이 실행한다',async()=>{
 localStorage.setItem('tb_user',JSON.stringify(employee));const original=Storage.prototype.getItem;const spy=vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,key:string){if(key===markerKey)throw Error('읽기 불가');return original.call(this,key);});const hook=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(mock.listener).toBeTruthy());await emit(user());expect(hook.result.current.logoutState).toBe('failed');expect(hook.result.current.logoutError).toContain('읽지 못');expect(hook.result.current.currentUser).toBeNull();spy.mockRestore();await act(async()=>hook.result.current.retryLogout());expect(mock.signOut).toHaveBeenCalledOnce();expect(hook.result.current.logoutState).toBe('idle');
});
it('intent 쓰기 거절도 실제 signOut을 막지 않으며 실패 때 보관 한계를 설명한다',async()=>{
 const hook=await loggedIn(),original=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key:string,value:string){if(key===markerKey)throw Error('보관 불가');return original.call(this,key,value);});mock.signOut.mockRejectedValueOnce(Error('인증 종료 실패'));await act(async()=>hook.result.current.logout());expect(mock.signOut).toHaveBeenCalledOnce();expect(hook.result.current.logoutState).toBe('failed');expect(hook.result.current.logoutError).toContain('기기에 요청 기록을 보관하지 못');expect(hook.result.current.logoutError).toContain('새로고침 후에는 이 차단 상태를 유지하지 못할 수');await act(async()=>hook.result.current.retryLogout());expect(hook.result.current.logoutState).toBe('idle');
});
it('Auth null 뒤 marker 제거 실패가 같은 UID의 명시 새 로그인을 영구 차단하지 않는다',async()=>{
 localStorage.setItem(markerKey,marker());localStorage.setItem('tb_user',JSON.stringify(employee));const remove=Storage.prototype.removeItem;vi.spyOn(Storage.prototype,'removeItem').mockImplementation(function(this:Storage,key:string){if(key===markerKey)throw Error('제거 불가');return remove.call(this,key);});const hook=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(mock.listener).toBeTruthy());await emit(null);expect(hook.result.current.logoutState).toBe('idle');mock.auth.currentUser=user();await act(async()=>hook.result.current.onLogin(employee));expect(hook.result.current.currentUser?.id).toBe('emp-a');expect(hook.result.current.logoutState).toBe('idle');
});
it('다른 정상 검증 actor는 옛 marker에 묶지 않으며 새 raw를 옛 ACK가 정리하지 않는다',async()=>{
 localStorage.setItem(markerKey,marker('old-uid'));const hook=await loggedIn();expect(hook.result.current.logoutState).toBe('idle');expect(localStorage.getItem(markerKey)).toBeNull();const pending=deferred<void>();mock.signOut.mockReturnValueOnce(pending.promise);let task!:Promise<void>;act(()=>{task=hook.result.current.logout();});const changed=marker('uid-b');localStorage.setItem(markerKey,changed);mock.auth.currentUser=null;await act(async()=>{pending.resolve();await task;});expect(localStorage.getItem(markerKey)).toBe(changed);expect(hook.result.current.logoutState).toBe('idle');
});

it('재시도는 같은 UID라도 claims 회사·직원이 바뀌었으면 signOut을 추가 송신하지 않는다',async()=>{
 const hook=await loggedIn();mock.signOut.mockRejectedValueOnce(Error('A 실패'));await act(async()=>hook.result.current.logout());mock.auth.currentUser=user('uid-a',{employeeId:'emp-b',companyId:'punghoe',isAdmin:false});await act(async()=>hook.result.current.retryLogout());expect(mock.signOut).toHaveBeenCalledOnce();expect(hook.result.current.logoutState).toBe('failed');expect(hook.result.current.logoutError).toContain('계정 정보가 바뀌었습니다');
});
it('Firebase 네트워크 거절은 기술 오류 대신 연결 확인과 명시 재시도를 안내한다',async()=>{
 const hook=await loggedIn();mock.signOut.mockRejectedValueOnce(Object.assign(Error('Firebase: Error (auth/network-request-failed).'),{code:'auth/network-request-failed'}));await act(async()=>hook.result.current.logout());expect(hook.result.current.logoutError).toBe('네트워크 연결을 확인한 뒤 다시 로그아웃해 주세요.');expect(hook.result.current.logoutError).not.toContain('Firebase');
});

it('새 실제 Auth가 존재할 때 뒤늦은 null 이벤트는 새 세션과 marker를 삭제하지 않는다',async()=>{
 const hook=await loggedIn(),next={...employee,id:'emp-b',companyId:'punghoe'} as Employee;mock.auth.currentUser=user('uid-b',{employeeId:'emp-b',companyId:'punghoe',isAdmin:false});await act(async()=>hook.result.current.onLogin(next));const raw=marker('uid-b','punghoe','emp-b');localStorage.setItem(markerKey,raw);const saved=localStorage.getItem('tb_user');await act(async()=>mock.listener(null));expect(localStorage.getItem('tb_user')).toBe(saved);expect(localStorage.getItem(markerKey)).toBe(raw);expect(hook.result.current.currentUser?.id).toBe('emp-b');
});

it('같은 UID의 회사 A-B-A 정상 로그인 뒤 옛 종료 ACK는 새 세션과 marker를 정리하지 않는다',async()=>{
 const hook=await loggedIn(),pending=deferred<void>();mock.signOut.mockReturnValueOnce(pending.promise);let task!:Promise<void>;act(()=>{task=hook.result.current.logout();});const b={...employee,id:'emp-b',companyId:'punghoe'} as Employee;mock.auth.currentUser=user('uid-a',{employeeId:'emp-b',companyId:'punghoe',isAdmin:false});await act(async()=>hook.result.current.onLogin(b));mock.auth.currentUser=user();await act(async()=>hook.result.current.onLogin(employee));const raw=localStorage.getItem('tb_user'),next=marker();localStorage.setItem(markerKey,next);await act(async()=>{pending.resolve();await task;});expect(localStorage.getItem('tb_user')).toBe(raw);expect(localStorage.getItem(markerKey)).toBe(next);expect(hook.result.current.currentUser?.companyId).toBe('taebaek');expect(hook.result.current.logoutState).toBe('idle');
});

it('marker 복원 토큰 조회 거절은 무한 pending 대신 실패와 명시 로그아웃을 제공한다',async()=>{
 localStorage.setItem(markerKey,marker());localStorage.setItem('tb_user',JSON.stringify(employee));const rejecting=user();rejecting.getIdTokenResult.mockRejectedValue(Error('토큰 네트워크 불가'));const hook=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(mock.listener).toBeTruthy());await emit(rejecting);expect(hook.result.current.logoutState).toBe('failed');expect(hook.result.current.currentUser).toBeNull();expect(mock.signOut).not.toHaveBeenCalled();await act(async()=>hook.result.current.retryLogout());expect(mock.signOut).toHaveBeenCalledOnce();expect(hook.result.current.logoutState).toBe('idle');
});
it('marker 복원 authReady 거절도 현재 Auth를 종료하는 명시 재시도를 막지 않는다',async()=>{
 localStorage.setItem(markerKey,marker());localStorage.setItem('tb_user',JSON.stringify(employee));mock.auth.currentUser=user();mock.auth.currentUser.getIdTokenResult.mockRejectedValue(Error('토큰 불가'));mock.ready=Promise.reject(Error('Auth 준비 실패'));const hook=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(hook.result.current.authChecked).toBe(true));expect(hook.result.current.logoutState).toBe('failed');expect(mock.signOut).not.toHaveBeenCalled();await act(async()=>hook.result.current.retryLogout());expect(mock.signOut).toHaveBeenCalledOnce();expect(hook.result.current.logoutState).toBe('idle');
});

it('marker가 있어도 authReady 거절 시 실제 Auth null이면 로그인 대기를 허용하고 민감 세션은 없다',async()=>{
 localStorage.setItem(markerKey,marker());localStorage.setItem('tb_user',JSON.stringify(employee));mock.ready=Promise.reject(Error('준비 실패'));const hook=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(hook.result.current.authChecked).toBe(true));expect(hook.result.current.logoutState).toBe('idle');expect(hook.result.current.currentUser).toBeNull();expect(mock.signOut).not.toHaveBeenCalled();expect(localStorage.getItem(markerKey)).toBeNull();
});
it('authReady 거절 뒤에도 Auth 이벤트를 감시하여 재시도 토큰대기 중 UID 왕복은 옛 송신을 막는다',async()=>{
 localStorage.setItem(markerKey,marker());const selected=user(),token=deferred<any>();selected.getIdTokenResult.mockRejectedValueOnce(Error('처음 토큰 실패')).mockReturnValueOnce(token.promise);mock.auth.currentUser=selected;mock.ready=Promise.reject(Error('준비 실패'));const hook=renderHook(()=>useEmployeeAuthSession());await waitFor(()=>expect(hook.result.current.logoutState).toBe('failed'));let task!:Promise<void>;act(()=>{task=hook.result.current.retryLogout();});await emit(user('uid-b'));await emit(selected);await act(async()=>{token.resolve({claims:{employeeId:'emp-a',companyId:'taebaek',isAdmin:false}});await task;});expect(mock.signOut).not.toHaveBeenCalled();
});
it('푸시 owner는 microtask와 signOut 전에 동기 캡처하며 푸시 완료를 기다리지 않는다',async()=>{
 const hook=await loggedIn();const push=deferred<void>();mock.unregister.mockReturnValue(push.promise);
 await act(async()=>hook.result.current.logout());
 expect(mock.capture).toHaveBeenCalledExactlyOnceWith('emp-a');
 expect(mock.capture.mock.invocationCallOrder[0]).toBeLessThan(mock.signOut.mock.invocationCallOrder[0]);
 expect(mock.unregister).toHaveBeenCalledWith('emp-a',undefined,mock.pushActor);
 expect(hook.result.current.logoutState).toBe('idle');expect(mock.pushActor.dispose).not.toHaveBeenCalled();
 await act(async()=>push.resolve());expect(mock.pushActor.dispose).toHaveBeenCalledTimes(1);
});
it('푸시 owner 캡처가 실패해도 signOut을 실행하며 재시도로 중복 캡처하지 않는다',async()=>{
 const hook=await loggedIn();mock.capture.mockImplementation(()=>{throw Error('합성 캡처 실패');});mock.signOut.mockRejectedValueOnce(Error('합성 인증 실패'));
 await act(async()=>hook.result.current.logout());expect(hook.result.current.logoutState).toBe('failed');expect(mock.unregister).not.toHaveBeenCalled();
 await act(async()=>hook.result.current.retryLogout());expect(hook.result.current.logoutState).toBe('idle');expect(mock.signOut).toHaveBeenCalledTimes(2);expect(mock.capture).toHaveBeenCalledTimes(1);
});

it('mount 수명 key는 로그아웃 actor 대조와 기기 intent 형식을 바꾸지 않는다',async()=>{
 const hook=await loggedIn();expect(hook.result.current.sessionKey).toContain('uid-a:emp-a:taebaek:staff');mock.signOut.mockRejectedValueOnce(Error('첫 종료 거절'));await act(async()=>hook.result.current.logout());expect(hook.result.current.logoutState).toBe('failed');const intent=JSON.parse(localStorage.getItem(markerKey)!);expect(intent).toEqual({version:1,attemptId:expect.any(String),uid:'uid-a',companyId:'taebaek',employeeId:'emp-a'});await act(async()=>hook.result.current.retryLogout());expect(mock.signOut).toHaveBeenCalledTimes(2);expect(hook.result.current.logoutState).toBe('idle');expect(hook.result.current.currentUser).toBeNull();
});
it('명시 세션 해제 뒤 동일 신원 로그인은 이전 mount 수명 key를 재사용하지 않는다',async()=>{
 const hook=await loggedIn(),key=hook.result.current.sessionKey;act(()=>hook.result.current.clearSession());expect(hook.result.current.currentUser).toBeNull();await act(async()=>hook.result.current.onLogin(employee));expect(hook.result.current.currentUser?.id).toBe(employee.id);expect(hook.result.current.sessionKey).not.toBe(key);
});
it('현재 Auth와 다른 늦은 UID 이벤트는 현재 mount 수명을 교체하지 않는다',async()=>{
 const hook=await loggedIn(),key=hook.result.current.sessionKey,selected=hook.result.current.currentUser;await act(async()=>{mock.listener(user('stale-b'));});expect(hook.result.current.currentUser).toBe(selected);expect(hook.result.current.sessionKey).toBe(key);
});
