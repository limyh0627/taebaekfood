import React, {StrictMode} from 'react';
import {readFileSync} from 'node:fs';
/** @vitest-environment jsdom */
import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Employee} from '../types';
const mock=vi.hoisted(()=>({auth:{currentUser:null as any},listener:null as any,stop:vi.fn()}));
vi.mock('../firebase',()=>({auth:mock.auth,authReady:Promise.resolve()}));
vi.mock('firebase/auth',()=>({onIdTokenChanged:vi.fn((_auth,listener)=>{mock.listener=listener;return mock.stop;})}));
import {onIdTokenChanged} from 'firebase/auth';
import {useEmployeeAuthSession} from './useEmployeeAuthSession';
const employee={id:'emp-a',companyId:'taebaek',name:'합성 직원',adminAccess:true} as Employee;
const user=(uid='uid-a',claims:Record<string,unknown>={employeeId:'emp-a',companyId:'taebaek',isAdmin:false})=>({uid,isAnonymous:false,getIdTokenResult:vi.fn(async()=>({claims}))});
const emit=async(value:any)=>{mock.auth.currentUser=value;await act(async()=>{mock.listener(value);});};
beforeEach(()=>{localStorage.clear();mock.auth.currentUser=null;mock.listener=null;vi.clearAllMocks();});
afterEach(()=>{localStorage.clear();});
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
