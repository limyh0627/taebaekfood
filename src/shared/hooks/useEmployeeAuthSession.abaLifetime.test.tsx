/** @vitest-environment jsdom */
import React,{useEffect,useRef} from 'react';
import {act,cleanup,render,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import type {Employee,ChatMessage,ChatRoom} from '../types';
const fake=vi.hoisted(()=>{
 const tokenListeners=new Set<(user:any)=>void>(),authListeners=new Set<(user:any)=>void>();
 const auth={currentUser:null as any,onAuthStateChanged:vi.fn((listener:(user:any)=>void)=>{authListeners.add(listener);queueMicrotask(()=>{if(authListeners.has(listener))listener(auth.currentUser);});return()=>{authListeners.delete(listener);};})};
 return{auth,tokenListeners,authListeners,signOut:vi.fn(),capture:vi.fn(),unregister:vi.fn()};
});
vi.mock('../firebase',()=>({auth:fake.auth,authReady:Promise.resolve()}));
vi.mock('../push',()=>({capturePushActor:fake.capture,unregisterPush:fake.unregister}));
vi.mock('firebase/auth',()=>({signOut:fake.signOut,onIdTokenChanged:vi.fn((_auth:unknown,listener:(user:any)=>void)=>{fake.tokenListeners.add(listener);queueMicrotask(()=>{if(fake.tokenListeners.has(listener))listener(fake.auth.currentUser);});return()=>{fake.tokenListeners.delete(listener);};})}));
import {useEmployeeAuthSession} from './useEmployeeAuthSession';
import {useOutputScope} from './useOutputScope';
import {useOfficeTalkSelfSend} from '../../features/chat/hooks/useOfficeTalkSelfSend';
type Token={claims:{employeeId:string;companyId:string;isAdmin:boolean}};
const employee={id:'emp-a',companyId:'taebaek',name:'합성 직원',position:'사무',department:'사무',joinDate:'2026-01-01',status:'working',phone:''} as Employee;
const source:ChatMessage={id:'old-source',companyId:'taebaek',roomId:'source-room',senderId:'other',senderName:'동료',text:'원문',createdAt:'2026-01-01'};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(ok=>{resolve=ok;});return{promise,resolve};}
let events:unknown[]=[],mounts=0,unmounts=0,sequence=0;
let child:null|{id:number;key:string;getSignal:()=>AbortSignal;self:ReturnType<typeof useOfficeTalkSelfSend>}=null;
let session:ReturnType<typeof useEmployeeAuthSession>|null=null;
let evidence:Record<string,unknown>={};const records:unknown[]=[];
const addRoom=vi.fn<(room:ChatRoom)=>Promise<unknown>>(),sendMessage=vi.fn<(message:ChatMessage)=>Promise<unknown>>(),success=vi.fn();
function user(uid='uid-a',admin=false,token?:Promise<Token>){return{uid,isAnonymous:false,getIdTokenResult:vi.fn(()=>{events.push(['token-start',uid,admin]);return(token??Promise.resolve({claims:{employeeId:employee.id,companyId:'taebaek',isAdmin:admin}})).then(value=>{events.push(['token-result',uid,value.claims.isAdmin]);return value;});})};}
function emit(value:ReturnType<typeof user>){fake.auth.currentUser=value;events.push(['emit',value.uid]);for(const listener of [...fake.authListeners])listener(value);for(const listener of [...fake.tokenListeners])listener(value);}
const microtasks=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function Child({currentUser,sessionKey}:{currentUser:Employee;sessionKey:string}){
 const id=useRef<number|null>(null);if(id.current===null)id.current=++sequence;
 const getSignal=useOutputScope(currentUser.companyId!,currentUser.id);
 const self=useOfficeTalkSelfSend({getSignal,currentUser,employees:[currentUser],rooms:[],getUid:()=>fake.auth.currentUser?.uid,addRoom,sendMessage,onSuccess:success});
 child={id:id.current,key:sessionKey,getSignal,self};
 useEffect(()=>{mounts++;events.push(['mount',id.current,sessionKey]);return()=>{unmounts++;events.push(['unmount',id.current,sessionKey]);};},[]);
 return <div data-testid="session-child">{sessionKey}</div>;
}
function Parent(){
 const current=useEmployeeAuthSession();session=current;
 useEffect(()=>{events.push(['parent-commit',current.sessionKey,current.currentUser?.id??null,current.logoutState,current.authChecked]);},[current.sessionKey,current.currentUser,current.logoutState,current.authChecked]);
 if(current.logoutState!=='idle')return <div>로그아웃 상태</div>;
 if(!current.authChecked)return <div>인증 확인</div>;
 if(!current.currentUser)return <div>로그인</div>;
 return <Child key={current.sessionKey} sessionKey={current.sessionKey} currentUser={current.currentUser}/>;
}
function snapshot(label:string){return {label,key:session?.sessionKey,employee:session?.currentUser?.id,childId:child?.id,signalAborted:child?.getSignal().aborted,mounts,unmounts,roomCalls:addRoom.mock.calls.length,messages:sendMessage.mock.calls.map(([message])=>message),successCalls:success.mock.calls.length,events:structuredClone(events)};}
async function start(){localStorage.setItem('tb_user',JSON.stringify(employee));fake.auth.currentUser=user();const view=render(<Parent/>);await waitFor(()=>{expect(session?.currentUser?.id).toBe(employee.id);expect(fake.tokenListeners.size).toBe(1);expect(fake.authListeners.size).toBe(1);expect(mounts).toBe(1);});expect(child!.getSignal().aborted).toBe(false);return view;}
type Order='B대기-A완료'|'B완료-A완료';
async function aba(order:Order){
 await start();const initial=snapshot('initial'),room=deferred<unknown>();addRoom.mockReturnValueOnce(room.promise);let old!:Promise<void>;act(()=>{old=child!.self.send(source);});expect(addRoom).toHaveBeenCalledOnce();expect(sendMessage).not.toHaveBeenCalled();
 const tokenB=deferred<Token>(),b=user('uid-b',false,tokenB.promise),a=user();
 await act(async()=>{emit(b);if(order==='B완료-A완료'){tokenB.resolve({claims:{employeeId:employee.id,companyId:'taebaek',isAdmin:false}});await microtasks();}emit(a);await microtasks();});
 const afterBatch=snapshot('after-batch');
 if(order==='B대기-A완료')await act(async()=>{tokenB.resolve({claims:{employeeId:employee.id,companyId:'taebaek',isAdmin:false}});await microtasks();});
 await act(async()=>{room.resolve(undefined);await old;});
 evidence={order,initial,afterBatch,afterOldAck:snapshot('after-old-ack')};
 return {initial,afterBatch};
}
beforeEach(()=>{cleanup();localStorage.clear();fake.tokenListeners.clear();fake.authListeners.clear();fake.auth.currentUser=null;events=[];mounts=0;unmounts=0;sequence=0;child=null;session=null;evidence={};vi.clearAllMocks();addRoom.mockReset().mockResolvedValue(undefined);sendMessage.mockReset().mockResolvedValue(undefined);fake.capture.mockReturnValue({ready:Promise.resolve(),assertCurrent:vi.fn(),dispose:vi.fn()});fake.unregister.mockResolvedValue(undefined);fake.signOut.mockResolvedValue(undefined);});
afterEach(context=>{records.push({title:context.task.name,evidence:structuredClone(evidence)});if(process.env.CODEX_AUTH_ABA_OBSERVATION_PATH)writeFileSync(process.env.CODEX_AUTH_ABA_OBSERVATION_PATH,JSON.stringify({status:'TEST_ONLY_OBSERVATIONS',records},null,2));cleanup();localStorage.clear();});
it('시험 부모는 실제 양Root의 인증 조건과 sessionKey child 배치를 보존한다',()=>{
 for(const app of ['admin','staff']){const text=readFileSync('apps/'+app+'/main.tsx','utf8');const begin=text.indexOf('const '+(app==='admin'?'AdminRoot':'StaffRoot')+':');const root=text.slice(begin);expect(root.indexOf("session.logoutState!=='idle'")).toBeLessThan(root.indexOf('!session.authChecked'));expect(root.indexOf('!session.authChecked')).toBeLessThan(root.indexOf('!session.currentUser'));expect(root).toContain('key={session.sessionKey} currentUser={session.currentUser}');}evidence={rootConditionalAndKeySource:true};
});
it('동일 토큰 갱신은 key·직원객체·child·출력수명을 유지하며 새 자기전달이 된다',async()=>{
 await start();const firstUser=session!.currentUser,firstKey=session!.sessionKey,firstId=child!.id,signal=child!.getSignal();await act(async()=>{emit(user());await microtasks();});await act(async()=>{await child!.self.send({...source,id:'new-source'});});evidence=snapshot('same-token');expect(session!.currentUser).toBe(firstUser);expect(session!.sessionKey).toBe(firstKey);expect(child!.id).toBe(firstId);expect(child!.getSignal()).toBe(signal);expect(signal.aborted).toBe(false);expect(mounts).toBe(1);expect(unmounts).toBe(0);expect(sendMessage).toHaveBeenCalledOnce();
});
it('같은UID 권한 변경은 key와 child를 교대하고 이전 출력수명을 끝낸다',async()=>{
 await start();const key=session!.sessionKey,id=child!.id,signal=child!.getSignal();await act(async()=>{emit(user('uid-a',true));await microtasks();});evidence=snapshot('role-change');expect(session!.sessionKey).not.toBe(key);expect(child!.id).not.toBe(id);expect(signal.aborted).toBe(true);expect(child!.getSignal().aborted).toBe(false);expect(mounts).toBe(2);expect(unmounts).toBe(1);
});
it.each(['B대기-A완료','B완료-A완료'] as const)('%s batch 뒤 옛 방 ACK는 자기전달 메시지를 보내지 않는다',async order=>{
 await aba(order);expect(session!.currentUser?.id).toBe(employee.id);expect(fake.auth.currentUser.uid).toBe('uid-a');expect(sendMessage).not.toHaveBeenCalled();expect(success).not.toHaveBeenCalled();
});
it.each(['B대기-A완료','B완료-A완료'] as const)('%s batch 뒤 현재 child의 출력수명과 새 업무가 재개된다',async order=>{
 await aba(order);const before=sendMessage.mock.calls.length;await act(async()=>{await child!.self.send({...source,id:'new-source',text:'현재 새 업무'});});evidence={...evidence,afterNewAction:snapshot('after-new-action'),newMessageDelta:sendMessage.mock.calls.length-before};expect.soft(child!.getSignal().aborted).toBe(false);expect.soft(sendMessage.mock.calls.length-before).toBe(1);expect.soft(sendMessage.mock.calls.at(-1)?.[0].replyTo?.id).toBe('new-source');
});

it('최종 commit 전 UID ABA의 옛 방 ACK도 후속 메시지를 보내지 않는다',async()=>{
 await start();const initial=snapshot('initial'),room=deferred<unknown>();addRoom.mockReturnValueOnce(room.promise);let old!:Promise<void>;act(()=>{old=child!.self.send(source);});
 const tokenA=deferred<Token>(),tokenB=deferred<Token>();let beforeCommit:unknown;
 await act(async()=>{emit(user('uid-b',false,tokenB.promise));emit(user('uid-a',false,tokenA.promise));room.resolve(undefined);await old;beforeCommit=snapshot('old-ack-before-final-A-verification');tokenA.resolve({claims:{employeeId:employee.id,companyId:'taebaek',isAdmin:false}});await microtasks();});
 evidence={initial,beforeCommit,afterCommit:snapshot('after-final-commit')};expect(sendMessage).not.toHaveBeenCalled();expect(success).not.toHaveBeenCalled();
});
