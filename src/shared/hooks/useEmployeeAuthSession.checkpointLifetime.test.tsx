/** @vitest-environment jsdom */
import React,{useEffect} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const fake=vi.hoisted(()=>({holderExists:true,auth:{currentUser:null as any,onAuthStateChanged:(fn:any)=>{fake.authListeners.add(fn);return()=>fake.authListeners.delete(fn);}},authListeners:new Set<any>(),token:null as any,signOut:vi.fn(),call:vi.fn(),mounts:0,unmounts:0}));
vi.mock('../firebase',()=>({auth:fake.auth,authReady:Promise.resolve()}));
vi.mock('../push',()=>({capturePushActor:()=>({dispose:vi.fn()}),unregisterPush:vi.fn()}));
vi.mock('firebase/auth',()=>({onIdTokenChanged:(_auth:any,fn:any)=>{fake.token=fn;return()=>{fake.token=null;};},signOut:fake.signOut}));
vi.mock('../services/rawManualCorrectionService',()=>({rawManualCorrection:fake.call}));
import {useEmployeeAuthSession} from './useEmployeeAuthSession';
import {useRawManualCorrection} from '../../features/items/hooks/useRawManualCorrection';
import SessionLogoutState from '../components/SessionLogoutState';
const employee={id:'employee',companyId:'taebaek',name:'직원'} as any;
const user=()=>({uid:'uid',isAnonymous:false,getIdTokenResult:async()=>({claims:{employeeId:'employee',companyId:'taebaek'}})});
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(fn=>{resolve=fn;});return{promise,resolve};};
let raw:ReturnType<typeof useRawManualCorrection>,session:ReturnType<typeof useEmployeeAuthSession>;
function Child(){raw=useRawManualCorrection({companyId:'taebaek',employeeId:'employee',material:'참깨',originalId:'original',items:fake.holderExists?[{id:'raw',name:'참깨',type:'raw',subtype:'벌크',companyId:'taebaek'} as any]:[]});useEffect(()=>{fake.mounts++;return()=>{fake.unmounts++;};},[]);return <input aria-label="정정 수량" value={raw.draft.amount} onChange={e=>raw.updateDraft({amount:e.target.value})}/>;}
function Root(){session=useEmployeeAuthSession();if(session.logoutState!=='idle')return <div>인증 종료 중</div>;if(!session.currentUser)return <div>로그인</div>;return <><Child key={session.sessionKey}/><button onClick={()=>void session.logout()}>로그아웃</button>{session.checkpointState!=='idle'&&<SessionLogoutState state={session.checkpointState==='checking'?'checking':'checkpoint-failed'} error={session.checkpointError} onRetry={session.retryCheckpointLogout} onReturn={session.returnToWork}/>}</>;}
beforeEach(()=>{localStorage.clear();fake.holderExists=true;fake.authListeners.clear();fake.mounts=0;fake.unmounts=0;fake.token=null;fake.auth.currentUser=user();fake.signOut.mockReset().mockImplementation(async()=>{fake.auth.currentUser=null;fake.token?.(null);});fake.call.mockReset();localStorage.setItem('tb_user',JSON.stringify(employee));Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:any,_options:any,fn:any)=>fn()}});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('실 RAW 보관 대기 중 로그아웃은 같은 child와 입력을 유지하고 signOut을 시작하지 않는다',async()=>{
 render(<Root/>);await waitFor(()=>expect(fake.token).toBeTruthy());await act(async()=>fake.token(fake.auth.currentUser));await screen.findByRole('textbox');
 const pending=deferred();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:any,_options:any,fn:any)=>{await pending.promise;return fn();}}});
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'20'}});fireEvent.click(screen.getByRole('button',{name:'로그아웃'}));
 expect.soft(fake.signOut).not.toHaveBeenCalled();expect.soft(fake.unmounts).toBe(0);expect.soft(screen.queryByRole('textbox')).toHaveValue('20');
 await act(async()=>{pending.resolve();await raw.flushDraft();});
 await waitFor(()=>expect(fake.signOut).toHaveBeenCalledOnce());
});
async function login(){render(<Root/>);await waitFor(()=>expect(fake.token).toBeTruthy());await act(async()=>fake.token(fake.auth.currentUser));await screen.findByRole('textbox');}
it('holder가 없는 현재 계정 입력 보관 실패도 logout을 막고 같은 입력으로 돌아간다',async()=>{
 fake.holderExists=false;await login();fireEvent.change(screen.getByRole('textbox'),{target:{value:'91'}});await act(async()=>{await expect(raw.flushDraft()).rejects.toThrow('원료 홀더');});await act(async()=>session.logout());
 expect.soft(fake.signOut).not.toHaveBeenCalled();expect.soft(session.checkpointState).toBe('failed');expect.soft(fake.unmounts).toBe(0);expect.soft(raw.draft.amount).toBe('91');
 if(session.checkpointState==='failed'){fireEvent.click(screen.getByRole('button',{name:'작업으로 돌아가기'}));expect(screen.getByRole('textbox')).toHaveValue('91');expect(fake.mounts).toBe(1);}
});
it('보관 실패 후 같은 입력과 instance로 돌아가고 명시 재보관 성공 뒤에만 로그아웃한다',async()=>{
 await login();const original=Storage.prototype.setItem;const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(key.startsWith('raw-manual-copy'))throw Error('quota');return original.call(this,key,value);});
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'30'}});await act(async()=>{await session.logout();});
 expect(session.checkpointState).toBe('failed');expect(fake.signOut).not.toHaveBeenCalled();expect(fake.unmounts).toBe(0);expect(raw.draft.amount).toBe('30');
 await act(async()=>{await raw.run('apply');raw.updateDraft({amount:'99'});});expect(fake.call).not.toHaveBeenCalled();expect(raw.draft.amount).toBe('30');
 fireEvent.click(screen.getByRole('button',{name:'작업으로 돌아가기'}));expect(session.checkpointState).toBe('idle');expect(screen.getByRole('textbox')).toHaveValue('30');expect(fake.mounts).toBe(1);
 await act(async()=>{await session.logout();});expect(session.checkpointState).toBe('failed');spy.mockRestore();await act(async()=>{await session.retryCheckpointLogout();});expect(fake.signOut).toHaveBeenCalledOnce();
});
it('보관 대기 동안 동일 token 갱신은 child를 보존하고 중복 logout은 한번만 실행한다',async()=>{
 await login();const pending=deferred();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:any,_options:any,fn:any)=>{await pending.promise;return fn();}}});fireEvent.change(screen.getByRole('textbox'),{target:{value:'40'}});
 let task!:Promise<void>;act(()=>{task=session.logout();void session.logout();void session.retryCheckpointLogout();void session.retryLogout();});const key=session.sessionKey;await act(async()=>fake.token(fake.auth.currentUser));expect(session.sessionKey).toBe(key);expect(fake.mounts).toBe(1);expect(fake.signOut).not.toHaveBeenCalled();await act(async()=>{pending.resolve();await task;});expect(fake.signOut).toHaveBeenCalledOnce();
});
it('보관 중 UID ABA의 옛 flush는 새 세션을 로그아웃하지 않는다',async()=>{
 await login();const pending=deferred();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:any,_options:any,fn:any)=>{await pending.promise;return fn();}}});fireEvent.change(screen.getByRole('textbox'),{target:{value:'50'}});let task!:Promise<void>;act(()=>{task=session.logout();});
 await act(async()=>{const b={...user(),uid:'other'};fake.auth.currentUser=b;for(const fn of fake.authListeners)fn(b);fake.token(b);fake.auth.currentUser=user();for(const fn of fake.authListeners)fn(fake.auth.currentUser);fake.token(fake.auth.currentUser);});
 await act(async()=>{pending.resolve();await task;});expect(fake.signOut).not.toHaveBeenCalled();expect(session.checkpointState).toBe('idle');expect(fake.mounts).toBe(2);act(()=>raw.readAgain());expect(raw.draft.amount).toBe('50');
});
it('서버 signOut 시작 뒤 실패에는 보관 복귀 버튼으로 업무를 다시 열지 않는다',async()=>{
 await login();fireEvent.change(screen.getByRole('textbox'),{target:{value:'60'}});await act(async()=>raw.flushDraft());fake.signOut.mockRejectedValueOnce(Error('인증 종료 실패'));await act(async()=>session.logout());expect(session.logoutState).toBe('failed');expect(screen.queryByRole('textbox')).toBeNull();act(()=>session.returnToWork());expect(session.logoutState).toBe('failed');expect(screen.queryByRole('textbox')).toBeNull();
});
it('외부 Auth null은 보관 대기 child를 즉시 가리고 옛 flush는 signOut하지 않는다',async()=>{
 await login();const pending=deferred();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:any,_options:any,fn:any)=>{await pending.promise;return fn();}}});fireEvent.change(screen.getByRole('textbox'),{target:{value:'70'}});let task!:Promise<void>;act(()=>{task=session.logout();});await act(async()=>{fake.auth.currentUser=null;for(const fn of fake.authListeners)fn(null);fake.token(null);});expect(screen.queryByRole('textbox')).toBeNull();await act(async()=>{pending.resolve();await task;});expect(fake.signOut).not.toHaveBeenCalled();expect(screen.queryByRole('textbox')).toBeNull();
});
it('같은 UID의 검증된 권한 key 변경도 옛 보관 완료로 새 세션을 종료하지 않는다',async()=>{
 await login();const pending=deferred();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:any,_options:any,fn:any)=>{await pending.promise;return fn();}}});fireEvent.change(screen.getByRole('textbox'),{target:{value:'75'}});let task!:Promise<void>;act(()=>{task=session.logout();});const oldKey=session.sessionKey;
 await act(async()=>{fake.auth.currentUser={...user(),getIdTokenResult:async()=>({claims:{employeeId:'employee',companyId:'taebaek',isAdmin:true}})};fake.token(fake.auth.currentUser);});expect(session.sessionKey).not.toBe(oldKey);await act(async()=>{pending.resolve();await task;});expect(fake.signOut).not.toHaveBeenCalled();expect(session.checkpointState).toBe('idle');
});
it('서버 접수 대기 logout은 cancel하지 않고 같은 계정 재로그인 뒤 명시 inspect로 이어진다',async()=>{
 await login();fireEvent.change(screen.getByRole('textbox'),{target:{value:'80'}});await act(async()=>raw.flushDraft());let finish!:(value:any)=>void,packet:any;fake.call.mockImplementation(async(_action,r)=>{packet=r;return new Promise(fn=>{finish=fn;});});let sending!:Promise<void>;act(()=>{sending=raw.run('apply');});await waitFor(()=>expect(fake.call).toHaveBeenCalledOnce());await act(async()=>session.logout());expect(fake.signOut).toHaveBeenCalledOnce();const response={version:1,operationId:packet.operationId,companyId:packet.companyId,actorUid:packet.actorUid,employeeId:packet.employeeId,status:'applied',message:'정정 완료'};await act(async()=>{finish(response);await sending;});expect(fake.call.mock.calls[0]![0]).toBe('apply');
 await act(async()=>{fake.auth.currentUser=user();session.onLogin(employee);});await screen.findByRole('textbox');expect(raw.copy!.entry.state).toBe('submitted');expect(fake.call).toHaveBeenCalledOnce();fake.call.mockResolvedValue(response);await act(async()=>raw.run('inspect',raw.copy!));expect(fake.call).toHaveBeenCalledTimes(2);expect(fake.call.mock.calls[1]![0]).toBe('inspect');expect(fake.call.mock.calls[1]![1]).toEqual(packet);expect(raw.copy!.entry.result!.status).toBe('applied');
});
