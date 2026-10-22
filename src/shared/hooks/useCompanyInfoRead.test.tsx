/** @vitest-environment jsdom */
import React, { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CompanyId } from '../types';
const m=vi.hoisted(()=>({auth:{currentUser:{uid:'a'} as {uid:string}|null,onAuthStateChanged:(listener:(user:{uid:string}|null)=>void)=>{m.authListeners.add(listener);listener(m.auth.currentUser);return()=>{m.authListeners.delete(listener);};}},authListeners:new Set<(user:{uid:string}|null)=>void>(),ready:Promise.resolve() as Promise<void>,reads:[] as {path:string;next:(snapshot:{exists:()=>boolean;data:()=>unknown})=>void;error:()=>void;stop:ReturnType<typeof vi.fn>}[]}));
vi.mock('../firebase',()=>({auth:m.auth,db:{},get authReady(){return m.ready;}}));
vi.mock('firebase/firestore',()=>({doc:(_db:unknown,collection:string,id:string)=>collection+'/'+id,onSnapshot:(path:string,next:(snapshot:{exists:()=>boolean;data:()=>unknown})=>void,error:()=>void)=>{const stop=vi.fn();m.reads.push({path,next,error,stop});return stop;}}));
import { useCompanyInfoRead } from './useCompanyInfoRead';
const emit=(index:number,value:unknown)=>act(()=>m.reads[index].next({exists:()=>value!==null,data:()=>value}));
const uid=(value:string|null)=>{m.auth.currentUser=value?{uid:value}:null;for(const listener of [...m.authListeners])listener(m.auth.currentUser);};
beforeEach(()=>{m.auth.currentUser={uid:'a'};m.authListeners.clear();m.ready=Promise.resolve();m.reads=[];});
const options={companyId:'taebaek' as CompanyId,enabled:true};
it('정확 회사 문서만 읽고 loading에서 빈값·ready에서 원문 빈필드 그대로 전달한다',async()=>{
 const hook=renderHook(()=>useCompanyInfoRead(options));expect(hook.result.current.status).toBe('loading');expect(hook.result.current.value).toBeNull();await waitFor(()=>expect(m.reads).toHaveLength(1));expect(m.reads[0].path).toBe('settings/taebaek');emit(0,{name:'',tel:' ',bankAccount:''});expect(hook.result.current.value).toEqual({name:'',tel:' ',bankAccount:''});expect(hook.result.current.status).toBe('ready');expect(hook.result.current.isCurrent(hook.result.current.observationToken)).toBe(true);
});
it('missing과 error는 이전값을 비우며 이전 ready 관측을 즉시 무효화한다',async()=>{
 const hook=renderHook(()=>useCompanyInfoRead(options));await waitFor(()=>expect(m.reads).toHaveLength(1));emit(0,{name:'현재'});const token=hook.result.current.observationToken;emit(0,null);expect(hook.result.current.status).toBe('missing');expect(hook.result.current.value).toBeNull();expect(hook.result.current.isCurrent(token)).toBe(false);emit(0,{name:'재확인'});act(()=>m.reads[0].error());expect(hook.result.current.status).toBe('error');expect(hook.result.current.value).toBeNull();expect(hook.result.current.error).toContain('다시 확인');
});
it('명시 retry는 기존관측을 동기 폐기하고 옛 callback 대신 새 구독만 수용한다',async()=>{
 const hook=renderHook(()=>useCompanyInfoRead(options));await waitFor(()=>expect(m.reads).toHaveLength(1));emit(0,{name:'처음'});const token=hook.result.current.observationToken;act(()=>hook.result.current.retry());expect(hook.result.current.isCurrent(token)).toBe(false);expect(hook.result.current.value).toBeNull();await waitFor(()=>expect(m.reads).toHaveLength(2));expect(m.reads[0].stop).toHaveBeenCalledOnce();emit(0,{name:'늦은 이전'});expect(hook.result.current.value).toBeNull();emit(1,{name:'최신'});expect(hook.result.current.value).toEqual({name:'최신'});
});
it('회사 전환 렌더와 A-B-A는 이전설정을 숨기고 old retry·응답을 되살리지 않는다',async()=>{
 const hook=renderHook(props=>useCompanyInfoRead(props),{initialProps:options});await waitFor(()=>expect(m.reads).toHaveLength(1));emit(0,{name:'A'});const previous=hook.result.current;hook.rerender({...options,companyId:'punghoe'});expect(hook.result.current.value).toBeNull();await waitFor(()=>expect(m.reads).toHaveLength(2));hook.rerender(options);await waitFor(()=>expect(m.reads).toHaveLength(3));act(()=>previous.retry());expect(m.reads).toHaveLength(3);emit(0,{name:'옛A'});emit(1,{name:'옛B'});expect(hook.result.current.value).toBeNull();expect(previous.isCurrent(previous.observationToken)).toBe(false);emit(2,{name:'새A'});expect(hook.result.current.value).toEqual({name:'새A'});
});
it('동일 tick UID A-B-A는 옛 관측과 응답을 영구 폐기한다',async()=>{
 const hook=renderHook(()=>useCompanyInfoRead(options));await waitFor(()=>expect(m.reads).toHaveLength(1));emit(0,{name:'기존'});const previous=hook.result.current;act(()=>{uid('b');uid('a');});expect(hook.result.current.value).toBeNull();await waitFor(()=>expect(m.reads).toHaveLength(2));emit(0,{name:'옛 응답'});expect(hook.result.current.value).toBeNull();expect(previous.isCurrent(previous.observationToken)).toBe(false);emit(1,{name:'새 계정 세대'});expect(hook.result.current.value).toEqual({name:'새 계정 세대'});
});
it('disabled는 idle이며 옛 retry와 응답이 구독을 재개하지 않는다',async()=>{
 const hook=renderHook(props=>useCompanyInfoRead(props),{initialProps:options});await waitFor(()=>expect(m.reads).toHaveLength(1));const previous=hook.result.current;hook.rerender({...options,enabled:false});expect(hook.result.current.status).toBe('idle');expect(hook.result.current.value).toBeNull();act(()=>previous.retry());emit(0,{name:'늦은 값'});expect(hook.result.current.value).toBeNull();expect(m.reads).toHaveLength(1);
});
it('새 snapshot은 값이 같아도 이전 서류 관측 token을 갱신한다',async()=>{
 const hook=renderHook(()=>useCompanyInfoRead(options));await waitFor(()=>expect(m.reads).toHaveLength(1));emit(0,{name:'동일'});const token=hook.result.current.observationToken;emit(0,{name:'동일'});expect(hook.result.current.isCurrent(token)).toBe(false);expect(hook.result.current.isCurrent(hook.result.current.observationToken)).toBe(true);
});
it('authReady 거절은 error가 되고 재시도는 자동 성공으로 승격하지 않는다',async()=>{
 m.ready=Promise.reject(Error('준비 실패'));const hook=renderHook(()=>useCompanyInfoRead(options));await waitFor(()=>expect(hook.result.current.status).toBe('error'));expect(hook.result.current.value).toBeNull();expect(m.reads).toHaveLength(0);act(()=>hook.result.current.retry());await waitFor(()=>expect(hook.result.current.status).toBe('error'));expect(m.reads).toHaveLength(0);
});
it('StrictMode와 unmount 뒤 listener를 정리하고 이전값 및 lease를 수용하지 않는다',async()=>{
 const hook=renderHook(()=>useCompanyInfoRead(options),{wrapper:({children}:{children:React.ReactNode})=><StrictMode>{children}</StrictMode>});await waitFor(()=>expect(m.reads).toHaveLength(1));emit(0,{name:'현재'});const previous=hook.result.current;hook.unmount();expect(m.authListeners.size).toBe(0);expect(m.reads[0].stop).toHaveBeenCalledOnce();emit(0,{name:'unmount 후'});expect(previous.isCurrent(previous.observationToken)).toBe(false);act(()=>previous.retry());expect(m.reads).toHaveLength(1);
});
