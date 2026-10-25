/** @vitest-environment jsdom */
import React,{useEffect,useRef} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {writeFileSync} from 'node:fs';
const fake=vi.hoisted(()=>{
 const tokenListeners=new Set<(user:any)=>void>(),authListeners=new Set<(user:any)=>void>();
 const auth={currentUser:null as any,onAuthStateChanged:(listener:(user:any)=>void)=>{authListeners.add(listener);queueMicrotask(()=>{if(authListeners.has(listener))listener(auth.currentUser);});return()=>{authListeners.delete(listener);};}};
 return{auth,tokenListeners,authListeners,signOut:vi.fn(),capture:vi.fn(),unregister:vi.fn(),confirm:vi.fn(),actor:vi.fn(),stock:vi.fn()};
});
vi.mock('../src/shared/firebase',()=>({db:{},storage:{},functions:{},auth:fake.auth,authReady:Promise.resolve()}));
vi.mock('../src/shared/push',()=>({capturePushActor:fake.capture,unregisterPush:fake.unregister}));
vi.mock('firebase/auth',()=>({signOut:fake.signOut,onIdTokenChanged:(_auth:unknown,listener:(user:any)=>void)=>{fake.tokenListeners.add(listener);queueMicrotask(()=>{if(fake.tokenListeners.has(listener))listener(fake.auth.currentUser);});return()=>{fake.tokenListeners.delete(listener);};}}));
vi.mock('../src/shared/services/firebaseService',()=>({fetchCollection:vi.fn().mockResolvedValue([]),subscribeToCollection:vi.fn(()=>()=>{}),addItem:vi.fn()}));
vi.mock('../src/shared/components/appDialog',()=>({appConfirm:fake.confirm}));
vi.mock('../src/shared/services/unpackService',()=>({productStocktakeActor:fake.actor,durableCanUnpack:vi.fn(),durableProductStocktake:vi.fn()}));
vi.mock('../src/shared/services/boxUnpackService',()=>({durableBoxUnpack:vi.fn()}));
vi.mock('../src/shared/services/itemStockAddService',()=>({durableItemStockAdd:fake.stock}));
import ItemList from './ItemList';
import {useEmployeeAuthSession} from '../src/shared/hooks/useEmployeeAuthSession';
import {beginItemInventoryAttempt,listItemInventoryAttempts} from '../src/shared/itemInventoryAttempt';
import type {Employee} from '../src/shared/types';
const employee={id:'emp-a',companyId:'taebaek',name:'합성 직원',position:'사무',department:'사무',joinDate:'2026-01-01',status:'working',phone:''} as Employee;
type Token={claims:{employeeId:string;companyId:string;isAdmin:boolean}};
const claims:Token={claims:{employeeId:employee.id,companyId:'taebaek',isAdmin:false}};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(ok=>{resolve=ok;});return{promise,resolve};}
let events:unknown[]=[],mounts=0,unmounts=0,sequence=0,currentChild=0,key='',evidence:unknown;
const records:unknown[]=[];
function user(uid='uid-a',token?:Promise<Token>){return{uid,isAnonymous:false,getIdTokenResult:vi.fn(()=>token??Promise.resolve(claims))};}
function emit(value:ReturnType<typeof user>){fake.auth.currentUser=value;events.push(['emit',value.uid]);for(const fn of [...fake.authListeners])fn(value);for(const fn of [...fake.tokenListeners])fn(value);}
async function microtasks(){for(let i=0;i<12;i++)await Promise.resolve();}
const props={companyId:'taebaek' as const,items:[],partners:[],orderRequests:[],confirmedOrders:[],inboundPartners:[],rawMaterialLedger:[],onUpdateItem:vi.fn(),onAddItem:vi.fn(),onAddOrderRequest:vi.fn(),onRemoveOrderRequest:vi.fn(),onUpdateOrderRequestQty:vi.fn(),onToggleConfirmRequestQty:vi.fn(),onConfirmRequest:vi.fn(),onConfirmRequests:vi.fn(),onBulkAddConfirmedOrders:vi.fn(),onConfirmAllRequests:vi.fn(),onFinishConfirmedOrder:vi.fn(),onUpdateConfirmedQty:vi.fn(),onRemoveConfirmedOrder:vi.fn(),onEditProduct:vi.fn(),onDeleteItem:vi.fn(),onAddAdjustmentRequest:vi.fn(),onAddRawMaterialEntry:vi.fn(),onDeleteRawMaterialEntry:vi.fn()};
function Child({sessionKey}:{sessionKey:string}){const id=useRef(0);if(!id.current)id.current=++sequence;currentChild=id.current;key=sessionKey;useEffect(()=>{mounts++;events.push(['mount',id.current,sessionKey]);return()=>{unmounts++;events.push(['unmount',id.current,sessionKey]);};},[]);return <ItemList {...props}/>;}
function Parent(){const session=useEmployeeAuthSession();if(session.logoutState!=='idle')return <div>로그아웃</div>;if(!session.authChecked)return <div>인증 확인</div>;if(!session.currentUser)return <div>로그인</div>;return <Child key={session.sessionKey} sessionKey={session.sessionKey}/>;}
function snapshot(label:string){return{label,currentChild,key,mounts,unmounts,uid:fake.auth.currentUser?.uid,authListeners:fake.authListeners.size,tokenListeners:fake.tokenListeners.size,writerCalls:fake.stock.mock.calls.map(args=>args[0]),events:structuredClone(events)};}
async function start(){localStorage.setItem('tb_user',JSON.stringify(employee));fake.auth.currentUser=user();const request=beginItemInventoryAttempt({companyId:'taebaek',uid:'uid-a',kind:'stock-add',rows:[{itemId:'p1',itemName:'최초 품목',deltaQty:2,unitKg:1,note:'원문'}]}).request;render(<Parent/>);await waitFor(()=>{expect(fake.tokenListeners.size).toBe(1);expect(mounts).toBe(1);});return request;}
async function confirmPending(){fireEvent.click(screen.getByRole('button',{name:/^실패 /}));fireEvent.click(screen.getByRole('button',{name:/최초 품목.*확인 대기/}));fireEvent.click(screen.getByRole('button',{name:'보존된 입력으로 계속'}));await waitFor(()=>expect(fake.confirm).toHaveBeenCalled());}
beforeEach(()=>{cleanup();localStorage.clear();fake.tokenListeners.clear();fake.authListeners.clear();events=[];mounts=0;unmounts=0;sequence=0;currentChild=0;key='';evidence={};vi.clearAllMocks();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,_options:unknown,run:()=>Promise<unknown>)=>run()}});fake.actor.mockImplementation(async()=>{events.push(['actor',fake.auth.currentUser?.uid]);return fake.auth.currentUser?.uid;});fake.stock.mockImplementation(async(request)=>{events.push(['writer',request.operationId]);return{ok:false,status:'unknown',retainPending:true,message:'합성 응답 미확인'};});fake.capture.mockReturnValue({ready:Promise.resolve(),assertCurrent:vi.fn(),dispose:vi.fn()});fake.unregister.mockResolvedValue(undefined);fake.signOut.mockResolvedValue(undefined);});
afterEach(context=>{records.push({name:context.task.name,evidence});const path=process.env.CODEX_ITEM_INVENTORY_ABA_REPORT_PATH;if(path)writeFileSync(path,JSON.stringify({records},null,2));cleanup();localStorage.clear();});
it('동일 Auth 토큰 갱신은 mount를 유지하고 최초 prepared 확인을 한 번 보낸다',async()=>{const request=await start();const initial=currentChild;fake.confirm.mockResolvedValue(true);await act(async()=>{emit(user());await microtasks();});await confirmPending();await waitFor(()=>expect(fake.stock).toHaveBeenCalledOnce());expect(fake.stock).toHaveBeenCalledWith(request);expect(currentChild).toBe(initial);expect(unmounts).toBe(0);evidence=snapshot('same-auth');});
it('최종 Auth commit 전 UID ABA 확인 continuation은 옛 writer를 보내지 않는다',async()=>{
 const request=await start(),answer=deferred<boolean>();fake.confirm.mockReturnValue(answer.promise);await confirmPending();const initial=currentChild,tokenA=deferred<Token>(),tokenB=deferred<Token>();let before:ReturnType<typeof snapshot>|undefined;
 await act(async()=>{emit(user('uid-b',tokenB.promise));emit(user('uid-a',tokenA.promise));answer.resolve(true);await microtasks();before=snapshot('before-final-A-token');tokenA.resolve(claims);await microtasks();});
 const after=snapshot('after-final-A-commit');expect(before!.currentChild).toBe(initial);expect(before!.unmounts).toBe(0);expect(currentChild).not.toBe(initial);
 // 새 mount의 명시 재확인은 기존 prepared 원문으로 재개 가능하다.
 fake.stock.mockClear();fake.confirm.mockResolvedValue(true);await confirmPending();await waitFor(()=>expect(fake.stock).toHaveBeenCalledOnce());expect(fake.stock).toHaveBeenCalledWith(request);expect(listItemInventoryAttempts('taebaek','uid-a')[0]!.retained!.request).toEqual(request);
 evidence={before,after,afterExplicit:snapshot('new-explicit-confirm')};expect(before!.writerCalls).toHaveLength(0);
});
it('Auth commit이 먼저 끝나면 옛 확인은 보내지 않고 새 명시 확인만 재개한다',async()=>{
 const request=await start(),answer=deferred<boolean>();fake.confirm.mockReturnValue(answer.promise);await confirmPending();const initial=currentChild,tokenA=deferred<Token>(),tokenB=deferred<Token>();
 await act(async()=>{emit(user('uid-b',tokenB.promise));emit(user('uid-a',tokenA.promise));tokenA.resolve(claims);await microtasks();});expect(currentChild).not.toBe(initial);expect(unmounts).toBe(1);
 await act(async()=>{answer.resolve(true);await microtasks();});expect(fake.stock).not.toHaveBeenCalled();const afterOld=snapshot('commit-first-old-confirm');fake.confirm.mockResolvedValue(true);await confirmPending();await waitFor(()=>expect(fake.stock).toHaveBeenCalledOnce());expect(fake.stock).toHaveBeenCalledWith(request);evidence={afterOld,afterNew:snapshot('commit-first-new-confirm')};
});
